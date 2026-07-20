# WorkSphere Design System

> The official design system documentation for WorkSphere — an AI-powered remote workspace finder.
>
> This guide documents every design token, theme variable, component, utility class, and styling convention that currently exists in the codebase. It is intended for contributors, designers, and frontend developers working on WorkSphere.

---

## Table of Contents

- [Introduction](#introduction)
- [Design Tokens](#design-tokens)
- [Tailwind CSS v4 Theme Variables](#tailwind-css-v4-theme-variables)
- [Color Palette](#color-palette)
- [Typography](#typography)
- [Spacing Scale](#spacing-scale)
- [Border Radius](#border-radius)
- [Shadows](#shadows)
- [Glassmorphism](#glassmorphism)
- [Dark Mode](#dark-mode)
- [Components](#components)
- [Utility Classes](#utility-classes)
- [Icons](#icons)
- [Motion](#motion)
- [Accessibility](#accessibility)
- [Responsive Design](#responsive-design)
- [Best Practices](#best-practices)
- [Examples](#examples)
- [Related Documentation](#related-documentation)

---

## Introduction

### Project Philosophy

WorkSphere uses a **utility-first** styling approach powered by **Tailwind CSS v4** with **shadcn/ui** (New York style, zinc base) component primitives built on **Radix UI**. The design system prioritizes:

- **Consistency** — shared tokens and utilities across all pages and components
- **Accessibility** — visible focus rings, keyboard navigation, screen reader support, reduced motion
- **Dark mode** — class-based dark mode with cookie persistence and cross-tab sync
- **Maintainability** — CSS-first configuration, no JavaScript theme config file
- **Performance** — tree-shaken icons, lazy animations, no runtime CSS-in-JS

### Design Principles

1. **Utility-first** — use Tailwind classes directly; avoid custom CSS unless necessary
2. **Token-driven** — reference CSS variables and theme tokens instead of hardcoded values
3. **Theme-aware** — every component must work in both light and dark mode
4. **Responsive** — mobile-first layouts with progressive enhancement
5. **Accessible** — WCAG AA contrast, focus indicators, ARIA attributes, `prefers-reduced-motion`

### Directory Overview

```text
src/
├── app/
│   ├── globals.css              # All global styles, theme tokens, animations
│   ├── layout.tsx               # Root layout (fonts, providers, theme init)
│   └── ...
├── components/
│   ├── ui/                      # Reusable UI primitives (shadcn/ui pattern)
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   ├── skeleton.tsx
│   │   ├── EmptyState.tsx
│   │   ├── Toast.tsx
│   │   ├── ScrollProgress.tsx
│   │   ├── FAQAccordion.tsx
│   │   └── ShortcutsModal.tsx
│   ├── TopNav.tsx               # Global navigation bar
│   ├── ThemeProvider.tsx         # Theme context (light/dark)
│   ├── ThemeToggle.tsx           # Theme switcher button
│   ├── ErrorBoundary.tsx         # Error boundary with fallbacks
│   ├── I18nProvider.tsx          # Internationalization provider
│   ├── SoundProvider.tsx         # Sound settings provider
│   ├── saved-venues/             # Saved venue components
│   ├── collections/              # Collection/folder components
│   ├── dashboard/                # Dashboard widgets
│   ├── chat/                     # Chat UI components
│   ├── noise/                    # Noise meter components
│   ├── venue/                    # Venue detail components
│   ├── social/                   # Social features
│   ├── settings/                 # Settings panels
│   └── webhooks/                 # Webhook management
├── lib/
│   └── utils.ts                  # cn() utility (clsx + tailwind-merge)
└── hooks/                        # Custom React hooks
```

### Utility Function

All components use the `cn()` helper from `src/lib/utils.ts` to merge class names:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### Configuration

The `components.json` file configures shadcn/ui:

```json
{
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/app/globals.css",
    "baseColor": "zinc",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide"
}
```

---

## Design Tokens

Design tokens are defined in `src/app/globals.css` as CSS custom properties and mapped to Tailwind via the `@theme inline` directive.

### Core Color Tokens

| Token | Light Value | Dark Value | CSS Variable |
|-------|-------------|------------|--------------|
| `--background` | `#ffffff` | `#0a0a0a` | Page viewport background |
| `--foreground` | `#171717` | `#ededed` | Primary text color |

> **Note:** Only `--background` and `--foreground` are defined as CSS custom properties. Additional color values used by components (e.g. `zinc-900`, `red-500`, `blue-600`) are referenced directly as Tailwind utility classes rather than through CSS variables.

### Theme Mappings

| Tailwind Theme Variable | Maps To | Tailwind Utilities |
|-------------------------|---------|-------------------|
| `--color-background` | `var(--background)` | `bg-background`, `text-background` |
| `--color-foreground` | `var(--foreground)` | `text-foreground`, `border-foreground` |
| `--font-sans` | `var(--font-geist-sans)` | `font-sans` |
| `--font-mono` | `var(--font-geist-mono)` | `font-mono` |

### Additional CSS Properties

| Property | Value | Purpose |
|----------|-------|---------|
| `color-scheme` | `light dark` | Native form control theming (scrollbars, checkboxes) |

### Tokens Currently Not Defined

The following tokens are **not** defined in the codebase but are referenced by some components:

- `--ring` / `--color-ring` — `Button` and `Input` use `focus-visible:ring-ring` but this token is not mapped in `@theme inline`. Keyboard focus rings may not render as expected on these components. See [Accessibility](#accessibility) for details.
- `--primary`, `--secondary`, `--destructive`, `--muted`, `--accent`, `--card`, `--border` as CSS variables — these HSL values appear in the `COLOR_PALETTE.md` doc but are **not** currently defined in `globals.css`. Components use Tailwind's zinc/blue/red scales directly instead.

---

## Tailwind CSS v4 Theme Variables

WorkSphere uses Tailwind CSS v4 with CSS-first configuration. There is **no `tailwind.config.js`** file. All configuration lives in `src/app/globals.css`.

### Import

```css
@import "tailwindcss";
```

This single import replaces the v3 `@tailwind base; @tailwind components; @tailwind utilities;` directives.

### Dark Mode Variant

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Dark mode is class-based. The `.dark` class is toggled on the `<html>` element.

### Theme Directive

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

The `inline` keyword ensures these values are inlined into the generated CSS rather than emitted as CSS variables, which avoids specificity issues.

### PostCSS Configuration

```js
// postcss.config.mjs
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

---

## Color Palette

WorkSphere uses **Tailwind's built-in color scales** directly in components rather than abstracting them through semantic CSS variables.

### Primary Colors

| Color | Tailwind Classes | Usage |
|-------|-----------------|-------|
| **Zinc (primary)** | `zinc-50`, `zinc-100`, `zinc-200`, `zinc-300`, `zinc-400`, `zinc-500`, `zinc-600`, `zinc-700`, `zinc-800`, `zinc-900`, `zinc-950` | Default buttons, text, borders, backgrounds |
| **Blue (accent)** | `blue-500`, `blue-600`, `blue-700` | Primary actions, links, focus rings, accents |
| **Red (destructive)** | `red-500`, `red-600`, `red-700`, `red-900` | Error states, destructive buttons, alerts |
| **Purple** | `purple-600`, `purple-700` | Gradient accents, branding |
| **Green / Emerald** | `green-500`, `emerald-400` | Success states, verified indicators |
| **Amber** | `amber-500` | Warning states |
| **Cyan** | `cyan-700` | Informational highlights |
| **Violet** | `violet-400`, `violet-700` | Decorative accents |

### Background Colors

| Context | Light | Dark | Classes |
|---------|-------|------|---------|
| Page background | `#ffffff` | `#0a0a0a` | `bg-background` |
| Card / surface | `#ffffff` | `zinc-900` | `bg-white dark:bg-zinc-900` |
| Input field | `#ffffff` | `zinc-950` | `bg-white dark:bg-zinc-950` |
| Secondary surface | `zinc-100` | `zinc-800` | `bg-zinc-100 dark:bg-zinc-800` |

### Text Colors

| Context | Light | Dark | Classes |
|---------|-------|------|---------|
| Primary text | `#171717` | `#ededed` | `text-foreground` |
| Label text | `zinc-900` | `zinc-50` | `text-zinc-900 dark:text-zinc-50` |
| Secondary text | `zinc-500` | `zinc-400` | `text-zinc-500 dark:text-zinc-400` |
| Muted text | `zinc-600` | `white/70` | `text-zinc-600 dark:text-white/70` |

### Border Colors

| Context | Light | Dark | Classes |
|---------|-------|------|---------|
| Standard border | `zinc-200` | `zinc-800` | `border-zinc-200 dark:border-zinc-800` |
| Muted border | `zinc-200/80` | `white/5` | `border-zinc-200/80 dark:border-white/5` |

### Semantic Status Colors

| Status | Classes | Usage |
|--------|---------|-------|
| **Success** | `text-green-500`, `bg-green-500` | Success toasts, verified badges |
| **Error** | `text-red-500`, `bg-red-500` | Error toasts, destructive actions |
| **Warning** | `text-amber-500`, `bg-amber-500` | Warning toasts, caution states |
| **Info** | `text-blue-500`, `bg-blue-500` | Informational badges, accents |

---

## Typography

### Font Families

| Font | Variable | Tailwind Class | Purpose |
|------|----------|---------------|---------|
| **Geist Sans** | `--font-geist-sans` | `font-sans` | Primary body font |
| **Geist Mono** | `--font-geist-mono` | `font-mono` | Code, technical content |
| **Arial, Helvetica, sans-serif** | — | — | Fallback (set on `body`) |

### Font Loading

Fonts are loaded via `next/font/google` in `src/app/layout.tsx`:

```tsx
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Applied to <body>:
<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
```

Additionally, the project bundles `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` in `public/fonts/` for offline/i18n use.

### Font Sizes

| Tailwind Class | Size | Usage |
|---------------|------|-------|
| `text-xs` | `0.75rem` (12px) | Captions, helper text, badges |
| `text-sm` | `0.875rem` (14px) | Labels, input text, button text, body small |
| `text-base` | `1rem` (16px) | Default body text |
| `text-lg` | `1.125rem` (18px) | Section headings, emphasized content |
| `text-xl` | `1.25rem` (20px) | Card titles, nav brand |
| `text-2xl` | `1.5rem` (24px) | Page headings (mobile) |
| `text-3xl` | `1.875rem` (30px) | Section headings (desktop) |
| `text-4xl` | `2.25rem` (36px) | Hero headings (desktop) |

### Font Weights

| Tailwind Class | Weight | Usage |
|---------------|--------|-------|
| `font-medium` | 500 | Buttons, labels, nav links |
| `font-semibold` | 600 | Subheadings, card titles |
| `font-bold` | 700 | Headings, emphasis |
| `font-black` | 900 | Uppercase section labels, FAQ questions |

### Letter Spacing

| Tailwind Class | Usage |
|---------------|-------|
| `tracking-wider` | Uppercase labels |
| `tracking-widest` | Section badges, eyebrow text |

### Line Heights

| Tailwind Class | Usage |
|---------------|-------|
| `leading-none` | Compact labels |
| `leading-relaxed` | Body text, descriptions |
| `leading-tight` | Headings |

### Typography Recommendations

- **Headings:** Use `text-2xl md:text-3xl font-bold` for page titles, `text-lg font-semibold` for card titles
- **Body:** Use `text-sm` or `text-base` with `text-zinc-700 dark:text-zinc-300`
- **Labels:** Use `text-sm font-medium` with `Label` component
- **Captions:** Use `text-xs text-zinc-500 dark:text-zinc-400`
- **Buttons:** Use `text-sm font-medium` (built into `Button`)
- **Code:** Use `font-mono` with `font-geist-mono`

---

## Spacing Scale

WorkSphere follows Tailwind's default spacing scale. Custom spacing tokens are **not** defined in `@theme` — components use Tailwind utilities directly.

### Common Spacing Values

| Token | Value | Common Usage |
|-------|-------|-------------|
| `p-2` | `0.5rem` (8px) | Compact padding, icon buttons |
| `p-3` | `0.75rem` (12px) | Card inner padding, small containers |
| `p-4` | `1rem` (16px) | Standard card padding |
| `p-6` | `1.5rem` (24px) | Section padding, modal content |
| `p-8` | `2rem` (32px) | Empty state, hero sections |
| `px-4` | `0 1rem` | Standard horizontal padding |
| `px-6` | `0 1.5rem` | Page-level horizontal padding |
| `py-2` | `0.5rem 0` | Button vertical padding |
| `py-3` | `0.75rem 0` | Input vertical padding |
| `py-5` | `1.25rem 0` | Accordion item padding |

### Gap Utilities

| Token | Value | Usage |
|-------|-------|-------|
| `gap-1` | `0.25rem` | Tight icon + text spacing |
| `gap-1.5` | `0.375rem` | Tag chip spacing |
| `gap-2` | `0.5rem` | Standard gap for inline elements |
| `gap-3` | `0.75rem` | Button groups, form fields |
| `gap-4` | `1rem` | Section spacing, flex layouts |
| `gap-6` | `1.5rem` | Grid gap, card layouts |

### Vertical Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `space-y-2` | `0.5rem` | List item spacing |
| `space-y-3` | `0.75rem` | Form field spacing |
| `space-y-4` | `1rem` | Section spacing |
| `space-y-6` | `1.5rem` | Major section spacing |

### Margins

| Token | Usage |
|-------|-------|
| `mb-1.5` | After heading before body |
| `mb-2` | After subtitle |
| `mb-3` | After icon in error states |
| `mb-4` | After heading in sections |
| `mb-5` | After header in modals |
| `mb-12` | After section header |

---

## Border Radius

WorkSphere uses Tailwind's default border radius scale. No custom radius tokens are defined in `@theme`.

| Token | Value | Usage |
|-------|-------|-------|
| `rounded` | `0.25rem` (4px) | Minimal rounding |
| `rounded-md` | `0.375rem` (6px) | Buttons, inputs, skeleton base |
| `rounded-lg` | `0.5rem` (8px) | Cards, small containers |
| `rounded-xl` | `0.75rem` (12px) | Theme toggle, toast items, tag chips |
| `rounded-2xl` | `1rem` (16px) | Saved venue cards, FAQ items, modals |
| `rounded-3xl` | `1.5rem` (24px) | Shortcuts modal, large containers |
| `rounded-full` | `9999px` | Avatar, badge, pill shapes |

### Recommendations

- **Buttons:** `rounded-md` (built into `Button` component)
- **Inputs:** `rounded-md` (built into `Input` component)
- **Cards:** `rounded-2xl` or `rounded-xl`
- **Modals/Dialogs:** `rounded-3xl` or `rounded-2xl`
- **Tags/Badges:** `rounded-xl` or `rounded-full`
- **Avatars:** `rounded-full`

---

## Shadows

### Tailwind Shadow Utilities

| Utility | Usage |
|---------|-------|
| `shadow-sm` | Subtle elevation, hover states |
| `shadow` | Default card shadow |
| `shadow-md` | Medium elevation |
| `shadow-lg` | Dropdown menus, popovers |
| `shadow-xl` | Elevated cards, panels, Clerk card element |

### Custom Shadow Effects

| Class | CSS | Usage |
|-------|-----|-------|
| `.glow-blue` | `box-shadow: 0 0 20px rgba(59, 130, 246, 0.3)` | Static blue glow for highlighted elements |
| `.animate-pulseGlow` | Animated `box-shadow` between `20px` and `40px` spread | Pulsing glow for interactive emphasis |

### Component-Specific Shadows

| Component | Shadow | Context |
|-----------|--------|---------|
| `TopNav` logo | `shadow-lg shadow-blue-500/30` | Brand icon glow |
| `ShortcutsModal` | `shadow-2xl` | High-elevation modal |
| `ErrorBoundary` | none | Flat error card |
| `Toast` | `shadow-lg` | Notification toast |

---

## Glassmorphism

### Custom Utility: `.glass-card`

Defined in `src/app/globals.css`:

```css
@layer utilities {
  .glass-card {
    @apply bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl;
  }
}
```

| Property | Light | Dark |
|----------|-------|------|
| Background | `bg-white` | `bg-zinc-900` |
| Border | `border-zinc-200` | `border-zinc-800` |
| Shadow | `shadow-xl` | `shadow-xl` |

### Backdrop Blur Utilities

WorkSphere uses Tailwind's backdrop blur utilities extensively for glass effects:

| Utility | Blur Amount | Usage |
|---------|-------------|-------|
| `backdrop-blur-sm` | 4px | Subtle overlays, lightweight UI |
| `backdrop-blur-md` | 12px | Toast notifications, cards |
| `backdrop-blur-xl` | 24px | Full-screen modals, dialogs |

### Glass Pattern in Components

**TopNav (navigation bar):**
```tsx
<nav className="sticky top-0 z-50 border-b border-zinc-200/80 dark:border-white/5
  backdrop-blur-xl bg-white/70 dark:bg-black/40 transition-colors">
```

**Toast notifications:**
```tsx
className="bg-white/90 dark:bg-zinc-900/90 border-zinc-200 dark:border-zinc-800
  backdrop-blur-md"
```

**Shortcuts modal backdrop:**
```tsx
className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm"
```

**FAQ accordion items:**
```tsx
className="bg-white/50 dark:bg-black/20 backdrop-blur-sm"
```

### Building Glass Components

To create a glass-style component:

```tsx
<div className="bg-white/70 dark:bg-zinc-900/70 backdrop-blur-md
  border border-zinc-200/50 dark:border-zinc-800/50 rounded-2xl shadow-xl">
  {/* Content */}
</div>
```

Adjust opacity values (`/70`, `/90`) based on how much background content should show through.

---

## Dark Mode

### Implementation

Dark mode is implemented via a **class-based** strategy:

1. **CSS configuration** — `@custom-variant dark (&:where(.dark, .dark *))` in `globals.css`
2. **Theme provider** — `ThemeProvider` (React context) in `src/components/ThemeProvider.tsx`
3. **Init script** — A blocking inline `<script>` in `layout.tsx` reads `localStorage` before first paint to prevent flash
4. **Cookie persistence** — Theme choice is saved to `localStorage` and a `worksphere-theme` cookie for SSR

### Theme Switching

```tsx
// In any component:
import { useTheme } from "@/components/ThemeProvider";

function MyComponent() {
  const { theme, toggleTheme, setTheme } = useTheme();

  return (
    <button onClick={toggleTheme}>
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
```

### CSS Variables

Light and dark mode values are defined in `globals.css`:

```css
:root {
  --background: #ffffff;
  --foreground: #171717;
  color-scheme: light dark;
}

.dark {
  --background: #0a0a0a;
  --foreground: #ededed;
}
```

### Tailwind Usage

Components use the `dark:` variant for theme-aware styling:

```tsx
<div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50">
  Theme-aware content
</div>
```

### Preferred Pattern

Use `dark:` variants directly in className rather than CSS variables for most styling:

```tsx
// Preferred
className="bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"

// Also valid (for the two mapped tokens)
className="bg-background text-foreground"
```

### Best Practices

- Always pair light and dark classes together
- Use zinc scale for dark mode backgrounds (`zinc-900`, `zinc-950`)
- Use `white/` opacity for dark mode borders (`white/5`, `white/10`)
- Test every new component in both light and dark mode
- Never assume light-only rendering

### Light → Dark Mode Mapping Table

| Purpose | Light | Dark | Classes |
|---------|-------|------|---------|
| Page background | `#ffffff` | `#0a0a0a` | `bg-background` |
| Card/surface bg | `white` | `zinc-900` | `bg-white dark:bg-zinc-900` |
| Secondary surface | `zinc-100` | `zinc-800` | `bg-zinc-100 dark:bg-zinc-800` |
| Input bg | `white` | `zinc-950` | `bg-white dark:bg-zinc-950` |
| Primary text | `#171717` | `#ededed` | `text-foreground` |
| Label text | `zinc-900` | `zinc-50` | `text-zinc-900 dark:text-zinc-50` |
| Body text | `zinc-700` | `zinc-300` | `text-zinc-700 dark:text-zinc-300` |
| Secondary text | `zinc-500` | `zinc-400` | `text-zinc-500 dark:text-zinc-400` |
| Muted text | `zinc-600` | `white/70` | `text-zinc-600 dark:text-white/70` |
| Border | `zinc-200` | `zinc-800` | `border-zinc-200 dark:border-zinc-800` |
| Subtle border | `zinc-200/80` | `white/5` | `border-zinc-200/80 dark:border-white/5` |
| Button default bg | `zinc-900` | `zinc-50` | `bg-zinc-900 dark:bg-zinc-50` |
| Button default text | `zinc-50` | `zinc-900` | `text-zinc-50 dark:text-zinc-900` |
| Button secondary bg | `zinc-100` | `zinc-800` | `bg-zinc-100 dark:bg-zinc-800` |
| Ghost hover bg | `zinc-100` | `zinc-800` | `hover:bg-zinc-100 dark:hover:bg-zinc-800` |
| Scrollbar thumb | `zinc-300` | `zinc-700` | (via CSS) |
| Skeleton bg | `zinc-200` | `zinc-800` | `bg-zinc-200 dark:bg-zinc-800` |
| Modal backdrop | `zinc-950/60` | `zinc-950/60` | `bg-zinc-950/60` |

---

## Components

### Button

**File:** `src/components/ui/button.tsx`

A versatile button component with 6 variants and 4 sizes.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `"default" \| "destructive" \| "outline" \| "secondary" \| "ghost" \| "link"` | `"default"` | Visual style variant |
| `size` | `"default" \| "sm" \| "lg" \| "icon"` | `"default"` | Button size |
| `className` | `string` | — | Additional CSS classes |
| `...props` | `React.ButtonHTMLAttributes<HTMLButtonElement>` | — | All native button attributes |

#### Variants

| Variant | Light | Dark | Usage |
|---------|-------|------|-------|
| `default` | `bg-zinc-900 text-zinc-50` | `bg-zinc-50 text-zinc-900` | Primary actions |
| `destructive` | `bg-red-500 text-zinc-50` | `bg-red-900 text-zinc-50` | Delete, remove, danger |
| `outline` | `border-zinc-200 bg-white` | `border-zinc-800 bg-zinc-950` | Secondary actions |
| `secondary` | `bg-zinc-100 text-zinc-900` | `bg-zinc-800 text-zinc-50` | Tertiary actions |
| `ghost` | transparent, hover `zinc-100` | transparent, hover `zinc-800` | Inline actions, nav |
| `link` | `text-zinc-900`, underline | `text-zinc-50`, underline | Text links |

#### Sizes

| Size | Height | Padding | Notes |
|------|--------|---------|-------|
| `default` | `h-10` | `px-4 py-2` | Standard button |
| `sm` | `h-9` | `px-3` | Compact button |
| `lg` | `h-11` | `px-8` | Large/CTA button |
| `icon` | `h-10 w-10` | — | Square icon-only button |

#### Example

```tsx
import { Button } from "@/components/ui/button";

<Button variant="default" size="default">Save Changes</Button>
<Button variant="destructive" size="sm">Delete</Button>
<Button variant="outline" size="lg">Learn More</Button>
<Button variant="ghost" size="icon">
  <Settings className="w-4 h-4" />
</Button>
```

#### Accessibility

- Uses `focus-visible:ring-2` for keyboard focus (note: `--ring` token not currently defined)
- `disabled:opacity-50 disabled:pointer-events-none` for disabled state
- All native button attributes are supported via spread

---

### Input

**File:** `src/components/ui/input.tsx`

A styled text input component.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | — | Additional CSS classes |
| `type` | `string` | — | Input type (text, email, password, etc.) |
| `...props` | `React.InputHTMLAttributes<HTMLInputElement>` | — | All native input attributes |

#### Styling

- Light: `border-zinc-200 bg-white`, placeholder `text-zinc-500`
- Dark: `border-zinc-800 bg-zinc-950`, placeholder `text-zinc-400`
- `h-10 w-full rounded-md border px-3 py-2 text-sm`
- Focus: `ring-2 ring-ring ring-offset-2`
- Disabled: `cursor-not-allowed opacity-50`

#### Example

```tsx
import { Input } from "@/components/ui/input";

<Input type="email" placeholder="you@example.com" />
<Input type="password" disabled />
<Input className="max-w-sm" />
```

---

### Label

**File:** `src/components/ui/label.tsx`

A form label component that responds to peer disabled state.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | — | Additional CSS classes |
| `...props` | `React.LabelHTMLAttributes<HTMLLabelElement>` | — | All native label attributes |

#### Styling

- `text-sm font-medium leading-none`
- Light: `text-zinc-900`, Dark: `text-zinc-50`
- `peer-disabled:cursor-not-allowed peer-disabled:opacity-70` — auto-dims when paired disabled input is present

#### Example

```tsx
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

<div className="space-y-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" placeholder="you@example.com" />
</div>

<div className="space-y-2">
  <Label htmlFor="disabled">Disabled</Label>
  <Input id="disabled" disabled />
</div>
```

---

### Skeleton

**File:** `src/components/ui/skeleton.tsx`

A pulse-animated placeholder for loading states.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `className` | `string` | — | Size and shape customization |

#### Base Styling

```tsx
<div className="animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800" />
```

#### Composed Skeletons

| Export | Description |
|--------|-------------|
| `Skeleton` | Base primitive — sized via `className` |
| `VenueCardSkeleton` | Mirrors a single venue card layout |
| `VenueListSkeleton` | A list of `VenueCardSkeleton` (configurable `count`, default 3) |
| `ChatMessageSkeleton` | Incoming chat bubble placeholder |
| `AgentStepsSkeleton` | 5-step timeline with left border |
| `SavedVenueCardSkeleton` | Saved venue card layout |
| `MapMarkerSkeleton` | Centered circular map marker |

#### Example

```tsx
import { Skeleton, VenueCardSkeleton, VenueListSkeleton } from "@/components/ui/skeleton";

// Base skeleton
<Skeleton className="h-4 w-32" />

// Venue card skeleton
<VenueCardSkeleton />

// List of 5 skeletons
<VenueListSkeleton count={5} />
```

#### Convention

Skeleton layouts reuse the same spacing/flex classes as their real component counterpart to prevent layout shift on load.

---

### EmptyState

**File:** `src/components/ui/EmptyState.tsx`

An animated empty state component with SVG illustrations.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `illustration` | `"search" \| "collection" \| "chat"` | — | Which SVG illustration to display |
| `message` | `string` | — | Bold heading text |
| `description` | `string` | — | Optional descriptive text |
| `action` | `React.ReactNode` | — | Optional action element (e.g., button) |

#### Illustrations

| Type | Description |
|------|-------------|
| `search` | Animated radar/pin with magnifying glass — for empty search results |
| `collection` | Floating folder with star — for empty collections |
| `chat` | Chat bubbles with brain icon — for empty chat state |

#### Example

```tsx
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/button";

<EmptyState
  illustration="search"
  message="No venues found"
  description="Try adjusting your search filters"
  action={<Button>Clear Filters</Button>}
/>
```

---

### Toast

**File:** `src/components/ui/Toast.tsx`

A toast notification system with context-based API.

#### Types

```ts
type ToastType = "success" | "error" | "warning";
```

#### API

| Export | Description |
|--------|-------------|
| `ToastProvider` | Context provider — wrap at the top level |
| `useToast()` | Hook returning `{ toast: (message, type?) => void }` |

#### Toast Types

| Type | Icon | Icon Color | Default |
|------|------|-----------|---------|
| `success` | `CheckCircle2` | `text-green-500` | Yes |
| `error` | `AlertCircle` | `text-red-500` | — |
| `warning` | `AlertTriangle` | `text-amber-500` | — |

#### Styling

- `fixed bottom-6 right-6 z-[9999]` positioning
- `backdrop-blur-md bg-white/90 dark:bg-zinc-900/90`
- Auto-dismisses after 4 seconds
- `aria-live="polite"` for screen readers

#### Example

```tsx
import { ToastProvider, useToast } from "@/components/ui/Toast";

// Wrap in layout:
<ToastProvider>{children}</ToastProvider>

// In any component:
function MyComponent() {
  const { toast } = useToast();

  return (
    <>
      <button onClick={() => toast("Saved successfully")}>Save</button>
      <button onClick={() => toast("Failed to save", "error")}>Fail</button>
      <button onClick={() => toast("Caution!", "warning")}>Warn</button>
    </>
  );
}
```

---

### ScrollProgress

**File:** `src/components/ui/ScrollProgress.tsx`

A fixed progress bar at the top of the viewport showing scroll position.

#### Behavior

- `fixed top-0 left-0 h-1 z-50`
- Gradient: `from-blue-600 to-purple-600`
- Width driven by scroll percentage via `useScrollProgress` hook
- `aria-hidden="true"` — decorative only

#### Example

```tsx
import { ScrollProgress } from "@/components/ui/ScrollProgress";

// Already included in layout.tsx — no manual addition needed
<ScrollProgress />
```

---

### FAQAccordion

**File:** `src/components/ui/FAQAccordion.tsx`

A single-expand accordion for frequently asked questions.

#### Features

- Single-item expand (only one open at a time)
- Animated expand/collapse via Framer Motion
- `aria-expanded`, `aria-controls`, `aria-labelledby` attributes
- `focus-visible:ring-2 focus-visible:ring-blue-500` on question buttons
- Hardcoded FAQ data for WorkSphere

#### Styling

```tsx
<div className="border border-zinc-200 dark:border-white/10 rounded-2xl
  bg-white/50 dark:bg-black/20 backdrop-blur-sm">
```

#### Example

```tsx
import FAQAccordion from "@/components/ui/FAQAccordion";

<FAQAccordion />
```

---

### ShortcutsModal

**File:** `src/components/ui/ShortcutsModal.tsx`

A modal dialog displaying keyboard shortcuts.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `isOpen` | `boolean` | — | Controls visibility |
| `onClose` | `() => void` | — | Called when modal should close |

#### Keyboard Shortcuts Displayed

| Category | Shortcut | Action |
|----------|----------|--------|
| General | `?` | Toggle shortcuts guide |
| General | `Esc` | Close active modal |
| Chat | `Ctrl/⌘ + K` | Focus search input |
| Venues | `↓` | Next venue card |
| Venues | `↑` | Previous venue card |
| Venues | `Enter` | Open venue details |

#### Styling

- Backdrop: `bg-zinc-950/60 backdrop-blur-sm`
- Modal: `rounded-3xl bg-white dark:bg-zinc-900 shadow-2xl`
- Kbd elements: `bg-zinc-100 dark:bg-zinc-800 border rounded-lg font-mono`

#### Example

```tsx
import { ShortcutsModal } from "@/components/ui/ShortcutsModal";

<ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
```

---

### TopNav

**File:** `src/components/TopNav.tsx`

The global navigation bar, sticky at the top.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `hideAuth` | `boolean` | `false` | Hides auth buttons and user menu |

#### Features

- Sticky positioning with backdrop blur (glass effect)
- Logo with gradient icon (`blue-500 → purple-600`)
- Theme toggle
- Auth-aware: shows Sign In/Get Started for guests, Dashboard/Collections/Avatar for authenticated users
- Responsive: `hidden sm:flex` for nav links

#### Styling

```tsx
<nav className="sticky top-0 z-50 border-b border-zinc-200/80 dark:border-white/5
  backdrop-blur-xl bg-white/70 dark:bg-black/40 transition-colors">
  <div className="container mx-auto px-6 sm:px-10 h-[72px] flex items-center justify-between">
```

#### Example

```tsx
import { TopNav } from "@/components/TopNav";

<TopNav />            // Default with auth
<TopNav hideAuth />   // Without auth buttons
```

---

### ThemeToggle

**File:** `src/components/ThemeToggle.tsx`

A button that toggles between light and dark mode.

#### Features

- Shows `Sun` icon in light mode, `Moon` icon in dark mode
- Uses CSS (`dark:hidden` / `hidden dark:block`) to avoid hydration flash
- Hover: `hover:bg-blue-600 hover:text-white`
- Active: `active:scale-95`
- `aria-label` for screen readers

#### Example

```tsx
import { ThemeToggle } from "@/components/ThemeToggle";

<ThemeToggle />
```

---

### ErrorBoundary

**File:** `src/components/ErrorBoundary.tsx`

A React class component error boundary with domain-specific variants.

#### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | — | Content to protect |
| `fallback` | `ReactNode` | — | Custom fallback UI |
| `onError` | `(error, errorInfo) => void` | — | Error callback |

#### Variants

| Export | Purpose |
|--------|---------|
| `ErrorBoundary` | Generic error boundary |
| `withErrorBoundary(Component, fallback?)` | HOC wrapper |
| `ChatErrorBoundary` | Chat-specific error with refresh |
| `MapErrorBoundary` | Map-specific error with reload |

#### Example

```tsx
import { ErrorBoundary, ChatErrorBoundary, MapErrorBoundary } from "@/components/ErrorBoundary";

<ErrorBoundary>
  <MyComponent />
</ErrorBoundary>

<ErrorBoundary fallback={<CustomFallback />}>
  <MyComponent />
</ErrorBoundary>

<ChatErrorBoundary>
  <EnhancedChatbot />
</ChatErrorBoundary>

<MapErrorBoundary>
  <Map />
</MapErrorBoundary>
```

---

### SiteFooter

**File:** `src/components/site-footer.tsx`

The global page footer with newsletter, social links, and navigation.

#### Features

- Newsletter subscription form
- Social links (GitHub, Twitter, LinkedIn, Discord)
- Navigation columns (Discover, Community, Legal)
- Ambient gradient backdrop
- Responsive grid layout

#### Example

```tsx
import SiteFooter from "@/components/site-footer";

<SiteFooter />
```

---

### SavedVenueCard

**File:** `src/components/saved-venues/SavedVenueCard.tsx`

Expandable card for saved/bookmarked venues.

#### Features

- Expand/collapse with tag editing
- Inline tag rename
- Tag input and filter
- Note editor
- Venue metadata (category, rating, wifi, outlets, noise)
- Remove favorite action

#### Example

```tsx
import { SavedVenueCard } from "@/components/saved-venues/SavedVenueCard";

<SavedVenueCard venue={venue} onUpdate={refreshList} />
```

---

### TagChip

**File:** `src/components/saved-venues/TagChip.tsx`

A reusable tag chip with color dot, delete, and rename capabilities.

#### Features

- 10 color presets
- Delete button, rename button
- Active/inactive state
- Keyboard accessible
- `sm` and `md` sizes

#### Example

```tsx
import { TagChip } from "@/components/saved-venues/TagChip";

<TagChip name="WiFi Verified" color="#3B82F6" size="md" active />
<TagChip name="Quiet" color="#10B981" size="sm" onDelete={() => {}} />
```

---

### TagInput

**File:** `src/components/saved-venues/TagInput.tsx`

Dialog for creating new tags with color picker.

#### Features

- 10-color picker
- Duplicate detection
- Name input with validation
- Loading/error states
- Escape to close

#### Example

```tsx
import { TagInput } from "@/components/saved-venues/TagInput";

<TagInput isOpen={showTagInput} onClose={() => setShowTagInput(false)} onCreated={refreshTags} />
```

---

### TagFilter

**File:** `src/components/saved-venues/TagFilter.tsx`

Dropdown for filtering venues by tags.

#### Features

- Search within tags
- Multi-select
- Active filter badges
- Clear-all button
- Click-outside to close

---

### NoteEditor

**File:** `src/components/saved-venues/NoteEditor.tsx`

Auto-saving note editor for saved venues.

#### Features

- 1.5s debounce auto-save
- 2000 character limit
- `Cmd+S` manual save
- Edit/preview toggle
- Auto-resize textarea

---

### MetricsWidget

**File:** `src/components/collections/MetricsWidget.tsx`

Displays aggregate metrics for a collection.

#### Metrics Displayed

- Average WiFi speed
- Average quietness score
- Outlet availability percentage

#### Example

```tsx
import { MetricsWidget } from "@/components/collections/MetricsWidget";

<MetricsWidget folderId={folderId} />
```

---

### AddToFolderModal

**File:** `src/components/collections/AddToFolderModal.tsx`

Modal for adding a venue to a collection folder.

#### Features

- Fetches available folders
- Filters to OWNER/EDITOR roles
- Adds venue via POST
- Broadcasts refresh via PartyKit

---

### ComparisonTool

**File:** `src/components/collections/ComparisonTool.tsx`

Side-by-side collection comparison.

#### Example

```tsx
import { ComparisonTool } from "@/components/collections/ComparisonTool";

<ComparisonTool />
```

---

### StreakCard

**File:** `src/components/dashboard/StreakCard.tsx`

Daily activity streak card with flame animation.

#### Features

- Flame animation (Framer Motion)
- Milestone badges (5/10/30 days)
- Progress bar
- Check-in button
- Skeleton loading state

---

### WorkspaceNotificationPanel

**File:** `src/components/settings/WorkspaceNotificationPanel.tsx`

Slack/MS Teams webhook integration panel.

#### Features

- Webhook URL input
- Save/success/error states
- SSRF protection badge

---

### VenueShareButton

**File:** `src/components/social/VenueShareButton.tsx`

Share button using Web Share API with clipboard fallback.

#### Features

- Web Share API (native share dialog)
- Clipboard fallback
- "Link copied" confirmation

---

### VenueSubmissionModal

**File:** `src/components/VenueSubmissionModal.tsx`

Full venue submission form.

#### Features

- Drag-and-drop photo upload
- Geolocation
- Category selection
- Acoustic amenities checkboxes
- Coffee features, pet policies
- Image preview
- Clerk auth integration

---

### VenueRatingDialog

**File:** `src/components/VenueRatingDialog.tsx`

Comprehensive venue rating dialog.

#### Features

- WiFi stars rating
- Outlet yes/no + types + locations
- Noise level buttons + NoiseMeter integration
- WiFi/download/upload speed inputs, latency
- Crowd level, outlet density, lighting
- Speedtest photo upload with compression
- Music style, ergonomic features
- Comment textarea
- React portal rendering

---

### AutocompleteDropdown

**File:** `src/components/AutocompleteDropdown.tsx`

Search autocomplete with categorized suggestions.

#### Features

- Categories: Work Type, Venue Type, Amenities, Location, Time
- Keyboard navigation (arrow keys, enter, escape)
- Framer Motion animations

---

### OnboardingTour

**File:** `src/components/OnboardingTour.tsx`

React Joyride onboarding tour.

#### Features

- 3 steps: Map, AI Chat, Booking
- localStorage persistence
- Skip/progress buttons

---

### CustomAvatarUpload

**File:** `src/components/CustomAvatarUpload.tsx`

Clerk-based avatar upload with validation.

#### Features

- File type validation (images only)
- 5MB max size
- Loading state
- Error display
- Profile image preview

---

### I18nProvider

**File:** `src/components/I18nProvider.tsx`

Internationalization provider.

#### Features

- 5 languages: English, Spanish, French, German, Hindi
- Browser language detection
- CSRF token integration
- Hydration-safe mounting

---

## Utility Classes

### Custom Utilities (defined in globals.css)

| Class | CSS | Usage |
|-------|-----|-------|
| `.glass-card` | `bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl` | Frosted glass card container |
| `.glow-blue` | `box-shadow: 0 0 20px rgba(59, 130, 246, 0.3)` | Static blue glow effect |
| `.text-glow` | `text-shadow: none` | Reserved (currently disabled) |

### Custom Animations (defined in globals.css)

| Class | Animation | Duration | Effect |
|-------|-----------|----------|--------|
| `.animate-gradient` | `gradient` | 6s, infinite | Background gradient position cycling |
| `.animate-fadeInUp` | `fadeInUp` | 0.6s, forwards | Fade in + 20px upward slide |
| `.animate-pulseGlow` | `pulseGlow` | 2s, infinite | Breathing blue glow (20px ↔ 40px) |
| `.animate-shimmer` | `shimmer` | 1.5s, infinite | Horizontal shimmer sweep |

### Common Tailwind Utilities in Use

| Category | Utilities |
|----------|-----------|
| Flex | `flex`, `inline-flex`, `flex-1`, `flex-col`, `items-center`, `items-start`, `justify-center`, `justify-between` |
| Grid | `grid`, `grid-cols-1`, `grid-cols-2`, `md:grid-cols-2`, `lg:grid-cols-3` |
| Position | `sticky`, `fixed`, `absolute`, `relative` |
| Overflow | `overflow-hidden`, `overflow-y-auto`, `min-w-0` |
| Sizing | `w-full`, `w-8`, `w-10`, `h-8`, `h-9`, `h-10`, `h-11`, `max-w-lg`, `max-w-sm`, `max-w-3xl` |
| Display | `hidden`, `block`, `sm:flex`, `sm:block` |
| Transitions | `transition-colors`, `transition-all`, `transition-shadow`, `transition-transform` |

---

## Icons

### Library

WorkSphere uses **Lucide React** (`lucide-react` v0.562.0) for all icons.

### Import Pattern

```tsx
import { MapPin, Settings, AlertCircle } from "lucide-react";
```

Icons are imported individually for optimal tree-shaking.

### Naming Convention

PascalCase, matching the Lucide icon name: `MapPin`, `AlertCircle`, `Loader2`, `ChevronDown`.

### Standard Sizes

| Tailwind Classes | Pixel Size | Usage |
|-----------------|------------|-------|
| `w-3 h-3` | 12px | Tiny inline icons |
| `w-3.5 h-3.5` | 14px | Toast dismiss button |
| `w-4 h-4` | 16px | Standard icon size, buttons, nav |
| `w-5 h-5` | 20px | Larger icons, header icons |
| `w-6 h-6` | 24px | Feature icons |
| `w-10 h-10` | 40px | Error state icons, large feature icons |
| `w-12 h-12` | 48px | Empty state large icons |

### Color Patterns

```tsx
// Semantic colors
<AlertCircle className="w-4 h-4 text-red-500" />
<CheckCircle2 className="w-4 h-4 text-green-500" />

// Contextual colors
<Sun className="w-4 h-4 dark:hidden" />
<Moon className="w-4 h-4 hidden dark:block" />

// Neutral
<MapPin className="w-5 h-5 text-white" />
```

### Icons Used in the Codebase

| Icon | Usage |
|------|-------|
| `MapPin` | Logo, map markers, venue location |
| `Sun` / `Moon` | Theme toggle |
| `X` | Close buttons, dismiss |
| `CheckCircle2` | Success toasts |
| `AlertCircle` | Error toasts |
| `AlertTriangle` | Warning toasts, error boundaries |
| `RefreshCw` | Retry buttons |
| `ChevronDown` | Accordion expand indicator |
| `Keyboard` | Shortcuts modal header |
| `Coffee` | Dashboard nav link |
| `LayoutGrid` | Collections nav link |
| `Loader2` | Loading spinner (animated) |
| `Settings` | Settings pages |
| `Globe` | Language selector |

---

## Motion

### Framer Motion

WorkSphere uses **Framer Motion** (`framer-motion` v12.42.2) for animations.

### Page Transitions

Defined in `src/app/template.tsx` using `AnimatePresence`:

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={pathname}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.22, ease: "easeInOut" }}
  >
    {children}
  </motion.div>
</AnimatePresence>
```

### Reusable Animation Variants

```ts
// Fade
const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

// Slide up
const slideUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
};

// Scale
const scale = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
};
```

### Modal Animations

```tsx
// Backdrop
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
/>

// Dialog
<motion.div
  initial={{ opacity: 0, scale: 0.95, y: 12 }}
  animate={{ opacity: 1, scale: 1, y: 0 }}
  exit={{ opacity: 0, scale: 0.95, y: 12 }}
  transition={{ type: "spring", duration: 0.4 }}
/>
```

### List Stagger

```tsx
// Container
initial="hidden"
animate="visible"
variants={{
  visible: { transition: { staggerChildren: 0.08 } },
}}

// Items
variants={{
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
}}
```

### Hover Effects

```tsx
<motion.button
  whileHover={{ scale: 1.03 }}
  whileTap={{ scale: 0.97 }}
/>
```

### Custom CSS Animations

Defined in `globals.css` — see [Utility Classes](#utility-classes).

### Timing Guidelines

| Interaction | Duration | Easing |
|-------------|----------|--------|
| Hover/Press | 150ms | `ease` |
| Button press | 100–150ms | `ease` |
| Modal/Dropdown | 200–300ms | `ease-in-out` |
| Page transition | ~220ms | `ease-in-out` |
| List item entrance | 150–250ms | `ease-out` |
| Gradient cycle | 6s | `ease` |
| Shimmer | 1.5s | `linear` |
| Pulse glow | 2s | `ease-in-out` |

### Reduced Motion

The project respects `prefers-reduced-motion: reduce`:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  ::before,
  ::after {
    animation-delay: -1ms !important;
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    background-attachment: initial !important;
    scroll-behavior: auto !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
  }
}
```

This globally disables all animations and transitions for users who prefer reduced motion.

---

## Accessibility

### Focus Management

**Global focus styles** (defined in `globals.css`):

```css
*:focus-visible {
  outline: 2px solid #3b82f6;
  outline-offset: 2px;
}
```

**Component focus patterns:**

| Component | Focus Style |
|-----------|-------------|
| `Button` | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| `Input` | `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2` |
| `FAQAccordion` | `focus-visible:ring-2 focus-visible:ring-blue-500 rounded-2xl` |
| `ThemeToggle` | Inherits global `focus-visible:outline` |
| `ShortcutsModal` close | Inherits global `focus-visible:outline` |

> **Known Issue:** The `Button` and `Input` components use `focus-visible:ring-ring` but the `--ring` / `--color-ring` CSS variable is not defined in `@theme inline`. Until this is fixed, these components rely on the global `*:focus-visible` outline as a fallback. New components should use `focus-visible:ring-2 focus-visible:ring-blue-500` directly.

### Text Selection

```css
::selection {
  background: rgba(59, 130, 246, 0.3);
}
```

Blue-tinted selection color consistent with the brand palette.

### ARIA Attributes in Use

| Pattern | Attributes |
|---------|-----------|
| Toast container | `aria-live="polite"`, `aria-label="Notifications"` |
| Toast item | `role="status"` |
| Toast dismiss | `aria-label="Dismiss notification"` |
| FAQ question | `aria-expanded`, `aria-controls`, `aria-labelledby` |
| FAQ answer | `role="region"`, `aria-labelledby` |
| Shortcuts modal | `aria-label="Close keyboard shortcuts"` on close button |
| Theme toggle | `aria-label="Switch to light/dark mode"` |
| Decorative elements | `aria-hidden="true"` |
| Scroll progress | `aria-hidden="true"` |

### Screen Reader Support

- All interactive elements have accessible names via `aria-label`
- Status messages use `role="status"` or `aria-live`
- Decorative elements use `aria-hidden="true"`
- Modal content follows `role="dialog"` patterns

### Keyboard Navigation

- All interactive elements are focusable via Tab
- FAQ accordion supports `Enter`/`Space` to toggle
- Shortcuts modal supports `Esc` to close
- Autocomplete dropdown supports arrow key navigation
- `prefers-reduced-motion` disables all animations

### Contrast

- Primary text (`#171717` on white, `#ededed` on `#0a0a0a`) exceeds WCAG AA
- Secondary text (`zinc-500` / `zinc-400`) meets WCAG AA for large text
- Blue accent (`blue-600`) on white meets WCAG AA

### Best Practices

1. Always add `aria-label` to icon-only buttons
2. Use `aria-hidden="true"` on decorative icons
3. Ensure all modals have `role="dialog"` and `aria-labelledby`
4. Test keyboard navigation for every interactive element
5. Use semantic HTML elements (`nav`, `main`, `section`, `article`)
6. Add `alt` text to all images
7. Test with screen readers (VoiceOver, NVDA)

---

## Responsive Design

### Breakpoints

| Prefix | Min Width | Typical Devices |
|--------|-----------|----------------|
| (none) | 0px | Mobile phones (base) |
| `sm` | 640px | Large phones, small tablets |
| `md` | 768px | Tablets, iPad portrait |
| `lg` | 1024px | Small laptops, iPad landscape |
| `xl` | 1280px | Desktops |
| `2xl` | 1536px | Large desktops |

### Mobile-First Strategy

All components are written mobile-first. Base styles apply to the smallest screen; larger screens are addressed with `sm:`, `md:`, `lg:`, `xl:` prefixes.

```tsx
// Base: single column on mobile
// md: two columns on tablets
// lg: three columns on desktop
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

### Common Responsive Patterns

**Navigation:**
```tsx
// TopNav: hides links on mobile, shows on sm+
<Link className="hidden sm:flex items-center gap-2 px-4 py-2 ...">
```

**Spacing:**
```tsx
<div className="px-4 sm:px-6 md:px-10">
```

**Typography:**
```tsx
<h1 className="text-2xl md:text-3xl lg:text-4xl font-bold">
```

**Container:**
```tsx
<div className="container mx-auto px-6 sm:px-10">
```

**Grid:**
```tsx
<div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
```

### Responsive Utilities

| Utility | Usage |
|---------|-------|
| `hidden` / `block` | Show/hide at specific breakpoints |
| `sm:flex` / `md:block` | Toggle display modes |
| `max-w-7xl` | Content width cap |
| `min-h-dvh` | Full viewport height (including mobile browser chrome) |

### Touch vs Pointer

For touch-specific styling:

```tsx
className="hover:bg-zinc-100 pointer-coarse:hover:bg-transparent"
```

### Testing Checklist

Test at these viewport widths:
- `375px` — iPhone SE
- `640px` — `sm` breakpoint
- `768px` — `md` breakpoint (iPad portrait)
- `1024px` — `lg` breakpoint (iPad landscape)
- `1280px` — `xl` breakpoint
- `1536px` — `2xl` breakpoint

---

## Best Practices

### Do

- Use the `cn()` utility for conditional class merging
- Always pair `dark:` variants with light counterparts
- Use `text-sm font-medium` for labels and `text-xs` for captions
- Use `rounded-xl` or `rounded-2xl` for cards
- Use `shadow-xl` for elevated surfaces
- Use `backdrop-blur-md` with semi-transparent backgrounds for glass effects
- Use `animate-pulse` on skeletons
- Add `aria-label` to icon-only buttons
- Use semantic HTML elements
- Test in both light and dark mode
- Use `prefers-reduced-motion` aware animations
- Import only the Lucide icons you need

### Don't

- Don't use `focus-visible:ring-ring` until `--ring` is defined (use `focus-visible:ring-blue-500` instead)
- Don't hardcode colors — use Tailwind's zinc/blue/red scales
- Don't create custom CSS when utilities suffice
- Don't use `text-glow` — it's currently a no-op
- Don't assume light-only rendering
- Don't animate layout properties (`width`, `height`, `padding`)
- Don't add opacity-modifier utilities without a `@supports` fallback for older browsers
- Don't use inline styles for theme values — use `dark:` variants
- Don't set `type="submit"` as default on buttons (use `type="button"`)
- Don't approximate skeleton layouts — match the real component structure

### Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Component files | PascalCase | `VenueCard.tsx`, `ThemeProvider.tsx` |
| Hook files | camelCase with `use` prefix | `useScrollProgress.ts` |
| CSS classes | kebab-case | `glass-card`, `glow-blue`, `animate-fadeInUp` |
| CSS variables | kebab-case with `--` prefix | `--background`, `--foreground` |
| Tailwind theme vars | `--color-*`, `--font-*` | `--color-background`, `--font-sans` |

### Component Composition

```tsx
// Preferred: compose primitives
<div className="space-y-2">
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" />
</div>

// Preferred: use cn() for conditional classes
<Button
  className={cn("w-full", isActive && "ring-2 ring-blue-500")}
>
  Submit
</Button>
```

### Performance

- Lazy-load heavy components with `React.lazy` and `Suspense`
- Use `framer-motion`'s `layout` prop for smooth layout animations
- Avoid animating `filter` and `backdrop-filter` on many simultaneous elements
- Keep `will-change` usage to elements currently animating
- Use `transform` and `opacity` for animations (GPU-accelerated)
- Tree-shake Lucide icons by importing individually

---

## Examples

### Dashboard Card

```tsx
import { Button } from "@/components/ui/button";
import { MapPin, Coffee } from "lucide-react";

<div className="glass-card rounded-2xl p-6">
  <div className="flex items-center gap-3 mb-4">
    <div className="p-2 bg-blue-500/10 rounded-xl">
      <Coffee className="w-5 h-5 text-blue-500" />
    </div>
    <div>
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
        Morning Coffee Spot
      </h3>
      <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
        <MapPin className="w-3 h-3" />
        Downtown, 0.3 mi
      </p>
    </div>
  </div>
  <div className="flex items-center gap-2 mb-4">
    <span className="px-2 py-1 text-xs bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
      Fast WiFi
    </span>
    <span className="px-2 py-1 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-full">
      Quiet
    </span>
  </div>
  <Button variant="outline" size="sm" className="w-full">
    View Details
  </Button>
</div>
```

### Form

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

<form className="space-y-4 max-w-md">
  <div className="space-y-2">
    <Label htmlFor="name">Workspace Name</Label>
    <Input id="name" placeholder="e.g., The Coffee Bean" />
  </div>
  <div className="space-y-2">
    <Label htmlFor="address">Address</Label>
    <Input id="address" placeholder="123 Main St" />
  </div>
  <div className="flex gap-3">
    <Button type="button" variant="outline">Cancel</Button>
    <Button type="submit">Save Workspace</Button>
  </div>
</form>
```

### Navigation

```tsx
import { TopNav } from "@/components/TopNav";
import SiteFooter from "@/components/site-footer";

<div className="min-h-screen flex flex-col">
  <TopNav />
  <main className="flex-1 container mx-auto px-6 sm:px-10 py-8">
    {/* Page content */}
  </main>
  <SiteFooter />
</div>
```

### Dark Mode Card

```tsx
// Automatically adapts via dark: variants
<div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xl">
  <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">
    Dark Mode Ready
  </h3>
  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-2">
    This card automatically adapts to the current theme.
  </p>
</div>
```

### Glassmorphism

```tsx
// TopNav-style glass effect
<nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/70 dark:bg-black/40 border-b border-zinc-200/80 dark:border-white/5">
  <div className="container mx-auto px-6 h-16 flex items-center">
    <span className="text-lg font-bold">WorkSphere</span>
  </div>
</nav>

// Glass card
<div className="glass-card rounded-2xl p-6">
  <p>Content with glass styling</p>
</div>

// Modal backdrop with glass
<div className="fixed inset-0 z-50 flex items-center justify-center">
  <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm" />
  <div className="relative bg-white dark:bg-zinc-900 rounded-3xl p-6 shadow-2xl">
    <p>Modal content</p>
  </div>
</div>
```

### Responsive Layout

```tsx
// Mobile-first grid
<div className="grid gap-6 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
  {venues.map((venue) => (
    <div key={venue.id} className="glass-card rounded-2xl p-4">
      <h4 className="font-semibold text-zinc-900 dark:text-white">{venue.name}</h4>
    </div>
  ))}
</div>

// Responsive padding
<section className="px-4 sm:px-6 md:px-10 py-8 md:py-12">
  <h2 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white">
    Find Your Workspace
  </h2>
</section>
```

### Skeleton Loading State

```tsx
import { VenueCardSkeleton, VenueListSkeleton } from "@/components/ui/skeleton";

// Single skeleton
<VenueCardSkeleton />

// List with 5 items
<VenueListSkeleton count={5} />

// Custom skeleton
<div className="space-y-3">
  <Skeleton className="h-6 w-48" />
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-3/4" />
</div>
```

### Toast Notifications

```tsx
import { useToast } from "@/components/ui/Toast";

function VenueActions() {
  const { toast } = useToast();

  const handleSave = async () => {
    try {
      await saveVenue();
      toast("Venue saved successfully!");
    } catch {
      toast("Failed to save venue", "error");
    }
  };

  return <Button onClick={handleSave}>Save Venue</Button>;
}
```

### Error Boundary

```tsx
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";

<ErrorBoundary
  fallback={
    <div className="text-center p-8">
      <p className="text-zinc-600 dark:text-zinc-400 mb-4">Something went wrong</p>
      <Button onClick={() => window.location.reload()}>Reload</Button>
    </div>
  }
>
  <VenueMap />
</ErrorBoundary>
```

---

## Related Documentation

| Document | Description |
|----------|-------------|
| [`STYLING_SYSTEM.md`](./STYLING_SYSTEM.md) | Tailwind v4 setup and global styling configuration |
| [`DESIGN_SYSTEM_TOKENS.md`](./DESIGN_SYSTEM_TOKENS.md) | CSS custom properties and token catalog |
| [`UI_SPACING_TOKENS.md`](./UI_SPACING_TOKENS.md) | Spacing tokens, component reference, and housekeeping notes |
| [`COLOR_PALETTE.md`](./COLOR_PALETTE.md) | HSL color palette definitions |
| [`TAILWIND_V4_GUIDE.md`](./TAILWIND_V4_GUIDE.md) | Comprehensive Tailwind CSS v4 styling guide |
| [`TAILWIND_V4_LAYOUTS.md`](./TAILWIND_V4_LAYOUTS.md) | Layout patterns and CSS variable usage |
| [`FRAMER_MOTION_GUIDE.md`](./FRAMER_MOTION_GUIDE.md) | Framer Motion animation patterns |
| [`ANIMATION_STANDARDS.md`](./ANIMATION_STANDARDS.md) | Animation timing and easing standards |
| [`RESPONSIVE_DESIGN_STANDARDS.md`](./RESPONSIVE_DESIGN_STANDARDS.md) | Responsive design strategy and breakpoints |
| [`ACCESSIBILITY_GUIDELINE.md`](./ACCESSIBILITY_GUIDELINE.md) | Accessibility standards for custom modals |
| [`ICON_USAGE-GUIDE.md`](./ICON_USAGE-GUIDE.md) | Lucide React icon usage guide |

