import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { InteractiveMap } from "@/components/chat/InteractiveMap";

const mockInvalidateSize = jest.fn();

jest.mock("react-leaflet", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  const MockMapContainer = React.forwardRef(
    (
      { children }: { children: React.ReactNode },
      ref: React.ForwardedRef<{ invalidateSize: typeof mockInvalidateSize }>,
    ) => {
      React.useImperativeHandle(
        ref,
        () => ({ invalidateSize: mockInvalidateSize }),
        [],
      );
      return <div data-testid="mock-map-container">{children}</div>;
    },
  );
  MockMapContainer.displayName = "MockMapContainer";

  return {
    MapContainer: MockMapContainer,
    TileLayer: () => null,
    Marker: () => null,
    Popup: () => null,
    Circle: () => null,
  };
});

jest.mock("leaflet", () => {
  function DefaultIcon() {}
  DefaultIcon.prototype = {};
  const MockDefaultIcon = Object.assign(DefaultIcon, {
    mergeOptions: jest.fn(),
  });

  return {
    Icon: { Default: MockDefaultIcon },
    divIcon: jest.fn(() => ({})),
  };
});

interface MockResizeObserver {
  callback: ResizeObserverCallback;
  observe: jest.Mock;
  disconnect: jest.Mock;
  target: Element | null;
  emit: (width: number, height: number) => void;
}

const originalResizeObserverDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "ResizeObserver",
);
const originalRequestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "requestAnimationFrame",
);
const originalCancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "cancelAnimationFrame",
);
const originalGeolocationDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "geolocation",
);

let observers: MockResizeObserver[] = [];
let scheduledFrames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

function installBrowserMocks(): void {
  observers = [];
  scheduledFrames = new Map();
  nextFrameId = 1;

  class MockResizeObserverImplementation {
    private mockObserver: MockResizeObserver;

    constructor(callback: ResizeObserverCallback) {
      this.mockObserver = {
        callback,
        observe: jest.fn((target: Element) => {
          this.mockObserver.target = target;
        }),
        disconnect: jest.fn(),
        target: null,
        emit: (width, height) => {
          const entry = {
            contentRect: { width, height },
            target: this.mockObserver.target,
          } as ResizeObserverEntry;
          this.mockObserver.callback(
            [entry],
            this as unknown as ResizeObserver,
          );
        },
      };
      observers.push(this.mockObserver);
    }

    observe(target: Element): void {
      this.mockObserver.observe(target);
    }

    disconnect(): void {
      this.mockObserver.disconnect();
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    value: MockResizeObserverImplementation,
  });
  Object.defineProperty(window, "requestAnimationFrame", {
    configurable: true,
    value: jest.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      scheduledFrames.set(id, callback);
      return id;
    }),
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    configurable: true,
    value: jest.fn((id: number) => scheduledFrames.delete(id)),
  });
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      watchPosition: jest.fn(() => 1),
      clearWatch: jest.fn(),
    },
  });
}

function restoreDescriptor(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    Reflect.deleteProperty(target, key);
  }
}

function flushAnimationFrames(): void {
  const frames = Array.from(scheduledFrames.values());
  scheduledFrames.clear();
  act(() => {
    frames.forEach((callback) => callback(16));
  });
}

function renderInteractiveMap() {
  return render(
    <InteractiveMap
      markers={[{ lat: 37.7749, lng: -122.4194 }]}
      activeBooking={{
        status: "CHECKED_IN",
        venue: { latitude: 37.7749, longitude: -122.4194 },
      }}
    />,
  );
}

describe("InteractiveMap resize handling", () => {
  beforeEach(() => {
    installBrowserMocks();
    mockInvalidateSize.mockClear();
  });

  afterEach(() => {
    cleanup();
    restoreDescriptor(
      window,
      "ResizeObserver",
      originalResizeObserverDescriptor,
    );
    restoreDescriptor(
      window,
      "requestAnimationFrame",
      originalRequestAnimationFrameDescriptor,
    );
    restoreDescriptor(
      window,
      "cancelAnimationFrame",
      originalCancelAnimationFrameDescriptor,
    );
    restoreDescriptor(navigator, "geolocation", originalGeolocationDescriptor);
    jest.restoreAllMocks();
  });

  it("observes the map container and applies its initial dimensions", () => {
    renderInteractiveMap();

    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(
      screen.getByTestId("interactive-map"),
    );

    act(() => observers[0].emit(640, 360));
    flushAnimationFrames();

    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
    expect(mockInvalidateSize).toHaveBeenCalledWith({ pan: false });
  });

  it("applies width and height changes greater than two pixels", () => {
    renderInteractiveMap();

    act(() => observers[0].emit(640, 360));
    flushAnimationFrames();
    mockInvalidateSize.mockClear();

    act(() => observers[0].emit(643, 360));
    flushAnimationFrames();
    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);

    act(() => observers[0].emit(643, 364));
    flushAnimationFrames();
    expect(mockInvalidateSize).toHaveBeenCalledTimes(2);
  });

  it("ignores changes of two pixels or less and identical measurements", () => {
    renderInteractiveMap();

    act(() => observers[0].emit(640, 360));
    flushAnimationFrames();
    mockInvalidateSize.mockClear();

    act(() => observers[0].emit(642, 362));
    flushAnimationFrames();
    act(() => observers[0].emit(640, 360));
    flushAnimationFrames();
    act(() => observers[0].emit(640, 360));
    flushAnimationFrames();

    expect(mockInvalidateSize).not.toHaveBeenCalled();
  });

  it("coalesces multiple observer notifications into one animation frame", () => {
    renderInteractiveMap();

    act(() => {
      observers[0].emit(640, 360);
      observers[0].emit(642, 362);
      observers[0].emit(644, 364);
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    flushAnimationFrames();
    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);

    act(() => observers[0].emit(644, 364));
    flushAnimationFrames();
    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);
  });

  it("continues resizing after several meaningful dimension changes", () => {
    renderInteractiveMap();

    for (const [width, height] of [
      [640, 360],
      [800, 360],
      [800, 480],
      [1024, 600],
    ]) {
      act(() => observers[0].emit(width, height));
      flushAnimationFrames();
    }

    expect(mockInvalidateSize).toHaveBeenCalledTimes(4);
  });

  it("cancels pending work, disconnects, and ignores callbacks after unmount", () => {
    const { unmount } = renderInteractiveMap();
    act(() => observers[0].emit(640, 360));
    const pendingCallback = Array.from(scheduledFrames.values())[0];

    unmount();

    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(window.cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(scheduledFrames.size).toBe(0);

    act(() => pendingCallback?.(16));
    expect(mockInvalidateSize).not.toHaveBeenCalled();
  });

  it("disconnects the discarded observer during Strict Mode effect replay", () => {
    const { unmount } = render(
      <React.StrictMode>
        <InteractiveMap
          markers={[{ lat: 37.7749, lng: -122.4194 }]}
          activeBooking={{
            status: "CHECKED_IN",
            venue: { latitude: 37.7749, longitude: -122.4194 },
          }}
        />
      </React.StrictMode>,
    );

    expect(observers).toHaveLength(2);
    expect(observers[0].disconnect).toHaveBeenCalledTimes(1);
    expect(observers[1].disconnect).not.toHaveBeenCalled();

    act(() => observers[0].emit(640, 360));
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    act(() => observers[1].emit(640, 360));
    flushAnimationFrames();
    expect(mockInvalidateSize).toHaveBeenCalledTimes(1);

    unmount();
    expect(observers[1].disconnect).toHaveBeenCalledTimes(1);
  });
});
