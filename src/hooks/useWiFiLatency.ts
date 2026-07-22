"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface WiFiLatencyPrediction {
  hourlyLatency: number[];
  hourlyPacketLoss: number[];
  peakHours: number[];
  bestTimeSlot: { hour: number; latency: number };
  confidence: number;
}

interface UseWiFiLatencyOptions {
  venueId: string;
  historicalLatency?: number[];
  historicalPacketLoss?: number[];
  weatherScore?: number;
  eventImpact?: number;
  currentLoad?: number;
}

export function useWiFiLatency({
  venueId,
  historicalLatency = [],
  historicalPacketLoss = [],
  weatherScore = 0.3,
  eventImpact = 0.1,
  currentLoad = 0.4,
}: UseWiFiLatencyOptions) {
  const [predictions, setPredictions] = useState<WiFiLatencyPrediction | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const worker = new Worker(
      new URL("../workers/wifiLatencyWorker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (e: MessageEvent) => {
      if (e.data.success) {
        setPredictions(e.data.predictions);
        setError(null);
      } else {
        setError(e.data.error ?? "Prediction failed");
      }
      setIsLoading(false);
    };

    worker.onerror = () => {
      setError("Worker failed to load");
      setIsLoading(false);
    };

    workerRef.current = worker;

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const predict = useCallback(() => {
    if (!workerRef.current) return;
    setIsLoading(true);
    setError(null);

    const now = new Date();

    workerRef.current.postMessage({
      venueId,
      telemetry: {
        historicalLatency: historicalLatency.length
          ? historicalLatency
          : Array.from({ length: 24 }, (_, i) =>
              i >= 10 && i <= 16
                ? 35 + Math.random() * 20
                : 15 + Math.random() * 15,
            ),
        historicalPacketLoss: historicalPacketLoss.length
          ? historicalPacketLoss
          : Array.from({ length: 24 }, (_, i) =>
              i >= 10 && i <= 16
                ? 2 + Math.random() * 5
                : 0.5 + Math.random() * 2,
            ),
        timeOfDay: now.getHours(),
        dayOfWeek: now.getDay(),
        weatherScore,
        eventImpact,
        currentLoad,
      },
    });
  }, [
    venueId,
    historicalLatency,
    historicalPacketLoss,
    weatherScore,
    eventImpact,
    currentLoad,
  ]);

  useEffect(() => {
    predict();
  }, [predict]);

  return { predictions, isLoading, error, predict };
}
