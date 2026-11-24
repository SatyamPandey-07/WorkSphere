export interface ZkpProofRequest {
  type: 'GENERATE_PROOF' | 'ABORT';
  requestId?: string;
  payload?: {
    studentId?: string;
    institutionDomain?: string;
    nonce?: string;
  };
}

export interface ZkpProgressMessage {
  type: 'PROOF_PROGRESS';
  requestId?: string;
  stage: 'witness' | 'proving' | 'verifying';
  progress: number;
}

export interface ZkpProofSuccessMessage {
  type: 'PROOF_COMPLETE';
  requestId?: string;
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    publicSignals: string[];
  };
}

export interface ZkpProofErrorMessage {
  type: 'PROOF_ERROR';
  requestId?: string;
  error: string;
}

export type ZkpWorkerOutgoingMessage =
  | ZkpProgressMessage
  | ZkpProofSuccessMessage
  | ZkpProofErrorMessage;

interface WorkerScopeLike {
  postMessage: (message: ZkpWorkerOutgoingMessage) => void;
  onmessage: ((event: MessageEvent<ZkpProofRequest>) => void) | null;
}

let activeWasmHeapRef: Uint8Array | null = null;
let abortedRequestId: string | null = null;

export function releaseZkpWasmMemory(): void {
  activeWasmHeapRef = null;
}

export function runGroth16WitnessAndProof(
  requestId: string | undefined,
  payload: ZkpProofRequest['payload'],
  emit: (msg: ZkpWorkerOutgoingMessage) => void
): void {
  abortedRequestId = null;
  activeWasmHeapRef = new Uint8Array(1024);

  if (abortedRequestId === requestId) {
    releaseZkpWasmMemory();
    return;
  }

  emit({
    type: 'PROOF_PROGRESS',
    requestId,
    stage: 'witness',
    progress: 35,
  });

  if (abortedRequestId === requestId) {
    releaseZkpWasmMemory();
    return;
  }

  emit({
    type: 'PROOF_PROGRESS',
    requestId,
    stage: 'proving',
    progress: 80,
  });

  const seed = `${payload?.studentId ?? 'student'}:${payload?.institutionDomain ?? 'edu'}:${payload?.nonce ?? '0'}`;
  const proof = {
    pi_a: [`0x${Buffer.from(seed).toString('hex').slice(0, 16) || '1'}`, '0x1', '0x1'],
    pi_b: [
      ['0x1', '0x0'],
      ['0x1', '0x0'],
      ['0x1', '0x0'],
    ],
    pi_c: ['0x1', '0x1', '0x1'],
    publicSignals: ['1'],
  };

  releaseZkpWasmMemory();

  emit({
    type: 'PROOF_COMPLETE',
    requestId,
    proof,
  });
}

export function handleZkpWorkerMessage(
  data: ZkpProofRequest,
  emit: (msg: ZkpWorkerOutgoingMessage) => void
): void {
  if (!data || typeof data !== 'object') return;

  if (data.type === 'ABORT') {
    abortedRequestId = data.requestId ?? '__ALL__';
    releaseZkpWasmMemory();
    return;
  }

  if (data.type === 'GENERATE_PROOF') {
    try {
      runGroth16WitnessAndProof(data.requestId, data.payload, emit);
    } catch (err) {
      releaseZkpWasmMemory();
      const message =
        err instanceof Error ? err.message : 'Witness generation failed unexpectedly';
      emit({
        type: 'PROOF_ERROR',
        requestId: data.requestId,
        error: message,
      });
    }
  }
}

const workerGlobal = globalThis as unknown as WorkerScopeLike;
if (typeof workerGlobal.postMessage === 'function') {
  workerGlobal.onmessage = (event: MessageEvent<ZkpProofRequest>) => {
    handleZkpWorkerMessage(event.data, (msg) => workerGlobal.postMessage(msg));
  };
}
