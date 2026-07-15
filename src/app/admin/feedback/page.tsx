import { getPendingFlags } from "../actions";
import FeedbackTable from "./FeedbackTable";
import { AlertCircle } from "lucide-react";

export const metadata = {
  title: "Admin Feedback Dashboard | WorkSphere",
};

export default async function AdminFeedbackPage() {
  let flags: any[] = [];
  let error: string | null = null;

  try {
    flags = await getPendingFlags();
  } catch (err: any) {
    error = err.message || "An error occurred while fetching flags.";
  }

  return (
    <div className="min-h-screen bg-gray-50/50 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Admin Feedback Dashboard</h1>
          <p className="mt-2 text-gray-600">
            Review user reports, flagged venues, and disputed reviews.
          </p>
        </div>

        {error ? (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-8 rounded-r-md">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-red-500" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Authorization Error</h3>
                <div className="mt-1 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <FeedbackTable initialFlags={flags} />
        )}
      </div>
    </div>
  );
}
