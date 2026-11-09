# Guide: Writing Unit Tests for Custom React Hooks with Vitest & React Testing Library

This comprehensive guide outlines standardized testing patterns, environment setups, state assertion techniques, and Web API mocking strategies for custom React hooks in WorkSphere (`src/hooks/`).

---

## Table of Contents

1. [Architectural Overview & Testing Philosophy](#1-architectural-overview--testing-philosophy)
2. [Test Environment & Core Utilities](#2-test-environment--core-utilities)
   - [Understanding `renderHook` and `act`](#understanding-renderhook-and-act)
   - [Asynchronous State Resolution (`waitFor`)](#asynchronous-state-resolution-waitfor)
3. [Standardized Testing Patterns](#3-standardized-testing-patterns)
   - [Pattern 1: Synchronous State Initializers](#pattern-1-synchronous-state-initializers)
   - [Pattern 2: Action Dispatchers & Mutators](#pattern-2-action-dispatchers--mutators)
   - [Pattern 3: Asynchronous Effects & Data Fetching](#pattern-3-asynchronous-effects--data-fetching)
4. [Real-World WorkSphere Hook Test Walkthroughs](#4-real-world-worksphere-hook-test-walkthroughs)
   - [Walkthrough 1: Testing `useOfflineSync`](#walkthrough-1-testing-useofflinesync)
   - [Walkthrough 2: Testing `usePartySocket`](#walkthrough-2-testing-usepartysocket)
   - [Walkthrough 3: Testing `useWebAudioAutoPause`](#walkthrough-3-testing-usewebaudioautopause)
5. [Browser & Web API Mocking Strategies](#5-browser--web-api-mocking-strategies)
   - [Mocking `localStorage` & `sessionStorage`](#mocking-localstorage--sessionstorage)
   - [Mocking `fetch` & Network Requests](#mocking-fetch--network-requests)
   - [Mocking Browser Window Events (`online` / `offline`)](#mocking-browser-window-events-online--offline)
   - [Mocking Web Audio API (`AudioContext`, `MediaStream`)](#mocking-web-audio-api-audiocontext-mediastream)
   - [Controlling Time & Interval Timers (`useFakeTimers`)](#controlling-time--interval-timers-usefaketimers)
6. [Common Pitfalls & Anti-Patterns](#6-common-pitfalls--anti-patterns)
7. [Running Hook Tests & CI Coverage Directives](#7-running-hook-tests--ci-coverage-directives)

---

## 1. Architectural Overview & Testing Philosophy

Custom React hooks encapsulate complex stateful logic, asynchronous side effects, browser sensor subscriptions, and WebSocket connections. Testing custom hooks in isolation—without mounting full UI component trees—ensures fast execution, deterministic assertions, and high code coverage.

Core Testing Principles:
- **Behavior over Implementation:** Test the hook's public return contract (`result.current`) rather than internal `useState` or `useRef` mechanics.
- **Isolated Side Effects:** Every test must cleanly unmount and clear event listeners, storage state, and fake timers in `afterEach()`.
- **Strict `act()` Wrapping:** Any interaction triggering a React state update must be enclosed within `act(() => { ... })` to mirror React's batch rendering cycle.

---

## 2. Test Environment & Core Utilities

### Understanding `renderHook` and `act`

`renderHook` from `@testing-library/react` creates an isolated container component to execute custom hooks:

```typescript
import { renderHook, act } from "@testing-library/react";
import { useCounter } from "@/hooks/useCounter";

describe("useCounter", () => {
  it("initializes state and handles increment actions", () => {
    const { result } = renderHook(() => useCounter(10));

    // Inspect initial return state
    expect(result.current.count).toBe(10);

    // Trigger state mutation inside act()
    act(() => {
      result.current.increment();
    });

    expect(result.current.count).toBe(11);
  });
});
```

> [!IMPORTANT]
> Always access `result.current` dynamically **after** an `act()` block. Destructuring primitive properties (`const { count } = result.current`) before state mutation reads a stale value snapshot!

### Asynchronous State Resolution (`waitFor`)

When hooks perform asynchronous operations (such as HTTP `fetch`, promises, or IndexedDB lookups), use `waitFor()` to poll assertions until state converges:

```typescript
import { renderHook, waitFor } from "@testing-library/react";
import { useUserLocation } from "@/hooks/useUserLocation";

it("resolves location data asynchronously", async () => {
  const { result } = renderHook(() => useUserLocation());

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
    expect(result.current.coords).toEqual({ lat: 37.7749, lng: -122.4194 });
  });
});
```

---

## 3. Standardized Testing Patterns

### Pattern 1: Synchronous State Initializers

Test initial default values and custom parameter options:

```typescript
it("accepts custom initial parameters", () => {
  const { result } = renderHook(() => useVenueFilterParams({ category: "cafe", minSeats: 4 }));

  expect(result.current.category).toBe("cafe");
  expect(result.current.minSeats).toBe(4);
});
```

### Pattern 2: Action Dispatchers & Mutators

```typescript
it("dispatches actions and updates reactive state", () => {
  const { result } = renderHook(() => useFavorites());

  act(() => {
    result.current.addFavorite("v_sf_01");
  });

  expect(result.current.favorites).toContain("v_sf_01");

  act(() => {
    result.current.removeFavorite("v_sf_01");
  });

  expect(result.current.favorites).not.toContain("v_sf_01");
});
```

### Pattern 3: Asynchronous Effects & Data Fetching

```typescript
it("fetches data and updates loading state", async () => {
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: async () => ({ status: "available", seats: 12 }),
  } as Response);

  const { result } = renderHook(() => useSeatAvailability("v_sf_01"));

  expect(result.current.loading).toBe(true);

  await waitFor(() => {
    expect(result.current.loading).toBe(false);
    expect(result.current.seats).toBe(12);
  });
});
```

---

## 4. Real-World WorkSphere Hook Test Walkthroughs

### Walkthrough 1: Testing `useOfflineSync`

File: `src/hooks/useOfflineSync.ts`

Tests offline booking queueing and automatic background synchronization upon network reconnection.

```typescript
import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useOfflineSync } from "@/hooks/useOfflineSync";

describe("useOfflineSync Hook", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "onLine", {
      writable: true,
      value: true,
    });
  });

  it("detects online and offline network events", () => {
    const { result } = renderHook(() => useOfflineSync());

    expect(result.current.isOffline).toBe(false);

    // Simulate going offline
    act(() => {
      Object.defineProperty(navigator, "onLine", { value: false });
      window.dispatchEvent(new Event("offline"));
    });

    expect(result.current.isOffline).toBe(true);

    // Simulate reconnecting online
    act(() => {
      Object.defineProperty(navigator, "onLine", { value: true });
      window.dispatchEvent(new Event("online"));
    });

    expect(result.current.isOffline).toBe(false);
  });

  it("queues offline bookings when offline and syncs on reconnect", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, bookingId: "bk_999" }),
    } as Response);

    const { result } = renderHook(() => useOfflineSync());

    // Switch to offline mode
    act(() => {
      Object.defineProperty(navigator, "onLine", { value: false });
      window.dispatchEvent(new Event("offline"));
    });

    // Queue booking offline
    act(() => {
      result.current.queueBooking({ venueId: "v_01", seatId: "s_04" });
    });

    expect(result.current.pendingQueueLength).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    // Trigger online reconnect sync
    await act(async () => {
      Object.defineProperty(navigator, "onLine", { value: true });
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(result.current.pendingQueueLength).toBe(0);
    });
  });
});
```

### Walkthrough 2: Testing `usePartySocket`

File: `src/hooks/usePartySocket.ts`

Tests real-time WebSocket connection setup, message reception, and message deduplication.

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePartySocket } from "@/hooks/usePartySocket";

class MockWebSocket {
  public url: string;
  public onopen: (() => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onclose: (() => void) | null = null;
  public send = vi.fn();
  public close = vi.fn();

  constructor(url: string) {
    this.url = url;
    setTimeout(() => this.onopen?.(), 10);
  }
}

describe("usePartySocket Hook", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
  });

  it("connects to PartySocket server and tracks connection state", async () => {
    const { result } = renderHook(() =>
      usePartySocket({ room: "venue_123", host: "ws.worksphere.com" })
    );

    expect(result.current.isConnected).toBe(false);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.isConnected).toBe(true);
  });

  it("dispatches outbound message over WebSocket", async () => {
    const { result } = renderHook(() =>
      usePartySocket({ room: "venue_123", host: "ws.worksphere.com" })
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    act(() => {
      result.current.sendMessage({ text: "Hello Room" });
    });

    expect(result.current.lastSentMessage).toEqual({ text: "Hello Room" });
  });
});
```

### Walkthrough 3: Testing `useWebAudioAutoPause`

File: `src/hooks/useWebAudioAutoPause.ts`

Tests automatic Web Audio API context pausing when page tab switches to background (`visibilitychange`).

```typescript
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWebAudioAutoPause } from "@/hooks/useWebAudioAutoPause";

describe("useWebAudioAutoPause Hook", () => {
  let mockAudioContext: {
    state: string;
    suspend: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockAudioContext = {
      state: "running",
      suspend: vi.fn(async () => {
        mockAudioContext.state = "suspended";
      }),
      resume: vi.fn(async () => {
        mockAudioContext.state = "running";
      }),
    };
  });

  it("suspends audio context when tab becomes hidden", async () => {
    renderHook(() => useWebAudioAutoPause(mockAudioContext as any));

    // Simulate tab backgrounding
    await act(async () => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockAudioContext.suspend).toHaveBeenCalledTimes(1);
    expect(mockAudioContext.state).toBe("suspended");
  });

  it("resumes audio context when tab becomes visible again", async () => {
    renderHook(() => useWebAudioAutoPause(mockAudioContext as any));

    // Hide tab
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // Restore tab visibility
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockAudioContext.resume).toHaveBeenCalledTimes(1);
    expect(mockAudioContext.state).toBe("running");
  });
});
```

---

## 5. Browser & Web API Mocking Strategies

### Mocking `localStorage` & `sessionStorage`

```typescript
export function createStorageMock() {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
}

// Global setup inside beforeEach:
beforeEach(() => {
  const localStorageMock = createStorageMock();
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });
});
```

### Mocking `fetch` & Network Requests

```typescript
// Mocking successful response:
vi.spyOn(global, "fetch").mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({ status: "success" }),
} as Response);

// Mocking server error:
vi.spyOn(global, "fetch").mockResolvedValue({
  ok: false,
  status: 500,
  json: async () => ({ error: "Internal Server Error" }),
} as Response);
```

### Mocking Browser Window Events (`online` / `offline`)

```typescript
export function triggerNetworkStatus(isOnline: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: isOnline,
  });
  window.dispatchEvent(new Event(isOnline ? "online" : "offline"));
}
```

### Mocking Web Audio API (`AudioContext`, `MediaStream`)

```typescript
const mockAudioContextClass = vi.fn().mockImplementation(() => ({
  createGain: vi.fn(() => ({ connect: vi.fn(), gain: { value: 1 } })),
  createOscillator: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), connect: vi.fn() })),
  destination: {},
  state: "running",
  close: vi.fn(),
}));

vi.stubGlobal("AudioContext", mockAudioContextClass);
vi.stubGlobal("webkitAudioContext", mockAudioContextClass);
```

### Controlling Time & Interval Timers (`useFakeTimers`)

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("handles periodic polling interval", () => {
  const { result } = renderHook(() => useSeatAvailabilityPolling("v_01", 5000));

  expect(result.current.pollCount).toBe(0);

  act(() => {
    vi.advanceTimersByTime(5000);
  });

  expect(result.current.pollCount).toBe(1);

  act(() => {
    vi.advanceTimersByTime(10000);
  });

  expect(result.current.pollCount).toBe(3);
});
```

---

## 6. Common Pitfalls & Anti-Patterns

| Anti-Pattern | Why It Fails | Recommended Solution |
| :--- | :--- | :--- |
| **Destructuring `result.current` prematurely** | Primitive value snapshots do not update when state mutates inside the hook. | Always access `result.current.property` dynamically after `act()`. |
| **Mutating state outside `act()`** | Causes React state batching warnings (`An update to Hook inside a test was not wrapped in act(...)`). | Wrap all action dispatches in `act(() => { ... })`. |
| **Uncleaned event listeners** | Leaks listeners into subsequent tests, causing unexpected state side-effects. | Call `result.unmount()` or clean up global listeners in `afterEach()`. |
| **Hardcoded `setTimeout` in async tests** | Introduces test flakiness and slow execution times. | Use `waitFor()` or `vi.advanceTimersByTime()`. |

---

## 7. Running Hook Tests & CI Coverage Directives

To execute hook unit tests locally or in CI pipelines:

```bash
# Run all hook tests in watch mode
npm run test:watch src/__tests__/hooks

# Run hook tests single pass with Vitest
npx vitest run src/__tests__/hooks

# Generate test coverage report
npx vitest run --coverage
```
