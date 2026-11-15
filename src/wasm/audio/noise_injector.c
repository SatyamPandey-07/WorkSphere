#include <math.h>
#include <stdint.h>

#define EXPORT __attribute__((visibility("default")))
#define RING_BUFFER_SIZE 8192
#define PI 3.14159265358979323846

static float ring_buffer[RING_BUFFER_SIZE];
static int write_pos = 0;
static int read_pos = 0;

static float pink_noise_state[7] = {0};

float generate_pink_noise() {
  float white = ((float)(rand() % 20000) / 10000.0f) - 1.0f;

  pink_noise_state[0] = 0.99886f * pink_noise_state[0] + white * 0.0555179f;
  pink_noise_state[1] = 0.99332f * pink_noise_state[1] + white * 0.0750759f;
  pink_noise_state[2] = 0.96900f * pink_noise_state[2] + white * 0.1538520f;
  pink_noise_state[3] = 0.86650f * pink_noise_state[3] + white * 0.3104856f;
  pink_noise_state[4] = 0.55000f * pink_noise_state[4] + white * 0.5329522f;
  pink_noise_state[5] = -0.7616f * pink_noise_state[5] - white * 0.0168980f;

  float pink = pink_noise_state[0] + pink_noise_state[1] + pink_noise_state[2] +
               pink_noise_state[3] + pink_noise_state[4] + pink_noise_state[5] +
               pink_noise_state[6] + white * 0.5362f;

  pink_noise_state[6] = white * 0.115926f;

  return pink * 0.11f;
}

EXPORT void init_injector() {
  for (int i = 0; i < RING_BUFFER_SIZE; i++) {
    ring_buffer[i] = 0.0f;
  }
  write_pos = 0;
  read_pos = 0;
}

EXPORT void inject_keystroke_audio(float *keystroke_buffer, int num_samples) {
  for (int i = 0; i < num_samples; i++) {
    ring_buffer[write_pos] = keystroke_buffer[i];
    write_pos = (write_pos + 1) % RING_BUFFER_SIZE;
  }
}

EXPORT void mix_and_output(float *mic_input, float *output, int num_samples,
                           float mix_ratio) {
  for (int i = 0; i < num_samples; i++) {
    float mask_signal = ring_buffer[read_pos];
    read_pos = (read_pos + 1) % RING_BUFFER_SIZE;

    float pink = generate_pink_noise();

    float combined_mask = (mask_signal * 0.7f) + (pink * 0.3f);

    output[i] =
        (mic_input[i] * (1.0f - mix_ratio)) + (combined_mask * mix_ratio);

    if (output[i] > 1.0f)
      output[i] = 1.0f;
    if (output[i] < -1.0f)
      output[i] = -1.0f;
  }
}

EXPORT void apply_frequency_mask(float *buffer, int num_samples,
                                 float target_freq, float bandwidth) {
  float dt = 1.0f / 44100.0f;
  float rc = 1.0f / (2.0f * PI * target_freq);
  float alpha = dt / (rc + dt);

  float prev_out = 0.0f;
  for (int i = 0; i < num_samples; i++) {
    float current = buffer[i];
    float out = prev_out + alpha * (current - prev_out);

    float diff = current - out;
    buffer[i] = diff;
    prev_out = out;
  }
}
