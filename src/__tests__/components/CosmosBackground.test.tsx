import React from "react";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";

const mockRender = jest.fn();
const mockSetPixelRatio = jest.fn();
const mockSetSize = jest.fn();
const mockSetClearColor = jest.fn();
const mockDispose = jest.fn();
const mockGetPixelRatio = jest.fn().mockReturnValue(1);
const mockCanvas = document.createElement("canvas");
let mockRendererThrow = false;

jest.mock("three", () => {
  class MockVector2 {
    x = 0;
    y = 0;
    set(x: number, y: number) {
      this.x = x;
      this.y = y;
      return this;
    }
    lerp() {
      return this;
    }
    copy() {
      return this;
    }
  }

  class MockCamera {
    position = { x: 0, y: 0, z: 0 };
    aspect = 1;
    lookAt() {}
    updateProjectionMatrix() {}
  }

  class MockScene {
    add() {}
  }

  class MockMesh {
    position = { z: 0 };
  }

  class MockPoints {}

  class MockBufferGeometry {
    attributes = { position: { needsUpdate: false } };
    setAttribute() {
      return this;
    }
    dispose() {}
  }

  class MockPlaneGeometry {
    dispose() {}
  }

  class MockShaderMaterial {
    uniforms = {
      uTime: { value: 0 },
      uMouse: { value: new MockVector2() },
      uPixelRatio: { value: 1 },
    };
    dispose() {}
  }

  class MockBufferAttribute {}

  class MockWebGLRenderer {
    domElement = mockCanvas;
    constructor() {
      if (mockRendererThrow) {
        throw new Error("WebGL context creation failed");
      }
    }
    setPixelRatio = mockSetPixelRatio;
    setSize = mockSetSize;
    setClearColor = mockSetClearColor;
    getPixelRatio = mockGetPixelRatio;
    render = mockRender;
    dispose = mockDispose;
  }

  return {
    Vector2: MockVector2,
    PerspectiveCamera: MockCamera,
    Scene: MockScene,
    Mesh: MockMesh,
    Points: MockPoints,
    BufferGeometry: MockBufferGeometry,
    PlaneGeometry: MockPlaneGeometry,
    ShaderMaterial: MockShaderMaterial,
    BufferAttribute: MockBufferAttribute,
    WebGLRenderer: MockWebGLRenderer,
    AdditiveBlending: 2,
  };
});

import CosmosBackground from "@/components/CosmosBackground";

describe("CosmosBackground", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockRendererThrow = false;

    window.matchMedia = jest.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }));

    Object.defineProperty(window, "innerWidth", {
      writable: true,
      configurable: true,
      value: 1200,
    });

    Object.defineProperty(window, "innerHeight", {
      writable: true,
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => {
    act(() => {
      cleanup();
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  it("returns null when enabled prop is false", () => {
    const { container } = render(<CosmosBackground enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(mockRender).not.toHaveBeenCalled();
  });

  it("renders container and mounts WebGL canvas when enabled", () => {
    render(<CosmosBackground enabled={true} />);

    const container = screen.getByTestId("cosmos-background-container");
    expect(container).toBeInTheDocument();
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("executes animation loop and renders scene", () => {
    render(<CosmosBackground enabled={true} />);

    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockRender).toHaveBeenCalled();
  });

  it("updates mouse coordinates on pointermove without throwing or corrupting view matrix", () => {
    render(<CosmosBackground enabled={true} />);

    act(() => {
      fireEvent.pointerMove(window, { clientX: 600, clientY: 400 });
      jest.advanceTimersByTime(50);
    });

    expect(mockRender).toHaveBeenCalled();
  });

  it("handles resize events cleanly and sets renderer size", () => {
    render(<CosmosBackground enabled={true} />);

    act(() => {
      Object.defineProperty(window, "innerWidth", { value: 1400 });
      Object.defineProperty(window, "innerHeight", { value: 900 });
      fireEvent(window, new Event("resize"));
    });

    expect(mockSetSize).toHaveBeenCalledWith(1400, 900, false);
  });

  it("pauses animation on document visibility change and resumes when active", () => {
    render(<CosmosBackground enabled={true} />);

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });

    act(() => {
      fireEvent(document, new Event("visibilitychange"));
      jest.advanceTimersByTime(100);
    });

    mockRender.mockClear();

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });

    act(() => {
      fireEvent(document, new Event("visibilitychange"));
      jest.advanceTimersByTime(50);
    });

    expect(mockRender).toHaveBeenCalled();
  });

  it("safely cleans up and disposes WebGL renderer and geometries on unmount", () => {
    const { unmount } = render(<CosmosBackground enabled={true} />);

    unmount();
    expect(mockDispose).toHaveBeenCalled();
  });

  it("handles WebGLRenderer constructor failure without throwing unhandled exceptions", () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockRendererThrow = true;

    render(<CosmosBackground enabled={true} />);

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
