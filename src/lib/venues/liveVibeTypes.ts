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

export const VIBE_CONFIG: Record<
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
    description: "Conversations, networking vibe",
  },
];
