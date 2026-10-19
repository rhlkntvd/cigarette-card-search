import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { isDisplayEligible } from "../src/rights.js";

const RAW_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

const PROCESSED_PATH = path.resolve("data/processed/cards.jsonl");

const EXPECTED_PROVIDER = "The New York Public Library";

const EXPECTED_COLLECTION = "Cigarette cards";

interface RawRecord {
  id?: unknown;

  provider?: {
    name?: unknown;
  };

  sourceResource?: {
    collection?: unknown;
  };
}

interface RawCollection {
  title?: unknown;
}

interface ProcessedCard {
  dplaId?: unknown;
  title?: unknown;
  nyplUuid?: unknown;
  frontImageId?: unknown;
  backImageId?: unknown;
  sourceUrl?: unknown;
  rights?: unknown;
  displayEligible?: unknown;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function forEachJsonl(
  filePath: string,
  callback: (value: unknown, lineNumber: number) => void,
) {
  const input = createReadStream(filePath, { encoding: "utf-8" });

  const lines = readline.createInterface({
    input,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;

    if (!line.trim()) {
      continue;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON in ${filePath} ` + `at line ${lineNumber}`);
    }

    callback(parsed, lineNumber);
  }
}

function hasExpectedCollection(record: RawRecord): boolean {
  const collection = record.sourceResource?.collection;

  if (Array.isArray(collection)) {
    return collection.some((item) => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      const candidate = item as RawCollection;

      return candidate.title === EXPECTED_COLLECTION;
    });
  }

  if (typeof collection === "object" && collection !== null) {
    const candidate = collection as RawCollection;

    return candidate.title === EXPECTED_COLLECTION;
  }

  return false;
}

async function main() {
  /*
   * Raw dataset checks
   */

  let rawCount = 0;
  let wrongProviderCount = 0;
  let wrongCollectionCount = 0;
  let missingRawDplaIdCount = 0;
  let duplicateRawDplaIdCount = 0;

  const rawDplaIds = new Set<string>();

  await forEachJsonl(RAW_PATH, (value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("Raw JSONL contains " + "a non-object record");
    }

    const record = value as RawRecord;

    rawCount += 1;

    if (record.provider?.name !== EXPECTED_PROVIDER) {
      wrongProviderCount += 1;
    }

    if (!hasExpectedCollection(record)) {
      wrongCollectionCount += 1;
    }

    if (!isNonEmptyString(record.id)) {
      missingRawDplaIdCount += 1;
    } else {
      if (rawDplaIds.has(record.id)) {
        duplicateRawDplaIdCount += 1;
      }

      rawDplaIds.add(record.id);
    }
  });

  /*
   * Processed dataset checks
   */

  let processedCount = 0;

  let missingProcessedDplaIdCount = 0;
  let missingNyplUuidCount = 0;
  let missingTitleCount = 0;
  let missingFrontImageIdCount = 0;
  let missingBackImageCount = 0;
  let invalidBackImageIdCount = 0;
  let missingSourceUrlCount = 0;

  let duplicateProcessedDplaIdCount = 0;
  let duplicateNyplUuidCount = 0;
  let duplicateFrontImageIdCount = 0;

  let displayEligibleCount = 0;
  let invalidRightsCount = 0;
  let invalidDisplayEligibilityCount = 0;
  let eligibilityMismatchCount = 0;

  let processedIdMissingFromRawCount = 0;

  const processedDplaIds = new Set<string>();

  const nyplUuids = new Set<string>();

  const frontImageIds = new Set<string>();

  const rightsCounts = new Map<string, number>();

  await forEachJsonl(PROCESSED_PATH, (value) => {
    if (typeof value !== "object" || value === null) {
      throw new Error("Processed JSONL contains " + "a non-object record");
    }

    const card = value as ProcessedCard;

    processedCount += 1;

    /*
     * Required fields
     */

    if (!isNonEmptyString(card.dplaId)) {
      missingProcessedDplaIdCount += 1;
    } else {
      if (processedDplaIds.has(card.dplaId)) {
        duplicateProcessedDplaIdCount += 1;
      }

      processedDplaIds.add(card.dplaId);

      if (!rawDplaIds.has(card.dplaId)) {
        processedIdMissingFromRawCount += 1;
      }
    }

    if (!isNonEmptyString(card.nyplUuid)) {
      missingNyplUuidCount += 1;
    } else {
      if (nyplUuids.has(card.nyplUuid)) {
        duplicateNyplUuidCount += 1;
      }

      nyplUuids.add(card.nyplUuid);
    }

    if (!isNonEmptyString(card.title)) {
      missingTitleCount += 1;
    }

    if (!isNonEmptyString(card.frontImageId)) {
      missingFrontImageIdCount += 1;
    } else {
      if (frontImageIds.has(card.frontImageId)) {
        duplicateFrontImageIdCount += 1;
      }

      frontImageIds.add(card.frontImageId);
    }

    if (card.backImageId === undefined) {
      missingBackImageCount += 1;
    } else if (!isNonEmptyString(card.backImageId)) {
      invalidBackImageIdCount += 1;
    }

    if (!isNonEmptyString(card.sourceUrl)) {
      missingSourceUrlCount += 1;
    }

    /*
     * Rights checks
     */

    if (card.rights !== null && !isNonEmptyString(card.rights)) {
      invalidRightsCount += 1;
    }

    const rights = isNonEmptyString(card.rights) ? card.rights : null;

    const rightsKey = rights ?? "(missing)";

    rightsCounts.set(rightsKey, (rightsCounts.get(rightsKey) ?? 0) + 1);

    const expectedEligibility = isDisplayEligible(rights);

    if (card.displayEligible === true) {
      displayEligibleCount += 1;
    }

    if (typeof card.displayEligible !== "boolean") {
      invalidDisplayEligibilityCount += 1;
    } else if (card.displayEligible !== expectedEligibility) {
      eligibilityMismatchCount += 1;
    }
  });

  /*
   * Report
   */

  console.log();
  console.log("Raw dataset");
  console.log("----------------------");

  console.log(`Records: ${rawCount}`);

  console.log(`Unique DPLA IDs: ${rawDplaIds.size}`);

  console.log(`Missing DPLA IDs: ${missingRawDplaIdCount}`);

  console.log(`Duplicate DPLA IDs: ${duplicateRawDplaIdCount}`);

  console.log(`Wrong provider: ${wrongProviderCount}`);

  console.log(`Wrong collection: ${wrongCollectionCount}`);

  console.log();
  console.log("Processed dataset");
  console.log("----------------------");

  console.log(`Cards: ${processedCount}`);

  console.log(`Unique DPLA IDs: ${processedDplaIds.size}`);

  console.log(`Unique NYPL UUIDs: ${nyplUuids.size}`);

  console.log(`Unique front image IDs: ${frontImageIds.size}`);

  console.log(`Missing DPLA IDs: ${missingProcessedDplaIdCount}`);

  console.log(`Missing NYPL UUIDs: ${missingNyplUuidCount}`);

  console.log(`Missing titles: ${missingTitleCount}`);

  console.log(`Missing front image IDs: ${missingFrontImageIdCount}`);

  console.log(`Missing back images: ${missingBackImageCount}`);

  console.log(`Invalid back image IDs: ${invalidBackImageIdCount}`);

  console.log(`Missing source URLs: ${missingSourceUrlCount}`);

  console.log(`Duplicate DPLA IDs: ${duplicateProcessedDplaIdCount}`);

  console.log(`Duplicate NYPL UUIDs: ${duplicateNyplUuidCount}`);

  console.log(`Duplicate front image IDs: ${duplicateFrontImageIdCount}`);

  console.log(
    `Processed IDs missing from raw: ` + `${processedIdMissingFromRawCount}`,
  );

  console.log();
  console.log("Rights");
  console.log("----------------------");

  console.log(`Display eligible: ${displayEligibleCount}`);

  console.log(`Invalid rights values: ${invalidRightsCount}`);

  console.log(
    `Invalid display eligibility values: ${invalidDisplayEligibilityCount}`,
  );

  console.log(`Eligibility mismatches: ${eligibilityMismatchCount}`);

  const sortedRights = [...rightsCounts.entries()].sort((a, b) => b[1] - a[1]);

  for (const [rights, count] of sortedRights) {
    console.log(`${count}\t${rights}`);
  }

  /*
   * Hard invariants
   */

  const errors: string[] = [];

  if (rawCount !== processedCount) {
    errors.push(
      `Raw count (${rawCount}) ` +
        `does not match processed count ` +
        `(${processedCount})`,
    );
  }

  if (missingRawDplaIdCount > 0) {
    errors.push("Raw dataset contains " + "missing DPLA IDs");
  }

  if (duplicateRawDplaIdCount > 0) {
    errors.push("Raw dataset contains " + "duplicate DPLA IDs");
  }

  if (wrongProviderCount > 0) {
    errors.push("Raw dataset contains " + "records from another provider");
  }

  if (wrongCollectionCount > 0) {
    errors.push(
      "Raw dataset contains " + "records outside the expected collection",
    );
  }

  if (missingProcessedDplaIdCount > 0) {
    errors.push("Processed dataset contains " + "missing DPLA IDs");
  }

  if (duplicateProcessedDplaIdCount > 0) {
    errors.push("Processed dataset contains " + "duplicate DPLA IDs");
  }

  if (missingNyplUuidCount > 0) {
    errors.push("Processed dataset contains " + "missing NYPL UUIDs");
  }

  if (duplicateNyplUuidCount > 0) {
    errors.push("Processed dataset contains " + "duplicate NYPL UUIDs");
  }

  if (missingTitleCount > 0) {
    errors.push("Processed dataset contains missing titles");
  }

  if (missingFrontImageIdCount > 0) {
    errors.push("Processed dataset contains " + "missing front image IDs");
  }

  if (missingSourceUrlCount > 0) {
    errors.push("Processed dataset contains " + "missing source URLs");
  }

  if (invalidBackImageIdCount > 0) {
    errors.push(
      "Processed dataset contains invalid back image IDs " +
        "(expected a nonempty string when present)",
    );
  }

  if (invalidRightsCount > 0) {
    errors.push(
      "Processed dataset contains invalid rights values " +
        "(expected a nonempty string or null)",
    );
  }

  if (invalidDisplayEligibilityCount > 0) {
    errors.push(
      "Processed dataset contains non-boolean display eligibility values",
    );
  }

  if (processedIdMissingFromRawCount > 0) {
    errors.push(
      "Processed dataset contains " + "records not present in raw data",
    );
  }

  if (eligibilityMismatchCount > 0) {
    errors.push(
      "Stored display eligibility " +
        "does not match the current rights policy",
    );
  }

  console.log();

  if (errors.length > 0) {
    console.error("Dataset verification failed.");

    for (const error of errors) {
      console.error(`- ${error}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log("Dataset verification passed.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
