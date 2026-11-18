/**
 * transient_detector.c
 * Isolates sharp audio transients (e.g., espresso machine steam, dropping cups)
 * from continuous background noise. Uses running spectral baseline noise floor
 * subtraction and energy envelope tracking to reliably flag transient events (#5769).
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define FRAME_SIZE 512
#define ATTACK_TIME_MS 10.0f
#define RELEASE_TIME_MS 100.0f
#define DEFAULT_SAMPLE_RATE 44100.0f
#define MIN_SAMPLE_RATE 8000.0f
#define MAX_SAMPLE_RATE 192000.0f
#define DENORMAL_THRESHOLD 1e-6f

typedef struct {
  float envelope;
  float threshold;
  float attack_coeff;
  float release_coeff;
  int transient_detected;
  float noise_floor;          // Running spectral / ambient background noise baseline (#5769)
  float noise_floor_coeff;    // EMA adaptation coefficient for noise floor
} TransientState;

/**
 * Initializes transient detector state and computes filter coefficients.
 * Validates that sample_rate > 8000.0f && sample_rate < 192000.0f.
 * Returns 0 on success, or -1 if sample_rate is invalid / NaN / out-of-range.
 * On invalid sample_rate, falls back to DEFAULT_SAMPLE_RATE coefficients to
 * prevent NaN / divide-by-zero propagation.
 */
int transient_init(TransientState *state, float sample_rate) {
  if (!state) {
    return -1;
  }

  // Sanity check: sample_rate > 8000 && sample_rate < 192000
  // Guards against NaN, Inf, zero, negative, and out-of-range sample rates
  if (isnan(sample_rate) || isinf(sample_rate) ||
      !(sample_rate > MIN_SAMPLE_RATE && sample_rate < MAX_SAMPLE_RATE)) {
    state->envelope = 0.0f;
    state->threshold = 0.1f;
    state->attack_coeff =
        expf(-1.0f / (DEFAULT_SAMPLE_RATE * (ATTACK_TIME_MS / 1000.0f)));
    state->release_coeff =
        expf(-1.0f / (DEFAULT_SAMPLE_RATE * (RELEASE_TIME_MS / 1000.0f)));
    state->transient_detected = 0;
    state->noise_floor = 0.0f;
    state->noise_floor_coeff = 0.95f;
    return -1;
  }

  state->envelope = 0.0f;
  state->threshold = 0.1f; // Initial threshold
  state->attack_coeff =
      expf(-1.0f / (sample_rate * (ATTACK_TIME_MS / 1000.0f)));
  state->release_coeff =
      expf(-1.0f / (sample_rate * (RELEASE_TIME_MS / 1000.0f)));
  state->transient_detected = 0;
  state->noise_floor = 0.0f;
  state->noise_floor_coeff = 0.95f;
  return 0;
}

/**
 * Alias for transient_init for API consistency across WASM module loaders.
 */
int init_transient_detector(TransientState *state, float sample_rate) {
  return transient_init(state, sample_rate);
}

int detect_transients(const float *audio_frame, int num_samples,
                      TransientState *state, float sample_rate) {
  if (!audio_frame || !state || num_samples <= 0)
    return 0;

  // Guard against uninitialized or NaN filter coefficients
  if (isnan(state->attack_coeff) || isnan(state->release_coeff) ||
      state->attack_coeff <= 0.0f || state->release_coeff <= 0.0f) {
    float safe_rate =
        (sample_rate > MIN_SAMPLE_RATE && sample_rate < MAX_SAMPLE_RATE &&
         !isnan(sample_rate) && !isinf(sample_rate))
            ? sample_rate
            : DEFAULT_SAMPLE_RATE;
    state->attack_coeff =
        expf(-1.0f / (safe_rate * (ATTACK_TIME_MS / 1000.0f)));
    state->release_coeff =
        expf(-1.0f / (safe_rate * (RELEASE_TIME_MS / 1000.0f)));
  }

  int transient_count = 0;
  float max_amplitude = 0.0f;
  float frame_energy = 0.0f;
  int valid_samples = 0;

  // Find max amplitude and mean frame energy
  for (int i = 0; i < num_samples; i++) {
    float sample = audio_frame[i];
    if (isnan(sample))
      continue;
    float abs_val = fabsf(sample);
    if (abs_val > max_amplitude) {
      max_amplitude = abs_val;
    }
    frame_energy += abs_val;
    valid_samples++;
  }

  float mean_amplitude = (valid_samples > 0) ? (frame_energy / (float)valid_samples) : 0.0f;

  // Maintain exponential moving average (EMA) spectral noise floor (#5769)
  if (state->noise_floor <= 0.0f || isnan(state->noise_floor) || isinf(state->noise_floor) || state->noise_floor < DENORMAL_THRESHOLD) {
    state->noise_floor = (mean_amplitude >= DENORMAL_THRESHOLD) ? mean_amplitude : 0.0f;
  } else if (mean_amplitude < state->noise_floor) {
    // Rapid downward adaptation toward true background floor
    state->noise_floor = 0.90f * state->noise_floor + 0.10f * mean_amplitude;
  } else if (mean_amplitude < state->noise_floor * 2.5f) {
    // Gradual upward adaptation for ambient background drift (prevents transient pollution)
    state->noise_floor = 0.98f * state->noise_floor + 0.02f * mean_amplitude;
  }

  // Flush denormals on noise floor
  if (isnan(state->noise_floor) || isinf(state->noise_floor) || state->noise_floor < DENORMAL_THRESHOLD) {
    state->noise_floor = 0.0f;
  }

  // Subtract baseline noise power before evaluating transient peak threshold (#5769)
  float peak_power = max_amplitude * max_amplitude;
  float noise_power = state->noise_floor * state->noise_floor;
  float effective_power = (peak_power > noise_power) ? (peak_power - noise_power) : 0.0f;
  float effective_amplitude = sqrtf(effective_power);

  if (max_amplitude <= state->noise_floor || isnan(effective_amplitude) || isinf(effective_amplitude)) {
    effective_amplitude = 0.0f;
  }

  // Update envelope with baseline-subtracted effective amplitude
  if (effective_amplitude > state->envelope) {
    state->envelope =
        effective_amplitude + state->attack_coeff * (state->envelope - effective_amplitude);
  } else {
    state->envelope =
        effective_amplitude + state->release_coeff * (state->envelope - effective_amplitude);
  }

  // Flush denormal floating-point numbers to zero and guard against NaN / Inf
  if (isnan(state->envelope) || isinf(state->envelope) || state->envelope < DENORMAL_THRESHOLD) {
    state->envelope = 0.0f;
  }

  // Adaptive thresholding based on envelope
  state->threshold = state->envelope * 1.5f + 0.01f;
  if (isnan(state->threshold) || isinf(state->threshold) || state->threshold < 0.01f) {
    state->threshold = 0.01f;
  }

  if (effective_amplitude > state->threshold && state->envelope > 0.05f) {
    state->transient_detected = 1;
    transient_count = 1;
  } else {
    state->transient_detected = 0;
  }

  return transient_count;
}

float get_transient_density(const TransientState *state) {
  return state ? (state->transient_detected ? 1.0f : 0.0f) : 0.0f;
}

float get_noise_floor(const TransientState *state) {
  if (!state || isnan(state->noise_floor) || isinf(state->noise_floor) || state->noise_floor < DENORMAL_THRESHOLD) {
    return 0.0f;
  }
  return state->noise_floor;
}

void set_noise_floor(TransientState *state, float noise_floor) {
  if (state) {
    if (isnan(noise_floor) || isinf(noise_floor) || noise_floor < DENORMAL_THRESHOLD) {
      state->noise_floor = 0.0f;
    } else {
      state->noise_floor = noise_floor;
    }
  }
}
