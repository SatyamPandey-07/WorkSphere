"use client";

import { cn } from "@/lib/utils";

interface TagChipProps {
  name: string;
  color: string;
  onDelete?: () => void;
  onRename?: () => void;
  onClick?: () => void;
  active?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function TagChip({
  name,
  color,
  onDelete,
  onRename,
  onClick,
  active = false,
  size = "md",
  className,
}: TagChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium transition-all",
        size === "sm" && "px-2 py-0.5 text-xs",
        size === "md" && "px-3 py-1 text-sm",
        active
          ? "ring-2 ring-offset-1 dark:ring-offset-zinc-900"
          : "opacity-90 hover:opacity-100",
        onClick &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900",
        className,
      )}
      style={{
        backgroundColor: `${color}20`,
        color: color,
        ...(active ? { ringColor: color } : {}),
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      aria-pressed={onClick ? active : undefined}
      aria-label={`Tag: ${name}`}
    >
      <span
        className="shrink-0 rounded-full"
        style={{
          backgroundColor: color,
          width: size === "sm" ? 6 : 8,
          height: size === "sm" ? 6 : 8,
        }}
        aria-hidden="true"
      />
      <span className="truncate max-w-[120px]">{name}</span>
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="ml-0.5 shrink-0 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900"
          aria-label={`Remove tag ${name}`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7.5 2.5L2.5 7.5M2.5 2.5l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      )}
      {onRename && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
          className="ml-0.5 shrink-0 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-accent)] focus-visible:ring-offset-1 dark:focus-visible:ring-offset-zinc-900"
          aria-label={`Edit tag ${name}`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M7.1 1.5l1.4 1.4-5 5H2.1v-1.4l5-5z"
              stroke="currentColor"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </span>
  );
}
