# WorkSphere Flutter Architecture & Toolchain Blueprint

Defines the target Flutter/Dart SDK versions, `apps/flutter/` directory structure, feature-first architecture mirroring `src/`, and package naming conventions.

## 1. Recommended Flutter & Dart Toolchain Versions

* **Flutter SDK:** `3.50.1` (`channel: stable`, constraint `>=3.50.0 <4.0.0`)
* **Dart SDK:** `3.14.0` (constraint `>=3.14.0 <4.0.0`)
* **Platform Targets:** Android (`compileSdk 35`, `minSdk 24`, AGP `9.0+`), iOS/macOS (iOS `15.0+`, Swift Package Manager default), Web (`dart2wasm`).

## 2. Repository Folder Structure (`apps/flutter/`)

* Host the Flutter app under `apps/flutter/` with `lib/app/`, `lib/core/` (mirroring `src/lib/` and `src/hooks/`), `lib/features/` (mirroring `src/components/`), and `test/`.
* Structure each feature module with `data/`, `domain/`, and `presentation/` layers.

## 3. Package & Identifier Naming Conventions

* **Pub Package Name:** `worksphere_app` (lowercase `snake_case`; shared packages use `worksphere_<module>`).
* **Files & Directories:** Lowercase `snake_case.dart` (e.g., `booking_date_picker.dart`, `rpc_cluster_pool.dart`).
* **Platform Bundle IDs:** `com.worksphere.app` (production) and `com.worksphere.app.staging` (pre-release/QA).
