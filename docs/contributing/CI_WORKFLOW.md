# GitHub Actions CI Workflow Guide

## Overview

WorkSphere uses GitHub Actions to automate build verification, code quality checks, database integration testing, and browser-based end-to-end testing.

The repository has two separate workflows relevant to pull request validation:

| Workflow               | File                             | Purpose                                                                                 |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------- |
| Continuous Integration | `.github/workflows/ci.yml`       | Build, lint, type-check, unit tests, PostgreSQL integration, and Playwright E2E checks. |
| PR Quality Check       | `.github/workflows/pr-check.yml` | Validate pull request issue references and apply additional PR checks.                  |

These workflows have different triggers and failure-handling rules. In particular, some CI checks are advisory and do not block the overall workflow when they fail.

## 1. Continuous Integration Workflow

The main CI workflow is defined in `.github/workflows/ci.yml`.

### 1.1 Workflow Triggers

The workflow runs on the following events:

| Event        | Target branches                        | Event types                         |
| ------------ | -------------------------------------- | ----------------------------------- |
| Pull request | `main`, `master`, `dev`, `development` | `opened`, `synchronize`, `reopened` |
| Push         | `main`, `master`                       | Push events                         |

The workflow does not configure a push trigger for `dev` or `development`.

### 1.2 Path Exclusions

Both pull request and push triggers define these exclusions:

```yaml
paths-ignore:
  - "docs/**"
  - "**.md"
```

This means changes limited to documentation paths or Markdown files do not trigger the main CI workflow.

Important behavior:

- Documentation-only changes under `docs/**` are excluded.
- Markdown-only changes matching `**.md` are excluded.
- A pull request containing both documentation changes and application code changes can still trigger CI.
- The exclusions apply to the main CI workflow, not automatically to every other GitHub Actions workflow.

For example, a pull request changing only `docs/API_REFERENCE.md` may not trigger the main CI workflow. A pull request changing that file together with `src/app/page.tsx` can trigger it.

GitHub evaluates branch and path filters together. A matching target branch does not override the configured path exclusions.

### 1.3 Concurrency

The workflow defines a concurrency group using the workflow name and Git reference:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

When a newer run starts for the same concurrency group, an in-progress run can be cancelled. This prevents unnecessary execution of outdated CI runs.

## 2. CI Jobs

The main workflow defines three jobs:

1. `build-and-test`
2. `postgres-migration-and-integration`
3. `e2e-test`

Their failure-handling behavior is different.

| Job                                  | Runtime    | Failure behavior                                                                       |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------- |
| `build-and-test`                     | Node.js 22 | Critical build steps are blocking; lint, type-check, and unit-test steps are advisory. |
| `postgres-migration-and-integration` | Node.js 22 | Entire job is advisory through job-level `continue-on-error: true`.                    |
| `e2e-test`                           | Node.js 20 | Entire job is advisory through job-level `continue-on-error: true`.                    |

### 2.1 Build and Test

**Job ID:** `build-and-test`

**Runner:** `ubuntu-latest`

**Node.js:** `22`

This job performs the primary application validation.

The configured steps execute in the following order:

| Step                   | Command or action                | Failure behavior |
| ---------------------- | -------------------------------- | ---------------- |
| Checkout               | `actions/checkout@v7`            | Blocking         |
| Set up Node.js         | `actions/setup-node@v7`, Node 22 | Blocking         |
| Cache Next.js output   | `actions/cache@v6`               | Blocking         |
| Install dependencies   | `npm ci --legacy-peer-deps`      | Blocking         |
| Generate Prisma client | `npx prisma generate`            | Blocking         |
| Run lint               | `npm run lint`                   | Advisory         |
| Run type check         | `npx tsc --noEmit`               | Advisory         |
| Run tests              | `npm test`                       | Advisory         |
| Build application      | `npm run build`                  | Blocking         |

The lint, type-check, and test steps explicitly configure:

```yaml
continue-on-error: true
```

Their failures are reported in the workflow logs but do not independently fail the job.

The dependency installation, Prisma generation, and production build steps do not have this exception.

**Important:** The build command is a critical CI step. The repository's `package.json` defines it as:

```json
{
  "build": "prisma generate && next build --webpack"
}
```

Therefore, the production build includes Prisma client generation followed by the Next.js production build.

### 2.2 PostgreSQL Migration and Integration Checks

**Job ID:** `postgres-migration-and-integration`

**Runner:** `ubuntu-latest`

**Node.js:** `22`

This job validates database migrations and integration behavior against a real PostgreSQL service.

The job configures:

- PostgreSQL image: `pgvector/pgvector:0.8.7-pg16-bookworm`
- Database: `worksphere_ci_test`
- Database user: `worksphere_ci`
- A PostgreSQL health check using `pg_isready`

The job then executes these steps:

1. Check out the repository.
2. Set up Node.js 22.
3. Install dependencies using `npm ci --legacy-peer-deps`.
4. Generate the Prisma client.
5. Install PostGIS and required PostgreSQL packages in the service container.
6. Pre-enable the required PostgreSQL extensions.
7. Apply Prisma migrations.
8. Check migration status.
9. Run PostgreSQL integration tests.

The required extensions are:

| Extension       | Purpose                           |
| --------------- | --------------------------------- |
| `vector`        | Vector operations                 |
| `pg_trgm`       | Trigram-based text matching       |
| `postgis`       | Spatial and geographic operations |
| `fuzzystrmatch` | Fuzzy string matching             |

The workflow explicitly checks that all four extensions are installed before proceeding.

The database validation commands include:

```bash
npx prisma migrate deploy
npx prisma migrate status
npm run test:integration
```

The job has a job-level exception:

```yaml
continue-on-error: true
```

Consequently, PostgreSQL integration failures are advisory and do not independently fail the overall CI workflow.

This does not mean that the integration checks are skipped. They still execute when the job is eligible to run, and their results remain available in GitHub Actions.

### 2.3 Playwright End-to-End Tests

**Job ID:** `e2e-test`

**Runner:** `ubuntu-latest`

**Node.js:** `20`

The E2E job depends on the completion of `build-and-test`:

```yaml
needs: build-and-test
```

Under the default dependency behavior, it does not proceed when its required job fails.

Its steps are:

1. Check out the repository.
2. Set up Node.js 20.
3. Install dependencies using `npm ci --legacy-peer-deps`.
4. Generate the Prisma client.
5. Install Chromium and its system dependencies.
6. Execute the Playwright test suite.
7. Upload the Playwright report when a failure occurs.

The relevant commands are:

```bash
npx playwright install --with-deps chromium
npm run test:e2e
```

The workflow uploads the following artifact on failure:

| Setting          | Value                |
| ---------------- | -------------------- |
| Artifact name    | `playwright-report`  |
| Artifact path    | `playwright-report/` |
| Retention        | 7 days               |
| Upload condition | `if: failure()`      |

The entire job has:

```yaml
continue-on-error: true
```

Therefore, E2E failures are advisory and do not independently fail the overall CI workflow.

## 3. Blocking vs. Advisory Checks

Understanding the distinction between blocking and advisory checks is important when reviewing CI results.

### Blocking checks

The following operations do not configure `continue-on-error: true` at their respective step or job level:

- Main application dependency installation.
- Prisma client generation in `build-and-test`.
- Production application build.
- Required steps in the primary `build-and-test` job.

A failure in a critical step can fail the primary job and prevent dependent jobs, such as E2E testing, from running.

### Advisory checks

The following checks are configured to tolerate failures:

| Check                  | Configuration                        | Effect                                                        |
| ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| ESLint                 | Step-level `continue-on-error: true` | Failure does not independently fail `build-and-test`.         |
| TypeScript             | Step-level `continue-on-error: true` | Failure does not independently fail `build-and-test`.         |
| Jest tests             | Step-level `continue-on-error: true` | Failure does not independently fail `build-and-test`.         |
| PostgreSQL integration | Job-level `continue-on-error: true`  | Job failure does not independently fail the overall workflow. |
| Playwright E2E         | Job-level `continue-on-error: true`  | Job failure does not independently fail the overall workflow. |

Advisory does not mean optional or unimportant. Contributors should still investigate and resolve failures in these checks.

The distinction describes the workflow's configured failure behavior, not the importance of code quality or test coverage.

## 4. Separate PR Quality Check

The second workflow is defined in:

```text
.github/workflows/pr-check.yml
```

It runs independently of the main CI workflow.

### 4.1 Triggers

The PR Quality Check workflow runs when a pull request is:

- Opened.
- Edited.
- Updated with new commits (`synchronize`).
- Reopened.

Unlike the main CI workflow, it does not configure a target-branch filter or documentation path exclusions.

Therefore, documentation-only pull requests can trigger this workflow even when the main CI workflow is skipped.

### 4.2 Issue Linking Validation

The workflow checks whether the pull request description references a related issue.

It recognizes closing keywords including:

- `Closes #123`
- `Closed #123`
- `Fixes #123`
- `Fixed #123`
- `Resolves #123`
- `Resolved #123`

The validation removes HTML comments, fenced code blocks, and inline code before searching the description. This prevents examples or code snippets from being mistaken for actual issue references.

The workflow also supports certain title-based exceptions. A pull request title containing `typo`, `chore`, or `[skip-issue]` bypasses the missing-issue-link warning.

### 4.3 Warning vs. Failure

An important distinction is that a missing issue reference does not automatically fail the PR Quality Check.

When an issue reference is missing and no title-based exception applies, the workflow uses:

```javascript
core.warning(noticeMsg);
```

It does not call `core.setFailed` for this condition.

The result is an advisory warning asking contributors to link the related issue, rather than a blocking issue-link validation failure.

The workflow also catches unexpected errors in its validation logic and reports them as warnings.

**Separate hard-failure behavior:** The workflow contains an author blocklist check that can explicitly fail the job for configured blocked contributors. This behavior is separate from the advisory issue-link warning.

### 4.4 Recommended Pull Request Description

For normal issue-based contributions, include a closing reference in the PR description:

```markdown
## Summary

Describe what changed and why.

## Verification

- Mention the relevant checks performed.
- Describe any limitations.

Closes #123
```

Use the actual issue number associated with the contribution.

Including the issue reference makes the relationship between the pull request and its issue explicit and supports the repository's automated validation.

## 5. Node.js Versions

The repository uses different Node.js versions for local development guidance and CI jobs.

| Environment                        | Node.js version |
| ---------------------------------- | --------------- |
| `.nvmrc` local development version | 20              |
| `build-and-test`                   | 22              |
| PostgreSQL integration job         | 22              |
| Playwright E2E job                 | 20              |

The contributor documentation recommends Node.js 20 or higher.

The CI workflows explicitly configure their own Node.js versions through `actions/setup-node`. Therefore, the local `.nvmrc` version does not override the versions selected by individual CI jobs.

## 6. Running Equivalent Checks Locally

The following commands correspond to scripts and checks used by the repository.

| Purpose                          | Command                                       |
| -------------------------------- | --------------------------------------------- |
| Install dependencies             | `npm ci --legacy-peer-deps`                   |
| Generate Prisma client           | `npx prisma generate`                         |
| Run lint                         | `npm run lint`                                |
| Type-check                       | `npx tsc --noEmit`                            |
| Run unit tests                   | `npm test`                                    |
| Run PostgreSQL integration tests | `npm run test:integration`                    |
| Run Playwright E2E tests         | `npm run test:e2e`                            |
| Install Chromium for E2E         | `npx playwright install --with-deps chromium` |
| Build the application            | `npm run build`                               |

Database integration tests require a compatible PostgreSQL environment with the required extensions.

Playwright E2E tests require the appropriate browser dependencies.

For general contributor setup and testing instructions, see [CONTRIBUTING.md](../../CONTRIBUTING.md).

## 7. Interpreting GitHub Actions Results

When reviewing a pull request, use the following approach:

1. **Check whether the main CI workflow was triggered.** If the pull request only modifies excluded documentation paths or Markdown files, the workflow may not run.
2. **Inspect `build-and-test`.** Pay particular attention to dependency installation, Prisma generation, and the production build.
3. **Review advisory failures.** Lint, TypeScript, and Jest results can report failures without independently failing the primary job.
4. **Inspect PostgreSQL integration results.** A failed advisory job still indicates a database migration or integration problem worth investigating.
5. **Inspect Playwright results.** When E2E testing fails, check the uploaded `playwright-report` artifact while it is available.
6. **Check the separate PR Quality Check.** A missing issue reference produces a warning rather than an automatic issue-link validation failure.
7. **Distinguish skipped workflows from passed workflows.** A workflow excluded by path filters has not performed its checks.

A green overall CI result does not necessarily mean every advisory check passed. Review the individual job and step results before considering a contribution fully validated.

## 8. Related Documentation

- [Contributing Guide](../../CONTRIBUTING.md) — local development, Git workflow, testing, and pull request requirements.
- [WorkSphere Documentation Index](../README.md) — documentation organized by project topic.
- [GitHub Actions CI Workflow](../../.github/workflows/ci.yml) — main CI workflow configuration.
- [PR Quality Check](../../.github/workflows/pr-check.yml) — pull request quality validation configuration.
