import { Loader2, BarChart3 } from "lucide-react";

export default function DashboardLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-full accent-bg-10 accent-bg-dark-10 flex items-center justify-center">
          <BarChart3 className="w-8 h-8 accent-text animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <Loader2 className="w-5 h-5 animate-spin accent-text" />
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            Loading dashboard...
          </p>
        </div>
      </div>
    </div>
  );
}
