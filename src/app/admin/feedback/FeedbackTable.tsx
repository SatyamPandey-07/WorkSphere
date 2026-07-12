"use client";

import { useState } from "react";
import { dismissFlag, deleteFlaggedItem } from "../actions";

type Flag = {
  id: string;
  type: "VENUE" | "REVIEW";
  reason: string;
  status: "PENDING" | "DISMISSED" | "RESOLVED";
  createdAt: Date;
  reportedBy: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  };
  itemDetails: any;
};

export default function FeedbackTable({ initialFlags }: { initialFlags: Flag[] }) {
  const [flags, setFlags] = useState<Flag[]>(initialFlags);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleDismiss = async (flagId: string) => {
    setLoadingId(flagId);
    try {
      await dismissFlag(flagId);
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    } catch (error) {
      console.error(error);
      alert("Failed to dismiss flag");
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (flagId: string) => {
    if (!confirm("Are you sure you want to delete this flagged item? This action cannot be undone.")) return;
    
    setLoadingId(flagId);
    try {
      await deleteFlaggedItem(flagId);
      setFlags((prev) => prev.filter((f) => f.id !== flagId));
    } catch (error) {
      console.error(error);
      alert("Failed to delete item");
    } finally {
      setLoadingId(null);
    }
  };

  if (flags.length === 0) {
    return (
      <div className="bg-white rounded-xl p-8 text-center shadow-sm border border-gray-100">
        <h3 className="text-lg font-medium text-gray-900 mb-2">All Caught Up!</h3>
        <p className="text-gray-500">There are no pending flags to review.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-700 border-b border-gray-100">
            <tr>
              <th className="px-6 py-4 font-semibold">Target</th>
              <th className="px-6 py-4 font-semibold">Reason</th>
              <th className="px-6 py-4 font-semibold">Reported By</th>
              <th className="px-6 py-4 font-semibold">Date</th>
              <th className="px-6 py-4 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {flags.map((flag) => (
              <tr key={flag.id} className="hover:bg-gray-50/50 transition-colors">
                <td className="px-6 py-4 align-top">
                  <div className="flex flex-col gap-1">
                    <span className={`inline-flex w-fit items-center px-2 py-0.5 rounded text-xs font-medium ${flag.type === 'VENUE' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                      {flag.type}
                    </span>
                    {flag.type === "VENUE" && flag.itemDetails && (
                      <div className="text-gray-900 font-medium mt-1">{flag.itemDetails.name}</div>
                    )}
                    {flag.type === "REVIEW" && flag.itemDetails && (
                      <div className="text-gray-900 line-clamp-2 mt-1 italic">
                        "{flag.itemDetails.comment}"
                        <div className="text-xs text-gray-500 mt-1 not-italic">
                          Venue: {flag.itemDetails.venue?.name}
                        </div>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 align-top text-gray-700">
                  {flag.reason}
                </td>
                <td className="px-6 py-4 align-top text-gray-500">
                  <div>{flag.reportedBy.firstName} {flag.reportedBy.lastName}</div>
                  <div className="text-xs">{flag.reportedBy.email}</div>
                </td>
                <td className="px-6 py-4 align-top text-gray-500 whitespace-nowrap">
                  {new Date(flag.createdAt).toLocaleDateString()}
                </td>
                <td className="px-6 py-4 align-top text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => handleDismiss(flag.id)}
                      disabled={loadingId === flag.id}
                      className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={() => handleDelete(flag.id)}
                      disabled={loadingId === flag.id}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 transition-colors"
                    >
                      Delete Item
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
