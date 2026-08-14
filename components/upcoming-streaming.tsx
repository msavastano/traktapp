"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { UpcomingStreamingRelease, SimklMovie } from "@/lib/types";
import { posterFrom, simklMovieUrl } from "@/lib/images";

const posterUrl = (movie: SimklMovie): string | null => posterFrom(movie);

export function UpcomingStreaming() {
  const [items, setItems] = useState<UpcomingStreamingRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/upcoming-streaming");
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setItems(json.releases ?? []);
      } catch (err) {
        console.error("UpcomingStreaming fetch error:", err);
        if (!cancelled) setError("Failed to load upcoming releases. Try again later.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="search-error">{error}</div>;

  if (items === null) {
    return (
      <div className="watchlist-grid" aria-busy="true" aria-label="Loading upcoming streaming releases">
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
    );
  }

  if (items.length === 0) {
    return (
      <div className="coming-soon">
        <div className="coming-soon-icon">🎬</div>
        <h3 className="coming-soon-title">Nothing detected right now</h3>
        <p className="coming-soon-desc">
          We look for movies with an announced streaming window in Trakt&apos;s
          release data — coverage depends on what&apos;s been logged there, so
          this list can be short or empty. Check back later.
        </p>
      </div>
    );
  }

  return (
    <div className="watchlist-grid">
      {items.map(({ movie, releaseDate }, index) => {
        const poster = posterUrl(movie);
        const dateStr = new Date(releaseDate).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
        return (
          <div
            key={movie.ids.simkl || index}
            className="watchlist-card"
            style={{ animationDelay: `${index * 0.05}s` }}
          >
            <div className="watchlist-card-poster">
              {poster ? (
                <Image
                  src={poster}
                  alt={`${movie.title} poster`}
                  width={120}
                  height={180}
                  sizes="(max-width: 768px) 96px, 120px"
                />
              ) : (
                <div className="poster-placeholder" aria-hidden>🎬</div>
              )}
              <div className="poster-time-badge">{dateStr}</div>
            </div>

            <div className="watchlist-card-body">
              <div className="watchlist-card-header">
                <div className="watchlist-card-title-row">
                  <h3 className="watchlist-card-title">
                    <a
                      className="simkl-link"
                      href={simklMovieUrl(movie.ids.simkl, movie.ids.slug)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {movie.title || "Unknown"}
                    </a>
                  </h3>
                  {movie.year && <span className="watchlist-card-year">{movie.year}</span>}
                </div>
                <span className="streaming-badge">📅 Releasing {dateStr}</span>
              </div>

              {movie.overview && (
                <p className="watchlist-card-overview">{movie.overview}</p>
              )}

              <div className="watchlist-card-meta">
                {movie.runtime && (
                  <span className="watchlist-meta-item">⏱ {movie.runtime}min</span>
                )}
                {movie.rating ? (
                  <span className="watchlist-meta-item">⭐ {movie.rating.toFixed(1)}</span>
                ) : null}
                {movie.genres && movie.genres.length > 0 && (
                  <span className="watchlist-meta-item">
                    🎭 {movie.genres.slice(0, 3).join(", ")}
                  </span>
                )}
              </div>

              <div className="episode-info-row" style={{ borderTop: "none", paddingTop: 0 }}>
                <div className="episode-info">
                  <span className="episode-info-label">Releases</span>
                  <span className="episode-info-value">{dateStr}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
