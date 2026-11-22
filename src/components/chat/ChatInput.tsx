'use client';

import React, { useRef, useState } from 'react';
import {
  compressImageFile,
  type ImageCompressionResult,
} from '@/lib/media/imageCompressor';

export interface ChatInputProps {
  onSendMessage?: (payload: {
    text: string;
    attachments: File[];
    compressionMeta: ImageCompressionResult[];
  }) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  placeholder = 'Message the room...',
  disabled = false,
}) => {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [compressionMeta, setCompressionMeta] = useState<ImageCompressionResult[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processIncomingFiles = async (rawFiles: FileList | File[]) => {
    const fileArray = Array.from(rawFiles);
    if (fileArray.length === 0) return;

    setIsCompressing(true);
    try {
      const results = await Promise.all(
        fileArray.map((file) => compressImageFile(file))
      );
      setAttachments((prev) => [...prev, ...results.map((r) => r.file)]);
      setCompressionMeta((prev) => [...prev, ...results]);
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled || !e.dataTransfer?.files?.length) return;
    await processIncomingFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || isCompressing) return;
    if (!text.trim() && attachments.length === 0) return;

    await onSendMessage?.({
      text: text.trim(),
      attachments,
      compressionMeta,
    });

    setText('');
    setAttachments([]);
    setCompressionMeta([]);
  };

  return (
    <div
      data-testid="chat-dropzone"
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`rounded-xl border p-3 transition-colors ${
        isDragging
          ? 'border-indigo-500 bg-indigo-50/50'
          : 'border-slate-200 bg-white'
      }`}
    >
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Attach files"
          data-testid="chat-file-input"
          disabled={disabled || isCompressing}
          onChange={(e) => {
            if (e.target.files) {
              void processIncomingFiles(e.target.files);
              e.target.value = '';
            }
          }}
          className="hidden"
        />

        <button
          type="button"
          disabled={disabled || isCompressing}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {isCompressing ? 'Compressing...' : 'Attach'}
        </button>

        <input
          type="text"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
        />

        <button
          type="submit"
          disabled={disabled || isCompressing}
          className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {attachments.length > 0 && (
        <ul data-testid="chat-attachment-list" className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((file, idx) => (
            <li
              key={`${file.name}-${idx}`}
              className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700"
            >
              {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};