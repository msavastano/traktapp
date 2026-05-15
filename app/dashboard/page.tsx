"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TrackedShow } from "@/lib/types";
import { SearchShows } from "@/components/search-shows";
import { WatchedMenu } from "@/components/watched-menu";
import { UnwatchMenu } from "@/components/unwatch-menu";
import { NewsModal } from "@/components/news-modal";

const posterUrl = (s: TrackedShow): string | null => {
  const p = s.show.images?.poster?.[0];
  return p ? `https://${p.replace(/^https?:\/\//, "")}` : null;
};

interface WatchlistResponse {
  shows: TrackedShow[];
  pagination: {
    page: string | null;
    limit: string | null;
    pageCount: string | null;
    itemCount: string | null;
  };
}

type Tab = "tracking" | "watchlist";
type Filter = "all" | "upcoming" | "waiting" | "behind" | "completed";

const VALID_TABS: Tab[] = ["tracking", "watchlist"];
const VALID_FILTERS: Filter[] = ["all", "upcoming", "waiting", "behind", "completed"];

const RAW_STORAGE_KEY = "dashboard.showRaw";

export default function Dashboard() {
  return (
    <Suspense
      fallback={
        <div className="loading-screen">
          <div className="loading-spinner" />
          <p className="loading-text">Loading dashboard…</p>
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}

function DashboardInner() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const initialTab: Tab = (() => {
    const v = searchParams.get("tab");
    return VALID_TABS.includes(v as Tab) ? (v as Tab) : "tracking";
  })();
  const initialFilter: Filter = (() => {
    const v = searchParams.get("filter");
    return VALID_FILTERS.includes(v as Filter) ? (v as Filter) : "all";
  })();

  const [shows, setShows] = useState<TrackedShow[]>([]);
  const [, setPagination] = useState<WatchlistResponse["pagination"] | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  // Keyed by trakt show id so it survives sort/filter changes.
  const [showRaw, setShowRaw] = useState<number | null>(null);
  const [markingIds, setMarkingIds] = useState<Record<number, boolean>>({});
  const [bulkMarking, setBulkMarking] = useState<Record<number, boolean>>({});
  const [unwatching, setUnwatching] = useState<Record<number, boolean>>({});
  const [newsOpenFor, setNewsOpenFor] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [filter, setFilter] = useState<Filter>(initialFilter);

  // Restore showRaw from sessionStorage on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(RAW_STORAGE_KEY);
    if (!stored) return;
    const n = Number(stored);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (Number.isFinite(n)) setShowRaw(n);
  }, []);

  // Persist showRaw + sync tab/filter to URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (showRaw === null) window.sessionStorage.removeItem(RAW_STORAGE_KEY);
    else window.sessionStorage.setItem(RAW_STORAGE_KEY, String(showRaw));
  }, [showRaw]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "tracking") params.set("tab", activeTab);
    if (filter !== "all") params.set("filter", filter);
    const qs = params.toString();
    const url = qs ? `/dashboard?${qs}` : "/dashboard";
    router.replace(url, { scroll: false });
  }, [activeTab, filter, router]);

  const fetchWatchlist = (silent = false) => {
    if (!silent) setWatchlistLoading(true);
    fetch("/api/watchlist")
      .then((res) => res.json())
      .then((data: WatchlistResponse) => {
        setShows(data.shows || []);
        setPagination(data.pagination || null);
      })
      .catch(console.error)
      .finally(() => {
        if (!silent) setWatchlistLoading(false);
      });
  };

  // Optimistically bump a show's progress by one episode and clear nextEpisode
  // (we don't know the next-next without a refetch). Server refetch reconciles.
  const optimisticMarkEpisode = (episodeId: number) => {
    setShows((prev) =>
      prev.map((s) => {
        if (s.progress.nextEpisode?.id !== episodeId) return s;
        const newCompleted = s.progress.completed + 1;
        const newUnwatched = Math.max(0, s.progress.unwatchedCount - 1);
        const newPercent =
          s.progress.aired > 0
            ? Math.round((newCompleted / s.progress.aired) * 100)
            : 0;
        return {
          ...s,
          progress: {
            ...s.progress,
            completed: newCompleted,
            unwatchedCount: newUnwatched,
            percentWatched: newPercent,
            isFullyCaughtUp: newCompleted >= s.progress.aired,
            lastEpisode: s.progress.nextEpisode,
            nextEpisode: null,
          },
        };
      })
    );
  };

  const handleMarkWatched = async (episodeId: number) => {
    setMarkingIds((prev) => ({ ...prev, [episodeId]: true }));
    optimisticMarkEpisode(episodeId);
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId }),
      });
      if (!res.ok) console.error("Failed to mark as watched");
    } catch (err) {
      console.error(err);
    } finally {
      setMarkingIds((prev) => ({ ...prev, [episodeId]: false }));
      // Reconcile in background — Trakt's /sync/watched has a few seconds of
      // propagation delay, so the optimistic state stays visible meanwhile.
      fetchWatchlist(true);
    }
  };

  // Optimistically mark a whole season or show as fully watched.
  const optimisticMarkBulk = (showId: number, season?: number) => {
    setShows((prev) =>
      prev.map((s) => {
        if (s.show.ids.trakt !== showId) return s;
        if (typeof season === "number") {
          const seasons = s.progress.seasons.map((sn) =>
            sn.number === season
              ? { ...sn, completed: sn.aired, isFullyWatched: true }
              : sn
          );
          const completed = seasons.reduce((sum, sn) => sum + sn.completed, 0);
          return {
            ...s,
            progress: {
              ...s.progress,
              seasons,
              completed,
              unwatchedCount: Math.max(0, s.progress.aired - completed),
              percentWatched:
                s.progress.aired > 0
                  ? Math.round((completed / s.progress.aired) * 100)
                  : 0,
              isFullyCaughtUp: completed >= s.progress.aired,
              nextEpisode: null,
            },
          };
        }
        return {
          ...s,
          progress: {
            ...s.progress,
            seasons: s.progress.seasons.map((sn) => ({
              ...sn,
              completed: sn.aired,
              isFullyWatched: true,
            })),
            completed: s.progress.aired,
            unwatchedCount: 0,
            percentWatched: 100,
            isFullyCaughtUp: true,
            nextEpisode: null,
          },
        };
      })
    );
  };

  // Optimistic unwatch: episode (decrement by 1) or season (zero that season).
  const optimisticUnwatch = (
    showId: number,
    mode: { kind: "episode" } | { kind: "season"; season: number }
  ) => {
    setShows((prev) =>
      prev.map((s) => {
        if (s.show.ids.trakt !== showId) return s;
        if (mode.kind === "episode") {
          const newCompleted = Math.max(0, s.progress.completed - 1);
          return {
            ...s,
            progress: {
              ...s.progress,
              completed: newCompleted,
              unwatchedCount: s.progress.aired - newCompleted,
              percentWatched:
                s.progress.aired > 0
                  ? Math.round((newCompleted / s.progress.aired) * 100)
                  : 0,
              isFullyCaughtUp: false,
              lastEpisode: null,
              nextEpisode: null,
            },
          };
        }
        const seasons = s.progress.seasons.map((sn) =>
          sn.number === mode.season
            ? { ...sn, completed: 0, isFullyWatched: false }
            : sn
        );
        const completed = seasons.reduce((sum, sn) => sum + sn.completed, 0);
        return {
          ...s,
          progress: {
            ...s.progress,
            seasons,
            completed,
            unwatchedCount: s.progress.aired - completed,
            percentWatched:
              s.progress.aired > 0
                ? Math.round((completed / s.progress.aired) * 100)
                : 0,
            isFullyCaughtUp: completed >= s.progress.aired,
            lastEpisode: null,
            nextEpisode: null,
          },
        };
      })
    );
  };

  const handleUnwatch = async (
    showId: number,
    body: { episodeId?: number; showId?: number; season?: number },
    mode: { kind: "episode" } | { kind: "season"; season: number }
  ) => {
    setUnwatching((prev) => ({ ...prev, [showId]: true }));
    optimisticUnwatch(showId, mode);
    try {
      const res = await fetch("/api/history", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.error("Failed to unwatch");
    } catch (err) {
      console.error(err);
    } finally {
      setUnwatching((prev) => ({ ...prev, [showId]: false }));
      fetchWatchlist(true);
    }
  };

  const handleMarkBulk = async (
    showId: number,
    body: { showId: number; season?: number }
  ) => {
    setBulkMarking((prev) => ({ ...prev, [showId]: true }));
    optimisticMarkBulk(showId, body.season);
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) console.error("Failed to mark bulk watched");
    } catch (err) {
      console.error(err);
    } finally {
      setBulkMarking((prev) => ({ ...prev, [showId]: false }));
      fetchWatchlist(true);
    }
  };

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push("/");
    }
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchWatchlist();
    }
  }, [isAuthenticated]);

  const existingShowIds = useMemo(
    () => new Set(shows.map((s) => s.show.ids.trakt).filter(Boolean) as number[]),
    [shows]
  );

  if (isLoading || !user) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p className="loading-text">Loading your profile…</p>
      </div>
    );
  }

  // Split shows into active tracking vs watchlist
  const trackingShows = shows.filter((s) => s.trackingStatus !== "not_started");
  const watchlistShows = shows.filter((s) => s.trackingStatus === "not_started");

  // Air date of the next unwatched episode (past or future).
  // Falls back to the globally-upcoming episode for caught-up shows where
  // Trakt's progress.next_episode is null but a future ep is scheduled.
  // Returns null if no air date is known (e.g. all episodes watched).
  const nextUnwatchedAirTime = (s: TrackedShow): number | null => {
    const candidate =
      s.progress.nextEpisode?.firstAired ??
      s.progress.upcomingEpisode?.firstAired ??
      null;
    if (!candidate) return null;
    const t = new Date(candidate).getTime();
    return Number.isFinite(t) ? t : null;
  };

  // Sort: by closeness of next-unwatched air date to now (smallest
  // |airDate - now| first). Past episodes recently aired bubble to the top
  // of the Behind bucket; future episodes airing soon bubble to the top of
  // the Upcoming bucket. Shows with no next-unwatched air date sort
  // alphabetically at the end.
  const now = Date.now();
  const compareShows = (a: TrackedShow, b: TrackedShow) => {
    const ta = nextUnwatchedAirTime(a);
    const tb = nextUnwatchedAirTime(b);
    if (ta !== null && tb !== null) return Math.abs(ta - now) - Math.abs(tb - now);
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return (a.show.title ?? "").localeCompare(b.show.title ?? "");
  };

  trackingShows.sort(compareShows);
  watchlistShows.sort(compareShows);

  // Compute summary stats for Tracking.
  // Caught-up shows split into two buckets:
  //   - "upcoming" — caught up AND next episode has a known air date
  //   - "waiting"  — caught up AND no known next-episode air date
  const upcomingCount = trackingShows.filter(
    (s) => s.trackingStatus === "waiting_new_episodes"
  ).length;
  const waitingCount = trackingShows.filter(
    (s) => s.trackingStatus === "waiting_new_season" || s.trackingStatus === "caught_up"
  ).length;
  const behindCount = trackingShows.filter((s) => s.trackingStatus === "behind").length;
  const completedCount = trackingShows.filter((s) => s.trackingStatus === "completed").length;

  const filteredTrackingShows = trackingShows.filter((s) => {
    if (filter === "all") return true;
    if (filter === "upcoming") return s.trackingStatus === "waiting_new_episodes";
    if (filter === "waiting") {
      return (
        s.trackingStatus === "waiting_new_season" ||
        s.trackingStatus === "caught_up"
      );
    }
    return s.trackingStatus === filter;
  });

  // The list of shows currently being viewed based on the active tab
  const displayedShows = activeTab === "tracking" ? filteredTrackingShows : watchlistShows;

  return (
    <div className="dashboard" id="dashboard-page">
      <div className="dashboard-container">
        <div className="dashboard-welcome">
          <h1 className="dashboard-greeting">
            Welcome back,{" "}
            <span className="dashboard-greeting-accent">
              {user.name || user.username}
            </span>
          </h1>
          <p className="dashboard-subtitle">
            {watchlistLoading
              ? "Loading your watchlist…"
              : `${shows.length} total shows`}
          </p>
          <div style={{ marginTop: "1rem" }}>
            <Link href="/recommendations" className="mark-watched-btn">
              ✨ AI Recommendations
            </Link>
          </div>
        </div>

        <SearchShows existingIds={existingShowIds} onAdded={fetchWatchlist} />

        <div className="dashboard-tabs">
          <button 
            className={`tab-btn ${activeTab === "tracking" ? "active" : ""}`}
            onClick={() => setActiveTab("tracking")}
          >
            Tracking ({trackingShows.length})
          </button>
          <button 
            className={`tab-btn ${activeTab === "watchlist" ? "active" : ""}`}
            onClick={() => setActiveTab("watchlist")}
          >
            Watchlist ({watchlistShows.length})
          </button>
        </div>

        {activeTab === "tracking" && (
        <div className="stats-grid">
          <div
            className={`stat-card ${filter === "upcoming" ? "active" : ""}`}
            onClick={() => setFilter(filter === "upcoming" ? "all" : "upcoming")}
          >
            <div className="stat-icon">📅</div>
            <div className="stat-label">Upcoming</div>
            <div className="stat-value">
              {watchlistLoading ? "…" : upcomingCount}
            </div>
          </div>
          <div
            className={`stat-card ${filter === "waiting" ? "active" : ""}`}
            onClick={() => setFilter(filter === "waiting" ? "all" : "waiting")}
          >
            <div className="stat-icon">⏳</div>
            <div className="stat-label">Waiting</div>
            <div className="stat-value">
              {watchlistLoading ? "…" : waitingCount}
            </div>
          </div>
          <div
            className={`stat-card ${filter === "behind" ? "active" : ""}`}
            onClick={() => setFilter(filter === "behind" ? "all" : "behind")}
          >
            <div className="stat-icon">📺</div>
            <div className="stat-label">Behind</div>
            <div className="stat-value">
              {watchlistLoading ? "…" : behindCount}
            </div>
          </div>
          <div
            className={`stat-card ${filter === "completed" ? "active" : ""}`}
            onClick={() => setFilter(filter === "completed" ? "all" : "completed")}
          >
            <div className="stat-icon">🏁</div>
            <div className="stat-label">Completed</div>
            <div className="stat-value">
              {watchlistLoading ? "…" : completedCount}
            </div>
          </div>
          <div
            className={`stat-card ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            <div className="stat-icon">📊</div>
            <div className="stat-label">Total</div>
            <div className="stat-value">
              {watchlistLoading ? "…" : trackingShows.length}
            </div>
          </div>
        </div>
        )}

        <section className="watchlist-section">
          <h2 className="section-title">
            {activeTab === "tracking" ? "Up Next" : "Plan to Watch"}
          </h2>

          {watchlistLoading ? (
            <div className="watchlist-grid" aria-busy="true" aria-label="Loading watchlist">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="skeleton-card">
                  <div className="skeleton skeleton-poster" />
                  <div className="skeleton-body">
                    <div className="skeleton skeleton-line title" />
                    <div className="skeleton skeleton-line" />
                    <div className="skeleton skeleton-line medium" />
                    <div className="skeleton skeleton-line bar" />
                    <div className="skeleton skeleton-line short" />
                  </div>
                </div>
              ))}
            </div>
          ) : shows.length === 0 ? (
            <div className="coming-soon">
              <div className="coming-soon-icon">📭</div>
              <h3 className="coming-soon-title">Watchlist is empty</h3>
              <p className="coming-soon-desc">
                Add shows to your watchlist on Trakt to see them here.
              </p>
            </div>
          ) : displayedShows.length === 0 ? (
            <div className="coming-soon">
              <div className="coming-soon-icon">🔍</div>
              <h3 className="coming-soon-title">No shows found</h3>
              <p className="coming-soon-desc">
                {activeTab === "tracking" 
                  ? "Try selecting a different category above."
                  : "Add some shows to your watchlist!"}
              </p>
            </div>
          ) : (
            <div className="watchlist-grid">
              {displayedShows.map((tracked, index) => {
                const { show, progress, trackingStatus, statusLabel } = tracked;
                const ids = show.ids;

                const hasKnownAirDate =
                  Boolean(progress.upcomingEpisode?.firstAired) ||
                  Boolean(
                    progress.nextEpisode?.firstAired &&
                      !progress.nextEpisode.isAired
                  );
                const showNewsButton =
                  show.status?.toLowerCase() === "returning series" &&
                  !hasKnownAirDate;

                return (
                  <div
                    key={ids.trakt || index}
                    className="watchlist-card"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="watchlist-card-poster">
                      {posterUrl(tracked) ? (
                        <Image
                          src={posterUrl(tracked)!}
                          alt={`${show.title} poster`}
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
                        <h3 className="watchlist-card-title">
                          {show.title || "Unknown"}
                        </h3>
                        {show.year && (
                          <span className="watchlist-card-year">{show.year}</span>
                        )}
                      </div>
                      <span className={`tracking-status-badge status-${trackingStatus}`}>
                        {statusLabel}
                      </span>
                    </div>

                    {show.overview && (
                      <p className="watchlist-card-overview">{show.overview}</p>
                    )}

                    {/* Progress bar */}
                    <div className="progress-bar-container">
                      <div className="progress-bar-track">
                        <div
                          className="progress-bar-fill"
                          style={{ width: `${progress.percentWatched}%` }}
                        />
                      </div>
                      <span className="progress-bar-label">
                        {progress.completed}/{progress.aired} episodes
                        ({progress.percentWatched}%)
                      </span>
                    </div>

                    {progress.upcomingInSeason && (
                      <div className="season-remaining">
                        📅 {progress.upcomingInSeason.remaining} episode
                        {progress.upcomingInSeason.remaining !== 1 ? "s" : ""}
                        {" "}left to air in Season {progress.upcomingInSeason.season}
                      </div>
                    )}

                    {showNewsButton && (
                      <button
                        type="button"
                        className="news-btn"
                        onClick={() => setNewsOpenFor(ids.trakt)}
                      >
                        📰 Latest news
                      </button>
                    )}

                    {showNewsButton && (
                      <NewsModal
                        open={newsOpenFor === ids.trakt}
                        showTitle={show.title}
                        showYear={show.year}
                        onClose={() => setNewsOpenFor(null)}
                      />
                    )}


                    {/* Key info */}
                    <div className="watchlist-card-meta">
                      {show.status && (
                        <span className={`watchlist-badge badge-${show.status?.replace(/\s+/g, "-")}`}>
                          {show.status}
                        </span>
                      )}
                      <span className="watchlist-meta-item">
                        📺 {progress.totalSeasons} season{progress.totalSeasons !== 1 ? "s" : ""}
                      </span>
                      {show.network && (
                        <span className="watchlist-meta-item">
                          📡 {show.network}
                        </span>
                      )}
                      {show.runtime && (
                        <span className="watchlist-meta-item">
                          ⏱ {show.runtime}min
                        </span>
                      )}
                      {show.rating && (
                        <span className="watchlist-meta-item">
                          ⭐ {show.rating.toFixed(1)}
                        </span>
                      )}
                    </div>

                    {/* Where left off / Next episode */}
                    <div className="episode-info-row">
                      {progress.lastEpisode && (
                        <div className="episode-info">
                          <span className="episode-info-label">Last watched</span>
                          <span className="episode-info-value">
                            S{String(progress.lastEpisode.season).padStart(2, "0")}
                            E{String(progress.lastEpisode.episode).padStart(2, "0")}
                            {" · "}{progress.lastEpisode.title}
                            {" "}
                            <UnwatchMenu
                              showTitle={show.title}
                              episodeLabel={`S${String(progress.lastEpisode.season).padStart(2, "0")}E${String(progress.lastEpisode.episode).padStart(2, "0")} · ${progress.lastEpisode.title}`}
                              episodeSeason={progress.lastEpisode.season}
                              busy={unwatching[ids.trakt]}
                              onUnwatchEpisode={() =>
                                handleUnwatch(
                                  ids.trakt,
                                  { episodeId: progress.lastEpisode!.id },
                                  { kind: "episode" }
                                )
                              }
                              onUnwatchSeason={() =>
                                handleUnwatch(
                                  ids.trakt,
                                  { showId: ids.trakt, season: progress.lastEpisode!.season },
                                  { kind: "season", season: progress.lastEpisode!.season }
                                )
                              }
                            />
                          </span>
                        </div>
                      )}
                      {progress.nextEpisode && (
                        <div className="episode-info">
                          <span className="episode-info-label">Next to watch</span>
                          <span className="episode-info-value">
                            S{String(progress.nextEpisode.season).padStart(2, "0")}
                            E{String(progress.nextEpisode.episode).padStart(2, "0")}
                            {" · "}{progress.nextEpisode.title}
                            {progress.nextEpisode.firstAired && !progress.nextEpisode.isAired && (
                              <span className="air-date">
                                {" "}(airs {new Date(progress.nextEpisode.firstAired).toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                              </span>
                            )}
                            {progress.nextEpisode.isAired && (
                              <span className="mark-watched-group">
                                <button
                                  className="mark-watched-btn"
                                  disabled={markingIds[progress.nextEpisode.id] || bulkMarking[ids.trakt]}
                                  onClick={() => handleMarkWatched(progress.nextEpisode!.id)}
                                >
                                  {markingIds[progress.nextEpisode.id] ? "..." : "Mark Watched ✓"}
                                </button>
                                <WatchedMenu
                                  showTitle={show.title}
                                  seasonNumber={progress.nextEpisode.season}
                                  busy={bulkMarking[ids.trakt]}
                                  onMarkSeason={() =>
                                    handleMarkBulk(ids.trakt, {
                                      showId: ids.trakt,
                                      season: progress.nextEpisode!.season,
                                    })
                                  }
                                  onMarkShow={() =>
                                    handleMarkBulk(ids.trakt, { showId: ids.trakt })
                                  }
                                />
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                      {progress.upcomingEpisode && progress.isFullyCaughtUp && (
                        <div className="episode-info">
                          <span className="episode-info-label">Upcoming</span>
                          <span className="episode-info-value">
                            S{String(progress.upcomingEpisode.season).padStart(2, "0")}
                            E{String(progress.upcomingEpisode.episode).padStart(2, "0")}
                            {" · "}{progress.upcomingEpisode.title}
                            {progress.upcomingEpisode.firstAired && (
                              <span className="air-date">
                                {" "}({new Date(progress.upcomingEpisode.firstAired).toLocaleDateString("en-US", { month: "short", day: "numeric" })})
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>


                    {/* Raw JSON toggle */}
                    <button
                      className="raw-toggle"
                      onClick={() =>
                        setShowRaw(showRaw === ids.trakt ? null : ids.trakt)
                      }
                    >
                      {showRaw === ids.trakt ? "Hide" : "Show"} raw data
                    </button>

                    {showRaw === ids.trakt && (
                      <pre className="raw-json">
                        {JSON.stringify(tracked, null, 2)}
                      </pre>
                    )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
