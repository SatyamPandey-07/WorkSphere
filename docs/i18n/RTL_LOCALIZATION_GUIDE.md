# Arabic & Hebrew Right-to-Left (RTL) Localization Contributor Guide

## Overview & Scope

WorkSphere supports global digital nomads across multilingual regions. To provide first-class accessibility and UX for native speakers of Right-to-Left (RTL) languages—specifically Arabic (`ar`) and Hebrew (`he`)—the frontend UI layout, typography, and interactive components adapt dynamically to text directionality.

This guide outlines logical CSS styling standards, direction toggling architecture, and translation contribution rules.

---

## Logical CSS Properties in Tailwind 4

When styling components, **never use directional physical properties** (`left`, `right`, `ml-*`, `mr-*`, `pl-*`, `pr-*`). Instead, always use CSS Logical Properties, which automatically mirror layouts when `dir="rtl"` is applied:

| Physical Utility (Avoid) | Logical Replacement (Use) | CSS Equivalent |
| :--- | :--- | :--- |
| `ml-*` (Margin Left) | `ms-*` (Margin Inline Start) | `margin-inline-start` |
| `mr-*` (Margin Right) | `me-*` (Margin Inline End) | `margin-inline-end` |
| `pl-*` (Padding Left) | `ps-*` (Padding Inline Start) | `padding-inline-start` |
| `pr-*` (Padding Right) | `pe-*` (Padding Inline End) | `padding-inline-end` |
| `left-*` (Absolute positioning) | `start-*` | `inset-inline-start` |
| `right-*` (Absolute positioning) | `end-*` | `inset-inline-end` |
| `text-left` | `text-start` | `text-align: start` |
| `text-right` | `text-end` | `text-align: end` |
| `border-l-*` | `border-s-*` | `border-inline-start` |
| `border-r-*` | `border-e-*` | `border-inline-end` |
| `rounded-l-*` | `rounded-s-*` | `border-start-start-radius`, `border-end-start-radius` |
| `rounded-r-*` | `rounded-e-*` | `border-start-end-radius`, `border-end-end-radius` |

### Icon Flipping for Directional Indicators
Navigation arrows, back chevrons, and pagination buttons must mirror in RTL mode:
```html
<!-- Chevron that points backward in both LTR (left) and RTL (right) -->
<ChevronRightIcon className="w-5 h-5 rtl:rotate-180 transition-transform" />
```

---

## Dynamic `dir="rtl"` Root Document Switching

WorkSphere utilizes `next-i18next` and custom locale route middleware. The root HTML element updates dynamically based on the active locale:

```typescript
// src/lib/i18n/direction.ts
export const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

export function getLanguageDirection(locale: string): "rtl" | "ltr" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}
```

In the root layout / document:
```tsx
import { getLanguageDirection } from "@/lib/i18n/direction";

export default function RootLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const dir = getLanguageDirection(locale);

  return (
    <html lang={locale} dir={dir}>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
```

---

## Contributor Translation Checklist

When adding or updating translations in `public/locales/ar/` or `public/locales/he/`:

- [ ] **Preserve Formatting Interpolations**: Keep parameterized tokens unchanged (e.g., `{{count}}`, `{{venueName}}`, `{{date}}`).
- [ ] **Bidirectional Text (BiDi) Isolation**: When displaying mixed Latin numbers or URLs inside Arabic/Hebrew prose, wrap variables in `<bdi>` tags to prevent punctuation reversal.
- [ ] **Avoid Embedded Directional Words**: Do not write strings like "Click on the left button" — use "Click on the previous button" or "Select the following option".
- [ ] **Test Responsive Modals & Drawers**: Ensure slide-over panels, chat sidebars, and dropdown menus emerge from the correct screen edge (`end-0` vs `start-0`).
- [ ] **Verify Typography & Readability**: Arabic and Hebrew fonts often require slightly increased line heights (`leading-relaxed` or `leading-loose`) to prevent diacritic clipping.
