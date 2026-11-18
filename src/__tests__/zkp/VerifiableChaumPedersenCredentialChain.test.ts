import { describe, it, expect } from 'vitest';
import { VerifiableChaumPedersenCredentialChain } from '../../core/zkp/VerifiableChaumPedersenCredentialChain';

describe('VerifiableChaumPedersenCredentialChain', () => {
  it('verifies 3-hop attenuated delegation chains, blocks privilege escalation, and enforces revocation', () => {
    const chain = new VerifiableChaumPedersenCredentialChain();
    const rootCA = chain.generateEntityKey('root-ca');
    const orgKey = chain.generateEntityKey('org-eng');
    const svcKey = chain.generateEntityKey('svc-runner');

    const c1 = chain.issueCertificate('cert-org', rootCA, 'org-eng', orgKey.publicKey, ['read', 'write', 'deploy'], 100);
    const c2 = chain.issueCertificate('cert-svc', orgKey, 'svc-runner', svcKey.publicKey, ['read', 'deploy'], 80);

    const invoke = chain.createInvocationProof('inv-1', rootCA.publicKey, [c1, c2], svcKey, 'deploy', 50, 'nonce-abc');
    expect(chain.verifyInvocationProof(invoke, rootCA.publicKey).valid).toBe(true);

    // Requesting ungranted scope 'write' must fail
    const badScope = chain.createInvocationProof('inv-2', rootCA.publicKey, [c1, c2], svcKey, 'write', 50, 'n2');
    expect(chain.verifyInvocationProof(badScope, rootCA.publicKey).valid).toBe(false);

    // Privilege escalation: child claims 'admin' not held by parent
    const cEscalated = chain.issueCertificate('cert-esc', orgKey, 'svc-runner', svcKey.publicKey, ['admin'], 80);
    const escInvoke = chain.createInvocationProof('inv-3', rootCA.publicKey, [c1, cEscalated], svcKey, 'admin', 50, 'n3');
    const escRes = chain.verifyInvocationProof(escInvoke, rootCA.publicKey);
    expect(escRes.valid).toBe(false);
    expect(escRes.failedHopIndex).toBe(1);

    const json = chain.serializeInvocation(invoke);
    const restored = chain.deserializeInvocation(json);
    expect(restored).toEqual(invoke);
    expect(chain.verifyInvocationProof(restored, rootCA.publicKey).valid).toBe(true);

    // Revoking intermediate org cert immediately invalidates leaf invocation!
    chain.revokeCertificate('cert-org');
    expect(chain.verifyInvocationProof(invoke, rootCA.publicKey).valid).toBe(false);
  });
});
