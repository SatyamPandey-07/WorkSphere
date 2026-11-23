# Contributing to WorkSphere

Welcome to **WorkSphere**! Thank you for contributing to the project as part of Winter of Code Social (WOCS). This guide explains how to prepare your development environment, follow project standards, run tests, and submit pull requests.
For the release workflow and draft publication procedure, see the [WorkSphere Release Process Guide](docs/contributing/RELEASE_PROCESS.md).
For workflow triggers, blocking and advisory checks, and pull request validation behavior, see the [GitHub Actions CI Workflow Guide](docs/contributing/CI_WORKFLOW.md).

## 1. Prerequisites

Before getting started, ensure you have the following:

- **Node.js v20 or higher** — the required version is specified in the repository's `.nvmrc` file.
- **npm v10 or higher** — recommended package manager for this project.
- **Git** — installed and configured with your GitHub account.
- **GitHub account** — required to fork the repository and submit pull requests.
- **Docker with Docker Compose** — needed only when running the full local PostgreSQL and Redis development stack.

## 2. Local Environment Setup

Follow the [5-Minute Quickstart for WOCS 2026 Contributors](#5-minute-quickstart-for-wocs-2026-contributors) for the complete setup procedure, including:

- Forking and cloning the repository.
- Configuring your `origin` and `upstream` Git remotes.
- Installing project dependencies.
- Configuring environment variables.
- Starting the development server.
- Running tests and quality checks.

For full local PostgreSQL (pgvector) and Redis setup using Docker Compose, Prisma migrations, and port troubleshooting, refer to the [Local Development Setup Guide](docs/guides/LOCAL_DEVELOPMENT_SETUP.md).

## Community Standards

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing to help maintain a welcoming and respectful community.

---

## Testing Guidelines

For standard mocking patterns (Clerk auth, Leaflet maps, Web Workers, IndexedDB, Next.js router) and instructions on avoiding memory leaks in Jest, refer to the [WorkSphere Testing Playbook](docs/TESTING_PLAYBOOK.md).

## Testing Guidelines

For standard mocking patterns (Clerk auth, Leaflet maps, Web Workers, IndexedDB, Next.js router) and instructions on avoiding memory leaks in Jest, refer to the [WorkSphere Testing Playbook](docs/TESTING_PLAYBOOK.md).

## 📋 Table of Contents

- [5-Minute Quickstart for WOCS 2026 Contributors](#5-minute-quickstart-for-wocs-2026-contributors)
  - [Common Setup FAQs](#common-setup-faqs)

1. [Git Workflow & PRs](#1-git-workflow--prs)
   - [Advanced Git Workflow (Git Worktree)](#17-advanced-git-workflow-git-worktree--branch-isolation)
2. [Code Style & Quality Checks](#2-code-style--quality-checks)
3. [Testing Conventions (Jest & RTL)](#3-testing-conventions-jest--rtl)
4. [E2E Testing (Playwright)](#4-e2e-testing-playwright)
5. [Pre-Commit Quality Verification Checklist](#5-pre-commit-quality-verification-checklist)
6. [Windows Husky & Git Hooks Troubleshooting](#6-windows-husky--git-hooks-troubleshooting)
7. [PR Pre-flight Checklist](#7-pr-pre-flight-checklist)

---

## 5-Minute Quickstart for WOCS 2026 Contributors

Welcome to **Winter of Code Social (WOCS 2026)**! This checklist gets your local development environment up and running in 5 minutes so you can start contributing right away. For competition details and points scoring, refer to the [WOCS Level Evaluation Guide](docs/WOCS_LEVEL_GUIDE.md).

### 1. Fork and Clone

1. **Fork the repository**: Visit [SatyamPandey-07/WorkSphere](https://github.com/SatyamPandey-07/WorkSphere) and click the **Fork** button.
2. **Clone your fork locally**:
   ```bash
   git clone https://github.com/<your-username>/WorkSphere.git
   cd WorkSphere
   ```
3. **Configure the upstream remote**:
   ```bash
   git remote add upstream https://github.com/SatyamPandey-07/WorkSphere.git
   git remote -v
   ```
   Confirm that `origin` points to your personal fork and `upstream` points to `SatyamPandey-07/WorkSphere`.

### 2. Node.js Requirements

WorkSphere requires **Node.js v20+** (LTS recommended, configured in `.nvmrc`).

Verify your installed versions:

```bash
node -v   # Recommended: v20.x.x or higher
npm -v    # Recommended: v10.x.x or higher
```

> **Tip:** If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm use` in the repository root to automatically use the Node version defined in `.nvmrc`.

### 3. Install Dependencies and Environment Setup

1. **Install dependencies**:

   ```bash
   npm install
   ```

   _(If you encounter peer dependency conflicts, run `npm install --legacy-peer-deps`)._ Note that `prisma generate` runs automatically via the `postinstall` hook.

2. **Configure environment variables**:
   WorkSphere provides a template `.env.example` file. Copy it to create your local `.env.local`:

   ```bash
   # On macOS / Linux / Git Bash:
   cp .env.example .env.local

   # On Windows PowerShell:
   Copy-Item .env.example .env.local
   ```

3. **Environment safety**:
   - The default placeholder values in `.env.example` (such as `DATABASE_URL` and `UPSTASH_REDIS_REST_URL`) are pre-configured for local Docker development.
   - For basic UI, styling, documentation, or unit test contributions, placeholder values work because test suites mock external APIs.
   - **Never expose real secrets** or API keys in pull requests.
   - Do not invent environment variables; use only those defined in `.env.example`.

> **Local Database & Cache Setup:**
> For full local PostgreSQL (pgvector) and Redis orchestration with Docker Compose, Prisma migrations, and port troubleshooting, refer to the [Local Development Setup Guide](docs/guides/LOCAL_DEVELOPMENT_SETUP.md).

### 4. Run the Development Server

Start the local Next.js development server:

```bash
npm run dev
```

Once compiled, access the application at:

👉 **[http://localhost:3000](http://localhost:3000)**

### 5. Run Tests

Verify that your changes pass existing tests before submitting a PR:

```bash
# Run unit and integration tests (Jest)
npm test

# Run tests in watch mode during development
npm run test:watch
```

Ensure all pre-commit quality checks pass:

- **Type safety**: `npx tsc --noEmit`
- **Linting**: `npm run lint`
- **Production build**: `npm run build`

### 6. Claim Issues and Submit PRs

1. **Claim an issue**: Find an open, unassigned issue and comment exactly:
   ```text
   /claim
   ```
   The GitHub Actions workflow checks that the issue is unassigned and that you have fewer than 10 active assigned issues. After assignment, it recommends opening a PR within six days. This is not an automatic expiration timer. See the [Issue Claiming & Automation Guide](docs/contributing/claiming-issues.md) for details.
2. **Create a feature branch**:
   Always branch from the latest `upstream/main`:
   ```bash
   git fetch upstream
   git switch -c feat/your-feature-name upstream/main
   ```
3. **Submit your Pull Request**:
   - Push your branch to your fork: `git push -u origin feat/your-feature-name`
   - Open a PR against `main` on the official repository.
   - **PR Title Format**: Must strictly follow `<type>: <short description> (closes #<issue_number>)`.
     Example: `fix: prevent duplicate seat check-ins (closes #100)`
   - **PR Description**: Include `Closes #<number>` (e.g. `Closes #100`) so GitHub automatically links and closes the issue upon merge.
   - **WOCS Points**: Issues and PRs are scored based on difficulty levels (`level 1` = 2 pts, `level 2` = 5 pts, `level 3` = 11 pts). See the [WOCS Level Evaluation Guide](docs/WOCS_LEVEL_GUIDE.md) for details.

---

### Common Setup FAQs

#### What if Node.js is outdated?

WorkSphere requires Node.js v20+ (see `.nvmrc`). If your Node version is older (e.g., v16 or v18), install and switch to Node 20 using [nvm](https://github.com/nvm-sh/nvm) (Linux/macOS) or [nvm-windows](https://github.com/coreybutler/nvm-windows):

```bash
nvm install 20
nvm use 20
```

Verify with `node -v`.

#### What if npm install fails?

- **Peer dependency conflicts**: Run `npm install --legacy-peer-deps`.
- **Prisma generation error**: If the `postinstall` hook fails, run `npx prisma generate` directly.
- **Git hooks on Windows**: If Husky fails during install on Windows, see the [Windows Husky & Git Hooks Troubleshooting Guide](docs/contributing/WINDOWS_HOOKS_TROUBLESHOOTING.md).
- **Corrupt npm cache**: Clear cache with `npm cache clean --force` and retry.

#### What if `.env` is missing?

Next.js loads variables from `.env.local` during local development. Copy the template:

```bash
cp .env.example .env.local
```

For basic UI development and unit testing, you do not need live third-party keys; default placeholder values are sufficient because tests use Jest mocks. Never commit `.env.local` to git.

#### How do I run the application locally?

1. Ensure dependencies are installed (`npm install`).
2. Run `npm run dev`.
3. Open your browser to [http://localhost:3000](http://localhost:3000).
4. _(Optional)_ If working on database-backed features, start PostgreSQL and Redis via Docker with `docker compose up -d` (see [Local Development via Docker Compose](#16-local-development-via-docker-compose)).

#### How do I run tests?

- **Unit & component tests**: Run `npm test`.
- **Watch mode**: Run `npm run test:watch`.
- **Specific test file**: Run `npx jest src/__tests__/lib/utils.test.ts`.
- **E2E tests**: Run `npm run test:e2e` (requires `npx playwright install` first).
- **Type checks**: Run `npx tsc --noEmit`.

#### How do I claim an issue?

Browse open issues on GitHub. On any unassigned issue, comment:

```text
/claim
```

The automated workflow verifies that the issue is unassigned and that you have fewer than 10 active assigned issues. It then assigns the issue and recommends opening a PR within six days. The six-day period is a recommendation, not automatic expiration.

#### How do I link a PR to an issue?

Link your pull request in both the title and description:

- **In the PR title**: Append `(closes #<issue_number>)`, e.g. `feat: add export to csv button (closes #450)`.
- **In the PR description**: Include the keyword `Closes #<issue_number>` (e.g., `Closes #450`).
  This ensures GitHub automatically links the PR to the issue and closes it once merged.

---

## 1. Git Workflow & PRs

To keep the repository clean and manageable, please follow this flow:

1. **Fork** the repository and clone it locally.
2. **Create a branch** using a descriptive naming convention:
   - `feat/your-feature-name` for new features.
   - `fix/issue-description` for bug fixes.
   - `docs/topic-name` for documentation updates.
   - `refactor/topic-name` for code restructuring without behavior changes.
   - `test/topic-name` for test-related changes.

   Use lowercase words separated by hyphens, and keep the branch name short and descriptive.

3. **Write code** and ensure all [testing](#3-testing-conventions-jest--rtl) and [pre-commit checks](#5-pre-commit-quality-verification-checklist) pass.
4. **Commit** your changes with clear, structured commit messages (e.g., `feat: add map route coordinates validation`). See below for detailed commit formatting rules.
5. **Push** to your fork and open a **Pull Request (PR)** against the `main` branch. Ensure the PR title adheres to the strict formatting rules outlined in [Section 1.3](#13-pull-request-title-conventions--format).

### Recommended Terminal Workflow

Use the following commands as a guide. Replace the example branch name with the branch for your task.

```bash
# 1. Get the latest repository changes
git fetch upstream
git switch main
git rebase upstream/main

# 2. Create a branch for your issue
git switch -c docs/contributing-guide

# 3. Review your changes
git status
git diff
git diff --check

# 4. Stage and commit your documentation changes
git add CONTRIBUTING.md
git commit -m "docs: improve contributing guide (closes #<issue_number>)"

# 5. Push your branch to your fork
git push -u origin docs/contributing-guide
```

Before starting work, claim an available issue by commenting `/claim` on GitHub and wait for the assignment confirmation. If the `upstream` remote is not configured, add it with:

```bash
git remote add upstream https://github.com/SatyamPandey-07/WorkSphere.git
```

- **Claiming an Issue**: Comment `/claim` on an open, unassigned issue. The workflow checks that the issue has no assignees and that the contributor has fewer than 10 active assigned issues before assigning it.
- **Unclaiming an Issue**: Comment `/unclaim` to release your own assignment. Maintainers can also unassign other contributors using `/unclaim @username`.
- **Six-Day Recommendation**: The assignment confirmation recommends opening a PR within six days. If additional time is required, post a progress update on the issue. The current claim workflow does not automatically expire assignments after six days.
- **Maximum Assigned Issue Limit**: Contributors may have at most 10 active assigned issues. Pull requests are excluded from this count.

### 1.2 Winter of Code Social (WOCS 2026) Guidelines & Points System

WorkSphere is officially participating in [Winter of Code Social 2026](https://woc.codesocial.tech), hosted by **Code Social**!

- **Registration**: All contributors must register on the [WOCS Portal](https://woc.codesocial.tech).
- **Leaderboard**: Track your live standings on the [WOCS Leaderboard](https://woc.codesocial.tech/leaderboard).
- **Discord Community**: Join the official [Code Social Discord Server](https://discord.gg/MSTNyRSPYW) and communicate in the WorkSphere project forum in `#find-a-project`.
- **Labeling Requirements**: Every eligible PR must have the `wocs` label and exactly one difficulty level label applied prior to merge:
  - `level 1` — **2 points** (Beginner-friendly fixes, documentation updates, minor UI tweaks)
  - `level 2` — **5 points** (Feature enhancements, component implementations, test coverage)
  - `level 3` — **11 points** (Complex architecture, agent workflows, backend endpoints)
  - See the comprehensive [WOCS Level Evaluation Guide](docs/WOCS_LEVEL_GUIDE.md) for full breakdown by directory and complexity.
- **Automatic Tracking**: Merged pull requests with the proper labels trigger the WOCS real-time webhook and automatically credit points to your account.
- **AI Policy**: AI-assisted tooling is permitted provided that the contributor thoroughly understands and verifies the code, writes authentic tests, and adheres to our quality standards. Hallucinated or non-functional submissions will be rejected.

### 1.3 Pull Request Title Conventions & Format

All Pull Request titles must follow the strict machine-parseable convention:

```text
<type>: <short description> (closes #<issue_number>)
```

For example:

```text
fix: handle geolocation access permission denied error gracefully (closes #100)
feat: add ambient noise decibel trend graph (closes #3955)
docs: document NIOSH daily sound exposure calculation and formula reference (closes #3946)
```

> **Mandatory Rule**: The `(closes #<issue_number>)` suffix is strictly required. It enables automated GitHub issue linking and closes the associated issue upon merge. Never invent dummy issue numbers or reference unrelated issues.

### 1.4 Commit Message Conventions

WorkSphere follows the [Conventional Commits](https://www.conventionalcommits.org/) specification.

Use this format:

`<type>(<scope>): <short description> (closes #<issue_number>)`

The issue-closing suffix is mandatory. Replace the placeholder with the actual related issue number.

#### Supported Commit Types

| Type       | Purpose                                                       |
| ---------- | ------------------------------------------------------------- |
| `feat`     | Introduces a new feature.                                     |
| `fix`      | Fixes a bug or incorrect behavior.                            |
| `docs`     | Adds or updates documentation.                                |
| `style`    | Makes formatting changes without changing functionality.      |
| `refactor` | Restructures code without changing behavior.                  |
| `test`     | Adds or updates tests.                                        |
| `chore`    | Handles maintenance, scripts, dependencies, or configuration. |
| `perf`     | Improves performance.                                         |
| `build`    | Changes build tools or configuration.                         |
| `ci`       | Changes CI workflows or automation.                           |
| `revert`   | Reverts a previous commit.                                    |

The first seven types are the standard types highlighted by this guide. The additional types are also accepted.

#### Supported Scopes

Use the scope that best identifies the affected project area.

| Scope    | When to use it                                           |
| -------- | -------------------------------------------------------- |
| `venues` | Venue features, listings, and availability.              |
| `crdt`   | Conflict-free replicated data types and synchronization. |
| `zkp`    | Zero-knowledge proofs and circuits.                      |
| `audio`  | Audio processing and sound-related features.             |
| `web3`   | Blockchain and Web3 integrations.                        |
| `ui`     | Shared UI components and visual behavior.                |
| `a11y`   | Accessibility improvements.                              |

Use a listed scope when it applies. If none accurately describes the change, an unscoped commit is acceptable.

#### Valid Commit Message Templates

```text
feat(venues): add venue availability filters (closes #<issue_number>)
fix(crdt): resolve synchronization conflict (closes #<issue_number>)
docs(ui): document component guidelines (closes #<issue_number>)
style(ui): align modal formatting (closes #<issue_number>)
refactor(zkp): simplify proof verification (closes #<issue_number>)
test(audio): add sound classifier coverage (closes #<issue_number>)
chore(web3): update integration configuration (closes #<issue_number>)
```

Replace `<issue_number>` with a real issue number before committing.

#### Invalid Commit Message Examples

| Invalid message              | Why it is invalid                                     |
| ---------------------------- | ----------------------------------------------------- |
| `Added venue filters`        | Missing the commit type and separator.                |
| `FEAT(venues): add filters`  | Commit type must be lowercase.                        |
| `feat venues: add filters`   | Missing parentheses around the scope.                 |
| `feat(unknown): add filters` | Uses an unsupported scope.                            |
| `feat(venues) add filters`   | Missing the colon.                                    |
| `fix(ui): fixed modal`       | Uses past tense and omits the mandatory issue suffix. |
| `feat(venues): add filters`  | Missing the mandatory issue suffix.                   |

#### Commit Best Practices

- Use imperative descriptions, such as `fix(venues): clamp invalid coordinates (closes #<issue_number>)`.
- Keep commits focused on one logical change.
- Select the most relevant scope.
- Include the correct mandatory issue-closing suffix.
- Avoid unrelated formatting changes and dependency updates.

#### Running Lint and Formatting Checks

Run these commands from the repository root before committing:

```bash
npm run lint
npm run format
```

- `npm run lint` runs ESLint.
- Stage the files you want to check before running `npm run format`.
- `npm run format` runs `lint-staged` on staged files, applying the configured ESLint and Prettier tasks.
- Fix reported issues and review your changes before committing.

#### Pre-Commit Hook Troubleshooting

WorkSphere uses Husky and lint-staged to run checks on staged files.

**Husky or lint-staged fails**

- Install dependencies using `npm install`.
- Initialize hooks using `npm run prepare`.
- Stage the intended files again using `git add`.
- Read and fix the error reported by the hook.

**Prettier reports formatting errors**

- Stage the intended files, then run `npm run format`.
- For a specific file, run `npx prettier --write <file>`.
- Review the resulting changes.

**ESLint reports errors**

- Run `npm run lint`.
- Fix the reported errors.
- For a specific JavaScript or TypeScript file, run `npx eslint <file>`.

**Windows hook problems**

See the [Windows Husky & Git Hooks Troubleshooting Guide](docs/contributing/WINDOWS_HOOKS_TROUBLESHOOTING.md) for PowerShell execution-policy, line-ending, and Git hook issues.

#### Pre-Commit Hook Bypass Rules

Avoid bypassing Git hooks. They help identify formatting and lint problems before committing.

The `--no-verify` option skips applicable Git hooks:

```bash
git commit --no-verify -m "..."
```

Use a bypass only when a hook is genuinely unavailable or broken and the reason is understood. Before bypassing:

1. Run the relevant lint and formatting checks manually.
2. Review staged changes using `git diff --cached`.
3. Explain the reason in contribution or review notes.
4. Resolve the underlying hook problem as soon as possible.

Do not assume CI blocks every lint or formatting issue. Run the required checks locally and address their results before submitting a pull request.

### 1.5 AI Coding Assistant & Subagent Guidelines

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

### 1.6 Local Development via Docker Compose

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
   > **Note:** `db push` syncs the schema directly to your local database without creating a migration file, which makes it suitable for first-time setup and quick experiments. If your change modifies `prisma/schema.prisma` and will be committed, use `npx prisma migrate dev` instead (see [Section 7](#7-pr-pre-flight-checklist)).
4. **Run the app**:
   ```bash
   npm run dev
   ```

### 1.7 Advanced Git Workflow: Git Worktree & Branch Isolation

For active contributors working across multiple simultaneous feature implementations, bug triage, or code reviews, WorkSphere supports the **Git Worktree** workflow.

Using `git worktree` allows you to check out multiple branches simultaneously into independent sibling directories without stashing incomplete changes or paying the overhead of Next.js/Turbopack rebuilds and cache invalidations.

- **Guide**: Read the complete [Git Worktree & Branch Isolation Guide](docs/contributing/WORKTREE_GUIDE.md).
- **Key benefits**:
  - Zero branch-switching thrash (no `git stash` or lost working trees).
  - Isolated working directories for concurrent development (`../WorkSphere-features/`, `../WorkSphere-fixes/`).
  - Shared `.git` repository database saving disk space and fetch bandwidth compared to multiple clones.

#### Quick Example:

**Bash:**

```bash
# Add a new worktree for an urgent fix off upstream/main
git fetch upstream
git worktree add ../WorkSphere-fixes/fix-modal-contrast -b fix/modal-contrast upstream/main
```

**PowerShell:**

```powershell
# Add a new worktree for an urgent fix off upstream/main
git fetch upstream
git worktree add ..\WorkSphere-fixes\fix-modal-contrast -b fix/modal-contrast upstream/main
```

For comprehensive step-by-step commands, lifecycle walkthroughs, and solutions to common pitfalls (e.g., `node_modules` dependency isolation, environment files, and dev server port conflicts), see the [Git Worktree & Branch Isolation Guide](docs/contributing/WORKTREE_GUIDE.md).

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
  ```bash
  npm test
  ```
- **Run tests in watch mode** (useful during active development):
  ```bash
  npm run test:watch
  ```

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

### Installing Playwright Browsers

Before running E2E tests for the first time, install the required browser binaries (Chromium, Firefox, WebKit):

```bash
npx playwright install
```

To install browser system dependencies on Linux/CI environments:

```bash
npx playwright install-deps
```

### Running Playwright Tests

- **Run all E2E tests in headless mode** (runs behind the scenes):
  ```bash
  npm run test:e2e
  ```
- **Run E2E tests with Playwright Interactive UI Mode** (recommended for debugging and stepping through tests):
  ```bash
  npm run test:e2e:ui
  ```
- **Run E2E tests in Debug Mode** (launches Playwright Inspector step-by-step):
  ```bash
  npx playwright test --debug
  ```

### Playwright Command Cheat Sheet

| Command                                         | Description                                                     |
| :---------------------------------------------- | :-------------------------------------------------------------- |
| `npx playwright install`                        | Download required browser binaries (Chromium, Firefox, WebKit)  |
| `npm run test:e2e`                              | Run all E2E test suites in headless mode                        |
| `npm run test:e2e:ui`                           | Open interactive Playwright UI mode with time-travel inspection |
| `npx playwright test e2e/search.spec.ts`        | Run a specific E2E test file                                    |
| `npx playwright test -g "filter query"`         | Run tests matching a specific title or pattern                  |
| `npx playwright test --project=chromium`        | Run E2E tests using only the Chromium browser                   |
| `npx playwright test --headed`                  | Run tests in visible browser window mode                        |
| `npx playwright test --debug`                   | Step through test execution using Playwright Inspector          |
| `npx playwright show-trace <path-to-trace.zip>` | Open Playwright Trace Viewer for failed test runs               |

### Viewing Failure Traces with Playwright Trace Viewer

Playwright automatically records execution traces, DOM snapshots, network logs, and screenshots when a test fails.

1. **Locate the trace archive**: Failed test artifacts are saved in the `test-results/` directory (e.g., `test-results/e2e-search-chromium/trace.zip`).
2. **Open the Trace Viewer**:
   ```bash
   npx playwright show-trace test-results/e2e-search-chromium/trace.zip
   ```
3. **Inspect Execution**: The Trace Viewer interface displays:
   - **Actions Timeline**: Hover over each user action (click, fill, navigate) to view DOM state before and after.
   - **Console & Network**: Inspect browser console logs and HTTP request/response payloads.
   - **Source Code**: Step directly into the line of code that triggered the failure.

### Dev Server Integration

Our E2E suite is configured to automatically launch the Next.js dev server (`npm run dev`) on `http://localhost:3000` before running tests. It handles server cleanup once tests complete.

### Configuring Headless/Headed Modes manually

By default, Playwright runs tests in headless mode (no browser window opens).

- To run tests in **headed mode** via command line, pass the `--headed` flag:
  ```bash
  npx playwright test --headed
  ```
- To customize browser options or add multiple browsers (e.g., Firefox, WebKit), edit the `projects` section inside `playwright.config.ts`.

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

> **Note on TypeScript during `npm run build`:** TypeScript strict checking is enforced — `typescript.ignoreBuildErrors` is not set in `next.config.ts` (and must not be added), so type errors in the build graph will cause the build to fail. Run `npx tsc --noEmit` separately for faster, standalone type feedback during development without waiting for Prisma generation and full asset compilation.

### 2. Vercel Build Verification & TypeScript Behavior

Vercel builds use `npm run build` which runs `prisma generate && next build`. If this step fails locally, it **will** fail on Vercel deployment. Make sure you run `npm run build` successfully before submitting your PR!

#### TypeScript Build Behavior & Validation

- **What `npm run build` Validates**: `npm run build` runs `prisma generate` to build Prisma client type definitions, followed by `next build --webpack` to compile production application pages and components.
- **TypeScript Errors Inclusion**: TypeScript errors are **included and enforced** during `npm run build` because Next.js has type checking enabled by default (`ignoreBuildErrors` is not set in `next.config.ts`). Any TypeScript compilation errors in the application build graph will fail the build.
- **Separate Type-Checking Command**: Because `npm run build` does not run `tsc` as an independent script and involves Prisma code generation plus production asset compilation, contributors should run `npx tsc --noEmit` separately for fast, standalone TypeScript type checking during development.

### 3. Recommended PR Validation Workflow

Before submitting a pull request, run the following validation steps in order:

1. `npm run lint` — Validates code style and ESLint rules.
2. `npx tsc --noEmit` — Runs standalone TypeScript type-checking across the workspace.
3. `npm test` — Executes the Jest unit and component test suites.
4. `npm run build` — Verifies Prisma client generation and Next.js production build compilation.

---

## 6. Windows Husky & Git Hooks Troubleshooting

Contributors developing on Windows environments may encounter execution policy restrictions (`PSSecurityException`) or line-ending mismatches (`CRLF` vs `LF`) when running Husky pre-commit hooks (`lint-staged`).

For complete configuration commands (`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` and `git config --global core.autocrlf true`) and step-by-step FAQ solutions for `.husky/pre-commit: command not found`, refer to our dedicated guide:

👉 **[Windows Husky & Git Hooks Troubleshooting Guide](docs/contributing/WINDOWS_HOOKS_TROUBLESHOOTING.md)**

---

## 7. PR Pre-flight Checklist

Before opening a pull request, work through this checklist top-to-bottom. Each step is a gate — don't move to the next until the current one is green.

```bash
# 1. Sync your fork with upstream to avoid merge conflicts
git fetch upstream
git rebase upstream/main

# 2. Install any new dependencies added since your last sync
npm install

# 3. Apply any pending Prisma schema migrations
npx prisma generate
npx prisma migrate dev   # only if schema.prisma changed; creates a migration file to commit
                         # (use `npx prisma db push` only for throwaway local experiments)

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

## Architecture Documentation
 feature/nomad-break-buffers
 feature/nomad-break-buffers

 feature/booking-concurrency-lock

 feature/logarithmic-volume-curve

 docs/git-worktree-guide
main
main
 main
 main

For details on multi-agent scoring and consensus workflows, see [docs/architecture/multi-agent-consensus.md](docs/architecture/multi-agent-consensus.md).

## Concurrent Development & Worktrees

 feature/nomad-break-buffers
For guidelines on working on multiple issues concurrently using Git worktrees, see [docs/WORKTREE_GUIDE.md](docs/WORKTREE_GUIDE.md).
 feature/nomad-break-buffers

 feature/booking-concurrency-lock

feature/logarithmic-volume-curve


For details on multi-agent scoring and consensus workflows, see [docs/architecture/multi-agent-consensus.md](docs/architecture/multi-agent-consensus.md).

For guidelines on working on multiple issues concurrently using Git worktrees, see [docs/contributing/WORKTREE_GUIDE.md](docs/contributing/WORKTREE_GUIDE.md).
main
main
main
main
 main
main
main
 main
