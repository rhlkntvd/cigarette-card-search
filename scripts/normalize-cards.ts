import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { isDisplayEligible, normalizeRightsUri } from "../src/rights.js";

import type { Card } from "../src/types/card.js";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

const OUTPUT_PATH = path.resolve("data/processed/cards.jsonl");

const TEMP_OUTPUT_PATH = `${OUTPUT_PATH}.tmp`;

interface DplaRecord {
  id?: string;
  isShownAt?: string;
  rights?: string;

  sourceResource?: {
    title?: string[] | string;
  };

  originalRecord?: {
    stringValue?: string;
  };
}

interface OriginalRecord {
  uuid?: unknown;
  capture_image_ids?: unknown;

  solr_doc_hash?: {
    imageID?: unknown;
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseDplaRecord(line: string): DplaRecord | null {
  try {
    const parsed: unknown = JSON.parse(line);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    return parsed as DplaRecord;
  } catch {
    return null;
  }
}

function parseOriginalRecord(value: string): OriginalRecord | null {
  try {
    const parsed: unknown = JSON.parse(value);

    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    return parsed as OriginalRecord;
  } catch {
    return null;
  }
}

function getTitle(record: DplaRecord): string {
  const title = record.sourceResource?.title;

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

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const inputStream = createReadStream(INPUT_PATH, { encoding: "utf-8" });

  const lines = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  const outputFile = await fs.open(TEMP_OUTPUT_PATH, "w");

  let recordsReceived = 0;
  let cardsNormalized = 0;

  let invalidRawRecord = 0;
  let invalidOriginalRecord = 0;
  let missingDplaId = 0;
  let missingNyplUuid = 0;
  let missingFrontImage = 0;
  let missingSourceUrl = 0;
  let displayEligibleCount = 0;

  const rightsCounts = new Map<string, number>();

  try {
    for await (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      recordsReceived += 1;

      const doc = parseDplaRecord(line);

      if (doc === null) {
        invalidRawRecord += 1;
        continue;
      }

      if (!isNonEmptyString(doc.id)) {
        missingDplaId += 1;
        continue;
      }

      if (!isNonEmptyString(doc.isShownAt)) {
        missingSourceUrl += 1;
        continue;
      }

      const originalValue = doc.originalRecord?.stringValue;

      if (!isNonEmptyString(originalValue)) {
        invalidOriginalRecord += 1;
        continue;
      }

      const original = parseOriginalRecord(originalValue);

      if (original === null) {
        invalidOriginalRecord += 1;
        continue;
      }

      if (!isNonEmptyString(original.uuid)) {
        missingNyplUuid += 1;
        continue;
      }

      const captureIds = Array.isArray(original.capture_image_ids)
        ? original.capture_image_ids.filter(isNonEmptyString)
        : [];

      const fallbackImageId = isNonEmptyString(original.solr_doc_hash?.imageID)
        ? original.solr_doc_hash.imageID
        : undefined;

      const frontImageId = captureIds[0] ?? fallbackImageId;

      if (!isNonEmptyString(frontImageId)) {
        missingFrontImage += 1;
        continue;
      }

      const backImageId = captureIds[1];

      const rights = normalizeRightsUri(
        isNonEmptyString(doc.rights) ? doc.rights : null,
      );

      const displayEligible = isDisplayEligible(rights);

      if (displayEligible) {
        displayEligibleCount += 1;
      }

      const rightsKey = rights ?? "(missing)";

      rightsCounts.set(rightsKey, (rightsCounts.get(rightsKey) ?? 0) + 1);

      const card: Card = {
        dplaId: doc.id,
        title: getTitle(doc),
        nyplUuid: original.uuid,
        frontImageId,
        sourceUrl: doc.isShownAt,
        rights,
        displayEligible,
        ...(isNonEmptyString(backImageId) ? { backImageId } : {}),
      };

      await outputFile.write(JSON.stringify(card) + "\n");

      cardsNormalized += 1;
    }
  } finally {
    await outputFile.close();
  }

  await fs.rename(TEMP_OUTPUT_PATH, OUTPUT_PATH);

  console.log();
  console.log("Normalization complete");
  console.log("----------------------");
  console.log(`Records received: ${recordsReceived}`);
  console.log(`Cards normalized: ${cardsNormalized}`);
  console.log(`Display eligible: ${displayEligibleCount}`);

  console.log();
  console.log("Skipped records");
  console.log("----------------------");
  console.log(`Invalid raw record: ${invalidRawRecord}`);
  console.log(`Invalid original record: ${invalidOriginalRecord}`);
  console.log(`Missing DPLA ID: ${missingDplaId}`);
  console.log(`Missing NYPL UUID: ${missingNyplUuid}`);
  console.log(`Missing front image: ${missingFrontImage}`);
  console.log(`Missing source URL: ${missingSourceUrl}`);

  console.log();
  console.log("Rights distribution");
  console.log("----------------------");

  const sortedRights = [...rightsCounts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [rights, count] of sortedRights) {
    console.log(`${count}\t${rights}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
