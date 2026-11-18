import { createHash } from "crypto";

export interface ContributorRecord {
  githubHandle: string;
  biometricCommitsCount: number;
  verifiedZkProofs: number;
  mergedPRs: number;
}

export class ReputationLedger {
  public static calculateReputationScore(record: ContributorRecord): { score: number; tier: string; hash: string } {
    const score = 
      (record.biometricCommitsCount * 15) +
      (record.verifiedZkProofs * 25) +
      (record.mergedPRs * 10);

    let tier = "Contributor";
    if (score > 500) tier = "Elite Guardian";
    else if (score > 250) tier = "Core Maintainer";
    else if (score > 100) tier = "Trusted Contributor";

    const payload = `${record.githubHandle}:${score}:${tier}:${Date.now()}`;
    const hash = createHash("sha256").update(payload).digest("hex");

    return { score, tier, hash };
  }
}
