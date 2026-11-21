import {
  RBCMerkleTree,
  RBCErasureCoding,
  RBCNode,
  AsynchronousReliableBroadcastCluster,
} from '../../core/consensus/AsynchronousReliableBroadcast';

describe('AsynchronousReliableBroadcast', () => {
  describe('Merkle Tree Commitment & Verification', () => {
    it('constructs a Merkle tree and verifies membership proofs', () => {
      const leaves = ['shard_0', 'shard_1', 'shard_2', 'shard_3'];
      const { root, getProof } = RBCMerkleTree.buildTree(leaves);

      expect(root).toBeDefined();
      expect(typeof root).toBe('string');

      for (let i = 0; i < leaves.length; i++) {
        const proof = getProof(i);
        expect(RBCMerkleTree.verifyProof(proof, root)).toBe(true);
      }
    });

    it('rejects invalid or tampered Merkle proofs', () => {
      const leaves = ['dataA', 'dataB', 'dataC', 'dataD'];
      const { root, getProof } = RBCMerkleTree.buildTree(leaves);
      const proof = getProof(0);

      const tamperedProof = {
        ...proof,
        leafHash: '0000000000000000000000000000000000000000000000000000000000000000',
      };

      expect(RBCMerkleTree.verifyProof(tamperedProof, root)).toBe(false);
    });
  });

  describe('Erasure Coding Chunking & Decoding', () => {
    it('encodes and decodes original payload from systematic shards', () => {
      const message = 'WorkSphere High-Performance Byzantine Reliable Broadcast Payload';
      const totalShards = 4;
      const k = 2;

      const shards = RBCErasureCoding.encode(message, totalShards, k);
      expect(shards.length).toBe(totalShards);

      const decoded = RBCErasureCoding.decode(shards.slice(0, k), k);
      expect(decoded).toBe(message);
    });
  });

  describe('A-RBC 3-Phase Dissemination & Cluster Consensus', () => {
    it('broadcasts payload and guarantees termination across 4-node cluster (f=1)', () => {
      const cluster = new AsynchronousReliableBroadcastCluster(4);
      const broadcastId = 'tx_rbc_epoch_101';
      const payload = 'Decentralized State Machine Consensus Epoch #101';

      const results = cluster.runBroadcast('node_0', broadcastId, payload);

      expect(results.size).toBe(4);
      for (const [nodeId, delivered] of results) {
        expect(delivered).toBe(payload);
      }
    });

    it('processes VAL and ECHO transitions correctly on individual node', () => {
      const node = new RBCNode('node_1', 4);
      const leader = new RBCNode('node_0', 4);

      const { valMessages } = leader.initiateBroadcast('bcast_test_1', 'Hello RBC');
      const valForNode1 = valMessages.get('node_1')!;

      // VAL -> ECHO
      const echo = node.handleVal(valForNode1);
      expect(echo).not.toBeNull();
      expect(echo!.type).toBe('ECHO');
      expect(echo!.senderId).toBe('node_1');

      // Duplicate VAL ignored
      expect(node.handleVal(valForNode1)).toBeNull();
    });
  });
});
