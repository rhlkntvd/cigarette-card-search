import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { getSearchScope } from "../src/app/search-scope.js";

const originalScope = process.env.SEARCH_SCOPE;

beforeEach(() => {
  delete process.env.SEARCH_SCOPE;
});

afterEach(() => {
  if (originalScope === undefined) {
    delete process.env.SEARCH_SCOPE;
  } else {
    process.env.SEARCH_SCOPE = originalScope;
  }
});

test("defaults web searches to the public corpus", () => {
  assert.equal(getSearchScope(), "public");
});

test("accepts explicit public search", () => {
  process.env.SEARCH_SCOPE = "public";
  assert.equal(getSearchScope(), "public");
});

test("requires explicit configuration for full-corpus search", () => {
  process.env.SEARCH_SCOPE = "all";
  assert.equal(getSearchScope(), "all");
});

test("rejects invalid configuration instead of enabling full-corpus search", () => {
  for (const scope of ["", "PUBLIC", "ALL", "false", " public ", "typo"]) {
    process.env.SEARCH_SCOPE = scope;
    assert.throws(getSearchScope, /SEARCH_SCOPE must be "public" or "all"/);
  }
});
