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
 * StudentAccessPass: Anonymous verifiable credential verification circuit (#3959)
 * Proves that a student possesses a valid digital signature/secret registered
 * under an accredited university Merkle root and generates an anonymized nullifier
 * Poseidon(secret, nullifierKey, epoch) to prevent double-claiming student passes
 * without revealing student identity, university email, or real name.
 */
template StudentAccessPass(levels) {
    // ── Public Inputs ──
    signal input root;           // Active University Merkle Root
    signal input epoch;          // Academic Year epoch (e.g. 2026)
    signal input nullifierHash;  // Anonymized unique nullifier = Poseidon(secret, nullifierKey, epoch)

    // ── Private Inputs ──
    signal input secret;                 // Student Identity Secret / Digital Signature credential
    signal input nullifierKey;           // User nullifier derivation secret
    signal input pathElements[levels];   // Sibling hashes along Merkle tree path
    signal input pathIndices[levels];    // Sibling position indices (0 or 1)

    // 1. Verify nullifier hash integrity: Poseidon(secret, nullifierKey, epoch)
    component nullifierHasher = Poseidon(3);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nullifierKey;
    nullifierHasher.inputs[2] <== epoch;
    nullifierHash === nullifierHasher.out;

    // 2. Calculate enrolled leaf commitment: Poseidon(secret, epoch)
    component leafHasher = Poseidon(2);
    leafHasher.inputs[0] <== secret;
    leafHasher.inputs[1] <== epoch;

    signal currentHash[levels + 1];
    currentHash[0] <== leafHasher.out;

    // 3. Verify Merkle membership path up to university root
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

    // 4. Enforce calculated Merkle root matches public university root
    root === currentHash[levels];
}

component main {public [root, epoch, nullifierHash]} = StudentAccessPass(16);
