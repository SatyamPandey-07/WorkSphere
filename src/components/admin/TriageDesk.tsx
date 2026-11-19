"use client";

import React, { useState } from "react";

interface TriageTicket {
  id: string;
  title: string;
  aiDepartment: string;
  aiPriority: string;
  confidenceScore: number;
}

export default function TriageDesk() {
  const [tickets, setTickets] = useState<TriageTicket[]>([
    { id: "CMP-101", title: "Severe water pipeline leakage on main junction", aiDepartment: "WATER_SUPPLY", aiPriority: "CRITICAL", confidenceScore: 0.96 },
    { id: "CMP-102", title: "Broken street light pole near community hall", aiDepartment: "ELECTRICAL", aiPriority: "MEDIUM", confidenceScore: 0.89 },
  ]);

  const handleApprove = (id: string) => {
    setTickets(tickets.filter(t => t.id !== id));
  };

  return (
    <div className="p-6 bg-slate-950 min-h-screen text-slate-100">
      <h1 className="text-2xl font-bold mb-6">Autonomous AI Triage Review Desk</h1>
      <div className="space-y-4">
        {tickets.map(ticket => (
          <div key={ticket.id} className="bg-slate-900 border border-slate-800 p-4 rounded-xl flex justify-between items-center">
            <div>
              <span className="text-xs text-indigo-400 font-semibold">{ticket.id}</span>
              <h3 className="font-medium text-slate-200 mt-1">{ticket.title}</h3>
              <p className="text-xs text-slate-400 mt-2">
                Routed to: <span className="text-slate-200">{ticket.aiDepartment}</span> | Priority: <span className="text-amber-400">{ticket.aiPriority}</span> | AI Confidence: {(ticket.confidenceScore * 100).toFixed(0)}%
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleApprove(ticket.id)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold">
                Approve Routing
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
