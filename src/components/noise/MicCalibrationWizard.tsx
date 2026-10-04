"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Sliders,
  CheckCircle,
  X,
  Volume2,
  VolumeX,
  RotateCcw,
  Smartphone,
  Laptop,
  Headphones,
  Radio,
  HelpCircle,
  Play,
  Square,
} from "lucide-react";
import {
  MicCalibrationProfile,
  getMicCalibration,
  saveMicCalibration,
  resetMicCalibration,
  DEVICE_PRESETS,
  rmsToCalibratedDb,
} from "@/lib/noise/calibration";

interface MicCalibrationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onCalibrationSaved?: (profile: MicCalibrationProfile) => void;
}

export function MicCalibrationWizard({
  isOpen,
  onClose,
  onCalibrationSaved,
}: MicCalibrationWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [profile, setProfile] =
    useState<MicCalibrationProfile>(getMicCalibration());
  const [isListening, setIsListening] = useState(false);
  const [liveRawDb, setLiveRawDb] = useState(40);
  const [liveCalibratedDb, setLiveCalibratedDb] = useState(40);
  const [_liveRms, setLiveRms] = useState(0.01);
  const [peakDb, setPeakDb] = useState(40);
  const [isSamplingNoiseFloor, setIsSamplingNoiseFloor] = useState(false);
  const [samplingCountdown, setSamplingCountdown] = useState(3);
  const [micError, setMicError] = useState<string | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sampledValuesRef = useRef<number[]>([]);

  const stopAudioStream = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsListening(false);
  }, []);

  // Load existing profile when opened
  useEffect(() => {
    if (isOpen) {
      setProfile(getMicCalibration());
      setStep(1);
      setMicError(null);
    } else {
      stopAudioStream();
    }
  }, [isOpen, stopAudioStream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioStream();
    };
  }, [stopAudioStream]);

  // Start microphone stream
  const startAudioStream = async () => {
    setMicError(null);
    try {
      stopAudioStream();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      streamRef.current = stream;

      const track = stream.getAudioTracks()[0];
      if (track && track.label && !profile.deviceName) {
        setProfile((prev) => ({ ...prev, deviceName: track.label }));
      }

      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsListening(true);

      const buffer = new Float32Array(analyser.fftSize);

      const processAudio = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getFloatTimeDomainData(buffer);

        // Calculate Root Mean Square (RMS)
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          sumSquares += buffer[i] * buffer[i];
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        setLiveRms(rms);

        // Uncalibrated raw dB (offset = 0, sensitivity = 1)
        const uncalibrated = rmsToCalibratedDb(rms, {
          offsetDb: 0,
          sensitivity: 1,
          profileType: "built_in",
          calibratedAt: "",
        });
        setLiveRawDb(uncalibrated);

        // Calibrated dB
        const calibrated = rmsToCalibratedDb(rms, profile);
        setLiveCalibratedDb(calibrated);
        setPeakDb((prev) => Math.max(prev, calibrated));

        if (isSamplingNoiseFloor) {
          sampledValuesRef.current.push(calibrated);
        }

        animationFrameRef.current = requestAnimationFrame(processAudio);
      };

      processAudio();
    } catch (err: unknown) {
      console.error("Microphone access error:", err);
      setMicError(
        err instanceof Error
          ? err.message
          : "Unable to access microphone. Please check browser permissions.",
      );
      setIsListening(false);
    }
  };

  // Sample ambient noise floor for 3 seconds
  const startNoiseFloorSampling = () => {
    if (!isListening) {
      startAudioStream();
    }
    sampledValuesRef.current = [];
    setIsSamplingNoiseFloor(true);
    setSamplingCountdown(3);

    const interval = setInterval(() => {
      setSamplingCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsSamplingNoiseFloor(false);

          if (sampledValuesRef.current.length > 0) {
            const avg =
              sampledValuesRef.current.reduce((a, b) => a + b, 0) /
              sampledValuesRef.current.length;
            const rounded = Math.round(avg * 10) / 10;
            setProfile((prevProf) => ({
              ...prevProf,
              baselineNoiseFloorDb: rounded,
            }));
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  // Apply device preset
  const handleSelectPreset = (type: MicCalibrationProfile["profileType"]) => {
    const preset = DEVICE_PRESETS[type];
    setProfile((prev) => ({
      ...prev,
      profileType: type,
      offsetDb: preset.defaultOffset,
    }));
  };

  // Quick calibration match (e.g. adjust offset so current live voice = target dB)
  const handleAlignToTarget = (targetDb: number) => {
    // Current calibrated = raw + offset => new offset = targetDb - raw
    const newOffset = Math.round((targetDb - liveRawDb) * 2) / 2;
    const clamped = Math.max(-30, Math.min(30, newOffset));
    setProfile((prev) => ({
      ...prev,
      offsetDb: clamped,
      profileType: "custom",
    }));
  };

  const handleSave = () => {
    const updated: MicCalibrationProfile = {
      ...profile,
      calibratedAt: new Date().toISOString(),
    };
    saveMicCalibration(updated);
    stopAudioStream();
    if (onCalibrationSaved) {
      onCalibrationSaved(updated);
    }
    onClose();
  };

  const handleReset = () => {
    const defaultProf = resetMicCalibration();
    setProfile(defaultProf);
  };

  const getMeterColor = (db: number) => {
    if (db < 50) return "bg-emerald-500";
    if (db < 70) return "bg-amber-500";
    return "bg-rose-500";
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="calibration-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-xl bg-white dark:bg-zinc-900 rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-6 sm:p-8 space-y-6 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <h2
                id="calibration-wizard-title"
                className="text-lg sm:text-xl font-black text-zinc-900 dark:text-zinc-50"
              >
                Microphone dB Calibration Wizard
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Calibrate acoustic gain offset for accurate ambient decibel
                reporting.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close calibration wizard"
            className="p-2 rounded-xl text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator Tabs */}
        <div className="grid grid-cols-4 gap-2 text-center text-xs font-bold uppercase tracking-wider shrink-0">
          {[
            { num: 1, label: "Device" },
            { num: 2, label: "Live Test" },
            { num: 3, label: "Fine Tune" },
            { num: 4, label: "Save" },
          ].map((s) => (
            <button
              key={s.num}
              type="button"
              onClick={() => setStep(s.num as 1 | 2 | 3 | 4)}
              className={`py-2 px-1 rounded-xl transition-all border ${
                step === s.num
                  ? "bg-blue-500 text-white border-blue-500 shadow-md shadow-blue-500/20"
                  : step > s.num
                    ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
                    : "bg-zinc-50 dark:bg-zinc-900 text-zinc-400 border-transparent"
              }`}
            >
              <span className="hidden sm:inline">Step {s.num}: </span>
              {s.label}
            </button>
          ))}
        </div>

        {/* Step Content Body (scrollable) */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-5">
          {/* STEP 1: DEVICE PROFILE SELECTION */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-2xl text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2.5">
                <HelpCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Different microphone preamps and device types have varying
                  hardware sensitivity. Choose the profile that best matches
                  your recording hardware.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    type: "built_in",
                    icon: Laptop,
                    ...DEVICE_PRESETS.built_in,
                  },
                  {
                    type: "smartphone",
                    icon: Smartphone,
                    ...DEVICE_PRESETS.smartphone,
                  },
                  {
                    type: "headset",
                    icon: Headphones,
                    ...DEVICE_PRESETS.headset,
                  },
                  {
                    type: "studio_mic",
                    icon: Radio,
                    ...DEVICE_PRESETS.studio_mic,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  const isSelected = profile.profileType === item.type;
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() =>
                        handleSelectPreset(
                          item.type as MicCalibrationProfile["profileType"],
                        )
                      }
                      className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                        isSelected
                          ? "bg-blue-500/10 border-blue-500 shadow-sm"
                          : "bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 font-bold text-sm text-zinc-900 dark:text-zinc-100">
                          <Icon
                            className={`w-4 h-4 ${isSelected ? "text-blue-500" : "text-zinc-500"}`}
                          />
                          <span>{item.label}</span>
                        </div>
                        {isSelected && (
                          <CheckCircle className="w-4 h-4 text-blue-500" />
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        {item.description}
                      </p>
                      <div className="mt-3 text-[11px] font-mono text-zinc-400">
                        Default Offset:{" "}
                        <span className="font-bold text-zinc-700 dark:text-zinc-300">
                          {item.defaultOffset >= 0
                            ? `+${item.defaultOffset}`
                            : item.defaultOffset}{" "}
                          dB
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: LIVE MICROPHONE TEST */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    Live Acoustic Meter
                  </h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Test your microphone input in real-time.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={isListening ? stopAudioStream : startAudioStream}
                  className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${
                    isListening
                      ? "bg-rose-500 hover:bg-rose-600 text-white"
                      : "bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20"
                  }`}
                >
                  {isListening ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>Stop Mic</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Start Mic Test</span>
                    </>
                  )}
                </button>
              </div>

              {micError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-500 flex items-center gap-2">
                  <VolumeX className="w-4 h-4 shrink-0" />
                  <span>{micError}</span>
                </div>
              )}

              {/* Large Decibel Gauge */}
              <div className="p-6 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex flex-col items-center justify-center text-center space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl sm:text-5xl font-black tracking-tight text-zinc-900 dark:text-zinc-50 font-mono">
                    {isListening ? liveCalibratedDb.toFixed(1) : "--"}
                  </span>
                  <span className="text-base font-bold text-zinc-500">
                    dB SPL
                  </span>
                </div>

                {/* Level Meter Progress Bar */}
                <div className="w-full max-w-sm h-4 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden p-0.5 relative">
                  <div
                    className={`h-full rounded-full transition-all duration-75 ${getMeterColor(liveCalibratedDb)}`}
                    style={{
                      width: isListening
                        ? `${Math.min(100, Math.max(0, ((liveCalibratedDb - 20) / 80) * 100))}%`
                        : "0%",
                    }}
                  />
                </div>

                {/* Gauge Markers */}
                <div className="w-full max-w-sm flex justify-between text-[10px] text-zinc-400 font-mono">
                  <span>20 dB (Whisper)</span>
                  <span>60 dB (Normal)</span>
                  <span>100 dB (Loud)</span>
                </div>

                <div className="grid grid-cols-2 gap-4 w-full pt-3 border-t border-zinc-200 dark:border-zinc-700/60 text-xs">
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Raw Input:
                    </span>{" "}
                    <span className="font-mono font-bold text-zinc-700 dark:text-zinc-200">
                      {liveRawDb.toFixed(1)} dB
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      Peak Observed:
                    </span>{" "}
                    <span className="font-mono font-bold text-zinc-700 dark:text-zinc-200">
                      {peakDb.toFixed(1)} dB
                    </span>
                  </div>
                </div>
              </div>

              {/* Sample Noise Floor baseline */}
              <div className="flex items-center justify-between p-4 bg-zinc-50 dark:bg-zinc-800/30 rounded-2xl border border-zinc-200 dark:border-zinc-800">
                <div>
                  <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
                    Ambient Noise Floor
                  </h4>
                  <p className="text-[11px] text-zinc-500">
                    {profile.baselineNoiseFloorDb
                      ? `Calibrated Baseline: ${profile.baselineNoiseFloorDb} dB`
                      : "Measure 3s of silence in your current room."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={startNoiseFloorSampling}
                  disabled={isSamplingNoiseFloor}
                  className="px-3 py-1.5 rounded-xl bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-xs font-bold transition-all disabled:opacity-50"
                >
                  {isSamplingNoiseFloor
                    ? `Sampling (${samplingCountdown}s)...`
                    : "Sample Silence"}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: FINE TUNE OFFSET */}
          {step === 3 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  Acoustic Offset & Sensitivity
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Manually adjust the gain offset or match against an expected
                  sound level.
                </p>
              </div>

              {/* Live Preview Pill */}
              <div className="flex items-center justify-between p-3.5 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-xs">
                <span className="font-bold text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4" />
                  <span>Current Calibrated Reading:</span>
                </span>
                <span className="font-mono font-black text-sm text-blue-700 dark:text-blue-300">
                  {isListening
                    ? `${liveCalibratedDb.toFixed(1)} dB`
                    : `${(45 + profile.offsetDb).toFixed(1)} dB (test)`}
                </span>
              </div>

              {/* Offset Slider */}
              <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-3">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    Decibel Offset (dB)
                  </span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">
                    {profile.offsetDb > 0
                      ? `+${profile.offsetDb}`
                      : profile.offsetDb}{" "}
                    dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-30}
                  max={30}
                  step={0.5}
                  value={profile.offsetDb}
                  onChange={(e) =>
                    setProfile((prev) => ({
                      ...prev,
                      offsetDb: parseFloat(e.target.value),
                      profileType: "custom",
                    }))
                  }
                  className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                  <span>-30 dB</span>
                  <span>0 dB (Default)</span>
                  <span>+30 dB</span>
                </div>
              </div>

              {/* Quick Target Presets */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">
                  Quick Align to Reference
                </label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => handleAlignToTarget(35)}
                    className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium text-center transition-colors"
                  >
                    <div className="font-bold text-emerald-600 dark:text-emerald-400">
                      Quiet ~35 dB
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      Whisper / Silent
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlignToTarget(60)}
                    className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium text-center transition-colors"
                  >
                    <div className="font-bold text-amber-600 dark:text-amber-400">
                      Voice ~60 dB
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      Conversation
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAlignToTarget(68)}
                    className="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium text-center transition-colors"
                  >
                    <div className="font-bold text-rose-600 dark:text-rose-400">
                      Cafe ~68 dB
                    </div>
                    <div className="text-[10px] text-zinc-400">
                      Busy Ambience
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: SUMMARY & SAVE */}
          {step === 4 && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                    Calibration Ready
                  </h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-0.5">
                    Your calibration profile is configured and ready to be
                    applied across all noise monitoring widgets.
                  </p>
                </div>
              </div>

              <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-2xl border border-zinc-200 dark:border-zinc-800 space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-zinc-200/50 dark:border-zinc-700/50">
                  <span className="text-zinc-500">Hardware Profile:</span>
                  <span className="font-bold text-zinc-800 dark:text-zinc-200">
                    {DEVICE_PRESETS[profile.profileType]?.label ||
                      profile.profileType}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-zinc-200/50 dark:border-zinc-700/50">
                  <span className="text-zinc-500">Applied Decibel Offset:</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                    {profile.offsetDb >= 0
                      ? `+${profile.offsetDb}`
                      : profile.offsetDb}{" "}
                    dB
                  </span>
                </div>
                {profile.baselineNoiseFloorDb && (
                  <div className="flex justify-between py-1 border-b border-zinc-200/50 dark:border-zinc-700/50">
                    <span className="text-zinc-500">Baseline Noise Floor:</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                      {profile.baselineNoiseFloorDb} dB
                    </span>
                  </div>
                )}
                {profile.deviceName && (
                  <div className="flex justify-between py-1">
                    <span className="text-zinc-500">Input Device:</span>
                    <span className="font-medium text-zinc-700 dark:text-zinc-300 truncate max-w-[200px]">
                      {profile.deviceName}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0">
          <div>
            {step > 1 ? (
              <button
                type="button"
                onClick={() => setStep((prev) => (prev - 1) as 1 | 2 | 3 | 4)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition-colors"
              >
                Back
              </button>
            ) : (
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Defaults</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step < 4 ? (
              <button
                type="button"
                onClick={() => {
                  if (step === 1 && !isListening) {
                    startAudioStream();
                  }
                  setStep((prev) => (prev + 1) as 1 | 2 | 3 | 4);
                }}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-500/20 transition-all active:scale-95"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Save Calibration</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
