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
        "Link copied to clipboard!",
        "success",
      );
    });
  });

  it.each([2, 3])(
    "only starts one clipboard operation for %i rapid clicks",
    async (clickCount) => {
      // @ts-expect-error - intentional test simulation
      delete (navigator as any).share;
      let resolveWrite: () => void = () => {};
      const writeText = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveWrite = resolve;
          }),
      );
      Object.assign(navigator, { clipboard: { writeText } });

      render(<VenueShareModal venue={mockVenue} />);
      fireEvent.click(
        screen.getByRole("button", { name: /share cafe artisan/i }),
      );

      const copyBtn = screen.getByRole("button", { name: /copy/i });
      act(() => {
        for (let click = 0; click < clickCount; click += 1) {
          fireEvent.click(copyBtn);
        }
      });

      expect(writeText).toHaveBeenCalledTimes(1);
      expect(copyBtn).toBeDisabled();

      await act(async () => {
        resolveWrite();
      });

      expect(screen.getByText("Copied")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /copied/i })).toBeEnabled();
    },
  );

  it("does not show stale copy confirmation after closing during a pending write", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    let resolveWrite: () => void = () => {};
    const writeText = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.assign(navigator, { clipboard: { writeText } });

    render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    fireEvent.click(screen.getByRole("button", { name: /close dialog/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await act(async () => {
      resolveWrite();
    });

    expect(mockToast).not.toHaveBeenCalledWith(
      "Link copied to clipboard!",
      "success",
    );
    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeEnabled();
    expect(
      screen.queryByTestId("copy-clipboard-tooltip"),
    ).not.toBeInTheDocument();
  });

  it("does not schedule confirmation after unmounting during a pending write", async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(window, "setTimeout");
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    let resolveWrite: () => void = () => {};
    const writeText = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.assign(navigator, { clipboard: { writeText } });

    const { unmount } = render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    unmount();
    expect(jest.getTimerCount()).toBe(0);

    await act(async () => {
      resolveWrite();
    });

    expect(
      setTimeoutSpy.mock.calls.some(([, delay]) => delay === 2000),
    ).toBe(false);
    expect(mockToast).not.toHaveBeenCalledWith(
      "Link copied to clipboard!",
      "success",
    );
    setTimeoutSpy.mockRestore();
  });

  it("dismisses copy tooltip and resets Copied state smoothly after 2000ms", async () => {
    jest.useFakeTimers();
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );

    const copyBtn = screen.getByRole("button", { name: /copy/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByTestId("copy-clipboard-tooltip")).toBeInTheDocument();
    expect(screen.getByText("Copied")).toBeInTheDocument();

    fireEvent.click(copyBtn);
    act(() => {
      jest.advanceTimersByTime(1999);
    });
    expect(screen.getByTestId("copy-clipboard-tooltip")).toBeInTheDocument();
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(
      screen.queryByTestId("copy-clipboard-tooltip"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
  });

  it("shows an error and does not display confirmation when clipboard and fallback fail", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Clipboard denied")),
      },
    });
    const execCommandMock = jest.fn().mockReturnValue(false);
    Object.assign(document, { execCommand: execCommandMock });
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Unable to copy to clipboard",
        "error",
      );
    });
    expect(
      screen.queryByTestId("copy-clipboard-tooltip"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy/i })).toBeEnabled();
    expect(execCommandMock).toHaveBeenCalledWith("copy");

    consoleError.mockRestore();
  });

  it("allows retrying after a failed clipboard operation", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    const writeText = jest
      .fn()
      .mockRejectedValueOnce(new Error("Clipboard denied"))
      .mockResolvedValueOnce(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const execCommandMock = jest.fn().mockReturnValue(false);
    Object.assign(document, { execCommand: execCommandMock });
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(<VenueShareModal venue={mockVenue} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Unable to copy to clipboard",
        "error",
      );
    });
    expect(screen.getByRole("button", { name: /copy/i })).toBeEnabled();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(execCommandMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    await waitFor(() => {
      expect(screen.getByTestId("copy-clipboard-tooltip")).toBeInTheDocument();
    });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Copied")).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith(
      "Link copied to clipboard!",
      "success",
    );
    consoleError.mockRestore();
  });

  it("falls back gracefully when navigator.clipboard.writeText is unavailable or throws", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Insecure context")),
      },
    });
    const execCommandMock = jest.fn().mockReturnValue(true);
    Object.assign(document, { execCommand: execCommandMock });

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(
      screen.getByRole("button", { name: /share cafe artisan/i }),
    );

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    await waitFor(() => {
      expect(execCommandMock).toHaveBeenCalledWith("copy");
      expect(screen.getByTestId("copy-clipboard-tooltip")).toHaveTextContent(
        "Link copied to clipboard! 🚀",
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

