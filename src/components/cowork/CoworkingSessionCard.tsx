import React, { useState, useRef, useEffect } from 'react';
import { generateGoogleCalendarUrl, downloadIcsFile, CalendarEvent } from '../../lib/calendar/icsGenerator';

interface CoworkingSessionCardProps {
  session: CalendarEvent & {
    id: string;
    hostName: string;
    attendeeCount: number;
  };
}

export const CoworkingSessionCard: React.FC<CoworkingSessionCardProps> = ({ session }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleGoogleCalendar = () => {
    const url = generateGoogleCalendarUrl(session);
    window.open(url, '_blank', 'noopener,noreferrer');
    setDropdownOpen(false);
  };

  const handleIcsDownload = () => {
    downloadIcsFile(session);
    setDropdownOpen(false);
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-white shadow-xl max-w-md">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-slate-100">{session.title}</h3>
        <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-medium border border-emerald-500/30">
          Coworking Session
        </span>
      </div>

      <p className="text-sm text-slate-300 mb-4">{session.description}</p>

      <div className="space-y-2 text-xs text-slate-400 mb-5 border-t border-slate-800 pt-3">
        <div>📍 Venue: <span className="text-slate-200">{session.location}</span></div>
        <div>👤 Host: <span className="text-slate-200">{session.hostName}</span></div>
        <div>👥 Attendees: <span className="text-slate-200">{session.attendeeCount} joined</span></div>
      </div>

      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(!dropdownOpen)}
          className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/30 cursor-pointer"
        >
          <span>Add to Calendar</span>
          <span className="text-xs">▼</span>
        </button>

        {dropdownOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50 animate-fadeIn">
            <button
              onClick={handleGoogleCalendar}
              className="w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-slate-700/80 transition flex items-center gap-2 border-b border-slate-700/50 cursor-pointer"
            >
              📅 Google Calendar
            </button>
            <button
              onClick={handleIcsDownload}
              className="w-full text-left px-4 py-3 text-sm text-slate-200 hover:bg-slate-700/80 transition flex items-center gap-2 cursor-pointer"
            >
              🍏 Apple / Outlook (.ics)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CoworkingSessionCard;