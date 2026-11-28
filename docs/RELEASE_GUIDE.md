 fix/use-mesh-data-channels-unmount-cleanup
# Emergency Release Rollback & Patch Hotfix Runbook

This runbook defines the emergency procedure for yanking or demoting a broken `latest` GitHub Release (`vX.Y.Z`), cutting a forward patch release (`vX.Y.(Z+1)`), and redeploying safely without rewriting Git history or force-moving published tags.

## 1. Triage & Rollback Strategy

* **Never force-push or delete a published production tag in place:** Downstream package caches, CI pipelines, and SHA-256 verification logs may have already fetched `vX.Y.Z`.
* **Two-Step Recovery:**
  1. Immediately **demote** the broken release from `latest` (re-pointing `latest` to the last known-good release `vX.Y.(Z-1)` or marking `vX.Y.Z` as a pre-release / yank notice) and roll back active deployments.
  2. Fix the regression on `main`, cut a new forward patch tag **`vX.Y.(Z+1)`**, attach fresh artifacts + `SHA256SUMS.txt`, promote `vX.Y.(Z+1)` to `latest`, and redeploy.

## 2. Step-by-Step Demotion & Yank Procedure (GitHub CLI & GitHub UI)

Assume **`v2.4.0`** is broken in production and **`v2.3.4`** is the last known-good release.

### Option A: Using GitHub CLI (`gh`)

1. **Re-promote the last known-good release (`v2.3.4`) to `latest`:**
   ```bash
   gh release edit v2.3.4 --latest --repo SatyamPandey-07/WorkSphere
 feat/mesh-key-epoch-overlap-decryption

 docs/flutter-local-persistence-schema

 docs/flutter-theme-tokens-wcag-aaa

 chore/github-release-yml-changelog-filters

 docs/flutter-migration-architecture

 docs/maintainer-release-checklist
 main
 main
 main
 main
 main
# Maintainer Release Checklist & Guide

Step-by-step maintainer checklist for cutting a GitHub Release, selecting a previous tag for generated release notes, writing release descriptions, and attaching build artifacts.

## Step-by-Step Maintainer Release Checklist

1. **Verify Target Commit & Push Tag:** Ensure CI passes on `main`, create an annotated `vMAJOR.MINOR.PATCH` (or pre-release) tag, and push it to `upstream`.
2. **Draft Release & Choose Tag:** Open **Releases -> Draft a new release** and select the pushed tag.
3. **Select Previous Tag for Generated Release Notes:** Choose the baseline tag in the **Previous tag** dropdown (e.g., `v2.3.4` for `v2.4.0`) and click **Generate release notes**.
4. **Write Release Description:** Title the release (`vMAJOR.MINOR.PATCH — <Summary>`) and organize notes into **Breaking Changes**, **Features**, **Bug Fixes & Security**, and **Documentation** with PR/issue links.
5. **Attach Build Artifacts & Checksums:** Upload Web/Flutter build artifacts and `SHA256SUMS.txt` under **Attach binaries** and verify file integrity.
6. **Configure Release Flags & Publish:** Check **This is a pre-release** (and uncheck **Set as the latest release**) for `-alpha`/`-beta`/`-rc` builds; check **Set as the latest release** only for active-line production releases, then click **Publish release**.
 feat/mesh-key-epoch-overlap-decryption

 docs/flutter-local-persistence-schema

 docs/flutter-theme-tokens-wcag-aaa

 chore/github-release-yml-changelog-filters

 docs/flutter-migration-architecture


 docs/release-guide-prerelease-vs-latest
# Release Guide & Pre-Release vs. Latest Resolution

Defines when to check **This is a pre-release** vs. **Set as the latest release** on GitHub Releases, how GitHub resolves `/releases/latest`, and examples for **Web** and **Flutter** staging builds.

## 1. Pre-Release vs. Latest Release Resolution

* **Pre-Release (`prerelease: true`):** Marks non-production builds (`-alpha`, `-beta.N`, `-rc.N`, staging/QA builds). Excluded from `/releases/latest` API and redirect resolution and never replaces the active **Latest** release.
* **Latest Production Release (`prerelease: false`, `make_latest: "true"`):** Marks a verified `vMAJOR.MINOR.PATCH` production release on the active release line so `/releases/latest` resolves to it.
* **Older-Line Backports:** Leave both **This is a pre-release** and **Set as the latest release** unchecked so `latest` remains on the newest major release line.

## 2. Web & Flutter Staging Build Examples

### Web Staging Build
* Tag staging builds as `v2.4.0-rc.1` (or `web-v2.4.0-rc.1`), attach staging bundle notes, check **This is a pre-release**, and leave **Set as the latest release** unchecked.
* Promote to production by tagging `v2.4.0`, unchecking **This is a pre-release**, and checking **Set as the latest release**.

### Flutter Staging Build
* Tag staging APK/AAB/IPA builds as `v2.4.0-beta.1` (or `flutter-v2.4.0-beta.1`), attach staging binaries and SHA-256 checksums, check **This is a pre-release**, and leave **Set as the latest release** unchecked.
* Promote to production by tagging `v2.4.0`, unchecking **This is a pre-release**, and checking **Set as the latest release**.

# Release Guide & Tagging Standard

Documents the `vMAJOR.MINOR.PATCH` Semantic Versioning standard, `v`-prefixed Git tags, pre-release suffixes, `Set as the latest release` rules, and release title conventions.

## 1. Required Pre-Tag Validation

Before creating a release tag, run:

```bash
npm run release:check
```

This command verifies that the Git working tree is clean, runs ESLint, checks TypeScript types with `tsc --noEmit`, and builds the application with `next build --webpack`, in that order. It stops at the first failed step. A failure blocks release preparation; resolve the reported issue and rerun the command before tagging.

## 2. Semantic Versioning (`vMAJOR.MINOR.PATCH`) & `v`-Prefixed Git Tags

* All release tags follow SemVer 2.0.0 with a lowercase `v` prefix (e.g., `v1.0.0`, `v2.3.4`):
  * **`MAJOR` (`vX.0.0`):** Breaking API, protocol, or schema changes.
  * **`MINOR` (`vX.Y.0`):** Backward-compatible new features or capabilities.
  * **`PATCH` (`vX.Y.Z`):** Backward-compatible bug fixes, security patches, and documentation updates.
* Create annotated tags on verified `main` commits (`git tag -a vX.Y.Z -m "Release vX.Y.Z"`) and never force-overwrite published tags.

## 3. Pre-Release Suffixes (`-alpha`, `-beta.N`, `-rc.N`)

* **Alpha:** `vMAJOR.MINOR.PATCH-alpha` or `vMAJOR.MINOR.PATCH-alpha.N` (e.g., `v1.2.0-alpha`, `v1.2.0-alpha.1`) for early integration testing.
* **Beta:** `vMAJOR.MINOR.PATCH-beta.N` (e.g., `v1.2.0-beta.1`) for feature-complete testing.
* **Release Candidate:** `vMAJOR.MINOR.PATCH-rc.N` (e.g., `v1.2.0-rc.1`) for final release verification.
* Precedence: `v1.2.0-alpha < v1.2.0-alpha.1 < v1.2.0-beta.1 < v1.2.0-rc.1 < v1.2.0`.

## 4. Set as the Latest Release Rules

* **Check "Set as the latest release"** only for the newest stable `vMAJOR.MINOR.PATCH` release on the primary release line.
* **Uncheck "Set as the latest release"** for backport patches to older major/minor lines and for all pre-releases (`-alpha`, `-beta.N`, `-rc.N`).

## 5. Release Title Conventions

* **Stable Releases:** `vMAJOR.MINOR.PATCH — <Short Highlight Summary>` (e.g., `v2.3.4 — Solana RPC Failover & ZKP Worker Stability`) or `vMAJOR.MINOR.PATCH`.
* **Pre-Releases:** `vMAJOR.MINOR.PATCH-<suffix> (Pre-release)` (e.g., `v2.4.0-rc.1 (Pre-release)`).
 main
 main
 main
 main
 main
 main
 main
 main
