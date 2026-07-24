import { useState, useCallback, useRef, useEffect } from 'react';
import type { LayoutRequest, LayoutRecommendation } from '../workers/layoutOptimizer.worker';

export function useLayoutOptimizer() {
  const [recommendation, setRecommendation] = useState<LayoutRecommendation | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../workers/layoutOptimizer.worker.ts", import.meta.url),
      { type: "module" }
    );

    workerRef.current.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "SUCCESS") {
        setRecommendation(data.payload);
      } else if (data.type === "ERROR") {
        setError(data.error);
      }
      setIsOptimizing(false);
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const optimize = useCallback((request: LayoutRequest) => {
    if (!workerRef.current) return;
    setIsOptimizing(true);
    setError(null);
    workerRef.current.postMessage(request);
  }, []);

  return { optimize, recommendation, isOptimizing, error };
}
