"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  EMPTY_IMAGE,
  THUMBNAIL_SIZE,
  getCardImage,
  retryCardImage,
  reportCardImageError,
  subscribeCardImage,
} from "./card-image-store";

function useCardImage(imageId: string, size: number, enabled = true) {
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled ? subscribeCardImage(imageId, size, listener) : () => {},
    [imageId, size, enabled],
  );
  const getSnapshot = useCallback(
    () => (enabled ? getCardImage(imageId, size) : EMPTY_IMAGE),
    [imageId, size, enabled],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_IMAGE);
}

interface CardImageProps {
  imageId: string;
  title: string;
  size?: number;
}

export default function CardImage({
  imageId,
  title,
  size = THUMBNAIL_SIZE,
}: CardImageProps) {
  const thumbnail = useCardImage(imageId, THUMBNAIL_SIZE);
  const larger = useCardImage(
    imageId,
    size,
    size > THUMBNAIL_SIZE && thumbnail.image !== null,
  );
  const image = larger.image ?? thumbnail.image;
  const canRetry = thumbnail.status === "slow" || thumbnail.status === "error";

  return (
    <div className="card-image">
      {image ? (
        <img
          key={image.src}
          src={image.src}
          alt={title}
          width={image.width}
          height={image.height}
          loading="eager"
          decoding="async"
          onError={() =>
            reportCardImageError(
              imageId,
              larger.image ? size : THUMBNAIL_SIZE,
              image.src,
            )
          }
        />
      ) : (
        <div className="image-message" role="status">
          <span>
            {thumbnail.status === "error"
              ? "Image unavailable"
              : thumbnail.status === "slow"
                ? "Still loading…"
                : "Loading image…"}
          </span>
          {canRetry && (
            <button
              type="button"
              className="image-retry"
              aria-label={`Retry image for ${title}`}
              onClick={() => retryCardImage(imageId, THUMBNAIL_SIZE)}
            >
              Retry image
            </button>
          )}
        </div>
      )}
    </div>
  );
}
