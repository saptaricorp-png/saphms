import React, { useMemo, useState } from 'react';
import {
  Activity,
  BedDouble,
  CalendarClock,
  CreditCard,
  FileText,
  FlaskConical,
  Pill,
  Printer,
  Scissors,
  ShieldAlert,
  Stethoscope,
  X,
} from 'lucide-react';
import type {
  ClinicalVitals,
  EmergencyCase,
  EncounterType,
  IpdAdmission,
  LabOrder,
  LimsDatabase,
  OpdVisit,
  OtSurgeryCase,
  PatientRecord,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { detectPatientEncounter } from '../utils/patientEncounter';

export interface LongitudinalBillingContext {
  patient: PatientRecord;
  encounterType: EncounterType;
  encounterId?: string;
  encounterLabel: string;
}

interface TimelineEntry {
  id: string;
  dateIso: string;
  module: string;
  ref: string;
  title: string;
  subtitle: string;
  status: string;
  amountNpr: number;
  vitals?: ClinicalVitals;
  rawOpd?: OpdVisit;
  rawIpd?: IpdAdmission;
  rawEr?: EmergencyCase;
  rawOt?: OtSurgeryCase;
}

interface PatientLongitudinalDashboardProps {
  patient: PatientRecord;
  db: LimsDatabase;
  onClose: () => void;
  onRouteToBilling?: (target: 'pos' | 'pharmacy', ctx: LongitudinalBillingContext) => void;
  onOpenReport?: (order: LabOrder, autoPrint?: boolean) => void;
  onOpenBill?: (order: LabOrder, autoPrint?: boolean) => void;
}

type DashboardSection = 'timeline' | 'diagnostics' | 'pharmacy' | 'billing';

export function PatientLongitudinalDashboard({
  patient,
  db,
  onClose,
  onRouteToBilling,
  onOpenReport,
  onOpenBill,
}: PatientLongitudinalDashboardProps) {
  const [section, setSection] = useState<DashboardSection>('timeline');

  const normPhone = (patient.phone || '').replace(/\D/g, '').slice(-10);
  const normName = (patient.fullName || '').trim().toLowerCase();

  const isSamePatient = (pId?: string, u?: string, pName?: string, pPhone?: string) => {
    if (pId && pId === patient.id) return true;
    if (u && patient.uhid && u === patient.uhid) return true;
    const ph = (pPhone || '').replace(/\D/g, '').slice(-10);
    if (normPhone && ph && ph === normPhone && (!pName || pName.trim().toLowerCase() === normName)) {
      return true;
    }
    return false;
  };

  const detectedEncounter = useMemo(() => detectPatientEncounter(db, patient), [db, patient]);

  const data = useMemo(() => {
    const opdVisits = (db.opdVisits || []).filter((v) =>
      isSamePatient(v.patientId, v.uhid, v.patientName, v.patientPhone)
    );
    const ipdAdmissions = (db.ipdAdmissions || []).filter((a) =>
      isSamePatient(a.patientId, a.uhid, a.patientName, a.patientPhone)
    );
    const emergencyCases = (db.emergencyCases || []).filter((e) =>
      isSamePatient(e.patientId, e.uhid, e.patientName, e.patientPhone)
    );
    const otCases = (db.otCases || []).filter((c) =>
      isSamePatient(c.patientId, c.uhid, c.patientName, c.patientPhone)
    );
    const orders = (db.orders || []).filter((o) =>
      isSamePatient(o.patientId, o.uhid, o.patientName, o.patientPhone)
    );
    const pharmacyInvoices = (db.pharmacyInvoices || []).filter((inv) =>
      isSamePatient(inv.patientId, inv.uhid, inv.patientName, inv.patientPhone)
    );
    const pharmacyDeposits = (db.pharmacyDeposits || []).filter((d) =>
      isSamePatient(d.patientId, d.uhid, d.patientName, d.patientPhone)
    );

    const timeline: TimelineEntry[] = [
      ...opdVisits.map((v) => ({
        id: `tl-opd-${v.id}`,
        dateIso: v.visitDate,
        module: 'OPD Consultation',
        ref: v.tokenNumber,
        title: `${v.department} — ${v.consultingDoctor}`,
        subtitle: v.provisionalDiagnosis || v.chiefComplaint,
        status: v.disposition,
        amountNpr: v.consultationFeeNpr || 0,
        vitals: v.vitals,
        rawOpd: v,
      })),
      ...ipdAdmissions.map((a) => ({
        id: `tl-ipd-${a.id}`,
        dateIso: a.admittedAt,
        module: 'IPD Admission',
        ref: a.admissionNumber,
        title: `${a.currentWardName} (${a.currentBedLabel}) — ${a.admittingDoctor}`,
        subtitle: a.finalDiagnosis || a.admittingDiagnosis,
        status: a.disposition,
        amountNpr: a.totalBillNpr || 0,
        vitals: a.vitalsOnAdmission,
        rawIpd: a,
      })),
      ...emergencyCases.map((e) => ({
        id: `tl-er-${e.id}`,
        dateIso: e.registeredAt,
        module: e.isMlc ? 'Emergency & MLC' : 'Emergency (ER)',
        ref: e.erNumber + (e.mlcNumber ? ` / ${e.mlcNumber}` : ''),
        title: `${e.triageLevel} — ${e.attendingDoctor}`,
        subtitle: e.chiefComplaint,
        status: e.disposition,
        amountNpr: (e.erTicketFeeNpr || 0) + (e.erChargesNpr || 0),
        vitals: e.vitals,
        rawEr: e,
      })),
      ...otCases.map((ot) => ({
        id: `tl-ot-${ot.id}`,
        dateIso: ot.startedAt || ot.recordedAt,
        module: 'OT & Anesthesia',
        ref: ot.otNumber,
        title: `${ot.procedureName} (${ot.otRoomLabel})`,
        subtitle: `Surgeon: ${ot.leadSurgeon} · Anesth: ${ot.anesthesiologist}`,
        status: ot.status,
        amountNpr: ot.otFeeNpr || 0,
        rawOt: ot,
      })),
    ].sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime());

    // Financial Ledger Aggregation
    const billingEntries: Array<{
      id: string;
      dateIso: string;
      source: string;
      ref: string;
      description: string;
      totalNpr: number;
      paidNpr: number;
      dueNpr: number;
      mode: string;
      orderRef?: LabOrder;
    }> = [];

    for (const o of orders) {
      billingEntries.push({
        id: `bil-ord-${o.id}`,
        dateIso: o.orderedAt,
        source: 'Hospital POS',
        ref: o.invoiceNumber || o.accessionNumber,
        description: o.tests.map((t) => `${t.serviceCode} ${t.serviceName}`).join(', '),
        totalNpr: o.totalAmount || 0,
        paidNpr: o.paidAmount || 0,
        dueNpr: o.dueAmount || 0,
        mode: o.paymentMode,
        orderRef: o,
      });
    }
    for (const inv of pharmacyInvoices) {
      billingEntries.push({
        id: `bil-phm-${inv.id}`,
        dateIso: inv.dispensedAt,
        source: 'Pharmacy POS',
        ref: inv.invoiceNumber,
        description: inv.lines.map((l) => `${l.medicineName} ×${l.quantity}`).join(', '),
        totalNpr: inv.totalNpr || 0,
        paidNpr: inv.paidAmountNpr ?? (inv.dueAmountNpr ? Math.max(0, (inv.totalNpr || 0) - inv.dueAmountNpr) : inv.totalNpr || 0),
        dueNpr: inv.dueAmountNpr || 0,
        mode: inv.paymentMode,
      });
    }
    for (const a of ipdAdmissions) {
      const paid = (a.totalDepositPaidNpr || 0) + (a.individualCashPaidTotalNpr || 0);
      billingEntries.push({
        id: `bil-ipd-${a.id}`,
        dateIso: a.admittedAt,
        source: 'IPD Inpatient',
        ref: a.admissionNumber,
        description: `${a.currentWardName} (${a.currentBedLabel}) · Stay, Nursing & Services`,
        totalNpr: a.totalBillNpr || 0,
        paidNpr: paid,
        dueNpr: a.balanceDueNpr || 0,
        mode: a.balanceDueNpr > 0 ? 'IPD Running Due' : 'Settled',
      });
    }
    for (const v of opdVisits) {
      if ((v.consultationFeeNpr || 0) > 0) {
        billingEntries.push({
          id: `bil-opd-${v.id}`,
          dateIso: v.visitDate,
          source: 'OPD Ticket',
          ref: v.tokenNumber,
          description: `${v.department} Consultation (${v.consultingDoctor})`,
          totalNpr: v.consultationFeeNpr,
          paidNpr: v.consultationFeeNpr,
          dueNpr: 0,
          mode: v.paymentMode,
        });
      }
    }
    for (const e of emergencyCases) {
      const erAmt = (e.erTicketFeeNpr || 0) + (e.erChargesNpr || 0);
      if (erAmt > 0) {
        billingEntries.push({
          id: `bil-er-${e.id}`,
          dateIso: e.registeredAt,
          source: 'Emergency ER',
          ref: e.erNumber,
          description: `ER Triage & Resuscitation (${e.triageLevel})`,
          totalNpr: erAmt,
          paidNpr: e.paymentMode === 'Credit' ? e.depositPaidNpr || 0 : erAmt,
          dueNpr: e.paymentMode === 'Credit' ? Math.max(0, erAmt - (e.depositPaidNpr || 0)) : 0,
          mode: e.paymentMode,
        });
      }
    }

    billingEntries.sort((a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime());

    const totalBilledNpr = billingEntries.reduce((s, b) => s + b.totalNpr, 0);
    const totalPaidNpr = billingEntries.reduce((s, b) => s + b.paidNpr, 0);
    const totalDueNpr = billingEntries.reduce((s, b) => s + b.dueNpr, 0);
    const availablePharmacyDepositNpr = pharmacyDeposits.reduce(
      (s, d) => s + (d.remainingBalanceNpr || 0),
      0
    );

    return {
      opdVisits,
      ipdAdmissions,
      emergencyCases,
      otCases,
      orders,
      pharmacyInvoices,
      pharmacyDeposits,
      timeline,
      billingEntries,
      totalBilledNpr,
      totalPaidNpr,
      totalDueNpr,
      availablePharmacyDepositNpr,
    };
  }, [db, patient]);

  const makeBillingCtx = (): LongitudinalBillingContext => ({
    patient,
    encounterType: detectedEncounter.encounterType,
    encounterId: detectedEncounter.encounterId || undefined,
    encounterLabel: detectedEncounter.encounterLabel,
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3 sm:p-5">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3 bg-slate-50/70">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
                {patient.uhid}
              </span>
              <h2 className="text-lg font-semibold text-slate-900">{patient.fullName}</h2>
              <span className="text-xs text-slate-500">
                {patient.age} {patient.ageType} / {patient.gender} · {patient.phone} ·{' '}
                {patient.address || 'Address N/A'}
              </span>
            </div>
            <div className="text-xs text-slate-600 flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-800">
                Active Encounter Detected:{' '}
                <strong className="font-mono text-emerald-700">{detectedEncounter.encounterLabel}</strong>
              </span>
              <span className="text-slate-300">·</span>
              <span>
                Longitudinal EHR aggregating OPD, IPD, ER, OT, Pathology/Radiology, Pharmacy &amp; Dues
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onRouteToBilling && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onRouteToBilling('pos', makeBillingCtx());
                    onClose();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
                >
                  Bill in Hospital POS
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onRouteToBilling('pharmacy', makeBillingCtx());
                    onClose();
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
                >
                  Bill in Pharmacy POS
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 rounded-lg"
              aria-label="Close Patient Longitudinal Dashboard"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 border-b border-slate-200 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-white">
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Clinical Encounters</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {data.timeline.length}
            </div>
            <div className="text-[11px] text-slate-500">
              {data.opdVisits.length} OPD · {data.ipdAdmissions.length} IPD · {data.emergencyCases.length} ER · {data.otCases.length} OT
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Lab &amp; Radiology Orders</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {data.orders.length}
            </div>
            <div className="text-[11px] text-slate-500">
              {data.orders.filter((o) => o.status === 'Validated' || o.status === 'Dispatched').length} Validated Reports
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Pharmacy Invoices</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {data.pharmacyInvoices.length}
            </div>
            <div className="text-[11px] text-slate-500">
              Deposit Pool: <span className="font-mono">{formatNpr(data.availablePharmacyDepositNpr)}</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Total Billed (All Modules)</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 mt-0.5">
              {formatNpr(data.totalBilledNpr)}
            </div>
            <div className="text-[11px] text-emerald-700 font-mono">
              Paid: {formatNpr(data.totalPaidNpr)}
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="text-[11px] font-medium text-slate-500">Outstanding Due</div>
            <div
              className={`text-lg font-semibold font-mono tabular-nums mt-0.5 ${
                data.totalDueNpr > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {formatNpr(data.totalDueNpr)}
            </div>
            <div className="text-[11px] text-slate-500">
              {data.totalDueNpr > 0 ? 'Credit / IPD Balance Open' : 'All Clear'}
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-2">
          {(
            [
              { id: 'timeline', label: `Visits & Encounters (${data.timeline.length})`, icon: CalendarClock },
              { id: 'diagnostics', label: `Lab & Radiology Results (${data.orders.length})`, icon: FlaskConical },
              { id: 'pharmacy', label: `Prescriptions & Pharmacy (${data.pharmacyInvoices.length})`, icon: Pill },
              { id: 'billing', label: `Billing & Due Ledger (${data.billingEntries.length})`, icon: CreditCard },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = section === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSection(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content Scroll Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {section === 'timeline' && (
            <div className="space-y-3">
              {data.timeline.length === 0 ? (
                <div className="p-8 text-center border border-slate-200 rounded-xl text-sm text-slate-500">
                  No OPD, IPD, ER, or OT encounters recorded for this UHID yet.
                </div>
              ) : (
                data.timeline.map((item) => {
                  const bs = adToBs(item.dateIso);
                  return (
                    <div
                      key={item.id}
                      className="p-4 border border-slate-200 rounded-xl bg-white space-y-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-blue-700">{item.module}</span>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono text-xs font-semibold text-slate-900">
                            {item.ref}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="text-xs text-slate-500 font-mono">
                            {bs.formattedEn} {bs.timeEn}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs font-mono">
                          <span className="font-semibold text-slate-800">{item.status}</span>
                          {item.amountNpr > 0 && (
                            <span className="text-slate-600 tabular-nums">{formatNpr(item.amountNpr)}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-sm font-medium text-slate-900">{item.title}</div>
                      <div className="text-xs text-slate-600">{item.subtitle}</div>
                      {item.vitals && (item.vitals.bp || item.vitals.pulseBpm || item.vitals.spo2Pct) && (
                        <div className="text-[11px] font-mono text-slate-500 pt-1">
                          Vitals: BP {item.vitals.bp || '—'} · Pulse {item.vitals.pulseBpm || '—'} bpm · Temp{' '}
                          {item.vitals.tempF || '—'}°F · SpO2 {item.vitals.spo2Pct || '—'}%
                        </div>
                      )}
                      {item.rawIpd?.externalReferral && (
                        <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                          Referred Out to <strong>{item.rawIpd.externalReferral.referredToHospital}</strong> (
                          {item.rawIpd.externalReferral.referredToPlace}) · Transport:{' '}
                          {item.rawIpd.externalReferral.ambulanceName || item.rawIpd.externalReferral.transportMode}
                        </div>
                      )}
                      {item.rawEr?.externalReferral && (
                        <div className="text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg p-2.5">
                          ER Referred Out to <strong>{item.rawEr.externalReferral.referredToHospital}</strong> (
                          {item.rawEr.externalReferral.referredToPlace}) ·{' '}
                          {item.rawEr.externalReferral.ambulanceName || item.rawEr.externalReferral.transportMode}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {section === 'diagnostics' && (
            <div className="space-y-3">
              {data.orders.length === 0 ? (
                <div className="p-8 text-center border border-slate-200 rounded-xl text-sm text-slate-500">
                  No Laboratory or Radiology orders found for this patient.
                </div>
              ) : (
                data.orders.map((ord) => {
                  const bs = adToBs(ord.orderedAt);
                  const hasCrit = ord.tests.some((t) =>
                    t.parameterResults.some((pr) => pr.flag === 'CRITICAL_HIGH' || pr.flag === 'CRITICAL_LOW')
                  );
                  return (
                    <div
                      key={ord.id}
                      className="p-4 border border-slate-200 rounded-xl bg-white space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-semibold text-blue-700">{ord.accessionNumber}</span>
                          <span className="text-slate-300">·</span>
                          <span className="font-mono text-slate-500">
                            {bs.formattedEn} {bs.timeEn}
                          </span>
                          <span className="text-slate-300">·</span>
                          <span className="font-medium text-slate-800">Status: {ord.status}</span>
                          {hasCrit && (
                            <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                              <ShieldAlert className="w-3.5 h-3.5" /> Critical Flagged
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold tabular-nums text-slate-900">
                            {formatNpr(ord.totalAmount)}
                          </span>
                          {onOpenBill && (
                            <button
                              type="button"
                              onClick={() => onOpenBill(ord, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Printer className="w-3 h-3" /> POS Bill
                            </button>
                          )}
                          {onOpenReport && (
                            <button
                              type="button"
                              onClick={() => onOpenReport(ord, false)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap"
                            >
                              <FileText className="w-3 h-3" /> Print Report
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        {ord.tests.map((t) => (
                          <div key={t.serviceId} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
                            <div className="font-medium text-slate-900 flex items-center justify-between gap-2">
                              <span>
                                <strong className="font-mono">{t.serviceCode}</strong> — {t.serviceName}
                              </span>
                              <span className="text-[11px] text-slate-500">{t.status}</span>
                            </div>
                            {t.parameterResults.length > 0 && (
                              <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 font-mono text-[11px]">
                                {t.parameterResults.map((pr) => (
                                  <div key={pr.parameterId} className="flex justify-between gap-2">
                                    <span className="text-slate-600 truncate">{pr.parameterName}:</span>
                                    <span
                                      className={
                                        pr.flag === 'CRITICAL_HIGH' || pr.flag === 'CRITICAL_LOW'
                                          ? 'text-rose-700 font-bold'
                                          : pr.flag === 'HIGH' || pr.flag === 'LOW'
                                          ? 'text-amber-700 font-semibold'
                                          : 'text-slate-900'
                                      }
                                    >
                                      {pr.value ?? '—'} {pr.unit} ({pr.flag})
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {t.radiologyReport?.impression && (
                              <div className="mt-1 text-[11px] text-slate-700">
                                <strong>Impression:</strong> {t.radiologyReport.impression}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {section === 'pharmacy' && (
            <div className="space-y-3">
              {data.pharmacyInvoices.length === 0 &&
              data.opdVisits.every((v) => v.prescribedMedicines.length === 0) &&
              data.ipdAdmissions.every((a) => a.usedMedicines.length === 0) ? (
                <div className="p-8 text-center border border-slate-200 rounded-xl text-sm text-slate-500">
                  No Pharmacy POS bills or ward prescriptions found for this patient.
                </div>
              ) : (
                <>
                  {data.pharmacyInvoices.map((inv) => {
                    const bs = adToBs(inv.dispensedAt);
                    return (
                      <div key={inv.id} className="p-4 border border-slate-200 rounded-xl bg-white space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div>
                            <span className="font-mono font-semibold text-emerald-700">
                              {inv.invoiceNumber}
                            </span>{' '}
                            · <span className="font-mono text-slate-500">{bs.formattedEn} {bs.timeEn}</span> ·{' '}
                            <span className="text-slate-700">Prescriber: {inv.prescribingDoctor}</span>
                          </div>
                          <div className="font-mono tabular-nums font-semibold">
                            Total {formatNpr(inv.totalNpr)}{' '}
                            {(inv.dueAmountNpr || 0) > 0 ? (
                              <span className="text-rose-700">· Due {formatNpr(inv.dueAmountNpr || 0)}</span>
                            ) : (
                              <span className="text-emerald-700">· Paid ({inv.paymentMode})</span>
                            )}
                          </div>
                        </div>
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-xs">
                          {inv.lines.map((l, idx) => (
                            <div key={idx} className="px-3 py-1.5 flex items-center justify-between gap-2">
                              <div>
                                <span className="font-medium text-slate-900">{l.medicineName}</span>{' '}
                                <span className="text-slate-500">({l.genericName})</span> · Batch{' '}
                                <span className="font-mono">{l.batchNumber}</span>
                              </div>
                              <div className="font-mono tabular-nums">
                                × {l.quantity} = {formatNpr(l.lineTotalNpr)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {data.ipdAdmissions.flatMap((a) =>
                    a.usedMedicines.map((m) => (
                      <div
                        key={`ipd-m-${m.id}`}
                        className="p-3 border border-slate-200 rounded-lg bg-slate-50 flex items-center justify-between text-xs"
                      >
                        <div>
                          <span className="font-mono font-semibold text-slate-800">{a.admissionNumber}</span> ·{' '}
                          <strong>{m.medicineName}</strong> ({m.dosageRoute})
                        </div>
                        <div className="font-mono tabular-nums">
                          Qty {m.quantity} · {formatNpr(m.totalPriceNpr)}
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          )}

          {section === 'billing' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 uppercase text-[10px]">
                      <th className="py-2.5 px-3">Date (BS)</th>
                      <th className="py-2.5 px-3">Module / Ref</th>
                      <th className="py-2.5 px-3">Items / Particulars</th>
                      <th className="py-2.5 px-3 text-right">Billed (NPR)</th>
                      <th className="py-2.5 px-3 text-right">Paid (NPR)</th>
                      <th className="py-2.5 px-3 text-right">Due (NPR)</th>
                      <th className="py-2.5 px-3">Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.billingEntries.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-500">
                          No financial invoices or dues recorded for this patient.
                        </td>
                      </tr>
                    ) : (
                      data.billingEntries.map((row) => {
                        const bs = adToBs(row.dateIso);
                        return (
                          <tr key={row.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-3 font-mono whitespace-nowrap">{bs.formattedEn}</td>
                            <td className="py-2.5 px-3">
                              <div className="font-semibold text-slate-900">{row.source}</div>
                              <div className="font-mono text-[11px] text-blue-700">{row.ref}</div>
                            </td>
                            <td className="py-2.5 px-3 text-slate-700 max-w-md">{row.description}</td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                              {formatNpr(row.totalNpr)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                              {formatNpr(row.paidNpr)}
                            </td>
                            <td
                              className={`py-2.5 px-3 text-right font-mono tabular-nums font-semibold ${
                                row.dueNpr > 0 ? 'text-rose-700' : 'text-slate-500'
                              }`}
                            >
                              {formatNpr(row.dueNpr)}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap">{row.mode}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
