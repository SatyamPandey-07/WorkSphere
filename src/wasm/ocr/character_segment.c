/**
 * character_segment.c
 * Implements connected-component labeling to isolate individual characters and
 * text blocks from the binarized image.
 */

#include <stdint.h>
#include <stdlib.h>

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

void segment_characters(const uint8_t *binary_image, int width, int height,
                        SegmentationResult *result) {
  if (!binary_image || !result)
    return;

  result->boxes = NULL;
  result->count = 0;
  result->capacity = 0;

  uint8_t *visited = (uint8_t *)calloc(width * height, sizeof(uint8_t));
  if (!visited)
    return;

  for (int y = 0; y < height; y++) {
    for (int x = 0; x < width; x++) {
      int idx = y * width + x;
      if (binary_image[idx] == 0 &&
          !visited[idx]) { // Assuming black text on white background
        // Flood fill to find bounding box
        int x_min = x, x_max = x, y_min = y, y_max = y;

        // Simple queue for BFS (simplified for scaffold)
        int *queue_x = (int *)malloc(width * height * sizeof(int));
        int *queue_y = (int *)malloc(width * height * sizeof(int));
        int head = 0, tail = 0;

        queue_x[tail] = x;
        queue_y[tail] = y;
        tail++;
        visited[idx] = 1;

        while (head < tail) {
          int cx = queue_x[head];
          int cy = queue_y[head];
          head++;

          if (cx < x_min)
            x_min = cx;
          if (cx > x_max)
            x_max = cx;
          if (cy < y_min)
            y_min = cy;
          if (cy > y_max)
            y_max = cy;

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

        free(queue_x);
        free(queue_y);

        // Filter out noise (very small components)
        int box_w = x_max - x_min;
        int box_h = y_max - y_min;
        if (box_w > 2 && box_h > 2 && box_w < width / 2) {
          BoundingBox box = {x_min, y_min, x_max, y_max};
          add_box(result, box);
        }
      }
    }
  }

  free(visited);
}

void free_segmentation(SegmentationResult *result) {
  if (result && result->boxes) {
    free(result->boxes);
    result->boxes = NULL;
  }
}
