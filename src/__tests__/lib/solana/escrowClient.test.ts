import {
  computeBackoffDelayMs,
  RPC_BUSY_USER_MESSAGE,
  SolanaEscrowClient,
  withRpcRateLimitRetry,
} from '@/lib/solana/escrowClient';

describe('SolanaEscrowClient 429 retry & exponential backoff', () => {
  it('computes 500ms -> 1000ms -> 2000ms base backoff with +/-200ms jitter', () => {
    expect(computeBackoffDelayMs(0, { randomFn: () => 0.5 })).toBe(500);
    expect(computeBackoffDelayMs(1, { randomFn: () => 0.5 })).toBe(1000);
    expect(computeBackoffDelayMs(2, { randomFn: () => 0.5 })).toBe(2000);

    expect(computeBackoffDelayMs(0, { randomFn: () => 1 })).toBe(700);
    expect(computeBackoffDelayMs(0, { randomFn: () => 0 })).toBe(300);
  });

  it('retries up to 3 times on HTTP 429 / Too Many Requests and succeeds on recovery', async () => {
    const sleepMock = jest.fn().mockResolvedValue(undefined);
    let calls = 0;

    const client = new SolanaEscrowClient(
      {
        getEscrowStatus: jest.fn().mockImplementation(async (escrowId: string) => {
          calls += 1;
          if (calls <= 3) {
            throw new Error('429 Too Many Requests: rate limit exceeded');
          }
          return { escrowId, status: 'funded', lamports: 1_000_000 };
        }),
      },
      { sleepFn: sleepMock, randomFn: () => 0.5 }
    );

    const result = await client.getEscrowStatus('escrow-abc');
    expect(result.status).toBe('funded');
    expect(calls).toBe(4);
    expect(sleepMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 500);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 1000);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 2000);
  });

  it('throws descriptive user message after 3 failed 429 retries', async () => {
    const sleepMock = jest.fn().mockResolvedValue(undefined);
    const failingOp = jest
      .fn()
      .mockRejectedValue({ status: 429, message: 'Too Many Requests' });

    await expect(
      withRpcRateLimitRetry(failingOp, {
        sleepFn: sleepMock,
        randomFn: () => 0.5,
      })
    ).rejects.toThrow(RPC_BUSY_USER_MESSAGE);

    expect(failingOp).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenCalledTimes(3);
  });
});
