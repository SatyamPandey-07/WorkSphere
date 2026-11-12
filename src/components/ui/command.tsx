"use client";

import React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function CommandDialog({
  open,
  onOpenChange,
  children,
}: CommandDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={() => onOpenChange(false)}
    >
      <div
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

export function CommandList({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-h-[300px] overflow-y-auto overflow-x-hidden p-2">
      {children}
    </div>
  );
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-6 text-center text-sm text-zinc-400">{children}</div>
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
    <div className="overflow-hidden p-1 text-zinc-100">
      {heading && (
        <div className="px-2 py-1.5 text-xs font-medium text-zinc-400">
          {heading}
        </div>
      )}
      {children}
    </div>
  );
}

export function CommandItem({
  children,
  className,
  onSelect,
}: {
  children: React.ReactNode;
  className?: string;
  onSelect?: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-lg px-2.5 py-2 text-sm text-zinc-200 outline-none hover:bg-zinc-800 hover:text-white transition-colors duration-100",
        className,
      )}
    >
      {children}
    </div>
  );
}
