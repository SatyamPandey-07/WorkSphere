/**
 * ble_kalman.c
 * C implementation of the multidimensional Kalman filter to smooth noisy RSSI
 * beacon signals. Essential for stabilizing indoor positioning data derived
 * from fluctuating Bluetooth signals.
 */

#include <math.h>
#include <stdint.h>
#include <stdlib.h>

typedef struct {
  float x;   // Estimated position X
  float y;   // Estimated position Y
  float Pxx; // Estimation error covariance X
  float Pyy; // Estimation error covariance Y
  float R;   // Measurement noise covariance
  float Q;   // Process noise covariance
} KalmanState2D;

void kalman_init(KalmanState2D *state, float initial_x, float initial_y,
                 float measurement_noise, float process_noise) {
  if (!state)
    return;
  state->x = initial_x;
  state->y = initial_y;
  state->Pxx = 1.0f;
  state->Pyy = 1.0f;
  state->R = measurement_noise;
  state->Q = process_noise;
}

void kalman_update(KalmanState2D *state, float measured_x, float measured_y) {
  if (!state)
    return;

  // --- Update X axis ---
  // Kalman Gain: K = P / (P + R)
  float Kx = state->Pxx / (state->Pxx + state->R);
  // Update estimate: x = x + K * (measured - x)
  state->x = state->x + Kx * (measured_x - state->x);
  // Update error covariance: P = (1 - K) * P + Q
  state->Pxx = (1.0f - Kx) * state->Pxx + state->Q;

  // --- Update Y axis ---
  float Ky = state->Pyy / (state->Pyy + state->R);
  state->y = state->y + Ky * (measured_y - state->y);
  state->Pyy = (1.0f - Ky) * state->Pyy + state->Q;
}

void kalman_predict(KalmanState2D *state, float velocity_x, float velocity_y,
                    float dt) {
  if (!state)
    return;

  // Predict state (assuming constant velocity model)
  state->x += velocity_x * dt;
  state->y += velocity_y * dt;

  // Predict error covariance
  state->Pxx += state->Q;
  state->Pyy += state->Q;
}

float kalman_get_x(const KalmanState2D *state) {
  return state ? state->x : 0.0f;
}

float kalman_get_y(const KalmanState2D *state) {
  return state ? state->y : 0.0f;
}
