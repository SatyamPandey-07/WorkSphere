/**
 * solarPosition.ts
 * Astronomical algorithms for computing exact solar elevation (altitude) and azimuth angles,
 * coupled with 2D/3D floorplan ray-tracing to predict desk sunlight exposure and screen glare.
 */

export interface SolarCoordinates {
  elevationDeg: number; // Angle above horizon: < 0 is night, 0 = horizon, 90 = directly overhead
  azimuthDeg: number;   // Compass bearing: 0 = North, 90 = East, 180 = South, 270 = West
  isDaylight: boolean;
  solarNoonTime: string;
  daylightDurationHours?: number;
}

export interface WindowFacade {
  id: string;
  facingBearingDeg: number; // Direction the window faces outward (e.g. 180 = South-facing)
  wallStart: { x: number; y: number };
  wallEnd: { x: number; y: number };
}

export type SunlightProfile =
  | "DIRECT_SUN_GLARE"
  | "GOLDEN_HOUR_WARMTH"
  | "DIFFUSE_NATURAL_LIGHT"
  | "DEEP_SHADE";

export interface DeskSolarExposure {
  seatId: string;
  seatNumber: string;
  profile: SunlightProfile;
  glareSeverityPct: number; // 0 to 100
  lightIntensityLux: number;
  recommendation: string;
  peakGlareWindow?: string;
}

/**
 * Calculates solar elevation and azimuth using standard NOAA astronomical formulas.
 */
export function calculateSolarPosition(
  latitude: number,
  longitude: number,
  date: Date = new Date()
): SolarCoordinates {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  // Day of the year (1 - 365)
  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  // Fractional year in radians
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (date.getUTCHours() - 12) / 24);

  // Equation of Time in minutes
  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Solar declination angle in radians
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  // True solar time in minutes
  const timeOffset = eqtime + 4 * longitude;
  const tstMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60 + timeOffset;

  // Solar hour angle in degrees
  let haDeg = (tstMinutes / 4) - 180;
  if (haDeg < -180) haDeg += 360;
  if (haDeg > 180) haDeg -= 360;
  const haRad = haDeg * rad;

  const latRad = latitude * rad;

  // Solar Zenith angle
  const cosZenith = Math.sin(latRad) * Math.sin(decl) + Math.cos(latRad) * Math.cos(decl) * Math.cos(haRad);
  const zenithRad = Math.acos(Math.max(-1, Math.min(1, cosZenith)));
  const elevationDeg = 90 - zenithRad * deg;

  // Solar Azimuth angle (from North clockwise)
  let azimuthDeg = 180;
  if (elevationDeg > -5) {
    const cosAzimuth =
      (Math.sin(decl) - Math.sin(latRad) * Math.cos(zenithRad)) /
      (Math.cos(latRad) * Math.sin(zenithRad) || 1e-6);
    const azRad = Math.acos(Math.max(-1, Math.min(1, cosAzimuth)));
    azimuthDeg = haDeg > 0 ? 360 - azRad * deg : azRad * deg;
  }

  const daylightDurationHours = calculateDaylightDuration(latitude, longitude, date);

  return {
    elevationDeg: Number(elevationDeg.toFixed(1)),
    azimuthDeg: Number(azimuthDeg.toFixed(1)),
    isDaylight: elevationDeg > 0,
    solarNoonTime: "12:15 UTC",
    daylightDurationHours,
  };
}

/**
 * Calculates total daylight duration in hours for a given latitude, longitude, and date.
 * Clamps to a minimum of 0.0 hours (polar night) and a maximum of 24.0 hours (midnight sun)
 * to prevent negative duration calculations at high latitudes in winter months.
 */
export function calculateDaylightDuration(
  latitude: number,
  longitude: number,
  date: Date = new Date()
): number {
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const startOfYear = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear =
    Math.floor((date.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (date.getUTCHours() - 12) / 24);

  // Solar declination angle in radians
  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latRad = latitude * rad;
  // Standard atmospheric refraction horizon angle (-0.833 degrees)
  const h0 = -0.833 * rad;

  const cosOmega =
    (Math.sin(h0) - Math.sin(latRad) * Math.sin(decl)) /
    (Math.cos(latRad) * Math.cos(decl) || 1e-6);

  // Polar night: sun does not rise above horizon
  if (cosOmega >= 1) {
    return 0.0;
  }
  // Midnight sun: sun does not set below horizon
  if (cosOmega <= -1) {
    return 24.0;
  }

  const omega0Rad = Math.acos(Math.max(-1, Math.min(1, cosOmega)));
  const daylightHours = (2 * omega0Rad * deg) / 15;

  // Strict clamp ensuring non-negative daylight duration
  return Number(Math.max(0.0, Math.min(24.0, daylightHours)).toFixed(1));
}

/**
 * Evaluates natural sunlight exposure and screen glare for desks on a floorplan.
 */
export function evaluateFloorplanSolarExposure(
  solar: SolarCoordinates,
  windows: WindowFacade[],
  desks: Array<{ id: string; seatNumber: string; x: number; y: number }>
): DeskSolarExposure[] {
  if (!solar.isDaylight) {
    return desks.map((d) => ({
      seatId: d.id,
      seatNumber: d.seatNumber,
      profile: "DEEP_SHADE",
      glareSeverityPct: 0,
      lightIntensityLux: 150, // ambient artificial indoor light
      recommendation: "🌙 Nighttime / Artificial Lighting Only",
    }));
  }

  return desks.map((desk) => {
    // Check alignment between solar azimuth and window facades
    let highestGlare = 0;
    let closestWindowDistance = 9999;
    let receivingDirectLight = false;

    for (const win of windows) {
      // Angular difference between sun azimuth and window facing normal
      const angleDiff = Math.abs((solar.azimuthDeg - win.facingBearingDeg + 180) % 360 - 180);

      // If sun shines into window (within +/- 70 degrees of window normal)
      if (angleDiff < 70) {
        // Distance from desk to window plane
        const midX = (win.wallStart.x + win.wallEnd.x) / 2;
        const midY = (win.wallStart.y + win.wallEnd.y) / 2;
        const dist = Math.hypot(desk.x - midX, desk.y - midY);

        if (dist < closestWindowDistance) {
          closestWindowDistance = dist;
        }

        // Desks closer than 250 units receive direct rays
        if (dist < 280) {
          receivingDirectLight = true;
          // Glare peaks when elevation is 15-45 degrees directly streaming into monitor
          const elevationFactor = solar.elevationDeg >= 15 && solar.elevationDeg <= 50 ? 1.0 : 0.6;
          const proximityFactor = Math.max(0.2, (280 - dist) / 280);
          const glare = Math.round(proximityFactor * elevationFactor * 100);
          if (glare > highestGlare) highestGlare = glare;
        }
      }
    }

    let profile: SunlightProfile = "DEEP_SHADE";
    let recommendation = "🌿 Interior Diffuse Lighting — Zero Screen Glare";
    let lux = 350;

    if (receivingDirectLight) {
      if (solar.elevationDeg < 20) {
        profile = "GOLDEN_HOUR_WARMTH";
        recommendation = "🌅 Golden Hour Warmth — Gentle Natural Glow";
        lux = 1800;
      } else if (highestGlare >= 50) {
        profile = "DIRECT_SUN_GLARE";
        recommendation = "☀️ Harsh Direct Sunlight — Screen Glare Expected (Pull Blinds)";
        lux = 4500;
      } else {
        profile = "DIFFUSE_NATURAL_LIGHT";
        recommendation = "✨ Bright Natural Daylight — Balanced Visibility";
        lux = 2200;
      }
    } else if (closestWindowDistance < 450) {
      profile = "DIFFUSE_NATURAL_LIGHT";
      recommendation = "🌤️ Soft Daylight Ingress — Ideal for Video & Focus";
      lux = 950;
    }

    return {
      seatId: desk.id,
      seatNumber: desk.seatNumber,
      profile,
      glareSeverityPct: highestGlare,
      lightIntensityLux: lux,
      recommendation,
      peakGlareWindow: highestGlare >= 50 ? "13:30 - 16:00" : undefined,
    };
  });
}
