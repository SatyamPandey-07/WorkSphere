# Toast Notifications

## Overview

WorkSphere uses a custom React-based toast notification system to provide quick, non-blocking feedback for user actions. Instead of relying on a third-party toast library, the application manages toast notifications using React state.

Toast notifications inform users about successful operations, warnings, and errors without interrupting their workflow.

---

## Toast Implementation

The application uses a custom React state to manage toast notifications.

```tsx
const [toast, setToast] = useState<{
  message: string;
  type: "error" | "warning" | "success";
} | null>(null);
```

The toast is displayed whenever the state is updated and automatically disappears after a configured timeout.

---

## Supported Toast Variants

The current implementation supports the following notification types:

- Success
- Error
- Warning

The notification system can be extended in the future to support additional variants, such as **Info**, if informational notifications are required.

---

## Toast Position

Toast notifications are displayed at the **bottom-right** corner of the application.

---

## Duration

Toast notifications automatically disappear after **4 seconds (4000 milliseconds)**.

```tsx
setTimeout(() => setToast(null), 4000);
```

---

## Manual Dismiss

Each toast includes a close button that allows users to dismiss the notification before the automatic timeout expires.

---

## Triggering Toast Notifications

### Success

Use success notifications when an operation completes successfully.

```tsx
setToast({
  message: "Operation completed successfully.",
  type: "success",
});
```

---

### Error

Use error notifications when an operation fails.

```tsx
setToast({
  message: "Something went wrong.",
  type: "error",
});
```

---

### Warning

Use warning notifications to inform users about recoverable issues or situations that require attention.

```tsx
setToast({
  message: "Location access denied.",
  type: "warning",
});
```

---

### Info

The current implementation does **not** include an Info toast variant.

If an Info notification is introduced in the future, it should follow the same positioning, styling, duration, and dismissal behavior as the existing toast notifications.

---

## Custom Toast Content

Each toast includes:

- Status indicator
- Notification message
- Close button
- Glassmorphism styling
- Smooth entrance animation

---

## Recommended Usage

Use toast notifications for:

- Successful operations
- Validation feedback
- Error messages
- Permission warnings
- Network issues

Avoid using toast notifications for:

- Every button click
- Long-running loading states
- Critical confirmation dialogs

---

## Best Practices

- Keep messages short and easy to understand.
- Show only one notification for each completed action.
- Use the appropriate notification type.
- Avoid duplicate notifications.
- Display meaningful error messages whenever possible.

---

## Summary

The custom toast notification system provides lightweight, non-blocking feedback throughout the application. Notifications appear in the bottom-right corner, automatically disappear after four seconds, and can also be dismissed manually using the close button. This approach helps provide users with timely feedback while maintaining a smooth and responsive user experience.