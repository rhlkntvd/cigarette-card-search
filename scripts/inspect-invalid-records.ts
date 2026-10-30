import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

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

async function main() {
  const inputStream = createReadStream(INPUT_PATH, { encoding: "utf-8" });

  const lines = readline.createInterface({
    input: inputStream,
    crlfDelay: Infinity,
  });

  let invalidCount = 0;
  let lineNumber = 0;

  try {
    for await (const line of lines) {
      lineNumber += 1;

      if (!line.trim()) {
        continue;
      }

      const context = `${INPUT_PATH} at line ${lineNumber}`;
      const doc = parseObject(line, context);
      const originalValue = isObject(doc.originalRecord)
        ? doc.originalRecord.stringValue
        : undefined;

      let reason: string | null = null;

      if (
        typeof originalValue !== "string" ||
        originalValue.trim().length === 0
      ) {
        reason = "Missing or non-string originalRecord.stringValue";
      } else {
        try {
          const parsed: unknown = JSON.parse(originalValue);

          if (!isObject(parsed)) {
            reason = "originalRecord.stringValue parsed but was not an object";
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
      console.log(`Location: ${context}`);
      console.log(`Record ${invalidCount}`);
      console.log("==============================");
      console.log(`DPLA ID: ${doc.id ?? "(missing)"}`);
      console.log(`Title: ${getTitle(doc)}`);
      const provider = isObject(doc.provider) ? doc.provider.name : undefined;
      console.log(`Provider: ${provider ?? "(missing)"}`);
      console.log(`Source: ${doc.isShownAt ?? "(missing)"}`);
      console.log(`Reason: ${reason}`);

      console.log();
      console.log("originalRecord.stringValue:");
      console.log(originalValue);
    }
  } finally {
    lines.close();
    inputStream.destroy();
  }

  console.log();
  console.log(`Found ${invalidCount} ` + `invalid original records.`);
  console.log();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
