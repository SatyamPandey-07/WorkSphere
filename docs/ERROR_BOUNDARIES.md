# React Error Boundary Implementation Guide

Error boundaries are React components that catch JavaScript errors anywhere in their child component tree, log those errors, and display a fallback UI instead of the component tree that crashed. This guide outlines how to implement and use Error Boundaries within our codebase.

---

## 1. Why Use Error Boundaries?

React's default behavior is to unmount the entire component tree if an unhandled error is thrown during rendering. In a complex application like WorkSphere:

- A crash in a minor component (e.g., a single venue's rating display) should not crash the entire chat interface or the main application map.
- Error boundaries allow us to isolate failures to the failing subtree, keeping the rest of the application fully interactive.
- They provide a central point to log runtime exceptions to telemetry endpoints or analytical services.

---

## 2. Generic Error Boundary Component (TypeScript)

Since React does not currently support functional components for catching errors (via `componentDidCatch` or `getDerivedStateFromError`), Error Boundaries must be written as Class Components.

Below is the standard, production-ready implementation of `ErrorBoundary` in our project:

```tsx
import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log the error to console or telemetry services
    console.error("[ErrorBoundary] Uncaught error:", error, errorInfo);

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  private handleReset = () => {
    if (this.props.onReset) {
      this.props.onReset();
    }
    this.setState({
      hasError: false,
      error: null,
    });
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      const fallback = this.props.fallback;

      if (typeof fallback === "function") {
        return fallback(this.state.error, this.handleReset);
      }

      if (fallback) {
        return fallback;
      }

      // Default Fallback UI
      return (
        <div className="p-6 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 rounded-2xl text-center space-y-4">
          <div className="inline-flex p-3 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full">
            ⚠️
          </div>
          <h3 className="text-md font-bold text-zinc-950 dark:text-white">
            Component Error
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 max-w-sm mx-auto">
            Something went wrong rendering this component. You can try to reset
            the component state or reload.
          </p>
          <button
            onClick={this.handleReset}
            className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

## 3. Best Practices for Placement

To implement error boundaries effectively:

### A. Core Pages and Features

Wrap major subtrees, layout panels, or feature containers (e.g., chat panel, map card detail panel, collections comparison panel) in their own `ErrorBoundary`. This keeps page-level navigation working even if a single view crashes.

```tsx
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

function VenueChatPanel() {
  return (
    <div className="chat-panel">
      <ErrorBoundary
        fallback={
          <div>Failed to load message history. Please try refreshing.</div>
        }
      >
        <MessageHistory />
      </ErrorBoundary>
      <ChatInput />
    </div>
  );
}
```

### B. Third-Party Widgets and Integrations

Map libraries, charts, custom date pickers, or PDF renders are common sources of unexpected exceptions. Wrap them individually:

```tsx
<ErrorBoundary
  fallback={
    <div className="h-48 bg-zinc-100 dark:bg-zinc-800 rounded-xl animate-pulse flex items-center justify-center">
      Failed to render chart
    </div>
  }
>
  <NoiseTimeChart venueId={venueId} />
</ErrorBoundary>
```

---

## 4. Next.js Specific App Router Error Boundaries (`error.tsx`)

In the Next.js App Router, page-level error boundaries are defined using `error.tsx` files. Next.js wraps routes automatically inside a React Error Boundary.

Place an `error.tsx` file inside any route segment to catch unexpected rendering errors in that folder's page and its nested segments:

```tsx
// src/app/collections/[id]/error.tsx
"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to external telemetry service
    console.error("Route error:", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center space-y-6">
      <div className="p-4 bg-red-100 dark:bg-red-950/20 text-red-600 rounded-full">
        ⚠️
      </div>
      <h2 className="text-xl font-black uppercase tracking-tight">
        Collection Error
      </h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-md">
        An error occurred while loading this collection.
      </p>
      <div className="flex gap-4">
        <button
          onClick={() => reset()}
          className="px-6 py-3 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-all"
        >
          Try again
        </button>
        <a
          href="/collections"
          className="px-6 py-3 text-sm font-bold text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-xl dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-all"
        >
          Back to collections
        </a>
      </div>
    </div>
  );
}
```

---

## 5. Fallback UI Checklist

When writing custom fallbacks:

1. **Never show raw stack traces** to end-users in production.
2. **Offer a clear resolution path**, such as a "Try Again" or "Reload Page" button.
3. **Log the error details** asynchronously for developer analysis.
4. Keep the fallback container size equivalent to the original component's expected footprint to prevent layout shifts.
