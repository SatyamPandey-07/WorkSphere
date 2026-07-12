"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Users, Link as LinkIcon, Trash2, MapPin, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import usePartySocket from "partysocket/react";
import Image from "next/image";

export default function FolderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const { id } = resolvedParams;
  const router = useRouter();
  
  const [folder, setFolder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [generatingInvite, setGeneratingInvite] = useState(false);

  const fetchFolder = useCallback(async () => {
    try {
      const res = await fetch(`/api/folders/${id}`);
      const data = await res.json();
      if (data.folder) {
        setFolder(data.folder);
        if (data.folder.inviteToken) {
           setInviteToken(data.folder.inviteToken);
        }
      } else {
        setError(data.error || "Failed to load folder");
      }
    } catch (e) {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchFolder();
  }, [fetchFolder]);

  // Real-time synchronization
  usePartySocket({
    host: "127.0.0.1:1999",
    room: `folder-${id}`,
    onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "refresh") {
          fetchFolder();
        }
      } catch (e) {
        // ignore
      }
    },
  });

  const generateInvite = async () => {
    setGeneratingInvite(true);
    try {
      const res = await fetch(`/api/folders/${id}/invites`, { method: "POST" });
      const data = await res.json();
      if (data.inviteToken) {
        setInviteToken(data.inviteToken);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingInvite(false);
    }
  };

  const removeVenue = async (venueId: string) => {
    try {
      const res = await fetch(`/api/folders/${id}/venues/${venueId}`, { method: "DELETE" });
      if (res.ok) {
        fetchFolder();
        // Trigger a broadcast
        await fetch("http://127.0.0.1:1999/parties/main/folder-" + id, {
          method: "POST",
          body: JSON.stringify({ type: "refresh" })
        }).catch(() => {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getInviteLink = () => {
    if (typeof window === "undefined" || !inviteToken) return "";
    return `${window.location.origin}/collections/join?token=${inviteToken}`;
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950">
      <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
    </div>
  );

  if (error || !folder) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-50">
      <p>{error}</p>
      <Link href="/collections" className="mt-4 text-blue-500 hover:underline">Back to Collections</Link>
    </div>
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 lg:p-8 pt-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
           <Link href="/collections" className="p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 transition-colors">
              <ArrowLeft className="w-5 h-5" />
           </Link>
           <div>
              <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                {folder.name}
              </h1>
              {folder.description && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">{folder.description}</p>
              )}
           </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-500" /> Saved Venues ({folder.venues.length})
            </h2>
            
            {folder.venues.length === 0 ? (
              <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-12 text-center shadow-sm">
                <MapPin className="w-12 h-12 text-zinc-300 dark:text-zinc-700 mx-auto mb-3" />
                <h3 className="text-lg font-medium text-zinc-900 dark:text-white mb-1">No venues saved</h3>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">Add venues to this collection from the map.</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {folder.venues.map((fv: any) => (
                  <div key={fv.id} className="flex gap-4 p-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-sm relative group">
                    <div className="w-24 h-24 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">
                       {fv.venue.imageUrl ? (
                         <Image src={fv.venue.imageUrl} alt={fv.venue.name} width={96} height={96} className="w-full h-full object-cover" />
                       ) : (
                         <div className="w-full h-full flex items-center justify-center text-zinc-400"><MapPin className="w-8 h-8" /></div>
                       )}
                    </div>
                    <div className="flex-1">
                       <h3 className="text-lg font-bold text-zinc-900 dark:text-white mb-1">{fv.venue.name}</h3>
                       <p className="text-sm text-zinc-500 line-clamp-1">{fv.venue.address}</p>
                       <div className="mt-2 text-xs text-zinc-400 flex items-center gap-2">
                          Added by {fv.addedBy.firstName || 'Unknown'}
                       </div>
                    </div>
                    <button 
                      onClick={() => removeVenue(fv.venueId)}
                      className="absolute top-4 right-4 p-2 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="md:col-span-1 space-y-6">
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-white flex items-center gap-2 mb-4">
                <Users className="w-5 h-5 text-purple-500" /> Team Members
              </h2>
              <div className="space-y-3 mb-6">
                {folder.members.map((member: any) => (
                  <div key={member.id} className="flex items-center gap-3">
                     <div className="w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden shrink-0">
                        {member.user.imageUrl && (
                          <Image src={member.user.imageUrl} alt={member.user.firstName} width={32} height={32} className="w-full h-full object-cover" />
                        )}
                     </div>
                     <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zinc-900 dark:text-white truncate">{member.user.firstName} {member.user.lastName}</p>
                        <p className="text-xs text-zinc-500">{member.role}</p>
                     </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-zinc-200 dark:border-zinc-800 pt-4">
                <h3 className="text-sm font-medium text-zinc-900 dark:text-white mb-2">Invite Link</h3>
                {inviteToken ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                      <LinkIcon className="w-4 h-4 text-zinc-400 shrink-0" />
                      <input 
                        readOnly 
                        value={getInviteLink()} 
                        className="bg-transparent border-none outline-none text-xs text-zinc-600 dark:text-zinc-400 flex-1 min-w-0"
                      />
                    </div>
                    <button
                      onClick={() => navigator.clipboard.writeText(getInviteLink())}
                      className="text-xs text-blue-500 hover:underline"
                    >
                      Copy Link
                    </button>
                    <button
                      onClick={generateInvite}
                      disabled={generatingInvite}
                      className="ml-4 text-xs text-zinc-500 hover:underline"
                    >
                      {generatingInvite ? 'Generating...' : 'Regenerate'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={generateInvite}
                    disabled={generatingInvite}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white font-medium rounded-xl text-sm transition-all"
                  >
                    {generatingInvite ? <Loader2 className="w-4 h-4 animate-spin" /> : "Generate Invite Link"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
