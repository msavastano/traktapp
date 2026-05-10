# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Next.js dev server (http://localhost:3000)
- `npm run build` — production build
- `npm start` — run built app
- `npm run lint` — ESLint via `eslint-config-next` (core-web-vitals + typescript)

No test runner is configured.

## Required environment variables

Trakt OAuth credentials must be set (e.g. in `.env.local`):

- `TRAKT_CLIENT_ID` — Trakt API client id (sent as `trakt-api-key` header)
- `TRAKT_CLIENT_SECRET` — used for token exchange/refresh/revoke
- `NEXT_PUBLIC_TRAKT_REDIRECT_URI` — must match the Trakt app's redirect (typically `http://localhost:3000/api/auth/callback`)

## Architecture

Next.js 16 App Router app (React 19, TypeScript, no CSS framework — global CSS only). Path alias `@/*` → repo root.

### Trakt OAuth flow

Auth lives entirely in Next.js Route Handlers under `app/api/auth/`. Tokens are stored server-side in an HTTP-only cookie (`trakt_tokens`) as base64-encoded JSON.

- `GET /api/auth/login` — sets a `trakt_oauth_state` CSRF cookie, redirects to Trakt's `/oauth/authorize`.
- `GET /api/auth/callback` — validates state, exchanges `code` for tokens, sets `trakt_tokens` cookie, redirects to `/dashboard`.
- `GET /api/auth/me` — returns current user (auto-refreshes tokens if expired).
- `POST /api/auth/logout` — clears cookie (and revokes via `lib/trakt.ts:revokeToken`).
- `GET /api/auth/refresh` — manual refresh.

`lib/trakt.ts` owns all token logic: `getAuthorizeUrl`, `exchangeCodeForTokens`, `refreshAccessToken`, `revokeToken`, `encodeTokens`/`decodeTokens`, `isTokenExpired` (60s buffer), and the `COOKIE_NAME` constant. Token encoding is base64 JSON — `lib/trakt.ts:168` flags this for AES upgrade in production.

Every protected route handler follows the same boilerplate: read `COOKIE_NAME` cookie → `decodeTokens` → if `isTokenExpired`, call `refreshAccessToken` and re-set the cookie → call Trakt with `Bearer ${tokens.access_token}`. When adding new authenticated endpoints, replicate this pattern (see `app/api/watchlist/route.ts` or `app/api/history/route.ts`).

### Watchlist enrichment pipeline

The dashboard's data model is a **`TrackedShow`** (`lib/types.ts`) — combines watchlist metadata, show metadata, watch progress, and a derived `TrackingStatus` (`not_started` | `behind` | `caught_up` | `waiting_new_episodes` | `waiting_new_season` | `completed`).

`GET /api/watchlist` (`app/api/watchlist/route.ts`):

1. Parallel fetches `users/me/watchlist/shows` + `sync/watched/shows` (both `extended=full`, page 1, limit 100).
2. Maps watched items into watchlist shape, then **deduplicates by `show.ids.trakt`** via a `Map` (so a show appears once even if it's both watchlisted and watched).
3. Sorts by `listed_at`/`last_watched_at` desc.
4. Calls `enrichWatchlist` (`lib/enrich.ts`) which, per show, fetches `/shows/{slug}/progress/watched` and `/shows/{slug}/next_episode?extended=full` in parallel — batched at concurrency 5.
5. `computeTrackingStatus` derives the status from `show.status` (ended/canceled vs ongoing) + `progress.aired` vs `progress.completed` + the upcoming episode's air date.

When changing status semantics, update **both** the `TrackingStatus` union in `lib/types.ts` AND the dashboard's `statusWeight` sort + filter logic in `app/dashboard/page.tsx`.

### Client-side auth

`lib/auth-context.tsx` exposes `<AuthProvider>` (mounted in `app/layout.tsx`) and a `useAuth()` hook (`user`, `isLoading`, `isAuthenticated`, `login`, `logout`, `refreshUser`). It calls `/api/auth/me` on mount; `login()` redirects to `/api/auth/login`. The home page (`app/page.tsx`) auto-redirects authenticated users to `/dashboard`; the dashboard redirects unauthenticated users back home.

### Marking episodes watched

`POST /api/history` with `{ episodeId }` posts to Trakt's `sync/history`. The dashboard calls this then re-fetches `/api/watchlist` to get updated progress (no optimistic updates).
