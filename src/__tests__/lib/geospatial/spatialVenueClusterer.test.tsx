import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  calculateHaversineKm,
  clusterVenuesHexagonally,
 feat/geospatial-hex-venue-clustering
  hexDistance,
  rankVenuesForNomad,

  clusterVenuesByH3Resolution,
  filterVenuesByBoundingBox,
  getHexagonBoundary,
  getHexagonGeoJsonPolygon,
  hexClustersToGeoJson,
  hexDistance,
  isCoordinateInBoundingBox,
  rankVenuesForNomad,
  zoomToH3Resolution,
 main
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

 feat/geospatial-hex-venue-clustering
  it('renders cluster expansion, venue selection callback, and empty-radius fallback', () => {
    const onSelectVenue = jest.fn();

  it('renders cluster expansion and empty-radius fallback in VenueClusterMapOverlay', () => {
 main
    render(
      <VenueClusterMapOverlay
        venues={sampleVenues}
        origin={bhandupOrigin}
        maxRadiusKm={5}
        cellRadiusKm={1.5}
 feat/geospatial-hex-venue-clustering
        onSelectVenue={onSelectVenue}

 main
      />
    );

    const firstCluster = clusterVenuesHexagonally(sampleVenues, 1.5)[0];
    fireEvent.click(
      screen.getByTestId(`expand-cluster-btn-${firstCluster.cellId}`)
    );
    expect(
      screen.getByTestId(`cluster-venues-list-${firstCluster.cellId}`)
    ).toBeTruthy();

 feat/geospatial-hex-venue-clustering
    fireEvent.click(screen.getAllByText('Select')[0]);
    expect(onSelectVenue).toHaveBeenCalledTimes(1);


 main
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
 feat/geospatial-hex-venue-clustering


  describe('H3 Hierarchical Hexagonal Indexing & Aggregations (#10008)', () => {
    it('maps zoom levels to H3 resolutions (7, 8, 9)', () => {
      expect(zoomToH3Resolution(10)).toBe(7);
      expect(zoomToH3Resolution(12)).toBe(7);
      expect(zoomToH3Resolution(13)).toBe(8);
      expect(zoomToH3Resolution(14)).toBe(8);
      expect(zoomToH3Resolution(15)).toBe(9);
      expect(zoomToH3Resolution(18)).toBe(9);
    });

    it('filters coordinates within bounding box correctly including antimeridian', () => {
      const bbox = { minLat: 19.15, maxLat: 19.2, minLng: 72.93, maxLng: 73.0 };
      expect(isCoordinateInBoundingBox({ lat: 19.152, lng: 72.95 }, bbox)).toBe(true);
      expect(isCoordinateInBoundingBox({ lat: 19.05, lng: 72.95 }, bbox)).toBe(false);
      expect(isCoordinateInBoundingBox({ lat: 19.16, lng: 73.05 }, bbox)).toBe(false);

      const filtered = filterVenuesByBoundingBox(sampleVenues, bbox);
      expect(filtered.map((v) => v.id)).toEqual(['v1', 'v2']);
    });

    it('calculates cell keys, venue density, wifi speed, and quiet score per hexagon', () => {
      const venuesWithMetrics: VenueCandidate[] = [
        {
          id: 'v1',
          name: 'V1',
          lat: 19.15,
          lng: 72.95,
          availableSeats: 10,
          wifiMbps: 150,
          quietScore: 85,
        },
        {
          id: 'v2',
          name: 'V2',
          lat: 19.1502,
          lng: 72.9501,
          availableSeats: 5,
          wifiMbps: 100,
          noiseLevelDb: 40, // converts to quietScore: 85
        },
        {
          id: 'v3',
          name: 'V3',
          lat: 19.25,
          lng: 72.85,
          availableSeats: 20,
          wifiMbps: 50,
        },
      ];

      const clusters = clusterVenuesByH3Resolution(venuesWithMetrics, {
        resolution: 8,
      });

      expect(clusters.length).toBe(2);
      const mainCluster = clusters.find((c) => c.venueCount === 2);
      expect(mainCluster).toBeDefined();
      expect(mainCluster?.cellId).toMatch(/^h3:res8:/);
      expect(mainCluster?.totalAvailableSeats).toBe(15);
      expect(mainCluster?.avgWifiMbps).toBe(125);
      expect(mainCluster?.avgQuietScore).toBe(85);
      expect(mainCluster?.density).toBeGreaterThan(0);
      expect(mainCluster?.boundary).toHaveLength(6);
      expect(mainCluster?.polygonGeoJson).toHaveLength(7);
      expect(mainCluster?.polygonGeoJson[0]).toEqual(mainCluster?.polygonGeoJson[6]);
    });

    it('generates a valid GeoJSON FeatureCollection with polygon coordinates and properties', () => {
      const clusters = clusterVenuesByH3Resolution(sampleVenues, { resolution: 7 });
      const geojson = hexClustersToGeoJson(clusters);

      expect(geojson.type).toBe('FeatureCollection');
      expect(geojson.features.length).toBe(clusters.length);

      const feat = geojson.features[0];
      expect(feat.type).toBe('Feature');
      expect(feat.geometry.type).toBe('Polygon');
      expect(feat.geometry.coordinates[0]).toHaveLength(7);
      expect(feat.properties.cellId).toBe(clusters[0].cellId);
      expect(feat.properties.resolution).toBe(7);
      expect(feat.properties.venueCount).toBe(clusters[0].venueCount);
      expect(typeof feat.properties.density).toBe('number');
      expect(typeof feat.properties.avgWifiMbps).toBe('number');
      expect(typeof feat.properties.avgQuietScore).toBe('number');
    });

    it('benchmarks clustering efficiency: processes 500 venues in under 10ms', () => {
      // Generate 500 random urban venues across Mumbai
      const venues500: VenueCandidate[] = Array.from({ length: 500 }, (_, i) => ({
        id: `bench-venue-${i}`,
        name: `Urban Venue ${i}`,
        lat: 19.0 + (i % 20) * 0.01 + Math.random() * 0.005,
        lng: 72.8 + Math.floor(i / 20) * 0.008 + Math.random() * 0.005,
        availableSeats: (i % 30) + 1,
        wifiMbps: 50 + (i % 150),
        quietScore: 60 + (i % 40),
      }));

      const start = performance.now();
      const clusters = clusterVenuesByH3Resolution(venues500, {
        resolution: 8,
        bbox: { minLat: 18.9, maxLat: 19.3, minLng: 72.7, maxLng: 73.1 },
      });
      const elapsed = performance.now() - start;

      expect(clusters.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(10); // Acceptance criteria: <10ms for 500 venues
    });
  });
 main
});
