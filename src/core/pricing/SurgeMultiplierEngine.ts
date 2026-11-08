/**
 * SurgeMultiplierEngine.ts
 * Calculates the final price multiplier based on the delta between predicted demand and real-time supply.
 * Applies non-linear scaling to prevent extreme price shocks while rewarding high-demand periods.
 */

export interface PricingContext {
    basePrice: number;
    totalDesks: number;
    availableDesks: number;
    predictedDemand: number;
    isWeekend: boolean;
    isHoliday: boolean;
}

export class SurgeMultiplierEngine {
    private maxMultiplier: number;
    private minMultiplier: number;
    private urgencyThreshold: number;

    constructor(maxMultiplier: number = 2.5, minMultiplier: number = 0.8, urgencyThreshold: number = 0.85) {
        this.maxMultiplier = maxMultiplier;
        this.minMultiplier = minMultiplier;
        this.urgencyThreshold = urgencyThreshold;
    }

    public calculateMultiplier(context: PricingContext): number {
        const occupancyRate = (context.totalDesks - context.availableDesks) / context.totalDesks;
        const demandSupplyRatio = context.predictedDemand / Math.max(1, context.availableDesks);

        let baseMultiplier = 1.0;

        // Apply occupancy-based surge
        if (occupancyRate > this.urgencyThreshold) {
            const excess = occupancyRate - this.urgencyThreshold;
            baseMultiplier += excess * 3.0; // Steep increase near capacity
        }

        // Apply demand prediction modifier
        if (demandSupplyRatio > 1.2) {
            baseMultiplier += (demandSupplyRatio - 1.2) * 0.5;
        } else if (demandSupplyRatio < 0.5 && occupancyRate < 0.3) {
            baseMultiplier -= 0.2; // Discount for low demand and low occupancy
        }

        // Apply temporal modifiers
        if (context.isWeekend) baseMultiplier *= 0.9;
        if (context.isHoliday) baseMultiplier *= 0.85;

        // Clamp to safe bounds
        return Math.max(this.minMultiplier, Math.min(this.maxMultiplier, baseMultiplier));
    }

    public getFinalPrice(context: PricingContext): number {
        const multiplier = this.calculateMultiplier(context);
        return Number((context.basePrice * multiplier).toFixed(2));
    }
}
