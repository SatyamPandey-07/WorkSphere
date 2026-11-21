import React, { useEffect, useState, useCallback } from "react";

export const RADAR_RANGES = [500, 1000, 2000, 5000] as const;
export type RadarRange = (typeof RADAR_RANGES)[number];

export function formatRadarRange(meters: RadarRange): string {
  return meters >= 1000 ? `${meters / 1000}km` : `${meters}m`;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  const editableAttr = target.getAttribute("contenteditable");
  return (
    target.isContentEditable || editableAttr === "true" || editableAttr === ""
  );
}

export interface RadarSweepHUDProps {
  isOpen?: boolean;
  initialRange?: RadarRange;
  initialTrackingEnabled?: boolean;
  initialHudOverlayVisible?: boolean;
  onRangeChange?: (range: RadarRange) => void;
  onToggleTracking?: (enabled: boolean) => void;
  onToggleHudOverlay?: (visible: boolean) => void;
  onClose?: () => void;
}

export const RadarSweepHUD: React.FC<RadarSweepHUDProps> = ({
  isOpen = true,
  initialRange = 1000,
  initialTrackingEnabled = true,
  initialHudOverlayVisible = true,
  onRangeChange,
  onToggleTracking,
  onToggleHudOverlay,
  onClose,
}) => {
  const [range, setRange] = useState<RadarRange>(initialRange);
  const [trackingEnabled, setTrackingEnabled] = useState<boolean>(
    initialTrackingEnabled,
  );
  const [hudOverlayVisible, setHudOverlayVisible] = useState<boolean>(
    initialHudOverlayVisible,
  );

  const cycleRange = useCallback(() => {
    setRange((prev) => {
      const currentIndex = RADAR_RANGES.indexOf(prev);
      const nextRange = RADAR_RANGES[(currentIndex + 1) % RADAR_RANGES.length];
      onRangeChange?.(nextRange);
      return nextRange;
    });
  }, [onRangeChange]);

  const toggleTracking = useCallback(() => {
    setTrackingEnabled((prev) => {
      const next = !prev;
      onToggleTracking?.(next);
      return next;
    });
  }, [onToggleTracking]);

  const toggleHudOverlay = useCallback(() => {
    setHudOverlayVisible((prev) => {
      const next = !prev;
      onToggleHudOverlay?.(next);
      return next;
    });
  }, [onToggleHudOverlay]);

  const handleCloseOrCollapse = useCallback(() => {
    setHudOverlayVisible(false);
    onToggleHudOverlay?.(false);
    onClose?.();
  }, [onClose, onToggleHudOverlay]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      switch (event.key) {
        case "r":
        case "R":
          event.preventDefault();
          cycleRange();
          break;
        case "t":
        case "T":
          event.preventDefault();
          toggleTracking();
          break;
        case "h":
        case "H":
          event.preventDefault();
          toggleHudOverlay();
          break;
        case "Escape":
          event.preventDefault();
          handleCloseOrCollapse();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    cycleRange,
    toggleTracking,
    toggleHudOverlay,
    handleCloseOrCollapse,
  ]);

  if (!isOpen) return null;

  return (
    <section
      aria-label="Radar Sweep HUD"
      data-testid="radar-sweep-hud"
      data-range={range}
      data-tracking={trackingEnabled ? "on" : "off"}
      data-hud-overlay={hudOverlayVisible ? "visible" : "hidden"}
    >
      <div role="toolbar" aria-label="Radar controls">
        <div className="relative group inline-block">
          <button
            type="button"
            onClick={cycleRange}
            aria-label={`Cycle radar range (current: ${formatRadarRange(range)})`}
            aria-keyshortcuts="R"
          >
            Range: {formatRadarRange(range)}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Cycle radar range</span>
            <kbd>R</kbd>
          </span>
        </div>

        <div className="relative group inline-block">
          <button
            type="button"
            onClick={toggleTracking}
            aria-pressed={trackingEnabled}
            aria-label="Toggle colleague tracking"
            aria-keyshortcuts="T"
          >
            Tracking: {trackingEnabled ? "On" : "Off"}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Toggle colleague tracking</span>
            <kbd>T</kbd>
          </span>
        </div>

        <div className="relative group inline-block">
          <button
            type="button"
            onClick={toggleHudOverlay}
            aria-pressed={hudOverlayVisible}
            aria-label="Toggle HUD grid and telemetry"
            aria-keyshortcuts="H"
          >
            HUD Overlay: {hudOverlayVisible ? "Shown" : "Hidden"}
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Toggle HUD grid &amp; telemetry</span>
            <kbd>H</kbd>
          </span>
        </div>

        <div className="relative group inline-block">
          <button
            type="button"
            onClick={handleCloseOrCollapse}
            aria-label="Close or collapse radar HUD"
            aria-keyshortcuts="Escape"
          >
            Close / Collapse
          </button>
          <span
            role="tooltip"
            className="pointer-events-none hidden group-hover:flex group-focus-within:flex items-center gap-1.5"
          >
            <span>Close radar or collapse HUD</span>
            <kbd>Esc</kbd>
          </span>
        </div>
      </div>

      {hudOverlayVisible && (
        <div data-testid="radar-hud-overlay">
          Grid &amp; Telemetry Active — Range {formatRadarRange(range)}
        </div>
      )}
    </section>
  );
};
