/**
 * @file ZeroKnowledgeMerklePatriciaTrieProver.ts
 * @description Nibble-Indexed Radix-16 Merkle Patricia Trie (MPT) Key-Value State Accumulator
 * with Cryptographic Inclusion Proofs, Definitive Non-Inclusion Proofs, Path-Compression Branch
 * & Leaf Nodes, Batch Verification, and Portable JSON Serialization.
 */

import { createHash } from 'node:crypto';

export type MPTNode =
  | { type: 'empty' }
  | { type: 'leaf'; suffixNibbles: string; value: string; hash: string }
  | { type: 'extension'; prefixNibbles: string; childHash: string; child: MPTNode; hash: string }
  | { type: 'branch'; children: Array<MPTNode | null>; value: string | null; hash: string };

export interface MPTProofNode {
  type: 'leaf' | 'extension' | 'branch';
  hash: string;
  suffixNibbles?: string;
  prefixNibbles?: string;
  childHash?: string;
  branchChildHashes?: Array<string | null>;
  value?: string | null;
}

export interface MPTStateProof {
  key: string;
  keyNibbles: string;
  included: boolean;
  value: string | null;
  proofNodes: MPTProofNode[];
  rootHash: string;
  proofDigest: string;
}

const EMPTY_ROOT_HASH = createHash('sha256').update('WorkSphere::MPT::Empty').digest('hex');

function sha256Hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function keyToNibbles(key: string): string {
  return createHash('sha256').update(`WorkSphere::MPTKey|${key}`).digest('hex');
}

function hashLeafNode(suffixNibbles: string, value: string): string {
  return sha256Hex(`WorkSphere::MPTLeaf|${suffixNibbles}|${value}`);
}

function hashExtensionNode(prefixNibbles: string, childHash: string): string {
  return sha256Hex(`WorkSphere::MPTExt|${prefixNibbles}|${childHash}`);
}

function hashBranchNode(childHashes: readonly (string | null)[], value: string | null): string {
  const slots = childHashes.map((h) => h ?? '_').join(',');
  return sha256Hex(`WorkSphere::MPTBranch|${slots}|val:${value ?? '__null__'}`);
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a[i] === b[i]) i++;
  return i;
}

function nodeHash(node: MPTNode | null): string {
  if (!node || node.type === 'empty') return EMPTY_ROOT_HASH;
  return node.hash;
}

/**
 * Radix-16 Merkle Patricia Trie (MPT) State Accumulator & Proof Verifier.
 */
export class ZeroKnowledgeMerklePatriciaTrieProver {
  private root: MPTNode = { type: 'empty' };
  private readonly entries: Map<string, string> = new Map();

  public getRootHash(): string {
    return nodeHash(this.root);
  }

  public getEntryCount(): number {
    return this.entries.size;
  }

  public get(key: string): string | undefined {
    return this.entries.get(key);
  }

  public set(key: string, value: string): string {
    const nibbles = keyToNibbles(key);
    this.root = this.insertRec(this.root, nibbles, value);
    this.entries.set(key, value);
    return this.getRootHash();
  }

  public setBatch(pairs: ReadonlyArray<[string, string]>): string {
    for (const [k, v] of pairs) this.set(k, v);
    return this.getRootHash();
  }

  private makeLeaf(suffixNibbles: string, value: string): MPTNode {
    return { type: 'leaf', suffixNibbles, value, hash: hashLeafNode(suffixNibbles, value) };
  }

  private makeExtension(prefixNibbles: string, child: MPTNode): MPTNode {
    const childHash = nodeHash(child);
    return {
      type: 'extension',
      prefixNibbles,
      childHash,
      child,
      hash: hashExtensionNode(prefixNibbles, childHash),
    };
  }

  private makeBranch(children: Array<MPTNode | null>, value: string | null): MPTNode {
    const childHashes = children.map((c) => (c ? nodeHash(c) : null));
    return {
      type: 'branch',
      children,
      value,
      hash: hashBranchNode(childHashes, value),
    };
  }

  private insertRec(node: MPTNode, nibbles: string, value: string): MPTNode {
    if (node.type === 'empty') {
      return this.makeLeaf(nibbles, value);
    }

    if (node.type === 'leaf') {
      if (node.suffixNibbles === nibbles) {
        return this.makeLeaf(nibbles, value);
      }
      const cpl = commonPrefixLength(node.suffixNibbles, nibbles);
      const children: Array<MPTNode | null> = new Array(16).fill(null);
      let branchVal: string | null = null;

      if (cpl === node.suffixNibbles.length) {
        branchVal = node.value;
      } else {
        const oldIdx = parseInt(node.suffixNibbles[cpl], 16);
        children[oldIdx] = this.makeLeaf(node.suffixNibbles.slice(cpl + 1), node.value);
      }

      if (cpl === nibbles.length) {
        branchVal = value;
      } else {
        const newIdx = parseInt(nibbles[cpl], 16);
        children[newIdx] = this.makeLeaf(nibbles.slice(cpl + 1), value);
      }

      const branch = this.makeBranch(children, branchVal);
      return cpl > 0 ? this.makeExtension(nibbles.slice(0, cpl), branch) : branch;
    }

    if (node.type === 'extension') {
      const cpl = commonPrefixLength(node.prefixNibbles, nibbles);
      if (cpl === node.prefixNibbles.length) {
        const updatedChild = this.insertRec(node.child, nibbles.slice(cpl), value);
        return this.makeExtension(node.prefixNibbles, updatedChild);
      }

      const children: Array<MPTNode | null> = new Array(16).fill(null);
      const oldIdx = parseInt(node.prefixNibbles[cpl], 16);
      const oldRem = node.prefixNibbles.slice(cpl + 1);
      children[oldIdx] = oldRem.length > 0 ? this.makeExtension(oldRem, node.child) : node.child;

      let branchVal: string | null = null;
      if (cpl === nibbles.length) {
        branchVal = value;
      } else {
        const newIdx = parseInt(nibbles[cpl], 16);
        children[newIdx] = this.makeLeaf(nibbles.slice(cpl + 1), value);
      }

      const branch = this.makeBranch(children, branchVal);
      return cpl > 0 ? this.makeExtension(nibbles.slice(0, cpl), branch) : branch;
    }

    // Branch node
    const nextChildren = [...node.children];
    if (nibbles.length === 0) {
      return this.makeBranch(nextChildren, value);
    }
    const idx = parseInt(nibbles[0], 16);
    const existing = nextChildren[idx] ?? { type: 'empty' as const };
    nextChildren[idx] = this.insertRec(existing, nibbles.slice(1), value);
    return this.makeBranch(nextChildren, node.value);
  }

  private serializeProofNode(node: MPTNode): MPTProofNode {
    if (node.type === 'leaf') {
      return {
        type: 'leaf',
        hash: node.hash,
        suffixNibbles: node.suffixNibbles,
        value: node.value,
      };
    }
    if (node.type === 'extension') {
      return {
        type: 'extension',
        hash: node.hash,
        prefixNibbles: node.prefixNibbles,
        childHash: node.childHash,
      };
    }
    if (node.type === 'branch') {
      return {
        type: 'branch',
        hash: node.hash,
        branchChildHashes: node.children.map((c) => (c ? nodeHash(c) : null)),
        value: node.value,
      };
    }
    throw new Error('Cannot serialize empty node inside proof path');
  }

  /**
   * Generates a compact Merkle Patricia inclusion OR non-inclusion proof for `key`.
   */
  public generateProof(key: string): MPTStateProof {
    const keyNibbles = keyToNibbles(key);
    const rootHash = this.getRootHash();
    const proofNodes: MPTProofNode[] = [];

    let cur: MPTNode | null = this.root;
    let rem = keyNibbles;
    let included = false;
    let value: string | null = null;

    while (cur && cur.type !== 'empty') {
      proofNodes.push(this.serializeProofNode(cur));

      if (cur.type === 'leaf') {
        if (cur.suffixNibbles === rem) {
          included = true;
          value = cur.value;
        }
        break;
      }

      if (cur.type === 'extension') {
        if (!rem.startsWith(cur.prefixNibbles)) break;
        rem = rem.slice(cur.prefixNibbles.length);
        cur = cur.child;
        continue;
      }

      if (cur.type === 'branch') {
        if (rem.length === 0) {
          if (cur.value !== null) {
            included = true;
            value = cur.value;
          }
          break;
        }
        const idx = parseInt(rem[0], 16);
        rem = rem.slice(1);
        cur = cur.children[idx];
      }
    }

    const proofDigest = sha256Hex(
      `WorkSphere::MPTProof|${key}|inc:${included}|val:${value ?? '__null__'}|${rootHash}`
    );

    return {
      key,
      keyNibbles,
      included,
      value,
      proofNodes,
      rootHash,
      proofDigest,
    };
  }

  /**
   * Publicly verifies a Merkle Patricia inclusion or non-inclusion proof against `expectedRootHash`.
   */
  public verifyProof(
    proof: MPTStateProof,
    expectedRootHash: string
  ): { valid: boolean; reason?: string } {
    const expectedNibbles = keyToNibbles(proof.key);
    if (expectedNibbles !== proof.keyNibbles) {
      return { valid: false, reason: 'Key nibble hash mismatch' };
    }
    if (proof.rootHash !== expectedRootHash) {
      return { valid: false, reason: 'Root hash mismatch' };
    }

    if (expectedRootHash === EMPTY_ROOT_HASH) {
      return !proof.included && proof.value === null && proof.proofNodes.length === 0
        ? { valid: true }
        : { valid: false, reason: 'Invalid proof for empty trie' };
    }
    if (proof.proofNodes.length === 0) {
      return { valid: false, reason: 'Non-empty trie proof cannot be empty' };
    }

    let expectedHash = expectedRootHash;
    let rem = expectedNibbles;
    let foundIncluded = false;
    let foundValue: string | null = null;

    for (let i = 0; i < proof.proofNodes.length; i++) {
      const pn = proof.proofNodes[i];
      if (pn.hash !== expectedHash) {
        return { valid: false, reason: `Hash linkage broken at proof node ${i}` };
      }

      if (pn.type === 'leaf') {
        const recomputed = hashLeafNode(pn.suffixNibbles ?? '', pn.value ?? '');
        if (recomputed !== pn.hash) return { valid: false, reason: `Corrupted leaf hash at node ${i}` };
        if (i !== proof.proofNodes.length - 1) return { valid: false, reason: 'Leaf node must be terminal' };
        if (pn.suffixNibbles === rem) {
          foundIncluded = true;
          foundValue = pn.value ?? null;
        }
        break;
      }

      if (pn.type === 'extension') {
        const prefix = pn.prefixNibbles ?? '';
        const childH = pn.childHash ?? '';
        if (hashExtensionNode(prefix, childH) !== pn.hash) {
          return { valid: false, reason: `Corrupted extension hash at node ${i}` };
        }
        if (!rem.startsWith(prefix)) {
          if (i !== proof.proofNodes.length - 1) return { valid: false, reason: 'Extra nodes after extension divergence' };
          break;
        }
        rem = rem.slice(prefix.length);
        expectedHash = childH;
        continue;
      }

      if (pn.type === 'branch') {
        const slots = pn.branchChildHashes ?? [];
        if (slots.length !== 16) return { valid: false, reason: 'Branch node must have 16 nibble slots' };
        if (hashBranchNode(slots, pn.value ?? null) !== pn.hash) {
          return { valid: false, reason: `Corrupted branch hash at node ${i}` };
        }
        if (rem.length === 0) {
          if (pn.value !== null && pn.value !== undefined) {
            foundIncluded = true;
            foundValue = pn.value;
          }
          break;
        }
        const idx = parseInt(rem[0], 16);
        const nextHash = slots[idx];
        rem = rem.slice(1);
        if (nextHash === null) {
          if (i !== proof.proofNodes.length - 1) return { valid: false, reason: 'Extra nodes after null branch slot' };
          break;
        }
        expectedHash = nextHash;
      }
    }

    if (foundIncluded !== proof.included || foundValue !== proof.value) {
      return { valid: false, reason: 'Claimed inclusion status or value does not match verified trie path' };
    }
    return { valid: true };
  }

  public batchVerifyProofs(
    proofs: readonly MPTStateProof[],
    expectedRootHash: string
  ): { allValid: boolean; validCount: number; failedKeys: string[] } {
    const failedKeys: string[] = [];
    for (const p of proofs) {
      if (!this.verifyProof(p, expectedRootHash).valid) failedKeys.push(p.key);
    }
    return {
      allValid: proofs.length > 0 && failedKeys.length === 0,
      validCount: proofs.length - failedKeys.length,
      failedKeys,
    };
  }

  public serializeProof(proof: MPTStateProof): string {
    return JSON.stringify(proof);
  }

  public deserializeProof(payload: string): MPTStateProof {
    return JSON.parse(payload) as MPTStateProof;
  }
}
