import React from "react";
import { MapPin, Clock, Wifi, Calendar } from "lucide-react";

interface CheckIn {
  id: string;
  date: string;
  location: string;
  hoursSpent: number;
  wifiStatus: "Excellent" | "Good" | "Fair" | "Poor";
  thumbnail?: string;
}

const mockCheckIns: CheckIn[] = [
  {
    id: "1",
    date: "Today, 9:00 AM",
    location: "The Roasted Bean Cafe",
    hoursSpent: 4.5,
    wifiStatus: "Excellent",
  },
  {
    id: "2",
    date: "Yesterday, 2:30 PM",
    location: "WeWork Downtown",
    hoursSpent: 3,
    wifiStatus: "Good",
  },
  {
    id: "3",
    date: "Oct 15, 10:15 AM",
    location: "Central Library Co-working",
    hoursSpent: 6,
    wifiStatus: "Excellent",
  },
  {
    id: "4",
    date: "Oct 12, 1:00 PM",
    location: "Oceanview Tech Hub",
    hoursSpent: 2.5,
    wifiStatus: "Fair",
  },
  {
    id: "5",
    date: "Oct 10, 8:45 AM",
    location: "Startup Village",
    hoursSpent: 8,
    wifiStatus: "Excellent",
  },
];

const getWifiBadgeStyle = (status: CheckIn["wifiStatus"]) => {
  switch (status) {
    case "Excellent":
      return "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30";
    case "Good":
      return "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400 border-blue-200 dark:border-blue-500/30";
    case "Fair":
      return "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400 border-amber-200 dark:border-amber-500/30";
    case "Poor":
      return "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400 border-red-200 dark:border-red-500/30";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700";
  }
};

export function CheckInHistory() {
  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 flex flex-col h-[500px]">
      <div className="p-6 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-blue-600" />
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Check-In History
          </h2>
        </div>
        <span className="text-sm text-zinc-500 dark:text-zinc-400 font-medium">
          {mockCheckIns.length} Recent
        </span>
      </div>

      <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
        <div className="relative border-l-2 border-zinc-100 dark:border-zinc-800 ml-3 space-y-8">
          {mockCheckIns.map((checkIn) => (
            <div key={checkIn.id} className="relative pl-6 group">
              {/* Timeline dot */}
              <div className="absolute w-4 h-4 rounded-full bg-white dark:bg-zinc-900 border-2 border-blue-500 -left-[9px] top-1.5 group-hover:scale-110 group-hover:bg-blue-500 transition-all duration-300" />

              <div className="flex flex-col gap-3">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {checkIn.location}
                    </h3>
                    <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{checkIn.date}</span>
                    </div>
                  </div>

                  <div
                    className={`px-2.5 py-1 rounded-full border text-xs font-semibold flex items-center gap-1.5 ${getWifiBadgeStyle(checkIn.wifiStatus)}`}
                  >
                    <Wifi className="w-3 h-3" />
                    {checkIn.wifiStatus}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800/80">
                  <div className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300">
                    <Clock className="w-4 h-4 text-zinc-400" />
                    <span>
                      <strong className="text-zinc-900 dark:text-zinc-100">
                        {checkIn.hoursSpent}
                      </strong>{" "}
                      hours spent
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
