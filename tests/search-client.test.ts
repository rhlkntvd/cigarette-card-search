import assert from "node:assert/strict";
import { test } from "node:test";

import { fetchSearchResults } from "../src/app/search-client.js";
import type { SearchResult } from "../src/search.js";

const card: SearchResult = {
  dplaId: "sample-card",
  title: "Blue butterfly",
  frontImageId: "123",
  backImageId: null,
  sourceUrl: "https://digitalcollections.nypl.org/items/sample-card",
  rights: "http://rightsstatements.org/vocab/NoC-US/1.0/",
  displayEligible: true,
  similarity: 0.7,
};

test("posts the query to the same-origin search endpoint and returns cards", async (t) => {
  const fetchMock = t.mock.method(
    globalThis,
    "fetch",
    async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(url, "/api/search");
      assert.equal(options?.method, "POST");
      assert.ok(options?.signal instanceof AbortSignal);
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/json",
      });
      assert.equal(
        options?.body,
        JSON.stringify({ query: "blue butterfly", offset: 0 }),
      );
      return Response.json({ results: [card], hasMore: false });
    },
  );

  assert.deepEqual(await fetchSearchResults("blue butterfly"), {
    results: [card],
    hasMore: false,
  });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("accepts empty results", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ results: [], hasMore: false }),
  );
  assert.deepEqual(await fetchSearchResults("butterfly"), {
    results: [],
    hasMore: false,
  });
});

test("preserves full-corpus cards, back images, and result order", async (t) => {
  const cards: SearchResult[] = [
    {
      ...card,
      backImageId: "456",
      rights: null,
      displayEligible: false,
    },
    { ...card, dplaId: "second-card", similarity: -0.1 },
  ];
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ results: cards, hasMore: false }),
  );

  assert.deepEqual(await fetchSearchResults("butterfly"), {
    results: cards,
    hasMore: false,
  });
});

test("requests the next six results and preserves the hasMore flag", async (t) => {
  const cards = Array.from({ length: 6 }, (_, index) => ({
    ...card,
    dplaId: `card-${index}`,
  }));
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      assert.equal(
        options?.body,
        JSON.stringify({ query: "butterfly", offset: 6 }),
      );
      return Response.json({ results: cards, hasMore: true });
    },
  );

  assert.deepEqual(await fetchSearchResults("butterfly", 6), {
    results: cards,
    hasMore: true,
  });
});

test("shows the search endpoint's validation error", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Query must not be empty." }, { status: 400 }),
  );

  await assert.rejects(fetchSearchResults(" "), {
    message: "Query must not be empty.",
  });
});

test("uses a readable fallback for an error response without JSON", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("Bad gateway", { status: 502 }),
  );

  await assert.rejects(fetchSearchResults("butterfly"), {
    message: "Search is unavailable. Please try again.",
  });
});

test("adds a readable message to connection failures and preserves the cause", async (t) => {
  const cause = new TypeError("Failed to fetch");
  t.mock.method(globalThis, "fetch", async () => {
    throw cause;
  });

  await assert.rejects(fetchSearchResults("butterfly"), {
    message: "Could not reach search. Please try again.",
    cause,
  });
});

test("reports interrupted response bodies as connection failures", async (t) => {
  const cause = new Error("Connection closed while reading results");
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(cause);
          },
        }),
      ),
  );
  await assert.rejects(fetchSearchResults("butterfly"), {
    message: "Could not reach search. Please try again.",
    cause,
  });
});

test("applies the search deadline to both the request and response body", async (t) => {
  for (const phase of ["request", "body"] as const) {
    await t.test(phase, async (t) => {
      const controller = new AbortController();
      const cause = new DOMException("Deadline exceeded", "TimeoutError");
      t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
        assert.equal(milliseconds, 45_000);
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
      await assert.rejects(fetchSearchResults("butterfly"), {
        message: "Search timed out. Please try again.",
        cause,
      });
    });
  }
});

test("rejects malformed successful responses instead of rendering invalid cards", async (t) => {
  const invalidBodies = [
    null,
    {},
    { results: [] },
    { results: [], hasMore: "true" },
    { results: [], hasMore: true },
    { results: [card], hasMore: true },
    { results: null, hasMore: false },
    { results: [null], hasMore: false },
    { results: [{}], hasMore: false },
    { results: [{ ...card, title: 42 }], hasMore: false },
    { results: [{ ...card, frontImageId: "" }], hasMore: false },
    { results: [{ ...card, sourceUrl: null }], hasMore: false },
    { results: [{ ...card, displayEligible: "true" }], hasMore: false },
    { results: [{ ...card, similarity: null }], hasMore: false },
    { results: Array(7).fill(card), hasMore: true },
  ];
  let responseBody: unknown;
  t.mock.method(globalThis, "fetch", async () => Response.json(responseBody));

  for (const body of invalidBodies) {
    responseBody = body;
    await assert.rejects(fetchSearchResults("butterfly"), {
      message: "Could not read search results. Please try again.",
    });
  }
});

test("rejects a successful response containing invalid JSON", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON"));

  await assert.rejects(fetchSearchResults("butterfly"), {
    message: "Could not read search results. Please try again.",
  });
});
