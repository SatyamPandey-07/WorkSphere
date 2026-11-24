import {
  createStudentDiscountVerifier,
  ZKP_TIMEOUT_USER_ALERT,
  ZKP_WATCHDOG_TIMEOUT_MS,
  type ZkpWorkerLike,
} from '@/features/zkp/studentDiscountVerifier';
import type { ZkpWorkerOutgoingMessage } from '@/workers/zkpWorker';

interface MockZkpWorker extends ZkpWorkerLike {
  emitMessage: (msg: ZkpWorkerOutgoingMessage) => void;
  terminateMock: jest.Mock;
}

function createMockWorker(): MockZkpWorker {
  const terminateMock = jest.fn();
  const mockWorker: MockZkpWorker = {
    postMessage: jest.fn(),
    terminate: terminateMock,
    terminateMock,
    onmessage: null,
    onerror: null,
    emitMessage(msg: ZkpWorkerOutgoingMessage) {
      mockWorker.onmessage?.({ data: msg } as MessageEvent<ZkpWorkerOutgoingMessage>);
    },
  };
  return mockWorker;
}

describe('studentDiscountVerifier 30s watchdog & worker stall handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('terminates stalled worker after 30s without progress and surfaces friendly retry alert', async () => {
    const worker = createMockWorker();
    const verifier = createStudentDiscountVerifier({
      workerFactory: () => worker,
    });

    const promise = verifier.generateStudentDiscountProof({
      studentId: 'stu-101',
      institutionDomain: 'rizvi.edu.in',
    });

    const assertion = expect(promise).rejects.toMatchObject({
      message: ZKP_TIMEOUT_USER_ALERT,
      canRetry: true,
    });

    await jest.advanceTimersByTimeAsync(ZKP_WATCHDOG_TIMEOUT_MS);

    expect(worker.terminateMock).toHaveBeenCalledTimes(1);
    await assertion;
  });

  it('resets watchdog timer on PROOF_PROGRESS messages and completes once proof finishes', async () => {
    const worker = createMockWorker();
    const onProgress = jest.fn();
    const verifier = createStudentDiscountVerifier({
      workerFactory: () => worker,
      onProgress,
    });

    const promise = verifier.generateStudentDiscountProof({
      studentId: 'stu-102',
      institutionDomain: 'mu.ac.in',
    });

    await jest.advanceTimersByTimeAsync(20_000);
    worker.emitMessage({
      type: 'PROOF_PROGRESS',
      stage: 'witness',
      progress: 50,
    });
    expect(onProgress).toHaveBeenCalledWith(50, 'witness');

    await jest.advanceTimersByTimeAsync(20_000);
    expect(worker.terminateMock).not.toHaveBeenCalled();

    worker.emitMessage({
      type: 'PROOF_COMPLETE',
      proof: {
        pi_a: ['0x1', '0x1', '0x1'],
        pi_b: [['0x1'], ['0x1'], ['0x1']],
        pi_c: ['0x1', '0x1', '0x1'],
        publicSignals: ['1'],
      },
    });

    const result = await promise;
    expect(result.timedOut).toBe(false);
    expect(worker.terminateMock).toHaveBeenCalledTimes(1);
  });
});
