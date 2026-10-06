import { Calendar } from "lucide-react";
import { formatMemberSince } from "@/lib/formatMemberSince";

interface MemberSinceBadgeProps {
  createdAt: Date | string | number | null | undefined;
  className?: string;
}

export function MemberSinceBadge({
  createdAt,
  className = "",
}: MemberSinceBadgeProps) {
  const label = formatMemberSince(createdAt);
  if (!label) return null;

  return (
    <span
      data-testid="member-since-badge"
      className={`inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 ${className}`}
    >
      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}
