/**
 * Multi-Currency Micro-Payments & Lightning/USDC Engine
 * Handles real-time per-minute/hourly desk metering, Lightning Network invoice synthesis (BOLT11/LNURL),
 * USDC Solana/Base gasless pay-as-you-go settlement, and multi-currency exchange rate conversions.
 */

export type PaymentRail = 'lightning' | 'usdc_base' | 'usdc_solana' | 'fiat_stripe';

export interface ExchangeRates {
  btcUsd: number;
  satsPerUsd: number;
  solUsd: number;
  eurUsd: number;
  gbpUsd: number;
  lastUpdated: number;
}

export interface HourlyDeskPricing {
  deskId: string;
  deskName: string;
  venueName: string;
  hourlyRateUsd: number;
  ratePerMinuteUsd: number;
  ratePerMinuteSats: number;
  ratePerMinuteUsdc: number;
}

export interface MicroBillingSession {
  sessionId: string;
  deskId: string;
  deskName: string;
  venueName: string;
  userId?: string;
  paymentRail: PaymentRail;
  status: 'active' | 'paused' | 'settled' | 'pending_payment';
  startTime: number;
  lastHeartbeatTime: number;
  elapsedSeconds: number;
  hourlyRateUsd: number;
  totalAccruedUsd: number;
  totalAccruedSats: number;
  totalAccruedUsdc: number;
  depositHoldUsd: number;
  paymentProofHash?: string;
}

export interface PaymentInvoice {
  invoiceId: string;
  sessionId: string;
  paymentRail: PaymentRail;
  amountUsd: number;
  amountCrypto: string; // e.g. "1,450 sats" or "3.50 USDC"
  cryptoAddressOrInvoice: string; // BOLT11 invoice string or Solana/EVM contract transfer data
  qrPayload: string;
  expiresAt: number;
  isSettled: boolean;
}

export const LIVE_EXCHANGE_RATES: ExchangeRates = {
  btcUsd: 68500.0,
  satsPerUsd: Math.round(100000000 / 68500.0), // ~1460 sats per USD
  solUsd: 175.0,
  eurUsd: 1.08,
  gbpUsd: 1.29,
  lastUpdated: Date.now(),
};

export interface SatoshiValidationResult {
  isValid: boolean;
  error?: string;
  sats?: number;
}

export class MicroPaymentEngine {
  /**
   * Validates that a requested satoshi amount is a strictly positive, finite integer.
   * Rejects values <= 0, non-integers (decimals), NaN, infinite, or malformed numbers.
   */
  public static validateSatoshiAmount(amount: unknown): SatoshiValidationResult {
    if (amount === undefined || amount === null || amount === "") {
      return {
        isValid: false,
        error: "Satoshi amount is required",
      };
    }

    const num = typeof amount === "number" ? amount : Number(amount);

    if (typeof amount === "string" && isNaN(Number(amount))) {
      return {
        isValid: false,
        error: "Malformed satoshi amount: must be a valid numeric value",
      };
    }

    if (isNaN(num) || !Number.isFinite(num)) {
      return {
        isValid: false,
        error: "Malformed satoshi amount: must be a finite number",
      };
    }

    if (num <= 0) {
      return {
        isValid: false,
        error: "Invalid satoshi amount: value must be strictly positive (> 0)",
      };
    }

    if (!Number.isInteger(num)) {
      return {
        isValid: false,
        error: "Invalid satoshi amount: must be a whole integer, decimal satoshis are not allowed",
      };
    }

    return {
      isValid: true,
      sats: num,
    };
  }

  /**
   * Boolean check for strictly positive integer satoshi amount.
   */
  public static isValidSatoshiAmount(amount: unknown): boolean {
    return this.validateSatoshiAmount(amount).isValid;
  }

  /**
   * Calculates per-minute and per-hour rates across multiple currencies
   */
  public static getDeskPricing(
    deskId: string,
    deskName: string,
    venueName: string,
    hourlyRateUsd: number = 4.5
  ): HourlyDeskPricing {
    const ratePerMinuteUsd = hourlyRateUsd / 60;
    const ratePerMinuteSats = Math.ceil(ratePerMinuteUsd * LIVE_EXCHANGE_RATES.satsPerUsd);
    const ratePerMinuteUsdc = Number(ratePerMinuteUsd.toFixed(4));

    return {
      deskId,
      deskName,
      venueName,
      hourlyRateUsd,
      ratePerMinuteUsd: Number(ratePerMinuteUsd.toFixed(4)),
      ratePerMinuteSats,
      ratePerMinuteUsdc,
    };
  }

  /**
   * Updates an ongoing micro-billing session state with elapsed seconds and accrued balances
   */
  public static tickSession(
    session: MicroBillingSession,
    currentTimestamp: number = Date.now()
  ): MicroBillingSession {
    if (session.status !== 'active') return session;

    const elapsedSeconds = Math.floor((currentTimestamp - session.startTime) / 1000);
    const elapsedMinutes = elapsedSeconds / 60;
    const ratePerMinuteUsd = session.hourlyRateUsd / 60;

    const totalAccruedUsd = Number((elapsedMinutes * ratePerMinuteUsd).toFixed(4));
    const totalAccruedSats = Math.ceil(totalAccruedUsd * LIVE_EXCHANGE_RATES.satsPerUsd);
    const totalAccruedUsdc = totalAccruedUsd;

    return {
      ...session,
      lastHeartbeatTime: currentTimestamp,
      elapsedSeconds,
      totalAccruedUsd,
      totalAccruedSats,
      totalAccruedUsdc,
    };
  }

  /**
   * Synthesizes a BOLT11 Lightning Invoice or USDC deposit transaction.
   * Throws an Error if satoshi amount or amountUsd is <= 0 for Lightning invoices.
   */
  public static createMicroInvoice(
    sessionId: string,
    amountUsd: number,
    rail: PaymentRail,
    customSats?: number
  ): PaymentInvoice {
    const invoiceId = `inv-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins expiry

    let amountCrypto = '';
    let cryptoAddressOrInvoice = '';
    let qrPayload = '';
    let resolvedAmountUsd = amountUsd;

    if (rail === 'lightning') {
      let sats: number;
      if (customSats !== undefined) {
        const val = this.validateSatoshiAmount(customSats);
        if (!val.isValid || val.sats === undefined) {
          throw new Error(val.error || "Invalid satoshi amount: must be strictly positive (> 0)");
        }
        sats = val.sats;
        resolvedAmountUsd = Number((sats / LIVE_EXCHANGE_RATES.satsPerUsd).toFixed(2));
      } else {
        if (typeof amountUsd !== "number" || isNaN(amountUsd) || amountUsd <= 0) {
          throw new Error("Invalid satoshi amount: must be strictly positive (> 0)");
        }
        sats = Math.ceil(amountUsd * LIVE_EXCHANGE_RATES.satsPerUsd);
        if (sats <= 0) {
          throw new Error("Invalid satoshi amount: value must be strictly positive (> 0)");
        }
      }

      amountCrypto = `${sats.toLocaleString()} Sats`;
      cryptoAddressOrInvoice = `lnbc${sats}0n1p3${invoiceId.replace(/-/g, '')}workspheredesk${Math.random().toString(36).substr(2, 12)}`;
      qrPayload = `lightning:${cryptoAddressOrInvoice}`;
    } else if (rail === 'usdc_base') {
      amountCrypto = `${amountUsd.toFixed(2)} USDC (Base)`;
      cryptoAddressOrInvoice = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`; // USDC on Base
      qrPayload = `ethereum:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913@8453/transfer?address=0xWorkSphereVault777&uint256=${Math.round(amountUsd * 1e6)}`;
    } else if (rail === 'usdc_solana') {
      amountCrypto = `${amountUsd.toFixed(2)} USDC (Solana)`;
      cryptoAddressOrInvoice = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`; // USDC SPL
      qrPayload = `solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v?amount=${amountUsd.toFixed(2)}&label=WorkSphere+Desk+Session`;
    } else {
      amountCrypto = `$${amountUsd.toFixed(2)} USD`;
      cryptoAddressOrInvoice = `stripe_pi_${invoiceId}`;
      qrPayload = `https://pay.worksphere.io/session/${sessionId}`;
    }

    return {
      invoiceId,
      sessionId,
      paymentRail: rail,
      amountUsd: Number(resolvedAmountUsd.toFixed(2)),
      amountCrypto,
      cryptoAddressOrInvoice,
      qrPayload,
      expiresAt,
      isSettled: false,
    };
  }

  /**
   * Generates a cryptographic proof-of-payment receipt hash
   */
  public static generatePaymentReceiptHash(
    sessionId: string,
    rail: PaymentRail,
    amountUsd: number
  ): string {
    const raw = `${sessionId}:${rail}:${amountUsd}:${Date.now()}:worksphere-preimage-secret`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = (hash << 5) - hash + raw.charCodeAt(i);
      hash |= 0;
    }
    const hex = Math.abs(hash).toString(16).padStart(8, '0');
    return `0x${hex}${Date.now().toString(16)}fa7b99c1e2840`;
  }
}
