# Automated E2E Testing with Playwright

This guide explains how Playwright end-to-end testing is structured in WorkSphere. It covers how to install dependencies, run tests, write new tests, debug failures, and follow the project's testing standards.

It is intended for both new contributors writing their first E2E test and experienced developers debugging complex test failures in CI.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Project Structure](#2-project-structure)
3. [Installing & Running Tests](#3-installing--running-tests)
4. [Writing Playwright Tests](#4-writing-playwright-tests)
5. [Page Object Model](#5-page-object-model)
6. [Authentication & Mocking](#6-authentication--mocking)
7. [CI/CD Integration](#7-cicd-integration)
8. [Debugging Tests](#8-debugging-tests)
9. [Assertion Guidelines](#9-assertion-guidelines)
10. [Common Issues & Troubleshooting](#10-common-issues--troubleshooting)
11. [Best Practices](#11-best-practices)
12. [References](#12-references)

---

## 1. Introduction

### What is Playwright?

[Playwright](https://playwright.dev/) is a browser automation framework that drives a real browser (Chromium, Firefox, or WebKit) to simulate user interactions from end to end. Unlike Jest and React Testing Library, which test components in isolation using a simulated DOM, Playwright tests the fully assembled application running in a real browser.

### Unit Tests vs E2E Tests

| Aspect | Jest + RTL (Unit) | Playwright (E2E) |
| :--- | :--- | :--- |
| **What is tested** | Individual components, hooks, utilities | Full user journeys across pages |
| **Environment** | Simulated DOM (jsdom) | Real browser (Chromium) |
| **Speed** | Fast (milliseconds per test) | Slower (seconds per test) |
| **Dependencies** | Mocked | Real app with real HTTP requests |
| **Location** | `src/__tests__/` | `e2e/` |
| **Command** | `npm test` | `npm run test:e2e` |

### When to Write E2E Tests

Write Playwright tests when:

- You are implementing or modifying a complete user journey (landing → sign-in → AI page).
- You need to verify that multiple pages and API routes work together correctly.
- You are building PWA behaviour (service worker, manifest, offline page).
- You need to test responsive layouts across different viewport sizes.
- You want to catch regressions in navigation, routing, or page load behaviour.

Write Jest unit tests instead when you are testing a single component, a utility function, or an API route handler in isolation.

---

## 2. Project Structure

### Directory Layout

```
worksphere/
├── e2e/                        # All Playwright test files
│   ├── app.spec.ts             # Landing page, navigation, accessibility, SEO, dark mode
│   ├── chat.spec.ts            # AI chat interface, API health checks, PWA, error handling
│   └── user-flows.spec.ts      # Full user journeys, interactive elements, network conditions
├── playwright.config.ts        # Playwright configuration
└── playwright-report/          # Generated HTML report (after running tests)
```

### playwright.config.ts

The Playwright configuration is located at the project root. Key settings:

```typescript
export default defineConfig({
  testDir: './e2e',         // All tests live in e2e/
  fullyParallel: true,      // Tests run in parallel by default
  forbidOnly: !!process.env.CI,  // Prevents .only() being committed
  retries: process.env.CI ? 2 : 0, // Retries flaky tests in CI only
  workers: process.env.CI ? 1 : undefined, // Single worker in CI for stability
  reporter: 'html',         // Generates HTML report in playwright-report/
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',        // Captures trace on first retry
    screenshot: 'only-on-failure',  // Screenshots saved only on failure
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',         // Auto-starts dev server before tests
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI, // Reuses running server locally
    timeout: 120 * 1000,
  },
});
```

### Test File Naming Convention

| Pattern | Purpose |
| :--- | :--- |
| `*.spec.ts` | Standard Playwright test file |
| `app.spec.ts` | Tests for the landing page and global UI |
| `chat.spec.ts` | Tests for the AI chat interface and API routes |
| `user-flows.spec.ts` | Tests for complete user journeys |

Group related tests using `test.describe()` blocks within each file. Keep each file focused on one area of the application.

### Page Object Model Structure (Recommended)

For reusable page interactions, organise Page Object classes alongside the test files:

```
e2e/
├── pages/
│   ├── LandingPage.ts
│   ├── ChatPage.ts
│   └── SignInPage.ts
├── app.spec.ts
├── chat.spec.ts
└── user-flows.spec.ts
```

See [Section 5](#5-page-object-model) for how to create and use Page Objects.

---

## 3. Installing & Running Tests

### Install Dependencies

Playwright and its browser binaries are installed as part of `npm install`. If you need to install browser binaries manually:

```bash
npx playwright install
```

To install only Chromium (which is what WorkSphere's config uses):

```bash
npx playwright install chromium
```

### Run All Tests

```bash
npm run test:e2e
```

This starts the Next.js dev server automatically (or reuses an existing one) and runs all tests in `e2e/`.

### Run a Single Test File

```bash
npx playwright test e2e/app.spec.ts
```

### Run a Single Test by Name

```bash
npx playwright test -g "should load the homepage with correct title"
```

### Headless vs Headed Mode

By default, tests run in **headless** mode (no browser window). To watch the browser as tests run:

```bash
npx playwright test --headed
```

### Playwright UI Mode

UI mode provides a visual test explorer, timeline, and live browser preview — the best tool for writing and debugging tests interactively:

```bash
npm run test:e2e:ui
```

### Debug Mode

Pauses execution and opens the Playwright Inspector to step through tests line by line:

```bash
npx playwright test --debug
```

### Generate HTML Report

After a test run, open the HTML report to view results, screenshots, traces, and videos:

```bash
npx playwright show-report
```

The report is saved to `playwright-report/` automatically after every test run.

---

## 4. Writing Playwright Tests

### Recommended Test Structure

```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Area', () => {
  // Runs before every test in this describe block
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should describe the expected behaviour', async ({ page }) => {
    // 1. Arrange — navigate and set up state
    await page.goto('/sign-in');

    // 2. Act — interact with the page
    await page.locator('input[type="email"]').fill('user@example.com');

    // 3. Assert — verify the outcome
    await expect(page.locator('input[type="email"]')).toHaveValue('user@example.com');
  });
});
```

### Locator Best Practices

Prefer locators in this order — most stable to least stable:

| Priority | Locator | Example |
| :--- | :--- | :--- |
| 1 | `data-testid` attribute | `page.locator('[data-testid="chat-input"]')` |
| 2 | ARIA role + name | `page.getByRole('button', { name: 'Send' })` |
| 3 | Label text | `page.getByLabel('Email address')` |
| 4 | Placeholder text | `page.getByPlaceholder('Search venues...')` |
| 5 | Visible text | `page.getByText('Get Started')` |
| 6 | CSS class / tag | `page.locator('.leaflet-container')` — use only as a last resort |

Avoid selecting elements by position (`nth(0)`) or by internal implementation details like class names that may change.

### Handling Multiple Possible States

Some pages in WorkSphere can render differently depending on authentication status or location access. Use `.or()` to handle both states gracefully:

```typescript
const chatInput = page.locator('[placeholder*="Find"]');
const signInPrompt = page.locator('text=Sign in');

await expect(chatInput.or(signInPrompt)).toBeVisible({ timeout: 15000 });
```

This pattern is used throughout the existing e2e tests and prevents false failures.

### Waiting Strategies

Playwright automatically waits for elements to be ready before interacting. Avoid manual `waitForTimeout()` waits wherever possible — they make tests slow and fragile.

```typescript
// ✅ Good — waits for the element to be visible automatically
await page.locator('text=WorkSphere').first().click();

// ✅ Good — waits for network to settle
await page.waitForLoadState('networkidle');

// ⚠️ Use sparingly — only when waiting for animations
await page.waitForTimeout(500);

// ❌ Avoid — arbitrary waits are a sign of a flaky test
await page.waitForTimeout(3000);
```

### data-testid Usage

Add `data-testid` attributes to components that are tested frequently. This makes selectors immune to UI refactoring:

```tsx
// In component
<button data-testid="send-message-btn" type="submit">Send</button>

// In test
await page.locator('[data-testid="send-message-btn"]').click();
```

---

## 5. Page Object Model

### Why Use POM?

The Page Object Model separates page interaction logic from test assertions. Benefits:

- A single change to a selector only needs to be updated in one place.
- Tests become shorter and more readable.
- Page classes are reusable across multiple test files.

### Creating a Page Object Class

```typescript
// e2e/pages/LandingPage.ts
import { type Page, type Locator, expect } from '@playwright/test';

export class LandingPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly getStartedButton: Locator;
  readonly learnMoreLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.locator('h1');
    this.getStartedButton = page.locator('button:has-text("Get Started"), a:has-text("Get Started")').first();
    this.learnMoreLink = page.locator('a:has-text("Learn More")');
  }

  async goto() {
    await this.page.goto('/');
  }

  async clickGetStarted() {
    await this.getStartedButton.click();
  }

  async scrollToFeatures() {
    await this.learnMoreLink.click();
    await this.page.waitForTimeout(500); // allow scroll animation
  }

  async assertLoaded() {
    await expect(this.heading).toContainText('Find Your Perfect');
  }
}
```

### Using a Page Object in a Test

```typescript
// e2e/user-flows.spec.ts
import { test, expect } from '@playwright/test';
import { LandingPage } from './pages/LandingPage';

test.describe('Landing Page', () => {
  test('should display hero and scroll to features', async ({ page }) => {
    const landing = new LandingPage(page);

    await landing.goto();
    await landing.assertLoaded();
    await landing.scrollToFeatures();

    await expect(page.locator('text=WiFi Quality')).toBeVisible();
  });
});
```

### Recommended Page Object Structure

```
e2e/pages/
├── LandingPage.ts      # Landing page interactions
├── ChatPage.ts         # AI chat interface interactions
├── SignInPage.ts       # Sign-in form interactions
└── OfflinePage.ts      # Offline fallback page
```

---

## 6. Authentication & Mocking

### Handling Authenticated Routes

WorkSphere uses [Clerk](https://clerk.com/) for authentication. The `/ai` and `/dashboard` routes require a signed-in session. Playwright tests should be written to handle both the authenticated and unauthenticated states:

```typescript
test('should show chat interface or redirect to sign-in', async ({ page }) => {
  await page.goto('/ai');
  await page.waitForLoadState('networkidle');

  const chatInput = page.locator('input[type="text"]').first();
  const signInPage = page.locator('text=Sign in').first();

  // Accept either state — tests should not depend on a live Clerk session
  await expect(chatInput.or(signInPage)).toBeVisible({ timeout: 15000 });
});
```

> **Note:** Do not hard-code real user credentials in tests. Playwright tests in this project are designed to work without a live authentication session.

### Mocking External APIs with route()

Use `page.route()` to intercept and mock API responses. This makes tests deterministic and removes dependencies on live services:

```typescript
test('should show venues returned by the API', async ({ page }) => {
  // Intercept the venues API and return mock data
  await page.route('/api/venues*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        { id: '1', name: 'Test Cafe', category: 'cafe', lat: 37.77, lng: -122.41 },
      ]),
    });
  });

  await page.goto('/ai');
  await expect(page.locator('text=Test Cafe')).toBeVisible();
});
```

### Mocking Slow or Failed Responses

```typescript
// Simulate a slow location API response
await page.route('/api/location', async (route) => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await route.fulfill({
    status: 200,
    body: JSON.stringify({ lat: 37.7749, lng: -122.4194 }),
  });
});

// Simulate a failed API response
await page.route('/api/chat', async (route) => {
  await route.fulfill({ status: 500, body: 'Internal Server Error' });
});
```

### Test Isolation

Each test should be fully independent. Use `test.beforeEach` to reset state and avoid sharing variables between tests:

```typescript
test.beforeEach(async ({ page }) => {
  // Clear localStorage before each test
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
});
```

---

## 7. CI/CD Integration

### How Playwright Runs in GitHub Actions

Playwright E2E tests are **not** included in the main CI workflow (`.github/workflows/ci.yml`) — that workflow runs Jest unit tests only. Playwright is available for contributors to run locally and can be added to CI as the project grows.

The existing CI pipeline:

```
Pull Request opened
       │
       ▼
ci.yml (build-and-test job)
  ├── npm ci
  ├── npx prisma generate
  ├── npm run lint
  ├── npm run build
  └── npm test          ← Jest unit tests only
```

### Running Playwright in CI (When Added)

If you add Playwright to a GitHub Actions workflow, the recommended configuration is:

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium

- name: Run Playwright tests
  run: npm run test:e2e
  env:
    CI: true
    BASE_URL: http://localhost:3000
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.CLERK_PUBLISHABLE_KEY }}
```

> **Note:** In CI, `workers` is set to `1` and `retries` is set to `2` (from `playwright.config.ts`). This trades speed for stability on shared CI runners.

### Environment Variables for E2E Tests

| Variable | Purpose | Required for E2E |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk auth (client-side) | Yes |
| `CLERK_SECRET_KEY` | Clerk auth (server-side) | Yes |
| `DATABASE_URL` | Prisma database connection | Yes (for API routes) |
| `GROQ_API_KEY` | AI chat responses | Optional (tests mock auth state) |

---

## 8. Debugging Tests

### Playwright Inspector

Step through a test interactively. Playwright pauses at each action and highlights the target element in the browser:

```bash
npx playwright test --debug e2e/app.spec.ts
```

### Screenshots on Failure

Screenshots are automatically saved when a test fails (configured via `screenshot: 'only-on-failure'` in `playwright.config.ts`). Find them in `playwright-report/` after running `npx playwright show-report`.

### Trace Viewer

Traces capture a full timeline of every action, network request, and DOM snapshot. Traces are recorded on the first retry of a failed test:

```bash
# Run tests (traces are saved automatically on retry)
npm run test:e2e

# Open the trace viewer
npx playwright show-trace playwright-report/trace.zip
```

The Trace Viewer shows:
- Every action taken with timestamps
- Before/after DOM snapshots
- Network requests and responses
- Console logs

### Video Recording

To record a video of every test run, add this to `playwright.config.ts`:

```typescript
use: {
  video: 'on',  // or 'retain-on-failure' to save only failing tests
}
```

Videos are saved to the `playwright-report/` directory.

### Console Logs in Tests

Capture browser console output to help diagnose JavaScript errors:

```typescript
test('capture console errors', async ({ page }) => {
  const errors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  await page.goto('/');

  // Assert no console errors
  expect(errors).toHaveLength(0);
});
```

### Common Debugging Commands

| Command | Purpose |
| :--- | :--- |
| `npx playwright test --debug` | Step through tests with Inspector |
| `npx playwright test --headed` | Watch browser during test run |
| `npx playwright test --ui` | Interactive UI mode |
| `npx playwright show-report` | Open HTML report |
| `npx playwright test --trace on` | Always capture traces |
| `npx playwright test -g "test name"` | Run a single test by name |
| `PWDEBUG=1 npx playwright test` | Enable verbose debug output |

---

## 9. Assertion Guidelines

### Visibility Assertions

```typescript
// ✅ Check element is visible
await expect(page.locator('h1')).toBeVisible();

// ✅ Check element is hidden
await expect(page.locator('[data-testid="loading"]')).toBeHidden();

// ✅ Check element count
await expect(page.locator('.venue-card')).toHaveCount(5);
```

### URL Assertions

```typescript
// ✅ Exact URL match
await expect(page).toHaveURL('/ai');

// ✅ URL contains pattern
await expect(page).toHaveURL(/\/sign-in/);
```

### Text and Value Assertions

```typescript
// ✅ Contains text
await expect(page.locator('h1')).toContainText('Find Your Perfect');

// ✅ Exact text
await expect(page.locator('[data-testid="status"]')).toHaveText('Connected');

// ✅ Input value
await expect(page.locator('input[type="email"]')).toHaveValue('user@example.com');
```

### Network Assertions

```typescript
// ✅ Assert API response status using request fixture
const response = await request.get('/api/venues?lat=37.77&lng=-122.41');
expect(response.status()).toBe(200);

// ✅ Assert response body
const body = await response.json();
expect(body).toHaveProperty('venues');
```

### Accessibility Assertions

```typescript
// ✅ Check keyboard focus
await page.keyboard.press('Tab');
const focused = page.locator(':focus');
await expect(focused).toBeVisible();

// ✅ Check ARIA label
await expect(page.locator('[aria-label="Send message"]')).toBeVisible();

// ✅ Check for duplicate IDs (accessibility violation)
const ids = await page.evaluate(() =>
  Array.from(document.querySelectorAll('[id]')).map((el) => el.id)
);
const uniqueIds = new Set(ids);
expect(ids.length).toBe(uniqueIds.size);
```

### Avoiding Unnecessary Waits

```typescript
// ❌ Avoid — hides real timing issues
await page.waitForTimeout(2000);
await expect(page.locator('text=Success')).toBeVisible();

// ✅ Prefer — Playwright auto-waits up to the configured timeout
await expect(page.locator('text=Success')).toBeVisible({ timeout: 10000 });
```

---

## 10. Common Issues & Troubleshooting

### Browser Installation Issues

**Symptom:** `browserType.launch: Executable doesn't exist`

**Solution:**
```bash
npx playwright install chromium
# or install all browsers
npx playwright install --with-deps
```

---

### Dev Server Not Starting

**Symptom:** `Error: connect ECONNREFUSED 127.0.0.1:3000`

**Cause:** The dev server failed to start within the 120-second timeout configured in `playwright.config.ts`.

**Solution:**
1. Start the dev server manually first: `npm run dev`
2. Then run tests — Playwright will reuse the existing server (`reuseExistingServer: true` locally)
3. Check for build errors: `npm run build`

---

### Timeout Failures

**Symptom:** `Timeout 30000ms exceeded` or `waiting for locator...`

**Causes:**
- Element never appears because the page state is different than expected
- Auth redirect is happening unexpectedly

**Solution:**
```typescript
// Increase timeout for slow-loading elements
await expect(page.locator('text=WorkSphere')).toBeVisible({ timeout: 15000 });

// Use .or() to handle multiple possible states
await expect(chatInput.or(signInPage)).toBeVisible({ timeout: 15000 });
```

---

### Authentication Failures

**Symptom:** Tests fail because Clerk redirects to `/sign-in`

**Cause:** The test expects authenticated content but no valid session exists.

**Solution:** Write tests to handle both authenticated and unauthenticated states using `.or()`, as shown in [Section 6](#6-authentication--mocking). Do not rely on a live Clerk session in automated tests.

---

### Flaky Tests

**Symptom:** Tests pass locally but fail intermittently in CI or on rerun.

**Common causes and fixes:**

| Cause | Fix |
| :--- | :--- |
| Using `waitForTimeout` instead of element-based waits | Replace with `expect(...).toBeVisible()` |
| Race condition on page load | Use `waitForLoadState('networkidle')` |
| Animation or transition timing | Add a short `waitForTimeout(300)` only for animations |
| Shared state between tests | Clear `localStorage` in `beforeEach` |
| Order-dependent tests | Ensure each test is fully independent |

---

### CI-Only Failures

**Symptom:** Tests pass locally but fail in CI.

**Common causes:**
- Different screen resolution in CI headless mode — always set viewport explicitly:
  ```typescript
  await page.setViewportSize({ width: 1280, height: 720 });
  ```
- Slower CI machines — increase timeouts for CI:
  ```typescript
  test.setTimeout(60000); // 60s for slow CI
  ```
- Missing environment variables — verify all required env vars are set in the CI workflow

---

## 11. Best Practices

| Practice | Reason |
| :--- | :--- |
| Write independent tests | Tests that depend on each other fail unpredictably when run in parallel |
| Use `data-testid` for stable selectors | Class names and text content change; `data-testid` is explicit and intentional |
| Mock external APIs with `page.route()` | Removes network dependencies and makes tests deterministic |
| Use `waitForLoadState` instead of `waitForTimeout` | Element-based waits are more reliable and faster |
| Group tests with `test.describe()` | Keeps related tests together and makes reports easier to read |
| Use `test.beforeEach` to reset state | Prevents one test's side effects from affecting the next |
| Use Page Objects for shared interactions | Reduces duplication and centralises selector maintenance |
| Handle multiple page states with `.or()` | Tests remain stable regardless of auth status |
| Keep assertions specific | Vague assertions like `toBeVisible()` on the wrong element can mask bugs |
| Run `npx playwright show-report` after failures | The HTML report and trace viewer show exactly what went wrong |

---

## 12. References

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Playwright Assertions](https://playwright.dev/docs/test-assertions)
- [Playwright Locators](https://playwright.dev/docs/locators)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Playwright Page Object Model](https://playwright.dev/docs/pom)
- [Playwright API Mocking](https://playwright.dev/docs/mock)
- [Playwright Configuration](https://playwright.dev/docs/test-configuration)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
