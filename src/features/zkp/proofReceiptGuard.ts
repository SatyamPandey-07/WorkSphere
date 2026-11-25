export type ProofReceiptStatus = 'valid' | 'expired' | 'replayed_nullifier' | 'not_found';
export interface ProofReceipt { proofHash: string; nullifier: string; verifiedAtMs: number; expiresAtMs: number; metadata?: Record<string, string | number | boolean>; }
export interface ProofReceiptCheckResult { status: ProofReceiptStatus; allowed: boolean; receipt?: ProofReceipt; reason?: string; }
export interface ProofReceiptGuardOptions { defaultTtlMs?: number; maxEntries?: number; singleUseNullifiers?: boolean; nowFn?: () => number; }
function cloneReceipt(r: ProofReceipt): ProofReceipt { return { proofHash: r.proofHash, nullifier: r.nullifier, verifiedAtMs: r.verifiedAtMs, expiresAtMs: r.expiresAtMs, metadata: r.metadata ? { ...r.metadata } : undefined }; }
export class ProofReceiptGuard {
  private readonly defaultTtlMs: number; private readonly maxEntries: number; private readonly singleUseNullifiers: boolean; private readonly nowFn: () => number;
  private readonly receiptsByHash = new Map<string, ProofReceipt>(); private readonly consumedNullifiers = new Set<string>();
  constructor(options: ProofReceiptGuardOptions = {}) {
    this.defaultTtlMs = typeof options.defaultTtlMs === 'number' && Number.isFinite(options.defaultTtlMs) && options.defaultTtlMs > 0 ? Math.floor(options.defaultTtlMs) : 300_000;
    this.maxEntries = typeof options.maxEntries === 'number' && Number.isFinite(options.maxEntries) && options.maxEntries > 0 ? Math.floor(options.maxEntries) : 500;
    this.singleUseNullifiers = options.singleUseNullifiers ?? true; this.nowFn = options.nowFn ?? Date.now;
  }
  public isExpired(receipt: ProofReceipt, nowMs = this.nowFn()): boolean { return nowMs >= receipt.expiresAtMs; }
  public purgeExpired(nowMs = this.nowFn()): number { let p = 0; for (const [k, r] of this.receiptsByHash.entries()) if (this.isExpired(r, nowMs)) { this.receiptsByHash.delete(k); p += 1; } return p; }
  public registerReceipt(input: { proofHash: string; nullifier: string; verifiedAtMs?: number; ttlMs?: number; expiresAtMs?: number; metadata?: Record<string, string | number | boolean>; }, nowMs = this.nowFn()): ProofReceipt {
    if (!input.proofHash) throw new Error('proofHash is required'); if (!input.nullifier) throw new Error('nullifier is required');
    this.purgeExpired(nowMs);
    const verifiedAtMs = typeof input.verifiedAtMs === 'number' && Number.isFinite(input.verifiedAtMs) ? Math.floor(input.verifiedAtMs) : nowMs;
    const ttlMs = typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? Math.floor(input.ttlMs) : this.defaultTtlMs;
    const expiresAtMs = typeof input.expiresAtMs === 'number' && Number.isFinite(input.expiresAtMs) ? Math.floor(input.expiresAtMs) : verifiedAtMs + ttlMs;
    const stored: ProofReceipt = { proofHash: input.proofHash, nullifier: input.nullifier, verifiedAtMs, expiresAtMs, metadata: input.metadata ? { ...input.metadata } : undefined };
    if (this.receiptsByHash.has(stored.proofHash)) this.receiptsByHash.delete(stored.proofHash);
    while (this.receiptsByHash.size >= this.maxEntries) { const oldest = this.receiptsByHash.keys().next().value; if (oldest === undefined) break; this.receiptsByHash.delete(oldest); }
    this.receiptsByHash.set(stored.proofHash, stored); return cloneReceipt(stored);
  }
  public lookup(proofHash: string, nowMs = this.nowFn()): ProofReceiptCheckResult {
    this.purgeExpired(nowMs); const existing = this.receiptsByHash.get(proofHash);
    if (!existing) return { status: 'not_found', allowed: false, reason: 'No cached proof receipt found' };
    if (this.isExpired(existing, nowMs)) { this.receiptsByHash.delete(proofHash); return { status: 'expired', allowed: false, receipt: cloneReceipt(existing), reason: 'Proof receipt TTL has expired' }; }
    if (this.singleUseNullifiers && this.consumedNullifiers.has(existing.nullifier)) return { status: 'replayed_nullifier', allowed: false, receipt: cloneReceipt(existing), reason: 'Nullifier has already been consumed' };
    return { status: 'valid', allowed: true, receipt: cloneReceipt(existing) };
  }
  public consumeProof(proofHash: string, nowMs = this.nowFn()): ProofReceiptCheckResult { const check = this.lookup(proofHash, nowMs); if (check.allowed && check.receipt && this.singleUseNullifiers) this.consumedNullifiers.add(check.receipt.nullifier); return check; }
  public hasConsumedNullifier(nullifier: string): boolean { return this.consumedNullifiers.has(nullifier); }
  public size(nowMs = this.nowFn()): number { this.purgeExpired(nowMs); return this.receiptsByHash.size; }
  public clear(): void { this.receiptsByHash.clear(); this.consumedNullifiers.clear(); }
}
