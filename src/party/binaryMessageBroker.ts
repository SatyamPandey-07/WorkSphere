import * as protobuf from "protobufjs";

const protoDefinition = `
syntax = "proto3";
package worksphere.telemetry;

enum EventType {
  UNKNOWN = 0;
  TELEMETRY = 1;
  PRESENCE = 2;
  CHAT = 3;
}

message TelemetryEvent {
  string venue_id = 1;
  string device_id = 2;
  string reading_type = 3;
  double value = 4;
  int64 timestamp = 5;
}

message PresenceEvent {
  string user_id = 1;
  string venue_id = 2;
  string status = 3;
  int64 last_active = 4;
}

message ChatEvent {
  string message_id = 1;
  string conversation_id = 2;
  string sender_id = 3;
  string content = 4;
  int64 timestamp = 5;
}

message WorkSphereEnvelope {
  EventType type = 1;
  int64 sequence_id = 2;
  oneof payload {
    TelemetryEvent telemetry = 3;
    PresenceEvent presence = 4;
    ChatEvent chat = 5;
  }
}
`;

const root = protobuf.parse(protoDefinition).root;
const WorkSphereEnvelope = root.lookupType("worksphere.telemetry.WorkSphereEnvelope");

export interface RawEnvelope {
  type: "TELEMETRY" | "PRESENCE" | "CHAT";
  sequenceId: number;
  payload: Record<string, any>;
}

export function encodeBinaryMessage(data: RawEnvelope): Uint8Array {
  const typeMap: Record<string, number> = {
    TELEMETRY: 1,
    PRESENCE: 2,
    CHAT: 3,
  };

  const payloadKeyMap: Record<string, string> = {
    TELEMETRY: "telemetry",
    PRESENCE: "presence",
    CHAT: "chat",
  };

  const messageObject = {
    type: typeMap[data.type] || 0,
    sequenceId: data.sequenceId,
    [payloadKeyMap[data.type]]: data.payload,
  };

  const errMsg = WorkSphereEnvelope.verify(messageObject);
  if (errMsg) throw new Error(`Protobuf verification failed: ${errMsg}`);

  const message = WorkSphereEnvelope.create(messageObject);
  return WorkSphereEnvelope.encode(message).finish();
}

export function decodeIncomingMessage(data: ArrayBuffer | Uint8Array | string): RawEnvelope {
  if (typeof data === "string") {
    return JSON.parse(data);
  }

  const uint8Array = data instanceof Uint8Array ? data : new Uint8Array(data);
  const decoded = WorkSphereEnvelope.decode(uint8Array) as any;

  const eventTypeNames: Record<number, "TELEMETRY" | "PRESENCE" | "CHAT"> = {
    1: "TELEMETRY",
    2: "PRESENCE",
    3: "CHAT",
  };

  const typeName = eventTypeNames[decoded.type];
  const payloadData = decoded.telemetry || decoded.presence || decoded.chat || {};

  return {
    type: typeName,
    sequenceId: Number(decoded.sequenceId),
    payload: payloadData,
  };
}