/**
 * radix4_fft.h
 * Header for WebAssembly SIMD accelerated 2048-point Radix-4 FFT kernel
 * for real-time acoustic privacy analysis (#7630).
 */

#ifndef RADIX4_FFT_H
#define RADIX4_FFT_H

#include <stddef.h>
#include <stdint.h>

#define FFT_POINT_COUNT 2048
#define FFT_HALF_POINTS (FFT_POINT_COUNT / 2)

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Initializes FFT tables (twiddle factors, Hann window, digit-reversal map).
 */
void radix4_fft_init(void);

/**
 * Returns byte offset / pointer to the real-valued input sample buffer (2048 floats).
 */
float* radix4_fft_get_input_buffer(void);

/**
 * Returns pointer to the real output frequency bin buffer (2048 floats).
 */
float* radix4_fft_get_real_buffer(void);

/**
 * Returns pointer to the imaginary output frequency bin buffer (2048 floats).
 */
float* radix4_fft_get_imag_buffer(void);

/**
 * Returns pointer to the decibel magnitude output buffer (1024 floats).
 */
float* radix4_fft_get_db_buffer(void);

/**
 * Processes a 2048-point frame:
 * 1. Validates input
 * 2. Applies Hann window
 * 3. Executes 2048-point Radix-4 SIMD FFT
 * 4. Computes magnitude and converts to decibels with numerical safeguards
 */
void radix4_fft_process(const float* input_samples, float* out_real, float* out_imag, float* out_db);

/**
 * Returns 1 if SIMD kernel is compiled/available, 0 otherwise.
 */
int radix4_fft_is_simd_supported(void);

#ifdef __cplusplus
}
#endif

#endif /* RADIX4_FFT_H */
