import type {
  EmergencyCase,
  EncounterType,
  IpdAdmission,
  LimsDatabase,
  OpdVisit,
  PatientRecord,
} from '../types/lims';

export interface DetectedPatientEncounter {
  encounterType: EncounterType;
  encounterId: string;
  encounterLabel: string;
  attendingDoctor: string;
  departmentOrLocation: string;
  summaryNote: string;
  isActiveEncounter: boolean;
  activeIpd?: IpdAdmission;
  activeEr?: EmergencyCase;
  activeOpd?: OpdVisit;
}

export function normalizePhoneDigits(phone?: string): string {
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : '';
}

export function recordMatchesPatient(
  record: { patientId?: string; uhid?: string; patientPhone?: string; patientName?: string },
  patient: PatientRecord
): boolean {
  if (record.patientId && patient.id && record.patientId === patient.id) return true;
  if (record.uhid && patient.uhid && record.uhid.toUpperCase() === patient.uhid.toUpperCase()) return true;
  const pPhone = normalizePhoneDigits(patient.phone);
  const rPhone = normalizePhoneDigits(record.patientPhone);
  const samePhone = Boolean(pPhone && rPhone && pPhone === rPhone);
  const sameName =
    Boolean(record.patientName && patient.fullName) &&
    record.patientName!.trim().toLowerCase() === patient.fullName.trim().toLowerCase();
  if (samePhone && sameName) return true;
  return false;
}

export function detectPatientEncounter(
  db: LimsDatabase,
  patient: PatientRecord | null | undefined
): DetectedPatientEncounter {
  if (!patient) {
    return {
      encounterType: 'WALKING',
      encounterId: '',
      encounterLabel: 'Walk-In Direct',
      attendingDoctor: '',
      departmentOrLocation: 'Outpatient Counter',
      summaryNote: 'New or Walk-In patient counter billing.',
      isActiveEncounter: false,
    };
  }

  // 1. Active IPD Inpatient Admission
  const activeIpd = (db.ipdAdmissions || []).find(
    (adm) => adm.disposition === 'Admitted' && recordMatchesPatient(adm, patient)
  );
  if (activeIpd) {
    return {
      encounterType: 'IPD',
      encounterId: activeIpd.id,
      encounterLabel: `IPD ${activeIpd.admissionNumber} (${activeIpd.currentBedLabel})`,
      attendingDoctor: activeIpd.admittingDoctor || '',
      departmentOrLocation: `${activeIpd.currentWardName} · ${activeIpd.currentBedLabel}`,
      summaryNote: `Auto-detected active IPD admission (${activeIpd.admissionNumber} · Credit Limit रू ${(activeIpd.creditLimitNpr || 0).toLocaleString()})`,
      isActiveEncounter: true,
      activeIpd,
    };
  }

  // 2. Active Emergency / MLC Observation Case
  const activeEr = (db.emergencyCases || []).find(
    (er) =>
      er.disposition === 'Under Observation (ER)' &&
      recordMatchesPatient(er, patient)
  );
  if (activeEr) {
    return {
      encounterType: 'EMERGENCY',
      encounterId: activeEr.id,
      encounterLabel: `ER ${activeEr.erNumber} (${activeEr.erBedBay})`,
      attendingDoctor: activeEr.attendingDoctor || '',
      departmentOrLocation: `${activeEr.erBedBay} · ${activeEr.triageLevel}`,
      summaryNote: `Auto-detected active Emergency case (${activeEr.erNumber} · ${activeEr.triageLevel})`,
      isActiveEncounter: true,
      activeEr,
    };
  }

  // 3. Today's or Active OPD Visit
  const todayIso = new Date().toISOString().slice(0, 10);
  const matchingOpds = (db.opdVisits || [])
    .filter((v) => recordMatchesPatient(v, patient))
    .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());

  const activeOpd = matchingOpds.find(
    (v) =>
      v.disposition === 'Waiting' ||
      v.disposition === 'In Consultation' ||
      (v.visitDate || '').slice(0, 10) === todayIso
  );

  if (activeOpd) {
    return {
      encounterType: 'OPD',
      encounterId: activeOpd.id,
      encounterLabel: `OPD ${activeOpd.tokenNumber} (${activeOpd.department})`,
      attendingDoctor: activeOpd.consultingDoctor || '',
      departmentOrLocation: activeOpd.department,
      summaryNote: `Auto-detected active OPD visit (${activeOpd.tokenNumber} · ${activeOpd.consultingDoctor})`,
      isActiveEncounter: true,
      activeOpd,
    };
  }

  // 4. Fallback to Walk-In (noting prior OPD if available)
  const latestOpd = matchingOpds[0];
  return {
    encounterType: 'WALKING',
    encounterId: '',
    encounterLabel: `WALKING · ${patient.uhid}`,
    attendingDoctor: latestOpd?.consultingDoctor || '',
    departmentOrLocation: 'Hospital Billing Counter',
    summaryNote: latestOpd
      ? `No active IPD/ER/Today OPD open (Last OPD: ${latestOpd.tokenNumber}). Routing as Walk-In UHID.`
      : `Registered UHID (${patient.uhid}) with no active admission. Routing as Walk-In.`,
    isActiveEncounter: false,
    activeOpd: latestOpd,
  };
}
