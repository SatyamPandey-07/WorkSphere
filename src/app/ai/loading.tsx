import { Loader2, Map, MessageSquare } from "lucide-react";

export default function AILoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-900 dark:to-zinc-950">
      <div className="flex flex-col items-center gap-6">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-600" />
          </div>
          <div className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Map className="w-4 h-4 text-green-600" />
          </div>
          <div className="absolute -bottom-1 -left-1 w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-purple-600" />
          </div>
        </div>
        <div className="text-center">
          <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
            Loading WorkSphere AI
          </h2>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm mt-1">
            Preparing your workspace finder...
          </p>
        </div>
      </div>
    </div>
  );
}
