# Release Guide & Tagging Standard

Documents the `vMAJOR.MINOR.PATCH` Semantic Versioning standard, `v`-prefixed Git tags, pre-release suffixes, `Set as the latest release` rules, and release title conventions.

## 1. Semantic Versioning (`vMAJOR.MINOR.PATCH`) & `v`-Prefixed Git Tags

* All release tags follow SemVer 2.0.0 with a lowercase `v` prefix (e.g., `v1.0.0`, `v2.3.4`):
  * **`MAJOR` (`vX.0.0`):** Breaking API, protocol, or schema changes.
  * **`MINOR` (`vX.Y.0`):** Backward-compatible new features or capabilities.
  * **`PATCH` (`vX.Y.Z`):** Backward-compatible bug fixes, security patches, and documentation updates.
* Create annotated tags on verified `main` commits (`git tag -a vX.Y.Z -m "Release vX.Y.Z"`) and never force-overwrite published tags.

## 2. Pre-Release Suffixes (`-alpha`, `-beta.N`, `-rc.N`)

* **Alpha:** `vMAJOR.MINOR.PATCH-alpha` or `vMAJOR.MINOR.PATCH-alpha.N` (e.g., `v1.2.0-alpha`, `v1.2.0-alpha.1`) for early integration testing.
* **Beta:** `vMAJOR.MINOR.PATCH-beta.N` (e.g., `v1.2.0-beta.1`) for feature-complete testing.
* **Release Candidate:** `vMAJOR.MINOR.PATCH-rc.N` (e.g., `v1.2.0-rc.1`) for final release verification.
* Precedence: `v1.2.0-alpha < v1.2.0-alpha.1 < v1.2.0-beta.1 < v1.2.0-rc.1 < v1.2.0`.

## 3. Set as the Latest Release Rules

* **Check "Set as the latest release"** only for the newest stable `vMAJOR.MINOR.PATCH` release on the primary release line.
* **Uncheck "Set as the latest release"** for backport patches to older major/minor lines and for all pre-releases (`-alpha`, `-beta.N`, `-rc.N`).

## 4. Release Title Conventions

* **Stable Releases:** `vMAJOR.MINOR.PATCH — <Short Highlight Summary>` (e.g., `v2.3.4 — Solana RPC Failover & ZKP Worker Stability`) or `vMAJOR.MINOR.PATCH`.
* **Pre-Releases:** `vMAJOR.MINOR.PATCH-<suffix> (Pre-release)` (e.g., `v2.4.0-rc.1 (Pre-release)`).
