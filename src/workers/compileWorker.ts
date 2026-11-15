/**
 * compileWorker.ts
 * Web Worker that handles the heavy lifting of local compilation, 
 * chunk hashing, and result serialization off the main thread.
 */

/// <reference lib="webworker" />
declare const self: DedicatedWorkerGlobalScope;

import { TaskChunker, ChunkMetadata } from '../core/network/TaskChunker';

const chunker = new TaskChunker(32 * 1024); // 32KB chunks for compilation

interface WorkerMessage {
  type: 'COMPILE_CHUNK' | 'HASH_CHUNK' | 'MERGE_RESULTS' | 'INIT_TASK';
  payload: any;
}

self.addEventListener('message', async (event: MessageEvent<WorkerMessage>) => {
  const { type, payload } = event.data;

  try {
    switch (type) {
      case 'INIT_TASK':
        self.postMessage({ type: 'TASK_INITIALIZED', taskId: payload.taskId });
        break;

      case 'COMPILE_CHUNK':
        await handleCompilation(payload);
        break;

      case 'HASH_CHUNK':
        await handleHashing(payload);
        break;

      case 'MERGE_RESULTS':
        await handleMerge(payload);
        break;

      default:
        self.postMessage({ type: 'ERROR', error: 'Unknown message type' });
    }
  } catch (error: any) {
    self.postMessage({ 
      type: 'ERROR', 
      error: error.message || 'Worker execution failed',
      taskId: payload?.taskId 
    });
  }
});

async function handleCompilation(payload: { taskId: string; chunkData: ArrayBuffer; metadata: ChunkMetadata }) {
  // Simulate heavy compilation workload (e.g., parsing AST, transpiling)
  const startTime = performance.now();
  
  // In a real scenario, this would invoke a WASM compiler like SWC, esbuild, or rustc
  // For the mesh, we process the chunk and return a transformed binary
  const view = new Uint8Array(payload.chunkData);
  const compiledData = new Uint8Array(view.length);
  
  // Mock compilation transform (e.g., minification or byte-code generation)
  for (let i = 0; i < view.length; i++) {
    compiledData[i] = view[i] ^ 0xA5; // Simple XOR transform to simulate compilation
  }

  const duration = performance.now() - startTime;
  
  self.postMessage({
    type: 'CHUNK_COMPILED',
    taskId: payload.taskId,
    metadata: payload.metadata,
    resultData: compiledData.buffer,
    durationMs: duration
  }, [compiledData.buffer]);
}

async function handleHashing(payload: { taskId: string; data: ArrayBuffer }) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', payload.data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  self.postMessage({
    type: 'HASH_GENERATED',
    taskId: payload.taskId,
    hash: hashHex
  });
}

async function handleMerge(payload: { taskId: string; chunks: ArrayBuffer[] }) {
  const totalLength = payload.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const mergedResult = new Uint8Array(totalLength);
  
  let offset = 0;
  for (const chunk of payload.chunks) {
    mergedResult.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }

  // Reverse the mock compilation transform
  for (let i = 0; i < mergedResult.length; i++) {
    mergedResult[i] = mergedResult[i] ^ 0xA5;
  }

  self.postMessage({
    type: 'MERGE_COMPLETE',
    taskId: payload.taskId,
    finalBinary: mergedResult.buffer
  }, [mergedResult.buffer]);
}

// Keep worker alive
self.addEventListener('error', (event) => {
  console.error('[CompileWorker] Uncaught error:', event.message);
});
