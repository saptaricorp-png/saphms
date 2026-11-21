import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ambulance,
  BedDouble,
  FlaskConical,
  Pill,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  Stethoscope,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AgeType,
  ClinicalInvestigationItem,
  ClinicalUsedMedicineItem,
  ExternalReferralDetail,
  LimsDatabase,
  OpdConsultationTypeConfig,
  OpdDispositionType,
  OpdVisit,
  PatientGender,
  PatientRecord,
  PaymentMode,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { normalizeNepalPhone, sanitizePersonName, stripCountryPrefixForEdit } from '../utils/textFormat';
import { ClinicalDepositionPrintModal } from '../components/ClinicalDepositionPrintModal';
import { OpdPrescriptionStickerModal, ThermalStickerPrintModal } from '../components/HospitalPrintModals';
import { getRegistrationFieldRule } from '../utils/registrationFields';

interface OpdViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  onAdmitFromOpd?: (visit: OpdVisit) => void;
  initialSearchQuery?: string;
  preselectedPatient?: PatientRecord | null;
  onClearPreselectedPatient?: () => void;
}

const DEFAULT_OPD_CONSULT_TYPES: OpdConsultationTypeConfig[] = [
  { id: 'opd-general', name: 'General OPD', feeNpr: 500, active: true },
  { id: 'opd-specialist', name: 'Specialist MD', feeNpr: 800, active: true },
  { id: 'opd-followup', name: 'Follow-Up (7 Days)', feeNpr: 300, active: true },
  { id: 'opd-priority', name: 'Priority / Fast Track', feeNpr: 1000, active: true },
];

export function OpdView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  onAdmitFromOpd,
  initialSearchQuery,
  preselectedPatient,
  onClearPreselectedPatient,
}: OpdViewProps) {
  const canClinical = hasPerm('hospital.clinical');
  const visits = db.opdVisits || [];

  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [dispFilter, setDispFilter] = useState<'ALL' | OpdDispositionType>('ALL');
  const [selectedId, setSelectedId] = useState<string>(visits[0]?.id || '');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [printVisit, setPrintVisit] = useState<OpdVisit | null>(null);
  const [printStickerVisit, setPrintStickerVisit] = useState<OpdVisit | null>(null);
  const [thermalStickerVisit, setThermalStickerVisit] = useState<OpdVisit | null>(null);
  const [autoPrintSlipOnRegister, setAutoPrintSlipOnRegister] = useState(true);
  const [stickerAutoPrint, setStickerAutoPrint] = useState(false);

  const modSettings = db.settings?.moduleSettings;
  const opdFieldRule = (key: string) => getRegistrationFieldRule(modSettings, 'opd', key);
  const opdAutoPrintConfigured =
    modSettings?.printOptions?.autoPrintByTemplate?.opdSlip === 'AUTO_PRINT';

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // Dynamic OPD Consultation Types & Register OPD Form State
  const allConsultTypes = useMemo(() => {
    const list = db.settings?.moduleSettings?.opdConsultationTypes;
    return list && list.length > 0 ? list : DEFAULT_OPD_CONSULT_TYPES;
  }, [db.settings]);

  const activeConsultTypes = useMemo(
    () => allConsultTypes.filter((t) => t.active),
    [allConsultTypes]
  );

  const freeFollowUpDays = db.settings?.moduleSettings?.opdFreeFollowUpDays ?? 5;
  const sameDoctorFollowUpOnly = db.settings?.moduleSettings?.opdFollowUpSameDoctorOnly !== false;
  const withinWindowFollowUpFee = db.settings?.moduleSettings?.opdFollowUpWithinWindowFeeNpr ?? 0;
  const afterExpiryFollowUpFee = db.settings?.moduleSettings?.opdFollowUpFeeAfterExpiryNpr ?? 300;

  const defaultFee =
    activeConsultTypes[0]?.feeNpr ??
    db.settings.moduleSettings?.defaultOpdConsultationFeeNpr ??
    500;
  const [regConsultTypeId, setRegConsultTypeId] = useState<string>(
    activeConsultTypes[0]?.id || 'opd-general'
  );
  const doctorOptions = useMemo(() => {
    const staffDocs = (db.staff || [])
      .filter((s) =>
        ['DOCTOR', 'PATHOLOGIST', 'MEDICAL_DIRECTOR', 'SUPER_ADMIN'].includes(s.roleId) ||
        s.fullName.trim().toLowerCase().startsWith('dr.')
      )
      .map((s) => s.fullName);
    return Array.from(new Set(['Dr. Santosh Majhi, MD', ...staffDocs]));
  }, [db.staff]);

  const [regPatientId, setRegPatientId] = useState('');
  const [regUhid, setRegUhid] = useState('');
  const [regPatientSearch, setRegPatientSearch] = useState('');
  const [regHideDemographics, setRegHideDemographics] = useState(false);
  const [regFollowUpNotice, setRegFollowUpNotice] = useState<{
    status: 'FREE' | 'PAID_WINDOW' | 'DIFFERENT_DOCTOR' | 'EXPIRED' | 'NEW_PATIENT';
    daysSince: number;
    matchedDoctor?: string;
    lastToken?: string;
  } | null>(null);
  const [regName, setRegName] = useState('');
  const [regAge, setRegAge] = useState('35');
  const [regAgeType, setRegAgeType] = useState<AgeType>('Years');
  const [regGender, setRegGender] = useState<PatientGender>('Male');
  const [regPhone, setRegPhone] = useState('');
  const [regAddress, setRegAddress] = useState('');
  const [regDept, setRegDept] = useState('General Medicine OPD');
  const [regDoctor, setRegDoctor] = useState(doctorOptions[0] || 'Dr. Santosh Majhi, MD');
  const [regDoctorCustom, setRegDoctorCustom] = useState('');
  const [regComplaint, setRegComplaint] = useState('');
  const [regFee, setRegFee] = useState(String(defaultFee));
  const [regTenderedNpr, setRegTenderedNpr] = useState('');
  const [regPayMode, setRegPayMode] = useState<PaymentMode>('Cash');
  const [regIsFreeFollowUp, setRegIsFreeFollowUp] = useState(false);
  const [registering, setRegistering] = useState(false);

  // Inline OPD Fee & Consultation Types Modal
  const [showOpdFeeModal, setShowOpdFeeModal] = useState(false);
  const [draftTypes, setDraftTypes] = useState<OpdConsultationTypeConfig[]>(allConsultTypes);
  const [draftFreeDays, setDraftFreeDays] = useState(String(freeFollowUpDays));
  const [draftSameDocOnly, setDraftSameDocOnly] = useState(sameDoctorFollowUpOnly);
  const [draftWithinWindowFee, setDraftWithinWindowFee] = useState(String(withinWindowFollowUpFee));
  const [draftAfterExpiryFee, setDraftAfterExpiryFee] = useState(String(afterExpiryFollowUpFee));
  const [savingTypes, setSavingTypes] = useState(false);

  const filteredVisits = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return visits.filter((v) => {
      if (dispFilter !== 'ALL' && v.disposition !== dispFilter) return false;
      if (!q) return true;
      return `${v.tokenNumber} ${v.patientName} ${v.patientPhone} ${v.consultingDoctor} ${v.department} ${v.provisionalDiagnosis} ${v.externalReferral?.referredToHospital || ''} ${v.externalReferral?.referredToPlace || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [visits, searchTerm, dispFilter]);

  const selectedVisit = useMemo(
    () => visits.find((v) => v.id === selectedId) || filteredVisits[0] || null,
    [visits, selectedId, filteredVisits]
  );

  // Consultation Workbench local state synced with selectedVisit
  const [bp, setBp] = useState('');
  const [pulse, setPulse] = useState('');
  const [tempF, setTempF] = useState('');
  const [spo2, setSpo2] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [complaint, setComplaint] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [notes, setNotes] = useState('');
  const [advice, setAdvice] = useState('');
  const [disposition, setDisposition] = useState<OpdDispositionType>('Waiting');
  const [prescribedMeds, setPrescribedMeds] = useState<ClinicalUsedMedicineItem[]>([]);
  const [investigations, setInvestigations] = useState<ClinicalInvestigationItem[]>([]);

  // Quick add medicine state
  const [addMedId, setAddMedId] = useState(db.pharmacyMedicines[0]?.id || '');
  const [addMedDose, setAddMedDose] = useState('1 Tab PO BD x 5 days');
  const [addMedQty, setAddMedQty] = useState('10');

  // Quick add investigation state
  const [addSrvId, setAddSrvId] = useState(db.services[0]?.id || '');
  const [autoCreateOrder, setAutoCreateOrder] = useState(true);
  const [newOrderServiceIds, setNewOrderServiceIds] = useState<string[]>([]);

  // External referral fields when disposition === 'Referred to External Hospital'
  const [refHospitalId, setRefHospitalId] = useState('');
  const [refHospital, setRefHospital] = useState('');
  const [refPlace, setRefPlace] = useState('');
  const [refManagerName, setRefManagerName] = useState('');
  const [refManagerPhone, setRefManagerPhone] = useState('');
  const [refDept, setRefDept] = useState('Emergency / Higher Center');
  const [refReason, setRefReason] = useState('');
  const [refCondition, setRefCondition] = useState('Hemodynamically stable with vitals recorded');
  const [refTransport, setRefTransport] = useState<ExternalReferralDetail['transportMode']>('ALS Ambulance');
  const [refAmbulanceId, setRefAmbulanceId] = useState('');
  const [refAmbulanceName, setRefAmbulanceName] = useState('');
  const [refAmbulanceNumber, setRefAmbulanceNumber] = useState('');
  const [refCaseType, setRefCaseType] = useState('GENERAL');

  const [savingConsult, setSavingConsult] = useState(false);

  useEffect(() => {
    if (!selectedVisit) return;
    setBp(selectedVisit.vitals?.bp || '');
    setPulse(selectedVisit.vitals?.pulseBpm ? String(selectedVisit.vitals.pulseBpm) : '');
    setTempF(selectedVisit.vitals?.tempF ? String(selectedVisit.vitals.tempF) : '');
    setSpo2(selectedVisit.vitals?.spo2Pct ? String(selectedVisit.vitals.spo2Pct) : '');
    setWeightKg(selectedVisit.vitals?.weightKg ? String(selectedVisit.vitals.weightKg) : '');
    setComplaint(selectedVisit.chiefComplaint || '');
    setDiagnosis(selectedVisit.provisionalDiagnosis || '');
    setNotes(selectedVisit.clinicalNotes || '');
    setAdvice(selectedVisit.followUpAdvice || '');
    setDisposition(selectedVisit.disposition);
    setPrescribedMeds(selectedVisit.prescribedMedicines || []);
    setInvestigations(selectedVisit.investigations || []);
    setNewOrderServiceIds([]);

    setRefHospitalId(selectedVisit.externalReferral?.referredHospitalId || '');
    setRefHospital(selectedVisit.externalReferral?.referredToHospital || '');
    setRefPlace(selectedVisit.externalReferral?.referredToPlace || '');
    setRefManagerName(selectedVisit.externalReferral?.referredHospitalManagerName || '');
    setRefManagerPhone(selectedVisit.externalReferral?.referredHospitalManagerPhone || '');
    setRefDept(selectedVisit.externalReferral?.referredDepartment || 'Emergency / Specialist Care');
    setRefReason(selectedVisit.externalReferral?.referralReason || '');
    setRefCondition(selectedVisit.externalReferral?.conditionAtReferral || 'Conscious & hemodynamically stable');
    setRefTransport(selectedVisit.externalReferral?.transportMode || 'ALS Ambulance');
    setRefAmbulanceId(selectedVisit.externalReferral?.ambulanceId || '');
    setRefAmbulanceName(selectedVisit.externalReferral?.ambulanceName || '');
    setRefAmbulanceNumber(selectedVisit.externalReferral?.ambulanceNumber || '');
    setRefCaseType(selectedVisit.externalReferral?.referralCaseType || 'GENERAL');
  }, [selectedVisit]);

  const searchablePatients = useMemo(() => {
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
        lastOpdVisitAt?: string;
        sourceBadge: 'PATIENT' | 'EMERGENCY';
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
        lastOpdVisitAt: pt.lastOpdVisitAt,
        sourceBadge: 'PATIENT',
      });
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
    const q = regPatientSearch.trim().toLowerCase();
    const list = Array.from(map.values());
    if (!q) return list;
    return list.filter((p) =>
      `${p.uhid} ${p.fullName} ${p.phone}`.toLowerCase().includes(q)
    );
  }, [db.patients, db.emergencyCases, regPatientSearch]);

  // Evaluate same-doctor follow-up eligibility dynamically whenever patient or consulting doctor changes
  const evaluatePatientDoctorFollowUp = (
    pId: string,
    pUhid: string,
    pName: string,
    pPhone: string,
    doctorLabel: string,
    fallbackLastOpdIso?: string
  ) => {
    const selectedDocNorm = doctorLabel.trim().toLowerCase();
    const cleanPPhone = pPhone.replace(/\D/g, '');
    const priorVisits = (db.opdVisits || [])
      .filter((v) => {
        if (pId && v.patientId === pId) return true;
        if (pUhid && v.uhid && v.uhid.toUpperCase() === pUhid.toUpperCase()) return true;
        const vPhone = (v.patientPhone || '').replace(/\D/g, '');
        return (
          pName.trim() &&
          v.patientName.trim().toLowerCase() === pName.trim().toLowerCase() &&
          cleanPPhone.length >= 6 &&
          vPhone.endsWith(cleanPPhone.slice(-10))
        );
      })
      .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());

    const foundType = activeConsultTypes.find((t) => t.id === regConsultTypeId);
    const stdFee = foundType?.feeNpr ?? defaultFee;

    if (priorVisits.length === 0 && !fallbackLastOpdIso) {
      setRegFollowUpNotice({ status: 'NEW_PATIENT', daysSince: 0 });
      setRegIsFreeFollowUp(false);
      setRegFee(String(stdFee));
      return;
    }

    const sameDocVisit = priorVisits.find(
      (v) => (v.consultingDoctor || '').trim().toLowerCase() === selectedDocNorm
    );
    const refVisit = sameDoctorFollowUpOnly ? sameDocVisit : (sameDocVisit || priorVisits[0]);

    if (!refVisit) {
      if (priorVisits.length > 0 && sameDoctorFollowUpOnly) {
        const latestAny = priorVisits[0];
        const dAny = Math.max(0, Math.floor((Date.now() - new Date(latestAny.visitDate).getTime()) / 86400000));
        setRegFollowUpNotice({
          status: 'DIFFERENT_DOCTOR',
          daysSince: dAny,
          matchedDoctor: latestAny.consultingDoctor,
          lastToken: latestAny.tokenNumber,
        });
        setRegIsFreeFollowUp(false);
        setRegFee(String(stdFee));
        return;
      }
      if (fallbackLastOpdIso) {
        const daysFallback = Math.max(0, Math.floor((Date.now() - new Date(fallbackLastOpdIso).getTime()) / 86400000));
        if (daysFallback <= freeFollowUpDays) {
          setRegFollowUpNotice({
            status: withinWindowFollowUpFee === 0 ? 'FREE' : 'PAID_WINDOW',
            daysSince: daysFallback,
          });
          setRegIsFreeFollowUp(withinWindowFollowUpFee === 0);
          setRegFee(String(withinWindowFollowUpFee));
        } else {
          setRegFollowUpNotice({ status: 'EXPIRED', daysSince: daysFallback });
          setRegIsFreeFollowUp(false);
          setRegFee(String(afterExpiryFollowUpFee));
        }
        return;
      }
    }

    const daysSince = Math.max(
      0,
      Math.floor((Date.now() - new Date(refVisit!.visitDate).getTime()) / 86400000)
    );
    if (daysSince <= freeFollowUpDays) {
      setRegFollowUpNotice({
        status: withinWindowFollowUpFee === 0 ? 'FREE' : 'PAID_WINDOW',
        daysSince,
        matchedDoctor: refVisit!.consultingDoctor,
        lastToken: refVisit!.tokenNumber,
      });
      setRegIsFreeFollowUp(withinWindowFollowUpFee === 0);
      setRegFee(String(withinWindowFollowUpFee));
    } else {
      setRegFollowUpNotice({
        status: 'EXPIRED',
        daysSince,
        matchedDoctor: refVisit!.consultingDoctor,
        lastToken: refVisit!.tokenNumber,
      });
      setRegIsFreeFollowUp(false);
      setRegFee(String(afterExpiryFollowUpFee));
    }
  };

  const resolvedFormDoctor =
    regDoctor === '__CUSTOM__' ? regDoctorCustom.trim() || 'OPD Medical Officer' : regDoctor.trim();

  const handleSelectReturningPatient = (patientId: string) => {
    setRegPatientId(patientId);
    if (!patientId) {
      setRegUhid('');
      setRegHideDemographics(false);
      setRegFollowUpNotice({ status: 'NEW_PATIENT', daysSince: 0 });
      setRegIsFreeFollowUp(false);
      setRegPhone('');
      const found = activeConsultTypes.find((t) => t.id === regConsultTypeId);
      setRegFee(String(found?.feeNpr ?? defaultFee));
      return;
    }
    const pt =
      searchablePatients.find((p) => p.id === patientId) ||
      (db.patients || []).find((p) => p.id === patientId);
    if (!pt) return;
    setRegUhid(pt.uhid);
    setRegName(pt.fullName);
    setRegAge(String(pt.age));
    setRegAgeType(pt.ageType);
    setRegGender(pt.gender);
    setRegPhone(stripCountryPrefixForEdit(pt.phone));
    setRegAddress(pt.address || '');
    setRegHideDemographics(true);

    evaluatePatientDoctorFollowUp(
      pt.id,
      pt.uhid,
      pt.fullName,
      pt.phone || '',
      resolvedFormDoctor,
      pt.lastOpdVisitAt
    );
  };

  useEffect(() => {
    if (!showRegisterModal) return;
    if (!regPatientId && !regName.trim() && !regPhone.trim()) {
      setRegFollowUpNotice({ status: 'NEW_PATIENT', daysSince: 0 });
      return;
    }
    evaluatePatientDoctorFollowUp(
      regPatientId,
      regUhid,
      regName,
      regPhone,
      resolvedFormDoctor
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regDoctor, regDoctorCustom, showRegisterModal]);

  useEffect(() => {
    if (!preselectedPatient) return;
    setShowRegisterModal(true);
    setRegPatientId(preselectedPatient.id);
    setRegUhid(preselectedPatient.uhid);
    setRegName(preselectedPatient.fullName);
    setRegAge(String(preselectedPatient.age));
    setRegAgeType(preselectedPatient.ageType);
    setRegGender(preselectedPatient.gender);
    setRegPhone(stripCountryPrefixForEdit(preselectedPatient.phone));
    setRegAddress(preselectedPatient.address || '');
    setRegHideDemographics(true);
    evaluatePatientDoctorFollowUp(
      preselectedPatient.id,
      preselectedPatient.uhid,
      preselectedPatient.fullName,
      preselectedPatient.phone || '',
      resolvedFormDoctor,
      preselectedPatient.lastOpdVisitAt
    );
    onClearPreselectedPatient?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedPatient, freeFollowUpDays, afterExpiryFollowUpFee, onClearPreselectedPatient]);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedName = regName.trim() || (opdFieldRule('patientName') === 'HIDDEN' ? 'OPD Walk-In Patient' : '');
    if (!canClinical || !resolvedName) return;
    const resolvedDoctor =
      regDoctor === '__CUSTOM__' ? regDoctorCustom.trim() || 'OPD Medical Officer' : regDoctor.trim();
    setRegistering(true);
    const chosenType = activeConsultTypes.find((t) => t.id === regConsultTypeId);
    try {
      const resp = await apiRequest<{ visit: OpdVisit; db: LimsDatabase }>('/api/opd/visits', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          patientId: regPatientId || undefined,
          uhid: regUhid || undefined,
          patientName: resolvedName,
          patientAge: Number(regAge) || 35,
          patientAgeType: regAgeType,
          patientGender: regGender,
          patientPhone: normalizeNepalPhone(regPhone),
          patientAddress: regAddress.trim() || 'Rajbiraj, Saptari',
          department: regDept,
          consultingDoctor: resolvedDoctor,
          chiefComplaint: regComplaint.trim() || 'Outpatient medical evaluation',
          consultationTypeName: regIsFreeFollowUp
            ? `Free Follow-Up (≤${freeFollowUpDays}d)`
            : regFollowUpNotice?.status === 'EXPIRED'
            ? `Follow-Up (After ${freeFollowUpDays}d Free Window)`
            : chosenType?.name || 'General OPD',
          consultationFeeNpr: regIsFreeFollowUp ? 0 : Number(regFee) || 0,
          isFreeFollowUp: regIsFreeFollowUp,
          paymentMode: regPayMode,
        }),
      });
      setShowRegisterModal(false);
      setRegPatientId('');
      setRegUhid('');
      setRegPatientSearch('');
      setRegHideDemographics(false);
      setRegFollowUpNotice(null);
      setRegName('');
      setRegPhone('');
      setRegAddress('');
      setRegComplaint('');
      setRegIsFreeFollowUp(false);
      setSelectedId(resp.visit.id);
      if (autoPrintSlipOnRegister) {
        setStickerAutoPrint(opdAutoPrintConfigured);
        setPrintStickerVisit(resp.visit);
      }
      onUpdated(
        resp.db,
        `Registered OPD token ${resp.visit.tokenNumber} (${resp.visit.consultationTypeName || 'OPD'}) for ${resp.visit.patientName}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to register OPD visit.');
    } finally {
      setRegistering(false);
    }
  };

  const handleSaveOpdTypes = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = draftTypes
      .map((t) => ({
        ...t,
        name: t.name.trim(),
        feeNpr: Math.max(0, Number(t.feeNpr) || 0),
      }))
      .filter((t) => t.name.length > 0);
    if (cleaned.length === 0) return;
    setSavingTypes(true);
    try {
      const firstActive = cleaned.find((t) => t.active) || cleaned[0];
      const freeDaysVal = Number.isFinite(Number(draftFreeDays)) ? Math.max(0, Number(draftFreeDays)) : 5;
      const withinFeeVal = Number.isFinite(Number(draftWithinWindowFee)) ? Math.max(0, Number(draftWithinWindowFee)) : 0;
      const expiryFeeVal = Number.isFinite(Number(draftAfterExpiryFee)) ? Math.max(0, Number(draftAfterExpiryFee)) : 0;
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/settings', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({
          moduleSettings: {
            ...(db.settings?.moduleSettings || {}),
            opdConsultationTypes: cleaned,
            defaultOpdConsultationFeeNpr: firstActive.feeNpr,
            opdFreeFollowUpDays: freeDaysVal,
            opdFollowUpSameDoctorOnly: draftSameDocOnly,
            opdFollowUpWithinWindowFeeNpr: withinFeeVal,
            opdFollowUpFeeAfterExpiryNpr: expiryFeeVal,
          },
        }),
      });
      setShowOpdFeeModal(false);
      setRegConsultTypeId(firstActive.id);
      setRegFee(String(firstActive.feeNpr));
      onUpdated(
        resp.db,
        `Saved ${cleaned.length} OPD consultation types (${freeDaysVal}-day ${draftSameDocOnly ? 'Same-Doctor' : 'Any-Doctor'} follow-up @ ${formatNpr(withinFeeVal)}, expiry ${formatNpr(expiryFeeVal)}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save OPD consultation fees.');
    } finally {
      setSavingTypes(false);
    }
  };

  const handleAddPrescribedMed = () => {
    const med = db.pharmacyMedicines.find((m) => m.id === addMedId);
    if (!med) return;
    const qty = Math.max(1, Number(addMedQty) || 1);
    const item: ClinicalUsedMedicineItem = {
      id: `opm-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
      administeredAt: new Date().toISOString(),
      medicineId: med.id,
      medicineName: `${med.brandName} (${med.strength})`,
      genericName: med.genericName,
      dosageRoute: addMedDose.trim() || 'As directed',
      quantity: qty,
      unitPriceNpr: med.defaultMrpNpr,
      totalPriceNpr: Number((qty * med.defaultMrpNpr).toFixed(2)),
      administeredBy: activeUser.fullName,
    };
    setPrescribedMeds((prev) => [...prev, item]);
  };

  const handleAddInvestigation = () => {
    const srv = db.services.find((s) => s.id === addSrvId);
    if (!srv) return;
    const item: ClinicalInvestigationItem = {
      id: `opi-${Date.now()}-${Math.random().toString(36).slice(2, 4)}`,
      orderedAt: new Date().toISOString(),
      serviceId: srv.id,
      serviceCode: srv.code,
      serviceName: srv.name,
      category: srv.serviceCategory || (srv.department === 'Radiology' ? 'RADIOLOGY' : 'PATHOLOGY'),
      status: 'Ordered',
      priceNpr: srv.price,
    };
    setInvestigations((prev) => [...prev, item]);
    if (autoCreateOrder) {
      setNewOrderServiceIds((prev) => (prev.includes(srv.id) ? prev : [...prev, srv.id]));
    }
  };

  const handleSaveConsult = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit || !canClinical) return;
    setSavingConsult(true);
    try {
      const resp = await apiRequest<{
        visit: OpdVisit;
        createdOrder?: { accessionNumber: string } | null;
        db: LimsDatabase;
      }>(`/api/opd/visits/${selectedVisit.id}`, activeUser.id, {
        method: 'PATCH',
        body: JSON.stringify({
          vitals: {
            bp: bp.trim() || undefined,
            pulseBpm: pulse ? Number(pulse) : undefined,
            tempF: tempF ? Number(tempF) : undefined,
            spo2Pct: spo2 ? Number(spo2) : undefined,
            weightKg: weightKg ? Number(weightKg) : undefined,
          },
          chiefComplaint: complaint,
          provisionalDiagnosis: diagnosis,
          clinicalNotes: notes,
          followUpAdvice: advice,
          disposition,
          prescribedMedicines: prescribedMeds,
          investigations,
          createDiagnosticOrder: autoCreateOrder && newOrderServiceIds.length > 0,
          orderServiceIds: newOrderServiceIds,
          ...(disposition === 'Referred to External Hospital'
            ? {
                externalReferral: {
                  referredHospitalId: refHospitalId || undefined,
                  referredToHospital: refHospital.trim(),
                  referredToPlace: refPlace.trim(),
                  referredHospitalManagerName: refManagerName.trim() || undefined,
                  referredHospitalManagerPhone: refManagerPhone.trim() || undefined,
                  referredDepartment: refDept.trim(),
                  referralReason: refReason.trim() || diagnosis || 'Specialist evaluation required',
                  conditionAtReferral: refCondition.trim(),
                  transportMode: refTransport,
                  ambulanceId: refAmbulanceId || undefined,
                  ambulanceName: refAmbulanceName.trim() || undefined,
                  ambulanceNumber: refAmbulanceNumber.trim() || undefined,
                  referralCaseType: refCaseType || undefined,
                  referredAt: new Date().toISOString(),
                  referredBy: activeUser.fullName,
                },
              }
            : {}),
        }),
      });
      setNewOrderServiceIds([]);
      onUpdated(
        resp.db,
        `Saved OPD consultation ${resp.visit.tokenNumber}${
          resp.createdOrder ? ` & sent Order ${resp.createdOrder.accessionNumber} to Lab Queue` : ''
        }.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save OPD consultation.');
    } finally {
      setSavingConsult(false);
    }
  };

  const stats = useMemo(() => {
    return {
      total: visits.length,
      waiting: visits.filter((v) => v.disposition === 'Waiting' || v.disposition === 'In Consultation').length,
      admitted: visits.filter((v) => v.disposition === 'Admitted to IPD').length,
      referred: visits.filter((v) => v.disposition === 'Referred to External Hospital').length,
    };
  }, [visits]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Outpatient (OPD) Clinic, Triage &amp; Clinical Referral Desk
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            OPD queue tokens, vitals, medicine prescription, one-click Lab/Radiology test ordering, IPD bed admission &amp; external hospital referral
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(canClinical || hasPerm('settings.manage')) && (
            <button
              type="button"
              onClick={() => {
                setDraftTypes(allConsultTypes.map((t) => ({ ...t })));
                setDraftFreeDays(String(freeFollowUpDays));
                setDraftSameDocOnly(sameDoctorFollowUpOnly);
                setDraftWithinWindowFee(String(withinWindowFollowUpFee));
                setDraftAfterExpiryFee(String(afterExpiryFollowUpFee));
                setShowOpdFeeModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              OPD Follow-Up Rules ({freeFollowUpDays}d · {withinWindowFollowUpFee === 0 ? 'Free' : formatNpr(withinWindowFollowUpFee)} / {formatNpr(afterExpiryFollowUpFee)} After)
            </button>
          )}
          {canClinical && (
            <button
              type="button"
              onClick={() => {
                setRegPatientId('');
                setRegUhid('');
                setRegFollowUpNotice(null);
                setRegIsFreeFollowUp(false);
                const firstType = activeConsultTypes[0];
                if (firstType) {
                  setRegConsultTypeId(firstType.id);
                  setRegFee(String(firstType.feeNpr));
                } else {
                  setRegFee(String(defaultFee));
                }
                setShowRegisterModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Register OPD Patient
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Total OPD Visits</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {stats.total}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Active Fiscal Year</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Waiting / In Consultation</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {stats.waiting}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Pending physician disposition</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Converted to IPD Beds</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
            {stats.admitted}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Admitted under inpatient care</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Referred Outside</div>
          <div className="text-xl font-bold font-mono tabular-nums text-rose-700 mt-1">
            {stats.referred}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">External hospital referrals</div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-3 text-xs">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search OPD token #, patient name, phone, doctor, diagnosis, referred hospital..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'Waiting', 'In Consultation', 'Discharged Home', 'Admitted to IPD', 'Referred to External Hospital'] as const).map(
            (st) => (
              <button
                key={st}
                type="button"
                onClick={() => setDispFilter(st)}
                className={`px-2.5 py-1.5 rounded-lg border font-medium whitespace-nowrap ${
                  dispFilter === st
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {st === 'ALL' ? 'All Outcomes' : st}
              </button>
            )
          )}
        </div>
      </div>

      {/* Main Split Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Queue List */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-800">
            <span>OPD Token Queue ({filteredVisits.length})</span>
            <span className="font-mono text-slate-500">Click to open</span>
          </div>
          {filteredVisits.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">No matching OPD visits.</div>
          ) : (
            filteredVisits.map((v) => {
              const active = selectedVisit?.id === v.id;
              const bs = adToBs(v.visitDate);
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left px-4 py-3 transition-colors ${
                    active ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] font-bold text-blue-700">{v.tokenNumber}</span>
                    <span
                      className={`text-[11px] font-medium ${
                        v.disposition === 'Referred to External Hospital'
                          ? 'text-rose-700'
                          : v.disposition === 'Admitted to IPD'
                          ? 'text-blue-700'
                          : v.disposition === 'Discharged Home'
                          ? 'text-emerald-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {v.disposition}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-900 mt-0.5">{v.patientName}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {v.patientAge} {v.patientAgeType} / {v.patientGender} · {v.department}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {bs.formattedEn} · {v.consultingDoctor}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Right: Consultation & Referral Workbench */}
        <div className="lg:col-span-8">
          {!selectedVisit ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
              Select an OPD patient from the queue or register a new OPD token.
            </div>
          ) : (
            <form
              onSubmit={handleSaveConsult}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-5 text-xs"
            >
              {/* Patient Header & Quick Handoff Actions */}
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-bold text-blue-700">{selectedVisit.tokenNumber}</span>
                    <span className="text-slate-400">·</span>
                    <span className="text-base font-semibold text-slate-900">{selectedVisit.patientName}</span>
                    <span className="text-slate-500">
                      ({selectedVisit.patientAge} {selectedVisit.patientAgeType} / {selectedVisit.patientGender})
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    {selectedVisit.consultingDoctor} · {selectedVisit.department}
                    {selectedVisit.consultationTypeName ? ` · ${selectedVisit.consultationTypeName}` : ''}
                    {selectedVisit.uhid ? ` · UHID ${selectedVisit.uhid}` : ''} · Fee{' '}
                    <span className="font-mono font-semibold text-slate-800">
                      {selectedVisit.isFreeFollowUp
                        ? `FREE FOLLOW-UP (≤${freeFollowUpDays}d) · रू 0`
                        : `${formatNpr(selectedVisit.consultationFeeNpr)} (${selectedVisit.paymentMode})`}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setThermalStickerVisit(selectedVisit)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 whitespace-nowrap"
                  >
                    <Tag className="w-3.5 h-3.5 text-slate-700" />
                    Print Thermal Sticker
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintStickerVisit(selectedVisit)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print OPD Rx Slip
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintVisit(selectedVisit)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Printer className="w-3.5 h-3.5" />
                    Print Referral Summary
                  </button>
                  {canClinical &&
                    onAdmitFromOpd &&
                    selectedVisit.disposition !== 'Admitted to IPD' && (
                      <button
                        type="button"
                        onClick={() => onAdmitFromOpd(selectedVisit)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap"
                      >
                        <BedDouble className="w-3.5 h-3.5" />
                        Admit to IPD Bed
                      </button>
                    )}
                </div>
              </div>

              {/* Vitals Strip */}
              <div>
                <div className="flex items-center gap-1.5 font-semibold text-slate-800 mb-2">
                  <Activity className="w-3.5 h-3.5 text-blue-600" />
                  Triage Vitals
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">BP (mmHg)</label>
                    <input
                      value={bp}
                      onChange={(e) => setBp(e.target.value)}
                      placeholder="120/80"
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Pulse (bpm)</label>
                    <input
                      type="number"
                      value={pulse}
                      onChange={(e) => setPulse(e.target.value)}
                      placeholder="78"
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Temp (°F)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={tempF}
                      onChange={(e) => setTempF(e.target.value)}
                      placeholder="98.6"
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">SpO2 (%)</label>
                    <input
                      type="number"
                      value={spo2}
                      onChange={(e) => setSpo2(e.target.value)}
                      placeholder="98"
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500 mb-0.5">Weight (kg)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      placeholder="64"
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              {/* Clinical Findings */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Chief Complaint</label>
                  <input
                    value={complaint}
                    onChange={(e) => setComplaint(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Provisional Diagnosis</label>
                  <input
                    value={diagnosis}
                    onChange={(e) => setDiagnosis(e.target.value)}
                    placeholder="e.g., Acute Enteric Fever / Pneumonia"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Clinical Examination Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Prescribe Medicines */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
                <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                  <Pill className="w-3.5 h-3.5 text-emerald-600" />
                  Prescribed Medicines ({prescribedMeds.length})
                </div>
                {canClinical && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={addMedId}
                      onChange={(e) => setAddMedId(e.target.value)}
                      className="flex-1 min-w-[180px] px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      {db.pharmacyMedicines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.brandName} {m.strength} ({formatNpr(m.defaultMrpNpr)})
                        </option>
                      ))}
                    </select>
                    <input
                      value={addMedDose}
                      onChange={(e) => setAddMedDose(e.target.value)}
                      placeholder="Dosage / Route"
                      className="w-44 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                    <input
                      type="number"
                      min={1}
                      value={addMedQty}
                      onChange={(e) => setAddMedQty(e.target.value)}
                      className="w-16 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={handleAddPrescribedMed}
                      className="px-3 py-1.5 font-medium text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50"
                    >
                      + Add Rx
                    </button>
                  </div>
                )}
                {prescribedMeds.length > 0 && (
                  <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
                    {prescribedMeds.map((m) => (
                      <div key={m.id} className="px-3 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <div>
                          <strong>{m.medicineName}</strong> · {m.dosageRoute} · Qty {m.quantity}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{formatNpr(m.totalPriceNpr)}</span>
                          {canClinical && (
                            <button
                              type="button"
                              onClick={() => setPrescribedMeds((p) => p.filter((x) => x.id !== m.id))}
                              className="text-rose-600 hover:underline"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Order Investigations */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                    <FlaskConical className="w-3.5 h-3.5 text-blue-600" />
                    Investigations (Lab &amp; Radiology) ({investigations.length})
                  </div>
                  <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoCreateOrder}
                      onChange={(e) => setAutoCreateOrder(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    Auto-create Diagnostic Lab Order on Save
                  </label>
                </div>
                {canClinical && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={addSrvId}
                      onChange={(e) => setAddSrvId(e.target.value)}
                      className="flex-1 min-w-[220px] px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      {db.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          [{s.serviceCategory === 'RADIOLOGY' ? 'RAD' : 'LAB'}] {s.code} — {s.name} ({formatNpr(s.price)})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddInvestigation}
                      className="px-3 py-1.5 font-medium text-blue-800 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                    >
                      + Add Test / Study
                    </button>
                  </div>
                )}
                {investigations.length > 0 && (
                  <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg">
                    {investigations.map((inv) => (
                      <div key={inv.id} className="px-3 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <div>
                          <strong className="font-mono">{inv.serviceCode}</strong> {inv.serviceName}{' '}
                          {inv.linkedAccessionNumber && (
                            <span className="font-mono text-blue-700">· Acc {inv.linkedAccessionNumber}</span>
                          )}
                          {inv.summaryFinding && <span className="text-slate-600"> · {inv.summaryFinding}</span>}
                        </div>
                        <span className="font-mono">{formatNpr(inv.priceNpr)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Outcome & External Hospital Referral */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">OPD Clinical Outcome / Disposition</label>
                  <select
                    value={disposition}
                    onChange={(e) => setDisposition(e.target.value as OpdDispositionType)}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg font-medium"
                  >
                    <option value="Waiting">Waiting</option>
                    <option value="In Consultation">In Consultation</option>
                    <option value="Discharged Home">Discharged Home (Prescription Given)</option>
                    <option value="Referred to External Hospital">Referred to External Hospital</option>
                    {selectedVisit.disposition === 'Admitted to IPD' && (
                      <option value="Admitted to IPD">Admitted to IPD</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Follow-Up Advice</label>
                  <input
                    value={advice}
                    onChange={(e) => setAdvice(e.target.value)}
                    placeholder="e.g., Follow up with lab reports after 3 days"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {disposition === 'Referred to External Hospital' && (
                <div className="border border-rose-300 bg-rose-50/40 rounded-xl p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 font-semibold text-rose-900">
                      <Ambulance className="w-4 h-4 text-rose-600" />
                      External Hospital Referral Destination &amp; Ambulance Dispatch
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Select Saved Referred Hospital</label>
                      <select
                        value={refHospitalId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setRefHospitalId(id);
                          const h = (db.referredHospitalsMaster || []).find((x) => x.id === id);
                          if (h) {
                            setRefHospital(h.name);
                            setRefPlace(h.address);
                            setRefManagerName(h.managerName);
                            setRefManagerPhone(h.managerPhone);
                          }
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">-- Enter Custom Hospital or Pick Saved --</option>
                        {(db.referredHospitalsMaster || []).filter((h) => h.active !== false).map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name} — {h.address} (Mgr: {h.managerName} · {h.managerPhone})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Select Saved Ambulance</label>
                      <select
                        value={refAmbulanceId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setRefAmbulanceId(id);
                          const a = (db.ambulancesMaster || []).find((x) => x.id === id);
                          if (a) {
                            setRefAmbulanceName(a.name);
                            setRefAmbulanceNumber(a.vehicleNumber);
                          }
                        }}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="">-- Custom / Other Ambulance --</option>
                        {(db.ambulancesMaster || []).filter((a) => a.active !== false).map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.vehicleNumber}) — {a.driverName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Referred Hospital / Center *</label>
                      <input
                        required
                        value={refHospital}
                        onChange={(e) => setRefHospital(e.target.value)}
                        placeholder="e.g., TUTH Teaching Hospital / BPKIHS"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Place / City / Address *</label>
                      <input
                        required
                        value={refPlace}
                        onChange={(e) => setRefPlace(e.target.value)}
                        placeholder="e.g., Dharan / Biratnagar / Kathmandu"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Hospital Manager Name</label>
                      <input
                        value={refManagerName}
                        onChange={(e) => setRefManagerName(sanitizePersonName(e.target.value))}
                        placeholder="Manager contact person"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Manager WhatsApp / Call Phone</label>
                      <input
                        value={refManagerPhone}
                        onChange={(e) => setRefManagerPhone(e.target.value)}
                        placeholder="98XXXXXXXX"
                        className="w-full px-3 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Referred Department</label>
                      <input
                        value={refDept}
                        onChange={(e) => setRefDept(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Transport Mode &amp; Case Category</label>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={refTransport}
                          onChange={(e) =>
                            setRefTransport(e.target.value as ExternalReferralDetail['transportMode'])
                          }
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="ALS Ambulance">ALS Ambulance</option>
                          <option value="BLS Ambulance">BLS Ambulance</option>
                          <option value="Hospital Vehicle">Hospital Vehicle</option>
                          <option value="Private Vehicle">Private Vehicle</option>
                        </select>
                        <select
                          value={refCaseType}
                          onChange={(e) => setRefCaseType(e.target.value)}
                          className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="GENERAL">Standard Case</option>
                          {(db.settings?.moduleSettings?.referralCaseRules || []).map((cr) => (
                            <option key={cr.caseType} value={cr.caseType}>
                              {cr.caseType} ({cr.mode === 'PERCENT' ? `${cr.value}%` : `रू ${cr.value}`})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Ambulance Name / Service</label>
                      <input
                        value={refAmbulanceName}
                        onChange={(e) => setRefAmbulanceName(e.target.value)}
                        placeholder="e.g., Saptari ALS-01"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Ambulance Vehicle No.</label>
                      <input
                        value={refAmbulanceNumber}
                        onChange={(e) => setRefAmbulanceNumber(e.target.value)}
                        placeholder="Pradesh 2-03-001 Cha ..."
                        className="w-full px-3 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-medium text-slate-700 mb-1">Reason for Referral</label>
                      <input
                        value={refReason}
                        onChange={(e) => setRefReason(e.target.value)}
                        placeholder="e.g., Requires tertiary surgical / specialist evaluation"
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                </div>
              )}

              {canClinical && (
                <div className="flex justify-end pt-2 border-t border-slate-200">
                  <button
                    type="submit"
                    disabled={savingConsult}
                    className="inline-flex items-center gap-1.5 px-4 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {savingConsult ? 'Saving Consultation...' : 'Save OPD Consultation & Orders'}
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>

      {/* Register OPD Modal */}
      {showRegisterModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowRegisterModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">Register New OPD Consultation</h2>
              </div>
              <button type="button" onClick={() => setShowRegisterModal(false)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRegisterSubmit} className="p-5 space-y-3 text-xs max-h-[85vh] overflow-y-auto">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block font-semibold text-slate-800">
                    Patient Intake / ER Lookup (UHID)
                  </label>
                  <input
                    value={regPatientSearch}
                    onChange={(e) => setRegPatientSearch(e.target.value)}
                    placeholder="Filter UHID / Name / Mobile..."
                    className="px-2.5 py-1 bg-white border border-slate-300 rounded text-[11px] w-44"
                  />
                </div>
                <select
                  value={regPatientId}
                  onChange={(e) => handleSelectReturningPatient(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- New OPD Patient Registration --</option>
                  {searchablePatients.map((pt) => (
                    <option key={`${pt.sourceBadge}-${pt.id}`} value={pt.id}>
                      {pt.uhid} — {pt.fullName} ({pt.phone}) [{pt.sourceBadge}]
                      {pt.lastOpdVisitAt ? ` · Last OPD ${adToBs(pt.lastOpdVisitAt).formattedEn}` : ''}
                    </option>
                  ))}
                </select>
                {regFollowUpNotice && (
                  <div
                    className={`px-3 py-2 rounded-lg border font-medium text-[11px] ${
                      regFollowUpNotice.status === 'FREE' || regFollowUpNotice.status === 'PAID_WINDOW'
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                        : regFollowUpNotice.status === 'NEW_PATIENT'
                        ? 'bg-blue-50 border-blue-200 text-blue-900'
                        : 'bg-amber-50 border-amber-300 text-amber-900'
                    }`}
                  >
                    {regFollowUpNotice.status === 'FREE' && (
                      <span>
                        Follow-Up Auto-Recognized (Same Doctor: <strong>{regFollowUpNotice.matchedDoctor || resolvedFormDoctor}</strong> · {regFollowUpNotice.daysSince}d ago ≤ {freeFollowUpDays}d rule) — <strong>रू 0 Free Follow-Up</strong>
                      </span>
                    )}
                    {regFollowUpNotice.status === 'PAID_WINDOW' && (
                      <span>
                        Follow-Up Recognized (Same Doctor: <strong>{regFollowUpNotice.matchedDoctor || resolvedFormDoctor}</strong> · {regFollowUpNotice.daysSince}d ago ≤ {freeFollowUpDays}d rule) — Follow-Up Rule Fee: <strong>{formatNpr(withinWindowFollowUpFee)}</strong>
                      </span>
                    )}
                    {regFollowUpNotice.status === 'DIFFERENT_DOCTOR' && (
                      <span>
                        Previous OPD was with <strong>{regFollowUpNotice.matchedDoctor}</strong> ({regFollowUpNotice.daysSince}d ago) — Consulting a <strong>different doctor</strong> requires <strong>OPD Payment</strong>.
                      </span>
                    )}
                    {regFollowUpNotice.status === 'EXPIRED' && (
                      <span>
                        Follow-up window expired ({regFollowUpNotice.daysSince}d &gt; {freeFollowUpDays}d limit) — <strong>OPD Payment Required ({formatNpr(afterExpiryFollowUpFee)})</strong>.
                      </span>
                    )}
                    {regFollowUpNotice.status === 'NEW_PATIENT' && (
                      <span>
                        <strong>New OPD Visit</strong> — Consultation Fee Payment panel opened below.
                      </span>
                    )}
                  </div>
                )}
              </div>

              {regHideDemographics && regName && (
                <div className="px-3.5 py-2.5 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-blue-700 text-white font-mono text-[10px] font-bold">
                      OPD
                    </span>
                    <span className="font-mono font-bold text-blue-900">{regUhid || 'NEW'}</span>
                    <span className="font-semibold text-slate-900">{regName}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setRegHideDemographics(false)}
                    className="px-2.5 py-1 text-[11px] font-medium bg-white border border-blue-300 text-blue-800 rounded hover:bg-blue-100"
                  >
                    Edit Details
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {!regHideDemographics && (
                  <>
                    {opdFieldRule('patientName') !== 'HIDDEN' && (
                      <div className="sm:col-span-2">
                        <label className="block font-medium text-slate-700 mb-1">
                          Patient Full Name {opdFieldRule('patientName') === 'REQUIRED' ? '*' : ''}
                        </label>
                        <input
                          required={opdFieldRule('patientName') === 'REQUIRED'}
                          value={regName}
                          onChange={(e) => setRegName(sanitizePersonName(e.target.value))}
                          placeholder="e.g., Dipendra Bikram Shah"
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        />
                      </div>
                    )}
                    {opdFieldRule('patientAge') !== 'HIDDEN' && (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block font-medium text-slate-700 mb-1">
                            Age {opdFieldRule('patientAge') === 'REQUIRED' ? '*' : ''}
                          </label>
                          <input
                            type="number"
                            min={0}
                            required={opdFieldRule('patientAge') === 'REQUIRED'}
                            value={regAge}
                            onChange={(e) => setRegAge(e.target.value)}
                            className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                          />
                        </div>
                        <div className="w-24">
                          <label className="block font-medium text-slate-700 mb-1">Unit</label>
                          <select
                            value={regAgeType}
                            onChange={(e) => setRegAgeType(e.target.value as AgeType)}
                            className="w-full px-2 py-2 bg-white border border-slate-300 rounded-lg"
                          >
                            <option value="Years">Years</option>
                            <option value="Months">Months</option>
                            <option value="Days">Days</option>
                          </select>
                        </div>
                      </div>
                    )}
                    {opdFieldRule('patientGender') !== 'HIDDEN' && (
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">
                          Gender {opdFieldRule('patientGender') === 'REQUIRED' ? '*' : ''}
                        </label>
                        <select
                          value={regGender}
                          onChange={(e) => setRegGender(e.target.value as PatientGender)}
                          className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="Male">Male</option>
                          <option value="Female">Female</option>
                          <option value="Other">Other</option>
                        </select>
                      </div>
                    )}
                    {opdFieldRule('patientPhone') !== 'HIDDEN' && (
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">
                          Phone Number {opdFieldRule('patientPhone') === 'REQUIRED' ? '*' : ''}
                        </label>
                        <div className="flex">
                          <span className="inline-flex items-center px-2.5 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg font-mono text-slate-600">
                            +977
                          </span>
                          <input
                            required={opdFieldRule('patientPhone') === 'REQUIRED'}
                            value={regPhone}
                            onChange={(e) => setRegPhone(e.target.value)}
                            placeholder="98XXXXXXXX"
                            className="w-full px-3 py-2 font-mono border border-slate-300 rounded-r-lg"
                          />
                        </div>
                      </div>
                    )}
                    {opdFieldRule('patientAddress') !== 'HIDDEN' && (
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">
                          Address {opdFieldRule('patientAddress') === 'REQUIRED' ? '*' : ''}
                        </label>
                        <input
                          required={opdFieldRule('patientAddress') === 'REQUIRED'}
                          value={regAddress}
                          onChange={(e) => setRegAddress(e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                        />
                      </div>
                    )}
                  </>
                )}
                {opdFieldRule('department') !== 'HIDDEN' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      OPD Department {opdFieldRule('department') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <select
                      value={regDept}
                      onChange={(e) => setRegDept(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                    >
                      <option>General Medicine OPD</option>
                      <option>Emergency &amp; Critical Care</option>
                      <option>Cardiology OPD</option>
                      <option>Pediatrics OPD</option>
                      <option>Obstetrics &amp; Gynecology</option>
                      <option>Orthopedics OPD</option>
                    </select>
                  </div>
                )}
                {opdFieldRule('consultingDoctor') !== 'HIDDEN' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Consulting Doctor {opdFieldRule('consultingDoctor') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <select
                      value={regDoctor}
                      onChange={(e) => setRegDoctor(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                    >
                      {doctorOptions.map((doc) => (
                        <option key={doc} value={doc}>
                          {doc}
                        </option>
                      ))}
                      <option value="__CUSTOM__">+ Enter Custom Doctor Name</option>
                    </select>
                    {regDoctor === '__CUSTOM__' && (
                      <input
                        required
                        value={regDoctorCustom}
                        onChange={(e) => setRegDoctorCustom(sanitizePersonName(e.target.value))}
                        placeholder="Enter doctor full name..."
                        className="mt-1.5 w-full px-3 py-2 border border-slate-300 rounded-lg"
                      />
                    )}
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 w-full cursor-pointer">
                    <input
                      type="checkbox"
                      checked={regIsFreeFollowUp}
                      onChange={(e) => {
                        setRegIsFreeFollowUp(e.target.checked);
                        if (e.target.checked) setRegFee('0');
                        else {
                          const found = activeConsultTypes.find((t) => t.id === regConsultTypeId);
                          setRegFee(String(found?.feeNpr ?? defaultFee));
                        }
                      }}
                      className="rounded border-emerald-400 text-emerald-600"
                    />
                    <span>
                      Free Follow-Up Visit ({sameDoctorFollowUpOnly ? 'Same Doctor · ' : ''}Within {freeFollowUpDays} days) — रू 0 Ticket
                    </span>
                  </label>
                </div>

                {/* Automatic OPD Payment Section (Highlighted whenever New Visit or Fee > 0) */}
                <div
                  className={`sm:col-span-2 rounded-xl border p-3.5 space-y-3 ${
                    !regIsFreeFollowUp && (Number(regFee) || 0) > 0
                      ? 'bg-blue-50/70 border-blue-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-900 text-xs">
                      {!regIsFreeFollowUp && (Number(regFee) || 0) > 0
                        ? 'OPD Payment Collection (Required for New / Paid Visit)'
                        : 'Consultation Fee Summary (Follow-Up)'}
                    </span>
                    <span className="font-mono font-bold text-sm text-blue-800">
                      Payable: {regIsFreeFollowUp ? 'रू 0' : formatNpr(Number(regFee) || 0)}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Consultation Type</label>
                      <select
                        value={regConsultTypeId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setRegConsultTypeId(id);
                          const found = activeConsultTypes.find((t) => t.id === id);
                          if (found && !regIsFreeFollowUp) setRegFee(String(found.feeNpr));
                        }}
                        className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg font-medium"
                      >
                        {activeConsultTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({formatNpr(t.feeNpr)})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">OPD Ticket Fee (NPR)</label>
                      <input
                        type="number"
                        min={0}
                        disabled={regIsFreeFollowUp}
                        value={regIsFreeFollowUp ? '0' : regFee}
                        onChange={(e) => setRegFee(e.target.value)}
                        className="w-full px-2.5 py-2 font-mono font-bold bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Payment Mode</label>
                      <select
                        value={regPayMode}
                        onChange={(e) => setRegPayMode(e.target.value as PaymentMode)}
                        className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank / QR">Bank / QR</option>
                      </select>
                    </div>
                  </div>
                  {!regIsFreeFollowUp && (Number(regFee) || 0) > 0 && regPayMode === 'Cash' && (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-blue-200/70 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-700 font-medium">Cash Received (रू):</span>
                        <input
                          type="number"
                          min={0}
                          value={regTenderedNpr}
                          onChange={(e) => setRegTenderedNpr(e.target.value)}
                          placeholder={regFee}
                          className="w-24 px-2 py-1 font-mono bg-white border border-slate-300 rounded"
                        />
                      </div>
                      <div className="font-mono font-semibold text-emerald-800">
                        Change Return:{' '}
                        {formatNpr(Math.max(0, (Number(regTenderedNpr) || 0) - (Number(regFee) || 0)))}
                      </div>
                    </div>
                  )}
                </div>
                {opdFieldRule('chiefComplaint') !== 'HIDDEN' && (
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Presenting Complaint {opdFieldRule('chiefComplaint') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <input
                      required={opdFieldRule('chiefComplaint') === 'REQUIRED'}
                      value={regComplaint}
                      onChange={(e) => setRegComplaint(e.target.value)}
                      placeholder="e.g., Fever x 3 days, headache"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
                <div className="sm:col-span-2">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 w-full cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoPrintSlipOnRegister}
                      onChange={(e) => setAutoPrintSlipOnRegister(e.target.checked)}
                      className="rounded border-blue-400 text-blue-600"
                    />
                    <span>
                      Print OPD Prescription &amp; Sticker immediately on token issue (
                      {opdAutoPrintConfigured ? 'Direct Print Enabled' : 'Print Preview Mode'})
                    </span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-3.5 py-2 text-slate-600 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registering}
                  className="px-4 py-2 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {registering ? 'Registering...' : 'Issue OPD Token'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {printStickerVisit && (
        <OpdPrescriptionStickerModal
          visit={printStickerVisit}
          settings={db.settings}
          autoPrint={stickerAutoPrint || opdAutoPrintConfigured}
          onClose={() => {
            setPrintStickerVisit(null);
            setStickerAutoPrint(false);
          }}
        />
      )}

      {thermalStickerVisit && (
        <ThermalStickerPrintModal
          uhid={thermalStickerVisit.uhid || thermalStickerVisit.tokenNumber}
          patientName={thermalStickerVisit.patientName}
          ageGender={`${thermalStickerVisit.patientAge}${thermalStickerVisit.patientAgeType.charAt(0)}/${thermalStickerVisit.patientGender.charAt(0)}`}
          encounterLabel={`OPD · ${thermalStickerVisit.tokenNumber}`}
          doctorOrUnit={thermalStickerVisit.consultingDoctor}
          dateIso={thermalStickerVisit.visitDate}
          settings={db.settings}
          onClose={() => setThermalStickerVisit(null)}
        />
      )}

      {printVisit && (
        <ClinicalDepositionPrintModal
          mode="OPD"
          opdVisit={printVisit}
          settings={db.settings}
          documentDesigns={db.documentDesigns}
          centers={db.centers}
          autoPrint={opdAutoPrintConfigured}
          onClose={() => setPrintVisit(null)}
        />
      )}

      {/* INLINE OPD CONSULTATION TYPES & FEE SETTINGS MODAL */}
      {showOpdFeeModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowOpdFeeModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-xl overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  OPD Consultation Types, Fees &amp; Free Follow-Up Rule
                </h2>
              </div>
              <button type="button" onClick={() => setShowOpdFeeModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveOpdTypes} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-emerald-950">Follow-Up Window (Days)</div>
                    <div className="text-[11px] text-emerald-800">
                      e.g., 5 days from prior visit with same doctor.
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    value={draftFreeDays}
                    onChange={(e) => setDraftFreeDays(e.target.value)}
                    className="w-20 px-2.5 py-1.5 font-mono font-bold bg-white border border-emerald-300 rounded-lg text-center"
                  />
                </div>
                <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-blue-950">Within-Window Follow-Up Fee (रू)</div>
                    <div className="text-[11px] text-blue-800">
                      Set 0 for free follow-up, or partial fee within window.
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={draftWithinWindowFee}
                    onChange={(e) => setDraftWithinWindowFee(e.target.value)}
                    className="w-24 px-2.5 py-1.5 font-mono font-bold bg-white border border-blue-300 rounded-lg text-center"
                  />
                </div>
                <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-amber-950">After-Expiry Follow-Up Fee (रू)</div>
                    <div className="text-[11px] text-amber-800">
                      Auto-charged when returning past window.
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={draftAfterExpiryFee}
                    onChange={(e) => setDraftAfterExpiryFee(e.target.value)}
                    className="w-24 px-2.5 py-1.5 font-mono font-bold bg-white border border-amber-300 rounded-lg text-center"
                  />
                </div>
                <label className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftSameDocOnly}
                    onChange={(e) => setDraftSameDocOnly(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <div>
                    <div className="font-semibold text-slate-900">Require Same Consulting Doctor</div>
                    <div className="text-[11px] text-slate-600">
                      If checked, seeing a different doctor charges standard OPD fee.
                    </div>
                  </div>
                </label>
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {draftTypes.map((t, idx) => (
                  <div
                    key={t.id}
                    className="grid grid-cols-12 gap-2 items-center p-2 border border-slate-200 rounded-lg bg-slate-50/60"
                  >
                    <input
                      value={t.name}
                      onChange={(e) =>
                        setDraftTypes((prev) =>
                          prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x))
                        )
                      }
                      placeholder="Consultation Type Name"
                      className="col-span-6 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                    <input
                      type="number"
                      min={0}
                      value={t.feeNpr}
                      onChange={(e) =>
                        setDraftTypes((prev) =>
                          prev.map((x, i) =>
                            i === idx ? { ...x, feeNpr: Number(e.target.value) || 0 } : x
                          )
                        )
                      }
                      className="col-span-3 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                    <label className="col-span-2 inline-flex items-center gap-1 cursor-pointer text-[11px] text-slate-700">
                      <input
                        type="checkbox"
                        checked={t.active}
                        onChange={(e) =>
                          setDraftTypes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, active: e.target.checked } : x))
                          )
                        }
                        className="rounded border-slate-300 text-blue-600"
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      disabled={draftTypes.length <= 1}
                      onClick={() =>
                        setDraftTypes((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 p-1 text-slate-400 hover:text-rose-700 disabled:opacity-30"
                      title="Remove"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() =>
                    setDraftTypes((prev) => [
                      ...prev,
                      {
                        id: `opd-type-${Date.now()}`,
                        name: 'Special Consultant OPD',
                        feeNpr: 700,
                        active: true,
                      },
                    ])
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Consultation Type
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowOpdFeeModal(false)}
                    className="px-3.5 py-2 border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingTypes}
                    className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingTypes ? 'Saving...' : 'Save OPD Tariffs'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
