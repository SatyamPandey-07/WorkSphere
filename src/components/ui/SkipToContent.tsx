'use client';
import React, { useState } from 'react';
export interface SkipToContentProps { targetId?: string; label?: string; announcementText?: string; }
export const SkipToContent: React.FC<SkipToContentProps> = ({ targetId = 'main-content', label = 'Skip to main content', announcementText = 'Skipped to main content' }) => {
  const [liveAnnouncement, setLiveAnnouncement] = useState('');
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = typeof document !== 'undefined' ? document.getElementById(targetId) : null;
    if (target) { e.preventDefault(); if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: false }); target.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); setLiveAnnouncement(''); requestAnimationFrame(() => setLiveAnnouncement(announcementText)); }
  };
  return (
    <>
      <a href={`#${targetId}`} onClick={handleClick} data-testid="skip-to-content-link" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-indigo-600 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2">{label}</a>
      <span role="status" aria-live="polite" data-testid="skip-to-content-announcer" className="sr-only">{liveAnnouncement}</span>
    </>
  );
};
export default SkipToContent;
