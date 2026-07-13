# Tailwind CSS v4 Guide

## Overview

WorkSphere uses Tailwind CSS as its primary styling framework to build a consistent, responsive, and maintainable user interface.

With Tailwind CSS v4, styling becomes even more streamlined through improved theme configuration, CSS-first customization, and modern utility generation. Instead of scattering design values throughout the codebase, the project should rely on reusable design tokens and shared styling conventions.

This guide explains how styling should be implemented across WorkSphere. It covers design tokens, CSS variables, Tailwind CSS v4 features, responsive layouts, and recommended development practices for contributors.

The goal is to ensure that every new component feels visually consistent with the rest of the application while remaining easy to maintain.

---

# Goals

This guide aims to:

- Establish consistent styling conventions across the project.
- Document the project's design token system.
- Explain how Tailwind CSS v4 should be used.
- Encourage reusable utility classes instead of duplicated styles.
- Improve maintainability for future contributors.
- Keep responsive layouts predictable across all screen sizes.

---

# Why Tailwind CSS v4

Tailwind CSS v4 introduces a CSS-first configuration model that reduces complexity and improves developer experience.

Some advantages include:

- Faster compilation.
- Simpler configuration.
- Better CSS variable integration.
- Improved maintainability.
- Cleaner customization.
- Reduced configuration overhead.

Rather than relying heavily on JavaScript configuration files, many design decisions can now be expressed directly in CSS.

---

# Styling Philosophy

Every component in WorkSphere should follow a few simple principles.

## Consistency

Components that serve similar purposes should share similar spacing, typography, borders, and colors.

Users should immediately recognize interactive elements throughout the application.

---

## Reusability

Avoid creating custom styles for every page.

Instead, reuse:

- Existing utility classes
- Shared components
- Design tokens
- Theme variables

This keeps the codebase easier to maintain.

---

## Accessibility

Styling decisions should improve usability rather than only appearance.

Examples include:

- Sufficient color contrast
- Visible focus states
- Readable font sizes
- Consistent spacing
- Keyboard-friendly interactions

---

## Scalability

As the project grows, new pages should naturally fit into the existing design system.

A contributor should rarely need to invent an entirely new visual style for common UI elements.

---

# CSS-First Configuration

Tailwind CSS v4 encourages defining design values directly in CSS.

Instead of scattering colors or spacing values across components, they should be declared as reusable theme variables.

Example:

```css
@theme {
  --color-brand: #2563eb;
  --color-surface: #ffffff;
  --radius-card: 16px;
}
```

Once defined, these values can be reused throughout the application.

This approach keeps styling centralized and makes future theme updates much easier.

---

# Design Tokens

Design tokens represent the visual language of the application.

Rather than hardcoding values repeatedly, reusable tokens should define:

- Colors
- Typography
- Border radius
- Shadows
- Spacing
- Animation durations

Using tokens creates a consistent experience while reducing maintenance effort.

---

# Token Categories

The WorkSphere design system primarily relies on the following token groups:

| Category | Purpose |
|----------|---------|
| Colors | Brand, text, backgrounds |
| Borders | Radius, border colors |
| Shadows | Cards, dialogs, dropdowns |
| Typography | Font sizes and weights |
| Spacing | Margins and padding |
| Motion | Animations and transitions |

Each category should remain centralized rather than duplicated across multiple files.

---

# General Styling Principles

When creating new UI components:

- Prefer utility classes over custom CSS.
- Reuse existing spacing values.
- Follow the established typography scale.
- Use semantic colors instead of arbitrary values.
- Keep components responsive by default.
- Avoid unnecessary CSS overrides.

Following these principles helps maintain a cohesive design system as the project evolves.

---

# CSS Variables

Tailwind CSS v4 adopts a CSS-first approach where design tokens are defined as CSS variables instead of being scattered across components.

Using CSS variables provides several advantages:

- Centralized design values
- Easier theme customization
- Better dark mode support
- Improved maintainability
- Consistent styling across the application

Whenever a visual value is reused multiple times, it should be represented as a shared variable instead of being hardcoded.

---

# Theme Tokens

Theme tokens define the visual identity of the application.

Typical token categories include:

- Brand colors
- Background colors
- Surface colors
- Border colors
- Typography
- Shadows
- Border radius
- Spacing
- Animation durations

Rather than repeating literal values throughout components, developers should reference shared tokens.

Example:

```css
@theme {
    --color-brand: #2563eb;
    --color-success: #16a34a;
    --color-warning: #f59e0b;
    --color-danger: #dc2626;
}
```

Once declared, these tokens become reusable throughout the application.

---

# Background Tokens

Background colors should be semantic rather than descriptive.

Instead of naming variables after specific colors, prefer names that describe their purpose.

Recommended examples:

```css
@theme {
    --color-background: #ffffff;
    --color-surface: #f8fafc;
    --color-surface-hover: #f1f5f9;
    --color-card: #ffffff;
    --color-card-hover: #f9fafb;
}
```

Using semantic names makes future theme updates significantly easier.

For example, changing the application's primary surface color only requires updating a single token instead of modifying dozens of components.

---

# Border Tokens

Borders should also rely on shared design tokens.

Example:

```css
@theme {
    --color-border: #e4e4e7;
    --color-border-muted: #f1f5f9;
    --color-border-strong: #d4d4d8;
}
```

This approach ensures every component uses consistent border styling.

Avoid manually selecting slightly different gray shades across multiple files.

---

# Typography Tokens

Typography should remain consistent throughout the application.

Recommended tokens include:

```css
@theme {
    --font-sans: Inter, sans-serif;
    --font-mono: JetBrains Mono, monospace;
}
```

Typography-related utilities should reuse these values instead of introducing new font families inside individual components.

---

# Radius Tokens

Rounded corners should follow a consistent scale.

Example:

```css
@theme {
    --radius-sm: 6px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 24px;
}
```

Cards, dialogs, buttons, and dropdowns should reuse these values.

---

# Shadow Tokens

Shadow values should also remain centralized.

Example:

```css
@theme {
    --shadow-card: 0 8px 24px rgba(0,0,0,.08);
    --shadow-dropdown: 0 12px 32px rgba(0,0,0,.12);
}
```

Keeping shadows consistent improves the overall visual hierarchy.

---

# Spacing Tokens

Spacing should follow a predictable scale.

Rather than using arbitrary spacing values, components should rely on the project's spacing system.

Examples include:

- xs
- sm
- md
- lg
- xl

Using a consistent spacing scale makes layouts easier to scan and maintain.

---

# Light and Dark Themes

Tailwind CSS v4 works naturally with CSS variables, making theme switching significantly easier. Theme values can be overridden for dark mode without changing component markup. :contentReference[oaicite:1]{index=1}

Example:

```css
:root {
    --color-background: #ffffff;
    --color-text: #18181b;
}

.dark {
    --color-background: #09090b;
    --color-text: #fafafa;
}
```

Components should consume these variables instead of directly referencing fixed color values.

---

# Using @theme

Tailwind CSS v4 introduces the `@theme` directive for defining design tokens directly in CSS. These tokens are exposed as CSS variables and are available throughout the application. :contentReference[oaicite:2]{index=2}

Example:

```css
@theme {
    --color-primary: #2563eb;
    --color-secondary: #0f172a;
    --spacing-content: 1.5rem;
}
```

This keeps theme configuration close to the styles that use it and reduces the need for large JavaScript configuration files.

---

# Token Naming Guidelines

Choose names based on purpose rather than appearance.

Preferred:

```
--color-background
--color-card
--color-border
--color-text
--color-primary
```

Avoid:

```
--blue
--gray1
--gray2
--dark-blue
```

Semantic naming improves readability and makes future redesigns much easier.

---

# Organizing Theme Variables

As the application grows, theme variables should remain organized by category.

A recommended structure is:

```
Colors
Typography
Spacing
Borders
Radius
Shadows
Motion
```

Keeping related variables grouped together makes maintenance easier and helps contributors quickly locate the values they need.

---

# General Recommendations

When defining new styling tokens:

- Prefer semantic names over literal color names.
- Reuse existing variables whenever possible.
- Avoid duplicate values.
- Keep theme definitions centralized.
- Document new tokens before introducing them.
- Ensure new variables work correctly in both light and dark themes.

Following these practices keeps the design system predictable, scalable, and easier for future contributors to understand.

---

# Responsive Design Standards

WorkSphere follows a mobile-first design approach.

Every new component should provide a usable experience on smaller screens before additional layouts are introduced for larger devices.

Layouts should progressively enhance as screen size increases instead of relying on desktop-first assumptions.

---

# Recommended Breakpoints

Tailwind CSS provides responsive variants that should be used consistently across the project.

| Breakpoint | Typical Devices |
|------------|-----------------|
| sm | Small phones / large phones |
| md | Tablets |
| lg | Small laptops |
| xl | Desktop |
| 2xl | Large desktop displays |

Avoid creating custom breakpoints unless there is a clear project requirement.

---

# Mobile First Development

Components should always be written with mobile layouts as the default.

Example:

```html
<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
```

Instead of overriding desktop layouts for mobile, build the smallest layout first and expand it using responsive modifiers.

---

# Grid Layout Recommendations

Use CSS Grid whenever displaying collections of content.

Examples include:

- Venue cards
- Booking history
- Dashboard widgets
- Analytics panels
- Search results

Example:

```html
<div class="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
```

Grid layouts should maintain equal spacing and consistent alignment across all screen sizes.

---

# Flex Layout Recommendations

Flexbox is better suited for arranging content in a single direction.

Recommended use cases:

- Navigation bars
- Button groups
- Toolbars
- Filter chips
- User profile sections

Example:

```html
<div class="flex flex-col md:flex-row items-center justify-between gap-4">
```

Choose Grid for two-dimensional layouts and Flexbox for one-dimensional layouts.

---

# Container Width

Content should not stretch across extremely wide displays.

Use a centered container with consistent horizontal padding.

Example:

```html
<div class="mx-auto max-w-7xl px-6">
```

Keeping content within a readable width improves usability and visual balance.

---

# Responsive Spacing

Spacing should increase gradually as screen size grows.

Avoid manually specifying unrelated spacing values for different pages.

Instead, follow a consistent spacing scale throughout the project.

Example:

```html
<div class="p-4 md:p-6 xl:p-8">
```

---

# Responsive Typography

Text should remain readable across all devices.

Example:

```html
<h1 class="text-2xl md:text-4xl font-bold">
```

Avoid excessively large headings on mobile devices.

---

# Responsive Images

Images should scale naturally without distortion.

Recommended utilities include:

```html
<img
  class="w-full h-auto rounded-xl object-cover"
/>
```

Images inside cards should maintain consistent aspect ratios whenever possible.

---

# Component Consistency

Common UI elements should share the same spacing, radius, and typography.

Examples include:

- Buttons
- Cards
- Dialogs
- Dropdowns
- Input fields
- Navigation menus

Users should immediately recognize these components regardless of where they appear.

---

# Tailwind v4 Best Practices

When writing Tailwind CSS v4 code:

- Prefer utility classes over custom CSS.
- Reuse existing design tokens.
- Keep component styling simple.
- Avoid deeply nested utility combinations.
- Use semantic CSS variables through `@theme`.
- Remove duplicate utility patterns whenever possible.

---

# Example Card

```html
<div class="rounded-xl border bg-background p-6 shadow-sm">
    <h2 class="text-xl font-semibold">
        WorkSphere
    </h2>

    <p class="mt-2 text-sm text-muted-foreground">
        Example responsive card.
    </p>

    <button
        class="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700">
        Continue
    </button>
</div>
```

This demonstrates a clean component that follows the project's styling conventions.

---

# Migration Notes

When updating older components:

- Replace duplicated colors with theme variables.
- Prefer shared design tokens.
- Remove unnecessary custom CSS.
- Simplify repeated utility combinations.
- Verify responsive behavior after migration.

Migration should improve consistency rather than only changing syntax.

---

# Conclusion

Following these guidelines helps maintain a consistent styling system throughout WorkSphere.

By using shared design tokens, CSS variables, Tailwind CSS v4 features, and responsive design principles, contributors can build interfaces that are easier to maintain, visually consistent, and adaptable to future design changes.

All new components should follow these recommendations to ensure a unified experience across the application.