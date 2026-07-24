import crypto from "crypto";

// Simulated database of revoked credential hashes
export const REVOKED_CREDENTIAL_HASHES: string[] = [
  "12345678901234567890", // dummy
  "15241578750190521", // if student id is 12345678 => 12345678^2 + 5*12345678 + 17 = 15241578750190521
];

export function hashPair(left: string, right: string): string {
  const [a, b] = [left, right].sort();
  return crypto
    .createHash("sha256")
    .update(a + b)
    .digest("hex");
}

export function buildMerkleTree(leaves: string[]): {
  root: string;
  tree: string[][];
} {
  if (leaves.length === 0) {
    return {
      root: crypto.createHash("sha256").update("empty").digest("hex"),
      tree: [],
    };
  }

  let currentLevel = leaves.map((l) =>
    crypto.createHash("sha256").update(l).digest("hex"),
  );
  const tree = [currentLevel];

  while (currentLevel.length > 1) {
    const nextLevel = [];
    for (let i = 0; i < currentLevel.length; i += 2) {
      const left = currentLevel[i];
      const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
      nextLevel.push(hashPair(left, right));
    }
    currentLevel = nextLevel;
    tree.push(currentLevel);
  }

  return { root: currentLevel[0], tree };
}

export async function getCurrentMerkleRoot(): Promise<string> {
  const { root } = buildMerkleTree(REVOKED_CREDENTIAL_HASHES);
  return Promise.resolve(root);
}

export function generateWitness(credentialHash: string): string[] {
  const { tree } = buildMerkleTree(REVOKED_CREDENTIAL_HASHES);
  const leafHash = crypto
    .createHash("sha256")
    .update(credentialHash)
    .digest("hex");

  let index = tree[0]?.indexOf(leafHash) ?? -1;
  if (index === -1) return []; // Not revoked

  const witness = [];
  for (let level = 0; level < tree.length - 1; level++) {
    const currentLevel = tree[level];
    const isLeft = index % 2 === 0;
    const siblingIndex = isLeft ? index + 1 : index - 1;

    if (siblingIndex < currentLevel.length) {
      witness.push(currentLevel[siblingIndex]);
    } else {
      witness.push(currentLevel[index]);
    }

    index = Math.floor(index / 2);
  }

  return witness;
}

export function verifyMerkleProof(
  credentialHash: string,
  witness: string[],
  currentRoot: string,
): boolean {
  if (witness.length === 0) {
    const leafHash = crypto
      .createHash("sha256")
      .update(credentialHash)
      .digest("hex");
    return currentRoot === leafHash;
  }

  let currentHash = crypto
    .createHash("sha256")
    .update(credentialHash)
    .digest("hex");
  for (const sibling of witness) {
    currentHash = hashPair(currentHash, sibling);
  }

  return currentHash === currentRoot;
}
