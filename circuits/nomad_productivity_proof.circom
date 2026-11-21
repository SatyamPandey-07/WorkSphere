pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * Nomad productivity proof.
 *
 * Public inputs:
 *   minThresholdStreak
 *   minThresholdHours
 *   epoch
 *   expectedCommitment
 *
 * Private inputs:
 *   identitySecret
 *   actualStreakDays
 *   actualWorkMinutes
 *
 * Public output:
 *   nullifierHash
 *
 * The public commitment binds the identity and both activity counters.
 */

template NomadProductivityProof() {
    signal input minThresholdStreak;
    signal input minThresholdHours;
    signal input epoch;
    signal input expectedCommitment;

    signal input identitySecret;
    signal input actualStreakDays;
    signal input actualWorkMinutes;

    signal output nullifierHash;

    // Bound private counters to the comparator's supported ranges.
    component streakBits = Num2Bits(16);
    streakBits.in <== actualStreakDays;

    component workMinuteBits = Num2Bits(32);
    workMinuteBits.in <== actualWorkMinutes;

    // Identity commitment: Poseidon(identitySecret, epoch).
    component identityHasher = Poseidon(2);
    identityHasher.inputs[0] <== identitySecret;
    identityHasher.inputs[1] <== epoch;

    // Activity-bound commitment:
    // Poseidon(identityCommitment, actualStreakDays, actualWorkMinutes).
    component activityHasher = Poseidon(3);
    activityHasher.inputs[0] <== identityHasher.out;
    activityHasher.inputs[1] <== actualStreakDays;
    activityHasher.inputs[2] <== actualWorkMinutes;

    expectedCommitment === activityHasher.out;

    // Epoch-scoped nullifier.
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== identitySecret;
    nullifierHasher.inputs[1] <== epoch + 42;

    nullifierHash <== nullifierHasher.out;

    // Verify the productivity thresholds.
    component streakComparator = GreaterEqThan(16);
    streakComparator.in[0] <== actualStreakDays;
    streakComparator.in[1] <== minThresholdStreak;
    streakComparator.out === 1;

    component hoursComparator = GreaterEqThan(32);
    hoursComparator.in[0] <== actualWorkMinutes;
    hoursComparator.in[1] <== minThresholdHours * 60;
    hoursComparator.out === 1;
}

component main {
    public [
        minThresholdStreak,
        minThresholdHours,
        epoch,
        expectedCommitment
    ]
} = NomadProductivityProof();