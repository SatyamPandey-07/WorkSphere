/**
 * Commitment binding used by circuits/premium_membership.circom
 * commit = Poseidon(identityToken)
 *
 * The circuit constrains `expectedCommit === Poseidon(1)(identityToken)`, so this
 * function MUST produce the identical BN254 Poseidon hash. Only the commitment is
 * ever public. The raw identity token stays on-device.
 *
 * Note: the previous binding (token^2 + 5*token + 17) was a quadratic that anyone
 * could invert to recover the token from the public commitment.
 */

import { poseidonHash } from "./poseidon";

export function computeMembershipCommit(
  identityToken: string | number | bigint,
): string {
  return poseidonHash([BigInt(identityToken)]).toString();
}
