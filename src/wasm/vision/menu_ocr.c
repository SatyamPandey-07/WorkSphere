#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define EXPORT __attribute__((visibility("default")))
#define MAX_COMPONENTS 512
#define THRESHOLD_BLOCK_SIZE 15

typedef struct {
  int x;
  int y;
  int width;
  int height;
} BoundingBox;

typedef struct {
  int parent;
  int rank;
} DisjointSetNode;

static DisjointSetNode forest[MAX_COMPONENTS * 4];
static BoundingBox boxes[MAX_COMPONENTS];
static int box_count = 0;

int find_root(int i) {
  if (forest[i].parent != i) {
    forest[i].parent = find_root(forest[i].parent);
  }
  return forest[i].parent;
}

void union_sets(int i, int j) {
  int root_i = find_root(i);
  int root_j = find_root(j);
  if (root_i != root_j) {
    if (forest[root_i].rank < forest[root_j].rank) {
      forest[root_i].parent = root_j;
    } else if (forest[root_i].rank > forest[root_j].rank) {
      forest[root_j].parent = root_i;
    } else {
      forest[root_j].parent = root_i;
      forest[root_i].rank++;
    }
  }
}

EXPORT void ocr_preprocess_grayscale(uint8_t *rgba_buffer, uint8_t *gray_buffer,
                                     int width, int height) {
  for (int i = 0; i < width * height; i++) {
    int r_idx = i * 4;
    uint8_t r = rgba_buffer[r_idx];
    uint8_t g = rgba_buffer[r_idx + 1];
    uint8_t b = rgba_buffer[r_idx + 2];
    gray_buffer[i] = (uint8_t)(0.299 * r + 0.587 * g + 0.114 * b);
  }
}

EXPORT void ocr_binarize_otsu(uint8_t *gray_buffer, uint8_t *binary_buffer,
                              int width, int height) {
  int histogram[256] = {0};
  int total_pixels = width * height;

  for (int i = 0; i < total_pixels; i++) {
    histogram[gray_buffer[i]]++;
  }

  float sum_total = 0;
  for (int i = 0; i < 256; i++)
    sum_total += i * histogram[i];

  float sum_bg = 0, weight_bg = 0, weight_fg = 0;
  float max_variance = 0, threshold = 0;

  for (int t = 0; t < 256; t++) {
    weight_bg += histogram[t];
    if (weight_bg == 0)
      continue;

    weight_fg = total_pixels - weight_bg;
    if (weight_fg == 0)
      break;

    sum_bg += t * histogram[t];
    float mean_bg = sum_bg / weight_bg;
    float mean_fg = (sum_total - sum_bg) / weight_fg;

    float variance =
        weight_bg * weight_fg * (mean_bg - mean_fg) * (mean_bg - mean_fg);
    if (variance > max_variance) {
      max_variance = variance;
      threshold = t;
    }
  }

  for (int i = 0; i < total_pixels; i++) {
    binary_buffer[i] = (gray_buffer[i] > threshold) ? 255 : 0;
  }
}

EXPORT int ocr_extract_components(uint8_t *binary_buffer, int width,
                                  int height) {
  box_count = 0;
  int label = 0;
  int *labels = (int *)malloc(width * height * sizeof(int));
  memset(labels, 0, width * height * sizeof(int));

  for (int i = 0; i < MAX_COMPONENTS * 4; i++) {
    forest[i].parent = i;
    forest[i].rank = 0;
  }

  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      if (binary_buffer[y * width + x] == 0) {
        int left = (x > 0) ? labels[y * width + (x - 1)] : 0;
        int up = (y > 0) ? labels[(y - 1) * width + x] : 0;

        if (left == 0 && up == 0) {
          label++;
          labels[y * width + x] = label;
        } else if (left != 0 && up == 0) {
          labels[y * width + x] = left;
        } else if (left == 0 && up != 0) {
          labels[y * width + x] = up;
        } else {
          labels[y * width + x] = left;
          if (left != up)
            union_sets(left, up);
        }
      }
    }
  }

  for (int i = 0; i < MAX_COMPONENTS; i++) {
    boxes[i].x = width;
    boxes[i].y = height;
    boxes[i].width = 0;
    boxes[i].height = 0;
  }

  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      int l = labels[y * width + x];
      if (l > 0) {
        int root = find_root(l);
        if (root < MAX_COMPONENTS) {
          if (x < boxes[root].x)
            boxes[root].x = x;
          if (y < boxes[root].y)
            boxes[root].y = y;
          if (x > boxes[root].x + boxes[root].width)
            boxes[root].width = x - boxes[root].x;
          if (y > boxes[root].y + boxes[root].height)
            boxes[root].height = y - boxes[root].y;
        }
      }
    }
  }

  int valid_count = 0;
  for (int i = 0; i < MAX_COMPONENTS; i++) {
    if (boxes[i].width > 5 && boxes[i].height > 10 &&
        boxes[i].width < width / 2) {
      if (valid_count != i)
        boxes[valid_count] = boxes[i];
      valid_count++;
    }
  }

  box_count = valid_count;
  free(labels);
  return box_count;
}

EXPORT void ocr_get_bounding_boxes(int *out_buffer) {
  for (int i = 0; i < box_count; i++) {
    out_buffer[i * 4] = boxes[i].x;
    out_buffer[i * 4 + 1] = boxes[i].y;
    out_buffer[i * 4 + 2] = boxes[i].width;
    out_buffer[i * 4 + 3] = boxes[i].height;
  }
}
