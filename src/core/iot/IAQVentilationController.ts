/**
 * @file IAQVentilationController.ts
 * @description Automated Indoor Air Quality (IAQ) and HVAC ventilation controller
 * compliant with ASHRAE 62.1-2022 standards. Manages multi-pollutant telemetry,
 * dynamic demand-controlled ventilation (DCV), PID closed-loop damper/fan modulation,
 * and emergency wildfire/smog outdoor recirculation overrides.
 */

export interface IAQSensorReading {
    zoneId: string;
    timestamp: number;
    co2: number;            // parts per million (ppm)
    pm25: number;           // micrograms per cubic meter (ug/m3)
    pm10: number;           // micrograms per cubic meter (ug/m3)
    tvoc: number;           // parts per billion (ppb)
    formaldehyde?: number;  // parts per million (ppm)
    temperature: number;    // degrees Celsius (deg C)
    humidity: number;       // relative humidity (0 - 100 %)
}

export interface AmbientOutdoorReading {
    timestamp: number;
    pm25: number;           // ug/m3
    pm10: number;           // ug/m3
    aqi: number;            // EPA Air Quality Index (0 - 500)
    wildfireWarning: boolean;
}

export type SpaceCategory = 'office' | 'conference' | 'breakroom' | 'classroom' | 'corridor';

export interface ZoneVentilationConfig {
    zoneId: string;
    name: string;
    areaSqFt: number;
    ceilingHeightFt?: number;
    designOccupancy: number;
    spaceType: SpaceCategory;
    targetCo2: number;                     // e.g. 800 ppm
    targetTvoc: number;                    // e.g. 220 ppb
    airDistributionEffectiveness: number;  // Ez: typically 1.0 (ceiling supply), 0.8 (warm ceiling supply)
    damperMinPercent: number;              // Minimum mechanical stop (e.g. 15%)
    damperMaxPercent: number;              // Maximum damper travel (default 100%)
    vavMinCfm: number;                     // Minimum VAV CFM delivery
    vavMaxCfm: number;                     // Maximum VAV CFM delivery
}

export interface PIDGains {
    kp: number;
    ki: number;
    kd: number;
    antiWindupMin: number;
    antiWindupMax: number;
}

export type IAQGrade = 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'POOR' | 'UNHEALTHY' | 'HAZARDOUS';

export type VentilationMode =
    | 'NORMAL'
    | 'DEMAND_CONTROLLED'
    | 'PURGE'
    | 'WILDFIRE_DEFENSE'
    | 'OFF_HOURS_SETBACK';

export interface IAQAssessment {
    overallScore: number;                 // 0 to 100
    grade: IAQGrade;
    criticalPollutant: string;
    ashraeCompliance: boolean;
    requiredOutdoorAirCfm: number;
    subScores: {
        co2Score: number;
        pm25Score: number;
        tvocScore: number;
        thermalScore: number;
    };
}

export interface VentilationControlSignal {
    zoneId: string;
    timestamp: number;
    mode: VentilationMode;
    damperOpenPercent: number;            // 0 - 100%
    vavTargetCfm: number;                 // CFM (Cubic Feet per Minute)
    fanSpeed: 'off' | 'low' | 'medium' | 'high';
    hepaFiltrationBoost: boolean;
    airIonizationActive: boolean;
    alertMessages: string[];
}

interface PIDState {
    integralError: number;
    lastError: number;
    lastTimestamp: number;
    smoothedCo2?: number;
    co2DemandActive: boolean;
    lastDamperOpenPercent: number;
}

const CO2_EMA_ALPHA = 0.2;
const CO2_DEADBAND_PPM = 25;
const MAX_DAMPER_CHANGE_PERCENT_PER_SECOND = 2;

export class IAQVentilationController {
    private zoneConfigs: Map<string, ZoneVentilationConfig> = new Map();
    private pidStates: Map<string, PIDState> = new Map();
    private latestReadings: Map<string, IAQSensorReading> = new Map();
    private latestSignals: Map<string, VentilationControlSignal> = new Map();
    private latestAmbient?: AmbientOutdoorReading;
    private pidGains: PIDGains;

    // ASHRAE 62.1-2022 default ventilation rates
    // Rp = CFM per person, Ra = CFM per square foot
    private static readonly ASHRAE_RATES: Record<SpaceCategory, { rp: number; ra: number }> = {
        office: { rp: 5.0, ra: 0.06 },
        conference: { rp: 5.0, ra: 0.06 },
        breakroom: { rp: 5.0, ra: 0.12 },
        classroom: { rp: 10.0, ra: 0.12 },
        corridor: { rp: 0.0, ra: 0.06 }
    };

    constructor(customGains?: Partial<PIDGains>) {
        this.pidGains = {
            kp: 0.08,
            ki: 0.015,
            kd: 0.04,
            antiWindupMin: -30.0,
            antiWindupMax: 50.0,
            ...customGains
        };
    }

    /**
     * Registers a building zone with its architectural and ventilation configurations.
     */
    public registerZone(config: ZoneVentilationConfig): void {
        this.zoneConfigs.set(config.zoneId, config);
        this.pidStates.set(config.zoneId, {
            integralError: 0,
            lastError: 0,
            lastTimestamp: Date.now(),
            smoothedCo2: undefined,
            co2DemandActive: false,
            lastDamperOpenPercent: config.damperMinPercent
        });
    }

    /**
     * Returns the registered configuration for a zone.
     */
    public getZoneConfig(zoneId: string): ZoneVentilationConfig | undefined {
        return this.zoneConfigs.get(zoneId);
    }

    /**
     * Updates external ambient environmental sensor telemetry (weather station / city AQI).
     */
    public updateAmbientOutdoorTelemetry(reading: AmbientOutdoorReading): void {
        this.latestAmbient = { ...reading };
    }

    /**
     * Calculates the baseline outdoor air requirement based on ASHRAE Standard 62.1-2022.
     * Vbz = Rp * Pz + Ra * Az
     * Voz = Vbz / Ez
     */
    public calculateRequiredAirflow(zoneId: string, currentOccupancy?: number): number {
        const config = this.zoneConfigs.get(zoneId);
        if (!config) throw new Error(`Zone ${zoneId} is not configured.`);

        const rates = IAQVentilationController.ASHRAE_RATES[config.spaceType] || IAQVentilationController.ASHRAE_RATES.office;
        const population = currentOccupancy !== undefined ? Math.max(0, currentOccupancy) : config.designOccupancy;

        const vbz = rates.rp * population + rates.ra * config.areaSqFt;
        const ez = Math.max(0.1, config.airDistributionEffectiveness);
        const voz = vbz / ez;

        return Math.round(voz * 100) / 100;
    }

    /**
     * Assesses comprehensive IAQ indices based on multi-sensor reading.
     */
    public assessIAQ(reading: IAQSensorReading, currentOccupancy?: number): IAQAssessment {
        const config = this.zoneConfigs.get(reading.zoneId);
        if (!config) throw new Error(`Zone ${reading.zoneId} is not configured.`);

        // 1. CO2 Sub-Score (Target: <= 800 ppm)
        let co2Score = 100;
        if (reading.co2 > 600 && reading.co2 <= 800) {
            co2Score = 100 - ((reading.co2 - 600) / 200) * 15; // 100 -> 85
        } else if (reading.co2 > 800 && reading.co2 <= 1000) {
            co2Score = 85 - ((reading.co2 - 800) / 200) * 20;  // 85 -> 65
        } else if (reading.co2 > 1000 && reading.co2 <= 1500) {
            co2Score = 65 - ((reading.co2 - 1000) / 500) * 35; // 65 -> 30
        } else if (reading.co2 > 1500) {
            co2Score = Math.max(0, 30 - ((reading.co2 - 1500) / 500) * 30);
        }

        // 2. PM2.5 Sub-Score (Target: <= 12 ug/m3)
        let pm25Score = 100;
        if (reading.pm25 > 12 && reading.pm25 <= 35.4) {
            pm25Score = 100 - ((reading.pm25 - 12) / 23.4) * 30; // 100 -> 70
        } else if (reading.pm25 > 35.4 && reading.pm25 <= 55.4) {
            pm25Score = 70 - ((reading.pm25 - 35.4) / 20) * 30;  // 70 -> 40
        } else if (reading.pm25 > 55.4) {
            pm25Score = Math.max(0, 40 - ((reading.pm25 - 55.4) / 50) * 40);
        }

        // 3. TVOC Sub-Score (Target: <= 220 ppb)
        let tvocScore = 100;
        if (reading.tvoc > 220 && reading.tvoc <= 660) {
            tvocScore = 100 - ((reading.tvoc - 220) / 440) * 40; // 100 -> 60
        } else if (reading.tvoc > 660) {
            tvocScore = Math.max(0, 60 - ((reading.tvoc - 660) / 1000) * 60);
        }

        // 4. Thermal Comfort Sub-Score (Ideal: 20-24 C, 30-60% RH)
        let thermalScore = 100;
        if (reading.temperature < 19 || reading.temperature > 25) {
            const dev = Math.min(Math.abs(reading.temperature - 22), 10);
            thermalScore -= dev * 6;
        }
        if (reading.humidity < 30 || reading.humidity > 60) {
            const rhDev = reading.humidity < 30 ? (30 - reading.humidity) : (reading.humidity - 60);
            thermalScore -= Math.min(rhDev * 1.5, 40);
        }
        thermalScore = Math.max(0, Math.min(100, thermalScore));

        // Composite Weighted Score
        // Weight: CO2: 35%, PM2.5: 35%, TVOC: 20%, Thermal: 10%
        const overallScore = Math.round(
            (co2Score * 0.35 + pm25Score * 0.35 + tvocScore * 0.20 + thermalScore * 0.10) * 10
        ) / 10;

        // Determine critical pollutant
        const pollutantMap: [string, number][] = [
            ['CO2', co2Score],
            ['PM2.5', pm25Score],
            ['TVOC', tvocScore],
            ['Thermal', thermalScore]
        ];
        pollutantMap.sort((a, b) => a[1] - b[1]);
        const criticalPollutant = pollutantMap[0][0];

        // Classification
        let grade: IAQGrade = 'EXCELLENT';
        if (overallScore >= 90) grade = 'EXCELLENT';
        else if (overallScore >= 75) grade = 'GOOD';
        else if (overallScore >= 60) grade = 'MODERATE';
        else if (overallScore >= 45) grade = 'POOR';
        else if (overallScore >= 30) grade = 'UNHEALTHY';
        else grade = 'HAZARDOUS';

        const ashraeCompliance = reading.co2 <= config.targetCo2 && reading.pm25 <= 35.4;
        const requiredOutdoorAirCfm = this.calculateRequiredAirflow(reading.zoneId, currentOccupancy);

        return {
            overallScore,
            grade,
            criticalPollutant,
            ashraeCompliance,
            requiredOutdoorAirCfm,
            subScores: {
                co2Score: Math.round(co2Score * 10) / 10,
                pm25Score: Math.round(pm25Score * 10) / 10,
                tvocScore: Math.round(tvocScore * 10) / 10,
                thermalScore: Math.round(thermalScore * 10) / 10
            }
        };
    }

    /**
     * Executes closed-loop PID control and safety logic to compute HVAC modulation signals.
     */
    public processSensorReading(
        reading: IAQSensorReading,
        currentOccupancy?: number
    ): VentilationControlSignal {
        const config = this.zoneConfigs.get(reading.zoneId);
        if (!config) throw new Error(`Zone ${reading.zoneId} is not configured.`);

        this.latestReadings.set(reading.zoneId, reading);
        const assessment = this.assessIAQ(reading, currentOccupancy);
        const alertMessages: string[] = [];

        // Check Outdoor Ambient Conditions (Wildfire / Smog defense)
        const isWildfireDefense = this.latestAmbient && (
            this.latestAmbient.wildfireWarning ||
            this.latestAmbient.pm25 > 100 ||
            this.latestAmbient.aqi >= 200
        );

        if (isWildfireDefense) {
            alertMessages.push(
                `ALERT: External air quality hazardous (PM2.5: ${this.latestAmbient?.pm25} ug/m3, AQI: ${this.latestAmbient?.aqi}). Wildfire Defense Mode activated.`
            );

            // Throttle damper intake to minimum life safety floor
            const safeDamper = Math.max(10, config.damperMinPercent);
            const highCfm = config.vavMaxCfm;

            const signal: VentilationControlSignal = {
                zoneId: reading.zoneId,
                timestamp: reading.timestamp,
                mode: 'WILDFIRE_DEFENSE',
                damperOpenPercent: safeDamper,
                vavTargetCfm: highCfm, // Maximum recirculating internal airflow
                fanSpeed: 'high',
                hepaFiltrationBoost: true,
                airIonizationActive: true,
                alertMessages
            };
            this.latestSignals.set(reading.zoneId, signal);
            return signal;
        }

        // Determine Mode
        let mode: VentilationMode = 'NORMAL';
        if (currentOccupancy !== undefined && currentOccupancy < config.designOccupancy) {
            mode = 'DEMAND_CONTROLLED';
        }
        if (reading.co2 > 1400 || reading.tvoc > 1000) {
            mode = 'PURGE';
            alertMessages.push(`High indoor contaminant detected (CO2: ${reading.co2} ppm, TVOC: ${reading.tvoc} ppb). Purge cycle initiated.`);
        }

        // Closed-Loop PID Calculation
        let pidState = this.pidStates.get(reading.zoneId);
        if (!pidState) {
            pidState = {
                integralError: 0,
                lastError: 0,
                lastTimestamp: reading.timestamp,
                smoothedCo2: reading.co2,
                co2DemandActive: false,
                lastDamperOpenPercent: config.damperMinPercent
            };
            this.pidStates.set(reading.zoneId, pidState);
        }

        const dt = Math.max(1, (reading.timestamp - pidState.lastTimestamp) / 1000); // in seconds

        // Smooth noisy CO2 telemetry per zone before feeding the actuator control loop.
        const previousSmoothedCo2 = pidState.smoothedCo2 ?? reading.co2;
        const smoothedCo2 =
            previousSmoothedCo2 +
            CO2_EMA_ALPHA * (reading.co2 - previousSmoothedCo2);
        pidState.smoothedCo2 = smoothedCo2;

        // Schmitt trigger: activate above target + 25 ppm and stay active until
        // CO2 falls below target - 25 ppm. Readings inside the deadband do not
        // toggle the ventilation demand state.
        if (!pidState.co2DemandActive &&
            smoothedCo2 >= config.targetCo2 + CO2_DEADBAND_PPM) {
            pidState.co2DemandActive = true;
        } else if (pidState.co2DemandActive &&
            smoothedCo2 <= config.targetCo2 - CO2_DEADBAND_PPM) {
            pidState.co2DemandActive = false;
        }

        // Combined normalized error: primarily smoothed CO2 error with secondary TVOC contribution.
        const co2Error = pidState.co2DemandActive
            ? Math.max(0, smoothedCo2 - config.targetCo2)
            : 0;
        const tvocError = Math.max(0, reading.tvoc - config.targetTvoc);
        const effectiveError = (co2Error / 10.0) + (tvocError / 20.0);

        // Proportional term
        const pTerm = this.pidGains.kp * effectiveError;

        // Integral term with anti-windup clamping
        pidState.integralError += effectiveError * (dt / 60); // integrated per minute
        pidState.integralError = Math.max(
            this.pidGains.antiWindupMin,
            Math.min(this.pidGains.antiWindupMax, pidState.integralError)
        );
        const iTerm = this.pidGains.ki * pidState.integralError;

        // Derivative term
        const dError = (effectiveError - pidState.lastError) / dt;
        const dTerm = this.pidGains.kd * dError;

        // Update PID state
        pidState.lastError = effectiveError;
        pidState.lastTimestamp = reading.timestamp;

        // Calculate desired damper opening, then apply a slew-rate limit so
        // telemetry noise cannot make the physical actuator cycle rapidly.
        const baseDamper = config.damperMinPercent;
        const rawDamper = baseDamper + pTerm + iTerm + dTerm;
        const desiredDamperOpenPercent = Math.max(
            config.damperMinPercent,
            Math.min(config.damperMaxPercent, Math.round(rawDamper * 10) / 10)
        );
        const maxDamperStep =
            MAX_DAMPER_CHANGE_PERCENT_PER_SECOND * dt;
        const damperDelta = desiredDamperOpenPercent - pidState.lastDamperOpenPercent;
        const damperOpenPercent = Math.max(
            config.damperMinPercent,
            Math.min(
                config.damperMaxPercent,
                pidState.lastDamperOpenPercent +
                    Math.sign(damperDelta) * Math.min(Math.abs(damperDelta), maxDamperStep)
            )
        );
        pidState.lastDamperOpenPercent = damperOpenPercent;

        // Calculate Target VAV CFM Output
        const baseRequiredCfm = assessment.requiredOutdoorAirCfm;
        const cfmRange = config.vavMaxCfm - config.vavMinCfm;
        const scaledCfm = config.vavMinCfm + cfmRange * ((damperOpenPercent - config.damperMinPercent) / (config.damperMaxPercent - config.damperMinPercent || 1));
        const vavTargetCfm = Math.max(baseRequiredCfm, Math.min(config.vavMaxCfm, Math.round(scaledCfm)));

        // Fan Speed Classification
        let fanSpeed: 'off' | 'low' | 'medium' | 'high' = 'low';
        if (damperOpenPercent >= 80 || mode === 'PURGE') fanSpeed = 'high';
        else if (damperOpenPercent >= 45) fanSpeed = 'medium';
        else fanSpeed = 'low';

        // Filtration boost if PM2.5 or TVOC elevated
        const hepaFiltrationBoost = reading.pm25 > 25 || reading.tvoc > 400 || mode === 'PURGE';
        const airIonizationActive = reading.tvoc > 500 || reading.pm25 > 35;

        const signal: VentilationControlSignal = {
            zoneId: reading.zoneId,
            timestamp: reading.timestamp,
            mode,
            damperOpenPercent,
            vavTargetCfm,
            fanSpeed,
            hepaFiltrationBoost,
            airIonizationActive,
            alertMessages
        };

        this.latestSignals.set(reading.zoneId, signal);
        return signal;
    }

    /**
     * Retrieves the latest control signal generated for a zone.
     */
    public getLatestSignal(zoneId: string): VentilationControlSignal | undefined {
        return this.latestSignals.get(zoneId);
    }

    /**
     * Returns all registered zone IDs.
     */
    public getRegisteredZones(): string[] {
        return Array.from(this.zoneConfigs.keys());
    }

    /**
     * Resets PID state for a given zone (e.g. following maintenance or manual override).
     */
    public resetPID(zoneId: string): void {
        const state = this.pidStates.get(zoneId);
        if (state) {
            state.integralError = 0;
            state.lastError = 0;
            state.lastTimestamp = Date.now();
            state.smoothedCo2 = undefined;
            state.co2DemandActive = false;
            state.lastDamperOpenPercent =
                this.zoneConfigs.get(zoneId)?.damperMinPercent ?? state.lastDamperOpenPercent;
        }
    }
}
