"use client";

import { useEffect, useState } from "react";
import type { SubmitEvent } from "react";

import { getIiifUrl } from "../iiif";
import type { SearchResult } from "../search";
import { fetchSearchResults } from "./search-client";

const IMAGE_LOAD_TIMEOUT_MS = 20_000;

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "success"; query: string; results: SearchResult[] }
  | { status: "error"; message: string };

function CardImage({ imageId, title }: { imageId: string; title: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "error">(
    "loading",
  );
  const [attempt, setAttempt] = useState(0);
  const imageUrl = getIiifUrl(imageId);

  // Give retries a fresh URL instead of reusing a stalled request.
  const source = attempt === 0 ? imageUrl : `${imageUrl}?retry=${attempt}`;

  useEffect(() => {
    if (status !== "loading") {
      return;
    }

    // NYPL can stall without firing an image error.
    const timeout = setTimeout(() => {
      setStatus((current) => (current === "loading" ? "error" : current));
    }, IMAGE_LOAD_TIMEOUT_MS);

    return () => clearTimeout(timeout);
  }, [status]);

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
              setAttempt((current) => current + 1);
              setStatus("loading");
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
            className={status === "loading" ? "image-loading" : undefined}
            src={source}
            alt={title}
            width={512}
            height={512}
            loading="eager"
            decoding="async"
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
          />
        </>
      )}
    </div>
  );
}

export default function CardSearch() {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const isLoading = search.status === "loading";

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      setSearch({ status: "error", message: "Enter a description to search." });
      return;
    }

    setSearch({ status: "loading", query: normalizedQuery });

    try {
      const results = await fetchSearchResults(normalizedQuery);
      setSearch({ status: "success", query: normalizedQuery, results });
    } catch (error: unknown) {
      setSearch({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Search is unavailable. Please try again.",
      });
    }
  }

  return (
    <>
      <form className="search-form" onSubmit={handleSubmit}>
        <label htmlFor="search-query">Describe an image</label>
        <div className="search-input-row">
          <input
            id="search-query"
            name="query"
            type="search"
            placeholder="a blue butterfly"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby="search-help"
            aria-invalid={search.status === "error" && !query.trim()}
            required
          />
          <button type="submit" disabled={isLoading}>
            {isLoading ? "Searching…" : "Search"}
          </button>
        </div>
        <p id="search-help" className="search-help">
          Try a subject, scene, color, or mood.
        </p>
      </form>

      <p className="search-status" role="status" aria-atomic="true">
        {search.status === "loading" && `Searching for “${search.query}”…`}
        {search.status === "success" &&
          (search.results.length === 0
            ? `No cards found for “${search.query}”. Try a different description.`
            : `${search.results.length} result${search.results.length === 1 ? "" : "s"} for “${search.query}”.`)}
      </p>

      {search.status === "error" && (
        <p className="search-error" role="alert">
          {search.message}
        </p>
      )}

      {search.status === "success" && search.results.length > 0 && (
        <section aria-labelledby="results-title">
          <h2 id="results-title">Search results</h2>
          <ol className="results-grid" role="list">
            {search.results.map((card) => (
              <li key={card.dplaId}>
                <article className="result-card">
                  <CardImage imageId={card.frontImageId} title={card.title} />
                  <a
                    className="card-details"
                    href={card.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <h3>{card.title}</h3>
                    <span className="card-source">
                      View at NYPL
                      <span className="visually-hidden">
                        {" "}
                        (opens in a new tab)
                      </span>
                    </span>
                  </a>
                </article>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
