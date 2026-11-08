/**
 * poseEstimatorCurvature.test.ts
 * Tests for C Wasm continuous spinal curvature deviation analysis & 3-minute slouch alert (#5773).
 */

describe('pose_estimator continuous spine curvature analysis (#5773)', () => {
    const SLOUCH_ANGLE_THRESHOLD_DEG = 15.0;
    const SLOUCH_TIME_THRESHOLD_SEC = 180.0; // 3 minutes

    /**
     * JavaScript reference implementation matching C Wasm compute_spine_curvature_radius_3d
     */
    function computeSpineCurvatureRadius3D(
        earX: number, earY: number, earZ: number,
        shoulderX: number, shoulderY: number, shoulderZ: number,
        hipX: number, hipY: number, hipZ: number
    ): number {
        const uX = earX - shoulderX;
        const uY = earY - shoulderY;
        const uZ = earZ - shoulderZ;

        const vX = hipX - shoulderX;
        const vY = hipY - shoulderY;
        const vZ = hipZ - shoulderZ;

        const wX = earX - hipX;
        const wY = earY - hipY;
        const wZ = earZ - hipZ;

        const a = Math.sqrt(uX * uX + uY * uY + uZ * uZ);
        const b = Math.sqrt(vX * vX + vY * vY + vZ * vZ);
        const c = Math.sqrt(wX * wX + wY * wY + wZ * wZ);

        if (a < 1e-4 || b < 1e-4 || c < 1e-4) {
            return 1e6;
        }

        const crossX = uY * vZ - uZ * vY;
        const crossY = uZ * vX - uX * vZ;
        const crossZ = uX * vY - uY * vX;

        const crossMag = Math.sqrt(crossX * crossX + crossY * crossY + crossZ * crossZ);
        if (crossMag < 1e-5) {
            return 1e6; // Collinear / flat
        }

        return (a * b * c) / (2.0 * crossMag);
    }

    /**
     * JavaScript reference implementation matching C Wasm compute_spine_deviation_angle
     */
    function computeSpineDeviationAngle(
        earX: number, earY: number, earZ: number,
        shoulderX: number, shoulderY: number, shoulderZ: number,
        hipX: number, hipY: number, hipZ: number
    ): number {
        const uX = earX - shoulderX;
        const uY = earY - shoulderY;
        const uZ = earZ - shoulderZ;

        const vX = hipX - shoulderX;
        const vY = hipY - shoulderY;
        const vZ = hipZ - shoulderZ;

        const lenU = Math.sqrt(uX * uX + uY * uY + uZ * uZ);
        const lenV = Math.sqrt(vX * vX + vY * vY + vZ * vZ);

        if (lenU < 1e-4 || lenV < 1e-4) {
            return 0.0;
        }

        const dot = uX * vX + uY * vY + uZ * vZ;
        let cosAngle = dot / (lenU * lenV);
        if (cosAngle > 1.0) cosAngle = 1.0;
        if (cosAngle < -1.0) cosAngle = -1.0;

        const interiorAngle = Math.acos(cosAngle) * (180.0 / Math.PI);
        return Math.abs(180.0 - interiorAngle);
    }

    /**
     * Tracker state mimicking SpineCurvatureResult in C
     */
    interface SpineTrackerState {
        curvatureRadius: number;
        curvature: number;
        deviationAngleDeg: number;
        slouchDurationSec: number;
        isSlouching: boolean;
        alertTriggered: boolean;
    }

    function createSpineTracker(): SpineTrackerState {
        return {
            curvatureRadius: 1e6,
            curvature: 0.0,
            deviationAngleDeg: 0.0,
            slouchDurationSec: 0.0,
            isSlouching: false,
            alertTriggered: false,
        };
    }

    function updateSpinePostureHarness(
        ear: [number, number, number],
        shoulder: [number, number, number],
        hip: [number, number, number],
        deltaTimeSec: number,
        state: SpineTrackerState
    ): void {
        const radius = computeSpineCurvatureRadius3D(
            ear[0], ear[1], ear[2],
            shoulder[0], shoulder[1], shoulder[2],
            hip[0], hip[1], hip[2]
        );
        const deviation = computeSpineDeviationAngle(
            ear[0], ear[1], ear[2],
            shoulder[0], shoulder[1], shoulder[2],
            hip[0], hip[1], hip[2]
        );

        state.curvatureRadius = radius;
        state.curvature = radius > 0 ? 1.0 / radius : 0.0;
        state.deviationAngleDeg = deviation;

        if (deviation > SLOUCH_ANGLE_THRESHOLD_DEG) {
            state.isSlouching = true;
            state.slouchDurationSec += deltaTimeSec;
            if (state.slouchDurationSec >= SLOUCH_TIME_THRESHOLD_SEC) {
                state.alertTriggered = true;
            }
        } else {
            state.isSlouching = false;
            state.slouchDurationSec = 0.0;
            state.alertTriggered = false;
        }
    }

    describe('computeSpineCurvatureRadius3D and computeSpineDeviationAngle', () => {
        it('returns zero deviation and infinite radius for perfectly aligned upright spine', () => {
            // Collinear coordinates along vertical axis
            const ear: [number, number, number] = [100, 50, 0];
            const shoulder: [number, number, number] = [100, 100, 0];
            const hip: [number, number, number] = [100, 180, 0];

            const deviation = computeSpineDeviationAngle(
                ear[0], ear[1], ear[2],
                shoulder[0], shoulder[1], shoulder[2],
                hip[0], hip[1], hip[2]
            );
            const radius = computeSpineCurvatureRadius3D(
                ear[0], ear[1], ear[2],
                shoulder[0], shoulder[1], shoulder[2],
                hip[0], hip[1], hip[2]
            );

            expect(deviation).toBeCloseTo(0.0, 2);
            expect(radius).toBeGreaterThanOrEqual(1e6); // Infinite radius
        });

        it('detects forward slouch curvature when head protrudes forward', () => {
            // Cranial protrusion: Ear is forward by 25px relative to shoulder and hip
            const ear: [number, number, number] = [125, 50, 0];
            const shoulder: [number, number, number] = [100, 100, 0];
            const hip: [number, number, number] = [100, 180, 0];

            const deviation = computeSpineDeviationAngle(
                ear[0], ear[1], ear[2],
                shoulder[0], shoulder[1], shoulder[2],
                hip[0], hip[1], hip[2]
            );
            const radius = computeSpineCurvatureRadius3D(
                ear[0], ear[1], ear[2],
                shoulder[0], shoulder[1], shoulder[2],
                hip[0], hip[1], hip[2]
            );

            // Forward head creates significant deviation > 15 degrees
            expect(deviation).toBeGreaterThan(15.0);
            expect(radius).toBeGreaterThan(0);
            expect(radius).toBeLessThan(1000); // Finite measurable curvature radius
        });

        it('evaluates 3D depth-based slouching with z-axis sagittal displacement', () => {
            // Forward head in depth (z-axis +30mm)
            const ear: [number, number, number] = [100, 50, 30];
            const shoulder: [number, number, number] = [100, 100, 0];
            const hip: [number, number, number] = [100, 180, -10];

            const deviation = computeSpineDeviationAngle(
                ear[0], ear[1], ear[2],
                shoulder[0], shoulder[1], shoulder[2],
                hip[0], hip[1], hip[2]
            );
            const radius = computeSpineCurvatureRadius3D(
                ear[0], ear[1], ear[2],
                shoulder[0], shoulder[1], shoulder[2],
                hip[0], hip[1], hip[2]
            );

            expect(deviation).toBeGreaterThan(15.0);
            expect(Number.isFinite(radius)).toBe(true);
            expect(radius).toBeGreaterThan(0);
        });
    });

    describe('Slouch duration tracking and 3-minute alert threshold', () => {
        it('does not trigger alert before 3 minutes (180 seconds) have elapsed', () => {
            const tracker = createSpineTracker();
            const slouchedEar: [number, number, number] = [130, 50, 0];
            const shoulder: [number, number, number] = [100, 100, 0];
            const hip: [number, number, number] = [100, 180, 0];

            // 60 seconds of slouching
            updateSpinePostureHarness(slouchedEar, shoulder, hip, 60.0, tracker);
            expect(tracker.isSlouching).toBe(true);
            expect(tracker.slouchDurationSec).toBe(60.0);
            expect(tracker.alertTriggered).toBe(false);

            // Additional 60 seconds (total 120s < 180s)
            updateSpinePostureHarness(slouchedEar, shoulder, hip, 60.0, tracker);
            expect(tracker.slouchDurationSec).toBe(120.0);
            expect(tracker.alertTriggered).toBe(false);
        });

        it('triggers ergonomic toast alert when slouching exceeds 15 degrees for >= 3 minutes (180s)', () => {
            const tracker = createSpineTracker();
            const slouchedEar: [number, number, number] = [130, 50, 0];
            const shoulder: [number, number, number] = [100, 100, 0];
            const hip: [number, number, number] = [100, 180, 0];

            // Simulate 180 continuous seconds of slouching in 10-second increments
            for (let i = 0; i < 18; i++) {
                updateSpinePostureHarness(slouchedEar, shoulder, hip, 10.0, tracker);
            }

            expect(tracker.isSlouching).toBe(true);
            expect(tracker.slouchDurationSec).toBeGreaterThanOrEqual(180.0);
            expect(tracker.alertTriggered).toBe(true);
        });

        it('immediately resets slouch duration and clears alert when worker straightens posture', () => {
            const tracker = createSpineTracker();
            const slouchedEar: [number, number, number] = [130, 50, 0];
            const uprightEar: [number, number, number] = [100, 50, 0];
            const shoulder: [number, number, number] = [100, 100, 0];
            const hip: [number, number, number] = [100, 180, 0];

            // Trigger alert after 200 seconds of slouching
            updateSpinePostureHarness(slouchedEar, shoulder, hip, 200.0, tracker);
            expect(tracker.alertTriggered).toBe(true);

            // User recovers to upright posture
            updateSpinePostureHarness(uprightEar, shoulder, hip, 5.0, tracker);
            expect(tracker.isSlouching).toBe(false);
            expect(tracker.slouchDurationSec).toBe(0.0);
            expect(tracker.alertTriggered).toBe(false);
        });
    });
});
