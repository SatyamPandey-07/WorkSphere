"use client";

import { useState, useEffect, RefObject } from "react";

export interface UseScrollProgressOptions {
  /** Optional container element ref to track scroll within (defaults to window/document) */
  targetRef?: RefObject<HTMLElement | null>;
  /** Optional offset margins { top?: number, bottom?: number } */
  offsetMargin?: {
    top?: number;
    bottom?: number;
  };
  /** Optional threshold offset in pixels before progress begins */
  threshold?: number;
  /** Optional rootMargin offset (top/bottom) */
  rootMargin?: number;
}

/**
 * useScrollProgress:
 * Tracks scroll progress as a percentage (0 to 100) and normalized float (0.0 to 1.0)
 * either across the full window or within a specific scrollable target element container.
 */
export function useScrollProgress(options?: UseScrollProgressOptions | RefObject<HTMLElement | null>) {
  const [progress, setProgress] = useState(0);

  // Normalize options if passed directly as ref
  const normalizedOptions: UseScrollProgressOptions =
    options && "current" in options
      ? { targetRef: options }
      : (options ?? {});

  const { targetRef, offsetMargin, threshold = 0, rootMargin = 0 } = normalizedOptions;

  useEffect(() => {
    let frameId: number;

    const handleScroll = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }

      frameId = requestAnimationFrame(() => {
        let calculatedProgress = 0;

        if (targetRef && targetRef.current) {
          const el = targetRef.current;
          const scrollTop = el.scrollTop;
          const marginTop = (offsetMargin?.top ?? 0) + rootMargin + threshold;
          const marginBottom = (offsetMargin?.bottom ?? 0) + rootMargin;

          const effectiveScroll = Math.max(0, scrollTop - marginTop);
          const maxScrollableHeight = el.scrollHeight - el.clientHeight - marginBottom;

          if (maxScrollableHeight <= 0) {
            setProgress(0);
            return;
          }

          calculatedProgress = (effectiveScroll / maxScrollableHeight) * 100;
        } else {
          const scrollY = typeof window !== "undefined" ? window.scrollY : 0;
          const marginTop = (offsetMargin?.top ?? 0) + rootMargin + threshold;
          const marginBottom = (offsetMargin?.bottom ?? 0) + rootMargin;

          const docHeight =
            typeof document !== "undefined" ? document.documentElement.scrollHeight : 0;
          const winHeight = typeof window !== "undefined" ? window.innerHeight : 0;
          const maxScrollableHeight = docHeight - winHeight - marginBottom;

          const effectiveScroll = Math.max(0, scrollY - marginTop);

          if (maxScrollableHeight <= 0) {
            setProgress(0);
            return;
          }

          calculatedProgress = (effectiveScroll / maxScrollableHeight) * 100;
        }

        if (Number.isNaN(calculatedProgress)) {
          setProgress(0);
          return;
        }

        // Clamp between 0 and 100
        calculatedProgress = Math.max(0, Math.min(100, calculatedProgress));
        setProgress(calculatedProgress);
      });
    };

    // Calculate once on mount and target change
    handleScroll();

    const targetElement = targetRef?.current;
    if (targetElement) {
      targetElement.addEventListener("scroll", handleScroll, { passive: true });
      window.addEventListener("resize", handleScroll);
    } else if (typeof window !== "undefined") {
      window.addEventListener("scroll", handleScroll, { passive: true });
      window.addEventListener("resize", handleScroll);
    }

    // Observer for dynamic content size changes in target element
    let resizeObserver: ResizeObserver | null = null;
    if (targetElement && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(handleScroll);
      resizeObserver.observe(targetElement);
    }

    return () => {
      if (targetElement) {
        targetElement.removeEventListener("scroll", handleScroll);
        window.removeEventListener("resize", handleScroll);
      } else if (typeof window !== "undefined") {
        window.removeEventListener("scroll", handleScroll);
        window.removeEventListener("resize", handleScroll);
      }

      if (resizeObserver) {
        resizeObserver.disconnect();
      }

      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [targetRef, offsetMargin?.top, offsetMargin?.bottom, threshold, rootMargin]);

  return progress;
}

export default useScrollProgress;
