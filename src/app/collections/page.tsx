"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Folder,
  Plus,
  Users,
  LayoutGrid,
  ChevronRight,
  Loader2,
  ArrowLeft,
  MapPin,
  Globe,
  ThumbsUp,
} from "lucide-react";
import Image from "next/image";

export default function CollectionsPage() {
  const [folders, setFolders] = useState<any[]>([]);
  const [publicFolders, setPublicFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDesc, setNewFolderDesc] = useState("");
  const [newFolderPublic, setNewFolderPublic] = useState(false);
  const [activeTab, setActiveTab] = useState<"my" | "public">("my");

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

  const fetchPublicFolders = async () => {
    try {
      setLoadingPublic(true);
      const res = await fetch("/api/collections/public");
      const data = await res.json();
      if (data.folders) setPublicFolders(data.folders);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPublic(false);
    }
  };

  useEffect(() => {
    if (activeTab === "public") {
      fetchPublicFolders();
    } else {
      fetchFolders();
    }
  }, [activeTab]);

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      setCreating(true);
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFolderName,
          description: newFolderDesc,
          isPublic: newFolderPublic,
        }),
      });
      if (res.ok) {
        setNewFolderName("");
        setNewFolderDesc("");
        setNewFolderPublic(false);
        if (activeTab === "my") {
          await fetchFolders();
        } else {
          setActiveTab("my");
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const toggleUpvote = async (folderId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      // Optimistic state toggle
      setPublicFolders((prev) =>
        prev.map((f) => {
          if (f.id === folderId) {
            const hasUpvoted = !f.hasUpvoted;
            const upvotes = f.upvotes + (hasUpvoted ? 1 : -1);
            return { ...f, hasUpvoted, upvotes };
          }
          return f;
        }),
      );

      const res = await fetch("/api/collections/public/upvote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId }),
      });

      if (!res.ok) {
        fetchPublicFolders();
      } else {
        const data = await res.json();
        setPublicFolders((prev) =>
          prev.map((f) => {
            if (f.id === folderId) {
              return {
                ...f,
                hasUpvoted: data.hasUpvoted,
                upvotes: data.upvotes,
              };
            }
            return f;
          }),
        );
      }
    } catch (err) {
      console.error(err);
      fetchPublicFolders();
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 pt-8">
        {/* Header and Tabs Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-4">
            <Link
              href="/ai"
              className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
                <LayoutGrid className="w-6 h-6 text-blue-500" />
                Collections Hub
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Curate, collaborate, and discover workspaces shared by the
                community.
              </p>
            </div>
          </div>

          <div className="flex p-1 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl self-start sm:self-center">
            <button
              onClick={() => setActiveTab("my")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all ${
                activeTab === "my"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              My Collections
            </button>
            <button
              onClick={() => setActiveTab("public")}
              className={`px-4 py-2 text-sm font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                activeTab === "public"
                  ? "bg-white dark:bg-zinc-800 text-zinc-900 dark:text-white shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
              }`}
            >
              <Globe className="w-4 h-4 text-blue-500" />
              Discovery Feed
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Creation Form */}
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
                <textarea
                  placeholder="Description (Optional)"
                  value={newFolderDesc}
                  onChange={(e) => setNewFolderDesc(e.target.value)}
                  className="w-full px-4 py-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl text-sm outline-none focus:border-blue-500 transition-colors text-zinc-900 dark:text-white resize-none h-20"
                />
                <div className="flex items-center justify-between px-1 py-1">
                  <span className="text-xs text-zinc-500">
                    Publish to Discovery Feed
                  </span>
                  <button
                    type="button"
                    onClick={() => setNewFolderPublic(!newFolderPublic)}
                    className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                      newFolderPublic
                        ? "bg-blue-600"
                        : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        newFolderPublic ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
                <button
                  type="submit"
                  disabled={creating || !newFolderName.trim()}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {creating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Create"
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* List Views */}
          <div className="md:col-span-2 space-y-4">
            {activeTab === "my" ? (
              // My Collections tab
              loading ? (
                <div className="flex justify-center p-12">
                  <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
                </div>
              ) : folders.length === 0 ? (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 text-center shadow-sm">
                  <Folder className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                  <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-1">
                    No collections yet
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Create a collection to start saving venues.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {folders.map((folder) => (
                    <Link href={`/collections/${folder.id}`} key={folder.id}>
                      <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 transition-all cursor-pointer h-full flex flex-col justify-between">
                        <div>
                          <div className="flex items-start justify-between mb-4">
                            <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                              <Folder className="w-5 h-5" />
                            </div>
                            <ChevronRight className="w-5 h-5 text-zinc-300 dark:text-zinc-700 group-hover:text-blue-500 transition-colors" />
                          </div>

                          <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-1 group-hover:text-blue-500 transition-colors line-clamp-1">
                            {folder.name}
                          </h3>
                          {folder.description && (
                            <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed">
                              {folder.description}
                            </p>
                          )}
                        </div>

                        <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center gap-4 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                          <span className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-1 rounded-md">
                            <MapPin className="w-3.5 h-3.5 text-blue-500" />
                            {folder._count?.venues || 0} Places
                          </span>
                          <span className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-1 rounded-md">
                            <Users className="w-3.5 h-3.5 text-purple-500" />
                            {folder._count?.members || 1} Members
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )
            ) : // Public Discovery Feed tab
            loadingPublic ? (
              <div className="flex justify-center p-12">
                <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
              </div>
            ) : publicFolders.length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 text-center shadow-sm">
                <Globe className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-1">
                  No public lists yet
                </h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Share your curated workspace list with the community!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {publicFolders.map((pubFolder) => (
                  <Link
                    href={`/collections/${pubFolder.id}`}
                    key={pubFolder.id}
                  >
                    <div className="group bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/5 transition-all cursor-pointer h-full flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-800 shrink-0">
                              {pubFolder.owner?.imageUrl && (
                                <Image
                                  src={pubFolder.owner.imageUrl}
                                  alt={pubFolder.owner.firstName || "User"}
                                  width={24}
                                  height={24}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </div>
                            <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 truncate max-w-[120px]">
                              {pubFolder.owner?.firstName || "Nomad"}
                            </span>
                          </div>
                          <button
                            onClick={(e) => toggleUpvote(pubFolder.id, e)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold transition-all border ${
                              pubFolder.hasUpvoted
                                ? "bg-blue-600 border-blue-600 text-white shadow-sm shadow-blue-500/20 scale-105"
                                : "bg-zinc-50 dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:border-blue-500/40 hover:text-blue-500"
                            }`}
                          >
                            <ThumbsUp
                              className={`w-3.5 h-3.5 ${pubFolder.hasUpvoted ? "fill-current" : ""}`}
                            />
                            {pubFolder.upvotes}
                          </button>
                        </div>

                        <h3 className="text-base font-bold text-zinc-900 dark:text-white mb-1 group-hover:text-blue-500 transition-colors line-clamp-1">
                          {pubFolder.name}
                        </h3>
                        {pubFolder.description && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2 mb-4 leading-relaxed">
                            {pubFolder.description}
                          </p>
                        )}
                      </div>

                      <div className="mt-4 pt-4 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center gap-4 text-[10px] font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                        <span className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-1 rounded-md">
                          <MapPin className="w-3.5 h-3.5 text-blue-500" />
                          {pubFolder._count?.venues || 0} Places
                        </span>
                        <span className="flex items-center gap-1.5 bg-zinc-100 dark:bg-zinc-800/60 px-2 py-1 rounded-md">
                          <Users className="w-3.5 h-3.5 text-purple-500" />
                          {pubFolder._count?.members || 1} Members
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
