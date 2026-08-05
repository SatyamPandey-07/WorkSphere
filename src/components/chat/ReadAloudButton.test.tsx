import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ReadAloudButton } from "./ReadAloudButton";
import "@testing-library/jest-dom";

// Mock the speech hook so the component renders without errors in the test environment
jest.mock("@/hooks/useSpeechSynthesis", () => ({
  useSpeechSynthesis: () => ({
    isSupported: true,
    isSpeaking: false,
    rate: 1,
    setRate: jest.fn(),
    speak: jest.fn(),
    cancel: jest.fn(),
  }),
  SPEED_OPTIONS: [1, 1.5, 2],
}));

describe("ReadAloudButton Tooltip Positioning", () => {
  it("positions tooltip at the bottom if near the top edge and hides on touch", () => {
    render(<ReadAloudButton text="Test message" />);

    // Find the button
    const button = screen.getByRole("button", { name: /Read message aloud/i });

    // The Tooltip wrapper is the parent element of the button
    const tooltipContainer = button.parentElement;

    // Mock the bounding rect to simulate the button being 20px from the top of the screen (less than 50px)
    if (tooltipContainer) {
      tooltipContainer.getBoundingClientRect = jest.fn(() => ({
        top: 20,
        bottom: 60,
        left: 0,
        right: 100,
        width: 100,
        height: 40,
        x: 0,
        y: 20,
        toJSON: () => {},
      })) as any;
    }

    // 1. Simulate mouse hover to trigger the position calculation
    fireEvent.mouseEnter(tooltipContainer!);

    // Grab the tooltip element by its test ID, scoped to this button's own
    // tooltip wrapper — the playback-speed control renders a second element
    // with the same test ID elsewhere in the component.
    const tooltip = within(tooltipContainer!).getByTestId("tooltip");

    // Verify it is visible and positioned at the bottom (top-full) because it was too close to the top
    expect(tooltip.className).toContain("opacity-100");
    expect(tooltip.className).toContain("top-full");

    // 2. Simulate a mobile touch event
    fireEvent.touchStart(tooltipContainer!);

    // Verify the tooltip hides itself (opacity-0)
    expect(tooltip.className).toContain("opacity-0");
  });
});
