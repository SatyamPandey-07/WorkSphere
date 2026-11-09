# NIOSH Daily Sound Exposure Calculation & Formula Reference

_This document provides the mathematical, psychoacoustic, and regulatory reference for WorkSphere's occupational noise exposure monitoring, dosimeter algorithms, and frequency weighting filters._

---

## 1. Overview and Standards

WorkSphere implements real-time audio dosimetry to protect remote workers from cumulative noise-induced hearing loss (NIHL) during extended sessions in coworking spaces, cafes, and shared offices.

The engine supports both international occupational standards:
1. **NIOSH (National Institute for Occupational Safety and Health - Recommended Exposure Limit / REL)**: Designed for conservative, health-protective hearing preservation.
2. **OSHA (Occupational Safety and Health Administration - Permissible Exposure Limit / PEL)**: The legal regulatory standard in the United States.

---

## 2. Mathematical Equations for Sound Exposure Dosimetry

### 2.1 Allowable Exposure Duration ($T$)

The maximum permitted exposure time $T$ (in hours) at a given continuous sound level $L$ (in dBA) is defined as:

$$T = \frac{8}{2^{(L - L_c) / Q}}$$

Where:
- $L$ = Measured sound level in dBA
- $L_c$ = Criterion sound level ($85\text{ dBA}$ for NIOSH, $90\text{ dBA}$ for OSHA)
- $Q$ = Exchange rate ($3\text{ dB}$ for NIOSH, $5\text{ dB}$ for OSHA)

### 2.2 NIOSH Daily Noise Dose Percentage ($D$)

For discrete exposure intervals where sound level $L_i$ lasts for duration $C_i$ (hours), the cumulative daily dose percentage is calculated using the NIOSH standard summation equation:

$$\text{Dose } \% = 100 \times \sum_{i=1}^{n} \frac{C_i}{T_i} = 100 \times \left( \frac{C_1}{T_1} + \frac{C_2}{T_2} + \dots + \frac{C_n}{T_n} \right)$$

Where:
- $C_i$ = Actual elapsed exposure duration at level $i$ (in hours)
- $T_i$ = Maximum allowable duration at level $i$ (in hours)

A daily dose of **100%** corresponds to the maximum permissible daily noise accumulation. When $\text{Dose } \% \ge 100\%$, exposure exceeds the Recommended Exposure Limit (REL) and hearing protective measures or immediate venue relocation are recommended.

### 2.3 Time-Weighted Average (TWA)

The 8-hour Time-Weighted Average represents the constant sound level that, if experienced continuously for 8 hours, would yield the exact same cumulative noise dose:

For NIOSH ($Q = 3\text{ dB}$, $L_c = 85\text{ dBA}$):

$$\text{TWA}_{\text{NIOSH}} = \frac{3}{\log_{10}(2)} \times \log_{10}\left(\frac{\text{Dose}}{100}\right) + 85 = 9.97 \times \log_{10}\left(\frac{\text{Dose}}{100}\right) + 85$$

For OSHA ($Q = 5\text{ dB}$, $L_c = 90\text{ dBA}$):

$$\text{TWA}_{\text{OSHA}} = \frac{5}{\log_{10}(2)} \times \log_{10}\left(\frac{\text{Dose}}{100}\right) + 90 = 16.61 \times \log_{10}\left(\frac{\text{Dose}}{100}\right) + 90$$

---

## 3. Regulatory Comparison: NIOSH vs. OSHA

| Parameter | NIOSH (Recommended Standard) | OSHA (Regulatory Standard) |
| :--- | :--- | :--- |
| **Criterion Sound Level ($L_c$)** | **85 dBA** | **90 dBA** |
| **Exchange Rate ($Q$)** | **3 dB (Equal-Energy Rule)** | **5 dB** |
| **Threshold Level ($L_t$)** | **80 dBA** (or all measured levels) | **90 dBA** (PEL) / **80 dBA** (Action Level) |
| **Max 8-hour Allowable** | $85\text{ dBA}$ | $90\text{ dBA}$ |
| **Max 4-hour Allowable** | $88\text{ dBA}$ ($+3\text{ dB}$) | $95\text{ dBA}$ ($+5\text{ dB}$) |
| **Max 2-hour Allowable** | $91\text{ dBA}$ ($+6\text{ dB}$) | $100\text{ dBA}$ ($+10\text{ dB}$) |
| **Max 1-hour Allowable** | $94\text{ dBA}$ ($+9\text{ dB}$) | $105\text{ dBA}$ ($+15\text{ dB}$) |
| **Max 30-min Allowable** | $97\text{ dBA}$ ($+12\text{ dB}$) | $110\text{ dBA}$ ($+20\text{ dB}$) |
| **Max 15-min Allowable** | $100\text{ dBA}$ ($+15\text{ dB}$) | $115\text{ dBA}$ ($+25\text{ dB}$) |
| **Scientific Basis** | Strictly 3 dB doubling of sound energy | Historical compromise incorporating quiet rest intervals |

### Key Differences:
1. **The 3 dB Exchange Rate (Equal-Energy Hypothesis)**:
   A doubling of sound energy corresponds to an increase of $3\text{ dB}$. NIOSH follows the equal-energy hypothesis: doubling the sound intensity cuts allowable duration in half ($85\text{ dBA}$ for 8 hours $\to$ $88\text{ dBA}$ for 4 hours $\to$ $91\text{ dBA}$ for 2 hours).
2. **OSHA 5 dB Exchange Rate**:
   OSHA allows a $5\text{ dB}$ increase per halving of time ($90\text{ dBA}$ for 8 hours $\to$ $95\text{ dBA}$ for 4 hours). Under NIOSH guidelines, $95\text{ dBA}$ is permitted for only **47.6 minutes**, whereas OSHA permits **4 hours**—demonstrating why WorkSphere prioritizes NIOSH for conservative health protection.

---

## 4. Frequency Weighting (IEC 61672-1:2013 A-Weighting)

Human hearing sensitivity varies significantly by frequency, being most sensitive between 1 kHz and 5 kHz and attenuating substantially below 100 Hz. WorkSphere converts unweighted linear sound pressure levels (dB SPL / Z-weighting) into human-perceived A-weighted sound levels (dBA).

### 4.1 Analog Continuous Transfer Function $R_A(f)$

According to **IEC 61672-1:2013**, the exact continuous frequency response weighting function $R_A(f)$ is:

$$R_A(f) = \frac{12194^2 \cdot f^4}{(f^2 + 20.6^2) \cdot \sqrt{(f^2 + 107.7^2)(f^2 + 737.9^2)} \cdot (f^2 + 12194^2)}$$

The A-weighting gain in decibels $A(f)$ includes a $+1.9997\text{ dB}$ normalization constant to guarantee exactly $0.00\text{ dB}$ at $1000\text{ Hz}$:

$$A(f) = 20 \log_{10}(R_A(f)) + 1.9997\text{ dB}$$

Key pole and zero frequencies:
- $f_1 = 20.598997\text{ Hz}$ (Double high-pass pole)
- $f_2 = 107.65265\text{ Hz}$ (Bandpass shaping pole)
- $f_3 = 737.86223\text{ Hz}$ (Bandpass shaping pole)
- $f_4 = 12194.217\text{ Hz}$ (Double low-pass rolloff pole)

### 4.2 Digital Biquad IIR Filter Approximation (Direct Form II Transposed)

For real-time time-domain audio streaming in the browser and AudioWorklets at $f_s = 48000\text{ Hz}$, the continuous analog transfer function $H_A(s)$ is discretized via the bilinear transform with frequency pre-warping:

$$s = 2 f_s \frac{1 - z^{-1}}{1 + z^{-1}}, \quad \omega_i = 2 f_s \tan\left(\frac{\pi f_i}{f_s}\right)$$

The resulting digital filter is factored into a cascade of **3 second-order biquad sections**:

$$H(z) = G \cdot \prod_{k=1}^{3} \frac{b_{0,k} + b_{1,k}z^{-1} + b_{2,k}z^{-2}}{1 + a_{1,k}z^{-1} + a_{2,k}z^{-2}}$$

#### Biquad Cascade Coefficients ($f_s = 48000\text{ Hz}$):

- **Section 1: Second-Order High-Pass** ($\omega_1 = \text{warp}(20.599\text{ Hz})$):
  - $a_{0} = (2f_s + \omega_1)^2$
  - $b_0 = \frac{4f_s^2}{a_0}, \quad b_1 = \frac{-8f_s^2}{a_0}, \quad b_2 = \frac{4f_s^2}{a_0}$
  - $a_1 = \frac{-2(4f_s^2 - \omega_1^2)}{a_0}, \quad a_2 = \frac{(2f_s - \omega_1)^2}{a_0}$

- **Section 2: Mid-Range Bandpass Shaping** ($\omega_2 = \text{warp}(107.653\text{ Hz}), \omega_3 = \text{warp}(737.862\text{ Hz})$):
  - $a_{0} = (2f_s + \omega_2)(2f_s + \omega_3)$
  - $b_0 = \frac{4f_s^2}{a_0}, \quad b_1 = \frac{-8f_s^2}{a_0}, \quad b_2 = \frac{4f_s^2}{a_0}$
  - $a_1 = \frac{-2(4f_s^2 - \omega_2\omega_3)}{a_0}, \quad a_2 = \frac{(2f_s - \omega_2)(2f_s - \omega_3)}{a_0}$

- **Section 3: Second-Order Low-Pass Rolloff** ($\omega_4 = \text{warp}(12194.217\text{ Hz})$):
  - $a_{0} = (2f_s + \omega_4)^2$
  - $b_0 = \frac{\omega_4^2}{a_0}, \quad b_1 = \frac{2\omega_4^2}{a_0}, \quad b_2 = \frac{\omega_4^2}{a_0}$
  - $a_1 = \frac{-2(4f_s^2 - \omega_4^2)}{a_0}, \quad a_2 = \frac{(2f_s - \omega_4)^2}{a_0}$

---

## 5. Equivalent Continuous Sound Level ($L_{\text{eq}}$)

Because environmental sound fluctuates dynamically, WorkSphere computes the logarithmic equivalent continuous sound level ($L_{\text{eq}}$):

$$L_{\text{eq}} = 10 \log_{10}\left( \frac{1}{N} \sum_{k=1}^{N} 10^{L_k / 10} \right)$$

Where $L_k$ is the instantaneous calibrated A-weighted sound level (dBA) for frame $k$, and $N$ is the total number of audio frames in the monitoring window.

---

## 6. WorkSphere Implementation Reference

The formulas documented above are implemented in the following modules:
- [src/lib/acousticMetrics.ts](file:///c:/Users/admin/Desktop/workfere/src/lib/acousticMetrics.ts):
  - `calculateDailyNoiseDose(decibelLevel, durationMinutes, standard)`
  - `calculateAWeightingGain(freqHz)`
  - `applyAWeightingToSpectrum(frequencies, magnitudes, isDbScale)`
  - `designAWeightingBiquads(sampleRate)`
  - `calculateLeq(decibels)`
  - `calculateAcousticPercentiles(decibels)`
- [src/components/noise/NoiseReportingWidget.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/noise/NoiseReportingWidget.tsx): Live user decibel sampling and submission.
- [src/components/noise/AmbientNoiseTrendGraph.tsx](file:///c:/Users/admin/Desktop/workfere/src/components/noise/AmbientNoiseTrendGraph.tsx): Visual trend curve and threshold classification (<50 dB, 50-70 dB, >70 dB).
