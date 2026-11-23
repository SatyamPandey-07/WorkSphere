"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  PdfSignatureInfo,
  SignatureVerificationResult,
  VerificationStatus,
  WorkerRequest,
  WorkerResponse,
} from "@/types/pdfSignature";
import { extractSignatures } from "@/lib/pdf-verify/pdfSignatureExtractor";
import { fetchCaRootsPem } from "@/lib/pdf-verify/caRoots";

export interface UsePdfSignatureVerifierReturn {
  status: VerificationStatus;
  progress: number;
  signatures: PdfSignatureInfo[];
  result: SignatureVerificationResult | null;
  error: string | null;
  verify: (file: File) => Promise<void>;
  reset: () => void;
}

interface QueuedItem {
  id: string;
  pdfBytes: Uint8Array;
  cmsBlob: Uint8Array;
  byteRange: {
    offset1: number;
    length1: number;
    offset2: number;
    length2: number;
  };
  caRoots: string;
  resolve: (res: SignatureVerificationResult) => void;
  reject: (err: Error) => void;
  isCancelled: () => boolean;
}

class PdfWorkerManager {
  private worker: Worker | null = null;
  private isInitializing: boolean = false;
  private initPromise: Promise<void> | null = null;
  private queue: QueuedItem[] = [];
  private currentItem: QueuedItem | null = null;
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private activeSubscriptions = 0;
  private static IDLE_TIMEOUT_MS = 60000;

  // Static singleton instance
  private static instance: PdfWorkerManager | null = null;

  static getInstance(): PdfWorkerManager {
    if (!PdfWorkerManager.instance) {
      PdfWorkerManager.instance = new PdfWorkerManager();
    }
    return PdfWorkerManager.instance;
  }

  // Exposed for tests if needed
  static resetInstance(): void {
    if (PdfWorkerManager.instance) {
      PdfWorkerManager.instance.terminateWorker();
      PdfWorkerManager.instance = null;
    }
  }

  acquireSubscription(): void {
    this.activeSubscriptions++;
    this.clearIdleTimer();
  }

  releaseSubscription(): void {
    this.activeSubscriptions = Math.max(0, this.activeSubscriptions - 1);
    this.checkIdle();
  }

  private clearIdleTimer(): void {
    if (this.idleTimeoutId !== null) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
  }

  private checkIdle(): void {
    if (this.currentItem === null && this.queue.length === 0) {
      this.clearIdleTimer();
      this.idleTimeoutId = setTimeout(() => {
        if (this.currentItem === null && this.queue.length === 0) {
          this.terminateWorker();
        }
      }, PdfWorkerManager.IDLE_TIMEOUT_MS);
    }
  }

  terminateWorker(): void {
    this.clearIdleTimer();
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
    this.isInitializing = false;
    this.initPromise = null;

    if (this.currentItem) {
      const item = this.currentItem;
      this.currentItem = null;
      item.reject(new Error("Worker terminated"));
    }

    const queuedItems = [...this.queue];
    this.queue = [];
    for (const item of queuedItems) {
      item.reject(new Error("Worker terminated"));
    }
  }

  private getOrCreateWorker(): Worker {
    if (!this.worker) {
      const baseUrl =
        typeof document !== "undefined" && document.baseURI
          ? document.baseURI
          : "http://localhost";
      this.worker = new Worker(
        new URL("../workers/pdfVerify.worker.ts", baseUrl),
        { type: "module" },
      );
      this.setupWorkerListeners(this.worker);
    }
    return this.worker;
  }

  private setupWorkerListeners(worker: Worker): void {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (!data) return;
      const { action, id, result, error } = data;

      if (action === "ready") {
        return;
      }

      if (action === "result") {
        if (this.currentItem && this.currentItem.id === id) {
          const item = this.currentItem;
          this.currentItem = null;
          if (!item.isCancelled()) {
            if (result) {
              item.resolve(result);
            } else {
              item.reject(new Error("Verification produced no result"));
            }
          }
        }
        this.processNext();
        return;
      }

      if (action === "error") {
        if (this.currentItem && this.currentItem.id === id) {
          const item = this.currentItem;
          this.currentItem = null;
          if (!item.isCancelled()) {
            item.reject(new Error(error || "Verification failed"));
          }
        }
        this.processNext();
        return;
      }
    };

    worker.onerror = (e: ErrorEvent) => {
      const errMsg = e.message || "Unknown worker error";
      if (this.currentItem) {
        const item = this.currentItem;
        this.currentItem = null;
        if (!item.isCancelled()) {
          item.reject(new Error(`Worker error: ${errMsg}`));
        }
      }
      this.terminateWorker();
    };
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    const worker = this.getOrCreateWorker();
    this.isInitializing = true;

    this.initPromise = new Promise<void>((resolve, reject) => {
      const initId = `init-${Date.now()}-${Math.random()}`;

      const handleInitMessage = (event: MessageEvent<WorkerResponse>) => {
        const { action, id, error } = event.data || {};
        if (id === initId) {
          worker.removeEventListener("message", handleInitMessage);
          this.isInitializing = false;
          if (action === "ready") {
            resolve();
          } else {
            this.initPromise = null;
            reject(new Error(error || "WASM init failed"));
          }
        }
      };

      worker.addEventListener("message", handleInitMessage);

      const request: WorkerRequest = {
        action: "init",
        id: initId,
        payload: { wasmUrl: "/pdf-verify.js" },
      };
      worker.postMessage(request);
    });

    return this.initPromise;
  }

  private processNext(): void {
    this.clearIdleTimer();

    while (this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.isCancelled()) {
        continue;
      }
      this.currentItem = next;
      this.dispatchCurrent();
      return;
    }

    this.currentItem = null;
    this.checkIdle();
  }

  private async dispatchCurrent(): Promise<void> {
    if (!this.currentItem) return;

    if (this.currentItem.isCancelled()) {
      this.currentItem = null;
      this.processNext();
      return;
    }

    try {
      await this.ensureInitialized();
    } catch (err) {
      if (this.currentItem) {
        const item = this.currentItem;
        this.currentItem = null;
        if (!item.isCancelled()) {
          item.reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
      this.processNext();
      return;
    }

    if (!this.currentItem || this.currentItem.isCancelled()) {
      this.currentItem = null;
      this.processNext();
      return;
    }

    const item = this.currentItem;
    const worker = this.getOrCreateWorker();
    const req: WorkerRequest = {
      action: "verify",
      id: item.id,
      payload: {
        pdfBytes: item.pdfBytes,
        cmsBlob: item.cmsBlob,
        byteRange: item.byteRange,
        caRoots: item.caRoots,
      },
    };
    worker.postMessage(req);
  }

  verifySignature(
    id: string,
    pdfBytes: Uint8Array,
    cmsBlob: Uint8Array,
    byteRange: {
      offset1: number;
      length1: number;
      offset2: number;
      length2: number;
    },
    caRoots: string,
    isCancelled: () => boolean,
  ): Promise<SignatureVerificationResult> {
    this.clearIdleTimer();
    return new Promise<SignatureVerificationResult>((resolve, reject) => {
      const item: QueuedItem = {
        id,
        pdfBytes,
        cmsBlob,
        byteRange,
        caRoots,
        resolve,
        reject,
        isCancelled,
      };

      if (!this.currentItem && this.queue.length === 0) {
        this.currentItem = item;
        this.dispatchCurrent();
      } else {
        this.queue.push(item);
      }
    });
  }

  cancelRequest(id: string): void {
    // If it's queued, remove it
    this.queue = this.queue.filter((item) => {
      if (item.id === id) {
        item.reject(new Error("Verification cancelled"));
        return false;
      }
      return true;
    });

    if (this.currentItem && this.currentItem.id === id) {
      const item = this.currentItem;
      this.currentItem = null;
      item.reject(new Error("Verification cancelled"));
      this.processNext();
    }
  }

  getWorker(): Worker | null {
    return this.worker;
  }
}

// For unit testing inspection
export { PdfWorkerManager };

let reqCounter = 0;

export function usePdfSignatureVerifier(): UsePdfSignatureVerifierReturn {
  const [status, setStatus] = useState<VerificationStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [signatures, setSignatures] = useState<PdfSignatureInfo[]>([]);
  const [result, setResult] = useState<SignatureVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isMountedRef = useRef(true);
  const currentReqIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    const manager = PdfWorkerManager.getInstance();
    manager.acquireSubscription();

    return () => {
      isMountedRef.current = false;
      if (currentReqIdRef.current) {
        manager.cancelRequest(currentReqIdRef.current);
        currentReqIdRef.current = null;
      }
      manager.releaseSubscription();
    };
  }, []);

  const reset = useCallback(() => {
    const manager = PdfWorkerManager.getInstance();
    if (currentReqIdRef.current) {
      manager.cancelRequest(currentReqIdRef.current);
      currentReqIdRef.current = null;
    }
    setStatus("idle");
    setProgress(0);
    setSignatures([]);
    setResult(null);
    setError(null);
  }, []);

  const verify = useCallback(async (file: File) => {
    const manager = PdfWorkerManager.getInstance();

    if (currentReqIdRef.current) {
      manager.cancelRequest(currentReqIdRef.current);
      currentReqIdRef.current = null;
    }

    const reqId = `verify-${Date.now()}-${++reqCounter}`;
    currentReqIdRef.current = reqId;

    const isCurrentActive = () =>
      isMountedRef.current && currentReqIdRef.current === reqId;

    setStatus("loading");
    setProgress(0);
    setResult(null);
    setError(null);
    setSignatures([]);

    try {
      setProgress(10);
      const arrayBuffer = await file.arrayBuffer();
      if (!isCurrentActive()) return;

      const pdfBytes = new Uint8Array(arrayBuffer);
      setProgress(30);

      const extractedSignatures = extractSignatures(pdfBytes);
      if (!isCurrentActive()) return;

      if (extractedSignatures.length === 0) {
        setStatus("unsigned");
        setProgress(100);
        if (currentReqIdRef.current === reqId) {
          currentReqIdRef.current = null;
        }
        return;
      }

      setProgress(50);
      setSignatures(extractedSignatures);
      setStatus("verifying");

      const sig = extractedSignatures[0];
      const caRoots = await fetchCaRootsPem();
      if (!isCurrentActive()) return;

      setProgress(75);

      const res = await manager.verifySignature(
        reqId,
        pdfBytes,
        sig.contents,
        sig.byteRange,
        caRoots,
        () => !isCurrentActive(),
      );

      if (!isCurrentActive()) return;

      setProgress(100);
      setResult(res);
      setStatus(res.valid ? "verified" : "invalid");
      if (currentReqIdRef.current === reqId) {
        currentReqIdRef.current = null;
      }
    } catch (err) {
      if (!isCurrentActive()) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setStatus("error");
      if (currentReqIdRef.current === reqId) {
        currentReqIdRef.current = null;
      }
    }
  }, []);

  return { status, progress, signatures, result, error, verify, reset };
}
