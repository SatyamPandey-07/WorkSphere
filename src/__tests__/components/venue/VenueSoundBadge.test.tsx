import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { VenueSoundBadge } from "@/components/venue/VenueSoundBadge";

describe("VenueSoundBadge", () => {
  it("shows a labeled illustrative spectrum on hover with a valid description link", () => {
    render(<VenueSoundBadge noiseLevel="moderate" />);

    const badge = screen.getByRole("img", {
      name: "Ambient noise level: moderate",
    });
    expect(badge).toHaveAttribute("tabindex", "0");
    expect(badge).toHaveTextContent("moderate");
    expect(badge).not.toHaveAttribute("aria-describedby");

    fireEvent.mouseEnter(screen.getByTestId("venue-sound-badge-container"));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("Illustrative frequency spectrum");
    expect(tooltip).toHaveTextContent("no measured frequency-band data");
    expect(badge).toHaveAttribute("aria-describedby", tooltip.id);
    expect(document.getElementById(tooltip.id)).toBe(tooltip);

    expect(tooltip).toHaveTextContent("Bass (low)");
    expect(tooltip).toHaveTextContent("Mid (medium)");
    expect(tooltip).toHaveTextContent("Treble (high)");
    expect(screen.getByTestId("spectrum-bar-bass")).toHaveAttribute(
      "data-level-db",
      "50",
    );
    expect(screen.getByTestId("spectrum-bar-mid")).toHaveAttribute(
      "data-level-db",
      "58",
    );
    expect(screen.getByTestId("spectrum-bar-treble")).toHaveAttribute(
      "data-level-db",
      "46",
    );
    for (const band of ["bass", "mid", "treble"]) {
      expect(screen.getByTestId(`spectrum-bar-${band}`).style.height).toMatch(
        /%$/,
      );
    }
  });

  it("shows the tooltip on keyboard focus and dismisses it on blur", () => {
    render(<VenueSoundBadge noiseLevel="quiet" />);
    const badge = screen.getByRole("img", {
      name: "Ambient noise level: quiet",
    });

    fireEvent.focus(badge);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(badge).toHaveAttribute("aria-describedby");

    fireEvent.blur(badge);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(badge).not.toHaveAttribute("aria-describedby");
  });

  it("keeps the tooltip open while the pointer moves into it and closes on exit", () => {
    render(<VenueSoundBadge noiseLevel="loud" />);
    const container = screen.getByTestId("venue-sound-badge-container");
    fireEvent.mouseEnter(container);

    const tooltip = screen.getByRole("tooltip");
    fireEvent.mouseLeave(container, { relatedTarget: tooltip });
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.mouseLeave(container, { relatedTarget: document.body });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("dismisses the tooltip with Escape", () => {
    render(<VenueSoundBadge noiseLevel="quiet" />);
    const badge = screen.getByRole("img", {
      name: "Ambient noise level: quiet",
    });
    fireEvent.focus(badge);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(badge, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(badge).not.toHaveAttribute("aria-describedby");
  });

  it("uses a unique tooltip id for each badge instance", () => {
    render(
      <>
        <VenueSoundBadge noiseLevel="quiet" />
        <VenueSoundBadge noiseLevel="loud" />
      </>,
    );
    const badges = screen.getAllByTestId("venue-sound-badge");

    badges.forEach((badge) => fireEvent.focus(badge));

    const tooltipIds = badges
      .map((badge) => badge.getAttribute("aria-describedby"))
      .filter((id): id is string => id !== null);
    expect(tooltipIds).toHaveLength(2);
    expect(new Set(tooltipIds).size).toBe(2);
    tooltipIds.forEach((id) => {
      expect(document.getElementById(id)).toHaveAttribute("role", "tooltip");
    });
  });

  it("keeps the displayed noise label and avoids inventing bands for unknown levels", () => {
    render(<VenueSoundBadge noiseLevel="unclassified" />);
    const badge = screen.getByRole("img", {
      name: "Ambient noise level: unclassified",
    });
    expect(badge).toHaveTextContent("unclassified");

    fireEvent.focus(badge);
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(
      "No estimate is available for this noise-level value.",
    );
    expect(screen.queryByTestId("spectrum-bar-bass")).not.toBeInTheDocument();
  });
});
