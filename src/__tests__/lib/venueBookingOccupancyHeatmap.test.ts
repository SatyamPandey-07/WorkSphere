/**
 * Tests for venue occupancy heatmap data processing.
 */

interface OccupancyDataPoint {
  dayOfWeek: number;   // 0 = Sun
  hour: number;        // 0-23
  occupancyRate: number; // 0-1
  bookingCount: number;
  revenue: number;
}

interface HeatmapCell {
  dayOfWeek: number;
  hour: number;
  intensity: number;  // 0-100 normalized
}

function normalizeToHeatmap(data: OccupancyDataPoint[]): HeatmapCell[] {
  const maxRate = Math.max(...data.map((d) => d.occupancyRate));
  if (maxRate === 0) return data.map((d) => ({ dayOfWeek: d.dayOfWeek, hour: d.hour, intensity: 0 }));
  return data.map((d) => ({
    dayOfWeek: d.dayOfWeek,
    hour: d.hour,
    intensity: Math.round((d.occupancyRate / maxRate) * 100),
  }));
}

function peakCell(data: OccupancyDataPoint[]): OccupancyDataPoint | null {
  if (data.length === 0) return null;
  return data.reduce((max, d) => d.occupancyRate > max.occupancyRate ? d : max, data[0]);
}

function avgByDayOfWeek(data: OccupancyDataPoint[]): Record<number, number> {
  const totals: Record<number, { sum: number; count: number }> = {};
  for (const d of data) {
    if (!totals[d.dayOfWeek]) totals[d.dayOfWeek] = { sum: 0, count: 0 };
    totals[d.dayOfWeek].sum += d.occupancyRate;
    totals[d.dayOfWeek].count++;
  }
  const result: Record<number, number> = {};
  for (const [dow, val] of Object.entries(totals)) {
    result[Number(dow)] = Math.round((val.sum / val.count) * 100) / 100;
  }
  return result;
}

function lowOccupancySlots(data: OccupancyDataPoint[], threshold = 0.3): OccupancyDataPoint[] {
  return data.filter((d) => d.occupancyRate < threshold);
}

function revenueByHour(data: OccupancyDataPoint[]): Record<number, number> {
  const result: Record<number, number> = {};
  for (const d of data) {
    result[d.hour] = Math.round(((result[d.hour] ?? 0) + d.revenue) * 100) / 100;
  }
  return result;
}

const DATA: OccupancyDataPoint[] = [
  { dayOfWeek: 1, hour: 9,  occupancyRate: 0.8, bookingCount: 8,  revenue: 800 },
  { dayOfWeek: 1, hour: 14, occupancyRate: 0.95,bookingCount: 10, revenue: 1000 },
  { dayOfWeek: 3, hour: 9,  occupancyRate: 0.2, bookingCount: 2,  revenue: 200 },
  { dayOfWeek: 6, hour: 19, occupancyRate: 1.0, bookingCount: 12, revenue: 1500 },
];

describe("Occupancy heatmap data processing", () => {
  it("peakCell: Saturday 7pm at 100% is peak", () => {
    expect(peakCell(DATA)?.dayOfWeek).toBe(6);
    expect(peakCell(DATA)?.hour).toBe(19);
  });

  it("normalizeToHeatmap: peak cell = intensity 100", () => {
    const heatmap = normalizeToHeatmap(DATA);
    const peak = heatmap.find((c) => c.dayOfWeek === 6 && c.hour === 19);
    expect(peak?.intensity).toBe(100);
  });

  it("lowOccupancySlots: Wednesday 9am (20%) is low", () => {
    const low = lowOccupancySlots(DATA);
    expect(low.some((d) => d.dayOfWeek === 3)).toBe(true);
  });

  it("avgByDayOfWeek: Monday avg = (0.8+0.95)/2 = 0.875", () => {
    expect(avgByDayOfWeek(DATA)[1]).toBe(0.88);
  });

  it("revenueByHour: hour 9 = $1000 (800+200)", () => {
    expect(revenueByHour(DATA)[9]).toBe(1000);
  });
});
