# Icon Usage Guide

## Overview

WorkSphere uses **Lucide React** as its primary icon library. Icons are imported as individual React components, providing tree-shaking, consistency, and a lightweight bundle. :contentReference[oaicite:0]{index=0}

---

## Icon Library

```tsx
import { AlertCircle, Loader2, MapPin } from "lucide-react";
```

Import only the icons required by a component to keep bundles optimized.

---

## Naming Convention

Use the original **PascalCase** names provided by Lucide.

Examples:

- `AlertCircle`
- `Loader2`
- `MapPin`
- `ArrowRight`
- `Trash2`
- `Copy`
- `CheckCircle2`

Avoid renaming imported icons unless absolutely necessary.

---

## Preferred Icon Sizes

| Context | Size |
|---------|------|
| Small inline icons | 16px |
| Buttons & navigation | 20px |
| Page headers / feature icons | 24px |

When using Tailwind classes:

| Size | Tailwind |
|------|----------|
| 16px | `w-4 h-4` |
| 20px | `w-5 h-5` |
| 24px | `w-6 h-6` |

Prefer Tailwind utility classes for sizing instead of hardcoding pixel values.

Example:

```tsx
<AlertCircle className="w-4 h-4" />
```

---

## Color Usage

Icons inherit color from the project's design system.

Common utility classes include:

- `text-primary`
- `text-foreground`
- `text-muted-foreground`

Avoid hardcoded colors whenever possible.

Example:

```tsx
<MapPin className="w-5 h-5 text-primary" />
```

---

## Stroke Width

Lucide icons use a stroke-based design.

The project commonly uses:

```tsx
strokeWidth={2}
```

or the default Lucide stroke width.

Only increase stroke width when stronger visual emphasis is required.

---

## Best Practices

- Import only the icons you use.
- Keep icon sizes consistent across similar UI elements.
- Use semantic color utilities instead of fixed colors.
- Prefer Tailwind sizing utilities (`w-* h-*`).
- Maintain consistent spacing between icons and labels.

---

## Adding a New Icon

1. Import the icon from `lucide-react`.

```tsx
import { Bell } from "lucide-react";
```

2. Apply the preferred size.

```tsx
<Bell className="w-4 h-4" />
```

3. Apply a semantic color if needed.

```tsx
<Bell className="w-4 h-4 text-primary" />
```

4. Keep naming consistent with the official Lucide icon names.

---

## Example

```tsx
import { Search } from "lucide-react";

export function SearchButton() {
  return (
    <button className="flex items-center gap-2">
      <Search className="w-4 h-4 text-primary" />
      Search
    </button>
  );
}
```