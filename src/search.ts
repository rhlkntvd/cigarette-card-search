import pgvector from "pgvector";

import { sql } from "./db.js";

const EMBEDDING_DIMENSIONS = 768;
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
  publicOnly?: boolean;
}

export async function searchCards(
  embedding: number[],
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      "Expected a " +
        `${EMBEDDING_DIMENSIONS}-dimensional ` +
        `embedding, got ${embedding.length}`,
    );
  }

  const limit = options.limit ?? DEFAULT_LIMIT;

  const publicOnly = options.publicOnly ?? false;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`Search limit must be between ` + `1 and ${MAX_LIMIT}`);
  }

  const queryVector = pgvector.toSql(embedding);

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

    ORDER BY
      cards.embedding
      <=> query.embedding

    LIMIT ${limit}
  `;

  return rows;
}
