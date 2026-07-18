# Toast Notifications

## Overview

WorkSphere uses a custom React-based toast notification system to provide quick feedback for user actions. The toast system is implemented using React state instead of a third-party toast library.

Toast notifications provide users with immediate feedback without interrupting their workflow.

---

# Toast Implementation

The application uses a custom React state for managing toast notifications.

```tsx
const [toast, setToast] = useState<{
  message: string;
  type: "error" | "warning" | "success";
} | null>(null);
```

---

# Supported Toast Variants

The application currently supports the following toast variants:

- Success
- Error
- Warning

The notification system can also be extended to support additional variants, such as informational messages, if required in the future.

---

# Toast Position

Toast notifications are displayed at the **bottom-right** corner of the screen.

---

# Duration

Toast notifications automatically disappear after **4 seconds**.

```tsx
setTimeout(() => setToast(null), 4000);
```

---

# Manual Dismiss

Each toast includes a close button that allows users to dismiss the notification before the automatic timeout.

---

# Triggering Toast Notifications

## Success

```tsx
setToast({
  message: "Operation completed successfully.",
  type: "success",
});
```

## Error

```tsx
setToast({
  message: "Something went wrong.",
  type: "error",
});
```

## Warning

```tsx
setToast({
  message: "Location access denied.",
  type: "warning",
});
```

---

# Custom Toast Content

Each toast contains:

- Status indicator
- Notification message
- Close button
- Glassmorphism styling
- Smooth appearance animation

---

# Recommended Usage

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

# Best Practices

- Keep messages short and clear.
- Show one notification per action.
- Use the appropriate toast type.
- Avoid duplicate notifications.
- Display meaningful error messages.

---

# Summary

The custom toast notification system provides lightweight, non-blocking feedback throughout the application. Notifications appear in the bottom-right corner, automatically dismiss after four seconds, and can also be closed manually by the user.