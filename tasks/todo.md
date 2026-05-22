# Tasks: Cohesive Premium Dark Mode

- [x] **Phase 1: Design Tokens & CSS Variables**
  - [x] Add dark theme overrides to `app/globals.css` using `html[data-theme="dark"]`
  - [x] Clean up hardcoded `#fff` text colors on primary buttons/badges to use variable `var(--on-warm-brown)` and `var(--on-dark-charcoal)`
  - [x] Update confirmation dialog confirm/destructive buttons to use variable `--accent` and `--dusty-red`
  - [x] Add style rules for the theme toggle button with micro-animations
- [x] **Phase 2: Theme Toggle Component**
  - [x] Create `components/theme-toggle.tsx` with hydration-safe mounting and local storage sync
  - [x] Integrate SVG icons for Sun/Moon with elegant transitions/hover effects
  - [x] Add `<ThemeToggle />` into `components/navbar.tsx` actions
- [x] **Phase 3: Prevent Flash of Light Theme**
  - [x] Inject blocking inline theme detection script in `<head>` of `app/layout.tsx`
- [x] **Phase 4: Verification & Polish**
  - [x] Verify local compilation and run `npm run lint`
  - [x] Test toggling on guest landing page and dashboard
  - [x] Verify contrast and aesthetics of cards, badges, dialogs, and text fields in dark mode
  - [x] Run production build `npm run build`

## Review

### Verification Outcomes
1. **Compilation & Linting**: Successfully ran `npm run lint` without errors. Wrapped state setters `setMounted` and `setTheme` within a deferred `setTimeout` block in `components/theme-toggle.tsx` to prevent cascading render warnings.
2. **Production Build**: Successfully compiled and generated static pages with `npm run build` on the Next.js Turbopack compiler.
3. **No FOUT (Flash of Unstyled Theme)**: Injected a blocking, inline script in `app/layout.tsx` to apply the stored/preference theme before the initial layout render. Added `suppressHydrationWarning` on the `<html>` tag to resolve hydration warning mismatches triggered by the client-side modification of `data-theme`.
4. **Contrast & Aesthetics**: All core surface colors, button styles, badges, and outline borders are mapped to CSS variables that cleanly support both dark and light modes. Checked standard color mappings such as `--on-warm-brown`, `--on-dark-charcoal`, and `--outline-variant`.
