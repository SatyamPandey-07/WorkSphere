import { describe, it, expect } from 'vitest';
import { VerifiableThresholdSignatureRoster, SUBGROUP_Q } from '../../core/zkp/VerifiableThresholdSignatureRoster';

describe('VerifiableThresholdSignatureRoster', () => {
  const manager = new VerifiableThresholdSignatureRoster();

  it('verifies multi-epoch threshold validator roster handoffs from genesis and rejects tampered transitions', () => {
    const a = manager.createMember('node-a', 40n);
    const b = manager.createMember('node-b', 35n);
    const c = manager.createMember('node-c', 25n);
    const d = manager.createMember('node-d', 50n);
    const e = manager.createMember('node-e', 30n);

    const roster0 = manager.buildRoster('worksphere-net', 0, [a, b, c]);
    const roster1 = manager.buildRoster('worksphere-net', 1, [b, c, d]);
    const roster2 = manager.buildRoster('worksphere-net', 2, [c, d, e]);

    const h01 = manager.createHandoffCertificate(roster0, roster1, [a, b], 'state-root-ep1');
    expect(h01.certificate).not.toBeNull();
    expect(manager.verifyHandoff(roster0, h01.certificate!)).toBe(true);

    const insufficient = manager.createHandoffCertificate(roster1, roster2, [b, c], 'state-root-ep2');
    expect(insufficient.certificate).toBeNull();

    const h12 = manager.createHandoffCertificate(roster1, roster2, [b, d], 'state-root-ep2');
    expect(h12.certificate).not.toBeNull();

    const chainCheck = manager.verifyEpochChain(roster0, [h01.certificate!, h12.certificate!]);
    expect(chainCheck.valid).toBe(true);
    expect(chainCheck.finalRoster.epoch).toBe(2);
    expect(chainCheck.finalRoster.rosterHash).toBe(roster2.rosterHash);

    const badCert = { ...h12.certificate!, stateAnchorHash: 'forged-root' };
    expect(manager.verifyEpochChain(roster0, [h01.certificate!, badCert]).valid).toBe(false);

    const json = JSON.parse(manager.serializeCertificate(h12.certificate!)) as { fromEpoch: number; toEpoch: number };
    expect(json.fromEpoch).toBe(1);
    expect(json.toEpoch).toBe(2);
  });

  it('computes order-independent canonical roster hashes and rejects invalid roster definitions', () => {
    const m1 = manager.createMember('val-1', 20n);
    const m2 = manager.createMember('val-2', 30n);
    const m3 = manager.createMember('val-3', 50n);

    const rAsc = manager.buildRoster('canon-net', 0, [m1, m2, m3]);
    const rDesc = manager.buildRoster('canon-net', 0, [m3, m1, m2]);
    expect(rAsc.rosterHash).toBe(rDesc.rosterHash);
    expect(rAsc.totalWeight).toBe(100n);
    expect(rAsc.quorumWeight).toBe(67n);

    expect(() => manager.createMember('bad', 0n)).toThrow();
    expect(() => manager.buildRoster('canon-net', 0, [])).toThrow();
    expect(() => manager.buildRoster('canon-net', 0, [m1, m1])).toThrow();
    expect(() => manager.buildRoster('canon-net', 0, [{ id: 'z', weight: 0n, publicKey: 4n }])).toThrow();
  });

  it('isolates unknown or duplicate signers and rejects tampered certificates across every field', () => {
    const a = manager.createMember('a', 50n);
    const b = manager.createMember('b', 30n);
    const c = manager.createMember('c', 20n);
    const outsider = manager.createMember('outsider', 99n);

    const r0 = manager.buildRoster('sec-net', 0, [a, b, c]);
    const r1 = manager.buildRoster('sec-net', 1, [a, b, outsider]);
    const r2Skip = manager.buildRoster('sec-net', 2, [a, outsider]);

    expect(() => manager.createHandoffCertificate(r0, r2Skip, [a, b], 'root')).toThrow();
    expect(() => manager.createHandoffCertificate(r0, { ...r1, chainId: 'other' }, [a, b], 'root')).toThrow();

    // Outsider + duplicate signer 'a' are rejected; honest a(50) + b(30) = 80 >= 67 still succeeds
    const res = manager.createHandoffCertificate(r0, r1, [a, a, outsider, b], 'anchor-1');
    expect(res.rejectedIds).toEqual(['a', 'outsider']);
    expect(res.certificate).not.toBeNull();
    const cert = res.certificate!;
    expect(manager.verifyHandoff(r0, cert)).toBe(true);

    expect(manager.verifyHandoff(r0, { ...cert, chainId: 'wrong' })).toBe(false);
    expect(manager.verifyHandoff(r0, { ...cert, fromEpoch: 1 })).toBe(false);
    expect(manager.verifyHandoff(r0, { ...cert, toEpoch: 2 })).toBe(false);
    expect(manager.verifyHandoff(r0, { ...cert, fromRosterHash: '00'.repeat(32) })).toBe(false);
    expect(manager.verifyHandoff(r0, { ...cert, signedWeight: 999n })).toBe(false);
    expect(manager.verifyHandoff(r0, { ...cert, nextRoster: { ...cert.nextRoster, rosterHash: 'ff'.repeat(32) } })).toBe(false);
    expect(manager.verifyHandoff(r0, { ...cert, approvals: [cert.approvals[0]] })).toBe(false);
    expect(
      manager.verifyHandoff(r0, {
        ...cert,
        approvals: [{ ...cert.approvals[0], sigS: (cert.approvals[0].sigS + 1n) % SUBGROUP_Q }, cert.approvals[1]],
      }),
    ).toBe(false);
    // Duplicate approval injected manually must fail
    expect(
      manager.verifyHandoff(r0, {
        ...cert,
        approvals: [cert.approvals[0], cert.approvals[0]],
        signedWeight: 100n,
      }),
    ).toBe(false);
  });
});
