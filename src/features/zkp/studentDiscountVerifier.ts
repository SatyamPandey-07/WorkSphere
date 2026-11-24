import type { ZkpWorkerOutgoingMessage } from '@/workers/zkpWorker';

export const ZKP_WATCHDOG_TIMEOUT_MS = 30_000;
export const ZKP_TIMEOUT_USER_ALERT =
  'Proof generation timed out. Please try again.';

export interface StudentDiscountProofInput {
  studentId: string;
  institutionDomain: string;
  nonce?: string;
}

export interface StudentDiscountProofResult {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    publicSignals: string[];
  };
  timedOut: false;
  canRetry: true;
}

export interface ZkpWorkerLike {
  postMessage: (message: unknown) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<ZkpWorkerOutgoingMessage>) => void) | null;
  onerror: ((event: ErrorEvent | unknown) => void) | null;
}

export interface VerifyStudentDiscountOptions {
  timeoutMs?: number;
  workerFactory?: () => ZkpWorkerLike;
  onProgress?: (progress: number, stage?: string) => void;
}

export class ProofGenerationTimeoutError extends Error {
  public readonly canRetry = true;
  public readonly code = 'ZKP_WITNESS_TIMEOUT';

  constructor(message: string = ZKP_TIMEOUT_USER_ALERT) {
    super(message);
    this.name = 'ProofGenerationTimeoutError';
  }
}

function defaultWorkerFactory(): ZkpWorkerLike {
  return new Worker(new URL('../../workers/zkpWorker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as ZkpWorkerLike;
}

export function createStudentDiscountVerifier(
  options: VerifyStudentDiscountOptions = {}
) {
  const timeoutMs = options.timeoutMs ?? ZKP_WATCHDOG_TIMEOUT_MS;
  const createWorker = options.workerFactory ?? defaultWorkerFactory;

  async function generateStudentDiscountProof(
    input: StudentDiscountProofInput,
    callOptions: Pick<VerifyStudentDiscountOptions, 'onProgress' | 'timeoutMs'> = {}
  ): Promise<StudentDiscountProofResult> {
    const effectiveTimeoutMs = callOptions.timeoutMs ?? timeoutMs;
    const progressCallback = callOptions.onProgress ?? options.onProgress;

    return new Promise<StudentDiscountProofResult>((resolve, reject) => {
      let settled = false;
      let watchdogId: ReturnType<typeof setTimeout> | null = null;
      let worker: ZkpWorkerLike | null = null;

      const clearWatchdog = () => {
        if (watchdogId !== null) {
          clearTimeout(watchdogId);
          watchdogId = null;
        }
      };

      const cleanupListeners = () => {
        if (worker) {
          worker.onmessage = null;
          worker.onerror = null;
        }
      };

      const settleOnce = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearWatchdog();
        cleanupListeners();
        fn();
      };

      const armWatchdog = () => {
        clearWatchdog();
        watchdogId = setTimeout(() => {
          settleOnce(() => {
            if (worker) {
              try {
                worker.postMessage({ type: 'ABORT' });
              } catch {
                // Ignore if worker thread is wedged
              }
              try {
                worker.terminate();
              } catch {
                // Ignore termination errors
              }
              worker = null;
            }
            reject(new ProofGenerationTimeoutError(ZKP_TIMEOUT_USER_ALERT));
          });
        }, effectiveTimeoutMs);
      };

      try {
        worker = createWorker();
      } catch (err) {
        settleOnce(() => {
          reject(
            err instanceof Error
              ? err
              : new Error('Unable to initialize proof worker')
          );
        });
        return;
      }

      worker.onmessage = (event: MessageEvent<ZkpWorkerOutgoingMessage>) => {
        if (settled) return;
        const msg = event?.data;
        if (!msg || typeof msg !== 'object') return;

        if (msg.type === 'PROOF_PROGRESS') {
          armWatchdog();
          progressCallback?.(msg.progress, msg.stage);
          return;
        }

        if (msg.type === 'PROOF_COMPLETE') {
          settleOnce(() => {
            if (worker) {
              worker.terminate();
              worker = null;
            }
            resolve({
              proof: msg.proof,
              timedOut: false,
              canRetry: true,
            });
          });
          return;
        }

        if (msg.type === 'PROOF_ERROR') {
          settleOnce(() => {
            if (worker) {
              worker.terminate();
              worker = null;
            }
            reject(new Error(msg.error || 'Proof generation failed'));
          });
        }
      };

      worker.onerror = (event: unknown) => {
        if (settled) return;
        settleOnce(() => {
          if (worker) {
            worker.terminate();
            worker = null;
          }
          const detail =
            event && typeof event === 'object' && 'message' in event
              ? String((event as { message?: unknown }).message ?? '')
              : '';
          reject(
            new Error(detail || 'WebAssembly proof worker encountered an error')
          );
        });
      };

      armWatchdog();
      worker.postMessage({
        type: 'GENERATE_PROOF',
        payload: input,
      });
    });
  }

  return {
    generateStudentDiscountProof,
    timeoutMs,
    alertMessage: ZKP_TIMEOUT_USER_ALERT,
  };
}
