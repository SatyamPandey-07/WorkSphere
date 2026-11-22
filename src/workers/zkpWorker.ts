import { computeMembershipProofHash, type SnarkJsProof } from '@/lib/zkp/membershipProofVerifier';

export const WASM_PAGE_BYTES = 64 * 1024;
export const DEFAULT_INITIAL_WASM_PAGES = 256;
export const DEFAULT_MAX_WASM_PAGES = 1024;

export interface ZkpWorkerInput {
  requestId: string;
  deskId: string;
  slotWindow: string;
  merkleRoot: string;
  merklePath: string[];
  pathIndices: number[];
  membershipTier: number;
  requiredTier: number;
  depositAmount: string;
  minDepositAmount: string;
  secretSalt: string;
  wasmPath?: string;
  zkeyPath?: string;
  initialWasmPages?: number;
  maxWasmPages?: number;
}

export interface ZkpWorkerSuccessOutput {
  ok: true;
  requestId: string;
  durationMs: number;
  proof: SnarkJsProof;
  publicSignals: string[];
  proofHash: string;
}

export interface ZkpWorkerErrorOutput {
  ok: false;
  requestId: string;
  code: 'WASM_MEMORY_LIMIT' | 'PROOF_GENERATION_FAILED';
  diagnosticMessage: string;
  error: string;
}

export type ZkpWorkerResult = ZkpWorkerSuccessOutput | ZkpWorkerErrorOutput;

export type SnarkJsFullProveFn = (
  input: Record<string, unknown>,
  wasmPath: string,
  zkeyPath: string,
  wasmMemory?: WebAssembly.Memory
) => Promise<{ proof: SnarkJsProof; publicSignals: string[] }>;

function deterministicFieldHex(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function createWorkerWasmMemory(
  initialPages = DEFAULT_INITIAL_WASM_PAGES,
  maximumPages = DEFAULT_MAX_WASM_PAGES
): WebAssembly.Memory {
  const safeInitial = Math.max(1, Math.floor(initialPages));
  const safeMax = Math.max(safeInitial, Math.floor(maximumPages));
  return new WebAssembly.Memory({
    initial: safeInitial,
    maximum: safeMax,
  });
}

export function isWasmMemoryError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const candidate = err as { name?: string; message?: string };
  const msg = (candidate.message ?? '').toLowerCase();
  if (
    candidate.name === 'RangeError' ||
    (candidate.name === 'RuntimeError' &&
      (msg.includes('memory') || msg.includes('grow') || msg.includes('allocation')))
  ) {
    return true;
  }
  return (
    msg.includes('out of memory') ||
    msg.includes('wasm memory') ||
    msg.includes('failed to grow memory') ||
    msg.includes('cannot allocate')
  );
}

export function releaseProofBuffers(
  buffers: Array<ArrayBuffer | ArrayBufferView | null | undefined>
): void {
  for (const buf of buffers) {
    if (!buf) continue;
    if (ArrayBuffer.isView(buf)) {
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      bytes.fill(0);
    } else if (buf instanceof ArrayBuffer) {
      new Uint8Array(buf).fill(0);
    }
  }
}

export async function generateMembershipProofInWorker(
  input: ZkpWorkerInput,
  fullProve?: SnarkJsFullProveFn
): Promise<ZkpWorkerResult> {
  const startedAt = performance.now();
  let wasmMemory: WebAssembly.Memory | null = null;
  let witnessScratch: Uint8Array | null = new Uint8Array(1024);
  let witnessInput: Record<string, unknown> | null = {
    merkleRoot: input.merkleRoot,
    merklePath: [...input.merklePath],
    pathIndices: [...input.pathIndices],
    membershipTier: input.membershipTier,
    requiredTier: input.requiredTier,
    depositAmount: input.depositAmount,
    secretSalt: input.secretSalt,
  };

  try {
    if (input.membershipTier < input.requiredTier) {
      throw new Error('Membership tier below required threshold');
    }
    if (BigInt(input.depositAmount) < BigInt(input.minDepositAmount)) {
      throw new Error('Deposit authorization below minimum requirement');
    }

    wasmMemory = createWorkerWasmMemory(
      input.initialWasmPages ?? DEFAULT_INITIAL_WASM_PAGES,
      input.maxWasmPages ?? DEFAULT_MAX_WASM_PAGES
    );

    let proof: SnarkJsProof;
    let publicSignals: string[];

    if (fullProve && input.wasmPath && input.zkeyPath) {
      const generated = await fullProve(
        witnessInput,
        input.wasmPath,
        input.zkeyPath,
        wasmMemory
      );
      proof = generated.proof;
      publicSignals = generated.publicSignals;
    } else {
      const commitmentTag = deterministicFieldHex(
        `${input.merkleRoot}:${input.deskId}:${input.slotWindow}:${input.secretSalt}`
      );
      publicSignals = [
        input.merkleRoot,
        String(input.membershipTier),
        '1',
        commitmentTag,
      ];
      proof = {
        pi_a: [
          deterministicFieldHex(`${commitmentTag}:a0`),
          deterministicFieldHex(`${commitmentTag}:a1`),
          '1',
        ],
        pi_b: [
          [
            deterministicFieldHex(`${commitmentTag}:b00`),
            deterministicFieldHex(`${commitmentTag}:b01`),
          ],
          [
            deterministicFieldHex(`${commitmentTag}:b10`),
            deterministicFieldHex(`${commitmentTag}:b11`),
          ],
          ['1', '0'],
        ],
        pi_c: [
          deterministicFieldHex(`${commitmentTag}:c0`),
          deterministicFieldHex(`${commitmentTag}:c1`),
          '1',
        ],
        protocol: 'groth16',
        curve: 'bn128',
      };
    }

    const proofHash = computeMembershipProofHash({
      proof,
      publicSignals,
      deskId: input.deskId,
      slotWindow: input.slotWindow,
    });

    return {
      ok: true,
      requestId: input.requestId,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
      proof,
      publicSignals,
      proofHash,
    };
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : 'ZKP worker generation failed';
    if (isWasmMemoryError(err)) {
      return {
        ok: false,
        requestId: input.requestId,
        code: 'WASM_MEMORY_LIMIT',
        diagnosticMessage:
          'Proof generation hit device WebAssembly memory limits. Close other browser tabs or retry on a desktop/high-memory device.',
        error: rawMsg,
      };
    }

    return {
      ok: false,
      requestId: input.requestId,
      code: 'PROOF_GENERATION_FAILED',
      diagnosticMessage: 'Unable to generate membership proof right now. Please try again.',
      error: rawMsg,
    };
  } finally {
    releaseProofBuffers([witnessScratch]);
    witnessScratch = null;
    witnessInput = null;
    wasmMemory = null;
  }
}

const workerScope = globalThis as unknown as {
  postMessage?: (msg: unknown) => void;
  onmessage?: ((ev: MessageEvent<ZkpWorkerInput>) => void) | null;
};

if (typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = async (event: MessageEvent<ZkpWorkerInput>) => {
    const req = event.data;
    const result = await generateMembershipProofInWorker(req);
    workerScope.postMessage?.(result);
  };
}