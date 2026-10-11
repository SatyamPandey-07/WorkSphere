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

typedef struct {
  float density_map[GRID_WIDTH * GRID_HEIGHT];
  float optical_flow_x[GRID_WIDTH * GRID_HEIGHT];
  float optical_flow_y[GRID_WIDTH * GRID_HEIGHT];
  int estimated_count;
  float confidence;
} CrowdAnalysisResult;

// Simple background subtraction and motion detection
void analyze_crowd_density(const uint8_t *current_frame,
                           const uint8_t *previous_frame, int width, int height,
                           CrowdAnalysisResult *result) {
  if (!current_frame || !previous_frame || !result)
    return;

  memset(result->density_map, 0, sizeof(result->density_map));
  memset(result->optical_flow_x, 0, sizeof(result->optical_flow_x));
  memset(result->optical_flow_y, 0, sizeof(result->optical_flow_y));

  int motion_pixels = 0;
  int total_cells = GRID_WIDTH * GRID_HEIGHT;

  // Process in downsampled grid for performance and privacy
  for (int gy = 0; gy < GRID_HEIGHT; gy++) {
    for (int gx = 0; gx < GRID_WIDTH; gx++) {
      int cell_motion = 0;
      float avg_flow_x = 0.0f;
      float avg_flow_y = 0.0f;

      // Analyze cell
      for (int y = 0; y < CELL_SIZE; y++) {
        for (int x = 0; x < CELL_SIZE; x++) {
          int px = gx * CELL_SIZE + x;
          int py = gy * CELL_SIZE + y;

          if (px < width && py < height) {
            int idx = (py * width + px) * 3; // Assuming RGB

            // Simple absolute difference for motion detection
            int diff_r =
                abs((int)current_frame[idx] - (int)previous_frame[idx]);
            int diff_g =
                abs((int)current_frame[idx + 1] - (int)previous_frame[idx + 1]);
            int diff_b =
                abs((int)current_frame[idx + 2] - (int)previous_frame[idx + 2]);

            if (diff_r + diff_g + diff_b > 60) { // Motion threshold
              cell_motion++;
              // Mock optical flow calculation (simplified gradient)
              avg_flow_x += (float)(diff_r - diff_b) / 255.0f;
              avg_flow_y += (float)(diff_g - diff_r) / 255.0f;
            }
          }
        }
      }

      int cell_idx = gy * GRID_WIDTH + gx;
      result->density_map[cell_idx] =
          (float)cell_motion / (CELL_SIZE * CELL_SIZE);
      result->optical_flow_x[cell_idx] = avg_flow_x / (CELL_SIZE * CELL_SIZE);
      result->optical_flow_y[cell_idx] = avg_flow_y / (CELL_SIZE * CELL_SIZE);

      if (cell_motion > (CELL_SIZE * CELL_SIZE) / 4) {
        motion_pixels++;
      }
    }
  }

  // Estimate count based on motion density and flow coherence
  // This is a heuristic model; production would use a trained lightweight CNN
  float density_ratio = (float)motion_pixels / total_cells;
  result->estimated_count =
      (int)(density_ratio * 15.0f); // Max ~15 people in frame

  // Confidence based on flow coherence (simplified)
  result->confidence = fminf(1.0f, density_ratio * 2.0f);
}