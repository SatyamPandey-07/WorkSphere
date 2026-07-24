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
  const [currency, setCurrencyState] = useState<Currency>("USD");

  useEffect(() => {
    const saved = localStorage.getItem("workspace-currency");
    // Only accept valid currency strings to prevent crashes
    if (
      saved === "USD" ||
      saved === "EUR" ||
      saved === "GBP" ||
      saved === "INR"
    ) {
      setCurrencyState(saved as Currency);
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
    return {
      currency: "USD" as Currency,
      setCurrency: () => {},
    };
  }
  return context;
}
