'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
    X,
    Copy,
    Check,
    Share2,
    Link2,
    AlertCircle,
    MapPin,
} from 'lucide-react';

export const COPY_FEEDBACK_DURATION_MS = 2500;

export interface ShareableVenue {
    id: string;
    name: string;
    address?: string | null;
    slug?: string;
}

export interface VenueShareModalProps {
    venue: ShareableVenue | null;
    isOpen: boolean;
    onClose: () => void;
    /** Optional explicit share URL override; defaults to window.location.origin + /venues/:id */
    shareUrl?: string;
    /** Optional external toast error callback if parent provides a global toaster */
    onErrorToast?: (message: string) => void;
}

/**
 * Copies text to clipboard using the Async Clipboard API with a hidden textarea
 * `execCommand('copy')` fallback for restricted WebViews.
 */
async function copyTextToClipboard(text: string): Promise<void> {
    if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
    ) {
        await navigator.clipboard.writeText(text);
        return;
    }

    if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();

        const succeeded = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (succeeded) {
            return;
        }
    }

    throw new Error('Clipboard access denied or unsupported in this browser context');
}

export function VenueShareModal({
    venue,
    isOpen,
    onClose,
    shareUrl,
    onErrorToast,
}: VenueShareModalProps) {
    const [copied, setCopied] = useState<boolean>(false);
    const [errorToastMessage, setErrorToastMessage] = useState<string | null>(null);

    const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearTimers = useCallback(() => {
        if (copiedTimerRef.current !== null) {
            clearTimeout(copiedTimerRef.current);
            copiedTimerRef.current = null;
        }
        if (errorTimerRef.current !== null) {
            clearTimeout(errorTimerRef.current);
            errorTimerRef.current = null;
        }
    }, []);

    // Reset transient feedback states whenever modal closes or venue changes
    useEffect(() => {
        if (!isOpen) {
            clearTimers();
            setCopied(false);
            setErrorToastMessage(null);
        }
    }, [isOpen, venue?.id, clearTimers]);

    // Cleanup timers on unmount
    useEffect(() => {
        return () => {
            clearTimers();
        };
    }, [clearTimers]);

    // Close modal on Escape key
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || !venue) {
        return null;
    }

    const origin =
        typeof window !== 'undefined' && window.location?.origin
            ? window.location.origin
            : 'https://work-sphere-one.vercel.app';

    const resolvedShareUrl =
        shareUrl ?? `${origin}/venues/${encodeURIComponent(venue.slug ?? venue.id)}`;

    const handleCopyLink = async () => {
        try {
            await copyTextToClipboard(resolvedShareUrl);

            setErrorToastMessage(null);
            setCopied(true);

            if (copiedTimerRef.current !== null) {
                clearTimeout(copiedTimerRef.current);
            }

            copiedTimerRef.current = setTimeout(() => {
                setCopied(false);
                copiedTimerRef.current = null;
            }, COPY_FEEDBACK_DURATION_MS);
        } catch {
            setCopied(false);
            const fallbackMsg =
                'Unable to access clipboard. Please select and copy the link manually.';
            setErrorToastMessage(fallbackMsg);
            onErrorToast?.(fallbackMsg);

            if (errorTimerRef.current !== null) {
                clearTimeout(errorTimerRef.current);
            }

            errorTimerRef.current = setTimeout(() => {
                setErrorToastMessage(null);
                errorTimerRef.current = null;
            }, 4000);
        }
    };

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="venue-share-modal-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="relative w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100 shadow-2xl">
                {/* Header */}
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/30 bg-violet-500/10 text-violet-300">
                            <Share2 className="h-4 w-4" />
                        </div>
                        <div>
                            <h2
                                id="venue-share-modal-title"
                                className="text-base font-semibold text-white"
                            >
                                Share Workspace
                            </h2>
                            <p className="text-xs text-zinc-400">
                                Invite peers to co-work at this venue
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close share dialog"
                        className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Venue Summary Card */}
                <div className="mt-4 rounded-xl border border-zinc-800/90 bg-zinc-900/60 p-3.5">
                    <div className="text-sm font-medium text-zinc-100">{venue.name}</div>
                    {venue.address && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
                            <MapPin className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                            <span className="truncate">{venue.address}</span>
                        </div>
                    )}
                </div>

                {/* Share URL Input + Animated Copy Link Button & Tooltip */}
                <div className="mt-4">
                    <label
                        htmlFor="venue-share-url-input"
                        className="mb-1.5 block text-xs font-medium text-zinc-400"
                    >
                        Direct Venue Link
                    </label>

                    <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
                            <input
                                id="venue-share-url-input"
                                type="text"
                                readOnly
                                value={resolvedShareUrl}
                                onFocus={(e) => e.currentTarget.select()}
                                aria-label="Venue share link"
                                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-2.5 pl-8 pr-3 font-mono text-xs text-zinc-200 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                            />
                        </div>

                        <div className="relative shrink-0">
                            {/* Animated "Copied to clipboard!" Tooltip */}
                            <div
                                role="status"
                                aria-live="polite"
                                data-testid="copy-clipboard-tooltip"
                                aria