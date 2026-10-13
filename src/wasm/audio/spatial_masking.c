/**
 * spatial_masking.c
 * Generates inverse phase signals and frequency-matched noise masks to
 * neutralize audio leakage. Used in conjunction with beamforming to create a
 * "privacy zone" around the user.
 *
 * Hardened against variable sample rates (44.1kHz, 48kHz, 96kHz, 192kHz)
 * with dynamic FFT buffer dimensioning, strict bounds checking before windowing
 * dot-products, and safe multi-channel audio chunking (#5888).
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define FRAME_SIZE 512
#define DEFAULT_SAMPLE_RATE 44100
#define MIN_SAMPLE_RATE 8000
#define MAX_SAMPLE_RATE 192000
#define MIN_BLOCK_SIZE 64
#define MAX_BLOCK_SIZE 16384
#define DEFAULT_BLOCK_SIZE 2048
#define PI 3.14159265358979323846f

/**
 * State container for spatial masking FFT windowing and buffer management.
 */
typedef struct {
  float *window_buffer;       // Precomputed Hann window coefficients
  float *temp_in;             // Internal working buffer for windowed input
  float *temp_out;            // Internal working buffer for masked synthesis
  int window_size;            // Current allocated capacity of window and working buffers
  int configured_sample_rate; // Currently configured sample rate in Hz
  int configured_block_size;  // Currently configured block size in samples
  int is_initialized;
} SpatialMaskingState;

// ─── MEMORY UTILITIES FOR WASM RUNTIME ────────────────────────────────────────

void *wasm_malloc(size_t size) {
  if (size == 0)
    return NULL;
  return malloc(size);
}

void wasm_free(void *ptr) {
  if (ptr) {
    free(ptr);
  }
}

// ─── HANN WINDOWING & BUFFER DIMENSIONING (#5888) ──────────────────────────────

/**
 * Calculates the smallest power of 2 greater than or equal to n.
 */
static int next_power_of_two(int n) {
  if (n <= MIN_BLOCK_SIZE)
    return MIN_BLOCK_SIZE;
  if (n >= MAX_BLOCK_SIZE)
    return MAX_BLOCK_SIZE;

  int p = 1;
  while (p < n && p < MAX_BLOCK_SIZE) {
    p <<= 1;
  }
  return p;
}

/**
 * Generates Hann window coefficients into a preallocated float buffer.
 * w[i] = 0.5 * (1.0 - cos(2 * PI * i / (size - 1)))
 */
int init_hann_window(float *window, int window_size) {
  if (!window || window_size <= 0) {
    return -1;
  }

  if (window_size == 1) {
    window[0] = 1.0f;
    return 0;
  }

  for (int i = 0; i < window_size; i++) {
    window[i] =
        0.5f * (1.0f - cosf(2.0f * PI * (float)i / (float)(window_size - 1)));
  }

  return 0;
}

/**
 * Initializes or re-dimensions SpatialMaskingState FFT buffers based on
 * the incoming sample rate and block size.
 * Prevents heap buffer overflows when operating at 48kHz, 96kHz, etc. (#5888)
 */
int spatial_masking_init(SpatialMaskingState *state, int sample_rate,
                         int block_size) {
  if (!state) {
    return -1;
  }

  int safe_rate = sample_rate;
  if (safe_rate < MIN_SAMPLE_RATE || safe_rate > MAX_SAMPLE_RATE) {
    safe_rate = DEFAULT_SAMPLE_RATE;
  }

  int requested_size = block_size;
  if (requested_size <= 0) {
    // Dimension baseline based on sample rate
    if (safe_rate >= 96000) {
      requested_size = 4096;
    } else if (safe_rate >= 48000) {
      requested_size = 2048;
    } else {
      requested_size = DEFAULT_BLOCK_SIZE;
    }
  }

  int target_capacity = next_power_of_two(requested_size);
  if (target_capacity < MIN_BLOCK_SIZE) {
    target_capacity = MIN_BLOCK_SIZE;
  }
  if (target_capacity > MAX_BLOCK_SIZE) {
    target_capacity = MAX_BLOCK_SIZE;
  }

  // Reallocate only if current capacity is insufficient or uninitialized
  if (!state->is_initialized || state->window_size < target_capacity ||
      !state->window_buffer || !state->temp_in || !state->temp_out) {

    if (state->window_buffer)
      free(state->window_buffer);
    if (state->temp_in)
      free(state->temp_in);
    if (state->temp_out)
      free(state->temp_out);

    state->window_buffer = (float *)malloc(target_capacity * sizeof(float));
    state->temp_in = (float *)malloc(target_capacity * sizeof(float));
    state->temp_out = (float *)malloc(target_capacity * sizeof(float));

    if (!state->window_buffer || !state->temp_in || !state->temp_out) {
      if (state->window_buffer)
        free(state->window_buffer);
      if (state->temp_in)
        free(state->temp_in);
      if (state->temp_out)
        free(state->temp_out);
      state->window_buffer = NULL;
      state->temp_in = NULL;
      state->temp_out = NULL;
      state->window_size = 0;
      state->is_initialized = 0;
      return -1;
    }

    state->window_size = target_capacity;
  }

  // Precompute Hann window for the configured block size
  init_hann_window(state->window_buffer, target_capacity);

  state->configured_sample_rate = safe_rate;
  state->configured_block_size = target_capacity;
  state->is_initialized = 1;

  return 0;
}

/**
 * Ensures state buffers have enough capacity for num_samples and sample_rate.
 * Automatically re-dimensions when variable sample rates or larger block sizes are detected.
 */
int ensure_spatial_masking_capacity(SpatialMaskingState *state, int sample_rate,
                                    int num_samples) {
  if (!state) {
    return -1;
  }

  if (!state->is_initialized || state->window_size < num_samples ||
      state->configured_sample_rate != sample_rate) {
    return spatial_masking_init(state, sample_rate, num_samples);
  }

  return 0;
}

/**
 * Frees dynamic memory held by SpatialMaskingState.
 */
void spatial_masking_free(SpatialMaskingState *state) {
  if (!state) {
    return;
  }

  if (state->window_buffer) {
    free(state->window_buffer);
    state->window_buffer = NULL;
  }
  if (state->temp_in) {
    free(state->temp_in);
    state->temp_in = NULL;
  }
  if (state->temp_out) {
    free(state->temp_out);
    state->temp_out = NULL;
  }

  state->window_size = 0;
  state->configured_sample_rate = 0;
  state->configured_block_size = 0;
  state->is_initialized = 0;
}

/**
 * Applies Hann window to input buffer via element-wise dot-product.
 * Enforces strict bounds checking to prevent buffer overruns on variable sample rates.
 * Returns the number of samples processed, or -1 on error.
 */
int apply_hann_window(const float *input, float *output, int num_samples,
                      const float *window, int window_size) {
  // 1. Strict pointer validation
  if (!input || !output || !window) {
    return -1;
  }

  // 2. Sample size validation
  if (num_samples <= 0 || window_size <= 0) {
    return -1;
  }

  // 3. Strict bounds check before executing windowing dot-product (#5888)
  int process_samples = num_samples;
  if (process_samples > window_size) {
    process_samples = window_size;
  }

  // 4. Dot-product multiplication within safe bounds
  for (int i = 0; i < process_samples; i++) {
    output[i] = input[i] * window[i];
  }

  return process_samples;
}

// ─── PHASE INVERSION & SPEECH MASK GENERATION ──────────────────────────────────

void generate_phase_inversion_n(const float *input, float *output,
                                int num_samples) {
  if (!input || !output || num_samples <= 0) {
    return;
  }

  for (int i = 0; i < num_samples; i++) {
    output[i] = -input[i];
  }
}

// Legacy 512-sample phase inversion
void generate_phase_inversion(const float *input_frame, float *output_frame) {
  generate_phase_inversion_n(input_frame, output_frame, FRAME_SIZE);
}

/**
 * Generates pseudo-random masking noise shaped for human speech frequencies
 * (300Hz - 3400Hz), normalized to incoming sample rate.
 */
void generate_speech_mask_n(float *output, int num_samples, float intensity,
                            uint32_t seed, int sample_rate) {
  if (!output || num_samples <= 0) {
    return;
  }

  uint32_t state = seed;
  float rate = (float)(sample_rate > 0 ? sample_rate : DEFAULT_SAMPLE_RATE);
  // Base speech center frequency ~ 1000 Hz normalized by sample rate
  float omega = 2.0f * PI * 1000.0f / rate;

  for (int i = 0; i < num_samples; i++) {
    state = state * 1664525 + 1013904223;
    float noise = ((float)(state >> 16) / 32768.0f) - 1.0f;

    // Speech frequency modulation envelope
    float speech_band_energy = sinf((float)i * omega) * 0.5f + 0.5f;
    output[i] = noise * intensity * speech_band_energy;
  }
}

// Legacy 512-sample speech mask
void generate_speech_mask(float *output_frame, float intensity, uint32_t seed) {
  generate_speech_mask_n(output_frame, FRAME_SIZE, intensity, seed,
                         DEFAULT_SAMPLE_RATE);
}

// Legacy 512-sample privacy masking
void apply_privacy_masking(const float *captured_audio, float *output_frame,
                           float mask_intensity, uint32_t seed) {
  if (!captured_audio || !output_frame)
    return;

  float inverted[FRAME_SIZE];
  float mask[FRAME_SIZE];

  generate_phase_inversion(captured_audio, inverted);
  generate_speech_mask(mask, mask_intensity, seed);

  for (int i = 0; i < FRAME_SIZE; i++) {
    output_frame[i] = (inverted[i] * 0.3f) + (mask[i] * 0.7f);

    if (output_frame[i] > 1.0f)
      output_frame[i] = 1.0f;
    if (output_frame[i] < -1.0f)
      output_frame[i] = -1.0f;
  }
}

// ─── VARIABLE SAMPLE RATE MULTI-CHANNEL FILTER ENGINE (#5888) ─────────────────

/**
 * Processes a single audio channel through FFT Hann windowing, phase inversion,
 * and speech privacy masking with strict bounds enforcement.
 */
int spatial_masking_process_channel(SpatialMaskingState *state,
                                    const float *input, float *output,
                                    int num_samples, int sample_rate,
                                    float mask_intensity, uint32_t seed) {
  if (!state || !input || !output || num_samples <= 0) {
    return -1;
  }

  // Ensure dynamic buffer dimensioning covers num_samples
  if (ensure_spatial_masking_capacity(state, sample_rate, num_samples) != 0) {
    return -2;
  }

  // Process in chunks of state->window_size to guarantee zero buffer overrun
  int chunk_size = state->window_size;
  int processed = 0;

  while (processed < num_samples) {
    int current_chunk = num_samples - processed;
    if (current_chunk > chunk_size) {
      current_chunk = chunk_size;
    }

    const float *chunk_in = input + processed;
    float *chunk_out = output + processed;

    // 1. Hann windowing with bounds check
    int windowed = apply_hann_window(chunk_in, state->temp_in, current_chunk,
                                     state->window_buffer, state->window_size);
    if (windowed <= 0) {
      return -3;
    }

    // 2. Generate phase inversion on windowed signal
    generate_phase_inversion_n(state->temp_in, state->temp_in, windowed);

    // 3. Generate speech privacy mask
    generate_speech_mask_n(state->temp_out, windowed, mask_intensity,
                           seed + (uint32_t)processed, sample_rate);

    // 4. Mix cancellation and masking noise with hard clipping
    for (int i = 0; i < windowed; i++) {
      float mixed = (state->temp_in[i] * 0.3f) + (state->temp_out[i] * 0.7f);
      if (mixed > 1.0f)
        mixed = 1.0f;
      if (mixed < -1.0f)
        mixed = -1.0f;
      chunk_out[i] = mixed;
    }

    processed += windowed;
  }

  return 0;
}

/**
 * Processes multi-channel audio streams (e.g. 2 channels stereo, 4 channels mic array)
 * across variable sample rates (44.1kHz, 48kHz, 96kHz, 192kHz).
 * Dynamically re-dimensions FFT buffers and prevents WASM linear memory corruption.
 */
int process_spatial_masking_multichannel(SpatialMaskingState *state,
                                        const float *const *input_channels,
                                        float **output_channels,
                                        int num_channels, int num_samples,
                                        int sample_rate, float mask_intensity,
                                        uint32_t seed) {
  if (!state || !input_channels || !output_channels) {
    return -1;
  }

  if (num_channels <= 0 || num_samples <= 0) {
    return -1;
  }

  // Dimension state once for all channels in this block
  if (ensure_spatial_masking_capacity(state, sample_rate, num_samples) != 0) {
    return -2;
  }

  for (int ch = 0; ch < num_channels; ch++) {
    if (!input_channels[ch] || !output_channels[ch]) {
      return -3;
    }

    uint32_t channel_seed = seed + (uint32_t)(ch * 7919);
    int res = spatial_masking_process_channel(
        state, input_channels[ch], output_channels[ch], num_samples,
        sample_rate, mask_intensity, channel_seed);

    if (res != 0) {
      return res;
    }
  }

  return 0;
}