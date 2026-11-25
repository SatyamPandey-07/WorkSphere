import { describe, it, expect } from 'vitest';
import {
  GF256,
  invertMatrixGF256,
  FECReedSolomon,
} from '../../core/webrtc/FECReedSolomon';

describe('FECReedSolomon (WebRTC Forward Error Correction)', () => {
  describe('Galois Field GF(2^8) Arithmetic', () => {
    it('performs addition and multiplication correctly', () => {
      // 5 ^ 3 = 6
      expect(GF256.add(5, 3)).toBe(6);

      // Multiplication by 1 is identity
      expect(GF256.mul(42, 1)).toBe(42);
      expect(GF256.mul(42, 0)).toBe(0);

      // Multiplicative inverse
      const a = 137;
      const invA = GF256.inv(a);
      expect(GF256.mul(a, invA)).toBe(1);

      // Division
      expect(GF256.div(100, 20)).toBe(GF256.mul(100, GF256.inv(20)));
    });

    it('inverts non-singular matrices over GF(2^8)', () => {
      const mat = [
        [1, 2],
        [3, 4],
      ];
      const inv = invertMatrixGF256(mat);

      // mat * inv should equal Identity matrix
      const id00 = GF256.add(GF256.mul(mat[0][0], inv[0][0]), GF256.mul(mat[0][1], inv[1][0]));
      const id01 = GF256.add(GF256.mul(mat[0][0], inv[0][1]), GF256.mul(mat[0][1], inv[1][1]));
      const id10 = GF256.add(GF256.mul(mat[1][0], inv[0][0]), GF256.mul(mat[1][1], inv[1][0]));
      const id11 = GF256.add(GF256.mul(mat[1][0], inv[0][1]), GF256.mul(mat[1][1], inv[1][1]));

      expect(id00).toBe(1);
      expect(id01).toBe(0);
      expect(id10).toBe(0);
      expect(id11).toBe(1);
    });
  });

  describe('Erasure Coding & Packet Reconstruction', () => {
    const k = 4; // 4 data shards
    const m = 2; // 2 parity shards (can recover from any 2 lost packets)
    const fec = new FECReedSolomon(k, m);

    it('encodes data into systematic and parity shards', () => {
      const shardSize = 16;
      const dataShards: Uint8Array[] = [
        new Uint8Array(shardSize).fill(1),
        new Uint8Array(shardSize).fill(2),
        new Uint8Array(shardSize).fill(3),
        new Uint8Array(shardSize).fill(4),
      ];

      const encoded = fec.encode(dataShards);
      expect(encoded.length).toBe(6); // 4 + 2

      // First 4 are systematic
      for (let i = 0; i < 4; i++) {
        expect(encoded[i].isParity).toBe(false);
        expect(encoded[i].data).toEqual(dataShards[i]);
      }

      // Last 2 are parity
      expect(encoded[4].isParity).toBe(true);
      expect(encoded[5].isParity).toBe(true);
    });

    it('reconstructs missing data shards when 2 data packets are dropped', () => {
      const shardSize = 8;
      const dataShards: Uint8Array[] = [
        new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]),
        new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27]),
        new Uint8Array([30, 31, 32, 33, 34, 35, 36, 37]),
        new Uint8Array([40, 41, 42, 43, 44, 45, 46, 47]),
      ];

      const allShards = fec.encode(dataShards);

      // Simulate packet loss: drop shards index 0 and 2
      // Surviving: index 1, 3, 4, 5 (2 data + 2 parity = 4 shards)
      const surviving = [allShards[1], allShards[3], allShards[4], allShards[5]];

      const recovered = fec.decode(surviving);
      expect(recovered.length).toBe(k);

      for (let i = 0; i < k; i++) {
        expect(recovered[i]).toEqual(dataShards[i]);
      }
    });

    it('throws error when fewer than K shards survive', () => {
      const allShards = fec.encode([
        new Uint8Array([1, 2]),
        new Uint8Array([3, 4]),
        new Uint8Array([5, 6]),
        new Uint8Array([7, 8]),
      ]);

      // Only 3 shards survive (k = 4 required)
      expect(() => {
        fec.decode([allShards[0], allShards[1], allShards[2]]);
      }).toThrow('Need at least 4 surviving shards');
    });

    it('encodes and recovers raw WebRTC audio/video payload buffers seamlessly', () => {
      const rawAudio = Buffer.from(
        'Opus WebRTC audio frame stream chunk with real-time zero-loss forward error correction!'
      );
      const encodedPayload = fec.encodePayload(new Uint8Array(rawAudio));

      // Drop 2 random shards
      const surviving = encodedPayload.shards.filter((_, idx) => idx !== 0 && idx !== 3);

      const reconstructed = fec.decodePayload(surviving, encodedPayload.originalLength);
      expect(Buffer.from(reconstructed).toString('utf-8')).toBe(rawAudio.toString('utf-8'));
    });
  });
});
