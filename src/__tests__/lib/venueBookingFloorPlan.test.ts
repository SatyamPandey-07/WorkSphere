/**
 * Tests for venue floor plan layout and seating arrangement utilities.
 */

type SeatingStyle = "theatre" | "classroom" | "banquet" | "cabaret" | "boardroom" | "cocktail";

interface FloorPlanConfig {
  venueId: string;
  totalSquareMeters: number;
  stages: { x: number; y: number; widthM: number; heightM: number }[];
  exits: number;
}

interface SeatingArrangement {
  style: SeatingStyle;
  capacity: number;
  tableCount: number | null;
  chairsPerTable: number | null;
  requiresStage: boolean;
  aisleClearanceM: number;
}

const STYLE_CONFIGS: Record<SeatingStyle, SeatingArrangement> = {
  theatre:   { style: "theatre",   capacity: 0, tableCount: null, chairsPerTable: null, requiresStage: true,  aisleClearanceM: 1.2 },
  classroom: { style: "classroom", capacity: 0, tableCount: null, chairsPerTable: 3,    requiresStage: true,  aisleClearanceM: 1.0 },
  banquet:   { style: "banquet",   capacity: 0, tableCount: null, chairsPerTable: 10,   requiresStage: false, aisleClearanceM: 1.5 },
  cabaret:   { style: "cabaret",   capacity: 0, tableCount: null, chairsPerTable: 8,    requiresStage: true,  aisleClearanceM: 1.5 },
  boardroom: { style: "boardroom", capacity: 0, tableCount: 1,    chairsPerTable: null, requiresStage: false, aisleClearanceM: 0.8 },
  cocktail:  { style: "cocktail",  capacity: 0, tableCount: null, chairsPerTable: null, requiresStage: false, aisleClearanceM: 1.0 },
};

function estimateCapacity(sqm: number, style: SeatingStyle): number {
  const densities: Record<SeatingStyle, number> = {
    theatre: 0.9, classroom: 0.6, banquet: 0.55, cabaret: 0.5, boardroom: 0.3, cocktail: 1.2,
  };
  return Math.floor(sqm * densities[style]);
}

function tableCount(capacity: number, style: SeatingStyle): number | null {
  const cfg = STYLE_CONFIGS[style];
  if (!cfg.chairsPerTable) return null;
  return Math.ceil(capacity / cfg.chairsPerTable);
}

function styleRequiresStage(style: SeatingStyle): boolean {
  return STYLE_CONFIGS[style].requiresStage;
}

function aisleClearance(style: SeatingStyle): number {
  return STYLE_CONFIGS[style].aisleClearanceM;
}

describe("Floor plan and seating arrangements", () => {
  it("estimateCapacity: theatre 200 sqm = 180", () => {
    expect(estimateCapacity(200, "theatre")).toBe(180);
  });

  it("estimateCapacity: cocktail = highest density", () => {
    expect(estimateCapacity(100, "cocktail")).toBeGreaterThan(estimateCapacity(100, "banquet"));
  });

  it("tableCount: banquet 80 guests = 8 tables", () => {
    expect(tableCount(80, "banquet")).toBe(8);
  });

  it("tableCount: theatre → null (no tables)", () => {
    expect(tableCount(200, "theatre")).toBeNull();
  });

  it("styleRequiresStage: theatre → true", () => {
    expect(styleRequiresStage("theatre")).toBe(true);
  });

  it("styleRequiresStage: banquet → false", () => {
    expect(styleRequiresStage("banquet")).toBe(false);
  });

  it("aisleClearance: banquet = 1.5m", () => {
    expect(aisleClearance("banquet")).toBe(1.5);
  });
});
