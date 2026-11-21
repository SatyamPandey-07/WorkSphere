import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Verifiable Oblivious / Password-Authenticated Key Exchange Prover (SPAKE2-style PAKE).
 *
 * Implements a balanced zero-knowledge Password-Authenticated Key Exchange over a safe-prime
 * quadratic-residue subgroup using two nothing-up-my-sleeve generators M, N:
 *  1. Both parties derive shared scalar w = HashToScalar(password, clientId, serverId).
 *  2. Client picks secret x, sends password-blinded public element pA = g^x * M^w mod P.
 *  3. Server picks secret y, sends password-blinded public element pB = g^y * N^w mod P.
 *  4. Client unblinds K_client = (pB * N^{-w})^x = g^{xy};
 *     Server unblinds K_server = (pA * M^{-w})^y = g^{xy}!
 *  5. Both derive transcript key schedule (Ke, KcA, KcB) via SHA-256(clientId, serverId, pA, pB, K, w)
 *     and exchange explicit key-confirmation MACs verifying password equality without ever
 *     leaking the password to passive eavesdroppers or active offline dictionary attackers!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function deriveQR(tag: string): bigint {
  const raw = (BigInt('0x' + sha256Hex('SPAKE2-PAKE-GEN-V1', tag).slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const GENERATOR_M = deriveQR('POINT-M');
export const GENERATOR_N = deriveQR('POINT-N');

export interface PAKEClientState {
  sessionId: string;
  clientId: string;
  serverId: string;
  passwordScalar: bigint;
  ephemeralX: bigint;
  pA: bigint;
}

export interface PAKEServerState {
  sessionId: string;
  clientId: string;
  serverId: string;
  passwordScalar: bigint;
  ephemeralY: bigint;
  pB: bigint;
}

export interface PAKEKeySchedule {
  sessionKeyHex: string;
  clientConfirmMac: string;
  serverConfirmMac: string;
  transcriptHash: string;
}

export interface PAKEHandshakeAudit {
  sessionId: string;
  clientId: string;
  serverId: string;
  authenticated: boolean;
  clientConfirmedServer: boolean;
  serverConfirmedClient: boolean;
  sessionKeyMatch: boolean;
  transcriptHash: string;
}

export class VerifiableObliviousKeyExchangeProver {
  public derivePasswordScalar(password: string, clientId: string, serverId: string): bigint {
    if (!password || password.length === 0) throw new Error('Password cannot be empty');
    const digest = sha256Hex('SPAKE2-PW-KDF-V1', password, clientId, serverId);
    const s = modScalar(BigInt('0x' + digest.slice(0, 32)));
    return s === 0n ? 1n : s;
  }

  public isValidSubgroupElement(el: bigint): boolean {
    if (el <= 1n || el >= SAFE_PRIME_P) return false;
    return modPow(el, SUBGROUP_Q, SAFE_PRIME_P) === 1n;
  }

  public initClient(
    sessionId: string,
    clientId: string,
    serverId: string,
    password: string,
    ephemeralOverride?: bigint,
  ): PAKEClientState {
    const passwordScalar = this.derivePasswordScalar(password, clientId, serverId);
    const ephemeralX = ephemeralOverride !== undefined ? modScalar(ephemeralOverride) : randomScalar();
    if (ephemeralX === 0n) throw new Error('Ephemeral secret must be non-zero');
    const pA = (modPow(BASE_G, ephemeralX, SAFE_PRIME_P) * modPow(GENERATOR_M, passwordScalar, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { sessionId, clientId, serverId, passwordScalar, ephemeralX, pA };
  }

  public initServer(
    sessionId: string,
    clientId: string,
    serverId: string,
    password: string,
    ephemeralOverride?: bigint,
  ): PAKEServerState {
    const passwordScalar = this.derivePasswordScalar(password, clientId, serverId);
    const ephemeralY = ephemeralOverride !== undefined ? modScalar(ephemeralOverride) : randomScalar();
    if (ephemeralY === 0n) throw new Error('Ephemeral secret must be non-zero');
    const pB = (modPow(BASE_G, ephemeralY, SAFE_PRIME_P) * modPow(GENERATOR_N, passwordScalar, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return { sessionId, clientId, serverId, passwordScalar, ephemeralY, pB };
  }

  private deriveSchedule(
    sessionId: string,
    clientId: string,
    serverId: string,
    pA: bigint,
    pB: bigint,
    sharedPointK: bigint,
    passwordScalar: bigint,
  ): PAKEKeySchedule {
    const transcriptHash = sha256Hex(
      'SPAKE2-TRANSCRIPT-V1',
      sessionId,
      clientId,
      serverId,
      pA.toString(16),
      pB.toString(16),
      sharedPointK.toString(16),
      passwordScalar.toString(16),
    );
    const sessionKeyHex = sha256Hex('SPAKE2-SESSION-KEY', transcriptHash);
    const confirmKey = sha256Hex('SPAKE2-CONFIRM-KEY', transcriptHash);
    const clientConfirmMac = createHmac('sha256', confirmKey).update(`CLIENT-CONFIRM:${pA.toString(16)}:${pB.toString(16)}`).digest('hex');
    const serverConfirmMac = createHmac('sha256', confirmKey).update(`SERVER-CONFIRM:${pB.toString(16)}:${pA.toString(16)}`).digest('hex');

    return { sessionKeyHex, clientConfirmMac, serverConfirmMac, transcriptHash };
  }

  public clientFinish(state: PAKEClientState, receivedPB: bigint): PAKEKeySchedule {
    if (!this.isValidSubgroupElement(receivedPB)) {
      throw new Error('Invalid server ephemeral group element pB');
    }
    const nNegW = modPow(GENERATOR_N, modScalar(SUBGROUP_Q - state.passwordScalar), SAFE_PRIME_P);
    const unblindedB = (receivedPB * nNegW) % SAFE_PRIME_P;
    const sharedPointK = modPow(unblindedB, state.ephemeralX, SAFE_PRIME_P);
    return this.deriveSchedule(
      state.sessionId,
      state.clientId,
      state.serverId,
      state.pA,
      receivedPB,
      sharedPointK,
      state.passwordScalar,
    );
  }

  public serverFinish(state: PAKEServerState, receivedPA: bigint): PAKEKeySchedule {
    if (!this.isValidSubgroupElement(receivedPA)) {
      throw new Error('Invalid client ephemeral group element pA');
    }
    const mNegW = modPow(GENERATOR_M, modScalar(SUBGROUP_Q - state.passwordScalar), SAFE_PRIME_P);
    const unblindedA = (receivedPA * mNegW) % SAFE_PRIME_P;
    const sharedPointK = modPow(unblindedA, state.ephemeralY, SAFE_PRIME_P);
    return this.deriveSchedule(
      state.sessionId,
      state.clientId,
      state.serverId,
      receivedPA,
      state.pB,
      sharedPointK,
      state.passwordScalar,
    );
  }

  public executeAuditedHandshake(
    sessionId: string,
    clientId: string,
    serverId: string,
    clientPassword: string,
    serverPassword: string,
  ): PAKEHandshakeAudit {
    const clientState = this.initClient(sessionId, clientId, serverId, clientPassword);
    const serverState = this.initServer(sessionId, clientId, serverId, serverPassword);

    const clientSched = this.clientFinish(clientState, serverState.pB);
    const serverSched = this.serverFinish(serverState, clientState.pA);

    const clientConfirmedServer = clientSched.serverConfirmMac === serverSched.serverConfirmMac;
    const serverConfirmedClient = serverSched.clientConfirmMac === clientSched.clientConfirmMac;
    const sessionKeyMatch = clientSched.sessionKeyHex === serverSched.sessionKeyHex;

    return {
      sessionId,
      clientId,
      serverId,
      authenticated: clientConfirmedServer && serverConfirmedClient && sessionKeyMatch,
      clientConfirmedServer,
      serverConfirmedClient,
      sessionKeyMatch,
      transcriptHash: clientSched.transcriptHash,
    };
  }

  public serializeAudit(audit: PAKEHandshakeAudit): string {
    return JSON.stringify(audit);
  }
}
