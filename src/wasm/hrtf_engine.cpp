/**
 * WebAssembly HRTF (Head-Related Transfer Function) Spatial Audio Engine
 *
 * Real-time 3D binaural audio processing using FIR filter convolution,
 * Interaural Time Difference (ITD), Interaural Level Difference (ILD),
 * and inverse distance attenuation.
 *
 * Compiled with Emscripten SIMD flags (-msimd128) for vectorized audio processing.
 *
 * File Location: src/wasm/hrtf_engine.cpp
 */

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <wasm_simd128.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846f
#endif

#define HRTF_FILTER_LENGTH 64
#define MAX_BLOCK_SIZE 1024
#define SAMPLE_RATE 48000
#define SPEED_OF_SOUND 343.0f // meters / second
#define HEAD_RADIUS 0.0875f   // ~8.75 cm average human head radius

// Static memory buffers for overlap-add state
static float left_overlap[HRTF_FILTER_LENGTH];
static float right_overlap[HRTF_FILTER_LENGTH];

// Runtime SIMD toggle for ARM32 / non-SIMD fallback support
static int simd_enabled = 1;

// Default minimum reference distance for 1/r inverse distance model
static float ref_distance = 1.0f;
static float max_distance = 100.0f;

// ─── Synthetic HRTF Impulse Response Generator ────────────────────────────────
/**
 * Computes synthetic left and right ear HRTF FIR impulse response filters
 * for a given azimuth (-180 to +180 deg) and elevation (-90 to +90 deg).
 */
static void compute_hrtf_impulse_response(
    float azimuth_deg,
    float elevation_deg,
    float* hrtf_left,
    float* hrtf_right
) {
    float azimuth_rad = azimuth_deg * (M_PI / 180.0f);
    float elevation_rad = elevation_deg * (M_PI / 180.0f);

    // Woodworth ITD model: ITD = (r/c) * (sin(azimuth) + azimuth)
    float itd_seconds = (HEAD_RADIUS / SPEED_OF_SOUND) * (sinf(azimuth_rad) + azimuth_rad);
    float itd_samples = itd_seconds * SAMPLE_RATE;

    // ILD scaling factor based on azimuth (-1 to +1)
    float ild_left = 0.5f * (1.0f - sinf(azimuth_rad));
    float ild_right = 0.5f * (1.0f + sinf(azimuth_rad));

    // Elevation damping factor
    float elevation_gain = cosf(elevation_rad * 0.5f);

    for (int i = 0; i < HRTF_FILTER_LENGTH; i++) {
        float t = (float)i - (HRTF_FILTER_LENGTH / 2.0f);
        
        // Sinc pulse centered with ITD offset for left ear
        float t_left = t - (itd_samples * 0.5f);
        float sinc_left = (t_left == 0.0f) ? 1.0f : sinf(M_PI * t_left) / (M_PI * t_left);
        
        // Sinc pulse centered with ITD offset for right ear
        float t_right = t + (itd_samples * 0.5f);
        float sinc_right = (t_right == 0.0f) ? 1.0f : sinf(M_PI * t_right) / (M_PI * t_right);

        // Window with Hann window
        float window = 0.5f * (1.0f - cosf(2.0f * M_PI * (float)i / (float)(HRTF_FILTER_LENGTH - 1)));

        hrtf_left[i] = sinc_left * ild_left * elevation_gain * window;
        hrtf_right[i] = sinc_right * ild_right * elevation_gain * window;
    }
}

// ─── Direct Time-Domain SIMD FIR Convolution ──────────────────────────────────
static void convolve_fir_simd(
    const float* input,
    int num_samples,
    const float* filter,
    int filter_length,
    float* output,
    float* overlap
) {
    for (int n = 0; n < num_samples; n++) {
        float sum = 0.0f;
        v128_t sum_v = wasm_f32x4_splat(0.0f);

        int k = 0;
        for (; k <= filter_length - 4; k += 4) {
            if (n - k >= 3) {
                // Vectorized multiplication when 4 input samples are available
                v128_t in_v = wasm_v128_load(&input[n - k - 3]);
                v128_t filt_v = wasm_v128_load(&filter[k]);
                sum_v = wasm_f32x4_add(sum_v, wasm_f32x4_mul(in_v, filt_v));
            } else {
                for (int scalar_k = k; scalar_k < k + 4; scalar_k++) {
                    if (n - scalar_k >= 0) {
                        sum += input[n - scalar_k] * filter[scalar_k];
                    }
                }
            }
        }

        // Add SIMD vector accumulators
        float temp[4];
        wasm_v128_store(temp, sum_v);
        sum += temp[0] + temp[1] + temp[2] + temp[3];

        for (; k < filter_length; k++) {
            if (n - k >= 0) {
                sum += input[n - k] * filter[k];
            }
        }

        output[n] = sum;
    }

    // Add previous block's overlap
    for (int i = 0; i < filter_length && i < num_samples; i++) {
        output[i] += overlap[i];
    }

    // Save current block's overlap tail
    for (int i = 0; i < filter_length; i++) {
        float tail_sum = 0.0f;
        for (int k = i + 1; k < filter_length; k++) {
            int idx = num_samples - 1 - (k - i - 1);
            if (idx >= 0 && idx < num_samples) {
                tail_sum += input[idx] * filter[k];
            }
        }
        overlap[i] = tail_sum;
    }
}

// ─── Scalar FIR Convolution Fallback ──────────────────────────────────────────
static void convolve_fir_scalar(
    const float* input,
    int num_samples,
    const float* filter,
    int filter_length,
    float* output,
    float* overlap
) {
    for (int n = 0; n < num_samples; n++) {
        float sum = 0.0f;
        for (int k = 0; k < filter_length; k++) {
            if (n - k >= 0) {
                sum += input[n - k] * filter[k];
            }
        }
        output[n] = sum;
    }

    for (int i = 0; i < filter_length && i < num_samples; i++) {
        output[i] += overlap[i];
    }

    for (int i = 0; i < filter_length; i++) {
        float tail_sum = 0.0f;
        for (int k = i + 1; k < filter_length; k++) {
            int idx = num_samples - 1 - (k - i - 1);
            if (idx >= 0 && idx < num_samples) {
                tail_sum += input[idx] * filter[k];
            }
        }
        overlap[i] = tail_sum;
    }
}

// ─── Exported C WebAssembly API Functions ─────────────────────────────────────

extern "C" {

/**
 * Allocates a 16-byte aligned scratch buffer in the WebAssembly heap
 * for passing audio PCM data between JS/AudioWorklet and WebAssembly.
 */
__attribute__((used))
void* malloc_scratch_buffer(int size_bytes) {
    if (size_bytes <= 0) return nullptr;
    // 16-byte aligned allocation for SIMD vector loads
    void* ptr = nullptr;
    if (posix_memalign(&ptr, 16, (size_t)size_bytes) != 0) {
        return malloc((size_t)size_bytes);
    }
    if (ptr) {
        std::memset(ptr, 0, (size_t)size_bytes);
    }
    return ptr;
}

/**
 * Frees a scratch buffer previously allocated on the WebAssembly heap.
 */
__attribute__((used))
void free_scratch_buffer(void* ptr) {
    if (ptr) {
        free(ptr);
    }
}

/**
 * Enables or disables SIMD vectorization at runtime.
 */
__attribute__((used))
void set_hrtf_simd_enabled(int enabled) {
    simd_enabled = enabled ? 1 : 0;
}

/**
 * Main HRTF Processing Entrypoint
 *
 * Processes a mono PCM input block and writes binaural (left & right) spatialized audio
 * using HRTF impulse response FIR convolution, ITD/ILD panning, and distance attenuation.
 *
 * @param input Pointer to mono Float32 input samples in WASM heap
 * @param left_output Pointer to left ear Float32 output buffer in WASM heap
 * @param right_output Pointer to right ear Float32 output buffer in WASM heap
 * @param num_samples Number of audio samples in the block (e.g. 128 or 256)
 * @param azimuth Horizontal angle relative to head (-180 to +180 degrees)
 * @param elevation Vertical angle relative to head (-90 to +90 degrees)
 * @param distance Distance from listener in meters (> 0)
 */
__attribute__((used))
int process_hrtf_block(
    const float* input,
    float* left_output,
    float* right_output,
    int num_samples,
    float azimuth,
    float elevation,
    float distance
) {
    if (!input || !left_output || !right_output || num_samples <= 0) {
        return -1;
    }

    if (num_samples > MAX_BLOCK_SIZE) {
        num_samples = MAX_BLOCK_SIZE;
    }

    // Distance attenuation (Inverse Distance Model: gain = ref_dist / dist)
    float safe_distance = (distance < ref_distance) ? ref_distance : distance;
    if (safe_distance > max_distance) safe_distance = max_distance;
    float dist_gain = ref_distance / safe_distance;

    // Generate HRTF FIR filter coefficients for left & right ears
    float hrtf_left[HRTF_FILTER_LENGTH];
    float hrtf_right[HRTF_FILTER_LENGTH];
    compute_hrtf_impulse_response(azimuth, elevation, hrtf_left, hrtf_right);

    // Apply HRTF FIR convolution
    if (simd_enabled) {
        convolve_fir_simd(input, num_samples, hrtf_left, HRTF_FILTER_LENGTH, left_output, left_overlap);
        convolve_fir_simd(input, num_samples, hrtf_right, HRTF_FILTER_LENGTH, right_output, right_overlap);
    } else {
        convolve_fir_scalar(input, num_samples, hrtf_left, HRTF_FILTER_LENGTH, left_output, left_overlap);
        convolve_fir_scalar(input, num_samples, hrtf_right, HRTF_FILTER_LENGTH, right_output, right_overlap);
    }

    // Scale binaural outputs by inverse distance attenuation gain
    for (int i = 0; i < num_samples; i++) {
        left_output[i] *= dist_gain;
        right_output[i] *= dist_gain;
    }

    return 0;
}

} // extern "C"
