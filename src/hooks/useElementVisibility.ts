"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export function useElementVisibility<T extends HTMLElement = HTMLDivElement>(
  externalRef?: RefObject<T | null>,
): {
  ref: RefObject<T | null>;
  isVisible: boolean;
  isDocumentVisible: boolean;
  isInViewport: boolean;
} {
  const internalRef = useRef<T | null>(null);
  const targetRef = externalRef ?? internalRef;

  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() =>
    typeof document !== "undefined" ? !document.hidden : true,
  );
  const [isInViewport, setIsInViewport] = useState<boolean>(true);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      setIsDocumentVisible(!document.hidden);
    };

    handleVisibilityChange();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const element = targetRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) {
          setIsInViewport(entry.isIntersecting);
        }
      },
      { threshold: 0.05 },
    );

    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [targetRef]);

  return {
    ref: targetRef,
    isVisible: isDocumentVisible && isInViewport,
    isDocumentVisible,
    isInViewport,
  };
}
