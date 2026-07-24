"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import Tesseract from "tesseract.js";
import {
  X,
  Camera,
  Upload,
  Globe2,
  Loader2,
  RotateCcw,
  AlertCircle,
  Video,
  Sparkles,
} from "lucide-react";

interface MenuTranslatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPhotoUrl?: string | null;
}

interface DietaryTag {
  label: string;
  icon: string;
  className: string;
}

function getDietaryTags(text: string): DietaryTag[] {
  const normalized = text.toLowerCase();
  const tags: DietaryTag[] = [];

  // Vegan checks
  if (/\b(vegan|plant-based|plant based)\b/.test(normalized)) {
    tags.push({
      label: "Vegan",
      icon: "🌱",
      className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    });
  }
  // Vegetarian checks
  else if (
    /\b(vegetarian|vegetarianism|veg|vegetable|vegetables|tofu|paneer|cheese|mushroom|spinach|pesto|veggie|eggless|milk|butter)\b/.test(
      normalized,
    )
  ) {
    tags.push({
      label: "Vegetarian",
      icon: "🥗",
      className: "bg-green-500/10 text-green-400 border-green-500/20",
    });
  }
  // Non-Veg checks
  else if (
    /\b(chicken|beef|pork|bacon|meat|steak|fish|salmon|tuna|shrimp|seafood|prawn|crab|lobster|lamb|mutton|duck|turkey|pepperoni|ham|sausage|gelatin)\b/.test(
      normalized,
    )
  ) {
    tags.push({
      label: "Non-Veg",
      icon: "🍖",
      className: "bg-red-500/10 text-red-400 border-red-500/20",
    });
  }

  // Gluten-Free checks
  if (
    /\b(gluten-free|gluten free|gf|wheat-free|wheat free|celiac)\b/.test(
      normalized,
    )
  ) {
    tags.push({
      label: "Gluten-Free",
      icon: "🌾",
      className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    });
  }

  return tags;
}

export function MenuTranslatorModal({
  isOpen,
  onClose,
  initialPhotoUrl,
}: MenuTranslatorModalProps) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguage] = useState("English");
  const [extractedLines, setExtractedLines] = useState<string[]>([]);
  const [translatedLines, setTranslatedLines] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Set initial photo from prop if available
  useEffect(() => {
    if (initialPhotoUrl) {
      setPhoto(initialPhotoUrl);
    }
  }, [initialPhotoUrl]);

  // Clean up camera stream on close / unmount
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      // Reset state on modal close if not initial photo
      if (!initialPhotoUrl) {
        setPhoto(null);
      }
      setExtractedLines([]);
      setTranslatedLines([]);
      setError(null);
      setCameraError(null);
    }
  }, [isOpen, stopCamera, initialPhotoUrl]);

  // Handle camera start
  const startCamera = async () => {
    setCameraError(null);
    setIsCameraActive(true);
    setPhoto(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setCameraError(
        "Camera access denied. Please upload a file or verify browser permissions.",
      );
      setIsCameraActive(false);
    }
  };

  // Capture current frame from camera feed
  const capturePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg");
        setPhoto(dataUrl);
        stopCamera();
      }
    }
  };

  // Handle file inputs
  const handleFile = (file: File) => {
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setPhoto(e.target.result as string);
          stopCamera();
        }
      };
      reader.readAsDataURL(file);
    } else {
      setError("Please upload a valid image file.");
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  // Perform local OCR and send for translation
  const translateMenu = async () => {
    if (!photo) return;
    setError(null);
    setExtractedLines([]);
    setTranslatedLines([]);
    setIsExtracting(true);
    setOcrProgress(0);

    try {
      const worker = await Tesseract.createWorker("eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setOcrProgress(Math.floor(m.progress * 100));
          }
        },
      });

      const ret = await worker.recognize(photo);
      await worker.terminate();

      const extractedText = ret.data.text;
      const lines = extractedText
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 2);

      if (lines.length === 0) {
        setError("Could not extract any readable text from the image.");
        setIsExtracting(false);
        return;
      }

      setExtractedLines(lines);
      setIsExtracting(false);
      setIsTranslating(true);

      const response = await fetch("/api/menu-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: lines.join("\n"),
          targetLanguage,
        }),
      });

      if (!response.ok) {
        throw new Error("Translation API request failed.");
      }

      const data = await response.json();
      const translatedList = data.translatedText
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);

      // Pad or trim translated lines to align perfectly with original lines
      const alignedTranslated = lines.map((_, idx) => {
        return translatedList[idx] || "—";
      });

      setTranslatedLines(alignedTranslated);
    } catch (err: any) {
      console.error(err);
      setError(
        err.message || "An error occurred during menu scanning & translation.",
      );
    } finally {
      setIsExtracting(false);
      setIsTranslating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[12000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl bg-zinc-950 border border-white/10 shadow-2xl flex flex-col">
        {/* Modal Header */}
        <div className="p-6 border-b border-white/10 flex justify-between items-center bg-zinc-900/50">
          <h2 className="text-lg font-black uppercase tracking-wider text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            Menu OCR Translator
          </h2>
          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl flex items-start gap-3 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div>{error}</div>
            </div>
          )}

          {/* Upload / Camera Start Selector View */}
          {!photo && !isCameraActive && (
            <div className="grid md:grid-cols-2 gap-6 min-h-[320px]">
              {/* Drag and Drop Zone */}
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 transition-colors text-center cursor-pointer ${
                  dragActive
                    ? "border-indigo-500 bg-indigo-500/5"
                    : "border-white/10 bg-zinc-900/20 hover:border-white/20"
                }`}
              >
                <input
                  type="file"
                  id="menu-file-input"
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFile(e.target.files[0]);
                    }
                  }}
                  className="hidden"
                />
                <label
                  htmlFor="menu-file-input"
                  className="cursor-pointer flex flex-col items-center gap-4"
                >
                  <div className="p-4 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
                    <Upload className="w-8 h-8" />
                  </div>
                  <div>
                    <p className="font-bold text-zinc-200">Upload Menu Photo</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Drag and drop, or click to browse files
                    </p>
                  </div>
                </label>
              </div>

              {/* Camera Activation Zone */}
              <div className="border-2 border-dashed border-white/10 bg-zinc-900/20 rounded-3xl flex flex-col items-center justify-center p-8 text-center">
                {cameraError ? (
                  <div className="flex flex-col items-center gap-3">
                    <AlertCircle className="w-8 h-8 text-amber-500" />
                    <p className="text-xs text-zinc-400 max-w-xs leading-relaxed">
                      {cameraError}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                      <Camera className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-200">
                        Use Camera Capture
                      </p>
                      <p className="text-xs text-zinc-500 mt-1">
                        Use your webcam or phone camera to snap a photo
                      </p>
                    </div>
                    <button
                      onClick={startCamera}
                      className="mt-2 inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase tracking-wider text-xs px-5 py-2.5 rounded-xl transition-all shadow-lg active:scale-95"
                    >
                      <Video className="w-4 h-4" />
                      Start Camera
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Camera Feed */}
          {isCameraActive && (
            <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-black aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-4 px-4">
                <button
                  onClick={stopCamera}
                  className="bg-zinc-800/80 hover:bg-zinc-800 text-zinc-200 font-bold uppercase tracking-wider text-xs px-5 py-3 rounded-xl backdrop-blur-md transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={capturePhoto}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider text-xs px-6 py-3 rounded-xl transition-all shadow-lg shadow-indigo-600/20 active:scale-95 flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  Capture Photo
                </button>
              </div>
            </div>
          )}

          {/* Loaded Photo State & Parameter Selection */}
          {photo &&
            !isExtracting &&
            !isTranslating &&
            extractedLines.length === 0 && (
              <div className="space-y-6">
                <div className="relative max-h-[360px] overflow-hidden rounded-3xl border border-white/10 bg-black flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo}
                    alt="Captured menu preview"
                    className="max-h-[360px] object-contain"
                  />
                  <button
                    onClick={() => {
                      setPhoto(null);
                      setError(null);
                    }}
                    className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black border border-white/10 text-white rounded-full transition-all backdrop-blur-md"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>

                {/* Language Selection and OCR trigger row */}
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-zinc-900/40 border border-white/5 rounded-2xl">
                  <div className="flex items-center gap-3 w-full sm:w-auto">
                    <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-lg">
                      <Globe2 className="w-5 h-5" />
                    </div>
                    <div className="flex-1 sm:flex-none">
                      <label className="block text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1">
                        Translate to
                      </label>
                      <select
                        value={targetLanguage}
                        onChange={(e) => setTargetLanguage(e.target.value)}
                        className="bg-zinc-800 border border-white/10 text-white text-xs font-bold rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500"
                      >
                        {[
                          "English",
                          "Hindi",
                          "French",
                          "German",
                          "Spanish",
                        ].map((lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <button
                    onClick={translateMenu}
                    className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase tracking-wider text-xs px-8 py-3.5 rounded-xl transition-all shadow-lg active:scale-95"
                  >
                    Start OCR & Translation
                  </button>
                </div>
              </div>
            )}

          {/* OCR Processing & Translaton Loading Skeleton */}
          {(isExtracting || isTranslating) && (
            <div className="p-8 bg-zinc-900/30 border border-white/5 rounded-3xl flex flex-col items-center justify-center text-center space-y-4 min-h-[240px]">
              <div className="relative">
                <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
                {isExtracting && (
                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-white">
                    {ocrProgress}%
                  </span>
                )}
              </div>
              <div>
                <p className="font-bold text-zinc-200">
                  {isExtracting
                    ? "Running Tesseract WASM OCR..."
                    : "Fetching Translation..."}
                </p>
                <p className="text-xs text-zinc-500 mt-1 max-w-xs leading-relaxed">
                  {isExtracting
                    ? "Locally scanning photo context and extracting lines of menu text"
                    : "Connecting to server proxy translation endpoints"}
                </p>
              </div>
            </div>
          )}

          {/* Results Side-by-Side View */}
          {extractedLines.length > 0 &&
            translatedLines.length > 0 &&
            !isExtracting &&
            !isTranslating && (
              <div className="space-y-6">
                {/* Reset header */}
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-between p-4 bg-zinc-900/40 border border-white/5 rounded-2xl">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-lg">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-200">
                        Scan Completed Successfully
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        Extracted {extractedLines.length} item lines translated
                        to {targetLanguage}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-3 w-full sm:w-auto">
                    <button
                      onClick={() => {
                        setExtractedLines([]);
                        setTranslatedLines([]);
                        setPhoto(null);
                        setError(null);
                      }}
                      className="flex-1 sm:flex-none border border-white/10 hover:bg-white/5 text-zinc-300 font-bold uppercase tracking-wider text-xs px-5 py-3 rounded-xl transition-all"
                    >
                      Scan Another
                    </button>
                    <select
                      value={targetLanguage}
                      onChange={(e) => {
                        setTargetLanguage(e.target.value);
                        // Trigger translation again immediately with the new language
                        setTimeout(() => translateMenu(), 50);
                      }}
                      className="bg-zinc-800 border border-white/10 text-white text-xs font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500"
                    >
                      {["English", "Hindi", "French", "German", "Spanish"].map(
                        (lang) => (
                          <option key={lang} value={lang}>
                            {lang}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                </div>

                {/* Grid Comparison */}
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Left Column: Original OCR text */}
                  <div className="space-y-3 p-5 rounded-2xl bg-zinc-950 border border-white/5">
                    <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400 pb-2 border-b border-white/5">
                      Original Text (Detected)
                    </h3>
                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 text-xs">
                      {extractedLines.map((line, idx) => (
                        <div
                          key={idx}
                          className="p-2.5 rounded-lg bg-zinc-900/40 text-zinc-300 font-mono leading-relaxed"
                        >
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Right Column: Translated text & tags */}
                  <div className="space-y-3 p-5 rounded-2xl bg-zinc-950 border border-white/5">
                    <h3 className="text-xs font-black uppercase tracking-wider text-zinc-400 pb-2 border-b border-white/5">
                      Translation ({targetLanguage})
                    </h3>
                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1 text-xs">
                      {translatedLines.map((line, idx) => {
                        const tags = getDietaryTags(line);
                        return (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg bg-zinc-900 border border-white/5 text-zinc-100 flex items-start justify-between gap-3 leading-relaxed"
                          >
                            <span className="font-semibold">{line}</span>
                            {tags.length > 0 && (
                              <div className="flex flex-col gap-1 shrink-0">
                                {tags.map((tag, tIdx) => (
                                  <span
                                    key={tIdx}
                                    className={`inline-flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${tag.className}`}
                                  >
                                    <span>{tag.icon}</span>
                                    <span>{tag.label}</span>
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
