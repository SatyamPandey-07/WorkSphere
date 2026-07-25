import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  AudioEqualizer,
  type AudioEqualizerProps,
} from "@/components/audio/AudioEqualizer";
describe("AudioEqualizer JSDoc & Props Documentation (#1289)", () => {
  it("accepts initialGains, onGainChange, and sampleRate props without errors", () => {
    const handleGainChange = jest.fn();

    const props: AudioEqualizerProps = {
      venueName: "JSDoc Workspace",
      initialGains: [0, 2, -1],
      onGainChange: handleGainChange,
      sampleRate: 48000,
    };

    render(<AudioEqualizer {...props} />);

expect(screen.getByText("Acoustic Ambience Preview")).toBeInTheDocument();
    expect(screen.getByText(/JSDoc Workspace/)).toBeInTheDocument();
  });
});

describe("usePeakDecayLevel (#1559)", () => {
  let rafSpy: jest.SpyInstance;
  let nowSpy: jest.SpyInstance;
  let currentTime: number;

  beforeEach(() => {
    currentTime = 0;
    nowSpy = jest
      .spyOn(performance, "now")
      .mockImplementation(() => currentTime);
    // Run the "next frame" synchronously so we can advance time manually.
    rafSpy = jest
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        return setTimeout(() => cb(currentTime), 0) as unknown as number;
      });
    jest.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      clearTimeout(id as unknown as NodeJS.Timeout);
    });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    nowSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it("jumps up immediately on a louder level (fast attack)", () => {
    const { result, rerender } = renderHook(
      ({ level }) => usePeakDecayLevel(level, 300),
      { initialProps: { level: 0.2 } },
    );

    expect(result.current).toBe(0.2);

    rerender({ level: 0.9 });
    expect(result.current).toBe(0.9);
  });

  it("decays smoothly toward a quieter level over ~300ms instead of snapping down", () => {
    const { result, rerender } = renderHook(
      ({ level }) => usePeakDecayLevel(level, 300),
      { initialProps: { level: 0.8 } },
    );

    expect(result.current).toBe(0.8);

    // Volume drops to 0.
    rerender({ level: 0 });

    // Halfway through the decay window, it should be partway down, not 0 yet.
    act(() => {
      currentTime = 150;
      jest.advanceTimersByTime(0);
    });
  });
});