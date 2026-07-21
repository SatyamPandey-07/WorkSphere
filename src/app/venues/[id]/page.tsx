import { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { MapPin, Wifi, Zap, Building2, Coffee, BookOpen } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { TopNav } from "@/components/TopNav";
import SiteFooter from "@/components/site-footer";
import PremiumZkpGate from "@/components/venues/PremiumZkpGate";
import { isPremiumVenue } from "@/lib/zkp/membership";
import { WeatherCloudRenderer } from "@/components/WeatherCloudRenderer";

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const venue = await prisma.venue.findUnique({
    where: { id: params.id },
  });

  if (!venue) {
    return {
      title: "Venue Not Found | WorkSphere",
      description: "The requested venue could not be found.",
    };
  }

  const categoryLabel = venue.category.replace("_", " ");
  const fallbackImage =
    venue.category === "cafe"
      ? "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200"
      : venue.category === "library"
        ? "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=1200"
        : venue.category === "coworking_space"
          ? "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&q=80&w=1200"
          : "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200";

  const imageToUse = venue.imageUrl || fallbackImage;

  return {
    title: `${venue.name} | WorkSphere`,
    description: `Check out ${venue.name}, a ${categoryLabel} perfect for remote work. ${venue.address || ""}`,
    openGraph: {
      title: `${venue.name} | WorkSphere`,
      description: `Check out ${venue.name}, a ${categoryLabel} perfect for remote work. ${venue.address || ""}`,
      images: [{ url: imageToUse, width: 1200, height: 630, alt: venue.name }],
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${venue.name} | WorkSphere`,
      description: `Check out ${venue.name}, a ${categoryLabel} perfect for remote work.`,
      images: [imageToUse],
    },
  };
}

export default async function VenuePage({ params }: PageProps) {
  const venue = await prisma.venue.findUnique({
    where: { id: params.id },
  });

  if (!venue) {
    notFound();
  }

  const CategoryIcon =
    venue.category === "cafe"
      ? Coffee
      : venue.category === "library"
        ? BookOpen
        : venue.category === "coworking_space"
          ? Building2
          : MapPin;

  const fallbackImage =
    venue.category === "cafe"
      ? "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200"
      : venue.category === "library"
        ? "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=1200"
        : venue.category === "coworking_space"
          ? "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&q=80&w=1200"
          : "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200";

  const displayPhoto = venue.imageUrl || fallbackImage;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50 flex flex-col font-sans">
      <TopNav hideAuth />
      <main className="flex-grow flex items-center justify-center p-4">
        <div className="max-w-2xl w-full bg-white dark:bg-zinc-900 rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="relative h-64 sm:h-80 w-full group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={displayPhoto}
              alt={venue.name}
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-6 left-6 right-6 flex items-end justify-between">
              <div>
                <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-widest text-white/90 mb-2 drop-shadow-md">
                  <CategoryIcon className="w-4 h-4" />
                  {venue.category.replace("_", " ")}
                </span>
                <h1 className="text-3xl sm:text-4xl font-black text-white drop-shadow-lg tracking-tight">
                  {venue.name}
                </h1>
              </div>
              {venue.rating && (
                <div className="flex flex-col items-center justify-center h-14 w-14 rounded-full bg-blue-600 text-white border-2 border-blue-400 shadow-2xl shrink-0">
                  <span className="text-[10px] font-black uppercase tracking-tighter">
                    Vibe
                  </span>
                  <span className="text-sm font-black">
                    {Math.round(venue.rating * 10)}%
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="p-6 sm:p-8 space-y-8">
            {venue.address && (
              <div className="flex items-start gap-3">
                <div className="p-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-1">
                    Location
                  </h3>
                  <p className="text-sm sm:text-base font-medium">
                    {venue.address}
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {venue.wifiQuality ? (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                  <div className="p-2 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
                    <Wifi className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      WiFi
                    </h4>
                    <p className="text-sm font-bold">Available</p>
                  </div>
                </div>
              ) : null}
              {venue.hasOutlets ? (
                <div className="flex items-center gap-3 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-100 dark:border-zinc-800">
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Power
                    </h4>
                    <p className="text-sm font-bold">Outlets</p>
                  </div>
                </div>
              ) : null}
            </div>

            {/* Live WebGL 3D Volumetric Cloud Weather Visualizer for Outdoor Workspaces */}
            <div className="pt-2">
              <h3 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                <span>Outdoor Weather Conditions</span>
              </h3>
              <WeatherCloudRenderer
                lat={venue.latitude}
                lng={venue.longitude}
                height="260px"
                interactive={true}
              />
            </div>

            <div className="pt-6 border-t border-zinc-100 dark:border-zinc-800 space-y-4">
              {isPremiumVenue(venue) && (
                <PremiumZkpGate venueId={venue.id} venueName={venue.name} />
              )}
              <Link
                href={`/dashboard?venue=${venue.id}`}
                className="w-full flex items-center justify-center py-4 rounded-2xl accent-bg hover:opacity-90 text-white font-black text-sm uppercase tracking-widest transition-all shadow-xl shadow-[var(--primary-accent)]/20 active:scale-[0.98]"
              >
                Open in WorkSphere
              </Link>
              <Link
                href={`/venues/${venue.id}/navigate`}
                className="w-full flex items-center justify-center py-4 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-white font-black text-sm uppercase tracking-widest transition-all shadow-xl shadow-zinc-800/20 active:scale-[0.98]"
              >
                Start AR Navigation
              </Link>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
