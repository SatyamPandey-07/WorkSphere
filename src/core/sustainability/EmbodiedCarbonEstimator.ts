/**
 * @file EmbodiedCarbonEstimator.ts
 * @description Whole Life Embodied Carbon lifecycle assessment engine for commercial
 * office fit-outs and coworking renovations compliant with BS EN 15978 and RICS standards.
 * Computes modular emissions (A1-A5, B4, C1-C4), LETI rating bands, and circular economy substitutions.
 */

export type MaterialCategory =
    | 'PARTITION'
    | 'FLOORING'
    | 'CEILING'
    | 'FURNITURE'
    | 'MEP_HVAC'
    | 'FINISHES';

export interface FitoutItem {
    id: string;
    name: string;
    category: MaterialCategory;
    quantity: number;
    unit: 'm2' | 'kg' | 'unit';
    unitWeightKg?: number;                    // Estimated weight per unit for transport
    emissionFactorA1_A3: number;              // kg CO2e per unit
    transportDistanceKm?: number;             // Distance from supplier to site (km)
    installationWastePercent?: number;        // Material loss during construction (%)
    lifespanYears: number;                    // Component operational lifespan
    recycledContentPercent?: number;          // Pre/post consumer recycled material (%)
    endOfLifeRecyclingPercent?: number;       // Diversion rate from landfill at end of life (%)
}

export interface FitoutProjectConfig {
    projectId: string;
    name: string;
    floorAreaSqMeters: number;
    workstationCount: number;
    fitoutLifespanYears: number; // Assessment study period (typically 5, 10, or 15 years)
}

export interface ModularEmissionBreakdown {
    a1_a3_productStage: number;       // Raw materials + manufacturing
    a4_transport: number;             // Transport to site
    a5_installationWaste: number;     // Waste during installation
    upfrontCarbonA1_A5: number;       // Total upfront carbon
    b4_replacements: number;          // Recurring replacements over study period
    c1_c4_endOfLife: number;          // Deconstruction and processing
    wholeLifeCarbon: number;          // Total A1-C4 embodied carbon
}

export type LETIRatingBand = 'A' | 'B' | 'C' | 'D' | 'E';

export interface EmbodiedCarbonReport {
    projectId: string;
    floorAreaSqMeters: number;
    workstationCount: number;
    studyPeriodYears: number;
    totals: ModularEmissionBreakdown;
    intensityPerSqMeter: number;      // kg CO2e / m2
    intensityPerWorkstation: number;  // kg CO2e / desk
    letiRatingBand: LETIRatingBand;
    categoryBreakdown: Record<MaterialCategory, number>;
    highImpactItems: Array<{ id: string; name: string; totalCarbon: number; percentOfTotal: number }>;
}

export interface MaterialSubstitution {
    originalItemId: string;
    replacementItem: FitoutItem;
}

export interface SubstitutionScenarioResult {
    baselineWholeLifeCarbon: number;
    scenarioWholeLifeCarbon: number;
    carbonSavedKg: number;
    percentageReduction: number;
    baselineLetiBand: LETIRatingBand;
    scenarioLetiBand: LETIRatingBand;
}

export class EmbodiedCarbonEstimator {
    // Default road freight transport emission factor: 0.00012 kg CO2e / kg / km
    public static readonly DEFAULT_TRANSPORT_FACTOR = 0.00012;

    private config: FitoutProjectConfig;
    private inventory: Map<string, FitoutItem> = new Map();

    constructor(config: FitoutProjectConfig) {
        if (config.floorAreaSqMeters <= 0) {
            throw new Error('Floor area must be greater than zero.');
        }
        if (config.workstationCount <= 0) {
            throw new Error('Workstation count must be greater than zero.');
        }
        this.config = { ...config };
    }

    /**
     * Adds an item to the fitout bill of materials.
     */
    public addItem(item: FitoutItem): void {
        this.inventory.set(item.id, { ...item });
    }

    /**
     * Adds multiple inventory items.
     */
    public addItems(items: FitoutItem[]): void {
        for (const item of items) {
            this.addItem(item);
        }
    }

    /**
     * Computes modular emissions for a single inventory item.
     */
    public computeItemEmissions(item: FitoutItem): ModularEmissionBreakdown {
        // A1-A3: Product Stage
        const a1_a3 = item.quantity * item.emissionFactorA1_A3;

        // A4: Transport to Site
        const distKm = item.transportDistanceKm ?? 150;
        const weightKg = item.unitWeightKg ?? (item.unit === 'kg' ? item.quantity : item.quantity * 15.0);
        const a4 = weightKg * distKm * EmbodiedCarbonEstimator.DEFAULT_TRANSPORT_FACTOR;

        // A5: Installation Waste
        const wastePct = (item.installationWastePercent ?? 5.0) / 100;
        const a5 = (a1_a3 + a4) * wastePct;

        const upfront = a1_a3 + a4 + a5;

        // B4: Recurring Replacements
        const studyYears = this.config.fitoutLifespanYears;
        const replacementsCount = Math.max(0, Math.ceil(studyYears / item.lifespanYears) - 1);
        const b4 = replacementsCount * upfront;

        // C1-C4: End of Life (Deconstruction & Processing)
        // Baseline 5% of A1-A3, reduced by recycling diversion credit
        const recyclingPct = (item.endOfLifeRecyclingPercent ?? 30.0) / 100;
        const c1_c4 = Math.max(0, (a1_a3 * 0.08) * (1 - recyclingPct * 0.5));

        const wholeLife = Math.round((upfront + b4 + c1_c4) * 100) / 100;

        return {
            a1_a3_productStage: Math.round(a1_a3 * 100) / 100,
            a4_transport: Math.round(a4 * 100) / 100,
            a5_installationWaste: Math.round(a5 * 100) / 100,
            upfrontCarbonA1_A5: Math.round(upfront * 100) / 100,
            b4_replacements: Math.round(b4 * 100) / 100,
            c1_c4_endOfLife: Math.round(c1_c4 * 100) / 100,
            wholeLifeCarbon: wholeLife
        };
    }

    /**
     * Generates a comprehensive whole life carbon assessment report.
     */
    public assessLifecycleCarbon(): EmbodiedCarbonReport {
        const totals: ModularEmissionBreakdown = {
            a1_a3_productStage: 0,
            a4_transport: 0,
            a5_installationWaste: 0,
            upfrontCarbonA1_A5: 0,
            b4_replacements: 0,
            c1_c4_endOfLife: 0,
            wholeLifeCarbon: 0
        };

        const categoryBreakdown: Record<MaterialCategory, number> = {
            PARTITION: 0,
            FLOORING: 0,
            CEILING: 0,
            FURNITURE: 0,
            MEP_HVAC: 0,
            FINISHES: 0
        };

        const itemTotals: Array<{ id: string; name: string; totalCarbon: number }> = [];

        for (const item of this.inventory.values()) {
            const itemEmissions = this.computeItemEmissions(item);

            totals.a1_a3_productStage += itemEmissions.a1_a3_productStage;
            totals.a4_transport += itemEmissions.a4_transport;
            totals.a5_installationWaste += itemEmissions.a5_installationWaste;
            totals.upfrontCarbonA1_A5 += itemEmissions.upfrontCarbonA1_A5;
            totals.b4_replacements += itemEmissions.b4_replacements;
            totals.c1_c4_endOfLife += itemEmissions.c1_c4_endOfLife;
            totals.wholeLifeCarbon += itemEmissions.wholeLifeCarbon;

            categoryBreakdown[item.category] += itemEmissions.wholeLifeCarbon;
            itemTotals.push({
                id: item.id,
                name: item.name,
                totalCarbon: itemEmissions.wholeLifeCarbon
            });
        }

        // Round all totals
        for (const key of Object.keys(totals) as Array<keyof ModularEmissionBreakdown>) {
            totals[key] = Math.round(totals[key] * 100) / 100;
        }
        for (const cat of Object.keys(categoryBreakdown) as MaterialCategory[]) {
            categoryBreakdown[cat] = Math.round(categoryBreakdown[cat] * 100) / 100;
        }

        const intensityPerSqMeter = Math.round((totals.wholeLifeCarbon / this.config.floorAreaSqMeters) * 100) / 100;
        const intensityPerWorkstation = Math.round((totals.wholeLifeCarbon / this.config.workstationCount) * 100) / 100;

        const letiRatingBand = this.calculateLETIRating(intensityPerSqMeter);

        // Sort items by impact
        itemTotals.sort((a, b) => b.totalCarbon - a.totalCarbon);
        const highImpactItems = itemTotals.slice(0, 5).map(item => ({
            ...item,
            percentOfTotal: totals.wholeLifeCarbon > 0
                ? Math.round((item.totalCarbon / totals.wholeLifeCarbon) * 1000) / 10
                : 0
        }));

        return {
            projectId: this.config.projectId,
            floorAreaSqMeters: this.config.floorAreaSqMeters,
            workstationCount: this.config.workstationCount,
            studyPeriodYears: this.config.fitoutLifespanYears,
            totals,
            intensityPerSqMeter,
            intensityPerWorkstation,
            letiRatingBand,
            categoryBreakdown,
            highImpactItems
        };
    }

    /**
     * Determines the LETI / RIBA 2030 Climate Challenge Fit-out rating band:
     * Band A: < 150 kg CO2e/m2
     * Band B: 150 - 250 kg CO2e/m2
     * Band C: 250 - 350 kg CO2e/m2
     * Band D: 350 - 500 kg CO2e/m2
     * Band E: > 500 kg CO2e/m2
     */
    public calculateLETIRating(intensityPerSqMeter: number): LETIRatingBand {
        if (intensityPerSqMeter < 150) return 'A';
        if (intensityPerSqMeter <= 250) return 'B';
        if (intensityPerSqMeter <= 350) return 'C';
        if (intensityPerSqMeter <= 500) return 'D';
        return 'E';
    }

    /**
     * Evaluates carbon reduction potential through material substitution scenarios.
     */
    public modelSubstitutionScenario(substitutions: MaterialSubstitution[]): SubstitutionScenarioResult {
        const baselineReport = this.assessLifecycleCarbon();

        // Create temporary estimator with substitutions applied
        const scenarioEstimator = new EmbodiedCarbonEstimator(this.config);
        for (const item of this.inventory.values()) {
            const sub = substitutions.find(s => s.originalItemId === item.id);
            if (sub) {
                scenarioEstimator.addItem(sub.replacementItem);
            } else {
                scenarioEstimator.addItem(item);
            }
        }

        const scenarioReport = scenarioEstimator.assessLifecycleCarbon();

        const carbonSavedKg = Math.round((baselineReport.totals.wholeLifeCarbon - scenarioReport.totals.wholeLifeCarbon) * 100) / 100;
        const percentageReduction = baselineReport.totals.wholeLifeCarbon > 0
            ? Math.round((carbonSavedKg / baselineReport.totals.wholeLifeCarbon) * 1000) / 10
            : 0;

        return {
            baselineWholeLifeCarbon: baselineReport.totals.wholeLifeCarbon,
            scenarioWholeLifeCarbon: scenarioReport.totals.wholeLifeCarbon,
            carbonSavedKg,
            percentageReduction,
            baselineLetiBand: baselineReport.letiRatingBand,
            scenarioLetiBand: scenarioReport.letiRatingBand
        };
    }
}
