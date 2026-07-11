"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  MapPin,
  RefreshCw,
  Share2,
  Sparkles,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";

type Venue = {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  category: string;
  imageUrl?: string | null;
};

type Status = {
  id: string;
  note: string | null;
  until: string;
  user: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  venue: Venue;
};

type Session = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  maxGuests: number | null;
  venue: Venue;
  host: {
    id: string;
    firstName: string | null;
    lastName: string | null;
  };
  _count: {
    rsvps: number;
  };
};

function displayName(user: { firstName: string | null; lastName: string | null }) {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "WorkSphere member";
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function SocialWorkspaceClient() {
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [tab, setTab] = useState<"pulse" | "sessions">("pulse");
  const [statusOpen, setStatusOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    const [statusResponse, sessionResponse, venueResponse] = await Promise.all([
      fetch("/api/social/status", { cache: "no-store" }),
      fetch("/api/social/sessions", { cache: "no-store" }),
      fetch("/api/venues", { cache: "no-store" }),
    ]);

    if (statusResponse.ok) setStatuses(await statusResponse.json());
    if (sessionResponse.ok) setSessions(await sessionResponse.json());

    if (venueResponse.ok) {
      const venuePayload = await venueResponse.json();
      setVenues(Array.isArray(venuePayload) ? venuePayload : venuePayload.venues ?? []);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submitStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/social/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venueId: form.get("venueId"),
        note: form.get("note"),
        until: form.get("until"),
        isPublic: true,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to publish status");
    } else {
      setStatusOpen(false);
      setMessage("Your Work Buddy status is live.");
      await load();
    }

    setBusy(false);
  }

  async function submitSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const form = new FormData(event.currentTarget);

    const response = await fetch("/api/social/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        venueId: form.get("venueId"),
        startsAt: form.get("startsAt"),
        endsAt: form.get("endsAt"),
        maxGuests: Number(form.get("maxGuests")) || null,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setMessage(payload.error ?? "Unable to create session");
    } else {
      setSessionOpen(false);
      setMessage("Coworking session created.");
      await load();
    }

    setBusy(false);
  }

  const activeCount = useMemo(() => statuses.length, [statuses]);

  return (
    <main className="min-h-screen bg-[#07070a] text-white">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-violet-700/20 blur-[130px]" />
        <div className="absolute -right-40 top-1/3 h-96 w-96 rounded-full bg-cyan-700/10 blur-[130px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-5 py-8 md:px-8">
        <header className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-200">
              <Sparkles className="h-3.5 w-3.5" />
              Work together, not just nearby
            </div>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
              Coworking Social Hub
            </h1>
            <p className="mt-3 max-w-2xl text-zinc-400">
              Share where you are working, discover work buddies nearby, and turn a good workspace into a group session.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setStatusOpen(true)}
              className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-medium transition hover:bg-white/[0.1]"
            >
              Share my status
            </button>
            <button
              onClick={() => setSessionOpen(true)}
              className="rounded-2xl bg-violet-600 px-4 py-3 text-sm font-medium transition hover:bg-violet-500"
            >
              Create group session
            </button>
          </div>
        </header>

        {message && (
          <div className="mb-6 rounded-2xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
            {message}
          </div>
        )}

        <section className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <UserRoundCheck className="mb-4 h-6 w-6 text-emerald-300" />
            <div className="text-3xl font-semibold">{activeCount}</div>
            <div className="mt-1 text-sm text-zinc-500">active work statuses</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <UsersRound className="mb-4 h-6 w-6 text-violet-300" />
            <div className="text-3xl font-semibold">{sessions.length}</div>
            <div className="mt-1 text-sm text-zinc-500">upcoming group sessions</div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
            <MapPin className="mb-4 h-6 w-6 text-cyan-300" />
            <div className="text-3xl font-semibold">{venues.length}</div>
            <div className="mt-1 text-sm text-zinc-500">available workspace locations</div>
          </div>
        </section>

        <div className="mb-6 flex items-center justify-between">
          <div className="flex rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            <button
              onClick={() => setTab("pulse")}
              className={`rounded-xl px-4 py-2 text-sm transition ${tab === "pulse" ? "bg-white text-black" : "text-zinc-400"}`}
            >
              Work Buddy pulse
            </button>
            <button
              onClick={() => setTab("sessions")}
              className={`rounded-xl px-4 py-2 text-sm transition ${tab === "sessions" ? "bg-white text-black" : "text-zinc-400"}`}
            >
              Group sessions
            </button>
          </div>

          <button onClick={load} className="rounded-xl p-2 text-zinc-400 transition hover:bg-white/5 hover:text-white">
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>

        {tab === "pulse" ? (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {statuses.map((status) => (
              <article key={status.id} className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                <div className="mb-4 flex items-start justify-between">
                  <div>
                    <div className="font-medium">{displayName(status.user)}</div>
                    <div className="mt-1 text-sm text-zinc-500">is working now</div>
                  </div>
                  <span className="h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,.8)]" />
                </div>

                <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-violet-300" />
                    <div>
                      <div className="font-medium">{status.venue.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">{status.venue.address}</div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                    <Clock3 className="h-4 w-4" />
                    until {new Date(status.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>

                {status.note && (
                  <p className="mt-4 text-sm leading-6 text-zinc-300">“{status.note}”</p>
                )}

                <a
                  href={`https://www.openstreetmap.org/?mlat=${status.venue.latitude}&mlon=${status.venue.longitude}#map=17/${status.venue.latitude}/${status.venue.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-2 text-sm text-violet-300 hover:text-violet-200"
                >
                  Open location <ExternalLink className="h-4 w-4" />
                </a>
              </article>
            ))}

            {statuses.length === 0 && (
              <div className="col-span-full rounded-3xl border border-dashed border-white/10 p-10 text-center text-zinc-500">
                No one has shared a Work Buddy status yet.
              </div>
            )}
          </section>
        ) : (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sessions.map((session) => (
              <article key={session.id} className="overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04]">
                <div className="p-5">
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <span className="rounded-full bg-violet-400/10 px-3 py-1 text-xs text-violet-300">
                      {session.venue.category}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {session._count.rsvps} going
                    </span>
                  </div>

                  <h2 className="text-xl font-semibold">{session.title}</h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    Hosted by {displayName(session.host)}
                  </p>

                  {session.description && (
                    <p className="mt-4 line-clamp-3 text-sm leading-6 text-zinc-300">
                      {session.description}
                    </p>
                  )}

                  <div className="mt-5 space-y-3 border-t border-white/10 pt-4 text-sm">
                    <div className="flex gap-3 text-zinc-300">
                      <MapPin className="h-5 w-5 shrink-0 text-cyan-300" />
                      <div>
                        <div>{session.venue.name}</div>
                        <div className="mt-1 text-xs text-zinc-500">{session.venue.address}</div>
                      </div>
                    </div>
                    <div className="flex gap-3 text-zinc-300">
                      <CalendarDays className="h-5 w-5 shrink-0 text-violet-300" />
                      <span>{formatDate(session.startsAt)}</span>
                    </div>
                  </div>

                  <div className="mt-5 flex gap-2">
                    <a
                      href={`/sessions/${session.slug}`}
                      className="flex-1 rounded-xl bg-violet-600 px-4 py-2.5 text-center text-sm font-medium hover:bg-violet-500"
                    >
                      View & RSVP
                    </a>
                    <button
                      onClick={() => navigator.clipboard.writeText(`${window.location.origin}/sessions/${session.slug}`)}
                      className="rounded-xl border border-white/10 px-3 hover:bg-white/5"
                      title="Copy share link"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>

      {statusOpen && (
        <Modal title="Share your Work Buddy status" onClose={() => setStatusOpen(false)}>
          <form onSubmit={submitStatus} className="space-y-4">
            <Field label="Workspace">
              <select name="venueId" required className="input">
                <option value="">Choose a workspace</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What are you working on?">
              <input name="note" maxLength={160} placeholder="Deep work on a launch plan..." className="input" />
            </Field>
            <Field label="Working until">
              <input name="until" type="datetime-local" required className="input" />
            </Field>
            <button disabled={busy} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-medium hover:bg-violet-500 disabled:opacity-50">
              {busy ? "Publishing..." : "Publish status"}
            </button>
          </form>
        </Modal>
      )}

      {sessionOpen && (
        <Modal title="Create a group coworking session" onClose={() => setSessionOpen(false)}>
          <form onSubmit={submitSession} className="space-y-4">
            <Field label="Session title">
              <input name="title" required maxLength={100} placeholder="Friday focus sprint" className="input" />
            </Field>
            <Field label="Workspace">
              <select name="venueId" required className="input">
                <option value="">Choose a workspace</option>
                {venues.map((venue) => (
                  <option key={venue.id} value={venue.id}>
                    {venue.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Starts">
                <input name="startsAt" type="datetime-local" required className="input" />
              </Field>
              <Field label="Ends">
                <input name="endsAt" type="datetime-local" required className="input" />
              </Field>
            </div>
            <Field label="Description">
              <textarea name="description" rows={3} maxLength={500} placeholder="Bring headphones. We'll do two focus blocks and a coffee break." className="input resize-none" />
            </Field>
            <Field label="Maximum guests (optional)">
              <input name="maxGuests" type="number" min={1} max={100} className="input" />
            </Field>
            <button disabled={busy} className="w-full rounded-xl bg-violet-600 px-4 py-3 font-medium hover:bg-violet-500 disabled:opacity-50">
              {busy ? "Creating..." : "Create shareable session"}
            </button>
          </form>
        </Modal>
      )}

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          padding: 0.75rem;
          color: white;
          outline: none;
        }
        .input:focus {
          border-color: rgba(167, 139, 250, 0.7);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.14);
        }
        .input option {
          background: #111114;
        }
      `}</style>
    </main>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-[#111114] p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-xl p-2 text-zinc-400 hover:bg-white/5 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-zinc-400">{label}</span>
      {children}
    </label>
  );
}
