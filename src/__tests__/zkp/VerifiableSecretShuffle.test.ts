import {
  VerifiableSecretShuffle,
  ShuffleFieldMath,
  SHUFFLE_PRIME,
} from '../../core/zkp/VerifiableSecretShuffle';

describe('VerifiableSecretShuffle', () => {
  let mixer: VerifiableSecretShuffle;

  beforeEach(() => {
    mixer = new VerifiableSecretShuffle();
  });

  describe('Field Math & Mix-Net Encryption/Permutation', () => {
    it('performs modular arithmetic mod SHUFFLE_PRIME', () => {
      const a = 12345678901234567890n;
      const b = 98765432109876543210n;
      expect(ShuffleFieldMath.add(a, b)).toBe((a + b) % SHUFFLE_PRIME);
      expect(ShuffleFieldMath.sub(a, b)).toBe(((a - b) % SHUFFLE_PRIME + SHUFFLE_PRIME) % SHUFFLE_PRIME);
      expect(ShuffleFieldMath.mul(a, b)).toBe((a * b) % SHUFFLE_PRIME);
    });

    it('shuffles ciphertexts under permutation and re-randomization factors', () => {
      const pk = ShuffleFieldMath.mul(9999n, mixer.g, SHUFFLE_PRIME);
      const inputs = [
        mixer.encrypt(10n, pk).ciphertext,
        mixer.encrypt(20n, pk).ciphertext,
        mixer.encrypt(30n, pk).ciphertext,
      ];

      const perm = [2, 0, 1]; // out[0]=in[2], out[1]=in[0], out[2]=in[1]
      const { outputs, rhos } = mixer.shuffle(inputs, perm, pk);

      expect(outputs.length).toBe(3);
      expect(rhos.length).toBe(3);
    });
  });

  describe('Zero-Knowledge Mix-Net Shuffle Verification', () => {
    it('proves and verifies honest mix-net ciphertext shuffle', () => {
      const pk = ShuffleFieldMath.mul(777n, mixer.g, SHUFFLE_PRIME);
      const inputs = [
        mixer.encrypt(111n, pk).ciphertext,
        mixer.encrypt(222n, pk).ciphertext,
        mixer.encrypt(333n, pk).ciphertext,
        mixer.encrypt(444n, pk).ciphertext,
      ];

      const perm = [3, 1, 0, 2];
      const { outputs, rhos } = mixer.shuffle(inputs, perm, pk);

      const proof = mixer.proveShuffle(inputs, outputs, perm, rhos, pk);
      const isValid = mixer.verifyShuffle(inputs, outputs, pk, proof);
      expect(isValid).toBe(true);
    });

    it('rejects tampered challenge', () => {
      const pk = ShuffleFieldMath.mul(777n, mixer.g, SHUFFLE_PRIME);
      const inputs = [
        mixer.encrypt(1n, pk).ciphertext,
        mixer.encrypt(2n, pk).ciphertext,
      ];
      const perm = [1, 0];
      const { outputs, rhos } = mixer.shuffle(inputs, perm, pk);

      const proof = mixer.proveShuffle(inputs, outputs, perm, rhos, pk);
      const tampered = { ...proof, challenge: proof.challenge + 1n };

      expect(mixer.verifyShuffle(inputs, outputs, pk, tampered)).toBe(false);
    });

    it('rejects tampered output ciphertext', () => {
      const pk = ShuffleFieldMath.mul(777n, mixer.g, SHUFFLE_PRIME);
      const inputs = [
        mixer.encrypt(1n, pk).ciphertext,
        mixer.encrypt(2n, pk).ciphertext,
      ];
      const perm = [1, 0];
      const { outputs, rhos } = mixer.shuffle(inputs, perm, pk);

      const proof = mixer.proveShuffle(inputs, outputs, perm, rhos, pk);
      const tamperedOutputs = [
        { ...outputs[0], v: outputs[0].v + 1n },
        outputs[1],
      ];

      expect(mixer.verifyShuffle(inputs, tamperedOutputs, pk, proof)).toBe(false);
    });
  });
});
