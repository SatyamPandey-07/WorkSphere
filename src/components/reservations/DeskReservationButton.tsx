"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DeskReservationButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onError"> {
  /** Target workspace or venue identifier */
  venueId: string;
  /** Desk or seat identifier to place a reservation hold on */
  deskId: string;
  /** Optional human-readable desk or seat title */
  deskName?: string;
  /** Countdown hold duration in seconds (default: 300) */
  ttlSeconds?: number;
  /** Whether the desk is currently held by the user */
  isHeld?: boolean;
  /** Custom async hold request handler (receives deskId and abort signal) */
  onHold?: (deskId: string, signal: AbortSignal) => Promise<any>;
  /** Callback fired upon successful acquisition of desk hold lock */
  onHoldSuccess?: (data: {
    success: boolean;
    expiresAt?: number;
    remainingSeconds?: number;
    [key: string]: any;
  }) => void;
  /** Callback fired if hold request encounters an error (excluding aborts) */
  onHoldError?: (error: Error | { error: string }) => void;
  /** Button visual style variant */
  variant?: "primary" | "secondary" | "outline" | "compact";
  /** Button sizing */
  size?: "sm" | "md" | "lg";
  /** Custom text to display while hold request is resolving */
  loadingText?: string;
  /** Custom class name string */
  className?: string;
  "data-testid"?: string;
}

/**
 * DeskReservationButton
 *
 * Prevents duplicate hold requests during rapid double-click interactions
 * by locking in-flight requests synchronously, disabling the button immediately,
 * displaying a spinning loader icon, and leveraging AbortController to cleanly
 * cancel prior in-flight hold requests if the user switches to another desk.
 */
export function DeskReservationButton({
  venueId,
  deskId,
  deskName,
  ttlSeconds = 300,
  isHeld = false,
  onHold,
  onHoldSuccess,
  onHoldError,
  variant = "primary",
  size = "md",
  loadingText = "Holding Desk...",
  className,
  disabled = false,
  children,
  onClick,
  "data-testid": dataTestId = "desk-reservation-button",
  ...props
}: DeskReservationButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Synchronous lock ref to block concurrent double-click events before React re-render
  const isSubmittingRef = useRef(false);
  // AbortController ref to abort prior pending hold requests on seat changes or unmount
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track previous deskId to automatically abort pending hold when seat changes
  const prevDeskIdRef = useRef(deskId);

  // Abort in-flight hold request if user selects a different desk/seat
  useEffect(() => {
    if (prevDeskIdRef.current !== deskId) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort("Seat selection changed");
        abortControllerRef.current = null;
      }
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setLastError(null);
      prevDeskIdRef.current = deskId;
    }
  }, [deskId]);

  // Clean up any pending hold request on component unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort("Component unmounted");
        abortControllerRef.current = null;
      }
    };
  }, []);

  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      // 1. Immediately block rapid subsequent clicks (in-flight request lock)
      if (isSubmittingRef.current || isSubmitting || disabled || isHeld) {
        event.preventDefault();
        return;
      }

      // 2. Lock synchronously before any async execution
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setLastError(null);

      // 3. Abort any previous pending controller
      if (abortControllerRef.current) {
        abortControllerRef.current.abort("New hold request started");
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        onClick?.(event);

        let data: any;
        if (onHold) {
          data = await onHold(deskId, controller.signal);
        } else {
          const res = await fetch("/api/reservations/desk/hold", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              venueId,
              deskId,
              ttlSeconds,
            }),
            signal: controller.signal,
          });

          data = await res.json().catch(() => ({}));

          if (!res.ok || data.success === false) {
            throw new Error(data.error || `Hold request failed with status ${res.status}`);
          }
        }

        // Only process success if this request was not superseded/aborted
        if (!controller.signal.aborted) {
          onHoldSuccess?.(data || { success: true });
        }
      } catch (err: any) {
        // Gracefully ignore AbortError when request was deliberately cancelled
        if (err?.name === "AbortError" || controller.signal.aborted) {
          return;
        }

        const errorMessage = err?.message || "Failed to reserve desk hold";
        setLastError(errorMessage);
        onHoldError?.(err instanceof Error ? err : { error: errorMessage });
      } finally {
        // Release lock only if this controller is still the active one
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
          isSubmittingRef.current = false;
          setIsSubmitting(false);
        }
      }
    },
    [
      isSubmitting,
      disabled,
      isHeld,
      onClick,
      onHold,
      deskId,
      venueId,
      ttlSeconds,
      onHoldSuccess,
      onHoldError,
    ],
  );

  // Variant styling classes
  const variantStyles = {
    primary:
      "bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm border border-blue-600",
    secondary:
      "bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 text-zinc-100 border border-zinc-700",
    outline:
      "bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800/80 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700",
    compact:
      "bg-blue-600/10 hover:bg-blue-600/20 text-blue-600 dark:text-blue-400 border border-blue-500/20",
  }[variant];

  // Size styling classes
  const sizeStyles = {
    sm: "px-3 py-1.5 text-xs rounded-lg gap-1.5 min-h-[36px]",
    md: "px-4 py-2 text-sm rounded-xl gap-2 min-h-[44px]",
    lg: "px-5 py-2.5 text-base rounded-2xl gap-2.5 min-h-[48px]",
  }[size];

  const isDisabled = disabled || isSubmitting || isHeld;

  return (
    <button
      type="button"
      data-testid={dataTestId}
      disabled={isDisabled}
      aria-busy={isSubmitting}
      aria-disabled={isDisabled}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center justify-center font-semibold select-none transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        variantStyles,
        sizeStyles,
        isHeld && "bg-emerald-600/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
        className,
      )}
      {...props}
    >
      {isSubmitting ? (
        <>
          <Loader2
            className="w-4 h-4 animate-spin shrink-0"
            data-testid="desk-reservation-spinner"
            role="status"
            aria-label="Resolving hold request"
          />
          <span>{loadingText}</span>
        </>
      ) : isHeld ? (
        <>
          <CheckCircle2
            className="w-4 h-4 text-emerald-500 shrink-0"
            data-testid="desk-reservation-held-icon"
          />
          <span>{children || "Desk Held"}</span>
        </>
      ) : (
        <>
          <Clock className="w-4 h-4 shrink-0 text-current" />
          <span>{children || (deskName ? `Hold ${deskName}` : "Hold Desk")}</span>
        </>
      )}
    </button>
  );
}

export default DeskReservationButton;
