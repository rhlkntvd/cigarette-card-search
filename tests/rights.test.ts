import assert from "node:assert/strict";
import test from "node:test";

import { isDisplayEligible, normalizeRightsUri } from "../src/rights.js";

const allowedRights = [
  "http://rightsstatements.org/vocab/NoC-US/1.0/",
  "https://creativecommons.org/publicdomain/zero/1.0/",
  "https://creativecommons.org/publicdomain/mark/1.0/",
];

test("allows NoC-US, CC0 and Public Domain Mark", () => {
  for (const rights of allowedRights) {
    assert.equal(isDisplayEligible(rights), true, rights);
  }
});

test("normalizes scheme, whitespace and trailing-slash variants", () => {
  const cases = [
    {
      input: " https://rightsstatements.org/vocab/NoC-US/1.0\n",
      expected: "http://rightsstatements.org/vocab/NoC-US/1.0/",
    },
    {
      input: "http://creativecommons.org/publicdomain/zero/1.0",
      expected: "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    {
      input: "\thttp://creativecommons.org/publicdomain/mark/1.0/ ",
      expected: "https://creativecommons.org/publicdomain/mark/1.0/",
    },
  ];

  for (const { input, expected } of cases) {
    assert.equal(normalizeRightsUri(input), expected);
    assert.equal(isDisplayEligible(input), true);
  }
});

test("normalizes missing and blank rights to null and excludes them", () => {
  for (const rights of [null, "", " \t\n "]) {
    assert.equal(normalizeRightsUri(rights), null);
    assert.equal(isDisplayEligible(rights), false);
  }
});

test("excludes statements and near-matching URLs outside the allowlist", () => {
  const rightsValues = [
    "http://rightsstatements.org/vocab/UND/1.0/",
    "http://rightsstatements.org/vocab/InC/1.0/",
    "https://creativecommons.org/licenses/by/4.0/",
    "https://example.test/rights/",
    "https://creativecommons.org/publicdomain/zero/1.0/extra/",
    "https://creativecommons.org.example.test/publicdomain/zero/1.0/",
  ];

  for (const rights of rightsValues) {
    assert.equal(isDisplayEligible(rights), false, rights);
  }
});

test("preserves unknown rights statements without making them eligible", () => {
  const rights = " https://example.test/rights/custom ";

  assert.equal(
    normalizeRightsUri(rights),
    "https://example.test/rights/custom/",
  );
  assert.equal(isDisplayEligible(rights), false);
});

test("normalizing twice produces the same result as normalizing once", () => {
  const rightsValues = [
    ...allowedRights,
    " https://rightsstatements.org/vocab/UND/1.0 ",
    "http://creativecommons.org/publicdomain/zero/1.0",
    "https://example.test/rights/custom",
    " ",
    null,
  ];

  for (const rights of rightsValues) {
    const normalized = normalizeRightsUri(rights);
    assert.equal(normalizeRightsUri(normalized), normalized);
  }
});
