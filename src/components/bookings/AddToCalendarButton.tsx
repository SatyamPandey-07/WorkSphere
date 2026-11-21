'use client';

import React, { useState, useRef, useEffect } from 'react';
import { CalendarPlus, Download, ExternalLink, Check } from 'lucide-react';
import {
    BookingCalendarEvent,
    buildGoogleCalendarUrl,
    downloadBookingIcs,
} from '@/lib/calendar/icsGenerator';
import {
    REMINDER_OPTIONS,
    DEFAULT_REMINDER,
    formatReminderLabel,
    loadReminder,
    saveReminder,
    type ReminderMinutes,
} from '@/lib/calendar/reminders';

interface AddToCalendarButtonProps {
    event: BookingCalendarEvent;
    variant?: 'primary' | 'secondary' | 'compact';
    className?: string;
}

export function AddToCalendarButton({
    event,
    variant = 'secondary',
    className = '',
}: AddToCalendarButtonProps) {
    const [open, setOpen] = useState(false);
    const [downloaded, setDownloaded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [alarmMinutes, setAlarmMinutes] = useState<ReminderMinutes>(DEFAULT_REMINDER);

    useEffect(() => {
        setAlarmMinutes(loadReminder());
    }, []);

    const handleReminderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = Number(e.target.value) as ReminderMinutes;
        setAlarmMinutes(value);
        saveReminder(value);
    };

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, []);

    const handleDownloadIcs = () => {
        downloadBookingIcs(event, alarmMinutes);
        setDownloaded(true);
        setTimeout(() => {
            setDownloaded(false);
            setOpen(false);
        }, 1500);
    };

    const googleCalendarUrl = buildGoogleCalendarUrl(event);

    const buttonStyles = {
        primary:
            'inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400',
        secondary:
            'inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3.5 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 hover:border-zinc-600 transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400',
        compact:
            'inline-flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-violet-400',
    }[variant];

    return (
        <div ref={containerRef} className={`relative inline-block ${className}`}>
            <button
                type="button"
                onClick={() => setOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Add reservation to calendar"
                className={buttonStyles}
            >
                {downloaded ? (
                    <>
                        <Check className="h-4 w-4 text-emerald-400" />
                        <span>Saved .ics</span>
                    </>
                ) : (
                    <>
                        <CalendarPlus className="h-4 w-4 text-violet-400" />
                        <span>Add to Calendar</span>
                    </>
                )}
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Calendar providers"
                    className="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-xl border border-zinc-800 bg-zinc-950 p-1.5 shadow-xl ring-1 ring-black/40"
                >
                    <div className="px-3 pb-2 pt-1">
                        <label className="mb-1 block text-[11px] font-medium text-zinc-400" htmlFor="reminder-select">
                            Reminder (.ics only)
                        </label>
                        <select
                            id="reminder-select"
                            aria-label="Reminder time"
                            value={alarmMinutes}
                            onChange={handleReminderChange}
                            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
                        >
                            {REMINDER_OPTIONS.map((m) => (
                                <option key={m} value={m}>
                                    {formatReminderLabel(m)}
                                </option>
                            ))}
                        </select>
                    </div>
                    <a
                        href={googleCalendarUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        onClick={() => setOpen(false)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
                    >
                        <span>Google Calendar</span>
                        <ExternalLink className="h-3.5 w-3.5 text-zinc-400" />
                    </a>

                    <button
                        type="button"
                        role="menuitem"
                        onClick={handleDownloadIcs}
                        className="mt-0.5 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
                    >
                        <span>Apple Calendar / Outlook (.ics)</span>
                        <Download className="h-3.5 w-3.5 text-zinc-400" />
                    </button>
                </div>
            )}
        </div>
    );
}