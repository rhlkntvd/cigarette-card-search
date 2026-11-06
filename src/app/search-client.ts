import type { SearchResult } from "../search";

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
): Promise<SearchResult[]> {
  let response: Response;

  try {
    response = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
  } catch (error: unknown) {
    throw new Error("Could not reach search. Please try again.", {
      cause: error,
    });
  }

  const body: unknown = await response.json().catch(() => null);

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
    !body.results.every(isSearchResult)
  ) {
    throw new Error("Could not read search results. Please try again.");
  }

  return body.results;
}
