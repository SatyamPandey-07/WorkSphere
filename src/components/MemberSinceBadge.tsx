import { Calendar } from "lucide-react";
import { formatMemberSince } from "@/lib/formatMemberSince";

interface MemberSinceBadgeProps {
  createdAt: Date | string | number | null | undefined;
  className?: string;
  title?: string;
}

export function MemberSinceBadge({
  createdAt,
  className = "",
  title,
}: MemberSinceBadgeProps) {
  const label = formatMemberSince(createdAt);
  if (!label) return null;

  return (
    <span
      data-testid="member-since-badge"
      title={title || label}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 ${className}`}
    >
      <Calendar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
        {label}
      </span>
    </span>
  );
}
