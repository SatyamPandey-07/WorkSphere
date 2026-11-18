/**
 * @file IAQVentilationController.ts
 * @description Proactive coworking room ventilation controller synchronized with booking calendar reservations.
 */

export interface BookingReservation {
  id: string;
  roomId: string;
  startTime: number; // Unix timestamp in ms
  headcount: number;
  roomVolumeM3: number;
}

export interface HVACCommand {
  roomId: string;
  action: "PURGE_START" | "SETTLE_BASELINE";
  targetCFMOrFlow: number;
  scheduledTime: number;
}

export class IAQVentilationController {
  private activePurges: Set<string> = new Set();

  /**
   * Evaluates upcoming bookings and schedules pre-purging 45 minutes prior.
   * Ramps up ventilation 30 minutes before start time to achieve complete air changes.
   */
  public evaluateBookings(
    currentTimestamp: number,
    bookings: BookingReservation[],
  ): HVACCommand[] {
    const commands: HVACCommand[] = [];
    const PRE_PURGE_WINDOW_MS = 45 * 60 * 1000; // 45 minutes prior
    const RAMP_UP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes prior

    for (const booking of bookings) {
      const timeToStart = booking.startTime - currentTimestamp;

      // Trigger pre-purge window (between 45m and 30m before)
      if (
        timeToStart <= PRE_PURGE_WINDOW_MS &&
        timeToStart > RAMP_UP_WINDOW_MS
      ) {
        if (!this.activePurges.has(booking.id)) {
          this.activePurges.add(booking.id);
          const requiredVolume = this.calculateAirExchangeVolume(
            booking.roomVolumeM3,
            booking.headcount,
            2,
          );

          commands.push({
            roomId: booking.roomId,
            action: "PURGE_START",
            targetCFMOrFlow: requiredVolume,
            scheduledTime: currentTimestamp,
          });
        }
      }
      // Settle to baseline once session begins or window passes
      else if (timeToStart <= 0 && this.activePurges.has(booking.id)) {
        this.activePurges.delete(booking.id);
        commands.push({
          roomId: booking.roomId,
          action: "SETTLE_BASELINE",
          targetCFMOrFlow: 0,
          scheduledTime: currentTimestamp,
        });
      }
    }

    return commands;
  }

  /**
   * Calculates the required air exchange volume to achieve target complete air changes.
   */
  public calculateAirExchangeVolume(
    roomVolumeM3: number,
    headcount: number,
    targetAirChanges: number = 2,
  ): number {
    const headcountFactor = Math.max(1, headcount * 0.15);
    const totalVolume = roomVolumeM3 * targetAirChanges * headcountFactor;
    return Number(totalVolume.toFixed(2));
  }
}
