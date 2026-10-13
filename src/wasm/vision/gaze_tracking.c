/**
 * gaze_tracking.c
 * C implementation of a lightweight facial landmark detector optimized for
 * continuous, low-power webcam streaming.
 *
 * Note: This is a mathematical simulation of a gaze tracker using vector math
 * and dummy frame buffers, as actual ML models require large binary weights.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct {
  float x;
  float y;
} Point2D;

typedef struct {
  Point2D left_eye_corner_l;
  Point2D left_eye_corner_r;
  Point2D left_iris_center;
  Point2D right_eye_corner_l;
  Point2D right_eye_corner_r;
  Point2D right_iris_center;
  Point2D nose_tip;
} FaceLandmarks;

typedef struct {
  float yaw;   // Horizontal gaze angle
  float pitch; // Vertical gaze angle
  int is_looking_at_screen;
} GazeVector;

// Simulated landmark extraction from a grayscale frame buffer
// In reality, this would run a lightweight CNN or Haar Cascade
int extract_landmarks(const uint8_t *frame_buffer, int width, int height,
                      FaceLandmarks *out_landmarks) {
  if (!frame_buffer || !out_landmarks || width <= 0 || height <= 0) {
    return 0; // Failure
  }

  // Dummy logic: assume face is centered in the frame
  float center_x = width / 2.0f;
  float center_y = height / 2.0f;

  // Add some pseudo-random noise based on frame content to simulate movement
  float noise_x = (frame_buffer[0] % 20) - 10.0f;
  float noise_y = (frame_buffer[10] % 20) - 10.0f;

  out_landmarks->left_eye_corner_l =
      (Point2D){center_x - 40.0f + noise_x, center_y - 10.0f + noise_y};
  out_landmarks->left_eye_corner_r =
      (Point2D){center_x - 10.0f + noise_x, center_y - 10.0f + noise_y};
  out_landmarks->left_iris_center =
      (Point2D){center_x - 25.0f + noise_x, center_y - 10.0f + noise_y};

  out_landmarks->right_eye_corner_l =
      (Point2D){center_x + 10.0f + noise_x, center_y - 10.0f + noise_y};
  out_landmarks->right_eye_corner_r =
      (Point2D){center_x + 40.0f + noise_x, center_y - 10.0f + noise_y};
  out_landmarks->right_iris_center =
      (Point2D){center_x + 25.0f + noise_x, center_y - 10.0f + noise_y};

  out_landmarks->nose_tip =
      (Point2D){center_x + noise_x, center_y + 20.0f + noise_y};

  return 1; // Success
}

// Calculate gaze vector based on iris position relative to eye corners
GazeVector calculate_gaze(const FaceLandmarks *landmarks) {
  GazeVector gaze = {0.0f, 0.0f, 0};

  // Left eye ratio
  float left_eye_width =
      landmarks->left_eye_corner_r.x - landmarks->left_eye_corner_l.x;
  float left_iris_offset =
      landmarks->left_iris_center.x -
      (landmarks->left_eye_corner_l.x + left_eye_width / 2.0f);
  float left_yaw_ratio = left_iris_offset / (left_eye_width / 2.0f);

  // Right eye ratio
  float right_eye_width =
      landmarks->right_eye_corner_r.x - landmarks->right_eye_corner_l.x;
  float right_iris_offset =
      landmarks->right_iris_center.x -
      (landmarks->right_eye_corner_l.x + right_eye_width / 2.0f);
  float right_yaw_ratio = right_iris_offset / (right_eye_width / 2.0f);

  // Average yaw
  gaze.yaw = (left_yaw_ratio + right_yaw_ratio) / 2.0f;

  // Pitch calculation (simplified using nose tip relative to eye center)
  float eye_center_y =
      (landmarks->left_eye_corner_l.y + landmarks->right_eye_corner_r.y) / 2.0f;
  float pitch_offset = landmarks->nose_tip.y - eye_center_y;
  gaze.pitch = pitch_offset / 50.0f; // Normalize by expected face height

  // Determine if looking at screen (thresholds can be calibrated)
  if (fabsf(gaze.yaw) < 0.6f && fabsf(gaze.pitch) < 0.6f) {
    gaze.is_looking_at_screen = 1;
  } else {
    gaze.is_looking_at_screen = 0;
  }

  return gaze;
}

// Exported function for WASM
int process_frame(const uint8_t *frame_buffer, int width, int height,
                  float *out_yaw, float *out_pitch, int *out_looking) {
  FaceLandmarks landmarks;
  if (!extract_landmarks(frame_buffer, width, height, &landmarks)) {
    return 0;
  }

  GazeVector gaze = calculate_gaze(&landmarks);

  *out_yaw = gaze.yaw;
  *out_pitch = gaze.pitch;
  *out_looking = gaze.is_looking_at_screen;

  return 1;
}
