/**
 * Custom hook for WebGL 2.0 3D Volumetric Cloud Renderer
 * Manages WebGL initialization, shader compilation, animation loop, adaptive step scaling,
 * context lost recovery, and WebGL resource cleanup.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { attachWebGLContextRecovery } from "@/lib/webgl/contextManager";
import {
  VERTEX_SHADER_SOURCE,
  FRAGMENT_SHADER_SOURCE,
} from "@/shaders/cloudShaders";
import {
  weatherToCloudUniforms,
  WeatherData,
} from "@/utils/weatherToCloudDensity";

export interface CloudRendererOptions {
  weatherData?: Partial<WeatherData> | null;
  quality?: "low" | "medium" | "high";
  animate?: boolean;
  resolutionScale?: number; // 0.5 to 1.0
}

export function useCloudRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  options: CloudRendererOptions = {},
) {
  const {
    weatherData,
    quality = "medium",
    animate = true,
    resolutionScale = 0.75,
  } = options;

  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(60);
  const animFrameIdRef = useRef<number | null>(null);

  // WebGL references stored in refs for clean teardown and zero React re-renders in loop
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const shadersRef = useRef<WebGLShader[]>([]);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});

  const weatherDataRef = useRef(weatherData);
  useEffect(() => {
    weatherDataRef.current = weatherData;
  }, [weatherData]);

  const qualityRef = useRef(quality);
  useEffect(() => {
    qualityRef.current = quality;
  }, [quality]);

  const initWebGL = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return false;

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: false,
        depth: false,
        stencil: false,
        antialias: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext;
    } catch {
      gl = null;
    }

    if (!gl) {
      console.warn(
        "[CloudRenderer] WebGL 2.0 is not supported on this browser.",
      );
      setIsSupported(false);
      return false;
    }

    setIsSupported(true);
    glRef.current = gl;

    // Helper to compile individual shader
    const compileShader = (
      type: number,
      source: string,
    ): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(
          "[CloudRenderer] Shader compile error:",
          gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vertShader = compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragShader = compileShader(
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    );

    if (!vertShader || !fragShader) {
      return false;
    }

    shadersRef.current = [vertShader, fragShader];

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "[CloudRenderer] Program link error:",
        gl.getProgramInfoLog(program),
      );
      gl.deleteProgram(program);
      return false;
    }

    programRef.current = program;
    gl.useProgram(program);

    // Fullscreen quad positions
    const positions = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);

    const vao = gl.createVertexArray();
    const positionBuffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posAttrLoc = gl.getAttribLocation(program, "a_position");
    if (posAttrLoc !== -1) {
      gl.enableVertexAttribArray(posAttrLoc);
      gl.vertexAttribPointer(posAttrLoc, 2, gl.FLOAT, false, 0, 0);
    }

    vaoRef.current = vao;
    bufferRef.current = positionBuffer;

    // Store uniform locations
    const uniformNames = [
      "u_resolution",
      "u_time",
      "u_cloudCoverage",
      "u_humidity",
      "u_rainFactor",
      "u_lightDir",
      "u_lightColor",
      "u_skyTopColor",
      "u_skyBottomColor",
      "u_windSpeed",
      "u_maxSteps",
      "u_stepSize",
    ];

    const uLocations: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) {
      uLocations[name] = gl.getUniformLocation(program, name);
    }
    uniformsRef.current = uLocations;

    return true;
  }, [canvasRef]);

  // Clean WebGL resources
  const cleanupWebGL = useCallback(() => {
    const gl = glRef.current;
    if (gl) {
      if (programRef.current) {
        gl.deleteProgram(programRef.current);
        programRef.current = null;
      }
      for (const s of shadersRef.current) {
        gl.deleteShader(s);
      }
      shadersRef.current = [];

      if (bufferRef.current) {
        gl.deleteBuffer(bufferRef.current);
        bufferRef.current = null;
      }
      if (vaoRef.current) {
        gl.deleteVertexArray(vaoRef.current);
        vaoRef.current = null;
      }
      glRef.current = null;
    }
  }, []);

  // Main animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const initialized = initWebGL();
    if (!initialized) return;

    // Attach Context Recovery
    const cleanupContextRecovery = attachWebGLContextRecovery(canvas, () => {
      initWebGL();
    });

    const startTime = performance.now();
    let frameCount = 0;
    let fpsTimer = startTime;

    const renderFrame = (now: number) => {
      const gl = glRef.current;
      const program = programRef.current;
      const vao = vaoRef.current;

      if (gl && program && vao && canvas) {
        // Handle canvas resolution scaling
        const displayWidth = Math.floor(canvas.clientWidth * resolutionScale);
        const displayHeight = Math.floor(canvas.clientHeight * resolutionScale);

        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
          canvas.width = Math.max(1, displayWidth);
          canvas.height = Math.max(1, displayHeight);
          gl.viewport(0, 0, canvas.width, canvas.height);
        }

        gl.useProgram(program);
        gl.bindVertexArray(vao);

        const timeInSeconds = (now - startTime) / 1000.0;
        const u = uniformsRef.current;

        // Calculate uniforms from weather ref
        const uniforms = weatherToCloudUniforms(weatherDataRef.current);

        // Quality step scaling
        const q = qualityRef.current;
        const maxSteps = q === "high" ? 64 : q === "low" ? 32 : 48;
        const stepSize = 0.12;

        if (u.u_resolution)
          gl.uniform2f(u.u_resolution, canvas.width, canvas.height);
        if (u.u_time) gl.uniform1f(u.u_time, timeInSeconds);
        if (u.u_cloudCoverage)
          gl.uniform1f(u.u_cloudCoverage, uniforms.cloudCoverage);
        if (u.u_humidity) gl.uniform1f(u.u_humidity, uniforms.humidity);
        if (u.u_rainFactor) gl.uniform1f(u.u_rainFactor, uniforms.rainFactor);
        if (u.u_windSpeed) gl.uniform1f(u.u_windSpeed, uniforms.windSpeed);
        if (u.u_maxSteps) gl.uniform1i(u.u_maxSteps, maxSteps);
        if (u.u_stepSize) gl.uniform1f(u.u_stepSize, stepSize);

        if (u.u_lightDir) gl.uniform3fv(u.u_lightDir, uniforms.lightDir);
        if (u.u_lightColor) gl.uniform3fv(u.u_lightColor, uniforms.lightColor);
        if (u.u_skyTopColor)
          gl.uniform3fv(u.u_skyTopColor, uniforms.skyTopColor);
        if (u.u_skyBottomColor)
          gl.uniform3fv(u.u_skyBottomColor, uniforms.skyBottomColor);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

        // FPS calculation
        frameCount++;
        if (now - fpsTimer >= 1000) {
          setFps(Math.round((frameCount * 1000) / (now - fpsTimer)));
          frameCount = 0;
          fpsTimer = now;
        }
      }

      if (animate) {
        animFrameIdRef.current = requestAnimationFrame(renderFrame);
      }
    };

    if (animate) {
      animFrameIdRef.current = requestAnimationFrame(renderFrame);
    } else {
      renderFrame(performance.now());
    }

    return () => {
      if (animFrameIdRef.current !== null) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
      cleanupContextRecovery();
      cleanupWebGL();
    };
  }, [canvasRef, initWebGL, cleanupWebGL, animate, resolutionScale]);

  return {
    isSupported,
    fps,
  };
}
