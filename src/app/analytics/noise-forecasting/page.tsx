import React from "react";
import EdgeAcousticForecaster from "@/components/noise/EdgeAcousticForecaster";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Edge-AI Acoustic Profiling & 24-Hour Predictive Noise Forecasting | WorkSphere",
  description:
    "Evaluate venue acoustic frequency bands, predict espresso rushes, and review video call readiness with on-device FFT spectral classification.",
};

export default function NoiseForecastingPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4">
      <EdgeAcousticForecaster />
    </main>
  );
}
