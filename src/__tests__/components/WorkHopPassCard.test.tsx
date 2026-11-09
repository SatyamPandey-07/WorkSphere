import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import WorkHopPassCard from "@/components/bookings/WorkHopPassCard";

describe("WorkHopPassCard Component - Copy Pass Code", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("renders Copy Pass Code button with copy icon", () => {
    render(<WorkHopPassCard />);
    const copyBtn = screen.getByRole("button", { name: /copy pass code/i });
    expect(copyBtn).toBeInTheDocument();
  });

  it("copies pass code to clipboard and displays checkmark icon with toast notification", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<WorkHopPassCard />);

    const copyBtn = screen.getByRole("button", { name: /copy pass code/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith("whop-782914-sprint");
    expect(screen.getByTestId("copy-checkmark-icon")).toBeInTheDocument();
    expect(
      screen.getByText("Pass code copied to clipboard!"),
    ).toBeInTheDocument();

    // Fast-forward 3 seconds auto-dismiss
    act(() => {
      jest.advanceTimersByTime(3100);
    });

    expect(
      screen.queryByText("Pass code copied to clipboard!"),
    ).not.toBeInTheDocument();
  });

  it("uses accessible fallback when navigator.clipboard is unavailable", async () => {
    // Delete clipboard API
    // @ts-expect-error testing clipboard fallback
    delete (navigator as any).clipboard;
    const execCommandMock = jest.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    render(<WorkHopPassCard />);

    const copyBtn = screen.getByRole("button", { name: /copy pass code/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(
      screen.getByText("Pass code copied to clipboard!"),
    ).toBeInTheDocument();
  });
});

describe("WorkHopPassCard Component - Holographic Flight Badge", () => {
  it("renders the futuristic holographic flight badge with chamfered corners", () => {
    render(<WorkHopPassCard />);
    const badge = screen.getByTestId("holographic-flight-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveStyle(
      "clip-path: polygon(22px 0%, calc(100% - 22px) 0%, 100% 22px, 100% calc(100% - 22px), calc(100% - 22px) 100%, 22px 100%, 0% calc(100% - 22px), 0% 22px)",
    );
  });

  it("renders the SECTOR 2814 CLEARANCE header and flight pass metadata", () => {
    render(<WorkHopPassCard />);
    const clearanceHeader = screen.getByTestId("sector-clearance-header");
    expect(clearanceHeader).toBeInTheDocument();
    expect(clearanceHeader).toHaveTextContent("SECTOR 2814 CLEARANCE");
    expect(screen.getByText(/NOMAD_PRO FLIGHT PASS/i)).toBeInTheDocument();
  });

  it("renders barcode telemetry with frequencies and coordinates", () => {
    render(<WorkHopPassCard />);
    const telemetry = screen.getByTestId("barcode-telemetry");
    expect(telemetry).toBeInTheDocument();
    expect(telemetry).toHaveTextContent("SEC-2814 // FLIGHT BADGE");
    expect(telemetry).toHaveTextContent("1420.405 MHz");
    expect(telemetry).toHaveTextContent("COORDS: 37.77°N 122.41°W");
  });

  it("applies 3D perspective tilt on pointer move and resets on pointer leave", () => {
    render(<WorkHopPassCard />);
    const badge = screen.getByTestId("holographic-flight-badge");

    // Mock bounding client rect
    jest.spyOn(badge, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Move pointer towards bottom-right (x: 300, y: 150)
    fireEvent.pointerMove(badge, { clientX: 300, clientY: 150 });
    expect(badge.style.transform).toContain("perspective(1000px)");
    expect(badge.style.transform).toContain("rotateX");
    expect(badge.style.transform).toContain("rotateY");

    // Leave pointer
    fireEvent.pointerLeave(badge);
    expect(badge.style.transform).toBe(
      "perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)",
    );
  });

  it("renders iridescent emerald holographic foil shine gradient layer", () => {
    render(<WorkHopPassCard />);
    const foilShine = screen.getByTestId("holographic-foil-shine");
    expect(foilShine).toBeInTheDocument();
    expect(foilShine.style.background).toContain("radial-gradient");
    expect(foilShine.style.background).toContain("rgba(52, 211, 153");
    expect(foilShine.style.background).toContain("rgba(16, 185, 129");
  });

  it("ensures QR code and booking reference remain high-contrast and perfectly scannable", () => {
    render(<WorkHopPassCard />);
    const qrBox = screen.getByTestId("qr-pass-box");
    expect(qrBox).toBeInTheDocument();
    expect(qrBox).toHaveClass("bg-white");

    const bookingRef = screen.getByTestId("booking-reference");
    expect(bookingRef).toBeInTheDocument();
    expect(bookingRef).toHaveTextContent("whop-782914-sprint");
    expect(bookingRef).toHaveClass("select-all");
  });
});
