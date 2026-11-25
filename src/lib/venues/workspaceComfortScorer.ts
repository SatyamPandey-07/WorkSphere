export type WorkspaceComfortMode = 'deep_work' | 'client_calls' | 'balanced';
export interface WorkspaceComfortInput { venueId: string; noiseDb?: number | null; outletsPerSeat?: number | null; hasBackupPower?: boolean | null; ergonomicsRating?: number | null; lightingRating?: number | null; downloadMbps?: number | null; latencyMs?: number | null; mode?: WorkspaceComfortMode; }
export interface ComfortPillarBreakdown { acousticsScore: number; powerScore: number; ergonomicsScore: number; wifiScore: number; }
export interface WorkspaceComfortResult { venueId: string; mode: WorkspaceComfortMode; overallScore: number; breakdown: ComfortPillarBreakdown; strengths: string[]; caveats: string[]; }
export const COMFORT_MODE_WEIGHTS: Record<WorkspaceComfortMode, Record<keyof ComfortPillarBreakdown, number>> = {
  deep_work: { acousticsScore: 0.35, powerScore: 0.25, ergonomicsScore: 0.25, wifiScore: 0.15 },
  client_calls: { acousticsScore: 0.25, powerScore: 0.2, ergonomicsScore: 0.15, wifiScore: 0.4 },
  balanced: { acousticsScore: 0.25, powerScore: 0.25, ergonomicsScore: 0.25, wifiScore: 0.25 },
};
function clamp100(value: number): number { if (typeof value !== 'number' || !Number.isFinite(value)) return 50; return Math.min(100, Math.max(0, Math.round(value * 10) / 10)); }
function finiteOrFallback(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function normalizeRatingTo100(value: unknown, fallback: number): number { if (typeof value !== 'number' || !Number.isFinite(value)) return fallback; if (value < 0) return 0; if (value <= 5) return clamp100((value / 5) * 100); return clamp100(value); }
export function scoreAcoustics(noiseDbInput: unknown, mode: WorkspaceComfortMode): number {
  const db = finiteOrFallback(noiseDbInput, 52);
  if (db < 0) return 0;
  if (mode === 'deep_work') { if (db <= 45) return 100; if (db <= 55) return clamp100(100 - (db - 45) * 2.5); if (db <= 75) return clamp100(75 - (db - 55) * 3); return clamp100(15 - (db - 75)); }
  if (mode === 'client_calls') { if (db >= 35 && db <= 58) return 95; if (db < 35) return clamp100(95 - (35 - db) * 1.5); if (db <= 72) return clamp100(95 - (db - 58) * 3.5); return clamp100(46 - (db - 72) * 2); }
  if (db <= 50) return 95; if (db <= 65) return clamp100(95 - (db - 50) * 2.5); return clamp100(57.5 - (db - 65) * 2.5);
}
export function scorePower(outletsPerSeatInput: unknown, hasBackupPowerInput: unknown): number { const outlets = Math.max(0, finiteOrFallback(outletsPerSeatInput, 0.75)); const backupBonus = hasBackupPowerInput === true ? 15 : 0; return clamp100(Math.min(85, (outlets / 1.5) * 85) + backupBonus); }
export function scoreErgonomics(ergonomicsRatingInput: unknown, lightingRatingInput: unknown): number { const ergo = normalizeRatingTo100(ergonomicsRatingInput, 65); const light = normalizeRatingTo100(lightingRatingInput, 65); return clamp100(ergo * 0.65 + light * 0.35); }
export function scoreWifiStability(downloadMbpsInput: unknown, latencyMsInput: unknown): number { const dl = Math.max(0, finiteOrFallback(downloadMbpsInput, 60)); const latency = Math.max(0, finiteOrFallback(latencyMsInput, 35)); const speedComponent = Math.min(65, (dl / 150) * 65); const latencyComponent = latency <= 20 ? 35 : latency >= 180 ? 0 : ((180 - latency) / 160) * 35; return clamp100(speedComponent + latencyComponent); }
export function evaluateWorkspaceComfort(input: WorkspaceComfortInput): WorkspaceComfortResult {
  const mode: WorkspaceComfortMode = input.mode ?? 'balanced';
  const weights = COMFORT_MODE_WEIGHTS[mode];
  const acousticsScore = scoreAcoustics(input.noiseDb, mode);
  const powerScore = scorePower(input.outletsPerSeat, input.hasBackupPower);
  const ergonomicsScore = scoreErgonomics(input.ergonomicsRating, input.lightingRating);
  const wifiScore = scoreWifiStability(input.downloadMbps, input.latencyMs);
  const overallScore = clamp100(acousticsScore * weights.acousticsScore + powerScore * weights.powerScore + ergonomicsScore * weights.ergonomicsScore + wifiScore * weights.wifiScore);
  const strengths: string[] = []; const caveats: string[] = [];
  if (acousticsScore >= 80) strengths.push('Quiet & focus-friendly acoustics'); else if (acousticsScore < 55) caveats.push('High ambient noise for focus');
  if (powerScore >= 80) strengths.push('Abundant power & backup support'); else if (powerScore < 55) caveats.push('Limited power outlets per seat');
  if (ergonomicsScore >= 80) strengths.push('Ergonomic seating & task lighting'); else if (ergonomicsScore < 55) caveats.push('Basic seating / lighting comfort');
  if (wifiScore >= 80) strengths.push('High-throughput, low-latency WiFi'); else if (wifiScore < 55) caveats.push('Unstable or slow WiFi connection');
  return { venueId: input.venueId, mode, overallScore, breakdown: { acousticsScore, powerScore, ergonomicsScore, wifiScore }, strengths, caveats };
}
