import WorkspaceServer, {
  type PresenceUser,
  FOLDER_NOTES_ROOM_PREFIX,
  folderIdFromRoom,
  type MusicGenre,
  type ReplayableSessionEvent,
  type SeatHold,
  DEFAULT_SEAT_HOLD_TTL_MS,
} from "./server";

export type { PresenceUser, MusicGenre, ReplayableSessionEvent, SeatHold };
export {
  FOLDER_NOTES_ROOM_PREFIX,
  folderIdFromRoom,
  DEFAULT_SEAT_HOLD_TTL_MS,
  WorkspaceServer,
};
export default WorkspaceServer;
