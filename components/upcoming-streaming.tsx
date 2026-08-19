"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { StreamingRelease } from "@/lib/types";
import { tmdbMovieUrl, tmdbPosterUrl } from "@/lib/images";

interface StreamingPayload {
  releases: StreamingRelease[];
  services: Record<string, string>;
  region: string;
}

export function UpcomingStreaming() {
  const [data, setData] = useState<StreamingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/upcoming-streaming");
        if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        console.error("UpcomingStreaming fetch error:", err);
        if (!cancelled) setError("Failed to load streaming releases. Try again later.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="search-error">{error}</div>;

  if (data === null) {
    return (
      <div className="watchlist-grid" aria-busy="true" aria-label="Loading streaming releases">
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

  const { releases, services } = data;

  if (releases.length === 0) {
    return (
      <div className="coming-soon">
        <div className="coming-soon-icon">🎬</div>
        <h3 className="coming-soon-title">Nothing to show right now</h3>
        <p className="coming-soon-desc">
          We look for recent movies included with a subscription to Netflix,
          Disney+, Paramount+, Prime Video, Apple TV+, Peacock, HBO Max or
          AMC+. Rentals and purchases are excluded. Check back later.
        </p>
      </div>
    );
  }

  return (
    <>
      <p className="streaming-caveat">
        Included with a subscription — rentals and purchases are excluded.
        Sorted by release date; a title appearing here is streaming{" "}
        <em>now</em>, since no provider publishes future streaming dates.
      </p>

      <div className="watchlist-grid">
        {releases.map(({ movie, releaseDate, serviceKeys, watchLink }, index) => {
          const poster = tmdbPosterUrl(movie.posterPath);
          const dateStr = new Date(`${releaseDate}T00:00:00Z`).toLocaleDateString(
            "en-US",
            { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
          );
          return (
            <div
              key={movie.tmdbId}
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
                        href={watchLink ?? tmdbMovieUrl(movie.tmdbId)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {movie.title}
                      </a>
                    </h3>
                    {movie.year && (
                      <span className="watchlist-card-year">{movie.year}</span>
                    )}
                  </div>

                  <div className="service-badges">
                    {serviceKeys.map((key) => (
                      <span key={key} className={`service-badge service-${key}`}>
                        {services[key] ?? key}
                      </span>
                    ))}
                  </div>
                </div>

                {movie.overview && (
                  <p className="watchlist-card-overview">{movie.overview}</p>
                )}

                <div className="watchlist-card-meta">
                  <span className="watchlist-meta-item">📅 Released {dateStr}</span>
                  {movie.rating ? (
                    <span className="watchlist-meta-item">
                      ⭐ {movie.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/*
        Required by TMDB's terms for this endpoint: "In order to use this data
        you must attribute the source of the data as JustWatch." Removing this
        credit is grounds for TMDB revoking API access — leave it in place.
      */}
      <p className="data-attribution">
        Streaming availability data provided by{" "}
        <a href="https://www.justwatch.com/" target="_blank" rel="noopener noreferrer">
          JustWatch
        </a>{" "}
        via{" "}
        <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
          TMDB
        </a>
        . This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </>
  );
}
