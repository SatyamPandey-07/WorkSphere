"use client";

 feature/solana-optimistic-escrow-simulation
import React, { useState, useEffect } from "react";
import VenueCard, { VenueCardProps } from "@/components/venue/VenueCard";
import VenueCardSkeleton from "@/components/venues/VenueCardSkeleton";

interface VenueGridProps {
  venues?: Array<VenueCardProps["venue"]>;
  isLoading?: boolean;
}

export const VenueGrid: React.FC<VenueGridProps> = ({
  venues = [],
  isLoading = false,
}) => {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

import React, { ReactNode } from "react";
import { motion, MotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { VenueCard } from "@/components/VenueCard";
import VenueCardSkeleton from "@/components/venues/VenueCardSkeleton";

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
 main

  const showSkeletons = isLoading || !hydrated;

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
 feature/solana-optimistic-escrow-simulation
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full"
      data-testid="venue-grid"
    >
      {showSkeletons

      data-testid={dataTestId || "venue-grid"}
      className={cn(
        "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full",
        className,
      )}
      {...props}
    >
      {isLoading
 main
        ? Array.from({ length: 6 }).map((_, idx) => (
            <div key={`skeleton-${idx}`} className="w-full min-h-[356px]">
              <VenueCardSkeleton />
            </div>
          ))
 feature/solana-optimistic-escrow-simulation
        : venues.map((venue) => (

        : venues.map((venue: any) => (
 main
            <div
              key={venue.id}
              className="w-full min-h-[356px] transition-opacity duration-300 opacity-100 animate-in fade-in-50"
            >
              <VenueCard venue={venue} />
            </div>
          ))}
    </div>
  );
 feature/solana-optimistic-escrow-simulation
};
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
 main

export default VenueGrid;