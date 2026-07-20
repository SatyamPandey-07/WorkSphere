"use client";

import { useState, useEffect } from "react";
import { Briefcase, X } from "lucide-react";

export function WorkStyleProfile() {
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch the saved profile when the dashboard loads
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/user/settings");
        if (res.ok) {
          const data = await res.json();
          if (data.workStyleProfile) {
            setProfile(data.workStyleProfile);
          }
        }
      } catch (error) {
        console.error("Failed to load profile:", error);
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const primary = formData.get("primaryActivity");

    // Logic to assign profile based on first answer
    let result = "Reader";
    if (primary === "coding") result = "Coder";
    if (primary === "meetings") result = "Caller";

    // Optimistically update the UI so it feels instant
    setProfile(result);
    setIsOpen(false);

    // Send the data to the backend API route we just updated
    try {
      const response = await fetch("/api/user/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workStyleProfile: result,
        }),
      });

      if (!response.ok) {
        console.error("Failed to save work style profile");
      }
    } catch (error) {
      console.error("API error:", error);
    }
  };

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Work Style Profile
          </h2>
        </div>
      </div>

      <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-4">
        Current Profile:{" "}
        {isLoading ? (
          <span className="text-zinc-400">Loading...</span>
        ) : (
          <span className="font-bold accent-text">{profile || "Not Set"}</span>
        )}
      </p>

      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 text-sm accent-bg text-white rounded-lg accent-bg-hover transition-colors w-full"
      >
        Discover Your Work Style
      </button>

      {/* The Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 w-full max-w-md relative">
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-xl font-bold mb-4 text-zinc-900 dark:text-white">
              Work Style Quiz
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-700 dark:text-zinc-300">
                  1. What's your primary activity?
                </label>
                <select
                  name="primaryActivity"
                  className="w-full p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent dark:text-white"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select an option
                  </option>
                  <option value="coding">Coding / Development</option>
                  <option value="meetings">Meetings / Calls</option>
                  <option value="studying">Reading / Studying</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-700 dark:text-zinc-300">
                  2. What is your top priority?
                </label>
                <select
                  name="topPriority"
                  className="w-full p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent dark:text-white"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select an option
                  </option>
                  <option value="wifi">High-speed Wi-Fi</option>
                  <option value="quiet">Quiet environment</option>
                  <option value="comfort">Comfortable seating</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1 text-zinc-700 dark:text-zinc-300">
                  3. Do you take a lot of calls?
                </label>
                <select
                  name="calls"
                  className="w-full p-2 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-transparent dark:text-white"
                  required
                  defaultValue=""
                >
                  <option value="" disabled>
                    Select an option
                  </option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>

              <button
                type="submit"
                className="w-full px-4 py-2 mt-4 text-sm accent-bg text-white rounded-lg accent-bg-hover transition-colors"
              >
                Save Profile
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
