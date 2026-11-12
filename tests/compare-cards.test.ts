import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(
  new URL("../scripts/compare-cards.ts", import.meta.url),
);
const first = {
  dplaId: "first",
  frontImageId: "123",
  rights: null,
  displayEligible: false,
  title: "Butterfly",
};
const second = { ...first, dplaId: "second", frontImageId: "456" };

function jsonl(records: unknown[]) {
  return records.map((record) => JSON.stringify(record) + "\n").join("");
}

async function compare(previous: string, current: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "compare-cards-"));
  try {
    const previousPath = path.join(directory, "previous.jsonl");
    const currentPath = path.join(directory, "current.jsonl");
    await writeFile(previousPath, previous);
    await writeFile(currentPath, current);
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        script,
        previousPath,
        currentPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.ifError(result.error);
    assert.equal(await readFile(previousPath, "utf8"), previous);
    assert.equal(await readFile(currentPath, "utf8"), current);
    return result;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("recognizes identical snapshots despite whitespace and JSON key order", async () => {
  const reversed = Object.fromEntries(Object.entries(first).reverse());
  const result = await compare(
    jsonl([first, second]),
    "\n" + jsonl([reversed, second]),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Identical normalized snapshots: yes/);
  assert.match(result.stdout, /Changed records: 0/);
});

test("reports additions, removals, image, rights, eligibility, and metadata changes", async () => {
  const result = await compare(
    jsonl([first, second]),
    jsonl([
      {
        ...first,
        frontImageId: "789",
        rights: "new-rights",
        displayEligible: true,
        title: "Blue butterfly",
      },
      { ...second, dplaId: "third" },
    ]),
  );
  assert.equal(result.status, 0, result.stderr);
  for (const message of [
    "Previous cards: 2",
    "Current cards: 2",
    "Added: 1",
    "Removed: 1",
    "Changed records: 1",
    "Changed frontImageId: 1",
    "Changed rights: 1",
    "Changed displayEligible: 1",
    "Changed title: 1",
    "Previous display eligible: 0",
    "Current display eligible: 1",
    "Same ID sequence: no",
    "Identical normalized snapshots: no",
    "third",
    "second",
    "first (",
  ]) {
    assert.ok(result.stdout.includes(message), message + "\n" + result.stdout);
  }
});

test("detects reordered records when their contents are unchanged", async () => {
  const result = await compare(jsonl([first, second]), jsonl([second, first]));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Changed records: 0/);
  assert.match(result.stdout, /Same ID sequence: no/);
  assert.match(result.stdout, /Identical normalized snapshots: no/);
});

test("keeps large comparisons concise while reporting the complete counts", async () => {
  const records = Array.from({ length: 15 }, (_, index) => ({
    ...first,
    dplaId: `new-${index}`,
  }));
  const result = await compare(jsonl([first]), jsonl(records));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Added: 15/);
  assert.match(result.stdout, /new-9\n/);
  assert.doesNotMatch(result.stdout, /new-10/);
});

test("rejects malformed, duplicate, and empty snapshots with useful context", async () => {
  for (const [input, message] of [
    ["\nnot JSON\n", /Invalid JSON .*previous\.jsonl at line 2/],
    ["[]\n", /Expected a normalized card/],
    [
      jsonl([{ ...first, displayEligible: "false" }]),
      /Expected a normalized card/,
    ],
    [jsonl([first, first]), /Duplicate DPLA ID first .*line 2/],
    [" \n", /Snapshot is empty/],
  ] as const) {
    const result = await compare(input, jsonl([first]));
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, message);
  }
});
