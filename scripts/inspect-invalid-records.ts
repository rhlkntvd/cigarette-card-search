import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

interface DplaRecord {
  id?: string;
  isShownAt?: string;

  provider?: {
    name?: string;
  };

  sourceResource?: {
    title?: string[] | string;
  };

  originalRecord?: {
    stringValue?: unknown;
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

async function main() {
  const inputStream = createReadStream(INPUT_PATH, { encoding: "utf-8" });

  const lines = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let invalidCount = 0;

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let doc: DplaRecord;

    try {
      doc = JSON.parse(line) as DplaRecord;
    } catch {
      continue;
    }

    const originalValue = doc.originalRecord?.stringValue;

    let reason: string | null = null;

    if (
      typeof originalValue !== "string" ||
      originalValue.trim().length === 0
    ) {
      reason = "Missing or non-string " + "originalRecord.stringValue";
    } else {
      try {
        const parsed: unknown = JSON.parse(originalValue);

        if (typeof parsed !== "object" || parsed === null) {
          reason =
            "originalRecord.stringValue " + "parsed but was not an object";
        }
      } catch (error) {
        reason =
          error instanceof Error
            ? `JSON parse error: ${error.message}`
            : "Unknown JSON parse error";
      }
    }

    if (reason === null) {
      continue;
    }

    invalidCount += 1;

    console.log();
    console.log("==============================");
    console.log(`Record ${invalidCount}`);
    console.log("==============================");
    console.log(`DPLA ID: ${doc.id ?? "(missing)"}`);
    console.log(`Title: ${getTitle(doc)}`);
    console.log(`Provider: ${doc.provider?.name ?? "(missing)"}`);
    console.log(`Source: ${doc.isShownAt ?? "(missing)"}`);
    console.log(`Reason: ${reason}`);

    console.log();
    console.log("originalRecord.stringValue:");
    console.log(originalValue);
  }

  console.log();
  console.log(`Found ${invalidCount} ` + `invalid original records.`);
  console.log();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
