import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { VenueShareModal } from "@/components/venue/VenueShareModal";
import * as svgQrModule from "@/lib/qr/svgQr";

const mockToast = jest.fn();
jest.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("framer-motion", () => {
  const React = require("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: React.forwardRef(
        (
          {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            ...props
          }: React.HTMLAttributes<HTMLDivElement> & Record<string, unknown>,
          ref: React.Ref<HTMLDivElement>,
        ) => <div ref={ref} {...props} />,
      ),
      span: React.forwardRef(
        (
          {
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            ...props
          }: React.HTMLAttributes<HTMLSpanElement> & Record<string, unknown>,
          ref: React.Ref<HTMLSpanElement>,
        ) => <span ref={ref} {...props} />,
      ),
    },
  };
});

describe("VenueShareModal Component (#4402)", () => {
  const originalExecCommand = document.execCommand;
  const mockVenue = {
    id: "venue-123",
    name: "Cafe Artisan",
    address: "123 Coffee Way",
    category: "cafe",
    imageUrl: "https://example.com/cafe.jpg",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockToast.mockClear();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
    document.execCommand = jest.fn().mockReturnValue(true);
  });

  afterAll(() => {
    document.execCommand = originalExecCommand;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("calls navigator.share when available", async () => {
    const shareMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share: shareMock });

    render(<VenueShareModal venue={mockVenue} />);

    const shareBtn = screen.getByRole("button", {
      name: /share cafe artisan/i,
    });
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalledWith({
        title: "Cafe Artisan | WorkSphere",
        text: "Check out Cafe Artisan on WorkSphere!",
        url: expect.stringContaining("/venues/venue-123"),
      });
    });

    // Modal should not be open if native share succeeds
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not open modal if user aborts native share sheet", async () => {
    const abortError = new Error("Share canceled");
    abortError.name = "AbortError";
    const shareMock = jest.fn().mockRejectedValue(abortError);
    Object.assign(navigator, { share: shareMock });

    render(<VenueShareModal venue={mockVenue} />);

    const shareBtn = screen.getByRole("button", {
      name: /share cafe artisan/i,
    });
    fireEvent.click(shareBtn);

    await waitFor(() => {
      expect(shareMock).toHaveBeenCalled();
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens desktop fallback modal when navigator.share is undefined", async () => {
    // Delete navigator.share to simulate desktop browser without Web Share API
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);

    const shareBtn = screen.getByRole("button", {
      name: /share cafe artisan/i,
    });
    fireEvent.click(shareBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Share Venue" }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue(/\/venues\/venue-123/)).toBeInTheDocument();
  });

  it("allows copying shortlink to clipboard and shows animated tooltip confirmation", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );

    const copyBtn = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/venues/venue-123"),
      );
      expect(screen.getByText("Copied")).toBeInTheDocument();
      expect(screen.getByTestId("copy-check-icon")).toBeInTheDocument();
      expect(screen.getByTestId("copy-clipboard-tooltip")).toHaveTextContent(
        "Link copied to clipboard! 🚀",
      );
      expect(screen.getByTestId("copy-live-region")).toHaveAttribute(
        "aria-live",
        "polite",
      );
      expect(screen.getByTestId("copy-live-region")).toHaveTextContent(
        "Link copied to clipboard! 🚀",
      );
      expect(mockToast).toHaveBeenCalledWith(
        "Copied to clipboard!",
        "success",
      );
    });
  });

  it("renders an accessible copy button and copies the exact displayed URL", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));

    const urlInput = screen.getByDisplayValue(/\/venues\/venue-123/) as HTMLInputElement;
    const copyBtn = screen.getByRole("button", { name: "Copy share link" });

    expect(copyBtn).toHaveAttribute("title", "Copy share link");
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(urlInput.value);
    });
  });

  it("falls back to execCommand when clipboard access is unavailable", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    Object.assign(navigator, { clipboard: undefined });
    const execCommand = document.execCommand as jest.Mock;

    render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));

    await waitFor(() => {
      expect(execCommand).toHaveBeenCalledWith("copy");
      expect(mockToast).toHaveBeenCalledWith("Copied to clipboard!", "success");
    });
  });

  it("falls back after clipboard write failure and reports an error when copying fails", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockRejectedValue(new Error("Denied")) },
    });
    document.execCommand = jest.fn().mockReturnValue(false);

    render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Unable to copy to clipboard",
        "error",
      );
    });
  });

  it("allows downloading the SVG QR code", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    const downloadSpy = jest
      .spyOn(svgQrModule, "downloadSVG")
      .mockImplementation(() => {});

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );

    const downloadBtn = screen.getByRole("button", { name: /download svg/i });
    fireEvent.click(downloadBtn);

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringContaining("<svg"),
      "cafe-artisan-qr.svg",
    );

    downloadSpy.mockRestore();
  });

  it("closes modal on close button click and escape key press", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: /close dialog/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Reopen and test escape key
    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("stacking context and focus (#7613)", () => {
  const mockVenue = {
    id: "venue-123",
    name: "Cafe Artisan",
    address: "123 Coffee Way",
    category: "cafe",
    imageUrl: "https://example.com/cafe.jpg",
  };

  const openFromHeroWrapper = () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    // Mirrors the venue page, where the trigger sits inside a positioned,
    // z-indexed wrapper that creates its own stacking context.
    render(
      <div data-testid="hero-wrapper" className="absolute top-4 right-4 z-10">
        <VenueShareModal venue={mockVenue} variant="hero" />
      </div>,
    );

    const shareBtn = screen.getByRole("button", {
      name: /share cafe artisan/i,
    });
    shareBtn.focus();
    fireEvent.click(shareBtn);
    return { shareBtn, dialog: screen.getByRole("dialog") };
  };

  it("portals the backdrop to document.body, outside the z-indexed wrapper", () => {
    const { dialog } = openFromHeroWrapper();

    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByTestId("hero-wrapper")).not.toContainElement(dialog);
    expect(dialog).toHaveClass("fixed", "inset-0", "z-[60]");
  });

  it("moves focus into the dialog and keeps Tab / Shift+Tab inside it", async () => {
    openFromHeroWrapper();
    const closeBtn = screen.getByRole("button", { name: /close dialog/i });
    const downloadBtn = screen.getByRole("button", { name: /download svg/i });

    await waitFor(() => expect(closeBtn).toHaveFocus());

    downloadBtn.focus();
    fireEvent.keyDown(downloadBtn, { key: "Tab" });
    expect(closeBtn).toHaveFocus();

    fireEvent.keyDown(closeBtn, { key: "Tab", shiftKey: true });
    expect(downloadBtn).toHaveFocus();
  });

  it("still closes on Escape and returns focus to the share button", async () => {
    const { shareBtn } = openFromHeroWrapper();
    const closeBtn = screen.getByRole("button", { name: /close dialog/i });
    await waitFor(() => expect(closeBtn).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(shareBtn).toHaveFocus();
  });
});

