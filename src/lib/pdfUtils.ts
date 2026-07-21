/**
 * Safely converts extended Unicode currency symbols to standard text abbreviations
 * to prevent PDF compiler exceptions caused by missing font glyphs.
 */
export function sanitizeCurrencyForPDF(
  amount: number,
  currencySymbolOrCode: string,
): string {
  const symbolMap: Record<string, string> = {
    "₹": "INR ",
    "¥": "JPY ",
    $: "$",
    "€": "EUR ",
    "£": "GBP ",
  };

  // Extract translation mapping or fall back to the original string if already standard
  const safeSymbol =
    symbolMap[currencySymbolOrCode] || `${currencySymbolOrCode} `;

  // Return clean, printable string format (e.g., "INR 1,500.00")
  return `${safeSymbol}${amount.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Safely converts mathematical symbols, fractions, special operators,
 * currency symbols, and non-WinAnsi characters to standard printable ASCII
 * to prevent PDF compiler exceptions caused by unsupported font glyphs (#277).
 */
export function sanitizeMathSymbols(text: string | null | undefined): string {
  if (!text) return "";

  const mathAndSymbolMap: Record<string, string> = {
    // Fractions
    "½": "1/2",
    "⅓": "1/3",
    "⅔": "2/3",
    "¼": "1/4",
    "¾": "3/4",
    "⅕": "1/5",
    "⅖": "2/5",
    "⅗": "3/5",
    "⅘": "4/5",
    "⅙": "1/6",
    "⅚": "5/6",
    "⅛": "1/8",
    "⅜": "3/8",
    "⅝": "5/8",
    "⅞": "7/8",

    // Math Operators & Symbols
    "±": "+/-",
    "∓": "-/+",
    "≠": "!=",
    "≤": "<=",
    "≥": ">=",
    "×": "x",
    "÷": "/",
    "√": "sqrt",
    "∞": "infinity",
    π: "pi",
    "∑": "sum",
    "∆": "delta",
    "∏": "product",
    "∫": "integral",
    "≈": "~=",
    "≡": "==",
    "°": " deg",
    "‰": "%",
    "‱": "%%",
    µ: "u",

    // Currency & Special Characters
    "₹": "INR ",
    "¥": "JPY ",
    "€": "EUR ",
    "£": "GBP ",
    "₩": "KRW ",
    "฿": "THB ",
    "©": "(c)",
    "®": "(R)",
    "™": "(TM)",
    "–": "-",
    "—": "-",
    "‘": "'",
    "’": "'",
    "“": '"',
    "”": '"',
    "…": "...",
    "•": "*",
  };

  // Replace mapped characters first
  let sanitized = String(text).replace(
    /[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞±∓≠≤≥×÷√∞π∑∆∏∫≈≡°‰‱µ₹¥€£₩฿©®™–—‘’“”…•]/g,
    (char) => mathAndSymbolMap[char] || "",
  );

  // Replace any remaining control characters or unprintable non-ASCII characters outside \x20-\x7E
  sanitized = sanitized.replace(/[^\x20-\x7E]/g, "");

  return sanitized;
}
