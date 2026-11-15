import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueShareButton } from "@/components/social/VenueShareButton";

describe("VenueShareButton Component (#6937)", () => {
  const originalNavigator = { ...navigator };
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, "error").mockImplementation(() => {});
    document.execCommand = jest.fn().mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Object.assign(navigator, originalNavigator);
    document.execCommand = originalExecCommand;
  });

  it("renders with default props and attributes", () => {
    render(<VenueShareButton venueId="venue-123" venueName="Tech Hub Cafe" />);

    const button = screen.getByTestId("venue-share-btn");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-label", "Share Tech Hub Cafe");
    expect(screen.getByTestId("venue-share-text")).toHaveTextContent("Share");
    expect(screen.getByTestId("venue-share-icon-share")).toBeInTheDocument();
  });

  it("invokes navigator.share when Web Share API is available", async () => {
    const mockShare = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share: mockShare });
    const handleSuccess = jest.fn();

    render(
      <VenueShareButton
        venueId="venue-456"
        venueName="Creative Cowork"
        onShareSuccess={handleSuccess}
      />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockShare).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Creative Cowork on WorkSphere",
        text: "Check out Creative Cowork as a place to work.",
        url: expect.stringContaining("/social?venue=venue-456"),
      })
    );
    expect(handleSuccess).toHaveBeenCalledWith(
      "native",
      expect.stringContaining("/social?venue=venue-456")
    );
  });

  it("silently ignores AbortError when user cancels native share dialog", async () => {
    const abortErr = new Error("User canceled share");
    abortErr.name = "AbortError";
    const mockShare = jest.fn().mockRejectedValue(abortErr);
    Object.assign(navigator, { share: mockShare });
    const handleError = jest.fn();

    render(
      <VenueShareButton
        venueId="venue-abort"
        venueName="Quiet Library"
        onError={handleError}
      />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(handleError).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("falls back to clipboard copy when navigator.share is unavailable", async () => {
    Object.assign(navigator, {
      share: undefined,
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
    const handleSuccess = jest.fn();

    render(
      <VenueShareButton
        venueId="venue-clip"
        venueName="Central Commons"
        onShareSuccess={handleSuccess}
      />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("/social?venue=venue-clip")
    );
    expect(screen.getByTestId("venue-share-text")).toHaveTextContent("Link copied");
    expect(screen.getByTestId("venue-share-icon-check")).toBeInTheDocument();
    expect(screen.getByTestId("venue-share-sr-announcement")).toHaveTextContent(
      "Link to Central Commons copied to clipboard"
    );
    expect(handleSuccess).toHaveBeenCalledWith(
      "clipboard",
      expect.stringContaining("/social?venue=venue-clip")
    );

    // Reverts after duration
    act(() => {
      jest.advanceTimersByTime(1800);
    });

    expect(screen.getByTestId("venue-share-text")).toHaveTextContent("Share");
    expect(screen.getByTestId("venue-share-icon-share")).toBeInTheDocument();
  });

  it("supports customUrl and custom copyDurationMs", async () => {
    Object.assign(navigator, {
      share: undefined,
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    render(
      <VenueShareButton
        venueId="venue-custom"
        venueName="Custom Space"
        customUrl="https://custom.work/space"
        copyDurationMs={500}
      />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://custom.work/space");

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.getByTestId("venue-share-text")).toHaveTextContent("Share");
  });

  it("falls back to document.execCommand when navigator.clipboard is absent", async () => {
    Object.assign(navigator, {
      share: undefined,
      clipboard: undefined,
    });
    const handleSuccess = jest.fn();

    render(
      <VenueShareButton
        venueId="venue-legacy"
        venueName="Legacy Cafe"
        onShareSuccess={handleSuccess}
      />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(handleSuccess).toHaveBeenCalledWith("clipboard", expect.any(String));
  });

  it("calls onError when copy throws unexpected error", async () => {
    Object.assign(navigator, {
      share: undefined,
      clipboard: {
        writeText: jest.fn().mockRejectedValue(new Error("Permission denied")),
      },
    });
    document.execCommand = jest.fn().mockImplementation(() => {
      throw new Error("execCommand denied");
    });
    const handleError = jest.fn();

    render(
      <VenueShareButton
        venueId="venue-err"
        venueName="Error Cafe"
        onError={handleError}
      />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(handleError).toHaveBeenCalled();
  });

  it("suppresses interaction when disabled is true", async () => {
    const mockShare = jest.fn();
    Object.assign(navigator, { share: mockShare });

    render(
      <VenueShareButton
        venueId="venue-dis"
        venueName="Disabled Cafe"
        disabled={true}
      />
    );

    const button = screen.getByTestId("venue-share-btn");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(mockShare).not.toHaveBeenCalled();
  });

  it("safely handles unmount during copy timeout", async () => {
    Object.assign(navigator, {
      share: undefined,
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });

    const { unmount } = render(
      <VenueShareButton venueId="venue-unmount" venueName="Unmount Cafe" />
    );

    const button = screen.getByTestId("venue-share-btn");

    await act(async () => {
      fireEvent.click(button);
    });

    unmount();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
  });
});
