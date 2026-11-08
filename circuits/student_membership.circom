pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";

/**
 * DualMux multiplexer: switches inputs based on selector bit s.
 * If s == 0: out[0] = in[0], out[1] = in[1]
 * If s == 1: out[0] = in[1], out[1] = in[0]
 */
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0]) * s + in[0];
    out[1] <== (in[0] - in[1]) * s + in[1];
}

/**
 * StudentMembership: Depth-16 Zero-Knowledge Merkle Tree Membership Proof
 * Proves that a student possesses a secret enrolled at an accredited university
 * for the given academic year epoch without revealing their identity secret.
 */
template StudentMembership(levels) {
    // ── Public Inputs ──
    signal input root;   // Active University Merkle Root
    signal input epoch;  // Academic Year epoch (e.g., 2026)

    // ── Private Inputs ──
    signal input secret;                 // Student Identity Secret
    signal input pathElements[levels];   // Sibling hashes along Merkle path
    signal input pathIndices[levels];    // 0 = left child, 1 = right child

    // 1. Calculate leaf commitment: Poseidon(secret, epoch)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== secret;
    leafHasher.inputs[1] <== epoch;

    signal currentHash[levels + 1];
    currentHash[0] <== leafHasher.out;

    // 2. Climb the depth-16 Merkle tree
    component mux[levels];
    component hashers[levels];

    for (var i = 0; i < levels; i++) {
        mux[i] = DualMux();
        mux[i].in[0] <== currentHash[i];
        mux[i].in[1] <== pathElements[i];
        mux[i].s <== pathIndices[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== mux[i].out[0];
        hashers[i].inputs[1] <== mux[i].out[1];

        currentHash[i + 1] <== hashers[i].out;
    }

    // 3. Enforce calculated root matches the public Merkle root
    root === currentHash[levels];
}

component main {public [root, epoch]} = StudentMembership(16);
