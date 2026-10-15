/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { VenueTwinStateTree, SensorReading } from '../core/digitaltwin/VenueTwinStateTree';
import { PhysicsSimulationEngine } from '../core/digitaltwin/PhysicsSimulationEngine';

interface WorkerMessage {
  type: 'INIT_VENUE' | 'INGEST_TELEMETRY' | 'TICK_SIMULATION';
  payload: any;
}

interface WorkerResponse {
  type: 'STATE_UPDATE' | 'BOTTLENECK_ALERT' | 'ERROR';
  payload: any;
}

let twinTree: VenueTwinStateTree | null = null;
let physicsEngine: PhysicsSimulationEngine | null = null;
let simulationInterval: number | null = null;

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'INIT_VENUE':
        handleInit(payload);
        break;
      case 'INGEST_TELEMETRY':
        handleTelemetry(payload);
        break;
      case 'TICK_SIMULATION':
        handleTick();
        break;
    }
  } catch (error: any) {
    self.postMessage({ type: 'ERROR', payload: { message: error.message } } as WorkerResponse);
  }
};

function handleInit(payload: { venueId: string; rooms: any[] }): void {
  twinTree = new VenueTwinStateTree(payload.venueId);
  physicsEngine = new PhysicsSimulationEngine();

  payload.rooms.forEach((room: any) => {
    twinTree!.addRoom(room.id, room.capacity);
    room.desks.forEach((desk: any) => {
      twinTree!.addDesk(room.id, desk.id);
    });
  });

  // Start simulation loop at 10Hz
  if (simulationInterval) clearInterval(simulationInterval);
  simulationInterval = self.setInterval(() => {
    self.postMessage({ type: 'TICK_SIMULATION' } as WorkerMessage);
  }, 100) as unknown as number;

  broadcastState();
}

function handleTelemetry(payload: { roomId: string; readings: SensorReading[] }): void {
  if (!twinTree) return;
  
  payload.readings.forEach(reading => {
    twinTree!.ingestSensorReading(payload.roomId, reading);
  });
  
  broadcastState();
}

function handleTick(): void {
  if (!physicsEngine) return;
  
  // Step physics simulation forward by 0.1 seconds
  physicsEngine.step(0.1);
  
  const bottlenecks = physicsEngine.detectBottlenecks();
  if (bottlenecks.length > 0) {
    self.postMessage({
      type: 'BOTTLENECK_ALERT',
      payload: bottlenecks
    } as WorkerResponse);
  }
}

function broadcastState(): void {
  if (!twinTree) return;
  
  self.postMessage({
    type: 'STATE_UPDATE',
    payload: twinTree.getStateSnapshot()
  } as WorkerResponse);
}
