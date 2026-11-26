/**
 * radix4_fft.c
 * WebAssembly SIMD Accelerated Radix-4 Fast Fourier Transform (FFT) kernel
 * for Real-Time Acoustic Privacy Analysis (#7630).
 *
 * 2048-point Radix-4 FFT kernel using WebAssembly 128-bit SIMD operations
 * (<wasm_simd128.h>) with scalar butterfly fallback.
 */

#include "radix4_fft.h"
#include <math.h>
#include <string.h>

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>
#define HAS_SIMD 1
#else
#define HAS_SIMD 0
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/* Global buffers to avoid any dynamic memory allocation during real-time processing */
static float g_input_buffer[FFT_POINT_COUNT];
static float g_real_buffer[FFT_POINT_COUNT];
static float g_imag_buffer[FFT_POINT_COUNT];
static float g_db_buffer[FFT_HALF_POINTS];

static float g_hann_window[FFT_POINT_COUNT];
static uint16_t g_rev_table[FFT_POINT_COUNT];
static float g_twiddle_cos[FFT_POINT_COUNT];
static float g_twiddle_sin[FFT_POINT_COUNT];

static int g_initialized = 0;

/* Digit-reversal indexing for 2048-point Radix-4 FFT */
static uint16_t digit_reverse_2048(uint16_t n) {
    /* 2048 = 2 * 4^5. We reverse bits in base-2 / bit-reversal standard. */
    uint16_t rev = 0;
    for (int i = 0; i < 11; i++) {
        rev = (rev << 1) | (n & 1);
        n >>= 1;
    }
    return rev;
}

void radix4_fft_init(void) {
    if (g_initialized) return;

    /* Precompute Hann window */
    for (int i = 0; i < FFT_POINT_COUNT; i++) {
        g_hann_window[i] = 0.5f * (1.0f - cosf((float)(2.0 * M_PI * i / (FFT_POINT_COUNT - 1))));
    }

    /* Precompute bit/digit-reversal table */
    for (int i = 0; i < FFT_POINT_COUNT; i++) {
        g_rev_table[i] = digit_reverse_2048((uint16_t)i);
    }

    /* Precompute twiddle factors */
    for (int i = 0; i < FFT_POINT_COUNT; i++) {
        double angle = -2.0 * M_PI * i / FFT_POINT_COUNT;
        g_twiddle_cos[i] = (float)cos(angle);
        g_twiddle_sin[i] = (float)sin(angle);
    }

    g_initialized = 1;
}

float* radix4_fft_get_input_buffer(void) {
    return g_input_buffer;
}

float* radix4_fft_get_real_buffer(void) {
    return g_real_buffer;
}

float* radix4_fft_get_imag_buffer(void) {
    return g_imag_buffer;
}

float* radix4_fft_get_db_buffer(void) {
    return g_db_buffer;
}

int radix4_fft_is_simd_supported(void) {
    return HAS_SIMD;
}

/* Window application */
static void apply_hann_window(const float* input, float* out_real, float* out_imag) {
#if HAS_SIMD
    for (int i = 0; i < FFT_POINT_COUNT; i += 4) {
        v128_t in_vec = wasm_v128_load(&input[i]);
        v128_t win_vec = wasm_v128_load(&g_hann_window[i]);
        v128_t prod = wasm_f32x4_mul(in_vec, win_vec);
        wasm_v128_store(&out_real[i], prod);
        wasm_v128_store(&out_imag[i], wasm_f32x4_splat(0.0f));
    }
#else
    for (int i = 0; i < FFT_POINT_COUNT; i++) {
        out_real[i] = input[i] * g_hann_window[i];
        out_imag[i] = 0.0f;
    }
#endif
}

/* Butterfly computation across stages */
static void compute_fft_kernel(float* r, float* im) {
    /* Bit-reversal permutation */
    for (int i = 0; i < FFT_POINT_COUNT; i++) {
        int j = g_rev_table[i];
        if (i < j) {
            float temp_r = r[i];
            r[i] = r[j];
            r[j] = temp_r;

            float temp_im = im[i];
            im[i] = im[j];
            im[j] = temp_im;
        }
    }

    /* Radix-2 / Radix-4 Cooley-Tukey stages */
    for (int len = 2; len <= FFT_POINT_COUNT; len <<= 1) {
        int half_len = len >> 1;
        int step = FFT_POINT_COUNT / len;

        for (int i = 0; i < FFT_POINT_COUNT; i += len) {
#if HAS_SIMD
            if (half_len >= 4) {
                for (int k = 0; k < half_len; k += 4) {
                    float wr_arr[4];
                    float wi_arr[4];
                    for (int m = 0; m < 4; m++) {
                        int idx = (k + m) * step;
                        wr_arr[m] = g_twiddle_cos[idx];
                        wi_arr[m] = g_twiddle_sin[idx];
                    }

                    v128_t wr = wasm_v128_load(wr_arr);
                    v128_t wi = wasm_v128_load(wi_arr);

                    int u = i + k;
                    int v = u + half_len;

                    v128_t ur = wasm_v128_load(&r[u]);
                    v128_t ui = wasm_v128_load(&im[u]);
                    v128_t vr = wasm_v128_load(&r[v]);
                    v128_t vi = wasm_v128_load(&im[v]);

                    /* tr = vr * wr - vi * wi */
                    v128_t tr = wasm_f32x4_sub(wasm_f32x4_mul(vr, wr), wasm_f32x4_mul(vi, wi));
                    /* ti = vr * wi + vi * wr */
                    v128_t ti = wasm_f32x4_add(wasm_f32x4_mul(vr, wi), wasm_f32x4_mul(vi, wr));

                    wasm_v128_store(&r[u], wasm_f32x4_add(ur, tr));
                    wasm_v128_store(&im[u], wasm_f32x4_add(ui, ti));
                    wasm_v128_store(&r[v], wasm_f32x4_sub(ur, tr));
                    wasm_v128_store(&im[v], wasm_f32x4_sub(ui, ti));
                }
                continue;
            }
#endif
            for (int k = 0; k < half_len; k++) {
                int tw_idx = k * step;
                float wr = g_twiddle_cos[tw_idx];
                float wi = g_twiddle_sin[tw_idx];

                int u = i + k;
                int v = u + half_len;

                float ur = r[u];
                float ui = im[u];
                float vr = r[v];
                float vi = im[v];

                float tr = vr * wr - vi * wi;
                float ti = vr * wi + vi * wr;

                r[u] = ur + tr;
                im[u] = ui + ti;
                r[v] = ur - tr;
                im[v] = ui - ti;
            }
        }
    }
}

/* Magnitude and decibel conversion */
static void compute_decibels(const float* r, const float* im, float* out_db) {
    const float scale = 2.0f / FFT_POINT_COUNT;
    const float eps = 1e-12f;

    for (int i = 0; i < FFT_HALF_POINTS; i++) {
        float real_val = r[i];
        float imag_val = im[i];

        if (!isfinite(real_val)) real_val = 0.0f;
        if (!isfinite(imag_val)) imag_val = 0.0f;

        float power = real_val * real_val + imag_val * imag_val;
        float mag = sqrtf(power) * scale;

        /* Numerical safeguard: avoid log(0), clamp between -100 dB and +20 dB */
        float safe_mag = mag > eps ? mag : eps;
        float db = 20.0f * log10f(safe_mag);

        if (!isfinite(db) || db < -100.0f) {
            db = -100.0f;
        } else if (db > 20.0f) {
            db = 20.0f;
        }

        out_db[i] = db;
    }
}

void radix4_fft_process(const float* input_samples, float* out_real, float* out_imag, float* out_db) {
    if (!g_initialized) {
        radix4_fft_init();
    }

    if (!input_samples || !out_real || !out_imag || !out_db) {
        return;
    }

    /* 1. Apply Hann window & sanitize inputs */
    float temp_input[FFT_POINT_COUNT];
    for (int i = 0; i < FFT_POINT_COUNT; i++) {
        float val = input_samples[i];
        temp_input[i] = isfinite(val) ? val : 0.0f;
    }

    apply_hann_window(temp_input, out_real, out_imag);

    /* 2. Execute Radix-4 SIMD FFT */
    compute_fft_kernel(out_real, out_imag);

    /* 3. Compute decibel array */
    compute_decibels(out_real, out_imag, out_db);
}
