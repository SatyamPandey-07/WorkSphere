# High-Contrast Mode CSS Variables and WCAG AAA Compliance

This document provides a comprehensive technical reference for WorkSphere's system-wide High-Contrast Mode, including custom CSS properties, DOM application rules, state synchronization, WCAG 2.1 AAA contrast benchmarks, automated testing procedures (using internal auditors, axe-core, and Lighthouse), and guidelines for component authors.

- **Component Source:** [`src/components/HighContrastToggle.tsx`](../../src/components/HighContrastToggle.tsx)
- **Theme Provider:** [`src/components/ThemeProvider.tsx`](../../src/components/ThemeProvider.tsx)
- **CSS Rules and Token System:** [`src/app/globals.css`](../../src/app/globals.css)
- **Settings Page Integration:** [`src/app/settings/page.tsx`](../../src/app/settings/page.tsx)
- **Accessibility Tests:**
  - [`src/__tests__/components/HighContrastToggle.test.tsx`](../../src/__tests__/components/HighContrastToggle.test.tsx)
  - [`src/__tests__/accessibility/WCAGContrastAuditor.test.ts`](../../src/__tests__/accessibility/WCAGContrastAuditor.test.ts)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Complete CSS Custom Property Reference](#2-complete-css-custom-property-reference)
3. [Global High-Contrast CSS Overrides](#3-global-high-contrast-css-overrides)
4. [State Synchronization and Persistence](#4-state-synchronization-and-persistence)
5. [WCAG 2.1 AAA Contrast Requirements](#5-wcag-21-aaa-contrast-requirements)
6. [Running Automated Accessibility Tests](#6-running-automated-accessibility-tests)
7. [Guidelines for Component Authors](#7-guidelines-for-component-authors)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Overview

### 1.1 Purpose of High-Contrast Mode

WorkSphere's High-Contrast Mode provides an enhanced visual theme designed to meet and exceed the contrast recommendations defined in the **Web Content Accessibility Guidelines (WCAG) 2.1 Level AAA**. It targets users with low vision, photophobia, color-vision deficiencies, cataracts, or those operating devices under intense ambient lighting (e.g., outdoor sunlight).

When activated, the system:

- Eliminates low-contrast pastel backgrounds, subtle translucent glassmorphism effects, and decorative gradient fills.
- Replaces muted secondary text (such as gray-500/600/700 shades) with pure, high-contrast foreground values (#000000 in light mode, #ffffff in dark mode).
- Reinforces element borders to minimum 2px solid strokes.
- Implements thick multi-layer focus outlines with high-visibility safety-yellow focus indicators (#ffea00 / #ffd600).
- Normalizes interactive form controls, dialog overlays, backdrops, and keyboard hints (`<kbd>`).

### 1.2 User Activation and Controls

Users can enable and disable High-Contrast Mode through multiple mechanisms:

1. **Settings Page:** Navigating to `/settings#appearance` exposes the full card toggle rendered by [`HighContrastToggle`](../../src/components/HighContrastToggle.tsx).
2. **Site Footer:** Accessible globally across all public routes via the compact switch rendered by [`HighContrastSwitch`](../../src/components/HighContrastToggle.tsx) in [`site-footer.tsx`](../../src/components/site-footer.tsx).
3. **Keyboard Shortcut:** Interactive toggles expose `aria-keyshortcuts="Control+Shift+H Meta+Shift+H"`.
4. **OS / Browser Preference Fallback:** If the user has not set an explicit override in local storage, the application automatically synchronizes with the system's `(forced-colors: active)` media query (Windows High Contrast Mode / Contrast Themes).

### 1.3 Scope of Impact Across the Application

High-Contrast Mode modifies the root element (`<html>`):

- Adds CSS class `html.high-contrast`
- Sets data attribute `html[data-high-contrast="true"]`

Because these selectors target the document root, the overrides cascade across all pages, layouts, modals, popovers, navigation bars, cards, map UI overlays, and data tables.

---

## 2. Complete CSS Custom Property Reference

WorkSphere defines its color and contrast token architecture in [`src/app/globals.css`](../../src/app/globals.css). The token system provides dedicated `--contrast-*` custom properties that adapt according to the active theme (`:root` light, `.dark`, and their respective `high-contrast` modes).

### 2.1 High-Contrast Custom Properties Reference

| CSS Variable Name               | Purpose / Semantic Role                               | Standard Light (`:root`) | Standard Dark (`.dark`) | High-Contrast Light (`html.high-contrast`) | High-Contrast Dark (`html.high-contrast.dark`) | Usage & Verified Application                                                          |
| :------------------------------ | :---------------------------------------------------- | :----------------------- | :---------------------- | :----------------------------------------- | :--------------------------------------------- | :------------------------------------------------------------------------------------ |
| `--background`                  | Root canvas and page background                       | `#ffffff`                | `#0a0a0a`               | `#ffffff`                                  | `#000000`                                      | Sets document canvas and page body background color                                   |
| `--foreground`                  | Default base body text and icon fill                  | `#171717`                | `#ededed`               | `#000000`                                  | `#ffffff`                                      | Base typography color; achieves maximum 21:1 contrast ratio against `--background`    |
| `--contrast-bg`                 | Surface background for controls, panels, and toolbars | `#ffffff`                | `#0a0a0a`               | `#ffffff`                                  | `#000000`                                      | Applied to high-contrast input backgrounds, control containers, and surface panels    |
| `--contrast-card-bg`            | Card, container, and dialog body background           | `#ffffff`                | `#18181b`               | `#ffffff`                                  | `#000000`                                      | Replaces subtle muted card fills with pure opaque backgrounds                         |
| `--contrast-border`             | Structural borders, card outlines, and dividers       | `#e4e4e7`                | `#27272a`               | `#000000`                                  | `#ffffff`                                      | Used on card boundaries, table grid lines, and interactive input borders              |
| `--contrast-text`               | Primary heading and high-emphasis body text           | `#171717`                | `#ededed`               | `#000000`                                  | `#ffffff`                                      | Primary text token for titles, dialog headers, and active labels                      |
| `--contrast-text-muted`         | Secondary text, captions, and metadata                | `#71717a`                | `#a1a1aa`               | `#000000`                                  | `#ffffff`                                      | Overrides low-contrast secondary text to guarantee minimum 7:1 AAA compliance         |
| `--contrast-focus`              | Keyboard focus ring accent color                      | `#3b82f6`                | `#60a5fa`               | `#000000`                                  | `#ffea00`                                      | Base color for focus rings on interactive elements                                    |
| `--contrast-outline`            | Focus ring outline declaration shorthand              | `2px solid #3b82f6`      | `2px solid #60a5fa`     | `3px solid #000000`                        | `3px solid #ffea00`                            | Used for distinct focus indicator outlines with increased stroke width                |
| `--contrast-btn-bg`             | Solid primary button background fill                  | `#18181b`                | `#ffffff`               | `#000000`                                  | `#ffffff`                                      | Primary button backgrounds in high-contrast mode                                      |
| `--contrast-btn-text`           | Solid primary button text/icon fill                   | `#ffffff`                | `#18181b`               | `#ffffff`                                  | `#000000`                                      | Inverted label text for primary buttons ensuring 21:1 contrast                        |
| `--contrast-interactive-active` | Active state indicator, selected tabs, toggle pills   | `#2563eb`                | `#3b82f6`               | `#0047bb`                                  | `#38bdf8`                                      | High-contrast saturated accent for selected states and active interactive components  |
| `--primary-accent`              | Primary brand accent color                            | `#3b82f6`                | `#3b82f6`               | `#0047bb`                                  | `#38bdf8`                                      | Saturated blue / cyan ensuring strict AAA compliance against light / dark backgrounds |
| `--primary-accent-rgb`          | Composable RGB channels for accent alpha styling      | `59, 130, 246`           | `59, 130, 246`          | `0, 71, 187`                               | `56, 189, 248`                                 | Composable RGB channels for high-contrast focus rings and SVG highlights              |

---

## 3. Global High-Contrast CSS Overrides

In addition to custom property definitions, [`src/app/globals.css`](../../src/app/globals.css) applies comprehensive forced CSS rule overrides under `html.high-contrast` and `html[data-high-contrast="true"]`.

### 3.1 Text Normalization for WCAG AAA 7:1

To eliminate low-contrast secondary text, CSS utility classes for muted text are forced to solid black or solid white using `!important`:

- **Light Mode (`html.high-contrast`):**
  Classes `.text-zinc-500`, `.text-zinc-600`, `.text-zinc-700`, `.text-zinc-800`, `.text-gray-500`, `.text-gray-600`, `.text-slate-500`, and `.text-muted-foreground` are forced to:
  ```css
  color: #000000 !important;
  ```
- **Dark Mode (`html.high-contrast.dark`):**
  Classes `.text-zinc-300`, `.text-zinc-400`, `.text-zinc-500`, `.text-gray-300`, `.text-gray-400`, `.text-slate-300`, and `.text-muted-foreground` are forced to:
  ```css
  color: #ffffff !important;
  ```

### 3.2 Border Reinforcement

All standard Tailwind border utilities (`.border`, `.border-t`, `.border-b`, `[class*="border-zinc-"]`, `[class*="border-gray-"]`) are reinforced to:

- Width: `2px !important`
- Style: `solid !important`
- Color: `#000000 !important` (Light) or `#ffffff !important` (Dark)

### 3.3 Gradient and Shadow Suppression

To avoid optical ambiguity and maintain crisp edge contrast:

- Gradient classes (`[class*="bg-gradient-"]`, `[class*="from-"]`, `[class*="via-"]`, `[class*="to-"]`) have `background-image: none !important`.
- Decorative construct glow styles (`.hard-light-construct`, `.border-glow-construct`, `.hard-light-pulse`) have `box-shadow: none !important; animation: none !important`.

### 3.4 Multi-Layer Keyboard Focus Rings

To satisfy **WCAG 2.1 Success Criterion 2.4.7 (Focus Visible)** and **2.4.11 (Focus Appearance)** at Level AAA, interactive elements (`button`, `a`, `input`, `select`, `textarea`, `[role="switch"]`, `[role="button"]`, `[tabindex]`) receive a multi-ring focus indicator:

- **Light Mode:**
  ```css
  outline: 3px solid #000000 !important;
  outline-offset: 2px !important;
  box-shadow:
    0 0 0 4px #ffd600,
    0 0 0 6px #000000 !important;
  ```
- **Dark Mode:**
  ```css
  outline: 3px solid #ffea00 !important;
  outline-offset: 2px !important;
  box-shadow:
    0 0 0 4px #000000,
    0 0 0 6px #ffffff !important;
  ```

This dual-contour focus ring (black + high-visibility yellow) ensures immediate visibility regardless of whether the element sits over light, dark, or image backgrounds.

### 3.5 Modal and Dialog High-Contrast Formatting

Dialogs and alert dialogs (`[role="dialog"]`, `[role="alertdialog"]`, `[aria-modal="true"]`) receive:

- Minimum `3px solid` outer border (`#000000` in light, `#ffffff` in dark).
- High-contrast modal backdrop: `background-color: rgba(0, 0, 0, 0.88) !important; backdrop-filter: none !important`.
- Form inputs inside dialogs are forced to solid 2px borders with pure white or pure dark background fills.
- Keyboard hints (`<kbd>`) are formatted with solid 2px borders, bold text, and inverted solid backgrounds.

---

## 4. State Synchronization and Persistence

State management for High-Contrast Mode is coordinated between [`src/components/HighContrastToggle.tsx`](../../src/components/HighContrastToggle.tsx) and [`src/components/ThemeProvider.tsx`](../../src/components/ThemeProvider.tsx).

```mermaid
sequenceDiagram
    autonumber
    participant User as User / OS
    participant Toggle as HighContrastToggle
    participant Storage as localStorage & Cookie
    participant DOM as document.documentElement
    participant Context as ThemeProvider Context
    participant Window as Window Storage & Custom Events

    Note over User,DOM: 1. Initialization on Mount
    Toggle->>Storage: window.localStorage.getItem("worksphere_high_contrast")
    alt Stored value exists ("true" / "false")
        Storage-->>Toggle: Explicit boolean value
    else No stored preference (null)
        Toggle->>User: window.matchMedia("(forced-colors: active)").matches
        User-->>Toggle: System high-contrast status
    end
    Toggle->>DOM: applyHighContrastDOM(enabled)
    Note over DOM: root.classList.add("high-contrast")<br/>root.setAttribute("data-high-contrast", "true")

    Note over User,Window: 2. User Toggles Switch
    User->>Toggle: Click toggle button (or Ctrl+Shift+H)
    Toggle->>Storage: setItem("worksphere_high_contrast", String(next))
    Toggle->>Storage: document.cookie = "worksphere_high_contrast=...; path=/; max-age=31536000"
    Toggle->>DOM: applyHighContrastDOM(next)
    Toggle->>Context: setHighContrast(next)
    Toggle->>Window: dispatchEvent("worksphere_high_contrast_change", next)
    Window->>Toggle: storage / custom event sync across tabs & components
```

### 4.1 Storage Keys and Cookies

- **Primary LocalStorage Key:** `worksphere_high_contrast` (defined by constant `HIGH_CONTRAST_STORAGE_KEY`).
- **Legacy Fallback Key:** `worksphere-high-contrast` (supported in `ThemeProvider` for backward compatibility).
- **Cookie Synchronization:** Written by `ThemeProvider` as `worksphere_high_contrast=${enabled}; path=/; max-age=31536000; SameSite=Lax` to allow server-side rendering (SSR) templates to apply initial HTML classes without client hydration flash.

### 4.2 Helper Functions in `HighContrastToggle.tsx`

1. **`getStoredHighContrast(): boolean`**
   - Returns `false` if `window` is undefined (SSR).
   - Reads `window.localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)`.
   - If a stored value exists, returns `stored === "true"`.
   - If unset, queries `window.matchMedia("(forced-colors: active)").matches` to honor Windows High Contrast Mode or OS preferences.
   - Catches and silences security or quota exceptions.

2. **`applyHighContrastDOM(enabled: boolean): void`**
   - Accesses `document.documentElement`.
   - When `enabled === true`:
     - `root.classList.add("high-contrast")`
     - `root.setAttribute("data-high-contrast", "true")`
   - When `enabled === false`:
     - `root.classList.remove("high-contrast")`
     - `root.removeAttribute("data-high-contrast")`

3. **`setStoredHighContrast(enabled: boolean): void`**
   - Writes the string `"true"` or `"false"` to `localStorage`.
   - Calls `applyHighContrastDOM(enabled)`.
   - Dispatches a custom window event:
     ```javascript
     window.dispatchEvent(
       new CustomEvent("worksphere_high_contrast_change", { detail: enabled }),
     );
     ```

### 4.3 Multi-Tab and Component Synchronization

To ensure immediate synchronization when multiple toggle components are mounted on the same page or when the preference changes in another browser tab:

- **Cross-Tab Synchronization:** A `window.addEventListener("storage", ...)` listener inspects `e.key === HIGH_CONTRAST_STORAGE_KEY` and updates local component state and the DOM.
- **In-Page Event Dispatch:** The custom event `worksphere_high_contrast_change` notifies any other mounted toggle buttons or listeners without requiring a storage event round-trip.
- **Dynamic Media Query Listener:** An active listener on `window.matchMedia("(forced-colors: active)")` detects OS-level theme changes in real time. If the user has not established an explicit override in `localStorage`, the application immediately follows the OS contrast mode.

### 4.4 Profile Synchronization Status and Limitations

> [!NOTE]
> **Implementation Note on User Profiles:**
> Currently, `HighContrastToggle` and `ThemeProvider` manage persistence locally using `localStorage` and browser cookies. Remote user profile synchronization (e.g., syncing accessibility preferences to a backend database or user account service) is not yet wired to this toggle. If local storage is cleared or the user signs in on an untrusted device without cookies, preferences revert to the system `forced-colors` detection.

---

## 5. WCAG 2.1 AAA Contrast Requirements

The Web Content Accessibility Guidelines (WCAG) 2.1 specify mathematical contrast ratios calculated using sRGB relative luminance ($L$):

$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

where $L_1$ is the relative luminance of the lighter color and $L_2$ is the relative luminance of the darker color (producing ratios between $1:1$ and $21:1$).

### 5.1 Success Criteria Comparison (AA vs. AAA)

| WCAG Criterion     | Category                                                 | Minimum Ratio (Level AA) |    Enhanced Ratio (Level AAA)     | WorkSphere High-Contrast Implementation                                                                                                             |
| :----------------- | :------------------------------------------------------- | :----------------------: | :-------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.4.3 / 1.4.6**  | Normal Text ($< 18\text{pt}$ or $< 14\text{pt}$ bold)    |        **4.5:1**         |              **7:1**              | Black text on white canvas ($21:1$) or white text on black ($21:1$). Primary accent `--primary-accent` (`#0047bb` on `#ffffff`) achieves $> 8.5:1$. |
| **1.4.3 / 1.4.6**  | Large Text ($\ge 18\text{pt}$ or $\ge 14\text{pt}$ bold) |         **3:1**          |             **4.5:1**             | Large text uses base foreground tokens yielding $21:1$.                                                                                             |
| **1.4.11**         | Non-text UI Components & Graphical Objects               |         **3:1**          |   **3:1** (AA) / **7:1** (Aim)    | Form borders, card boundaries, switches, and tabs use 2px solid strokes with contrast $\ge 21:1$.                                                   |
| **2.4.7 / 2.4.11** | Focus Appearance & Indicators                            |      Focus visible       | $\ge 3:1$ against adjacent colors | Multi-layer 3px outline + 4px yellow ring (`#ffea00` has $> 19:1$ contrast against black).                                                          |

### 5.2 Beyond Contrast Ratios: AAA Conformance Realities

> [!IMPORTANT]
> **Audit Passing vs. Full Conformance:**
> Satisfying a 7:1 color contrast ratio across all text and UI components is **necessary but not sufficient** for full WCAG 2.1 AAA conformance.
>
> Full Level AAA conformance also mandates non-color criteria that cannot be resolved solely through CSS tokens, including:
>
> - **Criterion 1.4.8 (Visual Presentation):** User-selectable line spacing ($\ge 1.5\times$), paragraph spacing ($\ge 2\times$), and text resizing up to 200% without horizontal scrolling.
> - **Criterion 2.2.3 / 2.2.4 (No Timing / Interruptions):** No automatic session timeouts or unrequested alert interruptions.
> - **Criterion 3.1.5 / 3.1.6 (Reading Level & Pronunciation):** Explanations for jargon, idioms, and acronyms.
> - **Criterion 2.5.5 (Target Size):** Minimum touch and click target sizes of $44 \times 44$ CSS pixels.

---

## 6. Running Automated Accessibility Tests

WorkSphere provides multiple tiers of accessibility testing: an internal mathematical contrast auditor, axe-core automated audits, and Lighthouse CLI checks.

### 6.1 Internal WCAG Contrast Auditor Suite

The repository contains a custom contrast auditing engine in [`src/core/accessibility/WCAGContrastAuditor.ts`](../../src/core/accessibility/WCAGContrastAuditor.ts) that tests color pairs against ITU-R BT.709 sRGB luminance and APCA formulas.

Run the unit test suite:

```bash
npx jest src/__tests__/accessibility/WCAGContrastAuditor.test.ts
```

Run component accessibility unit tests:

```bash
npx jest src/__tests__/components/HighContrastToggle.test.tsx
```

### 6.2 Running Automated Audits with `axe-core`

`axe-core` allows testing components in a rendered DOM environment (e.g. using Jest with React Testing Library or Playwright).

#### Testing High-Contrast Mode in Jest + Testing Library:

```tsx
import React from "react";
import { render } from "@testing-library/react";
import axe from "axe-core";
import {
  HighContrastToggle,
  applyHighContrastDOM,
} from "@/components/HighContrastToggle";

describe("High-Contrast Mode axe-core Accessibility Audit", () => {
  beforeEach(() => {
    // Enable high contrast mode on the test document root
    applyHighContrastDOM(true);
  });

  afterEach(() => {
    applyHighContrastDOM(false);
  });

  it("passes axe-core WCAG 2.1 AAA color contrast checks", async () => {
    const { container } = render(
      <main className="p-4">
        <HighContrastToggle variant="card" />
      </main>,
    );

    const results = await axe.run(container, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21aa", "wcag21aaa"],
      },
      rules: {
        "color-contrast": { enabled: true },
        "color-contrast-enhanced": { enabled: true }, // Checks 7:1 AAA ratio
      },
    });

    const violations = results.violations.filter(
      (v) => v.id === "color-contrast" || v.id === "color-contrast-enhanced",
    );

    expect(violations).toHaveLength(0);
  });
});
```

### 6.3 Running Audits with Google Lighthouse

Lighthouse audits live pages in Chromium against accessibility rules derived from Deque's axe engine.

#### Running Lighthouse CLI:

If `lighthouse` is installed globally or available via `npx`:

```bash
# Start the local development server (in a separate terminal)
npm run dev

# Run Lighthouse accessibility audit on the settings page
npx lighthouse http://localhost:3000/settings \
  --only-categories=accessibility \
  --chrome-flags="--headless" \
  --output=json \
  --output-path=./lighthouse-a11y-report.json
```

#### Inspecting Contrast Findings:

Inspect the JSON report or HTML summary for the following audit IDs:

- `color-contrast`: Checks whether background and foreground colors have a sufficient contrast ratio.
- `custom-controls-labels`: Ensures custom switch toggles have accessible names (`aria-label` or `<label>`).
- `focus-visible`: Checks if interactive elements have visible keyboard focus indicators.

### 6.4 Limitations of Automated Accessibility Scanners

Automated scanners (both axe-core and Lighthouse) are essential for CI/CD gating, but have defined blind spots:

1. **False Negatives on Layered Backgrounds:** Automated tools often fail to calculate contrast over CSS gradients, canvas elements, semi-transparent overlays, or image backgrounds (`color-contrast` marked as _Needs Review_).
2. **Dynamic States:** Scanners evaluate static DOM snapshots; they do not automatically trigger `:hover`, `:active`, `:focus-visible`, or transient tooltips unless explicitly scripted.
3. **Semantic Appropriateness:** Automated tools verify that an `aria-label` exists, but cannot evaluate whether the label accurately conveys the action to screen reader users.

---

## 7. Guidelines for Component Authors

When developing or updating UI components in WorkSphere, follow these principles to guarantee compatibility with High-Contrast Mode:

### 7.1 Never Hardcode Hex Colors for Text and Borders

Avoid inline or static hex values such as `#71717a` or `border-[#e4e4e7]`. Use semantic tokens or Tailwind utility classes that are mapped to high-contrast overrides:

```tsx
// Bad: Hardcoded gray will become unreadable or washed out in high-contrast dark mode
<p style={{ color: "#6b7280" }}>Secondary timestamp</p>

// Good: Uses semantic high-contrast token
<p className="text-[var(--contrast-text-muted)]">Secondary timestamp</p>

// Good: Standard Tailwind muted class overridden by globals.css
<p className="text-zinc-500 dark:text-zinc-400">Secondary timestamp</p>
```

### 7.2 Provide Visible Borders on Containers

Translucent glassmorphism cards (`bg-white/10 backdrop-blur`) vanish for users with low contrast sensitivity. Always pair translucent cards with a defined border:

```tsx
// Good: Border token automatically expands to 2px solid black/white in high contrast
<div className="rounded-xl bg-white dark:bg-zinc-900 border border-[var(--contrast-border)] p-4 shadow-sm">
  <h3 className="text-[var(--contrast-text)] font-semibold">Workspace Desk</h3>
</div>
```

### 7.3 Do Not Rely on Color Alone (WCAG 1.4.1)

Status badges, toggles, and alert dialogs must include text labels, shape differences, or icons in addition to color:

```tsx
// Bad: Uses only green vs. red dot to signify status
<span className="w-3 h-3 rounded-full bg-emerald-500" />

// Good: Includes descriptive text and icon for non-color identification
<span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border border-[var(--contrast-border)]">
  <Check className="w-3.5 h-3.5" aria-hidden="true" />
  <span>Active</span>
</span>
```

### 7.4 Preserve Keyboard Focus Visibility (WCAG 2.4.7)

Never use `outline-none` without immediately providing a replacement `:focus-visible` ring:

```tsx
// Good: Preserves keyboard focus indicator
<button
  type="button"
  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--contrast-focus)] focus-visible:ring-offset-2"
>
  Reserve Desk
</button>
```

---

## 8. Troubleshooting

| Symptom                                                | Probable Cause                                                                          | Diagnostic & Resolution Steps                                                                                                           |
| :----------------------------------------------------- | :-------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| **High-Contrast Mode does not activate**               | Root `<html>` element is missing `.high-contrast` class or `data-high-contrast="true"`. | Inspect DOM using browser DevTools. Verify that `applyHighContrastDOM(true)` was called. Check if JavaScript is disabled.               |
| **Preference resets on page reload**                   | `localStorage` access is blocked or cookie was not written.                             | Check browser settings for blocked third-party storage or incognito/private mode restrictions. Verify key `worksphere_high_contrast`.   |
| **Component ignores high-contrast colors**             | Component uses inline `style={{ ... }}` with hardcoded color values.                    | Inline style attributes take precedence over CSS classes unless overridden with `!important`. Replace inline styles with CSS variables. |
| **Glows or animations persist in high contrast**       | Custom animation class is missing from globals.css suppression list.                    | Add selector to `html.high-contrast .my-animation` with `animation: none !important; box-shadow: none !important;`.                     |
| **axe-core reports 4.5:1 violation on secondary text** | Class used is not listed in `globals.css` AAA override rule.                            | Check if an unusual utility class (e.g. `text-neutral-400` or custom HEX) was used instead of `text-zinc-500`/`--contrast-text-muted`.  |
| **Focus rings invisible on custom canvas/map**         | Canvas container traps focus without drawing native focus indicator.                    | Ensure the interactive canvas wrapper element has `tabIndex={0}` and applies the `:focus-visible` outline styles.                       |
