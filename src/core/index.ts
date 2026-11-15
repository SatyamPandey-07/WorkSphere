/**
 * @file Core barrel export file for WorkSphere business logic.
 * @description Centralizes exports for core domain modules.
 *
 * Only modules that actually exist are re-exported here. Previously this file
 * re-exported nine non-existent modules (./agents, ./spatial/SpatialEngine,
 * ./audio/AudioProcessor, ...) and ./ergonomics/ISOValidator, which is a
 * worker script rather than a module, so importing the barrel failed.
 */

export * from './health/JetlagRecoveryEngine';
export * from './health/SolarExposureTracker';
export * from './nutrition/AllergenMatcher';
export * from './iot/LuggageLockerProtocol';
export * from './trust/P2PLuggageEscrow';
export * from './spatial/LiDARDeskScanner';
