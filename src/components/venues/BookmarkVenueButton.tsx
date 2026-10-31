"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Bookmark, Heart, Star, Check } from "lucide-react";
import {
  isVenueFavoritedLocally,
  toggleVenueFavorite,
  subscribeToFavoriteChanges,
} from "@/lib/venues/favoriteStorage";
import type { OfflineVenue } from "@/lib/offlineStorage";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

export interface BookmarkVenueButtonProps {
  venueId: string;
  venueName?: string;
  initialIsFavorited?: boolean;
  venueData?: Partial<OfflineVenue>;
  variant?: "icon-only" | "button" | "pill" | "compact";
  iconType?: "bookmark" | "heart" | "star";
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  showTooltip?: boolean;
  onToggle?: (isFavorited: boolean) => void;
  onPersist?: (
    venueId: string,
    isFavorited: boolean,
  ) => Promise<boolean | void>;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function BookmarkVenueButton({
  venueId,
  venueName = "Venue",
  initialIsFavorited,
  venueData,
  variant = "icon-only",
  iconType = "bookmark",
  size = "md",
  showLabel = false,
  showTooltip = true,
  onToggle,
  onPersist,
  className = "",
  disabled = false,
  "data-testid": dataTestId,
}: BookmarkVenueButtonProps) {
  const { toast } = useToast();
  const [isFavorited, setIsFavorited] = useState<boolean>(() => {
    if (typeof initialIsFavorited === "boolean") return initialIsFavorited;
    return isVenueFavoritedLocally(venueId);
  });
  const [isAnimating, setIsAnimating] = useState(false);
  const [justToggled, setJustToggled] = useState(false);

  const isFavoritedRef = useRef(isFavorited);
  const isTogglingRef = useRef(false);
  const lastToggleTimeRef = useRef(0);
  const isMountedRef = useRef(true);
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (animTimerRef.current) clearTimeout(animTimerRef.current);
      if (toggleTimerRef.current) clearTimeout(toggleTimerRef.current);
    };
  }, []);

  // Sync with local storage on mount & listen to external/cross-tab updates
  useEffect(() => {
    // Read current local state or sync updated prop
    let currentState: boolean;
    if (typeof initialIsFavorited === "boolean") {
      currentState = initialIsFavorited;
    } else {
      currentState = isVenueFavoritedLocally(venueId);
    }
    isFavoritedRef.current = currentState;
    setIsFavorited(currentState);

    // Subscribe to multi-tab and multi-component state synchronization
    const unsubscribe = subscribeToFavoriteChanges((event) => {
      if (event.venueId === venueId) {
        isFavoritedRef.current = event.isFavorited;
        if (isMountedRef.current) {
          setIsFavorited(event.isFavorited);
        }
      }
    });

    return unsubscribe;
  }, [venueId, initialIsFavorited]);

  const handleToggle = useCallback(
    async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();

      const now = Date.now();
      if (
        disabled ||
        isTogglingRef.current ||
        now - lastToggleTimeRef.current < 400
      ) {
        return;
      }

      isTogglingRef.current = true;
      lastToggleTimeRef.current = now;

      // 1. Optimistic UI update: immediately toggle icon fill and notify parent
      const previousState = isFavoritedRef.current;
      const nextState = !previousState;
      isFavoritedRef.current = nextState;
      setIsFavorited(nextState);
      onToggle?.(nextState);

      setIsAnimating(true);
      setJustToggled(true);

      // 2. Dispatch background API call to persist bookmark
      try {
        const result = await (onPersist
          ? onPersist(venueId, nextState)
          : toggleVenueFavorite(venueId, {
              id: venueId,
              name: venueName,
              ...venueData,
            }));

        // If backend returns authoritative state differing from optimistic state
        if (typeof result === "boolean" && result !== nextState) {
          isFavoritedRef.current = result;
          if (isMountedRef.current) {
            setIsFavorited(result);
          }
          onToggle?.(result);
        }
      } catch (err: unknown) {
        // 3. Rollback optimistic state gracefully with an error toast if API rejects
        isFavoritedRef.current = previousState;
        if (isMountedRef.current) {
          setIsFavorited(previousState);
        }
        onToggle?.(previousState);

        const errorMessage =
          err instanceof Error
            ? err.message
            : `Failed to update bookmark for ${venueName}. Please try again.`;
        toast(errorMessage, "error");
      } finally {
        isTogglingRef.current = false;
        animTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setIsAnimating(false);
        }, 400);
        toggleTimerRef.current = setTimeout(() => {
          if (isMountedRef.current) setJustToggled(false);
        }, 2000);
      }
    },
    [venueId, venueName, venueData, disabled, onToggle, onPersist, toast],
  );

  // Icon sizing
  const iconSizeClasses = {
    sm: "w-3.5 h-3.5",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  }[size];

  // Button sizing based on variant
  const buttonSizeClasses = {
    sm: "p-1.5 text-xs",
    md: "p-2 text-sm",
    lg: "p-2.5 text-base",
  }[size];

  const renderIcon = () => {
    const isFilled = isFavorited;
    const commonProps = {
      className: cn(
        iconSizeClasses,
        "transition-all duration-200",
        isAnimating ? "scale-125 rotate-12" : "scale-100 rotate-0",
        isFilled
          ? iconType === "heart"
            ? "fill-rose-500 text-rose-500"
            : iconType === "star"
              ? "fill-amber-400 text-amber-400"
              : "fill-blue-600 dark:fill-blue-400 text-blue-600 dark:text-blue-400"
          : "text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-700 dark:group-hover:text-zinc-200",
      ),
    };

    if (iconType === "heart") {
      return <Heart {...commonProps} />;
    }
    if (iconType === "star") {
      return <Star {...commonProps} />;
    }
    return <Bookmark {...commonProps} />;
  };

  const actionLabel = isFavorited
    ? `Remove ${venueName} from saved`
    : `Bookmark ${venueName}`;

  const rootTestId = dataTestId || `bookmark-toggle-btn-${venueId}`;

  if (variant === "pill" || variant === "button") {
    return (
      <button
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        aria-pressed={isFavorited}
        aria-label={actionLabel}
        data-testid={rootTestId}
        className={cn(
          "group inline-flex items-center gap-2 rounded-xl font-medium border transition-all duration-150 select-none focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
          buttonSizeClasses,
          variant === "pill" ? "rounded-full px-3.5 py-1.5" : "px-3 py-2",
          isFavorited
            ? "bg-blue-50/80 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800/80 text-blue-700 dark:text-blue-300 shadow-sm"
            : "bg-white/80 dark:bg-zinc-900/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300",
          className,
        )}
        title={showTooltip ? actionLabel : undefined}
      >
        {renderIcon()}
        {(showLabel || variant === "button" || variant === "pill") && (
          <span className="font-semibold text-xs leading-none">
            {justToggled ? (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <Check className="w-3 h-3" />
                {isFavorited ? "Saved" : "Removed"}
              </span>
            ) : isFavorited ? (
              "Saved"
            ) : (
              "Save Venue"
            )}
          </span>
        )}
      </button>
    );
  }

  // Default / icon-only / compact
  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      aria-pressed={isFavorited}
      aria-label={actionLabel}
      data-testid={rootTestId}
      title={showTooltip ? actionLabel : undefined}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-xl transition-all duration-150 border focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
        isFavorited
          ? "bg-blue-50/90 dark:bg-blue-950/60 border-blue-200 dark:border-blue-800/80 shadow-sm"
          : "bg-white/80 dark:bg-zinc-900/80 hover:bg-zinc-100 dark:hover:bg-zinc-800 border-zinc-200 dark:border-zinc-800/80 backdrop-blur-xs",
        buttonSizeClasses,
        className,
      )}
    >
      {renderIcon()}
    </button>
  );
}

export default BookmarkVenueButton;
