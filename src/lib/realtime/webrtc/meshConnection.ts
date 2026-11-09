/**
 * WebRTC Mesh Connection Simulcast & Adapter Module.
 *
 * Integrates simulcast configuration and RTCP stats adaptive degradation
 * with RTCPeerConnection mesh instances.
 */

import {
  configureSimulcastSender,
  createSimulcastEncodings,
  SimulcastAdaptiveController,
  SIMULCAST_BITRATE_LADDER,
  setHighLayerActive,
  extractRTCPStats,
  evaluateNetworkCondition,
  computeScaleResolutionDownBy,
} from "./simulcastController";
import {
  Resolution,
  NetworkStats,
  SimulcastAdaptationState,
  SimulcastLayerConfig,
  SimulcastControllerOptions,
} from "./types";

export {
  configureSimulcastSender,
  createSimulcastEncodings,
  SimulcastAdaptiveController,
  SIMULCAST_BITRATE_LADDER,
  setHighLayerActive,
  extractRTCPStats,
  evaluateNetworkCondition,
  computeScaleResolutionDownBy,
};

export type {
  Resolution,
  NetworkStats,
  SimulcastAdaptationState,
  SimulcastLayerConfig,
  SimulcastControllerOptions,
};

/**
 * Attaches a local video track to an RTCPeerConnection with simulcast encodings,
 * configuring RTCRtpSender and returning an active SimulcastAdaptiveController.
 */
export async function attachSimulcastVideoTrack(
  pc: RTCPeerConnection,
  track: MediaStreamTrack,
  stream: MediaStream,
  options?: SimulcastControllerOptions,
): Promise<{
  sender: RTCRtpSender;
  controller: SimulcastAdaptiveController;
}> {
  let sender: RTCRtpSender | undefined;

  // If pc supports addTransceiver with encodings, use it directly
  if (typeof pc.addTransceiver === "function") {
    try {
      const encodings = createSimulcastEncodings();
      const transceiver = pc.addTransceiver(track, {
        direction: "sendrecv",
        streams: [stream],
        sendEncodings: encodings,
      });
      sender = transceiver.sender;
    } catch {
      // Fall back to addTrack if transceiver creation fails
    }
  }

  if (!sender) {
    sender = pc.addTrack(track, stream);
  }

  // Ensure 3-tier simulcast ladder is set on sender
  if (sender) {
    await configureSimulcastSender(sender);
  } else {
    // Look up sender from peer connection if addTrack returned void
    const videoSender = pc
      .getSenders()
      .find((s) => s.track === track || s.track?.kind === "video");
    if (videoSender) {
      sender = videoSender;
      await configureSimulcastSender(sender);
    }
  }

  if (!sender) {
    throw new Error("Failed to obtain RTCRtpSender for video track");
  }

  const controller = new SimulcastAdaptiveController(pc, sender, options);
  controller.start();

  return { sender, controller };
}
