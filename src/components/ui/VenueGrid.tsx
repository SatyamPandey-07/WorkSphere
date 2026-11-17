"use client";

import React, { ReactNode, useState, useEffect, useId } from "react";
import { motion, MotionProps } from "framer-motion";
import { LayoutGrid, List, Map as MapIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { VenueCard } from "@/components/VenueCard";
import VenueCardSkeleton from "@/components/venues/VenueCardSkeleton";

export type VenueLayoutMode = "grid" | "compact" | "map";

export interface LayoutOption {
  id: VenueLayoutMode;
  label: string;
  shortcut: "G" | "C" | "M";
  icon: React.ReactNode;
}

export interface AccessibleTooltipButtonProps {
  label: string;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

export const AccessibleTooltipButton: React.FC<
  AccessibleTooltipButtonProps
> = ({ label, shortcut, isActive, onClick, children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-label={`${label} (${shortcut})`}
        aria-pressed={isActive}
        aria-describedby={isOpen ? tooltipId : undefined}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={onClick}
        className={`inline-flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
          isActive
            ? "bg-indigo-600 text-white shadow-sm"
            : "text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        {children}
      </button>

      <div
        id={tooltipId}
        role="tooltip"
        aria-hidden={!isOpen}
        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-1 text-xs font-medium text-slate-100 shadow-lg backdrop-blur-sm transition-all duration-150 ease-out ${
          isOpen
            ? "visible translate-y-0 scale-100 opacity-100"
            : "invisible translate-y-1 scale-95 opacity-0"
        }`}
      >
        <span>{label}</span>
        <kbd className="ml-1.5 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
          {shortcut}
        </kbd>
      </div>
    </div>
  );
};

export interface VenueLayoutToggleProps {
  layout: VenueLayoutMode;
  onLayoutChange: (mode: VenueLayoutMode) => void;
}

export const VenueLayoutToggle: React.FC<VenueLayoutToggleProps> = ({
  layout,
  onLayoutChange,
}) => {
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toUpperCase();
      if (key === "G") onLayoutChange("grid");
      if (key === "C") onLayoutChange("compact");
      if (key === "M") onLayoutChange("map");
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onLayoutChange]);

  const options: LayoutOption[] = [
    {
      id: "grid",
      label: "Grid View",
      shortcut: "G",
      icon: <LayoutGrid className="h-4 w-4" />,
    },
    {
      id: "compact",
      label: "Compact View",
      shortcut: "C",
      icon: <List className="h-4 w-4" />,
    },
    {
      id: "map",
      label: "Map View",
      shortcut: "M",
      icon: <MapIcon className="h-4 w-4" />,
    },
  ];

  return (
    <div
      role="group"
      aria-label="Venue layout view"
      className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1"
    >
      {options.map((opt) => (
        <AccessibleTooltipButton
          key={opt.id}
          label={opt.label}
          shortcut={opt.shortcut}
          isActive={layout === opt.id}
          onClick={() => onLayoutChange(opt.id)}
        >
          {opt.icon}
        </AccessibleTooltipButton>
      ))}
    </div>
  );
};

export interface LayoutBoundaryProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  minHeight?: string | number;
  "data-testid"?: string;
}

export const LayoutBoundary = React.forwardRef<
  HTMLDivElement,
  LayoutBoundaryProps
>(
  (
    {
      children,
      className = "",
      minHeight,
      style,
      "data-testid": dataTestId = "layout-boundary",
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        data-testid={dataTestId}
        style={{
          position: "relative",
          minHeight,
          ...style,
        }}
        className={cn("w-full min-w-0", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);
LayoutBoundary.displayName = "LayoutBoundary";

export interface AnimatedLayoutChildProps
  extends
    MotionProps,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof MotionProps> {
  children: ReactNode;
  className?: string;
  layoutId?: string;
  "data-testid"?: string;
}

export const AnimatedLayoutChild = React.forwardRef<
  HTMLDivElement,
  AnimatedLayoutChildProps
>(
  (
    {
      children,
      className = "",
      layoutId,
      style,
      "data-testid": dataTestId = "animated-layout-child",
      ...props
    },
    ref,
  ) => {
    return (
      <motion.div
        ref={ref}
        data-testid={dataTestId}
        layoutId={layoutId}
        layout
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          ...style,
        }}
        className={cn("min-w-0 [transform:translate3d(0,0,0)]", className)}
        {...props}
      >
        {children}
      </motion.div>
    );
  },
);
AnimatedLayoutChild.displayName = "AnimatedLayoutChild";

export interface VenueGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  venues?: any[];
  isLoading?: boolean;
  viewMode?: "card" | "list";
  useSubgrid?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function VenueGrid({
  children,
  venues = [],
  isLoading = false,
  viewMode = "card",
  useSubgrid = true,
  className = "",
  "data-testid": dataTestId,
  ...props
}: VenueGridProps) {
  if (viewMode === "list") {
    return (
      <div
        data-testid={dataTestId || "venue-listings-list"}
        className={cn("space-y-2 w-full min-w-0", className)}
        {...props}
      >
        {children}
      </div>
    );
  }

  // Card view grid with subgrid support
  const gridClasses = useSubgrid
    ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr [grid-auto-flow:dense]"
    : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";

  if (children) {
    return (
      <div
        data-testid={dataTestId || "venue-listings-grid"}
        className={cn(
          "@container min-w-0 w-full [transform:translate3d(0,0,0)]",
          gridClasses,
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      data-testid={dataTestId || "venue-grid"}
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full",
        className,
      )}
      {...props}
    >
      {isLoading
        ? Array.from({ length: 6 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="w-full min-h-[356px]">
              <VenueCardSkeleton />
            </div>
          ))
        : venues.map((venue: any) => (
            <div
              key={venue.id}
              className="w-full min-h-[356px] transition-opacity duration-300 opacity-100 animate-in fade-in-50"
            >
              <VenueCard venue={venue} />
            </div>
          ))}
    </div>
  );
}

export interface SubgridCellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export const SubgridCell = React.forwardRef<HTMLDivElement, SubgridCellProps>(
  (
    {
      children,
      className = "",
      style,
      "data-testid": dataTestId = "subgrid-cell",
      ...props
    },
    ref,
  ) => {
    return (
      <div
        ref={ref}
        data-testid={dataTestId}
        style={{
          gridRow: "span 1",
          ...style,
        }}
        className={cn("w-full min-w-0", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);
SubgridCell.displayName = "SubgridCell";

export default VenueGrid;
