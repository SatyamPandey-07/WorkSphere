import React from "react";
import { render, act } from "@testing-library/react";
import Map from "@/components/Map";

// Mock Clerk
jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: { id: "test-user" },
  }),
  useAuth: () => ({
    getToken: jest.fn().mockResolvedValue(null),
  }),
}));

// Mock PartySocket
jest.mock("partysocket/react", () => {
  return jest.fn(() => ({
    send: jest.fn(),
    readyState: 1,
  }));
});

// Mock react-leaflet
const mockInvalidateSize = jest.fn();
const mockSetView = jest.fn();
const mockGetCenter = jest.fn().mockReturnValue({ lat: 37.7749, lng: -122.4194 });
const mockGetZoom = jest.fn().mockReturnValue(13);
let mockMapContainerElement: HTMLDivElement | null = null;

jest.mock("react-leaflet", () => {
  const original = jest.requireActual("react-leaflet");
  return {
    ...original,
    MapContainer: ({ children }: any) => {
      mockMapContainerElement = document.createElement("div");
      return (
        <div data-testid="mock-map-container" ref={(el) => {
          if (el) mockMapContainerElement = el;
        }}>
          {children}
        </div>
      );
    },
    useMap: () => ({
      invalidateSize: mockInvalidateSize,
      setView: mockSetView,
      getCenter: mockGetCenter,
      getZoom: mockGetZoom,
      getContainer: () => mockMapContainerElement || document.createElement("div"),
      on: jest.fn(),
      off: jest.fn(),
    }),
    TileLayer: () => <div data-testid="tile-layer" />,
    Marker: () => <div data-testid="marker" />,
    Popup: ({ children }: any) => <div>{children}</div>,
    LayersControl: Object.assign(({ children }: any) => <div>{children}</div>, {
      BaseLayer: ({ children }: any) => <div>{children}</div>,
      Overlay: ({ children }: any) => <div>{children}</div>,
    }),
    LayerGroup: ({ children }: any) => <div>{children}</div>,
  };
});

describe("Mapbox & Leaflet Sidebar ResizeObserver Workaround (#10425)", () => {
  let originalResizeObserver: any;
  let observeCallback: ((entries: any[], observer: any) => void) | null = null;
  let mockObserve: jest.Mock;
  let mockDisconnect: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockObserve = jest.fn();
    mockDisconnect = jest.fn();
    observeCallback = null;

    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver = class MockResizeObserver {
      constructor(callback: any) {
        observeCallback = callback;
      }
      observe = mockObserve;
      unobserve = jest.fn();
      disconnect = mockDisconnect;
    } as any;
  });

  afterEach(() => {
    global.ResizeObserver = originalResizeObserver;
    jest.useRealTimers();
  });

  it("1. attaches ResizeObserver to the map container element upon mount", () => {
    render(<Map />);

    expect(mockObserve).toHaveBeenCalled();
  });

  it("2. calls map.invalidateSize() and preserves map center when sidebar triggers container resize", () => {
    render(<Map />);

    expect(observeCallback).not.toBeNull();

    // Simulate sidebar animation / opening causing container resize entry
    act(() => {
      observeCallback!([{ contentRect: { width: 800, height: 600 } }], {} as any);
    });

    // Advance debounced resize timer (150ms default)
    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
    expect(mockSetView).toHaveBeenCalledWith(
      { lat: 37.7749, lng: -122.4194 },
      13,
      { animate: false },
    );
  });

  it("3. debounces rapid sidebar width shifts to avoid recalculation thrashing", () => {
    render(<Map />);

    // Multiple rapid resizes during CSS transition / frame animation
    act(() => {
      observeCallback!([], {} as any);
      jest.advanceTimersByTime(50);
      observeCallback!([], {} as any);
      jest.advanceTimersByTime(50);
      observeCallback!([], {} as any);
    });

    // Before debounce delay finishes, no invalidateSize calls should fire
    expect(mockInvalidateSize).not.toHaveBeenCalled();

    // After debounce finishes
    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
  });

  it("4. disconnects ResizeObserver cleanly when map unmounts", () => {
    const { unmount } = render(<Map />);

    unmount();

    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("5. falls back to window resize events when ResizeObserver is unavailable", () => {
    // Disable ResizeObserver
    delete (global as any).ResizeObserver;

    render(<Map />);

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
  });
});
