# CSS Design Tokens, Class Standards & Responsive Breakpoints

This guide documents the real, currently-in-use CSS custom properties, Tailwind
utility-class conventions, and responsive breakpoint patterns across
WorkSphere. It complements [`STYLING_SYSTEM.md`](./STYLING_SYSTEM.md), which
covers the Tailwind v4 `@theme` setup and animations in more depth — this
document focuses on (1) a complete token reference, (2) class-writing
standards, and (3) breakpoint/grid conventions.

> **Note on scope:** everything below was verified directly against
> `src/app/globals.css` and usage across `src/app` / `src/components` at the
> time of writing. If you add or change a token/utility, please update this
> file in the same PR so it doesn't drift out of date.

---

## 1. CSS Custom Variables & Theme Tokens

WorkSphere uses Tailwind v4's CSS-first configuration — there is no
`tailwind.config.js`. Everything lives in `src/app/globals.css`.

### 1.1 Root tokens

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}
```

| Token | Light | Dark | Used for |
| :--- | :--- | :--- | :--- |
| `--background` | `#ffffff` | `#0a0a0a` | `<body>` background |
| `--foreground` | `#171717` | `#ededed` | `<body>` text color |

Dark mode here is driven purely by the `prefers-color-scheme` media query —
**there is no `.dark` class toggle**. If you're adding a feature that needs a
manual light/dark switch, that mechanism doesn't exist yet; you'd need to
introduce it (e.g. a `.dark` class + `next-themes`) rather than assume it's
already wired up.

### 1.2 Theme registration (`@theme inline`)

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

This is what makes `bg-background`, `text-foreground`, `font-sans`, and
`font-mono` work as Tailwind utility classes. **Only `background` and
`foreground` are registered as color tokens today.** There is currently no
`--card`, `--border`, `--glow-primary`, `--glow-success`, or similar semantic
token in `@theme` — pages that need a "card" or "glow" look build it directly
with Tailwind utilities (see §1.3–1.4), not a reusable CSS variable.

If your feature introduces a new semantic color that should be reusable as a
utility class (e.g. `bg-primary`), add it here under `@theme inline` and
document it in this table so the next contributor doesn't have to rediscover
it by reading `globals.css`.

### 1.3 "Card" surface — dominant pattern

There's no `--card` variable, but there is a strong de facto convention for
dark dashboard/panel surfaces, used 18+ times across `src/app`:

```html
<div class="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
  ...
</div>
```

A `rounded-2xl` variant of the same border/background pair is used for
smaller/nested elements. Prefer this pattern over introducing a new card
style for dark-themed dashboard UI — it's what admin dashboards, analytics
panels, and settings forms already use.

The legacy `.glass-card` utility class (light-mode frosted card) still exists
in `globals.css` but is only used in one place (`BrainTerminal.tsx`) — treat
it as legacy rather than the current standard for new dark-UI work.

### 1.4 "Glowing" borders & ambient blobs

Glow effects aren't a token either — they're either:

- **Ambient background blobs**, e.g.:
```html
  <div class="absolute -left-48 top-24 h-96 w-96 rounded-full bg-violet-700/15 blur-[120px]" />
```
  Blur radius in practice ranges `blur-[100px]` to `blur-[130px]`; 120–130px is
  most common for full-page ambient blobs.

- **Glowing card borders**, using low-opacity colored borders such as
  `border-violet-400/20`, `border-amber-500/30`, `border-emerald-400/20`.

- **The `.glow-blue` / `.animate-pulseGlow` utilities** in `globals.css`,
  which apply a literal `box-shadow: 0 0 20px rgba(59, 130, 246, 0.3)` — these
  predate the newer violet-accented dashboard style and are only used in 2
  files. New dashboard-style UI tends to use the blur-blob + translucent
  border approach above rather than `.glow-blue`.

**Browser fallback:** Tailwind v4 generates opacity-modifier utilities (e.g.
`bg-violet-700/15`) using CSS `color-mix()`, which isn't supported on older
Android WebViews. `globals.css` has an explicit `@supports not (...)`
fallback block with hard-coded `rgba()` equivalents for every blur-blob and
glow-border color combination currently in use (see the bottom of the file).
**If you introduce a new blur-blob or glow-border color, add its `rgba()`
fallback to that block in the same PR**, or it will render as flat black on
unsupported engines (this was the root cause of issue #153).

### 1.5 Animations

Defined as global `@keyframes` + matching `.animate-*` class:

| Class | Effect | Duration |
| :--- | :--- | :--- |
| `.animate-gradient` | Animates `background-position` for a shifting gradient | 6s, infinite |
| `.animate-fadeInUp` | Fade in + slide up on mount | 0.6s ease-out |
| `.animate-pulseGlow` | Pulses a blue `box-shadow` | 2s, infinite |
| `.animate-shimmer` | Horizontal shimmer sweep, for loading skeletons | 1.5s, infinite |

### 1.6 Scrollbar, focus, and selection

Also globally defined and theme-aware (light/dark via `prefers-color-scheme`):

```css
::-webkit-scrollbar-thumb { background: #d1d5db; }
*:focus-visible { outline: 2px solid #3b82f6; outline-offset: 2px; }
::selection { background: rgba(59, 130, 246, 0.3); }
```

---

## 2. Utility Class Standards

There is **no automated class-sorting tool** configured (no
`prettier-plugin-tailwindcss`, no `tailwind.config.js` rule) — ordering below
is a documented convention based on the patterns already used throughout the
codebase, enforced by code review rather than tooling.

### 2.1 Class ordering convention

Write utility classes in this rough order, matching existing components:

1. **Layout** — `flex`, `grid`, `absolute`, `relative`, positioning (`inset-0`, `-left-48`)
2. **Sizing** — `w-*`, `h-*`, `max-w-*`
3. **Spacing** — `p-*`, `m-*`, `gap-*`
4. **Border/shape** — `rounded-*`, `border`, `border-{color}/{opacity}`
5. **Background/color** — `bg-*`, `text-*`
6. **Typography** — `text-sm`, `font-medium`, `tracking-*`
7. **Effects** — `shadow-*`, `blur-*`, `backdrop-blur-*`, `transition`

Example, from an existing dashboard card:
```html
<article class="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/10 backdrop-blur-xl">
```

### 2.2 Arbitrary values

Bracketed arbitrary values (`bg-white/[0.04]`, `blur-[120px]`) are used
throughout instead of forcing a value onto the closest Tailwind scale step —
this is intentional and consistent with the existing dark-glass aesthetic.
Prefer matching an existing arbitrary value (e.g. reuse `bg-white/[0.04]`
rather than inventing `bg-white/[0.05]`) unless there's a specific reason for
the new value.

### 2.3 Text color scale

For body/secondary text on dark surfaces, the codebase consistently uses:

| Class | Frequency | Typical use |
| :--- | :--- | :--- |
| `text-zinc-400` | most common | secondary body text, descriptions |
| `text-zinc-500` | very common | muted/tertiary text, captions |
| `text-zinc-300` | common | slightly emphasized secondary text |
| `text-zinc-200` | occasional | table rows, list items |

Stick to this scale rather than introducing new grays (e.g. `slate-*` or
`gray-*`) — the app is consistently `zinc`-based.

### 2.4 `backdrop-blur`

`backdrop-blur-xl` for prominent cards/panels, `backdrop-blur-md` for
secondary surfaces, `backdrop-blur-sm` for subtle inline elements (all three
are in active use — pick based on how much visual separation the element
needs from what's behind it).

### 2.5 Client vs. server component classes

Utility classes are written identically whether the component is a server or
client component — there's no different convention for either. Conditional
classes (e.g. active tab state) are built with template literals, not a
`clsx`/`cn`-style helper in most existing files, though `src/lib/utils.ts`
does export a `cn()` helper (`clsx` + `tailwind-merge`) for components that
need to merge conditional classes with a `className` prop — prefer `cn()` for
new reusable components that accept `className`.

---

## 3. Responsive Breakpoints & Layout Grids

Tailwind v4 default breakpoints apply (no custom `screens` config exists):

| Prefix | Min width | Actively used in this codebase? |
| :--- | :--- | :--- |
| `sm` | 640px | Yes — 40+ occurrences |
| `md` | 768px | Yes — most-used breakpoint (50+ occurrences) |
| `lg` | 1024px | Yes — 45+ occurrences |
| `xl` | 1280px | Yes — occasional, mostly dashboard grids |
| `2xl` | 1536px | **Not currently used anywhere in the app** |

Don't reach for `2xl:` unless you have a concrete reason — there's no
existing convention for it, so introducing it means you're defining new
territory rather than following an established pattern.

### 3.1 Container widths

Pages wrap content in a `max-w-* mx-auto` container. Observed conventions by
page type:

| Container | Typical page type |
| :--- | :--- |
| `max-w-3xl mx-auto` | Narrow forms/settings pages |
| `max-w-5xl mx-auto` | Standard dashboard pages (most common) |
| `max-w-7xl mx-auto` | Wide analytics/admin dashboards with multi-column grids |

Match the container to the page type above rather than picking an arbitrary
width — it keeps dashboard pages visually consistent with each other.

### 3.2 Grid patterns

Common responsive grid progressions already in use — reuse these rather than
inventing a new column progression:

```html
<!-- Metric/stat cards -->
<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">

<!-- Two-column dashboard section (e.g. chart + side panel) -->
<div class="grid gap-6 xl:grid-cols-5"> <!-- children use xl:col-span-3 / xl:col-span-2 -->

<!-- Simple content grid -->
<div class="grid grid-cols-1 md:grid-cols-3 gap-6">

<!-- Compact icon/amenity grid -->
<div class="grid grid-cols-2 md:grid-cols-4 gap-3">
```

General rule: start at `grid-cols-1` (or `grid-cols-2` for small icon-style
items) on mobile, expand at `sm`/`md`, and only go to `xl:grid-cols-5`+ for
data-dense admin/analytics dashboards meant to be viewed on a desktop-sized
screen.

### 3.3 Breakpoint order

Always write breakpoint variants mobile-first and in ascending order
(`sm:` → `md:` → `lg:` → `xl:`), matching every existing usage in the
codebase — Tailwind doesn't enforce this, but reviewers will expect it for
readability.

---

## Related docs

- [`STYLING_SYSTEM.md`](./STYLING_SYSTEM.md) — Tailwind v4 `@theme` setup,
  font loading, and animation reference (this doc doesn't repeat that content).
- [`DESIGN_SYSTEM_TOKENS.md`](./DESIGN_SYSTEM_TOKENS.md) — ⚠️ predates this
  doc and describes tokens (`--card`, `--border`, `--glow-primary`,
  `--glow-success`, a `.dark` class hook) that do not currently exist in
  `globals.css`. Treat this document, not that one, as the accurate reference
  until that file is corrected or removed.

## Keeping this doc accurate

When you add a new theme token, utility convention, or breakpoint pattern:
1. Update the relevant table above in the same PR.
2. If it's a new `@theme` color token, also register it in `globals.css` under `@theme inline`.
3. If it's a new blur-blob or glow-border color, add its `rgba()` fallback to the `@supports not (...)` block (see §1.4).
4. Run `npm run lint` and `npx tsc --noEmit` per the [Contributing Guidelines](../CONTRIBUTING.md).