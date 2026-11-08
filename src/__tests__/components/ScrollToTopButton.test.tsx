import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ScrollToTopButton } from "@/components/ui/ScrollToTopButton";

describe("ScrollToTopButton", () => {
  const originalScrollTo = window.scrollTo;
  const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

  beforeEach(() => {
    // Start each test at scroll position 0
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    window.scrollTo = jest.fn();
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    if (originalScrollY) {
      Object.defineProperty(window, "scrollY", originalScrollY);
    }
    jest.clearAllTimers();
  });

  it("is not visible when scrollY is 0", () => {
    render(<ScrollToTopButton />);

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    // Hidden: opacity-0 scale-75 pointer-events-none
    expect(btn).toHaveClass("opacity-0");
    expect(btn).toHaveClass("pointer-events-none");
  });

  it("becomes visible when scrollY exceeds 300px", () => {
    render(<ScrollToTopButton />);

    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 350,
      });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("opacity-100");
    expect(btn).not.toHaveClass("pointer-events-none");
  });

  it("is not visible when scrollY is exactly 300px", () => {
    render(<ScrollToTopButton />);

    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 300,
      });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("opacity-0");
  });

  it("hides again when user scrolls back above 300px", () => {
    render(<ScrollToTopButton />);

    // Scroll down
    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 400,
      });
      fireEvent.scroll(window);
    });

    // Scroll back up
    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 100,
      });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("opacity-0");
  });

  it("calls window.scrollTo with smooth behavior on click", () => {
    render(<ScrollToTopButton />);

    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 500,
      });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    fireEvent.click(btn);

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });
  });

  it("has the correct aria-label for accessibility", () => {
    render(<ScrollToTopButton />);

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveAttribute("aria-label", "Scroll to top of page");
  });

  it("has the id and data-testid scroll-to-top-btn for browser testing", () => {
    render(<ScrollToTopButton />);
    expect(document.getElementById("scroll-to-top-btn")).toBeInTheDocument();
    expect(screen.getByTestId("scroll-to-top-btn")).toBeInTheDocument();
  });

  it("respects custom scroll threshold prop", () => {
    render(<ScrollToTopButton threshold={150} />);

    // At 100px, hidden
    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 100,
      });
      fireEvent.scroll(window);
    });
    const btn = screen.getByTestId("scroll-to-top-btn");
    expect(btn).toHaveClass("opacity-0");

    // At 180px, visible
    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 180,
      });
      fireEvent.scroll(window);
    });
    expect(btn).toHaveClass("opacity-100");
  });

  it("supports custom className and ariaLabel props", () => {
    render(
      <ScrollToTopButton
        className="custom-top-class"
        ariaLabel="Back to top"
      />,
    );

    const btn = screen.getByTestId("scroll-to-top-btn");
    expect(btn).toHaveClass("custom-top-class");
    expect(btn).toHaveAttribute("aria-label", "Back to top");
  });

  it("exposes data-variant='default' when no variant is provided", () => {
    render(<ScrollToTopButton />);
    expect(screen.getByTestId("scroll-to-top-btn")).toHaveAttribute(
      "data-variant",
      "default",
    );
  });
});

// =============================================================================
// Lantern / Jet Thruster Variant (#6171)
// =============================================================================
describe("ScrollToTopButton — lantern variant (#6171)", () => {
  const originalScrollTo = window.scrollTo;
  const originalScrollY = Object.getOwnPropertyDescriptor(window, "scrollY");

  beforeEach(() => {
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 0,
    });
    window.scrollTo = jest.fn();
    jest.useFakeTimers();
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    if (originalScrollY) {
      Object.defineProperty(window, "scrollY", originalScrollY);
    }
    act(() => {
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  it("renders with data-variant='lantern' when variant='lantern' is passed", () => {
    render(<ScrollToTopButton variant="lantern" />);
    expect(screen.getByTestId("scroll-to-top-btn")).toHaveAttribute(
      "data-variant",
      "lantern",
    );
  });

  it("renders the jet thruster SVG icon in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);
    expect(screen.getByTestId("jet-thruster-icon")).toBeInTheDocument();
  });

  it("does NOT render jet-thruster-icon in default variant", () => {
    render(<ScrollToTopButton />);
    expect(
      screen.queryByTestId("jet-thruster-icon"),
    ).not.toBeInTheDocument();
  });

  it("calls window.scrollTo({ top: 0, behavior: 'smooth' }) on click in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);

    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 500,
      });
      fireEvent.scroll(window);
    });

    act(() => {
      fireEvent.click(screen.getByTestId("scroll-to-top-btn"));
    });

    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: "smooth",
    });

    // Advance timer to complete firing state
    act(() => {
      jest.advanceTimersByTime(500);
    });
  });

  it("triggers exhaust trail and afterburner flame on click in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);

    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 500,
      });
      fireEvent.scroll(window);
    });

    // Initially not firing
    expect(screen.queryByTestId("exhaust-trail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("afterburner-flame")).not.toBeInTheDocument();

    // Click triggers firing state
    act(() => {
      fireEvent.click(screen.getByTestId("scroll-to-top-btn"));
    });

    expect(screen.getByTestId("exhaust-trail")).toBeInTheDocument();
    expect(screen.getByTestId("afterburner-flame")).toBeInTheDocument();

    // After 500ms, exhaust trail and afterburner expire
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.queryByTestId("exhaust-trail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("afterburner-flame")).not.toBeInTheDocument();
  });

  it("preserves aria-label='Scroll to top of page' in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);
    expect(screen.getByTestId("scroll-to-top-btn")).toHaveAttribute(
      "aria-label",
      "Scroll to top of page",
    );
  });

  it("applies emerald border class to button in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);
    const btn = screen.getByTestId("scroll-to-top-btn");
    expect(btn.className).toMatch(/border-emerald/);
  });

  it("applies dark background to button in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);
    expect(screen.getByTestId("scroll-to-top-btn").className).toContain(
      "bg-zinc-900",
    );
  });

  it("becomes visible after scrolling past threshold in lantern variant", () => {
    render(<ScrollToTopButton variant="lantern" />);

    act(() => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 400,
      });
      fireEvent.scroll(window);
    });

    expect(screen.getByTestId("scroll-to-top-btn")).toHaveClass("opacity-100");
  });

  it("accepts custom className and merges it with lantern classes", () => {
    render(
      <ScrollToTopButton variant="lantern" className="custom-lantern" />,
    );
    expect(screen.getByTestId("scroll-to-top-btn").className).toContain(
      "custom-lantern",
    );
  });

  it("accepts custom ariaLabel in lantern variant", () => {
    render(
      <ScrollToTopButton variant="lantern" ariaLabel="Launch to top" />,
    );
    expect(screen.getByTestId("scroll-to-top-btn")).toHaveAttribute(
      "aria-label",
      "Launch to top",
    );
  });

  it("has keyboard focus ring and minimum touch target classes", () => {
    render(<ScrollToTopButton />);
    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("focus-visible:ring-2");
    expect(btn).toHaveClass("focus-visible:ring-primary");
    expect(btn).toHaveClass("focus-visible:outline-none");
    expect(btn).toHaveClass("min-h-[44px]");
    expect(btn).toHaveClass("min-w-[44px]");
  });
});
