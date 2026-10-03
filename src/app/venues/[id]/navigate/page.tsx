import NavigationContainer from "@/components/ar/NavigationContainer";
import { prisma } from "@/lib/prisma";

export default async function ARNavigatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: venueId } = await params;

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: { id: true, name: true, latitude: true, longitude: true },
  });

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-8 max-w-7xl mx-auto w-full relative">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Venue Navigation</h1>
          <p className="text-slate-400">
            Find your way indoors{venue?.name ? ` • ${venue.name}` : ""}
          </p>
        </div>
      </div>

      <div className="flex-1 relative rounded-xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 flex items-center justify-center">
        <NavigationContainer venueId={venueId} venue={venue} />
      </div>
    </div>
  );
}
