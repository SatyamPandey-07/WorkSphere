"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  className?: string;
  showHomeIcon?: boolean;
}

/**
 * Accessible breadcrumb trail for nested venue & collection pages.
 * The last item is the current page (no link, aria-current="page").
 */
export function Breadcrumb({
  items,
  className = "",
  showHomeIcon = true,
}: BreadcrumbProps) {
  if (items.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={`flex items-center gap-1 text-sm text-zinc-500 dark:text-zinc-400 flex-wrap ${className}`}
    >
      <ol className="flex items-center gap-1 flex-wrap list-none m-0 p-0">
        {showHomeIcon && (
          <li className="flex items-center">
            <Link
              href="/"
              aria-label="Home"
              className="flex items-center text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
            </Link>
            <ChevronRight className="w-3.5 h-3.5 mx-1 text-zinc-300 dark:text-zinc-600" aria-hidden="true" />
          </li>
        )}

        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <li key={`${item.label}-${idx}`} className="flex items-center">
              {isLast ? (
                <span
                  aria-current="page"
                  className="font-medium text-zinc-800 dark:text-zinc-100 max-w-[200px] truncate"
                  title={item.label}
                >
                  {item.label}
                </span>
              ) : (
                <>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors max-w-[160px] truncate"
                      title={item.label}
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span className="max-w-[160px] truncate" title={item.label}>
                      {item.label}
                    </span>
                  )}
                  <ChevronRight
                    className="w-3.5 h-3.5 mx-1 text-zinc-300 dark:text-zinc-600 shrink-0"
                    aria-hidden="true"
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
