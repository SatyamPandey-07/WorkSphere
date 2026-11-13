'use client';

import React, { useState, useEffect, useRef } from 'react';

interface SplitPaneWorkspaceProps {
  leftPane: React.ReactNode;
  rightPane: React.ReactNode;
  defaultRatio?: number; // percentage for left pane (e.g., 50)
}

export const SplitPaneWorkspace: React.FC<SplitPaneWorkspaceProps> = ({
  leftPane,
  rightPane,
  defaultRatio = 50,
}) => {
  const [splitRatio, setSplitRatio] = useState<number>(defaultRatio);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load persisted split ratio from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('worksphere_split_ratio');
      if (saved) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed) && parsed >= 30 && parsed <= 70) {
          setSplitRatio(parsed);
        }
      }
    }
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const totalWidth = rect.width;

      let newPercentage = (offsetX / totalWidth) * 100;

      // Clamp between 30% and 70% width to prevent layout collapse
      newPercentage = Math.min(Math.max(newPercentage, 30), 70);

      setSplitRatio(newPercentage);
    };

    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        // Persist preferred split ratio
        if (typeof window !== 'undefined') {
          localStorage.setItem('worksphere_split_ratio', splitRatio.toString());
        }
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, splitRatio]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col lg:flex-row w-full h-[calc(100vh-5rem)] overflow-hidden bg-slate-950 text-white select-none"
    >
      {/* Left Pane (e.g., Venue Listing Feed) */}
      <div
        style={{ width: '100%' }}
        className={`lg:h-full overflow-y-auto lg:overflow-hidden flex flex-col ${
          isDragging ? 'pointer-events-none' : ''
        }`}
        // CSS inline style override for desktop split ratio
      >
        <div className="w-full h-full lg:w-auto" style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${splitRatio}%` : '100%' }}>
          {leftPane}
        </div>
      </div>

      {/* Draggable Divider Bar (Desktop only) */}
      <div
        onMouseDown={handleMouseDown}
        className="hidden lg:flex items-center justify-center w-2 bg-slate-900 hover:bg-emerald-500/50 cursor-col-resize transition-colors relative z-20 group"
        title="Drag to resize split panes"
      >
        <div className="w-0.5 h-8 bg-slate-700 group-hover:bg-emerald-400 rounded-full transition-colors" />
      </div>

      {/* Right Pane (e.g., Interactive Leaflet Map) */}
      <div
        style={{ width: '100%' }}
        className={`lg:h-full overflow-hidden flex flex-col flex-1 ${
          isDragging ? 'pointer-events-none' : ''
        }`}
      >
        {rightPane}
      </div>
    </div>
  );
};

export default SplitPaneWorkspace;