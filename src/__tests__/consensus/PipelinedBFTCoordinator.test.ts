import { describe, it, expect } from 'vitest';
import {
  PipelinedBFTCoordinator,
  type PipelinedBlock,
  type ValidatorVote,
} from '../../core/consensus/PipelinedBFTCoordinator';

describe('PipelinedBFTCoordinator (Pipelined HotStuff / DiemBFT)', () => {
  const validators = ['val_0', 'val_1', 'val_2', 'val_3']; // N = 4, f = 1, Quorum = 3

  describe('Configuration & Leader Election', () => {
    it('computes correct quorum threshold for N = 3f + 1', () => {
      const node = new PipelinedBFTCoordinator('val_0', { validators });
      expect(node.quorumThreshold).toBe(3);
      expect(node.getCurrentView()).toBe(1);
      expect(node.getLeader(1)).toBe('val_0');
      expect(node.getLeader(2)).toBe('val_1');
      expect(node.isLeader()).toBe(true);
    });

    it('rejects node not in validator set', () => {
      expect(() => new PipelinedBFTCoordinator('val_unknown', { validators })).toThrow('not in validator set');
    });
  });

  describe('Pipelined 3-Chain Finality & QC Aggregation', () => {
    it('executes pipelined proposals, aggregates QCs, and commits via 3-chain rule', () => {
      const nodes = validators.map((id) => new PipelinedBFTCoordinator(id, { validators }));

      // Round 1 (View 1, Leader: val_0)
      const leader1 = nodes[0];
      const block0 = leader1.propose('tx_payload_block_0');
      expect(block0.view).toBe(1);

      // Collect votes from all 4 validators
      const votes0: ValidatorVote[] = [];
      for (const node of nodes) {
        const v = node.processProposal(block0);
        expect(v).not.toBeNull();
        votes0.push(v!);
      }

      // Process votes on all nodes to form QC0
      let qc0 = null;
      for (const vote of votes0) {
        for (const node of nodes) {
          const res = node.processVote(vote);
          if (res) qc0 = res;
        }
      }
      expect(qc0).not.toBeNull();
      expect(qc0!.view).toBe(1);
      expect(qc0!.blockHash).toBe(block0.blockHash);

      // Round 2 (View 2, Leader: val_1)
      const leader2 = nodes[1];
      expect(leader2.getCurrentView()).toBe(2);
      expect(leader2.isLeader()).toBe(true);

      const block1 = leader2.propose('tx_payload_block_1');
      expect(block1.parentHash).toBe(block0.blockHash);

      const votes1: ValidatorVote[] = [];
      for (const node of nodes) {
        const v = node.processProposal(block1);
        expect(v).not.toBeNull();
        votes1.push(v!);
      }

      let qc1 = null;
      for (const vote of votes1) {
        for (const node of nodes) {
          const res = node.processVote(vote);
          if (res) qc1 = res;
        }
      }
      expect(qc1).not.toBeNull();

      // Round 3 (View 3, Leader: val_2)
      const leader3 = nodes[2];
      expect(leader3.getCurrentView()).toBe(3);
      const block2 = leader3.propose('tx_payload_block_2');

      const votes2: ValidatorVote[] = [];
      for (const node of nodes) {
        const v = node.processProposal(block2);
        expect(v).not.toBeNull();
        votes2.push(v!);
      }

      let qc2 = null;
      for (const vote of votes2) {
        for (const node of nodes) {
          const res = node.processVote(vote);
          if (res) qc2 = res;
        }
      }
      expect(qc2).not.toBeNull();

      // Round 4 (View 4, Leader: val_3) - Proposing Block 3 completes the 3-chain for Block 0!
      const leader4 = nodes[3];
      expect(leader4.getCurrentView()).toBe(4);
      const block3 = leader4.propose('tx_payload_block_3');

      // When nodes process Block 3, Block 0 commits via 3-chain rule
      for (const node of nodes) {
        node.processProposal(block3);
        const committed = node.getCommittedBlocks();
        expect(committed.length).toBeGreaterThan(0);
        expect(committed[0].blockHash).toBe(block0.blockHash);
        expect(committed[0].payload).toBe('tx_payload_block_0');
      }
    });

    it('rejects proposals from non-leaders', () => {
      const nonLeader = new PipelinedBFTCoordinator('val_1', { validators });
      // View 1 leader is val_0, so val_1 cannot propose
      expect(() => nonLeader.propose('invalid_proposal')).toThrow('not leader for view 1');
    });

    it('processes timeout votes and forms Timeout Certificate', () => {
      const node = new PipelinedBFTCoordinator('val_0', { validators });
      const view = 1;

      expect(node.processTimeout('val_0', view)).toBeNull();
      expect(node.processTimeout('val_1', view)).toBeNull();
      const tc = node.processTimeout('val_2', view); // 3rd vote reaches quorum 2f + 1

      expect(tc).not.toBeNull();
      expect(tc!.view).toBe(view);
      expect(node.getCurrentView()).toBe(2); // Advanced to view 2
    });
  });
});
