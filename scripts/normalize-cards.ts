import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import { normalizeRecord } from "../src/normalize.js";
import type { NormalizationSkipReason } from "../src/normalize.js";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

const OUTPUT_PATH = path.resolve("data/processed/cards.jsonl");

const TEMP_OUTPUT_PATH = `${OUTPUT_PATH}.tmp`;

async function main() {
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const outputFile = await fs.open(TEMP_OUTPUT_PATH, "w");

  const inputStream = createReadStream(INPUT_PATH, { encoding: "utf-8" });

  const lines = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let recordsReceived = 0;
  let cardsNormalized = 0;

  const skipped: Record<NormalizationSkipReason, number> = {
    invalidRawRecord: 0,
    invalidOriginalRecord: 0,
    missingDplaId: 0,
    missingNyplUuid: 0,
    missingFrontImage: 0,
    missingSourceUrl: 0,
  };
  let displayEligibleCount = 0;

  const rightsCounts = new Map<string, number>();

  try {
    for await (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }

      recordsReceived += 1;

      let record: unknown;

      try {
        record = JSON.parse(line);
      } catch {
        skipped.invalidRawRecord += 1;
        continue;
      }

      const result = normalizeRecord(record);

      if (!result.ok) {
        skipped[result.reason] += 1;
        continue;
      }

      const { card } = result;

      if (card.displayEligible) {
        displayEligibleCount += 1;
      }

      const rightsKey = card.rights ?? "(missing)";

      rightsCounts.set(rightsKey, (rightsCounts.get(rightsKey) ?? 0) + 1);

      await outputFile.write(JSON.stringify(card) + "\n");

      cardsNormalized += 1;
    }
  } finally {
    lines.close();
    inputStream.destroy();
    await outputFile.close();
  }

  if (cardsNormalized === 0) {
    throw new Error(
      `No cards were normalized from ${recordsReceived} records; ` +
        "keeping the published dataset",
    );
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
  console.log(`Invalid raw record: ${skipped.invalidRawRecord}`);
  console.log(`Invalid original record: ${skipped.invalidOriginalRecord}`);
  console.log(`Missing DPLA ID: ${skipped.missingDplaId}`);
  console.log(`Missing NYPL UUID: ${skipped.missingNyplUuid}`);
  console.log(`Missing front image: ${skipped.missingFrontImage}`);
  console.log(`Missing source URL: ${skipped.missingSourceUrl}`);

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
