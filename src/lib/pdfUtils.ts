/**
 * Safely converts extended Unicode currency symbols to standard text abbreviations
 * to prevent PDF compiler exceptions caused by missing font glyphs.
 */
export function sanitizeCurrencyForPDF(amount: number, currencySymbolOrCode: string): string {
  const symbolMap: Record<string, string> = {
    '₹': 'INR ',
    '¥': 'JPY ',
    '$': '$',
    '€': 'EUR ',
    '£': 'GBP ',
  };

  // Extract translation mapping or fall back to the original string if already standard
  const safeSymbol = symbolMap[currencySymbolOrCode] || `${currencySymbolOrCode} `;
  
  // Return clean, printable string format (e.g., "INR 1,500.00")
  return `${safeSymbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}