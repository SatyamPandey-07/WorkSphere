import { describe, it, expect, beforeEach } from 'vitest';
import {
  PartyKitPresenceLeaser,
  LeaseState,
  UserPresenceStatus,
  DeltaEventType,
} from '../../core/partykit/PartyKitPresenceLeaser';

describe('PartyKitPresenceLeaser - Real-Time Presence & CAS Seat Leasing', () => {
  let leaser: PartyKitPresenceLeaser;
  const ROOM_ID = 'room_tokyo_floor_4';
  const BASE_TIME = 1700000000000;

  beforeEach(() => {
    leaser = new PartyKitPresenceLeaser(ROOM_ID, {
      defaultLeaseTtlMs: 10 * 60 * 1000, // 10 min
      heartbeatTimeoutMs: 30 * 1000, // 30 sec
      holdTtlMs: 60 * 1000, // 60 sec
      maxRoomCapacity: 3,
    });

    leaser.registerSeat('desk_A1');
    leaser.registerSeat('desk_A2');
    leaser.registerSeat('desk_B1');
  });

  describe('Room Presence Management', () => {
    it('records user join and emits ordered delta event', () => {
      const event = leaser.joinRoom({
        userId: 'user_alice',
        userName: 'Alice Nomad',
        connectionId: 'conn_ws_001',
        timestamp: BASE_TIME,
      });

      expect(event.sequenceId).toBe(1);
      expect(event.eventType).toBe(DeltaEventType.PRESENCE_JOIN);
      expect(event.payload.userId).toBe('user_alice');

      const snapshot = leaser.getSnapshot();
      expect(snapshot.users).toHaveLength(1);
      expect(snapshot.users[0].status).toBe(UserPresenceStatus.ACTIVE);
    });

    it('enforces maximum room capacity limits', () => {
      leaser.joinRoom({ userId: 'u1', userName: 'User 1', connectionId: 'c1', timestamp: BASE_TIME });
      leaser.joinRoom({ userId: 'u2', userName: 'User 2', connectionId: 'c2', timestamp: BASE_TIME });
      leaser.joinRoom({ userId: 'u3', userName: 'User 3', connectionId: 'c3', timestamp: BASE_TIME });

      expect(() =>
        leaser.joinRoom({ userId: 'u4', userName: 'User 4', connectionId: 'c4', timestamp: BASE_TIME })
      ).toThrowError(/maximum capacity/i);
    });

    it('handles user departure and releases active seat lease', () => {
      leaser.joinRoom({ userId: 'user_bob', userName: 'Bob', connectionId: 'c_bob', timestamp: BASE_TIME });
      leaser.acquireSeat('desk_A1', 'user_bob', undefined, undefined, BASE_TIME);

      const leaveEvent = leaser.leaveRoom('user_bob', BASE_TIME + 5000);
      expect(leaveEvent).not.toBeNull();
      expect(leaveEvent!.eventType).toBe(DeltaEventType.PRESENCE_LEAVE);

      const snapshot = leaser.getSnapshot();
      expect(snapshot.users).toHaveLength(0);

      const seat = snapshot.seats.find((s) => s.seatId === 'desk_A1')!;
      expect(seat.state).toBe(LeaseState.AVAILABLE);
      expect(seat.tenantId).toBeUndefined();
    });
  });

  describe('Seat Hold & CAS Lease Locking', () => {
    it('holds seat temporarily and prevents concurrent user acquisition', () => {
      leaser.joinRoom({ userId: 'user_alice', userName: 'Alice', connectionId: 'c_a', timestamp: BASE_TIME });
      leaser.joinRoom({ userId: 'user_charlie', userName: 'Charlie', connectionId: 'c_c', timestamp: BASE_TIME });

      const hold = leaser.holdSeat('desk_A1', 'user_alice', 60000, BASE_TIME);
      expect(hold.success).toBe(true);
      expect(hold.lease?.state).toBe(LeaseState.HELD);
      expect(hold.lease?.tenantId).toBe('user_alice');

      // Charlie attempts to acquire held desk
      const failedAcquire = leaser.acquireSeat('desk_A1', 'user_charlie', undefined, undefined, BASE_TIME + 1000);
      expect(failedAcquire.success).toBe(false);
      expect(failedAcquire.error).toMatch(/already occupied|another tenant/i);
    });

    it('allows atomic acquisition with CAS expected version match and rejects stale version', () => {
      leaser.joinRoom({ userId: 'user_alice', userName: 'Alice', connectionId: 'c_a', timestamp: BASE_TIME });

      const snapshot1 = leaser.getSnapshot();
      const seat = snapshot1.seats.find((s) => s.seatId === 'desk_A1')!;
      expect(seat.version).toBe(1);

      // CAS mismatch test
      const badCas = leaser.acquireSeat('desk_A1', 'user_alice', 99, undefined, BASE_TIME);
      expect(badCas.success).toBe(false);
      expect(badCas.error).toMatch(/CAS Version Mismatch/i);

      // Valid CAS acquisition
      const goodCas = leaser.acquireSeat('desk_A1', 'user_alice', 1, undefined, BASE_TIME);
      expect(goodCas.success).toBe(true);
      expect(goodCas.lease?.version).toBe(2);
      expect(goodCas.lease?.state).toBe(LeaseState.LEASED);
    });

    it('automatically releases previous seat when user acquires a different seat', () => {
      leaser.joinRoom({ userId: 'user_alice', userName: 'Alice', connectionId: 'c_a', timestamp: BASE_TIME });

      leaser.acquireSeat('desk_A1', 'user_alice', undefined, undefined, BASE_TIME);
      expect(leaser.getSnapshot().seats.find((s) => s.seatId === 'desk_A1')!.state).toBe(LeaseState.LEASED);

      // Alice moves to desk_A2
      leaser.acquireSeat('desk_A2', 'user_alice', undefined, undefined, BASE_TIME + 2000);

      const seats = leaser.getSnapshot().seats;
      const oldSeat = seats.find((s) => s.seatId === 'desk_A1')!;
      const newSeat = seats.find((s) => s.seatId === 'desk_A2')!;

      expect(oldSeat.state).toBe(LeaseState.AVAILABLE);
      expect(oldSeat.tenantId).toBeUndefined();
      expect(newSeat.state).toBe(LeaseState.LEASED);
      expect(newSeat.tenantId).toBe('user_alice');
    });
  });

  describe('Heartbeat & Ephemeral Eviction', () => {
    it('renews lease on heartbeat', () => {
      leaser.joinRoom({ userId: 'user_alice', userName: 'Alice', connectionId: 'c_a', timestamp: BASE_TIME });
      leaser.acquireSeat('desk_A1', 'user_alice', undefined, 600000, BASE_TIME);

      const hb = leaser.heartbeat('user_alice', BASE_TIME + 15000);
      expect(hb.success).toBe(true);
      expect(hb.refreshedSeatId).toBe('desk_A1');
    });

    it('sweeps expired seats and inactive users after timeout threshold', () => {
      leaser.joinRoom({ userId: 'user_alice', userName: 'Alice', connectionId: 'c_a', timestamp: BASE_TIME });
      leaser.acquireSeat('desk_A1', 'user_alice', undefined, 10000, BASE_TIME); // 10s TTL

      // Advance clock past 10s TTL but before 30s heartbeat timeout
      const sweep1 = leaser.sweepStaleLeasesAndPresence(BASE_TIME + 12000);
      expect(sweep1.expiredSeats).toContain('desk_A1');
      expect(sweep1.evictedUsers).toHaveLength(0);

      const seatAfterSweep = leaser.getSnapshot().seats.find((s) => s.seatId === 'desk_A1')!;
      expect(seatAfterSweep.state).toBe(LeaseState.AVAILABLE);

      // Advance clock past 30s heartbeat timeout
      const sweep2 = leaser.sweepStaleLeasesAndPresence(BASE_TIME + 35000);
      expect(sweep2.evictedUsers).toContain('user_alice');
      expect(leaser.getSnapshot().users).toHaveLength(0);
    });
  });

  describe('Delta Rehydration & Gapless Sync', () => {
    it('returns delta events strictly after given sequence id', () => {
      leaser.joinRoom({ userId: 'u1', userName: 'User 1', connectionId: 'c1', timestamp: BASE_TIME }); // seq 1
      leaser.acquireSeat('desk_A1', 'u1', undefined, undefined, BASE_TIME); // seq 2
      leaser.releaseSeat('desk_A1', 'u1', BASE_TIME + 1000); // seq 3

      const deltas = leaser.getDeltasSince(1);
      expect(deltas).toHaveLength(2);
      expect(deltas[0].sequenceId).toBe(2);
      expect(deltas[0].eventType).toBe(DeltaEventType.SEAT_ACQUIRED);
      expect(deltas[1].sequenceId).toBe(3);
      expect(deltas[1].eventType).toBe(DeltaEventType.SEAT_RELEASED);
    });
  });
});
