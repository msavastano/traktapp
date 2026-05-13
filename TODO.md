# TraktApp Improvements

## Performance

- [x] **Drop redundant `/next_episode` call.** Use `progress.next_episode` from `/progress/watched` instead. Halves Trakt calls per show.
- [x] **Cache `/api/watchlist` per-user.** In-memory TTL cache (5 min) keyed by access_token. Invalidated on POST /api/history and POST /api/watchlist. (`lib/cache.ts`)
- [x] **Optimistic UI for Mark Watched.** Mutate local state immediately, refetch in background via silent reconcile. Single-episode + bulk season/show variants.
- [ ] **Move cache to Redis/Vercel KV.** Current in-memory cache resets on serverless cold start. Real multi-instance cache needed for prod hit rate.
- [ ] **Stream enrichment results.** Use `ReadableStream` or RSC + Suspense so first show cards render before all enrichment finishes. Currently waits for full batch.
- [ ] **Pre-warm cache via cron.** Background job that refreshes active users' watchlists every N min. Dashboard reads cached only.

## Reliability

- [ ] **Rate-limit guard.** Trakt allows 1000 calls/5min. Add retry-on-429 honoring `Retry-After` header + circuit breaker per access_token.
- [ ] **Pagination.** Hard-coded `limit=100` in `app/api/watchlist/route.ts`. Users with >100 watchlisted or watched shows silently truncate. Loop until `x-pagination-page-count` exhausted.
- [ ] **Update stale CLAUDE.md.** Says tokens are "base64 JSON, flagged for AES upgrade in production." Already AES-256-GCM via `TOKEN_ENCRYPTION_KEY`. Fix doc.
- [ ] **Surface enrichment failures per card.** `enrich.ts` drops failed shows silently. Show stub card with retry button instead.

## UX

- [x] **Search debounce + AbortController.** 250ms debounce already present; added `AbortController` to abort stale fetches.
- [x] **Loading skeletons.** Spinner replaced with shimmer skeleton cards (`.skeleton-card` in `app/globals.css`).
- [x] **Sort/filter state in URL.** Read on mount via `useSearchParams`, written via `router.replace`. Dashboard wrapped in `<Suspense>` for prerender. `?tab=watchlist&filter=behind` etc.
- [x] **Persist `showRaw` toggle per session.** Keyed by trakt id (stable across sort/filter), stored in `sessionStorage`.

## Architecture

- [ ] **Server Components for dashboard.** Currently `"use client"` for no good reason. Auth check could be middleware; initial watchlist fetched in RSC. Smaller JS bundle, faster first paint.
- [ ] **Streaming/SSE for enrichment.** Per-show results pushed as they resolve.
- [ ] **Trakt webhooks** (if available) to invalidate cache instead of polling. Else, cron-based pre-warm.

## Security

- [ ] **CSRF protection.** `POST /api/history`, `POST /api/watchlist`, `POST /api/auth/logout` rely on cookie auth alone. Add origin header check or CSRF token.
- [ ] **Content Security Policy headers.** No CSP currently. Allowlist `walter-r2.trakt.tv` for images; block everything else.
- [ ] **Rotate `TOKEN_ENCRYPTION_KEY` plan.** Document key rotation procedure (invalidates all sessions).

- [x] **Replace `window.confirm` with proper dialog.** Native `<dialog>` modal (`components/confirm-dialog.tsx`) with backdrop + ESC handling. Added confirm for season-mark too (previously fired without confirmation).

## Code Quality

- [ ] **Add tests.** Vitest for pure logic: `computeTrackingStatus`, `decodeTokens`/`encodeTokens` round-trip, watchlist dedup map, cache TTL behavior.
- [ ] **Remove `any` in `app/api/watchlist/route.ts`** (lines 98, 105). Type raw Trakt watched/watchlist shapes properly.
- [ ] **Fix react-hooks/set-state-in-effect lint errors.** `app/dashboard/page.tsx:178`, `app/recommendations/page.tsx:65`, `lib/auth-context.tsx:51`. Refactor effects to not call setState synchronously.
- [ ] **Fix react-hooks/purity lint error.** `app/dashboard/page.tsx:219` — `Date.now()` called during render. Move to `useMemo` keyed by shows.
- [ ] **`trakt_mcpserver/` untracked.** Decide: commit it or add to `.gitignore`.
- [ ] **Replace `<img>` with `<Image />`** in `components/user-profile.tsx:41`.
- [ ] **Remove dead `caught_up` filter branch** in `app/dashboard/page.tsx:165,176`. `computeTrackingStatus` never emits it.
