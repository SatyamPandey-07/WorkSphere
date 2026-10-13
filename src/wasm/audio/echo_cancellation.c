/**
 * echo_cancellation.c
 * C implementation of the Normalized Least Mean Squares (NLMS) filter for
 * highly adaptive acoustic echo cancellation.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define FILTER_LENGTH 512 // Number of taps for the adaptive filter

typedef struct {
  float weights[FILTER_LENGTH];
  float reference_buffer[FILTER_LENGTH]; // Far-end signal (speaker output)
  float step_size;                       // Mu (learning rate)
  float regularization;                  // Delta (prevents division by zero)
} NLMSFilter;

void nlms_init(NLMSFilter *filter, float step_size) {
  memset(filter->weights, 0, sizeof(filter->weights));
  memset(filter->reference_buffer, 0, sizeof(filter->reference_buffer));
  filter->step_size = step_size;
  filter->regularization = 0.0001f;
}

/**
 * Processes a single sample through the NLMS adaptive filter.
 * @param filter The NLMS state
 * @param mic_signal The near-end signal (microphone input containing echo)
 * @param speaker_signal The far-end signal (audio being played through
 * speakers)
 * @return The echo-cancelled microphone signal
 */
float nlms_process_sample(NLMSFilter *filter, float mic_signal,
                          float speaker_signal) {
  // Shift reference buffer and insert new speaker sample
  for (int i = FILTER_LENGTH - 1; i > 0; i--) {
    filter->reference_buffer[i] = filter->reference_buffer[i - 1];
  }
  filter->reference_buffer[0] = speaker_signal;

  // Calculate estimated echo (convolution of reference buffer and filter
  // weights)
  float estimated_echo = 0.0f;
  float power = 0.0f;

  for (int i = 0; i < FILTER_LENGTH; i++) {
    estimated_echo += filter->weights[i] * filter->reference_buffer[i];
    power += filter->reference_buffer[i] * filter->reference_buffer[i];
  }

  // Calculate error signal (actual mic - estimated echo)
  float error = mic_signal - estimated_echo;

  // Update filter weights using NLMS rule
  // w(n+1) = w(n) + (mu / (power + delta)) * error * x(n)
  float norm_factor = filter->step_size / (power + filter->regularization);

  for (int i = 0; i < FILTER_LENGTH; i++) {
    filter->weights[i] += norm_factor * error * filter->reference_buffer[i];
  }

  return error;
}

/**
 * Processes a block of audio samples.
 * @param mic_buffer Microphone input buffer
 * @param speaker_buffer Speaker output buffer (reference)
 * @param output_buffer Buffer to store the cleaned audio
 * @param buffer_size Number of samples
 * @param step_size NLMS learning rate (typically 0.1 to 0.5)
 * @return 1 on success
 */
int process_aec_block(const float *mic_buffer, const float *speaker_buffer,
                      float *output_buffer, int buffer_size, float step_size) {
  if (!mic_buffer || !speaker_buffer || !output_buffer || buffer_size <= 0) {
    return 0;
  }

  NLMSFilter filter;
  nlms_init(&filter, step_size);

  for (int i = 0; i < buffer_size; i++) {
    output_buffer[i] =
        nlms_process_sample(&filter, mic_buffer[i], speaker_buffer[i]);

    // Apply soft clipping to prevent extreme values
    if (output_buffer[i] > 1.0f)
      output_buffer[i] = 1.0f;
    if (output_buffer[i] < -1.0f)
      output_buffer[i] = -1.0f;
  }

  return 1;
}

/**
 * Double-talk detection: Prevents filter adaptation when both users are
 * speaking. Returns 1 if double-talk is detected, 0 otherwise.
 */
int detect_double_talk(const float *mic_buffer, const float *speaker_buffer,
                       int buffer_size, float threshold) {
  float mic_energy = 0.0f;
  float speaker_energy = 0.0f;

  for (int i = 0; i < buffer_size; i++) {
    mic_energy += mic_buffer[i] * mic_buffer[i];
    speaker_energy += speaker_buffer[i] * speaker_buffer[i];
  }

  mic_energy /= buffer_size;
  speaker_energy /= buffer_size;

  // If mic energy is significantly higher than speaker energy,
  // the near-end user is likely speaking.
  if (mic_energy > speaker_energy * threshold && mic_energy > 0.001f) {
    return 1;
  }
  return 0;
}
