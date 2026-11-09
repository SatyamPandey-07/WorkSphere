# Global Styling System & CSS Custom Variables Guide

This document catalogs the design token structure, utility class naming standards, and responsive boundary conditions implemented across the global rendering layouts.

---

## Table of Contents

- [1. CSS Custom Variables & Theme Tokens](#1-css-custom-variables--theme-tokens)
- [2. High-Contrast Accessibility Tokens (`--contrast-*`)](#2-high-contrast-accessibility-tokens---contrast-)
  - [2.1 High-Contrast Token Registry](#21-high-contrast-token-registry)
  - [2.2 Default vs. High-Contrast Values Comparison Table](#22-default-vs-high-contrast-values-comparison-table)
  - [2.3 Focus Outlines & Interactive State Standards](#23-focus-outlines--interactive-state-standards)
  - [2.4 Code Example: Styling an Accessible Card Component with Contrast Tokens](#24-code-example-styling-an-accessible-card-component-with-contrast-tokens)
- [3. Glassmorphism Template](#3-glassmorphism-template)
- [4. Shadow Guidelines](#4-shadow-guidelines)
- [5. Color Palette](#5-color-palette)
- [6. Typography Guidelines](#6-typography-guidelines)
- [7. Spacing Guidelines](#7-spacing-guidelines)
- [8. Backdrop Guidelines](#8-backdrop-guidelines)

---

## 1. CSS Custom Variables & Theme Tokens

The layout uses custom properties mounted to the `:root` pseudo-class for system-wide light/dark theme tracking. Dark mode variables are injected via the `.dark` class hook.

### Core Token Palette

| Token Name       | Light Mode Value         | Dark Mode Value          | Operational Context                                    |
| :--------------- | :----------------------- | :----------------------- | :----------------------------------------------------- |
| `--background`   | `#ffffff`                | `#09090b` (`zinc-950`)   | Global page viewport default background                |
| `--card`         | `#f4f4f5` (`zinc-100`)   | `#18181b` (`zinc-900`)   | Workspace display cards, panels, and dialog surfaces   |
| `--border`       | `#e4e4e7` (`zinc-200`)   | `#27272a` (`zinc-800`)   | Standard layout component dividing grid borders        |
| `--glow-primary` | `rgba(37, 99, 235, 0.1)` | `rgba(37, 99, 235, 0.4)` | AI-chatbot response accents and search glowing borders |
| `--glow-success` | `rgba(34, 197, 94, 0.1)` | `rgba(34, 197, 94, 0.4)` | Verified active geofenced check-in indicator overlays  |

### Custom Styling Definitions Example (`src/app/globals.css`)

```css
@theme {
  --color-background: var(--background);
  --color-card: var(--card);
  --color-border: var(--border);
  --color-glow-ui: var(--glow-primary);
}

.dark {
  --background: #09090b;
  --card: #18181b;
  --border: #27272a;
  --glow-primary: rgba(37, 99, 235, 0.4);
}
```

---

## 2. High-Contrast Accessibility Tokens (`--contrast-*`)

WorkSphere includes a dedicated High-Contrast Mode (WCAG 2.1 AAA compliant with 7:1+ contrast ratios) activated via `HighContrastToggle.tsx`. When toggled, `ThemeProvider.tsx` injects the `.high-contrast` class and `data-high-contrast="true"` attribute onto the root `<html>` element.

To ensure custom components built by frontend contributors remain fully accessible without writing verbose ad-hoc CSS overrides, the design system exposes semantic `--contrast-*` custom properties that automatically adapt between standard light/dark modes and high-contrast modes.

### 2.1 High-Contrast Token Registry

The following `--contrast-*` tokens are available system-wide:

- `--contrast-border`: Solid border color for cards, panels, dialogs, inputs, and dividers.
- `--contrast-text`: Maximum-contrast primary text color for headings, titles, and body content.
- `--contrast-text-muted`: Secondary text color elevated to guarantee 7:1 AAA contrast against the background.
- `--contrast-bg`: Root background color for viewport and primary containers.
- `--contrast-card-bg`: Surface background color for cards, modals, dropdowns, and flyout menus.
- `--contrast-focus`: Accent indicator color for focused elements.
- `--contrast-outline`: Solid 3px high-visibility outline for keyboard `:focus-visible` states.
- `--contrast-btn-bg`: Solid background fill for primary interactive buttons.
- `--contrast-btn-text`: High-contrast text label for primary buttons.
- `--contrast-interactive-active`: Accent color for active switches, checked boxes, and focused links.

---

### 2.2 Default vs. High-Contrast Values Comparison Table

| Token Name                      | Default Light Mode     | Default Dark Mode      | High-Contrast Light (`html.high-contrast`) | High-Contrast Dark (`html.high-contrast.dark`) | WCAG AAA Ratio & Purpose                 |
| :------------------------------ | :--------------------- | :--------------------- | :----------------------------------------- | :--------------------------------------------- | :--------------------------------------- |
| `--contrast-border`             | `#e4e4e7` (`zinc-200`) | `#27272a` (`zinc-800`) | `#000000` (Pure Black)                     | `#ffffff` (Pure White)                         | 21:1 ratio; delineates all boundaries    |
| `--contrast-text`               | `#171717` (`zinc-900`) | `#ededed` (`zinc-100`) | `#000000` (Pure Black)                     | `#ffffff` (Pure White)                         | 21:1 ratio; maximum readability          |
| `--contrast-text-muted`         | `#71717a` (`zinc-500`) | `#a1a1aa` (`zinc-400`) | `#000000` (Pure Black)                     | `#ffffff` (Pure White)                         | 21:1 ratio; eliminates low-contrast gray |
| `--contrast-bg`                 | `#ffffff` (White)      | `#0a0a0a` (Near Black) | `#ffffff` (Pure White)                     | `#000000` (Pure Black)                         | Unifies viewport canvas                  |
| `--contrast-card-bg`            | `#ffffff` (White)      | `#18181b` (`zinc-900`) | `#ffffff` (Pure White)                     | `#000000` (Pure Black)                         | Removes subtle gradients & opacity       |
| `--contrast-focus`              | `#3b82f6` (`blue-500`) | `#60a5fa` (`blue-400`) | `#000000` (Pure Black)                     | `#ffea00` (Vivid Yellow)                       | >7:1 focus indicator visibility          |
| `--contrast-outline`            | `2px solid #3b82f6`    | `2px solid #60a5fa`    | `3px solid #000000`                        | `3px solid #ffea00`                            | Eliminates invisible focus rings         |
| `--contrast-btn-bg`             | `#18181b` (`zinc-900`) | `#ffffff` (White)      | `#000000` (Pure Black)                     | `#ffffff` (Pure White)                         | Maximum button prominence                |
| `--contrast-btn-text`           | `#ffffff` (White)      | `#18181b` (`zinc-900`) | `#ffffff` (Pure White)                     | `#000000` (Pure Black)                         | 21:1 button label legibility             |
| `--contrast-interactive-active` | `#2563eb` (`blue-600`) | `#3b82f6` (`blue-500`) | `#0047bb` (Deep Cobalt)                    | `#38bdf8` (Vivid Cyan)                         | >7:1 interactive active states           |

---

### 2.3 Focus Outlines & Interactive State Standards

In high-contrast mode, default browser focus rings and subtle Tailwind box-shadows are replaced with high-visibility dual-ring outlines:

- **Light Mode Focus**: `outline: 3px solid #000000 !important; outline-offset: 2px; box-shadow: 0 0 0 4px #ffd600, 0 0 0 6px #000000 !important;`
- **Dark Mode Focus**: `outline: 3px solid #ffea00 !important; outline-offset: 2px; box-shadow: 0 0 0 4px #000000, 0 0 0 6px #ffffff !important;`

This dual-layer outline ensures clear visibility against both dark and light surrounding surfaces, satisfying WCAG 2.1 Success Criterion 2.4.7 (Focus Visible) and 1.4.11 (Non-text Contrast).

---

### 2.4 Code Example: Styling an Accessible Card Component with Contrast Tokens

Below is an example of an accessible workspace card component implemented in React and Tailwind CSS that utilizes `--contrast-*` tokens. It functions seamlessly in standard light/dark modes and automatically adapts when `HighContrastToggle` is engaged:

```tsx
import React from "react";
import { Wifi, MapPin, ArrowRight } from "lucide-react";

interface VenueCardProps {
  name: string;
  location: string;
  wifiSpeed: string;
  availableSeats: number;
  onBook: () => void;
}

export function AccessibleVenueCard({
  name,
  location,
  wifiSpeed,
  availableSeats,
  onBook,
}: VenueCardProps) {
  return (
    <div
      className="p-5 rounded-2xl transition-all shadow-md"
      style={{
        backgroundColor: "var(--contrast-card-bg)",
        borderColor: "var(--contrast-border)",
        borderWidth: "2px",
        borderStyle: "solid",
        color: "var(--contrast-text)",
      }}
    >
      {/* Card Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3
            className="text-lg font-bold tracking-tight"
            style={{ color: "var(--contrast-text)" }}
          >
            {name}
          </h3>
          <p
            className="flex items-center gap-1.5 text-sm mt-0.5"
            style={{ color: "var(--contrast-text-muted)" }}
          >
            <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{location}</span>
          </p>
        </div>

        {/* Availability Badge */}
        <span
          className="px-2.5 py-1 rounded-full text-xs font-semibold"
          style={{
            borderColor: "var(--contrast-border)",
            borderWidth: "1.5px",
            borderStyle: "solid",
            color: "var(--contrast-text)",
            backgroundColor: "var(--contrast-bg)",
          }}
        >
          {availableSeats} seats left
        </span>
      </div>

      {/* Metrics Row */}
      <div
        className="flex items-center gap-4 py-3 my-3 border-t border-b"
        style={{ borderColor: "var(--contrast-border)" }}
      >
        <div className="flex items-center gap-2 text-sm">
          <Wifi className="w-4 h-4" aria-hidden="true" />
          <span style={{ color: "var(--contrast-text)" }}>
            <strong>{wifiSpeed}</strong> Mbps
          </span>
        </div>
      </div>

      {/* Interactive Action Button */}
      <button
        type="button"
        onClick={onBook}
        className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl font-semibold text-sm transition-all cursor-pointer focus-visible:outline-none"
        style={{
          backgroundColor: "var(--contrast-btn-bg)",
          color: "var(--contrast-btn-text)",
          borderColor: "var(--contrast-border)",
          borderWidth: "2px",
          borderStyle: "solid",
          outline: "var(--contrast-outline)",
          outlineOffset: "var(--contrast-focus-offset, 2px)",
        }}
      >
        <span>Reserve Workspace</span>
        <ArrowRight className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
}
```

#### Vanilla CSS Equivalent

For components styled without Tailwind:

```css
.accessible-card {
  background-color: var(--contrast-card-bg);
  border: 2px solid var(--contrast-border);
  color: var(--contrast-text);
  border-radius: 1rem;
  padding: 1.25rem;
}

.accessible-card-title {
  color: var(--contrast-text);
  font-size: 1.125rem;
  font-weight: 700;
}

.accessible-card-subtitle {
  color: var(--contrast-text-muted);
  font-size: 0.875rem;
}

.accessible-card-button {
  background-color: var(--contrast-btn-bg);
  color: var(--contrast-btn-text);
  border: 2px solid var(--contrast-border);
  border-radius: 0.75rem;
  padding: 0.625rem 1rem;
  font-weight: 600;
}

.accessible-card-button:focus-visible {
  outline: var(--contrast-outline);
  outline-offset: 2px;
}
```

---

## 3. Glassmorphism Template

The project includes a reusable `.glass-card` utility for creating elevated, glass-style UI components.

### `.glass-card`

```css
.glass-card {
  @apply bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl;
}
```

### Common Usage

- Dashboard cards
- Modal dialogs
- Floating panels
- Content containers

---

## 4. Shadow Guidelines

The design system uses both Tailwind shadow utilities and custom glow effects.

| Style       | Common Usage                                         |
| ----------- | ---------------------------------------------------- |
| `shadow-xl` | Elevated cards and panels                            |
| `glow-blue` | Blue glow effect for highlighted UI elements         |
| `pulseGlow` | Animated glow used to emphasize interactive elements |

---

## 5. Color Palette

In addition to the global theme tokens, the project uses semantic accent colors throughout the interface.

| Color  | Common Usage                     |
| ------ | -------------------------------- |
| Blue   | Primary actions and glow effects |
| Purple | Accent backgrounds               |
| Cyan   | Informational highlights         |
| Orange | Warning states                   |
| Red    | Error and destructive states     |
| Violet | Decorative accent elements       |

---

## 6. Typography Guidelines

The project commonly uses the following typography utilities.

| Utility     | Common Usage                               |
| ----------- | ------------------------------------------ |
| `text-sm`   | Labels, helper text, and secondary content |
| `text-base` | Default body text                          |
| `text-lg`   | Section headings and emphasized content    |

---

## 7. Spacing Guidelines

The project follows Tailwind's spacing scale for consistent layouts.

### Common Padding Utilities

- `px-4`
- `px-6`
- `py-2`
- `py-4`

### Common Gap Utilities

- `gap-2`
- `gap-4`

### Common Vertical Spacing

- `space-y-4`
- `space-y-6`

These spacing utilities are used throughout the project to maintain consistent layouts.

---

## 8. Backdrop Guidelines

The project uses Tailwind backdrop blur utilities to create translucent, glass-style interfaces.

| Utility            | Common Usage                                |
| ------------------ | ------------------------------------------- |
| `backdrop-blur-sm` | Subtle overlays and lightweight UI elements |
| `backdrop-blur-md` | Cards and floating panels                   |
| `backdrop-blur-xl` | Full-screen modals and dialogs              |

Backdrop blur utilities are commonly combined with semi-transparent backgrounds, borders, and shadows to achieve the project's glassmorphism design.

---

## 9. Hal Jordan Lantern Emerald Design Tokens (`--construct-*` & `--glow-lantern`)

The **Lantern Emerald** design system introduces high-energy willpower constructs and aerospace cockpit HUD aesthetics. It provides custom CSS properties, Tailwind utilities, and glowing box-shadow classes designed for hard-light holographic interfaces.

### 9.1 Lantern Emerald Token Registry

| CSS Custom Property | HEX / RGBA Value | Tailwind Utility Class | Semantic Purpose |
| :--- | :--- | :--- | :--- |
| `--construct-emerald` | `#10b981` | `text-emerald-500` / `bg-emerald-500` | Primary construct line work, active toggles, and glyphs |
| `--construct-mint` | `#34d399` | `text-emerald-400` / `bg-emerald-400` | High-visibility reticles, cardinal pips, and HUD boresights |
| `--construct-surface` | `rgba(4, 16, 12, 0.85)` | `bg-[#04100c]/85` | Deep cosmic obsidian backdrop fill |
| `--construct-border` | `rgba(16, 185, 129, 0.25)`| `border-emerald-500/25` | Hairline translucent hard-light construct borders |
| `--glow-lantern` | `0 0 16px rgba(16, 185, 129, 0.45)` | `.construct-glow` | Standard willpower construct ambient bloom |
| `--glow-lantern-intense` | `0 0 24px rgba(52, 211, 153, 0.7)` | `.construct-glow-intense` | Lock-on reticles, alert strobes, and energy surges |
| `--hud-font-display` | `'Orbitron', sans-serif` | `.font-hud-display` | Aerospace telemetry headers and callout badges |
| `--hud-font-mono` | `'JetBrains Mono', monospace` | `.font-hud-mono` | Fixed-width coordinate streams and numeric readouts |

### 9.2 CSS Class Declarations (`src/app/globals.css`)

```css
:root {
  --construct-emerald: #10b981;
  --construct-mint: #34d399;
  --construct-surface: rgba(4, 16, 12, 0.85);
  --construct-border: rgba(16, 185, 129, 0.25);
  --glow-lantern: 0 0 16px rgba(16, 185, 129, 0.45);
  --glow-lantern-intense: 0 0 24px rgba(52, 211, 153, 0.7);
}

.construct-glow {
  box-shadow: var(--glow-lantern);
}

.construct-glow-intense {
  box-shadow: var(--glow-lantern-intense);
}

.construct-glow-text {
  text-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}
```

### 9.3 Code Example: Hard-Light Construct Card Component

```tsx
import React from "react";

export function HardLightConstructCard({
  title = "SECTOR 2814 // COWORKING CONSTRUCT",
  status = "ENERGY OPTIMAL",
  powerPercent = 100,
}: {
  title?: string;
  status?: string;
  powerPercent?: number;
}) {
  return (
    <div className="relative p-6 rounded-2xl bg-[#04100c]/85 backdrop-blur-md backdrop-saturate-[1.8] border border-emerald-500/25 construct-glow overflow-hidden transition-all duration-200 hover:border-emerald-500/40">
      {/* Top Edge High-Energy Light Guide */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-emerald-400 to-transparent" />

      {/* 45-Degree Tactical Corner Brackets */}
      <div className="absolute top-2 left-2 w-2 h-2 border-t-2 border-l-2 border-emerald-400" />
      <div className="absolute top-2 right-2 w-2 h-2 border-t-2 border-r-2 border-emerald-400" />
      <div className="absolute bottom-2 left-2 w-2 h-2 border-b-2 border-l-2 border-emerald-400" />
      <div className="absolute bottom-2 right-2 w-2 h-2 border-b-2 border-r-2 border-emerald-400" />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-mono text-sm font-bold tracking-wider text-emerald-100 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
          {title}
        </h3>
        <span className="font-mono text-[10px] uppercase px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          {status}
        </span>
      </div>

      {/* Power Telemetry Bar */}
      <div className="space-y-1 mb-4">
        <div className="flex justify-between text-xs font-mono text-zinc-400">
          <span>RING CHARGE</span>
          <span className="text-emerald-400 font-bold">{powerPercent}%</span>
        </div>
        <div className="h-1.5 w-full bg-emerald-950/40 rounded-full overflow-hidden border border-emerald-500/20">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full shadow-[0_0_8px_#10b981]"
            style={{ width: `${powerPercent}%` }}
          />
        </div>
      </div>

      {/* Construct Interaction Button */}
      <button
        type="button"
        className="w-full py-2.5 px-4 rounded-xl font-mono text-xs font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 border border-emerald-400/30 shadow-lg shadow-emerald-950/50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      >
        ENGAGE CONSTRUCT
      </button>
    </div>
  );
}
```

