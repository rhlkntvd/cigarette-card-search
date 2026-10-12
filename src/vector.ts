export const EMBEDDING_DIMENSIONS = 768;

export function isEmbedding(value: unknown): value is number[] {
  if (!Array.isArray(value) || value.length !== EMBEDDING_DIMENSIONS) {
    return false;
  }

  let hasNonZeroValue = false;

  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return false;
    }

    if (item !== 0) {
      hasNonZeroValue = true;
    }
  }

  // cosine similarity is undefined for a zero vector
  return hasNonZeroValue;
}
