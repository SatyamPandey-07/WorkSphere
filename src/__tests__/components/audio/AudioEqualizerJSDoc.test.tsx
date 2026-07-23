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
