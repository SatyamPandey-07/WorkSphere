/**
 * sobel_edge.c
 * C implementation of the Sobel operator and adaptive thresholding for edge
 * detection. Processes grayscale image buffers to highlight structural
 * boundaries like walls and desks.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

#define SOBEL_KERNEL_SIZE 3

// Sobel X kernel
static const int gx[SOBEL_KERNEL_SIZE][SOBEL_KERNEL_SIZE] = {
    {-1, 0, 1}, {-2, 0, 2}, {-1, 0, 1}};

// Sobel Y kernel
static const int gy[SOBEL_KERNEL_SIZE][SOBEL_KERNEL_SIZE] = {
    {-1, -2, -1}, {0, 0, 0}, {1, 2, 1}};

static uint8_t get_pixel(const uint8_t *image, int width, int height, int x,
                         int y) {
  if (x < 0 || x >= width || y < 0 || y >= height) {
    return 0;
  }
  return image[y * width + x];
}

void apply_sobel_edge_detection(const uint8_t *input_image,
                                uint8_t *output_image, int width, int height,
                                float threshold_multiplier) {
  if (!input_image || !output_image || width <= 0 || height <= 0)
    return;

  // Calculate global mean and standard deviation for adaptive thresholding
  double sum = 0;
  double sum_sq = 0;
  int total_pixels = width * height;

  for (int i = 0; i < total_pixels; i++) {
    double val = input_image[i];
    sum += val;
    sum_sq += val * val;
  }

  double mean = sum / total_pixels;
  double variance = (sum_sq / total_pixels) - (mean * mean);
  double std_dev = sqrt(variance > 0 ? variance : 0);
  double threshold = mean + (threshold_multiplier * std_dev);

  for (int y = 1; y < height - 1; y++) {
    for (int x = 1; x < width - 1; x++) {
      int pixel_x = 0;
      int pixel_y = 0;

      for (int ky = -1; ky <= 1; ky++) {
        for (int kx = -1; kx <= 1; kx++) {
          uint8_t p = get_pixel(input_image, width, height, x + kx, y + ky);
          pixel_x += p * gx[ky + 1][kx + 1];
          pixel_y += p * gy[ky + 1][kx + 1];
        }
      }

      int magnitude =
          (int)sqrt((double)(pixel_x * pixel_x + pixel_y * pixel_y));

      if (magnitude > threshold) {
        output_image[y * width + x] = 255;
      } else {
        output_image[y * width + x] = 0;
      }
    }
  }
}
