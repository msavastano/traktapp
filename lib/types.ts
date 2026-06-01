/**
 * Shared types for the TraktApp.
 *
 * TrackedShow is the enriched data structure that combines:
 *   - Watchlist metadata (when it was added)
 *   - Show metadata (title, status, network, etc.)
 *   - Watch progress (aired vs watched, per-season breakdown)
 *   - Computed tracking status that answers the user's key questions
 */

// ---------------------------------------------------------------------------
// Raw Trakt API shapes (partial — only fields we use)
// ---------------------------------------------------------------------------

export interface TraktShowIds {
  trakt: number;
  slug: string;
  tvdb: number | null;
  imdb: string | null;
  tmdb: number | null;
}

export interface TraktShow {
  title: string;
  year: number | null;
  ids: TraktShowIds;
  overview?: string;
  status?: string; // "returning series" | "ended" | "canceled" | "in production" | "planned"
  network?: string;
  runtime?: number;
  rating?: number;
  votes?: number;
  genres?: string[];
  aired_episodes?: number;
  first_aired?: string;
  country?: string;
  trailer?: string | null;
  certification?: string;
  images?: TraktImages;
}

export interface TraktImages {
  poster?: string[];
  fanart?: string[];
  banner?: string[];
  thumb?: string[];
  logo?: string[];
  clearart?: string[];
}

export interface TraktEpisode {
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
  first_aired?: string | null;
  runtime?: number;
  rating?: number;
}

export interface TraktSeasonProgress {
  number: number;
  title?: string;
  aired: number;
  completed: number;
  episodes: {
    number: number;
    completed: boolean;
    last_watched_at: string | null;
  }[];
}

export interface TraktWatchedProgress {
  aired: number;
  completed: number;
  last_watched_at: string | null;
  reset_at: string | null;
  seasons: TraktSeasonProgress[];
  next_episode: TraktEpisode | null;
  last_episode: TraktEpisode | null;
}

export interface TraktWatchlistItem {
  listed_at: string;
  type: string;
  show: TraktShow;
}

// ---------------------------------------------------------------------------
// Enriched data structure — the core model for the UI
// ---------------------------------------------------------------------------

/**
 * Tracking status derived from show metadata + user watch progress.
 *
 * Answers the user's questions at a glance:
 *
 * - `not_started`           — In watchlist but user has never watched any episode
 * - `behind`                — User has watched some, but unwatched aired episodes remain
 * - `caught_up`             — All aired episodes watched; show is still airing / returning
 * - `waiting_new_episodes`  — Caught up; next episode has a known air date
 * - `waiting_new_season`    — Caught up; season over, show is returning but no air date yet
 * - `completed`             — Show is ended/canceled AND user has watched every episode
 */
export type TrackingStatus =
  | "not_started"
  | "behind"
  | "caught_up"
  | "waiting_new_episodes"
  | "waiting_new_season"
  | "completed";

export interface SeasonSummary {
  number: number;
  aired: number;
  completed: number;
  isFullyWatched: boolean;
}

export interface NextEpisodeInfo {
  id: number;
  season: number;
  episode: number;
  title: string;
  firstAired: string | null;
  isAired: boolean; // true if air date is in the past
  runtime?: number;
}

export interface TrackedShow {
  isEnriched?: boolean;
  enrichmentError?: boolean;

  // --- Watchlist info ---
  listedAt: string;

  // --- Show metadata ---
  show: TraktShow;

  /**
   * Rotten Tomatoes critic score (Tomatometer, 0-100) from OMDb.
   * Optional enrichment — null/undefined when unavailable (no API key, rate
   * limit, or no RT rating exists). UI omits the badge when absent.
   */
  rtScore?: number | null;

  // --- Progress ---
  progress: {
    /** Total episodes that have aired */
    aired: number;
    /** Total episodes the user has watched */
    completed: number;
    /** Unwatched aired episodes */
    unwatchedCount: number;
    /** Percentage watched of aired episodes (0-100) */
    percentWatched: number;
    /** True if user has watched all aired episodes */
    isFullyCaughtUp: boolean;

    /** Total number of seasons (excluding specials) */
    totalSeasons: number;
    /** Per-season breakdown */
    seasons: SeasonSummary[];

    /** When the user last watched an episode */
    lastWatchedAt: string | null;
    /** The last episode the user watched */
    lastEpisode: NextEpisodeInfo | null;

    /** The next episode the user should watch (could be aired or unaired) */
    nextEpisode: NextEpisodeInfo | null;

    /** The show's next globally upcoming episode (from /shows/{id}/next_episode) */
    upcomingEpisode: NextEpisodeInfo | null;

    /** Currently-airing season info: the most recent season where more
     * episodes are scheduled but not yet aired. Null if every season is
     * fully aired or no upcoming episodes are known. */
    upcomingInSeason: { season: number; remaining: number } | null;
    /** Map of watched episodes in the format "season-episode" -> true */
    watchedEpisodes?: Record<string, boolean>;
  };

  // --- Computed status ---
  trackingStatus: TrackingStatus;
  /** Human-readable one-liner for the status */
  statusLabel: string;
}
