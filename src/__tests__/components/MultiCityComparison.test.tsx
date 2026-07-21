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
});
