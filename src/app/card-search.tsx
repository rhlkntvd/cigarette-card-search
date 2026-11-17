"use client";

import { useEffect, useRef, useState } from "react";

import type { SearchResult } from "../search";
import { MAX_QUERY_LENGTH, QUERY_TOO_LONG_MESSAGE } from "../query";
import { fetchSearchResults } from "./search-client";
import CardImage from "./card-image";
import CardDetail from "./card-detail";
import { SEARCH_PAGE_SIZE } from "./search-page";
import type { SearchPage } from "./search-page";

const EXAMPLE_QUERIES = [
  "flowers",
  "a portrait",
  "a costume",
  "a butterfly",
  "a sailing ship",
  "a colorful bird",
];

interface SearchResults extends SearchPage {
  query: string;
  loadingMore: boolean;
  moreError: string | null;
}

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "error"; message: string };

export default function CardSearch() {
  const exampleButtonRef = useRef<HTMLButtonElement | null>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<SearchResult | null>(null);
  // Keep the last successful page visible while a replacement is requested.
  const [results, setResults] = useState<SearchResults | null>(null);
  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const isLoading = search.status === "loading";
  const isLoadingMore = results?.loadingMore ?? false;
  const isBusy = isLoading || isLoadingMore;

  useEffect(() => {
    const button = exampleButtonRef.current;
    if (results === null || !button) {
      return;
    }
    exampleButtonRef.current = null;
    if (
      document.activeElement === button ||
      document.activeElement === document.body
    ) {
      resultsHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [results]);

  async function handleSearch(description: string) {
    if (isBusy) {
      return;
    }

    const normalizedQuery = description.trim();

    if (!normalizedQuery) {
      setSearch({ status: "error", message: "Enter a description to search." });
      return;
    }

    if (normalizedQuery.length > MAX_QUERY_LENGTH) {
      setSearch({ status: "error", message: QUERY_TOO_LONG_MESSAGE });
      return;
    }

    setSelectedCard(null);
    setResults((current) => current && { ...current, moreError: null });
    setSearch({ status: "loading", query: normalizedQuery });

    try {
      const page = await fetchSearchResults(normalizedQuery);
      setResults({
        query: normalizedQuery,
        ...page,
        loadingMore: false,
        moreError: null,
      });
      setSearch({ status: "idle" });
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
    if (!results || !results.hasMore || isBusy) {
      return;
    }

    setResults({ ...results, loadingMore: true, moreError: null });

    try {
      const page = await fetchSearchResults(
        results.query,
        results.results.length,
      );
      setResults((current) => {
        if (!current || current.query !== results.query) {
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
      setResults((current) => {
        if (!current || current.query !== results.query) {
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
      <form
        className="search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          exampleButtonRef.current = null;
          void handleSearch(query);
        }}
      >
        <div className="search-input-row">
          <input
            id="search-query"
            name="query"
            type="search"
            aria-label="Describe an image"
            enterKeyHint="search"
            placeholder="a vibrant sunset"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-describedby={
              search.status === "error" ? "search-error" : undefined
            }
            aria-invalid={
              search.status === "error" &&
              (!query.trim() || query.trim().length > MAX_QUERY_LENGTH)
            }
            required
          />
          <button type="submit" disabled={isBusy}>
            {isLoading ? "Searching…" : "Search"}
          </button>
        </div>
        {results === null && (
          <div
            className="search-examples"
            role="group"
            aria-label="Example searches"
          >
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example}
                type="button"
                disabled={isBusy}
                onClick={(event) => {
                  exampleButtonRef.current = event.currentTarget;
                  setQuery(example);
                  void handleSearch(example);
                }}
              >
                {example}
              </button>
            ))}
          </div>
        )}
      </form>

      <div className="results-header">
        {(results !== null || search.status !== "idle") && (
          <h2 id="results-title" ref={resultsHeadingRef} tabIndex={-1}>
            Search results
          </h2>
        )}
        <p className="search-status" role="status" aria-atomic="true">
          {results &&
            (results.results.length > 0
              ? `${results.results.length} result${results.results.length === 1 ? "" : "s"} for “${results.query}”.`
              : !isLoading &&
                `No cards found for “${results.query}”. Try a different description.`)}
          {search.status === "loading" && (
            <span className="pending-search">
              {`Searching for “${search.query}”…`}
            </span>
          )}
          {isLoadingMore && " Loading more…"}
        </p>
      </div>

      {search.status === "error" && (
        <p id="search-error" className="search-error" role="alert">
          {search.message}
        </p>
      )}

      {results && results.results.length > 0 && (
        <section aria-labelledby="results-title" aria-busy={isBusy}>
          <ol className="results-grid" role="list">
            {results.results.map((card) => (
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
                        aria-label={`View ${card.title} at NYPL (opens in a new tab)`}
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
            {results.moreError && (
              <p className="pagination-error" role="alert">
                {results.moreError}
              </p>
            )}
            {results.hasMore ? (
              <button
                type="button"
                className="show-more"
                disabled={isBusy}
                onClick={handleShowMore}
              >
                {results.loadingMore
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
