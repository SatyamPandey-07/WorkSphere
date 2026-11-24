import {
  SchnorrThresholdAggregator,
  ECPoint,
  ParticipantInfo,
  KeyPair,
  SECP256K1_P,
  POINT_AT_INFINITY,
} from "../../core/crypto/SchnorrThresholdAggregator";

describe("SchnorrThresholdAggregator", () => {
  let aggregator: SchnorrThresholdAggregator;
  let cosignerA: KeyPair;
  let cosignerB: KeyPair;
  let cosignerC: KeyPair;
  let participants: ParticipantInfo[];
  const message = Buffer.from(
    "WorkSphere Escrow Multi-Sig Agreement #2026-99",
    "utf8",
  );

  beforeEach(() => {
    aggregator = new SchnorrThresholdAggregator();
    cosignerA = SchnorrThresholdAggregator.generateKeyPair();
    cosignerB = SchnorrThresholdAggregator.generateKeyPair();
    cosignerC = SchnorrThresholdAggregator.generateKeyPair();

    participants = [
      { id: "alice", publicKey: cosignerA.publicKey },
      { id: "bob", publicKey: cosignerB.publicKey },
      { id: "charlie", publicKey: cosignerC.publicKey },
    ];
  });

  afterEach(() => {
    aggregator.dispose();
    jest.useRealTimers();
  });

  describe("Curve Arithmetic & Field Primitives", () => {
    it("verifies generator point doubling and addition", () => {
      const G = SchnorrThresholdAggregator.getGenerator();
      const twoG = SchnorrThresholdAggregator.pointAdd(G, G);
      const mul2G = SchnorrThresholdAggregator.pointMul(2n, G);

      expect(twoG.x).toBe(mul2G.x);
      expect(twoG.y).toBe(mul2G.y);
    });
    it("verifies scalar multiplication identity with 1*G = G", () => {
      const G = SchnorrThresholdAggregator.getGenerator();
      const oneG = SchnorrThresholdAggregator.pointMul(1n, G);
      expect(oneG.x).toBe(G.x);
      expect(oneG.y).toBe(G.y);
    });
  });

  describe("MuSig2 Key Aggregation", () => {
    it("aggregates public keys with deterministic rogue-key resistant coefficients", () => {
      const { aggregatedPublicKey, coefficients } =
        SchnorrThresholdAggregator.aggregatePublicKeys(participants);

      expect(aggregatedPublicKey.x).toBeDefined();
      expect(aggregatedPublicKey.y).toBeDefined();
      expect(coefficients.size).toBe(3);
      expect(coefficients.has("alice")).toBe(true);
      expect(coefficients.has("bob")).toBe(true);
      expect(coefficients.has("charlie")).toBe(true);
    });

    it("throws an error if participant list is empty", () => {
      expect(() =>
        SchnorrThresholdAggregator.aggregatePublicKeys([]),
      ).toThrow();
    });
  });

  describe("Two-Round Nonces & Challenge Computation", () => {
    it("coordinates nonce exchange and transitions session state", () => {
      const session = aggregator.createSession(
        "session-test-01",
        participants,
        message,
      );
      expect(session.state).toBe("INIT");

      const noncesA = SchnorrThresholdAggregator.generateNoncePair("alice");
      const noncesB = SchnorrThresholdAggregator.generateNoncePair("bob");
      const noncesC = SchnorrThresholdAggregator.generateNoncePair("charlie");

      aggregator.submitNonces("session-test-01", noncesA.publicNonces);
      expect(session.state).toBe("INIT");

      aggregator.submitNonces("session-test-01", noncesB.publicNonces);
      aggregator.submitNonces("session-test-01", noncesC.publicNonces);

      expect(session.state).toBe("NONCES_EXCHANGED");
      expect(session.aggregateNonce).toBeDefined();
      expect(session.nonceBindingFactor).toBeDefined();

      const e = aggregator.computeChallenge(session);
      expect(e).toBeGreaterThan(0n);
    });
  });

  describe("Partial Signature Generation, Verification & Misbehavior Detection", () => {
    it("validates authentic partial signatures and rejects corrupted ones", () => {
      const session = aggregator.createSession(
        "session-test-02",
        participants,
        message,
      );
      const noncesA = SchnorrThresholdAggregator.generateNoncePair("alice");
      const noncesB = SchnorrThresholdAggregator.generateNoncePair("bob");
      const noncesC = SchnorrThresholdAggregator.generateNoncePair("charlie");

      aggregator.submitNonces("session-test-02", noncesA.publicNonces);
      aggregator.submitNonces("session-test-02", noncesB.publicNonces);
      aggregator.submitNonces("session-test-02", noncesC.publicNonces);

      // Valid signature from Alice
      const sigA = aggregator.signPartial(
        session,
        "alice",
        cosignerA.privateKey,
        noncesA,
      );
      expect(aggregator.verifyPartialSignature(session, "alice", sigA)).toBe(
        true,
      );

      // Corrupted signature from Bob
      const corruptedSig = sigA + 12345n;
      expect(
        aggregator.verifyPartialSignature(session, "bob", corruptedSig),
      ).toBe(false);

      // Submitting corrupted signature throws error
      expect(() => {
        aggregator.submitPartialSignature(
          "session-test-02",
          "bob",
          corruptedSig,
        );
      }).toThrow("Malicious or invalid partial signature rejected");
    });
  });

  it("rejects a second partial signature from the same signer without replacing the accepted share", () => {
    const sessionId = "session-test-duplicate-signer";
    const session = aggregator.createSession(sessionId, participants, message);
    const noncesA = SchnorrThresholdAggregator.generateNoncePair("alice");
    const noncesB = SchnorrThresholdAggregator.generateNoncePair("bob");
    const noncesC = SchnorrThresholdAggregator.generateNoncePair("charlie");

    aggregator.submitNonces(sessionId, noncesA.publicNonces);
    aggregator.submitNonces(sessionId, noncesB.publicNonces);
    aggregator.submitNonces(sessionId, noncesC.publicNonces);

    const sigA = aggregator.signPartial(
      session,
      "alice",
      cosignerA.privateKey,
      noncesA,
    );
    const sigB = aggregator.signPartial(
      session,
      "bob",
      cosignerB.privateKey,
      noncesB,
    );
    const sigC = aggregator.signPartial(
      session,
      "charlie",
      cosignerC.privateKey,
      noncesC,
    );

    aggregator.submitPartialSignature(sessionId, "alice", sigA);
    expect(() => {
      aggregator.submitPartialSignature(sessionId, "alice", sigA + 1n);
    }).toThrow("Duplicate partial signature rejected from participant alice");

    expect(session.partialSignatures.size).toBe(1);
    expect(session.partialSignatures.get("alice")).toBe(sigA);
    expect(session.state).toBe("NONCES_EXCHANGED");

    // Other signers can still contribute exactly once and complete the session.
    aggregator.submitPartialSignature(sessionId, "bob", sigB);
    aggregator.submitPartialSignature(sessionId, "charlie", sigC);
    expect(session.partialSignatures.size).toBe(3);
    expect(session.state).toBe("PARTIALS_COLLECTED");
  });

  describe("End-to-End Signature Aggregation & BIP 340 Verification", () => {
    it("successfully produces a 64-byte aggregated Schnorr signature that verifies against P_agg", () => {
      const session = aggregator.createSession(
        "session-test-03",
        participants,
        message,
      );
      const noncesA = SchnorrThresholdAggregator.generateNoncePair("alice");
      const noncesB = SchnorrThresholdAggregator.generateNoncePair("bob");
      const noncesC = SchnorrThresholdAggregator.generateNoncePair("charlie");

      aggregator.submitNonces("session-test-03", noncesA.publicNonces);
      aggregator.submitNonces("session-test-03", noncesB.publicNonces);
      aggregator.submitNonces("session-test-03", noncesC.publicNonces);

      const sigA = aggregator.signPartial(
        session,
        "alice",
        cosignerA.privateKey,
        noncesA,
      );
      const sigB = aggregator.signPartial(
        session,
        "bob",
        cosignerB.privateKey,
        noncesB,
      );
      const sigC = aggregator.signPartial(
        session,
        "charlie",
        cosignerC.privateKey,
        noncesC,
      );

      aggregator.submitPartialSignature("session-test-03", "alice", sigA);
      aggregator.submitPartialSignature("session-test-03", "bob", sigB);
      aggregator.submitPartialSignature("session-test-03", "charlie", sigC);

      expect(session.state).toBe("PARTIALS_COLLECTED");

      const { signature, rX, s } =
        aggregator.aggregateSignature("session-test-03");
      expect(signature.length).toBe(64);
      expect(rX.length).toBe(64);
      expect(s.length).toBe(64);
      expect(session.state).toBe("FINALIZED");

      // BIP 340 Verification
      const isValid = SchnorrThresholdAggregator.verifyAggregatedSignature(
        message,
        signature,
        session.aggregatedPublicKey,
      );
      expect(isValid).toBe(true);

      // Tampered message fails verification
      const tamperedMessage = Buffer.from(
        "WorkSphere Escrow Tampered Payload",
        "utf8",
      );
      const isTamperedValid =
        SchnorrThresholdAggregator.verifyAggregatedSignature(
          tamperedMessage,
          signature,
          session.aggregatedPublicKey,
        );
      expect(isTamperedValid).toBe(false);
    });
  });
  it("evicts incomplete signing sessions after the five-minute TTL", () => {
    jest.useFakeTimers();
    aggregator.dispose();
    aggregator = new SchnorrThresholdAggregator(5 * 60_000, 30_000);

    const sessionId = "session-expiry";
    aggregator.createSession(sessionId, participants, message);
    expect(aggregator.getSession(sessionId)).toBeDefined();

    jest.advanceTimersByTime(5 * 60_000);

    expect(aggregator.getSession(sessionId)).toBeUndefined();
  });

  describe("secp256k1 Point Validation & Malformed Input Rejection (#10090)", () => {
    it("accepts valid secp256k1 curve points (generator and keypair points)", () => {
      const G = SchnorrThresholdAggregator.getGenerator();
      expect(SchnorrThresholdAggregator.isValidPoint(G)).toBe(true);
      expect(() => SchnorrThresholdAggregator.validatePoint(G)).not.toThrow();

      expect(SchnorrThresholdAggregator.isValidPoint(cosignerA.publicKey)).toBe(
        true,
      );
      expect(SchnorrThresholdAggregator.isValidPoint(cosignerB.publicKey)).toBe(
        true,
      );
      expect(SchnorrThresholdAggregator.isValidPoint(cosignerC.publicKey)).toBe(
        true,
      );
    });

    it("rejects coordinates outside the field range [0, SECP256K1_P - 1]", () => {
      const outOfRangeX: ECPoint = { x: SECP256K1_P + 1n, y: 100n };
      expect(SchnorrThresholdAggregator.isValidPoint(outOfRangeX)).toBe(false);
      expect(() =>
        SchnorrThresholdAggregator.validatePoint(outOfRangeX, "out-of-range-x"),
      ).toThrow(/Invalid secp256k1 point/);

      const outOfRangeY: ECPoint = { x: 100n, y: SECP256K1_P + 5n };
      expect(SchnorrThresholdAggregator.isValidPoint(outOfRangeY)).toBe(false);

      const negativeCoord: ECPoint = { x: -1n, y: 100n };
      expect(SchnorrThresholdAggregator.isValidPoint(negativeCoord)).toBe(
        false,
      );

      const atFieldPrime: ECPoint = { x: SECP256K1_P, y: 1n };
      expect(SchnorrThresholdAggregator.isValidPoint(atFieldPrime)).toBe(false);
    });

    it("rejects off-curve points that do not satisfy y^2 = x^3 + 7 (mod p)", () => {
      const G = SchnorrThresholdAggregator.getGenerator();
      // Corrupt the y coordinate by adding 1
      const offCurvePoint: ECPoint = { x: G.x, y: G.y + 1n };
      expect(SchnorrThresholdAggregator.isValidPoint(offCurvePoint)).toBe(
        false,
      );
      expect(() =>
        SchnorrThresholdAggregator.validatePoint(
          offCurvePoint,
          "off-curve point",
        ),
      ).toThrow(/Invalid secp256k1 point/);

      const arbitraryOffCurve: ECPoint = { x: 12345n, y: 67890n };
      expect(SchnorrThresholdAggregator.isValidPoint(arbitraryOffCurve)).toBe(
        false,
      );
    });

    it("rejects point at infinity when allowInfinity is false (default) and accepts when true", () => {
      expect(
        SchnorrThresholdAggregator.isValidPoint(POINT_AT_INFINITY, false),
      ).toBe(false);
      expect(
        SchnorrThresholdAggregator.isValidPoint(POINT_AT_INFINITY, true),
      ).toBe(true);
      expect(() =>
        SchnorrThresholdAggregator.validatePoint(
          POINT_AT_INFINITY,
          "infinity",
          false,
        ),
      ).toThrow(/Invalid secp256k1 point/);
      expect(() =>
        SchnorrThresholdAggregator.validatePoint(
          POINT_AT_INFINITY,
          "infinity",
          true,
        ),
      ).not.toThrow();
    });

    it("rejects non-bigint coordinates and malformed point objects", () => {
      expect(
        SchnorrThresholdAggregator.isValidPoint({ x: "123" as any, y: 456n }),
      ).toBe(false);
      expect(SchnorrThresholdAggregator.isValidPoint(null as any)).toBe(false);
      expect(SchnorrThresholdAggregator.isValidPoint(undefined as any)).toBe(
        false,
      );
      expect(SchnorrThresholdAggregator.isValidPoint({} as any)).toBe(false);
    });

    it("rejects participant public keys that are off-curve, out-of-range, or at infinity during aggregation", () => {
      const invalidParticipants: ParticipantInfo[] = [
        { id: "alice", publicKey: cosignerA.publicKey },
        { id: "mallory", publicKey: { x: 12345n, y: 67890n } }, // off-curve
      ];

      expect(() =>
        SchnorrThresholdAggregator.aggregatePublicKeys(invalidParticipants),
      ).toThrow(/Invalid secp256k1 point for participant mallory public key/);

      const infinityParticipants: ParticipantInfo[] = [
        { id: "alice", publicKey: cosignerA.publicKey },
        { id: "eve", publicKey: POINT_AT_INFINITY },
      ];
      expect(() =>
        SchnorrThresholdAggregator.aggregatePublicKeys(infinityParticipants),
      ).toThrow(/Invalid secp256k1 point for participant eve public key/);
    });

    it("prevents session creation when any participant key is invalid, avoiding corrupt session state", () => {
      const invalidParticipants: ParticipantInfo[] = [
        { id: "alice", publicKey: cosignerA.publicKey },
        { id: "mallory", publicKey: { x: SECP256K1_P + 10n, y: 1n } },
      ];

      expect(() =>
        aggregator.createSession(
          "session-fail-key",
          invalidParticipants,
          message,
        ),
      ).toThrow(/Invalid secp256k1 point/);
      expect(aggregator.getSession("session-fail-key")).toBeUndefined();
    });

    it("rejects invalid or off-curve nonce commitments R1 and R2 in submitNonces without storing them", () => {
      const session = aggregator.createSession(
        "session-nonce-validation",
        participants,
        message,
      );
      const validNonces = SchnorrThresholdAggregator.generateNoncePair("alice");

      // Corrupt R1
      const badR1Nonce = {
        participantId: "alice",
        R1: { x: 999999n, y: 888888n }, // off-curve
        R2: validNonces.publicNonces.R2,
      };
      expect(() =>
        aggregator.submitNonces("session-nonce-validation", badR1Nonce),
      ).toThrow(/Invalid secp256k1 point for participant alice nonce R1/);
      expect(session.nonces.has("alice")).toBe(false);

      // Corrupt R2 with point at infinity
      const badR2Nonce = {
        participantId: "alice",
        R1: validNonces.publicNonces.R1,
        R2: POINT_AT_INFINITY,
      };
      expect(() =>
        aggregator.submitNonces("session-nonce-validation", badR2Nonce),
      ).toThrow(/Invalid secp256k1 point for participant alice nonce R2/);
      expect(session.nonces.has("alice")).toBe(false);

      // Submitting valid nonce succeeds cleanly
      aggregator.submitNonces(
        "session-nonce-validation",
        validNonces.publicNonces,
      );
      expect(session.nonces.has("alice")).toBe(true);
    });
  });

  describe("Nonce Commitment Immutability & Duplicate Rejection (#10092)", () => {
    it("rejects duplicate and conflicting nonce submissions for the same participant", () => {
      const sessionId = "session-test-duplicate-nonce";
      const session = aggregator.createSession(
        sessionId,
        participants,
        message,
      );

      const noncesA1 = SchnorrThresholdAggregator.generateNoncePair("alice");
      const noncesA2 = SchnorrThresholdAggregator.generateNoncePair("alice"); // conflicting nonces
      const noncesB = SchnorrThresholdAggregator.generateNoncePair("bob");
      const noncesC = SchnorrThresholdAggregator.generateNoncePair("charlie");

      // 1. First valid submission succeeds
      aggregator.submitNonces(sessionId, noncesA1.publicNonces);
      expect(session.nonces.has("alice")).toBe(true);
      expect(session.nonces.get("alice")).toBe(noncesA1.publicNonces);
      expect(session.state).toBe("INIT");

      // 2. Identical duplicate submission is rejected and preserves session state
      expect(() => {
        aggregator.submitNonces(sessionId, noncesA1.publicNonces);
      }).toThrow(/Duplicate nonce commitment rejected for participant alice/);
      expect(session.nonces.get("alice")).toBe(noncesA1.publicNonces);
      expect(session.state).toBe("INIT");

      // 3. Conflicting duplicate submission is rejected without overwriting original commitment
      expect(() => {
        aggregator.submitNonces(sessionId, noncesA2.publicNonces);
      }).toThrow(
        /Conflicting duplicate nonce commitment rejected for participant alice/,
      );
      expect(session.nonces.get("alice")).toBe(noncesA1.publicNonces);
      expect(session.state).toBe("INIT");

      // 4. Other valid participants can submit their commitments and complete exchange
      aggregator.submitNonces(sessionId, noncesB.publicNonces);
      expect(session.state).toBe("INIT");

      aggregator.submitNonces(sessionId, noncesC.publicNonces);
      expect(session.state).toBe("NONCES_EXCHANGED");
      expect(session.aggregateNonce).toBeDefined();
      expect(session.nonceBindingFactor).toBeDefined();

      // 5. Duplicate submission after all nonces collected is also rejected
      expect(() => {
        aggregator.submitNonces(sessionId, noncesA1.publicNonces);
      }).toThrow();
    });
  });

  describe("Threshold Fulfillment & Concurrent Submission Protection (#10123)", () => {
    it("rejects duplicate submissions for the same signer index and requires strictly unique signers for threshold fulfillment", async () => {
      // Setup 5 participants with threshold 3
      const cosigners5 = Array.from({ length: 5 }, () =>
        SchnorrThresholdAggregator.generateKeyPair(),
      );
      const participants5: ParticipantInfo[] = cosigners5.map((c, i) => ({
        id: `participant-${i}`,
        publicKey: c.publicKey,
      }));

      const sessionId = "session-threshold-concurrent-10123";
      const session = aggregator.createSession(
        sessionId,
        participants5,
        message,
        3,
      );
      expect(session.threshold).toBe(3);
      expect(session.state).toBe("INIT");

      // Nonce exchange for all 5 participants
      const nonces5 = participants5.map((p) =>
        SchnorrThresholdAggregator.generateNoncePair(p.id),
      );
      for (const n of nonces5) {
        aggregator.submitNonces(sessionId, n.publicNonces);
      }
      expect(session.state).toBe("NONCES_EXCHANGED");

      // Sign partials
      const sigs5 = participants5.map((p, i) =>
        aggregator.signPartial(
          session,
          p.id,
          cosigners5[i].privateKey,
          nonces5[i],
        ),
      );

      // 1. Concurrent submissions for identical signer index (index 0)
      const results = await Promise.allSettled([
        Promise.resolve().then(() =>
          aggregator.submitPartialSignature(sessionId, 0, sigs5[0]),
        ),
        Promise.resolve().then(() =>
          aggregator.submitPartialSignature(sessionId, 0, sigs5[0]),
        ),
        Promise.resolve().then(() =>
          aggregator.submitPartialSignature(sessionId, 0, sigs5[0]),
        ),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(2);
      for (const r of rejected) {
        if (r.status === "rejected") {
          expect(r.reason.message).toMatch(
            /Duplicate partial signature rejected from participant participant-0/,
          );
        }
      }

      // Threshold (3) is NOT fulfilled because only 1 unique signer submitted
      expect(session.state).toBe("NONCES_EXCHANGED");
      expect(session.partialSignatures.size).toBe(1);

      // 2. Submit second unique signer (index 1) - threshold still not reached
      aggregator.submitPartialSignature(sessionId, 1, sigs5[1]);
      expect(session.state).toBe("NONCES_EXCHANGED");
      expect(session.partialSignatures.size).toBe(2);

      // Attempt duplicate submission for signer 1 should be rejected
      expect(() => {
        aggregator.submitPartialSignature(sessionId, 1, sigs5[1]);
      }).toThrow(
        /Duplicate partial signature rejected from participant participant-1/,
      );

      // 3. Submit third unique signer (index 2) - threshold of 3 is reached
      aggregator.submitPartialSignature(sessionId, 2, sigs5[2]);
      expect(session.state).toBe("PARTIALS_COLLECTED");
      expect(session.partialSignatures.size).toBe(3);

      // Once threshold is collected, state is PARTIALS_COLLECTED and further submissions rejected
      expect(() => {
        aggregator.submitPartialSignature(sessionId, 3, sigs5[3]);
      }).toThrow(/Cannot submit partial signature in state PARTIALS_COLLECTED/);
    });

    it("rejects invalid threshold values during session creation", () => {
      expect(() =>
        aggregator.createSession(
          "invalid-threshold-0",
          participants,
          message,
          0,
        ),
      ).toThrow(/Invalid threshold/);

      expect(() =>
        aggregator.createSession(
          "invalid-threshold-overflow",
          participants,
          message,
          4,
        ),
      ).toThrow(/Invalid threshold/);
    });
  });
});
