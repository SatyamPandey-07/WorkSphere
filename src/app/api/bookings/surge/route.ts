/**
 * route.ts
 * API endpoint that returns the current dynamic price and surge indicators for a specific venue.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const venueId = searchParams.get('venueId');

        if (!venueId) {
            return NextResponse.json({ error: 'Missing venueId' }, { status: 400 });
        }

        // Mock data retrieval for scaffold
        const historicalData = Array.from({ length: 48 }, (_, i) => ({
            timestamp: Date.now() - (47 - i) * 3600000,
            demand: 5 + Math.sin(i / 4) * 3 + Math.random() * 2
        }));

        const currentContext = {
            basePrice: 15.00,
            totalDesks: 50,
            availableDesks: 8,
            predictedDemand: 12,
            isWeekend: false,
            isHoliday: false,
            externalFactors: {
                weatherCondition: 'rainy' as const,
                temperatureCelsius: 18,
                localEventDensity: 0.4,
                trafficIndex: 0.6
            }
        };

        // In a real implementation, this would be offloaded to the pricingWorker
        // For scaffold, we return a calculated mock response
        const occupancyRate = (currentContext.totalDesks - currentContext.availableDesks) / currentContext.totalDesks;
        const multiplier = occupancyRate > 0.8 ? 1.8 : 1.0;
        const finalPrice = Number((currentContext.basePrice * multiplier).toFixed(2));

        return NextResponse.json({
            success: true,
            venueId,
            pricing: {
                basePrice: currentContext.basePrice,
                finalPrice,
                multiplier,
                surgeActive: multiplier > 1.2,
                availableDesks: currentContext.availableDesks
            }
        }, { status: 200 });

    } catch (error) {
        console.error('Surge pricing calculation error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
