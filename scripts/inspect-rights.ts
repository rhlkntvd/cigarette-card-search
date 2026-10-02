import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

interface DplaRecord {
  id?: string;
  rights?: string;

  sourceResource?: {
    title?: string[] | string;
  };

  originalRecord?: {
    stringValue?: string;
  };
}

function getTitle(record: DplaRecord): string {
  const title = record.sourceResource?.title;

  if (typeof title === "string" && title.length > 0) {
    return title;
  }

  if (Array.isArray(title)) {
    return title[0] ?? "Untitled";
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

function inspectRecord(record: DplaRecord): void {
  console.log();
  console.log("==============================");
  console.log(getTitle(record));
  console.log(`DPLA rights: ${record.rights ?? "(missing)"}`);
  console.log("==============================");

  const originalValue = record.originalRecord?.stringValue;

  if (!originalValue) {
    console.log("No original record");
    return;
  }

  try {
    const original: unknown = JSON.parse(originalValue);

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

  let undRecord: DplaRecord | null = null;
  let noCopyrightRecord: DplaRecord | null = null;

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }

    let record: DplaRecord;

    try {
      record = JSON.parse(line) as DplaRecord;
    } catch {
      continue;
    }

    if (undRecord === null && record.rights?.includes("/UND/")) {
      undRecord = record;
    }

    if (noCopyrightRecord === null && record.rights?.includes("/NoC-US/")) {
      noCopyrightRecord = record;
    }

    if (undRecord !== null && noCopyrightRecord !== null) {
      break;
    }
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
