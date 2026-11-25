'use client';
import React from 'react';
export interface ScreenShareAudioToggleProps { includeTabAudio: boolean; onToggle: (checked: boolean) => void; disabled?: boolean; fallbackNotice?: string | null; }
export const ScreenShareAudioToggle: React.FC<ScreenShareAudioToggleProps> = ({ includeTabAudio, onToggle, disabled = false, fallbackNotice = null }) => (
  <div data-testid="screen-share-audio-control" className="flex flex-col gap-1.5 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/70">
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-800 dark:text-slate-200">
      <input type="checkbox" data-testid="include-tab-audio-checkbox" checked={includeTabAudio} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      <span>Share tab / system audio</span>
    </label>
    {fallbackNotice && <p role="status" data-testid="screen-share-audio-fallback" className="text-[11px] font-medium text-amber-700 dark:text-amber-300">{fallbackNotice}</p>}
  </div>
);
export default ScreenShareAudioToggle;
