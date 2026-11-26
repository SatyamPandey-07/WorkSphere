import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  VenueHexMapLayer,
  toHexGeoJsonFeatureCollection,
} from '@/components/map/VenueHexMapLayer';
import type { VenueCandidate } from '@/lib/geospatial/spatialVenueClusterer';

describe('VenueHexMapLayer Component (#10008)', () => {
  const mockVenues: VenueCandidate[] = [
    {
      id: 'venue-1',
      name: 'Central Tech Cafe',
      lat: 19.076,
      lng: 72.8777,
      availableSeats: 15,
      totalSeats: 25,
      wifiMbps: 220,
      quietScore: 90,
    },
    {
      id: 'venue-2',
      name: 'Quiet Cowork Hub',
      lat: 19.078,
      lng: 72.879,
      availableSeats: 8,
      totalSeats: 12,
      wifiMbps: 150,
      noiseLevelDb: 42, // converts to quietScore: 82
    },
    {
      id: 'venue-3',
      name: 'Harbor Nomad Desk',
      lat: 18.922,
      lng: 72.834,
      availableSeats: 4,
      totalSeats: 10,
      wifiMbps: 90,
      quietScore: 65,
    },
  ];

  it('renders SVG hexagons and labels for clusters', () => {
    render(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{ zoom: 13 }}
        metricColorBy="density"
      />
    );

    expect(screen.getByTestId('venue-hex-map-layer')).toBeInTheDocument();
    expect(screen.getByTestId('hex-svg-canvas')).toBeInTheDocument();
    expect(screen.getByText(/H3 Res 8/i)).toBeInTheDocument();
    expect(screen.getByText(/Zoom: 13.0/i)).toBeInTheDocument();
  });

  it('dynamically switches H3 resolution when viewport zoom changes', () => {
    const { rerender } = render(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{ zoom: 11 }} // zoom <= 12 -> res 7
      />
    );
    expect(screen.getByText(/H3 Res 7/i)).toBeInTheDocument();

    rerender(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{ zoom: 13.5 }} // 13-14 -> res 8
      />
    );
    expect(screen.getByText(/H3 Res 8/i)).toBeInTheDocument();

    rerender(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{ zoom: 16 }} // >= 15 -> res 9
      />
    );
    expect(screen.getByText(/H3 Res 9/i)).toBeInTheDocument();
  });

  it('displays tooltip on hover with venue count, wifi, quiet score, and seats', () => {
    const handleHover = jest.fn();
    render(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{ zoom: 13 }}
        onHoverCluster={handleHover}
      />
    );

    const polygons = screen.getAllByTestId(/^hex-polygon-h3:res8:/);
    expect(polygons.length).toBeGreaterThan(0);

    // Hover over the first hexagon
    fireEvent.mouseEnter(polygons[0]);
    expect(handleHover).toHaveBeenCalledWith(
      expect.objectContaining({
        cellId: expect.stringMatching(/^h3:res8:/),
        venueCount: expect.any(Number),
      })
    );

    // Tooltip should be visible with metrics
    const tooltip = screen.getByTestId('hex-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent(/Venues:/i);
    expect(tooltip).toHaveTextContent(/Avg WiFi:/i);
    expect(tooltip).toHaveTextContent(/Quiet Score:/i);
    expect(tooltip).toHaveTextContent(/Open Seats:/i);

    // Mouse leave should hide tooltip
    fireEvent.mouseLeave(polygons[0]);
    expect(screen.queryByTestId('hex-tooltip')).not.toBeInTheDocument();
    expect(handleHover).toHaveBeenCalledWith(null);
  });

  it('expands venue details drawer on click and supports venue selection', () => {
    const handleClick = jest.fn();
    const handleSelectVenue = jest.fn();

    render(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{ zoom: 13 }}
        onClickCluster={handleClick}
        onSelectVenue={handleSelectVenue}
      />
    );

    const polygons = screen.getAllByTestId(/^hex-polygon-h3:res8:/);
    fireEvent.click(polygons[0]);

    expect(handleClick).toHaveBeenCalledTimes(1);

    // Venue details panel should appear
    const panel = screen.getByTestId('hex-details-panel');
    expect(panel).toBeInTheDocument();

    // Select venue button
    const selectButtons = screen.getAllByTestId(/^select-venue-/);
    expect(selectButtons.length).toBeGreaterThan(0);
    fireEvent.click(selectButtons[0]);

    expect(handleSelectVenue).toHaveBeenCalledTimes(1);
    expect(handleSelectVenue).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
      })
    );

    // Close button dismisses drawer
    fireEvent.click(screen.getByTestId('close-hex-details-btn'));
    expect(screen.queryByTestId('hex-details-panel')).not.toBeInTheDocument();
  });

  it('renders empty state when no venues exist in current bounding box', () => {
    render(
      <VenueHexMapLayer
        venues={mockVenues}
        viewport={{
          zoom: 14,
          bbox: { minLat: 28.0, maxLat: 28.5, minLng: 77.0, maxLng: 77.5 }, // Delhi bbox (no Mumbai venues)
        }}
      />
    );

    expect(screen.getByTestId('hex-empty-state')).toHaveTextContent(
      /No venues found in current viewport/i
    );
  });

  it('supports toHexGeoJsonFeatureCollection export for MapLibre GeoJSON layer integration', () => {
    const clusters = [
      {
        cellId: 'h3:res8:10:20',
        resolution: 8,
        q: 10,
        r: 20,
        center: { lat: 19.0, lng: 72.8 },
        centroid: { lat: 19.001, lng: 72.802 },
        boundary: [{ lat: 19.0, lng: 72.8 }],
        polygonGeoJson: [
          [72.8, 19.0],
          [72.81, 19.0],
          [72.8, 19.0],
        ] as [number, number][],
        venues: [mockVenues[0]],
        venueCount: 1,
        density: 1.36,
        avgWifiMbps: 220,
        avgQuietScore: 90,
        totalAvailableSeats: 15,
      },
    ];

    const geojson = toHexGeoJsonFeatureCollection(clusters);
    expect(geojson.type).toBe('FeatureCollection');
    expect(geojson.features[0].geometry.type).toBe('Polygon');
    expect(geojson.features[0].properties.cellId).toBe('h3:res8:10:20');
    expect(geojson.features[0].properties.density).toBe(1.36);
  });
});
