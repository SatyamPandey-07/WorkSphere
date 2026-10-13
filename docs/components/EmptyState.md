# EmptyState Component Reference & Usage Guide

## Overview

The `EmptyState` component ([`src/components/ui/EmptyState.tsx`](file:///c:/Users/admin/Desktop/workfere/src/components/ui/EmptyState.tsx)) provides visual placeholder views when lists, collections, search queries, or chat histories contain zero items. Designed for responsive layouts and accessible user experiences, it features animated SVG illustrations with `useReducedMotion` support, concise titles, contextual descriptions, and flexible action buttons.

```mermaid
flowchart TD
    A[Data Stream / Query] --> B{Items Found?}
    B -- Yes --> C[Render Item Grid / List]
    B -- No / Empty --> D[EmptyState Component]
    D --> E[Illustration: search | collection | chat]
    D --> F[Header Message]
    D --> G[Description Text]
    D --> H[Action Trigger / CTA]
```

---

## 1. Props Reference

`EmptyState` accepts the following props:

| Prop | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `illustration` | `"search" \| "collection" \| "chat"` | **Yes** | — | Determines the animated SVG graphic displayed at the top of the card. |
| `message` | `string` | **Yes** | — | Primary bold heading summarizing the empty condition (e.g. `"No venues found"`). |
| `description` | `string` | No | `undefined` | Secondary guidance text suggesting next steps to the user. |
| `action` | `React.ReactNode` | No | `undefined` | Optional CTA element (such as a `<button>` or `<Link>`) rendered at the bottom. |

---

## 2. Illustration Variations

`EmptyState` provides three theme-tailored vector illustrations that seamlessly adapt to light and dark modes:

### 2.1 `"search"`
- **Visuals:** Grid radar coordinates, target crosshairs, center map pin, and sweeping magnifying glass.
- **Use Cases:** Zero search results, query filter mismatches, or venue directory searches with no active matches.

### 2.2 `"collection"`
- **Visuals:** Ambient halo, rising gold stars, layered document sheets, and animated folder flaps.
- **Use Cases:** Empty saved venue folders, user favorite collections, or blank bookmark lists.

### 2.3 `"chat"`
- **Visuals:** Floating speech bubbles with pulsing typing indicator dots and AI spark badge.
- **Use Cases:** Blank chat panel, cleared conversation history, or new discovery assistant sessions.

---

## 3. Motion & Accessibility (a11y)

- **Reduced Motion Conformance:** All animated SVG groups evaluate Framer Motion's `useReducedMotion()` hook. When users enable `prefers-reduced-motion: reduce` in their OS, continuous animations (`animate-ping`, `animate-pulse`, `animate-bounce`, and keyframe CSS transformations) are halted, and entrance transitions use immediate rendering (`scale: 1, y: 0`).
- **Semantic Hierarchy:** The `message` is rendered inside an `<h3>` heading with high contrast (`text-zinc-900 dark:text-white`), followed by an accessible description paragraph.
- **High Contrast Borders:** Uses `border border-zinc-200 dark:border-zinc-800/80` and `bg-white dark:bg-zinc-950` to maintain WCAG AA contrast against any container background.

---

## 4. Usage Examples

### 4.1 Search Zero-Results State

Displayed when no coworking venues match the user's active search term or filter parameters:

```tsx
import { EmptyState } from "@/components/ui/EmptyState";
import { Search, RotateCcw } from "lucide-react";

export function VenueSearchResults({ results, query, onResetFilters }) {
  if (results.length === 0) {
    return (
      <EmptyState
        illustration="search"
        message="No workspaces found"
        description={
          query
            ? `We couldn't find any venues matching "${query}". Try adjusting your radius or amenity filters.`
            : "No venues match the selected filters. Try broadening your criteria."
        }
        action={
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset all filters
          </button>
        }
      />
    );
  }

  return <div>{/* Render venue cards */}</div>;
}
```

---

### 4.2 Empty Saved Venues & Collections

Displayed when a user visits their saved workspaces folder before bookmarking any venues:

```tsx
import { EmptyState } from "@/components/ui/EmptyState";
import Link from "next/link";
import { Compass } from "lucide-react";

export function SavedVenuesList({ savedVenues }) {
  if (savedVenues.length === 0) {
    return (
      <EmptyState
        illustration="collection"
        message="Your collection is empty"
        description="Save your favorite coworking spots, cafes with power outlets, and quiet study halls to access them quickly."
        action={
          <Link
            href="/ai"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-all shadow-md active:scale-95"
          >
            <Compass className="w-3.5 h-3.5" />
            Explore Workspaces
          </Link>
        }
      />
    );
  }

  return <div>{/* Render saved items */}</div>;
}
```

---

### 4.3 Offline / Connection Error State

Displayed when the user has lost internet connectivity and cached data is unavailable:

```tsx
import { EmptyState } from "@/components/ui/EmptyState";
import { WifiOff, RefreshCw } from "lucide-react";

export function OfflineFallback({ onRetry }) {
  return (
    <EmptyState
      illustration="chat"
      message="You're currently offline"
      description="WorkSphere is unable to connect to the discovery network. Check your internet connection or reload saved offline cache."
      action={
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-xs font-semibold transition-all cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry Connection
        </button>
      }
    />
  );
}
```
