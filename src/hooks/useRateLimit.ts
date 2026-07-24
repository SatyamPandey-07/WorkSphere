"use client";

import { useState, useEffect } from "react";

export function useRateLimit(endpointKey: "chat" | "book") {
  const [retryAfter, setRetryAfter] = useState<number>(0);

  useEffect(() => {
    const handleRateLimit = (e: Event) => {
      const customEvent = e as CustomEvent<{
        retryAfter: number;
        endpoint: string;
      }>;
      if (customEvent.detail && customEvent.detail.endpoint === endpointKey) {
        setRetryAfter(customEvent.detail.retryAfter);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("rate-limit-triggered", handleRateLimit);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("rate-limit-triggered", handleRateLimit);
      }
    };
  }, [endpointKey]);

  useEffect(() => {
    if (retryAfter <= 0) return;

    const timer = setInterval(() => {
      setRetryAfter((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [retryAfter]);

  return retryAfter;
}
