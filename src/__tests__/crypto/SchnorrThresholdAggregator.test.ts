import {
    SchnorrThresholdAggregator,
    ECPoint,
    ParticipantInfo,
    KeyPair
} from '../../core/crypto/SchnorrThresholdAggregator';

describe('SchnorrThresholdAggregator', () => {
    let aggregator: SchnorrThresholdAggregator;
    let cosignerA: KeyPair;
    let cosignerB: KeyPair;
    let cosignerC: KeyPair;
    let participants: ParticipantInfo[];
    const message = Buffer.from('WorkSphere Escrow Multi-Sig Agreement #2026-99', 'utf8');

    beforeEach(() => {
        aggregator = new SchnorrThresholdAggregator();
        cosignerA = SchnorrThresholdAggregator.generateKeyPair();
        cosignerB = SchnorrThresholdAggregator.generateKeyPair();
        cosignerC = SchnorrThresholdAggregator.generateKeyPair();

        participants = [
            { id: 'alice', publicKey: cosignerA.publicKey },
            { id: 'bob', publicKey: cosignerB.publicKey },
            { id: 'charlie', publicKey: cosignerC.publicKey }
        ];
    });

    afterEach(() => {
        aggregator.dispose();
        jest.useRealTimers();
    });

    describe('Curve Arithmetic & Field Primitives', () => {
        it('verifies generator point doubling and addition', () => {
            const G = SchnorrThresholdAggregator.getGenerator();
            const twoG = SchnorrThresholdAggregator.pointAdd(G, G);
            const mul2G = SchnorrThresholdAggregator.pointMul(2n, G);

            expect(twoG.x).toBe(mul2G.x);
            expect(twoG.y).toBe(mul2G.y);
        });

        it('verifies scalar multiplication identity with 1*G = G', () => {
            const G = SchnorrThresholdAggregator.getGenerator();
            const oneG = SchnorrThresholdAggregator.pointMul(1n, G);
            expect(oneG.x).toBe(G.x);
            expect(oneG.y).toBe(G.y);
        });
    });

    describe('MuSig2 Key Aggregation', () => {
        it('aggregates public keys with deterministic rogue-key resistant coefficients', () => {
            const { aggregatedPublicKey, coefficients } = SchnorrThresholdAggregator.aggregatePublicKeys(participants);

            expect(aggregatedPublicKey.x).toBeDefined();
            expect(aggregatedPublicKey.y).toBeDefined();
            expect(coefficients.size).toBe(3);
            expect(coefficients.has('alice')).toBe(true);
            expect(coefficients.has('bob')).toBe(true);
            expect(coefficients.has('charlie')).toBe(true);
        });

        it('throws an error if participant list is empty', () => {
            expect(() => SchnorrThresholdAggregator.aggregatePublicKeys([])).toThrow();
        });
    });

    describe('Two-Round Nonces & Challenge Computation', () => {
        it('coordinates nonce exchange and transitions session state', () => {
            const session = aggregator.createSession('session-test-01', participants, message);
            expect(session.state).toBe('INIT');

            const noncesA = SchnorrThresholdAggregator.generateNoncePair('alice');
            const noncesB = SchnorrThresholdAggregator.generateNoncePair('bob');
            const noncesC = SchnorrThresholdAggregator.generateNoncePair('charlie');

            aggregator.submitNonces('session-test-01', noncesA.publicNonces);
            expect(session.state).toBe('INIT');

            aggregator.submitNonces('session-test-01', noncesB.publicNonces);
            aggregator.submitNonces('session-test-01', noncesC.publicNonces);

            expect(session.state).toBe('NONCES_EXCHANGED');
            expect(session.aggregateNonce).toBeDefined();
            expect(session.nonceBindingFactor).toBeDefined();

            const e = aggregator.computeChallenge(session);
            expect(e).toBeGreaterThan(0n);
        });
    });

    describe('Partial Signature Generation, Verification & Misbehavior Detection', () => {
        it('validates authentic partial signatures and rejects corrupted ones', () => {
            const session = aggregator.createSession('session-test-02', participants, message);
            const noncesA = SchnorrThresholdAggregator.generateNoncePair('alice');
            const noncesB = SchnorrThresholdAggregator.generateNoncePair('bob');
            const noncesC = SchnorrThresholdAggregator.generateNoncePair('charlie');

            aggregator.submitNonces('session-test-02', noncesA.publicNonces);
            aggregator.submitNonces('session-test-02', noncesB.publicNonces);
            aggregator.submitNonces('session-test-02', noncesC.publicNonces);

            // Valid signature from Alice
            const sigA = aggregator.signPartial(session, 'alice', cosignerA.privateKey, noncesA);
            expect(aggregator.verifyPartialSignature(session, 'alice', sigA)).toBe(true);

            // Corrupted signature from Bob
            const corruptedSig = sigA + 12345n;
            expect(aggregator.verifyPartialSignature(session, 'bob', corruptedSig)).toBe(false);

            // Submitting corrupted signature throws error
            expect(() => {
                aggregator.submitPartialSignature('session-test-02', 'bob', corruptedSig);
            }).toThrow('Malicious or invalid partial signature rejected');
        });
    });

    it('rejects a second partial signature from the same signer without replacing the accepted share', () => {
        const sessionId = 'session-test-duplicate-signer';
        const session = aggregator.createSession(sessionId, participants, message);
        const noncesA = SchnorrThresholdAggregator.generateNoncePair('alice');
        const noncesB = SchnorrThresholdAggregator.generateNoncePair('bob');
        const noncesC = SchnorrThresholdAggregator.generateNoncePair('charlie');

        aggregator.submitNonces(sessionId, noncesA.publicNonces);
        aggregator.submitNonces(sessionId, noncesB.publicNonces);
        aggregator.submitNonces(sessionId, noncesC.publicNonces);

        const sigA = aggregator.signPartial(session, 'alice', cosignerA.privateKey, noncesA);
        const sigB = aggregator.signPartial(session, 'bob', cosignerB.privateKey, noncesB);
        const sigC = aggregator.signPartial(session, 'charlie', cosignerC.privateKey, noncesC);

        aggregator.submitPartialSignature(sessionId, 'alice', sigA);
        expect(() => {
            aggregator.submitPartialSignature(sessionId, 'alice', sigA + 1n);
        }).toThrow('Duplicate partial signature rejected from participant alice');

        expect(session.partialSignatures.size).toBe(1);
        expect(session.partialSignatures.get('alice')).toBe(sigA);
        expect(session.state).toBe('NONCES_EXCHANGED');

        // Other signers can still contribute exactly once and complete the session.
        aggregator.submitPartialSignature(sessionId, 'bob', sigB);
        aggregator.submitPartialSignature(sessionId, 'charlie', sigC);
        expect(session.partialSignatures.size).toBe(3);
        expect(session.state).toBe('PARTIALS_COLLECTED');
    });

    describe('End-to-End Signature Aggregation & BIP 340 Verification', () => {
        it('successfully produces a 64-byte aggregated Schnorr signature that verifies against P_agg', () => {
            const session = aggregator.createSession('session-test-03', participants, message);
            const noncesA = SchnorrThresholdAggregator.generateNoncePair('alice');
            const noncesB = SchnorrThresholdAggregator.generateNoncePair('bob');
            const noncesC = SchnorrThresholdAggregator.generateNoncePair('charlie');

            aggregator.submitNonces('session-test-03', noncesA.publicNonces);
            aggregator.submitNonces('session-test-03', noncesB.publicNonces);
            aggregator.submitNonces('session-test-03', noncesC.publicNonces);

            const sigA = aggregator.signPartial(session, 'alice', cosignerA.privateKey, noncesA);
            const sigB = aggregator.signPartial(session, 'bob', cosignerB.privateKey, noncesB);
            const sigC = aggregator.signPartial(session, 'charlie', cosignerC.privateKey, noncesC);

            aggregator.submitPartialSignature('session-test-03', 'alice', sigA);
            aggregator.submitPartialSignature('session-test-03', 'bob', sigB);
            aggregator.submitPartialSignature('session-test-03', 'charlie', sigC);

            expect(session.state).toBe('PARTIALS_COLLECTED');

            const { signature, rX, s } = aggregator.aggregateSignature('session-test-03');
            expect(signature.length).toBe(64);
            expect(rX.length).toBe(64);
            expect(s.length).toBe(64);
            expect(session.state).toBe('FINALIZED');

            // BIP 340 Verification
            const isValid = SchnorrThresholdAggregator.verifyAggregatedSignature(
                message,
                signature,
                session.aggregatedPublicKey
            );
            expect(isValid).toBe(true);

            // Tampered message fails verification
            const tamperedMessage = Buffer.from('WorkSphere Escrow Tampered Payload', 'utf8');
            const isTamperedValid = SchnorrThresholdAggregator.verifyAggregatedSignature(
                tamperedMessage,
                signature,
                session.aggregatedPublicKey
            );
            expect(isTamperedValid).toBe(false);
        });
    });
    it('evicts incomplete signing sessions after the five-minute TTL', () => {
        jest.useFakeTimers();
        aggregator.dispose();
        aggregator = new SchnorrThresholdAggregator(5 * 60_000, 30_000);

        const sessionId = 'session-expiry';
        aggregator.createSession(sessionId, participants, message);
        expect(aggregator.getSession(sessionId)).toBeDefined();

        jest.advanceTimersByTime(5 * 60_000);

        expect(aggregator.getSession(sessionId)).toBeUndefined();
    });

});
