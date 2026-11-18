#include <emscripten.h>
#include <math.h>
#include <stdlib.h>

#define FRAME_SIZE 512
#define SAMPLE_RATE 16000
#define ENERGY_THRESHOLD 0.015f

typedef struct {
  int is_speech;
  int speech_start_frame;
  int silence_frames;
  float running_energy;
} VADState;

VADState state;

EMSCRIPTEN_KEEPALIVE
void init_vad() {
  state.is_speech = 0;
  state.speech_start_frame = 0;
  state.silence_frames = 0;
  state.running_energy = 0.0f;
}

// Simple Energy-based VAD (Mocking Silero's lightweight edge inference)
// In production, this would run a quantized ONNX model via WASM
EMSCRIPTEN_KEEPALIVE
int process_audio_frame(float *pcm_data, int frame_count,
                        int current_frame_index) {
  if (frame_count <= 0)
    return state.is_speech;

  // Calculate RMS energy for the frame
  float sum_sq = 0.0f;
  for (int i = 0; i < frame_count; i++) {
    sum_sq += pcm_data[i] * pcm_data[i];
  }
  float rms = sqrtf(sum_sq / frame_count);

  // Apply simple exponential moving average to smooth energy
  state.running_energy = (state.running_energy * 0.9f) + (rms * 0.1f);

  int is_active = (rms > ENERGY_THRESHOLD) ? 1 : 0;

  if (is_active) {
    state.silence_frames = 0;
    if (!state.is_speech) {
      state.is_speech = 1;
      state.speech_start_frame = current_frame_index;
    }
  } else {
    state.silence_frames++;
    // Require 15 consecutive silent frames (~300ms at 50fps) to declare end of
    // speech
    if (state.silence_frames > 15 && state.is_speech) {
      state.is_speech = 0;
    }
  }

  return state.is_speech;
}

EMSCRIPTEN_KEEPALIVE
int get_speech_start_frame() { return state.speech_start_frame; }

EMSCRIPTEN_KEEPALIVE
float get_current_energy() { return state.running_energy; }