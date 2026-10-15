import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRecord } from "../src/normalize.js";

function makeRecord(originalOverrides: Record<string, unknown> = {}) {
  return {
    id: "dpla-id",
    isShownAt: "https://digitalcollections.nypl.org/items/nypl-uuid",
    rights: " https://rightsstatements.org/vocab/NoC-US/1.0 ",
    sourceResource: { title: ["A blue butterfly"] },
    originalRecord: {
      stringValue: JSON.stringify({
        uuid: "nypl-uuid",
        capture_image_ids: ["front-id", "back-id"],
        solr_doc_hash: { imageID: "fallback-id" },
        ...originalOverrides,
      }),
    },
  };
}

test("normalizes a complete record without mutating its input", () => {
  const record = makeRecord();
  const before = structuredClone(record);

  assert.deepEqual(normalizeRecord(record), {
    ok: true,
    card: {
      dplaId: "dpla-id",
      title: "A blue butterfly",
      nyplUuid: "nypl-uuid",
      frontImageId: "front-id",
      sourceUrl: "https://digitalcollections.nypl.org/items/nypl-uuid",
      rights: "http://rightsstatements.org/vocab/NoC-US/1.0/",
      displayEligible: true,
      backImageId: "back-id",
    },
  });
  assert.deepEqual(record, before);
});

test("selects the first nonblank title and preserves source text", () => {
  for (const title of [
    "  Butterfly  ",
    [null, " ", 12, "  Butterfly  ", "Other"],
  ]) {
    const record = { ...makeRecord(), sourceResource: { title } };
    const result = normalizeRecord(record);

    assert.ok(result.ok);
    assert.equal(result.card.title, "  Butterfly  ");
  }
});

test("uses Untitled when the source title is missing or unusable", () => {
  for (const sourceResource of [
    undefined,
    null,
    12,
    {},
    { title: [] },
    { title: " " },
  ]) {
    const result = normalizeRecord({ ...makeRecord(), sourceResource });

    assert.ok(result.ok);
    assert.equal(result.card.title, "Untitled");
  }
});

test("filters invalid capture IDs while preserving valid capture order", () => {
  const result = normalizeRecord(
    makeRecord({ capture_image_ids: [null, " ", 12, "front-id", "back-id"] }),
  );

  assert.ok(result.ok);
  assert.equal(result.card.frontImageId, "front-id");
  assert.equal(result.card.backImageId, "back-id");
});

test("falls back to the original image ID when there are no valid capture IDs", () => {
  for (const capture_image_ids of [
    undefined,
    null,
    "invalid",
    [],
    [null, " "],
  ]) {
    const result = normalizeRecord(makeRecord({ capture_image_ids }));

    assert.ok(result.ok);
    assert.equal(result.card.frontImageId, "fallback-id");
    assert.equal(Object.hasOwn(result.card, "backImageId"), false);
  }
});

test("omits the back image when there is only one capture", () => {
  const result = normalizeRecord(
    makeRecord({ capture_image_ids: ["front-id"] }),
  );

  assert.ok(result.ok);
  assert.equal(Object.hasOwn(result.card, "backImageId"), false);
});

test("keeps uncertain rights ineligible and missing or malformed rights null", () => {
  for (const rights of [undefined, null, " ", 12]) {
    const result = normalizeRecord({ ...makeRecord(), rights });

    assert.ok(result.ok);
    assert.equal(result.card.rights, null);
    assert.equal(result.card.displayEligible, false);
  }

  const result = normalizeRecord({
    ...makeRecord(),
    rights: "https://rightsstatements.org/vocab/UND/1.0",
  });

  assert.ok(result.ok);
  assert.equal(
    result.card.rights,
    "http://rightsstatements.org/vocab/UND/1.0/",
  );
  assert.equal(result.card.displayEligible, false);
});

test("returns the existing skip reasons for malformed records", () => {
  for (const record of [undefined, null, false, 12, "not an object"]) {
    assert.deepEqual(normalizeRecord(record), {
      ok: false,
      reason: "invalidRawRecord",
    });
  }

  for (const id of [undefined, null, " ", 12]) {
    assert.deepEqual(normalizeRecord({ ...makeRecord(), id }), {
      ok: false,
      reason: "missingDplaId",
    });
  }

  for (const isShownAt of [undefined, null, " ", 12]) {
    assert.deepEqual(normalizeRecord({ ...makeRecord(), isShownAt }), {
      ok: false,
      reason: "missingSourceUrl",
    });
  }

  for (const originalRecord of [
    undefined,
    null,
    {},
    { stringValue: 12 },
    { stringValue: " " },
    { stringValue: "not JSON" },
    { stringValue: "null" },
    { stringValue: "12" },
  ]) {
    assert.deepEqual(normalizeRecord({ ...makeRecord(), originalRecord }), {
      ok: false,
      reason: "invalidOriginalRecord",
    });
  }

  for (const uuid of [undefined, null, " ", 12]) {
    assert.deepEqual(normalizeRecord(makeRecord({ uuid })), {
      ok: false,
      reason: "missingNyplUuid",
    });
  }

  assert.deepEqual(
    normalizeRecord(makeRecord({ capture_image_ids: [], solr_doc_hash: null })),
    { ok: false, reason: "missingFrontImage" },
  );
});

test("preserves rejection precedence when multiple required fields are missing", () => {
  assert.deepEqual(normalizeRecord({}), { ok: false, reason: "missingDplaId" });
  assert.deepEqual(normalizeRecord({ id: "dpla-id" }), {
    ok: false,
    reason: "missingSourceUrl",
  });
});
