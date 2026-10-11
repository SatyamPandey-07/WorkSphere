/**
 * GeofenceValidator.ts
 * Fuses GPS, WiFi SSID matching, and device accelerometer data to mathematically prove the user is physically inside the venue.
 * Returns a confidence score based on the alignment of multiple sensor inputs.
 */

export interface SensorData {
    gpsLat: number;
    gpsLng: number;
    gpsAccuracy: number;
    wifiSsid: string;
    accelerometerX: number;
    accelerometerY: number;
    accelerometerZ: number;
    gpsTimestamp?: number;
    timestamp?: number;
}

export interface VenueBounds {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    allowedWifiSsids: string[];
    maxGpsAgeMs?: number;
    allowedFutureSkewMs?: number;
}

export interface ValidationResult {
    isValid: boolean;
    confidence: number;
    reason?: string;
    isExpired?: boolean;
    gpsAgeMs?: number;
}

export class GeofenceValidator {
    public static readonly DEFAULT_MAX_GPS_AGE_MS = 60 * 1000; // 60 seconds
    public static readonly DEFAULT_MAX_FUTURE_SKEW_MS = 15 * 1000; // 15 seconds clock skew tolerance
    private readonly EARTH_RADIUS_KM = 6371;
    private isVerifying: boolean = false;

    public getIsVerifying(): boolean {
        return this.isVerifying;
    }

    public async verifyPresenceAsync(
        sensorData: SensorData,
        venueBounds: VenueBounds,
        currentTime: number = Date.now()
    ): Promise<ValidationResult> {
        this.isVerifying = true;
        try {
            return this.validatePresence(sensorData, venueBounds, currentTime);
        } finally {
            this.isVerifying = false;
        }
    }

    public validatePresence(
        sensorData: SensorData,
        venueBounds: VenueBounds,
        currentTime: number = Date.now()
    ): ValidationResult {
        let confidence = 0;
        let isValid = true;
        let reason: string | undefined;
        let isExpired = false;

        const maxAge = venueBounds.maxGpsAgeMs ?? GeofenceValidator.DEFAULT_MAX_GPS_AGE_MS;
        const maxFutureSkew = venueBounds.allowedFutureSkewMs ?? GeofenceValidator.DEFAULT_MAX_FUTURE_SKEW_MS;
        const gpsTime = sensorData.gpsTimestamp ?? sensorData.timestamp;

        // Verify GPS timestamp freshness and prevent replay or stale location caching
        if (gpsTime !== undefined) {
            const age = currentTime - gpsTime;
            if (age > maxAge) {
                isValid = false;
                isExpired = true;
                confidence -= 40;
                reason = `GPS timestamp expired (${Math.round(age / 1000)}s old, max allowed: ${Math.round(maxAge / 1000)}s)`;
            } else if (age < -maxFutureSkew) {
                isValid = false;
                confidence -= 40;
                reason = `GPS timestamp is in the future (${Math.round(Math.abs(age) / 1000)}s ahead)`;
            } else if (age >= 0 && age <= 10000) {
                // High-freshness bonus for real-time telemetry received within 10 seconds
                confidence += 10;
            }
        }

        const distance = this.calculateHaversineDistance(
            sensorData.gpsLat, sensorData.gpsLng,
            venueBounds.centerLat, venueBounds.centerLng
        );

        if (distance <= venueBounds.radiusMeters) {
            confidence += 50;
            if (distance <= venueBounds.radiusMeters * 0.5) {
                confidence += 20;
            }
        } else {
            isValid = false;
            if (!reason) {
                reason = `Outside geofence perimeter (${Math.round(distance)}m > ${venueBounds.radiusMeters}m)`;
            }
        }

        if (sensorData.gpsAccuracy <= 20) {
            confidence += 15;
        } else if (sensorData.gpsAccuracy > 50) {
            confidence -= 20;
        }

        if (venueBounds.allowedWifiSsids.includes(sensorData.wifiSsid)) {
            confidence += 30;
        } else {
            confidence -= 30;
            isValid = false;
            if (!reason) {
                reason = "Unauthorized or missing WiFi SSID";
            }
        }

        const movementMagnitude = Math.sqrt(
            sensorData.accelerometerX ** 2 +
            sensorData.accelerometerY ** 2 +
            sensorData.accelerometerZ ** 2
        );

        if (movementMagnitude > 9.5 && movementMagnitude < 10.5) {
            confidence += 10;
        }

        return {
            isValid: isValid && confidence >= 70,
            confidence: Math.max(0, Math.min(100, confidence)),
            reason,
            isExpired,
            gpsAgeMs: gpsTime !== undefined ? currentTime - gpsTime : undefined,
        };
    }

    private calculateHaversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const dLat = this.toRad(lat2 - lat1);
        const dLon = this.toRad(lon2 - lon1);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return this.EARTH_RADIUS_KM * c * 1000;
    }

    private toRad(degrees: number): number {
        return degrees * (Math.PI / 180);
    }
}
