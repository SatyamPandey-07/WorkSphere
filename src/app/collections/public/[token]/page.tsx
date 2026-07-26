import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Wifi, Zap, Globe, ArrowLeft, Star, Coffee, Building2, BookOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface PublicCollectionPageProps {
  params: Promise<{ token: string }>;
}

export default async function PublicCollectionPage({ params }: PublicCollectionPageProps) {
  const { token } = await params;

  const folder = await prisma.folder.findUnique({
    where: { inviteToken: token },
    include: {
      venues: {
        include: {
          venue: true,
        },
      },
      owner: {
        select: {
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  if (!folder || !folder.isPublic) {
    notFound();
  }

  const categoryIcons: Record<string, React.ReactNode> = {
    cafe: <Coffee className="w-4 h-4 text-amber-400" />,
    coworking: <Building2 className="w-4 h-4 text-indigo-400" />,
    library: <BookOpen className="w-4 h-4 text-emerald-400" />,
  };

  const categoryIcons: Record<string, React.ReactNode> = {
    cafe: <Coffee className="w-4 h-4 text-amber-400" />,
    coworking: <Building2 className="w-4 h-4 text-indigo-400" />,
    library: <BookOpen className="w-4 h-4 text-emerald-400" />,
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6 sm:p-10">
      <div className="max-w-6xl mx-auto space-y-10">
        
        {/* Navigation back home */}
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to WorkSphere Map
        </Link>

        {/* Curator banner */}
        <div className="p-8 rounded-3xl bg-gradient-to-r from-indigo-950/40 via-zinc-900/60 to-zinc-900/40 border border-zinc-800/80 backdrop-blur-md relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -z-10" />
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-xs font-semibold text-indigo-400">
              <Globe className="w-3.5 h-3.5" />
              Shared Curated Collection
            </span>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              {folder.name}
            </h1>
            {folder.description && (
              <p className="text-zinc-400 max-w-2xl text-sm sm:text-base leading-relaxed">
                {folder.description}
              </p>
            )}
            <div className="pt-2 text-xs text-zinc-500 flex items-center gap-2">
              <span>Curated by</span>
              <span className="font-bold text-zinc-300">
                {folder.owner.firstName || "Nomad"} {folder.owner.lastName || "Scout"}
              </span>
              <span>•</span>
              <span>{folder.venues.length} Workspaces</span>
            </div>
          </div>
        </div>

        {/* Venues Grid */}
        <div className="space-y-6">
          <h2 className="text-lg font-bold tracking-wider text-zinc-400 uppercase">
            Curated Workspaces
          </h2>

          {folder.venues.length === 0 ? (
            <div className="p-12 text-center border border-dashed border-zinc-850 rounded-2xl bg-zinc-900/20">
              <MapPin className="w-8 h-8 text-zinc-600 mx-auto mb-3 animate-pulse" />
              <p className="text-sm font-semibold text-zinc-400">No workspaces added yet</p>
              <p className="text-xs text-zinc-500 mt-1">Check back later for updates.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {folder.venues.map((fv) => {
                const { venue } = fv;
                return (
                  <div
                    key={fv.id}
                    className="flex flex-col p-6 rounded-2xl bg-zinc-900/30 border border-zinc-900 hover:border-zinc-800 transition-all hover:scale-[1.01] duration-200 shadow-xl group justify-between"
                  >
                    <div>
                      {/* Title block */}
                      <div className="flex justify-between items-start gap-3 mb-3">
                        <h3 className="font-bold text-lg text-white group-hover:text-indigo-400 transition-colors truncate" title={venue.name}>
                          {venue.name}
                        </h3>
                        {venue.rating && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-xs font-semibold text-amber-400 shrink-0">
                            <Star className="w-3 h-3 fill-amber-400" />
                            {venue.rating.toFixed(1)}
                          </div>
                        )}
                      </div>

                      {/* Category and Address */}
                      <div className="flex items-center gap-2 mb-4">
                        <span className="p-1.5 rounded-lg bg-zinc-800 border border-zinc-700 inline-flex">
                          {categoryIcons[venue.category] || <MapPin className="w-4 h-4 text-zinc-400" />}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          {venue.category}
                        </span>
                      </div>

                      {venue.address && (
                        <p className="text-xs text-zinc-400 leading-relaxed mb-6 flex items-start gap-2">
                          <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                          <span>{venue.address}</span>
                        </p>
                      )}
                    </div>

                    {/* Stats/Metrics Block */}
                    <div className="grid grid-cols-3 gap-2 p-3 bg-zinc-950/60 rounded-xl border border-zinc-900 text-center text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      <div className="flex flex-col items-center justify-center p-1.5 border-r border-zinc-900 gap-1">
                        <Wifi className="w-3.5 h-3.5 text-blue-400" />
                        <span>WiFi {venue.wifiQuality ? `${venue.wifiQuality}/5` : "N/A"}</span>
                      </div>
                      <div className="flex flex-col items-center justify-center p-1.5 border-r border-zinc-900 gap-1">
                        <Zap className="w-3.5 h-3.5 text-yellow-400" />
                        <span>Power {venue.hasOutlets ? "Yes" : "No"}</span>
                      </div>
                      <div className="flex flex-col items-center justify-center p-1.5 gap-1">
                        <span className="text-emerald-400 text-xs">🔇</span>
                        <span className="truncate max-w-full">{venue.noiseLevel || "Normal"}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
