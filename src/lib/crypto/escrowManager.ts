export interface EscrowContract {
  contractId: string;
  amount: number;
  threshold: number;
  approvals: string[];
  epoch: number;
  isExecuted: boolean;
}

export class EscrowManager {
  private static processedEpochs = new Set<string>();

  public static verifyMultisigAndIdempotency(contract: EscrowContract): boolean {
    const epochKey = `${contract.contractId}:${contract.epoch}`;
    
    // SEC-05: Check payout idempotency across epochs
    if (this.processedEpochs.has(epochKey) || contract.isExecuted) {
      console.warn(`?? [Escrow SEC-05] Duplicate payout attempt blocked for epoch ${contract.epoch}`);
      return false;
    }

    // Verify multi-signature approval threshold
    if (contract.approvals.length < contract.threshold) {
      console.error(`? [Escrow] Approval threshold not met: ${contract.approvals.length}/${contract.threshold}`);
      return false;
    }

    this.processedEpochs.add(epochKey);
    return true;
  }
}
