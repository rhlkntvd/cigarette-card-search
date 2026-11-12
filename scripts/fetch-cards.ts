import fs from "node:fs/promises";
import path from "node:path";

const API_URL = "https://api.dp.la/v2/items";

const COLLECTION_TITLE = "Cigarette cards";
const PROVIDER_NAME = "The New York Public Library";

const PAGE_SIZE = 500;
const MAX_PAGE = 100;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

const OUTPUT_PATH = path.resolve("data/raw/cigarette-cards.jsonl");

const TEMP_OUTPUT_PATH = `${OUTPUT_PATH}.tmp`;

interface DplaResponse {
  count: number;
  docs: unknown[];
}

function getApiKey(): string {
  const apiKey = process.env.DPLA_API_KEY;

  if (!apiKey) {
    throw new Error("DPLA_API_KEY environment variable is required");
  }

  return apiKey;
}

async function retryPage(
  page: number,
  attempt: number,
  error: Error,
  retryAfter: string | null = null,
) {
  if (attempt >= MAX_ATTEMPTS) {
    throw error;
  }

  let delayMs = 1_000 * 2 ** (attempt - 1);

  if (retryAfter?.trim()) {
    const value = retryAfter.trim();
    const requestedDelay = /^\d+$/.test(value)
      ? Number(value) * 1_000
      : Date.parse(value) - Date.now();

    if (Number.isFinite(requestedDelay)) {
      delayMs = Math.max(delayMs, requestedDelay);
    }
  }

  if (delayMs > MAX_RETRY_DELAY_MS) {
    throw new Error(
      `${error.message}; Retry-After exceeds ${MAX_RETRY_DELAY_MS} ms, try again later`,
      { cause: error },
    );
  }

  console.warn(
    `Retrying page ${page} in ${delayMs} ms ` +
      `(attempt ${attempt + 1}/${MAX_ATTEMPTS}): ${error.message}`,
  );
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchPage(apiKey: string, page: number): Promise<DplaResponse> {
  const url = new URL(API_URL);

  url.searchParams.set("sourceResource.collection.title", COLLECTION_TITLE);

  url.searchParams.set("provider.name", PROVIDER_NAME);

  url.searchParams.set("exact_field_match", "true");

  url.searchParams.set("page_size", PAGE_SIZE.toString());

  url.searchParams.set("page", page.toString());

  url.searchParams.set("sort_by", "id");

  url.searchParams.set("api_key", apiKey);

  console.log(`Fetching page ${page}...`);

  let responseText: string;

  for (let attempt = 1; ; attempt += 1) {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, { signal });
      responseText = await response.text();
    } catch (error: unknown) {
      const message = signal.aborted
        ? `DPLA request for page ${page} timed out after ${REQUEST_TIMEOUT_MS} ms`
        : `DPLA request for page ${page} failed`;
      await retryPage(page, attempt, new Error(message, { cause: error }));
      continue;
    }

    if (response.ok) {
      break;
    }

    const error = new Error(
      `DPLA request for page ${page} returned ${response.status}: ${response.statusText}`,
    );
    if (!RETRY_STATUSES.has(response.status)) {
      throw error;
    }
    await retryPage(page, attempt, error, response.headers.get("Retry-After"));
  }

  let data: unknown;

  try {
    data = JSON.parse(responseText);
  } catch (error: unknown) {
    throw new Error(`DPLA response for page ${page} contained invalid JSON`, {
      cause: error,
    });
  }

  if (
    typeof data !== "object" ||
    data === null ||
    !("docs" in data) ||
    !Array.isArray(data.docs) ||
    !("count" in data) ||
    typeof data.count !== "number" ||
    !Number.isSafeInteger(data.count) ||
    data.count < 0
  ) {
    throw new Error(`Unexpected DPLA API response for page ${page}`);
  }

  return {
    count: data.count,
    docs: data.docs,
  };
}

async function main() {
  const apiKey = getApiKey();

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  const outputFile = await fs.open(TEMP_OUTPUT_PATH, "w");

  let page = 1;
  let recordsRetrieved = 0;
  let totalAvailable: number | null = null;

  try {
    while (true) {
      if (page > MAX_PAGE) {
        throw new Error(
          "DPLA pagination limit reached " +
            "before all records were retrieved",
        );
      }

      const data = await fetchPage(apiKey, page);

      if (totalAvailable === null) {
        totalAvailable = data.count;

        if (totalAvailable === 0) {
          throw new Error(
            "DPLA returned an empty collection; keeping the published dataset",
          );
        }

        const maximumRetrievable = PAGE_SIZE * MAX_PAGE;

        if (totalAvailable > maximumRetrievable) {
          throw new Error(
            `Collection contains ${totalAvailable} records, ` +
              `but DPLA pagination can retrieve at most ` +
              `${maximumRetrievable}`,
          );
        }

        console.log(`Found ${totalAvailable} matching records`);
        console.log();
      } else if (data.count !== totalAvailable) {
        throw new Error(
          `DPLA collection count changed on page ${page}: ` +
            `${totalAvailable} to ${data.count}; retry the fetch`,
        );
      }

      if (data.docs.length === 0) {
        break;
      }

      for (const doc of data.docs) {
        await outputFile.write(JSON.stringify(doc) + "\n");
      }

      recordsRetrieved += data.docs.length;

      console.log(
        `Retrieved ${recordsRetrieved} ` + `of ${totalAvailable} records`,
      );

      if (recordsRetrieved >= totalAvailable || data.docs.length < PAGE_SIZE) {
        break;
      }

      page += 1;
    }
  } finally {
    await outputFile.close();
  }

  if (totalAvailable !== null && recordsRetrieved !== totalAvailable) {
    throw new Error(
      `Expected ${totalAvailable} records ` +
        `but retrieved ${recordsRetrieved}`,
    );
  }

  await fs.rename(TEMP_OUTPUT_PATH, OUTPUT_PATH);

  console.log();
  console.log(`Saved ${recordsRetrieved} records ` + `to ${OUTPUT_PATH}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
