/**
 * @file EtiquetteGraph.ts
 * @description Manages a structured database of regional cafe norms, tipping laws, 
 * and social expectations mapped to specific geolocations. Provides fast lookup 
 * for cultural context based on ISO country codes and venue types.
 */

export interface CulturalNorm {
    id: string;
    countryCode: string;
    venueType: 'cafe' | 'coworking' | 'library' | 'restaurant';
    category: 'tipping' | 'noise' | 'seating' | 'ordering' | 'general';
    title: string;
    description: string;
    severity: 'info' | 'warning' | 'critical';
}

export interface GeoBoundary {
    countryCode: string;
    polygon: [number, number][]; // [lng, lat]
}

export class EtiquetteGraph {
    private norms: Map<string, CulturalNorm[]>;
    private boundaries: GeoBoundary[];

    constructor() {
        this.norms = new Map();
        this.boundaries = [];
        this.loadDefaultNorms();
    }

    public addNorm(norm: CulturalNorm): void {
        const key = `${norm.countryCode}_${norm.venueType}`;
        if (!this.norms.has(key)) {
            this.norms.set(key, []);
        }
        this.norms.get(key)!.push(norm);
    }

    public addBoundary(boundary: GeoBoundary): void {
        this.boundaries.push(boundary);
    }

    public getNorms(countryCode: string, venueType: string): CulturalNorm[] {
        const key = `${countryCode}_${venueType}`;
        return this.norms.get(key) || [];
    }

    public getCountryForCoordinates(lat: number, lng: number): string | null {
        for (const boundary of this.boundaries) {
            if (this.isPointInPolygon([lng, lat], boundary.polygon)) {
                return boundary.countryCode;
            }
        }
        return null;
    }

    private isPointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
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

    private loadDefaultNorms(): void {
        const defaults: CulturalNorm[] = [
            {
                id: 'jp_cafe_noise',
                countryCode: 'JP',
                venueType: 'cafe',
                category: 'noise',
                title: 'Quiet Atmosphere',
                description: 'Japanese cafes are typically very quiet. Avoid loud phone calls or conversations.',
                severity: 'warning',
            },
            {
                id: 'us_cafe_tipping',
                countryCode: 'US',
                venueType: 'cafe',
                category: 'tipping',
                title: 'Tipping Expected',
                description: 'A 15-20% tip is standard for table service or complex coffee orders in the US.',
                severity: 'info',
            },
            {
                id: 'it_cafe_ordering',
                countryCode: 'IT',
                venueType: 'cafe',
                category: 'ordering',
                title: 'Stand at the Bar',
                description: 'In Italy, drinking coffee at the bar is significantly cheaper than sitting at a table.',
                severity: 'info',
            },
            {
                id: 'fr_cafe_seating',
                countryCode: 'FR',
                venueType: 'cafe',
                category: 'seating',
                title: 'Table Reservations',
                description: 'Popular Parisian cafes often require you to wait to be seated by a waiter.',
                severity: 'info',
            },
        ];

        for (const norm of defaults) {
            this.addNorm(norm);
        }
    }
}
