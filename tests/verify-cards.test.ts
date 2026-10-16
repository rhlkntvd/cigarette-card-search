import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const verifierPath = fileURLToPath(
  new URL("../scripts/verify-cards.ts", import.meta.url),
);

async function verifyTitle(title: unknown) {
  const directory = await mkdtemp(path.join(tmpdir(), "verify-cards-"));

  try {
    const rawDirectory = path.join(directory, "data/raw");
    const processedDirectory = path.join(directory, "data/processed");
    await mkdir(rawDirectory, { recursive: true });
    await mkdir(processedDirectory, { recursive: true });

    const rawRecord = {
      id: "dpla-id",
      provider: { name: "The New York Public Library" },
      sourceResource: { collection: [{ title: "Cigarette cards" }] },
    };

    const card = {
      dplaId: "dpla-id",
      title,
      nyplUuid: "nypl-uuid",
      frontImageId: "front-id",
      sourceUrl: "https://digitalcollections.nypl.org/items/nypl-uuid",
      rights: null,
      displayEligible: false,
    };

    await writeFile(
      path.join(rawDirectory, "cigarette-cards.jsonl"),
      JSON.stringify(rawRecord) + "\n",
    );
    await writeFile(
      path.join(processedDirectory, "cards.jsonl"),
      JSON.stringify(card) + "\n",
    );

    const result = spawnSync(
      process.execPath,
      ["--import", import.meta.resolve("tsx"), verifierPath],
      { cwd: directory, encoding: "utf8", timeout: 10_000 },
    );

    assert.ifError(result.error);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("rejects a missing title with a failing exit status", async () => {
  const result = await verifyTitle(undefined);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Missing titles: 1/);
  assert.match(result.stderr, /Processed dataset contains missing titles/);
  assert.match(result.stderr, /Dataset verification failed/);
});

test("rejects blank and non-string titles", async (t) => {
  const cases = [
    { name: "empty string", title: "" },
    { name: "whitespace", title: " \t " },
    { name: "null", title: null },
    { name: "number", title: 42 },
    { name: "array", title: ["Butterfly"] },
    { name: "object", title: { value: "Butterfly" } },
  ];

  for (const { name, title } of cases) {
    await t.test(name, async () => {
      const result = await verifyTitle(title);

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stdout, /Missing titles: 1/);
      assert.match(result.stderr, /Processed dataset contains missing titles/);
    });
  }
});

test("accepts nonblank titles including the normalizer's Untitled fallback", async () => {
  for (const title of ["A blue butterfly", "Untitled", "  Butterfly  "]) {
    const result = await verifyTitle(title);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Missing titles: 0/);
    assert.match(result.stdout, /Dataset verification passed/);
  }
});
