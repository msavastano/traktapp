/**
 * Shared types for the app.
 *
 * TrackedShow is the enriched data structure that combines:
 *   - Watchlist metadata (when it was added)
 *   - Show metadata (title, status, network, etc.)
 *   - Watch progress (aired vs watched, per-season breakdown)
 *   - Computed tracking status that answers the user's key questions
 */

// ---------------------------------------------------------------------------
// Raw Simkl API shapes (partial — only fields we use)
// ---------------------------------------------------------------------------

export interface SimklShowIds {
  simkl: number;
  slug?: string;
  /** Simkl returns external ids as strings, not numbers. */
  tvdb?: string | null;
  imdb?: string | null;
  tmdb?: string | null;
}

export interface SimklShow {
  title: string;
  year: number | null;
  ids: SimklShowIds;
  /** Bare poster path like "16/16913426086fc13" — see posterUrl(). */
  poster?: string | null;
  overview?: string;
  /**
   * From GET /tv/{id}. Observed values are `"ended"` and `"airing"` only —
   * Simkl has no "returning series" / "in production" value. Treat anything
   * that isn't `"ended"`/`"canceled"` as still running.
   */
  status?: string;
  network?: string;
  runtime?: number;
  rating?: number;
  votes?: number;
  genres?: string[];
  total_episodes?: number;
  first_aired?: string;
  country?: string;
  trailer?: string | null;
  certification?: string;
}

export interface SimklEpisode {
  season: number;
  episode: number;
  title: string;
  ids?: { simkl?: number; tvdb?: string | null; imdb?: string | null };
  description?: string;
  /** ISO date, Simkl's `date` field on episode records. */
  date?: string | null;
  runtime?: number;
  rating?: number;
}

/**
 * One entry from GET /sync/all-items/{type}/{status}.
 *
 * `status` here is the *user's list status*, not the show's airing status —
 * the show's airing status only comes from GET /tv/{id}.
 */
export interface SimklListItem {
  added_to_watchlist_at: string;
  last_watched_at: string | null;
  user_rating: number | null;
  status: SimklListStatus;
  /** Compact episode code, e.g. "S01E01". Null when nothing watched yet. */
  last_watched: string | null;
  /** Compact episode code for the next unwatched episode. */
  next_to_watch: string | null;
  /** Present when next_watch_info=yes and the item is in `watching`. */
  next_to_watch_info?: {
    title: string;
    season: number;
    episode: number;
    date: string | null;
  } | null;
  watched_episodes_count: number;
  total_episodes_count: number;
  not_aired_episodes_count: number;
  show: SimklShow;
  /** Present when extended=full — per-season watched episode records. */
  seasons?: {
    number: number;
    episodes: { number: number; watched_at?: string }[];
  }[];
}

export type SimklListStatus =
  | "watching"
  | "plantowatch"
  | "hold"
  | "completed"
  | "dropped";

/** Top-level shape of GET /sync/all-items — keys appear only when non-empty. */
export interface SimklAllItemsResponse {
  shows?: SimklListItem[];
  anime?: SimklListItem[];
  movies?: SimklListItem[];
}

// ---------------------------------------------------------------------------
// Movie shapes (for "Upcoming on Streaming")
// ---------------------------------------------------------------------------

export interface SimklMovieIds {
  simkl: number;
  slug?: string;
  imdb?: string | null;
  tmdb?: string | null;
}

export interface SimklMovie {
  title: string;
  year: number | null;
  ids: SimklMovieIds;
  poster?: string | null;
  overview?: string;
  runtime?: number;
  rating?: number;
  votes?: number;
  genres?: string[];
  certification?: string;
  /** ISO date of general release, from GET /movies/{id}. */
  released?: string | null;
}

/**
 * A movie paired with an upcoming release date.
 *
 * Simkl has no direct equivalent of Trakt's per-country release-type feed, so
 * this is now sourced from the CDN movie calendar rather than a release-type
 * heuristic — see lib/movies.ts.
 */
export interface UpcomingStreamingRelease {
  movie: SimklMovie;
  releaseDate: string; // YYYY-MM-DD
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
  /**
   * Synthetic stable id — `showId * 100000 + season * 1000 + episode`.
   *
   * Simkl's write endpoints address episodes by (show id, season, episode)
   * rather than by an episode id, so this exists purely as a React key and as
   * a lookup key for the dashboard's optimistic-update maps. Never send it to
   * the API; send showId/season/episode instead.
   */
  id: number;
  /** Simkl show id — needed to address this episode on write endpoints. */
  showId: number;
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
  show: SimklShow;

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

    /** The show's next globally upcoming episode */
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
