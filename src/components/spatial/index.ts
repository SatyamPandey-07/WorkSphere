export { BeaconSignalBars } from "./BeaconSignalBars";
export type { BeaconSignalBarsProps } from "./BeaconSignalBars";

export { VenueBeaconDiagnosticDrawer } from "./VenueBeaconDiagnosticDrawer";
export type { VenueBeaconDiagnosticDrawerProps } from "./VenueBeaconDiagnosticDrawer";

export { IndoorPositioningMap } from "./IndoorPositioningMap";

export { ProximityBoundaryZone } from "./ProximityBoundaryZone";
export type { ProximityBoundaryZoneProps } from "./ProximityBoundaryZone";


export {
  SpatialAudioStage,
  stageToAudioCoordinates,
  updatePannerCoordinates,
  updateListenerCoordinates,
} from "./SpatialAudioStage";
export type {
  SpatialAudioStageProps,
  PeerAvatar,
  LocalUserAvatar,
  StagePosition,
} from "./SpatialAudioStage";

export {
  calculateProximityFadeGain,
  getProximityZoneTier,
  sanitizeProximityZoneConfig,
  calculate3DDistance,
  DEFAULT_PROXIMITY_ZONE_CONFIG,
  PROXIMITY_ZONE_PRESETS,
} from "@/core/audio/ProximityBoundaryZone";
export type {
  ProximityBoundaryZoneConfig,
  FadeOutCurve,
  ProximityZoneTier,
  ProximityZonePresetId,
} from "@/core/audio/ProximityBoundaryZone";

