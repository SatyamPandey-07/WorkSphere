import { notFound, redirect } from "next/navigation";
import { decryptShareToken } from "@/lib/shareToken";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";
import { importCollection } from "@/lib/collections";
import Image from "next/image";
import Link from "next/link";
import { MapPin, Download } from "lucide-react";

export default async function PublicCollectionPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const payload = decryptShareToken(token);
  if (!payload || !payload.collectionId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-bold mb-2">Invalid Share Link</h1>
        <p className="text-zinc-500 mb-4">
          This link is either broken or has expired.
        </p>
        <Link href="/" className="text-blue-500 hover:underline">
          Return Home
        </Link>
      </div>
    );
  }

  const folder = await prisma.folder.findUnique({
    where: { id: payload.collectionId },
    include: {
      venues: {
        include: {
          venue: true,
          addedBy: true,
        },
      },
    },
  });

  if (!folder) {
    notFound();
  }

  async function handleImport() {
    "use server";
    const { userId } = await auth();
    if (!userId) {
      // Just redirect to sign-in. Clerk will handle auth.
      redirect("/sign-in");
    }

    await importCollection(folder!.id, userId);
    redirect("/collections");
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 lg:p-8 pt-8">
      <div className="max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {folder.name}
            </h1>
            {folder.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {folder.description}
              </p>
            )}
          </div>

          <form action={handleImport}>
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
            >
              <Download className="w-4 h-4" />
              Import Collection
            </button>
          </form>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {folder.venues.map((fv) => (
            <div
              key={fv.id}
              className="flex gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm relative group"
            >
              <div className="w-24 h-24 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">
                {fv.venue.imageUrl ? (
                  <Image
                    src={fv.venue.imageUrl}
                    alt={fv.venue.name}
                    width={96}
                    height={96}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-400">
                    <MapPin className="w-8 h-8" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  className="text-lg font-bold text-zinc-900 dark:text-white mb-1 truncate"
                  title={fv.venue.name}
                >
                  {fv.venue.name}
                </h3>
                <p className="text-sm text-zinc-500 line-clamp-1">
                  {fv.venue.address}
                </p>
                <div className="mt-2 text-xs text-zinc-400 flex items-center gap-2">
                  Added by {fv.addedBy?.firstName || "Unknown"}
                </div>
              </div>
            </div>
          ))}
          {folder.venues.length === 0 && (
            <div className="col-span-full p-8 text-center text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-700 rounded-2xl">
              This collection is empty.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
