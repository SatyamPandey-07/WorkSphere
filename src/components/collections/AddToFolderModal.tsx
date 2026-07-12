"use client";

import { useState, useEffect } from "react";
import { X, Folder, Plus, Loader2 } from "lucide-react";

interface AddToFolderModalProps {
  venue: any;
  onClose: () => void;
}

export function AddToFolderModal({ venue, onClose }: AddToFolderModalProps) {
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  useEffect(() => {
    fetchFolders();
  }, []);

  const fetchFolders = async () => {
    try {
      const res = await fetch("/api/folders");
      const data = await res.json();
      if (data.folders) setFolders(data.folders);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const addToFolder = async (folderId: string) => {
    setAddingTo(folderId);
    try {
      const res = await fetch(`/api/folders/${folderId}/venues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venue }),
      });
      if (res.ok) {
        // Trigger a broadcast
        await fetch("http://127.0.0.1:1999/parties/main/folder-" + folderId, {
          method: "POST",
          body: JSON.stringify({ type: "refresh" })
        }).catch(() => {});
        onClose();
      } else {
        alert("Could not add venue to folder");
      }
    } catch (e) {
      console.error(e);
    } finally {
      setAddingTo(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white flex items-center gap-2">
            <Folder className="w-5 h-5 text-blue-500" />
            Add to Collection
          </h2>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center p-8">
             <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
          </div>
        ) : folders.length === 0 ? (
          <div className="text-center p-8 border border-zinc-200 dark:border-zinc-800 rounded-xl">
             <p className="text-sm text-zinc-500 mb-4">You don't have any collections yet.</p>
             <a href="/collections" target="_blank" className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">Create One</a>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => addToFolder(folder.id)}
                disabled={addingTo !== null}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:border-blue-500/50 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-all text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500">
                    <Folder className="w-4 h-4" />
                  </div>
                  <span className="font-medium text-sm text-zinc-900 dark:text-white">{folder.name}</span>
                </div>
                {addingTo === folder.id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                ) : (
                  <Plus className="w-4 h-4 text-zinc-400" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
