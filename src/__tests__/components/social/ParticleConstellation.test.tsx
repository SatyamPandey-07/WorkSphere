/**
 * @jest-environment jsdom
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import ParticleConstellation from "@/components/social/ParticleConstellation";

interface MockRendererInstance {
  options: Record<string, unknown>;
  resize: jest.Mock;
  tick: jest.Mock;
  render: jest.Mock;
  destroy: jest.Mock;
}

const mockRendererInstances: MockRendererInstance[] = [];
let mockSupported = true;

jest.mock("@/lib/webgl/ParticleConstellationRenderer", () => {
  class MockParticleConstellationRenderer {
    supported = mockSupported;
    options: Record<string, unknown>;
    resize = jest.fn();
    setPointer = jest.fn();
    clearPointer = jest.fn();
    zoomAt = jest.fn();
    panBy = jest.fn();
    beginPan = jest.fn();
    movePan = jest.fn();
    endPan = jest.fn();
    tick = jest.fn();
    render = jest.fn();
    destroy = jest.fn();

    constructor(
      _canvas: HTMLCanvasElement,
      options: Record<string, unknown> = {},
    ) {
      this.options = options;
      mockRendererInstances.push(this);
    }
  }

  return {
    ParticleConstellationRenderer: MockParticleConstellationRenderer,
  };
});

type GlobalWithMocks = typeof globalThis & {
  ResizeObserver?: unknown;
  requestAnimationFrame?: unknown;
  cancelAnimationFrame?: unknown;
};

const globalWithMocks = globalThis as GlobalWithMocks;
const originalResizeObserver = globalWithMocks.ResizeObserver;
const originalRequestAnimationFrame = globalWithMocks.requestAnimationFrame;
const originalCancelAnimationFrame = globalWithMocks.cancelAnimationFrame;
const originalDprDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "devicePixelRatio",
);

function restoreDpr(): void {
  if (originalDprDescriptor) {
    Object.defineProperty(window, "devicePixelRatio", originalDprDescriptor);
  } else {
    delete (window as Window & { devicePixelRatio?: number })
      .devicePixelRatio;
  }
}

function stubAnimationFrame(): void {
  globalWithMocks.requestAnimationFrame = jest.fn(() => 1);
  globalWithMocks.cancelAnimationFrame = jest.fn();
}

function stubBoundingRect(width = 640, height = 360): void {
  jest
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({
      width,
      height,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
}

describe("ParticleConstellation component (#7334)", () => {
  beforeEach(() => {
    mockRendererInstances.length = 0;
    mockSupported = true;
    stubAnimationFrame();
  });

  afterEach(() => {
    globalWithMocks.ResizeObserver = originalResizeObserver;
    globalWithMocks.requestAnimationFrame = originalRequestAnimationFrame;
    globalWithMocks.cancelAnimationFrame = originalCancelAnimationFrame;
    restoreDpr();
    jest.restoreAllMocks();
  });

  it("mounts 10,000 nodes, shows the HUD, and resizes with DPR awareness", () => {
    const callbacks: ResizeObserverCallback[] = [];
    class MockResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalWithMocks.ResizeObserver = MockResizeObserver;
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: 2,
    });
    stubBoundingRect(640, 360);

    const { unmount } = render(
      <ParticleConstellation nodeCount={10_000} />,
    );

    expect(
      screen.getByTestId("particle-constellation-canvas"),
    ).toBeInTheDocument();
    expect(screen.getByText(/10,000 NODES/)).toBeInTheDocument();
    expect(screen.getByText(/NOMAD/)).toBeInTheDocument();

    const renderer = mockRendererInstances[0];
    expect(renderer.options).toMatchObject({ nodeCount: 10_000 });
    expect(renderer.resize).toHaveBeenCalledWith(640, 360, 2);

    stubBoundingRect(320, 180);
    expect(callbacks).toHaveLength(1);
    callbacks[0]([], {} as ResizeObserver);
    expect(renderer.resize).toHaveBeenLastCalledWith(320, 180, 2);

    unmount();
    expect(renderer.destroy).toHaveBeenCalled();
  });

  it("hides the HUD when requested", () => {
    stubBoundingRect();
    render(<ParticleConstellation nodeCount={1_000} showHud={false} />);

    expect(screen.queryByText(/NODES/)).not.toBeInTheDocument();
    expect(screen.queryByText(/drag to pan/i)).not.toBeInTheDocument();
  });

  it("shows the fallback and accessible label when WebGL2 is unavailable", async () => {
    mockSupported = false;
    stubBoundingRect();

    const { unmount } = render(
      <ParticleConstellation nodeCount={10_000} />,
    );

    const canvas = screen.getByTestId("particle-constellation-canvas");
    expect(canvas).toHaveAttribute("role", "img");
    expect(canvas).toHaveAttribute(
      "aria-label",
      expect.stringContaining("WebGL constellation"),
    );

    expect(
      await screen.findByText(/WebGL 2.0 is required/i),
    ).toBeInTheDocument();

    expect(() => unmount()).not.toThrow();
  });
});
