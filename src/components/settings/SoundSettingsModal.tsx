"use client";

import React from "react";
import { useSound, VolumeCurve } from "@/components/SoundProvider";

export const SoundSettingsModal: React.FC = () => {
  const { curve, setCurve, volume, setVolume, effectiveGain } = useSound();

  return (
    <div className="p-4 space-y-4 rounded-lg bg-background border border-border">
      <h3 className="text-lg font-medium">Audio Attenuation Preferences</h3>

      <div className="space-y-2">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="volume-slider"
        >
          Master Volume ({(volume * 100).toFixed(0)}%)
        </label>
        <input
          id="volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full cursor-pointer"
        />
        <p className="text-xs text-muted-foreground">
          Perceived Gain: {(effectiveGain * 100).toFixed(1)}%
        </p>
      </div>

      <div className="space-y-2">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="curve-select"
        >
          Volume Attenuation Curve
        </label>
        <select
          id="curve-select"
          value={curve}
          onChange={(e) => setCurve(e.target.value as VolumeCurve)}
          className="w-full p-2 border rounded-md bg-background text-foreground border-input focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="logarithmic">
            Logarithmic (Default - Natural Perception)
          </option>
          <option value="exponential">
            Exponential (Smooth Low-level Adjustment)
          </option>
          <option value="linear">Linear (Standard Direct Gain)</option>
        </select>
      </div>
    </div>
  );
};
