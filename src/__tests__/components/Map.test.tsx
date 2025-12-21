import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock Clerk
jest.mock('@clerk/nextjs', () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'test-user',
      hasImage: true,
      imageUrl: 'https://example.com/avatar.jpg',
    },
  }),
}));

// Mock react-leaflet
const mockSetView = jest.fn();
const mockFlyTo = jest.fn();
const mockFlyToBounds = jest.fn();

jest.mock('react-leaflet', () => ({
  MapContainer: ({ children, center, zoom, style }: any) => (
    <div 
      data-testid="map-container" 
      data-center={JSON.stringify(center)} 
      data-zoom={zoom}
      style={style}
    >
      {children}
    </div>
  ),
  TileLayer: ({ url, attribution }: any) => (
    <div data-testid="tile-layer" data-url={url} data-attribution={attribution} />
  ),
  Marker: ({ children, position, icon }: any) => (
    <div 
      data-testid="marker" 
      data-position={JSON.stringify(position)}
      data-icon={icon?.options?.className || 'default'}
    >
      {children}
    </div>
  ),
  Popup: ({ children }: any) => (
    <div data-testid="popup">{children}</div>
  ),
  Polyline: ({ children, positions, pathOptions }: any) => (
    <div 
      data-testid="polyline" 
      data-positions={JSON.stringify(positions)}
      data-color={pathOptions?.color}
    >
      {children}
    </div>
  ),
  useMap: () => ({
    setView: mockSetView,
    flyTo: mockFlyTo,
    flyToBounds: mockFlyToBounds,
  }),
}));

// Mock leaflet
jest.mock('leaflet', () => ({
  icon: jest.fn(() => ({ options: { className: 'default-icon' } })),
  divIcon: jest.fn((options) => ({ options })),
  latLngBounds: jest.fn(() => ({
    extend: jest.fn(),
  })),
  Icon: {
    Default: {
      prototype: {},
      mergeOptions: jest.fn(),
    },
  },
}));

// Import after mocks
import Map from '@/components/Map';
import { MapMarker, MapRoute, MapView } from '@/types/map';

describe('Map Component', () => {
  const defaultLocation = { latitude: 37.7749, longitude: -122.4194 };
  const defaultProps = {
    location: defaultLocation,
    markers: [] as MapMarker[],
    routes: [] as MapRoute[],
    mapView: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the map container', () => {
      render(<Map {...defaultProps} />);
      
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });

    it('renders with correct center coordinates', () => {
      render(<Map {...defaultProps} />);
      
      const mapContainer = screen.getByTestId('map-container');
      const center = JSON.parse(mapContainer.dataset.center || '[]');
      
      expect(center[0]).toBe(defaultLocation.latitude);
      expect(center[1]).toBe(defaultLocation.longitude);
    });

    it('renders with default zoom level', () => {
      render(<Map {...defaultProps} />);
      
      const mapContainer = screen.getByTestId('map-container');
      expect(mapContainer.dataset.zoom).toBe('13');
    });

    it('renders tile layer with OpenStreetMap', () => {
      render(<Map {...defaultProps} />);
      
      const tileLayer = screen.getByTestId('tile-layer');
      expect(tileLayer.dataset.url).toContain('openstreetmap.org');
    });
  });

  describe('User Location Marker', () => {
    it('renders user location marker', () => {
      render(<Map {...defaultProps} />);
      
      const markers = screen.getAllByTestId('marker');
      expect(markers.length).toBeGreaterThanOrEqual(1);
    });

    it('renders "You are here" popup for user marker', () => {
      render(<Map {...defaultProps} />);
      
      expect(screen.getByText('You are here!')).toBeInTheDocument();
    });
  });

  describe('Venue Markers', () => {
    it('renders venue markers', () => {
      const markers: MapMarker[] = [
        {
          id: '1',
          name: 'Test Cafe',
          position: { lat: 37.78, lng: -122.42 },
          category: 'cafe',
          address: '123 Test St',
        },
        {
          id: '2',
          name: 'Test Library',
          position: { lat: 37.79, lng: -122.43 },
          category: 'library',
        },
      ];

      render(<Map {...defaultProps} markers={markers} />);
      
      // User marker + 2 venue markers
      const allMarkers = screen.getAllByTestId('marker');
      expect(allMarkers.length).toBe(3);
    });

    it('displays venue name in popup', () => {
      const markers: MapMarker[] = [
        {
          id: '1',
          name: 'Amazing Cafe',
          position: { lat: 37.78, lng: -122.42 },
          category: 'cafe',
        },
      ];

      render(<Map {...defaultProps} markers={markers} />);
      
      expect(screen.getByText('Amazing Cafe')).toBeInTheDocument();
    });

    it('displays venue category in popup', () => {
      const markers: MapMarker[] = [
        {
          id: '1',
          name: 'Test Venue',
          position: { lat: 37.78, lng: -122.42 },
          category: 'coworking',
        },
      ];

      render(<Map {...defaultProps} markers={markers} />);
      
      expect(screen.getByText('coworking')).toBeInTheDocument();
    });

    it('displays venue address when available', () => {
      const markers: MapMarker[] = [
        {
          id: '1',
          name: 'Test Venue',
          position: { lat: 37.78, lng: -122.42 },
          category: 'cafe',
          address: '456 Market Street',
        },
      ];

      render(<Map {...defaultProps} markers={markers} />);
      
      expect(screen.getByText('456 Market Street')).toBeInTheDocument();
    });
  });

  describe('Routes', () => {
    it('renders route polylines', () => {
      const routes: MapRoute[] = [
        {
          id: 'route-1',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.78, lng: -122.42 },
          ],
          distance: 1500,
          duration: 600,
        },
      ];

      render(<Map {...defaultProps} routes={routes} />);
      
      expect(screen.getByTestId('polyline')).toBeInTheDocument();
    });

    it('applies correct color for highlighted routes', () => {
      const routes: MapRoute[] = [
        {
          id: 'route-1',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.78, lng: -122.42 },
          ],
          isHighlighted: true,
        },
      ];

      render(<Map {...defaultProps} routes={routes} />);
      
      const polyline = screen.getByTestId('polyline');
      expect(polyline.dataset.color).toBe('#28a745'); // Green for highlighted
    });

    it('applies default color for normal routes', () => {
      const routes: MapRoute[] = [
        {
          id: 'route-1',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.78, lng: -122.42 },
          ],
          isHighlighted: false,
        },
      ];

      render(<Map {...defaultProps} routes={routes} />);
      
      const polyline = screen.getByTestId('polyline');
      expect(polyline.dataset.color).toBe('#007bff'); // Blue for normal
    });

    it('displays distance in route popup', () => {
      const routes: MapRoute[] = [
        {
          id: 'route-1',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.78, lng: -122.42 },
          ],
          distance: 2500, // 2.5 km
        },
      ];

      render(<Map {...defaultProps} routes={routes} />);
      
      expect(screen.getByText(/2\.5 km/)).toBeInTheDocument();
    });

    it('displays duration in route popup', () => {
      const routes: MapRoute[] = [
        {
          id: 'route-1',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.78, lng: -122.42 },
          ],
          distance: 2500,
          duration: 900, // 15 minutes
        },
      ];

      render(<Map {...defaultProps} routes={routes} />);
      
      expect(screen.getByText(/15 min/)).toBeInTheDocument();
    });
  });

  describe('Map View Control', () => {
    it('accepts mapView prop', () => {
      const mapView: MapView = {
        center: { lat: 40.7128, lng: -74.006 },
        zoom: 15,
        animate: true,
      };

      render(<Map {...defaultProps} mapView={mapView} />);
      
      expect(screen.getByTestId('map-container')).toBeInTheDocument();
    });
  });

  describe('User Avatar', () => {
    it('renders user marker with custom styling', () => {
      render(<Map {...defaultProps} />);
      
      const markers = screen.getAllByTestId('marker');
      // First marker should be user location
      expect(markers[0]).toBeInTheDocument();
    });
  });

  describe('Multiple Markers and Routes', () => {
    it('handles many markers efficiently', () => {
      const markers: MapMarker[] = Array.from({ length: 20 }, (_, i) => ({
        id: `marker-${i}`,
        name: `Venue ${i}`,
        position: { lat: 37.7749 + i * 0.01, lng: -122.4194 + i * 0.01 },
        category: 'cafe',
      }));

      render(<Map {...defaultProps} markers={markers} />);
      
      // User marker + 20 venue markers
      const allMarkers = screen.getAllByTestId('marker');
      expect(allMarkers.length).toBe(21);
    });

    it('handles multiple routes', () => {
      const routes: MapRoute[] = [
        {
          id: 'route-1',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.78, lng: -122.42 },
          ],
        },
        {
          id: 'route-2',
          path: [
            { lat: 37.7749, lng: -122.4194 },
            { lat: 37.79, lng: -122.43 },
          ],
        },
      ];

      render(<Map {...defaultProps} routes={routes} />);
      
      const polylines = screen.getAllByTestId('polyline');
      expect(polylines.length).toBe(2);
    });
  });

  describe('Styling', () => {
    it('applies correct container styles', () => {
      render(<Map {...defaultProps} />);
      
      const mapContainer = screen.getByTestId('map-container');
      expect(mapContainer).toHaveStyle({ width: '95%', height: '95%' });
    });
  });
});
