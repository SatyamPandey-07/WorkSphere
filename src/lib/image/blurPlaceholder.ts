/**
 * Lightweight SVG micro-gradient placeholder generator for venue photo cards (#3774)
 * Generates instant, colorful blur placeholders with zero external runtime dependencies.
 */

/**
 * Deterministically generates two harmonious RGB colors from a string (hash or seed).
 */
function hashToColors(str: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }

  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 45) % 360;

  return [
    `hsl(${h1}, 45%, 65%)`,
    `hsl(${h2}, 55%, 45%)`,
  ];
}

/**
 * Creates an inline SVG micro-gradient data URI to use as a lightweight placeholder
 * for next/image or fallback backgrounds.
 */
export function generateBlurSvgDataUri(seedOrBlurhash?: string | null): string {
  const seed = seedOrBlurhash && seedOrBlurhash.trim().length > 0 ? seedOrBlurhash.trim() : "worksphere-venue";
  const [c1, c2] = hashToColors(seed);
  let suffix = 0;
  for (let i = 0; i < seed.length; i++) {
    suffix = (suffix * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const gid = `g${suffix.toString(36)}`;
  const fid = `b${suffix.toString(36)}`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200" width="100%" height="100%">
    <defs>
      <linearGradient id="${gid}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c1}" />
        <stop offset="100%" stop-color="${c2}" />
      </linearGradient>
      <filter id="${fid}">
        <feGaussianBlur stdDeviation="20" />
      </filter>
    </defs>
    <rect width="100%" height="100%" fill="url(#${gid})" filter="url(#${fid})" />
  </svg>`.replace(/\s+/g, " ").trim();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
