import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  calculateHaversineKm,
  clusterVenuesHexagonally,
  hexDistance,
  rankVenuesForNomad,
  type VenueCandidate,
} from '@/lib/geospatial/spatialVenueClusterer';
import {
  EMPTY_RADIUS_VENUES_MESSAGE,
  VenueClusterMapOverlay,
} from '@/components/geospatial/VenueClusterMapOverlay';

describe('Hexagonal Spatial Venue Clusterer & Commute Ranking', () => {
  const bhandupOrigin = { lat: 19.1511, lng: 72.9367 };

  const sampleVenues: VenueCandidate[] = [
    {
      id: 'v1',
      name: 'Bhandup Station Hub',
      lat: 19.152,
      lng: 72.9372,
      availableSeats: 12,
      totalSeats: 20,
      wifiMbps: 180,
      transitDistanceKm: 0.2,
    },
    {
      id: 'v2',
      name: 'Bhandup West Loft',
      lat: 19.1535,
      lng: 72.934,
      availableSeats: 6,
      totalSeats: 15,
      wifiMbps: 120,
      transitDistanceKm: 0.6,
    },
    {
      id: 'v3',
      name: 'Powai Lake Desk',
      lat: 19.124,
      lng: 72.905,
      availableSeats: 25,
      totalSeats: 40,
      wifiMbps: 200,
      transitDistanceKm: 1.4,
    },
  ];

  it('computes Haversine distances accurately and safely handles invalid coordinates', () => {
    const dist = calculateHaversineKm(bhandupOrigin, sampleVenues[0]);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(1);

    expect(
      calculateHaversineKm({ lat: Number.NaN, lng: 72.9 }, bhandupOrigin)
    ).toBe(Number.POSITIVE_INFINITY);
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
  });

  it('groups venues into hexagonal cells and ranks candidates by commute & quality score', () => {
    const clusters = clusterVenuesHexagonally(sampleVenues, 1.5);
    expect(clusters.length).toBeGreaterThanOrEqual(2);

    const ranked = rankVenuesForNomad(sampleVenues, bhandupOrigin, {
      maxRadiusKm: 8,
    });
    expect(ranked[0]?.venue.id).toBe('v1');
    expect(ranked.length).toBe(3);
  });

  it('renders cluster expansion, venue selection callback, and empty-radius fallback', () => {
    const onSelectVenue = jest.fn();
    render(
      <VenueClusterMapOverlay
        venues={sampleVenues}
        origin={bhandupOrigin}
        maxRadiusKm={5}
        cellRadiusKm={1.5}
        onSelectVenue={onSelectVenue}
      />
    );

    const firstCluster = clusterVenuesHexagonally(sampleVenues, 1.5)[0];
    fireEvent.click(
      screen.getByTestId(`expand-cluster-btn-${firstCluster.cellId}`)
    );
    expect(
      screen.getByTestId(`cluster-venues-list-${firstCluster.cellId}`)
    ).toBeTruthy();

    fireEvent.click(screen.getAllByText('Select')[0]);
    expect(onSelectVenue).toHaveBeenCalledTimes(1);

    render(
      <VenueClusterMapOverlay
        venues={sampleVenues}
        origin={{ lat: 18.922, lng: 72.8347 }}
        maxRadiusKm={1}
      />
    );
    expect(screen.getByTestId('empty-radius-message').textContent).toBe(
      EMPTY_RADIUS_VENUES_MESSAGE
    );
  });
});
