"use client";

import React, { useState, useCallback, useRef } from "react";
import { CheckCircle2, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

export interface VenueCheckInButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onError"> {
  venueId?: string;
  venueName?: string;
  reservationId?: string;
  deskId?: string;
  isCheckedIn?: boolean;
  initialCheckedIn?: boolean;
  onCheckIn?: () => Promise<boolean | void> | boolean | void;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
  variant?: "default" | "outline" | "compact";
  size?: "sm" | "md" | "lg";
  enableHaptics?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * VenueCheckInButton
 *
 * Renders an accessible button allowing remote nomads to check in to a venue
 * or unlock their reserved desk. Triggers native haptic vibration feedback on
 * successful check-in with graceful degradation on desktop or unsupported devices.
 */
export function VenueCheckInButton({
  venueId,
  venueName = "Workspace",
  reservationId,
  deskId,
  isCheckedIn: isCheckedInProp,
  initialCheckedIn = false,
  onCheckIn,
  onSuccess,
  onError,
  variant = "default",
  size = "md",
  enableHaptics = true,
  className,
  disabled = false,
  children,
  onClick,
  "data-testid": dataTestId = "venue-check-in-button",
  ...props
}: VenueCheckInButtonProps) {
  const [internalCheckedIn, setInternalCheckedIn] = useState(initialCheckedIn);
  const [isCheckingIn, setIsCheckingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { triggerSuccess, triggerError } = useHapticFeedback({
    enabled: enableHaptics,
  });

  const checkedIn = isCheckedInProp !== undefined ? isCheckedInProp : internalCheckedIn;
  const isOperatingRef = useRef(false);

  const handleCheckIn = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (disabled || isCheckingIn || checkedIn || isOperatingRef.current) {
        return;
      }

      isOperatingRef.current = true;
      setIsCheckingIn(true);
      setErrorMessage(null);

      try {
        let isConfirmed = true;

        if (onCheckIn) {
          const result = await onCheckIn();
          if (result === false) {
            isConfirmed = false;
          }
        } else if (venueId) {
          // Default endpoint invocation
          const res = await fetch(`/api/venues/${venueId}/check-in`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reservationId, deskId }),
          }).catch(() => null);

          if (!res || !res.ok) {
            isConfirmed = false;
          }
        }

        if (isConfirmed) {
          setInternalCheckedIn(true);
          // Trigger native success confirmation haptic feedback ([15, 50, 20])
          triggerSuccess();
          onSuccess?.();
        } else {
          const err = new Error("Failed to confirm reservation check-in.");
          setErrorMessage(err.message);
          // Trigger native error alert haptic feedback ([50, 100, 50])
          triggerError();
          onError?.(err);
        }
      } catch (err: unknown) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        setErrorMessage(errorObj.message);
        triggerError();
        onError?.(errorObj);
      } finally {
        setIsCheckingIn(false);
        isOperatingRef.current = false;
      }
    },
    [
      disabled,
      isCheckingIn,
      checkedIn,
      onCheckIn,
      venueId,
      reservationId,
      deskId,
      triggerSuccess,
      triggerError,
      onSuccess,
      onError,
      onClick,
    ]
  );

  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs gap-1.5",
    md: "px-4 py-2 text-sm gap-2",
    lg: "px-6 py-3 text-base gap-2.5",
  }[size];

  const variantClasses = {
    default: checkedIn
      ? "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600"
      : "bg-blue-600 text-white hover:bg-blue-700 active:scale-[0.98]",
    outline: checkedIn
      ? "border-2 border-emerald-600 text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20"
      : "border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20",
    compact: checkedIn
      ? "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400"
      : "bg-blue-600/10 text-blue-600 dark:text-blue-400 hover:bg-blue-600/20",
  }[variant];

  return (
    <button
      type="button"
      data-testid={dataTestId}
      aria-busy={isCheckingIn}
      title={errorMessage ?? undefined}
      aria-label={checkedIn ? `Checked in to ${venueName}` : `Check in to ${venueName}`}
      disabled={disabled || isCheckingIn || checkedIn}
      onClick={handleCheckIn}
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        sizeClasses,
        variantClasses,
        className
      )}
      {...props}
    >
      {isCheckingIn ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          <span>Checking In...</span>
        </>
      ) : checkedIn ? (
        <>
          <CheckCircle2 className="w-4 h-4 text-white" aria-hidden="true" />
          <span>Checked In</span>
        </>
      ) : (
        <>
          <MapPin className="w-4 h-4" aria-hidden="true" />
          <span>{children ?? "Check In"}</span>
        </>
      )}
    </button>
  );
}

export default VenueCheckInButton;
