import { rateLimit, resetRateLimit } from '@/lib/rateLimit';

describe('Rate Limiting', () => {
  beforeEach(() => {
    resetRateLimit();
  });

  it('should allow requests under the limit', () => {
    const ip = '192.168.1.1';
    
    for (let i = 0; i < 10; i++) {
      expect(rateLimit(ip)).toBe(true);
    }
  });

  it('should block requests over the limit', () => {
    const ip = '192.168.1.2';
    
    // Make 10 requests (default limit)
    for (let i = 0; i < 10; i++) {
      rateLimit(ip);
    }
    
    // 11th request should be blocked
    expect(rateLimit(ip)).toBe(false);
  });

  it('should track different IPs separately', () => {
    const ip1 = '192.168.1.3';
    const ip2 = '192.168.1.4';
    
    // Exhaust limit for ip1
    for (let i = 0; i < 10; i++) {
      rateLimit(ip1);
    }
    
    // ip2 should still be allowed
    expect(rateLimit(ip2)).toBe(true);
  });

  it('should respect custom limits', () => {
    const ip = '192.168.1.5';
    
    // Custom limit of 5
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(ip, 5)).toBe(true);
    }
    
    expect(rateLimit(ip, 5)).toBe(false);
  });
});
