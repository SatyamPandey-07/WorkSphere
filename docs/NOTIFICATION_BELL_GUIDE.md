# NotificationBell Component Guide

The `NotificationBell` component displays user notifications in the application's top navigation bar. It retrieves notification data from the backend, displays unread counts, and allows users to mark notifications as read.

---

## Component Location

```
src/components/NotificationBell.tsx
```

---

## Props

The component currently does **not** accept any props.

```tsx
import { NotificationBell } from "@/components/NotificationBell";

export default function TopNavigation() {
  return (
    <nav>
      <NotificationBell />
    </nav>
  );
}
```

---

## Features

- Displays unread notification badge.
- Shows the latest 20 notifications.
- Automatically refreshes notifications.
- Marks notifications as read.
- Closes when clicking outside.
- Displays contextual icons for different notification types.
- Links directly to related workspaces when available.

---

## Polling

The component fetches notifications immediately after mounting.

It then refreshes notifications every **20 seconds**.

```ts
setInterval(fetchNotifications, 20000);
```

The polling interval is automatically cleared when the component unmounts.

---

## Backend API

### GET `/api/user/notifications`

Returns the latest notifications and unread count.

Example response:

```json
{
  "notifications": [
    {
      "id": "123",
      "title": "Workspace Available",
      "body": "A workspace is now available.",
      "read": false,
      "createdAt": "2026-07-24T10:00:00Z",
      "venueId": "workspace-id"
    }
  ],
  "unreadCount": 1
}
```

---

### POST `/api/user/notifications`

Marks all unread notifications as read.

Request

```json
{
  "action": "markAsRead"
}
```

Successful response

```json
{
  "success": true
}
```

---

## PushNotificationLog

The notification API stores and retrieves notifications from the `PushNotificationLog` table using Prisma.

### GET

- Retrieves the latest 20 notifications.
- Orders notifications by creation date (newest first).
- Calculates the unread notification count.

### POST

Updates all unread notifications for the authenticated user by changing their status to `READ`.

---

## Authentication

Both API endpoints require an authenticated user through Clerk authentication.

Unauthenticated requests return:

```json
{
  "error": "Unauthorized"
}
```

with HTTP status **401**.

---

## Error Handling

If an unexpected server error occurs, the API returns:

```json
{
  "error": "Internal Server Error"
}
```

with HTTP status **500**.