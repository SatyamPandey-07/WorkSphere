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
import { AbrController } from "./abrController";
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

  const controller = new AbrController(pc, sender, options);
  controller.start();

  return { sender, controller };
}

import * as Y from "yjs";
import { CrdtDeltaSyncSession } from "@/lib/crdt/canvasProvider";

export interface CrdtDataChannelBinding {
  session: CrdtDeltaSyncSession;
  detach: () => void;
}

export function attachCrdtDeltaSyncChannel(
  channel: RTCDataChannel,
  doc: Y.Doc,
  peerId: string,
  options?: { maxChunkPayloadSize?: number },
): CrdtDataChannelBinding {
  channel.binaryType = "arraybuffer";

  const session = new CrdtDeltaSyncSession({
    doc,
    peerId,
    maxChunkPayloadSize: options?.maxChunkPayloadSize,
    sendFrame: (frame) => {
      if (channel.readyState === "open") {
        const buffer = frame.buffer.slice(
          frame.byteOffset,
          frame.byteOffset + frame.byteLength,
        ) as ArrayBuffer;
        channel.send(buffer);
      }
    },
  });

  const handleMessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      session.receiveFrame(new Uint8Array(event.data));
    } else if (ArrayBuffer.isView(event.data)) {
      session.receiveFrame(
        new Uint8Array(
          event.data.buffer,
          event.data.byteOffset,
          event.data.byteLength,
        ),
      );
    }
  };

  const handleOpen = () => {
    session.initiateStateVectorHandshake();
  };

  const handleLocalDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === "crdt-delta-sync-remote") return;
    if (channel.readyState === "open") {
      session.broadcastLocalDelta(update);
    }
  };

  channel.addEventListener("message", handleMessage);
  channel.addEventListener("open", handleOpen);
  doc.on("update", handleLocalDocUpdate);

  if (channel.readyState === "open") {
    session.initiateStateVectorHandshake();
  }

  return {
    session,
    detach: () => {
      channel.removeEventListener("message", handleMessage);
      channel.removeEventListener("open", handleOpen);
      doc.off("update", handleLocalDocUpdate);
    },
  };
}
