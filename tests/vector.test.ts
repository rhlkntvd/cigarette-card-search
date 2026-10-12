import assert from "node:assert/strict";
import test from "node:test";

import { EMBEDDING_DIMENSIONS, isEmbedding } from "../src/vector.js";

test("accepts finite, nonzero embeddings without requiring unit length", () => {
  assert.equal(EMBEDDING_DIMENSIONS, 768);
  assert.equal(isEmbedding(Array(768).fill(1)), true);

  const embedding = Array(768).fill(0);
  embedding[0] = -0.5;
  assert.equal(isEmbedding(embedding), true);
});

test("rejects non-arrays and incorrect dimensions", () => {
  const invalidValues = [
    null,
    undefined,
    {},
    "embedding",
    [],
    Array(767).fill(1),
    Array(769).fill(1),
  ];

  for (const value of invalidValues) {
    assert.equal(isEmbedding(value), false);
  }
});

test("rejects nonnumeric, nonfinite and missing elements", () => {
  for (const value of ["1", null, undefined, NaN, Infinity, -Infinity]) {
    const embedding = Array(768).fill(1);
    embedding[100] = value;
    assert.equal(isEmbedding(embedding), false);
  }

  const sparseEmbedding = Array(768).fill(1);
  delete sparseEmbedding[100];
  assert.equal(isEmbedding(sparseEmbedding), false);
});

test("rejects zero vectors", () => {
  assert.equal(isEmbedding(Array(768).fill(0)), false);
  assert.equal(isEmbedding(Array(768).fill(-0)), false);
});
