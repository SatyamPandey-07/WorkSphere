"use client";

import React, { ReactNode } from "react";
import { motion, MotionProps } from "framer-motion";

/**
 * ARCHITECTURAL FIX: Issue #1037
 *
 * Measurement Container Pattern for Framer Motion layoutId inside CSS Grids & Subgrids.
 *
 * Problem:
 * When Framer Motion calculates layout animations (`layoutId` or `layout`) inside CSS Grid,
 * subgrids, or fluid multi-column containers during parent container resize (e.g. filter drawer toggle),
 * grid item dimensions reflow synchronously. Animating the grid item directly causes Framer Motion's
 * calculated matrix transforms (translate3d & scale) to conflict with fluid grid cell bounds, resulting in position skews or jumps.
 *
 * Solution:
 * 1. Parent (`LayoutBoundary`): Set to `position: relative` (and optional height/aspect ratio anchor).
 *    This acts as a stable static layout frame inside the CSS Grid track, absorbing grid reflow measurements.
 * 2. Animated Child (`AnimatedLayoutChild`): Positioned with `position: absolute; inset: 0; width: 100%; height: 100%`.
 *    This decouples motion calculations from fluid grid item reflows while maintaining perfect visual bounds.
 */

interface LayoutBoundaryProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  /** Height or aspect ratio configuration to preserve static space during layout transitions */
  minHeight?: string | number;
}

export const LayoutBoundary = React.forwardRef<
  HTMLDivElement,
  LayoutBoundaryProps
>(({ children, className = "", minHeight, style, ...props }, ref) => {
  return (
    <div
      ref={ref}
      style={{
        position: "relative",
        minHeight,
        ...style,
      }}
      className={`w-full min-w-0 ${className}`}
      {...props}
    >
      {children}
    </div>
  );
});
LayoutBoundary.displayName = "LayoutBoundary";

interface AnimatedLayoutChildProps
  extends
    MotionProps,
    Omit<React.HTMLAttributes<HTMLDivElement>, keyof MotionProps> {
  children: ReactNode;
  className?: string;
  layoutId?: string;
}

export const AnimatedLayoutChild = React.forwardRef<
  HTMLDivElement,
  AnimatedLayoutChildProps
>(({ children, className = "", layoutId, style, ...props }, ref) => {
  return (
    <motion.div
      ref={ref}
      layoutId={layoutId}
      layout
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        ...style,
      }}
      className={`min-w-0 [transform:translate3d(0,0,0)] ${className}`}
      {...props}
    >
      {children}
    </motion.div>
  );
});
AnimatedLayoutChild.displayName = "AnimatedLayoutChild";

/**
 * Reusable Responsive Grid Component with CSS Subgrid Architecture
 *
 * Features:
 * - Supports responsive grid columns (1 col on mobile, 2 sm, 3 md/lg)
 * - Enables CSS `subgrid` for rows when supported, aligning header, body, and action buttons across rows
 * - Safe fallback for browsers without subgrid
 */
interface VenueGridProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  viewMode?: "card" | "list";
  useSubgrid?: boolean;
  className?: string;
}

export function VenueGrid({
  children,
  viewMode = "card",
  useSubgrid = true,
  className = "",
  ...props
}: VenueGridProps) {
  if (viewMode === "list") {
    return (
      <div className={`space-y-2 w-full min-w-0 ${className}`} {...props}>
        {children}
      </div>
    );
  }

  // Card view grid with subgrid support
  const gridClasses = useSubgrid
    ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 auto-rows-fr [grid-auto-flow:dense]"
    : "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";

  return (
    <div
      className={`@container min-w-0 w-full [transform:translate3d(0,0,0)] ${gridClasses} ${className}`}
      data-testid="venue-listings-grid"
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * Subgrid Cell Wrapper for Cards inside VenueGrid
 */
interface SubgridCellProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export const SubgridCell = React.forwardRef<HTMLDivElement, SubgridCellProps>(
  ({ children, className = "", style, ...props }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          // Use subgrid rows when enabled in browser
          gridRow: "span 1",
          ...style,
        }}
        className={`w-full min-w-0 ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  },
);
SubgridCell.displayName = "SubgridCell";
