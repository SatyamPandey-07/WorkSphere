"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Globe,
  Plus,
  Check,
  X,
  Wifi,
  Zap,
  Volume2,
  MapPin,
  Loader2,
  SlidersHorizontal,
  FileDown,
  Filter,
} from "lucide-react";
import { Venue } from "@/components/chat/ChatMessages";
import { VenueDetailDialog } from "@/components/chat/VenueDetailDialog";
import { generateMultiCityPdfReport } from "@/lib/multiCityPdfExport";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const DEFAULT_CITIES = [
  "San Francisco",
  "New York",
  "London",
  "Tokyo",
  "Berlin",
  "Austin",
  "Singapore",
  "Paris",
];

export interface AmenityFilterOption {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const AMENITY_FILTERS: AmenityFilterOption[] = [
  { id: "wifi", label: "Wi-Fi", icon: Wifi },
  { id: "quiet", label: "Quiet", icon: Volume2 },
  { id: "outlets", label: "Power Outlets", icon: Zap },
];

function parseCitiesFromParams(params: URLSearchParams): string[] {
  const citiesParam = params.get("cities");
  if (citiesParam) {
    const parsed = citiesParam
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  return ["San Francisco", "Tokyo"];
}

function parseFiltersFromParams(params: URLSearchParams): string[] {
  const filtersParam = params.get("filters");
  const active: string[] = [];
  if (filtersParam) {
    const parsed = filtersParam
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);
    parsed.forEach((f) => {
      const lower = f.toLowerCase();
      if (lower.includes("wifi") || lower.includes("wi-fi"))
        active.push("wifi");
      else if (lower.includes("quiet")) active.push("quiet");
      else if (lower.includes("outlet") || lower.includes("power"))
        active.push("outlets");
      else active.push(f);
    });
  }
  if (params.get("wifi") === "true" && !active.includes("wifi"))
    active.push("wifi");
  if (params.get("quiet") === "true" && !active.includes("quiet"))
    active.push("quiet");
  if (
    (params.get("outlets") === "true" || params.get("hasOutlets") === "true") &&
    !active.includes("outlets")
  ) {
    active.push("outlets");
  }
  return Array.from(new Set(active));
}

interface WifiSpeedBadgeDetails {
  label: string;
  className: string;
}

function getWifiSpeedBadgeDetails(
  averageSpeed: number | null,
): WifiSpeedBadgeDetails {
  if (averageSpeed === null) {
    return {
      label: "WiFi speed unavailable",
      className:
        "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    };
  }

  if (averageSpeed > 100) {
    return {
      label: "Fast",
      className:
        "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    };
  }

  if (averageSpeed > 30) {
    return {
      label: "Moderate",
      className:
        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    };
  }

  return {
    label: "Limited",
    className:
      "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
}

export function buildComparisonChartData(
  selectedCities: string[],
  venues: Venue[],
): Array<{
  city: string;
  avgWifi: number;
  quietPct: number;
  outletPct: number;
}> {
  return selectedCities.map((city) => {
    const cityVenues = venues.filter((v) =>
      v.address?.toLowerCase().includes(city.toLowerCase()),
    );
    const total = cityVenues.length;

    const wifiSpeeds = cityVenues
      .map((v) => v.wifiSpeed)
      .filter((s): s is number => typeof s === "number");
    const avgWifi =
      wifiSpeeds.length > 0
        ? Math.round(wifiSpeeds.reduce((a, b) => a + b, 0) / wifiSpeeds.length)
        : 0;

    const quietPct =
      total > 0
        ? Math.round(
            (cityVenues.filter((v) => v.noiseLevel === "quiet").length /
              total) *
              100,
          )
        : 0;

    const outletPct =
      total > 0
        ? Math.round(
            (cityVenues.filter((v) => v.hasOutlets).length / total) * 100,
          )
        : 0;

    return { city, avgWifi, quietPct, outletPct };
  });
}

/** 
 *  Props for the MultiCityComparison component.
 */
interface MultiCityComparisonProps {
  /**
   * Optional list of venues used to initialize the comparison view
   * before fresh venue data is fetched.
   */
  initialVenues?: Venue[];
}

export function MultiCityComparison({
  initialVenues = [],
}: MultiCityComparisonProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [selectedCities, setSelectedCities] = useState<string[]>(() =>
    parseCitiesFromParams(searchParams),
  );

  const [selectedFilters, setSelectedFilters] = useState<string[]>(() =>
    parseFiltersFromParams(searchParams),
  );

  const [prevParamsString, setPrevParamsString] = useState(() =>
    searchParams.toString(),
  );

  const [availableCities, setAvailableCities] =
    useState<string[]>(DEFAULT_CITIES);
  const [customCityInput, setCustomCityInput] = useState("");
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [loading, setLoading] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);

  /**
   * Synchronizes the selected cities and active filters with the URL
   * search parameters.
   *
   * This keeps the comparison state shareable and ensures browser
   * navigation (back/forward) restores the current selection.
   */
  const updateUrlParams = useCallback(
    (cities: string[], filters: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (cities.length > 0) {
        params.set("cities", cities.join(","));
      } else {
        params.delete("cities");
      }

      if (filters.length > 0) {
        params.set("filters", filters.join(","));
      } else {
        params.delete("filters");
        params.delete("wifi");
        params.delete("quiet");
        params.delete("outlets");
        params.delete("hasOutlets");
      }

      const newQuery = params.toString();
      const navigate = router.replace || router.push;
      navigate(newQuery ? `?${newQuery}` : window.location.pathname, {
        scroll: false,
      });
    },
    [router, searchParams],
  );
  /**
   * Updates local component state whenever the URL search parameters
   * change externally (for example, through browser back/forward
   * navigation), keeping the UI synchronized with the URL.
   */
  useEffect(() => {
    const currentParamsString = searchParams.toString();
    if (currentParamsString !== prevParamsString) {
      setPrevParamsString(currentParamsString);
      const urlCities = parseCitiesFromParams(searchParams);
      const urlFilters = parseFiltersFromParams(searchParams);
      setSelectedCities(urlCities);
      setSelectedFilters(urlFilters);
    }
  }, [searchParams, prevParamsString]);

  const toggleCity = (city: string) => {
    const nextCities = selectedCities.includes(city)
      ? selectedCities.filter((c) => c !== city)
      : [...selectedCities, city];
    setSelectedCities(nextCities);
    updateUrlParams(nextCities, selectedFilters);
  };

  const removeCity = (city: string) => {
    const nextCities = selectedCities.filter((c) => c !== city);
    setSelectedCities(nextCities);
    updateUrlParams(nextCities, selectedFilters);
  };

  const toggleFilter = (filterId: string) => {
    const nextFilters = selectedFilters.includes(filterId)
      ? selectedFilters.filter((f) => f !== filterId)
      : [...selectedFilters, filterId];
    setSelectedFilters(nextFilters);
    updateUrlParams(selectedCities, nextFilters);
  };

  const removeFilterChip = (filterId: string) => {
    const nextFilters = selectedFilters.filter((f) => f !== filterId);
    setSelectedFilters(nextFilters);
    updateUrlParams(selectedCities, nextFilters);
  };

  const handleAddCustomCity = (e: React.FormEvent) => {
    e.preventDefault();
    const city = customCityInput.trim();
    if (!city) return;

    if (!availableCities.includes(city)) {
      setAvailableCities((prev) => [...prev, city]);
    }
    if (!selectedCities.includes(city)) {
      const nextCities = [...selectedCities, city];
      setSelectedCities(nextCities);
      updateUrlParams(nextCities, selectedFilters);
    }
    setCustomCityInput("");
  };

  const handleExportPdfReport = async () => {
    if (selectedCities.length === 0) return;
    setIsExportingPdf(true);
    try {
      const pdfBytes = await generateMultiCityPdfReport({
        selectedCities,
        venues,
      });
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worksphere-multi-city-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate PDF report:", err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const [isExportingChartPdf, setIsExportingChartPdf] = useState(false);

  const chartData = useMemo(
    () => buildComparisonChartData(selectedCities, venues),
    [selectedCities, venues],
  );

  const handleExportChartPdf = async () => {
    if (chartData.length === 0) return;
    setIsExportingChartPdf(true);
    try {
      const pdfDoc = await PDFDocument.create();
      const page = pdfDoc.addPage([595, 420]);
      const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const { width, height } = page.getSize();

      // Title
      page.drawText("WorkSphere — Venue Attribute Comparison", {
        x: 40,
        y: height - 40,
        size: 14,
        font,
        color: rgb(0.1, 0.1, 0.1),
      });
      page.drawText(
        `Cities: ${selectedCities.join(", ")}  •  Generated ${new Date().toLocaleDateString()}`,
        {
          x: 40,
          y: height - 58,
          size: 9,
          font: fontReg,
          color: rgb(0.45, 0.45, 0.45),
        },
      );

      // Chart legend
      const legendY = height - 80;
      const legendItems = [
        { label: "Avg WiFi (Mbps)", color: rgb(0.23, 0.51, 0.96) },
        { label: "Quiet venues (%)", color: rgb(0.06, 0.73, 0.51) },
        { label: "Outlets (%)", color: rgb(0.95, 0.62, 0.07) },
      ];
      legendItems.forEach((item, i) => {
        const lx = 40 + i * 160;
        page.drawRectangle({
          x: lx,
          y: legendY,
          width: 12,
          height: 10,
          color: item.color,
        });
        page.drawText(item.label, {
          x: lx + 16,
          y: legendY + 1,
          size: 8,
          font: fontReg,
          color: rgb(0.2, 0.2, 0.2),
        });
      });

      // Bars
      const chartTop = legendY - 20;
      const chartBottom = 60;
      const chartHeight = chartTop - chartBottom;
      const groupWidth = (width - 80) / Math.max(chartData.length, 1);
      const barWidth = Math.min(28, groupWidth / 4);
      const maxWifi = Math.max(...chartData.map((d) => d.avgWifi), 1);

      chartData.forEach((row, gi) => {
        const gx = 40 + gi * groupWidth + groupWidth / 2 - barWidth * 2;

        const bars = [
          {
            value: (row.avgWifi / maxWifi) * 100,
            color: rgb(0.23, 0.51, 0.96),
          },
          { value: row.quietPct, color: rgb(0.06, 0.73, 0.51) },
          { value: row.outletPct, color: rgb(0.95, 0.62, 0.07) },
        ];

        bars.forEach((bar, bi) => {
          const bx = gx + bi * (barWidth + 4);
          const bh = (bar.value / 100) * chartHeight;
          page.drawRectangle({
            x: bx,
            y: chartBottom,
            width: barWidth,
            height: Math.max(bh, 1),
            color: bar.color,
          });
        });

        // City label
        const labelX = gx + barWidth;
        page.drawText(
          row.city.length > 10 ? row.city.slice(0, 10) + "…" : row.city,
          {
            x: labelX,
            y: chartBottom - 14,
            size: 7,
            font: fontReg,
            color: rgb(0.3, 0.3, 0.3),
          },
        );
      });

      // Y-axis baseline
      page.drawLine({
        start: { x: 40, y: chartBottom },
        end: { x: width - 40, y: chartBottom },
        thickness: 0.5,
        color: rgb(0.7, 0.7, 0.7),
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
        type: "application/pdf",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `worksphere-comparison-chart-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export chart PDF:", err);
    } finally {
      setIsExportingChartPdf(false);
    }
  };
  // Fetch venues for selected cities
  useEffect(() => {
    let isMounted = true;
    if (selectedCities.length === 0) {
      setVenues([]);
      return;
    }

    setLoading(true);
    const citiesQuery = encodeURIComponent(selectedCities.join(","));
    fetch(`/api/venues?cities=${citiesQuery}`)
      .then(async (res) => {
        const data = await res.json();
        if (isMounted && data.venues) {
          setVenues(data.venues);
        }
      })
      .catch((err) => console.error("Error fetching multi-city venues:", err))
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCities]);

  // Filter helper matching venue address, city string, and active amenity filters
  const getVenuesForCity = (city: string) => {
    return venues.filter((venue) => {
      if (!venue.address) return false;
      const matchesCity = venue.address
        .toLowerCase()
        .includes(city.toLowerCase());
      if (!matchesCity) return false;

      if (selectedFilters.includes("wifi") && !venue.wifi) return false;
      if (selectedFilters.includes("quiet") && venue.noiseLevel !== "quiet")
        return false;
      if (selectedFilters.includes("outlets") && !venue.hasOutlets)
        return false;

      return true;
    });
  };

  const selectedCityVenues = useMemo(
    () =>
      venues.filter((venue) =>
        selectedCities.some((city) =>
          venue.address?.toLowerCase().includes(city.toLowerCase()),
        ),
      ),
    [selectedCities, venues],
  );

  const averageWifiSpeed = useMemo(() => {
    const wifiSpeeds = selectedCityVenues
      .map((venue) => venue.wifiSpeed)
      .filter((speed): speed is number => speed != null && speed > 0);

    if (wifiSpeeds.length === 0) return null;

    return Math.round(
      wifiSpeeds.reduce((total, speed) => total + speed, 0) / wifiSpeeds.length,
    );
  }, [selectedCityVenues]);

  const wifiSpeedBadge = getWifiSpeedBadgeDetails(averageWifiSpeed);

  // Metric averages per city
  const getCityMetrics = (cityVenues: Venue[]) => {
    if (cityVenues.length === 0) return null;
    const wifiSpeeds = cityVenues
      .map((v) => v.wifiSpeed)
      .filter((s): s is number => s != null && s > 0);
    const avgWifi =
      wifiSpeeds.length > 0
        ? Math.round(wifiSpeeds.reduce((a, b) => a + b, 0) / wifiSpeeds.length)
        : null;

    const outletCount = cityVenues.filter((v) => v.hasOutlets).length;
    const quietCount = cityVenues.filter(
      (v) => v.noiseLevel === "quiet",
    ).length;

    return {
      total: cityVenues.length,
      avgWifi,
      outletRatio: Math.round((outletCount / cityVenues.length) * 100),
      quietRatio: Math.round((quietCount / cityVenues.length) * 100),
    };
  };

  return (
    <section className="w-full space-y-6 my-6 text-zinc-900 dark:text-zinc-100">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-black uppercase tracking-tight text-zinc-900 dark:text-white">
              Multi-City Nomad Workspace Filter & Split View
            </h2>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Compare workspace amenities, WiFi speed, and noise levels across
            global nomad hubs side-by-side.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex items-center gap-2 text-xs font-bold font-mono text-zinc-500">
              <SlidersHorizontal className="w-4 h-4 text-blue-500" />
              <span>{selectedCities.length} Cities Active</span>
            </div>

            <div
              data-testid="average-wifi-speed-badge"
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold ${wifiSpeedBadge.className}`}
              title={
                averageWifiSpeed === null
                  ? "No WiFi speed measurements are available for the selected cities"
                  : `Average WiFi speed across selected cities: ${averageWifiSpeed} Mbps`
              }
              aria-label={
                averageWifiSpeed === null
                  ? "Average WiFi speed unavailable"
                  : `Average WiFi speed ${averageWifiSpeed} Mbps, ${wifiSpeedBadge.label}`
              }
            >
              <Wifi className="h-3.5 w-3.5" aria-hidden="true" />
              <span>
                {averageWifiSpeed === null
                  ? "WiFi N/A"
                  : `${averageWifiSpeed} Mbps`}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleExportPdfReport}
            disabled={selectedCities.length === 0 || isExportingPdf}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-sm transition-all"
            title="Export PDF comparison report"
          >
            {isExportingPdf ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FileDown className="w-3.5 h-3.5" />
            )}
            <span>Export PDF Report</span>
          </button>
        </div>
      </div>

      {/* Multi-Select City & Amenity Filter Bar */}
      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 space-y-4">
        {/* City Filter Selection */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-3">
            Select Cities to Compare
          </label>

          <div className="flex flex-wrap gap-2 mb-3">
            {availableCities.map((city) => {
              const isSelected = selectedCities.includes(city);
              return (
                <button
                  key={city}
                  type="button"
                  onClick={() => toggleCity(city)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-blue-600 text-white shadow-md shadow-blue-500/20 ring-2 ring-blue-500/30 scale-[1.02]"
                      : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-blue-500/50"
                  }`}
                >
                  {isSelected ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <Plus className="w-3.5 h-3.5 text-zinc-400" />
                  )}
                  <span>{city}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Amenity Filter Selection */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-2">
            Filter by Workspace Amenity
          </label>
          <div className="flex flex-wrap gap-2">
            {AMENITY_FILTERS.map((filter) => {
              const isSelected = selectedFilters.includes(filter.id);
              const Icon = filter.icon;
              return (
                <button
                  key={filter.id}
                  type="button"
                  data-testid={`filter-chip-${filter.id}`}
                  onClick={() => toggleFilter(filter.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                    isSelected
                      ? "bg-emerald-600 text-white shadow-md shadow-emerald-500/20 ring-2 ring-emerald-500/30 scale-[1.02]"
                      : "bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:border-emerald-500/50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span>{filter.label}</span>
                  {isSelected && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${filter.label} filter`}
                      data-testid={`remove-filter-chip-${filter.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFilterChip(filter.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.stopPropagation();
                          removeFilterChip(filter.id);
                        }
                      }}
                      className="ml-1 p-0.5 rounded-full hover:bg-emerald-700/80 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active Filter Badges Bar with Reactive Dismiss Button */}
        {selectedFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-blue-500/5 border border-blue-500/10">
            <span className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1">
              <Filter className="w-3 h-3 text-blue-500" />
              Active Filters:
            </span>
            {selectedFilters.map((filterId) => {
              const filterDef = AMENITY_FILTERS.find((f) => f.id === filterId);
              const label = filterDef ? filterDef.label : filterId;
              return (
                <span
                  key={filterId}
                  data-testid={`active-badge-${filterId}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800"
                >
                  <span>{label}</span>
                  <button
                    type="button"
                    data-testid={`remove-active-badge-${filterId}`}
                    aria-label={`Remove ${label} filter badge`}
                    onClick={() => removeFilterChip(filterId)}
                    className="p-0.5 rounded-md hover:bg-blue-200 dark:hover:bg-blue-900 transition-colors text-blue-600 dark:text-blue-400"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setSelectedFilters([]);
                updateUrlParams(selectedCities, []);
              }}
              className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 underline ml-auto"
            >
              Clear All Filters
            </button>
          </div>
        )}

        {/* Custom City Tag Input */}
        <form onSubmit={handleAddCustomCity} className="flex gap-2 max-w-md">
          <input
            type="text"
            placeholder="Add custom city (e.g. Kyoto, Lisbon)..."
            value={customCityInput}
            onChange={(e) => setCustomCityInput(e.target.value)}
            className="flex-1 px-3.5 py-2 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-xs font-bold rounded-xl hover:opacity-90 transition-all shrink-0"
          >
            Add City
          </button>
        </form>
      </div>

      {/* Split-View Side-by-Side Layout */}
      {selectedCities.length === 0 ? (
        <div className="p-12 text-center rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-800 text-zinc-500 text-xs">
          Select at least one city tag above to compare venues.
        </div>
      ) : loading ? (
        <div className="h-64 flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
          <span>Fetching multi-city workspace telemetry…</span>
        </div>
      ) : (
        <div
          className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${Math.min(
            selectedCities.length,
            3,
          )} gap-6`}
        >
          {selectedCities.map((city) => {
            const cityVenues = getVenuesForCity(city);
            const metrics = getCityMetrics(cityVenues);

            return (
              <div
                key={city}
                className="flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden shadow-sm"
              >
                {/* Column Header */}
                <div className="p-4 bg-zinc-50 dark:bg-zinc-950 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-blue-500" />
                    <h3 className="font-bold text-sm text-zinc-900 dark:text-white">
                      {city}
                    </h3>
                  </div>
                  <button
                    onClick={() => removeCity(city)}
                    className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    title={`Remove ${city}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* City Metrics Bar */}
                {metrics && (
                  <div className="grid grid-cols-3 p-3 bg-blue-500/5 border-b border-zinc-100 dark:border-zinc-800/80 text-center text-[11px]">
                    <div>
                      <span className="block text-[10px] text-zinc-400 font-bold uppercase">
                        Venues
                      </span>
                      <span className="font-bold text-zinc-900 dark:text-white">
                        {metrics.total}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-400 font-bold uppercase">
                        Avg WiFi
                      </span>
                      <span className="font-bold text-blue-500">
                        {metrics.avgWifi ? `${metrics.avgWifi} Mbps` : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-[10px] text-zinc-400 font-bold uppercase">
                        Quiet Ratio
                      </span>
                      <span className="font-bold text-emerald-500">
                        {metrics.quietRatio}%
                      </span>
                    </div>
                  </div>
                )}

                {/* Venue List */}
                <div className="p-4 flex-1 space-y-3 overflow-y-auto max-h-[500px]">
                  {cityVenues.length === 0 ? (
                    <div className="py-12 text-center text-xs text-zinc-400 italic">
                      No venues recorded in {city} yet.
                    </div>
                  ) : (
                    cityVenues.map((venue) => (
                      <div
                        key={venue.id}
                        onClick={() => setSelectedVenue(venue)}
                        className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-950/40 hover:border-blue-500/50 hover:scale-[1.01] transition-all cursor-pointer space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="font-bold text-xs text-zinc-900 dark:text-white uppercase truncate">
                            {venue.name}
                          </h4>
                          {venue.score != null && (
                            <span className="text-[10px] font-extrabold text-blue-600 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-md">
                              {Math.round(venue.score * 10)}%
                            </span>
                          )}
                        </div>

                        {venue.address && (
                          <p className="text-[10px] text-zinc-500 truncate">
                            {venue.address}
                          </p>
                        )}

                        <div className="flex items-center gap-2 pt-1 text-[10px] font-bold">
                          {venue.wifi && (
                            <span className="flex items-center gap-1 text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                              <Wifi className="w-3 h-3" />
                              {venue.wifiSpeed ? `${venue.wifiSpeed}M` : "WiFi"}
                            </span>
                          )}
                          {venue.hasOutlets && (
                            <span className="flex items-center gap-1 text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md">
                              <Zap className="w-3 h-3" />
                              Power
                            </span>
                          )}
                          {venue.noiseLevel === "quiet" && (
                            <span className="flex items-center gap-1 text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                              <Volume2 className="w-3 h-3" />
                              Quiet
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Attribute Comparison Chart ── */}
      {chartData.length > 0 && (
        <div
          className="mt-6 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60"
          aria-label="Venue attribute comparison chart"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold uppercase tracking-tight text-zinc-900 dark:text-zinc-50">
                Attribute Comparison
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                Average WiFi speed (Mbps), quiet venues (%), outlets (%) by city
              </p>
            </div>
            <button
              type="button"
              onClick={handleExportChartPdf}
              disabled={isExportingChartPdf}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              aria-label="Export chart as PDF"
            >
              <FileDown className="h-3.5 w-3.5" />
              {isExportingChartPdf ? "Exporting…" : "Export Chart PDF"}
            </button>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
            >
              <XAxis
                dataKey="city"
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-zinc-600 dark:text-zinc-400"
              />
              <YAxis
                tick={{ fontSize: 11, fill: "currentColor" }}
                className="text-zinc-600 dark:text-zinc-400"
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: "8px",
                  border: "1px solid #e4e4e7",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="avgWifi"
                name="Avg WiFi (Mbps)"
                fill="#3b82f6"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="quietPct"
                name="Quiet venues (%)"
                fill="#10b981"
                radius={[3, 3, 0, 0]}
              />
              <Bar
                dataKey="outletPct"
                name="Outlets (%)"
                fill="#f59e0b"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Venue Detail Dialog */}
      {selectedVenue && (
        <VenueDetailDialog
          venue={selectedVenue}
          isOpen={true}
          isFavorited={false}
          onClose={() => setSelectedVenue(null)}
          onGetDirections={() => {}}
          onToggleFavorite={() => {}}
        />
      )}
    </section>
  );
}
