'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { SupportedCurrency } from '@/lib/currency/currencyConverter';

interface CurrencyContextType {
  currency: SupportedCurrency;
  setCurrency: (currency: SupportedCurrency) => void;
  rates: Record<SupportedCurrency, number>;
  formatPrice: (amountInUsd: number) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
  SOL: 'SOL ',
};

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currency, setCurrency] = useState<SupportedCurrency>('USD');
  const [rates, setRates] = useState<Record<SupportedCurrency, number>>({
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.79,
    JPY: 155.0,
    INR: 83.2,
    SOL: 0.0075,
  });

  useEffect(() => {
    async function fetchRates() {
      try {
        const res = await fetch('/api/finance/exchange-rates');
        const data = await res.json();
        if (data.success && data.rates) {
          setRates(data.rates);
        }
      } catch (err) {
        console.warn('Failed to load exchange rates in client context:', err);
      }
    }
    fetchRates();
  }, []);

  const formatPrice = (amountInUsd: number): string => {
    const rate = rates[currency] || 1.0;
    const converted = amountInUsd * rate;
    const symbol = CURRENCY_SYMBOLS[currency] || '$';

    if (currency === 'JPY') {
      return `${symbol}${Math.round(converted).toLocaleString()}`;
    }
    if (currency === 'SOL') {
      return `${converted.toFixed(4)} ${symbol.trim()}`;
    }
    return `${symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, rates, formatPrice }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (!context) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};