#include <emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

/**
 * C implementation of a granular synthesis engine that manipulates
 * micro-samples of audio to create evolving textures.
 */

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct {
  float *buffer;
  int length;
  int sampleRate;
} GrainSource;

typedef struct {
  float position;
  float duration;
  float pitch;
  float amplitude;
  int active;
} Grain;

// Hanning window function to prevent clicks at grain boundaries
static float hanning_window(float phase) {
  return 0.5 * (1.0 - cos(2.0 * M_PI * phase));
}

EMSCRIPTEN_KEEPALIVE
void *create_grain_source(int length, int sampleRate) {
  GrainSource *src = (GrainSource *)malloc(sizeof(GrainSource));
  src->buffer = (float *)calloc(length, sizeof(float));
  src->length = length;
  src->sampleRate = sampleRate;
  return src;
}

EMSCRIPTEN_KEEPALIVE
void load_grain_buffer(void *sourcePtr, float *inputData, int length) {
  GrainSource *src = (GrainSource *)sourcePtr;
  int copyLen = length < src->length ? length : src->length;
  memcpy(src->buffer, inputData, copyLen * sizeof(float));
}

/**
 * Generates a block of audio samples using granular synthesis.
 * @param sourcePtr Pointer to the GrainSource
 * @param outputBuffer Pre-allocated output float array
 * @param numSamples Number of samples to generate
 * @param grainDensity Number of grains per second
 * @param grainDurationMs Duration of each grain in milliseconds
 * @param pitchShift Pitch multiplier (1.0 = normal)
 */
EMSCRIPTEN_KEEPALIVE
void synthesize_grains(void *sourcePtr, float *outputBuffer, int numSamples,
                       float grainDensity, float grainDurationMs,
                       float pitchShift) {
  GrainSource *src = (GrainSource *)sourcePtr;
  if (!src || !src->buffer)
    return;

  int grainDurationSamples =
      (int)((grainDurationMs / 1000.0) * src->sampleRate);
  float grainsPerSample = grainDensity / src->sampleRate;

  // Initialize output to zero
  memset(outputBuffer, 0, numSamples * sizeof(float));

  // Simplified granular engine: spawn grains probabilistically
  for (int i = 0; i < numSamples; i++) {
    if ((float)rand() / RAND_MAX < grainsPerSample) {
      int startPos = rand() % (src->length - grainDurationSamples);

      for (int g = 0; g < grainDurationSamples; g++) {
        int outIdx = i + g;
        if (outIdx >= numSamples)
          break;

        float phase = (float)g / grainDurationSamples;
        float window = hanning_window(phase);

        int srcIdx = startPos + (int)(g * pitchShift);
        if (srcIdx >= src->length)
          srcIdx = src->length - 1;

        outputBuffer[outIdx] += src->buffer[srcIdx] * window * 0.5;
      }
    }
  }
}

EMSCRIPTEN_KEEPALIVE
void destroy_grain_source(void *sourcePtr) {
  GrainSource *src = (GrainSource *)sourcePtr;
  if (src) {
    free(src->buffer);
    free(src);
  }
}
