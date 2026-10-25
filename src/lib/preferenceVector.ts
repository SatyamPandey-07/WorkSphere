import { Venue } from "@/components/chat/ChatMessages";

export interface UserHistoryItem {
  venue: Venue;
  weight: number; // e.g., check-in = 1.0, saved = 1.2, rated 5-star = 1.5
}

export function buildUserPreferenceVector(
  history: UserHistoryItem[] | null | undefined,
): Record<string, number> {
  const aggregated: Record<string, number> = {
    wifi: 0,
    quiet: 0,
    powerOutlets: 0,
    coffee: 0,
    parking: 0,
    meetingRooms: 0,
  };

  if (!Array.isArray(history) || history.length === 0) return aggregated;

  for (const item of history) {
    if (!item || !item.venue) continue;

    const { venue } = item;
    const rawWeight = item.weight;
    // Default to 1.0 if weight is unspecified, and clamp non-finite/negative weights to 0
    const weight =
      rawWeight === undefined
        ? 1.0
        : typeof rawWeight === "number" && Number.isFinite(rawWeight)
          ? Math.max(0, rawWeight)
          : 0;

    if (weight <= 0) continue;

    if (venue.wifi) {
      aggregated.wifi += weight;
    }
    if (venue.noiseLevel === "quiet") {
      aggregated.quiet += weight;
    }
    if (venue.hasOutlets) {
      aggregated.powerOutlets += weight;
    }
    if (
      venue.category?.toLowerCase().includes("coffee") ||
      venue.category?.toLowerCase().includes("cafe") ||
      (venue.name?.toLowerCase().includes("coffee") ?? false)
    ) {
      aggregated.coffee += weight;
    }
  }

  // Normalize
  let maxWeight = 0;
  for (const key in aggregated) {
    if (aggregated[key] > maxWeight) {
      maxWeight = aggregated[key];
    }
  }

  if (maxWeight > 0) {
    for (const key in aggregated) {
      aggregated[key] = aggregated[key] / maxWeight;
    }
  }

  return aggregated;
}
