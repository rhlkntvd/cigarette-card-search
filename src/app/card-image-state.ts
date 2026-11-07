export const FALLBACK_IMAGE_SIZE = 512;

export interface CardImageState {
  status: "loading" | "loaded" | "error";
  size: number;
  attempt: number;
}

export function failImageRequest(
  current: CardImageState,
  requestedSize: number,
  requestedAttempt: number,
): CardImageState {
  if (
    current.status !== "loading" ||
    current.size !== requestedSize ||
    current.attempt !== requestedAttempt
  ) {
    return current;
  }

  // NYPL may serve a thumbnail while refusing the larger image.
  if (current.size > FALLBACK_IMAGE_SIZE) {
    return { status: "loading", size: FALLBACK_IMAGE_SIZE, attempt: 0 };
  }

  return { ...current, status: "error" };
}
