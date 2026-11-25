'use client';
import React, { useId, useRef, useState } from 'react';
export interface VenueSearchInputProps { value: string; onChange: (value: string) => void; historyItems?: readonly string[]; onSelectHistory?: (item: string) => void; placeholder?: string; }
export const VenueSearchInput: React.FC<VenueSearchInputProps> = ({ value, onChange, historyItems = [], onSelectHistory, placeholder = 'Search venues, neighborhoods, amenities...' }) => {
  const listboxId = useId(); const inputRef = useRef<HTMLInputElement | null>(null); const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const expanded = isDropdownOpen && historyItems.length > 0;
  return (
    <div className="relative w-full" onBlur={(e) => { const next = e.relatedTarget as HTMLElement | null; if (!next || !next.closest?.(`[data-listbox-for="${listboxId}"]`)) setIsDropdownOpen(false); }}>
      <input ref={inputRef} type="text" role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={listboxId} data-testid="venue-search-input" value={value} placeholder={placeholder} onFocus={() => { if (historyItems.length > 0) setIsDropdownOpen(true); }} onChange={(e) => { onChange(e.target.value); if (historyItems.length > 0) setIsDropdownOpen(true); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setIsDropdownOpen(false); } }} className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
      {expanded && (
        <ul id={listboxId} role="listbox" data-listbox-for={listboxId} data-testid="venue-search-history-dropdown" className="absolute z-20 mt-1.5 w-full rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-800 dark:bg-slate-900">
          {historyItems.map((item) => (
            <li key={item} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onSelectHistory?.(item); onChange(item); setIsDropdownOpen(false); inputRef.current?.focus(); }} className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">{item}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
export default VenueSearchInput;
