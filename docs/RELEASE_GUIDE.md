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
