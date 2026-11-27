# WebGPU Capability Report Compatibility & Fallback (`src/lib/webgpu/capabilityReport.ts`)

Documents browser and runtime compatibility for `src/lib/webgpu/capabilityReport.ts`, including fallback behavior when `navigator.gpu` is unavailable across Chromium, Firefox, Safari, and headless/SSR runtimes.

## Compatibility & Fallback Matrix

| Target | `navigator.gpu` Behavior | Report Outcome | Fallback Behavior |
| :--- | :--- | :--- | :--- |
| **Chromium** | Present on supported builds with active GPU/adapter | Reports adapter features and limits when available | Falls back to `supported: false` (WebGL2/CPU path) if unavailable or blocked |
| **Firefox** | Platform- and version-dependent | Reports capability status when enabled and adapter resolves | Falls back to `supported: false` (WebGL2/CPU path) when disabled or unsupported |
| **Safari** | Available on supported Apple OS/Safari versions | Reports capability status when `requestAdapter()` succeeds | Falls back to `supported: false` (WebGL2/CPU path) when absent or null |
| **Headless / SSR** | `navigator` undefined or `navigator.gpu` absent | Guards `navigator` safely without throwing | Returns deterministic `supported: false` fallback report during SSR/headless runs |
