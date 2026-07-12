"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock3,
  
  MapPin,
  Navigation,
  Share2,
  UsersRound,
} from "lucide-react";

type Props = {
  session: {
    slug: string;
    title: string;
    description: string | null;
    startsAt: string;
    endsAt: string;
    maxGuests: number | null;
    host: {
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
  const [rsvps, setRsvps] = useState(session.rsvps);
  const [message, setMessage] = useState("");
  const going = useMemo(
    () => rsvps.filter((item) => item.status === "GOING"),
    [rsvps],
  );

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

    setMessage(`RSVP updated: ${status.toLowerCase()}.`);

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

  return (
    <main className="min-h-screen bg-[#07070a] px-5 py-10 text-white">
      <div className="mx-auto max-w-5xl">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_.65fr]">
          <section className="rounded-[2rem] border border-white/10 bg-gradient-to-br from-violet-950/70 via-zinc-950 to-cyan-950/30 p-7 md:p-10">
            <span className="inline-flex rounded-full border border-violet-400/20 bg-violet-400/10 px-3 py-1 text-xs text-violet-200">
              Group coworking session
            </span>

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
              <Info icon={<CalendarDays className="h-5 w-5" />} title="Starts" value={new Date(session.startsAt).toLocaleString()} />
              <Info icon={<Clock3 className="h-5 w-5" />} title="Ends" value={new Date(session.endsAt).toLocaleString()} />
              <Info icon={<MapPin className="h-5 w-5" />} title="Workspace" value={session.venue.name} />
              <Info icon={<UsersRound className="h-5 w-5" />} title="Attendance" value={`${going.length}${session.maxGuests ? ` / ${session.maxGuests}` : ""} going`} />
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={() => respond("GOING")} className="rounded-xl bg-violet-600 px-5 py-3 font-medium hover:bg-violet-500">
                I’m going
              </button>
              <button onClick={() => respond("MAYBE")} className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-medium hover:bg-white/10">
                Maybe
              </button>
              <button onClick={share} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-5 py-3 font-medium hover:bg-white/10">
                <Share2 className="h-4 w-4" /> Share
              </button>
            </div>

            {message && <p className="mt-4 text-sm text-violet-200">{message}</p>}
          </section>

          <aside className="space-y-6">
            <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6">
              <h2 className="text-lg font-semibold">Location</h2>
              <p className="mt-2 text-sm text-zinc-400">{session.venue.address}</p>

              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
                <div>Lat: {session.venue.latitude.toFixed(5)}</div>
                <div className="mt-1">Lng: {session.venue.longitude.toFixed(5)}</div>
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
              <h2 className="text-lg font-semibold">Who’s going</h2>
              <div className="mt-4 space-y-3">
                {going.map((item) => {
                  const name =
                    [item.user.firstName, item.user.lastName].filter(Boolean).join(" ") ||
                    "WorkSphere member";

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
                })}
              </div>
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
