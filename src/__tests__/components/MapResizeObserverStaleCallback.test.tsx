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
    MapContainer: ({ children, style }: any) => {
      mockMapContainerElement = document.createElement("div");
      Object.assign(mockMapContainerElement.style, style);
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
            if (el) mockMapContainerElement = el;
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
  };
});

describe("Map ResizeObserver Stale Callback Prevention (#10458)", () => {
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

  it("1. disconnects observer and prevents queued callbacks from executing after unmount", () => {
    const { unmount } = render(<Map />);
    expect(observeCallback).not.toBeNull();
    const savedCallback = observeCallback!;

    // Unmount component
    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);

    // Simulate browser dispatching an already-queued observer callback post-unmount
    act(() => {
      savedCallback([{ contentRect: { width: 800, height: 600 } }], {} as any);
    });

    // Advance any timers
    act(() => {
      jest.advanceTimersByTime(300);
    });

    // Map operations must NOT be called on unmounted instance
    expect(mockInvalidateSize).not.toHaveBeenCalled();
    expect(mockSetView).not.toHaveBeenCalled();
  });

  it("2. cancels pending animation-frame and timer callbacks when unmounted during transition", () => {
    const { unmount } = render(<Map />);

    // Trigger resize while mounted (starts debounce timer)
    act(() => {
      observeCallback!([{ contentRect: { width: 750, height: 600 } }], {} as any);
      jest.advanceTimersByTime(50); // halfway through 150ms debounce
    });

    // Unmount before debounce timer fires
    unmount();

    // Advance past original timer deadline
    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(mockInvalidateSize).not.toHaveBeenCalled();
    expect(mockSetView).not.toHaveBeenCalled();
  });

  it("3. handles rapid observer recreation without callbacks from old observer affecting new instance", () => {
    const { unmount } = render(<Map />);
    const firstCallback = observeCallback!;

    // Unmount first instance
    unmount();

    // Render second instance (recreating ResizeObserver)
    render(<Map />);
    const secondCallback = observeCallback!;

    // Firing stale callback from first observer instance must be safely ignored
    act(() => {
      firstCallback([{ contentRect: { width: 600, height: 400 } }], {} as any);
    });

    act(() => {
      jest.advanceTimersByTime(200);
    });

    expect(mockInvalidateSize).not.toHaveBeenCalled();

    // Firing callback from second active instance works as expected
    act(() => {
      secondCallback([{ contentRect: { width: 900, height: 700 } }], {} as any);
    });

    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
    expect(mockSetView).toHaveBeenCalledTimes(1);
  });

  it("4. performs normal resize and viewport preservation while component remains mounted", () => {
    render(<Map />);

    act(() => {
      observeCallback!([{ contentRect: { width: 800, height: 600 } }], {} as any);
    });

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
});
