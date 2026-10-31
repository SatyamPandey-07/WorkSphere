export { DeskPostureAnalytics } from "./DeskPostureAnalytics";
export type {
  DeskPostureAnalyticsProps,
  DeskStationType,
  PostureState,
} from "./DeskPostureAnalytics";

export {
  default as SitStandRatioAnalytics,
  SitStandRatioAnalytics,
  type SitStandRatioAnalyticsProps,
} from "./SitStandRatioAnalytics";
export { default as DynamicErgonomicCoach } from "./DynamicErgonomicCoach";
export {
  default as FuelReserveGauge,
  FuelReserveGauge,
  calculateFuelEndurance,
  BINGO_FUEL_THRESHOLD,
  MAX_JP8_CAPACITY_LBS,
  BASE_BURN_RATE_LBS_PER_HOUR,
  type FuelReserveGaugeProps,
  type FuelEnduranceInputs,
  type FuelCalculationResult,
} from "./FuelReserveGauge";
export { default as WillpowerFocusGauge } from "./WillpowerFocusGauge";
