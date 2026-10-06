import { prisma } from "@/lib/prisma";

export type VibeType = "silent_focus" | "moderate_buzz" | "lively";

export interface VibeSummary {
  venueId: string;
  currentVibe: VibeType | null;
  label: string;
  emoji: string;
  totalVotes: number;
  verifiedCheckIns: number;
  pulseColor: "emerald" | "amber" | "purple" | "zinc";
  badgeText: string;
  breakdown: {
    silent_focus: number;
    moderate_buzz: number;
    lively: number;
  };
  lastUpdated: string | null;
}

const VIBE_CONFIG: Record<
  VibeType,
  { label: string; emoji: string; pulseColor: "emerald" | "amber" | "purple" }
> = {
  silent_focus: {
    label: "Quiet Focus",
    emoji: "🤫",
    pulseColor: "emerald",
  },
  moderate_buzz: {
    label: "Moderate Buzz",
    emoji: "☕",
    pulseColor: "amber",
  },
  lively: {
    label: "Lively",
    emoji: "🗣️",
    pulseColor: "purple",
  },
};

export const VIBE_OPTIONS: Array<{
  type: VibeType;
  label: string;
  emoji: string;
  description: string;
}> = [
  {
    type: "silent_focus",
    label: "Silent Focus",
    emoji: "🤫",
    description: "Whisper quiet, deep work",
  },
  {
    type: "moderate_buzz",
    label: "Moderate Buzz",
    emoji: "☕",
    description: "Coffee chatter, light background music",
  },
  {
    type: "lively",
    label: "Lively",
    emoji: "🗣️",
    description: "Active collaboration & energetic atmosphere",
  },
];

export const VOTE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Computes aggregated live noise & vibe summary for a venue based on active feedback.
 */
export async function getVenueLiveVibe(venueId: string): Promise<VibeSummary> {
  const now = new Date();

  // Fetch feedbacks that have not expired yet
  const feedbacks = await prisma.venueLiveFeedback.findMany({
    where: {
      venueId,
      expiresAt: {
        gt: now,
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const breakdown = {
    silent_focus: 0,
    moderate_buzz: 0,
    lively: 0,
  };

  let verifiedCheckIns = 0;

  for (const fb of feedbacks) {
    if (fb.vibe in breakdown) {
      breakdown[fb.vibe as VibeType]++;
    }
    if (fb.isVerifiedCheckIn) {
      verifiedCheckIns++;
    }
  }

  const totalVotes = feedbacks.length;

  if (totalVotes === 0) {
    return {
      venueId,
      currentVibe: null,
      label: "No recent live votes",
      emoji: "⚡",
      totalVotes: 0,
      verifiedCheckIns: 0,
      pulseColor: "zinc",
      badgeText: "Live Vibe · Be first to report",
      breakdown,
      lastUpdated: null,
    };
  }

  // Determine dominant vibe. Ties stay contested instead of silently
  // crowning whichever entry the object order puts first.
  let dominantVibe: VibeType = "silent_focus";
  let maxCount = -1;
  let leaders = 0;

  for (const [key, count] of Object.entries(breakdown)) {
    if (count > maxCount) {
      maxCount = count;
      dominantVibe = key as VibeType;
      leaders = 1;
    } else if (count === maxCount) {
      leaders += 1;
    }
  }

  if (leaders !== 1) {
    return {
      venueId,
      currentVibe: null,
      label: "Mixed vibes",
      emoji: "⚡",
      totalVotes,
      verifiedCheckIns,
      pulseColor: "zinc",
      badgeText: "Live Vibe · Mixed votes",
      breakdown,
      lastUpdated: new Date().toISOString(),
    };
  }

  const config = VIBE_CONFIG[dominantVibe];
  const badgeText = verifiedCheckIns > 0
    ? `Currently: ${config.label} · ${verifiedCheckIns} verified check-in${verifiedCheckIns > 1 ? "s" : ""}`
    : `Currently: ${config.label} · ${totalVotes} vote${totalVotes > 1 ? "s" : ""}`;

  return {
    venueId,
    currentVibe: dominantVibe,
    label: config.label,
    emoji: config.emoji,
    totalVotes,
    verifiedCheckIns,
    pulseColor: config.pulseColor,
    badgeText,
    breakdown,
    lastUpdated: feedbacks[0]?.createdAt.toISOString() ?? null,
  };
}

/**
 * Records a 1-tap live vibe vote with a 2-hour TTL.
 */
export async function recordVenueLiveVibe(
  venueId: string,
  vibe: VibeType,
  userId?: string | null,
): Promise<VibeSummary> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + VOTE_TTL_MS);

  let isVerifiedCheckIn = false;

  if (userId) {
    // Check if user has an active check-in or confirmed booking today
    const todayStr = now.toISOString().slice(0, 10);
    const [recentCheckIn, activeBooking] = await Promise.all([
      prisma.checkIn.findFirst({
        where: {
          venueId,
          userId,
          createdAt: {
            gte: new Date(now.getTime() - 8 * 60 * 60 * 1000), // Within last 8 hours
          },
        },
      }),
      prisma.booking.findFirst({
        where: {
          venueId,
          userId,
          date: todayStr,
          status: { in: ["CONFIRMED", "CHECKED_IN"] },
        },
      }),
    ]);

    if (recentCheckIn || activeBooking) {
      isVerifiedCheckIn = true;
    }
  }

  await prisma.venueLiveFeedback.create({
    data: {
      venueId,
      userId: userId || null,
      vibe,
      isVerifiedCheckIn,
      expiresAt,
    },
  });

  return getVenueLiveVibe(venueId);
}
