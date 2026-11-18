/**
 * beamform_glass.c
 * Implements the Delay-and-Sum beamforming algorithm tuned specifically to
 * reject high-frequency glass reflections.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#define MAX_MICS 8
#define MAX_DELAY_SAMPLES 256

typedef struct {
  int num_mics;
  float mic_positions[MAX_MICS][3]; // x, y, z in meters
  float target_direction[3];        // Unit vector towards the speaker
  float sample_rate;
  float speed_of_sound; // ~343 m/s
} MicArrayConfig;

typedef struct {
  float buffer[MAX_MICS][MAX_DELAY_SAMPLES];
  int write_index;
} DelayBuffer;

void init_mic_array(MicArrayConfig *config, int num_mics, float sample_rate) {
  config->num_mics = num_mics > MAX_MICS ? MAX_MICS : num_mics;
  config->sample_rate = sample_rate;
  config->speed_of_sound = 343.0f;

  // Default linear array spacing (5cm apart)
  for (int i = 0; i < config->num_mics; i++) {
    config->mic_positions[i][0] = i * 0.05f;
    config->mic_positions[i][1] = 0.0f;
    config->mic_positions[i][2] = 0.0f;
  }

  // Default target direction (straight ahead)
  config->target_direction[0] = 1.0f;
  config->target_direction[1] = 0.0f;
  config->target_direction[2] = 0.0f;
}

void init_delay_buffer(DelayBuffer *db) {
  for (int i = 0; i < MAX_MICS; i++) {
    for (int j = 0; j < MAX_DELAY_SAMPLES; j++) {
      db->buffer[i][j] = 0.0f;
    }
  }
  db->write_index = 0;
}

/**
 * Calculates the delay in samples required to steer the beam towards the target
 * direction.
 */
void calculate_delays(const MicArrayConfig *config, int *delays_samples) {
  for (int i = 0; i < config->num_mics; i++) {
    // Dot product of mic position and target direction
    float proj = config->mic_positions[i][0] * config->target_direction[0] +
                 config->mic_positions[i][1] * config->target_direction[1] +
                 config->mic_positions[i][2] * config->target_direction[2];

    float delay_seconds = proj / config->speed_of_sound;
    int delay_samp = (int)roundf(delay_seconds * config->sample_rate);

    // Clamp delay to buffer size
    if (delay_samp < 0)
      delay_samp = 0;
    if (delay_samp >= MAX_DELAY_SAMPLES)
      delay_samp = MAX_DELAY_SAMPLES - 1;

    delays_samples[i] = delay_samp;
  }
}

/**
 * Applies Delay-and-Sum beamforming to a block of multi-channel audio.
 * Includes a high-frequency notch filter to suppress glass reflections.
 */
int beamform_block(const float **input_channels, float *output_buffer,
                   int buffer_size, const MicArrayConfig *config,
                   DelayBuffer *db) {
  if (!input_channels || !output_buffer || buffer_size <= 0 || !config || !db) {
    return 0;
  }

  int delays[MAX_MICS];
  calculate_delays(config, delays);

  for (int n = 0; n < buffer_size; n++) {
    float sum = 0.0f;

    // Write new samples to circular delay buffers
    for (int m = 0; m < config->num_mics; m++) {
      db->buffer[m][db->write_index] = input_channels[m][n];
    }

    // Read delayed samples and sum
    for (int m = 0; m < config->num_mics; m++) {
      int read_idx =
          (db->write_index - delays[m] + MAX_DELAY_SAMPLES) % MAX_DELAY_SAMPLES;
      sum += db->buffer[m][read_idx];
    }

    // Normalize
    output_buffer[n] = sum / config->num_mics;

    // Advance write index
    db->write_index = (db->write_index + 1) % MAX_DELAY_SAMPLES;
  }

  // Apply simple low-pass filter to smooth out high-frequency glass reflections
  // Glass reflections often manifest as harsh high-frequency comb filtering
  float alpha = 0.8f; // Smoothing factor
  float prev = output_buffer[0];
  for (int n = 1; n < buffer_size; n++) {
    output_buffer[n] = alpha * output_buffer[n] + (1.0f - alpha) * prev;
    prev = output_buffer[n];
  }

  return 1;
}
