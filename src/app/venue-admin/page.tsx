"use client";

import { useState, useEffect, Suspense } from "react";
import { useUser, SignInButton } from "@clerk/nextjs";
import { useSearchParams, useRouter } from "next/navigation";
import {
  BadgeCheck,
  Building2,
  MapPin,
  Clock,
  MessageSquare,
  Loader2,
  Check,
  Lock,
  ArrowLeft,
  Sparkles,
} from "lucide-react";

function VenueAdminContent() {
  const { user, isLoaded, isSignedIn } = useUser();
  const searchParams = useSearchParams();
  const router = useRouter();

  const claimId = searchParams?.get("claimId");

  const [managedVenues, setManagedVenues] = useState<any[]>([]);
  const [claimVenue, setClaimVenue] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [selectedVenue, setSelectedVenue] = useState<any | null>(null);

  // Form edit states
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editHours, setEditHours] = useState("");
  const [editHostMessage, setEditHostMessage] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Fetch claimed venues
  useEffect(() => {
    if (!isSignedIn) return;

    async function fetchManaged() {
      try {
        const res = await fetch("/api/venues/managed");
        if (res.ok) {
          const data = await res.json();
          setManagedVenues(data);
        }
      } catch (err) {
        console.error("Error fetching managed venues:", err);
      } finally {
        setLoading(false);
      }
    }

    fetchManaged();
  }, [isSignedIn]);

  // Fetch venue to claim if claimId is provided
  useEffect(() => {
    if (!claimId) return;

    async function fetchClaimVenue() {
      try {
        // Query venue details by ID
        const res = await fetch(`/api/venues/search?id=${claimId}`);
        if (res.ok) {
          const data = await res.json();
          // The search endpoint might return different formats, extract the single venue
          const venueDetail = data.venues?.[0] || data;
          if (venueDetail && venueDetail.id === claimId) {
            setClaimVenue(venueDetail);
          }
        }
      } catch (err) {
        console.error("Error fetching claim venue:", err);
      }
    }

    fetchClaimVenue();
  }, [claimId]);

  // Handle claiming the venue
  const handleClaim = async () => {
    if (!claimVenue) return;
    setClaiming(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/venues/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId: claimVenue.id }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg(`Successfully claimed ${claimVenue.name}!`);
        // Refresh managed list
        const listRes = await fetch("/api/venues/managed");
        if (listRes.ok) {
          const listData = await listRes.json();
          setManagedVenues(listData);
        }
        // Select this claimed venue for editing immediately
        setSelectedVenue(data.venue);
        setEditName(data.venue.name);
        setEditAddress(data.venue.address || "");
        setEditHours(data.venue.openingHours || "");
        setEditHostMessage(data.venue.hostMessage || "");
        setClaimVenue(null);
      } else {
        setErrorMsg(data.error || "Failed to claim business.");
      }
    } catch (err) {
      setErrorMsg("An error occurred during claiming.");
    } finally {
      setClaiming(false);
    }
  };

  // Handle saving venue updates
  const handleUpdate = async () => {
    if (!selectedVenue) return;
    setUpdating(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch("/api/venues/managed", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueId: selectedVenue.id,
          name: editName,
          address: editAddress,
          openingHours: editHours,
          hostMessage: editHostMessage,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setSuccessMsg("Venue details updated successfully!");
        setSelectedVenue(data.venue);
        // Refresh list
        setManagedVenues((prev) =>
          prev.map((v) => (v.id === data.venue.id ? data.venue : v))
        );
      } else {
        setErrorMsg(data.error || "Failed to update venue.");
      }
    } catch (err) {
      setErrorMsg("An error occurred during update.");
    } finally {
      setUpdating(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
        <p className="text-sm text-zinc-400">Loading portal...</p>
      </div>
    );
  }

  // Unauthorized page state
  if (!isSignedIn) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white p-4">
        <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-3xl p-8 shadow-2xl text-center backdrop-blur-xl">
          <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-400">
            <Lock className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black mb-2 tracking-tight">Access Restricted</h1>
          <p className="text-sm text-zinc-400 mb-8 leading-relaxed">
            Please sign in to your owner account to claim businesses or manage your listings.
          </p>
          <SignInButton mode="modal">
            <button className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold text-sm rounded-xl shadow-lg transition-all active:scale-[0.99]">
              Sign In to Owner Portal
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 sm:p-12">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-12 border-b border-zinc-850 pb-8">
          <div>
            <div className="flex items-center gap-2 mb-2 text-blue-400 font-bold text-xs uppercase tracking-widest">
              <Sparkles className="w-4 h-4" />
              <span>Owner & Host Console</span>
            </div>
            <h1 className="text-4xl font-black tracking-tight flex items-center gap-3">
              <span>WorkSphere Business Portal</span>
              <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                Partner
              </span>
            </h1>
          </div>
          <button
            onClick={() => router.push("/ai")}
            className="flex items-center gap-2 text-xs font-bold text-zinc-400 hover:text-white transition-colors bg-zinc-900 border border-zinc-800 px-4 py-2.5 rounded-xl active:scale-[0.98]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Map
          </button>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-medium">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-medium flex items-center gap-2">
            <Check className="w-4 h-4" />
            {successMsg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left panel: claim confirmation OR claimed venues list */}
          <div className="lg:col-span-1 space-y-6">
            {/* Claiming Workflow Card */}
            {claimVenue && (
              <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 border-2 border-blue-500/30 rounded-3xl p-6 shadow-xl">
                <h2 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <Building2 className="w-5 h-5 text-blue-400" />
                  Claim listing ownership
                </h2>
                <p className="text-xs text-zinc-400 mb-6 leading-relaxed">
                  Verify ownership of this listing to access partner privileges.
                </p>

                <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 mb-6">
                  <h3 className="font-bold text-sm text-white mb-1">{claimVenue.name}</h3>
                  <p className="text-xs text-zinc-400 flex items-start gap-1.5 leading-tight">
                    <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0 mt-0.5" />
                    <span>{claimVenue.address || "Address not available"}</span>
                  </p>
                </div>

                <button
                  onClick={handleClaim}
                  disabled={claiming}
                  className="w-full py-3.5 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold text-sm rounded-xl shadow-lg transition-all active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {claiming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Verifying...
                    </>
                  ) : (
                    <>Confirm Ownership</>
                  )}
                </button>
              </div>
            )}

            {/* List of Claimed/Managed Venues */}
            <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-6">
              <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-zinc-400" />
                Your Claimed Venues
              </h2>

              {loading ? (
                <div className="flex items-center justify-center py-12 text-zinc-500 text-sm">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Loading claimed venues...
                </div>
              ) : managedVenues.length === 0 ? (
                <div className="text-center py-12 text-zinc-500">
                  <p className="text-sm mb-2">No venues claimed yet.</p>
                  <p className="text-xs max-w-xs mx-auto leading-relaxed">
                    To claim a business, search for it on WorkSphere and click "Claim Listing" from the info page.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {managedVenues.map((venue) => (
                    <button
                      key={venue.id}
                      onClick={() => {
                        setSelectedVenue(venue);
                        setEditName(venue.name);
                        setEditAddress(venue.address || "");
                        setEditHours(venue.openingHours || "");
                        setEditHostMessage(venue.hostMessage || "");
                        setSuccessMsg("");
                        setErrorMsg("");
                      }}
                      className={`w-full text-left p-4 rounded-2xl border transition-all ${
                        selectedVenue?.id === venue.id
                          ? "bg-zinc-800 border-zinc-700 ring-1 ring-zinc-700"
                          : "bg-zinc-950/40 border-zinc-850/60 hover:bg-zinc-800/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <span className="font-bold text-sm text-white truncate">{venue.name}</span>
                        <BadgeCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      </div>
                      <p className="text-xs text-zinc-400 truncate flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-zinc-500" />
                        <span>{venue.address}</span>
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: editing dashboard for selected claimed venue */}
          <div className="lg:col-span-2">
            {selectedVenue ? (
              <div className="bg-zinc-900 border border-zinc-850 rounded-3xl p-8 space-y-6">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                      <span>Edit {selectedVenue.name}</span>
                      <BadgeCheck className="w-5 h-5 text-emerald-400" />
                    </h2>
                    <p className="text-xs text-zinc-400">Modify details for your verified listing.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Host Message Section */}
                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-5 space-y-3">
                    <label className="block text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4" />
                      <span>Host Message (Pinned to listing overview)</span>
                    </label>
                    <textarea
                      value={editHostMessage}
                      onChange={(e) => setEditHostMessage(e.target.value)}
                      placeholder="e.g. WorkSphere users get 10% off pastries! or WiFi password is workspace101"
                      rows={3}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                    />
                    <p className="text-[10px] text-zinc-500">
                      Promote special offers, share updates, or provide useful tips to remote workers.
                    </p>
                  </div>

                  {/* Basic Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        Business Name
                      </label>
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-700"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        Opening Hours
                      </label>
                      <input
                        type="text"
                        value={editHours}
                        onChange={(e) => setEditHours(e.target.value)}
                        placeholder="e.g. Mon-Fri: 8am - 6pm"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-700"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider">
                      Address
                    </label>
                    <input
                      type="text"
                      value={editAddress}
                      onChange={(e) => setEditAddress(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3.5 text-sm text-zinc-200 focus:outline-none focus:border-zinc-700"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 border-t border-zinc-800 pt-6">
                  <button
                    onClick={() => {
                      setSelectedVenue(null);
                      setSuccessMsg("");
                      setErrorMsg("");
                    }}
                    className="px-6 py-3 bg-zinc-950 hover:bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white text-xs font-bold rounded-xl transition-all active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleUpdate}
                    disabled={updating}
                    className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center gap-2"
                  >
                    {updating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>Save Changes</>
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-zinc-900/40 border-2 border-dashed border-zinc-800 rounded-3xl p-12 text-center text-zinc-500 flex flex-col items-center justify-center min-h-[400px]">
                <Building2 className="w-12 h-12 text-zinc-700 mb-4" />
                <h3 className="text-md font-bold text-zinc-400 mb-1">No business selected</h3>
                <p className="text-xs max-w-sm leading-relaxed">
                  Select a business from your claimed list or confirm ownership to edit listing features.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VenueAdminPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 text-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500 mb-2" />
        <p className="text-sm text-zinc-400">Loading portal...</p>
      </div>
    }>
      <VenueAdminContent />
    </Suspense>
  );
}
