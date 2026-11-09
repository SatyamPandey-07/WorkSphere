/**
 * Astronomy Worker
 * Pre-calculates and caches solar ephemeris data for the next 24 hours to ensure instant map filtering.
 */

import { SunTrajectoryCalculator, GeoLocation, SolarPosition } from '../core/spatial/SunTrajectoryCalculator';
import { GlarePredictionEngine, DeskBoundingBox, WindowPolygon, GlareResult } from '../core/spatial/GlarePredictionEngine';

interface CalculateRequest {
    type: 'CALCULATE_GLARE_MATRIX';
    location: GeoLocation;
    desks: DeskBoundingBox[];
    windows: WindowPolygon[];
    date: string; // ISO string
}

interface CalculateResult {
    type: 'GLARE_MATRIX_READY';
    matrix: Record<string, GlareResult[]>; // deskId -> array of hourly results
}

const sunCalc = new SunTrajectoryCalculator();
const glareEngine = new GlarePredictionEngine();

self.onmessage = (event: MessageEvent<CalculateRequest>) => {
    if (event.data.type === 'CALCULATE_GLARE_MATRIX') {
        const { location, desks, windows, date } = event.data;
        const baseDate = new Date(date);

        // Get trajectory at 30-minute intervals
        const trajectory = sunCalc.getTrajectory(location, baseDate, 30);

        const matrix: Record<string, GlareResult[]> = {};

        // Initialize matrix
        for (const desk of desks) {
            matrix[desk.deskId] = [];
        }

        // Calculate glare for each time step
        for (const sunPos of trajectory) {
            const results = glareEngine.predictGlare(desks, windows, sunPos);

            for (const res of results) {
                matrix[res.deskId].push(res);
            }
        }

        const response: CalculateResult = {
            type: 'GLARE_MATRIX_READY',
            matrix
        };

        self.postMessage(response);
    }
};

export { };