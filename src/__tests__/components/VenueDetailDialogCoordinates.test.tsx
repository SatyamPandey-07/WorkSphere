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

  it("shows the Copy Coordinates button when lat and lng exist", async () => {
    await renderDialog({ ...baseVenue, lat: 37.7749, lng: -122.4194 });
    expect(screen.getByText("Copy Coordinates")).toBeInTheDocument();
  });

  it("copies the coordinates as 'lat, lng' and shows a toast", async () => {
    await renderDialog({ ...baseVenue, lat: 37.7749, lng: -122.4194 });

    const button = screen.getByText("Copy Coordinates").closest("button")!;
    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("37.7749, -122.4194"),
    );
    expect(
      screen.getByText("Coordinates copied to clipboard"),
    ).toBeInTheDocument();
  });

  it("hides the button when coordinates are missing", async () => {
    await renderDialog({ ...baseVenue });
    expect(screen.queryByText("Copy Coordinates")).not.toBeInTheDocument();
  });
});
