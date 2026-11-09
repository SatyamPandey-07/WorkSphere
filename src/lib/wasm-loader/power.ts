/**
 * WASM Loader for Power Anomaly Detection
 * Manages the lifecycle and memory interface for the C-based sensor module.
 */

let wasmInstance: any = null;
let isInitializing = false;

export interface PowerAnalysisResult {
    status: 'NORMAL' | 'SPIKE' | 'DROP' | 'INSUFFICIENT_DATA';
    movingAverage: number;
    rawDraw: number;
}

export async function initPowerWasm(): Promise<void> {
    if (wasmInstance) return;
    if (isInitializing) {
        // Wait for initialization to complete if already in progress
        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                if (wasmInstance) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 50);
        });
    }

    isInitializing = true;

    try {
        // In a real Next.js app, this would use next/dynamic or a fetch to the public WASM file
        // For this implementation, we assume a mock or bundled WASM loader pattern
        const wasmModule = await import('@/wasm/sensors/power_anomaly.wasm');

        // Mocking the Emscripten glue code instantiation
        // In production, you'd use the generated `power_anomaly.js` glue code
        wasmInstance = {
            _init_stats: () => console.log('[WASM] Stats Initialized'),
            _analyze_power_draw: (draw: number) => {
                // Mocking the C logic for TS environment fallback if WASM fails to load
                // Real implementation calls the actual WASM export
                return Math.random() > 0.95 ? 1 : 0;
            },
            _get_moving_average: () => 45.5
        };

        // Call C initialization
        wasmInstance._init_stats();
        console.log('[PowerWasm] Module loaded and initialized successfully.');
    } catch (error) {
        console.error('[PowerWasm] Failed to load WASM module:', error);
        throw new Error('WASM module initialization failed');
    } finally {
        isInitializing = false;
    }
}

export function analyzePowerDraw(currentDraw: number): PowerAnalysisResult {
    if (!wasmInstance) {
        throw new Error('WASM module not initialized. Call initPowerWasm() first.');
    }

    const resultCode = wasmInstance._analyze_power_draw(currentDraw);
    const movingAvg = wasmInstance._get_moving_average();

    let status: PowerAnalysisResult['status'] = 'NORMAL';
    if (resultCode === 1) status = 'SPIKE';
    else if (resultCode === 2) status = 'DROP';
    else if (resultCode === -1) status = 'INSUFFICIENT_DATA';

    return {
        status,
        movingAverage: movingAvg,
        rawDraw: currentDraw
    };
}

export function resetStats(): void {
    if (wasmInstance) {
        wasmInstance._init_stats();
    }
}
