import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueDetailDialog } from "@/components/chat/VenueDetailDialog";
import { formatGpsCoordinates } from "@/components/chat/venue-dialog/VenueHeaderSection";

// Mock recharts
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: ({ children }: any) => <div>{children}</div>,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  LineChart: ({ children }: any) => <div>{children}</div>,
  Line: () => <div />,
  CartesianGrid: () => <div />,
  Cell: () => <div />,
  ReferenceLine: () => <div />,
}));

// Mock next/navigation params
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/ai",
}));

const baseVenue = {
  id: "venue-1",
  placeId: "venue-1",
  name: "Workspace Coffee",
  category: "cafe",
  address: "456 Mission St",
  rating: 4.5,
  wifiQuality: 4,
  hasOutlets: true,
  noiseLevel: "quiet",
  outletDensity: "some_tables",
  wifiSpeed: 85,
  score: 8.5,
};

describe("formatGpsCoordinates helper", () => {
  it("formats positive latitude and negative longitude as North and West", () => {
    expect(formatGpsCoordinates(37.7749, -122.4194)).toBe(
      "37.7749° N, 122.4194° W",
    );
  });

  it("formats negative latitude and positive longitude as South and East", () => {
    expect(formatGpsCoordinates(-33.8688, 151.2093)).toBe(
      "33.8688° S, 151.2093° E",
    );
  });

  it("formats negative latitude and negative longitude as South and West", () => {
    expect(formatGpsCoordinates(-23.5505, -46.6333)).toBe(
      "23.5505° S, 46.6333° W",
    );
  });

  it("formats positive latitude and positive longitude as North and East", () => {
    expect(formatGpsCoordinates(51.5074, 0.1278)).toBe("51.5074° N, 0.1278° E");
  });

  it("handles zero values without negative signs and assigns N and E", () => {
    expect(formatGpsCoordinates(0, 0)).toBe("0.0000° N, 0.0000° E");
    expect(formatGpsCoordinates(-0, -0)).toBe("0.0000° N, 0.0000° E");
  });

  it("enforces exactly 4 decimal places with zero-padding and rounding", () => {
    expect(formatGpsCoordinates(37.7, -122.4)).toBe("37.7000° N, 122.4000° W");
    expect(formatGpsCoordinates(37.774912, -122.41949)).toBe(
      "37.7749° N, 122.4195° W",
    );
  });
});

describe("VenueDetailDialog copy coordinates button", () => {
  const writeText = jest.fn().mockResolvedValue(undefined);

  beforeAll(() => {
    global.EventSource = jest.fn().mockImplementation(() => ({
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
    })) as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ reviews: [] }),
      }),
    );
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  const renderDialog = async (venue: Record<string, unknown>) => {
    render(
      <VenueDetailDialog
        venue={venue as any}
        isOpen={true}
        isFavorited={false}
        onClose={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
      />,
    );
    // Flush microtasks for useEffect fetch calls
    await act(async () => {
      await Promise.resolve();
    });
  };

  it("shows the Copy Coordinates button with accessible aria-label when lat and lng exist", async () => {
    await renderDialog({ ...baseVenue, lat: 37.7749, lng: -122.4194 });
    const button = screen.getByRole("button", {
      name: "Copy GPS coordinates for Workspace Coffee",
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute(
      "title",
      "Copy GPS coordinates for Workspace Coffee",
    );
    expect(screen.getByText("Copy Coordinates")).toBeInTheDocument();
  });

  it("copies formatted coordinates as 'DD.DDDD° N/S, DD.DDDD° E/W' and shows a toast", async () => {
    await renderDialog({ ...baseVenue, lat: 37.7749, lng: -122.4194 });

    const button = screen.getByRole("button", {
      name: "Copy GPS coordinates for Workspace Coffee",
    });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("37.7749° N, 122.4194° W"),
    );
    expect(
      screen.getByText("Coordinates copied to clipboard"),
    ).toBeInTheDocument();
  });

  it("copies Southern and Eastern coordinates accurately", async () => {
    await renderDialog({ ...baseVenue, lat: -33.8688, lng: 151.2093 });

    const button = screen.getByRole("button", {
      name: "Copy GPS coordinates for Workspace Coffee",
    });
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("33.8688° S, 151.2093° E"),
    );
    expect(
      screen.getByText("Coordinates copied to clipboard"),
    ).toBeInTheDocument();
  });

  it("hides the button when coordinates are missing or partially missing", async () => {
    const { unmount } = render(
      <VenueDetailDialog
        venue={{ ...baseVenue } as any}
        isOpen={true}
        isFavorited={false}
        onClose={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
      />,
    );
    expect(screen.queryByText("Copy Coordinates")).not.toBeInTheDocument();
    unmount();

    render(
      <VenueDetailDialog
        venue={{ ...baseVenue, lat: 37.7749 } as any}
        isOpen={true}
        isFavorited={false}
        onClose={jest.fn()}
        onGetDirections={jest.fn()}
        onToggleFavorite={jest.fn()}
      />,
    );
    expect(screen.queryByText("Copy Coordinates")).not.toBeInTheDocument();
  });

  it("falls back to document.execCommand when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    const execCommandMock = jest.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    await renderDialog({ ...baseVenue, lat: 37.7749, lng: -122.4194 });

    const button = screen.getByRole("button", {
      name: "Copy GPS coordinates for Workspace Coffee",
    });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(
      screen.getByText("Coordinates copied to clipboard"),
    ).toBeInTheDocument();
  });

  it("falls back to document.execCommand when navigator.clipboard.writeText rejects", async () => {
    const failingWriteText = jest
      .fn()
      .mockRejectedValue(new Error("Clipboard access denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: failingWriteText },
      configurable: true,
    });
    const execCommandMock = jest.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;
    const consoleErrorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await renderDialog({ ...baseVenue, lat: 37.7749, lng: -122.4194 });

    const button = screen.getByRole("button", {
      name: "Copy GPS coordinates for Workspace Coffee",
    });
    await act(async () => {
      fireEvent.click(button);
    });

    expect(failingWriteText).toHaveBeenCalledWith("37.7749° N, 122.4194° W");
    expect(execCommandMock).toHaveBeenCalledWith("copy");
    expect(
      screen.getByText("Coordinates copied to clipboard"),
    ).toBeInTheDocument();

    consoleErrorSpy.mockRestore();
  });
});
