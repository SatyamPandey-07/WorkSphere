'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, WifiOff, FileText, X } from 'lucide-react';
import {
  defaultDraftStore,
  type DraftStore,
  type BookingDraft,
} from '@/worker/bookingSync/DraftStore';
import { globalSyncQueue, type SyncQueue } from '@/worker/bookingSync/SyncQueue';

export interface NavbarProps {
  draftStore?: DraftStore;
  syncQueue?: SyncQueue;
  onOpenDrafts?: () => void;
  onSyncTriggered?: () => Promise<void> | void;
}

export const Navbar: React.FC<NavbarProps> = ({
  draftStore = defaultDraftStore,
  syncQueue = globalSyncQueue,
  onOpenDrafts,
  onSyncTriggered,
}) => {
  const [pendingCount, setPendingCount] = useState(0);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [draftsList, setDraftsList] = useState<BookingDraft[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const badgeButtonRef = useRef<HTMLButtonElement>(null);

  // Connectivity tracking
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Pending count subscription
  useEffect(() => {
    const unsubscribe = draftStore.subscribe((count) => {
      setPendingCount(count);
    });
    return () => {
      unsubscribe();
    };
  }, [draftStore]);

  // Load drafts when popover opens or count changes
  useEffect(() => {
    if (isPopoverOpen) {
      void draftStore.getPendingDrafts().then((drafts) => {
        setDraftsList(drafts);
      });
    }
  }, [isPopoverOpen, pendingCount, draftStore]);

  // Popover keyboard navigation and outside click dismissal
  useEffect(() => {
    if (!isPopoverOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsPopoverOpen(false);
        badgeButtonRef.current?.focus();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        badgeButtonRef.current &&
        !badgeButtonRef.current.contains(e.target as Node)
      ) {
        setIsPopoverOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isPopoverOpen]);

  const handleBadgeClick = () => {
    setIsPopoverOpen((prev) => !prev);
    if (onOpenDrafts) {
      onOpenDrafts();
    }
  };

  const handleSyncNow = async () => {
    if (!isOnline || isSyncing) return;
    setIsSyncing(true);
    try {
      if (onSyncTriggered) {
        await onSyncTriggered();
      } else if (syncQueue) {
        await syncQueue.processQueue();
      }
      const updated = await draftStore.getPendingDrafts();
      setDraftsList(updated);
      setPendingCount(updated.length);
      if (updated.length === 0) {
        setIsPopoverOpen(false);
      }
    } catch (err) {
      console.error('Failed to sync offline drafts:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-950 relative">
      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
        WorkSphere
      </span>

      {pendingCount > 0 && (
        <div className="relative inline-block text-left">
          <button
            ref={badgeButtonRef}
            type="button"
            data-testid="offline-drafts-badge"
            aria-haspopup="dialog"
            aria-expanded={isPopoverOpen}
            aria-controls="offline-drafts-popover"
            aria-label={`${pendingCount} offline ${pendingCount === 1 ? 'draft' : 'drafts'} pending sync`}
            onClick={handleBadgeClick}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 transition hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/60 dark:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
          >
            <span
              className="h-1.5 w-1.5 rounded-full bg-amber-500"
              aria-hidden="true"
            />
            <span>
              {pendingCount} Offline {pendingCount === 1 ? 'Draft' : 'Drafts'}
            </span>
          </button>

          {/* Offline Draft Sync Popover (#10301) */}
          {isPopoverOpen && (
            <div
              id="offline-drafts-popover"
              ref={popoverRef}
              role="dialog"
              aria-modal="false"
              aria-labelledby="offline-drafts-popover-title"
              data-testid="offline-drafts-popover"
              className="absolute right-0 mt-2 z-50 w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900 animate-in fade-in-50 zoom-in-95 duration-150"
            >
              <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-amber-500" aria-hidden="true" />
                  <h3
                    id="offline-drafts-popover-title"
                    className="text-sm font-semibold text-slate-900 dark:text-slate-100"
                  >
                    Pending Offline Drafts
                  </h3>
                </div>
                <button
                  type="button"
                  aria-label="Close popover"
                  onClick={() => setIsPopoverOpen(false)}
                  className="rounded-full p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              {/* Status and count banner */}
              <div className="mt-3 flex items-center justify-between">
                <span
                  data-testid="pending-drafts-count"
                  className="text-xs font-medium text-slate-600 dark:text-slate-300"
                >
                  {pendingCount} {pendingCount === 1 ? 'draft' : 'drafts'} waiting to sync
                </span>

                {!isOnline && (
                  <span
                    data-testid="offline-indicator"
                    role="status"
                    className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50"
                  >
                    <WifiOff className="h-3 w-3" aria-hidden="true" />
                    Offline
                  </span>
                )}
              </div>

              {/* Draft List */}
              <div className="mt-3 max-h-48 overflow-y-auto space-y-2 pr-1">
                {draftsList.length > 0 ? (
                  draftsList.map((draft) => (
                    <div
                      key={draft.id}
                      data-testid={`draft-item-${draft.id}`}
                      className="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/50 text-xs flex flex-col gap-0.5"
                    >
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                        {draft.venueName || draft.venueId || 'Booking Draft'}
                      </span>
                      {draft.dateISO && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          {draft.dateISO}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="py-4 text-center text-xs text-slate-400">
                    No pending offline drafts.
                  </div>
                )}
              </div>

              {/* Action Button */}
              <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-400">
                  {!isOnline ? 'Connect to internet to sync' : 'Sync automatically or now'}
                </span>

                <button
                  type="button"
                  data-testid="sync-now-button"
                  disabled={!isOnline || isSyncing}
                  onClick={handleSyncNow}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold shadow-xs transition ${
                    !isOnline || isSyncing
                      ? 'bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500'
                      : 'bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700'
                  }`}
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`}
                    aria-hidden="true"
                  />
                  <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
};

export default Navbar;
