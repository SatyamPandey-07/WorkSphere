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
    expect(screen.getByRole("dialog", { name: /cookie consent/i })).toBeInTheDocument();
  });

  it("does NOT render when consent is already stored", () => {
    localStorage.setItem(STORAGE_KEY, "granted");
    render(<CookieBanner />);
    expect(screen.queryByRole("dialog", { name: /cookie consent/i })).not.toBeInTheDocument();
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
});
