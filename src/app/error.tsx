"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error encountered:", error);
  }, [error]);

  return (
    <div className="min-h-screen relative flex items-center justify-center bg-[#050510] text-white overflow-hidden p-4">
      {/* Background neon blur blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-blue-700/10 blur-[130px]" />
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full bg-purple-700/10 blur-[110px]" />
        {/* Grid overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:60px_60px]" />
      </div>

      <div className="relative max-w-md w-full backdrop-blur-xl bg-white/5 border border-white/10 rounded-3xl p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-center">
        {/* Glowing hazard icon container */}
        <div className="relative w-20 h-20 mx-auto mb-8">
          <div className="absolute inset-0 rounded-full bg-amber-500/20 blur-md animate-pulse" />
          <div className="relative w-20 h-20 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shadow-lg shadow-amber-500/10">
            <AlertCircle className="w-10 h-10 text-amber-400" />
          </div>
        </div>

        <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent mb-3">
          Something Went Wrong
        </h1>

        <p className="text-white/60 text-sm leading-relaxed mb-8">
          We encountered an unexpected error while loading this page. Please try reloading or head back home.
        </p>

        {error.digest && (
          <div className="mb-8 px-4 py-2.5 rounded-xl bg-black/40 border border-white/5 text-[11px] font-mono text-white/40 break-all">
            Error Signature: {error.digest}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4.5 justify-center">
          <button
            onClick={reset}
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-semibold hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98] transition-all cursor-pointer group"
          >
            <RefreshCw className="w-4 h-4 group-hover:rotate-180 transition-transform duration-500" />
            Try Again
          </button>

          <Link
            href="/"
            className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-white/90 hover:text-white font-semibold active:scale-[0.98] transition-all"
          >
            <Home className="w-4 h-4" />
            Go Home
          </Link>
        </div>
      </div>
    </div>
  );
}
