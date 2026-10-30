import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

interface Sample {
  record: Record<string, unknown>;
  context: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(json: string, context: string): Record<string, unknown> {
  let value: unknown;

  try {
    value = JSON.parse(json);
  } catch (error: unknown) {
    throw new Error(`Invalid JSON in ${context}`, { cause: error });
  }

  if (!isObject(value)) {
    throw new Error(`Expected a JSON object in ${context}`);
  }

  return value;
}

function getTitle(record: Record<string, unknown>): string {
  const title = isObject(record.sourceResource)
    ? record.sourceResource.title
    : undefined;

  if (typeof title === "string" && title.length > 0) {
    return title;
  }

  if (Array.isArray(title)) {
    const firstTitle: unknown = title[0];
    return typeof firstTitle === "string" && firstTitle.length > 0
      ? firstTitle
      : "Untitled";
  }

  return "Untitled";
}

function findRightsFields(value: unknown, currentPath = ""): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      findRightsFields(item, `${currentPath}[${index}]`);
    });

    return;
  }

  if (typeof value !== "object" || value === null) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPath = currentPath ? `${currentPath}.${key}` : key;

    const normalizedKey = key.toLowerCase();

    if (
      normalizedKey.includes("right") ||
      normalizedKey.includes("copyright") ||
      normalizedKey.includes("public") ||
      normalizedKey.includes("domain")
    ) {
      console.log(`  ${childPath}:`, child);
    }

    findRightsFields(child, childPath);
  }
}

function inspectRecord({ record, context }: Sample): void {
  console.log();
  console.log("==============================");
  console.log(getTitle(record));
  console.log(`DPLA rights: ${record.rights ?? "(missing)"}`);
  console.log("==============================");

  const originalValue = isObject(record.originalRecord)
    ? record.originalRecord.stringValue
    : undefined;

  if (typeof originalValue !== "string" || !originalValue.trim()) {
    console.log(`Missing or invalid originalRecord.stringValue in ${context}`);
    return;
  }

  try {
    const original = parseObject(
      originalValue,
      `originalRecord.stringValue in ${context}`,
    );

    findRightsFields(original);
  } catch (error) {
    console.log("Could not parse original record:", error);
  }
}

async function main() {
  const inputStream = createReadStream(INPUT_PATH, { encoding: "utf-8" });

  const lines = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let undRecord: Sample | null = null;
  let noCopyrightRecord: Sample | null = null;
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;

      if (line.trim().length === 0) {
        continue;
      }

      const context = `${INPUT_PATH} at line ${lineNumber}`;
      const record = parseObject(line, context);
      const rights = record.rights;

      if (rights === undefined || rights === null) {
        continue;
      }

      if (typeof rights !== "string") {
        throw new Error(`Expected rights to be a string in ${context}`);
      }

      if (undRecord === null && rights.includes("/UND/")) {
        undRecord = { record, context };
      }

      if (noCopyrightRecord === null && rights.includes("/NoC-US/")) {
        noCopyrightRecord = { record, context };
      }

      if (undRecord !== null && noCopyrightRecord !== null) {
        break;
      }
    }
  } finally {
    lines.close();
    inputStream.destroy();
  }

  if (undRecord !== null) {
    inspectRecord(undRecord);
  }

  if (noCopyrightRecord !== null) {
    inspectRecord(noCopyrightRecord);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
