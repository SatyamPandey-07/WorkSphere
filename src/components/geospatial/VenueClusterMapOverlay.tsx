'use client';

import React, { useMemo, useState } from 'react';
import {
  clusterVenuesHexagonally,
  rankVenuesForNomad,
  type GeoCoordinate,
  type RankingWeights,
  type VenueCandidate,
} from '@/lib/geospatial/spatialVenueClusterer';

export const EMPTY_RADIUS_VENUES_MESSAGE =
  'No venues found within selected radius';

export interface VenueClusterMapOverlayProps {
  venues: readonly VenueCandidate[];
  origin: GeoCoordinate;
  maxRadiusKm?: number;
  cellRadiusKm?: number;
  weights?: RankingWeights;
  onSelectVenue?: (venue: VenueCandidate) => void;
}

export const VenueClusterMapOverlay: React.FC<VenueClusterMapOverlayProps> = ({
  venues,
  origin,
  maxRadiusKm = 5,
  cellRadiusKm = 1.5,
  weights,
  onSelectVenue,
}) => {
  const [expandedCellId, setExpandedCellId] = useState<string | null>(null);

  const rankedVenues = useMemo(
    () => rankVenuesForNomad(venues, origin, { maxRadiusKm, weights }),
    [venues, origin, maxRadiusKm, weights]
  );

  const clusters = useMemo(
    () =>
      clusterVenuesHexagonally(
        rankedVenues.map((r) => r.venue),
        cellRadiusKm
      ),
    [rankedVenues, cellRadiusKm]
  );

  if (rankedVenues.length === 0) {
    return (
      <section
        data-testid="venue-cluster-overlay"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <p
          data-testid="empty-radius-message"
          className="text-sm font-medium text-slate-600 dark:text-slate-300"
        >
          {EMPTY_RADIUS_VENUES_MESSAGE}
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="venue-cluster-overlay"
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
          Hexagonal Venue Clusters ({clusters.length})
        </h3>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {rankedVenues.length} matched within {maxRadiusKm} km
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {clusters.map((cluster) => {
          const isExpanded = expandedCellId === cluster.cellId;
          return (
            <div
              key={cluster.cellId}
              data-testid={`hex-cluster-${cluster.cellId}`}
              className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Hex ({cluster.q}, {cluster.r}) · {cluster.venueCount} venue(s)
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {cluster.totalAvailableSeats} open seats · Avg{' '}
                    {cluster.avgWifiMbps} Mbps
                  </div>
                </div>

                <button
                  type="button"
                  data-testid={`expand-cluster-btn-${cluster.cellId}`}
                  onClick={() =>
                    setExpandedCellId(isExpanded ? null : cluster.cellId)
                  }
                  className="rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  {isExpanded ? 'Collapse' : 'Expand'}
                </button>
              </div>

              {isExpanded && (
                <ul
                  data-testid={`cluster-venues-list-${cluster.cellId}`}
                  className="mt-3 space-y-1.5 border-t border-slate-200 pt-2.5 dark:border-slate-700"
                >
                  {cluster.venues.map((v) => (
                    <li
                      key={v.id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {v.name}
                      </span>
                      {onSelectVenue && (
                        <button
                          type="button"
                          onClick={() => onSelectVenue(v)}
                          className="text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          Select
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default VenueClusterMapOverlay;
