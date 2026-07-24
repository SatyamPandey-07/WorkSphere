import { useState, useEffect } from "react";
import { Vector3 } from "../types/ar";
import { calculateDistance } from "../lib/math";

export function useArrivalDetection(
  currentPosition: Vector3 | null,
  targetPosition: Vector3 | undefined,
  threshold: number = 1.0,
) {
  const [arrived, setArrived] = useState<boolean>(false);

  useEffect(() => {
    if (!currentPosition || !targetPosition) return;

    const distance = calculateDistance(currentPosition, targetPosition);
    if (distance < threshold && !arrived) {
      setArrived(true);
    } else if (distance >= threshold && arrived) {
      setArrived(false);
    }
  }, [currentPosition, targetPosition, threshold, arrived]);

  return arrived;
}
