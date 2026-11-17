import { describe, it, expect } from 'vitest';
import {
  ZKGossipSubRouter,
  DEFAULT_MESH_LIMITS,
  type ZKGossipMessage,
} from '../../core/p2p/ZKGossipSubRouter';

describe('ZKGossipSubRouter (P2P Mesh Routing)', () => {
  const router1 = new ZKGossipSubRouter('peer_alpha');
  const router2 = new ZKGossipSubRouter('peer_beta');
  const testTopic = 'zk-conference-announcements';
  const secretKey = 'super_secret_zk_key_123';

  describe('Mesh Topology & Graft/Prune Control', () => {
    it('manages topic mesh peers cleanly', () => {
      router1.joinTopic(testTopic);
      router1.graftPeer(testTopic, 'peer_beta');
      router1.graftPeer(testTopic, 'peer_gamma');

      const peers = router1.getMeshPeers(testTopic);
      expect(peers).toContain('peer_beta');
      expect(peers).toContain('peer_gamma');
      expect(peers.length).toBe(2);

      router1.prunePeer(testTopic, 'peer_beta');
      const prunedPeers = router1.getMeshPeers(testTopic);
      expect(prunedPeers).not.toContain('peer_beta');
      expect(prunedPeers).toContain('peer_gamma');
    });
  });

  describe('Anonymous ZK Proof & Publishing', () => {
    it('generates and verifies valid ZK membership proofs', () => {
      const nullifier = 'nullifier_test_999';
      const proof = ZKGossipSubRouter.generateTopicMembershipProof(testTopic, nullifier, secretKey);

      const isValid = ZKGossipSubRouter.verifyTopicMembershipProof(testTopic, nullifier, proof);
      expect(isValid).toBe(true);

      const isInvalid = ZKGossipSubRouter.verifyTopicMembershipProof('other_topic', nullifier, proof);
      expect(isInvalid).toBe(false);
    });

    it('publishes message and populates mcache', () => {
      router1.graftPeer(testTopic, 'peer_beta');
      const { message, recipientPeers } = router1.publish(testTopic, 'Hello Anonymous Mesh', secretKey);

      expect(message.topic).toBe(testTopic);
      expect(message.payload).toBe('Hello Anonymous Mesh');
      expect(recipientPeers).toContain('peer_beta');

      const cached = router1.getMessageFromCache(message.messageId);
      expect(cached).toEqual(message);
    });
  });

  describe('Message Reception & De-duplication', () => {
    it('accepts valid incoming message and forwards to mesh peers', () => {
      router2.joinTopic(testTopic);
      router2.graftPeer(testTopic, 'peer_gamma');
      router2.graftPeer(testTopic, 'peer_delta');

      const { message } = router1.publish(testTopic, 'Mesh Update #1', secretKey);
      const res = router2.receiveMessage('peer_alpha', message);

      expect(res.accepted).toBe(true);
      expect(res.duplicate).toBe(false);
      expect(res.forwardPeers).toContain('peer_gamma');
      expect(res.forwardPeers).toContain('peer_delta');
      expect(res.forwardPeers).not.toContain('peer_alpha'); // Sender excluded
    });

    it('detects and rejects duplicate messages', () => {
      const { message } = router1.publish(testTopic, 'Unique Message', secretKey);
      router2.receiveMessage('peer_alpha', message);

      const dupRes = router2.receiveMessage('peer_gamma', message);
      expect(dupRes.accepted).toBe(false);
      expect(dupRes.duplicate).toBe(true);
    });

    it('penalizes peer sending invalid ZK proof', () => {
      const initialScore = router2.getPeerScore('bad_peer');
      const fakeMsg: ZKGossipMessage = {
        messageId: 'fake_id',
        topic: testTopic,
        payload: 'Bad data',
        nullifier: 'nullifier_bad',
        senderProof: 'invalid_proof_hex_string_1234567890',
        timestamp: Date.now(),
        seqNo: 1,
      };

      const res = router2.receiveMessage('bad_peer', fakeMsg);
      expect(res.accepted).toBe(false);
      expect(res.reason).toBeDefined();

      const penalizedScore = router2.getPeerScore('bad_peer');
      expect(penalizedScore).toBeLessThan(initialScore);
    });
  });

  describe('Proof-of-Useful-Relay (PoUR) & Control Protocols', () => {
    it('generates and verifies Proof-of-Useful-Relay', () => {
      const messageId = 'msg_relay_42';
      const proof = router1.generateRelayProof(messageId, 1, secretKey);

      const isValid = router2.verifyRelayProof(proof, secretKey);
      expect(isValid).toBe(true);
      expect(router2.getPeerScore(proof.relayPeerId)).toBeGreaterThan(100);

      const isInvalid = router2.verifyRelayProof(proof, 'wrong_key');
      expect(isInvalid).toBe(false);
    });

    it('processes IHAVE control envelope and replies with IWANT', () => {
      const controlResp = router2.processControl('peer_alpha', {
        iHave: [{ topic: testTopic, messageIds: ['unseen_msg_1', 'unseen_msg_2'] }],
      });

      expect(controlResp.iWant).toBeDefined();
      expect(controlResp.iWant![0].messageIds).toContain('unseen_msg_1');
      expect(controlResp.iWant![0].messageIds).toContain('unseen_msg_2');
    });
  });
});
