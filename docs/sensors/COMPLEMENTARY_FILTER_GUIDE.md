# Mobile Sensor Fusion: Complementary Filter Guide in `useFlightAttitudeTracker`

This guide details the mathematical foundation, frequency-domain filtering, parameter tuning, and mobile permission lifecycles employed in `useFlightAttitudeTracker` to compute smooth, drift-free pitch and roll attitudes without heavy computational Kalman filter overhead.

---

## 1. Sensor Strengths and Weaknesses

Mobile devices track spatial orientation through two primary Inertial Measurement Unit (IMU) sensors:

| Sensor | Dominant Characteristics | Spectral Domain | Primary Error Source |
| :--- | :--- | :--- | :--- |
| **Accelerometer** | Measures static gravity vector $\vec{g} = [a_x, a_y, a_z]^T$ | Low Frequency ($\le 1\text{ Hz}$) | Linear acceleration noise & dynamic vibration |
| **Gyroscope** | Measures angular rotational velocity $\vec{\omega} = [\omega_x, \omega_y, \omega_z]^T$ | High Frequency ($> 1\text{ Hz}$) | Low-frequency bias drift / integration divergence |

---

## 2. Complementary Filter Formulation

The complementary filter blends the integrated gyroscope rate with the absolute gravity vector orientation using low-pass and high-pass frequency splits:

$$\theta_t = \alpha \cdot (\theta_{t-1} + \omega \cdot \Delta t) + (1 - \alpha) \cdot \theta_{\text{accel}}$$

where:
- $\theta_t$: Estimated attitude angle (pitch $\theta$ or roll $\phi$) at time step $t$.
- $\omega \cdot \Delta t$: Angular displacement integrated over time delta $\Delta t$.
- $\theta_{\text{accel}}$: Instantaneous attitude derived from accelerometer gravity projections:

$$\theta_{\text{accel}} = \text{atan2}(a_x, \sqrt{a_y^2 + a_z^2})$$
$$\phi_{\text{accel}} = \text{atan2}(a_y, a_z)$$

- $\alpha$: Weighting factor balancing high-pass gyroscopic response against low-pass accelerometer tilt correction.

---

## 3. Alpha ($\alpha$) Parameter Tuning Across Refresh Rates

The filter time constant $\tau$ represents the cut-off boundary between gyro integration and gravity correction:

$$\alpha = \frac{\tau}{\tau + \Delta t}$$

For mobile cockpit HUD tracking, optimal empirical stability is achieved with $\tau \approx 0.5\text{ s}$ to $0.75\text{ s}$.

### Standard Display Refresh Rates:

* **60 Hz Displays ($\Delta t \approx 16.67\text{ ms}$)**:
  $$\alpha_{60} = \frac{0.5}{0.5 + 0.01667} \approx 0.968$$

* **120 Hz ProMotion / High-Refresh Displays ($\Delta t \approx 8.33\text{ ms}$)**:
  $$\alpha_{120} = \frac{0.5}{0.5 + 0.00833} \approx 0.984$$

*Dynamic delta compensation* should calculate $\alpha$ dynamically inside the `devicemotion` listener:

```typescript
const tau = 0.5; // filter response time constant (seconds)
const dt = (currentTimestamp - previousTimestamp) / 1000;
const alpha = tau / (tau + dt);

pitch = alpha * (pitch + gyroRatePitch * dt) + (1 - alpha) * accelPitch;