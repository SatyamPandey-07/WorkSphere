import { loadSanitizerWasm } from '../lib/wasm-loader/sanitizer'; // Reusing WASM loader pattern

let wasmExports: any = null;

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'INIT') {
        // In a real scenario, load the specific audio WASM module
        wasmExports = { ready: true };
        self.postMessage({ type: 'READY' });
    }

    if (type === 'PROCESS_RIR') {
        const { rirData, sampleRate, zoneId } = payload;

        // Simulate WASM call
        const rt60 = calculateRT60JS(rirData, sampleRate); // Fallback/Wrapper

        self.postMessage({
            type: 'RT60_RESULT',
            payload: { zoneId, rt60, timestamp: Date.now() }
        });
    }
};

// JS Fallback/Simulation for the worker context if WASM isn't fully linked in this snippet
function calculateRT60JS(rir: Float32Array, sampleRate: number): number {
    let sum = 0;
    const integrated = new Float64Array(rir.length);
    for (let i = rir.length - 1; i >= 0; i--) {
        sum += rir[i] * rir[i];
        integrated[i] = sum;
    }

    const maxDb = 10 * Math.log10(integrated[0]);
    let t1 = -1, t2 = -1;

    for (let i = 0; i < integrated.length; i++) {
        const db = 10 * Math.log10(integrated[i]) - maxDb;
        if (t1 < 0 && db <= -5) t1 = i / sampleRate;
        if (t2 < 0 && db <= -25) { t2 = i / sampleRate; break; }
    }

    return t1 >= 0 && t2 > t1 ? (t2 - t1) * 3 : 0;
}
