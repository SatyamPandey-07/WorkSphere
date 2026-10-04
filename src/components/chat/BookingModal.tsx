"use client";

import {
  X,
  CheckCircle2,
  Loader2,
  Calendar,
  Clock,
  AlertTriangle,
  Mail,
  Download,
  MapPin,
  CalendarPlus,
  Repeat,
  Tag,
} from "lucide-react";
import Link from "next/link";
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { useUser } from "@clerk/nextjs";
import confetti from "canvas-confetti";
import { Venue } from "./ChatMessages";
import { trackEvent } from "@/lib/analytics";
import { getCalendarUrls, downloadICS } from "@/lib/calendar";
import GuestsInput, { type GuestEntry } from "@/components/GuestsInput";
import {
  handleModalBackdropClick,
  isModalBackdropClick,
  shouldCloseFromBackdrop,
} from "@/lib/modal-interactions";
import { useRateLimit } from "@/hooks/useRateLimit";
import {
  BookingList,
  type BookingSummary,
} from "@/components/bookings/BookingList";

type Step = "details" | "payment" | "processing" | "success" | "history";

interface BookingModalProps {
  venue: Venue | null;
  isOpen: boolean;
  onClose: () => void;
  mode?: "booking" | "history";
  initialHistory?: BookingSummary[];
  initialStep?: "details" | "payment" | "processing" | "success" | "history";
}

const MAX_OCCURRENCES = 12;

function localDateString(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Expands a start date into `count` dates at the given frequency (local calendar). */
function expandDates(
  start: string,
  count: number,
  frequency: "daily" | "weekly" | "monthly",
): string[] {
  const [y, m, d] = start.split("-").map(Number);
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    const next =
      frequency === "daily"
        ? new Date(y, m - 1, d + i)
        : frequency === "weekly"
          ? new Date(y, m - 1, d + 7 * i)
          : new Date(y, m - 1 + i, d);
    dates.push(localDateString(next));
  }
  return dates;
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const inputClass =
  "w-full pl-11 pr-4 py-3 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary-accent),transparent_0.7)] focus:accent-border outline-none transition-all";
const labelClass =
  "block text-xs font-semibold text-zinc-600 dark:text-zinc-400 mb-1.5";

export function BookingModal({
  venue,
  isOpen,
  onClose,
  mode = "booking",
  initialHistory = [],
  initialStep,
}: BookingModalProps) {
  const { user } = useUser();
  const retryAfter = useRateLimit("book");
  const [step, setStep] = useState<
    "details" | "payment" | "processing" | "success" | "history"
  >(initialStep ?? (mode === "history" ? "history" : "details"));
  const today = localDateString(new Date());
  const getTodayString = () => today;
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<
    "daily" | "weekly" | "monthly"
  >("weekly");
  const [recurringOccurrences, setRecurringOccurrences] = useState(4);
  const [email, setEmail] = useState("");
  const [billingCode, setBillingCode] = useState("");
  const [guests, setGuests] = useState<GuestEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    ids: string[];
    bookingId: string | null;
    dates: string[];
    time: string;
  } | null>(null);
  const [guestInviteStatus, setGuestInviteStatus] = useState<
    "idle" | "sending" | "done" | "failed"
  >("idle");

  const modalRef = useRef<HTMLDivElement>(null);
  const pointerDownStartedOnBackdrop = useRef(false);

  // Prefill the confirmation email with the signed-in user's address.
  const accountEmail = user?.primaryEmailAddress?.emailAddress ?? "";
  useEffect(() => {
    if (!email && accountEmail) setEmail(accountEmail);
  }, [accountEmail, email]);

  useEffect(() => {
    if (!isOpen) return;
    if (mode === "history") setStep("history");
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen) {
      setGuests([]);
      setGuestInviteStatus("idle");
      setBookingError(null);
    }
  }, [isOpen]);

  // Celebrate a confirmed booking (skipped for reduced-motion users).
  useEffect(() => {
    let animationFrameId: number | undefined;
    if (step === "success") {
      const respectsReducedMotion =
        typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (respectsReducedMotion) return;

      const duration = 2 * 1000;
      const end = Date.now() + duration;
      const frame = () => {
        confetti({
          particleCount: 2,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.8 },
          zIndex: 25000,
        });
        confetti({
          particleCount: 2,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.8 },
          zIndex: 25000,
        });
        if (Date.now() < end) {
          animationFrameId = requestAnimationFrame(frame);
        }
      };
      frame();
    }
    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [step]);

  // The parent passes a new onClose each render; read it through a ref so the
  // focus trap below doesn't re-run (and steal focus) on every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Keep keyboard focus inside the dialog.
  useEffect(() => {
    if (!isOpen || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, step]);

  const plannedDates = useMemo(
    () =>
      bookingDate
        ? isRecurring
          ? expandDates(bookingDate, recurringOccurrences, recurringFrequency)
          : [bookingDate]
        : [],
    [bookingDate, isRecurring, recurringOccurrences, recurringFrequency],
  );

  if (!isOpen) return null;

  const handleBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerDownStartedOnBackdrop.current = isModalBackdropClick(event);
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (
      shouldCloseFromBackdrop(
        pointerDownStartedOnBackdrop.current,
        isModalBackdropClick(event),
      )
    ) {
      handleModalBackdropClick(event, onClose);
    }
    pointerDownStartedOnBackdrop.current = false;
  };

  const handleBooking = async () => {
    if (!venue) return;
    if (bookingDate && bookingDate < today) {
      setBookingError("Please choose today or a future date.");
      return;
    }

    setIsSubmitting(true);
    setBookingError(null);
    setStep("processing");
    trackEvent("venue_rated", {
      venueId: venue.id,
      venueName: venue.name,
      action: "booking_started",
    });

    try {
      const response = await fetch("/api/bookings/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue: {
            id: venue.id,
            name: venue.name,
            address: venue.address ?? null,
            category: venue.category,
            lat: venue.lat,
            lng: venue.lng,
          },
          dates: plannedDates,
          time: bookingTime,
          timeZone: browserTimeZone(),
          customerEmail: email.trim(),
          projectBillingCode: billingCode.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data.error ||
            (response.status === 429
              ? "Too many bookings in a short time. Please wait a moment."
              : "Booking failed. Please try again."),
        );
      }

      setConfirmation({
        ids: data.confirmationIds ?? [data.confirmationId],
        bookingId: data.bookingId ?? null,
        dates: plannedDates,
        time: bookingTime,
      });
      setStep("success");
      trackEvent("venue_rated", {
        venueId: venue.id,
        venueName: venue.name,
        action: "booking_confirmed",
      });

      if (guests.length > 0 && data.bookingId) {
        setGuestInviteStatus("sending");
        try {
          const res = await fetch(`/api/bookings/${data.bookingId}/guests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guests: guests.map((g) => ({
                email: g.email,
                name: g.name || undefined,
              })),
            }),
          });
          setGuestInviteStatus(res.ok ? "done" : "failed");
        } catch {
          setGuestInviteStatus("failed");
        }
      }
    } catch (err: any) {
      setBookingError(err?.message || "Booking failed. Please try again.");
      setStep("details");
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    !!bookingDate &&
    !!bookingTime &&
    /\S+@\S+\.\S+/.test(email) &&
    !isSubmitting &&
    retryAfter <= 0;

  return (
    <div
      className="fixed inset-0 z-[20000] flex items-center justify-center p-4 bg-zinc-950/60 backdrop-blur-sm animate-in fade-in duration-200"
      onPointerDown={handleBackdropPointerDown}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-modal-title"
        className="bg-white dark:bg-zinc-900 w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden rounded-3xl shadow-2xl border border-zinc-200 dark:border-zinc-800 animate-in zoom-in-95 duration-200"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <div>
            <h2
              id="booking-modal-title"
              className="text-xl font-bold tracking-tight"
            >
              {step === "history" ? "My bookings" : "Book a workspace"}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {step === "history"
                ? "Upcoming and past reservations"
                : "Free to reserve · cancel up to 2 hours before"}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto">
          {step === "history" && (
            <BookingList initialBookings={initialHistory} />
          )}

          {step === "details" && venue && (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (canSubmit) void handleBooking();
              }}
            >
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700">
                <div className="w-11 h-11 rounded-xl accent-bg text-white flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{venue.name}</h3>
                  <p className="text-xs text-zinc-500 truncate">
                    {[venue.category, venue.address]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </div>

              {bookingError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  {bookingError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="booking-date" className={labelClass}>
                    Date
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="date"
                      id="booking-date"
                      min={today}
                      required
                      className={inputClass}
                      value={bookingDate}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(e) => setBookingDate(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="arrival-time" className={labelClass}>
                    Arrival time
                  </label>
                  <div className="relative">
                    <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                    <input
                      type="time"
                      id="arrival-time"
                      required
                      className={inputClass}
                      value={bookingTime}
                      onChange={(e) => setBookingTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="w-4 h-4 cursor-pointer"
                    style={{ accentColor: "var(--primary-accent)" }}
                  />
                  <Repeat className="w-4 h-4 text-zinc-400" />
                  Repeat this booking
                </label>
                {isRecurring && (
                  <div className="grid grid-cols-2 gap-4 pl-6">
                    <div>
                      <label
                        htmlFor="recurring-frequency"
                        className={labelClass}
                      >
                        Every
                      </label>
                      <select
                        id="recurring-frequency"
                        value={recurringFrequency}
                        onChange={(e) =>
                          setRecurringFrequency(
                            e.target.value as "daily" | "weekly" | "monthly",
                          )
                        }
                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm"
                      >
                        <option value="daily">Day</option>
                        <option value="weekly">Week</option>
                        <option value="monthly">Month</option>
                      </select>
                    </div>
                    <div>
                      <label
                        htmlFor="recurring-occurrences"
                        className={labelClass}
                      >
                        Times
                      </label>
                      <input
                        id="recurring-occurrences"
                        type="number"
                        min={2}
                        max={MAX_OCCURRENCES}
                        value={recurringOccurrences}
                        onChange={(e) =>
                          setRecurringOccurrences(
                            Math.min(
                              MAX_OCCURRENCES,
                              Math.max(2, parseInt(e.target.value) || 2),
                            ),
                          )
                        }
                        className="w-full px-3 py-2.5 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-xl text-sm"
                      />
                    </div>
                    {plannedDates.length > 1 && (
                      <p className="col-span-2 text-xs text-zinc-500">
                        {plannedDates[0]} →{" "}
                        {plannedDates[plannedDates.length - 1]} (
                        {plannedDates.length} bookings)
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="booking-email" className={labelClass}>
                  Confirmation email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    id="booking-email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    className={inputClass}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label htmlFor="billing-code" className={labelClass}>
                  Project / billing code{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </label>
                <div className="relative">
                  <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <input
                    id="billing-code"
                    type="text"
                    maxLength={64}
                    placeholder="e.g. PRJ-2026"
                    className={inputClass}
                    value={billingCode}
                    onChange={(e) => setBillingCode(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <span className={labelClass}>
                  Invite guests{" "}
                  <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <GuestsInput
                  guests={guests}
                  onChange={setGuests}
                  maxGuests={10}
                />
              </div>

              {retryAfter > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
                  <Clock className="w-4 h-4" />
                  Too many attempts — try again in {retryAfter}s
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit}
                className="w-full accent-bg text-white font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {plannedDates.length > 1
                  ? `Confirm ${plannedDates.length} bookings`
                  : "Confirm booking"}
              </button>
            </form>
          )}

          {step === "processing" && (
            <div
              className="py-20 flex flex-col items-center gap-4"
              role="status"
            >
              <Loader2 className="w-10 h-10 accent-text animate-spin" />
              <p className="font-medium">Confirming your booking…</p>
            </div>
          )}

          {step === "success" && venue && (
            <div className="py-6 flex flex-col items-center text-center gap-5">
              <div className="w-20 h-20 rounded-full bg-green-500/10 flex items-center justify-center text-green-500">
                <CheckCircle2 className="w-12 h-12" />
              </div>
              <div>
                <h3 className="text-2xl font-bold">You&apos;re booked!</h3>
                <p className="text-sm text-zinc-500 mt-1">
                  {venue.name}
                  {confirmation && (
                    <>
                      {" · "}
                      {confirmation.dates.length > 1
                        ? `${confirmation.dates.length} dates from ${confirmation.dates[0]}`
                        : confirmation.dates[0]}
                      {" at "}
                      {confirmation.time}
                    </>
                  )}
                </p>
              </div>

              {confirmation && (
                <div className="w-full rounded-2xl border border-zinc-200 dark:border-zinc-700 p-4">
                  <p className="text-xs text-zinc-500">
                    Confirmation{" "}
                    {confirmation.ids.length > 1 ? "numbers" : "number"}
                  </p>
                  <p className="font-mono font-semibold mt-1 break-all">
                    {confirmation.ids.join(", ")}
                  </p>
                  <p className="text-xs text-zinc-500 mt-2">
                    A confirmation with your receipt is on its way to {email}.
                  </p>
                </div>
              )}

              {guestInviteStatus === "sending" && (
                <p className="text-xs text-zinc-500 flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Sending guest
                  invites…
                </p>
              )}
              {guestInviteStatus === "done" && (
                <p className="text-xs text-green-600">Guest invites sent.</p>
              )}
              {guestInviteStatus === "failed" && (
                <p className="text-xs text-red-600">
                  We couldn&apos;t send the guest invites. You can resend them
                  from your bookings.
                </p>
              )}

              {confirmation && (
                <div className="flex flex-wrap justify-center gap-2">
                  <a
                    href={
                      getCalendarUrls(
                        venue.name,
                        venue.address ?? "",
                        confirmation.dates[0],
                        confirmation.time,
                      ).googleUrl
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <CalendarPlus className="w-4 h-4" /> Add to Google Calendar
                  </a>
                  <button
                    onClick={() =>
                      downloadICS(
                        venue.name,
                        venue.address ?? "",
                        confirmation.dates[0],
                        confirmation.time,
                        60,
                        confirmation.ids[0],
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                  >
                    <Calendar className="w-4 h-4" /> Download .ics
                  </button>
                  {confirmation.bookingId && (
                    <a
                      href={`/api/bookings/${confirmation.bookingId}/download`}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                    >
                      <Download className="w-4 h-4" /> Receipt
                    </a>
                  )}
                </div>
              )}

              <div className="flex w-full gap-2">
                <Link
                  href="/dashboard"
                  className="flex-1 py-3 rounded-xl border border-zinc-200 dark:border-zinc-700 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  View my bookings
                </Link>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl accent-bg text-white font-semibold hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
