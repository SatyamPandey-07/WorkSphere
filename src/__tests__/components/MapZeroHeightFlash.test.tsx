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

// Mock WebGL heatmap to isolate map resize behavior
jest.mock("@/components/WebGLHeatmapLayer", () => ({
  WebGLHeatmapLayer: () => null,
}));

// Mock react-leaflet
const mockInvalidateSize = jest.fn();
const mockSetView = jest.fn();
const mockGetCenter = jest
  .fn()
  .mockReturnValue({ lat: 37.7749, lng: -122.4194 });
const mockGetZoom = jest.fn().mockReturnValue(13);
let mockMapContainerElement: HTMLDivElement | null = null;

jest.mock("react-leaflet", () => {
  return {
    MapContainer: ({ children, style }: any) => {
      mockMapContainerElement = document.createElement("div");
      Object.assign(mockMapContainerElement.style, style);
      // Give initial default dimensions
      Object.defineProperty(mockMapContainerElement, "clientWidth", {
        writable: true,
        configurable: true,
        value: 800,
      });
      Object.defineProperty(mockMapContainerElement, "clientHeight", {
        writable: true,
        configurable: true,
        value: 600,
      });
      return (
        <div
          data-testid="mock-map-container"
          ref={(el) => {
            if (el) {
              mockMapContainerElement = el;
              Object.defineProperty(el, "clientWidth", {
                configurable: true,
                value: 800,
              });
              Object.defineProperty(el, "clientHeight", {
                configurable: true,
                value: 600,
              });
            }
          }}
          style={style}
        >
          {children}
        </div>
      );
    },
    useMap: () => ({
      invalidateSize: mockInvalidateSize,
      setView: mockSetView,
      getCenter: mockGetCenter,
      getZoom: mockGetZoom,
      getPanes: () => ({ overlayPane: document.createElement("div") }),
      getContainer: () => {
        if (!mockMapContainerElement) {
          mockMapContainerElement = document.createElement("div");
          Object.defineProperty(mockMapContainerElement, "clientWidth", {
            writable: true,
            configurable: true,
            value: 800,
          });
          Object.defineProperty(mockMapContainerElement, "clientHeight", {
            writable: true,
            configurable: true,
            value: 600,
          });
        }
        return mockMapContainerElement;
      },
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
    CircleMarker: ({ children }: any) => <div>{children}</div>,
    ScaleControl: () => null,
  };
});

describe("Map Zero-Height Flash Prevention (#10448)", () => {
  let originalResizeObserver: any;
  let observeCallback: ((entries: any[], observer: any) => void) | null = null;
  let mockObserve: jest.Mock;
  let mockDisconnect: jest.Mock;
  let originalRequestAnimationFrame: any;
  let originalCancelAnimationFrame: any;
  let rafCallbacks: Array<() => void> = [];

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    mockObserve = jest.fn();
    mockDisconnect = jest.fn();
    observeCallback = null;
    rafCallbacks = [];

    originalRequestAnimationFrame = global.requestAnimationFrame;
    originalCancelAnimationFrame = global.cancelAnimationFrame;

    global.requestAnimationFrame = (cb: FrameRequestCallback) => {
      const id = rafCallbacks.length + 1;
      rafCallbacks.push(() => cb(Date.now()));
      return id;
    };
    global.cancelAnimationFrame = jest.fn((id: number) => {
      if (rafCallbacks[id - 1]) {
        delete rafCallbacks[id - 1];
      }
    });

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
    global.requestAnimationFrame = originalRequestAnimationFrame;
    global.cancelAnimationFrame = originalCancelAnimationFrame;
    jest.useRealTimers();
  });

  it("1. ignores transient zero-height measurements during sidebar toggle animations", () => {
    render(<Map location={{ latitude: 37.7749, longitude: -122.4194 }} />);
    expect(observeCallback).not.toBeNull();

    // Trigger ResizeObserver with 0 height (as when sidebar starts folding)
    act(() => {
      observeCallback!([{ contentRect: { width: 800, height: 0 } }], {} as any);
    });

    // Advance debounce timers
    act(() => {
      jest.advanceTimersByTime(200);
    });

    // invalidateSize must NOT be called when height was measured as 0
    expect(mockInvalidateSize).not.toHaveBeenCalled();
  });

  it("2. recovers and resizes when dimensions normalize after transient zero-height frame", () => {
    render(<Map location={{ latitude: 37.7749, longitude: -122.4194 }} />);

    // First: zero-height event
    act(() => {
      observeCallback!([{ contentRect: { width: 800, height: 0 } }], {} as any);
    });

    expect(mockInvalidateSize).not.toHaveBeenCalled();

    // Next frame: dimension recovers to 800x600
    act(() => {
      observeCallback!(
        [{ contentRect: { width: 800, height: 600 } }],
        {} as any,
      );
    });

    // Advance debounce timer (150ms default)
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

  it("3. handles rapid toggles without race conditions or multiple premature invalidations", () => {
    render(<Map location={{ latitude: 37.7749, longitude: -122.4194 }} />);

    // Rapid toggle 1: sidebar opens
    act(() => {
      observeCallback!(
        [{ contentRect: { width: 600, height: 600 } }],
        {} as any,
      );
      jest.advanceTimersByTime(50);
    });

    // Rapid toggle 2: sidebar closes mid-animation (transient 0 height)
    act(() => {
      observeCallback!([{ contentRect: { width: 800, height: 0 } }], {} as any);
      jest.advanceTimersByTime(50);
    });

    // Rapid toggle 3: sidebar settles open
    act(() => {
      observeCallback!(
        [{ contentRect: { width: 700, height: 600 } }],
        {} as any,
      );
    });

    // Before debounce finishes: no invalidations
    expect(mockInvalidateSize).not.toHaveBeenCalled();

    // Advance past debounce delay
    act(() => {
      jest.advanceTimersByTime(150);
    });

    // Only the final settled dimensions triggered invalidation once
    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
  });

  it("4. cleans up ResizeObserver and cancels pending timers/animation frames on unmount", () => {
    const { unmount } = render(
      <Map location={{ latitude: 37.7749, longitude: -122.4194 }} />,
    );

    // Trigger resize that sets up a timer
    act(() => {
      observeCallback!(
        [{ contentRect: { width: 750, height: 600 } }],
        {} as any,
      );
    });

    unmount();

    expect(mockDisconnect).toHaveBeenCalled();

    // Advancing timers after unmount should not invoke invalidateSize
    act(() => {
      jest.advanceTimersByTime(300);
    });

    expect(mockInvalidateSize).not.toHaveBeenCalled();
  });

  it("5. ignores queued animation frames and stale observer callbacks after unmount", () => {
    const { unmount } = render(
      <Map location={{ latitude: 37.7749, longitude: -122.4194 }} />,
    );
    const staleObserverCallback = observeCallback!;

    // A transient zero-height measurement queues an animation frame.
    act(() => {
      staleObserverCallback(
        [{ contentRect: { width: 800, height: 0 } }],
        {} as any,
      );
    });

    expect(rafCallbacks[0]).toBeDefined();

    // Keep a reference to simulate a callback already queued by the browser.
    const queuedCallback = rafCallbacks[0];

    unmount();

    expect(mockDisconnect).toHaveBeenCalled();
    expect(global.cancelAnimationFrame).toHaveBeenCalledWith(1);

    // Even if the cancelled callback or stale observer fires, it must do no work.
    act(() => {
      queuedCallback();
      staleObserverCallback(
        [{ contentRect: { width: 800, height: 600 } }],
        {} as any,
      );
    });

    expect(mockInvalidateSize).not.toHaveBeenCalled();
    expect(rafCallbacks.filter(Boolean)).toHaveLength(0);
  });
  it("6. enforces minimum dimensions on map container style to prevent zero collapse", () => {
    const { getByTestId } = render(
      <Map location={{ latitude: 37.7749, longitude: -122.4194 }} />,
    );
    const container = getByTestId("mock-map-container");

    expect(container.style.minHeight).toBe("200px");
    expect(container.style.minWidth).toBe("200px");
  });
});
