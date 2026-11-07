import React from "react";
import { render, screen } from "@testing-library/react";
import { FallbackMap, FallbackMapProps } from "@/components/ar/FallbackMap";
import DefaultFallbackMap from "@/components/ar/FallbackMap";
import type { Vector3 } from "@/types/ar";

describe("FallbackMap Component Suite", () => {
  const validUser: Vector3 = { x: 2.0, y: 1.5, z: 3.0 };
  const validDesk: Vector3 = { x: 6.0, y: 1.5, z: 6.0 };

  it("renders with proper accessible region and default labels", () => {
    render(<FallbackMap />);

    const container = screen.getByRole("region", {
      name: /2d workspace fallback map/i,
    });
    expect(container).toBeInTheDocument();
    expect(screen.getByText("Workspace Map")).toBeInTheDocument();
    expect(
      screen.getByText("AR is not supported on this device."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("fallback-map-user-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("fallback-map-desk-indicator")).toBeInTheDocument();
  });

  it("displays target coordinates when valid deskPosition is provided", () => {
    render(<FallbackMap deskPosition={validDesk} />);

    const summary = screen.getByTestId("fallback-map-coordinates-summary");
    expect(summary).toHaveTextContent("Target: (6.0, 6.0)");
    expect(screen.queryByTestId("fallback-map-distance-badge")).not.toBeInTheDocument();
  });

  it("displays user coordinates in the user indicator when valid userPosition is provided", () => {
    render(<FallbackMap userPosition={validUser} />);

    const userIndicator = screen.getByTestId("fallback-map-user-indicator");
    expect(userIndicator).toHaveTextContent("You (2.0, 3.0)");
  });

  it("calculates and displays horizontal distance badge when both positions are valid", () => {
    // dx = 4.0, dz = 3.0 -> hypot(4, 3) = 5.0m
    render(<FallbackMap userPosition={validUser} deskPosition={validDesk} />);

    const badge = screen.getByTestId("fallback-map-distance-badge");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("Distance: 5.0m");

    const userIndicator = screen.getByTestId("fallback-map-user-indicator");
    expect(userIndicator).toHaveTextContent("You (2.0, 3.0)");

    const summary = screen.getByTestId("fallback-map-coordinates-summary");
    expect(summary).toHaveTextContent("Target: (6.0, 6.0)");
  });

  it("gracefully tolerates null or undefined coordinates without throwing", () => {
    expect(() => {
      render(<FallbackMap userPosition={null} deskPosition={undefined} />);
    }).not.toThrow();

    expect(screen.queryByTestId("fallback-map-distance-badge")).not.toBeInTheDocument();
    expect(
      screen.getByText("Target desk coordinates pending."),
    ).toBeInTheDocument();
  });

  it("safely handles non-finite (NaN, Infinity) vector objects", () => {
    const invalidUser: any = { x: NaN, y: 0, z: Infinity };
    const invalidDesk: any = { x: undefined, y: null, z: "invalid" };

    expect(() => {
      render(
        <FallbackMap
          userPosition={invalidUser}
          deskPosition={invalidDesk}
        />,
      );
    }).not.toThrow();

    expect(screen.queryByTestId("fallback-map-distance-badge")).not.toBeInTheDocument();
    expect(
      screen.getByText("Target desk coordinates pending."),
    ).toBeInTheDocument();
  });

  it("applies custom className to outer container", () => {
    render(<FallbackMap className="custom-theme-class" />);

    const container = screen.getByTestId("fallback-map-container");
    expect(container).toHaveClass("custom-theme-class");
  });

  it("supports default export rendering identically", () => {
    render(
      <DefaultFallbackMap userPosition={validUser} deskPosition={validDesk} />,
    );

    expect(screen.getByTestId("fallback-map-distance-badge")).toHaveTextContent(
      "Distance: 5.0m",
    );
  });
});
