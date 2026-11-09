"use client";

import { useMemo, useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  Clock3,
  MapPin,
  Navigation,
  Share2,
  UsersRound,
  Link2,
  ShieldCheck,
  AlertCircle,
  Ticket,
} from "lucide-react";
import ScreenSharePanel from "@/components/sessions/ScreenSharePanel";
import Scratchpad from "@/components/sessions/Scratchpad";
import { MeshCallGrid } from "@/components/audio/MeshCallGrid";
import {
  generateSessionInviteToken,
  validateSessionInviteToken,
  ValidationResult,
} from "@/lib/sessionInviteTokens";
import { SocialShareButton } from "@/components/social/SocialShareButton";
import { generateAdmissionTicketQR } from "@/lib/social/admissionTicket";

type Props = {
  session: {
    slug: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    maxGuests: number | null;
    host: {
      id: string;
      firstName: string | null;
      lastName: string | null;
    };
    venue: {
      name: string;
      address: string | null;
      latitude: number;
      longitude: number;
      category: string;
    };
    rsvps: Array<{
      status: "GOING" | "MAYBE" | "DECLINED";
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        imageUrl: string | null;
      };
    }>;
  };
};

export default function SessionDetailClient({ session }: Props) {
  const { user } = useUser();
  const searchParams = useSearchParams();
  const [rsvps, setRsvps] = useState(session.rsvps);
  const [message, setMessage] = useState("");
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [inviteValidation, setInviteValidation] =
    useState<ValidationResult | null>(null);
  const [showCalendarPrompt, setShowCalendarPrompt] = useState(false);
  const [calendarDownloadUrl, setCalendarDownloadUrl] = useState<string | null>(null);

  const going = useMemo(
    () => rsvps.filter((item) => item.status === "GOING"),
    [rsvps],
  );

  const waitlisted = useMemo(
    () => rsvps.filter((item) => item.status === "MAYBE"),
    [rsvps],
  );

  const currentRsvp = useMemo(
    () => (user?.id ? rsvps.find((r) => r.user.id === user.id) : null),
    [rsvps, user?.id],
  );

  const waitlistPosition = useMemo(() => {
    if (!user?.id || currentRsvp?.status !== "MAYBE") return null;
    const idx = waitlisted.findIndex((r) => r.user.id === user.id);
    return idx !== -1 ? idx + 1 : null;
  }, [waitlisted, user?.id, currentRsvp?.status]);

  // Real-time polling to refresh RSVPs and waitlist positions (#5035)
  useEffect(() => {
    let mounted = true;
    const interval = setInterval(async () => {
      try {
        const refreshed = await fetch(`/api/social/sessions/${session.slug}`, {
          cache: "no-store",
        });
        if (refreshed.ok && mounted) {
          const data = await refreshed.json();
          if (data.rsvps) {
            setRsvps(data.rsvps);
          }
        }
      } catch {
        // Silently ignore background polling errors
      }
    }, 10000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [session.slug]);

  const attendeeId = user?.id || currentRsvp?.user?.id || "attendee";
  const ticketQrSvg = useMemo(() => {
    return generateAdmissionTicketQR({
      sessionSlug: session.slug,
      userId: attendeeId,
      venueName: session.venue?.name,
      startsAt: session.startsAt,
    });
  }, [attendeeId, session.slug, session.venue?.name, session.startsAt]);

  const isFull = Boolean(session.maxGuests && going.length >= session.maxGuests);

  const inviteTokenParam = searchParams?.get("inviteToken");

  useEffect(() => {
    if (inviteTokenParam) {
      const result = validateSessionInviteToken(
        inviteTokenParam,
        going.length,
        session.slug,
      );
      setInviteValidation(result);
    }
  }, [inviteTokenParam, going.length, session.slug]);

  const hostName =
    [session.host.firstName, session.host.lastName].filter(Boolean).join(" ") ||
    "WorkSphere member";

  async function respond(status: "GOING" | "MAYBE" | "DECLINED") {
    setMessage("");

    const response = await fetch(`/api/social/sessions/${session.slug}/rsvp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to update RSVP");
      return;
    }

    if (status === "DECLINED") {
      setMessage("RSVP cancelled.");
      setShowCalendarPrompt(false);
    } else {
      setMessage(`RSVP updated: ${status.toLowerCase()}.`);
      if (status === "GOING") {
        setShowCalendarPrompt(true);
        if (payload.calendar?.downloadUrl) {
          setCalendarDownloadUrl(payload.calendar.downloadUrl);
        }
      } else {
        setShowCalendarPrompt(false);
      }
    }

    const refreshed = await fetch(`/api/social/sessions/${session.slug}`, {
      cache: "no-store",
    });

    if (refreshed.ok) {
      const data = await refreshed.json();
      setRsvps(data.rsvps);
    }
  }

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({
        title: session.title,
        text: `Join me at ${session.venue.name}`,
        url,
      });
    } else {
      await navigator.clipboard.writeText(url);
      setMessage("Session link copied.");
    }
  }

  async function copyInviteLink() {
    try {
      const token = await generateSessionInviteToken(
        session.slug,
        24,
        session.maxGuests || undefined,
      );
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const inviteUrl = `${origin}/sessions/${session.slug}?inviteToken=${token}`;

      await navigator.clipboard.writeText(inviteUrl);
      setCopiedInvite(true);
      setMessage(
        "Secure invite link copied to clipboard! (Expires in 24 hours)",
      );
      setTimeout(() => setCopiedInvite(false), 3000);
    } catch (err) {
      console.error("Failed to generate invite link:", err);
      setMessage("Failed to generate invite link.");
    }
  }

  return (
    <main className="min-h-screen bg-[#07070a] px-5 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
          <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-950/70 via-zinc-950 to-cyan-950/30 p-7 md:p-10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-200">
                Group coworking session
              </span>
              {currentRsvp && (
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium border ${
                    currentRsvp.status === "GOING"
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                      : currentRsvp.status === "MAYBE"
                      ? "border-amber-500/30 bg-amber-500/15 text-amber-300"
                      : "border-zinc-500/30 bg-zinc-500/15 text-zinc-300"
                  }`}
                >
                  Your status: {currentRsvp.status === "MAYBE" ? "Waitlisted / Maybe" : currentRsvp.status}
                </span>
              )}
              {currentRsvp?.status === "MAYBE" && waitlistPosition !== null && (
                <span
                  data-testid="waitlist-position-badge"
                  className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-200"
                >
                  Waitlist Position: #{waitlistPosition} of {waitlisted.length}
                </span>
              )}
            </div>

            <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">
              {session.title}
            </h1>

            <p className="mt-4 text-zinc-400">Hosted by {hostName}</p>

            {session.description && (
              <p className="mt-7 max-w-2xl text-lg leading-8 text-zinc-300">
                {session.description}
              </p>
            )}

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Info
                icon={<CalendarDays className="h-5 w-5" />}
                title="Starts"
                value={new Date(session.startsAt).toLocaleString()}
              />
              <Info
                icon={<Clock3 className="h-5 w-5" />}
                title="Ends"
                value={new Date(session.endsAt).toLocaleString()}
              />
              <Info
                icon={<MapPin className="h-5 w-5" />}
                title="Workspace"
                value={session.venue.name}
              />
              <Info
                icon={<UsersRound className="h-5 w-5" />}
                title="Attendance"
                value={`${going.length}${session.maxGuests ? ` / ${session.maxGuests}` : ""} going${waitlisted.length > 0 ? ` (${waitlisted.length} waitlisted)` : ""}`}
              />
            </div>

            {inviteValidation && (
              <div
                className={`mt-4 flex items-center gap-3 p-4 rounded-xl border ${
                  inviteValidation.valid
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                    : "border-red-500/30 bg-red-500/10 text-red-200"
                }`}
              >
                {inviteValidation.valid ? (
                  <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
                ) : (
                  <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
                )}
                <div className="text-sm">
                  {inviteValidation.valid ? (
                    <span>
                      <strong className="font-semibold">
                        Private Invite Verified:
                      </strong>{" "}
                      You accessed this session via a valid invite link.
                    </span>
                  ) : (
                    <span>
                      <strong className="font-semibold">
                        Invite Link Invalid:
                      </strong>{" "}
                      {inviteValidation.error}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mt-8 flex flex-wrap gap-3">
              {!isFull && (
                <button
                  onClick={() => respond("GOING")}
                  className={`rounded-xl px-5 py-3 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                    currentRsvp?.status === "GOING"
                      ? "bg-emerald-600 text-white hover:bg-emerald-500"
                      : "bg-violet-600 hover:bg-violet-500"
                  }`}
                >
                  {currentRsvp?.status === "GOING" ? "Going (Confirmed)" : "I’m going"}
                </button>
              )}
              <button
                onClick={() => respond("MAYBE")}
                className={`rounded-xl border border-white/10 px-5 py-3 font-medium transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900 ${
                  currentRsvp?.status === "MAYBE"
                    ? "bg-amber-500/20 text-amber-200 border-amber-500/40"
                    : "bg-white/5"
                }`}
              >
                {isFull ? "Join Waitlist (Maybe)" : "Maybe"}
              </button>
              {currentRsvp && currentRsvp.status !== "DECLINED" && (
                <button
                  onClick={() => respond("DECLINED")}
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 font-medium text-red-300 hover:bg-red-500/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
                >
                  Cancel RSVP
                </button>
              )}
              <SocialShareButton className="px-5 py-3" />
              <button
                onClick={share}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-medium hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
              >
                <Share2 className="h-4 w-4" /> Share
              </button>
              <button
                onClick={copyInviteLink}
                className="inline-flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/15 px-5 py-3 font-medium text-violet-200 hover:bg-violet-500/25 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
                title="Generate and copy WebCrypto secure invite link"
              >
                {copiedInvite ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-400" /> Copied!
                  </>
                ) : (
                  <>
                    <Link2 className="h-4 w-4" /> Copy Invite Link
                  </>
                )}
              </button>
            </div>

            {message && (
              <p className="mt-4 text-sm text-violet-200">{message}</p>
            )}

            {/* Waitlist Status & Position Banner (#5035) */}
            {currentRsvp?.status === "MAYBE" && waitlistPosition !== null && (
              <div
                data-testid="waitlist-status-card"
                className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 backdrop-blur-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
                    <Clock3 className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-amber-200">
                      You are on the Waitlist
                    </h4>
                    <p className="text-xs text-zinc-400">
                      You will be automatically promoted if an attendee cancels their spot.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/30 px-4 py-2">
                  <span className="text-xs text-amber-300/80 font-medium">Position</span>
                  <span
                    data-testid="waitlist-position-counter"
                    className="text-sm font-bold text-amber-200 font-mono"
                  >
                    #{waitlistPosition} of {waitlisted.length}
                  </span>
                </div>
              </div>
            )}

            {/* RSVP Confirmation, Calendar Export & Ticket Display (#4953, #5066) */}
            {(showCalendarPrompt || currentRsvp?.status === "GOING") && (
              <div
                data-testid="rsvp-confirmation-dialog"
                className="mt-6 flex flex-col gap-5 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 backdrop-blur-sm"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-300">
                      <CalendarPlus className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-emerald-200">
                        RSVP Confirmed — You're attending!
                      </h4>
                      <p className="text-xs text-zinc-400">
                        Sync this session with Apple Calendar, Outlook, or Google Calendar.
                      </p>
                    </div>
                  </div>
                  <a
                    href={
                      calendarDownloadUrl ||
                      `/api/social/sessions/${session.slug}/rsvp?download=ics`
                    }
                    download={`${session.slug}.ics`}
                    data-testid="add-to-calendar-btn"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-500 active:scale-95"
                  >
                    <CalendarPlus className="h-4 w-4" />
                    <span>Add to Calendar (.ics)</span>
                  </a>
                </div>

                {/* Attendee Admission Ticket Card (#5066) */}
                <div
                  data-testid="attendee-ticket-card"
                  className="rounded-xl border border-emerald-500/25 bg-zinc-950/70 p-4 flex flex-col sm:flex-row items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 text-left w-full sm:w-auto">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">
                      <Ticket className="w-3 h-3" />
                      <span>Attendee Admission Ticket</span>
                    </div>
                    <h5 className="text-sm font-bold text-white">
                      {session.title}
                    </h5>
                    <div className="flex flex-col gap-1 text-xs text-zinc-400">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                        <span data-testid="ticket-venue">{session.venue?.name}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <CalendarDays className="w-3.5 h-3.5 text-emerald-400" />
                        <span data-testid="ticket-date">
                          {new Date(session.startsAt).toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-1.5 bg-white p-2.5 rounded-xl shrink-0 shadow-sm">
                    <div
                      data-testid="ticket-qr-code"
                      dangerouslySetInnerHTML={{ __html: ticketQrSvg }}
                      className="flex items-center justify-center"
                    />
                    <span className="text-[9px] font-mono font-semibold text-zinc-700 tracking-wider uppercase">
                      Scan to Check In
                    </span>
                  </div>
                </div>
              </div>
            )}

            <ScreenSharePanel
              sessionSlug={session.slug}
              hostId={session.host.id}
              currentUserId={user?.id}
            />

            <div className="mt-8">
              <MeshCallGrid
                sessionSlug={session.slug}
                hostId={session.host.id}
              />
            </div>

            <div className="mt-8">
              <Scratchpad sessionId={session.slug} />
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
              <h2 className="text-lg font-semibold">Location</h2>
              <p className="mt-2 text-sm text-zinc-400">
                {session.venue.address}
              </p>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
                <div>Lat: {session.venue.latitude.toFixed(5)}</div>
                <div className="mt-1">
                  Lng: {session.venue.longitude.toFixed(5)}
                </div>
              </div>

              <a
                href={`https://www.openstreetmap.org/?mlat=${session.venue.latitude}&mlon=${session.venue.longitude}#map=17/${session.venue.latitude}/${session.venue.longitude}`}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-500/10 px-4 py-3 text-sm font-medium text-cyan-200 hover:bg-cyan-500/15"
              >
                <Navigation className="h-4 w-4" />
                Open route map
              </a>
            </div>

            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
              <h2 className="text-lg font-semibold">Who’s going ({going.length})</h2>
              <div className="mt-4 space-y-3">
                {going.length === 0 ? (
                  <p className="text-xs text-zinc-500">No confirmed attendees yet.</p>
                ) : (
                  going.map((item) => {
                    const name =
                      [item.user.firstName, item.user.lastName]
                        .filter(Boolean)
                        .join(" ") || "WorkSphere member";

                    return (
                      <div key={item.user.id} className="flex items-center gap-3">
                        {item.user.imageUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={item.user.imageUrl}
                            alt={name}
                            className="h-9 w-9 rounded-full object-cover border border-white/10"
                          />
                        ) : (
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-500/15 text-violet-200">
                            <Check className="h-4 w-4" />
                          </span>
                        )}
                        <span className="text-sm text-zinc-300">{name}</span>
                      </div>
                    );
                  })
                )}
              </div>

              {waitlisted.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/10">
                  <h3 className="text-sm font-semibold text-amber-300 flex items-center justify-between">
                    <span>Waitlist Queue ({waitlisted.length})</span>
                    <span className="text-[10px] font-normal text-amber-300/70">Auto-promoted on cancel</span>
                  </h3>
                  <div className="mt-3 space-y-2">
                    {waitlisted.map((item, idx) => {
                      const isCurrentUser = Boolean(user?.id && item.user.id === user.id);
                      const name =
                        [item.user.firstName, item.user.lastName]
                          .filter(Boolean)
                          .join(" ") || "WorkSphere member";

                      return (
                        <div
                          key={item.user.id}
                          data-testid={isCurrentUser ? "user-waitlist-entry" : undefined}
                          className={`flex items-center justify-between text-xs rounded-lg px-2 py-1.5 transition ${
                            isCurrentUser
                              ? "bg-amber-500/15 border border-amber-500/30 text-amber-200 font-medium"
                              : "text-zinc-400"
                          }`}
                        >
                          <span className="truncate">
                            {name} {isCurrentUser && "(You)"}
                          </span>
                          <span
                            className={`font-mono ${
                              isCurrentUser ? "text-amber-300 font-bold" : "text-zinc-500"
                            }`}
                          >
                            #{idx + 1}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Info({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center gap-2 text-violet-300">
        {icon}
        <span className="text-xs uppercase tracking-wider">{title}</span>
      </div>
      <p className="mt-2 text-sm text-zinc-300">{value}</p>
    </div>
  );
}
