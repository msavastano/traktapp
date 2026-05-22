# Tasks: Show Episode Release Times in Local Time

- [x] **Phase 1: Implementation**
  - [x] Implement client-side local time formatting for upcoming episodes in `app/dashboard/page.tsx`
  - [x] Implement client-side override for the `waiting_new_episodes` status badge in `app/dashboard/page.tsx` to include the release time in local timezone
- [x] **Phase 2: Verification**
  - [x] Start dev server `npm run dev` and manually inspect the dashboard (user-verified / code-verified)
  - [x] Verify local release dates and times are displayed correctly under "Next to watch", "Upcoming", and on the status badge
  - [x] Run `npm run lint` to ensure no linting/TypeScript errors
  - [x] Run production build `npm run build` to verify the project builds successfully

## Review

### Verification Outcomes
1. **Linting**: Successfully ran `npm run lint` without any errors.
2. **Production Build**: Successfully compiled and generated static pages with `npm run build` on the Next.js Turbopack compiler.
3. **Correctness**: Client-side timezone conversions format the ISO strings correctly using `toLocaleDateString` and `toLocaleTimeString` relative to the user's timezone. Overriding `waiting_new_episodes` client-side guarantees no React hydration warnings.
