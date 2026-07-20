# Next.js App Router Performance Optimization Playbook

This playbook explains how to build and maintain high-performance features in WorkSphere using the Next.js App Router. It covers Core Web Vitals, rendering strategies, bundle optimization, image and font handling, data fetching patterns, caching, and performance debugging.

It is intended for contributors adding new features, refactoring existing pages, or investigating performance regressions.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [App Router Rendering Strategies](#2-app-router-rendering-strategies)
3. [Bundle Optimization](#3-bundle-optimization)
4. [Image Optimization](#4-image-optimization)
5. [Font Optimization](#5-font-optimization)
6. [Data Fetching Performance](#6-data-fetching-performance)
7. [Caching Strategies](#7-caching-strategies)
8. [Measuring Performance](#8-measuring-performance)
9. [Common Performance Pitfalls](#9-common-performance-pitfalls)
10. [Best Practices Summary](#10-best-practices-summary)
11. [References](#11-references)

---

## 1. Introduction

### Why Performance Matters

Performance is not a nice-to-have — it directly affects how many users stay on a page and whether search engines rank it well. Research shows that a 100ms improvement in page load time can measurably increase conversion rates. For WorkSphere, where users expect to quickly find a nearby workspace, slow load times create real frustration.

### Core Web Vitals

Google's Core Web Vitals are the three metrics used to measure perceived performance. They directly influence search ranking.

| Metric | Full Name | What It Measures | Good Threshold |
| :--- | :--- | :--- | :--- |
| **LCP** | Largest Contentful Paint | How fast the main content loads | ≤ 2.5 s |
| **CLS** | Cumulative Layout Shift | How much the page shifts unexpectedly | ≤ 0.1 |
| **INP** | Interaction to Next Paint | How fast the page responds to user input | ≤ 200 ms |

### How They Map to WorkSphere

| Page | Primary CWV concern |
| :--- | :--- |
| Landing page (`/`) | LCP — hero section must load fast |
| AI workspace finder (`/ai`) | INP — chat input and map interactions must be responsive |
| Dashboard (`/dashboard`) | CLS — booking cards must not shift during load |

---

## 2. App Router Rendering Strategies

The Next.js App Router gives you fine-grained control over how each component renders. Choosing the right strategy for each component is the single highest-impact performance decision you can make.

### Server Components (Default)

All components in the `app/` directory are **Server Components** by default. They render on the server, send HTML to the browser, and ship **zero JavaScript** to the client.

```tsx
// src/app/page.tsx — Server Component (no 'use client' directive)
// This fetches data on the server. No JS sent to the browser for this component.
export default async function LandingPage() {
  const venues = await fetchFeaturedVenues(); // runs on server, never exposed to client
  return <VenueGrid venues={venues} />;
}
```

**Use Server Components for:**
- Pages that fetch data from the database
- Static content — marketing copy, footers, headers
- Components that don't need `useState`, `useEffect`, or browser APIs

### Client Components

Add `'use client'` at the top of a file to opt that component (and its children) into client-side rendering. Client Components are interactive and can use React hooks and browser APIs.

```tsx
'use client';

// src/components/chat/ChatInput.tsx
import { useState } from 'react';

export function ChatInput({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onSubmit(value)}
    />
  );
}
```

**Use Client Components for:**
- Interactive UI — chat inputs, buttons, dropdowns, maps
- Components using `useState`, `useEffect`, `useRef`
- Browser API access — `window`, `navigator`, `localStorage`
- Event handlers — `onClick`, `onChange`, `onSubmit`

> **Tip:** Push `'use client'` as far down the component tree as possible. A large Server Component that renders one small interactive button should not be a Client Component — extract the button into its own Client Component instead.

### Static Rendering

Pages and layouts that have no dynamic data are statically rendered at build time and served from a CDN. This is the fastest possible rendering strategy.

```tsx
// This page has no dynamic data — Next.js renders it statically at build time
export default function AboutPage() {
  return <main>About WorkSphere</main>;
}
```

### Dynamic Rendering

Pages that depend on runtime data (request headers, cookies, search params) are rendered dynamically on each request.

```tsx
import { cookies } from 'next/headers';

// Reading cookies opts this page into dynamic rendering automatically
export default async function DashboardPage() {
  const cookieStore = await cookies();
  const theme = cookieStore.get('worksphere-theme')?.value;
  return <Dashboard theme={theme} />;
}
```

WorkSphere's root layout reads cookies for theme detection, which makes it dynamically rendered. This is intentional — it prevents a flash of unstyled content on first load.

### Streaming with Suspense

Streaming sends HTML to the browser in chunks as it becomes ready, rather than waiting for all data to load before sending anything. This dramatically improves Time to First Byte (TTFB) and perceived load speed.

```tsx
import { Suspense } from 'react';
import { VenueListSkeleton } from '@/components/ui/skeleton';

export default function AIPage() {
  return (
    <main>
      {/* Renders immediately */}
      <ChatHeader />

      {/* Streams in once venue data is ready */}
      <Suspense fallback={<VenueListSkeleton />}>
        <VenueResults />
      </Suspense>
    </main>
  );
}
```

**Use Streaming when:**
- A page has a mix of fast and slow data sources
- You want to show a loading skeleton while data loads
- You want to avoid blocking the entire page on one slow query

### Rendering Strategy Decision Guide

```
Does the component need useState / useEffect / browser APIs?
├── Yes → Client Component ('use client')
└── No
    ├── Does it depend on request-time data (cookies, headers, searchParams)?
    │   ├── Yes → Dynamic Server Component
    │   └── No
    │       ├── Does it have slow data that can stream in?
    │       │   ├── Yes → Server Component wrapped in <Suspense>
    │       │   └── No → Static Server Component (fastest)
```

---

## 3. Bundle Optimization

Reducing the amount of JavaScript sent to the browser is one of the most effective ways to improve INP and page load speed.

### Dynamic Imports with next/dynamic

Use `next/dynamic` to split large components out of the main bundle and load them only when needed. This is especially important for heavy libraries like Leaflet (the map) and chart libraries.

```tsx
import dynamic from 'next/dynamic';

// The map component (~500KB) is not loaded until it's needed
const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,           // Leaflet requires browser APIs — disable SSR
  loading: () => <div className="w-full h-full bg-zinc-900 animate-pulse" />,
});

// Heavy modal loaded only when opened
const BookingModal = dynamic(() => import('@/components/chat/BookingModal'), {
  loading: () => null,
});
```

> **Note:** `ssr: false` is required for Leaflet and any component that accesses `window`, `document`, or `navigator` directly. WorkSphere's `Map.tsx` uses this pattern.

### Lazy Loading Below-the-Fold Components

Components that are not visible on initial page load should be loaded lazily:

```tsx
import dynamic from 'next/dynamic';

// Only loaded when the user scrolls to the footer area
const Footer = dynamic(() => import('@/components/Footer'));

// Only loaded when the comparison drawer is opened
const ComparisonDrawer = dynamic(() => import('@/components/ComparisonDrawer'));
```

### Bundle Analysis

Use `@next/bundle-analyzer` to visualise what is in your JavaScript bundles and identify large dependencies.

**Install:**
```bash
npm install --save-dev @next/bundle-analyzer
```

**Configure in `next.config.ts`:**
```typescript
import withBundleAnalyzer from '@next/bundle-analyzer';

const withAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withAnalyzer({
  // ...existing nextConfig
});
```

**Run:**
```bash
ANALYZE=true npm run build
```

This opens two interactive treemap reports in your browser — one for the server bundle and one for the client bundle.

### Reading Bundle Reports

In the treemap:
- **Large rectangles** = large modules. Investigate whether they can be replaced with a smaller alternative, tree-shaken, or dynamically imported.
- Look for **duplicated packages** — multiple versions of the same library appearing in the bundle.
- Check **node_modules vs your code** — a large `node_modules` rectangle often means a dependency is being included that should be server-only or dynamically imported.

### Tree Shaking

Next.js tree-shakes unused exports automatically for ES modules. To ensure tree shaking works:

```tsx
// ✅ Named import — tree-shakeable, only imports what you use
import { Heart, Star, Wifi } from 'lucide-react';

// ❌ Default import of entire library — imports everything
import * as Icons from 'lucide-react';
```

### Removing Unused Dependencies

Before adding a new dependency, check if the functionality can be achieved with something already installed. A dependency that adds 50KB to the bundle for one utility function is rarely worth it.

```bash
# Check what a package adds to your bundle before installing
npx bundlephobia <package-name>
```

---

## 4. Image Optimization

WorkSphere displays venue photos throughout the application. Unoptimised images are one of the most common causes of poor LCP scores.

### Using next/image

Always use the `<Image>` component from `next/image` instead of a plain `<img>` tag. It automatically:
- Converts images to WebP/AVIF
- Resizes images to match the rendered size
- Lazy loads images below the fold
- Prevents layout shift with reserved space

```tsx
import Image from 'next/image';

// ✅ Correct — uses next/image
<Image
  src={venue.imageUrl}
  alt={venue.name}
  width={800}
  height={176}
  className="w-full h-44 object-cover"
/>

// ❌ Avoid — plain img tag skips all optimizations
<img src={venue.imageUrl} alt={venue.name} />
```

> **Note:** WorkSphere currently uses plain `<img>` tags in some venue card components with an `eslint-disable-next-line @next/next/no-img-element` comment. These are candidates for migration to `<Image>` as part of performance work.

### Remote Image Configuration

External image domains must be allowlisted in `next.config.ts`. WorkSphere already configures Unsplash and Cloudinary:

```typescript
// next.config.ts
images: {
  remotePatterns: [
    {
      protocol: 'https',
      hostname: 'images.unsplash.com',
      pathname: '/**',
    },
    {
      protocol: 'https',
      hostname: 'res.cloudinary.com',
      pathname: '/**',
    },
  ],
},
```

To add a new image source, add a new entry to `remotePatterns`.

### Priority Images (LCP Optimisation)

The image that is the Largest Contentful Paint element should be loaded eagerly with `priority`. This tells Next.js to preload the image and skip lazy loading:

```tsx
// Hero image — above the fold, is the LCP element
<Image
  src="/images/hero-mockup.png"
  alt="WorkSphere hero"
  width={1200}
  height={800}
  priority   // ← preloads this image immediately
/>
```

Only apply `priority` to the one or two images visible above the fold. Marking everything as priority defeats the purpose.

### Responsive Images with sizes

Use the `sizes` prop to tell the browser the rendered width at each breakpoint, allowing it to download the smallest appropriate image:

```tsx
<Image
  src={venue.imageUrl}
  alt={venue.name}
  fill
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
  className="object-cover"
/>
```

### Image Format

Next.js automatically serves WebP to browsers that support it, and AVIF to browsers that support AVIF. No configuration is needed — this happens automatically when you use `next/image`.

---

## 5. Font Optimization

WorkSphere uses `next/font` to load the Geist font family. This is already correctly configured in `src/app/layout.tsx`.

### How WorkSphere Loads Fonts

```typescript
// src/app/layout.tsx
import { Geist, Geist_Mono } from 'next/font/google';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});
```

`next/font` downloads the font at build time, self-hosts it, and injects a preload link automatically. This means:
- No external network request to Google Fonts at runtime
- No flash of unstyled text (FOUT)
- Zero CLS from font loading

### Preventing Layout Shift

`next/font` reserves the correct space for the font before it loads using `font-display: optional` or `font-display: swap` depending on configuration. Always use `next/font` instead of manually adding `<link>` tags to Google Fonts.

```tsx
// ❌ Avoid — causes layout shift and an extra network round-trip
<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />

// ✅ Correct — self-hosted, no layout shift, automatic preload
import { Inter } from 'next/font/google';
const inter = Inter({ subsets: ['latin'] });
```

### Local Fonts

WorkSphere also includes local fonts in `public/fonts/` for PDF generation (Noto Sans). For UI fonts, always prefer `next/font/google` or `next/font/local` over manual font loading.

```typescript
import localFont from 'next/font/local';

const notoSans = localFont({
  src: [
    { path: '../../public/fonts/NotoSans-Regular.ttf', weight: '400' },
    { path: '../../public/fonts/NotoSans-Bold.ttf', weight: '700' },
  ],
  variable: '--font-noto',
});
```

---

## 6. Data Fetching Performance

### Server-Side Data Fetching

Fetch data in Server Components wherever possible. This eliminates a client-side waterfall — data is fetched on the server (close to the database) and HTML is sent directly to the browser.

```tsx
// ✅ Server Component — fetches data on server, no loading state needed in browser
export default async function DashboardPage() {
  const bookings = await prisma.booking.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: 'desc' },
  });
  return <BookingList bookings={bookings} />;
}
```

### Request Deduplication

Next.js automatically deduplicates `fetch()` requests with the same URL within a single render pass. If multiple Server Components call the same endpoint, it is only fetched once.

```tsx
// Both components call the same endpoint — Next.js only fetches it once
async function Header() {
  const user = await fetchUser(); // deduped
  return <nav>{user.name}</nav>;
}

async function Sidebar() {
  const user = await fetchUser(); // same request — returns cached result
  return <aside>{user.email}</aside>;
}
```

> **Note:** Deduplication only works for `fetch()`. Prisma queries are not automatically deduped. Use React `cache()` to deduplicate database calls:

```typescript
import { cache } from 'react';

// Wrap expensive DB queries in cache() to deduplicate across a render
export const getUser = cache(async (userId: string) => {
  return prisma.user.findUnique({ where: { id: userId } });
});
```

### Parallel Data Fetching

Avoid sequential `await` calls when the requests are independent. Use `Promise.all()` to fetch in parallel:

```tsx
// ❌ Sequential — total time = time(A) + time(B) + time(C)
const user = await getUser(userId);
const bookings = await getBookings(userId);
const favorites = await getFavorites(userId);

// ✅ Parallel — total time = max(time(A), time(B), time(C))
const [user, bookings, favorites] = await Promise.all([
  getUser(userId),
  getBookings(userId),
  getFavorites(userId),
]);
```

### Streaming Data with Suspense

For slow queries, stream the result in rather than blocking the whole page:

```tsx
import { Suspense } from 'react';
import { BookingSkeleton } from '@/components/ui/skeleton';

export default function DashboardPage() {
  return (
    <div>
      <h1>Dashboard</h1>
      {/* Fast — renders immediately */}
      <UserProfile />

      {/* Slow query — streams in with skeleton while loading */}
      <Suspense fallback={<BookingSkeleton />}>
        <BookingHistory />
      </Suspense>
    </div>
  );
}
```

### Loading UI Patterns

WorkSphere uses `ChatMessageSkeleton` and other skeleton components from `src/components/ui/skeleton.tsx`. Always pair slow data with a skeleton rather than blocking the render:

```tsx
// In a route segment, loading.tsx renders automatically as the Suspense fallback
// src/app/dashboard/loading.tsx
export default function DashboardLoading() {
  return <DashboardSkeleton />;
}
```

---

## 7. Caching Strategies

### Next.js Request Cache

By default, `fetch()` in Server Components is cached for the lifetime of a request. You can control revalidation:

```typescript
// Cache indefinitely (static)
const data = await fetch('/api/venues', { cache: 'force-cache' });

// Revalidate every 60 seconds (ISR-style)
const data = await fetch('/api/venues', { next: { revalidate: 60 } });

// Never cache (always fresh)
const data = await fetch('/api/venues', { cache: 'no-store' });
```

### Incremental Static Regeneration (ISR)

For pages that have mostly static content but need occasional updates, use ISR to rebuild in the background without a full deployment:

```tsx
// src/app/venues/[id]/page.tsx
export const revalidate = 3600; // rebuild this page at most once per hour

export default async function VenuePage({ params }: { params: { id: string } }) {
  const venue = await getVenue(params.id);
  return <VenueDetail venue={venue} />;
}
```

### Route Cache

The Next.js Router Cache stores rendered Server Component payloads in the browser for the duration of a session. Navigating back to a page you've already visited is instant.

To opt out of route caching for a specific page (e.g. always-fresh data):

```tsx
import { unstable_noStore as noStore } from 'next/cache';

export default async function LiveDashboard() {
  noStore(); // disable route cache for this page
  const data = await getLiveData();
  return <Dashboard data={data} />;
}
```

### Upstash Redis Cache

WorkSphere uses [Upstash Redis](https://upstash.com/) via `@upstash/redis` for application-level caching of AI responses and rate limiting. This sits on top of Next.js's built-in caching as a persistent, shared cache across all serverless instances:

```typescript
// src/lib/rateLimit.ts
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});
```

### Cache-Control Headers

For API routes that return data consumed by external clients or CDNs, set appropriate `Cache-Control` headers:

```typescript
// src/app/api/venues/route.ts
export async function GET() {
  const venues = await getVenues();

  return Response.json(venues, {
    headers: {
      // Cache at CDN for 60s, allow stale for up to 5 minutes while revalidating
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
    },
  });
}
```

### Browser Caching

Static assets (fonts, images, scripts) served by Next.js are automatically given long-lived `Cache-Control` headers with content hashes in the filename. No manual configuration is needed for these.

---

## 8. Measuring Performance

### Lighthouse

Lighthouse is the fastest way to get a performance score and specific recommendations.

**In Chrome DevTools:**
1. Open DevTools (`F12`)
2. Go to the **Lighthouse** tab
3. Select **Performance** and **Mobile**
4. Click **Analyze page load**

**From the command line:**
```bash
npx lighthouse http://localhost:3000 --output html --output-path ./lighthouse-report.html
```

> **Tip:** Always run Lighthouse in an Incognito window to exclude browser extensions from the results.

### Chrome DevTools Performance Tab

For diagnosing specific interactions (slow button clicks, animation jank):

1. Open DevTools → **Performance** tab
2. Click **Record** (or press `Ctrl+Shift+E`)
3. Perform the interaction you want to measure
4. Click **Stop**
5. Look for **Long Tasks** (red bars > 50ms) and **Layout** events

### Next.js Built-in Profiling

Enable React's production profiler to measure component render times:

```bash
# Start dev server with profiling enabled
NEXT_PROFILE=true npm run dev
```

Then use the **Profiler** tab in React DevTools to record a session.

### Web Vitals in the App

WorkSphere's analytics module (`src/lib/analytics.ts`) already tracks user interactions. To add Core Web Vitals reporting:

```typescript
// src/app/layout.tsx
import { useReportWebVitals } from 'next/web-vitals';

export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    // Send to your analytics endpoint
    console.log(metric.name, metric.value);
  });
  return null;
}
```

### Performance Budgets

Set performance budgets to catch regressions before they ship. Add to `next.config.ts`:

```typescript
const nextConfig: NextConfig = {
  // Warn if any page exceeds these sizes
  experimental: {
    bundlePagesRouterDependencies: true,
  },
};
```

A practical budget for WorkSphere:

| Resource | Budget |
| :--- | :--- |
| First Load JS (landing page) | < 150 KB |
| First Load JS (AI page) | < 250 KB |
| LCP | < 2.5 s |
| CLS | < 0.1 |
| INP | < 200 ms |

---

## 9. Common Performance Pitfalls

### Too Many Client Components

**Problem:** Marking entire page layouts as `'use client'` sends all their JavaScript to the browser, inflating bundle size and disabling server-side rendering.

**Fix:** Only add `'use client'` to the smallest component that actually needs interactivity. Extract interactive elements into their own small Client Components.

---

### Large JavaScript Bundles

**Problem:** Importing heavy libraries (e.g. Leaflet, chart libraries, PDF generators) at the top level includes them in the initial bundle for every page.

**Fix:** Use `next/dynamic` with `ssr: false` for browser-only heavy libraries. WorkSphere already does this for Leaflet map components.

---

### Blocking Resources

**Problem:** Third-party scripts (analytics, chat widgets) loaded synchronously block page rendering.

**Fix:** Use `next/script` with `strategy="lazyOnload"` or `strategy="afterInteractive"` for non-critical scripts:

```tsx
import Script from 'next/script';

<Script
  src="https://example.com/analytics.js"
  strategy="lazyOnload"
/>
```

---

### Unoptimised Images

**Problem:** Using plain `<img>` tags serves original image files at full resolution, which can be several MB for high-quality venue photos.

**Fix:** Replace `<img>` with `next/image`. WorkSphere has several `eslint-disable-next-line @next/next/no-img-element` comments that mark components ready for this migration.

---

### Excessive Re-renders

**Problem:** A state update high in the component tree causes the entire subtree to re-render, even components that didn't change.

**Fix:**
```tsx
import { memo, useCallback, useMemo } from 'react';

// Memoize expensive child components
const VenueCard = memo(function VenueCard({ venue }: { venue: Venue }) {
  return <div>{venue.name}</div>;
});

// Memoize callbacks passed as props to prevent child re-renders
const handleToggleFavorite = useCallback((venue: Venue) => {
  setFavorites((prev) => toggleFavorite(prev, venue.id));
}, []);

// Memoize expensive calculations
const sortedVenues = useMemo(() =>
  venues.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
  [venues]
);
```

---

### Hydration Issues

**Problem:** The HTML rendered on the server does not match what React renders on the client, causing a hydration mismatch warning and a full client-side re-render.

**Common causes in WorkSphere:**
- Reading `localStorage` or `window` during render (these don't exist on the server)
- Using `Date.now()` or `Math.random()` during render

**Fix:**

```tsx
'use client';
import { useState, useEffect } from 'react';

// ❌ Causes hydration mismatch — window doesn't exist on server
const theme = window.localStorage.getItem('theme');

// ✅ Read browser APIs only after mount
function ThemeToggle() {
  const [theme, setTheme] = useState<string | null>(null);

  useEffect(() => {
    setTheme(localStorage.getItem('worksphere-theme'));
  }, []);

  return <button>{theme ?? 'system'}</button>;
}
```

WorkSphere's root layout already handles theme detection correctly by reading it from a cookie on the server side instead of from `localStorage`.

---

## 10. Best Practices Summary

| Practice | Do | Don't |
| :--- | :--- | :--- |
| **Component type** | Default to Server Components | Add `'use client'` to entire page layouts |
| **Heavy libraries** | Use `next/dynamic` with `ssr: false` | Import Leaflet / PDF libraries at the top level |
| **Images** | Use `next/image` with `width`, `height`, `sizes` | Use plain `<img>` tags for content images |
| **LCP image** | Add `priority` to the above-the-fold image | Mark every image as `priority` |
| **Fonts** | Use `next/font/google` or `next/font/local` | Add `<link>` tags to Google Fonts manually |
| **Data fetching** | Fetch in parallel with `Promise.all()` | Use sequential `await` for independent queries |
| **Slow queries** | Wrap in `<Suspense>` with a skeleton fallback | Block the entire page on one slow database call |
| **Bundle size** | Named imports from icon libraries | `import * as Icons from 'lucide-react'` |
| **Third-party scripts** | Use `next/script` with `lazyOnload` | Add `<script>` tags directly to `<head>` |
| **Re-renders** | `memo`, `useCallback`, `useMemo` where profiling shows need | Premature memoization of every component |
| **Caching** | Use `revalidate` for mostly-static pages | Use `cache: 'no-store'` everywhere by default |
| **Browser APIs** | Access inside `useEffect` | Read `window` / `localStorage` during render |

---

## 11. References

- [Next.js Performance Documentation](https://nextjs.org/docs/app/building-your-application/optimizing)
- [Next.js Image Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/images)
- [Next.js Font Optimization](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)
- [Next.js Data Fetching](https://nextjs.org/docs/app/building-your-application/data-fetching)
- [Next.js Caching](https://nextjs.org/docs/app/building-your-application/caching)
- [Next.js Bundle Analyzer](https://nextjs.org/docs/app/building-your-application/optimizing/bundle-analyzer)
- [Core Web Vitals](https://web.dev/articles/vitals)
- [Google Lighthouse](https://developer.chrome.com/docs/lighthouse/overview)
- [web.dev Performance](https://web.dev/performance)
- [React memo](https://react.dev/reference/react/memo)
- [React cache](https://react.dev/reference/react/cache)
