const EXPECTED_DIMENSIONS = 768;

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

  if (candidate.dimensions !== EXPECTED_DIMENSIONS) {
    return false;
  }

  if (!Array.isArray(candidate.embedding)) {
    return false;
  }

  if (candidate.embedding.length !== EXPECTED_DIMENSIONS) {
    return false;
  }

  return candidate.embedding.every(
    (item) => typeof item === "number" && Number.isFinite(item),
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
