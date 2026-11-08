import {
  ChunkedFileTransfer,
  FileChunk,
} from '@/core/network/ChunkedFileTransfer';

// Helper to create mock File in test environment
function createMockFile(name: string, sizeBytes: number): File {
  const buffer = new Uint8Array(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) {
    buffer[i] = i % 256;
  }
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  return new File([blob], name, { type: 'application/octet-stream' });
}

describe('ChunkedFileTransfer Pause, Cancel, and Resume (#5635)', () => {
  const CHUNK_SIZE = 1024; // 1KB chunks for fast testing

  it('pauses transfer and saves session progress', async () => {
    const transfer = new ChunkedFileTransfer(CHUNK_SIZE);
    // 5KB file => 5 chunks (0, 1, 2, 3, 4)
    const mockFile = createMockFile('test-presentation.pdf', 5 * 1024);
    const sentChunks: FileChunk[] = [];
    let fileIdCaptured = '';

    const sendPromise = transfer.sliceAndSend(mockFile, (chunk) => {
      sentChunks.push(chunk);
      fileIdCaptured = chunk.fileId;
      // Pause transfer after sending chunk 1
      if (chunk.chunkIndex === 1) {
        transfer.pauseTransfer(chunk.fileId);
      }
    });

    await sendPromise;

    // Should have sent chunks 0 and 1, then stopped
    expect(sentChunks.length).toBe(2);
    expect(sentChunks[0].chunkIndex).toBe(0);
    expect(sentChunks[1].chunkIndex).toBe(1);

    // Verify session was saved in session store
    const session = await transfer.getSession(fileIdCaptured);
    expect(session).not.toBeNull();
    expect(session?.fileId).toBe(fileIdCaptured);
    expect(session?.status).toBe('paused');
    expect(session?.receivedChunks).toContain(0);
    expect(session?.receivedChunks).toContain(1);
  });

  it('resumes interrupted transfer without restarting from chunk 0', async () => {
    const transfer = new ChunkedFileTransfer(CHUNK_SIZE);
    const mockFile = createMockFile('video-demo.mp4', 6 * 1024); // 6 chunks: 0..5
    const sentChunksPhase1: FileChunk[] = [];
    let transferId = '';

    // Phase 1: Transfer is paused after chunk 2
    await transfer.sliceAndSend(mockFile, (chunk) => {
      sentChunksPhase1.push(chunk);
      transferId = chunk.fileId;
      if (chunk.chunkIndex === 2) {
        transfer.pauseTransfer(chunk.fileId);
      }
    });

    expect(sentChunksPhase1.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);

    // Phase 2: Resume transfer for the same transferId
    const resumedChunks: FileChunk[] = [];
    await transfer.resumeTransfer(transferId, mockFile, (chunk) => {
      resumedChunks.push(chunk);
    });

    // CRITICAL: The resumed transfer must NOT resend chunk 0, 1, or 2!
    // It must only transmit missing chunks: 3, 4, 5
    expect(resumedChunks.length).toBe(3);
    expect(resumedChunks.map((c) => c.chunkIndex)).toEqual([3, 4, 5]);

    // Combined transfer should cover all chunks
    const allSentIndices = [
      ...sentChunksPhase1.map((c) => c.chunkIndex),
      ...resumedChunks.map((c) => c.chunkIndex),
    ];
    expect(allSentIndices).toEqual([0, 1, 2, 3, 4, 5]);

    // Final session status should be complete
    const finalSession = await transfer.getSession(transferId);
    expect(finalSession?.status).toBe('complete');
  });

  it('supports inquiry and inquiry response to sync received chunk indices', () => {
    const sender = new ChunkedFileTransfer(CHUNK_SIZE);
    const receiver = new ChunkedFileTransfer(CHUNK_SIZE);
    const fileId = 'mock-transfer-uuid-123';

    // Receiver gets chunks 0, 1, and 3 (chunk 2 was dropped)
    const dummyData = new ArrayBuffer(CHUNK_SIZE);
    receiver.processIncomingChunk(
      {
        fileId,
        chunkIndex: 0,
        totalChunks: 4,
        fileName: 'doc.txt',
        fileSize: 4096,
        data: dummyData,
      },
      () => {}
    );
    receiver.processIncomingChunk(
      {
        fileId,
        chunkIndex: 1,
        totalChunks: 4,
        fileName: 'doc.txt',
        fileSize: 4096,
        data: dummyData,
      },
      () => {}
    );
    receiver.processIncomingChunk(
      {
        fileId,
        chunkIndex: 3,
        totalChunks: 4,
        fileName: 'doc.txt',
        fileSize: 4096,
        data: dummyData,
      },
      () => {}
    );

    // Sender creates an inquiry
    const inquiry = sender.createInquiry(fileId);
    expect(inquiry).toEqual({ type: 'INQUIRY', fileId });

    // Receiver handles inquiry
    const response = receiver.handleInquiry(inquiry.fileId);
    expect(response.type).toBe('INQUIRY_RESPONSE');
    expect(response.fileId).toBe(fileId);
    expect(response.receivedChunkIndices.sort()).toEqual([0, 1, 3]);
  });

  it('cancels transfer and removes stored session', async () => {
    const transfer = new ChunkedFileTransfer(CHUNK_SIZE);
    const mockFile = createMockFile('large-file.bin', 10 * 1024);
    let capturedId = '';

    await transfer.sliceAndSend(mockFile, (chunk) => {
      capturedId = chunk.fileId;
      transfer.cancelTransfer(chunk.fileId);
    });

    const sessionAfterCancel = await transfer.getSession(capturedId);
    expect(sessionAfterCancel).toBeNull();
  });
});
