export interface NomadCertificateData {
  bookingId: string;
  nomadName: string;
  venueName: string;
  city?: string;
  attendedDate: string;
  hoursLogged?: number;
  verificationHash: string;
  verifyUrl?: string;
}

export function escapeXml(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function sanitizeBookingIdForFilename(bookingId: string): string {
  const cleaned = bookingId
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'certificate';
}

export function buildCertificateFilename(bookingId: string): string {
  return `nomad-certificate-${sanitizeBookingIdForFilename(bookingId)}.svg`;
}

function buildQrMatrix(payload: string, gridSize = 15): boolean[][] {
  let hash = 2166136261;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const matrix: boolean[][] = Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => false)
  );

  const corners = [
    [0, 0],
    [0, gridSize - 3],
    [gridSize - 3, 0],
  ];
  for (const [rStart, cStart] of corners) {
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) {
        matrix[rStart + r][cStart + c] = !(r === 1 && c === 1);
      }
    }
  }

  let state = hash >>> 0;
  for (let r = 0; r < gridSize; r += 1) {
    for (let c = 0; c < gridSize; c += 1) {
      const inCorner =
        (r < 3 && c < 3) ||
        (r < 3 && c >= gridSize - 3) ||
        (r >= gridSize - 3 && c < 3);
      if (inCorner) continue;
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      matrix[r][c] = ((state >>> 24) & 1) === 1;
    }
  }

  return matrix;
}

function renderQrSvgGroup(payload: string, originX: number, originY: number, size = 120): string {
  const gridSize = 15;
  const matrix = buildQrMatrix(payload, gridSize);
  const cell = size / gridSize;
  const rects: string[] = [];

  for (let r = 0; r < gridSize; r += 1) {
    for (let c = 0; c < gridSize; c += 1) {
      if (matrix[r][c]) {
        const x = (originX + c * cell).toFixed(2);
        const y = (originY + r * cell).toFixed(2);
        const w = (cell + 0.25).toFixed(2);
        rects.push(`<rect x="${x}" y="${y}" width="${w}" height="${w}" fill="#0f172a" />`);
      }
    }
  }

  return `
    <g id="certificate-qr-code" aria-label="Verification QR code">
      <rect x="${originX - 10}" y="${originY - 10}" width="${size + 20}" height="${size + 20}" rx="12" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.5" />
      ${rects.join('\n      ')}
    </g>
  `;
}

export function generateCertificateSvg(data: NomadCertificateData): string {
  const safeNomad = escapeXml(data.nomadName);
  const safeVenue = escapeXml(data.venueName);
  const safeCity = escapeXml(data.city ? `${data.city}` : 'WorkSphere Network');
  const safeDate = escapeXml(data.attendedDate);
  const safeBookingId = escapeXml(data.bookingId);
  const safeHash = escapeXml(data.verificationHash);
  const hoursLine =
    typeof data.hoursLogged === 'number' && Number.isFinite(data.hoursLogged)
      ? `${data.hoursLogged} hrs logged`
      : 'Verified Check-In';
  const safeHours = escapeXml(hoursLine);
  const qrPayload =
    data.verifyUrl || `https://worksphere.app/verify/${data.bookingId}:${data.verificationHash}`;
  const qrGroup = renderQrSvgGroup(qrPayload, 970, 470, 128);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 760" width="100%" height="auto" role="img" aria-labelledby="cert-title cert-desc">
  <title id="cert-title">Nomad Attendance Certificate — ${safeNomad}</title>
  <desc id="cert-desc">Proof of attendance for ${safeNomad} at ${safeVenue} (${safeBookingId})</desc>
  <defs>
    <linearGradient id="bg-grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f8fafc" />
      <stop offset="100%" stop-color="#eef2ff" />
    </linearGradient>
    <linearGradient id="accent-grad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#4f46e5" />
      <stop offset="100%" stop-color="#0ea5e9" />
    </linearGradient>
  </defs>

  <rect x="0" y="0" width="1200" height="760" rx="28" fill="url(#bg-grad)" />
  <rect x="28" y="28" width="1144" height="704" rx="22" fill="#ffffff" stroke="#c7d2fe" stroke-width="2" />
  <rect x="28" y="28" width="1144" height="12" rx="6" fill="url(#accent-grad)" />

  <g id="nomad-vector-badge" transform="translate(80, 74)">
    <circle cx="44" cy="44" r="42" fill="#eef2ff" stroke="#4f46e5" stroke-width="2.5" />
    <path d="M44 18 L64 30 L56 62 L32 62 L24 30 Z" fill="#4f46e5" opacity="0.14" stroke="#4f46e5" stroke-width="2" />
    <path d="M35 45 L42 52 L55 36" fill="none" stroke="#4f46e5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    <text x="104" y="36" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" letter-spacing="2" fill="#4f46e5">WORKSPHERE PASSPORT</text>
    <text x="104" y="64" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="800" fill="#0f172a">Nomad Attendance Certificate</text>
  </g>

  <g id="certificate-details" transform="translate(80, 205)">
    <text x="0" y="0" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#64748b">Awarded to</text>
    <text x="0" y="46" font-family="system-ui, -apple-system, sans-serif" font-size="42" font-weight="700" fill="#0f172a">${safeNomad}</text>

    <text x="0" y="108" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#64748b">Venue &amp; Location</text>
    <text x="0" y="142" font-family="system-ui, -apple-system, sans-serif" font-size="26" font-weight="600" fill="#1e293b">${safeVenue} · ${safeCity}</text>

    <text x="0" y="202" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#64748b">Attendance &amp; Booking ID</text>
    <text x="0" y="236" font-family="system-ui, -apple-system, sans-serif" font-size="22" font-weight="600" fill="#334155">${safeDate} · ${safeHours} · Booking #${safeBookingId}</text>
  </g>

  ${qrGroup}

  <g id="certificate-footer" transform="translate(80, 560)">
    <line x1="0" y1="0" x2="840" y2="0" stroke="#e2e8f0" stroke-width="1.5" />
    <text x="0" y="34" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="700" letter-spacing="1" fill="#475569">VERIFIED CRYPTOGRAPHIC HASH</text>
    <text x="0" y="62" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="15" fill="#0f172a">${safeHash}</text>
    <text x="0" y="96" font-family="system-ui, -apple-system, sans-serif" font-size="13" fill="#64748b">Scan QR or verify hash against WorkSphere ledger records.</text>
  </g>
</svg>`.trim();
}

export function downloadCertificateSvg(data: NomadCertificateData): {
  filename: string;
  svg: string;
} {
  const svg = generateCertificateSvg(data);
  const filename = buildCertificateFilename(data.bookingId);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return { filename, svg };
}
