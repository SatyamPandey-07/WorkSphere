import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MultiCityComparison } from "@/components/venues/MultiCityComparison";
import { buildComparisonChartData } from "@/components/venues/MultiCityComparison";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("cities=San%20Francisco,Tokyo"),
  useRouter: () => ({
    replace: mockReplace,
    push: mockReplace,
  }),
}));

global.fetch = jest.fn();

describe("MultiCityComparison Component (#860 / #1753)", () => {
  const mockVenues = [
    {
      id: "v1",
      name: "Bay Hub",
      address: "123 Market St, San Francisco, CA",
      lat: 37.7749,
      lng: -122.4194,
      category: "cafe",
      wifi: true,
      wifiSpeed: 120,
      hasOutlets: true,
      noiseLevel: "quiet" as const,
      score: 9.5,
    },
    {
      id: "v2",
      name: "Shibuya Desk",
      address: "45 Shibuya Crossing, Tokyo, Japan",
      lat: 35.6762,
      lng: 139.6503,
      category: "cafe",
      wifi: true,
      wifiSpeed: 200,
      hasOutlets: true,
      noiseLevel: "moderate" as const,
      score: 9.8,
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ venues: mockVenues }),
    });
  });

  it("renders multi-city header and initial active city tags from URL search params", async () => {
    render(<MultiCityComparison initialVenues={mockVenues} />);

    expect(
      screen.getByText(/Multi-City Nomad Workspace Filter & Split View/i),
    ).toBeInTheDocument();
    expect(screen.getByText("San Francisco")).toBeInTheDocument();
    expect(screen.getByText("Tokyo")).toBeInTheDocument();
  });

  it("adds custom city tag and updates URL search params", async () => {
    render(<MultiCityComparison initialVenues={mockVenues} />);

    const input = screen.getByPlaceholderText(/Add custom city/i);
    const form = input.closest("form");

    fireEvent.change(input, { target: { value: "Berlin" } });
    if (form) fireEvent.submit(form);

    expect(screen.getByText("Berlin")).toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("cities=San+Francisco%2CTokyo%2CBerlin"),
      expect.anything(),
    );
  });

  it("renders side-by-side split view columns grouped by city", async () => {
    render(<MultiCityComparison initialVenues={mockVenues} />);

    await waitFor(() => {
      expect(screen.getByText("Bay Hub")).toBeInTheDocument();
      expect(screen.getByText("Shibuya Desk")).toBeInTheDocument();
    });
  });

  it("renders Export PDF Report button and triggers PDF download on click", async () => {
    const createObjectURLMock = jest
      .fn()
      .mockReturnValue("blob:http://localhost/pdf-blob");
    const revokeObjectURLMock = jest.fn();
    global.URL.createObjectURL = createObjectURLMock;
    global.URL.revokeObjectURL = revokeObjectURLMock;

    render(<MultiCityComparison initialVenues={mockVenues} />);

    const exportBtn = screen.getByRole("button", {
      name: /Export PDF Report/i,
    });
    expect(exportBtn).toBeInTheDocument();

    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(createObjectURLMock).toHaveBeenCalled();
    });
  });

  it("shows a green badge when average WiFi speed is above 100 Mbps", async () => {
    render(<MultiCityComparison initialVenues={mockVenues} />);

    const badge = await screen.findByTestId("average-wifi-speed-badge");

    expect(badge).toHaveTextContent("160 Mbps");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Average WiFi speed 160 Mbps, Fast",
    );
    expect(badge).toHaveClass("text-emerald-700");
  });

  it("shows a yellow badge when average WiFi speed is above 30 Mbps and at most 100 Mbps", async () => {
    const moderateVenues = [
      {
        ...mockVenues[0],
        wifiSpeed: 40,
      },
      {
        ...mockVenues[1],
        wifiSpeed: 80,
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ venues: moderateVenues }),
    });

    render(<MultiCityComparison initialVenues={moderateVenues} />);

    const badge = await screen.findByTestId("average-wifi-speed-badge");

    expect(badge).toHaveTextContent("60 Mbps");
    expect(badge).toHaveAttribute(
      "aria-label",
      "Average WiFi speed 60 Mbps, Moderate",
    );
    expect(badge).toHaveClass("text-amber-700");
  });

  it("updates the badge when selected city filters change", async () => {
    const dynamicVenues = [
      {
        ...mockVenues[0],
        wifiSpeed: 20,
      },
      {
        ...mockVenues[1],
        wifiSpeed: 220,
      },
    ];

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ venues: dynamicVenues }),
    });

    render(<MultiCityComparison initialVenues={dynamicVenues} />);

    const badge = await screen.findByTestId("average-wifi-speed-badge");
    expect(badge).toHaveTextContent("120 Mbps");
    expect(badge).toHaveClass("text-emerald-700");

    fireEvent.click(screen.getByRole("button", { name: "Tokyo" }));

    await waitFor(() => {
      expect(badge).toHaveTextContent("20 Mbps");
      expect(badge).toHaveClass("text-zinc-600");
    });
  });

  it("updates URL query parameters when amenity filter chips are added and removed (#1753)", async () => {
    render(<MultiCityComparison initialVenues={mockVenues} />);

    // Click to add Wi-Fi amenity filter chip
    const wifiChip = screen.getByTestId("filter-chip-wifi");
    fireEvent.click(wifiChip);

    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("filters=wifi"),
      expect.anything(),
    );

    // Verify active badge appears
    expect(screen.getByTestId("active-badge-wifi")).toBeInTheDocument();

    // Click remove button on active Wi-Fi badge
    const removeBadgeBtn = screen.getByTestId("remove-active-badge-wifi");
    fireEvent.click(removeBadgeBtn);

    // URL search params should be updated removing 'wifi'
    expect(mockReplace).toHaveBeenLastCalledWith(
      expect.not.stringContaining("filters=wifi"),
      expect.anything(),
    );
    expect(screen.queryByTestId("active-badge-wifi")).not.toBeInTheDocument();
  });

  it("updates URL query parameters when removing a city chip (#1753)", async () => {
    render(<MultiCityComparison initialVenues={mockVenues} />);

    // Click Tokyo city button to toggle off
    fireEvent.click(screen.getByRole("button", { name: "Tokyo" }));

    expect(mockReplace).toHaveBeenCalledWith(
      expect.not.stringContaining("Tokyo"),
      expect.anything(),
    );
  });
});

describe("buildComparisonChartData", () => {
  it("computes avgWifi, quietPct, and outletPct correctly per city", () => {
    const venues = [
      {
        id: "v1",
        name: "Bay Hub",
        address: "123 Market St, San Francisco, CA",
        lat: 37.7749,
        lng: -122.4194,
        category: "cafe",
        wifi: true,
        wifiSpeed: 100,
        hasOutlets: true,
        noiseLevel: "quiet" as const,
        score: 9.0,
      },
      {
        id: "v2",
        name: "Fog Office",
        address: "456 Mission St, San Francisco, CA",
        lat: 37.78,
        lng: -122.41,
        category: "coworking",
        wifi: true,
        wifiSpeed: 60,
        hasOutlets: false,
        noiseLevel: "moderate" as const,
        score: 8.0,
      },
      {
        id: "v3",
        name: "Shibuya Desk",
        address: "45 Shibuya Crossing, Tokyo, Japan",
        lat: 35.6762,
        lng: 139.6503,
        category: "cafe",
        wifi: true,
        wifiSpeed: 200,
        hasOutlets: true,
        noiseLevel: "quiet" as const,
        score: 9.8,
      },
    ];

    const result = buildComparisonChartData(["San Francisco", "Tokyo"], venues);

    expect(result).toHaveLength(2);

    const sf = result.find((r) => r.city === "San Francisco")!;
    expect(sf.avgWifi).toBe(80); // (100 + 60) / 2
    expect(sf.quietPct).toBe(50); // 1 of 2 venues is quiet
    expect(sf.outletPct).toBe(50); // 1 of 2 venues has outlets

    const tokyo = result.find((r) => r.city === "Tokyo")!;
    expect(tokyo.avgWifi).toBe(200);
    expect(tokyo.quietPct).toBe(100);
    expect(tokyo.outletPct).toBe(100);
  });
});
