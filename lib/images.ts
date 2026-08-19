/**
 * Image and deep-link helpers for Simkl and TMDB.
 *
 * Kept separate from lib/simkl.ts so client components can import them —
 * that module pulls in node:crypto for cookie encryption and can't be
 * bundled for the browser.
 *
 * Posters arrive from the API as bare paths like "16/16913426086fc13" and are
 * served through Simkl's wsrv.nl proxy. Sizes: _w (wide), _c (cover), _m (medium).
 */

const SIMKL_IMG_BASE = "https://wsrv.nl/?url=https://simkl.in";

export const POSTER_PLACEHOLDER = `${SIMKL_IMG_BASE}/poster_no_pic_c.png`;

/**
 * Poster size suffixes. Only `_ca` and `_m` are portrait — `_w` is a
 * landscape crop and will look zoomed-in inside a portrait card frame.
 *
 *   _m  — 340 × 500, portrait          ← default; retina-sharp in 120px frames
 *   _ca — 190 × 279, card aspect (~2:3)
 *   _c  — cover
 *   _w  — 600 × 338, landscape, cropped
 */
export type PosterSize = "_ca" | "_m" | "_c" | "_w";

export function posterUrl(
  path: string | null | undefined,
  size: PosterSize = "_m"
): string {
  if (!path) return POSTER_PLACEHOLDER;
  return `${SIMKL_IMG_BASE}/posters/${path}${size}.webp&q=90`;
}

/**
 * Poster URL for any entity carrying a `poster` path, or null when it has
 * none — callers render their own fallback UI rather than the placeholder.
 */
export function posterFrom(
  entity: { poster?: string | null } | null | undefined,
  size: PosterSize = "_m"
): string | null {
  if (!entity?.poster) return null;
  return posterUrl(entity.poster, size);
}

/**
 * Simkl's API rules require linking back to the specific item page wherever
 * their data is shown. Always pass the slug when available — a bare numeric
 * URL forces Simkl into a database lookup and a 301 redirect.
 */
export function simklShowUrl(simklId: number, slug?: string | null): string {
  return slug
    ? `https://simkl.com/tv/${simklId}/${slug}`
    : `https://simkl.com/tv/${simklId}`;
}

export function simklMovieUrl(simklId: number, slug?: string | null): string {
  return slug
    ? `https://simkl.com/movies/${simklId}/${slug}`
    : `https://simkl.com/movies/${simklId}`;
}

// ---------------------------------------------------------------------------
// TMDB
// ---------------------------------------------------------------------------

/**
 * The "New on Streaming" tab is TMDB end-to-end — Simkl publishes no
 * streaming-provider data for movies — so its artwork comes from TMDB's CDN
 * rather than Simkl's wsrv.nl proxy. `image.tmdb.org` is allow-listed in
 * next.config.ts for this.
 *
 * These live here, not in lib/tmdb.ts, because that module reads
 * TMDB_API_KEY and must stay off the client bundle.
 */
export type TmdbPosterSize = "w185" | "w342" | "w500";

/** `w342` is the smallest size that still looks sharp in a 120px card frame. */
export function tmdbPosterUrl(
  path: string | null | undefined,
  size: TmdbPosterSize = "w342"
): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export function tmdbMovieUrl(tmdbId: number): string {
  return `https://www.themoviedb.org/movie/${tmdbId}`;
}
