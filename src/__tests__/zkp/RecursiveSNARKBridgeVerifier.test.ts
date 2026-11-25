import {
  RecursiveSNARKBridgeVerifier,
  EpochBridgeHeader,
} from '../../core/zkp/RecursiveSNARKBridgeVerifier';

describe('RecursiveSNARKBridgeVerifier', () => {
  it('verifies multi-epoch recursive bridge proofs with validator rotation and message inclusion', () => {
    const bridge = new RecursiveSNARKBridgeVerifier();
    const epoch1Vals = [
      bridge.createValidator('val-1', 40n, 'e1-s1'),
      bridge.createValidator('val-2', 35n, 'e1-s2'),
      bridge.createValidator('val-3', 25n, 'e1-s3'),
    ];
    const epoch2Vals = [
      bridge.createValidator('val-2', 50n, 'e2-s2'),
      bridge.createValidator('val-3', 30n, 'e2-s3'),
      bridge.createValidator('val-4', 20n, 'e2-s4'),
    ];

    const vSet2Hash = bridge.computeValidatorSetHash(epoch2Vals);
    const genesisHash = '0xgenesis_root_000';

    const { root: root1 } = bridge.buildMessageMerkleRoot([
      { messageId: 'msg-1', payloadHash: '0xpay1' },
      { messageId: 'msg-2', payloadHash: '0xpay2' },
    ]);
    const h1Hash = bridge.computeHeaderHash(1, genesisHash, root1, vSet2Hash);
    const header1: EpochBridgeHeader = {
      epoch: 1,
      parentHeaderHash: genesisHash,
      stateRoot: root1,
      nextValidatorSetHash: vSet2Hash,
      headerHash: h1Hash,
      signatures: [
        bridge.signHeader(epoch1Vals[0], h1Hash, 'n1'),
        bridge.signHeader(epoch1Vals[1], h1Hash, 'n2'),
      ],
    };

    const { root: root2, proofs: msgProofs } = bridge.buildMessageMerkleRoot([
      { messageId: 'msg-3', payloadHash: '0xpay3' },
      { messageId: 'msg-4', payloadHash: '0xpay4' },
      { messageId: 'msg-5', payloadHash: '0xpay5' },
    ]);
    const h2Hash = bridge.computeHeaderHash(2, h1Hash, root2, vSet2Hash);
    const header2: EpochBridgeHeader = {
      epoch: 2,
      parentHeaderHash: h1Hash,
      stateRoot: root2,
      nextValidatorSetHash: vSet2Hash,
      headerHash: h2Hash,
      signatures: [
        bridge.signHeader(epoch2Vals[0], h2Hash, 'n3'),
        bridge.signHeader(epoch2Vals[1], h2Hash, 'n4'),
      ],
    };

    const proof = bridge.proveEpochChain(genesisHash, [epoch1Vals, epoch2Vals], [header1, header2]);
    const res = bridge.verifyRecursiveBridgeProof(proof, [header1, header2]);
    expect(res.isValid).toBe(true);
    expect(res.verifiedEpochs).toBe(2);

    const m4Proof = msgProofs.get('msg-4')!;
    expect(bridge.verifyMessageInclusion(res.finalStateRoot, m4Proof)).toBe(true);
    expect(
      bridge.verifyMessageInclusion(res.finalStateRoot, { ...m4Proof, payloadHash: '0xforged' })
    ).toBe(false);
  });

  it('rejects under-quorum headers and tampered recursive accumulators', () => {
    const bridge = new RecursiveSNARKBridgeVerifier();
    const vals = [
      bridge.createValidator('a', 40n, 's1'),
      bridge.createValidator('b', 35n, 's2'),
      bridge.createValidator('c', 25n, 's3'),
    ];
    const vHash = bridge.computeValidatorSetHash(vals);
    const hHash = bridge.computeHeaderHash(1, '0xgen', '0xroot', vHash);

    const underQuorumHeader: EpochBridgeHeader = {
      epoch: 1,
      parentHeaderHash: '0xgen',
      stateRoot: '0xroot',
      nextValidatorSetHash: vHash,
      headerHash: hHash,
      signatures: [bridge.signHeader(vals[2], hHash, 'only-25')],
    };
    expect(() => bridge.proveEpochChain('0xgen', [vals], [underQuorumHeader])).toThrow();

    const validHeader: EpochBridgeHeader = {
      ...underQuorumHeader,
      signatures: [
        bridge.signHeader(vals[0], hHash, 'n1'),
        bridge.signHeader(vals[1], hHash, 'n2'),
      ],
    };
    const proof = bridge.proveEpochChain('0xgen', [vals], [validHeader]);
    expect(
      bridge.verifyRecursiveBridgeProof(
        { ...proof, finalAccumulator: proof.finalAccumulator + 1n },
        [validHeader]
      ).isValid
    ).toBe(false);
  });
});
