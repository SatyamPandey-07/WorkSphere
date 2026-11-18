"use client";

import React, { Component, ReactNode, ErrorInfo } from "react";
import { RefreshCw, AlertTriangle, Activity } from "lucide-react";

export interface CanvasMetric {
  label: string;
  value: string | number;
  unit?: string;
}

export type CanvasMetricsInput =
  | CanvasMetric[]
  | Record<string, string | number>;

export interface Canvas2DFallbackProps {
  title?: string;
  description?: string;
  metrics?: CanvasMetricsInput;
  isContextLost?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  className?: string;
  testId?: string;
}

/**
 * Normalizes metrics input into an array of CanvasMetric objects.
 */
function normalizeMetrics(input?: CanvasMetricsInput): CanvasMetric[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  return Object.entries(input).map(([label, value]) => ({
    label,
    value,
  }));
}

/**
 * Accessible, lightweight 2D SVG fallback UI preserving essential metrics.
 */
export function Canvas2DFallback({
  title,
  description,
  metrics,
  isContextLost = false,
  error,
  onRetry,
  className = "",
  testId = "canvas-2d-fallback",
}: Canvas2DFallbackProps) {
  const normalizedMetrics = normalizeMetrics(metrics);
  const displayTitle =
    title || (isContextLost ? "WebGL Context Lost" : "3D View Unavailable");
  const displayDesc =
    description ||
    (isContextLost
      ? "The graphics context was lost or reclaimed by the GPU. Preserving metrics in 2D mode."
      : error?.message ||
        "WebGL acceleration could not be initialized. Operating in lightweight 2D fallback mode.");

  return (
    <div
      role="region"
      aria-label="3D Canvas Fallback View"
      aria-live="polite"
      data-testid={testId}
      className={`relative w-full h-full min-h-[300px] flex flex-col items-center justify-center p-6 bg-zinc-950/95 border border-zinc-800 rounded-3xl text-zinc-100 overflow-hidden select-none ${className}`}
    >
      {/* Background Ambient SVG Grid */}
      <svg
        aria-hidden="true"
        className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="canvas-fallback-grid"
            width="32"
            height="32"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 32 0 L 0 0 0 32"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#canvas-fallback-grid)" />
      </svg>

      {/* Decorative Radial Glow */}
      <div
        aria-hidden="true"
        className={`absolute w-72 h-72 rounded-full blur-3xl pointer-events-none opacity-25 transition-colors duration-700 ${
          isContextLost ? "bg-amber-500" : "bg-cyan-500"
        }`}
      />

      {/* 2D Isometric Wireframe Vector Illustration */}
      <div className="relative z-10 mb-3" aria-hidden="true">
        <svg
          viewBox="0 0 160 120"
          className="w-36 h-28 sm:w-44 sm:h-32 text-cyan-400 drop-shadow-[0_0_15px_rgba(6,182,212,0.35)]"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          data-testid="canvas-fallback-svg"
        >
          <defs>
            <linearGradient id="wireframe-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" />
            </linearGradient>
          </defs>

          {/* Isometric Bounding Grid Base */}
          <polygon
            points="80,20 140,50 80,80 20,50"
            stroke="url(#wireframe-grad)"
            strokeWidth="1.5"
            strokeDasharray="4 2"
            fill="rgba(56, 189, 248, 0.05)"
          />

          {/* Lower Extrusion */}
          <polygon
            points="80,50 140,80 80,110 20,80"
            stroke="url(#wireframe-grad)"
            strokeWidth="1.5"
            fill="rgba(14, 165, 233, 0.08)"
          />

          {/* Isometric Vertical Pillars */}
          <line x1="20" y1="50" x2="20" y2="80" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="140" y1="50" x2="140" y2="80" stroke="#38bdf8" strokeWidth="1.5" />
          <line x1="80" y1="80" x2="80" y2="110" stroke="#38bdf8" strokeWidth="1.5" />

          {/* Floating Central Node / Core */}
          <circle cx="80" cy="50" r="14" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />
          <circle cx="80" cy="50" r="6" fill="#38bdf8" className="animate-pulse" />

          {/* Axis Reticle Marks */}
          <circle cx="20" cy="50" r="3" fill="#38bdf8" />
          <circle cx="140" cy="50" r="3" fill="#38bdf8" />
          <circle cx="80" cy="20" r="3" fill="#38bdf8" />
          <circle cx="80" cy="110" r="3" fill="#38bdf8" />
        </svg>
      </div>

      {/* Header & Status */}
      <div className="relative z-10 text-center max-w-md space-y-1.5">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-950/60 border border-cyan-500/30 text-cyan-400 text-[11px] font-mono tracking-wider font-semibold uppercase">
          {isContextLost ? (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
          )}
          <span>{isContextLost ? "GPU Context Interrupted" : "2D Fallback Mode"}</span>
        </div>

        <h3
          data-testid="canvas-fallback-title"
          className="text-base sm:text-lg font-bold font-mono tracking-tight text-white"
        >
          {displayTitle}
        </h3>

        <p
          data-testid="canvas-fallback-description"
          className="text-xs text-zinc-400 font-mono leading-relaxed px-4"
        >
          {displayDesc}
        </p>
      </div>

      {/* Preserved Essential Metrics */}
      {normalizedMetrics.length > 0 && (
        <div
          data-testid="canvas-fallback-metrics"
          className="relative z-10 grid grid-cols-2 sm:grid-cols-3 gap-2.5 w-full max-w-sm sm:max-w-md my-4"
        >
          {normalizedMetrics.map((metric, idx) => (
            <div
              key={idx}
              data-testid={`canvas-metric-${idx}`}
              className="flex flex-col items-center justify-center p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800/80 text-center shadow-inner"
            >
              <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                {metric.label}
              </span>
              <span className="text-sm font-bold font-mono text-cyan-400 mt-0.5">
                {metric.value}
                {metric.unit ? ` ${metric.unit}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Recovery Button */}
      {onRetry && (
        <div className="relative z-10 pt-2">
          <button
            type="button"
            onClick={onRetry}
            data-testid="retry-canvas-button"
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold font-mono tracking-wide rounded-xl bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white transition-all shadow-lg shadow-cyan-600/25 cursor-pointer"
            aria-label="Retry 3D View"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin-hover" />
            <span>Retry 3D View</span>
          </button>
        </div>
      )}
    </div>
  );
}

export interface CanvasErrorBoundaryProps {
  children: ReactNode;
  fallback?:
    | ReactNode
    | ((error: Error | null, retry: () => void) => ReactNode);
  metrics?: CanvasMetricsInput;
  title?: string;
  description?: string;
  className?: string;
  onError?: (error: Error, errorInfo?: ErrorInfo) => void;
  onContextLost?: (event: Event) => void;
  onRetry?: () => void;
  testId?: string;
}

export interface CanvasErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  isContextLost: boolean;
  retryKey: number;
}

/**
 * Dedicated ErrorBoundary for WebGL canvas and 3D components.
 * Catches WebGL initialization errors and webglcontextlost events, renders
 * an accessible 2D SVG fallback preserving essential metrics, and provides
 * a "Retry 3D View" recovery button that re-mounts the canvas.
 */
export class CanvasErrorBoundary extends Component<
  CanvasErrorBoundaryProps,
  CanvasErrorBoundaryState
> {
  private containerRef = React.createRef<HTMLDivElement>();

  state: CanvasErrorBoundaryState = {
    hasError: false,
    error: null,
    isContextLost: false,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: Error): Partial<CanvasErrorBoundaryState> {
    const isContextLost =
      error?.message?.toLowerCase().includes("context lost") ||
      error?.message?.toLowerCase().includes("contextlost") ||
      false;

    return {
      hasError: true,
      error,
      isContextLost,
    };
  }

  componentDidMount() {
    this.attachContextLostListener();
  }

  componentWillUnmount() {
    this.detachContextLostListener();
  }

  private handleContextLost = (event: Event) => {
    // Prevent the default browser behavior of disabling the WebGL context
    event.preventDefault();
    const error = new Error("WebGL context was lost or reclaimed by the GPU.");
    this.setState({
      hasError: true,
      error,
      isContextLost: true,
    });
    this.props.onContextLost?.(event);
    this.props.onError?.(error);
  };

  private attachContextLostListener() {
    if (typeof window !== "undefined") {
      const el = this.containerRef.current;
      if (el) {
        el.addEventListener("webglcontextlost", this.handleContextLost, true);
      }
    }
  }

  private detachContextLostListener() {
    if (typeof window !== "undefined") {
      const el = this.containerRef.current;
      if (el) {
        el.removeEventListener(
          "webglcontextlost",
          this.handleContextLost,
          true,
        );
      }
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.warn("CanvasErrorBoundary caught WebGL initialization/render error:", error, errorInfo);
    const isContextLost =
      error?.message?.toLowerCase().includes("context lost") ||
      error?.message?.toLowerCase().includes("contextlost") ||
      false;

    this.setState({
      hasError: true,
      error,
      isContextLost,
    });
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.props.onRetry?.();
    this.setState((prev) => ({
      hasError: false,
      error: null,
      isContextLost: false,
      retryKey: prev.retryKey + 1,
    }));
  };

  render(): ReactNode {
    const {
      children,
      fallback,
      metrics,
      title,
      description,
      className,
      testId = "canvas-error-boundary",
    } = this.props;

    const { hasError, error, isContextLost, retryKey } = this.state;

    return (
      <div
        ref={this.containerRef}
        data-testid={testId}
        className={className || "relative w-full h-full"}
      >
        {hasError ? (
          typeof fallback === "function" ? (
            fallback(error, this.handleRetry)
          ) : fallback ? (
            fallback
          ) : (
            <Canvas2DFallback
              title={title}
              description={description}
              metrics={metrics}
              isContextLost={isContextLost}
              error={error}
              onRetry={this.handleRetry}
              className={className}
            />
          )
        ) : (
          <React.Fragment key={retryKey}>{children}</React.Fragment>
        )}
      </div>
    );
  }
}

/**
 * HOC to wrap any canvas or 3D view component with CanvasErrorBoundary.
 */
export function withCanvasErrorBoundary<P extends object>(
  ComponentToWrap: React.ComponentType<P>,
  errorBoundaryProps?: Omit<CanvasErrorBoundaryProps, "children">,
) {
  return function WithCanvasErrorBoundary(props: P) {
    return (
      <CanvasErrorBoundary {...errorBoundaryProps}>
        <ComponentToWrap {...props} />
      </CanvasErrorBoundary>
    );
  };
}

export default CanvasErrorBoundary;
