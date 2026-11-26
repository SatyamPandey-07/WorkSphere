"use client";

import React, { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toPng } from "html-to-image";
import {
  Download,
  MapPin,
  QrCode,
  RotateCw,
  Smartphone,
  X,
} from "lucide-react";
import {
  getOfflinePasscardRecord,
  saveOfflinePasscard,
} from "@/lib/security/offlinePasscardStore";

export interface NomadDeskVenue {
  id?: string;
  name: string;
  address?: string | null;
  city?: string | null;
  neighborhood?: string | null;
  tags?: string[] | null;
}

export interface NomadDeskBooking {
  id: string;
  confirmationId: string;
  date: string;
  time: string;
  seatNumber?: string | null;
  venue: NomadDeskVenue | null;
}

export interface NomadDeskPassProps {
  booking?: NomadDeskBooking;
  isOpen?: boolean;
  onClose?: () => void;

  // Direct props compatibility
  venueName?: string;
  confirmationId?: string;
  seatLabel?: string;
  dateLabel?: string;
  onDownloadPng?: (filename: string, dataUrl: string) => void;
  address?: string | null;
  city?: string | null;
  neighborhood?: string | null;
}

const INVALID_FILENAME_CHARS_REGEX = /[\/\\:*?"<>|]+/g;
const NON_SAFE_CHAR_REGEX = /[^a-zA-Z0-9._-]+/g;

export function sanitizeFilenameSegment(
  raw: string | null | undefined,
  fallback = "pass",
): string {
  const safeFallback =
    typeof fallback === "string" && fallback.trim().length > 0
      ? fallback
          .normalize("NFKD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(INVALID_FILENAME_CHARS_REGEX, "-")
          .replace(NON_SAFE_CHAR_REGEX, "-")
          .replace(/-{2,}/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "")
          .slice(0, 64) || "pass"
      : "pass";

  if (typeof raw !== "string") {
    return safeFallback;
  }

  const cleaned = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(INVALID_FILENAME_CHARS_REGEX, "-")
    .replace(NON_SAFE_CHAR_REGEX, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);

  return cleaned.length > 0 ? cleaned : safeFallback;
}

export function buildDeskPassPngFilename(
  venueName: string | null | undefined,
  confirmationId: string | null | undefined,
): string {
  const cleanVenue = sanitizeFilenameSegment(venueName, "worksphere-venue");
  const cleanId = sanitizeFilenameSegment(confirmationId, "pass");
  return `nomad-desk-pass-${cleanVenue}-${cleanId}.png`;
}

export function resolveVenueLocationSubtitle(venue: NomadDeskVenue | null | undefined): string | null {
  if (!venue) return null;

  const address = typeof venue.address === "string" ? venue.address.trim() : "";
  if (address.length > 0) {
    return address;
  }

  const neighborhood = typeof venue.neighborhood === "string" ? venue.neighborhood.trim() : "";
  const city = typeof venue.city === "string" ? venue.city.trim() : "";

  if (neighborhood.length > 0 && city.length > 0) {
    return `${neighborhood}, ${city}`;
  }
  if (neighborhood.length > 0) {
    return neighborhood;
  }
  if (city.length > 0) {
    return city;
  }

  if (Array.isArray(venue.tags)) {
    const validTag = venue.tags.find(
      (tag) => typeof tag === "string" && tag.trim().length > 0,
    );
    if (validTag) {
      return validTag.trim();
    }
  }

  return null;
}

export function NomadDeskPass({
  booking,
  isOpen = true,
  onClose,
  venueName,
  confirmationId: directConfirmationId,
  seatLabel = "Hot Desk",
  dateLabel = "Today",
  onDownloadPng,
  address: directAddress,
  city: directCity,
  neighborhood: directNeighborhood,
}: NomadDeskPassProps) {
  const effectiveBooking: NomadDeskBooking = booking || {
    id: directConfirmationId || "pass",
    confirmationId: directConfirmationId || "N/A",
    date: dateLabel,
    time: "",
    seatNumber: seatLabel,
    venue: {
      name: venueName || "Workspace Venue",
      address: directAddress,
      city: directCity,
      neighborhood: directNeighborhood,
    },
  };

  const cardRef = useRef<HTMLDivElement>(null);
  const [flipped, setFlipped] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    setFlipped(false);
    setToken(null);
    setError(null);

    const loadToken = async () => {
      setLoading(true);
      try {
        const stored = await getOfflinePasscardRecord(effectiveBooking.id);
        if (cancelled) return;

        if (stored?.token) {
          setToken(stored.token);
          return;
        }

        const response = await fetch("/api/security/qr-passcard/issue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookingId: effectiveBooking.id }),
        });

        const data = await response.json();
        if (!response.ok || typeof data.offlinePasscard !== "string") {
          throw new Error(
            data.error || "Unable to create your secure check-in QR.",
          );
        }

        if (cancelled) return;
        setToken(data.offlinePasscard);

        try {
          await saveOfflinePasscard(data.offlinePasscard);
        } catch {
          // The token remains usable in this open pass.
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load pass.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadToken();
    return () => {
      cancelled = true;
    };
  }, [isOpen, effectiveBooking.id]);

  useEffect(() => {
    if (!isOpen || !onClose) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSavePng = async () => {
    const filename = buildDeskPassPngFilename(
      effectiveBooking.venue?.name,
      effectiveBooking.confirmationId,
    );

    if (onDownloadPng) {
      const dataUrl = `data:image/png;base64,${Buffer.from(
        encodeURIComponent(
          `NomadDeskPass:${effectiveBooking.venue?.name}:${effectiveBooking.confirmationId}`,
        ),
        "utf8",
      ).toString("base64")}`;
      onDownloadPng(filename, dataUrl);
      return;
    }

    if (!cardRef.current) return;
    try {
      const image = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = filename;
      link.href = image;
      link.click();
    } catch {
      setError("Could not export the pass as an image. Please try again.");
    }
  };

  const handleAppleWallet = () => {
    const link = document.createElement("a");
    link.href = `/api/bookings/${encodeURIComponent(effectiveBooking.id)}/wallet/apple`;
    link.download = `worksphere-${effectiveBooking.confirmationId}.pkpass`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (!isOpen) return null;

  const locationSubtitle = resolveVenueLocationSubtitle(effectiveBooking.venue);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nomad-desk-pass-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose) onClose();
      }}
    >
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-5 text-white shadow-2xl">
        <header className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-emerald-400">
              WorkSphere · Digital access
            </p>
            <h2 id="nomad-desk-pass-title" className="mt-1 text-xl font-bold">
              NomadDesk Pass
            </h2>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close NomadDesk pass"
              className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </header>

        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? "Show pass front" : "Show QR code back"}
          aria-pressed={flipped}
          className="mb-4 w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
        >
          <div className="perspective-[1200px]">
            <div
              ref={cardRef}
              data-testid="nomad-desk-pass-card"
              className="relative min-h-[330px] w-full rounded-3xl transition-transform duration-700 [transform-style:preserve-3d]"
              style={{
                transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              }}
            >
              <div className="absolute inset-0 flex flex-col justify-between overflow-hidden rounded-3xl border border-emerald-300/30 bg-gradient-to-br from-emerald-950 via-zinc-900 to-zinc-950 p-6 shadow-2xl [backface-visibility:hidden]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold tracking-[0.2em] text-emerald-300">
                    NOMADDESK
                  </span>
                  <MapPin className="h-5 w-5 text-emerald-300" />
                </div>

                <div>
                  <p className="text-sm text-zinc-400">Your workspace</p>
                  <h3 className="mt-1 text-2xl font-bold">
                    {effectiveBooking.venue?.name || "Workspace"}
                  </h3>
                  <p
                    data-testid="nomad-desk-pass-location"
                    className="mt-3 min-h-[1.5rem] text-sm leading-relaxed text-zinc-300"
                  >
                    {locationSubtitle ?? ""}
                  </p>
                </div>

                <div className="flex items-end justify-between border-t border-white/10 pt-4">
                  <div>
                    <p className="text-xs text-zinc-400">BOOKING REFERENCE</p>
                    <p className="mt-1 font-mono text-sm font-semibold">
                      {effectiveBooking.confirmationId}
                    </p>
                  </div>
                  <div className="text-right text-xs text-zinc-400">
                    <p>{effectiveBooking.date}</p>
                    {effectiveBooking.time && <p>{effectiveBooking.time}</p>}
                    {effectiveBooking.seatNumber && (
                      <p>Desk {effectiveBooking.seatNumber}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="absolute inset-0 flex flex-col items-center justify-between overflow-hidden rounded-3xl border border-emerald-300/30 bg-zinc-900 p-6 shadow-2xl [backface-visibility:hidden] [transform:rotateY(180deg)]">
                <div className="text-center">
                  <p className="text-xs font-bold tracking-[0.2em] text-emerald-300">
                    SECURE CHECK-IN
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    Scan this signed QR code at the venue
                  </p>
                </div>

                <div className="rounded-2xl bg-white p-3">
                  {loading ? (
                    <div className="flex h-48 w-48 items-center justify-center text-sm text-zinc-600">
                      Loading QR…
                    </div>
                  ) : token ? (
                    <QRCodeSVG
                      value={token}
                      size={192}
                      level="H"
                      includeMargin
                      data-testid="nomad-desk-pass-qr"
                    />
                  ) : (
                    <div className="flex h-48 w-48 items-center justify-center text-center text-sm text-red-600">
                      QR unavailable
                    </div>
                  )}
                </div>

                <p className="font-mono text-xs text-zinc-400">
                  {effectiveBooking.confirmationId}
                </p>
              </div>
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setFlipped((value) => !value)}
          className="mb-4 flex w-full items-center justify-center gap-2 text-sm text-emerald-300 hover:text-emerald-200"
        >
          <RotateCw className="h-4 w-4" />
          Flip pass
        </button>

        {error && (
          <p
            role="alert"
            className="mb-3 rounded-lg bg-red-950/60 p-3 text-sm text-red-300"
          >
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleAppleWallet}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 py-3 text-sm font-semibold text-black transition hover:bg-emerald-400"
          >
            <Smartphone className="h-4 w-4" />
            Apple Wallet
          </button>
          <button
            type="button"
            data-testid="download-pass-png-btn"
            onClick={handleSavePng}
            disabled={!token && !onDownloadPng}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-3 py-3 text-sm font-semibold transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Save as PNG
          </button>
        </div>

        <p className="mt-4 flex items-center justify-center gap-2 text-center text-xs text-zinc-500">
          <QrCode className="h-3.5 w-3.5" />
          Digitally signed check-in credential
        </p>
      </section>
    </div>
  );
}

export default NomadDeskPass;
