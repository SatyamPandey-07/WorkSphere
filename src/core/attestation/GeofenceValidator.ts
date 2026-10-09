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
}

export interface VenueBounds {
    centerLat: number;
    centerLng: number;
    radiusMeters: number;
    allowedWifiSsids: string[];
}

export class GeofenceValidator {
    private readonly EARTH_RADIUS_KM = 6371;

    public validatePresence(sensorData: SensorData, venueBounds: VenueBounds): { isValid: boolean; confidence: number } {
        let confidence = 0;
        let isValid = true;

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
            confidence: Math.max(0, Math.min(100, confidence))
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
