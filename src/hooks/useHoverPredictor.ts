import { useRef, useCallback } from "react";

interface Point {
  x: number;
  y: number;
  time: number;
}

interface PredictorOptions {
  onPredict: () => void;
  /** Velocity threshold (pixels/ms). Lower means slower movement required to trigger. */
  velocityThreshold?: number;
  /** How long the user must hover or move slowly within the element to trigger (ms). */
  hoverTimeThreshold?: number;
}

export function useHoverPredictor({
  onPredict,
  velocityThreshold = 0.5,
  hoverTimeThreshold = 300,
}: PredictorOptions) {
  const pointsRef = useRef<Point[]>([]);
  const hasPredictedRef = useRef(false);
  const hoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const calculateVelocity = (p1: Point, p2: Point) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dt = p2.time - p1.time;
    if (dt === 0) return 0;
    return Math.sqrt(dx * dx + dy * dy) / dt;
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (hasPredictedRef.current) return;

      const newPoint = { x: e.clientX, y: e.clientY, time: Date.now() };
      pointsRef.current.push(newPoint);

      // Keep only last 5 points
      if (pointsRef.current.length > 5) {
        pointsRef.current.shift();
      }

      if (pointsRef.current.length >= 2) {
        const p1 = pointsRef.current[0];
        const p2 = pointsRef.current[pointsRef.current.length - 1];
        const velocity = calculateVelocity(p1, p2);

        // If moving slowly over the element, user is likely reading or about to click
        if (velocity < velocityThreshold) {
          if (!hoverTimerRef.current) {
            hoverTimerRef.current = setTimeout(() => {
              if (!hasPredictedRef.current) {
                hasPredictedRef.current = true;
                onPredict();
              }
            }, hoverTimeThreshold);
          }
        } else {
          // Moving fast, clear timer
          if (hoverTimerRef.current) {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = null;
          }
        }
      }
    },
    [onPredict, velocityThreshold, hoverTimeThreshold],
  );

  const handleMouseEnter = useCallback(() => {
    hasPredictedRef.current = false;
    pointsRef.current = [];
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    pointsRef.current = [];
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  // Return a ref to attach to the target element
  return useCallback(
    (node: HTMLElement | null) => {
      if (elementRef.current && node !== elementRef.current) {
        elementRef.current.removeEventListener("mousemove", handleMouseMove);
        elementRef.current.removeEventListener("mouseenter", handleMouseEnter);
        elementRef.current.removeEventListener("mouseleave", handleMouseLeave);
      }
      if (node) {
        node.addEventListener("mousemove", handleMouseMove);
        node.addEventListener("mouseenter", handleMouseEnter);
        node.addEventListener("mouseleave", handleMouseLeave);
      }
      elementRef.current = node;
    },
    [handleMouseMove, handleMouseEnter, handleMouseLeave],
  );
}
