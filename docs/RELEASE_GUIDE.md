# Maintainer Release Checklist & Guide

Step-by-step maintainer checklist for cutting a GitHub Release, selecting a previous tag for generated release notes, writing release descriptions, and attaching build artifacts.

## Step-by-Step Maintainer Release Checklist

1. **Verify Target Commit & Push Tag:** Ensure CI passes on `main`, create an annotated `vMAJOR.MINOR.PATCH` (or pre-release) tag, and push it to `upstream`.
2. **Draft Release & Choose Tag:** Open **Releases -> Draft a new release** and select the pushed tag.
3. **Select Previous Tag for Generated Release Notes:** Choose the baseline tag in the **Previous tag** dropdown (e.g., `v2.3.4` for `v2.4.0`) and click **Generate release notes**.
4. **Write Release Description:** Title the release (`vMAJOR.MINOR.PATCH — <Summary>`) and organize notes into **Breaking Changes**, **Features**, **Bug Fixes & Security**, and **Documentation** with PR/issue links.
5. **Attach Build Artifacts & Checksums:** Upload Web/Flutter build artifacts and `SHA256SUMS.txt` under **Attach binaries** and verify file integrity.
6. **Configure Release Flags & Publish:** Check **This is a pre-release** (and uncheck **Set as the latest release**) for `-alpha`/`-beta`/`-rc` builds; check **Set as the latest release** only for active-line production releases, then click **Publish release**.
