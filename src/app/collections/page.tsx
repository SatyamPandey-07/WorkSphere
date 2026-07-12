"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Folder, Plus, Users, LayoutGrid, ChevronRight, Loader2, ArrowLeft, MapPin } from "lucide-react";

export default function CollectionsPage() {
  const [folders, setFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  useEffect(() => {
    fetchFolders();
  }, []);

  const fetchFolders = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/folders");
      const data = await res.json();
      if (data.folders) setFolders(data.folders);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      setCreating(true);
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newFolderName }),
      });
      if (res.ok) {
        setNewFolderName("");
        await fetchFolders();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 pt-8">
        <div className="flex items-center gap-4 mb-8">
           <Link href="/ai" className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 transition-colors">
              <ArrowLeft className="w-5 h-5" />
           </Link>
           <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <LayoutGrid className="w-6 h-6 text-blue-500" />
                My Collections
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Manage your saved venues and collaborate with your team.</p>
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-1">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm sticky top-24">
              <h2 className="text-lg font-semibold mb-4 text-zinc-900 dark:text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-green-500" /> Create Collection
              </h2>
              <form onSubmit={createFolder} className="flex flex-col gap-3">
                <input
                  type="text"
                  placeholder="Collection Name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm outline-none focus:border-blue-500 transition-colors text-zinc-900 dark:text-white"
                  required
                />
                <button
                  type="submit"
                  disabled={creating || !newFolderName.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
                </button>
              </form>
            </div>
          </div>

          <div className="md:col-span-2 space-y-4">
            {loading ? (
              <div className="flex justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
              </div>
            ) : folders.length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 text-center shadow-sm">
                <Folder className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-1">No collections yet</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Create a collection to start saving venues.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {folders.map((folder) => (
                  <Link href={`/collections/${folder.id}`} key={folder.id}>
                    <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 transition-all cursor-pointer h-full flex flex-col">
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                          <Folder className="w-5 h-5" />
                        </div>
                        <ChevronRight className="w-5 h-5 text-zinc-300 dark:text-zinc-700 group-hover:text-blue-500 transition-colors" />
                      </div>
                      
                      <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-1 group-hover:text-blue-500 transition-colors">
                        {folder.name}
                      </h3>
                      
                      <div className="mt-auto pt-4 flex items-center gap-4 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        <span className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md">
                          <MapPin className="w-3.5 h-3.5" />
                          {folder._count?.venues || 0} Places
                        </span>
                        <span className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800 px-2 py-1 rounded-md">
                          <Users className="w-3.5 h-3.5" />
                          {folder._count?.members || 1} Members
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
