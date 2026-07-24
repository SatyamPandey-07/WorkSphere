// prettier-ignore
// @ts-expect-error - wasm module might not be built yet
import init, { calculate_heat_diffusion } from "../../wasm/heat-diffusion/pkg/heat_diffusion.js";

let wasmLoaded = false;
let loadError: any = null;
let outputBuffer: Float32Array | null = null;

async function loadWasm() {
  try {
    await init();
    wasmLoaded = true;
  } catch (err) {
    loadError = err;
    console.error(
      "Failed to load WASM noise diffusion module, falling back to JS",
      err,
    );
  }
}

// Start loading immediately
loadWasm();

function calculateHeatJS(
  input: Float32Array,
  output: Float32Array,
  width: number,
  height: number,
  alpha: number,
  dt: number,
  ambient: number,
  sensors_flat: Float32Array | number[],
) {
  const w = width;
  const h = height;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const xl = x === 0 ? x : x - 1;
      const xr = x + 1 >= w ? x : x + 1;
      const yd = y === 0 ? y : y - 1;
      const yu = y + 1 >= h ? y : y + 1;

      const c = input[idx];
      const lap =
        input[y * w + xl] +
        input[y * w + xr] +
        input[yd * w + x] +
        input[yu * w + x] -
        4.0 * c;

      let next = c + alpha * dt * lap;
      next = next + (ambient - next) * 0.002;
      output[idx] = next;
    }
  }

  // Apply sensors
  let i = 0;
  while (i + 2 < sensors_flat.length) {
    const sx = Math.floor(sensors_flat[i]);
    const sy = Math.floor(sensors_flat[i + 1]);
    const temp = sensors_flat[i + 2];

    if (sx < w && sy < h) {
      output[sy * w + sx] = temp;
    }

    i += 3;
  }
}

self.onmessage = async (e) => {
  const { id, input, width, height, alpha, dt, ambient, sensors_flat } = e.data;

  if (!wasmLoaded && !loadError) {
    // Still loading, wait for it
    await loadWasm();
  }

  try {
    if (!outputBuffer || outputBuffer.length !== width * height) {
      outputBuffer = new Float32Array(width * height);
    }

    if (wasmLoaded) {
      calculate_heat_diffusion(
        input,
        outputBuffer,
        width,
        height,
        alpha,
        dt,
        ambient,
        sensors_flat,
      );
    } else {
      calculateHeatJS(
        input,
        outputBuffer,
        width,
        height,
        alpha,
        dt,
        ambient,
        sensors_flat,
      );
    }

    self.postMessage({ id, output: outputBuffer });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message });
  }
};
