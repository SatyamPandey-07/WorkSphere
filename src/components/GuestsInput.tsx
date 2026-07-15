/**
 * GuestInviteInput Component
 *
 * An inline, expandable email input component for inviting guests
 * during workspace booking. Users can add guest email addresses
 * (and optional names) who will receive ICS calendar invitations.
 *
 * Integration points:
 * - Uses the /api/bookings/[bookingId]/guests endpoint after booking
 *   to send invitations asynchronously.
 * - Can also pre-populate guest data from the booking form state.
 *
 * Usage:
 *   <GuestsInput
 *     guests={guests}
 *     onChange={setGuests}
 *     maxGuests={10}
 *   />
 */

"use client";

import { useState, useCallback } from "react";
import { X, Plus, Mail, User, Check, AlertCircle, Loader2 } from "lucide-react";

export interface GuestEntry {
  id: string;
  email: string;
  name: string;
}

interface GuestsInputProps {
  guests: GuestEntry[];
  onChange: (guests: GuestEntry[]) => void;
  maxGuests?: number;
  disabled?: boolean;
}

// Simple ID generator for unique keys
let guestIdCounter = 0;
const generateId = () => `guest-${++guestIdCounter}-${Date.now()}`;

/**
 * Validates an email address format.
 */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Guest invite input component with email chip/tag-style UI.
 */
export default function GuestsInput({
  guests,
  onChange,
  maxGuests = 20,
  disabled = false,
}: GuestsInputProps) {
  const [emailInput, setEmailInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const addGuest = useCallback(() => {
    const email = emailInput.trim();

    // Validation
    if (!email) {
      setValidationError("Please enter an email address");
      return;
    }

    if (!isValidEmail(email)) {
      setValidationError("Please enter a valid email address");
      return;
    }

    if (guests.some((g) => g.email.toLowerCase() === email.toLowerCase())) {
      setValidationError("This guest has already been added");
      return;
    }

    if (guests.length >= maxGuests) {
      setValidationError(`Maximum ${maxGuests} guests allowed`);
      return;
    }

    // Add guest
    const newGuest: GuestEntry = {
      id: generateId(),
      email: email,
      name: nameInput.trim(),
    };

    onChange([...guests, newGuest]);
    setEmailInput("");
    setNameInput("");
    setShowNameInput(false);
    setValidationError(null);
  }, [emailInput, nameInput, guests, maxGuests, onChange]);

  const removeGuest = useCallback(
    (id: string) => {
      onChange(guests.filter((g) => g.id !== id));
      setValidationError(null);
    },
    [guests, onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addGuest();
    }
    if (e.key === "," || e.key === " ") {
      // Only add on comma or space if there's content
      if (emailInput.trim()) {
        e.preventDefault();
        addGuest();
      }
    }
  };

  return (
    <div className="space-y-3">
      {/* Guest chips */}
      {guests.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {guests.map((guest) => (
            <div
              key={guest.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs text-violet-200"
            >
              <Mail className="h-3 w-3" />
              <span className="truncate max-w-[120px]">{guest.email}</span>
              {guest.name && (
                <>
                  <span className="text-violet-400/50">|</span>
                  <span className="truncate max-w-[80px]">{guest.name}</span>
                </>
              )}
              <button
                type="button"
                onClick={() => removeGuest(guest.id)}
                disabled={disabled}
                className="ml-0.5 rounded-full p-0.5 hover:bg-violet-400/20 transition-colors disabled:opacity-40"
                aria-label={`Remove ${guest.email}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      {guests.length < maxGuests && !disabled && (
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-zinc-500 shrink-0" />
            <input
              type="email"
              value={emailInput}
              onChange={(e) => {
                setEmailInput(e.target.value);
                setValidationError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                guests.length === 0
                  ? "Add guest email..."
                  : "Add another guest..."
              }
              className="flex-1 bg-transparent text-sm text-white placeholder-zinc-500 outline-none"
              disabled={disabled}
            />
            <button
              type="button"
              onClick={addGuest}
              disabled={!emailInput.trim() || disabled}
              className="rounded-lg bg-violet-600/60 p-1.5 text-white hover:bg-violet-600/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Add guest"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Optional name field (expandable) */}
          {showNameInput && (
            <div className="mt-2 flex items-center gap-2 pl-6">
              <User className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addGuest()}
                placeholder="Guest name (optional)"
                className="flex-1 bg-transparent text-xs text-white placeholder-zinc-600 outline-none"
                disabled={disabled}
              />
            </div>
          )}

          {/* Toggle name field */}
          <button
            type="button"
            onClick={() => setShowNameInput(!showNameInput)}
            className="mt-1.5 text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors pl-6"
          >
            {showNameInput ? "Hide name field" : "+ Add name (optional)"}
          </button>

          {/* Validation error */}
          {validationError && (
            <p className="mt-1.5 flex items-center gap-1 text-[10px] text-red-400 pl-6">
              <AlertCircle className="h-3 w-3" />
              {validationError}
            </p>
          )}
        </div>
      )}

      {/* Guest count */}
      <p className="text-[10px] text-zinc-600">
        {guests.length > 0
          ? `${guests.length} guest${guests.length !== 1 ? "s" : ""} invited`
          : "No guests added yet"}
        {maxGuests && ` (max ${maxGuests})`}
      </p>
    </div>
  );
}

/**
 * Status indicator for sent guest invitations.
 */
export function GuestInviteStatus({
  success,
  error,
}: {
  success: boolean;
  error?: string;
}) {
  if (success) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
        <Check className="h-3 w-3" />
        Invitation sent
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-red-400"
      title={error}
    >
      <AlertCircle className="h-3 w-3" />
      Failed to send
    </span>
  );
}

/**
 * Loading skeleton for guest operations.
 */
export function GuestInviteLoading() {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
      <Loader2 className="h-3 w-3 animate-spin" />
      Sending invitation...
    </span>
  );
}
