/**
 * crowd_counter.c
 * C implementation of a lightweight optical flow and density map estimator to
 * count people in a zone without facial recognition. Ensures privacy-first edge
 * processing by only analyzing motion vectors and density, not identifiable
 * features.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define GRID_WIDTH 32
#define GRID_HEIGHT 24
#define CELL_SIZE 8 // Downsample factor
#define MAX_CROWD_BLOBS 512
#define MAX_COMPONENTS 8192

typedef struct {
  float density_map[GRID_WIDTH * GRID_HEIGHT];
  float optical_flow_x[GRID_WIDTH * GRID_HEIGHT];
  float optical_flow_y[GRID_WIDTH * GRID_HEIGHT];
  int estimated_count;
  float confidence;
} CrowdAnalysisResult;

typedef struct {
  uint32_t x_min;
  uint32_t y_min;
  uint32_t x_max;
  uint32_t y_max;
  uint32_t width;
  uint32_t height;
  uint32_t area;
  uint32_t pixel_count;
} CrowdBlob;

typedef struct {
  CrowdBlob blobs[MAX_CROWD_BLOBS];
  uint32_t count;
} BlobDetectionResult;

typedef struct {
  uint32_t parent;
  uint32_t x_min;
  uint32_t y_min;
  uint32_t x_max;
  uint32_t y_max;
  uint32_t pixel_count;
} LabelComponent;

/**
 * Sanity check validating whether a bounding box is strictly within the frame resolution.
 * Rejects invalid coordinates, inverted bounds, or bounding boxes exceeding frame resolution.
 * Returns 1 if valid, 0 if invalid.
 */
int validate_bounding_box(uint32_t x_min, uint32_t y_min, uint32_t x_max,
                          uint32_t y_max, uint32_t frame_width,
                          uint32_t frame_height) {
  if (frame_width == 0 || frame_height == 0) {
    return 0;
  }
  if (x_min > x_max || y_min > y_max) {
    return 0;
  }
  if (x_max >= frame_width || y_max >= frame_height) {
    return 0;
  }

  uint32_t box_w = x_max - x_min + 1;
  uint32_t box_h = y_max - y_min + 1;
  if (box_w > frame_width || box_h > frame_height) {
    return 0;
  }

  uint64_t box_area = (uint64_t)box_w * (uint64_t)box_h;
  uint64_t max_area = (uint64_t)frame_width * (uint64_t)frame_height;
  if (box_area > max_area) {
    return 0;
  }

  return 1;
}

/**
 * Calculates blob bounding box area using 32-bit unsigned integers (uint32_t).
 * Prevents 16-bit integer overflow (int16_t max 32767) on high-resolution
 * 4K (3840x2160) video streams where dimensions exceed 256x128.
 */
uint32_t calculate_blob_area(uint32_t box_width, uint32_t box_height) {
  uint64_t area = (uint64_t)box_width * (uint64_t)box_height;
  if (area > UINT32_MAX) {
    return UINT32_MAX;
  }
  return (uint32_t)area;
}

/**
 * Filter blob by area using 32-bit unsigned integer calculations.
 * Returns 1 if blob area falls within [min_area, max_area], 0 otherwise.
 */
int filter_blob_by_area(uint32_t box_w, uint32_t box_h, uint32_t min_area,
                        uint32_t max_area, uint32_t *out_area) {
  uint32_t area = calculate_blob_area(box_w, box_h);
  if (out_area) {
    *out_area = area;
  }
  return (area >= min_area && area <= max_area);
}

static uint32_t dsu_find(LabelComponent *comp, uint32_t i) {
  uint32_t root = i;
  while (root != comp[root].parent) {
    root = comp[root].parent;
  }
  uint32_t curr = i;
  while (curr != root) {
    uint32_t next = comp[curr].parent;
    comp[curr].parent = root;
    curr = next;
  }
  return root;
}

static void dsu_union(LabelComponent *comp, uint32_t root1, uint32_t root2) {
  if (root1 == root2) return;
  comp[root2].parent = root1;
  if (comp[root2].x_min < comp[root1].x_min) comp[root1].x_min = comp[root2].x_min;
  if (comp[root2].y_min < comp[root1].y_min) comp[root1].y_min = comp[root2].y_min;
  if (comp[root2].x_max > comp[root1].x_max) comp[root1].x_max = comp[root2].x_max;
  if (comp[root2].y_max > comp[root1].y_max) comp[root1].y_max = comp[root2].y_max;
  comp[root1].pixel_count += comp[root2].pixel_count;
}

/**
 * Connected-component labeling pass to detect and isolate crowd blobs from a binary motion mask.
 * Uses uint32_t for all coordinate and area variables to support 4K (3840x2160) resolutions.
 */
void extract_crowd_blobs(const uint8_t *binary_mask, uint32_t width,
                         uint32_t height, uint32_t min_area,
                         uint32_t max_area, BlobDetectionResult *result) {
  if (!result) return;
  result->count = 0;

  if (!binary_mask || width == 0 || height == 0) return;
  if (max_area == 0) max_area = UINT32_MAX;

  uint32_t *prev_row = (uint32_t *)calloc(width, sizeof(uint32_t));
  uint32_t *curr_row = (uint32_t *)calloc(width, sizeof(uint32_t));
  if (!prev_row || !curr_row) {
    if (prev_row) free(prev_row);
    if (curr_row) free(curr_row);
    return;
  }

  LabelComponent *comp = (LabelComponent *)malloc(MAX_COMPONENTS * sizeof(LabelComponent));
  if (!comp) {
    free(prev_row);
    free(curr_row);
    return;
  }

  uint32_t num_labels = 0;

  for (uint32_t y = 0; y < height; y++) {
    size_t row_offset = (size_t)y * (size_t)width;
    for (uint32_t x = 0; x < width; x++) {
      uint8_t pixel = binary_mask[row_offset + x];
      if (pixel == 0) {
        curr_row[x] = 0;
        continue;
      }

      uint32_t top_label = (y > 0) ? prev_row[x] : 0;
      uint32_t left_label = (x > 0) ? curr_row[x - 1] : 0;

      if (top_label == 0 && left_label == 0) {
        if (num_labels + 1 < MAX_COMPONENTS) {
          num_labels++;
          comp[num_labels].parent = num_labels;
          comp[num_labels].x_min = x;
          comp[num_labels].y_min = y;
          comp[num_labels].x_max = x;
          comp[num_labels].y_max = y;
          comp[num_labels].pixel_count = 1;
          curr_row[x] = num_labels;
        } else {
          curr_row[x] = 0;
        }
      } else if (top_label != 0 && left_label == 0) {
        uint32_t root = dsu_find(comp, top_label);
        if (x < comp[root].x_min) comp[root].x_min = x;
        if (x > comp[root].x_max) comp[root].x_max = x;
        if (y > comp[root].y_max) comp[root].y_max = y;
        comp[root].pixel_count++;
        curr_row[x] = root;
      } else if (top_label == 0 && left_label != 0) {
        uint32_t root = dsu_find(comp, left_label);
        if (x < comp[root].x_min) comp[root].x_min = x;
        if (x > comp[root].x_max) comp[root].x_max = x;
        if (y > comp[root].y_max) comp[root].y_max = y;
        comp[root].pixel_count++;
        curr_row[x] = root;
      } else {
        uint32_t root_top = dsu_find(comp, top_label);
        uint32_t root_left = dsu_find(comp, left_label);
        if (root_top == root_left) {
          uint32_t root = root_top;
          if (x < comp[root].x_min) comp[root].x_min = x;
          if (x > comp[root].x_max) comp[root].x_max = x;
          if (y > comp[root].y_max) comp[root].y_max = y;
          comp[root].pixel_count++;
          curr_row[x] = root;
        } else {
          dsu_union(comp, root_top, root_left);
          if (x < comp[root_top].x_min) comp[root_top].x_min = x;
          if (x > comp[root_top].x_max) comp[root_top].x_max = x;
          if (y > comp[root_top].y_max) comp[root_top].y_max = y;
          comp[root_top].pixel_count++;
          curr_row[x] = root_top;
        }
      }
    }

    uint32_t *tmp = prev_row;
    prev_row = curr_row;
    curr_row = tmp;
  }

  for (uint32_t i = 1; i <= num_labels; i++) {
    if (comp[i].parent == i && comp[i].pixel_count > 0) {
      uint32_t x_min = comp[i].x_min;
      uint32_t y_min = comp[i].y_min;
      uint32_t x_max = comp[i].x_max;
      uint32_t y_max = comp[i].y_max;

      // Sanity check rejecting bounding boxes exceeding frame resolution
      if (!validate_bounding_box(x_min, y_min, x_max, y_max, width, height)) {
        continue;
      }

      uint32_t bw = x_max - x_min + 1;
      uint32_t bh = y_max - y_min + 1;
      uint32_t area = calculate_blob_area(bw, bh);

      // Area threshold filter using uint32_t without 16-bit negative overflow
      if (area >= min_area && area <= max_area) {
        if (result->count < MAX_CROWD_BLOBS) {
          result->blobs[result->count].x_min = x_min;
          result->blobs[result->count].y_min = y_min;
          result->blobs[result->count].x_max = x_max;
          result->blobs[result->count].y_max = y_max;
          result->blobs[result->count].width = bw;
          result->blobs[result->count].height = bh;
          result->blobs[result->count].area = area;
          result->blobs[result->count].pixel_count = comp[i].pixel_count;
          result->count++;
        }
      }
    }
  }

  free(prev_row);
  free(curr_row);
  free(comp);
}

/**
 * Convenience function counting valid crowd blobs within the specified area thresholds.
 */
uint32_t count_crowd_blobs(const uint8_t *binary_mask, uint32_t width,
                           uint32_t height, uint32_t min_area,
                           uint32_t max_area) {
  BlobDetectionResult result;
  extract_crowd_blobs(binary_mask, width, height, min_area, max_area, &result);
  return result.count;
}

// Simple background subtraction and motion detection supporting all resolutions up to 4K
void analyze_crowd_density(const uint8_t *current_frame,
                           const uint8_t *previous_frame, int width, int height,
                           CrowdAnalysisResult *result) {
  if (!current_frame || !previous_frame || !result || width <= 0 || height <= 0)
    return;

  uint32_t u_width = (uint32_t)width;
  uint32_t u_height = (uint32_t)height;

  memset(result->density_map, 0, sizeof(result->density_map));
  memset(result->optical_flow_x, 0, sizeof(result->optical_flow_x));
  memset(result->optical_flow_y, 0, sizeof(result->optical_flow_y));

  uint32_t motion_pixels = 0;
  uint32_t total_cells = GRID_WIDTH * GRID_HEIGHT;

  uint32_t cell_w = u_width / GRID_WIDTH;
  uint32_t cell_h = u_height / GRID_HEIGHT;
  if (cell_w == 0) cell_w = 1;
  if (cell_h == 0) cell_h = 1;

  for (uint32_t gy = 0; gy < GRID_HEIGHT; gy++) {
    for (uint32_t gx = 0; gx < GRID_WIDTH; gx++) {
      uint32_t cell_motion = 0;
      float avg_flow_x = 0.0f;
      float avg_flow_y = 0.0f;

      for (uint32_t y = 0; y < CELL_SIZE; y++) {
        for (uint32_t x = 0; x < CELL_SIZE; x++) {
          uint32_t px = gx * cell_w + x * (cell_w > CELL_SIZE ? cell_w / CELL_SIZE : 1);
          uint32_t py = gy * cell_h + y * (cell_h > CELL_SIZE ? cell_h / CELL_SIZE : 1);

          if (px < u_width && py < u_height) {
            size_t idx = ((size_t)py * (size_t)u_width + (size_t)px) * 3;

            int diff_r = abs((int)current_frame[idx] - (int)previous_frame[idx]);
            int diff_g = abs((int)current_frame[idx + 1] - (int)previous_frame[idx + 1]);
            int diff_b = abs((int)current_frame[idx + 2] - (int)previous_frame[idx + 2]);

            if (diff_r + diff_g + diff_b > 60) {
              cell_motion++;
              avg_flow_x += (float)(diff_r - diff_b) / 255.0f;
              avg_flow_y += (float)(diff_g - diff_r) / 255.0f;
            }
          }
        }
      }

      uint32_t cell_idx = gy * GRID_WIDTH + gx;
      result->density_map[cell_idx] =
          (float)cell_motion / (float)(CELL_SIZE * CELL_SIZE);
      result->optical_flow_x[cell_idx] =
          avg_flow_x / (float)(CELL_SIZE * CELL_SIZE);
      result->optical_flow_y[cell_idx] =
          avg_flow_y / (float)(CELL_SIZE * CELL_SIZE);

      if (cell_motion > (CELL_SIZE * CELL_SIZE) / 4) {
        motion_pixels++;
      }
    }
  }

  float density_ratio = (float)motion_pixels / (float)total_cells;
  result->estimated_count = (int)(density_ratio * 15.0f);
  result->confidence = fminf(1.0f, density_ratio * 2.0f);
}