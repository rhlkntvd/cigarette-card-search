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
  | "nonretry-http"
  | "retry-transport"
  | "retry-http"
  | "retry-third-attempt"
  | "retry-rate-limit"
  | "retry-date"
  | "long-retry-after"
  | "invalid-json"
  | "invalid-response"
  | "invalid-count"
  | "empty-collection"
  | "changed-count"
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
const attempts = {};
const delays = [];
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, milliseconds, ...args) => {
  delays.push(milliseconds);
  return originalSetTimeout(callback, 0, ...args);
};
Date.now = () => Date.parse("2026-11-11T00:00:00Z");
process.on("exit", () => {
  console.log("TEST_METRICS " + JSON.stringify({ attempts, delays }));
});

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
  attempts[page] = (attempts[page] ?? 0) + 1;
  const attempt = attempts[page];

  if (scenario === "transport" || (scenario === "second-page-failure" && page === 2) ||
      (scenario === "retry-transport" && page === 2 && attempt === 1)) {
    throw new TypeError("Network unavailable");
  }
  if (scenario === "http") {
    return new Response("Unavailable", { status: 503, statusText: "Service Unavailable" });
  }
  if (scenario === "nonretry-http") {
    return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
  }
  if (scenario === "long-retry-after") {
    return new Response("Too many requests", { status: 429, headers: { "Retry-After": "120" } });
  }
  if (scenario === "retry-third-attempt" && page === 2 && attempt <= 2) {
    return new Response("Unavailable", { status: 503 });
  }
  if (page === 2 && attempt === 1) {
    if (scenario === "retry-http") {
      return new Response("Unavailable", { status: 503 });
    }
    if (scenario === "retry-rate-limit") {
      return new Response("Too many requests", { status: 429, headers: { "Retry-After": "2" } });
    }
    if (scenario === "retry-date") {
      return new Response("Unavailable", { status: 503, headers: {
        "Retry-After": new Date(Date.now() + 5000).toUTCString(),
      } });
    }
  }
  if (scenario === "invalid-json") {
    return new Response("not JSON");
  }
  if (scenario === "invalid-response") {
    return Response.json({ count: 1, docs: null });
  }
  if (scenario === "invalid-count") {
    return Response.json({ count: 1.5, docs: [{ id: "card-0" }] });
  }
  if (scenario === "empty-collection") {
    return Response.json({ count: 0, docs: [] });
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
  const count = scenario === "changed-count" && page === 2 ? 502 : 501;
  return Response.json({ count, docs });
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
    const metricsLine = result.stdout
      .split("\n")
      .find((line) => line.startsWith("TEST_METRICS "));
    assert.ok(metricsLine, result.stdout + result.stderr);
    const metrics = JSON.parse(metricsLine.slice("TEST_METRICS ".length)) as {
      attempts: Record<string, number>;
      delays: number[];
    };
    return { ...result, metrics, dataset: await readFile(outputPath, "utf8") };
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
      scenario: "nonretry-http",
      message: /DPLA request for page 1 returned 401: Unauthorized/,
    },
    {
      scenario: "long-retry-after",
      message: /Retry-After exceeds 30000 ms/,
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
      scenario: "invalid-count",
      message: /Unexpected DPLA API response for page 1/,
    },
    {
      scenario: "empty-collection",
      message: /DPLA returned an empty collection/,
    },
    {
      scenario: "changed-count",
      message: /DPLA collection count changed on page 2: 501 to 502/,
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
      const retryable = [
        "transport",
        "http",
        "request-timeout",
        "body-timeout",
      ].includes(scenario);
      assert.equal(result.metrics.attempts["1"], retryable ? 3 : 1);
      assert.deepEqual(result.metrics.delays, retryable ? [1000, 2000] : []);
    });
  }
});

test("preserves the published dataset if a later page fails", async () => {
  const result = await fetchDataset("second-page-failure");

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /Retrieved 500 of 501 records/);
  assert.match(result.stderr, /DPLA request for page 2 failed/);
  assert.equal(result.dataset, previousDataset);
  assert.deepEqual(result.metrics.attempts, { "1": 1, "2": 3 });
  assert.deepEqual(result.metrics.delays, [1000, 2000]);
});

test("retries only the failed page and publishes each record once", async (t) => {
  const cases: { scenario: Scenario; delays: number[] }[] = [
    { scenario: "retry-transport", delays: [1000] },
    { scenario: "retry-http", delays: [1000] },
    { scenario: "retry-third-attempt", delays: [1000, 2000] },
    { scenario: "retry-rate-limit", delays: [2000] },
    { scenario: "retry-date", delays: [5000] },
  ];
  for (const { scenario, delays } of cases) {
    await t.test(scenario, async () => {
      const result = await fetchDataset(scenario);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(result.metrics.attempts, {
        "1": 1,
        "2": delays.length + 1,
      });
      assert.deepEqual(result.metrics.delays, delays);
      const ids = result.dataset
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).id);
      assert.equal(ids.length, 501);
      assert.equal(new Set(ids).size, 501);
      assert.equal(ids[500], "card-500");
      assert.doesNotMatch(result.stderr, new RegExp(testApiKey));
    });
  }
});
