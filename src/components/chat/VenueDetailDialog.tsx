"use client";

import {
    X, MapPin, Wifi, Zap, Volume2, Navigation, Heart,
    Coffee, BookOpen, Building2, Star, Info, Camera, Eye
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
    const [liveScore, setLiveScore] = useState<number | null>(null);

    // Tab and dynamic content states
    const [activeTab, setActiveTab] = useState<"overview" | "reviews" | "menu">("overview");
    const [reviews, setReviews] = useState<any[]>([]);
    const [menuPhotos, setMenuPhotos] = useState<string[]>([]);
    const [uploadingMenu, setUploadingMenu] = useState(false);
    const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

    // Effect 1: Fetch photos and reset state on venue change
    useEffect(() => {
        if (!venue) return;

        setLiveScore(venue.score ?? null);
        setPhotoLoading(true);
        setActiveTab("overview");
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

    // Effect 2: Handle real-time SSE updates
    useEffect(() => {
        if (!isOpen || !venue) return;

        console.log(`[SSE] Connecting to live stream for venue: ${venue.id}`);
        const eventSource = new EventSource(`/api/venues/stream?id=${encodeURIComponent(venue.id)}`);

        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data && typeof data.score === 'number') {
                    setLiveScore(data.score);
                }
            } catch (err) {
                console.error("Error parsing SSE data:", err);
            }
        };

        eventSource.onerror = (error) => {
            console.error("SSE Connection Error:", error);
        };

        return () => {
            console.log(`[SSE] Terminating active stream for venue: ${venue.id}`);
            eventSource.close();
        };
    }, [venue, isOpen]);

    // Effect 3: Fetch reviews and menu photos based on active tab
    useEffect(() => {
        if (!venue || !isOpen) return;

        if (activeTab === "reviews") {
            setReviews([]);
            fetch(`/api/venues/${encodeURIComponent(venue.id)}/reviews`)
                .then(r => r.json())
                .then(data => {
                    if (data.reviews) setReviews(data.reviews);
                })
                .catch(err => console.error(err));
        } else if (activeTab === "menu") {
            setMenuPhotos([]);
            fetch(`/api/venues/${encodeURIComponent(venue.id)}/menu`)
                .then(r => r.json())
                .then(data => {
                    if (data.menuPhotos) setMenuPhotos(data.menuPhotos);
                })
                .catch(err => console.error(err));
        }
    }, [venue, isOpen, activeTab]);

    const compressImage = (file: File): Promise<Blob> => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new window.Image();
                img.src = event.target?.result as string;
                img.onload = () => {
                    const canvas = document.createElement("canvas");
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext("2d");
                    ctx?.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(
                        (blob) => {
                            resolve(blob || file);
                        },
                        "image/jpeg",
                        0.8
                    );
                };
            };
        });
    };

    const handleMenuUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !venue) return;

        setUploadingMenu(true);
        try {
            const compressedBlob = await compressImage(file);
            const formData = new FormData();
            formData.append("file", compressedBlob, file.name);

            const uploadRes = await fetch("/api/upload", {
                method: "POST",
                body: formData,
            });
            if (!uploadRes.ok) throw new Error("Upload failed");
            const uploadData = await uploadRes.json();

            const menuRes = await fetch(`/api/venues/${encodeURIComponent(venue.id)}/menu`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    photoUrl: uploadData.url,
                    venue: {
                        placeId: venue.id,
                        name: venue.name,
                        lat: venue.lat,
                        lng: venue.lng,
                        category: venue.category,
                        address: venue.address,
                    }
                }),
            });
            if (!menuRes.ok) throw new Error("Menu save failed");
            const menuData = await menuRes.json();
            
            setMenuPhotos(menuData.menuPhotos);
        } catch (err) {
            console.error("Menu upload error:", err);
            alert("Failed to upload menu photo.");
        } finally {
            setUploadingMenu(false);
        }
    };

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
    const currentScore = liveScore !== null ? liveScore : venue.score;

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
                            {currentScore != null && (
                                <span className="text-[10px] tracking-widest uppercase font-black bg-white text-zinc-900 border border-zinc-200 px-2.5 py-1 rounded shadow-lg animate-pulse">
                                    VIBE SCORE: {Math.round(currentScore * 10)}%
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

                {/* Tab Navigation */}
                <div className="flex border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 px-8 py-3 gap-6">
                    {[
                        { id: "overview", label: "Overview" },
                        { id: "reviews", label: "Reviews" },
                        { id: "menu", label: "Menus & Prices" }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`pb-1 text-xs font-black uppercase tracking-wider border-b-2 transition-all ${
                                activeTab === tab.id
                                    ? "border-blue-600 text-blue-600"
                                    : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Content Section */}
                <div className="p-8 bg-white dark:bg-zinc-900 overflow-y-auto max-h-[calc(90vh-360px)]">
                    {activeTab === "overview" && (
                        <>
                            {/* Stats Grid */}
                            <div className="grid grid-cols-3 gap-4 mb-8">
                                <div className="bg-zinc-50 dark:bg-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center border border-zinc-100 dark:border-zinc-700">
                                    <div className="p-3 rounded-xl bg-blue-500/10 mb-3">
                                        <Wifi className="w-6 h-6 text-blue-500" />
                                    </div>
                                    <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">WiFi</span>
                                    <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none">
                                        {venue.wifiSpeed ? `${venue.wifiSpeed} Mbps` : (venue.wifi ? "Fast" : "TBD")}
                                    </span>
                                </div>
                                <div className="bg-zinc-50 dark:bg-zinc-800 p-5 rounded-2xl flex flex-col items-center text-center border border-zinc-100 dark:border-zinc-700">
                                    <div className="p-3 rounded-xl bg-orange-500/10 mb-3">
                                        <Zap className="w-6 h-6 text-orange-500" />
                                    </div>
                                    <span className="text-[10px] font-black text-zinc-400 tracking-widest uppercase mb-1">Power</span>
                                    <span className="text-xl font-black text-zinc-900 dark:text-zinc-50 leading-none uppercase tracking-wide">
                                        {venue.outletDensity && venue.outletDensity !== 'none'
                                            ? venue.outletDensity.replace('_', ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
                                            : (venue.hasOutlets ? "Yes" : "No")}
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
                                        {venue.hasErgonomic && " The workspace features verified ergonomic chairs and height-adjustable/standing desks."}
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
                        </>
                    )}

                    {activeTab === "reviews" && (
                        <div className="space-y-4">
                            {reviews.length === 0 ? (
                                <div className="py-12 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl text-center px-4">
                                    <Info className="w-8 h-8 text-zinc-400 mx-auto mb-2" />
                                    <p className="text-xs font-black uppercase tracking-wider text-zinc-500">No Reviews Yet</p>
                                    <p className="text-[10px] text-zinc-400 mt-1">Be the first to share your workspace rating.</p>
                                </div>
                            ) : (
                                reviews.map((review, idx) => (
                                    <div key={idx} className="p-4 border border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/20 rounded-2xl space-y-3">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200 uppercase">
                                                    {review.user?.firstName || 'Nomad'} {review.user?.lastName || 'Scout'}
                                                </span>
                                                <div className="flex items-center gap-1.5 mt-1 text-[9px] font-mono text-zinc-500">
                                                    <span>WiFi: {review.wifiQuality}/5</span>
                                                    <span>•</span>
                                                    <span>Power: {review.hasOutlets ? 'Yes' : 'No'}</span>
                                                    <span>•</span>
                                                    <span>Noise: {review.noiseLevel}</span>
                                                </div>
                                            </div>
                                            {review.wifiSpeed && (
                                                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded text-[9px] font-black tracking-wider">
                                                    {review.wifiSpeed} MBPS
                                                </span>
                                            )}
                                        </div>
                                        {review.comment && (
                                            <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300 leading-relaxed bg-white dark:bg-zinc-900 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
                                                {review.comment}
                                            </p>
                                        )}
                                        {review.speedtestPhoto && (
                                            <button
                                                onClick={() => setPreviewPhoto(review.speedtestPhoto)}
                                                className="inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-blue-600 bg-blue-500/10 hover:bg-blue-500/20 px-3 py-1.5 rounded-lg border border-blue-500/20 transition-all active:scale-95"
                                            >
                                                <Eye className="w-3.5 h-3.5" />
                                                View Speedtest Screenshot
                                            </button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === "menu" && (
                        <div className="space-y-6">
                            {/* Upload Area */}
                            <label className="flex flex-col items-center justify-center border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 bg-zinc-50 dark:bg-zinc-800/10 hover:border-zinc-300 dark:hover:border-zinc-700 cursor-pointer transition-all">
                                {uploadingMenu ? (
                                    <div className="flex flex-col items-center gap-2 py-2">
                                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                                        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black">Uploading...</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-1 text-center">
                                        <Camera className="w-8 h-8 text-zinc-400 mb-1" />
                                        <span className="text-xs font-black uppercase tracking-wider text-zinc-700 dark:text-zinc-300">Upload Menu / Drink Options</span>
                                        <span className="text-[10px] text-zinc-500">Share workspace pricing & menu options</span>
                                    </div>
                                )}
                                <input type="file" accept="image/*" onChange={handleMenuUpload} className="hidden" disabled={uploadingMenu} />
                            </label>

                            {/* Menu photos list */}
                            {menuPhotos.length === 0 ? (
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest py-8 rounded-2xl border-2 border-dashed border-zinc-100 dark:border-zinc-800 text-center animate-pulse">No menu photos added yet</p>
                            ) : (
                                <div className="grid grid-cols-2 gap-4">
                                    {menuPhotos.map((photo, i) => (
                                        <div key={i} className="relative h-32 rounded-xl overflow-hidden border border-zinc-100 dark:border-zinc-800 group/item cursor-pointer" onClick={() => setPreviewPhoto(photo)}>
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={photo} alt={`Menu ${i+1}`} className="w-full h-full object-cover transition-transform group-hover/item:scale-105 duration-300" />
                                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/item:opacity-100 transition-opacity flex items-center justify-center">
                                                <Eye className="w-6 h-6 text-white" />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Photo Preview Modal Overlay */}
            {previewPhoto && (
                <div className="fixed inset-0 z-[11000] flex items-center justify-center p-4 bg-black/90 animate-in fade-in duration-200" onClick={() => setPreviewPhoto(null)}>
                    <div className="relative max-w-4xl max-h-[90vh] overflow-hidden rounded-2xl shadow-2xl border border-zinc-800" onClick={e => e.stopPropagation()}>
                        <button
                            onClick={() => setPreviewPhoto(null)}
                            className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black text-white rounded-full transition-all"
                        >
                            <X className="w-5 h-5" />
                        </button>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewPhoto} alt="Speedtest/Menu Preview" className="max-w-full max-h-[90vh] object-contain" />
                    </div>
                </div>
            )}
        </div>
    );
}