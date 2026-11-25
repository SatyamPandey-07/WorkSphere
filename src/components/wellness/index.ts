export { DeskPostureAnalytics } from "./DeskPostureAnalytics";
export type {
  DeskPostureAnalyticsProps,
  DeskStationType,
  PostureState,
} from "./DeskPostureAnalytics";

export {
  default as SitStandRatioAnalytics,
  type SitStandRatioAnalyticsProps,
} from "./SitStandRatioAnalytics";
export { default as DynamicErgonomicCoach } from "./DynamicErgonomicCoach";
export {
  default as FuelReserveGauge,
  calculateFuelEndurance,
  BINGO_FUEL_THRESHOLD,
  MAX_JP8_CAPACITY_LBS,
  BASE_BURN_RATE_LBS_PER_HOUR,
  type FuelReserveGaugeProps,
  type FuelEnduranceInputs,
  type FuelCalculationResult,
} from "./FuelReserveGauge";
export { default as WillpowerFocusGauge } from "./WillpowerFocusGauge";
export {
  default as CircadianLightingCard,
  getScheduleKelvin,
  kelvinToRgb,
  MIN_KELVIN,
  MAX_KELVIN,
  OVERRIDE_DURATION_MS,
  OVERRIDE_STORAGE_KEY,
  type CircadianLightingCardProps,
  type CircadianOverride,
  type CircadianOverrideReason,
} from "./CircadianLightingCard";
export {
  default as CircadianSliderControl,
  type CircadianSliderControlProps,
} from "./CircadianSliderControl";
export {
  default as AmbientSoundscapeGenerator,
  type AmbientSoundscapeGeneratorProps,
  type AmbientPreferences,
  AMBIENT_STORAGE_KEY,
} from "./AmbientSoundscapeGenerator";
