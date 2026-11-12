/**
 * VenueTwinStateTree.ts
 * Manages the hierarchical, immutable state tree representing every desk, 
 * room, and sensor in the physical venue for the Digital Twin.
 */

export type SensorType = 'occupancy' | 'temperature' | 'noise' | 'co2' | 'humidity';

export interface SensorReading {
    sensorId: string;
    type: SensorType;
    value: number;
    timestamp: number;
}

export interface DeskState {
    deskId: string;
    isOccupied: boolean;
    userId?: string;
    environment: {
        temp: number;
        noiseLevel: number;
        lightLevel: number;
    };
}

export interface RoomState {
    roomId: string;
    capacity: number;
    currentOccupancy: number;
    desks: Map<string, DeskState>;
    aggregateSensors: Record<SensorType, number>;
}

export interface VenueState {
    venueId: string;
    totalCapacity: number;
    totalOccupancy: number;
    rooms: Map<string, RoomState>;
    lastUpdated: number;
}

export class VenueTwinStateTree {
    private state: VenueState;

    constructor(venueId: string) {
        this.state = {
            venueId,
            totalCapacity: 0,
            totalOccupancy: 0,
            rooms: new Map(),
            lastUpdated: Date.now()
        };
    }

    public addRoom(roomId: string, capacity: number): void {
        if (this.state.rooms.has(roomId)) return;

        this.state.rooms.set(roomId, {
            roomId,
            capacity,
            currentOccupancy: 0,
            desks: new Map(),
            aggregateSensors: {
                occupancy: 0,
                temperature: 22.0,
                noise: 40.0,
                co2: 400,
                humidity: 45
            }
        });

        this.state.totalCapacity += capacity;
        this.touch();
    }

    public addDesk(roomId: string, deskId: string): void {
        const room = this.state.rooms.get(roomId);
        if (!room) throw new Error(`Room ${roomId} not found`);

        if (!room.desks.has(deskId)) {
            room.desks.set(deskId, {
                deskId,
                isOccupied: false,
                environment: { temp: 22.0, noiseLevel: 40.0, lightLevel: 50.0 }
            });
            this.touch();
        }
    }

    public updateDeskOccupancy(roomId: string, deskId: string, isOccupied: boolean, userId?: string): void {
        const room = this.state.rooms.get(roomId);
        if (!room) return;

        const desk = room.desks.get(deskId);
        if (!desk) return;

        const wasOccupied = desk.isOccupied;
        desk.isOccupied = isOccupied;
        desk.userId = isOccupied ? userId : undefined;

        if (wasOccupied !== isOccupied) {
            room.currentOccupancy += isOccupied ? 1 : -1;
            this.recalculateVenueOccupancy();
        }

        this.touch();
    }

    public ingestSensorReading(roomId: string, reading: SensorReading): void {
        const room = this.state.rooms.get(roomId);
        if (!room) return;

        // Simple moving average or direct overwrite depending on sensor type
        if (reading.type === 'occupancy') {
            room.aggregateSensors.occupancy = reading.value;
        } else {
            // Weighted average for environmental sensors
            const current = room.aggregateSensors[reading.type];
            room.aggregateSensors[reading.type] = (current * 0.8) + (reading.value * 0.2);
        }

        this.touch();
    }

    public getStateSnapshot(): any {
        // Convert Maps to plain objects for JSON serialization
        const roomsObj: any = {};
        this.state.rooms.forEach((room, rId) => {
            const desksObj: any = {};
            room.desks.forEach((desk, dId) => {
                desksObj[dId] = { ...desk };
            });
            roomsObj[rId] = {
                ...room,
                desks: desksObj
            };
        });

        return {
            ...this.state,
            rooms: roomsObj
        };
    }

    private recalculateVenueOccupancy(): void {
        let total = 0;
        this.state.rooms.forEach(room => {
            total += room.currentOccupancy;
        });
        this.state.totalOccupancy = total;
    }

    private touch(): void {
        this.state.lastUpdated = Date.now();
    }
}
