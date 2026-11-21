import React, { useState } from 'react';
import { CheckCircle2, Download, Monitor, Smartphone, WifiOff } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5" />
        SHPL App Installed
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (isInstallable) {
            void install();
          } else {
            setShowGuide(true);
          }
        }}
        className={`inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
          compact
            ? 'px-2.5 py-1.5 text-xs bg-emerald-600 text-white hover:bg-emerald-700'
            : 'px-4 py-2 text-xs bg-emerald-600 text-white hover:bg-emerald-700'
        }`}
      >
        <Smartphone className="w-3.5 h-3.5" />
        {isInstallable ? 'Install SHPL App' : 'Install SHPL (Win/Android/iOS)'}
      </button>

      {showGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white border border-slate-200 p-6 shadow-xl space-y-3 text-xs">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Download className="w-4 h-4 text-blue-600" />
              Install SHPL Software (Windows, Android &amp; iOS)
            </div>
            <div className="space-y-2.5 text-slate-600 leading-relaxed">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5 mb-1">
                  <Monitor className="w-3.5 h-3.5 text-blue-600" />
                  Windows PC (Google Chrome / Microsoft Edge)
                </div>
                <p>
                  1. Open <span className="font-mono font-semibold text-slate-800">{typeof window !== 'undefined' ? window.location.origin : 'http://<SERVER-IP>:3000'}</span> in Chrome.<br />
                  2. Click the <strong>Install SHPL</strong> icon in the address bar (or <strong>⋮ Menu &rarr; Cast, save, and share &rarr; Install SHPL...</strong>).
                </p>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5 mb-1">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
                  Android Phone / Tablet (Chrome)
                </div>
                <p>
                  1. Open the same Wi-Fi IP URL in <strong>Google Chrome</strong>.<br />
                  2. Tap <strong>⋮ Menu &rarr; Add to Home screen / Install app</strong> &rarr; saves as standalone <strong>SHPL</strong> app.
                </p>
              </div>
              <div className={`p-2.5 rounded-lg border ${isIOS ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-200'}`}>
                <div className="font-semibold text-slate-900 flex items-center gap-1.5 mb-1">
                  <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
                  iOS iPhone / iPad (Chrome or Safari)
                </div>
                <p>
                  1. Tap the <strong>Share</strong> icon (square with upward arrow) in Chrome/Safari.<br />
                  2. Choose <strong>Add to Home Screen</strong> &rarr; confirm name <strong>SHPL</strong>.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-lg">
      <WifiOff className="w-3.5 h-3.5" />
      Offline Mode — SHPL Cached Clinical Data Active
    </div>
  );
};
