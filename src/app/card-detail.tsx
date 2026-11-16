"use client";

import { useEffect, useRef, useState } from "react";

import type { SearchResult } from "../search";
import CardImage from "./card-image";

interface CardDetailProps {
  card: SearchResult;
  onClose: () => void;
}

export default function CardDetail({ card, onClose }: CardDetailProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const imageId =
    side === "back" && card.backImageId ? card.backImageId : card.frontImageId;

  useEffect(() => {
    if (!dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  }, []);

  function closeViewer() {
    dialogRef.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className="card-dialog"
      aria-labelledby="card-detail-title"
      onCancel={(event) => {
        event.preventDefault();
        closeViewer();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") {
          return;
        }

        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), a[href]",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];

        if (event.shiftKey && event.target === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }

        const bounds = event.currentTarget.getBoundingClientRect();

        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          closeViewer();
        }
      }}
    >
      <div className="dialog-content">
        <header className="dialog-header">
          <h2 id="card-detail-title">{card.title}</h2>
          <button type="button" autoFocus onClick={closeViewer}>
            Close <span aria-hidden="true">×</span>
          </button>
        </header>

        <CardImage
          key={imageId}
          imageId={imageId}
          title={`${card.title} — ${side}`}
          size={1024}
        />

        <div className="detail-actions">
          <div className="image-controls" role="group" aria-label="Card side">
            <button
              type="button"
              aria-pressed={side === "front"}
              onClick={() => setSide("front")}
            >
              Front
            </button>
            <button
              type="button"
              aria-pressed={side === "back"}
              disabled={!card.backImageId}
              onClick={() => setSide("back")}
            >
              Back
            </button>
          </div>
          <a
            className="primary-link"
            href={card.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            View original at NYPL <span aria-hidden="true">↗</span>
            <span className="visually-hidden"> (opens in a new tab)</span>
          </a>
        </div>

        {!card.backImageId && (
          <p className="detail-note">
            No back image is available for this card.
          </p>
        )}
      </div>
    </dialog>
  );
}
