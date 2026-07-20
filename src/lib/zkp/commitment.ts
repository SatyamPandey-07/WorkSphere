/**
 * Commitment binding used by circuits/premium_membership.circom
 * commit = token^2 + 5*token + 17
 *
 * Only the commitment is ever public. The raw identity token stays on-device.
 */

export function computeMembershipCommit(
  identityToken: string | number | bigint,
): string {
  const t = BigInt(identityToken);
  return (t * t + 5n * t + 17n).toString();
}
