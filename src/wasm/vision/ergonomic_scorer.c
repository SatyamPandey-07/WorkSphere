/**
 * ergonomic_scorer.c
 * Calculates the geometric angles between landmarks to determine slouching and
 * neck strain metrics. Outputs an ergonomic health score and specific violation
 * flags.
 */

#include <math.h>
#include <stdint.h>

#define PI 3.1415926535f
#define RAD_TO_DEG (180.0f / PI)

typedef struct {
  float x;
  float y;
  float confidence;
} Landmark;

typedef struct {
  int is_slouching;
  int is_too_close;
  float neck_angle_deg;
  float shoulder_symmetry;
  float overall_score; // 0.0 to 100.0
} ErgonomicReport;

static float calculate_angle(float ax, float ay, float bx, float by, float cx,
                             float cy) {
  float ba_x = ax - bx;
  float ba_y = ay - by;
  float bc_x = cx - bx;
  float bc_y = cy - by;

  float dot = ba_x * bc_x + ba_y * bc_y;
  float mag_ba = sqrtf(ba_x * ba_x + ba_y * ba_y);
  float mag_bc = sqrtf(bc_x * bc_x + bc_y * bc_y);

  if (mag_ba == 0 || mag_bc == 0)
    return 0.0f;

  float cos_angle = dot / (mag_ba * mag_bc);
  // Clamp to [-1, 1] to avoid NaN from acosf due to floating point errors
  if (cos_angle > 1.0f)
    cos_angle = 1.0f;
  if (cos_angle < -1.0f)
    cos_angle = -1.0f;

  return acosf(cos_angle) * RAD_TO_DEG;
}

static float calculate_distance(float x1, float y1, float x2, float y2) {
  float dx = x1 - x2;
  float dy = y1 - y2;
  return sqrtf(dx * dx + dy * dy);
}

void evaluate_ergonomics(const Landmark *landmarks, int landmark_count,
                         int image_height, ErgonomicReport *report) {
  if (!landmarks || !report || landmark_count < 13)
    return;

  report->is_slouching = 0;
  report->is_too_close = 0;
  report->overall_score = 100.0f;

  // Calculate neck angle (Nose -> Left Shoulder -> Left Hip)
  float neck_angle =
      calculate_angle(landmarks[0].x, landmarks[0].y,  // Nose
                      landmarks[5].x, landmarks[5].y,  // Left Shoulder
                      landmarks[11].x, landmarks[11].y // Left Hip
      );
  report->neck_angle_deg = neck_angle;

  // Ideal neck angle is around 160-170 degrees. < 140 indicates forward
  // head/slouching
  if (neck_angle < 140.0f) {
    report->is_slouching = 1;
    report->overall_score -= (140.0f - neck_angle) * 1.5f;
  }

  // Check shoulder symmetry
  float left_shoulder_y = landmarks[5].y;
  float right_shoulder_y = landmarks[6].y;
  float shoulder_diff = fabsf(left_shoulder_y - right_shoulder_y);
  report->shoulder_symmetry = 1.0f - (shoulder_diff / (float)image_height);

  if (shoulder_diff > image_height * 0.05f) {
    report->overall_score -= 10.0f; // Penalty for uneven shoulders
  }

  // Check proximity to screen (mocked using relative landmark scale)
  float shoulder_width = calculate_distance(landmarks[5].x, landmarks[5].y,
                                            landmarks[6].x, landmarks[6].y);

  // If shoulders occupy > 60% of frame width, user is too close
  // (Assuming image_width is roughly proportional to shoulder_width threshold)
  if (shoulder_width > image_height * 0.6f) {
    report->is_too_close = 1;
    report->overall_score -= 20.0f;
  }

  // Clamp score
  if (report->overall_score < 0.0f)
    report->overall_score = 0.0f;
}
