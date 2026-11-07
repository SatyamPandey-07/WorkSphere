import React from "react";
import { render, screen } from "@testing-library/react";
import { ProximityBoundaryZone } from "@/components/spatial/ProximityBoundaryZone";

describe("ProximityBoundaryZone Component (#6487)", () => {
  it("renders SVG circular boundary zone with smooth radial gradient fill", () => {
    render(
      <svg>
        <ProximityBoundaryZone
          centerX={200}
          centerY={150}
          innerRadius={40}
          outerRadius={120}
          label="Engineering Cluster"
        />
      </svg>
    );

    expect(screen.getByTestId("proximity-boundary-zone")).toBeInTheDocument();
    expect(screen.getByTestId("proximity-gradient-fill")).toHaveAttribute("r", "120");
    expect(screen.getByTestId("proximity-outer-circle")).toHaveAttribute("r", "120");
    expect(screen.getByTestId("proximity-inner-circle")).toHaveAttribute("r", "40");
    expect(screen.getByTestId("proximity-zone-title")).toHaveTextContent("Engineering Cluster");
  });

  it("does not render admin drag handles when isEditable is false", () => {
    render(
      <svg>
        <ProximityBoundaryZone
          centerX={200}
          centerY={150}
          innerRadius={50}
          outerRadius={100}
          isEditable={false}
        />
      </svg>
    );

    expect(screen.queryByTestId("proximity-admin-handles")).not.toBeInTheDocument();
    expect(screen.queryByTestId("inner-radius-handle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("outer-radius-handle")).not.toBeInTheDocument();
  });

  it("renders admin drag handles when isEditable is true", () => {
    render(
      <svg>
        <ProximityBoundaryZone
          centerX={200}
          centerY={150}
          innerRadius={50}
          outerRadius={100}
          isEditable={true}
        />
      </svg>
    );

    expect(screen.getByTestId("proximity-admin-handles")).toBeInTheDocument();
    expect(screen.getByTestId("inner-radius-handle")).toBeInTheDocument();
    expect(screen.getByTestId("outer-radius-handle")).toBeInTheDocument();

    // Verify handle positions relative to center
    expect(screen.getByTestId("inner-radius-handle")).toHaveAttribute("cx", "250"); // 200 + 50
    expect(screen.getByTestId("outer-radius-handle")).toHaveAttribute("cx", "300"); // 200 + 100
  });

  it("renders labels correctly and supports hiding labels", () => {
    const { rerender } = render(
      <svg>
        <ProximityBoundaryZone
          centerX={100}
          centerY={100}
          innerRadius={30}
          outerRadius={80}
          showLabels={true}
        />
      </svg>
    );

    expect(screen.getByTestId("proximity-outer-label")).toHaveTextContent("Cutoff: 80px");
    expect(screen.getByTestId("proximity-inner-label")).toHaveTextContent("Core: 30px (100%)");

    rerender(
      <svg>
        <ProximityBoundaryZone
          centerX={100}
          centerY={100}
          innerRadius={30}
          outerRadius={80}
          showLabels={false}
        />
      </svg>
    );

    expect(screen.queryByTestId("proximity-zone-labels")).not.toBeInTheDocument();
  });
});
