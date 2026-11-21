export type BuiltInRoleId =
  | 'SAAS_ADMIN'
  | 'SUPER_ADMIN'
  | 'LAB_DIRECTOR'
  | 'RADIOLOGIST'
  | 'DOCTOR'
  | 'NURSE'
  | 'PHARMACIST'
  | 'PHARMACY_CASHIER'
  | 'LAB_TECH'
  | 'CENTER_MANAGER'
  | 'INVENTORY_HR'
  | 'BILLING_REPORT';

export type RoleId = BuiltInRoleId | (string & {});

export type PermissionKey =
  | 'dashboard.view'
  | 'pos.billing'
  | 'orders.view'
  | 'orders.create'
  | 'orders.collect'
  | 'orders.advance'
  | 'results.enter'
  | 'results.validate'
  | 'radiology.view'
  | 'radiology.report'
  | 'radiology.manage'
  | 'pharmacy.view'
  | 'pharmacy.manage'
  | 'pharmacy.dispense'
  | 'hospital.view'
  | 'hospital.clinical'
  | 'hospital.manage'
  | 'ot.view'
  | 'ot.manage'
  | 'ot.anesthesia'
  | 'nursing.view'
  | 'doctor.view'
  | 'patients.manage'
  | 'emergency.view'
  | 'emergency.manage'
  | 'darta.view'
  | 'darta.manage'
  | 'dhis2.view'
  | 'dhis2.manage'
  | 'gatepass.manage'
  | 'marketing.manage'
  | 'mis.view'
  | 'reports.print'
  | 'reports.email'
  | 'reports.api_send'
  | 'services.view'
  | 'services.manage'
  | 'inventory.view'
  | 'inventory.manage'
  | 'centers.view'
  | 'centers.manage'
  | 'centers.credit_override'
  | 'awards.manage'
  | 'riders.view'
  | 'riders.manage'
  | 'referrals.view'
  | 'referrals.manage'
  | 'referrals.approve_payout'
  | 'finance.view'
  | 'finance.manage'
  | 'finance.approve_manager'
  | 'finance.approve_admin'
  | 'counter.close'
  | 'personnel.view'
  | 'personnel.manage'
  | 'payroll.view'
  | 'payroll.manage'
  | 'audit.view'
  | 'rbac.manage'
  | 'settings.manage'
  | 'admin.control'
  | 'saas.view'
  | 'saas.manage'
  | 'saas.tenants.manage'
  | 'designs.manage'
  | 'mobile.app';

export interface RoleDefinition {
  id: RoleId;
  name: string;
  description: string;
  permissions: PermissionKey[];
  isCustom?: boolean;
  assignedModuleKeys?: string[];
  createdAt?: string;
}

export interface StaffMember {
  id: string;
  employeeCode: string;
  username: string;
  password: string;
  pin: string;
  failedAttempts: number;
  isLocked: boolean;
  lockedReason?: string;
  lockedAt?: string;
  lastFailedAt?: string;
  lastLoginAt?: string;
  fullName: string;
  designation: string;
  department: string;
  email: string;
  phone: string;
  roleId: RoleId;
  shift: 'Morning (07:00-15:00)' | 'Afternoon (14:00-22:00)' | 'Night (21:30-07:30)';
  status: 'Active' | 'On Leave' | 'Suspended';
  certification: string;
  registrationNumber?: string;
  canSignReports: boolean;
  assignedCenterId?: string | null; // null = Main Central Lab; ctr-* = isolated Collection Center / Clinic / Hospital
  assignedCenterName?: string;
  joinedAt: string;
  // HR & Payroll Compensation (NPR)
  basicSalaryNpr: number;
  technicalAllowanceNpr: number;
  shiftAllowanceNpr: number;
  ssfPercent: number;
  tdsPercent: number;
  bankAccountNumber?: string;
  qrSecret?: string;
}

export interface SecurityAlert {
  id: string;
  timestamp: string;
  type:
    | 'BRUTE_FORCE_LOCKOUT'
    | 'FAILED_LOGIN'
    | 'FAILED_PIN'
    | 'CALL_RESET_REQUEST'
    | 'ADMIN_RESET'
    | 'SAAS_CONTROL'
    | 'CLINICAL_VITALS_ALERT';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  targetUserId?: string;
  targetUsername: string;
  targetFullName?: string;
  targetRole?: RoleId;
  attemptsCount?: number;
  message: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedReason?: string;
  resolvedAt?: string;
}

export type ParameterResultType = 'NUMERIC' | 'QUALITATIVE';

export interface TestParameter {
  id: string;
  name: string;
  resultType?: ParameterResultType;
  unit: string;
  refMinMale: number;
  refMaxMale: number;
  refMinFemale: number;
  refMaxFemale: number;
  criticalLow?: number;
  criticalHigh?: number;
  decimalPlaces: number;
  formula?: string;
  isCalculated?: boolean;
  analyzerCode?: string;
  qualitativeOptions?: string[];
  normalQualitativeValues?: string[];
  criticalQualitativeValues?: string[];
}

export interface ReagentBomItem {
  reagentId: string;
  reagentName: string;
  quantityPerTest: number;
  unit: string;
}

export interface InterpretationTemplates {
  normal: string;
  abnormalLow: string;
  abnormalHigh: string;
  critical: string;
  methodologyNote: string;
}

export type RadiologyModality = 'X-RAY' | 'CT' | 'USG' | 'ECHO' | 'ECG' | 'MRI';

export interface RadiologyTemplateSection {
  id: string;
  title: string;
  defaultText: string;
}

export interface RadiologyMeasurementDef {
  id: string;
  label: string;
  unit: string;
  normalRange: string;
  defaultValue: string;
}

export interface RadiologyTemplate {
  id: string;
  code: string;
  name: string;
  modality: RadiologyModality;
  serviceId?: string;
  technique: string;
  indicationPrompt: string;
  sections: RadiologyTemplateSection[];
  measurements: RadiologyMeasurementDef[];
  normalImpression: string;
  advice: string;
  quickMacros: Array<{ label: string; sectionTitle: string; findingText: string; impressionText: string }>;
  updatedAt: string;
  updatedBy: string;
}

export interface RadiologyReportData {
  templateId?: string;
  templateName: string;
  modality: RadiologyModality;
  clinicalHistory: string;
  technique: string;
  sections: Array<{ title: string; content: string }>;
  measurements: Array<{ label: string; value: string; unit: string; normalRange: string }>;
  impression: string;
  advice: string;
  criticalFinding: boolean;
  filmsUsedCount: number;
  filmRetakeCount: number;
}

export type ServiceCategory =
  | 'PATHOLOGY'
  | 'RADIOLOGY'
  | 'CONSULTATION'
  | 'HOSPITAL_PROCEDURE'
  | 'DIAGNOSTICS'
  | 'EMERGENCY'
  | 'CUSTOM';

export interface LabServiceTest {
  id: string;
  code: string;
  name: string;
  serviceCategory?: ServiceCategory;
  customCategory?: string;
  allowCustomRateAtBilling?: boolean;
  modality?: RadiologyModality;
  defaultRadiologyTemplateId?: string;
  department:
    | 'Hematology'
    | 'Clinical Chemistry'
    | 'Endocrinology'
    | 'Immunology'
    | 'Microbiology'
    | 'Radiology'
    | 'Consultation & OPD'
    | 'OPD Consultation'
    | 'Ortho & Plaster'
    | 'Orthopedics & Plaster'
    | 'Emergency & Procedures'
    | 'Emergency & Observation'
    | 'Surgery / Minor OT'
    | 'Nursing Procedure'
    | 'Cardiology / Diagnostics'
    | 'Nursing & Ward'
    | 'Hospital Services';
  specimenType: string;
  containerType: string;
  methodology: string;
  tatMinutes: number;
  price: number; // In NPR
  active: boolean;
  parameters: TestParameter[];
  reagentBom: ReagentBomItem[];
  interpretations: InterpretationTemplates;
}

export interface ReagentItem {
  id: string;
  sku: string;
  name: string;
  manufacturer: string;
  category:
    | 'Reagent Pack'
    | 'Buffer / Diluent'
    | 'Calibrator / QC'
    | 'Consumable'
    | 'X-Ray Film'
    | 'CT Contrast'
    | 'USG / Echo Consumable';
  lotNumber: string;
  expiryDate: string;
  storageCondition: '2-8°C' | '-20°C' | '15-25°C (Ambient)';
  currentStock: number;
  unit: string;
  reorderLevel: number;
  unitCost: number;
  lastRestockedAt: string;
  autoDeductEnabled: boolean;
}

export interface InventoryMovement {
  id: string;
  timestamp: string;
  reagentId: string;
  reagentName: string;
  lotNumber: string;
  type: 'AUTO_DEDUCT' | 'RESTOCK' | 'ADJUSTMENT' | 'EXPIRED_WRITE_OFF' | 'FILM_RETAKE';
  quantityDelta: number;
  balanceAfter: number;
  referenceId?: string;
  performedBy: string;
  notes: string;
}

export interface CenterTransaction {
  id: string;
  timestamp: string;
  centerId: string;
  type: 'ORDER_DEBIT' | 'PAYMENT_CREDIT' | 'LIMIT_ADJUSTMENT' | 'AWARD_BONUS_CREDIT';
  amount: number;
  balanceAfter: number;
  referenceId: string;
  recordedBy: string;
  notes: string;
}

export type FacilityEntityType =
  | 'Main Lab'
  | 'Diagnostic Lab'
  | 'Pharmacy'
  | 'Collection Center'
  | 'Clinic'
  | 'Hospital'
  | 'Polyclinic'
  | 'Medical Hall'
  | 'Custom';

export type DocumentTemplateScope =
  | 'BOTH'
  | 'BILL'
  | 'REPORT'
  | 'PHARMACY'
  | 'ADMISSION_SLIP'
  | 'OTHERS';

export type DocumentTemplateStyle =
  | 'CLASSIC_CLINICAL'
  | 'CLASSIC_HOSPITAL'
  | 'CLINICAL_CLEAN'
  | 'MODERN_MINIMAL'
  | 'EXECUTIVE_BORDERED'
  | 'EXECUTIVE_HOSPITAL'
  | 'COMPACT_A5'
  | 'A5_COMPACT_BILL'
  | 'THERMAL_RECEIPT'
  | 'PHARMACY_MODERN'
  | 'ADMISSION_CARD'
  | 'GOVT_FORMAL'
  | 'NEPAL_GOVT_STYLE'
  | 'CLEAN_DUOTONE'
  | 'HOSPITAL_PRO'
  | 'PHARMACY_SLIP'
  | 'EMERGENCY_FAST'
  | 'CERTIFICATE_GOLD';

export interface DocumentDesignTemplate {
  id: string;
  name: string;
  entityType: FacilityEntityType;
  centerId: string | null;
  targetScope: DocumentTemplateScope;
  templateStyle?: DocumentTemplateStyle;
  headerTitle: string;
  headerTitleNp: string;
  subTitle: string;
  addressText: string;
  phoneText: string;
  panNumber: string;
  licenseNumber: string;
  billHeading: string;
  reportHeading: string;
  radiologyHeading: string;
  topBannerText: string;
  footerDisclaimerText: string;
  footerSignatureTitle: string;
  watermarkText: string;
  showWatermark: boolean;
  accentColor: string;
  paperFormat: 'A4' | 'A5' | 'THERMAL_80MM';
  showLetterheadBanner: boolean;
  showQrCode: boolean;
  qrPayloadMode: 'VERIFY_URL' | 'PATIENT_BILL' | 'ACCESSION_PAN';
  showBarcode: boolean;
  barcodeSource: 'ACCESSION' | 'INVOICE';
  showNepaliDate: boolean;
  showPan: boolean;
  showCollectionCenter: boolean;
  showDoctorRef: boolean;
  showTatBadge: boolean;
  updatedAt: string;
  updatedBy: string;
}

export interface CollectionCenter {
  id: string;
  code: string;
  name: string;
  facilityType?: FacilityEntityType;
  designTemplateId?: string;
  city: string;
  address: string;
  managerName: string;
  email: string;
  phone: string;
  creditLimit: number;
  outstandingBalance: number;
  revenueSharePercent: number;
  hardCreditStop: boolean;
  status: 'Active' | 'Credit Hold' | 'Suspended';
  webhookUrl: string;
  apiAuthToken: string;
  autoApiSendOnValidate: boolean;
  transactions: CenterTransaction[];
}

export interface CenterAwardRecord {
  id: string;
  timestamp: string;
  fiscalYear: string;
  centerId: string;
  centerName: string;
  awardTitle: string;
  tier: 'Gold Excellence' | 'Silver Achiever' | 'Top Growth';
  salesVolumeAtAward: number;
  bonusCreditNpr: number;
  awardedBy: string;
  notes: string;
}

export type AgeType = 'Years' | 'Months' | 'Days';
export type PatientGender = 'Male' | 'Female' | 'Other';
export type PaymentMode = 'Cash' | 'Bank / QR' | 'Center Credit' | 'Split' | 'Credit';

export type OrderWorkflowStatus =
  | 'Ordered'
  | 'Collected'
  | 'In Lab'
  | 'Resulted'
  | 'Validated'
  | 'Dispatched';

export type EncounterType = 'OPD' | 'EMERGENCY' | 'IPD' | 'WALKING';

export interface PatientRecord {
  id: string;
  uhid: string; // e.g., SH-2083-0001
  fullName: string;
  age: number;
  ageType: AgeType;
  gender: PatientGender;
  phone: string;
  address: string;
  email?: string;
  bloodGroup?: string;
  allergies?: string;
  pastMedicalHistory?: string;
  createdAt: string;
  createdBy: string;
  lastOpdVisitAt?: string;
  lastOpdDoctor?: string;
  totalEncounters: number;
}

export type ResultFlag =
  | 'NORMAL'
  | 'LOW'
  | 'HIGH'
  | 'CRITICAL_LOW'
  | 'CRITICAL_HIGH'
  | 'ABNORMAL'
  | 'HIGH_RISK'
  | 'CRITICAL';

export interface ParameterResult {
  parameterId: string;
  parameterName: string;
  resultType?: ParameterResultType;
  unit: string;
  value: number | string | null;
  refRangeDisplay: string;
  flag: ResultFlag;
}

export interface OrderTestItem {
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  serviceCategory?: ServiceCategory;
  customCategory?: string;
  modality?: RadiologyModality;
  department: string;
  methodology: string;
  tatMinutes: number;
  dueAt: string;
  quantity?: number;
  unitPrice?: number;
  price: number;
  referralCommissionNpr: number;
  parameterResults: ParameterResult[];
  radiologyReport?: RadiologyReportData;
  interpretation: string;
  reagentsDeducted: boolean;
  status: 'Pending' | 'Resulted' | 'Validated';
}

export interface LabOrder {
  id: string;
  accessionNumber: string;
  invoiceNumber: string;
  fiscalYear: string;
  patientId?: string;
  uhid?: string;
  encounterType?: EncounterType;
  encounterId?: string;
  encounterLabel?: string;
  nonInventoryBillOnly?: boolean;
  patientName: string;
  patientAge: number;
  patientAgeType: AgeType;
  patientGender: PatientGender;
  patientAddress: string;
  patientPhone: string;
  patientEmail: string;
  referringDoctor: string;
  referralPartnerId: string | null;
  referralPartnerName: string | null;
  referralCommissionTotal: number;
  collectionCenterId: string | null;
  collectionCenterName: string;
  priority: 'Routine' | 'STAT';
  status: OrderWorkflowStatus;
  orderedAt: string;
  collectedAt: string | null;
  receivedInLabAt: string | null;
  resultedAt: string | null;
  validatedAt: string | null;
  validatedById: string | null;
  validatedByName: string | null;
  validatedByDesignation: string | null;
  validatedByRegNo: string | null;
  dueAt: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentMode: PaymentMode;
  cashPaid: number;
  bankPaid: number;
  bankAccountId?: string;
  creditOverrideApplied: boolean;
  creditOverrideReason?: string;
  emailSent: boolean;
  emailSentAt?: string;
  apiSent: boolean;
  apiSentAt?: string;
  printedAt?: string | null;
  printedBy?: string | null;
  printCount?: number;
  dispatchedAt?: string | null;
  dispatchedBy?: string | null;
  dispatchMode?: string;
  dispatchNotes?: string;
  createdById?: string;
  createdByName?: string;
  tests: OrderTestItem[];
}

export interface ReferralTestOverride {
  serviceId: string;
  serviceCode: string;
  mode: 'PERCENT' | 'FLAT';
  value: number; // % or NPR
}

export interface ReferralPartner {
  id: string;
  code: string;
  name: string;
  type: 'Physician' | 'Polyclinic' | 'Hospital' | 'Field Agent';
  phone: string;
  address: string;
  defaultMode: 'PERCENT' | 'FLAT';
  defaultValue: number;
  testOverrides: ReferralTestOverride[];
  // Bank & Payment Account Details
  bankName?: string;
  bankBranch?: string;
  accountHolderName?: string;
  accountNumber?: string;
  walletId?: string; // eSewa / Khalti / ConnectIPS
  panNumber?: string;
  totalReferredSales: number;
  totalCommissionEarned: number;
  totalCommissionPaid: number;
  active: boolean;
}

export interface ReferralPayoutRequest {
  id: string;
  requestNumber: string;
  requestedAt: string;
  fiscalYear?: string;
  partnerId: string;
  partnerName: string;
  partnerCode: string;
  amountNpr: number;
  targetAccountId: string;
  destinationSummary: string;
  destinationBankName?: string;
  destinationBranch?: string;
  destinationAccountHolder?: string;
  destinationAccountNumber?: string;
  destinationWalletId?: string;
  paymentMethod?: 'Bank Transfer / ConnectIPS' | 'eSewa / Khalti Wallet' | 'Cash / Cheque';
  paymentRefOrReceipt?: string;
  notes: string;
  requestedBy: string;
  status: 'Pending Admin Approval' | 'Approved & Paid' | 'Rejected';
  reviewedBy?: string;
  reviewedAt?: string;
  approvalRemarks?: string;
}

export interface BankCashAccount {
  id: string;
  code: string;
  name: string;
  type: 'CASH_COUNTER' | 'BANK';
  departmentScope?: 'HOSPITAL' | 'PHARMACY' | 'SHARED';
  bankName?: string;
  accountNumber?: string;
  branch?: string;
  currentBalance: number;
  isDefaultPosCash?: boolean;
  isDefaultPosBank?: boolean;
}

export interface FinancialLedgerEntry {
  id: string;
  timestamp: string;
  fiscalYear: string;
  accountId: string;
  accountName: string;
  category:
    | 'POS_COLLECTION'
    | 'CENTER_SETTLEMENT'
    | 'EXPENSE'
    | 'REFERRAL_PAYOUT'
    | 'PAYROLL_DISBURSEMENT'
    | 'BANK_TRANSFER'
    | 'COUNTER_CLOSE'
    | 'PHARMACY_POS'
    | 'PHARMACY_PURCHASE'
    | 'SUPPLIER_PAYMENT'
    | 'ASSET_PURCHASE';
  direction: 'INFLOW' | 'OUTFLOW';
  amount: number;
  balanceAfter: number;
  referenceId: string;
  description: string;
  recordedBy: string;
}

export interface CounterCloseRecord {
  id: string;
  closedAt: string;
  fiscalYear: string;
  bsDate: string;
  shiftLabel: string;
  cashierId: string;
  cashierName: string;
  openingCashNpr: number;
  cashSalesNpr: number;
  bankQrSalesNpr: number;
  centerCreditSalesNpr: number;
  cashOutflowsNpr: number;
  expectedClosingCashNpr: number;
  actualCountedCashNpr: number;
  varianceNpr: number;
  notes: string;
  status: 'LOCKED_CLOSED';
  counterScope?: 'HOSPITAL' | 'PHARMACY' | 'ALL';
  staffRole?: string;
  depositsCollectedNpr?: number;
  ipdCashBillsNpr?: number;
}

export type FinanceApprovalStatus =
  | 'PENDING_MANAGER'
  | 'PENDING_ADMIN'
  | 'APPROVED'
  | 'DECLINED';

export type FinanceApprovalTransactionType =
  | 'EXPENSE'
  | 'BANK_DEPOSIT'
  | 'RECEIPT'
  | 'PAYMENT';

export type FinanceApprovalDirection = 'IN' | 'OUT';

export type FinanceApprovalHistoryAction =
  | 'REQUESTED'
  | 'APPROVED_BY_MANAGER'
  | 'APPROVED_BY_ADMIN'
  | 'DECLINED'
  | 'RE_REQUESTED';

export interface FinanceApprovalHistoryEntry {
  id: string;
  timestamp: string;
  action: FinanceApprovalHistoryAction;
  actorId: string;
  actorName: string;
  actorRole: RoleId;
  note: string;
  statusAfter: FinanceApprovalStatus;
}

export interface FinanceApprovalRequest {
  id: string;
  requestNumber: string;
  fiscalYear: string;
  createdAt: string;
  updatedAt: string;
  transactionType: FinanceApprovalTransactionType;
  direction: FinanceApprovalDirection;
  amountNpr: number;
  accountId: string;
  accountName: string;
  targetAccountId?: string;
  targetAccountName?: string;
  referenceId: string;
  reason: string;
  description: string;
  payeeOrParty?: string;
  requesterId: string;
  requesterName: string;
  requesterRole: RoleId;
  status: FinanceApprovalStatus;
  managerReviewedBy?: string;
  managerReviewedAt?: string;
  adminReviewedBy?: string;
  adminReviewedAt?: string;
  declineReason?: string;
  reRequestCount: number;
  history: FinanceApprovalHistoryEntry[];
}

export interface PayrollLineItem {
  staffId: string;
  employeeCode: string;
  fullName: string;
  designation: string;
  basicSalary: number;
  allowances: number;
  grossSalary: number;
  ssfDeduction: number;
  tdsDeduction: number;
  netPayable: number;
}

export interface PayrollRun {
  id: string;
  createdAt: string;
  fiscalYear: string;
  bsMonthLabel: string; // e.g. Kartik 2083
  status: 'Draft' | 'Disbursed';
  paidFromAccountId?: string;
  paidFromAccountName?: string;
  totalGrossNpr: number;
  totalDeductionsNpr: number;
  totalNetNpr: number;
  approvedBy: string;
  items: PayrollLineItem[];
}

export interface CollectionRider {
  id: string;
  code: string;
  name: string;
  phone: string;
  vehicleNumber: string;
  zone: string;
  status: 'Available' | 'On Route' | 'Off Duty';
  completedPickups: number;
  lastLat?: number;
  lastLng?: number;
  lastLocationLabel?: string;
  lastLocationUpdatedAt?: string;
}

export interface RiderPickupTask {
  id: string;
  createdAt: string;
  fiscalYear: string;
  riderId: string;
  riderName: string;
  centerId: string | null;
  pickupLocation: string;
  pickupLat?: number;
  pickupLng?: number;
  sampleCount: number;
  priority: 'Routine' | 'STAT';
  status: 'Assigned' | 'Picked Up' | 'Delivered to Lab';
  pickedUpAt?: string;
  deliveredAt?: string;
  notes: string;
}

export interface EmailNotification {
  id: string;
  timestamp: string;
  orderId: string;
  accessionNumber: string;
  recipientEmail: string;
  ccEmail?: string;
  subject: string;
  triggerType: 'AUTO_ON_VALIDATE' | 'MANUAL_RESEND';
  status: 'Sent' | 'Queued' | 'Failed';
  bodyPreview: string;
  triggeredBy: string;
}

export interface ApiDispatchLog {
  id: string;
  timestamp: string;
  orderId: string;
  accessionNumber: string;
  targetUrl: string;
  httpStatus: number;
  latencyMs: number;
  status: 'Delivered' | 'Failed';
  requestPayload: string;
  responseBody: string;
  triggeredBy: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: RoleId;
  module:
    | 'POS_BILLING'
    | 'ORDERS'
    | 'RESULTS'
    | 'RADIOLOGY'
    | 'REPORTS'
    | 'SERVICES'
    | 'INVENTORY'
    | 'CENTERS'
    | 'AWARDS'
    | 'RIDERS'
    | 'REFERRALS'
    | 'FINANCE'
    | 'FINANCE_APPROVAL'
    | 'COUNTER_CLOSE'
    | 'PHARMACY'
    | 'OPD_IPD'
    | 'OT_MANAGEMENT'
    | 'BED_MANAGEMENT'
    | 'NURSING_CHART'
    | 'EMERGENCY_MLC'
    | 'DARTA_CHALANI'
    | 'CERTIFICATES'
    | 'DHIS2_HMIS'
    | 'CONSENT'
    | 'PERSONNEL'
    | 'PAYROLL'
    | 'RBAC'
    | 'NOTIFICATIONS'
    | 'API_DISPATCH'
    | 'SETTINGS'
    | 'SAAS_CONTROL'
    | 'DESIGNS'
    | 'AUTH'
    | 'WHATSAPP';
  action: string;
  entityId: string;
  summary: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface SaasTenantLab {
  id: string;
  code: string;
  name: string;
  nameNp?: string;
  entityType?: FacilityEntityType;
  panNumber: string;
  phone: string;
  address: string;
  ownerEmail: string;
  planName: 'Starter Clinic' | 'Professional Lab' | 'Enterprise Multi-Hub';
  status: 'Active' | 'Trial' | 'Suspended';
  maxRolesAllowed: number;
  allowedRoles: RoleId[];
  enabledModules: SaasModuleKey[];
  storageQuotaMb: number;
  storageUsedMb: number;
  controlReason?: string;
  createdAt: string;
}

export interface WhatsAppDispatchLog {
  id: string;
  timestamp: string;
  bsDate: string;
  recipientPhone: string;
  totalSalesNpr: number;
  ordersCount: number;
  messagePreview: string;
  sentBy: string;
  status: 'Sent via WhatsApp' | 'Logged';
}

export type SaasModuleKey =
  | 'core_lims'
  | 'radiology_imaging'
  | 'pharmacy_erp'
  | 'hospital_opd_ipd'
  | 'ot_management'
  | 'emergency_mlc'
  | 'darta_chalani'
  | 'dhis2_hmis'
  | 'pos_billing'
  | 'inventory_erp'
  | 'collection_centers'
  | 'referrals_engine'
  | 'collection_riders'
  | 'finance_counter'
  | 'hr_payroll'
  | 'dispatch_api';

export interface SaasModuleConfig {
  key: SaasModuleKey;
  name: string;
  description: string;
  category:
    | 'Clinical Core'
    | 'Billing & Finance'
    | 'Network & Logistics'
    | 'Compliance & Integrations';
  enabled: boolean;
  lockedCore: boolean;
  monthlyAddonNpr: number;
  storageFootprintMb: number;
  lastToggledAt?: string;
  lastToggledBy?: string;
  lastReason?: string;
}

export interface SaasControlConfig {
  tenantId: string;
  tenantDomain: string;
  planName: 'Starter Clinic' | 'Professional Lab' | 'Enterprise Multi-Hub';
  billingCycle: 'Monthly' | 'Annual';
  basePlanPriceNpr: number;
  storageQuotaMb: number;
  archivedReportMediaMb: number;
  maxStaffSeats: number;
  maxCollectionCenters: number;
  maxMonthlyOrders: number;
  maxRolesCapacity: number;
  allowedRoleIds: RoleId[];
  nextRenewalBs: string;
  status: 'Active' | 'Trial' | 'Grace Period';
  modules: SaasModuleConfig[];
}

export interface SaasStorageTelemetry {
  totalQuotaMb: number;
  totalUsedMb: number;
  percentUsed: number;
  dbFileBytes: number;
  breakdown: Array<{
    key: string;
    label: string;
    usedMb: number;
    recordCount: number;
  }>;
  seatsUsed: number;
  seatsMax: number;
  centersUsed: number;
  centersMax: number;
  monthlyOrdersCount: number;
  monthlyOrdersMax: number;
  monthlyRecurringNpr: number;
}

export type PharmacyDosageForm =
  | 'Tablet'
  | 'Capsule'
  | 'Syrup'
  | 'Injection'
  | 'IV Fluid'
  | 'Ointment'
  | 'Drops'
  | 'Inhaler'
  | 'Surgical'
  | 'Consumable';

export interface PharmacyMedicine {
  id: string;
  code: string;
  brandName: string;
  genericName: string;
  dosageForm: PharmacyDosageForm;
  strength: string;
  manufacturer: string;
  category: string;
  scheduleType: 'OTC' | 'Schedule H (Rx)' | 'Narcotic / DDA';
  rackLocation: string;
  unitLabel: string; // Tabs, Caps, Bottles, Vials
  vatApplicable: boolean;
  reorderLevel: number;
  defaultMrpNpr: number;
  inrMrp?: number;
  defaultPurchaseRateNpr?: number;
  active: boolean;
}

export interface PharmacyBatch {
  id: string;
  medicineId: string;
  centerId: string | null; // null = Main Central Pharmacy
  centerName: string;
  batchNumber: string;
  mfgDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD (FEFO sorts ascending by this date)
  quantityReceived: number;
  quantityOnHand: number;
  purchaseRateNpr: number;
  mrpNpr: number;
  inrMrp?: number;
  isOpeningStock?: boolean;
  supplierName: string;
  grnNumber: string;
  receivedAt: string;
  quarantined?: boolean;
}

export interface PharmacyDispenseLine {
  medicineId: string;
  medicineName: string;
  genericName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  unitPriceNpr: number;
  purchaseRateNpr?: number;
  lineTotalNpr: number;
}

export interface PharmacySupplier {
  id: string;
  code: string;
  name: string;
  contactPerson: string;
  phone: string;
  address: string;
  panVat?: string;
  paymentTerms: 'Cash on Delivery' | 'Credit 7 Days' | 'Credit 15 Days' | 'Credit 30 Days' | 'Credit 45 Days' | 'Credit 60 Days';
  creditDays: number;
  openingDueNpr: number;
  currentDueNpr: number;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface PharmacyManufacturer {
  id: string;
  code: string;
  name: string;
  country?: string;
  contactPhone?: string;
  address?: string;
  active: boolean;
  createdAt: string;
}

export interface HospitalAsset {
  id: string;
  assetCode: string;
  name: string;
  category: 'Medical Equipment' | 'Lab Analyzer' | 'Radiology / Imaging' | 'IT & Server' | 'Furniture & Building' | 'Ambulance / Vehicle' | 'Other Asset';
  departmentScope: 'HOSPITAL' | 'PHARMACY' | 'SHARED';
  location: string;
  purchaseDate: string;
  purchaseCostNpr: number;
  currentValueNpr: number;
  vendorName?: string;
  warrantyUntil?: string;
  status: 'Active' | 'Under Maintenance' | 'Disposed';
  notes?: string;
  createdAt: string;
}

export interface DiscountCreditApprovalHistoryEntry {
  id: string;
  timestamp: string;
  action: 'REQUESTED' | 'APPROVED_BY_MANAGER' | 'APPROVED_BY_ADMIN' | 'DECLINED';
  actorId: string;
  actorName: string;
  actorRole: RoleId;
  remarks?: string;
  statusAfter: FinanceApprovalStatus;
}

export interface DiscountCreditApprovalRequest {
  id: string;
  requestNumber: string;
  fiscalYear: string;
  createdAt: string;
  updatedAt: string;
  requestType: 'DISCOUNT_OVERRIDE' | 'CREDIT_LIMIT_OVERRIDE';
  sourceModule: 'HOSPITAL_POS' | 'PHARMACY_POS' | 'IPD' | 'EMERGENCY';
  approvalPolicy: 'MANAGER_THEN_ADMIN' | 'ADMIN_ONLY';
  patientName: string;
  uhid?: string;
  encounterLabel?: string;
  referenceId?: string;
  referenceCode?: string;
  billSubtotalNpr?: number;
  requestedValueNpr: number;
  requestedPercent?: number;
  currentLimitNpr?: number;
  reason: string;
  requesterId: string;
  requesterName: string;
  requesterRole: RoleId;
  status: FinanceApprovalStatus;
  managerReviewedBy?: string;
  managerReviewedAt?: string;
  managerRemarks?: string;
  adminReviewedBy?: string;
  adminReviewedAt?: string;
  adminRemarks?: string;
  consumedAt?: string;
  history: DiscountCreditApprovalHistoryEntry[];
}

export interface PharmacyDueSettlement {
  id: string;
  settledAt: string;
  settledBy: string;
  amountNpr: number;
  paymentMode: PaymentMode;
  note?: string;
}

export interface PharmacyDepositRecord {
  id: string;
  receiptNumber: string;
  patientId?: string;
  uhid?: string;
  patientName: string;
  patientPhone: string;
  encounterType: EncounterType;
  encounterId?: string;
  encounterLabel?: string;
  amountNpr: number;
  remainingBalanceNpr: number;
  paymentMode: PaymentMode;
  receivedById?: string;
  receivedBy: string;
  receivedAt: string;
  notes: string;
}

export interface PharmacyDispenseInvoice {
  id: string;
  invoiceNumber: string;
  fiscalYear: string;
  dispensedAt: string;
  centerId: string | null;
  centerName: string;
  patientId?: string;
  uhid?: string;
  encounterType?: EncounterType;
  encounterId?: string;
  encounterLabel?: string;
  nonInventoryBillOnly?: boolean;
  patientName: string;
  patientPhone: string;
  patientAge?: number;
  prescribingDoctor: string;
  linkedOrderAccession?: string;
  paymentMode: PaymentMode;
  cashPaid: number;
  bankPaid: number;
  depositAppliedNpr?: number;
  paidAmountNpr?: number;
  dueAmountNpr?: number;
  paymentStatus?: 'PAID' | 'PARTIAL' | 'CREDIT_DUE';
  creditLimitCheckedNpr?: number;
  dueSettlements?: PharmacyDueSettlement[];
  subtotalNpr: number;
  discountNpr: number;
  vatNpr: number;
  totalNpr: number;
  dispensedById?: string;
  dispensedBy: string;
  lines: PharmacyDispenseLine[];
}

export interface PharmacyMovement {
  id: string;
  timestamp: string;
  medicineId: string;
  medicineName: string;
  batchId: string;
  batchNumber: string;
  expiryDate: string;
  centerId: string | null;
  type: 'GRN_IN' | 'OPENING_STOCK' | 'FEFO_DISPENSE' | 'EXPIRED_WRITEOFF' | 'RETURN_ADJUST';
  quantityDelta: number;
  balanceAfter: number;
  referenceId: string;
  performedBy: string;
  notes: string;
}

export interface OpdConsultationTypeConfig {
  id: string;
  name: string;
  feeNpr: number;
  active: boolean;
}

export interface PoliceStationConfig {
  id: string;
  stationName: string;
  municipalityOrArea: string;
  address: string;
  phone: string;
  officerInCharge?: string;
  keywords: string[];
}

export interface GatepassVisitorRecord {
  id: string;
  passNumber: string;
  fiscalYear: string;
  passType: 'VISITOR' | 'PATIENT_CLEARANCE' | 'STAFF_GATEPASS' | 'MATERIAL_GATEPASS';
  personName: string;
  phone: string;
  purpose: string;
  departmentOrWard: string;
  linkedPatientOrRef?: string;
  vehicleOrBagInfo?: string;
  validUntil: string;
  issuedAt: string;
  issuedBy: string;
  clearanceVerifiedBy?: string;
  status: 'Active' | 'Cleared / Exited';
}

export interface AttendancePunchRecord {
  id: string;
  staffId: string;
  staffName: string;
  employeeCode: string;
  department: string;
  timestamp: string;
  bsDate: string;
  mode: 'HIKVISION_BIOMETRIC' | 'QR_SCAN' | 'MOBILE_GPS' | 'MANUAL' | 'ADMIN_MANUAL';
  deviceIdOrIp: string;
  punchType: 'CHECK_IN' | 'CHECK_OUT';
  shiftLabel: string;
  verificationCode?: string;
  qrSlot?: number;
  securityVerified?: boolean;
  isLate?: boolean;
  lateMinutes?: number;
  shiftComplianceNote?: string;
  gpsLat?: number;
  gpsLng?: number;
  isManualOverride?: boolean;
  overrideReason?: string;
  overriddenBy?: string;
  overriddenAt?: string;
  originalTimestamp?: string;
}

export interface HandoverAuditEntry {
  id: string;
  timestamp: string;
  action: 'SUBMITTED' | 'ACCEPTED' | 'REVISION_REQUESTED' | 'RESUBMITTED';
  actorName: string;
  note?: string;
}

export interface DutyHandoverRecord {
  id: string;
  handoverNumber: string;
  createdAt: string;
  bsDate: string;
  fromShift: string;
  toShift: string;
  department: string;
  outgoingStaffId: string;
  outgoingStaffName: string;
  incomingStaffId?: string;
  incomingStaffName: string;
  summaryNotes: string;
  pendingTasks: string;
  cashOrKeysCount: string;
  status: 'SENT' | 'RECEIVED_APPROVED' | 'REVISION_REQUESTED';
  receivedAt?: string;
  approvedBy?: string;
  revisionNote?: string;
  auditTrail?: HandoverAuditEntry[];
}

export interface StoreRequisitionRecord {
  id: string;
  reqNumber: string;
  createdAt: string;
  fiscalYear: string;
  department: 'OT' | 'ICU' | 'Emergency' | 'OPD' | 'IPD Ward' | 'Lab' | 'Radiology' | 'General Store';
  requestedBy: string;
  issuedBy: string;
  items: Array<{
    reagentId: string;
    reagentName: string;
    qty: number;
    unit: string;
  }>;
  status: 'Issued' | 'Pending';
  notes: string;
}

export interface MarketingVisitRecord {
  id: string;
  visitNumber: string;
  visitedAt: string;
  bsDate: string;
  areaName: string;
  municipality: string;
  facilityOrDoctorName: string;
  contactPerson: string;
  phone: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracyM?: number;
  photoDataUrl?: string;
  notes: string;
  staffId: string;
  staffName: string;
  status: 'Logged' | 'Follow-Up Required';
}

export type DigitalSignatureRoleKey =
  | 'CEO_CHAIRMAN'
  | 'PATHOLOGIST'
  | 'DOCTOR'
  | 'NURSE'
  | 'HOSPITAL_CASHIER'
  | 'PHARMACY_CASHIER'
  | 'RADIOLOGIST';

export interface DigitalSignatureAsset {
  roleKey: DigitalSignatureRoleKey;
  label?: string;
  roleLabel?: string;
  signerName: string;
  designation: string;
  regNo?: string;
  signatureDataUrl?: string;
  imageDataUrl?: string;
  active?: boolean;
}

export interface PrintOptionsConfig {
  defaultPaperSize: 'A5' | 'A4' | 'THERMAL_80MM';
  defaultLetterheadMode: 'with-letterhead' | 'without-letterhead';
  selectedReportDesignId?: string;
  selectedBillDesignId?: string;
  selectedPharmacyDesignId?: string;
  selectedOthersDesignId?: string;
  autoPrintByTemplate: {
    labReport: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    radiologyReport: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    posBill: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    pharmacyBill: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    admissionReceipt: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    emergencySlip?: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    opdSlip: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    ipdDeposition?: 'AUTO_PRINT' | 'MANUAL_PROMPT';
    certificates: 'AUTO_PRINT' | 'MANUAL_PROMPT';
  };
}

export interface NursingObservationTypeConfig {
  id: string;
  name: string;
  defaultFeeNpr: number;
  active?: boolean;
}

export type RegistrationFieldRule = 'REQUIRED' | 'OPTIONAL' | 'HIDDEN';

export type ChargeRateBasis = 'PER_DAY' | 'PER_ROUND';
export type IpdServiceChargeBasis = ChargeRateBasis;
export type IpdBedScheduleMode = 'CYCLE_WINDOW' | '24H_ELAPSED' | 'MIDNIGHT_CALENDAR';


export interface ModuleSettingsConfig {
  // Clinical LIMS & TAT
  tatWarningThresholdPercent: number;
  requireDoctorNameOnOrder: boolean;
  notifyCriticalPanicSms: boolean;
  // Radiology & Film
  requireFilmRetakeReason: boolean;
  autoDeductFilmOnSignoff: boolean;
  defaultDoseUnit: 'mSv' | 'mGy';
  // Pharmacy Separate Identity & PAN
  pharmacyEntityName?: string;
  pharmacyEntityNameNp?: string;
  pharmacyPanNumber?: string;
  pharmacyDdaLicense?: string;
  pharmacyPhone?: string;
  pharmacyAddress?: string;
  // Dynamic Hospital & Pharmacy Logos + Role Digital Signature Boxes
  hospitalLogoDataUrl?: string;
  pharmacyLogoDataUrl?: string;
  signatureBoxes?: DigitalSignatureAsset[];
  // Print Options & Global Defaults
  printOptions?: PrintOptionsConfig;
  // Custom Service Categories
  customServiceCategories?: string[];
  // 1-Computer LAN Desktop Server URL/IP for multi-PC Windows App connections
  lanServerHostIp?: string;
  // Pharmacy & FEFO
  strictFefoBlockExpired: boolean;
  pharmacyNearExpiryDays: number;
  pharmacyInvoicePrefix: string;
  showBatchExpiryOnPharmacyBill: boolean;
  // Document Prefixes (Bill, Report, Lab, OPD, IPD, ER, MLC, Gatepass, Referral, Voucher)
  billPrefix?: string;
  labOrderPrefix?: string;
  reportPrefix?: string;
  opdPrefix?: string;
  ipdPrefix?: string;
  erPrefix?: string;
  mlcPrefix?: string;
  gatepassPrefix?: string;
  referralPrefix?: string;
  voucherPrefix?: string;
  // Digital Signature & Verification Seal
  showDigitallyVerifiedSeal?: boolean;
  digitalVerifierName?: string;
  digitalVerifierDesignation?: string;
  digitalVerifierRegNo?: string;
  digitalSignatureText?: string;
  // POS, Finance & Counter Close
  defaultPosPaymentMode: PaymentMode;
  maxCashierDiscountPercent: number;
  cashierMaxDiscountNpr?: number;
  discountApprovalPolicy?: 'MANAGER_THEN_ADMIN' | 'ADMIN_ONLY';
  creditApprovalPolicy?: 'MANAGER_THEN_ADMIN' | 'ADMIN_ONLY';
  requireVarianceNoteOnClose: boolean;
  requireTwoTierFinanceApproval?: boolean;
  nonInventoryBillEnabled?: boolean;
  autoSyncBackupMinutes?: number;
  // Collection Centers & Riders (deprecated)
  enforceHardCreditStop: boolean;
  defaultCenterCreditLimitNpr: number;
  riderGpsRefreshSeconds: number;
  // Security, Perimeter Guard & Biometric Hikvision & Admin Erase PIN
  maxFailedAttemptsBeforeLock: number;
  enforceStrictCenterIsolation: boolean;
  hospitalAccessOnlyForStaff?: boolean;
  allowedHospitalIps?: string;
  hospitalWifiCheckCode?: string;
  hikvisionDeviceIp?: string;
  hikvisionDevicePort?: number;
  hikvisionDeviceName?: string;
  adminEraseSecretPin?: string;
  adminConfirmEmail?: string;
  // Emergency, OPD & IPD Dynamic Tariffs
  emergencyRegistrationFeeNpr?: number;
  emergencyTicketFeeNpr?: number;
  emergencyDefaultCreditLimitNpr?: number;
  defaultOpdConsultationFeeNpr?: number;
  opdFreeFollowUpDays?: number;
  opdFollowUpSameDoctorOnly?: boolean;
  opdFollowUpWithinWindowFeeNpr?: number;
  opdFollowUpFeeAfterExpiryNpr?: number;
  opdConsultationTypes?: OpdConsultationTypeConfig[];
  ipdAdmissionFeeNpr?: number;
  ipdDefaultCreditLimitNpr?: number;
  ipdBedCycleStartTime?: string; // e.g., "07:00"
  ipdBedCycleEndTime?: string; // e.g., "19:00"
  ipdBedChargeScheduleMode?: 'CYCLE_WINDOW' | '24H_ELAPSED' | 'MIDNIGHT_CALENDAR';
  ipdDoctorRoundFeeNpr?: number;
  ipdDoctorRoundBasis?: ChargeRateBasis;
  ipdDoctorRoundsPerDay?: number;
  ipdDoctorRoundScheduleTimes?: string;
  ipdNursingChargePerDayNpr?: number;
  ipdNursingChargeBasis?: ChargeRateBasis;
  ipdNursingRoundsPerDay?: number;
  ipdNursingScheduleTimes?: string;
  ipdDailyObservationFeeNpr?: number;
  ipdObservationChargeBasis?: ChargeRateBasis;
  ipdObservationRoundsPerDay?: number;
  ipdObservationScheduleTimes?: string;
  shiftPricing?: {
    bed: Record<'Morning' | 'Afternoon' | 'Night', number>;
    observation: Record<'Morning' | 'Afternoon' | 'Night', number>;
    nursing: Record<'Morning' | 'Afternoon' | 'Night', number>;
    doctorRound: Record<'Morning' | 'Afternoon' | 'Night', number>;
  };
  nursingObservationTypes?: NursingObservationTypeConfig[];
  autoDeductIpdMedFromPharmacyFefo?: boolean;
  markBedCleaningOnDischarge?: boolean;
  policeStations?: PoliceStationConfig[];
  // Dynamic Registration Field Rules (POS / OPD / ER / IPD)
  registrationFieldRules?: {
    pos?: Record<string, RegistrationFieldRule>;
    opd?: Record<string, RegistrationFieldRule>;
    er?: Record<string, RegistrationFieldRule>;
    ipd?: Record<string, RegistrationFieldRule>;
  };
  // Global Form Keyboard Navigation Mode (Enter <-> Tab dynamic control)
  keyboardNavigationMode?: 'ENTER_AS_TAB' | 'SWAP_ENTER_TAB' | 'STANDARD';
  // Dynamic UI & Referral Rules
  showDemoCredentialsOnLogin?: boolean;
  showErFeeFieldsInForm?: boolean;
  referralCaseRules?: ReferralCaseRule[];
  referralBillTierRules?: ReferralBillTierRule[];
  // Dynamic Rotating Attendance QR & TV Display Controls
  attendanceQrIntervalSeconds?: 60 | 90 | 120;
  attendanceAllowPreviousSlotGraceSec?: number;
  attendanceRequireRotatingQr?: boolean;
  attendanceCheckLateShift?: boolean;
  tvQueueSpeechEnabled?: boolean;
  tvQueueSpeechLanguage?: 'en-US' | 'en-IN' | 'ne-NP';
  tvQueueChimeEnabled?: boolean;
  referralWhatsAppTemplate?: ReferralWhatsAppTemplateConfig;
}

export type BedStatus = 'Available' | 'Occupied' | 'Cleaning' | 'Maintenance';
export type WardType =
  | 'General Ward'
  | 'Semi-Private Cabin'
  | 'Private Deluxe'
  | 'ICU / HDU'
  | 'Emergency / Obs'
  | 'NICU / Pediatric'
  | 'Maternity';

export interface HospitalBed {
  id: string;
  centerId: string | null; // null = Main Hospital / Central Hub
  centerName: string;
  wardName: string;
  wardType: WardType;
  bedCode: string;
  floorLabel: string;
  dailyRateNpr: number;
  hasOxygen: boolean;
  hasMonitor: boolean;
  status: BedStatus;
  currentAdmissionId?: string | null;
  currentPatientName?: string | null;
}

export interface ClinicalVitals {
  bp?: string;
  pulseBpm?: number;
  tempF?: number;
  spo2Pct?: number;
  respRate?: number;
  weightKg?: number;
}

export interface ClinicalUsedMedicineItem {
  id: string;
  administeredAt: string;
  medicineId?: string;
  medicineName: string;
  genericName?: string;
  dosageRoute: string; // e.g., "1g IV BD x 5 days" or "500mg PO TDS"
  quantity: number;
  unitPriceNpr: number;
  totalPriceNpr: number;
  batchNumber?: string;
  expiryDate?: string;
  deductedFromPharmacyFefo?: boolean;
  administeredBy: string;
}

export interface ClinicalInvestigationItem {
  id: string;
  orderedAt: string;
  serviceId?: string;
  serviceCode: string;
  serviceName: string;
  category: ServiceCategory;
  linkedOrderId?: string;
  linkedAccessionNumber?: string;
  status: 'Ordered' | 'Sample Collected' | 'Completed';
  summaryFinding?: string;
  priceNpr: number;
}

export interface ReferralAttachedBilledItem {
  id: string;
  source: 'POS_ORDER' | 'PHARMACY' | 'IPD_CHARGE' | 'OPD_ER';
  refNumber: string;
  dateIso: string;
  description: string;
  category: string;
  qty?: number;
  amountNpr: number;
  paymentStatus?: string;
}

export interface ReferralClinicalItem {
  id: string;
  source: 'POS_ORDER' | 'PHARMACY' | 'IPD_CHARGE' | 'OPD_ER';
  dateIso: string;
  category: string;
  description: string;
}

export interface ReferralCaseRule {
  id: string;
  caseType: string;
  mode: 'PERCENT' | 'FLAT';
  value: number;
  active: boolean;
}

export interface ReferralBillTierRule {
  id: string;
  label: string;
  minTotalBillNpr: number;
  commissionAmountNpr: number;
  active: boolean;
}

export interface ReferredHospitalMaster {
  id: string;
  name: string;
  address: string;
  phone?: string;
  managerName: string;
  managerPhone: string;
  specialties?: string;
  active: boolean;
  createdAt: string;
}

export interface AmbulanceMaster {
  id: string;
  name: string;
  vehicleNumber: string;
  vehicleType: 'ALS Ambulance' | 'BLS Ambulance' | 'Hospital Vehicle';
  driverName: string;
  driverPhone: string;
  defaultCommissionMode: 'PERCENT' | 'FLAT';
  defaultCommissionValue: number;
  caseOverrides?: ReferralCaseRule[];
  active: boolean;
  createdAt: string;
}

export interface AppointmentRecord {
  id: string;
  appointmentNumber: string;
  patientId?: string;
  uhid?: string;
  patientName: string;
  patientAge: number;
  patientAgeType: AgeType;
  patientGender: PatientGender;
  patientPhone: string;
  patientAddress: string;
  department: string;
  doctorName: string;
  appointmentDateAd: string;
  appointmentDateBs: string;
  timeSlot: string;
  reason: string;
  status: 'Scheduled' | 'Checked-In' | 'Completed' | 'Cancelled';
  linkedOpdVisitId?: string;
  createdAt: string;
  createdBy: string;
}

export interface HrCertificateRecord {
  id: string;
  certificateNumber: string;
  certificateType:
    | 'Experience Certificate'
    | 'Appointment Letter'
    | 'Relieving Letter'
    | 'Promotion Letter'
    | 'Salary Verification';
  staffId: string;
  employeeCode: string;
  staffName: string;
  designation: string;
  department: string;
  joinedAt: string;
  relievedAt?: string;
  basicSalaryNpr?: number;
  subject: string;
  documentBody: string;
  issuedAt: string;
  issuedDateBs: string;
  issuedBy: string;
  linkedChalaniNumber?: string;
}

export interface ExternalReferralDetail {
  referredHospitalId?: string;
  referredToHospital: string;
  referredToPlace: string; // City / District / Address
  referredHospitalManagerName?: string;
  referredHospitalManagerPhone?: string;
  referredDepartment: string;
  referralReason: string;
  conditionAtReferral: string;
  transportMode: 'ALS Ambulance' | 'BLS Ambulance' | 'Hospital Vehicle' | 'Private Vehicle';
  ambulanceId?: string;
  ambulanceName?: string;
  ambulanceNumber?: string;
  ambulanceDriverName?: string;
  ambulanceDriverPhone?: string;
  referralCaseType?: string;
  commissionMode?: 'PERCENT' | 'FLAT';
  commissionRateValue?: number;
  commissionCalculatedNpr?: number;
  commissionTierNote?: string;
  commissionPartnerId?: string;
  managerNotifiedCalled?: boolean;
  managerCalledAt?: string;
  managerCalledBy?: string;
  whatsappSentAt?: string;
  departureTime?: string;
  escortDoctorOrNurse?: string;
  caseDetails?: string;
  clinicalHistorySummary?: string;
  clinicalTreatmentItems?: ReferralClinicalItem[];
  attachedBilledItems?: ReferralAttachedBilledItem[];
  referredAt: string;
  referredBy: string;
}

export type OpdDispositionType =
  | 'Waiting'
  | 'In Consultation'
  | 'Discharged Home'
  | 'Admitted to IPD'
  | 'Referred to External Hospital';

export interface OpdVisit {
  id: string;
  tokenNumber: string;
  visitDate: string;
  fiscalYear: string;
  centerId: string | null;
  centerName: string;
  patientId?: string;
  uhid?: string;
  encounterLabel?: string;
  isFreeFollowUp?: boolean;
  patientName: string;
  patientAge: number;
  patientAgeType: AgeType;
  patientGender: PatientGender;
  patientPhone: string;
  patientAddress: string;
  department: string;
  consultingDoctor: string;
  chiefComplaint: string;
  vitals: ClinicalVitals;
  provisionalDiagnosis: string;
  clinicalNotes: string;
  consultationTypeName?: string;
  consultationFeeNpr: number;
  paymentMode: PaymentMode;
  prescribedMedicines: ClinicalUsedMedicineItem[];
  investigations: ClinicalInvestigationItem[];
  disposition: OpdDispositionType;
  linkedIpdAdmissionId?: string;
  externalReferral?: ExternalReferralDetail;
  followUpAdvice: string;
  recordedBy: string;
}

export interface BedTransferRecord {
  id: string;
  transferredAt: string;
  fromBedId: string;
  fromBedLabel: string;
  toBedId: string;
  toBedLabel: string;
  reason: string;
  authorizedBy: string;
}

export interface IpdPaymentDeposit {
  id: string;
  timestamp: string;
  amountNpr: number;
  paymentMode: PaymentMode;
  receiptNumber: string;
  notes: string;
  receivedBy: string;
}

export type IpdDispositionType =
  | 'Admitted'
  | 'Discharged'
  | 'Transferred to Ward/Hub'
  | 'Referred to External Hospital'
  | 'LAMA / DOR';

export interface NursingChartEntry {
  id: string;
  recordedAt: string;
  shift: 'Morning' | 'Afternoon' | 'Night';
  bp?: string;
  pulseBpm?: number;
  tempF?: number;
  spo2Pct?: number;
  respRate?: number;
  painScore?: number;
  gcsScore?: string;
  intakeOralMl?: number;
  intakeIvMl?: number;
  outputUrineMl?: number;
  outputDrainMl?: number;
  nursingCareNote: string;
  recordedBy: string;
}

export type ConsentTypeKey =
  | 'GENERAL_ADMISSION'
  | 'EMERGENCY_TREATMENT'
  | 'ICU_CRITICAL_CARE'
  | 'SURGERY_ANESTHESIA'
  | 'MLC_FORENSIC_EXAM'
  | 'MATERNITY_DELIVERY'
  | 'LAMA_DOR_RISK'
  | 'EXTERNAL_REFERRAL_TRANSPORT';

export interface HospitalConsentRecord {
  id: string;
  consentCode: string;
  consentType: ConsentTypeKey;
  title: string;
  autoReason: string;
  summaryText: string;
  patientOrGuardianName: string;
  relationship: string;
  witnessName: string;
  status: 'Auto-Assigned (Pending Signature)' | 'Signed & Verified';
  signedAt?: string;
  verifiedBy?: string;
  createdAt: string;
}

export type MlcCaseType =
  | 'RTA (Road Traffic Accident)'
  | 'Physical Assault / Injury'
  | 'Poisoning / Suspected Toxin'
  | 'Burn / Scald Injury'
  | 'Hanging / Self-Harm'
  | 'Industrial / Accidental Fall'
  | 'Brought Dead / Unnatural Death'
  | 'Sexual Assault / Forensic'
  | 'Other MLC';

export interface EmergencyCase {
  id: string;
  erNumber: string;
  registeredAt: string;
  fiscalYear: string;
  centerId: string | null;
  centerName: string;
  patientId?: string;
  uhid?: string;
  encounterLabel?: string;
  erTicketFeeNpr?: number;
  patientName: string;
  patientAge: number;
  patientAgeType: AgeType;
  patientGender: PatientGender;
  patientPhone: string;
  patientAddress: string;
  broughtByName: string;
  broughtByRelation: string;
  broughtByPhone: string;
  triageLevel: 'Red (Resuscitation)' | 'Yellow (Urgent)' | 'Green (Standard)' | 'Black (Brought Dead)';
  arrivalMode: 'Ambulance' | 'Police Escort' | 'Private Vehicle' | 'Walk-In';
  chiefComplaint: string;
  vitals: ClinicalVitals;
  erBedBay: string;
  attendingDoctor: string;
  clinicalNotes: string;
  // Medico-Legal Case (MLC) & Auto Police Station Workflow
  isMlc: boolean;
  mlcNumber?: string;
  mlcCaseType?: MlcCaseType;
  incidentPlace?: string;
  incidentTimeText?: string;
  identificationMarks?: string;
  injurySummary?: string;
  policeStationName?: string;
  policeStationAddress?: string;
  policeStationPhone?: string;
  policeInformed: boolean;
  policeInformedNumber?: string;
  policeInformedAt?: string;
  policeOfficerName?: string;
  policeInformMode?: 'Telephone Call' | 'Written Dispatch' | 'Police Escort / In-Person' | 'VHF / Wireless';
  policeInformedBy?: string;
  consents: HospitalConsentRecord[];
  disposition:
    | 'Under Observation (ER)'
    | 'Admitted to IPD'
    | 'Discharged from ER'
    | 'Referred to External Hospital'
    | 'LAMA / Absconded'
    | 'Expired / Brought Dead';
  linkedIpdAdmissionId?: string;
  externalReferral?: ExternalReferralDetail;
  erChargesNpr: number;
  creditLimitNpr?: number;
  pharmacyCreditDueNpr?: number;
  depositPaidNpr?: number;
  paymentMode: PaymentMode;
  isUnknownPatient?: boolean;
  selectedBedId?: string | null;
  erShift?: 'Morning' | 'Afternoon' | 'Night' | 'Morning (07:00-15:00)' | 'Afternoon (14:00-22:00)' | 'Night (21:30-07:30)';
  recordedBy: string;
}

export interface DartaChalaniAttachment {
  id: string;
  fileName: string;
  fileType: string;
  note: string;
  dataUrl?: string;
  attachedAt: string;
}

export interface DartaChalaniEntry {
  id: string;
  entryType: 'DARTA' | 'CHALANI';
  serialNo: number;
  entryNumber: string; // e.g., DARTA-2083/84-001 or CHALANI-2083/84-001
  refNumber: string; // पत्र संख्या / Ref No
  fiscalYear: string;
  entryDateAd: string;
  entryDateBs: string;
  partyName: string; // Sender (Darta) or Recipient (Chalani)
  partyAddress: string;
  subject: string;
  category:
    | 'Municipality / Health Section'
    | 'Police / MLC Correspondence'
    | 'DHIS2 / HMIS Submission'
    | 'Patient Referral / Clinical'
    | 'Vendor / Procurement'
    | 'HR / Internal Circular'
    | 'General Correspondence';
  department: string;
  handledBy: string;
  documentBody: string;
  attachments: DartaChalaniAttachment[];
  status: 'Pending Action' | 'Verified / Dispatched' | 'Filed / Archived';
  remarks: string;
  recordedBy: string;
}

export interface BirthCertificateRecord {
  id: string;
  certificateNumber: string;
  fiscalYear: string;
  issuedAt: string;
  linkedIpdAdmissionId?: string;
  motherName: string;
  motherAge: number;
  motherCitizenshipNo?: string;
  fatherName: string;
  fatherCitizenshipNo?: string;
  permanentAddress: string;
  babyName?: string;
  babyGender: 'Male' | 'Female' | 'Other';
  birthDateAd: string;
  birthDateBs: string;
  birthTime: string;
  birthWeightKg: number;
  deliveryType: 'Normal Vaginal Delivery' | 'LSCS (Cesarean Section)' | 'Assisted / Instrumental';
  apgar1Min: number;
  apgar5Min: number;
  placeOfBirth: string;
  attendingDoctor: string;
  issuedBy: string;
}

export interface DeathCertificateRecord {
  id: string;
  certificateNumber: string;
  fiscalYear: string;
  issuedAt: string;
  linkedIpdAdmissionId?: string;
  linkedEmergencyId?: string;
  deceasedName: string;
  age: number;
  ageType: AgeType;
  gender: PatientGender;
  citizenshipNo?: string;
  fatherOrSpouseName: string;
  permanentAddress: string;
  deathDateAd: string;
  deathDateBs: string;
  deathTime: string;
  wardOrPlaceOfDeath: string;
  immediateCauseOfDeath: string;
  antecedentCause?: string;
  mannerOfDeath: 'Natural' | 'Accident / RTA' | 'Assault / Homicide' | 'Suicide' | 'Pending Forensic';
  isMlc: boolean;
  mlcNumber?: string;
  policeStationNotified?: string;
  bodyHandedOverTo: string;
  handoverRelation: string;
  handoverPhone: string;
  certifyingDoctor: string;
  doctorRegNo: string;
  issuedBy: string;
}

export interface Dhis2MonthlyReport {
  id: string;
  reportCode: string;
  fiscalYear: string;
  bsYear: number;
  bsMonthIndex: number; // 1..12
  bsMonthName: string;
  generatedAt: string;
  municipalityTargetName: string; // Health Section, Bode Barsain Municipality, Saptari
  status: 'Draft' | 'Finalized & Printed' | 'Submitted & Received';
  // Section 1: Outpatient, Emergency & Inpatient Utilization
  opdNewFemale: number;
  opdNewMale: number;
  opdFollowupTotal: number;
  emergencyTotalVisits: number;
  emergencyMlcCases: number;
  ipdTotalAdmissions: number;
  ipdTotalBedDays: number;
  ipdTotalBedsAvailable: number;
  ipdBedOccupancyPercent: number;
  ipdDischargedHome: number;
  ipdReferredOut: number;
  ipdLamaCases: number;
  // Section 2: Safe Motherhood & Vital Events
  normalDeliveries: number;
  cesareanDeliveries: number;
  liveBirthsMale: number;
  liveBirthsFemale: number;
  lowBirthWeightCount: number;
  institutionalDeaths: number;
  maternalDeaths: number;
  neonatalDeaths: number;
  // Section 3: Diagnostics & Radiology
  pathologyTestsDone: number;
  xrayStudiesDone: number;
  usgEchoDone: number;
  ctEcgDone: number;
  // Section 4: Morbidity Surveillance Counts
  morbidityAriPneumonia: number;
  morbidityDiarrheaDysentery: number;
  morbidityHypertensionCvd: number;
  morbidityDiabetes: number;
  morbidityTraumaRta: number;
  morbidityEntericFever: number;
  // Section 5: Pharmacy & Logistics
  pharmacyStockoutItemsCount: number;
  pharmacyBillsIssued: number;
  remarks: string;
  preparedBy: string;
  approvedByDoctor: string;
  receivedByOfficer?: string;
  receivedAtBodeBarsain?: string;
  municipalityReceiptNo?: string;
}

export interface IpdMarRecord {
  id: string;
  timestamp: string;
  medicineName: string;
  doseRoute: string;
  givenBy: string;
  status: 'Given' | 'Held' | 'Refused';
  note?: string;
}

export interface NursingObservationFeeEntry {
  id: string;
  observationType: string;
  shift: 'Morning' | 'Evening' | 'Afternoon' | 'Night' | 'Morning (07:00-15:00)' | 'Afternoon (14:00-22:00)' | 'Night (21:30-07:30)';
  roundTime?: string;
  observationTime?: string;
  durationHours?: number;
  feeNpr: number;
  nurseName?: string;
  notes?: string;
  recordedAt: string;
  recordedBy?: string;
}

export interface IpdIndividualCashBill {
  id: string;
  billNumber: string;
  billedAt: string;
  billedById?: string;
  billedBy: string;
  category: 'ADMISSION' | 'BED_STAY' | 'NURSING' | 'OBSERVATION' | 'DOCTOR_ROUND' | 'PROCEDURE' | 'INVESTIGATION' | 'MEDICINE';
  shift?: 'Morning' | 'Afternoon' | 'Night';
  itemLabel: string;
  referenceItemId?: string;
  amountNpr: number;
  paymentMode: PaymentMode;
  notes?: string;
}

export interface IpdDirectServiceCharge {
  id: string;
  billedAt: string;
  billedBy: string;
  serviceName: string;
  category: 'BED_STAY' | 'NURSING' | 'OBSERVATION' | 'DOCTOR_ROUND' | 'PROCEDURE';
  shift?: 'Morning' | 'Afternoon' | 'Night';
  amountNpr: number;
  paymentMode: 'Cash' | 'Bank / QR' | 'Credit';
  cashBillNumber?: string;
  notes?: string;
}

export interface IpdAdmission {
  id: string;
  admissionNumber: string;
  admissionReceiptNumber?: string;
  admissionPaymentMode?: PaymentMode;
  admissionFeePaidAtAdmit?: boolean;
  fiscalYear: string;
  admittedAt: string;
  centerId: string | null;
  centerName: string;
  patientId?: string;
  uhid?: string;
  encounterLabel?: string;
  admissionFeeNpr?: number;
  creditLimitNpr?: number;
  creditApprovalStatus?: 'WITHIN_LIMIT' | 'PENDING_ADMIN_CREDIT' | 'APPROVED';
  creditApprovedBy?: string;
  creditApprovedAt?: string;
  creditApprovalNote?: string;
  linkedOpdVisitId?: string;
  linkedEmergencyId?: string;
  caseCategory?: 'General Medical' | 'Surgical' | 'ICU / Critical' | 'Maternity / OBG' | 'Pediatric / NICU' | 'MLC / Trauma';
  patientName: string;
  patientAge: number;
  patientAgeType: AgeType;
  patientGender: PatientGender;
  patientPhone: string;
  patientAddress: string;
  emergencyContact: string;
  admittingDoctor: string;
  department: string;
  currentBedId: string;
  currentBedLabel: string;
  currentWardName: string;
  bedDailyRateNpr: number;
  admittingDiagnosis: string;
  finalDiagnosis: string;
  hospitalCourseSummary: string;
  vitalsOnAdmission: ClinicalVitals;
  progressNotes: Array<{
    id: string;
    timestamp: string;
    note: string;
    shift?: string;
    roundTime?: string;
    recordedBy: string;
  }>;
  nursingCharts?: NursingChartEntry[];
  nursingObservationFees?: NursingObservationFeeEntry[];
  marRecords?: IpdMarRecord[];
  consents?: HospitalConsentRecord[];
  bedTransfers: BedTransferRecord[];
  usedMedicines: ClinicalUsedMedicineItem[];
  investigationsDone: ClinicalInvestigationItem[];
  directServiceCharges?: IpdDirectServiceCharge[];
  ipdIndividualBills?: IpdIndividualCashBill[];
  deposits: IpdPaymentDeposit[];
  disposition: IpdDispositionType;
  dischargedAt?: string;
  dischargeCondition?: string;
  dischargeAdvice?: string;
  followUpDateBs?: string;
  externalReferral?: ExternalReferralDetail;
  bedChargesNpr: number;
  bedDaysBilled?: number;
  doctorRoundsCount?: number;
  doctorRoundFeeNpr?: number;
  doctorRoundChargesNpr?: number;
  nursingDaysBilled?: number;
  nursingChargePerDayNpr?: number;
  nursingChargesNpr?: number;
  autoObservationDaysBilled?: number;
  autoObservationFeePerDayNpr?: number;
  autoObservationChargesNpr?: number;
  nursingObservationChargesNpr?: number;
  bedCycleWindowLabel?: string;
  medicinesTotalNpr: number;
  investigationsTotalNpr: number;
  otherProcedureChargesNpr: number;
  totalBillNpr: number;
  totalDepositPaidNpr: number;
  individualCashPaidTotalNpr?: number;
  balanceDueNpr: number;
  dischargedBy?: string;
}

export interface LabSettings {
  labName: string;
  labNameNp: string;
  legalEntityName: string;
  panNumber: string;
  accreditationLine: string;
  addressLine: string;
  contactLine: string;
  emailSender: string;
  adminWhatsAppNumber: string;
  resetSupportPhone: string;
  autoSendDailySalesWhatsApp: boolean;
  dailySalesWhatsAppTime: string;
  idleLockSeconds: number;
  developedBy: string;
  activeFiscalYear: string;
  autoEmailOnValidate: boolean;
  defaultWebhookUrl: string;
  prePrintedTopMarginMm: number;
  prePrintedBottomMarginMm: number;
  moduleSettings?: ModuleSettingsConfig;
}

export type DashboardWidgetId =
  | 'EXECUTIVE_SUMMARY'
  | 'PRIORITY_ALERTS'
  | 'LOW_STOCK_ALERTS'
  | 'KPI_GRID'
  | 'CLINICAL_OPS'
  | 'SHIFT_HANDOVER'
  | 'QR_ATTENDANCE'
  | 'WHATSAPP_DIGEST'
  | 'ANALYTICS_CHARTS'
  | 'TAT_WORKBENCH'
  | 'TAT_ALERTS_ONLY'
  | 'REFERRALS_AND_REAGENTS';

export interface DashboardLayoutConfig {
  roleId: RoleId;
  title: string;
  subtitle: string;
  widgets: DashboardWidgetId[];
}

export interface OtTheatreRoom {
  id: string;
  roomCode: string;
  name: string;
  specialty: string;
  status: 'Available' | 'Occupied' | 'Cleaning' | 'Maintenance';
  currentCaseId?: string | null;
}

export interface PreOpSafetyChecklist {
  completedAt: string;
  completedBy: string;
  vitalBp: string;
  vitalPulseBpm: number;
  vitalTempF: number;
  vitalSpo2Pct: number;
  asaGrade: 'ASA I' | 'ASA II' | 'ASA III' | 'ASA IV' | 'ASA V';
  anesthesiaCleared: boolean;
  anesthesiaClearedBy: string;
  surgicalSiteVerified: boolean;
  siteMarked: boolean;
  laterality: 'Left' | 'Right' | 'Bilateral' | 'Midline / N/A';
  procedureNameVerified: string;
  patientIdentityVerified: boolean;
  consentSignedVerified: boolean;
  npoConfirmed: boolean;
  bloodCrossmatchChecked: boolean;
  equipmentSterilityChecked: boolean;
  checklistNotes?: string;
  clearedToStart: boolean;
}

export interface AnesthesiaAgentDose {
  id: string;
  agentName: string;
  category:
    | 'Induction'
    | 'Analgesic'
    | 'Muscle Relaxant'
    | 'Volatile / Gas'
    | 'Local / Neuraxial'
    | 'Reversal / Emergency';
  dose: string;
  unit: string;
  route: string;
  timeGiven: string;
  givenBy: string;
}

export interface AnesthesiaAirwayLog {
  mallampatiGrade: 'Class I' | 'Class II' | 'Class III' | 'Class IV';
  airwayDevice:
    | 'ETT (Endotracheal Tube)'
    | 'LMA (Supraglottic)'
    | 'Face Mask'
    | 'Nasal Cannula / Neuraxial'
    | 'Tracheostomy';
  tubeSize?: string;
  cuffInflated?: boolean;
  intubationAttempts?: number;
  laryngoscopeView?: string;
  ventilatorMode?: string;
  tidalVolumeMl?: number;
  fio2Pct?: number;
  airwayNotes?: string;
}

export interface AnesthesiaVitalPoint {
  id: string;
  recordedAt: string;
  bp: string;
  pulseBpm: number;
  spo2Pct: number;
  etco2MmHg?: number;
  tempF?: number;
  patientResponseNote?: string;
}

export interface OtAnesthesiaRecord {
  anesthesiologistName: string;
  anesthesiaType:
    | 'General Anesthesia (GA)'
    | 'Spinal (Subarachnoid)'
    | 'Epidural'
    | 'Regional / Nerve Block'
    | 'Local / MAC Sedation';
  startedAt?: string;
  endedAt?: string;
  airwayLog: AnesthesiaAirwayLog;
  agentsUsed: AnesthesiaAgentDose[];
  vitalsLog: AnesthesiaVitalPoint[];
  ivFluidsGivenMl?: number;
  estimatedBloodLossMl?: number;
  complicationNotes?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface OtPostOpPacu {
  recordedAt: string;
  aldreteScore: number;
  bp?: string;
  spo2Pct?: number;
  painScore?: number;
  pacuNotes?: string;
  transferredTo: string;
  dischargedBy: string;
}

export interface OtSurgeryCase {
  id: string;
  otNumber: string;
  fiscalYear: string;
  centerId: string | null;
  centerName: string;
  otRoomId: string;
  otRoomLabel: string;
  patientId?: string;
  uhid?: string;
  encounterType: EncounterType;
  encounterId?: string;
  patientName: string;
  patientAge: number;
  patientAgeType: AgeType;
  patientGender: PatientGender;
  patientPhone: string;
  patientAddress: string;
  scheduledDate: string;
  scheduledTime: string;
  procedureName: string;
  surgicalSpecialty: string;
  priority: 'Elective' | 'Emergency';
  leadSurgeon: string;
  assistantSurgeon?: string;
  anesthesiologist: string;
  scrubNurse?: string;
  diagnosis: string;
  otFeeNpr: number;
  consumablesNotes?: string;
  status:
    | 'Scheduled'
    | 'Pre-Op Ready'
    | 'In Progress'
    | 'PACU Recovery'
    | 'Completed'
    | 'Cancelled';
  startedAt?: string;
  completedAt?: string;
  operativeNote?: string;
  preOpChecklist?: PreOpSafetyChecklist;
  anesthesiaRecord?: OtAnesthesiaRecord;
  postOpPacu?: OtPostOpPacu;
  recordedAt: string;
  recordedBy: string;
}

export interface LabAnalyzerMachine {
  id: string;
  code: string;
  name: string;
  department: LabServiceTest['department'];
  protocol: 'HL7_V2' | 'ASTM_E1394' | 'SERIAL_RS232' | 'HTTP_REST';
  connectionMode: 'BI_DIRECTIONAL' | 'UNI_DIRECTIONAL';
  endpointAddress: string; // e.g., 192.168.10.21:5100 or COM3
  status: 'Connected' | 'Standby' | 'Offline';
  autoApplyOnReceive: boolean;
  mappedAnalytes: string[];
  lastHeartbeatAt?: string;
  packetsProcessedCount: number;
}

export interface AnalyzerReadingItem {
  code: string;
  value: number | string;
  unit?: string;
  rawFlag?: string;
}

export interface AnalyzerResultMessage {
  id: string;
  receivedAt: string;
  analyzerId: string;
  analyzerName: string;
  protocol: LabAnalyzerMachine['protocol'];
  accessionNumber: string;
  status: 'PENDING' | 'APPLIED' | 'UNMATCHED' | 'IGNORED';
  matchedOrderId?: string;
  appliedCount?: number;
  rawPayload?: string;
  readings: AnalyzerReadingItem[];
  notes?: string;
}

export type QueueTokenDepartment =
  | 'OPD'
  | 'LAB'
  | 'RADIOLOGY'
  | 'PHARMACY'
  | 'EMERGENCY'
  | 'BILLING';

export type QueueTokenStatus =
  | 'ISSUED'
  | 'CHECKED_IN'
  | 'CALLING'
  | 'SERVING'
  | 'HOLD'
  | 'COMPLETED'
  | 'NO_SHOW';

export interface QueueTokenItem {
  id: string;
  tokenNumber: string;
  department: QueueTokenDepartment;
  counterOrRoom: string;
  patientId?: string;
  uhid?: string;
  patientName: string;
  patientPhone?: string;
  patientAddress?: string;
  sourceType: 'APPOINTMENT' | 'OPD' | 'ORDER' | 'WALKIN' | 'EMERGENCY';
  sourceId?: string;
  priority: 'NORMAL' | 'URGENT' | 'STAT' | 'SENIOR_CITIZEN';
  status: QueueTokenStatus;
  issuedAt: string;
  checkedInAt?: string;
  calledAt?: string;
  completedAt?: string;
  callCount: number;
  spokenAnnouncement?: string;
  createdBy: string;
}

export interface ReferralWhatsAppTemplateConfig {
  headerTitle: string;
  bodyTemplate: string;
  footerNote: string;
  includeAmbulanceDriver: boolean;
  includeVitals: boolean;
  includeClinicalSummary: boolean;
  includeTimestampBs: boolean;
  updatedAt?: string;
}

export interface LimsDatabase {
  settings: LabSettings;
  saas: SaasControlConfig;
  tenants: SaasTenantLab[];
  documentDesigns: DocumentDesignTemplate[];
  radiologyTemplates: RadiologyTemplate[];
  dashboardLayoutConfigs?: Record<string, DashboardLayoutConfig>;
  securityAlerts: SecurityAlert[];
  whatsappLogs: WhatsAppDispatchLog[];
  roles: RoleDefinition[];
  staff: StaffMember[];
  patients: PatientRecord[];
  services: LabServiceTest[];
  analyzers?: LabAnalyzerMachine[];
  analyzerQueue?: AnalyzerResultMessage[];
  reagents: ReagentItem[];
  inventoryMovements: InventoryMovement[];
  storeRequisitions: StoreRequisitionRecord[];
  pharmacyMedicines: PharmacyMedicine[];
  pharmacyBatches: PharmacyBatch[];
  pharmacyInvoices: PharmacyDispenseInvoice[];
  pharmacyDeposits?: PharmacyDepositRecord[];
  pharmacyMovements: PharmacyMovement[];
  pharmacySuppliers?: PharmacySupplier[];
  pharmacyManufacturers?: PharmacyManufacturer[];
  hospitalBeds: HospitalBed[];
  hospitalAssets?: HospitalAsset[];
  discountCreditApprovals?: DiscountCreditApprovalRequest[];
  opdVisits: OpdVisit[];
  ipdAdmissions: IpdAdmission[];
  emergencyCases: EmergencyCase[];
  otRooms?: OtTheatreRoom[];
  otCases?: OtSurgeryCase[];
  gatepasses: GatepassVisitorRecord[];
  attendanceLogs: AttendancePunchRecord[];
  shiftHandovers: DutyHandoverRecord[];
  marketingVisits: MarketingVisitRecord[];
  dartaChalani: DartaChalaniEntry[];
  birthCertificates: BirthCertificateRecord[];
  deathCertificates: DeathCertificateRecord[];
  dhis2Reports: Dhis2MonthlyReport[];
  centers: CollectionCenter[];
  centerAwards: CenterAwardRecord[];
  referrals: ReferralPartner[];
  referralPayoutRequests: ReferralPayoutRequest[];
  accounts: BankCashAccount[];
  financialLedger: FinancialLedgerEntry[];
  financeApprovalRequests: FinanceApprovalRequest[];
  counterCloses: CounterCloseRecord[];
  payrollRuns: PayrollRun[];
  riders: CollectionRider[];
  riderTasks: RiderPickupTask[];
  orders: LabOrder[];
  appointments?: AppointmentRecord[];
  queueTokens?: QueueTokenItem[];
  referredHospitalsMaster?: ReferredHospitalMaster[];
  ambulancesMaster?: AmbulanceMaster[];
  hrCertificates?: HrCertificateRecord[];
  emailNotifications: EmailNotification[];
  apiDispatches: ApiDispatchLog[];
  auditLogs: AuditLogEntry[];
}
