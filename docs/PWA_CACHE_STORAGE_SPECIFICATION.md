# PWA Service Worker Cache Storage Specification

## Overview

This document outlines the native Service Worker caching strategies for the WorkSphere Progressive Web App (PWA). It details the native Cache API routing, size limitations, offline fallbacks, and specific handling for Mobile Safari storage quotas.

---

## 1. Routing & Strategies

We utilize the native browser `Cache API` to manage our service worker routing and caching logic, ensuring reliable offline performance without relying on external libraries like Workbox.

- **Static & External Assets:** Uses the `Cache-First` strategy. These assets are safely cached in the primary `worksphere-v3` cache.
- **Images & Avatars:** Uses the `Cache-First` strategy, storing assets in a dedicated `worksphere-images-v4` cache with strict size limits.
- **API Requests (e.g., `/api/venues`):** Uses the `Network-First` strategy. This ensures users always get the freshest data when online, but can still view previously fetched venues when offline.

## 2. Cache Size Capping & Eviction

To prevent the PWA from consuming too much device storage, we enforce manual size limits and versioning controls within the Service Worker logic.

- **Image Cache (`worksphere-images-v4`):** Capped strictly at `20MB`. When this threshold is exceeded, older entries are manually evicted from the cache array.
- **Core Assets (`worksphere-v3`):** Versioned dynamically. During the Service Worker `activate` phase, any outdated caches (e.g., `worksphere-v1`, `worksphere-v2`) are automatically purged to free up space.

## 3. Offline Page Fallback

When a user loses network connectivity and navigates to a route that is not currently stored in the cache, the Service Worker intercepts the failed network request and serves a pre-cached offline fallback screen.

- **Offline Route:** `/offline.html` (Precached during the initial Service Worker `install` event).
- **Implementation:** Handled via a `catch` block in the `fetch` event listener that triggers specifically when a request for `request.destination === 'document'` fails.

## 4. Mobile Safari (iOS) Storage Quota Rules

iOS Safari employs aggressive and opaque cache eviction policies compared to Chrome/Android, requiring specific architectural considerations.

- **Storage Limits:** Safari typically limits total PWA storage to roughly 50MB for isolated web apps, though this scales dynamically based on available device disk space.
- **Silent Eviction:** If the iOS device experiences storage pressure, Safari will silently purge the Service Worker Cache API data without firing any warning events to the application.
- **Mitigation Strategy:**
  1.  Keep the `worksphere-v3` cache as small as possible.
  2.  Rely on IndexedDB for critical, user-generated offline data, as Safari tends to prioritize Cache API data for eviction before touching IndexedDB.
