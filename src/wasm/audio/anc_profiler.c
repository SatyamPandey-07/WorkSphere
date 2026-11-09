/**
 * anc_profiler.c
 * C implementation of the spectral flux algorithm to calculate the ANC
 * feasibility score. Distinguishes between continuous low-frequency hums
 * (ANC-friendly) and sharp transients (ANC-hostile).
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define FFT_SIZE 1024
#define NUM_BANDS 8

// Frequency band edges in Hz (approximate for 44.1kHz sample rate)
static const int band_edges[NUM_BANDS + 1] = {0,    60,   250,  500,  1000,
                                              2000, 4000, 8000, 20000};

typedef struct {
  float band_energies[NUM_BANDS];
  float spectral_flux;
  float anc_feasibility_score; // 0.0 to 1.0 (1.0 = highly feasible)
} ANCProfile;

// Mock FFT magnitude calculation (simplified for scaffold)
static void compute_magnitude_spectrum(const float *audio_buffer,
                                       float *magnitudes, int num_samples) {
  for (int i = 0; i < num_samples / 2; i++) {
    // Simplified mock: use absolute value as proxy for magnitude
    magnitudes[i] = fabsf(audio_buffer[i]);
  }
}

void analyze_anc_feasibility(const float *current_frame,
                             const float *previous_frame, int num_samples,
                             ANCProfile *profile) {
  if (!current_frame || !previous_frame || !profile)
    return;

  float current_magnitudes[FFT_SIZE / 2];
  float previous_magnitudes[FFT_SIZE / 2];

  compute_magnitude_spectrum(current_frame, current_magnitudes, num_samples);
  compute_magnitude_spectrum(previous_frame, previous_magnitudes, num_samples);

  float total_flux = 0.0f;
  float low_freq_energy = 0.0f;
  float high_freq_energy = 0.0f;

  int num_bins = num_samples / 2;
  float bin_width = 44100.0f / (float)num_samples;

  for (int i = 0; i < num_bins; i++) {
    float freq = i * bin_width;
    float mag = current_magnitudes[i];
    float prev_mag = previous_magnitudes[i];

    // Calculate spectral flux (difference between frames)
    float diff = mag - prev_mag;
    if (diff > 0.0f) {
      total_flux += diff;
    }

    // Categorize energy
    if (freq < 500.0f) {
      low_freq_energy += mag * mag;
    } else if (freq > 2000.0f) {
      high_freq_energy += mag * mag;
    }
  }

  profile->spectral_flux = total_flux;

  // ANC is effective for low-frequency, continuous sounds (low flux, high
  // low-freq energy) ANC struggles with high-frequency, transient sounds (high
  // flux, high high-freq energy)
  float ratio = (low_freq_energy + 1.0f) / (high_freq_energy + 1.0f);
  float flux_penalty = fminf(total_flux * 10.0f, 1.0f); // Normalize flux impact

  profile->anc_feasibility_score =
      fmaxf(0.0f, fminf(1.0f, (ratio * 0.5f) - flux_penalty + 0.5f));
}
