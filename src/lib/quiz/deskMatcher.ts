/**
 * Smart Personalized Desk Matcher Engine
 *
 * Evaluates user work habits, sensory sensitivities, hardware requirements,
 * and seating preferences to generate a tailored Desk Archetype profile
 * with recommended desk types, amenities, and venue filters.
 */

export type PrimaryActivity = "dev" | "calls" | "creative" | "study" | "hybrid";
export type NoisePreference = "silent" | "moderate" | "energetic";
export type HardwareNeed = "dual_monitor" | "standing" | "power_heavy" | "minimal";
export type SeatingPlacement = "phone_booth" | "corner_wall" | "sunlit_window" | "center_island";
export type SessionDuration = "quick_sprint" | "half_day" | "marathon";

export interface QuizAnswers {
  primaryActivity: PrimaryActivity;
  noisePreference: NoisePreference;
  hardwareNeed: HardwareNeed;
  seatingPlacement: SeatingPlacement;
  sessionDuration: SessionDuration;
}

export interface DeskArchetype {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  description: string;
  idealDeskType: "HOT_DESK" | "FIXED_DESK" | "MEETING_ROOM" | "PHONE_BOOTH";
  idealDeskTypeLabel: string;
  recommendedAmenities: string[];
  recommendedAmenitiesLabels: string[];
  idealNoiseLevel: "quiet" | "moderate" | "loud";
  radarScores: {
    focusIndex: number; // 0 - 100
    acousticIsolation: number; // 0 - 100
    hardwareDensity: number; // 0 - 100
    creativeAmbiance: number; // 0 - 100
  };
  searchFilterQuery: string;
  themeColor: {
    badge: string;
    border: string;
    gradient: string;
    text: string;
  };
}

export const DESK_ARCHETYPES: Record<string, DeskArchetype> = {
  cyberpunk: {
    id: "cyberpunk",
    name: "The Deep-Work Cyberpunk",
    tagline: "Ultra-Fast Fiber · Dual Displays · High Power",
    icon: "🚀",
    description:
      "You thrive in relentless deep-focus sprints. You need dedicated dual AC power, an external 4K monitor, and ultra-reliable low-latency Wi-Fi with minimal interruptions.",
    idealDeskType: "FIXED_DESK",
    idealDeskTypeLabel: "Fixed Dedicated Desk with Monitor",
    recommendedAmenities: ["monitor", "power"],
    recommendedAmenitiesLabels: ["External Monitor", "Dedicated Power Outlets", "Ergonomic Lumbar Chair"],
    idealNoiseLevel: "quiet",
    radarScores: {
      focusIndex: 95,
      acousticIsolation: 85,
      hardwareDensity: 98,
      creativeAmbiance: 65,
    },
    searchFilterQuery: "hasOutlets=true&hasErgonomic=true&noiseLevel=quiet",
    themeColor: {
      badge: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
      border: "border-indigo-500/30",
      gradient: "from-indigo-950/60 via-zinc-900 to-zinc-950",
      text: "text-indigo-400",
    },
  },
  presenter: {
    id: "presenter",
    name: "The High-Frequency Communicator",
    tagline: "Soundproof Phone Booth · Glare-Free Lighting",
    icon: "🎙️",
    description:
      "Your day is packed with client pitches, team standups, and stakeholder calls. You require acoustic isolation, rapid audio privacy, and zero background echo.",
    idealDeskType: "PHONE_BOOTH",
    idealDeskTypeLabel: "Acoustic Soundproof Phone Booth",
    recommendedAmenities: ["video-call", "power"],
    recommendedAmenitiesLabels: ["Soundproof Acoustic Pod", "Low-Latency Video Call Wi-Fi", "USB-C Fast Charging"],
    idealNoiseLevel: "quiet",
    radarScores: {
      focusIndex: 88,
      acousticIsolation: 99,
      hardwareDensity: 75,
      creativeAmbiance: 60,
    },
    searchFilterQuery: "hasPhoneBooths=true&wifiQuality=5",
    themeColor: {
      badge: "bg-pink-500/10 text-pink-400 border-pink-500/20",
      border: "border-pink-500/30",
      gradient: "from-pink-950/60 via-zinc-900 to-zinc-950",
      text: "text-pink-400",
    },
  },
  nomad: {
    id: "nomad",
    name: "The Sunlit Artisan",
    tagline: "Natural Light · Specialty Brew · Cozy Ambiance",
    icon: "☕",
    description:
      "Creativity flows best with vibrant ambient energy, a floor-to-ceiling window view, and artisanal pour-over coffee within arm's reach.",
    idealDeskType: "HOT_DESK",
    idealDeskTypeLabel: "Window-Side Hot Desk & Lounge Pod",
    recommendedAmenities: ["power"],
    recommendedAmenitiesLabels: ["Natural Daylight", "Specialty Espresso", "Comfortable Seating"],
    idealNoiseLevel: "moderate",
    radarScores: {
      focusIndex: 78,
      acousticIsolation: 45,
      hardwareDensity: 60,
      creativeAmbiance: 95,
    },
    searchFilterQuery: "category=cafe&singleOriginBeans=true",
    themeColor: {
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      border: "border-amber-500/30",
      gradient: "from-amber-950/60 via-zinc-900 to-zinc-950",
      text: "text-amber-400",
    },
  },
  zen_scholar: {
    id: "zen_scholar",
    name: "The Zen Scholar",
    tagline: "Library Silence · Ergonomic Lumbar · Warm Glow",
    icon: "🧘",
    description:
      "You engage in heavy research, writing, and analytical problem-solving. Pin-drop silence, zero distractions, and an ergonomic posture setup are non-negotiable.",
    idealDeskType: "HOT_DESK",
    idealDeskTypeLabel: "Silent Library Study Carrel",
    recommendedAmenities: ["power"],
    recommendedAmenitiesLabels: ["Silent Study Zone (<35 dB)", "Ergonomic Lumbar Chair", "Warm Glare-Free Ambient Lighting"],
    idealNoiseLevel: "quiet",
    radarScores: {
      focusIndex: 98,
      acousticIsolation: 92,
      hardwareDensity: 70,
      creativeAmbiance: 80,
    },
    searchFilterQuery: "category=library&hasQuietZone=true&noiseLevel=quiet",
    themeColor: {
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      border: "border-emerald-500/30",
      gradient: "from-emerald-950/60 via-zinc-900 to-zinc-950",
      text: "text-emerald-400",
    },
  },
  collaborator: {
    id: "collaborator",
    name: "The Agile Collaborator",
    tagline: "Whiteboard Room · Team Concourse · Shared Island",
    icon: "🤝",
    description:
      "You coordinate cross-functional brainstorms, sprint planning, and pair-programming sessions. You need flexible group seating and whiteboard space.",
    idealDeskType: "MEETING_ROOM",
    idealDeskTypeLabel: "Team Meeting Suite & Whiteboard Pod",
    recommendedAmenities: ["whiteboard", "power", "video-call"],
    recommendedAmenitiesLabels: ["Magnetic Whiteboard", "Conference Screen / TV", "Team Island Seating"],
    idealNoiseLevel: "moderate",
    radarScores: {
      focusIndex: 82,
      acousticIsolation: 70,
      hardwareDensity: 85,
      creativeAmbiance: 90,
    },
    searchFilterQuery: "category=coworking_space&hasPhoneBooths=true",
    themeColor: {
      badge: "bg-violet-500/10 text-violet-400 border-violet-500/20",
      border: "border-violet-500/30",
      gradient: "from-violet-950/60 via-zinc-900 to-zinc-950",
      text: "text-violet-400",
    },
  },
};

/**
 * Calculates the best matching Desk Archetype based on quiz answers.
 */
export function matchDeskArchetype(answers: QuizAnswers): DeskArchetype {
  const scores: Record<string, number> = {
    cyberpunk: 0,
    presenter: 0,
    nomad: 0,
    zen_scholar: 0,
    collaborator: 0,
  };

  // 1. Primary Activity
  if (answers.primaryActivity === "dev") {
    scores.cyberpunk += 45;
    scores.zen_scholar += 15;
  } else if (answers.primaryActivity === "calls") {
    scores.presenter += 50;
    scores.collaborator += 15;
  } else if (answers.primaryActivity === "creative") {
    scores.nomad += 45;
    scores.collaborator += 15;
  } else if (answers.primaryActivity === "study") {
    scores.zen_scholar += 45;
    scores.cyberpunk += 10;
  } else if (answers.primaryActivity === "hybrid") {
    scores.collaborator += 35;
    scores.nomad += 20;
  }

  // 2. Noise Sensitivity
  if (answers.noisePreference === "silent") {
    scores.zen_scholar += 30;
    scores.cyberpunk += 20;
    scores.presenter += 15;
  } else if (answers.noisePreference === "moderate") {
    scores.nomad += 25;
    scores.collaborator += 20;
  } else if (answers.noisePreference === "energetic") {
    scores.collaborator += 30;
    scores.nomad += 20;
  }

  // 3. Hardware Requirements
  if (answers.hardwareNeed === "dual_monitor") {
    scores.cyberpunk += 35;
    scores.collaborator += 15;
  } else if (answers.hardwareNeed === "standing") {
    scores.cyberpunk += 20;
    scores.zen_scholar += 25;
  } else if (answers.hardwareNeed === "power_heavy") {
    scores.cyberpunk += 25;
    scores.presenter += 15;
  } else if (answers.hardwareNeed === "minimal") {
    scores.nomad += 30;
    scores.zen_scholar += 15;
  }

  // 4. Seating Placement
  if (answers.seatingPlacement === "phone_booth") {
    scores.presenter += 35;
  } else if (answers.seatingPlacement === "corner_wall") {
    scores.zen_scholar += 25;
    scores.cyberpunk += 15;
  } else if (answers.seatingPlacement === "sunlit_window") {
    scores.nomad += 35;
  } else if (answers.seatingPlacement === "center_island") {
    scores.collaborator += 30;
  }

  // 5. Session Duration
  if (answers.sessionDuration === "marathon") {
    scores.cyberpunk += 15;
    scores.zen_scholar += 15;
  } else if (answers.sessionDuration === "quick_sprint") {
    scores.nomad += 15;
    scores.presenter += 10;
  }

  // Pick highest scoring archetype
  let bestArchetypeKey = "cyberpunk";
  let maxScore = -1;

  for (const [key, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestArchetypeKey = key;
    }
  }

  return DESK_ARCHETYPES[bestArchetypeKey] || DESK_ARCHETYPES.cyberpunk;
}
