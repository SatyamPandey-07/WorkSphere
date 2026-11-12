export interface StreamerOptions {
  model?: string;
  temperature?: number;
  signal?: AbortSignal;
}

export class NomadStreamer {
  /**
   * Creates a backpressure-aware ReadableStream for Server-Sent Events (SSE).
   */
  public static createSSEStream(
    prompt: string,
    options: StreamerOptions = {}
  ): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let tokenIndex = 0;
    const mockTokens = [
      'Welcome', ' ', 'to', ' ', 'WorkSphere', ' ', 'Nomad', ' ', 'Assistant.', '\n',
      'Based', ' ', 'on', ' ', 'your', ' ', 'query', ' ', 'regarding', ' ', 'coworking', ' ', 'hubs:', '\n',
      '1.', ' ', 'High-speed', ' ', 'fiber', ' ', 'connectivity', ' ', 'is', ' ', 'available.', '\n',
      '2.', ' ', 'Soundproof', ' ', 'pods', ' ', 'can', ' ', 'be', ' ', 'booked', ' ', 'via', ' ', '2PC', ' ', 'atomic', ' ', 'transactions.', '\n',
      'Let', ' ', 'me', ' ', 'know', ' ', 'if', ' ', 'you', ' ', 'need', ' ', 'assistance', ' ', 'with', ' ', 'itineraries!'
    ];

    const stream = new ReadableStream({
      start(controller) {
        // Handle sudden client disconnect via AbortSignal
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            try {
              controller.close();
            } catch (e) {
              // Stream already closed
            }
          });
        }
      },
      async pull(controller) {
        // Check backpressure: if client consumer buffer is full (desiredSize <= 0), pause pushing chunks
        if (controller.desiredSize !== null && controller.desiredSize <= 0) {
          await new Promise((resolve) => setTimeout(resolve, 50)); // Backoff pause
          return;
        }

        if (tokenIndex < mockTokens.length) {
          const token = mockTokens[tokenIndex++];
          const sseMessage = `data: ${JSON.stringify({ token, index: tokenIndex })}\n\n`;
          controller.enqueue(encoder.encode(sseMessage));

          // Simulate token generation latency
          await new Promise((resolve) => setTimeout(resolve, 30));
        } else {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
      cancel(reason) {
        console.log('Stream canceled by client or network interruption:', reason);
      },
    });

    return stream;
  }
}