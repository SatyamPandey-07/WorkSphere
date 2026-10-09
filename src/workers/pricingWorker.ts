/**
 * pricingWorker.ts
 * Background worker that periodically recalculates pricing models for all active venues without blocking the server.
 */

import { DemandCurvePredictor } from '@/core/pricing/DemandCurvePredictor';
import { SurgeMultiplierEngine } from '@/core/pricing/SurgeMultiplierEngine';
import { EventCorrelationMatrix } from '@/core/pricing/EventCorrelationMatrix';

self.onmessage = async (event: MessageEvent) => {
    const { type, payload } = event.data;

    if (type === 'CALCULATE_SURGE_PRICING') {
        try {
            const { historicalData, currentContext } = payload;

            const predictor = new DemandCurvePredictor();
            const correlationMatrix = new EventCorrelationMatrix();
            const surgeEngine = new SurgeMultiplierEngine();

            // 1. Forecast demand
            const baseForecast = predictor.forecast(historicalData, 4); // Next 4 hours

            // 2. Adjust for external factors
            const adjustedForecast = await correlationMatrix.adjustDemandForecast(
                baseForecast,
                currentContext.externalFactors
            );

            // 3. Calculate surge multiplier
            const contextWithForecast = {
                ...currentContext,
                predictedDemand: adjustedForecast[0] // Use immediate next hour forecast
            };

            const finalPrice = surgeEngine.getFinalPrice(contextWithForecast);
            const multiplier = surgeEngine.calculateMultiplier(contextWithForecast);

            self.postMessage({
                type: 'PRICING_RESULT',
                payload: {
                    finalPrice,
                    multiplier,
                    forecast: adjustedForecast
                }
            });
        } catch (error) {
            self.postMessage({ type: 'ERROR', error: String(error) });
        }
    }
};
