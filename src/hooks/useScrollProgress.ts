"use client";

import { useState, useEffect } from "react";

export function useScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frameId: number;

    const handleScroll = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        const maxScrollableHeight =
          document.documentElement.scrollHeight - window.innerHeight;

        if (maxScrollableHeight <= 0) {
          setProgress(0);
          return;
        }

        let calculatedProgress = (scrollY / maxScrollableHeight) * 100;

        if (Number.isNaN(calculatedProgress)) {
          setProgress(0);
          return;
        }

        // Clamp between 0 and 100
        calculatedProgress = Math.max(0, Math.min(100, calculatedProgress));

        setProgress(calculatedProgress);
      });
    };

    // Calculate once on mount
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, []);

  return progress;
}
