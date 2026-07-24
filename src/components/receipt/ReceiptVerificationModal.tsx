"use client";

import React, { useCallback, useRef, useState } from "react";
import { X, Upload, FileText, AlertCircle } from "lucide-react";
import { usePdfSignatureVerifier } from "@/hooks/usePdfSignatureVerifier";
import { SignatureVerificationBadge } from "./SignatureVerificationBadge";

interface ReceiptVerificationModalProps {
  open: boolean;
  onClose: () => void;
}

export function ReceiptVerificationModal({
  open,
  onClose,
}: ReceiptVerificationModalProps) {
  const { status, progress, signatures, result, error, verify, reset } =
    usePdfSignatureVerifier();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) return;
      setSelectedFile(file);
      await verify(file);
    },
    [verify],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleClose = useCallback(() => {
    reset();
    setSelectedFile(null);
    onClose();
  }, [reset, onClose]);

  const handleReset = useCallback(() => {
    reset();
    setSelectedFile(null);
  }, [reset]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 w-full max-w-md rounded-lg shadow-xl overflow-y-auto max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-6 py-4">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <FileText size={18} />
            Verify PDF Receipt Signature
          </h3>
          <button
            onClick={handleClose}
            aria-label="Close modal"
            className="flex items-center justify-center w-8 h-8 rounded-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {!selectedFile ? (
            <div
              className={`flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-md cursor-pointer transition-all text-center ${
                isDragging
                  ? "border-blue-500 bg-blue-500/5"
                  : "border-zinc-300 dark:border-zinc-700 hover:border-zinc-400"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  fileInputRef.current?.click();
                }
              }}
            >
              <Upload size={36} className="text-blue-500 opacity-70 mb-3" />
              <p className="text-sm font-medium mb-1">
                Drop a PDF receipt here or click to browse
              </p>
              <p className="text-xs text-zinc-500">
                Supports PDFs with embedded PKCS#7 digital signatures
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleInputChange}
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 px-3 py-2 bg-zinc-50 dark:bg-zinc-800 rounded text-sm">
                <FileText size={14} />
                <span className="font-medium truncate">
                  {selectedFile.name}
                </span>
                <span className="text-xs text-zinc-500 shrink-0">
                  ({(selectedFile.size / 1024).toFixed(1)} KB)
                </span>
              </div>

              <div className="flex flex-col gap-4">
                <SignatureVerificationBadge status={status} result={result} />

                {(status === "loading" || status === "verifying") && (
                  <div className="flex flex-col gap-2">
                    <div className="w-full bg-zinc-200 dark:bg-zinc-700 rounded-full h-2">
                      <div
                        className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-zinc-500 self-end">
                      {status === "loading"
                        ? "Reading file..."
                        : "Verifying signature..."}{" "}
                      {progress}%
                    </span>
                  </div>
                )}

                {status === "verified" && signatures.length > 0 && (
                  <div className="flex flex-col gap-1 p-3 bg-zinc-50 dark:bg-zinc-800 rounded text-sm">
                    <div className="flex justify-between">
                      <span className="text-zinc-500">Signatures found:</span>
                      <span className="font-medium">{signatures.length}</span>
                    </div>
                    {result?.signingTime && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Signed:</span>
                        <span className="font-medium">
                          {result.signingTime}
                        </span>
                      </div>
                    )}
                    {result?.algorithm && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Algorithm:</span>
                        <span className="font-medium">{result.algorithm}</span>
                      </div>
                    )}
                    {signatures[0]?.subFilter && (
                      <div className="flex justify-between">
                        <span className="text-zinc-500">Format:</span>
                        <span className="font-medium">
                          {signatures[0].subFilter}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {status === "invalid" && result?.error && (
                  <div className="flex flex-col gap-1 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>{result.error}</span>
                    </div>
                    <a
                      href="/docs/WASM_DIGITAL_SIGNATURE_VERIFICATION_GUIDE.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-red-400 underline hover:text-red-300 ml-5 transition-colors"
                    >
                      Read PDF verification docs &rarr;
                    </a>
                  </div>
                )}

                {status === "error" && error && (
                  <div className="flex flex-col gap-1 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-500">
                    <div className="flex items-start gap-2">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                    <a
                      href="/docs/WASM_DIGITAL_SIGNATURE_VERIFICATION_GUIDE.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-red-400 underline hover:text-red-300 ml-5 transition-colors"
                    >
                      Read PDF verification docs &rarr;
                    </a>
                  </div>
                )}
              </div>

              <button
                onClick={handleReset}
                className="self-start px-4 py-2 border border-zinc-300 dark:border-zinc-700 rounded text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
              >
                Verify Another File
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between">
          <p className="text-xs text-zinc-500 leading-relaxed">
            Verification uses WebAssembly-compiled OpenSSL to validate RSA-2048
            and ECDSA signatures against trusted CA certificate chains.
          </p>
          <a
            href="/docs/WASM_DIGITAL_SIGNATURE_VERIFICATION_GUIDE.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline shrink-0 ml-2"
          >
            Documentation
          </a>
        </div>
      </div>
    </div>
  );
}
