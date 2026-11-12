import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { isDeepStrictEqual } from "node:util";

type Snapshot = Map<string, Record<string, unknown>>;
const EXAMPLE_LIMIT = 10;

async function loadSnapshot(filePath: string): Promise<Snapshot> {
  const cards: Snapshot = new Map();
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) {
        continue;
      }

      const context = `${filePath} at line ${lineNumber}`;
      let card: unknown;
      try {
        card = JSON.parse(line);
      } catch (error: unknown) {
        throw new Error(`Invalid JSON in ${context}`, { cause: error });
      }

      if (
        typeof card !== "object" ||
        card === null ||
        Array.isArray(card) ||
        !("dplaId" in card) ||
        typeof card.dplaId !== "string" ||
        !card.dplaId.trim() ||
        !("frontImageId" in card) ||
        typeof card.frontImageId !== "string" ||
        !card.frontImageId.trim() ||
        !("displayEligible" in card) ||
        typeof card.displayEligible !== "boolean"
      ) {
        throw new Error(
          "Expected a normalized card with dplaId, frontImageId, " +
            `and boolean displayEligible in ${context}`,
        );
      }

      if (cards.has(card.dplaId)) {
        throw new Error(`Duplicate DPLA ID ${card.dplaId} in ${context}`);
      }
      cards.set(card.dplaId, card);
    }
  } finally {
    lines.close();
    input.destroy();
  }

  if (cards.size === 0) {
    throw new Error(`Snapshot is empty: ${filePath}`);
  }
  return cards;
}

async function main() {
  const [previousPath, currentPath, ...extra] = process.argv.slice(2);
  if (!previousPath || !currentPath || extra.length > 0) {
    throw new Error(
      "Usage: npm run compare:cards -- <previous.jsonl> <current.jsonl>",
    );
  }

  const [previous, current] = await Promise.all([
    loadSnapshot(path.resolve(previousPath)),
    loadSnapshot(path.resolve(currentPath)),
  ]);
  const added = [...current.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  const changed: string[] = [];
  const fieldCounts = new Map<string, number>();

  for (const [id, card] of current) {
    const before = previous.get(id);
    if (!before) {
      continue;
    }
    const fields = [
      ...new Set([...Object.keys(before), ...Object.keys(card)]),
    ].filter((field) => !isDeepStrictEqual(before[field], card[field]));
    if (fields.length > 0) {
      changed.push(`${id} (${fields.join(", ")})`);
      for (const field of fields) {
        fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
      }
    }
  }

  const previousIds = [...previous.keys()];
  const currentIds = [...current.keys()];
  const sameOrder =
    previousIds.length === currentIds.length &&
    previousIds.every((id, index) => id === currentIds[index]);
  const previousEligible = [...previous.values()].filter(
    (card) => card.displayEligible === true,
  ).length;
  const currentEligible = [...current.values()].filter(
    (card) => card.displayEligible === true,
  ).length;
  const identical = sameOrder && changed.length === 0;

  console.log(`Previous cards: ${previous.size}`);
  console.log(`Current cards: ${current.size}`);
  console.log(`Previous display eligible: ${previousEligible}`);
  console.log(`Current display eligible: ${currentEligible}`);
  console.log(`Added: ${added.length}`);
  console.log(`Removed: ${removed.length}`);
  console.log(`Changed records: ${changed.length}`);
  console.log(`Same ID sequence: ${sameOrder ? "yes" : "no"}`);
  console.log(`Identical normalized snapshots: ${identical ? "yes" : "no"}`);

  const sortedFields = [...fieldCounts].sort(([a], [b]) => a.localeCompare(b));
  for (const [field, count] of sortedFields) {
    console.log(`Changed ${field}: ${count}`);
  }
  const examples = [
    ["Added", added],
    ["Removed", removed],
    ["Changed", changed],
  ] as const;
  for (const [label, records] of examples) {
    if (records.length === 0) {
      continue;
    }
    console.log(`\n${label} examples (up to ${EXAMPLE_LIMIT})`);
    for (const record of records.slice(0, EXAMPLE_LIMIT)) {
      console.log(record);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
