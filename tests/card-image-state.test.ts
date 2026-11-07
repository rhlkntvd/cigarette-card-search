import assert from "node:assert/strict";
import { test } from "node:test";

import { failImageRequest } from "../src/app/card-image-state.js";
import type { CardImageState } from "../src/app/card-image-state.js";

test("falls back to the working thumbnail size when a larger request fails", () => {
  const current: CardImageState = { status: "loading", size: 1024, attempt: 0 };

  assert.deepEqual(failImageRequest(current, 1024, 0), {
    status: "loading",
    size: 512,
    attempt: 0,
  });
});

test("stops after the fallback fails instead of retrying automatically forever", () => {
  const fallback = failImageRequest(
    { status: "loading", size: 1024, attempt: 0 },
    1024,
    0,
  );

  assert.deepEqual(failImageRequest(fallback, 512, 0), {
    status: "error",
    size: 512,
    attempt: 0,
  });
});

test("manual retries retain the fallback size when they fail", () => {
  const retry: CardImageState = { status: "loading", size: 512, attempt: 1 };

  assert.deepEqual(failImageRequest(retry, 512, 1), {
    status: "error",
    size: 512,
    attempt: 1,
  });
});

test("ignores failures from a previous size or retry attempt", () => {
  const fallback: CardImageState = { status: "loading", size: 512, attempt: 0 };
  const retry: CardImageState = { status: "loading", size: 512, attempt: 1 };

  assert.equal(failImageRequest(fallback, 1024, 0), fallback);
  assert.equal(failImageRequest(retry, 512, 0), retry);
});

test("ignores late timeouts after an image has loaded or already failed", () => {
  for (const status of ["loaded", "error"] as const) {
    const current: CardImageState = { status, size: 1024, attempt: 0 };
    assert.equal(failImageRequest(current, 1024, 0), current);
  }
});
