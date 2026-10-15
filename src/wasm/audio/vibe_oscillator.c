#include <emscripten.h>
#include <math.h>
#include <stdlib.h>

/**
 * Generates complex, non-repeating low-frequency oscillators (LFOs)
 * to modulate filter cutoffs and pitch dynamically.
 */

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct {
  double phase;
  double frequency;
  double sampleRate;
  double chaosFactor; // For non-repeating Perlin-like noise
} LFO;

EMSCRIPTEN_KEEPALIVE
void *create_lfo(double frequency, double sampleRate) {
  LFO *lfo = (LFO *)malloc(sizeof(LFO));
  lfo->phase = 0.0;
  lfo->frequency = frequency;
  lfo->sampleRate = sampleRate;
  lfo->chaosFactor = 0.1;
  return lfo;
}

/**
 * Generates a block of LFO values with slight chaotic modulation
 * to ensure the ambient track never perfectly loops.
 */
EMSCRIPTEN_KEEPALIVE
void process_lfo(void *lfoPtr, float *outputBuffer, int numSamples) {
  LFO *lfo = (LFO *)lfoPtr;
  if (!lfo)
    return;

  double phaseIncrement = lfo->frequency / lfo->sampleRate;

  for (int i = 0; i < numSamples; i++) {
    // Base sine wave
    double val = sin(2.0 * M_PI * lfo->phase);

    // Add chaotic drift (simplified random walk)
    double drift = ((double)rand() / RAND_MAX - 0.5) * lfo->chaosFactor;
    val += drift;

    // Normalize to 0.0 - 1.0 range for modulation
    outputBuffer[i] = (float)((val + 1.0) * 0.5);

    lfo->phase += phaseIncrement;
    if (lfo->phase >= 1.0) {
      lfo->phase -= 1.0;
      // Slightly alter frequency on loop to prevent exact repetition
      lfo->frequency += ((double)rand() / RAND_MAX - 0.5) * 0.01;
    }
  }
}

EMSCRIPTEN_KEEPALIVE
void set_lfo_frequency(void *lfoPtr, double frequency) {
  LFO *lfo = (LFO *)lfoPtr;
  if (lfo)
    lfo->frequency = frequency;
}

EMSCRIPTEN_KEEPALIVE
void destroy_lfo(void *lfoPtr) { free(lfoPtr); }
