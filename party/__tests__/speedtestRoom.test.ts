import type * as Party from 'partykit/server';
import SpeedtestRoom from '../speedtest.room';

describe('SpeedtestRoom peer heartbeats', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(100000);
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    it('evicts an unresponsive peer from the room and closes its connection', async () => {
        const broadcast = jest.fn();
        const room = { broadcast } as unknown as Party.Room;
        const server = new SpeedtestRoom(room);
        const connection = {
            id: 'mobile-peer',
            send: jest.fn(),
            close: jest.fn()
        } as unknown as Party.Connection;

        await server.onConnect(connection, {} as Party.ConnectionContext);
        jest.advanceTimersByTime(15000);

        expect(connection.close).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith(JSON.stringify({
            type: 'peer-left',
            peerId: 'mobile-peer'
        }));
    });

    it('renews peer liveness when a heartbeat arrives', async () => {
        const broadcast = jest.fn();
        const room = { broadcast } as unknown as Party.Room;
        const server = new SpeedtestRoom(room);
        const connection = {
            id: 'mobile-peer',
            send: jest.fn(),
            close: jest.fn()
        } as unknown as Party.Connection;

        await server.onConnect(connection, {} as Party.ConnectionContext);
        jest.advanceTimersByTime(10000);
        await server.onMessage(JSON.stringify({ type: 'heartbeat' }), connection);
        jest.advanceTimersByTime(10000);

        expect(connection.close).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalledWith(JSON.stringify({
            type: 'peer-left',
            peerId: 'mobile-peer'
        }));
    });
});
