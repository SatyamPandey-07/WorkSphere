"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Wifi,
  Zap,
  Coffee,
  PhoneCall,
  Wind,
  Sparkles,
  Monitor,
  VolumeX,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Wrench,
  Plus,
  ThumbsUp,
  RefreshCw,
  X,
  MapPin,
  Clock,
  ShieldCheck,
  AlertCircle,
} from "lucide-react";
import {
  AmenityCategory,
  OperationalStatus,
  IncidentSeverity,
  AmenityHealthSummary,
  AmenityIncident,
} from "@/lib/venues/amenityIncidentService";

interface AmenityStatusIncidentTrackerProps {
  venueId: string;
  venueName?: string;
}

const AMENITY_ICONS: Record<AmenityCategory, React.ComponentType<{ className?: string }>> = {
  wifi: Wifi,
  outlets: Zap,
  coffee: Coffee,
  phone_booth: PhoneCall,
  air_conditioning: Wind,
  restrooms: Sparkles,
  monitors: Monitor,
  quiet_zone: VolumeX,
};

const PRESET_ISSUES: Record<AmenityCategory, string[]> = {
  wifi: ["High latency / lag spikes", "SSID not broadcasting", "Frequent disconnections"],
  outlets: ["Row of desk outlets not powered", "Loose plug fit", "USB-C port damaged"],
  coffee: ["Espresso machine needs bean refill", "Steam wand jammed", "Oat milk container empty"],
  phone_booth: ["Acoustic door latch stuck", "Ventilation fan not running", "Occupancy light stuck on"],
  air_conditioning: ["Room too warm (>76°F)", "Direct cold draft on desks", "HVAC unit noisy"],
  restrooms: ["Paper towel dispenser empty", "Lock mechanism sticking", "Soap dispenser refill needed"],
  monitors: ["HDMI signal flickering", "Missing USB-C hub cable", "Screen backlight black screen"],
  quiet_zone: ["Loud group conversation in silent area", "Call taken in quiet zone", "Background speaker too loud"],
};

export function AmenityStatusIncidentTracker({
  venueId,
  venueName,
}: AmenityStatusIncidentTrackerProps) {
  const [overallHealth, setOverallHealth] = useState<number>(100);
  const [amenities, setAmenities] = useState<AmenityHealthSummary[]>([]);
  const [activeIncidents, setActiveIncidents] = useState<AmenityIncident[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Form states for new incident
  const [selectedAmenity, setSelectedAmenity] = useState<AmenityCategory>("wifi");
  const [title, setTitle] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [severity, setSeverity] = useState<IncidentSeverity>("medium");
  const [status, setStatus] = useState<OperationalStatus>("DEGRADED");
  const [areaLocation, setAreaLocation] = useState<string>("");

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/venues/${venueId}/incidents`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOverallHealth(data.overallHealthPercentage ?? 100);
          setAmenities(data.amenities || []);
          setActiveIncidents(data.activeIncidents || []);
        }
      }
    } catch (err) {
      console.error("Failed to fetch venue amenity incidents:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [venueId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleManualRefresh = () => {
    setIsRefreshing(true);
    fetchStatus();
  };

  const handleConfirmIncident = async (incidentId: string) => {
    try {
      const res = await fetch(`/api/venues/${venueId}/incidents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, action: "confirm" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOverallHealth(data.overallHealthPercentage);
          setAmenities(data.amenities);
          setActiveIncidents(data.activeIncidents);
          showToast("Confirmed issue (+1 logged)");
        }
      }
    } catch (err) {
      console.error("Failed to confirm incident:", err);
    }
  };

  const handleResolveIncident = async (incidentId: string) => {
    try {
      const res = await fetch(`/api/venues/${venueId}/incidents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, action: "resolve" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOverallHealth(data.overallHealthPercentage);
          setAmenities(data.amenities);
          setActiveIncidents(data.activeIncidents);
          showToast("Marked as resolved! Thank you for the update.");
        }
      }
    } catch (err) {
      console.error("Failed to resolve incident:", err);
    }
  };

  const handleSubmitIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/venues/${venueId}/incidents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amenity: selectedAmenity,
          title: title.trim(),
          description: description.trim() || undefined,
          severity,
          status,
          areaLocation: areaLocation.trim() || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setOverallHealth(data.overallHealthPercentage);
          setAmenities(data.amenities);
          setActiveIncidents(data.activeIncidents);
          setIsModalOpen(false);
          setTitle("");
          setDescription("");
          setAreaLocation("");
          showToast("Incident reported. The community and venue host have been notified.");
        }
      }
    } catch (err) {
      console.error("Failed to report incident:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const showToast = (msg: string) => {
    setActionMessage(msg);
    setTimeout(() => {
      setActionMessage(null);
    }, 4000);
  };

  const getStatusBadge = (opStatus: OperationalStatus) => {
    switch (opStatus) {
      case "OPERATIONAL":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Operational
          </span>
        );
      case "DEGRADED":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            Degraded
          </span>
        );
      case "OUTAGE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <XCircle className="w-3 h-3 text-rose-400" />
            Outage
          </span>
        );
      case "MAINTENANCE":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <Wrench className="w-3 h-3 text-blue-400" />
            Maintenance
          </span>
        );
    }
  };

  return (
    <div className="rounded-3xl p-6 bg-zinc-900/80 border border-zinc-800 text-zinc-100 shadow-xl backdrop-blur-md space-y-6">
      {/* Toast alert */}
      {actionMessage && (
        <div className="p-3 bg-blue-500/20 border border-blue-500/40 rounded-2xl text-blue-200 text-xs font-medium flex items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-blue-400" />
            <span>{actionMessage}</span>
          </div>
          <button
            onClick={() => setActionMessage(null)}
            className="text-zinc-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Header & Health Meter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Live Telemetry
            </span>
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
          </div>
          <h3 className="text-lg font-black tracking-tight text-white mt-1">
            Real-Time Amenity Status & Hardware Health
          </h3>
          <p className="text-xs text-zinc-400">
            Crowdsourced operational status with automated TTL freshness and verification.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors border border-zinc-700/60"
            title="Refresh status"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? "animate-spin text-blue-400" : ""}`} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-rose-900/30 active:scale-[0.98]"
          >
            <AlertCircle className="w-4 h-4" />
            Report Issue
          </button>
        </div>
      </div>

      {/* Overall Health Score Card */}
      <div className="p-4 rounded-2xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-base border shrink-0 ${
              overallHealth >= 90
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : overallHealth >= 70
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/20"
            }`}
          >
            {overallHealth}%
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Operational Matrix Health
            </div>
            <div className="text-sm font-semibold text-zinc-200">
              {overallHealth >= 90
                ? "All core hardware & facilities running smoothly"
                : overallHealth >= 70
                  ? "Minor disruptions reported in specific zones"
                  : "Multiple amenities experiencing active outages"}
            </div>
          </div>
        </div>

        {/* Health bar */}
        <div className="w-full sm:w-48 bg-zinc-800 rounded-full h-2 overflow-hidden border border-zinc-700/40">
          <div
            className={`h-full transition-all duration-700 rounded-full ${
              overallHealth >= 90
                ? "bg-emerald-500"
                : overallHealth >= 70
                  ? "bg-amber-500"
                  : "bg-rose-500"
            }`}
            style={{ width: `${overallHealth}%` }}
          />
        </div>
      </div>

      {/* Amenities Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {amenities.map((item) => {
          const IconComp = AMENITY_ICONS[item.amenity] || Sparkles;
          return (
            <div
              key={item.amenity}
              className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-2 ${
                item.status === "OUTAGE"
                  ? "bg-rose-950/20 border-rose-900/40"
                  : item.status === "DEGRADED"
                    ? "bg-amber-950/20 border-amber-900/40"
                    : item.status === "MAINTENANCE"
                      ? "bg-blue-950/20 border-blue-900/40"
                      : "bg-zinc-950/40 border-zinc-800/80 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="p-2 rounded-xl bg-zinc-800/80 text-zinc-300">
                  <IconComp className="w-4 h-4" />
                </div>
                {getStatusBadge(item.status)}
              </div>

              <div>
                <div className="text-xs font-bold text-zinc-200 line-clamp-1">{item.label}</div>
                <div className="text-[10px] text-zinc-500 mt-0.5 font-medium flex items-center justify-between">
                  <span>
                    {item.activeIncidentsCount > 0
                      ? `${item.activeIncidentsCount} active notice`
                      : "Verified normal"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Active Incidents / Disruption Feed */}
      {activeIncidents.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              Active Venue Incident Reports ({activeIncidents.length})
            </h4>
            <span className="text-[10px] text-zinc-500">Auto-expires after 3h if inactive</span>
          </div>

          <div className="space-y-2.5">
            {activeIncidents.map((incident) => {
              const IconComp = AMENITY_ICONS[incident.amenity] || Sparkles;
              return (
                <div
                  key={incident.id}
                  className="p-4 rounded-2xl bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 transition-all space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div
                        className={`p-2 rounded-xl mt-0.5 shrink-0 ${
                          incident.severity === "critical"
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-amber-500/20 text-amber-400"
                        }`}
                      >
                        <IconComp className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-white">{incident.title}</span>
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                              incident.severity === "critical"
                                ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                                : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                            }`}
                          >
                            {incident.severity}
                          </span>
                        </div>
                        {incident.description && (
                          <p className="text-xs text-zinc-300 mt-1">{incident.description}</p>
                        )}
                        <div className="flex items-center gap-3 text-[11px] text-zinc-500 mt-2 flex-wrap">
                          {incident.areaLocation && (
                            <span className="flex items-center gap-1 text-zinc-400">
                              <MapPin className="w-3 h-3 text-zinc-500" />
                              {incident.areaLocation}
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            Reported by {incident.reportedBy.name}
                          </span>
                          <span className="text-zinc-500">
                            · {incident.confirmationsCount} confirmation
                            {incident.confirmationsCount > 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800/80">
                    <button
                      onClick={() => handleConfirmIncident(incident.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700 transition-colors"
                    >
                      <ThumbsUp className="w-3.5 h-3.5 text-blue-400" />
                      Same Issue (+1)
                    </button>
                    <button
                      onClick={() => handleResolveIncident(incident.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/20 transition-colors"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Mark Fixed
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Incident Reporting Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Report Facility / Amenity Issue</h3>
                  <p className="text-xs text-zinc-400">
                    Notify remote workers at {venueName || "this venue"}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitIncident} className="space-y-4">
              {/* Category Picker */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">
                  Select Affected Amenity
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {amenities.map((item) => {
                    const IconComp = AMENITY_ICONS[item.amenity] || Sparkles;
                    const isSelected = selectedAmenity === item.amenity;
                    return (
                      <button
                        type="button"
                        key={item.amenity}
                        onClick={() => setSelectedAmenity(item.amenity)}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 text-center transition-all ${
                          isSelected
                            ? "bg-rose-500/20 border-rose-500 text-rose-300 ring-1 ring-rose-500/40"
                            : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                        }`}
                      >
                        <IconComp className="w-4 h-4" />
                        <span className="text-[10px] font-bold leading-tight">{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Quick Presets */}
              {PRESET_ISSUES[selectedAmenity] && (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1.5">
                    Quick Preset Issue
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {PRESET_ISSUES[selectedAmenity].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setTitle(preset)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60 transition-colors"
                      >
                        + {preset}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  Issue Summary <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Wi-Fi dropping frequently in North Corner"
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 text-xs"
                />
              </div>

              {/* Area location */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  Specific Location within Venue (Optional)
                </label>
                <input
                  type="text"
                  value={areaLocation}
                  onChange={(e) => setAreaLocation(e.target.value)}
                  placeholder="e.g. 2nd Floor Mezzanine, Booth #3, Desk 14"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 text-xs"
                />
              </div>

              {/* Severity & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">Impact Level</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as OperationalStatus)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-rose-500"
                  >
                    <option value="DEGRADED">Degraded Performance</option>
                    <option value="OUTAGE">Total Outage / Broken</option>
                    <option value="MAINTENANCE">Under Maintenance</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-300 mb-1">Severity</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as IncidentSeverity)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-200 text-xs focus:outline-none focus:border-rose-500"
                  >
                    <option value="low">Low (Minor annoyance)</option>
                    <option value="medium">Medium (Moderate impact)</option>
                    <option value="critical">Critical (Work blocker)</option>
                  </select>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-zinc-300 mb-1">
                  Additional Details (Optional)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide any helpful context or steps to avoid this issue..."
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 text-xs resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !title.trim()}
                  className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-rose-900/30 active:scale-[0.98]"
                >
                  {isSubmitting ? "Submitting..." : "Broadcast Incident"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
