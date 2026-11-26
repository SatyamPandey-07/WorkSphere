import { checkRateLimit } from '../rateLimit';

describe('Rate Limiter', () => {
  it('allows requests within threshold and blocks excess bursts', () => {
    const ip = '127.0.0.1';
    const options = { windowMs: 60000, maxRequests: 2 };

    expect(checkRateLimit(ip, options).allowed).toBe(true);
    expect(checkRateLimit(ip, options).allowed).toBe(true);
    expect(checkRateLimit(ip, options).allowed).toBe(false);
  });
});