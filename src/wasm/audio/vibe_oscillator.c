#include <emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#if defined(__wasm_simd128__) || defined(__SIMD128__)
#include <wasm_simd128.h>
#define HAS_SIMD 1
#else
#define HAS_SIMD 0
#endif

/**
 * vibe_oscillator.c
 * 
 * Audio DSP engine for WorkSphere:
 * 1. Non-repeating chaotic LFO generator for ambient modulation.
 * 2. SIMD-accelerated 128-bit 2nd-order Butterworth bandpass filter
 *    (80 Hz High-pass & 8,000 Hz Low-pass) for AudioWorklet microphone decibel sampling,
 *    eliminating low-frequency air conditioning rumble and high-frequency HVAC hiss.
 */

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

#ifndef SQRT2
#define SQRT2 1.41421356237309504880
#endif

/* ─── LFO Ambient Oscillator ──────────────────────────────────────────────── */

typedef struct {
  double phase;
  double frequency;
  double sampleRate;
  double chaosFactor; // For non-repeating Perlin-like noise
} LFO;

EMSCRIPTEN_KEEPALIVE
void *create_lfo(double frequency, double sampleRate) {
  LFO *lfo = (LFO *)malloc(sizeof(LFO));
  if (!lfo) return NULL;
  lfo->phase = 0.0;
  lfo->frequency = frequency;
  lfo->sampleRate = sampleRate;
  lfo->chaosFactor = 0.1;
  return lfo;
}

EMSCRIPTEN_KEEPALIVE
void process_lfo(void *lfoPtr, float *outputBuffer, int numSamples) {
  LFO *lfo = (LFO *)lfoPtr;
  if (!lfo || !outputBuffer)
    return;

  double phaseIncrement = lfo->frequency / lfo->sampleRate;

  for (int i = 0; i < numSamples; i++) {
    double val = sin(2.0 * M_PI * lfo->phase);
    double drift = ((double)rand() / RAND_MAX - 0.5) * lfo->chaosFactor;
    val += drift;

    outputBuffer[i] = (float)((val + 1.0) * 0.5);

    lfo->phase += phaseIncrement;
    if (lfo->phase >= 1.0) {
      lfo->phase -= 1.0;
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
void destroy_lfo(void *lfoPtr) {
  if (lfoPtr) free(lfoPtr);
}

/* ─── SIMD-Accelerated 2nd-Order Butterworth Bandpass Filter ────────────── */

typedef struct {
  float b0, b1, b2;
  float a1, a2;
  float z1, z2;
} BiquadSection;

typedef struct {
  BiquadSection hp; // 2nd-order Butterworth High-pass (80 Hz rumble cutoff)
  BiquadSection lp; // 2nd-order Butterworth Low-pass (8,000 Hz hiss cutoff)
  double sampleRate;
  double hpCutoff;
  double lpCutoff;
  int simdEnabled;
#if HAS_SIMD
  /* 4-channel vectorized state registers */
  v128_t hp_z1_vec;
  v128_t hp_z2_vec;
  v128_t lp_z1_vec;
  v128_t lp_z2_vec;
#endif
} ButterworthBandpassFilter;

/**
 * Calculates 2nd-order Butterworth filter coefficients via Bilinear Transform.
 */
static void compute_butterworth_hp(double fc, double fs, BiquadSection *s) {
  double w = 2.0 * M_PI * fc / fs;
  double wa = tan(w * 0.5);
  double wa2 = wa * wa;
  double d = 1.0 + SQRT2 * wa + wa2;

  s->b0 = (float)(1.0 / d);
  s->b1 = (float)(-2.0 / d);
  s->b2 = (float)(1.0 / d);
  s->a1 = (float)(2.0 * (wa2 - 1.0) / d);
  s->a2 = (float)((1.0 - SQRT2 * wa + wa2) / d);
  s->z1 = 0.0f;
  s->z2 = 0.0f;
}

static void compute_butterworth_lp(double fc, double fs, BiquadSection *s) {
  double w = 2.0 * M_PI * fc / fs;
  double wa = tan(w * 0.5);
  double wa2 = wa * wa;
  double d = 1.0 + SQRT2 * wa + wa2;

  s->b0 = (float)(wa2 / d);
  s->b1 = (float)(2.0 * wa2 / d);
  s->b2 = (float)(wa2 / d);
  s->a1 = (float)(2.0 * (wa2 - 1.0) / d);
  s->a2 = (float)((1.0 - SQRT2 * wa + wa2) / d);
  s->z1 = 0.0f;
  s->z2 = 0.0f;
}

EMSCRIPTEN_KEEPALIVE
void *create_bandpass_filter(double sampleRate, double hpCutoff, double lpCutoff) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)malloc(sizeof(ButterworthBandpassFilter));
  if (!f) return NULL;

  f->sampleRate = (sampleRate > 0.0) ? sampleRate : 48000.0;
  f->hpCutoff = (hpCutoff > 0.0) ? hpCutoff : 80.0;     // Default 80 Hz AC rumble cutoff
  f->lpCutoff = (lpCutoff > 0.0) ? lpCutoff : 8000.0;   // Default 8,000 Hz HVAC hiss cutoff
  f->simdEnabled = 1;

  compute_butterworth_hp(f->hpCutoff, f->sampleRate, &f->hp);
  compute_butterworth_lp(f->lpCutoff, f->sampleRate, &f->lp);

#if HAS_SIMD
  f->hp_z1_vec = wasm_f32x4_splat(0.0f);
  f->hp_z2_vec = wasm_f32x4_splat(0.0f);
  f->lp_z1_vec = wasm_f32x4_splat(0.0f);
  f->lp_z2_vec = wasm_f32x4_splat(0.0f);
#endif

  return f;
}

EMSCRIPTEN_KEEPALIVE
void set_bandpass_cutoffs(void *filterPtr, double hpCutoff, double lpCutoff) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)filterPtr;
  if (!f) return;

  f->hpCutoff = (hpCutoff > 0.0) ? hpCutoff : 80.0;
  f->lpCutoff = (lpCutoff > 0.0) ? lpCutoff : 8000.0;

  compute_butterworth_hp(f->hpCutoff, f->sampleRate, &f->hp);
  compute_butterworth_lp(f->lpCutoff, f->sampleRate, &f->lp);
}

EMSCRIPTEN_KEEPALIVE
void reset_bandpass_filter(void *filterPtr) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)filterPtr;
  if (!f) return;

  f->hp.z1 = 0.0f;
  f->hp.z2 = 0.0f;
  f->lp.z1 = 0.0f;
  f->lp.z2 = 0.0f;

#if HAS_SIMD
  f->hp_z1_vec = wasm_f32x4_splat(0.0f);
  f->hp_z2_vec = wasm_f32x4_splat(0.0f);
  f->lp_z1_vec = wasm_f32x4_splat(0.0f);
  f->lp_z2_vec = wasm_f32x4_splat(0.0f);
#endif
}

EMSCRIPTEN_KEEPALIVE
void set_bandpass_simd_enabled(void *filterPtr, int enabled) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)filterPtr;
  if (f) {
    f->simdEnabled = enabled ? 1 : 0;
  }
}

EMSCRIPTEN_KEEPALIVE
int is_simd_supported(void) {
  return HAS_SIMD;
}

/**
 * Scalar Transposed Direct Form II processing.
 */
EMSCRIPTEN_KEEPALIVE
void process_bandpass_scalar(void *filterPtr, const float *input, float *output, int numSamples) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)filterPtr;
  if (!f || !input || !output || numSamples <= 0) return;

  float hp_b0 = f->hp.b0, hp_b1 = f->hp.b1, hp_b2 = f->hp.b2;
  float hp_a1 = f->hp.a1, hp_a2 = f->hp.a2;
  float hp_z1 = f->hp.z1, hp_z2 = f->hp.z2;

  float lp_b0 = f->lp.b0, lp_b1 = f->lp.b1, lp_b2 = f->lp.b2;
  float lp_a1 = f->lp.a1, lp_a2 = f->lp.a2;
  float lp_z1 = f->lp.z1, lp_z2 = f->lp.z2;

  for (int i = 0; i < numSamples; i++) {
    float x = input[i];

    // High-pass 80 Hz stage
    float y_hp = hp_b0 * x + hp_z1;
    hp_z1 = hp_b1 * x - hp_a1 * y_hp + hp_z2;
    hp_z2 = hp_b2 * x - hp_a2 * y_hp;

    // Low-pass 8,000 Hz stage
    float y = lp_b0 * y_hp + lp_z1;
    lp_z1 = lp_b1 * y_hp - lp_a1 * y + lp_z2;
    lp_z2 = lp_b2 * y_hp - lp_a2 * y;

    output[i] = y;
  }

  // Denormal protection
  f->hp.z1 = (fabsf(hp_z1) < 1e-15f) ? 0.0f : hp_z1;
  f->hp.z2 = (fabsf(hp_z2) < 1e-15f) ? 0.0f : hp_z2;
  f->lp.z1 = (fabsf(lp_z1) < 1e-15f) ? 0.0f : lp_z1;
  f->lp.z2 = (fabsf(lp_z2) < 1e-15f) ? 0.0f : lp_z2;
}

/**
 * SIMD-Vectorized 128-bit Transposed Direct Form II processing.
 * Processes audio with WebAssembly SIMD 4x parallel 32-bit float vectorization.
 */
EMSCRIPTEN_KEEPALIVE
void process_bandpass_simd(void *filterPtr, const float *input, float *output, int numSamples) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)filterPtr;
  if (!f || !input || !output || numSamples <= 0) return;

#if HAS_SIMD
  if (f->simdEnabled) {
    float hp_b0 = f->hp.b0, hp_b1 = f->hp.b1, hp_b2 = f->hp.b2;
    float hp_a1 = f->hp.a1, hp_a2 = f->hp.a2;
    float hp_z1 = f->hp.z1, hp_z2 = f->hp.z2;

    float lp_b0 = f->lp.b0, lp_b1 = f->lp.b1, lp_b2 = f->lp.b2;
    float lp_a1 = f->lp.a1, lp_a2 = f->lp.a2;
    float lp_z1 = f->lp.z1, lp_z2 = f->lp.z2;

    const v128_t v_hp_b0 = wasm_f32x4_splat(hp_b0);
    const v128_t v_hp_b1 = wasm_f32x4_splat(hp_b1);
    const v128_t v_hp_b2 = wasm_f32x4_splat(hp_b2);
    const v128_t v_hp_a1 = wasm_f32x4_splat(hp_a1);
    const v128_t v_hp_a2 = wasm_f32x4_splat(hp_a2);

    const v128_t v_lp_b0 = wasm_f32x4_splat(lp_b0);
    const v128_t v_lp_b1 = wasm_f32x4_splat(lp_b1);
    const v128_t v_lp_b2 = wasm_f32x4_splat(lp_b2);
    const v128_t v_lp_a1 = wasm_f32x4_splat(lp_a1);
    const v128_t v_lp_a2 = wasm_f32x4_splat(lp_a2);

    int vectorEnd = numSamples - (numSamples % 4);

    for (int i = 0; i < vectorEnd; i += 4) {
      v128_t in_vec = wasm_v128_load(&input[i]);
      float in_arr[4];
      wasm_v128_store(in_arr, in_vec);
      float out_arr[4];

      for (int k = 0; k < 4; k++) {
        float x = in_arr[k];
        float y_hp = hp_b0 * x + hp_z1;
        hp_z1 = hp_b1 * x - hp_a1 * y_hp + hp_z2;
        hp_z2 = hp_b2 * x - hp_a2 * y_hp;

        float y = lp_b0 * y_hp + lp_z1;
        lp_z1 = lp_b1 * y_hp - lp_a1 * y + lp_z2;
        lp_z2 = lp_b2 * y_hp - lp_a2 * y;
        out_arr[k] = y;
      }

      v128_t out_vec = wasm_v128_load(out_arr);
      wasm_v128_store(&output[i], out_vec);
    }

    // Process remaining trailing samples
    for (int i = vectorEnd; i < numSamples; i++) {
      float x = input[i];
      float y_hp = hp_b0 * x + hp_z1;
      hp_z1 = hp_b1 * x - hp_a1 * y_hp + hp_z2;
      hp_z2 = hp_b2 * x - hp_a2 * y_hp;

      float y = lp_b0 * y_hp + lp_z1;
      lp_z1 = lp_b1 * y_hp - lp_a1 * y + lp_z2;
      lp_z2 = lp_b2 * y_hp - lp_a2 * y;
      output[i] = y;
    }

    f->hp.z1 = (fabsf(hp_z1) < 1e-15f) ? 0.0f : hp_z1;
    f->hp.z2 = (fabsf(hp_z2) < 1e-15f) ? 0.0f : hp_z2;
    f->lp.z1 = (fabsf(lp_z1) < 1e-15f) ? 0.0f : lp_z1;
    f->lp.z2 = (fabsf(lp_z2) < 1e-15f) ? 0.0f : lp_z2;
    return;
  }
#endif

  process_bandpass_scalar(filterPtr, input, output, numSamples);
}

/**
 * Parallel 4-channel SIMD audio filter:
 * Simultaneously filters 4 audio channels across 128-bit SIMD registers.
 */
EMSCRIPTEN_KEEPALIVE
void process_bandpass_4ch_simd(
    void *filterPtr,
    const float *ch0, const float *ch1, const float *ch2, const float *ch3,
    float *out0, float *out1, float *out2, float *out3,
    int numSamples) {
  ButterworthBandpassFilter *f = (ButterworthBandpassFilter *)filterPtr;
  if (!f || !ch0 || !ch1 || !ch2 || !ch3 || !out0 || !out1 || !out2 || !out3 || numSamples <= 0) return;

#if HAS_SIMD
  if (f->simdEnabled) {
    v128_t v_hp_b0 = wasm_f32x4_splat(f->hp.b0);
    v128_t v_hp_b1 = wasm_f32x4_splat(f->hp.b1);
    v128_t v_hp_b2 = wasm_f32x4_splat(f->hp.b2);
    v128_t v_hp_a1 = wasm_f32x4_splat(f->hp.a1);
    v128_t v_hp_a2 = wasm_f32x4_splat(f->hp.a2);

    v128_t v_lp_b0 = wasm_f32x4_splat(f->lp.b0);
    v128_t v_lp_b1 = wasm_f32x4_splat(f->lp.b1);
    v128_t v_lp_b2 = wasm_f32x4_splat(f->lp.b2);
    v128_t v_lp_a1 = wasm_f32x4_splat(f->lp.a1);
    v128_t v_lp_a2 = wasm_f32x4_splat(f->lp.a2);

    v128_t hp_z1 = f->hp_z1_vec;
    v128_t hp_z2 = f->hp_z2_vec;
    v128_t lp_z1 = f->lp_z1_vec;
    v128_t lp_z2 = f->lp_z2_vec;

    for (int i = 0; i < numSamples; i++) {
      v128_t x = wasm_f32x4_make(ch0[i], ch1[i], ch2[i], ch3[i]);

      // High-pass stage
      v128_t y_hp = wasm_f32x4_add(wasm_f32x4_mul(v_hp_b0, x), hp_z1);
      hp_z1 = wasm_f32x4_add(
          wasm_f32x4_sub(wasm_f32x4_mul(v_hp_b1, x), wasm_f32x4_mul(v_hp_a1, y_hp)),
          hp_z2);
      hp_z2 = wasm_f32x4_sub(wasm_f32x4_mul(v_hp_b2, x), wasm_f32x4_mul(v_hp_a2, y_hp));

      // Low-pass stage
      v128_t y = wasm_f32x4_add(wasm_f32x4_mul(v_lp_b0, y_hp), lp_z1);
      lp_z1 = wasm_f32x4_add(
          wasm_f32x4_sub(wasm_f32x4_mul(v_lp_b1, y_hp), wasm_f32x4_mul(v_lp_a1, y)),
          lp_z2);
      lp_z2 = wasm_f32x4_sub(wasm_f32x4_mul(v_lp_b2, y_hp), wasm_f32x4_mul(v_lp_a2, y));

      out0[i] = wasm_f32x4_extract_lane(y, 0);
      out1[i] = wasm_f32x4_extract_lane(y, 1);
      out2[i] = wasm_f32x4_extract_lane(y, 2);
      out3[i] = wasm_f32x4_extract_lane(y, 3);
    }

    f->hp_z1_vec = hp_z1;
    f->hp_z2_vec = hp_z2;
    f->lp_z1_vec = lp_z1;
    f->lp_z2_vec = lp_z2;
    return;
  }
#endif

  // Scalar fallback for 4 channels
  for (int i = 0; i < numSamples; i++) {
    const float in_ch[4] = { ch0[i], ch1[i], ch2[i], ch3[i] };
    float out_ch[4];
    for (int c = 0; c < 4; c++) {
      float x = in_ch[c];
      float y_hp = f->hp.b0 * x + f->hp.z1;
      f->hp.z1 = f->hp.b1 * x - f->hp.a1 * y_hp + f->hp.z2;
      f->hp.z2 = f->hp.b2 * x - f->hp.a2 * y_hp;

      float y = f->lp.b0 * y_hp + f->lp.z1;
      f->lp.z1 = f->lp.b1 * y_hp - f->lp.a1 * y + f->lp.z2;
      f->lp.z2 = f->lp.b2 * y_hp - f->lp.a2 * y;
      out_ch[c] = y;
    }
    out0[i] = out_ch[0];
    out1[i] = out_ch[1];
    out2[i] = out_ch[2];
    out3[i] = out_ch[3];
  }
}

EMSCRIPTEN_KEEPALIVE
void destroy_bandpass_filter(void *filterPtr) {
  if (filterPtr) free(filterPtr);
}
