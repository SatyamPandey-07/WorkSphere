/**
 * Bandwidth-aware adaptive bitrate controller for collaborative war-room video.
 */

export {
  applyBandwidthDegradation,
  extractRTCPStats,
  evaluateNetworkCondition,
} from "./simulcastController";
import { SimulcastAdaptiveController } from "./simulcastController";

/** ABR facade used by collaborative war-room video senders. */
export class AbrController extends SimulcastAdaptiveController {}

export const ABR_PACKET_LOSS_THRESHOLD = 0.05;
export const ABR_RECOVERY_OBSERVATION_MS = 15_000;
