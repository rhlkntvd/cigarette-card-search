import { EMBEDDING_DIMENSIONS, isEmbedding } from "./vector";
import { MAX_QUERY_LENGTH, QueryTooLongError } from "./query";

const REQUEST_TIMEOUT_MS = 30_000;

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

  if (normalizedText.length > MAX_QUERY_LENGTH) {
    throw new QueryTooLongError();
  }

  const url = `${getEmbeddingServiceUrl()}/embed`;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let response: Response;
  let responseText: string;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: normalizedText }),
      signal,
    });

    // keep the deadline active until the response body has been read
    responseText = await response.text();
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new Error(
        `Embedding service request timed out after ${REQUEST_TIMEOUT_MS} ms`,
        { cause: error },
      );
    }

    throw new Error("Embedding service request failed", { cause: error });
  }

  if (!response.ok) {
    let body: unknown;

    if (response.status === 400) {
      try {
        body = JSON.parse(responseText);
      } catch {
        // Unrecognized service errors stay server errors.
      }
    }

    if (
      typeof body === "object" &&
      body !== null &&
      "detail" in body &&
      typeof body.detail === "object" &&
      body.detail !== null &&
      "code" in body.detail &&
      body.detail.code === "text_too_long"
    ) {
      throw new QueryTooLongError();
    }

    throw new Error(
      `Embedding service returned ${response.status}: ${responseText}`,
    );
  }

  let body: unknown;

  try {
    body = JSON.parse(responseText);
  } catch (error: unknown) {
    throw new Error("Embedding service returned invalid JSON", {
      cause: error,
    });
  }

  if (!isEmbedResponse(body)) {
    throw new Error("Embedding service returned an invalid response");
  }

  return body.embedding;
}
