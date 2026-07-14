# Tailwind CSS v4 Layouts & CSS Variables Guide

This guide details the transition to **Tailwind CSS v4** within the WorkSphere project, focusing on the shift from utility-heavy styling to a **CSS-first configuration** model using layout tokens and custom CSS variables.

---

## 1. The Transition to Tailwind CSS v4

Tailwind CSS v4 introduces a revolutionary approach to styling by moving configuration from JavaScript (`tailwind.config.js`) directly into CSS. This change streamlines the development process, improves performance, and leverages modern CSS features like native variables.

### Key Differences in v4
| Feature | Tailwind CSS v3 | Tailwind CSS v4 |
| :--- | :--- | :--- |
| **Configuration** | `tailwind.config.js` (JavaScript) | `@theme` block in CSS |
| **Variables** | Manually synced with CSS | Automatic CSS variable generation |
| **Engine** | PostCSS-based | Lightning CSS (Rust-based) |
| **Directives** | `@tailwind base`, `@tailwind components` | `@import "tailwindcss"` |

---

## 2. CSS-First Layout Tokens

In WorkSphere, we use the `@theme` directive to define our design tokens. These tokens are automatically exposed as CSS variables, allowing for a more predictable and maintainable layout system.

### Core Layout Variables
The following variables are defined in `src/app/globals.css` and represent the foundational layout tokens for the application:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}
```

### Transitioning Utility Styles to CSS Variables
Instead of hardcoding colors or spacing in every component, we map them to semantic variables. This allows us to update the entire application's look by changing a single value in `globals.css`.

| Old Utility Style | New CSS Variable Pattern | Purpose |
| :--- | :--- | :--- |
| `bg-white` | `var(--background)` | Global page background |
| `text-zinc-950` | `var(--foreground)` | Primary text color |
| `border-zinc-200` | `var(--border)` | Component borders |
| `shadow-xl` | `var(--shadow-card)` | Elevated card surfaces |

---

## 3. Custom Utility Mappings

WorkSphere leverages the `@layer utilities` directive to create custom, reusable utility classes that combine multiple Tailwind utilities into semantic hooks.

### Glassmorphism & Glow Effects
We have defined several custom utilities to maintain a consistent "modern" aesthetic:

```css
@layer utilities {
  .glass-card {
    @apply bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xl;
  }

  .glow-blue {
    box-shadow: 0 0 20px rgba(59, 130, 246, 0.3);
  }

  .animate-gradient {
    animation: gradient 6s ease infinite;
  }
}
```

### Usage in Components
When building new components, prioritize using these custom utilities to ensure visual consistency:

```tsx
// Preferred approach
<div className="glass-card animate-fadeInUp">
  <h2 className="glow-blue">Workspace Name</h2>
</div>
```

---

## 4. Layout Token Reference

To maintain a consistent layout, use the following token mappings for spacing, borders, and effects.

### Spacing & Grid Tokens
| Token | Value | Context |
| :--- | :--- | :--- |
| `--spacing-page` | `2rem` | Main container padding |
| `--grid-gap` | `1.5rem` | Standard gap between grid items |
| `--radius-card` | `1rem` | Border radius for main UI cards |

### Responsive Breakpoints
WorkSphere uses the standard Tailwind v4 breakpoints for layout transitions:
- `sm`: 640px (Mobile)
- `md`: 768px (Tablet)
- `lg`: 1024px (Laptop)
- `xl`: 1280px (Desktop)

---

## 5. Fallback Strategy for Older Engines

Tailwind v4 uses `color-mix()` internally for opacity modifiers (e.g., `bg-blue-700/10`). For older browser engines (like some Android WebView versions), we provide explicit fallbacks in `globals.css`:

```css
@supports not (background: color-mix(in oklab, red, red)) {
  .bg-blue-700\/10 {
    background-color: rgba(29, 78, 216, 0.1);
  }
  /* Additional fallbacks defined in globals.css */
}
```

---

## 6. Best Practices for Contributors

1. **Use Semantic Tokens**: Avoid using arbitrary values like `bg-[#f0f0f0]`. Use `bg-background` or `bg-card` instead.
2. **CSS-First**: If you need a new theme value, add it to the `@theme` block in `globals.css` rather than a JavaScript config.
3. **Mobile-First**: Always write your default classes for mobile and use `md:`, `lg:`, etc., for larger screens.
4. **Prefer Custom Utilities**: Use `.glass-card` instead of repeating the background, border, and shadow classes manually.

---

## Summary

The transition to Tailwind CSS v4 in WorkSphere emphasizes a **CSS-native** approach. By centralizing our design tokens in the `@theme` block and utilizing custom utility layers, we ensure a high-performance, maintainable, and visually cohesive design system.
