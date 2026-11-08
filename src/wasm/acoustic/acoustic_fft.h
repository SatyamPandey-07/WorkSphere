/**
 * acoustic_fft.h
 * Header definitions for the WASM module exports.
 * Declares the C functions that will be compiled to WebAssembly for real-time
 * audio processing.
 */

#ifndef ACOUSTIC_FFT_H
#define ACOUSTIC_FFT_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Initialize the FFT engine with a specific sample rate and buffer size
void acoustic_fft_init(int sample_rate, int buffer_size);

// Process a block of audio samples and return the dominant frequency band index
// Bands: 0=Sub-bass, 1=Bass, 2=Low-mid, 3=Mid, 4=High-mid, 5=Presence,
// 6=Brilliance
int acoustic_fft_process_block(const float *input_buffer, int num_samples);

// Get the energy level of a specific frequency band (0-6)
float acoustic_fft_get_band_energy(int band_index);

// Cleanup allocated resources
void acoustic_fft_cleanup(void);

#ifdef __cplusplus
}
#endif

#endif // ACOUSTIC_FFT_H