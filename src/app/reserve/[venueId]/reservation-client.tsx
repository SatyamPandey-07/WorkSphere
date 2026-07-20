"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Clock3,
  Monitor,
  RefreshCw,
  Sparkles,
  UsersRound,
  Zap,
  CalendarPlus,
  Mail,
  Download,
  UserPlus,
} from "lucide-react";
import { getCalendarUrls, downloadICS } from "@/lib/calendar";
import GuestsInput, { type GuestEntry } from "@/components/GuestsInput";

type Seat = {
  id: string;
  seatNumber: string;
  type: "HOT_DESK" | "FIXED_DESK" | "MEETING_ROOM" | "PHONE_BOOTH";
  x: number;
  y: number;
  width: number;
  height: number;
  amenities: string[];
  available: boolean;
};

type Venue = {
  id: string;
  name: string;
  address: string | null;
  category: string;
};

const amenityOptions = [
  { id: "monitor", label: "Extra monitor", icon: Monitor },
  { id: "whiteboard", label: "Whiteboard", icon: Sparkles },
  { id: "power", label: "Power outlet", icon: Zap },
  { id: "video-call", label: "Video calls", icon: UsersRound },
];

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReservationClient({ venue }: { venue: Venue }) {
  const [date, setDate] = useState(todayString());
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState(60);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<string | null>(null);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [guests, setGuests] = useState<GuestEntry[]>([]);

  const loadAvailability = useCallback(async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams({
        venueId: venue.id,
        date,
        time,
        duration: String(duration),
      });

      const response = await fetch(`/api/reservations/availability?${params}`, {
        cache: "no-store",
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to load seats");
      }

      setSeats(payload.seats);

      if (
        selectedSeat &&
        !payload.seats.some(
          (seat: Seat) => seat.id === selectedSeat && seat.available,
        )
      ) {
        setSelectedSeat(null);
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to load seats",
      );
    } finally {
      setLoading(false);
    }
  }, [venue.id, date, time, duration, selectedSeat]);

  useEffect(() => {
    loadAvailability();
  }, [date, time, duration, loadAvailability]);

  useEffect(() => {
    let events: EventSource | null = null;

    const connect = () => {
      if (events) {
        events.close();
      }
      events = new EventSource(
        `/api/reservations/events?venueId=${encodeURIComponent(venue.id)}`,
      );

      events.addEventListener("availability", () => {
        loadAvailability();
      });

      events.onerror = () => {
        // EventSource reconnects automatically.
      };
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        console.log("[Reservation] Tab visible, resetting connection");
        connect();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();

    return () => {
      if (events) {
        events.close();
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [venue.id, loadAvailability]);

  const selected = useMemo(
    () => seats.find((seat) => seat.id === selectedSeat) ?? null,
    [seats, selectedSeat],
  );

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selected) {
      setMessage("Choose an available desk or room first.");
      return;
    }

    setBooking(true);
    setMessage("");
    setConfirmationId(null);

    const response = await fetch("/api/reservations/book", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        venueId: venue.id,
        seatId: selected.id,
        date,
        time,
        duration,
        amenitiesNeeded: amenities,
        guests: guests.map((g) => ({
          email: g.email,
          name: g.name || undefined,
        })),
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      setMessage(payload.error ?? "Reservation failed");
      setBooking(false);
      await loadAvailability();
      return;
    }

    const guestMsg =
      guests.length > 0
        ? ` + ${payload.guestsAdded || guests.length} guest invite(s) queued`
        : "";

    setMessage(
      `${selected.seatNumber} confirmed. Reference: ${payload.confirmationId}${guestMsg}`,
    );
    setConfirmationId(payload.confirmationId);
    setSelectedSeat(null);
    setBooking(false);
    setGuests([]);
    await loadAvailability();
  }

  return (
    <main className="min-h-screen bg-[#07070a] text-white">
      <div className="mx-auto max-w-7xl px-5 py-8 md:px-8">
        <header className="mb-7">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-200">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Live availability
          </div>

          <h1 className="mt-4 text-4xl font-semibold tracking-tight">
            Reserve at {venue.name}
          </h1>

          <p className="mt-2 text-zinc-500">
            {venue.address || "Choose your desk or meeting room"}
          </p>
        </header>

        {message && (
          <div className="mb-6 rounded-2xl border border-violet-400/20 bg-violet-400/10 p-5 text-sm text-violet-100">
            <p className="font-semibold">{message}</p>
            {confirmationId && (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a
                  href={
                    getCalendarUrls(
                      venue.name,
                      venue.address || "",
                      date,
                      time,
                      duration,
                    ).googleUrl
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl bg-violet-600/20 border border-violet-500/30 px-4 py-2 hover:bg-violet-600/40 transition-colors"
                >
                  <CalendarPlus className="h-4 w-4" /> Add to Google
                </a>
                <a
                  href={
                    getCalendarUrls(
                      venue.name,
                      venue.address || "",
                      date,
                      time,
                      duration,
                    ).outlookUrl
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl bg-violet-600/20 border border-violet-500/30 px-4 py-2 hover:bg-violet-600/40 transition-colors"
                >
                  <Mail className="h-4 w-4" /> Add to Outlook
                </a>
                <button
                  onClick={() =>
                    downloadICS(
                      venue.name,
                      venue.address || "",
                      date,
                      time,
                      duration,
                      confirmationId || "",
                    )
                  }
                  className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2 hover:bg-white/10 transition-colors text-zinc-300"
                >
                  <Download className="h-4 w-4" /> Download .ics
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[1.5fr_.7fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 md:p-7">
            <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Interactive layout</h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Select a green desk. Changes made by other viewers appear
                  live.
                </p>
              </div>

              <button
                onClick={loadAvailability}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </button>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0b0b0f] p-4">
              <svg viewBox="0 0 620 470" className="min-w-[620px]">
                <rect
                  x="10"
                  y="10"
                  width="600"
                  height="450"
                  rx="24"
                  fill="#111116"
                  stroke="#27272a"
                />
                <text x="35" y="45" fill="#71717a" fontSize="13">
                  WORK FLOOR
                </text>

                <path d="M35 300 H585" stroke="#27272a" strokeDasharray="8 8" />
                <text x="35" y="320" fill="#52525b" fontSize="11">
                  COLLABORATION ZONE
                </text>

                {seats.map((seat) => {
                  const active = seat.id === selectedSeat;
                  const fill = !seat.available
                    ? "#3f3f46"
                    : active
                      ? "#8b5cf6"
                      : seat.type === "MEETING_ROOM"
                        ? "#155e75"
                        : "#166534";

                  return (
                    <g
                      key={seat.id}
                      onClick={() => seat.available && setSelectedSeat(seat.id)}
                      className={
                        seat.available ? "cursor-pointer" : "cursor-not-allowed"
                      }
                    >
                      <rect
                        x={seat.x}
                        y={seat.y}
                        width={seat.width}
                        height={seat.height}
                        rx="10"
                        fill={fill}
                        stroke={active ? "#c4b5fd" : "#52525b"}
                        strokeWidth={active ? 3 : 1}
                      />
                      <text
                        x={seat.x + seat.width / 2}
                        y={seat.y + seat.height / 2 + 4}
                        textAnchor="middle"
                        fill="white"
                        fontSize="12"
                        fontWeight="600"
                      >
                        {seat.seatNumber}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="mt-5 flex flex-wrap gap-4 text-xs text-zinc-400">
              <Legend color="bg-green-800" label="Available desk" />
              <Legend color="bg-cyan-800" label="Available room" />
              <Legend color="bg-violet-500" label="Selected" />
              <Legend color="bg-zinc-700" label="Taken" />
            </div>
          </section>

          <form
            onSubmit={reserve}
            className="h-fit rounded-3xl border border-white/10 bg-white/[0.04] p-5 md:p-6"
          >
            <h2 className="text-xl font-semibold">Reservation details</h2>

            <div className="mt-6 space-y-4">
              <Field label="Date" icon={<CalendarDays className="h-4 w-4" />}>
                <input
                  type="date"
                  min={todayString()}
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="reserve-input"
                />
              </Field>

              <Field label="Start time" icon={<Clock3 className="h-4 w-4" />}>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="reserve-input"
                />
              </Field>

              <Field label="Duration" icon={<Clock3 className="h-4 w-4" />}>
                <select
                  value={duration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                  className="reserve-input"
                >
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hours</option>
                  <option value={120}>2 hours</option>
                  <option value={240}>4 hours</option>
                  <option value={480}>Full day</option>
                </select>
              </Field>
            </div>

            <div className="mt-6">
              <p className="text-sm text-zinc-400">Amenities needed</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {amenityOptions.map((option) => {
                  const enabled = amenities.includes(option.id);
                  const Icon = option.icon;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() =>
                        setAmenities((current) =>
                          enabled
                            ? current.filter((item) => item !== option.id)
                            : [...current, option.id],
                        )
                      }
                      className={`rounded-xl border p-3 text-left text-xs transition ${
                        enabled
                          ? "border-violet-400/50 bg-violet-400/10 text-violet-100"
                          : "border-white/10 bg-white/[0.03] text-zinc-400 hover:bg-white/[0.06]"
                      }`}
                    >
                      <Icon className="mb-2 h-4 w-4" />
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Guest Invitations */}
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-3">
                <UserPlus className="h-4 w-4 text-zinc-400" />
                <p className="text-sm text-zinc-400">Invite guests</p>
              </div>
              <GuestsInput
                guests={guests}
                onChange={setGuests}
                maxGuests={10}
                disabled={booking}
              />
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs uppercase tracking-wider text-zinc-500">
                Selected workspace
              </p>

              {selected ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-semibold">
                      {selected.seatNumber}
                    </span>
                    <Check className="h-5 w-5 text-emerald-300" />
                  </div>
                  <p className="mt-1 text-xs capitalize text-zinc-500">
                    {selected.type.toLowerCase().replaceAll("_", " ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {selected.amenities.map((amenity) => (
                      <span
                        key={amenity}
                        className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-zinc-400"
                      >
                        {amenity}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-zinc-500">
                  Select a green desk or room on the layout.
                </p>
              )}
            </div>

            <button
              disabled={!selected || booking}
              className="mt-6 w-full rounded-xl bg-violet-600 px-4 py-3 font-medium transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {booking ? "Securing workspace..." : "Confirm reservation"}
            </button>
          </form>
        </div>
      </div>

      <style jsx global>{`
        .reserve-input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          padding: 0.75rem;
          color: white;
          outline: none;
        }
        .reserve-input option {
          background: #111114;
        }
        .reserve-input:focus {
          border-color: rgba(167, 139, 250, 0.6);
          box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.12);
        }
      `}</style>
    </main>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`h-3 w-3 rounded ${color}`} />
      {label}
    </span>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-2 text-sm text-zinc-400">
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}
