# Global Styling System & Tailwind CSS v4 Configuration

This document explains how global styling is configured in WorkSphere, including the Tailwind CSS v4 setup, theme variables, custom utilities, and animations.

## Overview

WorkSphere uses **Tailwind CSS v4**, which introduces a CSS-first configuration approach. Unlike Tailwind v3, there is no `tailwind.config.js` file — all theme configuration lives directly inside `src/app/globals.css`.

```json
"tailwindcss": "^4",
"@tailwindcss/postcss": "^4"
```

## File Structure

All global styles are defined in a single file:

```
src/app/globals.css
```
## Importing Tailwind

Tailwind v4 is imported using a single import statement at the top of `globals.css`:

```css
@import "tailwindcss";
```

This replaces the old `@tailwind base; @tailwind components; @tailwind utilities;` syntax used in v3.

## Theme Configuration (`@theme inline`)

Tailwind v4 allows defining theme tokens directly in CSS using the `@theme` directive. WorkSphere uses `@theme inline` to map CSS custom properties to Tailwind-recognized theme variables:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

This means `bg-background`, `text-foreground`, `font-sans`, and `font-mono` utility classes are all driven by these variables.

## Color System (Light/Dark Mode)

Base colors are defined as CSS custom properties on `:root`, with automatic dark mode support via the `prefers-color-scheme` media query:

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

This approach means the app automatically adapts to the user's system theme without requiring a JavaScript toggle or extra class-based dark mode setup.

## Fonts

Fonts are loaded using `next/font/google` inside `src/app/layout.tsx`, and exposed to Tailwind via CSS variables:

```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
});
```

These variables are applied to the `<body>` via `className`:

```tsx
className={`${geistSans.variable} ${geistMono.variable} antialiased`}
```

And connected to Tailwind's font utilities through the `@theme inline` block (`--font-sans`, `--font-mono` above).

## Custom Utility Classes

WorkSphere defines custom utility classes using Tailwind v4's `@layer utilities` block combined with `@apply`:

```css
@layer utilities {
  .glass-card {
    @apply bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl;
  }
  .glow-blue {
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
  }
  .text-glow {
    text-shadow: none;
  }
}
```

| Class | Purpose |
|---|---|
| `.glass-card` | Frosted glass-style card with light/dark background and border |
| `.glow-blue` | Adds a soft blue glow shadow effect |
| `.text-glow` | Reserved utility for text glow (currently disabled) |

## Custom Animations

Several keyframe animations are defined globally for use across components:

| Animation Class | Effect | Duration |
|---|---|---|
| `.animate-gradient` | Animates background-position for gradient shifting | 6s, infinite |
| `.animate-fadeInUp` | Fades in and slides up on mount | 0.6s, ease-out |
| `.animate-pulseGlow` | Pulsing blue glow shadow | 2s, infinite |
| `.animate-shimmer` | Horizontal shimmer effect for loading states | 1.5s, infinite |

Example usage:
```tsx
<div className="animate-fadeInUp">
  Content fades and slides in
</div>
```

## Custom Scrollbar Styling

A custom WebKit scrollbar is styled globally, with separate colors for light and dark mode:

```css
::-webkit-scrollbar-thumb {
  background: #d1d5db;
}

@media (prefers-color-scheme: dark) {
  ::-webkit-scrollbar-thumb {
    background: #374151;
  }
}
```

## Accessibility Styling

- **Focus states:** All focusable elements get a visible blue outline via `*:focus-visible` for keyboard navigation accessibility.
- **Text selection:** Selected text uses a semi-transparent blue highlight (`::selection`) for brand consistency.

```css
*:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}

::selection {
  background: rgba(59, 130, 246, 0.3);
}
```

## Adding New Global Styles

When adding new global styles or utilities:

1. Add new CSS custom properties under `:root` (and its dark mode override) if introducing new theme colors.
2. Register new theme tokens inside `@theme inline` if they should be usable as Tailwind utility classes (e.g. `bg-*`, `text-*`).
3. Add reusable utility classes inside the `@layer utilities` block using `@apply` where possible.
4. Keep animations defined as standalone `@keyframes` blocks with a matching `.animate-*` class.
5. Run `npm run lint` and `npx tsc --noEmit` before committing, as required by the [Contributing Guidelines](../CONTRIBUTING.md).

## Summary

WorkSphere's styling system is fully CSS-native, leveraging Tailwind v4's `@theme` directive instead of a JavaScript config file. Colors and fonts are exposed as CSS variables, dark mode is handled automatically via `prefers-color-scheme`, and reusable effects (glassmorphism, glow, shimmer) are implemented as custom utility classes and keyframe animations.