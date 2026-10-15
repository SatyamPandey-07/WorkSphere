"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";

export interface SpectralWaterfallCanvasProps {
  analyserNode?: AnalyserNode | null;
  fftData?: Uint8Array;
  width?: number;
  height?: number;
  speed?: number;
  gain?: number;
  showLabels?: boolean;
  className?: string;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export const VERTEX_SHADER_SOURCE = `
  attribute vec2 aPosition;
  attribute vec2 aTexCoord;
  varying vec2 vTexCoord;

  void main() {
    vTexCoord = aTexCoord;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

export const FRAGMENT_SHADER_SOURCE = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTexture;
  uniform float uGain;

  // Glowing cyan-to-emerald gradient fragment shader
  vec3 getSpectralColor(float val) {
    if (val < 0.01) {
      return vec3(0.02, 0.04, 0.08); // Deep ambient noise floor
    }
    
    vec3 c0 = vec3(0.01, 0.12, 0.22); // Low amplitude
    vec3 c1 = vec3(0.0, 0.85, 1.0);   // Glowing cyan (mid)
    vec3 c2 = vec3(0.0, 1.0, 0.53);   // Neon emerald (high)
    vec3 c3 = vec3(0.85, 1.0, 0.92);  // Overdrive white-emerald (peak)
    
    if (val < 0.35) {
      return mix(c0, c1, val / 0.35);
    } else if (val < 0.75) {
      return mix(c1, c2, (val - 0.35) / 0.4);
    } else {
      return mix(c2, c3, (val - 0.75) / 0.25);
    }
  }

  void main() {
    float amplitude = texture2D(uTexture, vTexCoord).r * uGain;
    amplitude = clamp(amplitude, 0.0, 1.0);
    vec3 color = getSpectralColor(amplitude);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[WebGL Waterfall] Shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createSpectralProgram(
  gl: WebGLRenderingContext,
  vsSource: string = VERTEX_SHADER_SOURCE,
  fsSource: string = FRAGMENT_SHADER_SOURCE,
): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn("[WebGL Waterfall] Program link failed:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

const WATERFALL_WIDTH = 256;
const WATERFALL_HEIGHT = 128;

export function SpectralWaterfallCanvas({
  analyserNode,
  fftData,
  width = 640,
  height = 240,
  speed = 1,
  gain = 1.0,
  showLabels = true,
  className = "",
  onContextLost,
  onContextRestored,
}: SpectralWaterfallCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameIdRef = useRef<number | null>(null);
  const isContextLostRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  // History buffer for waterfall scrolling: rows x columns
  const historyRef = useRef<Uint8Array>(
    new Uint8Array(WATERFALL_WIDTH * WATERFALL_HEIGHT),
  );

  const initWebGL = useCallback(
    (canvas: HTMLCanvasElement) => {
      const gl =
        canvas.getContext("webgl", { preserveDrawingBuffer: false, antialias: false }) ||
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

      if (!gl) {
        console.warn("[WebGL Waterfall] WebGL not supported");
        return null;
      }

      const program = createSpectralProgram(gl);
      if (!program) return null;

      gl.useProgram(program);

      // Fullscreen quad
      const quadVertices = new Float32Array([
        -1, -1, 0, 1,
         1, -1, 1, 1,
        -1,  1, 0, 0,
        -1,  1, 0, 0,
         1, -1, 1, 1,
         1,  1, 1, 0,
      ]);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

      const aPosition = gl.getAttribLocation(program, "aPosition");
      const aTexCoord = gl.getAttribLocation(program, "aTexCoord");

      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);

      gl.enableVertexAttribArray(aTexCoord);
      gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);

      // Setup 2D waterfall texture
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        WATERFALL_WIDTH,
        WATERFALL_HEIGHT,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        historyRef.current,
      );

      const uTexture = gl.getUniformLocation(program, "uTexture");
      const uGain = gl.getUniformLocation(program, "uGain");

      gl.uniform1i(uTexture, 0);
      gl.uniform1f(uGain, gain);

      return {
        gl,
        program,
        buffer,
        texture,
        uGain,
      };
    },
    [gain],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let webglResources = initWebGL(canvas);
    if (!webglResources) return;
    setIsReady(true);

    const handleLost = (e: Event) => {
      e.preventDefault();
      isContextLostRef.current = true;
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
        animFrameIdRef.current = null;
      }
      onContextLost?.();
    };

    const handleRestored = () => {
      isContextLostRef.current = false;
      webglResources = initWebGL(canvas);
      onContextRestored?.();
      renderLoop();
    };

    canvas.addEventListener("webglcontextlost", handleLost, false);
    canvas.addEventListener("webglcontextrestored", handleRestored, false);

    // Dynamic frequency buffer
    const freqBinBuffer = new Uint8Array(
      analyserNode ? analyserNode.frequencyBinCount : WATERFALL_WIDTH,
    );

    const renderLoop = () => {
      if (isContextLostRef.current || !canvas || !webglResources) return;

      const { gl, texture, uGain } = webglResources;

      // Ensure viewport matches drawing buffer
      if (gl.canvas.width !== canvas.width || gl.canvas.height !== canvas.height) {
        gl.viewport(0, 0, canvas.width, canvas.height);
      }

      // 1. Fetch live frequency data from AnalyserNode or direct prop
      if (analyserNode) {
        analyserNode.getByteFrequencyData(freqBinBuffer);
      } else if (fftData) {
        freqBinBuffer.set(fftData.subarray(0, freqBinBuffer.length));
      }

      // 2. Scroll waterfall history: shift rows down by speed
      const rowBytes = WATERFALL_WIDTH;
      const history = historyRef.current;
      history.copyWithin(rowBytes * speed, 0, rowBytes * (WATERFALL_HEIGHT - speed));

      // 3. Resample new FFT data into the top row (0 to 20kHz)
      const binStep = freqBinBuffer.length / WATERFALL_WIDTH;
      for (let i = 0; i < WATERFALL_WIDTH; i++) {
        const binIndex = Math.min(Math.floor(i * binStep), freqBinBuffer.length - 1);
        history[i] = freqBinBuffer[binIndex] || 0;
      }

      // 4. Upload updated texture to GPU
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        WATERFALL_WIDTH,
        WATERFALL_HEIGHT,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        history,
      );

      // 5. Update uniforms & Draw
      if (uGain) {
        gl.uniform1f(uGain, gain);
      }
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      animFrameIdRef.current = requestAnimationFrame(renderLoop);
    };

    renderLoop();

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      canvas.removeEventListener("webglcontextlost", handleLost);
      canvas.removeEventListener("webglcontextrestored", handleRestored);

      if (webglResources) {
        const { gl, program, buffer, texture } = webglResources;
        try {
          if (buffer) gl.deleteBuffer(buffer);
          if (texture) gl.deleteTexture(texture);
          if (program) gl.deleteProgram(program);
        } catch {
          // Ignore cleanup errors on unmount
        }
      }
    };
  }, [analyserNode, fftData, gain, speed, initWebGL, onContextLost, onContextRestored]);

  return (
    <div
      data-testid="spectral-waterfall-container"
      className={`relative rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-950 ${className}`}
    >
      <canvas
        ref={canvasRef}
        data-testid="spectral-waterfall-canvas"
        width={width}
        height={height}
        className="w-full h-full block"
      />

      {showLabels && (
        <div
          data-testid="spectral-frequency-labels"
          className="absolute bottom-1 left-0 right-0 flex justify-between px-3 text-[10px] font-mono text-cyan-300/80 pointer-events-none select-none"
        >
          <span>0Hz</span>
          <span>1kHz</span>
          <span>5kHz</span>
          <span>10kHz</span>
          <span>20kHz</span>
        </div>
      )}
    </div>
  );
}

export default SpectralWaterfallCanvas;
