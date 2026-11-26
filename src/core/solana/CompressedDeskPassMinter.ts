/**
 * @file CompressedDeskPassMinter.ts
 * @description High-throughput, low-cost Solana Compressed NFT (cNFT) desk pass minter
 * leveraging SPL Account Compression and Metaplex Bubblegum concurrent Merkle trees.
 * Enables minting, verification, delegation, and transfers of workspace passes.
 */

import { createHash } from "crypto";
import sha3 from "js-sha3";
const { keccak_256 } = sha3;

export interface MerkleTreeConfig {
  maxDepth: number; // Tree depth (e.g., 14 => 16,384 leaves, 20 => 1,048,576 leaves)
  maxBufferSize: number; // Concurrent changelog buffer size (e.g., 64)
  canopyDepth: number; // Cached proof depth stored on-chain (e.g., 8-11)
  treeAuthority?: string; // Base58 public key of the Tree Authority
  treeAddress?: string; // Base58 public key of the on-chain Merkle tree account
}

export interface PassMetadata {
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  venueId: string;
  seatTier: "HOT_DESK" | "DEDICATED_DESK" | "PRIVATE_POD" | "EXECUTIVE_SUITE";
  validUntil: number; // Unix timestamp
  attributes: Array<{ traitType: string; value: string | number }>;
}

export interface CompressedPassAsset {
  assetId: string;
  leafIndex: number;
  leafHash: string;
  owner: string;
  delegate: string;
  metadata: PassMetadata;
  mintedAt: number;
  status: "ACTIVE" | "TRANSFERRED" | "BURNED";
}

export interface MerkleProof {
  root: string;
  leaf: string;
  index: number;
  proof: string[];
}

export interface CanopyNode {
  level: number;
  index: number;
  hash: string;
}

export interface CanopySnapshot {
  treeAddress: string;
  root: string;
  maxDepth: number;
  canopyDepth: number;
  nodes: CanopyNode[];
}

export interface CanopyProvider {
  fetchCanopy(request: {
    treeAddress: string;
    root: string;
    maxDepth: number;
    canopyDepth: number;
  }): Promise<CanopySnapshot>;
}

export interface CheckInResult {
  asset: CompressedPassAsset;
  root: string;
}

export interface BubblegumInstructionPayload {
  programId: string;
  action: "mintV1" | "transfer" | "burn";
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
  data: Buffer;
}

export class CompressedDeskPassMinter {
  public static readonly BUBBLEGUM_PROGRAM_ID =
    "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY";
  public static readonly SPL_COMPRESSION_PROGRAM_ID =
    "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK";
  public static readonly LAMPORTS_PER_SOL = 1_000_000_000;

  private config: MerkleTreeConfig;
  private leaves: Map<number, Buffer> = new Map();
  private assets: Map<string, CompressedPassAsset> = new Map();
  private leafToAssetId: Map<number, string> = new Map();
  private nextLeafIndex: number = 0;
  private currentRoot: Buffer;
  private readonly canopyCache = new Map<
    string,
    { snapshot: CanopySnapshot; expiresAt: number }
  >();
  private readonly canopyRequests = new Map<string, Promise<CanopySnapshot>>();
  private readonly canopyTtlMs = 30_000;

  constructor(config: MerkleTreeConfig) {
    if (config.maxDepth < 3 || config.maxDepth > 30) {
      throw new Error(
        `Invalid maxDepth ${config.maxDepth}. Supported range is 3 to 30.`,
      );
    }
    if (config.canopyDepth < 0 || config.canopyDepth >= config.maxDepth) {
      throw new Error(`canopyDepth must be between 0 and maxDepth - 1.`);
    }

    this.config = {
      treeAuthority:
        config.treeAuthority ||
        "WorkSphereTreeAuth11111111111111111111111111111",
      treeAddress:
        config.treeAddress || "WorkSphereTreeAcct1111111111111111111111111111",
      ...config,
    };

    // Initialize empty root of the tree
    this.currentRoot = this.computeEmptyRoot(this.config.maxDepth);
  }

  /**
   * Calculates on-chain byte allocation and minimum rent-exemption lamports for the concurrent Merkle tree.
   */
  public static calculateTreeRent(config: MerkleTreeConfig): {
    bytes: number;
    lamports: number;
    sol: number;
  } {
    // Concurrent Merkle Tree Byte Layout:
    // Header: 8 (discriminator) + 32 (authority) + 8 (slot) + 8 (maxBufferSize) + 8 (maxDepth) + 8 (seq) + 8 (activeIndex) + 8 (bufferSize) = 88 bytes
    const headerBytes = 88;
    // Changelog entry: 32 (root) + 8 (path len) + maxDepth * 36 (32-byte node + 4-byte index) + 8 (sequence)
    const changelogEntryBytes = 48 + config.maxDepth * 36;
    const changelogBufferBytes = config.maxBufferSize * changelogEntryBytes;
    // Canopy cached nodes: (2^(canopyDepth + 1) - 2) * 32 bytes
    const canopyNodes =
      config.canopyDepth > 0 ? Math.pow(2, config.canopyDepth + 1) - 2 : 0;
    const canopyBytes = canopyNodes * 32;

    const totalBytes = headerBytes + changelogBufferBytes + canopyBytes;
    // Solana standard rent: 128 bytes account overhead + totalBytes * 6,960 lamports/KB (approx 6.96 lamports/byte * 2 years)
    const rentRatePerByteYear = 3480; // lamports per byte per year
    const lamports = Math.ceil((totalBytes + 128) * rentRatePerByteYear * 2);
    const sol =
      Math.round(
        (lamports / CompressedDeskPassMinter.LAMPORTS_PER_SOL) * 10000,
      ) / 10000;

    return { bytes: totalBytes, lamports, sol };
  }

  /**
   * Maximum capacity of the concurrent Merkle tree.
   */
  public getCapacity(): number {
    return Math.pow(2, this.config.maxDepth);
  }

  /**
   * Number of passes minted so far.
   */
  public getLeafCount(): number {
    return this.nextLeafIndex;
  }

  /**
   * Returns the current root hash (hex string).
   */
  public getRoot(): string {
    return this.currentRoot.toString("hex");
  }

  /**
   * Computes the deterministic SHA-256 digest of asset metadata.
   */
  public hashMetadata(metadata: PassMetadata): Buffer {
    const payload = JSON.stringify({
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      sellerFeeBasisPoints: metadata.sellerFeeBasisPoints,
      venueId: metadata.venueId,
      seatTier: metadata.seatTier,
      validUntil: metadata.validUntil,
      attributes: metadata.attributes,
    });
    return createHash("sha256").update(payload).digest();
  }

  /**
   * Computes the 32-byte leaf hash according to the Bubblegum specification:
   * H(version || owner || delegate || treeAuthority || leafIndex || metadataHash)
   */
  public hashLeaf(
    owner: string,
    delegate: string,
    leafIndex: number,
    metadataHash: Buffer,
  ): Buffer {
    const indexBuf = Buffer.alloc(8);
    indexBuf.writeBigUInt64LE(BigInt(leafIndex));

    const hasher = createHash("sha256");
    hasher.update(Buffer.from([0x01])); // Version 1
    hasher.update(Buffer.from(owner.padEnd(32, "0").slice(0, 32)));
    hasher.update(Buffer.from(delegate.padEnd(32, "0").slice(0, 32)));
    hasher.update(
      Buffer.from(this.config.treeAuthority!.padEnd(32, "0").slice(0, 32)),
    );
    hasher.update(indexBuf);
    hasher.update(metadataHash);

    return hasher.digest();
  }

  /**
   * Derives a deterministic assetId for a compressed pass from tree address and leaf index.
   */
  public deriveAssetId(leafIndex: number): string {
    const hasher = createHash("sha256");
    hasher.update(Buffer.from(this.config.treeAddress!));
    const indexBuf = Buffer.alloc(8);
    indexBuf.writeBigUInt64LE(BigInt(leafIndex));
    hasher.update(indexBuf);
    return `cPass-${hasher.digest("hex").slice(0, 32)}`;
  }

  /**
   * Mints a compressed NFT pass into the concurrent Merkle tree.
   */
  public async mintPass(
    owner: string,
    metadata: PassMetadata,
    delegate?: string,
  ): Promise<{ asset: CompressedPassAsset; proof: MerkleProof }> {
    if (this.nextLeafIndex >= this.getCapacity()) {
      throw new Error(
        `Merkle tree is full! Maximum capacity of ${this.getCapacity()} reached.`,
      );
    }

    const leafIndex = this.nextLeafIndex++;
    const effectiveDelegate = delegate || owner;
    const metaHash = this.hashMetadata(metadata);
    const leafHashBuf = this.hashLeaf(
      owner,
      effectiveDelegate,
      leafIndex,
      metaHash,
    );

    this.leaves.set(leafIndex, leafHashBuf);
    this.currentRoot = this.recomputeRoot();

    const assetId = this.deriveAssetId(leafIndex);
    const asset: CompressedPassAsset = {
      assetId,
      leafIndex,
      leafHash: leafHashBuf.toString("hex"),
      owner,
      delegate: effectiveDelegate,
      metadata: { ...metadata },
      mintedAt: Date.now(),
      status: "ACTIVE",
    };

    this.assets.set(assetId, asset);
    this.leafToAssetId.set(leafIndex, assetId);

    const proof = this.getProofForLeaf(leafIndex);

    return { asset, proof };
  }

  /**
   * Transfers ownership of a compressed pass by updating the Merkle tree leaf.
   */
  public async transferPass(
    assetId: string,
    currentOwner: string,
    newOwner: string,
    proofHashes: string[],
  ): Promise<{ updatedAsset: CompressedPassAsset; newRoot: string }> {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found.`);
    if (asset.owner !== currentOwner) {
      throw new Error(
        `Unauthorized transfer: caller ${currentOwner} is not the owner.`,
      );
    }
    if (asset.status !== "ACTIVE") {
      throw new Error(`Cannot transfer asset in status ${asset.status}.`);
    }

    // Verify incoming proof
    const isValid = this.verifyProof(
      asset.leafHash,
      proofHashes,
      asset.leafIndex,
      this.getRoot(),
    );
    if (!isValid) throw new Error("Invalid Merkle proof for transfer.");

    // Generate updated leaf hash
    const metaHash = this.hashMetadata(asset.metadata);
    const newLeafBuf = this.hashLeaf(
      newOwner,
      newOwner,
      asset.leafIndex,
      metaHash,
    );

    // Update state
    this.leaves.set(asset.leafIndex, newLeafBuf);
    this.currentRoot = this.recomputeRoot();

    asset.owner = newOwner;
    asset.delegate = newOwner;
    asset.leafHash = newLeafBuf.toString("hex");
    asset.status = "ACTIVE";

    return {
      updatedAsset: asset,
      newRoot: this.getRoot(),
    };
  }

  /**
   * Burns a compressed pass, setting its leaf hash to zero buffer and revoking access.
   */
  public async burnPass(
    assetId: string,
    owner: string,
    proofHashes: string[],
  ): Promise<{ newRoot: string }> {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found.`);
    if (asset.owner !== owner) {
      throw new Error(`Unauthorized burn: caller ${owner} is not the owner.`);
    }
    if (asset.status !== "ACTIVE") {
      throw new Error(`Cannot burn asset in status ${asset.status}.`);
    }

    const isValid = this.verifyProof(
      asset.leafHash,
      proofHashes,
      asset.leafIndex,
      this.getRoot(),
    );
    if (!isValid) throw new Error("Invalid Merkle proof for burn.");

    // Set to 32 zero bytes
    const zeroLeaf = Buffer.alloc(32, 0);
    this.leaves.set(asset.leafIndex, zeroLeaf);
    this.currentRoot = this.recomputeRoot();

    asset.status = "BURNED";
    asset.leafHash = zeroLeaf.toString("hex");

    return { newRoot: this.getRoot() };
  }

  /**
   * Verifies an asset proof and authorizes check-in. A proof is always checked
   * against the current root; cached canopy data only supplies omitted siblings.
   */
  public async checkInPass(
    assetId: string,
    proof: MerkleProof,
    provider?: CanopyProvider,
  ): Promise<CheckInResult> {
    const asset = this.assets.get(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found.`);
    if (asset.status !== "ACTIVE") {
      throw new Error(`Cannot check in asset in status ${asset.status}.`);
    }
    if (proof.leaf !== asset.leafHash || proof.index !== asset.leafIndex) {
      throw new Error("Proof does not match the requested asset.");
    }
    if (!(await this.verifyProofWithCanopy(proof, provider))) {
      throw new Error("Invalid Merkle proof for check-in.");
    }
    return { asset, root: this.getRoot() };
  }

  /**
   * Generates the sibling proof path for a specific leaf index.
   */
  public getProofForLeaf(leafIndex: number): MerkleProof {
    const leafBuf = this.leaves.get(leafIndex) || Buffer.alloc(32, 0);
    const proof: string[] = [];
    const depth = this.config.maxDepth;

    let currentIndex = leafIndex;
    // Build level nodes
    let currentLevel: Map<number, Buffer> = new Map(this.leaves);

    for (let d = 0; d < depth; d++) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

      const siblingHash =
        currentLevel.get(siblingIndex) || this.computeEmptySubtree(d);
      proof.push(siblingHash.toString("hex"));

      // Advance to next parent level
      const nextLevel: Map<number, Buffer> = new Map();
      const parentIndices = new Set<number>();
      for (const idx of currentLevel.keys()) {
        parentIndices.add(Math.floor(idx / 2));
      }
      parentIndices.add(Math.floor(currentIndex / 2));

      for (const pIdx of parentIndices) {
        const left = currentLevel.get(pIdx * 2) || this.computeEmptySubtree(d);
        const right =
          currentLevel.get(pIdx * 2 + 1) || this.computeEmptySubtree(d);
        const parentHash = this.hashNodes(left, right);
        nextLevel.set(pIdx, parentHash);
      }

      currentLevel = nextLevel;
      currentIndex = Math.floor(currentIndex / 2);
    }

    return {
      root: this.getRoot(),
      leaf: leafBuf.toString("hex"),
      index: leafIndex,
      proof,
    };
  }

  /**
   * Verifies that a given leaf and proof reconstruct the specified root.
   */
  public verifyProof(
    leafHex: string,
    proofHex: string[],
    leafIndex: number,
    rootHex: string,
  ): boolean {
    if (!this.isHashHex(leafHex) || !this.isHashHex(rootHex) ||
        !Number.isSafeInteger(leafIndex) || leafIndex < 0 || leafIndex >= this.getCapacity() ||
        !Array.isArray(proofHex) || proofHex.length !== this.config.maxDepth ||
        proofHex.some(hash => !this.isHashHex(hash))) {
      return false;
    }

    let current = Buffer.from(leafHex, "hex");
    let index = leafIndex;

    for (const siblingHex of proofHex) {
      const sibling = Buffer.from(siblingHex, "hex");
      const isRight = index % 2 === 1;
      current = isRight
        ? this.hashNodes(sibling, current)
        : this.hashNodes(current, sibling);
      index = Math.floor(index / 2);
    }

    return current.toString("hex") === rootHex;
  }

  /** Verifies either a full proof or a proof completed from a validated canopy snapshot. */
  public verifyProofWithCanopy(
    proof: MerkleProof,
    canopy?: CanopySnapshot,
  ): boolean {
    if (!proof || !Array.isArray(proof.proof) || !this.isHashHex(proof.leaf) || !this.isHashHex(proof.root) ||
        !Number.isSafeInteger(proof.index) || proof.index < 0 || proof.index >= this.getCapacity()) {
      return false;
    }
    if (proof.proof.length === this.config.maxDepth) {
      return this.verifyProof(proof.leaf, proof.proof, proof.index, proof.root) &&
        proof.root === this.getRoot();
    }

    const truncatedLength = this.config.maxDepth - this.config.canopyDepth;
    if (proof.proof.length !== truncatedLength || !canopy || !Array.isArray(canopy.nodes) ||
        canopy.treeAddress !== this.config.treeAddress ||
        canopy.root !== proof.root || canopy.root !== this.getRoot() ||
        canopy.maxDepth !== this.config.maxDepth ||
        canopy.canopyDepth !== this.config.canopyDepth ||
        canopy.nodes.some(node => !this.isHashHex(node.hash) ||
          !Number.isSafeInteger(node.level) || !Number.isSafeInteger(node.index))) {
      return false;
    }

    const nodes = new Map(canopy.nodes.map(node => [`${node.level}:${node.index}`, node.hash]));
    let current = Buffer.from(proof.leaf, "hex");
    let index = proof.index;
    for (let level = 0; level < truncatedLength; level++) {
      const sibling = Buffer.from(proof.proof[level], "hex");
      current = index % 2 === 1
        ? this.hashNodes(sibling, current)
        : this.hashNodes(current, sibling);
      index = Math.floor(index / 2);
    }
    for (let level = truncatedLength; level < this.config.maxDepth; level++) {
      const siblingIndex = index % 2 === 1 ? index - 1 : index + 1;
      const siblingHex = nodes.get(`${level}:${siblingIndex}`);
      if (!siblingHex) return false;
      const sibling = Buffer.from(siblingHex, "hex");
      current = index % 2 === 1
        ? this.hashNodes(sibling, current)
        : this.hashNodes(current, sibling);
      index = Math.floor(index / 2);
    }
    return current.toString("hex") === proof.root;
  }

  /** Fetches and caches canopy data by tree identity and root, coalescing concurrent misses. */
  public async getCanopySnapshot(
    root: string = this.getRoot(),
    provider?: CanopyProvider,
  ): Promise<CanopySnapshot | undefined> {
    if (!provider || !this.isHashHex(root)) return undefined;
    const key = this.canopyCacheKey(root);
    const cached = this.canopyCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
    this.canopyCache.delete(key);
    const existing = this.canopyRequests.get(key);
    if (existing) return existing;

    const request = provider.fetchCanopy({
      treeAddress: this.config.treeAddress!,
      root,
      maxDepth: this.config.maxDepth,
      canopyDepth: this.config.canopyDepth,
    }).then(snapshot => {
      if (!this.isValidCanopySnapshot(snapshot, root)) {
        throw new Error("Incomplete or malformed canopy response.");
      }
      this.canopyCache.set(key, { snapshot, expiresAt: Date.now() + this.canopyTtlMs });
      return snapshot;
    }).finally(() => {
      this.canopyRequests.delete(key);
    });
    this.canopyRequests.set(key, request);
    return request;
  }

  /** Verifies a truncated proof after obtaining the current-root canopy on demand. */
  public async verifyProofWithCachedCanopy(
    proof: MerkleProof,
    provider?: CanopyProvider,
  ): Promise<boolean> {
    if (!proof || !Array.isArray(proof.proof)) return false;
    if (proof.proof.length === this.config.maxDepth) return this.verifyProofWithCanopy(proof);
    try {
      const snapshot = await this.getCanopySnapshot(proof.root, provider);
      return snapshot ? this.verifyProofWithCanopy(proof, snapshot) : false;
    } catch {
      return false;
    }
  }

  /**
   * Constructs a serializable Bubblegum instruction for on-chain execution.
   */
  public buildBubblegumInstruction(
    action: "mintV1" | "transfer" | "burn",
    params: {
      payer: string;
      owner: string;
      metadata?: PassMetadata;
      assetId?: string;
      newOwner?: string;
      proof?: string[];
    },
  ): BubblegumInstructionPayload {
    const accounts = [
      { pubkey: this.config.treeAuthority!, isSigner: false, isWritable: true },
      { pubkey: params.payer, isSigner: true, isWritable: true },
      { pubkey: params.owner, isSigner: false, isWritable: false },
      { pubkey: this.config.treeAddress!, isSigner: false, isWritable: true },
      {
        pubkey: CompressedDeskPassMinter.SPL_COMPRESSION_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: CompressedDeskPassMinter.BUBBLEGUM_PROGRAM_ID,
        isSigner: false,
        isWritable: false,
      },
    ];

    let actionCode = 0x01; // mintV1
    if (action === "transfer") actionCode = 0x02;
    if (action === "burn") actionCode = 0x03;

    const data = Buffer.concat([
      Buffer.from([actionCode]),
      Buffer.from(JSON.stringify(params)),
    ]);

    return {
      programId: CompressedDeskPassMinter.BUBBLEGUM_PROGRAM_ID,
      action,
      accounts,
      data,
    };
  }

  /**
   * Retrieves an asset by ID.
   */
  public getPass(assetId: string): CompressedPassAsset | undefined {
    return this.assets.get(assetId);
  }

  // --- Private Helper Methods ---

  private hashNodes(left: Buffer, right: Buffer): Buffer {
    return Buffer.from(keccak_256.arrayBuffer(Buffer.concat([left, right])));
  }

  private isHashHex(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
  }

  private canopyCacheKey(root: string): string {
    return `${this.config.treeAddress}:${this.config.maxDepth}:${this.config.canopyDepth}:${root}`;
  }

  private isValidCanopySnapshot(snapshot: CanopySnapshot, root: string): boolean {
    if (!snapshot || snapshot.treeAddress !== this.config.treeAddress || snapshot.root !== root ||
        snapshot.maxDepth !== this.config.maxDepth || snapshot.canopyDepth !== this.config.canopyDepth ||
        !Array.isArray(snapshot.nodes) ||
        (this.config.canopyDepth > 0 && snapshot.nodes.length === 0)) return false;
    const maxCanopyLevel = this.config.maxDepth - this.config.canopyDepth;
    const seen = new Set<string>();
    for (const node of snapshot.nodes) {
      if (!Number.isSafeInteger(node.level) || node.level < maxCanopyLevel || node.level >= this.config.maxDepth ||
          !Number.isSafeInteger(node.index) || node.index < 0 || !this.isHashHex(node.hash)) return false;
      const key = `${node.level}:${node.index}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  }

  private computeEmptySubtree(depth: number): Buffer {
    let node = Buffer.alloc(32, 0);
    for (let i = 0; i < depth; i++) {
      node = this.hashNodes(node, node);
    }
    return node;
  }

  private computeEmptyRoot(maxDepth: number): Buffer {
    return this.computeEmptySubtree(maxDepth);
  }

  private recomputeRoot(): Buffer {
    if (this.leaves.size === 0) {
      return this.computeEmptyRoot(this.config.maxDepth);
    }

    let currentLevel = new Map<number, Buffer>(this.leaves);
    const depth = this.config.maxDepth;

    for (let d = 0; d < depth; d++) {
      const nextLevel = new Map<number, Buffer>();
      const parentIndices = new Set<number>();
      for (const idx of currentLevel.keys()) {
        parentIndices.add(Math.floor(idx / 2));
      }

      for (const pIdx of parentIndices) {
        const left = currentLevel.get(pIdx * 2) || this.computeEmptySubtree(d);
        const right =
          currentLevel.get(pIdx * 2 + 1) || this.computeEmptySubtree(d);
        nextLevel.set(pIdx, this.hashNodes(left, right));
      }

      currentLevel = nextLevel;
    }

    return currentLevel.get(0) || this.computeEmptyRoot(this.config.maxDepth);
  }
}
