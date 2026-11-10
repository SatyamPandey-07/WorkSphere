#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define EXPORT __attribute__((visibility("default")))
#define SAMPLE_RATE 44100
#define PI 3.14159265358979323846

typedef struct {
  float frequency;
  float amplitude;
  float decay;
  float phase;
} AcousticProfile;

static AcousticProfile mechanical_profiles[5];
static uint32_t rng_state = 123456789;

uint32_t xorshift32() {
  rng_state ^= rng_state << 13;
  rng_state ^= rng_state >> 17;
  rng_state ^= rng_state << 5;
  return rng_state;
}

float random_float() { return (float)(xorshift32() % 10000) / 10000.0f; }

EXPORT void init_keystroke_profiles() {
  mechanical_profiles[0] = (AcousticProfile){1200.0f, 0.8f, 0.05f, 0.0f};
  mechanical_profiles[1] = (AcousticProfile){2500.0f, 0.6f, 0.03f, 0.0f};
  mechanical_profiles[2] = (AcousticProfile){800.0f, 0.9f, 0.08f, 0.0f};
  mechanical_profiles[3] = (AcousticProfile){3500.0f, 0.4f, 0.02f, 0.0f};
  mechanical_profiles[4] = (AcousticProfile){1800.0f, 0.7f, 0.04f, 0.0f};
}

EXPORT void generate_keystroke_sound(float *out_buffer, int num_samples,
                                     int profile_idx) {
  if (profile_idx < 0 || profile_idx >= 5)
    profile_idx = 0;

  AcousticProfile profile = mechanical_profiles[profile_idx];

  float freq_variance = profile.frequency * 0.1f * random_float();
  float actual_freq = profile.frequency + freq_variance;

  float amp_variance = 0.2f * random_float() - 0.1f;
  float actual_amp = profile.amplitude + amp_variance;

  float phase_offset = random_float() * 2.0f * PI;

  for (int i = 0; i < num_samples; i++) {
    float t = (float)i / SAMPLE_RATE;

    float envelope = expf(-t / profile.decay);

    float fundamental = sinf(2.0f * PI * actual_freq * t + phase_offset);
    float harmonic2 =
        0.5f * sinf(2.0f * PI * actual_freq * 2.0f * t + phase_offset);
    float harmonic3 =
        0.25f * sinf(2.0f * PI * actual_freq * 3.0f * t + phase_offset);

    float click_noise =
        (random_float() * 2.0f - 1.0f) * expf(-t / 0.005f) * 0.3f;

    out_buffer[i] =
        actual_amp * envelope * (fundamental + harmonic2 + harmonic3) +
        click_noise;
  }
}

EXPORT void generate_random_sequence(float *out_buffer, int total_samples,
                                     int keys_per_second) {
  int samples_per_key = SAMPLE_RATE / keys_per_second;
  int offset = 0;

  while (offset < total_samples) {
    int profile_idx = xorshift32() % 5;
    int key_samples =
        samples_per_key + (int)(random_float() * 2000.0f - 1000.0f);

    if (key_samples < 1000)
      key_samples = 1000;
    if (offset + key_samples > total_samples)
      key_samples = total_samples - offset;

    generate_keystroke_sound(out_buffer + offset, key_samples, profile_idx);

    int silence_samples = (int)(random_float() * 1000.0f);
    offset += key_samples + silence_samples;
  }
}