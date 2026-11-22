'use client';

import React, { useEffect } from 'react';

export interface MobileNavItem {
  id: string;
  label: string;
  href: string;
  active?: boolean;
  icon?: React.ReactNode;
}

export interface MobileNavDrawerProps {
  isOpen: boolean;
  items: MobileNavItem[];
  onSelect?: (item: MobileNavItem) => void;
  onClose: () => void;
  title?: string;
}

export const MobileNavDrawer: React.FC<MobileNavDrawerProps> = ({
  isOpen,
  items,
  onSelect,
  onClose,
  title = 'Navigation',
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close navigation backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-slate-950/50"
      />

      <nav
        aria-label="Mobile primary navigation"
        className="relative z-10 flex h-full w-72 max-w-[85vw] flex-col bg-white px-3 py-4 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between px-2">
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation drawer"
            className="rounded-lg p-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            ✕
          </button>
        </div>

        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive = Boolean(item.active);
            return (
              <li key={item.id} className="relative flex items-center">
                <a
                  href={item.href}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={(e) => {
                    if (onSelect) {
                      e.preventDefault();
                      onSelect(item);
                    }
                  }}
                  data-testid={`mobile-nav-link-${item.id}`}
                  className={`relative flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium leading-5 transition-colors ${
                    isActive
                      ? 'bg-indigo-50/90 text-indigo-700'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isActive && (
                    <span
                      aria-hidden="true"
                      data-testid={`mobile-nav-indicator-${item.id}`}
                      className="h-6 w-1 shrink-0 self-center rounded-full bg-indigo-600"
                    />
                  )}

                  {item.icon && (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
                      {item.icon}
                    </span>
                  )}

                  <span className="truncate leading-5">{item.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
};