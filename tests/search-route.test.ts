import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { POST } from "../src/app/api/search/route.js";

const environmentKeys = [
  "SEARCH_SCOPE",
  "EMBEDDING_SERVICE_URL",
  "DATABASE_URL",
] as const;
const originalEnvironment = environmentKeys.map(
  (key) => [key, process.env[key]] as const,
);

function request(body: unknown): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  delete process.env.SEARCH_SCOPE;
  delete process.env.DATABASE_URL;
  process.env.EMBEDDING_SERVICE_URL = "http://embedding.test";
});

afterEach(() => {
  for (const [key, value] of originalEnvironment) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("requires JSON content before calling the embedding service", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected embedding request");
  });

  for (const contentType of [undefined, "text/plain", "application/jsonp"]) {
    const response = await POST(
      new Request("http://localhost/api/search", {
        method: "POST",
        ...(contentType ? { headers: { "Content-Type": contentType } } : {}),
        body: JSON.stringify({ query: "butterfly" }),
      }),
    );

    assert.equal(response.status, 415);
    assert.deepEqual(await response.json(), {
      error: "Content-Type must be application/json.",
    });
  }

  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects malformed JSON before calling the embedding service", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected embedding request");
  });
  const response = await POST(
    new Request("http://localhost/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    }),
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Request body must be valid JSON.",
  });
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects malformed query fields and client-supplied scope options", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected embedding request");
  });

  for (const body of [
    null,
    [],
    "butterfly",
    {},
    { query: null },
    { query: 42 },
    { query: [] },
    { query: {} },
    { query: "butterfly", publicOnly: false },
    { query: "butterfly", scope: "all" },
    { query: "butterfly", limit: 100 },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(await response.json(), {
      error: "Request body must contain a query string and an optional offset.",
    });
  }

  assert.equal(fetchMock.mock.callCount(), 0);
});

test("rejects malformed offsets before requesting an embedding", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected embedding request");
  });

  for (const offset of [
    null,
    -1,
    1.5,
    "6",
    {},
    [],
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const response = await POST(request({ query: "butterfly", offset }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Offset must be a nonnegative safe integer.",
    });
  }

  assert.equal(fetchMock.mock.callCount(), 0);
});

test("accepts a valid page offset before requesting database configuration", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      dimensions: 768,
      embedding: Array(768).fill(1),
    }),
  );
  const errorMock = t.mock.method(console, "error", () => {});

  const response = await POST(request({ query: "butterfly", offset: 6 }));
  assert.equal(response.status, 500);
  const loggedError: unknown = errorMock.mock.calls[0]?.arguments[1];
  assert.ok(loggedError instanceof Error);
  assert.equal(loggedError.message, "DATABASE_URL is not set");
});

test("rejects blank queries before calling the embedding service", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected embedding request");
  });

  for (const query of ["", " \n\t "]) {
    const response = await POST(request({ query }));
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "Query must not be empty.",
    });
  }

  assert.equal(fetchMock.mock.callCount(), 0);
});

test("invalid server scope fails before making an embedding request", async (t) => {
  process.env.SEARCH_SCOPE = "typo";
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Unexpected embedding request");
  });
  const errorMock = t.mock.method(console, "error", () => {});

  const response = await POST(request({ query: "butterfly" }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Search is unavailable. Please try again.",
  });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(errorMock.mock.callCount(), 1);
});

test("trims the query and keeps embedding failures in server logs", async (t) => {
  const cause = new Error("private embedding service details");
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(url, "http://embedding.test/embed");
      assert.equal(options?.body, JSON.stringify({ text: "blue butterfly" }));
      throw cause;
    },
  );
  const errorMock = t.mock.method(console, "error", () => {});
  const input = request({ query: "  blue butterfly \n" });
  input.headers.set("Content-Type", "application/json; charset=utf-8");

  const response = await POST(input);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Search is unavailable. Please try again.",
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(errorMock.mock.callCount(), 1);
  const loggedError: unknown = errorMock.mock.calls[0]?.arguments[1];
  assert.ok(loggedError instanceof Error);
  assert.equal(loggedError.cause, cause);
});

test("returns a safe error when database configuration is missing", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      dimensions: 768,
      embedding: Array(768).fill(1),
    }),
  );
  const errorMock = t.mock.method(console, "error", () => {});

  const response = await POST(request({ query: "butterfly" }));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Search is unavailable. Please try again.",
  });
  const loggedError: unknown = errorMock.mock.calls[0]?.arguments[1];
  assert.ok(loggedError instanceof Error);
  assert.equal(loggedError.message, "DATABASE_URL is not set");
});
