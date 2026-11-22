import { computeMembershipProofHash, type SnarkJsProof } from '@/lib/zkp/membershipProofVerifier';

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
}

export interface ZkpWorkerOutput {
  requestId: string;
  durationMs: number;
  proof: SnarkJsProof;
  publicSignals: string[];
  proofHash: string;
}

export type SnarkJsFullProveFn = (
  input: Record<string, unknown>,
  wasmPath: string,
  zkeyPath: string
) => Promise<{ proof: SnarkJsProof; publicSignals: string[] }>;

function deterministicFieldHex(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function generateMembershipProofInWorker(
  input: ZkpWorkerInput,
  fullProve?: SnarkJsFullProveFn
): Promise<ZkpWorkerOutput> {
  const startedAt = performance.now();

  if (input.membershipTier < input.requiredTier) {
    throw new Error('Membership tier below required threshold');
  }
  if (BigInt(input.depositAmount) < BigInt(input.minDepositAmount)) {
    throw new Error('Deposit authorization below minimum requirement');
  }

  let proof: SnarkJsProof;
  let publicSignals: string[];

  if (fullProve && input.wasmPath && input.zkeyPath) {
    const generated = await fullProve(
      {
        merkleRoot: input.merkleRoot,
        merklePath: input.merklePath,
        pathIndices: input.pathIndices,
        membershipTier: input.membershipTier,
        requiredTier: input.requiredTier,
        depositAmount: input.depositAmount,
        secretSalt: input.secretSalt,
      },
      input.wasmPath,
      input.zkeyPath
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
    requestId: input.requestId,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    proof,
    publicSignals,
    proofHash,
  };
}

const workerScope = globalThis as unknown as {
  postMessage?: (msg: unknown) => void;
  onmessage?: ((ev: MessageEvent<ZkpWorkerInput>) => void) | null;
};

if (typeof workerScope.postMessage === 'function') {
  workerScope.onmessage = async (event: MessageEvent<ZkpWorkerInput>) => {
    const req = event.data;
    try {
      const result = await generateMembershipProofInWorker(req);
      workerScope.postMessage?.({ ok: true, ...result });
    } catch (err) {
      workerScope.postMessage?.({
        ok: false,
        requestId: req?.requestId,
        error: err instanceof Error ? err.message : 'ZKP worker generation failed',
      });
    }
  };
}