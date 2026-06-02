"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TraktShow } from "@/lib/types";
import {
  GEMINI_KEY_HEADER,
  MISSING_KEY_ERROR,
  getStoredGeminiKey,
} from "@/lib/gemini-key";
import { GeminiKeyModal } from "@/components/gemini-key-modal";

interface RecommendationCard {
  title: string;
  year: number;
  reason: string;
  genres: string[];
  show: TraktShow | null;
}

interface RecResponse {
  recommendations: RecommendationCard[];
  cached: boolean;
  generatedAt: number;
  empty?: boolean;
  error?: string;
  detail?: string;
}

const posterUrl = (show: TraktShow | null): string | null => {
  const p = show?.images?.poster?.[0];
  return p ? `https://${p.replace(/^https?:\/\//, "")}` : null;
};

export default function RecommendationsPage() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<RecResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Record<number, boolean>>({});
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);

  const fetchRecs = (refresh = false) => {
    const apiKey = getStoredGeminiKey();
    if (!apiKey) {
      setLoading(false);
      setNeedsKey(true);
      setKeyModalOpen(true);
      return;
    }
    setNeedsKey(false);
    setLoading(true);
    setError(null);
    fetch(`/api/recommendations${refresh ? "?refresh=1" : ""}`, {
      headers: { [GEMINI_KEY_HEADER]: apiKey },
    })
      .then(async (res) => {
        const json = (await res.json()) as RecResponse;
        if (!res.ok) {
          if (json.error === MISSING_KEY_ERROR) {
            setNeedsKey(true);
            setKeyModalOpen(true);
            setData(null);
            return;
          }
          setError(json.detail || json.error || "Failed to load");
          setData(null);
        } else {
          setData(json);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isAuthenticated) fetchRecs(false);
  }, [isAuthenticated]);

  const handleAdd = async (showId: number) => {
    setAddingIds((p) => ({ ...p, [showId]: true }));
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showId }),
      });
      if (res.ok) {
        setAddedIds((p) => new Set(p).add(showId));
      }
    } finally {
      setAddingIds((p) => ({ ...p, [showId]: false }));
    }
  };

  if (isLoading || !user) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p className="loading-text">Loading…</p>
      </div>
    );
  }

  return (
    <div className="dashboard">
      <div className="dashboard-container">
        <div className="dashboard-welcome">
          <h1 className="dashboard-greeting">
            <span className="dashboard-greeting-accent">AI</span> Recommendations
          </h1>
          <p className="dashboard-subtitle">
            Picked for you by Gemini based on your watch history and watchlist.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <Link href="/dashboard" className="mark-watched-btn">
              ← Back to Dashboard
            </Link>
            <button
              className="mark-watched-btn"
              onClick={() => fetchRecs(true)}
              disabled={loading}
            >
              {loading ? "Generating…" : "🔄 Regenerate"}
            </button>
            {data?.cached && (
              <span className="watchlist-meta-item" style={{ alignSelf: "center" }}>
                cached · {new Date(data.generatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>

        <section className="watchlist-section">
          {needsKey ? (
            <div className="coming-soon">
              <div className="coming-soon-icon">🔑</div>
              <h3 className="coming-soon-title">Add your Gemini API key</h3>
              <p className="coming-soon-desc">
                AI recommendations run on your own free Gemini API key. Add one to
                get started.
              </p>
              <button
                className="mark-watched-btn"
                style={{ marginTop: "1rem" }}
                onClick={() => setKeyModalOpen(true)}
              >
                🔑 Add API key
              </button>
            </div>
          ) : loading ? (
            <div className="watchlist-loading">
              <div className="loading-spinner" />
              <p className="loading-text">Asking Gemini for picks…</p>
            </div>
          ) : error ? (
            <div className="coming-soon">
              <div className="coming-soon-icon">⚠️</div>
              <h3 className="coming-soon-title">Couldn&apos;t generate recommendations</h3>
              <p className="coming-soon-desc">{error}</p>
            </div>
          ) : data?.empty ? (
            <div className="coming-soon">
              <div className="coming-soon-icon">📭</div>
              <h3 className="coming-soon-title">Not enough data yet</h3>
              <p className="coming-soon-desc">
                Add some shows to your watchlist or mark a few as watched first.
              </p>
            </div>
          ) : !data?.recommendations.length ? (
            <div className="coming-soon">
              <div className="coming-soon-icon">🤖</div>
              <h3 className="coming-soon-title">No recommendations</h3>
            </div>
          ) : (
            <div className="watchlist-grid">
              {data.recommendations.map((rec, index) => {
                const show = rec.show;
                const traktId = show?.ids?.trakt;
                const alreadyAdded = traktId ? addedIds.has(traktId) : false;
                const adding = traktId ? addingIds[traktId] : false;
                return (
                  <div
                    key={`${rec.title}-${rec.year}-${index}`}
                    className="watchlist-card"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="watchlist-card-poster">
                      {posterUrl(show) ? (
                        <Image
                          src={posterUrl(show)!}
                          alt={`${rec.title} poster`}
                          width={120}
                          height={180}
                          sizes="(max-width: 768px) 96px, 120px"
                        />
                      ) : (
                        <div className="poster-placeholder" aria-hidden>📺</div>
                      )}
                    </div>

                    <div className="watchlist-card-body">
                      <div className="watchlist-card-header">
                        <div className="watchlist-card-title-row">
                          <h3 className="watchlist-card-title">{rec.title}</h3>
                          {rec.year && (
                            <span className="watchlist-card-year">{rec.year}</span>
                          )}
                        </div>
                      </div>

                      <p className="watchlist-card-overview">
                        <strong>Why:</strong> {rec.reason}
                      </p>

                      {show?.overview && (
                        <p className="watchlist-card-overview">{show.overview}</p>
                      )}

                      <div className="watchlist-card-meta">
                        {(show?.genres ?? rec.genres).slice(0, 4).map((g) => (
                          <span key={g} className="watchlist-meta-item">
                            {g}
                          </span>
                        ))}
                        {show?.network && (
                          <span className="watchlist-meta-item">📡 {show.network}</span>
                        )}
                        {show?.rating != null && (
                          <span className="watchlist-meta-item">
                            ⭐ {show.rating.toFixed(1)}
                          </span>
                        )}
                        {show?.status && (
                          <span
                            className={`watchlist-badge badge-${show.status.replace(/\s+/g, "-")}`}
                          >
                            {show.status}
                          </span>
                        )}
                      </div>

                      <div className="episode-info-row">
                        {traktId ? (
                          <button
                            className="mark-watched-btn"
                            disabled={alreadyAdded || adding}
                            onClick={() => handleAdd(traktId)}
                          >
                            {alreadyAdded
                              ? "✓ Added"
                              : adding
                                ? "Adding…"
                                : "+ Add to Watchlist"}
                          </button>
                        ) : (
                          <span className="watchlist-meta-item">
                            (no Trakt match)
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <GeminiKeyModal
        open={keyModalOpen}
        onClose={() => setKeyModalOpen(false)}
        onSaved={() => fetchRecs(false)}
      />
    </div>
  );
}
