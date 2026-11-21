import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  HeartPulse,
  Lock,
  Plus,
  Printer,
  Scissors,
  Search,
  ShieldAlert,
  Stethoscope,
  Syringe,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AnesthesiaAgentDose,
  AnesthesiaAirwayLog,
  AnesthesiaVitalPoint,
  EncounterType,
  LimsDatabase,
  OtAnesthesiaRecord,
  OtSurgeryCase,
  PatientGender,
  PermissionKey,
  PreOpSafetyChecklist,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { detectPatientEncounter } from '../utils/patientEncounter';
import { executeSmartPrint } from '../utils/printHelper';
import { getPrintHeaderTitle, sanitizePrintText } from '../utils/printSanitizer';
import { normalizeNepalPhone, stripCountryPrefixForEdit } from '../utils/textFormat';

interface OtManagementViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
}

const NEPAL_OT_ANESTHESIA_AGENTS: Array<{
  name: string;
  category: AnesthesiaAgentDose['category'];
  defaultDose: string;
  unit: string;
  route: string;
}> = [
  { name: 'Propofol 1% Emulsion', category: 'Induction', defaultDose: '120', unit: 'mg', route: 'IV Bolus' },
  { name: 'Ketamine HCl', category: 'Induction', defaultDose: '50', unit: 'mg', route: 'IV' },
  { name: 'Fentanyl Citrate', category: 'Analgesic', defaultDose: '100', unit: 'mcg', route: 'IV' },
  { name: 'Midazolam', category: 'Induction', defaultDose: '2', unit: 'mg', route: 'IV' },
  { name: 'Succinylcholine', category: 'Muscle Relaxant', defaultDose: '75', unit: 'mg', route: 'IV Rapid Seq' },
  { name: 'Vecuronium Bromide', category: 'Muscle Relaxant', defaultDose: '6', unit: 'mg', route: 'IV' },
  { name: 'Bupivacaine 0.5% Heavy', category: 'Local / Neuraxial', defaultDose: '12.5', unit: 'mg (2.5 mL)', route: 'Intrathecal' },
  { name: 'Sevoflurane', category: 'Volatile / Gas', defaultDose: '1.5 - 2.0', unit: 'MAC %', route: 'Inhalational' },
  { name: 'Atropine + Neostigmine', category: 'Reversal / Emergency', defaultDose: '0.5 + 2.5', unit: 'mg', route: 'IV Reversal' },
];

export function OtManagementView({ db, activeUser, hasPerm, onUpdated }: OtManagementViewProps) {
  const canManage = hasPerm('ot.manage');
  const canAnesthesia = hasPerm('ot.anesthesia') || canManage || hasPerm('hospital.clinical');

  const otRooms = db.otRooms || [];
  const otCases = db.otCases || [];

  const [statusFilter, setStatusFilter] = useState<'ALL' | OtSurgeryCase['status']>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCaseId, setSelectedCaseId] = useState<string>(otCases[0]?.id || '');
  const [workspaceTab, setWorkspaceTab] = useState<'overview' | 'checklist' | 'anesthesia' | 'pacu'>('overview');
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Schedule Surgery Modal
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [schPatientId, setSchPatientId] = useState('');
  const [schUhid, setSchUhid] = useState('');
  const [schEncounterType, setSchEncounterType] = useState<EncounterType>('IPD');
  const [schEncounterId, setSchEncounterId] = useState('');
  const [schPatientName, setSchPatientName] = useState('');
  const [schPatientAge, setSchPatientAge] = useState('32');
  const [schPatientGender, setSchPatientGender] = useState<PatientGender>('Female');
  const [schPatientPhone, setSchPatientPhone] = useState('');
  const [schPatientAddress, setSchPatientAddress] = useState('Bode Barsain, Saptari');
  const [schRoomId, setSchRoomId] = useState(otRooms[0]?.id || 'otroom-1');
  const [schDate, setSchDate] = useState(new Date().toISOString().slice(0, 10));
  const [schTime, setSchTime] = useState('10:30');
  const [schProcedure, setSchProcedure] = useState('');
  const [schSpecialty, setSchSpecialty] = useState('General Surgery');
  const [schPriority, setSchPriority] = useState<'Elective' | 'Emergency'>('Elective');
  const [schSurgeon, setSchSurgeon] = useState('Dr. Santosh Majhi, MD');
  const [schAnesthesiologist, setSchAnesthesiologist] = useState('Dr. R. K. Mandal, MD (Anesthesia)');
  const [schScrubNurse, setSchScrubNurse] = useState('Sr. Sunita Chaudhary');
  const [schDiagnosis, setSchDiagnosis] = useState('');
  const [schFeeNpr, setSchFeeNpr] = useState('15000');
  const [scheduling, setScheduling] = useState(false);

  // Mandatory Pre-Op Safety Checklist Modal
  const [checklistTarget, setChecklistTarget] = useState<OtSurgeryCase | null>(null);
  const [chkBp, setChkBp] = useState('120/80');
  const [chkPulse, setChkPulse] = useState('82');
  const [chkTemp, setChkTemp] = useState('98.4');
  const [chkSpo2, setChkSpo2] = useState('99');
  const [chkAsa, setChkAsa] = useState<PreOpSafetyChecklist['asaGrade']>('ASA II');
  const [chkAnesthCleared, setChkAnesthCleared] = useState(true);
  const [chkAnesthBy, setChkAnesthBy] = useState('Dr. R. K. Mandal, MD (Anesthesia)');
  const [chkSiteVerified, setChkSiteVerified] = useState(true);
  const [chkSiteMarked, setChkSiteMarked] = useState(true);
  const [chkLaterality, setChkLaterality] = useState<PreOpSafetyChecklist['laterality']>('Midline / N/A');
  const [chkProcedureVerified, setChkProcedureVerified] = useState('');
  const [chkIdentityVerified, setChkIdentityVerified] = useState(true);
  const [chkConsentVerified, setChkConsentVerified] = useState(true);
  const [chkNpoConfirmed, setChkNpoConfirmed] = useState(true);
  const [chkCrossmatch, setChkCrossmatch] = useState(true);
  const [chkSterility, setChkSterility] = useState(true);
  const [chkNotes, setChkNotes] = useState('');
  const [savingChecklist, setSavingChecklist] = useState(false);

  // Anesthesiology Sub-Module Draft
  const [anName, setAnName] = useState('');
  const [anType, setAnType] = useState<OtAnesthesiaRecord['anesthesiaType']>('General Anesthesia (GA)');
  const [airway, setAirway] = useState<AnesthesiaAirwayLog>({
    mallampatiGrade: 'Class I',
    airwayDevice: 'ETT (Endotracheal Tube)',
    tubeSize: '7.5 mm ID',
    cuffInflated: true,
    intubationAttempts: 1,
    laryngoscopeView: 'Cormack-Lehane Grade I',
    ventilatorMode: 'VCV',
    tidalVolumeMl: 450,
    fio2Pct: 50,
    airwayNotes: '',
  });
  const [agents, setAgents] = useState<AnesthesiaAgentDose[]>([]);
  const [vitalsLog, setVitalsLog] = useState<AnesthesiaVitalPoint[]>([]);
  const [ivFluidsMl, setIvFluidsMl] = useState('1000');
  const [eblMl, setEblMl] = useState('150');
  const [complicationNotes, setComplicationNotes] = useState('');
  // Quick add agent / vital row inputs
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentCat, setNewAgentCat] = useState<AnesthesiaAgentDose['category']>('Induction');
  const [newAgentDose, setNewAgentDose] = useState('');
  const [newAgentUnit, setNewAgentUnit] = useState('mg');
  const [newAgentRoute, setNewAgentRoute] = useState('IV');
  const [newAgentTime, setNewAgentTime] = useState(new Date().toTimeString().slice(0, 5));
  const [vtTime, setVtTime] = useState(new Date().toTimeString().slice(0, 5));
  const [vtBp, setVtBp] = useState('116/74');
  const [vtPulse, setVtPulse] = useState('84');
  const [vtSpo2, setVtSpo2] = useState('99');
  const [vtEtco2, setVtEtco2] = useState('35');
  const [vtResponse, setVtResponse] = useState('Hemodynamically stable, adequate depth');
  const [savingAnesthesia, setSavingAnesthesia] = useState(false);

  // Operative Note & PACU Completion state
  const [opNote, setOpNote] = useState('');
  const [consumablesNote, setConsumablesNote] = useState('');
  const [aldreteScore, setAldreteScore] = useState('9');
  const [pacuBp, setPacuBp] = useState('118/76');
  const [pacuSpo2, setPacuSpo2] = useState('99');
  const [pacuPain, setPacuPain] = useState('2');
  const [pacuDest, setPacuDest] = useState('Post-Op Surgical Ward');
  const [pacuNotes, setPacuNotes] = useState('Responsive, airway patent, vitals stable.');
  const [postChargeIpd, setPostChargeIpd] = useState(true);
  const [completingOt, setCompletingOt] = useState(false);

  // Print A4 OT Record Modal
  const [printCase, setPrintCase] = useState<OtSurgeryCase | null>(null);
  const [letterheadMode, setLetterheadMode] = useState<'with' | 'without'>(
    db.settings?.moduleSettings?.printOptions?.defaultLetterheadMode === 'without-letterhead' ? 'without' : 'with'
  );
  const printSheetRef = useRef<HTMLDivElement | null>(null);

  const selectedCase = useMemo(
    () => otCases.find((c) => c.id === selectedCaseId) || otCases[0] || null,
    [otCases, selectedCaseId]
  );

  const syncAnesthesiaDraftFromCase = (c: OtSurgeryCase) => {
    const rec = c.anesthesiaRecord;
    setAnName(rec?.anesthesiologistName || c.anesthesiologist || activeUser.fullName);
    setAnType(rec?.anesthesiaType || 'General Anesthesia (GA)');
    setAirway(
      rec?.airwayLog || {
        mallampatiGrade: 'Class I',
        airwayDevice: 'ETT (Endotracheal Tube)',
        tubeSize: '7.5 mm ID',
        cuffInflated: true,
        intubationAttempts: 1,
        laryngoscopeView: 'Cormack-Lehane Grade I',
        ventilatorMode: 'VCV',
        tidalVolumeMl: 450,
        fio2Pct: 50,
        airwayNotes: '',
      }
    );
    setAgents(rec?.agentsUsed ? [...rec.agentsUsed] : []);
    setVitalsLog(rec?.vitalsLog ? [...rec.vitalsLog] : []);
    setIvFluidsMl(String(rec?.ivFluidsGivenMl ?? 1000));
    setEblMl(String(rec?.estimatedBloodLossMl ?? 150));
    setComplicationNotes(rec?.complicationNotes || '');
    setOpNote(c.operativeNote || '');
    setConsumablesNote(c.consumablesNotes || '');
    setAldreteScore(String(c.postOpPacu?.aldreteScore ?? 9));
    setPacuDest(c.postOpPacu?.transferredTo || 'Post-Op Surgical Ward');
    setPacuNotes(c.postOpPacu?.pacuNotes || 'Responsive, airway patent, vitals stable.');
  };

  const selectCase = (c: OtSurgeryCase) => {
    setSelectedCaseId(c.id);
    syncAnesthesiaDraftFromCase(c);
    setInlineError(null);
  };

  React.useEffect(() => {
    if (selectedCase) {
      syncAnesthesiaDraftFromCase(selectedCase);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCase?.id]);

  const filteredCases = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return otCases.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false;
      if (!q) return true;
      return `${c.otNumber} ${c.patientName} ${c.uhid || ''} ${c.procedureName} ${c.leadSurgeon} ${c.otRoomLabel}`
        .toLowerCase()
        .includes(q);
    });
  }, [otCases, statusFilter, searchTerm]);

  const caseAuditLogs = useMemo(() => {
    if (!selectedCase) return [];
    return (db.auditLogs || []).filter(
      (a) => a.module === 'OT_MANAGEMENT' && a.entityId === selectedCase.otNumber
    );
  }, [db.auditLogs, selectedCase]);

  const openChecklistModal = (c: OtSurgeryCase) => {
    const pre = c.preOpChecklist;
    setChecklistTarget(c);
    setChkBp(pre?.vitalBp || '120/80');
    setChkPulse(String(pre?.vitalPulseBpm ?? 82));
    setChkTemp(String(pre?.vitalTempF ?? 98.4));
    setChkSpo2(String(pre?.vitalSpo2Pct ?? 99));
    setChkAsa(pre?.asaGrade || 'ASA II');
    setChkAnesthCleared(pre ? pre.anesthesiaCleared : true);
    setChkAnesthBy(pre?.anesthesiaClearedBy || c.anesthesiologist || 'Dr. R. K. Mandal, MD');
    setChkSiteVerified(pre ? pre.surgicalSiteVerified : true);
    setChkSiteMarked(pre ? pre.siteMarked : true);
    setChkLaterality(pre?.laterality || 'Midline / N/A');
    setChkProcedureVerified(pre?.procedureNameVerified || c.procedureName);
    setChkIdentityVerified(pre ? pre.patientIdentityVerified : true);
    setChkConsentVerified(pre ? pre.consentSignedVerified : true);
    setChkNpoConfirmed(pre ? pre.npoConfirmed : true);
    setChkCrossmatch(pre ? pre.bloodCrossmatchChecked : true);
    setChkSterility(pre ? pre.equipmentSterilityChecked : true);
    setChkNotes(pre?.checklistNotes || '');
    setInlineError(null);
  };

  const handleScheduleCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schPatientName.trim() || !schProcedure.trim()) return;
    setScheduling(true);
    setInlineError(null);
    try {
      const resp = await apiRequest<{ otCase: OtSurgeryCase; db: LimsDatabase }>(
        '/api/ot/cases',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            patientId: schPatientId || undefined,
            uhid: schUhid || undefined,
            encounterType: schEncounterType,
            encounterId: schEncounterId || undefined,
            patientName: schPatientName.trim(),
            patientAge: Number(schPatientAge) || 32,
            patientAgeType: 'Years',
            patientGender: schPatientGender,
            patientPhone: normalizeNepalPhone(schPatientPhone),
            patientAddress: schPatientAddress.trim(),
            otRoomId: schRoomId,
            scheduledDate: schDate,
            scheduledTime: schTime,
            procedureName: schProcedure.trim(),
            surgicalSpecialty: schSpecialty,
            priority: schPriority,
            leadSurgeon: schSurgeon.trim(),
            anesthesiologist: schAnesthesiologist.trim(),
            scrubNurse: schScrubNurse.trim(),
            diagnosis: schDiagnosis.trim(),
            otFeeNpr: Number(schFeeNpr) || 0,
          }),
        }
      );
      setShowScheduleModal(false);
      setSchPatientName('');
      setSchProcedure('');
      setSchDiagnosis('');
      setSelectedCaseId(resp.otCase.id);
      onUpdated(resp.db, `Scheduled OT case ${resp.otCase.otNumber} for ${resp.otCase.patientName}.`);
    } catch (err: any) {
      setInlineError(err.message || 'Failed to schedule OT surgery.');
    } finally {
      setScheduling(false);
    }
  };

  const handleSavePreOpChecklist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!checklistTarget) return;
    setSavingChecklist(true);
    setInlineError(null);
    try {
      const resp = await apiRequest<{ otCase: OtSurgeryCase; db: LimsDatabase }>(
        `/api/ot/cases/${checklistTarget.id}/preop-checklist`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            vitalBp: chkBp.trim(),
            vitalPulseBpm: Number(chkPulse) || 80,
            vitalTempF: Number(chkTemp) || 98.4,
            vitalSpo2Pct: Number(chkSpo2) || 98,
            asaGrade: chkAsa,
            anesthesiaCleared: chkAnesthCleared,
            anesthesiaClearedBy: chkAnesthBy.trim(),
            surgicalSiteVerified: chkSiteVerified,
            siteMarked: chkSiteMarked,
            laterality: chkLaterality,
            procedureNameVerified: chkProcedureVerified.trim() || checklistTarget.procedureName,
            patientIdentityVerified: chkIdentityVerified,
            consentSignedVerified: chkConsentVerified,
            npoConfirmed: chkNpoConfirmed,
            bloodCrossmatchChecked: chkCrossmatch,
            equipmentSterilityChecked: chkSterility,
            checklistNotes: chkNotes.trim(),
          }),
        }
      );
      setChecklistTarget(null);
      onUpdated(
        resp.db,
        `Mandatory Pre-Op Safety Checklist signed & audit-logged for ${resp.otCase.otNumber}. Surgery unlocked.`
      );
    } catch (err: any) {
      setInlineError(err.message || 'Pre-Op Safety Checklist validation failed.');
    } finally {
      setSavingChecklist(false);
    }
  };

  const handleStartSurgery = async (c: OtSurgeryCase) => {
    if (!c.preOpChecklist?.clearedToStart) {
      setInlineError(
        `Safety Gate Active: Complete & sign the Mandatory Pre-Operative Safety Checklist before starting ${c.otNumber}.`
      );
      openChecklistModal(c);
      return;
    }
    setInlineError(null);
    try {
      const resp = await apiRequest<{ otCase: OtSurgeryCase; db: LimsDatabase }>(
        `/api/ot/cases/${c.id}/start`,
        activeUser.id,
        { method: 'POST', body: JSON.stringify({}) }
      );
      onUpdated(resp.db, `Started surgery ${resp.otCase.otNumber} in ${resp.otCase.otRoomLabel}.`);
    } catch (err: any) {
      setInlineError(err.message || 'Unable to start surgery.');
    }
  };

  const handleSaveAnesthesia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !canAnesthesia) return;
    setSavingAnesthesia(true);
    setInlineError(null);
    try {
      const resp = await apiRequest<{ otCase: OtSurgeryCase; db: LimsDatabase }>(
        `/api/ot/cases/${selectedCase.id}/anesthesia`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            anesthesiologistName: anName.trim() || selectedCase.anesthesiologist,
            anesthesiaType: anType,
            airwayLog: airway,
            agentsUsed: agents,
            vitalsLog,
            ivFluidsGivenMl: Number(ivFluidsMl) || 0,
            estimatedBloodLossMl: Number(eblMl) || 0,
            complicationNotes: complicationNotes.trim(),
          }),
        }
      );
      onUpdated(resp.db, `Saved Anesthesiology & Airway Log for ${resp.otCase.otNumber}.`);
    } catch (err: any) {
      setInlineError(err.message || 'Failed to save anesthesia record.');
    } finally {
      setSavingAnesthesia(false);
    }
  };

  const handleCompleteOt = async (targetStatus: 'PACU Recovery' | 'Completed') => {
    if (!selectedCase || !canManage) return;
    setCompletingOt(true);
    setInlineError(null);
    try {
      const resp = await apiRequest<{ otCase: OtSurgeryCase; db: LimsDatabase }>(
        `/api/ot/cases/${selectedCase.id}/complete`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            operativeNote: opNote,
            consumablesNotes: consumablesNote,
            targetStatus,
            postChargeToIpd: postChargeIpd,
            postOpPacu: {
              aldreteScore: Number(aldreteScore) || 9,
              bp: pacuBp,
              spo2Pct: Number(pacuSpo2) || 99,
              painScore: Number(pacuPain) || 2,
              transferredTo: pacuDest,
              pacuNotes,
            },
          }),
        }
      );
      onUpdated(resp.db, `Updated ${resp.otCase.otNumber} to ${resp.otCase.status}.`);
    } catch (err: any) {
      setInlineError(err.message || 'Failed to update OT completion.');
    } finally {
      setCompletingOt(false);
    }
  };

  const handleRoomStatus = async (
    roomId: string,
    status: 'Available' | 'Occupied' | 'Cleaning' | 'Maintenance'
  ) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/ot/rooms/${roomId}`, activeUser.id, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onUpdated(resp.db, `Updated OT room status to ${status}.`);
    } catch (err: any) {
      setInlineError(err.message || 'Room update failed.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Operation Theatre (OT) &amp; Anesthesiology Management
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Theatre room board, mandatory Pre-Operative Safety Checklist audit lock, anesthesiology drug/airway logs &amp; PACU recovery.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowScheduleModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Schedule Surgery Case
            </button>
          )}
        </div>
      </div>

      {/* Inline Error Banner with Close */}
      {inlineError && (
        <div className="p-3.5 rounded-lg border border-rose-300 bg-rose-50 text-rose-900 text-xs flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
            <span>{inlineError}</span>
          </div>
          <button
            type="button"
            onClick={() => setInlineError(null)}
            className="p-1 rounded hover:bg-rose-100 text-rose-700"
            aria-label="Dismiss alert"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* OT Rooms Live Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
        {otRooms.map((room) => (
          <div
            key={room.id}
            className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">{room.name}</div>
                <div className="text-xs text-slate-500 mt-0.5">{room.specialty}</div>
              </div>
              <span
                className={`text-xs font-mono font-semibold ${
                  room.status === 'Occupied'
                    ? 'text-rose-700'
                    : room.status === 'Cleaning'
                    ? 'text-amber-700'
                    : 'text-emerald-700'
                }`}
              >
                {room.status}
              </span>
            </div>
            {canManage && (
              <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100">
                {(['Available', 'Cleaning', 'Maintenance'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    disabled={room.status === st}
                    onClick={() => handleRoomStatus(room.id, st)}
                    className={`px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap ${
                      room.status === st
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Main Split: Left Cases Directory + Right Active Case Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        {/* Left: Surgery Queue */}
        <div className="xl:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="p-3.5 border-b border-slate-200 bg-slate-50 space-y-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search OT #, patient, procedure..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex flex-wrap gap-1">
              {(['ALL', 'Scheduled', 'Pre-Op Ready', 'In Progress', 'Completed'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[620px] overflow-y-auto">
            {filteredCases.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No surgical cases match current filter.
              </div>
            ) : (
              filteredCases.map((c) => {
                const isSel = selectedCase?.id === c.id;
                const cleared = Boolean(c.preOpChecklist?.clearedToStart);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectCase(c)}
                    className={`w-full text-left p-3.5 transition-colors space-y-1 ${
                      isSel ? 'bg-blue-50/80' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-blue-700">{c.otNumber}</span>
                      <span
                        className={`font-semibold ${
                          c.status === 'In Progress'
                            ? 'text-rose-700'
                            : c.status === 'Completed'
                            ? 'text-emerald-700'
                            : c.status === 'Pre-Op Ready'
                            ? 'text-blue-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{c.procedureName}</div>
                    <div className="text-xs text-slate-600">
                      {c.patientName} ({c.patientAge}Y/{c.patientGender[0]}) · {c.otRoomLabel.split(' ')[0]} ·{' '}
                      <span className="font-mono">{c.scheduledTime}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center justify-between gap-2 pt-0.5">
                      <span>{c.leadSurgeon}</span>
                      <span className={cleared ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                        {cleared ? 'Checklist Verified' : 'Checklist Pending'}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Active Case Workspace */}
        <div className="xl:col-span-8 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          {!selectedCase ? (
            <div className="p-10 text-center text-sm text-slate-500">
              Select an OT case or schedule a new surgery to begin.
            </div>
          ) : (
            <>
              {/* Case Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-bold text-blue-700">{selectedCase.otNumber}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-semibold text-slate-800">{selectedCase.otRoomLabel}</span>
                    <span className="text-slate-300">·</span>
                    <span className="font-mono text-slate-600">
                      {selectedCase.scheduledDate} {selectedCase.scheduledTime}
                    </span>
                    <span className="text-slate-300">·</span>
                    <span
                      className={`font-semibold ${
                        selectedCase.priority === 'Emergency' ? 'text-rose-700' : 'text-slate-700'
                      }`}
                    >
                      {selectedCase.priority}
                    </span>
                  </div>
                  <h2 className="text-lg font-semibold text-slate-900 mt-1">
                    {selectedCase.procedureName}
                  </h2>
                  <div className="text-xs text-slate-600 mt-0.5">
                    Patient: <strong className="text-slate-900">{selectedCase.patientName}</strong> (
                    {selectedCase.patientAge} {selectedCase.patientAgeType}/{selectedCase.patientGender})
                    {selectedCase.uhid ? ` · ${selectedCase.uhid}` : ''} · Diagnosis: {selectedCase.diagnosis}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openChecklistModal(selectedCase)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5 text-blue-600" />
                    {selectedCase.preOpChecklist?.clearedToStart
                      ? 'View / Update Pre-Op Checklist'
                      : 'Sign Pre-Op Safety Checklist'}
                  </button>

                  {canManage &&
                    (selectedCase.status === 'Scheduled' || selectedCase.status === 'Pre-Op Ready') && (
                      <button
                        type="button"
                        onClick={() => handleStartSurgery(selectedCase)}
                        className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap ${
                          selectedCase.preOpChecklist?.clearedToStart
                            ? 'text-white bg-emerald-600 hover:bg-emerald-700'
                            : 'text-amber-900 bg-amber-100 border border-amber-300 hover:bg-amber-200'
                        }`}
                      >
                        {selectedCase.preOpChecklist?.clearedToStart ? (
                          <Scissors className="w-3.5 h-3.5" />
                        ) : (
                          <Lock className="w-3.5 h-3.5" />
                        )}
                        Start Surgery
                      </button>
                    )}

                  <button
                    type="button"
                    onClick={() => setPrintCase(selectedCase)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print OT &amp; Anesthesia Record
                  </button>
                </div>
              </div>

              {/* Sub-Module Navigation Tabs */}
              <div className="px-5 py-2.5 border-b border-slate-200 bg-white flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'overview', label: 'Team & Surgery Gate', icon: Scissors },
                    { id: 'checklist', label: 'Pre-Op Safety Checklist & Audit Log', icon: ClipboardCheck },
                    { id: 'anesthesia', label: 'Anesthesiology & Airway Sub-Module', icon: Syringe },
                    { id: 'pacu', label: 'Operative Note & PACU Completion', icon: HeartPulse },
                  ] as const
                ).map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setWorkspaceTab(t.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border whitespace-nowrap ${
                        workspaceTab === t.id
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {/* Tab Content */}
              <div className="p-5 space-y-5 flex-1">
                {workspaceTab === 'overview' && (
                  <div className="space-y-4">
                    <div
                      className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
                        selectedCase.preOpChecklist?.clearedToStart
                          ? 'border-emerald-200 bg-emerald-50/70'
                          : 'border-amber-200 bg-amber-50/70'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                          {selectedCase.preOpChecklist?.clearedToStart ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                          ) : (
                            <Lock className="w-4 h-4 text-amber-700" />
                          )}
                          Mandatory Pre-Operative Safety Checklist Status
                        </div>
                        <div className="text-xs text-slate-700">
                          {selectedCase.preOpChecklist?.clearedToStart
                            ? `Verified by ${selectedCase.preOpChecklist.completedBy} · ${selectedCase.preOpChecklist.asaGrade} · Anesthesia Cleared by ${selectedCase.preOpChecklist.anesthesiaClearedBy} · Site Verified (${selectedCase.preOpChecklist.laterality})`
                            : 'Surgery start is locked until Pre-Op Vitals, Anesthesia Clearance & Surgical Site Verification are signed.'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openChecklistModal(selectedCase)}
                        className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                      >
                        {selectedCase.preOpChecklist?.clearedToStart ? 'Review Checklist' : 'Complete Checklist Now'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border border-slate-200 rounded-xl p-4">
                      <div>
                        <span className="text-slate-500 block">Lead Surgeon</span>
                        <strong className="text-slate-900">{selectedCase.leadSurgeon}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Anesthesiologist</span>
                        <strong className="text-slate-900">{selectedCase.anesthesiologist}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Scrub / Circulating Nurse</span>
                        <strong className="text-slate-900">{selectedCase.scrubNurse || 'Assigned OT Nurse'}</strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">OT Procedure Fee</span>
                        <strong className="font-mono tabular-nums text-slate-900">
                          {formatNpr(selectedCase.otFeeNpr)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Started At</span>
                        <strong className="font-mono text-slate-900">
                          {selectedCase.startedAt
                            ? `${adToBs(selectedCase.startedAt).formattedEn} ${adToBs(selectedCase.startedAt).timeEn}`
                            : 'Not started yet'}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Completed At</span>
                        <strong className="font-mono text-slate-900">
                          {selectedCase.completedAt
                            ? `${adToBs(selectedCase.completedAt).formattedEn} ${adToBs(selectedCase.completedAt).timeEn}`
                            : 'Pending completion'}
                        </strong>
                      </div>
                    </div>
                  </div>
                )}

                {workspaceTab === 'checklist' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Signed Pre-Operative Safety Checklist &amp; Audit Trail
                      </h3>
                      <button
                        type="button"
                        onClick={() => openChecklistModal(selectedCase)}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
                      >
                        {selectedCase.preOpChecklist ? 'Update & Re-Sign Checklist' : 'Sign Checklist'}
                      </button>
                    </div>

                    {selectedCase.preOpChecklist ? (
                      <div className="border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-500">Pre-Op Vitals:</span>{' '}
                          <strong className="font-mono">
                            BP {selectedCase.preOpChecklist.vitalBp} · HR {selectedCase.preOpChecklist.vitalPulseBpm} bpm · Temp{' '}
                            {selectedCase.preOpChecklist.vitalTempF}°F · SpO2 {selectedCase.preOpChecklist.vitalSpo2Pct}%
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Anesthesia Clearance:</span>{' '}
                          <strong className="text-emerald-700">
                            {selectedCase.preOpChecklist.asaGrade} Cleared by{' '}
                            {selectedCase.preOpChecklist.anesthesiaClearedBy}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Surgical Site &amp; Side:</span>{' '}
                          <strong>
                            {selectedCase.preOpChecklist.procedureNameVerified} ({selectedCase.preOpChecklist.laterality})
                            {selectedCase.preOpChecklist.siteMarked ? ' · Site Marked' : ''}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500">Safety Gate Verifications:</span>{' '}
                          <span>
                            ID ✓ · Consent ✓ · NPO {selectedCase.preOpChecklist.npoConfirmed ? '✓' : '—'} · Crossmatch{' '}
                            {selectedCase.preOpChecklist.bloodCrossmatchChecked ? '✓' : '—'} · Sterility{' '}
                            {selectedCase.preOpChecklist.equipmentSterilityChecked ? '✓' : '—'}
                          </span>
                        </div>
                        {selectedCase.preOpChecklist.checklistNotes && (
                          <div className="sm:col-span-2 text-slate-700">
                            <strong>Checklist Remarks:</strong> {selectedCase.preOpChecklist.checklistNotes}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="p-6 text-center border border-slate-200 rounded-xl text-xs text-slate-500">
                        Pre-Operative Safety Checklist has not been signed yet. Click &quot;Sign Checklist&quot; above.
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-800">
                        Clinical Audit Log Entries ({caseAuditLogs.length})
                      </div>
                      <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden text-xs">
                        {caseAuditLogs.length === 0 ? (
                          <div className="p-3 text-slate-500">No audit entries recorded yet for this case.</div>
                        ) : (
                          caseAuditLogs.map((log) => (
                            <div key={log.id} className="p-3 bg-white flex flex-wrap justify-between gap-2">
                              <div>
                                <span className="font-mono font-semibold text-blue-700">{log.action}</span> ·{' '}
                                <span className="text-slate-800">{log.summary}</span>
                              </div>
                              <div className="font-mono text-slate-500 text-[11px] whitespace-nowrap">
                                {log.actorName} · {adToBs(log.timestamp).formattedEn} {adToBs(log.timestamp).timeEn}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {workspaceTab === 'anesthesia' && (
                  <form onSubmit={handleSaveAnesthesia} className="space-y-5 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Anesthesiologist</label>
                        <input
                          value={anName}
                          onChange={(e) => setAnName(e.target.value)}
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Anesthesia Technique</label>
                        <select
                          value={anType}
                          onChange={(e) =>
                            setAnType(e.target.value as OtAnesthesiaRecord['anesthesiaType'])
                          }
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                        >
                          <option value="General Anesthesia (GA)">General Anesthesia (GA)</option>
                          <option value="Spinal (Subarachnoid)">Spinal (Subarachnoid)</option>
                          <option value="Epidural">Epidural</option>
                          <option value="Regional / Nerve Block">Regional / Nerve Block</option>
                          <option value="Local / MAC Sedation">Local / MAC Sedation</option>
                        </select>
                      </div>
                    </div>

                    {/* Airway Management Log */}
                    <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50/50">
                      <div className="font-semibold text-slate-900 text-xs">
                        Airway Management &amp; Ventilation Log
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Mallampati Grade</label>
                          <select
                            value={airway.mallampatiGrade}
                            onChange={(e) =>
                              setAirway({
                                ...airway,
                                mallampatiGrade: e.target.value as AnesthesiaAirwayLog['mallampatiGrade'],
                              })
                            }
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white"
                          >
                            <option value="Class I">Class I</option>
                            <option value="Class II">Class II</option>
                            <option value="Class III">Class III</option>
                            <option value="Class IV">Class IV</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Airway Device</label>
                          <select
                            value={airway.airwayDevice}
                            onChange={(e) =>
                              setAirway({
                                ...airway,
                                airwayDevice: e.target.value as AnesthesiaAirwayLog['airwayDevice'],
                              })
                            }
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white"
                          >
                            <option value="ETT (Endotracheal Tube)">ETT (Endotracheal Tube)</option>
                            <option value="LMA (Supraglottic)">LMA (Supraglottic)</option>
                            <option value="Face Mask">Face Mask</option>
                            <option value="Nasal Cannula / Neuraxial">Nasal Cannula / Neuraxial</option>
                            <option value="Tracheostomy">Tracheostomy</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Tube / Mask Size</label>
                          <input
                            value={airway.tubeSize || ''}
                            onChange={(e) => setAirway({ ...airway, tubeSize: e.target.value })}
                            placeholder="7.5 mm ID"
                            className="w-full px-2 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Intubation Attempts</label>
                          <input
                            type="number"
                            min={0}
                            value={airway.intubationAttempts ?? 1}
                            onChange={(e) =>
                              setAirway({ ...airway, intubationAttempts: Number(e.target.value) || 0 })
                            }
                            className="w-full px-2 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Laryngoscope View</label>
                          <input
                            value={airway.laryngoscopeView || ''}
                            onChange={(e) => setAirway({ ...airway, laryngoscopeView: e.target.value })}
                            placeholder="CL Grade I"
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Ventilator Mode</label>
                          <input
                            value={airway.ventilatorMode || ''}
                            onChange={(e) => setAirway({ ...airway, ventilatorMode: e.target.value })}
                            placeholder="VCV / PCV / Spont"
                            className="w-full px-2 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-slate-600 mb-1">Tidal Vol (mL) / FiO2%</label>
                          <div className="flex gap-1">
                            <input
                              type="number"
                              value={airway.tidalVolumeMl ?? 450}
                              onChange={(e) =>
                                setAirway({ ...airway, tidalVolumeMl: Number(e.target.value) || 0 })
                              }
                              className="w-1/2 px-2 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                            />
                            <input
                              type="number"
                              value={airway.fio2Pct ?? 50}
                              onChange={(e) =>
                                setAirway({ ...airway, fio2Pct: Number(e.target.value) || 21 })
                              }
                              className="w-1/2 px-2 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                            />
                          </div>
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="inline-flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(airway.cuffInflated)}
                              onChange={(e) => setAirway({ ...airway, cuffInflated: e.target.checked })}
                            />
                            <span>Cuff Inflated &amp; B/L Air Entry Equal</span>
                          </label>
                        </div>
                      </div>
                      <input
                        value={airway.airwayNotes || ''}
                        onChange={(e) => setAirway({ ...airway, airwayNotes: e.target.value })}
                        placeholder="Airway extubation notes / suctioning / difficulty note..."
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                      />
                    </div>

                    {/* Anesthesia Agents & Dosing */}
                    <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="font-semibold text-slate-900">
                        Anesthesia Agents &amp; Drug Dosing Log ({agents.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {NEPAL_OT_ANESTHESIA_AGENTS.map((preset) => (
                          <button
                            key={preset.name}
                            type="button"
                            onClick={() =>
                              setAgents((prev) => [
                                ...prev,
                                {
                                  id: `ag-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                                  agentName: preset.name,
                                  category: preset.category,
                                  dose: preset.defaultDose,
                                  unit: preset.unit,
                                  route: preset.route,
                                  timeGiven: new Date().toTimeString().slice(0, 5),
                                  givenBy: anName || activeUser.fullName,
                                },
                              ])
                            }
                            className="px-2 py-1 text-[11px] font-medium bg-slate-50 border border-slate-200 rounded hover:bg-blue-50 hover:border-blue-300 whitespace-nowrap"
                          >
                            + {preset.name}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 pt-1">
                        <input
                          value={newAgentName}
                          onChange={(e) => setNewAgentName(e.target.value)}
                          placeholder="Custom Agent Name"
                          className="sm:col-span-2 px-2 py-1.5 border border-slate-300 rounded-lg"
                        />
                        <input
                          value={newAgentDose}
                          onChange={(e) => setNewAgentDose(e.target.value)}
                          placeholder="Dose (e.g. 50)"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <input
                          value={newAgentUnit}
                          onChange={(e) => setNewAgentUnit(e.target.value)}
                          placeholder="Unit (mg/mcg)"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <input
                          value={newAgentRoute}
                          onChange={(e) => setNewAgentRoute(e.target.value)}
                          placeholder="Route (IV/IT)"
                          className="px-2 py-1.5 border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!newAgentName.trim()) return;
                            setAgents((prev) => [
                              ...prev,
                              {
                                id: `ag-${Date.now()}`,
                                agentName: newAgentName.trim(),
                                category: newAgentCat,
                                dose: newAgentDose.trim() || '1',
                                unit: newAgentUnit.trim() || 'mg',
                                route: newAgentRoute.trim() || 'IV',
                                timeGiven: newAgentTime || new Date().toTimeString().slice(0, 5),
                                givenBy: anName || activeUser.fullName,
                              },
                            ]);
                            setNewAgentName('');
                            setNewAgentDose('');
                          }}
                          className="px-2.5 py-1.5 font-medium text-white bg-slate-800 rounded-lg hover:bg-slate-900 whitespace-nowrap"
                        >
                          + Add Drug
                        </button>
                      </div>

                      {agents.length > 0 && (
                        <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
                          <thead className="bg-slate-50 text-[10px] uppercase text-slate-600">
                            <tr>
                              <th className="p-2">Time</th>
                              <th className="p-2">Agent</th>
                              <th className="p-2">Category</th>
                              <th className="p-2">Dose &amp; Route</th>
                              <th className="p-2 text-right">Remove</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {agents.map((ag) => (
                              <tr key={ag.id}>
                                <td className="p-2 font-mono">{ag.timeGiven}</td>
                                <td className="p-2 font-medium text-slate-900">{ag.agentName}</td>
                                <td className="p-2 text-slate-600">{ag.category}</td>
                                <td className="p-2 font-mono">
                                  {ag.dose} {ag.unit} ({ag.route})
                                </td>
                                <td className="p-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => setAgents((prev) => prev.filter((x) => x.id !== ag.id))}
                                    className="text-rose-600 hover:text-rose-800"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 inline" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* Intra-Op Patient Response & Vitals Timeline */}
                    <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="font-semibold text-slate-900">
                        Intra-Operative Vitals &amp; Patient Response Log ({vitalsLog.length})
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
                        <input
                          value={vtTime}
                          onChange={(e) => setVtTime(e.target.value)}
                          placeholder="Time"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <input
                          value={vtBp}
                          onChange={(e) => setVtBp(e.target.value)}
                          placeholder="BP 116/74"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <input
                          value={vtPulse}
                          onChange={(e) => setVtPulse(e.target.value)}
                          placeholder="HR bpm"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <input
                          value={vtSpo2}
                          onChange={(e) => setVtSpo2(e.target.value)}
                          placeholder="SpO2 %"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <input
                          value={vtEtco2}
                          onChange={(e) => setVtEtco2(e.target.value)}
                          placeholder="EtCO2 mmHg"
                          className="px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setVitalsLog((prev) => [
                              ...prev,
                              {
                                id: `av-${Date.now()}`,
                                recordedAt: vtTime || new Date().toTimeString().slice(0, 5),
                                bp: vtBp.trim(),
                                pulseBpm: Number(vtPulse) || 80,
                                spo2Pct: Number(vtSpo2) || 98,
                                etco2MmHg: Number(vtEtco2) || undefined,
                                patientResponseNote: vtResponse.trim(),
                              },
                            ])
                          }
                          className="px-2.5 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
                        >
                          + Log Vitals
                        </button>
                      </div>
                      <input
                        value={vtResponse}
                        onChange={(e) => setVtResponse(e.target.value)}
                        placeholder="Patient response / anesthesia plane / reflex observation..."
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />

                      {vitalsLog.length > 0 && (
                        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                          {vitalsLog.map((v) => (
                            <div key={v.id} className="p-2 flex flex-wrap justify-between gap-2 font-mono text-[11px]">
                              <span>
                                <strong>{v.recordedAt}</strong> · BP {v.bp} · HR {v.pulseBpm} · SpO2 {v.spo2Pct}%
                                {v.etco2MmHg ? ` · EtCO2 ${v.etco2MmHg}` : ''}
                              </span>
                              <span className="font-sans text-slate-700">{v.patientResponseNote}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">IV Fluids Given (mL)</label>
                        <input
                          type="number"
                          value={ivFluidsMl}
                          onChange={(e) => setIvFluidsMl(e.target.value)}
                          className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Estimated Blood Loss (mL)</label>
                        <input
                          type="number"
                          value={eblMl}
                          onChange={(e) => setEblMl(e.target.value)}
                          className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Intra-Op Events / Complications</label>
                        <input
                          value={complicationNotes}
                          onChange={(e) => setComplicationNotes(e.target.value)}
                          placeholder="None / Hypotension managed..."
                          className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>

                    {canAnesthesia && (
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={savingAnesthesia}
                          className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                        >
                          {savingAnesthesia ? 'Saving Anesthesia Log...' : 'Save Anesthesiology & Airway Record'}
                        </button>
                      </div>
                    )}
                  </form>
                )}

                {workspaceTab === 'pacu' && (
                  <div className="space-y-4 text-xs">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Operative Findings &amp; Surgical Procedure Note
                      </label>
                      <textarea
                        rows={3}
                        value={opNote}
                        onChange={(e) => setOpNote(e.target.value)}
                        placeholder="Describe surgical incision, intra-op findings, closure, hemostasis & drain placement..."
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        OT Consumables &amp; Implants Used
                      </label>
                      <input
                        value={consumablesNote}
                        onChange={(e) => setConsumablesNote(e.target.value)}
                        placeholder="Vicryl 2-0, Endoclip applicator, Foley 16Fr..."
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
                      <div>
                        <label className="block text-slate-600 mb-1">PACU Aldrete Score (0-10)</label>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={aldreteScore}
                          onChange={(e) => setAldreteScore(e.target.value)}
                          className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1">PACU BP</label>
                        <input
                          value={pacuBp}
                          onChange={(e) => setPacuBp(e.target.value)}
                          className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1">PACU SpO2 (%)</label>
                        <input
                          value={pacuSpo2}
                          onChange={(e) => setPacuSpo2(e.target.value)}
                          className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-slate-600 mb-1">Transfer Destination</label>
                        <input
                          value={pacuDest}
                          onChange={(e) => setPacuDest(e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-4">
                        <label className="block text-slate-600 mb-1">PACU Discharge Summary Note</label>
                        <input
                          value={pacuNotes}
                          onChange={(e) => setPacuNotes(e.target.value)}
                          className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                        />
                      </div>
                    </div>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={postChargeIpd}
                        onChange={(e) => setPostChargeIpd(e.target.checked)}
                      />
                      <span>
                        Auto-post OT fee ({formatNpr(selectedCase.otFeeNpr)}) to active IPD admission billing ledger (if admitted)
                      </span>
                    </label>

                    {canManage && (
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={completingOt}
                          onClick={() => handleCompleteOt('PACU Recovery')}
                          className="px-4 py-2 text-xs font-medium text-amber-900 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200"
                        >
                          Move to PACU Recovery
                        </button>
                        <button
                          type="button"
                          disabled={completingOt}
                          onClick={() => handleCompleteOt('Completed')}
                          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                        >
                          {completingOt ? 'Completing...' : 'Finalize & Complete Surgery'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Mandatory Pre-Operative Safety Checklist Modal */}
      {checklistTarget && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleSavePreOpChecklist}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Mandatory Pre-Operative Safety Checklist — {checklistTarget.otNumber}
                </h3>
                <p className="text-xs text-slate-500">
                  {checklistTarget.patientName} · {checklistTarget.procedureName} (Creates Clinical Audit Log)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setChecklistTarget(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pre-Op BP *</label>
                  <input
                    required
                    value={chkBp}
                    onChange={(e) => setChkBp(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pulse (bpm) *</label>
                  <input
                    required
                    type="number"
                    value={chkPulse}
                    onChange={(e) => setChkPulse(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Temp (°F) *</label>
                  <input
                    required
                    type="number"
                    step="0.1"
                    value={chkTemp}
                    onChange={(e) => setChkTemp(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">SpO2 (%) *</label>
                  <input
                    required
                    type="number"
                    value={chkSpo2}
                    onChange={(e) => setChkSpo2(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-slate-50 border border-slate-200">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">ASA Physical Status</label>
                  <select
                    value={chkAsa}
                    onChange={(e) => setChkAsa(e.target.value as PreOpSafetyChecklist['asaGrade'])}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ASA I">ASA I</option>
                    <option value="ASA II">ASA II</option>
                    <option value="ASA III">ASA III</option>
                    <option value="ASA IV">ASA IV</option>
                    <option value="ASA V">ASA V</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Anesthesia Cleared By *</label>
                  <input
                    required
                    value={chkAnesthBy}
                    onChange={(e) => setChkAnesthBy(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Verified Procedure Name *</label>
                  <input
                    required
                    value={chkProcedureVerified}
                    onChange={(e) => setChkProcedureVerified(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Surgical Site Laterality</label>
                  <select
                    value={chkLaterality}
                    onChange={(e) =>
                      setChkLaterality(e.target.value as PreOpSafetyChecklist['laterality'])
                    }
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Midline / N/A">Midline / N/A</option>
                    <option value="Right">Right Side</option>
                    <option value="Left">Left Side</option>
                    <option value="Bilateral">Bilateral</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkAnesthCleared}
                    onChange={(e) => setChkAnesthCleared(e.target.checked)}
                  />
                  <span>Anesthesia Safety &amp; Airway Cleared *</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkSiteVerified}
                    onChange={(e) => setChkSiteVerified(e.target.checked)}
                  />
                  <span>Surgical Site &amp; Laterality Verified *</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkSiteMarked}
                    onChange={(e) => setChkSiteMarked(e.target.checked)}
                  />
                  <span>Surgical Site Marked on Skin</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkIdentityVerified}
                    onChange={(e) => setChkIdentityVerified(e.target.checked)}
                  />
                  <span>Patient Identity / UHID Wristband Verified *</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkConsentVerified}
                    onChange={(e) => setChkConsentVerified(e.target.checked)}
                  />
                  <span>Signed Surgery &amp; Anesthesia Consent Verified *</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkNpoConfirmed}
                    onChange={(e) => setChkNpoConfirmed(e.target.checked)}
                  />
                  <span>NPO Fasting Status Confirmed (&ge; 6 hrs)</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkCrossmatch}
                    onChange={(e) => setChkCrossmatch(e.target.checked)}
                  />
                  <span>Blood Grouping / Crossmatch Checked</span>
                </label>
                <label className="flex items-center gap-2 p-2 border border-slate-200 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={chkSterility}
                    onChange={(e) => setChkSterility(e.target.checked)}
                  />
                  <span>Instrument Sterility &amp; Indicator Checked</span>
                </label>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Safety Checklist Remarks</label>
                <input
                  value={chkNotes}
                  onChange={(e) => setChkNotes(e.target.value)}
                  placeholder="Prophylactic antibiotic given / allergy status..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setChecklistTarget(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingChecklist}
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {savingChecklist ? 'Logging Checklist...' : 'Sign Checklist & Clear Patient for OT'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Schedule Surgery Modal */}
      {showScheduleModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <form
            onSubmit={handleScheduleCase}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h3 className="text-base font-semibold text-slate-900">Schedule New OT Surgery Case</h3>
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Pick Registered UHID Patient (Auto-detects Active IPD / ER / OPD Encounter)
                </label>
                <select
                  value={schPatientId}
                  onChange={(e) => {
                    const pt = (db.patients || []).find((p) => p.id === e.target.value);
                    setSchPatientId(e.target.value);
                    if (pt) {
                      const det = detectPatientEncounter(db, pt);
                      setSchUhid(pt.uhid);
                      setSchEncounterType(det.encounterType);
                      setSchEncounterId(det.encounterId || '');
                      setSchPatientName(pt.fullName);
                      setSchPatientAge(String(pt.age));
                      setSchPatientGender(pt.gender);
                      setSchPatientPhone(stripCountryPrefixForEdit(pt.phone));
                      setSchPatientAddress(pt.address);
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">-- Enter Manually or Select UHID --</option>
                  {(db.patients || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.uhid} — {p.fullName} ({p.age}Y/{p.gender[0]})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Patient Full Name *</label>
                  <input
                    required
                    value={schPatientName}
                    onChange={(e) => setSchPatientName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Age</label>
                    <input
                      type="number"
                      value={schPatientAge}
                      onChange={(e) => setSchPatientAge(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Sex</label>
                    <select
                      value={schPatientGender}
                      onChange={(e) => setSchPatientGender(e.target.value as PatientGender)}
                      className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Surgical Procedure Name *</label>
                  <input
                    required
                    value={schProcedure}
                    onChange={(e) => setSchProcedure(e.target.value)}
                    placeholder="e.g. Laparoscopic Cholecystectomy / LSCS"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Diagnosis / Indication</label>
                  <input
                    value={schDiagnosis}
                    onChange={(e) => setSchDiagnosis(e.target.value)}
                    placeholder="Clinical indication"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">OT Theatre</label>
                  <select
                    value={schRoomId}
                    onChange={(e) => setSchRoomId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {otRooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.roomCode}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={schPriority}
                    onChange={(e) => setSchPriority(e.target.value as 'Elective' | 'Emergency')}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Elective">Elective</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Date</label>
                  <input
                    type="date"
                    value={schDate}
                    onChange={(e) => setSchDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Time</label>
                  <input
                    value={schTime}
                    onChange={(e) => setSchTime(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Lead Surgeon</label>
                  <input
                    value={schSurgeon}
                    onChange={(e) => setSchSurgeon(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Anesthesiologist</label>
                  <input
                    value={schAnesthesiologist}
                    onChange={(e) => setSchAnesthesiologist(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">OT Package Fee (NPR)</label>
                  <input
                    type="number"
                    value={schFeeNpr}
                    onChange={(e) => setSchFeeNpr(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end gap-2 bg-slate-50">
              <button
                type="button"
                onClick={() => setShowScheduleModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={scheduling}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                {scheduling ? 'Scheduling...' : 'Confirm & Schedule OT Case'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Printable A4 OT, Checklist & Anesthesia Summary Modal */}
      {printCase &&
        createPortal(
          <div className="fixed inset-0 z-50 bg-slate-900/70 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
              <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
                <div className="text-sm font-semibold text-slate-900">
                  OT Operative, Safety Checklist &amp; Anesthesia Record · {printCase.otNumber}
                </div>
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setLetterheadMode('with')}
                      className={`px-2.5 py-1 rounded ${
                        letterheadMode === 'with' ? 'bg-slate-900 text-white' : 'text-slate-600'
                      }`}
                    >
                      With Letterhead
                    </button>
                    <button
                      type="button"
                      onClick={() => setLetterheadMode('without')}
                      className={`px-2.5 py-1 rounded ${
                        letterheadMode === 'without' ? 'bg-slate-900 text-white' : 'text-slate-600'
                      }`}
                    >
                      Without Letterhead
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      executeSmartPrint({
                        element: printSheetRef.current,
                        pageCssSize: 'A4 portrait',
                        documentTitle: `OT Record - ${printCase.otNumber}`,
                      })
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    <Printer className="w-3.5 h-3.5" /> Print A4
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintCase(null)}
                    className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="p-6 overflow-y-auto bg-slate-200">
                <div
                  ref={printSheetRef}
                  className="a4-page w-[210mm] min-h-[297mm] bg-white mx-auto px-[14mm] py-[12mm] text-xs text-slate-900 space-y-4 shadow"
                  style={
                    letterheadMode === 'without'
                      ? { paddingTop: `${db.settings.prePrintedTopMarginMm || 35}mm` }
                      : undefined
                  }
                >
                  {letterheadMode === 'with' && (
                    <div className="border-b-2 border-blue-700 pb-3 flex justify-between items-start">
                      <div>
                        <div className="text-base font-bold text-blue-800">
                          {getPrintHeaderTitle(db.settings.labName, db.settings.labName, 'OPERATION THEATRE RECORD')}
                        </div>
                        <div className="text-[11px] text-slate-600">
                          {sanitizePrintText(db.settings.addressLine)} · {sanitizePrintText(db.settings.contactLine)}
                        </div>
                      </div>
                      <div className="text-right font-mono text-[11px]">
                        <div className="font-bold">{printCase.otNumber}</div>
                        <div>{printCase.otRoomLabel}</div>
                      </div>
                    </div>
                  )}

                  <div className="text-center font-bold uppercase tracking-wider border-y border-slate-800 py-1.5 bg-slate-50">
                    OPERATION THEATRE, PRE-OP SAFETY CHECKLIST &amp; ANESTHESIA RECORD
                  </div>

                  <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded p-3 text-[11px]">
                    <div>Patient: <strong>{printCase.patientName}</strong> ({printCase.patientAge} {printCase.patientAgeType}/{printCase.patientGender})</div>
                    <div>UHID / Phone: <strong className="font-mono">{printCase.uhid || '—'} · {printCase.patientPhone}</strong></div>
                    <div>Procedure: <strong>{printCase.procedureName}</strong></div>
                    <div>Diagnosis: <strong>{printCase.diagnosis}</strong></div>
                    <div>Lead Surgeon: <strong>{printCase.leadSurgeon}</strong></div>
                    <div>Anesthesiologist: <strong>{printCase.anesthesiologist}</strong></div>
                  </div>

                  {printCase.preOpChecklist && (
                    <div className="border border-slate-300 rounded p-3 space-y-1 text-[11px]">
                      <div className="font-bold uppercase text-slate-800">Pre-Operative Safety Checklist (Verified)</div>
                      <div className="font-mono">
                        BP {printCase.preOpChecklist.vitalBp} · HR {printCase.preOpChecklist.vitalPulseBpm} · Temp{' '}
                        {printCase.preOpChecklist.vitalTempF}°F · SpO2 {printCase.preOpChecklist.vitalSpo2Pct}% ·{' '}
                        {printCase.preOpChecklist.asaGrade}
                      </div>
                      <div>
                        Cleared By: <strong>{printCase.preOpChecklist.anesthesiaClearedBy}</strong> · Site Verified:{' '}
                        <strong>{printCase.preOpChecklist.procedureNameVerified} ({printCase.preOpChecklist.laterality})</strong>
                      </div>
                    </div>
                  )}

                  {printCase.anesthesiaRecord && (
                    <div className="border border-slate-300 rounded p-3 space-y-2 text-[11px]">
                      <div className="font-bold uppercase text-slate-800">
                        Anesthesiology &amp; Airway Log ({printCase.anesthesiaRecord.anesthesiaType})
                      </div>
                      <div>
                        Airway: <strong>{printCase.anesthesiaRecord.airwayLog.airwayDevice}</strong> (
                        {printCase.anesthesiaRecord.airwayLog.mallampatiGrade}, Tube{' '}
                        {printCase.anesthesiaRecord.airwayLog.tubeSize || '—'})
                      </div>
                      {printCase.anesthesiaRecord.agentsUsed.length > 0 && (
                        <div>
                          <strong>Agents Dosed:</strong>{' '}
                          {printCase.anesthesiaRecord.agentsUsed
                            .map((a) => `${a.agentName} ${a.dose} ${a.unit} (${a.route}) @ ${a.timeGiven}`)
                            .join('; ')}
                        </div>
                      )}
                      <div>
                        IV Fluids: <strong className="font-mono">{printCase.anesthesiaRecord.ivFluidsGivenMl || 0} mL</strong> · EBL:{' '}
                        <strong className="font-mono">{printCase.anesthesiaRecord.estimatedBloodLossMl || 0} mL</strong>
                      </div>
                    </div>
                  )}

                  {printCase.operativeNote && (
                    <div className="border border-slate-300 rounded p-3 text-[11px]">
                      <div className="font-bold uppercase text-slate-800 mb-1">Operative Findings &amp; Note</div>
                      <div>{printCase.operativeNote}</div>
                    </div>
                  )}

                  {printCase.postOpPacu && (
                    <div className="border border-slate-300 rounded p-3 text-[11px]">
                      <div className="font-bold uppercase text-slate-800 mb-1">PACU Recovery</div>
                      <div>
                        Aldrete Score: <strong>{printCase.postOpPacu.aldreteScore}/10</strong> · Transferred to:{' '}
                        <strong>{printCase.postOpPacu.transferredTo}</strong> · {printCase.postOpPacu.pacuNotes}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
