/**
 * Simkl image helpers.
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

export type PosterSize = "_w" | "_c" | "_m";

export function posterUrl(
  path: string | null | undefined,
  size: PosterSize = "_w"
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
  size: PosterSize = "_w"
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
