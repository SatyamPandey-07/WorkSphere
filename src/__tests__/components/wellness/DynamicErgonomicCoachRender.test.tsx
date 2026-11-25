import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import DynamicErgonomicCoach from "@/components/wellness/DynamicErgonomicCoach";

jest.mock("@/lib/audio/ErgonomicChimeSynthesizer", () => ({
  ErgonomicChimeSynthesizer: jest.fn().mockImplementation(() => ({
    playChime: jest.fn().mockResolvedValue(undefined),
    dispose: jest.fn().mockResolvedValue(undefined),
  })),
}));

describe("DynamicErgonomicCoach rendering (#7901)", () => {
  it("renders the default coach tab with the live sit-stand ratio", () => {
    render(<DynamicErgonomicCoach />);
    expect(screen.getByText("Sit-Stand Ratio:")).toBeInTheDocument();
  });

  it("opens the sit/stand ratio analytics tab", () => {
    render(<DynamicErgonomicCoach />);

    fireEvent.click(screen.getByText("Open Weekly Summary Analytics"));

    expect(screen.getByTestId("sit-stand-ratio-analytics")).toBeInTheDocument();
  });
});
