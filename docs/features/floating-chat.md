# Floating Chat Slash Commands and Local Storage Persistence

Comprehensive developer and architecture guide for WorkSphere's floating chat channel, slash command handling (`/clear`), and client-side `localStorage` persistence mechanisms.

---

## Table of Contents

1. [Overview](#1-overview)
   - [Core Purpose and Capabilities](#core-purpose-and-capabilities)
   - [Drawer Toggle and Interaction Model](#drawer-toggle-and-interaction-model)
   - [UI Elements and Visual States](#ui-elements-and-visual-states)
   - [State Lifecycle and Hydration](#state-lifecycle-and-hydration)
2. [Supported Commands and Keyboard Shortcuts](#2-supported-commands-and-keyboard-shortcuts)
   - [Commands and Shortcuts Reference Table](#commands-and-shortcuts-reference-table)
   - [Detailed `/clear` Command Architecture](#detailed-clear-command-architecture)
   - [Keyboard Shortcut Handling](#keyboard-shortcut-handling)
3. [LocalStorage Persistence and Lifecycle](#3-localstorage-persistence-and-lifecycle)
   - [LocalStorage Key Schema](#localstorage-key-schema)
   - [Data Structure Examples](#data-structure-examples)
   - [State Transition Lifecycle Matrix](#state-transition-lifecycle-matrix)
   - [Draft Text vs. Component State](#draft-text-vs-component-state)
4. [Storage Quota and Error Handling](#4-storage-quota-and-error-handling)
   - [Current Quota Exceeded Exception Handling](#current-quota-exceeded-exception-handling)
   - [Degraded Offline and Private Browsing Behavior](#degraded-offline-and-private-browsing-behavior)
   - [Limitations and Recommended Future Improvements](#limitations-and-recommended-future-improvements)
5. [Security and XSS Prevention](#5-security-and-xss-prevention)
   - [Input Processing and Normalization](#input-processing-and-normalization)
   - [Output Rendering and Safe React DOM Escaping](#output-rendering-and-safe-react-dom-escaping)
   - [Restored State Sanitization](#restored-state-sanitization)
   - [Input Sanitization vs Safe Output Rendering](#input-sanitization-vs-safe-output-rendering)
6. [Developer Integration Guide](#6-developer-integration-guide)
   - [Core Components and Hooks Reference](#core-components-and-hooks-reference)
   - [Adding or Modifying Slash Commands](#adding-or-modifying-slash-commands)
   - [Customizing Unread Message Tracking](#customizing-unread-message-tracking)
   - [Safely Adding New Persisted Fields](#safely-adding-new-persisted-fields)
   - [Writing Regression and Unit Tests](#writing-regression-and-unit-tests)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Overview

### Core Purpose and Capabilities

The **Floating Chat** feature in WorkSphere provides a collapsible, lightweight channel for real-time collaboration within workspace rooms and venue discovery views. It enables users to exchange real-time messages with peers over WebRTC data channels or broadcast delegates without obscuring the main workspace content.

Key capabilities include:

- **Collapsible Floating Drawer:** Accessible as a persistent floating trigger in the UI that toggles an active chat drawer.
- **Unread Message Notification Badges:** Automatic calculation and display of unread message badges while the chat drawer is collapsed, with visual clamping (`99+`) and real-time counter clearing upon drawer expansion.
- **Client-Side Persistence:** Local persistence of conversation history, last read timestamps, and unread counts in `localStorage`, maintaining continuity across page reloads and browser sessions without requiring a database roundtrip.
- **Slash Command System:** Direct command interception (notably `/clear`) for local message cleanup and state resets without peer network disruption.
- **Message Deduplication:** Tracking of processed and seen message identifiers to prevent duplicate message bubbles during rapid network reconnection or sync cycles.

### Drawer Toggle and Interaction Model

The chat interface is controlled through `src/components/chat/FloatingChatToggle.tsx` combined with the `useChatChannel` hook (`src/hooks/useChatChannel.ts`):

```
       +---------------------------------------------+
       |             FloatingChatToggle              |
       |  [ MessageSquare Icon / X Icon (Toggles) ]  |
       |  [ Unread Count Badge: 1..99, 99+        ]  |
       |  [ Inline System Notice: Clear status    ]  |
       +---------------------------------------------+
                              |
                     onToggle / click
                              v
       +---------------------------------------------+
       |               useChatChannel                |
       |  - Tracks isOpen state                      |
       |  - Synchronizes lastReadTimestamp           |
       |  - Resets unreadCount to 0 on open          |
       |  - Persists & restores messages             |
       +---------------------------------------------+
```

1. **Opening the Drawer:** Clicking the floating toggle button when `isOpen === false` expands the chat drawer, updates `isOpen` to `true`, marks the active room as read (`lastReadTimestamp = Date.now()`), and resets `unreadCount` to `0`.
2. **Closing the Drawer:** Clicking the floating toggle button when `isOpen === true` collapses the drawer and changes the toggle icon from `X` back to `MessageSquare`.
3. **Cross-Component Events:** When a room is marked as read or unread counts update, a `worksphere:unread-messages-changed` DOM `CustomEvent` is dispatched, synchronizing unread counts with navigation items (such as the `TopNav` discovery badge).

### UI Elements and Visual States

The primary UI component is `FloatingChatToggle`:

- **Toggle Button (`data-testid="floating-chat-toggle"`):** A circular floating action button styled with violet background (`bg-violet-600 hover:bg-violet-700 text-white shadow-xl w-14 h-14 rounded-full`). It utilizes accessible attributes:
  - `aria-expanded`: Reflects the boolean open/closed state.
  - `aria-label`: Dynamically constructed as `"Close chat drawer"` when open, `"Open chat drawer (N unread messages)"` when unread messages exist, or `"Open chat drawer"`.
- **Toggle Icon:** Displays `Lucide.MessageSquare` when collapsed, transitioning to `Lucide.X` when open.
- **Unread Badge (`data-testid="floating-chat-unread-badge"`):** A badge mounted at `-top-1 -right-1` of the toggle button:
  - **Visibility Rule:** Rendered **only** when collapsed (`!isOpen`) and `unreadCount > 0`. When the drawer is open, the badge is never rendered.
  - **Text Formatting:** Clamped using `formatUnreadCount()`: returns `""` for 0, `"1"` to `"99"` for values 1–99, and `"99+"` for any value greater than 99.
  - **Animation:** Animated with `animate-pulse scale-100 opacity-100 transition-all`.
- **Inline System Notice (`data-testid="floating-chat-system-notice"`):** Rendered above the toggle button when `isOpen === true` and a system notice message is present in the active channel (`m.isSystem === true` or `m.senderName === 'System'`). It announces status updates to screen readers with `role="status"` and `aria-live="polite"`.

### State Lifecycle and Hydration

1. **Initial Mount:** When `useChatChannel` mounts:
   - Reads message history from `localStorage` under `getChatHistoryStorageKey(roomId, userId)`. If records exist, initializes `messages` with the stored records; otherwise, falls back to `initialMessages`.
   - Reads `lastReadTimestamp` from `localStorage` using `getLastReadTimestamp(roomId, userId)`.
   - Reads `unreadCount` from `localStorage` using `getStoredUnreadCount(roomId, userId)`. If `initialIsOpen === true`, unread count initializes to `0`.
2. **Live Updates:** Arriving messages are appended to component state and immediately serialized to `localStorage` via `setStoredChatHistory()`.
3. **Unmount / Reload:** Component state unmounts cleanly without side effects because state is continually mirrored in `localStorage`. Upon browser refresh or tab reopen, `useChatChannel` rehydrates messages, last-read timestamps, and unread counts immediately during state initialization.

---

## 2. Supported Commands and Keyboard Shortcuts

### Commands and Shortcuts Reference Table

| Command / Shortcut | Action                  | Behavior                                                                                                                                                                                                                                                                                                                                                                                                          |
| :----------------- | :---------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/clear`           | Clear Local History     | Intercepted in `useChatChannel.sendMessage()`. Clears active channel's local message history from React state and removes `localStorage` persistence. Resets unread count to `0`, clears deduplication cache (`processedMessageIdsRef`), and injects an inline system notice `"Chat history cleared locally."`. **Does not** broadcast `/clear` to room peers. Case-insensitive and trims surrounding whitespace. |
| `Enter`            | Submit / Send Message   | Triggers `handleFormSubmit()` on the chat `<form>`. Validates non-empty input (`safeInput.trim()`) and character length limit (`<= 2000`). If valid, appends input to recent searches history (`ws-recent-searches`), emits the message via `onSubmit`, updates persistence, and invokes `onBroadcastMessage`.                                                                                                    |
| `Shift + Enter`    | Multiline / Form Bypass | In single-line `<input type="text">` elements (used in `ChatInput`), standard browser behavior does not trigger `<form>` submission when `Shift` is held, allowing input continuation. (In multiline textareas, `Shift + Enter` inserts a newline without triggering form submission).                                                                                                                            |
| `Ctrl + K` / `⌘K`  | Focus Search Input      | Focuses the chat input field from anywhere in the window. On macOS/iOS systems, the displayed keyboard hint adapts to `⌘K`; on Windows/Linux, it displays `Ctrl+K`.                                                                                                                                                                                                                                               |
| `Escape`           | Dismiss Modal / Preview | Dismisses the attached image preview modal or clears open modal overlays without submitting chat contents.                                                                                                                                                                                                                                                                                                        |

> [!NOTE]
> WorkSphere floating chat implements **only** the `/clear` slash command. Other common IRC or bot commands (such as `/help`, `/nick`, `/me`, `/join`) are **not** supported by `useChatChannel` and will be processed and sent as standard message text.

### Detailed `/clear` Command Architecture

The `/clear` command is intercepted client-side inside `useChatChannel.ts`:

```typescript
// src/hooks/useChatChannel.ts
const sendMessage = useCallback(
  (rawContent: string, senderOverride?: { id?: string; name?: string }) => {
    if (!rawContent) return false;
    const trimmed = rawContent.trim();

    // Intercept /clear command
    if (trimmed.toLowerCase() === "/clear") {
      clearChatHistory();
      return true;
    }

    // Normal message flow...
  },
  [clearChatHistory, ...],
);
```

#### What `/clear` Clears

- **React Message State:** All user and peer messages in the active channel's `messages` state array are wiped out.
- **LocalStorage History:** Calls `clearStoredChatHistory(roomId, currentUserId)`, executing `localStorage.removeItem(key)` for the scoped channel key.
- **Unread Counter:** Calls `markRoomAsRead()`, setting the stored unread count in `localStorage` to `"0"` and dispatching `UNREAD_MESSAGES_CHANGED_EVENT`.
- **Deduplication Cache:** Resets `processedMessageIdsRef.current.clear()`. This prevents identifier collisions (#10122) if an incoming message arrives with an ID identical to one previously cleared.

#### What Remains After `/clear`

- **Inline System Notice:** An ephemeral system notice message is appended to local state:
  ```json
  {
    "id": "sys-clear-1732470000000-abc1234",
    "senderName": "System",
    "content": "Chat history cleared locally.",
    "timestamp": 1732470000000,
    "roomId": "default",
    "isSystem": true
  }
  ```
- **Peer History Unaffected:** `/clear` is strictly local to the executing client. Because `onBroadcastMessage` is bypassed, peer clients retain their complete conversation history.
- **Other Channels Unaffected:** Because keys are partitioned by `roomId` and `userId`, clearing room `alpha` leaves room `beta` history and unread counters intact.
- **Persistence Exclusion:** System notices (`isSystem: true`) are intentionally excluded by `setStoredChatHistory()` when saving messages (`messages.filter(m => !m.isSystem)`). Therefore, upon page refresh after `/clear`, the history remains completely empty (`[]`).

### Keyboard Shortcut Handling

In `src/components/chat/ChatInput.tsx`, keyboard interactions are wired to the form and input lifecycle:

- The `<input>` field is wrapped in a `<form id="ws-chat-form" onSubmit={handleFormSubmit}>`. Pressing `Enter` triggers standard HTML form submit.
- Empty or whitespace-only submissions are blocked by `!input.trim()`.
- Messages exceeding `MAX_CHARS = 2000` are blocked by `isOverLimit`.
- The `Ctrl+K` / `⌘K` badge is visible when the input is empty and hidden as soon as the user starts typing.

---

## 3. LocalStorage Persistence and Lifecycle

### LocalStorage Key Schema

All floating chat keys are managed through isolated utility functions in `src/hooks/useChatChannel.ts`, `src/lib/chat/unreadTracker.ts`, and `src/components/chat/ChatInput.tsx`:

| Storage Key                                                                          | Stored Data                                | Data Format                                             | Lifecycle                                                                                                                                      |
| :----------------------------------------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `ws-chat-history:room:<roomId>`<br>_(or `ws-chat-history:u:<userId>:room:<roomId>`)_ | Channel message history                    | JSON array of `ChatChannelMessage` objects              | Created on first sent or received message. Updated on each message. Removed on `/clear`. Restored on hook initialization.                      |
| `ws-unread:room:<roomId>`<br>_(or `ws-unread:u:<userId>:room:<roomId>`)_             | Unread message count                       | Stringified integer (`"0"`, `"1"`, `"5"`)               | Created on first unread message. Incremented when messages arrive while closed. Reset to `"0"` on drawer open, `/clear`, or input focus.       |
| `ws-last-read:room:<roomId>`<br>_(or `ws-last-read:u:<userId>:room:<roomId>`)_       | Last read epoch timestamp                  | Stringified integer in milliseconds (`"1732470000000"`) | Created when room is first viewed. Updated to `Date.now()` on drawer open, toggle open, input focus, or user message submission.               |
| `ws-recent-searches`                                                                 | Recent queries/terms entered in chat input | JSON array of strings (max 5 items)                     | Created on submitting search/chat text. Updated to prepend latest query (max 5). Removed when user clicks "Clear" in recent searches dropdown. |

### Data Structure Examples

#### 1. Persisted Channel Message History (`ws-chat-history:...`)

```json
[
  {
    "id": "msg-1732471200000-x9k2p8z",
    "senderId": "user-uuid-101",
    "senderName": "Alice Developer",
    "content": "Does the Quiet Floor have strong Wi-Fi?",
    "timestamp": 1732471200000,
    "roomId": "room-fl-2"
  },
  {
    "id": "msg-1732471205000-m4n7q1r",
    "senderId": "user-uuid-202",
    "senderName": "Bob Nomad",
    "content": "Yes, 350 Mbps symmetrical tested this morning.",
    "timestamp": 1732471205000,
    "roomId": "room-fl-2"
  }
]
```

_(Note: System notice objects with `isSystem: true` are filtered out before serialization and are never stored in this array)._

#### 2. Unread Message Count (`ws-unread:...`)

```
"3"
```

#### 3. Last Read Timestamp (`ws-last-read:...`)

```
"1732471205000"
```

#### 4. Recent Searches (`ws-recent-searches`)

```json
[
  "Quiet library near Shibuya",
  "High speed wifi cafe",
  "Standing desk coworking"
]
```

### State Transition Lifecycle Matrix

| Event / Action                       | React State (`messages`, `isOpen`, `unreadCount`)                                                                                                                                | `localStorage` Storage Keys Effect                                                                         | Cross-Tab / Window Events                                                          |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------- |
| **Component Mounts**                 | `messages` initialized from `localStorage` (`getStoredChatHistory`). `unreadCount` initialized from `localStorage` (or `0` if `initialIsOpen`). `isOpen` set to `initialIsOpen`. | Keys read via `localStorage.getItem()`. No keys written.                                                   | No events emitted.                                                                 |
| **User Sends Message**               | Message appended to `messages`. `lastReadTimestamp` updated to `Date.now()`.                                                                                                     | `ws-chat-history` overwritten with new array. `ws-last-read` updated.                                      | Broadcast to peers via `onBroadcastMessage(msg)`.                                  |
| **Incoming Message (Drawer Closed)** | Message appended to `messages`. `unreadCount` incremented by 1 (if not self and `timestamp > lastReadTimestamp`).                                                                | `ws-chat-history` overwritten with new array. `ws-unread` updated to incremented count.                    | Dispatches `UNREAD_MESSAGES_CHANGED_EVENT` with `{ roomId, count }`.               |
| **Incoming Message (Drawer Open)**   | Message appended to `messages`. `unreadCount` remains `0`. `lastReadTimestamp` updated to message timestamp.                                                                     | `ws-chat-history` updated. `ws-last-read` updated. `ws-unread` set to `"0"`.                               | Dispatches `UNREAD_MESSAGES_CHANGED_EVENT` with `count: 0`.                        |
| **User Toggles Open Drawer**         | `isOpen` becomes `true`. `unreadCount` set to `0`. `lastReadTimestamp` set to `Date.now()`.                                                                                      | `ws-unread` set to `"0"`. `ws-last-read` set to current timestamp.                                         | Dispatches `UNREAD_MESSAGES_CHANGED_EVENT` with `count: 0`.                        |
| **User Executes `/clear`**           | `messages` replaced with single inline system notice (`[ChatChannelMessage(isSystem: true)]`). `unreadCount` set to `0`. `processedMessageIdsRef` cleared.                       | `ws-chat-history` completely deleted via `removeItem()`. `ws-unread` set to `"0"`. `ws-last-read` updated. | Dispatches `UNREAD_MESSAGES_CHANGED_EVENT` with `count: 0`. **No** peer broadcast. |
| **Component Unmounts / Reload**      | Component state torn down. Upon browser refresh, state is rehydrated identically from `localStorage`.                                                                            | Values in `localStorage` persist across reloads.                                                           | `storage` listener in other tabs synchronizes unread badge via `StorageEvent`.     |

### Draft Text vs. Component State

> [!IMPORTANT]
> **Draft text in floating chat is NOT persisted to `localStorage`.**  
> The unsent text in the chat input is managed solely in React component state (`ChatInput`'s `safeInput` / `input` prop). If the user refreshes the page or navigates away before sending, any uncommitted draft text in the composer is discarded.  
> Do not confuse chat input draft text with WorkSphere's offline **booking draft** system (`DraftStore.ts` and `SyncQueue.ts`), which uses IndexedDB for offline reservation forms.

---

## 4. Storage Quota and Error Handling

### Current Quota Exceeded Exception Handling

The implementation wraps all `localStorage` access points in defensive `try...catch` blocks to prevent uncaught browser exceptions:

```typescript
// From src/hooks/useChatChannel.ts
export function setStoredChatHistory(
  messages: ChatChannelMessage[],
  roomId: string = "default",
  userId?: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const toStore = messages.filter((m) => !m.isSystem);
    localStorage.setItem(
      getChatHistoryStorageKey(roomId, userId),
      JSON.stringify(toStore),
    );
  } catch {
    // Ignore quota issues
  }
}
```

Similarly, in `src/lib/chat/unreadTracker.ts`:

```typescript
try {
  localStorage.setItem(getUnreadStorageKey(roomId, userId), String(safeCount));
} catch {
  // Ignore quota issues
}
```

### Degraded Offline and Private Browsing Behavior

If the client environment restricts or denies `localStorage` access (e.g., Safari Private Browsing mode with storage quota 0, storage disabled by enterprise policy, or browser storage quota exceeded):

- **Continuous Operation:** The application **does not crash**. The `try...catch` swallows `QuotaExceededError` or `SecurityError`.
- **In-Memory Fallback:** `useChatChannel` continues functioning normally within the active React session using memory state (`messages`, `unreadCount`, and `isOpen`).
- **Degradation:** State persists only for the duration of the current page session. Refreshing or navigating away will reset messages to `initialMessages` and unread counts to `0`.

### Limitations and Recommended Future Improvements

#### Current Limitations

1. **Silent Drop:** When storage fails due to quota limits, write failures are silently dropped without alerting the user or clearing older messages.
2. **Unbounded History:** While input strings are capped at 2,000 characters per message, the messages array is not capped in length, which could eventually exceed the standard 5 MB per-domain quota on long-running channels.
3. **No Automatic Pruning:** No LRU or sliding-window mechanism exists to prune the oldest messages when storage is near capacity.

#### Recommended Future Enhancements

- **Sliding Window Pruning:** Implement a maximum cap (e.g., last 100 non-system messages) in `setStoredChatHistory()`:
  ```typescript
  const MAX_HISTORY_ITEMS = 100;
  const toStore = messages.filter((m) => !m.isSystem).slice(-MAX_HISTORY_ITEMS);
  ```
- **LRU Cache Eviction:** If `localStorage.setItem()` throws a `QuotaExceededError`, catch the error and evict the oldest 20 messages or older room keys before retrying.
- **IndexedDB Migration:** For heavy collaborative rooms, migrate message persistence from `localStorage` to IndexedDB (leveraging the existing offline store patterns in `src/worker/bookingSync/DraftStore.ts`).

---

## 5. Security and XSS Prevention

### Input Processing and Normalization

When user input is received through `ChatInput` and processed before display:

1. **Character Limit Enforcement:** Input length is bounded to 2,000 characters (`MAX_CHARS = 2000`). Submissions over this limit are blocked.
2. **Whitespace Normalization:** Leading and trailing whitespace is stripped via `.trim()`. In `src/components/chat/ChatPanel.tsx`, `sanitizeChatInput()` further strips Unicode zero-width characters (`\u200B-\u200D\uFEFF`) and normalizes ideographic/non-breaking spaces to standard spaces (`[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]`).
3. **Tag Stripping:** In `sanitizeChatInput()`, explicit `<script>` and `<iframe>` injection tags are stripped out via regular expressions.
4. **Markdown Image Sanitization:** In `src/lib/chat/sanitize.ts`, markdown image expressions (`![alt](url)`) are strictly inspected against `TRUSTED_IMAGE_HOSTS` (`res.cloudinary.com`, `images.unsplash.com`). Untrusted image URLs are automatically demoted to standard hyperlinks (`[alt](url)`), and non-HTTP(S) schemes (e.g., `javascript:`, `data:`) are stripped.

### Output Rendering and Safe React DOM Escaping

WorkSphere avoids direct DOM injection in its chat message and notice rendering paths:

1. **React Text Escaping:** Message content is rendered as React text nodes (`<span>{message.content}</span>` or `{systemNotes[...].content}`). React treats all string variables in JSX as plain text, converting characters like `<`, `>`, `&`, `"`, and `'` into safe HTML entities.
2. **Absence of `dangerouslySetInnerHTML`:** Inspection of the floating chat component hierarchy (`FloatingChatToggle.tsx`, `ChatMessages.tsx`, `ChatInput.tsx`, `ChatPanel.tsx`) confirms that **`dangerouslySetInnerHTML` is never used** to render user chat content.
   - Any raw HTML or script payload provided by a user (e.g., `<img src=x onerror=alert(1)>`) is rendered literally as text rather than being evaluated by the browser.
3. **Markdown Segment Parser:** Where markdown formatting is rendered (via `parseSanitizedChatSegments()`), text tokens are returned as `{ type: 'text', value: string }` and rendered directly as standard React JSX strings.

### Restored State Sanitization

When stored messages are hydrated from `localStorage` via `getStoredChatHistory()`:

- `JSON.parse(raw)` is wrapped in a `try...catch`. If invalid JSON is encountered, it falls back to an empty array `[]`.
- Deserialized data is validated with `Array.isArray(parsed)`.
- When passed into React state, all reconstructed messages continue to be rendered through standard React JSX string interpolation. Even if an attacker manually tampers with `localStorage` to inject HTML strings, React renders them as escaped text strings.

### Input Sanitization vs Safe Output Rendering

| Principle        | Input Sanitization (`sanitizeChatInput`)                                                                                                 | Safe Output Rendering (React JSX)                                                                    |
| :--------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| **Location**     | Client-side input event / message submission handler.                                                                                    | Rendering engine / DOM mounting phase.                                                               |
| **Primary Goal** | Normalize formatting, enforce lengths, strip invisible control characters, and clean malicious intent before broadcasting over the wire. | Prevent arbitrary code execution in the DOM regardless of how data was stored or tampered with.      |
| **Scope**        | Defense-in-depth; protects network peers and backend services.                                                                           | Primary XSS barrier; guarantees browser renders content as text nodes rather than executable markup. |

---

## 6. Developer Integration Guide

### Core Components and Hooks Reference

All floating chat functionality is organized into modular files:

- [src/components/chat/FloatingChatToggle.tsx](file:///c:/Users/Saransh%20Kashyap/WorkSphere-10102-worktree/src/components/chat/FloatingChatToggle.tsx): Floating toggle button, unread badge, and inline system notice banner.
- [src/hooks/useChatChannel.ts](file:///c:/Users/Saransh%20Kashyap/WorkSphere-10102-worktree/src/hooks/useChatChannel.ts): State machine, slash command interception, deduplication, and `localStorage` persistence.
- [src/lib/chat/unreadTracker.ts](file:///c:/Users/Saransh%20Kashyap/WorkSphere-10102-worktree/src/lib/chat/unreadTracker.ts): Storage key derivation, unread badge formatting, last-read timestamp sync, and custom event broadcasting.
- [src/components/chat/ChatInput.tsx](file:///c:/Users/Saransh%20Kashyap/WorkSphere-10102-worktree/src/components/chat/ChatInput.tsx): Keyboard handling (`Enter`, `Ctrl+K`), voice input, search history persistence, and form submission.
- [src/lib/chat/sanitize.ts](file:///c:/Users/Saransh%20Kashyap/WorkSphere-10102-worktree/src/lib/chat/sanitize.ts): Markdown image validation and host allowlisting.

### Adding or Modifying Slash Commands

To add or update slash commands, modify the `sendMessage` callback in `src/hooks/useChatChannel.ts`:

```typescript
// In src/hooks/useChatChannel.ts
const sendMessage = useCallback(
  (rawContent: string, senderOverride?: { id?: string; name?: string }) => {
    if (!rawContent) return false;
    const trimmed = rawContent.trim();

    // 1. Intercept /clear
    if (trimmed.toLowerCase() === "/clear") {
      clearChatHistory();
      return true;
    }

    // 2. Example: Add /help or custom command
    if (trimmed.toLowerCase() === "/help") {
      const helpNotice: ChatChannelMessage = {
        id: `sys-help-${Date.now()}`,
        senderName: "System",
        content: "Available commands: /clear - Wipe local history.",
        timestamp: Date.now(),
        roomId,
        isSystem: true,
      };
      setMessages((prev) => [...prev, helpNotice]);
      return true; // Intercepted: do not broadcast to peers
    }

    // 3. Normal message flow...
    // ...
  },
  [clearChatHistory, roomId, ...],
);
```

### Customizing Unread Message Tracking

Unread tracking is scoped by `roomId` and optional `userId`. To integrate or adjust unread behaviors:

- **Change Unread Count Threshold or Formatting:** Modify `formatUnreadCount()` in `src/lib/chat/unreadTracker.ts`.
- **Sync with Global Navbar or Header:** Listen to `UNREAD_MESSAGES_CHANGED_EVENT`:
  ```typescript
  import {
    UNREAD_MESSAGES_CHANGED_EVENT,
    UnreadBadgeDetail,
  } from "@/lib/chat/unreadTracker";

  useEffect(() => {
    const handleUnread = (e: Event) => {
      const detail = (e as CustomEvent<UnreadBadgeDetail>).detail;
      console.log(`Room ${detail.roomId} unread: ${detail.count}`);
    };
    window.addEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnread);
    return () =>
      window.removeEventListener(UNREAD_MESSAGES_CHANGED_EVENT, handleUnread);
  }, []);
  ```

### Safely Adding New Persisted Fields

When extending `ChatChannelMessage` (e.g., adding `avatarUrl`, `attachments`, or `reactions`):

1. **Update Interface:** Update `ChatChannelMessage` in `src/hooks/useChatChannel.ts`.
2. **Maintain Backward Compatibility:** Ensure any new field is optional (`avatarUrl?: string`).
3. **Filter System Metadata:** Verify that any transient or system properties are omitted from `setStoredChatHistory()` so they do not pollute `localStorage`.
4. **Sanitize Data:** If storing custom user metadata, validate and sanitize values prior to calling `setStoredChatHistory()`.

### Writing Regression and Unit Tests

Tests for floating chat are located in `src/__tests__/components/chat/FloatingChatToggle.test.tsx` and `src/__tests__/components/ChatUnreadBadge.test.tsx`.

When adding features or regression tests:

1. Always reset `localStorage.clear()` in `beforeEach()`.
2. Wrap state-modifying hook calls in `act()`.
3. Verify both React state and `localStorage.getItem()` assertions.
4. Test channel isolation by rendering two hooks with different `roomId` values.

Example test pattern:

```typescript
it("resets history and unread count upon executing /clear", () => {
  const { result } = renderHook(() =>
    useChatChannel({ roomId: "test-room", currentUserId: "user-1" }),
  );

  act(() => {
    result.current.sendMessage("Hello world");
  });
  expect(result.current.messages).toHaveLength(1);

  act(() => {
    const intercepted = result.current.sendMessage("/clear");
    expect(intercepted).toBe(true);
  });

  expect(result.current.messages[0].content).toBe(
    "Chat history cleared locally.",
  );
  expect(result.current.unreadCount).toBe(0);
  expect(getStoredChatHistory("test-room", "user-1")).toEqual([]);
});
```

---

## 7. Troubleshooting

### Chat History Not Appearing After Reload

- **Cause 1: System Messages Filter:** System notices (including `/clear` confirmation) are never persisted by design (`messages.filter(m => !m.isSystem)`). If the only message in a room was a system notice, history will intentionally be empty after reload.
- **Cause 2: User ID or Room ID Mismatch:** The storage key is strictly scoped by `roomId` and optional `userId` (`ws-chat-history:[u:<userId>:]room:<roomId>`). If the user session loaded under a different `userId` or default room, the previous key will not match.
- **Resolution:** Check `localStorage` in DevTools (Application tab -> Local Storage) for keys starting with `ws-chat-history:`. Verify that `roomId` matches between mounts.

### Unread Counts Not Updating Correctly

- **Cause 1: Drawer Is Open:** When `isOpen === true`, incoming messages are automatically marked as read immediately, and `unreadCount` remains 0.
- **Cause 2: Self Messages:** Messages where `senderId === currentUserId` or `senderName === currentUserName` are ignored by unread counting logic.
- **Cause 3: Outdated Timestamps:** Messages with timestamps less than or equal to `lastReadTimestamp` are treated as historical and do not increment the counter.

### Draft Text Disappearing

- **Cause:** Floating chat input draft text is stored only in component memory (`useState` in `ChatInput.tsx`) and is not persisted to `localStorage`. Page reloads or navigation will clear any unsubmitted input.
- **Resolution:** Users must submit messages by pressing `Enter` or clicking Send. For forms requiring persistence across refreshes (such as reservation drafts), use the dedicated booking draft flow backed by IndexedDB.

### `/clear` Not Behaving as Expected

- **Cause 1: Extra Characters:** Slash command interception requires the input to be `/clear` (with optional whitespace and case-insensitivity). Inputs like `/clear all` or `please /clear` are treated as normal messages and sent to peers.
- **Cause 2: Peer History Expectation:** Executing `/clear` only purges the local browser's storage and state. It does not delete messages on remote peers' browsers or servers.

### Browser Storage Being Unavailable or Full

- **Symptoms:** Chat messages display during the session but disappear on refresh; browser console warnings regarding quota.
- **Verification:** Inspect browser storage quota:
  ```javascript
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage
      .estimate()
      .then(({ usage, quota }) => console.log(usage, quota));
  }
  ```
- **Resolution:** WorkSphere handles storage quota errors gracefully by falling back to in-memory state. Clear outdated domain data or run `/clear` in heavy chat channels to remove stored JSON blobs.

### Unexpected Rendering of User-Provided Content

- **Cause 1: Raw Markdown Images:** Markdown images pointing to untrusted domains are demoted to regular markdown links by `sanitizeChatImageMarkdown()`.
- **Cause 2: HTML Tags in Messages:** HTML tags such as `<b>` or `<script>` are displayed as plain text strings because React escapes JSX text content. This is expected security behavior to prevent XSS.
