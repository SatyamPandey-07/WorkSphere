import { UIMessage } from "ai";

export interface MyUIMessage extends UIMessage {
  type?:
    | "data-Orchestrator"
    | "data-Context"
    | "data-Data"
    | "data-Reasoning"
    | "data-Action";
  data?: any;
}

export interface WorkSpaceQuery {
  workType?: "focus" | "calls" | "collaboration" | "casual";
  amenities?: string[]; // wifi, outlets, quiet, etc
  location?: { lat: number; lng: number };
  radius?: number;
  timeOfDay?: string;
}
