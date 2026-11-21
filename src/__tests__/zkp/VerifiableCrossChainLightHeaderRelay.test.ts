import { describe, it, expect } from 'vitest';
import { VerifiableCrossChainLightHeaderRelay } from '../../core/zkp/VerifiableCrossChainLightHeaderRelay';

describe('VerifiableCrossChainLightHeaderRelay', () => {
  it('relays PoS-finalized headers across chains, verifies bridge event inclusion, and prevents replays', () => {
    const relay = new VerifiableCrossChainLightHeaderRelay('source-pos-1');
    const v1 = relay.registerValidator('v1', 40n);
    const v2 = relay.registerValidator('v2', 35n);
    const v3 = relay.registerValidator('v3', 25n);
    // Quorum = 67

    const h100 = relay.produceSignedHeader({
      height: 100,
      parentHash: 'genesis-99',
      stateRoot: 'state-100',
      events: [],
      signers: [v1, v2],
    });
    relay.initializeTrustedAnchor(h100.header);

    const evs101 = [
      { nonce: 1, srcChainId: 'source-pos-1', dstChainId: 'dest-l2', sender: '0xA', recipient: '0xB', amount: 500n },
      { nonce: 2, srcChainId: 'source-pos-1', dstChainId: 'dest-l2', sender: '0xC', recipient: '0xD', amount: 1200n },
    ];
    const h101 = relay.produceSignedHeader({
      height: 101,
      parentHash: h100.header.headerHash,
      stateRoot: 'state-101',
      events: evs101,
      signers: [v1, v3, v2],
    });
    const h102 = relay.produceSignedHeader({
      height: 102,
      parentHash: h101.header.headerHash,
      stateRoot: 'state-102',
      events: [],
      signers: [v1, v2],
    });

    expect(relay.relayHeaderChain([h101.header, h102.header])).toEqual({ acceptedCount: 2, latestHeight: 102 });

    // Verify & execute bridge event #1 from finalized height 101
    const evProof = relay.buildEventProof(h101.header, evs101, 1);
    expect(relay.verifyAndExecuteEvent(evProof)).toEqual({ executed: true, replayDetected: false });
    // Replay blocked immediately
    expect(relay.verifyAndExecuteEvent(evProof).replayDetected).toBe(true);
    // Tampered amount fails Merkle inclusion
    expect(relay.verifyAndExecuteEvent({ ...evProof, event: { ...evProof.event, amount: 999999n } }).executed).toBe(false);

    // Header with broken parentHash rejected cleanly
    const badH103 = relay.produceSignedHeader({
      height: 103,
      parentHash: 'wrong-parent',
      stateRoot: 'state-103',
      events: [],
      signers: [v1, v2],
    });
    expect(relay.relayHeaderChain([badH103.header]).rejectedAtHeight).toBe(103);

    const json = JSON.parse(relay.serializeHeader(h101.header)) as { height: number; signerCount: number };
    expect(json.height).toBe(101);
    expect(json.signerCount).toBe(3);
  });

  it('rejects insufficient stake headers, duplicate signatures, unfinalized event proofs, and invalid anchors', () => {
    const relay = new VerifiableCrossChainLightHeaderRelay('pos-chain-b');
    const v1 = relay.registerValidator('val-1', 50n);
    const v2 = relay.registerValidator('val-2', 30n);
    const v3 = relay.registerValidator('val-3', 20n);

    expect(() => relay.registerValidator('val-1', 10n)).toThrow();
    expect(() => relay.registerValidator('zero', 0n)).toThrow();

    // Insufficient stake (v2 + v3 = 50 < 67) cannot initialize anchor
    const lowStakeHdr = relay.produceSignedHeader({
      height: 1,
      parentHash: 'gen',
      stateRoot: 's1',
      events: [],
      signers: [v2, v3],
    });
    expect(relay.verifySignedHeader(lowStakeHdr.header)).toBe(false);
    expect(() => relay.initializeTrustedAnchor(lowStakeHdr.header)).toThrow();

    // Duplicate signer does not reach quorum (v1 + v1 rejected)
    const dupHdr = relay.produceSignedHeader({
      height: 1,
      parentHash: 'gen',
      stateRoot: 's1',
      events: [],
      signers: [v1, v1],
    });
    expect(relay.verifySignedHeader(dupHdr.header)).toBe(false);

    // Unfinalized header event proof rejected cleanly
    const ev = { nonce: 7, srcChainId: 'pos-chain-b', dstChainId: 'dst', sender: 'a', recipient: 'b', amount: 10n };
    const unfinalized = relay.produceSignedHeader({ height: 5, parentHash: 'x', stateRoot: 's5', events: [ev], signers: [v1, v2] });
    const proof = relay.buildEventProof(unfinalized.header, [ev], 0);
    expect(relay.verifyAndExecuteEvent(proof).executed).toBe(false);
  });
});
