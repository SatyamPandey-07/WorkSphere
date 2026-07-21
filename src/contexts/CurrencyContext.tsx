"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

type Currency = "USD" | "EUR" | "GBP" | "INR";

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(
  undefined,
);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  // Default to USD
  const [currency, setCurrencyState] = useState<Currency>("USD");

  // Optional: Load from local storage so it remembers if the user refreshes
  useEffect(() => {
    const saved = localStorage.getItem("workspace-currency") as Currency;
    if (saved) {
      setCurrencyState(saved);
    }
  }, []);

  const setCurrency = (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    localStorage.setItem("workspace-currency", newCurrency);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error("useCurrency must be used within a CurrencyProvider");
  }
  return context;
}
