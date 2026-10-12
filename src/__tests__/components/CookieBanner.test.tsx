import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock next/link so it renders as a plain anchor in tests
jest.mock("next/link", () => {
  return function MockLink({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  };
});

import { CookieBanner } from "@/components/CookieBanner";

const STORAGE_KEY = "worksphere-cookie-consent";

describe("CookieBanner", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("exports CookieBanner component", () => {
    expect(CookieBanner).toBeDefined();
    expect(typeof CookieBanner).toBe("function");
  });

  it("renders the banner when no consent is stored", () => {
    render(<CookieBanner />);
    expect(
      screen.getByRole("dialog", { name: /cookie consent/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render when consent is already stored", () => {
    localStorage.setItem(STORAGE_KEY, "granted");
    render(<CookieBanner />);
    expect(
      screen.queryByRole("dialog", { name: /cookie consent/i }),
    ).not.toBeInTheDocument();
  });

  it("hides the banner and stores 'granted' when Accept is clicked", () => {
    render(<CookieBanner />);
    fireEvent.click(screen.getByRole("button", { name: /accept all/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("granted");
  });

  it("hides the banner and stores 'declined' when Decline is clicked", () => {
    render(<CookieBanner />);
    fireEvent.click(screen.getByRole("button", { name: /decline/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("declined");
  });

  it("renders a link to the Privacy Policy", () => {
    render(<CookieBanner />);
    const link = screen.getByRole("link", { name: /privacy policy/i });
    expect(link).toHaveAttribute("href", "/privacy");
  });

  describe("prefers-reduced-motion compliance", () => {
    const originalMatchMedia = window.matchMedia;

    afterEach(() => {
      window.matchMedia = originalMatchMedia;
    });

    it("detects prefers-reduced-motion: reduce via window.matchMedia and disables transform motion", () => {
      window.matchMedia = jest.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion: reduce"),
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      render(<CookieBanner />);
      const dialog = screen.getByRole("dialog", { name: /cookie consent/i });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("data-reduced-motion", "true");
    });

    it("enables standard motion when prefers-reduced-motion is not requested", () => {
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

      render(<CookieBanner />);
      const dialog = screen.getByRole("dialog", { name: /cookie consent/i });
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("data-reduced-motion", "false");
    });

    it("respects explicit reducedMotion prop override", () => {
      render(<CookieBanner reducedMotion={true} />);
      const dialog = screen.getByRole("dialog", { name: /cookie consent/i });
      expect(dialog).toHaveAttribute("data-reduced-motion", "true");
    });
  });

  describe("automated accessibility (axe-core)", () => {
    it("satisfies axe-core accessibility compliance without violations", async () => {
      const axe = await import("axe-core");
      const { container } = render(<CookieBanner />);
      const results = await axe.run(container);
      expect(results.violations).toEqual([]);
    });

    it("satisfies axe-core accessibility compliance in reduced-motion mode", async () => {
      const axe = await import("axe-core");
      const { container } = render(<CookieBanner reducedMotion={true} />);
      const results = await axe.run(container);
      expect(results.violations).toEqual([]);
    });
  });
});
