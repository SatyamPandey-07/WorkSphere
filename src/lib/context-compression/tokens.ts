/**
 * Client-safe token estimation utility for WorkSphere conversation context.
 * Approximate estimation: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
