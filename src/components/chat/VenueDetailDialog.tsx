"use client";

import {
    X, MapPin, Wifi, Zap, Volume2, Navigation, Heart,
    ExternalLink, Clock, Coffee, BookOpen, Building2, Star
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
}

export function VenueDetailDialog({
    venue,
    isOpen,
    isFavorited,
    onClose,
    onGetDirections,
    onToggleFavorite,
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
        default: "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&q=80&w=1200"
    };

    const displayPhoto = photoUrl || venueFallbacks[venue.category || "default"] || venueFallbacks.default;

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div
                className="glass-card w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom-8 duration-500"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Hero Image Section */}
                <div className="relative h-64 sm:h-80 w-full overflow-hidden">
                    {photoLoading ? (
                        <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 animate-pulse" />
                    ) : (
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
                        className="absolute top-4 right-4 p-2 bg-black/20 backdrop-blur-md rounded-full text-white border border-white/20 hover:bg-black/40 transition-all"
                    >
                        <X className="w-5 h-5" />
                    </button>

                    {/* Title Overlay */}
                    <div className="absolute bottom-6 left-6 right-6">
                        <div className="flex items-center gap-2 mb-2">
                            <span className="flex items-center gap-1 text-[10px] tracking-widest uppercase font-black bg-blue-600 text-white px-2 py-0.5 rounded shadow-lg">
                                <CategoryIcon className="w-3 h-3" />
                                {venue.category?.replace('_', ' ')}
                            </span>
                            {venue.score != null && (
                                <span className="text-[10px] tracking-widest uppercase font-black bg-white/10 backdrop-blur-md text-white border border-white/20 px-2 py-0.5 rounded shadow-lg">
                                    VIBE SCORE: {Math.round(venue.score * 10)}%
                                </span>
                            )}
                        </div>
                        <h2 className="text-3xl font-black text-white tracking-tight leading-none mb-1 text-glow">
                            {venue.name}
                        </h2>
                        <div className="flex items-center gap-1.5 text-zinc-300 text-sm">
                            <MapPin className="w-3.5 h-3.5 text-blue-400" />
                            <span className="truncate">{venue.address || "Location details loading..."}</span>
                        </div>
                    </div>
                </div>

                {/* Content Section */}
                <div className="p-6 bg-white dark:bg-zinc-950 overflow-y-auto max-h-[calc(90vh-320px)]">
                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-3 mb-8">
                        <div className="glass-card p-4 rounded-2xl flex flex-col items-center text-center">
                            <div className="p-2 rounded-xl bg-blue-500/10 mb-2">
                                <Wifi className="w-5 h-5 text-blue-500" />
                            </div>
                            <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mb-1">WiFi</span>
                            <span className="text-lg font-black text-zinc-900 dark:text-zinc-50 leading-none">
                                {venue.wifi ? "Fast" : "TBD"}
                            </span>
                        </div>
                        <div className="glass-card p-4 rounded-2xl flex flex-col items-center text-center">
                            <div className="p-2 rounded-xl bg-orange-500/10 mb-2">
                                <Zap className="w-5 h-5 text-orange-500" />
                            </div>
                            <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mb-1">Power</span>
                            <span className="text-lg font-black text-zinc-900 dark:text-zinc-50 leading-none">
                                {venue.hasOutlets ? "Yes" : "No"}
                            </span>
                        </div>
                        <div className="glass-card p-4 rounded-2xl flex flex-col items-center text-center">
                            <div className="p-2 rounded-xl bg-pink-500/10 mb-2">
                                <Volume2 className="w-5 h-5 text-pink-500" />
                            </div>
                            <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase mb-1">Noise</span>
                            <span className="text-lg font-black text-zinc-900 dark:text-zinc-50 leading-none capitalize">
                                {venue.noiseLevel || "Normal"}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-widest text-zinc-900 dark:text-zinc-50 mb-3 flex items-center gap-2">
                                <Star className="w-4 h-4 text-blue-500" />
                                Space Highlights
                            </h3>
                            <p className="text-zinc-600 dark:text-zinc-400 text-sm leading-relaxed">
                                This {venue.category || "workspace"} has been analyzed by our Multi-Agent engine.
                                Based on current data, it features {venue.noiseLevel || "moderate"} noise levels
                                and is highly recommended for {venue.category === 'cafe' ? 'casual coding sessions' : 'focused deep work'}.
                            </p>
                        </div>

                        <div className="flex gap-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
                            <button
                                onClick={() => onGetDirections(venue)}
                                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-2xl transition-all shadow-lg glow-blue hover:scale-[1.02]"
                            >
                                <Navigation className="w-4 h-4" />
                                Navigate
                            </button>
                            <button
                                onClick={() => onToggleFavorite(venue)}
                                className={`flex-1 flex items-center justify-center gap-2 font-bold py-3 px-6 rounded-2xl transition-all border ${isFavorited
                                    ? "bg-red-500/10 border-red-500/30 text-red-500 shadow-xl shadow-red-500/10"
                                    : "bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                                    }`}
                            >
                                <Heart className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`} />
                                {isFavorited ? "Saved" : "Save Spot"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
