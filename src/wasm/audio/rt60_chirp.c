#include <emscripten.h>
#include <math.h>
#include <stdlib.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

/**
 * Generates a logarithmic sine sweep (chirp) used to measure room impulse
 * response.
 * @param buffer Output float32 array
 * @param sample_rate Audio sample rate (e.g., 44100 or 48000)
 * @param duration_sec Duration of the sweep in seconds
 * @param f1 Start frequency (e.g., 20 Hz)
 * @param f2 End frequency (e.g., 20000 Hz)
 */
EMSCRIPTEN_KEEPALIVE
void generate_log_chirp(float *buffer, int sample_rate, float duration_sec,
                        float f1, float f2) {
  int num_samples = (int)(sample_rate * duration_sec);
  float k = log(f2 / f1) / duration_sec;

  for (int i = 0; i < num_samples; i++) {
    float t = (float)i / sample_rate;
    buffer[i] = sin((2.0 * M_PI * f1 / k) * (exp(k * t) - 1.0));
  }
}

/**
 * Cross-correlates the recorded microphone signal with the original chirp
 * to extract the Room Impulse Response (RIR).
 */
EMSCRIPTEN_KEEPALIVE
void extract_impulse_response(float *recorded, float *chirp, float *rir,
                              int rec_len, int chirp_len) {
  // Simplified cross-correlation (Fast Hadamard Transform or FFT is preferred
  // in production)
  for (int i = 0; i < rec_len - chirp_len; i++) {
    float sum = 0.0;
    for (int j = 0; j < chirp_len; j++) {
      sum += recorded[i + j] * chirp[j];
    }
    rir[i] = sum;
  }
}