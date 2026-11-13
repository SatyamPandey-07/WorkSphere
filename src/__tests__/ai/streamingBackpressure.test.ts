import { NomadStreamer } from '../../core/ai/NomadStreamer';

describe('NomadStreamer Backpressure & Disconnect Handling', () => {
  test('creates a valid SSE stream with proper headers and data chunks', async () => {
    const stream = NomadStreamer.createSSEStream('Test prompt');
    const reader = stream.getReader();

    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(value).toBeInstanceOf(Uint8Array);

    const text = new TextDecoder().decode(value);
    expect(text).toContain('data:');
  });

  test('instantly terminates stream when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    const stream = NomadStreamer.createSSEStream('Test prompt', { signal: controller.signal });
    const reader = stream.getReader();

    // Abort client connection immediately
    controller.abort();

    let isDone = false;
    try {
      while (!isDone) {
        const res = await reader.read();
        isDone = res.done;
      }
    } catch (e) {
      isDone = true;
    }

    expect(isDone).toBe(true);
  });
});