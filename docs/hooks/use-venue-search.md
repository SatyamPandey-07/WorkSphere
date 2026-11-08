# `useVenueSearch`: Query Debouncing, Cancellation Tokens & Cache Invalidation

This document details the architecture, configuration parameters, asynchronous lifecycle, network cancellation mechanics, and error handling of the **`useVenueSearch`** React hook ([`src/hooks/useVenueSearch.ts`](file:///c:/Users/admin/Desktop/workfere/src/hooks/useVenueSearch.ts)).

---

## 1. Executive Summary & Design Goals

When remote workers search for coworking cafes, library desks, or quiet workspace pods, typing speed often outpaces network response latency. Dispatching HTTP requests on every raw keystroke causes:
- **Server Request Flooding:** Rapid typing of a 10-character query generates 10 concurrent requests to the backend API.
- **Out-of-Order Race Conditions:** A slower response for an earlier 3-letter query ("cof") might arrive after a faster response for a 6-letter query ("coffee"), overwriting fresh results with stale data.
- **Client Render Thrashing:** Rapid state updates cause input cursor jitter, layout shifts, and battery drain on mobile devices.

`useVenueSearch` solves these challenges by combining:
1. **Configurable Keystroke Debouncing ($250\text{ms} - 300\text{ms}$):** Suspends network dispatch until the user pauses typing.
2. **`AbortController` Cancellation Tokens:** Automatically aborts any in-flight HTTP request when a newer query is triggered.
3. **Silent Abort Handling:** Treats `AbortError` / `DOMException.ABORT_ERR` as expected control flow, preventing false error toasts or result flickering.
4. **Controlled vs. Uncontrolled Operational Modes:** Operates seamlessly whether managing internal state or controlled from a parent form or URL parameter.

```mermaid
flowchart TD
    Keystroke["User Types Keystroke in Search Bar"] --> ClearTimer["Clear Existing Debounce Timer<br/>clearTimeout(debounceTimerRef.current)"]
    ClearTimer --> TimerStart["Start New Debounce Timer<br/>(Default: 250ms - 300ms)"]
    
    TimerStart --> UserTyping{"User types another character<br/>within window?"}
    UserTyping -->|Yes| Keystroke
    UserTyping -->|No (Window Elapsed)| AbortInFlight["Abort In-Flight Request<br/>abortControllerRef.current.abort()"]
    
    AbortInFlight --> NewController["Create New AbortController<br/>signal = controller.signal"]
    NewController --> FetchCall["fetch('/api/venues?query=...', { signal })"]
    
    FetchCall --> Response{"Response Received"}
    Response -->|AbortError (Aborted)| DiscardSilent["Silently Ignore (No error state)"]
    Response -->|HTTP 200 OK| SetResults["setVenues(data)<br/>setIsLoading(false)"]
    Response -->|Network / HTTP Error| SetError["setError(message)<br/>setIsLoading(false)"]
```

---

## 2. Hook API Reference

### 2.1 Hook Signature

```typescript
function useVenueSearch<T = VenueSearchResult>(
  queryOrOptions?: string | UseVenueSearchOptions,
  explicitOptions?: UseVenueSearchOptions
): UseVenueSearchReturn<T>;
```

### 2.2 Configuration Options (`UseVenueSearchOptions`)

| Option Parameter | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| `query` | `string` | `undefined` | Controlled query string. When provided, the hook operates in **controlled mode**. |
| `initialQuery` | `string` | `""` | Initial query string for **uncontrolled mode**. |
| `debounceMs` | `number` | `250` | Debounce delay in milliseconds before dispatching network request ($250\text{ms} - 300\text{ms}$). |
| `minQueryLength` | `number` | `1` | Minimum trimmed character length required to initiate a network search. |
| `apiEndpoint` | `string` | `"/api/venues"` | Base API endpoint for querying venues. |
| `semanticWeight` | `number` | `undefined` | Configurable semantic vector scoring weight for hybrid RRF search ($0.0 - 1.0$ or $0 - 100$). |
| `fullTextWeight` | `number` | `undefined` | Configurable full-text keyword scoring weight for hybrid RRF search ($0.0 - 1.0$ or $0 - 100$). |

### 2.3 Query Filters & URL Query Parameters

When building venue search bars and filter drawers (such as [`VenueSearchDrawer.tsx`](file:///c:/Users/admin/Desktop/workfere/src/components/venues/VenueSearchDrawer.tsx)), queries append query parameters to the endpoint:

| Parameter Key | Type | Example | Description |
| :--- | :--- | :---: | :--- |
| `query` | `string` | `"blue bottle"` | Textual search query for venue names, descriptions, or tags. |
| `category` | `string` | `"cafe"` | Venue category filter (`"cafe"`, `"coworking"`, `"library"`, `"hotel_lobby"`). |
| `sortBy` | `string` | `"distance"` | Ranking criteria (`"distance"`, `"rating"`, `"quietness"`, `"wifi"`). |
| `radiusKm` / `radius`| `number` | `5` | Geofence search radius in kilometers around the user's coordinates. |
| `semanticWeight` | `number` | `0.7` | Weight applied to vector embeddings in hybrid Reciprocal Rank Fusion (RRF). |
| `fullTextWeight` | `number` | `0.3` | Weight applied to PostgreSQL/SQLite full-text matches in hybrid search. |

### 2.4 Return Object (`UseVenueSearchReturn<T>`)

| Property | Type | Description |
| :--- | :--- | :--- |
| `query` | `string` | Current active search query string. |
| `setQuery` | `(query: string) => void` | Updates internal search query (uncontrolled mode). |
| `venues` | `T[]` | Array of returned venue result objects. |
| `results` | `T[]` | Alias to `venues` for drop-in compatibility. |
| `isLoading` | `boolean` | `true` while a network search request is in-flight. |
| `loading` | `boolean` | Alias to `isLoading`. |
| `error` | `string \| null` | Error message string if the active search fails; `null` otherwise. |
| `clear` | `() => void` | Clears search query, cancels in-flight requests, and resets venue results to `[]`. |
| `abort` | `() => void` | Cancels any currently pending in-flight HTTP request. |
| `search` | `(override?: string) => Promise<void>` | Manually invokes an immediate search execution, bypassing debounce. |

---

## 3. Debouncing & Network Cancellation Architecture

### 3.1 300ms Keystroke Debouncing
The hook stores a timer handle in `debounceTimerRef: useRef<NodeJS.Timeout | null>(null)`. On every change to `activeQuery`:
1. Any active timeout is canceled via `clearTimeout(debounceTimerRef.current)`.
2. If `activeQuery.trim().length < minQueryLength`, all in-flight requests are aborted and results are immediately reset to `[]`.
3. If valid, a new timer is scheduled for `debounceMs` (default $250\text{ms} - 300\text{ms}$).

### 3.2 Cancellation Tokens via `AbortController`
To prevent race conditions, the hook maintains `abortControllerRef: useRef<AbortController | null>(null)`.

```typescript
// Prior to dispatching a new search request, abort any in-flight HTTP request:
if (abortControllerRef.current) {
  abortControllerRef.current.abort();
}

const controller = new AbortController();
abortControllerRef.current = controller;

const response = await fetch(url, { signal: controller.signal });
```

### 3.3 Silent `AbortError` Handling
When an in-flight request is aborted by a newer keystroke, `fetch()` throws an `AbortError`. The hook explicitly intercepts this exception:

```typescript
const isAbort =
  controller.signal.aborted ||
  (err instanceof DOMException && (err.name === "AbortError" || err.code === 20)) ||
  (err instanceof Error && err.name === "AbortError");

if (isAbort) {
  // Silent return: Do not update error state, do not overwrite existing venues
  if (abortControllerRef.current === controller) {
    abortControllerRef.current = null;
    setIsLoading(false);
  }
  return;
}
```

This ensures fast typing never flashes transient error banners or flickers UI components.

---

## 4. Cache Invalidation & Stale State Mitigation

1. **Unmount Cleanup:** When the hosting component unmounts (e.g. user closes a search drawer), `useEffect` cleanup immediately cancels pending timers and aborts in-flight requests:
   ```typescript
   useEffect(() => {
     return () => {
       if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
       if (abortControllerRef.current) abortControllerRef.current.abort();
     };
   }, []);
   ```
2. **Superseded Response Rejection:** If a slower request finishes after a new `AbortController` has already been created, the response is discarded:
   ```typescript
   if (controller.signal.aborted || abortControllerRef.current !== controller) {
     return;
   }
   ```
3. **Empty Query Invalidation:** Clearing the search input immediately empties the `venues` array (`setVenues([])`) and resets error states without waiting for network timeout cycles.

---

## 5. Sample Component Integration

Below is an end-to-end example demonstrating how to integrate `useVenueSearch` with category filtering, sorting, and geofence radius adjustments:

```tsx
"use client";

import React, { useState } from "react";
import { useVenueSearch, VenueSearchResult } from "@/hooks/useVenueSearch";
import { Search, Loader2, X, MapPin, Star, Wifi } from "lucide-react";

export function VenueSearchBar() {
  const [category, setCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("distance");
  const [radiusKm, setRadiusKm] = useState<number>(5);

  // Construct parameterized endpoint with category, sorting, and radius
  const apiEndpoint = `/api/venues?category=${encodeURIComponent(category)}&sortBy=${encodeURIComponent(sortBy)}&radius=${radiusKm}`;

  const {
    query,
    setQuery,
    venues,
    isLoading,
    error,
    clear,
  } = useVenueSearch<VenueSearchResult>({
    debounceMs: 300,        // 300ms debounce
    minQueryLength: 2,      // Trigger search after 2 characters
    apiEndpoint,
  });

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Search Input Bar */}
      <div className="relative flex items-center">
        <Search className="absolute left-4 w-5 h-5 text-zinc-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by venue name, address, or amenities..."
          className="w-full pl-12 pr-12 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isLoading ? (
          <Loader2 className="absolute right-4 w-5 h-5 text-blue-500 animate-spin" />
        ) : query ? (
          <button
            type="button"
            onClick={clear}
            className="absolute right-4 p-1 text-zinc-400 hover:text-zinc-600 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
      </div>

      {/* Filter Controls: Category, Sort, Radius */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-medium"
        >
          <option value="all">All Categories</option>
          <option value="cafe">Cafes</option>
          <option value="coworking">Coworking</option>
          <option value="library">Libraries</option>
        </select>

        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-medium"
        >
          <option value="distance">Sort by Distance</option>
          <option value="rating">Sort by Rating</option>
          <option value="quietness">Sort by Quietness</option>
        </select>

        <select
          value={radiusKm}
          onChange={(e) => setRadiusKm(Number(e.target.value))}
          className="px-3 py-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 font-medium"
        >
          <option value={2}>Within 2 km</option>
          <option value={5}>Within 5 km</option>
          <option value={10}>Within 10 km</option>
        </select>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="p-3 text-xs text-rose-600 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 rounded-xl">
          {error}
        </div>
      )}

      {/* Results Dropdown / List */}
      {venues.length > 0 && (
        <ul className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-lg divide-y divide-zinc-100 dark:divide-zinc-800 overflow-hidden">
          {venues.map((venue) => (
            <li
              key={venue.id}
              className="p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors flex items-center justify-between"
            >
              <div>
                <h4 className="font-bold text-sm text-zinc-900 dark:text-zinc-100">
                  {venue.name}
                </h4>
                {venue.address && (
                  <p className="text-xs text-zinc-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="w-3.5 h-3.5" />
                    <span>{venue.address}</span>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs">
                {venue.rating && (
                  <span className="flex items-center gap-1 font-bold text-amber-600">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span>{venue.rating.toFixed(1)}</span>
                  </span>
                )}
                {venue.hasOutlets && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-bold text-[10px]">
                    Outlets Available
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```
