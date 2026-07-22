/**
 * Solar position calculator for WebGL 2.0 God Rays rendering.
 * Computes sun altitude/azimuth from venue coordinates and UTC timestamp
 * using simplified astronomical algorithms (NOAA Solar Calculator).
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export interface SunPosition {
  altitude: number;
  azimuth: number;
  isAboveHorizon: boolean;
  normalizedAltitude: number;
}

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function solarDeclination(dayOfYear: number): number {
  return 23.45 * Math.sin(DEG_TO_RAD * (360 / 365) * (dayOfYear - 81));
}

function equationOfTime(dayOfYear: number): number {
  const B = DEG_TO_RAD * (360 / 365) * (dayOfYear - 81);
  return 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
}

export function calculateSunPosition(
  lat: number,
  lng: number,
  date: Date = new Date(),
): SunPosition {
  const doy = dayOfYear(date);
  const decl = solarDeclination(doy);
  const eot = equationOfTime(doy);

  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;

  const solarTimeFix = eot + 4 * lng;
  const trueSolarTime = utcHours * 60 + solarTimeFix;
  const hourAngle = trueSolarTime / 4 - 180;

  const latRad = lat * DEG_TO_RAD;
  const declRad = decl * DEG_TO_RAD;
  const haRad = hourAngle * DEG_TO_RAD;

  const sinAlt =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(haRad);

  const altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt))) * RAD_TO_DEG;

  const cosAzimuth =
    (Math.sin(declRad) - Math.sin(latRad) * sinAlt) /
    (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)) + 1e-10);

  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth))) * RAD_TO_DEG;

  if (hourAngle > 0) {
    azimuth = 360 - azimuth;
  }

  const normalizedAltitude = Math.max(0, Math.min(1, (altitude + 10) / 100));

  return {
    altitude,
    azimuth,
    isAboveHorizon: altitude > -6,
    normalizedAltitude,
  };
}
