import { describe, it, expect } from 'vitest';
import {
  AsynchronousEpochTransition,
  EpochConfig,
  ValidatorNode,
  EpochHandshakeMessage,
} from '../../core/consensus/AsynchronousEpochTransition';

describe('AsynchronousEpochTransition', () => {
  const initialValidators: ValidatorNode[] = [
    { id: 'val-1', publicKey: 'pk-secret-1', stake: 100n, isActive: true },
    { id: 'val-2', publicKey: 'pk-secret-2', stake: 100n, isActive: true },
    { id: 'val-3', publicKey: 'pk-secret-3', stake: 100n, isActive: true },
    { id: 'val-4', publicKey: 'pk-secret-4', stake: 100n, isActive: true },
  ];
  // Total stake: 400n. Quorum (2f+1): floor(800 / 3) + 1 = 267n

  const initialEpoch: EpochConfig = {
    epochNumber: 1,
    validators: initialValidators,
    totalStake: 400n,
    quorumThreshold: AsynchronousEpochTransition.calculateQuorumThreshold(400n),
    startBlock: 1,
  };

  it('correctly initializes and checks threshold requirements', () => {
    const coordinator = new AsynchronousEpochTransition(initialEpoch);
    expect(coordinator.getCurrentEpoch().epochNumber).toBe(1);
    expect(coordinator.getCurrentEpoch().quorumThreshold).toBe(267n);
  });

  it('initiates transition and collects validator handshakes to reach quorum', () => {
    const coordinator = new AsynchronousEpochTransition(initialEpoch);
    const nextValidators: ValidatorNode[] = [
      ...initialValidators,
      { id: 'val-5', publicKey: 'pk-secret-5', stake: 150n, isActive: true },
    ];
    const commitment = '0xstate_hash_epoch_1_boundary';

    coordinator.initiateEpochTransition(2, nextValidators, commitment);
    expect(coordinator.isTransitionReady(2)).toBe(false);

    const now = Date.now();

    // Validator 1 submits handshake
    const sig1 = AsynchronousEpochTransition.signPayload(`1:2:${commitment}:${now}`, 'pk-secret-1');
    const hs1: EpochHandshakeMessage = {
      epoch: 1,
      targetEpoch: 2,
      validatorId: 'val-1',
      stateCommitment: commitment,
      signature: sig1,
      timestamp: now,
    };
    const res1 = coordinator.submitHandshake(hs1);
    expect(res1.success).toBe(true);
    expect(res1.currentAccumulatedStake).toBe(100n);
    expect(res1.quorumReached).toBe(false);

    // Validator 2 submits handshake
    const sig2 = AsynchronousEpochTransition.signPayload(`1:2:${commitment}:${now}`, 'pk-secret-2');
    const hs2: EpochHandshakeMessage = {
      epoch: 1,
      targetEpoch: 2,
      validatorId: 'val-2',
      stateCommitment: commitment,
      signature: sig2,
      timestamp: now,
    };
    const res2 = coordinator.submitHandshake(hs2);
    expect(res2.currentAccumulatedStake).toBe(200n);
    expect(res2.quorumReached).toBe(false);

    // Validator 3 submits handshake -> reaches 300n >= 267n (Quorum reached!)
    const sig3 = AsynchronousEpochTransition.signPayload(`1:2:${commitment}:${now}`, 'pk-secret-3');
    const hs3: EpochHandshakeMessage = {
      epoch: 1,
      targetEpoch: 2,
      validatorId: 'val-3',
      stateCommitment: commitment,
      signature: sig3,
      timestamp: now,
    };
    const res3 = coordinator.submitHandshake(hs3);
    expect(res3.currentAccumulatedStake).toBe(300n);
    expect(res3.quorumReached).toBe(true);
    expect(coordinator.isTransitionReady(2)).toBe(true);

    // Finalize transition
    const cert = coordinator.finalizeEpochTransition(2, 5000);
    expect(cert.fromEpoch).toBe(1);
    expect(cert.toEpoch).toBe(2);
    expect(cert.accumulatedStake).toBe(300n);
    expect(Object.keys(cert.validatorSignatures).length).toBe(3);

    // Verify coordinator is now on epoch 2
    expect(coordinator.getCurrentEpoch().epochNumber).toBe(2);
    expect(coordinator.getCurrentEpoch().startBlock).toBe(5001);
  });

  it('rejects handshakes with invalid signatures', () => {
    const coordinator = new AsynchronousEpochTransition(initialEpoch);
    const commitment = '0xstate_hash_epoch_1_boundary';
    coordinator.initiateEpochTransition(2, initialValidators, commitment);

    const now = Date.now();
    const hsInvalid: EpochHandshakeMessage = {
      epoch: 1,
      targetEpoch: 2,
      validatorId: 'val-1',
      stateCommitment: commitment,
      signature: 'bad-signature',
      timestamp: now,
    };

    const res = coordinator.submitHandshake(hsInvalid);
    expect(res.success).toBe(false);
    expect(res.reason).toContain('Invalid validator cryptographic signature');
  });

  it('verifies historical certificates accurately', () => {
    const coordinator = new AsynchronousEpochTransition(initialEpoch);
    const commitment = '0xstate_hash_epoch_1_boundary';
    coordinator.initiateEpochTransition(2, initialValidators, commitment);

    const now = Date.now();
    for (let i = 1; i <= 3; i++) {
      const sig = AsynchronousEpochTransition.signPayload(`1:2:${commitment}:${now}`, `pk-secret-${i}`);
      coordinator.submitHandshake({
        epoch: 1,
        targetEpoch: 2,
        validatorId: `val-${i}`,
        stateCommitment: commitment,
        signature: sig,
        timestamp: now,
      });
    }

    const cert = coordinator.finalizeEpochTransition(2, 1000);
    const isValid = AsynchronousEpochTransition.verifyCertificate(
      cert,
      initialValidators,
      initialEpoch.quorumThreshold
    );
    expect(isValid).toBe(true);
  });
});
