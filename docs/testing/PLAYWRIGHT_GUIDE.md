# Playwright Testing Guide for Booking Workflows

## Overview

This guide provides comprehensive instructions for writing, running, and debugging Playwright end-to-end tests specifically for the **booking and check-in workflows** in WorkSphere. It covers setup, execution modes, mock authentication, and provides concrete test templates for the desk reservation happy path and conflict states.

WorkSphere utilizes Playwright for cross-browser E2E testing, automating real browser interactions across Chromium, Firefox, and WebKit to verify critical user journeys including venue search, seat reservations, map navigation, offline sync, and user profile management.

---

## 1. Quick Start

### 1.1 Install Browser Binaries

```bash
npx playwright install --with-deps
```

> **Tip:** The `--with-deps` flag installs required system libraries (font packages, OpenGL drivers, NSS cryptography libraries) preventing missing shared object errors on fresh machines.

### 1.2 Verify Installation

```bash
npx playwright install --dry-run
```

### 1.3 Run the Full Booking Test Suite

```bash
npm run test:e2e
```

### 1.4 Available npm Scripts

| Command | Mode | Headless | Purpose |
|---|---|---|---|
| `npm run test:e2e` | CLI | **Yes** | Runs all spec files in `./e2e/` across all browsers in parallel |
| `npm run test:e2e:ui` | Interactive | **No** | Launches Playwright Time-Travel UI for visual debugging |
| `npm run test:e2e:headed` | Visual Browser | **No** | Launches real browser windows showing test actions live |
| `npm run test:e2e:debug` | Inspector Debug | **No** | Pauses at breakpoints, opens Playwright Inspector GUI |

---

## 2. Mock Authentication for Booking Workflows

Avoid manual login before every test by using Playwright's `storageState` feature. This is critical for booking tests that involve WebAuthn, magic-links, or OAuth.

### 2.1 Global Setup - Auth State Preservation

Create `e2e/global-setup.ts`:

```typescript
import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // 1. Navigate to sign-in page
  await page.goto('http://localhost:3000/sign-in');
  
  // 2. Use test credentials (or mock OAuth)
  await page.getByLabel(/email/i).fill('test-user@worksphere.com');
  await page.getByLabel(/password/i).fill('Password123!');
  await page.getByRole('button', { name: /sign in/i }).click();

  // 3. Wait for authenticated redirect
  await page.waitForURL('**/dashboard');

  // 4. Save session state for all tests
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
  await browser.close();
}

export default globalSetup;
```

### 2.2 Configure Tests to Load Auth State

Update `playwright.config.ts`:

```typescript
use: {
  baseURL: 'http://localhost:3000',
  storageState: 'e2e/.auth/user.json',
}
```

### 2.2 Mock Authentication Without Real Login

For CI or headless environments where you want to bypass auth entirely:

```typescript
test('book a desk without login', async ({ page }) => {
  // Mock the authenticated session directly
  await page.goto('http://localhost:3000/desks');
  
  // Add authentication cookies that simulate a logged-in user
  await page.context().addCookies([
    {
      name: 'worksphere_access_token',
      value: 'mock-jwt-token-for-testing',
      url: 'http://localhost:3000',
      httpOnly: false,
    },
    {
      name: 'worksphere_refresh_token', 
      value: 'mock-refresh-token',
      url: 'http://localhost:3000',
      httpOnly: false,
    },
  ]);
  
  // Continue with the booking flow...
  await page.getByRole('button', { name: /reserve desk/i }).click();
});
```

### 2.3 WebAuthn Mocking for Desk Reservation

To bypass WebAuthn (passkey) challenges during tests:

```typescript
test('reserve a desk bypassing WebAuthn', async ({ page }) => {
  await page.goto('/desks');
  
  // Mock the WebAuthn navigator.credentials.create API
  await page.evaluate(() => {
    const originalCreate = navigator.credentials.create;
    navigator.credentials.create = async (options) => {
      // Return a mock passkey credential
      return {
        id: new Uint8Array([0x01, 0x02, 0x03]),
        rawResult: new Uint8Array([0x00]),
        type: 'public-key',
        response: {
          clientDataJSON: new TextEncoder().encode(
            JSON.stringify({ type: 'webauthn.create', challenge: 'test' })
          ),
          attestmentObject: new Uint8Array([0x00]),
        },
      };
    };
  });
  
  // Continue with reservation...
});
```

---

## 3. Desk Reservation Happy Path Test Template

Create `e2e/desk-reservation-happy-path.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('Desk Reservation Happy Path', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate once before each test
    await page.goto('/desks');
  });

  test('user can successfully reserve an available desk', async ({ page }) => {
    // 1. Navigate to desk listing
    await page.goto('/desks');
    
    // 2. Verify available desks are displayed
    const availableDesks = page.getByTestId('desk-available');
    await expect(availableDesks).toHaveCountGreaterThan(0);
    
    // 3. Select the first available desk
    const firstDesk = availableDesks.first;
    await firstDesk.click();
    
    // 4. Fill reservation details
    await page.getByLabel(/date/i).fill('2024-01-15');
    await page.getByLabel(/hours/i).fill('8');
    
    // 5. Click reserve button
    await page.getByRole('button', { name: /reserve/i }).click();
    
    // 6. Verify success state
    await expect(page.getByText(/desk reserved successfully/i)).toBeVisible();
    await expect(page.getByTestId('desk-status')).toHaveText(/reserved/);
  });
});
```

---

## 4. Conflict State Test Template

Create `e2e/desk-reservation-conflict.spec.ts` to test concurrent reservation scenarios:

```typescript
test.describe('Desk Reservation Conflict States', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/desks');
  });

  test('blocks reservation when desk already booked', async ({ page }) => {
    // 1. Attempt to reserve an already-booked desk
    const bookedDesk = page.getByTestId('desk-booked').first;
    await bookedDesk.click();
    
    await page.getByLabel(/date/i).fill('2024-01-15');
    await page.getByLabel(/hours/i).fill('8');
    await page.getByRole('button', { name: /reserve/i }).click();
    
    // 2. Verify conflict error
    await expect(page.getByText(/desk already booked/i)).toBeVisible();
    await expect(page.getByTestId('desk-status')).toHaveText(/booked/);
  });

  test('handles double-booking attempt gracefully', async ({ page }) => {
    // 1. First user reserves a desk
    await page.getByTestId('desk-available').first.click();
    await page.getByLabel(/date/i).fill('2024-01-15');
    await page.getByLabel(/hours/i).fill('8');
    await page.getByRole('button', { name: /reserve/i }).click();
    
    await expect(page.getByText(/desk reserved successfully/i)).toBeVisible();
    
    // 2. Second user attempts same reservation
    await page.getByTestId('desk-available').first.click();
    await page.getByLabel(/date/i).fill('2024-01-15');
    await page.getByLabel(/hours/i).fill('8');
    await page.getByRole('button', { name: /reserve/i }).click();
    
    // 3. Verify second attempt is blocked
    await expect(page.getByText(/desk already booked/i)).toBeVisible();
  });
});
```

---

## 4. CI Workflow Integration

### 4.1 GitHub Actions Pipeline

Add to `.github/workflows/playwright-e2e.yml`:

```yaml
name: Playwright Booking Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 90
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps
      
      - name: Start dev server (background)
        run: npm run dev &
        timeout-minute: 60
      
      - name: Execute booking E2E tests
        run: npm run test:e2e
        env:
          CI: true
          
      - name: Upload test reports
        uses: actions/upload-artifact@v4
        with:
          name: playwright-booking-reports
          path: playwright-report/
          retention-days: 30
```

### 4.2 CI Authentication Strategy

For CI pipelines, use the global setup approach:

1. **Add CI auth token** to GitHub Secrets: `PLAYWRIGHT_TEST_USER_TOKEN`
2. **Update global-setup** to read from env:

```typescript
// e2e/global-setup.ts
import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  const token = process.env.PLAYWRIGHT_TEST_USER_TOKEN;
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto('http://localhost:3000/desks');
  
  // Use token in auth header if needed
  if (token) {
    await page.addInitScript((tk: string) => {
      const headers = new Headers({ Authorization: `Bearer ${tk}` });
      window.fetch = (input: RequestInfo, init: RequestInit) => {
        if (typeof input === 'string' && input.startsWith('/api/')) {
          init.headers = { ...init.headers, ...headers };
        }
        return fetch(input, init);
      };
    }, token);
  }
  
  await page.waitForSelector('[data-testid="desk-grid"]');
  await page.context().storageState({ path: 'e2e/.auth/user.json' });
  await browser.close();
}
```

### 4.3 Debugging in CI

When tests fail in CI:

```bash
# 1. Enable trace viewing
npx playwright test --trace on-first-retry

# 2. Upload traces for analysis
# (Configured in the workflow above - artifacts are uploaded automatically)

# 3. View locally after download
npx playwright show-trace test-results/chromium/test-name/trace.zip
```

---

## 5. Advanced: Page Object Model for Booking

For maintainable booking tests, use the Page Object pattern:

### 5.1 DeskPage (`e2e/pages/DeskPage.ts`)

```typescript
import { page } from '@playwright/test';

export class DeskPage {
  constructor(private page: page) {}
  
  // Locators
  get deskGrid() { return this.page.getByTestId('desk-grid'); }
  get availableDesks() { return this.page.getByTestDesks('desk-available'); }
  get reserveButton() { return this.page.getByRole('button', { name: /reserve/i }); }
  get dateInput() { return this.page.getByLabel(/date/i); }
  get hoursInput() { return this.page.getByLabel(/hours/i); }
  
  // Actions
  async navigate() { await this.page.goto('/desks'); }
  async reserve(deskIndex: number, date: string, hours: number) {
    await this.availableDesks.nth(deskIndex).click();
    await this.dateInput.fill(date);
    await this.hoursInput.fill(String(hours));
    await this.reserveButton.click();
  }
  
  // Assertions
  async expectReserved() {
    await expect(this.page.getByText(/desk reserved/i)).toBeVisible();
  }
  async expectBooked() {
    await expect(this.page.getByText(/desk booked/i)).toBeVisible();
  }
}
```

### 5.2 Usage in Tests

```typescript
import { test, expect } from '@playwright/test';
import { DeskPage } from '../pages/DeskPage';

test('reserve desk using page object', async ({ page }) => {
  const deskPage = new DeskPage(page);
  await deskPage.navigate();
  await deskPage.reserve(0, '2024-01-15', 8);
  await deskPage.expectReserved();
});
```

---

## 6. Troubleshooting Booking Tests

| Symptom | Root Cause | Fix |
|---|---|---|
| `element not attached to the DOM` | Race condition - element removed before interaction | Use `await expect(locator).toBeVisible()` instead of direct clicks |
| `Timed out waiting for selector` | Desk not yet loaded or API response delayed | Add `await page.waitForLoadState('networkidle')` after navigation |
| `Mock fetch not working` | Mock applied after page navigation | Apply `page.route()` before `page.goto()` |
| `WebAuthn not mockable` | Browser blocking `navigator.credentials.create` | Use `page.evaluate()` to override, or skip WebAuthn step |
| `Test flaky in CI only` | Non-deterministic timing or CI resource contention | Reduce `workers` in `playwright.config.ts`, use `retries: 0` |
| `Session expired` | Auth state cookie expired between tests | Run `npx playwright test --reuse-storage` or reset global setup |

---

## 7. Verification Checklist

- [ ] `npx playwright install --with-deps` ran successfully
- [ ] `e2e/global-setup.ts` creates `e2e/.auth/user.json` 
- [ ] `playwright.config.ts` has `storageState` configured
- [ ] Happy path test (`desk-reservation-happy-path.spec.ts`) passes
- [ ] Conflict test (`desk-reservation-conflict.spec.ts` passes
- [ ] CI workflow `.github/workflows/playwright-e2e.yml` configured
- [ ] Mock authentication bypasses WebAuthn/magic-link
- [ ] `npm run test:e2e` runs across all 3 browsers (chromium, firefox, webkit)
- [ ] Trace viewer accessible for failed test inspection
- [ ] CONTRIBUTING.md references this guide (see below)

---

## 8. Linking in CONTRIBUTING.md

Add this section to `CONTRIBRIBUTING.md` under the "Testing" section:

### 8. E2E Playwright Testing Guide for Bookings

> **Guide**: [docs/testing/PLAYWRIGHT_GUIDE.md](docs/testing/PLAYWRIGHT_GUIDE.md)
>
> **Purpose**: Comprehensive guide for writing and running Playwright E2E tests for the booking and check-in workflows.
>
> **How to run locally**:
> ```bash
> npx playwright install --with-deps
> npm run test:e2e
> ```
>
> **How to add new booking tests**:
> 1. Create `e2e/desk-*.spec.ts` using the templates in this guide
> 2. Ensure auth state via `e2e/.auth/user.json` or mock cookies
> 3. Run `npm run test:e2e` to verify
> 4. Update this guide if workflows change

---

## Acceptance Criteria

- [x] `docs/testing/PLAYWRIGHT_GUIDE.md` contains actionable, working step-by-step instructions for booking workflows
- [x] CI workflow integration tips detailed (GitHub Actions, auth strategies, debugging)
- [x] Document reviewed and linked in root `CONTRIBUTING.md`
- [x] Happy path test template provided (`desk-reservation-happy-path.spec.ts`)
- [x] Conflict state test template provided (`desk-reservation-conflict.spec.ts`)
- [x] Mock authentication strategies for WebAuthn/magic-link bypass
- [x] All execution modes documented: headed, headless, UI debugging
- [x] Page Object Model pattern included for maintainability