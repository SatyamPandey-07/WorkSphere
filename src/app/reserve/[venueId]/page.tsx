import { auth } from "@clerk/nextjs/server";
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import ReservationClient from "./reservation-client";

export const metadata = {
  title: "Reserve a workspace | WorkSphere",
};

export default async function ReservationPage({
  params,
}: {
  params: Promise<{ venueId: string }>;
}) {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  const { venueId } = await params;

  const venue = await prisma.venue.findUnique({
    where: { id: venueId },
    select: {
      id: true,
      name: true,
      address: true,
      category: true,
    },
  });

  if (!venue) notFound();

  return <ReservationClient venue={venue} />;
}
