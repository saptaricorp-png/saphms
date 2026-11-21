import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Ambulance,
  BedDouble,
  CheckCircle2,
  Edit3,
  FileSignature,
  MessageCircle,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldAlert,
  Siren,
  Tag,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  AgeType,
  EmergencyCase,
  ExternalReferralDetail,
  HospitalConsentRecord,
  LimsDatabase,
  PatientGender,
  PatientRecord,
  PaymentMode,
  PermissionKey,
  PoliceStationConfig,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import {
  normalizeNepalPhone,
  sanitizePersonName,
  stripCountryPrefixForEdit,
} from '../utils/textFormat';
import {
  ConsentPrintModal,
  ErChargeStickerModal,
  ErReferralPrintModal,
  MlcPolicePrintModal,
  ThermalStickerPrintModal,
} from '../components/HospitalPrintModals';
import { getRegistrationFieldRule } from '../utils/registrationFields';

interface EmergencyMlcViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  initialSearchQuery?: string;
  preselectedPatient?: PatientRecord | null;
  onClearPreselectedPatient?: () => void;
}

function detectLocalPoliceStation(
  place: string,
  address: string,
  configured?: PoliceStationConfig[]
): {
  stationName: string;
  stationAddress: string;
  stationPhone: string;
} {
  const hay = `${place} ${address}`.toLowerCase();
  if (Array.isArray(configured) && configured.length > 0) {
    const matched = configured.find((ps) => {
      const keys = (ps.keywords || []).map((k) => k.toLowerCase());
      return keys.some((k) => k && hay.includes(k)) || hay.includes(ps.stationName.toLowerCase());
    });
    if (matched) {
      return {
        stationName: matched.stationName,
        stationAddress: matched.address,
        stationPhone: matched.phone,
      };
    }
  }
  if (hay.includes('kalyanpur') || hay.includes('khoksar')) {
    return {
      stationName: 'Area Police Office, Kalyanpur',
      stationAddress: 'Kalyanpur, Khadak Municipality, Saptari',
      stationPhone: '031-560110',
    };
  }
  if (hay.includes('kadarbona') || hay.includes('surunga') || hay.includes('kushaha')) {
    return {
      stationName: 'Area Police Office, Kadarbona',
      stationAddress: 'Kadarbona, Surunga Municipality, Saptari',
      stationPhone: '031-561100',
    };
  }
  if (hay.includes('pato') || hay.includes('dakneshwori') || hay.includes('banainiya')) {
    return {
      stationName: 'Area Police Office, Pato',
      stationAddress: 'Pato, Dakneshwori Municipality, Saptari',
      stationPhone: '031-560220',
    };
  }
  if (hay.includes('rajbiraj') || hay.includes('gajendra')) {
    return {
      stationName: 'District Police Office, Saptari',
      stationAddress: 'Rajbiraj-04, Saptari, Nepal',
      stationPhone: '031-520199',
    };
  }
  const fallbackFirst = Array.isArray(configured) && configured[0];
  if (fallbackFirst) {
    return {
      stationName: fallbackFirst.stationName,
      stationAddress: fallbackFirst.address,
      stationPhone: fallbackFirst.phone,
    };
  }
  return {
    stationName: 'Area Police Office, Bode Barsain',
    stationAddress: 'Bode Barsain Municipality-05, Saptari, Nepal',
    stationPhone: '031-562100',
  };
}

export function EmergencyMlcView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
  preselectedPatient,
  onClearPreselectedPatient,
}: EmergencyMlcViewProps) {
  const canManage = hasPerm('emergency.manage');
  const erCases = db.emergencyCases || [];
  const availableBeds = useMemo(
    () => (db.hospitalBeds || []).filter((b) => b.status === 'Available'),
    [db.hospitalBeds]
  );
  const erAvailableBeds = useMemo(() => {
    const erOnly = availableBeds.filter(
      (b) =>
        b.wardType === 'Emergency / Obs' ||
        /\ber\b|emerg/i.test(b.wardName) ||
        /^er[-_ ]/i.test(b.bedCode)
    );
    return erOnly.length > 0 ? erOnly : availableBeds;
  }, [availableBeds]);
  const ipdAvailableBeds = useMemo(
    () =>
      availableBeds.filter(
        (b) => b.wardType !== 'Emergency / Obs' && !/^er[-_ ]/i.test(b.bedCode)
      ),
    [availableBeds]
  );

  const doctorOptions = useMemo(() => {
    const staffDocs = (db.staff || [])
      .filter(
        (s) =>
          s.status === 'Active' &&
          (s.roleId === 'DOCTOR' ||
            s.roleId === 'LAB_DIRECTOR' ||
            s.roleId === 'RADIOLOGIST' ||
            /^dr\.?\s/i.test(s.fullName) ||
            /doctor|physician|medical officer/i.test(s.designation || ''))
      )
      .map((s) => s.fullName);
    const defaults = ['Dr. Santosh Majhi, MD', 'Dr. Elena Adhikari, MD', 'Dr. Rajesh Yadav, MBBS'];
    return Array.from(new Set([...staffDocs, ...defaults]));
  }, [db.staff]);

  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [filterMode, setFilterMode] = useState<'ALL' | 'MLC' | 'PENDING_POLICE' | 'ACTIVE'>('ALL');

  // Register ER / MLC Modal
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedUhid, setSelectedUhid] = useState('');
  const [collapsePatientDetails, setCollapsePatientDetails] = useState(false);
  const [patientLookupQuery, setPatientLookupQuery] = useState('');
  const [isUnknownPatient, setIsUnknownPatient] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('30');
  const [patientAgeType, setPatientAgeType] = useState<AgeType>('Years');
  const [patientGender, setPatientGender] = useState<PatientGender>('Male');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientAddress, setPatientAddress] = useState('');
  const [broughtByName, setBroughtByName] = useState('');
  const [broughtByRelation, setBroughtByRelation] = useState('Family / Attendant');
  const [broughtByPhone, setBroughtByPhone] = useState('');
  const [triageLevel, setTriageLevel] = useState<EmergencyCase['triageLevel']>('Yellow (Urgent)');
  const [arrivalMode, setArrivalMode] = useState<EmergencyCase['arrivalMode']>('Ambulance');
  const [selectedBedId, setSelectedBedId] = useState<string>('');
  const [erBedBay, setErBedBay] = useState('ER-BAY-01');
  const [attendingDoctor, setAttendingDoctor] = useState(doctorOptions[0] || 'Dr. Santosh Majhi, MD');
  const [customDoctorMode, setCustomDoctorMode] = useState(false);
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [vitalBp, setVitalBp] = useState('120/80');
  const [vitalPulse, setVitalPulse] = useState('88');
  const [vitalTemp, setVitalTemp] = useState('98.6');
  const [vitalSpo2, setVitalSpo2] = useState('97');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [isMlc, setIsMlc] = useState(false);
  const [mlcCaseType, setMlcCaseType] = useState<NonNullable<EmergencyCase['mlcCaseType']>>('RTA (Road Traffic Accident)');
  const [incidentPlace, setIncidentPlace] = useState('');
  const [customIncidentPlace, setCustomIncidentPlace] = useState(false);
  const [incidentTimeText, setIncidentTimeText] = useState('Approx. 30 mins prior to arrival');
  const [identificationMarks, setIdentificationMarks] = useState('');
  const [injurySummary, setInjurySummary] = useState('');
  const [policeStationName, setPoliceStationName] = useState('Area Police Office, Bode Barsain');
  const [policeStationAddress, setPoliceStationAddress] = useState('Bode Barsain Municipality-05, Saptari, Nepal');
  const [policeStationPhone, setPoliceStationPhone] = useState('031-562100');
  const defaultErRegFee = db.settings?.moduleSettings?.emergencyRegistrationFeeNpr ?? 500;
  const defaultErTicketFee = db.settings?.moduleSettings?.emergencyTicketFeeNpr ?? 250;
  const [erChargesNpr, setErChargesNpr] = useState(String(defaultErRegFee));
  const [erTicketFeeNpr, setErTicketFeeNpr] = useState(String(defaultErTicketFee));
  const [showErCharges, setShowErCharges] = useState(
    Boolean(db.settings?.moduleSettings?.showErFeeFieldsInForm)
  );
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [autoPrintErSlipOnRegister, setAutoPrintErSlipOnRegister] = useState(
    db.settings?.moduleSettings?.printOptions?.autoPrintByTemplate?.emergencySlip !== 'MANUAL_PROMPT'
  );
  const [submittingEr, setSubmittingEr] = useState(false);

  // Edit / Identify Patient Modal on active/unknown ER Case
  const [editingErCase, setEditingErCase] = useState<EmergencyCase | null>(null);
  const [editName, setEditName] = useState('');
  const [editAge, setEditAge] = useState('');
  const [editAgeType, setEditAgeType] = useState<AgeType>('Years');
  const [editGender, setEditGender] = useState<PatientGender>('Male');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [savingEditEr, setSavingEditEr] = useState(false);

  // Inline ER Fee Settings Modal
  const [showErFeeModal, setShowErFeeModal] = useState(false);
  const [draftErFee, setDraftErFee] = useState(String(defaultErRegFee));
  const [draftErTicketFee, setDraftErTicketFee] = useState(String(defaultErTicketFee));
  const [savingErFee, setSavingErFee] = useState(false);

  useEffect(() => {
    setErChargesNpr(String(defaultErRegFee));
    setDraftErFee(String(defaultErRegFee));
  }, [defaultErRegFee]);

  useEffect(() => {
    setErTicketFeeNpr(String(defaultErTicketFee));
    setDraftErTicketFee(String(defaultErTicketFee));
  }, [defaultErTicketFee]);

  useEffect(() => {
    setAutoPrintErSlipOnRegister(
      db.settings?.moduleSettings?.printOptions?.autoPrintByTemplate?.emergencySlip !== 'MANUAL_PROMPT'
    );
  }, [db.settings?.moduleSettings?.printOptions?.autoPrintByTemplate?.emergencySlip]);

  // Side Informed Police Modal
  const [informCase, setInformCase] = useState<EmergencyCase | null>(null);
  const [infStationName, setInfStationName] = useState('');
  const [infStationAddress, setInfStationAddress] = useState('');
  const [infStationPhone, setInfStationPhone] = useState('');
  const [infNumber, setInfNumber] = useState('');
  const [infOfficer, setInfOfficer] = useState('');
  const [infMode, setInfMode] = useState<NonNullable<EmergencyCase['policeInformMode']>>('Telephone Call');
  const [alsoLogChalani, setAlsoLogChalani] = useState(true);
  const [savingInform, setSavingInform] = useState(false);

  // Print MLC Police Form, ER Bill Slip & Standalone Thermal Sticker
  const [printMlcCase, setPrintMlcCase] = useState<EmergencyCase | null>(null);
  const [printErStickerCase, setPrintErStickerCase] = useState<EmergencyCase | null>(null);
  const [printThermalStickerCase, setPrintThermalStickerCase] = useState<EmergencyCase | null>(null);

  // Consent Drawer/Modal for ER Case
  const [consentCaseId, setConsentCaseId] = useState<string | null>(null);
  const [signGuardianName, setSignGuardianName] = useState('');
  const [signRelationship, setSignRelationship] = useState('Self / Attendant');
  const [signWitnessName, setSignWitnessName] = useState(activeUser.fullName);
  const [signingConsentId, setSigningConsentId] = useState<string | null>(null);
  const [newConsentType, setNewConsentType] = useState<HospitalConsentRecord['consentType']>('LAMA_DOR_RISK');
  const [newConsentSummary, setNewConsentSummary] = useState('');
  const [printConsent, setPrintConsent] = useState<{
    consent: HospitalConsentRecord;
    erCase: EmergencyCase;
  } | null>(null);

  // Admit ER -> IPD Bed Modal
  const [admitErCase, setAdmitErCase] = useState<EmergencyCase | null>(null);
  const [targetBedId, setTargetBedId] = useState('');
  const [initialDeposit, setInitialDeposit] = useState('5000');
  const [admitPayMode, setAdmitPayMode] = useState<PaymentMode>('Cash');
  const [admittingIpd, setAdmittingIpd] = useState(false);

  // Refer Out / External Transfer Modal
  const [referOutCase, setReferOutCase] = useState<EmergencyCase | null>(null);
  const [refHospitalId, setRefHospitalId] = useState('');
  const [refHospital, setRefHospital] = useState('');
  const [refPlace, setRefPlace] = useState('');
  const [refManagerName, setRefManagerName] = useState('');
  const [refManagerPhone, setRefManagerPhone] = useState('');
  const [refDept, setRefDept] = useState('Emergency / Trauma / Tertiary ICU');
  const [refCaseType, setRefCaseType] = useState('GENERAL');
  const [refTransportMode, setRefTransportMode] =
    useState<ExternalReferralDetail['transportMode']>('ALS Ambulance');
  const [refAmbulanceId, setRefAmbulanceId] = useState('');
  const [refAmbulanceName, setRefAmbulanceName] = useState('Hospital ALS Ambulance');
  const [refAmbulanceNumber, setRefAmbulanceNumber] = useState('');
  const [refDepartureTime, setRefDepartureTime] = useState('');
  const [refEscort, setRefEscort] = useState('Duty Medical Officer + Paramedic');
  const [refReason, setRefReason] = useState('');
  const [refCondition, setRefCondition] = useState('');
  const [refCaseDetails, setRefCaseDetails] = useState('');
  const [referringOut, setReferringOut] = useState(false);
  const [printErReferralCase, setPrintErReferralCase] = useState<EmergencyCase | null>(null);

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const applyIntakePatientToEr = (pt: PatientRecord) => {
    setSelectedPatientId(pt.id);
    setSelectedUhid(pt.uhid);
    setPatientName(pt.fullName);
    setPatientAge(String(pt.age || 30));
    setPatientAgeType(pt.ageType || 'Years');
    setPatientGender(pt.gender || 'Male');
    setPatientPhone(stripCountryPrefixForEdit(pt.phone));
    setPatientAddress(pt.address || '');
    setIsUnknownPatient(false);
    setCollapsePatientDetails(true);
    setPatientLookupQuery('');
  };

  useEffect(() => {
    if (!preselectedPatient) return;
    applyIntakePatientToEr(preselectedPatient);
    setShowRegisterModal(true);
    onClearPreselectedPatient?.();
  }, [preselectedPatient, onClearPreselectedPatient]);

  const intakeDirectoryMatches = useMemo(() => {
    const q = patientLookupQuery.trim().toLowerCase();
    const list: Array<{ key: string; uhid: string; name: string; phone: string; badge: string; patient: PatientRecord }> = [];
    const seen = new Set<string>();
    for (const p of db.patients || []) {
      const hasOpd = (db.opdVisits || []).some((v) => v.patientId === p.id || (p.uhid && v.uhid === p.uhid));
      const badge = hasOpd ? 'OPD / INTAKE' : 'PATIENT INTAKE';
      if (!q || `${p.uhid} ${p.fullName} ${p.phone} ${p.address}`.toLowerCase().includes(q)) {
        list.push({ key: p.id, uhid: p.uhid, name: p.fullName, phone: p.phone, badge, patient: p });
        seen.add(p.id);
      }
    }
    return list.slice(0, 8);
  }, [db.patients, db.opdVisits, patientLookupQuery]);

  // Auto-detect police station as user types incidentPlace or patientAddress
  useEffect(() => {
    if (!isMlc) return;
    const detected = detectLocalPoliceStation(
      incidentPlace,
      patientAddress,
      db.settings?.moduleSettings?.policeStations
    );
    setPoliceStationName(detected.stationName);
    setPoliceStationAddress(detected.stationAddress);
    setPoliceStationPhone(detected.stationPhone);
  }, [isMlc, incidentPlace, patientAddress, db.settings?.moduleSettings?.policeStations]);

  const metrics = useMemo(() => {
    const total = erCases.length;
    const activeObs = erCases.filter((c) => c.disposition === 'Under Observation (ER)').length;
    const mlcTotal = erCases.filter((c) => c.isMlc).length;
    const mlcPendingPolice = erCases.filter((c) => c.isMlc && !c.policeInformed).length;
    const mlcInformed = erCases.filter((c) => c.isMlc && c.policeInformed).length;
    return { total, activeObs, mlcTotal, mlcPendingPolice, mlcInformed };
  }, [erCases]);

  const filteredCases = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return erCases.filter((c) => {
      if (filterMode === 'MLC' && !c.isMlc) return false;
      if (filterMode === 'PENDING_POLICE' && (!c.isMlc || c.policeInformed)) return false;
      if (filterMode === 'ACTIVE' && c.disposition !== 'Under Observation (ER)') return false;
      if (!q) return true;
      return `${c.erNumber} ${c.mlcNumber || ''} ${c.patientName} ${c.patientPhone} ${c.patientAddress} ${c.chiefComplaint} ${c.policeStationName || ''} ${c.policeInformedNumber || ''} ${c.mlcCaseType || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [erCases, filterMode, searchTerm]);

  const consentCase = useMemo(
    () => (consentCaseId ? erCases.find((c) => c.id === consentCaseId) || null : null),
    [erCases, consentCaseId]
  );

  const erFieldRule = (key: string) =>
    getRegistrationFieldRule(db.settings?.moduleSettings, 'er', key);

  const handleRegisterEr = async (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedName =
      patientName.trim() ||
      (isUnknownPatient
        ? 'Unknown ER Patient (Unidentified)'
        : erFieldRule('patientName') === 'HIDDEN'
        ? 'Emergency Patient'
        : '');
    const resolvedComplaint =
      chiefComplaint.trim() ||
      (erFieldRule('chiefComplaint') === 'HIDDEN' ? 'Emergency Assessment' : '');
    if (!canManage || !resolvedName || !resolvedComplaint) return;
    setSubmittingEr(true);
    try {
      const resp = await apiRequest<{ erCase: EmergencyCase; db: LimsDatabase }>(
        '/api/emergency/cases',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            patientId: selectedPatientId || undefined,
            uhid: selectedUhid || undefined,
            isUnknownPatient,
            patientName: resolvedName,
            patientAge: Number(patientAge) || 30,
            patientAgeType,
            patientGender,
            patientPhone: normalizeNepalPhone(patientPhone),
            patientAddress: patientAddress.trim() || (isUnknownPatient ? 'Unknown / Roadside' : 'Rajbiraj, Saptari'),
            broughtByName: broughtByName.trim() || 'Self / Family',
            broughtByRelation: broughtByRelation.trim(),
            broughtByPhone: normalizeNepalPhone(broughtByPhone),
            triageLevel,
            arrivalMode,
            selectedBedId: selectedBedId || undefined,
            erBedBay: erBedBay.trim() || 'ER-BAY-01',
            attendingDoctor: attendingDoctor.trim(),
            chiefComplaint: resolvedComplaint,
            vitals: {
              bp: vitalBp.trim() || undefined,
              pulseBpm: Number(vitalPulse) || undefined,
              tempF: Number(vitalTemp) || undefined,
              spo2Pct: Number(vitalSpo2) || undefined,
            },
            clinicalNotes: clinicalNotes.trim(),
            isMlc,
            mlcCaseType: isMlc ? mlcCaseType : undefined,
            incidentPlace: isMlc ? incidentPlace.trim() : undefined,
            incidentTimeText: isMlc ? incidentTimeText.trim() : undefined,
            identificationMarks: isMlc ? identificationMarks.trim() : undefined,
            injurySummary: isMlc ? injurySummary.trim() : undefined,
            policeStationName: isMlc ? policeStationName.trim() : undefined,
            policeStationAddress: isMlc ? policeStationAddress.trim() : undefined,
            policeStationPhone: isMlc ? policeStationPhone.trim() : undefined,
            erTicketFeeNpr: Number(erTicketFeeNpr) || 0,
            erChargesNpr: Number(erChargesNpr) || 0,
            paymentMode,
          }),
        }
      );
      setShowRegisterModal(false);
      setSelectedPatientId('');
      setSelectedUhid('');
      setCollapsePatientDetails(false);
      setIsUnknownPatient(false);
      setPatientName('');
      setPatientPhone('');
      setBroughtByPhone('');
      setPatientAddress('');
      setSelectedBedId('');
      setIncidentPlace('');
      setChiefComplaint('');
      setInjurySummary('');
      setClinicalNotes('');
      if (autoPrintErSlipOnRegister) {
        setPrintErStickerCase(resp.erCase);
      }
      onUpdated(
        resp.db,
        `Registered ER case ${resp.erCase.erNumber}${resp.erCase.isMlc ? ` (MLC ${resp.erCase.mlcNumber} · ${resp.erCase.policeStationName})` : ''} — Total ER Charges रू ${((resp.erCase.erTicketFeeNpr || 0) + (resp.erCase.erChargesNpr || 0)).toLocaleString()}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to register emergency case.');
    } finally {
      setSubmittingEr(false);
    }
  };

  const openEditErIdentityModal = (c: EmergencyCase) => {
    setEditingErCase(c);
    setEditName(c.patientName);
    setEditAge(String(c.patientAge || 30));
    setEditAgeType(c.patientAgeType || 'Years');
    setEditGender(c.patientGender || 'Male');
    setEditPhone(stripCountryPrefixForEdit(c.patientPhone));
    setEditAddress(c.patientAddress || '');
  };

  const handleSaveErIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingErCase || !editName.trim()) return;
    setSavingEditEr(true);
    try {
      const resp = await apiRequest<{ erCase: EmergencyCase; db: LimsDatabase }>(
        `/api/emergency/cases/${editingErCase.id}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify({
            patientName: editName.trim(),
            patientAge: Number(editAge) || 30,
            patientAgeType: editAgeType,
            patientGender: editGender,
            patientPhone: normalizeNepalPhone(editPhone),
            patientAddress: editAddress.trim() || 'Saptari',
            isUnknownPatient: false,
          }),
        }
      );
      setEditingErCase(null);
      onUpdated(resp.db, `Updated patient identity for ER ${resp.erCase.erNumber}: ${resp.erCase.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update ER patient details.');
    } finally {
      setSavingEditEr(false);
    }
  };

  const openInformModal = (c: EmergencyCase) => {
    const fallbackStation = detectLocalPoliceStation(
      c.incidentPlace || '',
      c.patientAddress || '',
      db.settings?.moduleSettings?.policeStations
    );
    setInformCase(c);
    setInfStationName(c.policeStationName || fallbackStation.stationName);
    setInfStationAddress(c.policeStationAddress || fallbackStation.stationAddress);
    setInfStationPhone(c.policeStationPhone || fallbackStation.stationPhone);
    setInfNumber(
      c.policeInformedNumber ||
        `POL-SAP-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Math.floor(100 + Math.random() * 899))}`
    );
    setInfOfficer(c.policeOfficerName || 'ASI Duty Officer');
    setInfMode(c.policeInformMode || 'Telephone Call');
    setAlsoLogChalani(true);
  };

  const handleConfirmPoliceInform = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!informCase) return;
    setSavingInform(true);
    try {
      const resp = await apiRequest<{ erCase: EmergencyCase; db: LimsDatabase }>(
        `/api/emergency/cases/${informCase.id}/inform-police`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            policeStationName: infStationName.trim(),
            policeStationAddress: infStationAddress.trim(),
            policeStationPhone: infStationPhone.trim(),
            policeInformedNumber: infNumber.trim(),
            policeOfficerName: infOfficer.trim(),
            policeInformMode: infMode,
            alsoLogChalani,
          }),
        }
      );
      setInformCase(null);
      onUpdated(
        resp.db,
        `Police Informed recorded for ${resp.erCase.mlcNumber || resp.erCase.erNumber} (${resp.erCase.policeInformedNumber}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to record police notification.');
    } finally {
      setSavingInform(false);
    }
  };

  const handleSignErConsent = async (consentId: string) => {
    if (!consentCase) return;
    setSigningConsentId(consentId);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/consents/er/${consentCase.id}`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'SIGN',
            consentId,
            patientOrGuardianName: signGuardianName.trim() || consentCase.broughtByName || consentCase.patientName,
            relationship: signRelationship.trim() || 'Self / Attendant',
            witnessName: signWitnessName.trim() || activeUser.fullName,
          }),
        }
      );
      onUpdated(resp.db, `Signed & verified consent for ${consentCase.patientName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Consent signature failed.');
    } finally {
      setSigningConsentId(null);
    }
  };

  const handleAddErConsent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consentCase) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/consents/er/${consentCase.id}`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'ADD',
            consentType: newConsentType,
            customSummary: newConsentSummary.trim() || undefined,
          }),
        }
      );
      setNewConsentSummary('');
      onUpdated(resp.db, `Added ${newConsentType} consent to ${consentCase.erNumber}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to add consent.');
    }
  };

  const handleAdmitErToIpd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!admitErCase || !targetBedId) return;
    setAdmittingIpd(true);
    try {
      const resp = await apiRequest<{ admission: { admissionNumber: string }; db: LimsDatabase }>(
        `/api/emergency/cases/${admitErCase.id}/admit-ipd`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            bedId: targetBedId,
            initialDepositNpr: Number(initialDeposit) || 0,
            depositPaymentMode: admitPayMode,
          }),
        }
      );
      setAdmitErCase(null);
      onUpdated(
        resp.db,
        `Admitted ER case ${admitErCase.erNumber} to IPD (${resp.admission.admissionNumber}) with auto-carried consents.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to admit ER case to IPD.');
    } finally {
      setAdmittingIpd(false);
    }
  };

  const openReferOutModal = (c: EmergencyCase) => {
    setReferOutCase(c);
    setRefHospitalId(c.externalReferral?.referredHospitalId || '');
    setRefHospital(c.externalReferral?.referredToHospital || '');
    setRefPlace(c.externalReferral?.referredToPlace || '');
    setRefManagerName(c.externalReferral?.referredHospitalManagerName || '');
    setRefManagerPhone(c.externalReferral?.referredHospitalManagerPhone || '');
    setRefDept(c.externalReferral?.referredDepartment || 'Emergency / Trauma / Tertiary ICU');
    setRefCaseType(c.externalReferral?.referralCaseType || (c.isMlc && c.mlcCaseType?.includes('RTA') ? 'RTA Case' : c.isMlc && c.mlcCaseType?.includes('Poison') ? 'Poison Case' : 'GENERAL'));
    setRefTransportMode(c.externalReferral?.transportMode || 'ALS Ambulance');
    setRefAmbulanceId(c.externalReferral?.ambulanceId || '');
    setRefAmbulanceName(c.externalReferral?.ambulanceName || 'Hospital ALS Ambulance');
    setRefAmbulanceNumber(c.externalReferral?.ambulanceNumber || '');
    setRefDepartureTime(
      c.externalReferral?.departureTime ||
        new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    );
    setRefEscort(c.externalReferral?.escortDoctorOrNurse || 'Duty Medical Officer + Paramedic');
    setRefReason(c.externalReferral?.referralReason || '');
    setRefCondition(c.externalReferral?.conditionAtReferral || `${c.triageLevel} — Stabilized in ER`);
    setRefCaseDetails(
      c.externalReferral?.caseDetails || `${c.chiefComplaint}${c.clinicalNotes ? `. ${c.clinicalNotes}` : ''}`
    );
  };

  const handleReferOutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!referOutCase || !refHospital.trim() || !refPlace.trim()) return;
    setReferringOut(true);
    try {
      const resp = await apiRequest<{ erCase: EmergencyCase; db: LimsDatabase }>(
        `/api/emergency/cases/${referOutCase.id}/refer-out`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            referredHospitalId: refHospitalId || undefined,
            referredToHospital: refHospital.trim(),
            referredToPlace: refPlace.trim(),
            referredHospitalManagerName: refManagerName.trim() || undefined,
            referredHospitalManagerPhone: refManagerPhone.trim() || undefined,
            referredDepartment: refDept.trim(),
            referralCaseType: refCaseType,
            transportMode: refTransportMode,
            ambulanceId: refAmbulanceId || undefined,
            ambulanceName: refAmbulanceName.trim(),
            ambulanceNumber: refAmbulanceNumber.trim(),
            departureTime: refDepartureTime.trim(),
            escortDoctorOrNurse: refEscort.trim(),
            referralReason: refReason.trim() || 'Tertiary center specialist care & intervention required',
            conditionAtReferral: refCondition.trim(),
            caseDetails: refCaseDetails.trim(),
          }),
        }
      );
      setReferOutCase(null);
      onUpdated(
        resp.db,
        `Referred ER ${resp.erCase.erNumber} to ${resp.erCase.externalReferral?.referredToHospital}, ${resp.erCase.externalReferral?.referredToPlace}.`
      );
      setPrintErReferralCase(resp.erCase);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to refer out ER case.');
    } finally {
      setReferringOut(false);
    }
  };

  const handleSaveErFeeSetting = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingErFee(true);
    try {
      const regVal = Math.max(0, Number(draftErFee) || 0);
      const ticketVal = Math.max(0, Number(draftErTicketFee) || 0);
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/settings', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({
          moduleSettings: {
            ...(db.settings?.moduleSettings || {}),
            emergencyRegistrationFeeNpr: regVal,
            emergencyTicketFeeNpr: ticketVal,
          },
        }),
      });
      setErChargesNpr(String(regVal));
      setErTicketFeeNpr(String(ticketVal));
      setShowErFeeModal(false);
      onUpdated(
        resp.db,
        `Updated Emergency Ticket Fee (${formatNpr(ticketVal)}) & ER Reg Fee (${formatNpr(regVal)}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update ER charges.');
    } finally {
      setSavingErFee(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Emergency Triage, Trauma &amp; Medico-Legal (MLC) Register
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            24x7 Emergency Bay · Configurable Saptari Police Station Auto-Fetch, side Informed Police action, ER Bill &amp; Sticker Print, Police Form &amp; Auto-Set Consents
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(canManage || hasPerm('settings.manage')) && (
            <button
              type="button"
              onClick={() => {
                setDraftErFee(String(defaultErRegFee));
                setDraftErTicketFee(String(defaultErTicketFee));
                setShowErFeeModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Settings className="w-3.5 h-3.5 text-slate-500" />
              ER Ticket: <span className="font-mono font-semibold">{formatNpr(defaultErTicketFee)}</span> · Reg:{' '}
              <span className="font-mono font-semibold">{formatNpr(defaultErRegFee)}</span>
            </button>
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setErChargesNpr(String(defaultErRegFee));
                setErTicketFeeNpr(String(defaultErTicketFee));
                setShowRegisterModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Register ER / MLC Patient
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Total ER Visits</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{metrics.total}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Under ER Observation</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">{metrics.activeObs}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Total MLC Cases</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{metrics.mlcTotal}</div>
        </div>
        <div className="bg-white border border-rose-200 rounded-xl p-4">
          <div className="text-xs text-rose-700 font-medium">Pending Police Inform</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-rose-700 mt-1">
            {metrics.mlcPendingPolice}
          </div>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <div className="text-xs text-emerald-700 font-medium">Police Informed</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {metrics.mlcInformed}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: `All Cases (${erCases.length})` },
              { id: 'ACTIVE', label: `Under Observation (${metrics.activeObs})` },
              { id: 'MLC', label: `MLC Cases (${metrics.mlcTotal})` },
              { id: 'PENDING_POLICE', label: `Pending Police Alert (${metrics.mlcPendingPolice})` },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilterMode(f.id)}
              className={`px-3 py-1.5 rounded-lg font-medium border whitespace-nowrap ${
                filterMode === f.id
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search ER #, MLC #, patient, police station, complaint..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
          />
        </div>
      </div>

      {/* ER & MLC Case List with Prominent Side Action Panel */}
      <div className="space-y-3">
        {filteredCases.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
            No Emergency / MLC records match your filter.
          </div>
        ) : (
          filteredCases.map((c) => {
            const regBs = adToBs(c.registeredAt);
            const infBs = c.policeInformedAt ? adToBs(c.policeInformedAt) : null;
            const signedConsents = (c.consents || []).filter((x) => x.status === 'Signed & Verified').length;
            const totalConsents = (c.consents || []).length;
            const triageTextColor = c.triageLevel.startsWith('Red')
              ? 'text-rose-700'
              : c.triageLevel.startsWith('Yellow')
              ? 'text-amber-700'
              : 'text-emerald-700';

            return (
              <div
                key={c.id}
                className={`bg-white border rounded-xl p-4 flex flex-col lg:flex-row lg:items-stretch justify-between gap-4 text-xs ${
                  c.isMlc && !c.policeInformed ? 'border-rose-300' : 'border-slate-200'
                }`}
              >
                {/* Left Clinical & Police Info */}
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-mono font-bold text-blue-700">{c.erNumber}</span>
                    {c.isMlc && (
                      <span className="font-mono font-bold text-rose-700">
                        · MLC: {c.mlcNumber || 'PENDING'} ({c.mlcCaseType})
                      </span>
                    )}
                    <span className={`font-semibold ${triageTextColor}`}>· {c.triageLevel}</span>
                    <span className="font-mono text-slate-500">
                      · {c.erBedBay} · {regBs.formattedEn} {regBs.timeEn}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base font-semibold text-slate-900">{c.patientName}</span>
                    {c.uhid && (
                      <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 rounded">
                        {c.uhid} · EMERGENCY
                      </span>
                    )}
                    {c.isUnknownPatient && (
                      <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 rounded">
                        UNKNOWN IDENTITY — UPDATE LATER
                      </span>
                    )}
                    <span className="text-slate-600">
                      ({c.patientAge} {c.patientAgeType} / {c.patientGender}) · {c.patientAddress} ·{' '}
                      <span className="font-mono">{c.patientPhone || 'No Phone'}</span>
                      {c.erShift ? ` · ${c.erShift} Shift` : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                    <div>
                      <span className="text-slate-500 font-medium">Complaint:</span>{' '}
                      <span className="text-slate-900">{c.chiefComplaint}</span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Vitals:</span>{' '}
                      <span className="font-mono text-slate-800">
                        {c.vitals && (c.vitals.bp || c.vitals.pulseBpm || c.vitals.spo2Pct || c.vitals.tempF)
                          ? `BP ${c.vitals.bp || '—'} · PR ${c.vitals.pulseBpm || '—'} · SpO₂ ${c.vitals.spo2Pct || '—'}% · ${c.vitals.tempF || '—'}°F`
                          : 'Pending'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">Doctor / Disposition:</span>{' '}
                      <span className="text-slate-900">
                        {c.attendingDoctor} · <strong>{c.disposition}</strong>
                        {c.linkedIpdAdmissionId ? ' (Admitted to IPD)' : ''}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-500 font-medium">ER Charge:</span>{' '}
                      <span className="font-mono text-slate-900">
                        {formatNpr(c.erChargesNpr)} ({c.paymentMode})
                      </span>{' '}
                      · Consents:{' '}
                      <strong className="font-mono text-slate-900">
                        {signedConsents}/{totalConsents} Signed
                      </strong>
                    </div>
                  </div>

                  {c.isMlc && (
                    <div
                      className={`p-2.5 rounded-lg border text-[11px] flex flex-wrap items-center justify-between gap-2 ${
                        c.policeInformed
                          ? 'bg-emerald-50/50 border-emerald-200 text-emerald-900'
                          : 'bg-rose-50/60 border-rose-200 text-rose-900'
                      }`}
                    >
                      <div>
                        <strong>Auto Police Station:</strong> {c.policeStationName} (
                        {c.policeStationAddress} · Tel:{' '}
                        <span className="font-mono">{c.policeStationPhone}</span>)
                        {c.incidentPlace ? ` · Incident Place: ${c.incidentPlace}` : ''}
                      </div>
                      {c.policeInformed ? (
                        <div className="font-mono font-semibold text-emerald-800">
                          INFORMED · Ref: {c.policeInformedNumber} · {infBs?.formattedEn} {infBs?.timeEn} ·{' '}
                          {c.policeOfficerName}
                        </div>
                      ) : (
                        <div className="font-semibold text-rose-700">
                          Awaiting Police Notification — Use side Informed Police button
                        </div>
                      )}
                    </div>
                  )}

                  {c.externalReferral && (
                    <div className="p-2.5 rounded-lg border border-amber-300 bg-amber-50/60 text-[11px] text-amber-950 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong>Referred Out:</strong> {c.externalReferral.referredToHospital},{' '}
                        {c.externalReferral.referredToPlace} ·{' '}
                        <strong>Ambulance:</strong>{' '}
                        {c.externalReferral.ambulanceName || c.externalReferral.transportMode}
                        {c.externalReferral.ambulanceNumber
                          ? ` (${c.externalReferral.ambulanceNumber})`
                          : ''}{' '}
                        · <strong>Time:</strong>{' '}
                        <span className="font-mono">{c.externalReferral.departureTime || '—'}</span>
                      </div>
                      <span className="font-mono font-semibold text-amber-900">
                        Attached Items: {c.externalReferral.attachedBilledItems?.length || 0}
                      </span>
                    </div>
                  )}
                </div>

                {/* Right Side Action Panel (Always at side of MLC/ER Card) */}
                <div className="lg:w-64 shrink-0 lg:border-l lg:border-slate-200 lg:pl-4 flex flex-col justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPrintErStickerCase(c)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-slate-800 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100"
                  >
                    <Printer className="w-3.5 h-3.5 text-rose-600" />
                    Print ER Bill Slip
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrintThermalStickerCase(c)}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    <Tag className="w-3.5 h-3.5 text-indigo-600" />
                    Print Thermal Sticker
                  </button>

                  {c.isMlc && (
                    <>
                      {canManage && !c.policeInformed ? (
                        <button
                          type="button"
                          onClick={() => openInformModal(c)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                        >
                          <Siren className="w-3.5 h-3.5" />
                          Informed Police
                        </button>
                      ) : c.policeInformed ? (
                        <button
                          type="button"
                          onClick={() => canManage && openInformModal(c)}
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Police Informed · {c.policeInformedNumber}
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() => setPrintMlcCase(c)}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        <Printer className="w-3.5 h-3.5 text-blue-600" />
                        Print Police MLC Form
                      </button>
                    </>
                  )}

                  {canManage && (
                    <button
                      type="button"
                      onClick={() => openEditErIdentityModal(c)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-amber-900 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      {c.isUnknownPatient ? 'Update Unknown Identity' : 'Edit Patient Details'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setConsentCaseId(c.id);
                      setSignGuardianName(c.broughtByName || c.patientName);
                    }}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100"
                  >
                    <FileSignature className="w-3.5 h-3.5" />
                    Consents ({signedConsents}/{totalConsents})
                  </button>

                  {canManage && c.disposition === 'Under Observation (ER)' && !c.linkedIpdAdmissionId && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdmitErCase(c);
                        setTargetBedId(ipdAvailableBeds[0]?.id || '');
                      }}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                    >
                      <BedDouble className="w-3.5 h-3.5" />
                      Admit to IPD Bed
                    </button>
                  )}

                  {canManage && c.disposition === 'Under Observation (ER)' && (
                    <button
                      type="button"
                      onClick={() => openReferOutModal(c)}
                      className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100"
                    >
                      <Ambulance className="w-3.5 h-3.5" />
                      Refer Out / Ambulance
                    </button>
                  )}

                  {c.externalReferral && (
                    <>
                      <button
                        type="button"
                        onClick={() => setPrintErReferralCase(c)}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-medium text-rose-800 bg-rose-50 border border-rose-300 rounded-lg hover:bg-rose-100"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print Clinical Referral Summary
                      </button>
                      {c.externalReferral.referredHospitalManagerPhone && (
                        <a
                          href={`https://wa.me/${c.externalReferral.referredHospitalManagerPhone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                            `URGENT ER REFERRAL — ${db.settings.labName}\nPatient: ${c.patientName} (${c.uhid || c.erNumber})\nReferred To: ${c.externalReferral.referredToHospital}\nAmbulance: ${c.externalReferral.ambulanceName || c.externalReferral.transportMode} ${c.externalReferral.ambulanceNumber || ''}\nTreatments/Tests: ${(c.externalReferral.attachedBilledItems || []).map((x) => x.description).join(', ') || c.chiefComplaint}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100"
                        >
                          <MessageCircle className="w-3.5 h-3.5" />
                          WhatsApp Manager
                        </a>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* REGISTER ER / MLC MODAL */}
      {showRegisterModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowRegisterModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-rose-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Register Emergency Triage / Medico-Legal Case (MLC)
                </h2>
              </div>
              <button type="button" onClick={() => setShowRegisterModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRegisterEr} className="p-5 space-y-4 text-xs">
              {/* Patient Intake / OPD Quick Search + Unknown Patient Toggle */}
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                    <UserPlus className="w-3.5 h-3.5 text-rose-600" />
                    Select Registered Patient (Intake / OPD) or Quick Unknown Victim
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPatientId('');
                        setSelectedUhid('');
                        setIsUnknownPatient(true);
                        setPatientName('Unknown ER Patient (Unidentified)');
                        setPatientPhone('');
                        setPatientAddress('Unknown / Roadside');
                        setCollapsePatientDetails(true);
                      }}
                      className="px-2.5 py-1 text-[11px] font-semibold text-amber-900 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200"
                    >
                      Unknown / Unidentified Patient
                    </button>
                    {(collapsePatientDetails || selectedUhid || isUnknownPatient) && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedPatientId('');
                          setSelectedUhid('');
                          setIsUnknownPatient(false);
                          setCollapsePatientDetails(false);
                          setPatientName('');
                          setPatientPhone('');
                          setPatientAddress('');
                        }}
                        className="px-2 py-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>

                {!collapsePatientDetails && (
                  <div className="space-y-1.5">
                    <input
                      value={patientLookupQuery}
                      onChange={(e) => setPatientLookupQuery(e.target.value)}
                      placeholder="Type UHID, patient name or phone to auto-fetch from Patient Intake / OPD..."
                      className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                    {patientLookupQuery.trim().length > 0 && intakeDirectoryMatches.length > 0 && (
                      <div className="max-h-36 overflow-y-auto bg-white border border-slate-200 rounded-lg divide-y divide-slate-100">
                        {intakeDirectoryMatches.map((m) => (
                          <button
                            key={m.key}
                            type="button"
                            onClick={() => applyIntakePatientToEr(m.patient)}
                            className="w-full px-3 py-1.5 text-left hover:bg-rose-50 flex items-center justify-between gap-2"
                          >
                            <span>
                              <strong className="font-mono text-rose-700">{m.uhid}</strong> —{' '}
                              <span className="font-semibold text-slate-900">{m.name}</span>
                              {m.phone ? <span className="text-slate-500 font-mono ml-2">{m.phone}</span> : ''}
                            </span>
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                              {m.badge}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {collapsePatientDetails && (
                  <div className="p-2.5 bg-rose-50 border border-rose-300 rounded-lg flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 text-[11px] font-mono font-bold bg-rose-600 text-white rounded">
                        EMERGENCY
                      </span>
                      {selectedUhid && (
                        <span className="font-mono font-bold text-rose-800">{selectedUhid}</span>
                      )}
                      <span className="font-semibold text-slate-900 text-sm">{patientName}</span>
                      {isUnknownPatient && (
                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                          UNKNOWN (Editable later)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setCollapsePatientDetails(false)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-rose-800 bg-white border border-rose-300 rounded hover:bg-rose-100"
                    >
                      Edit Details
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {!collapsePatientDetails && erFieldRule('patientName') !== 'HIDDEN' && (
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Patient Full Name {erFieldRule('patientName') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <input
                      required={erFieldRule('patientName') === 'REQUIRED' && !isUnknownPatient}
                      value={patientName}
                      onChange={(e) => setPatientName(sanitizePersonName(e.target.value))}
                      placeholder="Full name or Unknown MLC Victim"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
                {!collapsePatientDetails && erFieldRule('patientAge') !== 'HIDDEN' && (
                  <div className="flex gap-1.5">
                    <div className="flex-1">
                      <label className="block font-medium text-slate-700 mb-1">
                        Age {erFieldRule('patientAge') === 'REQUIRED' ? '*' : ''}
                      </label>
                      <input
                        type="number"
                        min={0}
                        required={erFieldRule('patientAge') === 'REQUIRED'}
                        value={patientAge}
                        onChange={(e) => setPatientAge(e.target.value)}
                        className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="w-24">
                      <label className="block font-medium text-slate-700 mb-1">Unit</label>
                      <select
                        value={patientAgeType}
                        onChange={(e) => setPatientAgeType(e.target.value as AgeType)}
                        className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="Years">Years</option>
                        <option value="Months">Months</option>
                        <option value="Days">Days</option>
                      </select>
                    </div>
                  </div>
                )}
                {!collapsePatientDetails && erFieldRule('patientGender') !== 'HIDDEN' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Gender {erFieldRule('patientGender') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <select
                      value={patientGender}
                      onChange={(e) => setPatientGender(e.target.value as PatientGender)}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                )}
                {!collapsePatientDetails && erFieldRule('patientPhone') !== 'HIDDEN' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Phone Number {erFieldRule('patientPhone') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden">
                      <span className="px-2 py-1.5 bg-slate-100 text-slate-600 font-mono border-r border-slate-300 select-none">
                        +977
                      </span>
                      <input
                        required={erFieldRule('patientPhone') === 'REQUIRED' && !isUnknownPatient}
                        value={patientPhone}
                        onChange={(e) => setPatientPhone(e.target.value)}
                        placeholder="98XXXXXXXX"
                        className="w-full px-2.5 py-1.5 font-mono focus:outline-none"
                      />
                    </div>
                  </div>
                )}
                {!collapsePatientDetails && erFieldRule('patientAddress') !== 'HIDDEN' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Address {erFieldRule('patientAddress') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <input
                      required={erFieldRule('patientAddress') === 'REQUIRED' && !isUnknownPatient}
                      value={patientAddress}
                      onChange={(e) => setPatientAddress(e.target.value)}
                      placeholder="Enter Municipality / Ward / Village"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Triage Priority</label>
                  <select
                    value={triageLevel}
                    onChange={(e) => setTriageLevel(e.target.value as EmergencyCase['triageLevel'])}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-medium"
                  >
                    <option value="Red (Resuscitation)">Red (Resuscitation)</option>
                    <option value="Yellow (Urgent)">Yellow (Urgent)</option>
                    <option value="Green (Standard)">Green (Standard)</option>
                    <option value="Black (Brought Dead)">Black (Brought Dead)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Arrival Mode</label>
                  <select
                    value={arrivalMode}
                    onChange={(e) => setArrivalMode(e.target.value as EmergencyCase['arrivalMode'])}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Ambulance">Ambulance</option>
                    <option value="Walk-In">Walk-In</option>
                    <option value="Police Escort">Police Escort</option>
                    <option value="Private Vehicle">Private Vehicle</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Select Available ER Bed Only *
                  </label>
                  <select
                    value={selectedBedId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedBedId(id);
                      const bed = erAvailableBeds.find((b) => b.id === id);
                      if (bed) setErBedBay(`${bed.bedCode} (${bed.wardName})`);
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                  >
                    <option value="">ER Bay Label ({erBedBay})</option>
                    {erAvailableBeds.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bedCode} — {b.wardName} ({b.wardType})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Attending Doctor *</label>
                  {customDoctorMode ? (
                    <div className="flex gap-1">
                      <input
                        value={attendingDoctor}
                        onChange={(e) => setAttendingDoctor(sanitizePersonName(e.target.value))}
                        placeholder="Enter doctor name..."
                        className="flex-1 px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        onClick={() => setCustomDoctorMode(false)}
                        className="px-2 py-1 text-[11px] border border-slate-300 rounded-lg"
                      >
                        List
                      </button>
                    </div>
                  ) : (
                    <select
                      value={doctorOptions.includes(attendingDoctor) ? attendingDoctor : '__CUSTOM__'}
                      onChange={(e) => {
                        if (e.target.value === '__CUSTOM__') {
                          setCustomDoctorMode(true);
                          setAttendingDoctor('');
                        } else {
                          setAttendingDoctor(e.target.value);
                        }
                      }}
                      className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      {doctorOptions.map((doc) => (
                        <option key={doc} value={doc}>
                          {doc}
                        </option>
                      ))}
                      <option value="__CUSTOM__">+ Custom Doctor Name...</option>
                    </select>
                  )}
                </div>
                <div className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-[11px]">
                  <span className="text-slate-600 font-medium">Duty Shift:</span>
                  <span className="font-mono font-semibold text-slate-800">
                    Auto-Detected on Submit ({activeUser.fullName})
                  </span>
                </div>
                {erFieldRule('broughtByName') !== 'HIDDEN' && (
                  <>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Brought By (Name) {erFieldRule('broughtByName') === 'REQUIRED' ? '*' : ''}
                      </label>
                      <input
                        required={erFieldRule('broughtByName') === 'REQUIRED'}
                        value={broughtByName}
                        onChange={(e) => setBroughtByName(sanitizePersonName(e.target.value))}
                        placeholder="Escort / Relative / Police"
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Brought By Phone</label>
                      <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden">
                        <span className="px-2 py-1.5 bg-slate-100 text-slate-600 font-mono border-r border-slate-300 select-none">
                          +977
                        </span>
                        <input
                          value={broughtByPhone}
                          onChange={(e) => setBroughtByPhone(e.target.value)}
                          placeholder="98XXXXXXXX"
                          className="w-full px-2.5 py-1.5 font-mono focus:outline-none"
                        />
                      </div>
                    </div>
                  </>
                )}
                {erFieldRule('chiefComplaint') !== 'HIDDEN' && (
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Chief Complaint / Clinical Status {erFieldRule('chiefComplaint') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <input
                      required={erFieldRule('chiefComplaint') === 'REQUIRED'}
                      value={chiefComplaint}
                      onChange={(e) => setChiefComplaint(e.target.value)}
                      placeholder="e.g., RTA head laceration / Acute chest pain / OP poisoning"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
                {erFieldRule('vitals') !== 'HIDDEN' && (
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Vitals (BP / Pulse / Temp / SpO₂) {erFieldRule('vitals') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      <input
                        required={erFieldRule('vitals') === 'REQUIRED'}
                        value={vitalBp}
                        onChange={(e) => setVitalBp(e.target.value)}
                        placeholder="BP"
                        className="px-1.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                      />
                      <input
                        value={vitalPulse}
                        onChange={(e) => setVitalPulse(e.target.value)}
                        placeholder="PR"
                        className="px-1.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                      />
                      <input
                        value={vitalTemp}
                        onChange={(e) => setVitalTemp(e.target.value)}
                        placeholder="°F"
                        className="px-1.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                      />
                      <input
                        value={vitalSpo2}
                        onChange={(e) => setVitalSpo2(e.target.value)}
                        placeholder="SpO2"
                        className="px-1.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                )}
                <div className="flex flex-col justify-end">
                  <button
                    type="button"
                    onClick={() => setShowErCharges((v) => !v)}
                    className="px-3 py-1.5 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 text-left"
                  >
                    {showErCharges
                      ? 'Hide ER Fee Overrides'
                      : `ER Charges Auto-Applied (${formatNpr((Number(erTicketFeeNpr) || 0) + (Number(erChargesNpr) || 0))}) — Click to Edit`}
                  </button>
                  {showErCharges && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">ER Ticket Fee (रू)</label>
                        <input
                          type="number"
                          min={0}
                          value={erTicketFeeNpr}
                          onChange={(e) => setErTicketFeeNpr(e.target.value)}
                          className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-slate-700 mb-1">ER Reg Fee (रू)</label>
                        <input
                          type="number"
                          min={0}
                          value={erChargesNpr}
                          onChange={(e) => setErChargesNpr(e.target.value)}
                          className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Mode</label>
                  <select
                    value={paymentMode}
                    onChange={(e) => setPaymentMode(e.target.value as PaymentMode)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank / QR">Bank / QR</option>
                  </select>
                </div>
                <div className="sm:col-span-2 p-3 bg-blue-50/70 border border-blue-200 rounded-lg space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-blue-950">
                      Emergency Registration Payable
                    </div>
                    <div className="text-sm font-bold font-mono tabular-nums text-blue-800">
                      Total:{' '}
                      <span className="underline">
                        रू {((Number(erTicketFeeNpr) || 0) + (Number(erChargesNpr) || 0)).toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-blue-200/80">
                    <label className="inline-flex items-center gap-2 text-blue-950 cursor-pointer font-medium">
                      <input
                        type="checkbox"
                        checked={autoPrintErSlipOnRegister}
                        onChange={(e) => setAutoPrintErSlipOnRegister(e.target.checked)}
                        className="rounded border-blue-400 text-blue-700"
                      />
                      <span>
                        Auto-Print Emergency Bill Slip immediately on Register
                      </span>
                    </label>
                    <span className="text-[11px] text-blue-700">
                      Consents auto-set on arrival
                    </span>
                  </div>
                </div>
              </div>

              {/* MLC Toggle + Auto Police Station Box */}
              {erFieldRule('mlcSection') !== 'HIDDEN' && (
              <div className="border-2 border-rose-200 bg-rose-50/30 rounded-xl p-4 space-y-3">
                <label className="inline-flex items-center gap-2 font-semibold text-rose-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isMlc}
                    onChange={(e) => setIsMlc(e.target.checked)}
                    className="rounded border-rose-300 text-rose-600"
                  />
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Mark as Medico-Legal Case (MLC) — Auto-Assign Local Police Station &amp; MLC Forensic Consent</span>
                </label>

                {isMlc && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">MLC Category</label>
                      <select
                        value={mlcCaseType}
                        onChange={(e) => setMlcCaseType(e.target.value as any)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="RTA (Road Traffic Accident)">RTA (Road Traffic Accident)</option>
                        <option value="Physical Assault / Injury">Physical Assault / Injury</option>
                        <option value="Poisoning / Suspected Toxin">Poisoning / Suspected Toxin</option>
                        <option value="Burn / Scald Injury">Burn / Scald Injury</option>
                        <option value="Hanging / Self-Harm">Hanging / Self-Harm</option>
                        <option value="Industrial / Accidental Fall">Industrial / Accidental Fall</option>
                        <option value="Sexual Assault / Forensic">Sexual Assault / Forensic</option>
                        <option value="Brought Dead / Unnatural Death">Brought Dead / Unnatural Death</option>
                        <option value="Other MLC">Other MLC</option>
                      </select>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        Incident Place / Municipality (Dynamic Police Jurisdiction) *
                      </label>
                      {!customIncidentPlace && (db.settings?.moduleSettings?.policeStations || []).length > 0 ? (
                        <select
                          value={incidentPlace}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === '__CUSTOM__') {
                              setCustomIncidentPlace(true);
                              setIncidentPlace('');
                            } else {
                              setIncidentPlace(val);
                            }
                          }}
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                        >
                          <option value="">Select configured municipality / incident place...</option>
                          {(db.settings?.moduleSettings?.policeStations || []).map((ps) => {
                            const placeLabel = (ps.keywords && ps.keywords[0]) || ps.address || ps.stationName;
                            return (
                              <option key={ps.id} value={placeLabel}>
                                {placeLabel} ({ps.stationName})
                              </option>
                            );
                          })}
                          <option value="__CUSTOM__">+ Enter Custom Place / Municipality...</option>
                        </select>
                      ) : (
                        <div className="flex gap-1.5">
                          <input
                            value={incidentPlace}
                            onChange={(e) => setIncidentPlace(e.target.value)}
                            placeholder="e.g., Bode Barsain / Kalyanpur / Kadarbona"
                            className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                          />
                          {(db.settings?.moduleSettings?.policeStations || []).length > 0 && (
                            <button
                              type="button"
                              onClick={() => setCustomIncidentPlace(false)}
                              className="px-2 py-1 text-[11px] bg-white border border-slate-300 rounded-lg"
                            >
                              List
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Auto-Detected Police Station</label>
                      <input
                        value={policeStationName}
                        onChange={(e) => setPoliceStationName(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-rose-300 rounded-lg font-semibold text-rose-900"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Station Phone &amp; Jurisdiction</label>
                      <div className="flex gap-2">
                        <input
                          value={policeStationPhone}
                          onChange={(e) => setPoliceStationPhone(e.target.value)}
                          className="w-28 px-2 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                        />
                        <input
                          value={policeStationAddress}
                          onChange={(e) => setPoliceStationAddress(e.target.value)}
                          className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Identification Marks</label>
                      <input
                        value={identificationMarks}
                        onChange={(e) => setIdentificationMarks(e.target.value)}
                        placeholder="e.g., Scar above right eyebrow / tattoo on forearm"
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Incident Approximate Time</label>
                      <input
                        value={incidentTimeText}
                        onChange={(e) => setIncidentTimeText(e.target.value)}
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block font-medium text-slate-700 mb-1">Injury / Forensic Examination Summary</label>
                      <textarea
                        rows={2}
                        value={injurySummary}
                        onChange={(e) => setInjurySummary(e.target.value)}
                        placeholder="Detailed MLC examination findings for police intimation form..."
                        className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                )}
              </div>
              )}

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowRegisterModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingEr}
                  className="px-4 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {submittingEr ? 'Registering...' : 'Register ER Case & Auto-Set Consents'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SIDE "INFORMED POLICE" CONFIRMATION MODAL */}
      {informCase && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setInformCase(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-rose-50">
              <div className="flex items-center gap-2">
                <Siren className="w-4 h-4 text-rose-600" />
                <h2 className="text-sm font-semibold text-rose-950">
                  Record Police Notification — {informCase.mlcNumber || informCase.erNumber}
                </h2>
              </div>
              <button type="button" onClick={() => setInformCase(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmPoliceInform} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Police Station Name *</label>
                <input
                  required
                  value={infStationName}
                  onChange={(e) => setInfStationName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-medium"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Station Phone</label>
                  <input
                    value={infStationPhone}
                    onChange={(e) => setInfStationPhone(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Informed Ref / GD # *</label>
                  <input
                    required
                    value={infNumber}
                    onChange={(e) => setInfNumber(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Station Address</label>
                <input
                  value={infStationAddress}
                  onChange={(e) => setInfStationAddress(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Police Officer / ASI Name *</label>
                  <input
                    required
                    value={infOfficer}
                    onChange={(e) => setInfOfficer(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Notification Mode</label>
                  <select
                    value={infMode}
                    onChange={(e) => setInfMode(e.target.value as any)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Telephone Call">Telephone Call</option>
                    <option value="Written Dispatch">Written Dispatch</option>
                    <option value="Police Escort / In-Person">Police Escort / In-Person</option>
                    <option value="VHF / Wireless">VHF / Wireless</option>
                  </select>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={alsoLogChalani}
                  onChange={(e) => setAlsoLogChalani(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Automatically create Outward Chalani Register entry with Ref #</span>
              </label>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setInformCase(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingInform}
                  className="px-4 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {savingInform ? 'Saving...' : 'Confirm Police Informed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONSENTS MANAGEMENT MODAL */}
      {consentCase && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setConsentCaseId(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Case Consent Management — {consentCase.patientName} ({consentCase.erNumber})
                </h2>
                <p className="text-[11px] text-slate-500">
                  Auto-set consents assigned upon arrival. Sign, add additional procedures, or print A4 consent form.
                </p>
              </div>
              <button type="button" onClick={() => setConsentCaseId(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4 text-xs">
              {/* Signer Defaults */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3">
                <input
                  value={signGuardianName}
                  onChange={(e) => setSignGuardianName(e.target.value)}
                  placeholder="Patient / Guardian Name"
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                />
                <input
                  value={signRelationship}
                  onChange={(e) => setSignRelationship(e.target.value)}
                  placeholder="Relationship (Self / Spouse / Son)"
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                />
                <input
                  value={signWitnessName}
                  onChange={(e) => setSignWitnessName(e.target.value)}
                  placeholder="Witness / Staff Name"
                  className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                />
              </div>

              {/* Assigned Consents */}
              <div className="space-y-2">
                {(consentCase.consents || []).map((con) => (
                  <div
                    key={con.id}
                    className={`p-3 rounded-xl border space-y-2 ${
                      con.status === 'Signed & Verified' ? 'border-emerald-200 bg-emerald-50/30' : 'border-amber-200 bg-amber-50/30'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-900">{con.title}</span>
                        <span className="ml-2 font-mono text-[11px] text-slate-500">({con.consentType})</span>
                      </div>
                      <span
                        className={`font-semibold text-[11px] ${
                          con.status === 'Signed & Verified' ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        {con.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{con.summaryText}</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-mono text-slate-500">
                        {con.status === 'Signed & Verified'
                          ? `Signed by ${con.patientOrGuardianName} (${con.relationship}) · Witness: ${con.witnessName}`
                          : 'Signature required'}
                      </span>
                      <div className="flex items-center gap-2">
                        {con.status !== 'Signed & Verified' && canManage && (
                          <button
                            type="button"
                            disabled={signingConsentId === con.id}
                            onClick={() => handleSignErConsent(con.id)}
                            className="px-3 py-1 font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                          >
                            {signingConsentId === con.id ? 'Signing...' : 'Sign & Verify'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPrintConsent({ consent: con, erCase: consentCase })}
                          className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-white border border-blue-300 rounded-lg hover:bg-blue-50"
                        >
                          <Printer className="w-3 h-3" />
                          Print A4 Form
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add Additional Consent */}
              {canManage && (
                <form onSubmit={handleAddErConsent} className="border-t border-slate-200 pt-3 flex flex-wrap gap-2">
                  <select
                    value={newConsentType}
                    onChange={(e) => setNewConsentType(e.target.value as any)}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="EMERGENCY_TREATMENT">Emergency Stabilization</option>
                    <option value="MLC_FORENSIC_EXAM">MLC Forensic Exam &amp; Reporting</option>
                    <option value="LAMA_DOR_RISK">LAMA / DOR Risk Declaration</option>
                    <option value="EXTERNAL_REFERRAL_TRANSPORT">External Hospital Referral &amp; Ambulance</option>
                    <option value="SURGERY_ANESTHESIA">Surgery &amp; Anesthesia</option>
                    <option value="ICU_CRITICAL_CARE">ICU Critical Care</option>
                    <option value="GENERAL_ADMISSION">General Admission</option>
                  </select>
                  <input
                    value={newConsentSummary}
                    onChange={(e) => setNewConsentSummary(e.target.value)}
                    placeholder="Optional custom note..."
                    className="flex-1 min-w-[180px] px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                  >
                    + Add Consent
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADMIT ER CASE TO IPD BED MODAL */}
      {admitErCase && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setAdmitErCase(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-900">
                Admit ER Patient to IPD Ward Bed — {admitErCase.erNumber}
              </h2>
              <button type="button" onClick={() => setAdmitErCase(null)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAdmitErToIpd} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-lg text-blue-900">
                Patient: <strong>{admitErCase.patientName}</strong> · Auto-carries{' '}
                <strong>{admitErCase.consents.length} consents</strong> &amp; MLC status into IPD admission.
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Available Ward Bed *</label>
                <select
                  required
                  value={targetBedId}
                  onChange={(e) => setTargetBedId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  {ipdAvailableBeds.length === 0 ? (
                    <option value="">No Available IPD Ward Beds</option>
                  ) : (
                    ipdAvailableBeds.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bedCode} — {b.wardName} ({b.wardType}) · {formatNpr(b.dailyRateNpr)}/day
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Initial Deposit (रू)</label>
                  <input
                    type="number"
                    min={0}
                    value={initialDeposit}
                    onChange={(e) => setInitialDeposit(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mode</label>
                  <select
                    value={admitPayMode}
                    onChange={(e) => setAdmitPayMode(e.target.value as PaymentMode)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank / QR">Bank / QR</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setAdmitErCase(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={admittingIpd || !targetBedId}
                  className="px-4 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {admittingIpd ? 'Admitting...' : 'Admit to Ward Bed'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRINT MLC POLICE NOTIFICATION FORM */}
      {printMlcCase && (
        <MlcPolicePrintModal
          erCase={printMlcCase}
          settings={db.settings}
          onClose={() => setPrintMlcCase(null)}
        />
      )}

      {/* PRINT CASE CONSENT FORM */}
      {printConsent && (
        <ConsentPrintModal
          consent={printConsent.consent}
          patientName={printConsent.erCase.patientName}
          patientMeta={`${printConsent.erCase.patientAge} ${printConsent.erCase.patientAgeType} / ${printConsent.erCase.patientGender} · ${printConsent.erCase.patientAddress}`}
          recordRef={printConsent.erCase.erNumber}
          settings={db.settings}
          onClose={() => setPrintConsent(null)}
        />
      )}

      {/* PRINT ER BILL & STICKER MODAL */}
      {printErStickerCase && (
        <ErChargeStickerModal
          erCase={printErStickerCase}
          settings={db.settings}
          autoPrint={
            db.settings?.moduleSettings?.printOptions?.autoPrintByTemplate?.emergencySlip ===
            'AUTO_PRINT'
          }
          onClose={() => setPrintErStickerCase(null)}
        />
      )}

      {/* INLINE ER REGISTRATION CHARGE SETTINGS MODAL */}
      {showErFeeModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowErFeeModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-rose-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Emergency Module Charge Settings
                </h2>
              </div>
              <button type="button" onClick={() => setShowErFeeModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveErFeeSetting} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Emergency Ticket Fee (रू / NPR) *
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={draftErTicketFee}
                  onChange={(e) => setDraftErTicketFee(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Default Emergency Registration Fee (रू / NPR) *
                </label>
                <input
                  type="number"
                  min={0}
                  required
                  value={draftErFee}
                  onChange={(e) => setDraftErFee(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Applied dynamically to new ER &amp; MLC registrations and ER Charge Sticker Bills.
                </p>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowErFeeModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingErFee}
                  className="px-4 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {savingErFee ? 'Saving...' : 'Save ER Charges'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REFER OUT / AMBULANCE DISPATCH MODAL */}
      {referOutCase && (() => {
        const linkedOrders = (db.orders || []).filter(
          (o) =>
            (referOutCase.uhid && o.uhid === referOutCase.uhid) ||
            (referOutCase.patientId && o.patientId === referOutCase.patientId)
        );
        const linkedRx = (db.pharmacyInvoices || []).filter(
          (inv) =>
            inv.encounterId === referOutCase.id ||
            (referOutCase.uhid && inv.uhid === referOutCase.uhid) ||
            (referOutCase.patientId && inv.patientId === referOutCase.patientId)
        );
        return (
          <div
            className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
            onClick={() => setReferOutCase(null)}
          >
            <div
              className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-rose-50">
                <div className="flex items-center gap-2">
                  <Ambulance className="w-4 h-4 text-rose-600" />
                  <h2 className="text-sm font-semibold text-rose-950">
                    Refer Out ER Patient &amp; Attach Services/Investigations — {referOutCase.erNumber}
                  </h2>
                </div>
                <button type="button" onClick={() => setReferOutCase(null)} className="text-slate-500 hover:text-slate-800">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleReferOutSubmit} className="p-5 space-y-3 text-xs">
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-950">
                  <strong>Auto-Attachment Preview:</strong> {referOutCase.patientName} ({referOutCase.uhid || referOutCase.erNumber}) —{' '}
                  <strong>{linkedOrders.length}</strong> Lab/X-Ray/Service Order(s),{' '}
                  <strong>{linkedRx.length}</strong> Pharmacy Bill(s), ER Charge &amp; complete Clinical History will auto-attach to the printed referral dossier.
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Saved Referred Hospital (Quick Select)</label>
                    <select
                      value={refHospitalId}
                      onChange={(e) => {
                        const hid = e.target.value;
                        setRefHospitalId(hid);
                        const h = (db.referredHospitalsMaster || []).find((x) => x.id === hid);
                        if (h) {
                          setRefHospital(h.name);
                          setRefPlace(h.address);
                          setRefManagerName(h.managerName || '');
                          setRefManagerPhone(h.managerPhone || '');
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
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
                      value={refAmbulanceId}
                      onChange={(e) => {
                        const aid = e.target.value;
                        setRefAmbulanceId(aid);
                        const amb = (db.ambulancesMaster || []).find((x) => x.id === aid);
                        if (amb) {
                          setRefAmbulanceName(amb.name);
                          setRefAmbulanceNumber(amb.vehicleNumber);
                        }
                      }}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Select saved ambulance or type manually...</option>
                      {(db.ambulancesMaster || []).filter((a) => a.active !== false).map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} — {a.vehicleNumber} ({a.driverName})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Referred Hospital Name *</label>
                    <input
                      required
                      value={refHospital}
                      onChange={(e) => setRefHospital(e.target.value)}
                      placeholder="e.g., BPKIHS Dharan / Nobel Medical College"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Destination Place / City *</label>
                    <input
                      required
                      value={refPlace}
                      onChange={(e) => setRefPlace(e.target.value)}
                      placeholder="e.g., Dharan, Sunsari / Biratnagar"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Destination Manager Name</label>
                    <input
                      value={refManagerName}
                      onChange={(e) => setRefManagerName(sanitizePersonName(e.target.value))}
                      placeholder="Hospital Coordinator / Manager"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Manager WhatsApp / Call Phone</label>
                    <input
                      value={refManagerPhone}
                      onChange={(e) => setRefManagerPhone(e.target.value)}
                      placeholder="+97798XXXXXXXX"
                      className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Referred Department</label>
                    <input
                      value={refDept}
                      onChange={(e) => setRefDept(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Case Type (Dynamic Commission)</label>
                    <select
                      value={refCaseType}
                      onChange={(e) => setRefCaseType(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
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
                    <label className="block font-medium text-slate-700 mb-1">Transport Mode</label>
                    <select
                      value={refTransportMode}
                      onChange={(e) =>
                        setRefTransportMode(e.target.value as ExternalReferralDetail['transportMode'])
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="ALS Ambulance">ALS Ambulance</option>
                      <option value="BLS Ambulance">BLS Ambulance</option>
                      <option value="Hospital Vehicle">Hospital Vehicle</option>
                      <option value="Private Vehicle">Private Vehicle</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Ambulance Name / Service *</label>
                    <input
                      required
                      value={refAmbulanceName}
                      onChange={(e) => setRefAmbulanceName(e.target.value)}
                      placeholder="e.g., Hospital ALS Ambulance / Red Cross 102"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Vehicle No.</label>
                      <input
                        value={refAmbulanceNumber}
                        onChange={(e) => setRefAmbulanceNumber(e.target.value)}
                        placeholder="Pradesh 2-03-001 Cha ..."
                        className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">Departure Time *</label>
                      <input
                        required
                        value={refDepartureTime}
                        onChange={(e) => setRefDepartureTime(e.target.value)}
                        placeholder="e.g., 14:35 PM"
                        className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Condition at Departure</label>
                    <input
                      value={refCondition}
                      onChange={(e) => setRefCondition(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Escort Doctor / Paramedic</label>
                    <input
                      value={refEscort}
                      onChange={(e) => setRefEscort(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Reason for Referral *</label>
                    <input
                      required
                      value={refReason}
                      onChange={(e) => setRefReason(e.target.value)}
                      placeholder="e.g., Polytrauma CT / Neurosurgery / Tertiary ICU support"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Detailed Case Notes &amp; ER Stabilization History *
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={refCaseDetails}
                      onChange={(e) => setRefCaseDetails(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setReferOutCase(null)}
                    className="px-3.5 py-2 border border-slate-300 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={referringOut}
                    className="px-4 py-2 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                  >
                    {referringOut ? 'Referring & Attaching...' : 'Confirm Refer Out & Print Summary'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* PRINT ER REFERRAL CLINICAL SUMMARY */}
      {printErReferralCase && (
        <ErReferralPrintModal
          erCase={printErReferralCase}
          settings={db.settings}
          onClose={() => setPrintErReferralCase(null)}
        />
      )}

      {/* STANDALONE THERMAL STICKER PRINT MODAL */}
      {printThermalStickerCase && (
        <ThermalStickerPrintModal
          patientName={printThermalStickerCase.patientName}
          uhid={printThermalStickerCase.uhid || printThermalStickerCase.erNumber}
          ageGender={`${printThermalStickerCase.patientAge} ${printThermalStickerCase.patientAgeType} / ${printThermalStickerCase.patientGender}`}
          encounterLabel={`EMERGENCY · ${printThermalStickerCase.erNumber}`}
          doctorOrUnit={`${printThermalStickerCase.erBedBay} · ${printThermalStickerCase.attendingDoctor}`}
          dateIso={printThermalStickerCase.registeredAt}
          settings={db.settings}
          onClose={() => setPrintThermalStickerCase(null)}
        />
      )}

      {/* EDIT / IDENTIFY ER PATIENT IDENTITY MODAL */}
      {editingErCase && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setEditingErCase(null)}
        >
          <form
            onSubmit={handleSaveErIdentity}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 space-y-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold text-slate-900">
                Update ER Patient Identity — {editingErCase.erNumber}
              </h3>
              <button type="button" onClick={() => setEditingErCase(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
              <input
                required
                value={editName}
                onChange={(e) => setEditName(sanitizePersonName(e.target.value))}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Age</label>
                <input
                  type="number"
                  value={editAge}
                  onChange={(e) => setEditAge(e.target.value)}
                  className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Unit</label>
                <select
                  value={editAgeType}
                  onChange={(e) => setEditAgeType(e.target.value as AgeType)}
                  className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Years">Years</option>
                  <option value="Months">Months</option>
                  <option value="Days">Days</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Gender</label>
                <select
                  value={editGender}
                  onChange={(e) => setEditGender(e.target.value as PatientGender)}
                  className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Mobile Number</label>
              <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden">
                <span className="px-2.5 py-1.5 bg-slate-100 text-slate-600 font-mono border-r border-slate-300 select-none">
                  +977
                </span>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="98XXXXXXXX"
                  className="w-full px-3 py-1.5 font-mono focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Address</label>
              <input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setEditingErCase(null)}
                className="px-3 py-1.5 border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingEditEr}
                className="px-4 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                {savingEditEr ? 'Updating...' : 'Save Identity & Sync Master'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
