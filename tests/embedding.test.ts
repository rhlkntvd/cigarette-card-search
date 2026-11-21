import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { embedText } from "../src/embedding.js";
import { MAX_QUERY_LENGTH, QueryTooLongError } from "../src/query.js";

const originalServiceUrl = process.env.EMBEDDING_SERVICE_URL;
const originalProxyKey = process.env.MODAL_PROXY_KEY;
const originalProxySecret = process.env.MODAL_PROXY_SECRET;

beforeEach(() => {
  process.env.EMBEDDING_SERVICE_URL = "http://embedding.test/";
  delete process.env.MODAL_PROXY_KEY;
  delete process.env.MODAL_PROXY_SECRET;
});

afterEach(() => {
  if (originalServiceUrl === undefined) {
    delete process.env.EMBEDDING_SERVICE_URL;
  } else {
    process.env.EMBEDDING_SERVICE_URL = originalServiceUrl;
  }
  for (const [key, value] of [
    ["MODAL_PROXY_KEY", originalProxyKey],
    ["MODAL_PROXY_SECRET", originalProxySecret],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("authenticates hosted embedding requests without following redirects", async (t) => {
  process.env.EMBEDDING_SERVICE_URL = "https://embedding.test";
  process.env.MODAL_PROXY_KEY = "wk-test";
  process.env.MODAL_PROXY_SECRET = "ws-test";
  t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(url, "https://embedding.test/embed");
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/json",
        "Modal-Key": "wk-test",
        "Modal-Secret": "ws-test",
      });
      assert.equal(options?.redirect, "error");
      return Response.json({ dimensions: 768, embedding: Array(768).fill(1) });
    },
  );

  assert.equal((await embedText("butterfly")).length, 768);
});

test("rejects incomplete Modal credentials before making a request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected HTTP request");
  });
  for (const [key, secret] of [
    ["wk-test", ""],
    ["", "ws-test"],
  ]) {
    process.env.MODAL_PROXY_KEY = key;
    process.env.MODAL_PROXY_SECRET = secret;
    await assert.rejects(
      embedText("butterfly"),
      /Set both MODAL_PROXY_KEY and MODAL_PROXY_SECRET/,
    );
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("refuses to send Modal credentials over plaintext HTTP", async (t) => {
  process.env.MODAL_PROXY_KEY = "wk-test";
  process.env.MODAL_PROXY_SECRET = "ws-test";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected HTTP request");
  });

  await assert.rejects(embedText("butterfly"), /credentials require an HTTPS/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("posts trimmed text and returns the validated embedding", async (t) => {
  const embedding = Array(768).fill(0);
  embedding[0] = 1;

  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(url, "http://embedding.test/embed");
      assert.equal(options?.method, "POST");
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/json",
      });
      assert.equal(options?.body, JSON.stringify({ text: "a blue butterfly" }));
      assert.ok(options?.signal instanceof AbortSignal);

      return Response.json({ dimensions: 768, embedding });
    },
  );

  assert.deepEqual(await embedText("  a blue butterfly  "), embedding);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("blank optional Modal credentials preserve local embedding requests", async (t) => {
  process.env.MODAL_PROXY_KEY = " \t ";
  process.env.MODAL_PROXY_SECRET = "\n ";
  const embedding = Array(768).fill(1);
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/json",
      });
      return Response.json({ dimensions: 768, embedding });
    },
  );

  assert.deepEqual(await embedText("butterfly"), embedding);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("rejects blank text before making a request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected HTTP request");
  });

  await assert.rejects(embedText(" \n "), /Search text must not be empty/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects missing configuration before making a request", async (t) => {
  delete process.env.EMBEDDING_SERVICE_URL;
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected HTTP request");
  });

  await assert.rejects(
    embedText("butterfly"),
    /EMBEDDING_SERVICE_URL is not set/,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects oversized text before making a request", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected HTTP request");
  });

  await assert.rejects(
    embedText("a".repeat(MAX_QUERY_LENGTH + 1)),
    QueryTooLongError,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("trims whitespace before checking the character limit", async (t) => {
  const text = "a".repeat(MAX_QUERY_LENGTH);
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(options?.body, JSON.stringify({ text }));
      return Response.json({ dimensions: 768, embedding: Array(768).fill(1) });
    },
  );

  assert.equal((await embedText(` ${text} `)).length, 768);
});

test("recognizes the service's token-limit error without exposing its message", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { detail: { code: "text_too_long", message: "private service details" } },
      { status: 400 },
    ),
  );

  await assert.rejects(embedText("butterfly ".repeat(30)), QueryTooLongError);
});

test("keeps unrelated or malformed service errors as server failures", async (t) => {
  let response = new Response();
  t.mock.method(globalThis, "fetch", async () => response);

  for (const body of [
    "not JSON",
    "null",
    '{"detail":"text_too_long"}',
    '{"detail":{"code":"another_error"}}',
  ]) {
    response = new Response(body, { status: 400 });
    await assert.rejects(embedText("butterfly"), (error: unknown) => {
      assert.ok(
        error instanceof Error && !(error instanceof QueryTooLongError),
      );
      assert.match(error.message, /Embedding service returned 400/);
      return true;
    });
  }

  response = Response.json(
    { detail: { code: "text_too_long" } },
    { status: 500 },
  );
  await assert.rejects(
    embedText("butterfly"),
    /Embedding service returned 500/,
  );
});

test("adds context to transport failures and preserves their cause", async (t) => {
  const cause = new TypeError("fetch failed");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });

  await assert.rejects(embedText("butterfly"), {
    message: "Embedding service request failed",
    cause,
  });
});

test("reports HTTP status and response body without trying to parse JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    return new Response("Model unavailable", { status: 503 });
  });

  await assert.rejects(embedText("butterfly"), {
    message: "Embedding service returned 503: Model unavailable",
  });
});

test("identifies malformed JSON and preserves the parsing error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));

  await assert.rejects(embedText("butterfly"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Embedding service returned invalid JSON");
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test("rejects invalid embedding responses", async (t) => {
  const invalidResponses = [
    { name: "null response", body: null },
    { name: "missing fields", body: {} },
    {
      name: "incorrect declared dimension",
      body: { dimensions: 767, embedding: Array(768).fill(1) },
    },
    {
      name: "incorrect vector length",
      body: { dimensions: 768, embedding: Array(767).fill(1) },
    },
    {
      name: "numeric strings",
      body: { dimensions: 768, embedding: Array(768).fill("1") },
    },
    {
      name: "null elements",
      body: { dimensions: 768, embedding: Array(768).fill(null) },
    },
    {
      name: "zero vector",
      body: { dimensions: 768, embedding: Array(768).fill(0) },
    },
  ];

  for (const { name, body } of invalidResponses) {
    await t.test(name, async (t) => {
      t.mock.method(globalThis, "fetch", async () => Response.json(body));

      await assert.rejects(
        embedText("butterfly"),
        /Embedding service returned an invalid response/,
      );
    });
  }
});

test("adds context when reading the response body fails", async (t) => {
  const cause = new Error("Connection closed while reading body");
  t.mock.method(globalThis, "fetch", async () => {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.error(cause);
        },
      }),
    );
  });

  await assert.rejects(embedText("butterfly"), {
    message: "Embedding service request failed",
    cause,
  });
});

test("applies the 30-second deadline to the request and body read", async (t) => {
  for (const phase of ["request", "body"] as const) {
    await t.test(phase, async (t) => {
      const controller = new AbortController();
      const cause = new DOMException("Deadline exceeded", "TimeoutError");

      t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        assert.equal(milliseconds, 30_000);
        return controller.signal;
      });

      t.mock.method(
        globalThis,
        "fetch",
        async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
          assert.equal(options?.signal, controller.signal);

          if (phase === "request") {
            controller.abort(cause);
            throw cause;
          }

          return new Response(
            new ReadableStream({
              pull(streamController) {
                controller.abort(cause);
                streamController.error(cause);
              },
            }),
          );
        },
      );

      await assert.rejects(embedText("butterfly"), {
        message: "Embedding service request timed out after 30000 ms",
        cause,
      });
    });
  }
});
