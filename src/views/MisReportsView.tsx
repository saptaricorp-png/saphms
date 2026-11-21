import React, { useMemo, useState } from 'react';
import { BarChart3, Printer, Share2 } from 'lucide-react';
import type { LimsDatabase } from '../types/lims';
import { formatNpr } from '../utils/nepaliDate';
import { MisPrintModal } from '../components/HospitalPrintModals';

interface MisReportsViewProps {
  db: LimsDatabase;
  activeFiscalYear: string;
}

export function MisReportsView({ db, activeFiscalYear }: MisReportsViewProps) {
  const [showPrint, setShowPrint] = useState(false);

  const stats = useMemo(() => {
    const orders = db.orders.filter((o) => o.fiscalYear === activeFiscalYear);
    const phm = (db.pharmacyInvoices || []).filter((i) => i.fiscalYear === activeFiscalYear);
    const opd = (db.opdVisits || []).filter((v) => v.fiscalYear === activeFiscalYear);
    const er = (db.emergencyCases || []).filter((e) => e.fiscalYear === activeFiscalYear);
    const ipd = (db.ipdAdmissions || []).filter((a) => a.fiscalYear === activeFiscalYear);

    const hospBillingRev = orders.reduce((s, o) => s + o.totalAmount, 0);
    const phmRev = phm.reduce((s, i) => s + i.totalNpr, 0);
    const opdRev = opd.reduce((s, v) => s + v.consultationFeeNpr, 0);
    const erRev = er.reduce((s, e) => s + e.erChargesNpr + (e.erTicketFeeNpr || 0), 0);

    const hospCashBank = db.accounts
      .filter((a) => a.departmentScope !== 'PHARMACY')
      .reduce((s, a) => s + a.currentBalance, 0);
    const phmCashBank = db.accounts
      .filter((a) => a.departmentScope === 'PHARMACY')
      .reduce((s, a) => s + a.currentBalance, 0);

    const referralRank = [...db.referrals]
      .map((r) => ({
        ...r,
        referralOrderCount: db.orders.filter((o) => o.referralPartnerId === r.id).length,
      }))
      .sort((a, b) => b.referralOrderCount - a.referralOrderCount || b.totalReferredSales - a.totalReferredSales);

    const ipdExposure = ipd.filter((a) => a.disposition === 'Admitted');
    const pendingCreditApprovals = ipdExposure.filter(
      (a) => a.creditApprovalStatus === 'PENDING_ADMIN_CREDIT' || a.balanceDueNpr > (a.creditLimitNpr || 50000)
    ).length;

    return {
      ordersCount: orders.length,
      phmCount: phm.length,
      opdCount: opd.length,
      freeFollowUps: opd.filter((v) => v.isFreeFollowUp).length,
      erCount: er.length,
      mlcCount: er.filter((e) => e.isMlc).length,
      ipdCount: ipd.length,
      ipdActive: ipdExposure.length,
      hospBillingRev,
      phmRev,
      opdRev,
      erRev,
      hospCashBank,
      phmCashBank,
      referralRank,
      pendingCreditApprovals,
    };
  }, [db, activeFiscalYear]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Hospital Executive MIS Reports ({activeFiscalYear})
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Consolidated Hospital vs. Pharmacy revenue ledger, clinical encounters, IPD credit exposure, store issues &amp; most frequent patient referrals.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowPrint(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Printer className="w-3.5 h-3.5" />
          Print Consolidated A4 MIS Report
        </button>
      </div>

      {/* Top Financial & Split Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Hospital Clinical Revenue</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {formatNpr(stats.hospBillingRev + stats.opdRev + stats.erRev)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.ordersCount} Lab/Rad · {stats.opdCount} OPD ({stats.freeFollowUps} free) · {stats.erCount} ER
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Separate Pharmacy Counter</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {formatNpr(stats.phmRev)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.phmCount} Pharmacy Bills · Cash/Bank Bal: {formatNpr(stats.phmCashBank)}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Hospital Cash &amp; Bank Reserve</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
            {formatNpr(stats.hospCashBank)}
          </div>
          <div className="text-xs text-slate-500 mt-1">Strict counter separation from Pharmacy</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">IPD Active &amp; Credit Exposure</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {stats.ipdActive} Admitted · {stats.mlcCount} MLC
          </div>
          <div className="text-xs text-amber-700 font-medium mt-1">
            {stats.pendingCreditApprovals} IPD over/near credit limit
          </div>
        </div>
      </div>

      {/* Two-Column Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Most Frequent Patient Referrals */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Share2 className="w-4 h-4 text-blue-600" />
              Most Frequent Patient Referrals Leaderboard
            </h2>
            <span className="text-xs font-mono text-slate-500">{stats.referralRank.length} partners</span>
          </div>
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-4">Referral Physician / Clinic</th>
                <th className="py-2.5 px-4 text-right">Patients Referred</th>
                <th className="py-2.5 px-4 text-right">Total Referred Sales</th>
                <th className="py-2.5 px-4 text-right">Commission</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.referralRank.map((r) => (
                <tr key={r.id}>
                  <td className="py-2.5 px-4">
                    <div className="font-semibold text-slate-900">{r.name}</div>
                    <div className="text-[11px] text-slate-500">{r.type} · {r.code}</div>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono font-bold text-blue-700">
                    {r.referralOrderCount}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">{formatNpr(r.totalReferredSales)}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-emerald-700">
                    {formatNpr(r.totalCommissionEarned)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Operational Modules Summary */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Hospital Operations, Store, Gatepass &amp; HR Telemetry
            </h2>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            <div className="px-5 py-3 flex justify-between">
              <span className="text-slate-600">Registered Patient UHIDs</span>
              <strong className="font-mono">{(db.patients || []).length}</strong>
            </div>
            <div className="px-5 py-3 flex justify-between">
              <span className="text-slate-600">Hospital Store Department Requisitions Issued</span>
              <strong className="font-mono">{(db.storeRequisitions || []).length}</strong>
            </div>
            <div className="px-5 py-3 flex justify-between">
              <span className="text-slate-600">Gatepass &amp; Visitor Clearances Issued / Active</span>
              <strong className="font-mono">
                {(db.gatepasses || []).length} / {(db.gatepasses || []).filter((g) => g.status === 'Active').length} Active
              </strong>
            </div>
            <div className="px-5 py-3 flex justify-between">
              <span className="text-slate-600">Attendance Punches (Hikvision / QR / GPS)</span>
              <strong className="font-mono">{(db.attendanceLogs || []).length}</strong>
            </div>
            <div className="px-5 py-3 flex justify-between">
              <span className="text-slate-600">Shift Handovers Pending Receive &amp; Approve</span>
              <strong className="font-mono text-amber-700">
                {(db.shiftHandovers || []).filter((h) => h.status === 'SENT').length} Pending
              </strong>
            </div>
            <div className="px-5 py-3 flex justify-between">
              <span className="text-slate-600">Field Marketing Visits (GPS + Photo)</span>
              <strong className="font-mono">{(db.marketingVisits || []).length}</strong>
            </div>
          </div>
        </div>
      </div>

      {showPrint && (
        <MisPrintModal
          db={db}
          activeFiscalYear={activeFiscalYear}
          onClose={() => setShowPrint(false)}
        />
      )}
    </div>
  );
}
