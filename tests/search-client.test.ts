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
      assert.deepEqual(options?.headers, {
        "Content-Type": "application/json",
      });
      assert.equal(options?.body, JSON.stringify({ query: "blue butterfly" }));
      return Response.json({ results: [card] });
    },
  );

  assert.deepEqual(await fetchSearchResults("blue butterfly"), [card]);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("accepts empty results", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ results: [] }),
  );
  assert.deepEqual(await fetchSearchResults("butterfly"), []);
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

test("rejects malformed successful responses instead of rendering invalid cards", async (t) => {
  const invalidBodies = [
    null,
    {},
    { results: null },
    { results: [null] },
    { results: [{}] },
    { results: [{ ...card, title: 42 }] },
    { results: [{ ...card, frontImageId: "" }] },
    { results: [{ ...card, sourceUrl: null }] },
    { results: [{ ...card, displayEligible: "true" }] },
    { results: [{ ...card, similarity: null }] },
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
