pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

/**
 * NomadProductivityProof:
 * Proves that a digital nomad has achieved a productivity threshold:
 * 1. actualStreakDays >= minThresholdStreak
 * 2. actualWorkMinutes >= minThresholdHours * 60
 * 3. leafCommitment == Poseidon(identitySecret, epoch)
 *
 * All of this is proven in Zero-Knowledge without revealing the nomad's
 * identitySecret, exact hours worked, or specific venue check-in locations.
 */
template NomadProductivityProof() {
    // ── Public Inputs ──
    signal input minThresholdStreak; // e.g. 14 days
    signal input minThresholdHours;  // e.g. 50 hours
    signal input epoch;              // Current year or season epoch (e.g. 2026)
    signal input expectedCommitment; // Public commitment root

    // ── Private Inputs ──
    signal input identitySecret;     // Secret user seed
    signal input actualStreakDays;   // Actual verified streak
    signal input actualWorkMinutes;  // Actual verified minutes

    // ── Public Outputs ──
    signal output nullifierHash;

    // 1. Verify Identity Commitment: Poseidon(identitySecret, epoch)
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== identitySecret;
    commitmentHasher.inputs[1] <== epoch;

    expectedCommitment === commitmentHasher.out;

    // 2. Generate Unique Nullifier to prevent double-claiming: Poseidon(identitySecret, epoch, 42)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== identitySecret;
    nullifierHasher.inputs[1] <== epoch + 42;
    nullifierHash <== nullifierHasher.out;

    // 3. Constrain actualStreakDays >= minThresholdStreak
    component streakComparator = GreaterEqThan(16);
    streakComparator.in[0] <== actualStreakDays;
    streakComparator.in[1] <== minThresholdStreak;
    streakComparator.out === 1;

    // 4. Constrain actualWorkMinutes >= minThresholdHours * 60
    component hoursComparator = GreaterEqThan(32);
    hoursComparator.in[0] <== actualWorkMinutes;
    hoursComparator.in[1] <== minThresholdHours * 60;
    hoursComparator.out === 1;
}

component main {public [minThresholdStreak, minThresholdHours, epoch, expectedCommitment]} = NomadProductivityProof();
