"use client";

import { useEffect, useState } from "react";

import { getIiifUrl } from "../iiif";
import { FALLBACK_IMAGE_SIZE, failImageRequest } from "./card-image-state";
import type { CardImageState } from "./card-image-state";

const IMAGE_LOAD_TIMEOUT_MS = 20_000;

interface CardImageProps {
  imageId: string;
  title: string;
  size?: number;
}

export default function CardImage({
  imageId,
  title,
  size = FALLBACK_IMAGE_SIZE,
}: CardImageProps) {
  const [image, setImage] = useState<CardImageState>({
    status: "loading",
    size,
    attempt: 0,
  });
  const { status, size: requestedSize, attempt } = image;
  const imageUrl = getIiifUrl(imageId, requestedSize);

  // Give retries a fresh URL instead of reusing a stalled request.
  const source = attempt === 0 ? imageUrl : `${imageUrl}?retry=${attempt}`;

  useEffect(() => {
    if (status !== "loading") {
      return;
    }

    // NYPL can stall without firing an image error.
    const timeout = setTimeout(() => {
      setImage((current) => failImageRequest(current, requestedSize, attempt));
    }, IMAGE_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [status, requestedSize, attempt]);

  return (
    <div className="card-image">
      {status === "error" ? (
        <div className="image-message" role="status">
          <span>Image unavailable</span>
          <button
            type="button"
            className="image-retry"
            aria-label={`Retry image for ${title}`}
            onClick={() => {
              setImage((current) => ({
                ...current,
                status: "loading",
                attempt: current.attempt + 1,
              }));
            }}
          >
            Retry image
          </button>
        </div>
      ) : (
        <>
          {status === "loading" && (
            <span className="image-message">Loading image…</span>
          )}
          <img
            key={`${requestedSize}-${attempt}`}
            className={status === "loading" ? "image-loading" : undefined}
            src={source}
            alt={title}
            width={requestedSize}
            height={requestedSize}
            loading="eager"
            decoding="async"
            onLoad={() =>
              setImage((current) =>
                current.size === requestedSize && current.attempt === attempt
                  ? { ...current, status: "loaded" }
                  : current,
              )
            }
            onError={() =>
              setImage((current) =>
                failImageRequest(current, requestedSize, attempt),
              )
            }
          />
        </>
      )}
    </div>
  );
}
