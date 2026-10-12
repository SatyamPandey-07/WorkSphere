"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { Volume2, Mic, Square, Radio, Sliders, Sparkles } from "lucide-react";
import {
  analyzeFrequencyBands,
  getFrequencyProfile,
  type FrequencyBandSpectrum,
} from "@/lib/noise/spectrumAnalyzer";
import { normalizeFrequencyGain } from "@/lib/noise/calibration";

export interface AmbientNoiseSpectrumVisualizerProps {
  venueId?: string;
  venueName?: string;
  noiseLevel?: string | null; // "quiet" | "moderate" | "loud" | etc.
  decibelBaseline?: number | null;
  className?: string;
  initialViewMode?: "waterfall" | "bars" | "both";
  initialColormap?: "turbo" | "viridis";
}

// 24 standard 1/3 octave frequency bands (Hz)
export const FREQUENCY_LABELS = [
  "32",
  "40",
  "50",
  "63",
  "80",
  "100",
  "125",
  "160",
  "200",
  "250",
  "315",
  "400",
  "500",
  "630",
  "800",
  "1k",
  "1.2k",
  "1.6k",
  "2k",
  "2.5k",
  "3.1k",
  "4k",
  "8k",
  "16k",
];

// WebGL Spectrogram configuration
const FFT_BINS = 128;
const WATERFALL_HISTORY = 128;

const VERTEX_SHADER_SRC = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_position * 0.5 + 0.5;
}
`;

const FRAGMENT_SHADER_SRC = `
precision mediump float;
varying vec2 v_texCoord;
uniform sampler2D u_texture;
uniform float u_offsetY;
uniform int u_colormap;

vec3 turbo(float x) {
  const vec4 kRedVec4 = vec4(0.13572138, 4.61539260, -42.66032258, 132.13108234);
  const vec4 kGreenVec4 = vec4(0.09140261, 2.19418839, 4.84296658, -14.18503333);
  const vec4 kBlueVec4 = vec4(0.10667330, 12.64194608, -60.58204836, 110.36276771);
  const vec2 kRedVec2 = vec2(-152.94239396, 59.28637943);
  const vec2 kGreenVec2 = vec2(4.27729857, 2.82956604);
  const vec2 kBlueVec2 = vec2(-89.90310912, 27.34824973);

  x = clamp(x, 0.0, 1.0);
  vec4 v4 = vec4(1.0, x, x * x, x * x * x);
  vec2 v2 = v4.zw * v4.z;

  return clamp(vec3(
    dot(v4, kRedVec4) + dot(v2, kRedVec2),
    dot(v4, kGreenVec4) + dot(v2, kGreenVec2),
    dot(v4, kBlueVec4) + dot(v2, kBlueVec2)
  ), 0.0, 1.0);
}

vec3 viridis(float t) {
  t = clamp(t, 0.0, 1.0);
  const vec3 c0 = vec3(0.2777273, 0.0054073, 0.3340998);
  const vec3 c1 = vec3(0.1050194, 1.4046135, 1.3845902);
  const vec3 c2 = vec3(-0.3308618, 0.2148783, 0.0950952);
  const vec3 c3 = vec3(-4.6342305, -5.7991010, -19.3324410);
  const vec3 c4 = vec3(6.2282699, 14.1799334, 56.6905526);
  const vec3 c5 = vec3(4.7763850, -13.7451454, -65.3530326);
  const vec3 c6 = vec3(-5.4354559, 4.6458526, 26.3124352);

  return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), 0.0, 1.0);
}

void main() {
  // Newest audio data at top (y = 1.0), scrolling downward over time towards bottom (y = 0.0)
  float sampleY = fract(u_offsetY - (1.0 - v_texCoord.y) + 1.0);
  float magnitude = texture2D(u_texture, vec2(v_texCoord.x, sampleY)).r;

  vec3 rgb;
  if (u_colormap == 1) {
    rgb = viridis(magnitude);
  } else {
    rgb = turbo(magnitude);
  }

  gl_FragColor = vec4(rgb, 1.0);
}
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function synthesizeSimulatedFftBins(baseDb: number): Uint8Array {
  const bytes = new Uint8Array(FFT_BINS);
  const isLoud = baseDb > 70;
  const isQuiet = baseDb < 50;

  for (let i = 0; i < FFT_BINS; i++) {
    let weight = 1.0;
    if (i < 16) {
      weight = isLoud ? 1.3 : 0.85; // Low-frequency HVAC hum
    } else if (i >= 16 && i <= 64) {
      weight = isQuiet ? 0.6 : 1.4; // Speech & chatter
    } else {
      weight = 0.5; // High hiss / clatter
    }

    const baseVal = (baseDb / 100) * 190;
    const jitter = (Math.random() - 0.5) * 35;
    const val = Math.min(
      255,
      Math.max(10, Math.round(baseVal * weight + jitter)),
    );
    bytes[i] = val;
  }
  return bytes;
}

export function AmbientNoiseSpectrumVisualizer({
  venueName = "Venue",
  noiseLevel = "moderate",
  decibelBaseline,
  className = "",
  initialViewMode = "waterfall",
  initialColormap = "turbo",
}: AmbientNoiseSpectrumVisualizerProps) {
  const [isLiveMic, setIsLiveMic] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"waterfall" | "bars" | "both">(
    initialViewMode,
  );
  const [colormap, setColormap] = useState<"turbo" | "viridis">(
    initialColormap,
  );

  const [bars, setBars] = useState<number[]>(() => new Array(24).fill(15));
  const [peaks, setPeaks] = useState<number[]>(() => new Array(24).fill(18));
  const [currentDb, setCurrentDb] = useState<number>(() => {
    if (typeof decibelBaseline === "number") return decibelBaseline;
    if (noiseLevel === "quiet") return 42;
    if (noiseLevel === "loud") return 74;
    return 56;
  });

  const [frequencySpectrum, setFrequencySpectrum] =
    useState<FrequencyBandSpectrum | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const simWaterfallRafRef = useRef<number | null>(null);

  // WebGL Waterfall Spectrogram Canvas & Context
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const glContextRef = useRef<{
    gl: WebGLRenderingContext;
    program: WebGLProgram;
    texture: WebGLTexture;
    posBuffer: WebGLBuffer;
    vertShader: WebGLShader;
    fragShader: WebGLShader;
    offsetYLoc: WebGLUniformLocation | null;
    colormapLoc: WebGLUniformLocation | null;
    currentRow: number;
  } | null>(null);

  // Derive target average dB from venue noise level
  const targetAvgDb = useMemo(() => {
    if (typeof decibelBaseline === "number") return decibelBaseline;
    const clean = (noiseLevel || "moderate").toLowerCase();
    if (clean.includes("quiet") || clean.includes("silent")) return 42;
    if (clean.includes("loud") || clean.includes("noisy")) return 76;
    return 58;
  }, [noiseLevel, decibelBaseline]);

  // Clean up WebAudio on unmount or toggle
  const stopLiveMic = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsLiveMic(false);
    setMicError(null);
  }, []);

  // WebGL initialization
  const initWaterfallWebGL = useCallback((canvas: HTMLCanvasElement) => {
    let gl: WebGLRenderingContext | null = null;
    try {
      gl =
        (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
        (canvas.getContext(
          "experimental-webgl",
        ) as WebGLRenderingContext | null);
    } catch {
      return null;
    }

    if (!gl) return null;

    const vertShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SRC);
    const fragShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SRC,
    );
    if (!vertShader || !fragShader) return null;

    const program = gl.createProgram();
    if (!program) return null;

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    gl.useProgram(program);

    const posBuffer = gl.createBuffer();
    if (!posBuffer) return null;

    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    const vertices = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const aPosLoc = gl.getAttribLocation(program, "a_position");
    if (aPosLoc !== -1) {
      gl.enableVertexAttribArray(aPosLoc);
      gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);
    }

    // Dynamic 2D Texture backing
    const texture = gl.createTexture();
    if (!texture) return null;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const initialData = new Uint8Array(FFT_BINS * WATERFALL_HISTORY);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.LUMINANCE,
      FFT_BINS,
      WATERFALL_HISTORY,
      0,
      gl.LUMINANCE,
      gl.UNSIGNED_BYTE,
      initialData,
    );

    const offsetYLoc = gl.getUniformLocation(program, "u_offsetY");
    const colormapLoc = gl.getUniformLocation(program, "u_colormap");
    const textureLoc = gl.getUniformLocation(program, "u_texture");

    if (textureLoc) {
      gl.uniform1i(textureLoc, 0);
    }

    gl.viewport(0, 0, canvas.width, canvas.height);

    return {
      gl,
      program,
      texture,
      posBuffer,
      vertShader,
      fragShader,
      offsetYLoc,
      colormapLoc,
      currentRow: 0,
    };
  }, []);

  // Push 1 frame of FFT frequency byte data into WebGL dynamic texture backing
  const pushWaterfallRow = useCallback(
    (byteData: Uint8Array) => {
      const glState = glContextRef.current;
      if (!glState) return;

      const { gl, program, texture, offsetYLoc, colormapLoc } = glState;
      let { currentRow } = glState;

      let rowBuffer: Uint8Array;
      if (byteData.length === FFT_BINS) {
        rowBuffer = byteData;
      } else {
        rowBuffer = new Uint8Array(FFT_BINS);
        const step = byteData.length / FFT_BINS;
        for (let i = 0; i < FFT_BINS; i++) {
          rowBuffer[i] =
            byteData[Math.min(Math.floor(i * step), byteData.length - 1)];
        }
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        currentRow,
        FFT_BINS,
        1,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        rowBuffer,
      );

      currentRow = (currentRow + 1) % WATERFALL_HISTORY;
      glState.currentRow = currentRow;

      gl.useProgram(program);
      if (offsetYLoc) {
        gl.uniform1f(offsetYLoc, currentRow / WATERFALL_HISTORY);
      }
      if (colormapLoc) {
        gl.uniform1i(colormapLoc, colormap === "viridis" ? 1 : 0);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    [colormap],
  );

  // Initialize or re-attach WebGL when canvas is mounted or viewMode changes
  useEffect(() => {
    if (!waterfallCanvasRef.current) return;
    const glState = initWaterfallWebGL(waterfallCanvasRef.current);
    glContextRef.current = glState;

    return () => {
      if (glState) {
        const { gl, texture, program, vertShader, fragShader, posBuffer } =
          glState;
        try {
          gl.deleteTexture(texture);
          gl.deleteProgram(program);
          gl.deleteShader(vertShader);
          gl.deleteShader(fragShader);
          gl.deleteBuffer(posBuffer);
        } catch {
          // ignore context cleanup errors
        }
        glContextRef.current = null;
      }
    };
  }, [initWaterfallWebGL, viewMode]);

  // Start live microphone WebAudio FFT analyzer
  const startLiveMic = useCallback(async () => {
    try {
      setMicError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      mediaStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (!AudioCtx) {
        throw new Error("Web Audio API is not supported on this browser.");
      }

      const audioCtx = new AudioCtx();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsLiveMic(true);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const renderLiveFrame = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        // Push 60fps FFT byte data to WebGL dynamic texture backing
        pushWaterfallRow(dataArray);

        // Group into 24 standard 1/3 octave bands
        const step = Math.max(1, Math.floor(bufferLength / 24));
        const newBars: number[] = [];
        let totalEnergy = 0;

        for (let i = 0; i < 24; i++) {
          const startIdx = i * step;
          let sum = 0;
          for (let j = 0; j < step && startIdx + j < bufferLength; j++) {
            sum += dataArray[startIdx + j];
          }
          const avgByte = sum / step;
          const normalizedPct = normalizeFrequencyGain(
            Math.round((avgByte / 255) * 100),
          );
          newBars.push(normalizedPct);
          totalEnergy += avgByte;
        }

        const avgByteAll = totalEnergy / 24;
        const liveDbEst = Math.round(30 + (avgByteAll / 255) * 65);
        setCurrentDb(liveDbEst);

        setBars(newBars);
        setPeaks((prev) =>
          prev.map((p, idx) => Math.max(p * 0.95, newBars[idx] || 0)),
        );

        // Frequency band spectrum breakdown
        const spec = analyzeFrequencyBands(
          dataArray,
          audioCtx.sampleRate,
          analyser.fftSize,
        );
        setFrequencySpectrum(spec);

        animFrameRef.current = requestAnimationFrame(renderLiveFrame);
      };

      animFrameRef.current = requestAnimationFrame(renderLiveFrame);
    } catch (err: unknown) {
      console.warn("[AmbientNoiseSpectrumVisualizer] Mic access denied:", err);
      setMicError("Microphone access unavailable. Using telemetry simulation.");
      setIsLiveMic(false);
    }
  }, [pushWaterfallRow]);

  // Continuous simulated ambient acoustic telemetry & waterfall loop when microphone is inactive
  useEffect(() => {
    if (isLiveMic) return;

    const baseDb = targetAvgDb;
    const isQuiet = baseDb < 50;
    const isLoud = baseDb > 70;

    // 60fps WebGL waterfall simulated ticker
    let lastSimTick = performance.now();
    const renderSimulatedWaterfallFrame = (now: number) => {
      if (now - lastSimTick >= 16.6) {
        lastSimTick = now;
        const simBytes = synthesizeSimulatedFftBins(baseDb);
        pushWaterfallRow(simBytes);
      }
      simWaterfallRafRef.current = requestAnimationFrame(
        renderSimulatedWaterfallFrame,
      );
    };
    simWaterfallRafRef.current = requestAnimationFrame(
      renderSimulatedWaterfallFrame,
    );

    // 24-band bar chart telemetry generation (4Hz update)
    const generateSimulatedSpectrum = () => {
      const newBars: number[] = [];
      const baseHeight = (baseDb / 100) * 80;

      for (let i = 0; i < 24; i++) {
        let bandWeight = 1.0;
        if (i < 4) bandWeight = isLoud ? 1.2 : 0.9;
        else if (i >= 4 && i <= 14) bandWeight = isQuiet ? 0.7 : 1.35;
        else bandWeight = 0.55;

        const jitter = (Math.random() - 0.5) * 16;
        const val = Math.min(
          95,
          Math.max(8, Math.round(baseHeight * bandWeight + jitter)),
        );
        newBars.push(val);
      }

      setBars(newBars);
      setPeaks((prev) =>
        prev.map((p, idx) => Math.max(p * 0.92, newBars[idx] || 0)),
      );

      const lowEnergy = newBars.slice(0, 6).reduce((a, b) => a + b, 0);
      const midEnergy = newBars.slice(6, 18).reduce((a, b) => a + b, 0);
      const highEnergy = newBars.slice(18).reduce((a, b) => a + b, 0);
      const sum = lowEnergy + midEnergy + highEnergy || 1;

      const lowPercentage = Math.round((lowEnergy / sum) * 100);
      const midPercentage = Math.round((midEnergy / sum) * 100);
      const highPercentage = 100 - lowPercentage - midPercentage;

      const profile = getFrequencyProfile(
        lowPercentage,
        midPercentage,
        highPercentage,
      );
      setFrequencySpectrum({
        lowEnergy,
        midEnergy,
        highEnergy,
        lowPercentage,
        midPercentage,
        highPercentage,
        dominantBand: profile.dominantBand,
        profileTag: profile.tag,
        description: profile.description,
        badgeColor: profile.badgeColor,
      });

      const subtleDbJitter = Math.round(baseDb + (Math.random() - 0.5) * 4);
      setCurrentDb(subtleDbJitter);
    };

    generateSimulatedSpectrum();
    simIntervalRef.current = setInterval(generateSimulatedSpectrum, 250);

    return () => {
      if (simWaterfallRafRef.current) {
        cancelAnimationFrame(simWaterfallRafRef.current);
      }
      if (simIntervalRef.current) {
        clearInterval(simIntervalRef.current);
      }
    };
  }, [isLiveMic, targetAvgDb, pushWaterfallRow]);

  useEffect(() => {
    return () => {
      stopLiveMic();
    };
  }, [stopLiveMic]);

  // Color generator for spectrum frequency bands (Violet -> Emerald -> Amber -> Cyan -> Rose)
  const getBarColor = (index: number) => {
    if (index < 6) return "from-purple-500 to-indigo-500 shadow-purple-500/20";
    if (index < 14) return "from-emerald-400 to-teal-500 shadow-teal-500/20";
    if (index < 19) return "from-amber-400 to-orange-500 shadow-amber-500/20";
    return "from-cyan-400 to-rose-500 shadow-rose-500/20";
  };

  const getNoiseStatusLabel = (db: number) => {
    if (db < 45)
      return {
        label: "Deep Focus (Quiet)",
        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
      };
    if (db <= 62)
      return {
        label: "Gentle Ambience (Moderate)",
        color: "text-teal-400 bg-teal-500/10 border-teal-500/30",
      };
    if (db <= 74)
      return {
        label: "Lively Workspace (Active)",
        color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
      };
    return {
      label: "Energetic / High Energy (Loud)",
      color: "text-rose-400 bg-rose-500/10 border-rose-500/30",
    };
  };

  const status = getNoiseStatusLabel(currentDb);

  return (
    <div
      data-testid="ambient-noise-spectrum-visualizer"
      className={`p-5 bg-zinc-900/90 border border-zinc-800/80 rounded-2xl shadow-lg backdrop-blur-md transition-all ${className}`}
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-pink-500/10 border border-pink-500/20 text-pink-400">
            <Volume2 className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-bold text-sm sm:text-base text-white flex items-center gap-2">
              <span>Ambient Noise Spectrum · {venueName}</span>
              {isLiveMic ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                  Live Mic
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Radio className="w-3 h-3" />
                  Acoustic Telemetry
                </span>
              )}
            </h3>
            <p className="text-[11px] text-zinc-400">
              Real-time WebGL spectral waterfall spectrogram &amp; 24-band FFT
              decibel analysis
            </p>
          </div>
        </div>

        {/* Action Controls & Mode Switcher */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* View Mode Buttons */}
          <div className="inline-flex items-center bg-zinc-800/90 p-0.5 rounded-xl border border-zinc-700/80 text-xs">
            <button
              type="button"
              onClick={() => setViewMode("waterfall")}
              aria-label="View waterfall spectrogram"
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                viewMode === "waterfall"
                  ? "bg-blue-600 text-white shadow-xs font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Waterfall
            </button>
            <button
              type="button"
              onClick={() => setViewMode("bars")}
              aria-label="View 24-band bars"
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                viewMode === "bars"
                  ? "bg-blue-600 text-white shadow-xs font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Bars
            </button>
            <button
              type="button"
              onClick={() => setViewMode("both")}
              aria-label="View split visualizer"
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                viewMode === "both"
                  ? "bg-blue-600 text-white shadow-xs font-semibold"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Split
            </button>
          </div>

          {/* Colormap Toggle (only when waterfall is visible) */}
          {(viewMode === "waterfall" || viewMode === "both") && (
            <button
              type="button"
              onClick={() =>
                setColormap(colormap === "turbo" ? "viridis" : "turbo")
              }
              data-testid="toggle-colormap-btn"
              title="Toggle Heat Colormap (Turbo / Viridis)"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 text-xs font-mono transition-colors"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>{colormap === "turbo" ? "Turbo" : "Viridis"}</span>
            </button>
          )}

          {/* Live Mic Toggle Button */}
          <button
            type="button"
            onClick={isLiveMic ? stopLiveMic : startLiveMic}
            data-testid="toggle-live-mic-btn"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 ${
              isLiveMic
                ? "bg-rose-600 text-white border-rose-500 shadow-md shadow-rose-500/20"
                : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
            }`}
          >
            {isLiveMic ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Mic</span>
              </>
            ) : (
              <>
                <Mic className="w-3.5 h-3.5 text-blue-400" />
                <span>Test Live Mic</span>
              </>
            )}
          </button>
        </div>
      </div>

      {micError && (
        <div className="mb-3 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 font-medium">
          {micError}
        </div>
      )}

      {/* Decibel & Classification Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-black/40 border border-white/5 rounded-xl p-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-none">
            {currentDb}{" "}
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
              dBA
            </span>
          </div>
          <span
            className={`text-xs font-bold px-2.5 py-1 rounded-lg border ${status.color}`}
          >
            {status.label}
          </span>
        </div>

        {frequencySpectrum && (
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`font-semibold px-2 py-0.5 rounded-md border ${frequencySpectrum.badgeColor}`}
            >
              {frequencySpectrum.profileTag}
            </span>
          </div>
        )}
      </div>

      {/* 1. WebGL Spectral Waterfall Spectrogram */}
      {(viewMode === "waterfall" || viewMode === "both") && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5 px-0.5">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              Continuous Spectral Waterfall (WebGL 60fps)
            </span>
            <span className="text-[10px] font-mono text-zinc-500">
              {colormap === "turbo" ? "Turbo Colormap" : "Viridis Colormap"} ·
              Time ↓
            </span>
          </div>

          <div
            className="relative h-40 sm:h-48 w-full bg-black/70 border border-zinc-800/80 rounded-xl overflow-hidden shadow-inner"
            role="img"
            aria-label="Spectral Waterfall Spectrogram"
          >
            <canvas
              ref={waterfallCanvasRef}
              data-testid="spectral-waterfall-canvas"
              width={256}
              height={192}
              className="w-full h-full block object-cover"
            />

            {/* Acoustic Zone Markers Overlay */}
            <div className="absolute inset-x-0 bottom-0 py-1 px-2.5 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex justify-between items-center text-[9px] font-mono text-zinc-400 uppercase tracking-wider select-none pointer-events-none">
              <span>HVAC &amp; Rumble (32Hz)</span>
              <span>Speech Chatter (1kHz-3kHz)</span>
              <span>Clatter &amp; Hiss (16kHz)</span>
            </div>
          </div>

          {/* Colormap Magnitude Legend */}
          <div className="flex items-center justify-between gap-2 mt-2 px-1 text-[10px] font-mono text-zinc-500">
            <span>-90 dBA (Quiet)</span>
            <div
              className={`h-2 flex-1 mx-2 rounded-full border border-white/10 ${
                colormap === "viridis"
                  ? "bg-gradient-to-r from-[#440154] via-[#21918c] to-[#fde725]"
                  : "bg-gradient-to-r from-[#30123b] via-[#28bbec] via-[#a2fc3c] via-[#fb8022] to-[#7a0403]"
              }`}
            />
            <span>-10 dBA (Peak)</span>
          </div>
        </div>
      )}

      {/* 2. 24-Band Frequency Bars Visualizer Canvas / Grid */}
      {(viewMode === "bars" || viewMode === "both") && (
        <div>
          <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5 px-0.5">
            <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-indigo-400" />
              24-Band 1/3 Octave FFT Spectrum
            </span>
          </div>

          <div
            aria-label="Noise Frequency Spectrum Bars"
            role="img"
            className="relative h-32 sm:h-36 w-full bg-black/50 border border-zinc-800/80 rounded-xl p-3 flex items-end justify-between gap-1 overflow-hidden"
          >
            {/* Background Decibel Reference Grid Lines */}
            <div className="absolute inset-x-0 top-[25%] border-b border-white/5 pointer-events-none" />
            <div className="absolute inset-x-0 top-[50%] border-b border-white/5 pointer-events-none" />
            <div className="absolute inset-x-0 top-[75%] border-b border-white/5 pointer-events-none" />

            {bars.map((height, i) => {
              const clampedHeight = normalizeFrequencyGain(height);
              const peakHeight = normalizeFrequencyGain(peaks[i] || height);
              const bgGradient = getBarColor(i);

              return (
                <div
                  key={`freq-bar-${i}`}
                  className="relative flex-1 h-full flex items-end justify-center group"
                >
                  {/* Peak indicator tick */}
                  <div
                    className="absolute w-full h-1 bg-white/90 rounded-xs shadow-xs transition-all duration-150 pointer-events-none"
                    style={{ bottom: `${Math.min(98, peakHeight)}%` }}
                  />

                  {/* Dynamic Frequency Bar */}
                  <div
                    className={`w-full max-w-[12px] bg-gradient-to-t ${bgGradient} rounded-t-sm transition-all duration-100 ease-out`}
                    style={{ height: `${clampedHeight}%` }}
                  />
                </div>
              );
            })}
          </div>

          {/* Frequency Labels Scale */}
          <div className="flex justify-between items-center px-1 pt-2 text-[9px] font-mono text-zinc-500 uppercase tracking-tighter select-none">
            <span>32Hz</span>
            <span>125Hz</span>
            <span>500Hz</span>
            <span>2kHz</span>
            <span>8kHz</span>
            <span>16kHz</span>
          </div>
        </div>
      )}

      {/* 3. 3-Band Acoustic Distribution Summary */}
      {frequencySpectrum && (
        <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-zinc-800/80 text-center">
          <div className="p-2 bg-purple-500/5 border border-purple-500/15 rounded-xl">
            <span className="block text-[10px] font-bold text-purple-400 uppercase tracking-wider">
              Low (20-250Hz)
            </span>
            <span className="text-sm font-black text-white">
              {frequencySpectrum.lowPercentage}%
            </span>
            <span className="block text-[9px] text-zinc-400">
              Bass &amp; HVAC
            </span>
          </div>

          <div className="p-2 bg-teal-500/5 border border-teal-500/15 rounded-xl">
            <span className="block text-[10px] font-bold text-teal-400 uppercase tracking-wider">
              Mid (250-4kHz)
            </span>
            <span className="text-sm font-black text-white">
              {frequencySpectrum.midPercentage}%
            </span>
            <span className="block text-[9px] text-zinc-400">
              Speech &amp; Vocals
            </span>
          </div>

          <div className="p-2 bg-cyan-500/5 border border-cyan-500/15 rounded-xl">
            <span className="block text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
              High (4k-20kHz)
            </span>
            <span className="text-sm font-black text-white">
              {frequencySpectrum.highPercentage}%
            </span>
            <span className="block text-[9px] text-zinc-400">
              Clatter &amp; Hiss
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default AmbientNoiseSpectrumVisualizer;
