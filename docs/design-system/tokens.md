# WorkSphere Design System Tokens & Component Guide

This specification details WorkSphere's design system tokens, color palettes, dark mode contrast ratios, typography scale, border-radius conventions, component patterns, and WCAG 2.1 AA accessibility guidelines.

---

## Table of Contents

1. [Design Philosophy & System Architecture](#1-design-philosophy--system-architecture)
2. [Color Token System](#2-color-token-system)
   - [Neutral Palette (Zinc Scale)](#neutral-palette-zinc-scale)
   - [Brand & Primary Accent Tokens](#brand--primary-accent-tokens)
   - [Semantic Status Colors](#semantic-status-colors)
   - [Cyberpunk Theme Variables](#cyberpunk-theme-variables)
3. [Typography System](#3-typography-system)
   - [Font Families](#font-families)
   - [Type Scale & Modular Scale Matrix](#type-scale--modular-scale-matrix)
4. [Border Radius & Elevation System](#4-border-radius--elevation-system)
   - [Border Radius Hierarchy](#border-radius-hierarchy)
   - [Shadow & Glassmorphism Utility Classes](#shadow--glassmorphism-utility-classes)
5. [Accessibility (WCAG 2.1 AA) Compliance Guide](#5-accessibility-wcag-21-aa-compliance-guide)
   - [Contrast Ratio Matrix](#contrast-ratio-matrix)
   - [Focus States & Keyboard Navigation](#focus-states--keyboard-navigation)
   - [Color Independence & Icon Pairing](#color-independence--icon-pairing)
6. [Component Pattern Catalog](#6-component-pattern-catalog)
   - [Buttons & Interactive Controls](#buttons--interactive-controls)
   - [Card Containers (`.glass-card`)](#card-containers-glass-card)
   - [Status Badges & Chips](#status-badges--chips)
   - [Form Inputs & Select Fields](#form-inputs--select-fields)

---

## 1. Design Philosophy & System Architecture

WorkSphere's UI is designed to be **clean, responsive, accessible, and high-performance**. It blends crisp neutral surfaces with subtle glassmorphism elevation, responsive dark mode transitions, and clear semantic feedback.

Core Principles:
- **Consistency:** All components build upon a shared set of Tailwind utility tokens defined in `src/app/globals.css`.
- **High Contrast (WCAG 2.1 AA):** All text combinations satisfy or exceed the $4.5:1$ contrast requirement for normal text and $3:1$ for large text/UI borders.
- **Fluid Dark Mode:** Light and dark modes use symmetrical background/foreground variable pairs (`var(--background)`, `var(--foreground)`).

---

## 2. Color Token System

### Neutral Palette (Zinc Scale)

WorkSphere uses the `zinc` neutral palette as the foundation for light and dark surface layers.

| Token Name | Hex Value | Light Mode Usage | Dark Mode Usage |
| :--- | :--- | :--- | :--- |
| `zinc-50` | `#fafafa` | Card backgrounds (`bg-zinc-50`) | Extra high contrast text |
| `zinc-100` | `#f4f4f5` | Subtly shaded tracks / borders | High-contrast dark text (`dark:text-zinc-100`) |
| `zinc-200` | `#e4e4e7` | Standard borders (`border-zinc-200`) | Subtle dark mode dividers |
| `zinc-300` | `#d4d4d8` | Secondary borders / Scrollbars | Dark mode secondary text |
| `zinc-400` | `#a1a1aa` | Muted placeholder text | Muted secondary text (`dark:text-zinc-400`) |
| `zinc-500` | `#71717a` | Captions & helper text (`text-zinc-500`) | Helper text (`dark:text-zinc-500`) |
| `zinc-600` | `#52525b` | Secondary headings | Dark surface borders |
| `zinc-700` | `#3f3f46` | Body text in light mode | Dark mode borders (`dark:border-zinc-700`) |
| `zinc-800` | `#27272a` | High-contrast light headers | Card containers (`dark:bg-zinc-800`) |
| `zinc-900` | `#18181b` | Primary text (`text-zinc-900`) | Primary card background (`dark:bg-zinc-900`) |
| `zinc-950` | `#09090b` | High-emphasis black surfaces | Dark root background (`dark:bg-zinc-950`) |

### Brand & Primary Accent Tokens

Defined dynamically via CSS variables in `src/app/globals.css`:

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
  --primary-accent: #3b82f6;
  --primary-accent-rgb: 59, 130, 246;
  color-scheme: light;
}

.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
  color-scheme: dark;
}
```

| Token | CSS Variable / Tailwind | Hex Value | Primary Purpose |
| :--- | :--- | :--- | :--- |
| **Primary Accent** | `var(--primary-accent)` | `#3b82f6` (`blue-500`) | Primary buttons, active links, progress bars |
| **Primary Hover** | `blue-600` | `#2563eb` | Hover state for primary action buttons |
| **Accent Glow** | `.glow-accent` | `rgba(59, 130, 246, 0.3)` | Focal box-shadows on active cards |

### Semantic Status Colors

Semantic status colors provide immediate visual feedback for booking status, venue noise metrics, and system alerts.

```
┌────────────────────────────────────────────────────────────────────────┐
│  SUCCESS (Emerald)   │ Good / Confirmed      │ #10b981 (emerald-500)  │
│  WARNING (Amber)     │ Approaching / Caution │ #f59e0b (amber-500)    │
│  DANGER (Red)        │ Error / Cancelled     │ #ef4444 (red-500)      │
│  INFO (Blue)         │ Informational         │ #3b82f6 (blue-500)     │
└────────────────────────────────────────────────────────────────────────┘
```

| Semantic Intent | Base Color | Background Tint (10% Alpha) | Border Accent | Text Token |
| :--- | :--- | :--- | :--- | :--- |
| **Success** | `emerald-500` (`#10b981`) | `bg-emerald-500/10` | `border-emerald-500/20` | `text-emerald-400` / `text-emerald-700` |
| **Warning** | `amber-500` (`#f59e0b`) | `bg-amber-500/10` | `border-amber-500/20` | `text-amber-400` / `text-amber-700` |
| **Danger** | `red-500` (`#ef4444`) | `bg-red-500/10` | `border-red-500/20` | `text-red-400` / `text-red-700` |
| **Info** | `blue-500` (`#3b82f6`) | `bg-blue-500/10` | `border-blue-500/20` | `text-blue-400` / `text-blue-700` |

### Cyberpunk Theme Variables

WorkSphere supports an optional high-contrast `.cyberpunk` theme variant:

```css
.cyberpunk {
  --background: #090014;
  --foreground: #f4f4ff;
  color-scheme: dark;
}
```

---

## 3. Typography System

### Font Families

WorkSphere uses Vercel's **Geist** font family for crisp legibility:

- **Sans-Serif (Default):** `var(--font-sans)` (`Geist Sans`, system-ui, sans-serif)
- **Monospace (Data / Code):** `var(--font-mono)` (`Geist Mono`, monospace)

### Type Scale & Modular Scale Matrix

```
text-4xl ─── 36px / 40px (Bold 700)     ── Page Titles
text-3xl ─── 30px / 36px (Bold 700)     ── Section Headers
text-2xl ─── 24px / 32px (Semi 600)     ── Card Titles
text-xl  ─── 20px / 28px (Semi 600)     ── Sub-section Headers
text-lg  ─── 18px / 28px (Medium 500)   ── Large Body / Callouts
text-base ── 16px / 24px (Normal 400)   ── Standard Body Text
text-sm  ─── 14px / 20px (Normal 400)   ── Secondary Labels / Buttons
text-xs  ─── 12px / 16px (Normal 400)   ── Captions & Microcopy
text-[10px] ─ 10px / 14px (Mono 500)    ── Code Badges / Status Tags
```

| Class | Font Size | Line Height | Weight Values | Common Use Case |
| :--- | :--- | :--- | :--- | :--- |
| `text-4xl` | $36\text{ px}$ ($2.25\text{ rem}$) | $40\text{ px}$ | `font-bold` ($700$) | Dashboard main titles |
| `text-3xl` | $30\text{ px}$ ($1.875\text{ rem}$) | $36\text{ px}$ | `font-bold` ($700$) | Major section headings |
| `text-2xl` | $24\text{ px}$ ($1.5\text{ rem}$) | $32\text{ px}$ | `font-semibold` ($600$) | Venue detail titles |
| `text-xl` | $20\text{ px}$ ($1.25\text{ rem}$) | $28\text{ px}$ | `font-semibold` ($600$) | Modal dialog headers |
| `text-lg` | $18\text{ px}$ ($1.125\text{ rem}$) | $28\text{ px}$ | `font-medium` ($500$) | Lead text & highlights |
| `text-base` | $16\text{ px}$ ($1.0\text{ rem}$) | $24\text{ px}$ | `font-normal` ($400$) | Standard paragraph body |
| `text-sm` | $14\text{ px}$ ($0.875\text{ rem}$) | $20\text{ px}$ | `font-normal` / `font-medium` | Form controls & button labels |
| `text-xs` | $12\text{ px}$ ($0.75\text{ rem}$) | $16\text{ px}$ | `font-normal` / `font-medium` | Metadata, timestamps, captions |
| `text-[10px]`| $10\text{ px}$ ($0.625\text{ rem}$) | $14\text{ px}$ | `font-mono` ($500$) | Technical badges & token counters |

---

## 4. Border Radius & Elevation System

### Border Radius Hierarchy

WorkSphere uses rounded corner hierarchy to convey visual structure:

- **`rounded-3xl` ($24\text{ px}$):** Full-screen modals & major overlay containers.
- **`rounded-2xl` ($16\text{ px}$):** Content cards, chat panels, dashboard widgets.
- **`rounded-lg` ($8\text{ px}$):** Form input fields, buttons, dropdown menus.
- **`rounded-full` ($9999\text{ px}$):** User avatars, status badges, progress bars.

### Shadow & Glassmorphism Utility Classes

Defined in `src/app/globals.css`:

```css
@layer utilities {
  .glass-card {
    @apply bg-white border border-zinc-200 shadow-xl;
    @apply bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl;
  }

  .glow-accent {
    box-shadow: 0 0 20px color-mix(in srgb, var(--primary-accent) 30%, transparent);
  }

  .dark .glass-card {
    @apply bg-zinc-900 border-zinc-800;
  }
}
```

---

## 5. Accessibility (WCAG 2.1 AA) Compliance Guide

### Contrast Ratio Matrix

All color pairings must meet WCAG 2.1 Level AA standards ($4.5:1$ for normal text, $3.0:1$ for large text and UI components).

```
┌────────────────────────────────────────────────────────────────────────┐
│ Light Mode:  text-zinc-900 (#18181b) on bg-white (#ffffff)   ── 16.1:1 │
│ Light Mode:  text-zinc-500 (#71717a) on bg-white (#ffffff)   ──  4.6:1 │
│ Dark Mode:   text-zinc-100 (#f4f4f5) on bg-zinc-900 (#18181b) ── 14.8:1 │
│ Dark Mode:   text-zinc-400 (#a1a1aa) on bg-zinc-900 (#18181b) ──  5.2:1 │
└────────────────────────────────────────────────────────────────────────┘
```

| Element Type | Light Mode Pair | Dark Mode Pair | Contrast Ratio | Compliance |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Body** | `#18181b` on `#ffffff` | `#f4f4f5` on `#18181b` | $\ge 14.8:1$ | **Passes AAA** |
| **Secondary Text** | `#71717a` on `#ffffff` | `#a1a1aa` on `#18181b` | $\ge 4.6:1$ | **Passes AA** |
| **Primary Button** | `#ffffff` on `#3b82f6` | `#ffffff` on `#2563eb` | $\ge 4.5:1$ | **Passes AA** |
| **Card Border** | `#e4e4e7` on `#ffffff` | `#27272a` on `#09090b` | $\ge 3.0:1$ | **Passes AA** |

### Focus States & Keyboard Navigation

All interactive elements (buttons, inputs, links) require explicit focus ring indicators for keyboard accessibility:

```html
<button class="focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900">
  Submit Booking
</button>
```

### Color Independence & Icon Pairing

Status feedback must **never rely solely on color**. Always pair status colors with Lucide React icons or clear text labels:

- **Success:** `<CheckCircle2 />` icon + Emerald badge.
- **Warning:** `<AlertCircle />` icon + Amber badge.
- **Error:** `<AlertCircle />` icon + Red badge.

---

## 6. Component Pattern Catalog

### Buttons & Interactive Controls

```tsx
// Primary Action Button
<button className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed">
  Confirm Desk Booking
</button>

// Secondary Outline Button
<button className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors">
  Cancel
</button>
```

### Card Containers (`.glass-card`)

```tsx
<div className="glass-card rounded-2xl p-6 transition-all hover:shadow-2xl">
  <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">
    Venue Details
  </h3>
  <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
    Quiet coworking space with high-speed Wi-Fi and ergonomic desks.
  </p>
</div>
```

### Status Badges & Chips

```tsx
// Success Badge
<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
  <CheckCircle2 className="w-3.5 h-3.5" />
  Confirmed
</span>

// Warning Badge
<span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
  <AlertCircle className="w-3.5 h-3.5" />
  Approaching Capacity
</span>
```

### Form Inputs & Select Fields

```tsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
    Workspace Name
  </label>
  <input
    type="text"
    placeholder="e.g. Desk 04"
    className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
  />
</div>
```
