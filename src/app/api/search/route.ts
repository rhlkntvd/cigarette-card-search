import { embedText } from "../../../embedding";
import { searchCards } from "../../../search";
import {
  MAX_QUERY_LENGTH,
  QUERY_TOO_LONG_MESSAGE,
  QueryTooLongError,
} from "../../../query";
import { getSearchScope } from "../../search-scope";
import { SEARCH_PAGE_SIZE } from "../../search-page";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();

  if (contentType !== "application/json") {
    return Response.json(
      { error: "Content-Type must be application/json." },
      { status: 415 },
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "query" && key !== "offset") ||
    !("query" in body) ||
    typeof body.query !== "string"
  ) {
    return Response.json(
      {
        error:
          "Request body must contain a query string and an optional offset.",
      },
      { status: 400 },
    );
  }

  const query = body.query.trim();

  if (!query) {
    return Response.json(
      { error: "Query must not be empty." },
      { status: 400 },
    );
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return Response.json({ error: QUERY_TOO_LONG_MESSAGE }, { status: 400 });
  }

  const offset = "offset" in body ? body.offset : 0;

  if (
    typeof offset !== "number" ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return Response.json(
      { error: "Offset must be a nonnegative safe integer." },
      { status: 400 },
    );
  }

  try {
    const publicOnly = getSearchScope() === "public";
    const embedding = await embedText(query);
    const rows = await searchCards(embedding, {
      publicOnly,
      limit: SEARCH_PAGE_SIZE + 1,
      offset,
    });

    return Response.json({
      results: rows.slice(0, SEARCH_PAGE_SIZE),
      hasMore: rows.length > SEARCH_PAGE_SIZE,
    });
  } catch (error: unknown) {
    if (error instanceof QueryTooLongError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    console.error("Card search failed:", error);

    return Response.json(
      { error: "Search is unavailable. Please try again." },
      { status: 500 },
    );
  }
}
