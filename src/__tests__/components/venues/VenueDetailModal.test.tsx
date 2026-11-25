import React from "react";
import { act, render, screen, fireEvent } from "@testing-library/react";
import {
  VenueDetailModal,
  VenueDetail,
} from "@/components/venues/VenueDetailModal";

describe("VenueDetailModal (Zero-CLS Reserved Hero Gallery)", () => {
  const sampleVenue: VenueDetail = {
    id: "venue-cls-1",
    name: "Third Wave Coffee Roasters",
    address: "Baner Road, Pune",
    category: "Work Cafe",
    rating: 4.7,
    reviewCount: 128,
    wifiSpeedMbps: 145,
    noiseDb: 48,
    outletDensity: 4,
    heroPhotoUrl: "https://images.pexels.com/photos/12345/cafe-hero.jpeg",
    description:
      "Bright corner seating with dedicated power strips and fiber Wi-Fi.",
  };

  test("reserves aspect-video container and displays skeleton shimmer until hero image finishes loading", () => {
    render(
      <VenueDetailModal
        venue={sampleVenue}
        isOpen={true}
        onClose={jest.fn()}
      />,
    );

    const galleryContainer = screen.getByTestId("venue-hero-gallery-container");
    expect(galleryContainer.className).toContain("aspect-video");

    // Before image finishes downloading: skeleton shimmer is mounted and img is opacity-0
    const skeleton = screen.getByTestId("venue-hero-skeleton");
    expect(skeleton).toBeInTheDocument();
    expect(skeleton.className).toContain("animate-pulse");

    const img = screen.getByAltText(
      /Third Wave Coffee Roasters workspace preview/i,
    );
    expect(img).toHaveAttribute("width", "1280");
    expect(img).toHaveAttribute("height", "720");
    expect(img.className).toContain("opacity-0");

    // Simulate network image load completion
    fireEvent.load(img);

    expect(screen.queryByTestId("venue-hero-skeleton")).not.toBeInTheDocument();
    expect(img.className).toContain("opacity-100");
  });

  test("renders fallback placeholder without collapsing gallery height when image fails to load", () => {
    render(
      <VenueDetailModal
        venue={sampleVenue}
        isOpen={true}
        onClose={jest.fn()}
      />,
    );

    const img = screen.getByAltText(
      /Third Wave Coffee Roasters workspace preview/i,
    );
    fireEvent.error(img);

    expect(screen.getByTestId("venue-hero-fallback")).toBeInTheDocument();
    expect(
      screen.getByTestId("venue-hero-gallery-container").className,
    ).toContain("aspect-video");
  });

  describe("venue link copying", () => {
    const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      "clipboard",
    );
    const originalExecCommand = document.execCommand;

    beforeEach(() => {
      jest.useFakeTimers();
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: jest.fn().mockResolvedValue(undefined),
        },
      });
      document.execCommand = jest.fn().mockReturnValue(true);
    });

    afterEach(() => {
      jest.clearAllTimers();
      jest.useRealTimers();
      jest.restoreAllMocks();
      if (originalClipboardDescriptor) {
        Object.defineProperty(
          navigator,
          "clipboard",
          originalClipboardDescriptor,
        );
      } else {
        delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
      }
      document.execCommand = originalExecCommand;
    });

    test("renders a copy button with the correct accessible label and title", () => {
      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      const copyButton = screen.getByRole("button", {
        name: "Copy venue link",
      });
      expect(copyButton).toBeInTheDocument();
      expect(copyButton).toHaveAttribute("title", "Copy venue link");
      expect(copyButton).toHaveAttribute("type", "button");
    });

    test("copies the canonical venue URL and shows Copied!", async () => {
      const writeText = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy venue link" }),
        );
      });

      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/venues/${sampleVenue.id}`,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");
    });

    test("reverts copy feedback after exactly 2000ms", async () => {
      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy venue link" }),
        );
      });
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");

      act(() => {
        jest.advanceTimersByTime(1999);
      });
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    test("handles clipboard rejection by trying the fallback and reporting success", async () => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: jest
            .fn()
            .mockRejectedValue(new Error("permission denied")),
        },
      });
      document.execCommand = jest.fn().mockReturnValue(true);

      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy venue link" }),
        );
      });

      expect(document.execCommand).toHaveBeenCalledWith("copy");
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");
    });

    test("handles an unavailable clipboard API gracefully", async () => {
      delete (navigator as Navigator & { clipboard?: Clipboard }).clipboard;
      document.execCommand = jest.fn().mockReturnValue(false);

      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy venue link" }),
        );
      });

      expect(document.execCommand).toHaveBeenCalledWith("copy");
      expect(screen.getByRole("status")).toHaveTextContent("Copy failed");
      expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
    });

    test("clears prior feedback timers on repeated clicks", async () => {
      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );
      const copyButton = screen.getByRole("button", {
        name: "Copy venue link",
      });

      await act(async () => {
        fireEvent.click(copyButton);
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      await act(async () => {
        fireEvent.click(copyButton);
      });
      act(() => {
        jest.advanceTimersByTime(1000);
      });

      expect(screen.getByRole("status")).toHaveTextContent("Copied!");

      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    test("ignores an older copy result after a newer repeated click", async () => {
      let resolveFirst: (() => void) | undefined;
      const firstCopy = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      const writeText = jest
        .fn()
        .mockReturnValueOnce(firstCopy)
        .mockResolvedValueOnce(undefined);
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );
      const copyButton = screen.getByRole("button", {
        name: "Copy venue link",
      });

      act(() => {
        fireEvent.click(copyButton);
      });
      await act(async () => {
        fireEvent.click(copyButton);
      });
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");

      await act(async () => {
        resolveFirst?.();
        await firstCopy;
      });
      expect(screen.getByRole("status")).toHaveTextContent("Copied!");
      expect(writeText).toHaveBeenCalledTimes(2);
    });

    test("cleans up pending feedback when the modal unmounts", async () => {
      const { unmount } = render(
        <VenueDetailModal
          venue={sampleVenue}
          isOpen={true}
          onClose={jest.fn()}
        />,
      );

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Copy venue link" }),
        );
      });

      unmount();
      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  test("preserves close and reserve actions", () => {
    const onClose = jest.fn();
    const onBookClick = jest.fn();
    render(
      <VenueDetailModal
        venue={sampleVenue}
        isOpen={true}
        onClose={onClose}
        onBookClick={onBookClick}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Close venue details" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reserve Desk" }));
    expect(onBookClick).toHaveBeenCalledWith(sampleVenue);
  });

  test("renders an open-hours status pill", () => {
    const venue = {
      ...sampleVenue,
      openingHours: JSON.stringify({
        timezone: "UTC",
        periods: {
          monday: { open: "09:00", close: "17:00", closed: false },
        },
      }),
    };
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-26T16:30:00Z"));

    render(
      <VenueDetailModal venue={venue} isOpen={true} onClose={jest.fn()} />,
    );

    expect(screen.getByTestId("venue-opening-hours-status")).toHaveTextContent(
      "Closing soon",
    );
    jest.useRealTimers();
  });

  test("renders 24/7 and missing-hours fallbacks", () => {
    const { rerender } = render(
      <VenueDetailModal
        venue={{ ...sampleVenue, openingHours: "24/7" }}
        isOpen={true}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("venue-opening-hours-status")).toHaveTextContent(
      "Open 24 hours",
    );

    rerender(
      <VenueDetailModal
        venue={{ ...sampleVenue, openingHours: null }}
        isOpen={true}
        onClose={jest.fn()}
      />,
    );
    expect(screen.getByTestId("venue-opening-hours-status")).toHaveTextContent(
      "Hours unavailable",
    );
  });

  test("updates countdown and cleans up status interval on unmount", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-26T16:15:00Z"));
    const venue = {
      ...sampleVenue,
      openingHours: JSON.stringify({
        timezone: "UTC",
        periods: {
          monday: { open: "09:00", close: "17:00", closed: false },
        },
      }),
    };
    const setIntervalSpy = jest.spyOn(window, "setInterval");
    const clearIntervalSpy = jest.spyOn(window, "clearInterval");
    const { unmount } = render(
      <VenueDetailModal venue={venue} isOpen={true} onClose={jest.fn()} />,
    );

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();

    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
    jest.useRealTimers();
  });

  test("transitions from closing soon to closed automatically", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-26T16:15:00Z"));
    const venue = {
      ...sampleVenue,
      openingHours: JSON.stringify({
        timezone: "UTC",
        periods: {
          monday: { open: "09:00", close: "16:30", closed: false },
        },
      }),
    };

    render(
      <VenueDetailModal venue={venue} isOpen={true} onClose={jest.fn()} />,
    );
    expect(screen.getByTestId("venue-opening-hours-status")).toHaveTextContent(
      "Closing soon",
    );

    act(() => {
      jest.setSystemTime(new Date("2026-10-26T16:31:00Z"));
      jest.advanceTimersByTime(30_000);
    });
    expect(screen.getByTestId("venue-opening-hours-status")).toHaveTextContent(
      "Closed",
    );
    jest.useRealTimers();
  });
});
