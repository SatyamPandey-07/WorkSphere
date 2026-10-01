# Hover Predictor — Mouse Trajectory Algorithm

> **Source:** `src/hooks/useHoverPredictor.ts`

---

## Overview

`useHoverPredictor` predicts user **intent to interact** with an element before they click it, by analyzing the velocity of the mouse trajectory as it moves over the element. When the cursor slows below a configurable threshold, the hook fires an `onPredict` callback — allowing the host component to pre-load data, pre-warm caches, or show loading skeletons early.

---

## Algorithm

### 1. Velocity calculation

Each `mousemove` event records a `Point { x, y, time }`. The hook keeps the two most recent points and calculates the **Euclidean speed** in pixels per millisecond:

```
velocity = √((x₂−x₁)² + (y₂−y₁)²) / (t₂−t₁)
```

A `velocity` of 0.5 px/ms means the cursor is moving 500 pixels per second — fast enough that the user is likely scanning, not targeting.

### 2. Slow-movement detection

If `velocity < velocityThreshold` for any sample:
1. A `setTimeout(onPredict, hoverTimeThreshold)` is started.
2. If a subsequent sample shows the cursor speeding up again, the timer is **cancelled** — the user was just passing through.
3. If the timer fires (user stayed slow for the full `hoverTimeThreshold` ms), `onPredict()` is called exactly once per element entry.

### 3. State machine per element visit

| Event | Action |
|-------|--------|
| `mouseenter` | Reset all state (points cleared, timer cancelled, predicted=false) |
| `mousemove` — fast | Clear pending timer |
| `mousemove` — slow | Start (or continue) pending timer |
| Timer fires | Call `onPredict()`, mark `hasPredicted=true` |
| `mouseleave` | Clear timer, clear points (predicted flag NOT reset — stays true until next enter) |

---

## Configuration Parameters

| Prop | Default | Effect |
|------|---------|--------|
| `velocityThreshold` | `0.5` px/ms | Lower → requires slower movement to trigger; raises false-positive rate on fast trackpads |
| `hoverTimeThreshold` | `300` ms | Higher → user must dwell longer; reduces false positives but increases prediction latency |

### Tuning guidance

- **High-intent actions** (e.g. "Add to cart"): `velocityThreshold: 0.3, hoverTimeThreshold: 200` — trigger sooner, slight risk of early pre-fetch.
- **Exploratory lists** (e.g. venue search results): `velocityThreshold: 0.5, hoverTimeThreshold: 300` — balanced defaults.
- **Heavy data loads** (e.g. modal pre-warm): `velocityThreshold: 0.7, hoverTimeThreshold: 150` — predict aggressively to hide latency.

---

## Integration Guide

```tsx
import { useHoverPredictor } from "@/hooks/useHoverPredictor";

function VenueCard({ venue }) {
  const [preloaded, setPreloaded] = useState(false);

  const attachPredictor = useHoverPredictor({
    onPredict: () => {
      // Fires once when user appears about to click
      prefetchVenueDetails(venue.id);
      setPreloaded(true);
    },
    velocityThreshold: 0.5,  // optional — defaults to 0.5
    hoverTimeThreshold: 300, // optional — defaults to 300
  });

  return (
    <div ref={attachPredictor} className="venue-card">
      {venue.name}
    </div>
  );
}
```

The hook returns a **ref callback** (`(node: HTMLElement | null) => void`) that can be used directly as a `ref` prop. It handles attaching and cleaning up all three event listeners (`mousemove`, `mouseenter`, `mouseleave`) automatically.

---

## Why not use `onMouseEnter` + delay?

`onMouseEnter` fires immediately when the cursor crosses the element boundary, even during fast horizontal sweeps across a list. A pure timer approach produces many false-positive prefetches. The velocity gate filters out fast sweeps so only **deliberate slow approach movements** trigger the prediction.
