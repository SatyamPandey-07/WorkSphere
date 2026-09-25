# 🤝 Contributing to WorkSphere

Thank you for your interest in contributing to WorkSphere! This document details the standards and guidelines for development, code styling, testing, and verifying changes before submitting a pull request.

---

## Community Standards

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing to help maintain a welcoming and respectful community.

---

## 📋 Table of Contents

1. [Git Workflow & PRs](#1-git-workflow--prs)
2. [Code Style & Quality Checks](#2-code-style--quality-checks)
3. [Testing Conventions (Jest & RTL)](#3-testing-conventions-jest--rtl)
4. [E2E Testing (Playwright)](#4-e2e-testing-playwright)
5. [Pre-Commit Quality Verification Checklist](#5-pre-commit-quality-verification-checklist)

---

## 1. Git Workflow & PRs

To keep the repository clean and manageable, please follow this flow:

1. **Fork** the repository and clone it locally.
2. **Create a branch** using a descriptive naming convention:
   - `feature/your-feature-name` for new features.
   - `bugfix/issue-description` for bug fixes.
   - `docs/topic-name` for documentation updates.
3. **Write code** and ensure all [testing](#3-testing-conventions-jest--rtl) and [pre-commit checks](#5-pre-commit-quality-verification-checklist) pass.
4. **Commit** your changes with clear, structured commit messages (e.g., `feat: add map route coordinates validation`). See below for detailed commit formatting rules.
5. **Push** to your fork and open a **Pull Request (PR)** against the `main` branch. Ensure the PR title adheres to the strict formatting rules outlined in Section 1.2.

### 1.1 Issue Assignment & Claiming Policy

- **Claiming an Issue**: Contributor issue tracking is claim-based. Find any unassigned, open issue and post a comment containing exactly:
  ```text
  /claim
  ```
  The `@github-actions` bot will automatically verify your eligibility, assign the issue to you, and label it as `in-progress`.
- **Issue Assignment SLA**: Once assigned, you have exactly **6 days** to implement the changes and open a pull request. If the 6-day threshold is breached without a linked PR or a requested extension (noted via a progress comment on the issue), the bot will automatically unassign you to keep the project active.
- **Maximum Assigned Issue Cap**: To ensure fair work distribution across the community, contributors are restricted to a maximum of **10 active assigned issues** at any single time. The bot will reject claims if your active assigned count is 10 or more.

### 1.2 Pull Request Naming Conventions

All pull request titles must match the following structured, machine-parseable format:

```text
<type>: <short description> (closes #<issue_number>)
```

Use the table below to select the appropriate `<type>` prefix:

| PR Prefix Type | When to Use                                                        | Example                                             |
| :------------- | :----------------------------------------------------------------- | :-------------------------------------------------- |
| **`feat`**     | Adding a new capability or feature to the workspace                | `feat: integrate Pexels API cache lookup`           |
| **`fix`**      | Resolving a bug, runtime crash, or styling defect                  | `fix: prevent leaflet null coordinates map crash`   |
| **`docs`**     | Updating instructions, manuals, or API guides                      | `docs: add noise telemetry ingestion guide`         |
| **`style`**    | Code formatting changes (Prettier updates, spaces, semi-colons)    | `style: run Prettier formatting across components`  |
| **`refactor`** | Restructuring code without changing its functional behavior        | `refactor: modularize telemetry calculation checks` |
| **`perf`**     | Code changes targeting loading speed, latency, or memory usage     | `perf: compress spatial indices for faster maps`    |
| **`test`**     | Writing unit tests, RTL mocks, or Playwright E2E files             | `test: add unit coverage for favorites handler`     |
| **`build`**    | Changing build scripts, Next.js configurations, or webpack configs | `build: upgrade Next.js to version 15.5.x`          |
| **`ci`**       | Modifying GitHub Actions workflows or Vercel build configs         | `ci: adjust check runner permissions`               |
| **`chore`**    | Updating dependencies, post-installs, or workspace tasks           | `chore: clean up lockfiles and unused deps`         |
| **`revert`**   | Reverting a previous commit that caused regressions                | `revert: rollback rating distribution safari patch` |

_Note: The `(closes #<issue_number>)` suffix is mandatory and must match the issue being resolved. For example:_
`fix: handle geolocation access permission denied error gracefully (closes #100)`

### 1.3 Clean & Modular Commit Guidelines

- **Atomic Scope**: Commits must be atomic. Keep changes focused on a single file or a single structural component. Avoid mixing backend optimizations with unrelated styling patches.
- **Commit Naming conventions**: Follow standard Conventional Commits rules. Write messages in the imperative, present tense (e.g., `add map layers` rather than `added map layers` or `adds map layers`).
- **Continuous Build Integrity**: Do not push intermediate commits that fail compilation or break the development server. The repository requires a stable main branch at all times.

### 1.4 AI Coding Assistant & Subagent Guidelines

If you are developing using AI coding assistants (such as Cursor, Gemini, or custom terminal subagents):

1. **Pre-Flight Local Validations**: You must run type compilation and local tests _prior_ to committing code. Agent-generated code frequently contains bad TS imports, outdated package usage, or broken React Hooks bindings.
   ```bash
   npx tsc --noEmit
   npm test
   npm run build
   ```
2. **Design Fidelity**: Agents must not use placeholder files or basic UI layouts. Verify that all agent modifications comply with the colors, themes, spacing, and transition classes specified in the [Design System Guide](docs/DESIGN_SYSTEM_GUIDE.md).
3. **No Unrequested Refactoring**: Do not allow AI tools to refactor or rewrite files outside the target scope of the issue. This creates massive diffs and complicates PR reviews.
4. **JSDoc & Comments Retention**: Ensure the assistant does not clean up or delete existing codebase comments, JSDoc annotations, or architecture docs unless explicitly requested.

### 1.5 Local Development via Docker Compose

To lower contributor onboarding friction, WorkSphere provides a local development environment powered by Docker Compose. This packages PostgreSQL (with the `pgvector` extension) and Redis.

1. **Start Postgres and Redis Services**:
   ```bash
   docker compose up -d
   ```
2. **Configure your environment**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   The local database and Redis URLs are pre-configured to point to the Docker containers. Fill out any other required external API keys (e.g. Clerk, Groq).
3. **Push Prisma schema to the database**:
   ```bash
   npx prisma db push
   ```
4. **Run the app**:
   ```bash
   npm run dev
   ```

---

## 2. Code Style & Quality Checks

We use **ESLint** and **TypeScript** to enforce code quality and type safety:

- **Linting Rules**: Defined in `eslint.config.mjs`. We extend Next.js vitals and typescript configs.
- **Type Checking**: Strict type checking via TypeScript. Ensure all types are explicitly defined. Avoid using `any` unless absolutely necessary (e.g., in mocks or third-party wrappers where types are unavailable).

Run linting manually with:

```bash
npm run lint
```

Run TypeScript compiler type checks with:

```bash
npx tsc --noEmit
```

---

## 3. Testing Conventions (Jest & RTL)

All unit and integration tests for React components, hooks, utility functions, and API route handlers are located in the `src/__tests__/` directory.

### Directory Structure

```
src/__tests__/
├── api/             # API route handler tests
├── components/      # React UI component tests
└── lib/             # Utility and library helper tests
```

### File Naming Convention

Test files must reside inside `src/__tests__/` and be named matching their target component or utility, with the `.test.ts` or `.test.tsx` extension:

- Component: `src/__tests__/components/VenueCard.test.tsx`
- Utility: `src/__tests__/lib/utils.test.ts`

### Running Jest Tests

- **Run all unit/integration tests**:
    `bash
  npm test
  `
- **Run tests in watch mode** (useful during active development):
    `bash
  npm run test:watch
  `

### Mocking Dependencies & External APIs

When writing tests for pages or components that interact with external services (like Clerk authentication, Leaflet maps, Groq AI SDK, or databases), you must mock these dependencies to keep unit tests isolated and fast.

#### 1. Mocking Clerk Authentication (`@clerk/nextjs`)

For components or pages requiring user auth or sessions, mock the `useUser` hook at the top of your test file:

```typescript
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: "test-user-id",
      fullName: "John Doe",
      primaryEmailAddress: { emailAddress: "john.doe@example.com" },
      imageUrl: "https://example.com/avatar.jpg",
    },
  }),
}));
```

#### 2. Mocking Leaflet & React-Leaflet Maps

Leaflet relies heavily on browser DOM APIs and window objects that are not present in Jest's JSDOM environment. Mock `leaflet` and `react-leaflet` to avoid crashes:

```typescript
// Mock react-leaflet components and hooks
const mockSetView = jest.fn();
const mockFlyTo = jest.fn();

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, style }: any) => (
    <div data-testid="map-container" data-center={JSON.stringify(center)} data-zoom={zoom} style={style}>
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }: any) => (
    <div data-testid="tile-layer" data-url={url} data-attribution={attribution} />
  ),
  Marker: ({ children, position, icon }: any) => (
    <div data-testid="marker" data-position={JSON.stringify(position)} data-icon={icon?.options?.className}>
      {children}
    </div>
  ),
  Popup: ({ children }: any) => <div data-testid="popup">{children}</div>,
  Polyline: ({ children, positions, pathOptions }: any) => (
    <div data-testid="polyline" data-positions={JSON.stringify(positions)} data-color={pathOptions?.color}>
      {children}
    </div>
  ),
  useMap: () => ({
    setView: mockSetView,
    flyTo: mockFlyTo,
  }),
}));

// Mock the underlying leaflet library
jest.mock('leaflet', () => ({
  icon: jest.fn(() => ({ options: { className: 'default-icon' } })),
  divIcon: jest.fn((options) => ({ options })),
  latLngBounds: jest.fn(() => ({
    extend: jest.fn(),
  })),
  Icon: {
    Default: {
      prototype: {},
      mergeOptions: jest.fn(),
    },
  },
}));
```

#### 3. Mocking Database or Serverless Clients (Prisma / Upstash)

Avoid connecting to actual databases or Redis caches in unit tests. Mock the client modules using `jest.mock`.

#### 4. ZKP (Zero-Knowledge Proof) Module Configuration

WorkSphere includes a student discount verification feature that uses `snarkjs` and `ffjavascript` for zero-knowledge proof generation. These packages ship as ES modules (ESM) but Jest runs in CommonJS (CJS) mode by default.

`jest.config.js` maps both packages to their CJS builds to prevent `SyntaxError: Cannot use import statement` at test time:

```js
moduleNameMapper: {
  '^snarkjs$': '<rootDir>/node_modules/snarkjs/build/main.cjs',
  '^ffjavascript$': '<rootDir>/node_modules/ffjavascript/build/main.cjs',
  '^uncrypto$': '<rootDir>/node_modules/uncrypto/dist/crypto.node.cjs',
},
```

**What contributors should know:**
- Tests that import ZKP-related modules work automatically — no manual mocking needed
- If you add a new package that ships ESM-only and fails with `SyntaxError: Cannot use import statement`, add a similar entry to `moduleNameMapper` in `jest.config.js`
- ZKP proof generation is CPU and memory intensive; the config sets `workerIdleMemoryLimit: '256MB'` and `maxWorkers: '50%'` to prevent heap exhaustion during the full test suite

---

#### 5. ZKP Circuit Compilation (`npm run zkp:compile`)

The `zkp:compile` script compiles the [Circom](https://docs.circom.io/) circuit used for student discount verification and generates the Groth16 proving/verification keys.

**When to run it:** Only when you modify `circuits/premium_membership.circom`. You do **not** need to run it for most features — the compiled outputs (`public/zkp/`) are committed and kept up to date.

**Dependencies (install once):**

```bash
# Circom compiler
npm install -g @iden3/circom

# snarkjs and openssl must be available in PATH
npm install                       # snarkjs is already in package.json
openssl version                   # confirm openssl is installed
```

**Run the compile script:**

```bash
npm run zkp:compile
```

This will:
1. Compile `circuits/premium_membership.circom` → R1CS, WASM, SYM files in `circuits/build/`
2. Generate a small Powers-of-Tau ceremony (`pot12_final.ptau`) if one doesn't already exist
3. Run the Groth16 trusted-setup → outputs `premium_membership_final.zkey`
4. Export the verification key to `public/zkp/verification_key.json`
5. Copy the WASM prover to `public/zkp/`

**Notes:**
- The build step can take 30–90 seconds on a typical laptop
- The generated `.ptau` and `.zkey` files are large; they are committed to the repo so other contributors don't need to regenerate them
- If `npm run zkp:compile` fails with "circom not found", ensure `@iden3/circom` is on your PATH

---

## 4. E2E Testing (Playwright)

End-to-end tests simulate actual user interactions inside the browser. These tests are configured in `playwright.config.ts` and reside in the `e2e/` folder.

### Running Playwright Tests

- **Run all E2E tests in headless mode** (runs behind the scenes):
    `bash
  npm run test:e2e
  `
- **Run E2E tests with Playwright UI** (highly recommended for debugging):
    `bash
  npm run test:e2e:ui
  `

### Dev Server Integration

Our E2E suite is configured to automatically launch the Next.js dev server (`npm run dev`) on `http://localhost:3000` before running tests. It handles server cleanup once tests complete.

### Configuring Headless/Headed Modes manually

By default, Playwright runs tests in headless mode (no browser window opens).

- To run tests in **headed mode** via command line, pass the `--headed` flag:
    `bash
  npx playwright test --headed
  `
- To customize browser options or add multiple browsers (e.g., Firefox, WebKit), edit the `projects` section inside [playwright.config.ts](file:///C:/Users/Rajasekar/.gemini/antigravity/scratch/WorkSphere/playwright.config.ts).

---

## 5. Pre-Commit Quality Verification Checklist

Before pushing changes to GitHub, you **MUST** verify that all the checks below pass locally. This guarantees that your branch is stable and will build correctly on Vercel:

### 1. Verification Checklist

| Command            | Purpose                                                             | Action on Error                                              |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `npm run lint`     | Ensures code complies with ESLint styles and rules.                 | Fix all linting issues. Do not disable rules without review. |
| `npx tsc --noEmit` | Compiles code dry-run to verify complete TypeScript type safety.    | Address any syntax, type matching, or missing import issues. |
| `npm test`         | Runs the full Jest test suite to check unit and component logic.    | Fix regressions; do not skip failing tests.                  |
| `npm run build`    | Simulates a production build (Prisma generation + Next.js compile). | Critical check. Fix any build-blocking errors.               |

### 2. Vercel Build Verification

Vercel builds use `npm run build` which runs `prisma generate && next build`. If this step fails locally, it **will** fail on Vercel deployment. Make sure you run `npm run build` successfully before submitting your PR!

> **Note:** The current production build does **not** invoke `tsc` as a separate build step. For complete TypeScript type checking, run `npx tsc --noEmit` in addition to `npm run build` before opening a pull request.

---

## 6. PR Pre-flight Checklist

Before opening a pull request, work through this checklist top-to-bottom. Each step is a gate — don't move to the next until the current one is green.

```bash
# 1. Sync your fork with upstream to avoid merge conflicts
git fetch upstream
git rebase upstream/main

# 2. Install any new dependencies added since your last sync
npm install

# 3. Apply any pending Prisma schema migrations
npx prisma generate
npx prisma migrate dev   # only if schema.prisma changed

# 4. Run the app locally and verify your change works end-to-end
npm run dev

# 5. Lint — fix all errors before continuing
npm run lint

# 6. Type-check — fix any TypeScript errors
npx tsc --noEmit

# 7. Unit tests — make sure nothing is broken
npm test

# 8. Production build — the definitive gate before pushing
npm run build
```

Once all eight steps pass:

- [ ] Branch is up-to-date with `upstream/main`
- [ ] Feature/fix works as expected in `npm run dev`
- [ ] `npm run lint` returns zero errors
- [ ] `npx tsc --noEmit` returns zero errors
- [ ] `npm test` passes with no regressions
- [ ] `npm run build` completes successfully
- [ ] PR title follows the Conventional Commits format (`feat:`, `fix:`, `docs:`, etc.)
- [ ] PR description explains **what** changed and **why**, and references the issue (`Closes #N`)
