# UI Spacing & Design Token Reference

## Overview

Reference for this project's design tokens, spacing conventions, component variants, and reusable styling utilities. Follow these conventions when creating or updating UI components to keep a consistent look across the app. This doc reflects what's actually implemented in `globals.css` and `components/ui/*` — update it when those change.

---

## Color Tokens

CSS custom properties, defined in `globals.css` and mapped via Tailwind's `@theme inline`:

| Token          | Light     | Dark      | Purpose         |
| -------------- | --------- | --------- | --------------- |
| `--background` | `#ffffff` | `#0a0a0a` | Page background |
| `--foreground` | `#171717` | `#ededed` | Primary text    |

Theme mappings:

| Theme Variable       | Maps To                  |
| -------------------- | ------------------------ |
| `--color-background` | `var(--background)`      |
| `--color-foreground` | `var(--foreground)`      |
| `--font-sans`        | `var(--font-geist-sans)` |
| `--font-mono`        | `var(--font-geist-mono)` |

⚠️ **Missing token:** `--color-ring` (and a backing `--ring`) is **not** defined here, but `Button` and `Input` both use `focus-visible:ring-ring`. See [Focus, Selection & Scrollbars](#focus-selection--scrollbars) for the resulting bug and the fix.

`color-scheme: light dark` is set on `:root` so native form controls (scrollbars, checkboxes, etc.) render correctly in both themes.

Beyond the two custom tokens above, components lean directly on **Tailwind's zinc, blue, and red scales** rather than semantic tokens — e.g. `zinc-900`/`zinc-50` for primary buttons, `zinc-200`/`zinc-800` for borders, `blue-600` for accents, `red-500`/`red-900` for destructive actions. Keep new components on this same palette rather than introducing new color families.

---

## Typography

- Primary font: **Geist Sans** (`--font-geist-sans`, loaded via `next/font/google`)
- Monospace font: **Geist Mono** (`--font-geist-mono`)
- Fallback: `Arial, Helvetica, sans-serif` (set directly on `body`, used before fonts load)

Common utilities in use: `text-sm`, `font-medium`, `leading-none`.

---

## Component Reference

### Button (`components/ui/button.tsx`)

Six variants × four sizes. Currently implemented as chained `variant === "x" && "..."` / `size === "y" && "..."` conditionals inside `cn(...)`, not `class-variance-authority` — works correctly, but has no compile-time exhaustiveness check and gets harder to scan as variants grow. Consider migrating to `cva` if more variants get added.

| Variant       | Light                                            | Dark                                               |
| ------------- | ------------------------------------------------ | -------------------------------------------------- |
| `default`     | `bg-zinc-900 text-zinc-50`, hover `zinc-900/90`  | `bg-zinc-50 text-zinc-900`, hover `zinc-50/90`     |
| `destructive` | `bg-red-500 text-zinc-50`, hover `red-500/90`    | `bg-red-900 text-zinc-50`, hover `red-900/90`      |
| `outline`     | `border-zinc-200 bg-white`, hover `bg-zinc-100`  | `border-zinc-800 bg-zinc-950`, hover `bg-zinc-800` |
| `secondary`   | `bg-zinc-100 text-zinc-900`, hover `zinc-100/80` | `bg-zinc-800 text-zinc-50`, hover `zinc-800/80`    |
| `ghost`       | transparent, hover `bg-zinc-100`                 | transparent, hover `bg-zinc-800`                   |
| `link`        | `text-zinc-900`, underline on hover              | `text-zinc-50`, underline on hover                 |

| Size      | Height      | Padding     | Notes             |
| --------- | ----------- | ----------- | ----------------- |
| `default` | `h-10`      | `px-4 py-2` |                   |
| `sm`      | `h-9`       | `px-3`      |                   |
| `lg`      | `h-11`      | `px-8`      |                   |
| `icon`    | `h-10 w-10` | —           | square, icon-only |

Base classes on every button: `inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors ring-offset-background`, plus the shared focus/disabled states below.

⚠️ **Two known issues in the current implementation:**

- No default `type` is set, so native `<button>` defaults to `type="submit"` — any button used inside a `<form>` for a non-submit action will silently submit it unless the consumer remembers to pass `type="button"` explicitly. Fix: default `type = "button"` in the component and let callers override it.
- `focus-visible:outline-none` is paired with `focus-visible:ring-ring`, but `--color-ring` doesn't exist (see Color Tokens above) — combined with the missing token, keyboard focus currently has **no visible indicator at all** on `Button`/`Input`. Don't copy this pattern into new components until `--ring` is added.

### Input (`components/ui/input.tsx`)

- `h-10 w-full rounded-md border px-3 py-2 text-sm`
- Light: `border-zinc-200 bg-white`, placeholder `text-zinc-500`
- Dark: `border-zinc-800 bg-zinc-950`, placeholder `text-zinc-400`
- `ring-offset-background` + shared focus-visible ring
- `disabled:cursor-not-allowed disabled:opacity-50`

### Label (`components/ui/label.tsx`)

- `text-sm font-medium leading-none`
- `text-zinc-900 dark:text-zinc-50`
- `peer-disabled:cursor-not-allowed peer-disabled:opacity-70` — pair with an adjacent `peer` input to auto-dim the label when the input is disabled

---

## Layout Patterns

Flex utilities in common use: `flex`, `inline-flex`, `flex-1`, `items-center`, `items-start`, `justify-center`, `justify-start`, `w-full`.

Spacing utilities in common use: `gap-1`, `gap-1.5`, `gap-2`, `space-y-2`, `p-2`, `p-3`, `px-4`, `py-3`.

**Grid:** no shared grid template or standardized column config exists yet. Match surrounding component patterns until one is established — don't invent a one-off grid convention.

---

## Background Utilities

### `.glass-card`

```css
bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl
```

### `.glow-blue`

```css
box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
```

Static version of the `pulseGlow` animation below — use this for a constant glow, `animate-pulseGlow` for a breathing one.

⚠️ `globals.css` also defines a `.text-glow` utility (`text-shadow: none;`) — this is a no-op as written and doesn't apply any glow. Either dead code to remove, or a bug where the intended shadow value was lost; check for usages before touching it.

---

## Shadows & Borders

| Utility                                | Usage                                            |
| -------------------------------------- | ------------------------------------------------ |
| `shadow-xl`                            | Cards, elevated surfaces, Clerk's `card` element |
| Blue glow (`.glow-blue` / `pulseGlow`) | Accent/highlighted elements                      |

Border radius scale: `rounded`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-full`. Reuse these rather than introducing new radius values.

---

## Focus, Selection & Scrollbars

`Button` and `Input` declare a themed focus ring:
`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`

⚠️ **Known bug:** `--color-ring` isn't defined anywhere in `globals.css` — `@theme inline` only maps `background`, `foreground`, and the two fonts (see Color Tokens). Because these components also set `focus-visible:outline-none`, they suppress the global outline below _and_ have no working ring color, leaving keyboard focus with **no visible indicator** on these components. Needs a `--ring` value in `:root`/`.dark` plus `--color-ring` in `@theme inline` — until fixed, don't reuse `ring-ring` in new components.

Global fallback, used by anything that does _not_ set `outline-none`:
`*:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }` — the actual blue (`#3b82f6` / `blue-500`) shown when an element isn't overriding it.

Text selection: `::selection { background: rgba(59, 130, 246, 0.3); }` — same blue family, kept consistent with focus and glow.

Scrollbars are custom-styled (WebKit + Firefox `scrollbar-color`):

- Track: transparent
- Thumb: `zinc-300` (light) / `zinc-700` (dark), hover `zinc-400` / `zinc-600`
- Width: `8px`

Disabled state, standard across components: `disabled:opacity-50 disabled:pointer-events-none` (buttons) or `disabled:cursor-not-allowed disabled:opacity-50` (inputs).

---

## Theme System

- Implemented via React context in `ThemeProvider.tsx`, persisted to `localStorage` under `worksphere-theme`.
- A blocking inline script (`THEME_INIT_SCRIPT`) runs in `<head>` before paint, reads `localStorage` (falling back to `prefers-color-scheme`), and sets the `dark` class + `color-scheme` on `<html>` — this is what prevents a flash of the wrong theme.
- `ThemeProvider` reads that already-applied class back on mount rather than re-deciding, so client and server never disagree.
- Cross-tab sync via a `storage` event listener: changing the theme in one tab updates every other open tab.
- `ThemeToggle` renders an inert placeholder `<div>` for one frame until `mounted` is `true`, as a defensive guard against any future SSR/CSR mismatch (belt-and-suspenders on top of the provider's own hydration-safe read).
- Components adapt via Tailwind's `dark:` variant throughout.

⚠️ There is currently a **second**, redundant dark-mode script in `layout.tsx`'s `<head>` that checks `prefers-color-scheme` directly and does _not_ read `localStorage`. It races against `THEME_INIT_SCRIPT` and can override an explicit user choice on load. Treat `THEME_INIT_SCRIPT` as the single source of truth and remove the duplicate.

---

## Loading Skeletons

Base primitive: `Skeleton` — `animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800`, size controlled entirely via `className`.

Composed skeletons, all built from the primitive above and matching their real component's layout:

| Component             | Mirrors                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `VenueCardSkeleton`   | Single venue card: icon, title/score row, category, address, amenity badges, action-button row |
| `VenueListSkeleton`   | A list of `VenueCardSkeleton` (default count: 3) with a heading placeholder                    |
| `ChatMessageSkeleton` | An incoming chat bubble, three lines                                                           |
| `AgentStepsSkeleton`  | 5-step timeline with left border, icon + label per step                                        |
| `MapMarkerSkeleton`   | Centered circular marker placeholder over a filled panel                                       |

Convention: skeleton layouts should reuse the same spacing/flex classes as the real component they stand in for, so there's no layout shift on load — don't approximate.

---

## Animations

| Class               | Effect                                                            |
| ------------------- | ----------------------------------------------------------------- |
| `animate-gradient`  | 6s background-position cycle, for animated gradients              |
| `animate-fadeInUp`  | 0.6s fade + 20px upward translate, one-shot                       |
| `animate-pulseGlow` | 2s infinite breathing blue glow (20px ↔ 40px spread)              |
| `animate-shimmer`   | 1.5s infinite diagonal shimmer sweep, for skeleton/loading states |

Use sparingly — these are for drawing attention or signaling loading state, not general decoration.

---

## Legacy Browser Fallback

`globals.css` includes an `@supports not (background: color-mix(in oklab, red, red))` block. Tailwind v4 generates opacity-modifier utilities (e.g. `bg-blue-700/10`) using `color-mix()`, which older Android WebView engines don't support — without the fallback those elements render flat black instead of translucent.

Covers the neon-blur-blob backgrounds and glowing card borders (see issue #153): `bg-{color}-{shade}/{opacity}` and `border-{color}-{shade}/{opacity}` pairs are hand-written as static `rgba()` values inside this block. Modern browsers never hit this code path.

**If you add a new opacity-modifier utility** (e.g. `bg-emerald-600/15`) to a component that needs to support this fallback path, add the matching static `rgba()` rule here too — Tailwind won't generate it for you inside `@supports not (...)`.

---

## Housekeeping Notes

`globals.css` has accumulated a few harmless-but-pointless duplications worth cleaning up next time it's touched (none affect rendering, they just add noise):

- `@import "tailwindcss";` is declared twice.
- The `body { background / color / font-family }` rule is declared twice, identically.
- `html { ... }` is declared as two separate blocks (once for background/color, once for `scroll-behavior`/scrollbar) — harmless since CSS merges them, but should be one block.

---

## Best Practices

- Reuse existing CSS variables and the zinc/blue/red palette instead of hardcoding new colors.
- Follow the established spacing scale (`gap-1`–`gap-2`, `p-2`–`p-3`) for consistent layouts.
- Prefer `cva`-based variant props over ad-hoc conditional class strings for any component with more than 2–3 style states — `Button` doesn't do this yet (see note above) and would benefit from migrating.
- Use theme-aware (`dark:`) variants for all new UI — never assume light-only.
- Reuse existing border radius, shadow, and animation utilities before adding new ones.
- New skeletons should match their real component's spacing/flex structure exactly, not approximate it.
- If a new component uses a Tailwind opacity-modifier class (`/10`, `/20`, etc.), add the corresponding fallback under the `@supports not (color-mix(...))` block.
- Don't use `focus-visible:ring-ring` in new components until `--ring`/`--color-ring` is actually defined — it currently resolves to nothing.
- Give interactive `<button>` components an explicit default `type="button"` so they can't accidentally submit a parent `<form>`.
