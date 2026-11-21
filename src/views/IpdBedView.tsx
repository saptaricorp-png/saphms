import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ambulance,
  ArrowRightLeft,
  Baby,
  BedDouble,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileSignature,
  FileText,
  FlaskConical,
  Pill,
  Plus,
  Printer,
  Search,
  Settings,
  Tag,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AgeType,
  BirthCertificateRecord,
  DeathCertificateRecord,
  ExternalReferralDetail,
  HospitalBed,
  HospitalConsentRecord,
  IpdAdmission,
  IpdBedScheduleMode,
  IpdDispositionType,
  IpdIndividualCashBill,
  IpdServiceChargeBasis,
  LimsDatabase,
  NursingChartEntry,
  OpdVisit,
  PatientGender,
  PatientRecord,
  PaymentMode,
  PermissionKey,
  StaffMember,
  WardType,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { calculateAutoBedDays, computeIpdDailyAutoCharges } from '../utils/clinical';
import { getRegistrationFieldRule } from '../utils/registrationFields';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import {
  normalizeNepalPhone,
  sanitizePersonName,
  stripCountryPrefixForEdit,
} from '../utils/textFormat';
import { ClinicalDepositionPrintModal } from '../components/ClinicalDepositionPrintModal';
import {
  BedSummaryPrintModal,
  CertificatePrintModal,
  ConsentPrintModal,
  IpdAdmissionFeeReceiptModal,
  IpdAdmissionPrintModal,
  IpdIndividualCashBillModal,
  NursingChartPrintModal,
  ThermalStickerPrintModal,
} from '../components/HospitalPrintModals';

interface IpdBedViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  admitFromOpdVisit?: OpdVisit | null;
  onClearOpdHandoff?: () => void;
  initialSearchQuery?: string;
  preselectedPatient?: PatientRecord | null;
  onClearPreselectedPatient?: () => void;
}

type IpdSubTab = 'admitted' | 'beds' | 'history' | 'certificates';

function buildQuickDischargeSummary(
  adm: IpdAdmission,
  modSettings?: LimsDatabase['settings']['moduleSettings']
): string {
  const auto = computeIpdDailyAutoCharges(adm, modSettings, adm.dischargedAt);
  const latestChart = (adm.nursingCharts || [])[0];
  const latestVitals = latestChart
    ? `BP ${latestChart.bp || '—'} mmHg, PR ${latestChart.pulseBpm ?? '—'} bpm, Temp ${latestChart.tempF ?? '—'}°F, SpO₂ ${latestChart.spo2Pct ?? '—'}%, RR ${latestChart.respRate ?? '—'}/min, GCS ${latestChart.gcsScore || '15/15'}`
    : adm.vitalsOnAdmission
    ? `BP ${adm.vitalsOnAdmission.bp || '—'}, PR ${adm.vitalsOnAdmission.pulseBpm ?? '—'} bpm, Temp ${adm.vitalsOnAdmission.tempF ?? '—'}°F, SpO₂ ${adm.vitalsOnAdmission.spo2Pct ?? '—'}%`
    : 'Vitals stable / recorded on ward chart';

  const totalOral = (adm.nursingCharts || []).reduce((s, c) => s + (Number(c.intakeOralMl) || 0), 0);
  const totalIv = (adm.nursingCharts || []).reduce((s, c) => s + (Number(c.intakeIvMl) || 0), 0);
  const totalUrine = (adm.nursingCharts || []).reduce((s, c) => s + (Number(c.outputUrineMl) || 0), 0);

  const progressLines = (adm.progressNotes || [])
    .slice(0, 5)
    .map((n) => `• [${adToBs(n.timestamp).formattedEn} ${adToBs(n.timestamp).timeEn} · ${n.recordedBy}] ${n.note}`)
    .join('\n');

  const obsLines = (adm.nursingObservationFees || [])
    .slice(0, 4)
    .map((o) => `• ${o.shift} (${o.roundTime}) ${o.observationType}: ${o.notes || 'Observed stable'}`)
    .join('\n');

  const medNames = Array.from(
    new Set([
      ...(adm.usedMedicines || []).map((m) => `${m.medicineName} (${m.dosageRoute})`),
      ...(adm.marRecords || []).map((m) => `${m.medicineName} (${m.doseRoute})`),
    ])
  ).slice(0, 8);

  const invList = (adm.investigationsDone || [])
    .slice(0, 8)
    .map((inv) => `• ${inv.serviceName} [${inv.status}]${inv.summaryFinding ? `: ${inv.summaryFinding}` : ''}`)
    .join('\n');

  return [
    `CLINICAL COURSE & QUICK DISCHARGE SUMMARY — ${adm.admissionNumber}`,
    `Patient: ${adm.patientName} (${adm.patientAge} ${adm.patientAgeType} / ${adm.patientGender}) | UHID: ${adm.uhid || '—'}`,
    `Ward / Bed: ${adm.currentWardName} (${adm.currentBedLabel}) | Attending: ${adm.admittingDoctor}`,
    `Admitted: ${auto.admittedBsLabel} BS → Assessed: ${auto.billedTillBsLabel} BS (${auto.bedDaysBilled} Stay Cycle Days, ${auto.doctorRoundsCount} Dr Rounds)`,
    ``,
    `1. ADMITTING & WORKING DIAGNOSIS`,
    adm.finalDiagnosis || adm.admittingDiagnosis || 'Inpatient medical/surgical management',
    ``,
    `2. LATEST CLINICAL VITALS & I/O OBSERVATION`,
    `Latest Vitals: ${latestVitals}`,
    `Recorded I/O Chart Totals: Oral ${totalOral} mL + IV ${totalIv} mL | Urine Output ${totalUrine} mL`,
    ``,
    `3. HOSPITAL COURSE, DAILY ROUNDS & NURSING OBSERVATIONS`,
    progressLines || '• Patient managed conservatively with daily physician rounds and inpatient nursing monitoring.',
    ...(obsLines ? [obsLines] : []),
    ``,
    `4. INPATIENT MEDICATIONS ADMINISTERED`,
    medNames.length > 0 ? medNames.map((m) => `• ${m}`).join('\n') : '• Standard inpatient supportive therapy',
    ``,
    `5. INVESTIGATIONS PERFORMED`,
    invList || '• Routine baseline monitoring',
    ``,
    `6. CONDITION AT SUMMARY & ADVICE`,
    adm.dischargeCondition || 'Clinically improved, hemodynamically stable, tolerating oral diet.',
    adm.dischargeAdvice || 'Continue prescribed discharge medications and review in OPD with reports.',
  ].join('\n');
}

export function IpdBedView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  admitFromOpdVisit,
  onClearOpdHandoff,
  initialSearchQuery,
  preselectedPatient,
  onClearPreselectedPatient,
}: IpdBedViewProps) {
  const canClinical = hasPerm('hospital.clinical');
  const canManageBeds = hasPerm('hospital.manage');
  const canApproveAdmin = hasPerm('finance.approve_admin') || activeUser.roleId === 'SUPER_ADMIN';
  const modSettings = db.settings?.moduleSettings;
  const ipdCycleStart = modSettings?.ipdBedCycleStartTime || '07:00';
  const ipdCycleEnd = modSettings?.ipdBedCycleEndTime || '19:00';
  const ipdRoundFeeNpr = modSettings?.ipdDoctorRoundFeeNpr ?? 500;
  const ipdNursingFeePerDayNpr = modSettings?.ipdNursingChargePerDayNpr ?? 400;
  const ipdDailyObsFeeNpr = modSettings?.ipdDailyObservationFeeNpr ?? 300;
  const ipdAdmissionFeeNpr = modSettings?.ipdAdmissionFeeNpr ?? 1000;
  const ipdDefaultCreditLimitNpr = modSettings?.ipdDefaultCreditLimitNpr ?? 50000;
  const ipdBedScheduleMode: IpdBedScheduleMode = modSettings?.ipdBedChargeScheduleMode || 'CYCLE_WINDOW';
  const ipdRoundBasis: IpdServiceChargeBasis = modSettings?.ipdDoctorRoundBasis || 'PER_DAY';
  const ipdRoundRoundsPerDay = modSettings?.ipdDoctorRoundsPerDay ?? 1;
  const ipdRoundScheduleTimes = modSettings?.ipdDoctorRoundScheduleTimes || '09:00';
  const ipdNursingBasis: IpdServiceChargeBasis = modSettings?.ipdNursingChargeBasis || 'PER_DAY';
  const ipdNursingRoundsPerDay = modSettings?.ipdNursingRoundsPerDay ?? 2;
  const ipdNursingScheduleTimes = modSettings?.ipdNursingScheduleTimes || '08:00, 20:00';
  const ipdObsBasis: IpdServiceChargeBasis = modSettings?.ipdObservationChargeBasis || 'PER_DAY';
  const ipdObsRoundsPerDay = modSettings?.ipdObservationRoundsPerDay ?? 2;
  const ipdObsScheduleTimes = modSettings?.ipdObservationScheduleTimes || '08:00, 20:00';

  const ipdFieldRule = (key: string) => getRegistrationFieldRule(modSettings, 'ipd', key);

  const beds = db.hospitalBeds || [];
  const admissions = db.ipdAdmissions || [];

  const [subTab, setSubTab] = useState<IpdSubTab>('admitted');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [selectedAdmId, setSelectedAdmId] = useState<string>(
    () => admissions.find((a) => a.disposition === 'Admitted')?.id || admissions[0]?.id || ''
  );

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [printAdmission, setPrintAdmission] = useState<IpdAdmission | null>(null);
  const [printAdmissionSlip, setPrintAdmissionSlip] = useState<IpdAdmission | null>(null);
  const [printFeeReceiptAdm, setPrintFeeReceiptAdm] = useState<IpdAdmission | null>(null);
  const [printIndividualBill, setPrintIndividualBill] = useState<{
    admission: IpdAdmission;
    bill: IpdIndividualCashBill;
  } | null>(null);
  const [printReceiptOnlyOnAdmit, setPrintReceiptOnlyOnAdmit] = useState(
    modSettings?.printOptions?.autoPrintByTemplate?.admissionReceipt !== 'MANUAL_PROMPT'
  );

  // Modals
  const [showAddBedModal, setShowAddBedModal] = useState(false);
  const [showAdmitModal, setShowAdmitModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showDepositionModal, setShowDepositionModal] = useState(false);
  const [showQuickSummaryModal, setShowQuickSummaryModal] = useState(false);
  const [quickSummaryText, setQuickSummaryText] = useState('');
  const [copiedQuickSummary, setCopiedQuickSummary] = useState(false);
  const [showIpdTariffModal, setShowIpdTariffModal] = useState(false);

  // Inline IPD Tariff & Bed Cycle Timing State
  const [draftCycleStart, setDraftCycleStart] = useState(ipdCycleStart);
  const [draftCycleEnd, setDraftCycleEnd] = useState(ipdCycleEnd);
  const [draftBedScheduleMode, setDraftBedScheduleMode] = useState<IpdBedScheduleMode>(ipdBedScheduleMode);
  const [draftRoundFee, setDraftRoundFee] = useState(String(ipdRoundFeeNpr));
  const [draftRoundBasis, setDraftRoundBasis] = useState<IpdServiceChargeBasis>(ipdRoundBasis);
  const [draftRoundRoundsPerDay, setDraftRoundRoundsPerDay] = useState(String(ipdRoundRoundsPerDay));
  const [draftRoundScheduleTimes, setDraftRoundScheduleTimes] = useState(ipdRoundScheduleTimes);
  const [draftNursingFee, setDraftNursingFee] = useState(String(ipdNursingFeePerDayNpr));
  const [draftNursingBasis, setDraftNursingBasis] = useState<IpdServiceChargeBasis>(ipdNursingBasis);
  const [draftNursingRoundsPerDay, setDraftNursingRoundsPerDay] = useState(String(ipdNursingRoundsPerDay));
  const [draftNursingScheduleTimes, setDraftNursingScheduleTimes] = useState(ipdNursingScheduleTimes);
  const [draftObsFee, setDraftObsFee] = useState(String(ipdDailyObsFeeNpr));
  const [draftObsBasis, setDraftObsBasis] = useState<IpdServiceChargeBasis>(ipdObsBasis);
  const [draftObsRoundsPerDay, setDraftObsRoundsPerDay] = useState(String(ipdObsRoundsPerDay));
  const [draftObsScheduleTimes, setDraftObsScheduleTimes] = useState(ipdObsScheduleTimes);
  const [draftAdmissionFee, setDraftAdmissionFee] = useState(String(ipdAdmissionFeeNpr));
  const [draftCreditLimit, setDraftCreditLimit] = useState(String(ipdDefaultCreditLimitNpr));
  const [savingIpdTariff, setSavingIpdTariff] = useState(false);

  // Individual Cash/Credit IPD Item Billing State
  const [payingItemBusy, setPayingItemBusy] = useState(false);
  const [addChargeCategory, setAddChargeCategory] = useState<IpdIndividualCashBill['category']>('PROCEDURE');
  const [addChargeLabel, setAddChargeLabel] = useState('');
  const [addChargeAmt, setAddChargeAmt] = useState('');
  const [addChargePayMode, setAddChargePayMode] = useState<'Cash' | 'Bank / QR' | 'Credit'>('Cash');
  const [addChargeNotes, setAddChargeNotes] = useState('');

  // IPD Credit Limit Admin Approval & MAR State
  const [newCreditLimitInput, setNewCreditLimitInput] = useState('75000');
  const [creditApproveNote, setCreditApproveNote] = useState('');
  const [approvingCredit, setApprovingCredit] = useState(false);
  const [marMedName, setMarMedName] = useState('');
  const [marDoseRoute, setMarDoseRoute] = useState('1 Tab / Inj IV Stat');
  const [marStatus, setMarStatus] = useState<'Given' | 'Held' | 'Refused'>('Given');
  const [marNote, setMarNote] = useState('');
  const [savingMar, setSavingMar] = useState(false);

  // Add Bed State
  const [bedWardName, setBedWardName] = useState('General Medical Ward');
  const [bedWardType, setBedWardType] = useState<WardType>('General Ward');
  const [bedNumber, setBedNumber] = useState('');
  const [bedFloor, setBedFloor] = useState('2nd Floor');
  const [bedRate, setBedRate] = useState('1500');
  const [bedO2, setBedO2] = useState(true);
  const [bedMonitor, setBedMonitor] = useState(false);
  const [bedCenterId, setBedCenterId] = useState(activeUser.assignedCenterId || '');
  const [savingBed, setSavingBed] = useState(false);

  // Admit Patient State
  const doctorOptions = useMemo(() => {
    const staffDocs = (db.staff || [])
      .filter((s) =>
        ['DOCTOR', 'PATHOLOGIST', 'MEDICAL_DIRECTOR', 'SUPER_ADMIN'].includes(s.roleId) ||
        s.fullName.trim().toLowerCase().startsWith('dr.')
      )
      .map((s) => s.fullName);
    return Array.from(new Set(['Dr. Elena Adhikari, MD', 'Dr. Santosh Majhi, MD', ...staffDocs]));
  }, [db.staff]);

  const availableBeds = useMemo(
    () =>
      beds.filter(
        (b) => b.status === 'Available' && b.wardType !== 'Emergency / Obs' && !/^er[-_ ]/i.test(b.bedCode)
      ),
    [beds]
  );
  const [admWardFilter, setAdmWardFilter] = useState<
    'ALL' | 'ICU / HDU' | 'NICU' | 'Post-Op' | 'Maternity' | 'General Ward' | 'Private Cabin'
  >('ALL');
  const filteredAdmAvailableBeds = useMemo(() => {
    if (admWardFilter === 'ALL') return availableBeds;
    return availableBeds.filter((b) => {
      const hay = `${b.wardType} ${b.wardName} ${b.bedCode}`.toLowerCase();
      if (admWardFilter === 'ICU / HDU') return hay.includes('icu') || hay.includes('hdu');
      if (admWardFilter === 'NICU') return hay.includes('nicu');
      if (admWardFilter === 'Post-Op') return hay.includes('post') || hay.includes('recovery');
      if (admWardFilter === 'Maternity') return hay.includes('matern') || hay.includes('obgyn') || hay.includes('labour');
      if (admWardFilter === 'General Ward') return b.wardType === 'General Ward' || hay.includes('general');
      if (admWardFilter === 'Private Cabin') return b.wardType.includes('Cabin') || hay.includes('cabin');
      return true;
    });
  }, [availableBeds, admWardFilter]);
  const [admBedId, setAdmBedId] = useState(availableBeds[0]?.id || '');
  const [admLinkedOpdId, setAdmLinkedOpdId] = useState<string | undefined>(undefined);
  const [admPatientId, setAdmPatientId] = useState('');
  const [admUhid, setAdmUhid] = useState('');
  const [admPatientSearch, setAdmPatientSearch] = useState('');
  const [admHideDemographics, setAdmHideDemographics] = useState(false);
  const [admName, setAdmName] = useState('');
  const [admAge, setAdmAge] = useState('45');
  const [admAgeType, setAdmAgeType] = useState<AgeType>('Years');
  const [admGender, setAdmGender] = useState<PatientGender>('Male');
  const [admPhone, setAdmPhone] = useState('');
  const [admAddress, setAdmAddress] = useState('');
  const [admEmergency, setAdmEmergency] = useState('');
  const [admDoctor, setAdmDoctor] = useState(doctorOptions[0] || 'Dr. Elena Adhikari, MD');
  const [admDoctorCustom, setAdmDoctorCustom] = useState('');
  const [admDiagnosis, setAdmDiagnosis] = useState('');
  const [admAdmissionFee, setAdmAdmissionFee] = useState(String(ipdAdmissionFeeNpr));
  const [admAdmissionPayMode, setAdmAdmissionPayMode] = useState<'Cash' | 'Bank / QR' | 'Credit'>('Cash');
  const [admDeposit, setAdmDeposit] = useState('10000');
  const [admPayMode, setAdmPayMode] = useState<PaymentMode>('Cash');
  const [admitting, setAdmitting] = useState(false);
  const [reqCreditAmt, setReqCreditAmt] = useState('75000');
  const [reqCreditRemark, setReqCreditRemark] = useState('');
  const [requestingCredit, setRequestingCredit] = useState(false);

  const searchableIpdPatients = useMemo(() => {
    const map = new Map<
      string,
      {
        id: string;
        uhid: string;
        fullName: string;
        age: number;
        ageType: AgeType;
        gender: PatientGender;
        phone: string;
        address: string;
        sourceBadge: 'PATIENT' | 'OPD' | 'EMERGENCY';
      }
    >();
    for (const pt of db.patients || []) {
      map.set(pt.uhid || pt.id, {
        id: pt.id,
        uhid: pt.uhid,
        fullName: pt.fullName,
        age: pt.age,
        ageType: pt.ageType,
        gender: pt.gender,
        phone: pt.phone,
        address: pt.address,
        sourceBadge: 'PATIENT',
      });
    }
    for (const v of db.opdVisits || []) {
      const key = v.uhid || v.patientId || v.id;
      if (!map.has(key)) {
        map.set(key, {
          id: v.patientId || v.id,
          uhid: v.uhid || v.tokenNumber,
          fullName: v.patientName,
          age: v.patientAge,
          ageType: v.patientAgeType,
          gender: v.patientGender,
          phone: v.patientPhone,
          address: v.patientAddress,
          sourceBadge: 'OPD',
        });
      }
    }
    for (const er of db.emergencyCases || []) {
      const key = er.uhid || er.patientId || er.id;
      if (!map.has(key)) {
        map.set(key, {
          id: er.patientId || er.id,
          uhid: er.uhid || er.erNumber,
          fullName: er.patientName,
          age: er.patientAge,
          ageType: er.patientAgeType,
          gender: er.patientGender,
          phone: er.patientPhone,
          address: er.patientAddress,
          sourceBadge: 'EMERGENCY',
        });
      }
    }
    const q = admPatientSearch.trim().toLowerCase();
    const list = Array.from(map.values());
    if (!q) return list;
    return list.filter((p) => `${p.uhid} ${p.fullName} ${p.phone}`.toLowerCase().includes(q));
  }, [db.patients, db.opdVisits, db.emergencyCases, admPatientSearch]);

  const handleSelectIpdPatient = (pid: string) => {
    setAdmPatientId(pid);
    if (!pid) {
      setAdmUhid('');
      setAdmHideDemographics(false);
      setAdmPhone('');
      return;
    }
    const pt = searchableIpdPatients.find((p) => p.id === pid);
    if (!pt) return;
    setAdmUhid(pt.uhid);
    setAdmName(pt.fullName);
    setAdmAge(String(pt.age));
    setAdmAgeType(pt.ageType);
    setAdmGender(pt.gender);
    setAdmPhone(stripCountryPrefixForEdit(pt.phone));
    setAdmAddress(pt.address || '');
    setAdmHideDemographics(true);
  };

  useEffect(() => {
    setAdmAdmissionFee(String(ipdAdmissionFeeNpr));
  }, [ipdAdmissionFeeNpr]);

  useEffect(() => {
    setPrintReceiptOnlyOnAdmit(
      modSettings?.printOptions?.autoPrintByTemplate?.admissionReceipt !== 'MANUAL_PROMPT'
    );
  }, [modSettings?.printOptions?.autoPrintByTemplate?.admissionReceipt]);

  // Handle OPD -> IPD Handoff
  useEffect(() => {
    if (!admitFromOpdVisit) return;
    const hubAvailable = beds.find(
      (b) => b.status === 'Available' && b.centerId === admitFromOpdVisit.centerId
    ) || availableBeds[0];
    setAdmBedId(hubAvailable?.id || '');
    setAdmLinkedOpdId(admitFromOpdVisit.id);
    setAdmPatientId(admitFromOpdVisit.patientId || '');
    setAdmUhid(admitFromOpdVisit.uhid || '');
    setAdmName(admitFromOpdVisit.patientName);
    setAdmAge(String(admitFromOpdVisit.patientAge));
    setAdmAgeType(admitFromOpdVisit.patientAgeType);
    setAdmGender(admitFromOpdVisit.patientGender);
    setAdmPhone(stripCountryPrefixForEdit(admitFromOpdVisit.patientPhone));
    setAdmAddress(admitFromOpdVisit.patientAddress || '');
    setAdmDoctor(admitFromOpdVisit.consultingDoctor || 'Dr. Elena Adhikari, MD');
    setAdmDiagnosis(admitFromOpdVisit.provisionalDiagnosis || admitFromOpdVisit.chiefComplaint || '');
    setAdmHideDemographics(true);
    setShowAdmitModal(true);
    setSubTab('admitted');
    onClearOpdHandoff?.();
  }, [admitFromOpdVisit, beds, availableBeds, onClearOpdHandoff]);

  useEffect(() => {
    if (!preselectedPatient) return;
    setAdmBedId(availableBeds[0]?.id || '');
    setAdmLinkedOpdId(undefined);
    setAdmPatientId(preselectedPatient.id);
    setAdmUhid(preselectedPatient.uhid);
    setAdmName(preselectedPatient.fullName);
    setAdmAge(String(preselectedPatient.age));
    setAdmAgeType(preselectedPatient.ageType);
    setAdmGender(preselectedPatient.gender);
    setAdmPhone(stripCountryPrefixForEdit(preselectedPatient.phone));
    setAdmAddress(preselectedPatient.address || '');
    setAdmHideDemographics(true);
    setShowAdmitModal(true);
    setSubTab('admitted');
    onClearPreselectedPatient?.();
  }, [preselectedPatient, availableBeds, onClearPreselectedPatient]);

  // Transfer Bed State
  const [transferTargetBedId, setTransferTargetBedId] = useState('');
  const [transferReason, setTransferReason] = useState('');
  const [transferring, setTransferring] = useState(false);

  // Used Medicine Form State
  const [medId, setMedId] = useState(db.pharmacyMedicines[0]?.id || '');
  const [medCustom, setMedCustom] = useState('');
  const [medDose, setMedDose] = useState('1g IV BD');
  const [medQty, setMedQty] = useState('1');
  const [medFefo, setMedFefo] = useState(
    db.settings.moduleSettings?.autoDeductIpdMedFromPharmacyFefo ?? true
  );
  const [loggingMed, setLoggingMed] = useState(false);

  // Investigation Form State
  const [invSrvId, setInvSrvId] = useState(db.services[0]?.id || '');
  const [invStatus, setInvStatus] = useState<'Ordered' | 'Sample Collected' | 'Completed'>('Ordered');
  const [invFinding, setInvFinding] = useState('');
  const [invAutoOrder, setInvAutoOrder] = useState(true);
  const [loggingInv, setLoggingInv] = useState(false);

  // Deposit / Note State
  const [depAmount, setDepAmount] = useState('');
  const [depMode, setDepMode] = useState<PaymentMode>('Cash');
  const [depNote, setDepNote] = useState('');
  const [progressNoteText, setProgressNoteText] = useState('');
  const [progressNoteShift, setProgressNoteShift] = useState<'Morning' | 'Afternoon' | 'Night'>(
    activeUser.shift?.startsWith('Night')
      ? 'Night'
      : activeUser.shift?.startsWith('Afternoon')
      ? 'Afternoon'
      : 'Morning'
  );
  const [progressNoteRoundTime, setProgressNoteRoundTime] = useState(() =>
    new Date().toTimeString().slice(0, 5)
  );
  const [savingDepNote, setSavingDepNote] = useState(false);

  // Final Deposition / External Referral State
  const [depOutcome, setDepOutcome] = useState<IpdDispositionType>('Discharged');
  const [finalDx, setFinalDx] = useState('');
  const [courseSummary, setCourseSummary] = useState('');
  const [condText, setCondText] = useState('Stable, afebrile, vitals within normal limits');
  const [adviceText, setAdviceText] = useState('Continue prescribed medicines & follow up as scheduled.');
  const [followUpBs, setFollowUpBs] = useState('After 7 days in OPD');
  const [bedDays, setBedDays] = useState('1');
  const [doctorRounds, setDoctorRounds] = useState('1');
  const [nursingDays, setNursingDays] = useState('1');
  const [observationDays, setObservationDays] = useState('1');
  const [otherCharges, setOtherCharges] = useState('500');
  const [finalSettleAmt, setFinalSettleAmt] = useState('0');
  const [finalSettleMode, setFinalSettleMode] = useState<PaymentMode>('Cash');
  const [extHospital, setExtHospital] = useState('');
  const [extPlace, setExtPlace] = useState('');
  const [extDept, setExtDept] = useState('Emergency / Tertiary Specialist Care');
  const [extReason, setExtReason] = useState('');
  const [extCondition, setExtCondition] = useState('Hemodynamically stabilized on IV access & monitoring');
  const [extTransport, setExtTransport] =
    useState<ExternalReferralDetail['transportMode']>('ALS Ambulance');
  const [extAmbulanceName, setExtAmbulanceName] = useState('Hospital ALS Ambulance');
  const [extAmbulanceNumber, setExtAmbulanceNumber] = useState('');
  const [extDepartureTime, setExtDepartureTime] = useState('');
  const [extCaseDetails, setExtCaseDetails] = useState('');
  const [extEscort, setExtEscort] = useState('Duty Medical Officer + Paramedic');
  const [finalizingDep, setFinalizingDep] = useState(false);

  // Nursing Chart State
  const [ncShift, setNcShift] = useState<NursingChartEntry['shift']>('Morning');
  const [ncBp, setNcBp] = useState('120/80');
  const [ncPulse, setNcPulse] = useState('82');
  const [ncTemp, setNcTemp] = useState('98.6');
  const [ncSpo2, setNcSpo2] = useState('98');
  const [ncResp, setNcResp] = useState('18');
  const [ncGcs, setNcGcs] = useState('15/15');
  const [ncPain, setNcPain] = useState('2');
  const [ncInOral, setNcInOral] = useState('400');
  const [ncInIv, setNcInIv] = useState('500');
  const [ncOutUrine, setNcOutUrine] = useState('650');
  const [ncOutDrain, setNcOutDrain] = useState('0');
  const [ncNote, setNcNote] = useState('');
  const [savingNc, setSavingNc] = useState(false);
  const [printNursingAdm, setPrintNursingAdm] = useState<IpdAdmission | null>(null);
  const [printStickerAdm, setPrintStickerAdm] = useState<IpdAdmission | null>(null);
  const [printBedSummary, setPrintBedSummary] = useState(false);

  // Nursing Round & Observation Fee State
  const nursingObsTypes = useMemo(() => {
    const list = modSettings?.nursingObservationTypes;
    return list && list.length > 0
      ? list
      : [
          { id: 'nobs-vitals', name: 'Nursing Round & Vitals Observation', defaultFeeNpr: 200 },
          { id: 'nobs-iv', name: 'IV Cannulation & Infusion Monitoring', defaultFeeNpr: 300 },
          { id: 'nobs-dress', name: 'Wound Dressing & Post-Op Observation', defaultFeeNpr: 400 },
          { id: 'nobs-icu', name: 'Intensive Ward Continuous Observation', defaultFeeNpr: 600 },
        ];
  }, [modSettings?.nursingObservationTypes]);
  const [obsType, setObsType] = useState(nursingObsTypes[0]?.name || 'Nursing Round & Vitals Observation');
  const [obsRoundTime, setObsRoundTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [obsShift, setObsShift] = useState<'Morning' | 'Afternoon' | 'Night'>('Morning');
  const [obsDurationHrs, setObsDurationHrs] = useState('1');
  const [obsFeeNpr, setObsFeeNpr] = useState(String(nursingObsTypes[0]?.defaultFeeNpr ?? 200));
  const [obsNotes, setObsNotes] = useState('');
  const [savingObs, setSavingObs] = useState(false);

  // Case Consent State
  const [consentSigner, setConsentSigner] = useState('');
  const [consentRelation, setConsentRelation] = useState('Self / Guardian');
  const [newIpdConsentType, setNewIpdConsentType] = useState<HospitalConsentRecord['consentType']>('SURGERY_ANESTHESIA');
  const [signingIpdConsentId, setSigningIpdConsentId] = useState<string | null>(null);
  const [printIpdConsent, setPrintIpdConsent] = useState<{ consent: HospitalConsentRecord; adm: IpdAdmission } | null>(null);

  // Birth & Death Certificates State
  const [showBirthModal, setShowBirthModal] = useState(false);
  const [birthMother, setBirthMother] = useState('');
  const [birthMotherAge, setBirthMotherAge] = useState('24');
  const [birthFather, setBirthFather] = useState('');
  const [birthAddress, setBirthAddress] = useState('');
  const [birthGender, setBirthGender] = useState<'Male' | 'Female' | 'Other'>('Male');
  const [birthWeightKg, setBirthWeightKg] = useState('3.1');
  const [birthDeliveryType, setBirthDeliveryType] = useState<BirthCertificateRecord['deliveryType']>('Normal Vaginal Delivery');
  const [birthApgar, setBirthApgar] = useState('9/10 at 1 min, 10/10 at 5 min');
  const [birthDoctor, setBirthDoctor] = useState('Dr. Santosh Majhi, MD');
  const [birthLinkedIpdId, setBirthLinkedIpdId] = useState<string | undefined>(undefined);
  const [savingCert, setSavingCert] = useState(false);

  const [showDeathModal, setShowDeathModal] = useState(false);
  const [deathName, setDeathName] = useState('');
  const [deathAge, setDeathAge] = useState('65');
  const [deathGender, setDeathGender] = useState<PatientGender>('Male');
  const [deathKin, setDeathKin] = useState('');
  const [deathAddress, setDeathAddress] = useState('');
  const [deathImmediate, setDeathImmediate] = useState('');
  const [deathAntecedent, setDeathAntecedent] = useState('');
  const [deathManner, setDeathManner] = useState<DeathCertificateRecord['mannerOfDeath']>('Natural');
  const [deathDoctor, setDeathDoctor] = useState('Dr. Santosh Majhi, MD');
  const [deathLinkedIpdId, setDeathLinkedIpdId] = useState<string | undefined>(undefined);
  const [printCert, setPrintCert] = useState<{ type: 'BIRTH' | 'DEATH'; birthCert?: BirthCertificateRecord; deathCert?: DeathCertificateRecord } | null>(null);

  const q = searchTerm.trim().toLowerCase();

  const activeAdmissions = useMemo(
    () =>
      admissions.filter(
        (a) =>
          a.disposition === 'Admitted' &&
          (!q ||
            `${a.admissionNumber} ${a.patientName} ${a.currentBedLabel} ${a.currentWardName} ${a.admittingDiagnosis} ${a.admittingDoctor}`
              .toLowerCase()
              .includes(q))
      ),
    [admissions, q]
  );

  const historyAdmissions = useMemo(
    () =>
      admissions.filter(
        (a) =>
          a.disposition !== 'Admitted' &&
          (!q ||
            `${a.admissionNumber} ${a.patientName} ${a.disposition} ${a.externalReferral?.referredToHospital || ''} ${a.externalReferral?.referredToPlace || ''} ${a.finalDiagnosis}`
              .toLowerCase()
              .includes(q))
      ),
    [admissions, q]
  );

  const filteredBeds = useMemo(
    () =>
      beds.filter(
        (b) =>
          !q ||
          `${b.bedCode} ${b.wardName} ${b.wardType} ${b.status} ${b.currentPatientName || ''} ${b.centerName}`
            .toLowerCase()
            .includes(q)
      ),
    [beds, q]
  );

  const selectedAdm = useMemo(
    () =>
      admissions.find((a) => a.id === selectedAdmId) ||
      activeAdmissions[0] ||
      admissions[0] ||
      null,
    [admissions, selectedAdmId, activeAdmissions]
  );

  const bedMetrics = useMemo(() => {
    const total = beds.length;
    const avail = beds.filter((b) => b.status === 'Available').length;
    const occ = beds.filter((b) => b.status === 'Occupied').length;
    const clean = beds.filter((b) => b.status === 'Cleaning').length;
    const referred = admissions.filter((a) => a.disposition === 'Referred to External Hospital').length;
    return {
      total,
      avail,
      occ,
      clean,
      occPct: total > 0 ? Math.round((occ / total) * 100) : 0,
      referred,
    };
  }, [beds, admissions]);

  const wardSummaryRows = useMemo(() => {
    const map = new Map<string, { wardName: string; wardType: string; total: number; occupied: number; available: number; cleaning: number }>();
    for (const b of beds) {
      const cur = map.get(b.wardName) || {
        wardName: b.wardName,
        wardType: b.wardType,
        total: 0,
        occupied: 0,
        available: 0,
        cleaning: 0,
      };
      cur.total += 1;
      if (b.status === 'Occupied') cur.occupied += 1;
      else if (b.status === 'Available') cur.available += 1;
      else cur.cleaning += 1;
      map.set(b.wardName, cur);
    }
    return Array.from(map.values());
  }, [beds]);

  const handleLogNursingChart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    setSavingNc(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/nursing-chart`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            shift: ncShift,
            bp: ncBp.trim(),
            pulseBpm: Number(ncPulse) || 80,
            tempF: Number(ncTemp) || 98.6,
            spo2Pct: Number(ncSpo2) || 98,
            respRate: Number(ncResp) || 18,
            gcsScore: ncGcs.trim() || '15/15',
            painScore: Number(ncPain) || 0,
            intakeOralMl: Number(ncInOral) || 0,
            intakeIvMl: Number(ncInIv) || 0,
            outputUrineMl: Number(ncOutUrine) || 0,
            outputDrainMl: Number(ncOutDrain) || 0,
            nursingCareNote: ncNote.trim(),
          }),
        }
      );
      setNcNote('');
      onUpdated(resp.db, `Logged ${ncShift} nursing observation for ${resp.admission.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save nursing chart.');
    } finally {
      setSavingNc(false);
    }
  };

  const handleLogNursingObservationFee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    setSavingObs(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/nursing-observation`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            observationType: obsType,
            roundTime: obsRoundTime,
            shift: obsShift,
            durationHours: Number(obsDurationHrs) || 1,
            feeNpr: Number(obsFeeNpr) || 0,
            nurseName: activeUser.fullName,
            notes: obsNotes.trim(),
          }),
        }
      );
      setObsNotes('');
      onUpdated(
        resp.db,
        `Logged ${obsType} (${obsShift} @ ${obsRoundTime} — ${formatNpr(Number(obsFeeNpr) || 0)}) for ${resp.admission.patientName}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to log nursing observation fee.');
    } finally {
      setSavingObs(false);
    }
  };

  const handleSignIpdConsent = async (consentId: string) => {
    if (!selectedAdm) return;
    setSigningIpdConsentId(consentId);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/consents/ipd/${selectedAdm.id}`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'SIGN',
            consentId,
            patientOrGuardianName: consentSigner.trim() || selectedAdm.emergencyContact || selectedAdm.patientName,
            relationship: consentRelation.trim() || 'Self / Guardian',
            witnessName: activeUser.fullName,
          }),
        }
      );
      onUpdated(resp.db, `Signed consent for ${selectedAdm.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to sign consent.');
    } finally {
      setSigningIpdConsentId(null);
    }
  };

  const handleAddIpdConsent = async () => {
    if (!selectedAdm) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/consents/ipd/${selectedAdm.id}`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ action: 'ADD', consentType: newIpdConsentType }),
        }
      );
      onUpdated(resp.db, `Added ${newIpdConsentType} consent to ${selectedAdm.admissionNumber}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to add consent.');
    }
  };

  const handleIssueBirthCert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!birthMother.trim()) return;
    setSavingCert(true);
    try {
      const nowIso = new Date().toISOString();
      const bsNow = adToBs(nowIso);
      const resp = await apiRequest<{ certificate: BirthCertificateRecord; db: LimsDatabase }>(
        '/api/certificates/birth',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            linkedIpdAdmissionId: birthLinkedIpdId,
            motherName: birthMother.trim(),
            motherAge: Number(birthMotherAge) || 24,
            fatherName: birthFather.trim(),
            permanentAddress: birthAddress.trim(),
            babyGender: birthGender,
            birthWeightKg: Number(birthWeightKg) || 3.0,
            deliveryType: birthDeliveryType,
            apgar1Min: 8,
            apgar5Min: 9,
            attendingDoctor: birthDoctor.trim(),
            birthDateAd: nowIso.slice(0, 10),
            birthDateBs: bsNow.formattedEn,
            birthTime: bsNow.timeEn,
          }),
        }
      );
      setShowBirthModal(false);
      setBirthMother('');
      setBirthFather('');
      setBirthLinkedIpdId(undefined);
      setSubTab('certificates');
      onUpdated(resp.db, `Issued Birth Certificate ${resp.certificate.certificateNumber}.`);
      setPrintCert({ type: 'BIRTH', birthCert: resp.certificate });
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to issue birth certificate.');
    } finally {
      setSavingCert(false);
    }
  };

  const handleIssueDeathCert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deathName.trim() || !deathImmediate.trim()) return;
    setSavingCert(true);
    try {
      const nowIso = new Date().toISOString();
      const bsNow = adToBs(nowIso);
      const resp = await apiRequest<{ certificate: DeathCertificateRecord; db: LimsDatabase }>(
        '/api/certificates/death',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            linkedIpdAdmissionId: deathLinkedIpdId,
            deceasedName: deathName.trim(),
            age: Number(deathAge) || 60,
            gender: deathGender,
            fatherOrSpouseName: deathKin.trim(),
            permanentAddress: deathAddress.trim(),
            immediateCauseOfDeath: deathImmediate.trim(),
            antecedentCause: deathAntecedent.trim(),
            mannerOfDeath: deathManner,
            certifyingDoctor: deathDoctor.trim(),
            deathDateAd: nowIso.slice(0, 10),
            deathDateBs: bsNow.formattedEn,
            deathTime: bsNow.timeEn,
          }),
        }
      );
      setShowDeathModal(false);
      setDeathName('');
      setDeathImmediate('');
      setDeathLinkedIpdId(undefined);
      setSubTab('certificates');
      onUpdated(resp.db, `Issued Death Certificate ${resp.certificate.certificateNumber}.`);
      setPrintCert({ type: 'DEATH', deathCert: resp.certificate });
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to issue death certificate.');
    } finally {
      setSavingCert(false);
    }
  };

  const handleAddBed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageBeds || !bedNumber.trim()) return;
    setSavingBed(true);
    try {
      const resp = await apiRequest<{ bed: HospitalBed; db: LimsDatabase }>('/api/ipd/beds', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          wardName: bedWardName,
          wardType: bedWardType,
          bedCode: bedNumber.trim(),
          floorLabel: bedFloor,
          dailyRateNpr: Number(bedRate) || 1500,
          hasOxygen: bedO2,
          hasMonitor: bedMonitor,
          centerId: bedCenterId || null,
        }),
      });
      setShowAddBedModal(false);
      setBedNumber('');
      onUpdated(resp.db, `Added hospital bed ${resp.bed.bedCode} (${resp.bed.wardName}).`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to add bed.');
    } finally {
      setSavingBed(false);
    }
  };

  const handleUpdateBedStatus = async (bed: HospitalBed, status: HospitalBed['status']) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/ipd/beds/${bed.id}`, activeUser.id, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onUpdated(resp.db, `Bed ${bed.bedCode} marked as ${status}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update bed status.');
    }
  };

  const handleAdmitSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedName =
      admName.trim() || (ipdFieldRule('patientName') === 'HIDDEN' ? 'IPD Admitted Patient' : '');
    const resolvedDiagnosis =
      admDiagnosis.trim() ||
      (ipdFieldRule('admittingDiagnosis') === 'HIDDEN' ? 'Inpatient Medical Care' : '');
    const resolvedDoctor =
      admDoctor === '__CUSTOM__'
        ? admDoctorCustom.trim() || 'Admitting Medical Officer'
        : admDoctor.trim() || 'Admitting Medical Officer';
    if (!canClinical || !admBedId || !resolvedName) return;
    setAdmitting(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        '/api/ipd/admissions',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            bedId: admBedId,
            linkedOpdVisitId: admLinkedOpdId,
            patientId: admPatientId || undefined,
            uhid: admUhid || undefined,
            patientName: resolvedName,
            patientAge: Number(admAge) || 35,
            patientAgeType: admAgeType,
            patientGender: admGender,
            patientPhone: normalizeNepalPhone(admPhone),
            patientAddress: admAddress.trim() || 'Rajbiraj, Saptari',
            emergencyContact: admEmergency.trim(),
            admittingDoctor: resolvedDoctor,
            admittingDiagnosis: resolvedDiagnosis,
            admissionFeeNpr: Math.max(0, Number(admAdmissionFee) || 0),
            admissionPaymentMode: admAdmissionPayMode,
            initialDepositNpr: Number(admDeposit) || 0,
            depositPaymentMode: admPayMode,
          }),
        }
      );
      setShowAdmitModal(false);
      setAdmPatientId('');
      setAdmUhid('');
      setAdmPatientSearch('');
      setAdmHideDemographics(false);
      setAdmName('');
      setAdmPhone('');
      setAdmAddress('');
      setAdmDiagnosis('');
      setAdmLinkedOpdId(undefined);
      setSelectedAdmId(resp.admission.id);
      setSubTab('admitted');
      if (printReceiptOnlyOnAdmit) {
        setPrintFeeReceiptAdm(resp.admission);
      }
      onUpdated(
        resp.db,
        `Admitted ${resp.admission.patientName} (${resp.admission.admissionNumber}) to Bed ${resp.admission.currentBedLabel} · Adm Fee ${admAdmissionPayMode}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Admission failed.');
    } finally {
      setAdmitting(false);
    }
  };

  const openTransferModal = () => {
    if (!selectedAdm) return;
    const sameHubAvail = beds.filter(
      (b) => b.status === 'Available' && b.centerId === selectedAdm.centerId && b.id !== selectedAdm.currentBedId
    );
    setTransferTargetBedId(sameHubAvail[0]?.id || '');
    setTransferReason('');
    setShowTransferModal(true);
  };

  const handleTransferBed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !transferTargetBedId) return;
    setTransferring(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/transfer-bed`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            targetBedId: transferTargetBedId,
            reason: transferReason.trim() || 'Clinical escalation / ward transfer',
          }),
        }
      );
      setShowTransferModal(false);
      onUpdated(
        resp.db,
        `Transferred ${resp.admission.patientName} to Bed ${resp.admission.currentBedLabel}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Bed transfer failed.');
    } finally {
      setTransferring(false);
    }
  };

  const handleLogMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    setLoggingMed(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/medicines`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            medicineId: medCustom.trim() ? undefined : medId,
            customMedicineName: medCustom.trim() || undefined,
            dosageRoute: medDose.trim(),
            quantity: Number(medQty) || 1,
            deductFromPharmacyFefo: medFefo,
          }),
        }
      );
      setMedCustom('');
      onUpdated(resp.db, `Logged used medicine for ${resp.admission.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to log medicine.');
    } finally {
      setLoggingMed(false);
    }
  };

  const handleLogInvestigation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    setLoggingInv(true);
    try {
      const resp = await apiRequest<{
        admission: IpdAdmission;
        linkedOrder?: { accessionNumber: string } | null;
        db: LimsDatabase;
      }>(`/api/ipd/admissions/${selectedAdm.id}/investigations`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          serviceId: invSrvId,
          status: invStatus,
          summaryFinding: invFinding.trim(),
          createDiagnosticOrder: invAutoOrder,
        }),
      });
      setInvFinding('');
      onUpdated(
        resp.db,
        `Logged investigation for ${resp.admission.patientName}${
          resp.linkedOrder ? ` (Order ${resp.linkedOrder.accessionNumber})` : ''
        }.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to log investigation.');
    } finally {
      setLoggingInv(false);
    }
  };

  const handleAddDepositOrNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    if (!depAmount && !progressNoteText.trim()) return;
    setSavingDepNote(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/deposit`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            amountNpr: Number(depAmount) || 0,
            paymentMode: depMode,
            notes: depNote.trim(),
            progressNote: progressNoteText.trim(),
            shift: progressNoteShift,
            roundTime: progressNoteRoundTime.trim() || undefined,
          }),
        }
      );
      setDepAmount('');
      setDepNote('');
      setProgressNoteText('');
      onUpdated(resp.db, `Updated inpatient record for ${resp.admission.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save deposit/note.');
    } finally {
      setSavingDepNote(false);
    }
  };

  const handleRequestIpdCreditLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm) return;
    setRequestingCredit(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        '/api/approvals/discount-credit',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            requestType: 'CREDIT_LIMIT',
            module: 'IPD',
            patientName: selectedAdm.patientName,
            uhid: selectedAdm.uhid || selectedAdm.admissionNumber,
            referenceId: selectedAdm.id,
            referenceNumber: selectedAdm.admissionNumber,
            requestedAmountNpr: Math.max(1000, Number(reqCreditAmt) || 75000),
            currentLimitOrBillNpr: selectedAdm.creditLimitNpr || ipdDefaultCreditLimitNpr,
            reason: reqCreditRemark.trim() || `IPD credit extension requested for ${selectedAdm.patientName}`,
          }),
        }
      );
      setReqCreditRemark('');
      onUpdated(resp.db, `Submitted IPD credit limit increase request for Manager/Admin approval.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to submit credit approval request.');
    } finally {
      setRequestingCredit(false);
    }
  };

  const recalcDepositionSettlement = (
    adm: IpdAdmission,
    daysStr: string,
    roundsStr: string,
    nursingStr: string,
    obsStr: string,
    otherStr: string
  ) => {
    const d = Math.max(1, Number(daysStr) || 1);
    const r = Math.max(0, Number(roundsStr) || 0);
    const n = Math.max(0, Number(nursingStr) || 0);
    const obsD = Math.max(0, Number(obsStr) || 0);
    const o = Math.max(0, Number(otherStr) || 0);
    const directSum = (adm.directServiceCharges || []).reduce(
      (s, x) => s + (Number(x.amountNpr) || 0),
      0
    );
    const indivPaid = (adm.ipdIndividualBills || []).reduce(
      (s, x) => s + (Number(x.amountNpr) || 0),
      0
    );
    const estTotal =
      (Number(adm.admissionFeeNpr) || 0) +
      d * adm.bedDailyRateNpr +
      r * ipdRoundFeeNpr +
      n * ipdNursingFeePerDayNpr +
      obsD * ipdDailyObsFeeNpr +
      (Number(adm.nursingObservationChargesNpr) || 0) +
      directSum +
      adm.medicinesTotalNpr +
      adm.investigationsTotalNpr +
      o;
    setFinalSettleAmt(String(Math.max(0, Math.round(estTotal - adm.totalDepositPaidNpr - indivPaid))));
  };

  const [extHospitalId, setExtHospitalId] = useState('');
  const [extManagerName, setExtManagerName] = useState('');
  const [extManagerPhone, setExtManagerPhone] = useState('');
  const [extAmbulanceId, setExtAmbulanceId] = useState('');
  const [extCaseType, setExtCaseType] = useState('GENERAL');

  const openDepositionModal = () => {
    if (!selectedAdm) return;
    const autoSummary = computeIpdDailyAutoCharges(selectedAdm, modSettings, selectedAdm.dischargedAt);
    const daysStr = String(autoSummary.bedDaysBilled);
    const roundsStr = String(autoSummary.doctorRoundsCount);
    const nursingStr = String(autoSummary.nursingDaysBilled);
    const obsStr = String(autoSummary.observationDaysBilled);
    const otherStr = String(selectedAdm.otherProcedureChargesNpr || 0);
    setBedDays(daysStr);
    setDoctorRounds(roundsStr);
    setNursingDays(nursingStr);
    setObservationDays(obsStr);
    setOtherCharges(otherStr);
    setFinalDx(selectedAdm.finalDiagnosis || selectedAdm.admittingDiagnosis);
    setCourseSummary(selectedAdm.hospitalCourseSummary || '');
    setDepOutcome('Discharged');
    setExtHospitalId('');
    setExtHospital('');
    setExtPlace('');
    setExtManagerName('');
    setExtManagerPhone('');
    setExtAmbulanceId('');
    setExtCaseType('GENERAL');
    setExtReason('');
    setExtAmbulanceName('Hospital ALS Ambulance');
    setExtAmbulanceNumber('');
    setExtDepartureTime(
      new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
    setExtCaseDetails(
      selectedAdm.hospitalCourseSummary || `${selectedAdm.admittingDiagnosis} — Ward stabilization notes`
    );
    recalcDepositionSettlement(selectedAdm, daysStr, roundsStr, nursingStr, obsStr, otherStr);
    setShowDepositionModal(true);
  };

  const openQuickDischargeSummary = (adm: IpdAdmission) => {
    setQuickSummaryText(
      adm.hospitalCourseSummary?.trim()
        ? adm.hospitalCourseSummary
        : buildQuickDischargeSummary(adm, modSettings)
    );
    setCopiedQuickSummary(false);
    setShowQuickSummaryModal(true);
  };

  const handleApproveCreditLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canApproveAdmin) return;
    setApprovingCredit(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/approve-credit`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            newCreditLimitNpr: Math.max(1000, Number(newCreditLimitInput) || ipdDefaultCreditLimitNpr),
            note: creditApproveNote.trim() || 'Admin credit ceiling extension approved',
          }),
        }
      );
      setCreditApproveNote('');
      onUpdated(
        resp.db,
        `Admin approved IPD credit limit (${formatNpr(resp.admission.creditLimitNpr || 0)}) for ${resp.admission.patientName}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Credit approval failed.');
    } finally {
      setApprovingCredit(false);
    }
  };

  const handleLogMar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical || !marMedName.trim()) return;
    setSavingMar(true);
    try {
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/mar`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            medicineName: marMedName.trim(),
            doseRoute: marDoseRoute.trim() || 'As ordered',
            status: marStatus,
            note: marNote.trim(),
          }),
        }
      );
      setMarMedName('');
      setMarNote('');
      onUpdated(resp.db, `Recorded MAR (${marStatus}) for ${resp.admission.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to record MAR entry.');
    } finally {
      setSavingMar(false);
    }
  };

  const handlePayExistingItemCash = async (
    category: IpdIndividualCashBill['category'],
    itemLabel: string,
    amountNpr: number,
    paymentMode: 'Cash' | 'Bank / QR' = 'Cash',
    referenceItemId?: string
  ) => {
    if (!selectedAdm || !canClinical || amountNpr <= 0) return;
    setPayingItemBusy(true);
    try {
      const resp = await apiRequest<{
        cashBill: IpdIndividualCashBill | null;
        admission: IpdAdmission;
        db: LimsDatabase;
      }>(`/api/ipd/admissions/${selectedAdm.id}/pay-item`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'SETTLE_EXISTING',
          category,
          itemLabel,
          amountNpr,
          paymentMode,
          referenceItemId,
        }),
      });
      onUpdated(
        resp.db,
        `Issued IPD Cash Bill ${resp.cashBill?.billNumber || ''} (${formatNpr(amountNpr)}) for ${itemLabel}.`
      );
      if (resp.cashBill) {
        setPrintIndividualBill({ admission: resp.admission, bill: resp.cashBill });
      }
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to settle IPD item.');
    } finally {
      setPayingItemBusy(false);
    }
  };

  const handleAddIpdDirectCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    const amt = Number(addChargeAmt) || 0;
    if (!addChargeLabel.trim() || amt <= 0) return;
    setPayingItemBusy(true);
    try {
      const resp = await apiRequest<{
        cashBill: IpdIndividualCashBill | null;
        admission: IpdAdmission;
        db: LimsDatabase;
      }>(`/api/ipd/admissions/${selectedAdm.id}/pay-item`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          mode: 'ADD_CHARGE',
          category: addChargeCategory,
          itemLabel: addChargeLabel.trim(),
          amountNpr: amt,
          paymentMode: addChargePayMode,
          notes: addChargeNotes.trim() || undefined,
        }),
      });
      setAddChargeLabel('');
      setAddChargeAmt('');
      setAddChargeNotes('');
      onUpdated(
        resp.db,
        addChargePayMode === 'Credit'
          ? `Added IPD Credit Charge "${addChargeLabel.trim()}" (${formatNpr(amt)}).`
          : `Issued IPD Cash Bill ${resp.cashBill?.billNumber || ''} (${formatNpr(amt)}).`
      );
      if (resp.cashBill) {
        setPrintIndividualBill({ admission: resp.admission, bill: resp.cashBill });
      }
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to record IPD service charge.');
    } finally {
      setPayingItemBusy(false);
    }
  };

  const handleSaveIpdTariffs = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingIpdTariff(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/settings', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({
          moduleSettings: {
            ...(db.settings?.moduleSettings || {}),
            ipdBedCycleStartTime: draftCycleStart.trim() || '07:00',
            ipdBedCycleEndTime: draftCycleEnd.trim() || '19:00',
            ipdBedChargeScheduleMode: draftBedScheduleMode,
            ipdDoctorRoundFeeNpr: Math.max(0, Number(draftRoundFee) || 0),
            ipdDoctorRoundBasis: draftRoundBasis,
            ipdDoctorRoundsPerDay: Math.max(1, Number(draftRoundRoundsPerDay) || 1),
            ipdDoctorRoundScheduleTimes: draftRoundScheduleTimes.trim() || '09:00',
            ipdNursingChargePerDayNpr: Math.max(0, Number(draftNursingFee) || 0),
            ipdNursingChargeBasis: draftNursingBasis,
            ipdNursingRoundsPerDay: Math.max(1, Number(draftNursingRoundsPerDay) || 1),
            ipdNursingScheduleTimes: draftNursingScheduleTimes.trim() || '08:00, 20:00',
            ipdDailyObservationFeeNpr: Math.max(0, Number(draftObsFee) || 0),
            ipdObservationChargeBasis: draftObsBasis,
            ipdObservationRoundsPerDay: Math.max(1, Number(draftObsRoundsPerDay) || 1),
            ipdObservationScheduleTimes: draftObsScheduleTimes.trim() || '08:00, 20:00',
            ipdAdmissionFeeNpr: Math.max(0, Number(draftAdmissionFee) || 0),
            ipdDefaultCreditLimitNpr: Math.max(1000, Number(draftCreditLimit) || 50000),
          },
        }),
      });
      setShowIpdTariffModal(false);
      onUpdated(
        resp.db,
        `Updated IPD bed cycle (${draftCycleStart}–${draftCycleEnd}, ${draftBedScheduleMode}), Per-Day/Round Tariffs & Schedule Times.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update IPD tariffs.');
    } finally {
      setSavingIpdTariff(false);
    }
  };

  const handleFinalizeDeposition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAdm || !canClinical) return;
    setFinalizingDep(true);
    try {
      const needsExternal =
        depOutcome === 'Referred to External Hospital' || depOutcome === 'Transferred to Ward/Hub';
      const resp = await apiRequest<{ admission: IpdAdmission; db: LimsDatabase }>(
        `/api/ipd/admissions/${selectedAdm.id}/deposition`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            disposition: depOutcome,
            finalDiagnosis: finalDx.trim(),
            hospitalCourseSummary: courseSummary.trim(),
            dischargeCondition: condText.trim(),
            dischargeAdvice: adviceText.trim(),
            followUpDateBs: followUpBs.trim(),
            bedDaysBilled: Number(bedDays) || 1,
            doctorRoundsCount: Math.max(0, Number(doctorRounds) || 0),
            nursingDaysBilled: Math.max(0, Number(nursingDays) || 0),
            observationDaysBilled: Math.max(0, Number(observationDays) || 0),
            otherProcedureChargesNpr: Number(otherCharges) || 0,
            finalSettlementAmountNpr: Number(finalSettleAmt) || 0,
            settlementPaymentMode: finalSettleMode,
            ...(needsExternal
              ? {
                  externalReferral: {
                    referredHospitalId: extHospitalId || undefined,
                    referredToHospital: extHospital.trim(),
                    referredToPlace: extPlace.trim(),
                    referredHospitalManagerName: extManagerName.trim() || undefined,
                    referredHospitalManagerPhone: extManagerPhone.trim() || undefined,
                    referredDepartment: extDept.trim(),
                    referralCaseType: extCaseType,
                    referralReason: extReason.trim() || finalDx.trim(),
                    conditionAtReferral: extCondition.trim(),
                    transportMode: extTransport,
                    ambulanceId: extAmbulanceId || undefined,
                    ambulanceName: extAmbulanceName.trim(),
                    ambulanceNumber: extAmbulanceNumber.trim(),
                    departureTime: extDepartureTime.trim(),
                    caseDetails: extCaseDetails.trim(),
                    escortDoctorOrNurse: extEscort.trim(),
                    referredAt: new Date().toISOString(),
                    referredBy: activeUser.fullName,
                  },
                }
              : {}),
          }),
        }
      );
      setShowDepositionModal(false);
      onUpdated(
        resp.db,
        `Finalized IPD Deposition for ${resp.admission.patientName}: ${resp.admission.disposition}.`
      );
      setPrintAdmission(resp.admission);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to finalize deposition.');
    } finally {
      setFinalizingDep(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            IPD Inpatient Care, Ward/Bed Management &amp; External Referral Deposition
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time ward beds, admission &amp; bed transfers, FEFO inpatient used medicines, investigations done, and printable A4 Deposition &amp; Referral Summaries
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(canManageBeds || hasPerm('settings.manage')) && (
            <button
              type="button"
              onClick={() => {
                setDraftCycleStart(ipdCycleStart);
                setDraftCycleEnd(ipdCycleEnd);
                setDraftBedScheduleMode(ipdBedScheduleMode);
                setDraftRoundFee(String(ipdRoundFeeNpr));
                setDraftRoundBasis(ipdRoundBasis);
                setDraftRoundRoundsPerDay(String(ipdRoundRoundsPerDay));
                setDraftRoundScheduleTimes(ipdRoundScheduleTimes);
                setDraftNursingFee(String(ipdNursingFeePerDayNpr));
                setDraftNursingBasis(ipdNursingBasis);
                setDraftNursingRoundsPerDay(String(ipdNursingRoundsPerDay));
                setDraftNursingScheduleTimes(ipdNursingScheduleTimes);
                setDraftObsFee(String(ipdDailyObsFeeNpr));
                setDraftObsBasis(ipdObsBasis);
                setDraftObsRoundsPerDay(String(ipdObsRoundsPerDay));
                setDraftObsScheduleTimes(ipdObsScheduleTimes);
                setDraftAdmissionFee(String(ipdAdmissionFeeNpr));
                setDraftCreditLimit(String(ipdDefaultCreditLimitNpr));
                setShowIpdTariffModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              IPD Tariff &amp; Credit Limit
            </button>
          )}
          {canManageBeds && (
            <button
              type="button"
              onClick={() => setShowAddBedModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Ward / Bed
            </button>
          )}
          {canClinical && (
            <button
              type="button"
              onClick={() => {
                setAdmLinkedOpdId(undefined);
                setAdmBedId(availableBeds[0]?.id || '');
                setShowAdmitModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <BedDouble className="w-3.5 h-3.5" />
              Admit IPD Patient
            </button>
          )}
        </div>
      </div>

      {/* Dynamic IPD Bed Cycle & Auto Daily Service Tariff Strip */}
      <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3.5">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-700">
            <Clock className="w-3.5 h-3.5 text-blue-600" />
            Bed Cycle ({ipdBedScheduleMode}):{' '}
            <strong className="font-mono text-slate-900">
              {ipdCycleStart} – {ipdCycleEnd}
            </strong>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-700">
            Dr Round:{' '}
            <strong className="font-mono text-slate-900">
              {formatNpr(ipdRoundFeeNpr)}/{ipdRoundBasis === 'PER_ROUND' ? `round (${ipdRoundRoundsPerDay}/d @ ${ipdRoundScheduleTimes})` : `day (${ipdRoundScheduleTimes})`}
            </strong>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-700">
            Nursing:{' '}
            <strong className="font-mono text-slate-900">
              {formatNpr(ipdNursingFeePerDayNpr)}/{ipdNursingBasis === 'PER_ROUND' ? `round (${ipdNursingRoundsPerDay}/d @ ${ipdNursingScheduleTimes})` : `day (${ipdNursingScheduleTimes})`}
            </strong>
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-700">
            Obs:{' '}
            <strong className="font-mono text-slate-900">
              {formatNpr(ipdDailyObsFeeNpr)}/{ipdObsBasis === 'PER_ROUND' ? `round (${ipdObsRoundsPerDay}/d @ ${ipdObsScheduleTimes})` : `day (${ipdObsScheduleTimes})`}
            </strong>
          </span>
        </div>
        {(canManageBeds || hasPerm('settings.manage')) && (
          <button
            type="button"
            onClick={() => {
              setDraftCycleStart(ipdCycleStart);
              setDraftCycleEnd(ipdCycleEnd);
              setDraftBedScheduleMode(ipdBedScheduleMode);
              setDraftRoundFee(String(ipdRoundFeeNpr));
              setDraftRoundBasis(ipdRoundBasis);
              setDraftRoundRoundsPerDay(String(ipdRoundRoundsPerDay));
              setDraftRoundScheduleTimes(ipdRoundScheduleTimes);
              setDraftNursingFee(String(ipdNursingFeePerDayNpr));
              setDraftNursingBasis(ipdNursingBasis);
              setDraftNursingRoundsPerDay(String(ipdNursingRoundsPerDay));
              setDraftNursingScheduleTimes(ipdNursingScheduleTimes);
              setDraftObsFee(String(ipdDailyObsFeeNpr));
              setDraftObsBasis(ipdObsBasis);
              setDraftObsRoundsPerDay(String(ipdObsRoundsPerDay));
              setDraftObsScheduleTimes(ipdObsScheduleTimes);
              setDraftAdmissionFee(String(ipdAdmissionFeeNpr));
              setDraftCreditLimit(String(ipdDefaultCreditLimitNpr));
              setShowIpdTariffModal(true);
            }}
            className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
          >
            Edit Timing &amp; Tariffs
          </button>
        )}
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Ward Bed Capacity &amp; Occupancy</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {bedMetrics.occ} / {bedMetrics.total} Occupied ({bedMetrics.occPct}%)
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {bedMetrics.avail} Available · {bedMetrics.clean} Cleaning
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Active Admitted Patients</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
            {admissions.filter((a) => a.disposition === 'Admitted').length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Under inpatient ward care</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Discharged / Finalized</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {admissions.filter((a) => a.disposition === 'Discharged').length}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Completed deposition summaries</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Referred to External Hospitals</div>
          <div className="text-xl font-bold font-mono tabular-nums text-rose-700 mt-1">
            {bedMetrics.referred}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Recorded with destination &amp; place</div>
        </div>
      </div>

      {/* Sub-Tabs & Search */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'admitted' as IpdSubTab, label: `Admitted Inpatients (${activeAdmissions.length})` },
            { id: 'beds' as IpdSubTab, label: `Ward & Bed Summary (${beds.length})` },
            { id: 'history' as IpdSubTab, label: `Discharged & Referred (${historyAdmissions.length})` },
            {
              id: 'certificates' as IpdSubTab,
              label: `Birth & Death Certs (${(db.birthCertificates || []).length + (db.deathCertificates || []).length})`,
            },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3.5 py-2 rounded-lg font-medium border whitespace-nowrap ${
                subTab === t.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search IPD #, patient, bed #, ward, referred hospital/place..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
          />
        </div>
      </div>

      {/* TAB 1: ADMITTED INPATIENTS WORKBENCH */}
      {subTab === 'admitted' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Left list */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-800">
              Active Ward Patients ({activeAdmissions.length})
            </div>
            {activeAdmissions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No currently admitted patients match search. Check Discharged &amp; Referred Registry or admit a patient.
              </div>
            ) : (
              activeAdmissions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setSelectedAdmId(a.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    selectedAdm?.id === a.id ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-blue-700">
                      {a.admissionNumber}
                    </span>
                    <span className="font-mono text-[11px] font-semibold text-slate-800">
                      Bed {a.currentBedLabel}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 mt-0.5">{a.patientName}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {a.currentWardName} · {a.admittingDoctor}
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-600 mt-1">
                    Bill {formatNpr(a.totalBillNpr)} · Paid {formatNpr(a.totalDepositPaidNpr)}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Right Patient Chart */}
          <div className="lg:col-span-8">
            {!selectedAdm ? (
              <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
                Select an admitted patient to manage Bed Transfers, Used Medicines, Investigations &amp; Deposition.
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 text-xs">
                {/* Chart Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-blue-700">
                        {selectedAdm.admissionNumber}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="text-base font-semibold text-slate-900">
                        {selectedAdm.patientName}
                      </span>
                      <span className="text-slate-500">
                        ({selectedAdm.patientAge} {selectedAdm.patientAgeType} / {selectedAdm.patientGender})
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 mt-1">
                      Ward/Bed:{' '}
                      <strong className="font-mono text-slate-900">
                        {selectedAdm.currentBedLabel} ({selectedAdm.currentWardName})
                      </strong>{' '}
                      · Rate <span className="font-mono">{formatNpr(selectedAdm.bedDailyRateNpr)}/day</span> ·{' '}
                      {selectedAdm.admittingDoctor}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5">
                      Admitting Dx: <span className="text-slate-800">{selectedAdm.admittingDiagnosis}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPrintFeeReceiptAdm(selectedAdm)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Admission Fee Receipt
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrintAdmissionSlip(selectedAdm)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Admission Slip
                    </button>
                    <button
                      type="button"
                      onClick={() => openQuickDischargeSummary(selectedAdm)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Quick Discharge Summary
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrintAdmission(selectedAdm)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print Discharge / Summary
                    </button>
                    <button
                      type="button"
                      onClick={() => setPrintStickerAdm(selectedAdm)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-indigo-700 bg-white border border-indigo-300 rounded-lg hover:bg-indigo-50 whitespace-nowrap"
                    >
                      <Tag className="w-3.5 h-3.5" />
                      Thermal Sticker
                    </button>
                    {canClinical && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setBirthMother(selectedAdm.patientName);
                            setBirthMotherAge(String(selectedAdm.patientAge));
                            setBirthAddress(selectedAdm.patientAddress);
                            setBirthLinkedIpdId(selectedAdm.id);
                            setShowBirthModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
                        >
                          <Baby className="w-3.5 h-3.5" />
                          Birth Cert
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDeathName(selectedAdm.patientName);
                            setDeathAge(String(selectedAdm.patientAge));
                            setDeathGender(selectedAdm.patientGender);
                            setDeathAddress(selectedAdm.patientAddress);
                            setDeathLinkedIpdId(selectedAdm.id);
                            setShowDeathModal(true);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 whitespace-nowrap"
                        >
                          Death Cert
                        </button>
                      </>
                    )}
                    {canClinical && selectedAdm.disposition === 'Admitted' && (
                      <>
                        <button
                          type="button"
                          onClick={openTransferModal}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-indigo-700 bg-white border border-indigo-300 rounded-lg hover:bg-indigo-50 whitespace-nowrap"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5" />
                          Transfer Bed
                        </button>
                        <button
                          type="button"
                          onClick={openDepositionModal}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 whitespace-nowrap"
                        >
                          <ClipboardCheck className="w-3.5 h-3.5" />
                          Discharge / Refer Out
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Live Auto Daily Service Charges Summary & Cycle Timing */}
                {(() => {
                  const autoCharges = computeIpdDailyAutoCharges(
                    selectedAdm,
                    modSettings,
                    selectedAdm.dischargedAt
                  );
                  return (
                    <div className="space-y-2.5">
                      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div>
                          <div className="text-[10px] uppercase text-slate-500">
                            Bed Auto-Stay ({autoCharges.bedDaysBilled}d)
                          </div>
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatNpr(autoCharges.bedChargesNpr)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            Adm Fee: {formatNpr(autoCharges.admissionFeeNpr)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-500">
                            Auto Rounds / Nur / Obs
                          </div>
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatNpr(
                              autoCharges.doctorRoundChargesNpr +
                                autoCharges.nursingChargesNpr +
                                autoCharges.autoObservationChargesNpr +
                                autoCharges.shiftObservationChargesNpr
                            )}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            {autoCharges.autoDaysCount} auto-days
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-500">
                            Used Meds ({selectedAdm.usedMedicines.length})
                          </div>
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatNpr(selectedAdm.medicinesTotalNpr)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-500">
                            Investigations ({selectedAdm.investigationsDone.length})
                          </div>
                          <div className="font-mono font-semibold text-slate-900 tabular-nums">
                            {formatNpr(selectedAdm.investigationsTotalNpr)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-500">Deposits Paid</div>
                          <div className="font-mono font-semibold text-emerald-700 tabular-nums">
                            {formatNpr(selectedAdm.totalDepositPaidNpr)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase text-slate-500">Net Balance</div>
                          <div className="font-mono font-bold text-slate-900 tabular-nums">
                            {selectedAdm.balanceDueNpr < 0
                              ? `Cr ${formatNpr(Math.abs(selectedAdm.balanceDueNpr))}`
                              : formatNpr(selectedAdm.balanceDueNpr)}
                          </div>
                        </div>
                      </div>

                      {/* Auto-Counted Daily Recurring Services Details & Timing Schedule */}
                      <div className="border border-blue-200 bg-blue-50/40 rounded-xl p-3 space-y-2 text-[11px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-blue-600" />
                            Auto-Counted Daily Services &amp; Cycle Timing ({autoCharges.cycleWindowLabel})
                          </div>
                          <div className="font-mono text-[10px] text-slate-600">
                            Admitted: <strong>{autoCharges.admittedBsLabel}</strong> &rarr; Till:{' '}
                            <strong>{autoCharges.billedTillBsLabel}</strong>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col justify-between gap-1">
                            <div>
                              <div className="text-[10px] text-slate-500">Bed Stay ({autoCharges.bedScheduleMode})</div>
                              <div className="font-mono font-semibold text-slate-900">
                                {autoCharges.bedDaysBilled}d &times; {formatNpr(autoCharges.bedDailyRateNpr)} ={' '}
                                {formatNpr(autoCharges.bedChargesNpr)}
                              </div>
                            </div>
                            {canClinical && autoCharges.bedChargesNpr > 0 && (
                              <button
                                type="button"
                                disabled={payingItemBusy}
                                onClick={() =>
                                  handlePayExistingItemCash(
                                    'BED_STAY',
                                    `Bed Stay (${autoCharges.bedDaysBilled}d · ${selectedAdm.currentBedLabel})`,
                                    autoCharges.bedChargesNpr,
                                    'Cash',
                                    `bed-${selectedAdm.id}`
                                  )
                                }
                                className="self-start px-2 py-0.5 text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                Pay Cash Bill
                              </button>
                            )}
                          </div>
                          <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col justify-between gap-1">
                            <div>
                              <div className="text-[10px] text-slate-500">
                                Nursing ({autoCharges.nursingBasis === 'PER_ROUND' ? `${autoCharges.nursingRoundsPerDay}rd/d` : 'Per Day'} · {autoCharges.nursingScheduleLabel})
                              </div>
                              <div className="font-mono font-semibold text-slate-900">
                                {autoCharges.nursingDaysBilled}{autoCharges.nursingBasis === 'PER_ROUND' ? 'rd' : 'd'} &times; {formatNpr(autoCharges.nursingChargePerDayNpr)} ={' '}
                                {formatNpr(autoCharges.nursingChargesNpr)}
                              </div>
                            </div>
                            {canClinical && autoCharges.nursingChargesNpr > 0 && (
                              <button
                                type="button"
                                disabled={payingItemBusy}
                                onClick={() =>
                                  handlePayExistingItemCash(
                                    'NURSING',
                                    `Nursing Care (${autoCharges.nursingDaysBilled} units · ${autoCharges.nursingScheduleLabel})`,
                                    autoCharges.nursingChargesNpr,
                                    'Cash',
                                    `nurs-${selectedAdm.id}`
                                  )
                                }
                                className="self-start px-2 py-0.5 text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                Pay Cash Bill
                              </button>
                            )}
                          </div>
                          <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col justify-between gap-1">
                            <div>
                              <div className="text-[10px] text-slate-500">
                                Observation ({autoCharges.observationBasis === 'PER_ROUND' ? `${autoCharges.observationRoundsPerDay}rd/d` : 'Per Day'} · {autoCharges.observationScheduleLabel})
                              </div>
                              <div className="font-mono font-semibold text-slate-900">
                                {autoCharges.observationDaysBilled}{autoCharges.observationBasis === 'PER_ROUND' ? 'rd' : 'd'} &times; {formatNpr(autoCharges.observationFeePerDayNpr)} ={' '}
                                {formatNpr(autoCharges.autoObservationChargesNpr)}
                              </div>
                            </div>
                            {canClinical && autoCharges.autoObservationChargesNpr > 0 && (
                              <button
                                type="button"
                                disabled={payingItemBusy}
                                onClick={() =>
                                  handlePayExistingItemCash(
                                    'OBSERVATION',
                                    `Observation (${autoCharges.observationDaysBilled} units · ${autoCharges.observationScheduleLabel})`,
                                    autoCharges.autoObservationChargesNpr,
                                    'Cash',
                                    `obs-${selectedAdm.id}`
                                  )
                                }
                                className="self-start px-2 py-0.5 text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                Pay Cash Bill
                              </button>
                            )}
                          </div>
                          <div className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col justify-between gap-1">
                            <div>
                              <div className="text-[10px] text-slate-500">
                                Dr Round ({autoCharges.doctorRoundBasis === 'PER_ROUND' ? `${autoCharges.doctorRoundsPerDay}rd/d` : 'Per Day'} · {autoCharges.doctorRoundScheduleLabel})
                              </div>
                              <div className="font-mono font-semibold text-slate-900">
                                {autoCharges.doctorRoundsCount}rd &times; {formatNpr(autoCharges.doctorRoundFeeNpr)} ={' '}
                                {formatNpr(autoCharges.doctorRoundChargesNpr)}
                              </div>
                            </div>
                            {canClinical && autoCharges.doctorRoundChargesNpr > 0 && (
                              <button
                                type="button"
                                disabled={payingItemBusy}
                                onClick={() =>
                                  handlePayExistingItemCash(
                                    'DOCTOR_ROUND',
                                    `Doctor Round (${autoCharges.doctorRoundsCount} visits · ${autoCharges.doctorRoundScheduleLabel})`,
                                    autoCharges.doctorRoundChargesNpr,
                                    'Cash',
                                    `dr-${selectedAdm.id}`
                                  )
                                }
                                className="self-start px-2 py-0.5 text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100"
                              >
                                Pay Cash Bill
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                          <table className="w-full text-[10px]">
                            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                              <tr>
                                <th className="p-1.5 text-left">Cycle Day</th>
                                <th className="p-1.5 text-left">Timing Window (BS)</th>
                                <th className="p-1.5 text-right">Bed</th>
                                <th className="p-1.5 text-right">Nursing</th>
                                <th className="p-1.5 text-right">Daily Obs</th>
                                <th className="p-1.5 text-right">Dr Round</th>
                                <th className="p-1.5 text-right">Day Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {autoCharges.dailyBreakdown.map((row) => (
                                <tr key={row.dayNumber}>
                                  <td className="p-1.5 font-mono font-semibold text-blue-700">
                                    Day {row.dayNumber}
                                  </td>
                                  <td className="p-1.5 font-mono text-slate-700">
                                    {row.startBsLabel} &rarr; {row.endBsLabel}
                                  </td>
                                  <td className="p-1.5 text-right font-mono tabular-nums">
                                    {formatNpr(row.bedFeeNpr)}
                                  </td>
                                  <td className="p-1.5 text-right font-mono tabular-nums">
                                    {formatNpr(row.nursingFeeNpr)}
                                  </td>
                                  <td className="p-1.5 text-right font-mono tabular-nums">
                                    {formatNpr(row.observationFeeNpr)}
                                  </td>
                                  <td className="p-1.5 text-right font-mono tabular-nums">
                                    {formatNpr(row.doctorRoundFeeNpr)}
                                  </td>
                                  <td className="p-1.5 text-right font-mono tabular-nums font-bold text-slate-900">
                                    {formatNpr(row.daySubtotalNpr)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* IPD Credit Limit Status & Admin Approval Banner */}
                {(() => {
                  const limitNpr = selectedAdm.creditLimitNpr || ipdDefaultCreditLimitNpr;
                  const netDue = Math.max(0, selectedAdm.balanceDueNpr);
                  const isOverLimit =
                    netDue > limitNpr || selectedAdm.creditApprovalStatus === 'PENDING_ADMIN_CREDIT';
                  return (
                    <div
                      className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 ${
                        isOverLimit
                          ? 'bg-rose-50/70 border-rose-300 text-rose-950'
                          : 'bg-slate-50 border-slate-200 text-slate-800'
                      }`}
                    >
                      <div className="space-y-0.5 text-[11px]">
                        <div className="font-semibold flex flex-wrap items-center gap-2">
                          <span>
                            Admission Fee:{' '}
                            <span className="font-mono">{formatNpr(selectedAdm.admissionFeeNpr || ipdAdmissionFeeNpr)}</span>
                          </span>
                          <span>·</span>
                          <span>
                            IPD Credit Ceiling:{' '}
                            <span className="font-mono">{formatNpr(limitNpr)}</span>
                          </span>
                          <span>·</span>
                          <span className="font-mono font-bold">
                            {selectedAdm.creditApprovalStatus || (isOverLimit ? 'PENDING_ADMIN_CREDIT' : 'WITHIN_LIMIT')}
                          </span>
                        </div>
                        {selectedAdm.creditApprovedBy && (
                          <div className="text-emerald-800">
                            Admin Extended by {selectedAdm.creditApprovedBy} ({selectedAdm.creditApprovalNote})
                          </div>
                        )}
                      </div>

                      {canApproveAdmin ? (
                        <form onSubmit={handleApproveCreditLimit} className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="number"
                            min={1000}
                            value={newCreditLimitInput}
                            onChange={(e) => setNewCreditLimitInput(e.target.value)}
                            className="w-24 px-2 py-1 font-mono bg-white border border-slate-300 rounded text-[11px]"
                            placeholder="New Limit"
                          />
                          <input
                            value={creditApproveNote}
                            onChange={(e) => setCreditApproveNote(e.target.value)}
                            className="w-40 px-2 py-1 bg-white border border-slate-300 rounded text-[11px]"
                            placeholder="Approval remark..."
                          />
                          <button
                            type="submit"
                            disabled={approvingCredit}
                            className="px-3 py-1 font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 whitespace-nowrap text-[11px]"
                          >
                            {approvingCredit ? 'Approving...' : 'Approve Credit Limit'}
                          </button>
                        </form>
                      ) : (
                        <form onSubmit={handleRequestIpdCreditLimit} className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="number"
                            min={1000}
                            value={reqCreditAmt}
                            onChange={(e) => setReqCreditAmt(e.target.value)}
                            className="w-24 px-2 py-1 font-mono bg-white border border-slate-300 rounded text-[11px]"
                            placeholder="Req Limit"
                          />
                          <input
                            value={reqCreditRemark}
                            onChange={(e) => setReqCreditRemark(e.target.value)}
                            className="w-40 px-2 py-1 bg-white border border-slate-300 rounded text-[11px]"
                            placeholder="Reason for limit increase..."
                          />
                          <button
                            type="submit"
                            disabled={requestingCredit}
                            className="px-3 py-1 font-semibold text-white bg-amber-600 rounded hover:bg-amber-700 whitespace-nowrap text-[11px]"
                          >
                            {requestingCredit ? 'Submitting...' : 'Request Credit Limit'}
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })()}

                {/* External referral banner if already finalized */}
                {selectedAdm.externalReferral && (
                  <div className="border border-rose-300 bg-rose-50/50 rounded-lg p-3 space-y-1">
                    <div className="font-semibold text-rose-900">
                      Referred to External Hospital: {selectedAdm.externalReferral.referredToHospital} —{' '}
                      {selectedAdm.externalReferral.referredToPlace}
                    </div>
                    <div className="text-slate-700">
                      Reason: {selectedAdm.externalReferral.referralReason} · Transport:{' '}
                      {selectedAdm.externalReferral.transportMode}
                    </div>
                  </div>
                )}

                {/* Section 1: Used Medicines Administration */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <Pill className="w-4 h-4 text-emerald-600" />
                      Used Medicines &amp; IV Fluids Administration ({selectedAdm.usedMedicines.length})
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={medFefo}
                        onChange={(e) => setMedFefo(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600"
                      />
                      Auto-Deduct FEFO Batch from Pharmacy Stock
                    </label>
                  </div>

                  {canClinical && (
                    <form onSubmit={handleLogMedicine} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <select
                        value={medId}
                        onChange={(e) => setMedId(e.target.value)}
                        className="sm:col-span-4 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        {db.pharmacyMedicines.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.brandName} {m.strength} ({formatNpr(m.defaultMrpNpr)})
                          </option>
                        ))}
                      </select>
                      <input
                        value={medCustom}
                        onChange={(e) => setMedCustom(e.target.value)}
                        placeholder="Or custom ward drug..."
                        className="sm:col-span-3 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <input
                        value={medDose}
                        onChange={(e) => setMedDose(e.target.value)}
                        placeholder="Dosage / Route"
                        className="sm:col-span-2 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <input
                        type="number"
                        min={1}
                        value={medQty}
                        onChange={(e) => setMedQty(e.target.value)}
                        className="sm:col-span-1 px-2 py-1.5 font-mono border border-slate-300 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={loggingMed}
                        className="sm:col-span-2 px-3 py-1.5 font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {loggingMed ? 'Saving...' : '+ Give Med'}
                      </button>
                    </form>
                  )}

                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-left">Medicine</th>
                          <th className="p-2 text-left">Dosage / Route</th>
                          <th className="p-2 text-left">Batch / FEFO</th>
                          <th className="p-2 text-right">Qty</th>
                          <th className="p-2 text-right">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedAdm.usedMedicines.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-3 text-center text-slate-500">
                              No inpatient medicines administered yet.
                            </td>
                          </tr>
                        ) : (
                          selectedAdm.usedMedicines.map((m) => (
                            <tr key={m.id}>
                              <td className="p-2 font-medium text-slate-900">{m.medicineName}</td>
                              <td className="p-2 text-slate-600">{m.dosageRoute}</td>
                              <td className="p-2 font-mono text-slate-600">
                                {m.batchNumber ? `${m.batchNumber} (${m.expiryDate || ''})` : 'Ward Stock'}
                              </td>
                              <td className="p-2 text-right font-mono tabular-nums">{m.quantity}</td>
                              <td className="p-2 text-right font-mono tabular-nums font-medium">
                                {formatNpr(m.totalPriceNpr)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section 2: Investigations Done */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <FlaskConical className="w-4 h-4 text-blue-600" />
                      Investigations Done (Pathology &amp; Radiology) ({selectedAdm.investigationsDone.length})
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={invAutoOrder}
                        onChange={(e) => setInvAutoOrder(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      Auto-Create STAT Diagnostic Order in Lab/Rad Queue
                    </label>
                  </div>

                  {canClinical && (
                    <form onSubmit={handleLogInvestigation} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <select
                        value={invSrvId}
                        onChange={(e) => setInvSrvId(e.target.value)}
                        className="sm:col-span-4 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        {db.services.map((s) => (
                          <option key={s.id} value={s.id}>
                            [{s.serviceCategory === 'RADIOLOGY' ? 'RAD' : 'LAB'}] {s.code} — {s.name} ({formatNpr(s.price)})
                          </option>
                        ))}
                      </select>
                      <select
                        value={invStatus}
                        onChange={(e) =>
                          setInvStatus(e.target.value as 'Ordered' | 'Sample Collected' | 'Completed')
                        }
                        className="sm:col-span-2 px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Ordered">Ordered</option>
                        <option value="Sample Collected">Sample Collected</option>
                        <option value="Completed">Completed</option>
                      </select>
                      <input
                        value={invFinding}
                        onChange={(e) => setInvFinding(e.target.value)}
                        placeholder="Findings / Key report impression..."
                        className="sm:col-span-4 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={loggingInv}
                        className="sm:col-span-2 px-3 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                      >
                        {loggingInv ? 'Logging...' : '+ Add Study'}
                      </button>
                    </form>
                  )}

                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-left">Test / Study</th>
                          <th className="p-2 text-left">Accession #</th>
                          <th className="p-2 text-left">Status</th>
                          <th className="p-2 text-left">Findings</th>
                          <th className="p-2 text-right">Fee / Cash Bill</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedAdm.investigationsDone.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-3 text-center text-slate-500">
                              No investigations logged for this admission yet.
                            </td>
                          </tr>
                        ) : (
                          selectedAdm.investigationsDone.map((inv) => {
                            const paidInvBill = (selectedAdm.ipdIndividualBills || []).find(
                              (b) => b.referenceItemId === inv.id
                            );
                            return (
                              <tr key={inv.id}>
                                <td className="p-2 font-medium text-slate-900">
                                  <span className="font-mono text-slate-500">[{inv.category}]</span> {inv.serviceCode} —{' '}
                                  {inv.serviceName}
                                </td>
                                <td className="p-2 font-mono text-blue-700">{inv.linkedAccessionNumber || '—'}</td>
                                <td className="p-2">{inv.status}</td>
                                <td className="p-2 text-slate-600">{inv.summaryFinding || '—'}</td>
                                <td className="p-2 text-right font-mono tabular-nums space-x-2">
                                  <span>{formatNpr(inv.priceNpr)}</span>
                                  {paidInvBill ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPrintIndividualBill({ admission: selectedAdm, bill: paidInvBill })
                                      }
                                      className="inline-block px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded"
                                    >
                                      {paidInvBill.billNumber}
                                    </button>
                                  ) : (
                                    canClinical &&
                                    inv.priceNpr > 0 && (
                                      <button
                                        type="button"
                                        disabled={payingItemBusy}
                                        onClick={() =>
                                          handlePayExistingItemCash(
                                            'INVESTIGATION',
                                            `${inv.serviceCode} — ${inv.serviceName}`,
                                            inv.priceNpr,
                                            'Cash',
                                            inv.id
                                          )
                                        }
                                        className="inline-block px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                                      >
                                        Pay Cash
                                      </button>
                                    )
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section 2B: IPD Individual Cash Bills & One-by-One Service/Bed Payment Ledger */}
                <div className="border border-emerald-200 bg-emerald-50/25 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <Wallet className="w-4 h-4 text-emerald-600" />
                      IPD One-by-One Cash Bills &amp; Direct Service Charges ({(selectedAdm.ipdIndividualBills || []).length} Cash Bills · Paid{' '}
                      <span className="font-mono text-emerald-700">
                        {formatNpr(selectedAdm.individualCashPaidTotalNpr || 0)}
                      </span>
                      )
                    </div>
                  </div>

                  {canClinical && (
                    <form onSubmit={handleAddIpdDirectCharge} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <select
                        value={addChargeCategory}
                        onChange={(e) =>
                          setAddChargeCategory(e.target.value as IpdIndividualCashBill['category'])
                        }
                        className="sm:col-span-2 px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="PROCEDURE">Procedure / Dressing</option>
                        <option value="BED_STAY">Extra Bed / Cabin</option>
                        <option value="NURSING">Special Nursing</option>
                        <option value="OBSERVATION">Observation / Monitor</option>
                        <option value="DOCTOR_ROUND">Specialist Visit</option>
                        <option value="OTHER">Other Service</option>
                      </select>
                      <input
                        required
                        value={addChargeLabel}
                        onChange={(e) => setAddChargeLabel(e.target.value)}
                        placeholder="e.g., Nebulization / Dressing / Extra Dr Visit..."
                        className="sm:col-span-4 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        required
                        type="number"
                        min={1}
                        value={addChargeAmt}
                        onChange={(e) => setAddChargeAmt(e.target.value)}
                        placeholder="Amount रू"
                        className="sm:col-span-2 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                      <select
                        value={addChargePayMode}
                        onChange={(e) =>
                          setAddChargePayMode(e.target.value as 'Cash' | 'Bank / QR' | 'Credit')
                        }
                        className="sm:col-span-2 px-2 py-1.5 bg-white border border-slate-300 rounded-lg font-medium"
                      >
                        <option value="Cash">Cash (Print Bill)</option>
                        <option value="Bank / QR">Bank / QR (Print Bill)</option>
                        <option value="Credit">Credit (Final Bill)</option>
                      </select>
                      <button
                        type="submit"
                        disabled={payingItemBusy}
                        className="sm:col-span-2 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {payingItemBusy
                          ? 'Posting...'
                          : addChargePayMode === 'Credit'
                          ? '+ Post Credit'
                          : '+ Issue Cash Bill'}
                      </button>
                    </form>
                  )}

                  {(selectedAdm.ipdIndividualBills || []).length > 0 && (
                    <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="p-2 text-left">Cash Bill #</th>
                            <th className="p-2 text-left">Category &amp; Item</th>
                            <th className="p-2 text-left">Mode / Cashier</th>
                            <th className="p-2 text-right">Paid (रू)</th>
                            <th className="p-2 text-right">Receipt</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(selectedAdm.ipdIndividualBills || []).map((cb) => (
                            <tr key={cb.id}>
                              <td className="p-2 font-mono font-bold text-emerald-800">{cb.billNumber}</td>
                              <td className="p-2">
                                <div className="font-medium text-slate-900">{cb.itemLabel}</div>
                                <div className="text-[10px] font-mono text-slate-500">
                                  {cb.category} · {adToBs(cb.billedAt).formattedEn} {adToBs(cb.billedAt).timeEn}
                                </div>
                              </td>
                              <td className="p-2 text-slate-600">
                                {cb.paymentMode} · {cb.billedBy}
                              </td>
                              <td className="p-2 text-right font-mono tabular-nums font-bold text-emerald-700">
                                {formatNpr(cb.amountNpr)}
                              </td>
                              <td className="p-2 text-right">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPrintIndividualBill({ admission: selectedAdm, bill: cb })
                                  }
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                                >
                                  <Printer className="w-3 h-3 text-blue-600" />
                                  Print Bill
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Section 3: Interim Deposit, Bed Transfer Log & Progress Notes */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {canClinical && (
                    <form
                      onSubmit={handleAddDepositOrNote}
                      className="border border-slate-200 rounded-xl p-4 space-y-2.5"
                    >
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <Wallet className="w-4 h-4 text-blue-600" />
                        Record Interim Deposit or Progress Note
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min={0}
                          value={depAmount}
                          onChange={(e) => setDepAmount(e.target.value)}
                          placeholder="Deposit NPR (optional)"
                          className="px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                        <select
                          value={depMode}
                          onChange={(e) => setDepMode(e.target.value as PaymentMode)}
                          className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="Cash">Cash</option>
                          <option value="Bank / QR">Bank / QR</option>
                        </select>
                      </div>
                      <input
                        value={depNote}
                        onChange={(e) => setDepNote(e.target.value)}
                        placeholder="Deposit receipt note..."
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-slate-600 mb-0.5">Duty Shift</label>
                          <select
                            value={progressNoteShift}
                            onChange={(e) =>
                              setProgressNoteShift(e.target.value as 'Morning' | 'Afternoon' | 'Night')
                            }
                            className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                          >
                            <option value="Morning">Morning Shift</option>
                            <option value="Afternoon">Afternoon Shift</option>
                            <option value="Night">Night Shift</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-slate-600 mb-0.5">Round Time</label>
                          <input
                            type="time"
                            value={progressNoteRoundTime}
                            onChange={(e) => setProgressNoteRoundTime(e.target.value)}
                            className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                          />
                        </div>
                      </div>
                      <textarea
                        rows={2}
                        value={progressNoteText}
                        onChange={(e) => setProgressNoteText(e.target.value)}
                        placeholder="Add physician / nursing round progress note..."
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={savingDepNote}
                        className="px-3.5 py-1.5 font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                      >
                        {savingDepNote ? 'Posting...' : 'Save Deposit / Round Note'}
                      </button>
                    </form>
                  )}

                  <div className="border border-slate-200 rounded-xl p-4 space-y-2 max-h-64 overflow-y-auto">
                    <div className="font-semibold text-slate-900">
                      Bed Transfers ({selectedAdm.bedTransfers.length}) &amp; Progress Timeline (
                      {selectedAdm.progressNotes.length})
                    </div>
                    {selectedAdm.bedTransfers.map((tr) => (
                      <div key={tr.id} className="p-2 rounded-lg bg-indigo-50/50 border border-indigo-200 text-[11px]">
                        <div className="font-semibold text-indigo-900">
                          Bed Transfer: {tr.fromBedLabel} → {tr.toBedLabel}
                        </div>
                        <div className="text-slate-600">{tr.reason} · {adToBs(tr.transferredAt).formattedEn}</div>
                      </div>
                    ))}
                    {selectedAdm.progressNotes.map((pn) => (
                      <div key={pn.id} className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px]">
                        <div className="text-slate-800">{pn.note}</div>
                        <div className="text-slate-500 font-mono mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span>{adToBs(pn.timestamp).formattedEn}</span>
                          {pn.shift && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200">
                              {pn.shift} Shift{pn.roundTime ? ` @ ${pn.roundTime}` : ''}
                            </span>
                          )}
                          <span>· {pn.recordedBy}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 3: Nursing Chart (Shift Vitals, Intake/Output & Care Notes) */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <Activity className="w-4 h-4 text-blue-600" />
                      Nursing Observation Chart &amp; Intake/Output Flowsheet ({(selectedAdm.nursingCharts || []).length})
                    </div>
                    <button
                      type="button"
                      onClick={() => setPrintNursingAdm(selectedAdm)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                    >
                      <Printer className="w-3 h-3" />
                      Print Nursing Chart
                    </button>
                  </div>

                  {canClinical && (
                    <form onSubmit={handleLogNursingChart} className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <div>
                        <label className="block text-[10px] text-slate-600">Shift</label>
                        <select value={ncShift} onChange={(e) => setNcShift(e.target.value as any)} className="w-full px-2 py-1 bg-white border border-slate-300 rounded">
                          <option value="Morning">Morning</option>
                          <option value="Afternoon">Afternoon</option>
                          <option value="Evening">Evening</option>
                          <option value="Night">Night</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-600">BP (mmHg)</label>
                        <input value={ncBp} onChange={(e) => setNcBp(e.target.value)} className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded" />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-600">Pulse / Temp(°F)</label>
                        <div className="flex gap-1">
                          <input value={ncPulse} onChange={(e) => setNcPulse(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                          <input value={ncTemp} onChange={(e) => setNcTemp(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-600">SpO2% / RR</label>
                        <div className="flex gap-1">
                          <input value={ncSpo2} onChange={(e) => setNcSpo2(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                          <input value={ncResp} onChange={(e) => setNcResp(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-600">Intake (Oral/IV mL)</label>
                        <div className="flex gap-1">
                          <input value={ncInOral} onChange={(e) => setNcInOral(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                          <input value={ncInIv} onChange={(e) => setNcInIv(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-600">Output (Urine/Drain)</label>
                        <div className="flex gap-1">
                          <input value={ncOutUrine} onChange={(e) => setNcOutUrine(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                          <input value={ncOutDrain} onChange={(e) => setNcOutDrain(e.target.value)} className="w-1/2 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded" />
                        </div>
                      </div>
                      <input
                        value={ncNote}
                        onChange={(e) => setNcNote(e.target.value)}
                        placeholder="Nursing care observation / IV cannula / dressing note..."
                        className="col-span-2 sm:col-span-5 px-2.5 py-1.5 bg-white border border-slate-300 rounded"
                      />
                      <button
                        type="submit"
                        disabled={savingNc}
                        className="px-3 py-1.5 font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
                      >
                        {savingNc ? 'Saving...' : '+ Log Nursing'}
                      </button>
                    </form>
                  )}

                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-[11px]">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="p-2 text-left">Time (BS) / Shift</th>
                          <th className="p-2 text-left">BP / Pulse / Temp / SpO2</th>
                          <th className="p-2 text-left">Intake / Output (mL)</th>
                          <th className="p-2 text-left">Care Note &amp; Nurse</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(selectedAdm.nursingCharts || []).length === 0 ? (
                          <tr>
                            <td colSpan={4} className="p-3 text-center text-slate-500">
                              No nursing vitals logged yet.
                            </td>
                          </tr>
                        ) : (
                          (selectedAdm.nursingCharts || []).map((nc) => (
                            <tr key={nc.id}>
                              <td className="p-2 font-mono">
                                <div className="font-semibold text-slate-900">{nc.shift}</div>
                                <div className="text-slate-500">{adToBs(nc.recordedAt).formattedEn} {adToBs(nc.recordedAt).timeEn}</div>
                              </td>
                              <td className="p-2 font-mono text-slate-800">
                                BP {nc.bp} · PR {nc.pulseBpm} · {nc.tempF}°F · SpO2 {nc.spo2Pct}%
                              </td>
                              <td className="p-2 font-mono text-slate-700">
                                In: {(nc.intakeOralMl || 0) + (nc.intakeIvMl || 0)} mL / Out: {(nc.outputUrineMl || 0) + (nc.outputDrainMl || 0)} mL
                              </td>
                              <td className="p-2 text-slate-700">
                                {nc.nursingCareNote} <span className="text-slate-400">({nc.recordedBy})</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Section 3A: Nursing Round & Observation Fee Tracker (Type, Time, Shift, Duration, Fee) */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <Clock className="w-4 h-4 text-indigo-600" />
                      Nursing Round &amp; Observation Fee ({(selectedAdm.nursingObservationFees || []).length} entries)
                    </div>
                    <span className="font-mono font-semibold text-indigo-700">
                      Total Obs Fee: {formatNpr(selectedAdm.nursingObservationChargesNpr || 0)}
                    </span>
                  </div>

                  {canClinical && (
                    <form
                      onSubmit={handleLogNursingObservationFee}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3"
                    >
                      <div className="sm:col-span-4">
                        <label className="block text-[10px] text-slate-600 mb-0.5">Observation / Round Type *</label>
                        <select
                          value={obsType}
                          onChange={(e) => {
                            const val = e.target.value;
                            setObsType(val);
                            const found = nursingObsTypes.find((t) => t.name === val);
                            if (found) setObsFeeNpr(String(found.defaultFeeNpr));
                          }}
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded"
                        >
                          {nursingObsTypes.map((t) => (
                            <option key={t.id} value={t.name}>
                              {t.name} ({formatNpr(t.defaultFeeNpr)})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-slate-600 mb-0.5">Shift *</label>
                        <select
                          value={obsShift}
                          onChange={(e) => {
                            const nextShift = e.target.value as 'Morning' | 'Afternoon' | 'Night';
                            setObsShift(nextShift);
                            const sp = modSettings?.shiftPricing?.observation;
                            if (sp) {
                              const rate =
                                nextShift === 'Morning'
                                  ? sp.Morning
                                  : nextShift === 'Afternoon'
                                  ? sp.Afternoon
                                  : sp.Night;
                              if (Number.isFinite(rate) && rate >= 0) {
                                setObsFeeNpr(String(rate));
                              }
                            }
                          }}
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded"
                        >
                          <option value="Morning">Morning (07–15)</option>
                          <option value="Afternoon">Afternoon (14–22)</option>
                          <option value="Night">Night (21:30–07:30)</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-slate-600 mb-0.5">Round Time</label>
                        <input
                          type="time"
                          value={obsRoundTime}
                          onChange={(e) => setObsRoundTime(e.target.value)}
                          className="w-full px-2 py-1.5 font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-slate-600 mb-0.5">Duration (Hrs)</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={obsDurationHrs}
                          onChange={(e) => setObsDurationHrs(e.target.value)}
                          className="w-full px-2 py-1.5 font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-slate-600 mb-0.5">Fee (NPR) *</label>
                        <input
                          type="number"
                          min={0}
                          required
                          value={obsFeeNpr}
                          onChange={(e) => setObsFeeNpr(e.target.value)}
                          className="w-full px-2 py-1.5 font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                      <div className="sm:col-span-9">
                        <input
                          value={obsNotes}
                          onChange={(e) => setObsNotes(e.target.value)}
                          placeholder="Observation remarks (e.g., Hourly SpO2 monitoring, IV line check, dressing round)..."
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <button
                          type="submit"
                          disabled={savingObs}
                          className="w-full py-1.5 font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {savingObs ? 'Posting...' : '+ Add Round / Obs Fee'}
                        </button>
                      </div>
                    </form>
                  )}

                  {(selectedAdm.nursingObservationFees || []).length > 0 && (
                    <div className="overflow-x-auto border border-slate-200 rounded-lg">
                      <table className="w-full text-[11px]">
                        <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="p-2 text-left">Time &amp; Shift</th>
                            <th className="p-2 text-left">Observation Type</th>
                            <th className="p-2 text-left">Duration / Notes</th>
                            <th className="p-2 text-left">Nurse</th>
                            <th className="p-2 text-right">Fee (रू)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {(selectedAdm.nursingObservationFees || []).map((obs) => (
                            <tr key={obs.id}>
                              <td className="p-2 font-mono">
                                <div className="font-semibold text-slate-900">{obs.shift}</div>
                                <div className="text-slate-500">
                                  {adToBs(obs.recordedAt).formattedEn} @ {obs.roundTime || obs.observationTime || '—'}
                                </div>
                              </td>
                              <td className="p-2 font-medium text-slate-900">{obs.observationType}</td>
                              <td className="p-2 text-slate-600">
                                {obs.durationHours ? `${obs.durationHours} hr(s)` : '—'}
                                {obs.notes ? ` · ${obs.notes}` : ''}
                              </td>
                              <td className="p-2 text-slate-600">{obs.nurseName || obs.recordedBy || 'Nursing'}</td>
                              <td className="p-2 text-right font-mono tabular-nums font-bold text-slate-900">
                                {formatNpr(obs.feeNpr)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Section 3B: Bedside Medication Administration Record (MAR) */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <Pill className="w-4 h-4 text-emerald-600" />
                    Bedside MAR (Medication Administration Record) ({(selectedAdm.marRecords || []).length})
                  </div>
                  {canClinical && (
                    <form onSubmit={handleLogMar} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                      <input
                        required
                        value={marMedName}
                        onChange={(e) => setMarMedName(e.target.value)}
                        placeholder="Drug administered (e.g., Inj Ceftriaxone 1g)"
                        className="sm:col-span-4 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <input
                        value={marDoseRoute}
                        onChange={(e) => setMarDoseRoute(e.target.value)}
                        placeholder="Dose & Route"
                        className="sm:col-span-3 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <select
                        value={marStatus}
                        onChange={(e) => setMarStatus(e.target.value as 'Given' | 'Held' | 'Refused')}
                        className="sm:col-span-2 px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Given">Given</option>
                        <option value="Held">Held</option>
                        <option value="Refused">Refused</option>
                      </select>
                      <input
                        value={marNote}
                        onChange={(e) => setMarNote(e.target.value)}
                        placeholder="MAR note"
                        className="sm:col-span-2 px-2 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <button
                        type="submit"
                        disabled={savingMar}
                        className="sm:col-span-1 px-2.5 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {savingMar ? '...' : '+ MAR'}
                      </button>
                    </form>
                  )}
                  {(selectedAdm.marRecords || []).length > 0 && (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg text-[11px]">
                      {(selectedAdm.marRecords || []).slice(0, 8).map((m) => (
                        <div key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-2">
                          <div>
                            <strong>{m.medicineName}</strong> · {m.doseRoute} ·{' '}
                            <span className="font-semibold text-emerald-700">{m.status}</span>
                            {m.note ? ` · ${m.note}` : ''}
                          </div>
                          <span className="font-mono text-slate-500">
                            {m.givenBy} · {adToBs(m.timestamp).timeEn}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 4: Auto-Assigned Case Consents */}
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                      <FileSignature className="w-4 h-4 text-indigo-600" />
                      Case Consents (Auto-Set on Admission) ({(selectedAdm.consents || []).length})
                    </div>
                    {canClinical && (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={newIpdConsentType}
                          onChange={(e) => setNewIpdConsentType(e.target.value as any)}
                          className="px-2 py-1 text-[11px] bg-white border border-slate-300 rounded"
                        >
                          <option value="SURGERY_ANESTHESIA">Surgery / Anesthesia</option>
                          <option value="ICU_CRITICAL_CARE">ICU Critical Care</option>
                          <option value="MATERNITY_DELIVERY">Maternity / Delivery</option>
                          <option value="LAMA_DOR_RISK">LAMA / DOR Risk</option>
                          <option value="EXTERNAL_REFERRAL_TRANSPORT">External Referral</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleAddIpdConsent}
                          className="px-2.5 py-1 text-[11px] font-medium text-white bg-slate-900 rounded hover:bg-slate-800"
                        >
                          + Add Consent
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      value={consentSigner}
                      onChange={(e) => setConsentSigner(e.target.value)}
                      placeholder="Patient / Guardian Signatory Name"
                      className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
                    />
                    <input
                      value={consentRelation}
                      onChange={(e) => setConsentRelation(e.target.value)}
                      placeholder="Relationship (Self / Spouse / Son)"
                      className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="space-y-2">
                    {(selectedAdm.consents || []).map((con) => (
                      <div key={con.id} className="p-2.5 rounded-lg border border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">
                            {con.title} ·{' '}
                            <span className={con.status === 'Signed & Verified' ? 'text-emerald-700' : 'text-amber-700'}>
                              {con.status}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {con.status === 'Signed & Verified' ? `Signed by ${con.patientOrGuardianName} (${con.relationship})` : con.summaryText}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {con.status !== 'Signed & Verified' && canClinical && (
                            <button
                              type="button"
                              disabled={signingIpdConsentId === con.id}
                              onClick={() => handleSignIpdConsent(con.id)}
                              className="px-2.5 py-1 text-[11px] font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700"
                            >
                              {signingIpdConsentId === con.id ? 'Signing...' : 'Sign & Verify'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPrintIpdConsent({ consent: con, adm: selectedAdm })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-50"
                          >
                            <Printer className="w-3 h-3" />
                            Print Consent
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: WARD & BED SUMMARY + BED BOARD */}
      {subTab === 'beds' && (
        <div className="space-y-4">
          {/* Ward Occupancy Summary Table + Print Bed Summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Ward-Wise Bed Census &amp; Occupancy Summary</h2>
                <p className="text-[11px] text-slate-500">
                  Real-time count of Total, Occupied, Available, and Cleaning/Maintenance beds per Ward.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrintBedSummary(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <Printer className="w-3.5 h-3.5" />
                Print A4 Bed Summary
              </button>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Ward Name</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3 text-right">Total Beds</th>
                    <th className="py-2 px-3 text-right">Occupied</th>
                    <th className="py-2 px-3 text-right">Available</th>
                    <th className="py-2 px-3 text-right">Cleaning / Maint.</th>
                    <th className="py-2 px-3 text-right">Occupancy %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono">
                  {wardSummaryRows.map((w) => (
                    <tr key={w.wardName}>
                      <td className="py-2 px-3 font-sans font-semibold text-slate-900">{w.wardName}</td>
                      <td className="py-2 px-3 font-sans text-slate-600">{w.wardType}</td>
                      <td className="py-2 px-3 text-right">{w.total}</td>
                      <td className="py-2 px-3 text-right text-blue-700 font-bold">{w.occupied}</td>
                      <td className="py-2 px-3 text-right text-emerald-700 font-bold">{w.available}</td>
                      <td className="py-2 px-3 text-right text-amber-700">{w.cleaning}</td>
                      <td className="py-2 px-3 text-right font-semibold">
                        {w.total > 0 ? Math.round((w.occupied / w.total) * 100) : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredBeds.map((bed) => (
            <div
              key={bed.id}
              className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3 text-xs"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900">{bed.bedCode}</span>
                  <span
                    className={`font-semibold ${
                      bed.status === 'Available'
                        ? 'text-emerald-700'
                        : bed.status === 'Occupied'
                        ? 'text-blue-700'
                        : bed.status === 'Cleaning'
                        ? 'text-amber-700'
                        : 'text-rose-700'
                    }`}
                  >
                    {bed.status}
                  </span>
                </div>
                <div className="font-medium text-slate-800 mt-1">
                  {bed.wardName} · {bed.wardType}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {bed.centerName} · {bed.floorLabel}
                </div>
                <div className="text-[11px] font-mono text-slate-700 mt-1.5">
                  {formatNpr(bed.dailyRateNpr)} / day · {bed.hasOxygen ? 'O2 Line' : 'No O2'} ·{' '}
                  {bed.hasMonitor ? 'ICU Monitor' : 'Standard'}
                </div>
                {bed.status === 'Occupied' && bed.currentPatientName && (
                  <div className="mt-2 p-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-900">
                    Occupied by: <strong>{bed.currentPatientName}</strong>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                {bed.status === 'Available' && canClinical && (
                  <button
                    type="button"
                    onClick={() => {
                      setAdmBedId(bed.id);
                      setAdmLinkedOpdId(undefined);
                      setShowAdmitModal(true);
                    }}
                    className="px-3 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    Admit Here
                  </button>
                )}
                {bed.status === 'Occupied' && bed.currentAdmissionId && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAdmId(bed.currentAdmissionId!);
                      setSubTab('admitted');
                    }}
                    className="px-3 py-1.5 font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                  >
                    Open Inpatient Chart
                  </button>
                )}
                {bed.status === 'Cleaning' && canClinical && (
                  <button
                    type="button"
                    onClick={() => handleUpdateBedStatus(bed, 'Available')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Mark Clean (Available)
                  </button>
                )}
                {bed.status === 'Available' && canManageBeds && (
                  <button
                    type="button"
                    onClick={() => handleUpdateBedStatus(bed, 'Maintenance')}
                    className="px-2.5 py-1.5 text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    Set Maintenance
                  </button>
                )}
                {bed.status === 'Maintenance' && canManageBeds && (
                  <button
                    type="button"
                    onClick={() => handleUpdateBedStatus(bed, 'Available')}
                    className="px-3 py-1.5 font-medium text-emerald-700 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50"
                  >
                    Restore Available
                  </button>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* TAB 4: BIRTH & DEATH CERTIFICATES REGISTRY */}
      {subTab === 'certificates' && (
        <div className="space-y-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl p-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Hospital Birth &amp; Death (MCCD) Certificates Register
              </h2>
              <p className="text-[11px] text-slate-500">
                Official Saptari Hospital Pvt Ltd Birth Records &amp; Medical Certification of Cause of Death with A4 printouts.
              </p>
            </div>
            {canClinical && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setBirthLinkedIpdId(undefined);
                    setShowBirthModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  <Baby className="w-3.5 h-3.5" />
                  + Issue Birth Certificate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDeathLinkedIpdId(undefined);
                    setShowDeathModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  + Issue Death Certificate
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Birth Certificates */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-900">
                Birth Certificates ({(db.birthCertificates || []).length})
              </div>
              <div className="divide-y divide-slate-100">
                {(db.birthCertificates || []).map((bc) => (
                  <div key={bc.id} className="p-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono font-bold text-blue-700">{bc.certificateNumber}</div>
                      <div className="font-semibold text-slate-900">
                        Mother: {bc.motherName} · Baby ({bc.babyGender}, {bc.birthWeightKg} kg)
                      </div>
                      <div className="text-[11px] text-slate-500">
                        DOB: {bc.birthDateBs} BS ({bc.birthTime}) · {bc.deliveryType} · {bc.attendingDoctor}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPrintCert({ type: 'BIRTH', birthCert: bc })}
                      className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print A4
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Death Certificates */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 font-semibold text-slate-900">
                Death Certificates (MCCD) ({(db.deathCertificates || []).length})
              </div>
              <div className="divide-y divide-slate-100">
                {(db.deathCertificates || []).map((dc) => (
                  <div key={dc.id} className="p-4 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-mono font-bold text-slate-900">{dc.certificateNumber}</div>
                      <div className="font-semibold text-slate-900">
                        {dc.deceasedName} ({dc.age} {dc.ageType} / {dc.gender})
                      </div>
                      <div className="text-[11px] text-slate-600">
                        Cause: {dc.immediateCauseOfDeath} ({dc.mannerOfDeath})
                      </div>
                      <div className="text-[11px] text-slate-500">
                        DOD: {dc.deathDateBs} BS ({dc.deathTime}) · {dc.certifyingDoctor}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPrintCert({ type: 'DEATH', deathCert: dc })}
                      className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 shrink-0"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Print A4
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DISCHARGED & REFERRED REGISTRY */}
      {subTab === 'history' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">IPD # &amp; Date (BS)</th>
                  <th className="px-4 py-3 text-left font-medium">Patient &amp; Last Bed</th>
                  <th className="px-4 py-3 text-left font-medium">Deposition &amp; Referred Place/Hospital</th>
                  <th className="px-4 py-3 text-left font-medium">Used Meds &amp; Tests Done</th>
                  <th className="px-4 py-3 text-right font-medium">Total Bill / Paid</th>
                  <th className="px-4 py-3 text-right font-medium">Print Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {historyAdmissions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No discharged or externally referred IPD records match the search.
                    </td>
                  </tr>
                ) : (
                  historyAdmissions.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-mono font-bold text-slate-900">{a.admissionNumber}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {adToBs(a.dischargedAt || a.admittedAt).formattedEn}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{a.patientName}</div>
                        <div className="text-[11px] text-slate-500">
                          Bed {a.currentBedLabel} · {a.admittingDoctor}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className={`font-semibold ${
                            a.disposition === 'Referred to External Hospital'
                              ? 'text-rose-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {a.disposition}
                        </div>
                        {a.externalReferral ? (
                          <div className="text-[11px] text-slate-700 mt-0.5">
                            <strong>{a.externalReferral.referredToHospital}</strong> ·{' '}
                            {a.externalReferral.referredToPlace} ({a.externalReferral.transportMode})
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500 mt-0.5">{a.finalDiagnosis}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-slate-700">
                        <div>{a.usedMedicines.length} Medicines Administered</div>
                        <div>{a.investigationsDone.length} Investigations Done</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{formatNpr(a.totalBillNpr)}</div>
                        <div className="text-[11px] text-emerald-700">
                          Paid {formatNpr(a.totalDepositPaidNpr)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setPrintAdmission(a)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50 whitespace-nowrap"
                        >
                          <Printer className="w-3.5 h-3.5" />
                          Print Deposition
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ADD BED MODAL */}
      {showAddBedModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowAddBedModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Add Hospital Ward &amp; Bed</h2>
              <button type="button" onClick={() => setShowAddBedModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddBed} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Ward Name *</label>
                <input
                  required
                  value={bedWardName}
                  onChange={(e) => setBedWardName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ward Type</label>
                  <select
                    value={bedWardType}
                    onChange={(e) => setBedWardType(e.target.value as WardType)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="General Ward">General Ward</option>
                    <option value="Semi-Private Cabin">Semi-Private Cabin</option>
                    <option value="Private Deluxe">Private Deluxe</option>
                    <option value="ICU / HDU">ICU / HDU</option>
                    <option value="Emergency / Obs">Emergency / Obs</option>
                    <option value="NICU / Pediatric">NICU / Pediatric</option>
                    <option value="Maternity">Maternity</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed Number *</label>
                  <input
                    required
                    value={bedNumber}
                    onChange={(e) => setBedNumber(e.target.value)}
                    placeholder="e.g., GEN-105"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Floor</label>
                  <input
                    value={bedFloor}
                    onChange={(e) => setBedFloor(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Daily Tariff (NPR)</label>
                  <input
                    type="number"
                    min={0}
                    value={bedRate}
                    onChange={(e) => setBedRate(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              {!activeUser.assignedCenterId && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Facility Hub</label>
                  <select
                    value={bedCenterId}
                    onChange={(e) => setBedCenterId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="">Main Reference Hospital Hub</option>
                    {db.centers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex items-center gap-4 pt-1">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={bedO2} onChange={(e) => setBedO2(e.target.checked)} />
                  Central Oxygen Line
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={bedMonitor} onChange={(e) => setBedMonitor(e.target.checked)} />
                  Multipara Monitor
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowAddBedModal(false)} className="px-3 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" disabled={savingBed} className="px-4 py-2 font-medium text-white bg-blue-600 rounded-lg">
                  {savingBed ? 'Adding...' : 'Create Bed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADMIT PATIENT MODAL */}
      {showAdmitModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowAdmitModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                {admLinkedOpdId ? 'Convert OPD Visit to Inpatient (IPD) Admission' : 'Admit New IPD Patient to Bed'}
              </h2>
              <button type="button" onClick={() => setShowAdmitModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAdmitSubmit} className="p-5 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block font-semibold text-slate-800">
                    Lookup Patient (Intake / OPD / ER)
                  </label>
                  <input
                    value={admPatientSearch}
                    onChange={(e) => setAdmPatientSearch(e.target.value)}
                    placeholder="Filter UHID / Name / Mobile..."
                    className="px-2.5 py-1 bg-white border border-slate-300 rounded text-[11px] w-44"
                  />
                </div>
                <select
                  value={admPatientId}
                  onChange={(e) => handleSelectIpdPatient(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- New IPD Admission Entry --</option>
                  {searchableIpdPatients.map((pt) => (
                    <option key={`${pt.sourceBadge}-${pt.id}`} value={pt.id}>
                      {pt.uhid} — {pt.fullName} ({pt.phone}) [{pt.sourceBadge}]
                    </option>
                  ))}
                </select>
              </div>

              {admHideDemographics && admName && (
                <div className="px-3.5 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-indigo-700 text-white font-mono text-[10px] font-bold">
                      IPD
                    </span>
                    <span className="font-mono font-bold text-indigo-900">{admUhid || 'NEW'}</span>
                    <span className="font-semibold text-slate-900">{admName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setAdmHideDemographics(false)}
                    className="px-2.5 py-1 text-[11px] font-medium bg-white border border-indigo-300 text-indigo-800 rounded hover:bg-indigo-100"
                  >
                    Edit Details
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit / Ward Filter</label>
                  <select
                    value={admWardFilter}
                    onChange={(e) => {
                      const nextFilter = e.target.value as typeof admWardFilter;
                      setAdmWardFilter(nextFilter);
                      const firstMatch = availableBeds.find((b) => {
                        if (nextFilter === 'ALL') return true;
                        const hay = `${b.wardType} ${b.wardName} ${b.bedCode}`.toLowerCase();
                        if (nextFilter === 'ICU / HDU') return hay.includes('icu') || hay.includes('hdu');
                        if (nextFilter === 'NICU') return hay.includes('nicu');
                        if (nextFilter === 'Post-Op') return hay.includes('post') || hay.includes('recovery');
                        if (nextFilter === 'Maternity') return hay.includes('matern') || hay.includes('obgyn') || hay.includes('labour');
                        if (nextFilter === 'General Ward') return b.wardType === 'General Ward' || hay.includes('general');
                        if (nextFilter === 'Private Cabin') return b.wardType.includes('Cabin') || hay.includes('cabin');
                        return true;
                      });
                      setAdmBedId(firstMatch?.id || '');
                    }}
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg font-medium"
                  >
                    <option value="ALL">All IPD Units ({availableBeds.length} avail)</option>
                    <option value="ICU / HDU">ICU / HDU Only</option>
                    <option value="NICU">NICU Only</option>
                    <option value="Post-Op">Post-Op Recovery Only</option>
                    <option value="Maternity">Maternity / OBGYN</option>
                    <option value="General Ward">General Ward</option>
                    <option value="Private Cabin">Private Cabin</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Assign Available IPD Bed *</label>
                  <select
                    required
                    value={admBedId}
                    onChange={(e) => setAdmBedId(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-medium"
                  >
                    {filteredAdmAvailableBeds.length === 0 ? (
                      <option value="">No Available Beds in {admWardFilter}</option>
                    ) : (
                      filteredAdmAvailableBeds.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.bedCode} — {b.wardName} ({b.wardType}) · {formatNpr(b.dailyRateNpr)}/day
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!admHideDemographics && (
                  <>
                    {ipdFieldRule('patientName') !== 'HIDDEN' && (
                      <div className="sm:col-span-2">
                        <label className="block font-medium text-slate-700 mb-1">
                          Patient Name {ipdFieldRule('patientName') === 'REQUIRED' ? '*' : ''}
                        </label>
                        <input
                          required={ipdFieldRule('patientName') === 'REQUIRED'}
                          value={admName}
                          onChange={(e) => setAdmName(sanitizePersonName(e.target.value))}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        />
                      </div>
                    )}
                    {ipdFieldRule('patientAge') !== 'HIDDEN' && (
                      <div className="flex gap-2">
                        <input
                          type="number"
                          min={0}
                          required={ipdFieldRule('patientAge') === 'REQUIRED'}
                          value={admAge}
                          onChange={(e) => setAdmAge(e.target.value)}
                          placeholder="Age"
                          className="flex-1 px-3 py-2 font-mono border border-slate-300 rounded-lg"
                        />
                        <select
                          value={admAgeType}
                          onChange={(e) => setAdmAgeType(e.target.value as AgeType)}
                          className="w-24 px-2 py-2 bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="Years">Years</option>
                          <option value="Months">Months</option>
                          <option value="Days">Days</option>
                        </select>
                      </div>
                    )}
                    {ipdFieldRule('patientGender') !== 'HIDDEN' && (
                      <select
                        value={admGender}
                        onChange={(e) => setAdmGender(e.target.value as PatientGender)}
                        className="px-3 py-2 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Male">Male</option>
                        <option value="Female">Female</option>
                        <option value="Other">Other</option>
                      </select>
                    )}
                    {ipdFieldRule('patientPhone') !== 'HIDDEN' && (
                      <div className="flex">
                        <span className="inline-flex items-center px-2.5 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg font-mono text-slate-600">
                          +977
                        </span>
                        <input
                          required={ipdFieldRule('patientPhone') === 'REQUIRED'}
                          value={admPhone}
                          onChange={(e) => setAdmPhone(e.target.value)}
                          placeholder={`98XXXXXXXX${ipdFieldRule('patientPhone') === 'REQUIRED' ? ' *' : ''}`}
                          className="w-full px-3 py-2 font-mono border border-slate-300 rounded-r-lg"
                        />
                      </div>
                    )}
                    {ipdFieldRule('patientAddress') !== 'HIDDEN' && (
                      <input
                        required={ipdFieldRule('patientAddress') === 'REQUIRED'}
                        value={admAddress}
                        onChange={(e) => setAdmAddress(e.target.value)}
                        placeholder={`Enter patient address${ipdFieldRule('patientAddress') === 'REQUIRED' ? ' *' : ''}`}
                        className="px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    )}
                    {ipdFieldRule('emergencyContact') !== 'HIDDEN' && (
                      <input
                        required={ipdFieldRule('emergencyContact') === 'REQUIRED'}
                        value={admEmergency}
                        onChange={(e) => setAdmEmergency(e.target.value)}
                        placeholder={`Emergency Contact / Kin${ipdFieldRule('emergencyContact') === 'REQUIRED' ? ' *' : ''}`}
                        className="px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    )}
                  </>
                )}
                {ipdFieldRule('admittingDoctor') !== 'HIDDEN' && (
                  <div>
                    <select
                      value={admDoctor}
                      onChange={(e) => setAdmDoctor(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                    >
                      {doctorOptions.map((doc) => (
                        <option key={doc} value={doc}>
                          {doc}
                        </option>
                      ))}
                      <option value="__CUSTOM__">+ Enter Custom Doctor Name</option>
                    </select>
                    {admDoctor === '__CUSTOM__' && (
                      <input
                        required
                        value={admDoctorCustom}
                        onChange={(e) => setAdmDoctorCustom(e.target.value)}
                        placeholder="Enter admitting doctor name..."
                        className="mt-1.5 w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    )}
                  </div>
                )}
                {ipdFieldRule('admittingDiagnosis') !== 'HIDDEN' && (
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Admitting Diagnosis {ipdFieldRule('admittingDiagnosis') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <input
                      required={ipdFieldRule('admittingDiagnosis') === 'REQUIRED'}
                      value={admDiagnosis}
                      onChange={(e) => setAdmDiagnosis(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
                {ipdFieldRule('advanceDeposit') !== 'HIDDEN' && (
                  <>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Advance Deposit (NPR) {ipdFieldRule('advanceDeposit') === 'REQUIRED' ? '*' : ''}
                      </label>
                      <input
                        type="number"
                        min={0}
                        required={ipdFieldRule('advanceDeposit') === 'REQUIRED'}
                        value={admDeposit}
                        onChange={(e) => setAdmDeposit(e.target.value)}
                        className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Deposit Payment Mode</label>
                      <select
                        value={admPayMode}
                        onChange={(e) => setAdmPayMode(e.target.value as PaymentMode)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank / QR">Bank / QR</option>
                      </select>
                    </div>
                  </>
                )}
              </div>
              {/* Admission Charge Input, Admission Cash/Credit Mode & Instant Receipt Option */}
              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-lg space-y-2.5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <div>
                    <div className="font-semibold text-emerald-950">IPD Admission Charge (रू) *</div>
                    <div className="text-[11px] text-emerald-800">
                      Bed cycle ({ipdCycleStart}–{ipdCycleEnd}):{' '}
                      <strong>
                        {formatNpr(availableBeds.find((b) => b.id === admBedId)?.dailyRateNpr || 0)}/day
                      </strong>{' '}
                      (auto-counted daily)
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-emerald-900 mb-0.5">
                      Admission Fee Mode
                    </label>
                    <select
                      value={admAdmissionPayMode}
                      onChange={(e) =>
                        setAdmAdmissionPayMode(e.target.value as 'Cash' | 'Bank / QR' | 'Credit')
                      }
                      className="w-full px-2.5 py-1.5 bg-white border border-emerald-300 rounded-lg font-medium"
                    >
                      <option value="Cash">Cash (Instant Receipt)</option>
                      <option value="Bank / QR">Bank / QR (Instant Receipt)</option>
                      <option value="Credit">Credit (Settle in IPD Final)</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <span className="text-[11px] font-mono text-emerald-900">Fee (रू):</span>
                    <input
                      type="number"
                      min={0}
                      value={admAdmissionFee}
                      onChange={(e) => setAdmAdmissionFee(e.target.value)}
                      className="w-28 px-2.5 py-1.5 text-right text-sm font-bold font-mono tabular-nums text-emerald-900 bg-white border border-emerald-300 rounded-lg"
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-emerald-900 cursor-pointer pt-2 border-t border-emerald-200/80 w-full">
                  <input
                    type="checkbox"
                    checked={printReceiptOnlyOnAdmit}
                    onChange={(e) => setPrintReceiptOnlyOnAdmit(e.target.checked)}
                    className="rounded border-emerald-400 text-emerald-700"
                  />
                  <span className="font-medium">
                    Print Admission Fee Bill Receipt immediately upon ward admission (
                    {modSettings?.printOptions?.autoPrintByTemplate?.admissionReceipt === 'AUTO_PRINT'
                      ? 'Auto-Print ON'
                      : 'Preview'}
                    )
                  </span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowAdmitModal(false)} className="px-3 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={admitting || availableBeds.length === 0}
                  className="px-4 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {admitting ? 'Admitting...' : 'Confirm IPD Admission & Print Receipt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TRANSFER BED MODAL */}
      {showTransferModal && selectedAdm && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowTransferModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Internal Bed Transfer — {selectedAdm.patientName}
              </h2>
              <button type="button" onClick={() => setShowTransferModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleTransferBed} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                Current Bed: <strong>{selectedAdm.currentBedLabel} ({selectedAdm.currentWardName})</strong>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Target Available Bed *</label>
                <select
                  required
                  value={transferTargetBedId}
                  onChange={(e) => setTransferTargetBedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  {beds
                    .filter((b) => b.status === 'Available' && b.centerId === selectedAdm.centerId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bedCode} — {b.wardName} ({formatNpr(b.dailyRateNpr)}/day)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Transfer Reason *</label>
                <input
                  required
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="e.g., Step-down from ICU to Private Cabin"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowTransferModal(false)} className="px-3 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={transferring || !transferTargetBedId}
                  className="px-4 py-2 font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  {transferring ? 'Transferring...' : 'Execute Bed Transfer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* FINAL DEPOSITION / DISCHARGE / EXTERNAL REFERRAL MODAL */}
      {showDepositionModal && selectedAdm && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowDepositionModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ambulance className="w-4 h-4 text-rose-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Finalize IPD Deposition, Discharge or External Hospital Referral — {selectedAdm.admissionNumber}
                </h2>
              </div>
              <button type="button" onClick={() => setShowDepositionModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleFinalizeDeposition} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Deposition Outcome *</label>
                  <select
                    value={depOutcome}
                    onChange={(e) => setDepOutcome(e.target.value as IpdDispositionType)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Discharged">Discharged (Routine)</option>
                    <option value="Referred to External Hospital">Referred to External Hospital</option>
                    <option value="Transferred to Ward/Hub">Transferred to Another Hub / Center</option>
                    <option value="LAMA / DOR">LAMA / Discharged On Request (DOR)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Final Diagnosis *</label>
                  <input
                    required
                    value={finalDx}
                    onChange={(e) => setFinalDx(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {(depOutcome === 'Referred to External Hospital' || depOutcome === 'Transferred to Ward/Hub') && (
                <div className="border-2 border-rose-300 bg-rose-50/40 rounded-xl p-4 space-y-3">
                  <div className="font-semibold text-rose-900">
                    External Referral Destination (Hospital, Place &amp; Reason) — Printed on Deposition Summary
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Saved Referred Hospital (Quick Select)</label>
                      <select
                        value={extHospitalId}
                        onChange={(e) => {
                          const hid = e.target.value;
                          setExtHospitalId(hid);
                          const h = (db.referredHospitalsMaster || []).find((x) => x.id === hid);
                          if (h) {
                            setExtHospital(h.name);
                            setExtPlace(h.address);
                            setExtManagerName(h.managerName || '');
                            setExtManagerPhone(h.managerPhone || '');
                          }
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">Select saved hospital or type below...</option>
                        {(db.referredHospitalsMaster || []).filter((h) => h.active !== false).map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name} ({h.address})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Saved Ambulance &amp; Driver</label>
                      <select
                        value={extAmbulanceId}
                        onChange={(e) => {
                          const aid = e.target.value;
                          setExtAmbulanceId(aid);
                          const amb = (db.ambulancesMaster || []).find((x) => x.id === aid);
                          if (amb) {
                            setExtAmbulanceName(amb.name);
                            setExtAmbulanceNumber(amb.vehicleNumber);
                          }
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">Select saved ambulance or type manually...</option>
                        {(db.ambulancesMaster || []).filter((a) => a.active !== false).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} — {a.vehicleNumber}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Referred Hospital / Facility Name *</label>
                      <input
                        required
                        value={extHospital}
                        onChange={(e) => setExtHospital(e.target.value)}
                        placeholder="e.g., Bir Hospital / Patan Hospital / SGNHC"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Place / City / Address *</label>
                      <input
                        required
                        value={extPlace}
                        onChange={(e) => setExtPlace(e.target.value)}
                        placeholder="e.g., Ratna Park, Kathmandu / Pokhara"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Destination Manager Name</label>
                      <input
                        value={extManagerName}
                        onChange={(e) => setExtManagerName(sanitizePersonName(e.target.value))}
                        placeholder="Receiving Hospital Coordinator"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Manager WhatsApp / Call Phone</label>
                      <input
                        value={extManagerPhone}
                        onChange={(e) => setExtManagerPhone(e.target.value)}
                        placeholder="+97798XXXXXXXX"
                        className="w-full px-3 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Case Type (Commission)</label>
                      <select
                        value={extCaseType}
                        onChange={(e) => setExtCaseType(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="GENERAL">General Referral</option>
                        {(db.settings?.moduleSettings?.referralCaseRules || []).map((r) => (
                          <option key={r.id} value={r.caseType}>
                            {r.caseType}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Referred Department</label>
                      <input
                        value={extDept}
                        onChange={(e) => setExtDept(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Transport Mode</label>
                      <select
                        value={extTransport}
                        onChange={(e) =>
                          setExtTransport(e.target.value as ExternalReferralDetail['transportMode'])
                        }
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="ALS Ambulance">ALS Ambulance</option>
                        <option value="BLS Ambulance">BLS Ambulance</option>
                        <option value="Hospital Vehicle">Hospital Vehicle</option>
                        <option value="Private Vehicle">Private Vehicle</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Ambulance Name / Service</label>
                      <input
                        value={extAmbulanceName}
                        onChange={(e) => setExtAmbulanceName(e.target.value)}
                        placeholder="e.g., Hospital ALS Ambulance / Red Cross 102"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Ambulance No.</label>
                        <input
                          value={extAmbulanceNumber}
                          onChange={(e) => setExtAmbulanceNumber(e.target.value)}
                          placeholder="BA 2 JHA ..."
                          className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">Departure Time</label>
                        <input
                          value={extDepartureTime}
                          onChange={(e) => setExtDepartureTime(e.target.value)}
                          placeholder="14:35 PM"
                          className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-medium text-slate-700 mb-1">Reason for Referral *</label>
                      <input
                        required
                        value={extReason}
                        onChange={(e) => setExtReason(e.target.value)}
                        placeholder="e.g., Requires tertiary neurosurgical / ventilator ICU / Primary PCI support"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Condition at Referral</label>
                      <input
                        value={extCondition}
                        onChange={(e) => setExtCondition(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Escort Doctor / Nurse</label>
                      <input
                        value={extEscort}
                        onChange={(e) => setExtEscort(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-medium text-slate-700 mb-1">
                        Referral Case Details (Auto-attaches all Billed Services, Lab/X-Ray &amp; Medicines)
                      </label>
                      <textarea
                        rows={2}
                        value={extCaseDetails}
                        onChange={(e) => setExtCaseDetails(e.target.value)}
                        placeholder="Summarize clinical progression, stabilization given & diagnostic findings..."
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="block font-medium text-slate-700">Hospital Course &amp; Treatment Summary</label>
                  <button
                    type="button"
                    onClick={() => setCourseSummary(buildQuickDischargeSummary(selectedAdm, modSettings))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100"
                  >
                    <FileText className="w-3 h-3" />
                    Auto-Generate Quick Summary
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={courseSummary}
                  onChange={(e) => setCourseSummary(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Condition on Discharge / Transfer</label>
                  <input
                    value={condText}
                    onChange={(e) => setCondText(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Follow-Up Date / Plan (BS)</label>
                  <input
                    value={followUpBs}
                    onChange={(e) => setFollowUpBs(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Discharge / Transfer Advice</label>
                  <input
                    value={adviceText}
                    onChange={(e) => setAdviceText(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Billing Settlement Box */}
              <div className="border border-slate-200 bg-slate-50 rounded-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Bed Stay Days ({ipdCycleStart}–{ipdCycleEnd})
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={bedDays}
                    onChange={(e) => {
                      const v = e.target.value;
                      setBedDays(v);
                      recalcDepositionSettlement(selectedAdm, v, doctorRounds, nursingDays, observationDays, otherCharges);
                    }}
                    className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Doctor Rounds ({formatNpr(ipdRoundFeeNpr)}/rd)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={doctorRounds}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDoctorRounds(v);
                      recalcDepositionSettlement(selectedAdm, bedDays, v, nursingDays, observationDays, otherCharges);
                    }}
                    className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Nursing Care Days ({formatNpr(ipdNursingFeePerDayNpr)}/d)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={nursingDays}
                    onChange={(e) => {
                      const v = e.target.value;
                      setNursingDays(v);
                      recalcDepositionSettlement(selectedAdm, bedDays, doctorRounds, v, observationDays, otherCharges);
                    }}
                    className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Daily Observation Days ({formatNpr(ipdDailyObsFeeNpr)}/d)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={observationDays}
                    onChange={(e) => {
                      const v = e.target.value;
                      setObservationDays(v);
                      recalcDepositionSettlement(selectedAdm, bedDays, doctorRounds, nursingDays, v, otherCharges);
                    }}
                    className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">Other Proc. Charges</label>
                  <input
                    type="number"
                    min={0}
                    value={otherCharges}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOtherCharges(v);
                      recalcDepositionSettlement(selectedAdm, bedDays, doctorRounds, nursingDays, observationDays, v);
                    }}
                    className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">Final Settlement Paid</label>
                  <input
                    type="number"
                    min={0}
                    value={finalSettleAmt}
                    onChange={(e) => setFinalSettleAmt(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">Settlement Mode</label>
                  <select
                    value={finalSettleMode}
                    onChange={(e) => setFinalSettleMode(e.target.value as PaymentMode)}
                    className="w-full sm:w-48 px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank / QR">Bank / QR</option>
                  </select>
                </div>
                <div className="col-span-2 sm:col-span-3 text-[11px] text-slate-600 pt-1">
                  Adm ({formatNpr(selectedAdm.admissionFeeNpr || 0)}) +
                  Bed ({formatNpr((Math.max(1, Number(bedDays) || 1)) * selectedAdm.bedDailyRateNpr)}) +
                  Rounds ({formatNpr((Math.max(0, Number(doctorRounds) || 0)) * ipdRoundFeeNpr)}) +
                  Nursing ({formatNpr((Math.max(0, Number(nursingDays) || 0)) * ipdNursingFeePerDayNpr)}) +
                  Daily Obs ({formatNpr((Math.max(0, Number(observationDays) || 0)) * ipdDailyObsFeeNpr)}) +
                  Shift Obs ({formatNpr(selectedAdm.nursingObservationChargesNpr || 0)}) +{' '}
                  <strong>{selectedAdm.usedMedicines.length} Meds</strong> ({formatNpr(selectedAdm.medicinesTotalNpr)}) +{' '}
                  <strong>{selectedAdm.investigationsDone.length} Inv.</strong> ({formatNpr(selectedAdm.investigationsTotalNpr)}) −{' '}
                  Deposits ({formatNpr(selectedAdm.totalDepositPaidNpr)}). Bed <strong>{selectedAdm.currentBedLabel}</strong> releases automatically.
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowDepositionModal(false)} className="px-3.5 py-2 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={finalizingDep}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  <Printer className="w-3.5 h-3.5" />
                  {finalizingDep ? 'Finalizing...' : 'Finalize & Print Deposition Summary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* QUICK DISCHARGE SUMMARY PREVIEW MODAL */}
      {showQuickSummaryModal && selectedAdm && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowQuickSummaryModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-indigo-50">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-indigo-600" />
                  Quick Discharge Summary — {selectedAdm.patientName} ({selectedAdm.admissionNumber})
                </h2>
                <p className="text-[11px] text-slate-600">
                  Synthesized from admission diagnosis, nursing vitals &amp; I/O chart, progress notes, round observations, medications, and investigations.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowQuickSummaryModal(false)}
                className="text-slate-500 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setQuickSummaryText(buildQuickDischargeSummary(selectedAdm, modSettings))}
                  className="px-3 py-1.5 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100"
                >
                  Regenerate from Latest Chart Notes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(quickSummaryText);
                      setCopiedQuickSummary(true);
                    }
                  }}
                  className="px-3 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  {copiedQuickSummary ? 'Copied to Clipboard' : 'Copy Clinical Text'}
                </button>
              </div>
              <textarea
                rows={15}
                value={quickSummaryText}
                onChange={(e) => setQuickSummaryText(e.target.value)}
                className="w-full p-3 font-mono text-[11px] leading-relaxed border border-slate-300 rounded-lg bg-slate-50 focus:bg-white focus:outline-none focus:border-indigo-500"
              />
              <div className="flex flex-wrap justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowQuickSummaryModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const previewAdm: IpdAdmission = {
                      ...selectedAdm,
                      hospitalCourseSummary: quickSummaryText,
                    };
                    setShowQuickSummaryModal(false);
                    setPrintAdmission(previewAdm);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Preview &amp; Print A4 Summary
                </button>
                {canClinical && selectedAdm.disposition === 'Admitted' && (
                  <button
                    type="button"
                    onClick={() => {
                      openDepositionModal();
                      setCourseSummary(quickSummaryText);
                      setShowQuickSummaryModal(false);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5" />
                    Apply to Discharge &amp; Finalize
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {printAdmission && (
        <ClinicalDepositionPrintModal
          mode="IPD"
          admission={printAdmission}
          settings={db.settings}
          documentDesigns={db.documentDesigns}
          centers={db.centers}
          autoPrint={modSettings?.printOptions?.autoPrintByTemplate?.ipdDeposition === 'AUTO_PRINT'}
          onClose={() => setPrintAdmission(null)}
        />
      )}

      {printAdmissionSlip && (
        <IpdAdmissionPrintModal
          admission={printAdmissionSlip}
          settings={db.settings}
          onClose={() => setPrintAdmissionSlip(null)}
        />
      )}

      {printFeeReceiptAdm && (
        <IpdAdmissionFeeReceiptModal
          admission={printFeeReceiptAdm}
          settings={db.settings}
          autoPrint={modSettings?.printOptions?.autoPrintByTemplate?.admissionReceipt === 'AUTO_PRINT'}
          onClose={() => setPrintFeeReceiptAdm(null)}
        />
      )}

      {printIndividualBill && (
        <IpdIndividualCashBillModal
          admission={printIndividualBill.admission}
          cashBill={printIndividualBill.bill}
          settings={db.settings}
          autoPrint={modSettings?.printOptions?.autoPrintByTemplate?.posBill === 'AUTO_PRINT'}
          onClose={() => setPrintIndividualBill(null)}
        />
      )}

      {printNursingAdm && (
        <NursingChartPrintModal
          admission={printNursingAdm}
          settings={db.settings}
          onClose={() => setPrintNursingAdm(null)}
        />
      )}

      {printStickerAdm && (
        <ThermalStickerPrintModal
          patientName={printStickerAdm.patientName}
          uhid={printStickerAdm.uhid || printStickerAdm.admissionNumber}
          ageGender={`${printStickerAdm.patientAge} ${printStickerAdm.patientAgeType} / ${printStickerAdm.patientGender}`}
          encounterLabel={`IPD · ${printStickerAdm.admissionNumber}`}
          doctorOrUnit={`${printStickerAdm.currentWardName} (${printStickerAdm.currentBedLabel}) · ${printStickerAdm.admittingDoctor}`}
          dateIso={printStickerAdm.admittedAt}
          settings={db.settings}
          onClose={() => setPrintStickerAdm(null)}
        />
      )}

      {printBedSummary && (
        <BedSummaryPrintModal
          beds={beds}
          admissions={admissions}
          settings={db.settings}
          onClose={() => setPrintBedSummary(false)}
        />
      )}

      {printIpdConsent && (
        <ConsentPrintModal
          consent={printIpdConsent.consent}
          patientName={printIpdConsent.adm.patientName}
          patientMeta={`${printIpdConsent.adm.patientAge} ${printIpdConsent.adm.patientAgeType} / ${printIpdConsent.adm.patientGender} · ${printIpdConsent.adm.patientAddress}`}
          recordRef={printIpdConsent.adm.admissionNumber}
          settings={db.settings}
          onClose={() => setPrintIpdConsent(null)}
        />
      )}

      {printCert && (
        <CertificatePrintModal
          type={printCert.type}
          birthCert={printCert.birthCert}
          deathCert={printCert.deathCert}
          settings={db.settings}
          onClose={() => setPrintCert(null)}
        />
      )}

      {/* ISSUE BIRTH CERTIFICATE MODAL */}
      {showBirthModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4" onClick={() => setShowBirthModal(false)}>
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-900">Issue Hospital Birth Certificate</h2>
              <button type="button" onClick={() => setShowBirthModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleIssueBirthCert} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Mother Full Name *</label>
                  <input required value={birthMother} onChange={(e) => setBirthMother(sanitizePersonName(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mother Age (Years)</label>
                  <input type="number" value={birthMotherAge} onChange={(e) => setBirthMotherAge(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Father Name</label>
                  <input value={birthFather} onChange={(e) => setBirthFather(sanitizePersonName(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Permanent Address</label>
                  <input value={birthAddress} onChange={(e) => setBirthAddress(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Newborn Sex</label>
                  <select value={birthGender} onChange={(e) => setBirthGender(e.target.value as any)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Birth Weight (kg)</label>
                  <input type="number" step="0.1" value={birthWeightKg} onChange={(e) => setBirthWeightKg(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Delivery Type</label>
                  <select value={birthDeliveryType} onChange={(e) => setBirthDeliveryType(e.target.value as any)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
                    <option value="Normal Vaginal Delivery">Normal Vaginal Delivery</option>
                    <option value="LSCS (Cesarean Section)">LSCS (Cesarean Section)</option>
                    <option value="Assisted / Instrumental">Assisted / Instrumental</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">APGAR Score</label>
                  <input value={birthApgar} onChange={(e) => setBirthApgar(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Attending Obstetrician / Medical Officer</label>
                  <input value={birthDoctor} onChange={(e) => setBirthDoctor(sanitizePersonName(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowBirthModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingCert} className="px-4 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                  {savingCert ? 'Issuing...' : 'Issue & Print Birth Certificate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ISSUE DEATH CERTIFICATE MODAL */}
      {showDeathModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4" onClick={() => setShowDeathModal(false)}>
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-900">Issue Death Certificate (MCCD)</h2>
              <button type="button" onClick={() => setShowDeathModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleIssueDeathCert} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Deceased Full Name *</label>
                  <input required value={deathName} onChange={(e) => setDeathName(sanitizePersonName(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Age (Years)</label>
                  <input type="number" value={deathAge} onChange={(e) => setDeathAge(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Gender</label>
                  <select value={deathGender} onChange={(e) => setDeathGender(e.target.value as any)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Next of Kin / Father / Spouse</label>
                  <input value={deathKin} onChange={(e) => setDeathKin(sanitizePersonName(e.target.value))} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Manner of Death</label>
                  <select value={deathManner} onChange={(e) => setDeathManner(e.target.value as any)} className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg">
                    <option value="Natural">Natural</option>
                    <option value="Accident / RTA">Accident / RTA</option>
                    <option value="Assault / Homicide">Assault / Homicide</option>
                    <option value="Suicide">Suicide</option>
                    <option value="Pending Forensic">Pending Forensic</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Address</label>
                  <input value={deathAddress} onChange={(e) => setDeathAddress(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Immediate Cause of Death *</label>
                  <input required value={deathImmediate} onChange={(e) => setDeathImmediate(e.target.value)} placeholder="e.g., Cardiopulmonary arrest secondary to septic shock" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Antecedent / Underlying Condition</label>
                  <input value={deathAntecedent} onChange={(e) => setDeathAntecedent(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Certifying Medical Officer</label>
                  <input value={deathDoctor} onChange={(e) => setDeathDoctor(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowDeathModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingCert} className="px-4 py-1.5 font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800">
                  {savingCert ? 'Issuing...' : 'Issue & Print Death Certificate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* IPD TARIFF & BED TIMING MODAL */}
      {showIpdTariffModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowIpdTariffModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  IPD Dynamic Bed Timing, Per-Day / Per-Round Charges &amp; Schedule
                </h2>
              </div>
              <button type="button" onClick={() => setShowIpdTariffModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveIpdTariffs} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed Cycle Start</label>
                  <input
                    type="time"
                    required
                    value={draftCycleStart}
                    onChange={(e) => setDraftCycleStart(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed Cycle End</label>
                  <input
                    type="time"
                    required
                    value={draftCycleEnd}
                    onChange={(e) => setDraftCycleEnd(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Bed Schedule Rule</label>
                  <select
                    value={draftBedScheduleMode}
                    onChange={(e) => setDraftBedScheduleMode(e.target.value as IpdBedScheduleMode)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="CYCLE_WINDOW">Cycle Window (e.g. 07:00–19:00)</option>
                    <option value="24H_ELAPSED">Exact 24 Hours Elapsed</option>
                    <option value="MIDNIGHT_CALENDAR">Midnight Calendar Date</option>
                  </select>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
                <div className="font-semibold text-slate-900">Doctor Round Charge &amp; Schedule</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Rate (रू)</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={draftRoundFee}
                      onChange={(e) => setDraftRoundFee(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Basis</label>
                    <select
                      value={draftRoundBasis}
                      onChange={(e) => setDraftRoundBasis(e.target.value as IpdServiceChargeBasis)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="PER_DAY">Per Day</option>
                      <option value="PER_ROUND">Per Round</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Rounds / Day</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draftRoundRoundsPerDay}
                      onChange={(e) => setDraftRoundRoundsPerDay(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Schedule Times</label>
                    <input
                      value={draftRoundScheduleTimes}
                      onChange={(e) => setDraftRoundScheduleTimes(e.target.value)}
                      placeholder="09:00, 18:00"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
                <div className="font-semibold text-slate-900">Nursing Care Charge &amp; Schedule</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Rate (रू)</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={draftNursingFee}
                      onChange={(e) => setDraftNursingFee(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Basis</label>
                    <select
                      value={draftNursingBasis}
                      onChange={(e) => setDraftNursingBasis(e.target.value as IpdServiceChargeBasis)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="PER_DAY">Per Day</option>
                      <option value="PER_ROUND">Per Round</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Rounds / Day</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draftNursingRoundsPerDay}
                      onChange={(e) => setDraftNursingRoundsPerDay(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Schedule Times</label>
                    <input
                      value={draftNursingScheduleTimes}
                      onChange={(e) => setDraftNursingScheduleTimes(e.target.value)}
                      placeholder="08:00, 20:00"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
                <div className="font-semibold text-slate-900">Observation Charge &amp; Schedule</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Rate (रू)</label>
                    <input
                      type="number"
                      min={0}
                      required
                      value={draftObsFee}
                      onChange={(e) => setDraftObsFee(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Basis</label>
                    <select
                      value={draftObsBasis}
                      onChange={(e) => setDraftObsBasis(e.target.value as IpdServiceChargeBasis)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="PER_DAY">Per Day</option>
                      <option value="PER_ROUND">Per Round</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Rounds / Day</label>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={draftObsRoundsPerDay}
                      onChange={(e) => setDraftObsRoundsPerDay(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[10.5px] font-medium text-slate-700 mb-1">Schedule Times</label>
                    <input
                      value={draftObsScheduleTimes}
                      onChange={(e) => setDraftObsScheduleTimes(e.target.value)}
                      placeholder="08:00, 20:00"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">IPD Admission Fee (रू)</label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={draftAdmissionFee}
                    onChange={(e) => setDraftAdmissionFee(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Default IPD Credit Limit (रू)</label>
                  <input
                    type="number"
                    min={1000}
                    required
                    value={draftCreditLimit}
                    onChange={(e) => setDraftCreditLimit(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowIpdTariffModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingIpdTariff}
                  className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingIpdTariff ? 'Saving...' : 'Save IPD Tariffs & Schedules'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
