"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastType = "success" | "error" | "warning" | "info";
export type ToastVariant = "default" | "hud";

export interface ToastOptions {
  id?: string;
  key?: string;
  countdown?: number;
  duration?: number;
  action?: { label: string; onClick: () => void };
  variant?: ToastVariant;
  timestamp?: string;
}

export interface Toast {
  id: string;
  key?: string;
  message: string;
  type: ToastType;
  variant?: ToastVariant;
  timestamp?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  countdown?: number;
  duration?: number;
  updatedAt?: number;
}

export interface ToastContextValue {
  toast: (
    message: string,
    type?: ToastType,
    actionOrOptions?: { label: string; onClick: () => void } | ToastOptions,
    countdown?: number,
    idOrKey?: string,
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toast: () => {},
    };
  }
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const recentMessagesRef = useRef<Map<string, number>>(new Map());

  const addToast = useCallback(
    (
      message: string,
      type: ToastType = "success",
      actionOrOptions?: { label: string; onClick: () => void } | ToastOptions,
      countdown?: number,
      idOrKey?: string,
    ) => {
      let action: { label: string; onClick: () => void } | undefined;
      let effectiveCountdown = countdown;
      let effectiveDuration: number | undefined;
      let toastKey: string | undefined = idOrKey;
      let variant: ToastVariant = "default";
      let timestamp: string | undefined;

      if (actionOrOptions) {
        if ("onClick" in actionOrOptions && "label" in actionOrOptions) {
          action = actionOrOptions as { label: string; onClick: () => void };
        } else {
          const opts = actionOrOptions as ToastOptions;
          if (opts.action) action = opts.action;
          if (opts.countdown !== undefined) effectiveCountdown = opts.countdown;
          if (opts.duration !== undefined) effectiveDuration = opts.duration;
          if (opts.variant) variant = opts.variant;
          if (opts.timestamp) timestamp = opts.timestamp;
          if (opts.id) toastKey = opts.id;
          else if (opts.key) toastKey = opts.key;
        }
      }

      const now = Date.now();
      const effectiveTimestamp =
        timestamp ||
        new Date().toLocaleTimeString(undefined, {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

      // If a toastKey or id is provided, deduplicate and update existing toast in-place
      if (toastKey) {
        setToasts((prev) => {
          const existingIndex = prev.findIndex(
            (t) => t.id === toastKey || t.key === toastKey,
          );
          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              message,
              type,
              variant: variant !== "default" ? variant : updated[existingIndex].variant,
              timestamp: effectiveTimestamp,
              action: action ?? updated[existingIndex].action,
              countdown:
                effectiveCountdown !== undefined
                  ? effectiveCountdown
                  : updated[existingIndex].countdown,
              duration:
                effectiveDuration !== undefined
                  ? effectiveDuration
                  : updated[existingIndex].duration,
              key: toastKey,
              updatedAt: now,
            };
            return updated;
          }
          return [
            ...prev,
            {
              id: toastKey,
              key: toastKey,
              message,
              type,
              variant,
              timestamp: effectiveTimestamp,
              action,
              countdown: effectiveCountdown,
              duration: effectiveDuration,
              updatedAt: now,
            },
          ];
        });
        return;
      }

      const lastSeen = recentMessagesRef.current.get(message);
      if (
        effectiveCountdown === undefined &&
        lastSeen &&
        now - lastSeen < 3000
      ) {
        return; // Suppress duplicate toast dispatch within 3-second window (#1748)
      }
      recentMessagesRef.current.set(message, now);
      for (const [key, seenAt] of recentMessagesRef.current) {
        if (now - seenAt > 3000) recentMessagesRef.current.delete(key);
      }
      while (recentMessagesRef.current.size > 50) {
        const oldest = recentMessagesRef.current.keys().next().value;
        if (oldest === undefined) break;
        recentMessagesRef.current.delete(oldest);
      }

      const id =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${now}-${Math.random().toString(36).slice(2, 9)}-${recentMessagesRef.current.size}`;

      setToasts((prev) => {
        if (
          effectiveCountdown !== undefined &&
          message.includes("Rate limit")
        ) {
          const existingIndex = prev.findIndex(
            (t) =>
              t.countdown !== undefined && t.message.includes("Rate limit"),
          );
          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = {
              ...updated[existingIndex],
              message,
              countdown: Math.max(
                updated[existingIndex].countdown || 0,
                effectiveCountdown,
              ),
              updatedAt: now,
            };
            return updated;
          }
        }
        return [
          ...prev,
          {
            id,
            message,
            type,
            variant,
            timestamp: effectiveTimestamp,
            action,
            countdown: effectiveCountdown,
            duration: effectiveDuration,
            updatedAt: now,
          },
        ];
      });
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const handleRateLimit = (e: Event) => {
      const customEvent = e as CustomEvent<{
        retryAfter: number;
        endpoint: string;
        willRetry?: boolean;
      }>;
      const retryAfter = customEvent.detail?.retryAfter || 60;
      addToast(
        customEvent.detail?.willRetry
          ? "Rate limit reached. Retrying automatically in {countdown} seconds"
          : "Rate limit reached. Try again in {countdown} seconds",
        "error",
        undefined,
        retryAfter,
      );
    };

    if (typeof window !== "undefined") {
      window.addEventListener("rate-limit-triggered", handleRateLimit);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("rate-limit-triggered", handleRateLimit);
      }
    };
  }, [addToast]);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

/**
 * Critical errors are announced assertively. Countdown toasts (e.g. rate
 * limits) stay polite so the per-second text updates don't keep interrupting
 * the screen reader.
 */
function isAssertive(toast: Toast): boolean {
  return toast.type === "error" && toast.countdown === undefined;
}

function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  // Both live regions stay mounted even when empty so assistive tech is
  // already observing them when a toast is inserted (WCAG 2.1 SC 4.1.3).
  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-label="Notifications"
    >
      <div
        className="flex flex-col gap-2"
        aria-live="assertive"
        aria-relevant="additions text"
        data-testid="toast-region-assertive"
      >
        {toasts.filter(isAssertive).map((t) => (
          <ToastItem key={t.id} toast={t} onRemove={onRemove} />
        ))}
      </div>
      <div
        className="flex flex-col gap-2"
        aria-live="polite"
        aria-relevant="additions text"
        data-testid="toast-region-polite"
      >
        {toasts
          .filter((t) => !isAssertive(t))
          .map((t) => (
            <ToastItem key={t.id} toast={t} onRemove={onRemove} />
          ))}
      </div>
    </div>
  );
}

/** Default auto-dismiss timeout in milliseconds. */
const TOAST_DURATION_MS = 4000;
/** Default auto-dismiss timeout for warning and info toasts (5 seconds). */
const WARNING_TOAST_DURATION_MS = 5000;

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  const [countdown, setCountdown] = useState<number | undefined>(
    toast.countdown,
  );

  // Track pointer over and focus within separately as suggested by CodeRabbit
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [isFocusedWithin, setIsFocusedWithin] = useState(false);
  const isInteracting = isPointerOver || isFocusedWithin;

  // Count down against a fixed deadline rather than decrementing, so the
  // number stays accurate when timers are throttled in background tabs (#1732).
  const deadlineRef = useRef<number | null>(null);

  useEffect(() => {
    if (toast.countdown === undefined) return;
    deadlineRef.current = Date.now() + toast.countdown * 1000;
    setCountdown(toast.countdown);
  }, [toast.countdown, toast.updatedAt]);

  useEffect(() => {
    if (countdown === undefined) return;
    if (countdown <= 0) {
      onRemove(toast.id);
      return;
    }
    const timer = setInterval(() => {
      const deadline = deadlineRef.current;
      setCountdown((prev) =>
        deadline === null
          ? prev !== undefined
            ? prev - 1
            : undefined
          : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown, toast.id, onRemove]);

  useEffect(() => {
    if (toast.countdown !== undefined) return;
    if (isInteracting) return;

    const duration =
      toast.duration !== undefined
        ? toast.duration
        : toast.type === "warning" || toast.type === "info"
          ? WARNING_TOAST_DURATION_MS
          : TOAST_DURATION_MS;

    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, duration);

    return () => clearTimeout(timer);
  }, [
    toast.id,
    onRemove,
    toast.countdown,
    toast.duration,
    isInteracting,
    toast.updatedAt,
    toast.message,
    toast.type,
  ]);

  const Icon =
    toast.type === "success"
      ? CheckCircle2
      : toast.type === "error"
        ? AlertCircle
        : toast.type === "info"
          ? Info
          : AlertTriangle;
  const iconColor =
    toast.type === "success"
      ? "text-green-500"
      : toast.type === "error"
        ? "text-red-500"
        : toast.type === "info"
          ? "text-blue-500"
          : "text-amber-500";

  const displayMessage =
    countdown !== undefined
      ? toast.message
          .replace("{countdown}", String(countdown))
          // Singular only for exactly 1 — "11 seconds" must stay plural.
          .replace(/(^|\D)1 seconds\b/, (_, before) => `${before}1 second`)
      : toast.message;

  const assertive = isAssertive(toast);
  const isHud = toast.variant === "hud";

  return (
    <div
      role={assertive ? "alert" : "status"}
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      data-testid={isHud ? "tactical-hud-toast" : "toast-item"}
      data-variant={toast.variant || "default"}
      className={cn(
        "pointer-events-auto flex items-center gap-3 px-4 py-3 shadow-lg backdrop-blur-md min-w-[280px] max-w-[400px]",
        "animate-in slide-in-from-right-full fade-in duration-300",
        isHud
          ? "relative rounded-md border border-emerald-500/40 bg-zinc-950/95 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.25)] font-mono"
          : "rounded-xl border bg-white/90 dark:bg-zinc-900/90 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300",
      )}
      onMouseEnter={() => setIsPointerOver(true)}
      onMouseLeave={() => setIsPointerOver(false)}
      onFocus={() => setIsFocusedWithin(true)}
      onBlur={(e) => {
        // If the new focus target is still inside this toast, don't clear the focus state
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setIsFocusedWithin(false);
        }
      }}
    >
      {/* Tactical corner brackets for HUD appearance (⌜ ⌝ ⌞ ⌟) */}
      {isHud && (
        <>
          <span
            className="absolute top-0.5 left-1 font-mono text-emerald-400 text-xs select-none pointer-events-none"
            aria-hidden="true"
          >
            ⌜
          </span>
          <span
            className="absolute top-0.5 right-1 font-mono text-emerald-400 text-xs select-none pointer-events-none"
            aria-hidden="true"
          >
            ⌝
          </span>
          <span
            className="absolute bottom-0.5 left-1 font-mono text-emerald-400 text-xs select-none pointer-events-none"
            aria-hidden="true"
          >
            ⌞
          </span>
          <span
            className="absolute bottom-0.5 right-1 font-mono text-emerald-400 text-xs select-none pointer-events-none"
            aria-hidden="true"
          >
            ⌟
          </span>
        </>
      )}

      {/* Status indicator: Emerald pulsating energy dot for HUD, Lucide icon for standard */}
      {isHud ? (
        <span
          className="relative flex h-2.5 w-2.5 shrink-0"
          aria-hidden="true"
          data-testid="hud-emerald-status-dot"
        >
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_#10b981]" />
        </span>
      ) : (
        <Icon className={cn("w-4 h-4 shrink-0", iconColor)} aria-hidden="true" />
      )}

      <div className={cn("flex-1 flex flex-col items-start text-sm", isHud ? "text-emerald-300" : "text-zinc-700 dark:text-zinc-300")}>
        <div className="flex items-center flex-wrap gap-1 font-medium">
          {isHud && toast.timestamp && (
            <span
              className="text-[11px] font-mono text-emerald-400 font-bold tracking-wider select-none"
              aria-hidden="true"
              data-testid="hud-telemetry-timestamp"
            >
              [{toast.timestamp}]
            </span>
          )}
          <span>{displayMessage}</span>
        </div>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick();
              onRemove(toast.id);
            }}
            className={cn(
              "mt-1.5 px-3 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all",
              isHud
                ? "bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-zinc-950 border border-emerald-400/40"
                : "bg-[var(--primary-accent)] hover:opacity-90 active:scale-95 text-white",
            )}
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className={cn(
          "shrink-0 p-1 rounded-lg transition-colors",
          isHud
            ? "text-emerald-400/70 hover:text-emerald-200 hover:bg-emerald-950/60"
            : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800",
        )}
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export interface TacticalHUDToastProps {
  message: string;
  timestamp?: string;
  type?: ToastType;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  className?: string;
}

/**
 * TacticalHUDToast: Dedicated collimated fighter jet HUD advisory notification component
 * with tactical corner brackets (⌜ ⌝ ⌞ ⌟), glowing emerald power dot, and telemetry timestamp.
 */
export function TacticalHUDToast({
  message,
  timestamp,
  type = "info",
  action,
  onDismiss,
  className = "",
}: TacticalHUDToastProps) {
  const currentTimestamp =
    timestamp ||
    new Date().toLocaleTimeString(undefined, {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="tactical-hud-toast"
      data-variant="hud"
      className={cn(
        "relative pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-md border shadow-[0_0_20px_rgba(16,185,129,0.25)] backdrop-blur-md min-w-[280px] max-w-[420px]",
        "bg-zinc-950/95 border-emerald-500/40 text-emerald-300 font-mono",
        className,
      )}
    >
      {/* Corner brackets */}
      <span className="absolute top-0.5 left-1 font-mono text-emerald-400 text-xs select-none pointer-events-none" aria-hidden="true">⌜</span>
      <span className="absolute top-0.5 right-1 font-mono text-emerald-400 text-xs select-none pointer-events-none" aria-hidden="true">⌝</span>
      <span className="absolute bottom-0.5 left-1 font-mono text-emerald-400 text-xs select-none pointer-events-none" aria-hidden="true">⌞</span>
      <span className="absolute bottom-0.5 right-1 font-mono text-emerald-400 text-xs select-none pointer-events-none" aria-hidden="true">⌟</span>

      {/* Emerald status dot */}
      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true" data-testid="hud-emerald-status-dot">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 shadow-[0_0_8px_#10b981]" />
      </span>

      <div className="flex-1 flex flex-col items-start text-sm text-emerald-300">
        <div className="flex items-center flex-wrap gap-1 font-medium">
          <span className="text-[11px] font-mono text-emerald-400 font-bold tracking-wider select-none" aria-hidden="true" data-testid="hud-telemetry-timestamp">
            [{currentTimestamp}]
          </span>
          <span>{message}</span>
        </div>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="mt-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-zinc-950 rounded text-[11px] font-bold uppercase tracking-wider transition-all border border-emerald-400/40"
          >
            {action.label}
          </button>
        )}
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 rounded text-emerald-400/70 hover:text-emerald-200 hover:bg-emerald-950/60 transition-colors"
          aria-label="Dismiss notification"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
