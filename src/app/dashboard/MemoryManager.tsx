"use client";

import { useState, useEffect } from "react";
import { BrainCircuit, Trash2, AlertCircle } from "lucide-react";

interface Memory {
  id: string;
  content: string;
  createdAt: string;
}

export function MemoryManager() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/memory");
      if (!res.ok) throw new Error("Failed to fetch memories");
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMemories();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this memory?")) return;
    try {
      const res = await fetch(`/api/memory?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchMemories();
    } catch (err) {
      console.error(err);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("Are you sure you want to clear all your AI memory? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/memory?clearAll=true", { method: "DELETE" });
      if (res.ok) fetchMemories();
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div className="p-6 text-sm text-zinc-500">Loading AI Memory...</div>;
  }

  return (
    <div className="mt-6 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            AI Memory Management
          </h2>
        </div>
        {memories.length > 0 && (
          <button
            onClick={handleClearAll}
            className="text-sm px-3 py-1.5 text-red-600 bg-red-50 dark:bg-red-900/20 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-900/20 rounded-lg">
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}

      {memories.length === 0 ? (
        <div className="text-center py-8 text-zinc-500 dark:text-zinc-400 text-sm">
          No memories recorded yet. The AI will learn your preferences as you chat.
        </div>
      ) : (
        <div className="space-y-3">
          {memories.map((memory) => (
            <div
              key={memory.id}
              className="flex items-start justify-between p-4 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg group"
            >
              <div>
                <p className="text-zinc-900 dark:text-zinc-100 text-sm font-medium">
                  {memory.content}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Learned on {new Date(memory.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                onClick={() => handleDelete(memory.id)}
                className="opacity-0 group-hover:opacity-100 p-2 text-zinc-400 hover:text-red-600 transition-all"
                title="Delete memory"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
