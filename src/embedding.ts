import { EMBEDDING_DIMENSIONS, isEmbedding } from "./vector.js";

interface EmbedResponse {
  embedding: number[];
  dimensions: number;
}

function getEmbeddingServiceUrl(): string {
  const url = process.env.EMBEDDING_SERVICE_URL;

  if (!url) {
    throw new Error("EMBEDDING_SERVICE_URL is not set");
  }

  return url.replace(/\/$/, "");
}

function isEmbedResponse(value: unknown): value is EmbedResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.dimensions === EMBEDDING_DIMENSIONS &&
    isEmbedding(candidate.embedding)
  );
}

export async function embedText(text: string): Promise<number[]> {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error("Search text must not be empty");
  }

  const response = await fetch(`${getEmbeddingServiceUrl()}/embed`, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
    },

    body: JSON.stringify({
      text: normalizedText,
    }),
  });

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
      "Embedding service returned " + `${response.status}: ${message}`,
    );
  }

  const body: unknown = await response.json();

  if (!isEmbedResponse(body)) {
    throw new Error("Embedding service returned " + "an invalid response");
  }

  return body.embedding;
}
