import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LayoutRecommendation,
  LayoutRequest,
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "../workers/layoutOptimizer.worker";

function deserializeRecommendation(
  response: Extract<LayoutWorkerResponse, { type: "SUCCESS" }>,
): LayoutRecommendation {
  const deskCoordinates = new Float32Array(
    response.payload.deskCoordinatesBuffer,
  );
  const quietZoneCoordinates = new Float32Array(
    response.payload.quietZoneCoordinatesBuffer,
  );

  const desks = [];
  for (let index = 0; index < deskCoordinates.length; index += 3) {
    desks.push({
      x: deskCoordinates[index],
      y: deskCoordinates[index + 1],
      orientation: deskCoordinates[index + 2],
    });
  }

  const quietZones = [];
  for (let index = 0; index < quietZoneCoordinates.length; index += 3) {
    quietZones.push({
      x: quietZoneCoordinates[index],
      y: quietZoneCoordinates[index + 1],
      radius: quietZoneCoordinates[index + 2],
    });
  }

  return {
    desks,
    quietZones,
    score: response.payload.score,
  };
}

export function useLayoutOptimizer() {
  const [recommendation, setRecommendation] =
    useState<LayoutRecommendation | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const activeRequestIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof Worker === "undefined") {
      setError("Web Workers are not supported in this browser.");
      return;
    }

    const worker = new Worker(
      new URL("../workers/layoutOptimizer.worker.ts", import.meta.url),
      { type: "module" },
    );

    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
      const message = event.data;

      if (message.requestId !== activeRequestIdRef.current) {
        return;
      }

      if (message.type === "SUCCESS") {
        setRecommendation(deserializeRecommendation(message));
        setError(null);
      } else {
        setError(message.error);
      }

      activeRequestIdRef.current = null;
      setIsOptimizing(false);
    };

    worker.onerror = () => {
      setError("The layout optimization worker stopped unexpectedly.");
      activeRequestIdRef.current = null;
      setIsOptimizing(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      activeRequestIdRef.current = null;
    };
  }, []);

  const optimize = useCallback((request: LayoutRequest) => {
    const worker = workerRef.current;

    if (!worker) {
      setError("Layout optimizer worker is not available.");
      return;
    }

    const floorPlanGrid =
      request.floorPlanGrid instanceof Float32Array
        ? new Float32Array(request.floorPlanGrid)
        : Float32Array.from(request.floorPlanGrid);

    const requestId = ++requestIdRef.current;
    activeRequestIdRef.current = requestId;
    setIsOptimizing(true);
    setError(null);

    const message: LayoutWorkerRequest = {
      type: "OPTIMIZE",
      requestId,
      payload: {
        floorPlanGridBuffer: floorPlanGrid.buffer as ArrayBuffer,
        width: request.width,
        height: request.height,
        deskCount: request.deskCount,
        powerOutlets: request.powerOutlets,
      },
    };

    worker.postMessage(message, [floorPlanGrid.buffer as ArrayBuffer]);
  }, []);

  return {
    optimize,
    recommendation,
    isOptimizing,
    error,
  };
}
