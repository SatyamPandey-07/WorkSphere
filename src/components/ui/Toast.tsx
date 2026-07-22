"use client";

import {
  useState,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import { X, CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  toast: (
    message: string,
    type?: ToastType,
    action?: { label: string; onClick: () => void },
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

  const addToast = useCallback(
    (
      message: string,
      type: ToastType = "success",
      action?: { label: string; onClick: () => void },
    ) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev, { id, message, type, action }]);
    },
    [],
  );

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast: addToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

function ToastContainer({
  toasts,
  onRemove,
}: {
  toasts: Toast[];
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onRemove,
}: {
  toast: Toast;
  onRemove: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onRemove(toast.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast.id, onRemove]);

  const Icon =
    toast.type === "success"
      ? CheckCircle2
      : toast.type === "error"
        ? AlertCircle
        : AlertTriangle;
  const iconColor =
    toast.type === "success"
      ? "text-green-500"
      : toast.type === "error"
        ? "text-red-500"
        : "text-amber-500";

  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-md min-w-[280px] max-w-[380px]",
        "bg-white/90 dark:bg-zinc-900/90 border-zinc-200 dark:border-zinc-800",
        "animate-in slide-in-from-right-full fade-in duration-300",
      )}
    >
      <Icon className={cn("w-4 h-4 shrink-0", iconColor)} aria-hidden="true" />
      <div className="flex-1 flex flex-col items-start text-sm text-zinc-700 dark:text-zinc-300">
        <span className="font-medium">{toast.message}</span>
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action!.onClick();
              onRemove(toast.id);
            }}
            className="mt-1.5 px-3 py-1 bg-[var(--primary-accent)] hover:opacity-90 active:scale-95 text-white rounded-md text-[11px] font-bold uppercase tracking-wider transition-all"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={() => onRemove(toast.id)}
        className="shrink-0 p-1 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label="Dismiss notification"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
