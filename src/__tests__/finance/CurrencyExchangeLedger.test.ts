import { describe, it, expect, beforeEach } from 'vitest';
import {
  CurrencyExchangeLedger,
  SCALE,
  AccountType,
  EscrowStatus,
} from '../../core/finance/CurrencyExchangeLedger';
import type {
  FXSwapRequest,
  EscrowAgreement,
} from '../../core/finance/CurrencyExchangeLedger';

describe('CurrencyExchangeLedger - Multi-Currency Fixed-Point Accounting', () => {
  let ledger: CurrencyExchangeLedger;

  beforeEach(() => {
    ledger = new CurrencyExchangeLedger('treasury-dao');
    // Set exchange rates:
    // 1 EUR = 1.08 USD
    ledger.setRate('EUR', 'USD', 1.08);
    // 1 SOL = 180 USD
    ledger.setRate('SOL', 'USD', 180.0);
  });

  describe('Deposit and Withdrawal Double-Entry Mechanics', () => {
    it('deposits funds with double-entry balance and correct account balance', () => {
      const entry = ledger.deposit('alice', 'USD', 1000n * SCALE);
      expect(entry.postings).toHaveLength(2);
      expect(ledger.getBalance('alice', 'USD')).toBe(1000n * SCALE);
      expect(ledger.getBalance('pool-fx-liquidity', 'USD')).toBe(-1000n * SCALE);

      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.verifiedEntries).toBe(1);
    });

    it('rejects withdrawal when balance is insufficient', () => {
      ledger.deposit('bob', 'EUR', 100n * SCALE);
      expect(() => {
        ledger.withdraw('bob', 'EUR', 200n * SCALE);
      }).toThrow('Insufficient funds');
    });

    it('executes valid withdrawal correctly', () => {
      ledger.deposit('bob', 'EUR', 500n * SCALE);
      ledger.withdraw('bob', 'EUR', 200n * SCALE);
      expect(ledger.getBalance('bob', 'EUR')).toBe(300n * SCALE);

      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.verifiedEntries).toBe(2);
    });
  });

  describe('Atomic FX Swaps & Slippage Bounds', () => {
    beforeEach(() => {
      ledger.deposit('trader1', 'SOL', 10n * SCALE); // 10 SOL
    });

    it('executes spot conversion with fee to treasury', () => {
      const swapReq: FXSwapRequest = {
        accountId: 'trader1',
        fromCurrency: 'SOL',
        toCurrency: 'USD',
        amountIn: 2n * SCALE, // 2 SOL
        minAmountOut: 350n * SCALE, // At 180 USD/SOL, 2 SOL = 360 USD gross
        feeBps: 25, // 0.25% fee = 0.9 USD fee, net = 359.1 USD
      };

      const result = ledger.executeSwap(swapReq);
      expect(result.amountOut).toBe(35910000000n); // 359.1 USD
      expect(result.feeAmount).toBe(90000000n); // 0.9 USD
      expect(ledger.getBalance('trader1', 'SOL')).toBe(8n * SCALE);
      expect(ledger.getBalance('trader1', 'USD')).toBe(35910000000n);
      expect(ledger.getBalance('treasury-dao', 'USD')).toBe(90000000n);

      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(true);
    });

    it('rejects swap when slippage exceeds minAmountOut', () => {
      const swapReq: FXSwapRequest = {
        accountId: 'trader1',
        fromCurrency: 'SOL',
        toCurrency: 'USD',
        amountIn: 2n * SCALE,
        minAmountOut: 400n * SCALE, // Impossible: expects 400 USD from 360 USD gross
      };

      expect(() => {
        ledger.executeSwap(swapReq);
      }).toThrow('Slippage exceeded');

      // Balances must remain unchanged
      expect(ledger.getBalance('trader1', 'SOL')).toBe(10n * SCALE);
    });
  });

  describe('Multi-Party Escrow State Machine', () => {
    beforeEach(() => {
      ledger.deposit('client-corp', 'USD', 5000n * SCALE);
    });

    it('locks funds into vault and releases to beneficiary upon completion', () => {
      const agreement = ledger.createEscrow({
        escrowId: 'escrow-desk-lease-01',
        creatorId: 'client-corp',
        beneficiaryId: 'host-venue',
        currency: 'USD',
        amount: 2000n * SCALE,
        timelockDurationMs: 3600000,
      });

      expect(agreement.status).toBe(EscrowStatus.ACTIVE);
      expect(ledger.getBalance('client-corp', 'USD')).toBe(3000n * SCALE);
      expect(ledger.getBalance('vault-escrow-reserve', 'USD')).toBe(2000n * SCALE);

      // Release escrow
      ledger.releaseEscrow('escrow-desk-lease-01');
      expect(ledger.getEscrow('escrow-desk-lease-01')?.status).toBe(EscrowStatus.RELEASED);
      expect(ledger.getBalance('vault-escrow-reserve', 'USD')).toBe(0n);
      expect(ledger.getBalance('host-venue', 'USD')).toBe(2000n * SCALE);

      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(true);
    });

    it('prevents refund before timelock expiry and permits refund after', () => {
      const t0 = 1000000;
      ledger.createEscrow({
        escrowId: 'escrow-timeout-test',
        creatorId: 'client-corp',
        beneficiaryId: 'host-venue',
        currency: 'USD',
        amount: 1000n * SCALE,
        timelockDurationMs: 5000,
      });

      // Attempt refund before expiry
      expect(() => {
        ledger.refundEscrow('escrow-timeout-test', t0 + 2000);
      }).toThrow('Timelock has not expired');

      // Refund after expiry (t0 + 6000ms > 5000ms)
      ledger.refundEscrow('escrow-timeout-test', Date.now() + 10000);
      expect(ledger.getEscrow('escrow-timeout-test')?.status).toBe(EscrowStatus.REFUNDED);
      expect(ledger.getBalance('client-corp', 'USD')).toBe(5000n * SCALE);
    });
  });

  describe('Cryptographic Audit Trail Integrity', () => {
    it('maintains continuous hash chaining across multiple operations', () => {
      ledger.deposit('u1', 'EUR', 100n * SCALE);
      ledger.deposit('u2', 'USD', 200n * SCALE);
      ledger.executeSwap({
        accountId: 'u2',
        fromCurrency: 'USD',
        toCurrency: 'EUR',
        amountIn: 50n * SCALE,
        minAmountOut: 40n * SCALE,
      });

      const journal = ledger.getJournal();
      expect(journal.length).toBe(3);
      expect(journal[1].previousHash).toBe(journal[0].entryHash);
      expect(journal[2].previousHash).toBe(journal[1].entryHash);

      const integrity = ledger.verifyLedgerIntegrity();
      expect(integrity.isValid).toBe(true);
      expect(integrity.verifiedEntries).toBe(3);
    });
  });
});
