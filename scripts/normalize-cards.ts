import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { Card } from "../src/types/card.ts";

interface OriginalRecord {
  uuid: string;
  capture_image_ids: string[];
}

interface DplaDocument {
  id: string;
  isShownAt: string;
  rights?: string;
  originalRecord: {
    stringValue: string;
  };
  sourceResource: {
    title?: string[];
  };
}

interface DplaResponse {
  docs: DplaDocument[];
}

const raw = await readFile("data/raw/cigarette-cards.json", "utf8");

const data: DplaResponse = JSON.parse(raw);

const cards: Card[] = [];

for (const doc of data.docs) {
  const original: OriginalRecord = JSON.parse(doc.originalRecord.stringValue);

  const [frontImageId, backImageId] = original.capture_image_ids;

  if (!frontImageId) {
    console.warn(`Skipping ${doc.id}: no front image`);
    continue;
  }

  const card: Card = {
    dplaId: doc.id,
    title: doc.sourceResource.title?.[0] ?? "Untitled",
    nyplUuid: original.uuid,
    frontImageId,
    sourceUrl: doc.isShownAt,
    rights: doc.rights ?? null,

    ...(backImageId ? { backImageId } : {}),
  };

  cards.push(card);
}

await mkdir("data/processed", { recursive: true });

const jsonl = cards.map((card) => JSON.stringify(card)).join("\n") + "\n";

await writeFile("data/processed/cards.jsonl", jsonl);

console.log(`Normalized ${cards.length} cards`);
