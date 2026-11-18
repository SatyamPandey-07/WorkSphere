import VenueRoom, { type SeatCheckin } from '../venueRoom';
import type * as Party from 'partykit/server';

describe('VenueRoom PartyKit Server (#7168)', () => {
  let mockRoom: Party.Room;
  let mockConn: Party.Connection;
  let server: VenueRoom;
  let broadcastedMessages: string[];

  beforeEach(() => {
    broadcastedMessages = [];

    mockConn = {
      id: 'conn-1',
      send: jest.fn(),
      close: jest.fn(),
    } as unknown as Party.Connection;

    mockRoom = {
      id: 'venue-101',
      broadcast: jest.fn((msg: string) => {
        broadcastedMessages.push(msg);
      }),
    } as unknown as Party.Room;

    server = new VenueRoom(mockRoom);
  });

  describe('Connection Lifecycle', () => {
    it('sends initial seat snapshot on fresh connect', async () => {
      const mockCtx = {
        request: {
          url: 'https://worksphere.partykit.dev/parties/venueRoom/venue-101',
        },
      } as unknown as Party.ConnectionContext;

      await server.onConnect(mockConn, mockCtx);

      expect(mockConn.send).toHaveBeenCalledTimes(1);
      const snapshot = JSON.parse((mockConn.send as jest.Mock).mock.calls[0][0]);
      expect(snapshot.type).toBe('seat_snapshot');
      expect(snapshot.sequenceId).toBe(0);
      expect(snapshot.seats).toEqual([]);
    });

    it('triggers sync replay on connect if lastSeq is present in query parameters', async () => {
      // 1. First record checkin events
      await server.onMessage(
        JSON.stringify({
          type: 'seat_checkin',
          seatId: 'seat-1',
          userId: 'user-1',
        }),
        mockConn
      );
      await server.onMessage(
        JSON.stringify({
          type: 'seat_checkin',
          seatId: 'seat-2',
          userId: 'user-2',
        }),
        mockConn
      );

      expect(server.getSequenceId()).toBe(2);

      // 2. Client reconnects with lastSeq = 1
      const reconnectConn = {
        id: 'conn-reconnect',
        send: jest.fn(),
      } as unknown as Party.Connection;

      const mockCtx = {
        request: {
          url: `https://worksphere.partykit.dev/parties/venueRoom/venue-101?lastSeq=1&epoch=${server.getEpoch()}`,
        },
      } as unknown as Party.ConnectionContext;

      await server.onConnect(reconnectConn, mockCtx);

      expect(reconnectConn.send).toHaveBeenCalledTimes(1);
      const reply = JSON.parse((reconnectConn.send as jest.Mock).mock.calls[0][0]);
      expect(reply.type).toBe('sync_replay');
      expect(reply.fromSeq).toBe(2);
      expect(reply.toSeq).toBe(2);
      expect(reply.events).toHaveLength(1);
      expect(reply.events[0].seat.seatId).toBe('seat-2');
    });
  });

  describe('Seat Check-in and Check-out Events', () => {
    it('increments CRDT sequenceId and broadcasts seat update', async () => {
      await server.onMessage(
        JSON.stringify({
          type: 'seat_checkin',
          seatId: 'desk-A',
          userId: 'user-nomad',
          userName: 'Alex',
        }),
        mockConn
      );

      expect(server.getSequenceId()).toBe(1);
      expect(broadcastedMessages).toHaveLength(1);

      const broadcast = JSON.parse(broadcastedMessages[0]);
      expect(broadcast.type).toBe('seat_update');
      expect(broadcast.sequenceId).toBe(1);
      expect(broadcast.event.seat.seatId).toBe('desk-A');
      expect(broadcast.event.seat.status).toBe('OCCUPIED');
    });

    it('processes seat check-out and marks seat available', async () => {
      await server.onMessage(
        JSON.stringify({
          type: 'seat_checkout',
          seatId: 'desk-A',
          userId: 'user-nomad',
        }),
        mockConn
      );

      expect(server.getSequenceId()).toBe(1);
      const broadcast = JSON.parse(broadcastedMessages[0]);
      expect(broadcast.event.seat.status).toBe('AVAILABLE');
    });
  });

  describe('Delta State Synchronization Protocol', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 5; i++) {
        await server.onMessage(
          JSON.stringify({
            type: 'seat_checkin',
            seatId: `seat-${i}`,
            userId: `user-${i}`,
          }),
          mockConn
        );
      }
    });

    it('returns sync_ack when client is already synchronized', async () => {
      await server.onMessage(
        JSON.stringify({
          type: 'sync_request',
          lastSeq: 5,
          epoch: server.getEpoch(),
        }),
        mockConn
      );

      const reply = JSON.parse((mockConn.send as jest.Mock).mock.calls[0][0]);
      expect(reply.type).toBe('sync_ack');
      expect(reply.status).toBe('synchronized');
      expect(reply.latestSeq).toBe(5);
    });

    it('returns sync_replay with missed events in sequence order', async () => {
      await server.onMessage(
        JSON.stringify({
          type: 'sync_request',
          lastSeq: 3,
          epoch: server.getEpoch(),
        }),
        mockConn
      );

      const reply = JSON.parse((mockConn.send as jest.Mock).mock.calls[0][0]);
      expect(reply.type).toBe('sync_replay');
      expect(reply.fromSeq).toBe(4);
      expect(reply.toSeq).toBe(5);
      expect(reply.events).toHaveLength(2);
      expect(reply.events[0].sequenceId).toBe(4);
      expect(reply.events[1].sequenceId).toBe(5);
    });

    it('returns sync_fallback when client epoch does not match', async () => {
      await server.onMessage(
        JSON.stringify({
          type: 'sync_request',
          lastSeq: 2,
          epoch: 999999, // Mismatched epoch
        }),
        mockConn
      );

      const reply = JSON.parse((mockConn.send as jest.Mock).mock.calls[0][0]);
      expect(reply.type).toBe('sync_fallback');
      expect(reply.reason).toBe('epoch_mismatch');
      expect(reply.seats).toHaveLength(5);
    });
  });
});
