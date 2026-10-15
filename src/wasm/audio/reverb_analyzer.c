#include <emscripten.h>
#include <math.h>
#include <stdlib.h>

/**
 * Calculates the Schroeder backward integration to determine the precise
 * RT60 decay time across the impulse response.
 */
EMSCRIPTEN_KEEPALIVE
double calculate_rt60(float *rir, int len, int sample_rate) {
  if (len == 0)
    return 0.0;

  // Schroeder backward integration
  double *integrated = (double *)malloc(len * sizeof(double));
  double sum = 0.0;

  for (int i = len - 1; i >= 0; i--) {
    sum += rir[i] * rir[i];
    integrated[i] = sum;
  }

  // Convert to dB
  double max_db = 10.0 * log10(integrated[0]);

  // Find time for -5dB and -25dB (standard RT20 extrapolated to RT60)
  double t1 = -1, t2 = -1;
  for (int i = 0; i < len; i++) {
    double db = 10.0 * log10(integrated[i]) - max_db;
    if (t1 < 0 && db <= -5.0)
      t1 = (double)i / sample_rate;
    if (t2 < 0 && db <= -25.0) {
      t2 = (double)i / sample_rate;
      break;
    }
  }

  free(integrated);

  if (t1 < 0 || t2 < 0 || t1 >= t2)
    return 0.0;

  // Extrapolate RT20 to RT60
  double rt20 = t2 - t1;
  return rt20 * 3.0;
}
