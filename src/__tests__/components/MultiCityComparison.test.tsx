import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MultiCityComparison } from "@/components/venues/MultiCityComparison";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("cities=San%20Francisco,Tokyo"),
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

global.fetch = jest.fn();

describe("MultiCityComparison Component (#860)", () => {
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
});
