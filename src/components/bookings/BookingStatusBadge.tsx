"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, CheckCircle2, MapPin, XCircle } from "lucide-react";

export type BookingStatus = "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CANCELLED" | "COMPLETED";

interface BookingStatusBadgeProps {
  status: BookingStatus;
  className?: string;
  showIcon?: boolean;
}

const STATUS_CONFIG: Record<
  BookingStatus,
  {
    label: string;
    icon: React.ElementType;
    bg: string;
    text: string;
    border: string;
  }
> = {
  PENDING: {
    label: "Pending",
    icon: Clock,
    bg: "bg-amber-50 dark:bg-amber-900/20",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-700/40",
  },
  CONFIRMED: {
    label: "Confirmed",
    icon: CheckCircle2,
    bg: "bg-green-50 dark:bg-green-900/20",
    text: "text-green-700 dark:text-green-300",
    border: "border-green-200 dark:border-green-700/40",
  },
  CHECKED_IN: {
    label: "Checked In",
    icon: MapPin,
    bg: "bg-blue-50 dark:bg-blue-900/20",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-700/40",
  },
  CANCELLED: {
    label: "Cancelled",
    icon: XCircle,
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-200 dark:border-red-700/40",
  },
  COMPLETED: {
    label: "Completed",
    icon: CheckCircle2,
    bg: "bg-zinc-50 dark:bg-zinc-800/40",
    text: "text-zinc-600 dark:text-zinc-400",
    border: "border-zinc-200 dark:border-zinc-700",
  },
};

/**
 * Animated booking status badge.
 * Uses Framer Motion scale + fade on status changes.
 */
export function BookingStatusBadge({
  status,
  className = "",
  showIcon = true,
}: BookingStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  const Icon = config.icon;

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${config.bg} ${config.text} ${config.border} ${className}`}
        aria-label={`Booking status: ${config.label}`}
      >
        {showIcon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
        {config.label}
      </motion.span>
    </AnimatePresence>
  );
}
