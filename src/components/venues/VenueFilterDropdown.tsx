"use client";

import React, { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FilterOption {
  id?: string;
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
  description?: string;
}

export interface VenueFilterDropdownProps {
  /** Optional unique HTML ID; auto-generates if omitted */
  id?: string;
  /** Label displayed on the dropdown trigger */
  label: string;
  /** Available filter options list */
  options: FilterOption[];
  /** Controlled array of selected option values (for multi-select or single select) */
  selectedValues?: string[];
  /** Controlled single selected value */
  selectedValue?: string;
  /** Callback fired when an option is selected */
  onSelect?: (value: string) => void;
  /** Callback fired when an option is toggled */
  onToggleOption?: (value: string) => void;
  /** Whether multiple items can be simultaneously active */
  multiSelect?: boolean;
  /** Optional icon prefix displayed before trigger label */
  icon?: React.ComponentType<{ className?: string }>;
  /** Additional classes applied to root container */
  className?: string;
  /** Whether the dropdown trigger is disabled */
  disabled?: boolean;
  /** Controlled open state */
  isOpen?: boolean;
  /** Callback fired when open state changes */
  onOpenChange?: (open: boolean) => void;
  "data-testid"?: string;
}

export function VenueFilterDropdown({
  id: propId,
  label,
  options = [],
  selectedValues,
  selectedValue,
  onSelect,
  onToggleOption,
  multiSelect = false,
  icon: Icon,
  className,
  disabled = false,
  isOpen: controlledIsOpen,
  onOpenChange,
  "data-testid": testId = "venue-filter-dropdown",
}: VenueFilterDropdownProps) {
  const generatedId = useId();
  const baseId = propId || `venue-filter-${generatedId.replace(/:/g, "")}`;
  const triggerId = `${baseId}-trigger`;
  const menuId = `${baseId}-menu`;

  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : uncontrolledIsOpen;

  const setOpen = (nextOpen: boolean) => {
    if (controlledIsOpen === undefined) {
      setUncontrolledIsOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Calculate active selections
  const effectiveSelections = selectedValues
    ? selectedValues
    : selectedValue !== undefined
      ? [selectedValue]
      : [];

  const activeCount = effectiveSelections.length;

  // Handle outside click to close dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [isOpen]);

  // Handle option selection
  const handleSelectOption = (value: string) => {
    if (onSelect) {
      onSelect(value);
    }
    if (onToggleOption) {
      onToggleOption(value);
    }
    if (!multiSelect) {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Keyboard navigation on trigger button
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setOpen(true);
        // Defer focusing the first item until dropdown renders
        setTimeout(() => {
          itemRefs.current[0]?.focus();
        }, 10);
      } else {
        itemRefs.current[0]?.focus();
      }
    } else if (e.key === "Escape" && isOpen) {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Keyboard navigation inside dropdown menu panel
  const handleMenuKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = (index + 1) % options.length;
      itemRefs.current[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) {
        triggerRef.current?.focus();
      } else {
        const prevIndex = (index - 1 + options.length) % options.length;
        itemRefs.current[prevIndex]?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      itemRefs.current[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      itemRefs.current[options.length - 1]?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block text-left", className)}
      data-testid={testId}
    >
      {/* Dropdown Trigger Button */}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        className={cn(
          "inline-flex items-center justify-between gap-2 px-3.5 py-2 text-sm font-medium rounded-xl border transition-all duration-200 select-none",
          "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 focus:ring-offset-background",
          isOpen
            ? "border-emerald-500/80 bg-emerald-50/50 dark:bg-emerald-950/20 text-foreground ring-1 ring-emerald-500/30 shadow-sm"
            : activeCount > 0
              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-semibold"
              : "border-border/80 bg-background hover:bg-muted/60 text-muted-foreground hover:text-foreground shadow-xs",
          disabled && "opacity-50 cursor-not-allowed pointer-events-none",
        )}
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />}
          <span>{label}</span>
          {activeCount > 0 && (
            <span
              data-testid="filter-badge"
              className="ml-1 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none bg-emerald-600 text-white rounded-full min-w-4.5"
            >
              {activeCount}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200 text-muted-foreground",
            isOpen && "rotate-180 text-foreground",
          )}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown Menu Panel */}
      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className={cn(
            "absolute left-0 z-50 mt-1.5 min-w-56 w-max max-w-xs origin-top-left rounded-xl border border-border/80 bg-popover p-1.5 shadow-lg backdrop-blur-md",
            "animate-in fade-in-0 zoom-in-95 duration-150",
          )}
        >
          <div className="flex flex-col gap-0.5">
            {options.map((option, index) => {
              const isSelected = effectiveSelections.includes(option.value);
              const OptionIcon = option.icon;

              return (
                <button
                  key={option.id || option.value}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  role="menuitem"
                  type="button"
                  tabIndex={0}
                  onClick={() => handleSelectOption(option.value)}
                  onKeyDown={(e) => handleMenuKeyDown(e, index)}
                  className={cn(
                    "relative flex items-center justify-between w-full px-2.5 py-2 text-sm rounded-lg text-left transition-colors cursor-pointer select-none",
                    "focus:outline-none focus:bg-accent focus:text-accent-foreground",
                    isSelected
                      ? "bg-accent/60 font-medium text-accent-foreground"
                      : "text-foreground/90 hover:bg-muted/70",
                  )}
                >
                  <span className="flex items-center gap-2.5 pr-2">
                    {OptionIcon && (
                      <OptionIcon className="w-4 h-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="flex flex-col">
                      <span>{option.label}</span>
                      {option.description && (
                        <span className="text-xs text-muted-foreground font-normal">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className="flex items-center gap-2 shrink-0">
                    {option.count !== undefined && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {option.count}
                      </span>
                    )}
                    {isSelected && (
                      <Check
                        className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default VenueFilterDropdown;
