"use client";

import {
    X, MapPin, Wifi, Zap, Volume2, Navigation, Heart,
    Coffee, BookOpen, Building2, Star, Info, MessageSquare
} from "lucide-react";
import { useEffect, useState } from "react";

import { Venue } from "./ChatMessages";

interface VenueDetailDialogProps {
    venue: Venue | null;
    isOpen: boolean;
    isFavorited: boolean;
    onClose: () => void;
    onGetDirections: (venue: Venue) => void;
    onToggleFavorite: (venue: Venue) => void;
    onRate?: (venue: Venue) => void;
}

export function VenueDetailDialog({
    venue,
    isOpen,
    isFavorited,
    onClose,
    onGetDirections,
    onToggleFavorite,
    onRate,
}: VenueDetailDialogProps) {
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [photoLoading, setPhotoLoading] = useState(true);

    useEffect(() => {
        if (!venue) return;

        setPhotoLoading(true);
        const params = new URLSearchParams({
            name: venue.name,
            lat: String(venue.lat),
            lng: String(venue.lng),
        });

        fetch(`/api/venues/${encodeURIComponent(venue.id)}/photo?${params}`)
            .then(r => r.json())
            .then(data => {
                if (data.photoUrl) setPhotoUrl(data.photoUrl);
                setPhotoLoading(false);
            })
            .catch(() => setPhotoLoading(false));
    }, [venue]);

    if (!isOpen || !venue) return null;

    const CategoryIcon =
        venue.category === "cafe" ? Coffee :
            venue.category === "library" ? BookOpen :
                venue.category === "coworking_space" ? Building2 : MapPin;

    const venueFallbacks: Record<string, string> = {
        cafe: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?auto=format&fit=crop&q=80&w=1200",
        library: "https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&q=80&w=1200",
        coworking_space: "https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&q=80&w=1200",
        default: "https://images.unsplash.com/photo-1447366216548-37526070297c?auto=format&fit=crop&q=80&w=1200"
    };

    const displayPhoto = photoUrl || venueFallbacks[venue.category || "default"] || venueFallbacks.default;

    return (
        <div className="fixed inset-0 z-[10000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-zinc-950/95 animate-in fade-in duration-300">
            <div
                className="bg-white dark:bg-zinc-900 w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-t-3xl sm:rounded-3xl shadow-[0_20px_100px_rgba(0,0,0,0.9)] border border-zinc-200 dark:border-zinc-800 animate-in slide-in-from-bottom-12 zoom-in-95 duration-500"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Hero Image Section */}
                <div className="relative h-64 sm:h-80 w-full overflow-hidden">
                    {photoLoading ? (
                        <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                    ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                            src={displayPhoto}
                            alt={venue.name}
                            className="w-full h-full object-cover"
                        />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent" />

                    {/* Close Button */}
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-3 bg-white hover:bg-zinc-100 text-black rounded-full shadow-2xl border border-zinc-200 transition-all font-bold active:scale-90"
                    >
                        <X className="w-6 h-6" />
                    </button>

                    {/* Title Overlay */}
                    <div className="absolute bottom-6 left-6 right-6">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="flex items-center gap-1.5 text-[10px] tracking-widest uppercase font-black bg-blue-600 text-white px-2.5 py-1 rounded shadow-lg">
                                <CategoryIcon className="w-3.5 h-3.5" />
                                {venue.category?.replace('_', ' ')}
                            </span>
                            {venue.score != null && (
                                <span className="text-[10px] tracking-widest uppercase font-black bg-white text-zinc-900 border border-zinc-200 px-2.5 py-1 rounded shadow-lg">
                                    VIBE SCORE: {Math.round(venue.score * 10)}%
                                </span>
                            )}
                        </div>
                        <h2 className="text-4xl font-black text-white tracking-tighter leading-none mb-1 text-shadow-lg">
                            {venue.name}
                        </h2>
                        <div className="flex items-center gap-1.5 text-zinc-300 text-sm font-medium">
                            <MapPin className="w-4 h-4 text-blue-400" />
                            <span className="truncate">{venue.address || "Location details loading..."}</span>
                        </div>
                    </div>
                </div>

                {/* Content Section */}
                <div className="p-8 bg-white dark:bg-zinc-900 overflow-y-auto max-h-[calc(90vh-320px)]">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-4 mb-8">
                        <div className="bg-zinc-50 dark:bg-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center border border-zinc-100 dark:border-zinc-700">
                            <div className="p-3 rounded-xl bg-blue-500/10 mb-3">
                                <Wifi className="w-6 h-6 text-blue-500" />
                            </div>
                            <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">WiFi</span>
                            <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none">
                                {venue.wifi ? "Fast" : "TBD"}
                            </span>
                        </div>
                        <div className="bg-zinc-50 dark:bg-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center border border-zinc-100 dark:border-zinc-700">
                            <div className="p-3 rounded-xl bg-orange-500/10 mb-3">
                                <Zap className="w-6 h-6 text-orange-500" />
                            </div>
                            <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">Power</span>
                            <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none">
                                {venue.hasOutlets ? "Yes" : "No"}
                            </span>
                        </div>
                        <div className="bg-zinc-50 dark:bg-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center border border-zinc-100 dark:border-zinc-700">
                            <div className="p-3 rounded-xl bg-pink-500/10 mb-3">
                                <Volume2 className="w-6 h-6 text-pink-500" />
                            </div>
                            <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">Noise</span>
                            <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none capitalize">
                                {venue.noiseLevel || "Normal"}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-blue-50 dark:bg-blue-900/10 p-5 rounded-2xl border border-blue-100 dark:border-blue-900/30">
                            <h3 className="text-xs font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-2">
                                <Info className="w-4 h-4" />
                                Intelligence Brief
                            </h3>
                            <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed font-medium">
                                Analysis based on Multi-Agent telemetry suggests this {venue.category || "workspace"}
                                is optimal for {venue.category === 'cafe' ? 'collaborative sessions' : 'high-focus work'}.
                                Noise floor is {venue.noiseLevel || "ambient"} and connectivity is verified as {venue.wifi ? 'stable' : 'pending'}.
                            </p>
                        </div>

                        <div className="flex flex-col gap-3 pt-4">
                            <button
                                onClick={() => onGetDirections(venue)}
                                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-black uppercase tracking-widest py-4 px-8 rounded-2xl transition-all shadow-xl shadow-blue-500/20 active:scale-[0.98]"
                            >
                                <Navigation className="w-5 h-5" />
                                Navigate
                            </button>
                            <div className="flex gap-3">
                                <button
                                    onClick={() => onToggleFavorite(venue)}
                                    className={`flex-1 flex items-center justify-center gap-2 font-black uppercase tracking-widest py-3 px-6 rounded-2xl transition-all border-2 ${
                                            isFavorited
                                            ? "bg-red-500 border-red-400 text-white shadow-xl shadow-red-500/20"
                                            : "bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 shadow-md"
                                        }`}
                                >
                                    <Heart className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`} />
                                    {isFavorited ? "Saved" : "Save"}
                                </button>
                                {onRate && (
                                    <button
                                        onClick={() => onRate(venue)}
                                        className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700 font-black uppercase tracking-widest py-3 px-6 rounded-2xl transition-all shadow-md active:scale-[0.98]"
                                    >
                                        <Star className="w-4 h-4" />
                                        Rate
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
