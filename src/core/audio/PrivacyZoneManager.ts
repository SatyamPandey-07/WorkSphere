/**
 * PrivacyZoneManager.ts
 * Manages the virtual 3D coordinates of the user and nearby listeners to calculate the required masking intensity.
 * Dynamically adjusts the acoustic privacy mask based on proximity of others.
 */

export interface SpatialEntity {
    id: string;
    x: number;
    y: number;
    z: number;
    isTrusted: boolean;
}

export class PrivacyZoneManager {
    private userId: string;
    private entities: Map<string, SpatialEntity>;
    private privacyRadius: number; // in meters

    constructor(userId: string, privacyRadius: number = 2.0) {
        this.userId = userId;
        this.entities = new Map();
        this.privacyRadius = privacyRadius;
    }

    public updateEntity(entity: SpatialEntity): void {
        this.entities.set(entity.id, entity);
    }

    public removeEntity(entityId: string): void {
        this.entities.delete(entityId);
    }

    /**
     * Calculates the required masking intensity based on nearby untrusted entities.
     * Returns a value between 0.0 (no mask needed) and 1.0 (maximum mask).
     */
    public calculateRequiredMasking(userPos: { x: number; y: number; z: number }): number {
        let maxThreatLevel = 0.0;

        for (const entity of this.entities.values()) {
            if (entity.id === this.userId || entity.isTrusted) {
                continue;
            }

            const distance = Math.sqrt(
                Math.pow(entity.x - userPos.x, 2) +
                Math.pow(entity.y - userPos.y, 2) +
                Math.pow(entity.z - userPos.z, 2)
            );

            if (distance < this.privacyRadius) {
                // Threat level increases as distance decreases (inverse square law approximation)
                const threat = 1.0 - (distance / this.privacyRadius);
                if (threat > maxThreatLevel) {
                    maxThreatLevel = threat;
                }
            }
        }

        return maxThreatLevel;
    }

    public getNearbyUntrustedCount(userPos: { x: number; y: number; z: number }): number {
        let count = 0;
        for (const entity of this.entities.values()) {
            if (entity.id === this.userId || entity.isTrusted) continue;

            const distance = Math.sqrt(
                Math.pow(entity.x - userPos.x, 2) +
                Math.pow(entity.y - userPos.y, 2) +
                Math.pow(entity.z - userPos.z, 2)
            );

            if (distance < this.privacyRadius) {
                count++;
            }
        }
        return count;
    }
}
