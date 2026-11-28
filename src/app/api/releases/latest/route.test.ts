const release = (
  overrides: Partial<{
    tag_name: string;
    name: string;
    body: string | null;
    html_url: string;
    prerelease: boolean;
    published_at: string;
    assets: Array<{
      name: string;
      browser_download_url: string;
      size: number;
    }>;
  }> = {},
) => ({
  tag_name: 'v1.2.3',
  name: 'WorkSphere Web',
  body: '## Highlights\nFast planning and focus tools.',
  html_url: 'https://github.com/srnsksyp/WorkSphere/releases/tag/v1.2.3',
  prerelease: false,
  published_at: '2026-01-01T00:00:00Z',
  assets: [
    {
      name: 'worksphere-web-v1.2.3.tar.gz',
      browser_download_url:
        'https://github.com/srnsksyp/WorkSphere/releases/download/v1.2.3/worksphere-web-v1.2.3.tar.gz',
      size: 1024,
    },
  ],
  ...overrides,
});

async function loadRoute() {
  jest.resetModules();
  return import('./route');
}

describe('GET /api/releases/latest', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns web and Flutter releases with versions, notes, and download links', async () => {
    const { GET: getLatest } = await loadRoute();
    const webRelease = release();
    const flutterRelease = release({
      tag_name: 'v1.2.2',
      name: 'WorkSphere Flutter',
      body: 'Mobile app release.',
      html_url:
        'https://github.com/srnsksyp/WorkSphere/releases/tag/v1.2.2',
      prerelease: true,
      published_at: '2025-12-31T00:00:00Z',
      assets: [
        {
          name: 'worksphere-android.apk',
          browser_download_url:
            'https://github.com/srnsksyp/WorkSphere/releases/download/v1.2.2/worksphere-android.apk',
          size: 2048,
        },
      ],
    });
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([webRelease, flutterRelease]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await getLatest();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.web).toMatchObject({
      version: '1.2.3',
      tag: 'v1.2.3',
      notesSummary: 'Fast planning and focus tools.',
      prerelease: false,
      downloads: [
        expect.objectContaining({
          name: 'worksphere-web-v1.2.3.tar.gz',
          url: expect.stringContaining('worksphere-web-v1.2.3.tar.gz'),
        }),
      ],
    });
    expect(data.flutter).toMatchObject({
      version: '1.2.2',
      tag: 'v1.2.2',
      prerelease: true,
      downloads: [
        expect.objectContaining({
          name: 'worksphere-android.apk',
          url: expect.stringContaining('.apk'),
        }),
      ],
    });
    expect(data.cached).toBe(false);
  });

  it.each([null, ''])(
    'normalizes a release with body %s to an empty response body',
    async (body) => {
      const { GET: getLatest } = await loadRoute();
      const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify([
            release({
              body,
            }),
          ]),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );

      const response = await getLatest();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(data.web).toMatchObject({
        version: '1.2.3',
        tag: 'v1.2.3',
        body: '',
        notesSummary: '',
        prerelease: false,
        url: 'https://github.com/srnsksyp/WorkSphere/releases/tag/v1.2.3',
        downloads: [
          expect.objectContaining({
            name: 'worksphere-web-v1.2.3.tar.gz',
          }),
        ],
      });
    },
  );

  it('returns cached release data without another upstream request', async () => {
    const { GET: getLatest } = await loadRoute();
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([release()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await getLatest();
    const response = await getLatest();
    const data = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.cached).toBe(true);
    expect(data.stale).toBe(false);
  });

  it('serves cached release data when GitHub rate-limits the request', async () => {
    const { GET: getLatest } = await loadRoute();
    jest.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValue(301_001);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([release()]), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0' },
        }),
      );

    await getLatest();
    const response = await getLatest();
    const data = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
    expect(data.cached).toBe(true);
    expect(data.stale).toBe(true);
    expect(data.web.tag).toBe('v1.2.3');
  });

  it('returns structured errors when no release is found or upstream is unavailable', async () => {
    const { GET: getLatest } = await loadRoute();
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const missingResponse = await getLatest();
    const missingData = await missingResponse.json();
    expect(missingResponse.status).toBe(404);
    expect(missingData.error.code).toBe('RELEASES_NOT_FOUND');
    expect(missingData.web).toBeNull();
    expect(missingData.flutter).toBeNull();

    jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response('internal upstream details', { status: 500 }),
    );
    const unavailableResponse = await getLatest();
    const unavailableData = await unavailableResponse.json();

    expect(unavailableResponse.status).toBe(502);
    expect(unavailableData.error.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(unavailableData.error.message).not.toContain('internal');
  });
});
