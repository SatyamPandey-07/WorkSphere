import {
    EmbodiedCarbonEstimator,
    FitoutProjectConfig,
    FitoutItem
} from '../../core/sustainability/EmbodiedCarbonEstimator';

describe('EmbodiedCarbonEstimator', () => {
    let estimator: EmbodiedCarbonEstimator;

    const sampleConfig: FitoutProjectConfig = {
        projectId: 'project-fitout-sf-hub',
        name: 'WorkSphere SF Flagship Fit-out',
        floorAreaSqMeters: 500,
        workstationCount: 50,
        fitoutLifespanYears: 10
    };

    const carpetItem: FitoutItem = {
        id: 'floor-carpet-tiles',
        name: 'Standard Nylon Carpet Tiles',
        category: 'FLOORING',
        quantity: 400,
        unit: 'm2',
        unitWeightKg: 4.5,
        emissionFactorA1_A3: 12.0, // 12 kg CO2e / m2
        transportDistanceKm: 120,
        installationWastePercent: 6.0,
        lifespanYears: 5, // Requires 1 replacement in a 10-year fitout
        recycledContentPercent: 15,
        endOfLifeRecyclingPercent: 20
    };

    const deskItem: FitoutItem = {
        id: 'furn-sit-stand-desk',
        name: 'Motorized Sit-Stand Workstation',
        category: 'FURNITURE',
        quantity: 50,
        unit: 'unit',
        unitWeightKg: 35.0,
        emissionFactorA1_A3: 65.0, // 65 kg CO2e per desk
        transportDistanceKm: 200,
        installationWastePercent: 2.0,
        lifespanYears: 12, // 0 replacements in a 10-year fitout
        recycledContentPercent: 30,
        endOfLifeRecyclingPercent: 75
    };

    beforeEach(() => {
        estimator = new EmbodiedCarbonEstimator(sampleConfig);
        estimator.addItem(carpetItem);
        estimator.addItem(deskItem);
    });

    describe('Validation and Configuration', () => {
        it('throws an error for non-positive area or workstation count', () => {
            expect(() => new EmbodiedCarbonEstimator({ ...sampleConfig, floorAreaSqMeters: 0 })).toThrow();
            expect(() => new EmbodiedCarbonEstimator({ ...sampleConfig, workstationCount: -5 })).toThrow();
        });

        it('computes modular emissions for an individual fitout item', () => {
            const breakdown = estimator.computeItemEmissions(carpetItem);
            // A1-A3: 400 * 12 = 4800
            expect(breakdown.a1_a3_productStage).toBe(4800);
            expect(breakdown.a4_transport).toBeGreaterThan(0);
            expect(breakdown.a5_installationWaste).toBeGreaterThan(0);
            expect(breakdown.upfrontCarbonA1_A5).toBeGreaterThan(4800);
            // B4: 1 replacement over 10 years (lifespan 5 years)
            expect(breakdown.b4_replacements).toBeGreaterThan(0);
            expect(breakdown.wholeLifeCarbon).toBeGreaterThan(breakdown.upfrontCarbonA1_A5);
        });
    });

    describe('Whole Life Carbon Assessment & Categorization', () => {
        it('generates a complete assessment report with intensities and category breakdown', () => {
            const report = estimator.assessLifecycleCarbon();

            expect(report.projectId).toBe('project-fitout-sf-hub');
            expect(report.totals.wholeLifeCarbon).toBeGreaterThan(0);
            expect(report.intensityPerSqMeter).toBeGreaterThan(0);
            expect(report.intensityPerWorkstation).toBeGreaterThan(0);

            // Category breakdown verification
            expect(report.categoryBreakdown.FLOORING).toBeGreaterThan(0);
            expect(report.categoryBreakdown.FURNITURE).toBeGreaterThan(0);
            expect(report.highImpactItems.length).toBe(2);
            expect(report.highImpactItems[0].percentOfTotal).toBeGreaterThan(0);
        });

        it('accurately assigns LETI Climate Challenge rating bands', () => {
            expect(estimator.calculateLETIRating(120)).toBe('A');
            expect(estimator.calculateLETIRating(210)).toBe('B');
            expect(estimator.calculateLETIRating(320)).toBe('C');
            expect(estimator.calculateLETIRating(420)).toBe('D');
            expect(estimator.calculateLETIRating(580)).toBe('E');
        });
    });

    describe('Material Substitution & Decarbonization Scenarios', () => {
        it('models carbon reduction from circular material substitutions', () => {
            const lowCarbonCarpet: FitoutItem = {
                ...carpetItem,
                id: 'floor-carpet-bio-recycled',
                name: '100% Recycled Bio-based Backing Carpet',
                emissionFactorA1_A3: 4.5, // Reduced from 12 to 4.5 kg CO2e / m2
                lifespanYears: 10,       // Higher durability, 0 replacements
                endOfLifeRecyclingPercent: 95
            };

            const result = estimator.modelSubstitutionScenario([
                {
                    originalItemId: 'floor-carpet-tiles',
                    replacementItem: lowCarbonCarpet
                }
            ]);

            expect(result.carbonSavedKg).toBeGreaterThan(0);
            expect(result.percentageReduction).toBeGreaterThan(20);
            expect(result.scenarioWholeLifeCarbon).toBeLessThan(result.baselineWholeLifeCarbon);
        });
    });
});
