'use client';

import React, { useState } from 'react';
import { NomadPassportCertificate } from '@/components/profile/NomadPassportCertificate';

export default function DashboardPage() {
  const [isPassportOpen, setIsPassportOpen] = useState(false);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-slate-900">WorkSphere Dashboard</h1>
          <p className="text-sm text-slate-600">
            Manage your workspace bookings, acoustic telemetry, and Nomad Passport
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsPassportOpen(true)}
          data-testid="open-nomad-passport-btn"
          className="rounded-lg border border-indigo-600 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
        >
          View Nomad Passport
        </button>
      </header>

      {isPassportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Nomad Passport Profile Modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                Nomad Passport Profile
              </h2>
              <button
                type="button"
                onClick={() => setIsPassportOpen(false)}
                className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <NomadPassportCertificate
              username="CoderSoham345"
              verifiedAt="2026-11-21"
              credentialHash="9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
            />
          </div>
        </div>
      )}
    </main>
  );
}