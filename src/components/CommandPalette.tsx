"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Bookmark,
  FolderHeart,
  GitCompare,
  CalendarCheck,
  Users,
  Settings,
  Contrast,
} from "lucide-react";
import {
  openCommandPalette,
  OPEN_COMMAND_PALETTE_EVENT,
} from "@/hooks/usePlatformModifier";
import { CockpitTargetingReticles } from "@/components/ui/QuickSearchTrigger";

interface CommandItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
}

const COMMANDS: CommandItem[] = [
  {
    label: "Saved",
    href: "/saved",
    icon: Bookmark,
    keywords: "favorites bookmarks",
  },
  {
    label: "Collections",
    href: "/collections",
    icon: FolderHeart,
    keywords: "folders",
  },
  {
    label: "Compare",
    href: "/compare",
    icon: GitCompare,
    keywords: "comparison venues",
  },
  {
    label: "Reserve",
    href: "/reserve",
    icon: CalendarCheck,
    keywords: "book booking",
  },
  {
    label: "Sessions",
    href: "/sessions",
    icon: Users,
    keywords: "coworking buddy",
  },
  {
    label: "Accessibility & High Contrast",
    href: "/settings",
    icon: Contrast,
    keywords: "high contrast accessibility wcag theme visual",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    keywords: "account preferences",
  },
];

/**
 * Pure function detecting OS platform to determine the keyboard shortcut badge text.
 * Displays "⌘K" on macOS/iOS and "Ctrl+K" on Windows/Linux/other platforms.
 */
export function detectPlatformShortcut(
  userAgent?: string,
  platform?: string,
): "⌘K" | "Ctrl+K" {
  if (typeof window === "undefined" && !userAgent && !platform) {
    return "Ctrl+K";
  }
  const ua =
    userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const plat =
    platform ??
    (typeof navigator !== "undefined"
      ? (navigator as any).userAgentData?.platform || navigator.platform
      : "");
  const isMac =
    /(Mac|iPhone|iPod|iPad)/i.test(plat) || /(Mac|iPhone|iPod|iPad)/i.test(ua);
  return isMac ? "⌘K" : "Ctrl+K";
}

/**
 * Detects whether the current device is a touch-only mobile device without a fine pointer.
 */
export function isTouchOnlyDevice(): boolean {
  if (typeof window === "undefined") return false;
  const matchMedia =
    typeof window.matchMedia === "function"
      ? window.matchMedia.bind(window)
      : null;
  if (!matchMedia) return false;
  const hasCoarse = matchMedia("(pointer: coarse)")?.matches ?? false;
  const hasFine = matchMedia("(pointer: fine)")?.matches ?? false;
  if (hasCoarse && !hasFine) return true;
  const hasTouch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && (navigator.maxTouchPoints ?? 0) > 0);
  return hasTouch && !hasFine;
}

export interface CommandPaletteTriggerProps {
  onClick?: () => void;
  className?: string;
  placeholder?: string;
}

/**
 * Command palette search input trigger button.
 * Displays a subtle keyboard shortcut badge (⌘K on macOS, Ctrl+K on Windows/Linux),
 * hidden on touch-only mobile devices.
 */
export function CommandPaletteTrigger({
  onClick,
  className = "",
  placeholder = "Search or jump to…",
}: CommandPaletteTriggerProps) {
  const [shortcutKey, setShortcutKey] = useState<"⌘K" | "Ctrl+K">("Ctrl+K");
  const [isTouchOnly, setIsTouchOnly] = useState<boolean>(false);

  useEffect(() => {
    setShortcutKey(detectPlatformShortcut());
    setIsTouchOnly(isTouchOnlyDevice());
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (onClick) {
      onClick();
    } else {
      openCommandPalette();
    }
  };

  return (
    <button
      type="button"
      data-testid="command-palette-trigger"
      onClick={handleClick}
      aria-label="Open command palette"
      aria-keyshortcuts="Control+K Meta+K"
      className={`group flex items-center justify-between gap-3 px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100/80 dark:bg-zinc-800/80 hover:bg-zinc-200/80 dark:hover:bg-zinc-700/80 border border-zinc-200 dark:border-zinc-700 rounded-xl transition-all shadow-xs cursor-pointer ${className}`}
    >
      <div className="flex items-center gap-2">
        <Search className="w-3.5 h-3.5 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors shrink-0" />
        <span className="font-medium text-zinc-600 dark:text-zinc-300">
          {placeholder}
        </span>
      </div>
      {!isTouchOnly && (
        <kbd
          data-testid="command-palette-shortcut-badge"
          className="hidden sm:inline-flex items-center font-mono text-[10px] font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-1.5 py-0.5 rounded shadow-xs select-none"
        >
          {shortcutKey}
        </kbd>
      )}
    </button>
  );
}

export interface CommandPaletteProps {
  showTrigger?: boolean;
  triggerClassName?: string;
  reducedMotion?: boolean;
}

export function CommandPalette({
  showTrigger = true,
  triggerClassName = "",
  reducedMotion,
}: CommandPaletteProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords?.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
    };

    const handleOpenEvent = () => {
      setIsOpen(true);
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, handleOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const handleSelect = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % Math.max(filtered.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex(
        (prev) => (prev - 1 + filtered.length) % Math.max(filtered.length, 1),
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[activeIndex];
      if (item) handleSelect(item.href);
    }
  };

  return (
    <>
      {showTrigger && !isOpen && (
        <CommandPaletteTrigger
          onClick={() => setIsOpen(true)}
          className={triggerClassName}
        />
      )}
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24 bg-black/50 backdrop-blur-sm">
          <div
            data-testid="command-palette-modal-wrapper"
            className="relative w-full max-w-lg mx-4"
          >
            {/* Cockpit corner targeting reticles */}
            <CockpitTargetingReticles reducedMotion={reducedMotion} />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Command palette"
              data-reduced-motion={reducedMotion ? "true" : undefined}
              className="relative w-full bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden animate-in fade-in zoom-in duration-150"
              onKeyDown={handleKeyDown}
            >
              <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
                <Search className="w-4 h-4 text-zinc-400 shrink-0" />
                <input
                  autoFocus
                  value={query}
                  aria-keyshortcuts="Control+K Meta+K"
                  onChange={(e) => {
                    // Strip control characters (<, >, HTML/script injection chars,
                    // and non-printable chars) before storing the query.
                    const sanitized = e.target.value
                      .replace(/[<>"'`\x00-\x1F\x7F]/g, "")
                      .slice(0, 200);
                    setQuery(sanitized);
                  }}
                  placeholder="Jump to a page…"
                  className="w-full bg-transparent outline-none text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400"
                />
                <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-zinc-400 shrink-0">
                  Esc
                </kbd>
              </div>

              <ul className="max-h-80 overflow-y-auto py-2">
                {filtered.length === 0 && (
                  <li className="px-4 py-6 text-sm text-center text-zinc-400">
                    No matching pages
                  </li>
                )}
                {filtered.map((item, index) => {
                  const Icon = item.icon;
                  const active = index === activeIndex;
                  return (
                    <li key={`${item.href}-${item.label}`}>
                      <button
                        type="button"
                        onClick={() => handleSelect(item.href)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors ${
                          active
                            ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
                            : "text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
