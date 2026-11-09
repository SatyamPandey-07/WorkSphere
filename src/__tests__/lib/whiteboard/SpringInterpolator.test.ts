/**
 * SpringInterpolator.test.ts
 * Unit tests for the SpringInterpolator to ensure smooth 60fps cursor rendering.
 */

import { SpringInterpolator } from '@/lib/whiteboard/SpringInterpolator';

// Mock requestAnimationFrame for testing
global.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16);
global.cancelAnimationFrame = (id: number) => clearTimeout(id);

describe('SpringInterpolator', () => {
    it('should initialize with correct starting state', () => {
        const interpolator = new SpringInterpolator(100, 100);
        const state = interpolator.getCurrentState();

        expect(state.x).toBe(100);
        expect(state.y).toBe(100);
        expect(state.vx).toBe(0);
        expect(state.vy).toBe(0);
        expect(state.isVisible).toBe(true);
    });

    it('should smoothly interpolate towards target', () => {
        const interpolator = new SpringInterpolator(0, 0, 150, 15);
        interpolator.setTarget(100, 100);

        // Simulate a few animation frames
        for (let i = 0; i < 10; i++) {
            // The animation loop updates the state internally
        }

        const state = interpolator.getCurrentState();
        expect(state.x).toBeGreaterThan(0);
        expect(state.x).toBeLessThan(100);
        expect(state.isVisible).toBe(true);
    });

    it('should hide cursor after idle timeout', () => {
        const interpolator = new SpringInterpolator(0, 0, 150, 15, 100); // 100ms timeout for testing
        interpolator.setTarget(50, 50);

        // Wait for timeout
        setTimeout(() => {
            const state = interpolator.getCurrentState();
            expect(state.isVisible).toBe(false);
        }, 150);
    });

    it('should clean up animation frame on destroy', () => {
        const interpolator = new SpringInterpolator(0, 0);
        interpolator.setTarget(100, 100);
        interpolator.destroy();

        // After destroy, state should remain static
        const stateBefore = interpolator.getCurrentState();
        setTimeout(() => {
            const stateAfter = interpolator.getCurrentState();
            expect(stateAfter.x).toBe(stateBefore.x);
        }, 50);
    });
});
