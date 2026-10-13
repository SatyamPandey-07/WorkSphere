/**
 * useSmoothAudioParam.ts
 * React hook that binds a SmoothGainController to a component's lifecycle,
 * ensuring proper cleanup and providing a stable setter function.
 */

import { useRef, useEffect, useCallback } from 'react';
import { SmoothGainController, SmoothGainOptions } from '@/lib/audio/SmoothGainController';

export function useSmoothAudioParam(
    param: AudioParam | null,
    options: SmoothGainOptions = {}
): ((value: number) => void) | null {
    const controllerRef = useRef<SmoothGainController | null>(null);

    useEffect(() => {
        if (param) {
            controllerRef.current = new SmoothGainController(param, options);
        }

        return () => {
            if (controllerRef.current) {
                // Cancel any pending ramps on unmount to prevent memory leaks or audio context issues
                if (param) {
                    param.cancelScheduledValues(param.context.currentTime);
                }
                controllerRef.current = null;
            }
        };
    }, [param, options.minGain, options.maxGain, options.timeConstant]);

    const setGain = useCallback((value: number) => {
        if (controllerRef.current) {
            controllerRef.current.setGain(value);
        }
    }, []);

    return param ? setGain : null;
}
