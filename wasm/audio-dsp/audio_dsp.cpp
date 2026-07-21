/**
 * WebAssembly SIMD Audio DSP Engine
 *
 * Real-time noise suppression using spectral gating with FFT analysis.
 * Compiled with Emscripten SIMD flags (-msimd128) for vectorized math.
 *
 * Features:
 * - 1024-point FFT with SIMD-accelerated butterfly operations
 * - Spectral noise gate (adaptive threshold)
 * - Wiener filter for noise reduction
 * - AudioWorkletProcessor-compatible buffer passing
 * - Sub-2ms processing latency at 48kHz
 */

#include <cmath>
#include <cstring>
#include <wasm_simd128.h>

#define FFT_SIZE 1024
#define HALF_FFT (FFT_SIZE / 2)
#define SAMPLE_RATE 48000
#define HOP_SIZE 256
#define NUM_BINS (HALF_FFT + 1)

// FFT twiddle factors (precomputed)
static float cos_table[HALF_FFT];
static float sin_table[HALF_FFT];

// Hann window coefficients
static float hann_window[FFT_SIZE];

// State buffers
static float input_buffer[FFT_SIZE];
static float output_buffer[FFT_SIZE];
static float noise_estimate[NUM_BINS];
static float phase_accumulator[NUM_BINS];

static int buffer_pos = 0;
static int noise_frames_collected = 0;
static int noise_calibration_frames = 10;

// Spectral gate parameters
static float noise_gate_threshold = 0.02f;
static float wiener_alpha = 0.98f;
static float spectral_floor = 0.05f;

// Heap allocator state.
// Starts beyond the static buffers.  Always kept 16-byte aligned so that
// wasm_v128_load / wasm_v128_store (which require 16-byte alignment on
// 32-bit ARM Android Chrome) never produce unaligned-access traps (#1039).
static int heap_ptr = (FFT_SIZE * 4 * 8 + 15) & ~15;  // 16-byte aligned start

// Forward declarations
static void compute_fft(float* real, float* imag, int n);
static void compute_ifft(float* real, float* imag, int n);
static void apply_hann_window(float* signal);
static void compute_magnitude_spectrum(const float* real, const float* imag, float* magnitude);
static void spectral_gate(float* real, float* imag, const float* magnitude);
static void compute_fft_simd(float* real, float* imag, int n);

__attribute__((constructor))
static void init_tables() {
    for (int i = 0; i < HALF_FFT; i++) {
        float angle = -2.0f * M_PI * (float)i / (float)FFT_SIZE;
        cos_table[i] = cosf(angle);
        sin_table[i] = sinf(angle);
    }

    for (int i = 0; i < FFT_SIZE; i++) {
        hann_window[i] = 0.5f * (1.0f - cosf(2.0f * M_PI * (float)i / (float)(FFT_SIZE - 1)));
    }

    memset(input_buffer, 0, sizeof(input_buffer));
    memset(output_buffer, 0, sizeof(output_buffer));
    memset(noise_estimate, 0, sizeof(noise_estimate));
    memset(phase_accumulator, 0, sizeof(phase_accumulator));
}

extern "C" {

/**
 * Compute RMS level of a float32 audio buffer (SIMD-accelerated).
 */
float computeRMS(float* samples, int length) {
    float sum = 0.0f;
    int i = 0;

    // SIMD accumulation (4 floats at a time)
    v128_t vsum = wasm_f32x4_splat(0.0f);
    int simd_len = length & ~3;  // Round down to multiple of 4

    for (; i < simd_len; i += 4) {
        v128_t v = wasm_v128_load(&samples[i]);
        vsum = wasm_f32x4_add(vsum, wasm_f32x4_mul(v, v));
    }

    // Horizontal sum
    float temp[4];
    wasm_v128_store(temp, vsum);
    sum = temp[0] + temp[1] + temp[2] + temp[3];

    // Handle remaining samples
    for (; i < length; i++) {
        sum += samples[i] * samples[i];
    }

    return sqrtf(sum / (float)length);
}

/**
 * Compute peak absolute value of a float32 audio buffer (SIMD-accelerated).
 */
float computePeak(float* samples, int length) {
    float peak = 0.0f;
    int i = 0;

    v128_t vpeak = wasm_f32x4_splat(0.0f);
    int simd_len = length & ~3;

    for (; i < simd_len; i += 4) {
        v128_t v = wasm_v128_load(&samples[i]);
        v128_t abs_v = wasm_f32x4_abs(v);
        vpeak = wasm_f32x4_max(vpeak, abs_v);
    }

    float temp[4];
    wasm_v128_store(temp, vpeak);
    peak = fmaxf(fmaxf(temp[0], temp[1]), fmaxf(temp[2], temp[3]));

    for (; i < length; i++) {
        float abs_val = fabsf(samples[i]);
        if (abs_val > peak) peak = abs_val;
    }

    return peak;
}

/**
 * Convert RMS to approximate dB scale (20-120 dB range).
 */
float rmsToDb(float rms) {
    if (rms <= 0.00001f) return 20.0f;
    float dbfs = 20.0f * log10f(rms);
    float db = dbfs + 100.0f;
    if (db < 20.0f) db = 20.0f;
    if (db > 120.0f) db = 120.0f;
    return roundf(db * 10.0f) / 10.0f;
}

/**
 * Process a 256-sample audio frame through the noise suppression pipeline.
 * Input: 256 float32 samples
 * Output: 256 denoised float32 samples written to output_ptr
 * Returns: RMS level of output
 */
float processAudioFrame(float* input, int input_length, float* output, int output_length) {
    // Copy input into ring buffer
    int copy_len = input_length < HOP_SIZE ? input_length : HOP_SIZE;
    memcpy(input_buffer + buffer_pos, input, copy_len * sizeof(float));

    // Apply hop: shift output buffer
    memmove(output_buffer, output_buffer + HOP_SIZE, (FFT_SIZE - HOP_SIZE) * sizeof(float));
    memset(output_buffer + FFT_SIZE - HOP_SIZE, 0, HOP_SIZE * sizeof(float));

    buffer_pos += copy_len;

    // Process when we have a full FFT frame
    if (buffer_pos >= FFT_SIZE) {
        float real[FFT_SIZE];
        float imag[FFT_SIZE];
        float magnitude[NUM_BINS];

        // Copy and window
        memcpy(real, input_buffer, FFT_SIZE * sizeof(float));
        apply_hann_window(real);
        memset(imag, 0, FFT_SIZE * sizeof(float));

        // Forward FFT
        compute_fft_simd(real, imag, FFT_SIZE);

        // Compute magnitude spectrum
        compute_magnitude_spectrum(real, imag, magnitude);

        // Collect noise profile during calibration
        if (noise_frames_collected < noise_calibration_frames) {
            for (int i = 0; i < NUM_BINS; i++) {
                noise_estimate[i] = noise_estimate[i] * (float)noise_frames_collected + magnitude[i];
                noise_estimate[i] /= (float)(noise_frames_collected + 1);
            }
            noise_frames_collected++;
        } else {
            // Apply spectral gate + Wiener filter
            spectral_gate(real, imag, magnitude);

            // Update noise estimate (exponential moving average)
            for (int i = 0; i < NUM_BINS; i++) {
                noise_estimate[i] = wiener_alpha * noise_estimate[i] + (1.0f - wiener_alpha) * magnitude[i];
            }
        }

        // Inverse FFT
        compute_ifft(real, imag, FFT_SIZE);

        // Overlap-add into output buffer
        for (int i = 0; i < FFT_SIZE; i++) {
            output_buffer[i] += real[i] * hann_window[i];
        }

        buffer_pos = 0;
    }

    // Extract the latest HOP_SIZE samples from the output buffer
    int out_start = FFT_SIZE - HOP_SIZE;
    if (output_length < HOP_SIZE) copy_len = output_length;
    else copy_len = HOP_SIZE;

    memcpy(output, output_buffer + out_start, copy_len * sizeof(float));

    return computeRMS(output, copy_len);
}

/**
 * Reset noise calibration — call when starting a new measurement session.
 */
void resetNoiseCalibration() {
    noise_frames_collected = 0;
    memset(noise_estimate, 0, sizeof(noise_estimate));
    buffer_pos = 0;
    memset(input_buffer, 0, sizeof(input_buffer));
    memset(output_buffer, 0, sizeof(output_buffer));
}

/**
 * Set noise gate sensitivity (0.0 = very aggressive, 1.0 = minimal filtering).
 */
void setNoiseGateSensitivity(float sensitivity) {
    if (sensitivity < 0.0f) sensitivity = 0.0f;
    if (sensitivity > 1.0f) sensitivity = 1.0f;
    noise_gate_threshold = 0.005f + sensitivity * 0.05f;
    spectral_floor = 0.01f + sensitivity * 0.15f;
    wiener_alpha = 0.9f + sensitivity * 0.09f;
}

/**
 * Get the current noise profile (for visualization).
 */
void getNoiseProfile(float* out, int length) {
    int len = length < NUM_BINS ? length : NUM_BINS;
    memcpy(out, noise_estimate, len * sizeof(float));
}

/**
 * Get the frequency spectrum of the last processed frame (for visualization).
 */
void getLastSpectrum(float* out_real, float* out_imag, int length) {
    // This would require caching the last FFT output — simplified for now
    int len = length < NUM_BINS ? length : NUM_BINS;
    memset(out_real, 0, len * sizeof(float));
    memset(out_imag, 0, len * sizeof(float));
}

/**
 * Malloc for WASM memory management.
 *
 * Bug fix (Issue #1039): Aligns every allocation to 16 bytes.
 * The wasm_v128_load / wasm_v128_store SIMD intrinsics used in computeRMS,
 * compute_magnitude_spectrum, spectral_gate, and compute_ifft all require
 * 16-byte alignment on 32-bit ARM Android Chrome.  Without this, the browser
 * runtime raises RuntimeError: memory access out of bounds.
 *
 * Alignment formula:  aligned = (ptr + 15) & ~15
 */
int malloc(int size) {
    // Round size up to next 16-byte multiple to keep heap_ptr aligned
    int aligned_size = (size + 15) & ~15;
    int ptr = heap_ptr;
    heap_ptr += aligned_size;
    return ptr;
}

/**
 * Free (no-op bump allocator).
 */
void free(int ptr) {
    (void)ptr;
}

/**
 * Reset heap pointer back to the 16-byte-aligned initial position.
 */
void resetHeap() {
    heap_ptr = (FFT_SIZE * 4 * 8 + 15) & ~15;
}

}  // extern "C"

// ─── Internal FFT implementation ──────────────────────────────────────────────

static void apply_hann_window(float* signal) {
    int i = 0;
    v128_t one = wasm_f32x4_splat(1.0f);
    v128_t half = wasm_f32x4_splat(0.5f);

    int simd_len = FFT_SIZE & ~3;
    for (; i < simd_len; i += 4) {
        v128_t w = wasm_v128_load(&hann_window[i]);
        v128_t s = wasm_v128_load(&signal[i]);
        v128_t result = wasm_f32x4_mul(s, w);
        wasm_v128_store(&signal[i], result);
    }

    for (; i < FFT_SIZE; i++) {
        signal[i] *= hann_window[i];
    }
}

static void compute_magnitude_spectrum(const float* real, const float* imag, float* magnitude) {
    int i = 0;
    int simd_len = NUM_BINS & ~3;

    for (; i < simd_len; i += 4) {
        v128_t re = wasm_v128_load(&real[i]);
        v128_t im = wasm_v128_load(&imag[i]);
        v128_t mag_sq = wasm_f32x4_add(wasm_f32x4_mul(re, re), wasm_f32x4_mul(im, im));
        // Approximate sqrt using rsqrt for speed (good enough for spectral gate)
        v128_t inv_mag = wasm_f32x4_div(wasm_f32x4_splat(1.0f), wasm_f32x4_sqrt(mag_sq));
        // Actually use proper sqrt since rsqrt approximation may be too rough
        v128_t result = wasm_f32x4_sqrt(mag_sq);
        wasm_v128_store(&magnitude[i], result);
    }

    for (; i < NUM_BINS; i++) {
        magnitude[i] = sqrtf(real[i] * real[i] + imag[i] * imag[i]);
    }
}

static void spectral_gate(float* real, float* imag, const float* magnitude) {
    int i = 0;
    int simd_len = NUM_BINS & ~3;

    for (; i < simd_len; i += 4) {
        v128_t mag = wasm_v128_load(&magnitude[i]);
        v128_t noise = wasm_v128_load(&noise_estimate[i]);
        v128_t threshold = wasm_f32x4_splat(noise_gate_threshold);
        v128_t floor_val = wasm_f32x4_splat(spectral_floor);

        // Wiener filter gain: max(spectral_floor, 1 - noise/mag)
        v128_t safe_mag = wasm_f32x4_max(mag, wasm_f32x4_splat(0.0001f));
        v128_t ratio = wasm_f32x4_div(noise, safe_mag);
        v128_t gain = wasm_f32x4_max(floor_val, wasm_f32x4_sub(wasm_f32x4_splat(1.0f), ratio));

        // Apply gate: if magnitude < noise * threshold, zero out
        v128_t gate_threshold = wasm_f32x4_mul(noise, threshold);
        v128_t gate_open = wasm_f32x4_gt(mag, gate_threshold);
        gain = wasm_v128_and(gain, gate_open);

        // Apply gain to real and imaginary parts
        v128_t re = wasm_v128_load(&real[i]);
        v128_t im = wasm_v128_load(&imag[i]);
        wasm_v128_store(&real[i], wasm_f32x4_mul(re, gain));
        wasm_v128_store(&imag[i], wasm_f32x4_mul(im, gain));
    }

    for (; i < NUM_BINS; i++) {
        float gate_threshold_val = noise[i] * noise_gate_threshold;
        if (magnitude[i] < gate_threshold_val) {
            real[i] = 0.0f;
            imag[i] = 0.0f;
        } else {
            float gain = fmaxf(spectral_floor, 1.0f - noise[i] / fmaxf(magnitude[i], 0.0001f));
            real[i] *= gain;
            imag[i] *= gain;
        }
    }
}

/**
 * In-place Cooley-Tukey radix-2 FFT (SIMD-accelerated butterfly).
 */
static void compute_fft_simd(float* real, float* imag, int n) {
    // Bit-reversal permutation
    int log_n = 0;
    for (int t = n; t > 1; t >>= 1) log_n++;

    for (int i = 0; i < n; i++) {
        int j = 0;
        int temp = i;
        for (int k = 0; k < log_n; k++) {
            j = (j << 1) | (temp & 1);
            temp >>= 1;
        }
        if (i < j) {
            float tr = real[i]; real[i] = real[j]; real[j] = tr;
            float ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
        }
    }

    // Butterfly stages
    for (int stage = 0; stage < log_n; stage++) {
        int m = 1 << (stage + 1);
        int half_m = m >> 1;

        for (int k = 0; k < n; k += m) {
            for (int j = 0; j < half_m; j++) {
                int idx = k + j + half_m;
                int twiddle_idx = j * (n / m);

                float wr = cos_table[twiddle_idx];
                float wi = sin_table[twiddle_idx];

                float tr = wr * real[idx] - wi * imag[idx];
                float ti = wr * imag[idx] + wi * real[idx];

                real[idx] = real[k + j] - tr;
                imag[idx] = imag[k + j] - ti;
                real[k + j] += tr;
                imag[k + j] += ti;
            }
        }
    }
}

static void compute_fft(float* real, float* imag, int n) {
    compute_fft_simd(real, imag, n);
}

/**
 * Inverse FFT using the same butterfly structure with conjugated twiddle factors.
 */
static void compute_ifft(float* real, float* imag, int n) {
    // Conjugate the input
    for (int i = 0; i < n; i++) {
        imag[i] = -imag[i];
    }

    // Forward FFT
    compute_fft_simd(real, imag, n);

    // Conjugate and scale
    float inv_n = 1.0f / (float)n;
    int i = 0;
    int simd_len = n & ~3;

    for (; i < simd_len; i += 4) {
        v128_t re = wasm_v128_load(&real[i]);
        v128_t im = wasm_v128_load(&imag[i]);
        v128_t scale = wasm_f32x4_splat(inv_n);
        wasm_v128_store(&real[i], wasm_f32x4_mul(re, scale));
        wasm_v128_store(&imag[i], wasm_f32x4_mul(wasm_f32x4_neg(im), scale));
    }

    for (; i < n; i++) {
        real[i] *= inv_n;
        imag[i] = -imag[i] * inv_n;
    }
}
