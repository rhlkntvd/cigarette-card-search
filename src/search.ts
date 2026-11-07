import pgvector from "pgvector";
import { getSql } from "./db";
import { EMBEDDING_DIMENSIONS, isEmbedding } from "./vector";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

export interface SearchResult {
  dplaId: string;
  title: string;
  frontImageId: string;
  backImageId: string | null;
  sourceUrl: string;
  rights: string | null;
  displayEligible: boolean;
  similarity: number;
}

export interface SearchOptions {
  limit?: number;
  offset?: number;
  publicOnly?: boolean;
}

export async function searchCards(
  embedding: number[],
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  if (!isEmbedding(embedding)) {
    throw new Error(
      `Expected a nonzero ${EMBEDDING_DIMENSIONS}-dimensional embedding containing only finite numbers`,
    );
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const offset = options.offset ?? 0;

  const publicOnly = options.publicOnly ?? false;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`Search limit must be between ` + `1 and ${MAX_LIMIT}`);
  }

  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Search offset must be a nonnegative safe integer");
  }

  const queryVector = pgvector.toSql(embedding);
  const sql = getSql();

  const rows = await sql<SearchResult[]>`
    WITH query AS (
      SELECT
        ${queryVector}::vector
        AS embedding
    )
    SELECT
      cards.dpla_id
        AS "dplaId",

      cards.title,

      cards.front_image_id
        AS "frontImageId",

      cards.back_image_id
        AS "backImageId",

      cards.source_url
        AS "sourceUrl",

      cards.rights,

      cards.display_eligible
        AS "displayEligible",

      1 - (
        cards.embedding
        <=> query.embedding
      ) AS similarity

    FROM cards
    CROSS JOIN query

    WHERE (
      NOT ${publicOnly}
      OR cards.display_eligible
    )

    -- Stabilize equal-distance results across pages.
    ORDER BY
      cards.embedding
      <=> query.embedding,
      cards.dpla_id

    LIMIT ${limit}
    OFFSET ${offset}
  `;

  return rows;
}
