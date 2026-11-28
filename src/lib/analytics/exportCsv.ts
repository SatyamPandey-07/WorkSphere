export interface FootTrafficPoint {
  date: string;
  hour: string | number;
  occupancyCount: number;
  capacityPercentage: number;
  deskTurnoverRate: number;
}

const CSV_HEADERS = [
  'Date',
  'Hour',
  'OccupancyCount',
  'CapacityPercentage',
  'DeskTurnoverRate',
] as const;

const FORMULA_PREFIX_REGEX = /^[=+\-@\t\r]/;

export function sanitizeCsvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const neutralized = FORMULA_PREFIX_REGEX.test(raw) ? `'${raw}` : raw;

  if (
    neutralized.includes(',') ||
    neutralized.includes('"') ||
    neutralized.includes('\n') ||
    neutralized.includes('\r')
  ) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  return neutralized;
}

export function buildFootTrafficCsv(trafficData: FootTrafficPoint[]): string {
  const headerLine = CSV_HEADERS.join(',');
  const rows = trafficData.map((row) =>
    [
      sanitizeCsvCell(row.date),
      sanitizeCsvCell(row.hour),
      sanitizeCsvCell(row.occupancyCount),
      sanitizeCsvCell(row.capacityPercentage),
      sanitizeCsvCell(row.deskTurnoverRate),
    ].join(',')
  );

  return [headerLine, ...rows].join('\n');
}

export function buildCsvFilename(venueName: string, now: Date = new Date()): string {
  const slug =
    venueName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'venue';
  const dateStamp = now.toISOString().slice(0, 10);
  return `${slug}-foot-traffic-${dateStamp}.csv`;
}

export function exportFootTrafficToCsv(
  trafficData: FootTrafficPoint[],
  venueName = 'venue',
  now: Date = new Date()
): { csv: string; filename: string } {
  const csv = buildFootTrafficCsv(trafficData);
  const filename = buildCsvFilename(venueName, now);

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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

  return { csv, filename };
}
