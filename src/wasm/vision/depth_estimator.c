/**
 * depth_estimator.c
 * C implementation of a lightweight monocular depth-estimation model
 * to calculate distances to physical objects using edge density and perspective
 * heuristics.
 */

#include <emscripten.h>
#include <math.h>
#include <stdint.h>

// Simplified Sobel operator for edge detection
void apply_sobel(const uint8_t *grayscale, int width, int height,
                 float *edges) {
  int gx, gy;
  for (int y = 1; y < height - 1; y++) {
    for (int x = 1; x < width - 1; x++) {
      int idx = y * width + x;

      // Sobel X
      gx = -(grayscale[(y - 1) * width + (x - 1)]) -
           2 * (grayscale[y * width + (x - 1)]) -
           (grayscale[(y + 1) * width + (x - 1)]) +
           (grayscale[(y - 1) * width + (x + 1)]) +
           2 * (grayscale[y * width + (x + 1)]) +
           (grayscale[(y + 1) * width + (x + 1)]);

      // Sobel Y
      gy = -(grayscale[(y - 1) * width + (x - 1)]) -
           2 * (grayscale[(y - 1) * width + x]) -
           (grayscale[(y - 1) * width + (x + 1)]) +
           (grayscale[(y + 1) * width + (x - 1)]) +
           2 * (grayscale[(y + 1) * width + x]) +
           (grayscale[(y + 1) * width + (x + 1)]);

      edges[idx] = sqrtf((float)(gx * gx + gy * gy));
    }
  }
}

// Heuristic depth estimation based on vertical position and edge density
// Objects lower in the frame and with larger edge footprints are closer
EMSCRIPTEN_KEEPALIVE
void estimate_depth(const uint8_t *image_data, int width, int height,
                    float *depth_map) {
  float *edges = (float *)malloc(width * height * sizeof(float));
  apply_sobel(image_data, width, height, edges);

  float focal_length = (float)width * 0.8f; // Mock focal length
  float baseline = 0.06f;                   // Mock stereo baseline (6cm)

  for (int y = 0; y < height; y++) {
    // Vertical perspective factor: bottom of image is closer
    float y_factor = 1.0f - ((float)y / (float)height);
    y_factor = fmaxf(y_factor, 0.1f);

    for (int x = 0; x < width; x++) {
      int idx = y * width + x;

      // Local edge density (simplified)
      float edge_val = edges[idx];

      // Combine perspective and edge magnitude to mock disparity
      float disparity = (edge_val * 0.01f) + (y_factor * 5.0f);
      disparity = fmaxf(disparity, 0.1f);

      // Depth = (focal_length * baseline) / disparity
      depth_map[idx] = (focal_length * baseline) / disparity;
    }
  }

  free(edges);
}

EMSCRIPTEN_KEEPALIVE
int get_buffer_size(int width, int height) {
  return width * height * sizeof(float);
}
