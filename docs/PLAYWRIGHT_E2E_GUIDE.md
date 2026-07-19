# Playwright E2E Testing Guide

A practical guide to WorkSphere's end-to-end test suite: how the tests are organised, how to mock authentication for protected flows, and how E2E fits (and doesn't yet fit) into the CI pipeline. All paths and commands below reference the actual files in this repository.

---

## Table of Contents

1. [Overview](#overview)
2. [Test Structure](#test-structure)
3. [Configuration Reference](#configuration-reference)
4. [Running Tests Locally](#running-tests-locally)
5. [Authentication Mocking](#authentication-mocking)
6. [Writing Flow Tests: Search, Chat, Booking](#writing-flow-tests-search-chat-booking)
7. [CI Pipeline Integration](#ci-pipeline-integration)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## Overview

WorkSphere uses [`@playwright/test`](https://playwright.dev) for browser-level E2E coverage, separate from the Jest/RTL unit and component tests in `src/__tests__/`. E2E tests exercise real routes against a running Next.js server (`npm run dev`), so they catch integration issues — routing, Clerk redirects, API wiring — that mocked unit tests can't.

| Layer            | Location         | Tool       | What it covers                                                     |
| ---------------- | ---------------- | ---------- | ------------------------------------------------------------------ |
| Unit / component | `src/__tests__/` | Jest + RTL | Isolated components, hooks, API handlers, with mocked dependencies |
| End-to-end       | `e2e/`           | Playwright | Real browser sessions against the running app                      |

---

## Test Structure

All E2E specs live in the `e2e/` directory at the project root and end in `.spec.ts`:

```
e2e/
├── app.spec.ts          # Landing page, navigation, responsive/dark-mode, SEO, a11y
├── chat.spec.ts         # /ai chat interface, API health checks, PWA assets, auth pages
└── user-flows.spec.ts   # Multi-step user journeys (landing → sign up, back/forward nav, forms)
```

**Conventions used in the existing suite:**

- Group related tests with `test.describe('Area Name', () => { ... })`.
- Use `test.beforeEach` for shared setup (e.g. navigating to a page, setting a viewport).
- Prefer role/text locators (`page.locator('text=...')`, `button:has-text(...)`) over brittle CSS selectors, matching how the app renders content.
- When a page's state depends on auth (signed-in vs signed-out vs loading), assert on the _union_ of acceptable outcomes with `.or(...)` rather than assuming one state. Example from `chat.spec.ts`:

  ```typescript
  const chatInput = page
    .locator(
      '[placeholder*="Find"], [placeholder*="Search"], [placeholder*="Ask"], input[type="text"], textarea',
    )
    .first();
  const signInPage = page
    .locator("text=Sign in, text=Log in, text=Welcome back")
    .first();
  const loadingState = page
    .locator("text=Finding Your Location, text=Getting your location")
    .first();

  await expect(chatInput.or(signInPage).or(loadingState)).toBeVisible({
    timeout: 15000,
  });
  ```

  This keeps tests stable without needing real credentials, but it means these specific tests don't verify authenticated _behaviour_ — only that the page renders something reasonable regardless of auth state. See [Authentication Mocking](#authentication-mocking) for how to test the authenticated path directly.

New spec files should follow the same `e2e/<area>.spec.ts` naming and be added to this table when created.

---

## Configuration Reference

Defined in `playwright.config.ts`:

| Setting          | Value                                                 | Meaning                                                                                                                      |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `testDir`        | `./e2e`                                               | Only files here are picked up                                                                                                |
| `fullyParallel`  | `true`                                                | Tests within a file can run concurrently                                                                                     |
| `retries`        | `2` in CI, `0` locally                                | Flaky-test tolerance is CI-only                                                                                              |
| `workers`        | `1` in CI, default locally                            | CI runs serially to avoid resource contention                                                                                |
| `reporter`       | `'html'`                                              | Run `npx playwright show-report` after a run to view results                                                                 |
| `use.baseURL`    | `http://localhost:3000`                               | Lets specs call `page.goto('/path')` instead of full URLs                                                                    |
| `use.trace`      | `'on-first-retry'`                                    | Trace files help debug flaky/failing tests                                                                                   |
| `use.screenshot` | `'only-on-failure'`                                   |                                                                                                                              |
| `projects`       | Chromium only                                         | Firefox/WebKit aren't currently run — see [Best Practices](#best-practices) if you want to add them                          |
| `webServer`      | Runs `npm run dev`, reuses existing server outside CI | Playwright starts and tears down the dev server for you; no need to `npm run dev` manually before `npm run test:e2e` locally |

---

## Running Tests Locally

```bash
# Headless run (same mode CI would use)
npm run test:e2e

# Interactive UI mode — step through tests, inspect DOM snapshots, time-travel
npm run test:e2e:ui

# Headed mode (see the actual browser)
npx playwright test --headed

# Run a single file
npx playwright test e2e/chat.spec.ts

# Run a single test by name
npx playwright test -g "should show chat interface or auth prompt"
```

**First-time setup:** Playwright needs browser binaries, which aren't installed via `npm install` alone:

```bash
npx playwright install chromium
```

**Environment variables:** the app reads Clerk, database, and API keys from `.env`. For local E2E runs you need at minimum a valid `DATABASE_URL` and Clerk publishable/secret keys (see `docs/ENV_VARS.md`), since `webServer` boots a real `npm run dev` instance.

---

## Authentication Mocking

WorkSphere uses Clerk (`@clerk/nextjs`) for auth. Unlike the Jest suite — which mocks `useUser` directly (see `CONTRIBUTING.md` §3) — Playwright drives a real browser against a real server, so there's no module boundary to `jest.mock()`. There are two workable strategies, and this repo currently only uses the first:

### 1. Auth-agnostic assertions (current approach, no protected-route coverage)

The existing specs sidestep auth entirely by asserting on whichever state appears (see the `.or()` pattern in [Test Structure](#test-structure)). This is fast and requires no setup, but it cannot verify what a signed-in user actually sees or does — it only proves the page didn't crash.

### 2. Route interception for protected UI (recommended for new authenticated-flow tests)

For a test that needs to _act_ as a signed-in user without a real Clerk login, intercept the network calls the page depends on and stub Clerk's own client-side calls plus your protected API routes. This avoids needing real test accounts or a Clerk testing-token integration:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Booking flow — authenticated", () => {
  test.beforeEach(async ({ page }) => {
    // Stub Clerk's client bootstrap so the app treats the session as signed-in.
    await page.route("**/*.clerk.accounts.dev/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          response: { id: "test-user-id" /* minimal client shape */ },
        }),
      });
    });

    // Stub the protected API route directly — this is what most component
    // logic actually depends on, so it's often enough on its own.
    await page.route("**/api/reservations/availability**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true, slots: [] }),
      });
    });
  });

  test("shows booking confirmation UI", async ({ page }) => {
    await page.goto("/reserve/test-venue-id");
    // Assertions against the reservation-client UI...
  });
});
```

This is intentionally scoped to the network boundary rather than Clerk's internal client state, because Clerk's client SDK isn't designed to be faked from the outside. **For flows where you only need to confirm a signed-in-only route rejects anonymous access**, it's simpler and more reliable to hit the API directly and check the status code, as `chat.spec.ts` already does:

```typescript
test("should have healthy venues API", async ({ request }) => {
  const venuesResponse = await request.get(
    "/api/venues?lat=37.7749&lng=-122.4194&radius=1000",
  );
  expect([200, 401, 403]).toContain(venuesResponse.status());
});
```

### If you need real authenticated sessions

For deeper coverage that must go through actual Clerk sign-in (e.g. verifying a real session cookie persists across page reloads), the maintained path is Clerk's [`@clerk/testing`](https://clerk.com/docs/testing/playwright/overview) package, which provides a `clerkSetup()` helper and a testing token that bypasses bot detection during real sign-in. That package is **not currently installed** in this repo — adding it is a reasonable follow-up if protected-flow coverage grows beyond what route interception can reasonably fake. Until then, use approach 2 above for UI behaviour and direct API assertions for auth-boundary checks.

---

## Writing Flow Tests: Search, Chat, Booking

Reference these existing routes when writing new specs:

| Flow          | Route(s)             | Key UI                                       | Key API                                                                                           |
| ------------- | -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Search / chat | `/ai`                | `EnhancedChatbot`, map/chat toggle on mobile | `POST /api/chat`, `GET /api/venues`                                                               |
| Booking       | `/reserve/[venueId]` | `reservation-client.tsx`, `BookingModal`     | `POST /api/reservations/book`, `GET /api/reservations/availability`, `POST /api/bookings/confirm` |

`chat.spec.ts` already covers the unauthenticated shell of the chat/search page. A booking-flow spec doesn't exist yet — when adding `e2e/booking.spec.ts`, follow the same structure:

```typescript
import { test, expect } from "@playwright/test";

test.describe("Booking Flow", () => {
  test("unauthenticated user is redirected or prompted to sign in", async ({
    page,
  }) => {
    await page.goto("/reserve/test-venue-id");

    const signIn = page.locator("text=Sign in, text=Welcome back").first();
    await expect(signIn).toBeVisible({ timeout: 15000 });
  });

  test("booking API rejects unauthenticated requests", async ({ request }) => {
    const response = await request.post("/api/reservations/book", {
      data: {
        venueId: "test-venue-id",
        seatId: "seat-1",
        time: "10:00",
        duration: 60,
      },
    });
    expect(response.status()).toBe(401);
  });

  // Authenticated booking submission — use the route-interception pattern
  // from "Authentication Mocking" above once you add this test.
});
```

Keep new specs narrowly scoped per file (`search.spec.ts`, `booking.spec.ts`) rather than growing `chat.spec.ts` indefinitely, so failures are easy to attribute.

---

## CI Pipeline Integration

**Current state:** `.github/workflows/ci.yml` runs lint, `tsc`/build, and the Jest unit suite (`npm test`) on every PR — it does **not** currently run `npm run test:e2e`. Playwright tests only run locally today.

This is worth knowing before you assume a green PR check means E2E passed — it doesn't yet cover that.

**Adding E2E to CI** (optional follow-up, not required for this doc's scope) would look like adding a job to `ci.yml` after the existing `build-and-test` job:

```yaml
e2e-test:
  runs-on: ubuntu-latest
  needs: build-and-test
  env:
    # Same dummy env vars as build-and-test — see existing job for the full list
    DATABASE_URL: postgresql://dummy:dummy@localhost:5432/dummy
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_...
    CLERK_SECRET_KEY: sk_test_dummy
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: "20"
        cache: "npm"
    - run: npm ci
    - run: npx prisma generate
    - run: npx playwright install --with-deps chromium
    - run: npm run test:e2e
    - uses: actions/upload-artifact@v4
      if: failure()
      with:
        name: playwright-report
        path: playwright-report/
        retention-days: 7
```

Notes if this gets added later:

- `playwright.config.ts` already detects `process.env.CI` to enable retries and single-worker mode — no config changes needed.
- The dummy `DATABASE_URL` used by the unit-test job won't satisfy routes that actually query Postgres (e.g. `/api/venues`), so tests that hit real data-backed routes will need either a seeded test database or route-level mocking, same as [Authentication Mocking](#authentication-mocking) above.
- `npx playwright install --with-deps` is required in CI (unlike local dev) because GitHub's Ubuntu runners don't ship the browser's system dependencies.

---

## Troubleshooting

| Symptom                                                 | Likely cause                                                                                  | Fix                                                                                                                           |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `browserType.launch: Executable doesn't exist`          | Browser binaries not installed                                                                | `npx playwright install chromium`                                                                                             |
| Tests time out waiting for `webServer`                  | Port 3000 already in use, or `npm run dev` failing to boot                                    | Kill any process on 3000; run `npm run dev` manually to see the real error                                                    |
| Auth-dependent test flakes between signed-in/out states | Relying on `.or()` assertions across a real Clerk session that can vary between runs          | Use the route-interception pattern in [Authentication Mocking](#authentication-mocking) instead of asserting on ambient state |
| Test passes locally, fails in CI (once added)           | Local run reused a dev server (`reuseExistingServer: true` outside CI); CI always boots fresh | Reproduce with `CI=true npm run test:e2e` locally                                                                             |

---

## Best Practices

- Keep specs organized by user-facing area (`app`, `chat`, `booking`, `search`), not by component name.
- Prefer the route-interception approach over broad `.or()` fallbacks whenever a test's whole point is to verify authenticated behaviour — otherwise the test can pass even if the authenticated path is broken.
- Assert on API status codes directly (via the `request` fixture) for auth-boundary checks; it's faster and less flaky than driving the UI to prove a 401.
- If the suite grows to need Firefox/WebKit coverage or real Clerk sessions, add `@clerk/testing` and additional `projects` entries in `playwright.config.ts` rather than hand-rolling further workarounds.
