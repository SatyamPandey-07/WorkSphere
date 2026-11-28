/**
 * ReceiptLineItemExtractor.ts
 * Client-side receipt spatial layout parser, expense line-item extractor,
 * mathematical cross-foot reconciler, and PCI-DSS card sanitizer.
 */

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRWordToken {
  text: string;
  confidence: number;
  bbox: BoundingBox;
}

export type ExpenseCategory =
  | 'MEALS_AND_ENTERTAINMENT'
  | 'LODGING'
  | 'GROUND_TRANSPORT'
  | 'OFFICE_EQUIPMENT'
  | 'TELECOM_INTERNET'
  | 'GENERAL_SUPPLIES';

export interface ReceiptLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: ExpenseCategory;
}

export interface ParsedReceipt {
  merchantName: string;
  transactionDate: string; // YYYY-MM-DD
  currency: string;
  lineItems: ReceiptLineItem[];
  subtotal: number;
  tax: number;
  tip: number;
  grandTotal: number;
  isReconciled: boolean;
  discrepancyAmount: number;
  maskedCardNumber?: string;
  sanitizedRawText: string;
}

export class ReceiptLineItemExtractor {
  private static readonly CATEGORY_KEYWORDS: Record<ExpenseCategory, string[]> = {
    MEALS_AND_ENTERTAINMENT: [
      'coffee', 'latte', 'espresso', 'lunch', 'dinner', 'burger', 'sandwich', 'salad',
      'pizza', 'beer', 'wine', 'cafe', 'restaurant', 'grill', 'bistro', 'food', 'bakery'
    ],
    LODGING: [
      'hotel', 'inn', 'suite', 'motel', 'room rate', 'occupancy', 'night', 'resort', 'stay'
    ],
    GROUND_TRANSPORT: [
      'uber', 'lyft', 'taxi', 'cab', 'metro', 'subway', 'parking', 'toll', 'train', 'transit'
    ],
    OFFICE_EQUIPMENT: [
      'cable', 'monitor', 'keyboard', 'mouse', 'adapter', 'usb', 'dock', 'laptop', 'hardware'
    ],
    TELECOM_INTERNET: [
      'wifi', 'roaming', 'data', 'sim', 'broadband', 'telecom', 'esim', 'cellular'
    ],
    GENERAL_SUPPLIES: [],
  };

  /**
   * Parses spatial OCR tokens into a structured receipt record.
   */
  public static parseTokens(tokens: OCRWordToken[]): ParsedReceipt {
    const lines = this.clusterTokensIntoLines(tokens);
    const rawText = lines.map((l) => l.join(' ')).join('\n');
    const sanitizedRawText = this.redactPciDss(rawText);

    const merchantName = this.extractMerchant(lines);
    const transactionDate = this.extractDate(sanitizedRawText);
    const currency = this.detectCurrency(sanitizedRawText);
    const maskedCardNumber = this.extractMaskedCard(rawText);

    // Parse financial summary figures
    const subtotal = this.extractAmount(lines, [/^sub\s*total/i, /^subtotal/i]);
    const tax = this.extractAmount(lines, [/^tax/i, /^vat/i, /^gst/i, /^sales\s*tax/i]);
    const tip = this.extractAmount(lines, [/^tip/i, /^gratuity/i]);
    const grandTotal = this.extractAmount(lines, [
      /^total\s*due/i,
      /^grand\s*total/i,
      /^amount\s*due/i,
      /^balance\s*due/i,
      /^total/i,
    ]);

    // Parse itemized line items
    const lineItems = this.extractLineItems(lines);

    // Cross-foot reconciliation math: sum(lineItems) + tax + tip === grandTotal
    const itemsSum = lineItems.reduce((acc, item) => acc + item.totalPrice, 0);
    const effectiveSubtotal = subtotal > 0 ? subtotal : itemsSum;
    const computedTotal = effectiveSubtotal + tax + tip;
    const effectiveGrandTotal = grandTotal > 0 ? grandTotal : computedTotal;

    const discrepancyAmount = Number(Math.abs(computedTotal - effectiveGrandTotal).toFixed(2));
    const isReconciled = discrepancyAmount <= 0.05;

    return {
      merchantName,
      transactionDate,
      currency,
      lineItems,
      subtotal: Number(effectiveSubtotal.toFixed(2)),
      tax: Number(tax.toFixed(2)),
      tip: Number(tip.toFixed(2)),
      grandTotal: Number(effectiveGrandTotal.toFixed(2)),
      isReconciled,
      discrepancyAmount,
      maskedCardNumber,
      sanitizedRawText,
    };
  }

  // --- Spatial Reconstruction ---

  public static clusterTokensIntoLines(tokens: OCRWordToken[]): string[][] {
    if (tokens.length === 0) return [];

    // Sort top-to-bottom primarily, left-to-right secondarily
    const sorted = [...tokens].sort((a, b) => {
      const yDiff = a.bbox.y - b.bbox.y;
      if (Math.abs(yDiff) > 8) return yDiff;
      return a.bbox.x - b.bbox.x;
    });

    const lines: Array<Array<{ text: string; x: number; y: number }>> = [];
    let currentLine: Array<{ text: string; x: number; y: number }> = [];
    let currentY = -1;

    for (const t of sorted) {
      if (currentY === -1 || Math.abs(t.bbox.y - currentY) <= 10) {
        currentLine.push({ text: t.text, x: t.bbox.x, y: t.bbox.y });
        currentY = currentLine.reduce((acc, cur) => acc + cur.y, 0) / currentLine.length;
      } else {
        // Sort line horizontally left to right
        currentLine.sort((a, b) => a.x - b.x);
        lines.push(currentLine);
        currentLine = [{ text: t.text, x: t.bbox.x, y: t.bbox.y }];
        currentY = t.bbox.y;
      }
    }

    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.x - b.x);
      lines.push(currentLine);
    }

    return lines.map((l) => l.map((item) => item.text));
  }

  // --- Parsing Extractors ---

  private static extractMerchant(lines: string[][]): string {
    // Merchant name is almost always in the first 1-3 lines
    for (let i = 0; i < Math.min(3, lines.length); i++) {
      const lineStr = lines[i].join(' ').trim();
      if (
        lineStr.length >= 3 &&
        !lineStr.match(/receipt|invoice|welcome|order|#|date|time/i) &&
        !lineStr.match(/^\d+$/)
      ) {
        return lineStr;
      }
    }
    return 'UNKNOWN_MERCHANT';
  }

  private static extractDate(text: string): string {
    // Matches YYYY-MM-DD, MM/DD/YYYY, or DD/MM/YYYY
    const isoMatch = text.match(/\b(20\d{2})[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\d|3[01])\b/);
    if (isoMatch) {
      return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    }

    const slashMatch = text.match(/\b(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
    if (slashMatch) {
      return `${slashMatch[3]}-${slashMatch[1]}-${slashMatch[2]}`;
    }

    // Default to today if unparsed
    const now = new Date();
    return now.toISOString().split('T')[0];
  }

  private static detectCurrency(text: string): string {
    if (text.includes('€') || text.includes('EUR')) return 'EUR';
    if (text.includes('£') || text.includes('GBP')) return 'GBP';
    if (text.includes('₹') || text.includes('INR')) return 'INR';
    if (text.includes('USDC')) return 'USDC';
    return 'USD';
  }

  private static extractAmount(lines: string[][], patterns: RegExp[]): number {
    for (const line of lines) {
      const lineStr = line.join(' ');
      for (const pattern of patterns) {
        if (pattern.test(lineStr)) {
          // Look for amount: $12.34 or 12.34
          const matches = lineStr.match(/(\$|€|£|₹)?\s*([0-9]+\.[0-9]{2})\b/g);
          if (matches && matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            const cleaned = lastMatch.replace(/[^0-9.]/g, '');
            const parsed = parseFloat(cleaned);
            if (!isNaN(parsed)) return parsed;
          }
        }
      }
    }
    return 0;
  }

  private static extractLineItems(lines: string[][]): ReceiptLineItem[] {
    const items: ReceiptLineItem[] = [];

    for (const line of lines) {
      const lineStr = line.join(' ');

      // Skip summary keywords
      if (lineStr.match(/subtotal|total|tax|tip|gratuity|cash|visa|mastercard|amex|balance|change|tender/i)) {
        continue;
      }

      // Check if line ends with a monetary price: "Item Description 12.50" or "2 x Coffee 8.00"
      const priceMatch = lineStr.match(/(.+?)\s+(?:(\$|€|£|₹)?\s*([0-9]+\.[0-9]{2}))$/);
      if (priceMatch) {
        const descRaw = priceMatch[1].trim();
        const price = parseFloat(priceMatch[3]);

        if (descRaw.length < 2 || isNaN(price) || price <= 0) continue;

        // Parse optional quantity: "2 x Bagel" or "3 Espresso"
        let quantity = 1;
        let description = descRaw;
        const qtyMatch = descRaw.match(/^(\d+)\s*(?:x|\*|\s)\s*(.+)/i);
        if (qtyMatch) {
          quantity = parseInt(qtyMatch[1], 10);
          description = qtyMatch[2].trim();
        }

        const unitPrice = Number((price / quantity).toFixed(2));
        const category = this.classifyCategory(description);

        items.push({
          description,
          quantity,
          unitPrice,
          totalPrice: price,
          category,
        });
      }
    }

    return items;
  }

  private static classifyCategory(desc: string): ExpenseCategory {
    const lower = desc.toLowerCase();
    for (const [cat, keywords] of Object.entries(this.CATEGORY_KEYWORDS)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          return cat as ExpenseCategory;
        }
      }
    }
    return 'GENERAL_SUPPLIES';
  }

  // --- PCI-DSS Card Masking & Luhn Validation ---

  public static redactPciDss(text: string): string {
    // Regex for credit card numbers (13 to 19 digits with optional spaces or dashes)
    return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
      const digitsOnly = match.replace(/\D/g, '');
      if (digitsOnly.length >= 13 && digitsOnly.length <= 19 && this.validateLuhn(digitsOnly)) {
        const last4 = digitsOnly.slice(-4);
        return `****-****-****-${last4}`;
      }
      return match;
    });
  }

  private static extractMaskedCard(text: string): string | undefined {
    const matches = text.match(/\b(?:\d[ -]*?){13,19}\b/g);
    if (!matches) return undefined;

    for (const match of matches) {
      const digits = match.replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && this.validateLuhn(digits)) {
        return `****-****-****-${digits.slice(-4)}`;
      }
    }
    return undefined;
  }

  /**
   * Luhn Algorithm (Mod 10 checksum) for credit card validation.
   */
  public static validateLuhn(numberStr: string): boolean {
    let sum = 0;
    let shouldDouble = false;

    for (let i = numberStr.length - 1; i >= 0; i--) {
      let digit = parseInt(numberStr.charAt(i), 10);
      if (isNaN(digit)) return false;

      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      shouldDouble = !shouldDouble;
    }

    return sum % 10 === 0;
  }
}
