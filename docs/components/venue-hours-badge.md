# `VenueHoursBadge` Component Documentation

## 1. Overview

`VenueHoursBadge` ([`src/components/venues/VenueHoursBadge.tsx`](../../src/components/venues/VenueHoursBadge.tsx)) renders an accessible status pill indicating whether a venue is currently **open**, **closing soon**, or **closed**, with an optional live countdown to the next closing or opening transition.

Opening-status evaluation, cross-midnight interval resolution, IANA timezone normalization, and countdown formatting are delegated to [`src/lib/venues/hours.ts`](../../src/lib/venues/hours.ts) (`getVenueOpeningStatus`, `formatCountdown`, `formatMinutes12Hour`).

---

## 2. Props Reference (`VenueHoursBadgeProps`)

| Prop | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `openingHours` | `VenueOpeningHours` | `{}` | Venue timezone, optional `is24Seven` flag, and weekly schedule windows keyed by weekday (`"sun"` through `"sat"`). |
| `currentTime` | `Date \| string \| number` | `undefined` | Optional fixed reference timestamp. When omitted, the badge uses the current clock and refreshes every 60 seconds. |
| `showCountdown` | `boolean` | `true` | Displays `status.countdownText` (e.g., `"Closes in 45m"`, `"Opens in 12h"`) when available; falls back to `status.badgeText` when `false` or when no countdown applies (such as 24/7 or unconfigured schedules). |
| `className` | `string` | `""` | Additional Tailwind or utility CSS classes appended to the root `<span>` pill. |

### Supporting Data Types

Defined in [`src/lib/venues/hours.ts`](../../src/lib/venues/hours.ts):

```typescript
export type WeekdayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface DailyTimeWindow {
  open: string;  // 24-hour "HH:mm"
  close: string; // 24-hour "HH:mm" (if <= open, treated as next-day cross-midnight)
}

export interface VenueOpeningHours {
  timeZone?: string;
  is24Seven?: boolean;
  schedule?: Partial<Record<WeekdayKey, DailyTimeWindow[]>>;
}

export type VenueOpeningState = "open" | "closing_soon" | "closed";

export interface VenueOpeningStatus {
  state: VenueOpeningState;
  badgeText: string;
  ariaLabel: string;
  closesAtFormatted?: string;
  opensAtFormatted?: string;
  minutesRemaining?: number;
  countdownText?: string;
}
```

---

## 3. Visual States & Countdown Behavior

`VenueHoursBadge` sets `data-testid="venue-opening-badge"` and `data-state={status.state}` on the root pill element, styling each state for both light and dark themes:

| State (`data-state`) | Trigger Condition | Visual Styling & Indicator | `badgeText` (`showCountdown={false}` / no countdown) | `countdownText` (`showCountdown={true}`) |
| :--- | :--- | :--- | :--- | :--- |
| `open` | `is24Seven === true`, or inside an active window with `minutesRemaining >= 60` | Emerald border/background/text (`border-emerald-300/80 bg-emerald-50 text-emerald-800` / dark emerald) + pulsing 8px emerald dot (`animate-pulse bg-emerald-500`) | `"Open Now"` | `"Closes in <Xh Ym>"` (omitted when `is24Seven` is `true`, displaying `"Open Now"`) |
| `closing_soon` | Inside an active window with `minutesRemaining < 60` | Amber border/background/text (`border-amber-300/80 bg-amber-50 text-amber-900` / dark amber) + solid 8px amber dot (`bg-amber-500`) | `"Closing Soon (Closes at h:mm AM/PM)"` | `"Closes in <Nm>"` |
| `closed` | Outside all windows, with an upcoming window in the 7-day lookahead | Slate border/background/text (`border-slate-300/80 bg-slate-100 text-slate-700` / dark slate), no status dot | `"Closed (Opens today\|tomorrow\|<weekday> at h:mm AM/PM)"` | `"Opens in <Xh Ym>"` |
| `closed` (unconfigured) | Empty or missing `schedule` with no upcoming windows | Same slate styling as `closed`, no status dot | `"Closed"` | `"Closed"` (no `countdownText`) |

### Countdown Formatting (`formatCountdown`)

- Under 1 hour (`hours === 0`): `"<prefix> <mins>m"` (e.g., `"Closes in 45m"`, `"Opens in 35m"`).
- Exact hours (`mins === 0`): `"<prefix> <hours>h"` (e.g., `"Closes in 1h"`, `"Opens in 12h"`).
- Hours and minutes: `"<prefix> <hours>h <mins>m"` (e.g., `"Closes in 5h 30m"`).

---

## 4. Timezone Handling & Schedule Evaluation

1. **IANA Timezone Validation (`resolveTimeZone`)**:
   - Uses `new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date(0))` to validate `openingHours.timeZone`.
   - If `timeZone` is omitted or invalid, it safely falls back to `"UTC"` without throwing a `RangeError`.
2. **Venue-Local Clock Calculation (`getLocalClock`)**:
   - Computes the current weekday index (`sun`–`sat`) and `minutesSinceMidnight` in the venue's resolved timezone using `hourCycle: "h23"`, ensuring accurate status regardless of the user's browser or server timezone.
3. **Cross-Midnight & Multi-Day Lookahead (`collectIntervals`)**:
   - Evaluates windows across `dayOffset` from `-1` through `+7` relative to the venue's local weekday.
   - If a window's `close` time is less than or equal to its `open` time (for example, `open: "20:00"`, `close: "04:00"`), `closeMin` is shifted by `+1440` minutes so overnight sessions remain `open` / `closing_soon` past midnight.
   - When closed, the next upcoming interval determines `Opens in ...` and whether `badgeText` displays `today`, `tomorrow`, or the weekday key (`sun`–`sat`).

---

## 5. Live Refresh Lifecycle

- When `currentTime` is **not** provided, `VenueHoursBadge` initializes `ticker` with `new Date()` and registers a `60_000` ms `setInterval` inside `useEffect` to refresh the countdown once per minute.
- On component unmount (or when `currentTime` becomes defined), the interval is cleared via `clearInterval`.
- When `currentTime` **is** provided, no timer is scheduled and `activeTime` tracks the supplied prop directly for deterministic rendering and testing.

---

## 6. Accessibility Notes

- **Live Status Semantics**: The root `<span>` uses `role="status"` so assistive technologies recognize the element as a status indicator.
- **Descriptive Accessible Name**: `aria-label={status.ariaLabel}` always provides full context—even when `showCountdown` renders a compact pill label—such as:
  - `"Venue is currently Open Now, operating 24/7"`
  - `"Venue is Open Now, closes at 8:00 PM"`
  - `"Venue is Closing Soon (Closes at 8:00 PM)"`
  - `"Venue is Closed (Opens tomorrow at 9:00 AM)"`
  - `"Venue is currently Closed"`
- **Decorative Indicators**: The emerald and amber indicator dots include `aria-hidden="true"` so screen readers do not announce redundant glyphs alongside the status text.
- **Color & Theme Contrast**: Status is never communicated by color alone—every state pairs distinct border/background/text tokens (with explicit `dark:` variants) alongside descriptive text and `aria-label`.

---

## 7. Usage Examples

```tsx
import { VenueHoursBadge } from "@/components/venues/VenueHoursBadge";

// Live-updating badge in venue's local timezone
<VenueHoursBadge
  openingHours={{
    timeZone: "Asia/Kolkata",
    schedule: {
      mon: [{ open: "09:00", close: "20:00" }],
      tue: [{ open: "09:00", close: "20:00" }],
      wed: [{ open: "09:00", close: "20:00" }],
      thu: [{ open: "09:00", close: "20:00" }],
      fri: [{ open: "09:00", close: "20:00" }],
      sat: [{ open: "10:00", close: "18:00" }],
      sun: [],
    },
  }}
/>

// Deterministic timestamp without countdown text
<VenueHoursBadge
  openingHours={{
    timeZone: "America/New_York",
    schedule: { mon: [{ open: "08:00", close: "18:00" }] },
  }}
  currentTime="2026-11-23T18:00:00.000Z"
  showCountdown={false}
/>

// 24/7 venue
<VenueHoursBadge openingHours={{ is24Seven: true, timeZone: "UTC" }} />
```
