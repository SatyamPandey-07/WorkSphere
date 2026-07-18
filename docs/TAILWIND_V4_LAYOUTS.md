# Tailwind CSS v4 Layouts & CSS Variables Guide

This guide details the transition to **Tailwind CSS v4** within the WorkSphere project, focusing on the shift from utility-heavy styling to a **CSS-first configuration** model using layout tokens and custom CSS variables.

---

## 1. The Transition to Tailwind CSS v4

Tailwind CSS v4 introduces a revolutionary approach to styling by moving configuration from JavaScript (`tailwind.config.js`) directly into CSS. This change streamlines the development process, improves performance, and leverages modern CSS features like native variables.

### Key Differences in v4

| Feature           | Tailwind CSS v3                          | Tailwind CSS v4                   |
| :---------------- | :--------------------------------------- | :-------------------------------- |
| **Configuration** | `tailwind.config.js` (JavaScript)        | `@theme` block in CSS             |
| **Variables**     | Manually synced with CSS                 | Automatic CSS variable generation |
| **Engine**        | PostCSS-based                            | Lightning CSS (Rust-based)        |
| **Directives**    | `@tailwind base`, `@tailwind components` | `@import "tailwindcss"`           |

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

| Old Utility Style | New CSS Variable Pattern | Purpose                |
| :---------------- | :----------------------- | :--------------------- |
| `bg-white`        | `var(--background)`      | Global page background |
| `text-zinc-950`   | `var(--foreground)`      | Primary text color     |
| `border-zinc-200` | `var(--border)`          | Component borders      |
| `shadow-xl`       | `var(--shadow-card)`     | Elevated card surfaces |

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

| Token            | Value    | Context                         |
| :--------------- | :------- | :------------------------------ |
| `--spacing-page` | `2rem`   | Main container padding          |
| `--grid-gap`     | `1.5rem` | Standard gap between grid items |
| `--radius-card`  | `1rem`   | Border radius for main UI cards |

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

## 7. v4 Specific Layout Configurations

### Border Spacing Tokens

- Utilize the new `--spacing-` variables to manage consistent margins and padding across layouts.
- For border-spacing in tables or grid layouts, rely strictly on the native v4 spacing scale (e.g., `border-spacing-4`) rather than arbitrary values.

### Transition Classes

- Apply standard v4 transition classes (`transition-all ease-in-out duration-300`) for smooth UI interactions.
- Rely on the default CSS variable transitions provided by Tailwind (e.g., `--default-transition-timing-function` and `--default-transition-duration`) rather than hardcoding cubic-bezier curves in JS.

### Flex Configurations

- Standard flexbox layouts should avoid arbitrary gap values.
- Stick to predefined variables (like `--grid-gap`) and responsive native utility classes (like `gap-4 md:gap-6`) to ensure flex children scale proportionally across viewports.

### Theme Selector State Overrides

- Ensure dark mode and custom theme selectors properly override default styling using the new v4 CSS syntax.
- Use the `dark:` variant mapped to the specific `--color-` overrides defined in your `@theme` block, avoiding manual `#hex` toggles in the markup.

---

## Summary

The transition to Tailwind CSS v4 in WorkSphere emphasizes a **CSS-native** approach. By centralizing our design tokens in the `@theme` block and utilizing custom utility layers, we ensure a high-performance, maintainable, and visually cohesive design system.

---

## 7. Layout Container Configuration

WorkSphere follows a consistent responsive layout pattern using Tailwind CSS utility classes. Most pages use the `container` utility combined with `mx-auto` to center content and responsive padding utilities to maintain spacing across different screen sizes.

### Common Container Pattern

```tsx
<div className="container mx-auto px-4 sm:px-6">{/* Page Content */}</div>
```

### Frequently Used Layout Utilities

| Utility        | Purpose                                       |
| :------------- | :-------------------------------------------- |
| `container`    | Provides a responsive content wrapper         |
| `mx-auto`      | Horizontally centers the container            |
| `max-w-*`      | Limits content width for improved readability |
| `px-4`, `px-6` | Horizontal page padding                       |
| `py-*`         | Vertical spacing for sections                 |

### Recommendations

- Use `container mx-auto` for page-level layouts.
- Apply `max-w-*` utilities when restricting content width.
- Maintain consistent spacing using responsive padding utilities.

---

## 8. Grid Token Reference

WorkSphere primarily relies on Tailwind CSS Grid utilities for responsive layouts.

### Grid Utilities

| Utility       | Purpose                            |
| :------------ | :--------------------------------- |
| `grid`        | Enables CSS Grid                   |
| `grid-cols-*` | Defines number of columns          |
| `col-span-*`  | Controls column span               |
| `gap-*`       | Defines spacing between grid items |

### Common Grid Patterns

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
```

```tsx
<div className="grid grid-cols-2 gap-4">
```

Responsive layouts typically use breakpoint modifiers such as:

- `sm:`
- `md:`
- `lg:`
- `xl:`

to progressively increase the number of columns across screen sizes.

---

## 9. Border Configuration

Borders are consistently used throughout the application to separate content while maintaining the project's clean visual style.

### Common Border Utilities

| Utility        | Purpose                     |
| :------------- | :-------------------------- |
| `border`       | Standard component border   |
| `rounded-lg`   | Medium rounded corners      |
| `rounded-xl`   | Large rounded corners       |
| `rounded-2xl`  | Extra large rounded corners |
| `rounded-3xl`  | Large card containers       |
| `rounded-full` | Circular elements           |

Borders are frequently combined with:

- Glassmorphism utilities
- Shadow utilities
- Background opacity utilities

to create reusable UI components.

---

## 10. Transition Styles

Interactive elements use Tailwind transition utilities to provide smooth animations and hover effects.

### Transition Utilities

| Utility                | Purpose                          |
| :--------------------- | :------------------------------- |
| `transition-all`       | Animate all supported properties |
| `transition-colors`    | Animate color changes            |
| `transition-shadow`    | Animate shadow effects           |
| `transition-transform` | Animate transform properties     |

### Transition Durations

The project commonly uses:

| Utility        | Duration             |
| :------------- | :------------------- |
| `duration-200` | Fast interactions    |
| `duration-300` | Standard transitions |
| `duration-500` | Smooth animations    |
| `duration-700` | Longer UI animations |

### Easing Utilities

Frequently used easing functions include:

- `ease-in-out`
- `ease-out`

### Example

```tsx
<button className="transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-lg">
  Submit
</button>
```

### Best Practices

- Use `transition-colors` for buttons and links.
- Use `transition-shadow` when animating elevation.
- Use `transition-transform` for movement and scaling effects.
- Keep transition durations consistent across similar components.
