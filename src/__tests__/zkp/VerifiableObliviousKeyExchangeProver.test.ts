import { describe, it, expect } from 'vitest';
import { VerifiableObliviousKeyExchangeProver, SAFE_PRIME_P } from '../../core/zkp/VerifiableObliviousKeyExchangeProver';

describe('VerifiableObliviousKeyExchangeProver', () => {
  const pake = new VerifiableObliviousKeyExchangeProver();

  it('derives identical authenticated session keys when passwords match and fails cleanly on password mismatch', () => {
    const ok = pake.executeAuditedHandshake('sess-01', 'alice-mobile', 'vault-api', 'correct-horse-battery', 'correct-horse-battery');
    expect(ok.authenticated).toBe(true);
    expect(ok.clientConfirmedServer).toBe(true);
    expect(ok.serverConfirmedClient).toBe(true);
    expect(ok.sessionKeyMatch).toBe(true);

    const wrongPw = pake.executeAuditedHandshake('sess-02', 'alice-mobile', 'vault-api', 'correct-horse-battery', 'wrong-password');
    expect(wrongPw.authenticated).toBe(false);
    expect(wrongPw.clientConfirmedServer).toBe(false);
    expect(wrongPw.serverConfirmedClient).toBe(false);
    expect(wrongPw.sessionKeyMatch).toBe(false);

    const parsed = JSON.parse(pake.serializeAudit(ok)) as { authenticated: boolean; sessionId: string };
    expect(parsed.authenticated).toBe(true);
    expect(parsed.sessionId).toBe('sess-01');
  });

  it('provides forward secrecy across sessions with identical passwords and rejects active MITM tampering', () => {
    const c1 = pake.initClient('s-a', 'u1', 'srv', 'same-pass');
    const s1 = pake.initServer('s-a', 'u1', 'srv', 'same-pass');
    const k1C = pake.clientFinish(c1, s1.pB);
    const k1S = pake.serverFinish(s1, c1.pA);
    expect(k1C.sessionKeyHex).toBe(k1S.sessionKeyHex);

    const c2 = pake.initClient('s-b', 'u1', 'srv', 'same-pass');
    const s2 = pake.initServer('s-b', 'u1', 'srv', 'same-pass');
    const k2C = pake.clientFinish(c2, s2.pB);
    expect(k2C.sessionKeyHex).not.toBe(k1C.sessionKeyHex);

    // Active MITM modifies pB in flight -> MACs fail immediately
    const tamperedPB = (s1.pB * 4n) % SAFE_PRIME_P;
    const mitmClient = pake.clientFinish(c1, tamperedPB);
    expect(mitmClient.serverConfirmMac).not.toBe(k1S.serverConfirmMac);
    expect(mitmClient.sessionKeyHex).not.toBe(k1S.sessionKeyHex);
  });

  it('rejects empty passwords, zero ephemerals, identity elements, and non-subgroup group elements', () => {
    expect(() => pake.derivePasswordScalar('', 'a', 'b')).toThrow();
    expect(() => pake.initClient('s', 'a', 'b', 'pw', 0n)).toThrow();
    expect(() => pake.initServer('s', 'a', 'b', 'pw', 0n)).toThrow();

    const c = pake.initClient('s', 'a', 'b', 'pw');
    const s = pake.initServer('s', 'a', 'b', 'pw');
    expect(() => pake.clientFinish(c, 1n)).toThrow();
    expect(() => pake.clientFinish(c, 0n)).toThrow();
    expect(() => pake.serverFinish(s, SAFE_PRIME_P - 1n)).toThrow(); // order-2 element -1 mod P is NOT in order-Q subgroup!
    expect(pake.isValidSubgroupElement(SAFE_PRIME_P - 1n)).toBe(false);
    expect(pake.isValidSubgroupElement(c.pA)).toBe(true);
  });

  it('binds clientId and serverId into the transcript so identity reflection attacks fail', () => {
    const c = pake.initClient('s-id', 'alice', 'bank-prod', 'secret123');
    const sWrongId = pake.initServer('s-id', 'alice', 'bank-staging', 'secret123');
    const kc = pake.clientFinish(c, sWrongId.pB);
    const ks = pake.serverFinish(sWrongId, c.pA);
    expect(kc.sessionKeyHex).not.toBe(ks.sessionKeyHex);
    expect(kc.serverConfirmMac).not.toBe(ks.serverConfirmMac);

    // Deterministic ephemeral override reproducibility
    const cDet1 = pake.initClient('det', 'a', 'b', 'pw', 12345n);
    const cDet2 = pake.initClient('det', 'a', 'b', 'pw', 12345n);
    expect(cDet1.pA).toBe(cDet2.pA);
  });

  it('produces distinct session keys across different sessionIds and rejects replayed messages from another session', () => {
    const cA = pake.initClient('session-alpha', 'device-1', 'auth-srv', 'shared-secret', 10101n);
    const sA = pake.initServer('session-alpha', 'device-1', 'auth-srv', 'shared-secret', 20202n);
    const schedAC = pake.clientFinish(cA, sA.pB);
    const schedAS = pake.serverFinish(sA, cA.pA);
    expect(schedAC.sessionKeyHex).toBe(schedAS.sessionKeyHex);
    expect(schedAC.clientConfirmMac).toBe(schedAS.clientConfirmMac);
    expect(schedAC.serverConfirmMac).toBe(schedAS.serverConfirmMac);

    // Same ephemerals and password under a different sessionId MUST yield a completely different key
    const cB = pake.initClient('session-beta', 'device-1', 'auth-srv', 'shared-secret', 10101n);
    const sB = pake.initServer('session-beta', 'device-1', 'auth-srv', 'shared-secret', 20202n);
    const schedBC = pake.clientFinish(cB, sB.pB);
    const schedBS = pake.serverFinish(sB, cB.pA);
    expect(schedBC.sessionKeyHex).toBe(schedBS.sessionKeyHex);
    expect(schedBC.sessionKeyHex).not.toBe(schedAC.sessionKeyHex);
    expect(schedBC.transcriptHash).not.toBe(schedAC.transcriptHash);

    // Cross-session replay: client expects session-alpha while server computes session-beta
    const crossServer = pake.serverFinish(sB, cA.pA);
    expect(crossServer.serverConfirmMac).not.toBe(schedAC.serverConfirmMac);
    expect(crossServer.clientConfirmMac).not.toBe(schedAC.clientConfirmMac);
  });

  it('verifies clientConfirmMac and serverConfirmMac are domain-separated and never equal', () => {
    const c = pake.initClient('dom-sep', 'peer-1', 'peer-2', 'high-entropy-pass');
    const s = pake.initServer('dom-sep', 'peer-1', 'peer-2', 'high-entropy-pass');
    const kC = pake.clientFinish(c, s.pB);
    const kS = pake.serverFinish(s, c.pA);

    expect(kC.sessionKeyHex).toHaveLength(64);
    expect(kC.clientConfirmMac).toHaveLength(64);
    expect(kC.serverConfirmMac).toHaveLength(64);
    expect(kC.clientConfirmMac).not.toBe(kC.serverConfirmMac);
    expect(kC.clientConfirmMac).toBe(kS.clientConfirmMac);
    expect(kC.serverConfirmMac).toBe(kS.serverConfirmMac);

    // Invalid group elements beyond SAFE_PRIME_P rejected
    expect(pake.isValidSubgroupElement(SAFE_PRIME_P)).toBe(false);
    expect(pake.isValidSubgroupElement(SAFE_PRIME_P + 5n)).toBe(false);
    expect(() => pake.serverFinish(s, SAFE_PRIME_P)).toThrow();
  });

  it('runs multiple concurrent independent client handshakes against the same server identity', () => {
    const users = ['u-alpha', 'u-beta', 'u-gamma', 'u-delta'];
    const keys = new Set<string>();
    for (let i = 0; i < users.length; i++) {
      const pw = `pass-${i}-2026`;
      const audit = pake.executeAuditedHandshake(`multi-${i}`, users[i], 'central-gateway', pw, pw);
      expect(audit.authenticated).toBe(true);
      expect(audit.sessionKeyMatch).toBe(true);
      keys.add(audit.transcriptHash);
    }
    expect(keys.size).toBe(users.length);
  });
});
