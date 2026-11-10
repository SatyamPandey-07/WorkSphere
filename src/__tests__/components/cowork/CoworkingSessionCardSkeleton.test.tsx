import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  CoworkingSessionCardSkeleton,
  CoworkingShimmer,
} from "@/components/cowork/CoworkingSessionCardSkeleton";

describe("CoworkingSessionCardSkeleton", () => {
  it("renders a single skeleton card with role status and accessible text by default", () => {
    render(<CoworkingSessionCardSkeleton />);

    const card = screen.getByTestId("coworking-session-card-skeleton");
    expect(card).toBeInTheDocument();
    expect(card).toHaveAttribute("role", "status");
    expect(card).toHaveAttribute("aria-label", "Loading coworking session");

    const srText = screen.getByText("Loading coworking session details...");
    expect(srText).toBeInTheDocument();
    expect(srText).toHaveClass("sr-only");
  });

  it("replicates the exact layout dimensions: host title, avatar badges, time slot, and action button", () => {
    render(<CoworkingSessionCardSkeleton />);

    // Host title and badge
    const hostTitle = screen.getByTestId("skeleton-host-title");
    expect(hostTitle).toBeInTheDocument();
    expect(hostTitle).toHaveClass("h-6", "w-44");

    const badge = screen.getByTestId("skeleton-session-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass("h-6", "w-32", "rounded-full");

    // Avatar badges: host avatar badge & attendee avatar cluster
    const hostAvatarBadge = screen.getByTestId("skeleton-host-avatar-badge");
    expect(hostAvatarBadge).toBeInTheDocument();
    expect(hostAvatarBadge).toHaveClass("w-5", "h-5", "rounded-full");

    const avatarBadgesCluster = screen.getByTestId("skeleton-avatar-badges");
    expect(avatarBadgesCluster).toBeInTheDocument();
    expect(avatarBadgesCluster.children.length).toBe(3);

    // Time slot placeholder
    const timeSlot = screen.getByTestId("skeleton-time-slot");
    expect(timeSlot).toBeInTheDocument();
    expect(timeSlot).toHaveClass("h-3.5", "w-36");

    // Action button placeholder
    const actionButton = screen.getByTestId("skeleton-action-button");
    expect(actionButton).toBeInTheDocument();
    expect(actionButton).toHaveClass("w-full", "h-10", "rounded-lg");
  });

  it("uses CSS pulse gradients with shimmer animation on placeholder elements", () => {
    render(<CoworkingSessionCardSkeleton />);

    const hostTitle = screen.getByTestId("skeleton-host-title");
    expect(hostTitle).toHaveClass(
      "bg-gradient-to-r",
      "from-zinc-800",
      "via-zinc-700",
      "to-zinc-800",
      "bg-[length:200%_100%]",
      "animate-shimmer"
    );
  });

  it("ensures dark, light, and cyberpunk theme compatibility styling", () => {
    render(<CoworkingSessionCardSkeleton className="custom-theme-test" />);

    const card = screen.getByTestId("coworking-session-card-skeleton");
    expect(card).toHaveClass(
      "bg-white",
      "dark:bg-slate-900",
      "border-zinc-200",
      "dark:border-slate-800",
      "custom-theme-test"
    );
  });

  it("renders multiple skeleton cards inside a group when count > 1", () => {
    render(<CoworkingSessionCardSkeleton count={3} />);

    const group = screen.getByTestId("coworking-session-skeleton-group");
    expect(group).toBeInTheDocument();
    expect(screen.getByTestId("coworking-session-card-skeleton-0")).toBeInTheDocument();
    expect(screen.getByTestId("coworking-session-card-skeleton-1")).toBeInTheDocument();
    expect(screen.getByTestId("coworking-session-card-skeleton-2")).toBeInTheDocument();
  });
});
