#include <math.h>
#include <stdint.h>

#define EXPORT __attribute__((visibility("default")))

typedef struct {
  float x;
  float y;
} Point2D;

typedef struct {
  float matrix[9];
} HomographyMatrix;

static HomographyMatrix current_homography;

void invert_3x3(float *m, float *out) {
  float det = m[0] * (m[4] * m[8] - m[7] * m[5]) -
              m[1] * (m[3] * m[8] - m[6] * m[5]) +
              m[2] * (m[3] * m[7] - m[6] * m[4]);

  if (fabs(det) < 1e-6)
    return;

  float inv_det = 1.0f / det;
  out[0] = (m[4] * m[8] - m[5] * m[7]) * inv_det;
  out[1] = (m[2] * m[7] - m[1] * m[8]) * inv_det;
  out[2] = (m[1] * m[5] - m[2] * m[4]) * inv_det;
  out[3] = (m[5] * m[6] - m[3] * m[8]) * inv_det;
  out[4] = (m[0] * m[8] - m[2] * m[6]) * inv_det;
  out[5] = (m[2] * m[3] - m[0] * m[5]) * inv_det;
  out[6] = (m[3] * m[7] - m[4] * m[6]) * inv_det;
  out[7] = (m[1] * m[6] - m[0] * m[7]) * inv_det;
  out[8] = (m[0] * m[4] - m[1] * m[3]) * inv_det;
}

EXPORT void ar_calculate_homography(float *src_pts, float *dst_pts, int count) {
  if (count < 4)
    return;

  float A[8][8];
  float B[8];

  for (int i = 0; i < 4; i++) {
    float x = src_pts[i * 2];
    float y = src_pts[i * 2 + 1];
    float u = dst_pts[i * 2];
    float v = dst_pts[i * 2 + 1];

    A[i * 2][0] = x;
    A[i * 2][1] = y;
    A[i * 2][2] = 1;
    A[i * 2][3] = 0;
    A[i * 2][4] = 0;
    A[i * 2][5] = 0;
    A[i * 2][6] = -u * x;
    A[i * 2][7] = -u * y;
    B[i * 2] = u;

    A[i * 2 + 1][0] = 0;
    A[i * 2 + 1][1] = 0;
    A[i * 2 + 1][2] = 0;
    A[i * 2 + 1][3] = x;
    A[i * 2 + 1][4] = y;
    A[i * 2 + 1][5] = 1;
    A[i * 2 + 1][6] = -v * x;
    A[i * 2 + 1][7] = -v * y;
    B[i * 2 + 1] = v;
  }

  float h[8];
  for (int i = 0; i < 8; i++) {
    for (int j = i + 1; j < 8; j++) {
      if (fabs(A[i][i]) < fabs(A[j][i])) {
        for (int k = 0; k < 8; k++) {
          float temp = A[i][k];
          A[i][k] = A[j][k];
          A[j][k] = temp;
        }
        float temp = B[i];
        B[i] = B[j];
        B[j] = temp;
      }
    }

    for (int j = i + 1; j < 8; j++) {
      float factor = A[j][i] / A[i][i];
      for (int k = i; k < 8; k++) {
        A[j][k] -= factor * A[i][k];
      }
      B[j] -= factor * B[i];
    }
  }

  for (int i = 7; i >= 0; i--) {
    h[i] = B[i];
    for (int j = i + 1; j < 8; j++) {
      h[i] -= A[i][j] * h[j];
    }
    h[i] /= A[i][i];
  }

  for (int i = 0; i < 8; i++)
    current_homography.matrix[i] = h[i];
  current_homography.matrix[8] = 1.0f;
}

EXPORT void ar_transform_points(float *in_pts, float *out_pts, int count) {
  for (int i = 0; i < count; i++) {
    float x = in_pts[i * 2];
    float y = in_pts[i * 2 + 1];

    float w = current_homography.matrix[6] * x +
              current_homography.matrix[7] * y + current_homography.matrix[8];
    if (fabs(w) < 1e-6)
      w = 1e-6;

    out_pts[i * 2] =
        (current_homography.matrix[0] * x + current_homography.matrix[1] * y +
         current_homography.matrix[2]) /
        w;
    out_pts[i * 2 + 1] =
        (current_homography.matrix[3] * x + current_homography.matrix[4] * y +
         current_homography.matrix[5]) /
        w;
  }
}

EXPORT void ar_draw_bounding_box(uint8_t *frame_buffer, int frame_w,
                                 int frame_h, int x, int y, int w, int h,
                                 uint8_t r, uint8_t g, uint8_t b) {
  for (int i = x; i < x + w && i < frame_w; i++) {
    if (y >= 0 && y < frame_h) {
      frame_buffer[(y * frame_w + i) * 4] = r;
      frame_buffer[(y * frame_w + i) * 4 + 1] = g;
      frame_buffer[(y * frame_w + i) * 4 + 2] = b;
      frame_buffer[(y * frame_w + i) * 4 + 3] = 255;
    }
    if (y + h >= 0 && y + h < frame_h) {
      frame_buffer[((y + h) * frame_w + i) * 4] = r;
      frame_buffer[((y + h) * frame_w + i) * 4 + 1] = g;
      frame_buffer[((y + h) * frame_w + i) * 4 + 2] = b;
      frame_buffer[((y + h) * frame_w + i) * 4 + 3] = 255;
    }
  }

  for (int j = y; j < y + h && j < frame_h; j++) {
    if (x >= 0 && x < frame_w) {
      frame_buffer[(j * frame_w + x) * 4] = r;
      frame_buffer[(j * frame_w + x) * 4 + 1] = g;
      frame_buffer[(j * frame_w + x) * 4 + 2] = b;
      frame_buffer[(j * frame_w + x) * 4 + 3] = 255;
    }
    if (x + w >= 0 && x + w < frame_w) {
      frame_buffer[(j * frame_w + x + w) * 4] = r;
      frame_buffer[(j * frame_w + x + w) * 4 + 1] = g;
      frame_buffer[(j * frame_w + x + w) * 4 + 2] = b;
      frame_buffer[(j * frame_w + x + w) * 4 + 3] = 255;
    }
  }
}
