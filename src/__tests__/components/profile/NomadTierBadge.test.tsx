import React from "react";
import { render, screen } from "@testing-library/react";
import NomadTierBadge from "@/components/profile/NomadTierBadge";

describe("NomadTierBadge Component", () => {
  test("renders tier name and formatted XP correctly", () => {
    render(<NomadTierBadge tier="Gold" xp={1200} />);

    expect(screen.getByText("Gold")).toBeInTheDocument();
    expect(screen.getByText("1,200 XP")).toBeInTheDocument();
  });

  test("applies responsive spacing and shrink-0 flex rules", () => {
    render(<NomadTierBadge tier="Platinum" xp={4500} />);

    const badge = screen.getByTestId("nomad-tier-badge");
    expect(badge).toHaveClass("px-2.5", "py-1", "max-w-full");

    const xpSpan = screen.getByText("4,500 XP");
    expect(xpSpan).toHaveClass("shrink-0");
  });

  test("includes informative tooltip title fallback for truncated viewports", () => {
    render(<NomadTierBadge tier="Silver" xp={850} />);

    const badge = screen.getByTestId("nomad-tier-badge");
    expect(badge).toHaveAttribute("title", "Silver Tier • 850 XP");
  });
});