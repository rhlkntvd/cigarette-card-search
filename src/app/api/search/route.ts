import { embedText } from "../../../embedding";
import { searchCards } from "../../../search";
import { getSearchScope } from "../../search-scope";

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
    Object.keys(body).some((key) => key !== "query") ||
    !("query" in body) ||
    typeof body.query !== "string"
  ) {
    return Response.json(
      { error: "Request body must contain only a query string." },
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

  try {
    const publicOnly = getSearchScope() === "public";
    const embedding = await embedText(query);
    const results = await searchCards(embedding, { publicOnly });

    return Response.json({ results });
  } catch (error: unknown) {
    console.error("Card search failed:", error);

    return Response.json(
      { error: "Search is unavailable. Please try again." },
      { status: 500 },
    );
  }
}
