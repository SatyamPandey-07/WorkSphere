import React from "react";
import styles from "./NomadPassportStampSkeleton.module.css";

export interface NomadPassportStampSkeletonProps {
  count?: number;
}

export default function NomadPassportStampSkeleton({
  count = 3,
}: NomadPassportStampSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading passport stamps"
      data-testid="nomad-passport-stamp-skeleton-grid"
      className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
    >
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          data-testid="nomad-passport-stamp-skeleton"
          aria-hidden="true"
          className="p-4 rounded-2xl border border-slate-800 bg-slate-950/60 flex flex-col justify-between space-y-3 min-h-[150px] animate-in fade-in duration-500"
        >
          <div className="flex items-start gap-3">
            <div className={styles.hexagon}>
              <div className={styles.shimmer} />
            </div>
            <div className="flex-1 space-y-3 pt-2">
              <div className={`${styles.shimmerBar} h-3 w-3/4 rounded`} />
              <div className={`${styles.shimmerBar} h-2.5 w-1/2 rounded`} />
              <div className={`${styles.shimmerBar} h-2 w-2/5 rounded`} />
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
            <div className={`${styles.shimmerBar} h-2.5 w-20 rounded`} />
            <div className={`${styles.shimmerBar} h-6 w-16 rounded-lg`} />
          </div>
        </div>
      ))}
      <span className="sr-only">Passport stamps are loading...</span>
    </div>
  );
}
