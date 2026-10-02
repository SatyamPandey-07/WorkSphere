# AI Chatbot Streaming SSR & Hydration Isolation

This document explains why `EnhancedChatbot` is isolated from Next.js server-side rendering, how the hydration-detection hooks work, the `startClosed` PartySocket pattern, and how streaming SSR in React 19 / Next.js App Router differs from classic SSR hydration.

---

## Table of Contents

1. [Why `EnhancedChatbot` uses `ssr: false`](#1-why-enhancedchatbot-uses-ssr-false)
2. [How `useIsHydrated` and `useHydrationComplete` prevent premature connections](#2-how-useishydrated-and-usehydrationcomplete-prevent-premature-connections)
3. [The `startClosed` pattern for PartySocket](#3-the-startclosed-pattern-for-partysocket)
4. [Streaming SSR in React 19 vs traditional SSR hydration](#4-streaming-ssr-in-react-19-vs-traditional-ssr-hydration)
5. [Best practices for client-only components in Next.js App Router](#5-best-practices-for-client-only-components-in-nextjs-app-router)

---

## 1. Why `EnhancedChatbot` uses `ssr: false`

In `src/app/ai/page.tsx`, `EnhancedChatbot` is loaded via Next.js's dynamic import with server-side rendering disabled:

```ts
// src/app/ai/page.tsx
const EnhancedChatbot = dynamic(
  () =>
    import("@/components/EnhancedChatbot").then((mod) => mod.EnhancedChatbot),
  {
    ssr: false,
    loading: () => (
      <div role="status" aria-live="polite" aria-label="Loading chat assistant">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" aria-hidden="true" />
        <span className="sr-only">Loading chat assistant...</span>
      </div>
    ),
  },
);
```

There are several reasons this is required:

### Browser-only APIs

`EnhancedChatbot` and its dependency tree rely on APIs that do not exist in the Node.js server runtime:

- **WebSocket** (`PartySocket`, `usePartySocket`) — the Node.js environment used during SSR has no global `WebSocket` constructor
- **`navigator.geolocation`** — used to resolve the user's precise location before displaying venues
- **`window.addEventListener`** — event listeners for `mousemove`, `online`/`offline`, `keydown` and `visibilitychange` are wired in multiple hooks
- **`navigator.clipboard`** — used to copy session share links
- **`document.createElement`** — used in the chat-export feature to trigger file downloads

Attempting to access any of these on the server will either throw a `ReferenceError` or silently produce invalid output that mismatches the client's render.

### WASM / large dynamic dependencies

The PDF export path (`generateChatPdfReport`) loads `pdf-lib`, which compiles WebAssembly at import time. WASM modules cannot be initialized during a server render, and including the import in the SSR bundle would bloat the server-sent HTML with a module that can never execute there.

### Hydration mismatch during streaming

During App Router's streaming SSR, the server flushes HTML chunks progressively. If `EnhancedChatbot` were rendered on the server, any state initialized from browser-specific values (e.g., `navigator.onLine`, the Clerk user object, WebSocket open/closed state) would differ from the values available on the client at hydration time. React would detect the mismatch and either throw in development or silently discard the server-rendered output in production.

By passing `ssr: false`, the module is excluded from the server render entirely. The server instead emits the `loading` skeleton (a plain spinner `div` with ARIA attributes), and `EnhancedChatbot` is fetched and mounted only after the client JavaScript bundle has loaded and React has finished hydrating the surrounding shell.

### The same pattern for other heavy components

For the same reasons, `Map` (Leaflet requires `window`), `OnboardingTour` (react-joyride uses `window`), and `VenueRatingDialog` are all loaded with `ssr: false`.

---

## 2. How `useIsHydrated` and `useHydrationComplete` prevent premature connections

Even after the `ssr: false` module finishes loading on the client, there is a short window during which React is still applying the initial render to the DOM — this is the hydration phase. Opening WebSocket connections during this phase can cause push messages to trigger `setState` calls before the component tree is fully committed, which interleaves App Router streaming updates with client-side state mutations. This manifests as "Cannot update a component while rendering" warnings or stale-closure bugs (#1033).

### `useIsHydrated`

```ts
// src/hooks/useHydrationComplete.ts
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,   // client snapshot
    () => false,  // server snapshot
  );
}
```

`useSyncExternalStore` is the correct primitive for hydration detection. React calls the **server snapshot** (`() => false`) during SSR and during the first synchronous render on the client before hydration completes. It calls the **client snapshot** (`() => true`) once the client-side render has matched the server's output.

Because `useSyncExternalStore` participates in React's tearing-prevention mechanism, the return value is guaranteed to be consistent across the render that reads it — the client and server snapshots can never disagree within the same render pass.

The `emptySubscribe` function (`() => () => {}`) is intentional: the "store" here is the implicit distinction between server and client environments, which never changes after hydration. No subscription is needed.

### `useHydrationComplete`

```ts
// src/hooks/useHydrationComplete.ts
export function useHydrationComplete(): boolean {
  const isHydrated = useIsHydrated();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isHydrated) return;
    setReady(true);
  }, [isHydrated]);

  return isHydrated && ready;
}
```

`useIsHydrated` can return `true` during React's render phase on the first client render — before `useEffect` callbacks have run. Effects run after React commits the full render to the DOM. `useHydrationComplete` adds a second gate using `useState` + `useEffect`: it only becomes `true` after both conditions are met:

1. The `useSyncExternalStore` client snapshot has been selected (render phase — React is on the client)
2. A `useEffect` has fired (commit phase — React has committed the initial tree and all effects are safe to run)

This two-gate approach ensures that WebSocket listeners, `EventSource` subscriptions, and other push-traffic handlers are only activated after React has fully committed the component tree to the DOM, eliminating any risk of streaming SSR chunks interleaving with client state updates.

### Usage in `EnhancedChatbot`

```ts
// src/components/EnhancedChatbot.tsx
const { socket, isHydrated } = useMultiplayerSession(roomId || null);

// Throttled mouse tracking — only after hydration so WS traffic cannot
// interleave with App Router streaming chunks (#1033)
useEffect(() => {
  if (!isHydrated || !socket || !roomId) return;
  // ... attach mousemove handler
}, [isHydrated, socket, roomId, user, sendSocketMessage]);

// Handle incoming presence — defer listeners until hydration completes (#1033)
useEffect(() => {
  if (!isHydrated || !socket) return;
  // ... attach socket message listener
}, [isHydrated, socket, onMapUpdate]);
```

All effects that attach WebSocket listeners are guarded by `if (!isHydrated) return`. This is the critical pattern: even though `EnhancedChatbot` is `ssr: false` (so it never renders on the server), the streaming hydration of the surrounding page shell can still be in progress when the dynamic chunk first mounts. The `isHydrated` guard prevents any socket traffic from reaching these handlers until the page shell's hydration is fully settled.

---

## 3. The `startClosed` pattern for PartySocket

In `useMultiplayerSession` (`src/hooks/useRealTime.tsx`), the PartySocket hook is configured with `startClosed`:

```ts
// src/hooks/useRealTime.tsx
export function useMultiplayerSession(roomId: string | null) {
  const isHydrated = useHydrationComplete();
  // ...

  // startClosed prevents WebSocket connection during SSR / streaming hydration
  const socket = usePartySocket({
    host: "127.0.0.1:1999",
    room: isHydrated && roomId ? roomId : "placeholder",
    startClosed: !isHydrated,
    query: token ? { token } : undefined,
    onMessage() {
      // handled in component after hydration
    },
  });

  return { provider, yDoc, socket, isHydrated };
}
```

### How `startClosed` works

When `startClosed: true` is passed to `usePartySocket`, the library constructs the socket instance but does not call `socket.connect()`. The socket object is available immediately (so hooks that depend on it do not receive `undefined`), but no TCP/TLS connection is established and no WebSocket upgrade is attempted.

Once `isHydrated` changes from `false` to `true`, `startClosed` changes to `false`. PartySocket detects this prop change and opens the connection.

### Why this matters during streaming SSR

Even though `EnhancedChatbot` is loaded client-side only, the underlying page at `/ai` uses React Server Components and streams its shell. The `useMultiplayerSession` hook runs inside `EnhancedChatbot`, which mounts only on the client — but the client may still be in the middle of processing streaming HTML chunks from the server when `useMultiplayerSession` first runs. Opening a WebSocket at that moment would mean incoming messages could fire state updates before React finishes reconciling the streamed content.

The combination of:
1. `ssr: false` on the `EnhancedChatbot` dynamic import (module never runs on the server)
2. `startClosed: !isHydrated` on the socket (connection deferred past commit phase)
3. `if (!isHydrated) return` guards on all socket `useEffect` listeners (handlers deferred past commit phase)

forms a defense-in-depth strategy against race conditions between server streaming and client WebSocket push traffic.

### The Yjs/YProvider path

The Yjs document and YProvider for shared editing are also guarded:

```ts
useEffect(() => {
  if (!isHydrated || !roomId || token === null) {
    setProvider(null);
    setYDoc(null);
    return;
  }
  // ... create Y.Doc + YProvider
}, [roomId, token, isHydrated]);
```

The Yjs provider is not instantiated until `isHydrated` is `true`, for the same reason.

---

## 4. Streaming SSR in React 19 vs traditional SSR hydration

### Traditional SSR (Pages Router / `getServerSideProps`)

In traditional Next.js SSR:

1. The server renders the **entire** React tree synchronously into a complete HTML string.
2. The full HTML string is sent in a **single HTTP response body**.
3. The browser parses and displays the complete HTML.
4. The JavaScript bundle loads and React calls `hydrateRoot()` exactly once on the root element.
5. React walks the existing DOM and attaches event listeners — no DOM nodes are created.
6. After step 5, hydration is complete and `useEffect` hooks run.

This model is predictable: hydration is a single, synchronous pass over a static HTML snapshot.

### Streaming SSR (App Router, React 18+/19)

The App Router uses React's concurrent rendering with streaming:

1. The server renders the **shell** (layouts, non-`Suspense`-wrapped content) and begins streaming it as HTTP chunked transfer encoding.
2. `<Suspense>` boundaries inside the shell render as placeholder HTML (`<!-- $?-->` markers) while their content resolves asynchronously.
3. As async data resolves, React streams **additional chunks** containing the boundary's resolved HTML, plus inline `<script>` tags that instruct the client to "splice" the content into the correct placeholder.
4. The client receives the shell first, parses it, and React begins **selective hydration**: hydrating components as their chunks arrive, prioritizing components the user is interacting with.
5. At any given moment, the client may have some components fully hydrated, some waiting for their streaming chunks, and some not yet started.

### Why this creates a risk for push connections

In the traditional model, when `useEffect` runs, the page is fully hydrated — there are no more server-sent HTML chunks to process. In the streaming model, `useEffect` can run on a component in the shell while other parts of the page are still being streamed in. If a WebSocket push arrives and triggers `setState` on a component that has not yet received its streaming chunk, React must reconcile:

- The server-streamed pending placeholder HTML
- The client-side state update that arrived via WebSocket

This interleaving can produce hydration mismatches, double renders, or `setState` calls on unmounted components.

The `ssr: false` + `startClosed` + `useHydrationComplete` pattern ensures that no WebSocket push traffic is processed until `useEffect` has run on the component — which only happens after the relevant component and all its ancestors in the App Router shell have been hydrated and committed to the DOM.

### Practical summary

| Property | Traditional SSR | Streaming SSR (App Router) |
|---|---|---|
| HTML delivery | One full response | Chunked, progressive |
| Hydration | Single synchronous pass | Selective, incremental |
| Time when `useEffect` runs | After full hydration | After component's chunk is committed |
| Risk from push traffic | Low | High — streaming chunks still in flight |
| Required guard | None / simple `mounted` state | `useHydrationComplete` + `startClosed` |

---

## 5. Best practices for client-only components in Next.js App Router

### Use `dynamic(..., { ssr: false })` for components that require browser APIs

Any component that reads from `window`, `navigator`, `document`, or opens real-time connections should be excluded from SSR:

```ts
const MyRealTimeWidget = dynamic(() => import("@/components/MyRealTimeWidget"), {
  ssr: false,
  loading: () => <div role="status">Loading...</div>,
});
```

Always provide a `loading` fallback. The fallback is the HTML the server actually emits, so it must be:
- Statically renderable (no browser APIs)
- Visually stable enough to avoid cumulative layout shift (CLS)
- Accessible (`role="status"`, `aria-live="polite"` for screen readers)

### Detect hydration state with `useSyncExternalStore`, not `useState`

Prefer `useIsHydrated()` (which uses `useSyncExternalStore`) over the common `useState(false)` + `useEffect` pattern for checking whether the component is on the client:

```ts
// Preferred
import { useIsHydrated } from "@/hooks/useHydrationComplete";

function MyComponent() {
  const isHydrated = useIsHydrated();
  if (!isHydrated) return <Skeleton />;
  return <ActualContent />;
}
```

`useSyncExternalStore` guarantees the server and client snapshots are called consistently within a single render. The `useState` + `useEffect` alternative technically works but can produce a React warning about hydration mismatches when the initial `false` state conflicts with the server's output.

### Guard WebSocket / SSE effect setup behind `useHydrationComplete`

For any effect that opens a network connection driven by push:

```ts
const isHydrated = useHydrationComplete();

useEffect(() => {
  if (!isHydrated) return; // Do not open connections until after commit phase
  const ws = new WebSocket("wss://...");
  return () => ws.close();
}, [isHydrated]);
```

This is the minimum required guard. Without it, opening a connection during the streaming window risks push messages arriving before the component tree is committed.

### Use `startClosed` with PartySocket to match the hydration lifecycle

```ts
const socket = usePartySocket({
  host: partyKitHost,
  room: isHydrated ? roomId : "placeholder",
  startClosed: !isHydrated,  // Do not connect until after hydration
});
```

The `startClosed` option defers the actual WebSocket upgrade without requiring you to unmount and remount the hook. Keeping the hook mounted with `startClosed` avoids the teardown/setup churn that a conditional hook call would cause (and conditional hooks violate the Rules of Hooks).

### Wrap components that depend on `useSearchParams` in `<Suspense>`

In the App Router, `useSearchParams()` opts the component into client-side rendering and requires a `<Suspense>` boundary above it. Without it, the build will warn and the component may fall back to static rendering with no params. The `/ai` page wraps `AppPage` in `<Suspense>` for exactly this reason:

```tsx
export default function AppPageWrapper() {
  return (
    <Suspense fallback={<Loader2 className="animate-spin" />}>
      <AppPage />
    </Suspense>
  );
}
```

### Use `isMounted` guards for lightweight presence wrappers

For wrappers that do not need the full `useHydrationComplete` machinery, a simple `isMounted` state is sufficient:

```ts
export function PartyKitPresenceWrapper({ children, fallback = null }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) return <>{fallback}</>;

  return (
    <Suspense fallback={null}>
      <PresenceIndicator />
    </Suspense>
  );
}
```

The `<Suspense fallback={null}>` wrapper around `PresenceIndicator` ensures that if `PresenceIndicator` throws a promise (e.g., due to a hook that suspends), it is caught rather than bubbling up to the page boundary.

### Never access `window` or `navigator` at module scope

```ts
// BAD — runs at import time, crashes on the server
const isOnline = navigator.onLine;

// GOOD — only accessed inside effects or event handlers
useEffect(() => {
  const online = navigator.onLine;
  setIsOnline(online);
}, []);
```

Module-level access to browser globals crashes the server render even when the component is marked `"use client"`, because the module itself is still imported by the server to build the component graph.

### Avoid `suppressHydrationWarning` as a shortcut

`suppressHydrationWarning` suppresses the React warning for a single element attribute or text node. It does **not** fix the underlying mismatch, and it will not help when the mismatch involves component tree structure (different elements, conditional renders). Use proper hydration guards instead.

---

## Related files

| File | Role |
|---|---|
| `src/app/ai/page.tsx` | `EnhancedChatbot` dynamic import with `ssr: false` and loading skeleton |
| `src/components/EnhancedChatbot.tsx` | Client-only chatbot with `isHydrated`-gated socket listeners |
| `src/hooks/useHydrationComplete.ts` | `useIsHydrated` (useSyncExternalStore) and `useHydrationComplete` (+ useEffect gate) |
| `src/hooks/useRealTime.tsx` | `useMultiplayerSession` with `startClosed: !isHydrated` PartySocket |
| `src/components/chat/PartyKitPresenceWrapper.tsx` | `isMounted` guard for YProvider presence indicator |
| `docs/HYDRATION_BEST_PRACTICES.md` | General hydration mismatch patterns and fixes |
| `docs/PARTYKIT_ARCHITECTURE.md` | PartyKit room setup, auth, message schemas, and reconnect protocol |
