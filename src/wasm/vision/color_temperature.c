/**
 * color_temperature.c
 * C implementation of the Planckian locus approximation to calculate correlated
 * color temperature (CCT) from RGB camera data. Enables precise ambient
 * lighting analysis for circadian rhythm matching.
 */

#include <math.h>
#include <stdint.h>

#define MAX_PIXELS 1920 * 1080

// McCamy's approximation for Correlated Color Temperature (CCT)
// Input: CIE 1931 xy chromaticity coordinates
// Output: CCT in Kelvin
float calculate_cct_from_xy(float x, float y) {
  float n = (x - 0.3320f) / (0.1858f - y);
  float cct =
      449.0f * powf(n, 3.0f) + 3525.0f * powf(n, 2.0f) + 6823.3f * n + 5520.33f;
  return cct;
}

// Convert sRGB to CIE XYZ
void rgb_to_xyz(uint8_t r, uint8_t g, uint8_t b, float *out_x, float *out_y,
                float *out_z) {
  float rf = r / 255.0f;
  float gf = g / 255.0f;
  float bf = b / 255.0f;

  // Gamma correction
  rf = (rf > 0.04045f) ? powf((rf + 0.055f) / 1.055f, 2.4f) : (rf / 12.92f);
  gf = (gf > 0.04045f) ? powf((gf + 0.055f) / 1.055f, 2.4f) : (gf / 12.92f);
  bf = (bf > 0.04045f) ? powf((bf + 0.055f) / 1.055f, 2.4f) : (bf / 12.92f);

  // sRGB to XYZ matrix (D65 illuminant)
  *out_x = rf * 0.4124f + gf * 0.3576f + bf * 0.1805f;
  *out_y = rf * 0.2126f + gf * 0.7152f + bf * 0.0722f;
  *out_z = rf * 0.0193f + gf * 0.1192f + bf * 0.9505f;
}

// Calculate average CCT and Lux from an RGB image buffer
void analyze_ambient_light(const uint8_t *rgb_buffer, int width, int height,
                           float *out_cct, float *out_lux) {
  if (!rgb_buffer || !out_cct || !out_lux)
    return;

  float sum_x = 0.0f, sum_y = 0.0f, sum_z = 0.0f;
  float sum_luminance = 0.0f;
  int pixel_count = width * height;
  int step = (pixel_count > 10000) ? (pixel_count / 10000)
                                   : 1; // Downsample for performance

  int sampled_pixels = 0;

  for (int i = 0; i < pixel_count; i += step) {
    int idx = i * 3;
    uint8_t r = rgb_buffer[idx];
    uint8_t g = rgb_buffer[idx + 1];
    uint8_t b = rgb_buffer[idx + 2];

    float x, y, z;
    rgb_to_xyz(r, g, b, &x, &y, &z);

    sum_x += x;
    sum_y += y;
    sum_z += z;
    sum_luminance += y; // Y component is luminance
    sampled_pixels++;
  }

  float avg_x = sum_x / (sum_x + sum_y + sum_z);
  float avg_y = sum_y / (sum_x + sum_y + sum_z);

  *out_cct = calculate_cct_from_xy(avg_x, avg_y);

  // Mock lux calculation (requires camera exposure metadata in production)
  *out_lux = sum_luminance / sampled_pixels * 100.0f;
}
