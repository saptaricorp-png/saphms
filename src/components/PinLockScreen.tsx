import React, { useState } from 'react';
import {
  AlertTriangle,
  Delete,
  KeyRound,
  Lock,
  LogOut,
  PhoneCall,
  ShieldAlert,
} from 'lucide-react';
import type { LabSettings, RoleDefinition, StaffMember } from '../types/lims';
import { apiRequest } from '../api/client';

interface PinLockScreenProps {
  user: StaffMember;
  role: RoleDefinition | null;
  settings: LabSettings;
  onUnlocked: (updatedDb: any, updatedUser: StaffMember) => void;
  onLockedOut: (updatedDb: any) => void;
  onLogout: () => void;
}

export function PinLockScreen({
  user,
  role,
  settings,
  onUnlocked,
  onLockedOut,
  onLogout,
}: PinLockScreenProps) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resetRequestedMsg, setResetRequestedMsg] = useState<string | null>(null);
  const [lockedOut, setLockedOut] = useState(Boolean(user.isLocked));

  const appendDigit = (d: string) => {
    if (lockedOut || busy) return;
    setErrorMsg(null);
    setPin((prev) => (prev.length < 6 ? `${prev}${d}` : prev));
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pin.trim() || busy || lockedOut) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ ok: boolean; activeUser: StaffMember; db: any }>(
        '/api/auth/unlock-pin',
        user.id,
        {
          method: 'POST',
          body: JSON.stringify({ pin: pin.trim() }),
        }
      );
      setPin('');
      onUnlocked(resp.db, resp.activeUser);
    } catch (err: any) {
      setPin('');
      setErrorMsg(err.message || 'Invalid Admin PIN.');
      if (err.code === 'ACCOUNT_LOCKED' || err.status === 423) {
        setLockedOut(true);
        if (err.payload?.db) {
          onLockedOut(err.payload.db);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCallResetRequest = async () => {
    try {
      const resp = await apiRequest<{ ok: boolean; message: string }>(
        '/api/auth/request-reset',
        user.id,
        {
          method: 'POST',
          body: JSON.stringify({
            username: user.username,
            callerPhone: user.phone,
            note: 'Idle PIN lock reset requested by operator',
          }),
        }
      );
      setResetRequestedMsg(resp.message);
    } catch {
      setResetRequestedMsg(
        `Please call Admin / SaaS Support at ${settings.resetSupportPhone} for PIN/Password reset.`
      );
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return (
    <div className="no-print fixed inset-0 z-[100] bg-slate-950/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center shrink-0">
              <Lock className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">Session Auto-Locked (Inactivity)</div>
              <div className="text-xs text-slate-300 truncate">
                {user.fullName} · @{user.username} ({role?.name || user.roleId})
              </div>
            </div>
          </div>
          <span className="text-[10px] font-mono bg-slate-800 px-2 py-1 rounded text-slate-300 shrink-0">
            {Math.round((settings.idleLockSeconds || 150) / 60 * 10) / 10}m Idle
          </span>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="text-xs text-slate-600 text-center">
            Enter your <strong>Admin-assigned 4–6 digit PIN</strong> to resume this workstation, or log out to switch operator.
          </div>

          {errorMsg && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                {lockedOut ? (
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-rose-700 hover:text-rose-950 font-semibold text-[11px] px-1.5 py-0.5 rounded bg-white border border-rose-200 shrink-0"
                aria-label="Dismiss error"
              >
                Close
              </button>
            </div>
          )}

          {resetRequestedMsg && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-xs">
              {resetRequestedMsg}
            </div>
          )}

          <div>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              disabled={lockedOut || busy}
              autoFocus
              value={pin}
              onChange={(e) => {
                setErrorMsg(null);
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
              }}
              placeholder="••••"
              className="w-full text-center tracking-[0.5em] text-2xl font-mono font-bold py-3 border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600 disabled:bg-slate-100"
            />
          </div>

          {/* Touch-friendly Numeric PIN Pad */}
          <div className="grid grid-cols-3 gap-2">
            {digits.map((d) => (
              <button
                key={d}
                type="button"
                disabled={lockedOut || busy}
                onClick={() => appendDigit(d)}
                className="py-3 text-base font-mono font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl disabled:opacity-50"
              >
                {d}
              </button>
            ))}
            <button
              type="button"
              disabled={lockedOut || busy}
              onClick={() => setPin('')}
              className="py-3 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={lockedOut || busy}
              onClick={() => appendDigit('0')}
              className="py-3 text-base font-mono font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl disabled:opacity-50"
            >
              0
            </button>
            <button
              type="button"
              disabled={lockedOut || busy}
              onClick={() => setPin((p) => p.slice(0, -1))}
              className="py-3 flex items-center justify-center text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              aria-label="Backspace PIN"
            >
              <Delete className="w-4 h-4" />
            </button>
          </div>

          <button
            type="submit"
            disabled={lockedOut || busy || pin.length < 4}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50"
          >
            <KeyRound className="w-4 h-4" />
            {busy ? 'Verifying PIN...' : 'Unlock Workstation'}
          </button>

          <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <a
                href={`tel:${settings.resetSupportPhone}`}
                onClick={() => void handleCallResetRequest()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 font-medium"
              >
                <PhoneCall className="w-3.5 h-3.5" />
                Call Reset ({settings.resetSupportPhone})
              </a>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 font-medium"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout Session
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
