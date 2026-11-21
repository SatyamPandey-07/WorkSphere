"use client";

import React, { useMemo, useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";

interface TriageTicket {
  id: string;
  title: string;
  aiDepartment: string;
  aiPriority: string;
  confidenceScore: number;
  status: "OPEN" | "IN_REVIEW" | "RESOLVED";
}

const DEFAULT_STATUS = "ALL";
const DEFAULT_SEVERITY = "ALL";
const DEFAULT_CATEGORY = "ALL";

export default function TriageDesk() {
  const [tickets, setTickets] = useState<TriageTicket[]>([
    {
      id: "CMP-101",
      title: "Severe water pipeline leakage on main junction",
      aiDepartment: "WATER_SUPPLY",
      aiPriority: "CRITICAL",
      confidenceScore: 0.96,
      status: "OPEN",
    },
    {
      id: "CMP-102",
      title: "Broken street light pole near community hall",
      aiDepartment: "ELECTRICAL",
      aiPriority: "MEDIUM",
      confidenceScore: 0.89,
      status: "OPEN",
    },
  ]);
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS);
  const [severityFilter, setSeverityFilter] = useState(DEFAULT_SEVERITY);
  const [categoryFilter, setCategoryFilter] = useState(DEFAULT_CATEGORY);
  const [searchQuery, setSearchQuery] = useState("");

  const formatDepartment = (department: string) =>
    department
      .split("_")
      .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
      .join(" ");

  const formatStatus = (status: string) =>
    status === "IN_REVIEW"
      ? "In Review"
      : status.charAt(0) + status.slice(1).toLowerCase();

  const filteredTickets = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return tickets.filter((ticket) => {
      if (statusFilter !== DEFAULT_STATUS && ticket.status !== statusFilter) {
        return false;
      }
      if (
        severityFilter !== DEFAULT_SEVERITY &&
        ticket.aiPriority.toUpperCase() !== severityFilter
      ) {
        return false;
      }
      if (
        categoryFilter !== DEFAULT_CATEGORY &&
        ticket.aiDepartment.toUpperCase() !== categoryFilter
      ) {
        return false;
      }
      if (
        normalizedSearch &&
        ![
          ticket.id,
          ticket.title,
          ticket.aiDepartment,
          ticket.aiPriority,
          ticket.status,
        ].some((value) => value.toLowerCase().includes(normalizedSearch))
      ) {
        return false;
      }
      return true;
    });
  }, [tickets, statusFilter, severityFilter, categoryFilter, searchQuery]);

  const hasActiveFilters =
    statusFilter !== DEFAULT_STATUS ||
    severityFilter !== DEFAULT_SEVERITY ||
    categoryFilter !== DEFAULT_CATEGORY ||
    searchQuery.trim() !== "";

  const handleApprove = (id: string) => {
    setTickets((current) => current.filter((ticket) => ticket.id !== id));
  };

  const clearFilters = () => {
    setStatusFilter(DEFAULT_STATUS);
    setSeverityFilter(DEFAULT_SEVERITY);
    setCategoryFilter(DEFAULT_CATEGORY);
    setSearchQuery("");
  };

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <h1 className="text-2xl font-bold mb-6">
        Autonomous AI Triage Review Desk
      </h1>

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:flex-row md:flex-wrap md:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-semibold text-slate-300">
          <span>Status</span>
          <select
            aria-label="Status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value={DEFAULT_STATUS}>All</option>
            <option value="OPEN">Open</option>
            <option value="IN_REVIEW">In Review</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-semibold text-slate-300">
          <span>Severity</span>
          <select
            aria-label="Severity"
            value={severityFilter}
            onChange={(event) => setSeverityFilter(event.target.value)}
            className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value={DEFAULT_SEVERITY}>All</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </label>

        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs font-semibold text-slate-300">
          <span>Category</span>
          <select
            aria-label="Category"
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="h-9 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-400"
          >
            <option value={DEFAULT_CATEGORY}>All</option>
            <option value="WATER_SUPPLY">Water Supply</option>
            <option value="ELECTRICAL">Electrical</option>
            <option value="SECURITY">Security</option>
          </select>
        </label>

        <label className="flex min-w-52 flex-[2] flex-col gap-1.5 text-xs font-semibold text-slate-300">
          <span>Search</span>
          <span className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              aria-label="Search tickets"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search tickets"
              className="h-9 w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </span>
        </label>
      </div>

      {hasActiveFilters && (
        <div
          data-testid="active-filters-bar"
          className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3"
        >
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Active:
          </span>

          {statusFilter !== DEFAULT_STATUS && (
            <span
              data-testid="status-filter-chip"
              className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1 text-xs font-semibold text-indigo-300"
            >
              Status: {formatStatus(statusFilter)}
              <button
                type="button"
                aria-label="Remove Status filter"
                data-testid="clear-status-chip"
                onClick={() => setStatusFilter(DEFAULT_STATUS)}
                className="rounded p-0.5 transition-colors hover:bg-indigo-400/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {severityFilter !== DEFAULT_SEVERITY && (
            <span
              data-testid="severity-filter-chip"
              className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300"
            >
              Severity:{" "}
              {severityFilter.charAt(0) + severityFilter.slice(1).toLowerCase()}
              <button
                type="button"
                aria-label="Remove Severity filter"
                data-testid="clear-severity-chip"
                onClick={() => setSeverityFilter(DEFAULT_SEVERITY)}
                className="rounded p-0.5 transition-colors hover:bg-amber-400/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {categoryFilter !== DEFAULT_CATEGORY && (
            <span
              data-testid="category-filter-chip"
              className="inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-300"
            >
              Category: {formatDepartment(categoryFilter)}
              <button
                type="button"
                aria-label="Remove Category filter"
                data-testid="clear-category-chip"
                onClick={() => setCategoryFilter(DEFAULT_CATEGORY)}
                className="rounded p-0.5 transition-colors hover:bg-sky-400/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          {searchQuery.trim() !== "" && (
            <span
              data-testid="search-filter-chip"
              className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300"
            >
              Search: {searchQuery.trim()}
              <button
                type="button"
                aria-label="Remove Search filter"
                data-testid="clear-search-chip"
                onClick={() => setSearchQuery("")}
                className="rounded p-0.5 transition-colors hover:bg-emerald-400/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}

          <button
            type="button"
            onClick={clearFilters}
            data-testid="clear-filters-btn"
            aria-label="Clear Filters"
            className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear Filters
          </button>
        </div>
      )}

      <div className="space-y-4">
        {filteredTickets.map((ticket) => (
          <div
            key={ticket.id}
            className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex flex-col justify-between gap-3 sm:flex-row sm:items-center"
            data-testid={`triage-ticket-${ticket.id}`}
          >
            <div>
              <span className="text-xs text-indigo-400 font-semibold">
                {ticket.id}
              </span>
              <h3 className="font-medium text-slate-200 mt-1">
                {ticket.title}
              </h3>
              <p className="text-xs text-slate-400 mt-2">
                Routed to:{" "}
                <span className="text-slate-200">
                  {formatDepartment(ticket.aiDepartment)}
                </span>{" "}
                | Status:{" "}
                <span className="text-indigo-300">
                  {formatStatus(ticket.status)}
                </span>{" "}
                | Severity:{" "}
                <span className="text-amber-400">
                  {ticket.aiPriority.charAt(0) +
                    ticket.aiPriority.slice(1).toLowerCase()}
                </span>{" "}
                | AI Confidence: {(ticket.confidenceScore * 100).toFixed(0)}%
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => handleApprove(ticket.id)}
                aria-label={`Approve routing for ${ticket.id}`}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold"
              >
                Approve Routing
              </button>
            </div>
          </div>
        ))}
        {filteredTickets.length === 0 && (
          <div
            data-testid="triage-desk-empty"
            className="rounded-xl border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-400"
          >
            No tickets match the active filters.
          </div>
        )}
      </div>
    </div>
  );
}
