import "@testing-library/jest-dom";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import VenueWifiConnectModalDefault, {
  VenueWifiConnectModal,
} from "@/components/venue/VenueWifiConnectModal";

describe("VenueWifiConnectModal Component Suite", () => {
  const originalFetch = global.fetch;
  const originalClipboard = navigator.clipboard;

  const mockWifiConfig = {
    ssid: "CafeWork_5G",
    password: "nomadpassword123",
    securityType: "WPA2-PSK",
    speedMbps: 350,
    frequencyBand: "5 GHz",
  };

  const mockApiResponse = {
    success: true,
    config: mockWifiConfig,
    qrSvg: '<svg data-testid="wifi-qr-svg"><rect width="100" height="100"/></svg>',
    tableTentSvg: '<svg data-testid="table-tent-svg"><text>WiFi Tent</text></svg>',
    qrString: "WIFI:S:CafeWork_5G;T:WPA;P:nomadpassword123;;",
  };

  const mockWriteText = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => mockApiResponse,
    });

    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText.mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.assign(navigator, { clipboard: originalClipboard });
    jest.useRealTimers();
  });

  it("exports default component matching named export", () => {
    expect(VenueWifiConnectModalDefault).toBe(VenueWifiConnectModal);
  });

  it("renders nothing when isOpen is false", () => {
    render(
      <VenueWifiConnectModal
        isOpen={false}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    expect(screen.queryByTestId("venue-wifi-connect-modal")).not.toBeInTheDocument();
  });

  it("renders modal with header and fetches configuration when isOpen is true", async () => {
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    expect(screen.getByTestId("venue-wifi-connect-modal")).toBeInTheDocument();
    expect(screen.getByText("Connect to Cafe Work Wi-Fi")).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("wifi-ssid-value")).toHaveTextContent("CafeWork_5G");
    expect(screen.getByTestId("wifi-password-value")).toHaveTextContent("nomadpassword123");
    expect(screen.getByText("5 GHz")).toBeInTheDocument();
    expect(screen.getByText("⚡ 350 Mbps")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const handleClose = jest.fn();
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={handleClose}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const closeBtn = screen.getByTestId("wifi-connect-close-btn");
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked, but not when modal body is clicked", async () => {
    const handleClose = jest.fn();
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={handleClose}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(handleClose).not.toHaveBeenCalled();

    const backdrop = screen.getByTestId("venue-wifi-connect-modal");
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape key is pressed", async () => {
    const handleClose = jest.fn();
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={handleClose}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it("copies password to clipboard and shows feedback when copy button is clicked", async () => {
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const copyBtn = screen.getByTestId("wifi-copy-password-btn");
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(mockWriteText).toHaveBeenCalledWith("nomadpassword123");
    expect(screen.getByText("Copied!")).toBeInTheDocument();

    // Fast forward timer to reset copied state
    act(() => {
      jest.advanceTimersByTime(2600);
    });

    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();
  });

  it("copies password via one-click connect button", async () => {
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const oneClickBtn = screen.getByTestId("wifi-one-click-connect-btn");
    await act(async () => {
      fireEvent.click(oneClickBtn);
    });

    expect(mockWriteText).toHaveBeenCalledWith("nomadpassword123");
    expect(screen.getByText("Password Copied!")).toBeInTheDocument();
  });

  it("runs speed test simulator and updates ping telemetry", async () => {
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const testSpeedBtn = screen.getByTestId("wifi-test-speed-btn");
    fireEvent.click(testSpeedBtn);

    expect(testSpeedBtn).toHaveTextContent("Testing...");

    act(() => {
      jest.advanceTimersByTime(1300);
    });

    expect(screen.getByText(/Ping: \d+ms · Jitter: \d+ms/)).toBeInTheDocument();
  });

  it("handles table tent SVG download trigger", async () => {
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = jest.fn().mockReturnValue("blob:mock-svg-url");
    window.URL.revokeObjectURL = jest.fn();

    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const printBtn = screen.getByTestId("wifi-print-table-tent-btn");
    fireEvent.click(printBtn);

    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-svg-url");

    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("applies custom className and data-testid overrides", async () => {
    render(
      <VenueWifiConnectModal
        isOpen={true}
        onClose={jest.fn()}
        venueId="venue-123"
        venueName="Cafe Work"
        className="custom-wifi-modal"
        data-testid="custom-wifi-root"
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("custom-wifi-root")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("custom-wifi-modal");
  });
});
