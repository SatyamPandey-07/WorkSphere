pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

/**
 * DualMux: switches inputs based on selector bit s.
 * s == 0: out[0] = in[0], out[1] = in[1]
 * s == 1: out[0] = in[1], out[1] = in[0]
 *
 * The `s * (1 - s) === 0` constraint proves the selector is a bit, so a prover
 * cannot smuggle a non-boolean value into the Merkle path direction.
 */
template MembershipDualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

/**
 * MembershipVerifier: anonymous paid-membership proof for venue access.
 *
 * Proves:
 *   1. the prover knows `identitySecret`;
 *   2. its leaf commitment Poseidon(identitySecret, epoch) is in the Merkle
 *      tree with the public `root`;
 *   3. the leaf was enrolled for the public `epoch`.
 *
 * Public:  root, epoch
 * Private: identitySecret, pathElements[levels], pathIndices[levels]
 *
 * Nothing identifies the member: the verifier learns only that *some* paid
 * member enrolled in this epoch is presenting the proof. The epoch is bound
 * into the leaf, so a proof generated for an old epoch cannot be replayed
 * against a root that was rebuilt for a newer epoch.
 */
template MembershipVerifier(levels) {
    // ── Public inputs ──
    signal input root;   // active membership Merkle root
    signal input epoch;  // membership epoch (unix seconds, period start)

    // ── Private inputs ──
    signal input identitySecret;         // private member identity secret
    signal input pathElements[levels];   // sibling hashes along the Merkle path
    signal input pathIndices[levels];    // 0 = left child, 1 = right child

    // 1. Leaf commitment: Poseidon(identitySecret, epoch).
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== identitySecret;
    leafHasher.inputs[1] <== epoch;

    signal currentHash[levels + 1];
    currentHash[0] <== leafHasher.out;

    // 2. Climb the Merkle tree to the root.
    component mux[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        mux[i] = MembershipDualMux();
        mux[i].in[0] <== currentHash[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        currentHash[i + 1] <== hashers[i].out;
    }

    // 3. Enforce the computed root matches the published membership root.
    root === currentHash[levels];
}

component main {public [root, epoch]} = MembershipVerifier(16);
