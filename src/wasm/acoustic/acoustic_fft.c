/**
 * acoustic_fft.c
 * C implementation of the FFT algorithm and frequency band isolation.
 * Uses a simplified Goertzel algorithm or basic DFT for WASM compatibility
 * without external dependencies.
 */

#include "acoustic_fft.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define PI 3.14159265358979323846
#define MAX_BANDS 7

static int g_sample_rate = 44100;
static int g_buffer_size = 1024;
static float g_band_energies[MAX_BANDS];

// Frequency band boundaries in Hz
static const int band_edges[MAX_BANDS + 1] = {0,    60,   250,  500,
                                              2000, 4000, 6000, 20000};

void acoustic_fft_init(int sample_rate, int buffer_size) {
  g_sample_rate = sample_rate > 0 ? sample_rate : 44100;
  g_buffer_size = buffer_size > 0 ? buffer_size : 1024;
  memset(g_band_energies, 0, sizeof(g_band_energies));
}

// Simplified DFT for specific frequency bands to save WASM compute
static float compute_band_energy(const float *input, int num_samples,
                                 int low_freq, int high_freq) {
  float energy = 0.0f;
  int num_bins = num_samples / 2;

  for (int k = 0; k < num_bins; k++) {
    float freq = (float)k * g_sample_rate / num_samples;
    if (freq >= low_freq && freq <= high_freq) {
      float real = 0.0f;
      float imag = 0.0f;
      for (int n = 0; n < num_samples; n++) {
        float angle = 2.0f * PI * k * n / num_samples;
        real += input[n] * cosf(angle);
        imag -= input[n] * sinf(angle);
      }
      energy += (real * real + imag * imag) / (num_samples * num_samples);
    }
  }
  return energy;
}

int acoustic_fft_process_block(const float *input_buffer, int num_samples) {
  if (!input_buffer || num_samples <= 0)
    return -1;

  float max_energy = 0.0f;
  int dominant_band = 3; // Default to Mid

  for (int i = 0; i < MAX_BANDS; i++) {
    g_band_energies[i] = compute_band_energy(input_buffer, num_samples,
                                             band_edges[i], band_edges[i + 1]);

    if (g_band_energies[i] > max_energy) {
      max_energy = g_band_energies[i];
      dominant_band = i;
    }
  }

  return dominant_band;
}

float acoustic_fft_get_band_energy(int band_index) {
  if (band_index < 0 || band_index >= MAX_BANDS)
    return 0.0f;
  return g_band_energies[band_index];
}

void acoustic_fft_cleanup(void) {
  memset(g_band_energies, 0, sizeof(g_band_energies));
}
