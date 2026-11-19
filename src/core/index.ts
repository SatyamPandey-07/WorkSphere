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
export * from './iot';
export * from './culture/SoulboundSkillAttestor';
export * from './audio';
export * from './security/HomomorphicAuditAggregator';
export * from './ai/EdgeIntentClassifier';
export * from './ai/SpeculativeTokenCache';
export * from './ai/HNSWVectorStore';
export * from './ai/FederatedModelAggregator';
export * from './batching/AdaptiveRequestBatcher';
export * from './sync/CausalVectorClockEngine';
export * from './finance';
export * from './gamification/VerifiableLeaderboard';
export * from './sensors';
export * from './itinerary/TransitOptimizer';
export * from './ocr/ReceiptLineItemExtractor';
export * from './chat/DoubleRatchetSession';
export * from './chat/SkippedMessageKeyStore';
export * from './predictive/OccupancyForecaster';
export * from './compliance/DataResidencyGuard';
export * from './dtn';
export * from './webgl/VolumetricLightingShader';
export * from './ergonomics/ErgonomicStrainAnalyzer';
export * from './routing/AnycastLatencyOptimizer';
export * from './pricing/SpotPricingAuctioneer';
export * from './pdf/PDFSignerEngine';
export * from './legal/EscrowClauseValidator';
export * from './auctions';
export * from './matchmaking/TeamMatchmaker';
export * from './inventory/AssetGeofenceLedger';
export * from './health/CircadianLightingController';
export * from './solana';
export * from './trust/P2PLuggageEscrow';
export * from './spatial/LiDARDeskScanner';
export * from './spatial/GaussianVoxelEngine';
export * from './spatial/PlaneMeshExtractor';
export * from './gpu/MeshDecimatorCompute';
export * from './agents/ActionItemSynthesizer';
export * from './agents/AgentTaskPlanner';
export * from './sustainability/EmbodiedCarbonEstimator';
export * from './accessibility/WCAGContrastAuditor';
export * from './queue/FairShareScheduler';
export * from './network/SocketTelemetryCollector';
export * from './consensus';
export * from './zkp';
export * from './p2p';
export * from './crypto';
export * from './crdt';
export * from './webrtc';
export * from './wasm';
export * from './partykit';
export * from './biometrics';
