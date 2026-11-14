"use client";

import React, { createContext, useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  "aria-label"?: string;
}

export function CommandDialog({
  open,
  onOpenChange,
  children,
  "aria-label": ariaLabel = "Command palette",
}: CommandDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (el) =>
            !el.hasAttribute("disabled") &&
            el.getAttribute("aria-hidden") !== "true",
        );

        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;

        if (e.shiftKey) {
          if (
            !active ||
            active === first ||
            !dialogRef.current.contains(active)
          ) {
            e.preventDefault();
            last.focus();
          }
        } else if (
          !active ||
          active === last ||
          !dialogRef.current.contains(active)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      data-testid="command-palette-backdrop"
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="relative w-full max-w-lg mx-4 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export type CommandInputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const CommandInput = React.forwardRef<
  HTMLInputElement,
  CommandInputProps
>(({ className, ...props }, ref) => {
  return (
    <div className="flex items-center px-3 border-b border-zinc-800">
      <Search className="w-4 h-4 mr-2 text-zinc-400 shrink-0" />
      <input
        ref={ref}
        role="combobox"
        aria-expanded={false}
        aria-controls="command-palette-listbox"
        aria-autocomplete="list"
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-zinc-500 text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
});
CommandInput.displayName = "CommandInput";

interface CommandListProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function CommandList({
  children,
  className,
  ...props
}: CommandListProps) {
  return (
    <div
      role="listbox"
      className={cn(
        "max-h-[300px] overflow-y-auto overflow-x-hidden p-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="py-6 text-center text-sm text-zinc-400">
      {children}
    </div>
  );
}

export function CommandGroup({
  heading,
  children,
}: {
  heading?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={heading}
      className="overflow-hidden p-1 text-zinc-100"
    >
      {heading && (
        <div className="px-2 py-1.5 text-xs font-medium text-zinc-400">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

const ActiveItemContext = createContext<boolean>(false);

export interface CommandItemProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onSelect"
> {
  children: React.ReactNode;
  className?: string;
  onSelect?: () => void;
  active?: boolean;
}

export function CommandItem({
  children,
  className,
  onSelect,
  active = false,
  id,
  ...props
}: CommandItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (
      active &&
      itemRef.current &&
      typeof itemRef.current.scrollIntoView === "function"
    ) {
      itemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [active]);

  return (
    <ActiveItemContext.Provider value={active}>
      <div
        ref={itemRef}
        id={id}
        role="option"
        aria-selected={active}
        data-active={active ? "true" : "false"}
        onClick={onSelect}
        className={cn(
          "relative flex cursor-pointer select-none items-center rounded-lg px-2.5 py-2 text-sm text-zinc-200 outline-none hover:bg-zinc-800 hover:text-white transition-colors duration-100",
          active && "bg-zinc-800 text-white",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </ActiveItemContext.Provider>
  );
}
