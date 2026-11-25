pragma circom 2.0.0;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/poseidon.circom";

/**
 * GigabitNetworkVerifier Circuit
 *
 * Verifies zero-knowledge venue network quality claims for the "Gigabit Verified" badge.
 *
 * Requirements:
 * 1. Average download speed is strictly greater than 1000 Mbps.
 *    (Scaled by 100: sum(downloadSpeedsScaled) > sampleCount * minAverageSpeedScaled)
 * 2. Packet loss is strictly less than 0.1%.
 *    (Scaled by 10,000 where 100% = 1,000,000, 0.1% = 1,000:
 *     sum(packetLossPpm) < sampleCount * maxPacketLossPpm)
 * 3. Binds private telemetry to an anonymized commitment without leaking raw measurements.
 *
 * Public Inputs:
 * - minAverageSpeedScaled: integer threshold for download speed (e.g., 100,000 for 1000.00 Mbps)
 * - maxPacketLossPpm: integer threshold for packet loss (e.g., 1,000 for 0.1% = 1000 ppm)
 * - venueNonceCommitment: binding commitment Poseidon(venueIdHash, salt)
 *
 * Private Inputs:
 * - downloadSpeedsScaled[n]: array of download speeds in Mbps * 100
 * - packetLossPpm[n]: array of packet loss in parts-per-million (0.01% = 100 ppm)
 * - venueIdHash: numeric hash of venue identifier
 * - measurementSalt: private salt to protect telemetry confidentiality
 */
template GigabitNetworkVerifier(n) {
    // ── Public Inputs ──
    signal input minAverageSpeedScaled; // e.g. 100000 for 1000.00 Mbps
    signal input maxPacketLossPpm;       // e.g. 1000 for 0.1000%
    signal input venueNonceCommitment;   // Poseidon(venueIdHash, measurementSalt)

    // ── Private Witness ──
    signal input downloadSpeedsScaled[n]; // Each measurement scaled by 100 (e.g., 105020 = 1050.20 Mbps)
    signal input packetLossPpm[n];        // Each measurement in ppm (e.g., 50 = 0.0050%)
    signal input venueIdHash;
    signal input measurementSalt;

    // 1. Verify Commitment Integrity
    component commitmentHasher = Poseidon(2);
    commitmentHasher.inputs[0] <== venueIdHash;
    commitmentHasher.inputs[1] <== measurementSalt;
    venueNonceCommitment === commitmentHasher.out;

    // 2. Accumulate measurements using integer arithmetic
    signal speedSum[n + 1];
    signal lossSum[n + 1];
    speedSum[0] <== 0;
    lossSum[0] <== 0;

    for (var i = 0; i < n; i++) {
        speedSum[i + 1] <== speedSum[i] + downloadSpeedsScaled[i];
        lossSum[i + 1] <== lossSum[i] + packetLossPpm[i];
    }

    // 3. Strict Download Speed Constraint: average > minAverageSpeedScaled
    // speedSum[n] / n > minAverageSpeedScaled <=> speedSum[n] > n * minAverageSpeedScaled
    signal requiredTotalSpeed;
    requiredTotalSpeed <== n * minAverageSpeedScaled;

    // 32-bit comparator supports up to ~4.29 billion, ample for n * 100,000
    component speedGt = GreaterThan(32);
    speedGt.in[0] <== speedSum[n];
    speedGt.in[1] <== requiredTotalSpeed;
    speedGt.out === 1;

    // 4. Strict Packet Loss Constraint: average < maxPacketLossPpm
    // lossSum[n] / n < maxPacketLossPpm <=> lossSum[n] < n * maxPacketLossPpm
    signal maxAllowedTotalLoss;
    maxAllowedTotalLoss <== n * maxPacketLossPpm;

    component lossLt = LessThan(32);
    lossLt.in[0] <== lossSum[n];
    lossLt.in[1] <== maxAllowedTotalLoss;
    lossLt.out === 1;
}

component main {
    public [
        minAverageSpeedScaled,
        maxPacketLossPpm,
        venueNonceCommitment
    ]
} = GigabitNetworkVerifier(5);
