# Global Styling System & CSS Custom Variables Guide

This document catalogs the design token structure, utility class naming standards, and responsive boundary conditions implemented across the global rendering layouts.

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

## Glassmorphism Template

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

## Shadow Guidelines

The design system uses both Tailwind shadow utilities and custom glow effects.

| Style       | Common Usage                                         |
| ----------- | ---------------------------------------------------- |
| `shadow-xl` | Elevated cards and panels                            |
| `glow-blue` | Blue glow effect for highlighted UI elements         |
| `pulseGlow` | Animated glow used to emphasize interactive elements |

---

## Color Palette

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

## Typography Guidelines

The project commonly uses the following typography utilities.

| Utility     | Common Usage                               |
| ----------- | ------------------------------------------ |
| `text-sm`   | Labels, helper text, and secondary content |
| `text-base` | Default body text                          |
| `text-lg`   | Section headings and emphasized content    |

---

## Spacing Guidelines

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

## Backdrop Guidelines

The project uses Tailwind backdrop blur utilities to create translucent, glass-style interfaces.

| Utility            | Common Usage                                |
| ------------------ | ------------------------------------------- |
| `backdrop-blur-sm` | Subtle overlays and lightweight UI elements |
| `backdrop-blur-md` | Cards and floating panels                   |
| `backdrop-blur-xl` | Full-screen modals and dialogs              |

Backdrop blur utilities are commonly combined with semi-transparent backgrounds, borders, and shadows to achieve the project's glassmorphism design.
