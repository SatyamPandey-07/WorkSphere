import {
    IAQVentilationController,
    ZoneVentilationConfig,
    IAQSensorReading,
    AmbientOutdoorReading
} from '../../core/iot/IAQVentilationController';

describe('IAQVentilationController', () => {
    let controller: IAQVentilationController;

    const sampleOfficeConfig: ZoneVentilationConfig = {
        zoneId: 'zone-east-open-office',
        name: 'East Wing Open Workstation',
        areaSqFt: 1000,
        ceilingHeightFt: 10,
        designOccupancy: 10,
        spaceType: 'office',
        targetCo2: 800,
        targetTvoc: 220,
        airDistributionEffectiveness: 1.0,
        damperMinPercent: 15,
        damperMaxPercent: 100,
        vavMinCfm: 150,
        vavMaxCfm: 1200
    };

    const sampleConferenceConfig: ZoneVentilationConfig = {
        zoneId: 'zone-conf-boardroom',
        name: 'Executive Boardroom',
        areaSqFt: 500,
        ceilingHeightFt: 12,
        designOccupancy: 20,
        spaceType: 'conference',
        targetCo2: 750,
        targetTvoc: 200,
        airDistributionEffectiveness: 0.8, // warm ceiling delivery
        damperMinPercent: 20,
        damperMaxPercent: 100,
        vavMinCfm: 200,
        vavMaxCfm: 1500
    };

    beforeEach(() => {
        controller = new IAQVentilationController();
        controller.registerZone(sampleOfficeConfig);
        controller.registerZone(sampleConferenceConfig);
    });

    describe('Zone Configuration & ASHRAE 62.1 Airflow Rates', () => {
        it('registers zones and provides configuration lookup', () => {
            const config = controller.getZoneConfig('zone-east-open-office');
            expect(config).toBeDefined();
            expect(config?.name).toBe('East Wing Open Workstation');
            expect(controller.getRegisteredZones()).toContain('zone-east-open-office');
            expect(controller.getRegisteredZones()).toContain('zone-conf-boardroom');
        });

        it('calculates ASHRAE 62.1 baseline ventilation rates for office space', () => {
            // Office: Rp = 5.0 CFM/person, Ra = 0.06 CFM/sqft
            // Design: 10 people * 5 = 50 CFM, 1000 sqft * 0.06 = 60 CFM
            // Vbz = 110 CFM. Ez = 1.0 -> Voz = 110 CFM
            const airflow = controller.calculateRequiredAirflow('zone-east-open-office');
            expect(airflow).toBe(110);
        });

        it('calculates dynamic demand-controlled airflow based on real-time occupancy', () => {
            // Dynamic occupancy = 4 people
            // Vbz = 4 * 5 + 1000 * 0.06 = 20 + 60 = 80 CFM
            const dcvAirflow = controller.calculateRequiredAirflow('zone-east-open-office', 4);
            expect(dcvAirflow).toBe(80);
        });

        it('accounts for air distribution effectiveness Ez in conference room', () => {
            // Conference: Rp = 5.0, Ra = 0.06
            // Design: 20 people * 5 = 100 CFM, 500 sqft * 0.06 = 30 CFM
            // Vbz = 130 CFM. Ez = 0.8 -> Voz = 130 / 0.8 = 162.5 CFM
            const airflow = controller.calculateRequiredAirflow('zone-conf-boardroom');
            expect(airflow).toBe(162.5);
        });

        it('throws an error when calculating airflow for unconfigured zone', () => {
            expect(() => {
                controller.calculateRequiredAirflow('non-existent-zone');
            }).toThrow('Zone non-existent-zone is not configured.');
        });
    });

    describe('IAQ Assessment & Composite Scoring', () => {
        it('yields EXCELLENT grade for pristine environmental parameters', () => {
            const reading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: Date.now(),
                co2: 450,
                pm25: 6.0,
                pm10: 10.0,
                tvoc: 80,
                temperature: 22.0,
                humidity: 45.0
            };

            const assessment = controller.assessIAQ(reading);
            expect(assessment.overallScore).toBeGreaterThanOrEqual(90);
            expect(assessment.grade).toBe('EXCELLENT');
            expect(assessment.ashraeCompliance).toBe(true);
            expect(assessment.requiredOutdoorAirCfm).toBe(110);
        });

        it('identifies critical pollutant and downgrades score for elevated CO2 and TVOC', () => {
            const reading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: Date.now(),
                co2: 1250, // exceeds target 800
                pm25: 28.0, // moderately elevated
                pm10: 40.0,
                tvoc: 450,  // exceeds target 220
                temperature: 23.0,
                humidity: 50.0
            };

            const assessment = controller.assessIAQ(reading);
            expect(assessment.ashraeCompliance).toBe(false);
            expect(assessment.overallScore).toBeLessThan(75);
            expect(['CO2', 'TVOC']).toContain(assessment.criticalPollutant);
        });

        it('correctly grades hazardous conditions during extreme contamination', () => {
            const reading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: Date.now(),
                co2: 2400,
                pm25: 110.0,
                pm10: 180.0,
                tvoc: 1500,
                temperature: 30.0,
                humidity: 85.0
            };

            const assessment = controller.assessIAQ(reading);
            expect(assessment.grade).toBe('HAZARDOUS');
            expect(assessment.overallScore).toBeLessThan(30);
            expect(assessment.ashraeCompliance).toBe(false);
        });
    });

    describe('Closed-Loop PID Modulation & Control Signals', () => {
        it('smooths CO2 readings and holds ventilation demand through the 25 ppm hysteresis band', () => {
        const base = Date.now();
        const send = (co2: number, offsetMs: number) =>
            controller.processSensorReading({
                zoneId: 'zone-east-open-office',
                timestamp: base + offsetMs,
                co2,
                pm25: 8,
                pm10: 12,
                tvoc: 150,
                temperature: 22,
                humidity: 45
            });

        send(798, 0);
        send(803, 1000);
        send(798, 2000);
        const noisySignal = send(803, 3000);
        const state = (controller as any).pidStates.get('zone-east-open-office');

        expect(state.smoothedCo2).toBeCloseTo(799.64, 2);
        expect(state.co2DemandActive).toBe(false);
        expect(noisySignal.damperOpenPercent).toBe(15);

        // Sustained readings cross the upper Schmitt threshold and activate demand.
        send(900, 4000);
        send(900, 5000);
        expect(state.co2DemandActive).toBe(true);

        // Returning to the setpoint is inside the deadband; demand stays active
        // until the filtered value crosses the lower threshold (target - 25 ppm).
        send(800, 6000);
        expect(state.co2DemandActive).toBe(true);
        send(700, 7000);
        send(700, 8000);
        send(700, 9000);
        send(700, 10000);
        expect(state.smoothedCo2).toBeLessThan(775);
        expect(state.co2DemandActive).toBe(false);
    });

    it('limits damper movement to two percentage points per second', () => {
        const base = Date.now();
        const send = (timestamp: number) =>
            controller.processSensorReading({
                zoneId: 'zone-east-open-office',
                timestamp,
                co2: 1600,
                pm25: 8,
                pm10: 12,
                tvoc: 150,
                temperature: 22,
                humidity: 45
            });

        const first = send(base);
        const second = send(base + 1000);
        const third = send(base + 2000);

        expect(first.damperOpenPercent).toBeLessThanOrEqual(17);
        expect(second.damperOpenPercent - first.damperOpenPercent).toBeLessThanOrEqual(2);
        expect(third.damperOpenPercent - second.damperOpenPercent).toBeLessThanOrEqual(2);
    });

    it('modulates damper and VAV airflow in response to elevated CO2', () => {
            const now = Date.now();
            const reading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: now,
                co2: 1100, // 300 ppm above setpoint
                pm25: 15.0,
                pm10: 25.0,
                tvoc: 200,
                temperature: 22.5,
                humidity: 48.0
            };

            const signal = controller.processSensorReading(reading);
            expect(signal.zoneId).toBe('zone-east-open-office');
            expect(signal.damperOpenPercent).toBeGreaterThan(15);
            expect(signal.vavTargetCfm).toBeGreaterThan(150);
            expect(controller.getLatestSignal('zone-east-open-office')).toEqual(signal);
        });

        it('triggers PURGE mode and high fan speed when severe indoor contaminant spike occurs', () => {
            const reading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: Date.now(),
                co2: 1650, // severe spike
                pm25: 30.0,
                pm10: 45.0,
                tvoc: 1200, // extreme spike
                temperature: 24.0,
                humidity: 55.0
            };

            const signal = controller.processSensorReading(reading);
            expect(signal.mode).toBe('PURGE');
            expect(signal.fanSpeed).toBe('high');
            expect(signal.hepaFiltrationBoost).toBe(true);
            expect(signal.alertMessages.some(m => m.includes('Purge cycle initiated'))).toBe(true);
        });

        it('switches to DEMAND_CONTROLLED mode when space has low occupancy', () => {
            const reading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: Date.now(),
                co2: 600,
                pm25: 8.0,
                pm10: 12.0,
                tvoc: 150,
                temperature: 21.5,
                humidity: 42.0
            };

            // Room designed for 10 people, only 2 present
            const signal = controller.processSensorReading(reading, 2);
            expect(signal.mode).toBe('DEMAND_CONTROLLED');
            expect(signal.damperOpenPercent).toBe(15); // Stays at minimum safe stop
            expect(signal.fanSpeed).toBe('low');
        });
    });

    describe('Wildfire & High Smog Defense Override', () => {
        it('throttles outdoor damper to safe minimum and maximizes internal HEPA recirculation', () => {
            // External ambient reporting hazardous wildfire smog
            const outdoorAmbient: AmbientOutdoorReading = {
                timestamp: Date.now(),
                pm25: 185.0,
                pm10: 260.0,
                aqi: 235,
                wildfireWarning: true
            };
            controller.updateAmbientOutdoorTelemetry(outdoorAmbient);

            const indoorReading: IAQSensorReading = {
                zoneId: 'zone-east-open-office',
                timestamp: Date.now(),
                co2: 700,
                pm25: 15.0,
                pm10: 20.0,
                tvoc: 180,
                temperature: 22.0,
                humidity: 45.0
            };

            const signal = controller.processSensorReading(indoorReading);
            expect(signal.mode).toBe('WILDFIRE_DEFENSE');
            expect(signal.damperOpenPercent).toBe(15); // Capped at damperMinPercent
            expect(signal.vavTargetCfm).toBe(1200); // Max internal recirculating CFM
            expect(signal.fanSpeed).toBe('high');
            expect(signal.hepaFiltrationBoost).toBe(true);
            expect(signal.airIonizationActive).toBe(true);
            expect(signal.alertMessages.some(m => m.includes('Wildfire Defense Mode activated'))).toBe(true);
        });
    });

    describe('PID Reset and State Maintenance', () => {
        it('resets PID accumulator on manual reset call', () => {
            const now = Date.now();
            controller.processSensorReading({
                zoneId: 'zone-east-open-office',
                timestamp: now,
                co2: 1200,
                pm25: 15.0,
                pm10: 20.0,
                tvoc: 300,
                temperature: 22.0,
                humidity: 50.0
            });

            expect(() => {
                controller.resetPID('zone-east-open-office');
            }).not.toThrow();
        });
    });
});
