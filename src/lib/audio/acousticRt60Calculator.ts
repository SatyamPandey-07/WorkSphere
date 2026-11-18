export const MIN_RT60_SECONDS = 0.05;

export interface AcousticRoomSurface {
  areaM2: number;
  absorptionCoefficient: number;
}

export interface SabineRoomInput {
  volumeM3: number;
  surfaces: readonly AcousticRoomSurface[];
}

/**
 * Estimate room reverberation time using Sabine's formula.
 * Invalid dimensions or absorption coefficients return null instead of
 * allowing divide-by-zero, negative, NaN, or infinite values into the UI.
 */
export function calculateSabineRt60(input: SabineRoomInput): number | null {
  if (!input || typeof input !== "object") return null;
  const { volumeM3, surfaces } = input;

  if (
    !Number.isFinite(volumeM3) ||
    volumeM3 <= 0 ||
    !Array.isArray(surfaces) ||
    surfaces.length === 0
  ) {
    return null;
  }

  let equivalentAbsorptionArea = 0;
  for (const surface of surfaces) {
    if (!surface || typeof surface !== "object") return null;
    if (
      !Number.isFinite(surface.areaM2) ||
      surface.areaM2 <= 0 ||
      !Number.isFinite(surface.absorptionCoefficient) ||
      surface.absorptionCoefficient < 0 ||
      surface.absorptionCoefficient > 1
    ) {
      return null;
    }

    equivalentAbsorptionArea +=
      surface.areaM2 * surface.absorptionCoefficient;
  }

  if (
    !Number.isFinite(equivalentAbsorptionArea) ||
    equivalentAbsorptionArea <= 0
  ) {
    return null;
  }

  const rt60 = (0.161 * volumeM3) / equivalentAbsorptionArea;
  return Number.isFinite(rt60) ? Math.max(MIN_RT60_SECONDS, rt60) : null;
}

/**
 * Estimate RT60 from an impulse response using Schroeder backward integration.
 * Returns null for invalid/empty input or when a usable -5 dB to -25 dB decay
 * interval cannot be found.
 */
export function calculateRt60FromImpulseResponse(
  impulseResponse: ArrayLike<number>,
  sampleRate: number,
): number | null {
  if (
    !impulseResponse ||
    !Number.isInteger(impulseResponse.length) ||
    impulseResponse.length < 2 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return null;
  }

  const integratedEnergy = new Float64Array(impulseResponse.length);
  let energy = 0;

  for (let index = impulseResponse.length - 1; index >= 0; index -= 1) {
    const sample = impulseResponse[index];
    if (!Number.isFinite(sample)) return null;

    energy += sample * sample;
    if (!Number.isFinite(energy)) return null;
    integratedEnergy[index] = energy;
  }

  const totalEnergy = integratedEnergy[0];
  if (!Number.isFinite(totalEnergy) || totalEnergy <= 0) return null;

  const maxDb = 10 * Math.log10(totalEnergy);
  if (!Number.isFinite(maxDb)) return null;

  let startTime = -1;
  let endTime = -1;

  for (let index = 0; index < integratedEnergy.length; index += 1) {
    const currentEnergy = integratedEnergy[index];
    const db =
      currentEnergy <= 0
        ? Number.NEGATIVE_INFINITY
        : 10 * Math.log10(currentEnergy) - maxDb;

    if (startTime < 0 && db <= -5) {
      startTime = index / sampleRate;
    }
    if (endTime < 0 && db <= -25) {
      endTime = index / sampleRate;
      break;
    }
  }

  if (
    startTime < 0 ||
    endTime <= startTime ||
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime)
  ) {
    return null;
  }

  const rt60 = (endTime - startTime) * 3;
  return Number.isFinite(rt60) ? Math.max(MIN_RT60_SECONDS, rt60) : null;
}
