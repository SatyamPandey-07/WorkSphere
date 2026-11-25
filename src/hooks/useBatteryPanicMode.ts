'use client';

import { useState, useEffect, useCallback } from 'react';

export const DEFAULT_PANIC_THRESHOLD_PERCENT = 20;

export interface BatteryManagerLike extends EventTarget {
    charging: boolean;
    chargingTime: number;
    dischargingTime: number;
    level: number;
    addEventListener(
        type: 'levelchange' | 'chargingchange' | 'chargingtimechange' | 'dischargingtimechange',
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions
    ): void;
    removeEventListener(
        type: 'levelchange' | 'chargingchange' | 'chargingtimechange' | 'dischargingtimechange',
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | EventListenerOptions
    ): void;
}

type NavigatorWithBattery = Navigator & {
    getBattery?: () => Promise<BatteryManagerLike>;
};

export interface UseBatteryPanicModeOptions {
    /** Battery percentage threshold at or below which Panic Mode activates (default: 20%) */
    thresholdPercent?: number;
    /** Optional manual override allowing users to toggle Panic Mode explicitly */
    manualOverride?: boolean | null;
}

export interface BatteryPanicModeState {
    isSupported: boolean;
    batteryLevelPercent: number | null;
    isCharging: boolean | null;
    isPanicModeActive: boolean;
    dismissPanicMode: () => void;
    resetDismissal: () => void;
}

/**
 * Monitors device battery status via the Web Battery API to prioritize venues
 * with verified desk power outlets when battery drops below `thresholdPercent` (default 20%).
 * Degrades gracefully without throwing on Safari/Firefox and cleans up all event listeners on unmount.
 */
export function useBatteryPanicMode(
    options: UseBatteryPanicModeOptions = {}
): BatteryPanicModeState {
    const {
        thresholdPercent = DEFAULT_PANIC_THRESHOLD_PERCENT,
        manualOverride = null,
    } = options;

    const [isSupported, setIsSupported] = useState<boolean>(false);
    const [batteryLevelPercent, setBatteryLevelPercent] = useState<number | null>(null);
    const [isCharging, setIsCharging] = useState<boolean | null>(null);
    const [isDismissed, setIsDismissed] = useState<boolean>(false);

    const dismissPanicMode = useCallback(() => {
        setIsDismissed(true);
    }, []);

    const resetDismissal = useCallback(() => {
        setIsDismissed(false);
    }, []);

    useEffect(() => {
        if (
            typeof navigator === 'undefined' ||
            !('getBattery' in navigator) ||
            typeof (navigator as NavigatorWithBattery).getBattery !== 'function'
        ) {
            setIsSupported(false);
            return;
        }

        let isMounted = true;
        let batteryInstance: BatteryManagerLike | null = null;

        const syncBatteryState = (battery: BatteryManagerLike) => {
            if (!isMounted) return;
            const normalizedPercent = Math.round(
                Math.min(1, Math.max(0, battery.level)) * 100
            );
            setBatteryLevelPercent(normalizedPercent);
            setIsCharging(Boolean(battery.charging));
        };

        const handleLevelChange = () => {
            if (batteryInstance) {
                syncBatteryState(batteryInstance);
            }
        };

        const handleChargingChange = () => {
            if (batteryInstance) {
                syncBatteryState(batteryInstance);
            }
        };

        (navigator as NavigatorWithBattery)
            .getBattery!()
            .then((battery) => {
                if (!isMounted) {
                    return;
                }

                batteryInstance = battery;
                setIsSupported(true);
                syncBatteryState(battery);

                battery.addEventListener('levelchange', handleLevelChange);
                battery.addEventListener('chargingchange', handleChargingChange);
            })
            .catch(() => {
                if (isMounted) {
                    setIsSupported(false);
                }
            });

        return () => {
            isMounted = false;
            if (batteryInstance) {
                batteryInstance.removeEventListener('levelchange', handleLevelChange);
                batteryInstance.removeEventListener('chargingchange', handleChargingChange);
                batteryInstance = null;
            }
        };
    }, []);

    const autoTriggered =
        isSupported &&
        batteryLevelPercent !== null &&
        batteryLevelPercent <= thresholdPercent &&
        isCharging === false;

    const isPanicModeActive =
        manualOverride !== null
            ? manualOverride
            : autoTriggered && !isDismissed;

    return {
        isSupported,
        batteryLevelPercent,
        isCharging,
        isPanicModeActive,
        dismissPanicMode,
        resetDismissal,
    };
}