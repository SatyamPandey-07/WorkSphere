/**
 * peripheralEngine.ts
 * Core domain types and business logic for Peer-to-Peer & Venue Hardware Lending Lockers.
 * Manages item availability, micro-deposits, locker bay allocation, and secure PIN generation.
 */

import crypto from "crypto";

export type PeripheralCategory =
  "CHARGER" | "MONITOR" | "KEYBOARD" | "MOUSE" | "HEADSET" | "ADAPTER";

export interface PeripheralItem {
  id: string;
  venueId: string;
  name: string;
  category: PeripheralCategory;
  description: string;
  brand: string;
  lockerBayNumber: number;
  condition: "EXCELLENT" | "GOOD" | "FAIR";
  hourlyRateUsd: number;
  depositUsd: number;
  isAvailable: boolean;
  currentRentalId?: string | null;
  specifications: string[];
  imageUrl?: string;
  /** Current charge (0-100) for wireless devices; omit for wired items. */
  batteryPercent?: number | null;
}

export interface PeripheralRental {
  rentalId: string;
  itemId: string;
  userId: string;
  venueId: string;
  lockerBayNumber: number;
  unlockPin: string;
  depositAmount: number;
  hourlyRate: number;
  startTime: string;
  endTime?: string | null;
  totalCostUsd?: number | null;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
}

// In-memory atomic lock registry for concurrent checkout prevention
class PeripheralLockManager {
  private activeLocks = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  private activeRentals = new Map<string, PeripheralRental>(); // keyed by itemId

  /**
   * Attempts to atomically acquire a checkout lock for a peripheral item.
   * Prevents race conditions and concurrent double-checkouts.
   */
  public tryAcquireLock(
    itemId: string,
    userId: string,
    ttlMs: number = 45000,
  ): boolean {
    const now = Date.now();
    const existingLock = this.activeLocks.get(itemId);

    // Clean up expired lock if present
    if (existingLock && existingLock.expiresAt < now) {
      this.activeLocks.delete(itemId);
    }

    // Check if item is already actively rented
    const activeRental = this.activeRentals.get(itemId);
    if (activeRental && activeRental.status === "ACTIVE") {
      return false;
    }

    // Check if currently locked by another concurrent checkout attempt
    if (this.activeLocks.has(itemId)) {
      const current = this.activeLocks.get(itemId)!;
      if (current.userId !== userId) {
        return false;
      }
    }

    this.activeLocks.set(itemId, {
      userId,
      expiresAt: now + ttlMs,
    });
    return true;
  }

  /**
   * Releases an acquired checkout lock.
   */
  public releaseLock(itemId: string): void {
    this.activeLocks.delete(itemId);
  }

  /**
   * Registers an active rental and binds the item.
   */
  public registerRental(rental: PeripheralRental): void {
    this.activeRentals.set(rental.itemId, rental);
    this.activeLocks.delete(rental.itemId);
  }

  /**
   * Marks a rental as completed and frees the peripheral for future checkouts.
   */
  public completeRental(rentalId: string): PeripheralRental | null {
    for (const [itemId, rental] of this.activeRentals.entries()) {
      if (rental.rentalId === rentalId) {
        this.activeRentals.delete(itemId);
        this.activeLocks.delete(itemId);
        return { ...rental, status: "COMPLETED" };
      }
    }
    return null;
  }

  /**
   * Checks if an item is currently rented or locked.
   */
  public isItemRentedOrLocked(itemId: string): boolean {
    const now = Date.now();
    const existingLock = this.activeLocks.get(itemId);
    if (existingLock && existingLock.expiresAt >= now) {
      return true;
    }
    const activeRental = this.activeRentals.get(itemId);
    return !!activeRental && activeRental.status === "ACTIVE";
  }
}

export const peripheralLockManager = new PeripheralLockManager();

/**
 * Generates a secure, deterministic 4-digit unlock PIN for a locker bay.
 */
export function generateLockerPin(itemId: string, userId: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${itemId}:${userId}:${Date.now().toString().slice(0, 8)}`)
    .digest("hex");
  const num = parseInt(hash.slice(0, 4), 16) % 10000;
  return num.toString().padStart(4, "0");
}

/**
 * Calculates rental fees and final balance upon item return.
 */
export function calculateRentalCompletion(
  rental: PeripheralRental,
  returnTime = new Date(),
): { durationHours: number; rentalCost: number; refundedDeposit: number } {
  const start = new Date(rental.startTime);
  const elapsedMs = Math.max(0, returnTime.getTime() - start.getTime());
  const durationHours = Math.max(1, Math.ceil(elapsedMs / (1000 * 60 * 60))); // billed per hour minimum 1hr

  const rentalCost = Number((durationHours * rental.hourlyRate).toFixed(2));
  const refundedDeposit = Math.max(
    0,
    Number((rental.depositAmount - rentalCost).toFixed(2)),
  );

  return {
    durationHours,
    rentalCost,
    refundedDeposit,
  };
}
