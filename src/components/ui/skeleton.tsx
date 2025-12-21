"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800",
        className
      )}
    />
  );
}

export function VenueCardSkeleton() {
  return (
    <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 bg-white dark:bg-zinc-900">
      <div className="flex items-start gap-2">
        {/* Icon placeholder */}
        <Skeleton className="w-8 h-8 rounded-lg" />
        
        <div className="flex-1 min-w-0">
          {/* Title and score */}
          <div className="flex items-center gap-2 mb-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-12" />
          </div>
          
          {/* Category */}
          <Skeleton className="h-3 w-20 mb-1" />
          
          {/* Address */}
          <Skeleton className="h-3 w-40 mb-2" />
          
          {/* Amenity badges */}
          <div className="flex items-center gap-2 mb-2">
            <Skeleton className="h-4 w-14" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
          
          {/* Action buttons */}
          <div className="flex items-center gap-1 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-6 w-12" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function VenueListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24 mb-2" />
      {Array.from({ length: count }).map((_, i) => (
        <VenueCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ChatMessageSkeleton() {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg px-4 py-3 bg-zinc-100 dark:bg-zinc-900">
        <div className="space-y-2">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    </div>
  );
}

export function AgentStepsSkeleton() {
  return (
    <div className="ml-2 space-y-2 border-l-2 border-zinc-200 dark:border-zinc-800 pl-3">
      {[1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-zinc-50 dark:bg-zinc-900 rounded-lg p-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Skeleton className="w-3 h-3 rounded" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}

export function MapMarkerSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 rounded-lg">
      <div className="text-center">
        <Skeleton className="w-12 h-12 rounded-full mx-auto mb-2" />
        <Skeleton className="h-3 w-24 mx-auto" />
      </div>
    </div>
  );
}
