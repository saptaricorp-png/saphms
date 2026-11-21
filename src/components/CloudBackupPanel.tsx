import React, { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  CheckCircle2,
  Clock,
  Cloud,
  CloudOff,
  Download,
  HardDrive,
  LogIn,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { firebaseAuth } from '../lib/firebase';
import {
  createCloudBackupSnapshot,
  deleteCloudBackupSnapshot,
  loadCloudSyncConfig,
  restoreCloudBackupSnapshot,
  saveCloudSyncConfig,
  signInWithGoogleForBackup,
  signOutGoogleBackup,
  subscribeCloudBackups,
  type CloudBackupSummary,
  type CloudSyncConfig,
} from '../services/cloudBackupService';
import { apiRequest } from '../api/client';
import type { LimsDatabase, StaffMember } from '../types/lims';

export interface LocalBackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

interface CloudBackupPanelProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  canManage: boolean;
  onDbRestored: (nextDb: LimsDatabase, toastMsg: string) => void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatCloudDate(item: CloudBackupSummary): string {
  const ts = item.createdAt as any;
  if (ts && typeof ts.toDate === 'function') {
    return ts.toDate().toLocaleString([], {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return 'Just now';
}

export function CloudBackupPanel({
  db,
  activeUser,
  canManage,
  onDbRestored,
}: CloudBackupPanelProps) {
  const isSuperAdmin = activeUser.roleId === 'SUPER_ADMIN';

  // Google Cloud Vault state
  const [cloudUser, setCloudUser] = useState<User | null>(() => firebaseAuth.currentUser);
  const [authBusy, setAuthBusy] = useState(false);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupSummary[]>([]);
  const [syncConfig, setSyncConfig] = useState<CloudSyncConfig | null>(null);
  const [cloudLabel, setCloudLabel] = useState('');
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoIntervalMin, setAutoIntervalMin] = useState(15);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [restoringCloudId, setRestoringCloudId] = useState<string | null>(null);
  const [confirmCloudRestoreId, setConfirmCloudRestoreId] = useState<string | null>(null);
  const [confirmCloudDeleteId, setConfirmCloudDeleteId] = useState<string | null>(null);

  // Local server disk backups state
  const [localBackups, setLocalBackups] = useState<LocalBackupFileInfo[]>([]);
  const [localLoading, setLocalLoading] = useState(false);
  const [creatingLocal, setCreatingLocal] = useState(false);
  const [restoringLocalFile, setRestoringLocalFile] = useState<string | null>(null);
  const [confirmLocalRestoreFile, setConfirmLocalRestoreFile] = useState<string | null>(null);
  const [confirmLocalDeleteFile, setConfirmLocalDeleteFile] = useState<string | null>(null);

  // Uploaded JSON restore state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingUploadSnapshot, setPendingUploadSnapshot] = useState<{
    filename: string;
    database: LimsDatabase;
    summaryText: string;
  } | null>(null);
  const [restoringUpload, setRestoringUpload] = useState(false);

  // Banner feedback
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadLocalBackups = useCallback(async () => {
    setLocalLoading(true);
    try {
      const resp = await apiRequest<{ backups: LocalBackupFileInfo[] }>(
        '/api/system/local-backups',
        activeUser.id
      );
      setLocalBackups(resp.backups || []);
    } catch {
      // keep existing list if temporarily unreachable
    } finally {
      setLocalLoading(false);
    }
  }, [activeUser.id]);

  useEffect(() => {
    void loadLocalBackups();
  }, [loadLocalBackups]);

  useEffect(() => {
    const unsub = onAuthStateChanged(firebaseAuth, (user) => {
      setCloudUser(user);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!cloudUser) {
      setCloudBackups([]);
      setSyncConfig(null);
      return;
    }

    let cancelled = false;
    void loadCloudSyncConfig(cloudUser)
      .then((cfg) => {
        if (!cancelled && cfg) {
          setSyncConfig(cfg);
          setAutoEnabled(cfg.autoCloudBackupEnabled);
          setAutoIntervalMin(cfg.backupIntervalMinutes || 15);
        }
      })
      .catch(() => {
        // Ignore initial load error if user profile is being created
      });

    const unsub = subscribeCloudBackups(
      cloudUser,
      (items) => {
        if (!cancelled) setCloudBackups(items);
      },
      (err) => {
        if (!cancelled) {
          setFeedback({
            type: 'err',
            text: err.message || 'Unable to load Cloud Backup Vault list.',
          });
        }
      }
    );

    return () => {
      cancelled = true;
      unsub();
    };
  }, [cloudUser]);

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setFeedback(null);
    try {
      const user = await signInWithGoogleForBackup();
      setFeedback({
        type: 'ok',
        text: `Connected Google Backup Account (${user.email || user.displayName || 'Verified'}).`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Google sign-in was cancelled or blocked by popup settings.',
      });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleGoogleSignOut = async () => {
    setAuthBusy(true);
    setFeedback(null);
    try {
      await signOutGoogleBackup();
      setFeedback({ type: 'ok', text: 'Disconnected Google Cloud Backup account.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to sign out.' });
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSaveCloudBackupNow = async () => {
    if (!cloudUser) return;
    setCloudBusy(true);
    setFeedback(null);
    try {
      const label =
        cloudLabel.trim() ||
        `${db.settings.labName || 'Hospital'} Backup (${new Date().toLocaleDateString()})`;
      const summary = await createCloudBackupSnapshot(db, label, 'MANUAL');
      setCloudLabel('');
      setFeedback({
        type: 'ok',
        text: `Cloud backup "${summary.label}" saved (${summary.counts.patients} patients, ${summary.counts.pharmacyInvoices} Rx bills).`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Cloud backup failed.',
      });
    } finally {
      setCloudBusy(false);
    }
  };

  const handleToggleAutoCloud = async (nextEnabled: boolean, nextMinutes: number) => {
    if (!cloudUser) return;
    setAutoEnabled(nextEnabled);
    setAutoIntervalMin(nextMinutes);
    try {
      const saved = await saveCloudSyncConfig(cloudUser, {
        hospitalName: db.settings.labName || 'Saptari Hospital Pvt Ltd',
        autoCloudBackupEnabled: nextEnabled,
        backupIntervalMinutes: nextMinutes,
      });
      setSyncConfig(saved);
      setFeedback({
        type: 'ok',
        text: nextEnabled
          ? `Automated Cloud Backup enabled (every ${saved.backupIntervalMinutes} min while signed in).`
          : 'Automated Cloud Backup paused.',
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Failed to update auto-backup preference.',
      });
    }
  };

  const handleRestoreCloudBackup = async (item: CloudBackupSummary) => {
    if (!isSuperAdmin) return;
    setRestoringCloudId(item.id);
    setFeedback(null);
    try {
      const snapshotDb = await restoreCloudBackupSnapshot(item.id);
      const resp = await apiRequest<{
        ok: boolean;
        safetyBackup: LocalBackupFileInfo;
        backups: LocalBackupFileInfo[];
        db: LimsDatabase;
      }>('/api/system/restore-snapshot', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          database: snapshotDb,
          sourceLabel: `Cloud Vault (${item.label})`,
        }),
      });
      setConfirmCloudRestoreId(null);
      setLocalBackups(resp.backups || []);
      onDbRestored(
        resp.db,
        `Restored from Cloud Backup "${item.label}". Safety snapshot saved as ${resp.safetyBackup.filename}.`
      );
      setFeedback({
        type: 'ok',
        text: `Server database restored from Cloud Backup "${item.label}". Pre-restore safety backup saved to disk.`,
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Failed to restore cloud backup.',
      });
    } finally {
      setRestoringCloudId(null);
    }
  };

  const handleDeleteCloudBackup = async (backupId: string) => {
    setCloudBusy(true);
    setFeedback(null);
    try {
      await deleteCloudBackupSnapshot(backupId);
      setConfirmCloudDeleteId(null);
      setFeedback({ type: 'ok', text: 'Cloud backup snapshot removed.' });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Unable to delete cloud backup.' });
    } finally {
      setCloudBusy(false);
    }
  };

  const handleCreateLocalBackup = async () => {
    setCreatingLocal(true);
    setFeedback(null);
    try {
      const resp = await apiRequest<{
        backup: LocalBackupFileInfo;
        backups: LocalBackupFileInfo[];
      }>('/api/system/local-backups', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ label: 'manual' }),
      });
      setLocalBackups(resp.backups || []);
      setFeedback({
        type: 'ok',
        text: `Server disk backup created: ${resp.backup.filename} (${formatBytes(resp.backup.sizeBytes)}).`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to create server disk backup.' });
    } finally {
      setCreatingLocal(false);
    }
  };

  const handleRestoreLocalBackup = async (filename: string) => {
    if (!isSuperAdmin) return;
    setRestoringLocalFile(filename);
    setFeedback(null);
    try {
      const resp = await apiRequest<{
        ok: boolean;
        safetyBackup: LocalBackupFileInfo;
        backups: LocalBackupFileInfo[];
        db: LimsDatabase;
      }>('/api/system/restore-snapshot', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ backupFilename: filename }),
      });
      setConfirmLocalRestoreFile(null);
      setLocalBackups(resp.backups || []);
      onDbRestored(
        resp.db,
        `Database restored from ${filename}. Pre-restore safety snapshot saved.`
      );
      setFeedback({
        type: 'ok',
        text: `Restored server database from ${filename} (pre-restore safety copy: ${resp.safetyBackup.filename}).`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to restore local backup.' });
    } finally {
      setRestoringLocalFile(null);
    }
  };

  const handleDeleteLocalBackup = async (filename: string) => {
    if (!isSuperAdmin) return;
    setFeedback(null);
    try {
      const resp = await apiRequest<{ backups: LocalBackupFileInfo[] }>(
        `/api/system/local-backups/${encodeURIComponent(filename)}`,
        activeUser.id,
        { method: 'DELETE' }
      );
      setConfirmLocalDeleteFile(null);
      setLocalBackups(resp.backups || []);
      setFeedback({ type: 'ok', text: `Deleted server backup ${filename}.` });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Failed to delete local backup.' });
    }
  };

  const handleUploadFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || '{}'));
        const candidate: LimsDatabase = parsed?.database?.settings ? parsed.database : parsed;
        if (
          !candidate ||
          !Array.isArray(candidate.staff) ||
          !Array.isArray(candidate.services) ||
          !candidate.settings
        ) {
          setFeedback({
            type: 'err',
            text: 'Selected file is not a valid Saptari Hospital ERP JSON backup.',
          });
          return;
        }
        setPendingUploadSnapshot({
          filename: file.name,
          database: candidate,
          summaryText: `${candidate.patients?.length || 0} patients · ${candidate.orders?.length || 0} lab orders · ${candidate.pharmacyInvoices?.length || 0} Rx invoices · FY ${candidate.settings.activeFiscalYear || 'N/A'}`,
        });
        setFeedback(null);
      } catch {
        setFeedback({ type: 'err', text: 'Could not read JSON backup file.' });
      }
    };
    reader.readAsText(file);
  };

  const handleConfirmUploadRestore = async () => {
    if (!pendingUploadSnapshot || !isSuperAdmin) return;
    setRestoringUpload(true);
    setFeedback(null);
    try {
      const resp = await apiRequest<{
        ok: boolean;
        safetyBackup: LocalBackupFileInfo;
        backups: LocalBackupFileInfo[];
        db: LimsDatabase;
      }>('/api/system/restore-snapshot', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          database: pendingUploadSnapshot.database,
          sourceLabel: `Uploaded File (${pendingUploadSnapshot.filename})`,
        }),
      });
      setPendingUploadSnapshot(null);
      setLocalBackups(resp.backups || []);
      onDbRestored(
        resp.db,
        `Restored database from uploaded file. Pre-restore safety backup saved as ${resp.safetyBackup.filename}.`
      );
      setFeedback({
        type: 'ok',
        text: `Successfully restored uploaded backup. Safety copy saved on server disk (${resp.safetyBackup.filename}).`,
      });
    } catch (err: any) {
      setFeedback({ type: 'err', text: err?.message || 'Upload restore failed.' });
    } finally {
      setRestoringUpload(false);
    }
  };

  return (
    <div className="space-y-5">
      {feedback && (
        <div
          className={`flex items-start justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {feedback.type === 'ok' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <CloudOff className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-[11px] font-semibold underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 1. Encrypted Cloud Backup Vault */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center">
              <Cloud className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Cloud Backup Vault &amp; Cross-Device Sync
              </h3>
              <p className="text-[11px] text-slate-500">
                Save complete encrypted hospital snapshots to your Google cloud vault and restore onto any Linux, Windows, or cloud server.
              </p>
            </div>
          </div>

          {cloudUser ? (
            <div className="flex items-center gap-2.5">
              <div className="text-right">
                <div className="text-xs font-semibold text-slate-900">
                  {cloudUser.displayName || 'Google Account'}
                </div>
                <div className="text-[11px] font-mono text-emerald-700">{cloudUser.email}</div>
              </div>
              <button
                type="button"
                disabled={authBusy}
                onClick={handleGoogleSignOut}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 whitespace-nowrap"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={authBusy || !canManage}
              onClick={handleGoogleSignIn}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <LogIn className="w-3.5 h-3.5" />
              {authBusy ? 'Connecting...' : 'Sign In with Google for Cloud Backup'}
            </button>
          )}
        </div>

        {cloudUser ? (
          <div className="space-y-4">
            {/* Manual Cloud Snapshot + Auto-Cloud Sync Controls */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5">
              <div className="lg:col-span-6 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={cloudLabel}
                  onChange={(e) => setCloudLabel(e.target.value)}
                  placeholder="Optional backup label (e.g. Evening Close FY 2083/84)"
                  className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                />
                <button
                  type="button"
                  disabled={cloudBusy || !canManage}
                  onClick={handleSaveCloudBackupNow}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  {cloudBusy ? 'Uploading...' : 'Save Cloud Backup Now'}
                </button>
              </div>

              <div className="lg:col-span-6 flex flex-wrap items-center justify-between gap-2 sm:px-2">
                <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoEnabled}
                    onChange={(e) => void handleToggleAutoCloud(e.target.checked, autoIntervalMin)}
                  />
                  <span>Auto Cloud Sync</span>
                </label>
                <div className="flex items-center gap-1.5 text-xs">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <select
                    value={autoIntervalMin}
                    onChange={(e) => void handleToggleAutoCloud(autoEnabled, Number(e.target.value))}
                    className="px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value={5}>Every 5 min</option>
                    <option value={15}>Every 15 min</option>
                    <option value={30}>Every 30 min</option>
                    <option value={60}>Every 60 min</option>
                  </select>
                </div>
                {syncConfig?.lastSyncedAt && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Last: {new Date(syncConfig.lastSyncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>

            {/* Cloud Snapshot List */}
            {cloudBackups.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500">
                No cloud backups stored yet. Click <strong>Save Cloud Backup Now</strong> to store your first hospital snapshot.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                {cloudBackups.map((item) => {
                  const isConfirmRestore = confirmCloudRestoreId === item.id;
                  const isConfirmDelete = confirmCloudDeleteId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-slate-900 truncate">{item.label}</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-blue-50 text-blue-700 border border-blue-200 rounded">
                            {item.backupType}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {item.fiscalYear}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-3 gap-y-0.5">
                          <span>Saved: {formatCloudDate(item)}</span>
                          <span>Patients: {item.counts?.patients ?? 0}</span>
                          <span>Orders: {item.counts?.orders ?? 0}</span>
                          <span>Rx Bills: {item.counts?.pharmacyInvoices ?? 0}</span>
                          <span>OPD/IPD/ER: {(item.counts?.opdVisits ?? 0) + (item.counts?.ipdAdmissions ?? 0) + (item.counts?.emergencyCases ?? 0)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {isConfirmRestore ? (
                          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1.5 rounded-lg">
                            <span className="text-[11px] font-medium text-amber-900">
                              Replace current DB?
                            </span>
                            <button
                              type="button"
                              disabled={restoringCloudId === item.id}
                              onClick={() => void handleRestoreCloudBackup(item)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 rounded hover:bg-amber-700"
                            >
                              {restoringCloudId === item.id ? 'Restoring...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmCloudRestoreId(null)}
                              className="px-2 py-1 text-[11px] text-slate-600 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : isConfirmDelete ? (
                          <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1.5 rounded-lg">
                            <span className="text-[11px] font-medium text-rose-900">Delete?</span>
                            <button
                              type="button"
                              disabled={cloudBusy}
                              onClick={() => void handleDeleteCloudBackup(item.id)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-600 rounded hover:bg-rose-700"
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmCloudDeleteId(null)}
                              className="px-2 py-1 text-[11px] text-slate-600 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmCloudDeleteId(null);
                                  setConfirmCloudRestoreId(item.id);
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Restore
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmCloudRestoreId(null);
                                setConfirmCloudDeleteId(item.id);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
                              title="Delete cloud snapshot"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
            <span>
              Connect a Google account above to store automatic off-site backups safely across server migrations or hardware replacement.
            </span>
          </div>
        )}
      </div>

      {/* 2. Local Server Disk Backups & File Restore (Always Available Offline) */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Server Disk Backups (<code className="font-mono text-xs">./data/backups/</code>) &amp; File Restore
              </h3>
              <p className="text-[11px] text-slate-500">
                Rotating offline backups stored directly on your Linux/Windows Node.js host (keeps newest 35 snapshots automatically).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadLocalBackups()}
              disabled={localLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${localLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            {canManage && (
              <button
                type="button"
                disabled={creatingLocal}
                onClick={() => void handleCreateLocalBackup()}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
              >
                <HardDrive className="w-3.5 h-3.5" />
                {creatingLocal ? 'Saving...' : 'Create Server Backup Now'}
              </button>
            )}
            {isSuperAdmin && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleUploadFileSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Upload &amp; Restore .JSON
                </button>
              </>
            )}
          </div>
        </div>

        {/* Pending File Upload Confirmation Banner */}
        {pendingUploadSnapshot && (
          <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-semibold text-amber-950">
                Ready to restore from uploaded file: <span className="font-mono">{pendingUploadSnapshot.filename}</span>
              </div>
              <div className="text-amber-800">{pendingUploadSnapshot.summaryText}</div>
              <div className="text-[11px] text-amber-700">
                A pre-restore safety backup of the current live database will be written to disk first.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={restoringUpload}
                onClick={() => void handleConfirmUploadRestore()}
                className="px-3.5 py-2 font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {restoringUpload ? 'Restoring...' : 'Confirm & Restore Server DB'}
              </button>
              <button
                type="button"
                onClick={() => setPendingUploadSnapshot(null)}
                className="px-3 py-2 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {localBackups.length === 0 ? (
          <div className="text-center py-5 border border-dashed border-slate-300 rounded-xl text-xs text-slate-500">
            No disk snapshots in <code className="font-mono">./data/backups/</code> yet. Click <strong>Create Server Backup Now</strong> to save one.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden max-h-72 overflow-y-auto">
            {localBackups.map((f) => {
              const isConfirmRestore = confirmLocalRestoreFile === f.filename;
              const isConfirmDelete = confirmLocalDeleteFile === f.filename;
              return (
                <div
                  key={f.filename}
                  className="px-4 py-2.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-slate-900 truncate">{f.filename}</div>
                    <div className="text-[11px] text-slate-500">
                      {new Date(f.createdAt).toLocaleString()} · {formatBytes(f.sizeBytes)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isConfirmRestore ? (
                      <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                        <span className="text-[11px] font-medium text-amber-900">Restore?</span>
                        <button
                          type="button"
                          disabled={restoringLocalFile === f.filename}
                          onClick={() => void handleRestoreLocalBackup(f.filename)}
                          className="px-2 py-0.5 text-[11px] font-semibold text-white bg-amber-600 rounded hover:bg-amber-700"
                        >
                          {restoringLocalFile === f.filename ? 'Working...' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmLocalRestoreFile(null)}
                          className="px-1.5 py-0.5 text-[11px] text-slate-600 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : isConfirmDelete ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
                        <span className="text-[11px] font-medium text-rose-900">Delete?</span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteLocalBackup(f.filename)}
                          className="px-2 py-0.5 text-[11px] font-semibold text-white bg-rose-600 rounded hover:bg-rose-700"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmLocalDeleteFile(null)}
                          className="px-1.5 py-0.5 text-[11px] text-slate-600 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <a
                          href={`/api/system/local-backups/${encodeURIComponent(f.filename)}?uid=${encodeURIComponent(activeUser.id)}`}
                          download={f.filename}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200"
                        >
                          <Download className="w-3 h-3" />
                          Download
                        </a>
                        {isSuperAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmLocalDeleteFile(null);
                                setConfirmLocalRestoreFile(f.filename);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Restore
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmLocalRestoreFile(null);
                                setConfirmLocalDeleteFile(f.filename);
                              }}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
                              title="Delete disk backup"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
