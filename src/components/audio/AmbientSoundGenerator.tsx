/**
 * @fileoverview Ambient Sound Generator & Acoustic Notch Filter Component.
 *
 * ## Acoustic Notch Filter Calibration & Q-Factor Defaults
 *
 * 1. **Standard Acoustic Notch Center Frequencies (`DEFAULT_NOTCH_FREQUENCIES_HZ`):**
 *    - `50 Hz` / `60 Hz`: Fundamental AC power-line mains hum (IN/EU vs US grids).
 *    - `100 Hz` / `120 Hz`: Full-wave rectifier / transformer second-harmonic hum (`2 * f_mains`).
 *    - `240 Hz`: Low-frequency HVAC duct drone without hollowing male vocal fundamentals (85-180 Hz).
 *    - `1000 Hz`: Surgical notch for monitor/charger electronic coil whine.
 *
 * 2. **Quality Factor ($Q$) Defaults & Bandwidth Formula:**
 *    - Bandwidth at -3 dB: $\Delta f = f_0 / Q$.
 *    - `DEFAULT_NOTCH_Q = 12`: Narrow stopband for tonal mains/harmonic hum.
 *    - `WIDE_HVAC_NOTCH_Q = 6`: Wider stopband (40 Hz at 240 Hz) for drifting HVAC resonance.
 *    - `SURGICAL_COIL_NOTCH_Q = 24`: Ultra-narrow stopband (41.67 Hz at 1000 Hz) preserving speech clarity.
 *    - Clamped to `[MIN_NOTCH_Q = 0.5, MAX_NOTCH_Q = 30]` to prevent ringing or mid-band scooping.
 */
'use client';
import React, { useCallback, useMemo, useState } from 'react';
export type AmbientNotchPresetId = 'mains_50hz' | 'mains_60hz' | 'harmonic_100hz' | 'harmonic_120hz' | 'hvac_240hz' | 'coil_1000hz';
export interface AmbientNotchFilterSpec { id: AmbientNotchPresetId; label: string; frequencyHz: number; qFactor: number; bandwidthHz: number; }
/** Default quality factor ($Q = 12$) balancing surgical tonal hum removal with low phase ringing. */
export const DEFAULT_NOTCH_Q = 12;
/** Wider quality factor ($Q = 6$) for drifting HVAC mechanical resonances. */
export const WIDE_HVAC_NOTCH_Q = 6;
/** High-precision quality factor ($Q = 24$) for narrowband electronic coil whine. */
export const SURGICAL_COIL_NOTCH_Q = 24;
/** Minimum safe quality factor bound to avoid broad audible frequency scooping. */
export const MIN_NOTCH_Q = 0.5;
/** Maximum safe quality factor bound to prevent biquad filter ringing artifacts. */
export const MAX_NOTCH_Q = 30;
/** Default center notch frequencies (Hz) ordered from mains fundamental to high-frequency whine. */
export const DEFAULT_NOTCH_FREQUENCIES_HZ: Readonly<Record<AmbientNotchPresetId, number>> = { mains_50hz: 50, mains_60hz: 60, harmonic_100hz: 100, harmonic_120hz: 120, hvac_240hz: 240, coil_1000hz: 1000 };
/** Default calibrated notch filter presets combining center frequency $f_0$ and quality factor $Q$. */
export const AMBIENT_NOTCH_PRESETS: Readonly<Record<AmbientNotchPresetId, Omit<AmbientNotchFilterSpec, 'bandwidthHz'>>> = { mains_50hz: { id: 'mains_50hz', label: '50 Hz AC Mains Hum (IN/EU)', frequencyHz: DEFAULT_NOTCH_FREQUENCIES_HZ.mains_50hz, qFactor: DEFAULT_NOTCH_Q }, mains_60hz: { id: 'mains_60hz', label: '60 Hz AC Mains Hum (US)', frequencyHz: DEFAULT_NOTCH_FREQUENCIES_HZ.mains_60hz, qFactor: DEFAULT_NOTCH_Q }, harmonic_100hz: { id: 'harmonic_100hz', label: '100 Hz Transformer Harmonic', frequencyHz: DEFAULT_NOTCH_FREQUENCIES_HZ.harmonic_100hz, qFactor: DEFAULT_NOTCH_Q }, harmonic_120hz: { id: 'harmonic_120hz', label: '120 Hz Transformer Harmonic', frequencyHz: DEFAULT_NOTCH_FREQUENCIES_HZ.harmonic_120hz, qFactor: DEFAULT_NOTCH_Q }, hvac_240hz: { id: 'hvac_240hz', label: '240 Hz HVAC Duct Drone', frequencyHz: DEFAULT_NOTCH_FREQUENCIES_HZ.hvac_240hz, qFactor: WIDE_HVAC_NOTCH_Q }, coil_1000hz: { id: 'coil_1000hz', label: '1 kHz Electronic Coil Whine', frequencyHz: DEFAULT_NOTCH_FREQUENCIES_HZ.coil_1000hz, qFactor: SURGICAL_COIL_NOTCH_Q } };
/** Clamps a candidate quality factor $Q$ into `[MIN_NOTCH_Q, MAX_NOTCH_Q]`. */
export function clampNotchQFactor(rawQ: number): number { if (typeof rawQ !== 'number' || !Number.isFinite(rawQ)) return DEFAULT_NOTCH_Q; return Math.min(MAX_NOTCH_Q, Math.max(MIN_NOTCH_Q, rawQ)); }
/** Builds a complete `AmbientNotchFilterSpec` including derived -3 dB bandwidth $\Delta f = f_0 / Q$. */
export function buildNotchFilterSpec(presetId: AmbientNotchPresetId, overrideQ?: number): AmbientNotchFilterSpec { const preset = AMBIENT_NOTCH_PRESETS[presetId]; const qFactor = overrideQ !== undefined ? clampNotchQFactor(overrideQ) : preset.qFactor; return { ...preset, qFactor, bandwidthHz: Number((preset.frequencyHz / qFactor).toFixed(2)) }; }
export interface AmbientSoundGeneratorProps { defaultPreset?: AmbientNotchPresetId; initialQFactor?: number; }
/** Interactive ambient noise & acoustic notch filter control panel for coworking focus sessions. */
export const AmbientSoundGenerator: React.FC<AmbientSoundGeneratorProps> = ({ defaultPreset = 'mains_50hz', initialQFactor }) => { const [selectedPreset, setSelectedPreset] = useState<AmbientNotchPresetId>(defaultPreset); const [customQ, setCustomQ] = useState<number | undefined>(initialQFactor); const [isPlaying, setIsPlaying] = useState<boolean>(false); const activeSpec = useMemo(() => buildNotchFilterSpec(selectedPreset, customQ), [selectedPreset, customQ]); const handlePresetChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => { setSelectedPreset(event.target.value as AmbientNotchPresetId); setCustomQ(undefined); }, []); return (<section className='rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900'><div className='flex items-center justify-between gap-2'><h2 className='text-sm font-semibold text-slate-900 dark:text-slate-100'>Ambient Sound &amp; Acoustic Notch Filter</h2><button type='button' onClick={() => setIsPlaying((prev) => !prev)} className='rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white'>{isPlaying ? 'Stop' : 'Play'}</button></div><div className='mt-3'><label htmlFor='ambient-notch-preset' className='block text-xs font-medium text-slate-700 dark:text-slate-300'>Notch Filter Preset</label><select id='ambient-notch-preset' value={selectedPreset} onChange={handlePresetChange} className='mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-800'>{Object.values(AMBIENT_NOTCH_PRESETS).map((preset) => (<option key={preset.id} value={preset.id}>{preset.label}</option>))}</select></div><dl data-testid='notch-filter-telemetry' className='mt-3 grid grid-cols-3 gap-2 rounded bg-slate-50 p-2 text-xs dark:bg-slate-800/60'><div><dt className='text-slate-500'>Center (f0)</dt><dd className='font-semibold'>{activeSpec.frequencyHz} Hz</dd></div><div><dt className='text-slate-500'>Q-Factor</dt><dd className='font-semibold'>{activeSpec.qFactor}</dd></div><div><dt className='text-slate-500'>-3 dB Width</dt><dd className='font-semibold'>{activeSpec.bandwidthHz} Hz</dd></div></dl></section>); };
export default AmbientSoundGenerator;
