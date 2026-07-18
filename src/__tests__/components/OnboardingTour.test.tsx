import { render, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock react-joyride before importing the component
const mockJoyride = jest.fn(() => null);
jest.mock("react-joyride", () => ({
  Joyride: (props: any) => {
    mockJoyride(props);
    return null;
  },
  STATUS: {
    FINISHED: "finished",
    SKIPPED: "skipped",
  },
}));

import { OnboardingTour } from "@/components/OnboardingTour";

describe("OnboardingTour", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("exports OnboardingTour component", () => {
    expect(OnboardingTour).toBeDefined();
    expect(typeof OnboardingTour).toBe("function");
  });

  it("starts the tour for first-time users (no localStorage flag)", () => {
    render(<OnboardingTour />);

    // The tour uses a 1-second delay before starting
    act(() => {
      jest.advanceTimersByTime(1100);
    });

    // Joyride should be called with run=true
    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    expect(lastCall.run).toBe(true);
  });

  it("does NOT start the tour when onboarding is already completed", () => {
    localStorage.setItem("worksphere-onboarding-completed", "true");

    render(<OnboardingTour />);

    act(() => {
      jest.advanceTimersByTime(1100);
    });

    // Joyride should be called with run=false (never set to true)
    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    expect(lastCall.run).toBe(false);
  });

  it("defines exactly 3 tour steps targeting map, chat, and booking", () => {
    render(<OnboardingTour />);

    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    const steps = lastCall.steps;

    expect(steps).toHaveLength(3);
    expect(steps[0].target).toBe(".joyride-map");
    expect(steps[1].target).toBe(".joyride-chat");
    expect(steps[2].target).toBe(".joyride-booking");
  });

  it("passes showSkipButton to Joyride", () => {
    render(<OnboardingTour />);

    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    expect(lastCall.showSkipButton).toBe(true);
  });

  it("saves completion to localStorage when tour is finished", () => {
    render(<OnboardingTour />);

    // Simulate Joyride calling back with FINISHED status
    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    act(() => {
      lastCall.callback({ status: "finished" });
    });

    expect(localStorage.getItem("worksphere-onboarding-completed")).toBe(
      "true",
    );
  });

  it("saves completion to localStorage when tour is skipped", () => {
    render(<OnboardingTour />);

    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    act(() => {
      lastCall.callback({ status: "skipped" });
    });

    expect(localStorage.getItem("worksphere-onboarding-completed")).toBe(
      "true",
    );
  });

  it("does NOT save to localStorage for other callback statuses", () => {
    render(<OnboardingTour />);

    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    act(() => {
      lastCall.callback({ status: "running" });
    });

    expect(localStorage.getItem("worksphere-onboarding-completed")).toBeNull();
  });

  it("each step has a title and content", () => {
    render(<OnboardingTour />);

    const lastCall =
      mockJoyride.mock.calls[mockJoyride.mock.calls.length - 1][0];
    const steps = lastCall.steps;

    for (const step of steps) {
      expect(step.title).toBeTruthy();
      expect(step.content).toBeTruthy();
    }
  });
});
