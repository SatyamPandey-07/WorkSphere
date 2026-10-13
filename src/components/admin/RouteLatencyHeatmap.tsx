"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Clock,
  Filter,
  Flame,
  Gauge,
  Info,
  Layers,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import type {
  RouteHeatmapCell,
  RouteHeatmapRow,
  RouteLatencyHeatmapData,
  LatencySeverity,
} from "@/lib/telemetry/types";
import usePartySocket from "@/hooks/usePartySocketReconnect";

interface RouteLatencyHeatmapProps {
  className?: string;
  initialRange?: "1h" | "24h" | "7d";
}

const MAX_HYPERLANES = 12;

const HYPERLANE_VERTEX_SHADER = `
attribute vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const HYPERLANE_FRAGMENT_SHADER = `
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_view;
uniform int u_routeCount;
uniform vec4 u_routes[${MAX_HYPERLANES}];

float hash(vec2 point) {
  return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 screenUv = gl_FragCoord.xy / u_resolution;
  vec2 viewScale = vec2(aspect, 1.0);
  vec2 point = (screenUv - 0.5) * viewScale / u_view.x
    - u_view.yz * viewScale;

  vec3 color = vec3(0.01176, 0.02745, 0.07059);
  vec2 starCell = floor((point + viewScale * 0.5) * vec2(38.0, 26.0));
  float star = step(0.997, hash(starCell));
  color += vec3(0.12, 0.22, 0.25) * star * 0.35;

  for (int i = 0; i < ${MAX_HYPERLANES}; i++) {
    if (i >= u_routeCount) break;

    vec4 route = u_routes[i];
    vec2 start = vec2(-aspect * 0.46, route.x - 0.5);
    vec2 end = vec2(aspect * 0.46, route.y - 0.5);
    vec2 segment = end - start;
    float segmentLength = max(dot(segment, segment), 0.0001);
    float along = clamp(dot(point - start, segment) / segmentLength, 0.0, 1.0);
    float distanceToLane = length(point - (start + segment * along));
    float intensity = route.z;

    vec3 laneColor = mix(
      vec3(0.015, 0.35, 0.19),
      vec3(0.04, 1.0, 0.70),
      smoothstep(0.2, 1.0, intensity)
    );
    float corridor = exp(-distanceToLane * distanceToLane * 1250.0);
    color += laneColor * corridor * (0.18 + intensity * 0.34);

    float pulsePosition = fract(u_time * (0.25 + intensity * 1.2) + route.w);
    vec2 pulsePoint = start + segment * pulsePosition;
    float pulseDistance = length(point - pulsePoint);
    float pulse = exp(-pulseDistance * pulseDistance * 2400.0);
    color += laneColor * pulse * (0.45 + intensity * 1.8);
  }

  float vignette = 1.0 - smoothstep(0.15, 1.15, length((screenUv - 0.5) * vec2(aspect, 1.0)));
  color *= 0.72 + vignette * 0.28;
  gl_FragColor = vec4(color, 1.0);
}
`;

interface HyperlaneRoute {
  route: string;
  totalRequests: number;
}

function buildHyperlaneUniforms(routes: HyperlaneRoute[]) {
  const routeUniforms = new Float32Array(MAX_HYPERLANES * 4);
  const maxRequests = Math.max(1, ...routes.map((route) => route.totalRequests));
  const maxLogRequests = Math.log1p(maxRequests);

  routes.forEach((route, index) => {
    let hash = 2166136261;
    for (let charIndex = 0; charIndex < route.route.length; charIndex++) {
      hash = Math.imul(hash ^ route.route.charCodeAt(charIndex), 16777619);
    }
    const seed = hash >>> 0;
    const offset = index * 4;
    const throughput = Math.log1p(route.totalRequests) / maxLogRequests;
    routeUniforms.set(
      [
        0.1 + ((index + 0.5) / Math.max(routes.length, 1)) * 0.8,
        0.1 + ((seed % 10000) / 9999) * 0.8,
        0.25 + throughput * 0.75,
        (seed % 1000) / 1000,
      ],
      offset,
    );
  });

  return routeUniforms;
}

function HyperlaneViewport({ routes }: { routes: HyperlaneRoute[] }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [renderError, setRenderError] = useState<string | null>(null);

  const activeRoutes = useMemo(
    () => routes.filter((route) => route.totalRequests > 0).slice(0, MAX_HYPERLANES),
    [routes],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: "high-performance",
      stencil: false,
    });
    if (!canvas || !gl) {
      setRenderError("WebGL is unavailable in this browser.");
      return;
    }

    const compileShader = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("Unable to allocate a WebGL shader.");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader) || "Unknown shader compilation error.";
        gl.deleteShader(shader);
        throw new Error(message);
      }
      return shader;
    };

    let program: WebGLProgram | null = null;
    let frameId = 0;
    let resizeObserver: ResizeObserver | null = null;

    try {
      const vertexShader = compileShader(gl.VERTEX_SHADER, HYPERLANE_VERTEX_SHADER);
      const fragmentShader = compileShader(gl.FRAGMENT_SHADER, HYPERLANE_FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error("Unable to allocate a WebGL program.");
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "Unable to link the WebGL program.");
      }

      const positionLocation = gl.getAttribLocation(program, "a_position");
      const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
      const timeLocation = gl.getUniformLocation(program, "u_time");
      const viewLocation = gl.getUniformLocation(program, "u_view");
      const routeCountLocation = gl.getUniformLocation(program, "u_routeCount");
      const routesLocation = gl.getUniformLocation(program, "u_routes[0]");
      if (
        positionLocation < 0 ||
        !resolutionLocation ||
        !timeLocation ||
        !viewLocation ||
        !routeCountLocation ||
        !routesLocation
      ) {
        throw new Error("The WebGL program is missing a required shader input.");
      }

      const buffer = gl.createBuffer();
      if (!buffer) throw new Error("Unable to allocate a WebGL vertex buffer.");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      );
      gl.useProgram(program);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

      const routeUniforms = buildHyperlaneUniforms(activeRoutes);
      gl.uniform1i(routeCountLocation, activeRoutes.length);
      gl.uniform4fv(routesLocation, routeUniforms);

      const resize = () => {
        const bounds = canvas.getBoundingClientRect();
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.round(bounds.width * pixelRatio));
        const height = Math.max(1, Math.round(bounds.height * pixelRatio));
        if (canvas.width === width && canvas.height === height) return;
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
        gl.useProgram(program);
        gl.uniform2f(resolutionLocation, width, height);
      };
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(canvas);
      resize();

      const startTime = performance.now();
      let lastFrameTime = 0;
      const render = (now: number) => {
        resize();
        if (now - lastFrameTime < 1000 / 60) {
          frameId = requestAnimationFrame(render);
          return;
        }
        lastFrameTime = now;
        gl.useProgram(program);
        gl.uniform1f(timeLocation, (now - startTime) / 1000);
        gl.uniform3f(
          viewLocation,
          viewRef.current.zoom,
          viewRef.current.panX,
          viewRef.current.panY,
        );
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (!document.hidden) frameId = requestAnimationFrame(render);
      };
      const onVisibilityChange = () => {
        cancelAnimationFrame(frameId);
        if (!document.hidden) frameId = requestAnimationFrame(render);
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      frameId = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(frameId);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resizeObserver?.disconnect();
        gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
      };
    } catch (error) {
      if (program) gl.deleteProgram(program);
      setRenderError(
        error instanceof Error ? error.message : "Unable to initialize the WebGL renderer.",
      );
      console.error("Failed to initialize the route hyperlane WebGL renderer.", error);
      return;
    }
    // The renderer is mounted once; route data is uploaded by the separate uniform-update effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl");
    if (!gl) return;
    const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    if (!program) return;
    const routeCountLocation = gl.getUniformLocation(program, "u_routeCount");
    const routesLocation = gl.getUniformLocation(program, "u_routes[0]");
    if (!routeCountLocation || !routesLocation) return;

    const routeUniforms = buildHyperlaneUniforms(activeRoutes);
    gl.useProgram(program);
    gl.uniform1i(routeCountLocation, activeRoutes.length);
    gl.uniform4fv(routesLocation, routeUniforms);
  }, [activeRoutes]);

  const changeZoom = (nextZoom: number) => {
    const boundedZoom = Math.min(2.5, Math.max(0.75, nextZoom));
    viewRef.current.zoom = boundedZoom;
    setZoom(boundedZoom);
  };

  return (
    <div className="relative mt-5 overflow-hidden rounded-2xl border border-emerald-400/15 bg-[#030712]">
      <canvas
        ref={canvasRef}
        aria-label="Animated network hyperlanes representing active API routes"
        className="block h-48 w-full cursor-grab touch-none active:cursor-grabbing"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          viewRef.current.panX += (event.clientX - drag.x) / bounds.width / viewRef.current.zoom;
          viewRef.current.panY -= (event.clientY - drag.y) / bounds.height / viewRef.current.zoom;
          dragRef.current = { ...drag, x: event.clientX, y: event.clientY };
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          changeZoom(viewRef.current.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
        }}
      />
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-200/80">
            Interstellar Hyperlanes
          </p>
          <p className="mt-1 text-[10px] text-emerald-100/45">
            {activeRoutes.length} active corridors · drag to pan · scroll to zoom
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-emerald-200/10 bg-[#030712]/70 p-1">
          <button
            type="button"
            aria-label="Zoom out hyperlanes"
            onClick={() => changeZoom(zoom / 1.2)}
            className="h-6 w-6 rounded text-xs text-emerald-100/70 hover:bg-emerald-300/10"
          >
            −
          </button>
          <span className="min-w-10 text-center font-mono text-[10px] text-emerald-100/55">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            aria-label="Zoom in hyperlanes"
            onClick={() => changeZoom(zoom * 1.2)}
            className="h-6 w-6 rounded text-xs text-emerald-100/70 hover:bg-emerald-300/10"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => {
              viewRef.current.panX = 0;
              viewRef.current.panY = 0;
              changeZoom(1);
            }}
            className="rounded px-1.5 py-1 text-[10px] text-emerald-100/55 hover:bg-emerald-300/10 hover:text-emerald-100"
          >
            Reset
          </button>
        </div>
      </div>
      {renderError && (
        <div role="status" className="absolute inset-x-3 bottom-2 text-[10px] text-rose-300">
          Hyperlane renderer unavailable: {renderError}
        </div>
      )}
    </div>
  );
}

type MetricMode = "p95" | "p50" | "avg" | "count";
type CategoryFilter = "all" | "ai" | "api" | "auth" | "db" | "telemetry" | "wallet" | "admin";

export interface LatencyDeltaMessage {
  type: "LATENCY_DELTA" | "telemetry_update";
  route?: string;
  timestamp?: string;
  latencyMs?: number;
  p95Ms?: number;
  p50Ms?: number;
  avgMs?: number;
  count?: number;
  severity?: LatencySeverity;
  bucketIndex?: number;
}

export function RouteLatencyHeatmap({
  className = "",
  initialRange = "1h",
}: RouteLatencyHeatmapProps) {
  const [range, setRange] = useState<"1h" | "24h" | "7d">(initialRange);
  const [metricMode, setMetricMode] = useState<MetricMode>("p95");
  const [highlightSlowOnly, setHighlightSlowOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState(8);
  const [countdown, setCountdown] = useState(8);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastLiveDeltaAt, setLastLiveDeltaAt] = useState<string | null>(null);

  const [data, setData] = useState<RouteLatencyHeatmapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hovered cell state for tooltips
  const [hoveredCell, setHoveredCell] = useState<{
    cell: RouteHeatmapCell;
    row: RouteHeatmapRow;
    clientX: number;
    clientY: number;
  } | null>(null);

  const fetchId = useRef(0);

  async function fetchHeatmap(selectedRange = range, isBackground = false) {
    const currentId = ++fetchId.current;
    if (!isBackground) setLoading(true);
    else setIsRefreshing(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/admin/system/latency-heatmap?range=${selectedRange}`,
        { cache: "no-store" },
      );

      if (!res.ok) {
        throw new Error(`Failed to load telemetry heatmap (${res.status})`);
      }

      const json: RouteLatencyHeatmapData = await res.json();
      if (currentId === fetchId.current) {
        setData(json);
      }
    } catch (err: any) {
      if (currentId === fetchId.current) {
        setError(err.message || "Failed to load telemetry");
      }
    } finally {
      if (currentId === fetchId.current) {
        setLoading(false);
        setIsRefreshing(false);
        setCountdown(refreshIntervalSec);
      }
    }
  }

  // Live PartySocket WebSocket connection to telemetry broadcast room
  usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
    room: "telemetry-latency-broadcast",
    onOpen() {
      setWsConnected(true);
    },
    onClose() {
      setWsConnected(false);
    },
    onError() {
      setWsConnected(false);
    },
    onMessage(event) {
      try {
        const delta = JSON.parse(event.data) as LatencyDeltaMessage;
        if (!delta || (delta.type !== "LATENCY_DELTA" && delta.type !== "telemetry_update")) {
          return;
        }

        setLastLiveDeltaAt(new Date().toLocaleTimeString());

        setData((prev) => {
          if (!prev || !delta.route) return prev;

          const updatedRoutes = prev.routes.map((routeRow) => {
            if (routeRow.route !== delta.route) return routeRow;

            // Update cells
            const targetCellIndex =
              typeof delta.bucketIndex === "number" &&
              delta.bucketIndex >= 0 &&
              delta.bucketIndex < routeRow.cells.length
                ? delta.bucketIndex
                : routeRow.cells.length - 1; // latest interval cell

            const updatedCells = routeRow.cells.map((cell, idx) => {
              if (idx !== targetCellIndex) return cell;

              const newCount = delta.count ?? cell.count + 1;
              const newP95 = delta.p95Ms ?? delta.latencyMs ?? cell.p95Ms;
              const newP50 = delta.p50Ms ?? (delta.latencyMs ? Math.round(delta.latencyMs * 0.8) : cell.p50Ms);
              const newAvg = delta.avgMs ?? delta.latencyMs ?? cell.avgMs;
              const newSeverity: LatencySeverity =
                delta.severity ??
                (newP95 > 300 ? "critical" : newP95 > 150 ? "high" : newP95 > 80 ? "medium" : "low");

              return {
                ...cell,
                count: newCount,
                p95Ms: newP95,
                p50Ms: newP50,
                avgMs: newAvg,
                severity: newSeverity,
              };
            });

            const overallP95 = delta.p95Ms ?? routeRow.p95Ms;
            const isSlow = overallP95 > 150;

            return {
              ...routeRow,
              cells: updatedCells,
              p95Ms: overallP95,
              avgMs: delta.avgMs ?? routeRow.avgMs,
              totalRequests: routeRow.totalRequests + 1,
              isSlowPath: isSlow,
            };
          });

          return {
            ...prev,
            routes: updatedRoutes,
          };
        });
      } catch {
        // ignore parse errors
      }
    },
  });

  // Initial & range-change fetch
  useEffect(() => {
    fetchHeatmap(range, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  // Auto-refresh timer loop
  useEffect(() => {
    if (!autoRefresh) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          fetchHeatmap(range, true);
          return refreshIntervalSec;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, range, refreshIntervalSec]);

  // Filtered rows based on search, category, and slow paths toggle
  const filteredRows = useMemo(() => {
    if (!data) return [];
    return data.routes.filter((row) => {
      if (highlightSlowOnly && !row.isSlowPath) return false;
      if (selectedCategory !== "all" && row.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesRoute = row.route.toLowerCase().includes(query);
        const matchesName = row.displayName.toLowerCase().includes(query);
        if (!matchesRoute && !matchesName) return false;
      }
      return true;
    });
  }, [data, highlightSlowOnly, selectedCategory, searchQuery]);

  // Helper to get fill color and styling for a latency value
  function getCellColor(cell: RouteHeatmapCell, mode: MetricMode): {
    fill: string;
    text: string;
    border: string;
    glow: string;
  } {
    if (cell.count === 0) {
      return {
        fill: "#18181b", // zinc-900
        text: "text-zinc-600",
        border: "border-zinc-800/40",
        glow: "",
      };
    }

    const value =
      mode === "p95"
        ? cell.p95Ms
        : mode === "p50"
          ? cell.p50Ms
          : mode === "avg"
            ? cell.avgMs
            : cell.count;

    if (mode === "count") {
      // Volume heatmap mode (Cyan intensity)
      const opacity = Math.min(1, Math.max(0.2, cell.count / 80));
      return {
        fill: `rgba(6, 182, 212, ${opacity.toFixed(2)})`,
        text: "text-cyan-200",
        border: "border-cyan-500/30",
        glow: "shadow-[0_0_8px_rgba(6,182,212,0.3)]",
      };
    }

    // Latency heat map modes:
    // < 80ms: Optimal (Emerald)
    // 80 - 150ms: Normal (Cyan)
    // 150 - 300ms: Amber (Elevated Warning)
    // > 300ms: Red (Critical Slow Path)
    if (value < 80) {
      const alpha = 0.25 + (value / 80) * 0.35;
      return {
        fill: `rgba(16, 185, 129, ${alpha.toFixed(2)})`,
        text: "text-emerald-300",
        border: "border-emerald-500/30",
        glow: "",
      };
    } else if (value < 150) {
      const alpha = 0.35 + ((value - 80) / 70) * 0.45;
      return {
        fill: `rgba(6, 182, 212, ${alpha.toFixed(2)})`,
        text: "text-cyan-300",
        border: "border-cyan-500/40",
        glow: "",
      };
    } else if (value < 300) {
      const alpha = 0.55 + ((value - 150) / 150) * 0.35;
      return {
        fill: `rgba(245, 158, 11, ${alpha.toFixed(2)})`,
        text: "text-amber-300",
        border: "border-amber-500/50",
        glow: "shadow-[0_0_12px_rgba(245,158,11,0.4)]",
      };
    } else {
      const alpha = Math.min(0.95, 0.7 + ((value - 300) / 300) * 0.25);
      return {
        fill: `rgba(244, 63, 94, ${alpha.toFixed(2)})`,
        text: "text-rose-200 font-bold",
        border: "border-rose-500/70",
        glow: "shadow-[0_0_14px_rgba(244,63,94,0.6)]",
      };
    }
  }

  function getSeverityBadge(severity: LatencySeverity) {
    switch (severity) {
      case "optimal":
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Optimal (&lt;80ms)
          </span>
        );
      case "normal":
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-400">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            Normal (80-150ms)
          </span>
        );
      case "amber":
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-300 animate-pulse">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
            Slow Path (Amber &gt;150ms)
          </span>
        );
      case "red":
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/50 bg-rose-500/20 px-2 py-0.5 text-[11px] font-bold text-rose-300 animate-bounce">
            <AlertOctagon className="h-3 w-3 text-rose-400" />
            Critical Latency (Red &gt;300ms)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-zinc-400">
            Idle
          </span>
        );
    }
  }

  function getCategoryBadge(category: string) {
    const map: Record<string, { label: string; color: string }> = {
      ai: { label: "AI / LLM", color: "border-purple-500/30 bg-purple-500/10 text-purple-300" },
      api: { label: "REST API", color: "border-blue-500/30 bg-blue-500/10 text-blue-300" },
      auth: { label: "Auth / Passkey", color: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
      db: { label: "Prisma DB", color: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
      telemetry: { label: "Telemetry", color: "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" },
      wallet: { label: "Wallet Pass", color: "border-pink-500/30 bg-pink-500/10 text-pink-300" },
      admin: { label: "Admin Core", color: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300" },
    };

    const c = map[category] || { label: category, color: "border-white/10 bg-white/5 text-zinc-400" };
    return (
      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider border ${c.color}`}>
        {c.label}
      </span>
    );
  }

  return (
    <section
      data-testid="route-latency-heatmap"
      className={`relative overflow-hidden rounded-3xl border border-white/10 bg-[#0d0e15]/80 p-5 md:p-6 backdrop-blur-xl shadow-2xl ${className}`}
    >
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute -left-24 -bottom-24 h-72 w-72 rounded-full bg-rose-500/10 blur-[100px]" />

      {/* Header & Controls */}
      <div className="relative z-10 flex flex-col gap-5 border-b border-white/10 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/20 to-rose-500/20 text-amber-400 shadow-inner">
              <Flame className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-white md:text-2xl">
                  Live Route Latency Heatmap
                </h2>
                <span
                  data-testid="websocket-status-badge"
                  className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    wsConnected
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                  }`}
                >
                  <span className="relative flex h-2 w-2">
                    <span
                      className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                        wsConnected ? "animate-ping bg-emerald-400" : "bg-amber-400"
                      }`}
                    />
                    <span
                      className={`relative inline-flex h-2 w-2 rounded-full ${
                        wsConnected ? "bg-emerald-500" : "bg-amber-500"
                      }`}
                    />
                  </span>
                  {wsConnected ? "WEBSOCKET LIVE" : "CONNECTING..."}
                  {lastLiveDeltaAt && (
                    <span className="hidden text-[10px] text-zinc-400 sm:inline">
                      · {lastLiveDeltaAt}
                    </span>
                  )}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-400 md:text-sm">
                Real-time p95 latency matrix across API routes. Slow paths are highlighted in{" "}
                <span className="font-semibold text-amber-400">Amber (&gt;150ms)</span> and{" "}
                <span className="font-semibold text-rose-400">Red (&gt;300ms)</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Global Action & Range Bar */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Time Range Selector */}
          <div className="flex rounded-2xl border border-white/10 bg-white/[0.03] p-1 shadow-inner">
            {(
              [
                { key: "1h", label: "Live 1h (5m)" },
                { key: "24h", label: "24h (1h)" },
                { key: "7d", label: "7 Days" },
              ] as const
            ).map((item) => (
              <button
                key={item.key}
                onClick={() => setRange(item.key)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                  range === item.key
                    ? "bg-white text-zinc-950 font-semibold shadow-md"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {/* Auto Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            title={autoRefresh ? "Pause Live Stream" : "Resume Live Stream"}
            className={`flex items-center gap-1.5 rounded-2xl border px-3 py-2 text-xs font-medium transition-all ${
              autoRefresh
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-white"
            }`}
          >
            {autoRefresh ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                <span>Live ({countdown}s)</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                <span>Paused</span>
              </>
            )}
          </button>

          {/* Manual Refresh */}
          <button
            onClick={() => fetchHeatmap(range, false)}
            disabled={loading || isRefreshing}
            className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-all hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
            aria-label="Refresh heatmap"
          >
            <RefreshCw
              className={`h-4 w-4 ${loading || isRefreshing ? "animate-spin text-amber-400" : ""}`}
            />
          </button>
        </div>
      </div>

      {/* KPI Summary Tiles */}
      {data && (
        <div className="relative z-10 mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 transition hover:border-white/20">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Monitored Endpoints
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-white">
                {data.summary.totalEndpoints}
              </span>
              <span className="text-xs text-zinc-500">routes</span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 transition hover:border-white/20">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              System p95 Latency
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`font-mono text-2xl font-bold ${
                  data.summary.systemP95Ms > 300
                    ? "text-rose-400"
                    : data.summary.systemP95Ms > 150
                      ? "text-amber-400"
                      : "text-emerald-400"
                }`}
              >
                {data.summary.systemP95Ms}
                <span className="text-sm font-normal text-zinc-400"> ms</span>
              </span>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 transition hover:border-white/20">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              System Avg Latency
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-cyan-300">
                {data.summary.systemAvgMs}
                <span className="text-sm font-normal text-zinc-400"> ms</span>
              </span>
            </div>
          </div>

          <div
            className={`rounded-2xl border p-3.5 transition ${
              data.summary.slowEndpointsCount > 0
                ? "border-amber-500/30 bg-amber-500/[0.06]"
                : "border-white/10 bg-white/[0.02]"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Slow Paths (&gt;150ms)
              </p>
              {data.summary.slowEndpointsCount > 0 && (
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 animate-pulse" />
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span
                className={`font-mono text-2xl font-bold ${
                  data.summary.slowEndpointsCount > 0 ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {data.summary.slowEndpointsCount}
              </span>
              <span className="text-xs text-zinc-500">
                {data.summary.criticalEndpointsCount > 0
                  ? `(${data.summary.criticalEndpointsCount} critical)`
                  : "elevated"}
              </span>
            </div>
          </div>

          <div className="col-span-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 sm:col-span-4 lg:col-span-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
              Sample Volume
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-zinc-200">
                {data.summary.totalRequests.toLocaleString()}
              </span>
              <span className="text-xs text-zinc-500">sampled reqs</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter and Metric Mode Controls */}
      <div className="relative z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Search Box */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search route or endpoint..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-black/40 py-1.5 pl-8 pr-3 text-xs text-zinc-200 placeholder-zinc-500 transition focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
            />
          </div>

          {/* Slow Path Highlight Toggle */}
          <button
            onClick={() => setHighlightSlowOnly(!highlightSlowOnly)}
            data-testid="slow-path-filter-toggle"
            className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
              highlightSlowOnly
                ? "border-amber-500/50 bg-amber-500/20 text-amber-300 shadow-sm"
                : "border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white"
            }`}
          >
            <AlertTriangle className={`h-3.5 w-3.5 ${highlightSlowOnly ? "text-amber-400" : ""}`} />
            <span>Highlight Slow Paths Only</span>
            {data && data.summary.slowEndpointsCount > 0 && (
              <span className="ml-1 rounded-full bg-amber-500/30 px-1.5 py-0.2 text-[10px] font-bold text-amber-200">
                {data.summary.slowEndpointsCount}
              </span>
            )}
          </button>

          {/* Category Filter Pills */}
          <div className="hidden items-center gap-1 xl:flex">
            {(
              [
                { key: "all", label: "All" },
                { key: "ai", label: "AI" },
                { key: "api", label: "API" },
                { key: "auth", label: "Auth" },
                { key: "db", label: "DB" },
                { key: "telemetry", label: "Telemetry" },
              ] as const
            ).map((cat) => (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${
                  selectedCategory === cat.key
                    ? "bg-violet-500/20 text-violet-300 border border-violet-500/30"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metric Mode Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">Metric:</span>
          <div className="flex rounded-xl border border-white/10 bg-black/40 p-0.5">
            {(
              [
                { key: "p95", label: "p95 (Tail)" },
                { key: "p50", label: "p50 (Median)" },
                { key: "avg", label: "Avg" },
                { key: "count", label: "Volume" },
              ] as const
            ).map((m) => (
              <button
                key={m.key}
                onClick={() => setMetricMode(m.key)}
                className={`rounded-lg px-2.5 py-1 text-xs transition-all ${
                  metricMode === m.key
                    ? "bg-amber-500 text-zinc-950 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertOctagon className="h-4 w-4 text-red-400" />
            <span>{error}</span>
          </div>
        </div>
      )}

      <HyperlaneViewport routes={data?.routes ?? []} />

      {/* Main Heatmap Visualization */}
      <div className="relative z-10 mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/40 shadow-inner">
        {loading && !data ? (
          <div className="flex h-96 flex-col items-center justify-center gap-3">
            <RefreshCw className="h-8 w-8 animate-spin text-amber-400" />
            <p className="text-xs text-zinc-400">Synthesizing real-time latency telemetry...</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-zinc-500">
            <Filter className="h-8 w-8 text-zinc-600" />
            <p className="text-sm font-medium">No endpoints match the current filter</p>
            <p className="text-xs text-zinc-600">Try clearing your search query or slow paths filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[760px] p-4">
              {/* Header row: Time bucket columns */}
              <div className="mb-2 grid grid-cols-[240px_repeat(12,_1fr)_90px] items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                <div className="pl-2">Route / Endpoint ({filteredRows.length})</div>
                {data?.timeBuckets.map((bucket) => (
                  <div key={bucket.index} className="truncate text-center font-mono">
                    {bucket.label}
                  </div>
                ))}
                <div className="text-right pr-2">Overall p95</div>
              </div>

              {/* Heatmap rows */}
              <div className="space-y-1.5">
                {filteredRows.map((row) => {
                  const isRowSlow = row.isSlowPath;

                  return (
                    <div
                      key={row.route}
                      className={`group grid grid-cols-[240px_repeat(12,_1fr)_90px] items-center gap-1.5 rounded-xl border p-1.5 transition-all ${
                        isRowSlow
                          ? "border-amber-500/20 bg-amber-500/[0.03] hover:border-amber-500/40 hover:bg-amber-500/[0.06]"
                          : "border-white/[0.04] bg-white/[0.01] hover:border-white/10 hover:bg-white/[0.03]"
                      }`}
                    >
                      {/* Route Metadata Label Column */}
                      <div className="flex flex-col justify-center pr-2 pl-1 min-w-0">
                        <div className="flex items-center gap-1.5 truncate">
                          {isRowSlow && (
                            <span
                              title="Slow Path: p95 >= 150ms"
                              className="flex-shrink-0 text-amber-400"
                            >
                              <Flame className="h-3.5 w-3.5" />
                            </span>
                          )}
                          <span
                            className={`truncate text-xs font-mono font-medium ${
                              isRowSlow ? "text-amber-200" : "text-zinc-200"
                            }`}
                            title={row.route}
                          >
                            {row.route}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          {getCategoryBadge(row.category)}
                          <span className="truncate text-[10px] text-zinc-500">
                            {row.displayName}
                          </span>
                        </div>
                      </div>

                      {/* Heatmap Time Bucket Cells */}
                      {row.cells.map((cell) => {
                        const style = getCellColor(cell, metricMode);
                        const cellVal =
                          metricMode === "p95"
                            ? cell.p95Ms
                            : metricMode === "p50"
                              ? cell.p50Ms
                              : metricMode === "avg"
                                ? cell.avgMs
                                : cell.count;

                        return (
                          <div
                            key={cell.bucketIndex}
                            onMouseEnter={(e) => {
                              const rect = e.currentTarget.getBoundingClientRect();
                              setHoveredCell({
                                cell,
                                row,
                                clientX: rect.left + rect.width / 2,
                                clientY: rect.top,
                              });
                            }}
                            onMouseLeave={() => setHoveredCell(null)}
                            style={{ backgroundColor: style.fill }}
                            className={`relative flex h-9 cursor-pointer items-center justify-center rounded-lg border transition-all duration-150 hover:scale-105 hover:z-20 ${style.border} ${style.glow}`}
                          >
                            <span className={`text-[11px] font-mono select-none ${style.text}`}>
                              {cell.count === 0
                                ? "—"
                                : metricMode === "count"
                                  ? cellVal
                                  : `${cellVal}`}
                            </span>
                          </div>
                        );
                      })}

                      {/* Overall Route p95 Badge */}
                      <div className="flex flex-col items-end pr-1 text-right">
                        <span
                          className={`font-mono text-xs font-bold ${
                            row.overallP95Ms >= 300
                              ? "text-rose-400"
                              : row.overallP95Ms >= 150
                                ? "text-amber-400"
                                : "text-emerald-400"
                          }`}
                        >
                          {row.overallP95Ms} ms
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {row.totalRequests} reqs
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating Tooltip */}
      {hoveredCell && (
        <div
          style={{
            left: `${hoveredCell.clientX}px`,
            top: `${hoveredCell.clientY - 12}px`,
            transform: "translate(-50%, -100%)",
          }}
          className="pointer-events-none fixed z-50 w-72 rounded-2xl border border-white/20 bg-[#12131c]/95 p-3.5 text-white shadow-2xl backdrop-blur-md transition-opacity duration-150"
        >
          <div className="flex items-start justify-between gap-2 border-b border-white/10 pb-2">
            <div>
              <p className="font-mono text-xs font-bold text-zinc-100 truncate">
                {hoveredCell.row.route}
              </p>
              <p className="text-[11px] text-zinc-400">
                {hoveredCell.row.displayName}
              </p>
            </div>
            {getSeverityBadge(hoveredCell.cell.status)}
          </div>

          <div className="mt-2.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-zinc-400">
              <span>Time Window:</span>
              <span className="font-mono font-medium text-zinc-200">
                {hoveredCell.cell.timeLabel}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">p95 Latency:</span>
              <span
                className={`font-mono font-bold ${
                  hoveredCell.cell.p95Ms >= 300
                    ? "text-rose-400"
                    : hoveredCell.cell.p95Ms >= 150
                      ? "text-amber-400"
                      : "text-emerald-400"
                }`}
              >
                {hoveredCell.cell.p95Ms} ms
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>p50 (Median):</span>
              <span className="font-mono text-zinc-200">
                {hoveredCell.cell.p50Ms} ms
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Average Latency:</span>
              <span className="font-mono text-zinc-200">
                {hoveredCell.cell.avgMs} ms
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Latency Range (Min / Max):</span>
              <span className="font-mono text-zinc-300">
                {hoveredCell.cell.minMs}ms – {hoveredCell.cell.maxMs}ms
              </span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>Sampled Requests:</span>
              <span className="font-mono text-cyan-300">
                {hoveredCell.cell.count} reqs
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Heatmap Legend & Color Scale Guide */}
      <div className="relative z-10 mt-5 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-4 text-xs text-zinc-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium text-zinc-300">Latency Spectrum:</span>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded bg-emerald-500/40 border border-emerald-500/50" />
            <span className="text-[11px]">&lt; 80ms (Optimal)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded bg-cyan-500/50 border border-cyan-500/60" />
            <span className="text-[11px]">80 - 150ms (Normal)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded bg-amber-500/70 border border-amber-500/80 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
            <span className="text-[11px] font-semibold text-amber-300">
              150 - 300ms (Amber Slow)
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-5 rounded bg-rose-500/80 border border-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]" />
            <span className="text-[11px] font-bold text-rose-300">
              &gt; 300ms (Critical Red)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          <Info className="h-3.5 w-3.5" />
          <span>Tail p95 reflects the 95th percentile worst response latency in that time bucket.</span>
        </div>
      </div>
    </section>
  );
}
