"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, RotateCcw, ZoomIn, ZoomOut, Power, Volume2 } from "lucide-react";
import {
  WebGPUFloorPlanRenderer,
  type FloorPlanData,
} from "@/lib/webgpu/floorPlanRenderer";

interface FloorPlan3DProps {
  venueId: string;
  data: FloorPlanData;
}

export function FloorPlan3D({ venueId, data }: FloorPlan3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGPUFloorPlanRenderer | null>(null);
  const [useWebGPU, setUseWebGPU] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [seatInfo, setSeatInfo] = useState<{
    type: string;
    hasPower: boolean;
    isQuiet: boolean;
  } | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const renderer = new WebGPUFloorPlanRenderer(canvas);
    rendererRef.current = renderer;

    renderer.initialize().then((success) => {
      if (success) {
        setUseWebGPU(true);
        renderer.loadFloorPlan(data);
        renderer.startRenderLoop();
      } else {
        renderWebGLFallback(canvas, data);
      }
    });

    return () => {
      renderer.destroy();
    };
  }, [data, venueId]);

  const handleZoomIn = useCallback(() => {
    const r = rendererRef.current;
    if (r) {
      (r as unknown as { camera: { distance: number } }).camera.distance = Math.max(
        2,
        (r as unknown as { camera: { distance: number } }).camera.distance - 1,
      );
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const r = rendererRef.current;
    if (r) {
      (r as unknown as { camera: { distance: number } }).camera.distance = Math.min(
        20,
        (r as unknown as { camera: { distance: number } }).camera.distance + 1,
      );
    }
  }, []);

  const handleReset = useCallback(() => {
    const r = rendererRef.current;
    if (r) {
      const cam = r as unknown as {
        camera: {
          rotationX: number;
          rotationY: number;
          distance: number;
          panX: number;
          panY: number;
        };
      };
      cam.camera.rotationX = -0.8;
      cam.camera.rotationY = 0.5;
      cam.camera.distance = 8;
      cam.camera.panX = 0;
      cam.camera.panY = 0;
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!canvasRef.current) return;
    if (!isFullscreen) {
      canvasRef.current.parentElement?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
    setIsFullscreen(!isFullscreen);
  }, [isFullscreen]);

  const powerSeats = data.seats.filter((s) => s.hasPower).length;
  const quietSeats = data.seats.filter((s) => s.isQuiet).length;

  return (
    <div className="rounded-2xl border border-zinc-200 bg-zinc-50 overflow-hidden dark:border-zinc-800 dark:bg-zinc-900/60 shadow-md">
      <div className="flex items-center justify-between gap-3 p-4 pb-2 border-b border-zinc-150 dark:border-zinc-850">
        <div>
          <p className="font-bold text-sm tracking-tight text-zinc-900 dark:text-zinc-50 uppercase">
            3D Floor Plan
          </p>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            {useWebGPU ? "WebGPU accelerated" : "WebGL 2.0 fallback"} •{" "}
            {data.seats.length} seats
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomIn}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4 text-zinc-500" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4 text-zinc-500" />
          </button>
          <button
            onClick={handleReset}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Reset View"
          >
            <RotateCcw className="w-4 h-4 text-zinc-500" />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-zinc-500" />
            ) : (
              <Maximize2 className="w-4 h-4 text-zinc-500" />
            )}
          </button>
        </div>
      </div>

      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={450}
          className="w-full bg-zinc-950 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        />

        {/* Legend overlay */}
        <div className="absolute bottom-3 left-3 bg-zinc-900/90 backdrop-blur-sm rounded-lg p-2 space-y-1">
          {Object.entries({
            hot_desk: "Hot Desk",
            fixed_desk: "Fixed Desk",
            meeting_room: "Meeting Room",
            phone_booth: "Phone Booth",
          }).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5">
              <span
                className="w-2.5 h-2.5 rounded-sm"
                style={{
                  backgroundColor: `rgb(${
                    type === "hot_desk"
                      ? "51,153,230"
                      : type === "fixed_desk"
                        ? "77,204,102"
                        : type === "meeting_room"
                          ? "204,128,51"
                          : "179,77,179"
                  })`,
                }}
              />
              <span className="text-[9px] text-zinc-400">{label}</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5">
            <Power className="w-2.5 h-2.5 text-yellow-400" />
            <span className="text-[9px] text-zinc-400">Power Outlet</span>
          </div>
        </div>

        {/* Stats overlay */}
        <div className="absolute top-3 right-3 bg-zinc-900/90 backdrop-blur-sm rounded-lg p-2 space-y-1">
          <p className="text-[9px] text-zinc-400">
            <span className="text-white font-bold">{powerSeats}</span> seats
            with power
          </p>
          <p className="text-[9px] text-zinc-400">
            <span className="text-white font-bold">{quietSeats}</span> quiet
            zone seats
          </p>
        </div>
      </div>

      <div className="p-3 text-center">
        <p className="text-[10px] text-zinc-400">
          Drag to rotate • Scroll to zoom •{" "}
          {useWebGPU ? "Hardware-accelerated via WebGPU" : "WebGL 2.0 fallback mode"}
        </p>
      </div>
    </div>
  );
}

function renderWebGLFallback(
  canvas: HTMLCanvasElement,
  data: FloorPlanData,
): void {
  const gl = canvas.getContext("webgl2");
  if (!gl) return;

  gl.clearColor(0.08, 0.08, 0.1, 1.0);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const vertexSource = `#version 300 es
    in vec3 aPosition;
    in vec3 aColor;
    uniform mat4 uMVP;
    out vec3 vColor;
    void main() {
      gl_Position = uMVP * vec4(aPosition, 1.0);
      vColor = aColor;
    }
  `;
  const fragmentSource = `#version 300 es
    in vec3 vColor;
    out vec4 fragColor;
    void main() {
      fragColor = vec4(vColor, 1.0);
    }
  `;

  function compileShader(type: number, source: string): WebGLShader | null {
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

  const vs = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fs = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) return;

  const program = gl.createProgram();
  if (!program) return;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return;
  }

  gl.useProgram(program);

  // Build geometry
  const positions: number[] = [];
  const colors: number[] = [];
  const hw = data.width / 2;
  const hd = data.depth / 2;

  // Floor
  const fc = [0.15, 0.15, 0.18];
  positions.push(-hw, 0, -hd, hw, 0, -hd, hw, 0, hd);
  positions.push(-hw, 0, -hd, hw, 0, hd, -hw, 0, hd);
  for (let i = 0; i < 6; i++) colors.push(...fc);

  // Seats
  for (const seat of data.seats) {
    const c =
      seat.type === "hot_desk"
        ? [0.2, 0.6, 0.9]
        : seat.type === "fixed_desk"
          ? [0.3, 0.8, 0.4]
          : seat.type === "meeting_room"
            ? [0.8, 0.5, 0.2]
            : [0.7, 0.3, 0.7];
    const s = 0.3;
    const y = 0.4;
    const x = seat.x;
    const z = seat.z;
    // Simple quad
    positions.push(x - s, y, z - s, x + s, y, z - s, x + s, y, z + s);
    positions.push(x - s, y, z - s, x + s, y, z + s, x - s, y, z + s);
    for (let i = 0; i < 6; i++) colors.push(...c);
  }

  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);

  const colBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, colBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
  const aCol = gl.getAttribLocation(program, "aColor");
  gl.enableVertexAttribArray(aCol);
  gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 0, 0);

  // Simple perspective
  const aspect = canvas.width / canvas.height;
  const fov = Math.PI / 4;
  const near = 0.1;
  const far = 100;
  const f = 1 / Math.tan(fov / 2);
  const rangeInv = 1 / (near - far);

  const dist = 8;
  const eyeX = dist * Math.cos(-0.8) * Math.sin(0.5);
  const eyeY = dist * Math.sin(0.8);
  const eyeZ = dist * Math.cos(-0.8) * Math.cos(0.5);

  // Simple MVP (hardcoded view-projection for WebGL fallback)
  const mvp = new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (near + far) * rangeInv, -1,
    0, 0, near * far * rangeInv * 2, 0,
  ]);

  const uMVP = gl.getUniformLocation(program, "uMVP");
  gl.uniformMatrix4fv(uMVP, false, mvp);

  gl.drawArrays(gl.TRIANGLES, 0, positions.length / 3);
}
