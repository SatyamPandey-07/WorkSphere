import {
  DEFAULT_INITIAL_WASM_PAGES,
  generateMembershipProofInWorker,
  releaseProofBuffers,
} from '@/workers/zkpWorker';

describe('zkpWorker WebAssembly memory handling & buffer cleanup', () => {
  it('allocates initial Wasm memory with headroom and succeeds for valid witness', async () => {
    let observedInitialPages = 0;

    const result = await generateMembershipProofInWorker(
      {
        requestId: 'req-1',
        deskId: 'desk-a1',
        slotWindow: '2026-11-22T11:00Z',
        merkleRoot: '0x1234',
        merklePath: ['0xaa'],
        pathIndices: [0],
        membershipTier: 2,
        requiredTier: 1,
        depositAmount: '500',
        minDepositAmount: '100',
        secretSalt: 'salt-secret',
        wasmPath: '/circuits/membership.wasm',
        zkeyPath: '/circuits/membership.zkey',
      },
      async (_input, _wasm, _zkey, wasmMemory) => {
        if (wasmMemory) {
          observedInitialPages = wasmMemory.buffer.byteLength / (64 * 1024);
        }
        return {
          proof: {
            pi_a: ['0x1', '0x2', '1'],
            pi_b: [
              ['0x3', '0x4'],
              ['0x5', '0x6'],
            ],
            pi_c: ['0x7', '0x8', '1'],
          },
          publicSignals: ['0x1234', '2', '1', '0x9999'],
        };
      }
    );

    expect(observedInitialPages).toBe(DEFAULT_INITIAL_WASM_PAGES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.proofHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('catches WebAssembly memory allocation errors gracefully and returns a diagnostic prompt', async () => {
    const result = await generateMembershipProofInWorker(
      {
        requestId: 'req-oom',
        deskId: 'desk-b2',
        slotWindow: '2026-11-22T12:00Z',
        merkleRoot: '0x1234',
        merklePath: [],
        pathIndices: [],
        membershipTier: 2,
        requiredTier: 1,
        depositAmount: '500',
        minDepositAmount: '100',
        secretSalt: 'salt-secret',
        wasmPath: '/circuits/membership.wasm',
        zkeyPath: '/circuits/membership.zkey',
      },
      async () => {
        const err = new RangeError('WebAssembly.Memory(): could not allocate memory');
        throw err;
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('WASM_MEMORY_LIMIT');
      expect(result.diagnosticMessage).toContain('WebAssembly memory limits');
    }
  });

  it('zeroes temporary buffers on releaseProofBuffers', () => {
    const buf = new Uint8Array([10, 20, 30, 40]);
    releaseProofBuffers([buf]);
    expect(Array.from(buf)).toEqual([0, 0, 0, 0]);
  });
});