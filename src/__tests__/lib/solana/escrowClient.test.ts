import {
  parseDecimalToBaseUnits,
  formatBaseUnitsToDecimal,
  calculateEscrowBookingBaseUnits,
  assertSufficientEscrowBalance,
  SOL_DECIMALS,
  USDC_DECIMALS,
} from '@/lib/solana/escrowClient';

describe('escrowClient (Exact BigInt Decimal Base-Unit Conversion)', () => {
  test('converts IEEE-754 problematic decimals (0.14, 0.29, 0.000000001) into exact BigInt lamports', () => {
    // Classic IEEE-754 drift cases where floating-point multiplication loses precision
    expect(parseDecimalToBaseUnits('0.14', SOL_DECIMALS)).toBe(140_000_000n);
    expect(parseDecimalToBaseUnits('0.29', SOL_DECIMALS)).toBe(290_000_000n);
    expect(parseDecimalToBaseUnits('1.000000001', SOL_DECIMALS)).toBe(1_000_000_001n);
    expect(parseDecimalToBaseUnits('0.000000001', SOL_DECIMALS)).toBe(1n);
    expect(parseDecimalToBaseUnits('25', SOL_DECIMALS)).toBe(25_000_000_000n);
  });

  test('converts USDC amounts into exact 6-decimal SPL base units', () => {
    expect(parseDecimalToBaseUnits('19.99', USDC_DECIMALS)).toBe(19_990_000n);
    expect(parseDecimalToBaseUnits('0.000001', USDC_DECIMALS)).toBe(1n);
    expect(formatBaseUnitsToDecimal(19_990_000n, USDC_DECIMALS)).toBe('19.99');
  });

  test('computes prorated multi-hour desk bookings without floating-point drift', () => {
    // 0.14 SOL/hr * 150 minutes (2.5 hours) = exact 0.35 SOL = 350_000_000n lamports
    const solQuote = calculateEscrowBookingBaseUnits({
      hourlyRate: '0.14',
      durationMinutes: 150,
      asset: 'SOL',
    });

    expect(solQuote.baseUnits).toBe(350_000_000n);
    expect(solQuote.formattedDecimal).toBe('0.35');

    // 4.20 USDC/hr * 45 minutes (0.75 hours) = exact 3.15 USDC = 3_150_000n base units
    const usdcQuote = calculateEscrowBookingBaseUnits({
      hourlyRate: '4.20',
      durationMinutes: 45,
      asset: 'USDC',
    });

    expect(usdcQuote.baseUnits).toBe(3_150_000n);
    expect(usdcQuote.formattedDecimal).toBe('3.15');
  });

  test('rejects negative values, malformed strings, and excess fractional precision', () => {
    expect(() => parseDecimalToBaseUnits('-0.5', SOL_DECIMALS)).toThrow(/cannot be negative/);
    expect(() => parseDecimalToBaseUnits('1.2.3', SOL_DECIMALS)).toThrow(/Malformed decimal/);
    expect(() => parseDecimalToBaseUnits('0.1234567891', SOL_DECIMALS)).toThrow(
      /exceeds maximum supported precision/
    );
  });

  test('validates pre-flight escrow balance including network fee reserve', () => {
    expect(() =>
      assertSufficientEscrowBalance({
        walletBalanceBaseUnits: 140_005_000n,
        requiredEscrowBaseUnits: 140_000_000n,
        networkFeeReserveBaseUnits: 5_000n,
      })
    ).not.toThrow();

    expect(() =>
      assertSufficientEscrowBalance({
        walletBalanceBaseUnits: 140_004_999n,
        requiredEscrowBaseUnits: 140_000_000n,
        networkFeeReserveBaseUnits: 5_000n,
      })
    ).toThrow(/InsufficientFunds/);
  });
});