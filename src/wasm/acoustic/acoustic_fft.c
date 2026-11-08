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

#define MAX_SAMPLES 4096

static int g_sample_rate = 44100;
static int g_buffer_size = 1024;
static float g_band_energies[MAX_BANDS];
static float g_downsample_buffer[MAX_SAMPLES];

// Frequency band boundaries in Hz
static const int band_edges[MAX_BANDS + 1] = {0,    60,   250,  500,
                                              2000, 4000, 6000, 20000};

void acoustic_fft_init(int sample_rate, int buffer_size) {
  g_sample_rate = sample_rate > 0 ? sample_rate : 44100;
  g_buffer_size = buffer_size > 0 ? buffer_size : 1024;
  if (g_buffer_size > MAX_SAMPLES) {
    g_buffer_size = MAX_SAMPLES;
  }
  memset(g_band_energies, 0, sizeof(g_band_energies));
}

// Simplified DFT for specific frequency bands to save WASM compute
static float compute_band_energy(const float *input, int num_samples,
                                 int effective_sample_rate,
                                 int low_freq, int high_freq) {
  float energy = 0.0f;
  int num_bins = num_samples / 2;

  for (int k = 0; k < num_bins; k++) {
    float freq = (float)k * effective_sample_rate / num_samples;
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

  const float *proc_buf = input_buffer;
  int proc_samples = num_samples;
  int effective_sample_rate = g_sample_rate;

  // Prevent buffer overflow during high sample rates (96kHz, 192kHz)
  // Downsample or decimate if sample rate exceeds 48kHz or buffer exceeds MAX_SAMPLES
  if (g_sample_rate > 48000 || num_samples > MAX_SAMPLES) {
    int downsample_factor = 1;
    if (g_sample_rate >= 192000) {
      downsample_factor = 4; // 192kHz -> 48kHz
    } else if (g_sample_rate >= 96000) {
      downsample_factor = 2; // 96kHz -> 48kHz
    } else if (num_samples > MAX_SAMPLES) {
      downsample_factor = (num_samples + MAX_SAMPLES - 1) / MAX_SAMPLES;
    }

    if (downsample_factor > 1) {
      proc_samples = num_samples / downsample_factor;
      if (proc_samples > MAX_SAMPLES) {
        proc_samples = MAX_SAMPLES;
      }
      effective_sample_rate = g_sample_rate / downsample_factor;

      for (int i = 0; i < proc_samples; i++) {
        float sum = 0.0f;
        for (int j = 0; j < downsample_factor; j++) {
          int src_idx = i * downsample_factor + j;
          if (src_idx < num_samples) {
            sum += input_buffer[src_idx];
          }
        }
        g_downsample_buffer[i] = sum / downsample_factor;
      }
      proc_buf = g_downsample_buffer;
    } else if (proc_samples > MAX_SAMPLES) {
      proc_samples = MAX_SAMPLES;
    }
  }

  float max_energy = 0.0f;
  int dominant_band = 3; // Default to Mid

  for (int i = 0; i < MAX_BANDS; i++) {
    g_band_energies[i] = compute_band_energy(proc_buf, proc_samples,
                                             effective_sample_rate,
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
