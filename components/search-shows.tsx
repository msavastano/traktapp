"use client";

import { useEffect, useRef, useState } from "react";
import type { TraktShow } from "@/lib/types";

interface SearchResult {
  type: "show";
  score: number;
  show: TraktShow;
}

interface Props {
  existingIds: Set<number>;
  onAdded: () => void;
}

export function SearchShows({ existingIds, onAdded }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Record<number, boolean>>({});
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setResults([]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!res.ok) {
          setError("Search failed");
          setResults([]);
        } else {
          const data = await res.json();
          setResults(data.results ?? []);
        }
      } catch {
        setError("Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const handleAdd = async (showId: number) => {
    setAddingIds((prev) => ({ ...prev, [showId]: true }));
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId }),
      });
      if (res.ok) {
        setAddedIds((prev) => new Set(prev).add(showId));
        onAdded();
      } else {
        setError("Failed to add show");
      }
    } catch {
      setError("Failed to add show");
    } finally {
      setAddingIds((prev) => ({ ...prev, [showId]: false }));
    }
  };

  return (
    <section className="search-section">
      <div className="search-input-row">
        <input
          type="text"
          className="search-input"
          placeholder="Search shows to add to your watchlist…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button
            className="search-clear-btn"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>

      {error && <div className="search-error">{error}</div>}

      {loading && <div className="search-status">Searching…</div>}

      {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
        <div className="search-status">No results.</div>
      )}

      {results.length > 0 && (
        <div className="search-results">
          {results.map(({ show }) => {
            const id = show.ids.trakt;
            const inWatchlist = existingIds.has(id) || addedIds.has(id);
            return (
              <div key={id} className="search-result-card">
                <div className="search-result-header">
                  <h4 className="search-result-title">
                    {show.title}
                    {show.year && (
                      <span className="search-result-year"> ({show.year})</span>
                    )}
                  </h4>
                  {show.status && (
                    <span
                      className={`watchlist-badge badge-${show.status.replace(/\s+/g, "-")}`}
                    >
                      {show.status}
                    </span>
                  )}
                </div>
                {show.overview && (
                  <p className="search-result-overview">{show.overview}</p>
                )}
                <div className="search-result-footer">
                  <div className="search-result-meta">
                    {show.network && <span>📡 {show.network}</span>}
                    {show.aired_episodes != null && (
                      <span>
                        📺 {show.aired_episodes} ep
                        {show.aired_episodes !== 1 ? "s" : ""}
                      </span>
                    )}
                    {show.rating && <span>⭐ {show.rating.toFixed(1)}</span>}
                  </div>
                  <button
                    className="mark-watched-btn"
                    disabled={inWatchlist || addingIds[id]}
                    onClick={() => handleAdd(id)}
                  >
                    {inWatchlist
                      ? "✓ In Watchlist"
                      : addingIds[id]
                        ? "Adding…"
                        : "+ Add"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
