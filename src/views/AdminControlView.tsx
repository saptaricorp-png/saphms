import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Database,
  DollarSign,
  Download,
  HardDrive,
  History,
  Layers,
  Lock,
  LogIn,
  Palette,
  Percent,
  RefreshCw,
  Search,
  Server,
  Sparkles,
  Trash2,
  UserCheck,
  XCircle,
} from 'lucide-react';
import type {
  DiscountCreditApprovalRequest,
  LimsDatabase,
  PermissionKey,
  RoleId,
  SaasModuleConfig,
  SaasStorageTelemetry,
  StaffMember,
} from '../types/lims';
import { formatNpr, adToBs } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { DocumentDesignsView } from './DocumentDesignsView';
import { CloudBackupPanel } from '../components/CloudBackupPanel';

interface AdminControlViewProps {
  db: LimsDatabase;
  telemetry: SaasStorageTelemetry | null;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string, telemetry?: SaasStorageTelemetry) => void;
  onImpersonateSuccess?: (resp: {
    activeUser: StaffMember;
    impersonationToken: string;
    db: LimsDatabase;
    telemetry?: SaasStorageTelemetry;
  }) => void;
  initialSearchQuery?: string;
}

function formatStorage(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function AdminControlView({
  db,
  telemetry: initialTelemetry,
  activeUser,
  hasPerm,
  onUpdated,
  onImpersonateSuccess,
  initialSearchQuery,
}: AdminControlViewProps) {
  const canAdmin = hasPerm('admin.control');
  const canDesigns = hasPerm('designs.manage');
  const canApproveReferrals = hasPerm('referrals.approve_payout');

  const [tab, setTab] = useState<'modules' | 'designs' | 'approvals' | 'data'>('modules');
  const [telemetry, setTelemetry] = useState<SaasStorageTelemetry | null>(initialTelemetry);
  const [loadingTelemetry, setLoadingTelemetry] = useState(false);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [controlReason, setControlReason] = useState(
    'Authorized Saptari Hospital Admin governance update'
  );

  // Role Capacity
  const [maxRolesCap, setMaxRolesCap] = useState(String(db.saas.maxRolesCapacity || 9));
  const [allowedRoles, setAllowedRoles] = useState<RoleId[]>(db.saas.allowedRoleIds || []);
  const [savingRolesCap, setSavingRolesCap] = useState(false);

  // Referral Payout Approvals
  const [reviewNote, setReviewNote] = useState('Verified account details & approved by Hospital Admin');
  const [approvalAccId, setApprovalAccId] = useState(db.accounts[0]?.id || 'acc-cash-1');
  const [processingReqId, setProcessingReqId] = useState<string | null>(null);

  // Discount & Credit Limit Approvals
  const [dcRemarks, setDcRemarks] = useState<Record<string, string>>({});
  const [dcBusyId, setDcBusyId] = useState<string | null>(null);
  const [dcHistoryId, setDcHistoryId] = useState<string | null>(null);
  const [dcFilterTab, setDcFilterTab] = useState<'PENDING' | 'HISTORY'>('PENDING');

  // Data Lifecycle & Direct Staff Login
  const [clearInventoryBatches, setClearInventoryBatches] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [erasePin, setErasePin] = useState('');
  const [eraseEmail, setEraseEmail] = useState('');
  const [eraseError, setEraseError] = useState('');
  const [clearingData, setClearingData] = useState(false);
  const [seedTests, setSeedTests] = useState(true);
  const [seedReports, setSeedReports] = useState(true);
  const [seedRadiology, setSeedRadiology] = useState(true);
  const [seedPharmacy, setSeedPharmacy] = useState(true);
  const [seedReagents, setSeedReagents] = useState(true);
  const [seedHospital, setSeedHospital] = useState(true);
  const [seedingData, setSeedingData] = useState(false);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);

  useEffect(() => {
    if (initialSearchQuery !== undefined && initialSearchQuery !== '') {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const refreshTelemetry = async () => {
    if (!canAdmin) return;
    setLoadingTelemetry(true);
    try {
      const resp = await apiRequest<{ telemetry: SaasStorageTelemetry }>(
        '/api/saas/telemetry',
        activeUser.id
      );
      setTelemetry(resp.telemetry);
    } catch {
      // silent
    } finally {
      setLoadingTelemetry(false);
    }
  };

  useEffect(() => {
    if (initialTelemetry) setTelemetry(initialTelemetry);
    setMaxRolesCap(String(db.saas.maxRolesCapacity || 9));
    setAllowedRoles(db.saas.allowedRoleIds || []);
    refreshTelemetry();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.orders.length, db.auditLogs.length, db.saas.modules, db.saas.maxRolesCapacity]);

  const handleToggleModule = async (mod: SaasModuleConfig) => {
    if (!canAdmin || mod.lockedCore) return;
    setTogglingKey(mod.key);
    try {
      const resp = await apiRequest<{ db: LimsDatabase; telemetry: SaasStorageTelemetry }>(
        `/api/saas/modules/${mod.key}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify({ enabled: !mod.enabled, reason: controlReason.trim() }),
        }
      );
      setTelemetry(resp.telemetry);
      onUpdated(
        resp.db,
        `${!mod.enabled ? 'Enabled' : 'Disabled'} hospital module: ${mod.name}.`,
        resp.telemetry
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update module.');
    } finally {
      setTogglingKey(null);
    }
  };

  const handleCompactStorage = async () => {
    if (!canAdmin) return;
    setCompacting(true);
    try {
      const resp = await apiRequest<{
        db: LimsDatabase;
        telemetry: SaasStorageTelemetry;
        reclaimedMb: number;
      }>('/api/saas/compact-storage', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ reason: controlReason.trim() || 'Routine storage optimization' }),
      });
      setTelemetry(resp.telemetry);
      onUpdated(
        resp.db,
        `Compacted PDF archive & dispatch buffers — reclaimed ${resp.reclaimedMb} MB.`,
        resp.telemetry
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Storage compaction failed.');
    } finally {
      setCompacting(false);
    }
  };

  const handleToggleAllowedRole = (rid: RoleId) => {
    if (rid === 'SUPER_ADMIN') return;
    setAllowedRoles((prev) =>
      prev.includes(rid) ? prev.filter((r) => r !== rid) : [...prev, rid]
    );
  };

  const handleSaveRoleCapacity = async () => {
    if (!canAdmin) return;
    setSavingRolesCap(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase; telemetry: SaasStorageTelemetry }>(
        '/api/saas/roles-capacity',
        activeUser.id,
        {
          method: 'PUT',
          body: JSON.stringify({
            maxRolesCapacity: Number(maxRolesCap),
            allowedRoleIds: allowedRoles,
            reason: controlReason.trim(),
          }),
        }
      );
      setTelemetry(resp.telemetry);
      onUpdated(
        resp.db,
        `Updated role capacity to ${Number(maxRolesCap)} roles (${allowedRoles.length} active).`,
        resp.telemetry
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update role capacity.');
    } finally {
      setSavingRolesCap(false);
    }
  };

  const handleApprovePayout = async (reqId: string) => {
    setProcessingReqId(reqId);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/referrals/payout-requests/${reqId}/approve`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            accountId: approvalAccId,
            approvalRemarks: reviewNote.trim(),
          }),
        }
      );
      onUpdated(resp.db, 'Approved & settled referral payout request.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Approval failed.');
    } finally {
      setProcessingReqId(null);
    }
  };

  const handleRejectPayout = async (reqId: string) => {
    setProcessingReqId(reqId);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/referrals/payout-requests/${reqId}/reject`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ approvalRemarks: reviewNote.trim() || 'Rejected by Admin' }),
        }
      );
      onUpdated(resp.db, 'Rejected referral payout request.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Rejection failed.');
    } finally {
      setProcessingReqId(null);
    }
  };

  const handleDcDecision = async (
    item: DiscountCreditApprovalRequest,
    decision: 'APPROVE' | 'DECLINE'
  ) => {
    setDcBusyId(item.id);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/approvals/discount-credit/${item.id}/decision`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            remarks: dcRemarks[item.id]?.trim() || undefined,
          }),
        }
      );
      setDcRemarks((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      onUpdated(
        resp.db,
        decision === 'DECLINE'
          ? `Declined ${item.requestNumber} (${item.patientName}).`
          : `Updated approval ${item.requestNumber} (${item.patientName}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to record approval decision.');
    } finally {
      setDcBusyId(null);
    }
  };

  const handleClearDummyData = async () => {
    if (!canAdmin) return;
    setEraseError('');
    if (!erasePin.trim() && !eraseEmail.trim()) {
      setEraseError('Enter Admin Secret PIN or confirmed Admin Email (epusaan@gmail.com) to authorize data erase.');
      return;
    }
    setClearingData(true);
    try {
      const resp = await apiRequest<{
        db: LimsDatabase;
        telemetry: SaasStorageTelemetry;
        clearedSummary: { scope: string; clearedOrders: number; clearedPharmacyInvoices: number };
      }>('/api/saas/clear-dummy-data', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          centerId: 'ALL',
          clearInventoryBatches,
          reason: controlReason.trim(),
          confirmPin: erasePin.trim() || undefined,
          confirmEmail: eraseEmail.trim() || undefined,
        }),
      });
      setConfirmClear(false);
      setErasePin('');
      setEraseEmail('');
      setTelemetry(resp.telemetry);
      onUpdated(
        resp.db,
        `Cleared dummy data for ${resp.clearedSummary.scope} (${resp.clearedSummary.clearedOrders} orders, ${resp.clearedSummary.clearedPharmacyInvoices} pharmacy bills).`,
        resp.telemetry
      );
    } catch (err: any) {
      setEraseError(err.message || 'Erase confirmation failed.');
      onUpdated(db, err.message || 'Failed to clear dummy data.');
    } finally {
      setClearingData(false);
    }
  };

  const handleSeedCenterData = async () => {
    if (!canAdmin) return;
    setSeedingData(true);
    try {
      const resp = await apiRequest<{
        db: LimsDatabase;
        telemetry: SaasStorageTelemetry;
        seededSummary: {
          scope: string;
          addedTests: number;
          addedReports: number;
          addedRadiology: number;
          addedPharmacyBatches: number;
        };
      }>('/api/saas/seed-center-data', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          centerId: 'ALL',
          includeTests: seedTests,
          includeReports: seedReports,
          includeRadiology: seedRadiology,
          includePharmacy: seedPharmacy,
          includeReagents: seedReagents,
          includeHospital: seedHospital,
          reason: controlReason.trim(),
        }),
      });
      setTelemetry(resp.telemetry);
      onUpdated(
        resp.db,
        `Seeded hospital data for ${resp.seededSummary.scope}: +${resp.seededSummary.addedTests} tests, +${resp.seededSummary.addedReports} reports, +${resp.seededSummary.addedRadiology} radiology.`,
        resp.telemetry
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to seed data.');
    } finally {
      setSeedingData(false);
    }
  };

  const handleDirectImpersonate = async (targetUser: StaffMember) => {
    if (!onImpersonateSuccess) return;
    setImpersonatingId(targetUser.id);
    try {
      const resp = await apiRequest<{
        activeUser: StaffMember;
        impersonationToken: string;
        db: LimsDatabase;
        telemetry?: SaasStorageTelemetry;
      }>('/api/saas/impersonate', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ targetUserId: targetUser.id }),
      });
      onImpersonateSuccess(resp);
    } catch (err: any) {
      onUpdated(db, err.message || 'Direct login failed.');
    } finally {
      setImpersonatingId(null);
    }
  };

  const payoutReqs = db.referralPayoutRequests || [];
  const pendingPayoutCount = payoutReqs.filter((r) => r.status === 'Pending Admin Approval').length;
  const dcApprovals = db.discountCreditApprovals || [];
  const pendingDcApprovals = dcApprovals.filter(
    (r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN'
  );
  const historyDcApprovals = dcApprovals.filter(
    (r) => r.status === 'APPROVED' || r.status === 'DECLINED'
  );
  const pendingDcCount = pendingDcApprovals.length;
  const sq = searchTerm.trim().toLowerCase();
  const filteredModules = db.saas.modules.filter(
    (m) => !sq || `${m.name} ${m.key} ${m.category} ${m.description}`.toLowerCase().includes(sq)
  );
  const filteredStaff = db.staff.filter(
    (s) =>
      s.id !== activeUser.id &&
      (!sq ||
        `${s.fullName} ${s.username} ${s.roleId} ${s.assignedCenterName || 'Saptari Hospital Main'}`
          .toLowerCase()
          .includes(sq))
  );

  const enabledCount = db.saas.modules.filter((m) => m.enabled).length;
  const totalModules = db.saas.modules.length;
  const pct = telemetry?.percentUsed ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Hospital Admin Control Center, Print Designer &amp; Payout Approvals
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {db.settings.labName} · Consolidated Module Governance, Dynamic Bill &amp; Report Print Studio, Storage Telemetry, Referral Approvals &amp; Data Reset
          </p>
        </div>

        <button
          type="button"
          onClick={refreshTelemetry}
          disabled={loadingTelemetry}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingTelemetry ? 'animate-spin' : ''}`} />
          Refresh System Metrics
        </button>
      </div>

      {/* Sub-Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'modules' as const, label: `Modules, Storage & Roles (${enabledCount}/${totalModules})`, icon: Layers },
            ...(canDesigns
              ? [{ id: 'designs' as const, label: 'Bill & Report Print Designer', icon: Palette }]
              : []),
            {
              id: 'approvals' as const,
              label: `Approvals: Discount, Credit & Payouts (${pendingPayoutCount + pendingDcCount} Pending)`,
              icon: DollarSign,
            },
            { id: 'data' as const, label: 'Data Reset, Re-Seed & Staff Switch', icon: Database },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-medium border whitespace-nowrap ${
                  tab === t.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search modules, templates, staff..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
          />
        </div>
      </div>

      {/* TAB 1: MODULES, STORAGE & ROLES */}
      {tab === 'modules' && (
        <div className="space-y-5">
          {canAdmin && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-semibold text-blue-900 whitespace-nowrap">Admin Audit Reason:</span>
              <input
                value={controlReason}
                onChange={(e) => setControlReason(e.target.value)}
                className="flex-1 min-w-[260px] px-3 py-1.5 bg-blue-50/40 border border-blue-200 rounded-lg text-slate-900"
              />
            </div>
          )}

          {/* Storage Telemetry */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Local Hospital Database &amp; Archive Footprint
                  </div>
                  <div className="text-slate-500">
                    Used: <strong className="font-mono">{telemetry ? formatStorage(telemetry.totalUsedMb) : '—'}</strong> /{' '}
                    <span className="font-mono">{formatStorage(telemetry?.totalQuotaMb || db.saas.storageQuotaMb)}</span> ({pct.toFixed(1)}%)
                  </div>
                </div>
              </div>
              {canAdmin && (
                <button
                  type="button"
                  disabled={compacting}
                  onClick={handleCompactStorage}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {compacting ? 'Compacting...' : 'Compact Archive & Logs'}
                </button>
              )}
            </div>
          </div>

          {/* Module Feature Control */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Hospital ERP Module Activation ({enabledCount}/{totalModules} Enabled)
            </div>
            <div className="divide-y divide-slate-200">
              {filteredModules.map((mod) => (
                <div key={mod.key} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs">
                  <div className="min-w-[240px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900">{mod.name}</span>
                      <span className="font-mono text-[11px] text-slate-400">· {mod.category}</span>
                      {mod.lockedCore && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-blue-700">
                          <Lock className="w-3 h-3" />
                          Core Required
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 mt-0.5">{mod.description}</p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    <span className={`font-semibold ${mod.enabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {mod.enabled ? 'Active' : 'Disabled'}
                    </span>
                    <button
                      type="button"
                      disabled={!canAdmin || mod.lockedCore || togglingKey === mod.key}
                      onClick={() => handleToggleModule(mod)}
                      className={`px-3.5 py-1.5 font-medium rounded-lg border disabled:opacity-50 ${
                        mod.lockedCore
                          ? 'bg-slate-100 text-slate-500 border-slate-200'
                          : mod.enabled
                          ? 'bg-white text-rose-700 border-rose-300 hover:bg-rose-50'
                          : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                      }`}
                    >
                      {mod.lockedCore ? 'Locked' : mod.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Role Capacity */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-blue-600" />
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Hospital Staff Roles Capacity ({allowedRoles.length} / {maxRolesCap})
                  </div>
                  <div className="text-slate-500">Enable or restrict hospital departments/roles available in Personnel &amp; RBAC.</div>
                </div>
              </div>
              {canAdmin && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={maxRolesCap}
                    onChange={(e) => setMaxRolesCap(e.target.value)}
                    className="w-16 px-2 py-1 font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={savingRolesCap}
                    onClick={handleSaveRoleCapacity}
                    className="px-3.5 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    {savingRolesCap ? 'Saving...' : 'Save Role Policy'}
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {db.roles.map((r) => {
                const active = allowedRoles.includes(r.id);
                return (
                  <label
                    key={r.id}
                    className={`p-3 rounded-lg border flex items-start justify-between gap-2 cursor-pointer ${
                      active ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={!canAdmin || r.id === 'SUPER_ADMIN'}
                        checked={active}
                        onChange={() => handleToggleAllowedRole(r.id)}
                        className="mt-0.5 rounded border-slate-300 text-blue-600"
                      />
                      <div>
                        <div className="font-semibold text-slate-900">{r.name}</div>
                        <div className="font-mono text-[11px] text-slate-500">{r.id}</div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BILL & REPORT DESIGN STUDIO CONSOLIDATED INTO ADMIN */}
      {tab === 'designs' && canDesigns && (
        <DocumentDesignsView
          db={db}
          activeUser={activeUser}
          hasPerm={hasPerm}
          onUpdated={onUpdated}
          initialSearchQuery={searchTerm}
        />
      )}

      {/* TAB 3: LIVE DISCOUNT, CREDIT LIMIT & REFERRAL PAYOUT APPROVALS */}
      {tab === 'approvals' && (
        <div className="space-y-5">
          {/* Discount & Credit Limit Overrides */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Percent className="w-4 h-4 text-blue-600" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Discount Override &amp; Credit Limit Approvals ({pendingDcCount} Pending)
                  </h2>
                  <p className="text-slate-500">
                    Active Policies — Discount: <strong>{db.settings.moduleSettings?.discountApprovalPolicy || 'MANAGER_THEN_ADMIN'}</strong> · Credit Limit: <strong>{db.settings.moduleSettings?.creditApprovalPolicy || 'MANAGER_THEN_ADMIN'}</strong>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDcFilterTab('PENDING')}
                  className={`px-3 py-1.5 rounded-lg font-medium border ${
                    dcFilterTab === 'PENDING'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-300'
                  }`}
                >
                  Pending ({pendingDcCount})
                </button>
                <button
                  type="button"
                  onClick={() => setDcFilterTab('HISTORY')}
                  className={`px-3 py-1.5 rounded-lg font-medium border ${
                    dcFilterTab === 'HISTORY'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-300'
                  }`}
                >
                  History ({historyDcApprovals.length})
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
              {(dcFilterTab === 'PENDING' ? pendingDcApprovals : historyDcApprovals).length === 0 ? (
                <div className="p-6 text-center text-slate-500">
                  {dcFilterTab === 'PENDING'
                    ? 'No pending discount override or credit limit approval requests.'
                    : 'No completed approval history yet.'}
                </div>
              ) : (
                (dcFilterTab === 'PENDING' ? pendingDcApprovals : historyDcApprovals).map((r) => {
                  const isAdminRole =
                    activeUser.roleId === 'SUPER_ADMIN' ||
                    activeUser.roleId === 'SAAS_ADMIN' ||
                    hasPerm('finance.approve_admin');
                  const isMgrRole =
                    isAdminRole ||
                    hasPerm('finance.approve_manager') ||
                    activeUser.roleId === 'CENTER_MANAGER' ||
                    activeUser.roleId === 'INVENTORY_HR';
                  const canDecide =
                    (r.status === 'PENDING_MANAGER' && isMgrRole) ||
                    (r.status === 'PENDING_ADMIN' && isAdminRole);
                  const openHist = dcHistoryId === r.id;

                  return (
                    <div key={r.id} className="p-4 space-y-2.5 bg-white">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{r.requestNumber}</span>
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                                r.requestType === 'DISCOUNT_OVERRIDE'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-rose-50 text-rose-800 border-rose-200'
                              }`}
                            >
                              {r.requestType === 'DISCOUNT_OVERRIDE' ? 'DISCOUNT' : 'CREDIT LIMIT'}
                            </span>
                            <span className="px-2 py-0.5 rounded font-mono text-[10px] bg-slate-100 text-slate-700 border border-slate-200">
                              {r.sourceModule}
                            </span>
                            <span className="font-mono text-[11px] font-semibold text-blue-700">
                              {r.status.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="font-semibold text-slate-900">
                            {r.patientName} {r.uhid ? `· UHID ${r.uhid}` : ''} {r.encounterLabel ? `(${r.encounterLabel})` : ''}
                          </div>
                          <div className="text-slate-600">
                            Requested by {r.requesterName} ({adToBs(r.createdAt).formattedEn} BS) · {r.reason}
                          </div>
                        </div>

                        <div className="text-right font-mono">
                          <div className="text-base font-bold text-slate-900">
                            {formatNpr(r.requestedValueNpr)}
                            {r.requestedPercent !== undefined ? ` (${r.requestedPercent}%)` : ''}
                          </div>
                          {r.billSubtotalNpr !== undefined && (
                            <div className="text-[11px] text-slate-500">
                              Subtotal: {formatNpr(r.billSubtotalNpr)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setDcHistoryId(openHist ? null : r.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                        >
                          <History className="w-3 h-3" />
                          {openHist ? 'Hide History' : `Audit Timeline (${r.history.length})`}
                        </button>

                        {canDecide ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              value={dcRemarks[r.id] || ''}
                              onChange={(e) =>
                                setDcRemarks((prev) => ({ ...prev, [r.id]: e.target.value }))
                              }
                              placeholder="Approval remarks..."
                              className="px-2.5 py-1.5 border border-slate-300 rounded-lg w-52"
                            />
                            <button
                              type="button"
                              disabled={dcBusyId === r.id}
                              onClick={() => handleDcDecision(r, 'APPROVE')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check className="w-3 h-3" />
                              {r.status === 'PENDING_MANAGER' && !isAdminRole ? 'Forward to Admin' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={dcBusyId === r.id}
                              onClick={() => handleDcDecision(r, 'DECLINE')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-rose-700 bg-white border border-rose-300 rounded-lg hover:bg-rose-50 disabled:opacity-50"
                            >
                              <XCircle className="w-3 h-3" />
                              Decline
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">
                            {r.adminReviewedBy || r.managerReviewedBy || 'Pending review'}
                          </span>
                        )}
                      </div>

                      {openHist && (
                        <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-1 text-[11px]">
                          {r.history.map((h) => (
                            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                <strong>{h.action}</strong> by {h.actorName} ({h.actorRole})
                                {h.remarks ? ` — "${h.remarks}"` : ''}
                              </span>
                              <span className="font-mono text-slate-500">
                                {adToBs(h.timestamp).formattedEn} {adToBs(h.timestamp).timeEn}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Referral Partner Commission Payout Approval Queue
              </h2>
              <p className="text-slate-500">
                Inspect partner bank/wallet account details &amp; payment reference before releasing funds from Treasury.
              </p>
            </div>
            {canApproveReferrals && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={approvalAccId}
                  onChange={(e) => setApprovalAccId(e.target.value)}
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                >
                  {db.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatNpr(a.currentBalance)})
                    </option>
                  ))}
                </select>
                <input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Admin approval remark..."
                  className="px-2.5 py-1.5 border border-slate-300 rounded-lg w-56"
                />
              </div>
            )}
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Request # &amp; Date</th>
                  <th className="py-2.5 px-4">Referral Partner</th>
                  <th className="py-2.5 px-4">Account / Wallet &amp; Payment Ref</th>
                  <th className="py-2.5 px-4 text-right">Amount</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Admin Decision</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payoutReqs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-500">
                      No referral payout requests queued.
                    </td>
                  </tr>
                ) : (
                  payoutReqs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4 font-mono">
                        <div className="font-bold text-slate-900">{r.requestNumber}</div>
                        <div className="text-[11px] text-slate-500">{adToBs(r.requestedAt).formattedEn} BS</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{r.partnerName}</div>
                        <div className="text-[11px] text-slate-500">Req by {r.requestedBy}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-slate-900">{r.destinationSummary}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {r.paymentRefOrReceipt ? `Ref: ${r.paymentRefOrReceipt}` : r.notes}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                        {formatNpr(r.amountNpr)}
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        <span
                          className={
                            r.status === 'Approved & Paid'
                              ? 'text-emerald-700'
                              : r.status === 'Rejected'
                              ? 'text-rose-700'
                              : 'text-amber-700'
                          }
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {r.status === 'Pending Admin Approval' && canApproveReferrals ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={processingReqId === r.id}
                              onClick={() => handleApprovePayout(r.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              Approve &amp; Pay
                            </button>
                            <button
                              type="button"
                              disabled={processingReqId === r.id}
                              onClick={() => handleRejectPayout(r.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-rose-700 bg-white border border-rose-300 rounded hover:bg-rose-50"
                            >
                              <XCircle className="w-3 h-3" />
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500">{r.reviewedBy || '—'}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {/* TAB 4: DATA LIFECYCLE & STAFF SWITCH */}
      {tab === 'data' && (
        <div className="space-y-5 text-xs">
          {canAdmin && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Hospital Dummy Data Clear &amp; Selective Re-Seed
                  </h2>
                  <p className="text-slate-500">
                    Reset demo transactional records cleanly (requires Admin Secret PIN or confirmed Email) or selectively populate clinical modules.
                  </p>
                </div>
                <span className="font-mono text-[11px] px-2.5 py-1 bg-slate-100 border border-slate-200 rounded-lg text-slate-700">
                  Scope: Saptari Hospital Main
                </span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 border border-rose-200 bg-rose-50/30 rounded-xl space-y-3">
                  <div className="font-semibold text-rose-900">
                    1. Clear Dummy Transactional Data (PIN / Email Protected)
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clearInventoryBatches}
                      onChange={(e) => setClearInventoryBatches(e.target.checked)}
                    />
                    <span>Also clear Pharmacy FEFO stock batches &amp; zero reagent counts</span>
                  </label>
                  {!confirmClear ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEraseError('');
                        setConfirmClear(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-4 py-2 font-medium text-rose-700 bg-white border border-rose-300 rounded-lg hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Erase Dummy Data (Verify Admin PIN / Email)
                    </button>
                  ) : (
                    <div className="p-3 bg-white border border-rose-200 rounded-lg space-y-2.5">
                      <div className="font-semibold text-rose-800 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        Security Verification Required Before Erase
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 mb-1">
                            Admin Secret Erase PIN
                          </label>
                          <input
                            type="password"
                            value={erasePin}
                            onChange={(e) => setErasePin(e.target.value)}
                            placeholder="Secret PIN (e.g. 2082)"
                            className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-700 mb-1">
                            OR Confirmed Admin Email
                          </label>
                          <input
                            type="email"
                            value={eraseEmail}
                            onChange={(e) => setEraseEmail(e.target.value)}
                            placeholder="epusaan@gmail.com"
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      {eraseError && (
                        <div className="text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                          {eraseError}
                        </div>
                      )}
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          disabled={clearingData}
                          onClick={handleClearDummyData}
                          className="px-4 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                        >
                          {clearingData ? 'Erasing...' : 'Verify & Erase All Dummy Data'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmClear(false);
                            setEraseError('');
                          }}
                          className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-4 border border-blue-200 bg-blue-50/30 rounded-xl space-y-3">
                  <div className="font-semibold text-blue-900">2. Selective Hospital Re-Seed</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={seedTests} onChange={(e) => setSeedTests(e.target.checked)} />
                      Tests &amp; Rad Templates
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={seedReports} onChange={(e) => setSeedReports(e.target.checked)} />
                      Verified Lab Reports
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={seedRadiology} onChange={(e) => setSeedRadiology(e.target.checked)} />
                      X-Ray / USG Radiology
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={seedPharmacy} onChange={(e) => setSeedPharmacy(e.target.checked)} />
                      Pharmacy FEFO Stock
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={seedReagents} onChange={(e) => setSeedReagents(e.target.checked)} />
                      Hospital Reagents &amp; Films
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={seedHospital} onChange={(e) => setSeedHospital(e.target.checked)} />
                      OPD &amp; IPD Ward Beds
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={seedingData}
                    onClick={handleSeedCenterData}
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {seedingData ? 'Seeding...' : 'Re-Seed Hospital Data'}
                  </button>
                </div>
              </div>

              {activeUser.roleId === 'SUPER_ADMIN' && (
                <div className="p-4 border border-slate-200 bg-slate-50 rounded-xl flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <Server className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-900">
                        Admin-Only Full Source + Pre-Built Linux Node.js ZIP (Ready to Upload &amp; Run)
                      </div>
                      <div className="text-slate-600">
                        Includes full source + pre-compiled <code className="font-mono">dist/</code> &amp; <code className="font-mono">dist-server/server.js</code>, <code className="font-mono">app.cjs</code>, <code className="font-mono">start-linux.sh</code>, and <code className="font-mono">LINUX_NODE_HOSTING.md</code> for CloudLinux / Node-only Linux hosts.
                      </div>
                    </div>
                  </div>
                  <a
                    href={`/api/system/download-source?uid=${encodeURIComponent(activeUser.id)}`}
                    download="hospital-erp-linux-node-source.zip"
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download Linux Node.js ZIP
                  </a>
                </div>
              )}

              <CloudBackupPanel
                db={db}
                activeUser={activeUser}
                canManage={activeUser.roleId === 'SUPER_ADMIN' || canAdmin}
                onDbRestored={(nextDb, toastMsg) => onUpdated(nextDb, toastMsg)}
              />
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Staff Account Directory &amp; Direct Admin Session Switch
            </div>
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500">
                <tr>
                  <th className="py-2.5 px-4">Staff Member</th>
                  <th className="py-2.5 px-4">Username &amp; Role</th>
                  <th className="py-2.5 px-4">Center Scope</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStaff.map((st) => (
                  <tr key={st.id}>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{st.fullName}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-700">
                      @{st.username} · {st.roleId}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">
                      {st.assignedCenterName || 'Saptari Hospital Main'}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        disabled={impersonatingId === st.id || !onImpersonateSuccess}
                        onClick={() => handleDirectImpersonate(st)}
                        className="inline-flex items-center gap-1 px-3 py-1 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                      >
                        <LogIn className="w-3 h-3" />
                        {impersonatingId === st.id ? 'Switching...' : 'Switch Session'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
