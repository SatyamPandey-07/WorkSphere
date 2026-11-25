export type NoiseLayerType = 'white' | 'pink' | 'rain';
export interface SoundscapePreset { id: string; name: string; masterGain: number; layers: Record<NoiseLayerType, number>; }
export interface StorageLike { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void; }
export interface WorkerLike { postMessage: (message: unknown) => void; terminate: () => void; }
export type WorkerFactory = () => WorkerLike;
export const DEFAULT_SOUNDSCAPE_PRESET: SoundscapePreset = { id: 'nomad-focus', name: 'Nomad Focus', masterGain: 0.6, layers: { white: 0.15, pink: 0.45, rain: 0.55 } };
export const PRESET_STORAGE_KEY = 'worksphere:ambient_presets:v1';
export function clampGain(value: number): number { if (typeof value !== 'number' || !Number.isFinite(value)) return 0; return Math.min(1, Math.max(0, Math.round(value * 1000) / 1000)); }
export function createNoiseSampleBuffer(sampleRate: number, durationSeconds: number, layer: NoiseLayerType, seed = 42): Float32Array {
  const safeRate = typeof sampleRate === 'number' && Number.isFinite(sampleRate) && sampleRate > 0 ? Math.floor(sampleRate) : 44_100;
  const safeDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 2;
  const length = Math.max(1, Math.floor(safeRate * safeDuration)); const output = new Float32Array(length);
  let state = (seed >>> 0) || 1;
  const nextRand = (): number => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, brownOut = 0;
  for (let i = 0; i < length; i += 1) {
    const white = nextRand() * 2 - 1;
    if (layer === 'white') output[i] = white * 0.5;
    else if (layer === 'pink') { b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852; b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898; output[i] = Math.max(-1, Math.min(1, (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11)); b6 = white * 0.115926; }
    else { brownOut = (brownOut + 0.04 * white) / 1.04; const dropletGate = nextRand() > 0.9965 ? (nextRand() * 2 - 1) * 0.35 : 0; output[i] = Math.max(-1, Math.min(1, brownOut * 2.4 + dropletGate)); }
  }
  return output;
}
export function loadSoundscapePresets(storage?: StorageLike | null, storageKey = PRESET_STORAGE_KEY): SoundscapePreset[] {
  const s = storage !== undefined ? storage : typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  if (!s) return [DEFAULT_SOUNDSCAPE_PRESET];
  try { const raw = s.getItem(storageKey); if (!raw) return [DEFAULT_SOUNDSCAPE_PRESET]; const parsed = JSON.parse(raw); if (!Array.isArray(parsed) || !parsed.length) return [DEFAULT_SOUNDSCAPE_PRESET]; return parsed.filter((i): i is SoundscapePreset => Boolean(i?.id && i?.name)).map((i) => ({ id: String(i.id), name: String(i.name), masterGain: clampGain(i.masterGain ?? 0.6), layers: { white: clampGain(i.layers?.white ?? 0), pink: clampGain(i.layers?.pink ?? 0), rain: clampGain(i.layers?.rain ?? 0) } })); } catch { return [DEFAULT_SOUNDSCAPE_PRESET]; }
}
export function saveSoundscapePresets(presets: readonly SoundscapePreset[], storage?: StorageLike | null, storageKey = PRESET_STORAGE_KEY): boolean {
  const s = storage !== undefined ? storage : typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  if (!s) return false;
  try { s.setItem(storageKey, JSON.stringify(presets)); return true; } catch { return false; }
}
export interface AudioGainParamLike { value: number; setTargetAtTime?: (target: number, startTime: number, timeConstant: number) => void; linearRampToValueAtTime?: (value: number, endTime: number) => void; }
export interface AudioContextLike { currentTime?: number; sampleRate?: number; suspend?: () => Promise<void> | void; resume?: () => Promise<void> | void; close?: () => Promise<void> | void; createGain?: () => { gain: AudioGainParamLike; connect: (dest: unknown) => void; }; }
export function rampGainSmoothly(param: AudioGainParamLike | undefined, targetGain: number, currentTime = 0, rampSeconds = 0.08): number {
  const safeTarget = clampGain(targetGain); if (!param) return safeTarget;
  const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0; const safeRamp = typeof rampSeconds === 'number' && Number.isFinite(rampSeconds) && rampSeconds > 0 ? rampSeconds : 0.05;
  if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(safeTarget, safeTime, safeRamp / 3);
  else if (typeof param.linearRampToValueAtTime === 'function') param.linearRampToValueAtTime(safeTarget, safeTime + safeRamp);
  else param.value = safeTarget;
  return safeTarget;
}
export class NoiseSynthesizer {
  private readonly ctx: AudioContextLike | null; private readonly workerFactory: WorkerFactory | null; private readonly sampleRate: number; private readonly durationSeconds: number;
  private worker: WorkerLike | null = null; private usedMainThreadFallback = false; private isPlaying = false; private isMuted = false; private isTabHidden = false; private masterGainValue = DEFAULT_SOUNDSCAPE_PRESET.masterGain;
  private layerGains: Record<NoiseLayerType, number> = { ...DEFAULT_SOUNDSCAPE_PRESET.layers };
  private buffers: Record<NoiseLayerType, Float32Array | null> = { white: null, pink: null, rain: null };
  constructor(options: { ctx?: AudioContextLike | null; workerFactory?: WorkerFactory | null; sampleRate?: number; durationSeconds?: number } = {}) {
    this.ctx = options.ctx ?? null; this.workerFactory = options.workerFactory ?? null; this.sampleRate = options.sampleRate ?? this.ctx?.sampleRate ?? 44_100; this.durationSeconds = options.durationSeconds ?? 1;
  }
  private generateBuffersSynchronously(): void { this.buffers = { white: createNoiseSampleBuffer(this.sampleRate, this.durationSeconds, 'white', 101), pink: createNoiseSampleBuffer(this.sampleRate, this.durationSeconds, 'pink', 202), rain: createNoiseSampleBuffer(this.sampleRate, this.durationSeconds, 'rain', 303) }; }
  private initWorkerOrFallback(): void {
    if (!this.workerFactory) { this.usedMainThreadFallback = true; this.generateBuffersSynchronously(); return; }
    try { const w = this.workerFactory(); if (!w || typeof w.postMessage !== 'function') throw new Error('Invalid worker'); this.worker = w; this.usedMainThreadFallback = false; this.worker.postMessage({ type: 'generate', sampleRate: this.sampleRate, durationSeconds: this.durationSeconds, layers: ['white', 'pink', 'rain'] }); }
    catch { this.worker = null; this.usedMainThreadFallback = true; this.generateBuffersSynchronously(); }
  }
  public async start(): Promise<boolean> { if (this.isTabHidden) { this.isPlaying = false; return false; } this.initWorkerOrFallback(); if (this.ctx?.resume) await this.ctx.resume(); this.isPlaying = true; return true; }
  public async pause(): Promise<void> { this.isPlaying = false; if (this.ctx?.suspend) await this.ctx.suspend(); }
  public async setMuted(muted: boolean): Promise<void> { this.isMuted = Boolean(muted); if (this.isMuted && this.isPlaying) await this.pause(); }
  public async handleVisibilityChange(hidden: boolean): Promise<void> { this.isTabHidden = Boolean(hidden); if (this.isTabHidden && this.isPlaying) await this.pause(); }
  public setLayerGain(layer: NoiseLayerType, gain: number, rampSeconds = 0.08): number { const clamped = clampGain(gain); this.layerGains[layer] = clamped; if (this.ctx?.createGain) { const g = this.ctx.createGain(); rampGainSmoothly(g.gain, clamped * this.masterGainValue, this.ctx.currentTime ?? 0, rampSeconds); } return clamped; }
  public getState() { return { isPlaying: this.isPlaying, isMuted: this.isMuted, isTabHidden: this.isTabHidden, usedMainThreadFallback: this.usedMainThreadFallback, masterGain: this.masterGainValue, layers: { ...this.layerGains }, hasGeneratedBuffers: Boolean(this.buffers.white && this.buffers.pink && this.buffers.rain) }; }
  public async dispose(): Promise<void> { this.isPlaying = false; if (this.worker) { try { this.worker.terminate(); } catch {} this.worker = null; } this.buffers = { white: null, pink: null, rain: null }; if (this.ctx?.close) await this.ctx.close(); }
}
export class NoiseSoundscapeEngine extends NoiseSynthesizer { constructor(ctx: AudioContextLike | null = null) { super({ ctx }); } }
