#include <emscripten.h>
#include <math.h>

#define PERCLOS_WINDOW_FRAMES 150 // ~5 seconds at 30fps
#define EAR_THRESHOLD 0.20f

typedef struct {
  int closed_frames;
  int total_frames;
  int blink_count;
  long last_blink_time;
  int is_eye_closed;
} FatigueState;

FatigueState state;

EMSCRIPTEN_KEEPALIVE
void init_scorer() {
  state.closed_frames = 0;
  state.total_frames = 0;
  state.blink_count = 0;
  state.last_blink_time = 0;
  state.is_eye_closed = 0;
}

EMSCRIPTEN_KEEPALIVE
int update_fatigue_score(float left_ear, float right_ear,
                         long current_time_ms) {
  float avg_ear = (left_ear + right_ear) / 2.0f;
  state.total_frames++;

  if (avg_ear < EAR_THRESHOLD) {
    state.closed_frames++;
    if (!state.is_eye_closed) {
      state.is_eye_closed = 1;
      state.blink_count++;
      state.last_blink_time = current_time_ms;
    }
  } else {
    state.is_eye_closed = 0;
  }

  // Reset window if it exceeds size
  if (state.total_frames > PERCLOS_WINDOW_FRAMES) {
    state.total_frames = PERCLOS_WINDOW_FRAMES;
    // Approximate decay of closed frames to maintain rolling window
    state.closed_frames = (int)(state.closed_frames * 0.95f);
  }

  return 0;
}

EMSCRIPTEN_KEEPALIVE
float get_perclos() {
  if (state.total_frames == 0)
    return 0.0f;
  return (float)state.closed_frames / (float)state.total_frames;
}

EMSCRIPTEN_KEEPALIVE
int get_blink_rate_per_min(long current_time_ms) {
  // Simplified: assume 1 minute window for calculation
  // In production, track timestamps of all blinks in a queue
  return state.blink_count;
}

EMSCRIPTEN_KEEPALIVE
int get_fatigue_level() {
  float perclos = get_perclos();

  // PERCLOS > 0.4 indicates severe fatigue
  if (perclos > 0.40f)
    return 3; // CRITICAL
  if (perclos > 0.25f)
    return 2; // HIGH
  if (perclos > 0.15f)
    return 1; // MODERATE

  return 0; // NORMAL
}
