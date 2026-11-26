#include <emscripten.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#define WINDOW_SIZE 20
#define Z_SCORE_THRESHOLD 2.5f

typedef struct {
  float buffer[WINDOW_SIZE];
  int index;
  int count;
  float sum;
  float sq_sum;
} MovingStats;

static MovingStats stats;

EMSCRIPTEN_KEEPALIVE
void init_stats(void) {
  stats.index = 0;
  stats.count = 0;
  stats.sum = 0.0f;
  stats.sq_sum = 0.0f;
  for (int i = 0; i < WINDOW_SIZE; i++) {
    stats.buffer[i] = 0.0f;
  }
}

EMSCRIPTEN_KEEPALIVE
int analyze_power_draw(float current_draw) {
  // Reject negative or non-finite readings
  if (isnan(current_draw) || isinf(current_draw) || current_draw < 0.0f) {
    return -2; // -2 = Invalid input measurement
  }

  // Remove oldest value if rolling window is full
  if (stats.count == WINDOW_SIZE) {
    float oldest = stats.buffer[stats.index];
    stats.sum -= oldest;
    stats.sq_sum -= (oldest * oldest);
  } else {
    stats.count++;
  }

  // Add new value to moving stats
  stats.buffer[stats.index] = current_draw;
  stats.sum += current_draw;
  stats.sq_sum += (current_draw * current_draw);
  stats.index = (stats.index + 1) % WINDOW_SIZE;

  // Need at least 5 samples to calculate meaningful statistical z-score
  if (stats.count < 5) {
    return -1; // -1 = Insufficient Data
  }

  float mean = stats.sum / (float)stats.count;
  float variance = (stats.sq_sum / (float)stats.count) - (mean * mean);

  // Prevent negative variance due to floating point inaccuracies
  if (variance < 0.0f) {
    variance = 0.0f;
  }

  float std_dev = sqrtf(variance);

  // Avoid division by zero if all values are identical
  if (std_dev < 0.001f) {
    return 0; // 0 = Normal
  }

  float z_score = fabsf((current_draw - mean) / std_dev);

  if (z_score > Z_SCORE_THRESHOLD) {
    if (current_draw > mean) {
      return 1; // 1 = Anomaly Spike (Potential Overload)
    } else {
      return 2; // 2 = Anomaly Drop (Potential Disconnect/Failure)
    }
  }

  return 0; // 0 = Normal
}

EMSCRIPTEN_KEEPALIVE
float get_moving_average(void) {
  if (stats.count == 0) {
    return 0.0f;
  }
  return stats.sum / (float)stats.count;
}

EMSCRIPTEN_KEEPALIVE
int get_sample_count(void) {
  return stats.count;
}
