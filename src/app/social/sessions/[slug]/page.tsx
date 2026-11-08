import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import SessionDetailClient from "@/app/sessions/[slug]/session-detail-client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const session = await prisma.coworkingSession.findUnique({
    where: { slug },
    include: { venue: true },
  });

  if (!session) {
    return { title: "Session not found | WorkSphere Social" };
  }

  return {
    title: `${session.title} | WorkSphere Social`,
    description:
      session.description ||
      `Join a collaborative coworking session at ${session.venue.name}.`,
    openGraph: {
      title: session.title,
      description:
        session.description ||
        `Join a collaborative coworking session at ${session.venue.name}.`,
    },
  };
}

export default async function SocialSessionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const session = await prisma.coworkingSession.findUnique({
    where: { slug },
    include: {
      venue: true,
      host: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      rsvps: {
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              imageUrl: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!session) notFound();

  return <SessionDetailClient session={JSON.parse(JSON.stringify(session))} />;
}
