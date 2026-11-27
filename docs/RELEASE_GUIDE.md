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