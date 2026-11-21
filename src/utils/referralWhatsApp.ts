import type {
  ExternalReferralDetail,
  LabSettings,
  ReferralWhatsAppTemplateConfig,
} from '../types/lims';
import { adToBs } from './nepaliDate';

export const DEFAULT_REFERRAL_WHATSAPP_TEMPLATE: ReferralWhatsAppTemplateConfig = {
  headerTitle: 'URGENT PATIENT REFERRAL — {{ourHospital}}',
  bodyTemplate: [
    '*{{headerTitle}}*',
    'Receiving Hospital: {{receivingHospital}} ({{receivingPlace}})',
    'Attention Manager: {{managerName}}',
    'Patient: *{{patientName}}* | UHID: {{uhid}} ({{encounterType}} {{encounterNumber}})',
    'Age / Sex / Address: {{ageGender}} · {{patientAddress}}',
    'Date / Time: {{dateBs}} BS ({{timeEn}})',
    'Case Type: {{caseType}} | Condition: {{condition}}',
    'Clinical Reason: {{reason}}',
    'Vitals: {{vitals}}',
    'Ambulance: {{ambulanceName}} [{{ambulanceNumber}}] · Driver: {{driverName}} ({{driverPhone}})',
    'Referring Clinician: {{referringDoctor}}',
    'Treatments / Investigations Given (No Pricing): {{treatmentsAndTests}}',
  ].join('\n'),
  footerNote: 'Kindly arrange emergency reception bed & duty team on arrival. Call: {{ourHospitalPhone}}',
  includeAmbulanceDriver: true,
  includeVitals: true,
  includeClinicalSummary: true,
  includeTimestampBs: true,
};

export const REFERRAL_WHATSAPP_PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: '{{ourHospital}}', label: 'Hospital Name' },
  { token: '{{ourHospitalPhone}}', label: 'Hospital Phone' },
  { token: '{{receivingHospital}}', label: 'Referred Hospital' },
  { token: '{{receivingPlace}}', label: 'Referred Place' },
  { token: '{{managerName}}', label: 'Manager Name' },
  { token: '{{managerPhone}}', label: 'Manager Phone' },
  { token: '{{patientName}}', label: 'Patient Name' },
  { token: '{{uhid}}', label: 'UHID' },
  { token: '{{ageGender}}', label: 'Age / Sex' },
  { token: '{{patientAddress}}', label: 'Patient Address' },
  { token: '{{encounterType}}', label: 'OPD/ER/IPD' },
  { token: '{{encounterNumber}}', label: 'Encounter #' },
  { token: '{{dateBs}}', label: 'BS Date' },
  { token: '{{timeEn}}', label: 'Time' },
  { token: '{{caseType}}', label: 'Case Type' },
  { token: '{{condition}}', label: 'Condition' },
  { token: '{{reason}}', label: 'Reason' },
  { token: '{{vitals}}', label: 'Latest Vitals' },
  { token: '{{ambulanceName}}', label: 'Ambulance Name' },
  { token: '{{ambulanceNumber}}', label: 'Ambulance Vehicle #' },
  { token: '{{driverName}}', label: 'Driver Name' },
  { token: '{{driverPhone}}', label: 'Driver Phone' },
  { token: '{{treatmentsAndTests}}', label: 'Meds & Tests Given' },
  { token: '{{referringDoctor}}', label: 'Doctor Name' },
];

export function formatNepalWaPhone(rawPhone?: string): string {
  const digits = (rawPhone || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('977')) return digits;
  if (digits.length === 10) return `977${digits}`;
  return digits;
}

export interface ReferralWhatsAppMessageInput {
  patientName: string;
  uhid?: string;
  ageGender?: string;
  patientAddress?: string;
  sourceType: 'OPD' | 'ER' | 'IPD' | 'DIRECT';
  encounterNumber: string;
  referredAt: string;
  vitalsSummary?: string;
  referringDoctor?: string;
  ext: ExternalReferralDetail;
}

export function formatReferralWhatsAppMessage(
  input: ReferralWhatsAppMessageInput,
  settings?: LabSettings
): string {
  const tpl: ReferralWhatsAppTemplateConfig = {
    ...DEFAULT_REFERRAL_WHATSAPP_TEMPLATE,
    ...(settings?.moduleSettings?.referralWhatsAppTemplate || {}),
  };

  const ext = input.ext;
  const bsRef = adToBs(input.referredAt || new Date().toISOString());

  const clinicalNames =
    ext.clinicalTreatmentItems && ext.clinicalTreatmentItems.length > 0
      ? ext.clinicalTreatmentItems.map((c) => `${c.description} (${c.category})`)
      : (ext.attachedBilledItems || []).map((b) => `${b.description} (${b.category})`);

  const treatmentsSummary =
    tpl.includeClinicalSummary && clinicalNames.length > 0
      ? clinicalNames.slice(0, 12).join(', ')
      : 'Initial emergency stabilization provided';

  const vars: Record<string, string> = {
    ourHospital: settings?.labName || 'Saptari Hospital Pvt Ltd',
    ourHospitalPhone: settings?.contactLine || '+977-031-560000',
    receivingHospital: ext.referredToHospital || 'Receiving Hospital',
    receivingPlace: ext.referredToPlace || 'Higher Center',
    managerName: ext.referredHospitalManagerName || 'Hospital Manager',
    managerPhone: ext.referredHospitalManagerPhone || '—',
    patientName: input.patientName || 'Patient',
    uhid: input.uhid || '—',
    ageGender: input.ageGender || '—',
    patientAddress: input.patientAddress || '—',
    encounterType: input.sourceType,
    encounterNumber: input.encounterNumber || '—',
    dateBs: tpl.includeTimestampBs ? bsRef.formattedEn : new Date(input.referredAt).toISOString().slice(0, 10),
    timeEn: bsRef.timeEn || '',
    caseType: ext.referralCaseType || 'CLINICAL REFERRAL',
    condition: ext.conditionAtReferral || 'Referred for higher management',
    reason: ext.referralReason || 'Specialist tertiary evaluation',
    vitals: tpl.includeVitals ? input.vitalsSummary || 'Recorded at bedside' : 'N/A',
    ambulanceName: tpl.includeAmbulanceDriver ? ext.ambulanceName || ext.transportMode || 'Ambulance' : ext.transportMode || 'Ambulance',
    ambulanceNumber: tpl.includeAmbulanceDriver ? ext.ambulanceNumber || 'N/A' : 'N/A',
    driverName: tpl.includeAmbulanceDriver ? ext.ambulanceDriverName || 'Assigned Driver' : 'N/A',
    driverPhone: tpl.includeAmbulanceDriver ? ext.ambulanceDriverPhone || '—' : '—',
    treatmentsAndTests: treatmentsSummary,
    referringDoctor: input.referringDoctor || ext.escortDoctorOrNurse || ext.referredBy || 'Duty Physician',
  };

  // Resolve headerTitle first since bodyTemplate can reference {{headerTitle}}
  const resolvedHeader = (tpl.headerTitle || DEFAULT_REFERRAL_WHATSAPP_TEMPLATE.headerTitle).replace(
    /\{\{([a-zA-Z0-9_]+)\}\}/g,
    (_, key) => vars[key] ?? ''
  );
  vars.headerTitle = resolvedHeader;

  const rawLines = (tpl.bodyTemplate || DEFAULT_REFERRAL_WHATSAPP_TEMPLATE.bodyTemplate).split('\n');
  const resolvedLines = rawLines
    .filter((line) => {
      if (!tpl.includeAmbulanceDriver && (line.includes('{{ambulance') || line.includes('{{driver'))) {
        return false;
      }
      if (!tpl.includeVitals && line.includes('{{vitals}}')) {
        return false;
      }
      if (!tpl.includeClinicalSummary && line.includes('{{treatmentsAndTests}}')) {
        return false;
      }
      return true;
    })
    .map((line) =>
      line
        .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => vars[key] ?? '')
        .replace(/\s*\[\]\s*/g, ' ')
        .replace(/\s*\(\s*\)\s*/g, ' ')
        .trim()
    )
    .filter(Boolean);

  if (tpl.footerNote && tpl.footerNote.trim()) {
    const resolvedFooter = tpl.footerNote
      .replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, key) => vars[key] ?? '')
      .trim();
    if (resolvedFooter) resolvedLines.push(resolvedFooter);
  }

  return resolvedLines.join('\n');
}

export function buildReferralWhatsAppUrl(
  input: ReferralWhatsAppMessageInput,
  settings?: LabSettings
): { url: string; messageText: string; phoneFormatted: string } {
  const messageText = formatReferralWhatsAppMessage(input, settings);
  const phoneFormatted = formatNepalWaPhone(input.ext.referredHospitalManagerPhone);
  const url = phoneFormatted
    ? `https://wa.me/${phoneFormatted}?text=${encodeURIComponent(messageText)}`
    : `https://wa.me/?text=${encodeURIComponent(messageText)}`;
  return { url, messageText, phoneFormatted };
}
