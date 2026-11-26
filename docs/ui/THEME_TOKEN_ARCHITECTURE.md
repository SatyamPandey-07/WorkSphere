# WorkSphere Theme Token & CSS Variable Architecture Guide

> **Developer Reference & Architecture Specification**  
> **Status:** Production Standard  
> **Target Framework:** Next.js (App Router), React 19, Tailwind CSS v4, Radix UI  
> **Target CSS Configuration:** `src/app/globals.css`  

---

## 1. Introduction

WorkSphere utilizes a modern **CSS-first design token architecture** powered by **Tailwind CSS v4**, native CSS Custom Properties, and stateful HTML attributes. The system delivers responsive, accessible, and high-performance theme transitions across multiple operating modes:

1. **Light Mode** — Crisp, high-clarity daylight theme optimized for readability on bright mobile and desktop displays.
2. **Dark Mode (`.dark`)** — Low-glare dark surface theme (`#0a0a0a`) designed for low-light work sessions.
3. **Cyberpunk Neon (`.cyberpunk`)** — High-energy synthwave visual aesthetic (`#090014`) featuring vibrant saturated neon accents, hard-light construct borders, and glassmorphic card pulses.
4. **High-Contrast Accessibility (`.high-contrast`)** — Rigorous high-visibility theme enforcing WCAG 2.1 AAA contrast targets (up to 21:1 pure black and white surfaces, solid 3px outline indicators, and suppressed translucent glow animations).

### Why Semantic Tokens Over Hardcoded Values?

Hardcoding color literals (e.g., `#ffffff`, `bg-zinc-900`, `text-[#3b82f6]`) creates acute maintenance friction:
- **Fragile Theming:** Components hardcoded with raw hex values cannot adapt when the user switches to Dark, Cyberpunk, or High-Contrast mode.
- **Accessibility Failures:** Fixed hex colors can violate WCAG 2.1 AA/AAA contrast thresholds when rendered on variable theme backgrounds.
- **Visual Inconsistency:** Individual developers picking slightly different gray tones (e.g., `#18181b` vs `#111827` vs `#0f172a`) fragments visual coherence.
- **Instant Global Refactoring:** Centralized semantic tokens allow project-wide palette or brand refreshes through a single declaration in `src/app/globals.css` or `src/lib/constants/theme.ts`.

---

## 2. Theme Architecture

The styling pipeline connects client-side state, DOM root classes, native CSS custom properties, Tailwind CSS v4 inline themes, and component JSX:

```
┌─────────────────────────────────────────────────────────────┐
│                       User Selection                        │
│   (ThemeSelector / ThemeToggle / localStorage / System)      │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 DOM Attribute & Class Injection              │
│  <html class="dark" data-theme="dark" data-high-contrast="…">│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             CSS Custom Properties (globals.css)             │
│  :root / .dark / .cyberpunk / html.high-contrast overrides  │
│  (--background, --foreground, --primary-accent, etc.)        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              Tailwind CSS v4 (@theme inline)                │
│  --color-background: var(--background)                      │
│  --color-primary: var(--primary-accent, #3b82f6)            │
│  --color-ring: var(--primary-accent, #3b82f6)               │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Component Rendering & Tailwind Classes           │
│  <div className="bg-background text-foreground accent-bg">   │
└─────────────────────────────────────────────────────────────┘
```

### Tailwind CSS v4 vs. Tailwind v3 Integration

Unlike legacy Tailwind CSS v3 projects:
- **No `tailwind.config.js` or `tailwind.config.ts`:** WorkSphere uses Tailwind v4's CSS-first architecture. All imports, custom variants, and theme tokens are defined directly in `src/app/globals.css` via `@import "tailwindcss";`.
- **`@theme inline` Directive:** Theme values are registered dynamically with the `@theme inline` block. When CSS custom properties change at runtime (e.g., dynamically switching `--background`), utility classes like `bg-background` and `text-foreground` re-evaluate instantly in the browser without JavaScript re-renders or style re-injections.
- **`@custom-variant`:** Custom responsive/thematic variants are declared at the top of `globals.css`:
  ```css
  @custom-variant dark (&:where(.dark, .dark *));
  @custom-variant cyberpunk (&:where(.cyberpunk, .cyberpunk *));
  ```
  This allows compound variants such as `cyberpunk:text-fuchsia-100` or `dark:hover:bg-zinc-800`.

### Theme Switching Mechanism

Themes are managed by `src/components/ThemeProvider.tsx` and initialized before paint by `src/lib/theme-init-script.ts`:
- **Storage Keys:**
  - `worksphere-theme`: stores `"light" | "dark" | "cyberpunk" | "system"`.
  - `worksphere-accent`: stores selected accent token (`"blue" | "purple" | "emerald" | "amber" | "lantern-emerald" | "indigo" | "rose" | "cyan" | "violet"`).
  - `worksphere_high_contrast`: stores `"true" | "false"`.
- **DOM Mutations:**
  - `document.documentElement.classList.add("dark" | "cyberpunk" | "high-contrast")`
  - `document.documentElement.setAttribute("data-theme", resolvedTheme)`
  - `document.documentElement.setAttribute("data-high-contrast", "true")`
  - Root inline styles: sets `--primary-accent`, `--primary-accent-rgb`, `--background`, and `--foreground` for fast paint synchronization.
- **FOUC Prevention & Animation Timing:**
  - The `theme-init-script.ts` executes synchronously in the HTML `<head>` before React hydration to eliminate Flash of Unstyled Content (FOUC).
  - Interactive switches add `theme-transitioning` to `<html>` for 240ms (suppressed if `prefers-reduced-motion` is active).

---

## 3. Complete CSS Variable Dictionary

All tokens declared in `src/app/globals.css` are documented below with their exact default values and semantic roles:

### Core Viewport & Base Variables

| Variable | Default Value (`:root`) | Purpose | Semantic Usage |
|---|---|---|---|
| `--background` | `#ffffff` | Primary canvas/viewport background color | `bg-background`, page wrapper backgrounds |
| `--foreground` | `#171717` | Primary content, body text, and primary headings | `text-foreground`, high-priority text |
| `--primary-accent` | `#3b82f6` | Dynamic brand primary accent color | `accent-bg`, active links, buttons, branding |
| `--primary-accent-rgb` | `59, 130, 246` | RGB channel triplet of primary accent | Transparency computations, RGB canvas math |
| `--accent-lantern` | `#00ff88` | High-visibility neon emerald indicator token | Radar HUD sweeps, lantern accent badges |

### High-Contrast & Semantic Surface Variables

| Variable | Default Value (`:root`) | Purpose | Semantic Usage |
|---|---|---|---|
| `--contrast-border` | `#e4e4e7` | Standard component border and divider line | Card borders, input outlines, table dividers |
| `--contrast-text` | `#171717` | High-clarity primary text | Headings, critical label indicators |
| `--contrast-text-muted`| `#71717a` | De-emphasized secondary text | Subtitles, timestamps, metadata captions |
| `--contrast-bg` | `#ffffff` | High-contrast structural surface background | Full-contrast canvas fills |
| `--contrast-card-bg` | `#ffffff` | Elevated card and container background | Modals, drawers, tooltips, cards |
| `--contrast-focus` | `#3b82f6` | High-visibility keyboard focus outline color | Accessible interactive element rings |
| `--contrast-outline` | `2px solid #3b82f6` | Explicit CSS outline definition for focus | Direct CSS outline declarations on focus |
| `--contrast-btn-bg` | `#18181b` | Primary solid high-contrast button fill | High-contrast action trigger backgrounds |
| `--contrast-btn-text` | `#ffffff` | Primary high-contrast button label text | Text inside high-contrast solid buttons |
| `--contrast-interactive-active` | `#2563eb` | Active, pressed, or selected link/button state | Active navigation items, selected toggles |

### Tailwind `@theme inline` Mappings

| Tailwind Theme Property | Source Custom Property | Generated Utility Classes |
|---|---|---|
| `--color-background` | `var(--background)` | `bg-background`, `text-background` |
| `--color-foreground` | `var(--foreground)` | `text-foreground`, `border-foreground` |
| `--color-primary` | `var(--primary-accent, #3b82f6)` | `bg-primary`, `text-primary`, `border-primary` |
| `--color-primary-accent` | `var(--primary-accent)` | `bg-primary-accent`, `text-primary-accent` |
| `--color-ring` | `var(--primary-accent, #3b82f6)` | `ring-ring`, `focus-visible:ring-ring` |
| `--font-sans` | `var(--font-geist-sans)` | `font-sans` |
| `--font-mono` | `var(--font-geist-mono)` | `font-mono` |

### Specialized Utility Variables

| Variable | Fallback / Context | Purpose | Semantic Usage |
|---|---|---|---|
| `--energy-glow` | `8px` | Audio slider thumb glow radius | Equalizer energy controls (`.audio-eq-energy-slider`) |
| `--theme-reveal-x` | `50%` | Horizontal origin for View Transitions circle | Radial theme reveal animation (`theme-reveal`) |
| `--theme-reveal-y` | `50%` | Vertical origin for View Transitions circle | Radial theme reveal animation (`theme-reveal`) |

---

## 4. Semantic Token Categories

Developers should organize UI styling around semantic roles rather than static palette colors.

### A. Background & Surfaces
- **Viewport Canvas:** `bg-background` (resolves to `#ffffff` light, `#0a0a0a` dark, `#090014` cyberpunk, `#000000` high-contrast dark).
- **Elevated Cards:** Use `glass-card` or `bg-white dark:bg-zinc-900 cyberpunk:bg-[#150028]` for elevated surfaces, modals, and dropdowns.
- **Subtle Containers:** `bg-zinc-50 dark:bg-zinc-800/50` for secondary wells and table header strips.

### B. Text & Typography
- **Primary Text:** `text-foreground` or `text-zinc-900 dark:text-zinc-100 cyberpunk:text-fuchsia-100`.
- **Secondary / Subdued Text:** `text-zinc-500 dark:text-zinc-400 cyberpunk:text-fuchsia-200` (in high-contrast mode, automatically forced to `#000000` or `#ffffff` for AAA compliance).
- **Accent Text:** `accent-text` (resolves to `var(--primary-accent)`).

### C. Borders & Separators
- **Standard Structural Borders:** `border border-zinc-200 dark:border-zinc-800 cyberpunk:border-fuchsia-900/40`.
- **Accent Borders:** `accent-border` or `accent-border-30` (with 30% alpha via `color-mix`).
- **Hard-Light Construct Borders:** `.hard-light-construct`, `.border-glow-construct`, `.border-glow-construct-cyan`, `.border-glow-construct-emerald`, `.border-glow-construct-amber`.

### D. Accent & Interaction
- **Primary Action Buttons:** `accent-bg accent-bg-hover text-white rounded-lg transition-colors`.
- **Hover Transitions:** `hover:backdrop-blur-md`, `accent-bg-hover`.
- **Active State:** `active:scale-95 transition-transform`.

### E. Focus Indicators & Accessibility Rings
- **Global Focus Treatment:** `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary`.
- **Dark Offset:** `dark:focus-visible:ring-offset-slate-900`.
- **High-Contrast Enforcement:** In `html.high-contrast`, all interactive elements automatically receive `outline: 3px solid` and a dual-ring box shadow (`#ffd600` / `#000000`).

---

## 5. Theme-Specific Behavior & Matrix

The following table compares exact token values across all four theme variations:

| Token | Light Mode (`:root`) | Dark Mode (`.dark`) | Cyberpunk (`.cyberpunk`) | High-Contrast Light (`html.high-contrast`) | High-Contrast Dark (`html.high-contrast.dark`) |
|---|---|---|---|---|---|
| `--background` | `#ffffff` | `#0a0a0a` | `#090014` | `#ffffff` | `#000000` |
| `--foreground` | `#171717` | `#ededed` | `#f4f4ff` | `#000000` | `#ffffff` |
| `--contrast-border` | `#e4e4e7` | `#27272a` | `#380062`* | `#000000` | `#ffffff` |
| `--contrast-card-bg` | `#ffffff` | `#18181b` | `#150028`* | `#ffffff` | `#000000` |
| `--contrast-text-muted` | `#71717a` | `#a1a1aa` | `#b8b4dc`* | `#000000` | `#ffffff` |
| `--contrast-focus` | `#3b82f6` | `#60a5fa` | `#22d3ee`* | `#000000` | `#ffea00` |
| `--contrast-outline` | `2px solid #3b82f6` | `2px solid #60a5fa` | `2px solid #22d3ee`* | `3px solid #000000` | `3px solid #ffea00` |
| `--contrast-btn-bg` | `#18181b` | `#ffffff` | `#f4f4ff` | `#000000` | `#ffffff` |
| `--contrast-btn-text` | `#ffffff` | `#18181b` | `#090014` | `#ffffff` | `#000000` |
| `--contrast-interactive-active` | `#2563eb` | `#3b82f6` | `#38bdf8` | `#0047bb` | `#38bdf8` |
| `--primary-accent` (Default) | `#3b82f6` | `#3b82f6` | `#3b82f6` (or user accent) | `#0047bb` | `#38bdf8` |
| `color-scheme` | `light` | `dark` | `dark` | `light` | `dark` |

*\*Note: Cyberpunk uses theme-scoped utility overrides (`cyberpunk:border-fuchsia-...`, `cyberpunk:bg-...`) and specialized construct glows in addition to root variable fallbacks.*

---

## 6. Glassmorphism Guidelines

WorkSphere incorporates sleek glassmorphic surfaces to maintain visual depth and ambient environmental illumination.

### Approved Glassmorphism Utility Patterns

1. **Standard Glass Card (`.glass-card`):**
   ```css
   .glass-card {
     @apply bg-white border border-zinc-200 shadow-xl;
     @apply bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl;
   }
   ```
2. **Venue Action Glass Buttons (`.venue-action-glass-btn`):**
   ```tsx
   <button
     type="button"
     className="venue-action-glass-btn p-2 rounded-lg bg-zinc-100/80 dark:bg-zinc-800/80 hover:backdrop-blur-md border border-zinc-200/50 dark:border-zinc-700/50 transition-all"
   >
     <Bookmark className="w-4 h-4 text-foreground" />
   </button>
   ```
   - On hover, `.dark` triggers `neon-glass-pulse-dark` (indigo/white highlight glow).
   - On hover, `.cyberpunk` triggers `neon-glass-pulse-cyberpunk` (cyan/magenta neon glow).
3. **Hard-Light Construct Borders (`.hard-light-construct`):**
   Combines `border` with multi-layered `box-shadow` utilizing `color-mix(in srgb, var(--primary-accent) X%, transparent)` for a futuristic holographic boundary.

### When to Avoid Glassmorphism

- **Dense Data Tables & Code Editors:** Translucent backgrounds degrade character glyph legibility and increase cognitive load.
- **High-Contrast Mode (`html.high-contrast`):** All glass glows, pulse animations, and box shadows are **strictly suppressed** (`box-shadow: none !important; animation: none !important; border-width: 2px !important;`).
- **Low-End or Low-Battery Devices:** Heavy `backdrop-filter: blur(...)` combined with infinite keyframe box-shadow animations can cause GPU rasterization bottlenecks.

---

## 7. Accessibility & WCAG 2.1 AA/AAA Standards

### Contrast Thresholds

| UI Element Type | WCAG 2.1 AA Minimum | WCAG 2.1 AAA Target | WorkSphere Implementation |
|---|---|---|---|
| Regular Body Text (< 18pt or < 14pt bold) | `4.5 : 1` | `7.0 : 1` | Default Light: `17.59:1`<br>Default Dark: `16.91:1`<br>High-Contrast: `21.0:1` |
| Large Text (≥ 18pt or ≥ 14pt bold) | `3.0 : 1` | `4.5 : 1` | Verified ≥ `14.0:1` across all headers |
| UI Components & Graphical Boundaries | `3.0 : 1` | N/A | Borders enforce `3.0:1` against active canvas |
| Interactive Focus Indicators | `3.0 : 1` | `4.5 : 1` | High-contrast outline: `3px solid #ffea00` / `#000000` |

### Non-Color Status Communication

Never rely on color alone to convey application status. Always pair status badges with text labels, icons, or ARIA attributes:

```tsx
// ❌ Bad: Color alone communicates state
<span className="w-3 h-3 rounded-full bg-red-500" />

// ✅ Good: Color, icon, and accessible screen-reader text
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200 border border-red-200 dark:border-red-800">
  <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
  <span>Unavailable</span>
</span>
```

### Contrast Testing Tools & Verification

- Chrome / Edge DevTools Lighthouse & Accessibility Pane.
- WebAIM Color Contrast Checker.
- Axe-core Automated Testing (`@axe-core/playwright` in E2E tests).

---

## 8. Tailwind CSS v4 Best Practices

### Recommended Class Composition

Combine semantic viewport utilities, standard layout tokens, and dynamic accent helpers:

```tsx
import { cn } from "@/lib/utils";

interface ContentCardProps {
  title: string;
  description: string;
  isActive?: boolean;
  className?: string;
}

export function ContentCard({
  title,
  description,
  isActive = false,
  className,
}: ContentCardProps) {
  return (
    <article
      className={cn(
        "rounded-xl border border-zinc-200 dark:border-zinc-800 cyberpunk:border-fuchsia-900/50",
        "bg-white dark:bg-zinc-900 cyberpunk:bg-[#150028]",
        "p-6 shadow-sm transition-all",
        isActive && "accent-border shadow-md",
        className
      )}
    >
      <h3 className="text-lg font-semibold text-foreground tracking-tight">
        {title}
      </h3>
      <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400 cyberpunk:text-fuchsia-200">
        {description}
      </p>
      <button
        type="button"
        className="mt-4 inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-white accent-bg accent-bg-hover rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900"
      >
        View Workspace
      </button>
    </article>
  );
}
```

---

## 9. Component Migration Examples

### Example A: Hardcoded Viewport Background

**Before (Hardcoded Hex Literals):**
```tsx
<div className="min-h-screen bg-[#111827] text-[#f9fafb]">
  <p>Static dark container</p>
</div>
```

**After (Semantic Tokens):**
```tsx
<div className="min-h-screen bg-background text-foreground">
  <p>Theme-aware responsive container</p>
</div>
```

### Example B: Hardcoded Card & Border

**Before (Arbitrary Tailwind Gray Palette):**
```tsx
<div className="rounded-xl border border-[#374151] bg-[#1f2937] p-4 text-[#f3f4f6]">
  <span>Card details</span>
</div>
```

**After (Theme-Aware Surface & Semantic Border):**
```tsx
<div className="rounded-xl border border-zinc-200 dark:border-zinc-800 cyberpunk:border-fuchsia-900/40 bg-white dark:bg-zinc-900 cyberpunk:bg-[#150028] p-4 text-foreground">
  <span>Card details</span>
</div>
```

### Example C: Accessible Focus Ring

**Before (Hardcoded Outline):**
```tsx
<button className="px-4 py-2 bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400">
  Click Me
</button>
```

**After (Tokenized Focus Ring with Theme Offset):**
```tsx
<button className="px-4 py-2 text-white accent-bg accent-bg-hover rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">
  Click Me
</button>
```

### Example D: Semantic Status Badge

**Before (Low-Contrast Color Only):**
```tsx
<span className="px-2 py-1 bg-green-500 text-white text-xs">
  Open
</span>
```

**After (Semantic Badge with Border & Icon):**
```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
  <CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />
  <span>Open Now</span>
</span>
```

---

## 10. Anti-Patterns to Avoid

1. **Hardcoding Hex or RGB Colors in Components:** Avoid `text-[#1e293b]`, `bg-[#090014]`, or `border-[#e2e8f0]`. Use semantic tokens (`text-foreground`, `bg-background`, `border-border`, `accent-bg`).
2. **Duplicating Theme Logic with Javascript State:** Do not write `theme === "dark" ? "bg-black" : "bg-white"`. Rely on Tailwind class variants (`bg-white dark:bg-zinc-900 cyberpunk:bg-[#090014]`) or CSS variables (`bg-background`).
3. **Removing Focus Rings (`focus:outline-none` without `focus-visible:ring-...`):** Never hide focus outlines without providing a visible high-contrast replacement.
4. **Using Translucent Text on Translucent Surfaces:** Combining `text-white/60` with `backdrop-blur` on glass cards frequently drops contrast below WCAG 2.1 AA thresholds.
5. **Introducing Untracked CSS Variables:** Do not invent new root variables (e.g. `--my-custom-blue`) in one-off stylesheets. Update the design system tokens centrally.

---

## 11. Developer Contributor Checklist

Before submitting a Pull Request involving UI changes, verify:

- [ ] Replaced all hardcoded hex/RGB color strings with semantic Tailwind tokens or CSS variables.
- [ ] Tested the component across all four themes: Light, Dark, Cyberpunk Neon, and High-Contrast.
- [ ] Confirmed contrast ratio is $\ge 4.5:1$ for normal text and $\ge 3.0:1$ for UI boundaries.
- [ ] Verified visible keyboard focus rings using `Tab` navigation.
- [ ] Ensured glassmorphic surfaces and glow effects are readable and respect reduced motion (`prefers-reduced-motion`).
- [ ] Used `cn()` from `@/lib/utils` for clean class merging.
- [ ] Ran automated tests and verified `git diff --check`.

---

## 12. Related Resources

- [WorkSphere Design System Guide](../DESIGN_SYSTEM_GUIDE.md) — Comprehensive overview of design tokens, spacing, and typography scales.
- [Accessibility Guide](../ACCESSIBILITY_GUIDE.md) — Detailed WCAG 2.1 AA/AAA implementation guidelines and assistive tech testing.
- [Venue Action Glassmorphic Pulse Guide](GLASSMORPHIC_PULSE_GUIDE.md) — Specification for hover glow keyframes and reduced-motion handling.
- [Construct Glow Utilities Guide](CONSTRUCT_GLOW_UTILITIES.md) — Holographic border and hard-light construct reference.
- [Global Stylesheet Source (`src/app/globals.css`)](../../src/app/globals.css) — Source of truth for root variables and theme variants.
