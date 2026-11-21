import React, { useMemo } from 'react';
import { Banknote, CheckSquare, Siren, ArrowRight } from 'lucide-react';
import type { LimsDatabase } from '../types/lims';
import { formatNpr } from '../utils/nepaliDate';

interface DashboardWidgetProps {
  db: LimsDatabase;
  activeFiscalYear: string;
  onNavigate?: (tabId: string) => void;
}

export function DashboardWidget({ db, activeFiscalYear, onNavigate }: DashboardWidgetProps) {
  const stats = useMemo(() => {
    const todayYmd = new Date().toISOString().slice(0, 10);

    // 1. Day's Collection (Orders + Pharmacy + OPD + ER + IPD deposits recorded today, fallback to shift if empty? Strict today YMD across modules)
    const orderToday = (db.orders || [])
      .filter((o) => (o.orderedAt || '').slice(0, 10) === todayYmd && (!activeFiscalYear || o.fiscalYear === activeFiscalYear))
      .reduce((sum, o) => sum + (o.cashPaid || 0) + (o.bankPaid || 0), 0);

    const pharmacyToday = (db.pharmacyInvoices || [])
      .filter((inv) => (inv.dispensedAt || '').slice(0, 10) === todayYmd)
      .reduce((sum, inv) => sum + (inv.cashPaid || 0) + (inv.bankPaid || 0), 0);

    const opdToday = (db.opdVisits || [])
      .filter((v) => (v.visitDate || '').slice(0, 10) === todayYmd && v.paymentMode !== 'Center Credit')
      .reduce((sum, v) => sum + (v.consultationFeeNpr || 0), 0);

    const erToday = (db.emergencyCases || [])
      .filter((e) => (e.registeredAt || '').slice(0, 10) === todayYmd && e.paymentMode !== 'Center Credit')
      .reduce((sum, e) => sum + (e.erChargesNpr || 0), 0);

    const ipdDepositsToday = (db.ipdAdmissions || []).reduce((sum, adm) => {
      const admToday = (adm.deposits || [])
        .filter((d) => (d.timestamp || '').slice(0, 10) === todayYmd && d.paymentMode !== 'Center Credit')
        .reduce((s, d) => s + (d.amountNpr || 0), 0);
      return sum + admToday;
    }, 0);

    const daysCollectionNpr = Number((orderToday + pharmacyToday + opdToday + erToday + ipdDepositsToday).toFixed(2));

    // 2. Pending Approvals Count (2-tier finance approval queue + pending referral payouts)
    const financePending = (db.financeApprovalRequests || []).filter(
      (r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN'
    );
    const managerStageCount = financePending.filter((r) => r.status === 'PENDING_MANAGER').length;
    const adminStageCount = financePending.filter((r) => r.status === 'PENDING_ADMIN').length;
    const referralPendingCount = (db.referralPayoutRequests || []).filter(
      (r) => r.status === 'Pending Admin Approval'
    ).length;
    const pendingApprovalsTotal = financePending.length + referralPendingCount;

    // 3. Emergency / MLC Urgent Cases
    const erCases = db.emergencyCases || [];
    const activeRedOrMlcPending = erCases.filter(
      (c) =>
        (c.disposition === 'Under Observation (ER)' && c.triageLevel === 'Red (Resuscitation)') ||
        (c.isMlc && !c.policeInformed)
    );
    const mlcPendingPoliceCount = erCases.filter((c) => c.isMlc && !c.policeInformed).length;
    const redTriageCount = erCases.filter(
      (c) => c.disposition === 'Under Observation (ER)' && c.triageLevel === 'Red (Resuscitation)'
    ).length;

    return {
      daysCollectionNpr,
      breakdownLabel: `Lab ${formatNpr(orderToday)} · Phm ${formatNpr(pharmacyToday)} · Clinical ${formatNpr(opdToday + erToday + ipdDepositsToday)}`,
      pendingApprovalsTotal,
      managerStageCount,
      adminStageCount,
      referralPendingCount,
      urgentErMlcCount: activeRedOrMlcPending.length,
      mlcPendingPoliceCount,
      redTriageCount,
    };
  }, [db, activeFiscalYear]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Card 1: Day's Collection */}
      <button
        type="button"
        onClick={() => onNavigate?.('finance')}
        className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors flex flex-col justify-between gap-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Day&apos;s Collection (Today)
          </span>
          <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
        </div>
        <div className="text-2xl font-mono font-bold tabular-nums text-slate-900">
          {formatNpr(stats.daysCollectionNpr)}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 gap-2">
          <span className="truncate">{stats.breakdownLabel}</span>
          <span className="inline-flex items-center gap-0.5 text-emerald-700 font-medium shrink-0">
            Counter <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </button>

      {/* Card 2: Pending Approvals Count */}
      <button
        type="button"
        onClick={() => onNavigate?.('finance')}
        className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors flex flex-col justify-between gap-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Pending Approvals Count
          </span>
          <CheckSquare className="w-4 h-4 text-amber-600 shrink-0" />
        </div>
        <div className="text-2xl font-mono font-bold tabular-nums text-slate-900">
          {stats.pendingApprovalsTotal}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 gap-2">
          <span className="truncate font-mono tabular-nums">
            Mgr: {stats.managerStageCount} · Admin: {stats.adminStageCount} · Ref: {stats.referralPendingCount}
          </span>
          <span className="inline-flex items-center gap-0.5 text-amber-700 font-medium shrink-0">
            Review <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </button>

      {/* Card 3: Emergency / MLC Urgent Cases */}
      <button
        type="button"
        onClick={() => onNavigate?.('emergency')}
        className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-slate-300 transition-colors flex flex-col justify-between gap-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Emergency / MLC Urgent Cases
          </span>
          <Siren className="w-4 h-4 text-rose-600 shrink-0" />
        </div>
        <div className="text-2xl font-mono font-bold tabular-nums text-rose-700">
          {stats.urgentErMlcCount}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 gap-2">
          <span className="truncate font-mono tabular-nums">
            MLC Police Due: {stats.mlcPendingPoliceCount} · Red Triage: {stats.redTriageCount}
          </span>
          <span className="inline-flex items-center gap-0.5 text-rose-700 font-medium shrink-0">
            Open ER <ArrowRight className="w-3 h-3" />
          </span>
        </div>
      </button>
    </div>
  );
}
