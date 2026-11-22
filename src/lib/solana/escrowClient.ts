import { createHash } from 'crypto';

export interface EscrowConfirmRequest {
  deskId: string;
  slotWindow: string;
  proofHash: string;
  merkleRoot: string;
  programId?: string;
}

export interface EscrowConfirmResult {
  confirmed: boolean;
  escrowPda: string;
  txSignature?: string;
  error?: string;
}

export interface SolanaEscrowAdapter {
  confirmEscrowCommitment(req: {
    escrowPda: string;
    proofHash: string;
    merkleRoot: string;
  }): Promise<{ txSignature: string }>;
}

export function deriveEscrowPda(
  deskId: string,
  slotWindow: string,
  programId = 'WorkSphereEscrow111111111111111111111111111'
): string {
  const digest = createHash('sha256')
    .update(`escrow_pda:${programId}:${deskId}:${slotWindow}`)
    .digest('hex')
    .slice(0, 44);
  return `pda_${digest}`;
}

export class SolanaEscrowClient {
  constructor(private readonly adapter?: SolanaEscrowAdapter) {}

  async confirmReservationEscrow(
    req: EscrowConfirmRequest
  ): Promise<EscrowConfirmResult> {
    const escrowPda = deriveEscrowPda(req.deskId, req.slotWindow, req.programId);

    if (!req.proofHash || !req.merkleRoot) {
      return {
        confirmed: false,
        escrowPda,
        error: 'MISSING_ZKP_COMMITMENT',
      };
    }

    if (!this.adapter) {
      return {
        confirmed: false,
        escrowPda,
        error: 'ESCROW_ADAPTER_UNCONFIGURED',
      };
    }

    try {
      const { txSignature } = await this.adapter.confirmEscrowCommitment({
        escrowPda,
        proofHash: req.proofHash,
        merkleRoot: req.merkleRoot,
      });
      return {
        confirmed: true,
        escrowPda,
        txSignature,
      };
    } catch (err) {
      return {
        confirmed: false,
        escrowPda,
        error: err instanceof Error ? err.message : 'ESCROW_TX_FAILED',
      };
    }
  }
}