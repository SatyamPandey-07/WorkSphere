# New Hook Reference — WorkSphere (Sep 2026)

This document lists the new React hooks added in this development cycle.

---

## Audio & Media

### `useNoiseSuppression`
**File:** `src/hooks/useNoiseSuppression.ts`

Toggles browser-native noise suppression on a `MediaStreamTrack` using `applyConstraints`.

```typescript
const { isEnabled, isSupported, toggle, enable, disable } = useNoiseSuppression({ track });
```

---

### `useSpeechQueue`
**File:** `src/hooks/useSpeechQueue.ts`

FIFO message queue on top of `useSpeechSynthesis`. Messages play in order; auto-advances on `onEnd`.

```typescript
const { queueLength, enqueue, dequeue, clearQueue, playNext } = useSpeechQueue({ maxQueueLength: 20 });
```

---

### `useWebSocketLatency`
**File:** `src/hooks/useWebSocketLatency.ts`

Measures PartyKit socket round-trip latency via ping/pong. Returns `latencyMs` (null before first pong) and `tier` ("good" | "fair" | "poor" | "unknown").

```typescript
const { latencyMs, tier } = useWebSocketLatency(socket, { intervalMs: 10000 });
```

---

## Geolocation

### `useGeolocationWatch`
**File:** `src/hooks/useGeolocationWatch.ts`

Wraps `navigator.geolocation.watchPosition` with permission state tracking and cleanup.

```typescript
const { position, permissionState, error } = useGeolocationWatch(onPosition, { enableHighAccuracy: true });
```

---

## Battery

### `useBatteryStatus`
**File:** `src/hooks/useBatteryStatus.ts`

Tracks battery level/charging via Battery Status API. `isLow` at ≤ 20%; `isPanic` at ≤ 10%.

```typescript
const { level, charging, isLow, isPanic } = useBatteryStatus();
```

---

## Venue

### `useAlternativeVenuesSuggestion`
**File:** `src/hooks/useAlternativeVenuesSuggestion.ts`

Returns the 3 nearest comparable venues when a booking fails with CAPACITY_EXCEEDED.

```typescript
const { alternatives, isShowing, triggerAlternatives, dismiss } = useAlternativeVenuesSuggestion({ userLocation });
```

### `useOffscreenHeatmap`
**File:** `src/hooks/useOffscreenHeatmap.ts`

Renders crowd density heatmaps off-thread via `OffscreenCanvas` + Web Worker.

```typescript
const { renderDensity } = useOffscreenHeatmap(canvasRef, { gridW: 32, gridH: 32 });
renderDensity(new Float32Array(32 * 32));
```

---

## Social

### `useAFKLaptopWatch`
**File:** `src/hooks/useAFKLaptopWatch.ts`

"Laptop Watch" buddy system — request nearby co-workers to watch your laptop while you take a break.

```typescript
const { afkStatus, incomingRequest, requestWatch, acceptRequest, declineRequest, releaseWatch } =
  useAFKLaptopWatch({ venueId, userId, socket });
```

---

## See Also

- `src/lib/quietHoursPrediction.ts` — predicts quiet time windows from historical noise ratings
- `src/lib/distance.ts` — Haversine distance + walking time formatting
- `src/components/ui/HighlightedText.tsx` — search term highlighting component
- `src/components/ui/PasswordStrengthMeter.tsx` — real-time password strength indicator
- `src/components/ui/Breadcrumb.tsx` — accessible breadcrumb navigation
