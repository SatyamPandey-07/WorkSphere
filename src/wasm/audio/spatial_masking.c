/**
 * spatial_masking.c
 * Generates the inverse phase signals and frequency-matched noise masks to
 * neutralize audio leakage. Used in conjunction with beamforming to create a
 * "privacy zone" around the user.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define FRAME_SIZE 512
#define PI 3.14159265358979323846f

// Generate phase-inverted signal for active noise cancellation
void generate_phase_inversion(const float *input_frame, float *output_frame) {
  if (!input_frame || !output_frame)
    return;

  for (int i = 0; i < FRAME_SIZE; i++) {
    output_frame[i] = -input_frame[i];
  }
}

// Generate frequency-matched white/pink noise mask
// Focuses energy on speech frequencies (300Hz - 3400Hz)
void generate_speech_mask(float *output_frame, float intensity, uint32_t seed) {
  if (!output_frame)
    return;

  // Simple Linear Congruential Generator for pseudo-random noise
  uint32_t state = seed;

  for (int i = 0; i < FRAME_SIZE; i++) {
    state = state * 1664525 + 1013904223;

    // Normalize to -1.0 to 1.0
    float noise = ((float)(state >> 16) / 32768.0f) - 1.0f;

    // Apply simple bandpass filter effect (mock)
    // In production, this would be a proper IIR/FIR filter
    float speech_band_energy = sinf(i * 0.1f) * 0.5f + 0.5f;

    output_frame[i] = noise * intensity * speech_band_energy;
  }
}

// Mix phase inversion and masking noise
void apply_privacy_masking(const float *captured_audio, float *output_frame,
                           float mask_intensity, uint32_t seed) {
  if (!captured_audio || !output_frame)
    return;

  float inverted[FRAME_SIZE];
  float mask[FRAME_SIZE];

  generate_phase_inversion(captured_audio, inverted);
  generate_speech_mask(mask, mask_intensity, seed);

  for (int i = 0; i < FRAME_SIZE; i++) {
    // Mix inverted signal (for cancellation) and mask (for privacy)
    output_frame[i] = (inverted[i] * 0.3f) + (mask[i] * 0.7f);

    // Hard clip to prevent distortion
    if (output_frame[i] > 1.0f)
      output_frame[i] = 1.0f;
    if (output_frame[i] < -1.0f)
      output_frame[i] = -1.0f;
  }
}