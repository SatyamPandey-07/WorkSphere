import {
  createCursorThrottleController,
  type DataChannelLike,
} from '@/hooks/useMeshDataChannels';

function makeChannel(sent: string[]): DataChannelLike {
  return {
    readyState: 'open',
    send: (data: string) => {
      sent.push(data);
    },
  };
}

describe('useMeshDataChannels cursor throttle reset on peer reconnect', () => {
  it('throttles rapid updates within throttleMs, then immediately sends initial cursor on reconnect', () => {
    const sent: string[] = [];
    const channel = makeChannel(sent);
    const controller = createCursorThrottleController({ throttleMs: 100 });

    expect(controller.trySendCursor(channel, { x: 10, y: 20 }, 10_000)).toBe(true);
    expect(controller.trySendCursor(channel, { x: 15, y: 25 }, 10_020)).toBe(false);
    expect(sent).toHaveLength(1);

    controller.resetOnPeerConnect();
    expect(controller.state.lastUpdateTime).toBe(0);
    expect(controller.state.forceNextSend).toBe(true);

    expect(controller.trySendCursor(channel, { x: 120, y: 240 }, 10_030)).toBe(
      true
    );
    expect(sent).toHaveLength(2);
    expect(JSON.parse(sent[1])).toMatchObject({
      type: 'cursor',
      x: 120,
      y: 240,
      ts: 10_030,
    });
  });

  it('handles clock skew cleanly without dropping cursor updates', () => {
    const sent: string[] = [];
    const channel = makeChannel(sent);
    const controller = createCursorThrottleController({ throttleMs: 50 });

    expect(controller.trySendCursor(channel, { x: 1, y: 2 }, 5_000)).toBe(true);
    expect(controller.trySendCursor(channel, { x: 3, y: 4 }, 4_500)).toBe(true);
    expect(sent).toHaveLength(2);
  });
});
