"use client";

import React, { useState, useEffect } from 'react';
import { MetricsWidget } from './MetricsWidget';
import { Loader2, ArrowRightLeft } from 'lucide-react';

interface ComparisonToolProps {
  currentFolder: any; // The current folder object with venues
}

export function ComparisonTool({ currentFolder }: ComparisonToolProps) {
  const [folders, setFolders] = useState<any[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [compareFolder, setCompareFolder] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch all folders for the dropdown
    async function fetchFolders() {
      try {
        const res = await fetch('/api/folders');
        const data = await res.json();
        if (data.folders) {
          // Exclude current folder
          setFolders(data.folders.filter((f: any) => f.id !== currentFolder.id));
        }
      } catch (e) {
        console.error("Failed to fetch folders", e);
      }
    }
    fetchFolders();
  }, [currentFolder.id]);

  useEffect(() => {
    if (!selectedFolderId) {
      setCompareFolder(null);
      return;
    }

    async function fetchCompareFolder() {
      setLoading(true);
      try {
        const res = await fetch(`/api/folders/${selectedFolderId}`);
        const data = await res.json();
        if (data.folder) {
          setCompareFolder(data.folder);
        }
      } catch (e) {
        console.error("Failed to fetch compare folder", e);
      } finally {
        setLoading(false);
      }
    }
    
    fetchCompareFolder();
  }, [selectedFolderId]);

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm mb-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-indigo-500" /> Compare Collections
        </h2>
        
        <div className="flex items-center gap-3">
          <label htmlFor="compare-select" className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Compare with:
          </label>
          <select
            id="compare-select"
            value={selectedFolderId}
            onChange={(e) => setSelectedFolderId(e.target.value)}
            className="bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-zinc-100 text-sm rounded-xl focus:ring-blue-500 focus:border-blue-500 block w-48 p-2.5"
          >
            <option value="">Select a collection...</option>
            {folders.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative">
        <MetricsWidget venues={currentFolder.venues} title={currentFolder.name} isCompact />
        
        {loading ? (
          <div className="bg-zinc-50 dark:bg-zinc-950/50 border border-zinc-100 dark:border-zinc-800/50 rounded-2xl p-5 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
          </div>
        ) : compareFolder ? (
          <MetricsWidget venues={compareFolder.venues} title={compareFolder.name} isCompact />
        ) : (
          <div className="bg-zinc-50 dark:bg-zinc-950/50 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl p-5 flex flex-col items-center justify-center text-zinc-400">
            <ArrowRightLeft className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">Select a collection above to compare</p>
          </div>
        )}
      </div>
    </div>
  );
}
