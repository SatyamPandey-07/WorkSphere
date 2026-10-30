"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, Folder, Plus, Loader2, AlertCircle } from "lucide-react";

export interface FolderItem {
  id: string;
  name: string;
  color?: string;
  accessRole?: string;
  [key: string]: any;
}

export interface VenueItem {
  id?: string;
  name?: string;
  city?: string;
  [key: string]: any;
}

export interface AddToFolderModalProps {
  venue: VenueItem;
  onClose: () => void;
  onSuccess?: (folderId: string) => void;
  onError?: (error: Error | string) => void;
  initialFolders?: FolderItem[];
  className?: string;
  testId?: string;
}

export function AddToFolderModal({
  venue,
  onClose,
  onSuccess,
  onError,
  initialFolders,
  className = "",
  testId = "add-to-folder-modal",
}: AddToFolderModalProps) {
  const [folders, setFolders] = useState<FolderItem[]>(() => {
    if (Array.isArray(initialFolders)) {
      return initialFolders.filter(
        (folder) => folder.accessRole === "OWNER" || folder.accessRole === "EDITOR" || !folder.accessRole,
      );
    }
    return [];
  });
  const [loading, setLoading] = useState<boolean>(() => !Array.isArray(initialFolders));
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Keyboard navigation & Escape dismissal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const fetchFolders = useCallback(async () => {
    if (Array.isArray(initialFolders)) return;

    setLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/folders");
      if (!res.ok) {
        throw new Error(`Failed to load collections (${res.status})`);
      }
      const data = await res.json();
      if (isMountedRef.current && data?.folders) {
        const allowed = data.folders.filter(
          (folder: { accessRole?: string }) =>
            folder.accessRole === "OWNER" || folder.accessRole === "EDITOR" || !folder.accessRole,
        );
        setFolders(allowed);
      }
    } catch (e: any) {
      if (isMountedRef.current) {
        const message = e?.message || "Failed to load collections";
        setErrorMessage(message);
        onError?.(message);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [initialFolders, onError]);

  useEffect(() => {
    if (!initialFolders) {
      fetchFolders();
    }
  }, [initialFolders, fetchFolders]);

  const addToFolder = async (folderId: string) => {
    setAddingTo(folderId);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(folderId)}/venues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue }),
      });

      if (!res.ok) {
        throw new Error(`Could not add venue to folder (HTTP ${res.status})`);
      }

      // Trigger PartyKit refresh broadcast safely
      try {
        const broadcastUrl = typeof window !== "undefined" && window.location?.origin
          ? `${window.location.origin}/parties/main/folder-${folderId}`
          : `http://127.0.0.1:1999/parties/main/folder-${folderId}`;

        await fetch(broadcastUrl, {
          method: "POST",
          body: JSON.stringify({ type: "refresh" }),
        }).catch(() => {});
      } catch {
        // Non-blocking broadcast error ignored
      }

      if (isMountedRef.current) {
        onSuccess?.(folderId);
        onClose();
      }
    } catch (e: any) {
      const msg = e?.message || "Could not add venue to folder";
      if (isMountedRef.current) {
        setErrorMessage(msg);
      }
      onError?.(msg);
    } finally {
      if (isMountedRef.current) {
        setAddingTo(null);
      }
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-to-folder-title"
      data-testid={testId}
      onClick={handleBackdropClick}
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm ${className}`.trim()}
    >
      <div
        data-testid="add-to-folder-container"
        className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200"
      >
        <div className="flex justify-between items-center mb-4">
          <h2
            id="add-to-folder-title"
            className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2"
          >
            <Folder className="w-5 h-5 accent-text text-blue-500" />
            Add to Collection
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            data-testid="modal-close-button"
            className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {venue?.name && (
          <div
            data-testid="venue-preview-badge"
            className="mb-4 px-3 py-2 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200/60 dark:border-zinc-800 flex items-center gap-2 overflow-hidden"
          >
            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium shrink-0">Venue:</span>
            <span
              title={venue.name}
              className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 truncate cursor-help"
            >
              {venue.name}
              {venue.city ? ` · ${venue.city}` : ""}
            </span>
          </div>
        )}

        {errorMessage && (
          <div
            role="alert"
            data-testid="folder-error-banner"
            className="mb-4 flex items-center justify-between gap-2 p-3 text-xs rounded-xl bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-900/50"
          >
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="truncate">{errorMessage}</span>
            </div>
            {!loading && (
              <button
                type="button"
                onClick={fetchFolders}
                data-testid="folder-error-retry-btn"
                className="font-medium underline hover:no-underline shrink-0 text-red-800 dark:text-red-200"
              >
                Retry
              </button>
            )}
          </div>
        )}

        {loading ? (
          <div data-testid="folder-loading-spinner" className="flex justify-center p-8">
            <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          </div>
        ) : folders.length === 0 ? (
          <div
            data-testid="folder-empty-state"
            className="text-center p-8 border border-zinc-200 dark:border-zinc-800 rounded-xl"
          >
            <p className="text-sm text-zinc-500 mb-4">
              You don&apos;t have any collections yet.
            </p>
            <a
              href="/collections"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="folder-create-link"
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Create One
            </a>
          </div>
        ) : (
          <div
            data-testid="folder-list"
            className="space-y-2 max-h-64 overflow-y-auto"
          >
            {folders.map((folder) => {
              const isItemAdding = addingTo === folder.id;
              return (
                <button
                  key={folder.id}
                  type="button"
                  data-testid={`folder-item-${folder.id}`}
                  onClick={() => addToFolder(folder.id)}
                  disabled={addingTo !== null}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50 hover:bg-blue-50/10 dark:hover:bg-blue-950/20 transition-all text-left disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-semibold shadow-xs shrink-0"
                      style={{ backgroundColor: folder.color || "#3b82f6" }}
                    >
                      <Folder className="w-4 h-4" />
                    </div>
                    <span
                      title={folder.name}
                      className="font-medium text-sm text-zinc-900 dark:text-white truncate"
                    >
                      {folder.name}
                    </span>
                  </div>
                  {isItemAdding ? (
                    <Loader2
                      data-testid={`folder-spinner-${folder.id}`}
                      className="w-4 h-4 animate-spin text-blue-500"
                    />
                  ) : (
                    <Plus
                      data-testid={`folder-add-btn-${folder.id}`}
                      className="w-4 h-4 text-zinc-400"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default AddToFolderModal;
