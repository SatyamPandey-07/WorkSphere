import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { Footer } from "@/components/layout/Footer";
import { HIGH_CONTRAST_STORAGE_KEY } from "@/components/HighContrastToggle";

describe("Footer Component", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-high-contrast");

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
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-high-contrast");
  });

  it("renders the footer landmark with navigation label", () => {
    render(<Footer />);
    const footer = screen.getByRole("contentinfo");
    expect(footer).toBeInTheDocument();
    expect(footer).toHaveAttribute("aria-label", "Footer Navigation");
  });

  it("renders the High Contrast switch in footer", () => {
    render(<Footer />);
    const switchControl = screen.getByRole("switch", {
      name: /high contrast/i,
    });
    expect(switchControl).toBeInTheDocument();
    expect(screen.getByText("High Contrast")).toBeInTheDocument();
  });

  it("toggles high contrast mode on click and adds data-high-contrast to <html>", () => {
    render(<Footer />);
    const switchControl = screen.getByRole("switch", {
      name: /high contrast/i,
    });
    expect(switchControl).toHaveAttribute("aria-checked", "false");
    expect(
      document.documentElement.getAttribute("data-high-contrast"),
    ).toBeNull();

    // Toggle ON
    fireEvent.click(switchControl);

    expect(switchControl).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe(
      "true",
    );
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      true,
    );
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe("true");

    // Toggle OFF
    fireEvent.click(switchControl);

    expect(switchControl).toHaveAttribute("aria-checked", "false");
    expect(
      document.documentElement.getAttribute("data-high-contrast"),
    ).toBeNull();
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      false,
    );
    expect(localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY)).toBe("false");
  });

  it("initializes switch state from localStorage when already enabled", () => {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, "true");

    render(<Footer />);
    const switchControl = screen.getByRole("switch", {
      name: /high contrast/i,
    });
    expect(switchControl).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.getAttribute("data-high-contrast")).toBe(
      "true",
    );
    expect(document.documentElement.classList.contains("high-contrast")).toBe(
      true,
    );
  });
});
