"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { TraktShow } from "@/lib/types";

type DiscoverTab = "trending" | "anticipated";

interface DiscoverItem {
  watchers?: number;
  list_count?: number;
  show: TraktShow;
}

interface Props {
  existingIds: Set<number>;
  onAdded: () => void;
}

const posterUrl = (show: TraktShow): string | null => {
  const p = show.images?.poster?.[0];
  return p ? `https://${p.replace(/^https?:\/\//, "")}` : null;
};

export function DiscoverShows({ existingIds, onAdded }: Props) {
  const [subTab, setSubTab] = useState<DiscoverTab>("trending");
  const [data, setData] = useState<Partial<Record<DiscoverTab, DiscoverItem[]>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Record<number, boolean>>({});
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (data[subTab]) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/discover?type=${subTab}`);
        if (!res.ok) throw new Error(`Discover fetch failed: ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          setData((prev) => ({ ...prev, [subTab]: json.shows ?? [] }));
        }
      } catch (err) {
        console.error("Discover fetch error:", err);
        if (!cancelled) setError("Failed to load shows. Try again later.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab]);

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

  const items = data[subTab] ?? [];

  return (
    <div className="discover">
      <div className="dashboard-tabs discover-subtabs">
        <button
          type="button"
          className={`tab-btn ${subTab === "trending" ? "active" : ""}`}
          onClick={() => setSubTab("trending")}
        >
          🔥 Trending
        </button>
        <button
          type="button"
          className={`tab-btn ${subTab === "anticipated" ? "active" : ""}`}
          onClick={() => setSubTab("anticipated")}
        >
          🗓 Anticipated
        </button>
      </div>

      {error && <div className="search-error">{error}</div>}

      {loading ? (
        <div className="watchlist-grid" aria-busy="true" aria-label="Loading shows">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton skeleton-poster" />
              <div className="skeleton-body">
                <div className="skeleton skeleton-line title" />
                <div className="skeleton skeleton-line" />
                <div className="skeleton skeleton-line medium" />
                <div className="skeleton skeleton-line short" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="coming-soon">
          <div className="coming-soon-icon">📭</div>
          <h3 className="coming-soon-title">Nothing to show</h3>
          <p className="coming-soon-desc">
            Couldn&apos;t find any {subTab} shows right now.
          </p>
        </div>
      ) : (
        <div className="watchlist-grid">
          {items.map((item, index) => {
            const { show } = item;
            const id = show.ids.trakt;
            const inWatchlist = existingIds.has(id) || addedIds.has(id);
            const poster = posterUrl(show);

            return (
              <div
                key={id || index}
                className="watchlist-card"
                style={{ animationDelay: `${index * 0.05}s` }}
              >
                <div className="watchlist-card-poster">
                  {poster ? (
                    <Image
                      src={poster}
                      alt={`${show.title} poster`}
                      width={120}
                      height={180}
                      sizes="(max-width: 768px) 96px, 120px"
                    />
                  ) : (
                    <div className="poster-placeholder" aria-hidden>📺</div>
                  )}
                  <div className="poster-time-badge">#{index + 1}</div>
                </div>

                <div className="watchlist-card-body">
                  <div className="watchlist-card-header">
                    <div className="watchlist-card-title-row">
                      <h3 className="watchlist-card-title">
                        {show.title || "Unknown"}
                      </h3>
                      {show.year && (
                        <span className="watchlist-card-year">{show.year}</span>
                      )}
                    </div>
                    {subTab === "trending" && item.watchers != null && (
                      <span className="discover-stat-badge">
                        👀 {item.watchers.toLocaleString()} watching
                      </span>
                    )}
                    {subTab === "anticipated" && item.list_count != null && (
                      <span className="discover-stat-badge">
                        📋 {item.list_count.toLocaleString()} lists
                      </span>
                    )}
                  </div>

                  {show.overview && (
                    <p className="watchlist-card-overview">{show.overview}</p>
                  )}

                  <div className="watchlist-card-meta">
                    {show.status && (
                      <span
                        className={`watchlist-badge badge-${show.status.replace(/\s+/g, "-")}`}
                      >
                        {show.status}
                      </span>
                    )}
                    {show.network && (
                      <span className="watchlist-meta-item">📡 {show.network}</span>
                    )}
                    {show.runtime && (
                      <span className="watchlist-meta-item">⏱ {show.runtime}min</span>
                    )}
                    {show.rating ? (
                      <span className="watchlist-meta-item">
                        ⭐ {show.rating.toFixed(1)}
                      </span>
                    ) : null}
                    {show.genres && show.genres.length > 0 && (
                      <span className="watchlist-meta-item">
                        🎭 {show.genres.slice(0, 3).join(", ")}
                      </span>
                    )}
                  </div>

                  {show.first_aired && (
                    <div className="episode-info-row" style={{ borderTop: "none", paddingTop: 0 }}>
                      <div className="episode-info">
                        <span className="episode-info-label">
                          {new Date(show.first_aired).getTime() > now
                            ? "Premieres"
                            : "Premiered"}
                        </span>
                        <span className="episode-info-value">
                          {new Date(show.first_aired).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: "auto" }}>
                    <button
                      type="button"
                      className="mark-watched-btn"
                      disabled={inWatchlist || addingIds[id]}
                      onClick={() => handleAdd(id)}
                    >
                      {inWatchlist
                        ? "✓ In Watchlist"
                        : addingIds[id]
                          ? "Adding…"
                          : "+ Add to Watchlist"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
