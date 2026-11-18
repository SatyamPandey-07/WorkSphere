/**
 * frequency_mask.c
 * C implementation of the Fast Fourier Transform (FFT) and inverse-phase
 * generation to neutralize specific ambient frequencies.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

typedef struct {
  float real;
  float imag;
} Complex;

// Bit-reversal permutation for Cooley-Tukey FFT
void bit_reverse(Complex *x, int n) {
  int i, j, k;
  j = 0;
  for (i = 1; i < n; i++) {
    k = n >> 1;
    while (j & k) {
      j ^= k;
      k >>= 1;
    }
    j ^= k;
    if (i < j) {
      Complex temp = x[i];
      x[i] = x[j];
      x[j] = temp;
    }
  }
}

// Radix-2 Decimation-in-Time FFT
void fft(Complex *x, int n, int invert) {
  bit_reverse(x, n);

  for (int len = 2; len <= n; len <<= 1) {
    float angle = 2 * M_PI / len * (invert ? -1 : 1);
    Complex wlen = {cosf(angle), sinf(angle)};

    for (int i = 0; i < n; i += len) {
      Complex w = {1.0f, 0.0f};
      for (int j = 0; j < len / 2; j++) {
        Complex u = x[i + j];
        Complex v = {x[i + j + len / 2].real * w.real -
                         x[i + j + len / 2].imag * w.imag,
                     x[i + j + len / 2].real * w.imag +
                         x[i + j + len / 2].imag * w.real};

        x[i + j].real = u.real + v.real;
        x[i + j].imag = u.imag + v.imag;

        x[i + j + len / 2].real = u.real - v.real;
        x[i + j + len / 2].imag = u.imag - v.imag;

        float w_next_real = w.real * wlen.real - w.imag * wlen.imag;
        float w_next_imag = w.real * wlen.imag + w.imag * wlen.real;
        w.real = w_next_real;
        w.imag = w_next_imag;
      }
    }
  }

  if (invert) {
    for (int i = 0; i < n; i++) {
      x[i].real /= n;
      x[i].imag /= n;
    }
  }
}

/**
 * Analyzes the ambient noise buffer and generates an inverse-phase masking
 * track.
 * @param input_buffer Raw PCM audio samples (float32)
 * @param output_buffer Buffer to store the generated masking audio
 * @param buffer_size Number of samples (must be power of 2)
 * @param sample_rate Audio sample rate in Hz
 * @param mask_intensity Multiplier for the masking amplitude (0.0 to 1.0)
 * @return 1 on success, 0 on failure
 */
int generate_inverse_mask(const float *input_buffer, float *output_buffer,
                          int buffer_size, int sample_rate,
                          float mask_intensity) {
  if (!input_buffer || !output_buffer || buffer_size <= 0 ||
      (buffer_size & (buffer_size - 1)) != 0) {
    return 0; // Buffer size must be a power of 2
  }

  Complex *spectrum = (Complex *)malloc(buffer_size * sizeof(Complex));
  if (!spectrum)
    return 0;

  // Load input into complex array
  for (int i = 0; i < buffer_size; i++) {
    spectrum[i].real = input_buffer[i];
    spectrum[i].imag = 0.0f;
  }

  // Apply Hann window to reduce spectral leakage
  for (int i = 0; i < buffer_size; i++) {
    float window = 0.5f * (1.0f - cosf(2.0f * M_PI * i / (buffer_size - 1)));
    spectrum[i].real *= window;
  }

  // Forward FFT
  fft(spectrum, buffer_size, 0);

  // Identify dominant frequencies and apply inverse phase shift
  // For masking, we invert the phase by 180 degrees (multiply by -1)
  // and scale by mask_intensity
  for (int i = 0; i < buffer_size; i++) {
    // Calculate magnitude
    float magnitude = sqrtf(spectrum[i].real * spectrum[i].real +
                            spectrum[i].imag * spectrum[i].imag);

    // Only mask frequencies above a certain noise floor threshold
    if (magnitude > 0.05f) {
      spectrum[i].real = -spectrum[i].real * mask_intensity;
      spectrum[i].imag = -spectrum[i].imag * mask_intensity;
    } else {
      spectrum[i].real = 0.0f;
      spectrum[i].imag = 0.0f;
    }
  }

  // Inverse FFT
  fft(spectrum, buffer_size, 1);

  // Overlap-add synthesis (simplified for single block processing)
  for (int i = 0; i < buffer_size; i++) {
    output_buffer[i] = spectrum[i].real;
  }

  free(spectrum);
  return 1;
}

/**
 * Generates synthetic brown noise to blend with the inverse mask for lo-fi
 * aesthetic. Brown noise has a power density that decreases by 6 dB per octave.
 */
void generate_brown_noise(float *output_buffer, int buffer_size,
                          float amplitude) {
  float last_out = 0.0f;
  for (int i = 0; i < buffer_size; i++) {
    // White noise
    float white = ((float)rand() / RAND_MAX) * 2.0f - 1.0f;

    // Integration (random walk)
    last_out = (last_out + (0.02f * white)) / 1.02f;

    // Clamp to prevent drift
    if (last_out > 1.0f)
      last_out = 1.0f;
    if (last_out < -1.0f)
      last_out = -1.0f;

    output_buffer[i] = last_out * amplitude;
  }
}
