import { SpatialAudioRouter } from "./SpatialAudioRouter";

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export interface SpatialListenerUpdate {
  type: "spatial_listener_update";
  userId: string;
  position: Vector3D;
  forward: Vector3D;
  up: Vector3D;
  timestamp: number;
}

export class RemoteListenerInterpolator {
  private history = new Map<string, SpatialListenerUpdate[]>();
  private readonly maxHistory: number;
  private handleResizeBound: () => void;

  constructor(maxHistory = 4) {
    this.maxHistory = maxHistory;
    this.handleResizeBound = this.handleResize.bind(this);
    if (typeof window !== "undefined") {
      window.addEventListener("resize", this.handleResizeBound);
    }
  }

  /**
   * Store update sample in history and apply directly to SpatialAudioRouter.
   */
  applyUpdate(update: SpatialListenerUpdate, router: SpatialAudioRouter): void {
    const list = this.history.get(update.userId) ?? [];
    list.push(update);
    if (list.length > this.maxHistory) {
      list.shift();
    }
    this.history.set(update.userId, list);

    router.updatePeerPosition(
      update.userId,
      update.position.x,
      update.position.y,
      update.position.z,
    );

    router.updatePeerOrientation(
      update.userId,
      update.forward.x,
      update.forward.y,
      update.forward.z,
    );
  }

  /**
   * Interpolates position vector between history samples at target timestamp.
   */
  interpolate(
    userId: string,
    atTime: number,
  ): { position: Vector3D; forward: Vector3D } | null {
    const list = this.history.get(userId);
    if (!list || list.length === 0) return null;

    if (list.length === 1) {
      return { position: list[0].position, forward: list[0].forward };
    }

    let before = list[0];
    let after = list[list.length - 1];

    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].timestamp <= atTime && list[i + 1].timestamp >= atTime) {
        before = list[i];
        after = list[i + 1];
        break;
      }
    }

    const duration = after.timestamp - before.timestamp;
    const t =
      duration > 0
        ? Math.max(0, Math.min(1, (atTime - before.timestamp) / duration))
        : 0;

    return {
      position: {
        x: before.position.x + t * (after.position.x - before.position.x),
        y: before.position.y + t * (after.position.y - before.position.y),
        z: before.position.z + t * (after.position.z - before.position.z),
      },
      forward: {
        x: before.forward.x + t * (after.forward.x - before.forward.x),
        y: before.forward.y + t * (after.forward.y - before.forward.y),
        z: before.forward.z + t * (after.forward.z - before.forward.z),
      },
    };
  }

  clearUser(userId: string): void {
    this.history.delete(userId);
  }

  clearAll(): void {
    this.history.clear();
  }

  getHistory(userId: string): SpatialListenerUpdate[] | undefined {
    return this.history.get(userId);
  }

  private handleResize(): void {
    // Window resized, recalibrating spatial listener coordinates if needed
  }

  dispose(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", this.handleResizeBound);
    }
  }
}
