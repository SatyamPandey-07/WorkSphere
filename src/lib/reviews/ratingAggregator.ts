/**
 * Rating & Venue Metrics Aggregator.
 *
 * Computes statistical summaries, consensus metrics, noise distributions,
 * Wi-Fi quality averages, and feature percentages across venue ratings.
 */

import { VenueAggregateSummary } from "./types";

export class RatingAggregator {
  /**
   * Calculates consensus and statistical aggregates from all venue ratings.
   */
  public calculateAggregates(allRatings: any[]): VenueAggregateSummary {
    if (!allRatings || allRatings.length === 0) {
      return {
        wifiQuality: 0,
        hasOutlets: false,
        noiseLevel: null,
        hasErgonomic: false,
        outletDensity: "none",
        wifiSpeed: null,
        hasPhoneBooths: false,
        hasNoMusic: false,
        hasQuietZone: false,
        lighting: null,
        musicStyle: null,
        powerTypes: [],
        outletLocations: [],
        petsAllowedIndoors: false,
        patioOnly: false,
        waterBowlsProvided: false,
        dogFriendly: false,
        catsAllowed: false,
        crowdsourced: false,
        totalRatingsCount: 0,
      };
    }

    const totalCount = allRatings.length;

    // 1. Wi-Fi Quality
    const avgWifi =
      allRatings.reduce(
        (sum: number, r: { wifiQuality: number }) =>
          sum + (typeof r.wifiQuality === "number" ? r.wifiQuality : 0),
        0,
      ) / totalCount;

    // 2. Percentages
    const outletPercent =
      (allRatings.filter((r: { hasOutlets: boolean }) => r.hasOutlets).length /
        totalCount) *
      100;

    const ergonomicPercent =
      (allRatings.filter((r: any) => r.hasErgonomic).length / totalCount) *
      100;

    const phoneBoothsPercent =
      (allRatings.filter((r: any) => r.hasPhoneBooths).length / totalCount) *
      100;

    const noMusicPercent =
      (allRatings.filter((r: any) => r.hasNoMusic).length / totalCount) * 100;

    const quietZonePercent =
      (allRatings.filter((r: any) => r.hasQuietZone).length / totalCount) *
      100;

    // 3. Noise Level Distribution & Dominant
    const noiseDistribution = this.calculateDistribution(
      allRatings,
      "noiseLevel",
    );
    const dominantNoise = this.findDominant(noiseDistribution, null);

    // 4. Lighting Distribution & Dominant
    const lightingDistribution = this.calculateDistribution(
      allRatings,
      "lighting",
    );
    const dominantLighting = this.findDominant(lightingDistribution, null);

    // 5. Outlet Density Distribution & Dominant
    const densityDistribution = this.calculateDistribution(
      allRatings,
      "outletDensity",
    );
    const dominantDensity =
      this.findDominant(densityDistribution, "none") || "none";

    // 6. Aggregated Power Types & Locations
    const aggregatedPowerTypes = Array.from(
      new Set(allRatings.flatMap((r: any) => r.powerTypes || [])),
    );

    const aggregatedOutletLocations = Array.from(
      new Set(allRatings.flatMap((r: any) => r.outletLocations || [])),
    );

    // 7. Wi-Fi Speed Average
    const validSpeeds = allRatings
      .filter((r: any) => r.wifiSpeed !== null && r.wifiSpeed > 0)
      .map((r: any) => Number(r.wifiSpeed));

    const avgSpeed =
      validSpeeds.length > 0
        ? Math.round(
            validSpeeds.reduce((sum: number, s: number) => sum + s, 0) /
              validSpeeds.length,
          )
        : null;

    // 8. Music Style Distribution & Dominant
    const musicDistribution = this.calculateDistribution(
      allRatings,
      "musicStyle",
    );
    const dominantMusic = this.findDominant(musicDistribution, null);

    // 9. Pet Policy Percentages
    const petsAllowedIndoorsPercent =
      (allRatings.filter((r: any) => r.petsAllowedIndoors).length /
        totalCount) *
      100;

    const patioOnlyPercent =
      (allRatings.filter((r: any) => r.patioOnly).length / totalCount) * 100;

    const waterBowlsPercent =
      (allRatings.filter((r: any) => r.waterBowlsProvided).length /
        totalCount) *
      100;

    const dogFriendlyPercent =
      (allRatings.filter((r: any) => r.dogFriendly).length / totalCount) *
      100;

    const catsAllowedPercent =
      (allRatings.filter((r: any) => r.catsAllowed).length / totalCount) *
      100;

    return {
      wifiQuality: Math.round(avgWifi),
      hasOutlets: outletPercent > 50,
      noiseLevel: dominantNoise,
      hasErgonomic: ergonomicPercent > 50,
      outletDensity: dominantDensity,
      wifiSpeed: avgSpeed,
      hasPhoneBooths: phoneBoothsPercent > 50,
      hasNoMusic: noMusicPercent > 50,
      hasQuietZone: quietZonePercent > 50,
      lighting: dominantLighting,
      musicStyle: dominantMusic,
      powerTypes: aggregatedPowerTypes,
      outletLocations: aggregatedOutletLocations,
      petsAllowedIndoors: petsAllowedIndoorsPercent > 50,
      patioOnly: patioOnlyPercent > 50,
      waterBowlsProvided: waterBowlsPercent > 50,
      dogFriendly: dogFriendlyPercent > 50,
      catsAllowed: catsAllowedPercent > 50,
      crowdsourced: true,
      noiseDistribution,
      lightingDistribution,
      musicDistribution,
      densityDistribution,
      totalRatingsCount: totalCount,
    };
  }

  /**
   * Helper to compute count distribution for a specified field key.
   */
  public calculateDistribution(
    items: any[],
    key: string,
  ): Record<string, number> {
    const counts: Record<string, number> = {};
    items.forEach((item) => {
      const val = item[key];
      if (val !== undefined && val !== null && String(val).trim() !== "") {
        const strVal = String(val);
        counts[strVal] = (counts[strVal] || 0) + 1;
      }
    });
    return counts;
  }

  /**
   * Helper to pick the dominant key in a counts distribution map.
   */
  public findDominant(
    counts: Record<string, number>,
    fallback: string | null = null,
  ): string | null {
    const entries = Object.entries(counts);
    if (entries.length === 0) return fallback;
    return entries.reduce(
      (a: [string, number], b: [string, number]) => (b[1] > a[1] ? b : a),
    )[0];
  }
}

export const defaultRatingAggregator = new RatingAggregator();
