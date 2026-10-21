import { createReadStream } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const INPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");
const SAMPLE_SIZE = 5;

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

async function main() {
  const input = createReadStream(INPUT_PATH, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  let lineNumber = 0;
  let inspected = 0;

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

      if (typeof originalValue !== "string" || !originalValue.trim()) {
        throw new Error(
          `Missing or invalid originalRecord.stringValue in ${context}`,
        );
      }

      const original = parseObject(
        originalValue,
        `originalRecord.stringValue in ${context}`,
      );
      const title = isObject(doc.sourceResource)
        ? doc.sourceResource.title
        : undefined;
      const solrDoc = isObject(original.solr_doc_hash)
        ? original.solr_doc_hash
        : undefined;

      console.log({
        title: Array.isArray(title) ? title[0] : title,
        uuid: original.uuid,
        imageId: solrDoc?.imageID,
        captureImageIds: original.capture_image_ids,
        thumbnailUrl: doc.object,
        sourceUrl: doc.isShownAt,
        rights: doc.rights,
      });

      inspected += 1;

      if (inspected >= SAMPLE_SIZE) {
        break;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
