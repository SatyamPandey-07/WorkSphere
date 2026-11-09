/**
 * contour_tracer.c
 * Implements the Moore neighborhood tracing algorithm to convert edges into
 * closed vector polygons. Outputs a sequence of (x, y) coordinates representing
 * the boundaries of detected objects.
 */

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

// Direction vectors for 8-connected neighborhood (Moore neighborhood)
static const int dx[8] = {1, 1, 0, -1, -1, -1, 0, 1};
static const int dy[8] = {0, 1, 1, 1, 0, -1, -1, -1};

typedef struct {
  int x;
  int y;
} Point;

typedef struct {
  Point *points;
  int count;
  int capacity;
} Polygon;

static void add_point(Polygon *poly, int x, int y) {
  if (poly->count >= poly->capacity) {
    poly->capacity = poly->capacity == 0 ? 16 : poly->capacity * 2;
    poly->points =
        (Point *)realloc(poly->points, poly->capacity * sizeof(Point));
  }
  poly->points[poly->count].x = x;
  poly->points[poly->count].y = y;
  poly->count++;
}

static uint8_t get_pixel(const uint8_t *image, int width, int height, int x,
                         int y) {
  if (x < 0 || x >= width || y < 0 || y >= height)
    return 0;
  return image[y * width + x];
}

void trace_contours(const uint8_t *edge_image, int width, int height,
                    Polygon **out_polygons, int *out_polygon_count) {
  if (!edge_image || !out_polygons || !out_polygon_count)
    return;

  *out_polygons = NULL;
  *out_polygon_count = 0;

  if (width <= 0 || height <= 0)
    return;

  // Check if detected edge pixel count is zero
  int edge_pixels_found = 0;
  int total_pixels = width * height;
  for (int i = 0; i < total_pixels; i++) {
    if (edge_image[i] == 255) {
      edge_pixels_found++;
    }
  }

  if (edge_pixels_found == 0) {
    return;
  }

  uint8_t *visited = (uint8_t *)calloc(width * height, sizeof(uint8_t));
  if (!visited)
    return;

  for (int y = 1; y < height - 1; y++) {
    for (int x = 1; x < width - 1; x++) {
      if (edge_image[y * width + x] == 255 && !visited[y * width + x]) {
        // Found a new contour start point
        Polygon *poly = (Polygon *)malloc(sizeof(Polygon));
        poly->points = NULL;
        poly->count = 0;
        poly->capacity = 0;

        int cx = x;
        int cy = y;
        int start_x = x;
        int start_y = y;
        int cdir = 7; // Initial search direction

        add_point(poly, cx, cy);
        visited[cy * width + cx] = 1;

        int steps = 0;
        int max_steps = width * height; // Prevent infinite loops

        while (steps < max_steps) {
          int found = 0;
          for (int i = 0; i < 8; i++) {
            int dir = (cdir + i) % 8;
            int nx = cx + dx[dir];
            int ny = cy + dy[dir];

            if (get_pixel(edge_image, width, height, nx, ny) == 255) {
              cx = nx;
              cy = ny;
              cdir = (dir + 4) % 8; // Reverse direction for next search
              add_point(poly, cx, cy);
              visited[cy * width + cx] = 1;
              found = 1;
              break;
            }
          }

          if (!found || (cx == start_x && cy == start_y)) {
            break; // Contour closed or broken
          }
          steps++;
        }

        if (poly->count > 3) { // Discard noise
          *out_polygon_count += 1;
          *out_polygons = (Polygon *)realloc(
              *out_polygons, (*out_polygon_count) * sizeof(Polygon));
          (*out_polygons)[*out_polygon_count - 1] = *poly;
        } else {
          free(poly->points);
          free(poly);
        }
      }
    }
  }

  free(visited);
}

void free_polygons(Polygon *polygons, int count) {
  if (!polygons)
    return;
  for (int i = 0; i < count; i++) {
    free(polygons[i].points);
  }
  free(polygons);
}
