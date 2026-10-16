/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

interface GeoPosition {
    lat: number;
    lng: number;
    accuracy: number;
    timestamp: number;
}

interface Boundary {
    countryCode: string;
    polygon: [number, number][];
}

let boundaries: Boundary[] = [];
let lastKnownCountry: string | null = null;

function isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    let inside = false;
    const x = point[0], y = point[1];

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i][0], yi = polygon[i][1];
        const xj = polygon[j][0], yj = polygon[j][1];

        const intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}

function evaluatePosition(pos: GeoPosition): void {
    if (pos.accuracy > 100) return; // Ignore low accuracy GPS pings

    let currentCountry: string | null = null;

    for (const boundary of boundaries) {
        if (isPointInPolygon([pos.lng, pos.lat], boundary.polygon)) {
            currentCountry = boundary.countryCode;
            break;
        }
    }

    if (currentCountry && currentCountry !== lastKnownCountry) {
        lastKnownCountry = currentCountry;
        self.postMessage({
            type: 'COUNTRY_ENTERED',
            payload: { countryCode: currentCountry, position: pos },
        });
    } else if (!currentCountry && lastKnownCountry) {
        lastKnownCountry = null;
        self.postMessage({ type: 'NO_MANS_LAND', payload: { position: pos } });
    }
}

self.onmessage = (event) => {
    const { type, payload } = event.data;

    if (type === 'LOAD_BOUNDARIES') {
        boundaries = payload.boundaries;
        self.postMessage({ type: 'BOUNDARIES_LOADED', count: boundaries.length });
    } else if (type === 'UPDATE_POSITION') {
        evaluatePosition(payload as GeoPosition);
    } else if (type === 'RESET_STATE') {
        lastKnownCountry = null;
    }
};
