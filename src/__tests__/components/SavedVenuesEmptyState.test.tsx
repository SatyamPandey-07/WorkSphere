import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import SavedVenuesPage from "@/app/saved/page";
import { useSavedVenues } from "@/hooks/useSavedVenues";

jest.mock("@/hooks/useSavedVenues", () => ({
  useSavedVenues: jest.fn(),
}));

describe("SavedVenuesPage Empty State (#3429)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders empty state illustration, title, description, and CTA when favorites is empty", () => {
    (useSavedVenues as jest.Mock).mockReturnValue({
      favorites: [],
      loading: false,
      error: null,
      allTags: [],
      updateNotes: jest.fn(),
      addTag: jest.fn(),
      updateTag: jest.fn(),
      deleteTag: jest.fn(),
      removeFavorite: jest.fn(),
    });

    render(<SavedVenuesPage />);

    // 1. Title
    expect(
      screen.getByRole("heading", { name: "No saved workspaces yet" })
    ).toBeInTheDocument();

    // 2. Supportive Description
    expect(
      screen.getByText(
        "Explore nearby cafes, coworking spaces, and quiet libraries and tap the heart icon to save them for quick access."
      )
    ).toBeInTheDocument();

    // 3. Call to Action button linking to '/'
    const ctaLink = screen.getByRole("link", { name: "Explore Workspaces" });
    expect(ctaLink).toBeInTheDocument();
    expect(ctaLink).toHaveAttribute("href", "/");

    // 4. Accessibility landmark & region
    const emptyStateRegion = screen.getByRole("region", {
      name: "Empty saved workspaces",
    });
    expect(emptyStateRegion).toBeInTheDocument();
  });

  it("does not render empty state when favorites are present", () => {
    (useSavedVenues as jest.Mock).mockReturnValue({
      favorites: [
        {
          id: "fav-1",
          notes: "",
          tags: [],
          createdAt: "2026-10-03",
          venue: {
            id: "v-1",
            name: "Cozy Coffee Workspace",
            category: "Cafe",
            address: "123 Main St",
            wifiQuality: 5,
            noiseLevel: "QUIET",
            rating: 4.8,
            outlets: "PLENTIFUL",
          },
        },
      ],
      loading: false,
      error: null,
      allTags: [],
      updateNotes: jest.fn(),
      addTag: jest.fn(),
      updateTag: jest.fn(),
      deleteTag: jest.fn(),
      removeFavorite: jest.fn(),
    });

    render(<SavedVenuesPage />);

    expect(
      screen.queryByText("No saved workspaces yet")
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Cozy Coffee Workspace")
    ).toBeInTheDocument();
  });
});
