import { globalSyncEngine } from "./syncEngine";
import { reviewSyncPlugin } from "./plugins/reviewSyncPlugin";
import { notesSyncPlugin } from "./plugins/notesSyncPlugin";
import { tagsSyncPlugin } from "./plugins/tagsSyncPlugin";

globalSyncEngine
  .registerPlugin(reviewSyncPlugin)
  .registerPlugin(notesSyncPlugin)
  .registerPlugin(tagsSyncPlugin);

export * from "./syncEngine";
export * from "./plugins/reviewSyncPlugin";
export * from "./plugins/notesSyncPlugin";
export * from "./plugins/tagsSyncPlugin";
