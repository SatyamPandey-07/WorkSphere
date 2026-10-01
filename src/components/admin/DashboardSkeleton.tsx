import { Skeleton } from "@/components/ui/skeleton";

export function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64 bg-zinc-800" />
          <Skeleton className="h-4 w-96 bg-zinc-800" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-28 rounded-lg bg-zinc-800" />
          <Skeleton className="h-10 w-28 rounded-lg bg-zinc-800" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-3"
          >
            <Skeleton className="h-4 w-24 bg-zinc-800" />
            <Skeleton className="h-8 w-32 bg-zinc-800" />
            <Skeleton className="h-3 w-40 bg-zinc-800" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-4">
          <Skeleton className="h-6 w-48 bg-zinc-800" />
          <Skeleton className="h-64 w-full bg-zinc-800 rounded-lg" />
        </div>
        <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-4">
          <Skeleton className="h-6 w-48 bg-zinc-800" />
          <Skeleton className="h-64 w-full bg-zinc-800 rounded-lg" />
        </div>
      </div>

      <div className="p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 space-y-4">
        <Skeleton className="h-6 w-48 bg-zinc-800" />
        <Skeleton className="h-48 w-full bg-zinc-800 rounded-lg" />
      </div>
    </div>
  );
}

export default DashboardSkeleton;
