const UPSTREAM_REPOSITORY = 'srnsksyp/WorkSphere';
const CACHE_TTL_MS = 5 * 60 * 1000;
const RELEASES_URL = `https://api.github.com/repos/${UPSTREAM_REPOSITORY}/releases?per_page=100`;

type GitHubAsset = {
  name: string;
  browser_download_url: string;
  size: number;
};

type GitHubRelease = {
  tag_name: string;
  name: string | null;
  body?: string | null;
  html_url: string;
  prerelease: boolean;
  published_at: string | null;
  assets: GitHubAsset[];
};

type ReleaseInfo = {
  version: string;
  tag: string;
  body: string;
  notesSummary: string;
  prerelease: boolean;
  publishedAt: string | null;
  url: string;
  downloads: Array<{
    name: string;
    url: string;
    size: number;
  }>;
};

type ReleasePayload = {
  web: ReleaseInfo | null;
  flutter: ReleaseInfo | null;
};

let cached: { payload: ReleasePayload; expiresAt: number } | null = null;

function summarizeNotes(body: string): string {
  if (!body.trim()) {
    return '';
  }

  const summary = body
    .replace(/^#+\s*/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!summary) {
    return '';
  }
  return summary.length > 300 ? `${summary.slice(0, 297)}...` : summary;
}

function classifyRelease(release: GitHubRelease): Array<'web' | 'flutter'> {
  const assetNames = release.assets.map((asset) => asset.name.toLowerCase());
  const metadata = `${release.name ?? ''} ${release.tag_name}`.toLowerCase();
  const targets: Array<'web' | 'flutter'> = [];

  if (
    assetNames.some((name) => name.startsWith('worksphere-web-')) ||
    /\bweb\b/.test(metadata)
  ) {
    targets.push('web');
  }

  if (
    assetNames.some((name) => /\.(apk|aab|ipa)$/.test(name)) ||
    /\b(flutter|android|ios|mobile)\b/.test(metadata)
  ) {
    targets.push('flutter');
  }

  return targets;
}

function toReleaseInfo(release: GitHubRelease): ReleaseInfo {
  const body = release.body ?? '';
  return {
    version: release.tag_name.replace(/^v/, ''),
    tag: release.tag_name,
    body,
    notesSummary: summarizeNotes(body),
    prerelease: release.prerelease,
    publishedAt: release.published_at,
    url: release.html_url,
    downloads: release.assets.map((asset) => ({
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
    })),
  };
}

function buildPayload(releases: GitHubRelease[]): ReleasePayload {
  const payload: ReleasePayload = { web: null, flutter: null };
  const sorted = [...releases].sort((a, b) => {
    return (
      Date.parse(b.published_at ?? '') - Date.parse(a.published_at ?? '')
    );
  });

  for (const release of sorted) {
    const info = toReleaseInfo(release);
    for (const target of classifyRelease(release)) {
      if (payload[target] === null) {
        payload[target] = info;
      }
    }
  }
  return payload;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  cacheControl: string,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after')))
  );
}

function fallbackResponse(rateLimited: boolean): Response {
  if (cached) {
    return jsonResponse(
      { ...cached.payload, cached: true, stale: true },
      200,
      'public, max-age=0, s-maxage=60, stale-while-revalidate=300',
    );
  }

  return jsonResponse(
    {
      error: {
        code: rateLimited ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_UNAVAILABLE',
        message: 'Release information is temporarily unavailable.',
      },
      web: null,
      flutter: null,
    },
    rateLimited ? 503 : 502,
    'no-store',
  );
}

export async function GET(): Promise<Response> {
  if (cached && cached.expiresAt > Date.now()) {
    return jsonResponse(
      { ...cached.payload, cached: true, stale: false },
      200,
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    );
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    const response = await fetch(RELEASES_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return fallbackResponse(isRateLimited(response));
    }

    const releases = (await response.json()) as GitHubRelease[];
    const payload = buildPayload(releases);
    if (payload.web === null && payload.flutter === null) {
      return jsonResponse(
        {
          error: {
            code: 'RELEASES_NOT_FOUND',
            message: 'No web or Flutter releases are currently available.',
          },
          ...payload,
        },
        404,
        'public, max-age=0, s-maxage=60',
      );
    }

    cached = { payload, expiresAt: Date.now() + CACHE_TTL_MS };
    return jsonResponse(
      { ...payload, cached: false, stale: false },
      200,
      'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
    );
  } catch {
    return fallbackResponse(false);
  }
}
