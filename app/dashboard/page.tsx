"use client";

import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { TrackedShow, NextEpisodeInfo } from "@/lib/types";
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

type Tab = "tracking" | "watchlist" | "calendar";
type Filter = "all" | "upcoming" | "waiting" | "behind" | "completed";

const VALID_TABS: Tab[] = ["tracking", "watchlist", "calendar"];
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

  // Calendar feature states & helpers
  interface CalendarItem {
    first_aired: string;
    episode: {
      season: number;
      number: number;
      title: string;
      ids: {
        trakt: number;
        tvdb: number | null;
        imdb: string | null;
        tmdb: number | null;
      };
      overview?: string;
      runtime?: number;
    };
    show: {
      title: string;
      year: number | null;
      ids: {
        trakt: number;
        slug: string;
        tvdb: number | null;
        imdb: string | null;
        tmdb: number | null;
      };
    };
  }

  const [calendarEpisodes, setCalendarEpisodes] = useState<CalendarItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });

  const getCalendarDays = () => {
    const days: { dateStr: string; label: string; dateNum: string; dayName: string; monthStr: string }[] = [];
    const base = new Date();
    for (let i = -3; i <= 7; i++) {
      const d = new Date();
      d.setDate(base.getDate() + i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      const dayName = d.toLocaleDateString("en-US", { weekday: "short" });
      const monthStr = d.toLocaleDateString("en-US", { month: "short" });
      const dateNum = String(d.getDate());
      const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
      
      days.push({ dateStr, label, dateNum, dayName, monthStr });
    }
    return days;
  };

  const daysList = useMemo(() => getCalendarDays(), []);

  const selectedMonthTitle = useMemo(() => {
    if (!selectedDate) return "";
    const parts = selectedDate.split("-");
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }, [selectedDate]);

  const calendarGroupedByDate = useMemo(() => {
    const groups: Record<string, CalendarItem[]> = {};
    for (const item of calendarEpisodes) {
      if (!item.first_aired) continue;
      const d = new Date(item.first_aired);
      if (isNaN(d.getTime())) continue;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(item);
    }
    return groups;
  }, [calendarEpisodes]);

  const countEpisodesForDate = (dateStr: string) => {
    return calendarGroupedByDate[dateStr]?.length || 0;
  };

  const findCalendarPoster = (calendarShowId: number): string | null => {
    const matched = shows.find((s) => s.show.ids.trakt === calendarShowId);
    if (!matched) return null;
    return posterUrl(matched);
  };

  const isEpisodeWatched = (showId: number, season: number, number: number): boolean => {
    const matched = shows.find((s) => s.show.ids.trakt === showId);
    if (!matched || !matched.progress?.watchedEpisodes) return false;
    const key = `${season}-${number}`;
    return !!matched.progress.watchedEpisodes[key];
  };

  const fetchCalendar = async (silent = false) => {
    if (!silent) setCalendarLoading(true);
    try {
      const localToday = new Date();
      const localThreeDaysAgo = new Date(localToday);
      localThreeDaysAgo.setDate(localToday.getDate() - 3);
      const start_date = `${localThreeDaysAgo.getFullYear()}-${String(localThreeDaysAgo.getMonth() + 1).padStart(2, '0')}-${String(localThreeDaysAgo.getDate()).padStart(2, '0')}`;
      
      const res = await fetch(`/api/calendar?start_date=${start_date}&days=11`);
      if (!res.ok) {
        throw new Error(`Failed to fetch calendar: ${res.status}`);
      }
      const data = await res.json();
      setCalendarEpisodes(data);
    } catch (err) {
      console.error("fetchCalendar error:", err);
    } finally {
      if (!silent) setCalendarLoading(false);
    }
  };

  const optimisticMarkCalendarEpisode = (showId: number, season: number, episodeNumber: number) => {
    setShows((prev) =>
      prev.map((s) => {
        if (s.show.ids.trakt !== showId) return s;
        const watchedEpisodes = { ...(s.progress.watchedEpisodes || {}) };
        watchedEpisodes[`${season}-${episodeNumber}`] = true;
        
        let newCompleted = s.progress.completed;
        const key = `${season}-${episodeNumber}`;
        if (!s.progress.watchedEpisodes || !s.progress.watchedEpisodes[key]) {
          newCompleted += 1;
        }
        const newUnwatched = Math.max(0, s.progress.unwatchedCount - 1);
        const newPercent =
          s.progress.aired > 0
            ? Math.round((newCompleted / s.progress.aired) * 100)
            : 0;
            
        const isNext = s.progress.nextEpisode?.season === season && s.progress.nextEpisode?.episode === episodeNumber;
        
        return {
          ...s,
          progress: {
            ...s.progress,
            completed: newCompleted,
            unwatchedCount: newUnwatched,
            percentWatched: newPercent,
            isFullyCaughtUp: newCompleted >= s.progress.aired,
            nextEpisode: isNext ? null : s.progress.nextEpisode,
            watchedEpisodes,
          },
        };
      })
    );
  };

  const handleMarkCalendarEpisode = async (
    showId: number,
    slug: string,
    episodeId: number,
    season: number,
    episodeNumber: number
  ) => {
    setMarkingIds((prev) => ({ ...prev, [episodeId]: true }));
    optimisticMarkCalendarEpisode(showId, season, episodeNumber);
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
      fetchWatchlist(true);
    }
  };

  const handleDayClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    const element = document.getElementById(`date-group-${dateStr}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handlePrevDay = () => {
    const idx = daysList.findIndex(d => d.dateStr === selectedDate);
    if (idx > 0) {
      handleDayClick(daysList[idx - 1].dateStr);
    }
  };

  const handleNextDay = () => {
    const idx = daysList.findIndex(d => d.dateStr === selectedDate);
    if (idx < daysList.length - 1) {
      handleDayClick(daysList[idx + 1].dateStr);
    }
  };

  const handleToday = () => {
    const todayStr = (() => {
      const d = new Date();
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    })();
    const exists = daysList.some(d => d.dateStr === todayStr);
    if (exists) {
      handleDayClick(todayStr);
    }
  };

  const getLocalTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const getAirTimeStr = (firstAiredStr?: string | null) => {
    if (!firstAiredStr) return "";
    const d = new Date(firstAiredStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isEpisodeAired = (firstAiredStr?: string | null) => {
    if (!firstAiredStr) return false;
    const d = new Date(firstAiredStr);
    return d.getTime() <= Date.now();
  };
  // Ephemeral skip map — survives refetches within a session but not page reload.
  // Trakt has no native skip concept, so skips are client-only.
  // Maps: skipped episode id -> the next episode we advanced the user to.
  // Used to re-apply skips after a server refetch (chain via repeated lookup).
  const skippedEpisodeMapRef = useRef<Map<number, NextEpisodeInfo | null>>(
    new Map()
  );
  const [skipPending, setSkipPending] = useState<Record<number, boolean>>({});
  const [now] = useState(() => Date.now());

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

  const applySkips = (list: TrackedShow[]): TrackedShow[] => {
    const skipMap = skippedEpisodeMapRef.current;
    if (skipMap.size === 0) return list;
    return list.map((s) => {
      if (!s.progress) return s;
      let ne = s.progress.nextEpisode;
      let lastEp = s.progress.lastEpisode;
      let completed = s.progress.completed;
      let hops = 0;
      // Walk the skip chain. Bounded by the map size to avoid infinite loops.
      while (ne && skipMap.has(ne.id) && hops <= skipMap.size) {
        lastEp = ne;
        completed += 1;
        ne = skipMap.get(ne.id) ?? null;
        hops += 1;
      }
      if (completed === s.progress.completed) return s;
      const unwatched = Math.max(0, s.progress.aired - completed);
      const percent =
        s.progress.aired > 0
          ? Math.round((completed / s.progress.aired) * 100)
          : 0;
      return {
        ...s,
        progress: {
          ...s.progress,
          completed,
          unwatchedCount: unwatched,
          percentWatched: percent,
          isFullyCaughtUp: completed >= s.progress.aired,
          lastEpisode: lastEp,
          nextEpisode: ne,
        },
      };
    });
  };

  const fetchWatchlist = async (silent = false) => {
    if (!silent) setWatchlistLoading(true);
    try {
      const response = await fetch("/api/watchlist?stream=true");
      if (!response.ok) {
        throw new Error(`Failed to fetch watchlist: ${response.status}`);
      }

      const contentType = response.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        const data = await response.json();
        const showsWithFlags = (data.shows || []).map((s: TrackedShow) => ({
          ...s,
          isEnriched: true,
        }));
        setShows(applySkips(showsWithFlags));
        setPagination(data.pagination || null);
        if (!silent) setWatchlistLoading(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body reader");
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === "metadata") {
              const incomingShows = data.shows || [];
              setShows((prev) => {
                const prevMap = new Map(prev.map((s) => [s.show.ids.trakt, s]));
                const merged = incomingShows.map((s: TrackedShow) => {
                  const existing = prevMap.get(s.show.ids.trakt);
                  if (existing && existing.isEnriched) {
                    return existing;
                  }
                  return {
                    ...s,
                    isEnriched: false,
                  };
                });
                return applySkips(merged);
              });
              setPagination(data.pagination || null);
              if (!silent) setWatchlistLoading(false);
            } else if (data.type === "enrich") {
              setShows((prev) => {
                const updated = prev.map((s) =>
                  s.show.ids.trakt === data.showId
                    ? { ...data.enriched, isEnriched: true }
                    : s
                );
                return applySkips(updated);
              });
            } else if (data.type === "error") {
              setShows((prev) => {
                const updated = prev.map((s) =>
                  s.show.ids.trakt === data.showId
                    ? { ...s, isEnriched: true, enrichmentError: true }
                    : s
                );
                return applySkips(updated);
              });
            }
          } catch (e) {
            console.error("Failed to parse stream line:", e);
          }
        }
      }

      if (buffer.trim()) {
        try {
          const data = JSON.parse(buffer);
          if (data.type === "metadata") {
            const incomingShows = data.shows || [];
            setShows((prev) => {
              const prevMap = new Map(prev.map((s) => [s.show.ids.trakt, s]));
              const merged = incomingShows.map((s: TrackedShow) => {
                const existing = prevMap.get(s.show.ids.trakt);
                if (existing && existing.isEnriched) {
                  return existing;
                }
                return {
                  ...s,
                  isEnriched: false,
                };
              });
              return applySkips(merged);
            });
            setPagination(data.pagination || null);
            if (!silent) setWatchlistLoading(false);
          } else if (data.type === "enrich") {
            setShows((prev) => {
              const updated = prev.map((s) =>
                s.show.ids.trakt === data.showId
                  ? { ...data.enriched, isEnriched: true }
                  : s
              );
              return applySkips(updated);
            });
          } else if (data.type === "error") {
            setShows((prev) => {
              const updated = prev.map((s) =>
                s.show.ids.trakt === data.showId
                  ? { ...s, isEnriched: true, enrichmentError: true }
                  : s
              );
              return applySkips(updated);
            });
          }
        } catch (e) {
          console.error("Failed to parse trailing buffer:", e);
        }
      }
    } catch (err) {
      console.error("Stream fetch error:", err);
    } finally {
      if (!silent) setWatchlistLoading(false);
    }
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

  const advanceToEpisode = (
    showId: number,
    fromEpisodeId: number,
    next: NextEpisodeInfo | null
  ) => {
    setShows((prev) =>
      prev.map((s) => {
        if (s.show.ids.trakt !== showId) return s;
        if (s.progress.nextEpisode?.id !== fromEpisodeId) return s;
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
            nextEpisode: next,
          },
        };
      })
    );
  };

  const handleSkipEpisode = async (
    showId: number,
    slug: string,
    episode: NextEpisodeInfo
  ) => {
    setSkipPending((prev) => ({ ...prev, [episode.id]: true }));
    try {
      const res = await fetch(
        `/api/next-episode?slug=${encodeURIComponent(slug)}&season=${episode.season}&episode=${episode.episode}`
      );
      const data: { next?: NextEpisodeInfo | null } = res.ok
        ? await res.json()
        : { next: null };
      const next = data.next ?? null;
      skippedEpisodeMapRef.current.set(episode.id, next);
      advanceToEpisode(showId, episode.id, next);
    } catch (err) {
      console.error("skip failed:", err);
      // Fallback: behave like the old skip (advance, no follow-up ep).
      skippedEpisodeMapRef.current.set(episode.id, null);
      advanceToEpisode(showId, episode.id, null);
    } finally {
      setSkipPending((prev) => ({ ...prev, [episode.id]: false }));
    }
  };

  // When the watched episode is the tail of a skip chain, the chain's mapping
  // becomes stale (it points to an episode the user has now consumed). Refresh
  // the mapping in-place so applySkips advances to the next-next episode after
  // the server refetch — otherwise the user stays parked on the just-watched ep.
  const refreshSkipChainAfterWatch = async (
    slug: string,
    watched: NextEpisodeInfo
  ) => {
    const skipMap = skippedEpisodeMapRef.current;
    const stale: number[] = [];
    for (const [key, val] of skipMap.entries()) {
      if (val && val.id === watched.id) stale.push(key);
    }
    if (stale.length === 0) return;
    try {
      const res = await fetch(
        `/api/next-episode?slug=${encodeURIComponent(slug)}&season=${watched.season}&episode=${watched.episode}`
      );
      const data: { next?: NextEpisodeInfo | null } = res.ok
        ? await res.json()
        : { next: null };
      for (const key of stale) skipMap.set(key, data.next ?? null);
    } catch {
      for (const key of stale) skipMap.set(key, null);
    }
  };

  const handleMarkWatched = async (
    slug: string,
    episode: NextEpisodeInfo
  ) => {
    setMarkingIds((prev) => ({ ...prev, [episode.id]: true }));
    optimisticMarkEpisode(episode.id);
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: episode.id }),
      });
      if (!res.ok) console.error("Failed to mark as watched");
    } catch (err) {
      console.error(err);
    } finally {
      setMarkingIds((prev) => ({ ...prev, [episode.id]: false }));
      await refreshSkipChainAfterWatch(slug, episode);
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchWatchlist();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && activeTab === "calendar") {
      fetchCalendar();
    }
  }, [isAuthenticated, activeTab]);

  const existingShowIds = useMemo(
    () => new Set(shows.map((s) => s.show.ids.trakt).filter(Boolean) as number[]),
    [shows]
  );

  // Air date of the next unwatched episode (past or future).
  // Falls back to the globally-upcoming episode for caught-up shows where
  // Trakt's progress.next_episode is null but a future ep is scheduled.
  // For shows that haven't aired yet (no episode air date known), falls back
  // to the show's first_aired premiere date when it's in the future.
  // Returns null if no air date is known (e.g. all episodes watched).
  const nextUnwatchedAirTime = (s: TrackedShow): number | null => {
    if (!s.progress) return null;
    let candidate =
      s.progress.nextEpisode?.firstAired ??
      s.progress.upcomingEpisode?.firstAired ??
      null;
    if (!candidate && s.show.first_aired) {
      const premiere = new Date(s.show.first_aired).getTime();
      if (Number.isFinite(premiere) && premiere > now) {
        candidate = s.show.first_aired;
      }
    }
    if (!candidate) return null;
    const t = new Date(candidate).getTime();
    return Number.isFinite(t) ? t : null;
  };

  const {
    trackingShows,
    watchlistShows,
    upcomingCount,
    waitingCount,
    behindCount,
    completedCount,
    displayedShows,
  } = useMemo(() => {
    const tracking = shows.filter((s) => s.trackingStatus !== "not_started");
    const watchlist = shows.filter((s) => s.trackingStatus === "not_started");

    const compareShows = (a: TrackedShow, b: TrackedShow) => {
      const ta = nextUnwatchedAirTime(a);
      const tb = nextUnwatchedAirTime(b);
      if (ta !== null && tb !== null) return Math.abs(ta - now) - Math.abs(tb - now);
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return (a.show.title ?? "").localeCompare(b.show.title ?? "");
    };

    tracking.sort(compareShows);
    watchlist.sort(compareShows);

    const upcoming = tracking.filter((s) => s.trackingStatus === "waiting_new_episodes").length;
    const waiting = tracking.filter((s) => s.trackingStatus === "waiting_new_season" || s.trackingStatus === "caught_up").length;
    const behind = tracking.filter((s) => s.trackingStatus === "behind").length;
    const completed = tracking.filter((s) => s.trackingStatus === "completed").length;

    const filteredTracking = tracking.filter((s) => {
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

    const displayed = activeTab === "tracking" ? filteredTracking : watchlist;

    return {
      trackingShows: tracking,
      watchlistShows: watchlist,
      upcomingCount: upcoming,
      waitingCount: waiting,
      behindCount: behind,
      completedCount: completed,
      displayedShows: displayed,
    };
  }, [shows, filter, activeTab, now]);

  if (isLoading || !user) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner" />
        <p className="loading-text">Loading your profile…</p>
      </div>
    );
  }

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
            type="button"
            className={`tab-btn ${activeTab === "tracking" ? "active" : ""}`}
            onClick={() => setActiveTab("tracking")}
          >
            Tracking ({trackingShows.length})
          </button>
          <button 
            type="button"
            className={`tab-btn ${activeTab === "watchlist" ? "active" : ""}`}
            onClick={() => setActiveTab("watchlist")}
          >
            Watchlist ({watchlistShows.length})
          </button>
          <button 
            type="button"
            className={`tab-btn ${activeTab === "calendar" ? "active" : ""}`}
            onClick={() => setActiveTab("calendar")}
          >
            Calendar
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
            {activeTab === "tracking" ? "Up Next" : activeTab === "watchlist" ? "Plan to Watch" : "Calendar"}
          </h2>

          {activeTab === "calendar" ? (
            calendarLoading ? (
              <div className="watchlist-grid" aria-busy="true" aria-label="Loading calendar">
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
            ) : calendarEpisodes.length === 0 ? (
              <div className="coming-soon">
                <div className="coming-soon-icon">📅</div>
                <h3 className="coming-soon-title">No scheduled episodes</h3>
                <p className="coming-soon-desc">
                  No episodes found in your calendar for the next 7 days or past 3 days.
                </p>
              </div>
            ) : (
              <>
                {/* Horizontal Date Picker */}
                <div className="calendar-picker-container">
                  <div className="calendar-picker">
                    <div className="calendar-picker-header">
                      <div className="calendar-month-title">{selectedMonthTitle}</div>
                      <div className="calendar-nav-controls">
                        <button
                          type="button"
                          className="calendar-nav-btn"
                          onClick={handlePrevDay}
                          disabled={daysList.findIndex(d => d.dateStr === selectedDate) === 0}
                          aria-label="Previous day"
                        >
                          &lt;
                        </button>
                        <button
                          type="button"
                          className="calendar-today-btn"
                          onClick={handleToday}
                        >
                          Today
                        </button>
                        <button
                          type="button"
                          className="calendar-nav-btn"
                          onClick={handleNextDay}
                          disabled={daysList.findIndex(d => d.dateStr === selectedDate) === daysList.length - 1}
                          aria-label="Next day"
                        >
                          &gt;
                        </button>
                      </div>
                    </div>
                    <div className="calendar-days">
                      {daysList.map((day) => {
                        const epCount = countEpisodesForDate(day.dateStr);
                        const isActive = day.dateStr === selectedDate;
                        return (
                          <button
                            key={day.dateStr}
                            type="button"
                            className={`calendar-day-btn ${isActive ? "active" : ""}`}
                            onClick={() => handleDayClick(day.dateStr)}
                          >
                            <span className="calendar-day-month">{day.monthStr}</span>
                            <span className="calendar-day-number">{day.dateNum}</span>
                            <span className="calendar-day-name">{day.dayName}</span>
                            <div className="calendar-dots">
                              {Array.from({ length: Math.min(epCount, 3) }).map((_, i) => (
                                <span key={i} className="calendar-dot" />
                              ))}
                              {epCount > 3 && (
                                <span style={{ fontSize: "8px", fontWeight: "bold", color: "var(--muted)", lineHeight: 1 }}>+</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Grouped Episode List */}
                <div className="calendar-view">
                  {daysList.map((day) => {
                    const eps = calendarGroupedByDate[day.dateStr] || [];
                    const isToday = day.dateStr === getLocalTodayDateString();
                    
                    const parts = day.dateStr.split("-");
                    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
                    const headerTitle = d.toLocaleDateString("en-US", {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    });

                    return (
                      <div
                        key={day.dateStr}
                        id={`date-group-${day.dateStr}`}
                        className="calendar-date-group"
                      >
                        <div className="calendar-date-header">
                          <span>{headerTitle}</span>
                          {isToday && <span className="calendar-date-header-today">Today</span>}
                        </div>

                        {eps.length === 0 ? (
                          <div className="coming-soon" style={{ padding: "var(--space-6)" }}>
                            <p className="coming-soon-desc">No episodes scheduled for this day.</p>
                          </div>
                        ) : (
                          <div className="calendar-episode-grid">
                            {eps.map((item, idx) => {
                              const poster = findCalendarPoster(item.show.ids.trakt);
                              const isWatched = isEpisodeWatched(
                                item.show.ids.trakt,
                                item.episode.season,
                                item.episode.number
                              );
                              const isAired = isEpisodeAired(item.first_aired);
                              const airTimeStr = getAirTimeStr(item.first_aired);

                              return (
                                <div
                                  key={`${item.episode.ids.trakt}-${idx}`}
                                  className="watchlist-card"
                                >
                                  <div className="watchlist-card-poster">
                                    {poster ? (
                                      <Image
                                        src={poster}
                                        alt={`${item.show.title} poster`}
                                        width={120}
                                        height={180}
                                        sizes="(max-width: 768px) 96px, 120px"
                                      />
                                    ) : (
                                      <div className="poster-placeholder" aria-hidden>📺</div>
                                    )}
                                    {airTimeStr && (
                                      <div className="poster-time-badge">{airTimeStr}</div>
                                    )}
                                  </div>

                                  <div className="watchlist-card-body">
                                    <div className="watchlist-card-header">
                                      <div className="watchlist-card-title-row">
                                        <h3 className="watchlist-card-title">
                                          {item.show.title || "Unknown"}
                                        </h3>
                                        {item.show.year && (
                                          <span className="watchlist-card-year">{item.show.year}</span>
                                        )}
                                      </div>
                                      {isWatched && (
                                        <span className="watched-check-icon">✓</span>
                                      )}
                                    </div>

                                    <div className="calendar-card-episode-info">
                                      S{String(item.episode.season).padStart(2, "0")}
                                      E{String(item.episode.number).padStart(2, "0")}
                                      {" · "}
                                      <span className="calendar-card-episode-title">
                                        {item.episode.title || `Episode ${item.episode.number}`}
                                      </span>
                                    </div>

                                    {item.episode.overview && (
                                      <p className="watchlist-card-overview">
                                        {item.episode.overview}
                                      </p>
                                    )}

                                    <div className="episode-info-row" style={{ marginTop: "auto", borderTop: "none", paddingTop: 0 }}>
                                      {!isWatched && isAired && (
                                        <button
                                          type="button"
                                          className="mark-watched-btn"
                                          disabled={markingIds[item.episode.ids.trakt]}
                                          onClick={() =>
                                            handleMarkCalendarEpisode(
                                              item.show.ids.trakt,
                                              item.show.ids.slug,
                                              item.episode.ids.trakt,
                                              item.episode.season,
                                              item.episode.number
                                            )
                                          }
                                        >
                                          {markingIds[item.episode.ids.trakt] ? "..." : "Mark Watched ✓"}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )
          ) : watchlistLoading ? (
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
                const { show, progress, trackingStatus, statusLabel, isEnriched, rtScore } = tracked;
                const ids = show.ids;

                const hasKnownAirDate = isEnriched && progress
                  ? Boolean(progress.upcomingEpisode?.firstAired) ||
                    Boolean(
                      progress.nextEpisode?.firstAired &&
                        !progress.nextEpisode.isAired
                    )
                  : false;
                const statusLower = show.status?.toLowerCase();
                const newsEligibleStatus =
                  statusLower === "returning series" ||
                  statusLower === "in production" ||
                  statusLower === "planned";
                const showNewsButton = isEnriched && newsEligibleStatus && !hasKnownAirDate;

                let displayStatusLabel = statusLabel;
                if (
                  trackingStatus === "waiting_new_episodes" &&
                  isEnriched &&
                  progress?.upcomingEpisode?.firstAired
                ) {
                  const airDate = new Date(progress.upcomingEpisode.firstAired);
                  const dateStr = airDate.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                  const timeStr = airDate.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  });
                  displayStatusLabel = `Caught up · Next episode ${dateStr} at ${timeStr}`;
                }

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
                        {displayStatusLabel}
                      </span>
                    </div>

                    {show.overview && (
                      <p className="watchlist-card-overview">{show.overview}</p>
                    )}

                    {/* Progress bar */}
                    {isEnriched && progress ? (
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
                    ) : (
                      <div className="progress-bar-container">
                        <div className="skeleton skeleton-line bar" style={{ margin: '4px 0 8px 0' }} />
                      </div>
                    )}

                    {isEnriched && progress?.upcomingInSeason && (
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
                        📺 {isEnriched && progress ? (
                          `${progress.totalSeasons} season${progress.totalSeasons !== 1 ? "s" : ""}`
                        ) : (
                          <span className="skeleton" style={{ display: 'inline-block', width: '20px', height: '12px', verticalAlign: 'middle', borderRadius: '2px' }} />
                        )}
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
                      {typeof rtScore === "number" && (
                        <span
                          className="watchlist-meta-item"
                          title="Rotten Tomatoes (critics)"
                        >
                          {rtScore >= 60 ? "🍅" : "🤢"} {rtScore}%
                        </span>
                      )}
                    </div>

                    {/* Where left off / Next episode */}
                    <div className="episode-info-row">
                      {isEnriched && progress ? (
                        <>
                          {progress.lastEpisode && (
                            <div className="episode-info">
                              <span className="episode-info-label">Last watched</span>
                              <span className="episode-info-value">
                                S{String(progress.lastEpisode.season).padStart(2, "0")}
                                E{String(progress.lastEpisode.episode).padStart(2, "0")}
                                {" · "}{progress.lastEpisode.title}
                                {progress.lastEpisode.runtime && ` · ${progress.lastEpisode.runtime}m`}
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
                                {progress.nextEpisode.runtime && ` · ${progress.nextEpisode.runtime}m`}
                                {progress.nextEpisode.firstAired && !progress.nextEpisode.isAired && (
                                  <span className="air-date">
                                    {" "}(airs {new Date(progress.nextEpisode.firstAired).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {new Date(progress.nextEpisode.firstAired).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})
                                  </span>
                                )}
                                {progress.nextEpisode.isAired && (
                                  <span className="mark-watched-group">
                                    <button
                                      className="mark-watched-btn"
                                      disabled={markingIds[progress.nextEpisode.id] || bulkMarking[ids.trakt]}
                                      onClick={() => handleMarkWatched(show.ids.slug, progress.nextEpisode!)}
                                    >
                                      {markingIds[progress.nextEpisode.id] ? "..." : "Mark Watched ✓"}
                                    </button>
                                    <WatchedMenu
                                      showTitle={show.title}
                                      seasonNumber={progress.nextEpisode.season}
                                      busy={bulkMarking[ids.trakt] || skipPending[progress.nextEpisode.id]}
                                      onSkipEpisode={() =>
                                        handleSkipEpisode(
                                          ids.trakt,
                                          show.ids.slug,
                                          progress.nextEpisode!
                                        )
                                      }
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
                                {progress.upcomingEpisode.runtime && ` · ${progress.upcomingEpisode.runtime}m`}
                                {progress.upcomingEpisode.firstAired && (
                                  <span className="air-date">
                                    {" "}({new Date(progress.upcomingEpisode.firstAired).toLocaleDateString("en-US", { month: "short", day: "numeric" })} at {new Date(progress.upcomingEpisode.firstAired).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })})
                                  </span>
                                )}
                              </span>
                            </div>
                          )}
                          {/* Show hasn't aired yet: no episode air date known, but the
                              show has a future first_aired premiere date. */}
                          {!progress.nextEpisode &&
                            !progress.upcomingEpisode &&
                            show.first_aired &&
                            new Date(show.first_aired).getTime() > now && (
                              <div className="episode-info">
                                <span className="episode-info-label">Premieres</span>
                                <span className="episode-info-value">
                                  {new Date(show.first_aired).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                                  {" at "}
                                  {new Date(show.first_aired).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                </span>
                              </div>
                            )}
                        </>
                      ) : (
                        <div className="episode-info-skeleton-container" style={{ display: 'flex', width: '100%', gap: 'var(--space-4)' }}>
                          <div className="episode-info" style={{ flex: 1 }}>
                            <span className="episode-info-label">Last watched</span>
                            <div className="skeleton skeleton-line" style={{ width: '80%', height: '14px', marginTop: '6px', borderRadius: '4px' }} />
                          </div>
                          <div className="episode-info" style={{ flex: 1 }}>
                            <span className="episode-info-label">Next to watch</span>
                            <div className="skeleton skeleton-line" style={{ width: '85%', height: '14px', marginTop: '6px', borderRadius: '4px' }} />
                          </div>
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
