#include <emscripten.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>

#define IMG_WIDTH 320
#define IMG_HEIGHT 240
#define LANDMARK_COUNT 68

typedef struct {
  float x;
  float y;
} Point;

typedef struct {
  Point landmarks[LANDMARK_COUNT];
  int is_face_detected;
  float confidence;
} FaceState;

FaceState current_face;

// Simplified Haar-like feature extraction mock for edge processing
EMSCRIPTEN_KEEPALIVE
void init_tracker() {
  current_face.is_face_detected = 0;
  current_face.confidence = 0.0f;
  memset(current_face.landmarks, 0, sizeof(current_face.landmarks));
}

EMSCRIPTEN_KEEPALIVE
int process_frame(unsigned char *grayscale_img, int width, int height) {
  if (width != IMG_WIDTH || height != IMG_HEIGHT)
    return 0;

  // Mock face detection logic
  // In a real implementation, this would run a cascade classifier or
  // lightweight CNN
  int sum = 0;
  for (int i = 0; i < width * height; i++) {
    sum += grayscale_img[i];
  }

  float avg_brightness = (float)sum / (width * height);

  // Heuristic: If brightness is within a certain range, assume face is present
  if (avg_brightness > 50 && avg_brightness < 200) {
    current_face.is_face_detected = 1;
    current_face.confidence = 0.85f;

    // Generate mock landmarks (focusing on eye region: indices 36-47)
    // Left eye center approx
    current_face.landmarks[36].x = width * 0.35f;
    current_face.landmarks[36].y = height * 0.40f;

    // Right eye center approx
    current_face.landmarks[45].x = width * 0.65f;
    current_face.landmarks[45].y = height * 0.40f;

  } else {
    current_face.is_face_detected = 0;
    current_face.confidence = 0.0f;
  }

  return current_face.is_face_detected;
}

EMSCRIPTEN_KEEPALIVE
float get_eye_aspect_ratio(int eye_start_idx) {
  // Calculate Eye Aspect Ratio (EAR) to detect blinks
  // EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)

  // Using mock landmark offsets for demonstration
  Point p1 = current_face.landmarks[eye_start_idx];
  Point p2 = current_face.landmarks[eye_start_idx + 1];
  Point p3 = current_face.landmarks[eye_start_idx + 2];
  Point p4 = current_face.landmarks[eye_start_idx + 3];
  Point p5 = current_face.landmarks[eye_start_idx + 4];
  Point p6 = current_face.landmarks[eye_start_idx + 5];

  float dist_v1 = sqrtf(powf(p2.x - p6.x, 2) + powf(p2.y - p6.y, 2));
  float dist_v2 = sqrtf(powf(p3.x - p5.x, 2) + powf(p3.y - p5.y, 2));
  float dist_h = sqrtf(powf(p1.x - p4.x, 2) + powf(p1.y - p4.y, 2));

  if (dist_h == 0)
    return 0.0f;

  return (dist_v1 + dist_v2) / (2.0f * dist_h);
}

EMSCRIPTEN_KEEPALIVE
float get_left_eye_ear() { return get_eye_aspect_ratio(36); }

EMSCRIPTEN_KEEPALIVE
float get_right_eye_ear() { return get_eye_aspect_ratio(42); }
