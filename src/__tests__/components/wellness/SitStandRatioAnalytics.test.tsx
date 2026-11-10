import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import SitStandRatioAnalyticsDefault, {
  SitStandRatioAnalytics,
} from "@/components/wellness/SitStandRatioAnalytics";
import { generateSampleWeeklyPostureHistory } from "@/lib/wellness/deskPostureAnalytics";

describe("SitStandRatioAnalytics Component", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      writable: true,
      configurable: true,
    });
  });

  describe("Exports", () => {
    it("exports SitStandRatioAnalytics as both named and default export", () => {
      expect(SitStandRatioAnalytics).toBeDefined();
      expect(SitStandRatioAnalyticsDefault).toBeDefined();
      expect(SitStandRatioAnalytics).toBe(SitStandRatioAnalyticsDefault);
    });
  });

  describe("Default Rendering & Header", () => {
    it("renders default container with heading and real-time badge", () => {
      render(<SitStandRatioAnalytics />);

      const root = screen.getByTestId("sit-stand-ratio-analytics");
      expect(root).toBeInTheDocument();
      expect(
        screen.getByText("Sit vs. Standing Desk Duration Ratio"),
      ).toBeInTheDocument();
      expect(screen.getByText("REAL-TIME")).toBeInTheDocument();
    });

    it("renders target ratio presets and toggle info button", () => {
      render(<SitStandRatioAnalytics />);

      expect(screen.getByText("Target 1:1")).toBeInTheDocument();
      expect(screen.getByText("Target 2:1")).toBeInTheDocument();
      expect(screen.getByText("Target 3:1")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "View ergonomic ratio standards" }),
      ).toBeInTheDocument();
    });
  });

  describe("Target Preset Selection & Info", () => {
    it("updates target ratio and persists to localStorage on click", () => {
      render(<SitStandRatioAnalytics />);

      const target1Btn = screen.getByText("Target 1:1");
      fireEvent.click(target1Btn);

      expect(localStorage.getItem("worksphere_desk_target_ratio")).toBe("1");
      expect(target1Btn).toHaveClass("bg-emerald-600");
    });

    it("toggles clinical standards info banner on info button click", () => {
      render(<SitStandRatioAnalytics />);

      const infoBtn = screen.getByRole("button", {
        name: "View ergonomic ratio standards",
      });
      expect(
        screen.queryByText("Clinical Ergonomics Ratio Standards:"),
      ).not.toBeInTheDocument();

      fireEvent.click(infoBtn);
      expect(
        screen.getByText("Clinical Ergonomics Ratio Standards:"),
      ).toBeInTheDocument();

      fireEvent.click(infoBtn);
      expect(
        screen.queryByText("Clinical Ergonomics Ratio Standards:"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Quick Simulation Actions", () => {
    it("triggers onUpdateTimes when +15m Stand is clicked", () => {
      const onUpdateTimes = jest.fn();
      render(
        <SitStandRatioAnalytics
          currentSittingSeconds={2700}
          currentStandingSeconds={1200}
          onUpdateTimes={onUpdateTimes}
        />,
      );

      const addStandBtn = screen.getByRole("button", { name: /\+15m Stand/i });
      fireEvent.click(addStandBtn);

      expect(onUpdateTimes).toHaveBeenCalledWith(2700, 1200 + 15 * 60);
    });

    it("triggers onUpdateTimes when +30m Sit is clicked", () => {
      const onUpdateTimes = jest.fn();
      render(
        <SitStandRatioAnalytics
          currentSittingSeconds={2700}
          currentStandingSeconds={1200}
          onUpdateTimes={onUpdateTimes}
        />,
      );

      const addSitBtn = screen.getByRole("button", { name: /\+30m Sit/i });
      fireEvent.click(addSitBtn);

      expect(onUpdateTimes).toHaveBeenCalledWith(2700 + 30 * 60, 1200);
    });

    it("triggers onTogglePosture when posture switch button is clicked", () => {
      const onTogglePosture = jest.fn();
      render(
        <SitStandRatioAnalytics
          currentPostureState="sitting"
          onTogglePosture={onTogglePosture}
        />,
      );

      const toggleBtn = screen.getByRole("button", {
        name: /Switch to Standing Posture/i,
      });
      fireEvent.click(toggleBtn);

      expect(onTogglePosture).toHaveBeenCalledTimes(1);
    });
  });

  describe("Report Copying & Reset", () => {
    it("copies text report to clipboard and shows feedback", async () => {
      const writeTextMock = jest.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        writable: true,
        configurable: true,
      });

      render(<SitStandRatioAnalytics />);

      const copyBtn = screen.getByRole("button", {
        name: /Export Report/i,
      });
      fireEvent.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalled();
      await waitFor(() => {
        expect(screen.getByText("Report Copied!")).toBeInTheDocument();
      });
    });

    it("resets weekly records when reset button is clicked", () => {
      render(<SitStandRatioAnalytics />);

      const resetBtn = screen.getByRole("button", {
        name: "Reset weekly sample history",
      });
      fireEvent.click(resetBtn);

      expect(
        localStorage.getItem("worksphere_desk_weekly_records"),
      ).not.toBeNull();
    });
  });

  describe("Custom Props & Overrides", () => {
    it("supports custom data-testid and className overrides", () => {
      render(
        <SitStandRatioAnalytics
          data-testid="custom-wellness-analytics"
          className="my-custom-layout-class"
        />,
      );

      const root = screen.getByTestId("custom-wellness-analytics");
      expect(root).toBeInTheDocument();
      expect(root).toHaveClass("my-custom-layout-class");
      expect(root).toHaveClass("space-y-6");
    });

    it("supports initialDailyRecords prop", () => {
      const customRecords = generateSampleWeeklyPostureHistory(3.0);
      render(
        <SitStandRatioAnalytics initialDailyRecords={customRecords} />,
      );

      expect(screen.getByTestId("sit-stand-ratio-analytics")).toBeInTheDocument();
    });
  });
});
