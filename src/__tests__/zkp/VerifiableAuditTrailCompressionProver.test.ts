import { describe, it, expect } from 'vitest';
import { VerifiableAuditTrailCompressionProver } from '../../core/zkp/VerifiableAuditTrailCompressionProver';

describe('VerifiableAuditTrailCompressionProver', () => {
  it('seals chained epochs, compresses historical ranges, and proves archived event inclusion', () => {
    const trail = new VerifiableAuditTrailCompressionProver('sec-audit-prod');
    const allEvents = Array.from({ length: 6 }, (_, ep) =>
      Array.from({ length: 4 }, (_, idx) => ({
        eventId: `ep${ep}-ev${idx}`,
        actor: `svc-${idx}`,
        action: 'WRITE_LEDGER',
        timestampMs: 1700000000000 + ep * 10000 + idx * 100,
        payloadHash: `hash-${ep}-${idx}`,
      })),
    );

    for (const batch of allEvents) {
      trail.sealEpoch(batch);
    }
    expect(trail.getEpochCount()).toBe(6);
    expect(trail.verifyEpochChainContinuity()).toBe(true);

    const sumA = trail.compressEpochRange(0, 2);
    const sumB = trail.compressEpochRange(3, 5);
    expect(sumA.totalEventCount).toBe(12);
    expect(sumB.totalEventCount).toBe(12);
    expect(trail.verifySequentialSummaries([sumA, sumB])).toBe(true);

    // Prove event #2 in epoch #4 against compressed summary [3..5]
    const incProof = trail.proveArchivedEventInclusion(3, 5, 4, 2, allEvents[4][2]);
    expect(trail.verifyArchivedEventInclusion(incProof)).toBe(true);

    // Tampered event payload or summary digest must fail
    expect(
      trail.verifyArchivedEventInclusion({
        ...incProof,
        event: { ...incProof.event, action: 'DELETE_LEDGER' },
      }),
    ).toBe(false);
    expect(
      trail.verifyArchivedEventInclusion({
        ...incProof,
        summary: { ...incProof.summary, totalEventCount: 99 },
      }),
    ).toBe(false);

    // Broken sequential summaries must fail
    expect(trail.verifySequentialSummaries([sumA, { ...sumB, entryChainHash: '00'.repeat(32) }])).toBe(false);
    expect(() => trail.sealEpoch([])).toThrow();
    expect(() => trail.compressEpochRange(4, 2)).toThrow();

    const parsed = JSON.parse(trail.serializeSummary(sumA)) as { startEpoch: number; endEpoch: number };
    expect(parsed.startEpoch).toBe(0);
    expect(parsed.endEpoch).toBe(2);
  });
});
