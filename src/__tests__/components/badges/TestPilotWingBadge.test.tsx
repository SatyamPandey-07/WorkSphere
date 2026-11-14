import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TestPilotWingBadge } from "@/components/badges/TestPilotWingBadge";

describe("TestPilotWingBadge", () => {
  it("renders the badge correctly", () => {
    render(<TestPilotWingBadge />);

    expect(screen.getByTestId("test-pilot-wing-badge")).toBeInTheDocument();
    expect(screen.getByText("TEST PILOT")).toBeInTheDocument();
  });

  it("renders the SVG wing insignia", () => {
    const { container } = render(<TestPilotWingBadge />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the exact tooltip on mouse hover", () => {
    render(<TestPilotWingBadge />);

    const badge = screen.getByTestId("test-pilot-wing-badge");
    const tooltip = screen.getByTestId("test-pilot-wing-tooltip");

    expect(tooltip).not.toBeVisible();

    fireEvent.mouseEnter(badge);

    expect(tooltip).toBeVisible();
    expect(tooltip).toHaveTextContent(
      "Test Pilot Wings: Awarded for high-velocity global coworking missions."
    );

    fireEvent.mouseLeave(badge);

    expect(tooltip).not.toBeVisible();
  });

  it("shows the tooltip on keyboard focus", () => {
    render(<TestPilotWingBadge />);

    const badge = screen.getByTestId("test-pilot-wing-badge");
    const tooltip = screen.getByTestId("test-pilot-wing-tooltip");

    fireEvent.focus(badge);

    expect(tooltip).toBeVisible();

    fireEvent.blur(badge);

    expect(tooltip).not.toBeVisible();
  });

  it("supports keyboard focus", () => {
    render(<TestPilotWingBadge />);

    expect(screen.getByTestId("test-pilot-wing-badge")).toHaveAttribute(
      "tabIndex",
      "0"
    );
  });

  it("supports custom className and testId", () => {
    render(
      <TestPilotWingBadge
        className="custom-badge"
        testId="custom-test-pilot"
      />
    );

    const badge = screen.getByTestId("custom-test-pilot");

    expect(badge).toHaveClass("custom-badge");
  });

  it("supports dark and light theme styling", () => {
    render(<TestPilotWingBadge />);

    const badge = screen.getByTestId("test-pilot-wing-badge");

    expect(badge.className).toContain("dark:from-zinc-800");
    expect(badge.className).toContain("bg-gradient-to-r");
  });
});
