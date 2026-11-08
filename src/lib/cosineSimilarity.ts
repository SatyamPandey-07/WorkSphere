export function cosineSimilarity(
  vecA: Record<string, number> | null | undefined,
  vecB: Record<string, number> | null | undefined,
): number {
  if (!vecA || typeof vecA !== "object" || !vecB || typeof vecB !== "object") {
    return 0;
  }

  const keys = new Set([...Object.keys(vecA), ...Object.keys(vecB)]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const key of keys) {
    const rawA = vecA[key];
    const rawB = vecB[key];
    const valA = typeof rawA === "number" && Number.isFinite(rawA) ? rawA : 0;
    const valB = typeof rawB === "number" && Number.isFinite(rawB) ? rawB : 0;

    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  if (normA === 0 || normB === 0) return 0;

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denominator) || denominator === 0) return 0;

  const similarity = dotProduct / denominator;
  if (!Number.isFinite(similarity)) return 0;

  // Clamp floating point variations strictly within [-1, 1]
  return Math.max(-1, Math.min(1, similarity));
}
