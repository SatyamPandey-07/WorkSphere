"use client";

import { useState, useEffect, useCallback, useRef } from "react";

/** Scroll depth (px) at which the button becomes visible. */
export const SCROLL_THRESHOLD_PX = 300;

/**
 * ScrollToTopButton
 *
 * A circular floating action button that appears once the user scrolls more
 * than {@link SCROLL_THRESHOLD_PX} (300 px) down the page. Clicking it
 * smoothly scrolls the window back to the top.
 *
 * When `variant="lantern"` is set the standard up-arrow is replaced with an
 * aerospace fighter-jet thruster SVG icon that fires a momentary emerald
 * afterburner glow + exhaust trail particle animation on click (issue #6171).
 *
 * Accessibility:
 *  - aria-label="Scroll to top of page"
 *  - Fully keyboard-navigable (focus-visible ring)
 *  - Respects prefers-reduced-motion via CSS (globals.css already handles this)
 */
export interface ScrollToTopButtonProps {
  threshold?: number;
  className?: string;
  ariaLabel?: string;
  /**
   * Visual variant.
   * - `"default"` — standard up-arrow chevron icon.
   * - `"lantern"` — aerospace jet thruster icon with an emerald afterburner
   *   exhaust trail that fires momentarily on click.
   */
  variant?: "default" | "lantern";
}

// ---------------------------------------------------------------------------
// Jet Thruster SVG — points downward so the nozzle faces the bottom
// (thrust pushes upward). Styled in emerald.
// ---------------------------------------------------------------------------
const JetThrusterIcon = ({
  firing,
  reduced,
}: {
  firing: boolean;
  reduced: boolean;
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    data-testid="jet-thruster-icon"
    className={[
      "h-5 w-5",
      !reduced && firing ? "scale-110 transition-transform duration-150" : "",
    ]
      .filter(Boolean)
      .join(" ")}
  >
    {/* Jet body — fuselage pointing up */}
    <path
      d="M12 2 L9 8 L9 14 L12 16 L15 14 L15 8 Z"
      fill="#10b981"
      stroke="#059669"
      strokeWidth="0.5"
    />
    {/* Left wing */}
    <path d="M9 10 L5 14 L9 13 Z" fill="#34d399" />
    {/* Right wing */}
    <path d="M15 10 L19 14 L15 13 Z" fill="#34d399" />
    {/* Cockpit canopy */}
    <ellipse cx="12" cy="6" rx="1.8" ry="2.5" fill="#6ee7b7" opacity="0.85" />
    {/* Nozzle — bottom center */}
    <rect x="10.5" y="14.5" width="3" height="2.5" rx="0.8" fill="#065f46" />
    {/* Afterburner exhaust flame — shown only while firing */}
    {firing && !reduced && (
      <>
        <ellipse
          cx="12"
          cy="19.5"
          rx="2"
          ry="3"
          fill="url(#flameGrad)"
          opacity="0.9"
          data-testid="afterburner-flame"
        />
        <ellipse
          cx="12"
          cy="21"
          rx="1"
          ry="1.5"
          fill="#d1fae5"
          opacity="0.5"
        />
      </>
    )}
    <defs>
      <radialGradient id="flameGrad" cx="50%" cy="30%" r="70%">
        <stop offset="0%" stopColor="#d1fae5" />
        <stop offset="45%" stopColor="#10b981" />
        <stop offset="100%" stopColor="#065f46" stopOpacity="0" />
      </radialGradient>
    </defs>
  </svg>
);

// ---------------------------------------------------------------------------
// Emerald exhaust-trail particles — rendered as absolutely-positioned dots
// that animate downward and fade out on click.
// ---------------------------------------------------------------------------
const ExhaustTrail = ({ active }: { active: boolean }) => {
  if (!active) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="exhaust-trail"
      className="pointer-events-none absolute inset-0 flex items-end justify-center overflow-visible"
    >
      {/* Three staggered particle dots */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute rounded-full bg-emerald-400"
          style={{
            width: 6 - i,
            height: 6 - i,
            bottom: -6 - i * 8,
            left: "50%",
            transform: "translateX(-50%)",
            opacity: 0.85 - i * 0.25,
            animation: `exhaustDrop 0.5s ease-out ${i * 60}ms forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes exhaustDrop {
          0%   { opacity: 1; transform: translateX(-50%) translateY(0); }
          100% { opacity: 0; transform: translateX(-50%) translateY(20px); }
        }
      `}</style>
    </span>
  );
};

export function ScrollToTopButton({
  threshold = SCROLL_THRESHOLD_PX,
  className = "",
  ariaLabel = "Scroll to top of page",
  variant = "default",
}: ScrollToTopButtonProps = {}) {
  const [isVisible, setIsVisible] = useState(false);
  const [firing, setFiring] = useState(false);
  const firingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Respect prefers-reduced-motion at the JS level so exhaust particles are
  // suppressed for users who have opted out of animations.
  // Guard against jsdom / SSR environments where matchMedia may be absent.
  const prefersReduced =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const handleScroll = useCallback(() => {
    setIsVisible(window.scrollY > threshold);
  }, [threshold]);

  useEffect(() => {
    // Evaluate once on mount in case the page loads mid-scroll
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, [handleScroll]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (firingTimerRef.current) clearTimeout(firingTimerRef.current);
    };
  }, []);

  const scrollToTop = () => {
    if (variant === "lantern" && !prefersReduced) {
      if (firingTimerRef.current) clearTimeout(firingTimerRef.current);
      // Trigger afterburner + exhaust trail for ~500 ms
      setFiring(true);
      firingTimerRef.current = setTimeout(() => setFiring(false), 500);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const isLantern = variant === "lantern";

  return (
    <button
      id="scroll-to-top-btn"
      data-testid="scroll-to-top-btn"
      data-variant={variant}
      onClick={scrollToTop}
      aria-label={ariaLabel}
      className={[
        // Layout & shape
        "fixed bottom-6 right-6 z-50",
        "h-12 w-12 min-h-[44px] min-w-[44px] rounded-full",
        // Flex centering
        "flex items-center justify-center",
        // Colours
        isLantern
          ? // Lantern/HUD variant: deep dark bg, emerald ring
            [
              "bg-zinc-900 border-2",
              firing
                ? "border-emerald-400 shadow-[0_0_18px_4px_rgba(16,185,129,0.55)]"
                : "border-emerald-600/70 shadow-[0_0_8px_1px_rgba(16,185,129,0.25)]",
            ].join(" ")
          : "accent-bg text-white shadow-lg accent-shadow-lg",
        // Hover & active states
        "hover:opacity-90 active:scale-95",
        // Transitions – enter/exit + micro-interaction
        "transition-all duration-300 ease-in-out",
        // relative so exhaust trail positions correctly
        "relative overflow-visible",
        // Show / hide via opacity + scale (GPU-composited, no layout shift)
        isVisible
          ? "opacity-100 scale-100 pointer-events-auto"
          : "opacity-0 scale-75 pointer-events-none",
        // Focus ring (project standard)
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {isLantern ? (
        <>
          <JetThrusterIcon firing={firing} reduced={prefersReduced} />
          <ExhaustTrail active={firing && !prefersReduced} />
        </>
      ) : (
        /* Up-arrow SVG icon */
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
      )}
    </button>
  );
}

export default ScrollToTopButton;
