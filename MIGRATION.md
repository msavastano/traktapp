# Trakt → Simkl migration — handoff note

**Status: in progress. The build does not pass yet.** `npx tsc --noEmit` reports
17 errors, all confined to the auxiliary surface listed under "Remaining work".

## Why this migration happened

The app's Trakt OAuth application was deleted from Trakt's side around
2026-07-30, without announcement. Symptoms were:

- Login redirected to Trakt and got `invalid_client / client_id is required`
- The client_id returned **403** on every Trakt API endpoint — identical to a
  bogus key and to no key at all
- `https://trakt.tv/oauth/applications` listed no applications

Trakt simultaneously put new API app registration behind **Trakt VIP**, so
re-registering costs money. Other developers reported the same disappearance
(see the Trakt forums thread on failing to create an API app after buying VIP).
The decision was to leave Trakt for **Simkl**, which is free for non-commercial
use and for commercial use under $150/month.

## Architecture decisions

**The UI contract was deliberately preserved.** `TrackedShow`, `TrackingStatus`
and the exact `statusLabel` strings are unchanged, so the 1,600-line dashboard
and all components needed no logic changes. Only the data layer swapped.

**Ids were renamed, not aliased.** `ids.trakt` → `ids.simkl` across ~53 call
sites. Leaving a field named `trakt` holding a Simkl id would have been a
lasting trap.

**No refresh-token logic anywhere.** Simkl tokens last 5 years and there is no
refresh grant. A 401 means the user revoked the app at
<https://simkl.com/settings/connected-apps/>; the only remedy is re-running
OAuth. Every `isTokenExpired` / `refreshAccessToken` branch was deleted, along
with `app/api/auth/refresh/`.

**Episodes are addressed by (show, season, episode).** Simkl has no episode-id
write path. `NextEpisodeInfo.id` is now a *synthetic* value
(`showId * 100000 + season * 1000 + episode`) used only as a React key and as a
key for the dashboard's optimistic-update maps. **Never send it to the API.**

**Image helpers live in `lib/images.ts`, not `lib/simkl.ts`,** because
`lib/simkl.ts` imports `node:crypto` for cookie encryption and cannot be
bundled for the browser.

## Simkl API rules — these are enforced by suspension

From the Simkl developer dashboard: *"If you don't follow these rules, your
client_id will be suspended."* No warning, no appeal.

- **Never** call library endpoints without first checking `/sync/activities`
- **Always** pass `date_from` once initialised
- Initial pull: fetch each library **separately and sequentially** — not in
  parallel (it spikes their CPU on large libraries)
- Send the activities timestamp back **verbatim**, never reformatted
- Never poll on a background timer without user interaction
- Rate limits: 10 GET/sec, 1 POST/sec per client_id

`lib/sync.ts` implements this two-phase model. `lib/enrich.ts` deliberately
exports **no** "just fetch the library" helper — that would invite bypassing
the gate.

Also required by their API rules, and **not yet implemented**:

- Link back to the specific Simkl page (`simkl.com/tv/{id}/{slug}`) wherever
  their data appears. Helpers exist in `lib/images.ts`; the UI doesn't use them.
- Attribute Simkl in any trending UI.

## Verified against the live API

Confirmed with real calls using the registered client_id, not just from docs:

| Fact | Value |
|---|---|
| `/tv/{id}` status vocabulary | `'ended'`, `'airing'` — **not** "returning series" |
| `ids` on list/detail endpoints | `{simkl, slug, tvdb, imdb, tmdb}`, externals as **strings** |
| `ids` on **search** endpoints | `{simkl_id, slug, tmdb}` — **`simkl_id`, not `simkl`** |
| `poster` | bare path, e.g. `57/5742576cd8f59fcb0` |

`computeTrackingStatus` only tests for `ended`/`canceled` and lets everything
else fall through to the still-running branch, so `'airing'` is handled
correctly. A `canceled` value has not been observed in the wild but the check
is kept as a safe default.

### Gotchas that cost real time

- `POST /users/settings` — it is a **POST** despite being a read
- `/sync/add-to-list` — `to` is **per-item**; a top-level `to` returns
  `400 empty_field`
- OAuth uses **two hosts**: `simkl.com/oauth/authorize` (browser) and
  `api.simkl.com/oauth/token` (server). Pointing authorize at `api.` gives a 404
- The authorization `code` is single-use and is consumed **even when the
  exchange fails** — never retry, restart the flow
- Search returns `ids.simkl_id` while everything else returns `ids.simkl`

## Done

- `lib/simkl.ts` — client, OAuth, retry/backoff, AES-256-GCM cookie helpers,
  fail-fast env checks
- `lib/session.ts` — replaces the ~25-line auth preamble duplicated per route
- `lib/images.ts` — poster URLs via Simkl's wsrv.nl proxy + deep-link helpers
- `lib/sync.ts` — two-phase activities-gated sync
- `lib/sync-store.ts` — Redis-backed (`redis` 6.2.1, lazy singleton client,
  sha256-hashed keys so access tokens never appear in Redis, 30-day TTL, and an
  in-process fallback if Redis is unreachable). Verified against the live
  instance: connect, set with TTL, get, delete all round-trip.
- `lib/types.ts`, `lib/enrich.ts` — Simkl shapes → `TrackedShow`
- `app/api/auth/{login,callback,me,logout}` (refresh route deleted)
- `app/api/{watchlist,history}`
- `next.config.ts` — image host is now `wsrv.nl`

## Remaining work

All routes are ported, `lib/trakt.ts` is deleted, `npx tsc --noEmit` is clean
and `npm run build` succeeds. What's left:

1. **Remaining unverified flows.** Confirmed working against a real account:
   OAuth login, Phase 1 sync, Redis persistence, dashboard enrichment, and
   marking an episode watched. Still unexercised: unwatch, bulk mark
   season/show, adding to watchlist, the calendar tab, and the Phase 2 delta
   path (it only triggers once the activities timestamp moves).
2. **Add the Simkl link-backs and trending attribution** required by their API
   rules (see above). Helpers exist in `lib/images.ts`; no UI uses them yet.
3. **Update `CLAUDE.md`**, which still documents the Trakt architecture
   throughout — only a pointer to this file was added.
4. Two pre-existing lint errors in `app/dashboard/page.tsx` (lines ~320 and
   ~825) are unrelated to this migration and were failing before it.
5. `.env.local` has a stray `SIMKL_CLIENT_ID / SIMKL_CLIENT_SECRET` line with
   no `=` — a paste artifact, safe to delete.

## Environment

| Var | Notes |
|---|---|
| `SIMKL_CLIENT_ID` | Public — travels in browser URLs. Verified working. |
| `SIMKL_CLIENT_SECRET` | Secret. |
| `SIMKL_REDIRECT_URI` | **Renamed** from `NEXT_PUBLIC_TRAKT_REDIRECT_URI`. Dropping the prefix makes it a runtime var so it no longer leaks into the client bundle — it must be re-added under the new name in Vercel. |
| `TOKEN_ENCRYPTION_KEY` | Unchanged, still valid. 64 hex chars. |
| `REDIS_URL` | Added by the Vercel Redis integration (Production, Preview, Development). TCP `redis://` connection string. |
| `GEMINI_API_KEY` | Unchanged. |

`.env.local.bak` holds the pre-migration file. Note `.env.local` contains a
stray line `SIMKL_CLIENT_ID / SIMKL_CLIENT_SECRET` with no `=` — a paste
artifact, ignored by dotenv, safe to delete.

**Still open:** the app is served from both `traktapp-psi.vercel.app` and
`traktapp.michaelsavastano.com`, but `SIMKL_REDIRECT_URI` points at the former.
The session cookie is set on whichever host handles the callback, so the custom
domain will appear logged-out. Pick a canonical host and register that redirect
URI with Simkl.

## Useful commands

```bash
npx tsc --noEmit          # the work list
npm run dev
npm run lint
```

Simkl API docs: <https://api.simkl.org> — the LLM-friendly index is at
<https://api.simkl.org/llms.txt>, and every page is fetchable as `.md`.
