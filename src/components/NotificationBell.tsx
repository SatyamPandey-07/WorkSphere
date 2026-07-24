"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, Check, Inbox, Calendar, Zap, Wifi } from "lucide-react";
import Link from "next/link";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  venueId?: string | null;
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/user/notifications", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (e) {
      console.error("Failed to fetch notifications:", e);
    }
  }, []);

  // Poll for new notifications every 20 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 20000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Handle outside clicks to close the dropdown
  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen]);

  const markAllAsRead = async () => {
    try {
      const res = await fetch("/api/user/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markAsRead" }),
      });
      if (res.ok) {
        setUnreadCount(0);
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      }
    } catch (e) {
      console.error("Failed to mark notifications as read:", e);
    }
  };

  // Mark all as read when opening the panel to ensure badge count clears immediately
  const handleToggleOpen = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState && unreadCount > 0) {
      markAllAsRead();
    }
  };

  const getNotificationIcon = (title: string, body: string) => {
    const combined = `${title} ${body}`.toLowerCase();
    if (combined.includes("seat") || combined.includes("available"))
      return <Zap className="w-4 h-4 text-orange-400" />;
    if (combined.includes("booking") || combined.includes("reservation"))
      return <Calendar className="w-4 h-4 text-blue-400" />;
    if (combined.includes("wifi") || combined.includes("internet"))
      return <Wifi className="w-4 h-4 text-emerald-400" />;
    return <Bell className="w-4 h-4 text-indigo-400" />;
  };

  const formatTimeAgo = (dateStr: string) => {
    const now = new Date();
    const diffMs = now.getTime() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return new Date(dateStr).toLocaleDateString([], {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggleOpen}
        className={`relative p-2 border cursor-pointer rounded-xl transition-all active:scale-95 ${
          isOpen
            ? "bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/20"
            : "bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-[var(--primary-accent)] hover:text-white"
        }`}
        title="Notifications"
        aria-label="Open notifications menu"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-controls="notification-drawer"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[9px] font-black rounded-full border-2 border-white dark:border-zinc-950 flex items-center justify-center animate-pulse">
            {unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id="notification-drawer"
          role="menu"
          className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl z-[60] overflow-hidden animate-in slide-in-from-top-2 duration-150"
        >
          <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
            <h3 className="text-xs font-black uppercase tracking-widest text-zinc-800 dark:text-zinc-200">
              Notifications
            </h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-indigo-500 hover:text-indigo-400 cursor-pointer"
              >
                <Check className="w-3 h-3" />
                Read All
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-zinc-100 dark:divide-zinc-800 scrollbar-thin">
            {notifications.length > 0 ? (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 flex gap-3 transition-colors ${
                    !n.read
                      ? "bg-indigo-500/5 dark:bg-indigo-500/10"
                      : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="p-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 shrink-0 self-start">
                    {getNotificationIcon(n.title, n.body)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-bold text-zinc-900 dark:text-zinc-50 truncate">
                      {n.title}
                    </h4>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400 leading-normal break-words">
                      {n.body}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-[9px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                        {formatTimeAgo(n.createdAt)}
                      </span>
                      {n.venueId && (
                        <Link
                          href={`/venues/${n.venueId}`}
                          onClick={() => setIsOpen(false)}
                          className="text-[9px] font-black uppercase tracking-wider text-indigo-500 hover:underline"
                        >
                          View Workspace
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="p-8 flex flex-col items-center justify-center text-center">
                <Inbox className="w-8 h-8 text-zinc-300 dark:text-zinc-700 mb-2" />
                <p className="text-xs text-zinc-500 dark:text-zinc-500">
                  No notifications yet.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
