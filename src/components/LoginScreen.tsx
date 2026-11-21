import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  FlaskConical,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  ShieldAlert,
  ShieldCheck,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type { LimsDatabase, StaffMember } from '../types/lims';
import { apiRequest } from '../api/client';
import { PWAInstallButton } from './PWAInstallButton';

interface LoginScreenProps {
  db: LimsDatabase;
  onLogin: (staff: StaffMember, nextDb: LimsDatabase) => void;
  onDbSync?: (nextDb: LimsDatabase) => void;
}

interface DemoAccountEntry {
  username: string;
  password: string;
  pin: string;
  roleLabel: string;
  fullName?: string;
}

const FALLBACK_DEMO_ACCOUNTS: DemoAccountEntry[] = [
  { username: 'admin', password: 'Admin@2083', pin: '1122', roleLabel: 'Super Admin' },
  { username: 'director', password: 'Path@2083', pin: '2233', roleLabel: 'Pathologist' },
  { username: 'doctor1', password: 'Doc@2083', pin: '4141', roleLabel: 'Doctor' },
  { username: 'nurse1', password: 'Nurse@2083', pin: '4242', roleLabel: 'Nurse' },
  { username: 'radiologist', password: 'Radio@2083', pin: '3344', roleLabel: 'Radiologist' },
  { username: 'labtech', password: 'Tech@2083', pin: '4455', roleLabel: 'Lab Tech' },
  { username: 'pharma1', password: 'Pharma@2083', pin: '3131', roleLabel: 'Pharmacist' },
  { username: 'cashier_phm', password: 'Cash@2083', pin: '3232', roleLabel: 'Pharmacy POS' },
  { username: 'billing', password: 'Pos@2083', pin: '5566', roleLabel: 'Hospital POS' },
  { username: 'finance', password: 'Fin@2083', pin: '6677', roleLabel: 'Finance / HR' },
];

export function LoginScreen({ db, onLogin, onDbSync }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLockedMsg, setIsLockedMsg] = useState(false);
  const showDemoCreds = db.settings?.moduleSettings?.showDemoCredentialsOnLogin !== false;

  // Instant Password Reset via saptarihospital@gmail.com
  const [showInstantReset, setShowInstantReset] = useState(false);
  const [resetUser, setResetUser] = useState('');
  const [resetEmail, setResetEmail] = useState('saptarihospital@gmail.com');
  const [newPassword, setNewPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetErrorMsg, setResetErrorMsg] = useState<string | null>(null);

  // Live same-Wi-Fi IP URLs for 1-PC server + Windows/Android/iOS Chrome install
  const [lanUrls, setLanUrls] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/system/network-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info && Array.isArray(info.lanUrls)) {
          setLanUrls(info.lanUrls);
        }
      })
      .catch(() => {});
  }, []);

  const demoAccounts = useMemo<DemoAccountEntry[]>(() => {
    const staffList = db.staff || [];
    if (staffList.length === 0) return FALLBACK_DEMO_ACCOUNTS;
    const roleMap = new Map((db.roles || []).map((r) => [r.id, r.name]));
    return staffList
      .filter((s) => s.status !== 'Suspended')
      .map((s) => ({
        username: s.username,
        password: s.password,
        pin: s.pin,
        roleLabel: roleMap.get(s.roleId) || s.roleId,
        fullName: s.fullName,
      }));
  }, [db.staff, db.roles]);

  const executeLogin = async (loginUser: string, loginPass: string) => {
    setErrorMsg(null);
    setIsLockedMsg(false);
    const cleanUser = loginUser.trim();
    if (!cleanUser || !loginPass) {
      setErrorMsg('Please enter both username and password.');
      return;
    }
    if (cleanUser.includes('@') || /^\+?[\d\s\-()]{7,}$/.test(cleanUser)) {
      setErrorMsg(
        'Username & Password login only. Email address and phone number login are disabled.'
      );
      return;
    }

    setBusy(true);
    try {
      const resp = await apiRequest<{ activeUser: StaffMember; db: LimsDatabase }>(
        '/api/auth/login',
        cleanUser,
        {
          method: 'POST',
          body: JSON.stringify({ username: cleanUser, password: loginPass }),
        }
      );
      onLogin(resp.activeUser, resp.db);
    } catch (err: any) {
      setErrorMsg(err.message || 'Authentication failed.');
      if (err.code === 'ACCOUNT_LOCKED' || err.status === 423) {
        setIsLockedMsg(true);
        setShowInstantReset(true);
        setResetUser(cleanUser);
      }
      if (err.payload?.db && onDbSync) {
        onDbSync(err.payload.db);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeLogin(username, password);
  };

  const handleInstantReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetErrorMsg(null);
    setResetSuccessMsg(null);
    const targetUser = (resetUser || username).trim();
    if (!targetUser) {
      setResetErrorMsg('Enter the username or employee code to reset.');
      return;
    }
    setResetting(true);
    try {
      const resp = await apiRequest<{
        ok: boolean;
        message: string;
        username: string;
        db?: LimsDatabase;
      }>('/api/auth/instant-reset', 'anon', {
        method: 'POST',
        body: JSON.stringify({
          username: targetUser,
          resetEmail: resetEmail.trim(),
          newPassword: newPassword.trim(),
          newPin: newPin.trim() || undefined,
        }),
      });
      setResetSuccessMsg(resp.message);
      setUsername(resp.username);
      setPassword(newPassword.trim());
      setErrorMsg(null);
      setIsLockedMsg(false);
      if (resp.db && onDbSync) onDbSync(resp.db);
    } catch (err: any) {
      setResetErrorMsg(err.message || 'Instant reset failed.');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-lg">
        {/* Left Identity & Wi-Fi LAN Panel */}
        <div className="lg:col-span-4 bg-slate-900 text-white p-6 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
                <FlaskConical className="w-5 h-5" />
              </div>
              <div>
                <div className="font-bold text-base tracking-tight">Hospital Management System</div>
                <div className="text-[11px] text-slate-400">ER/MLC, OPD/IPD, OT, Lab, Rad &amp; Pharmacy ERP</div>
              </div>
            </div>

            <div className="pt-1 space-y-1.5 text-xs text-slate-300 leading-relaxed">
              <p>
                <strong>{db.settings.labName}</strong>
              </p>
              <p className="font-mono text-[11px] text-slate-400">
                PAN: {db.settings.panNumber} · {db.settings.activeFiscalYear}
              </p>
              <p className="text-[11px] text-slate-400">
                {db.settings.addressLine} · Hotline: 97-1515-6677 · saptarihospital@gmail.com
              </p>
            </div>

            <div className="pt-3 border-t border-slate-800 space-y-2 text-[11px] text-slate-300">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>Username + Password Strict Auth</span>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span>Auto Idle-Lock with Admin PIN</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Instant Reset via saptarihospital@gmail.com</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span>1-PC Windows Server &amp; Same-Wi-Fi IP</span>
              </div>
            </div>

            {lanUrls.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700 space-y-1.5 text-[11px]">
                <div className="flex items-center gap-1.5 font-semibold text-blue-300">
                  <Wifi className="w-3.5 h-3.5" />
                  Same-Wi-Fi Multi-Device Access
                </div>
                {lanUrls.map((u) => (
                  <div key={u} className="font-mono text-emerald-300 break-all">
                    {u}
                  </div>
                ))}
                <div className="text-[10px] text-slate-400">
                  Open in Chrome on Windows, Android, or iOS and install as <strong>SHPL</strong>.
                </div>
              </div>
            )}
          </div>

          <div className="pt-5 mt-5 border-t border-slate-800 text-xs">
            <div className="text-slate-400">Designed and developed by</div>
            <div className="font-semibold text-white text-sm mt-0.5">Dr. Santosh Majhi</div>
          </div>
        </div>

        {/* Right Sign-In + Instant Reset + Demo Accounts */}
        <div className="lg:col-span-8 p-6 sm:p-7 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Sign In to Hospital Management System</h1>
              <p className="text-xs text-slate-500 mt-0.5">
                {showDemoCreds ? (
                  <>Enter your assigned <strong>Username &amp; Password</strong> or pick a Demo Login Account below.</>
                ) : (
                  <>Enter your assigned hospital <strong>Username &amp; Password</strong> to sign in.</>
                )}
              </p>
            </div>
            <PWAInstallButton compact />
          </div>

          {errorMsg && (
            <div
              className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2.5 ${
                isLockedMsg
                  ? 'border-rose-300 bg-rose-50 text-rose-900'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <div className="flex items-start gap-2.5">
                {isLockedMsg ? (
                  <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                )}
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="p-0.5 rounded hover:bg-black/10 shrink-0"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
            <div className="sm:col-span-5">
              <label className="block text-xs font-medium text-slate-700 mb-1">Username *</label>
              <input
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin, doctor1, nurse1, pharma1..."
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-700 mb-1">Password *</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  data-enter-submit="true"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full pl-3 pr-9 py-2 text-sm font-mono border border-slate-300 rounded-xl focus:outline-none focus:border-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-0.5"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 px-4 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <LogIn className="w-4 h-4" />
                {busy ? 'Signing In...' : 'Sign In'}
              </button>
            </div>
          </form>

          {/* Instant Password Reset via saptarihospital@gmail.com */}
          <div className="border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <button
                type="button"
                onClick={() => {
                  setShowInstantReset((v) => !v);
                  if (!resetUser && username) setResetUser(username);
                }}
                className="inline-flex items-center gap-1.5 text-blue-700 font-semibold hover:underline"
              >
                <KeyRound className="w-3.5 h-3.5" />
                Forgot Password or Account Locked? Instant Reset via saptarihospital@gmail.com
              </button>
              <span className="font-mono text-[11px] text-slate-500">
                Hotline: {db.settings.resetSupportPhone}
              </span>
            </div>

            {showInstantReset && (
              <form
                onSubmit={handleInstantReset}
                className="mt-3 p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5 text-xs"
              >
                <div className="text-blue-950 font-medium flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Instant Password &amp; PIN Reset for ANY Account via{' '}
                    <strong className="font-mono">saptarihospital@gmail.com</strong>
                  </span>
                  <span className="text-[11px] text-blue-700">Unlocks &amp; activates immediately</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                      Target Username / Code *
                    </label>
                    <input
                      required
                      value={resetUser}
                      onChange={(e) => setResetUser(e.target.value)}
                      placeholder="e.g., admin or doctor1"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-blue-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                      Hospital Reset Email *
                    </label>
                    <input
                      required
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="saptarihospital@gmail.com"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-blue-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                      New Password *
                    </label>
                    <div className="relative">
                      <input
                        required
                        type={showNewPass ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Min 4 chars"
                        className="w-full pl-2.5 pr-8 py-1.5 font-mono bg-white border border-blue-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPass((v) => !v)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                        tabIndex={-1}
                        aria-label={showNewPass ? 'Hide password' : 'Show password'}
                      >
                        {showNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                      New 4-Digit PIN (Opt)
                    </label>
                    <input
                      type="text"
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value)}
                      placeholder="e.g., 1234"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-blue-300 rounded-lg"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <button
                    type="submit"
                    disabled={resetting}
                    className="px-3.5 py-1.5 bg-blue-700 text-white rounded-lg font-semibold hover:bg-blue-800 disabled:opacity-50"
                  >
                    {resetting ? 'Resetting Instantly...' : 'Reset Password Instantly'}
                  </button>
                  {resetSuccessMsg && (
                    <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {resetSuccessMsg}
                    </span>
                  )}
                  {resetErrorMsg && (
                    <span className="text-rose-700 font-semibold">{resetErrorMsg}</span>
                  )}
                </div>
              </form>
            )}
          </div>

          {/* Demo Login Credentials Directory (Controlled by Admin Setting: showDemoCredentialsOnLogin) */}
          {showDemoCreds && (
          <div className="border-t border-slate-200 pt-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                <Users className="w-3.5 h-3.5 text-blue-600" />
                Demo Login Details (Click to Fill or Instant Sign-In)
              </div>
              <span className="text-[11px] text-slate-500">
                PIN is used only for Auto Idle-Lock screen
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
              {demoAccounts.map((acc) => (
                <div
                  key={acc.username}
                  className="p-2.5 rounded-xl border border-slate-200 bg-slate-50/70 hover:bg-blue-50/50 hover:border-blue-300 flex items-center justify-between gap-2 text-[11px] transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">
                      {acc.roleLabel}
                      {'fullName' in acc && acc.fullName ? (
                        <span className="text-slate-500 font-normal"> · {acc.fullName}</span>
                      ) : null}
                    </div>
                    <div className="font-mono text-slate-700 truncate">
                      User: <strong className="text-blue-700">{acc.username}</strong> · Pass:{' '}
                      <strong>{acc.password}</strong> · PIN: <strong>{acc.pin}</strong>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setUsername(acc.username);
                        setPassword(acc.password);
                        setResetUser(acc.username);
                      }}
                      className="px-2 py-1 text-[10px] font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                    >
                      Fill
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setUsername(acc.username);
                        setPassword(acc.password);
                        void executeLogin(acc.username, acc.password);
                      }}
                      className="px-2 py-1 text-[10px] font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                    >
                      Login
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}
