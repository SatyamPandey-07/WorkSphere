import "@testing-library/jest-dom";
import React from "react";
import { render } from "@testing-library/react";

// Mock react-joyride
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
  EVENTS: {
    TOUR_END: "tour:end",
  },
}));

import { OnboardingTour } from "@/components/OnboardingTour";

describe("OnboardingTourTheme", () => {
  beforeEach(() => {
    mockJoyride.mockClear();
    localStorage.clear();
  });

  it("applies premium buttons typography and colors", () => {
    render(<OnboardingTour />);

    const lastCall = mockJoyride.mock.calls[0][0] as any;
    const styles = lastCall.styles;

    // Next button theme assertions
    expect(styles.buttonNext.textTransform).toBe("uppercase");
    expect(styles.buttonNext.fontSize).toBe("11px");
    expect(styles.buttonNext.fontWeight).toBe(700);

    // Back button theme assertions
    expect(styles.buttonBack.textTransform).toBe("uppercase");
    expect(styles.buttonBack.color).toBe("#4b5563");

    // Skip button theme assertions
    expect(styles.buttonSkip.textTransform).toBe("uppercase");
    expect(styles.buttonSkip.color).toBe("#9ca3af");
  });
});
