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
      Object.defineProperty(window, "scrollY", { configurable: true, value: 350 });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("opacity-100");
    expect(btn).not.toHaveClass("pointer-events-none");
  });

  it("is not visible when scrollY is exactly 300px", () => {
    render(<ScrollToTopButton />);

    act(() => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 300 });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("opacity-0");
  });

  it("hides again when user scrolls back above 300px", () => {
    render(<ScrollToTopButton />);

    // Scroll down
    act(() => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 400 });
      fireEvent.scroll(window);
    });

    // Scroll back up
    act(() => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 100 });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveClass("opacity-0");
  });

  it("calls window.scrollTo with smooth behavior on click", () => {
    render(<ScrollToTopButton />);

    act(() => {
      Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
      fireEvent.scroll(window);
    });

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    fireEvent.click(btn);

    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  });

  it("has the correct aria-label for accessibility", () => {
    render(<ScrollToTopButton />);

    const btn = screen.getByRole("button", { name: "Scroll to top of page" });
    expect(btn).toHaveAttribute("aria-label", "Scroll to top of page");
  });

  it("has the id scroll-to-top-btn for browser testing", () => {
    render(<ScrollToTopButton />);
    expect(document.getElementById("scroll-to-top-btn")).toBeInTheDocument();
  });
});
