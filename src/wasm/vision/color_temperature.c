/**
 * color_temperature.c
 * C implementation of the Planckian locus approximation to calculate correlated
 * color temperature (CCT) from RGB camera data. Enables precise ambient
 * lighting analysis for circadian rhythm matching.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if defined(__wasm_simd128__) || defined(__wasm_simd128)
#include <wasm_simd128.h>
#define SIMD_WASM128 1
#elif defined(__SSE2__) || defined(_M_X64) || (defined(_M_IX86_FP) && _M_IX86_FP >= 2)
#include <emmintrin.h>
#define SIMD_SSE2 1
#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>
#define SIMD_NEON 1
#endif

#define MAX_PIXELS 1920 * 1080

// Precomputed 5x5 spatial squared Euclidean distances (dx^2 + dy^2)
static const float SPATIAL_D2_5X5[25] = {
    8.0f, 5.0f, 4.0f, 5.0f, 8.0f,
    5.0f, 2.0f, 1.0f, 2.0f, 5.0f,
    4.0f, 1.0f, 0.0f, 1.0f, 4.0f,
    5.0f, 2.0f, 1.0f, 2.0f, 5.0f,
    8.0f, 5.0f, 4.0f, 5.0f, 8.0f
};

// Global SIMD execution control (1 = SIMD enabled, 0 = scalar fallback forced)
static int g_simd_enabled = 1;

/**
 * Check whether SIMD instructions are supported in the current compilation target.
 */
int is_simd_supported(void) {
#if defined(SIMD_WASM128) || defined(SIMD_SSE2) || defined(SIMD_NEON)
  return 1;
#else
  return 0;
#endif
}

/**
 * Enable or disable SIMD acceleration at runtime.
 */
void set_simd_enabled(int enabled) {
  g_simd_enabled = enabled ? 1 : 0;
}

#if defined(SIMD_WASM128)
/**
 * Fast vectorized exponential approximation for 4 float lanes using Cody-Waite range reduction.
 * Accurate within 1e-5 for negative arguments in [-16.0f, 0.0f].
 */
static inline v128_t simd_fast_exp_f32x4(v128_t val) {
  v128_t zero = wasm_f32x4_splat(0.0f);
  v128_t min_bound = wasm_f32x4_splat(-16.0f);
  val = wasm_f32x4_min(val, zero);
  val = wasm_f32x4_max(val, min_bound);

  v128_t log2e = wasm_f32x4_splat(1.4426950408889634f);
  v128_t z = wasm_f32x4_mul(val, log2e);

  v128_t rounded_f = wasm_f32x4_nearest(z);
  v128_t k_int = wasm_i32x4_trunc_sat_f32x4(rounded_f);

  v128_t ln2 = wasm_f32x4_splat(0.6931471805599453f);
  v128_t f = wasm_f32x4_sub(val, wasm_f32x4_mul(rounded_f, ln2));

  v128_t c4 = wasm_f32x4_splat(0.041666667f);
  v128_t c3 = wasm_f32x4_splat(0.16666667f);
  v128_t c2 = wasm_f32x4_splat(0.5f);
  v128_t c1 = wasm_f32x4_splat(1.0f);

  v128_t p = wasm_f32x4_add(c3, wasm_f32x4_mul(f, c4));
  p = wasm_f32x4_add(c2, wasm_f32x4_mul(f, p));
  p = wasm_f32x4_add(c1, wasm_f32x4_mul(f, p));
  p = wasm_f32x4_add(c1, wasm_f32x4_mul(f, p));

  v128_t exp_bias = wasm_i32x4_splat(127);
  v128_t biased_k = wasm_i32x4_add(k_int, exp_bias);
  v128_t two_pow_k = wasm_i32x4_shl(biased_k, 23);

  return wasm_f32x4_mul(p, two_pow_k);
}
#elif defined(SIMD_SSE2)
static inline __m128 simd_fast_exp_f32x4(__m128 val) {
  __m128 zero = _mm_set1_ps(0.0f);
  __m128 min_bound = _mm_set1_ps(-16.0f);
  val = _mm_min_ps(val, zero);
  val = _mm_max_ps(val, min_bound);

  __m128 log2e = _mm_set1_ps(1.4426950408889634f);
  __m128 z = _mm_mul_ps(val, log2e);

  __m128i k_int = _mm_cvtps_epi32(z);
  __m128 k_float = _mm_cvtepi32_ps(k_int);

  __m128 ln2 = _mm_set1_ps(0.6931471805599453f);
  __m128 f = _mm_sub_ps(val, _mm_mul_ps(k_float, ln2));

  __m128 c4 = _mm_set1_ps(0.041666667f);
  __m128 c3 = _mm_set1_ps(0.16666667f);
  __m128 c2 = _mm_set1_ps(0.5f);
  __m128 c1 = _mm_set1_ps(1.0f);

  __m128 p = _mm_add_ps(c3, _mm_mul_ps(f, c4));
  p = _mm_add_ps(c2, _mm_mul_ps(f, p));
  p = _mm_add_ps(c1, _mm_mul_ps(f, p));
  p = _mm_add_ps(c1, _mm_mul_ps(f, p));

  __m128i exp_bias = _mm_set1_epi32(127);
  __m128i biased_k = _mm_add_epi32(k_int, exp_bias);
  __m128i two_pow_k_i = _mm_slli_epi32(biased_k, 23);
  __m128 two_pow_k = _mm_castsi128_ps(two_pow_k_i);

  return _mm_mul_ps(p, two_pow_k);
}
#endif

// Forward declarations of scalar computation functions
void compute_spatial_kernel_5x5_scalar(float sigma_s, float kernel[25]);
void compute_radiometric_lut_scalar(float sigma_r, float lut[256]);

/**
 * Compute the 5x5 Gaussian spatial kernel weights using SIMD vectorization.
 */
void compute_spatial_kernel_5x5_simd(float sigma_s, float kernel[25]) {
  if (!kernel) return;
  if (sigma_s <= 0.0f) sigma_s = 2.0f;

#if defined(SIMD_WASM128)
  float inv_2sigma_sq = -1.0f / (2.0f * sigma_s * sigma_s);
  v128_t factor = wasm_f32x4_splat(inv_2sigma_sq);
  for (int i = 0; i < 24; i += 4) {
    v128_t d2 = wasm_v128_load(&SPATIAL_D2_5X5[i]);
    v128_t arg = wasm_f32x4_mul(d2, factor);
    v128_t weights = simd_fast_exp_f32x4(arg);
    wasm_v128_store(&kernel[i], weights);
  }
  kernel[24] = expf(SPATIAL_D2_5X5[24] * inv_2sigma_sq);
#elif defined(SIMD_SSE2)
  float inv_2sigma_sq = -1.0f / (2.0f * sigma_s * sigma_s);
  __m128 factor = _mm_set1_ps(inv_2sigma_sq);
  for (int i = 0; i < 24; i += 4) {
    __m128 d2 = _mm_loadu_ps(&SPATIAL_D2_5X5[i]);
    __m128 arg = _mm_mul_ps(d2, factor);
    __m128 weights = simd_fast_exp_f32x4(arg);
    _mm_storeu_ps(&kernel[i], weights);
  }
  kernel[24] = expf(SPATIAL_D2_5X5[24] * inv_2sigma_sq);
#else
  compute_spatial_kernel_5x5_scalar(sigma_s, kernel);
#endif
}

/**
 * Scalar fallback for 5x5 Gaussian spatial kernel computation.
 */
void compute_spatial_kernel_5x5_scalar(float sigma_s, float kernel[25]) {
  if (!kernel) return;
  if (sigma_s <= 0.0f) sigma_s = 2.0f;
  float inv_2sigma_sq = -1.0f / (2.0f * sigma_s * sigma_s);
  for (int i = 0; i < 25; i++) {
    kernel[i] = expf(SPATIAL_D2_5X5[i] * inv_2sigma_sq);
  }
}

/**
 * Compute the 256-element radiometric lookup table using SIMD vectorization.
 */
void compute_radiometric_lut_simd(float sigma_r, float lut[256]) {
  if (!lut) return;
  if (sigma_r <= 0.0f) sigma_r = 20.0f;

#if defined(SIMD_WASM128)
  float inv_2sigma_sq = -1.0f / (2.0f * sigma_r * sigma_r);
  v128_t factor = wasm_f32x4_splat(inv_2sigma_sq);
  for (int i = 0; i < 256; i += 4) {
    v128_t idx = wasm_f32x4_make((float)i, (float)(i + 1), (float)(i + 2), (float)(i + 3));
    v128_t diff2 = wasm_f32x4_mul(idx, idx);
    v128_t arg = wasm_f32x4_mul(diff2, factor);
    v128_t weights = simd_fast_exp_f32x4(arg);
    wasm_v128_store(&lut[i], weights);
  }
#elif defined(SIMD_SSE2)
  float inv_2sigma_sq = -1.0f / (2.0f * sigma_r * sigma_r);
  __m128 factor = _mm_set1_ps(inv_2sigma_sq);
  for (int i = 0; i < 256; i += 4) {
    __m128 idx = _mm_set_ps((float)(i + 3), (float)(i + 2), (float)(i + 1), (float)i);
    __m128 diff2 = _mm_mul_ps(idx, idx);
    __m128 arg = _mm_mul_ps(diff2, factor);
    __m128 weights = simd_fast_exp_f32x4(arg);
    _mm_storeu_ps(&lut[i], weights);
  }
#else
  compute_radiometric_lut_scalar(sigma_r, lut);
#endif
}

/**
 * Scalar fallback for 256-element radiometric lookup table computation.
 */
void compute_radiometric_lut_scalar(float sigma_r, float lut[256]) {
  if (!lut) return;
  if (sigma_r <= 0.0f) sigma_r = 20.0f;
  float inv_2sigma_sq = -1.0f / (2.0f * sigma_r * sigma_r);
  for (int i = 0; i < 256; i++) {
    lut[i] = expf((float)(i * i) * inv_2sigma_sq);
  }
}

/**
 * Filter an individual pixel using the precomputed spatial kernel and radiometric LUT.
 * Safely clamps boundary coordinates to avoid out-of-bounds reads.
 */
static inline void filter_pixel_scalar(const uint8_t *src, uint8_t *dst_row,
                                       int width, int height, int x, int y,
                                       const float *spatial_kernel,
                                       const float *radiometric_lut) {
  uint8_t center_val = src[y * width + x];
  float sum_val = 0.0f;
  float sum_weight = 0.0f;

  for (int dy = -2; dy <= 2; dy++) {
    int ny = y + dy;
    if (ny < 0) ny = 0;
    else if (ny >= height) ny = height - 1;

    int row_offset = ny * width;
    int k_y = (dy + 2) * 5;

    for (int dx = -2; dx <= 2; dx++) {
      int nx = x + dx;
      if (nx < 0) nx = 0;
      else if (nx >= width) nx = width - 1;

      uint8_t neighbor_val = src[row_offset + nx];
      int diff = abs((int)neighbor_val - (int)center_val);

      float ws = spatial_kernel[k_y + (dx + 2)];
      float wr = radiometric_lut[diff];
      float w = ws * wr;

      sum_val += w * (float)neighbor_val;
      sum_weight += w;
    }
  }

  float filtered = (sum_weight > 0.0f) ? (sum_val / sum_weight + 0.5f) : (float)center_val;
  if (filtered < 0.0f) filtered = 0.0f;
  if (filtered > 255.0f) filtered = 255.0f;
  dst_row[x] = (uint8_t)filtered;
}

/**
 * 5x5 Bilateral Filter scalar implementation.
 * Provides fallback when SIMD instructions are unavailable or disabled.
 */
void bilateral_filter_5x5_chroma_scalar(const uint8_t *src, uint8_t *dst,
                                        int width, int height,
                                        float sigma_s, float sigma_r) {
  if (!src || !dst || width <= 0 || height <= 0) return;

  if (sigma_s <= 0.0f) sigma_s = 2.0f;
  if (sigma_r <= 0.0f) sigma_r = 20.0f;

  float spatial_kernel[25];
  compute_spatial_kernel_5x5_scalar(sigma_s, spatial_kernel);

  float radiometric_lut[256];
  compute_radiometric_lut_scalar(sigma_r, radiometric_lut);

  for (int y = 0; y < height; y++) {
    uint8_t *dst_row = dst + y * width;
    for (int x = 0; x < width; x++) {
      filter_pixel_scalar(src, dst_row, width, height, x, y, spatial_kernel, radiometric_lut);
    }
  }
}

/**
 * 5x5 Bilateral Filter vectorized SIMD implementation.
 * Processes 4 pixels in parallel using WebAssembly SIMD128 (or SSE2) intrinsics.
 */
void bilateral_filter_5x5_chroma_simd(const uint8_t *src, uint8_t *dst,
                                      int width, int height,
                                      float sigma_s, float sigma_r) {
  if (!src || !dst || width <= 0 || height <= 0) return;

  // Handle small images or insufficient dimensions via scalar fallback
  if (width < 8 || height < 5) {
    bilateral_filter_5x5_chroma_scalar(src, dst, width, height, sigma_s, sigma_r);
    return;
  }

  if (sigma_s <= 0.0f) sigma_s = 2.0f;
  if (sigma_r <= 0.0f) sigma_r = 20.0f;

  float spatial_kernel[25];
  compute_spatial_kernel_5x5_simd(sigma_s, spatial_kernel);

  float radiometric_lut[256];
  compute_radiometric_lut_simd(sigma_r, radiometric_lut);

  // Filter boundary top rows (y = 0, 1) using scalar fallback
  for (int y = 0; y < 2; y++) {
    uint8_t *dst_row = dst + y * width;
    for (int x = 0; x < width; x++) {
      filter_pixel_scalar(src, dst_row, width, height, x, y, spatial_kernel, radiometric_lut);
    }
  }

#if defined(SIMD_WASM128)
  v128_t inv_2sigma_r_sq_vec = wasm_f32x4_splat(-1.0f / (2.0f * sigma_r * sigma_r));

  for (int y = 2; y < height - 2; y++) {
    const uint8_t *center_row = src + y * width;
    uint8_t *dst_row = dst + y * width;

    // Filter left 2 boundary columns
    filter_pixel_scalar(src, dst_row, width, height, 0, y, spatial_kernel, radiometric_lut);
    filter_pixel_scalar(src, dst_row, width, height, 1, y, spatial_kernel, radiometric_lut);

    int x = 2;
    for (; x <= width - 6; x += 4) {
      v128_t center_vec = wasm_f32x4_make(
          (float)center_row[x],
          (float)center_row[x + 1],
          (float)center_row[x + 2],
          (float)center_row[x + 3]);
      v128_t sum_val = wasm_f32x4_splat(0.0f);
      v128_t sum_weight = wasm_f32x4_splat(0.0f);

      for (int dy = -2; dy <= 2; dy++) {
        const uint8_t *n_row = src + (y + dy) * width;
        int k_row = (dy + 2) * 5;
        for (int dx = -2; dx <= 2; dx++) {
          v128_t ws = wasm_f32x4_splat(spatial_kernel[k_row + (dx + 2)]);
          v128_t neighbor_vec = wasm_f32x4_make(
              (float)n_row[x + dx],
              (float)n_row[x + dx + 1],
              (float)n_row[x + dx + 2],
              (float)n_row[x + dx + 3]);
          v128_t diff = wasm_f32x4_sub(neighbor_vec, center_vec);
          v128_t diff2 = wasm_f32x4_mul(diff, diff);
          v128_t r_arg = wasm_f32x4_mul(diff2, inv_2sigma_r_sq_vec);
          v128_t wr = simd_fast_exp_f32x4(r_arg);
          v128_t w = wasm_f32x4_mul(ws, wr);

          sum_val = wasm_f32x4_add(sum_val, wasm_f32x4_mul(w, neighbor_vec));
          sum_weight = wasm_f32x4_add(sum_weight, w);
        }
      }

      v128_t filtered = wasm_f32x4_div(sum_val, sum_weight);
      filtered = wasm_f32x4_add(filtered, wasm_f32x4_splat(0.5f));
      v128_t clamped = wasm_f32x4_max(
          wasm_f32x4_min(filtered, wasm_f32x4_splat(255.0f)),
          wasm_f32x4_splat(0.0f));

      dst_row[x] = (uint8_t)wasm_f32x4_extract_lane(clamped, 0);
      dst_row[x + 1] = (uint8_t)wasm_f32x4_extract_lane(clamped, 1);
      dst_row[x + 2] = (uint8_t)wasm_f32x4_extract_lane(clamped, 2);
      dst_row[x + 3] = (uint8_t)wasm_f32x4_extract_lane(clamped, 3);
    }

    // Filter right boundary and remainder columns
    for (; x < width; x++) {
      filter_pixel_scalar(src, dst_row, width, height, x, y, spatial_kernel, radiometric_lut);
    }
  }
#elif defined(SIMD_SSE2)
  __m128 inv_2sigma_r_sq_vec = _mm_set1_ps(-1.0f / (2.0f * sigma_r * sigma_r));

  for (int y = 2; y < height - 2; y++) {
    const uint8_t *center_row = src + y * width;
    uint8_t *dst_row = dst + y * width;

    filter_pixel_scalar(src, dst_row, width, height, 0, y, spatial_kernel, radiometric_lut);
    filter_pixel_scalar(src, dst_row, width, height, 1, y, spatial_kernel, radiometric_lut);

    int x = 2;
    for (; x <= width - 6; x += 4) {
      __m128 center_vec = _mm_set_ps(
          (float)center_row[x + 3],
          (float)center_row[x + 2],
          (float)center_row[x + 1],
          (float)center_row[x]);
      __m128 sum_val = _mm_setzero_ps();
      __m128 sum_weight = _mm_setzero_ps();

      for (int dy = -2; dy <= 2; dy++) {
        const uint8_t *n_row = src + (y + dy) * width;
        int k_row = (dy + 2) * 5;
        for (int dx = -2; dx <= 2; dx++) {
          __m128 ws = _mm_set1_ps(spatial_kernel[k_row + (dx + 2)]);
          __m128 neighbor_vec = _mm_set_ps(
              (float)n_row[x + dx + 3],
              (float)n_row[x + dx + 2],
              (float)n_row[x + dx + 1],
              (float)n_row[x + dx]);
          __m128 diff = _mm_sub_ps(neighbor_vec, center_vec);
          __m128 diff2 = _mm_mul_ps(diff, diff);
          __m128 r_arg = _mm_mul_ps(diff2, inv_2sigma_r_sq_vec);
          __m128 wr = simd_fast_exp_f32x4(r_arg);
          __m128 w = _mm_mul_ps(ws, wr);

          sum_val = _mm_add_ps(sum_val, _mm_mul_ps(w, neighbor_vec));
          sum_weight = _mm_add_ps(sum_weight, w);
        }
      }

      __m128 filtered = _mm_div_ps(sum_val, sum_weight);
      filtered = _mm_add_ps(filtered, _mm_set1_ps(0.5f));
      __m128 clamped = _mm_max_ps(
          _mm_min_ps(filtered, _mm_set1_ps(255.0f)),
          _mm_setzero_ps());

      float out_f[4];
      _mm_storeu_ps(out_f, clamped);
      dst_row[x] = (uint8_t)out_f[0];
      dst_row[x + 1] = (uint8_t)out_f[1];
      dst_row[x + 2] = (uint8_t)out_f[2];
      dst_row[x + 3] = (uint8_t)out_f[3];
    }

    for (; x < width; x++) {
      filter_pixel_scalar(src, dst_row, width, height, x, y, spatial_kernel, radiometric_lut);
    }
  }
#else
  for (int y = 2; y < height - 2; y++) {
    uint8_t *dst_row = dst + y * width;
    for (int x = 0; x < width; x++) {
      filter_pixel_scalar(src, dst_row, width, height, x, y, spatial_kernel, radiometric_lut);
    }
  }
#endif

  // Filter bottom boundary rows (y = height - 2, height - 1)
  for (int y = height - 2; y < height; y++) {
    uint8_t *dst_row = dst + y * width;
    for (int x = 0; x < width; x++) {
      filter_pixel_scalar(src, dst_row, width, height, x, y, spatial_kernel, radiometric_lut);
    }
  }
}

/**
 * Unified 5x5 Bilateral Filter for chroma channels.
 * Automatically dispatches to SIMD vectorization when supported and enabled,
 * or falls back to scalar implementation.
 */
void bilateral_filter_5x5_chroma(const uint8_t *src, uint8_t *dst,
                                 int width, int height,
                                 float sigma_s, float sigma_r) {
  if (!src || !dst || width <= 0 || height <= 0)
    return;

  if (g_simd_enabled && is_simd_supported() && width >= 8 && height >= 5) {
    bilateral_filter_5x5_chroma_simd(src, dst, width, height, sigma_s, sigma_r);
  } else {
    bilateral_filter_5x5_chroma_scalar(src, dst, width, height, sigma_s, sigma_r);
  }
}

/**
 * Convenience alias for bilateral_filter_5x5_chroma.
 */
void denoise_chroma_bilateral_5x5(const uint8_t *src, uint8_t *dst,
                                  int width, int height,
                                  float sigma_s, float sigma_r) {
  bilateral_filter_5x5_chroma(src, dst, width, height, sigma_s, sigma_r);
}

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

// Calculate average CCT and Lux with bilateral edge-preserving denoising under low-light
void analyze_ambient_light_denoised(const uint8_t *rgb_buffer, int width, int height,
                                    float *out_cct, float *out_lux,
                                    float sigma_s, float sigma_r) {
  if (!rgb_buffer || !out_cct || !out_lux || width <= 0 || height <= 0)
    return;

  if (sigma_s <= 0.0f) sigma_s = 2.0f;
  if (sigma_r <= 0.0f) sigma_r = 20.0f;

  float sum_x = 0.0f, sum_y = 0.0f, sum_z = 0.0f;
  float sum_luminance = 0.0f;
  int pixel_count = width * height;
  int step = (pixel_count > 10000) ? (pixel_count / 10000) : 1;
  int sampled_pixels = 0;

  float spatial_kernel[25];
  compute_spatial_kernel_5x5_simd(sigma_s, spatial_kernel);

  float radiometric_lut[256];
  compute_radiometric_lut_simd(sigma_r, radiometric_lut);

  for (int i = 0; i < pixel_count; i += step) {
    int px = i % width;
    int py = i / width;

    float r_val = 0.0f, g_val = 0.0f, b_val = 0.0f;
    float sum_w = 0.0f;

    int center_idx = (py * width + px) * 3;
    uint8_t cr = rgb_buffer[center_idx];
    uint8_t cg = rgb_buffer[center_idx + 1];
    uint8_t cb = rgb_buffer[center_idx + 2];

    for (int dy = -2; dy <= 2; dy++) {
      int ny = py + dy;
      if (ny < 0) ny = 0;
      else if (ny >= height) ny = height - 1;

      int row_offset = ny * width;
      int k_y = (dy + 2) * 5;

      for (int dx = -2; dx <= 2; dx++) {
        int nx = px + dx;
        if (nx < 0) nx = 0;
        else if (nx >= width) nx = width - 1;

        int n_idx = (row_offset + nx) * 3;
        uint8_t nr = rgb_buffer[n_idx];
        uint8_t ng = rgb_buffer[n_idx + 1];
        uint8_t nb = rgb_buffer[n_idx + 2];

        int diff_r = abs((int)nr - (int)cr);
        int diff_g = abs((int)ng - (int)cg);
        int diff_b = abs((int)nb - (int)cb);
        int max_diff = (diff_r > diff_g) ? (diff_r > diff_b ? diff_r : diff_b)
                                         : (diff_g > diff_b ? diff_g : diff_b);

        float ws = spatial_kernel[k_y + (dx + 2)];
        float wr = radiometric_lut[max_diff];
        float w = ws * wr;

        r_val += w * (float)nr;
        g_val += w * (float)ng;
        b_val += w * (float)nb;
        sum_w += w;
      }
    }

    uint8_t filtered_r = (sum_w > 0.0f) ? (uint8_t)(r_val / sum_w + 0.5f) : cr;
    uint8_t filtered_g = (sum_w > 0.0f) ? (uint8_t)(g_val / sum_w + 0.5f) : cg;
    uint8_t filtered_b = (sum_w > 0.0f) ? (uint8_t)(b_val / sum_w + 0.5f) : cb;

    float x, y, z;
    rgb_to_xyz(filtered_r, filtered_g, filtered_b, &x, &y, &z);

    sum_x += x;
    sum_y += y;
    sum_z += z;
    sum_luminance += y;
    sampled_pixels++;
  }

  if (sampled_pixels > 0 && (sum_x + sum_y + sum_z) > 0.0f) {
    float avg_x = sum_x / (sum_x + sum_y + sum_z);
    float avg_y = sum_y / (sum_x + sum_y + sum_z);
    *out_cct = calculate_cct_from_xy(avg_x, avg_y);
    *out_lux = (sum_luminance / (float)sampled_pixels) * 100.0f;
  } else {
    *out_cct = 5000.0f;
    *out_lux = 0.0f;
  }
}

