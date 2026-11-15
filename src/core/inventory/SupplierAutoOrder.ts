/**
 * SupplierAutoOrder.ts
 * Formats the forecasted deficits into standardized EDI/API Purchase Orders 
 * and routes them to the optimal local supplier.
 */

import { ForecastResult } from './DepletionForecaster';

export interface Supplier {
    id: string;
    name: string;
    supportedSKUs: string[];
    leadTimeHours: number;
    minimumOrderValue: number;
    reliabilityScore: number; // 0.0 to 1.0
    apiEndpoint: string;
}

export interface PurchaseOrder {
    poId: string;
    supplierId: string;
    items: { sku: string; quantity: number; unitPrice: number }[];
    totalValue: number;
    requiredDeliveryTimestamp: number;
    status: 'DRAFT' | 'SENT' | 'CONFIRMED' | 'DELIVERED' | 'CANCELLED';
    createdAt: number;
}

export class SupplierAutoOrder {
    private suppliers: Map<string, Supplier> = new Map();
    private skuPrices: Map<string, number> = new Map();

    public registerSupplier(supplier: Supplier): void {
        this.suppliers.set(supplier.id, supplier);
    }

    public setSKUPrice(sku: string, price: number): void {
        this.skuPrices.set(sku, price);
    }

    public generatePurchaseOrders(forecasts: ForecastResult[]): PurchaseOrder[] {
        const orders: PurchaseOrder[] = [];
        const supplierAllocations = new Map<string, { sku: string; quantity: number }[]>();

        for (const forecast of forecasts) {
            const bestSupplier = this.findOptimalSupplier(forecast.sku, forecast.estimatedHoursToDepletion);

            if (!bestSupplier) {
                console.warn(`[AutoOrder] No supplier found for SKU ${forecast.sku}`);
                continue;
            }

            if (!supplierAllocations.has(bestSupplier.id)) {
                supplierAllocations.set(bestSupplier.id, []);
            }

            supplierAllocations.get(bestSupplier.id)!.push({
                sku: forecast.sku,
                quantity: forecast.recommendedOrderQty
            });
        }

        // Consolidate into POs
        for (const [supplierId, items] of supplierAllocations.entries()) {
            const supplier = this.suppliers.get(supplierId)!;
            let totalValue = 0;

            const poItems = items.map(item => {
                const price = this.skuPrices.get(item.sku) || 0;
                totalValue += price * item.quantity;
                return { sku: item.sku, quantity: item.quantity, unitPrice: price };
            });

            if (totalValue < supplier.minimumOrderValue) {
                console.log(`[AutoOrder] Order for ${supplier.name} below minimum ($${totalValue} < $${supplier.minimumOrderValue}). Holding draft.`);
            }

            const po: PurchaseOrder = {
                poId: `PO-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                supplierId,
                items: poItems,
                totalValue,
                requiredDeliveryTimestamp: Date.now() + (supplier.leadTimeHours * 3600000),
                status: 'DRAFT',
                createdAt: Date.now()
            };

            orders.push(po);
        }

        return orders;
    }

    private findOptimalSupplier(sku: string, hoursToDepletion: number): Supplier | null {
        const candidates = Array.from(this.suppliers.values()).filter(s =>
            s.supportedSKUs.includes(sku) && s.leadTimeHours < hoursToDepletion
        );

        if (candidates.length === 0) return null;

        // Score = Reliability * (1 / LeadTime)
        return candidates.sort((a, b) => {
            const scoreA = a.reliabilityScore * (1 / a.leadTimeHours);
            const scoreB = b.reliabilityScore * (1 / b.leadTimeHours);
            return scoreB - scoreA;
        })[0];
    }

    public async dispatchPO(po: PurchaseOrder): Promise<boolean> {
        const supplier = this.suppliers.get(po.supplierId);
        if (!supplier) return false;

        console.log(`[AutoOrder] Dispatching ${po.poId} to ${supplier.name} via ${supplier.apiEndpoint}`);

        // Mock API call to supplier EDI/REST endpoint
        // await fetch(supplier.apiEndpoint, { method: 'POST', body: JSON.stringify(po) });

        po.status = 'SENT';
        return true;
    }
}
