import React, { useState } from 'react';
import { encryptDocument } from '@/lib/crypto/documentVault';

interface DocumentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: () => void;
}

export const DocumentUploadModal: React.FC<DocumentUploadModalProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState<string>('');
  const [isEncrypting, setIsEncrypting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  if (!isOpen) return null;

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !passphrase) return;

    setIsEncrypting(true);
    setStatusMessage('Deriving encryption key & encrypting client-side...');

    try {
      // Encrypt zero-knowledge client-side
      const encryptedPayload = await encryptDocument(file, passphrase);
      setStatusMessage('Encryption complete. Uploading ciphertext to secure vault...');

      // Dispatch encrypted payload to server
      const response = await fetch('/api/vault/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: encryptedPayload.originalName,
          mimeType: encryptedPayload.mimeType,
          checksum: encryptedPayload.checksum,
          // Convert binary salts & buffers to base64 for JSON transport
          salt: Array.from(encryptedPayload.salt),
          chunksCount: encryptedPayload.chunks.length,
          size: encryptedPayload.originalSize,
        }),
      });

      if (!response.ok) throw new Error('Failed to upload encrypted document payload.');

      setStatusMessage('Document securely uploaded with zero plaintext exposure.');
      if (onUploadSuccess) onUploadSuccess();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Vault encryption/upload error:', err);
      setStatusMessage('Error encrypting or uploading document.');
    } finally {
      setIsEncrypting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-md w-full text-white shadow-2xl space-y-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <h3 className="text-base font-bold text-slate-100">Secure Zero-Knowledge Vault</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">✕</button>
        </div>

        <form onSubmit={handleUpload} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Select Document (Passport, ID, Contract)</label>
            <input
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="w-full text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-550 cursor-pointer"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-300">Master Passphrase (Never sent to server)</label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter secure master passphrase"
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {statusMessage && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
              {statusMessage}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!file || !passphrase || isEncrypting}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-50"
            >
              {isEncrypting ? 'Encrypting...' : 'Encrypt & Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DocumentUploadModal;