# Technical Specification: Social Waitlist Promotion Algorithm & Automatic RSVP Hand-Off Pipeline

This technical specification details WorkSphere's venue seat waitlist promotion algorithm, First-In-First-Out (FIFO) queue mechanics, 15-minute claim expiration windows, serializable transaction isolation, and push notification hand-off pipeline ([src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts) and [src/lib/waitlist/types.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/types.ts)).

---

## Table of Contents

1. [Executive Summary & Architectural Scope](#1-executive-summary--architectural-scope)
2. [Waitlist FIFO Queue & Priority Escalation Algorithm](#2-waitlist-fifo-queue--priority-escalation-algorithm)
   - [FIFO Ordering & Queue Position Calculation](#fifo-ordering--queue-position-calculation)
   - [Timezone & Real-Instant Interval Matching](#timezone--real-instant-interval-matching)
   - [Preference-Based Matching & Priority Escalation](#preference-based-matching--priority-escalation)
3. [15-Minute Claim Expiration Window & State Machine](#3-15-minute-claim-expiration-window--state-machine)
   - [State Transition Lifecycle](#state-transition-lifecycle)
   - [Serializable Claim Protocol (`claimWaitlistSeat`)](#serializable-claim-protocol-claimwaitlistseat)
   - [Transient Serialization Retry Logic](#transient-serialization-retry-logic)
4. [Automated Hand-off & Sweeper Maintenance Routines](#4-automated-hand-off--sweeper-maintenance-routines)
   - [Immediate Hand-off (`expireEntryAndOfferToNext`)](#immediate-hand-off-expireentryandoffertonext)
   - [Background Sweeper Routine (`expireStaleWaitlistOffers`)](#background-sweeper-routine-expirestalewaitlistoffers)
5. [Automated Push Alerts & Webhook Notifications](#5-automated-push-alerts--webhook-notifications)
   - [Notification Dispatcher Integration](#notification-dispatcher-integration)
   - [WebPush Critical Alert Payload (`WAITLIST_SEAT_AVAILABLE`)](#webpush-critical-alert-payload-waitlist_seat_available)
6. [Repository Code Reference Map](#6-repository-code-reference-map)

---

## 1. Executive Summary & Architectural Scope

WorkSphere enables remote workers to book hot desks, quiet zones, and team islands at popular venues. When a venue's seating reaches maximum capacity, users can join a digital waitlist for specific time slots or seat types.

When an existing reservation is cancelled or checked out early, WorkSphere's **Waitlist Promotion Pipeline** automatically identifies the next eligible waiter in line, locks the freed seat, grants an exclusive **15-minute claim offer window**, and dispatches critical WebPush alerts ([src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts)).

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     CANCELLATION / CHECKOUT EVENT                        │
│                (Booking Cancelled or Early Checkout)                     │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 1. expireStaleWaitlistOffers()  (Purge expired claim windows)            │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 2. notifyNextInWaitlist()      (Find eligible waiter in FIFO order)     │
│    - Row-level lock FOR UPDATE (Prevent concurrent double-allocations)   │
│    - Match seat preferences (Type, Quiet Zone, Outlets)                  │
│    - Transition status: ACTIVE ──> NOTIFIED (claimExpiresAt = now + 15m)│
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 3. WebPush Alert Dispatch      (Critical Push Notification)              │
│    - Payload: WAITLIST_SEAT_AVAILABLE with 15-minute claim deep-link    │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │
                                     ▼
┌───────────────────────────────────┴──────────────────────────────────────┐
│ USER ACTION WITHIN 15 MINUTES                                            │
├──────────────────────────────────────┬───────────────────────────────────┤
│ User Clicks Claim Link               │ 15-Minute Window Lapses           │
│  ├── Execute claimWaitlistSeat()     │  ├── compare-and-set: NOTIFIED    │
│  ├── Status: NOTIFIED ──> CLAIMED    │  │   ──> EXPIRED                  │
│  └── Create CONFIRMED Booking        │  └── Trigger expireEntryAndOffer- │
│                                      │      ToNext() for next in line    │
└──────────────────────────────────────┴───────────────────────────────────┘
```

---

## 2. Waitlist FIFO Queue & Priority Escalation Algorithm

File: [src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts#L252-L389)

### FIFO Ordering & Queue Position Calculation

Waitlist entries are strictly ordered by creation timestamp (`createdAt ASC`), guaranteeing First-In-First-Out (FIFO) queue fairness.

A user's position in line is calculated dynamically:

$$\text{QueuePosition} = \text{Count}(\text{ActiveWaiters with } \text{createdAt} < \text{User.createdAt}) + 1$$

```typescript
async function calculateQueuePosition(
  venueId: string,
  date: string,
  time: string,
  createdAt: Date,
): Promise<number> {
  const countBefore = await prisma.venueSeatWaitlist.count({
    where: {
      venueId,
      date,
      time,
      status: { in: ["ACTIVE", "NOTIFIED"] },
      createdAt: { lt: createdAt },
    },
  });
  return countBefore + 1;
}
```

---

### Timezone & Real-Instant Interval Matching

Users may book desks across different timezones (or reservations may span past midnight). Rather than comparing string dates (`YYYY-MM-DD`), the promotion engine converts all requested wall-clock times into canonical UTC intervals using `bookingInterval` and `intervalsOverlap`:

$$\text{Interval} = [\text{StartUTC}, \text{EndUTC})$$

$$\text{Eligible} \iff \text{Interval}_{\text{Waiter}} \cap \text{Interval}_{\text{Freed}} \neq \emptyset$$

### Preference-Based Matching & Priority Escalation

When a seat becomes available, candidates are filtered in FIFO order against stated preferences:

1. **Specific Seat ID (`seatId`):** If a waiter requested a specific desk ID, the freed seat must match `seatId`.
2. **Seat Type Gating (`seatType`):** Matches desk type (`flex`, `dedicated`, `booth`, `meeting_room`).
3. **Quiet Zone Requirement (`requiresQuiet`):** Filters for seats with `isQuietZone === true`.
4. **Power Outlet Requirement (`requiresOutlets`):** Filters for seats containing `"outlets"` in their amenity tags.
5. **No Existing Conflicting Booking:** Verifies that no `CONFIRMED` or `PENDING` booking occupies the seat during the waiter's interval.

---

## 3. 15-Minute Claim Expiration Window & State Machine

File: [src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts#L28-L478)

### State Transition Lifecycle

Each waitlist entry transitions through a strict state machine:

```
                  ┌───────────┐
                  │  ACTIVE   │ (User waiting in FIFO queue)
                  └─────┬─────┘
                        │ Seat Freed & Notified
                        ▼
                  ┌───────────┐
                  │ NOTIFIED  │ (15-minute claim window active)
                  └─┬───────┬─┘
    User Claims Seat│       │ Window Expires (15m Lapsed)
                    ▼       ▼
              ┌─────────┐ ┌─────────┐
              │ CLAIMED │ │ EXPIRED │ (Auto hand-off to next waiter)
              └─────────┘ └─────────┘
```

| State | Description | Next Allowed State |
| :--- | :--- | :--- |
| `ACTIVE` | User is waiting in the FIFO queue. | `NOTIFIED`, `CANCELLED` |
| `NOTIFIED` | Seat offered; 15-minute timer (`claimExpiresAt`) is active. | `CLAIMED`, `EXPIRED` |
| `CLAIMED` | Seat claimed by user; converted into `CONFIRMED` booking. | Terminal State |
| `EXPIRED` | 15-minute claim window lapsed; seat passed to next waiter. | Terminal State |
| `CANCELLED` | User voluntarily withdrew from waitlist. | Terminal State |

---

### Serializable Claim Protocol (`claimWaitlistSeat`)

File: [src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts#L449-L605)

When a user clicks "Claim Seat", the claim runs inside a **Serializable Transaction** (`Prisma.TransactionIsolationLevel.Serializable`) to eliminate double-booking race conditions:

1. **Row-Level Lock:** Obtains an explicit `FOR UPDATE` SQL lock on the waitlist entry:
   ```sql
   SELECT id FROM "VenueSeatWaitlist" WHERE id = ${waitlistId} AND "userId" = ${userId} FOR UPDATE;
   ```
2. **Compare-and-Set Status Transition:**
   ```typescript
   const marked = await tx.venueSeatWaitlist.updateMany({
     where: { id: waitlistId, status: "NOTIFIED" },
     data: { status: "CLAIMED", claimedAt: new Date() },
   });
   if (marked.count !== 1) {
     throw new WaitlistClaimError("NOT_CLAIMABLE", "This offer has already been claimed or expired.");
   }
   ```
3. **Atomic Booking Creation:** Converts the waitlist entry into a `CONFIRMED` booking with a unique confirmation ID (`WS-XXXXXX`).

### Transient Serialization Retry Logic

Under high concurrency, serializable transactions may experience deadlocks (`40P01`) or serialization failures (`40001`). The engine automatically retries transient errors up to `CLAIM_MAX_RETRIES = 3` with randomized exponential backoff:

$$\text{BackoffMs} = \min(2^{\text{attempt} + 1} \times 100 + \text{random}(0, 50), 2000)$$

---

## 4. Automated Hand-off & Sweeper Maintenance Routines

File: [src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts#L629-L699)

### Immediate Hand-off (`expireEntryAndOfferToNext`)

If a user attempts to claim an expired offer, `claimWaitlistSeat` catches the `EXPIRED` error, atomically transitions the entry to `EXPIRED`, and instantly invokes `notifyNextInWaitlist()` to hand the seat over to the next person in line.

### Background Sweeper Routine (`expireStaleWaitlistOffers`)

A background maintenance sweeper runs periodically to sweep all lapsed offers:

```typescript
export async function expireStaleWaitlistOffers(): Promise<number> {
  const expiredEntries = await prisma.venueSeatWaitlist.findMany({
    where: {
      status: "NOTIFIED",
      claimExpiresAt: { lt: new Date() },
    },
  });

  let expiredCount = 0;

  for (const entry of expiredEntries) {
    // Compare-and-set ensures only one concurrent process expires the offer
    const { count } = await prisma.venueSeatWaitlist.updateMany({
      where: { id: entry.id, status: "NOTIFIED" },
      data: { status: "EXPIRED" },
    });
    if (count !== 1) continue;
    expiredCount++;

    // Offer seat to next waiter in line
    await notifyNextInWaitlist(
      entry.venueId,
      entry.date,
      entry.time,
      entry.duration,
      entry.seatId,
      entry.timeZone,
    );
  }

  return expiredCount;
}
```

---

## 5. Automated Push Alerts & Webhook Notifications

File: [src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts#L397-L415)

### Notification Dispatcher Integration

When a candidate is notified, the pipeline interacts with `NotificationDispatcher` ([src/lib/notifications/dispatcher.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/notifications/dispatcher.ts)) to send high-priority push notifications across registered WebPush subscriptions.

### WebPush Critical Alert Payload (`WAITLIST_SEAT_AVAILABLE`)

```typescript
await dispatcher.dispatch("webpush", {
  recipient: candidate.userId,
  title: "Workspace Seat Available!",
  body: `A seat opened up at ${candidate.venue.name} for ${candidate.date} at ${candidate.time}. You have 15 minutes to claim your reservation.`,
  url: `/venues/${venueId}?claimWaitlist=${candidate.id}`,
  data: {
    type: "WAITLIST_SEAT_AVAILABLE",
    waitlistId: candidate.id,
    venueId,
    expiresAt: claimExpiresAt.toISOString(),
  },
  options: {
    isCritical: true, // Bypasses quiet hours for urgent seat notifications
  },
});
```

---

## 6. Repository Code Reference Map

- [src/lib/waitlist/waitlistService.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/waitlistService.ts) — Core waitlist service, FIFO queue math, notification dispatcher, 15-minute claim expiration logic, and serializable claim transactions.
- [src/lib/waitlist/types.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/waitlist/types.ts) — TypeScript type definitions (`WaitlistEntry`, `JoinWaitlistInput`, `ClaimWaitlistSeatResult`).
- [src/lib/booking.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/booking.ts) — Interval overlap checking (`bookingInterval`, `intervalsOverlap`) and timezone normalizers.
- [src/lib/notifications/dispatcher.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/notifications/dispatcher.ts) — Multi-channel notification dispatcher (WebPush, SMS, Email).
