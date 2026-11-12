# WorkSphere Design Tokens & Color Contrast Matrix

This specification documents the complete design token architecture, semantic custom properties, spacing, border radius, typography scales, and WCAG 2.1 compliance contrast matrix for WorkSphere.

---

## 1. Architectural Overview & Tailwind CSS v4 Engine

WorkSphere utilizes a modern **CSS-first design system** driven by **Tailwind CSS v4** and CSS Custom Properties (`src/app/globals.css`). 

Instead of maintaining a redundant JavaScript configuration file (`tailwind.config.js`), design tokens are declared directly in CSS using the `@theme inline` directive and custom pseudo-classes (`:root`, `.dark`, `.cyberpunk`, `html.high-contrast`).

```
                    ┌───────────────────────────────┐
                    │       src/app/globals.css     │
                    └───────────────┬───────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  :root (Light)   │       │   .dark (Dark)   │       │   .cyberpunk     │
│  --background    │       │  --background    │       │  --background    │
│  --foreground    │       │  --foreground    │       │  --foreground    │
│  --contrast-*    │       │  --contrast-*    │       │  --primary-*     │
└────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    │
                                    ▼
                         ┌────────────────────┐
                         │   @theme inline    │
                         │ Tailwind Utilities │
                         └────────────────────┘
```

---

## 2. Core Color Tokens

### 2.1 Viewport & Surface Tokens

| Token Variable | Light Mode Value | Dark Mode Value | Cyberpunk Value | Semantic Purpose |
| :--- | :--- | :--- | :--- | :--- |
| `--background` | `#ffffff` | `#0a0a0a` | `#090014` | Primary page canvas and viewport backdrop |
| `--foreground` | `#171717` (`zinc-900`) | `#ededed` (`zinc-100`) | `#f4f4ff` | Primary text, titles, headings, and icon glyphs |
| `--card` / `--surface` | `#ffffff` (`zinc-50`) | `#18181b` (`zinc-900`) | `#150028` | Elevated card containers, panels, modals, popovers |
| `--border` | `#e4e4e7` (`zinc-200`) | `#27272a` (`zinc-800`) | `#380062` | Structural partition lines, card outlines, separators |
| `--muted` | `#f4f4f5` (`zinc-100`) | `#27272a` (`zinc-800`) | `#260042` | Subdued surface backgrounds and chip backdrops |
| `--muted-foreground` | `#71717a` (`zinc-500`) | `#a1a1aa` (`zinc-400`) | `#b8b4dc` | Captions, timestamps, disabled indicators, helper notes |
| `--primary-accent` | `#3b82f6` (`blue-500`) | `#60a5fa` (`blue-400`) | `#22d3ee` (`cyan-400`)| Call-to-action buttons, active navigation, focus rings |
| `--accent-emerald` | `#10b981` (`emerald-500`)| `#34d399` (`emerald-400`)| `#00ff88` | Verification badges, check-in pings, Wi-Fi speeds |
| `--accent-rose` | `#ef4444` (`red-500`) | `#f87171` (`red-400`) | `#ff0055` | Critical alerts, tax residency warnings, errors |
| `--accent-amber` | `#f59e0b` (`amber-500`) | `#fbbf24` (`amber-400`) | `#ffb700` | Cautionary warnings, moderate noise, pending status |

---

## 3. WCAG 2.1 Color Contrast Matrix

The Web Content Accessibility Guidelines (WCAG) 2.1 mandate a minimum contrast ratio of **4.5:1** for normal text ($< 18\text{pt}$ / $24\text{px}$) and **3:1** for large text ($> 18\text{pt}$ or bold $> 14\text{pt}$) to achieve **Level AA**. To achieve **Level AAA**, normal text requires **7:1** and large text requires **4.5:1**.

### 3.1 Primary & Secondary Text on Viewport Backgrounds

| Foreground Token | Background Token | Context / Theme | Contrast Ratio | WCAG 2.1 AA ($\ge 4.5:1$) | WCAG 2.1 AAA ($\ge 7:1$) | Compliance Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `--foreground` (`#171717`) | `--background` (`#ffffff`) | Standard Light | **17.59 : 1** | Pass | Pass | **AAA Compliant** |
| `--foreground` (`#ededed`) | `--background` (`#0a0a0a`) | Standard Dark | **16.91 : 1** | Pass | Pass | **AAA Compliant** |
| `--foreground` (`#ededed`) | `--card` (`#18181b`) | Dark Mode Surface | **14.81 : 1** | Pass | Pass | **AAA Compliant** |
| `--foreground` (`#f4f4ff`) | `--background` (`#090014`) | Cyberpunk Canvas | **18.64 : 1** | Pass | Pass | **AAA Compliant** |
| `--contrast-text-muted` (`#71717a`)| `--background` (`#ffffff`) | Light Mode Secondary | **4.84 : 1** | Pass | Large Only | **AA Compliant** |
| `--contrast-text-muted` (`#a1a1aa`)| `--background` (`#0a0a0a`) | Dark Mode Secondary | **7.74 : 1** | Pass | Pass | **AAA Compliant** |
| `--contrast-text-muted` (`#a1a1aa`)| `--card` (`#18181b`) | Dark Surface Secondary| **6.78 : 1** | Pass | Pass ($\ge 4.5:1$) | **AA Compliant** |
| `--contrast-interactive-active` (`#2563eb`)| `--background` (`#ffffff`) | Light Mode Active Link| **5.24 : 1** | Pass | Large Only | **AA Compliant** |
| `--contrast-focus` (`#60a5fa`) | `--background` (`#0a0a0a`) | Dark Focus State | **8.83 : 1** | Pass | Pass | **AAA Compliant** |
| `--contrast-focus` (`#ffea00`)| `--contrast-bg` (`#000000`)| High-Contrast Dark | **16.82 : 1** | Pass | Pass | **AAA Compliant** |
| `--contrast-text` (`#000000`)| `--contrast-bg` (`#ffffff`)| High-Contrast Light | **21.00 : 1** | Pass | Pass | **Maximum Possible** |
| `--contrast-text` (`#ffffff`)| `--contrast-bg` (`#000000`)| High-Contrast Dark | **21.00 : 1** | Pass | Pass | **Maximum Possible** |

> [!IMPORTANT]
> All primary body text, titles, button labels, and navigation elements in WorkSphere exceed the **4.5:1** WCAG AA threshold. High-contrast tokens (`--contrast-*`) guarantee $\ge 7:1$ AAA compliance across all elements.

---

## 4. High-Contrast Accessibility System (`--contrast-*`)

When High-Contrast Mode is activated via `HighContrastToggle.tsx`, the root element mounts `html.high-contrast`. The following tokens override default values to ensure 100% legibility under low vision and direct sunlight environments:

| Token Name | Light Mode (`:root`) | Dark Mode (`.dark`) | High-Contrast Light | High-Contrast Dark | Function & Guarantee |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--contrast-bg` | `#ffffff` | `#0a0a0a` | `#ffffff` | `#000000` | Zero-blur solid viewport base |
| `--contrast-card-bg` | `#ffffff` | `#18181b` | `#ffffff` | `#000000` | Removes translucent blur gradients |
| `--contrast-border` | `#e4e4e7` | `#27272a` | `#000000` | `#ffffff` | 21:1 boundary delineation |
| `--contrast-text` | `#171717` | `#ededed` | `#000000` | `#ffffff` | Maximum readable text |
| `--contrast-text-muted`| `#71717a` | `#a1a1aa` | `#000000` | `#ffffff` | Eliminates low-contrast grays |
| `--contrast-focus` | `#3b82f6` | `#60a5fa` | `#000000` | `#ffea00` | Hyper-visible focus indicator |
| `--contrast-outline` | `2px solid #3b82f6`| `2px solid #60a5fa`| `3px solid #000000`| `3px solid #ffea00`| Visible keyboard focus box |
| `--contrast-btn-bg` | `#18181b` | `#ffffff` | `#000000` | `#ffffff` | Primary button background |
| `--contrast-btn-text` | `#ffffff` | `#18181b` | `#ffffff` | `#000000` | 21:1 button label readability |
| `--contrast-interactive-active`| `#2563eb` | `#3b82f6` | `#0047bb` | `#38bdf8` | High-chroma active state |

---

## 5. Spacing Scale Tokens

WorkSphere aligns to a strict **4px modular grid** (`0.25rem` step) matching Tailwind CSS v4 defaults:

| Token Class | REM Value | Pixel Value | Typical Application |
| :--- | :--- | :--- | :--- |
| `p-0.5` / `gap-0.5` | `0.125rem` | 2px | Hairline dividers, micro status indicator offsets |
| `p-1` / `gap-1` | `0.25rem` | 4px | Icon-to-label gaps, badge inner padding |
| `p-1.5` / `gap-1.5` | `0.375rem` | 6px | Dropdown menu container padding, tag chip gaps |
| `p-2` / `gap-2` | `0.5rem` | 8px | Button inline icon spacing, compact table cells |
| `p-2.5` / `gap-2.5` | `0.625rem` | 10px | Form field vertical padding, small card insets |
| `p-3` / `gap-3` | `0.75rem` | 12px | Dropdown items, mobile nav links, search bars |
| `p-4` / `gap-4` | `1.0rem` | 16px | Standard card padding, toolbar button spacing |
| `p-5` / `gap-5` | `1.25rem` | 20px | Workspace cards, modal dialog content margins |
| `p-6` / `gap-6` | `1.5rem` | 24px | Dashboard widget container padding, desktop panels |
| `p-8` / `gap-8` | `2.0rem` | 32px | Section vertical rhythm, marketing hero spacers |
| `p-12` / `gap-12` | `3.0rem` | 48px | Page header separators, empty state margins |
| `p-16` / `gap-16` | `4.0rem` | 64px | Landing page hero vertical padding |

---

## 6. Border Radius Geometry Hierarchy

Component corner curves follow a semantic hierarchy to establish physical depth:

| Token Class | REM Value | Pixel Value | Semantic Usage & Examples |
| :--- | :--- | :--- | :--- |
| `rounded-none` | `0px` | 0px | Full-bleed map tiles, sharp grid dividers |
| `rounded-xs` | `0.125rem` | 2px | Micro indicator tick marks, progress bars |
| `rounded-sm` | `0.25rem` | 4px | Code blocks, inline telemetry tags, checkboxes |
| `rounded` / `rounded-md` | `0.375rem` | 6px | Small pills, toast notifications, keyboard keycaps |
| `rounded-lg` | `0.5rem` | 8px | Text inputs, select triggers, secondary action buttons |
| `rounded-xl` | `0.75rem` | 12px | Filter dropdowns (`VenueFilterDropdown`), primary buttons |
| `rounded-2xl` | `1.0rem` | 16px | Workspace venue cards, modal dialogs, drawer panels |
| `rounded-3xl` | `1.5rem` | 24px | Mobile bottom sheet drawers, hero highlight cards |
| `rounded-full` | `9999px` | Circular | User avatars, status pips, `NomadPassportCoin` |

---

## 7. Typography Scale Tokens

### 7.1 Font Families

- **Sans Serif (`font-sans`)**: `var(--font-geist-sans), Arial, Helvetica, sans-serif`
- **Monospace (`font-mono`)**: `var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace`
- **Aerospace / HUD Display (`font-hud-display`)**: `'Orbitron', sans-serif`
- **Telemetry Readout (`font-hud-mono`)**: `'JetBrains Mono', monospace`

### 7.2 Type Scale & Hierarchy

| Token Class | Font Size | Line Height | Weight | Typical Application |
| :--- | :--- | :--- | :--- | :--- |
| `text-[10px]` | 10px / `0.625rem` | 14px / `0.875rem` | 500 / 600 | Telemetry badges, status indicators, micro labels |
| `text-xs` | 12px / `0.75rem` | 16px / `1.0rem` | 500 / 600 | Metadata, timestamps, amenity tags, table headers |
| `text-sm` | 14px / `0.875rem` | 20px / `1.25rem` | 400 / 500 | Form field inputs, helper text, secondary descriptions |
| `text-base` | 16px / `1.0rem` | 24px / `1.5rem` | 400 / 500 | Default body paragraphs, button labels, list items |
| `text-lg` | 18px / `1.125rem` | 28px / `1.75rem` | 600 / 700 | Venue card titles, accordion trigger labels |
| `text-xl` | 20px / `1.25rem` | 28px / `1.75rem` | 600 / 700 | Modal dialog headings, drawer headers |
| `text-2xl` | 24px / `1.5rem` | 32px / `2.0rem` | 700 / 800 | Page subheadings, dashboard widget titles |
| `text-3xl` | 30px / `1.875rem` | 36px / `2.25rem` | 700 / 800 | Section hero titles, major metric numbers |
| `text-4xl` | 36px / `2.25rem` | 40px / `2.5rem` | 800 / 900 | Landing page main title, primary display text |

---

## 8. Focus Rings & Interactive State Standards

To satisfy **WCAG 2.1 Success Criteria 2.4.7 (Focus Visible)** and **1.4.11 (Non-text Contrast)**:

1. **Standard Mode Focus**:
   ```css
   :focus-visible {
     outline: 2px solid var(--primary-accent, #3b82f6);
     outline-offset: 2px;
   }
   ```
2. **High-Contrast Focus Outlines**:
   - Light mode: `outline: 3px solid #000000; outline-offset: 2px;`
   - Dark mode: `outline: 3px solid #ffea00; outline-offset: 2px;`
3. **Interactive Transition Rules**:
   - State animations must respect `prefers-reduced-motion: reduce`:
     ```css
     @media (prefers-reduced-motion: reduce) {
       *, ::before, ::after {
         animation-duration: 0.01ms !important;
         transition-duration: 0.01ms !important;
       }
     }
     ```
