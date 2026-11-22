'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Palette, X, Check } from 'lucide-react';

export interface AccentSwatch {
    id: string;
    label: string;
    hex: string;
    ringClass: string;
    bgClass: string;
}

export const DEFAULT_ACCENT_SWATCHES: AccentSwatch[] = [
    {
        id: 'violet',
        label: 'Electric Violet',
        hex: '#8b5cf6',
        ringClass: 'ring-violet-400',
        bgClass: 'bg-violet-500',
    },
    {
        id: 'cyan',
        label: 'Cyber Cyan',
        hex: '#06b6d4',
        ringClass: 'ring-cyan-400',
        bgClass: 'bg-cyan-500',
    },
    {
        id: 'emerald',
        label: 'Matrix Emerald',
        hex: '#10b981',
        ringClass: 'ring-emerald-400',
        bgClass: 'bg-emerald-500',
    },
    {
        id: 'amber',
        label: 'Solar Amber',
        hex: '#f59e0b',
        ringClass: 'ring-amber-400',
        bgClass: 'bg-amber-500',
    },
    {
        id: 'rose',
        label: 'Neon Rose',
        hex: '#f43f5e',
        ringClass: 'ring-rose-400',
        bgClass: 'bg-rose-500',
    },
    {
        id: 'indigo',
        label: 'Deep Indigo',
        hex: '#6366f1',
        ringClass: 'ring-indigo-400',
        bgClass: 'bg-indigo-500',
    },
];

export interface AccentPickerProps {
    swatches?: AccentSwatch[];
    value?: string;
    onChange?: (swatch: AccentSwatch) => void;
    className?: string;
}

const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AccentPicker({
    swatches = DEFAULT_ACCENT_SWATCHES,
    value,
    onChange,
    className = '',
}: AccentPickerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [internalSelectedId, setInternalSelectedId] = useState<string>(
        value ?? swatches[0]?.id ?? 'violet'
    );

    const selectedId = value ?? internalSelectedId;
    const activeSwatch =
        swatches.find((s) => s.id === selectedId) ?? swatches[0];

    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const closePopoverAndRestoreFocus = useCallback((restoreFocus = true) => {
        setIsOpen(false);
        if (restoreFocus) {
            // Defer focus restoration one microtask/frame so React unmounts the dialog cleanly
            requestAnimationFrame(() => {
                triggerRef.current?.focus();
            });
        }
    }, []);

    // Move focus into the popover when opened (focus active swatch or first focusable button)
    useEffect(() => {
        if (!isOpen || !popoverRef.current) return;

        const focusableElements = Array.from(
            popoverRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );

        if (focusableElements.length === 0) return;

        const selectedSwatchEl = popoverRef.current.querySelector<HTMLElement>(
            `[data-swatch-id="${selectedId}"]`
        );

        const initialTarget = selectedSwatchEl ?? focusableElements[0];
        initialTarget.focus();
    }, [isOpen, selectedId]);

    // Close on outside click without stealing focus from wherever the user clicked
    useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                closePopoverAndRestoreFocus(false);
            }
        };

        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [isOpen, closePopoverAndRestoreFocus]);

    /**
     * WCAG 2.1 Focus Trap & Escape Handler:
     * - Cycles Tab / Shift+Tab strictly within the open popover's swatch buttons and close button.
     * - Closes on Escape and restores focus to the trigger button.
     */
    const handlePopoverKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePopoverAndRestoreFocus(true);
            return;
        }

        if (event.key !== 'Tab' || !popoverRef.current) {
            return;
        }

        const focusableElements = Array.from(
            popoverRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        );

        if (focusableElements.length === 0) {
            event.preventDefault();
            return;
        }

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        const activeElement = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
            // Shift+Tab on first element wraps around to the last element (Close button)
            if (!activeElement || activeElement === firstElement || !popoverRef.current.contains(activeElement)) {
                event.preventDefault();
                lastElement.focus();
            }
        } else {
            // Tab on last element (Close button) wraps around to the first swatch button
            if (!activeElement || activeElement === lastElement || !popoverRef.current.contains(activeElement)) {
                event.preventDefault();
                firstElement.focus();
            }
        }
    };

    const handleSelectSwatch = (swatch: AccentSwatch) => {
        setInternalSelectedId(swatch.id);
        onChange?.(swatch);
        closePopoverAndRestoreFocus(true);
    };

    return (
        <div ref={containerRef} className={`relative inline-block ${className}`}>
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setIsOpen((prev) => !prev)}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls="accent-picker-popover"
                aria-label={`Theme accent color: ${activeSwatch?.label ?? 'Default'}`}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/90 px-3 py-2 text-xs font-medium text-zinc-100 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-violet-400"
            >
                <span
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 rounded-full border border-white/20 ${activeSwatch?.bgClass ?? 'bg-violet-500'}`}
                />
                <Palette className="h-3.5 w-3.5 text-zinc-400" />
                <span>Accent</span>
            </button>

            {isOpen && (
                <div
                    ref={popoverRef}
                    id="accent-picker-popover"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Choose workspace accent color"
                    onKeyDown={handlePopoverKeyDown}
                    className="absolute right-0 z-50 mt-2 w-60 rounded-xl border border-zinc-800 bg-zinc-950 p-3 shadow-2xl ring-1 ring-black/50"
                >
                    <div className="mb-2.5 flex items-center justify-between border-b border-zinc-800/80 pb-2">
                        <span className="text-xs font-semibold text-zinc-200">
                            Accent Palette
                        </span>
                        <button
                            type="button"
                            onClick={() => closePopoverAndRestoreFocus(true)}
                            aria-label="Close accent color picker"
                            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    <div
                        role="radiogroup"
                        aria-label="Accent color swatches"
                        className="grid grid-cols-3 gap-2"
                    >
                        {swatches.map((swatch) => {
                            const isSelected = swatch.id === selectedId;
                            return (
                                <button
                                    key={swatch.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={isSelected}
                                    aria-label={swatch.label}
                                    data-swatch-id={swatch.id}
                                    onClick={() => handleSelectSwatch(swatch)}
                                    className={`flex flex-col items-center justify-center gap-1.5 rounded-lg border p-2 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400 ${isSelected
                                            ? 'border-zinc-500 bg-zinc-900 text-white'
                                            : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                                        }`}
                                >
                                    <span
                                        className={`flex h-5 w-5 items-center justify-center rounded-full ${swatch.bgClass} ${isSelected ? `ring-2 ring-offset-2 ring-offset-zinc-950 ${swatch.ringClass}` : ''
                                            }`}
                                    >
                                        {isSelected && <Check className="h-3 w-3 text-white" />}
                                    </span>
                                    <span className="truncate max-w-full">
                                        {swatch.id.charAt(0).toUpperCase() + swatch.id.slice(1)}
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