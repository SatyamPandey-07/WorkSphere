# NotificationBell Component & User Notifications API Guide

The `NotificationBell` component displays real-time user notification badges and a dropdown panel in the top navigation bar. It interacts with the `/api/user/notifications` endpoint to fetch recent notifications, display global unread counts, mark notifications as read, and support undo-based mark-as-unread restoration.

---

## Component Location and Integration

- **Component Source:** [`src/components/NotificationBell.tsx`](../src/components/NotificationBell.tsx)
- **API Route:** [`src/app/api/user/notifications/route.ts`](../src/app/api/user/notifications/route.ts)
- **Concurrency & Deadlock Tests:** [`src/__tests__/api/notificationsConcurrency.test.ts`](../src/__tests__/api/notificationsConcurrency.test.ts)
- **Component Tests:** [`src/__tests__/components/NotificationBell.test.tsx`](../src/__tests__/components/NotificationBell.test.tsx)

### Props

The component currently does **not** accept any props. It manages its own internal state, polling interval, audio chimes, and API requests.

```tsx
import { NotificationBell } from "@/components/NotificationBell";

export default function TopNavigation() {
  return (
    <nav className="flex items-center gap-4">
      <NotificationBell />
    </nav>
  );
}
```

---

## Component Features and Polling Lifecycle

- **Unread Badge:** Displays a pill badge with the unread count when `unreadCount > 0`.
- **Recent List:** Displays up to 20 of the user's most recent notifications.
- **Contextual Icons:** Categorizes notifications visually (seats, bookings, Wi-Fi updates, general alerts).
- **Sound Alert:** Plays `/sounds/notification-chime.mp3` when new unread notifications arrive (toggleable via the UI and persisted in `localStorage`).
- **Outside Click Dismissal:** Automatically closes the dropdown when a user clicks outside the menu.
- **Direct Workspace Navigation:** Links directly to related workspaces when `venueId` is present on a notification item.
- **Polling Lifecycle:**
  - Fetches notifications immediately upon mounting.
  - Refreshes notifications every **20 seconds** (`20000` ms) via `setInterval`.
  - Clears the interval automatically during React component unmount.

```typescript
useEffect(() => {
  fetchNotifications();
  const interval = setInterval(fetchNotifications, 20000);
  return () => clearInterval(interval);
}, [fetchNotifications]);
```

---

## NotificationBell UI Workflows and API Interaction

The frontend component uses the backend API for two primary user interactions:

### 1. Panel Open Auto-Read

When a user opens the dropdown panel (`handleToggleOpen`), the component checks if `unreadCount > 0`. If unread notifications exist, it calls `markAllAsRead(false)`:

- Optimistically sets `unreadCount` to `0` and marks all loaded notifications as `read: true` locally.
- Sends a `POST /api/user/notifications` request with `{ "action": "markAsRead" }`.
- Passes `showToast = false` to suppress the success toast and Undo prompt during passive panel opening.

### 2. "Mark all as read" Button & The 5-Second Undo Workflow

When a user explicitly clicks the **"Mark all as read"** button in the dropdown header:

1. **Optimistic Local Update:** Local `unreadCount` is set to `0`, and local notifications are set to `read: true`.
2. **Snapshot Capture:** A snapshot of previously unread notification IDs and previous unread count is stored in `undoSnapshotRef.current`.
3. **Success Toast with Undo:** A success toast is displayed with the message `"All notifications marked as read"` and an interactive **Undo** button.
4. **Undo Timer:** An active 5-second timer (`setTimeout(..., 5000)`) holds the snapshot. If 5 seconds elapse without an Undo click, the snapshot is cleared.
5. **Undo Execution:** If the user clicks **Undo** within the 5-second window:
   - The 5-second timer is cleared.
   - Local state is restored (`read: false` for the snapshot IDs, and `unreadCount` reverted).
   - An API request is dispatched with the `markAsUnread` action:
     ```json
     {
       "action": "markAsUnread",
       "ids": ["notification-id-1", "notification-id-2"]
     }
     ```
6. **Backend Synchronization:** Meanwhile, the original `markAsRead` POST request proceeds to update the database. If that request fails, local state rolls back and the undo snapshot is cancelled.

> [!NOTE]
> **API Action Usage:** The frontend consumes the `markAsUnread` API action specifically as the backend driver for the toast **Undo** capability, rather than exposing individual "mark as unread" buttons per notification item.

### Implementation Discrepancy Note

The component also contains UI handlers for `clearAllNotifications` (`{ "action": "clearAll" }`) and `dismissNotification` (`{ "action": "dismiss", "id": ... }`).

However, the backend API route in [`src/app/api/user/notifications/route.ts`](../src/app/api/user/notifications/route.ts) currently handles only `markAsRead` and `markAsUnread`. Requests with `clearAll` or `dismiss` are rejected by the server with HTTP `400 Bad Request` (`{"error": "Invalid action"}`). The component handles `clearAll` and `dismiss` optimistically in local state, but backend persistence for those actions is not currently supported by the API route.

---

## Backend Notifications API Specification

The API is implemented in [`src/app/api/user/notifications/route.ts`](../src/app/api/user/notifications/route.ts) and backed by the Prisma `PushNotificationLog` table.

### Authentication

All requests (both `GET` and `POST`) require an authenticated Clerk session (`const { userId } = await auth();`).

Unauthenticated requests immediately return:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json
```

```json
{
  "error": "Unauthorized"
}
```

---

### Data Model and Field State Transitions

Notifications in `PushNotificationLog` maintain two related fields:

- **`status`** (string): Current lifecycle state (e.g., `"DELIVERED"`, `"READ"`).
- **`read`** (boolean): Flag indicating read status (`true` or `false`).

When notifications are marked as read or unread, both fields transition in tandem:

| Action         | Target `status` | Target `read` | Scope                                                       |
| -------------- | --------------- | ------------- | ----------------------------------------------------------- |
| `markAsRead`   | `'READ'`        | `true`        | All unread records (`status != 'READ'`) for the user.       |
| `markAsUnread` | `'DELIVERED'`   | `false`       | Explicit array of matching notification `ids` for the user. |

---

### 1. GET `/api/user/notifications`

Retrieves the authenticated user's latest notifications and total unread count.

#### Request

```http
GET /api/user/notifications HTTP/1.1
```

#### Behavior & Query Semantics

- **User Scoping:** Scoped strictly to the authenticated `userId`.
- **Sorting:** Sorted by creation timestamp descending (`orderBy: { createdAt: "desc" }`).
- **Pagination Limit:** Returns at most **20 records** (`take: 20`).
- **Unread Count Calculation:** Computed using an independent Prisma count query:
  ```typescript
  const unreadCount = await prisma.pushNotificationLog.count({
    where: { userId, status: { not: "READ" } },
  });
  ```

> [!IMPORTANT]
> **Unread Count vs. Returned Array:**
> The `unreadCount` integer reflects **all** unread notifications belonging to the user across the database (`status != "READ"`). It is **not** restricted to the 20 notification records returned in the `notifications` array.

#### Success Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "notifications": [
    {
      "id": "cm3a1b2c3000008l0g1h2i3j4",
      "userId": "user_2test123456",
      "title": "Booking Confirmed",
      "body": "Your desk reservation at Tech Hub is confirmed.",
      "read": false,
      "status": "DELIVERED",
      "venueId": "venue_sf_456",
      "createdAt": "2026-11-21T18:30:00.000Z",
      "updatedAt": "2026-11-21T18:30:00.000Z"
    }
  ],
  "unreadCount": 1
}
```

---

### 2. POST `/api/user/notifications` — `markAsRead`

Marks all unread notifications for the authenticated user as read.

#### Request

```http
POST /api/user/notifications HTTP/1.1
Content-Type: application/json
```

```json
{
  "action": "markAsRead"
}
```

#### Database Transaction & Concurrency Guarantees

To ensure thread safety and prevent deadlocks during concurrent UI interactions, `markAsRead` executes raw SQL inside an explicit Prisma transaction with row-level locking:

```typescript
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`
    UPDATE "PushNotificationLog"
    SET "status" = 'READ', "read" = true
    WHERE "id" IN (
      SELECT "id"
      FROM "PushNotificationLog"
      WHERE "userId" = ${userId} AND "status" != 'READ'
      FOR UPDATE SKIP LOCKED
    )
  `;
});
```

- **`FOR UPDATE SKIP LOCKED`:** Locks candidate unread rows while skipping any rows already locked by concurrent transactions. This prevents blocking and eliminates serialization deadlocks during high-concurrency bursts.
- **Bounded Retry Wrapper:** Wrapped in `executeWithRetry` (detailed below).
- **Ownership Scoping:** The query filters by `userId`, ensuring a user can never lock or mutate another user's notifications.

#### Success Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "success": true
}
```

_Note: The response does not return an updated notification count or an array of updated IDs._

---

### 3. POST `/api/user/notifications` — `markAsUnread`

Restores specified notifications to an unread (`DELIVERED`) state. This action powers the frontend Undo toast mechanism.

#### Request

```http
POST /api/user/notifications HTTP/1.1
Content-Type: application/json
```

```json
{
  "action": "markAsUnread",
  "ids": ["cm3a1b2c3000008l0g1h2i3j4", "cm3a1b2c3000008l0g1h2i3j5"]
}
```

#### Behavior & Query Semantics

- **Payload Validation:** `ids` must be an array with a length greater than 0 (`Array.isArray(body.ids) && body.ids.length > 0`). If `ids` is missing, null, not an array, or empty, the request is rejected with HTTP `400 Bad Request`.
- **Database Execution:** Uses Prisma `updateMany`:
  ```typescript
  await prisma.pushNotificationLog.updateMany({
    where: {
      userId,
      id: { in: body.ids },
    },
    data: {
      status: "DELIVERED",
      read: false,
    },
  });
  ```
- **Prisma Execution Scope:** Unlike `markAsRead`, this action does **not** create an explicit Prisma `$transaction` or raw SQL lock. It executes a single `updateMany` statement.
- **Bounded Retry Wrapper:** Wrapped in `executeWithRetry`.
- **Strict Ownership Enforcement:** The `where` clause couples `userId` with `id: { in: body.ids }`. Notifications belonging to another user cannot be modified, even if their IDs are passed in the request.
- **Unknown IDs:** If supplied IDs do not exist or belong to another user, they are ignored. The endpoint still returns `{ "success": true }`.
- **No Count Returned:** The response does not report the number of updated records.

#### Success Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```

```json
{
  "success": true
}
```

---

## Bounded Concurrency Retry Wrapper

Both `markAsRead` and `markAsUnread` operations are executed through a shared bounded retry helper (`executeWithRetry`):

```typescript
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  retries = 5,
  delay = 50,
): Promise<T> { ... }
```

### Retry Characteristics

- **Maximum Attempts:** Bounded at **5 attempts** in total (`retries = 5`).
- **Selective Retry Criteria:** Retries **only** specific transaction conflicts and serialization failures:
  - Prisma error code `P2034` (transaction conflict or write conflict).
  - PostgreSQL error code `40001` (serialization failure).
  - PostgreSQL error code `40P01` (deadlock detected).
  - Error messages explicitly containing `"deadlock"` or `"serialization"`.
- **Immediate Failure on Non-Retryable Errors:** Arbitrary database errors (such as connection loss, constraint violations like `P2002`, or syntax errors) are **not** retried and fail immediately.
- **Backoff Schedule:** Applies exponential backoff with random jitter:
  $$\text{backoff} = \text{delay} \times 2^{\text{attempt}} + \text{random}(0, 50)\text{ ms}$$
  Starting from a base delay of $50\text{ ms}$.

---

## Error Responses and Status Codes

| Status Code                     | Error Response                       | Cause                                                                                                                      |
| ------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **`401 Unauthorized`**          | `{"error": "Unauthorized"}`          | Request missing an authenticated Clerk session context (`userId` is null).                                                 |
| **`400 Bad Request`**           | `{"error": "Invalid action"}`        | Action is unsupported (e.g., `clearAll`, `dismiss`), or payload for `markAsUnread` has missing, non-array, or empty `ids`. |
| **`500 Internal Server Error`** | `{"error": "Internal Server Error"}` | Unhandled database exception, unexpected server error, or failure persisting after all 5 retry attempts.                   |
