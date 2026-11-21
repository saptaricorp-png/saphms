import type { ModuleSettingsConfig, RegistrationFieldRule } from '../types/lims';

export type RegistrationFormScope = 'pos' | 'opd' | 'er' | 'ipd';

export interface RegistrationFieldDescriptor {
  key: string;
  label: string;
  defaultRule: RegistrationFieldRule;
}

export const REGISTRATION_FIELD_CATALOG: Record<RegistrationFormScope, RegistrationFieldDescriptor[]> = {
  pos: [
    { key: 'patientName', label: 'Patient Full Name', defaultRule: 'REQUIRED' },
    { key: 'patientPhone', label: 'Phone / Mobile', defaultRule: 'REQUIRED' },
    { key: 'patientAge', label: 'Age & Age Unit', defaultRule: 'REQUIRED' },
    { key: 'patientGender', label: 'Gender / Sex', defaultRule: 'REQUIRED' },
    { key: 'patientAddress', label: 'Address (Municipality / Ward)', defaultRule: 'OPTIONAL' },
    { key: 'patientEmail', label: 'Email (Auto Report)', defaultRule: 'OPTIONAL' },
    { key: 'referringDoctor', label: 'Referring Doctor Name', defaultRule: 'OPTIONAL' },
    { key: 'referralPartnerId', label: 'Referral Partner (Commission)', defaultRule: 'OPTIONAL' },
  ],
  opd: [
    { key: 'patientName', label: 'Patient Full Name', defaultRule: 'REQUIRED' },
    { key: 'patientPhone', label: 'Phone / Mobile', defaultRule: 'REQUIRED' },
    { key: 'patientAge', label: 'Age & Age Unit', defaultRule: 'REQUIRED' },
    { key: 'patientGender', label: 'Gender / Sex', defaultRule: 'REQUIRED' },
    { key: 'patientAddress', label: 'Address (Municipality / Ward)', defaultRule: 'OPTIONAL' },
    { key: 'department', label: 'OPD Department', defaultRule: 'REQUIRED' },
    { key: 'consultingDoctor', label: 'Consulting Doctor', defaultRule: 'REQUIRED' },
    { key: 'chiefComplaint', label: 'Chief Complaint', defaultRule: 'OPTIONAL' },
  ],
  er: [
    { key: 'patientName', label: 'Patient Full Name', defaultRule: 'REQUIRED' },
    { key: 'patientPhone', label: 'Phone / Mobile', defaultRule: 'OPTIONAL' },
    { key: 'patientAge', label: 'Age & Age Unit', defaultRule: 'REQUIRED' },
    { key: 'patientGender', label: 'Gender / Sex', defaultRule: 'REQUIRED' },
    { key: 'patientAddress', label: 'Address', defaultRule: 'OPTIONAL' },
    { key: 'broughtByName', label: 'Brought By / Attendant', defaultRule: 'OPTIONAL' },
    { key: 'chiefComplaint', label: 'Chief Complaint / Mechanism', defaultRule: 'REQUIRED' },
    { key: 'vitals', label: 'Initial Triage Vitals', defaultRule: 'OPTIONAL' },
    { key: 'mlcSection', label: 'MLC & Police Intimation Option', defaultRule: 'OPTIONAL' },
  ],
  ipd: [
    { key: 'patientName', label: 'Patient Full Name', defaultRule: 'REQUIRED' },
    { key: 'patientPhone', label: 'Patient Phone', defaultRule: 'OPTIONAL' },
    { key: 'patientAge', label: 'Age & Age Unit', defaultRule: 'REQUIRED' },
    { key: 'patientGender', label: 'Gender / Sex', defaultRule: 'REQUIRED' },
    { key: 'patientAddress', label: 'Address (Municipality / Ward)', defaultRule: 'OPTIONAL' },
    { key: 'emergencyContact', label: 'Emergency Contact / Kin', defaultRule: 'OPTIONAL' },
    { key: 'admittingDoctor', label: 'Admitting Doctor', defaultRule: 'OPTIONAL' },
    { key: 'admittingDiagnosis', label: 'Admitting Diagnosis', defaultRule: 'REQUIRED' },
    { key: 'advanceDeposit', label: 'Initial Advance Deposit', defaultRule: 'OPTIONAL' },
  ],
};

export function getRegistrationFieldRule(
  ms: Partial<ModuleSettingsConfig> | undefined,
  scope: RegistrationFormScope,
  key: string
): RegistrationFieldRule {
  const configured = ms?.registrationFieldRules?.[scope]?.[key];
  if (configured) return configured;
  const fallback = REGISTRATION_FIELD_CATALOG[scope].find((f) => f.key === key)?.defaultRule;
  return fallback || 'OPTIONAL';
}
