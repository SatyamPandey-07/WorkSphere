# Global Styling System & CSS Custom Variables Guide

This document catalogs the design token structure, utility class naming standards, and responsive boundary conditions implemented across the global rendering layouts.

---

## 1. CSS Custom Variables & Theme Tokens

The layout uses custom properties mounted to the `:root` pseudo-class for system-wide light/dark theme tracking. Dark mode variables are injected via the `.dark` class hook.

### Core Token Palette

| Token Name | Light Mode Value | Dark Mode Value | Operational Context |
| :--- | :--- | :--- | :--- |
| `--background` | `#ffffff` | `#09090b` (`zinc-950`) | Global page viewport default background |
| `--card` | `#f4f4f5` (`zinc-100`) | `#18181b` (`zinc-900`) | Workspace display cards, panels, and dialog surfaces |
| `--border` | `#e4e4e7` (`zinc-200`) | `#27272a` (`zinc-800`) | Standard layout component dividing grid borders |
| `--glow-primary` | `rgba(37, 99, 235, 0.1)` | `rgba(37, 99, 235, 0.4)` | AI-chatbot response accents and search glowing borders |
| `--glow-success` | `rgba(34, 197, 94, 0.1)` | `rgba(34, 197, 94, 0.4)` | Verified active geofenced check-in indicator overlays |

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