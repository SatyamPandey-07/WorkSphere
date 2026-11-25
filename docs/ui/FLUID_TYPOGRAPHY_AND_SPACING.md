# Fluid Typography and Spacing Guide

## Overview

WorkSphere styles its interface with Tailwind CSS v4 and CSS variable design tokens. This guide explains how those tokens are layered, the spacing scale and its 4px baseline grid, how to build fluid (viewport-responsive) font sizes with `clamp()`, and the colour contrast requirements that every text token must meet under WCAG 2.1 AA.

It is written for contributors adding or changing UI. Values come from `src/app/globals.css`, the Tailwind v4 default theme, and the ratios computed for this guide.

> **Status.** The spacing scale, the Tailwind type scale, and the colour tokens described below are in use today. **No fluid typography tokens are defined in `globals.css` yet.** The fluid sizes in this guide are the recommended set and ready-to-paste `@theme` definitions, so new fluid utilities are all built the same way.

For the colour and theme side of the system, see [Theme Token Architecture](./THEME_TOKEN_ARCHITECTURE.md) and [Design Tokens & Color Contrast Matrix](../design-system/DESIGN_TOKENS.md).

## Token hierarchy

Tokens are layered from raw values to the classes that components use. Each layer should only depend on the layer above it.

```text
1. Primitives          Tailwind default theme: --spacing (0.25rem), --text-* sizes, palette colours
        |
2. Semantic tokens     CSS variables in src/app/globals.css: --background, --foreground, --contrast-*, --primary-accent
        |              (values change per theme: :root, .dark, .cyberpunk, html.high-contrast)
        |
3. Theme mapping       @theme inline { --color-background: var(--background); --font-sans: ... }
        |
4. Utilities           bg-background, text-foreground, p-4, gap-6, text-lg, text-fluid-lg
        |
5. Components          Class names in JSX. No hard-coded hex or px values.
```

Rules that follow from the hierarchy:

- Components use utilities (layer 4), not raw variables or literal colours.
- A new colour, spacing or type value is added as a token first, then used through a utility.
- Theme switching changes layer 2 only. Components never branch on the theme for colour.

## Spacing

### Primitives: the 4px baseline grid

Tailwind v4 defines one spacing primitive, `--spacing: 0.25rem` (4px at the default 16px root font size). Every spacing utility is a multiple of it:

```text
space(n) = n × 0.25rem = n × 4px
```

So `p-4` is `calc(var(--spacing) * 4)` = `1rem` = 16px, and `gap-6` is 1.5rem = 24px. Half steps (`p-0.5`, `p-1.5`, `p-2.5`) are allowed for 2px nudges.

Sizes are in `rem`, so they scale with the user's browser font size setting. Do not replace spacing utilities with pixel values.

### Spacing reference

| Utility step | Value | rem | px | Typical use |
| ---: | --- | ---: | ---: | --- |
| `0.5` | `0.5 × 4px` | 0.125 | 2 | Hairline offsets |
| `1` | `1 × 4px` | 0.25 | 4 | Icon-to-label gap |
| `2` | `2 × 4px` | 0.5 | 8 | Compact inline spacing |
| `3` | `3 × 4px` | 0.75 | 12 | Dropdown items, search bars |
| `4` | `4 × 4px` | 1 | 16 | Standard card padding |
| `6` | `6 × 4px` | 1.5 | 24 | Dashboard widget padding |
| `8` | `8 × 4px` | 2 | 32 | Section vertical rhythm |
| `12` | `12 × 4px` | 3 | 48 | Page header separators |
| `16` | `16 × 4px` | 4 | 64 | Hero vertical padding |

The complete list, with component examples, is in [Design Tokens, section 5](../design-system/DESIGN_TOKENS.md#5-spacing-scale-tokens).

### Fluid spacing

Most spacing should stay fixed on the grid. Use fluid spacing only for large layout gaps that should grow with the viewport, such as the vertical padding of a page section. The formula is the same as for fluid type, see [Fluid font sizes](#fluid-font-sizes). A section gap that grows from 16px at 320px wide to 32px at 1440px wide is:

```css
padding-block: clamp(1rem, 0.7143rem + 1.4286vw, 2rem);
```

Keep the minimum and maximum on grid multiples (16px and 32px here) so the layout still lines up at both ends.

## Typography

### Font families

| Utility | Variable | Source |
| --- | --- | --- |
| `font-sans` | `--font-sans: var(--font-geist-sans)` | Geist, loaded with `next/font` in `src/app/layout.tsx`. |
| `font-mono` | `--font-mono: var(--font-geist-mono)` | Geist Mono, loaded the same way. |

### Static type scale

The Tailwind v4 default scale is used. Each `--text-*` variable has a matching `--text-*--line-height`:

| Utility | Font size | rem | Line height |
| --- | ---: | ---: | --- |
| `text-xs` | 12px | 0.75 | 16px (1.333) |
| `text-sm` | 14px | 0.875 | 20px (1.429) |
| `text-base` | 16px | 1 | 24px (1.5) |
| `text-lg` | 18px | 1.125 | 28px (1.556) |
| `text-xl` | 20px | 1.25 | 28px (1.4) |
| `text-2xl` | 24px | 1.5 | 32px (1.333) |
| `text-3xl` | 30px | 1.875 | 36px (1.2) |
| `text-4xl` | 36px | 2.25 | 40px (1.111) |

Use these for text that should not change with the viewport: form fields, table cells, buttons and badges. Use fluid sizes for headings and display text that sit in layouts that change a lot between a phone and an ultra-wide screen.

### Fluid font sizes

A fluid size uses the CSS `clamp(min, preferred, max)` function. The font size grows linearly with the viewport width between two widths and stays at `min` below and `max` above:

```text
slope       = (maxSize - minSize) / (maxViewport - minViewport)
intercept   = minSize - slope × minViewport
preferred   = intercept + slope × 100vw
font-size   = clamp(minSize, preferred, maxSize)
```

All sizes in the formula are in the same unit (px); convert the intercept to `rem` by dividing by 16, and write the slope as `vw` by multiplying by 100.

Worked example: a size that grows from 18px (1.125rem) at a 320px viewport to 24px (1.5rem) at 1440px:

```text
slope     = (24 - 18) / (1440 - 320)   = 0.005357
intercept = 18 - 0.005357 × 320        = 16.2857 px = 1.0179 rem
preferred = 1.0179rem + 0.5357vw
result    = clamp(1.125rem, 1.0179rem + 0.5357vw, 1.5rem)
```

#### Recommended fluid steps

These steps use a 320px to 1440px viewport range (20rem to 90rem). Each step has a minimum no smaller than its static counterpart.

| Utility (proposed) | `clamp()` value | Min | Max | At 320px | At 768px | At 1024px | At 1440px |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `text-fluid-sm` | `clamp(0.875rem, 0.8393rem + 0.1786vw, 1rem)` | 14px | 16px | 14.0 | 14.8 | 15.3 | 16.0 |
| `text-fluid-base` | `clamp(1rem, 0.9643rem + 0.1786vw, 1.125rem)` | 16px | 18px | 16.0 | 16.8 | 17.3 | 18.0 |
| `text-fluid-lg` | `clamp(1.125rem, 1.0179rem + 0.5357vw, 1.5rem)` | 18px | 24px | 18.0 | 20.4 | 21.8 | 24.0 |
| `text-fluid-xl` | `clamp(1.25rem, 1.0714rem + 0.8929vw, 1.875rem)` | 20px | 30px | 20.0 | 24.0 | 26.3 | 30.0 |
| `text-fluid-2xl` | `clamp(1.5rem, 1.2143rem + 1.4286vw, 2.5rem)` | 24px | 40px | 24.0 | 30.4 | 34.1 | 40.0 |
| `text-fluid-3xl` | `clamp(1.875rem, 1.4107rem + 2.3214vw, 3.5rem)` | 30px | 56px | 30.0 | 40.4 | 46.3 | 56.0 |
| `text-fluid-4xl` | `clamp(2.25rem, 1.6071rem + 3.2143vw, 4.5rem)` | 36px | 72px | 36.0 | 50.4 | 58.6 | 72.0 |

Columns from "At 320px" on are computed sizes in px.

#### Defining the tokens in Tailwind v4

Tailwind v4 turns any `--text-*` variable in `@theme` into a `text-*` utility, and the matching `--text-*--line-height` variable sets its line height. Add the fluid steps next to the existing `@theme inline` block in `src/app/globals.css`:

```css
@theme {
  --text-fluid-sm: clamp(0.875rem, 0.8393rem + 0.1786vw, 1rem);
  --text-fluid-sm--line-height: 1.5;

  --text-fluid-lg: clamp(1.125rem, 1.0179rem + 0.5357vw, 1.5rem);
  --text-fluid-lg--line-height: 1.4;

  --text-fluid-4xl: clamp(2.25rem, 1.6071rem + 3.2143vw, 4.5rem);
  --text-fluid-4xl--line-height: 1.1;
}
```

Use unitless line heights so the line box scales with the font size. The result is used as a normal class, for example `<h1 className="text-fluid-4xl font-bold">`.

#### Rules for fluid type

1. **Always include a `rem` term in the preferred value.** A size made only of `vw` ignores the user's browser font size and cannot be zoomed, which fails WCAG 1.4.4 (Resize Text).
2. **Keep `max / min` at or below 2.5.** Larger ratios can stop text from reaching 200% when the user zooms. Every step above is 2.0 or less.
3. **Set limits in `rem`, never `px`,** so the minimum and maximum respect the user's font size.
4. **Keep body text at 14px or more.** Fluid sizes are for headings, display text and large metrics. Body copy should use `text-base` or `text-fluid-base`.
5. **Check at 200% zoom and at 320px width** that nothing overflows or gets clipped.

## Colour contrast

WCAG 2.1 Level AA sets these minimum contrast ratios:

| Content | Minimum ratio | Criterion |
| --- | ---: | --- |
| Normal text (under 18pt, or under 14pt bold) | 4.5 : 1 | 1.4.3 |
| Large text (18pt / 24px or larger, or 14pt / about 18.7px bold or larger) | 3 : 1 | 1.4.3 |
| UI component boundaries, icons, focus indicators | 3 : 1 | 1.4.11 |

The ratio is `(L1 + 0.05) / (L2 + 0.05)`, where `L1` is the relative luminance of the lighter colour and `L2` of the darker, and `L = 0.2126 R + 0.7152 G + 0.0722 B` over linearised sRGB channels.

### Token contrast ratios

Computed from the values in `src/app/globals.css`:

| Foreground | Background | Theme | Ratio | Normal text (4.5) | Large text / UI (3) |
| --- | --- | --- | ---: | :---: | :---: |
| `--foreground` `#171717` | `--background` `#ffffff` | Light | 17.93 | Pass | Pass |
| `--foreground` `#ededed` | `--background` `#0a0a0a` | Dark | 16.91 | Pass | Pass |
| `--foreground` `#ededed` | `--contrast-card-bg` `#18181b` | Dark | 15.13 | Pass | Pass |
| `--foreground` `#f4f4ff` | `--background` `#090014` | Cyberpunk | 18.82 | Pass | Pass |
| `--contrast-text-muted` `#71717a` | `#ffffff` | Light | 4.83 | Pass | Pass |
| `--contrast-text-muted` `#a1a1aa` | `#0a0a0a` | Dark | 7.72 | Pass | Pass |
| `--contrast-text-muted` `#a1a1aa` | `#18181b` | Dark | 6.91 | Pass | Pass |
| `--contrast-interactive-active` `#2563eb` | `#ffffff` | Light | 5.17 | Pass | Pass |
| `--contrast-focus` `#60a5fa` | `#0a0a0a` | Dark | 7.79 | Pass | Pass |
| `--contrast-btn-text` `#ffffff` | `--contrast-btn-bg` `#18181b` | Light | 17.72 | Pass | Pass |
| `--contrast-btn-text` `#18181b` | `--contrast-btn-bg` `#ffffff` | Dark | 17.72 | Pass | Pass |
| `--primary-accent` `#3b82f6` | `#ffffff` | Light | 3.68 | **Fail** | Pass |
| `--contrast-border` `#e4e4e7` | `#ffffff` | Light | 1.27 | n/a | **Fail** |
| `--contrast-border` `#27272a` | `#0a0a0a` | Dark | 1.33 | n/a | **Fail** |
| `--contrast-focus` `#ffea00` | `#000000` | High-contrast dark | 17.02 | Pass | Pass |

Ratios are rounded to two decimals and can differ in the second decimal from older tables because of rounding, but the pass and fail results agree with [Design Tokens, section 3](../design-system/DESIGN_TOKENS.md#3-wcag-21-color-contrast-matrix).

### What this means for components

- **Do not use `--primary-accent` (`#3b82f6`) as small text on a light background.** At 3.68 : 1 it only qualifies as large text or a UI graphic. Use `--contrast-interactive-active` (`#2563eb`, 5.17 : 1) for link and label text.
- **`--contrast-border` is decorative.** At about 1.3 : 1 it does not identify a control on its own. A text input, checkbox or other control whose boundary is the only cue needs a border of at least 3 : 1, or another visible cue such as a fill or an icon.
- **Muted text is allowed for secondary copy,** because both muted tokens pass 4.5 : 1, but it must not be the only way to convey status. Pair colour with text or an icon.
- **Keyboard focus must be visible.** `--contrast-outline` (2px solid `--contrast-focus`) passes 3 : 1 in the light and dark themes.
- **High-contrast mode** (`html.high-contrast`) overrides the `--contrast-*` tokens with black and white, and a yellow `#ffea00` focus ring in dark mode. Do not hard-code colours that bypass those tokens, or the mode will not take effect on them.

## CSS variable reference

### Semantic colour variables (`src/app/globals.css`)

| Variable | `:root` (light) | `.dark` | Purpose |
| --- | --- | --- | --- |
| `--background` | `#ffffff` | `#0a0a0a` | Page background. `.cyberpunk` sets `#090014`. |
| `--foreground` | `#171717` | `#ededed` | Default text. `.cyberpunk` sets `#f4f4ff`. |
| `--contrast-bg` | `#ffffff` | `#0a0a0a` | Solid base for contrast-safe surfaces. |
| `--contrast-card-bg` | `#ffffff` | `#18181b` | Solid card surface. |
| `--contrast-border` | `#e4e4e7` | `#27272a` | Decorative dividers and card borders. |
| `--contrast-text` | `#171717` | `#ededed` | Primary readable text. |
| `--contrast-text-muted` | `#71717a` | `#a1a1aa` | Secondary text. |
| `--contrast-focus` | `#3b82f6` | `#60a5fa` | Focus ring colour. |
| `--contrast-outline` | `2px solid #3b82f6` | `2px solid #60a5fa` | Focus outline shorthand. |
| `--contrast-btn-bg` | `#18181b` | `#ffffff` | Primary button background. |
| `--contrast-btn-text` | `#ffffff` | `#18181b` | Primary button label. |
| `--contrast-interactive-active` | `#2563eb` | `#3b82f6` | Active links and controls. |
| `--primary-accent` | `#3b82f6` | `#3b82f6` | Brand accent. Used with `--primary-accent-rgb` (`59, 130, 246`) for tints. |
| `--accent-lantern` | `#00ff88` | `#00ff88` | Lantern accent used in glow effects. |

### Theme mappings (`@theme inline`)

| Utility token | Resolves to |
| --- | --- |
| `--color-background` | `var(--background)` |
| `--color-foreground` | `var(--foreground)` |
| `--color-primary` | `var(--primary-accent, #3b82f6)` |
| `--color-primary-accent` | `var(--primary-accent)` |
| `--color-ring` | `var(--primary-accent, #3b82f6)` |
| `--font-sans` | `var(--font-geist-sans)` |
| `--font-mono` | `var(--font-geist-mono)` |

### Tailwind v4 primitives used for layout

| Variable | Value | Generates |
| --- | --- | --- |
| `--spacing` | `0.25rem` | Every spacing utility: `p-*`, `m-*`, `gap-*`, `size-*`, `inset-*` |
| `--text-xs` to `--text-4xl` | `0.75rem` to `2.25rem` | `text-xs` to `text-4xl` |
| `--text-*--line-height` | see [Static type scale](#static-type-scale) | Line height paired with each size |
| `--leading-tight`, `-snug`, `-normal`, `-relaxed`, `-loose` | `1.25`, `1.375`, `1.5`, `1.625`, `2` | `leading-*` |

## Contributor checklist

- [ ] Spacing uses Tailwind utilities on the 4px grid, with no pixel literals.
- [ ] Headings and display text that must scale with the viewport use a `text-fluid-*` token, not an ad hoc `clamp()` in a class.
- [ ] Every fluid size includes a `rem` term, has a `max / min` ratio of 2.5 or less, and has been checked at 200% zoom.
- [ ] Text meets 4.5 : 1 (3 : 1 for large text) in the light, dark and high-contrast themes.
- [ ] Colours come from semantic tokens, not hex values.
- [ ] Status is never conveyed by colour alone.

## Related documents

- [Theme Token Architecture](./THEME_TOKEN_ARCHITECTURE.md): CSS variable dictionary, theme switching, and migration examples.
- [Design Tokens & Color Contrast Matrix](../design-system/DESIGN_TOKENS.md): the full spacing, radius and type tables and the contrast matrix.
- [Tailwind v4 Layouts](../TAILWIND_V4_LAYOUTS.md): layout patterns used with these tokens.
