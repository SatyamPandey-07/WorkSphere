import React from "react";
import { render, act, screen } from "@testing-library/react";
import { useElementVisibility } from "@/hooks/useElementVisibility";

function TestHarness() {
  const { ref, isVisible, isDocumentVisible, isInViewport } =
    useElementVisibility<HTMLDivElement>();

  return (
    <div ref={ref} data-testid="visibility-target">
      <span data-testid="is-visible">{String(isVisible)}</span>
      <span data-testid="doc-visible">{String(isDocumentVisible)}</span>
      <span data-testid="in-viewport">{String(isInViewport)}</span>
    </div>
  );
}

describe("useElementVisibility", () => {
  let intersectionCallback: IntersectionObserverCallback | null = null;
  const observeMock = jest.fn();
  const disconnectMock = jest.fn();

  beforeEach(() => {
    intersectionCallback = null;
    observeMock.mockClear();
    disconnectMock.mockClear();

    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });

    (
      window as unknown as { IntersectionObserver: unknown }
    ).IntersectionObserver = jest.fn((cb: IntersectionObserverCallback) => {
      intersectionCallback = cb;
      return {
        observe: observeMock,
        unobserve: jest.fn(),
        disconnect: disconnectMock,
        takeRecords: jest.fn(() => []),
        root: null,
        rootMargin: "",
        thresholds: [0.05],
      };
    });
  });

  it("pauses when document.visibilityState becomes hidden and resumes on visible", () => {
    render(<TestHarness />);

    expect(screen.getByTestId("is-visible").textContent).toBe("true");

    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByTestId("doc-visible").textContent).toBe("false");
    expect(screen.getByTestId("is-visible").textContent).toBe("false");

    act(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(screen.getByTestId("doc-visible").textContent).toBe("true");
    expect(screen.getByTestId("is-visible").textContent).toBe("true");
  });

  it("pauses when IntersectionObserver reports element scrolled off-screen and resumes on re-entry", () => {
    render(<TestHarness />);

    expect(observeMock).toHaveBeenCalledTimes(1);
    expect(intersectionCallback).not.toBeNull();

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByTestId("in-viewport").textContent).toBe("false");
    expect(screen.getByTestId("is-visible").textContent).toBe("false");

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(screen.getByTestId("in-viewport").textContent).toBe("true");
    expect(screen.getByTestId("is-visible").textContent).toBe("true");
  });

  it("disconnects IntersectionObserver and cleans up listeners on unmount", () => {
    const { unmount } = render(<TestHarness />);
    unmount();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});
