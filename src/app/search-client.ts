import type { SearchResult } from "../search";
import { SEARCH_PAGE_SIZE } from "./search-page";
import type { SearchPage } from "./search-page";

// Allow for the embedding service's 30-second deadline plus request/query overhead.
const SEARCH_TIMEOUT_MS = 45_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isSearchResult(value: unknown): value is SearchResult {
  return (
    isObject(value) &&
    isNonEmptyString(value.dplaId) &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.frontImageId) &&
    (value.backImageId === null || isNonEmptyString(value.backImageId)) &&
    isNonEmptyString(value.sourceUrl) &&
    (value.rights === null || isNonEmptyString(value.rights)) &&
    typeof value.displayEligible === "boolean" &&
    typeof value.similarity === "number" &&
    Number.isFinite(value.similarity)
  );
}

export async function fetchSearchResults(
  query: string,
  offset = 0,
): Promise<SearchPage> {
  const signal = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  let response: Response;
  let body: unknown;

  try {
    response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, offset }),
      signal,
    });
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new Error("Search timed out. Please try again.", { cause: error });
    }
    throw new Error("Could not reach search. Please try again.", {
      cause: error,
    });
  }

  if (!response.ok) {
    const message =
      isObject(body) && isNonEmptyString(body.error)
        ? body.error
        : "Search is unavailable. Please try again.";

    throw new Error(message);
  }

  if (
    !isObject(body) ||
    !Array.isArray(body.results) ||
    body.results.length > SEARCH_PAGE_SIZE ||
    !body.results.every(isSearchResult) ||
    typeof body.hasMore !== "boolean" ||
    (body.hasMore && body.results.length !== SEARCH_PAGE_SIZE)
  ) {
    throw new Error("Could not read search results. Please try again.");
  }

  return { results: body.results, hasMore: body.hasMore };
}
