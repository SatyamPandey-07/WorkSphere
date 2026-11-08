"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// GLSL Shader Sources (WebGL 2 / GLSL ES 3.00)
// ---------------------------------------------------------------------------

const VERTEX_SOURCE = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_energy;

// ---- Utility ---------------------------------------------------------------

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash(vec3 p) {
    float h = dot(p, vec3(127.1, 311.7, 74.7));
    return fract(sin(h) * 43758.5453);
}

mat2 rot2(float a) {
    float c = cos(a), s = sin(a);
    return mat2(c, -s, s, c);
}

// ---- Signed Distance Functions ---------------------------------------------

float sdSphere(vec3 p, float r) {
    return length(p) - r;
}

float sdTorus(vec3 p, vec2 t) {
    vec2 q = vec2(length(p.xz) - t.x, p.y);
    return length(q) - t.y;
}

float sdHexPrism(vec3 p, vec2 h) {
    vec3 q = abs(p);
    float d1 = q.z - h.y;
    float d2 = max(q.x * 0.866025 + q.y * 0.5, q.y) - h.x;
    return max(d1, d2);
}

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

// ---- Scene SDF (morphing crystalline constructs) ---------------------------

float sceneSDF(vec3 p) {
    float t = u_time * 0.4;
    float morph = sin(t) * 0.5 + 0.5;

    // Rotating shield sphere
    vec3 p1 = p;
    p1.xz *= rot2(t * 0.3);
    p1.yz *= rot2(t * 0.2);
    float shield = sdSphere(p1, 0.9 + 0.15 * sin(t * 1.3));

    // Energy ring
    vec3 p2 = p;
    p2.xz *= rot2(-t * 0.5);
    p2.yz *= rot2(t * 0.15);
    float ring = sdTorus(p2, vec2(1.2 + 0.2 * sin(t * 0.7), 0.06 + 0.03 * sin(t * 2.1)));

    // Interlocking hexagonal lattice
    vec3 p3 = p;
    p3.xz *= rot2(t * 0.25);
    p3.xy *= rot2(t * 0.18);

    float hexDist = 1e5;
    for (int i = 0; i < 6; i++) {
        float angle = float(i) * 1.0471975 + t * 0.3;
        vec3 offset = vec3(cos(angle), sin(angle), 0.0) * (0.85 + 0.15 * sin(t + float(i)));
        vec3 hp = p3 - offset;
        hp.xz *= rot2(angle);
        float hex = sdHexPrism(hp, vec2(0.18 + 0.05 * sin(t * 1.5 + float(i)), 0.04));
        hexDist = min(hexDist, hex);
    }

    // Morph between shield and hollowed construct
    float shellThickness = 0.04 + 0.02 * sin(t * 1.8);
    float construct = abs(shield) - shellThickness;
    construct = smin(construct, ring, 0.15);
    construct = smin(construct, hexDist, 0.1 * (1.0 + morph * 0.5));

    return construct;
}

// ---- Normals via central differences ---------------------------------------

vec3 calcNormal(vec3 p) {
    const float h = 0.001;
    return normalize(vec3(
        sceneSDF(p + vec3(h, 0, 0)) - sceneSDF(p - vec3(h, 0, 0)),
        sceneSDF(p + vec3(0, h, 0)) - sceneSDF(p - vec3(0, h, 0)),
        sceneSDF(p + vec3(0, 0, h)) - sceneSDF(p - vec3(0, 0, h))
    ));
}

// ---- Caustics pattern ------------------------------------------------------

float caustics(vec2 p, float t) {
    float c = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        vec2 q = p * (2.0 + fi * 0.8);
        q += vec2(sin(t * 0.7 + fi), cos(t * 0.9 + fi * 1.3)) * 0.3;
        float v1 = sin(q.x * 3.1 + t) * cos(q.y * 2.7 - t * 0.8);
        float v2 = sin(q.y * 3.5 + t * 1.1) * cos(q.x * 2.9 + t * 0.6);
        c += pow(max(0.0, v1 + v2), 2.0);
    }
    return c * 0.2;
}

// ---- Main raymarching ------------------------------------------------------

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y);

    // Camera with pointer influence
    vec2 ptrOffset = (u_pointer - 0.5) * 0.6;
    vec3 ro = vec3(ptrOffset.x * 1.5, ptrOffset.y * 1.0, -3.0);
    vec3 rd = normalize(vec3(uv, 1.5));
    rd.xz *= rot2(ptrOffset.x * 0.3);
    rd.yz *= rot2(-ptrOffset.y * 0.2);

    // Emerald palette
    vec3 deepBase    = vec3(0.008, 0.045, 0.035);
    vec3 emeraldMid  = vec3(0.063, 0.584, 0.404);
    vec3 brightGreen = vec3(0.20, 0.83, 0.60);
    vec3 coreWhite   = vec3(0.75, 0.98, 0.88);

    vec3 col = deepBase;
    float totalDist = 0.0;
    float glow = 0.0;
    bool hit = false;

    // Raymarch loop (64 steps for performance)
    for (int i = 0; i < 64; i++) {
        vec3 p = ro + rd * totalDist;
        float d = sceneSDF(p);

        // Accumulate volumetric glow near the surface
        glow += 0.015 / (0.05 + abs(d) * 3.0) * u_energy;

        if (d < 0.001) {
            hit = true;

            vec3 n = calcNormal(p);

            // Fresnel-like rim glow
            float fresnel = pow(1.0 - abs(dot(n, -rd)), 3.0);

            // Internal caustic pattern
            float caust = caustics(p.xy + p.yz, u_time * 0.6);

            // Construct surface color
            vec3 surfaceCol = mix(emeraldMid, brightGreen, fresnel * 0.8 + caust * 0.5);
            surfaceCol += coreWhite * pow(fresnel, 4.0) * 1.5;
            surfaceCol += brightGreen * caust * 0.6;
            surfaceCol *= u_energy;

            // Translucency — blend with glow behind
            col += surfaceCol * (0.5 + fresnel * 0.5);
            break;
        }

        if (totalDist > 6.0) break;
        totalDist += d;
    }

    // Volumetric emerald glow
    col += emeraldMid * glow * 0.35;
    col += brightGreen * glow * 0.15;

    // Chromatic aberration (sample UV offsets for R and B)
    float caStrength = 0.003 + 0.002 * sin(u_time * 0.5);
    vec2 caDir = normalize(uv + 0.001);
    float caR = length(col + deepBase * 0.05);
    float caB = length(col + emeraldMid * 0.05);
    col.r += caR * caStrength * 0.5;
    col.b += caB * caStrength * 0.3;

    // Edge vignette
    float vignette = 1.0 - 0.4 * dot(v_uv - 0.5, v_uv - 0.5);
    col *= vignette;

    float alpha = clamp(glow * 0.6 + (hit ? 0.85 : 0.0), 0.0, 0.95);
    fragColor = vec4(col, alpha);
}
`;

// ---------------------------------------------------------------------------
// WebGL helpers
// ---------------------------------------------------------------------------

interface ShaderBundle {
  program: WebGLProgram;
  uniforms: {
    u_resolution: WebGLUniformLocation | null;
    u_time: WebGLUniformLocation | null;
    u_pointer: WebGLUniformLocation | null;
    u_energy: WebGLUniformLocation | null;
  };
  aPosition: number;
  buffer: WebGLBuffer | null;
}

function compileShader(
  gl: WebGL2RenderingContext,
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

function initWebGL(gl: WebGL2RenderingContext): ShaderBundle | null {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  if (!vert || !frag) return null;

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  return {
    program,
    uniforms: {
      u_resolution: gl.getUniformLocation(program, "u_resolution"),
      u_time: gl.getUniformLocation(program, "u_time"),
      u_pointer: gl.getUniformLocation(program, "u_pointer"),
      u_energy: gl.getUniformLocation(program, "u_energy"),
    },
    aPosition: gl.getAttribLocation(program, "a_position"),
    buffer,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface HardLightRaymarchCanvasProps {
  className?: string;
  energyIntensity?: number;
  interactive?: boolean;
  children?: React.ReactNode;
  "data-testid"?: string;
}

export default function HardLightRaymarchCanvas({
  className = "",
  energyIntensity = 1.0,
  interactive = true,
  children,
  "data-testid": testId = "hard-light-raymarch-canvas",
}: HardLightRaymarchCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const [hasWebGL, setHasWebGL] = useState(true);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const rect = (e.currentTarget as HTMLElement)?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      pointerRef.current = {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, 1.0 - (e.clientY - rect.top) / rect.height)),
      };
    },
    [interactive],
  );

  const handlePointerLeave = useCallback(() => {
    if (!interactive) return;
    pointerRef.current = { x: 0.5, y: 0.5 };
  }, [interactive]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        powerPreference: "low-power",
      });
    } catch {
      gl = null;
    }

    if (!gl) {
      setHasWebGL(false);
      return;
    }

    const bundle = initWebGL(gl);
    if (!bundle) {
      setHasWebGL(false);
      return;
    }

    setHasWebGL(true);

    const isMobile =
      typeof window !== "undefined" &&
      (window.innerWidth < 768 || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const dpr = isMobile
      ? Math.min(window.devicePixelRatio || 1, 1.0)
      : Math.min(window.devicePixelRatio || 1, 1.5);

    let animId: number | null = null;
    const startTime = performance.now();

    const render = () => {
      if (!gl || !canvas) return;

      const clientW = canvas.clientWidth || 300;
      const clientH = canvas.clientHeight || 150;
      const drawW = Math.round(clientW * dpr);
      const drawH = Math.round(clientH * dpr);

      if (canvas.width !== drawW || canvas.height !== drawH) {
        canvas.width = drawW;
        canvas.height = drawH;
        gl.viewport(0, 0, drawW, drawH);
      }

      gl.useProgram(bundle.program);

      if (bundle.uniforms.u_resolution) {
        gl.uniform2f(bundle.uniforms.u_resolution, drawW, drawH);
      }
      if (bundle.uniforms.u_time) {
        gl.uniform1f(bundle.uniforms.u_time, (performance.now() - startTime) / 1000.0);
      }
      if (bundle.uniforms.u_pointer) {
        gl.uniform2f(bundle.uniforms.u_pointer, pointerRef.current.x, pointerRef.current.y);
      }
      if (bundle.uniforms.u_energy) {
        gl.uniform1f(bundle.uniforms.u_energy, energyIntensity);
      }

      if (bundle.buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bundle.buffer);
        gl.enableVertexAttribArray(bundle.aPosition);
        gl.vertexAttribPointer(bundle.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (gl) {
        try {
          if (bundle.buffer) gl.deleteBuffer(bundle.buffer);
          gl.deleteProgram(bundle.program);
        } catch {
          // cleanup safe
        }
      }
    };
  }, [energyIntensity]);

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`relative overflow-hidden ${className}`}
    >
      {hasWebGL ? (
        <canvas
          ref={canvasRef}
          data-testid="hard-light-raymarch-webgl-canvas"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full pointer-events-none"
        />
      ) : (
        <div
          data-testid="hard-light-raymarch-css-fallback"
          className="absolute inset-0 h-full w-full pointer-events-none overflow-hidden bg-[#021a14]"
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(16,185,129,0.3) 0%, rgba(6,78,59,0.15) 40%, rgba(2,26,20,0.95) 80%)",
            }}
          />
          <div
            className="absolute inset-0 opacity-30"
            style={{
              background:
                "conic-gradient(from 0deg at 50% 50%, transparent 0deg, rgba(52,211,153,0.15) 60deg, transparent 120deg, rgba(16,185,129,0.1) 180deg, transparent 240deg, rgba(52,211,153,0.12) 300deg, transparent 360deg)",
            }}
          />
          <div className="absolute inset-0 rounded-full w-3/4 h-3/4 m-auto border border-emerald-500/20 shadow-[0_0_40px_rgba(16,185,129,0.15),inset_0_0_20px_rgba(52,211,153,0.1)]" />
        </div>
      )}
      <div className="relative z-10 w-full h-full">{children}</div>
    </div>
  );
}

export { VERTEX_SOURCE, FRAGMENT_SOURCE, initWebGL };
export type { ShaderBundle };
