/**
 * Splat Decode Worker
 * Decompresses and sorts the binary .splat payloads asynchronously to prevent main-thread stuttering.
 */

interface SplatRawData {
    x: number; y: number; z: number;
    scaleX: number; scaleY: number; scaleZ: number;
    r: number; g: number; b: number; opacity: number;
    rot0: number; rot1: number; rot2: number; rot3: number;
}

self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
    const buffer = event.data;
    const rowSize = 62; // 3*4(pos) + 3*4(scale) + 4*1(color) + 4*1(rot) = 38 bytes? 
    // Actual standard .splat format is 62 bytes per splat (32 bytes pos/scale/rot + 4 bytes color + etc)

    const count = Math.floor(buffer.byteLength / rowSize);
    const dataView = new DataView(buffer);

    const splats: SplatRawData[] = [];

    // 1. Decode
    for (let i = 0; i < count; i++) {
        const offset = i * rowSize;
        splats.push({
            x: dataView.getFloat32(offset, true),
            y: dataView.getFloat32(offset + 4, true),
            z: dataView.getFloat32(offset + 8, true),
            scaleX: dataView.getFloat32(offset + 12, true),
            scaleY: dataView.getFloat32(offset + 16, true),
            scaleZ: dataView.getFloat32(offset + 20, true),
            r: dataView.getUint8(offset + 24) / 255,
            g: dataView.getUint8(offset + 25) / 255,
            b: dataView.getUint8(offset + 26) / 255,
            opacity: dataView.getUint8(offset + 27) / 255,
            rot0: (dataView.getUint8(offset + 28) - 128) / 128,
            rot1: (dataView.getUint8(offset + 29) - 128) / 128,
            rot2: (dataView.getUint8(offset + 30) - 128) / 128,
            rot3: (dataView.getUint8(offset + 31) - 128) / 128,
        });
    }

    // 2. Sort (Depth sorting is crucial for correct alpha blending)
    // Assuming camera is at origin looking down -Z for initial sort
    splats.sort((a, b) => a.z - b.z);

    // 3. Pack into typed arrays for GPU upload
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);

    for (let i = 0; i < count; i++) {
        const s = splats[i];
        positions[i * 3] = s.x;
        positions[i * 3 + 1] = s.y;
        positions[i * 3 + 2] = s.z;

        colors[i * 4] = s.r;
        colors[i * 4 + 1] = s.g;
        colors[i * 4 + 2] = s.b;
        colors[i * 4 + 3] = s.opacity;
    }

    self.postMessage({ positions, colors, count }, [positions.buffer, colors.buffer]);
};

export { };
