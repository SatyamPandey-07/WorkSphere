/**
 * Allowed membership commitments for premium venue access.
 * These are hashes/commits — never raw identity tokens.
 *
 * Override with PREMIUM_MEMBER_COMMITS="commit1,commit2" in env if needed.
 */

import { computeMembershipCommit } from "./commitment";

// Demo members used in local/dev + tests (token values are not stored server-side).
const DEMO_TOKENS = [BigInt(42), BigInt(99), BigInt(123456), BigInt(12345678)];

function defaultCommits(): Set<string> {
  return new Set(DEMO_TOKENS.map((t) => computeMembershipCommit(t)));
}

let cachedCommits: Set<string> | null = null;

export function getAllowedMembershipCommits(): Set<string> {
  if (cachedCommits) return cachedCommits;

  const fromEnv = process.env.PREMIUM_MEMBER_COMMITS;
  cachedCommits =
    fromEnv && fromEnv.trim()
      ? new Set(
          fromEnv
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        )
      : defaultCommits();
  return cachedCommits;
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
