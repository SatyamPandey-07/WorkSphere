/**
 * noise_fft.c
 *
 * Lightweight C FFT and decibel calculation module compiled to WebAssembly.
 * Optimized for low-power mobile devices to reduce audio processing CPU load.
 */

#include <math.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// Allocates 8-byte aligned memory buffer
void* wasm_malloc(size_t size) {
    size_t aligned_size = (size + 7) & ~7;
    return malloc(aligned_size);
}

// Frees allocated memory buffer
void wasm_free(void* ptr) {
    if (ptr) {
        free(ptr);
    }
}

// Compute Root Mean Square (RMS) of audio sample array
float compute_rms(const float* samples, int count) {
    if (!samples || count <= 0) return 0.0f;

    double sum = 0.0;
    for (int i = 0; i < count; i++) {
        sum += (double)samples[i] * (double)samples[i];
    }
    return (float)sqrt(sum / (double)count);
}

// Convert RMS to approximate dB SPL (Sound Pressure Level)
float rms_to_db(float rms) {
    if (rms <= 0.00001f) return 20.0f;
    float dbfs = 20.0f * log10f(rms);
    float db = (dbfs + 100.0f);
    if (db < 20.0f) return 20.0f;
    if (db > 120.0f) return 120.0f;
    return db;
}

// Cooley-Tukey Radix-2 FFT calculation for power spectrum magnitude
void compute_fft_magnitude(const float* in_real, int n, float* out_mag) {
    if (!in_real || !out_mag || n <= 0 || (n & (n - 1)) != 0) return;

    float* real = (float*)malloc(n * sizeof(float));
    float* imag = (float*)malloc(n * sizeof(float));

    if (!real || !imag) {
        if (real) free(real);
        if (imag) free(imag);
        return;
    }

    // Bit reversal ordering
    int j = 0;
    for (int i = 0; i < n; i++) {
        real[j] = in_real[i];
        imag[j] = 0.0f;

        int m = n >> 1;
        while (m >= 1 && j >= m) {
            j -= m;
            m >>= 1;
        }
        j += m;
    }

    // Cooley-Tukey FFT iterations
    for (int len = 2; len <= n; len <<= 1) {
        float angle = -2.0f * (float)M_PI / (float)len;
        float wlen_r = cosf(angle);
        float wlen_i = sinf(angle);

        int half_len = len >> 1;
        for (int i = 0; i < n; i += len) {
            float w_r = 1.0f;
            float w_i = 0.0f;

            for (int k = 0; k < half_len; k++) {
                int u = i + k;
                int v = i + k + half_len;

                float u_r = real[u];
                float u_i = imag[u];
                float v_r = real[v] * w_r - imag[v] * w_i;
                float v_i = real[v] * w_i + imag[v] * w_r;

                real[u] = u_r + v_r;
                imag[u] = u_i + v_i;
                real[v] = u_r - v_r;
                imag[v] = u_i - v_i;

                float next_w_r = w_r * wlen_r - w_i * wlen_i;
                float next_w_i = w_r * wlen_i + w_i * wlen_r;
                w_r = next_w_r;
                w_i = next_w_i;
            }
        }
    }

    // Compute magnitude spectrum for first n/2 bins
    int half_n = n / 2;
    for (int i = 0; i < half_n; i++) {
        out_mag[i] = sqrtf(real[i] * real[i] + imag[i] * imag[i]) / (float)n;
    }

    free(real);
    free(imag);
}

// Compute decibel metrics & FFT spectrum in a single call
// metrics_out array: [rms, averageDb, peakDb]
int process_noise_frame(
    const float* samples,
    int sample_count,
    int fft_size,
    float* spectrum_out,
    float* metrics_out
) {
    if (!samples || sample_count <= 0 || !metrics_out) return -1;

    float rms = compute_rms(samples, sample_count);
    float db = rms_to_db(rms);

    // Calculate peak sample dB
    float peak_sample = 0.0f;
    for (int i = 0; i < sample_count; i++) {
        float abs_val = fabsf(samples[i]);
        if (abs_val > peak_sample) {
            peak_sample = abs_val;
        }
    }
    float peak_db = rms_to_db(peak_sample);

    metrics_out[0] = rms;
    metrics_out[1] = db;
    metrics_out[2] = peak_db;

    if (spectrum_out && fft_size > 0 && (fft_size & (fft_size - 1)) == 0) {
        int n = sample_count < fft_size ? sample_count : fft_size;
        compute_fft_magnitude(samples, n, spectrum_out);
    }

    return 0;
}
