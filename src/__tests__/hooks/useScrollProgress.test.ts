import { renderHook, act } from "@testing-library/react";
import { useScrollProgress } from "@/hooks/useScrollProgress";

describe("useScrollProgress hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calculates window scroll progress by default", () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(window, "scrollY", {
      value: 500,
      configurable: true,
    });

    const { result } = renderHook(() => useScrollProgress());

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    // 500 / (2000 - 1000) = 50%
    expect(result.current).toBe(50);
  });

  it("calculates scroll progress for a nested targetRef container", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", {
      value: 1500,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(container, "scrollTop", {
      value: 250,
      configurable: true,
    });

    const targetRef = { current: container };

    const { result } = renderHook(() =>
      useScrollProgress({ targetRef })
    );

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    // 250 / (1500 - 500) = 25%
    expect(result.current).toBe(25);
  });

  it("respects threshold and rootMargin offsets on container", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "scrollHeight", {
      value: 1500,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(container, "scrollTop", {
      value: 300,
      configurable: true,
    });

    const targetRef = { current: container };

    const { result } = renderHook(() =>
      useScrollProgress({
        targetRef,
        threshold: 50,
        rootMargin: 50,
      })
    );

    act(() => {
      container.dispatchEvent(new Event("scroll"));
    });

    // effectiveScroll = 300 - (50 + 50) = 200
    // maxScrollable = 1500 - 500 - 50 = 950
    // (200 / 950) * 100 ~= 21.05
    expect(result.current).toBeCloseTo(21.05, 1);
  });
});
