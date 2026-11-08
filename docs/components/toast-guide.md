# Toast Component Reference & Integration Guide

## Overview

The `Toast` component (`src/components/ui/Toast.tsx`) provides lightweight, accessible, non-blocking feedback across WorkSphere. Designed in accordance with W3C WAI-ARIA and WCAG 2.1 Success Criterion 4.1.3 (Status Messages), it supports notification queuing, automatic dismissal timers, rate-limit countdowns, action buttons, inline deduplication, and assistive technology live regions.

---

## 1. Architecture & Provider Setup

The toast notification system uses React Context. Applications and page layouts must wrap component subtrees in `<ToastProvider>`.

### Setup in Layout (`src/app/layout.tsx`)

```tsx
import { ToastProvider } from "@/components/ui/Toast";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
```

---

## 2. API Reference: `useToast` Hook

The `useToast` hook exposes the primary notification dispatch function:

```tsx
import { useToast } from "@/components/ui/Toast";

const { toast } = useToast();
```

### Method Signature

```typescript
toast(
  message: string,
  type?: "success" | "error" | "warning",
  actionOrOptions?: { label: string; onClick: () => void } | ToastOptions,
  countdown?: number,
  idOrKey?: string
): void;
```

### Options (`ToastOptions`)

| Property | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `id` / `key` | `string` | Auto-generated UUID | Unique identifier. When provided, updates existing toast in-place rather than creating a new card. |
| `countdown` | `number` | `undefined` | Duration in seconds for dynamic countdown banners (e.g., rate-limit retries). |
| `action` | `{ label: string; onClick: () => void }` | `undefined` | Action button rendered below the notification text. |

---

## 3. Toast Types & Helper Patterns

WorkSphere supports three visual notification variants:

### 3.1 Success Toast (`type="success"`)
Displays a green checkmark icon (`CheckCircle2`). Used for completed operations like booking confirmations or saving favorites.

```tsx
// Standard success notification
toast("Venue added to favorites!", "success");

// Helper wrapper pattern
const toastSuccess = (msg: string) => toast(msg, "success");
toastSuccess("Profile updated successfully");
```

### 3.2 Error Toast (`type="error"`)
Displays a red error icon (`AlertCircle`). Announced assertively to screen readers. Used for API failures or invalid input.

```tsx
// Standard error notification
toast("Failed to reserve desk. Please try again.", "error");

// Helper wrapper pattern
const toastError = (msg: string) => toast(msg, "error");
toastError("Network connection lost");
```

### 3.3 Warning Toast (`type="warning"`)
Displays an amber warning icon (`AlertTriangle`). Used for non-fatal issues like low battery, network degradation, or unsaved changes.

```tsx
// Standard warning notification
toast("Weak WiFi connection detected at venue.", "warning");

// Helper wrapper pattern
const toastWarning = (msg: string) => toast(msg, "warning");
toastWarning("Storage quota approaching limit");
```

### 3.4 Informational Toast (`type="info"`)
Informational updates default to standard polite status messages.

```tsx
// Standard info notification
toast("Checking in to workspace...", "success");
```

---

## 4. Usage Examples & Recipes

### 4.1 Custom Action Buttons (e.g., Undo)

```tsx
import { useToast } from "@/components/ui/Toast";

export function FavoriteButton({ venueId }: { venueId: string }) {
  const { toast } = useToast();

  const handleRemove = async () => {
    await removeFavorite(venueId);

    toast("Removed from favorites", "warning", {
      label: "Undo",
      onClick: () => {
        addFavorite(venueId);
      },
    });
  };

  return <button onClick={handleRemove}>Remove Favorite</button>;
}
```

### 4.2 Deduplication with Deterministic Keys

Passing an `id` or `key` prevents multiple clicks from flooding the viewport:

```tsx
// Updates the existing toast in-place instead of stacking duplicates
toast("Exporting calendar event...", "warning", { id: "export-booking-123" });

// Later when complete:
toast("Calendar event downloaded!", "success", { id: "export-booking-123" });
```

### 4.3 Rate Limit Countdown Notifications

Countdown toasts calculate against a fixed target timestamp to maintain accuracy even when background tab timers are throttled:

```tsx
toast(
  "Rate limit reached. Retrying automatically in {countdown} seconds",
  "error",
  undefined,
  30 // 30-second countdown
);
```

---

## 5. Accessibility & ARIA Specifications

The Toast container adheres to WCAG 2.1 Level AA guidelines:

```html
<!-- Mounted persistently in DOM to ensure assistive technology observes additions -->
<div class="fixed bottom-6 right-6 z-[9999]" aria-label="Notifications">
  <!-- Assertive live region for critical errors -->
  <div aria-live="assertive" aria-relevant="additions text" data-testid="toast-region-assertive">
    <div role="alert" aria-live="assertive" aria-atomic="true">
      Booking failed
    </div>
  </div>

  <!-- Polite live region for success & warnings -->
  <div aria-live="polite" aria-relevant="additions text" data-testid="toast-region-polite">
    <div role="status" aria-live="polite" aria-atomic="true">
      Saved to favorites
    </div>
  </div>
</div>
```

### Accessibility Highlights
1. **Dual Persistent Live Regions:** `assertive` (for critical errors) and `polite` (for success and rate-limit countdowns) remain mounted in the DOM to avoid missed announcements.
2. **Non-Stealing Focus:** Toasts do not steal focus from form inputs or active buttons when announced.
3. **Interactive Hover & Focus Pause:** Hovering the mouse over a toast or focusing into it via keyboard (`Shift+Tab` or screen reader cursor) pauses auto-dismissal until interaction ends.
4. **Accessible Dismiss Button:** The close button features `aria-label="Dismiss notification"`.
5. **Decorative Icons:** Icons have `aria-hidden="true"` applied to eliminate redundant announcements.

---

## 6. Styling & Customization

Toasts are built with Tailwind CSS and CSS variables:
- **Light / Dark Mode:** Uses `bg-white/90 dark:bg-zinc-900/90` with backdrop blur (`backdrop-blur-md`).
- **Accent Tokens:** Action buttons utilize `bg-[var(--primary-accent)]` for brand alignment.
- **Animation:** Uses Tailwind transitions (`animate-in slide-in-from-right-full fade-in duration-300`).
