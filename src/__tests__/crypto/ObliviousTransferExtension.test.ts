import { ObliviousTransferExtension } from '../../core/crypto/ObliviousTransferExtension';

describe('ObliviousTransferExtension', () => {
  it('executes batched 1-out-of-2 oblivious transfers and verifies commitments', () => {
    const ot = new ObliviousTransferExtension(64);
    const setup = ot.generateBaseOTSetup('session-alpha-01');
    const choices: (0 | 1)[] = [0, 1, 1, 0, 1];
    const messagePairs: [Buffer, Buffer][] = [
      [Buffer.from('msg-0-branch-A'), Buffer.from('msg-0-branch-B')],
      [Buffer.from('msg-1-branch-A'), Buffer.from('msg-1-branch-B')],
      [Buffer.from('msg-2-branch-A'), Buffer.from('msg-2-branch-B')],
      [Buffer.from('msg-3-branch-A'), Buffer.from('msg-3-branch-B')],
      [Buffer.from('msg-4-branch-A'), Buffer.from('msg-4-branch-B')],
    ];

    const { message, receiverTColumns } = ot.receiverPrepare(setup, choices);
    const response = ot.senderEncrypt(setup, message, messagePairs);
    const result = ot.receiverDecrypt(message, receiverTColumns, choices, response);

    expect(result.isValid).toBe(true);
    expect(result.verifiedCount).toBe(5);
    for (let i = 0; i < choices.length; i++) {
      expect(result.recoveredMessages[i].equals(messagePairs[i][choices[i]])).toBe(true);
    }
  });

  it('rejects tampered sender ciphertexts', () => {
    const ot = new ObliviousTransferExtension(64);
    const setup = ot.generateBaseOTSetup('session-beta-02');
    const choices: (0 | 1)[] = [1, 0];
    const pairs: [Buffer, Buffer][] = [
      [Buffer.from('left-000'), Buffer.from('rght-000')],
      [Buffer.from('left-111'), Buffer.from('rght-111')],
    ];

    const { message, receiverTColumns } = ot.receiverPrepare(setup, choices);
    const response = ot.senderEncrypt(setup, message, pairs);
    const tamperedCipher = Buffer.from(response.pairs[0].cipher1);
    tamperedCipher[0] ^= 0xff;

    const tamperedResponse = {
      ...response,
      pairs: [{ ...response.pairs[0], cipher1: tamperedCipher }, response.pairs[1]],
    };

    const result = ot.receiverDecrypt(message, receiverTColumns, choices, tamperedResponse);
    expect(result.isValid).toBe(false);
  });

  it('rejects tampered receiver consistency tag at sender', () => {
    const ot = new ObliviousTransferExtension(64);
    const setup = ot.generateBaseOTSetup('session-gamma-03');
    const { message } = ot.receiverPrepare(setup, [0]);
    expect(() =>
      ot.senderEncrypt(
        setup,
        { ...message, consistencyTag: '0'.repeat(64) },
        [[Buffer.from('aaaa'), Buffer.from('bbbb')]]
      )
    ).toThrow();
  });
});
