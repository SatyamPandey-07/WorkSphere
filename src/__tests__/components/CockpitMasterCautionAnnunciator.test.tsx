import React from "react";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import CockpitMasterCautionAnnunciator, {
  calculateDbSegments,
} from "@/components/audio/CockpitMasterCautionAnnunciator";

const mockPlayMasterCaution = jest.fn();
const mockStopMasterCaution = jest.fn();
const mockSetIsMuted = jest.fn();
const mockUnlockAudio = jest.fn();

jest.mock("@/hooks/useAvionicsAudio", () => ({
  useAvionicsAudio: jest.fn(() => ({
    playMasterCaution: mockPlayMasterCaution,
    stopMasterCaution: mockStopMasterCaution,
    isCautionActive: false,
    isMuted: false,
    setIsMuted: mockSetIsMuted,
    isOffline: false,
    isLowBattery: false,
    unlockAudio: mockUnlockAudio,
  })),
}));

describe("CockpitMasterCautionAnnunciator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      cleanup();
      jest.clearAllTimers();
    });
    jest.useRealTimers();
  });

  describe("calculateDbSegments helper", () => {
    it("generates 10 ascending decibel segments between 40 and 90 dB", () => {
      const segs = calculateDbSegments(54, 72);
      expect(segs).toHaveLength(10);
      expect(segs[0].val).toBe(45);
      expect(segs[9].val).toBe(90);

      // 54 dB should illuminate segments <= 54 (45 and 50 dB)
      expect(segs[0].isLit).toBe(true);
      expect(segs[1].isLit).toBe(true);
      expect(segs[2].isLit).toBe(false);
      expect(segs[0].isOverLimit).toBe(false);
    });

    it("marks segments exceeding threshold as isOverLimit", () => {
      const segs = calculateDbSegments(80, 72);
      const overLimitSegments = segs.filter((s) => s.isOverLimit);
      expect(overLimitSegments.length).toBeGreaterThan(0);
      overLimitSegments.forEach((s) => {
        expect(s.val).toBeGreaterThanOrEqual(72);
      });
    });

    it("safely handles NaN and non-finite decibel or threshold values", () => {
      const segs = calculateDbSegments(NaN, NaN);
      expect(segs).toHaveLength(10);
      expect(segs.every((s) => Number.isFinite(s.val))).toBe(true);
    });
  });

  describe("CockpitMasterCautionAnnunciator component", () => {
    it("renders default nominal panel with sector name and inactive alerts", () => {
      render(
        <CockpitMasterCautionAnnunciator
          decibels={50}
          thresholdDecibels={72}
          sectorName="Sector-Alpha // Command"
        />,
      );

      expect(screen.getByText("Sector-Alpha // Command")).toBeInTheDocument();
      expect(screen.getByText("NOMINAL")).toBeInTheDocument();
      expect(screen.getByText(/ALL SYSTEMS NOMINAL/i)).toBeInTheDocument();
      expect(screen.getByTestId("current-decibel-display")).toHaveTextContent("50 dB");
    });

    it("activates Master Caution alarm and illuminates NOISE LIMIT red tile on noise breach", () => {
      render(
        <CockpitMasterCautionAnnunciator
          decibels={78}
          thresholdDecibels={72}
          enableAudioAlerts={true}
        />,
      );

      expect(screen.getByText("PUSH TO RESET")).toBeInTheDocument();
      expect(screen.getByText(/ALERT ACTIVE/i)).toBeInTheDocument();

      const noiseTile = screen.getByTestId("tile-decibel");
      expect(noiseTile).toHaveClass("bg-red-950/90");
      expect(noiseTile).toHaveTextContent("NOISE LIMIT");

      expect(mockPlayMasterCaution).toHaveBeenCalledWith({ cycles: 2 });
    });

    it("illuminates TRANSIENT amber tile when transient peak impulse is flagged", () => {
      render(
        <CockpitMasterCautionAnnunciator
          decibels={60}
          thresholdDecibels={72}
          hasTransientSpike={true}
        />,
      );

      const transientTile = screen.getByTestId("tile-transient");
      expect(transientTile).toHaveClass("bg-amber-950/90");
      expect(transientTile).toHaveTextContent("TRANSIENT");
    });

    it("illuminates custom warning tiles passed via flags prop", () => {
      render(
        <CockpitMasterCautionAnnunciator
          decibels={50}
          thresholdDecibels={72}
          flags={{
            latencySpike: true,
            offline: true,
          }}
        />,
      );

      const latencyTile = screen.getByTestId("tile-latency");
      const offlineTile = screen.getByTestId("tile-offline");

      expect(latencyTile).toHaveClass("bg-amber-950/90");
      expect(offlineTile).toHaveClass("bg-red-950/90");
    });

    it("acknowledges and silences alert when Master Caution button is pressed", () => {
      const onCautionResetMock = jest.fn();

      render(
        <CockpitMasterCautionAnnunciator
          decibels={80}
          thresholdDecibels={72}
          onCautionReset={onCautionResetMock}
        />,
      );

      const cautionBtn = screen.getByTestId("master-caution-button");
      expect(cautionBtn).toHaveTextContent("PUSH TO RESET");

      fireEvent.click(cautionBtn);

      expect(mockStopMasterCaution).toHaveBeenCalled();
      expect(onCautionResetMock).toHaveBeenCalled();
      expect(screen.getByText("ACKNOWLEDGED")).toBeInTheDocument();
      expect(screen.getByText(/SILENCED/i)).toBeInTheDocument();
    });

    it("toggles audio mute and calls unlockAudio when audio button is clicked", () => {
      render(<CockpitMasterCautionAnnunciator decibels={55} />);

      const muteBtn = screen.getByTestId("toggle-caution-audio-btn");
      fireEvent.click(muteBtn);

      expect(mockUnlockAudio).toHaveBeenCalled();
      expect(mockSetIsMuted).toHaveBeenCalledWith(true);
    });

    it("interactively simulates noise spike on test button click", () => {
      render(<CockpitMasterCautionAnnunciator decibels={54} thresholdDecibels={72} />);

      const spikeBtn = screen.getByTestId("simulate-db-spike-btn");
      expect(spikeBtn).toHaveTextContent("Spike (82 dB)");

      fireEvent.click(spikeBtn);

      expect(screen.getByTestId("current-decibel-display")).toHaveTextContent("82 dB");
      expect(screen.getByText("PUSH TO RESET")).toBeInTheDocument();
    });

    it("handles NaN decibels and thresholds gracefully without rendering NaN", () => {
      render(
        <CockpitMasterCautionAnnunciator
          decibels={NaN}
          thresholdDecibels={NaN}
        />,
      );

      expect(screen.getByTestId("current-decibel-display")).toHaveTextContent("54 dB");
      expect(screen.getByText("/ LIMIT 72 dB")).toBeInTheDocument();
    });
  });
});
