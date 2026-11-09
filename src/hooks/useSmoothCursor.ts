/**
 * useSmoothCursor.ts
 * React hook that manages a SpringInterpolator instance for a specific remote user's cursor,
 * handling lifecycle and providing smooth interpolated coordinates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { SpringInterpolator, CursorState } from '@/lib/whiteboard/SpringInterpolator';

export function useSmoothCursor(
    userId: string,
    initialX: number,
    initialY: number,
    tension: number = 150,
    friction: number = 15
) {
    const [state, setState] = useState<CursorState>({
        x: initialX,
        y: initialY,
        vx: 0,
        vy: 0,
        targetX: initialX,
        targetY: initialY,
        isVisible: true,
        lastUpdate: Date.now(),
    });

    const interpolatorRef = useRef<SpringInterpolator | null>(null);

    useEffect(() => {
        interpolatorRef.current = new SpringInterpolator(initialX, initialY, tension, friction);

        const interval = setInterval(() => {
            if (interpolatorRef.current) {
                setState(interpolatorRef.current.getCurrentState());
            }
        }, 16); // ~60fps sync with React state

        return () => {
            clearInterval(interval);
            if (interpolatorRef.current) {
                interpolatorRef.current.destroy();
            }
        };
    }, [userId, initialX, initialY, tension, friction]);

    const setTarget = useCallback((x: number, y: number) => {
        if (interpolatorRef.current) {
            interpolatorRef.current.setTarget(x, y);
        }
    }, []);

    const hide = useCallback(() => {
        if (interpolatorRef.current) {
            interpolatorRef.current.hide();
        }
    }, []);

    return { state, setTarget, hide };
}
