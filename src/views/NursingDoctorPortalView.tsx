import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FileText,
  FlaskConical,
  HeartPulse,
  Pill,
  Plus,
  Printer,
  Search,
  Stethoscope,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ClinicalUsedMedicineItem,
  EmergencyCase,
  IpdAdmission,
  LabOrder,
  LimsDatabase,
  OpdDispositionType,
  OpdVisit,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { NursingChartPrintModal } from '../components/HospitalPrintModals';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';

function detectAbnormalVitals(params: {
  bp?: string;
  pulseBpm?: number;
  tempF?: number;
  spo2Pct?: number;
  respRate?: number;
}): string[] {
  const reasons: string[] = [];
  if (params.bp && params.bp.includes('/')) {
    const [sysRaw, diaRaw] = params.bp.split('/').map((x) => Number(x.trim()));
    if (Number.isFinite(sysRaw) && (sysRaw >= 140 || sysRaw <= 90)) {
      reasons.push(`BP ${params.bp} mmHg`);
    } else if (Number.isFinite(diaRaw) && (diaRaw >= 90 || diaRaw <= 60)) {
      reasons.push(`BP ${params.bp} mmHg`);
    }
  }
  if (params.pulseBpm !== undefined && Number.isFinite(params.pulseBpm) && (params.pulseBpm > 110 || params.pulseBpm < 55)) {
    reasons.push(`Pulse ${params.pulseBpm} bpm`);
  }
  if (params.tempF !== undefined && Number.isFinite(params.tempF) && (params.tempF >= 100.4 || params.tempF < 95.5)) {
    reasons.push(`Temp ${params.tempF}°F`);
  }
  if (params.spo2Pct !== undefined && Number.isFinite(params.spo2Pct) && params.spo2Pct < 94) {
    reasons.push(`SpO₂ ${params.spo2Pct}%`);
  }
  if (params.respRate !== undefined && Number.isFinite(params.respRate) && (params.respRate > 24 || params.respRate < 12)) {
    reasons.push(`RR ${params.respRate}/min`);
  }
  return reasons;
}

export function NursingDoctorPortalView({
  db,
  activeUser,
  hasPerm,
  initialMode = 'DOCTOR',
  onUpdated,
  onOpenReport,
}: {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (p: PermissionKey) => boolean;
  initialMode?: 'DOCTOR' | 'NURSE';
  onUpdated: () => Promise<void>;
  onOpenReport: (order: LabOrder) => void;
}) {
  const [mode, setMode] = useState<'DOCTOR' | 'NURSE'>(initialMode);
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // ================= DOCTOR PORTAL STATE =================
  const [opdSearch, setOpdSearch] = useState('');
  const opdQueue = useMemo(() => {
    const q = opdSearch.trim().toLowerCase();
    return (db.opdVisits || []).filter((v) => {
      if (!q) return true;
      return (
        v.patientName.toLowerCase().includes(q) ||
        v.tokenNumber.toLowerCase().includes(q) ||
        (v.uhid || '').toLowerCase().includes(q) ||
        v.department.toLowerCase().includes(q)
      );
    });
  }, [db.opdVisits, opdSearch]);

  const [selectedVisitId, setSelectedVisitId] = useState<string>(opdQueue[0]?.id || '');
  const selectedVisit: OpdVisit | undefined =
    opdQueue.find((v) => v.id === selectedVisitId) || opdQueue[0];

  const [docBp, setDocBp] = useState('');
  const [docPulse, setDocPulse] = useState('');
  const [docTemp, setDocTemp] = useState('');
  const [docSpo2, setDocSpo2] = useState('');
  const [docWeight, setDocWeight] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [provisionalDiagnosis, setProvisionalDiagnosis] = useState('');
  const [followUpAdvice, setFollowUpAdvice] = useState('');
  const [disposition, setDisposition] = useState<OpdDispositionType>('In Consultation');
  const [prescribedMeds, setPrescribedMeds] = useState<ClinicalUsedMedicineItem[]>([]);
  const [medSearchName, setMedSearchName] = useState('');
  const [medDosage, setMedDosage] = useState('1 Tab PO BD x 5 days');
  const [medQty, setMedQty] = useState('10');
  const [checkedServiceIds, setCheckedServiceIds] = useState<string[]>([]);
  const [invSearch, setInvSearch] = useState('');

  useEffect(() => {
    if (!selectedVisit) return;
    setDocBp(selectedVisit.vitals?.bp || '');
    setDocPulse(selectedVisit.vitals?.pulseBpm ? String(selectedVisit.vitals.pulseBpm) : '');
    setDocTemp(selectedVisit.vitals?.tempF ? String(selectedVisit.vitals.tempF) : '');
    setDocSpo2(selectedVisit.vitals?.spo2Pct ? String(selectedVisit.vitals.spo2Pct) : '');
    setDocWeight(selectedVisit.vitals?.weightKg ? String(selectedVisit.vitals.weightKg) : '');
    setChiefComplaint(selectedVisit.chiefComplaint || '');
    setClinicalNotes(selectedVisit.clinicalNotes || '');
    setProvisionalDiagnosis(selectedVisit.provisionalDiagnosis || '');
    setFollowUpAdvice(selectedVisit.followUpAdvice || '');
    setDisposition(selectedVisit.disposition || 'In Consultation');
    setPrescribedMeds(selectedVisit.prescribedMedicines || []);
    setCheckedServiceIds([]);
  }, [selectedVisit?.id]);

  const patientOrders = useMemo(() => {
    if (!selectedVisit) return [];
    return db.orders.filter(
      (o) =>
        (selectedVisit.uhid && o.uhid === selectedVisit.uhid) ||
        (selectedVisit.patientId && o.patientId === selectedVisit.patientId) ||
        o.patientName.toLowerCase() === selectedVisit.patientName.toLowerCase()
    );
  }, [db.orders, selectedVisit]);

  const addPrescriptionLine = () => {
    if (!medSearchName.trim()) return;
    const matchedMed = (db.pharmacyMedicines || []).find(
      (m) =>
        m.brandName.toLowerCase() === medSearchName.trim().toLowerCase() ||
        `${m.brandName} (${m.strength})`.toLowerCase() === medSearchName.trim().toLowerCase()
    );
    const qty = Math.max(1, Number(medQty) || 1);
    const unitPrice = matchedMed?.defaultMrpNpr || 0;
    const item: ClinicalUsedMedicineItem = {
      id: `rx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      administeredAt: new Date().toISOString(),
      medicineId: matchedMed?.id,
      medicineName: matchedMed ? `${matchedMed.brandName} (${matchedMed.strength})` : medSearchName.trim(),
      genericName: matchedMed?.genericName,
      dosageRoute: medDosage.trim() || '1 Tab PO BD',
      quantity: qty,
      unitPriceNpr: unitPrice,
      totalPriceNpr: qty * unitPrice,
      administeredBy: activeUser.fullName,
    };
    setPrescribedMeds((prev) => [...prev, item]);
    setMedSearchName('');
  };

  const handleSaveDoctorChart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/opd/visits/${selectedVisit.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vitals: {
            bp: docBp || undefined,
            pulseBpm: docPulse ? Number(docPulse) : undefined,
            tempF: docTemp ? Number(docTemp) : undefined,
            spo2Pct: docSpo2 ? Number(docSpo2) : undefined,
            weightKg: docWeight ? Number(docWeight) : undefined,
          },
          chiefComplaint,
          clinicalNotes,
          provisionalDiagnosis,
          followUpAdvice,
          disposition,
          prescribedMedicines: prescribedMeds,
          createDiagnosticOrder: checkedServiceIds.length > 0,
          orderServiceIds: checkedServiceIds,
          recordedBy: activeUser.fullName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save doctor consultation chart');
      setBanner({
        type: 'ok',
        text:
          checkedServiceIds.length > 0
            ? `Saved consultation for ${selectedVisit.patientName} and generated diagnostic order for ${checkedServiceIds.length} investigation(s).`
            : `Updated clinical history, Rx & disposition for ${selectedVisit.patientName}.`,
      });
      setCheckedServiceIds([]);
      await onUpdated();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setBusy(false);
    }
  };

  // ================= NURSE STATION STATE =================
  const activeAdmissions = useMemo(
    () => (db.ipdAdmissions || []).filter((a) => a.disposition === 'Admitted'),
    [db.ipdAdmissions]
  );
  const erObsCases = useMemo(
    () => (db.emergencyCases || []).filter((e) => e.disposition === 'Under Observation (ER)'),
    [db.emergencyCases]
  );
  const [selectedIpdId, setSelectedIpdId] = useState<string>(activeAdmissions[0]?.id || '');
  const selectedAdm: IpdAdmission | undefined =
    activeAdmissions.find((a) => a.id === selectedIpdId) || activeAdmissions[0];

  const [shift, setShift] = useState<'Morning' | 'Afternoon' | 'Night'>('Morning');
  const [nBp, setNBp] = useState('120/80');
  const [nPulse, setNPulse] = useState('78');
  const [nTemp, setNTemp] = useState('98.4');
  const [nSpo2, setNSpo2] = useState('98');
  const [nResp, setNResp] = useState('18');
  const [nPain, setNPain] = useState('2');
  const [nGcs, setNGcs] = useState('15/15');
  const [intakeOral, setIntakeOral] = useState('250');
  const [intakeIv, setIntakeIv] = useState('500');
  const [outputUrine, setOutputUrine] = useState('450');
  const [outputDrain, setOutputDrain] = useState('0');
  const [nursingCareNote, setNursingCareNote] = useState('');

  const [marMed, setMarMed] = useState('');
  const [marDose, setMarDose] = useState('1g IV BD');
  const [marStatus, setMarStatus] = useState<'Given' | 'Held' | 'Refused'>('Given');
  const [marNote, setMarNote] = useState('');
  const [printNursingChartAdm, setPrintNursingChartAdm] = useState<IpdAdmission | null>(null);

  // ================= QUICK ROUND NOTE MODAL STATE =================
  const [quickRoundTarget, setQuickRoundTarget] = useState<{
    encounterType: 'IPD' | 'OPD' | 'ER';
    encounterId: string;
    patientName: string;
    refCode: string;
    subtitle: string;
  } | null>(null);
  const [qrShift, setQrShift] = useState<'Morning' | 'Afternoon' | 'Night'>('Morning');
  const [qrBp, setQrBp] = useState('120/80');
  const [qrPulse, setQrPulse] = useState('80');
  const [qrTemp, setQrTemp] = useState('98.6');
  const [qrSpo2, setQrSpo2] = useState('98');
  const [qrResp, setQrResp] = useState('18');
  const [qrMedNote, setQrMedNote] = useState('');
  const [qrAutoFlagDoctor, setQrAutoFlagDoctor] = useState(true);
  const [qrSaving, setQrSaving] = useState(false);

  const openQuickRoundModal = (target: {
    encounterType: 'IPD' | 'OPD' | 'ER';
    encounterId: string;
    patientName: string;
    refCode: string;
    subtitle: string;
    vitals?: { bp?: string; pulseBpm?: number; tempF?: number; spo2Pct?: number; respRate?: number };
  }) => {
    setQuickRoundTarget({
      encounterType: target.encounterType,
      encounterId: target.encounterId,
      patientName: target.patientName,
      refCode: target.refCode,
      subtitle: target.subtitle,
    });
    setQrBp(target.vitals?.bp || '120/80');
    setQrPulse(target.vitals?.pulseBpm !== undefined ? String(target.vitals.pulseBpm) : '80');
    setQrTemp(target.vitals?.tempF !== undefined ? String(target.vitals.tempF) : '98.6');
    setQrSpo2(target.vitals?.spo2Pct !== undefined ? String(target.vitals.spo2Pct) : '98');
    setQrResp(target.vitals?.respRate !== undefined ? String(target.vitals.respRate) : '18');
    setQrMedNote('');
    setQrAutoFlagDoctor(true);
  };

  const qrAbnormalReasons = useMemo(
    () =>
      detectAbnormalVitals({
        bp: qrBp,
        pulseBpm: qrPulse ? Number(qrPulse) : undefined,
        tempF: qrTemp ? Number(qrTemp) : undefined,
        spo2Pct: qrSpo2 ? Number(qrSpo2) : undefined,
        respRate: qrResp ? Number(qrResp) : undefined,
      }),
    [qrBp, qrPulse, qrTemp, qrSpo2, qrResp]
  );

  const handleSubmitQuickRoundNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickRoundTarget || !qrMedNote.trim()) return;
    setQrSaving(true);
    setBanner(null);
    try {
      const resp = await apiRequest<{
        isAbnormal: boolean;
        doctorFlagged: boolean;
        abnormalReasons: string[];
        db: LimsDatabase;
      }>('/api/clinical/quick-round-note', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          encounterType: quickRoundTarget.encounterType,
          encounterId: quickRoundTarget.encounterId,
          shift: qrShift,
          bp: qrBp.trim() || undefined,
          pulseBpm: qrPulse ? Number(qrPulse) : undefined,
          tempF: qrTemp ? Number(qrTemp) : undefined,
          spo2Pct: qrSpo2 ? Number(qrSpo2) : undefined,
          respRate: qrResp ? Number(qrResp) : undefined,
          medicationNote: qrMedNote.trim(),
          autoFlagAbnormalDoctor: qrAutoFlagDoctor,
        }),
      });
      const targetName = quickRoundTarget.patientName;
      setQuickRoundTarget(null);
      setBanner({
        type: 'ok',
        text: resp.doctorFlagged
          ? `Quick Round Note saved for ${targetName} — URGENT DOCTOR ALERT flagged (${resp.abnormalReasons.join(', ')}).`
          : `Saved Quick Round Note & vitals for ${targetName}.`,
      });
      await onUpdated();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save Quick Round Note.' });
    } finally {
      setQrSaving(false);
    }
  };

  const handleLogNursingChart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/ipd/admissions/${selectedAdm.id}/nursing-chart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shift,
          bp: nBp,
          pulseBpm: Number(nPulse) || undefined,
          tempF: Number(nTemp) || undefined,
          spo2Pct: Number(nSpo2) || undefined,
          respRate: Number(nResp) || undefined,
          painScore: Number(nPain) || 0,
          gcsScore: nGcs,
          intakeOralMl: Number(intakeOral) || 0,
          intakeIvMl: Number(intakeIv) || 0,
          outputUrineMl: Number(outputUrine) || 0,
          outputDrainMl: Number(outputDrain) || 0,
          nursingCareNote: nursingCareNote.trim() || 'Routine ward round & vitals checked',
          recordedBy: activeUser.fullName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to log nursing chart');
      setBanner({
        type: 'ok',
        text: `Logged bedside nursing vitals & I/O balance for ${selectedAdm.patientName} (${selectedAdm.currentBedLabel}).`,
      });
      setNursingCareNote('');
      await onUpdated();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'Nursing log error' });
    } finally {
      setBusy(false);
    }
  };

  const handleLogMar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !marMed.trim()) return;
    setBusy(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/ipd/admissions/${selectedAdm.id}/mar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medicineName: marMed.trim(),
          doseRoute: marDose.trim() || 'PO',
          status: marStatus,
          note: marNote.trim(),
          givenBy: activeUser.fullName,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record MAR');
      setBanner({
        type: 'ok',
        text: `MAR recorded (${marStatus}): ${marMed.trim()} for ${selectedAdm.patientName}.`,
      });
      setMarMed('');
      setMarNote('');
      await onUpdated();
    } catch (err) {
      setBanner({ type: 'err', text: err instanceof Error ? err.message : 'MAR error' });
    } finally {
      setBusy(false);
    }
  };

  const filteredServices = useMemo(() => {
    const q = invSearch.trim().toLowerCase();
    return db.services.filter(
      (s) => s.active && (!q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
    );
  }, [db.services, invSearch]);

  const canUseDoctor = hasPerm('doctor.view') || hasPerm('hospital.clinical') || activeUser.roleId === 'SUPER_ADMIN';
  const canUseNurse = hasPerm('nursing.view') || hasPerm('hospital.clinical') || activeUser.roleId === 'SUPER_ADMIN';

  return (
    <div className="space-y-4">
      {/* Header & Role Switcher */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {mode === 'DOCTOR' ? 'Doctor Clinical Consultation & Investigations Portal' : 'Nursing Station, TPR Flowsheet & MAR Portal'}
          </h2>
          <p className="text-xs text-slate-500">
            {mode === 'DOCTOR'
              ? 'Capture patient history, vitals, provisional diagnosis, medicines (Rx), diagnostic requests & review abnormal/high-risk lab reports.'
              : 'Bedside vitals (TPR/BP/SpO₂), Intake-Output fluid chart, Medication Administration Record (MAR) & ER observation queue.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canUseDoctor && (
            <button
              type="button"
              onClick={() => setMode('DOCTOR')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${
                mode === 'DOCTOR'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Stethoscope className="w-3.5 h-3.5" />
              Doctor Portal
            </button>
          )}
          {canUseNurse && (
            <button
              type="button"
              onClick={() => setMode('NURSE')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${
                mode === 'NURSE'
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <HeartPulse className="w-3.5 h-3.5" />
              Nursing App &amp; MAR
            </button>
          )}
        </div>
      </div>

      {banner && (
        <div
          className={`px-4 py-2.5 rounded-lg border text-xs flex items-center gap-2 ${
            banner.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {banner.type === 'ok' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {/* ================= DOCTOR MODE ================= */}
      {mode === 'DOCTOR' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Queue */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-3 space-y-3 h-fit">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                OPD Consultation Queue ({opdQueue.length})
              </div>
            </div>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
              <input
                type="text"
                value={opdSearch}
                onChange={(e) => setOpdSearch(e.target.value)}
                placeholder="Search Token, UHID, Patient..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <div className="divide-y divide-slate-100 max-h-[540px] overflow-y-auto">
              {opdQueue.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-400">No matching OPD visits.</div>
              ) : (
                opdQueue.map((v) => {
                  const active = v.id === selectedVisit?.id;
                  return (
                    <div
                      key={v.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedVisitId(v.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedVisitId(v.id);
                        }
                      }}
                      className={`w-full text-left p-2.5 rounded-lg transition-colors cursor-pointer ${
                        active ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="font-semibold text-blue-700">{v.tokenNumber}</span>
                        <span className="text-slate-500">{v.uhid || '—'}</span>
                      </div>
                      <div className="text-xs font-semibold text-slate-900 mt-0.5">{v.patientName}</div>
                      <div className="text-[11px] text-slate-500">
                        {v.patientAge} {v.patientAgeType} / {v.patientGender} · {v.department}
                      </div>
                      <div className="text-[10.5px] text-slate-600 mt-0.5 truncate">
                        {v.chiefComplaint || 'Awaiting clinical assessment'} ·{' '}
                        <span className="font-medium text-slate-800">{v.disposition}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openQuickRoundModal({
                              encounterType: 'OPD',
                              encounterId: v.id,
                              patientName: v.patientName,
                              refCode: v.tokenNumber,
                              subtitle: `${v.department} · ${v.consultingDoctor}`,
                              vitals: v.vitals,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100"
                        >
                          <Activity className="w-3 h-3" />
                          Quick Round Note
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Clinical Chart */}
          <div className="lg:col-span-8 space-y-4">
            {!selectedVisit ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
                Select an OPD visit from the left queue to open clinical history &amp; investigation workbench.
              </div>
            ) : (
              <>
                <form onSubmit={handleSaveDoctorChart} className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-2 pb-3 border-b border-slate-200">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-900">{selectedVisit.patientName}</span>
                        <span className="font-mono text-xs text-blue-700">{selectedVisit.tokenNumber}</span>
                        {selectedVisit.uhid && (
                          <span className="font-mono text-xs text-slate-600">{selectedVisit.uhid}</span>
                        )}
                        <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-800 text-[10px] font-semibold">
                          Duty Shift: {activeUser.shift || 'Morning'} · {activeUser.fullName}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {selectedVisit.patientAge} {selectedVisit.patientAgeType} / {selectedVisit.patientGender} ·{' '}
                        {selectedVisit.patientAddress} · Dr: {selectedVisit.consultingDoctor}
                      </div>
                    </div>
                    <select
                      value={disposition}
                      onChange={(e) => setDisposition(e.target.value as OpdDispositionType)}
                      className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-medium"
                    >
                      <option value="Waiting">Waiting</option>
                      <option value="In Consultation">In Consultation</option>
                      <option value="Discharged Home">Discharged Home</option>
                      <option value="Admitted to IPD">Admitted to IPD</option>
                      <option value="Referred to External Hospital">Referred to External Hospital</option>
                    </select>
                  </div>

                  {/* Vitals */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <label className="text-[11px] text-slate-600">
                      BP (mmHg)
                      <input
                        type="text"
                        value={docBp}
                        onChange={(e) => setDocBp(e.target.value)}
                        placeholder="120/80"
                        className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Pulse (bpm)
                      <input
                        type="number"
                        value={docPulse}
                        onChange={(e) => setDocPulse(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Temp (°F)
                      <input
                        type="number"
                        step="0.1"
                        value={docTemp}
                        onChange={(e) => setDocTemp(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600">
                      SpO₂ (%)
                      <input
                        type="number"
                        value={docSpo2}
                        onChange={(e) => setDocSpo2(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                      />
                    </label>
                    <label className="text-[11px] text-slate-600">
                      Weight (kg)
                      <input
                        type="number"
                        step="0.1"
                        value={docWeight}
                        onChange={(e) => setDocWeight(e.target.value)}
                        className="mt-1 w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg font-mono"
                      />
                    </label>
                  </div>

                  {/* Clinical History & Diagnosis */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-xs font-medium text-slate-700">
                      Chief Complaint &amp; Presenting History
                      <textarea
                        rows={2}
                        value={chiefComplaint}
                        onChange={(e) => setChiefComplaint(e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-700">
                      History, Past Illnesses &amp; Physical Examination
                      <textarea
                        rows={2}
                        value={clinicalNotes}
                        onChange={(e) => setClinicalNotes(e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-700">
                      Provisional / Working Diagnosis
                      <input
                        type="text"
                        value={provisionalDiagnosis}
                        onChange={(e) => setProvisionalDiagnosis(e.target.value)}
                        className="mt-1 w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-700">
                      Follow-Up &amp; Clinical Advice
                      <input
                        type="text"
                        value={followUpAdvice}
                        onChange={(e) => setFollowUpAdvice(e.target.value)}
                        placeholder={`Free follow-up valid for ${db.settings.moduleSettings?.opdFreeFollowUpDays ?? 7} days`}
                        className="mt-1 w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                      />
                    </label>
                  </div>

                  {/* Prescription Builder */}
                  <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50/50">
                    <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                      <Pill className="w-3.5 h-3.5 text-blue-600" />
                      Prescription (Rx) Medicines ({prescribedMeds.length})
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <div className="sm:col-span-5">
                        <input
                          type="text"
                          list="doc-rx-meds"
                          value={medSearchName}
                          onChange={(e) => setMedSearchName(e.target.value)}
                          placeholder="Medicine name..."
                          className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                        />
                        <datalist id="doc-rx-meds">
                          {(db.pharmacyMedicines || []).map((m) => (
                            <option key={m.id} value={`${m.brandName} (${m.strength})`} />
                          ))}
                        </datalist>
                      </div>
                      <input
                        type="text"
                        value={medDosage}
                        onChange={(e) => setMedDosage(e.target.value)}
                        placeholder="Dosage / Freq / Days"
                        className="sm:col-span-4 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                      />
                      <input
                        type="number"
                        min={1}
                        value={medQty}
                        onChange={(e) => setMedQty(e.target.value)}
                        className="sm:col-span-1 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={addPrescriptionLine}
                        className="sm:col-span-2 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add Rx
                      </button>
                    </div>
                    {prescribedMeds.length > 0 && (
                      <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
                        {prescribedMeds.map((m) => (
                          <div key={m.id} className="px-3 py-1.5 flex items-center justify-between text-xs">
                            <div>
                              <span className="font-medium text-slate-900">{m.medicineName}</span>
                              <span className="text-slate-500 ml-2">{m.dosageRoute}</span>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="font-mono text-slate-700">Qty: {m.quantity}</span>
                              <button
                                type="button"
                                onClick={() => setPrescribedMeds((prev) => prev.filter((x) => x.id !== m.id))}
                                className="text-slate-400 hover:text-rose-600"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Advised Lab / Radiology Investigations */}
                  <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <FlaskConical className="w-3.5 h-3.5 text-indigo-600" />
                        Order Investigations (Linked to {selectedVisit.uhid || selectedVisit.tokenNumber})
                      </div>
                      <input
                        type="text"
                        value={invSearch}
                        onChange={(e) => setInvSearch(e.target.value)}
                        placeholder="Filter lab / X-Ray / USG tests..."
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg w-56"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-40 overflow-y-auto">
                      {filteredServices.map((srv) => {
                        const checked = checkedServiceIds.includes(srv.id);
                        return (
                          <label
                            key={srv.id}
                            className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded border text-[11px] cursor-pointer ${
                              checked ? 'bg-indigo-50 border-indigo-300 text-indigo-900' : 'bg-white border-slate-200 text-slate-700'
                            }`}
                          >
                            <span className="flex items-center gap-1.5 truncate">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setCheckedServiceIds((prev) =>
                                    e.target.checked ? [...prev, srv.id] : prev.filter((id) => id !== srv.id)
                                  )
                                }
                              />
                              <span className="truncate">{srv.name}</span>
                            </span>
                            <span className="font-mono text-[10px] shrink-0">{formatNpr(srv.price)}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex justify-end pt-1">
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        <ClipboardList className="w-3.5 h-3.5" />
                        {checkedServiceIds.length > 0
                          ? `Save Consultation & Order ${checkedServiceIds.length} Investigation(s)`
                          : 'Save Clinical History & Prescription'}
                      </button>
                    </div>
                  </div>
                </form>

                {/* Patient Investigation & Lab/Radiology Report Viewer */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-slate-600" />
                    Patient Diagnostic History &amp; Verified Reports ({patientOrders.length})
                  </div>
                  {patientOrders.length === 0 ? (
                    <div className="text-xs text-slate-500 py-3">No pathology or radiology orders logged for this patient yet.</div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {patientOrders.map((ord) => {
                        const flags = ord.tests.flatMap((it) => it.parameterResults.map((p) => p.flag));
                        const hasHighRisk = flags.some((f) => f === 'HIGH_RISK' || f === 'CRITICAL_HIGH' || f === 'CRITICAL_LOW' || f === 'CRITICAL');
                        const hasAbnormal = flags.some((f) => f === 'ABNORMAL' || f === 'HIGH' || f === 'LOW');
                        return (
                          <div key={ord.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-semibold text-slate-900">{ord.accessionNumber}</span>
                                <span className="text-slate-600">{ord.status}</span>
                                {hasHighRisk && (
                                  <span className="text-[11px] font-semibold text-rose-700">· HIGH RISK / CRITICAL</span>
                                )}
                                {!hasHighRisk && hasAbnormal && (
                                  <span className="text-[11px] font-semibold text-amber-700">· ABNORMAL RESULT</span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {ord.tests.map((i) => i.serviceName).join(', ')} · {adToBs(ord.orderedAt).formattedEn}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => onOpenReport(ord)}
                              className="px-2.5 py-1 text-xs font-medium text-blue-700 border border-blue-200 bg-blue-50 rounded-lg hover:bg-blue-100"
                            >
                              View / Print Report
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ================= NURSE MODE ================= */}
      {mode === 'NURSE' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Queue: Active IPD + ER Obs */}
          <div className="lg:col-span-4 space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="text-xs font-semibold text-slate-800 uppercase tracking-wide">
                Active Admitted Patients ({activeAdmissions.length})
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {activeAdmissions.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">No active IPD admissions.</div>
                ) : (
                  activeAdmissions.map((adm) => {
                    const active = adm.id === selectedAdm?.id;
                    const latestNc = (adm.nursingCharts || [])[0];
                    return (
                      <div
                        key={adm.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedIpdId(adm.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelectedIpdId(adm.id);
                          }
                        }}
                        className={`w-full text-left p-2.5 rounded-lg cursor-pointer ${
                          active ? 'bg-blue-50 border border-blue-200' : 'hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px] font-mono">
                          <span className="font-semibold text-blue-700">{adm.currentBedLabel}</span>
                          <span className="text-slate-500">{adm.admissionNumber}</span>
                        </div>
                        <div className="text-xs font-semibold text-slate-900 mt-0.5">{adm.patientName}</div>
                        <div className="text-[11px] text-slate-500">
                          {adm.currentWardName} · {adm.uhid || '—'} · Dr. {adm.admittingDoctor}
                        </div>
                        <div className="mt-2 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openQuickRoundModal({
                                encounterType: 'IPD',
                                encounterId: adm.id,
                                patientName: adm.patientName,
                                refCode: adm.admissionNumber,
                                subtitle: `Bed ${adm.currentBedLabel} · ${adm.currentWardName}`,
                                vitals: latestNc || adm.vitalsOnAdmission,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100"
                          >
                            <Activity className="w-3 h-3" />
                            Quick Round Note
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="text-xs font-semibold text-rose-800 uppercase tracking-wide">
                Emergency Observation Bays ({erObsCases.length})
              </div>
              {erObsCases.length === 0 ? (
                <div className="py-4 text-center text-xs text-slate-400">No ER patients currently under observation.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {erObsCases.map((er: EmergencyCase) => (
                    <div key={er.id} className="py-2 text-xs">
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="font-semibold text-rose-700">{er.erNumber}</span>
                        <span className="text-slate-600">{er.erBedBay}</span>
                      </div>
                      <div className="font-medium text-slate-900">{er.patientName}</div>
                      <div className="text-[11px] text-slate-500">
                        {er.triageLevel} · {er.chiefComplaint}
                      </div>
                      <div className="mt-1.5 flex items-center justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            openQuickRoundModal({
                              encounterType: 'ER',
                              encounterId: er.id,
                              patientName: er.patientName,
                              refCode: er.erNumber,
                              subtitle: `${er.erBedBay} · ${er.triageLevel}`,
                              vitals: er.vitals,
                            })
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10.5px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100"
                        >
                          <Activity className="w-3 h-3" />
                          Quick Round Note
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Bedside Chart + MAR */}
          <div className="lg:col-span-8 space-y-4">
            {!selectedAdm ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
                Select an admitted IPD patient to log Nursing Vitals, I/O chart, or MAR doses.
              </div>
            ) : (
              <>
                <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">{selectedAdm.patientName}</span>
                      <span className="font-mono text-xs text-blue-700">{selectedAdm.admissionNumber}</span>
                      <span className="font-mono text-xs text-slate-600">{selectedAdm.currentBedLabel}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {selectedAdm.currentWardName} · Dx: {selectedAdm.admittingDiagnosis} · Dr: {selectedAdm.admittingDoctor}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPrintNursingChartAdm(selectedAdm)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print Nursing Flowsheet
                  </button>
                </div>

                {/* Nursing Vitals & Intake/Output Entry */}
                <form onSubmit={handleLogNursingChart} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                      <Activity className="w-3.5 h-3.5 text-blue-600" />
                      Log Bedside TPR / BP &amp; Intake-Output Chart
                    </div>
                    <div className="flex items-center gap-2">
                      {db.settings?.moduleSettings?.shiftPricing?.nursing && (
                        <span className="text-[11px] font-mono text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
                          Shift Rate:{' '}
                          {formatNpr(
                            shift === 'Morning'
                              ? db.settings.moduleSettings.shiftPricing.nursing.Morning
                              : shift === 'Afternoon'
                              ? db.settings.moduleSettings.shiftPricing.nursing.Afternoon
                              : db.settings.moduleSettings.shiftPricing.nursing.Night
                          )}
                        </span>
                      )}
                      <select
                        value={shift}
                        onChange={(e) => setShift(e.target.value as 'Morning' | 'Afternoon' | 'Night')}
                        className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="Morning">Morning Shift</option>
                        <option value="Afternoon">Afternoon Shift</option>
                        <option value="Night">Night Shift</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-[11px]">
                    <label className="text-slate-600">
                      BP (mmHg)
                      <input type="text" value={nBp} onChange={(e) => setNBp(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      Pulse
                      <input type="number" value={nPulse} onChange={(e) => setNPulse(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      Temp (°F)
                      <input type="number" step="0.1" value={nTemp} onChange={(e) => setNTemp(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      SpO₂ (%)
                      <input type="number" value={nSpo2} onChange={(e) => setNSpo2(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      RR (/min)
                      <input type="number" value={nResp} onChange={(e) => setNResp(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      GCS / Pain
                      <input type="text" value={nGcs} onChange={(e) => setNGcs(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[11px]">
                    <label className="text-slate-600">
                      Pain (0-10)
                      <input type="number" min={0} max={10} value={nPain} onChange={(e) => setNPain(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      Oral In (mL)
                      <input type="number" value={intakeOral} onChange={(e) => setIntakeOral(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      IV Fluid (mL)
                      <input type="number" value={intakeIv} onChange={(e) => setIntakeIv(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      Urine Out (mL)
                      <input type="number" value={outputUrine} onChange={(e) => setOutputUrine(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                    <label className="text-slate-600">
                      Drain Out (mL)
                      <input type="number" value={outputDrain} onChange={(e) => setOutputDrain(e.target.value)} className="mt-1 w-full px-2 py-1.5 text-xs border border-slate-300 rounded-lg font-mono" />
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={nursingCareNote}
                      onChange={(e) => setNursingCareNote(e.target.value)}
                      placeholder="Nursing intervention, cannula check, dressing / wound note..."
                      className="flex-1 px-3 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      Save Nursing Entry
                    </button>
                  </div>
                </form>

                {/* Medication Administration Record (MAR) */}
                <form onSubmit={handleLogMar} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                    <Pill className="w-3.5 h-3.5 text-emerald-600" />
                    Medication Administration Record (MAR)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <input
                      type="text"
                      list="nurse-mar-meds"
                      value={marMed}
                      onChange={(e) => setMarMed(e.target.value)}
                      placeholder="Medicine administered..."
                      required
                      className="sm:col-span-4 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <datalist id="nurse-mar-meds">
                      {(db.pharmacyMedicines || []).map((m) => (
                        <option key={m.id} value={`${m.brandName} (${m.strength})`} />
                      ))}
                    </datalist>
                    <input
                      type="text"
                      value={marDose}
                      onChange={(e) => setMarDose(e.target.value)}
                      placeholder="Dose & route"
                      className="sm:col-span-3 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <select
                      value={marStatus}
                      onChange={(e) => setMarStatus(e.target.value as 'Given' | 'Held' | 'Refused')}
                      className="sm:col-span-2 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Given">Given</option>
                      <option value="Held">Held</option>
                      <option value="Refused">Refused</option>
                    </select>
                    <input
                      type="text"
                      value={marNote}
                      onChange={(e) => setMarNote(e.target.value)}
                      placeholder="Note"
                      className="sm:col-span-2 px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
                    />
                    <button
                      type="submit"
                      disabled={busy}
                      className="sm:col-span-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Log
                    </button>
                  </div>

                  {/* Recent Nursing Charts + MAR History */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-700 mb-1">
                        Recent MAR Doses ({(selectedAdm.marRecords || []).length})
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto text-[11px]">
                        {(selectedAdm.marRecords || []).slice(0, 6).map((m) => (
                          <div key={m.id} className="p-2 bg-slate-50 border border-slate-200 rounded flex justify-between gap-2">
                            <div>
                              <div className="font-medium text-slate-900">{m.medicineName}</div>
                              <div className="text-slate-500">{m.doseRoute} · {m.givenBy}</div>
                            </div>
                            <span className="font-mono font-semibold text-slate-700 shrink-0">{m.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-slate-700 mb-1">
                        Recent Nursing Chart Entries ({(selectedAdm.nursingCharts || []).length})
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto text-[11px]">
                        {(selectedAdm.nursingCharts || []).slice(0, 6).map((nc) => (
                          <div key={nc.id} className="p-2 bg-slate-50 border border-slate-200 rounded">
                            <div className="flex justify-between font-mono text-slate-700">
                              <span>{nc.shift} Shift · BP {nc.bp || '—'} · SpO₂ {nc.spo2Pct || '—'}%</span>
                              <span>{adToBs(nc.recordedAt).timeEn}</span>
                            </div>
                            <div className="text-[10px] text-slate-500">By: {nc.recordedBy}</div>
                            <div className="text-slate-600 truncate">{nc.nursingCareNote}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {printNursingChartAdm && (
        <NursingChartPrintModal
          admission={printNursingChartAdm}
          settings={db.settings}
          onClose={() => setPrintNursingChartAdm(null)}
        />
      )}

      {/* QUICK ROUND NOTE + RAPID VITALS & ABNORMAL DOCTOR FLAG MODAL */}
      {quickRoundTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setQuickRoundTarget(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  Quick Round Note — {quickRoundTarget.patientName}
                </h3>
                <p className="text-[11px] font-mono text-slate-500">
                  {quickRoundTarget.encounterType} · {quickRoundTarget.refCode} · {quickRoundTarget.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQuickRoundTarget(null)}
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitQuickRoundNote} className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Shift</label>
                  <select
                    value={qrShift}
                    onChange={(e) => setQrShift(e.target.value as 'Morning' | 'Afternoon' | 'Night')}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Morning">Morning</option>
                    <option value="Afternoon">Afternoon</option>
                    <option value="Night">Night</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">BP (mmHg)</label>
                  <input
                    value={qrBp}
                    onChange={(e) => setQrBp(e.target.value)}
                    placeholder="120/80"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pulse (bpm)</label>
                  <input
                    type="number"
                    value={qrPulse}
                    onChange={(e) => setQrPulse(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Temp (°F)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={qrTemp}
                    onChange={(e) => setQrTemp(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">SpO₂ (%)</label>
                  <input
                    type="number"
                    value={qrSpo2}
                    onChange={(e) => setQrSpo2(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">RR (/min)</label>
                  <input
                    type="number"
                    value={qrResp}
                    onChange={(e) => setQrResp(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {qrAbnormalReasons.length > 0 && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="text-[11px]">
                    <div className="font-bold">Abnormal Vital Readings Detected:</div>
                    <div className="font-mono mt-0.5">{qrAbnormalReasons.join(' · ')}</div>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Clinical Observation &amp; Medication Round Note *
                </label>
                <textarea
                  rows={3}
                  required
                  value={qrMedNote}
                  onChange={(e) => setQrMedNote(e.target.value)}
                  placeholder="Enter bedside vitals interpretation, IV fluids/medications given, or pain/symptom changes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-indigo-500"
                />
              </div>

              <label className="flex items-start gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={qrAutoFlagDoctor}
                  onChange={(e) => setQrAutoFlagDoctor(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-rose-600"
                />
                <div className="text-[11px]">
                  <span className="font-semibold text-slate-800">
                    Auto-flag abnormal readings for immediate doctor notification
                  </span>
                  <div className="text-slate-500">
                    Automatically alerts the duty physician across clinical banners when BP (≥140/90 or ≤90/60), PR (&gt;110 or &lt;55), Temp (≥100.4°F), SpO₂ (&lt;94%), or RR (&gt;24) is out of range.
                  </div>
                </div>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setQuickRoundTarget(null)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={qrSaving || !qrMedNote.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {qrSaving ? 'Saving Round Note...' : 'Save Quick Round Note'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
