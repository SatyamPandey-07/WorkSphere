# Redis Caching Architecture

## Overview

This document outlines the Redis caching patterns implemented in the WorkSphere backend. The caching layer is specifically optimized for reducing database load on read-heavy operations, managing API traffic, and securely handling user sessions.

---

## 1. Venue Search Results

Caches search queries for workspaces and venues to ensure low-latency responses for end-users.

- **Cache Key Pattern:** `venue:search:{location}:{filters_hash}`
  - _Example:_ `venue:search:mumbai:a1b2c3d4`
- **TTL Policy:** `3600 seconds` (1 hour)
- **Invalidation Strategy:**
  - **Time-based:** Naturally expires after the TTL.
  - **Mutation-based:** Proactively invalidated when a venue's availability, pricing, or core details are updated in the database (e.g., triggering a background job to delete relevant keys matching `venue:search:*`).

## 2. Rate Limiting

Prevents API abuse and ensures fair usage across the platform using a distributed rate-limiting strategy.

- **Cache Key Pattern:** `worksphere:ratelimit:{action}:{userId_or_ip}`
  - _Example:_ `worksphere:ratelimit:venues-search:192.168.1.1`
- **TTL Policy:** `60 seconds` (1 minute window)
- **Invalidation Strategy:**
  - **Time-based:** Keys automatically expire at the end of the rate limit window.
  - **Mutation-based:** No manual invalidation is required under normal operation.

## 3. Session Stores

Manages active user authentication sessions for fast validation and immediate global revocation capabilities.

- **Cache Key Pattern:** `session:{opaque_session_id}`
  - _Example:_ `session:9f86d081884c7d659a2feaa0c55ad015`
- **TTL Policy:** `604800 seconds` (7 days) - Often refreshed upon active user interaction depending on middleware logic.
- **Invalidation Strategy:**
  - **Time-based:** Expires automatically if the user remains inactive beyond the TTL.
  - **Mutation-based:** Explicitly deleted upon user logout, password reset, or if an administrator forces a session revocation.
