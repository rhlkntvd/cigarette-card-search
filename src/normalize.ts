import { isDisplayEligible, normalizeRightsUri } from "./rights.js";
import type { Card } from "./types/card.js";

export type NormalizationSkipReason =
  | "invalidRawRecord"
  | "invalidOriginalRecord"
  | "missingDplaId"
  | "missingNyplUuid"
  | "missingFrontImage"
  | "missingSourceUrl";

export type NormalizationResult =
  | { ok: true; card: Card }
  | { ok: false; reason: NormalizationSkipReason };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getTitle(title: unknown): string {
  if (isNonEmptyString(title)) {
    return title;
  }

  if (Array.isArray(title)) {
    const firstTitle = title.find(isNonEmptyString);

    if (firstTitle !== undefined) {
      return firstTitle;
    }
  }

  return "Untitled";
}

export function normalizeRecord(record: unknown): NormalizationResult {
  if (!isObject(record)) {
    return { ok: false, reason: "invalidRawRecord" };
  }

  if (!isNonEmptyString(record.id)) {
    return { ok: false, reason: "missingDplaId" };
  }

  if (!isNonEmptyString(record.isShownAt)) {
    return { ok: false, reason: "missingSourceUrl" };
  }

  const originalValue = isObject(record.originalRecord)
    ? record.originalRecord.stringValue
    : undefined;

  if (!isNonEmptyString(originalValue)) {
    return { ok: false, reason: "invalidOriginalRecord" };
  }

  let original: unknown;

  try {
    original = JSON.parse(originalValue);
  } catch {
    return { ok: false, reason: "invalidOriginalRecord" };
  }

  if (!isObject(original)) {
    return { ok: false, reason: "invalidOriginalRecord" };
  }

  if (!isNonEmptyString(original.uuid)) {
    return { ok: false, reason: "missingNyplUuid" };
  }

  const captureIds = Array.isArray(original.capture_image_ids)
    ? original.capture_image_ids.filter(isNonEmptyString)
    : [];

  const fallbackValue = isObject(original.solr_doc_hash)
    ? original.solr_doc_hash.imageID
    : undefined;

  const fallbackImageId = isNonEmptyString(fallbackValue)
    ? fallbackValue
    : undefined;

  const frontImageId = captureIds[0] ?? fallbackImageId;

  if (!isNonEmptyString(frontImageId)) {
    return { ok: false, reason: "missingFrontImage" };
  }

  const backImageId = captureIds[1];
  const title = isObject(record.sourceResource)
    ? record.sourceResource.title
    : undefined;

  const rights = normalizeRightsUri(
    isNonEmptyString(record.rights) ? record.rights : null,
  );

  const card: Card = {
    dplaId: record.id,
    title: getTitle(title),
    nyplUuid: original.uuid,
    frontImageId,
    sourceUrl: record.isShownAt,
    rights,
    displayEligible: isDisplayEligible(rights),
    ...(isNonEmptyString(backImageId) ? { backImageId } : {}),
  };

  return { ok: true, card };
}
