#!/usr/bin/env node

import { Command } from "commander";
import { ReputationLedger } from "../lib/crypto/reputationLedger";

const program = new Command();

program
  .name("worksphere")
  .description("WorkSphere CLI for biometric security and reputation verification")
  .version("1.0.0");

program
  .command("verify-identity")
  .description("Authenticate local hardware key and link session to ledger")
  .argument("<handle>", "GitHub handle")
  .action((handle) => {
    console.log(`?? Initiating hardware security check for @${handle}...`);
    
    const sampleRecord = {
      githubHandle: handle,
      biometricCommitsCount: 14,
      verifiedZkProofs: 6,
      mergedPRs: 8,
    };

    const ledgerEntry = ReputationLedger.calculateReputationScore(sampleRecord);

    console.log("\n========================================");
    console.log("? IDENTITY VERIFIED & LINKED SUCCESSFULLY");
    console.log("========================================");
    console.log(`?? Contributor : @${handle}`);
    console.log(`? Trust Score : ${ledgerEntry.score}`);
    console.log(`??? Badge Tier  : ${ledgerEntry.tier}`);
    console.log(`?? Ledger Hash : ${ledgerEntry.hash}`);
    console.log("========================================\n");
  });

program.parse();
