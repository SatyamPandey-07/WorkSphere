"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { initHardLightWebGL } from "@/lib/shaders/hardLightFacetShader";

export interface HardLightCrystallineBackdropProps {
  className?: string;
  facetScale?: number;
  refractionIntensity?: number;
  interactive?: boolean;
  forceCssFallback?: boolean;
  children?: React.ReactNode;
  "data-testid"?: string;
}

/**
 * HardLightCrystallineBackdrop
 *
 * Renders a custom WebGL / GLSL fragment shader displaying geometric crystalline
 * hard-light energy facets with shimmering emerald caustics and pointer-driven refraction.
 * Automatically falls back to a seamless CSS/SVG emerald crystalline facet layer
 * on devices without WebGL support.
 */
export default function HardLightCrystallineBackdrop({
  className = "",
  facetScale = 6.0,
  refractionIntensity = 1.2,
  interactive = true,
  forceCssFallback = false,
  children,
  "data-testid": testId = "hard-light-crystalline-backdrop",
}: HardLightCrystallineBackdropProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasWebGL, setHasWebGL] = useState(!forceCssFallback);
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const [cssPointer, setCssPointer] = useState<{ x: number; y: number }>({
    x: 50,
    y: 50,
  });

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!interactive) return;
      const target = (e.currentTarget || e.target) as HTMLElement | null;
      const rect = target?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;

      const rawX = e.clientX ?? (e as unknown as { pageX?: number }).pageX;
      const rawY = e.clientY ?? (e as unknown as { pageY?: number }).pageY;

      const clientX =
        typeof rawX === "number" && !Number.isNaN(rawX)
          ? rawX
          : rect.left + rect.width * 0.5;
      const clientY =
        typeof rawY === "number" && !Number.isNaN(rawY)
          ? rawY
          : rect.top + rect.height * 0.5;

      const normX = Math.max(
        0,
        Math.min(1, (clientX - rect.left) / rect.width),
      );
      const normY = Math.max(
        0,
        Math.min(1, 1.0 - (clientY - rect.top) / rect.height),
      );

      pointerRef.current = { x: normX, y: normY };
      setCssPointer({
        x: Math.round(normX * 100),
        y: Math.round((1.0 - normY) * 100),
      });
    },
    [interactive],
  );

  const handlePointerLeave = useCallback(() => {
    if (!interactive) return;
    pointerRef.current = { x: 0.5, y: 0.5 };
    setCssPointer({ x: 50, y: 50 });
  }, [interactive]);

  useEffect(() => {
    if (forceCssFallback) {
      setHasWebGL(false);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    let gl: WebGLRenderingContext | null = null;
    try {
      gl =
        canvas.getContext("webgl", {
          alpha: true,
          antialias: true,
          powerPreference: "low-power",
        }) ||
        (canvas.getContext(
          "experimental-webgl",
        ) as WebGLRenderingContext | null);
    } catch {
      gl = null;
    }

    if (!gl) {
      setHasWebGL(false);
      return;
    }

    const programBundle = initHardLightWebGL(gl);
    if (!programBundle) {
      setHasWebGL(false);
      return;
    }

    const { program, uniforms, attributes, buffer } = programBundle;
    let animId: number | null = null;
    const startTime = performance.now();

    const render = () => {
      if (!gl || !canvas) return;

      const width = canvas.clientWidth || 300;
      const height = canvas.clientHeight || 150;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }

      gl.useProgram(program);

      // Set Shader Uniforms
      if (uniforms.uResolution) {
        gl.uniform2f(uniforms.uResolution, canvas.width, canvas.height);
      }
      if (uniforms.uPointer) {
        gl.uniform2f(
          uniforms.uPointer,
          pointerRef.current.x,
          pointerRef.current.y,
        );
      }
      if (uniforms.uTime) {
        const elapsed = (performance.now() - startTime) / 1000.0;
        gl.uniform1f(uniforms.uTime, elapsed);
      }
      if (uniforms.uFacetScale) {
        gl.uniform1f(uniforms.uFacetScale, facetScale);
      }
      if (uniforms.uRefractionIntensity) {
        gl.uniform1f(uniforms.uRefractionIntensity, refractionIntensity);
      }

      // Draw Screen Quad
      if (buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.enableVertexAttribArray(attributes.aPosition);
        gl.vertexAttribPointer(attributes.aPosition, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    setHasWebGL(true);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (gl) {
        try {
          if (buffer) gl.deleteBuffer(buffer);
          gl.deleteProgram(program);
        } catch {
          // cleanup safe
        }
      }
    };
  }, [forceCssFallback, facetScale, refractionIntensity]);

  return (
    <div
      ref={containerRef}
      data-testid={testId}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className={`relative overflow-hidden ${className}`}
      style={
        {
          "--pointer-x": `${cssPointer.x}%`,
          "--pointer-y": `${cssPointer.y}%`,
        } as React.CSSProperties
      }
    >
      {hasWebGL ? (
        <canvas
          ref={canvasRef}
          data-testid="hard-light-facet-canvas"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full pointer-events-none"
        />
      ) : (
        /* Seamless CSS fallback on devices without WebGL support */
        <div
          data-testid="hard-light-css-fallback"
          className="absolute inset-0 h-full w-full pointer-events-none overflow-hidden bg-[#02140f]"
        >
          {/* Emerald crystalline gradient base */}
          <div
            className="absolute inset-0 transition-opacity duration-300"
            style={{
              background: `radial-gradient(circle at var(--pointer-x) var(--pointer-y), rgba(52, 211, 153, 0.35) 0%, rgba(16, 185, 129, 0.15) 35%, rgba(2, 20, 15, 0.95) 75%)`,
            }}
          />

          {/* Faceted crystalline geometric mesh overlay */}
          <svg
            className="absolute inset-0 h-full w-full opacity-40 mix-blend-screen"
            xmlns="http://www.w3.org/2000/svg"
            preserveAspectRatio="none"
            viewBox="0 0 100 100"
          >
            <defs>
              <linearGradient
                id="emeraldCausticGrad"
                x1="0%"
                y1="0%"
                x2="100%"
                y2="100%"
              >
                <stop offset="0%" stopColor="#34d399" stopOpacity="0.8" />
                <stop offset="50%" stopColor="#10b981" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#064e3b" stopOpacity="0.9" />
              </linearGradient>
            </defs>
            <polygon
              points="0,0 35,25 20,65 0,50"
              fill="url(#emeraldCausticGrad)"
              stroke="#34d399"
              strokeWidth="0.4"
            />
            <polygon
              points="35,25 70,15 60,55 20,65"
              fill="rgba(16, 185, 129, 0.18)"
              stroke="#5eead4"
              strokeWidth="0.4"
            />
            <polygon
              points="70,15 100,0 95,45 60,55"
              fill="rgba(6, 78, 59, 0.35)"
              stroke="#10b981"
              strokeWidth="0.4"
            />
            <polygon
              points="20,65 60,55 50,95 10,100"
              fill="rgba(52, 211, 153, 0.22)"
              stroke="#6ee7b7"
              strokeWidth="0.4"
            />
            <polygon
              points="60,55 95,45 100,100 50,95"
              fill="url(#emeraldCausticGrad)"
              stroke="#34d399"
              strokeWidth="0.4"
            />
          </svg>

          {/* Shimmering emerald caustics glow pulse */}
          <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px] opacity-25 animate-pulse" />

          {/* Refraction ripple aura around pointer */}
          <div
            className="absolute -inset-10 pointer-events-none transition-transform duration-150 ease-out"
            style={{
              transform: `translate(calc(var(--pointer-x) - 50%), calc(var(--pointer-y) - 50%))`,
              background: `radial-gradient(circle 180px, rgba(167, 243, 208, 0.12) 0%, transparent 70%)`,
            }}
          />
        </div>
      )}

      {/* Render children/content above backdrop */}
      <div className="relative z-10 w-full h-full">{children}</div>
    </div>
  );
}

/**
 * HardLightModalBackdrop
 *
 * Dedicated backdrop variant specifically crafted for interactive dialogs and modals.
 */
export function HardLightModalBackdrop({
  onClick,
  className = "",
  children,
  ...props
}: HardLightCrystallineBackdropProps & { onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md ${className}`}
      data-testid="hard-light-modal-backdrop-container"
    >
      <HardLightCrystallineBackdrop
        className="absolute inset-0 h-full w-full"
        data-testid="hard-light-modal-backdrop"
        {...props}
      />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-20 w-full max-w-lg"
      >
        {children}
      </div>
    </div>
  );
}
