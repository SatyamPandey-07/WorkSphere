/**
 * Tests for venue supplier performance scorecard evaluation.
 */

interface SupplierDelivery {
  orderId: string;
  supplierId: string;
  scheduledAt: number;
  deliveredAt: number | null;
  expectedQuantity: number;
  deliveredQuantity: number;
  qualityScore: number;  // 1-5
  invoiceAmount: number;
  invoicedAmount: number;
}

interface SupplierScorecard {
  supplierId: string;
  onTimeRate: number;      // 0-100
  fulfillmentRate: number; // 0-100
  avgQuality: number;      // 1-5
  pricingAccuracy: number; // 0-100 (how close invoice is to expected)
  overallScore: number;    // 0-100
}

function isOnTime(delivery: SupplierDelivery, toleranceMs = 3600_000): boolean {
  if (!delivery.deliveredAt) return false;
  return delivery.deliveredAt <= delivery.scheduledAt + toleranceMs;
}

function fulfillmentRatio(delivery: SupplierDelivery): number {
  if (delivery.expectedQuantity === 0) return 1;
  return Math.min(delivery.deliveredQuantity / delivery.expectedQuantity, 1);
}

function pricingAccuracyPercent(delivery: SupplierDelivery): number {
  if (delivery.invoiceAmount === 0) return 100;
  const variance = Math.abs(delivery.invoicedAmount - delivery.invoiceAmount) / delivery.invoiceAmount;
  return Math.max(0, Math.round((1 - variance) * 100));
}

function buildScorecard(deliveries: SupplierDelivery[], supplierId: string): SupplierScorecard | null {
  const own = deliveries.filter((d) => d.supplierId === supplierId);
  if (own.length === 0) return null;

  const onTimeRate   = Math.round(own.filter((d) => isOnTime(d)).length / own.length * 100);
  const fulfillRate  = Math.round(own.reduce((s, d) => s + fulfillmentRatio(d), 0) / own.length * 100);
  const avgQuality   = Math.round(own.reduce((s, d) => s + d.qualityScore, 0) / own.length * 10) / 10;
  const priceAcc     = Math.round(own.reduce((s, d) => s + pricingAccuracyPercent(d), 0) / own.length);

  const overallScore = Math.round(
    onTimeRate * 0.3 + fulfillRate * 0.25 + (avgQuality / 5 * 100) * 0.25 + priceAcc * 0.2
  );

  return { supplierId, onTimeRate, fulfillmentRate: fulfillRate, avgQuality, pricingAccuracy: priceAcc, overallScore };
}

const NOW = 1_700_000_000_000;
const DELIVERIES: SupplierDelivery[] = [
  { orderId: "o1", supplierId: "s1", scheduledAt: NOW, deliveredAt: NOW + 1800_000, expectedQuantity: 100, deliveredQuantity: 100, qualityScore: 5, invoiceAmount: 500, invoicedAmount: 500 },
  { orderId: "o2", supplierId: "s1", scheduledAt: NOW, deliveredAt: NOW + 7200_000, expectedQuantity: 50,  deliveredQuantity: 45,  qualityScore: 4, invoiceAmount: 250, invoicedAmount: 260 },
  { orderId: "o3", supplierId: "s1", scheduledAt: NOW, deliveredAt: null,           expectedQuantity: 80,  deliveredQuantity: 0,   qualityScore: 0, invoiceAmount: 400, invoicedAmount: 0 },
];

describe("Supplier scorecard evaluation", () => {
  it("isOnTime: delivered 30min early → true", () => {
    expect(isOnTime(DELIVERIES[0])).toBe(true);
  });

  it("isOnTime: delivered 2h late → false", () => {
    expect(isOnTime(DELIVERIES[1])).toBe(false);
  });

  it("fulfillmentRatio: 45/50 = 0.9", () => {
    expect(fulfillmentRatio(DELIVERIES[1])).toBe(0.9);
  });

  it("pricingAccuracyPercent: $260 vs $250 = 96%", () => {
    expect(pricingAccuracyPercent(DELIVERIES[1])).toBe(96);
  });

  it("buildScorecard: returns a scorecard with valid fields", () => {
    const card = buildScorecard(DELIVERIES, "s1");
    expect(card).not.toBeNull();
    expect(card!.overallScore).toBeGreaterThan(0);
    expect(card!.overallScore).toBeLessThanOrEqual(100);
  });
});
