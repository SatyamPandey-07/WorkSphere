pragma circom 2.0.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * Deep Work Productivity Proof
 *
 * Public:
 *   sessionIdField
 *   durationMinutes
 *   focusThresholdPercentage
 *   activityCommitment
 *
 * Private:
 *   activeSeconds
 *   cadenceHash
 *   cadenceHashInverse
 *
 * Proves that the supplied active duration satisfies the requested
 * focus threshold and binds the private activity values to the session.
 *
 * This circuit does not independently attest that browser telemetry
 * represents genuine human activity.
 */

template DeepWorkProductivityProof() {
    // Public signals
    signal input sessionIdField;
    signal input durationMinutes;
    signal input focusThresholdPercentage;
    signal input activityCommitment;

    // Private witness
    signal input activeSeconds;
    signal input cadenceHash;
    signal input cadenceHashInverse;

    // Duration must be between 1 and 1440 minutes.
    component durationBits = Num2Bits(11);
    durationBits.in <== durationMinutes;

    component durationMinimum = GreaterEqThan(11);
    durationMinimum.in[0] <== durationMinutes;
    durationMinimum.in[1] <== 1;
    durationMinimum.out === 1;

    component durationMaximum = GreaterEqThan(11);
    durationMaximum.in[0] <== 1440;
    durationMaximum.in[1] <== durationMinutes;
    durationMaximum.out === 1;

    // Focus threshold must be between 1% and 100%.
    component thresholdBits = Num2Bits(7);
    thresholdBits.in <== focusThresholdPercentage;

    component thresholdMinimum = GreaterEqThan(7);
    thresholdMinimum.in[0] <== focusThresholdPercentage;
    thresholdMinimum.in[1] <== 1;
    thresholdMinimum.out === 1;

    component thresholdMaximum = GreaterEqThan(7);
    thresholdMaximum.in[0] <== 100;
    thresholdMaximum.in[1] <== focusThresholdPercentage;
    thresholdMaximum.out === 1;

    // Active seconds must be within the session duration.
    component activeBits = Num2Bits(17);
    activeBits.in <== activeSeconds;

    signal maximumActiveSeconds;
    maximumActiveSeconds <== durationMinutes * 60;

    component activeDurationCheck = GreaterEqThan(17);
    activeDurationCheck.in[0] <== maximumActiveSeconds;
    activeDurationCheck.in[1] <== activeSeconds;
    activeDurationCheck.out === 1;

    // Verify the requested focus threshold.
    signal actualPercentageScaled;
    signal requiredPercentageScaled;

    actualPercentageScaled <== activeSeconds * 100;
    requiredPercentageScaled <==
        durationMinutes * 60 * focusThresholdPercentage;

    component focusCheck = GreaterEqThan(24);
    focusCheck.in[0] <== actualPercentageScaled;
    focusCheck.in[1] <== requiredPercentageScaled;
    focusCheck.out === 1;

    // Cadence hash must be a nonzero 32-bit value.
    component cadenceBits = Num2Bits(32);
    cadenceBits.in <== cadenceHash;

    cadenceHash * cadenceHashInverse === 1;

    // Bind private activity values together.
    component activityHasher = Poseidon(2);
    activityHasher.inputs[0] <== activeSeconds;
    activityHasher.inputs[1] <== cadenceHash;

    // Bind the activity commitment to the session and duration.
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs[0] <== sessionIdField;
    commitmentHasher.inputs[1] <== durationMinutes;
    commitmentHasher.inputs[2] <== activityHasher.out;

    activityCommitment === commitmentHasher.out;
}

component main {
    public [
        sessionIdField,
        durationMinutes,
        focusThresholdPercentage,
        activityCommitment
    ]
} = DeepWorkProductivityProof();