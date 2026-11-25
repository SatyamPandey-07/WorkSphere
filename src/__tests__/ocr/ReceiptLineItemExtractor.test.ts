import {
  ReceiptLineItemExtractor,
  OCRWordToken,
} from '../../core/ocr/ReceiptLineItemExtractor';

describe('ReceiptLineItemExtractor', () => {
  describe('Luhn Credit Card Algorithm & PCI-DSS Masking', () => {
    it('validates genuine credit card numbers with Luhn mod 10', () => {
      // Standard test Visa card number (valid Luhn)
      expect(ReceiptLineItemExtractor.validateLuhn('4111111111111111')).toBe(true);
      // Altered last digit
      expect(ReceiptLineItemExtractor.validateLuhn('4111111111111112')).toBe(false);
    });

    it('redacts valid credit card numbers into masked format', () => {
      const text = 'Payment: 4111-1111-1111-1111 Auth: 99482';
      const redacted = ReceiptLineItemExtractor.redactPciDss(text);
      expect(redacted).toBe('Payment: ****-****-****-1111 Auth: 99482');
    });
  });

  describe('Spatial Token Clustering into Lines', () => {
    it('clusters collinear tokens horizontally based on Y-coordinates', () => {
      const tokens: OCRWordToken[] = [
        { text: 'Coffee', confidence: 0.99, bbox: { x: 10, y: 50, width: 40, height: 12 } },
        { text: 'Latte', confidence: 0.98, bbox: { x: 55, y: 52, width: 35, height: 12 } },
        { text: '4.50', confidence: 0.99, bbox: { x: 200, y: 51, width: 25, height: 12 } },
        { text: 'Blueberry', confidence: 0.95, bbox: { x: 10, y: 70, width: 50, height: 12 } },
        { text: 'Muffin', confidence: 0.97, bbox: { x: 65, y: 71, width: 35, height: 12 } },
        { text: '3.75', confidence: 0.99, bbox: { x: 200, y: 69, width: 25, height: 12 } },
      ];

      const lines = ReceiptLineItemExtractor.clusterTokensIntoLines(tokens);
      expect(lines.length).toBe(2);
      expect(lines[0]).toEqual(['Coffee', 'Latte', '4.50']);
      expect(lines[1]).toEqual(['Blueberry', 'Muffin', '3.75']);
    });
  });

  describe('Receipt Parsing & Financial Reconciliation', () => {
    it('extracts merchant, date, itemized lines, and verifies cross-foot balance', () => {
      const tokens: OCRWordToken[] = [
        // Line 1: Merchant
        { text: 'Starbucks', confidence: 0.99, bbox: { x: 20, y: 10, width: 60, height: 15 } },
        { text: 'Coffee', confidence: 0.99, bbox: { x: 85, y: 10, width: 45, height: 15 } },
        // Line 2: Date
        { text: 'Date:', confidence: 0.95, bbox: { x: 20, y: 30, width: 30, height: 12 } },
        { text: '2026-11-15', confidence: 0.99, bbox: { x: 55, y: 30, width: 70, height: 12 } },
        // Line 3: Item 1
        { text: 'Caramel', confidence: 0.98, bbox: { x: 20, y: 50, width: 45, height: 12 } },
        { text: 'Macchiato', confidence: 0.98, bbox: { x: 70, y: 50, width: 55, height: 12 } },
        { text: '5.50', confidence: 0.99, bbox: { x: 200, y: 50, width: 25, height: 12 } },
        // Line 4: Item 2
        { text: 'Croissant', confidence: 0.97, bbox: { x: 20, y: 70, width: 50, height: 12 } },
        { text: '3.50', confidence: 0.99, bbox: { x: 200, y: 70, width: 25, height: 12 } },
        // Line 5: Subtotal
        { text: 'Subtotal', confidence: 0.99, bbox: { x: 20, y: 95, width: 45, height: 12 } },
        { text: '9.00', confidence: 0.99, bbox: { x: 200, y: 95, width: 25, height: 12 } },
        // Line 6: Tax
        { text: 'Tax', confidence: 0.99, bbox: { x: 20, y: 115, width: 25, height: 12 } },
        { text: '0.90', confidence: 0.99, bbox: { x: 200, y: 115, width: 25, height: 12 } },
        // Line 7: Tip
        { text: 'Tip', confidence: 0.95, bbox: { x: 20, y: 135, width: 25, height: 12 } },
        { text: '1.00', confidence: 0.99, bbox: { x: 200, y: 135, width: 25, height: 12 } },
        // Line 8: Total
        { text: 'Total', confidence: 0.99, bbox: { x: 20, y: 160, width: 35, height: 15 } },
        { text: '10.90', confidence: 0.99, bbox: { x: 200, y: 160, width: 35, height: 15 } },
        // Line 9: Card tender
        { text: 'Card:', confidence: 0.95, bbox: { x: 20, y: 185, width: 30, height: 12 } },
        { text: '4111-1111-1111-1111', confidence: 0.99, bbox: { x: 55, y: 185, width: 120, height: 12 } },
      ];

      const receipt = ReceiptLineItemExtractor.parseTokens(tokens);

      expect(receipt.merchantName).toBe('Starbucks Coffee');
      expect(receipt.transactionDate).toBe('2026-11-15');
      expect(receipt.currency).toBe('USD');
      expect(receipt.lineItems.length).toBe(2);

      expect(receipt.lineItems[0].description).toBe('Caramel Macchiato');
      expect(receipt.lineItems[0].totalPrice).toBe(5.50);
      expect(receipt.lineItems[0].category).toBe('MEALS_AND_ENTERTAINMENT');

      expect(receipt.lineItems[1].description).toBe('Croissant');
      expect(receipt.lineItems[1].totalPrice).toBe(3.50);

      expect(receipt.subtotal).toBe(9.00);
      expect(receipt.tax).toBe(0.90);
      expect(receipt.tip).toBe(1.00);
      expect(receipt.grandTotal).toBe(10.90);

      // 9.00 + 0.90 + 1.00 === 10.90 -> Perfect reconciliation!
      expect(receipt.isReconciled).toBe(true);
      expect(receipt.discrepancyAmount).toBe(0);
      expect(receipt.maskedCardNumber).toBe('****-****-****-1111');
    });

    it('flags math discrepancies when lines do not match grand total', () => {
      const tokens: OCRWordToken[] = [
        { text: 'Bistro', confidence: 0.99, bbox: { x: 20, y: 10, width: 40, height: 12 } },
        { text: 'Steak', confidence: 0.99, bbox: { x: 20, y: 30, width: 30, height: 12 } },
        { text: '40.00', confidence: 0.99, bbox: { x: 150, y: 30, width: 30, height: 12 } },
        { text: 'Tax', confidence: 0.99, bbox: { x: 20, y: 50, width: 25, height: 12 } },
        { text: '4.00', confidence: 0.99, bbox: { x: 150, y: 50, width: 25, height: 12 } },
        { text: 'Total', confidence: 0.99, bbox: { x: 20, y: 70, width: 30, height: 12 } },
        { text: '55.00', confidence: 0.99, bbox: { x: 150, y: 70, width: 30, height: 12 } }, // Discrepancy! 40+4 != 55
      ];

      const receipt = ReceiptLineItemExtractor.parseTokens(tokens);
      expect(receipt.isReconciled).toBe(false);
      expect(receipt.discrepancyAmount).toBe(11.0); // 55 - 44 = 11
    });
  });
});
