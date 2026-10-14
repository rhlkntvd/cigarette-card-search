import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

const originalDatabaseUrl = process.env.DATABASE_URL;
delete process.env.DATABASE_URL;

const { searchCards } = await import("../src/search.js");

beforeEach(() => {
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

test("rejects invalid embeddings before requiring database configuration", async () => {
  const invalidEmbeddings = [
    [],
    Array(767).fill(1),
    Array(768).fill(0),
    Array(768).fill(NaN),
    Array(768).fill(Infinity),
  ];

  for (const embedding of invalidEmbeddings) {
    await assert.rejects(
      searchCards(embedding),
      /Expected a nonzero 768-dimensional embedding/,
    );
  }
});

test("rejects invalid limits before requiring database configuration", async () => {
  const embedding = Array(768).fill(1);

  for (const limit of [0, -1, 101, 1.5, NaN, Infinity]) {
    await assert.rejects(
      searchCards(embedding, { limit }),
      /Search limit must be between 1 and 100/,
    );
  }
});

test("accepts the default and boundary limits before requesting a client", async () => {
  const embedding = Array(768).fill(1);

  for (const options of [{}, { limit: 1 }, { limit: 100 }]) {
    await assert.rejects(
      searchCards(embedding, options),
      /DATABASE_URL is not set/,
    );
  }
});
