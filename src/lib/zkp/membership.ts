/**
 * Allowed membership commitments for premium venue access.
 * These are hashes/commits — never raw identity tokens.
 *
 * Override with PREMIUM_MEMBER_COMMITS="commit1,commit2" in env if needed.
 */

import { computeMembershipCommit } from "./commitment";

// Demo members used in local/dev + tests (token values are not stored server-side).
const DEMO_TOKENS = [BigInt(42), BigInt(99), BigInt(123456)];

function defaultCommits(): Set<string> {
  return new Set(DEMO_TOKENS.map((t) => computeMembershipCommit(t)));
}

export function getAllowedMembershipCommits(): Set<string> {
  const fromEnv = process.env.PREMIUM_MEMBER_COMMITS;
  if (fromEnv && fromEnv.trim()) {
    return new Set(
      fromEnv
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  return defaultCommits();
}

export function isAllowedCommit(commit: string): boolean {
  return getAllowedMembershipCommits().has(commit);
}

/** coworking spaces count as premium for the ZKP gate */
export function isPremiumVenue(venue: {
  category: string;
  rating?: number | null;
}): boolean {
  return (
    venue.category === "coworking_space" ||
    venue.category === "coworking" ||
    (typeof venue.rating === "number" && venue.rating >= 4.5)
  );
}
