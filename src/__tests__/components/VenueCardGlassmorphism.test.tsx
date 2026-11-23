import React from "react";
import { render, screen } from "@testing-library/react";
import { VenueCard } from "@/components/venue/VenueCard";
import fs from "fs";
import path from "path";

describe("VenueCard Glassmorphic Hover Pulse & Action Buttons", () => {
  const mockVenue = {
    id: "v-glass-101",
    name: "Cyber Oasis Cafe",
    description: "High-tech quiet workspace with glowing ambiance.",
  };

  test("applies venue-action-glass-btn and hover:backdrop-blur-md classes on action buttons", () => {
    render(
      <VenueCard
        venue={mockVenue}
        onBookmark={jest.fn()}
        onFavorite={jest.fn()}
        onShare={jest.fn()}
      />,
    );

    const bookmarkBtn = screen.getByRole("button", {
      name: `Bookmark ${mockVenue.name}`,
    });
    const favoriteBtn = screen.getByRole("button", {
      name: `Favorite ${mockVenue.name}`,
    });
    const shareBtn = screen.getByRole("button", {
      name: `Share ${mockVenue.name}`,
    });

    expect(bookmarkBtn).toHaveClass("venue-action-glass-btn");
    expect(bookmarkBtn).toHaveClass("hover:backdrop-blur-md");

    expect(favoriteBtn).toHaveClass("venue-action-glass-btn");
    expect(favoriteBtn).toHaveClass("hover:backdrop-blur-md");

    expect(shareBtn).toHaveClass("venue-action-glass-btn");
    expect(shareBtn).toHaveClass("hover:backdrop-blur-md");
  });

  test("defines glassmorphic hover pulse keyframes and reduced-motion rules in globals.css", () => {
    const cssPath = path.resolve(__dirname, "../../app/globals.css");
    const cssContent = fs.readFileSync(cssPath, "utf-8");

    // Keyframes for dark and cyberpunk modes
    expect(cssContent).toContain("@keyframes neon-glass-pulse-dark");
    expect(cssContent).toContain("@keyframes neon-glass-pulse-cyberpunk");

    // Timing cubic-bezier(0.4, 0, 0.2, 1)
    expect(cssContent).toContain("cubic-bezier(0.4, 0, 0.2, 1)");

    // Dark and Cyberpunk mode hover styles
    expect(cssContent).toContain(
      ".dark .venue-action-glass-btn:hover:not(:disabled)",
    );
    expect(cssContent).toContain(
      ".cyberpunk .venue-action-glass-btn:hover:not(:disabled)",
    );

    // Backdrop-filter blur
    expect(cssContent).toContain("backdrop-filter: blur(12px)");

    // Prefers-reduced-motion accessibility safeguard
    expect(cssContent).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(cssContent).toContain("animation: none !important");
  });
});
