"use client";

import { useState } from "react";
import type { SubmitEvent } from "react";

import type { SearchResult } from "../search";
import { fetchSearchResults } from "./search-client";
import CardImage from "./card-image";
import CardDetail from "./card-detail";
import { SEARCH_PAGE_SIZE } from "./search-page";

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | {
      status: "success";
      query: string;
      results: SearchResult[];
      hasMore: boolean;
      loadingMore: boolean;
      moreError: string | null;
    }
  | { status: "error"; message: string };

export default function CardSearch() {
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<SearchResult | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const isLoading = search.status === "loading";
  const isLoadingMore = search.status === "success" && search.loadingMore;
  const isBusy = isLoading || isLoadingMore;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isBusy) {
      return;
    }

    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
      setSearch({ status: "error", message: "Enter a description to search." });
      return;
    }

    setSelectedCard(null);
    setSearch({ status: "loading", query: normalizedQuery });

    try {
      const page = await fetchSearchResults(normalizedQuery);
      setSearch({
        status: "success",
        query: normalizedQuery,
        ...page,
        loadingMore: false,
        moreError: null,
      });
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

  async function handleShowMore() {
    if (search.status !== "success" || !search.hasMore || search.loadingMore) {
      return;
    }

    setSearch({ ...search, loadingMore: true, moreError: null });

    try {
      const page = await fetchSearchResults(
        search.query,
        search.results.length,
      );
      setSearch((current) => {
        if (current.status !== "success" || current.query !== search.query) {
          return current;
        }

        return {
          ...current,
          results: [...current.results, ...page.results],
          hasMore: page.hasMore,
          loadingMore: false,
        };
      });
    } catch (error: unknown) {
      setSearch((current) => {
        if (current.status !== "success" || current.query !== search.query) {
          return current;
        }

        return {
          ...current,
          loadingMore: false,
          moreError:
            error instanceof Error
              ? error.message
              : "Could not load more results. Please try again.",
        };
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
            placeholder="a colorful sunset"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby="search-help"
            aria-invalid={search.status === "error" && !query.trim()}
            required
          />
          <button type="submit" disabled={isBusy}>
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
        {isLoadingMore && " Loading more…"}
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
                  <div className="card-details">
                    <h3>
                      <button
                        type="button"
                        className="card-open"
                        aria-haspopup="dialog"
                        onClick={() => setSelectedCard(card)}
                      >
                        {card.title}
                      </button>
                    </h3>
                    <div className="card-actions">
                      <span>
                        View card <span aria-hidden="true">→</span>
                      </span>
                      <a
                        className="card-source"
                        href={card.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        NYPL <span aria-hidden="true">↗</span>
                        <span className="visually-hidden">
                          {" "}
                          (opens in a new tab)
                        </span>
                      </a>
                    </div>
                  </div>
                </article>
              </li>
            ))}
          </ol>
          <div className="pagination-controls">
            {search.moreError && (
              <p className="pagination-error" role="alert">
                {search.moreError}
              </p>
            )}
            {search.hasMore ? (
              <button
                type="button"
                className="show-more"
                disabled={search.loadingMore}
                onClick={handleShowMore}
              >
                {search.loadingMore
                  ? "Loading…"
                  : `Show ${SEARCH_PAGE_SIZE} more`}
              </button>
            ) : (
              <p className="end-of-results">All available results are shown.</p>
            )}
          </div>
        </section>
      )}

      {selectedCard && (
        <CardDetail
          key={selectedCard.dplaId}
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
        />
      )}
    </>
  );
}
