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

## 4. Web-to-Mobile Route Parity

The table below is based on the current Next.js route tree and the implemented
GoRouter configuration in `apps/flutter/lib/app/router.dart`. Flutter uses
GoRouter's `:parameter` syntax; the Next.js `[parameter]` notation is shown in
the web-route column for comparison.

| Next.js web route | Parameter(s) | Web access | Flutter GoRouter path | Flutter access today | Parity status |
| --- | --- | --- | --- | --- |
| `/venues` | Query parameters are supported (for example, `category`) | Public | `/venues` | Redirects to sign-in while signed out | Implemented; query parameters are read from `state.uri.queryParameters` |
| `/venues/[id]` | `id` (venue identifier) | Public | `/venues/:id` | Redirects to sign-in while signed out | Implemented; available as `state.pathParameters['id']` |
| `/reserve/[venueId]` | `venueId` (venue identifier) | Authenticated | `/reserve/:venueId` | Redirects to sign-in while signed out | Route exists; parameter is available as `state.pathParameters['venueId']` |
| `/social` | None | Authenticated | — | No destination | Gap: no Flutter GoRouter route is currently defined |
| `/dashboard` | None | Public at the route layer; page reads the optional Clerk user context | — | No destination | Gap: no Flutter GoRouter route is currently defined |
| `/workspace` | None | Public in the current Next.js page implementation | — | No destination | Gap: no Flutter GoRouter route is currently defined |

The web `/social` and `/reserve/[venueId]` pages explicitly redirect to
`/sign-in` when Clerk does not provide a user. The current `/dashboard` and
`/workspace` page implementations do not contain an explicit server-side
redirect, so this document does not infer a stronger access rule for them.
The Flutter router currently applies its redirect globally, so even the public
venue routes require the Flutter authentication state to be true until the
route guard is narrowed to the intended protected set.

## 5. Deep-Link and Authentication Contract

### URI schemes

Mobile deep links should use the following external-to-internal mapping:

| Link type | URI form | Handling |
| --- | --- | --- |
| Custom scheme | `worksphere://<path>` (for example, `worksphere://venues/123`) | The platform adapter must convert the URI path and query string to a GoRouter location. |
| iOS Universal Links | `https://<associated-domain>/<path>` | Requires an iOS Associated Domains entitlement and a server-hosted `apple-app-site-association` file. |
| Android App Links | `https://<associated-domain>/<path>` | Requires an Android `intent-filter` with auto-verification and a server-hosted `assetlinks.json` file. |

No iOS associated-domain file, Android `assetlinks.json`, or platform
intent-filter is present in the repository at the time of writing. Therefore
the entries above describe the required integration contract, not a claim that
all three link mechanisms are already enabled in a released build.

### Protected routes and login redirects

`createAppRouter` observes the supplied authentication `ValueListenable`. When
the user is signed out, any route other than `/sign-in` is redirected to
`/sign-in?redirect=<original-path-and-query>`. After authentication, the
sanitized `redirect` value is restored. External and protocol-relative targets
are rejected and fall back to `/`, preventing an open redirect.

This means a deep link such as `/reserve/venue-123` can be received before
login, shown as `/sign-in?redirect=%2Freserve%2Fvenue-123`, and resumed after
authentication. Query parameters on public routes, such as
`/venues?category=quiet`, are preserved by the same redirect flow.

Until the missing Flutter routes are implemented, deep links for `/social`,
`/dashboard`, and `/workspace` have no corresponding GoRouter destination and
must not be documented as supported mobile screens.
