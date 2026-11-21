import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  Save,
} from 'lucide-react';
import type {
  Dhis2MonthlyReport,
  LimsDatabase,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { formatNpr } from '../utils/nepaliDate';
import { Dhis2MunicipalityPrintModal } from '../components/HospitalPrintModals';

interface Dhis2ViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  initialSearchQuery?: string;
}

const BS_MONTHS = [
  'Baisakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
];

export function Dhis2View({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: Dhis2ViewProps) {
  const canManage = hasPerm('dhis2.manage');
  const reports = db.dhis2Reports || [];

  const [selectedId, setSelectedId] = useState<string>(reports[0]?.id || '');
  const [bsYear, setBsYear] = useState('2083');
  const [bsMonthName, setBsMonthName] = useState('Shrawan');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printReport, setPrintReport] = useState<Dhis2MonthlyReport | null>(null);

  const activeReport = useMemo(
    () => reports.find((r) => r.id === selectedId) || reports[0] || null,
    [reports, selectedId]
  );

  const [draft, setDraft] = useState<Dhis2MonthlyReport | null>(activeReport);

  useEffect(() => {
    setDraft(activeReport ? { ...activeReport } : null);
  }, [activeReport]);

  useEffect(() => {
    if (!initialSearchQuery) return;
    const match = reports.find((r) =>
      `${r.reportCode} ${r.bsMonthName} ${r.bsYear} ${r.municipalityReceiptNo || ''}`
        .toLowerCase()
        .includes(initialSearchQuery.toLowerCase())
    );
    if (match) setSelectedId(match.id);
  }, [initialSearchQuery, reports]);

  const handleGenerate = async () => {
    if (!canManage) return;
    setGenerating(true);
    try {
      const monthIdx = Math.max(1, BS_MONTHS.indexOf(bsMonthName) + 1);
      const resp = await apiRequest<{ report: Dhis2MonthlyReport; db: LimsDatabase }>(
        '/api/dhis2/generate',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            bsYear: Number(bsYear) || 2083,
            bsMonthIndex: monthIdx,
            bsMonthName,
            preparedBy: activeUser.fullName,
          }),
        }
      );
      setSelectedId(resp.report.id);
      setDraft({ ...resp.report });
      onUpdated(
        resp.db,
        `Generated Offline DHIS2/HMIS report ${resp.report.reportCode} for ${resp.report.bsMonthName} ${resp.report.bsYear}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to generate DHIS2 report.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveChanges = async (nextStatus?: Dhis2MonthlyReport['status']) => {
    if (!canManage || !draft) return;
    setSaving(true);
    try {
      const payload = {
        ...draft,
        ...(nextStatus ? { status: nextStatus } : {}),
      };
      const resp = await apiRequest<{ report: Dhis2MonthlyReport; db: LimsDatabase }>(
        `/api/dhis2/${draft.id}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );
      setDraft({ ...resp.report });
      onUpdated(
        resp.db,
        `Saved DHIS2 report ${resp.report.reportCode} (${resp.report.status}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update DHIS2 report.');
    } finally {
      setSaving(false);
    }
  };

  const updateNum = (field: keyof Dhis2MonthlyReport, val: string) => {
    if (!draft) return;
    setDraft({ ...draft, [field]: Math.max(0, Number(val) || 0) });
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            DHIS2 / HMIS Monthly Reporting (Offline · Non-API) — Bode Barsain Municipality
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Local offline HMIS aggregation directly from Saptari Hospital OPD, ER/MLC, IPD, Birth/Death, Lab, Radiology &amp; Pharmacy with strict 2-Paper Printable Municipality Submission &amp; Receipt Form
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {draft && (
            <button
              type="button"
              onClick={() => setPrintReport(draft)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print 2-Paper Municipality Form
            </button>
          )}
        </div>
      </div>

      {/* Offline Guarantee & Generator Strip */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-slate-900">
              Offline / Non-API Mode · Addressed to: Health Section, Bode Barsain Municipality, Saptari
            </div>
            <div className="text-slate-500">
              Zero external DHIS2 server calls. Print Paper 1 &amp; Paper 2 cleanly with physical receipt &amp; stamp sign block.
            </div>
          </div>
        </div>

        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={bsMonthName}
              onChange={(e) => setBsMonthName(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              {BS_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={bsYear}
              onChange={(e) => setBsYear(e.target.value)}
              className="w-20 px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
            />
            <button
              type="button"
              disabled={generating}
              onClick={handleGenerate}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Aggregating...' : 'Generate Offline Report'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Saved Monthly Reports List */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 text-xs">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-blue-600" />
            Monthly Returns ({reports.length})
          </div>
          {reports.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelectedId(r.id)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                draft?.id === r.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-bold text-blue-700">{r.reportCode}</span>
                <span
                  className={`font-semibold text-[11px] ${
                    r.status === 'Submitted & Received'
                      ? 'text-emerald-700'
                      : r.status === 'Finalized & Printed'
                      ? 'text-blue-700'
                      : 'text-amber-700'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {r.bsMonthName} {r.bsYear}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">{r.municipalityTargetName}</div>
            </button>
          ))}
        </div>

        {/* Selected Report Editable Verification & Municipality Receipt */}
        <div className="lg:col-span-9">
          {!draft ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              No DHIS2 report generated yet. Click &quot;Generate Offline Report&quot; above.
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    {draft.reportCode} — {draft.bsMonthName} {draft.bsYear}
                  </h2>
                  <p className="text-slate-500">
                    Recipient: {draft.municipalityTargetName} · Status: <strong>{draft.status}</strong>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canManage && (
                    <>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveChanges()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        <Save className="w-3.5 h-3.5" />
                        Save Edits
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => handleSaveChanges('Submitted & Received')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Mark Received by Municipality
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setPrintReport(draft)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print 2-Paper Form
                  </button>
                </div>
              </div>

              {/* Section A: OPD & ER */}
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900 uppercase tracking-wide text-[11px]">
                  Paper 1 — Section A: Outpatient (OPD), Emergency &amp; MLC Surveillance
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(
                    [
                      ['opdNewFemale', 'New OPD — Female'],
                      ['opdNewMale', 'New OPD — Male'],
                      ['opdFollowupTotal', 'OPD Follow-Up'],
                      ['emergencyTotalVisits', 'ER Total Cases'],
                      ['emergencyMlcCases', 'MLC Cases'],
                      ['ipdTotalBedsAvailable', 'Active Hospital Beds'],
                      ['ipdTotalBedDays', 'Total IPD Bed Days'],
                      ['ipdBedOccupancyPercent', 'Bed Occupancy (%)'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
                      <input
                        type="number"
                        min={0}
                        value={Number(draft[field] || 0)}
                        onChange={(e) => updateNum(field, e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Section B: IPD, Maternity & Certificates */}
              <div className="space-y-2 pt-3 border-t border-slate-200">
                <h3 className="font-semibold text-slate-900 uppercase tracking-wide text-[11px]">
                  Paper 1 — Section B &amp; C: Inpatient Ward, Safe Motherhood, Births &amp; Deaths
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(
                    [
                      ['ipdTotalAdmissions', 'IPD Admissions'],
                      ['ipdDischargedHome', 'Discharged Home'],
                      ['ipdReferredOut', 'External Referrals'],
                      ['ipdLamaCases', 'LAMA / DOR'],
                      ['normalDeliveries', 'Normal Deliveries'],
                      ['cesareanDeliveries', 'Cesarean (LSCS)'],
                      ['liveBirthsMale', 'Live Births (Male)'],
                      ['liveBirthsFemale', 'Live Births (Female)'],
                      ['lowBirthWeightCount', 'Low Birth Wt (<2.5kg)'],
                      ['institutionalDeaths', 'Hospital Deaths'],
                      ['maternalDeaths', 'Maternal Deaths'],
                      ['neonatalDeaths', 'Neonatal Deaths'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
                      <input
                        type="number"
                        min={0}
                        value={Number(draft[field] || 0)}
                        onChange={(e) => updateNum(field, e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Paper 2: Lab, Radiology, Morbidity & Pharmacy */}
              <div className="space-y-2 pt-3 border-t border-slate-200">
                <h3 className="font-semibold text-slate-900 uppercase tracking-wide text-[11px]">
                  Paper 2 — Section D &amp; E: Diagnostics, Morbidity Surveillance &amp; Separate Pharmacy
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(
                    [
                      ['pathologyTestsDone', 'Pathology Lab Tests'],
                      ['xrayStudiesDone', 'Digital X-Ray Studies'],
                      ['usgEchoDone', 'USG & 2D Echo Studies'],
                      ['ctEcgDone', 'CT / ECG Investigations'],
                      ['morbidityAriPneumonia', 'ARI / Pneumonia'],
                      ['morbidityDiarrheaDysentery', 'Diarrhea / AGE'],
                      ['morbidityHypertensionCvd', 'Hypertension / CVD'],
                      ['morbidityDiabetes', 'Diabetes Mellitus'],
                      ['morbidityTraumaRta', 'Trauma & RTA Cases'],
                      ['morbidityEntericFever', 'Enteric / Febrile'],
                      ['pharmacyBillsIssued', 'Separate Pharmacy Bills'],
                      ['pharmacyStockoutItemsCount', 'Pharmacy Stockouts'],
                    ] as const
                  ).map(([field, label]) => (
                    <div key={field}>
                      <label className="block text-[11px] text-slate-600 mb-1">{label}</label>
                      <input
                        type="number"
                        min={0}
                        value={Number(draft[field] || 0)}
                        onChange={(e) => updateNum(field, e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono tabular-nums border border-slate-300 rounded-lg"
                      />
                    </div>
                  ))}
                </div>
                <div className="text-[11px] font-mono text-slate-600 pt-1">
                  Separate Pharmacy POS Bills: {draft.pharmacyBillsIssued} · Essential Drug Stockouts: {draft.pharmacyStockoutItemsCount}
                </div>
              </div>

              {/* Bode Barsain Municipality Receipt Sign-Off */}
              <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-4 space-y-3">
                <div className="font-semibold text-blue-950">
                  Bode Barsain Municipality Health Section Receipt Verification (Printed at bottom of Paper 2)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Prepared By (Hospital)
                    </label>
                    <input
                      value={draft.preparedBy}
                      onChange={(e) => setDraft({ ...draft, preparedBy: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Medical Superintendent
                    </label>
                    <input
                      value={draft.approvedByDoctor}
                      onChange={(e) => setDraft({ ...draft, approvedByDoctor: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Municipality Receipt No.
                    </label>
                    <input
                      value={draft.municipalityReceiptNo || ''}
                      onChange={(e) => setDraft({ ...draft, municipalityReceiptNo: e.target.value })}
                      placeholder="Entered after physical hand-off"
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">
                      Received By (Health Section Officer)
                    </label>
                    <input
                      value={draft.receivedByOfficer || ''}
                      onChange={(e) => setDraft({ ...draft, receivedByOfficer: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Remarks</label>
                    <input
                      value={draft.remarks || ''}
                      onChange={(e) => setDraft({ ...draft, remarks: e.target.value })}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2-PAPER PRINTABLE FORM MODAL */}
      {printReport && (
        <Dhis2MunicipalityPrintModal
          report={printReport}
          settings={db.settings}
          onClose={() => setPrintReport(null)}
        />
      )}
    </div>
  );
}
