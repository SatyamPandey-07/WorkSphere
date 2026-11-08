#include <emscripten.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>

#define WINDOW_SIZE 20
#define Z_SCORE_THRESHOLD 2.5

typedef struct {
  float buffer[WINDOW_SIZE];
  int index;
  int count;
  float sum;
  float sq_sum;
} MovingStats;

MovingStats stats;

EMSCRIPTEN_KEEPALIVE
void init_stats() {
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
  // Remove oldest value if window is full
  if (stats.count == WINDOW_SIZE) {
    float oldest = stats.buffer[stats.index];
    stats.sum -= oldest;
    stats.sq_sum -= (oldest * oldest);
  } else {
    stats.count++;
  }

  // Add new value
  stats.buffer[stats.index] = current_draw;
  stats.sum += current_draw;
  stats.sq_sum += (current_draw * current_draw);
  stats.index = (stats.index + 1) % WINDOW_SIZE;

  // Need at least 5 samples to calculate meaningful stats
  if (stats.count < 5) {
    return 0; // 0 = Normal / Insufficient Data
  }

  float mean = stats.sum / stats.count;
  float variance = (stats.sq_sum / stats.count) - (mean * mean);

  // Prevent negative variance due to floating point inaccuracies
  if (variance < 0.0f)
    variance = 0.0f;

  float std_dev = sqrtf(variance);

  // Avoid division by zero if all values are identical
  if (std_dev < 0.001f) {
    return 0;
  }

  float z_score = fabsf((current_draw - mean) / std_dev);

  if (z_score > Z_SCORE_THRESHOLD) {
    if (current_draw > mean) {
      return 1; // 1 = Anomaly Spike (Potential Overload)
    } else {
      return 2; // 2 = Anomaly Drop (Potential Disconnect/Failure)
    }
  }

  return 0; // Normal
}

EMSCRIPTEN_KEEPALIVE
float get_moving_average() {
  if (stats.count == 0)
    return 0.0f;
  return stats.sum / stats.count;
}
