"use client";

import { useEffect, useState, useCallback } from "react";
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
} from "lucide-react";
import { Venue } from "@/components/chat/ChatMessages";
import { VenueDetailDialog } from "@/components/chat/VenueDetailDialog";

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

interface MultiCityComparisonProps {
  initialVenues?: Venue[];
}

export function MultiCityComparison({
  initialVenues = [],
}: MultiCityComparisonProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [selectedCities, setSelectedCities] = useState<string[]>(() => {
    const citiesParam = searchParams.get("cities");
    if (citiesParam) {
      const parsed = citiesParam
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      if (parsed.length > 0) return parsed;
    }
    return ["San Francisco", "Tokyo"];
  });

  const [availableCities, setAvailableCities] =
    useState<string[]>(DEFAULT_CITIES);
  const [customCityInput, setCustomCityInput] = useState("");
  const [venues, setVenues] = useState<Venue[]>(initialVenues);
  const [loading, setLoading] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);

  // Sync URL search params whenever selectedCities changes
  const updateUrlParams = useCallback(
    (cities: string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (cities.length > 0) {
        params.set("cities", cities.join(","));
      } else {
        params.delete("cities");
      }
      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const toggleCity = (city: string) => {
    setSelectedCities((prev) => {
      const next = prev.includes(city)
        ? prev.filter((c) => c !== city)
        : [...prev, city];
      updateUrlParams(next);
      return next;
    });
  };

  const handleAddCustomCity = (e: React.FormEvent) => {
    e.preventDefault();
    const city = customCityInput.trim();
    if (!city) return;

    if (!availableCities.includes(city)) {
      setAvailableCities((prev) => [...prev, city]);
    }
    if (!selectedCities.includes(city)) {
      const next = [...selectedCities, city];
      setSelectedCities(next);
      updateUrlParams(next);
    }
    setCustomCityInput("");
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

  // Filter helper matching venue address or city string
  const getVenuesForCity = (city: string) => {
    return venues.filter((venue) => {
      if (!venue.address) return false;
      return venue.address.toLowerCase().includes(city.toLowerCase());
    });
  };

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

        <div className="flex items-center gap-2 text-xs font-bold font-mono text-zinc-500">
          <SlidersHorizontal className="w-4 h-4 text-blue-500" />
          <span>{selectedCities.length} Cities Active</span>
        </div>
      </div>

      {/* Multi-Select City Filter Bar */}
      <div className="p-5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60">
        <label className="block text-xs font-bold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-3">
          Select Cities to Compare
        </label>

        <div className="flex flex-wrap gap-2 mb-4">
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
                    onClick={() => toggleCity(city)}
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
