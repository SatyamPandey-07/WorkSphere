/**
 * transient_detector.c
 * Isolates sharp audio transients (e.g., espresso machine steam, dropping cups)
 * from continuous background noise. Uses energy envelope tracking and
 * thresholding to flag transient events.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define FRAME_SIZE 512
#define ATTACK_TIME_MS 10.0f
#define RELEASE_TIME_MS 100.0f

typedef struct {
  float envelope;
  float threshold;
  float attack_coeff;
  float release_coeff;
  int transient_detected;
} TransientState;

void transient_init(TransientState *state, float sample_rate) {
  if (!state)
    return;
  state->envelope = 0.0f;
  state->threshold = 0.1f; // Initial threshold
  state->attack_coeff =
      expf(-1.0f / (sample_rate * (ATTACK_TIME_MS / 1000.0f)));
  state->release_coeff =
      expf(-1.0f / (sample_rate * (RELEASE_TIME_MS / 1000.0f)));
  state->transient_detected = 0;
}

int detect_transients(const float *audio_frame, int num_samples,
                      TransientState *state, float sample_rate) {
  if (!audio_frame || !state || num_samples <= 0)
    return 0;

  int transient_count = 0;
  float max_amplitude = 0.0f;

  // Find max amplitude in frame
  for (int i = 0; i < num_samples; i++) {
    float abs_val = fabsf(audio_frame[i]);
    if (abs_val > max_amplitude) {
      max_amplitude = abs_val;
    }
  }

  // Update envelope
  if (max_amplitude > state->envelope) {
    state->envelope =
        max_amplitude + state->attack_coeff * (state->envelope - max_amplitude);
  } else {
    state->envelope = max_amplitude +
                      state->release_coeff * (state->envelope - max_amplitude);
  }

  // Adaptive thresholding
  state->threshold = state->envelope * 1.5f + 0.01f;

  if (max_amplitude > state->threshold && state->envelope > 0.05f) {
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
