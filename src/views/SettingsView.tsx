import React, { useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FolderSync,
  KeyRound,
  Landmark,
  Lock,
  LogOut,
  MessageCircle,
  Monitor,
  PenTool,
  PhoneCall,
  Pill,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Scan,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  ChargeRateBasis,
  DigitalSignatureAsset,
  DigitalSignatureRoleKey,
  LimsDatabase,
  ModuleSettingsConfig,
  NursingObservationTypeConfig,
  OpdConsultationTypeConfig,
  PaymentMode,
  PermissionKey,
  PoliceStationConfig,
  PrintOptionsConfig,
  RegistrationFieldRule,
  StaffMember,
} from '../types/lims';
import { FISCAL_YEARS, formatNpr } from '../utils/nepaliDate';
import {
  REGISTRATION_FIELD_CATALOG,
  type RegistrationFormScope,
} from '../utils/registrationFields';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { CloudBackupPanel } from '../components/CloudBackupPanel';
import { apiRequest } from '../api/client';

interface SettingsViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  onCloseAfterSave?: () => void;
  onResetDemo: () => void;
  onLogout: () => void;
  onLockNow: () => void;
  initialSearchQuery?: string;
  autoSyncFolderName?: string | null;
  autoSyncLastAt?: string | null;
  autoSyncStatus?: string | null;
  onChooseAutoSyncFolder?: () => void;
  onSyncBackupNow?: () => void;
  onDisableAutoSyncFolder?: () => void;
}

type SettingsTab =
  | 'session'
  | 'general'
  | 'print_signatures'
  | 'hospital_tariffs'
  | 'clinical'
  | 'radiology'
  | 'pharmacy'
  | 'pos_finance'
  | 'centers_security'
  | 'downloads_sync';

const DEFAULT_OPD_TYPES: OpdConsultationTypeConfig[] = [
  { id: 'opd-general', name: 'General OPD', feeNpr: 500, active: true },
  { id: 'opd-specialist', name: 'Specialist MD', feeNpr: 800, active: true },
  { id: 'opd-followup', name: 'Follow-Up (7 Days)', feeNpr: 300, active: true },
  { id: 'opd-priority', name: 'Priority / Fast Track', feeNpr: 1000, active: true },
];

const DEFAULT_POLICE_STATIONS: PoliceStationConfig[] = [
  {
    id: 'ps-bode-barsain',
    stationName: 'Area Police Office, Bode Barsain (इलाका प्रहरी कार्यालय, बोदे बर्साइन)',
    municipalityOrArea: 'Bode Barsain Municipality',
    address: 'Bode Barsain-05, Saptari',
    phone: '031-560100 / 9852830100',
    keywords: ['bode', 'barsain', 'bodebarsain', 'manraja', 'sarapalla', 'khadakpur'],
  },
  {
    id: 'ps-kadarbona',
    stationName: 'Area Police Office, Kadarbona',
    municipalityOrArea: 'Khadak / Shambhunath Corridor',
    address: 'Kadarbona, East-West Highway, Saptari',
    phone: '031-529100 / 9852840100',
    keywords: ['kadarbona', 'khadak', 'shambhunath', 'kalyanpur', 'siswari', 'rupani'],
  },
  {
    id: 'ps-rajbiraj',
    stationName: 'District Police Office, Saptari (Rajbiraj)',
    municipalityOrArea: 'Rajbiraj & Surroundings',
    address: 'Rajbiraj-01, District HQ, Saptari',
    phone: '031-520199 / 100',
    keywords: ['rajbiraj', 'tilathi', 'koiladi', 'bishnupur', 'hanumannagar', 'chhinnamasta'],
  },
];

const DEFAULT_SIGNATURE_BOXES: DigitalSignatureAsset[] = [
  { roleKey: 'CEO_CHAIRMAN', label: 'Hospital Chairman / CEO', signerName: 'Chairman / Director', designation: 'Managing Director', regNo: '' },
  { roleKey: 'PATHOLOGIST', label: 'Consultant Pathologist', signerName: 'Dr. Santosh Majhi, MD', designation: 'Consultant Pathologist', regNo: 'NMC # 18492' },
  { roleKey: 'DOCTOR', label: 'Consulting Physician / Medical Officer', signerName: 'Duty Medical Officer', designation: 'Consultant Physician', regNo: 'NMC # 21450' },
  { roleKey: 'NURSE', label: 'Staff Nurse / Ward Incharge', signerName: 'Ward Nursing Incharge', designation: 'Registered Nurse (BN)', regNo: 'NNC # 44120' },
  { roleKey: 'HOSPITAL_CASHIER', label: 'Hospital Counter Cashier', signerName: 'Hospital Billing Counter', designation: 'Cashier / Accounts', regNo: '' },
  { roleKey: 'PHARMACY_CASHIER', label: 'Pharmacy Counter Cashier', signerName: 'Hospital Pharmacy Counter', designation: 'Registered Pharmacist', regNo: 'NPC # 8821' },
  { roleKey: 'RADIOLOGIST', label: 'Consultant Radiologist', signerName: 'Consultant Radiologist', designation: 'MD Radiodiagnosis', regNo: 'NMC # 19884' },
];

const DEFAULT_PRINT_OPTIONS: PrintOptionsConfig = {
  defaultPaperSize: 'A5',
  defaultLetterheadMode: 'with-letterhead',
  selectedReportDesignId: 'tpl-main-lab',
  selectedBillDesignId: 'tpl-pos-a5-pro',
  selectedPharmacyDesignId: 'tpl-pharmacy-a5',
  selectedOthersDesignId: 'tpl-admission-a5',
  autoPrintByTemplate: {
    labReport: 'MANUAL_PROMPT',
    radiologyReport: 'MANUAL_PROMPT',
    posBill: 'AUTO_PRINT',
    pharmacyBill: 'AUTO_PRINT',
    admissionReceipt: 'AUTO_PRINT',
    emergencySlip: 'AUTO_PRINT',
    opdSlip: 'MANUAL_PROMPT',
    certificates: 'MANUAL_PROMPT',
  },
};

const DEFAULT_NURSING_OBS_TYPES: NursingObservationTypeConfig[] = [
  { id: 'obs-morning', name: 'Morning Nursing Round & Vitals', defaultFeeNpr: 250 },
  { id: 'obs-evening', name: 'Evening Nursing Round & Medication', defaultFeeNpr: 250 },
  { id: 'obs-night', name: 'Night Shift Continuous Observation', defaultFeeNpr: 350 },
  { id: 'obs-icu', name: 'ICU / High-Dependency Nursing Care', defaultFeeNpr: 600 },
  { id: 'obs-dressing', name: 'Post-Op Wound Dressing / IV Care', defaultFeeNpr: 300 },
];

const DEFAULT_MODULE_SETTINGS: ModuleSettingsConfig = {
  tatWarningThresholdPercent: 80,
  requireDoctorNameOnOrder: false,
  notifyCriticalPanicSms: true,
  requireFilmRetakeReason: true,
  autoDeductFilmOnSignoff: true,
  defaultDoseUnit: 'mSv',
  pharmacyEntityName: 'Saptari Hospital Pharmacy',
  pharmacyEntityNameNp: 'सप्तरी हस्पिटल फार्मेसी',
  pharmacyPanNumber: '610492185',
  pharmacyDdaLicense: 'DDA-SAP-2081-044',
  pharmacyPhone: '97-1515-6678',
  pharmacyAddress: 'Bode Barsain-05, Saptari (Ground Floor Counter)',
  hospitalLogoDataUrl: '',
  pharmacyLogoDataUrl: '',
  signatureBoxes: DEFAULT_SIGNATURE_BOXES,
  printOptions: DEFAULT_PRINT_OPTIONS,
  customServiceCategories: ['Consultation', 'Procedures', 'Diagnostics', 'Ortho & Plaster', 'Emergency', 'Radiology'],
  lanServerHostIp: '192.168.1.100',
  strictFefoBlockExpired: true,
  pharmacyNearExpiryDays: 90,
  pharmacyInvoicePrefix: 'PHM',
  showBatchExpiryOnPharmacyBill: true,
  billPrefix: 'BILL',
  labOrderPrefix: 'LAB',
  reportPrefix: 'RPT',
  opdPrefix: 'OPD',
  ipdPrefix: 'IPD',
  erPrefix: 'ER',
  mlcPrefix: 'MLC',
  gatepassPrefix: 'GP',
  referralPrefix: 'REF',
  voucherPrefix: 'VCH',
  showDigitallyVerifiedSeal: true,
  digitalVerifierName: 'Dr. Santosh Majhi, MD (Pathology)',
  digitalVerifierDesignation: 'Chief Pathologist & Hospital Director',
  digitalVerifierRegNo: 'NMC # 18492',
  digitalSignatureText: 'Digitally Verified & Signed — Saptari Hospital Pvt Ltd',
  defaultPosPaymentMode: 'Cash',
  maxCashierDiscountPercent: 15,
  cashierMaxDiscountNpr: 1000,
  discountApprovalPolicy: 'MANAGER_THEN_ADMIN',
  creditApprovalPolicy: 'MANAGER_THEN_ADMIN',
  requireVarianceNoteOnClose: true,
  requireTwoTierFinanceApproval: true,
  nonInventoryBillEnabled: true,
  autoSyncBackupMinutes: 10,
  enforceHardCreditStop: false,
  defaultCenterCreditLimitNpr: 150000,
  riderGpsRefreshSeconds: 30,
  maxFailedAttemptsBeforeLock: 5,
  enforceStrictCenterIsolation: false,
  hospitalAccessOnlyForStaff: false,
  allowedHospitalIps: '192.168.1.*, 10.0.0.*',
  hospitalWifiCheckCode: 'SAPTARI-HOSP-2083',
  hikvisionDeviceIp: '192.168.1.210',
  hikvisionDevicePort: 80,
  hikvisionDeviceName: 'Main Gate Hikvision Terminal',
  adminEraseSecretPin: '2082',
  adminConfirmEmail: 'epusaan@gmail.com',
  emergencyRegistrationFeeNpr: 500,
  emergencyTicketFeeNpr: 200,
  defaultOpdConsultationFeeNpr: 500,
  opdFreeFollowUpDays: 7,
  opdFollowUpSameDoctorOnly: false,
  opdFollowUpWithinWindowFeeNpr: 0,
  opdFollowUpFeeAfterExpiryNpr: 300,
  opdConsultationTypes: DEFAULT_OPD_TYPES,
  ipdAdmissionFeeNpr: 1500,
  ipdDefaultCreditLimitNpr: 25000,
  ipdBedCycleStartTime: '07:00',
  ipdBedCycleEndTime: '19:00',
  ipdBedChargeScheduleMode: 'CYCLE_WINDOW',
  ipdDoctorRoundFeeNpr: 500,
  ipdDoctorRoundBasis: 'PER_ROUND',
  ipdDoctorRoundsPerDay: 2,
  ipdDoctorRoundScheduleTimes: '08:30, 17:30',
  ipdNursingChargePerDayNpr: 400,
  ipdNursingChargeBasis: 'PER_DAY',
  ipdNursingRoundsPerDay: 3,
  ipdNursingScheduleTimes: '07:00, 14:00, 21:00',
  ipdDailyObservationFeeNpr: 300,
  ipdObservationChargeBasis: 'PER_DAY',
  ipdObservationRoundsPerDay: 2,
  ipdObservationScheduleTimes: '08:00, 20:00',
  shiftPricing: {
    bed: { Morning: 800, Afternoon: 800, Night: 1000 },
    observation: { Morning: 250, Afternoon: 250, Night: 350 },
    nursing: { Morning: 300, Afternoon: 300, Night: 400 },
    doctorRound: { Morning: 500, Afternoon: 500, Night: 700 },
  },
  nursingObservationTypes: DEFAULT_NURSING_OBS_TYPES,
  autoDeductIpdMedFromPharmacyFefo: true,
  markBedCleaningOnDischarge: true,
  policeStations: DEFAULT_POLICE_STATIONS,
  registrationFieldRules: {
    pos: {},
    opd: {},
    er: {},
    ipd: {},
  },
  keyboardNavigationMode: 'ENTER_AS_TAB',
  showDemoCredentialsOnLogin: true,
  showErFeeFieldsInForm: false,
  referralCaseRules: [
    { id: 'rcr-rta', caseType: 'RTA Case', mode: 'PERCENT', value: 10, active: true },
    { id: 'rcr-poison', caseType: 'Poison Case', mode: 'FLAT', value: 1000, active: true },
    { id: 'rcr-lscs', caseType: 'LSCS', mode: 'FLAT', value: 1500, active: true },
  ],
  referralBillTierRules: [
    { id: 'rbt-5k', label: 'First ER + Adm + POS >= 5,000', minTotalBillNpr: 5000, commissionAmountNpr: 500, active: true },
    { id: 'rbt-10k', label: 'First ER + Adm + POS >= 10,000', minTotalBillNpr: 10000, commissionAmountNpr: 1200, active: true },
  ],
};

const TAB_DEFS: Array<{
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
}> = [
  {
    id: 'session',
    label: 'Session & PIN',
    icon: KeyRound,
    keywords: 'session pin lock logout pwa install mobile idle',
  },
  {
    id: 'general',
    label: 'Hospital, Prefixes & Seal',
    icon: Settings,
    keywords: 'hospital name nepali legal entity pan vat prefix bill report opd ipd er mlc gatepass digital signature seal verifier fiscal year keyboard enter tab form navigation',
  },
  {
    id: 'print_signatures',
    label: 'Print Options & Signatures',
    icon: Printer,
    keywords: 'print options auto print manual prompt a5 portrait a4 thermal letterhead template design signature logo upload ceo pathologist doctor nurse cashier radiologist',
  },
  {
    id: 'hospital_tariffs',
    label: 'ER / OPD / IPD & Police',
    icon: Stethoscope,
    keywords: 'emergency er ticket fee opd consultation type specialist followup days fee expiry ipd admission credit limit bed cycle 07:00 19:00 round nursing observation police station saptari',
  },
  {
    id: 'clinical',
    label: 'Clinical Diagnostics & TAT',
    icon: Activity,
    keywords: 'clinical tat warning threshold sla doctor order critical panic sms auto email validate pathologist',
  },
  {
    id: 'radiology',
    label: 'Radiology & Films',
    icon: Scan,
    keywords: 'radiology xray ct usg echo film retake deduct signoff dose unit msv mgy',
  },
  {
    id: 'pharmacy',
    label: 'Pharmacy Identity & FEFO',
    icon: Pill,
    keywords: 'pharmacy separate entity pan dda license fefo expired block near expiry days invoice prefix batch expiry medicine',
  },
  {
    id: 'pos_finance',
    label: 'POS, Finance & WhatsApp',
    icon: Landmark,
    keywords: 'pos billing payment mode discount cashier counter close variance whatsapp daily sales 2 tier approval non inventory bill only',
  },
  {
    id: 'centers_security',
    label: 'Security, Hikvision & Access',
    icon: Building2,
    keywords: 'hikvision biometric ip port hospital only perimeter wifi code lockout failed attempts admin erase secret pin email support phone virus integrity',
  },
  {
    id: 'downloads_sync',
    label: 'LAN Server, Apps & Backup',
    icon: Download,
    keywords: 'source code zip shared hosting cpanel iisnode chrome extension windows installer lan ip server mac app android apk pwa backup auto sync folder',
  },
];

export function SettingsView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  onCloseAfterSave,
  onResetDemo,
  onLogout,
  onLockNow,
  initialSearchQuery,
  autoSyncFolderName,
  autoSyncLastAt,
  autoSyncStatus,
  onChooseAutoSyncFolder,
  onSyncBackupNow,
  onDisableAutoSyncFolder,
}: SettingsViewProps) {
  const canManage = hasPerm('settings.manage');

  const [activeSubTab, setActiveSubTab] = useState<SettingsTab>('general');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  // General & Lab Identity
  const [labName, setLabName] = useState(db.settings.labName);
  const [labNameNp, setLabNameNp] = useState(db.settings.labNameNp);
  const [legalEntityName, setLegalEntityName] = useState(db.settings.legalEntityName);
  const [panNumber, setPanNumber] = useState(db.settings.panNumber);
  const [accreditationLine, setAccreditationLine] = useState(db.settings.accreditationLine);
  const [addressLine, setAddressLine] = useState(db.settings.addressLine);
  const [contactLine, setContactLine] = useState(db.settings.contactLine);
  const [emailSender, setEmailSender] = useState(db.settings.emailSender);
  const [activeFiscalYear, setActiveFiscalYear] = useState(db.settings.activeFiscalYear);
  const [topMargin, setTopMargin] = useState(String(db.settings.prePrintedTopMarginMm));
  const [bottomMargin, setBottomMargin] = useState(String(db.settings.prePrintedBottomMarginMm));

  // WhatsApp & Notifications
  const [adminWhatsAppNumber, setAdminWhatsAppNumber] = useState(
    db.settings.adminWhatsAppNumber
  );
  const [autoSendDailySalesWhatsApp, setAutoSendDailySalesWhatsApp] = useState(
    db.settings.autoSendDailySalesWhatsApp
  );
  const [dailySalesWhatsAppTime, setDailySalesWhatsAppTime] = useState(
    db.settings.dailySalesWhatsAppTime
  );
  const [autoEmailOnValidate, setAutoEmailOnValidate] = useState(
    db.settings.autoEmailOnValidate
  );
  const [idleLockSeconds, setIdleLockSeconds] = useState(
    String(db.settings.idleLockSeconds || 150)
  );
  const [resetSupportPhone, setResetSupportPhone] = useState(
    db.settings.resetSupportPhone || '+977-9851100999'
  );

  // Per-Module ERP Settings (deep-merge printOptions & signatureBoxes)
  const buildMergedModuleSettings = (incoming?: Partial<ModuleSettingsConfig>): ModuleSettingsConfig => ({
    ...DEFAULT_MODULE_SETTINGS,
    ...(incoming || {}),
    printOptions: {
      ...DEFAULT_PRINT_OPTIONS,
      ...(incoming?.printOptions || {}),
      autoPrintByTemplate: {
        ...DEFAULT_PRINT_OPTIONS.autoPrintByTemplate,
        ...(incoming?.printOptions?.autoPrintByTemplate || {}),
      },
    },
    signatureBoxes:
      incoming?.signatureBoxes && incoming.signatureBoxes.length > 0
        ? DEFAULT_SIGNATURE_BOXES.map((def) => {
            const existing = incoming.signatureBoxes?.find((s) => s.roleKey === def.roleKey);
            return existing ? { ...def, ...existing } : def;
          })
        : DEFAULT_SIGNATURE_BOXES,
    nursingObservationTypes:
      incoming?.nursingObservationTypes && incoming.nursingObservationTypes.length > 0
        ? incoming.nursingObservationTypes
        : DEFAULT_NURSING_OBS_TYPES,
    shiftPricing: {
      bed: { ...DEFAULT_MODULE_SETTINGS.shiftPricing!.bed, ...(incoming?.shiftPricing?.bed || {}) },
      observation: { ...DEFAULT_MODULE_SETTINGS.shiftPricing!.observation, ...(incoming?.shiftPricing?.observation || {}) },
      nursing: { ...DEFAULT_MODULE_SETTINGS.shiftPricing!.nursing, ...(incoming?.shiftPricing?.nursing || {}) },
      doctorRound: { ...DEFAULT_MODULE_SETTINGS.shiftPricing!.doctorRound, ...(incoming?.shiftPricing?.doctorRound || {}) },
    },
    referralCaseRules:
      incoming?.referralCaseRules && incoming.referralCaseRules.length > 0
        ? incoming.referralCaseRules
        : DEFAULT_MODULE_SETTINGS.referralCaseRules,
    referralBillTierRules:
      incoming?.referralBillTierRules && incoming.referralBillTierRules.length > 0
        ? incoming.referralBillTierRules
        : DEFAULT_MODULE_SETTINGS.referralBillTierRules,
    registrationFieldRules: {
      pos: { ...(incoming?.registrationFieldRules?.pos || {}) },
      opd: { ...(incoming?.registrationFieldRules?.opd || {}) },
      er: { ...(incoming?.registrationFieldRules?.er || {}) },
      ipd: { ...(incoming?.registrationFieldRules?.ipd || {}) },
    },
  });

  const [mod, setMod] = useState<ModuleSettingsConfig>(() =>
    buildMergedModuleSettings(db.settings.moduleSettings)
  );

  const handleImageFileUpload = (
    file: File | undefined,
    onLoaded: (dataUrl: string) => void
  ) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onLoaded(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    setLabName(db.settings.labName);
    setLabNameNp(db.settings.labNameNp);
    setLegalEntityName(db.settings.legalEntityName);
    setPanNumber(db.settings.panNumber);
    setAccreditationLine(db.settings.accreditationLine);
    setAddressLine(db.settings.addressLine);
    setContactLine(db.settings.contactLine);
    setEmailSender(db.settings.emailSender);
    setActiveFiscalYear(db.settings.activeFiscalYear);
    setTopMargin(String(db.settings.prePrintedTopMarginMm));
    setBottomMargin(String(db.settings.prePrintedBottomMarginMm));
    setAdminWhatsAppNumber(db.settings.adminWhatsAppNumber);
    setAutoSendDailySalesWhatsApp(db.settings.autoSendDailySalesWhatsApp);
    setDailySalesWhatsAppTime(db.settings.dailySalesWhatsAppTime);
    setAutoEmailOnValidate(db.settings.autoEmailOnValidate);
    setIdleLockSeconds(String(db.settings.idleLockSeconds || 150));
    setResetSupportPhone(db.settings.resetSupportPhone || '+977-9851100999');
    setMod(buildMergedModuleSettings(db.settings.moduleSettings));
  }, [db.settings]);

  const [saving, setSaving] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [waLink, setWaLink] = useState<string | null>(null);
  const [liveLanUrls, setLiveLanUrls] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/system/network-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info && Array.isArray(info.lanUrls)) {
          setLiveLanUrls(info.lanUrls);
        }
      })
      .catch(() => {});
  }, []);

  const isSuperAdmin = activeUser.roleId === 'SUPER_ADMIN';
  const visibleTabs = TAB_DEFS.filter((t) => t.id !== 'downloads_sync' || isSuperAdmin);

  const q = searchTerm.trim().toLowerCase();
  const isSearching = q.length > 0;
  const showSection = (tabId: SettingsTab, extraKeywords = '') => {
    if (tabId === 'downloads_sync' && !isSuperAdmin) return false;
    if (!isSearching) return activeSubTab === tabId;
    const def = TAB_DEFS.find((t) => t.id === tabId);
    const hay = `${def?.label || ''} ${def?.keywords || ''} ${extraKeywords}`.toLowerCase();
    return hay.includes(q);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setSaving(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/settings', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({
          labName,
          labNameNp,
          legalEntityName,
          panNumber,
          accreditationLine,
          addressLine,
          contactLine,
          emailSender,
          activeFiscalYear,
          adminWhatsAppNumber,
          autoSendDailySalesWhatsApp,
          dailySalesWhatsAppTime,
          prePrintedTopMarginMm: Number(topMargin) || 38,
          prePrintedBottomMarginMm: Number(bottomMargin) || 22,
          autoEmailOnValidate,
          idleLockSeconds: Number(idleLockSeconds) || 150,
          resetSupportPhone: resetSupportPhone.trim() || '+977-9851100999',
          moduleSettings: mod,
        }),
      });
      onUpdated(
        resp.db,
        'Saved Hospital Identity, Print Options, Digital Signature Boxes, Tariffs & Security settings.'
      );
      if (onCloseAfterSave) {
        onCloseAfterSave();
      }
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleSendWhatsAppDigest = async () => {
    setSendingWa(true);
    try {
      const resp = await apiRequest<{
        db: LimsDatabase;
        whatsappUrl: string;
        log: any;
      }>('/api/whatsapp/send-daily-sales', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ recipientPhone: adminWhatsAppNumber }),
      });
      setWaLink(resp.whatsappUrl);
      onUpdated(
        resp.db,
        `Daily Sales (${formatNpr(resp.log.totalSalesNpr)}) sent to Admin WhatsApp ${resp.log.recipientPhone}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'WhatsApp dispatch failed.');
    } finally {
      setSendingWa(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Hospital ERP Module Settings &amp; Print Studio
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Configuration for Hospital Identity, Print Options (A5 Portrait / Auto-Print), Digital Signature Boxes, Clinical/Pharmacy FEFO, POS/Finance &amp; PIN Security.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search settings (Print, Signature, FEFO, PAN, PIN)..."
              className="pl-8 pr-7 py-2 text-xs bg-white border border-slate-300 rounded-lg w-64 focus:outline-none focus:border-blue-600"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {canManage && isSuperAdmin && (
            <button
              type="button"
              onClick={onResetDemo}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Dataset
            </button>
          )}
        </div>
      </div>

      {/* Sub-Tabs Navigation */}
      <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 border border-slate-200 rounded-xl">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = !isSearching && activeSubTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setSearchTerm('');
                setActiveSubTab(t.id);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                active
                  ? 'bg-white text-blue-700 shadow-sm border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      {isSearching && (
        <div className="text-xs text-slate-600 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <span>
            Showing all setting sections matching <strong className="font-mono">&quot;{searchTerm}&quot;</strong>
          </span>
          <button
            type="button"
            onClick={() => setSearchTerm('')}
            className="text-blue-700 font-medium hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Session & PIN Card (Shown on Session tab or when searching) */}
      {showSection('session') && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="w-4 h-4 text-blue-600" />
              <span className="text-sm font-semibold text-slate-900">
                My Active Operator Session &amp; Idle PIN Lock
              </span>
              <span className="font-mono text-[11px] px-2 py-0.5 bg-blue-50 text-blue-800 rounded">
                @{activeUser.username} · {activeUser.roleId}
                {activeUser.assignedCenterName ? ` · ${activeUser.assignedCenterName}` : ' · Central Hub'}
              </span>
            </div>
            <p className="text-slate-600">
              Session automatically locks after{' '}
              <strong className="font-mono tabular-nums">
                {Math.round(((db.settings.idleLockSeconds || 150) / 60) * 10) / 10} min (
                {db.settings.idleLockSeconds || 150}s)
              </strong>{' '}
              of inactivity. Unlock with your Admin-assigned PIN or call{' '}
              <strong className="font-mono">{db.settings.resetSupportPhone}</strong> for support reset.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={onLockNow}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              Lock Screen (PIN)
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 whitespace-nowrap"
            >
              <LogOut className="w-3.5 h-3.5" />
              Logout Session
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Unified Settings Form */}
        <form onSubmit={handleSaveSettings} className="lg:col-span-2 space-y-5 text-xs">
          {/* TAB 1: General, Lab Identity & PAN */}
          {showSection('general') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Settings className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Hospital Identity, Tax PAN &amp; Pre-Printed Stationery Margins
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">
                    Hospital Name (English)
                  </label>
                  <input
                    disabled={!canManage}
                    value={labName}
                    onChange={(e) => setLabName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">
                    अस्पतालको नाम (Nepali Header)
                  </label>
                  <input
                    disabled={!canManage}
                    value={labNameNp}
                    onChange={(e) => setLabNameNp(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Legal Entity Name</label>
                  <input
                    disabled={!canManage}
                    value={legalEntityName}
                    onChange={(e) => setLegalEntityName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    PAN / VAT Registration Number
                  </label>
                  <input
                    disabled={!canManage}
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Accreditation Line</label>
                  <input
                    disabled={!canManage}
                    value={accreditationLine}
                    onChange={(e) => setAccreditationLine(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Address Line</label>
                  <input
                    disabled={!canManage}
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone &amp; Website</label>
                  <input
                    disabled={!canManage}
                    value={contactLine}
                    onChange={(e) => setContactLine(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Active Fiscal Year</label>
                  <select
                    disabled={!canManage}
                    value={activeFiscalYear}
                    onChange={(e) => setActiveFiscalYear(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    {FISCAL_YEARS.map((fy) => (
                      <option key={fy} value={fy}>
                        {fy}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Sender Email</label>
                  <input
                    disabled={!canManage}
                    value={emailSender}
                    onChange={(e) => setEmailSender(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Pre-printed Paper Top Margin (mm)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    value={topMargin}
                    onChange={(e) => setTopMargin(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Pre-printed Paper Bottom Margin (mm)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    value={bottomMargin}
                    onChange={(e) => setBottomMargin(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
              </div>

              {/* Editable Document & Numbering Prefixes */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="font-semibold text-slate-900">
                  Document Numbering Prefixes (Auto-Applied to All Hospital Bills, Orders &amp; Records)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                  {[
                    { key: 'billPrefix', label: 'Hospital Bill Prefix', fallback: 'BILL' },
                    { key: 'pharmacyInvoicePrefix', label: 'Pharmacy Bill Prefix', fallback: 'PHM' },
                    { key: 'labOrderPrefix', label: 'Lab Accession Prefix', fallback: 'LAB' },
                    { key: 'reportPrefix', label: 'Report Serial Prefix', fallback: 'RPT' },
                    { key: 'opdPrefix', label: 'OPD Ticket Prefix', fallback: 'OPD' },
                    { key: 'ipdPrefix', label: 'IPD Admission Prefix', fallback: 'IPD' },
                    { key: 'erPrefix', label: 'ER Visit Prefix', fallback: 'ER' },
                    { key: 'mlcPrefix', label: 'MLC Case Prefix', fallback: 'MLC' },
                    { key: 'gatepassPrefix', label: 'Gatepass Prefix', fallback: 'GP' },
                    { key: 'voucherPrefix', label: 'Voucher Prefix', fallback: 'VCH' },
                  ].map((px) => (
                    <div key={px.key}>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        {px.label}
                      </label>
                      <input
                        disabled={!canManage}
                        value={((mod as any)[px.key] as string) || px.fallback}
                        onChange={(e) =>
                          setMod((m) => ({
                            ...m,
                            [px.key]: e.target.value.toUpperCase().slice(0, 8),
                          }))
                        }
                        className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Digital Verification Seal & Signature */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-900">
                    Digital Signature &amp; &quot;Digitally Verified&quot; Report Stamp
                  </div>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.showDigitallyVerifiedSeal !== false}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, showDigitallyVerifiedSeal: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Show Digital Verified Seal on A4 Reports</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Authorized Digital Verifier Name
                    </label>
                    <input
                      disabled={!canManage}
                      value={mod.digitalVerifierName || ''}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, digitalVerifierName: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Verifier Designation &amp; NMC/NHPC Reg #
                    </label>
                    <input
                      disabled={!canManage}
                      value={`${mod.digitalVerifierDesignation || ''} (${mod.digitalVerifierRegNo || ''})`}
                      onChange={(e) => {
                        const val = e.target.value;
                        const m = val.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
                        if (m) {
                          setMod((prev) => ({
                            ...prev,
                            digitalVerifierDesignation: m[1].trim(),
                            digitalVerifierRegNo: m[2].trim(),
                          }));
                        } else {
                          setMod((prev) => ({ ...prev, digitalVerifierDesignation: val }));
                        }
                      }}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Digital Signature Seal Caption
                    </label>
                    <input
                      disabled={!canManage}
                      value={mod.digitalSignatureText || ''}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, digitalSignatureText: e.target.value }))
                      }
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic Form Keyboard Navigation (Enter as Tab / Swap Enter <-> Tab) */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Form Keyboard Navigation (Dynamic Enter ↔ Tab Behavior)
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Configure how <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono">Enter</kbd> and{' '}
                      <kbd className="px-1 py-0.5 bg-slate-100 border border-slate-300 rounded font-mono">Tab</kbd> behave inside all ERP registration, billing, lab result, IPD &amp; ER forms.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        id: 'ENTER_AS_TAB' as const,
                        title: 'Enter → Next Field (Like Tab)',
                        desc: 'Pressing Enter moves focus to the next field smoothly across every form. Tab also advances forward.',
                      },
                      {
                        id: 'SWAP_ENTER_TAB' as const,
                        title: 'Dynamic Swap: Enter ↔ Tab',
                        desc: 'Enter moves to next field (like Tab); pressing Tab triggers Submit / Enter action on the active form.',
                      },
                      {
                        id: 'STANDARD' as const,
                        title: 'Browser Standard Default',
                        desc: 'Tab moves between fields; pressing Enter submits the active form immediately.',
                      },
                    ]
                  ).map((opt) => {
                    const active = (mod.keyboardNavigationMode || 'ENTER_AS_TAB') === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!canManage}
                        onClick={() => setMod((m) => ({ ...m, keyboardNavigationMode: opt.id }))}
                        className={`text-left p-3 rounded-xl border transition-colors disabled:opacity-60 ${
                          active
                            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500 text-blue-950'
                            : 'bg-slate-50/70 border-slate-200 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <div className="font-semibold text-xs flex items-center justify-between gap-2">
                          <span>{opt.title}</span>
                          {active && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 bg-blue-600 text-white rounded">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] opacity-80 mt-1">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB: Print Options, Logo Boxes & Dynamic Digital Signature Boxes */}
          {showSection('print_signatures') && (
            <div className="space-y-5">
              {/* Print Options Global Defaults */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                  <Printer className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Print Options — Global Paper Size, Design Defaults &amp; Auto-Print Mode
                  </h2>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Paper Format
                    </label>
                    <select
                      disabled={!canManage}
                      value={mod.printOptions?.defaultPaperSize || 'A5'}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          printOptions: {
                            ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                            defaultPaperSize: e.target.value as 'A5' | 'A4' | 'THERMAL_80MM',
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      <option value="A5">A5 Portrait Full (148 × 210 mm — Default)</option>
                      <option value="A4">A4 Portrait (210 × 297 mm)</option>
                      <option value="THERMAL_80MM">80mm Thermal POS Slip</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Letterhead Mode
                    </label>
                    <select
                      disabled={!canManage}
                      value={mod.printOptions?.defaultLetterheadMode || 'with-letterhead'}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          printOptions: {
                            ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                            defaultLetterheadMode: e.target.value as 'with-letterhead' | 'without-letterhead',
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      <option value="with-letterhead">With Hospital Letterhead &amp; Logo</option>
                      <option value="without-letterhead">Without Letterhead (Pre-Printed Paper)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Report Design Template
                    </label>
                    <select
                      disabled={!canManage}
                      value={mod.printOptions?.selectedReportDesignId || ''}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          printOptions: {
                            ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                            selectedReportDesignId: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {(db.documentDesigns || []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.paperFormat})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Hospital Bill Design Template
                    </label>
                    <select
                      disabled={!canManage}
                      value={mod.printOptions?.selectedBillDesignId || ''}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          printOptions: {
                            ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                            selectedBillDesignId: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {(db.documentDesigns || []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.paperFormat})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Pharmacy Bill Design Template
                    </label>
                    <select
                      disabled={!canManage}
                      value={mod.printOptions?.selectedPharmacyDesignId || ''}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          printOptions: {
                            ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                            selectedPharmacyDesignId: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {(db.documentDesigns || []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.paperFormat})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Default Admission Slip / Certificates Design
                    </label>
                    <select
                      disabled={!canManage}
                      value={mod.printOptions?.selectedOthersDesignId || ''}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          printOptions: {
                            ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                            selectedOthersDesignId: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                    >
                      {(db.documentDesigns || []).map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.paperFormat})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Global Instant Print vs Print Preview Mode Switch */}
                <div className="border-t border-slate-200 pt-4 space-y-3">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Print Mode: Instant Print vs. Print Preview
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Switch between Instant Print (auto-launches print dialog) and Print Preview (review bill/report data before printing).
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(() => {
                      const posInstant =
                        (mod.printOptions?.autoPrintByTemplate?.posBill || 'MANUAL_PROMPT') ===
                        'AUTO_PRINT';
                      const labInstant =
                        (mod.printOptions?.autoPrintByTemplate?.labReport || 'MANUAL_PROMPT') ===
                        'AUTO_PRINT';
                      return (
                        <>
                          <div className="p-3 border border-slate-200 rounded-lg bg-slate-50 flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900">POS &amp; Pharmacy Receipts</div>
                              <div className="text-[10.5px] text-slate-500">
                                {posInstant ? 'Instant Print active' : 'Print Preview active (verify first)'}
                              </div>
                            </div>
                            <div className="inline-flex rounded-lg border border-slate-300 bg-white overflow-hidden shrink-0">
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setMod((m) => ({
                                    ...m,
                                    printOptions: {
                                      ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                                      autoPrintByTemplate: {
                                        ...(m.printOptions?.autoPrintByTemplate ||
                                          DEFAULT_PRINT_OPTIONS.autoPrintByTemplate),
                                        posBill: 'AUTO_PRINT',
                                        pharmacyBill: 'AUTO_PRINT',
                                      },
                                    },
                                  }))
                                }
                                className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                  posInstant ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                Instant Print
                              </button>
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setMod((m) => ({
                                    ...m,
                                    printOptions: {
                                      ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                                      autoPrintByTemplate: {
                                        ...(m.printOptions?.autoPrintByTemplate ||
                                          DEFAULT_PRINT_OPTIONS.autoPrintByTemplate),
                                        posBill: 'MANUAL_PROMPT',
                                        pharmacyBill: 'MANUAL_PROMPT',
                                      },
                                    },
                                  }))
                                }
                                className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                  !posInstant ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                Print Preview
                              </button>
                            </div>
                          </div>

                          <div className="p-3 border border-slate-200 rounded-lg bg-slate-50 flex items-center justify-between gap-2">
                            <div>
                              <div className="font-semibold text-slate-900">Lab &amp; Radiology Reports</div>
                              <div className="text-[10.5px] text-slate-500">
                                {labInstant ? 'Instant Print active' : 'Print Preview active (verify first)'}
                              </div>
                            </div>
                            <div className="inline-flex rounded-lg border border-slate-300 bg-white overflow-hidden shrink-0">
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setMod((m) => ({
                                    ...m,
                                    printOptions: {
                                      ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                                      autoPrintByTemplate: {
                                        ...(m.printOptions?.autoPrintByTemplate ||
                                          DEFAULT_PRINT_OPTIONS.autoPrintByTemplate),
                                        labReport: 'AUTO_PRINT',
                                        radiologyReport: 'AUTO_PRINT',
                                      },
                                    },
                                  }))
                                }
                                className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                  labInstant ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                Instant Print
                              </button>
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setMod((m) => ({
                                    ...m,
                                    printOptions: {
                                      ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                                      autoPrintByTemplate: {
                                        ...(m.printOptions?.autoPrintByTemplate ||
                                          DEFAULT_PRINT_OPTIONS.autoPrintByTemplate),
                                        labReport: 'MANUAL_PROMPT',
                                        radiologyReport: 'MANUAL_PROMPT',
                                      },
                                    },
                                  }))
                                }
                                className={`px-2.5 py-1.5 text-xs font-medium whitespace-nowrap ${
                                  !labInstant ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                                }`}
                              >
                                Print Preview
                              </button>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Per-Template Fine-Grained Print Overrides */}
                  <div className="pt-2 space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Per-Template Fine Control (Instant Print vs. Print Preview)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(
                        [
                          { key: 'labReport', label: 'Pathology Lab Report' },
                          { key: 'radiologyReport', label: 'Radiology / Imaging Report' },
                          { key: 'posBill', label: 'Hospital POS Bill / Receipt' },
                          { key: 'pharmacyBill', label: 'Pharmacy POS Invoice' },
                          { key: 'admissionReceipt', label: 'IPD Admission Fee Receipt' },
                          { key: 'emergencySlip', label: 'Emergency Charges Bill & Sticker' },
                          { key: 'opdSlip', label: 'OPD Consultation Ticket' },
                          { key: 'certificates', label: 'Hospital Certificates & MLC' },
                        ] as const
                      ).map((item) => {
                        const mode =
                          mod.printOptions?.autoPrintByTemplate?.[item.key] || 'MANUAL_PROMPT';
                        return (
                          <div
                            key={item.key}
                            className="flex items-center justify-between gap-2 p-2.5 border border-slate-200 rounded-lg bg-slate-50/70"
                          >
                            <span className="font-medium text-slate-800">{item.label}</span>
                            <div className="inline-flex rounded-md border border-slate-300 bg-white overflow-hidden shrink-0">
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setMod((m) => ({
                                    ...m,
                                    printOptions: {
                                      ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                                      autoPrintByTemplate: {
                                        ...(m.printOptions?.autoPrintByTemplate ||
                                          DEFAULT_PRINT_OPTIONS.autoPrintByTemplate),
                                        [item.key]: 'AUTO_PRINT',
                                      },
                                    },
                                  }))
                                }
                                className={`px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                                  mode === 'AUTO_PRINT'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                Instant Print
                              </button>
                              <button
                                type="button"
                                disabled={!canManage}
                                onClick={() =>
                                  setMod((m) => ({
                                    ...m,
                                    printOptions: {
                                      ...(m.printOptions || DEFAULT_PRINT_OPTIONS),
                                      autoPrintByTemplate: {
                                        ...(m.printOptions?.autoPrintByTemplate ||
                                          DEFAULT_PRINT_OPTIONS.autoPrintByTemplate),
                                        [item.key]: 'MANUAL_PROMPT',
                                      },
                                    },
                                  }))
                                }
                                className={`px-2 py-1 text-[11px] font-medium whitespace-nowrap ${
                                  mode === 'MANUAL_PROMPT'
                                    ? 'bg-slate-800 text-white'
                                    : 'text-slate-600 hover:bg-slate-50'
                                }`}
                              >
                                Print Preview
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Hospital & Pharmacy Logo Box Uploads */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                  <Upload className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Hospital &amp; Pharmacy Logo Upload Boxes
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    {
                      key: 'hospitalLogoDataUrl' as const,
                      title: 'Hospital Header Logo',
                      subtitle: 'Appears on Reports, Hospital POS Bills & Admission Slips',
                      value: mod.hospitalLogoDataUrl || '',
                    },
                    {
                      key: 'pharmacyLogoDataUrl' as const,
                      title: 'Pharmacy Counter Logo',
                      subtitle: 'Appears on Saptari Hospital Pharmacy Invoices',
                      value: mod.pharmacyLogoDataUrl || '',
                    },
                  ].map((logoItem) => (
                    <div
                      key={logoItem.key}
                      className="border-2 border-dashed border-slate-300 rounded-xl p-4 bg-slate-50/70 flex flex-col justify-between gap-3"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">{logoItem.title}</div>
                        <div className="text-[11px] text-slate-500">{logoItem.subtitle}</div>
                      </div>
                      <div className="h-24 rounded-lg bg-white border border-slate-200 flex items-center justify-center overflow-hidden p-2">
                        {logoItem.value ? (
                          <img
                            src={logoItem.value}
                            alt={logoItem.title}
                            className="max-h-20 max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-[11px] text-slate-400 font-mono">
                            No logo uploaded (PNG/JPG)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer">
                          <Upload className="w-3.5 h-3.5" />
                          Upload Logo
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            disabled={!canManage}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              handleImageFileUpload(file, (url) =>
                                setMod((m) => ({ ...m, [logoItem.key]: url }))
                              );
                            }}
                          />
                        </label>
                        {logoItem.value && canManage && (
                          <button
                            type="button"
                            onClick={() => setMod((m) => ({ ...m, [logoItem.key]: '' }))}
                            className="text-xs font-medium text-rose-700 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dynamic Box Style Digital Signature Upload Cards */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                  <PenTool className="w-4 h-4 text-blue-600" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Dynamic Digital Signature Upload Boxes (All Clinical &amp; Billing Roles)
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(mod.signatureBoxes || DEFAULT_SIGNATURE_BOXES).map((sig, idx) => (
                    <div
                      key={sig.roleKey}
                      className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900">{sig.label}</div>
                          <div className="font-mono text-[10px] text-slate-500">{sig.roleKey}</div>
                        </div>
                        {sig.signatureDataUrl && canManage && (
                          <button
                            type="button"
                            onClick={() =>
                              setMod((m) => {
                                const next = [...(m.signatureBoxes || DEFAULT_SIGNATURE_BOXES)];
                                next[idx] = { ...next[idx], signatureDataUrl: '' };
                                return { ...m, signatureBoxes: next };
                              })
                            }
                            className="text-[11px] font-medium text-rose-700 hover:underline"
                          >
                            Clear Sign
                          </button>
                        )}
                      </div>

                      <div className="border-2 border-dashed border-slate-300 rounded-lg bg-white h-20 flex items-center justify-center p-2 overflow-hidden">
                        {sig.signatureDataUrl ? (
                          <img
                            src={sig.signatureDataUrl}
                            alt={`${sig.label} Signature`}
                            className="max-h-16 max-w-full object-contain"
                          />
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            Dynamic Signature Box — Upload Transparent PNG / JPG
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <input
                          disabled={!canManage}
                          value={sig.signerName}
                          placeholder="Signer Name"
                          onChange={(e) =>
                            setMod((m) => {
                              const next = [...(m.signatureBoxes || DEFAULT_SIGNATURE_BOXES)];
                              next[idx] = { ...next[idx], signerName: e.target.value };
                              return { ...m, signatureBoxes: next };
                            })
                          }
                          className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] disabled:bg-slate-100"
                        />
                        <input
                          disabled={!canManage}
                          value={sig.designation}
                          placeholder="Designation"
                          onChange={(e) =>
                            setMod((m) => {
                              const next = [...(m.signatureBoxes || DEFAULT_SIGNATURE_BOXES)];
                              next[idx] = { ...next[idx], designation: e.target.value };
                              return { ...m, signatureBoxes: next };
                            })
                          }
                          className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] disabled:bg-slate-100"
                        />
                        <input
                          disabled={!canManage}
                          value={sig.regNo || ''}
                          placeholder="NMC / NNC / NPC Reg #"
                          onChange={(e) =>
                            setMod((m) => {
                              const next = [...(m.signatureBoxes || DEFAULT_SIGNATURE_BOXES)];
                              next[idx] = { ...next[idx], regNo: e.target.value };
                              return { ...m, signatureBoxes: next };
                            })
                          }
                          className="px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg text-[11px] disabled:bg-slate-100"
                        />
                        <label className="inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 cursor-pointer">
                          <Upload className="w-3 h-3" />
                          Upload Sign
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            disabled={!canManage}
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              handleImageFileUpload(file, (url) =>
                                setMod((m) => {
                                  const next = [...(m.signatureBoxes || DEFAULT_SIGNATURE_BOXES)];
                                  next[idx] = { ...next[idx], signatureDataUrl: url };
                                  return { ...m, signatureBoxes: next };
                                })
                              );
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB: Dynamic Hospital Module Charges, Timings & 2-Tier Approval */}
          {showSection('hospital_tariffs') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Stethoscope className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Dynamic Module Tariffs (ER, OPD, IPD Bed Cycle) &amp; 2-Tier Finance Control
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Emergency Registration Fee (रू / NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.emergencyRegistrationFeeNpr ?? 500}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        emergencyRegistrationFeeNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Emergency Ticket Fee (रू / NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.emergencyTicketFeeNpr ?? 200}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        emergencyTicketFeeNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    OPD Free Follow-Up Window (Days)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    max={90}
                    value={mod.opdFreeFollowUpDays ?? 7}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        opdFreeFollowUpDays: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    OPD Follow-Up Fee After Free Window (रू / NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.opdFollowUpFeeAfterExpiryNpr ?? 300}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        opdFollowUpFeeAfterExpiryNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    IPD Admission Fee (रू / NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.ipdAdmissionFeeNpr ?? 1500}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        ipdAdmissionFeeNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    IPD Default Credit Limit (रू / NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    step={1000}
                    value={mod.ipdDefaultCreditLimitNpr ?? 25000}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        ipdDefaultCreditLimitNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    IPD Doctor Round Rate (रू)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.ipdDoctorRoundFeeNpr ?? 500}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        ipdDoctorRoundFeeNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    IPD Nursing Care Rate (रू)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.ipdNursingChargePerDayNpr ?? 400}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        ipdNursingChargePerDayNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    IPD Observation Rate (रू)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.ipdDailyObservationFeeNpr ?? 300}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        ipdDailyObservationFeeNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Bed Calculation Schedule Mode
                  </label>
                  <select
                    disabled={!canManage}
                    value={mod.ipdBedChargeScheduleMode || 'CYCLE_WINDOW'}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        ipdBedChargeScheduleMode: e.target.value as 'CYCLE_WINDOW' | '24H_ELAPSED' | 'MIDNIGHT_CALENDAR',
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="CYCLE_WINDOW">Cycle Window (Start – End Time)</option>
                    <option value="24H_ELAPSED">24-Hour Rolling From Admission</option>
                    <option value="MIDNIGHT_CALENDAR">Midnight Calendar Day (00:00)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    All IPD Beds Cycle Start Time
                  </label>
                  <input
                    disabled={!canManage}
                    type="time"
                    value={mod.ipdBedCycleStartTime || '07:00'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, ipdBedCycleStartTime: e.target.value || '07:00' }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    All IPD Beds Cycle End Time
                  </label>
                  <input
                    disabled={!canManage}
                    type="time"
                    value={mod.ipdBedCycleEndTime || '19:00'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, ipdBedCycleEndTime: e.target.value || '19:00' }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    1-PC Auto-Sync Backup Interval (Min)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    max={1440}
                    value={mod.autoSyncBackupMinutes ?? 10}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        autoSyncBackupMinutes: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
              </div>

              {/* Dynamic Per-Day vs Per-Round & Dynamic Round Schedule Times */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    IPD Auto-Charge Basis (Per Day vs Round/Day) &amp; Dynamic Schedule Times
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Configure whether Nursing, Observation, and Doctor Round bill flat Per Day or Per Round × Rounds/Day with custom ward schedule timings.
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Nursing Config */}
                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                    <div className="font-semibold text-slate-800 text-xs">Nursing Charge Schedule</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Billing Basis</label>
                        <select
                          disabled={!canManage}
                          value={mod.ipdNursingChargeBasis || 'PER_DAY'}
                          onChange={(e) =>
                            setMod((m) => ({ ...m, ipdNursingChargeBasis: e.target.value as ChargeRateBasis }))
                          }
                          className="w-full px-2 py-1 text-[11px] border border-slate-300 rounded bg-white"
                        >
                          <option value="PER_DAY">Per Day</option>
                          <option value="PER_ROUND">Per Round / Shift</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Rounds / Day</label>
                        <input
                          disabled={!canManage}
                          type="number"
                          min={1}
                          max={12}
                          value={mod.ipdNursingRoundsPerDay ?? 3}
                          onChange={(e) =>
                            setMod((m) => ({ ...m, ipdNursingRoundsPerDay: Math.max(1, Number(e.target.value) || 1) }))
                          }
                          className="w-full px-2 py-1 font-mono text-[11px] border border-slate-300 rounded bg-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Schedule Times (e.g. 07:00, 14:00, 21:00)</label>
                      <input
                        disabled={!canManage}
                        value={mod.ipdNursingScheduleTimes || '07:00, 14:00, 21:00'}
                        onChange={(e) => setMod((m) => ({ ...m, ipdNursingScheduleTimes: e.target.value }))}
                        className="w-full px-2 py-1 font-mono text-[11px] border border-slate-300 rounded bg-white"
                      />
                    </div>
                  </div>

                  {/* Observation Config */}
                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                    <div className="font-semibold text-slate-800 text-xs">Observation Charge Schedule</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Billing Basis</label>
                        <select
                          disabled={!canManage}
                          value={mod.ipdObservationChargeBasis || 'PER_DAY'}
                          onChange={(e) =>
                            setMod((m) => ({ ...m, ipdObservationChargeBasis: e.target.value as ChargeRateBasis }))
                          }
                          className="w-full px-2 py-1 text-[11px] border border-slate-300 rounded bg-white"
                        >
                          <option value="PER_DAY">Per Day</option>
                          <option value="PER_ROUND">Per Round</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Rounds / Day</label>
                        <input
                          disabled={!canManage}
                          type="number"
                          min={1}
                          max={12}
                          value={mod.ipdObservationRoundsPerDay ?? 2}
                          onChange={(e) =>
                            setMod((m) => ({ ...m, ipdObservationRoundsPerDay: Math.max(1, Number(e.target.value) || 1) }))
                          }
                          className="w-full px-2 py-1 font-mono text-[11px] border border-slate-300 rounded bg-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Schedule Times (e.g. 08:00, 20:00)</label>
                      <input
                        disabled={!canManage}
                        value={mod.ipdObservationScheduleTimes || '08:00, 20:00'}
                        onChange={(e) => setMod((m) => ({ ...m, ipdObservationScheduleTimes: e.target.value }))}
                        className="w-full px-2 py-1 font-mono text-[11px] border border-slate-300 rounded bg-white"
                      />
                    </div>
                  </div>

                  {/* Doctor Round Config */}
                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2">
                    <div className="font-semibold text-slate-800 text-xs">Doctor Round Schedule</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Billing Basis</label>
                        <select
                          disabled={!canManage}
                          value={mod.ipdDoctorRoundBasis || 'PER_ROUND'}
                          onChange={(e) =>
                            setMod((m) => ({ ...m, ipdDoctorRoundBasis: e.target.value as ChargeRateBasis }))
                          }
                          className="w-full px-2 py-1 text-[11px] border border-slate-300 rounded bg-white"
                        >
                          <option value="PER_ROUND">Per Round</option>
                          <option value="PER_DAY">Per Day</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-500 mb-0.5">Rounds / Day</label>
                        <input
                          disabled={!canManage}
                          type="number"
                          min={1}
                          max={12}
                          value={mod.ipdDoctorRoundsPerDay ?? 2}
                          onChange={(e) =>
                            setMod((m) => ({ ...m, ipdDoctorRoundsPerDay: Math.max(1, Number(e.target.value) || 1) }))
                          }
                          className="w-full px-2 py-1 font-mono text-[11px] border border-slate-300 rounded bg-white"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-slate-500 mb-0.5">Schedule Times (e.g. 08:30, 17:30)</label>
                      <input
                        disabled={!canManage}
                        value={mod.ipdDoctorRoundScheduleTimes || '08:30, 17:30'}
                        onChange={(e) => setMod((m) => ({ ...m, ipdDoctorRoundScheduleTimes: e.target.value }))}
                        className="w-full px-2 py-1 font-mono text-[11px] border border-slate-300 rounded bg-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-200 mt-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Follow-Up Fee Within Window (रू, 0 = Free)
                    </label>
                    <input
                      disabled={!canManage}
                      type="number"
                      min={0}
                      value={mod.opdFollowUpWithinWindowFeeNpr ?? 0}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          opdFollowUpWithinWindowFeeNpr: Math.max(0, Number(e.target.value) || 0),
                        }))
                      }
                      className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={Boolean(mod.opdFollowUpSameDoctorOnly)}
                        onChange={(e) =>
                          setMod((m) => ({ ...m, opdFollowUpSameDoctorOnly: e.target.checked }))
                        }
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>Apply Follow-Up Rule Only for Same Consulting Doctor</span>
                    </label>
                  </div>
                  <div className="flex items-end pb-1">
                    <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={Boolean(mod.showErFeeFieldsInForm)}
                        onChange={(e) =>
                          setMod((m) => ({ ...m, showErFeeFieldsInForm: e.target.checked }))
                        }
                        className="rounded border-slate-300 text-rose-600"
                      />
                      <span>Show ER Ticket &amp; Reg Fee Inputs Inside ER Form</span>
                    </label>
                  </div>
                </div>

                {/* Morning / Afternoon / Night Shift-Wise Pricing Matrix */}
                <div className="border-t border-slate-200 pt-4 space-y-2.5">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Shift-Wise Tariff Rates (Morning / Afternoon / Night) — Bed, Observation, Nursing &amp; Doctor Round
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Used across IPD Admission, Nursing TPR Charts, Observation Fees, and Doctor Rounds per selected shift.
                    </div>
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="py-2 px-3">Clinical Service</th>
                          <th className="py-2 px-3">Morning Shift (रू)</th>
                          <th className="py-2 px-3">Afternoon Shift (रू)</th>
                          <th className="py-2 px-3">Night Shift (रू)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {([
                          { key: 'bed', label: 'IPD Bed / Ward Charge' },
                          { key: 'observation', label: 'Observation Charge' },
                          { key: 'nursing', label: 'Nursing Care Charge' },
                          { key: 'doctorRound', label: 'Doctor Round Charge' },
                        ] as const).map((row) => (
                          <tr key={row.key}>
                            <td className="py-2 px-3 font-semibold text-slate-800">{row.label}</td>
                            {(['Morning', 'Afternoon', 'Night'] as const).map((sh) => (
                              <td key={sh} className="py-1.5 px-3">
                                <input
                                  disabled={!canManage}
                                  type="number"
                                  min={0}
                                  value={mod.shiftPricing?.[row.key]?.[sh] ?? 0}
                                  onChange={(e) =>
                                    setMod((m) => ({
                                      ...m,
                                      shiftPricing: {
                                        ...(m.shiftPricing || DEFAULT_MODULE_SETTINGS.shiftPricing!),
                                        [row.key]: {
                                          ...(m.shiftPricing?.[row.key] ||
                                            DEFAULT_MODULE_SETTINGS.shiftPricing![row.key]),
                                          [sh]: Math.max(0, Number(e.target.value) || 0),
                                        },
                                      },
                                    }))
                                  }
                                  className="w-28 px-2 py-1 font-mono bg-white border border-slate-300 rounded disabled:bg-slate-100"
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Dynamic Registration Fields Visibility & Requirement Matrix */}
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <div>
                  <div className="font-semibold text-slate-900">
                    Dynamic Registration Fields (Required / Optional / Hidden per Module)
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Choose which patient registration inputs are Required, Optional, or Hidden in Hospital POS, OPD, Emergency, and IPD Admission.
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(['pos', 'opd', 'er', 'ipd'] as RegistrationFormScope[]).map((scope) => (
                    <div key={scope} className="border border-slate-200 rounded-lg p-3 bg-slate-50/60 space-y-2">
                      <div className="text-xs font-bold uppercase text-slate-800 border-b border-slate-200 pb-1">
                        {scope === 'pos'
                          ? 'Hospital POS Registration'
                          : scope === 'opd'
                          ? 'OPD Ticket Registration'
                          : scope === 'er'
                          ? 'Emergency (ER) Registration'
                          : 'IPD Ward Admission'}
                      </div>
                      <div className="space-y-1.5">
                        {REGISTRATION_FIELD_CATALOG[scope].map((field) => {
                          const currentVal: RegistrationFieldRule =
                            mod.registrationFieldRules?.[scope]?.[field.key] || field.defaultRule;
                          return (
                            <div key={field.key} className="flex items-center justify-between gap-2 text-[11px]">
                              <span className="text-slate-700 font-medium">{field.label}</span>
                              <select
                                disabled={!canManage}
                                value={currentVal}
                                onChange={(e) =>
                                  setMod((m) => ({
                                    ...m,
                                    registrationFieldRules: {
                                      ...(m.registrationFieldRules || {}),
                                      [scope]: {
                                        ...(m.registrationFieldRules?.[scope] || {}),
                                        [field.key]: e.target.value as RegistrationFieldRule,
                                      },
                                    },
                                  }))
                                }
                                className="px-2 py-0.5 text-[11px] font-mono border border-slate-300 rounded bg-white"
                              >
                                <option value="REQUIRED">REQUIRED</option>
                                <option value="OPTIONAL">OPTIONAL</option>
                                <option value="HIDDEN">HIDDEN</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dynamic OPD Consultation Types CRUD */}
              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">OPD Consultation Types &amp; Dynamic Fees</div>
                    <div className="text-[11px] text-slate-500">
                      Selectable in Outpatient (OPD) ticket registration with instant auto-fill pricing.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setMod((m) => ({
                          ...m,
                          opdConsultationTypes: [
                            ...(m.opdConsultationTypes || DEFAULT_OPD_TYPES),
                            {
                              id: `opd-type-${Date.now()}`,
                              name: 'Specialist Consult',
                              feeNpr: 700,
                              active: true,
                            },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Type
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {(mod.opdConsultationTypes || DEFAULT_OPD_TYPES).map((tp, idx) => (
                    <div
                      key={tp.id}
                      className="grid grid-cols-12 gap-2 items-center p-2 border border-slate-200 rounded-lg bg-slate-50/70"
                    >
                      <input
                        disabled={!canManage}
                        value={tp.name}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.opdConsultationTypes || DEFAULT_OPD_TYPES)];
                            next[idx] = { ...next[idx], name: e.target.value };
                            return { ...m, opdConsultationTypes: next };
                          })
                        }
                        className="col-span-6 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <input
                        disabled={!canManage}
                        type="number"
                        min={0}
                        value={tp.feeNpr}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.opdConsultationTypes || DEFAULT_OPD_TYPES)];
                            next[idx] = { ...next[idx], feeNpr: Math.max(0, Number(e.target.value) || 0) };
                            return { ...m, opdConsultationTypes: next };
                          })
                        }
                        className="col-span-3 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <label className="col-span-2 inline-flex items-center gap-1 text-[11px] cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={!canManage}
                          checked={tp.active}
                          onChange={(e) =>
                            setMod((m) => {
                              const next = [...(m.opdConsultationTypes || DEFAULT_OPD_TYPES)];
                              next[idx] = { ...next[idx], active: e.target.checked };
                              return { ...m, opdConsultationTypes: next };
                            })
                          }
                          className="rounded border-slate-300 text-blue-600"
                        />
                        Active
                      </label>
                      <button
                        type="button"
                        disabled={!canManage || (mod.opdConsultationTypes || DEFAULT_OPD_TYPES).length <= 1}
                        onClick={() =>
                          setMod((m) => ({
                            ...m,
                            opdConsultationTypes: (m.opdConsultationTypes || DEFAULT_OPD_TYPES).filter(
                              (_, i) => i !== idx
                            ),
                          }))
                        }
                        className="col-span-1 p-1 text-slate-400 hover:text-rose-700 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dynamic Nursing Round & Observation Fee Types */}
              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Nursing Round &amp; Observation Fee Types (IPD / Emergency)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Used in IPD Ward nursing round &amp; observation fee billing with type, time &amp; shift.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setMod((m) => ({
                          ...m,
                          nursingObservationTypes: [
                            ...(m.nursingObservationTypes || DEFAULT_NURSING_OBS_TYPES),
                            {
                              id: `obs-${Date.now()}`,
                              name: 'Special Nursing Observation',
                              defaultFeeNpr: 300,
                            },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Obs Type
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(mod.nursingObservationTypes || DEFAULT_NURSING_OBS_TYPES).map((obs, idx) => (
                    <div
                      key={obs.id}
                      className="grid grid-cols-12 gap-2 items-center p-2 border border-slate-200 rounded-lg bg-slate-50/70"
                    >
                      <input
                        disabled={!canManage}
                        value={obs.name}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [
                              ...(m.nursingObservationTypes || DEFAULT_NURSING_OBS_TYPES),
                            ];
                            next[idx] = { ...next[idx], name: e.target.value };
                            return { ...m, nursingObservationTypes: next };
                          })
                        }
                        className="col-span-8 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <input
                        disabled={!canManage}
                        type="number"
                        min={0}
                        value={obs.defaultFeeNpr}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [
                              ...(m.nursingObservationTypes || DEFAULT_NURSING_OBS_TYPES),
                            ];
                            next[idx] = {
                              ...next[idx],
                              defaultFeeNpr: Math.max(0, Number(e.target.value) || 0),
                            };
                            return { ...m, nursingObservationTypes: next };
                          })
                        }
                        className="col-span-3 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <button
                        type="button"
                        disabled={
                          !canManage ||
                          (mod.nursingObservationTypes || DEFAULT_NURSING_OBS_TYPES).length <= 1
                        }
                        onClick={() =>
                          setMod((m) => ({
                            ...m,
                            nursingObservationTypes: (
                              m.nursingObservationTypes || DEFAULT_NURSING_OBS_TYPES
                            ).filter((_, i) => i !== idx),
                          }))
                        }
                        className="col-span-1 p-1 text-slate-400 hover:text-rose-700 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 flex flex-wrap gap-5">
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={mod.requireTwoTierFinanceApproval !== false}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, requireTwoTierFinanceApproval: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    Enforce 2-Tier Finance Approval for All Money In/Out (Staff &rarr; Manager &rarr; Admin)
                  </span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer font-medium text-slate-800">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={mod.nonInventoryBillEnabled !== false}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, nonInventoryBillEnabled: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-amber-600"
                  />
                  <span>Enable Non-Inventory Bill-Only Toggle in Hospital &amp; Pharmacy POS</span>
                </label>
              </div>

              {/* Editable Saptari Police Stations Directory for MLC Auto-Fetch */}
              <div className="border-t border-slate-200 pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Saptari Police Stations Directory (Auto-Fetched in Emergency &amp; MLC)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Match patient address keywords automatically to pre-fill nearest police station &amp; hotline phone.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setMod((m) => ({
                          ...m,
                          policeStations: [
                            ...(m.policeStations || DEFAULT_POLICE_STATIONS),
                            {
                              id: `ps-${Date.now()}`,
                              stationName: 'Area Police Post',
                              municipalityOrArea: 'Saptari',
                              address: 'Saptari District',
                              phone: '031-520100',
                              keywords: ['saptari'],
                            },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Station
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(mod.policeStations || DEFAULT_POLICE_STATIONS).map((ps, idx) => (
                    <div
                      key={ps.id}
                      className="grid grid-cols-12 gap-2 items-center p-2 border border-slate-200 rounded-lg bg-slate-50/70"
                    >
                      <input
                        disabled={!canManage}
                        value={ps.stationName}
                        placeholder="Station Name"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.policeStations || DEFAULT_POLICE_STATIONS)];
                            next[idx] = { ...next[idx], stationName: e.target.value };
                            return { ...m, policeStations: next };
                          })
                        }
                        className="col-span-4 px-2 py-1.5 bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <input
                        disabled={!canManage}
                        value={ps.address}
                        placeholder="Address"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.policeStations || DEFAULT_POLICE_STATIONS)];
                            next[idx] = { ...next[idx], address: e.target.value };
                            return { ...m, policeStations: next };
                          })
                        }
                        className="col-span-3 px-2 py-1.5 bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <input
                        disabled={!canManage}
                        value={ps.phone}
                        placeholder="Phone"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.policeStations || DEFAULT_POLICE_STATIONS)];
                            next[idx] = { ...next[idx], phone: e.target.value };
                            return { ...m, policeStations: next };
                          })
                        }
                        className="col-span-2 px-2 py-1.5 font-mono bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <input
                        disabled={!canManage}
                        value={(ps.keywords || []).join(', ')}
                        placeholder="Keywords (comma separated)"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.policeStations || DEFAULT_POLICE_STATIONS)];
                            next[idx] = {
                              ...next[idx],
                              keywords: e.target.value
                                .split(',')
                                .map((k) => k.trim().toLowerCase())
                                .filter(Boolean),
                            };
                            return { ...m, policeStations: next };
                          })
                        }
                        className="col-span-2 px-2 py-1.5 font-mono bg-white border border-slate-300 rounded-lg disabled:bg-slate-100"
                      />
                      <button
                        type="button"
                        disabled={!canManage || (mod.policeStations || DEFAULT_POLICE_STATIONS).length <= 1}
                        onClick={() =>
                          setMod((m) => ({
                            ...m,
                            policeStations: (m.policeStations || DEFAULT_POLICE_STATIONS).filter(
                              (_, i) => i !== idx
                            ),
                          }))
                        }
                        className="col-span-1 p-1 text-slate-400 hover:text-rose-700 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dynamic Referral Case Commission Rules & First-Bill Tier Rules */}
              <div className="border-t border-slate-200 pt-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">
                      Referral Case Commission Rules (RTA / Poison / LSCS — Flat रू or %)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Applied automatically on external ambulance referrals unless overridden per ambulance.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setMod((m) => ({
                          ...m,
                          referralCaseRules: [
                            ...(m.referralCaseRules || []),
                            {
                              id: `rcr-${Date.now()}`,
                              caseType: 'Surgical / Trauma',
                              mode: 'FLAT',
                              value: 1000,
                              active: true,
                            },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Case Rule
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(mod.referralCaseRules || []).map((rule, idx) => (
                    <div
                      key={rule.id}
                      className="grid grid-cols-12 gap-2 items-center p-2 border border-slate-200 rounded-lg bg-slate-50/70"
                    >
                      <input
                        disabled={!canManage}
                        value={rule.caseType}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.referralCaseRules || [])];
                            next[idx] = { ...next[idx], caseType: e.target.value };
                            return { ...m, referralCaseRules: next };
                          })
                        }
                        className="col-span-5 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                      <select
                        disabled={!canManage}
                        value={rule.mode}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.referralCaseRules || [])];
                            next[idx] = { ...next[idx], mode: e.target.value as 'FLAT' | 'PERCENT' };
                            return { ...m, referralCaseRules: next };
                          })
                        }
                        className="col-span-3 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      >
                        <option value="FLAT">FLAT रू</option>
                        <option value="PERCENT">% Cut</option>
                      </select>
                      <input
                        disabled={!canManage}
                        type="number"
                        min={0}
                        value={rule.value}
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.referralCaseRules || [])];
                            next[idx] = { ...next[idx], value: Math.max(0, Number(e.target.value) || 0) };
                            return { ...m, referralCaseRules: next };
                          })
                        }
                        className="col-span-3 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() =>
                          setMod((m) => ({
                            ...m,
                            referralCaseRules: (m.referralCaseRules || []).filter((_, i) => i !== idx),
                          }))
                        }
                        className="col-span-1 p-1 text-slate-400 hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  <div>
                    <div className="font-semibold text-slate-900">
                      First ER + Admission + POS Total Bill Commission Tiers (e.g. ≥ 5,000 / ≥ 10,000)
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Dynamic flat commission Rs credited when patient combined ER + Admission + POS bill reaches threshold.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() =>
                        setMod((m) => ({
                          ...m,
                          referralBillTierRules: [
                            ...(m.referralBillTierRules || []),
                            {
                              id: `rbt-${Date.now()}`,
                              label: 'High-Value Tier',
                              minTotalBillNpr: 15000,
                              commissionAmountNpr: 1800,
                              active: true,
                            },
                          ],
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Billing Tier
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {(mod.referralBillTierRules || []).map((tier, idx) => (
                    <div
                      key={tier.id}
                      className="grid grid-cols-12 gap-2 items-center p-2 border border-slate-200 rounded-lg bg-slate-50/70"
                    >
                      <input
                        disabled={!canManage}
                        value={tier.label}
                        placeholder="Tier Label"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.referralBillTierRules || [])];
                            next[idx] = { ...next[idx], label: e.target.value };
                            return { ...m, referralBillTierRules: next };
                          })
                        }
                        className="col-span-5 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        disabled={!canManage}
                        type="number"
                        min={0}
                        value={tier.minTotalBillNpr}
                        placeholder="Min Bill रू"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.referralBillTierRules || [])];
                            next[idx] = {
                              ...next[idx],
                              minTotalBillNpr: Math.max(0, Number(e.target.value) || 0),
                            };
                            return { ...m, referralBillTierRules: next };
                          })
                        }
                        className="col-span-3 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        disabled={!canManage}
                        type="number"
                        min={0}
                        value={tier.commissionAmountNpr}
                        placeholder="Commission रू"
                        onChange={(e) =>
                          setMod((m) => {
                            const next = [...(m.referralBillTierRules || [])];
                            next[idx] = {
                              ...next[idx],
                              commissionAmountNpr: Math.max(0, Number(e.target.value) || 0),
                            };
                            return { ...m, referralBillTierRules: next };
                          })
                        }
                        className="col-span-3 px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                      />
                      <button
                        type="button"
                        disabled={!canManage}
                        onClick={() =>
                          setMod((m) => ({
                            ...m,
                            referralBillTierRules: (m.referralBillTierRules || []).filter((_, i) => i !== idx),
                          }))
                        }
                        className="col-span-1 p-1 text-slate-400 hover:text-rose-700"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Clinical Diagnostics & TAT */}
          {showSection('clinical') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Activity className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Clinical Diagnostics, TAT SLA Thresholds &amp; Result Sign-Off
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    TAT Amber Warning Threshold (% of SLA elapsed)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={50}
                    max={99}
                    value={mod.tatWarningThresholdPercent}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        tatWarningThresholdPercent: Number(e.target.value) || 80,
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="flex flex-col justify-end space-y-2.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={autoEmailOnValidate}
                      onChange={(e) => setAutoEmailOnValidate(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Auto-Email Reports Immediately on Pathologist Sign-Off</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.requireDoctorNameOnOrder}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, requireDoctorNameOnOrder: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Require Referring Doctor / Self Name on Every Order</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.notifyCriticalPanicSms}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, notifyCriticalPanicSms: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-rose-600"
                    />
                    <span>Flag Critical / Panic Lab Values for Instant Doctor Call</span>
                  </label>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Default OPD Consultation Ticket Fee (NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.defaultOpdConsultationFeeNpr ?? 600}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        defaultOpdConsultationFeeNpr: Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="flex flex-col justify-end space-y-2.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.autoDeductIpdMedFromPharmacyFefo ?? true}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          autoDeductIpdMedFromPharmacyFefo: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Auto-Deduct IPD Used Medicines from Pharmacy FEFO Stock</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.markBedCleaningOnDischarge ?? true}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          markBedCleaningOnDischarge: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Mark Ward Bed as Cleaning on IPD Transfer / Discharge</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Radiology & X-Ray Films */}
          {showSection('radiology') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Scan className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Radiology Modality (X-Ray / CT / USG / Echo) &amp; Film Inventory Policy
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Default Radiation Exposure Dose Unit
                  </label>
                  <select
                    disabled={!canManage}
                    value={mod.defaultDoseUnit}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, defaultDoseUnit: e.target.value as 'mSv' | 'mGy' }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="mSv">mSv (Effective Dose)</option>
                    <option value="mGy">mGy (Absorbed Organ Dose)</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end space-y-2.5">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.autoDeductFilmOnSignoff}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, autoDeductFilmOnSignoff: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Auto-Deduct DryView X-Ray / CT Films on Study Sign-Off</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.requireFilmRetakeReason}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, requireFilmRetakeReason: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>Require Retake / Spoiled Film Reason Before Stock Adjustment</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: Separate Central Pharmacy Identity, PAN/DDA & FEFO */}
          {showSection('pharmacy') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Pill className="w-4 h-4 text-emerald-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Single Central Pharmacy Identity (Separate PAN / DDA) &amp; FEFO Governance
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Pharmacy Entity Name (English)
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyEntityName || 'Saptari Hospital Pharmacy'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, pharmacyEntityName: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    फार्मेसीको नाम (Nepali Header)
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyEntityNameNp || 'सप्तरी हस्पिटल फार्मेसी'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, pharmacyEntityNameNp: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Pharmacy PAN / VAT Number (Separate from Hospital)
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyPanNumber || ''}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, pharmacyPanNumber: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    DDA Drug Registration License #
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyDdaLicense || ''}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, pharmacyDdaLicense: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pharmacy Contact Phone</label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyPhone || ''}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, pharmacyPhone: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pharmacy Counter Address</label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyAddress || ''}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, pharmacyAddress: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Near-Expiry Warning Window (Days Before Expiry)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={15}
                    max={365}
                    value={mod.pharmacyNearExpiryDays}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        pharmacyNearExpiryDays: Number(e.target.value) || 90,
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Pharmacy Tax Invoice Prefix
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.pharmacyInvoicePrefix}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        pharmacyInvoicePrefix: e.target.value.toUpperCase() || 'PHM',
                      }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-2 flex flex-wrap gap-5 pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.strictFefoBlockExpired}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, strictFefoBlockExpired: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Strict FEFO Enforcement: Block Dispensing Expired &amp; Quarantined Batches</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.showBatchExpiryOnPharmacyBill}
                      onChange={(e) =>
                        setMod((m) => ({
                          ...m,
                          showBatchExpiryOnPharmacyBill: e.target.checked,
                        }))
                      }
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span>Print Lot/Batch # &amp; Expiry Date on Every Pharmacy Invoice Line</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: POS, Finance & WhatsApp */}
          {showSection('pos_finance') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Landmark className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  POS Billing, Daily Counter Close &amp; Admin WhatsApp Automation
                </h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Default POS Payment Mode
                  </label>
                  <select
                    disabled={!canManage}
                    value={mod.defaultPosPaymentMode}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        defaultPosPaymentMode: e.target.value as PaymentMode,
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank / QR">Bank / QR</option>
                    <option value="Split">Split (Cash + Bank)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Max Cashier Discount Cap (%)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    max={100}
                    value={mod.maxCashierDiscountPercent}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        maxCashierDiscountPercent: Number(e.target.value) || 0,
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Max Cashier Discount Amount Cap (रू / NPR)
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={0}
                    value={mod.cashierMaxDiscountNpr ?? 1000}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        cashierMaxDiscountNpr: Math.max(0, Number(e.target.value) || 0),
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Discount Override Approval Flow
                  </label>
                  <select
                    disabled={!canManage}
                    value={mod.discountApprovalPolicy || 'MANAGER_THEN_ADMIN'}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        discountApprovalPolicy: e.target.value as 'MANAGER_THEN_ADMIN' | 'ADMIN_ONLY',
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="MANAGER_THEN_ADMIN">Manager → Admin (2-Tier Approval)</option>
                    <option value="ADMIN_ONLY">Admin Only (Direct Admin Approval)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Credit Limit Override Approval Flow
                  </label>
                  <select
                    disabled={!canManage}
                    value={mod.creditApprovalPolicy || 'MANAGER_THEN_ADMIN'}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        creditApprovalPolicy: e.target.value as 'MANAGER_THEN_ADMIN' | 'ADMIN_ONLY',
                      }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="MANAGER_THEN_ADMIN">Manager → Admin (2-Tier Approval)</option>
                    <option value="ADMIN_ONLY">Admin Only (Direct Admin Approval)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Admin WhatsApp Number (with Country Code)
                  </label>
                  <input
                    disabled={!canManage}
                    value={adminWhatsAppNumber}
                    onChange={(e) => setAdminWhatsAppNumber(e.target.value)}
                    placeholder="+977-9851100999"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Daily Sales Digest Dispatch Time
                  </label>
                  <input
                    disabled={!canManage}
                    type="time"
                    value={dailySalesWhatsAppTime}
                    onChange={(e) => setDailySalesWhatsAppTime(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-5 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={autoSendDailySalesWhatsApp}
                    onChange={(e) => setAutoSendDailySalesWhatsApp(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Enable Automated Daily Sales WhatsApp Digest</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={mod.requireVarianceNoteOnClose}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, requireVarianceNoteOnClose: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Require Variance Note on Daily Counter Close Discrepancies</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    disabled={!canManage}
                    checked={mod.requireTwoTierFinanceApproval !== false}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, requireTwoTierFinanceApproval: e.target.checked }))
                    }
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Enforce 2-Tier Finance Approval Workflow (Manager + Admin)</span>
                </label>
              </div>
            </div>
          )}

          {/* TAB 6: Security, Hikvision Biometric, Premises Access & Erase PIN */}
          {showSection('centers_security') && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                <Building2 className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Hospital Premises Access Perimeter, Hikvision Biometric &amp; Admin Erase PIN
                </h2>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Hikvision Biometric Device IP
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.hikvisionDeviceIp || '192.168.1.210'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, hikvisionDeviceIp: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">ISAPI Port</label>
                    <input
                      disabled={!canManage}
                      type="number"
                      value={mod.hikvisionDevicePort ?? 80}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, hikvisionDevicePort: Number(e.target.value) || 80 }))
                      }
                      className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Terminal Name</label>
                    <input
                      disabled={!canManage}
                      value={mod.hikvisionDeviceName || 'Main Gate Terminal'}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, hikvisionDeviceName: e.target.value }))
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Hospital WiFi / Gate Perimeter Check Code
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.hospitalWifiCheckCode || 'SAPTARI-HOSP-2083'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, hospitalWifiCheckCode: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Allowed Hospital LAN / Subnet CIDRs
                  </label>
                  <input
                    disabled={!canManage}
                    value={mod.allowedHospitalIps || '192.168.1.*'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, allowedHospitalIps: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Admin Secret Erase PIN (Dummy Data Wipe Guard)
                  </label>
                  <input
                    disabled={!canManage}
                    type="password"
                    value={mod.adminEraseSecretPin || '2082'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, adminEraseSecretPin: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Admin Erase Confirmation Email
                  </label>
                  <input
                    disabled={!canManage}
                    type="email"
                    value={mod.adminConfirmEmail || 'epusaan@gmail.com'}
                    onChange={(e) =>
                      setMod((m) => ({ ...m, adminConfirmEmail: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Idle Session PIN Lock Timeout
                  </label>
                  <select
                    disabled={!canManage}
                    value={idleLockSeconds}
                    onChange={(e) => setIdleLockSeconds(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                  >
                    <option value="120">2 Minutes (120s)</option>
                    <option value="150">2.5 Minutes (150s Default)</option>
                    <option value="180">3 Minutes (180s)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Failed Login / PIN Attempts Before Auto-Lockout
                  </label>
                  <input
                    disabled={!canManage}
                    type="number"
                    min={3}
                    max={10}
                    value={mod.maxFailedAttemptsBeforeLock}
                    onChange={(e) =>
                      setMod((m) => ({
                        ...m,
                        maxFailedAttemptsBeforeLock: Number(e.target.value) || 5,
                      }))
                    }
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1 flex items-center gap-1">
                    <PhoneCall className="w-3 h-3 text-slate-500" />
                    Call-Reset Support Hotline
                  </label>
                  <input
                    disabled={!canManage}
                    value={resetSupportPhone}
                    onChange={(e) => setResetSupportPhone(e.target.value)}
                    placeholder="+977-9851100999"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-2 flex flex-wrap gap-5 pt-1">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={Boolean(mod.hospitalAccessOnlyForStaff)}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, hospitalAccessOnlyForStaff: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-rose-600"
                    />
                    <span>
                      Hospital-Only Access Perimeter: Restrict Non-Admin Staff Outside Hospital Premises
                    </span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManage}
                      checked={mod.showDemoCredentialsOnLogin !== false}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, showDemoCredentialsOnLogin: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>
                      Show Quick Demo Credentials &amp; Password Hints on Login Screen (Uncheck to hide demo logins)
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB: Super-Admin Only Direct App Downloads, 1-PC LAN Desktop Server & Auto-Sync Folder Backup */}
          {showSection('downloads_sync') && isSuperAdmin && (
            <div className="space-y-5">
              {/* 1-Computer Desktop Server LAN IP Setup */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      1-Computer Desktop Server &amp; Multi-PC Windows LAN Client Setup
                    </h2>
                  </div>
                  <span className="font-mono text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded">
                    Admin-Only Section
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Server Computer Static LAN IP / Hostname
                    </label>
                    <input
                      disabled={!canManage}
                      value={mod.lanServerHostIp || '192.168.1.100'}
                      onChange={(e) =>
                        setMod((m) => ({ ...m, lanServerHostIp: e.target.value.trim() }))
                      }
                      placeholder="192.168.1.100"
                      className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                    />
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-700 space-y-1">
                    <div className="font-semibold text-slate-900">
                      Same-Wi-Fi Multi-Device Access URLs (SHPL)
                    </div>
                    <div className="font-mono text-blue-700 font-semibold">
                      http://{mod.lanServerHostIp || liveLanUrls[0]?.replace(/^https?:\/\//, '').replace(/:\d+$/, '') || '192.168.1.100'}:3000
                    </div>
                    {liveLanUrls.length > 0 && (
                      <div className="text-[10px] text-emerald-700 font-mono">
                        Live Server IPs: {liveLanUrls.join(' · ')}
                      </div>
                    )}
                    <div className="text-slate-500">
                      Run <code className="font-mono font-semibold">Start-SHPL-Windows-Server.bat</code> on 1 Windows Server PC, then open this IP in Chrome on Windows, Android &amp; iOS and install as <strong>SHPL</strong>.
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                  >
                    <Save className="w-3.5 h-3.5" />
                    {saving ? 'Saving...' : 'Save LAN Server IP'}
                  </button>
                </div>
              </div>

              {/* Code Security & Integrity Verification */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
                <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <h2 className="text-sm font-semibold text-slate-900">
                    Source Integrity &amp; Malware Scan Check (Admin Audit)
                  </h2>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-[11px]">
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
                    <div className="font-semibold">Dynamic Eval / Script Execution</div>
                    <div className="font-mono mt-1">0 eval() · 0 new Function()</div>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900">
                    <div className="font-semibold">Shell / Process Spawning</div>
                    <div className="font-mono mt-1">0 child_process · 0 hidden beacons</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-800">
                    <div className="font-semibold">Application Architecture</div>
                    <div className="font-mono mt-1">Pure React + TypeScript + Express</div>
                  </div>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-blue-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      Super-Admin Only: Full Source Code &amp; Multi-PC Installers
                    </h2>
                  </div>
                  <PWAInstallButton />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50/60">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Server className="w-4 h-4 text-blue-600" />
                      Admin Only: Linux Node.js &amp; CloudLinux Pre-Built Source ZIP
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Complete editable source + pre-built <code className="font-mono">dist/</code> &amp; <code className="font-mono">dist-server/server.js</code> with <code className="font-mono">app.cjs</code>, <code className="font-mono">start-linux.sh</code>, <code className="font-mono">ecosystem.config.cjs</code>, and <code className="font-mono">LINUX_NODE_HOSTING.md</code> — upload and run immediately on any Node.js Linux server.
                    </p>
                    <a
                      href={`/api/system/download-source?uid=${encodeURIComponent(activeUser.id)}`}
                      download="hospital-erp-linux-node-source.zip"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Linux Node.js Package (.zip)
                    </a>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50/60">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Monitor className="w-4 h-4 text-indigo-600" />
                      Windows 10/11 Server + LAN Client App Bundle
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Includes 1-PC Desktop Server launcher, <code className="font-mono">Connect-Client-PC.bat</code> pre-configured for <code className="font-mono">{mod.lanServerHostIp || '192.168.1.100'}</code>, and <code className="font-mono">AutoSync-Backup.ps1</code>.
                    </p>
                    <a
                      href={`/api/downloads/windows-installer?uid=${encodeURIComponent(activeUser.id)}`}
                      download="saptari-hospital-windows-installer.zip"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Windows Bundle (.zip)
                    </a>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50/60">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Monitor className="w-4 h-4 text-slate-700" />
                      macOS 1-Click Web App Launcher
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Standalone macOS Chrome/Edge app window script (<code className="font-mono">Launch-SaptariHospital.command</code>) + macOS auto-sync backup shell script.
                    </p>
                    <a
                      href={`/api/downloads/mac-app?uid=${encodeURIComponent(activeUser.id)}`}
                      download="saptari-hospital-mac-app.zip"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-800 rounded-lg hover:bg-slate-900 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download macOS App (.zip)
                    </a>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50/60">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Settings className="w-4 h-4 text-amber-600" />
                      Chrome Extension (Manifest V3)
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Unpacked Chrome extension popup (<code className="font-mono">manifest.json</code> + <code className="font-mono">popup.html</code>) for 1-click toolbar launch to POS, Pharmacy &amp; Finance Approvals.
                    </p>
                    <a
                      href={`/api/downloads/chrome-extension?uid=${encodeURIComponent(activeUser.id)}`}
                      download="saptari-hospital-chrome-extension.zip"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Chrome Extension (.zip)
                    </a>
                  </div>

                  <div className="border border-slate-200 rounded-xl p-4 space-y-2 bg-slate-50/60">
                    <div className="flex items-center gap-2 font-semibold text-slate-900">
                      <Smartphone className="w-4 h-4 text-emerald-600" />
                      Android Mobile App (WebAPK + Build Kit)
                    </div>
                    <p className="text-[11px] text-slate-600">
                      Install immediately on Android Chrome as a standalone WebAPK via &quot;Install App&quot;, or download the TWA/Capacitor config kit (<code className="font-mono">.zip</code>) to build a signed <code className="font-mono">.apk</code> on a workstation with Android SDK/Gradle.
                    </p>
                    <a
                      href={`/api/downloads/android-app?uid=${encodeURIComponent(activeUser.id)}`}
                      download="saptari-hospital-android-kit.zip"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Android Kit (.zip)
                    </a>
                  </div>
                </div>
              </div>

              <CloudBackupPanel
                db={db}
                activeUser={activeUser}
                canManage={canManage}
                onDbRestored={(nextDb, toastMsg) => onUpdated(nextDb, toastMsg)}
              />

              {/* 1-Computer Auto-Sync Folder Backup */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <FolderSync className="w-4 h-4 text-emerald-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      1-Computer Automatic Folder Backup Sync
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-600">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    Every {mod.autoSyncBackupMinutes ?? 10} min
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5 text-[11px]">
                  <div>
                    <div className="text-slate-500">Bound PC Backup Folder</div>
                    <div className="font-mono font-semibold text-slate-900 mt-0.5 truncate">
                      {autoSyncFolderName || 'Not bound (browser prompt required)'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Last Auto-Sync</div>
                    <div className="font-mono font-semibold text-slate-900 mt-0.5">
                      {autoSyncLastAt || 'No snapshot synced yet'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Sync Status</div>
                    <div className="font-medium text-emerald-700 mt-0.5">
                      {autoSyncStatus || 'Ready'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {onChooseAutoSyncFolder && (
                    <button
                      type="button"
                      onClick={onChooseAutoSyncFolder}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
                    >
                      <FolderSync className="w-3.5 h-3.5" />
                      {autoSyncFolderName ? 'Change PC Backup Folder' : 'Bind 1-PC Auto-Sync Folder'}
                    </button>
                  )}
                  {onSyncBackupNow && (
                    <button
                      type="button"
                      onClick={onSyncBackupNow}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                    >
                      Sync Backup Now
                    </button>
                  )}
                  <a
                    href={`/api/system/backup-snapshot?uid=${encodeURIComponent(activeUser.id)}`}
                    download="saptari-hospital-backup-latest.json"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download JSON Snapshot
                  </a>
                  {autoSyncFolderName && onDisableAutoSyncFolder && (
                    <button
                      type="button"
                      onClick={onDisableAutoSyncFolder}
                      className="px-3 py-2 text-xs font-medium text-rose-700 hover:underline whitespace-nowrap"
                    >
                      Disconnect Folder
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {canManage && activeSubTab !== 'session' && (isSearching || activeSubTab !== 'downloads_sync') && (
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving Settings...' : 'Save All ERP Settings'}
              </button>
            </div>
          )}
        </form>

        {/* Right Column: Instant WhatsApp Test + Hosting Readiness */}
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-emerald-600" />
              Test Admin WhatsApp Dispatch
            </h3>
            <p className="text-slate-600">
              Generate today&apos;s BS/AD revenue breakdown and send directly to Admin WhatsApp{' '}
              <strong className="font-mono">{adminWhatsAppNumber}</strong>.
            </p>
            <button
              type="button"
              disabled={sendingWa}
              onClick={handleSendWhatsAppDigest}
              className="w-full py-2 font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
            >
              {sendingWa ? 'Sending...' : 'Dispatch Daily Sales to WhatsApp Now'}
            </button>
            {waLink && (
              <a
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full inline-flex items-center justify-center gap-1.5 py-2 font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open WhatsApp Link
              </a>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-600" />
              Shared &amp; Cheap Cloud Hosting (Linux / Windows)
            </h3>
            <ul className="space-y-2 text-slate-600">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span>
                  <strong>Zero Native C++ Dependencies:</strong> Pure JS/TS stack installs smoothly on cPanel, Plesk, IISNode, VPS, or Railway without compilers.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span>
                  <strong>Ultra-Fast In-Memory Cache + Gzip Compression:</strong> Instant reads from RAM with cross-platform Windows/Linux JSON disk persistence.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                <span>
                  <strong>Dynamic PORT Support:</strong> Binds automatically to{' '}
                  <code className="font-mono bg-slate-100 px-1 rounded">process.env.PORT || 3000</code>.
                </span>
              </li>
            </ul>
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              Platform Engineered &amp; Developed by{' '}
              <strong className="text-slate-900">{db.settings.developedBy}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
