import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { VenueDetailDialog } from "@/components/chat/VenueDetailDialog";

// Mock recharts
jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
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

const mockVenue = {
  id: "venue-1",
  placeId: "venue-1",
  name: "Workspace Coffee",
  lat: 37.7749,
  lng: -122.4194,
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

const mockReviews = [
  {
    id: "r1",
    wifiQuality: 5,
    hasOutlets: true,
    noiseLevel: "quiet",
    outletDensity: "every_table",
    comment: "Amazing speed!",
    user: { firstName: "Jane", lastName: "Doe" },
  },
  {
    id: "r2",
    wifiQuality: 4,
    hasOutlets: true,
    noiseLevel: "moderate",
    outletDensity: "some_tables",
    comment: "Decent place",
    user: { firstName: "John", lastName: "Smith" },
  },
];

describe("VenueDetailDialog Rating Distribution Integration", () => {
  const mockOnClose = jest.fn();
  const mockOnGetDirections = jest.fn();
  const mockOnToggleFavorite = jest.fn();

  beforeAll(() => {
    global.EventSource = jest.fn().mockImplementation(() => ({
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      close: jest.fn(),
    })) as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Setup fetch mock to return reviews
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/reviews")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ reviews: mockReviews }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  const renderDialog = async () => {
    const utils = render(
      <VenueDetailDialog
        venue={mockVenue}
        isOpen={true}
        isFavorited={false}
        onClose={mockOnClose}
        onGetDirections={mockOnGetDirections}
        onToggleFavorite={mockOnToggleFavorite}
      />,
    );
    // Flush microtasks for useEffect fetch calls
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return utils;
  };

  it("renders the summary cards for WiFi, Power, and Noise", async () => {
    await renderDialog();
    expect(screen.getByText("WiFi")).toBeInTheDocument();
    expect(screen.getByText("Power")).toBeInTheDocument();
    expect(screen.getByText("Noise")).toBeInTheDocument();
  });

  it("opens WiFi quality distribution when WiFi card is clicked", async () => {
    await renderDialog();

    // Click the WiFi card
    const wifiButton = screen.getByRole("button", { name: /WiFi/i });
    fireEvent.click(wifiButton);

    // Verify rating distribution is visible
    expect(screen.getByText("WiFi Quality Distribution")).toBeInTheDocument();
    // 5 Stars is 50% (1 out of 2 reviews)
    expect(screen.getAllByText("50% (1)")[0]).toBeInTheDocument();
  });

  it("opens Power distribution when Power card is clicked", async () => {
    await renderDialog();

    // Click the Power card
    const powerButton = screen.getByRole("button", { name: /Power/i });
    fireEvent.click(powerButton);

    expect(screen.getByText("Power Outlet Distribution")).toBeInTheDocument();
    expect(screen.getByText("Outlet Density")).toBeInTheDocument();
  });

  it("opens Noise distribution when Noise card is clicked", async () => {
    await renderDialog();

    // Click the Noise card
    const noiseButton = screen.getByRole("button", { name: /Noise/i });
    fireEvent.click(noiseButton);

    expect(screen.getByText("Quietness Distribution")).toBeInTheDocument();
    expect(screen.getAllByText("50% (1)")[0]).toBeInTheDocument();
  });

  it("closes the distribution container when close button is clicked", async () => {
    await renderDialog();

    const wifiButton = screen.getByRole("button", { name: /WiFi/i });
    fireEvent.click(wifiButton);

    expect(screen.getByText("WiFi Quality Distribution")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", {
      name: /Close distribution details/i,
    });
    fireEvent.click(closeBtn);

    expect(
      screen.queryByText("WiFi Quality Distribution"),
    ).not.toBeInTheDocument();
  });
});
