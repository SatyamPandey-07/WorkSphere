# `useDebounce`: Parameter Options, Timer Lifecycle & Usage Guide

## Overview

The `useDebounce` hook ([`src/hooks/useDebounce.ts`](file:///c:/Users/admin/Desktop/workfere/src/hooks/useDebounce.ts)) delays updating a component's state value until a designated duration has elapsed without new changes. It is used across WorkSphere to postpone expensive operations — such as API search queries, notes auto-saving, map boundary recalculations, and filter applications — until user input has settled.

```mermaid
sequenceDiagram
    autonumber
    actor User as User Typing
    participant Input as Controlled State (raw)
    participant Hook as useDebounce(value, delay)
    participant Effect as Debounced State Consumer

    User->>Input: Types 'c'
    Input->>Hook: Value: 'c' (Timer 1 starts: 300ms)
    User->>Input: Types 'ca' (at 100ms)
    Input->>Hook: Value: 'ca' (Timer 1 cancelled; Timer 2 starts: 300ms)
    User->>Input: Types 'cafe' (at 200ms)
    Input->>Hook: Value: 'cafe' (Timer 2 cancelled; Timer 3 starts: 300ms)
    Note over Hook: User pauses typing (300ms elapses)
    Hook->>Effect: Emits debouncedValue: 'cafe'
    Effect->>Effect: Dispatches API Search Query
```

---

## 1. Type Signature & Parameters

### Hook Signature

```typescript
export function useDebounce<T>(value: T, delay: number): T;
```

### Parameters

| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `value` | `T` | **Yes** | — | Any fast-changing input value (string, object, array, number, boolean) to be debounced. |
| `delay` / `delayMs` | `number` | **Yes** | — | Time in milliseconds to wait after the last change before updating the debounced value. |

### Return Value

| Return | Type | Description |
| :--- | :--- | :--- |
| `debouncedValue` | `T` | The stable delayed state. Retains the previous value until `delay` milliseconds pass without modification, then updates to match `value`. |

---

## 2. Asynchronous Lifecycle & Timer Cleanup

### 2.1 Timer Reset Mechanics
Whenever `value` or `delay` changes before the timer completes:
1. React triggers the `useEffect` cleanup return function.
2. `clearTimeout(timer)` cancels the existing pending execution.
3. A fresh `setTimeout` is scheduled for the specified `delay`.

### 2.2 Unmount Safety
If the hosting component unmounts while a debounce timer is running (e.g. user navigates away mid-keystroke):
- The `useEffect` cleanup executes `clearTimeout(timer)`.
- Prevents memory leaks, orphaned timer callbacks, and React "state update on unmounted component" warnings.

---

## 3. Debouncing vs. Throttling Comparison

Understanding when to choose debouncing versus throttling is critical for UI performance in WorkSphere:

| Characteristic | Debouncing (`useDebounce`) | Throttling (`useThrottle`) |
| :--- | :--- | :--- |
| **Execution Timing** | Executes **after** a period of inactivity (trailing edge). | Executes at **fixed intervals** during continuous activity. |
| **Reset Trigger** | Every new input restarts the delay timer. | Ignores intermediate inputs until the throttle interval expires. |
| **Primary Use Cases** | Autocomplete search inputs, note auto-saving, text field validation, window resize end events. | Infinite scroll triggers, mouse move tracking, canvas drawing coordinates, map drag events. |
| **WorkSphere Examples** | [`VenueSearch`](file:///c:/Users/admin/Desktop/workfere/src/hooks/useVenueSearch.ts), [`NoteEditor`](file:///c:/Users/admin/Desktop/workfere/src/components/saved-venues/NoteEditor.tsx), [`TimezoneClock`](file:///c:/Users/admin/Desktop/workfere/src/components/bookings/TimezoneClock.tsx). | Screen share bitrate throttling, map viewport bounding box updates. |

---

## 4. Usage Examples

### 4.1 Debounced Venue Search Query

Delaying venue search requests until the user stops typing reduces server traffic and eliminates out-of-order response race conditions:

```tsx
"use client";

import React, { useState, useEffect } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { Search, Loader2 } from "lucide-react";

export function VenueSearchBar() {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Debounce the input query by 300ms
  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  useEffect(() => {
    // Only search if user typed a meaningful query
    if (!debouncedSearchTerm.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    let isCancelled = false;
    setIsLoading(true);

    fetch(`/api/venues?query=${encodeURIComponent(debouncedSearchTerm)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!isCancelled) {
          setResults(data.venues || []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [debouncedSearchTerm]);

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search cafes, libraries, desks..."
          className="w-full pl-9 pr-9 py-2 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 animate-spin" />
        )}
      </div>

      {results.length > 0 && (
        <ul className="absolute left-0 right-0 mt-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg z-20 max-h-60 overflow-y-auto">
          {results.map((venue: any) => (
            <li key={venue.id} className="p-3 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm">
              {venue.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

---

### 4.2 Auto-Saving Venue Notes (`NoteEditor`)

In [`src/components/saved-venues/NoteEditor.tsx`](file:///c:/Users/admin/Desktop/workfere/src/components/saved-venues/NoteEditor.tsx), `useDebounce` postpones saving draft notes to localStorage or the backend until 1000ms after the last edit:

```tsx
"use client";

import React, { useState, useEffect } from "react";
import { useDebounce } from "@/hooks/useDebounce";

const AUTOSAVE_DELAY = 1000;

export function VenueNoteEditor({ venueId, initialNotes = "" }) {
  const [notes, setNotes] = useState(initialNotes);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");

  const debouncedNotes = useDebounce(notes, AUTOSAVE_DELAY);

  // Trigger autosave only when debouncedNotes updates
  useEffect(() => {
    if (debouncedNotes === initialNotes) return;

    setSaveStatus("saving");
    fetch(`/api/saved-venues/${venueId}/notes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: debouncedNotes }),
    })
      .then(() => setSaveStatus("saved"))
      .catch(() => setSaveStatus("unsaved"));
  }, [debouncedNotes, venueId, initialNotes]);

  return (
    <div className="space-y-2">
      <textarea
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setSaveStatus("unsaved");
        }}
        placeholder="Add private notes about power outlets, seating..."
        className="w-full p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 text-sm"
      />
      <div className="text-xs text-zinc-400">
        Status: {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "All changes saved" : "Unsaved changes"}
      </div>
    </div>
  );
}
```

---

### 4.3 Advanced: Imperative Cancel / Flush Pattern

For scenarios requiring an explicit manual cancel callback or immediate flush trigger, combine `useRef` with timer controls:

```tsx
import { useState, useRef, useEffect, useCallback } from "react";

export function useDebounceCallback<T extends (...args: any[]) => void>(
  callback: T,
  delay: number
) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const debouncedFn = useCallback(
    (...args: Parameters<T>) => {
      cancel();
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [cancel, delay]
  );

  useEffect(() => cancel, [cancel]);

  return { run: debouncedFn, cancel };
}
```
