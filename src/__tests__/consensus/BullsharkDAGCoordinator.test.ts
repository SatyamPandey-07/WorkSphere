import {
  BullsharkDAGCoordinator,
  BullsharkDAGCluster,
} from '../../core/consensus/BullsharkDAGCoordinator';

describe('BullsharkDAGCoordinator', () => {
  describe('Vertex & Certificate Construction', () => {
    it('creates genesis vertex and validates votes', () => {
      const node = new BullsharkDAGCoordinator('node_0', 4);
      const vertex = node.createVertex(0, ['tx_1', 'tx_2'], []);

      expect(vertex.round).toBe(0);
      expect(vertex.transactions.length).toBe(2);
      expect(vertex.parents.length).toBe(0);

      const vote = node.vote(vertex);
      expect(vote).not.toBeNull();
      expect(vote!.voter).toBe('node_0');
      expect(vote!.vertexId).toBe(vertex.id);
    });

    it('enforces quorum requirements to certify vertices', () => {
      const node = new BullsharkDAGCoordinator('node_0', 4);
      const vertex = node.createVertex(0, ['tx_1'], []);

      // Needs 2f + 1 = 3 votes for cluster size 4
      const votes = [
        node.vote(vertex)!,
        new BullsharkDAGCoordinator('node_1', 4).vote(vertex)!,
      ];

      expect(node.certifyVertex(vertex, votes)).toBeNull(); // Only 2 votes

      votes.push(new BullsharkDAGCoordinator('node_2', 4).vote(vertex)!);
      const cert = node.certifyVertex(vertex, votes);
      expect(cert).not.toBeNull();
      expect(cert!.signers.length).toBe(3);
    });
  });

  describe('DAG Round Advancement & Wave Commit', () => {
    it('commits wave 0 and totally orders causal transactions across cluster', () => {
      const cluster = new BullsharkDAGCluster(4);
      const committedTxs = cluster.runWave0();

      expect(committedTxs.length).toBeGreaterThan(0);
      expect(committedTxs).toContain('tx_node_0_r0');

      const node0 = cluster.nodes.get('node_0')!;
      expect(node0.getOrderedTransactions()).toEqual(committedTxs);
      expect(node0.getDAGSize()).toBe(8); // 4 in round 0 + 4 in round 1
    });

    it('ensures determinism across multiple nodes committing same wave', () => {
      const cluster = new BullsharkDAGCluster(4);
      cluster.runWave0();

      const node0 = cluster.nodes.get('node_0')!;
      const node1 = cluster.nodes.get('node_1')!;

      const txs0 = node0.tryCommitWave(0, cluster.nodeIds);
      const txs1 = node1.tryCommitWave(0, cluster.nodeIds);

      // Node 0 already committed in runWave0, so returns empty
      expect(txs0.length).toBe(0);
      // Node 1 commits now and yields identical ordered history
      expect(txs1).toEqual(node0.getOrderedTransactions());
    });
  });
});
