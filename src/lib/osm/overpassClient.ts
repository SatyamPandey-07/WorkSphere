import { z } from 'zod';

export const MAX_OVERPASS_QUERY_LENGTH = 100;
export const DEFAULT_OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const DEFAULT_OVERPASS_TIMEOUT_SEC = 15;

export interface OverpassVenueSearchParams {
    latitude: number;
    longitude: number;
    radiusMeters?: number;
    nameQuery?: string;
    amenityTypes?: Array<'cafe' | 'library' | 'coworking_space'>;
    timeoutSeconds?: number;
}

export interface OverpassElement {
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
}

export interface OverpassApiResponse {
    version: number;
    generator: string;
    elements: OverpassElement[];
}

const OverpassSearchParamsSchema = z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    radiusMeters: z.number().finite().positive().max(25_000).default(2_000),
    nameQuery: z.string().optional(),
    amenityTypes: z
        .array(z.enum(['cafe', 'library', 'coworking_space']))
        .min(1)
        .default(['cafe', 'library', 'coworking_space']),
    timeoutSeconds: z.number().int().min(1).max(60).default(DEFAULT_OVERPASS_TIMEOUT_SEC),
});

/**
 * Sanitizes a user-supplied venue name filter for safe interpolation inside an
 * Overpass QL regex filter (`["name"~"<escaped>",i]`):
 * 1. Trims whitespace and strips ASCII control characters / newlines.
 * 2. Enforces a strict maximum length of 100 characters prior to escaping.
 * 3. Escapes all regex metacharacters and double quotes so injection payloads
 *    like `"]; out; //` or unclosed brackets `[` cannot break Overpass QL syntax.
 */
export function sanitizeOverpassNameQuery(
    rawQuery: string,
    maxLength: number = MAX_OVERPASS_QUERY_LENGTH
): string {
    if (typeof rawQuery !== 'string') {
        return '';
    }

    // Remove control characters (including \r, \n, \0) and normalize surrounding whitespace
    const cleaned = rawQuery.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
    if (!cleaned) {
        return '';
    }

    // Enforce maximum length cap before escaping
    const bounded = cleaned.slice(0, maxLength);

    // Escape regex metacharacters (\ ^ $ . * + ? ( ) [ ] { } |) and double quotes (")
    return bounded.replace(/[\\^$.*+?()[\]{}|"]/g, '\\$&');
}

/**
 * Builds an injection-safe Overpass QL query string for discovering nomad workspaces
 * around `(latitude, longitude)` with optional escaped `name` regex matching.
 */
export function buildOverpassVenueQuery(rawParams: OverpassVenueSearchParams): string {
    const params = OverpassSearchParamsSchema.parse(rawParams);
    const escapedName = params.nameQuery
        ? sanitizeOverpassNameQuery(params.nameQuery)
        : '';

    const nameSelector = escapedName ? `["name"~"${escapedName}",i]` : '';
    const radius = Math.round(params.radiusMeters);
    const { latitude, longitude } = params;

    const statements: string[] = [];

    for (const amenity of params.amenityTypes) {
        if (amenity === 'coworking_space') {
            statements.push(
                `  node["office"="coworking"]${nameSelector}(around:${radius},${latitude},${longitude});`,
                `  way["office"="coworking"]${nameSelector}(around:${radius},${latitude},${longitude});`,
                `  node["amenity"="coworking_space"]${nameSelector}(around:${radius},${latitude},${longitude});`,
                `  way["amenity"="coworking_space"]${nameSelector}(around:${radius},${latitude},${longitude});`
            );
        } else {
            statements.push(
                `  node["amenity"="${amenity}"]${nameSelector}(around:${radius},${latitude},${longitude});`,
                `  way["amenity"="${amenity}"]${nameSelector}(around:${radius},${latitude},${longitude});`
            );
        }
    }

    return [
        `[out:json][timeout:${params.timeoutSeconds}];`,
        '(',
        ...statements,
        ');',
        'out center tags;',
    ].join('\n');
}

/**
 * Executes a sanitized venue discovery query against the OpenStreetMap Overpass API.
 */
export async function queryOverpassVenues(
    params: OverpassVenueSearchParams,
    options: {
        endpoint?: string;
        signal?: AbortSignal;
        fetchFn?: typeof fetch;
    } = {}
): Promise<OverpassElement[]> {
    const endpoint = options.endpoint ?? DEFAULT_OVERPASS_ENDPOINT;
    const fetchFn = options.fetchFn ?? fetch;
    const qlQuery = buildOverpassVenueQuery(params);

    const response = await fetchFn(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            Accept: 'application/json',
        },
        body: new URLSearchParams({ data: qlQuery }).toString(),
        signal: options.signal,
    });

    if (!response.ok) {
        throw new Error(`Overpass API request failed with status ${response.status}`);
    }

    const data = (await response.json()) as OverpassApiResponse;
    return Array.isArray(data.elements) ? data.elements : [];
}