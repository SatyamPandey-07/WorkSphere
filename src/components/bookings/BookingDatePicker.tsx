'use client';

import React, { useState, useEffect, useId } from 'react';
import { getDatePreset, type DatePresetKey } from '@/lib/validations/dateFilter';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface BookingDatePickerProps {
  value?: string;
  startDate?: string;
  endDate?: string;
  onChange?: (range: DateRange) => void;
  onDateChange?: (date: string) => void;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
  className?: string;
  id?: string;
  label?: string;
}

export const PRESET_OPTIONS: { key: DatePresetKey; label: string; testId: string }[] = [
  { key: 'today', label: 'Today', testId: 'date-preset-today' },
  { key: 'tomorrow', label: 'Tomorrow', testId: 'date-preset-tomorrow' },
  { key: 'weekend', label: 'This Weekend', testId: 'date-preset-weekend' },
  { key: 'nextMonday', label: 'Next Monday', testId: 'date-preset-next-monday' },
];

export function BookingDatePicker({
  value,
  startDate,
  endDate,
  onChange,
  onDateChange,
  disabled = false,
  minDate,
  maxDate,
  className = '',
  id,
  label = 'Date',
}: BookingDatePickerProps) {
  const generatedId = useId();
  const inputId = id || `booking-date-input-${generatedId}`;

  // Current selected single date or range start
  const currentStartDate = startDate ?? value ?? '';
  const currentEndDate = endDate ?? startDate ?? value ?? '';

  const [internalDate, setInternalDate] = useState(currentStartDate);
  const [internalEndDate, setInternalEndDate] = useState(currentEndDate);
  const [activePreset, setActivePreset] = useState<DatePresetKey | null>(null);

  // Sync from props
  useEffect(() => {
    if (value !== undefined) {
      setInternalDate(value);
      setInternalEndDate(value);
    } else if (startDate !== undefined) {
      setInternalDate(startDate);
      setInternalEndDate(endDate ?? startDate);
    }
  }, [value, startDate, endDate]);

  // Determine active preset based on current dates
  useEffect(() => {
    const active = PRESET_OPTIONS.find(({ key }) => {
      const preset = getDatePreset(key);
      if (internalEndDate && internalEndDate !== internalDate) {
        return preset.startDate === internalDate && preset.endDate === internalEndDate;
      }
      return preset.startDate === internalDate;
    });

    setActivePreset(active ? active.key : null);
  }, [internalDate, internalEndDate]);

  const handlePresetClick = (presetKey: DatePresetKey) => {
    const preset = getDatePreset(presetKey);
    setInternalDate(preset.startDate);
    setInternalEndDate(preset.endDate);
    setActivePreset(presetKey);

    onChange?.({ startDate: preset.startDate, endDate: preset.endDate });
    onDateChange?.(preset.startDate);
  };

  const handleManualDateChange = (newDate: string) => {
    setInternalDate(newDate);
    setInternalEndDate(newDate);

    onChange?.({ startDate: newDate, endDate: newDate });
    onDateChange?.(newDate);
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {label}
          </label>
        )}
        <div
          className="flex items-center gap-1.5"
          role="group"
          aria-label="Calendar date quick presets"
        >
          {PRESET_OPTIONS.map(({ key, label: presetLabel, testId }) => {
            const isSelected = activePreset === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={testId}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={`Select preset: ${presetLabel}`}
                onClick={() => handlePresetClick(key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isSelected
                    ? 'bg-violet-600 text-white shadow-sm dark:bg-violet-600'
                    : 'border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700 dark:hover:text-white'
                }`}
              >
                {presetLabel}
              </button>
            );
          })}
        </div>
      </div>

      <input
        id={inputId}
        type="date"
        value={internalDate}
        min={minDate}
        max={maxDate}
        disabled={disabled}
        onChange={(e) => handleManualDateChange(e.target.value)}
        className="w-full rounded-xl border border-zinc-200 bg-white p-2.5 text-sm text-zinc-900 transition focus:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
