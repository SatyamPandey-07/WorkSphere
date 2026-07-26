"use client";

import { useState, useEffect, useCallback } from "react";

/**
 * ScrollToTopButton
 *
 * A floating action button that appears once the user scrolls more than 300px
 * down the page. Clicking it smoothly scrolls the window back to the top.
 *
 * Accessibility:
 *  - aria-label="Scroll to top of page"
 *  - Fully keyboard-navigable (focus-visible ring)
 *  - Respects prefers-reduced-motion via CSS (globals.css already handles this)
 */
export function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(false);

  const handleScroll = useCallback(() => {
    setIsVisible(window.scrollY > 300);
  }, []);

  useEffect(() => {
    // Evaluate once on mount in case the page loads mid-scroll
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <button
      id="scroll-to-top-btn"
      onClick={scrollToTop}
      aria-label="Scroll to top of page"
      className={[
        // Layout & shape
        "fixed bottom-6 right-6 z-50",
        "h-12 w-12 rounded-full",
        // Flex centering
        "flex items-center justify-center",
        // Colours – uses the project-wide accent system
        "accent-bg text-white",
        // Shadow / glow
        "shadow-lg accent-shadow-lg",
        // Hover & active states
        "hover:opacity-90 active:scale-95",
        // Transitions – enter/exit + micro-interaction
        "transition-all duration-300 ease-in-out",
        // Show / hide via opacity + scale (GPU-composited, no layout shift)
        isVisible
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-75 pointer-events-none",
        // Focus ring (project standard)
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
      ].join(" ")}
    >
      {/* Up-arrow SVG icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden="true"
      >
        <path d="M18 15l-6-6-6 6" />
      </svg>
    </button>
  );
}
