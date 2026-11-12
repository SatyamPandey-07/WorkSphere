export type SupportedCurrency = 'USD' | 'EUR' | 'GBP' | 'JPY' | 'INR' | 'SOL';

// Static offline fallback exchange rates (Base: USD)
const FALLBACK_RATES: Record<SupportedCurrency, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155.0,
  INR: 83.2,
  SOL: 0.0075, // e.g. 1 USD = 0.0075 SOL (approximate crypto rate)
};

// In-memory cache store simulating Redis with 6-hour TTL
let cachedRates: Record<SupportedCurrency, number> = { ...FALLBACK_RATES };
let lastFetchTimestamp = 0;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function getExchangeRates(): Promise<Record<SupportedCurrency, number>> {
  const now = Date.now();

  // Return cached rates if within 6-hour TTL (< 5ms response time)
  if (now - lastFetchTimestamp < CACHE_TTL_MS && Object.keys(cachedRates).length > 0) {
    return cachedRates;
  }

  try {
    // Attempt fetching from external free exchange rate API (e.g., ExchangeRate-API or Open Exchange Rates)
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(3000), // 3-second timeout
    });

    if (!response.ok) throw new Error('Failed to fetch live exchange rates');

    const data = await response.json();
    const rates = data.rates || {};

    cachedRates = {
      USD: 1.0,
      EUR: rates.EUR || FALLBACK_RATES.EUR,
      GBP: rates.GBP || FALLBACK_RATES.GBP,
      JPY: rates.JPY || FALLBACK_RATES.JPY,
      INR: rates.INR || FALLBACK_RATES.INR,
      SOL: 0.0075, // Custom crypto pairing fallback
    };

    lastFetchTimestamp = now;
    return cachedRates;
  } catch (error) {
    console.warn('External exchange API unreachable. Falling back to static offline exchange rates.', error);
    return FALLBACK_RATES;
  }
}

export async function convertCurrency(
  amountInUsd: number,
  targetCurrency: SupportedCurrency
): Promise<number> {
  const rates = await getExchangeRates();
  const rate = rates[targetCurrency] || 1.0;
  return Number((amountInUsd * rate).toFixed(targetCurrency === 'JPY' ? 0 : 2));
}