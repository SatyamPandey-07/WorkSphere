import React from 'react';
import { useAvionicsAudio } from '../../hooks/useAvionicsAudio';

interface AvionicsAudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AvionicsAudioSettingsModal: React.FC<AvionicsAudioSettingsModalProps> = ({ isOpen, onClose }) => {
  const { audioDevices, selectedSinkId, setAudioSink } = useAvionicsAudio();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-2xl border border-slate-800 w-full max-w-md">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
          <h2 className="text-lg font-bold tracking-wide">Audio Output Settings</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-sm font-semibold px-2.5 py-1 rounded-lg bg-slate-800 transition"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Preferred Audio Output Device
            </label>
            <select
              value={selectedSinkId}
              onChange={(e) => setAudioSink(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white focus:outline-none focus:border-emerald-500 cursor-pointer transition"
            >
              <option value="default">Default System Output</option>
              {audioDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Audio Output (${device.deviceId.slice(0, 6)}...)`}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Route spatial chimes and ambient focus sounds to your preferred headphones or laptop speakers. Uses Web Audio API <code>setSinkId()</code>.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition shadow-lg shadow-emerald-900/30"
          >
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvionicsAudioSettingsModal;