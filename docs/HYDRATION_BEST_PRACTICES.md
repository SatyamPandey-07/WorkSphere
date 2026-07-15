# Next.js Server-Client Hydration Best Practices

Hydration mismatches happen when the initial HTML rendered on the server does not exactly match the HTML rendered on the client during the first load. In Next.js, this typically throws a hydration error and can break your UI.

This document outlines the guidelines to prevent hydration mismatches across the WorkSphere frontend.

---

## 1. Handling Theme Triggers (Dark/Light Mode)

Themes usually rely on `window.localStorage` or the user's system preferences, which the server cannot access during Server-Side Rendering (SSR).

**The Fix:** Use a `mounted` state with a `useEffect` hook to ensure theme-dependent UI only renders after the component has mounted on the client.

```tsx
"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";

export default function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // useEffect only runs on the client
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null; // or a loading skeleton
  }

  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      Toggle Theme
    </button>
  );
}
```

## 2. Local Clock Components & Window State

Components that display the current local time or rely on `window` dimensions (like `window.innerWidth`) often mismatch because the server's environment is different from the user's browser.

**The Fix:** Use Next.js dynamic imports and disable SSR for these specific components. _Note: Disabling SSR trades away server-rendered HTML for that specific component._

```tsx
"use client";

import dynamic from "next/dynamic";

// The server will skip rendering this component entirely
const LocalClock = dynamic(() => import("../components/LocalClock"), {
  ssr: false,
});

export default function Dashboard() {
  return (
    <div>
      <h1>Dashboard</h1>
      <LocalClock />
    </div>
  );
}
```

## 3. Client-Only Gate (`ClientOnly`)

If you have a larger section of your app that relies heavily on client-side state (like browser APIs), you can use a client-only gate wrapper. Since this pattern renders `null` (or a stable fallback) during SSR, it safely bypasses hydration issues without needing the `suppressHydrationWarning` attribute.

Create a generic `<ClientOnly>` wrapper component:

```tsx
"use client";

// components/ClientOnly.tsx
import { useEffect, useState } from "react";

export default function ClientOnly({
  children,
  fallback = null,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return <>{isClient ? children : fallback}</>;
}
```

**Usage in a Layout or Page:**

```tsx
"use client";

import ClientOnly from '@/components/ClientOnly';

export default function ClientHeavyPage() {
  return (
    <ClientOnly fallback="{<div">Loading...</div>}>
      <ClientOnlyDashboard/>
    </ClientOnly>
  );
}
```
