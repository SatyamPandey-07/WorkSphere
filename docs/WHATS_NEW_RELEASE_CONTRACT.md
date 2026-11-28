# What's New Modal Persistence & `GET /api/releases/latest` Contract

This document specifies the `GET /api/releases/latest` API contract (`src/app/api/releases/latest/route.ts`) and how `WhatsNewDialog` (`src/components/releases/WhatsNewDialog.tsx`) persists dismissed release versions in `localStorage`.

## 1. `GET /api/releases/latest` Contract

### Upstream & Caching Behavior

- **Upstream source**: Queries `https://api.github.com/repos/srnsksyp/WorkSphere/releases?per_page=100` with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28` (plus `Authorization: Bearer <GITHUB_TOKEN>` when `process.env.GITHUB_TOKEN` is set).
- **In-memory cache TTL**: `CACHE_TTL_MS = 5 * 60 * 1000` (5 minutes / `300` seconds), paired with `next: { revalidate: 300 }`.
- **Cache-Control headers**:
  - **Fresh or valid cached response (`200`)**: `public, max-age=0, s-maxage=300, stale-while-revalidate=600`
  - **Stale fallback on upstream failure when cache exists (`200`)**: `public, max-age=0, s-maxage=60, stale-while-revalidate=300` (with `cached: true, stale: true`)
  - **No releases classified (`404`)**: `public, max-age=0, s-maxage=60`
  - **Uncached upstream error (`502` / `503`)**: `no-store`

### Response Schema

| Field | Type | Description |
| --- | --- | --- |
| `web` | `ReleaseInfo \| null` | Latest release classified as `web` (asset name starts with `worksphere-web-` or title/tag matches `\bweb\b`). |
| `flutter` | `ReleaseInfo \| null` | Latest release classified as `flutter` (asset ends with `.apk`, `.aab`, or `.ipa`, or title/tag matches `\b(flutter\|android\|ios\|mobile)\b`). |
| `cached` | `boolean` | `true` when served from the in-memory cache; `false` on a fresh upstream fetch. |
| `stale` | `boolean` | `true` when serving an expired cached payload due to an upstream error or rate limit. |
| `error` | `{ code: string; message: string }` | Present on `404` (`RELEASES_NOT_FOUND`), `502` (`UPSTREAM_UNAVAILABLE`), and `503` (`UPSTREAM_RATE_LIMITED`). |

#### `ReleaseInfo` Fields

| Field | Type | Description |
| --- | --- | --- |
| `version` | `string` | `tag_name` with a leading `v` stripped (e.g. `"2.5.0"`). |
| `tag` | `string` | Raw GitHub release tag (e.g. `"v2.5.0"`). |
| `notesSummary` | `string` | First non-empty markdown-stripped line of the release body, truncated to 300 characters (`...`). |
| `prerelease` | `boolean` | GitHub release `prerelease` flag. |
| `publishedAt` | `string \| null` | ISO-8601 `published_at` timestamp from GitHub. |
| `url` | `string` | GitHub release `html_url`. |
| `downloads` | `Array<{ name: string; url: string; size: number }>` | Release assets with filename, `browser_download_url`, and byte size. |

### Sample JSON Response (`200 OK`)

```json
{
  "web": {
    "version": "2.5.0",
    "tag": "v2.5.0",
    "notesSummary": "A faster dashboard and improved booking tools.",
    "prerelease": false,
    "publishedAt": "2026-03-15T12:00:00.000Z",
    "url": "https://github.com/srnsksyp/WorkSphere/releases/tag/v2.5.0",
    "downloads": [
      {
        "name": "worksphere-web-v2.5.0.tar.gz",
        "url": "https://github.com/srnsksyp/WorkSphere/releases/download/v2.5.0/worksphere-web-v2.5.0.tar.gz",
        "size": 2048
      }
    ]
  },
  "flutter": null,
  "cached": false,
  "stale": false
}
```

---

## 2. `WhatsNewDialog` `localStorage` Persistence

`WhatsNewDialog` (`src/components/releases/WhatsNewDialog.tsx`) tracks the last dismissed web release version under:

- **Storage key**: `worksphere:last-seen-release-version` (`LAST_SEEN_VERSION_KEY`)

### Lifecycle

1. **Fetch & Parse**: On mount, `WhatsNewDialog` fetches `/api/releases/latest` with an `AbortController` signal and parses `payload.web` via `parseReleaseInfo` (enforcing `https:` URLs via `safeExternalUrl`).
2. **Version Comparison**: `readLastSeenVersion()` reads `window.localStorage.getItem("worksphere:last-seen-release-version")`. If the stored value does not equal `latest.version`, the dialog opens.
3. **Dismissal Persistence**: Dismissing the dialog via **Close**, **Got it**, or the `Escape` key calls `persistLastSeenVersion(release.version)` (`window.localStorage.setItem("worksphere:last-seen-release-version", release.version)`) and closes the modal.
4. **Storage Fault Tolerance**: Both `readLastSeenVersion()` and `persistLastSeenVersion()` wrap `window.localStorage` access in `try/catch` so the dialog remains functional even when browser storage is blocked or unavailable.
