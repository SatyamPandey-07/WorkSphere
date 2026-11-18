"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { VolumeX, Wifi, Layers, MapPin, Contrast, Search } from "lucide-react";

export function detectPlatformShortcut(
  userAgent?: string,
  platform?: string,
): "⌘K" | "Ctrl+K" {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const plat = platform ?? nav?.platform ?? "";
  const ua = userAgent ?? nav?.userAgent ?? "";
  if (/Mac|iPhone|iPad|iPod/i.test(plat) || /Mac|iPhone|iPad|iPod/i.test(ua)) {
    return "⌘K";
  }
  return "Ctrl+K";
}

export function isTouchOnlyDevice(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const fine = window.matchMedia("(pointer: fine)").matches;
  return coarse && !fine;
}

export interface CommandPaletteTriggerProps {
  onClick?: () => void;
  className?: string;
}

export function CommandPaletteTrigger({
  onClick,
  className,
}: CommandPaletteTriggerProps) {
  const [shortcut, setShortcut] = useState<"⌘K" | "Ctrl+K">("Ctrl+K");
  const [touchOnly, setTouchOnly] = useState(false);

  useEffect(() => {
    setShortcut(detectPlatformShortcut());
    setTouchOnly(isTouchOnlyDevice());
  }, []);

  return (
    <button
      type="button"
      data-testid="command-palette-trigger"
      onClick={onClick}
      aria-label="Open command palette"
      className={
        className ??
        "inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-700 hover:text-zinc-200 transition-colors"
      }
    >
      <Search className="h-3.5 w-3.5" />
      <span>Search commands...</span>
      {!touchOnly && (
        <kbd
          data-testid="command-palette-shortcut-badge"
          className="ml-1 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
        >
          {shortcut}
        </kbd>
      )}
    </button>
  );
}

interface CommandActionItem {
  id: string;
  actionType: string;
  label: string;
  icon: React.ReactNode;
}

const COMMAND_ITEMS: CommandActionItem[] = [
  {
    id: "command-option-quiet-desk",
    actionType: "FIND_NEAREST_QUIET_DESK",
    label: "Find nearest quiet desk",
    icon: <VolumeX className="mr-2 h-4 w-4 text-emerald-400" />,
  },
  {
    id: "command-option-high-speed-wifi",
    actionType: "FILTER_HIGH_SPEED_WIFI",
    label: "Filter by 100+ Mbps WiFi",
    icon: <Wifi className="mr-2 h-4 w-4 text-blue-400" />,
  },
  {
    id: "command-option-3d-heatmap",
    actionType: "TOGGLE_3D_HEATMAP",
    label: "Toggle 3D Heatmap view",
    icon: <Layers className="mr-2 h-4 w-4 text-purple-400" />,
  },
  {
    id: "command-option-reset-city-center",
    actionType: "RESET_CITY_CENTER",
    label: "Reset map zoom to city center",
    icon: <MapPin className="mr-2 h-4 w-4 text-amber-400" />,
  },
  {
    id: "command-option-high-contrast-basemap",
    actionType: "TOGGLE_HIGH_CONTRAST_BASEMAP",
    label: "Switch to high contrast basemap",
    icon: <Contrast className="mr-2 h-4 w-4 text-zinc-300" />,
  },
];

function sanitizeSearchQuery(raw: string): string {
  return raw.replace(/[<>"'`\x00-\x1F\x7F]/g, "").slice(0, 200);
}

export interface CommandPaletteProps {
  reducedMotion?: boolean;
}

export function CommandPalette({ reducedMotion }: CommandPaletteProps = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    Boolean(reducedMotion),
  );

  const previousFocusRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (typeof reducedMotion === "boolean") {
      setPrefersReducedMotion(reducedMotion);
      return;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      setPrefersReducedMotion(
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      );
    }
  }, [reducedMotion]);

  // Capture previously focused element when opening, and restore focus on close
  useEffect(() => {
    if (!open) return;

    if (
      typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }

    const focusTimer = setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => {
      clearTimeout(focusTimer);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const filteredItems = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return COMMAND_ITEMS;
    return COMMAND_ITEMS.filter((item) =>
      item.label.toLowerCase().includes(trimmed),
    );
  }, [query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const dispatchMapAction = useCallback(
    (actionType: string, payload?: unknown) => {
      window.dispatchEvent(
        new CustomEvent("worksphere:map-action", {
          detail: { action: actionType, payload },
        }),
      );
      setOpen(false);
    },
    [],
  );

  const activeItem = filteredItems[activeIndex];

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex((prev) => (prev + 1) % filteredItems.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (filteredItems.length > 0) {
        setActiveIndex(
          (prev) => (prev - 1 + filteredItems.length) % filteredItems.length,
        );
      }
    } else if (e.key === "Enter" && activeItem) {
      e.preventDefault();
      dispatchMapAction(activeItem.actionType);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  const isMotionReduced = Boolean(reducedMotion) || prefersReducedMotion;

  return (
    <>
      <CommandPaletteTrigger onClick={() => setOpen(true)} />
      <CommandDialog open={open} onOpenChange={setOpen}>
        <div data-testid="command-palette-modal-wrapper" className="relative">
          <div
            data-testid="cockpit-targeting-reticles"
            data-reduced-motion={isMotionReduced ? "true" : "false"}
            aria-hidden="true"
            className="pointer-events-none"
          >
            <span
              data-testid="corner-reticle-tl"
              className={
                isMotionReduced
                  ? "absolute top-1 left-1 text-emerald-400 transform-none"
                  : "absolute top-1 left-1 text-emerald-400 animate-reticle-snap-tl"
              }
            />
            <span
              data-testid="corner-reticle-tr"
              className={
                isMotionReduced
                  ? "absolute top-1 right-1 text-emerald-400 transform-none"
                  : "absolute top-1 right-1 text-emerald-400 animate-reticle-snap-tr"
              }
            />
            <span
              data-testid="corner-reticle-bl"
              className={
                isMotionReduced
                  ? "absolute bottom-1 left-1 text-emerald-400 transform-none"
                  : "absolute bottom-1 left-1 text-emerald-400 animate-reticle-snap-bl"
              }
            />
            <span
              data-testid="corner-reticle-br"
              className={
                isMotionReduced
                  ? "absolute bottom-1 right-1 text-emerald-400 transform-none"
                  : "absolute bottom-1 right-1 text-emerald-400 animate-reticle-snap-br"
              }
            />
          </div>

          <CommandInput
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(sanitizeSearchQuery(e.target.value))}
            onKeyDown={handleInputKeyDown}
            aria-expanded={open}
            aria-controls="command-palette-listbox"
            aria-activedescendant={activeItem?.id}
            aria-label="Search workspace commands"
            placeholder="Type a command or search workspace..."
          />
          <CommandList id="command-palette-listbox">
            {filteredItems.length === 0 ? (
              <CommandEmpty>No results found.</CommandEmpty>
            ) : (
              <CommandGroup heading="Workspace Map Controls">
                {filteredItems.map((item, idx) => (
                  <CommandItem
                    key={item.id}
                    id={item.id}
                    active={idx === activeIndex}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onSelect={() => dispatchMapAction(item.actionType)}
                    className="cursor-pointer"
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </div>
      </CommandDialog>
    </>
  );
}

export default CommandPalette;
