"use client";

import Link from "next/link";
import { WifiOff, RefreshCw, Home, MapPin, Clock, ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";

export default function OfflinePage() {
  const [isRetrying, setIsRetrying] = useState(false);
  const [lastOnline, setLastOnline] = useState<string | null>(null);

  useEffect(() => {
    // Check when we last had connection
    const stored = localStorage.getItem("lastOnline");
    if (stored) {
      const date = new Date(stored);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) {
        setLastOnline("just now");
      } else if (diffMins < 60) {
        setLastOnline(`${diffMins} minute${diffMins > 1 ? "s" : ""} ago`);
      } else {
        const diffHours = Math.floor(diffMins / 60);
        setLastOnline(`${diffHours} hour${diffHours > 1 ? "s" : ""} ago`);
      }
    }
  }, []);

  const handleRetry = async () => {
    setIsRetrying(true);
    
    // Try to fetch to check connection
    try {
      await fetch("/api/location", { method: "HEAD" });
      // If successful, reload the page
      window.location.href = "/ai";
    } catch {
      // Still offline
      setTimeout(() => setIsRetrying(false), 1500);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 via-orange-50/30 to-zinc-50 dark:from-black dark:via-orange-950/10 dark:to-black p-4">
      {/* Background Elements */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 -left-32 w-96 h-96 bg-orange-400/10 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 -right-32 w-80 h-80 bg-amber-400/10 rounded-full blur-3xl" />
      </div>

      <div className="text-center max-w-md">
        {/* Icon with animation */}
        <div className="relative mb-8">
          <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center shadow-xl shadow-orange-500/20">
            <WifiOff className="w-12 h-12 text-white" />
          </div>
          <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shadow-lg animate-bounce">
            <span className="text-white text-lg font-bold">!</span>
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-3">
          You&apos;re Offline
        </h1>
        
        <p className="text-lg text-zinc-600 dark:text-zinc-400 mb-4">
          WorkSphere needs an internet connection to find workspaces near you.
        </p>

        {lastOnline && (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-600 dark:text-zinc-400 mb-8">
            <Clock className="w-4 h-4" />
            Last connected: {lastOnline}
          </div>
        )}
        
        <div className="space-y-4">
          <button
            onClick={handleRetry}
            disabled={isRetrying}
            className="group w-full px-6 py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold rounded-2xl hover:shadow-lg hover:shadow-blue-500/25 transition-all disabled:opacity-70 flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-5 h-5 ${isRetrying ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-500"}`} />
            {isRetrying ? "Checking connection..." : "Try Again"}
          </button>

          <Link
            href="/"
            className="group w-full px-6 py-4 border-2 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-semibold rounded-2xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-all flex items-center justify-center gap-2"
          >
            <Home className="w-5 h-5" />
            Back to Home
          </Link>
        </div>

        {/* Offline Features Section */}
        <div className="mt-10 pt-8 border-t border-zinc-200 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-4">
            What you can still do offline:
          </h2>
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/50 dark:bg-zinc-900/50 border border-zinc-200/50 dark:border-zinc-800/50">
              <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div className="text-left">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">View Saved Venues</p>
                <p className="text-xs text-zinc-500">Your previously searched locations</p>
              </div>
              <ArrowRight className="w-4 h-4 text-zinc-400 ml-auto" />
            </div>
          </div>
        </div>
        
        <p className="text-xs text-zinc-500 mt-6">
          WorkSphere works best with an internet connection for real-time workspace data.
        </p>
      </div>
    </div>
  );
}
