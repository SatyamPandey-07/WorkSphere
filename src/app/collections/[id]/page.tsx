"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Users,
  Mail,
  Copy,
  Trash2,
  MapPin,
  Loader2,
  Globe,
  FileDown,
} from "lucide-react";

import usePartySocket from "partysocket/react";
import Image from "next/image";
import { ComparisonTool } from "@/components/collections/ComparisonTool";
import { EmptyState } from "@/components/ui/EmptyState";

export default function FolderDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const { id } = resolvedParams;
  const [folder, setFolder] = useState<any>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"EDITOR" | "MEMBER">("EDITOR");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);
  const [updatingPublic, setUpdatingPublic] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [filters, setFilters] = useState({
    hasOutlets: false,
    wifiQualityMin: false,
    quietOnly: false,
  });

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleExportBilling = async () => {
    try {
      setExporting(true);
      const response = await fetch(`/api/folders/${id}/export-billing`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `billing-export-${folder.name.toLowerCase().replace(/\s+/g, "-")}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Billing export error:", error);
      alert("Failed to export billing codes. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const handleExportPdf = async () => {
    try {
      setExportingPdf(true);
      const response = await fetch(`/api/folders/${id}/export-pdf`);
      if (!response.ok) throw new Error("PDF export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `collection-${folder.name.toLowerCase().replace(/\s+/g, "-")}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("PDF export error:", error);
      alert("Failed to export PDF. Please try again.");
    } finally {
      setExportingPdf(false);
    }
  };

  const fetchFolder = useCallback(async () => {
    try {
      const res = await fetch(`/api/folders/${id}`);
      const data = await res.json();
      if (data.folder) {
        setFolder(data.folder);
        setUserRole(data.role || null);
      } else {
        setError(data.error || "Failed to load folder");
      }
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchFolder();
  }, [fetchFolder]);

  const togglePublic = async () => {
    if (!folder) return;
    setUpdatingPublic(true);
    try {
      const res = await fetch(`/api/folders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: !folder.isPublic }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.folder) {
          setFolder((prev: any) => ({
            ...prev,
            isPublic: data.folder.isPublic,
          }));
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setUpdatingPublic(false);
    }
  };

  // Real-time synchronization
  usePartySocket({
    host: process.env.NEXT_PUBLIC_PARTYKIT_HOST || "127.0.0.1:1999",
    room: isMounted && id ? `folder-${id}` : "folder-room",
    startClosed: !isMounted || !id,
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "refresh") {
          fetchFolder();
        }
      } catch {
        // ignore
      }
    },
  });

  const sendInvite = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSendingInvite(true);
    setInviteMessage("");
    setInviteLink("");

    try {
      const response = await fetch(`/api/folders/${id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await response.json();

      if (!response.ok) {
        setInviteMessage(data.error || "Unable to invite teammate");
        return;
      }

      setInviteMessage(data.message || "Invitation created.");
      setInviteLink(data.invite?.inviteUrl || "");
      setInviteEmail("");
      await fetchFolder();
    } catch (error) {
      console.error(error);
      setInviteMessage("Unable to invite teammate");
    } finally {
      setSendingInvite(false);
    }
  };

  const removeVenue = async (venueId: string) => {
    try {
      const res = await fetch(`/api/folders/${id}/venues/${venueId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        fetchFolder();
        // Trigger a broadcast
        await fetch("http://127.0.0.1:1999/parties/main/folder-" + id, {
          method: "POST",
          body: JSON.stringify({ type: "refresh" }),
        }).catch(() => {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );

  if (error || !folder)
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
        <p>{error}</p>
        <Link href="/collections" className="mt-4 accent-text hover:underline">
          Back to Collections
        </Link>
      </div>
    );

  const filteredVenues = folder.venues.filter((fv: any) => {
    if (filters.hasOutlets && !fv.venue.hasOutlets) return false;
    if (filters.wifiQualityMin && fv.venue.wifiQuality < 4) return false;
    if (filters.quietOnly && fv.venue.noiseLevel !== "quiet") return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 lg:p-8 pt-8">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/collections"
            className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
              {folder.name}
            </h1>
            {folder.description && (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                {folder.description}
              </p>
            )}
          </div>
        </div>

        <ComparisonTool currentFolder={folder} />

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
          <div className="md:col-span-2 lg:col-span-3 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-500" /> Saved Venues (
              {filteredVenues.length})
            </h2>

            {folder.venues.length === 0 ? (
              <EmptyState
                illustration="collection"
                message="No venues saved"
                description="Add venues to this collection from the map."
              />
            ) : filteredVenues.length === 0 ? (
              <EmptyState
                illustration="search"
                message="No venues match your filters"
                description="Try unchecking a filter to see more results."
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredVenues.map((fv: any) => (
                  <div
                    key={fv.id}
                    className="flex gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm relative group"
                  >
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">
                      {fv.venue.imageUrl ? (
                        <Image
                          src={fv.venue.imageUrl}
                          alt={fv.venue.name}
                          width={96}
                          height={96}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-400">
                          <MapPin className="w-8 h-8" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3
                        className="text-lg font-bold text-zinc-900 dark:text-white mb-1 truncate"
                        title={fv.venue.name}
                      >
                        {fv.venue.name}
                      </h3>
                      <p className="text-sm text-zinc-500 line-clamp-1">
                        {fv.venue.address}
                      </p>
                      <div className="mt-2 text-xs text-zinc-400 flex items-center gap-2">
                        Added by {fv.addedBy.firstName || "Unknown"}
                      </div>
                    </div>
                    {userRole !== "VIEWER" && (
                      <button
                        onClick={() => removeVenue(fv.venueId)}
                        className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-1 space-y-6">
            {/* Filter Venues Section */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                Filter Venues
              </h2>
              <div className="space-y-3 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.hasOutlets}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        hasOutlets: e.target.checked,
                      }))
                    }
                    className="rounded"
                  />
                  Has Outlets
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.wifiQualityMin}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        wifiQualityMin: e.target.checked,
                      }))
                    }
                    className="rounded"
                  />
                  Good WiFi (4+)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={filters.quietOnly}
                    onChange={(e) =>
                      setFilters((f) => ({ ...f, quietOnly: e.target.checked }))
                    }
                    className="rounded"
                  />
                  Quiet Only
                </label>
              </div>
            </div>

            {/* PDF Export */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                <FileDown className="w-5 h-5 text-blue-500" /> Export Report
              </h2>
              <p className="text-xs text-zinc-500 mb-4">
                Download a PDF summary of venues in this collection for team
                sharing.
              </p>
              <button
                onClick={handleExportPdf}
                disabled={exportingPdf}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl text-sm transition-all disabled:opacity-50 shadow-lg shadow-blue-500/20 active:scale-[0.98]"
              >
                {exportingPdf ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileDown className="w-4 h-4" />
                )}
                Export to PDF
              </button>
            </div>

            {/* Billing Export Section */}
            {userRole !== "VIEWER" && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                  <FileDown className="w-5 h-5 text-emerald-500" /> Billing &
                  Audit
                </h2>
                <p className="text-xs text-zinc-500 mb-4">
                  Export all confirmed bookings within this workspace folder as
                  a CSV formatted for corporate billing software.
                </p>
                <button
                  onClick={handleExportBilling}
                  disabled={exporting}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl text-sm transition-all disabled:opacity-50 shadow-lg shadow-emerald-500/20 active:scale-[0.98]"
                >
                  {exporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                  Export Expense Codes
                </button>
              </div>
            )}

            {/* Share / Public Settings Toggle */}
            {userRole === "OWNER" && (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                  <Globe className="w-5 h-5 accent-text" /> Share Settings
                </h2>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-zinc-900 dark:text-white">
                      Public Directory
                    </p>
                    <p className="text-xs text-zinc-500">
                      Allow community to discover and upvote
                    </p>
                  </div>
                  <button
                    onClick={togglePublic}
                    disabled={updatingPublic}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.8)] ${
                      folder.isPublic
                        ? "accent-bg"
                        : "bg-zinc-200 dark:bg-zinc-800"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        folder.isPublic ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {userRole === "VIEWER" && (
              <div className="accent-bg-10 accent-bg-dark-30 accent-border accent-border-dark-30 rounded-2xl p-5 shadow-sm text-center">
                <Globe className="w-8 h-8 accent-text mx-auto mb-2 animate-pulse" />
                <h3 className="text-sm font-semibold accent-text">
                  Public Collection
                </h3>
                <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">
                  You are discovering this list shared by a WorkSphere community
                  member.
                </p>
              </div>
            )}

            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-purple-500" /> Team Members
              </h2>
              <div className="space-y-3 mb-6">
                {folder.members.map((member: any) => (
                  <div key={member.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden shrink-0">
                      {member.user.imageUrl && (
                        <Image
                          src={member.user.imageUrl}
                          alt={member.user.firstName}
                          width={32}
                          height={32}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">
                        {member.user.firstName} {member.user.lastName}
                      </p>
                      <p className="text-xs text-zinc-500">{member.role}</p>
                    </div>
                  </div>
                ))}
              </div>

              {userRole !== "VIEWER" && (
                <form
                  onSubmit={sendInvite}
                  className="border-t border-zinc-200 dark:border-zinc-800 pt-4 space-y-3"
                >
                  <div>
                    <h3 className="text-sm font-medium text-zinc-900 dark:text-white flex items-center gap-2">
                      <Mail className="w-4 h-4 accent-text" /> Invite teammate
                    </h3>
                    <p className="mt-1 text-xs text-zinc-500">
                      Invite by email as an editor or read-only viewer.
                    </p>
                  </div>

                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@example.com"
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[var(--primary-accent)] dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                  />

                  <select
                    value={inviteRole}
                    onChange={(event) =>
                      setInviteRole(event.target.value as "EDITOR" | "MEMBER")
                    }
                    className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[var(--primary-accent)] dark:border-zinc-800 dark:bg-zinc-950 dark:text-white"
                  >
                    <option value="EDITOR">
                      Editor — can add or remove venues
                    </option>
                    <option value="MEMBER">Viewer — read only</option>
                  </select>

                  <button
                    type="submit"
                    disabled={sendingInvite}
                    className="w-full flex items-center justify-center gap-2 rounded-xl accent-bg px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
                  >
                    {sendingInvite && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    {sendingInvite ? "Sending invitation…" : "Send invitation"}
                  </button>

                  {inviteMessage && (
                    <p className="rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
                      {inviteMessage}
                    </p>
                  )}

                  {inviteLink && (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(inviteLink)}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs font-medium accent-text accent-bg-hover accent-bg-dark-20 dark:border-zinc-800"
                    >
                      <Copy className="w-4 h-4" /> Copy fallback invite link
                    </button>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
