/**
 * character_segment.c
 * Implements connected-component labeling to isolate individual characters and
 * text blocks from the binarized image with SIMD acceleration.
 * Supports WebAssembly SIMD128, x86 SSE2/AVX2, ARM NEON, and unaligned 64-bit scalar fallback.
 */

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

#if defined(_MSC_VER)
#include <intrin.h>
#endif

/**
 * Computes the number of trailing zeros (index of lowest set bit) in a 16-bit mask.
 */
static inline int get_first_set_bit_16(uint16_t mask) {
#if defined(__GNUC__) || defined(__clang__)
  return __builtin_ctz((unsigned int)mask);
#elif defined(_MSC_VER)
  unsigned long index;
  if (_BitScanForward(&index, (unsigned long)mask)) {
    return (int)index;
  }
  return 0;
#else
  for (int i = 0; i < 16; i++) {
    if ((mask >> i) & 1) return i;
  }
  return 0;
#endif
}

/**
 * Safely loads an unaligned 64-bit integer from an arbitrary byte address
 * using memcpy to prevent architectural unaligned bus faults on strict RISC/Wasm runtimes.
 */
static inline uint64_t load_u64_unaligned(const void *ptr) {
  uint64_t val;
  memcpy(&val, ptr, sizeof(val));
  return val;
}

/**
 * Checks whether 8 consecutive pixels at an arbitrary byte address contain
 * any black foreground pixels (pixel == 0) without triggering unaligned read faults.
 * On 8-bit grayscale images (0 = black, 255 = white), all-white 8-byte chunk is 0xFFFFFFFFFFFFFFFFULL.
 */
static inline int chunk_has_black_pixels_u64(const uint8_t *ptr) {
  uint64_t word = load_u64_unaligned(ptr);
  return word != 0xFFFFFFFFFFFFFFFFULL;
}

/**
 * SIMD-accelerated 16-pixel chunk inspection:
 * Extracts a 16-bit mask where bit k is set (1) if pixel k is both black (== 0)
 * and unvisited (visited == 0).
 * Returns 0 if all 16 pixels are either white (background) or already visited.
 */
static inline uint16_t simd_extract_unvisited_black_mask_16(const uint8_t *binary_ptr,
                                                            const uint8_t *visited_ptr) {
#if defined(SIMD_WASM128)
  v128_t img = wasm_v128_load(binary_ptr);
  v128_t vis = wasm_v128_load(visited_ptr);
  v128_t is_black = wasm_i8x16_eq(img, wasm_i8x16_splat(0));
  v128_t is_unvisited = wasm_i8x16_eq(vis, wasm_i8x16_splat(0));
  v128_t active = wasm_v128_and(is_black, is_unvisited);
  return (uint16_t)wasm_i8x16_bitmask(active);

#elif defined(SIMD_SSE2)
  __m128i img = _mm_loadu_si128((const __m128i *)binary_ptr);
  __m128i vis = _mm_loadu_si128((const __m128i *)visited_ptr);
  __m128i is_black = _mm_cmpeq_epi8(img, _mm_setzero_si128());
  __m128i is_unvisited = _mm_cmpeq_epi8(vis, _mm_setzero_si128());
  __m128i active = _mm_and_si128(is_black, is_unvisited);
  return (uint16_t)_mm_movemask_epi8(active);

#elif defined(SIMD_NEON)
  uint8x16_t img = vld1q_u8(binary_ptr);
  uint8x16_t vis = vld1q_u8(visited_ptr);
  uint8x16_t is_black = vceqq_u8(img, vdupq_n_u8(0));
  uint8x16_t is_unvisited = vceqq_u8(vis, vdupq_n_u8(0));
  uint8x16_t active = vandq_u8(is_black, is_unvisited);

  static const int8_t shift_arr[16] = {0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7};
  uint8x16_t mask_bits = vshrq_n_u8(active, 7);
  int8x16_t shifts = vld1q_s8(shift_arr);
  uint8x16_t shifted = vshlq_u8(mask_bits, shifts);
  uint8_t low = (uint8_t)(vgetq_lane_u8(shifted, 0) | vgetq_lane_u8(shifted, 1) |
                          vgetq_lane_u8(shifted, 2) | vgetq_lane_u8(shifted, 3) |
                          vgetq_lane_u8(shifted, 4) | vgetq_lane_u8(shifted, 5) |
                          vgetq_lane_u8(shifted, 6) | vgetq_lane_u8(shifted, 7));
  uint8_t high = (uint8_t)(vgetq_lane_u8(shifted, 8) | vgetq_lane_u8(shifted, 9) |
                           vgetq_lane_u8(shifted, 10) | vgetq_lane_u8(shifted, 11) |
                           vgetq_lane_u8(shifted, 12) | vgetq_lane_u8(shifted, 13) |
                           vgetq_lane_u8(shifted, 14) | vgetq_lane_u8(shifted, 15));
  return (uint16_t)(low | ((uint16_t)high << 8));

#else
  uint16_t mask = 0;
  for (int i = 0; i < 16; i++) {
    if (binary_ptr[i] == 0 && visited_ptr[i] == 0) {
      mask |= (uint16_t)(1 << i);
    }
  }
  return mask;
#endif
}

typedef struct {
  int x_min;
  int y_min;
  int x_max;
  int y_max;
} BoundingBox;

typedef struct {
  BoundingBox *boxes;
  int count;
  int capacity;
} SegmentationResult;

static void add_box(SegmentationResult *res, BoundingBox box) {
  if (res->count >= res->capacity) {
    res->capacity = res->capacity == 0 ? 32 : res->capacity * 2;
    res->boxes =
        (BoundingBox *)realloc(res->boxes, res->capacity * sizeof(BoundingBox));
  }
  res->boxes[res->count++] = box;
}

/**
 * Flood-fills connected black pixels starting at (start_x, start_y)
 * and records the bounding box if it passes the noise filtering heuristics.
 */
static void flood_fill_component(const uint8_t *binary_image, uint8_t *visited,
                                 int width, int height, int start_x, int start_y,
                                 int *queue_x, int *queue_y,
                                 SegmentationResult *result) {
  int start_idx = start_y * width + start_x;
  if (binary_image[start_idx] != 0 || visited[start_idx]) {
    return;
  }

  int x_min = start_x, x_max = start_x;
  int y_min = start_y, y_max = start_y;
  int head = 0, tail = 0;

  queue_x[tail] = start_x;
  queue_y[tail] = start_y;
  tail++;
  visited[start_idx] = 1;

  while (head < tail) {
    int cx = queue_x[head];
    int cy = queue_y[head];
    head++;

    if (cx < x_min) x_min = cx;
    if (cx > x_max) x_max = cx;
    if (cy < y_min) y_min = cy;
    if (cy > y_max) y_max = cy;

    int dx[] = {-1, 1, 0, 0};
    int dy[] = {0, 0, -1, 1};
    for (int i = 0; i < 4; i++) {
      int nx = cx + dx[i];
      int ny = cy + dy[i];
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
        int nidx = ny * width + nx;
        if (binary_image[nidx] == 0 && !visited[nidx]) {
          visited[nidx] = 1;
          queue_x[tail] = nx;
          queue_y[tail] = ny;
          tail++;
        }
      }
    }
  }

  // Filter out noise (very small components)
  int box_w = x_max - x_min;
  int box_h = y_max - y_min;
  if (box_w > 2 && box_h > 2 && box_w < width / 2) {
    BoundingBox box = {x_min, y_min, x_max, y_max};
    add_box(result, box);
  }
}

void segment_characters(const uint8_t *binary_image, int width, int height,
                        SegmentationResult *result) {
  if (!binary_image || !result || width <= 0 || height <= 0)
    return;

  result->boxes = NULL;
  result->count = 0;
  result->capacity = 0;

  uint8_t *visited = (uint8_t *)calloc(width * height, sizeof(uint8_t));
  if (!visited)
    return;

  // Preallocate BFS queue buffers for entire image to eliminate per-component malloc/free overhead
  int *queue_x = (int *)malloc(width * height * sizeof(int));
  int *queue_y = (int *)malloc(width * height * sizeof(int));
  if (!queue_x || !queue_y) {
    if (queue_x) free(queue_x);
    if (queue_y) free(queue_y);
    free(visited);
    return;
  }

  for (int y = 0; y < height; y++) {
    int row_offset = y * width;
    int x = 0;

    // Fast-path 1: SIMD 16-pixel vector scan
    while (x + 16 <= width) {
      int idx = row_offset + x;
      uint16_t active_mask = simd_extract_unvisited_black_mask_16(
          &binary_image[idx], &visited[idx]);

      // If all 16 pixels are background (white) or already visited, skip full chunk
      if (active_mask == 0) {
        x += 16;
        continue;
      }

      // Found unvisited black pixel: advance x directly to first active pixel
      int bit_offset = get_first_set_bit_16(active_mask);
      x += bit_offset;

      flood_fill_component(binary_image, visited, width, height, x, y,
                           queue_x, queue_y, result);
      x++;
    }

    // Fast-path 2: 8-pixel chunk scan for remainder using safe unaligned 64-bit reads
    while (x + 8 <= width) {
      int idx = row_offset + x;
      if (!chunk_has_black_pixels_u64(&binary_image[idx])) {
        x += 8;
        continue;
      }

      for (int k = 0; k < 8; k++, x++) {
        int cidx = row_offset + x;
        if (binary_image[cidx] == 0 && !visited[cidx]) {
          flood_fill_component(binary_image, visited, width, height, x, y,
                               queue_x, queue_y, result);
        }
      }
    }

    // Scalar fallback for leftover edge pixels
    for (; x < width; x++) {
      int idx = row_offset + x;
      if (binary_image[idx] == 0 && !visited[idx]) {
        flood_fill_component(binary_image, visited, width, height, x, y,
                             queue_x, queue_y, result);
      }
    }
  }

  free(queue_x);
  free(queue_y);
  free(visited);
}

void free_segmentation(SegmentationResult *result) {
  if (result && result->boxes) {
    free(result->boxes);
    result->boxes = NULL;
  }
}
