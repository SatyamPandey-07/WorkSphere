\# Responsive Design Standards

This document defines the responsive design strategy for WorkSphere, including breakpoints, the mobile-first approach, Tailwind CSS screen modifiers, layout shift strategies, and handling of special device cases like iPad landscape.

\## 1. Breakpoint Definitions

WorkSphere follows Tailwind CSS's default breakpoint system. All layouts must be built mobile-first, then progressively enhanced for larger screens.

| Breakpoint | Prefix | Min Width | Typical Devices |

|---|---|---|---|

| Default (base) | \*(none)\* | 0px | Small phones |

| Small | `sm:` | 640px | Large phones, small tablets (portrait) |

| Medium | `md:` | 768px | Tablets (portrait), iPad portrait |

| Large | `lg:` | 1024px | Tablets (landscape), iPad landscape, small laptops |

| Extra Large | `xl:` | 1280px | Laptops, desktops |

| 2X Large | `2xl:` | 1536px | Large desktops, wide monitors |

```css

/\* Reference — Tailwind default breakpoints \*/

sm  → 640px

md  → 768px

lg  → 1024px

xl  → 1280px

2xl → 1536px

```

\## 2. Mobile-First Approach

WorkSphere follows a strict \*\*mobile-first\*\* methodology:

\- Write base (unprefixed) styles for the smallest screen first.

\- Add complexity progressively using `sm:`, `md:`, `lg:`, `xl:`, `2xl:` prefixes.

\- Never design for desktop first and scale down — this causes bloated CSS and inconsistent mobile UX.

\*\*Example:\*\*

```jsx
<div className="flex flex-col gap-2 p-4 sm:flex-row sm:gap-4 lg:gap-6 lg:p-8">
  &#x20; {/\* Stacked on mobile, row layout from sm: upward \*/}
</div>
```

\### Guidelines

\- Default to single-column layouts on mobile.

\- Use `flex-col` → `sm:flex-row` / `md:flex-row` patterns for layout shifts.

\- Avoid fixed pixel widths; prefer `w-full`, `max-w-\*`, and `flex`/`grid` utilities.

\- Font sizes should scale using responsive text utilities (`text-sm md:text-base lg:text-lg`).

\## 3. Tailwind Screen Modifiers — Usage Rules

\- Always chain modifiers in ascending order for readability: base → `sm:` → `md:` → `lg:` → `xl:` → `2xl:`.

\- Use `hidden` / `block` combinations to toggle visibility across breakpoints instead of duplicating components.

```jsx
{
  /\* Sidebar hidden on mobile, visible from md: upward \*/;
}

<aside className="hidden md:block md:w-64">...</aside>;

{
  /\* Mobile nav toggle, hidden from md: upward \*/;
}

<button className="md:hidden">Menu</button>;
```

\- Avoid excessive breakpoint chaining on a single element (max 3–4 responsive variants per property) — if a component needs more, consider splitting it or using container queries.

\- Use `container` or `max-w-screen-\*` utilities to constrain content width on large screens rather than letting text stretch full-width.

\## 4. Layout Shift Strategies

To minimize Cumulative Layout Shift (CLS) across breakpoints:

1\. \*\*Reserve space\*\* for images/media using `aspect-ratio` utilities (`aspect-video`, `aspect-square`) instead of letting images load without dimensions.

2\. \*\*Skeleton loaders\*\* should match the final layout's grid/flex structure so content doesn't jump when it loads.

3\. \*\*Avoid conditional rendering that changes DOM structure\*\* across breakpoints (e.g., rendering completely different components for mobile vs desktop). Prefer CSS-based show/hide (`hidden md:block`) over JS-based conditional mounts where feasible, since this reduces re-render-triggered shifts.

4\. \*\*Fixed header/footer heights\*\* should be defined with consistent `h-\*` classes across breakpoints, or use `min-h-\*` to prevent collapse.

5\. \*\*Font loading\*\*: use `font-display: swap` and predefine fallback font metrics to avoid text reflow (FOUT/FOIT shift).

6\. \*\*Grid over float/inline-block\*\*: use `grid` with defined `grid-template-columns` per breakpoint so items don't reflow unpredictably.

```jsx

<img

&#x20; src="/banner.jpg"

&#x20; alt="Banner"

&#x20; className="w-full aspect-video object-cover"

/>

```

\## 5. Special Case Handling

\### 5.1 iPad Landscape (1024px width)

iPad landscape lands exactly on Tailwind's `lg:` breakpoint (1024px), which can cause layout ambiguity since it sits between "tablet" and "small laptop" designs.

\- Test all `lg:` layouts explicitly at \*\*1024×768\*\* (iPad landscape) in addition to standard laptop widths (1280px+).

\- Avoid assuming `lg:` = desktop. Sidebars, multi-column grids, and dense tables should be checked for cramped spacing at exactly 1024px.

\- If a `lg:` layout looks too tight on iPad landscape, consider adding an intermediate adjustment using arbitrary values: `lg:grid-cols-2 xl:grid-cols-3` rather than jumping straight to 3+ columns at `lg:`.

\### 5.2 iPad Portrait (768px width)

\- Lands on `md:` breakpoint. Treat this as a true tablet layout, not a "small desktop" — navigation should still favor touch-friendly tap targets (min 44×44px).

\### 5.3 Foldables \& Unusual Aspect Ratios

\- Use `min-h-screen` cautiously; prefer `min-h-dvh` (dynamic viewport height) where supported, to handle foldable/notched devices correctly.

\### 5.4 Touch vs Pointer Devices

\- Use the `pointer: coarse` / `hover: hover` media features (via Tailwind's `pointer-coarse:` / `hover:` variants where configured) to avoid hover-dependent UI (tooltips, hover menus) becoming inaccessible on touch devices like iPads.

\## 6. Testing Checklist

Before merging any UI change, verify at minimum:

\- \[ ] 375px (small phone)

\- \[ ] 640px (`sm`)

\- \[ ] 768px (`md` / iPad portrait)

\- \[ ] 1024px (`lg` / iPad landscape)

\- \[ ] 1280px (`xl`)

\- \[ ] 1536px+ (`2xl`)

Use browser dev tools' responsive mode with the iPad presets specifically, since `md`/`lg` boundary bugs are the most common source of layout shift reports in WorkSphere.
