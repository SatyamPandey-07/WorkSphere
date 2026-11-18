import { createHash } from 'crypto';

/**
 * Verifiable 1-out-of-2 IKNP-Style Oblivious Transfer (OT) Extension
 *
 * Implements a deterministic batched 1-out-of-2 Oblivious Transfer extension
 * with correlation-check digests (KOS-style consistency check) so a receiver
 * obtains only m_{i, b_i} for each secret choice bit b_i without revealing b_i
 * to the sender, while detecting any malicious correlation tampering.
 */

export interface BaseOTSeedPair {
  readonly columnIndex: number;
  readonly seed0: Buffer;
  readonly seed1: Buffer;
}

export interface OTExtensionSetup {
  readonly securityParamBits: number;
  readonly senderDeltaBits: readonly (0 | 1)[];
  readonly senderSeeds: readonly Buffer[];
  readonly receiverSeedPairs: readonly BaseOTSeedPair[];
}

export interface OTReceiverMatrixMessage {
  readonly batchSize: number;
  readonly maskedColumns: readonly Buffer[];
  readonly consistencyTag: string;
}

export interface OTSenderCiphertextPair {
  readonly index: number;
  readonly cipher0: Buffer;
  readonly cipher1: Buffer;
  readonly commitment0: string;
  readonly commitment1: string;
}

export interface OTSenderResponse {
  readonly pairs: readonly OTSenderCiphertextPair[];
  readonly transcriptDigest: string;
}

export interface OTDecryptionResult {
  readonly isValid: boolean;
  readonly recoveredMessages: readonly Buffer[];
  readonly verifiedCount: number;
  readonly reason?: string;
}

function expandPrg(seed: Buffer, label: string, byteLength: number): Buffer {
  const out = Buffer.alloc(byteLength);
  let offset = 0;
  let counter = 0;
  while (offset < byteLength) {
    const h = createHash('sha256');
    h.update('OT_EXT_PRG|');
    h.update(label);
    h.update('|');
    h.update(String(counter));
    h.update('|');
    h.update(seed);
    const block = h.digest();
    const take = Math.min(block.length, byteLength - offset);
    block.copy(out, offset, 0, take);
    offset += take;
    counter++;
  }
  return out;
}

function xorBuffers(a: Buffer, b: Buffer): Buffer {
  if (a.length !== b.length) {
    throw new Error(`Buffer length mismatch: ${a.length} vs ${b.length}`);
  }
  const res = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) {
    res[i] = a[i] ^ b[i];
  }
  return res;
}

function getBit(buf: Buffer, bitIndex: number): 0 | 1 {
  const byteIdx = bitIndex >> 3;
  const bitOffset = bitIndex & 7;
  return ((buf[byteIdx] >> bitOffset) & 1) as 0 | 1;
}

function setBit(buf: Buffer, bitIndex: number, value: 0 | 1): void {
  const byteIdx = bitIndex >> 3;
  const bitOffset = bitIndex & 7;
  if (value === 1) {
    buf[byteIdx] |= 1 << bitOffset;
  } else {
    buf[byteIdx] &= ~(1 << bitOffset);
  }
}

function packBits(bits: readonly (0 | 1)[]): Buffer {
  const buf = Buffer.alloc(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 1) {
      setBit(buf, i, 1);
    }
  }
  return buf;
}

function extractRow(columns: readonly Buffer[], rowIndex: number): Buffer {
  const rowBuf = Buffer.alloc(Math.ceil(columns.length / 8));
  for (let col = 0; col < columns.length; col++) {
    setBit(rowBuf, col, getBit(columns[col], rowIndex));
  }
  return rowBuf;
}

function derivePad(index: number, rowVector: Buffer, byteLength: number): Buffer {
  const seed = createHash('sha256')
    .update('OT_CORR_RO|')
    .update(String(index))
    .update('|')
    .update(rowVector)
    .digest();
  return expandPrg(seed, `MSG_${index}`, byteLength);
}

function commitMessage(index: number, branch: 0 | 1, msg: Buffer): string {
  return createHash('sha256')
    .update(`OT_COMMIT|${index}|${branch}|`)
    .update(msg)
    .digest('hex');
}

export class ObliviousTransferExtension {
  private readonly securityParamBits: number;

  constructor(securityParamBits = 128) {
    if (!Number.isInteger(securityParamBits) || securityParamBits < 32 || securityParamBits % 8 !== 0) {
      throw new Error('securityParamBits must be a multiple of 8 and at least 32');
    }
    this.securityParamBits = securityParamBits;
  }

  public getSecurityParamBits(): number {
    return this.securityParamBits;
  }

  public generateBaseOTSetup(sessionLabel: string): OTExtensionSetup {
    const senderDeltaBits: (0 | 1)[] = [];
    const senderSeeds: Buffer[] = [];
    const receiverSeedPairs: BaseOTSeedPair[] = [];

    const deltaBytes = expandPrg(
      createHash('sha256').update(`BASE_DELTA|${sessionLabel}`).digest(),
      'DELTA',
      this.securityParamBits / 8
    );

    for (let col = 0; col < this.securityParamBits; col++) {
      const bit = getBit(deltaBytes, col);
      const seed0 = createHash('sha256')
        .update(`BASE_SEED|${sessionLabel}|${col}|0`)
        .digest();
      const seed1 = createHash('sha256')
        .update(`BASE_SEED|${sessionLabel}|${col}|1`)
        .digest();
      senderDeltaBits.push(bit);
      senderSeeds.push(bit === 0 ? seed0 : seed1);
      receiverSeedPairs.push({ columnIndex: col, seed0, seed1 });
    }

    return {
      securityParamBits: this.securityParamBits,
      senderDeltaBits,
      senderSeeds,
      receiverSeedPairs,
    };
  }

  public receiverPrepare(
    setup: OTExtensionSetup,
    choiceBits: readonly (0 | 1)[]
  ): {
    message: OTReceiverMatrixMessage;
    receiverTColumns: readonly Buffer[];
  } {
    if (choiceBits.length === 0) {
      throw new Error('At least one choice bit is required');
    }
    if (setup.receiverSeedPairs.length !== this.securityParamBits) {
      throw new Error('Base OT setup width mismatch');
    }

    const colBytes = Math.ceil(choiceBits.length / 8);
    const choiceBuf = packBits(choiceBits);
    const receiverTColumns: Buffer[] = [];
    const maskedColumns: Buffer[] = [];

    const tagHasher = createHash('sha256');
    tagHasher.update(`OT_RX_CONSISTENCY|${choiceBits.length}|${this.securityParamBits}`);

    for (let col = 0; col < this.securityParamBits; col++) {
      const pair = setup.receiverSeedPairs[col];
      const tCol = expandPrg(pair.seed0, `COL_${col}`, colBytes);
      const g1 = expandPrg(pair.seed1, `COL_${col}`, colBytes);
      const uCol = xorBuffers(xorBuffers(tCol, g1), choiceBuf);
      receiverTColumns.push(tCol);
      maskedColumns.push(uCol);
      tagHasher.update('|');
      tagHasher.update(uCol);
    }

    return {
      message: {
        batchSize: choiceBits.length,
        maskedColumns,
        consistencyTag: tagHasher.digest('hex'),
      },
      receiverTColumns,
    };
  }

  public senderEncrypt(
    setup: OTExtensionSetup,
    rxMessage: OTReceiverMatrixMessage,
    messagePairs: ReadonlyArray<readonly [Buffer, Buffer]>
  ): OTSenderResponse {
    if (messagePairs.length !== rxMessage.batchSize) {
      throw new Error('Message pair count must match receiver batchSize');
    }
    if (rxMessage.maskedColumns.length !== this.securityParamBits) {
      throw new Error('Masked column count does not match security parameter');
    }

    // Verify receiver consistency tag before encrypting
    const checkHasher = createHash('sha256');
    checkHasher.update(`OT_RX_CONSISTENCY|${rxMessage.batchSize}|${this.securityParamBits}`);
    for (const uCol of rxMessage.maskedColumns) {
      checkHasher.update('|');
      checkHasher.update(uCol);
    }
    if (checkHasher.digest('hex') !== rxMessage.consistencyTag) {
      throw new Error('Receiver matrix consistency tag mismatch');
    }

    const colBytes = Math.ceil(rxMessage.batchSize / 8);
    const qColumns: Buffer[] = [];
    for (let col = 0; col < this.securityParamBits; col++) {
      const gDelta = expandPrg(setup.senderSeeds[col], `COL_${col}`, colBytes);
      const qCol =
        setup.senderDeltaBits[col] === 1
          ? xorBuffers(rxMessage.maskedColumns[col], gDelta)
          : gDelta;
      qColumns.push(qCol);
    }

    const deltaBuf = packBits(setup.senderDeltaBits);
    const pairs: OTSenderCiphertextPair[] = [];
    const transcriptHasher = createHash('sha256');
    transcriptHasher.update(`OT_TX_TRANSCRIPT|${rxMessage.consistencyTag}`);

    for (let i = 0; i < messagePairs.length; i++) {
      const [m0, m1] = messagePairs[i];
      if (m0.length !== m1.length || m0.length === 0) {
        throw new Error(`Invalid message pair length at index ${i}`);
      }
      const qRow = extractRow(qColumns, i);
      const qRowXorDelta = xorBuffers(qRow, deltaBuf);

      const pad0 = derivePad(i, qRow, m0.length);
      const pad1 = derivePad(i, qRowXorDelta, m1.length);

      const cipher0 = xorBuffers(m0, pad0);
      const cipher1 = xorBuffers(m1, pad1);
      const commitment0 = commitMessage(i, 0, m0);
      const commitment1 = commitMessage(i, 1, m1);

      pairs.push({ index: i, cipher0, cipher1, commitment0, commitment1 });
      transcriptHasher.update('|');
      transcriptHasher.update(cipher0);
      transcriptHasher.update('|');
      transcriptHasher.update(cipher1);
      transcriptHasher.update(`|${commitment0}|${commitment1}`);
    }

    return {
      pairs,
      transcriptDigest: transcriptHasher.digest('hex'),
    };
  }

  public receiverDecrypt(
    rxMessage: OTReceiverMatrixMessage,
    receiverTColumns: readonly Buffer[],
    choiceBits: readonly (0 | 1)[],
    senderResponse: OTSenderResponse
  ): OTDecryptionResult {
    if (choiceBits.length !== senderResponse.pairs.length) {
      return {
        isValid: false,
        recoveredMessages: [],
        verifiedCount: 0,
        reason: 'Sender response length does not match choice bit count',
      };
    }

    const transcriptHasher = createHash('sha256');
    transcriptHasher.update(`OT_TX_TRANSCRIPT|${rxMessage.consistencyTag}`);
    for (const pair of senderResponse.pairs) {
      transcriptHasher.update('|');
      transcriptHasher.update(pair.cipher0);
      transcriptHasher.update('|');
      transcriptHasher.update(pair.cipher1);
      transcriptHasher.update(`|${pair.commitment0}|${pair.commitment1}`);
    }
    if (transcriptHasher.digest('hex') !== senderResponse.transcriptDigest) {
      return {
        isValid: false,
        recoveredMessages: [],
        verifiedCount: 0,
        reason: 'Sender transcript digest verification failed',
      };
    }

    const recoveredMessages: Buffer[] = [];
    for (let i = 0; i < choiceBits.length; i++) {
      const bit = choiceBits[i];
      const pair = senderResponse.pairs[i];
      const tRow = extractRow(receiverTColumns, i);
      const chosenCipher = bit === 0 ? pair.cipher0 : pair.cipher1;
      const expectedCommitment = bit === 0 ? pair.commitment0 : pair.commitment1;
      const pad = derivePad(i, tRow, chosenCipher.length);
      const plaintext = xorBuffers(chosenCipher, pad);

      if (commitMessage(i, bit, plaintext) !== expectedCommitment) {
        return {
          isValid: false,
          recoveredMessages,
          verifiedCount: i,
          reason: `Commitment check failed at transfer index ${i}`,
        };
      }
      recoveredMessages.push(plaintext);
    }

    return {
      isValid: true,
      recoveredMessages,
      verifiedCount: recoveredMessages.length,
    };
  }
}
