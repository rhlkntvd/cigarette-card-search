import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const fetcherPath = fileURLToPath(
  new URL("../scripts/fetch-cards.ts", import.meta.url),
);
const previousDataset = '{"id":"previous-card"}\n';
const testApiKey = "test-api-key";

type Scenario =
  | "success"
  | "transport"
  | "http"
  | "invalid-json"
  | "invalid-response"
  | "request-timeout"
  | "body-timeout"
  | "second-page-failure";

async function fetchDataset(scenario: Scenario) {
  const directory = await mkdtemp(path.join(tmpdir(), "fetch-cards-"));

  try {
    const outputPath = path.join(directory, "data/raw/cigarette-cards.jsonl");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, previousDataset);

    const preloadPath = path.join(directory, "mock-fetch.mjs");
    await writeFile(
      preloadPath,
      `
import assert from "node:assert/strict";

const scenario = ${JSON.stringify(scenario)};
let controller;

AbortSignal.timeout = (milliseconds) => {
  assert.equal(milliseconds, 30_000);
  controller = new AbortController();
  return controller.signal;
};

globalThis.fetch = async (input, options) => {
  const url = new URL(input);
  assert.equal(url.origin + url.pathname, "https://api.dp.la/v2/items");
  assert.equal(url.searchParams.get("sourceResource.collection.title"), "Cigarette cards");
  assert.equal(url.searchParams.get("provider.name"), "The New York Public Library");
  assert.equal(url.searchParams.get("exact_field_match"), "true");
  assert.equal(url.searchParams.get("sort_by"), "id");
  assert.equal(url.searchParams.get("page_size"), "500");
  assert.equal(url.searchParams.get("api_key"), process.env.DPLA_API_KEY);
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.signal, controller.signal);

  const page = Number(url.searchParams.get("page"));

  if (scenario === "transport" || (scenario === "second-page-failure" && page === 2)) {
    throw new TypeError("Network unavailable");
  }
  if (scenario === "http") {
    return new Response("Unavailable", { status: 503, statusText: "Service Unavailable" });
  }
  if (scenario === "invalid-json") {
    return new Response("not JSON");
  }
  if (scenario === "invalid-response") {
    return Response.json({ count: 1, docs: null });
  }
  if (scenario === "request-timeout" || scenario === "body-timeout") {
    const error = new DOMException("Deadline exceeded", "TimeoutError");
    if (scenario === "request-timeout") {
      controller.abort(error);
      throw error;
    }
    return new Response(new ReadableStream({
      pull(streamController) {
        controller.abort(error);
        streamController.error(error);
      },
    }));
  }

  assert.ok(page === 1 || page === 2);
  const docs = page === 1
    ? Array.from({ length: 500 }, (_, index) => ({ id: "card-" + index }))
    : [{ id: "card-500" }];
  return Response.json({ count: 501, docs });
};
`,
    );

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        "--import",
        pathToFileURL(preloadPath).href,
        fetcherPath,
      ],
      {
        cwd: directory,
        env: { ...process.env, DPLA_API_KEY: testApiKey },
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    assert.ifError(result.error);
    return { ...result, dataset: await readFile(outputPath, "utf8") };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("fetches all pages in order and publishes the complete JSONL dataset", async () => {
  const result = await fetchDataset("success");

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(
    result.dataset,
    Array.from(
      { length: 501 },
      (_, index) => JSON.stringify({ id: `card-${index}` }) + "\n",
    ).join(""),
  );
  assert.match(result.stdout, /Fetching page 2/);
  assert.match(result.stdout, /Saved 501 records/);
});

test("reports page-specific failures and preserves the published dataset", async (t) => {
  const cases: { scenario: Scenario; message: RegExp }[] = [
    { scenario: "transport", message: /DPLA request for page 1 failed/ },
    {
      scenario: "http",
      message: /DPLA request for page 1 returned 503: Service Unavailable/,
    },
    {
      scenario: "invalid-json",
      message: /DPLA response for page 1 contained invalid JSON/,
    },
    {
      scenario: "invalid-response",
      message: /Unexpected DPLA API response for page 1/,
    },
    {
      scenario: "request-timeout",
      message: /DPLA request for page 1 timed out after 30000 ms/,
    },
    {
      scenario: "body-timeout",
      message: /DPLA request for page 1 timed out after 30000 ms/,
    },
  ];

  for (const { scenario, message } of cases) {
    await t.test(scenario, async () => {
      const result = await fetchDataset(scenario);

      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, message);
      assert.doesNotMatch(result.stderr, new RegExp(testApiKey));
      assert.equal(result.dataset, previousDataset);
    });
  }
});

test("preserves the published dataset if a later page fails", async () => {
  const result = await fetchDataset("second-page-failure");

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Retrieved 500 of 501 records/);
  assert.match(result.stderr, /DPLA request for page 2 failed/);
  assert.equal(result.dataset, previousDataset);
});
