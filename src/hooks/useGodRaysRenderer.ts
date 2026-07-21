/**
 * Custom hook for WebGL 2.0 Volumetric Light Shaft (God Rays) rendering.
 * Renders a radial blur post-processing effect centered on a calculated sun position.
 * Manages WebGL initialization, shader compilation, animation loop, and resource cleanup.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { attachWebGLContextRecovery } from "@/lib/webgl/contextManager";
import {
  GOD_RAYS_VERTEX_SOURCE,
  GOD_RAYS_FRAGMENT_SOURCE,
} from "@/shaders/godRaysShaders";

export interface GodRaysOptions {
  sunX: number;
  sunY: number;
  intensity?: number;
  rayLength?: number;
  decay?: number;
  density?: number;
  weight?: number;
  quality?: "low" | "medium" | "high";
  animate?: boolean;
  resolutionScale?: number;
}

interface GodRaysUniforms {
  u_resolution: WebGLUniformLocation | null;
  u_time: WebGLUniformLocation | null;
  u_sunPosition: WebGLUniformLocation | null;
  u_rayIntensity: WebGLUniformLocation | null;
  u_rayLength: WebGLUniformLocation | null;
  u_decay: WebGLUniformLocation | null;
  u_density: WebGLUniformLocation | null;
  u_weight: WebGLUniformLocation | null;
}

export function useGodRaysRenderer(options: GodRaysOptions) {
  const {
    sunX,
    sunY,
    intensity = 0.7,
    rayLength = 1.2,
    decay = 0.96,
    density = 4.0,
    weight = 0.04,
    quality = "medium",
    animate = true,
    resolutionScale = 0.75,
  } = options;

  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [fps, setFps] = useState<number>(60);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  const animFrameIdRef = useRef<number | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const programRef = useRef<WebGLProgram | null>(null);
  const vaoRef = useRef<WebGLVertexArrayObject | null>(null);
  const bufferRef = useRef<WebGLBuffer | null>(null);
  const shadersRef = useRef<WebGLShader[]>([]);
  const uniformsRef = useRef<GodRaysUniforms>({
    u_resolution: null,
    u_time: null,
    u_sunPosition: null,
    u_rayIntensity: null,
    u_rayLength: null,
    u_decay: null,
    u_density: null,
    u_weight: null,
  });

  const optionsRef = useRef({
    sunX,
    sunY,
    intensity,
    rayLength,
    decay,
    density,
    weight,
    quality,
  });

  useEffect(() => {
    optionsRef.current = {
      sunX,
      sunY,
      intensity,
      rayLength,
      decay,
      density,
      weight,
      quality,
    };
  }, [sunX, sunY, intensity, rayLength, decay, density, weight, quality]);

  const compileShader = useCallback(
    (
      gl: WebGL2RenderingContext,
      type: number,
      source: string,
    ): WebGLShader | null => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error(
          "[GodRays] Shader compile error:",
          gl.getShaderInfoLog(shader),
        );
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    },
    [],
  );

  const initWebGL = useCallback(
    (canvasEl: HTMLCanvasElement): boolean => {
      let gl: WebGL2RenderingContext | null = null;
      try {
        gl = canvasEl.getContext("webgl2", {
          alpha: true,
          depth: false,
          stencil: false,
          antialias: false,
          premultipliedAlpha: false,
          preserveDrawingBuffer: false,
          powerPreference: "high-performance",
        }) as WebGL2RenderingContext;
      } catch {
        gl = null;
      }

      if (!gl) {
        console.warn("[GodRays] WebGL 2.0 is not supported on this browser.");
        setIsSupported(false);
        return false;
      }

      setIsSupported(true);
      glRef.current = gl;

      const vertShader = compileShader(
        gl,
        gl.VERTEX_SHADER,
        GOD_RAYS_VERTEX_SOURCE,
      );
      const fragShader = compileShader(
        gl,
        gl.FRAGMENT_SHADER,
        GOD_RAYS_FRAGMENT_SOURCE,
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
          "[GodRays] Program link error:",
          gl.getProgramInfoLog(program),
        );
        gl.deleteProgram(program);
        return false;
      }

      programRef.current = program;
      gl.useProgram(program);

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

      const uniformNames: (keyof GodRaysUniforms)[] = [
        "u_resolution",
        "u_time",
        "u_sunPosition",
        "u_rayIntensity",
        "u_rayLength",
        "u_decay",
        "u_density",
        "u_weight",
      ];

      const uLocations: GodRaysUniforms = {
        u_resolution: null,
        u_time: null,
        u_sunPosition: null,
        u_rayIntensity: null,
        u_rayLength: null,
        u_decay: null,
        u_density: null,
        u_weight: null,
      };

      for (const name of uniformNames) {
        uLocations[name] = gl.getUniformLocation(program, name);
      }
      uniformsRef.current = uLocations;

      return true;
    },
    [compileShader],
  );

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

  useEffect(() => {
    const el = document.createElement("canvas");
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.display = "block";
    setCanvas(el);

    const initialized = initWebGL(el);
    if (!initialized) return;

    const cleanupContextRecovery = attachWebGLContextRecovery(el, () => {
      initWebGL(el);
    });

    const startTime = performance.now();
    let frameCount = 0;
    let fpsTimer = startTime;

    const renderFrame = (now: number) => {
      const gl = glRef.current;
      const program = programRef.current;
      const vao = vaoRef.current;
      const u = uniformsRef.current;
      const opts = optionsRef.current;

      if (gl && program && vao && el) {
        const displayWidth = Math.floor(el.clientWidth * resolutionScale);
        const displayHeight = Math.floor(el.clientHeight * resolutionScale);

        if (el.width !== displayWidth || el.height !== displayHeight) {
          el.width = Math.max(1, displayWidth);
          el.height = Math.max(1, displayHeight);
          gl.viewport(0, 0, el.width, el.height);
        }

        gl.useProgram(program);
        gl.bindVertexArray(vao);

        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        const timeInSeconds = (now - startTime) / 1000.0;

        if (u.u_resolution) gl.uniform2f(u.u_resolution, el.width, el.height);
        if (u.u_time) gl.uniform1f(u.u_time, timeInSeconds);
        if (u.u_sunPosition)
          gl.uniform2f(u.u_sunPosition, opts.sunX, opts.sunY);
        if (u.u_rayIntensity) gl.uniform1f(u.u_rayIntensity, opts.intensity);
        if (u.u_rayLength) gl.uniform1f(u.u_rayLength, opts.rayLength);
        if (u.u_decay) gl.uniform1f(u.u_decay, opts.decay);
        if (u.u_density) gl.uniform1f(u.u_density, opts.density);
        if (u.u_weight) gl.uniform1f(u.u_weight, opts.weight);

        gl.drawArrays(gl.TRIANGLES, 0, 6);

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
  }, [initWebGL, cleanupWebGL, animate, resolutionScale]);

  return {
    isSupported,
    fps,
    canvas,
  };
}
