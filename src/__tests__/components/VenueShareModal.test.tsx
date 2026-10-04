import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { VenueShareModal } from "@/components/venue/VenueShareModal";
import * as svgQrModule from "@/lib/qr/svgQr";

describe("VenueShareModal Component", () => {
  const mockVenue = {
    id: "venue-123",
    name: "Cafe Artisan",
    address: "123 Coffee Way",
    category: "cafe",
    imageUrl: "https://example.com/cafe.jpg",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("calls navigator.share when available", async () => {
    const shareMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { share: shareMock });

    render(<VenueShareModal venue={mockVenue} />);

    const shareBtn = screen.getByRole("button", { name: /share cafe artisan/i });
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

    const shareBtn = screen.getByRole("button", { name: /share cafe artisan/i });
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

    const shareBtn = screen.getByRole("button", { name: /share cafe artisan/i });
    fireEvent.click(shareBtn);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Share Venue" })).toBeInTheDocument();
    expect(screen.getByDisplayValue(expect.stringContaining("/venues/venue-123"))).toBeInTheDocument();
  });

  it("allows copying shortlink to clipboard", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));

    const copyBtn = screen.getByRole("button", { name: /copy/i });
    fireEvent.click(copyBtn);

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining("/venues/venue-123")
      );
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });
  });

  it("allows downloading the SVG QR code", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;
    const downloadSpy = jest.spyOn(svgQrModule, "downloadSVG").mockImplementation(() => {});

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));

    const downloadBtn = screen.getByRole("button", { name: /download svg/i });
    fireEvent.click(downloadBtn);

    expect(downloadSpy).toHaveBeenCalledWith(
      expect.stringContaining("<svg"),
      "cafe-artisan-qr.svg"
    );

    downloadSpy.mockRestore();
  });

  it("closes modal on close button click and escape key press", async () => {
    // @ts-expect-error - intentional test simulation
    delete (navigator as any).share;

    render(<VenueShareModal venue={mockVenue} />);

    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: /close dialog/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Reopen and test escape key
    fireEvent.click(screen.getByRole("button", { name: /share cafe artisan/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
