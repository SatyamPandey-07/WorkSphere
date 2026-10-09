/**
 * PoAPGenerator.ts
 * Generates the unique cryptographic payload and metadata for the Proof-of-Attendance badge upon successful check-in.
 * Combines venue ID, user ID, timestamp, and sensor data into a verifiable claim.
 */

export interface PoAPClaim {
    userId: string;
    venueId: string;
    timestamp: number;
    latitude: number;
    longitude: number;
    wifiSsid: string;
    sensorHash: string;
}

export class PoAPGenerator {
    public generateClaim(
        userId: string,
        venueId: string,
        latitude: number,
        longitude: number,
        wifiSsid: string,
        sensorData: string
    ): PoAPClaim {
        const sensorHash = this.hashString(sensorData);

        return {
            userId,
            venueId,
            timestamp: Date.now(),
            latitude,
            longitude,
            wifiSsid,
            sensorHash
        };
    }

    public serializeClaim(claim: PoAPClaim): string {
        return JSON.stringify(claim);
    }

    private hashString(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }
}
