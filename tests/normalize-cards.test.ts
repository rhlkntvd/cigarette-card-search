import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeRecord } from "../src/normalize.js";

const normalizerPath = fileURLToPath(
  new URL("../scripts/normalize-cards.ts", import.meta.url),
);
const previousDataset = '{"dplaId":"previous-card"}\n';
const record = {
  id: "dpla-id",
  isShownAt: "https://digitalcollections.nypl.org/items/nypl-uuid",
  sourceResource: { title: ["Butterfly"] },
  originalRecord: {
    stringValue: JSON.stringify({
      uuid: "nypl-uuid",
      capture_image_ids: ["123"],
    }),
  },
};

async function normalizeDataset(raw: string | null) {
  const directory = await mkdtemp(path.join(tmpdir(), "normalize-cards-"));

  try {
    const inputPath = path.join(directory, "data/raw/cigarette-cards.jsonl");
    const outputPath = path.join(directory, "data/processed/cards.jsonl");
    await mkdir(path.dirname(inputPath), { recursive: true });
    await mkdir(path.dirname(outputPath), { recursive: true });
    if (raw !== null) {
      await writeFile(inputPath, raw);
    }
    await writeFile(outputPath, previousDataset);

    const result = spawnSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), normalizerPath],
      { cwd: directory, encoding: "utf8", timeout: 10_000 },
    );

    assert.ifError(result.error);
    return { ...result, dataset: await readFile(outputPath, "utf8") };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("keeps the published dataset when input is empty or entirely invalid", async () => {
  for (const raw of ["", " \n\t\n", "not JSON\nnull\n[]\n{}\n"]) {
    const result = await normalizeDataset(raw);

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /No cards were normalized/);
    assert.equal(result.dataset, previousDataset);
  }
});

test("keeps the published dataset when the input file is missing", async () => {
  const result = await normalizeDataset(null);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /ENOENT/);
  assert.equal(result.dataset, previousDataset);
});

test("publishes valid cards in source order and still reports skipped records", async () => {
  const secondRecord = { ...record, id: "second-card" };
  const result = await normalizeDataset(
    [
      JSON.stringify(record),
      "not JSON",
      "{}",
      JSON.stringify(secondRecord),
    ].join("\n"),
  );
  const first = normalizeRecord(record);
  const second = normalizeRecord(secondRecord);
  assert.ok(first.ok && second.ok);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(
    result.dataset,
    [first.card, second.card]
      .map((card) => JSON.stringify(card) + "\n")
      .join(""),
  );
  assert.match(result.stdout, /Records received: 4/);
  assert.match(result.stdout, /Cards normalized: 2/);
  assert.match(result.stdout, /Invalid raw record: 1/);
  assert.match(result.stdout, /Missing DPLA ID: 1/);
});
