"use client";

import React, { useEffect, useId, useState } from "react";
import { LayoutGrid, List, Map as MapIcon } from "lucide-react";

export type VenueLayoutMode = "grid" | "compact" | "map";

interface LayoutOption {
  id: VenueLayoutMode;
  label: string;
  shortcut: "G" | "C" | "M";
  icon: React.ReactNode;
}

interface AccessibleTooltipButtonProps {
  label: string;
  shortcut: string;
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const AccessibleTooltipButton: React.FC<AccessibleTooltipButtonProps> = ({
  label,
  shortcut,
  isActive,
  onClick,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-label={`${label} (${shortcut})`}
        aria-pressed={isActive}
        aria-describedby={isOpen ? tooltipId : undefined}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        onClick={onClick}
        className={`inline-flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
          isActive
            ? "bg-indigo-600 text-white shadow-sm"
            : "text-slate-300 hover:bg-slate-800 hover:text-white"
        }`}
      >
        {children}
      </button>

      <div
        id={tooltipId}
        role="tooltip"
        aria-hidden={!isOpen}
        className={`pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-1 text-xs font-medium text-slate-100 shadow-lg backdrop-blur-sm transition-all duration-150 ease-out ${
          isOpen
            ? "visible translate-y-0 scale-100 opacity-100"
            : "invisible translate-y-1 scale-95 opacity-0"
        }`}
      >
        <span>{label}</span>
        <kbd className="ml-1.5 rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-cyan-300">
          {shortcut}
        </kbd>
      </div>
    </div>
  );
};

interface VenueGridProps {
  children?: React.ReactNode;
  defaultLayout?: VenueLayoutMode;
  onLayoutChange?: (layout: VenueLayoutMode) => void;
}

export const VenueGrid: React.FC<VenueGridProps> = ({
  children,
  defaultLayout = "grid",
  onLayoutChange,
}) => {
  const [layout, setLayout] = useState<VenueLayoutMode>(defaultLayout);

  const handleSelectLayout = (next: VenueLayoutMode) => {
    setLayout(next);
    onLayoutChange?.(next);
  };

  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key.toUpperCase();
      if (key === "G") handleSelectLayout("grid");
      if (key === "C") handleSelectLayout("compact");
      if (key === "M") handleSelectLayout("map");
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const options: LayoutOption[] = [
    {
      id: "grid",
      label: "Grid View",
      shortcut: "G",
      icon: <LayoutGrid className="h-4 w-4" />,
    },
    {
      id: "compact",
      label: "Compact View",
      shortcut: "C",
      icon: <List className="h-4 w-4" />,
    },
    {
      id: "map",
      label: "Map View",
      shortcut: "M",
      icon: <MapIcon className="h-4 w-4" />,
    },
  ];

  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-end">
        <div
          role="group"
          aria-label="Venue layout view"
          className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1"
        >
          {options.map((opt) => (
            <AccessibleTooltipButton
              key={opt.id}
              label={opt.label}
              shortcut={opt.shortcut}
              isActive={layout === opt.id}
              onClick={() => handleSelectLayout(opt.id)}
            >
              {opt.icon}
            </AccessibleTooltipButton>
          ))}
        </div>
      </div>

      <div
        className={
          layout === "grid"
            ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : layout === "compact"
              ? "flex flex-col gap-2"
              : "relative min-h-[420px] rounded-xl border border-slate-800"
        }
      >
        {children}
      </div>
    </div>
  );
};

export default VenueGrid;
