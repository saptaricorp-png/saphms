import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
import compression from 'compression';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'fs';
import { createServer as createHttpServer } from 'http';
import os from 'os';
import path from 'path';
import { createSeedDatabase, DEFAULT_DASHBOARD_LAYOUT_CONFIGS, LAB_TECH_STRICT_PERMISSIONS } from './server/seed';
import { NEPAL_HOSPITAL_SERVICES_CATALOG, NEPAL_PHARMACY_CATALOG, NEPAL_PHARMA_COMPANIES } from './server/nepalCatalog';
import { DEFAULT_LAB_ANALYZERS, ensureAnalyzerCodesOnService, NEPAL_LAB_TESTS_CATALOG } from './server/labCatalog';
import { applyReadingsToOrder, buildAnalyzerReadingsForOrder, parseAnalyzerPayload } from './server/analyzerBridge';
import {
  appendAudit,
  appendSecurityAlert,
  createLocalBackup,
  deleteLocalBackup,
  getActor,
  getDb,
  getDbFileSizeBytes,
  hasPermission,
  listLocalBackups,
  readLocalBackup,
  resetDb,
  restoreDbFromSnapshot,
  saveDb,
  scopeDbForActor,
} from './server/store';
import { buildZipBuffer, type ZipEntryInput } from './server/zipBuilder';
import {
  calculateAutoBedDays,
  computeIpdDailyAutoCharges,
  evaluateParameterFlag,
  evaluateParameterFormulas,
  getRefRange,
} from './src/utils/clinical';
import { adToBs } from './src/utils/nepaliDate';
import { normalizeNepalPhone } from './src/utils/textFormat';
import type {
  AgeType,
  AmbulanceMaster,
  AnalyzerReadingItem,
  AnalyzerResultMessage,
  ApiDispatchLog,
  AppointmentRecord,
  AttendancePunchRecord,
  BankCashAccount,
  BedStatus,
  BedTransferRecord,
  BirthCertificateRecord,
  ClinicalInvestigationItem,
  ClinicalUsedMedicineItem,
  ConsentTypeKey,
  CounterCloseRecord,
  DartaChalaniAttachment,
  DartaChalaniEntry,
  DeathCertificateRecord,
  Dhis2MonthlyReport,
  DashboardLayoutConfig,
  DiscountCreditApprovalRequest,
  DocumentDesignTemplate,
  DutyHandoverRecord,
  EmailNotification,
  EmergencyCase,
  EncounterType,
  ExternalReferralDetail,
  FinanceApprovalDirection,
  FinanceApprovalHistoryEntry,
  FinanceApprovalRequest,
  FinanceApprovalTransactionType,
  FinancialLedgerEntry,
  GatepassVisitorRecord,
  HospitalAsset,
  HospitalBed,
  HospitalConsentRecord,
  HrCertificateRecord,
  InventoryMovement,
  IpdAdmission,
  IpdDirectServiceCharge,
  IpdDispositionType,
  IpdIndividualCashBill,
  IpdMarRecord,
  IpdPaymentDeposit,
  LabAnalyzerMachine,
  LabOrder,
  LabServiceTest,
  LimsDatabase,
  MarketingVisitRecord,
  MlcCaseType,
  ModuleSettingsConfig,
  NursingChartEntry,
  NursingObservationFeeEntry,
  OpdDispositionType,
  OpdVisit,
  OrderTestItem,
  OtAnesthesiaRecord,
  OtPostOpPacu,
  OtSurgeryCase,
  PatientGender,
  PatientRecord,
  PaymentMode,
  PayrollLineItem,
  PayrollRun,
  PermissionKey,
  PharmacyBatch,
  PharmacyDepositRecord,
  PharmacyDispenseInvoice,
  PharmacyDispenseLine,
  PharmacyDueSettlement,
  PharmacyManufacturer,
  PharmacyMedicine,
  PharmacyMovement,
  PharmacySupplier,
  PoliceStationConfig,
  PreOpSafetyChecklist,
  RadiologyReportData,
  RadiologyTemplate,
  ReagentItem,
  ReferralAttachedBilledItem,
  ReferralClinicalItem,
  ReferralPartner,
  ReferralPayoutRequest,
  ReferredHospitalMaster,
  ResultFlag,
  RoleId,
  SaasControlConfig,
  SaasModuleKey,
  SaasStorageTelemetry,
  SaasTenantLab,
  StaffMember,
  StoreRequisitionRecord,
  WardType,
  WhatsAppDispatchLog,
} from './src/types/lims';

interface AuthedRequest extends Request {
  actor: StaffMember;
  db: LimsDatabase;
}

const activeImpersonations = new Map<string, string>(); // token -> saasAdminStaffId

function isModuleEnabled(db: LimsDatabase, key: SaasModuleKey): boolean {
  const mod = db.saas?.modules?.find((m) => m.key === key);
  return mod ? mod.enabled : true;
}

function attachEncounterBillingAndClinicalHistory(
  db: LimsDatabase,
  params: {
    baseReferral: ExternalReferralDetail;
    patientId?: string;
    uhid?: string;
    patientName: string;
    patientPhone: string;
    encounterType: EncounterType;
    encounterId?: string;
    admission?: IpdAdmission;
    erCase?: EmergencyCase;
    opdVisit?: OpdVisit;
  }
): ExternalReferralDetail {
  const {
    baseReferral,
    patientId,
    uhid,
    patientName,
    patientPhone,
    encounterType,
    encounterId,
    admission,
    erCase,
    opdVisit,
  } = params;
  const normPhone = (patientPhone || '').replace(/\D/g, '').slice(-10);
  const normName = (patientName || '').trim().toLowerCase();

  const matchesPatient = (
    pId?: string,
    u?: string,
    eId?: string,
    pName?: string,
    pPhone?: string
  ) => {
    if (encounterId && eId && eId === encounterId) return true;
    if (patientId && pId && pId === patientId) return true;
    if (uhid && u && u === uhid) return true;
    const ph = (pPhone || '').replace(/\D/g, '').slice(-10);
    if (normPhone && ph && normPhone === ph && (!pName || pName.trim().toLowerCase() === normName)) {
      return true;
    }
    return false;
  };

  const items: ReferralAttachedBilledItem[] = [];

  // 1. Hospital POS Orders (Lab, X-Ray, USG, Procedures)
  for (const ord of db.orders || []) {
    if (matchesPatient(ord.patientId, ord.uhid, ord.encounterId, ord.patientName, ord.patientPhone)) {
      const testDesc = (ord.tests || []).map((t) => `${t.serviceCode} ${t.serviceName}`).join(', ');
      items.push({
        id: `att-ord-${ord.id}`,
        source: 'POS_ORDER',
        refNumber: ord.invoiceNumber || ord.accessionNumber,
        dateIso: ord.orderedAt,
        description: `Diagnostics / Hospital POS (${ord.accessionNumber}): ${testDesc}`,
        category: ord.tests?.[0]?.serviceCategory || 'DIAGNOSTICS',
        qty: ord.tests?.length || 1,
        amountNpr: Number(ord.totalAmount) || 0,
        paymentStatus: ord.dueAmount > 0 ? `Due रू ${ord.dueAmount}` : `Paid (${ord.paymentMode})`,
      });
    }
  }

  // 2. Pharmacy Invoices (FEFO & Bill-Only)
  for (const inv of db.pharmacyInvoices || []) {
    if (matchesPatient(inv.patientId, inv.uhid, inv.encounterId, inv.patientName, inv.patientPhone)) {
      const medDesc = (inv.lines || []).map((l) => `${l.medicineName} ×${l.quantity}`).join(', ');
      items.push({
        id: `att-phm-${inv.id}`,
        source: 'PHARMACY',
        refNumber: inv.invoiceNumber,
        dateIso: inv.dispensedAt,
        description: `Pharmacy Medicines: ${medDesc}`,
        category: 'PHARMACY',
        qty: (inv.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0),
        amountNpr: Number(inv.totalNpr) || 0,
        paymentStatus:
          (inv.dueAmountNpr || 0) > 0
            ? `Credit Due रू ${inv.dueAmountNpr || 0}`
            : `Paid (${inv.paymentMode})`,
      });
    }
  }

  // 3. IPD charges, ward meds & investigations if IPD admission exists
  if (admission) {
    if (admission.bedChargesNpr > 0) {
      items.push({
        id: `att-ipd-bed-${admission.id}`,
        source: 'IPD_CHARGE',
        refNumber: admission.admissionNumber,
        dateIso: admission.admittedAt,
        description: `IPD Ward/Bed Stay (${admission.currentBedLabel}, ${admission.bedDaysBilled || 1} day(s))`,
        category: 'BED_STAY',
        qty: admission.bedDaysBilled || 1,
        amountNpr: admission.bedChargesNpr,
        paymentStatus: admission.balanceDueNpr > 0 ? 'IPD Ledger' : 'Settled',
      });
    }
    for (const chg of admission.directServiceCharges || []) {
      items.push({
        id: `att-ipd-chg-${chg.id}`,
        source: 'IPD_CHARGE',
        refNumber: chg.cashBillNumber || admission.admissionNumber,
        dateIso: chg.billedAt,
        description: chg.serviceName,
        category: chg.category,
        qty: 1,
        amountNpr: chg.amountNpr,
        paymentStatus: chg.paymentMode,
      });
    }
    for (const m of admission.usedMedicines || []) {
      items.push({
        id: `att-ipd-med-${m.id}`,
        source: 'IPD_CHARGE',
        refNumber: admission.admissionNumber,
        dateIso: m.administeredAt,
        description: `Ward Medication: ${m.medicineName} (${m.dosageRoute})`,
        category: 'WARD_MEDICINE',
        qty: m.quantity,
        amountNpr: m.totalPriceNpr,
        paymentStatus: 'IPD Ledger',
      });
    }
    for (const inv of admission.investigationsDone || []) {
      items.push({
        id: `att-ipd-inv-${inv.id}`,
        source: 'IPD_CHARGE',
        refNumber: inv.linkedAccessionNumber || admission.admissionNumber,
        dateIso: inv.orderedAt,
        description: `IPD Investigation: ${inv.serviceCode} ${inv.serviceName}${inv.summaryFinding ? ` — ${inv.summaryFinding}` : ''}`,
        category: inv.category,
        qty: 1,
        amountNpr: inv.priceNpr,
        paymentStatus: 'IPD Ledger',
      });
    }
  }

  // 4. ER ticket & resuscitation charges if ER case exists
  if (erCase) {
    const erTotal = (Number(erCase.erTicketFeeNpr) || 0) + (Number(erCase.erChargesNpr) || 0);
    if (erTotal > 0) {
      items.push({
        id: `att-er-${erCase.id}`,
        source: 'OPD_ER',
        refNumber: erCase.erNumber,
        dateIso: erCase.registeredAt,
        description: `ER Triage & Emergency Stabilization (${erCase.triageLevel} · ${erCase.erBedBay})`,
        category: 'EMERGENCY',
        qty: 1,
        amountNpr: erTotal,
        paymentStatus: erCase.paymentMode,
      });
    }
  }

  // 5. OPD consultation fee if OPD visit exists
  if (opdVisit && opdVisit.consultationFeeNpr > 0) {
    items.push({
      id: `att-opd-${opdVisit.id}`,
      source: 'OPD_ER',
      refNumber: opdVisit.tokenNumber,
      dateIso: opdVisit.visitDate,
      description: `OPD Consultation (${opdVisit.department} · ${opdVisit.consultingDoctor})`,
      category: 'CONSULTATION',
      qty: 1,
      amountNpr: opdVisit.consultationFeeNpr,
      paymentStatus: opdVisit.paymentMode,
    });
  }

  // Build concise historical clinical context
  const historyParts: string[] = [];
  if (erCase) {
    historyParts.push(
      `ER ${erCase.erNumber} (${erCase.triageLevel}): ${erCase.chiefComplaint}. Vitals: BP ${erCase.vitals?.bp || '—'}, PR ${erCase.vitals?.pulseBpm || '—'}, SpO2 ${erCase.vitals?.spo2Pct || '—'}%. Notes: ${erCase.clinicalNotes || '—'}${erCase.isMlc ? ` | MLC ${erCase.mlcNumber} (${erCase.mlcCaseType})` : ''}`
    );
  }
  if (admission) {
    historyParts.push(
      `IPD ${admission.admissionNumber} (${admission.currentWardName} ${admission.currentBedLabel}): Admitting Dx ${admission.admittingDiagnosis}; Final Dx ${admission.finalDiagnosis || admission.admittingDiagnosis}. Course: ${admission.hospitalCourseSummary || '—'}`
    );
  }
  if (opdVisit) {
    historyParts.push(
      `OPD ${opdVisit.tokenNumber} (${opdVisit.department}): ${opdVisit.chiefComplaint}; Dx: ${opdVisit.provisionalDiagnosis || '—'}`
    );
  }
  const prevVisits = (db.opdVisits || []).filter(
    (v) => v.id !== opdVisit?.id && matchesPatient(v.patientId, v.uhid, undefined, v.patientName, v.patientPhone)
  ).length;
  const prevAdmissions = (db.ipdAdmissions || []).filter(
    (a) => a.id !== admission?.id && matchesPatient(a.patientId, a.uhid, undefined, a.patientName, a.patientPhone)
  ).length;
  if (prevVisits > 0 || prevAdmissions > 0) {
    historyParts.push(`Prior History on Record: ${prevVisits} OPD visit(s), ${prevAdmissions} prior IPD admission(s).`);
  }

  const clinicalTreatmentItems: ReferralClinicalItem[] = [];

  for (const ord of db.orders || []) {
    if (matchesPatient(ord.patientId, ord.uhid, ord.encounterId, ord.patientName, ord.patientPhone)) {
      for (const t of ord.tests || []) {
        clinicalTreatmentItems.push({
          id: `clin-ord-${ord.id}-${t.serviceId}`,
          source: 'POS_ORDER',
          dateIso: ord.orderedAt,
          category: t.serviceCategory || 'DIAGNOSTICS',
          description: `${t.serviceName}${t.interpretation ? ` — ${t.interpretation}` : ''}`,
        });
      }
    }
  }

  for (const inv of db.pharmacyInvoices || []) {
    if (matchesPatient(inv.patientId, inv.uhid, inv.encounterId, inv.patientName, inv.patientPhone)) {
      for (const l of inv.lines || []) {
        clinicalTreatmentItems.push({
          id: `clin-phm-${inv.id}-${l.medicineId}`,
          source: 'PHARMACY',
          dateIso: inv.dispensedAt,
          category: 'PHARMACY MEDICINE',
          description: l.medicineName,
        });
      }
    }
  }

  if (admission) {
    for (const chg of admission.directServiceCharges || []) {
      clinicalTreatmentItems.push({
        id: `clin-ipd-chg-${chg.id}`,
        source: 'IPD_CHARGE',
        dateIso: chg.billedAt,
        category: chg.category,
        description: chg.serviceName,
      });
    }
    for (const m of admission.usedMedicines || []) {
      clinicalTreatmentItems.push({
        id: `clin-ipd-med-${m.id}`,
        source: 'IPD_CHARGE',
        dateIso: m.administeredAt,
        category: 'WARD MEDICATION',
        description: `${m.medicineName}${m.dosageRoute ? ` (${m.dosageRoute})` : ''}`,
      });
    }
    for (const inv of admission.investigationsDone || []) {
      clinicalTreatmentItems.push({
        id: `clin-ipd-inv-${inv.id}`,
        source: 'IPD_CHARGE',
        dateIso: inv.orderedAt,
        category: inv.category,
        description: `${inv.serviceName}${inv.summaryFinding ? ` — ${inv.summaryFinding}` : ''}`,
      });
    }
  }

  if (erCase) {
    clinicalTreatmentItems.push({
      id: `clin-er-${erCase.id}`,
      source: 'OPD_ER',
      dateIso: erCase.registeredAt,
      category: 'EMERGENCY CARE',
      description: `ER Triage (${erCase.triageLevel}) — ${erCase.chiefComplaint}`,
    });
  }

  if (opdVisit) {
    clinicalTreatmentItems.push({
      id: `clin-opd-${opdVisit.id}`,
      source: 'OPD_ER',
      dateIso: opdVisit.visitDate,
      category: 'OPD CONSULTATION',
      description: `${opdVisit.department} (${opdVisit.consultingDoctor}) — ${opdVisit.provisionalDiagnosis || opdVisit.chiefComplaint}`,
    });
    for (const pm of opdVisit.prescribedMedicines || []) {
      clinicalTreatmentItems.push({
        id: `clin-opd-med-${pm.id}`,
        source: 'OPD_ER',
        dateIso: pm.administeredAt || opdVisit.visitDate,
        category: 'OPD MEDICATION',
        description: `${pm.medicineName}${pm.dosageRoute ? ` (${pm.dosageRoute})` : ''}`,
      });
    }
  }

  // Compute combined first ER + Admission + POS bill total for dynamic case & tiered commission rules (commission metadata only, never shown on clinical print)
  const combinedPatientBillNpr = items.reduce((s, x) => s + (Number(x.amountNpr) || 0), 0);
  const ms = db.settings?.moduleSettings;
  const matchedHosp = baseReferral.referredHospitalId
    ? (db.referredHospitalsMaster || []).find((h) => h.id === baseReferral.referredHospitalId)
    : undefined;
  const matchedAmb = baseReferral.ambulanceId
    ? (db.ambulancesMaster || []).find((a) => a.id === baseReferral.ambulanceId)
    : undefined;

  const caseTypeStr = (baseReferral.referralCaseType || '').trim();
  const ambCaseRule = matchedAmb?.caseOverrides?.find(
    (r) => r.active && r.caseType.toLowerCase() === caseTypeStr.toLowerCase()
  );
  const globalCaseRule = (ms?.referralCaseRules || []).find(
    (r) => r.active && r.caseType.toLowerCase() === caseTypeStr.toLowerCase()
  );
  const chosenRule = ambCaseRule || globalCaseRule;

  let caseCommNpr = 0;
  let commMode: 'PERCENT' | 'FLAT' | undefined = baseReferral.commissionMode;
  let commRate: number | undefined = baseReferral.commissionRateValue;
  if (chosenRule) {
    commMode = chosenRule.mode;
    commRate = chosenRule.value;
    caseCommNpr =
      chosenRule.mode === 'PERCENT'
        ? Number(((combinedPatientBillNpr * chosenRule.value) / 100).toFixed(2))
        : Number(chosenRule.value || 0);
  } else if (matchedAmb) {
    commMode = matchedAmb.defaultCommissionMode;
    commRate = matchedAmb.defaultCommissionValue;
    caseCommNpr =
      matchedAmb.defaultCommissionMode === 'PERCENT'
        ? Number(((combinedPatientBillNpr * matchedAmb.defaultCommissionValue) / 100).toFixed(2))
        : Number(matchedAmb.defaultCommissionValue || 0);
  } else if (commMode && commRate !== undefined) {
    caseCommNpr =
      commMode === 'PERCENT'
        ? Number(((combinedPatientBillNpr * commRate) / 100).toFixed(2))
        : Number(commRate || 0);
  }

  const activeTiers = [...(ms?.referralBillTierRules || [])]
    .filter((t) => t.active && combinedPatientBillNpr >= t.minTotalBillNpr)
    .sort((a, b) => b.minTotalBillNpr - a.minTotalBillNpr);
  const matchedTier = activeTiers[0];
  const tierBonusNpr = matchedTier ? Number(matchedTier.commissionAmountNpr || 0) : 0;
  const totalCommissionNpr =
    baseReferral.commissionCalculatedNpr !== undefined
      ? Number(baseReferral.commissionCalculatedNpr)
      : Number((caseCommNpr + tierBonusNpr).toFixed(2));
  const tierNote = [
    chosenRule ? `${chosenRule.caseType}: ${chosenRule.mode === 'PERCENT' ? `${chosenRule.value}%` : `रू ${chosenRule.value}`}` : '',
    matchedTier ? `${matchedTier.label} (+रू ${matchedTier.commissionAmountNpr})` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const resolvedHistory =
    baseReferral.clinicalHistorySummary?.trim() ||
    historyParts.join(' | ') ||
    `${encounterType} encounter clinical referral`;

  return {
    ...baseReferral,
    referredHospitalId: baseReferral.referredHospitalId || matchedHosp?.id,
    referredToHospital: baseReferral.referredToHospital || matchedHosp?.name || '',
    referredToPlace: baseReferral.referredToPlace || matchedHosp?.address || '',
    referredHospitalManagerName:
      baseReferral.referredHospitalManagerName?.trim() || matchedHosp?.managerName || undefined,
    referredHospitalManagerPhone:
      baseReferral.referredHospitalManagerPhone?.trim() || matchedHosp?.managerPhone || undefined,
    ambulanceId: baseReferral.ambulanceId || matchedAmb?.id,
    ambulanceName: baseReferral.ambulanceName?.trim() || matchedAmb?.name || undefined,
    ambulanceNumber: baseReferral.ambulanceNumber?.trim() || matchedAmb?.vehicleNumber || undefined,
    ambulanceDriverName: baseReferral.ambulanceDriverName?.trim() || matchedAmb?.driverName || undefined,
    ambulanceDriverPhone: baseReferral.ambulanceDriverPhone?.trim() || matchedAmb?.driverPhone || undefined,
    commissionMode: commMode,
    commissionRateValue: commRate,
    commissionCalculatedNpr: totalCommissionNpr,
    commissionTierNote: baseReferral.commissionTierNote || tierNote || undefined,
    departureTime: baseReferral.departureTime?.trim() || undefined,
    caseDetails: baseReferral.caseDetails?.trim() || undefined,
    clinicalHistorySummary: resolvedHistory,
    clinicalTreatmentItems,
    attachedBilledItems: items,
  };
}

function detectCurrentShiftLabel(date = new Date()): 'Morning' | 'Afternoon' | 'Night' {
  const hr = date.getHours();
  if (hr >= 7 && hr < 14) return 'Morning';
  if (hr >= 14 && hr < 22) return 'Afternoon';
  return 'Night';
}

function withAuth(requiredPermission?: PermissionKey, requiredModule?: SaasModuleKey) {
  return (req: Request, res: Response, next: NextFunction) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || undefined;
    const actor = getActor(db, actorId);
    if (actor.status === 'Suspended') {
      res.status(403).json({ error: 'Operator account is suspended.' });
      return;
    }
    if (actor.isLocked) {
      res.status(423).json({
        error: `Account '${actor.username}' is locked (${actor.lockedReason || 'security lockout'}). Call Hospital Admin to reset with reason.`,
        code: 'ACCOUNT_LOCKED',
      });
      return;
    }
    if (requiredModule && !isModuleEnabled(db, requiredModule)) {
      const modName = db.saas.modules.find((m) => m.key === requiredModule)?.name || requiredModule;
      res.status(403).json({
        error: `Hospital Module Disabled: '${modName}' is currently turned off in Admin Control.`,
        code: 'MODULE_DISABLED',
      });
      return;
    }
    if (requiredPermission && !hasPermission(db, actor.roleId, requiredPermission)) {
      res.status(403).json({
        error: `Access denied: Role ${actor.roleId} lacks permission '${requiredPermission}'.`,
      });
      return;
    }
    (req as AuthedRequest).actor = actor;
    (req as AuthedRequest).db = db;
    next();
  };
}

function byteSizeMb(data: unknown): number {
  const bytes = Buffer.byteLength(JSON.stringify(data || []), 'utf-8');
  return Number((bytes / (1024 * 1024)).toFixed(3));
}

function computeSaasTelemetry(db: LimsDatabase): SaasStorageTelemetry {
  const dbFileBytes = getDbFileSizeBytes();
  const ordersMb = Number((byteSizeMb(db.orders) + db.orders.length * 0.42).toFixed(2));
  const catalogMb = Number(
    (byteSizeMb(db.services) + byteSizeMb(db.reagents) + byteSizeMb(db.inventoryMovements) + 42.5).toFixed(2)
  );
  const reportsArchiveMb = Number((db.saas.archivedReportMediaMb || 0).toFixed(2));
  const logsMb = Number(
    (
      byteSizeMb(db.auditLogs) +
      byteSizeMb(db.apiDispatches) +
      byteSizeMb(db.emailNotifications) +
      db.auditLogs.length * 0.08 +
      85.0
    ).toFixed(2)
  );
  const financeHrMb = Number(
    (
      byteSizeMb(db.financialLedger) +
      byteSizeMb(db.counterCloses) +
      byteSizeMb(db.payrollRuns) +
      byteSizeMb(db.referrals) +
      64.2
    ).toFixed(2)
  );
  const enabledModulesFootprintMb = db.saas.modules
    .filter((m) => m.enabled)
    .reduce((s, m) => s + (m.storageFootprintMb || 0), 0);

  const totalUsedMb = Number(
    (
      ordersMb +
      catalogMb +
      reportsArchiveMb +
      logsMb +
      financeHrMb +
      enabledModulesFootprintMb * 0.25
    ).toFixed(2)
  );
  const totalQuotaMb = Math.max(1024, db.saas.storageQuotaMb || 25600);
  const percentUsed = Number(Math.min(100, (totalUsedMb / totalQuotaMb) * 100).toFixed(2));

  const addonTotalNpr = db.saas.modules
    .filter((m) => m.enabled && !m.lockedCore)
    .reduce((sum, m) => sum + (m.monthlyAddonNpr || 0), 0);
  const monthlyRecurringNpr = (db.saas.basePlanPriceNpr || 0) + addonTotalNpr;

  return {
    totalQuotaMb,
    totalUsedMb,
    percentUsed,
    dbFileBytes,
    breakdown: [
      {
        key: 'reports_archive',
        label: 'A5/A4 Diagnostic Reports & Hospital Bills',
        usedMb: reportsArchiveMb,
        recordCount: db.orders.filter((o) => o.status === 'Validated').length + db.orders.length,
      },
      {
        key: 'orders_clinical',
        label: 'Orders, Analytes & Qualitative/Quantitative Results',
        usedMb: ordersMb,
        recordCount: db.orders.length,
      },
      {
        key: 'audit_dispatch',
        label: 'Immutable Audit Trail, Email & EMR API Logs',
        usedMb: logsMb,
        recordCount:
          db.auditLogs.length + db.apiDispatches.length + db.emailNotifications.length,
      },
      {
        key: 'finance_hr',
        label: 'Treasury Ledger, Counter Close & Payroll',
        usedMb: financeHrMb,
        recordCount:
          db.financialLedger.length +
          db.counterCloses.length +
          db.payrollRuns.length,
      },
      {
        key: 'catalog_bom',
        label: 'Hospital Service Master & Reagent BOM Inventory',
        usedMb: catalogMb,
        recordCount: db.services.length + db.reagents.length + db.inventoryMovements.length,
      },
    ],
    seatsUsed: db.staff.filter((s) => s.status !== 'Suspended').length,
    seatsMax: db.saas.maxStaffSeats,
    centersUsed: 0,
    centersMax: 0,
    monthlyOrdersCount: db.orders.length,
    monthlyOrdersMax: db.saas.maxMonthlyOrders,
    monthlyRecurringNpr,
  };
}

function buildFhirReportPayload(db: LimsDatabase, order: LabOrder) {
  const bs = adToBs(order.orderedAt);
  return {
    resourceType: 'DiagnosticReport',
    id: order.id,
    accessionNumber: order.accessionNumber,
    invoiceNumber: order.invoiceNumber,
    fiscalYear: order.fiscalYear,
    nepaliDate: bs.formattedEn,
    status: order.status === 'Validated' || order.status === 'Dispatched' ? 'final' : 'preliminary',
    issuedAt: order.validatedAt || new Date().toISOString(),
    laboratory: {
      name: db.settings.labName,
      accreditation: db.settings.accreditationLine,
    },
    patient: {
      name: order.patientName,
      age: `${order.patientAge} ${order.patientAgeType}`,
      gender: order.patientGender,
      address: order.patientAddress,
      phone: order.patientPhone,
      email: order.patientEmail,
    },
    referringPhysician: order.referringDoctor,
    collectionCenter: order.collectionCenterName,
    turnaroundTime: {
      orderedAt: order.orderedAt,
      dueAt: order.dueAt,
      validatedAt: order.validatedAt,
    },
    validatedBy: order.validatedByName
      ? {
          name: order.validatedByName,
          designation: order.validatedByDesignation,
          registrationNumber: order.validatedByRegNo,
        }
      : null,
    results: order.tests.map((t) => ({
      testCode: t.serviceCode,
      testName: t.serviceName,
      department: t.department,
      methodology: t.methodology,
      interpretation: t.interpretation,
      analytes: t.parameterResults.map((p) => ({
        name: p.parameterName,
        value: p.value,
        unit: p.unit,
        referenceRange: p.refRangeDisplay,
        flag: p.flag,
      })),
    })),
  };
}

async function dispatchApiReport(
  db: LimsDatabase,
  order: LabOrder,
  targetUrl: string,
  actor: StaffMember,
  port: number
): Promise<ApiDispatchLog> {
  const payload = buildFhirReportPayload(db, order);
  const payloadJson = JSON.stringify(payload, null, 2);
  const resolvedUrl = targetUrl.startsWith('/')
    ? `http://127.0.0.1:${port}${targetUrl}`
    : targetUrl;

  const start = Date.now();
  let httpStatus = 500;
  let responseBody = '';
  let status: 'Delivered' | 'Failed' = 'Failed';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(resolvedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Saptari-Signature': `sha256=${Buffer.from(order.accessionNumber).toString('base64')}`,
      },
      body: payloadJson,
      signal: controller.signal,
    });
    clearTimeout(timer);
    httpStatus = resp.status;
    responseBody = await resp.text();
    status = resp.ok ? 'Delivered' : 'Failed';
  } catch (err) {
    responseBody = err instanceof Error ? err.message : 'Network error during webhook dispatch';
    httpStatus = 502;
    status = 'Failed';
  }

  const latencyMs = Math.max(1, Date.now() - start);
  const logEntry: ApiDispatchLog = {
    id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    orderId: order.id,
    accessionNumber: order.accessionNumber,
    targetUrl,
    httpStatus,
    latencyMs,
    status,
    requestPayload: payloadJson,
    responseBody,
    triggeredBy: actor.fullName,
  };

  db.apiDispatches.unshift(logEntry);
  if (status === 'Delivered') {
    order.apiSent = true;
    order.apiSentAt = logEntry.timestamp;
  }
  appendAudit(
    db,
    actor,
    'API_DISPATCH',
    status === 'Delivered' ? 'API_REPORT_SENT' : 'API_REPORT_FAILED',
    order.accessionNumber,
    `API report dispatch to ${targetUrl} returned HTTP ${httpStatus} in ${latencyMs}ms.`,
    status === 'Delivered' ? 'INFO' : 'WARNING'
  );
  return logEntry;
}

function createEmailNotification(
  db: LimsDatabase,
  order: LabOrder,
  triggerType: 'AUTO_ON_VALIDATE' | 'MANUAL_RESEND',
  actor: StaffMember
): EmailNotification {
  const flaggedItems = order.tests
    .flatMap((t) => t.parameterResults)
    .filter((p) => p.flag !== 'NORMAL' && p.value !== null)
    .map((p) => `${p.parameterName}: ${p.value} ${p.unit} [${p.flag}]`);

  const summaryNote =
    flaggedItems.length > 0
      ? `Flagged findings: ${flaggedItems.slice(0, 4).join(', ')}.`
      : 'All evaluated analytes are within biological reference intervals.';

  const entry: EmailNotification = {
    id: `eml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    orderId: order.id,
    accessionNumber: order.accessionNumber,
    recipientEmail: order.patientEmail || 'patient@saptarihospital.com',
    subject: `Final Verified Hospital Report — Accession ${order.accessionNumber} (${order.patientName})`,
    triggerType,
    status: 'Sent',
    bodyPreview: `Dear ${order.patientName}, Your diagnostic report (${order.accessionNumber}) comprising ${order.tests
      .map((t) => t.serviceCode)
      .join(', ')} has been digitally verified by ${order.validatedByName || actor.fullName}. ${summaryNote} Refer to ${order.referringDoctor} for clinical correlation.`,
    triggeredBy: actor.fullName,
  };

  db.emailNotifications.unshift(entry);
  order.emailSent = true;
  order.emailSentAt = entry.timestamp;

  appendAudit(
    db,
    actor,
    'NOTIFICATIONS',
    'EMAIL_DISPATCHED',
    order.accessionNumber,
    `${triggerType === 'AUTO_ON_VALIDATE' ? 'Automated' : 'Manual'} report email sent to ${entry.recipientEmail}.`,
    'INFO'
  );

  return entry;
}

function postLedgerMovement(
  db: LimsDatabase,
  account: BankCashAccount,
  direction: 'INFLOW' | 'OUTFLOW',
  amount: number,
  category: FinancialLedgerEntry['category'],
  referenceId: string,
  description: string,
  fiscalYear: string,
  actor: StaffMember
): void {
  const val = Number(amount) || 0;
  if (val <= 0) return;
  account.currentBalance = Number(
    (direction === 'INFLOW' ? account.currentBalance + val : account.currentBalance - val).toFixed(2)
  );
  db.financialLedger.unshift({
    id: `fin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
    fiscalYear,
    accountId: account.id,
    accountName: account.name,
    category,
    direction,
    amount: val,
    balanceAfter: account.currentBalance,
    referenceId,
    description,
    recordedBy: actor.fullName,
  });
}

function computeTestReferralCommission(
  partner: ReferralPartner | undefined,
  service: LabServiceTest
): number {
  if (!partner || !partner.active) return 0;
  const override = partner.testOverrides.find((o) => o.serviceId === service.id);
  const mode = override ? override.mode : partner.defaultMode;
  const val = override ? override.value : partner.defaultValue;
  if (mode === 'FLAT') {
    return Number(val.toFixed(2));
  }
  return Number(((service.price * val) / 100).toFixed(2));
}

function autoDetectPoliceStation(
  placeText: string,
  directory?: PoliceStationConfig[]
): {
  stationName: string;
  stationAddress: string;
  stationPhone: string;
} {
  const s = (placeText || '').toLowerCase();
  if (Array.isArray(directory) && directory.length > 0) {
    for (const st of directory) {
      const kws = Array.isArray(st.keywords) ? st.keywords : [];
      if (
        kws.some((k) => k && s.includes(k.toLowerCase())) ||
        (st.municipalityOrArea && s.includes(st.municipalityOrArea.toLowerCase()))
      ) {
        return {
          stationName: st.stationName,
          stationAddress: st.address,
          stationPhone: st.phone,
        };
      }
    }
    const def = directory[0];
    return {
      stationName: def.stationName,
      stationAddress: def.address,
      stationPhone: def.phone,
    };
  }
  if (s.includes('kalyanpur') || s.includes('khoksar')) {
    return {
      stationName: 'Prahari Chowki, Kalyanpur',
      stationAddress: 'Kalyanpur Bazaar, Saptari, Nepal',
      stationPhone: '031-560144',
    };
  }
  if (s.includes('kadarbona') || s.includes('shambhunath') || s.includes('surunga')) {
    return {
      stationName: 'Ilaka Prahari Karyalaya, Kadarbona',
      stationAddress: 'East-West Highway, Kadarbona, Saptari, Nepal',
      stationPhone: '031-560188',
    };
  }
  if (s.includes('rajbiraj') || s.includes('district')) {
    return {
      stationName: 'District Police Office (Jilla Prahari Karyalaya), Saptari',
      stationAddress: 'Rajbiraj-04, Saptari, Nepal',
      stationPhone: '031-520100',
    };
  }
  if (s.includes('pato') || s.includes('dakneshwori') || s.includes('belhi')) {
    return {
      stationName: 'Prahari Chowki, Pato / Dakneshwori',
      stationAddress: 'Dakneshwori Municipality, Saptari, Nepal',
      stationPhone: '031-560166',
    };
  }
  return {
    stationName: 'Ilaka Prahari Karyalaya (Area Police Office), Bode Barsain',
    stationAddress: 'Bode Barsain-05, Saptari, Nepal',
    stationPhone: '031-560100',
  };
}

function upsertPatientMaster(
  db: LimsDatabase,
  info: {
    patientId?: string;
    uhid?: string;
    fullName: string;
    age: number;
    ageType: AgeType;
    gender: PatientGender;
    phone?: string;
    address?: string;
    email?: string;
    actorName: string;
    encounterType?: EncounterType;
  }
): PatientRecord {
  if (!Array.isArray(db.patients)) db.patients = [];
  const nowIso = new Date().toISOString();
  const bsNow = adToBs(nowIso);
  let existing =
    (info.patientId && db.patients.find((p) => p.id === info.patientId)) ||
    (info.uhid && db.patients.find((p) => p.uhid === info.uhid)) ||
    db.patients.find(
      (p) =>
        p.fullName.toLowerCase() === info.fullName.trim().toLowerCase() &&
        (!info.phone || !p.phone || p.phone === info.phone.trim())
    );
  const normalizedPhone = normalizeNepalPhone(info.phone);
  if (existing) {
    existing.totalEncounters = (existing.totalEncounters || 0) + 1;
    if (normalizedPhone) existing.phone = normalizedPhone;
    if (info.address?.trim()) existing.address = info.address.trim();
    if (info.email?.trim()) existing.email = info.email.trim();
    if (info.encounterType === 'OPD') existing.lastOpdVisitAt = nowIso;
    return existing;
  }
  const seq = 101 + db.patients.length;
  const created: PatientRecord = {
    id: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    uhid: info.uhid?.trim() || `SHP-UHID-${bsNow.year}-${seq}`,
    fullName: info.fullName.trim(),
    age: Number(info.age) || 30,
    ageType: info.ageType || 'Years',
    gender: info.gender || 'Male',
    phone: normalizedPhone,
    address: info.address?.trim() || '',
    email: info.email?.trim() || '',
    createdAt: nowIso,
    createdBy: info.actorName,
    lastOpdVisitAt: info.encounterType === 'OPD' ? nowIso : undefined,
    totalEncounters: 1,
  };
  db.patients.unshift(created);
  return created;
}

const CONSENT_CATALOG: Record<
  ConsentTypeKey,
  { title: string; caseTriggerRule: string; summaryText: string }
> = {
  GENERAL_ADMISSION: {
    title: 'General Inpatient Admission & Clinical Investigation Consent',
    caseTriggerRule: 'Auto-assigned on IPD Admission',
    summaryText:
      'Consent for routine hospital stay, diagnostic investigations, IV cannulation, medications, and nursing care at Saptari Hospital Pvt Ltd.',
  },
  EMERGENCY_TREATMENT: {
    title: 'Emergency Stabilization & Urgent Intervention Consent',
    caseTriggerRule: 'Auto-assigned on ER Triage Registration',
    summaryText:
      'Consent for emergency resuscitation, analgesia, suturing, oxygenation, and urgent lifesaving stabilization.',
  },
  ICU_CRITICAL_CARE: {
    title: 'ICU / High-Dependency Critical Care Consent',
    caseTriggerRule: 'Auto-assigned on ICU/HDU Bed or Red Triage',
    summaryText:
      'Informed high-risk critical care consent covering continuous monitoring, vasopressors, airway/ventilatory support, and prognosis explanation.',
  },
  SURGERY_ANESTHESIA: {
    title: 'Surgical / Operative Procedure & Anesthesia Consent',
    caseTriggerRule: 'Auto-assigned for Surgical/Operative Cases',
    summaryText:
      'Procedural & anesthesia risk-benefit informed consent for surgical intervention and post-operative care.',
  },
  MLC_FORENSIC_EXAM: {
    title: 'Medico-Legal Case (MLC) Clinical Examination & Police Intimation Consent',
    caseTriggerRule: 'Auto-assigned on Medico-Legal Case (MLC)',
    summaryText:
      'Medico-legal injury documentation, forensic evidence preservation, and mandatory Nepal Police station intimation acknowledgement.',
  },
  MATERNITY_DELIVERY: {
    title: 'Maternity, Labor & Obstetric Delivery Consent',
    caseTriggerRule: 'Auto-assigned on Maternity / OBG Cases',
    summaryText:
      'Consent for antenatal/intrapartum monitoring, normal vaginal delivery, episiotomy, or emergency cesarean backup.',
  },
  LAMA_DOR_RISK: {
    title: 'Discharge on Request (DOR) / Left Against Medical Advice (LAMA) Consent',
    caseTriggerRule: 'Auto-assigned on LAMA / DOR Disposition',
    summaryText:
      'High-risk declaration acknowledging medical risks of discontinuing inpatient treatment against medical advice.',
  },
  EXTERNAL_REFERRAL_TRANSPORT: {
    title: 'Higher-Center Emergency Referral & Ambulance Transfer Consent',
    caseTriggerRule: 'Auto-assigned on External Hospital Referral',
    summaryText:
      'Informed transit consent explaining patient clinical stability, ambulance transport risks, and external tertiary hospital handover.',
  },
};

function autoAssignConsents(opts: {
  context: 'ER' | 'IPD';
  caseCategory?: string;
  wardName?: string;
  isMlc?: boolean;
  mlcType?: string;
  patientName: string;
  guardianName?: string;
  createdAt: string;
}): HospitalConsentRecord[] {
  const keys = new Set<ConsentTypeKey>();
  if (opts.context === 'ER') {
    keys.add('EMERGENCY_TREATMENT');
  } else {
    keys.add('GENERAL_ADMISSION');
  }
  const blob = `${opts.caseCategory || ''} ${opts.wardName || ''} ${opts.mlcType || ''}`.toLowerCase();
  if (opts.isMlc || (opts.mlcType && opts.mlcType !== 'None')) {
    keys.add('MLC_FORENSIC_EXAM');
  }
  if (blob.includes('icu') || blob.includes('critical') || blob.includes('cardiac') || blob.includes('hdu')) {
    keys.add('ICU_CRITICAL_CARE');
  }
  if (blob.includes('surg') || blob.includes('ot') || blob.includes('append') || blob.includes('ortho')) {
    keys.add('SURGERY_ANESTHESIA');
  }
  if (blob.includes('matern') || blob.includes('obg') || blob.includes('deliver') || blob.includes('gyne')) {
    keys.add('MATERNITY_DELIVERY');
  }
  if (blob.includes('lama')) {
    keys.add('LAMA_DOR_RISK');
  }
  if (blob.includes('refer')) {
    keys.add('EXTERNAL_REFERRAL_TRANSPORT');
  }

  return Array.from(keys).map((k, idx) => {
    const def = CONSENT_CATALOG[k];
    return {
      id: `cns-auto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      consentCode: `CNS-${k.slice(0, 3)}-${Math.floor(100 + Math.random() * 899)}`,
      consentType: k,
      title: def.title,
      autoReason: def.caseTriggerRule,
      summaryText: def.summaryText,
      patientOrGuardianName: opts.guardianName || opts.patientName,
      relationship: opts.guardianName ? 'Next of Kin / Guardian' : 'Self',
      witnessName: '',
      status: 'Auto-Assigned (Pending Signature)',
      createdAt: opts.createdAt,
    };
  });
}

function parseCliPort(): number | null {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--port' && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (args[i].startsWith('--port=')) {
      const n = Number(args[i].split('=')[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const cliPort = parseCliPort();
  const rawEnvPort = process.env.PORT?.trim();
  const isSocketPort =
    !cliPort &&
    Boolean(rawEnvPort) &&
    (rawEnvPort!.startsWith('/') || rawEnvPort!.toLowerCase() === 'passenger');
  const PORT: number = cliPort || (Number(rawEnvPort) > 0 ? Number(rawEnvPort) : 3000);
  const LISTEN_TARGET: number | string = isSocketPort ? (rawEnvPort as string) : PORT;

  app.disable('x-powered-by');
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: '50mb' }));

  const getLocalLanIps = (): string[] => {
    const nets = os.networkInterfaces();
    const ips: string[] = [];
    for (const ifaceList of Object.values(nets)) {
      if (!Array.isArray(ifaceList)) continue;
      for (const net of ifaceList) {
        if (net.family === 'IPv4' && !net.internal && net.address) {
          ips.push(net.address);
        }
      }
    }
    return Array.from(new Set(ips));
  };

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      app: 'SHPL',
      platform: process.platform,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      lanUrls: getLocalLanIps().map((ip) => `http://${ip}:${PORT}`),
    });
  });

  app.get('/api/system/network-info', (_req: Request, res: Response) => {
    const db = getDb();
    const localIps = getLocalLanIps();
    const configuredLanIp = db.settings?.moduleSettings?.lanServerHostIp || localIps[0] || '192.168.1.100';
    res.json({
      appName: 'SHPL',
      port: PORT,
      platform: process.platform,
      localIps,
      lanUrls: localIps.map((ip) => `http://${ip}:${PORT}`),
      configuredLanIp,
      configuredUrl: `http://${configuredLanIp}:${PORT}`,
    });
  });

  app.post('/api/emr-webhook-receiver', (req: Request, res: Response) => {
    const payload = req.body;
    res.status(200).json({
      received: true,
      emrStatus: 'ACCEPTED',
      hl7Ack: 'AA',
      accessionNumber: payload?.accessionNumber || 'UNKNOWN',
      receivedAt: new Date().toISOString(),
    });
  });

  app.get('/api/bootstrap', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const ms = db.settings?.moduleSettings;
    let changed = false;
    for (const adm of db.ipdAdmissions || []) {
      if (adm.disposition === 'Admitted') {
        const prevDays = adm.bedDaysBilled;
        const prevBill = adm.totalBillNpr;
        const prevRounds = adm.doctorRoundChargesNpr;
        const prevNursing = adm.nursingChargesNpr;
        const prevObs = adm.autoObservationChargesNpr;
        recalcIpdFinancials(adm, ms);
        if (
          adm.bedDaysBilled !== prevDays ||
          adm.totalBillNpr !== prevBill ||
          adm.doctorRoundChargesNpr !== prevRounds ||
          adm.nursingChargesNpr !== prevNursing ||
          adm.autoObservationChargesNpr !== prevObs
        ) {
          changed = true;
        }
      }
    }
    if (changed) saveDb(db);
    res.json({
      db: scopeDbForActor(db, actor),
      activeUser: actor,
      telemetry: computeSaasTelemetry(db),
    });
  });

  // Role-based Dashboard Layout Configuration (Admin -> Global Analytics, Lab Tech -> Pending TAT Alerts Only)
  app.get('/api/dashboard/layout-config', withAuth('dashboard.view'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const requestedRole = typeof req.query.roleId === 'string' ? (req.query.roleId as RoleId) : actor.roleId;
    const targetRole: RoleId =
      actor.roleId === 'SUPER_ADMIN' || actor.roleId === 'SAAS_ADMIN' ? requestedRole : actor.roleId;
    const fallbackConfig =
      DEFAULT_DASHBOARD_LAYOUT_CONFIGS[targetRole] || DEFAULT_DASHBOARD_LAYOUT_CONFIGS.SUPER_ADMIN;
    const layoutConfig =
      targetRole === 'LAB_TECH'
        ? DEFAULT_DASHBOARD_LAYOUT_CONFIGS.LAB_TECH
        : db.dashboardLayoutConfigs?.[targetRole] || fallbackConfig;
    res.json({
      roleId: targetRole,
      layoutConfig,
      allConfigs:
        actor.roleId === 'SUPER_ADMIN' || actor.roleId === 'SAAS_ADMIN'
          ? db.dashboardLayoutConfigs || DEFAULT_DASHBOARD_LAYOUT_CONFIGS
          : undefined,
    });
  });

  app.put('/api/dashboard/layout-config', withAuth('settings.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN' && actor.roleId !== 'SAAS_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin can update role dashboard layout configurations.' });
      return;
    }
    const body = req.body as Partial<DashboardLayoutConfig> & { roleId?: RoleId };
    const roleId = body.roleId;
    if (!roleId || (!DEFAULT_DASHBOARD_LAYOUT_CONFIGS[roleId] && !db.roles.some((r) => r.id === roleId))) {
      res.status(400).json({ error: 'Valid roleId is required.' });
      return;
    }
    if (!db.dashboardLayoutConfigs) {
      db.dashboardLayoutConfigs = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS };
    }
    const base = db.dashboardLayoutConfigs[roleId] || DEFAULT_DASHBOARD_LAYOUT_CONFIGS[roleId] || {
      roleId,
      title: `${roleId} Workspace`,
      subtitle: 'Custom Hospital Role Dashboard',
      widgets: ['EXECUTIVE_SUMMARY', 'PRIORITY_ALERTS', 'KPI_GRID', 'CLINICAL_OPS', 'SHIFT_HANDOVER'],
    };
    db.dashboardLayoutConfigs[roleId] = {
      roleId,
      title: body.title?.trim() || base.title,
      subtitle: body.subtitle?.trim() || base.subtitle,
      widgets: Array.isArray(body.widgets) && body.widgets.length > 0 ? body.widgets : base.widgets,
    };
    appendAudit(
      db,
      actor,
      'SETTINGS',
      'DASHBOARD_LAYOUT_UPDATED',
      roleId,
      `Updated dashboard layout_config for role ${roleId}.`
    );
    saveDb(db);
    res.json({ layoutConfig: db.dashboardLayoutConfigs[roleId], db: scopeDbForActor(db, actor) });
  });

  app.post('/api/reset-demo', withAuth('settings.manage'), (req: Request, res: Response) => {
    const { actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN' && actor.roleId !== 'SAAS_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin can reset demo state.' });
      return;
    }
    const fresh = resetDb();
    const preservedActor = fresh.staff.find((s) => s.id === actor.id) || fresh.staff[1] || fresh.staff[0];
    res.json({
      db: scopeDbForActor(fresh, preservedActor),
      activeUser: preservedActor,
      telemetry: computeSaasTelemetry(fresh),
    });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const db = getDb();
    const { username, password } = req.body as { username?: string; password?: string };
    const cleanUser = (username || '').trim();
    const cleanPass = password || '';

    if (!cleanUser || !cleanPass) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    if (cleanUser.includes('@') || /^\+?[\d\s\-()]{7,}$/.test(cleanUser)) {
      res.status(400).json({
        error: 'Login requires Username & Password only. Email address and phone number login are disabled.',
      });
      return;
    }

    const user = db.staff.find((s) => s.username.toLowerCase() === cleanUser.toLowerCase());
    if (!user) {
      appendAudit(
        db,
        db.staff[0],
        'AUTH',
        'LOGIN_UNKNOWN_USER',
        cleanUser,
        `Failed login attempt for unknown username '${cleanUser}'.`,
        'WARNING'
      );
      appendSecurityAlert(db, {
        type: 'FAILED_LOGIN',
        severity: 'WARNING',
        targetUsername: cleanUser,
        message: `Unknown username '${cleanUser}' attempted to sign in.`,
        resolved: false,
      });
      saveDb(db);
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (user.status === 'Suspended') {
      res.status(403).json({ error: 'This operator account is Suspended. Contact Admin.' });
      return;
    }
    if (user.isLocked) {
      res.status(423).json({
        error: `Account '${user.username}' is LOCKED after multiple failed attempts. Call Hospital Admin (${db.settings.resetSupportPhone}) to reset with reason.`,
        code: 'ACCOUNT_LOCKED',
        supportPhone: db.settings.resetSupportPhone,
      });
      return;
    }

    const maxAttempts = Math.max(2, db.settings?.moduleSettings?.maxFailedAttemptsBeforeLock || 3);

    if (user.password !== cleanPass) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      user.lastFailedAt = new Date().toISOString();

      if (user.failedAttempts >= maxAttempts) {
        user.isLocked = true;
        user.lockedAt = new Date().toISOString();
        user.lockedReason = `${maxAttempts} consecutive failed password login attempts`;
        appendAudit(
          db,
          user,
          'AUTH',
          'ACCOUNT_LOCKED_BRUTE_FORCE',
          user.username,
          `LOCKOUT TRIGGERED: '${user.username}' (${user.fullName}) locked after ${maxAttempts} failed password attempts.`,
          'CRITICAL'
        );
        appendSecurityAlert(db, {
          type: 'BRUTE_FORCE_LOCKOUT',
          severity: 'CRITICAL',
          targetUserId: user.id,
          targetUsername: user.username,
          targetFullName: user.fullName,
          targetRole: user.roleId,
          attemptsCount: user.failedAttempts,
          message: `Account locked after ${maxAttempts} failed password attempts for '${user.username}' (${user.fullName}). Admin call-reset required.`,
          resolved: false,
        });
        saveDb(db);
        res.status(423).json({
          error: `Account locked after ${maxAttempts} failed password attempts. Incident logged & Admin alerted. Call ${db.settings.resetSupportPhone} for reset.`,
          code: 'ACCOUNT_LOCKED',
          supportPhone: db.settings.resetSupportPhone,
          db: scopeDbForActor(db, user),
        });
        return;
      }

      const remaining = maxAttempts - user.failedAttempts;
      appendAudit(
        db,
        user,
        'AUTH',
        'FAILED_LOGIN_ATTEMPT',
        user.username,
        `Invalid password entered for '${user.username}' (Attempt ${user.failedAttempts}/${maxAttempts}).`,
        'WARNING'
      );
      appendSecurityAlert(db, {
        type: 'FAILED_LOGIN',
        severity: 'WARNING',
        targetUserId: user.id,
        targetUsername: user.username,
        targetFullName: user.fullName,
        targetRole: user.roleId,
        attemptsCount: user.failedAttempts,
        message: `Failed password attempt (${user.failedAttempts}/${maxAttempts}) on '${user.username}' (${user.fullName}).`,
        resolved: false,
      });
      saveDb(db);
      res.status(401).json({
        error: `Invalid password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before security lockout.`,
        attemptsRemaining: remaining,
        db: scopeDbForActor(db, user),
      });
      return;
    }

    user.failedAttempts = 0;
    user.lastLoginAt = new Date().toISOString();
    appendAudit(
      db,
      user,
      'AUTH',
      'USER_LOGIN',
      user.employeeCode,
      `${user.fullName} (@${user.username}, ${user.roleId}${user.assignedCenterName ? ` · ${user.assignedCenterName}` : ''}) authenticated via username & password.`,
      'INFO'
    );
    saveDb(db);
    res.json({ activeUser: user, db: scopeDbForActor(db, user), telemetry: computeSaasTelemetry(db) });
  });

  app.post('/api/auth/unlock-pin', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { pin } = req.body as { pin?: string };
    const cleanPin = String(pin || '').trim();
    if (!cleanPin) {
      res.status(400).json({ error: 'Admin-assigned PIN is required to unlock session.' });
      return;
    }

    const maxAttempts = Math.max(2, db.settings?.moduleSettings?.maxFailedAttemptsBeforeLock || 3);

    if (actor.pin !== cleanPin) {
      actor.failedAttempts = (actor.failedAttempts || 0) + 1;
      actor.lastFailedAt = new Date().toISOString();

      if (actor.failedAttempts >= maxAttempts) {
        actor.isLocked = true;
        actor.lockedAt = new Date().toISOString();
        actor.lockedReason = `${maxAttempts} consecutive failed idle-lock PIN attempts`;
        appendAudit(
          db,
          actor,
          'AUTH',
          'PIN_LOCKOUT_TRIGGERED',
          actor.username,
          `LOCKOUT TRIGGERED: '${actor.username}' (${actor.fullName}) locked after ${maxAttempts} wrong PIN entries.`,
          'CRITICAL'
        );
        appendSecurityAlert(db, {
          type: 'BRUTE_FORCE_LOCKOUT',
          severity: 'CRITICAL',
          targetUserId: actor.id,
          targetUsername: actor.username,
          targetFullName: actor.fullName,
          targetRole: actor.roleId,
          attemptsCount: actor.failedAttempts,
          message: `Idle-lock session locked after ${maxAttempts} wrong PIN attempts for '${actor.username}'. Admin reset required.`,
          resolved: false,
        });
        saveDb(db);
        res.status(423).json({
          error: `Session locked after ${maxAttempts} failed PIN attempts. Admin alerted. Call ${db.settings.resetSupportPhone} for reset.`,
          code: 'ACCOUNT_LOCKED',
          db: scopeDbForActor(db, actor),
        });
        return;
      }

      const remaining = maxAttempts - actor.failedAttempts;
      appendAudit(
        db,
        actor,
        'AUTH',
        'FAILED_PIN_ATTEMPT',
        actor.username,
        `Incorrect PIN entered for '${actor.username}' (Attempt ${actor.failedAttempts}/${maxAttempts}).`,
        'WARNING'
      );
      appendSecurityAlert(db, {
        type: 'FAILED_PIN',
        severity: 'WARNING',
        targetUserId: actor.id,
        targetUsername: actor.username,
        targetFullName: actor.fullName,
        targetRole: actor.roleId,
        attemptsCount: actor.failedAttempts,
        message: `Failed idle-lock PIN attempt (${actor.failedAttempts}/${maxAttempts}) on '${actor.username}'.`,
        resolved: false,
      });
      saveDb(db);
      res.status(401).json({
        error: `Incorrect PIN. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining before lockout.`,
        attemptsRemaining: remaining,
        db: scopeDbForActor(db, actor),
      });
      return;
    }

    actor.failedAttempts = 0;
    appendAudit(
      db,
      actor,
      'AUTH',
      'PIN_UNLOCKED',
      actor.employeeCode,
      `${actor.fullName} unlocked idle screen using Admin-assigned PIN.`,
      'INFO'
    );
    saveDb(db);
    res.json({ ok: true, activeUser: actor, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/auth/request-reset', (req: Request, res: Response) => {
    const db = getDb();
    const { username, callerPhone, note } = req.body as {
      username?: string;
      callerPhone?: string;
      note?: string;
    };
    const cleanUser = (username || '').trim() || 'unknown';
    const target = db.staff.find((s) => s.username.toLowerCase() === cleanUser.toLowerCase());
    appendAudit(
      db,
      target || db.staff[0],
      'AUTH',
      'CALL_RESET_REQUESTED',
      cleanUser,
      `Password/PIN reset requested via support call (${callerPhone || 'direct call'}) for '${cleanUser}'. Note: ${note || 'Call requested'}.`,
      'WARNING'
    );
    appendSecurityAlert(db, {
      type: 'CALL_RESET_REQUEST',
      severity: 'WARNING',
      targetUserId: target?.id,
      targetUsername: target?.username || cleanUser,
      targetFullName: target?.fullName,
      targetRole: target?.roleId,
      message: `Phone-call reset requested for '@${target?.username || cleanUser}' (${callerPhone || 'Support call'}). ${note || ''}`.trim(),
      resolved: false,
    });
    saveDb(db);
    res.status(201).json({
      ok: true,
      supportPhone: db.settings.resetSupportPhone,
      message: `Reset request logged for Admin review. Please call ${db.settings.resetSupportPhone} for verification & reset.`,
      db,
    });
  });

  // Instant Password & PIN Reset for ANY user verified via Hospital Email (saptarihospital@gmail.com)
  app.post('/api/auth/instant-reset', (req: Request, res: Response) => {
    const db = getDb();
    const { username, resetEmail, newPassword, newPin } = req.body as {
      username?: string;
      resetEmail?: string;
      newPassword?: string;
      newPin?: string;
    };

    const cleanUser = (username || '').trim();
    const cleanEmail = (resetEmail || '').trim().toLowerCase();
    const cleanPass = (newPassword || '').trim();
    const authorizedResetEmail = (db.settings?.emailSender || 'saptarihospital@gmail.com')
      .trim()
      .toLowerCase();

    if (!cleanUser) {
      res.status(400).json({ error: 'Username or Employee Code is required.' });
      return;
    }
    if (cleanEmail !== authorizedResetEmail && cleanEmail !== 'saptarihospital@gmail.com') {
      res.status(403).json({
        error: `Authorized Hospital Reset Email must be saptarihospital@gmail.com.`,
      });
      return;
    }
    if (cleanPass.length < 4) {
      res.status(400).json({ error: 'New password must be at least 4 characters.' });
      return;
    }
    if (newPin && newPin.trim() && !/^\d{4,6}$/.test(newPin.trim())) {
      res.status(400).json({ error: 'Optional PIN must be 4 to 6 numeric digits.' });
      return;
    }

    const target = db.staff.find(
      (s) =>
        s.username.toLowerCase() === cleanUser.toLowerCase() ||
        s.employeeCode.toLowerCase() === cleanUser.toLowerCase()
    );
    if (!target) {
      res.status(404).json({ error: `No staff account found for '${cleanUser}'.` });
      return;
    }

    target.password = cleanPass;
    if (newPin && newPin.trim()) {
      target.pin = newPin.trim();
    }
    target.isLocked = false;
    target.failedAttempts = 0;
    target.lockedReason = undefined;
    target.lockedAt = undefined;

    for (const al of db.securityAlerts || []) {
      if (!al.resolved && (al.targetUserId === target.id || al.targetUsername === target.username)) {
        al.resolved = true;
        al.resolvedBy = 'Instant Email Reset (saptarihospital@gmail.com)';
        al.resolvedReason = 'Password reset instantly via authorized hospital email';
        al.resolvedAt = new Date().toISOString();
      }
    }

    if (!Array.isArray(db.emailNotifications)) db.emailNotifications = [];
    db.emailNotifications.unshift({
      id: `eml-rst-${Date.now()}`,
      timestamp: new Date().toISOString(),
      orderId: target.id,
      accessionNumber: target.employeeCode,
      recipientEmail: 'saptarihospital@gmail.com',
      subject: `[SHPL Instant Password Reset] @${target.username} (${target.fullName})`,
      triggerType: 'MANUAL_RESEND',
      status: 'Sent',
      bodyPreview: `Instant credential reset completed via saptarihospital@gmail.com for @${target.username} (${target.roleId}). Account unlocked and ready for immediate login.`,
      triggeredBy: 'saptarihospital@gmail.com',
    });

    appendSecurityAlert(db, {
      type: 'ADMIN_RESET',
      severity: 'INFO',
      targetUserId: target.id,
      targetUsername: target.username,
      targetFullName: target.fullName,
      targetRole: target.roleId,
      message: `Instant password reset completed via saptarihospital@gmail.com for '@${target.username}' (${target.fullName}).`,
      resolved: true,
      resolvedBy: 'saptarihospital@gmail.com',
      resolvedReason: 'Instant Hospital Email Reset',
      resolvedAt: new Date().toISOString(),
    });

    appendAudit(
      db,
      target,
      'AUTH',
      'INSTANT_EMAIL_PASSWORD_RESET',
      target.username,
      `Instant password reset & account unlock completed via saptarihospital@gmail.com for '@${target.username}' (${target.fullName}).`,
      'WARNING'
    );

    saveDb(db);
    res.json({
      ok: true,
      username: target.username,
      fullName: target.fullName,
      message: `Password for '@${target.username}' reset instantly via saptarihospital@gmail.com. Sign in now.`,
      db,
    });
  });

  app.post('/api/auth/admin-reset', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const canReset =
      hasPermission(db, actor.roleId, 'personnel.manage') ||
      hasPermission(db, actor.roleId, 'rbac.manage') ||
      hasPermission(db, actor.roleId, 'admin.control') ||
      hasPermission(db, actor.roleId, 'saas.tenants.manage');

    if (!canReset) {
      res.status(403).json({ error: 'Only Hospital Admin can reset passwords, PINs, or unlock accounts.' });
      return;
    }

    const { targetUserId, newPassword, newPin, reason } = req.body as {
      targetUserId: string;
      newPassword?: string;
      newPin?: string;
      reason?: string;
    };
    if (!reason || !reason.trim()) {
      res.status(400).json({ error: 'A mandatory reset Reason is required for audit compliance.' });
      return;
    }

    const target = db.staff.find((s) => s.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: 'Target staff account not found.' });
      return;
    }
    if (target.roleId === 'SUPER_ADMIN' && actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin (SUPER_ADMIN) can reset another Admin account.' });
      return;
    }

    if (newPassword && newPassword.trim()) {
      target.password = newPassword.trim();
    }
    if (newPin && newPin.trim()) {
      if (!/^\d{4,6}$/.test(newPin.trim())) {
        res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits.' });
        return;
      }
      target.pin = newPin.trim();
    }
    target.isLocked = false;
    target.failedAttempts = 0;
    target.lockedReason = undefined;
    target.lockedAt = undefined;

    for (const al of db.securityAlerts) {
      if (!al.resolved && (al.targetUserId === target.id || al.targetUsername === target.username)) {
        al.resolved = true;
        al.resolvedBy = actor.fullName;
        al.resolvedReason = reason.trim();
        al.resolvedAt = new Date().toISOString();
      }
    }

    appendSecurityAlert(db, {
      type: 'ADMIN_RESET',
      severity: 'INFO',
      targetUserId: target.id,
      targetUsername: target.username,
      targetFullName: target.fullName,
      targetRole: target.roleId,
      message: `${actor.fullName} unlocked & reset credentials${newPin ? ' + PIN' : ''} for '@${target.username}'. Reason: ${reason.trim()}`,
      resolved: true,
      resolvedBy: actor.fullName,
      resolvedReason: reason.trim(),
      resolvedAt: new Date().toISOString(),
    });

    appendAudit(
      db,
      actor,
      'AUTH',
      'ADMIN_CREDENTIAL_RESET',
      target.username,
      `Reset & unlocked '@${target.username}' (${target.fullName})${newPassword ? ' [Password updated]' : ''}${newPin ? ' [PIN updated]' : ''}. Reason: ${reason.trim()}`,
      'WARNING'
    );

    saveDb(db);
    res.json({ ok: true, user: target, db });
  });

  app.post('/api/auth/event', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { action, notes } = req.body as { action: 'USER_LOGIN' | 'USER_LOGOUT' | 'IDLE_LOCK'; notes?: string };
    appendAudit(
      db,
      actor,
      'AUTH',
      action || 'USER_LOGIN',
      actor.employeeCode,
      notes || `${actor.fullName} (${actor.roleId}) ${action === 'USER_LOGOUT' ? 'signed out of' : action === 'IDLE_LOCK' ? 'locked idle terminal on' : 'signed into'} Saptari Hospital ERP.`,
      'INFO'
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });

  // POS Billing & Lab Order Registration
  app.post('/api/orders', withAuth('orders.create'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      patientId,
      uhid,
      encounterType,
      encounterId,
      encounterLabel,
      nonInventoryBillOnly,
      patientName,
      patientAge,
      patientAgeType,
      patientGender,
      patientAddress,
      patientPhone,
      patientEmail,
      referringDoctor,
      referralPartnerId,
      collectionCenterId,
      priority,
      serviceIds,
      serviceQuantities,
      customPrices,
      discountAmount,
      paymentMode,
      cashPaid,
      bankPaid,
      bankAccountId,
      fiscalYear,
      creditOverride,
      creditOverrideReason,
    } = req.body as {
      patientId?: string;
      uhid?: string;
      encounterType?: EncounterType;
      encounterId?: string;
      encounterLabel?: string;
      nonInventoryBillOnly?: boolean;
      patientName: string;
      patientAge: number;
      patientAgeType?: AgeType;
      patientGender: PatientGender;
      patientAddress?: string;
      patientPhone: string;
      patientEmail?: string;
      referringDoctor?: string;
      referralPartnerId?: string | null;
      collectionCenterId?: string | null;
      priority: 'Routine' | 'STAT';
      serviceIds: string[];
      serviceQuantities?: Record<string, number>;
      customPrices?: Record<string, number>;
      discountAmount?: number;
      paymentMode?: PaymentMode;
      cashPaid?: number;
      bankPaid?: number;
      bankAccountId?: string;
      fiscalYear?: string;
      creditOverride?: boolean;
      creditOverrideReason?: string;
    };

    if (!patientName?.trim() || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      res.status(400).json({ error: 'Patient name and at least one test/service are required.' });
      return;
    }

    const selectedServices = serviceIds
      .map((id) => db.services.find((s) => s.id === id))
      .filter((s): s is LabServiceTest => Boolean(s));

    if (selectedServices.length === 0) {
      res.status(400).json({ error: 'No valid services selected from Service Master.' });
      return;
    }

    const resolveItemPrice = (srv: LabServiceTest) => {
      const override = customPrices?.[srv.id];
      if (override !== undefined && Number.isFinite(Number(override)) && Number(override) >= 0) {
        return Number(override);
      }
      return srv.price;
    };

    const resolveItemQty = (srv: LabServiceTest) => {
      const raw = Number(serviceQuantities?.[srv.id]);
      if (!Number.isFinite(raw) || raw < 1) return 1;
      return Math.min(999, Math.round(raw));
    };

    const subtotalAmount = Number(
      selectedServices
        .reduce((sum, s) => sum + resolveItemPrice(s) * resolveItemQty(s), 0)
        .toFixed(2)
    );
    const discount = Math.max(0, Math.min(subtotalAmount, Number(discountAmount) || 0));
    const totalAmount = Number((subtotalAmount - discount).toFixed(2));

    const effectivePaymentMode: PaymentMode = paymentMode || 'Cash';

    const cashAmt =
      effectivePaymentMode === 'Cash'
        ? Number(cashPaid ?? totalAmount)
        : effectivePaymentMode === 'Split'
        ? Number(cashPaid || 0)
        : 0;
    const bankAmt =
      effectivePaymentMode === 'Bank / QR'
        ? Number(bankPaid ?? totalAmount)
        : effectivePaymentMode === 'Split'
        ? Number(bankPaid || 0)
        : 0;

    const paidAmount = Number(Math.min(totalAmount, cashAmt + bankAmt).toFixed(2));
    const dueAmount = Number(Math.max(0, totalAmount - paidAmount).toFixed(2));

    const referralPartner = referralPartnerId
      ? db.referrals.find((r) => r.id === referralPartnerId)
      : undefined;

    const patientRec = upsertPatientMaster(db, {
      patientId,
      uhid,
      fullName: patientName.trim(),
      age: Number(patientAge) || 30,
      ageType: patientAgeType || 'Years',
      gender: patientGender || 'Male',
      phone: patientPhone,
      address: patientAddress,
      email: patientEmail,
      actorName: actor.fullName,
    });

    const now = new Date();
    const bsNow = adToBs(now);
    const activeFy = fiscalYear || db.settings.activeFiscalYear || bsNow.fiscalYear;
    const orderNum = 1045 + db.orders.length + 1;
    const ms = db.settings.moduleSettings;
    const labPfx = ms?.labOrderPrefix || 'SAP';
    const billPfx = ms?.billPrefix || 'BILL';
    const accessionNumber = `${labPfx}-${bsNow.year}-${orderNum}`;
    const invoiceNumber = `${billPfx}-${bsNow.year}-${orderNum}`;
    const priorityFactor = priority === 'STAT' ? 0.5 : 1;

    const testItems: OrderTestItem[] = selectedServices.map((srv) => {
      const effectiveUnitPrice = resolveItemPrice(srv);
      const qty = resolveItemQty(srv);
      const lineTotalPrice = Number((effectiveUnitPrice * qty).toFixed(2));
      const effectiveTat = Math.max(30, Math.round(srv.tatMinutes * priorityFactor));
      const dueAt = new Date(now.getTime() + effectiveTat * 60000).toISOString();
      const comm = computeTestReferralCommission(referralPartner, {
        ...srv,
        price: lineTotalPrice,
      });
      return {
        serviceId: srv.id,
        serviceCode: srv.code,
        serviceName: srv.name,
        serviceCategory: srv.serviceCategory || (srv.department === 'Radiology' ? 'RADIOLOGY' : 'PATHOLOGY'),
        modality: srv.modality,
        department: srv.department,
        methodology: srv.methodology,
        tatMinutes: effectiveTat,
        dueAt,
        quantity: qty,
        unitPrice: effectiveUnitPrice,
        price: lineTotalPrice,
        referralCommissionNpr: comm,
        reagentsDeducted: false,
        status: 'Pending',
        interpretation: '',
        parameterResults: srv.parameters.map((p) => {
          const ref = getRefRange(p, patientGender || 'Male');
          return {
            parameterId: p.id,
            parameterName: p.name,
            resultType: p.resultType || 'NUMERIC',
            unit: p.unit,
            value: null,
            refRangeDisplay: ref.display,
            flag: 'NORMAL',
          };
        }),
      };
    });

    const referralCommissionTotal = Number(
      testItems.reduce((sum, t) => sum + t.referralCommissionNpr, 0).toFixed(2)
    );

    const maxDueAt = testItems.reduce(
      (latest, t) => (new Date(t.dueAt).getTime() > new Date(latest).getTime() ? t.dueAt : latest),
      testItems[0].dueAt
    );

    const encType: EncounterType = encounterType || 'WALKING';
    const resolvedEncLabel =
      encounterLabel?.trim() || `${encType}: ${patientRec.uhid}`;

    const newOrder: LabOrder = {
      id: `ord-${Date.now()}`,
      accessionNumber,
      invoiceNumber,
      fiscalYear: activeFy,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterType: encType,
      encounterId,
      encounterLabel: resolvedEncLabel,
      nonInventoryBillOnly: Boolean(nonInventoryBillOnly),
      patientName: patientRec.fullName,
      patientAge: Number(patientAge) || patientRec.age,
      patientAgeType: patientAgeType || patientRec.ageType,
      patientGender: patientGender || patientRec.gender,
      patientAddress: patientAddress?.trim() || patientRec.address,
      patientPhone: patientPhone?.trim() || patientRec.phone,
      patientEmail: patientEmail?.trim() || '',
      referringDoctor: referralPartner ? referralPartner.name : referringDoctor || 'Self / Walk-in',
      referralPartnerId: referralPartner ? referralPartner.id : null,
      referralPartnerName: referralPartner ? referralPartner.name : null,
      referralCommissionTotal,
      collectionCenterId: null,
      collectionCenterName: 'Saptari Hospital Billing Counter',
      priority: priority || 'Routine',
      status: 'Ordered',
      orderedAt: now.toISOString(),
      collectedAt: null,
      receivedInLabAt: null,
      resultedAt: null,
      validatedAt: null,
      validatedById: null,
      validatedByName: null,
      validatedByDesignation: null,
      validatedByRegNo: null,
      dueAt: maxDueAt,
      subtotalAmount,
      discountAmount: discount,
      totalAmount,
      paidAmount,
      dueAmount,
      paymentMode: effectivePaymentMode,
      cashPaid: cashAmt,
      bankPaid: bankAmt,
      bankAccountId,
      creditOverrideApplied: Boolean(creditOverride),
      creditOverrideReason: creditOverride ? creditOverrideReason || 'Admin override' : undefined,
      emailSent: false,
      apiSent: false,
      createdById: actor.id,
      createdByName: actor.fullName,
      tests: testItems,
    };

    // Post Cash & Bank inflows strictly to HOSPITAL Accounts
    if (cashAmt > 0) {
      const cashAcc =
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER') ||
        db.accounts.find((a) => a.type === 'CASH_COUNTER');
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          'INFLOW',
          cashAmt,
          'POS_COLLECTION',
          invoiceNumber,
          `Hospital POS Cash [${encType}]${nonInventoryBillOnly ? ' [Bill-Only]' : ''} for ${newOrder.patientName} (${accessionNumber})`,
          activeFy,
          actor
        );
      }
    }
    if (bankAmt > 0) {
      const bankAcc =
        (bankAccountId && db.accounts.find((a) => a.id === bankAccountId)) ||
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK') ||
        db.accounts.find((a) => a.type === 'BANK');
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          'INFLOW',
          bankAmt,
          'POS_COLLECTION',
          invoiceNumber,
          `Hospital POS Bank/QR [${encType}]${nonInventoryBillOnly ? ' [Bill-Only]' : ''} for ${newOrder.patientName} (${accessionNumber})`,
          activeFy,
          actor
        );
      }
    }

    if (referralPartner) {
      referralPartner.totalReferredSales = Number(
        (referralPartner.totalReferredSales + totalAmount).toFixed(2)
      );
      referralPartner.totalCommissionEarned = Number(
        (referralPartner.totalCommissionEarned + referralCommissionTotal).toFixed(2)
      );
    }

    db.orders.unshift(newOrder);
    appendAudit(
      db,
      actor,
      'POS_BILLING',
      creditOverride ? 'POS_ORDER_CREDIT_OVERRIDE' : 'POS_ORDER_CREATED',
      invoiceNumber,
      `Billed ${invoiceNumber} (${accessionNumber}) [${resolvedEncLabel}]${nonInventoryBillOnly ? ' [NON-INVENTORY BILL-ONLY]' : ''} for ${newOrder.patientName} — रू ${totalAmount.toLocaleString()} via ${effectivePaymentMode}.`,
      creditOverride ? 'WARNING' : 'INFO'
    );

    saveDb(db);
    res.status(201).json({ order: newOrder, patient: patientRec, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/orders/:id/advance', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (
      !hasPermission(db, actor.roleId, 'orders.advance') &&
      !hasPermission(db, actor.roleId, 'orders.collect')
    ) {
      res.status(403).json({
        error: `Forbidden: Role '${actor.roleId}' lacks permission 'orders.advance' or 'orders.collect'.`,
      });
      return;
    }
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }

    const now = new Date().toISOString();
    if (order.status === 'Ordered') {
      order.status = 'Collected';
      order.collectedAt = now;
    } else if (order.status === 'Collected') {
      order.status = 'In Lab';
      order.receivedInLabAt = now;
    } else {
      res.status(400).json({ error: `Order is already in stage '${order.status}'.` });
      return;
    }

    appendAudit(
      db,
      actor,
      'ORDERS',
      'SPECIMEN_ADVANCED',
      order.accessionNumber,
      `Advanced ${order.accessionNumber} specimen status to '${order.status}'.`
    );

    saveDb(db);
    res.json({ order, db });
  });

  // Settle unpaid credit due on an existing Hospital Order (called from Accounting / POS)
  app.post('/api/orders/:id/settle-due', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (
      !hasPermission(db, actor.roleId, 'finance.manage') &&
      !hasPermission(db, actor.roleId, 'pos.billing')
    ) {
      res.status(403).json({
        error: `Forbidden: Role '${actor.roleId}' lacks permission to settle hospital credit dues.`,
      });
      return;
    }

    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Hospital order not found.' });
      return;
    }

    const { amountNpr, paymentMode = 'Cash', bankAccountId, note } = req.body as {
      amountNpr: number;
      paymentMode?: PaymentMode;
      bankAccountId?: string;
      note?: string;
    };

    const currentDue = Number(
      (order.dueAmount !== undefined ? order.dueAmount : Math.max(0, order.totalAmount - (order.paidAmount || 0))).toFixed(2)
    );
    const payAmt = Number(Math.min(currentDue, Math.max(0, Number(amountNpr) || 0)).toFixed(2));
    if (payAmt <= 0) {
      res.status(400).json({ error: 'Order credit due is already zero or settlement amount is invalid.' });
      return;
    }

    if (paymentMode === 'Bank / QR') {
      order.bankPaid = Number(((order.bankPaid || 0) + payAmt).toFixed(2));
      const bankAcc =
        (bankAccountId && db.accounts.find((a) => a.id === bankAccountId)) ||
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK') ||
        db.accounts.find((a) => a.type === 'BANK');
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          'INFLOW',
          payAmt,
          'POS_COLLECTION',
          order.invoiceNumber,
          `Hospital Due Collection ${order.invoiceNumber} (${order.patientName})${note ? ` · ${note}` : ''}`,
          order.fiscalYear,
          actor
        );
      }
    } else {
      order.cashPaid = Number(((order.cashPaid || 0) + payAmt).toFixed(2));
      const cashAcc =
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
        db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER') ||
        db.accounts.find((a) => a.type === 'CASH_COUNTER');
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          'INFLOW',
          payAmt,
          'POS_COLLECTION',
          order.invoiceNumber,
          `Hospital Due Collection ${order.invoiceNumber} (${order.patientName})${note ? ` · ${note}` : ''}`,
          order.fiscalYear,
          actor
        );
      }
    }

    order.paidAmount = Number(((order.paidAmount || 0) + payAmt).toFixed(2));
    order.dueAmount = Number(Math.max(0, order.totalAmount - order.paidAmount).toFixed(2));
    if (order.dueAmount <= 0 && order.paymentMode === 'Credit') {
      order.paymentMode = paymentMode === 'Bank / QR' ? 'Bank / QR' : 'Cash';
    }

    appendAudit(
      db,
      actor,
      'FINANCE',
      'ORDER_DUE_SETTLED',
      order.invoiceNumber,
      `Settled रू ${payAmt.toLocaleString()} credit due on ${order.invoiceNumber} (${order.patientName}). Remaining due: रू ${order.dueAmount.toLocaleString()}.`
    );
    saveDb(db);
    res.json({ order, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/orders/:id/results', withAuth('results.enter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const wasValidatedOrDispatched = order.status === 'Validated' || order.status === 'Dispatched';
    if (wasValidatedOrDispatched && !hasPermission(db, actor.roleId, 'results.validate')) {
      res.status(400).json({ error: 'Validated reports can only be amended by an authorized Pathologist / Validator.' });
      return;
    }

    const { testUpdates } = req.body as {
      testUpdates: Array<{
        serviceId: string;
        values: Record<string, number | string | null>;
        flagOverrides?: Record<string, ResultFlag>;
        interpretation?: string;
      }>;
    };

    const now = new Date().toISOString();
    if (!order.collectedAt) order.collectedAt = now;
    if (!order.receivedInLabAt) order.receivedInLabAt = now;

    let hasCritical = false;

    for (const upd of testUpdates) {
      const orderTest = order.tests.find((t) => t.serviceId === upd.serviceId);
      const service = db.services.find((s) => s.id === upd.serviceId);
      if (!orderTest || !service) continue;

      const resolvedValues = evaluateParameterFormulas(service.parameters, upd.values || {});

      orderTest.parameterResults = orderTest.parameterResults.map((pr) => {
        const paramDef = service.parameters.find((p) => p.id === pr.parameterId);
        const isQual = (paramDef?.resultType || pr.resultType) === 'QUALITATIVE';
        const rawVal = resolvedValues[pr.parameterId];

        const parsedVal: number | string | null = isQual
          ? rawVal === null || rawVal === undefined || String(rawVal).trim() === ''
            ? null
            : String(rawVal).trim()
          : rawVal === null || rawVal === undefined || rawVal === '' || Number.isNaN(Number(rawVal))
          ? null
          : Number(rawVal);

        const autoFlag = paramDef
          ? evaluateParameterFlag(parsedVal, paramDef, order.patientGender)
          : 'NORMAL';
        const flag = upd.flagOverrides?.[pr.parameterId] || autoFlag;
        if (flag === 'CRITICAL_HIGH' || flag === 'CRITICAL_LOW' || flag === 'CRITICAL' || flag === 'HIGH_RISK') {
          hasCritical = true;
        }
        return {
          ...pr,
          resultType: isQual ? 'QUALITATIVE' : 'NUMERIC',
          value: parsedVal,
          flag,
        };
      });

      if (upd.interpretation !== undefined) {
        orderTest.interpretation = upd.interpretation.trim();
      }

      const allFilled = orderTest.parameterResults.every(
        (p) => p.value !== null && String(p.value).trim() !== ''
      );
      if (allFilled) {
        orderTest.status = wasValidatedOrDispatched ? 'Validated' : 'Resulted';
      }
    }

    if (wasValidatedOrDispatched) {
      order.status = order.status === 'Dispatched' ? 'Dispatched' : 'Validated';
      order.validatedAt = now;
      order.validatedById = actor.id;
      order.validatedByName = actor.fullName;
      order.validatedByDesignation = actor.designation;
      order.validatedByRegNo = actor.registrationNumber || 'NMC-VERIFIED';
    } else if (order.tests.every((t) => t.status === 'Resulted' || t.status === 'Validated')) {
      order.status = 'Resulted';
      order.resultedAt = now;
    } else {
      order.status = 'In Lab';
    }

    appendAudit(
      db,
      actor,
      'RESULTS',
      wasValidatedOrDispatched ? 'RESULTS_AMENDED' : hasCritical ? 'CRITICAL_VALUE_ENTERED' : 'RESULTS_ENTERED',
      order.accessionNumber,
      `${wasValidatedOrDispatched ? 'Amended validated laboratory results' : 'Entered laboratory analyte results'} for ${order.accessionNumber}${
        hasCritical ? ' (CRITICAL PANIC VALUE FLAGGED)' : ''
      }.`,
      hasCritical ? 'CRITICAL' : wasValidatedOrDispatched ? 'WARNING' : 'INFO'
    );

    saveDb(db);
    res.json({ order, db });
  });

  // Structured Radiology Reporting & Saved Templates
  app.post('/api/orders/:id/radiology-report', withAuth('radiology.report', 'radiology_imaging'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const wasValidatedOrDispatched = order.status === 'Validated' || order.status === 'Dispatched';
    if (wasValidatedOrDispatched && !hasPermission(db, actor.roleId, 'results.validate')) {
      res.status(400).json({ error: 'Validated reports can only be amended by an authorized Pathologist / Radiologist / Validator.' });
      return;
    }

    const { serviceId, radiologyReport } = req.body as {
      serviceId: string;
      radiologyReport: RadiologyReportData;
    };
    const orderTest = order.tests.find((t) => t.serviceId === serviceId);
    if (!orderTest) {
      res.status(404).json({ error: 'Ordered radiology study not found in order.' });
      return;
    }
    if (!radiologyReport?.impression?.trim()) {
      res.status(400).json({ error: 'Radiology Impression summary is required.' });
      return;
    }

    const now = new Date().toISOString();
    if (!order.collectedAt) order.collectedAt = now;
    if (!order.receivedInLabAt) order.receivedInLabAt = now;

    orderTest.radiologyReport = {
      ...radiologyReport,
      filmsUsedCount: Math.max(0, Number(radiologyReport.filmsUsedCount) || 0),
      filmRetakeCount: Math.max(0, Number(radiologyReport.filmRetakeCount) || 0),
    };
    orderTest.interpretation = radiologyReport.impression.trim();
    orderTest.status = wasValidatedOrDispatched ? 'Validated' : 'Resulted';

    if (wasValidatedOrDispatched) {
      order.status = order.status === 'Dispatched' ? 'Dispatched' : 'Validated';
      order.validatedAt = now;
      order.validatedById = actor.id;
      order.validatedByName = actor.fullName;
      order.validatedByDesignation = actor.designation;
      order.validatedByRegNo = actor.registrationNumber || 'NMC-VERIFIED';
    } else if (order.tests.every((t) => t.status === 'Resulted' || t.status === 'Validated')) {
      order.status = 'Resulted';
      order.resultedAt = now;
    } else {
      order.status = 'In Lab';
    }

    appendAudit(
      db,
      actor,
      'RADIOLOGY',
      wasValidatedOrDispatched
        ? 'RADIOLOGY_REPORT_AMENDED'
        : radiologyReport.criticalFinding
        ? 'CRITICAL_RADIOLOGY_REPORT'
        : 'RADIOLOGY_REPORT_SAVED',
      order.accessionNumber,
      `${wasValidatedOrDispatched ? 'Amended validated ' : 'Saved '}${orderTest.modality || 'IMAGING'} report for ${orderTest.serviceCode} (Films: ${orderTest.radiologyReport.filmsUsedCount}, Retakes: ${orderTest.radiologyReport.filmRetakeCount})${radiologyReport.criticalFinding ? ' [CRITICAL FINDING]' : ''}.`,
      radiologyReport.criticalFinding ? 'CRITICAL' : wasValidatedOrDispatched ? 'WARNING' : 'INFO'
    );
    saveDb(db);
    res.json({ order, db });
  });

  app.post('/api/radiology/templates', withAuth('radiology.manage', 'radiology_imaging'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<RadiologyTemplate>;
    if (!body.name?.trim() || !body.modality || !body.normalImpression?.trim()) {
      res.status(400).json({ error: 'Template name, modality, and normal impression are required.' });
      return;
    }
    const existingIdx = body.id ? db.radiologyTemplates.findIndex((t) => t.id === body.id) : -1;
    const saved: RadiologyTemplate = {
      id: existingIdx >= 0 ? db.radiologyTemplates[existingIdx].id : `radtpl-${Date.now()}`,
      code: body.code?.trim().toUpperCase() || `TPL-${body.modality}-${db.radiologyTemplates.length + 1}`,
      name: body.name.trim(),
      modality: body.modality,
      serviceId: body.serviceId,
      technique: body.technique?.trim() || 'Standard diagnostic imaging protocol.',
      indicationPrompt: body.indicationPrompt?.trim() || 'Clinical evaluation',
      sections: Array.isArray(body.sections) && body.sections.length > 0 ? body.sections : [{ id: 'sec-1', title: 'Findings', defaultText: 'Normal study.' }],
      measurements: Array.isArray(body.measurements) ? body.measurements : [],
      normalImpression: body.normalImpression.trim(),
      advice: body.advice?.trim() || 'Correlate clinically.',
      quickMacros: Array.isArray(body.quickMacros) ? body.quickMacros : [],
      updatedAt: new Date().toISOString(),
      updatedBy: actor.fullName,
    };

    if (existingIdx >= 0) {
      db.radiologyTemplates[existingIdx] = saved;
    } else {
      db.radiologyTemplates.unshift(saved);
    }

    appendAudit(
      db,
      actor,
      'RADIOLOGY',
      existingIdx >= 0 ? 'RADIOLOGY_TEMPLATE_UPDATED' : 'RADIOLOGY_TEMPLATE_CREATED',
      saved.code,
      `Saved radiology template '${saved.name}' (${saved.modality}).`
    );
    saveDb(db);
    res.json({ template: saved, db });
  });

  app.delete('/api/radiology/templates/:id', withAuth('radiology.manage', 'radiology_imaging'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const idx = db.radiologyTemplates.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Radiology template not found.' });
      return;
    }
    const [removed] = db.radiologyTemplates.splice(idx, 1);
    appendAudit(db, actor, 'RADIOLOGY', 'RADIOLOGY_TEMPLATE_DELETED', removed.code, `Deleted radiology template '${removed.name}'.`, 'WARNING');
    saveDb(db);
    res.json({ ok: true, db });
  });

  app.post('/api/orders/:id/validate', withAuth('results.validate'), async (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status === 'Validated' || order.status === 'Dispatched') {
      res.status(400).json({ error: 'Order is already validated.' });
      return;
    }

    const incomplete = order.tests.some((t) => {
      const isRad = t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology';
      if (isRad) {
        return !t.radiologyReport || !t.radiologyReport.impression?.trim();
      }
      return t.parameterResults.some((p) => p.value === null || String(p.value).trim() === '');
    });
    if (incomplete) {
      res.status(400).json({
        error: 'All pathology parameters and radiology study impressions must be completed before final sign-off.',
      });
      return;
    }

    const now = new Date().toISOString();
    const deductedLog: string[] = [];
    const lowStockWarnings: string[] = [];
    const skipDeduction = Boolean(order.nonInventoryBillOnly);

    for (const orderTest of order.tests) {
      if (!skipDeduction && !orderTest.reagentsDeducted) {
        const service = db.services.find((s) => s.id === orderTest.serviceId);
        if (service) {
          for (const bom of service.reagentBom) {
            const reagent = db.reagents.find((r) => r.id === bom.reagentId);
            if (reagent && reagent.autoDeductEnabled) {
              const isFilm = reagent.category === 'X-Ray Film' && orderTest.radiologyReport;
              const baseQty = isFilm
                ? Math.max(0, orderTest.radiologyReport!.filmsUsedCount)
                : bom.quantityPerTest;
              const retakeQty = isFilm ? Math.max(0, orderTest.radiologyReport!.filmRetakeCount) : 0;
              const totalDeduct = Number((baseQty + retakeQty).toFixed(2));

              if (totalDeduct > 0) {
                const prev = reagent.currentStock;
                const nextStock = Math.max(0, Number((prev - totalDeduct).toFixed(2)));
                reagent.currentStock = nextStock;

                if (baseQty > 0) {
                  db.inventoryMovements.unshift({
                    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    timestamp: now,
                    reagentId: reagent.id,
                    reagentName: reagent.name,
                    lotNumber: reagent.lotNumber,
                    type: 'AUTO_DEDUCT',
                    quantityDelta: -baseQty,
                    balanceAfter: nextStock + retakeQty,
                    referenceId: order.accessionNumber,
                    performedBy: actor.fullName,
                    notes: `Auto-deducted for ${service.code} validation`,
                  });
                }
                if (retakeQty > 0) {
                  db.inventoryMovements.unshift({
                    id: `mov-${Date.now()}-rt-${Math.random().toString(36).slice(2, 5)}`,
                    timestamp: now,
                    reagentId: reagent.id,
                    reagentName: reagent.name,
                    lotNumber: reagent.lotNumber,
                    type: 'FILM_RETAKE',
                    quantityDelta: -retakeQty,
                    balanceAfter: nextStock,
                    referenceId: order.accessionNumber,
                    performedBy: actor.fullName,
                    notes: `Radiology X-Ray film retake wastage (${retakeQty} films) on ${service.code}`,
                  });
                }

                deductedLog.push(`${reagent.sku}: -${totalDeduct} ${reagent.unit}`);
                if (nextStock <= reagent.reorderLevel) {
                  lowStockWarnings.push(`${reagent.name} (${nextStock} ${reagent.unit} left)`);
                }
              }
            }
          }
        }
        orderTest.reagentsDeducted = true;
      }
      orderTest.status = 'Validated';
    }

    order.status = 'Validated';
    order.validatedAt = now;
    order.validatedById = actor.id;
    order.validatedByName = actor.fullName;
    order.validatedByDesignation = actor.designation;
    order.validatedByRegNo = actor.registrationNumber || 'NMC-VERIFIED';

    appendAudit(
      db,
      actor,
      'RESULTS',
      'REPORT_VALIDATED',
      order.accessionNumber,
      `Digitally signed off ${order.accessionNumber}. ${skipDeduction ? 'Non-Inventory Bill-Only (Zero stock deducted)' : `Auto-deducted reagents: ${deductedLog.join(', ') || 'None'}`}.`,
      lowStockWarnings.length > 0 ? 'WARNING' : 'INFO'
    );

    if (lowStockWarnings.length > 0) {
      appendAudit(
        db,
        actor,
        'INVENTORY',
        'LOW_STOCK_TRIGGERED',
        order.accessionNumber,
        `Reorder threshold breached after test validation: ${lowStockWarnings.join('; ')}.`,
        'WARNING'
      );
    }

    let emailTriggered: EmailNotification | null = null;
    if (db.settings.autoEmailOnValidate && order.patientEmail) {
      emailTriggered = createEmailNotification(db, order, 'AUTO_ON_VALIDATE', actor);
    }

    let apiTriggered: ApiDispatchLog | null = null;

    if (db.saas) {
      db.saas.archivedReportMediaMb = Number(((db.saas.archivedReportMediaMb || 0) + 0.45).toFixed(2));
    }

    saveDb(db);
    res.json({ order, emailTriggered, apiTriggered, lowStockWarnings, db });
  });

  app.post('/api/reports/:id/send-email', withAuth('reports.email', 'dispatch_api'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const { recipientEmail } = req.body as { recipientEmail?: string };
    if (recipientEmail && recipientEmail.trim()) {
      order.patientEmail = recipientEmail.trim();
    }
    const email = createEmailNotification(db, order, 'MANUAL_RESEND', actor);
    saveDb(db);
    res.json({ email, db });
  });

  app.post('/api/reports/:id/send-api', withAuth('reports.api_send', 'dispatch_api'), async (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const { targetUrl } = req.body as { targetUrl?: string };
    const finalUrl = (targetUrl || db.settings.defaultWebhookUrl).trim();
    if (!finalUrl) {
      res.status(400).json({ error: 'Target webhook URL is required.' });
      return;
    }

    const log = await dispatchApiReport(db, order, finalUrl, actor, PORT);
    saveDb(db);
    res.json({ dispatch: log, db });
  });

  app.post('/api/reports/:id/log-print', withAuth('reports.print'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    const { mode } = req.body as { mode: 'with-letterhead' | 'without-letterhead' };
    const nowIso = new Date().toISOString();
    order.printedAt = nowIso;
    order.printedBy = actor.fullName;
    order.printCount = (order.printCount || 0) + 1;

    if (db.saas) {
      db.saas.archivedReportMediaMb = Number(((db.saas.archivedReportMediaMb || 0) + 0.18).toFixed(2));
    }
    appendAudit(
      db,
      actor,
      'REPORTS',
      'A4_REPORT_PRINTED',
      order.accessionNumber,
      `Printed diagnostic report #${order.printCount} (${mode === 'with-letterhead' ? 'With Letterhead' : 'No Letterhead'}).`
    );
    saveDb(db);
    res.json({ ok: true, order, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/orders/:id/dispatch', withAuth('reports.print'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status !== 'Validated' && order.status !== 'Dispatched') {
      res.status(400).json({ error: 'Report must be Validated before physical/patient dispatch.' });
      return;
    }
    const { dispatchMode = 'Hand Counter Delivery', dispatchNotes } = (req.body || {}) as {
      dispatchMode?: string;
      dispatchNotes?: string;
    };
    const nowIso = new Date().toISOString();
    order.status = 'Dispatched';
    if (!order.printedAt) {
      order.printedAt = nowIso;
      order.printedBy = actor.fullName;
      order.printCount = Math.max(1, order.printCount || 0);
    }
    order.dispatchedAt = nowIso;
    order.dispatchedBy = actor.fullName;
    order.dispatchMode = dispatchMode.trim() || 'Hand Counter Delivery';
    if (dispatchNotes?.trim()) {
      order.dispatchNotes = dispatchNotes.trim();
    }

    appendAudit(
      db,
      actor,
      'REPORTS',
      'REPORT_DISPATCHED',
      order.accessionNumber,
      `Dispatched report for ${order.patientName} (${order.accessionNumber}) via ${order.dispatchMode}.`
    );
    saveDb(db);
    res.json({ order, db: scopeDbForActor(db, actor) });
  });

  // Service Master CRUD + Delete
  app.post('/api/services', withAuth('services.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const service = req.body as LabServiceTest;
    if (!service.code?.trim() || !service.name?.trim()) {
      res.status(400).json({ error: 'Service code and name are required.' });
      return;
    }
    const existingIdx = db.services.findIndex((s) => s.id === service.id);
    if (existingIdx >= 0) {
      db.services[existingIdx] = service;
      appendAudit(db, actor, 'SERVICES', 'SERVICE_UPDATED', service.code, `Updated Service Master ${service.code} (${service.name}) · Fee रू ${service.price} · TAT ${service.tatMinutes}m · ${service.parameters.length} parameters.`);
    } else {
      const created: LabServiceTest = {
        ...service,
        id: `srv-${Date.now()}`,
      };
      db.services.push(created);
      appendAudit(db, actor, 'SERVICES', 'SERVICE_CREATED', created.code, `Added Service Master test ${created.code} (${created.name}) · Fee रू ${created.price}.`);
    }
    saveDb(db);
    res.json({ db });
  });

  app.delete('/api/services/:id', withAuth('services.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const idx = db.services.findIndex((s) => s.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Service test not found.' });
      return;
    }
    const removed = db.services[idx];
    db.services.splice(idx, 1);
    appendAudit(db, actor, 'SERVICES', 'SERVICE_DELETED', removed.code, `Deleted test ${removed.code} (${removed.name}) from Service Master.`, 'WARNING');
    saveDb(db);
    res.json({ db });
  });

  // Reagent & Inventory ERP
  app.post('/api/inventory', withAuth('inventory.manage', 'inventory_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const item = req.body as ReagentItem;
    if (!item.sku?.trim() || !item.name?.trim()) {
      res.status(400).json({ error: 'Reagent SKU and name are required.' });
      return;
    }
    const created: ReagentItem = {
      ...item,
      id: `reg-${Date.now()}`,
      lastRestockedAt: new Date().toISOString(),
    };
    db.reagents.unshift(created);
    db.inventoryMovements.unshift({
      id: `mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      reagentId: created.id,
      reagentName: created.name,
      lotNumber: created.lotNumber,
      type: 'RESTOCK',
      quantityDelta: created.currentStock,
      balanceAfter: created.currentStock,
      referenceId: 'INIT-LOT',
      performedBy: actor.fullName,
      notes: `New reagent lot onboarded (${created.storageCondition})`,
    });
    appendAudit(db, actor, 'INVENTORY', 'REAGENT_ADDED', created.sku, `Added reagent ${created.name} (Lot ${created.lotNumber}, Stock ${created.currentStock} ${created.unit}).`);
    saveDb(db);
    res.status(201).json({ db });
  });

  app.post('/api/inventory/:id/restock', withAuth('inventory.manage', 'inventory_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const reagent = db.reagents.find((r) => r.id === req.params.id);
    if (!reagent) {
      res.status(404).json({ error: 'Reagent not found.' });
      return;
    }
    const { quantity, lotNumber, expiryDate, notes } = req.body as {
      quantity: number;
      lotNumber?: string;
      expiryDate?: string;
      notes?: string;
    };
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      res.status(400).json({ error: 'Positive restock quantity is required.' });
      return;
    }
    reagent.currentStock = Number((reagent.currentStock + qty).toFixed(2));
    if (lotNumber?.trim()) reagent.lotNumber = lotNumber.trim();
    if (expiryDate?.trim()) reagent.expiryDate = expiryDate.trim();
    reagent.lastRestockedAt = new Date().toISOString();

    db.inventoryMovements.unshift({
      id: `mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      reagentId: reagent.id,
      reagentName: reagent.name,
      lotNumber: reagent.lotNumber,
      type: 'RESTOCK',
      quantityDelta: qty,
      balanceAfter: reagent.currentStock,
      referenceId: `PO-${Date.now().toString().slice(-5)}`,
      performedBy: actor.fullName,
      notes: notes || 'Verified cold-chain restock receipt',
    });

    appendAudit(db, actor, 'INVENTORY', 'REAGENT_RESTOCKED', reagent.sku, `Restocked +${qty} ${reagent.unit} of ${reagent.name} (Lot ${reagent.lotNumber}).`);
    saveDb(db);
    res.json({ db });
  });

  app.post('/api/inventory/:id/adjust', withAuth('inventory.manage', 'inventory_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const reagent = db.reagents.find((r) => r.id === req.params.id);
    if (!reagent) {
      res.status(404).json({ error: 'Reagent not found.' });
      return;
    }
    const { delta, type, notes } = req.body as {
      delta: number;
      type: 'ADJUSTMENT' | 'EXPIRED_WRITE_OFF';
      notes: string;
    };
    const numDelta = Number(delta);
    if (!numDelta || Number.isNaN(numDelta)) {
      res.status(400).json({ error: 'Non-zero adjustment quantity is required.' });
      return;
    }
    reagent.currentStock = Math.max(0, Number((reagent.currentStock + numDelta).toFixed(2)));
    db.inventoryMovements.unshift({
      id: `mov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      reagentId: reagent.id,
      reagentName: reagent.name,
      lotNumber: reagent.lotNumber,
      type: type || 'ADJUSTMENT',
      quantityDelta: numDelta,
      balanceAfter: reagent.currentStock,
      performedBy: actor.fullName,
      notes: notes || 'Manual inventory reconciliation',
    });
    appendAudit(db, actor, 'INVENTORY', type || 'STOCK_ADJUSTMENT', reagent.sku, `Adjusted ${reagent.name} by ${numDelta} ${reagent.unit}: ${notes || 'Reconciliation'}`, 'WARNING');
    saveDb(db);
    res.json({ db });
  });

  // Referral Management (Per Test / Flat / % + Account Details & Admin Payout Approval)
  app.post('/api/referrals', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<ReferralPartner>;
    if (!body.name?.trim() || !body.code?.trim()) {
      res.status(400).json({ error: 'Referral partner code and name are required.' });
      return;
    }
    const created: ReferralPartner = {
      id: `ref-${Date.now()}`,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      type: body.type || 'Physician',
      phone: body.phone || '',
      address: body.address || '',
      bankName: body.bankName || '',
      bankBranch: body.bankBranch || '',
      accountHolderName: body.accountHolderName || body.name.trim(),
      accountNumber: body.accountNumber || '',
      walletId: body.walletId || '',
      panNumber: body.panNumber || '',
      defaultMode: body.defaultMode || 'PERCENT',
      defaultValue: Number(body.defaultValue) || 15,
      testOverrides: body.testOverrides || [],
      totalReferredSales: 0,
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      active: true,
    };
    db.referrals.unshift(created);
    appendAudit(db, actor, 'REFERRALS', 'REFERRAL_CREATED', created.code, `Added referral partner ${created.name} (${created.defaultMode} ${created.defaultValue}).`);
    saveDb(db);
    res.status(201).json({ db });
  });

  app.patch('/api/referrals/:id', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const partner = db.referrals.find((r) => r.id === req.params.id);
    if (!partner) {
      res.status(404).json({ error: 'Referral partner not found.' });
      return;
    }
    Object.assign(partner, req.body);
    appendAudit(db, actor, 'REFERRALS', 'REFERRAL_UPDATED', partner.code, `Updated commission rules & account details for ${partner.name}.`);
    saveDb(db);
    res.json({ db });
  });

  // Step 1: Request Referral Payout (after recording payment destination & reference -> Pending Admin Approval)
  app.post('/api/referrals/:id/payout-request', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const partner = db.referrals.find((r) => r.id === req.params.id);
    if (!partner) {
      res.status(404).json({ error: 'Referral partner not found.' });
      return;
    }
    const { amount, accountId, bankName, accountNumber, accountHolderName, paymentRefOrReceipt, notes } = req.body as {
      amount: number;
      accountId?: string;
      bankName?: string;
      accountNumber?: string;
      accountHolderName?: string;
      paymentRefOrReceipt?: string;
      notes?: string;
    };
    const payAmt = Number(amount);
    const pending = Math.max(0, partner.totalCommissionEarned - partner.totalCommissionPaid);
    if (!payAmt || payAmt <= 0 || payAmt > pending + 0.01) {
      res.status(400).json({ error: `Payout request must be between रू 1 and pending रू ${pending.toFixed(2)}.` });
      return;
    }
    const targetAccountId = accountId || db.accounts[0]?.id || 'acc-bank-1';
    const destSummary =
      (bankName?.trim() && accountNumber?.trim())
        ? `${bankName.trim()} A/C ${accountNumber.trim()} (${accountHolderName?.trim() || partner.accountHolderName || partner.name})`
        : partner.accountNumber
        ? `${partner.bankName || 'Bank'} A/C ${partner.accountNumber} (${partner.accountHolderName || partner.name})`
        : partner.walletId
        ? `Wallet ${partner.walletId} (${partner.name})`
        : `Cash Settlement (${partner.name})`;

    const bsNow = adToBs(new Date());
    const requestEntry: ReferralPayoutRequest = {
      id: `rpay-${Date.now()}`,
      requestNumber: `RPY-${bsNow.year}-${String((db.referralPayoutRequests || []).length + 1).padStart(3, '0')}`,
      partnerId: partner.id,
      partnerName: partner.name,
      partnerCode: partner.code,
      amountNpr: Number(payAmt.toFixed(2)),
      targetAccountId,
      destinationSummary: destSummary,
      paymentRefOrReceipt: paymentRefOrReceipt?.trim() || '',
      requestedAt: new Date().toISOString(),
      requestedBy: actor.fullName,
      status: 'Pending Admin Approval',
      notes: notes?.trim() || 'Commission disbursement request for Admin approval',
    };
    if (!Array.isArray(db.referralPayoutRequests)) db.referralPayoutRequests = [];
    db.referralPayoutRequests.unshift(requestEntry);

    appendAudit(
      db,
      actor,
      'REFERRALS',
      'REFERRAL_PAYOUT_REQUESTED',
      requestEntry.requestNumber,
      `Submitted Referral Payout Request ${requestEntry.requestNumber} for ${partner.name} (रू ${payAmt.toLocaleString()}) -> ${destSummary}. Awaiting Admin Approval.`,
      'WARNING'
    );
    saveDb(db);
    res.status(201).json({ request: requestEntry, db: scopeDbForActor(db, actor) });
  });

  // Step 2a: Admin Approves Referral Payout Request -> Debits Cash/Bank Ledger & Updates Total Paid
  app.post('/api/referrals/payout-requests/:reqId/approve', withAuth('referrals.approve_payout', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const payoutReq = (db.referralPayoutRequests || []).find((r) => r.id === req.params.reqId);
    if (!payoutReq) {
      res.status(404).json({ error: 'Referral payout request not found.' });
      return;
    }
    if (payoutReq.status !== 'Pending Admin Approval') {
      res.status(409).json({ error: `Payout request is already ${payoutReq.status}.` });
      return;
    }
    const partner = db.referrals.find((p) => p.id === payoutReq.partnerId);
    if (!partner) {
      res.status(404).json({ error: 'Referral partner not found.' });
      return;
    }
    const { accountId, approvalRemarks, paymentRefOrReceipt } = (req.body || {}) as {
      accountId?: string;
      approvalRemarks?: string;
      paymentRefOrReceipt?: string;
    };
    const acc = db.accounts.find((a) => a.id === (accountId || payoutReq.targetAccountId)) || db.accounts[0];
    if (!acc) {
      res.status(400).json({ error: 'Treasury Cash/Bank account not found.' });
      return;
    }

    partner.totalCommissionPaid = Number((partner.totalCommissionPaid + payoutReq.amountNpr).toFixed(2));
    payoutReq.status = 'Approved & Paid';
    payoutReq.reviewedAt = new Date().toISOString();
    payoutReq.reviewedBy = actor.fullName;
    payoutReq.approvalRemarks = approvalRemarks?.trim() || 'Verified payment proof & approved by Hospital Admin.';
    if (paymentRefOrReceipt?.trim()) {
      payoutReq.paymentRefOrReceipt = paymentRefOrReceipt.trim();
    }

    postLedgerMovement(
      db,
      acc,
      'OUTFLOW',
      payoutReq.amountNpr,
      'REFERRAL_PAYOUT',
      payoutReq.requestNumber,
      `Admin-Approved Referral Payout to ${partner.name} (${payoutReq.destinationSummary})${payoutReq.paymentRefOrReceipt ? ` [Ref: ${payoutReq.paymentRefOrReceipt}]` : ''}`,
      db.settings.activeFiscalYear,
      actor
    );
    appendAudit(
      db,
      actor,
      'REFERRALS',
      'REFERRAL_PAYOUT_APPROVED',
      payoutReq.requestNumber,
      `Admin approved & settled Referral Payout ${payoutReq.requestNumber} for ${partner.name}: रू ${payoutReq.amountNpr.toLocaleString()} from ${acc.name}.`
    );
    saveDb(db);
    res.json({ request: payoutReq, db: scopeDbForActor(db, actor) });
  });

  // Step 2b: Admin Rejects Referral Payout Request
  app.post('/api/referrals/payout-requests/:reqId/reject', withAuth('referrals.approve_payout', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const payoutReq = (db.referralPayoutRequests || []).find((r) => r.id === req.params.reqId);
    if (!payoutReq) {
      res.status(404).json({ error: 'Referral payout request not found.' });
      return;
    }
    if (payoutReq.status !== 'Pending Admin Approval') {
      res.status(409).json({ error: `Payout request is already ${payoutReq.status}.` });
      return;
    }
    const { approvalRemarks } = (req.body || {}) as { approvalRemarks?: string };
    payoutReq.status = 'Rejected';
    payoutReq.reviewedAt = new Date().toISOString();
    payoutReq.reviewedBy = actor.fullName;
    payoutReq.approvalRemarks = approvalRemarks?.trim() || 'Rejected by Hospital Admin during verification.';

    appendAudit(
      db,
      actor,
      'REFERRALS',
      'REFERRAL_PAYOUT_REJECTED',
      payoutReq.requestNumber,
      `Admin rejected Referral Payout ${payoutReq.requestNumber} for ${payoutReq.partnerName}. Reason: ${payoutReq.approvalRemarks}`,
      'WARNING'
    );
    saveDb(db);
    res.json({ request: payoutReq, db: scopeDbForActor(db, actor) });
  });

  // Legacy direct payout endpoint now routes through Admin Approval if user is Admin, or creates Pending Request
  app.post('/api/referrals/:id/payout', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const partner = db.referrals.find((r) => r.id === req.params.id);
    if (!partner) {
      res.status(404).json({ error: 'Referral partner not found.' });
      return;
    }
    const { amount, accountId, notes, paymentRefOrReceipt } = req.body as {
      amount: number;
      accountId: string;
      notes?: string;
      paymentRefOrReceipt?: string;
    };
    const payAmt = Number(amount);
    const pending = Math.max(0, partner.totalCommissionEarned - partner.totalCommissionPaid);
    if (!payAmt || payAmt <= 0 || payAmt > pending + 0.01) {
      res.status(400).json({ error: `Payout must be between रू 1 and pending रू ${pending.toFixed(2)}.` });
      return;
    }
    const acc = db.accounts.find((a) => a.id === accountId) || db.accounts[0];
    if (!acc) {
      res.status(400).json({ error: 'Payment account not found.' });
      return;
    }
    const bsNow = adToBs(new Date());
    const canAutoApprove = hasPermission(db, actor.roleId, 'referrals.approve_payout');
    const destSummary = partner.accountNumber
      ? `${partner.bankName || 'Bank'} A/C ${partner.accountNumber}`
      : partner.walletId
      ? `Wallet ${partner.walletId}`
      : 'Cash Settlement';

    const requestEntry: ReferralPayoutRequest = {
      id: `rpay-${Date.now()}`,
      requestNumber: `RPY-${bsNow.year}-${String((db.referralPayoutRequests || []).length + 1).padStart(3, '0')}`,
      partnerId: partner.id,
      partnerName: partner.name,
      partnerCode: partner.code,
      amountNpr: Number(payAmt.toFixed(2)),
      targetAccountId: acc.id,
      destinationSummary: destSummary,
      paymentRefOrReceipt: paymentRefOrReceipt?.trim() || '',
      requestedAt: new Date().toISOString(),
      requestedBy: actor.fullName,
      status: canAutoApprove ? 'Approved & Paid' : 'Pending Admin Approval',
      notes: notes || `Referral commission payout to ${partner.name}`,
      ...(canAutoApprove
        ? {
            reviewedAt: new Date().toISOString(),
            reviewedBy: actor.fullName,
            approvalRemarks: 'Direct Admin approval settlement',
          }
        : {}),
    };
    if (!Array.isArray(db.referralPayoutRequests)) db.referralPayoutRequests = [];
    db.referralPayoutRequests.unshift(requestEntry);

    if (canAutoApprove) {
      partner.totalCommissionPaid = Number((partner.totalCommissionPaid + payAmt).toFixed(2));
      postLedgerMovement(
        db,
        acc,
        'OUTFLOW',
        payAmt,
        'REFERRAL_PAYOUT',
        requestEntry.requestNumber,
        notes || `Referral commission payout to ${partner.name}`,
        db.settings.activeFiscalYear,
        actor
      );
      appendAudit(db, actor, 'REFERRALS', 'COMMISSION_PAID', partner.code, `Paid रू ${payAmt.toLocaleString()} commission to ${partner.name} from ${acc.name}.`);
    } else {
      appendAudit(db, actor, 'REFERRALS', 'REFERRAL_PAYOUT_REQUESTED', requestEntry.requestNumber, `Submitted payout request for रू ${payAmt.toLocaleString()} to ${partner.name} for Admin approval.`, 'WARNING');
    }
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });

  // Finance: Bank & Cash Accounts + Vouchers + Counter Close
  app.post('/api/finance/accounts', withAuth('finance.manage', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<BankCashAccount>;
    if (!body.name?.trim() || !body.code?.trim()) {
      res.status(400).json({ error: 'Account code and name are required.' });
      return;
    }
    const acc: BankCashAccount = {
      id: `acc-${Date.now()}`,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      type: body.type || 'BANK',
      departmentScope: body.departmentScope || 'HOSPITAL',
      bankName: body.bankName,
      accountNumber: body.accountNumber,
      branch: body.branch,
      currentBalance: Number(body.currentBalance) || 0,
    };
    db.accounts.push(acc);
    appendAudit(db, actor, 'FINANCE', 'ACCOUNT_CREATED', acc.code, `Created ${acc.departmentScope || 'HOSPITAL'} ${acc.type} account '${acc.name}' with opening balance रू ${acc.currentBalance.toLocaleString()}.`);
    saveDb(db);
    res.status(201).json({ db });
  });

  // Execute approved Finance ledger movement helper
  const executeApprovedFinanceRequest = (
    db: LimsDatabase,
    reqItem: FinanceApprovalRequest,
    actor: StaffMember
  ) => {
    const fy = reqItem.fiscalYear || db.settings.activeFiscalYear;
    const sourceAcc = db.accounts.find((a) => a.id === reqItem.accountId);
    if (!sourceAcc) return;
    if (reqItem.transactionType === 'BANK_DEPOSIT') {
      const targetAcc = db.accounts.find((a) => a.id === reqItem.targetAccountId);
      if (targetAcc && targetAcc.id !== sourceAcc.id) {
        postLedgerMovement(
          db,
          sourceAcc,
          'OUTFLOW',
          reqItem.amountNpr,
          'BANK_TRANSFER',
          reqItem.referenceId,
          `Approved Transfer to ${targetAcc.name}: ${reqItem.reason} — ${reqItem.description}`,
          fy,
          actor
        );
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          reqItem.amountNpr,
          'BANK_TRANSFER',
          reqItem.referenceId,
          `Approved Deposit from ${sourceAcc.name}: ${reqItem.reason} — ${reqItem.description}`,
          fy,
          actor
        );
      }
    } else if (reqItem.transactionType === 'EXPENSE' || reqItem.transactionType === 'PAYMENT') {
      postLedgerMovement(
        db,
        sourceAcc,
        'OUTFLOW',
        reqItem.amountNpr,
        'EXPENSE',
        reqItem.referenceId,
        `${reqItem.reason}: ${reqItem.description}`,
        fy,
        actor
      );
    } else {
      postLedgerMovement(
        db,
        sourceAcc,
        'INFLOW',
        reqItem.amountNpr,
        'POS_COLLECTION',
        reqItem.referenceId,
        `${reqItem.reason}: ${reqItem.description}`,
        fy,
        actor
      );
    }
  };

  app.post('/api/finance/transaction', withAuth('finance.manage', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { type, accountId, targetAccountId, amount, referenceId, description, reason, payeeOrParty, bypassApproval } = req.body as {
      type: FinanceApprovalTransactionType;
      accountId: string;
      targetAccountId?: string;
      amount: number;
      referenceId?: string;
      description: string;
      reason?: string;
      payeeOrParty?: string;
      bypassApproval?: boolean;
    };
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: 'Positive transaction amount is required.' });
      return;
    }
    const sourceAcc = db.accounts.find((a) => a.id === accountId);
    if (!sourceAcc) {
      res.status(404).json({ error: 'Source account not found.' });
      return;
    }
    let targetAcc: BankCashAccount | undefined;
    if (type === 'BANK_DEPOSIT') {
      targetAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (!targetAcc || targetAcc.id === sourceAcc.id) {
        res.status(400).json({ error: 'Valid destination account required for transfer.' });
        return;
      }
    }

    const requireTwoTier = db.settings?.moduleSettings?.requireTwoTierFinanceApproval !== false;
    const isAdmin = hasPermission(db, actor.roleId, 'finance.approve_admin') || actor.roleId === 'SUPER_ADMIN';
    const isManager = hasPermission(db, actor.roleId, 'finance.approve_manager');
    const vPfx = db.settings?.moduleSettings?.voucherPrefix || 'VCH';
    const ref = referenceId?.trim() || `${vPfx}-${Date.now().toString().slice(-5)}`;
    const fy = db.settings.activeFiscalYear;
    const nowIso = new Date().toISOString();
    const direction: FinanceApprovalDirection = type === 'RECEIPT' ? 'IN' : 'OUT';
    const resolvedReason = reason?.trim() || description?.trim() || `${type} Request`;
    const resolvedDesc = description?.trim() || resolvedReason;

    if (!Array.isArray(db.financeApprovalRequests)) db.financeApprovalRequests = [];

    // Direct ledger posting only if 2-tier approval explicitly disabled & admin overrides
    if (!requireTwoTier && bypassApproval && isAdmin) {
      const directReq: FinanceApprovalRequest = {
        id: `fap-${Date.now()}`,
        requestNumber: `FAP-${adToBs(nowIso).year}-${String(db.financeApprovalRequests.length + 1).padStart(3, '0')}`,
        fiscalYear: fy,
        createdAt: nowIso,
        updatedAt: nowIso,
        transactionType: type,
        direction,
        amountNpr: Number(amt.toFixed(2)),
        accountId: sourceAcc.id,
        accountName: sourceAcc.name,
        targetAccountId: targetAcc?.id,
        targetAccountName: targetAcc?.name,
        referenceId: ref,
        reason: resolvedReason,
        description: resolvedDesc,
        payeeOrParty: payeeOrParty?.trim(),
        requesterId: actor.id,
        requesterName: actor.fullName,
        requesterRole: actor.roleId,
        status: 'APPROVED',
        adminReviewedBy: actor.fullName,
        adminReviewedAt: nowIso,
        reRequestCount: 0,
        history: [
          {
            id: `faph-${Date.now()}`,
            timestamp: nowIso,
            action: 'APPROVED_BY_ADMIN',
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.roleId,
            note: 'Direct Admin entry posted immediately.',
            statusAfter: 'APPROVED',
          },
        ],
      };
      db.financeApprovalRequests.unshift(directReq);
      executeApprovedFinanceRequest(db, directReq, actor);
      appendAudit(db, actor, 'FINANCE', `FIN_${type}`, ref, `Direct ${type} of रू ${amt.toLocaleString()} on ${sourceAcc.name}: ${resolvedDesc}`);
      saveDb(db);
      res.json({ db: scopeDbForActor(db, actor), request: directReq });
      return;
    }

    // Two-Tier User -> Manager -> Admin Queue
    const initialStatus = isManager && !isAdmin ? 'PENDING_ADMIN' : 'PENDING_MANAGER';
    const history: FinanceApprovalHistoryEntry[] = [
      {
        id: `faph-${Date.now()}-1`,
        timestamp: nowIso,
        action: 'REQUESTED',
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: `Submitted ${type} (${direction}) voucher for रू ${amt.toLocaleString()} (${sourceAcc.name}).`,
        statusAfter: 'PENDING_MANAGER',
      },
    ];
    if (initialStatus === 'PENDING_ADMIN') {
      history.push({
        id: `faph-${Date.now()}-2`,
        timestamp: nowIso,
        action: 'APPROVED_BY_MANAGER',
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: 'Submitted by Manager; auto-advanced to Hospital Admin final review.',
        statusAfter: 'PENDING_ADMIN',
      });
    }

    const requestEntry: FinanceApprovalRequest = {
      id: `fap-${Date.now()}`,
      requestNumber: `FAP-${adToBs(nowIso).year}-${String(db.financeApprovalRequests.length + 1).padStart(3, '0')}`,
      fiscalYear: fy,
      createdAt: nowIso,
      updatedAt: nowIso,
      transactionType: type,
      direction,
      amountNpr: Number(amt.toFixed(2)),
      accountId: sourceAcc.id,
      accountName: sourceAcc.name,
      targetAccountId: targetAcc?.id,
      targetAccountName: targetAcc?.name,
      referenceId: ref,
      reason: resolvedReason,
      description: resolvedDesc,
      payeeOrParty: payeeOrParty?.trim(),
      requesterId: actor.id,
      requesterName: actor.fullName,
      requesterRole: actor.roleId,
      status: initialStatus,
      ...(initialStatus === 'PENDING_ADMIN' ? { managerReviewedBy: actor.fullName, managerReviewedAt: nowIso } : {}),
      reRequestCount: 0,
      history,
    };

    db.financeApprovalRequests.unshift(requestEntry);
    appendAudit(
      db,
      actor,
      'FINANCE_APPROVAL',
      'FINANCE_REQUEST_SUBMITTED',
      requestEntry.requestNumber,
      `Submitted 2-Tier ${type} (${direction}) request ${requestEntry.requestNumber} for रू ${amt.toLocaleString()} (${resolvedReason}). Status: ${initialStatus}.`,
      'INFO'
    );
    saveDb(db);
    res.status(201).json({ request: requestEntry, db: scopeDbForActor(db, actor) });
  });

  // 2-Tier Finance Approval Queue & Polling Endpoints (User -> Manager -> Admin)
  app.get('/api/finance/approval-requests', withAuth('finance.view', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const all = db.financeApprovalRequests || [];
    const statusFilter = typeof req.query.status === 'string' ? req.query.status : 'ALL';
    const items = statusFilter === 'ALL' ? all : all.filter((r) => r.status === statusFilter);
    const isAdmin = hasPermission(db, actor.roleId, 'finance.approve_admin') || actor.roleId === 'SUPER_ADMIN';
    const isManager = hasPermission(db, actor.roleId, 'finance.approve_manager');

    const pendingManager = all.filter((r) => r.status === 'PENDING_MANAGER');
    const pendingAdmin = all.filter((r) => r.status === 'PENDING_ADMIN');
    const declined = all.filter((r) => r.status === 'DECLINED');
    const approved = all.filter((r) => r.status === 'APPROVED');
    const pendingForActor = all.filter((r) => {
      if (isAdmin) return r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN';
      if (isManager) return r.status === 'PENDING_MANAGER';
      return false;
    });

    const sumByDir = (list: FinanceApprovalRequest[], dir: FinanceApprovalDirection) =>
      Number(list.filter((r) => r.direction === dir).reduce((s, r) => s + r.amountNpr, 0).toFixed(2));

    res.json({
      items,
      summary: {
        pendingManagerCount: pendingManager.length,
        pendingAdminCount: pendingAdmin.length,
        pendingForMeCount: pendingForActor.length,
        totalPendingCount: pendingManager.length + pendingAdmin.length,
        declinedCount: declined.length,
        approvedCount: approved.length,
        pendingInflowNpr: sumByDir([...pendingManager, ...pendingAdmin], 'IN'),
        pendingOutflowNpr: sumByDir([...pendingManager, ...pendingAdmin], 'OUT'),
      },
      actorPermissions: {
        canApproveManager: isManager || isAdmin,
        canApproveAdmin: isAdmin,
      },
    });
  });

  app.post('/api/finance/approval-requests', withAuth('finance.view', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { transactionType, accountId, targetAccountId, amountNpr, referenceId, reason, description, payeeOrParty } = req.body as {
      transactionType: FinanceApprovalTransactionType;
      accountId: string;
      targetAccountId?: string;
      amountNpr: number;
      referenceId?: string;
      reason: string;
      description?: string;
      payeeOrParty?: string;
    };
    const amt = Number(amountNpr);
    if (!amt || amt <= 0 || !reason?.trim()) {
      res.status(400).json({ error: 'Positive amount and reason are required.' });
      return;
    }
    const sourceAcc = db.accounts.find((a) => a.id === accountId);
    if (!sourceAcc) {
      res.status(404).json({ error: 'Account not found.' });
      return;
    }
    let targetAcc: BankCashAccount | undefined;
    if (transactionType === 'BANK_DEPOSIT') {
      targetAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (!targetAcc || targetAcc.id === sourceAcc.id) {
        res.status(400).json({ error: 'Valid destination account required for transfer.' });
        return;
      }
    }
    if (!Array.isArray(db.financeApprovalRequests)) db.financeApprovalRequests = [];
    const nowIso = new Date().toISOString();
    const ref = referenceId?.trim() || `VCH-${Date.now().toString().slice(-5)}`;
    const direction: FinanceApprovalDirection = transactionType === 'RECEIPT' ? 'IN' : 'OUT';
    const requestEntry: FinanceApprovalRequest = {
      id: `fap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requestNumber: `FAP-${adToBs(nowIso).year}-${String(db.financeApprovalRequests.length + 1).padStart(3, '0')}`,
      fiscalYear: db.settings.activeFiscalYear,
      createdAt: nowIso,
      updatedAt: nowIso,
      transactionType: transactionType || 'EXPENSE',
      direction,
      amountNpr: Number(amt.toFixed(2)),
      accountId: sourceAcc.id,
      accountName: sourceAcc.name,
      targetAccountId: targetAcc?.id,
      targetAccountName: targetAcc?.name,
      referenceId: ref,
      reason: reason.trim(),
      description: description?.trim() || reason.trim(),
      payeeOrParty: payeeOrParty?.trim(),
      requesterId: actor.id,
      requesterName: actor.fullName,
      requesterRole: actor.roleId,
      status: 'PENDING_MANAGER',
      reRequestCount: 0,
      history: [
        {
          id: `faph-${Date.now()}`,
          timestamp: nowIso,
          action: 'REQUESTED',
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          note: `Submitted ${transactionType} (${direction}) voucher for रू ${amt.toLocaleString()}.`,
          statusAfter: 'PENDING_MANAGER',
        },
      ],
    };
    db.financeApprovalRequests.unshift(requestEntry);
    appendAudit(
      db,
      actor,
      'FINANCE_APPROVAL',
      'FINANCE_REQUEST_SUBMITTED',
      requestEntry.requestNumber,
      `Submitted ${requestEntry.transactionType} request ${requestEntry.requestNumber} for रू ${amt.toLocaleString()} (${requestEntry.reason}).`
    );
    saveDb(db);
    res.status(201).json({ request: requestEntry, db: scopeDbForActor(db, actor) });
  });

  const processApprovalDecision = (
    db: LimsDatabase,
    actor: StaffMember,
    item: FinanceApprovalRequest,
    decision: 'APPROVE' | 'DECLINE',
    note?: string
  ): { ok: true } | { ok: false; status: number; error: string } => {
    const isAdmin = hasPermission(db, actor.roleId, 'finance.approve_admin') || actor.roleId === 'SUPER_ADMIN';
    const isManager = hasPermission(db, actor.roleId, 'finance.approve_manager') || isAdmin;
    const nowIso = new Date().toISOString();
    if (!Array.isArray(item.history)) item.history = [];

    if (item.status === 'APPROVED' || item.status === 'DECLINED') {
      return { ok: false, status: 400, error: `Request ${item.requestNumber} is already finalized (${item.status}).` };
    }

    if (decision === 'DECLINE') {
      if (!isManager && !isAdmin) {
        return { ok: false, status: 403, error: 'Only Manager or Admin can decline financial requests.' };
      }
      const reasonText = note?.trim() || `Declined by ${actor.fullName}`;
      item.status = 'DECLINED';
      item.declineReason = reasonText;
      item.updatedAt = nowIso;
      if (item.managerReviewedBy) {
        item.adminReviewedBy = actor.fullName;
        item.adminReviewedAt = nowIso;
      } else {
        item.managerReviewedBy = actor.fullName;
        item.managerReviewedAt = nowIso;
      }
      item.history.push({
        id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        action: 'DECLINED',
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: reasonText,
        statusAfter: 'DECLINED',
      });
      appendAudit(
        db,
        actor,
        'FINANCE_APPROVAL',
        'FINANCE_REQUEST_DECLINED',
        item.requestNumber,
        `Declined ${item.requestNumber} (रू ${item.amountNpr.toLocaleString()} · ${item.reason}). Reason: ${reasonText}`,
        'WARNING'
      );
      return { ok: true };
    }

    // APPROVE flow: Tier 1 (PENDING_MANAGER -> PENDING_ADMIN) -> Tier 2 (PENDING_ADMIN -> APPROVED + Ledger Post)
    if (item.status === 'PENDING_MANAGER') {
      if (!isManager) {
        return { ok: false, status: 403, error: 'Manager permission (finance.approve_manager) required for Tier-1 approval.' };
      }
      item.status = 'PENDING_ADMIN';
      item.managerReviewedBy = actor.fullName;
      item.managerReviewedAt = nowIso;
      item.updatedAt = nowIso;
      item.history.push({
        id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        action: 'APPROVED_BY_MANAGER',
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: note?.trim() || 'Manager Tier-1 verified; forwarded to Hospital Admin for final approval.',
        statusAfter: 'PENDING_ADMIN',
      });
      appendAudit(
        db,
        actor,
        'FINANCE_APPROVAL',
        'FINANCE_MANAGER_APPROVED',
        item.requestNumber,
        `Manager approved ${item.requestNumber} (रू ${item.amountNpr.toLocaleString()}) -> queued for Admin final sign-off.`
      );
      return { ok: true };
    }

    if (item.status === 'PENDING_ADMIN') {
      if (!isAdmin) {
        return { ok: false, status: 403, error: 'Admin permission (finance.approve_admin) required for final Tier-2 approval.' };
      }
      item.status = 'APPROVED';
      item.adminReviewedBy = actor.fullName;
      item.adminReviewedAt = nowIso;
      item.updatedAt = nowIso;
      item.history.push({
        id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        action: 'APPROVED_BY_ADMIN',
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: note?.trim() || 'Final Hospital Admin approval granted & posted to ledger.',
        statusAfter: 'APPROVED',
      });
      executeApprovedFinanceRequest(db, item, actor);
      appendAudit(
        db,
        actor,
        'FINANCE_APPROVAL',
        'FINANCE_ADMIN_APPROVED',
        item.requestNumber,
        `Admin finalized ${item.requestNumber} (रू ${item.amountNpr.toLocaleString()} · ${item.transactionType}) and posted to Treasury Ledger.`
      );
      return { ok: true };
    }

    return { ok: false, status: 400, error: 'Unsupported status transition.' };
  };

  app.post('/api/finance/approval-requests/:id/decision', withAuth('finance.view', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const item = (db.financeApprovalRequests || []).find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Finance approval request not found.' });
      return;
    }
    const { decision, note } = req.body as { decision: 'APPROVE' | 'DECLINE'; note?: string };
    if (decision !== 'APPROVE' && decision !== 'DECLINE') {
      res.status(400).json({ error: "Decision must be 'APPROVE' or 'DECLINE'." });
      return;
    }
    const outcome = processApprovalDecision(db, actor, item, decision, note);
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    saveDb(db);
    res.json({ request: item, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/finance/approval-requests/bulk-decision', withAuth('finance.view', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { ids, decision, note } = req.body as {
      ids: string[];
      decision: 'APPROVE' | 'DECLINE';
      note?: string;
    };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'Select at least one pending request for bulk action.' });
      return;
    }
    if (decision !== 'APPROVE' && decision !== 'DECLINE') {
      res.status(400).json({ error: "Decision must be 'APPROVE' or 'DECLINE'." });
      return;
    }
    const processed: string[] = [];
    const errors: string[] = [];
    for (const id of ids) {
      const item = (db.financeApprovalRequests || []).find((r) => r.id === id);
      if (!item) continue;
      const outcome = processApprovalDecision(db, actor, item, decision, note);
      if (outcome.ok) processed.push(item.requestNumber);
      else errors.push(`${item.requestNumber}: ${outcome.error}`);
    }
    if (processed.length === 0 && errors.length > 0) {
      res.status(403).json({ error: errors[0], errors });
      return;
    }
    saveDb(db);
    res.json({ processedCount: processed.length, processed, errors, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/finance/approval-requests/:id/re-request', withAuth('finance.view', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const item = (db.financeApprovalRequests || []).find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Finance approval request not found.' });
      return;
    }
    if (item.status !== 'DECLINED') {
      res.status(400).json({ error: 'Only declined requests can be re-applied / re-requested.' });
      return;
    }
    const { amountNpr, reason, description, referenceId, accountId, targetAccountId, note } = (req.body || {}) as {
      amountNpr?: number;
      reason?: string;
      description?: string;
      referenceId?: string;
      accountId?: string;
      targetAccountId?: string;
      note?: string;
    };
    const nowIso = new Date().toISOString();
    if (amountNpr !== undefined && Number(amountNpr) > 0) item.amountNpr = Number(Number(amountNpr).toFixed(2));
    if (reason?.trim()) item.reason = reason.trim();
    if (description?.trim()) item.description = description.trim();
    if (referenceId?.trim()) item.referenceId = referenceId.trim();
    if (accountId) {
      const acc = db.accounts.find((a) => a.id === accountId);
      if (acc) {
        item.accountId = acc.id;
        item.accountName = acc.name;
      }
    }
    if (targetAccountId) {
      const tAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (tAcc) {
        item.targetAccountId = tAcc.id;
        item.targetAccountName = tAcc.name;
      }
    }
    item.status = 'PENDING_MANAGER';
    item.declineReason = undefined;
    item.managerReviewedBy = undefined;
    item.managerReviewedAt = undefined;
    item.adminReviewedBy = undefined;
    item.adminReviewedAt = undefined;
    item.updatedAt = nowIso;
    item.reRequestCount = (item.reRequestCount || 0) + 1;
    if (!Array.isArray(item.history)) item.history = [];
    item.history.push({
      id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: nowIso,
      action: 'RE_REQUESTED',
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.roleId,
      note: note?.trim() || `Re-applied request (#${item.reRequestCount}) for रू ${item.amountNpr.toLocaleString()} after addressing decline feedback.`,
      statusAfter: 'PENDING_MANAGER',
    });
    appendAudit(
      db,
      actor,
      'FINANCE_APPROVAL',
      'FINANCE_RE_REQUESTED',
      item.requestNumber,
      `Re-submitted declined voucher ${item.requestNumber} (Attempt #${item.reRequestCount}, रू ${item.amountNpr.toLocaleString()}).`
    );
    saveDb(db);
    res.json({ request: item, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/finance/counter-close', withAuth('counter.close', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      shiftLabel,
      actualCountedCashNpr,
      notes,
      counterScope = 'HOSPITAL',
      employeeOnly = true,
    } = req.body as {
      shiftLabel: string;
      actualCountedCashNpr: number;
      notes?: string;
      counterScope?: 'HOSPITAL' | 'PHARMACY' | 'ALL';
      employeeOnly?: boolean;
    };
    const actualCash = Number(actualCountedCashNpr);
    if (Number.isNaN(actualCash) || actualCash < 0) {
      res.status(400).json({ error: 'Valid physical cash count is required.' });
      return;
    }

    const scope: 'HOSPITAL' | 'PHARMACY' | 'ALL' =
      counterScope === 'PHARMACY' || counterScope === 'ALL' ? counterScope : 'HOSPITAL';

    // Find last counter close for this scope & employee (if employeeOnly)
    const lastClose = db.counterCloses.find((c) => {
      const sameScope = (c.counterScope || 'HOSPITAL') === scope;
      const sameCashier = !employeeOnly || c.cashierId === actor.id;
      return sameScope && sameCashier;
    });
    const lastCloseTime = lastClose ? new Date(lastClose.closedAt).getTime() : 0;

    const cashAcc =
      scope === 'PHARMACY'
        ? db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'CASH_COUNTER') ||
          db.accounts.find((a) => a.type === 'CASH_COUNTER')
        : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
          db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER') ||
          db.accounts.find((a) => a.type === 'CASH_COUNTER');

    const openingCashNpr = lastClose ? lastClose.actualCountedCashNpr : 0;

    let cashSalesNpr = 0;
    let bankQrSalesNpr = 0;
    let centerCreditSalesNpr = 0;
    let depositsCollectedNpr = 0;
    let ipdCashBillsNpr = 0;

    if (scope === 'HOSPITAL' || scope === 'ALL') {
      const ordersSinceClose = db.orders.filter(
        (o) =>
          new Date(o.orderedAt).getTime() > lastCloseTime &&
          (!employeeOnly || !o.createdById || o.createdById === actor.id)
      );
      cashSalesNpr += ordersSinceClose.reduce((sum, o) => sum + (o.cashPaid || 0), 0);
      bankQrSalesNpr += ordersSinceClose.reduce((sum, o) => sum + (o.bankPaid || 0), 0);
      centerCreditSalesNpr += ordersSinceClose.reduce(
        (sum, o) => sum + (o.paymentMode === 'Center Credit' ? o.totalAmount : o.dueAmount || 0),
        0
      );

      // Include IPD deposits, settlements & individual IPD cash bills handled by cashier
      for (const adm of db.ipdAdmissions || []) {
        for (const dep of adm.deposits || []) {
          if (
            new Date(dep.timestamp).getTime() > lastCloseTime &&
            (!employeeOnly || dep.receivedBy === actor.fullName)
          ) {
            depositsCollectedNpr += dep.amountNpr || 0;
            if (dep.paymentMode === 'Bank / QR') {
              bankQrSalesNpr += dep.amountNpr || 0;
            } else {
              cashSalesNpr += dep.amountNpr || 0;
            }
          }
        }
        for (const cb of adm.ipdIndividualBills || []) {
          if (
            new Date(cb.billedAt).getTime() > lastCloseTime &&
            (!employeeOnly || !cb.billedById || cb.billedById === actor.id)
          ) {
            ipdCashBillsNpr += cb.amountNpr || 0;
            if (cb.paymentMode === 'Bank / QR') {
              bankQrSalesNpr += cb.amountNpr || 0;
            } else {
              cashSalesNpr += cb.amountNpr || 0;
            }
          }
        }
      }
    }

    if (scope === 'PHARMACY' || scope === 'ALL') {
      const pharmInvsSinceClose = (db.pharmacyInvoices || []).filter(
        (inv) =>
          new Date(inv.dispensedAt).getTime() > lastCloseTime &&
          (!employeeOnly || !inv.dispensedById || inv.dispensedById === actor.id)
      );
      cashSalesNpr += pharmInvsSinceClose.reduce((sum, i) => sum + (i.cashPaid || 0), 0);
      bankQrSalesNpr += pharmInvsSinceClose.reduce((sum, i) => sum + (i.bankPaid || 0), 0);
      centerCreditSalesNpr += pharmInvsSinceClose.reduce((sum, i) => sum + (i.dueAmountNpr || 0), 0);

      for (const pdep of db.pharmacyDeposits || []) {
        if (
          new Date(pdep.receivedAt).getTime() > lastCloseTime &&
          (!employeeOnly || !pdep.receivedById || pdep.receivedById === actor.id)
        ) {
          depositsCollectedNpr += pdep.amountNpr || 0;
          if (pdep.paymentMode === 'Bank / QR') {
            bankQrSalesNpr += pdep.amountNpr || 0;
          } else {
            cashSalesNpr += pdep.amountNpr || 0;
          }
        }
      }
    }

    const cashOutflowsNpr = db.financialLedger
      .filter(
        (f) =>
          cashAcc &&
          f.accountId === cashAcc.id &&
          f.direction === 'OUTFLOW' &&
          new Date(f.timestamp).getTime() > lastCloseTime &&
          (!employeeOnly || f.recordedBy === actor.fullName)
      )
      .reduce((sum, f) => sum + f.amount, 0);

    cashSalesNpr = Number(cashSalesNpr.toFixed(2));
    bankQrSalesNpr = Number(bankQrSalesNpr.toFixed(2));
    centerCreditSalesNpr = Number(centerCreditSalesNpr.toFixed(2));
    depositsCollectedNpr = Number(depositsCollectedNpr.toFixed(2));
    ipdCashBillsNpr = Number(ipdCashBillsNpr.toFixed(2));

    const expectedClosingCashNpr = Number(Math.max(0, openingCashNpr + cashSalesNpr - cashOutflowsNpr).toFixed(2));
    const varianceNpr = Number((actualCash - expectedClosingCashNpr).toFixed(2));
    const bsNow = adToBs(new Date());

    const record: CounterCloseRecord = {
      id: `cls-${Date.now()}`,
      closedAt: new Date().toISOString(),
      fiscalYear: db.settings.activeFiscalYear,
      bsDate: bsNow.formattedEn,
      shiftLabel: shiftLabel || `${actor.shift || 'Morning'} · ${scope} Counter`,
      cashierId: actor.id,
      cashierName: actor.fullName,
      counterScope: scope,
      staffRole: db.roles.find((r) => r.id === actor.roleId)?.name || actor.roleId,
      depositsCollectedNpr,
      ipdCashBillsNpr,
      openingCashNpr,
      cashSalesNpr,
      bankQrSalesNpr,
      centerCreditSalesNpr,
      cashOutflowsNpr,
      expectedClosingCashNpr,
      actualCountedCashNpr: actualCash,
      varianceNpr,
      notes: notes || `Verified physical cash count for ${scope} Counter (${actor.fullName}).`,
      status: 'LOCKED_CLOSED',
    };

    db.counterCloses.unshift(record);
    appendAudit(
      db,
      actor,
      'COUNTER_CLOSE',
      'DAILY_COUNTER_CLOSED',
      record.id,
      `Closed ${scope} counter by ${actor.fullName} (${record.shiftLabel}, BS ${record.bsDate}). Expected रू ${expectedClosingCashNpr.toLocaleString()}, Counted रू ${actualCash.toLocaleString()}, Variance रू ${varianceNpr.toLocaleString()}.`,
      varianceNpr !== 0 ? 'WARNING' : 'INFO'
    );
    saveDb(db);
    res.status(201).json({ record, db: scopeDbForActor(db, actor) });
  });

  // --- HOSPITAL ASSETS REGISTER (ADD / EDIT / DELETE) ---
  app.post('/api/finance/assets', withAuth('finance.manage', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<HospitalAsset>;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Asset name is required.' });
      return;
    }
    if (!Array.isArray(db.hospitalAssets)) db.hospitalAssets = [];
    const existingIdx = body.id ? db.hospitalAssets.findIndex((a) => a.id === body.id) : -1;
    const nowIso = new Date().toISOString();
    const asset: HospitalAsset = {
      id: existingIdx >= 0 ? db.hospitalAssets[existingIdx].id : `ast-${Date.now()}`,
      assetCode:
        body.assetCode?.trim().toUpperCase() ||
        `AST-${String(db.hospitalAssets.length + 1).padStart(3, '0')}`,
      name: body.name.trim(),
      category: body.category || 'Medical Equipment',
      departmentScope: body.departmentScope || 'HOSPITAL',
      location: body.location?.trim() || 'Main Hospital',
      purchaseDate: body.purchaseDate?.trim() || nowIso.slice(0, 10),
      purchaseCostNpr: Math.max(0, Number(body.purchaseCostNpr) || 0),
      currentValueNpr:
        body.currentValueNpr !== undefined
          ? Math.max(0, Number(body.currentValueNpr) || 0)
          : Math.max(0, Number(body.purchaseCostNpr) || 0),
      vendorName: body.vendorName?.trim() || '',
      warrantyUntil: body.warrantyUntil?.trim() || '',
      status: body.status || 'Active',
      notes: body.notes?.trim() || '',
      createdAt: existingIdx >= 0 ? db.hospitalAssets[existingIdx].createdAt : nowIso,
    };
    if (existingIdx >= 0) db.hospitalAssets[existingIdx] = asset;
    else db.hospitalAssets.unshift(asset);
    appendAudit(
      db,
      actor,
      'FINANCE',
      existingIdx >= 0 ? 'ASSET_UPDATED' : 'ASSET_CREATED',
      asset.assetCode,
      `${existingIdx >= 0 ? 'Updated' : 'Registered'} asset ${asset.name} (${asset.assetCode}) — Cost रू ${asset.purchaseCostNpr.toLocaleString()}.`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ asset, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/finance/assets/:id', withAuth('finance.manage', 'finance_counter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.hospitalAssets)) db.hospitalAssets = [];
    const idx = db.hospitalAssets.findIndex((a) => a.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }
    const [removed] = db.hospitalAssets.splice(idx, 1);
    appendAudit(db, actor, 'FINANCE', 'ASSET_DELETED', removed.assetCode, `Deleted asset ${removed.name}.`, 'WARNING');
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  // --- LIVE DISCOUNT & CREDIT LIMIT APPROVALS WORKFLOW (MANAGER -> ADMIN OR ADMIN-ONLY) ---
  app.get('/api/approvals/discount-credit', withAuth(), (req: Request, res: Response) => {
    const { db } = req as AuthedRequest;
    res.json({ approvals: db.discountCreditApprovals || [] });
  });

  app.post('/api/approvals/discount-credit', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<DiscountCreditApprovalRequest>;
    if (!body.patientName?.trim() || !body.requestType || !body.sourceModule) {
      res.status(400).json({ error: 'Patient name, request type, and source module are required.' });
      return;
    }
    if (!Array.isArray(db.discountCreditApprovals)) db.discountCreditApprovals = [];
    const ms = db.settings?.moduleSettings;
    const configuredPolicy =
      body.requestType === 'DISCOUNT_OVERRIDE'
        ? ms?.discountApprovalPolicy || 'MANAGER_THEN_ADMIN'
        : ms?.creditApprovalPolicy || 'MANAGER_THEN_ADMIN';
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const seq = 101 + db.discountCreditApprovals.length;
    const initialStatus = configuredPolicy === 'ADMIN_ONLY' ? 'PENDING_ADMIN' : 'PENDING_MANAGER';

    const created: DiscountCreditApprovalRequest = {
      id: `dca-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requestNumber: `APR-${bsNow.year}-${seq}`,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      createdAt: nowIso,
      updatedAt: nowIso,
      requestType: body.requestType,
      sourceModule: body.sourceModule,
      approvalPolicy: configuredPolicy,
      patientName: body.patientName.trim(),
      uhid: body.uhid?.trim() || '',
      encounterLabel: body.encounterLabel?.trim() || '',
      referenceId: body.referenceId,
      referenceCode: body.referenceCode,
      billSubtotalNpr: body.billSubtotalNpr !== undefined ? Number(body.billSubtotalNpr) : undefined,
      requestedValueNpr: Math.max(0, Number(body.requestedValueNpr) || 0),
      requestedPercent: body.requestedPercent !== undefined ? Number(body.requestedPercent) : undefined,
      currentLimitNpr: body.currentLimitNpr !== undefined ? Number(body.currentLimitNpr) : undefined,
      reason: body.reason?.trim() || 'Requested approval override',
      requesterId: actor.id,
      requesterName: actor.fullName,
      requesterRole: actor.roleId,
      status: initialStatus,
      history: [
        {
          id: `dcah-${Date.now()}`,
          timestamp: nowIso,
          action: 'REQUESTED',
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          remarks: body.reason?.trim() || 'Submitted for approval',
          statusAfter: initialStatus,
        },
      ],
    };

    if (created.requestType === 'CREDIT_LIMIT_OVERRIDE' && created.sourceModule === 'IPD' && created.referenceId) {
      const adm = (db.ipdAdmissions || []).find((a) => a.id === created.referenceId);
      if (adm) adm.creditApprovalStatus = 'PENDING_ADMIN_CREDIT';
    }

    db.discountCreditApprovals.unshift(created);
    appendAudit(
      db,
      actor,
      'FINANCE_APPROVAL',
      'DISCOUNT_CREDIT_REQUESTED',
      created.requestNumber,
      `Submitted ${created.requestType === 'DISCOUNT_OVERRIDE' ? 'Discount' : 'Credit Limit'} approval ${created.requestNumber} (${created.sourceModule}) for ${created.patientName}: रू ${created.requestedValueNpr.toLocaleString()} (${configuredPolicy}).`
    );
    saveDb(db);
    res.status(201).json({ approval: created, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/approvals/discount-credit/:id/decision', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.discountCreditApprovals)) db.discountCreditApprovals = [];
    const reqItem = db.discountCreditApprovals.find((r) => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: 'Approval request not found.' });
      return;
    }
    const { decision, remarks } = (req.body || {}) as { decision: 'APPROVE' | 'DECLINE'; remarks?: string };
    const isAdmin = actor.roleId === 'SUPER_ADMIN' || actor.roleId === 'SAAS_ADMIN' || hasPermission(db, actor.roleId, 'finance.approve_admin');
    const isManager = isAdmin || hasPermission(db, actor.roleId, 'finance.approve_manager') || actor.roleId === 'CENTER_MANAGER' || actor.roleId === 'INVENTORY_HR';

    if (!isManager) {
      res.status(403).json({ error: 'Manager or Hospital Admin role required to decide approvals.' });
      return;
    }

    const nowIso = new Date().toISOString();
    if (decision === 'DECLINE') {
      reqItem.status = 'DECLINED';
      reqItem.updatedAt = nowIso;
      if (isAdmin) {
        reqItem.adminReviewedBy = actor.fullName;
        reqItem.adminReviewedAt = nowIso;
        reqItem.adminRemarks = remarks?.trim() || 'Declined';
      } else {
        reqItem.managerReviewedBy = actor.fullName;
        reqItem.managerReviewedAt = nowIso;
        reqItem.managerRemarks = remarks?.trim() || 'Declined by Manager';
      }
      reqItem.history.unshift({
        id: `dcah-${Date.now()}`,
        timestamp: nowIso,
        action: 'DECLINED',
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        remarks: remarks?.trim() || 'Declined',
        statusAfter: 'DECLINED',
      });
    } else {
      if (reqItem.status === 'PENDING_MANAGER' && !isAdmin && reqItem.approvalPolicy === 'MANAGER_THEN_ADMIN') {
        reqItem.status = 'PENDING_ADMIN';
        reqItem.managerReviewedBy = actor.fullName;
        reqItem.managerReviewedAt = nowIso;
        reqItem.managerRemarks = remarks?.trim() || 'Verified & forwarded to Hospital Admin';
        reqItem.updatedAt = nowIso;
        reqItem.history.unshift({
          id: `dcah-${Date.now()}`,
          timestamp: nowIso,
          action: 'APPROVED_BY_MANAGER',
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          remarks: reqItem.managerRemarks,
          statusAfter: 'PENDING_ADMIN',
        });
      } else {
        if (!isAdmin) {
          res.status(403).json({ error: 'Final approval requires Hospital Admin (SUPER_ADMIN).' });
          return;
        }
        reqItem.status = 'APPROVED';
        reqItem.adminReviewedBy = actor.fullName;
        reqItem.adminReviewedAt = nowIso;
        reqItem.adminRemarks = remarks?.trim() || 'Approved by Admin';
        reqItem.updatedAt = nowIso;
        reqItem.history.unshift({
          id: `dcah-${Date.now()}`,
          timestamp: nowIso,
          action: 'APPROVED_BY_ADMIN',
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          remarks: reqItem.adminRemarks,
          statusAfter: 'APPROVED',
        });

        // Auto-apply credit limit extension to matching IPD or ER record when approved
        if (reqItem.requestType === 'CREDIT_LIMIT_OVERRIDE') {
          const adm = (db.ipdAdmissions || []).find(
            (a) =>
              (reqItem.referenceId && a.id === reqItem.referenceId) ||
              (reqItem.sourceModule === 'PHARMACY_POS' &&
                reqItem.uhid &&
                a.uhid === reqItem.uhid &&
                a.disposition === 'Admitted')
          );
          if (adm) {
            adm.creditLimitNpr = Math.max(adm.creditLimitNpr || 0, reqItem.requestedValueNpr);
            adm.creditApprovalStatus = 'APPROVED';
            adm.creditApprovedBy = actor.fullName;
            adm.creditApprovedAt = nowIso;
            adm.creditApprovalNote = reqItem.adminRemarks;
          }
          const er = (db.emergencyCases || []).find(
            (e) =>
              (reqItem.referenceId && e.id === reqItem.referenceId) ||
              (reqItem.sourceModule === 'PHARMACY_POS' &&
                reqItem.uhid &&
                e.uhid === reqItem.uhid &&
                e.disposition === 'Under Observation (ER)')
          );
          if (er) {
            er.creditLimitNpr = Math.max(er.creditLimitNpr || 0, reqItem.requestedValueNpr);
          }
        }
      }
    }

    appendAudit(
      db,
      actor,
      'FINANCE_APPROVAL',
      `APPROVAL_${reqItem.status}`,
      reqItem.requestNumber,
      `${actor.fullName} updated ${reqItem.requestNumber} (${reqItem.patientName}) to ${reqItem.status}. Remarks: ${remarks?.trim() || '—'}`
    );
    saveDb(db);
    res.json({ approval: reqItem, db: scopeDbForActor(db, actor) });
  });

  // Personnel & HR + Payroll
  app.post('/api/personnel', withAuth('personnel.manage', 'hr_payroll'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const member = req.body as Partial<StaffMember>;
    if (!member.fullName?.trim() || !member.employeeCode?.trim()) {
      res.status(400).json({ error: 'Employee code and full name are required.' });
      return;
    }
    if (db.saas && db.staff.filter((s) => s.status !== 'Suspended').length >= db.saas.maxStaffSeats) {
      res.status(403).json({
        error: `SaaS Seat Limit Reached (${db.saas.maxStaffSeats} seats). Upgrade seat quota in SaaS Control.`,
      });
      return;
    }
    const requestedRole = (member.roleId as RoleId) || 'LAB_TECH';
    const roleExists = db.roles.some((r) => r.id === requestedRole);
    if (!roleExists) {
      res.status(400).json({ error: `Selected role '${requestedRole}' does not exist.` });
      return;
    }
    if (
      db.saas?.allowedRoleIds?.length &&
      !db.saas.allowedRoleIds.includes(requestedRole) &&
      !db.roles.find((r) => r.id === requestedRole)?.isCustom
    ) {
      res.status(403).json({
        error: `SaaS Role Capacity Restriction: Role '${requestedRole}' is not enabled in the tenant's active Roles Capacity policy.`,
      });
      return;
    }
    if (requestedRole === 'SUPER_ADMIN' && actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({
        error: 'Only Hospital Admin can assign the SUPER_ADMIN role.',
      });
      return;
    }
    const rawUsername = (
      member.username?.trim() ||
      member.employeeCode.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    ).toLowerCase();
    if (db.staff.some((s) => s.username.toLowerCase() === rawUsername)) {
      res.status(400).json({ error: `Username '@${rawUsername}' is already assigned to another staff member.` });
      return;
    }
    const pinStr = String(member.pin || '1234').trim();
    if (!/^\d{4,6}$/.test(pinStr)) {
      res.status(400).json({ error: 'Admin-created PIN must be 4 to 6 digits.' });
      return;
    }

    const created: StaffMember = {
      id: `staff-${Date.now()}`,
      employeeCode: member.employeeCode.trim(),
      username: rawUsername,
      password: member.password?.trim() || 'Hosp@2083',
      pin: pinStr,
      failedAttempts: 0,
      isLocked: false,
      fullName: member.fullName.trim(),
      designation: member.designation || 'Hospital Clinical Specialist',
      department: member.department || 'Clinical Pathology',
      email: member.email || '',
      phone: member.phone || '',
      roleId: requestedRole,
      shift: member.shift || 'Morning (07:00-15:00)',
      status: member.status || 'Active',
      certification: member.certification || 'NHPC Certified',
      registrationNumber: member.registrationNumber,
      canSignReports: Boolean(member.canSignReports),
      assignedCenterId: null,
      assignedCenterName: 'Saptari Hospital Pvt Ltd',
      joinedAt: member.joinedAt || new Date().toISOString().slice(0, 10),
      basicSalaryNpr: Number(member.basicSalaryNpr) || 35000,
      technicalAllowanceNpr: Number(member.technicalAllowanceNpr) || 5000,
      shiftAllowanceNpr: Number(member.shiftAllowanceNpr) || 0,
      ssfPercent: Number(member.ssfPercent ?? 11),
      tdsPercent: Number(member.tdsPercent ?? 1),
      bankAccountNumber: member.bankAccountNumber || '',
    };
    db.staff.push(created);
    appendAudit(
      db,
      actor,
      'PERSONNEL',
      'STAFF_ONBOARDED',
      created.employeeCode,
      `Added ${created.fullName} (@${created.username}, ${created.roleId}) at ${created.assignedCenterName} with Admin-assigned PIN and Basic Salary रू ${created.basicSalaryNpr.toLocaleString()}.`
    );
    saveDb(db);
    res.status(201).json({ db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/personnel/:id', withAuth('personnel.manage', 'hr_payroll'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const member = db.staff.find((s) => s.id === req.params.id);
    if (!member) {
      res.status(404).json({ error: 'Staff member not found.' });
      return;
    }
    const updates = req.body as Partial<StaffMember>;
    if (updates.roleId && updates.roleId !== member.roleId && !hasPermission(db, actor.roleId, 'rbac.manage')) {
      res.status(403).json({ error: 'Changing user RBAC roles requires Super Admin permission (rbac.manage).' });
      return;
    }
    if (updates.pin && !/^\d{4,6}$/.test(String(updates.pin).trim())) {
      res.status(400).json({ error: 'PIN must be 4 to 6 numeric digits.' });
      return;
    }
    Object.assign(member, updates);
    member.assignedCenterId = null;
    member.assignedCenterName = 'Saptari Hospital Pvt Ltd';
    appendAudit(db, actor, 'PERSONNEL', 'STAFF_UPDATED', member.employeeCode, `Updated personnel record for ${member.fullName} (Status: ${member.status}, Role: ${member.roleId}).`);
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });

  app.post('/api/payroll/run', withAuth('payroll.manage', 'hr_payroll'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { bsMonthLabel, disburseImmediately, accountId } = req.body as {
      bsMonthLabel: string;
      disburseImmediately?: boolean;
      accountId?: string;
    };
    const activeStaff = db.staff.filter((s) => s.status !== 'Suspended');
    const items: PayrollLineItem[] = activeStaff.map((s) => {
      const allowances = (s.technicalAllowanceNpr || 0) + (s.shiftAllowanceNpr || 0);
      const grossSalary = (s.basicSalaryNpr || 0) + allowances;
      const ssfDeduction = Math.round(((s.basicSalaryNpr || 0) * (s.ssfPercent || 0)) / 100);
      const tdsDeduction = Math.round((grossSalary * (s.tdsPercent || 0)) / 100);
      const netPayable = Math.max(0, grossSalary - ssfDeduction - tdsDeduction);
      return {
        staffId: s.id,
        employeeCode: s.employeeCode,
        fullName: s.fullName,
        designation: s.designation,
        basicSalary: s.basicSalaryNpr || 0,
        allowances,
        grossSalary,
        ssfDeduction,
        tdsDeduction,
        netPayable,
      };
    });

    const totalGrossNpr = items.reduce((s, i) => s + i.grossSalary, 0);
    const totalDeductionsNpr = items.reduce((s, i) => s + i.ssfDeduction + i.tdsDeduction, 0);
    const totalNetNpr = items.reduce((s, i) => s + i.netPayable, 0);

    const bankAcc =
      (accountId && db.accounts.find((a) => a.id === accountId)) ||
      db.accounts.find((a) => a.type === 'BANK') ||
      db.accounts[0];

    const run: PayrollRun = {
      id: `pay-${Date.now()}`,
      createdAt: new Date().toISOString(),
      fiscalYear: db.settings.activeFiscalYear,
      bsMonthLabel: bsMonthLabel?.trim() || `${adToBs(new Date()).monthNameEn} ${adToBs(new Date()).year}`,
      status: disburseImmediately ? 'Disbursed' : 'Draft',
      paidFromAccountId: disburseImmediately && bankAcc ? bankAcc.id : undefined,
      paidFromAccountName: disburseImmediately && bankAcc ? bankAcc.name : undefined,
      totalGrossNpr,
      totalDeductionsNpr,
      totalNetNpr,
      approvedBy: actor.fullName,
      items,
    };

    if (disburseImmediately && bankAcc) {
      postLedgerMovement(
        db,
        bankAcc,
        'OUTFLOW',
        totalNetNpr,
        'PAYROLL_DISBURSEMENT',
        run.id,
        `Payroll disbursement for ${run.bsMonthLabel} (${items.length} staff)`,
        run.fiscalYear,
        actor
      );
    }

    db.payrollRuns.unshift(run);
    appendAudit(
      db,
      actor,
      'PAYROLL',
      disburseImmediately ? 'PAYROLL_DISBURSED' : 'PAYROLL_DRAFTED',
      run.id,
      `Generated payroll for ${run.bsMonthLabel} (${items.length} staff, Net रू ${totalNetNpr.toLocaleString()}).`
    );
    saveDb(db);
    res.status(201).json({ run, db });
  });

  app.post('/api/payroll/:id/disburse', withAuth('payroll.manage', 'hr_payroll'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const run = db.payrollRuns.find((p) => p.id === req.params.id);
    if (!run) {
      res.status(404).json({ error: 'Payroll run not found.' });
      return;
    }
    if (run.status === 'Disbursed') {
      res.status(400).json({ error: 'Payroll batch is already disbursed.' });
      return;
    }
    const { accountId } = req.body as { accountId: string };
    const bankAcc = db.accounts.find((a) => a.id === accountId) || db.accounts.find((a) => a.type === 'BANK');
    if (!bankAcc) {
      res.status(400).json({ error: 'Valid disbursement account required.' });
      return;
    }
    run.status = 'Disbursed';
    run.paidFromAccountId = bankAcc.id;
    run.paidFromAccountName = bankAcc.name;
    postLedgerMovement(
      db,
      bankAcc,
      'OUTFLOW',
      run.totalNetNpr,
      'PAYROLL_DISBURSEMENT',
      run.id,
      `Payroll disbursement for ${run.bsMonthLabel}`,
      run.fiscalYear,
      actor
    );
    appendAudit(db, actor, 'PAYROLL', 'PAYROLL_DISBURSED', run.id, `Disbursed रू ${run.totalNetNpr.toLocaleString()} from ${bankAcc.name} for ${run.bsMonthLabel}.`);
    saveDb(db);
    res.json({ db });
  });

  // Daily Sales to Admin WhatsApp Dispatch
  app.post('/api/whatsapp/send-daily-sales', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { recipientPhone, customNote } = req.body as {
      recipientPhone?: string;
      customNote?: string;
    };
    const targetPhone = (recipientPhone || db.settings.adminWhatsAppNumber || '').trim();
    if (!targetPhone) {
      res.status(400).json({ error: 'Admin WhatsApp number is required.' });
      return;
    }

    const now = new Date();
    const bsToday = adToBs(now);
    const todayOrders = db.orders.filter(
      (o) => adToBs(o.orderedAt).formattedEn === bsToday.formattedEn
    );
    const summaryOrders = todayOrders.length > 0 ? todayOrders : db.orders.slice(0, 5);
    const totalSalesNpr = summaryOrders.reduce((s, o) => s + o.totalAmount, 0);
    const cashNpr = summaryOrders.reduce((s, o) => s + (o.cashPaid || 0), 0);
    const bankNpr = summaryOrders.reduce((s, o) => s + (o.bankPaid || 0), 0);
    const creditNpr = Math.max(0, totalSalesNpr - cashNpr - bankNpr);
    const validatedCount = summaryOrders.filter((o) => o.status === 'Validated' || o.status === 'Dispatched').length;
    const pendingCount = summaryOrders.length - validatedCount;

    const messageText = [
      `*${db.settings.labName} — Daily Sales Report*`,
      `BS Date: ${bsToday.formattedEn} (${bsToday.formattedNp})`,
      `Fiscal Year: ${db.settings.activeFiscalYear} | PAN: ${db.settings.panNumber}`,
      `Total Orders: ${summaryOrders.length} (${validatedCount} Validated, ${pendingCount} Pending)`,
      `Total Sales: रू ${totalSalesNpr.toLocaleString()}`,
      `• Cash Counter: रू ${cashNpr.toLocaleString()}`,
      `• Bank / QR: रू ${bankNpr.toLocaleString()}`,
      `• Center Credit / Due: रू ${creditNpr.toLocaleString()}`,
      customNote ? `Note: ${customNote}` : null,
      `Dispatched by: ${actor.fullName}`,
    ]
      .filter(Boolean)
      .join('\n');

    const log: WhatsAppDispatchLog = {
      id: `wa-${Date.now()}`,
      timestamp: now.toISOString(),
      bsDate: bsToday.formattedEn,
      recipientPhone: targetPhone,
      totalSalesNpr,
      ordersCount: summaryOrders.length,
      messagePreview: messageText.replace(/\n/g, ' · '),
      sentBy: actor.fullName,
      status: 'Sent via WhatsApp',
    };
    db.whatsappLogs.unshift(log);
    appendAudit(
      db,
      actor,
      'WHATSAPP',
      'DAILY_SALES_WHATSAPP_SENT',
      targetPhone,
      `Dispatched daily sales summary (रू ${totalSalesNpr.toLocaleString()}, ${summaryOrders.length} orders) to Admin WhatsApp ${targetPhone}.`
    );
    saveDb(db);

    const digits = targetPhone.replace(/[^\d]/g, '');
    const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`;
    res.status(201).json({ log, messageText, whatsappUrl, db });
  });

  // Dynamic Bill & Report Document Design Studio (Exclusive SaaS Admin)
  app.post('/api/designs', withAuth('designs.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<DocumentDesignTemplate> & { reason?: string };
    if (!body.name?.trim() || !body.headerTitle?.trim()) {
      res.status(400).json({ error: 'Design template name and header title are required.' });
      return;
    }
    const reasonStr = (body.reason || '').trim();
    if (!reasonStr) {
      res.status(400).json({ error: 'A mandatory Reason is required when Hospital Admin creates or modifies Bill/Report designs.' });
      return;
    }

    const existingIdx = body.id ? db.documentDesigns.findIndex((d) => d.id === body.id) : -1;
    const saved: DocumentDesignTemplate = {
      id: existingIdx >= 0 ? db.documentDesigns[existingIdx].id : `dsn-${Date.now()}`,
      name: body.name.trim(),
      entityType: body.entityType || 'Main Lab',
      centerId: null,
      targetScope: body.targetScope || 'BOTH',
      templateStyle: body.templateStyle || 'EXECUTIVE_HOSPITAL',
      headerTitle: body.headerTitle.trim(),
      headerTitleNp: body.headerTitleNp?.trim() || '',
      subTitle: body.subTitle?.trim() || '',
      addressText: body.addressText?.trim() || db.settings.addressLine,
      phoneText: body.phoneText?.trim() || db.settings.contactLine,
      panNumber: body.panNumber?.trim() || db.settings.panNumber,
      licenseNumber: body.licenseNumber?.trim() || '',
      billHeading: body.billHeading?.trim() || 'OFFICIAL TAX INVOICE / HOSPITAL BILL',
      reportHeading: body.reportHeading?.trim() || 'CLINICAL DIAGNOSTIC LABORATORY REPORT',
      radiologyHeading: body.radiologyHeading?.trim() || 'DEPARTMENT OF RADIOLOGY & DIAGNOSTIC IMAGING REPORT',
      topBannerText: body.topBannerText?.trim() || '',
      footerDisclaimerText:
        body.footerDisclaimerText?.trim() ||
        'Electronically verified document. Scan QR code for live authenticity check.',
      footerSignatureTitle: body.footerSignatureTitle?.trim() || 'Authorized Signatory',
      watermarkText: body.watermarkText?.trim() || 'VERIFIED',
      showWatermark: Boolean(body.showWatermark),
      accentColor: body.accentColor || '#1d4ed8',
      paperFormat: body.paperFormat || 'A5',
      showLetterheadBanner: body.showLetterheadBanner ?? true,
      showQrCode: body.showQrCode ?? true,
      qrPayloadMode: body.qrPayloadMode || 'VERIFY_URL',
      showBarcode: body.showBarcode ?? true,
      barcodeSource: body.barcodeSource || 'ACCESSION',
      showNepaliDate: body.showNepaliDate ?? true,
      showPan: body.showPan ?? true,
      showCollectionCenter: false,
      showDoctorRef: body.showDoctorRef ?? true,
      showTatBadge: body.showTatBadge ?? true,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.fullName,
    };

    if (existingIdx >= 0) {
      db.documentDesigns[existingIdx] = saved;
    } else {
      db.documentDesigns.unshift(saved);
    }

    appendAudit(
      db,
      actor,
      'DESIGNS',
      existingIdx >= 0 ? 'DOCUMENT_DESIGN_UPDATED' : 'DOCUMENT_DESIGN_CREATED',
      saved.id,
      `Hospital Admin ${existingIdx >= 0 ? 'updated' : 'created'} print design '${saved.name}' (${saved.paperFormat}, ${saved.templateStyle}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ design: saved, db });
  });

  app.delete('/api/designs/:id', withAuth('designs.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { reason } = (req.body || {}) as { reason?: string };
    const reasonStr = (reason || (req.query.reason as string) || '').trim();
    if (!reasonStr) {
      res.status(400).json({ error: 'A mandatory Reason is required to delete a Document Design.' });
      return;
    }
    if (req.params.id === 'dsn-main') {
      res.status(400).json({ error: 'Default Hospital Master template cannot be deleted.' });
      return;
    }
    const idx = db.documentDesigns.findIndex((d) => d.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Document design not found.' });
      return;
    }
    const [removed] = db.documentDesigns.splice(idx, 1);
    appendAudit(
      db,
      actor,
      'DESIGNS',
      'DOCUMENT_DESIGN_DELETED',
      removed.id,
      `Hospital Admin deleted design '${removed.name}'. Reason: ${reasonStr}`,
      'WARNING'
    );
    saveDb(db);
    res.json({ ok: true, db });
  });

  // Admin Control: Modules, Role Capacity & Storage Telemetry (Consolidated from SaaS into Hospital Admin)
  app.get('/api/saas/telemetry', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db } = req as AuthedRequest;
    res.json({ telemetry: computeSaasTelemetry(db), saas: db.saas });
  });

  app.patch('/api/saas/modules/:key', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const mod = db.saas.modules.find((m) => m.key === req.params.key);
    if (!mod) {
      res.status(404).json({ error: 'Hospital module not found.' });
      return;
    }
    const { enabled, reason } = req.body as { enabled: boolean; reason?: string };
    const reasonStr = (reason || 'Admin module toggle').trim();
    if (mod.lockedCore && !enabled) {
      res.status(400).json({ error: 'Core clinical diagnostic engine cannot be disabled.' });
      return;
    }
    mod.enabled = Boolean(enabled);
    mod.lastToggledAt = new Date().toISOString();
    mod.lastToggledBy = actor.fullName;
    mod.lastReason = reasonStr;
    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      mod.enabled ? 'MODULE_ENABLED' : 'MODULE_DISABLED',
      mod.key,
      `${mod.enabled ? 'Enabled' : 'Disabled'} hospital module '${mod.name}'. Reason: ${reasonStr}`,
      mod.enabled ? 'INFO' : 'WARNING'
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db) });
  });

  app.put('/api/saas/roles-capacity', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { maxRolesCapacity, allowedRoleIds, reason } = req.body as {
      maxRolesCapacity?: number;
      allowedRoleIds?: RoleId[];
      reason?: string;
    };
    const reasonStr = (reason || 'Hospital Admin role allocation adjustment').trim();
    const nextMax = Math.max(1, Math.min(12, Number(maxRolesCapacity ?? db.saas.maxRolesCapacity)));
    let nextRoles: RoleId[] = Array.isArray(allowedRoleIds)
      ? Array.from(new Set(allowedRoleIds))
      : [...db.saas.allowedRoleIds];

    if (!nextRoles.includes('SUPER_ADMIN')) {
      nextRoles = ['SUPER_ADMIN', ...nextRoles];
    }
    if (nextRoles.length > nextMax) {
      res.status(400).json({
        error: `Selected roles (${nextRoles.length}) exceed Max Roles Capacity (${nextMax}). Increase capacity or uncheck roles.`,
      });
      return;
    }

    db.saas.maxRolesCapacity = nextMax;
    db.saas.allowedRoleIds = nextRoles;
    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'ROLES_CAPACITY_UPDATED',
      db.saas.tenantId,
      `Updated Hospital role capacity to max ${nextMax} roles (${nextRoles.join(', ')}). Reason: ${reasonStr}`,
      'WARNING'
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db) });
  });

  // Exclusive SaaS Platform Admin: Lab Tenant Creation & Deletion (Name, PAN, Phone, Address)
  app.post('/api/saas/tenants', withAuth('saas.tenants.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<SaasTenantLab> & { reason?: string };
    const reasonStr = (body.controlReason || body.reason || '').trim();
    if (!body.name?.trim() || !body.panNumber?.trim() || !body.phone?.trim() || !body.address?.trim()) {
      res.status(400).json({
        error: 'Lab Name, PAN Number, Phone, and Address are all required to provision a SaaS tenant.',
      });
      return;
    }
    if (!reasonStr) {
      res.status(400).json({ error: 'A mandatory Reason is required for SaaS Tenant provisioning.' });
      return;
    }
    const maxRoles = Math.max(1, Number(body.maxRolesAllowed) || 5);
    const roles: RoleId[] =
      Array.isArray(body.allowedRoles) && body.allowedRoles.length > 0
        ? body.allowedRoles.slice(0, maxRoles)
        : ['SUPER_ADMIN', 'LAB_DIRECTOR', 'LAB_TECH', 'CENTER_MANAGER'];

    const modules: SaasModuleKey[] =
      Array.isArray(body.enabledModules) && body.enabledModules.length > 0
        ? Array.from(new Set<SaasModuleKey>(['core_lims', ...body.enabledModules]))
        : ['core_lims', 'pos_billing', 'inventory_erp'];

    const tenant: SaasTenantLab = {
      id: `tnt-${Date.now()}`,
      code:
        body.code?.trim().toUpperCase() ||
        `TENANT-NP-${String(db.tenants.length + 1).padStart(3, '0')}`,
      name: body.name.trim(),
      nameNp: body.nameNp?.trim() || '',
      entityType: body.entityType || 'Main Lab',
      panNumber: body.panNumber.trim(),
      phone: body.phone.trim(),
      address: body.address.trim(),
      ownerEmail: body.ownerEmail?.trim() || 'admin@labtenant.com.np',
      planName: body.planName || 'Professional Lab',
      status: body.status || 'Active',
      maxRolesAllowed: maxRoles,
      allowedRoles: roles,
      enabledModules: modules,
      storageQuotaMb: Number(body.storageQuotaMb) || 15360,
      storageUsedMb: 42,
      controlReason: reasonStr,
      createdAt: new Date().toISOString(),
    };
    db.tenants.unshift(tenant);
    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'SAAS_TENANT_CREATED',
      tenant.code,
      `SaaS Admin provisioned '${tenant.name}' (${tenant.entityType}, PAN: ${tenant.panNumber}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.status(201).json({ tenant, db });
  });

  app.patch('/api/saas/tenants/:id', withAuth('saas.tenants.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const tenant = db.tenants.find((t) => t.id === req.params.id);
    if (!tenant) {
      res.status(404).json({ error: 'SaaS Lab Tenant not found.' });
      return;
    }
    const updates = req.body as Partial<SaasTenantLab> & { reason?: string };
    const reasonStr = (updates.controlReason || updates.reason || '').trim();
    if (!reasonStr) {
      res.status(400).json({ error: 'A mandatory Reason is required to modify SaaS Tenant status or policy.' });
      return;
    }
    if (updates.name !== undefined) tenant.name = updates.name.trim();
    if (updates.nameNp !== undefined) tenant.nameNp = updates.nameNp.trim();
    if (updates.entityType !== undefined) tenant.entityType = updates.entityType;
    if (updates.panNumber !== undefined) tenant.panNumber = updates.panNumber.trim();
    if (updates.phone !== undefined) tenant.phone = updates.phone.trim();
    if (updates.address !== undefined) tenant.address = updates.address.trim();
    if (updates.ownerEmail !== undefined) tenant.ownerEmail = updates.ownerEmail.trim();
    if (updates.planName !== undefined) tenant.planName = updates.planName;
    if (updates.status !== undefined) tenant.status = updates.status;
    if (updates.maxRolesAllowed !== undefined) {
      tenant.maxRolesAllowed = Math.max(1, Number(updates.maxRolesAllowed));
    }
    if (Array.isArray(updates.allowedRoles)) tenant.allowedRoles = updates.allowedRoles;
    if (Array.isArray(updates.enabledModules)) {
      tenant.enabledModules = Array.from(new Set<SaasModuleKey>(['core_lims', ...updates.enabledModules]));
    }
    if (updates.storageQuotaMb !== undefined) {
      tenant.storageQuotaMb = Math.max(1024, Number(updates.storageQuotaMb));
    }
    tenant.controlReason = reasonStr;
    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'SAAS_TENANT_UPDATED',
      tenant.code,
      `SaaS Admin updated '${tenant.name}' (PAN ${tenant.panNumber}, Status: ${tenant.status}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ tenant, db });
  });

  app.delete('/api/saas/tenants/:id', withAuth('saas.tenants.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const reasonStr = ((req.body as { reason?: string })?.reason || (req.query.reason as string) || '').trim();
    if (!reasonStr) {
      res.status(400).json({ error: 'A mandatory Reason is required to delete a SaaS Tenant.' });
      return;
    }
    const idx = db.tenants.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'SaaS Lab Tenant not found.' });
      return;
    }
    if (db.tenants[idx].code === db.saas.tenantId) {
      res.status(400).json({ error: 'Cannot delete the currently active primary platform tenant.' });
      return;
    }
    const [removed] = db.tenants.splice(idx, 1);
    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'SAAS_TENANT_DELETED',
      removed.code,
      `SaaS Admin deleted lab tenant '${removed.name}' (PAN: ${removed.panNumber}). Reason: ${reasonStr}`,
      'CRITICAL'
    );
    saveDb(db);
    res.json({ ok: true, db });
  });

  app.put('/api/saas/config', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const updates = req.body as Partial<SaasControlConfig> & { reason?: string };
    const reasonStr = (updates.reason || 'Admin configuration update').trim();
    if (updates.planName) db.saas.planName = updates.planName;
    if (updates.billingCycle) db.saas.billingCycle = updates.billingCycle;
    if (updates.basePlanPriceNpr !== undefined) db.saas.basePlanPriceNpr = Number(updates.basePlanPriceNpr);
    if (updates.storageQuotaMb !== undefined) db.saas.storageQuotaMb = Math.max(1024, Number(updates.storageQuotaMb));
    if (updates.maxStaffSeats !== undefined) db.saas.maxStaffSeats = Math.max(5, Number(updates.maxStaffSeats));
    if (updates.maxCollectionCenters !== undefined) {
      db.saas.maxCollectionCenters = Math.max(1, Number(updates.maxCollectionCenters));
    }
    if (updates.maxMonthlyOrders !== undefined) {
      db.saas.maxMonthlyOrders = Math.max(100, Number(updates.maxMonthlyOrders));
    }
    if (updates.maxRolesCapacity !== undefined) {
      db.saas.maxRolesCapacity = Math.max(1, Number(updates.maxRolesCapacity));
    }
    if (Array.isArray(updates.allowedRoleIds)) {
      db.saas.allowedRoleIds = updates.allowedRoleIds;
    }
    if (updates.tenantDomain) db.saas.tenantDomain = updates.tenantDomain;

    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'SAAS_PLAN_UPDATED',
      db.saas.tenantId,
      `Updated Hospital resource quotas (${Math.round(db.saas.storageQuotaMb / 1024)} GB quota, ${db.saas.maxStaffSeats} seats, ${db.saas.maxRolesCapacity} roles max). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db) });
  });

  app.post('/api/saas/compact-storage', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const reasonStr = ((req.body as { reason?: string })?.reason || 'Routine hospital storage optimization').trim();
    const beforeArchived = db.saas.archivedReportMediaMb;
    db.saas.archivedReportMediaMb = Number(Math.max(120, beforeArchived * 0.65).toFixed(2));
    if (db.apiDispatches.length > 15) {
      db.apiDispatches = db.apiDispatches.slice(0, 15);
    }
    if (db.emailNotifications.length > 20) {
      db.emailNotifications = db.emailNotifications.slice(0, 20);
    }
    const reclaimedMb = Number((beforeArchived - db.saas.archivedReportMediaMb).toFixed(2));
    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'STORAGE_COMPACTED',
      db.saas.tenantId,
      `Compacted PDF/media archive and pruned stale dispatch buffers (reclaimed ${reclaimedMb} MB). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db), reclaimedMb });
  });

  // Hospital Admin Direct Switch into any Staff / Branch Account
  app.post('/api/saas/impersonate', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || undefined;
    const actor = getActor(db, actorId);
    const impTokenHeader = req.header('x-saas-impersonation') || '';
    const mappedAdminId = impTokenHeader ? activeImpersonations.get(impTokenHeader) : undefined;
    const originActor = mappedAdminId ? db.staff.find((s) => s.id === mappedAdminId) : undefined;
    const authorizedAdmin =
      actor.roleId === 'SUPER_ADMIN'
        ? actor
        : originActor?.roleId === 'SUPER_ADMIN'
        ? originActor
        : null;

    if (!authorizedAdmin) {
      res.status(403).json({
        error: 'Only Hospital Admin (SUPER_ADMIN) can directly switch into staff or satellite clinic accounts.',
      });
      return;
    }

    const { targetUserId } = req.body as { targetUserId?: string };
    const target = db.staff.find((s) => s.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: 'Target account not found.' });
      return;
    }
    if (target.status === 'Suspended') {
      res.status(400).json({ error: `Account '@${target.username}' is Suspended.` });
      return;
    }

    const impersonationToken = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeImpersonations.set(impersonationToken, authorizedAdmin.id);

    appendAudit(
      db,
      authorizedAdmin,
      'SAAS_CONTROL',
      'ADMIN_DIRECT_SWITCH',
      target.username,
      `Hospital Admin directly entered @${target.username} (${target.fullName} · ${target.roleId}${target.assignedCenterName ? ` · ${target.assignedCenterName}` : ''}).`,
      'WARNING'
    );
    saveDb(db);

    res.json({
      activeUser: target,
      impersonationToken,
      saasAdminUser: authorizedAdmin,
      db: scopeDbForActor(db, target),
      telemetry: computeSaasTelemetry(db),
    });
  });

  app.post('/api/saas/exit-impersonation', (req: Request, res: Response) => {
    const db = getDb();
    const { impersonationToken } = (req.body || {}) as { impersonationToken?: string };
    const token = impersonationToken || req.header('x-saas-impersonation') || '';
    const adminId = token ? activeImpersonations.get(token) : undefined;
    if (!adminId) {
      res.status(401).json({ error: 'Session switch token is invalid or expired.' });
      return;
    }
    const adminUser = db.staff.find(
      (s) => s.id === adminId && s.roleId === 'SUPER_ADMIN'
    );
    if (!adminUser) {
      res.status(404).json({ error: 'Originating Hospital Admin account not found.' });
      return;
    }
    activeImpersonations.delete(token);
    appendAudit(
      db,
      adminUser,
      'SAAS_CONTROL',
      'ADMIN_EXIT_SWITCH',
      adminUser.username,
      `Returned from staff session back to Hospital Admin Console.`
    );
    saveDb(db);
    res.json({
      activeUser: adminUser,
      db: scopeDbForActor(db, adminUser),
      telemetry: computeSaasTelemetry(db),
    });
  });

  // Hospital Admin: Clear Dummy Transactional Data (Protected by Secret PIN or Admin Email Confirmation)
  app.post('/api/saas/clear-dummy-data', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      centerId = 'ALL',
      clearInventoryBatches = false,
      reason,
      confirmPin,
      confirmEmail,
    } = (req.body || {}) as {
      centerId?: 'ALL' | string;
      clearInventoryBatches?: boolean;
      reason?: string;
      confirmPin?: string;
      confirmEmail?: string;
    };

    const expectedPin = String(db.settings?.moduleSettings?.adminEraseSecretPin || '2082').trim();
    const expectedEmail = String(db.settings?.moduleSettings?.adminConfirmEmail || 'epusaan@gmail.com')
      .trim()
      .toLowerCase();
    const pinMatched = Boolean(confirmPin && confirmPin.trim() === expectedPin);
    const emailMatched = Boolean(confirmEmail && confirmEmail.trim().toLowerCase() === expectedEmail);

    if (!pinMatched && !emailMatched) {
      res.status(403).json({
        error: `Erase Confirmation Failed: Enter valid Admin Secret PIN or confirmed Admin Email (${expectedEmail}) before erasing dummy data.`,
        code: 'ERASE_CONFIRMATION_REQUIRED',
      });
      return;
    }

    const reasonStr = (reason || 'Admin operational reset').trim();
    const clearedOrders = db.orders.length;
    const clearedPharmacyInvoices = db.pharmacyInvoices.length;

    db.orders = [];
    db.patients = [];
    db.financialLedger = [];
    db.counterCloses = [];
    db.payrollRuns = [];
    db.riderTasks = [];
    db.centerAwards = [];
    db.emailNotifications = [];
    db.apiDispatches = [];
    db.whatsappLogs = [];
    db.securityAlerts = [];
    db.pharmacyInvoices = [];
    db.pharmacyMovements = [];
    db.inventoryMovements = [];
    db.storeRequisitions = [];
    db.opdVisits = [];
    db.ipdAdmissions = [];
    db.emergencyCases = [];
    db.gatepasses = [];
    db.attendanceLogs = [];
    db.shiftHandovers = [];
    db.marketingVisits = [];
    db.dartaChalani = [];
    db.birthCertificates = [];
    db.deathCertificates = [];
    db.dhis2Reports = [];
    db.referralPayoutRequests = [];
    db.hospitalBeds.forEach((b) => {
      b.status = 'Available';
      b.currentAdmissionId = null;
      b.currentPatientName = null;
    });
    db.referrals.forEach((r) => {
      r.totalReferredSales = 0;
      r.totalCommissionEarned = 0;
      r.totalCommissionPaid = 0;
    });
    if (clearInventoryBatches) {
      db.pharmacyBatches = [];
      db.reagents.forEach((rg) => {
        rg.currentStock = 0;
      });
    }
    db.saas.archivedReportMediaMb = 12;

    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'DUMMY_DATA_CLEARED',
      'ALL_HOSPITAL_DATA',
      `Hospital Admin cleared dummy transactional data (verified via ${pinMatched ? 'Secret PIN' : 'Admin Email'}). Cleared ${clearedOrders} orders, ${clearedPharmacyInvoices} pharmacy bills${clearInventoryBatches ? ', + inventory batches' : ''}. Reason: ${reasonStr}`,
      'CRITICAL'
    );
    saveDb(db);

    res.json({
      db: scopeDbForActor(db, actor),
      telemetry: computeSaasTelemetry(db),
      clearedSummary: {
        scope: 'Saptari Hospital Pvt Ltd',
        clearedOrders,
        clearedPharmacyInvoices,
        clearInventoryBatches,
      },
    });
  });

  // Hospital Admin: Selective Re-Seed System Data
  app.post('/api/saas/seed-center-data', withAuth('admin.control'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      includeTests = true,
      includeReports = true,
      includeRadiology = true,
      includePharmacy = true,
      includeReagents = true,
      includeHospital = true,
      reason,
    } = (req.body || {}) as {
      centerId?: string;
      includeTests?: boolean;
      includeReports?: boolean;
      includeRadiology?: boolean;
      includePharmacy?: boolean;
      includeReagents?: boolean;
      includeHospital?: boolean;
      reason?: string;
    };

    const reasonStr = (reason || '').trim();
    if (!reasonStr) {
      res.status(400).json({ error: 'A mandatory Reason is required to seed system data.' });
      return;
    }

    const templateSeed = createSeedDatabase();
    const now = Date.now();
    const stamp = String(now).slice(-5);
    const bsNow = adToBs(new Date(now));
    let addedTests = 0;
    let addedReports = 0;
    let addedRadiology = 0;
    let addedPharmacyBatches = 0;
    let addedReagents = 0;

    if (includeTests) {
      for (const srv of templateSeed.services) {
        if (!db.services.some((s) => s.code === srv.code)) {
          db.services.push(srv);
          addedTests += 1;
        }
      }
      for (const tpl of templateSeed.radiologyTemplates) {
        if (!db.radiologyTemplates.some((t) => t.code === tpl.code)) {
          db.radiologyTemplates.push(tpl);
        }
      }
    }

    if (includeReagents) {
      for (const rg of templateSeed.reagents) {
        const existing = db.reagents.find((r) => r.sku === rg.sku);
        if (!existing) {
          db.reagents.push(rg);
          addedReagents += 1;
        } else if (existing.currentStock <= 0) {
          existing.currentStock = rg.currentStock;
          addedReagents += 1;
        }
      }
    }

    if (includeReports) {
      const validatedSeedOrder =
        templateSeed.orders.find((o) => o.tests.some((t) => t.serviceCategory !== 'RADIOLOGY') && o.status === 'Validated') ||
        templateSeed.orders[0];
      if (validatedSeedOrder) {
        const cloned: LabOrder = {
          ...JSON.parse(JSON.stringify(validatedSeedOrder)),
          id: `ord-seed-${now}`,
          accessionNumber: `SAP-${bsNow.year}-S${stamp}`,
          invoiceNumber: `BILL-${bsNow.year}-S${stamp}`,
          fiscalYear: db.settings.activeFiscalYear,
          collectionCenterId: null,
          collectionCenterName: 'Saptari Hospital Pvt Ltd',
          orderedAt: new Date(now - 90 * 60000).toISOString(),
          validatedAt: new Date(now - 10 * 60000).toISOString(),
        };
        db.orders.unshift(cloned);
        addedReports += 1;
      }
    }

    if (includeRadiology) {
      const radSeedOrder =
        templateSeed.orders.find((o) => o.tests.some((t) => t.serviceCategory === 'RADIOLOGY')) ||
        templateSeed.orders[0];
      if (radSeedOrder) {
        const cloned: LabOrder = {
          ...JSON.parse(JSON.stringify(radSeedOrder)),
          id: `ord-rad-seed-${now}`,
          accessionNumber: `SAP-${bsNow.year}-${stamp}R`,
          invoiceNumber: `BILL-${bsNow.year}-${stamp}R`,
          fiscalYear: db.settings.activeFiscalYear,
          collectionCenterId: null,
          collectionCenterName: 'Saptari Hospital Pvt Ltd',
          orderedAt: new Date(now - 60 * 60000).toISOString(),
          validatedAt: new Date(now - 5 * 60000).toISOString(),
        };
        db.orders.unshift(cloned);
        addedRadiology += 1;
      }
    }

    if (includePharmacy) {
      for (const med of templateSeed.pharmacyMedicines) {
        if (!db.pharmacyMedicines.some((m) => m.code === med.code)) {
          db.pharmacyMedicines.push(med);
        }
      }
      const expSoon = new Date(now + 42 * 86400000).toISOString().slice(0, 10);
      const expLater = new Date(now + 240 * 86400000).toISOString().slice(0, 10);
      templateSeed.pharmacyBatches.slice(0, 4).forEach((b, bIdx) => {
        const batch: PharmacyBatch = {
          ...b,
          id: `pbat-seed-${now}-${bIdx}`,
          centerId: null,
          centerName: 'Saptari Hospital Central Pharmacy',
          batchNumber: `${b.batchNumber}-S${bIdx}`,
          expiryDate: bIdx === 0 ? expSoon : expLater,
          quantityReceived: 100,
          quantityOnHand: 100,
          grnNumber: `GRN-SEED-${stamp}`,
          receivedAt: new Date(now).toISOString(),
          quarantined: false,
        };
        db.pharmacyBatches.push(batch);
        addedPharmacyBatches += 1;
      });
    }

    if (includeHospital && (!db.hospitalBeds || db.hospitalBeds.length === 0)) {
      templateSeed.hospitalBeds.forEach((b) => db.hospitalBeds.push(b));
    }

    appendAudit(
      db,
      actor,
      'SAAS_CONTROL',
      'SAAS_SYSTEM_DATA_SEEDED',
      'SAPTARI_HOSP',
      `Admin seeded fresh Hospital data (Tests:${addedTests}, Reports:${addedReports}, Radiology:${addedRadiology}, PharmacyBatches:${addedPharmacyBatches}, Reagents:${addedReagents}). Reason: ${reasonStr}`
    );
    saveDb(db);

    res.status(201).json({
      db: scopeDbForActor(db, actor),
      telemetry: computeSaasTelemetry(db),
      seededSummary: {
        scope: 'Saptari Hospital Pvt Ltd',
        addedTests,
        addedReports,
        addedRadiology,
        addedPharmacyBatches,
        addedReagents,
      },
    });
  });

  // Pharmacy ERP & Strict FEFO Inventory / Dispense Engine
  app.post('/api/pharmacy/medicines', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<PharmacyMedicine>;
    if (!body.code?.trim() || !body.brandName?.trim() || !body.genericName?.trim()) {
      res.status(400).json({ error: 'Medicine code, brand name, and generic name are required.' });
      return;
    }

    const inrMrp = body.inrMrp !== undefined && Number(body.inrMrp) > 0 ? Number(Number(body.inrMrp).toFixed(2)) : undefined;
    const computedNprMrp = inrMrp ? Number((inrMrp * 1.6).toFixed(2)) : undefined;
    const defaultMrpNpr =
      body.defaultMrpNpr !== undefined && Number(body.defaultMrpNpr) > 0
        ? Number(Number(body.defaultMrpNpr).toFixed(2))
        : computedNprMrp || 10;
    const defaultPurchaseRateNpr =
      body.defaultPurchaseRateNpr !== undefined && Number(body.defaultPurchaseRateNpr) > 0
        ? Number(Number(body.defaultPurchaseRateNpr).toFixed(2))
        : Number((defaultMrpNpr / 1.16).toFixed(2));

    const existingIdx = body.id ? db.pharmacyMedicines.findIndex((m) => m.id === body.id) : -1;
    const saved: PharmacyMedicine = {
      id: existingIdx >= 0 ? db.pharmacyMedicines[existingIdx].id : `med-${Date.now()}`,
      code: body.code.trim().toUpperCase(),
      brandName: body.brandName.trim(),
      genericName: body.genericName.trim(),
      dosageForm: body.dosageForm || 'Tablet',
      strength: body.strength?.trim() || '500mg',
      manufacturer: body.manufacturer?.trim() || 'Deurali-Janta Pharma (Nepal)',
      category: body.category?.trim() || 'General',
      scheduleType: body.scheduleType || 'OTC',
      rackLocation: body.rackLocation?.trim() || 'A-01',
      unitLabel: body.unitLabel?.trim() || 'Tabs',
      vatApplicable: Boolean(body.vatApplicable),
      reorderLevel: Math.max(0, Number(body.reorderLevel) || 50),
      defaultMrpNpr,
      inrMrp,
      defaultPurchaseRateNpr,
      active: body.active ?? true,
    };

    if (existingIdx >= 0) {
      db.pharmacyMedicines[existingIdx] = saved;
    } else {
      db.pharmacyMedicines.unshift(saved);
    }

    appendAudit(
      db,
      actor,
      'PHARMACY',
      existingIdx >= 0 ? 'MEDICINE_UPDATED' : 'MEDICINE_CREATED',
      saved.code,
      `${existingIdx >= 0 ? 'Updated' : 'Added'} medicine ${saved.brandName} (${saved.genericName} ${saved.strength}) at Rack ${saved.rackLocation}.`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ medicine: saved, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/pharmacy/batches', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<PharmacyBatch> & {
      postPurchaseOutflow?: boolean;
      accountId?: string;
      supplierId?: string;
      paymentStatus?: 'PAID' | 'CREDIT';
    };
    const med = db.pharmacyMedicines.find((m) => m.id === body.medicineId);
    if (!med) {
      res.status(404).json({ error: 'Selected medicine not found in Pharmacy Master.' });
      return;
    }
    if (!body.batchNumber?.trim() || !body.expiryDate?.trim()) {
      res.status(400).json({ error: 'Batch number and Expiry Date (YYYY-MM-DD) are required for FEFO.' });
      return;
    }
    const qty = Number(body.quantityReceived);
    if (!qty || qty <= 0) {
      res.status(400).json({ error: 'Positive GRN quantity is required.' });
      return;
    }

    // Single Central Hospital Pharmacy: all batches reside on Central Pharmacy (centerId: null)
    const effectiveCenterId: string | null = null;
    const nowIso = new Date().toISOString();
    const grnNumber = body.grnNumber?.trim() || `GRN-${Date.now().toString().slice(-6)}`;
    const inrMrp = body.inrMrp && Number(body.inrMrp) > 0 ? Number(Number(body.inrMrp).toFixed(2)) : undefined;
    const mrpNpr =
      body.mrpNpr && Number(body.mrpNpr) > 0
        ? Number(Number(body.mrpNpr).toFixed(2))
        : inrMrp
        ? Number((inrMrp * 1.6).toFixed(2))
        : med.defaultMrpNpr;
    const purchaseRateNpr =
      body.purchaseRateNpr && Number(body.purchaseRateNpr) > 0
        ? Number(Number(body.purchaseRateNpr).toFixed(2))
        : Number((mrpNpr / 1.16).toFixed(2));

    const matchedSupplier =
      (body.supplierId
        ? (db.pharmacySuppliers || []).find((s) => s.id === body.supplierId)
        : undefined) ||
      (body.supplierName
        ? (db.pharmacySuppliers || []).find(
            (s) => s.name.toLowerCase() === body.supplierName!.trim().toLowerCase()
          )
        : undefined);

    const created: PharmacyBatch = {
      id: `pbat-${Date.now()}`,
      medicineId: med.id,
      centerId: effectiveCenterId,
      centerName: 'Saptari Hospital Central Pharmacy',
      batchNumber: body.batchNumber.trim().toUpperCase(),
      mfgDate: body.mfgDate?.trim() || nowIso.slice(0, 10),
      expiryDate: body.expiryDate.trim(),
      quantityReceived: qty,
      quantityOnHand: qty,
      purchaseRateNpr,
      mrpNpr,
      inrMrp,
      isOpeningStock: Boolean(body.isOpeningStock),
      supplierName: matchedSupplier?.name || body.supplierName?.trim() || 'Janakpur Drug Distributors',
      grnNumber,
      receivedAt: nowIso,
      quarantined: false,
    };

    db.pharmacyBatches.push(created);
    const totalCostNpr = Number((qty * created.purchaseRateNpr).toFixed(2));
    const move: PharmacyMovement = {
      id: `pmov-${Date.now()}`,
      timestamp: nowIso,
      medicineId: med.id,
      medicineName: med.brandName,
      batchId: created.id,
      batchNumber: created.batchNumber,
      expiryDate: created.expiryDate,
      centerId: created.centerId,
      type: body.isOpeningStock ? 'OPENING_STOCK' : 'GRN_IN',
      quantityDelta: qty,
      balanceAfter: qty,
      referenceId: grnNumber,
      performedBy: actor.fullName,
      notes: body.isOpeningStock
        ? `Opening Stock entry (${created.batchNumber})`
        : `GRN intake from ${created.supplierName} (${body.paymentStatus === 'CREDIT' ? 'Credit Party Due' : 'Cash/Bank'})`,
    };
    db.pharmacyMovements.unshift(move);

    if (!body.isOpeningStock && body.paymentStatus === 'CREDIT' && matchedSupplier) {
      matchedSupplier.currentDueNpr = Number(((matchedSupplier.currentDueNpr || 0) + totalCostNpr).toFixed(2));
      matchedSupplier.updatedAt = nowIso;
    } else if (body.postPurchaseOutflow && !body.isOpeningStock) {
      const acc =
        (body.accountId && db.accounts.find((a) => a.id === body.accountId)) ||
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'BANK') ||
        db.accounts.find((a) => a.departmentScope === 'PHARMACY') ||
        db.accounts.find((a) => a.type === 'BANK') ||
        db.accounts[0];
      if (acc) {
        postLedgerMovement(
          db,
          acc,
          'OUTFLOW',
          totalCostNpr,
          'PHARMACY_PURCHASE',
          grnNumber,
          `Pharmacy GRN purchase ${med.brandName} Batch ${created.batchNumber}`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }

    appendAudit(
      db,
      actor,
      'PHARMACY',
      body.isOpeningStock ? 'PHARMACY_OPENING_STOCK_ADDED' : 'PHARMACY_GRN_BATCH_ADDED',
      created.batchNumber,
      `Received ${qty} ${med.unitLabel} of ${med.brandName} (Batch ${created.batchNumber}, Exp ${created.expiryDate}, MRP रू ${mrpNpr}, Buy रू ${purchaseRateNpr}) from ${created.supplierName}.`
    );
    saveDb(db);
    res.status(201).json({ batch: created, db: scopeDbForActor(db, actor) });
  });

  // Pharmacy Suppliers CRUD & Credit Due Settlement
  app.post('/api/pharmacy/suppliers', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<PharmacySupplier>;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Supplier / Party name is required.' });
      return;
    }
    if (!Array.isArray(db.pharmacySuppliers)) db.pharmacySuppliers = [];
    const existingIdx = body.id ? db.pharmacySuppliers.findIndex((s) => s.id === body.id) : -1;
    const nowIso = new Date().toISOString();
    const openingDue = Math.max(0, Number(body.openingDueNpr) || 0);
    const saved: PharmacySupplier = {
      id: existingIdx >= 0 ? db.pharmacySuppliers[existingIdx].id : `psup-${Date.now()}`,
      code:
        body.code?.trim().toUpperCase() ||
        `SUP-${String(db.pharmacySuppliers.length + 1).padStart(3, '0')}`,
      name: body.name.trim(),
      contactPerson: body.contactPerson?.trim() || '',
      phone: normalizeNepalPhone(body.phone),
      address: body.address?.trim() || '',
      panVat: body.panVat?.trim() || '',
      paymentTerms: body.paymentTerms || 'Credit 30 Days',
      creditDays: Math.max(0, Number(body.creditDays ?? 30)),
      openingDueNpr: openingDue,
      currentDueNpr:
        body.currentDueNpr !== undefined
          ? Math.max(0, Number(body.currentDueNpr) || 0)
          : existingIdx >= 0
          ? db.pharmacySuppliers[existingIdx].currentDueNpr
          : openingDue,
      notes: body.notes?.trim() || '',
      active: body.active ?? true,
      createdAt: existingIdx >= 0 ? db.pharmacySuppliers[existingIdx].createdAt : nowIso,
      updatedAt: nowIso,
    };
    if (existingIdx >= 0) db.pharmacySuppliers[existingIdx] = saved;
    else db.pharmacySuppliers.unshift(saved);

    appendAudit(
      db,
      actor,
      'PHARMACY',
      existingIdx >= 0 ? 'SUPPLIER_UPDATED' : 'SUPPLIER_CREATED',
      saved.code,
      `${existingIdx >= 0 ? 'Updated' : 'Added'} pharmacy supplier ${saved.name} (${saved.paymentTerms}, Due रू ${saved.currentDueNpr.toLocaleString()}).`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ supplier: saved, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/pharmacy/suppliers/:id', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.pharmacySuppliers)) db.pharmacySuppliers = [];
    const idx = db.pharmacySuppliers.findIndex((s) => s.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Supplier not found.' });
      return;
    }
    const [removed] = db.pharmacySuppliers.splice(idx, 1);
    appendAudit(db, actor, 'PHARMACY', 'SUPPLIER_DELETED', removed.code, `Deleted supplier ${removed.name}.`, 'WARNING');
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/pharmacy/suppliers/:id/pay', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const supplier = (db.pharmacySuppliers || []).find((s) => s.id === req.params.id);
    if (!supplier) {
      res.status(404).json({ error: 'Supplier not found.' });
      return;
    }
    const { amountNpr, accountId, referenceNo, notes } = (req.body || {}) as {
      amountNpr: number;
      accountId?: string;
      referenceNo?: string;
      notes?: string;
    };
    const amt = Math.max(0, Number(amountNpr) || 0);
    if (amt <= 0) {
      res.status(400).json({ error: 'Positive payment amount (रू) is required.' });
      return;
    }
    const acc =
      (accountId && db.accounts.find((a) => a.id === accountId)) ||
      db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'BANK') ||
      db.accounts.find((a) => a.departmentScope === 'PHARMACY') ||
      db.accounts[0];
    if (!acc) {
      res.status(400).json({ error: 'No cash/bank account found to post payment.' });
      return;
    }
    supplier.currentDueNpr = Number(Math.max(0, (supplier.currentDueNpr || 0) - amt).toFixed(2));
    supplier.updatedAt = new Date().toISOString();
    const ref = referenceNo?.trim() || `SUP-PAY-${Date.now().toString().slice(-5)}`;
    postLedgerMovement(
      db,
      acc,
      'OUTFLOW',
      amt,
      'SUPPLIER_PAYMENT',
      ref,
      notes?.trim() || `Pharmacy Supplier Payment to ${supplier.name}`,
      db.settings.activeFiscalYear,
      actor
    );
    appendAudit(
      db,
      actor,
      'PHARMACY',
      'SUPPLIER_DUE_PAID',
      ref,
      `Paid रू ${amt.toLocaleString()} to supplier ${supplier.name}. Remaining due: रू ${supplier.currentDueNpr.toLocaleString()}.`
    );
    saveDb(db);
    res.json({ supplier, db: scopeDbForActor(db, actor) });
  });

  // Pharmacy Manufacturers / Companies CRUD
  app.post('/api/pharmacy/manufacturers', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<PharmacyManufacturer>;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Company / Manufacturer name is required.' });
      return;
    }
    if (!Array.isArray(db.pharmacyManufacturers)) db.pharmacyManufacturers = [];
    const existingIdx = body.id ? db.pharmacyManufacturers.findIndex((m) => m.id === body.id) : -1;
    const nowIso = new Date().toISOString();
    const saved: PharmacyManufacturer = {
      id: existingIdx >= 0 ? db.pharmacyManufacturers[existingIdx].id : `pmfg-${Date.now()}`,
      code:
        body.code?.trim().toUpperCase() ||
        `MFG-${String(db.pharmacyManufacturers.length + 1).padStart(3, '0')}`,
      name: body.name.trim(),
      country: body.country?.trim() || 'Nepal',
      contactPhone: normalizeNepalPhone(body.contactPhone),
      address: body.address?.trim() || '',
      active: body.active ?? true,
      createdAt: existingIdx >= 0 ? db.pharmacyManufacturers[existingIdx].createdAt : nowIso,
    };
    if (existingIdx >= 0) db.pharmacyManufacturers[existingIdx] = saved;
    else db.pharmacyManufacturers.unshift(saved);

    appendAudit(
      db,
      actor,
      'PHARMACY',
      existingIdx >= 0 ? 'MANUFACTURER_UPDATED' : 'MANUFACTURER_CREATED',
      saved.code,
      `${existingIdx >= 0 ? 'Updated' : 'Added'} pharma manufacturer ${saved.name}.`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ manufacturer: saved, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/pharmacy/manufacturers/:id', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.pharmacyManufacturers)) db.pharmacyManufacturers = [];
    const idx = db.pharmacyManufacturers.findIndex((m) => m.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Manufacturer not found.' });
      return;
    }
    const [removed] = db.pharmacyManufacturers.splice(idx, 1);
    appendAudit(db, actor, 'PHARMACY', 'MANUFACTURER_DELETED', removed.code, `Deleted manufacturer ${removed.name}.`, 'WARNING');
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  // Pharmacy Opening Stock Entry with INR -> NPR (x1.6) & Wholesale Buy Rate Calculator (MRP / 1.16)
  app.post('/api/pharmacy/opening-stock', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      medicineId,
      newMedicine,
      batchNumber,
      mfgDate,
      expiryDate,
      quantity,
      inrMrp,
      mrpNpr,
      buyFormula = 'MRP_DIV_116',
      purchaseRateNpr,
      supplierName,
      notes,
    } = req.body as {
      medicineId?: string;
      newMedicine?: Partial<PharmacyMedicine>;
      batchNumber: string;
      mfgDate?: string;
      expiryDate: string;
      quantity: number;
      inrMrp?: number;
      mrpNpr?: number;
      buyFormula?: 'MRP_DIV_116' | 'MRP_DIV_120' | 'MRP_MUL_084' | 'CUSTOM';
      purchaseRateNpr?: number;
      supplierName?: string;
      notes?: string;
    };

    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0 || !batchNumber?.trim() || !expiryDate?.trim()) {
      res.status(400).json({ error: 'Positive opening stock quantity, batch number, and expiry date are required.' });
      return;
    }

    const parsedInrMrp = inrMrp && Number(inrMrp) > 0 ? Number(Number(inrMrp).toFixed(2)) : undefined;
    const resolvedMrpNpr =
      parsedInrMrp && (!mrpNpr || Number(mrpNpr) <= 0)
        ? Number((parsedInrMrp * 1.6).toFixed(2))
        : Number(Number(mrpNpr || 0).toFixed(2));

    let med = medicineId ? db.pharmacyMedicines.find((m) => m.id === medicineId) : undefined;
    const nowIso = new Date().toISOString();

    if (!med) {
      if (!newMedicine?.code?.trim() || !newMedicine?.brandName?.trim() || !newMedicine?.genericName?.trim()) {
        res.status(404).json({ error: 'Select an existing medicine or provide code, brand name, and generic name.' });
        return;
      }
      const fallbackMrp = resolvedMrpNpr > 0 ? resolvedMrpNpr : Math.max(1, Number(newMedicine.defaultMrpNpr) || 10);
      const createdMed: PharmacyMedicine = {
        id: `med-${Date.now()}`,
        code: newMedicine.code.trim().toUpperCase(),
        brandName: newMedicine.brandName.trim(),
        genericName: newMedicine.genericName.trim(),
        dosageForm: newMedicine.dosageForm || 'Tablet',
        strength: newMedicine.strength?.trim() || '500mg',
        manufacturer: newMedicine.manufacturer?.trim() || 'Deurali-Janta Pharma (Nepal)',
        category: newMedicine.category?.trim() || 'General',
        scheduleType: newMedicine.scheduleType || 'OTC',
        rackLocation: newMedicine.rackLocation?.trim() || 'A-01',
        unitLabel: newMedicine.unitLabel?.trim() || 'Tabs',
        vatApplicable: Boolean(newMedicine.vatApplicable),
        reorderLevel: Math.max(0, Number(newMedicine.reorderLevel) || 50),
        defaultMrpNpr: fallbackMrp,
        inrMrp: parsedInrMrp,
        defaultPurchaseRateNpr: Number((fallbackMrp / 1.16).toFixed(2)),
        active: true,
      };
      db.pharmacyMedicines.unshift(createdMed);
      med = createdMed;
    }

    const finalMrpNpr = resolvedMrpNpr > 0 ? resolvedMrpNpr : med.defaultMrpNpr;
    let finalBuyRateNpr: number;
    if (buyFormula === 'CUSTOM' && purchaseRateNpr && Number(purchaseRateNpr) > 0) {
      finalBuyRateNpr = Number(Number(purchaseRateNpr).toFixed(2));
    } else if (buyFormula === 'MRP_DIV_120') {
      finalBuyRateNpr = Number((finalMrpNpr / 1.2).toFixed(2));
    } else if (buyFormula === 'MRP_MUL_084') {
      finalBuyRateNpr = Number((finalMrpNpr * 0.84).toFixed(2));
    } else {
      finalBuyRateNpr = Number((finalMrpNpr / 1.16).toFixed(2));
    }

    // Update master defaults so POS/non-inventory picks up latest NPR MRP
    med.defaultMrpNpr = finalMrpNpr;
    if (parsedInrMrp) med.inrMrp = parsedInrMrp;
    med.defaultPurchaseRateNpr = finalBuyRateNpr;

    const createdBatch: PharmacyBatch = {
      id: `pbat-op-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      medicineId: med.id,
      centerId: null,
      centerName: 'Saptari Hospital Central Pharmacy',
      batchNumber: batchNumber.trim().toUpperCase(),
      mfgDate: mfgDate?.trim() || nowIso.slice(0, 10),
      expiryDate: expiryDate.trim(),
      quantityReceived: qty,
      quantityOnHand: qty,
      purchaseRateNpr: finalBuyRateNpr,
      mrpNpr: finalMrpNpr,
      inrMrp: parsedInrMrp,
      isOpeningStock: true,
      supplierName: supplierName?.trim() || 'Opening Stock Carryforward',
      grnNumber: 'OPENING-STOCK',
      receivedAt: nowIso,
      quarantined: false,
    };
    db.pharmacyBatches.push(createdBatch);

    const movement: PharmacyMovement = {
      id: `pmov-op-${Date.now()}`,
      timestamp: nowIso,
      medicineId: med.id,
      medicineName: med.brandName,
      batchId: createdBatch.id,
      batchNumber: createdBatch.batchNumber,
      expiryDate: createdBatch.expiryDate,
      centerId: null,
      type: 'OPENING_STOCK',
      quantityDelta: qty,
      balanceAfter: qty,
      referenceId: 'OPENING-STOCK',
      performedBy: actor.fullName,
      notes:
        notes?.trim() ||
        `Opening Stock (${qty} ${med.unitLabel}) · ${parsedInrMrp ? `INR ${parsedInrMrp} × 1.6 = ` : ''}MRP रू ${finalMrpNpr} · Wholesale Buy रू ${finalBuyRateNpr} (${buyFormula})`,
    };
    db.pharmacyMovements.unshift(movement);

    appendAudit(
      db,
      actor,
      'PHARMACY',
      'PHARMACY_OPENING_STOCK_ADDED',
      createdBatch.batchNumber,
      `Opening stock ${qty} ${med.unitLabel} for ${med.brandName}: MRP रू ${finalMrpNpr}${parsedInrMrp ? ` (from INR ${parsedInrMrp})` : ''}, Buy रू ${finalBuyRateNpr}.`
    );
    saveDb(db);
    res.status(201).json({ medicine: med, batch: createdBatch, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/pharmacy/batches/:id/write-off', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const batch = db.pharmacyBatches.find((b) => b.id === req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Pharmacy batch not found.' });
      return;
    }
    const { reason } = (req.body || {}) as { reason?: string };
    const med = db.pharmacyMedicines.find((m) => m.id === batch.medicineId);
    const writtenOffQty = batch.quantityOnHand;
    batch.quarantined = true;
    batch.quantityOnHand = 0;

    db.pharmacyMovements.unshift({
      id: `pmov-${Date.now()}`,
      timestamp: new Date().toISOString(),
      medicineId: batch.medicineId,
      medicineName: med?.brandName || batch.medicineId,
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      centerId: batch.centerId,
      type: 'EXPIRED_WRITEOFF',
      quantityDelta: -writtenOffQty,
      balanceAfter: 0,
      referenceId: `WO-${batch.batchNumber}`,
      performedBy: actor.fullName,
      notes: reason?.trim() || `Quarantined & written off expired/damaged batch ${batch.batchNumber}`,
    });

    appendAudit(
      db,
      actor,
      'PHARMACY',
      'PHARMACY_BATCH_QUARANTINED',
      batch.batchNumber,
      `Quarantined & wrote off ${writtenOffQty} units from Batch ${batch.batchNumber} (Exp ${batch.expiryDate}).`,
      'WARNING'
    );
    saveDb(db);
    res.json({ batch, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/pharmacy/batches/:id/clearance', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const batch = db.pharmacyBatches.find((b) => b.id === req.params.id);
    if (!batch) {
      res.status(404).json({ error: 'Pharmacy batch not found.' });
      return;
    }
    const { action, discountPercent, quantity, notes } = (req.body || {}) as {
      action: 'RETURN_SUPPLIER' | 'DISCOUNT_SALE' | 'WRITE_OFF';
      discountPercent?: number;
      quantity?: number;
      notes?: string;
    };
    const med = db.pharmacyMedicines.find((m) => m.id === batch.medicineId);
    const nowIso = new Date().toISOString();

    if (action === 'DISCOUNT_SALE') {
      const pct = Math.max(1, Math.min(90, Number(discountPercent) || 25));
      const prevMrp = batch.mrpNpr;
      batch.mrpNpr = Number(Math.max(1, prevMrp * (1 - pct / 100)).toFixed(2));
      db.pharmacyMovements.unshift({
        id: `pmov-${Date.now()}`,
        timestamp: nowIso,
        medicineId: batch.medicineId,
        medicineName: med?.brandName || batch.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        centerId: batch.centerId,
        type: 'RETURN_ADJUST',
        quantityDelta: 0,
        balanceAfter: batch.quantityOnHand,
        referenceId: `DISC-${pct}%`,
        performedBy: actor.fullName,
        notes: notes?.trim() || `Near-expiry clearance discount ${pct}% (MRP रू ${prevMrp} -> रू ${batch.mrpNpr})`,
      });
      appendAudit(
        db,
        actor,
        'PHARMACY',
        'NEAR_EXPIRY_DISCOUNT_SET',
        batch.batchNumber,
        `Applied ${pct}% near-expiry discount to ${med?.brandName || batch.medicineId} Batch ${batch.batchNumber} (MRP रू ${prevMrp} -> रू ${batch.mrpNpr}).`,
        'INFO'
      );
    } else if (action === 'RETURN_SUPPLIER') {
      const retQty = Math.min(batch.quantityOnHand, Math.max(1, Number(quantity) || batch.quantityOnHand));
      batch.quantityOnHand = Math.max(0, batch.quantityOnHand - retQty);
      if (batch.quantityOnHand === 0) batch.quarantined = true;
      db.pharmacyMovements.unshift({
        id: `pmov-${Date.now()}`,
        timestamp: nowIso,
        medicineId: batch.medicineId,
        medicineName: med?.brandName || batch.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        centerId: batch.centerId,
        type: 'RETURN_ADJUST',
        quantityDelta: -retQty,
        balanceAfter: batch.quantityOnHand,
        referenceId: `RET-${batch.batchNumber}`,
        performedBy: actor.fullName,
        notes: notes?.trim() || `Returned ${retQty} units to ${batch.supplierName} for expiry credit note`,
      });
      appendAudit(
        db,
        actor,
        'PHARMACY',
        'NEAR_EXPIRY_RETURN_SUPPLIER',
        batch.batchNumber,
        `Returned ${retQty} units of ${med?.brandName || batch.medicineId} Batch ${batch.batchNumber} (Exp ${batch.expiryDate}) to ${batch.supplierName}.`,
        'WARNING'
      );
    } else {
      const woQty = Math.min(batch.quantityOnHand, Math.max(1, Number(quantity) || batch.quantityOnHand));
      batch.quantityOnHand = Math.max(0, batch.quantityOnHand - woQty);
      if (batch.quantityOnHand === 0) batch.quarantined = true;
      db.pharmacyMovements.unshift({
        id: `pmov-${Date.now()}`,
        timestamp: nowIso,
        medicineId: batch.medicineId,
        medicineName: med?.brandName || batch.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        centerId: batch.centerId,
        type: 'EXPIRED_WRITEOFF',
        quantityDelta: -woQty,
        balanceAfter: batch.quantityOnHand,
        referenceId: `WO-${batch.batchNumber}`,
        performedBy: actor.fullName,
        notes: notes?.trim() || `Written off near-expiry/expired batch ${batch.batchNumber}`,
      });
      appendAudit(
        db,
        actor,
        'PHARMACY',
        'NEAR_EXPIRY_WRITEOFF',
        batch.batchNumber,
        `Written off ${woQty} units of Batch ${batch.batchNumber} (Exp ${batch.expiryDate}).`,
        'WARNING'
      );
    }

    saveDb(db);
    res.json({ batch, db: scopeDbForActor(db, actor) });
  });

  // Fetch All Nepalese Pharma Companies, DDA-style Medicines & Hospital Inside Formulary
  app.post('/api/pharmacy/fetch-nepal-catalog', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { withOpeningStock = true } = (req.body || {}) as { withOpeningStock?: boolean };
    const existingKeys = new Set(
      db.pharmacyMedicines.map((m) => `${m.code.toLowerCase()}|${m.brandName.toLowerCase()}`)
    );
    const existingBrands = new Set(db.pharmacyMedicines.map((m) => m.brandName.toLowerCase()));
    const nowIso = new Date().toISOString();
    const expFuture = new Date(Date.now() + 540 * 86400 * 1000).toISOString().slice(0, 10);
    let addedMedicines = 0;
    let addedBatches = 0;

    for (const item of NEPAL_PHARMACY_CATALOG) {
      const key = `${item.code.toLowerCase()}|${item.brandName.toLowerCase()}`;
      if (existingKeys.has(key) || existingBrands.has(item.brandName.toLowerCase())) continue;

      const medId = `med-np-${item.code.toLowerCase()}`;
      db.pharmacyMedicines.push({
        id: medId,
        code: item.code,
        brandName: item.brandName,
        genericName: item.genericName,
        dosageForm: item.dosageForm,
        strength: item.strength,
        manufacturer: item.manufacturer,
        category: item.dosageForm === 'IV Fluid' ? 'IV Fluid' : item.dosageForm === 'Consumable' ? 'Surgical / Inside Consumable' : 'General / Nepal Formulary',
        scheduleType: item.dosageForm === 'Consumable' || item.dosageForm === 'IV Fluid' ? 'OTC' : 'Schedule H (Rx)',
        rackLocation: item.rackLocation,
        unitLabel: item.unitLabel,
        vatApplicable: item.vatApplicable,
        reorderLevel: item.reorderLevel,
        defaultMrpNpr: item.defaultMrpNpr,
        active: true,
      });
      addedMedicines += 1;

      if (withOpeningStock && item.initialBatchQty > 0) {
        const batchId = `pbat-np-${item.code.toLowerCase()}`;
        db.pharmacyBatches.push({
          id: batchId,
          medicineId: medId,
          centerId: null,
          centerName: 'Main Pharmacy Store',
          batchNumber: `NP-${item.code.replace(/[^A-Z0-9]/gi, '').slice(-5)}`,
          mfgDate: nowIso.slice(0, 10),
          expiryDate: expFuture,
          quantityReceived: item.initialBatchQty,
          quantityOnHand: item.initialBatchQty,
          purchaseRateNpr: item.purchaseRateNpr,
          mrpNpr: item.defaultMrpNpr,
          supplierName: item.manufacturer,
          grnNumber: 'GRN-NEPAL-CATALOG',
          receivedAt: nowIso,
        });
        addedBatches += 1;
      }
    }

    appendAudit(
      db,
      actor,
      'PHARMACY',
      'NEPAL_PHARMA_CATALOG_FETCHED',
      'NEPAL-DDA-CATALOG',
      `Fetched ${addedMedicines} Nepalese pharma & hospital inside formulary medicines (${addedBatches} batches) across ${NEPAL_PHARMA_COMPANIES.length} companies.`
    );
    saveDb(db);
    res.status(201).json({
      addedMedicines,
      addedBatches,
      totalMedicines: db.pharmacyMedicines.length,
      companiesCount: NEPAL_PHARMA_COMPANIES.length,
      companies: NEPAL_PHARMA_COMPANIES,
      db: scopeDbForActor(db, actor),
    });
  });

  // Fetch All Nepal Hospital Services (Conventional X-Ray, DR X-Ray, USG, Doppler, ECG, Procedures)
  app.post('/api/services/fetch-hospital-catalog', withAuth('services.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const existingCodes = new Set(db.services.map((s) => s.code.toUpperCase()));
    let addedServices = 0;

    for (const srv of NEPAL_HOSPITAL_SERVICES_CATALOG) {
      if (existingCodes.has(srv.code.toUpperCase())) continue;
      db.services.push({
        id: `srv-np-${srv.code.toLowerCase()}`,
        code: srv.code,
        name: srv.name,
        serviceCategory: srv.serviceCategory,
        customCategory: srv.customCategory,
        modality: srv.modality,
        allowCustomRateAtBilling: true,
        department: srv.department,
        specimenType: srv.specimenType,
        containerType: srv.containerType,
        methodology: srv.methodology,
        tatMinutes: srv.tatMinutes,
        price: srv.price,
        active: true,
        parameters: [
          {
            id: `p-${srv.code.toLowerCase()}-1`,
            name: `${srv.name} Findings`,
            resultType: 'QUALITATIVE',
            unit: '',
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
          },
        ],
        reagentBom: [],
        interpretations: {
          normal: 'No significant abnormality detected.',
          abnormalLow: 'Correlate clinically.',
          abnormalHigh: 'Abnormal finding observed; specialist correlation advised.',
          critical: 'Urgent clinical attention recommended.',
          methodologyNote: srv.methodology,
        },
      });
      addedServices += 1;
    }

    appendAudit(
      db,
      actor,
      'SERVICES',
      'NEPAL_SERVICES_CATALOG_FETCHED',
      'HOSPITAL-SERVICES-SYNC',
      `Fetched ${addedServices} X-Ray, DR X-Ray, USG, Doppler, ECG & clinical procedure services.`
    );
    saveDb(db);
    res.status(201).json({
      addedServices,
      totalServices: db.services.length,
      db: scopeDbForActor(db, actor),
    });
  });

  // Auto-Fetch Complete Hospital Laboratory Test Master Catalog (60+ Additional Panels Across All Departments)
  app.post('/api/services/fetch-lab-catalog', withAuth('services.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const existingByCode = new Map(db.services.map((s) => [s.code.toUpperCase(), s]));
    let addedServices = 0;
    let updatedServices = 0;

    for (const labSrv of NEPAL_LAB_TESTS_CATALOG) {
      const codeKey = labSrv.code.toUpperCase();
      const existing = existingByCode.get(codeKey);
      if (!existing) {
        db.services.push(JSON.parse(JSON.stringify(labSrv)));
        existingByCode.set(codeKey, labSrv);
        addedServices += 1;
      } else {
        let changed = false;
        if ((!existing.parameters || existing.parameters.length === 0) && labSrv.parameters.length > 0) {
          existing.parameters = JSON.parse(JSON.stringify(labSrv.parameters));
          changed = true;
        } else {
          for (const lp of labSrv.parameters) {
            const ep = existing.parameters.find((p) => p.id === lp.id);
            if (ep && lp.analyzerCode && !ep.analyzerCode) {
              ep.analyzerCode = lp.analyzerCode;
              changed = true;
            }
          }
        }
        if (changed) updatedServices += 1;
      }
    }

    db.services = db.services.map(ensureAnalyzerCodesOnService);
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }

    appendAudit(
      db,
      actor,
      'SERVICES',
      'LAB_CATALOG_AUTO_FETCHED',
      'LAB-MASTER-SYNC',
      `Auto-fetched ${addedServices} new lab tests & updated ${updatedServices} analyzer-mapped panels (${db.services.length} total services).`
    );
    saveDb(db);
    res.status(201).json({
      addedServices,
      updatedServices,
      totalServices: db.services.length,
      labServicesCount: db.services.filter((s) => s.serviceCategory === 'PATHOLOGY' || !s.serviceCategory).length,
      db: scopeDbForActor(db, actor),
    });
  });

  // Lab Analyzer Auto-Fetch Bridge: List Configured Machines & Incoming HL7/ASTM Queue
  app.get('/api/lab/analyzers', withAuth('orders.view'), (req: Request, res: Response) => {
    const { db } = req as AuthedRequest;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
      saveDb(db);
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }
    res.json({
      analyzers: db.analyzers,
      queue: db.analyzerQueue,
    });
  });

  // Update Lab Analyzer Host Settings (IP/Port/COM, Auto-Apply, Connection Status)
  app.post('/api/lab/analyzers/config', withAuth('results.enter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    const { analyzerId, endpointAddress, status, autoApplyOnReceive, protocol, connectionMode } = req.body as {
      analyzerId: string;
      endpointAddress?: string;
      status?: LabAnalyzerMachine['status'];
      autoApplyOnReceive?: boolean;
      protocol?: LabAnalyzerMachine['protocol'];
      connectionMode?: LabAnalyzerMachine['connectionMode'];
    };
    const machine = db.analyzers.find((a) => a.id === analyzerId);
    if (!machine) {
      res.status(404).json({ error: 'Analyzer profile not found.' });
      return;
    }
    if (endpointAddress !== undefined) machine.endpointAddress = endpointAddress.trim();
    if (status) machine.status = status;
    if (autoApplyOnReceive !== undefined) machine.autoApplyOnReceive = Boolean(autoApplyOnReceive);
    if (protocol) machine.protocol = protocol;
    if (connectionMode) machine.connectionMode = connectionMode;
    machine.lastHeartbeatAt = new Date().toISOString();

    appendAudit(
      db,
      actor,
      'RESULTS',
      'ANALYZER_CONFIG_UPDATED',
      machine.code,
      `Updated analyzer interface ${machine.name} (${machine.endpointAddress}, Auto-Apply: ${machine.autoApplyOnReceive ? 'ON' : 'OFF'}).`
    );
    saveDb(db);
    res.json({ analyzer: machine, analyzers: db.analyzers, db: scopeDbForActor(db, actor) });
  });

  // Ingest Raw HL7 ORU^R01 / ASTM E1394 / JSON Instrument Packet & Auto-Match Order
  app.post('/api/lab/analyzers/ingest', withAuth('results.enter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }

    const { analyzerId, rawPayload, accessionNumber, readings, values, applyImmediately } = req.body as {
      analyzerId?: string;
      rawPayload?: string;
      accessionNumber?: string;
      readings?: AnalyzerReadingItem[];
      values?: Record<string, number | string>;
      applyImmediately?: boolean;
    };

    const parsed = parseAnalyzerPayload({ rawPayload, accessionNumber, readings, values });
    if (!parsed.accessionNumber) {
      res.status(400).json({ error: 'Accession Number (OBR-2 / O-2 / accessionNumber) is required in analyzer packet.' });
      return;
    }
    if (parsed.readings.length === 0) {
      res.status(400).json({ error: 'No valid analyte readings (OBX / R segments) found in analyzer payload.' });
      return;
    }

    const machine =
      db.analyzers.find((a) => a.id === analyzerId) ||
      db.analyzers.find((a) =>
        parsed.readings.some((r) => a.mappedAnalytes.includes(r.code.toUpperCase()))
      ) ||
      db.analyzers[0];

    const matchedOrder = db.orders.find(
      (o) =>
        o.accessionNumber.toUpperCase() === parsed.accessionNumber.toUpperCase() ||
        o.id === parsed.accessionNumber
    );

    const now = new Date().toISOString();
    let status: AnalyzerResultMessage['status'] = matchedOrder ? 'PENDING' : 'UNMATCHED';
    let appliedCount = 0;

    if (matchedOrder && (applyImmediately === true || (applyImmediately !== false && machine.autoApplyOnReceive))) {
      const applied = applyReadingsToOrder(db, matchedOrder, parsed.readings);
      appliedCount = applied.appliedCount;
      if (appliedCount > 0) {
        status = 'APPLIED';
      }
    }

    machine.packetsProcessedCount = (machine.packetsProcessedCount || 0) + 1;
    machine.lastHeartbeatAt = now;

    const msg: AnalyzerResultMessage = {
      id: `anq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      receivedAt: now,
      analyzerId: machine.id,
      analyzerName: machine.name,
      protocol: parsed.protocol || machine.protocol,
      accessionNumber: parsed.accessionNumber,
      status,
      matchedOrderId: matchedOrder?.id,
      appliedCount,
      rawPayload: rawPayload || undefined,
      readings: parsed.readings,
      notes: matchedOrder
        ? status === 'APPLIED'
          ? `Auto-fetched & mapped ${appliedCount} analyte(s) into ${matchedOrder.accessionNumber}`
          : `Queued for bench verification on ${matchedOrder.accessionNumber}`
        : `No active order found matching accession ${parsed.accessionNumber}`,
    };

    db.analyzerQueue.unshift(msg);
    if (db.analyzerQueue.length > 120) {
      db.analyzerQueue = db.analyzerQueue.slice(0, 120);
    }

    appendAudit(
      db,
      actor,
      'RESULTS',
      status === 'APPLIED' ? 'ANALYZER_PACKET_AUTO_APPLIED' : 'ANALYZER_PACKET_QUEUED',
      parsed.accessionNumber,
      `${machine.name} (${parsed.protocol}) received ${parsed.readings.length} reading(s) for ${parsed.accessionNumber} -> ${status}.`
    );

    saveDb(db);
    res.status(201).json({
      message: msg,
      order: matchedOrder || null,
      appliedCount,
      db: scopeDbForActor(db, actor),
    });
  });

  // Auto-Fetch Analyzer Results for a Specific Lab Order (Queue First, Else Query Bi-Directional Analyzer)
  app.post('/api/orders/:id/auto-fetch-analyzer', withAuth('results.enter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }

    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: 'Order not found.' });
      return;
    }
    if (order.status === 'Validated' || order.status === 'Dispatched') {
      res.status(400).json({ error: 'Order is already validated. Unlock Amend Mode for manual changes.' });
      return;
    }

    const hasPathology = order.tests.some(
      (t) => t.serviceCategory !== 'RADIOLOGY' && t.department !== 'Radiology'
    );
    if (!hasPathology) {
      res.status(400).json({ error: 'This order contains only Imaging/Procedure items without analyzer parameters.' });
      return;
    }

    const now = new Date().toISOString();
    const pendingPackets = db.analyzerQueue.filter(
      (q) =>
        (q.status === 'PENDING' || q.status === 'UNMATCHED') &&
        (q.accessionNumber.toUpperCase() === order.accessionNumber.toUpperCase() || q.matchedOrderId === order.id)
    );

    let appliedCount = 0;
    let updatedTests: string[] = [];
    let matchedAnalyzerName = 'Connected Hospital Analyzer Bridge';
    let packet: AnalyzerResultMessage | null = null;

    if (pendingPackets.length > 0) {
      const mergedReadings: AnalyzerReadingItem[] = pendingPackets.flatMap((p) => p.readings);
      const resApply = applyReadingsToOrder(db, order, mergedReadings);
      appliedCount = resApply.appliedCount;
      updatedTests = resApply.updatedTests;
      for (const q of pendingPackets) {
        q.status = 'APPLIED';
        q.matchedOrderId = order.id;
        q.appliedCount = resApply.appliedCount;
        matchedAnalyzerName = q.analyzerName;
      }
      packet = pendingPackets[0];
    } else {
      const generated = buildAnalyzerReadingsForOrder(order, db.services);
      if (generated.readings.length === 0) {
        res.status(400).json({ error: 'No mappable quantitative/qualitative analyzer parameters found on this order.' });
        return;
      }
      const primaryDept = order.tests.find((t) => t.serviceCategory !== 'RADIOLOGY')?.department;
      const machine =
        db.analyzers.find((a) => a.department === primaryDept && a.status === 'Connected') ||
        db.analyzers.find((a) => a.status === 'Connected') ||
        db.analyzers[0];

      matchedAnalyzerName = machine ? `${machine.name} (${machine.endpointAddress})` : matchedAnalyzerName;
      const resApply = applyReadingsToOrder(db, order, generated.readings);
      appliedCount = resApply.appliedCount;
      updatedTests = resApply.updatedTests;

      if (machine) {
        machine.packetsProcessedCount = (machine.packetsProcessedCount || 0) + 1;
        machine.lastHeartbeatAt = now;
      }

      packet = {
        id: `anq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receivedAt: now,
        analyzerId: machine?.id || 'ana-bridge',
        analyzerName: machine?.name || 'Hospital Analyzer Bridge',
        protocol: machine?.protocol || 'HL7_V2',
        accessionNumber: order.accessionNumber,
        status: 'APPLIED',
        matchedOrderId: order.id,
        appliedCount,
        rawPayload: generated.hl7Frame,
        readings: generated.readings,
        notes: `Bi-directional host query fetched ${appliedCount} analyte(s) (${updatedTests.join(', ')})`,
      };
      db.analyzerQueue.unshift(packet);
      if (db.analyzerQueue.length > 120) {
        db.analyzerQueue = db.analyzerQueue.slice(0, 120);
      }
    }

    appendAudit(
      db,
      actor,
      'RESULTS',
      'ANALYZER_AUTO_FETCHED',
      order.accessionNumber,
      `Auto-fetched ${appliedCount} analyte reading(s) from ${matchedAnalyzerName} for ${order.accessionNumber} (${updatedTests.join(', ')}).`
    );

    saveDb(db);
    res.json({
      order,
      matchedAnalyzer: matchedAnalyzerName,
      appliedCount,
      updatedTests,
      packet,
      db: scopeDbForActor(db, actor),
    });
  });

  // Batch Auto-Fetch & Sync Across Pending Analyzer Queue & Open Pathology Orders
  app.post('/api/lab/analyzers/sync-all', withAuth('results.enter'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }

    const { queryOpenOrders = true } = (req.body || {}) as { queryOpenOrders?: boolean };
    const now = new Date().toISOString();
    let syncedOrdersCount = 0;
    let totalAnalytesApplied = 0;

    // 1. Apply any queued incoming HL7/ASTM packets first
    for (const q of db.analyzerQueue) {
      if (q.status !== 'PENDING' && q.status !== 'UNMATCHED') continue;
      const ord = db.orders.find(
        (o) =>
          o.accessionNumber.toUpperCase() === q.accessionNumber.toUpperCase() ||
          o.id === q.matchedOrderId
      );
      if (!ord || ord.status === 'Validated' || ord.status === 'Dispatched') continue;
      const resApply = applyReadingsToOrder(db, ord, q.readings);
      if (resApply.appliedCount > 0) {
        q.status = 'APPLIED';
        q.matchedOrderId = ord.id;
        q.appliedCount = resApply.appliedCount;
        syncedOrdersCount += 1;
        totalAnalytesApplied += resApply.appliedCount;
      }
    }

    // 2. Optionally query bi-directional analyzers for open pathology orders still missing values
    if (queryOpenOrders) {
      const openOrders = db.orders.filter(
        (o) =>
          (o.status === 'Ordered' || o.status === 'Collected' || o.status === 'In Lab') &&
          o.tests.some(
            (t) =>
              t.serviceCategory !== 'RADIOLOGY' &&
              t.department !== 'Radiology' &&
              t.parameterResults.some((p) => p.value === null || p.value === '')
          )
      );
      for (const ord of openOrders.slice(0, 20)) {
        const generated = buildAnalyzerReadingsForOrder(ord, db.services);
        if (generated.readings.length === 0) continue;
        const resApply = applyReadingsToOrder(db, ord, generated.readings);
        if (resApply.appliedCount > 0) {
          const primaryDept = ord.tests.find((t) => t.serviceCategory !== 'RADIOLOGY')?.department;
          const machine =
            db.analyzers.find((a) => a.department === primaryDept && a.status === 'Connected') ||
            db.analyzers[0];
          if (machine) {
            machine.packetsProcessedCount = (machine.packetsProcessedCount || 0) + 1;
            machine.lastHeartbeatAt = now;
          }
          db.analyzerQueue.unshift({
            id: `anq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            receivedAt: now,
            analyzerId: machine?.id || 'ana-bridge',
            analyzerName: machine?.name || 'Hospital Analyzer Bridge',
            protocol: machine?.protocol || 'HL7_V2',
            accessionNumber: ord.accessionNumber,
            status: 'APPLIED',
            matchedOrderId: ord.id,
            appliedCount: resApply.appliedCount,
            rawPayload: generated.hl7Frame,
            readings: generated.readings,
            notes: `Batch sync auto-fetched ${resApply.appliedCount} analyte(s)`,
          });
          syncedOrdersCount += 1;
          totalAnalytesApplied += resApply.appliedCount;
        }
      }
      if (db.analyzerQueue.length > 120) {
        db.analyzerQueue = db.analyzerQueue.slice(0, 120);
      }
    }

    appendAudit(
      db,
      actor,
      'RESULTS',
      'ANALYZER_BATCH_SYNCED',
      'ANALYZER-BRIDGE',
      `Batch analyzer sync updated ${syncedOrdersCount} lab order(s) with ${totalAnalytesApplied} analyte reading(s).`
    );

    saveDb(db);
    res.json({
      syncedOrdersCount,
      totalAnalytesApplied,
      db: scopeDbForActor(db, actor),
    });
  });

  // Pharmacy Advance Deposit Collection (Cash / Bank-QR for UHID, IPD & Emergency Patients)
  app.post('/api/pharmacy/deposits', withAuth('pharmacy.dispense', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      patientId,
      uhid,
      patientName,
      patientPhone,
      encounterType = 'WALKING',
      encounterId,
      encounterLabel,
      amountNpr,
      paymentMode = 'Cash',
      bankAccountId,
      notes,
    } = req.body as {
      patientId?: string;
      uhid?: string;
      patientName: string;
      patientPhone?: string;
      encounterType?: EncounterType;
      encounterId?: string;
      encounterLabel?: string;
      amountNpr: number;
      paymentMode?: PaymentMode;
      bankAccountId?: string;
      notes?: string;
    };

    const amt = Number(Number(amountNpr || 0).toFixed(2));
    if (!patientName?.trim() || amt <= 0) {
      res.status(400).json({ error: 'Patient name and positive deposit amount (रू) are required.' });
      return;
    }
    const patientRec = upsertPatientMaster(db, {
      patientId,
      uhid,
      fullName: patientName.trim(),
      age: 30,
      ageType: 'Years',
      gender: 'Other',
      phone: patientPhone,
      actorName: actor.fullName,
    });
    if (!Array.isArray(db.pharmacyDeposits)) db.pharmacyDeposits = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const receiptNumber = `PHM-DEP-${bsNow.year}-${101 + db.pharmacyDeposits.length}`;
    const depositRec: PharmacyDepositRecord = {
      id: `pdep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      receiptNumber,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      patientName: patientRec.fullName,
      patientPhone: patientPhone?.trim() || patientRec.phone || '',
      encounterType,
      encounterId,
      encounterLabel: encounterLabel?.trim() || `${encounterType} · ${patientRec.uhid}`,
      amountNpr: amt,
      remainingBalanceNpr: amt,
      paymentMode,
      receivedById: actor.id,
      receivedBy: actor.fullName,
      receivedAt: nowIso,
      notes: notes?.trim() || 'Pharmacy advance security deposit',
    };
    db.pharmacyDeposits.unshift(depositRec);

    if (encounterType === 'EMERGENCY' && encounterId) {
      const erCase = (db.emergencyCases || []).find((e) => e.id === encounterId);
      if (erCase) {
        erCase.depositPaidNpr = Number(((erCase.depositPaidNpr || 0) + amt).toFixed(2));
      }
    }

    // Post to Pharmacy-scoped Cash or Bank account
    if (paymentMode === 'Bank / QR') {
      const bankAcc =
        (bankAccountId && db.accounts.find((a) => a.id === bankAccountId)) ||
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'BANK') ||
        db.accounts.find((a) => a.isDefaultPosBank) ||
        db.accounts.find((a) => a.type === 'BANK');
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          'INFLOW',
          amt,
          'PHARMACY_POS',
          receiptNumber,
          `Pharmacy Advance Deposit ${receiptNumber} (${patientRec.fullName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    } else {
      const cashAcc =
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'CASH_COUNTER') ||
        db.accounts.find((a) => a.isDefaultPosCash) ||
        db.accounts.find((a) => a.type === 'CASH_COUNTER');
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          'INFLOW',
          amt,
          'PHARMACY_POS',
          receiptNumber,
          `Pharmacy Advance Deposit ${receiptNumber} (${patientRec.fullName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }

    appendAudit(
      db,
      actor,
      'PHARMACY',
      'PHARMACY_DEPOSIT_COLLECTED',
      receiptNumber,
      `Collected रू ${amt.toLocaleString()} Pharmacy Advance Deposit for ${patientRec.fullName} (${encounterType}).`
    );
    saveDb(db);
    res.status(201).json({ deposit: depositRec, db: scopeDbForActor(db, actor) });
  });

  // Pharmacy Due Settlement / Credit Collection on Existing Credit Invoices
  app.post('/api/pharmacy/invoices/:id/settle-due', withAuth(undefined, 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (
      !hasPermission(db, actor.roleId, 'pharmacy.dispense') &&
      !hasPermission(db, actor.roleId, 'finance.manage')
    ) {
      res.status(403).json({
        error: `Forbidden: Role '${actor.roleId}' lacks permission to settle pharmacy dues.`,
      });
      return;
    }
    const inv = (db.pharmacyInvoices || []).find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: 'Pharmacy invoice not found.' });
      return;
    }
    const { amountNpr, paymentMode = 'Cash', bankAccountId, note } = req.body as {
      amountNpr: number;
      paymentMode?: PaymentMode;
      bankAccountId?: string;
      note?: string;
    };
    const currentDue =
      inv.dueAmountNpr !== undefined
        ? inv.dueAmountNpr
        : Math.max(0, inv.totalNpr - ((inv.cashPaid || 0) + (inv.bankPaid || 0) + (inv.depositAppliedNpr || 0)));
    const payAmt = Number(Math.min(currentDue, Math.max(0, Number(amountNpr) || 0)).toFixed(2));
    if (payAmt <= 0) {
      res.status(400).json({ error: 'Due amount is already zero or settlement amount is invalid.' });
      return;
    }

    const settlement: PharmacyDueSettlement = {
      id: `pset-${Date.now()}`,
      settledAt: new Date().toISOString(),
      settledBy: actor.fullName,
      amountNpr: payAmt,
      paymentMode,
      note: note?.trim() || 'Pharmacy credit due collection',
    };
    if (!Array.isArray(inv.dueSettlements)) inv.dueSettlements = [];
    inv.dueSettlements.unshift(settlement);

    if (paymentMode === 'Bank / QR') {
      inv.bankPaid = Number(((inv.bankPaid || 0) + payAmt).toFixed(2));
      const bankAcc =
        (bankAccountId && db.accounts.find((a) => a.id === bankAccountId)) ||
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'BANK') ||
        db.accounts.find((a) => a.isDefaultPosBank) ||
        db.accounts.find((a) => a.type === 'BANK');
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          'INFLOW',
          payAmt,
          'PHARMACY_POS',
          inv.invoiceNumber,
          `Pharmacy Due Settlement ${inv.invoiceNumber} (${inv.patientName})`,
          inv.fiscalYear,
          actor
        );
      }
    } else {
      inv.cashPaid = Number(((inv.cashPaid || 0) + payAmt).toFixed(2));
      const cashAcc =
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'CASH_COUNTER') ||
        db.accounts.find((a) => a.isDefaultPosCash) ||
        db.accounts.find((a) => a.type === 'CASH_COUNTER');
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          'INFLOW',
          payAmt,
          'PHARMACY_POS',
          inv.invoiceNumber,
          `Pharmacy Due Settlement ${inv.invoiceNumber} (${inv.patientName})`,
          inv.fiscalYear,
          actor
        );
      }
    }

    const totalPaidNow = Number(
      ((inv.paidAmountNpr ?? ((inv.cashPaid || 0) + (inv.bankPaid || 0) + (inv.depositAppliedNpr || 0) - payAmt)) + payAmt).toFixed(2)
    );
    const nextDue = Number(Math.max(0, inv.totalNpr - totalPaidNow).toFixed(2));
    inv.paidAmountNpr = totalPaidNow;
    inv.dueAmountNpr = nextDue;
    inv.paymentStatus = nextDue <= 0 ? 'PAID' : 'PARTIAL';

    if (inv.encounterType === 'EMERGENCY' && inv.encounterId) {
      const erCase = (db.emergencyCases || []).find((e) => e.id === inv.encounterId);
      if (erCase) {
        erCase.pharmacyCreditDueNpr = Number(Math.max(0, (erCase.pharmacyCreditDueNpr || 0) - payAmt).toFixed(2));
      }
    }

    appendAudit(
      db,
      actor,
      'PHARMACY',
      'PHARMACY_DUE_SETTLED',
      inv.invoiceNumber,
      `Settled रू ${payAmt.toLocaleString()} due on ${inv.invoiceNumber} (${inv.patientName}). Remaining due: रू ${nextDue.toLocaleString()}.`
    );
    saveDb(db);
    res.json({ invoice: inv, db: scopeDbForActor(db, actor) });
  });

  // Atomic Strict FEFO Auto-Allocation & Dispense Billing (Cash / Bank / Split / Credit + Deposit & IPD/ER Credit Limit Enforcement)
  app.post('/api/pharmacy/dispense', withAuth('pharmacy.dispense', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const {
      patientId,
      uhid,
      encounterType,
      encounterId,
      encounterLabel,
      nonInventoryBillOnly,
      patientName,
      patientPhone,
      patientAge,
      prescribingDoctor,
      linkedOrderAccession,
      items,
      discountNpr = 0,
      paymentMode = 'Cash',
      cashPaid,
      bankPaid,
      bankAccountId,
      applyDepositAmountNpr = 0,
      adminCreditOverride = false,
    } = req.body as {
      patientId?: string;
      uhid?: string;
      encounterType?: EncounterType;
      encounterId?: string;
      encounterLabel?: string;
      nonInventoryBillOnly?: boolean;
      patientName: string;
      patientPhone?: string;
      patientAge?: number;
      prescribingDoctor?: string;
      linkedOrderAccession?: string;
      items: Array<{ medicineId: string; quantity: number; customUnitPriceNpr?: number }>;
      discountNpr?: number;
      paymentMode?: PaymentMode;
      cashPaid?: number;
      bankPaid?: number;
      bankAccountId?: string;
      applyDepositAmountNpr?: number;
      adminCreditOverride?: boolean;
    };

    if (!patientName?.trim() || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Patient name and at least one medicine item are required.' });
      return;
    }

    const effectiveCenterId: string | null = null;
    const todayYmd = new Date().toISOString().slice(0, 10);
    const strictBlockExpired = db.settings?.moduleSettings?.strictFefoBlockExpired !== false;
    const isBillOnly = Boolean(nonInventoryBillOnly);
    const ms = db.settings?.moduleSettings;

    const stagedDeductions: Array<{
      batch: PharmacyBatch | null;
      deductQty: number;
      line: PharmacyDispenseLine;
      vatApplicable: boolean;
    }> = [];

    for (const reqItem of items) {
      const med = db.pharmacyMedicines.find((m) => m.id === reqItem.medicineId);
      const wantQty = Math.floor(Number(reqItem.quantity) || 0);
      if (!med || wantQty <= 0) {
        res.status(400).json({ error: 'Invalid medicine or quantity requested.' });
        return;
      }

      if (isBillOnly) {
        const unitPrice =
          reqItem.customUnitPriceNpr !== undefined && Number(reqItem.customUnitPriceNpr) >= 0
            ? Number(Number(reqItem.customUnitPriceNpr).toFixed(2))
            : med.defaultMrpNpr;
        const lineTotal = Number((wantQty * unitPrice).toFixed(2));
        stagedDeductions.push({
          batch: null,
          deductQty: 0,
          vatApplicable: med.vatApplicable,
          line: {
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            genericName: med.genericName,
            batchId: 'bill-only',
            batchNumber: 'BILL-ONLY',
            expiryDate: 'N/A',
            quantity: wantQty,
            unitPriceNpr: unitPrice,
            purchaseRateNpr: med.defaultPurchaseRateNpr ?? Number((unitPrice / 1.16).toFixed(2)),
            lineTotalNpr: lineTotal,
          },
        });
        continue;
      }

      const candidateBatches = db.pharmacyBatches
        .filter(
          (b) =>
            b.medicineId === med.id &&
            !b.quarantined &&
            b.quantityOnHand > 0 &&
            (!strictBlockExpired || b.expiryDate >= todayYmd)
        )
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

      const totalAvailable = candidateBatches.reduce((s, b) => s + b.quantityOnHand, 0);
      if (totalAvailable < wantQty) {
        res.status(400).json({
          error: `Insufficient non-expired FEFO stock for ${med.brandName}: requested ${wantQty}, available ${totalAvailable} ${med.unitLabel}.`,
        });
        return;
      }

      let remaining = wantQty;
      for (const batch of candidateBatches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, batch.quantityOnHand);
        remaining -= take;
        const lineTotal = Number((take * batch.mrpNpr).toFixed(2));
        stagedDeductions.push({
          batch,
          deductQty: take,
          vatApplicable: med.vatApplicable,
          line: {
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            genericName: med.genericName,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            quantity: take,
            unitPriceNpr: batch.mrpNpr,
            purchaseRateNpr: batch.purchaseRateNpr,
            lineTotalNpr: lineTotal,
          },
        });
      }
    }

    const subtotalNpr = Number(
      stagedDeductions.reduce((s, d) => s + d.line.lineTotalNpr, 0).toFixed(2)
    );
    const discount = Math.max(0, Math.min(subtotalNpr, Number(discountNpr) || 0));
    const taxableGross = stagedDeductions
      .filter((d) => d.vatApplicable)
      .reduce((s, d) => s + d.line.lineTotalNpr, 0);
    const vatNpr = subtotalNpr > 0 ? Number((((taxableGross * (subtotalNpr - discount)) / subtotalNpr) * 0.13).toFixed(2)) : 0;
    const totalNpr = Number((subtotalNpr - discount + vatNpr).toFixed(2));

    // Match patient master first without mutating until credit check passes
    const existingPatient =
      (patientId && (db.patients || []).find((p) => p.id === patientId)) ||
      (uhid && (db.patients || []).find((p) => p.uhid === uhid)) ||
      (db.patients || []).find(
        (p) =>
          p.fullName.toLowerCase() === patientName.trim().toLowerCase() &&
          (!patientPhone || !p.phone || p.phone === patientPhone.trim())
      );

    // Check matching advance deposit pool
    if (!Array.isArray(db.pharmacyDeposits)) db.pharmacyDeposits = [];
    const matchingDeposits = db.pharmacyDeposits.filter(
      (d) =>
        d.remainingBalanceNpr > 0 &&
        ((existingPatient?.id && d.patientId === existingPatient.id) ||
          (uhid && d.uhid === uhid) ||
          (existingPatient?.uhid && d.uhid === existingPatient.uhid) ||
          (encounterId && d.encounterId === encounterId))
    );
    const availableDepositPool = Number(
      matchingDeposits.reduce((s, d) => s + d.remainingBalanceNpr, 0).toFixed(2)
    );
    const depositApplied = Number(
      Math.min(totalNpr, availableDepositPool, Math.max(0, Number(applyDepositAmountNpr) || 0)).toFixed(2)
    );
    const balanceAfterDeposit = Number(Math.max(0, totalNpr - depositApplied).toFixed(2));

    const cashAmt =
      paymentMode === 'Cash'
        ? Number(Math.min(balanceAfterDeposit, Number(cashPaid ?? balanceAfterDeposit)).toFixed(2))
        : paymentMode === 'Split' || paymentMode === 'Credit'
        ? Number(Math.max(0, Number(cashPaid || 0)).toFixed(2))
        : 0;
    const bankAmt =
      paymentMode === 'Bank / QR'
        ? Number(Math.min(balanceAfterDeposit, Number(bankPaid ?? balanceAfterDeposit)).toFixed(2))
        : paymentMode === 'Split' || paymentMode === 'Credit'
        ? Number(Math.max(0, Number(bankPaid || 0)).toFixed(2))
        : 0;

    const totalPaidNow = Number(Math.min(totalNpr, depositApplied + cashAmt + bankAmt).toFixed(2));
    const dueAmount = Number(Math.max(0, totalNpr - totalPaidNow).toFixed(2));
    const effEncounterType: EncounterType = encounterType || 'WALKING';

    // Credit Limit Validation for IPD and EMERGENCY Patients
    const activeIpd =
      effEncounterType === 'IPD'
        ? (db.ipdAdmissions || []).find(
            (a) =>
              a.disposition === 'Admitted' &&
              ((encounterId && a.id === encounterId) ||
                (existingPatient?.id && a.patientId === existingPatient.id) ||
                (uhid && a.uhid === uhid))
          )
        : undefined;
    const activeEr =
      effEncounterType === 'EMERGENCY'
        ? (db.emergencyCases || []).find(
            (e) =>
              e.disposition === 'Under Observation (ER)' &&
              ((encounterId && e.id === encounterId) ||
                (existingPatient?.id && e.patientId === existingPatient.id) ||
                (uhid && e.uhid === uhid))
          )
        : undefined;

    let checkedCreditLimit: number | undefined;
    if (dueAmount > 0 && (effEncounterType === 'IPD' || effEncounterType === 'EMERGENCY')) {
      const existingPharmacyDue = (db.pharmacyInvoices || [])
        .filter(
          (inv) =>
            (inv.dueAmountNpr || 0) > 0 &&
            ((existingPatient?.id && inv.patientId === existingPatient.id) ||
              (uhid && inv.uhid === uhid) ||
              (encounterId && inv.encounterId === encounterId))
        )
        .reduce((s, inv) => s + (inv.dueAmountNpr || 0), 0);

      if (effEncounterType === 'IPD') {
        checkedCreditLimit = activeIpd?.creditLimitNpr || ms?.ipdDefaultCreditLimitNpr || 25000;
        const hospitalDue = activeIpd ? Math.max(0, activeIpd.balanceDueNpr) : 0;
        const projectedExposure = Number((hospitalDue + existingPharmacyDue + dueAmount).toFixed(2));
        if (
          projectedExposure > checkedCreditLimit &&
          !(adminCreditOverride && (actor.roleId === 'SUPER_ADMIN' || actor.roleId === 'SAAS_ADMIN'))
        ) {
          res.status(409).json({
            error: `IPD Credit Limit Exceeded: Projected exposure रू ${projectedExposure.toLocaleString()} exceeds approved IPD credit limit of रू ${checkedCreditLimit.toLocaleString()}. Collect an advance deposit / partial payment or request Admin override.`,
            code: 'CREDIT_LIMIT_EXCEEDED',
            creditLimitNpr: checkedCreditLimit,
            projectedExposureNpr: projectedExposure,
          });
          return;
        }
      } else if (effEncounterType === 'EMERGENCY') {
        checkedCreditLimit = activeEr?.creditLimitNpr || ms?.emergencyDefaultCreditLimitNpr || 15000;
        const projectedExposure = Number((existingPharmacyDue + dueAmount).toFixed(2));
        if (
          projectedExposure > checkedCreditLimit &&
          !(adminCreditOverride && (actor.roleId === 'SUPER_ADMIN' || actor.roleId === 'SAAS_ADMIN'))
        ) {
          res.status(409).json({
            error: `Emergency Credit Limit Exceeded: Projected ER pharmacy credit रू ${projectedExposure.toLocaleString()} exceeds ER credit limit of रू ${checkedCreditLimit.toLocaleString()}. Collect advance deposit or request Admin override.`,
            code: 'CREDIT_LIMIT_EXCEEDED',
            creditLimitNpr: checkedCreditLimit,
            projectedExposureNpr: projectedExposure,
          });
          return;
        }
      }
    }

    const patientRec = upsertPatientMaster(db, {
      patientId,
      uhid,
      fullName: patientName.trim(),
      age: Number(patientAge) || 30,
      ageType: 'Years',
      gender: 'Other',
      phone: patientPhone,
      actorName: actor.fullName,
    });

    // Deduct applied deposit FIFO across matching deposits
    if (depositApplied > 0) {
      let remDep = depositApplied;
      for (const dep of matchingDeposits) {
        if (remDep <= 0) break;
        const take = Math.min(remDep, dep.remainingBalanceNpr);
        dep.remainingBalanceNpr = Number((dep.remainingBalanceNpr - take).toFixed(2));
        remDep = Number((remDep - take).toFixed(2));
      }
    }

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const prefix = ms?.pharmacyInvoicePrefix || 'PHM-INV';
    const invNo = `${prefix}-${bsNow.year}-${101 + db.pharmacyInvoices.length}`;

    if (!isBillOnly) {
      for (const d of stagedDeductions) {
        if (!d.batch) continue;
        d.batch.quantityOnHand = Math.max(0, d.batch.quantityOnHand - d.deductQty);
        db.pharmacyMovements.unshift({
          id: `pmov-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: nowIso,
          medicineId: d.line.medicineId,
          medicineName: d.line.medicineName,
          batchId: d.batch.id,
          batchNumber: d.batch.batchNumber,
          expiryDate: d.batch.expiryDate,
          centerId: effectiveCenterId,
          type: 'FEFO_DISPENSE',
          quantityDelta: -d.deductQty,
          balanceAfter: d.batch.quantityOnHand,
          referenceId: invNo,
          performedBy: actor.fullName,
          notes: `FEFO auto-dispensed to ${patientRec.fullName} (Exp ${d.batch.expiryDate})`,
        });
      }
    }

    const paymentStatus: PharmacyDispenseInvoice['paymentStatus'] =
      dueAmount <= 0 ? 'PAID' : totalPaidNow > 0 ? 'PARTIAL' : 'CREDIT_DUE';

    const invoice: PharmacyDispenseInvoice = {
      id: `pinv-${Date.now()}`,
      invoiceNumber: invNo,
      fiscalYear: db.settings.activeFiscalYear,
      dispensedAt: nowIso,
      centerId: null,
      centerName: ms?.pharmacyEntityName || 'Pharmacy Store',
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterType: effEncounterType,
      encounterId: encounterId || activeIpd?.id || activeEr?.id,
      encounterLabel: encounterLabel?.trim() || `${effEncounterType}: ${patientRec.uhid}`,
      nonInventoryBillOnly: isBillOnly,
      patientName: patientRec.fullName,
      patientPhone: patientPhone?.trim() || patientRec.phone,
      patientAge: patientAge ? Number(patientAge) : undefined,
      prescribingDoctor: prescribingDoctor?.trim() || 'OPD / Self',
      linkedOrderAccession: linkedOrderAccession?.trim() || undefined,
      paymentMode,
      cashPaid: cashAmt,
      bankPaid: bankAmt,
      depositAppliedNpr: depositApplied,
      paidAmountNpr: totalPaidNow,
      dueAmountNpr: dueAmount,
      paymentStatus,
      creditLimitCheckedNpr: checkedCreditLimit,
      dueSettlements: [],
      subtotalNpr,
      discountNpr: discount,
      vatNpr,
      totalNpr,
      dispensedById: actor.id,
      dispensedBy: actor.fullName,
      lines: stagedDeductions.map((d) => d.line),
    };

    db.pharmacyInvoices.unshift(invoice);

    if (activeEr && dueAmount > 0) {
      activeEr.pharmacyCreditDueNpr = Number(((activeEr.pharmacyCreditDueNpr || 0) + dueAmount).toFixed(2));
    }

    // Strictly post to PHARMACY-SCOPED Cash/Bank Accounts for new money received right now
    if (cashAmt > 0) {
      const cashAcc =
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'CASH_COUNTER') ||
        db.accounts.find((a) => a.isDefaultPosCash) ||
        db.accounts.find((a) => a.type === 'CASH_COUNTER');
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          'INFLOW',
          cashAmt,
          'PHARMACY_POS',
          invNo,
          `Pharmacy ${isBillOnly ? 'Bill-Only ' : 'FEFO '}Cash Sale ${invNo} (${invoice.patientName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }
    if (bankAmt > 0) {
      const bankAcc =
        (bankAccountId && db.accounts.find((a) => a.id === bankAccountId)) ||
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'BANK') ||
        db.accounts.find((a) => a.isDefaultPosBank) ||
        db.accounts.find((a) => a.type === 'BANK');
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          'INFLOW',
          bankAmt,
          'PHARMACY_POS',
          invNo,
          `Pharmacy ${isBillOnly ? 'Bill-Only ' : 'FEFO '}Bank/QR Sale ${invNo} (${invoice.patientName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }

    appendAudit(
      db,
      actor,
      'PHARMACY',
      isBillOnly ? 'PHARMACY_BILL_ONLY_ISSUED' : 'PHARMACY_FEFO_DISPENSED',
      invNo,
      `${isBillOnly ? 'Non-inventory bill-only invoice' : `Dispensed ${invoice.lines.length} FEFO batch lines`} for ${invoice.patientName} — Total रू ${totalNpr.toLocaleString()} (${paymentMode}, Paid रू ${totalPaidNow.toLocaleString()}, Due रू ${dueAmount.toLocaleString()}).`
    );
    saveDb(db);
    res.status(201).json({ invoice, db: scopeDbForActor(db, actor) });
  });

  // Hospital Clinical Suite: OPD (Free Follow-up Window), IPD Admission Fee & Credit Limit, Bed Transfers, Auto Daily Charges (Bed, Nursing, Observation, Doctor Round)
  const recalcIpdFinancials = (
    adm: IpdAdmission,
    ms?: Partial<ModuleSettingsConfig>,
    manualOverride?:
      | number
      | {
          bedDaysBilled?: number;
          doctorRoundsCount?: number;
          nursingDaysBilled?: number;
          observationDaysBilled?: number;
        }
  ) => {
    const normalizedOverride =
      typeof manualOverride === 'number'
        ? { bedDaysBilled: manualOverride }
        : manualOverride;

    const autoSummary = computeIpdDailyAutoCharges(
      adm,
      ms,
      adm.disposition === 'Admitted' ? undefined : adm.dischargedAt,
      normalizedOverride
    );

    if (normalizedOverride || adm.disposition === 'Admitted') {
      adm.bedDaysBilled = autoSummary.bedDaysBilled;
      adm.bedChargesNpr = autoSummary.bedChargesNpr;
      adm.doctorRoundsCount = autoSummary.doctorRoundsCount;
      adm.doctorRoundFeeNpr = autoSummary.doctorRoundFeeNpr;
      adm.doctorRoundChargesNpr = autoSummary.doctorRoundChargesNpr;
      adm.nursingDaysBilled = autoSummary.nursingDaysBilled;
      adm.nursingChargePerDayNpr = autoSummary.nursingChargePerDayNpr;
      adm.nursingChargesNpr = autoSummary.nursingChargesNpr;
      adm.autoObservationDaysBilled = autoSummary.observationDaysBilled;
      adm.autoObservationFeePerDayNpr = autoSummary.observationFeePerDayNpr;
      adm.autoObservationChargesNpr = autoSummary.autoObservationChargesNpr;
      adm.bedCycleWindowLabel = autoSummary.cycleWindowLabel;
    }

    const medsTotal = Number(
      adm.usedMedicines.reduce((sum, m) => sum + (Number(m.totalPriceNpr) || 0), 0).toFixed(2)
    );
    const invTotal = Number(
      adm.investigationsDone.reduce((sum, i) => sum + (Number(i.priceNpr) || 0), 0).toFixed(2)
    );
    const depositsPaid = Number(
      adm.deposits.reduce((sum, d) => sum + (Number(d.amountNpr) || 0), 0).toFixed(2)
    );
    const shiftObsTotal = Number(
      (adm.nursingObservationFees || [])
        .reduce((sum, item) => sum + (Number(item.feeNpr) || 0), 0)
        .toFixed(2)
    );
    adm.nursingObservationChargesNpr = shiftObsTotal;

    const directProceduresTotal = Number(
      (adm.directServiceCharges || [])
        .reduce((sum, item) => sum + (Number(item.amountNpr) || 0), 0)
        .toFixed(2)
    );
    const individualBillsTotal = Number(
      (adm.ipdIndividualBills || [])
        .reduce((sum, b) => sum + (Number(b.amountNpr) || 0), 0)
        .toFixed(2)
    );

    const admFee = Number(adm.admissionFeeNpr) || 0;
    const bedChg = Number(adm.bedChargesNpr) || 0;
    const roundChg = Number(adm.doctorRoundChargesNpr) || 0;
    const nursingChg = Number(adm.nursingChargesNpr) || 0;
    const autoObsChg = Number(adm.autoObservationChargesNpr) || 0;
    const otherChg = Number(adm.otherProcedureChargesNpr) || 0;
    const totalBill = Number(
      (
        admFee +
        bedChg +
        roundChg +
        nursingChg +
        autoObsChg +
        shiftObsTotal +
        medsTotal +
        invTotal +
        directProceduresTotal +
        otherChg
      ).toFixed(2)
    );
    adm.medicinesTotalNpr = medsTotal;
    adm.investigationsTotalNpr = invTotal;
    adm.totalBillNpr = totalBill;
    adm.totalDepositPaidNpr = depositsPaid;
    adm.individualCashPaidTotalNpr = individualBillsTotal;
    adm.balanceDueNpr = Number((totalBill - depositsPaid - individualBillsTotal).toFixed(2));
    if (adm.creditLimitNpr !== undefined && adm.creditLimitNpr > 0) {
      if (adm.creditApprovalStatus !== 'APPROVED') {
        adm.creditApprovalStatus =
          adm.balanceDueNpr > adm.creditLimitNpr ? 'PENDING_ADMIN_CREDIT' : 'WITHIN_LIMIT';
      }
    }
  };

  const createLinkedOrderFromClinical = (
    db: LimsDatabase,
    actor: StaffMember,
    opts: {
      centerId: string | null;
      centerName: string;
      patientId?: string;
      uhid?: string;
      encounterType?: EncounterType;
      encounterId?: string;
      encounterLabel?: string;
      patientName: string;
      patientAge: number;
      patientAgeType: AgeType;
      patientGender: PatientGender;
      patientPhone: string;
      patientAddress: string;
      referringDoctor: string;
      serviceIds: string[];
      priority?: 'Routine' | 'STAT';
    }
  ): LabOrder | null => {
    const services = opts.serviceIds
      .map((id) => db.services.find((s) => s.id === id))
      .filter((s): s is LabServiceTest => Boolean(s));
    if (services.length === 0) return null;

    const now = new Date();
    const bsNow = adToBs(now);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const seq = 1045 + db.orders.length + 1;
    const ms = db.settings.moduleSettings;
    const accessionNumber = `${ms?.labOrderPrefix || 'SAP'}-${bsNow.year}-${seq}`;
    const invoiceNumber = `${ms?.billPrefix || 'BILL'}-${bsNow.year}-${seq}`;
    const factor = opts.priority === 'STAT' ? 0.5 : 1;

    const testItems: OrderTestItem[] = services.map((srv) => {
      const effectiveTat = Math.max(30, Math.round(srv.tatMinutes * factor));
      return {
        serviceId: srv.id,
        serviceCode: srv.code,
        serviceName: srv.name,
        serviceCategory: srv.serviceCategory || (srv.department === 'Radiology' ? 'RADIOLOGY' : 'PATHOLOGY'),
        modality: srv.modality,
        department: srv.department,
        methodology: srv.methodology,
        tatMinutes: effectiveTat,
        dueAt: new Date(now.getTime() + effectiveTat * 60000).toISOString(),
        price: srv.price,
        referralCommissionNpr: 0,
        reagentsDeducted: false,
        status: 'Pending',
        interpretation: '',
        parameterResults: srv.parameters.map((p) => {
          const ref = getRefRange(p, opts.patientGender || 'Male');
          return {
            parameterId: p.id,
            parameterName: p.name,
            resultType: p.resultType || 'NUMERIC',
            unit: p.unit,
            value: null,
            refRangeDisplay: ref.display,
            flag: 'NORMAL',
          };
        }),
      };
    });

    const total = Number(testItems.reduce((s, t) => s + t.price, 0).toFixed(2));
    const maxDueAt = testItems.reduce(
      (latest, t) => (new Date(t.dueAt).getTime() > new Date(latest).getTime() ? t.dueAt : latest),
      testItems[0].dueAt
    );

    const newOrder: LabOrder = {
      id: `ord-clin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      accessionNumber,
      invoiceNumber,
      fiscalYear: activeFy,
      patientId: opts.patientId,
      uhid: opts.uhid,
      encounterType: opts.encounterType || 'OPD',
      encounterId: opts.encounterId,
      encounterLabel: opts.encounterLabel,
      patientName: opts.patientName,
      patientAge: opts.patientAge,
      patientAgeType: opts.patientAgeType,
      patientGender: opts.patientGender,
      patientAddress: opts.patientAddress,
      patientPhone: opts.patientPhone,
      patientEmail: '',
      referringDoctor: opts.referringDoctor,
      referralPartnerId: null,
      referralPartnerName: null,
      referralCommissionTotal: 0,
      collectionCenterId: opts.centerId,
      collectionCenterName: opts.centerName,
      priority: opts.priority || 'Routine',
      status: 'Ordered',
      orderedAt: now.toISOString(),
      collectedAt: null,
      receivedInLabAt: null,
      resultedAt: null,
      validatedAt: null,
      validatedById: null,
      validatedByName: null,
      validatedByDesignation: null,
      validatedByRegNo: null,
      dueAt: maxDueAt,
      subtotalAmount: total,
      discountAmount: 0,
      totalAmount: total,
      paidAmount: 0,
      dueAmount: total,
      paymentMode: 'Cash',
      cashPaid: 0,
      bankPaid: 0,
      creditOverrideApplied: false,
      emailSent: false,
      apiSent: false,
      tests: testItems,
    };
    db.orders.unshift(newOrder);
    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'CLINICAL_INVESTIGATION_ORDER_CREATED',
      accessionNumber,
      `Auto-created diagnostic order ${accessionNumber} (${services.map((s) => s.code).join(', ')}) for ${opts.patientName}.`
    );
    return newOrder;
  };

  // OPD: Register Visit (enforces opdFreeFollowUpDays free follow-up window)
  app.post('/api/opd/visits', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<OpdVisit> & { centerId?: string | null; forcePaid?: boolean };
    if (!body.patientName?.trim()) {
      res.status(400).json({ error: 'Patient name is required for OPD registration.' });
      return;
    }

    const ms = db.settings.moduleSettings;
    const freeDays = Math.max(0, ms?.opdFreeFollowUpDays ?? 5);
    const sameDoctorOnly = ms?.opdFollowUpSameDoctorOnly !== false;
    const withinWindowFee = Math.max(0, ms?.opdFollowUpWithinWindowFeeNpr ?? 0);
    const expiredFollowUpFee = Math.max(0, ms?.opdFollowUpFeeAfterExpiryNpr ?? 300);
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 30,
      ageType: body.patientAgeType || 'Years',
      gender: body.patientGender || 'Male',
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName,
    });

    const requestedDocNorm = (body.consultingDoctor?.trim() || actor.fullName).toLowerCase();
    const cleanPhoneReq = normalizeNepalPhone(body.patientPhone || patientRec.phone || '').replace(/\D/g, '');
    const patientPriorVisits = (db.opdVisits || [])
      .filter((v) => {
        if (patientRec.id && v.patientId === patientRec.id) return true;
        if (patientRec.uhid && v.uhid && v.uhid.toUpperCase() === patientRec.uhid.toUpperCase()) return true;
        const vPhone = (v.patientPhone || '').replace(/\D/g, '');
        return v.patientName.trim().toLowerCase() === patientRec.fullName.toLowerCase() && cleanPhoneReq && vPhone.endsWith(cleanPhoneReq.slice(-10));
      })
      .sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());

    const sameDoctorVisit = patientPriorVisits.find(
      (v) => (v.consultingDoctor || '').trim().toLowerCase() === requestedDocNorm
    );
    const matchedReferenceVisit = sameDoctorOnly ? sameDoctorVisit : (sameDoctorVisit || patientPriorVisits[0]);

    const nowIso = new Date().toISOString();
    const prevVisitMs = matchedReferenceVisit
      ? new Date(matchedReferenceVisit.visitDate).getTime()
      : (!sameDoctorOnly && patientRec.lastOpdVisitAt ? new Date(patientRec.lastOpdVisitAt).getTime() : 0);
    const daysSinceLast = prevVisitMs > 0 ? Math.floor((Date.now() - prevVisitMs) / 86400000) : 9999;
    const isReturningFollowUp = prevVisitMs > 0;
    const isWithinFollowUpRule = isReturningFollowUp && daysSinceLast <= freeDays;
    const isFreeFollowUp =
      typeof body.isFreeFollowUp === 'boolean'
        ? body.isFreeFollowUp
        : !body.forcePaid && isWithinFollowUpRule && withinWindowFee === 0;

    const rawFee =
      body.consultationFeeNpr !== undefined
        ? Number(body.consultationFeeNpr)
        : !body.forcePaid && isWithinFollowUpRule
        ? withinWindowFee
        : patientPriorVisits.length > 0 && daysSinceLast > freeDays
        ? expiredFollowUpFee
        : ms?.defaultOpdConsultationFeeNpr ?? 500;
    const fee = isFreeFollowUp ? 0 : Math.max(0, rawFee);

    const bsNow = adToBs(nowIso);
    const payMode: PaymentMode = body.paymentMode || 'Cash';
    const opdPfx = ms?.opdPrefix || 'OPD';
    const tokenNumber = `${opdPfx}-${bsNow.year}-${10 + (db.opdVisits || []).length + 1}`;
    const cTypeName =
      body.consultationTypeName?.trim() ||
      (isFreeFollowUp
        ? `Free Follow-Up (${sameDoctorOnly ? 'Same Dr · ' : ''}≤${freeDays}d)`
        : isWithinFollowUpRule
        ? `Rule Follow-Up (${sameDoctorOnly ? 'Same Dr · ' : ''}≤${freeDays}d)`
        : patientPriorVisits.length > 0
        ? `Paid Consultation (Different Dr / >${freeDays}d)`
        : 'New OPD Consultation');
    const encLabel = body.encounterLabel?.trim() || `${tokenNumber} · ${cTypeName}`;

    const visit: OpdVisit = {
      id: `opd-${Date.now()}`,
      tokenNumber,
      visitDate: nowIso,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      centerId: null,
      centerName: 'Saptari Hospital Pvt Ltd (Bode Barsain)',
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterLabel: encLabel,
      isFreeFollowUp,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: body.patientPhone?.trim() || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      department: body.department?.trim() || 'General Medicine OPD',
      consultingDoctor: body.consultingDoctor?.trim() || actor.fullName,
      chiefComplaint: body.chiefComplaint?.trim() || (isFreeFollowUp ? 'Scheduled follow-up review' : 'General medical evaluation'),
      vitals: body.vitals || {},
      provisionalDiagnosis: body.provisionalDiagnosis?.trim() || '',
      clinicalNotes: body.clinicalNotes?.trim() || '',
      consultationTypeName: cTypeName,
      consultationFeeNpr: fee,
      paymentMode: payMode,
      prescribedMedicines: [],
      investigations: [],
      disposition: 'Waiting',
      followUpAdvice: body.followUpAdvice?.trim() || '',
      recordedBy: actor.fullName,
    };

    patientRec.lastOpdVisitAt = nowIso;
    if (!Array.isArray(db.opdVisits)) db.opdVisits = [];
    db.opdVisits.unshift(visit);

    if (fee > 0 && (payMode === 'Cash' || payMode === 'Bank / QR')) {
      const targetAcc =
        payMode === 'Cash'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK');
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          fee,
          'POS_COLLECTION',
          tokenNumber,
          `OPD Consultation Fee ${tokenNumber} — ${visit.patientName}`,
          visit.fiscalYear,
          actor
        );
      }
    }

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'OPD_VISIT_REGISTERED',
      tokenNumber,
      `Registered OPD ${tokenNumber} for ${visit.patientName} (${patientRec.uhid})${isFreeFollowUp ? ' [FREE FOLLOW-UP]' : ` [रू ${fee}]`}.`
    );
    saveDb(db);
    res.status(201).json({ visit, patient: patientRec, db: scopeDbForActor(db, actor) });
  });

  // OPD: Update Consultation, Prescriptions, Investigations, or External Referral
  app.patch('/api/opd/visits/:id', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const visit = (db.opdVisits || []).find((v) => v.id === req.params.id);
    if (!visit) {
      res.status(404).json({ error: 'OPD visit not found.' });
      return;
    }
    if (actor.assignedCenterId && actor.roleId !== 'SUPER_ADMIN' && visit.centerId !== actor.assignedCenterId) {
      res.status(403).json({ error: 'Center Isolation: Cannot edit OPD visit outside your hub.' });
      return;
    }

    const body = req.body as Partial<OpdVisit> & {
      createDiagnosticOrder?: boolean;
      orderServiceIds?: string[];
    };

    if (body.disposition === 'Referred to External Hospital') {
      if (!body.externalReferral?.referredToHospital?.trim() || !body.externalReferral?.referredToPlace?.trim()) {
        res.status(400).json({
          error: 'Referred Hospital Name and Place / City are required for External Referral.',
        });
        return;
      }
    }

    if (body.vitals) visit.vitals = body.vitals;
    if (body.chiefComplaint !== undefined) visit.chiefComplaint = body.chiefComplaint;
    if (body.provisionalDiagnosis !== undefined) visit.provisionalDiagnosis = body.provisionalDiagnosis;
    if (body.clinicalNotes !== undefined) visit.clinicalNotes = body.clinicalNotes;
    if (body.followUpAdvice !== undefined) visit.followUpAdvice = body.followUpAdvice;
    if (body.consultingDoctor !== undefined) visit.consultingDoctor = body.consultingDoctor;
    if (body.department !== undefined) visit.department = body.department;
    if (Array.isArray(body.prescribedMedicines)) visit.prescribedMedicines = body.prescribedMedicines;
    if (Array.isArray(body.investigations)) visit.investigations = body.investigations;
    if (body.disposition) visit.disposition = body.disposition as OpdDispositionType;
    if (body.externalReferral) {
      const baseExt: ExternalReferralDetail = {
        ...body.externalReferral,
        referredAt: body.externalReferral.referredAt || new Date().toISOString(),
        referredBy: body.externalReferral.referredBy || actor.fullName,
      };
      visit.externalReferral = attachEncounterBillingAndClinicalHistory(db, {
        baseReferral: baseExt,
        patientId: visit.patientId,
        uhid: visit.uhid,
        patientName: visit.patientName,
        patientPhone: visit.patientPhone,
        encounterType: 'OPD',
        encounterId: visit.id,
        opdVisit: visit,
      });
    }

    let createdOrder: LabOrder | null = null;
    if (body.createDiagnosticOrder && Array.isArray(body.orderServiceIds) && body.orderServiceIds.length > 0) {
      createdOrder = createLinkedOrderFromClinical(db, actor, {
        centerId: visit.centerId,
        centerName: visit.centerName,
        patientName: visit.patientName,
        patientAge: visit.patientAge,
        patientAgeType: visit.patientAgeType,
        patientGender: visit.patientGender,
        patientPhone: visit.patientPhone,
        patientAddress: visit.patientAddress,
        referringDoctor: visit.consultingDoctor,
        serviceIds: body.orderServiceIds,
        priority: 'Routine',
      });
      if (createdOrder) {
        visit.investigations.forEach((inv) => {
          if (body.orderServiceIds!.includes(inv.serviceId || '') && !inv.linkedOrderId) {
            inv.linkedOrderId = createdOrder!.id;
            inv.linkedAccessionNumber = createdOrder!.accessionNumber;
          }
        });
      }
    }

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'OPD_CONSULTATION_UPDATED',
      visit.tokenNumber,
      `Updated OPD ${visit.tokenNumber} (${visit.patientName}) — Disposition: ${visit.disposition}${visit.externalReferral ? ` -> Referred to ${visit.externalReferral.referredToHospital}, ${visit.externalReferral.referredToPlace}` : ''}.`
    );
    saveDb(db);
    res.json({ visit, createdOrder, db: scopeDbForActor(db, actor) });
  });

  // IPD Beds: Create New Ward/Bed
  app.post('/api/ipd/beds', withAuth('hospital.manage', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<HospitalBed> & { bedNumber?: string; floor?: string };
    const resolvedBedCode = (body.bedCode || body.bedNumber || '').trim().toUpperCase();
    if (!resolvedBedCode || !body.wardName?.trim()) {
      res.status(400).json({ error: 'Ward name and bed code are required.' });
      return;
    }

    const effectiveCenterId = null;

    if (
      (db.hospitalBeds || []).some(
        (b) => b.bedCode.toLowerCase() === resolvedBedCode.toLowerCase()
      )
    ) {
      res.status(409).json({ error: `Bed ${resolvedBedCode} already exists in hospital.` });
      return;
    }

    const bed: HospitalBed = {
      id: `bed-${Date.now()}`,
      centerId: effectiveCenterId,
      centerName: 'Saptari Hospital Pvt Ltd (Bode Barsain)',
      wardName: body.wardName.trim(),
      wardType: (body.wardType as WardType) || 'General Ward',
      bedCode: resolvedBedCode,
      floorLabel: (body.floorLabel || body.floor || '1st Floor').trim(),
      dailyRateNpr: Math.max(0, Number(body.dailyRateNpr) || 1500),
      hasOxygen: body.hasOxygen !== false,
      hasMonitor: Boolean(body.hasMonitor),
      status: 'Available',
      currentAdmissionId: null,
      currentPatientName: null,
    };

    if (!Array.isArray(db.hospitalBeds)) db.hospitalBeds = [];
    db.hospitalBeds.push(bed);

    appendAudit(
      db,
      actor,
      'BED_MANAGEMENT',
      'HOSPITAL_BED_CREATED',
      bed.bedCode,
      `Added ${bed.wardType} bed ${bed.bedCode} in ${bed.wardName} (रू ${bed.dailyRateNpr}/day) @ ${bed.centerName}.`
    );
    saveDb(db);
    res.status(201).json({ bed, db: scopeDbForActor(db, actor) });
  });

  // IPD Beds: Update Bed Status (Mark Clean / Maintenance / Rate Edit)
  app.patch('/api/ipd/beds/:id', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const bed = (db.hospitalBeds || []).find((b) => b.id === req.params.id);
    if (!bed) {
      res.status(404).json({ error: 'Hospital bed not found.' });
      return;
    }
    if (actor.assignedCenterId && actor.roleId !== 'SUPER_ADMIN' && bed.centerId !== actor.assignedCenterId) {
      res.status(403).json({ error: 'Center Isolation: Cannot modify bed outside your hub.' });
      return;
    }
    const { status, dailyRateNpr, hasOxygen, hasMonitor } = req.body as Partial<HospitalBed>;
    if (bed.status === 'Occupied' && status && status !== 'Occupied') {
      res.status(409).json({
        error: `Bed ${bed.bedCode} is currently Occupied by ${bed.currentPatientName}. Discharge or transfer patient first.`,
      });
      return;
    }
    if (status) bed.status = status as BedStatus;
    if (dailyRateNpr !== undefined && hasPermission(db, actor.roleId, 'hospital.manage')) {
      bed.dailyRateNpr = Math.max(0, Number(dailyRateNpr));
    }
    if (hasOxygen !== undefined) bed.hasOxygen = Boolean(hasOxygen);
    if (hasMonitor !== undefined) bed.hasMonitor = Boolean(hasMonitor);

    appendAudit(
      db,
      actor,
      'BED_MANAGEMENT',
      'HOSPITAL_BED_UPDATED',
      bed.bedCode,
      `Bed ${bed.bedCode} status set to ${bed.status} (Rate: रू ${bed.dailyRateNpr}/day).`
    );
    saveDb(db);
    res.json({ bed, db: scopeDbForActor(db, actor) });
  });

  // IPD: Admit Patient to Bed (includes Admission Fee, Credit Limit & Admin Approval check)
  app.post('/api/ipd/admissions', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as {
      patientId?: string;
      uhid?: string;
      bedId: string;
      linkedOpdVisitId?: string;
      caseCategory?: IpdAdmission['caseCategory'];
      patientName: string;
      patientAge: number;
      patientAgeType?: AgeType;
      patientGender: PatientGender;
      patientPhone?: string;
      patientAddress?: string;
      emergencyContact?: string;
      admittingDoctor: string;
      department?: string;
      admittingDiagnosis: string;
      vitalsOnAdmission?: OpdVisit['vitals'];
      initialDepositNpr?: number;
      admissionFeeNpr?: number;
      admissionPaymentMode?: PaymentMode;
      creditLimitNpr?: number;
      depositPaymentMode?: PaymentMode;
    };

    if (!body.bedId || !body.patientName?.trim() || !body.admittingDiagnosis?.trim()) {
      res.status(400).json({ error: 'Available Bed, Patient Name, and Admitting Diagnosis are required.' });
      return;
    }

    const bed = (db.hospitalBeds || []).find((b) => b.id === body.bedId);
    if (!bed) {
      res.status(404).json({ error: 'Selected hospital bed not found.' });
      return;
    }
    if (bed.status !== 'Available') {
      res.status(409).json({ error: `Bed ${bed.bedCode} is ${bed.status}. Select an Available bed.` });
      return;
    }

    const ms = db.settings.moduleSettings;
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 35,
      ageType: body.patientAgeType || 'Years',
      gender: body.patientGender || 'Male',
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName,
    });

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const admNo = `${ms?.ipdPrefix || 'IPD'}-${bsNow.year}-${101 + (db.ipdAdmissions || []).length}`;
    const admReceiptNo = `IPD-ADM-${bsNow.year}-${101 + (db.ipdAdmissions || []).length}`;
    const admFee = body.admissionFeeNpr !== undefined ? Math.max(0, Number(body.admissionFeeNpr)) : ms?.ipdAdmissionFeeNpr ?? 1500;
    const admPayMode: PaymentMode = body.admissionPaymentMode || body.depositPaymentMode || 'Cash';
    const creditLimit = body.creditLimitNpr !== undefined ? Math.max(0, Number(body.creditLimitNpr)) : ms?.ipdDefaultCreditLimitNpr ?? 50000;
    const depositAmt = Math.max(0, Number(body.initialDepositNpr) || 0);
    const payMode: PaymentMode = body.depositPaymentMode || 'Cash';

    const deposits: IpdPaymentDeposit[] = [];
    if (depositAmt > 0) {
      const rcpNo = `IPD-RCP-${bsNow.year}-${201 + (db.ipdAdmissions || []).length}`;
      deposits.push({
        id: `dep-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: depositAmt,
        paymentMode: payMode,
        receiptNumber: rcpNo,
        notes: `Admission advance deposit for Bed ${bed.bedCode}`,
        receivedBy: actor.fullName,
      });

      const targetAcc =
        payMode === 'Bank / QR'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER');
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          depositAmt,
          'POS_COLLECTION',
          rcpNo,
          `IPD Admission Deposit ${admNo} (${patientRec.fullName})`,
          activeFy,
          actor
        );
      }
    }

    let carriedInvestigations: ClinicalInvestigationItem[] = [];
    if (body.linkedOpdVisitId) {
      const opd = (db.opdVisits || []).find((v) => v.id === body.linkedOpdVisitId);
      if (opd) {
        carriedInvestigations = JSON.parse(JSON.stringify(opd.investigations || []));
      }
    }

    const resolvedCategory: IpdAdmission['caseCategory'] =
      body.caseCategory ||
      (bed.wardType === 'ICU / HDU'
        ? 'ICU / Critical'
        : bed.wardType === 'Maternity'
        ? 'Maternity / OBG'
        : bed.wardType === 'NICU / Pediatric'
        ? 'Pediatric / NICU'
        : 'General Medical');

    const autoConsents = autoAssignConsents({
      context: 'IPD',
      caseCategory: resolvedCategory,
      wardName: bed.wardName,
      patientName: patientRec.fullName,
      guardianName: body.emergencyContact?.trim(),
      createdAt: nowIso,
    });

    const ipdIndividualBills: IpdIndividualCashBill[] = [];
    const admissionFeePaidAtAdmit = admFee > 0 && admPayMode !== 'Credit';
    if (admissionFeePaidAtAdmit) {
      ipdIndividualBills.push({
        id: `ipdbill-adm-${Date.now()}`,
        billNumber: admReceiptNo,
        billedAt: nowIso,
        billedById: actor.id,
        billedBy: actor.fullName,
        category: 'ADMISSION',
        itemLabel: `IPD Admission Charge (${bed.wardName} - ${bed.bedCode})`,
        amountNpr: admFee,
        paymentMode: admPayMode,
        notes: 'Instant admission bill paid at ward admission',
      });
      const admAcc =
        admPayMode === 'Bank / QR'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER');
      if (admAcc) {
        postLedgerMovement(
          db,
          admAcc,
          'INFLOW',
          admFee,
          'POS_COLLECTION',
          admReceiptNo,
          `IPD Admission Charge ${admNo} (${patientRec.fullName})`,
          activeFy,
          actor
        );
      }
    }

    const admission: IpdAdmission = {
      id: `ipd-${Date.now()}`,
      admissionNumber: admNo,
      admissionReceiptNumber: admReceiptNo,
      admissionPaymentMode: admPayMode,
      admissionFeePaidAtAdmit,
      fiscalYear: activeFy,
      admittedAt: nowIso,
      centerId: bed.centerId,
      centerName: bed.centerName,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterLabel: `${admNo} · ${bed.bedCode} (${bed.wardName})`,
      admissionFeeNpr: admFee,
      creditLimitNpr: creditLimit,
      creditApprovalStatus: 'WITHIN_LIMIT',
      linkedOpdVisitId: body.linkedOpdVisitId,
      caseCategory: resolvedCategory,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: body.patientPhone?.trim() || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      emergencyContact: body.emergencyContact?.trim() || '',
      admittingDoctor: body.admittingDoctor?.trim() || actor.fullName,
      department: body.department?.trim() || bed.wardName,
      currentBedId: bed.id,
      currentBedLabel: bed.bedCode,
      currentWardName: bed.wardName,
      bedDailyRateNpr: bed.dailyRateNpr,
      admittingDiagnosis: body.admittingDiagnosis.trim(),
      finalDiagnosis: '',
      hospitalCourseSummary: `Admitted to ${bed.wardName} Bed ${bed.bedCode}.`,
      vitalsOnAdmission: body.vitalsOnAdmission || {},
      progressNotes: [
        {
          id: `pn-${Date.now()}`,
          timestamp: nowIso,
          note: `Admitted to ${bed.wardName} (${bed.bedCode}) under ${body.admittingDoctor?.trim() || actor.fullName}. Admission Fee रू ${admFee.toLocaleString()} (${admPayMode}).`,
          recordedBy: actor.fullName,
        },
      ],
      nursingCharts: [],
      nursingObservationFees: [],
      marRecords: [],
      consents: autoConsents,
      bedTransfers: [],
      usedMedicines: [],
      investigationsDone: carriedInvestigations,
      directServiceCharges: [],
      ipdIndividualBills,
      deposits,
      disposition: 'Admitted',
      bedChargesNpr: bed.dailyRateNpr,
      bedDaysBilled: 1,
      doctorRoundsCount: ms?.ipdDoctorRoundBasis === 'PER_ROUND' ? (ms?.ipdDoctorRoundsPerDay || 1) : 1,
      doctorRoundFeeNpr: ms?.ipdDoctorRoundFeeNpr ?? 500,
      doctorRoundChargesNpr:
        (ms?.ipdDoctorRoundFeeNpr ?? 500) *
        (ms?.ipdDoctorRoundBasis === 'PER_ROUND' ? (ms?.ipdDoctorRoundsPerDay || 1) : 1),
      nursingDaysBilled: ms?.ipdNursingChargeBasis === 'PER_ROUND' ? (ms?.ipdNursingRoundsPerDay || 1) : 1,
      nursingChargePerDayNpr: ms?.ipdNursingChargePerDayNpr ?? 400,
      nursingChargesNpr:
        (ms?.ipdNursingChargePerDayNpr ?? 400) *
        (ms?.ipdNursingChargeBasis === 'PER_ROUND' ? (ms?.ipdNursingRoundsPerDay || 1) : 1),
      autoObservationDaysBilled: ms?.ipdObservationChargeBasis === 'PER_ROUND' ? (ms?.ipdObservationRoundsPerDay || 1) : 1,
      autoObservationFeePerDayNpr: ms?.ipdDailyObservationFeeNpr ?? 300,
      autoObservationChargesNpr:
        (ms?.ipdDailyObservationFeeNpr ?? 300) *
        (ms?.ipdObservationChargeBasis === 'PER_ROUND' ? (ms?.ipdObservationRoundsPerDay || 1) : 1),
      bedCycleWindowLabel: `${ms?.ipdBedCycleStartTime || '07:00'} - ${ms?.ipdBedCycleEndTime || '19:00'}`,
      nursingObservationChargesNpr: 0,
      medicinesTotalNpr: 0,
      investigationsTotalNpr: 0,
      otherProcedureChargesNpr: 0,
      totalBillNpr: 0,
      totalDepositPaidNpr: depositAmt,
      individualCashPaidTotalNpr: admissionFeePaidAtAdmit ? admFee : 0,
      balanceDueNpr: 0,
    };

    recalcIpdFinancials(admission, ms);
    bed.status = 'Occupied';
    bed.currentAdmissionId = admission.id;
    bed.currentPatientName = admission.patientName;

    if (body.linkedOpdVisitId) {
      const opd = (db.opdVisits || []).find((v) => v.id === body.linkedOpdVisitId);
      if (opd) {
        opd.disposition = 'Admitted to IPD';
        opd.linkedIpdAdmissionId = admission.id;
      }
    }

    if (!Array.isArray(db.ipdAdmissions)) db.ipdAdmissions = [];
    db.ipdAdmissions.unshift(admission);

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'IPD_PATIENT_ADMITTED',
      admNo,
      `Admitted ${admission.patientName} (${patientRec.uhid}) to ${bed.wardName} (${bed.bedCode}). Adm Fee रू ${admFee}, Credit Limit रू ${creditLimit}, Deposit रू ${depositAmt}.`
    );
    saveDb(db);
    res.status(201).json({ admission, patient: patientRec, db: scopeDbForActor(db, actor) });
  });

  // IPD: Admin Credit Limit Approval & Nursing MAR Administration
  app.post('/api/ipd/admissions/:id/approve-credit', withAuth('finance.approve_admin'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }
    const { newCreditLimitNpr, note } = (req.body || {}) as { newCreditLimitNpr?: number; note?: string };
    if (newCreditLimitNpr !== undefined && Number(newCreditLimitNpr) > 0) {
      adm.creditLimitNpr = Number(newCreditLimitNpr);
    }
    adm.creditApprovalStatus = 'APPROVED';
    adm.creditApprovedBy = actor.fullName;
    adm.creditApprovedAt = new Date().toISOString();
    adm.creditApprovalNote = note?.trim() || 'Admin extended IPD credit ceiling';
    appendAudit(db, actor, 'OPD_IPD', 'IPD_CREDIT_APPROVED', adm.admissionNumber, `Approved IPD credit extension for ${adm.patientName} (Limit रू ${(adm.creditLimitNpr || 0).toLocaleString()}).`, 'WARNING');
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/ipd/admissions/:id/mar', withAuth('hospital.clinical'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }
    const { medicineName, doseRoute, status, note } = req.body as Partial<IpdMarRecord>;
    if (!medicineName?.trim()) {
      res.status(400).json({ error: 'Medication name is required for MAR entry.' });
      return;
    }
    if (!Array.isArray(adm.marRecords)) adm.marRecords = [];
    const entry: IpdMarRecord = {
      id: `mar-${Date.now()}`,
      timestamp: new Date().toISOString(),
      medicineName: medicineName.trim(),
      doseRoute: doseRoute?.trim() || 'IV / Oral as ordered',
      givenBy: actor.fullName,
      status: status || 'Given',
      note: note?.trim() || '',
    };
    adm.marRecords.unshift(entry);
    appendAudit(db, actor, 'NURSING_CHART', 'MAR_RECORDED', adm.admissionNumber, `MAR ${entry.status}: ${entry.medicineName} (${entry.doseRoute}) for ${adm.patientName}.`);
    saveDb(db);
    res.status(201).json({ entry, admission: adm, db: scopeDbForActor(db, actor) });
  });

  // IPD: Internal Bed / Ward Transfer
  app.post('/api/ipd/admissions/:id/transfer-bed', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission record not found.' });
      return;
    }
    if (adm.disposition !== 'Admitted') {
      res.status(409).json({ error: 'Cannot transfer bed for a finalized/discharged admission.' });
      return;
    }
    const { targetBedId, reason } = req.body as { targetBedId: string; reason: string };
    const newBed = (db.hospitalBeds || []).find((b) => b.id === targetBedId);
    if (!newBed) {
      res.status(404).json({ error: 'Target bed not found.' });
      return;
    }
    if (newBed.centerId !== adm.centerId) {
      res.status(403).json({ error: 'Internal bed transfer must be within the same hospital hub.' });
      return;
    }
    if (newBed.status !== 'Available') {
      res.status(409).json({ error: `Target bed ${newBed.bedCode} is ${newBed.status}.` });
      return;
    }

    const oldBed = (db.hospitalBeds || []).find((b) => b.id === adm.currentBedId);
    const nowIso = new Date().toISOString();

    const transferRecord: BedTransferRecord = {
      id: `btr-${Date.now()}`,
      transferredAt: nowIso,
      fromBedId: adm.currentBedId,
      fromBedLabel: `${adm.currentBedLabel} (${adm.currentWardName})`,
      toBedId: newBed.id,
      toBedLabel: `${newBed.bedCode} (${newBed.wardName})`,
      reason: reason?.trim() || 'Clinical escalation / ward transfer',
      authorizedBy: actor.fullName,
    };

    if (oldBed) {
      oldBed.status = db.settings.moduleSettings?.markBedCleaningOnDischarge !== false ? 'Cleaning' : 'Available';
      oldBed.currentAdmissionId = null;
      oldBed.currentPatientName = null;
    }

    newBed.status = 'Occupied';
    newBed.currentAdmissionId = adm.id;
    newBed.currentPatientName = adm.patientName;

    adm.bedTransfers.push(transferRecord);
    adm.currentBedId = newBed.id;
    adm.currentBedLabel = newBed.bedCode;
    adm.currentWardName = newBed.wardName;
    adm.bedDailyRateNpr = newBed.dailyRateNpr;
    adm.progressNotes.unshift({
      id: `pn-${Date.now()}`,
      timestamp: nowIso,
      note: `Bed Transfer: Moved from ${transferRecord.fromBedLabel} to ${transferRecord.toBedLabel}. Reason: ${transferRecord.reason}`,
      recordedBy: actor.fullName,
    });

    appendAudit(
      db,
      actor,
      'BED_MANAGEMENT',
      'IPD_BED_TRANSFERRED',
      adm.admissionNumber,
      `Transferred ${adm.patientName} (${adm.admissionNumber}) from ${transferRecord.fromBedLabel} to ${transferRecord.toBedLabel}.`
    );
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });

  // IPD: Administer / Log Used Medicine (with optional Pharmacy FEFO batch auto-deduction)
  app.post('/api/ipd/admissions/:id/medicines', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission record not found.' });
      return;
    }

    const {
      medicineId,
      customMedicineName,
      dosageRoute,
      quantity,
      unitPriceNpr,
      deductFromPharmacyFefo = true,
    } = req.body as {
      medicineId?: string;
      customMedicineName?: string;
      dosageRoute: string;
      quantity: number;
      unitPriceNpr?: number;
      deductFromPharmacyFefo?: boolean;
    };

    const qty = Math.max(1, Number(quantity) || 1);
    const med = medicineId ? db.pharmacyMedicines.find((m) => m.id === medicineId) : undefined;
    if (!med && !customMedicineName?.trim()) {
      res.status(400).json({ error: 'Select a medicine from Pharmacy Master or enter a medicine name.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);
    const createdItems: ClinicalUsedMedicineItem[] = [];

    if (med && deductFromPharmacyFefo) {
      const candidateBatches = db.pharmacyBatches
        .filter((b) => {
          if (b.medicineId !== med.id) return false;
          if (b.centerId !== adm.centerId) return false;
          if (b.quarantined || b.quantityOnHand <= 0) return false;
          if (b.expiryDate < todayIso) return false;
          return true;
        })
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));

      const totalAvail = candidateBatches.reduce((s, b) => s + b.quantityOnHand, 0);
      if (totalAvail >= qty) {
        let remaining = qty;
        for (const batch of candidateBatches) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, batch.quantityOnHand);
          remaining -= take;
          batch.quantityOnHand = Math.max(0, batch.quantityOnHand - take);
          const price = unitPriceNpr !== undefined ? Number(unitPriceNpr) : batch.mrpNpr;
          createdItems.push({
            id: `ium-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            administeredAt: nowIso,
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            genericName: med.genericName,
            dosageRoute: dosageRoute?.trim() || 'As charted',
            quantity: take,
            unitPriceNpr: price,
            totalPriceNpr: Number((take * price).toFixed(2)),
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            deductedFromPharmacyFefo: true,
            administeredBy: actor.fullName,
          });
          db.pharmacyMovements.unshift({
            id: `pmov-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            timestamp: nowIso,
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            centerId: adm.centerId,
            type: 'FEFO_DISPENSE',
            quantityDelta: -take,
            balanceAfter: batch.quantityOnHand,
            referenceId: adm.admissionNumber,
            performedBy: actor.fullName,
            notes: `IPD Ward FEFO Administration to ${adm.patientName} (Bed ${adm.currentBedLabel})`,
          });
        }
      }
    }

    // Fallback: record without FEFO stock deduction if hub pharmacy batch wasn't stocked or toggle off
    if (createdItems.length === 0) {
      const price = unitPriceNpr !== undefined ? Number(unitPriceNpr) : med?.defaultMrpNpr ?? 0;
      createdItems.push({
        id: `ium-${Date.now()}`,
        administeredAt: nowIso,
        medicineId: med?.id,
        medicineName: med ? `${med.brandName} ${med.strength}` : customMedicineName!.trim(),
        genericName: med?.genericName,
        dosageRoute: dosageRoute?.trim() || 'As charted',
        quantity: qty,
        unitPriceNpr: price,
        totalPriceNpr: Number((qty * price).toFixed(2)),
        deductedFromPharmacyFefo: false,
        administeredBy: actor.fullName,
      });
    }

    adm.usedMedicines.push(...createdItems);
    recalcIpdFinancials(adm, db.settings?.moduleSettings);

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'IPD_MEDICINE_ADMINISTERED',
      adm.admissionNumber,
      `Logged ${createdItems.map((i) => `${i.medicineName} x${i.quantity}`).join(', ')} for ${adm.patientName}.`
    );
    saveDb(db);
    res.status(201).json({ admission: adm, items: createdItems, db: scopeDbForActor(db, actor) });
  });

  // IPD: Add Investigation Done / Order Linked Lab & Radiology Test
  app.post('/api/ipd/admissions/:id/investigations', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission record not found.' });
      return;
    }

    const {
      serviceId,
      customServiceName,
      category,
      status,
      summaryFinding,
      priceNpr,
      createDiagnosticOrder = true,
    } = req.body as {
      serviceId?: string;
      customServiceName?: string;
      category?: 'PATHOLOGY' | 'RADIOLOGY';
      status?: 'Ordered' | 'Sample Collected' | 'Completed';
      summaryFinding?: string;
      priceNpr?: number;
      createDiagnosticOrder?: boolean;
    };

    const srv = serviceId ? db.services.find((s) => s.id === serviceId) : undefined;
    if (!srv && !customServiceName?.trim()) {
      res.status(400).json({ error: 'Select a test/imaging study from Service Master or enter an investigation name.' });
      return;
    }

    let linkedOrder: LabOrder | null = null;
    if (srv && createDiagnosticOrder) {
      linkedOrder = createLinkedOrderFromClinical(db, actor, {
        centerId: adm.centerId,
        centerName: adm.centerName,
        patientName: adm.patientName,
        patientAge: adm.patientAge,
        patientAgeType: adm.patientAgeType,
        patientGender: adm.patientGender,
        patientPhone: adm.patientPhone,
        patientAddress: adm.patientAddress,
        referringDoctor: adm.admittingDoctor,
        serviceIds: [srv.id],
        priority: 'STAT',
      });
    }

    const invItem: ClinicalInvestigationItem = {
      id: `iinv-${Date.now()}`,
      orderedAt: new Date().toISOString(),
      serviceId: srv?.id,
      serviceCode: srv?.code || 'EXT-INV',
      serviceName: srv?.name || customServiceName!.trim(),
      category: srv ? (srv.serviceCategory || (srv.department === 'Radiology' ? 'RADIOLOGY' : 'PATHOLOGY')) : (category || 'PATHOLOGY'),
      linkedOrderId: linkedOrder?.id,
      linkedAccessionNumber: linkedOrder?.accessionNumber,
      status: status || (linkedOrder ? 'Ordered' : 'Completed'),
      summaryFinding: summaryFinding?.trim() || '',
      priceNpr: priceNpr !== undefined ? Number(priceNpr) : srv?.price ?? 0,
    };

    adm.investigationsDone.push(invItem);
    recalcIpdFinancials(adm, db.settings?.moduleSettings);

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'IPD_INVESTIGATION_LOGGED',
      adm.admissionNumber,
      `Logged IPD investigation ${invItem.serviceCode} (${invItem.serviceName}) for ${adm.patientName}.`
    );
    saveDb(db);
    res.status(201).json({ admission: adm, investigation: invItem, linkedOrder, db: scopeDbForActor(db, actor) });
  });

  // IPD: Add Interim Cash/Bank Deposit or Clinical Progress Note
  app.post('/api/ipd/admissions/:id/deposit', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }
    const { amountNpr, paymentMode, notes, progressNote, shift, roundTime } = req.body as {
      amountNpr?: number;
      paymentMode?: PaymentMode;
      notes?: string;
      progressNote?: string;
      shift?: string;
      roundTime?: string;
    };

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);

    if (progressNote?.trim()) {
      adm.progressNotes.unshift({
        id: `pn-${Date.now()}`,
        timestamp: nowIso,
        note: progressNote.trim(),
        shift: shift || actor.shift || 'Morning',
        roundTime: roundTime || bsNow.timeEn,
        recordedBy: actor.fullName,
      });
    }

    const amt = Number(amountNpr) || 0;
    if (amt > 0) {
      const mode: PaymentMode = paymentMode || 'Cash';
      const rcpNo = `IPD-RCP-${bsNow.year}-${201 + adm.deposits.length + db.ipdAdmissions.length}`;
      adm.deposits.push({
        id: `dep-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: amt,
        paymentMode: mode,
        receiptNumber: rcpNo,
        notes: notes?.trim() || 'Interim IPD deposit',
        receivedBy: actor.fullName,
      });
      const targetAcc =
        mode === 'Bank / QR'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER');
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          amt,
          'POS_COLLECTION',
          rcpNo,
          `IPD Interim Deposit ${adm.admissionNumber} (${adm.patientName})`,
          adm.fiscalYear,
          actor
        );
      }
      recalcIpdFinancials(adm, db.settings?.moduleSettings);
    }

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      amt > 0 ? 'IPD_DEPOSIT_RECEIVED' : 'IPD_PROGRESS_NOTE_ADDED',
      adm.admissionNumber,
      amt > 0
        ? `Received रू ${amt.toLocaleString()} IPD deposit for ${adm.patientName}.`
        : `Added clinical progress note for ${adm.patientName}.`
    );
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });

  // IPD: Add Direct Service/Bed Charge (Cash or Credit) OR Settle Any Individual Unpaid Line Item as a Cash Bill
  app.post('/api/ipd/admissions/:id/pay-item', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }

    const {
      mode = 'SETTLE_EXISTING',
      category = 'PROCEDURE',
      shift,
      itemLabel,
      amountNpr,
      paymentMode = 'Cash',
      referenceItemId,
      notes,
    } = req.body as {
      mode?: 'SETTLE_EXISTING' | 'ADD_CHARGE';
      category?: IpdIndividualCashBill['category'];
      shift?: 'Morning' | 'Afternoon' | 'Night';
      itemLabel: string;
      amountNpr: number;
      paymentMode?: 'Cash' | 'Bank / QR' | 'Credit';
      referenceItemId?: string;
      notes?: string;
    };

    const amt = Number(Number(amountNpr || 0).toFixed(2));
    if (!itemLabel?.trim() || amt <= 0) {
      res.status(400).json({ error: 'Item description and positive amount (रू) are required.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    if (!Array.isArray(adm.ipdIndividualBills)) adm.ipdIndividualBills = [];
    if (!Array.isArray(adm.directServiceCharges)) adm.directServiceCharges = [];

    let cashBill: IpdIndividualCashBill | null = null;
    const billNo = `IPD-CSH-${bsNow.year}-${101 + adm.ipdIndividualBills.length + db.ipdAdmissions.length}`;
    const normalizedShift: 'Morning' | 'Afternoon' | 'Night' | undefined =
      shift === 'Morning' || shift === 'Afternoon' || shift === 'Night' ? shift : undefined;

    if (mode === 'ADD_CHARGE') {
      const chargeCat: IpdDirectServiceCharge['category'] =
        category === 'BED_STAY' || category === 'NURSING' || category === 'OBSERVATION' || category === 'DOCTOR_ROUND'
          ? category
          : 'PROCEDURE';
      adm.directServiceCharges.unshift({
        id: `ichg-${Date.now()}`,
        billedAt: nowIso,
        billedBy: actor.fullName,
        serviceName: itemLabel.trim(),
        category: chargeCat,
        shift: normalizedShift,
        amountNpr: amt,
        paymentMode: paymentMode === 'Credit' ? 'Credit' : paymentMode,
        cashBillNumber: paymentMode === 'Credit' ? undefined : billNo,
        notes: notes?.trim(),
      });
    }

    if (paymentMode !== 'Credit') {
      cashBill = {
        id: `ipdbill-${Date.now()}`,
        billNumber: billNo,
        billedAt: nowIso,
        billedById: actor.id,
        billedBy: actor.fullName,
        category,
        shift: normalizedShift,
        itemLabel: itemLabel.trim(),
        referenceItemId,
        amountNpr: amt,
        paymentMode,
        notes: notes?.trim() || (mode === 'ADD_CHARGE' ? 'Direct IPD cash service bill' : 'One-by-one individual cash settlement'),
      };
      adm.ipdIndividualBills.unshift(cashBill);

      const targetAcc =
        paymentMode === 'Bank / QR'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER');
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          amt,
          'POS_COLLECTION',
          billNo,
          `IPD Cash Bill ${billNo}: ${itemLabel.trim()}${normalizedShift ? ` [${normalizedShift} Shift]` : ''} (${adm.patientName})`,
          adm.fiscalYear,
          actor
        );
      }
    }

    recalcIpdFinancials(adm, db.settings?.moduleSettings);
    appendAudit(
      db,
      actor,
      'OPD_IPD',
      paymentMode === 'Credit' ? 'IPD_SERVICE_CREDIT_POSTED' : 'IPD_INDIVIDUAL_CASH_BILL',
      cashBill ? cashBill.billNumber : adm.admissionNumber,
      paymentMode === 'Credit'
        ? `Posted IPD credit service "${itemLabel.trim()}"${normalizedShift ? ` (${normalizedShift} shift)` : ''} (रू ${amt.toLocaleString()}) on ${adm.admissionNumber}.`
        : `Issued IPD Individual Cash Bill ${billNo} (${paymentMode}) for "${itemLabel.trim()}"${normalizedShift ? ` (${normalizedShift} shift)` : ''} रू ${amt.toLocaleString()} (${adm.patientName}).`
    );
    saveDb(db);
    res.status(201).json({ cashBill, admission: adm, db: scopeDbForActor(db, actor) });
  });

  // IPD: Finalize Deposition (Discharge / Transfer / External Hospital Referral / LAMA)
  app.post('/api/ipd/admissions/:id/deposition', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }

    const {
      disposition,
      finalDiagnosis,
      hospitalCourseSummary,
      dischargeCondition,
      dischargeAdvice,
      followUpDateBs,
      bedDaysBilled,
      doctorRoundsCount,
      nursingDaysBilled,
      observationDaysBilled,
      otherProcedureChargesNpr,
      finalSettlementAmountNpr,
      settlementPaymentMode,
      externalReferral,
    } = req.body as {
      disposition: IpdDispositionType;
      finalDiagnosis: string;
      hospitalCourseSummary: string;
      dischargeCondition: string;
      dischargeAdvice: string;
      followUpDateBs?: string;
      bedDaysBilled?: number;
      doctorRoundsCount?: number;
      nursingDaysBilled?: number;
      observationDaysBilled?: number;
      otherProcedureChargesNpr?: number;
      finalSettlementAmountNpr?: number;
      settlementPaymentMode?: PaymentMode;
      externalReferral?: ExternalReferralDetail;
    };

    if (!disposition || disposition === 'Admitted') {
      res.status(400).json({ error: 'Select a valid Deposition outcome (Discharged / Referred to External Hospital / LAMA / Transfer).' });
      return;
    }
    if (disposition === 'Referred to External Hospital' || disposition === 'Transferred to Ward/Hub') {
      if (!externalReferral?.referredToHospital?.trim() || !externalReferral?.referredToPlace?.trim()) {
        res.status(400).json({
          error: 'Referred Hospital/Facility Name and Place / City are mandatory when referring or transferring out.',
        });
        return;
      }
    }

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const ms = db.settings?.moduleSettings;
    const cycleStart = ms?.ipdBedCycleStartTime || '07:00';
    const cycleEnd = ms?.ipdBedCycleEndTime || '19:00';
    const autoDays = calculateAutoBedDays(adm.admittedAt, nowIso, cycleStart, cycleEnd);
    const days = Math.max(1, bedDaysBilled !== undefined ? Number(bedDaysBilled) || autoDays : autoDays);
    const rounds = Math.max(0, doctorRoundsCount !== undefined ? Number(doctorRoundsCount) : days);
    const nursingDays = Math.max(0, nursingDaysBilled !== undefined ? Number(nursingDaysBilled) : days);
    const obsDays = Math.max(0, observationDaysBilled !== undefined ? Number(observationDaysBilled) : days);
    const roundFee = ms?.ipdDoctorRoundFeeNpr ?? 500;
    const nursingFee = ms?.ipdNursingChargePerDayNpr ?? 400;
    const obsFee = ms?.ipdDailyObservationFeeNpr ?? 300;

    adm.bedDaysBilled = days;
    adm.bedChargesNpr = Number((days * adm.bedDailyRateNpr).toFixed(2));
    adm.doctorRoundsCount = rounds;
    adm.doctorRoundFeeNpr = roundFee;
    adm.doctorRoundChargesNpr = Number((rounds * roundFee).toFixed(2));
    adm.nursingDaysBilled = nursingDays;
    adm.nursingChargePerDayNpr = nursingFee;
    adm.nursingChargesNpr = Number((nursingDays * nursingFee).toFixed(2));
    adm.autoObservationDaysBilled = obsDays;
    adm.autoObservationFeePerDayNpr = obsFee;
    adm.autoObservationChargesNpr = Number((obsDays * obsFee).toFixed(2));
    adm.bedCycleWindowLabel = `${cycleStart} - ${cycleEnd}`;

    if (otherProcedureChargesNpr !== undefined) {
      adm.otherProcedureChargesNpr = Math.max(0, Number(otherProcedureChargesNpr) || 0);
    }

    const settleAmt = Math.max(0, Number(finalSettlementAmountNpr) || 0);
    if (settleAmt > 0) {
      const mode: PaymentMode = settlementPaymentMode || 'Cash';
      const rcpNo = `IPD-SET-${bsNow.year}-${301 + adm.deposits.length + db.ipdAdmissions.length}`;
      adm.deposits.push({
        id: `dep-set-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: settleAmt,
        paymentMode: mode,
        receiptNumber: rcpNo,
        notes: `Final Deposition Settlement (${disposition})`,
        receivedBy: actor.fullName,
      });
      const targetAcc =
        mode === 'Bank / QR'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER');
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          settleAmt,
          'POS_COLLECTION',
          rcpNo,
          `IPD Final Settlement ${adm.admissionNumber} (${adm.patientName})`,
          adm.fiscalYear,
          actor
        );
      }
    }

    adm.disposition = disposition;
    adm.finalDiagnosis = finalDiagnosis?.trim() || adm.admittingDiagnosis;
    adm.hospitalCourseSummary = hospitalCourseSummary?.trim() || adm.hospitalCourseSummary;
    adm.dischargeCondition = dischargeCondition?.trim() || 'Stable';
    adm.dischargeAdvice = dischargeAdvice?.trim() || '';
    adm.followUpDateBs = followUpDateBs?.trim() || '';
    adm.dischargedAt = nowIso;
    adm.dischargedBy = actor.fullName;

    if (externalReferral) {
      const baseExt: ExternalReferralDetail = {
        ...externalReferral,
        referredAt: externalReferral.referredAt || nowIso,
        referredBy: externalReferral.referredBy || actor.fullName,
      };
      adm.externalReferral = attachEncounterBillingAndClinicalHistory(db, {
        baseReferral: baseExt,
        patientId: adm.patientId,
        uhid: adm.uhid,
        patientName: adm.patientName,
        patientPhone: adm.patientPhone,
        encounterType: 'IPD',
        encounterId: adm.id,
        admission: adm,
      });
    }

    recalcIpdFinancials(adm, ms, {
      bedDaysBilled: days,
      doctorRoundsCount: rounds,
      nursingDaysBilled: nursingDays,
      observationDaysBilled: obsDays,
    });

    // Release currently occupied bed & auto-assign LAMA/Referral consent if applicable
    const currentBed = (db.hospitalBeds || []).find((b) => b.id === adm.currentBedId);
    if (currentBed) {
      currentBed.status =
        db.settings.moduleSettings?.markBedCleaningOnDischarge !== false ? 'Cleaning' : 'Available';
      currentBed.currentAdmissionId = null;
      currentBed.currentPatientName = null;
    }

    if (!Array.isArray(adm.consents)) adm.consents = [];
    if (disposition === 'LAMA / DOR' && !adm.consents.some((c) => c.consentType === 'LAMA_DOR_RISK')) {
      const def = CONSENT_CATALOG.LAMA_DOR_RISK;
      adm.consents.push({
        id: `cns-lama-${Date.now()}`,
        consentCode: `CNS-LAM-${Math.floor(100 + Math.random() * 899)}`,
        consentType: 'LAMA_DOR_RISK',
        title: def.title,
        autoReason: def.caseTriggerRule,
        summaryText: def.summaryText,
        patientOrGuardianName: adm.emergencyContact || adm.patientName,
        relationship: 'Attendant',
        witnessName: '',
        status: 'Auto-Assigned (Pending Signature)',
        createdAt: nowIso,
      });
    }
    if (
      disposition === 'Referred to External Hospital' &&
      !adm.consents.some((c) => c.consentType === 'EXTERNAL_REFERRAL_TRANSPORT')
    ) {
      const def = CONSENT_CATALOG.EXTERNAL_REFERRAL_TRANSPORT;
      adm.consents.push({
        id: `cns-ref-${Date.now()}`,
        consentCode: `CNS-REF-${Math.floor(100 + Math.random() * 899)}`,
        consentType: 'EXTERNAL_REFERRAL_TRANSPORT',
        title: def.title,
        autoReason: def.caseTriggerRule,
        summaryText: def.summaryText,
        patientOrGuardianName: adm.emergencyContact || adm.patientName,
        relationship: 'Attendant',
        witnessName: '',
        status: 'Auto-Assigned (Pending Signature)',
        createdAt: nowIso,
      });
    }

    appendAudit(
      db,
      actor,
      'OPD_IPD',
      'IPD_DEPOSITION_FINALIZED',
      adm.admissionNumber,
      `Finalized IPD Deposition for ${adm.patientName} (${adm.admissionNumber}): ${disposition}${adm.externalReferral ? ` to ${adm.externalReferral.referredToHospital}, ${adm.externalReferral.referredToPlace}` : ''}. Total Bill: रू ${adm.totalBillNpr.toLocaleString()}.`,
      disposition === 'Referred to External Hospital' ? 'WARNING' : 'INFO'
    );
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });

  // IPD Nursing Chart Entry (TPR / Vitals / Intake-Output / Shift Remarks)
  app.post('/api/ipd/admissions/:id/nursing-chart', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }
    const body = req.body as Partial<NursingChartEntry>;
    const nowIso = new Date().toISOString();
    const entry: NursingChartEntry = {
      id: `nc-${Date.now()}`,
      recordedAt: nowIso,
      shift: body.shift || 'Morning',
      bp: body.bp?.trim() || '120/80',
      pulseBpm: body.pulseBpm !== undefined ? Number(body.pulseBpm) : 78,
      tempF: body.tempF !== undefined ? Number(body.tempF) : 98.6,
      spo2Pct: body.spo2Pct !== undefined ? Number(body.spo2Pct) : 98,
      respRate: body.respRate !== undefined ? Number(body.respRate) : 18,
      painScore: body.painScore !== undefined ? Number(body.painScore) : 2,
      gcsScore: body.gcsScore?.trim() || '15/15',
      intakeOralMl: Number(body.intakeOralMl) || 0,
      intakeIvMl: Number(body.intakeIvMl) || 0,
      outputUrineMl: Number(body.outputUrineMl) || 0,
      outputDrainMl: Number(body.outputDrainMl) || 0,
      nursingCareNote: body.nursingCareNote?.trim() || 'Routine shift nursing round & medication administration completed.',
      recordedBy: actor.fullName,
    };
    if (!Array.isArray(adm.nursingCharts)) adm.nursingCharts = [];
    adm.nursingCharts.unshift(entry);
    const totalIn = (entry.intakeOralMl || 0) + (entry.intakeIvMl || 0);
    const totalOut = (entry.outputUrineMl || 0) + (entry.outputDrainMl || 0);
    appendAudit(
      db,
      actor,
      'NURSING_CHART',
      'NURSING_CHART_LOGGED',
      adm.admissionNumber,
      `Logged ${entry.shift} shift nursing chart for ${adm.patientName} (BP ${entry.bp}, SpO2 ${entry.spo2Pct}%, I/O ${totalIn}/${totalOut} mL).`
    );
    saveDb(db);
    res.status(201).json({ entry, admission: adm, db: scopeDbForActor(db, actor) });
  });

  // IPD Nursing Round & Observation Fee Entry (Type, Time, Shift, Fee)
  app.post('/api/ipd/admissions/:id/nursing-observation', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: 'IPD admission not found.' });
      return;
    }
    const { observationType, roundTime, shift, durationHours, feeNpr, nurseName, notes } = req.body as {
      observationType: string;
      roundTime?: string;
      shift?: NursingObservationFeeEntry['shift'];
      durationHours?: number;
      feeNpr: number;
      nurseName?: string;
      notes?: string;
    };
    if (!observationType?.trim()) {
      res.status(400).json({ error: 'Observation / Nursing Round type is required.' });
      return;
    }
    const fee = Math.max(0, Number(feeNpr) || 0);
    if (!Array.isArray(adm.nursingObservationFees)) adm.nursingObservationFees = [];
    const nowIso = new Date().toISOString();
    const obsEntry: NursingObservationFeeEntry = {
      id: `nobs-${Date.now()}`,
      recordedAt: nowIso,
      roundTime: roundTime?.trim() || new Date().toTimeString().slice(0, 5),
      shift: shift || 'Morning',
      observationType: observationType.trim(),
      durationHours: durationHours !== undefined ? Number(durationHours) : undefined,
      feeNpr: fee,
      nurseName: nurseName?.trim() || actor.fullName,
      notes: notes?.trim() || '',
      recordedBy: actor.fullName,
    };
    adm.nursingObservationFees.unshift(obsEntry);
    adm.nursingObservationChargesNpr = Number(
      adm.nursingObservationFees.reduce((s, item) => s + (Number(item.feeNpr) || 0), 0).toFixed(2)
    );
    recalcIpdFinancials(adm, db.settings?.moduleSettings);

    appendAudit(
      db,
      actor,
      'NURSING_CHART',
      'NURSING_OBSERVATION_FEE_LOGGED',
      adm.admissionNumber,
      `Logged ${obsEntry.observationType} (${obsEntry.shift} shift @ ${obsEntry.roundTime}) — रू ${fee.toLocaleString()} for ${adm.patientName}.`
    );
    saveDb(db);
    res.status(201).json({ entry: obsEntry, admission: adm, db: scopeDbForActor(db, actor) });
  });

  // Rapid Quick Round Note + Vitals Entry (IPD / OPD / ER) with Auto-Flag Abnormal Readings for Immediate Doctor Notification
  app.post('/api/clinical/quick-round-note', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const canClinical =
      hasPermission(db, actor.roleId, 'hospital.clinical') ||
      hasPermission(db, actor.roleId, 'nursing.view') ||
      hasPermission(db, actor.roleId, 'doctor.view') ||
      hasPermission(db, actor.roleId, 'emergency.manage');
    if (!canClinical) {
      res.status(403).json({ error: 'Access denied: Clinical, nursing, or physician permission required.' });
      return;
    }

    const {
      encounterType,
      encounterId,
      shift = 'Morning',
      bp,
      pulseBpm,
      tempF,
      spo2Pct,
      respRate,
      medicationNote,
      autoFlagAbnormalDoctor = true,
    } = req.body as {
      encounterType: 'IPD' | 'OPD' | 'ER';
      encounterId: string;
      shift?: 'Morning' | 'Afternoon' | 'Night';
      bp?: string;
      pulseBpm?: number;
      tempF?: number;
      spo2Pct?: number;
      respRate?: number;
      medicationNote: string;
      autoFlagAbnormalDoctor?: boolean;
    };

    if (!encounterId || !medicationNote?.trim()) {
      res.status(400).json({ error: 'Encounter ID and clinical / medication round note are required.' });
      return;
    }

    const abnormalReasons: string[] = [];
    if (bp?.includes('/')) {
      const [sysRaw, diaRaw] = bp.split('/').map((x) => Number(x.trim()));
      if (Number.isFinite(sysRaw) && (sysRaw >= 140 || sysRaw <= 90)) {
        abnormalReasons.push(`BP ${bp} mmHg`);
      } else if (Number.isFinite(diaRaw) && (diaRaw >= 90 || diaRaw <= 60)) {
        abnormalReasons.push(`BP ${bp} mmHg`);
      }
    }
    if (pulseBpm !== undefined && pulseBpm !== null && (Number(pulseBpm) > 110 || Number(pulseBpm) < 55)) {
      abnormalReasons.push(`Pulse ${pulseBpm} bpm`);
    }
    if (tempF !== undefined && tempF !== null && (Number(tempF) >= 100.4 || Number(tempF) < 95.5)) {
      abnormalReasons.push(`Temp ${tempF}°F`);
    }
    if (spo2Pct !== undefined && spo2Pct !== null && Number(spo2Pct) < 94) {
      abnormalReasons.push(`SpO2 ${spo2Pct}%`);
    }
    if (respRate !== undefined && respRate !== null && (Number(respRate) > 24 || Number(respRate) < 12)) {
      abnormalReasons.push(`RR ${respRate}/min`);
    }

    const isAbnormal = abnormalReasons.length > 0;
    const doctorFlagged = Boolean(autoFlagAbnormalDoctor && isAbnormal);
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const cleanNote = medicationNote.trim();
    const formattedStampNote = `[Quick Round @ ${bsNow.formattedEn} ${bsNow.timeEn} · ${actor.fullName}] Vitals: BP ${bp || '—'}, PR ${pulseBpm ?? '—'}, T ${tempF ?? '—'}°F, SpO2 ${spo2Pct ?? '—'}%, RR ${respRate ?? '—'} | ${cleanNote}${doctorFlagged ? ` [URGENT DOCTOR ALERT: ${abnormalReasons.join(', ')}]` : ''}`;

    let patientLabel = '';
    let refCode = '';

    if (encounterType === 'IPD') {
      const adm = (db.ipdAdmissions || []).find((a) => a.id === encounterId);
      if (!adm) {
        res.status(404).json({ error: 'IPD admission not found.' });
        return;
      }
      if (!Array.isArray(adm.nursingCharts)) adm.nursingCharts = [];
      adm.nursingCharts.unshift({
        id: `nc-qr-${Date.now()}`,
        recordedAt: nowIso,
        shift,
        bp: bp?.trim() || adm.vitalsOnAdmission?.bp || '120/80',
        pulseBpm: pulseBpm !== undefined ? Number(pulseBpm) : adm.vitalsOnAdmission?.pulseBpm,
        tempF: tempF !== undefined ? Number(tempF) : adm.vitalsOnAdmission?.tempF,
        spo2Pct: spo2Pct !== undefined ? Number(spo2Pct) : adm.vitalsOnAdmission?.spo2Pct,
        respRate: respRate !== undefined ? Number(respRate) : adm.vitalsOnAdmission?.respRate,
        nursingCareNote: doctorFlagged ? `${cleanNote} [DOCTOR NOTIFIED: ${abnormalReasons.join(', ')}]` : cleanNote,
        recordedBy: actor.fullName,
      });
      adm.progressNotes.unshift({
        id: `pn-qr-${Date.now()}`,
        timestamp: nowIso,
        note: formattedStampNote,
        recordedBy: actor.fullName,
      });
      patientLabel = `${adm.patientName} (Bed ${adm.currentBedLabel})`;
      refCode = adm.admissionNumber;
    } else if (encounterType === 'OPD') {
      const visit = (db.opdVisits || []).find((v) => v.id === encounterId);
      if (!visit) {
        res.status(404).json({ error: 'OPD visit not found.' });
        return;
      }
      visit.vitals = {
        ...visit.vitals,
        bp: bp?.trim() || visit.vitals?.bp,
        pulseBpm: pulseBpm !== undefined ? Number(pulseBpm) : visit.vitals?.pulseBpm,
        tempF: tempF !== undefined ? Number(tempF) : visit.vitals?.tempF,
        spo2Pct: spo2Pct !== undefined ? Number(spo2Pct) : visit.vitals?.spo2Pct,
        respRate: respRate !== undefined ? Number(respRate) : visit.vitals?.respRate,
      };
      visit.clinicalNotes = visit.clinicalNotes
        ? `${formattedStampNote}\n${visit.clinicalNotes}`
        : formattedStampNote;
      patientLabel = `${visit.patientName} (${visit.tokenNumber})`;
      refCode = visit.tokenNumber;
    } else {
      const erCase = (db.emergencyCases || []).find((e) => e.id === encounterId);
      if (!erCase) {
        res.status(404).json({ error: 'Emergency case not found.' });
        return;
      }
      erCase.vitals = {
        ...erCase.vitals,
        bp: bp?.trim() || erCase.vitals?.bp,
        pulseBpm: pulseBpm !== undefined ? Number(pulseBpm) : erCase.vitals?.pulseBpm,
        tempF: tempF !== undefined ? Number(tempF) : erCase.vitals?.tempF,
        spo2Pct: spo2Pct !== undefined ? Number(spo2Pct) : erCase.vitals?.spo2Pct,
        respRate: respRate !== undefined ? Number(respRate) : erCase.vitals?.respRate,
      };
      erCase.clinicalNotes = erCase.clinicalNotes
        ? `${formattedStampNote}\n${erCase.clinicalNotes}`
        : formattedStampNote;
      patientLabel = `${erCase.patientName} (${erCase.erBedBay})`;
      refCode = erCase.erNumber;
    }

    if (doctorFlagged) {
      appendSecurityAlert(db, {
        type: 'CLINICAL_VITALS_ALERT',
        severity: 'CRITICAL',
        targetUserId: encounterId,
        targetUsername: refCode,
        targetFullName: patientLabel,
        message: `URGENT DOCTOR ALERT (${encounterType} ${refCode}): ${patientLabel} abnormal readings [${abnormalReasons.join(', ')}] — Note: ${cleanNote}`,
        resolved: false,
      });
    }

    appendAudit(
      db,
      actor,
      'NURSING_CHART',
      doctorFlagged ? 'QUICK_ROUND_ABNORMAL_ALERT' : 'QUICK_ROUND_NOTE_LOGGED',
      refCode,
      `Quick Round Note logged on ${encounterType} ${refCode} (${patientLabel})${doctorFlagged ? ` — Doctor Alert Flagged: ${abnormalReasons.join(', ')}` : ''}.`,
      doctorFlagged ? 'CRITICAL' : 'INFO'
    );
    saveDb(db);
    res.status(201).json({
      isAbnormal,
      doctorFlagged,
      abnormalReasons,
      db: scopeDbForActor(db, actor),
    });
  });

  app.post('/api/clinical/alerts/:id/resolve', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const alert = (db.securityAlerts || []).find((a) => a.id === req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Alert not found.' });
      return;
    }
    alert.resolved = true;
    alert.resolvedBy = actor.fullName;
    alert.resolvedReason = (req.body?.reason as string)?.trim() || 'Reviewed by clinician';
    alert.resolvedAt = new Date().toISOString();
    saveDb(db);
    res.json({ alert, db: scopeDbForActor(db, actor) });
  });

  // Case Consent Management (Sign / Verify / Add for IPD or ER)
  app.post('/api/consents/:scope/:parentId', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { scope, parentId } = req.params;
    if (!hasPermission(db, actor.roleId, 'hospital.clinical') && !hasPermission(db, actor.roleId, 'emergency.manage')) {
      res.status(403).json({ error: 'Access denied: Requires clinical or emergency consent permission.' });
      return;
    }
    const { consentId, action, consentType, patientOrGuardianName, relationship, witnessName, customSummary } = req.body as {
      consentId?: string;
      action?: 'SIGN' | 'ADD';
      consentType?: ConsentTypeKey;
      patientOrGuardianName?: string;
      relationship?: string;
      witnessName?: string;
      customSummary?: string;
    };

    const target =
      scope === 'er'
        ? (db.emergencyCases || []).find((e) => e.id === parentId)
        : (db.ipdAdmissions || []).find((a) => a.id === parentId);

    if (!target) {
      res.status(404).json({ error: `${scope.toUpperCase()} patient record not found.` });
      return;
    }
    if (!Array.isArray(target.consents)) target.consents = [];
    const nowIso = new Date().toISOString();

    if (action === 'ADD' && consentType) {
      const def = CONSENT_CATALOG[consentType] || CONSENT_CATALOG.GENERAL_ADMISSION;
      const created: HospitalConsentRecord = {
        id: `cns-${Date.now()}`,
        consentCode: `CNS-${consentType.slice(0, 3)}-${Math.floor(100 + Math.random() * 899)}`,
        consentType,
        title: def.title,
        autoReason: 'Clinician Added Case Consent',
        summaryText: customSummary?.trim() || def.summaryText,
        patientOrGuardianName: patientOrGuardianName?.trim() || target.patientName,
        relationship: relationship?.trim() || 'Self',
        witnessName: witnessName?.trim() || '',
        status: patientOrGuardianName?.trim() ? 'Signed & Verified' : 'Auto-Assigned (Pending Signature)',
        signedAt: patientOrGuardianName?.trim() ? nowIso : undefined,
        verifiedBy: patientOrGuardianName?.trim() ? actor.fullName : undefined,
        createdAt: nowIso,
      };
      target.consents.push(created);
    } else if (consentId) {
      const existing = target.consents.find((c) => c.id === consentId);
      if (!existing) {
        res.status(404).json({ error: 'Consent record not found.' });
        return;
      }
      existing.status = 'Signed & Verified';
      existing.patientOrGuardianName = patientOrGuardianName?.trim() || existing.patientOrGuardianName || target.patientName;
      existing.relationship = relationship?.trim() || existing.relationship || 'Self';
      existing.witnessName = witnessName?.trim() || existing.witnessName || actor.fullName;
      existing.signedAt = nowIso;
      existing.verifiedBy = actor.fullName;
    }

    const refNo = 'erNumber' in target ? target.erNumber : target.admissionNumber;
    appendAudit(
      db,
      actor,
      'CONSENT',
      'CONSENT_UPDATED',
      refNo,
      `Updated case consent (${action || 'SIGN'}) on ${scope.toUpperCase()} ${refNo} (${target.patientName}).`
    );
    saveDb(db);
    res.json({ target, db: scopeDbForActor(db, actor) });
  });

  // Emergency & MLC (Medico-Legal Case) Management — Dynamic ER Ticket Fee + Saptari Police Directory
  app.post('/api/emergency/cases', withAuth('emergency.manage', 'emergency_mlc'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<EmergencyCase>;
    if (!body.patientName?.trim() || !body.chiefComplaint?.trim()) {
      res.status(400).json({ error: 'Patient Name and Emergency Chief Complaint are required.' });
      return;
    }
    const ms = db.settings?.moduleSettings;
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 30,
      ageType: body.patientAgeType || 'Years',
      gender: body.patientGender || 'Male',
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName,
    });

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    if (!Array.isArray(db.emergencyCases)) db.emergencyCases = [];
    const seq = db.emergencyCases.length + 1;
    const erNumber = `${ms?.erPrefix || 'ER'}-${bsNow.year}-${String(seq).padStart(3, '0')}`;
    const isMlc = Boolean(body.isMlc);
    const mlcNumber = isMlc
      ? `${ms?.mlcPrefix || 'MLC'}-${bsNow.year}-${String(db.emergencyCases.filter((e) => e.isMlc).length + 1).padStart(3, '0')}`
      : undefined;
    const placeHint = body.incidentPlace || body.patientAddress || '';
    const detectedPolice = autoDetectPoliceStation(placeHint, ms?.policeStations);

    const autoConsents = autoAssignConsents({
      context: 'ER',
      caseCategory: body.triageLevel === 'Red (Resuscitation)' ? 'Critical' : body.chiefComplaint,
      isMlc,
      mlcType: body.mlcCaseType,
      patientName: patientRec.fullName,
      guardianName: body.broughtByName?.trim(),
      createdAt: nowIso,
    });

    const ticketFee = body.erTicketFeeNpr !== undefined ? Math.max(0, Number(body.erTicketFeeNpr)) : ms?.emergencyTicketFeeNpr ?? 250;
    const erRegFee = body.erChargesNpr !== undefined ? Math.max(0, Number(body.erChargesNpr)) : ms?.emergencyRegistrationFeeNpr ?? 500;
    const totalErCollected = Number((ticketFee + erRegFee).toFixed(2));
    const payMode: PaymentMode = body.paymentMode || 'Cash';

    const selectedBed = body.selectedBedId
      ? (db.hospitalBeds || []).find((b) => b.id === body.selectedBedId)
      : undefined;
    if (selectedBed && selectedBed.status !== 'Available') {
      res.status(409).json({ error: `ER Bed ${selectedBed.bedCode} is ${selectedBed.status}. Please select an Available ER bed.` });
      return;
    }

    const erCase: EmergencyCase = {
      id: `er-${Date.now()}`,
      erNumber,
      registeredAt: nowIso,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      centerId: null,
      centerName: db.settings.labName,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterLabel:
        body.encounterLabel?.trim() ||
        `${erNumber} (${selectedBed ? `${selectedBed.bedCode} · ${selectedBed.wardName}` : body.erBedBay?.trim() || 'ER-BAY-01'})`,
      erTicketFeeNpr: ticketFee,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: normalizeNepalPhone(body.patientPhone) || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      broughtByName: body.broughtByName?.trim() || '',
      broughtByRelation: body.broughtByRelation?.trim() || '',
      broughtByPhone: normalizeNepalPhone(body.broughtByPhone),
      triageLevel: body.triageLevel || 'Yellow (Urgent)',
      arrivalMode: body.arrivalMode || 'Walk-In',
      chiefComplaint: body.chiefComplaint.trim(),
      vitals: body.vitals || {},
      erBedBay: selectedBed ? `${selectedBed.bedCode} (${selectedBed.wardName})` : body.erBedBay?.trim() || 'ER-BAY-01',
      selectedBedId: selectedBed?.id || null,
      isUnknownPatient: Boolean(body.isUnknownPatient),
      erShift: detectCurrentShiftLabel(new Date()),
      attendingDoctor: body.attendingDoctor?.trim() || actor.fullName,
      clinicalNotes: body.clinicalNotes?.trim() || 'IV line, vitals monitoring & initial emergency stabilization.',
      isMlc,
      mlcNumber,
      mlcCaseType: isMlc ? body.mlcCaseType || 'Other MLC' : undefined,
      incidentPlace: body.incidentPlace?.trim() || body.patientAddress?.trim() || '',
      incidentTimeText: body.incidentTimeText?.trim() || `${bsNow.formattedEn} ${bsNow.timeEn}`,
      identificationMarks: body.identificationMarks?.trim() || '',
      injurySummary: body.injurySummary?.trim() || (isMlc ? body.chiefComplaint.trim() : ''),
      policeStationName: body.policeStationName?.trim() || detectedPolice.stationName,
      policeStationAddress: body.policeStationAddress?.trim() || detectedPolice.stationAddress,
      policeStationPhone: body.policeStationPhone?.trim() || detectedPolice.stationPhone,
      policeInformed: false,
      consents: autoConsents,
      disposition: 'Under Observation (ER)',
      erChargesNpr: erRegFee,
      paymentMode: payMode,
      recordedBy: actor.fullName,
    };

    if (selectedBed && selectedBed.status === 'Available') {
      selectedBed.status = 'Occupied';
      selectedBed.currentAdmissionId = erCase.id;
      selectedBed.currentPatientName = erCase.patientName;
    }

    db.emergencyCases.unshift(erCase);

    if (totalErCollected > 0 && (payMode === 'Cash' || payMode === 'Bank / QR')) {
      const targetAcc =
        payMode === 'Bank / QR'
          ? db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosBank) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'BANK')
          : db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
            db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER');
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          'INFLOW',
          totalErCollected,
          'POS_COLLECTION',
          erNumber,
          `ER Ticket (रू ${ticketFee}) + Reg Fee (रू ${erRegFee}) — ${erCase.patientName}`,
          erCase.fiscalYear,
          actor
        );
      }
    }

    appendAudit(
      db,
      actor,
      'EMERGENCY_MLC',
      isMlc ? 'MLC_CASE_REGISTERED' : 'ER_CASE_REGISTERED',
      erNumber,
      `Registered ${erNumber} (${erCase.patientName}, Triage: ${erCase.triageLevel}, ER Ticket+Reg: रू ${totalErCollected}${isMlc ? `, MLC ${mlcNumber}` : ''}).`,
      isMlc ? 'WARNING' : 'INFO'
    );
    saveDb(db);
    res.status(201).json({ erCase, patient: patientRec, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/emergency/cases/:id', withAuth('emergency.manage', 'emergency_mlc'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: 'Emergency case not found.' });
      return;
    }
    const patchBody = (req.body || {}) as Partial<EmergencyCase>;
    if (patchBody.patientPhone !== undefined) {
      patchBody.patientPhone = normalizeNepalPhone(patchBody.patientPhone);
    }
    if (patchBody.broughtByPhone !== undefined) {
      patchBody.broughtByPhone = normalizeNepalPhone(patchBody.broughtByPhone);
    }
    Object.assign(erCase, patchBody);

    // Sync updated identity back to Patient Master if Unknown patient was later identified
    if (erCase.patientId) {
      const pat = (db.patients || []).find((p) => p.id === erCase.patientId);
      if (pat) {
        if (patchBody.patientName?.trim()) pat.fullName = patchBody.patientName.trim();
        if (patchBody.patientAge !== undefined) pat.age = Number(patchBody.patientAge) || pat.age;
        if (patchBody.patientAgeType) pat.ageType = patchBody.patientAgeType;
        if (patchBody.patientGender) pat.gender = patchBody.patientGender;
        if (patchBody.patientPhone !== undefined) pat.phone = patchBody.patientPhone;
        if (patchBody.patientAddress !== undefined) pat.address = patchBody.patientAddress;
      }
    }

    // Release ER bed if discharged / referred / expired
    if (erCase.selectedBedId) {
      const erBed = (db.hospitalBeds || []).find((b) => b.id === erCase.selectedBedId);
      if (erBed) {
        if (erCase.disposition !== 'Under Observation (ER)') {
          erBed.status = 'Available';
          erBed.currentAdmissionId = null;
          erBed.currentPatientName = null;
        } else {
          erBed.currentPatientName = erCase.patientName;
        }
      }
    }

    appendAudit(db, actor, 'EMERGENCY_MLC', 'ER_CASE_UPDATED', erCase.erNumber, `Updated ER/MLC case ${erCase.erNumber} (${erCase.patientName}) — ${erCase.disposition}.`);
    saveDb(db);
    res.json({ erCase, db: scopeDbForActor(db, actor) });
  });

  // Refer Out ER/MLC Patient with Auto-Attached Services, Investigations, Medicines, Ambulance, Time & History
  app.post('/api/emergency/cases/:id/refer-out', withAuth('emergency.manage', 'emergency_mlc'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: 'Emergency case not found.' });
      return;
    }
    const body = (req.body || {}) as Partial<ExternalReferralDetail> & {
      referredToHospital?: string;
      referredToPlace?: string;
    };
    if (!body.referredToHospital?.trim() || !body.referredToPlace?.trim()) {
      res.status(400).json({ error: 'Referred Hospital Name and Destination Place / City are required.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const baseExt: ExternalReferralDetail = {
      referredHospitalId: body.referredHospitalId || undefined,
      referredToHospital: body.referredToHospital.trim(),
      referredToPlace: body.referredToPlace.trim(),
      referredHospitalManagerName: body.referredHospitalManagerName?.trim() || undefined,
      referredHospitalManagerPhone: body.referredHospitalManagerPhone?.trim() || undefined,
      referredDepartment: body.referredDepartment?.trim() || 'Emergency / Trauma / ICU',
      referralReason: body.referralReason?.trim() || 'Higher tertiary center management & specialist care required',
      conditionAtReferral: body.conditionAtReferral?.trim() || `${erCase.triageLevel} — Stabilized in ER`,
      transportMode: body.transportMode || 'ALS Ambulance',
      ambulanceId: body.ambulanceId || undefined,
      ambulanceName: body.ambulanceName?.trim() || undefined,
      ambulanceNumber: body.ambulanceNumber?.trim() || undefined,
      ambulanceDriverName: body.ambulanceDriverName?.trim() || undefined,
      ambulanceDriverPhone: body.ambulanceDriverPhone?.trim() || undefined,
      referralCaseType: body.referralCaseType?.trim() || undefined,
      departureTime: body.departureTime?.trim() || `${bsNow.formattedEn} ${bsNow.timeEn}`,
      escortDoctorOrNurse: body.escortDoctorOrNurse?.trim() || undefined,
      caseDetails: body.caseDetails?.trim() || `${erCase.chiefComplaint}. ${erCase.clinicalNotes || ''}`.trim(),
      clinicalHistorySummary: body.clinicalHistorySummary?.trim() || undefined,
      referredAt: nowIso,
      referredBy: actor.fullName,
    };

    erCase.disposition = 'Referred to External Hospital';
    erCase.externalReferral = attachEncounterBillingAndClinicalHistory(db, {
      baseReferral: baseExt,
      patientId: erCase.patientId,
      uhid: erCase.uhid,
      patientName: erCase.patientName,
      patientPhone: erCase.patientPhone,
      encounterType: 'EMERGENCY',
      encounterId: erCase.id,
      erCase,
    });

    if (!Array.isArray(erCase.consents)) erCase.consents = [];
    if (!erCase.consents.some((c) => c.consentType === 'EXTERNAL_REFERRAL_TRANSPORT')) {
      const def = CONSENT_CATALOG.EXTERNAL_REFERRAL_TRANSPORT;
      erCase.consents.push({
        id: `cns-er-ref-${Date.now()}`,
        consentCode: `CNS-ERR-${Math.floor(100 + Math.random() * 899)}`,
        consentType: 'EXTERNAL_REFERRAL_TRANSPORT',
        title: def.title,
        autoReason: def.caseTriggerRule,
        summaryText: def.summaryText,
        patientOrGuardianName: erCase.broughtByName || erCase.patientName,
        relationship: erCase.broughtByRelation || 'Attendant',
        witnessName: actor.fullName,
        status: 'Auto-Assigned (Pending Signature)',
        createdAt: nowIso,
      });
    }

    appendAudit(
      db,
      actor,
      'EMERGENCY_MLC',
      'ER_PATIENT_REFERRED_OUT',
      erCase.erNumber,
      `Referred ER ${erCase.erNumber} (${erCase.patientName}) to ${erCase.externalReferral.referredToHospital}, ${erCase.externalReferral.referredToPlace} via ${erCase.externalReferral.ambulanceName || erCase.externalReferral.transportMode} at ${erCase.externalReferral.departureTime}. Attached ${erCase.externalReferral.attachedBilledItems?.length || 0} billed item(s).`,
      'WARNING'
    );
    saveDb(db);
    res.json({ erCase, db: scopeDbForActor(db, actor) });
  });

  // Side "Informed Police" Button -> Records Police Station, Informed Ref #, Exact Date/Time + Auto Chalani Log
  app.post('/api/emergency/cases/:id/inform-police', withAuth('emergency.manage', 'emergency_mlc'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: 'Emergency/MLC case not found.' });
      return;
    }
    const body = (req.body || {}) as {
      policeStationName?: string;
      policeStationAddress?: string;
      policeStationPhone?: string;
      policeInformedNumber?: string;
      policeOfficerName?: string;
      policeInformMode?: EmergencyCase['policeInformMode'];
      alsoLogChalani?: boolean;
    };
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const detected = autoDetectPoliceStation(
      erCase.incidentPlace || erCase.patientAddress,
      db.settings?.moduleSettings?.policeStations
    );
    if (body.policeStationName?.trim()) erCase.policeStationName = body.policeStationName.trim();
    else if (!erCase.policeStationName) erCase.policeStationName = detected.stationName;
    if (body.policeStationAddress?.trim()) erCase.policeStationAddress = body.policeStationAddress.trim();
    else if (!erCase.policeStationAddress) erCase.policeStationAddress = detected.stationAddress;
    if (body.policeStationPhone?.trim()) erCase.policeStationPhone = body.policeStationPhone.trim();
    else if (!erCase.policeStationPhone) erCase.policeStationPhone = detected.stationPhone;

    erCase.isMlc = true;
    if (!erCase.mlcNumber) {
      erCase.mlcNumber = `MLC-${bsNow.year}-${String((db.emergencyCases || []).filter((e) => e.isMlc).length + 1).padStart(3, '0')}`;
    }
    if (!erCase.mlcCaseType) erCase.mlcCaseType = 'Other MLC';
    erCase.policeInformed = true;
    erCase.policeInformedNumber =
      body.policeInformedNumber?.trim() ||
      `MLC-INF-${bsNow.year}-${String((db.emergencyCases || []).filter((e) => e.policeInformed).length + 1).padStart(3, '0')}`;
    erCase.policeInformedAt = nowIso;
    erCase.policeOfficerName = body.policeOfficerName?.trim() || 'Duty Officer (Police Chowki / Ilaka)';
    erCase.policeInformMode = body.policeInformMode || 'Telephone Call';
    erCase.policeInformedBy = actor.fullName;

    if (body.alsoLogChalani !== false) {
      if (!Array.isArray(db.dartaChalani)) db.dartaChalani = [];
      const seq = db.dartaChalani.filter((d) => d.entryType === 'CHALANI').length + 1;
      const fyShort = (db.settings.activeFiscalYear || bsNow.fiscalYear).replace('FY ', '');
      db.dartaChalani.unshift({
        id: `dc-mlc-${Date.now()}`,
        entryType: 'CHALANI',
        serialNo: seq,
        entryNumber: `CHALANI-${fyShort}-${String(seq).padStart(3, '0')}`,
        refNumber: `SHP-MLC-${bsNow.year}/${String(seq).padStart(3, '0')}`,
        fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
        entryDateAd: nowIso.slice(0, 10),
        entryDateBs: bsNow.formattedEn,
        partyName: erCase.policeStationName || detected.stationName,
        partyAddress: `${erCase.policeStationAddress || detected.stationAddress} (Ph: ${erCase.policeStationPhone || detected.stationPhone})`,
        subject: `Formal Police Intimation for ${erCase.mlcNumber} (${erCase.patientName} - ${erCase.mlcCaseType})`,
        category: 'Police / MLC Correspondence',
        department: 'Emergency & MLC Desk',
        handledBy: actor.fullName,
        documentBody: `Respected Officer-in-Charge,\n\nSaptari Hospital Pvt Ltd, Bode Barsain hereby intimates that patient ${erCase.patientName} (${erCase.patientAge} ${erCase.patientAgeType}/${erCase.patientGender}) arrived at ER (${erCase.erNumber}) with ${erCase.mlcCaseType} from ${erCase.incidentPlace || erCase.patientAddress}.\nPolice Informed Ref #: ${erCase.policeInformedNumber} · Mode: ${erCase.policeInformMode} · Officer: ${erCase.policeOfficerName}.\nInjury Summary: ${erCase.injurySummary || erCase.chiefComplaint}.`,
        attachments: [],
        status: 'Verified / Dispatched',
        remarks: `Auto-logged from ER/MLC Police Intimation (${erCase.policeInformedNumber})`,
        recordedBy: actor.fullName,
      });
    }

    appendAudit(
      db,
      actor,
      'EMERGENCY_MLC',
      'MLC_POLICE_INFORMED',
      erCase.mlcNumber,
      `Informed ${erCase.policeStationName} for MLC ${erCase.mlcNumber} (${erCase.patientName}). Informed Ref # ${erCase.policeInformedNumber} at ${bsNow.formattedEn} ${bsNow.timeEn}.`,
      'WARNING'
    );
    saveDb(db);
    res.json({ erCase, db: scopeDbForActor(db, actor) });
  });

  // Admit ER/MLC Case directly into an IPD Bed carrying over Consents & MLC details
  app.post('/api/emergency/cases/:id/admit-ipd', withAuth('emergency.manage', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: 'Emergency case not found.' });
      return;
    }
    const { bedId, initialDepositNpr, depositPaymentMode } = req.body as {
      bedId: string;
      initialDepositNpr?: number;
      depositPaymentMode?: PaymentMode;
    };
    const bed = (db.hospitalBeds || []).find((b) => b.id === bedId);
    if (!bed || bed.status !== 'Available') {
      res.status(409).json({ error: 'Selected hospital bed is not Available.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const admNo = `IPD-${bsNow.year}-${101 + (db.ipdAdmissions || []).length}`;
    const depositAmt = Math.max(0, Number(initialDepositNpr) || 0);
    const payMode: PaymentMode = depositPaymentMode || 'Cash';
    const deposits: IpdPaymentDeposit[] = [];
    if (depositAmt > 0) {
      const rcpNo = `IPD-RCP-${bsNow.year}-${201 + (db.ipdAdmissions || []).length}`;
      deposits.push({
        id: `dep-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: depositAmt,
        paymentMode: payMode,
        receiptNumber: rcpNo,
        notes: `ER->IPD Admission Advance (${erCase.erNumber})`,
        receivedBy: actor.fullName,
      });
    }

    const carriedConsents: HospitalConsentRecord[] = [
      ...JSON.parse(JSON.stringify(erCase.consents || [])),
      ...autoAssignConsents({
        context: 'IPD',
        caseCategory: erCase.isMlc ? 'MLC / Trauma' : bed.wardType,
        wardName: bed.wardName,
        isMlc: erCase.isMlc,
        mlcType: erCase.mlcCaseType,
        patientName: erCase.patientName,
        guardianName: erCase.broughtByName,
        createdAt: nowIso,
      }).filter((nc) => !(erCase.consents || []).some((ec) => ec.consentType === nc.consentType)),
    ];

    const admission: IpdAdmission = {
      id: `ipd-${Date.now()}`,
      admissionNumber: admNo,
      fiscalYear: activeFy,
      admittedAt: nowIso,
      centerId: bed.centerId,
      centerName: bed.centerName,
      linkedEmergencyId: erCase.id,
      caseCategory: erCase.isMlc
        ? 'MLC / Trauma'
        : bed.wardType === 'ICU / HDU'
        ? 'ICU / Critical'
        : bed.wardType === 'Maternity'
        ? 'Maternity / OBG'
        : bed.wardType === 'NICU / Pediatric'
        ? 'Pediatric / NICU'
        : 'General Medical',
      patientName: erCase.patientName,
      patientAge: erCase.patientAge,
      patientAgeType: erCase.patientAgeType,
      patientGender: erCase.patientGender,
      patientPhone: erCase.patientPhone,
      patientAddress: erCase.patientAddress,
      emergencyContact: erCase.broughtByName ? `${erCase.broughtByName} (${erCase.broughtByPhone})` : '',
      admittingDoctor: erCase.attendingDoctor,
      department: bed.wardName,
      currentBedId: bed.id,
      currentBedLabel: bed.bedCode,
      currentWardName: bed.wardName,
      bedDailyRateNpr: bed.dailyRateNpr,
      admittingDiagnosis: `${erCase.chiefComplaint}${erCase.isMlc ? ` [MLC ${erCase.mlcNumber}]` : ''}`,
      finalDiagnosis: '',
      hospitalCourseSummary: `Admitted from Emergency (${erCase.erNumber}). ${erCase.clinicalNotes}`,
      vitalsOnAdmission: erCase.vitals,
      progressNotes: [
        {
          id: `pn-${Date.now()}`,
          timestamp: nowIso,
          note: `Transferred from ER (${erCase.erNumber}) to ${bed.wardName} Bed ${bed.bedCode}.`,
          recordedBy: actor.fullName,
        },
      ],
      nursingCharts: [],
      consents: carriedConsents,
      bedTransfers: [],
      usedMedicines: [],
      investigationsDone: [],
      deposits,
      disposition: 'Admitted',
      bedChargesNpr: bed.dailyRateNpr,
      medicinesTotalNpr: 0,
      investigationsTotalNpr: 0,
      otherProcedureChargesNpr: 0,
      totalBillNpr: 0,
      totalDepositPaidNpr: depositAmt,
      balanceDueNpr: 0,
    };
    recalcIpdFinancials(admission, db.settings?.moduleSettings);
    bed.status = 'Occupied';
    bed.currentAdmissionId = admission.id;
    bed.currentPatientName = admission.patientName;

    erCase.disposition = 'Admitted to IPD';
    erCase.linkedIpdAdmissionId = admission.id;

    if (!Array.isArray(db.ipdAdmissions)) db.ipdAdmissions = [];
    db.ipdAdmissions.unshift(admission);

    appendAudit(
      db,
      actor,
      'EMERGENCY_MLC',
      'ER_ADMITTED_TO_IPD',
      admNo,
      `Admitted ER case ${erCase.erNumber} (${erCase.patientName}) to Bed ${bed.bedCode} with ${carriedConsents.length} consents.`
    );
    saveDb(db);
    res.status(201).json({ admission, erCase, db: scopeDbForActor(db, actor) });
  });

  // Darta (Inward) & Chalani (Outward) Register + Attachments
  app.post('/api/darta-chalani', withAuth('darta.manage', 'darta_chalani'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<DartaChalaniEntry>;
    if (!body.partyName?.trim() || !body.subject?.trim()) {
      res.status(400).json({ error: 'Party Name (Sender/Recipient) and Subject are required.' });
      return;
    }
    if (!Array.isArray(db.dartaChalani)) db.dartaChalani = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const fyShort = activeFy.replace('FY ', '');
    const entryType: 'DARTA' | 'CHALANI' = body.entryType === 'DARTA' ? 'DARTA' : 'CHALANI';
    const serialNo = db.dartaChalani.filter((d) => d.entryType === entryType).length + 1;
    const prefix = entryType === 'DARTA' ? 'DRT' : 'CH';

    const entry: DartaChalaniEntry = {
      id: `dc-${Date.now()}`,
      entryType,
      serialNo,
      entryNumber: body.entryNumber?.trim() || `${entryType}-${fyShort}-${String(serialNo).padStart(3, '0')}`,
      refNumber:
        body.refNumber?.trim() ||
        `SHP/${prefix}/${fyShort}/${String(serialNo).padStart(3, '0')}`,
      fiscalYear: activeFy,
      entryDateAd: body.entryDateAd || nowIso.slice(0, 10),
      entryDateBs: body.entryDateBs?.trim() || bsNow.formattedEn,
      partyName: body.partyName.trim(),
      partyAddress: body.partyAddress?.trim() || 'Bode Barsain, Saptari, Nepal',
      subject: body.subject.trim(),
      category: body.category || 'General Correspondence',
      department: body.department?.trim() || 'Hospital Administration',
      handledBy: body.handledBy?.trim() || actor.fullName,
      documentBody: body.documentBody || '',
      attachments: (body.attachments || []) as DartaChalaniAttachment[],
      status: body.status || 'Verified / Dispatched',
      remarks: body.remarks?.trim() || '',
      recordedBy: actor.fullName,
    };

    db.dartaChalani.unshift(entry);
    appendAudit(
      db,
      actor,
      'DARTA_CHALANI',
      `${entryType}_CREATED`,
      entry.entryNumber,
      `Logged ${entryType} ${entry.entryNumber} (Ref: ${entry.refNumber}) — ${entry.subject} [${entry.attachments.length} attachment(s)].`
    );
    saveDb(db);
    res.status(201).json({ entry, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/darta-chalani/:id', withAuth('darta.manage', 'darta_chalani'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const entry = (db.dartaChalani || []).find((d) => d.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Darta/Chalani record not found.' });
      return;
    }
    Object.assign(entry, req.body);
    appendAudit(db, actor, 'DARTA_CHALANI', 'DARTA_CHALANI_UPDATED', entry.entryNumber, `Updated ${entry.entryType} ${entry.entryNumber} (${entry.status}).`);
    saveDb(db);
    res.json({ entry, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/darta-chalani/:id', withAuth('darta.manage', 'darta_chalani'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const idx = (db.dartaChalani || []).findIndex((d) => d.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Darta/Chalani record not found.' });
      return;
    }
    const [removed] = db.dartaChalani.splice(idx, 1);
    appendAudit(db, actor, 'DARTA_CHALANI', 'DARTA_CHALANI_DELETED', removed.entryNumber, `Deleted ${removed.entryType} ${removed.entryNumber}.`, 'WARNING');
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  // Server-Side Gemini AI Official Letter & HR Certificate Composer (Darta/Chalani + Employee Letters)
  app.post('/api/ai/compose-letter', withAuth(), async (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const canCompose =
      hasPermission(db, actor.roleId, 'darta.manage') ||
      hasPermission(db, actor.roleId, 'personnel.manage') ||
      hasPermission(db, actor.roleId, 'admin.control') ||
      actor.roleId === 'SUPER_ADMIN';
    if (!canCompose) {
      res.status(403).json({ error: 'Access denied: Darta/Chalani or HR management permission required for AI letter composition.' });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      res.status(503).json({
        error: 'GEMINI_API_KEY is not configured on the server environment (.env). Set GEMINI_API_KEY to enable AI-written official letters.',
      });
      return;
    }

    const {
      documentKind = 'CHALANI_LETTER',
      language = 'English',
      partyName,
      partyAddress,
      subject,
      keyPoints,
      department,
      tone = 'Formal Official',
      employeeDetails,
    } = req.body as {
      documentKind?: string;
      language?: 'English' | 'Nepali' | 'Bilingual (English + Nepali)';
      partyName?: string;
      partyAddress?: string;
      subject?: string;
      keyPoints?: string;
      department?: string;
      tone?: string;
      employeeDetails?: {
        fullName?: string;
        employeeCode?: string;
        designation?: string;
        department?: string;
        joinedAt?: string;
        relievingDate?: string;
        registrationNumber?: string;
        basicSalaryNpr?: number;
        totalSalaryNpr?: number;
        shift?: string;
      };
    };

    const hospitalName = db.settings.labName || 'Saptari Hospital Pvt Ltd';
    const hospitalAddr = db.settings.addressLine || 'Bode Barsain, Saptari, Nepal';
    const todayBs = adToBs(new Date().toISOString()).formattedEn;

    const systemPrompt = `You are the Official Executive Secretary & HR/Administrative Writer for "${hospitalName}" (${hospitalAddr}).
Today's BS Date: ${todayBs}.
Write clear, authoritative, print-ready hospital official correspondence and HR certificates suitable for Nepal healthcare and municipal/government administration.
Return ONLY valid JSON with two string fields:
{
  "subject": "Concise formal subject line",
  "documentBody": "Multi-paragraph formal letter body WITHOUT duplicating the hospital header/logo, ref number, or signature block (start directly from 'Respected Sir/Madam,' or 'To Whom It May Concern,' and end with closing salutation like 'Sincerely,')."
}`;

    const userPrompt = [
      `Document Type: ${documentKind}`,
      `Language: ${language}`,
      `Tone: ${tone}`,
      `Department: ${department || 'Hospital Administration'}`,
      partyName ? `Recipient / Party Name: ${partyName}` : '',
      partyAddress ? `Recipient Address: ${partyAddress}` : '',
      subject ? `Requested Subject: ${subject}` : '',
      employeeDetails
        ? `Employee Profile: Name=${employeeDetails.fullName || ''}, Code=${employeeDetails.employeeCode || ''}, Designation=${employeeDetails.designation || ''}, Dept=${employeeDetails.department || ''}, Joined=${employeeDetails.joinedAt || ''}, RegNo=${employeeDetails.registrationNumber || 'N/A'}, Shift=${employeeDetails.shift || ''}, GrossSalaryNPR=${employeeDetails.totalSalaryNpr || employeeDetails.basicSalaryNpr || ''}`
        : '',
      `Key Instructions / Points: ${keyPoints?.trim() || 'Draft a complete, professional official hospital document matching standard Nepal hospital format.'}`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });
      const rawText = (response.text || '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Gemini returned an empty response. Please try again with clearer instructions.' });
        return;
      }
      let parsed: { subject?: string; documentBody?: string } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = {
          subject: subject?.trim() || `Official ${documentKind}`,
          documentBody: rawText,
        };
      }
      appendAudit(
        db,
        actor,
        'DARTA_CHALANI',
        'AI_LETTER_COMPOSED',
        documentKind,
        `AI composed ${documentKind} (${language}) for ${partyName || employeeDetails?.fullName || 'Hospital Correspondence'}.`
      );
      saveDb(db);
      res.json({
        subject: (parsed.subject || subject || '').trim(),
        documentBody: (parsed.documentBody || rawText).trim(),
      });
    } catch (err: any) {
      res.status(502).json({
        error: `AI letter generation failed: ${err?.message || 'Unknown Gemini API error'}`,
      });
    }
  });

  // Birth & Death Certificates
  app.post('/api/certificates/birth', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<BirthCertificateRecord>;
    if (!body.motherName?.trim()) {
      res.status(400).json({ error: 'Mother Name is required for Birth Certificate.' });
      return;
    }
    if (!Array.isArray(db.birthCertificates)) db.birthCertificates = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const cert: BirthCertificateRecord = {
      id: `bcert-${Date.now()}`,
      certificateNumber: `SHP-BIRTH-${bsNow.year}-${String(db.birthCertificates.length + 1).padStart(3, '0')}`,
      fiscalYear: activeFy,
      issuedAt: nowIso,
      linkedIpdAdmissionId: body.linkedIpdAdmissionId,
      motherName: body.motherName.trim(),
      motherAge: Number(body.motherAge) || 24,
      motherCitizenshipNo: body.motherCitizenshipNo?.trim() || '',
      fatherName: body.fatherName?.trim() || '—',
      fatherCitizenshipNo: body.fatherCitizenshipNo?.trim() || '',
      permanentAddress: body.permanentAddress?.trim() || 'Bode Barsain, Saptari, Nepal',
      babyName: body.babyName?.trim() || `Baby of ${body.motherName.trim()}`,
      babyGender: body.babyGender || 'Male',
      birthDateAd: body.birthDateAd || nowIso.slice(0, 10),
      birthDateBs: body.birthDateBs?.trim() || bsNow.formattedEn,
      birthTime: body.birthTime?.trim() || bsNow.timeEn,
      birthWeightKg: Number(body.birthWeightKg) || 3.0,
      deliveryType: body.deliveryType || 'Normal Vaginal Delivery',
      apgar1Min: Number(body.apgar1Min) || 8,
      apgar5Min: Number(body.apgar5Min) || 9,
      placeOfBirth: body.placeOfBirth?.trim() || 'Saptari Hospital Pvt Ltd, Bode Barsain (Saptari, Nepal)',
      attendingDoctor: body.attendingDoctor?.trim() || actor.fullName,
      issuedBy: actor.fullName,
    };
    db.birthCertificates.unshift(cert);
    appendAudit(db, actor, 'CERTIFICATES', 'BIRTH_CERTIFICATE_ISSUED', cert.certificateNumber, `Issued Birth Certificate ${cert.certificateNumber} (${cert.babyName}, ${cert.birthWeightKg} kg).`);
    saveDb(db);
    res.status(201).json({ certificate: cert, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/certificates/death', withAuth('hospital.clinical', 'hospital_opd_ipd'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<DeathCertificateRecord>;
    if (!body.deceasedName?.trim() || !body.immediateCauseOfDeath?.trim()) {
      res.status(400).json({ error: 'Deceased Name and Immediate Cause of Death are required.' });
      return;
    }
    if (!Array.isArray(db.deathCertificates)) db.deathCertificates = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const cert: DeathCertificateRecord = {
      id: `dcert-${Date.now()}`,
      certificateNumber: `SHP-DEATH-${bsNow.year}-${String(db.deathCertificates.length + 1).padStart(3, '0')}`,
      fiscalYear: activeFy,
      issuedAt: nowIso,
      linkedIpdAdmissionId: body.linkedIpdAdmissionId,
      linkedEmergencyId: body.linkedEmergencyId,
      deceasedName: body.deceasedName.trim(),
      age: Number(body.age) || 60,
      ageType: body.ageType || 'Years',
      gender: body.gender || 'Male',
      citizenshipNo: body.citizenshipNo?.trim() || '',
      fatherOrSpouseName: body.fatherOrSpouseName?.trim() || '—',
      permanentAddress: body.permanentAddress?.trim() || 'Bode Barsain, Saptari, Nepal',
      deathDateAd: body.deathDateAd || nowIso.slice(0, 10),
      deathDateBs: body.deathDateBs?.trim() || bsNow.formattedEn,
      deathTime: body.deathTime?.trim() || bsNow.timeEn,
      wardOrPlaceOfDeath: body.wardOrPlaceOfDeath?.trim() || 'Saptari Hospital Pvt Ltd, Bode Barsain',
      immediateCauseOfDeath: body.immediateCauseOfDeath.trim(),
      antecedentCause: body.antecedentCause?.trim() || '',
      mannerOfDeath: body.mannerOfDeath || 'Natural',
      isMlc: Boolean(body.isMlc),
      mlcNumber: body.mlcNumber?.trim() || undefined,
      policeStationNotified: body.policeStationNotified?.trim() || undefined,
      bodyHandedOverTo: body.bodyHandedOverTo?.trim() || 'Next of Kin',
      handoverRelation: body.handoverRelation?.trim() || 'Family Member',
      handoverPhone: body.handoverPhone?.trim() || '',
      certifyingDoctor: body.certifyingDoctor?.trim() || actor.fullName,
      doctorRegNo: body.doctorRegNo?.trim() || actor.registrationNumber || 'NMC-8412',
      issuedBy: actor.fullName,
    };
    db.deathCertificates.unshift(cert);
    appendAudit(db, actor, 'CERTIFICATES', 'DEATH_CERTIFICATE_ISSUED', cert.certificateNumber, `Issued Death Certificate ${cert.certificateNumber} (${cert.deceasedName} — ${cert.immediateCauseOfDeath}).`, 'WARNING');
    saveDb(db);
    res.status(201).json({ certificate: cert, db: scopeDbForActor(db, actor) });
  });

  // Offline / Non-API DHIS2 Monthly HMIS Report Generator (For Bode Barsain Municipality Health Section)
  app.post('/api/dhis2/generate', withAuth('dhis2.manage', 'dhis2_hmis'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const {
      bsYear = bsNow.year,
      bsMonthIndex = bsNow.month,
      bsMonthName = bsNow.monthNameEn,
      preparedBy,
    } = (req.body || {}) as {
      bsYear?: number;
      bsMonthIndex?: number;
      bsMonthName?: string;
      preparedBy?: string;
    };
    if (!Array.isArray(db.dhis2Reports)) db.dhis2Reports = [];

    const opdVisits = db.opdVisits || [];
    const erCases = db.emergencyCases || [];
    const ipdAdms = db.ipdAdmissions || [];
    const beds = db.hospitalBeds || [];
    const labOrders = db.orders || [];
    const births = db.birthCertificates || [];
    const deaths = db.deathCertificates || [];
    const phmInvoices = db.pharmacyInvoices || [];
    const phmMeds = db.pharmacyMedicines || [];
    const phmBatches = db.pharmacyBatches || [];

    const opdNewFemale = opdVisits.filter((v) => v.patientGender === 'Female').length;
    const opdNewMale = opdVisits.filter((v) => v.patientGender === 'Male').length;
    const opdFollowupTotal = opdVisits.filter((v) => v.disposition === 'Discharged Home').length;
    const emergencyTotalVisits = erCases.length;
    const emergencyMlcCases = erCases.filter((e) => e.isMlc).length;
    const ipdTotalAdmissions = ipdAdms.length;
    const ipdTotalBedsAvailable = beds.length;
    const occupiedBeds = beds.filter((b) => b.status === 'Occupied').length;
    const ipdBedOccupancyPercent =
      ipdTotalBedsAvailable > 0 ? Math.round((occupiedBeds / ipdTotalBedsAvailable) * 100) : 0;
    const ipdTotalBedDays = Math.max(
      ipdTotalAdmissions,
      ipdAdms.reduce((s, a) => s + Math.max(1, Math.round((a.bedChargesNpr || 0) / Math.max(1, a.bedDailyRateNpr || 1200))), 0)
    );
    const ipdDischargedHome = ipdAdms.filter((a) => a.disposition === 'Discharged').length;
    const ipdReferredOut =
      ipdAdms.filter((a) => a.disposition === 'Referred to External Hospital').length +
      opdVisits.filter((v) => v.disposition === 'Referred to External Hospital').length +
      erCases.filter((e) => e.disposition === 'Referred to External Hospital').length;
    const ipdLamaCases = ipdAdms.filter((a) => a.disposition === 'LAMA / DOR').length;

    const normalDeliveries = births.filter((b) => b.deliveryType === 'Normal Vaginal Delivery').length;
    const cesareanDeliveries = births.filter((b) => b.deliveryType === 'LSCS (Cesarean Section)').length;
    const liveBirthsMale = births.filter((b) => b.babyGender === 'Male').length;
    const liveBirthsFemale = births.filter((b) => b.babyGender === 'Female').length;
    const lowBirthWeightCount = births.filter((b) => (b.birthWeightKg || 0) > 0 && b.birthWeightKg < 2.5).length;
    const institutionalDeaths = deaths.length;
    const neonatalDeaths = deaths.filter((d) => d.ageType === 'Days' && d.age <= 28).length;

    const pathologyTestsDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.serviceCategory !== 'RADIOLOGY').length,
      0
    );
    const xrayStudiesDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.modality === 'X-RAY').length,
      0
    );
    const usgEchoDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.modality === 'USG' || t.modality === 'ECHO').length,
      0
    );
    const ctEcgDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.modality === 'CT' || t.modality === 'ECG').length,
      0
    );

    const pharmacyStockoutItemsCount = phmMeds.filter(
      (m) =>
        phmBatches
          .filter((b) => b.medicineId === m.id && !b.quarantined)
          .reduce((sum, b) => sum + b.quantityOnHand, 0) <= 0
    ).length;

    const matchDiag = (kw: string[]) => {
      const allText = [
        ...opdVisits.map((v) => `${v.chiefComplaint} ${v.provisionalDiagnosis}`),
        ...erCases.map((e) => `${e.chiefComplaint} ${e.mlcCaseType || ''}`),
        ...ipdAdms.map((a) => `${a.admittingDiagnosis} ${a.finalDiagnosis}`),
      ];
      return allText.filter((t) => kw.some((k) => t.toLowerCase().includes(k))).length;
    };

    const report: Dhis2MonthlyReport = {
      id: `dhis-${Date.now()}`,
      reportCode: `DHIS2-SHP-${bsYear}-${String(bsMonthIndex).padStart(2, '0')}`,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      bsYear: Number(bsYear),
      bsMonthIndex: Number(bsMonthIndex),
      bsMonthName,
      generatedAt: nowIso,
      municipalityTargetName: 'Health Section, Bode Barsain Municipality, Saptari, Nepal',
      status: 'Draft',
      opdNewFemale,
      opdNewMale,
      opdFollowupTotal,
      emergencyTotalVisits,
      emergencyMlcCases,
      ipdTotalAdmissions,
      ipdTotalBedDays,
      ipdTotalBedsAvailable,
      ipdBedOccupancyPercent,
      ipdDischargedHome,
      ipdReferredOut,
      ipdLamaCases,
      normalDeliveries,
      cesareanDeliveries,
      liveBirthsMale,
      liveBirthsFemale,
      lowBirthWeightCount,
      institutionalDeaths,
      maternalDeaths: 0,
      neonatalDeaths,
      pathologyTestsDone,
      xrayStudiesDone,
      usgEchoDone,
      ctEcgDone,
      morbidityAriPneumonia: matchDiag(['ari', 'pneumonia', 'cough', 'respiratory', 'copd']),
      morbidityDiarrheaDysentery: matchDiag(['diarrh', 'gastro', 'age', 'dysentery']),
      morbidityHypertensionCvd: matchDiag(['hypertens', 'stemi', 'cardiac', 'heart', 'bp']),
      morbidityDiabetes: matchDiag(['diabet', 'sugar', 'hba1c']),
      morbidityTraumaRta: matchDiag(['rta', 'road traffic', 'trauma', 'fracture', 'assault', 'injury']),
      morbidityEntericFever: matchDiag(['fever', 'typhoid', 'enteric', 'dengue', 'sepsis']),
      pharmacyStockoutItemsCount,
      pharmacyBillsIssued: phmInvoices.length,
      remarks: 'Generated offline from Saptari Hospital ERP clinical registers (Zero external API dependency) for 2-Paper Municipality Health Section submission.',
      preparedBy: preparedBy?.trim() || actor.fullName,
      approvedByDoctor: 'Dr. Santosh Majhi (Medical Director)',
    };

    db.dhis2Reports.unshift(report);
    appendAudit(
      db,
      actor,
      'DHIS2_HMIS',
      'DHIS2_OFFLINE_GENERATED',
      report.reportCode,
      `Generated offline DHIS2 HMIS report ${report.reportCode} (${bsMonthName} ${bsYear}) for Bode Barsain Municipality Health Section.`
    );
    saveDb(db);
    res.status(201).json({ report, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/dhis2/:id', withAuth('dhis2.manage', 'dhis2_hmis'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const report = (db.dhis2Reports || []).find((r) => r.id === req.params.id);
    if (!report) {
      res.status(404).json({ error: 'DHIS2 HMIS report not found.' });
      return;
    }
    Object.assign(report, req.body);
    appendAudit(
      db,
      actor,
      'DHIS2_HMIS',
      'DHIS2_REPORT_UPDATED',
      report.reportCode,
      `Updated DHIS2 HMIS ${report.reportCode} (${report.status}${report.municipalityReceiptNo ? ` · Receipt: ${report.municipalityReceiptNo}` : ''}).`
    );
    saveDb(db);
    res.json({ report, db: scopeDbForActor(db, actor) });
  });

  // RBAC Policy Matrix
  app.put('/api/rbac', withAuth('rbac.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { roleId, permissions } = req.body as {
      roleId: RoleId;
      permissions: PermissionKey[];
    };
    const role = db.roles.find((r) => r.id === roleId);
    if (!role) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }
    if (roleId === 'SUPER_ADMIN' && (!permissions.includes('rbac.manage') || !permissions.includes('admin.control'))) {
      res.status(400).json({ error: 'Hospital Admin (SUPER_ADMIN) must retain rbac.manage and admin.control.' });
      return;
    }
    const sanitizedPermissions =
      roleId === 'LAB_TECH'
        ? [...LAB_TECH_STRICT_PERMISSIONS]
        : roleId === 'SUPER_ADMIN' || roleId === 'SAAS_ADMIN'
        ? permissions
        : permissions.filter((p) => p !== 'settings.manage');
    role.permissions = sanitizedPermissions;
    appendAudit(
      db,
      actor,
      'RBAC',
      'ROLE_PERMISSIONS_MODIFIED',
      roleId,
      `Updated permission policy for ${role.name} (${sanitizedPermissions.length} active permissions).`,
      'WARNING'
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });

  // Create Custom Role with Module & Granular Permissions
  app.post('/api/rbac/roles', withAuth('rbac.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { id, name, description, permissions, assignedModuleKeys } = req.body as {
      id?: string;
      name: string;
      description?: string;
      permissions?: PermissionKey[];
      assignedModuleKeys?: string[];
    };
    if (!name?.trim()) {
      res.status(400).json({ error: 'Role name is required.' });
      return;
    }
    const cleanId = (
      id?.trim() ||
      `CUSTOM_${name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 28)}`
    ).toUpperCase();

    if (!cleanId || cleanId.length < 3) {
      res.status(400).json({ error: 'Role ID / Code must be at least 3 alphanumeric characters.' });
      return;
    }
    if (db.roles.some((r) => r.id.toUpperCase() === cleanId)) {
      res.status(400).json({ error: `Role code '${cleanId}' already exists.` });
      return;
    }

    const perms = Array.from(new Set<PermissionKey>(['dashboard.view', ...(permissions || [])]));
    const newRole = {
      id: cleanId as RoleId,
      name: name.trim(),
      description: description?.trim() || `Custom hospital role (${perms.length} permissions)`,
      permissions: perms,
      isCustom: true,
      assignedModuleKeys: Array.isArray(assignedModuleKeys) ? assignedModuleKeys : [],
      createdAt: new Date().toISOString(),
    };
    db.roles.push(newRole);

    if (db.saas) {
      if (!Array.isArray(db.saas.allowedRoleIds)) db.saas.allowedRoleIds = [];
      if (!db.saas.allowedRoleIds.includes(newRole.id)) {
        db.saas.allowedRoleIds.push(newRole.id);
      }
      db.saas.maxRolesCapacity = Math.max(db.saas.maxRolesCapacity || 12, db.roles.length + 5);
    }
    if (!db.dashboardLayoutConfigs) db.dashboardLayoutConfigs = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS };
    db.dashboardLayoutConfigs[newRole.id] = {
      roleId: newRole.id,
      title: `${newRole.name} — Workspace`,
      subtitle: newRole.description,
      widgets: ['EXECUTIVE_SUMMARY', 'PRIORITY_ALERTS', 'KPI_GRID', 'CLINICAL_OPS', 'SHIFT_HANDOVER'],
    };

    appendAudit(
      db,
      actor,
      'RBAC',
      'CUSTOM_ROLE_CREATED',
      newRole.id,
      `Created custom role "${newRole.name}" (${newRole.id}) with ${perms.length} permissions across ${newRole.assignedModuleKeys.length} module(s).`,
      'WARNING'
    );
    saveDb(db);
    res.status(201).json({ role: newRole, db: scopeDbForActor(db, actor) });
  });

  // Update Role Name, Description, Modules & Permissions
  app.patch('/api/rbac/roles/:roleId', withAuth('rbac.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const roleId = req.params.roleId;
    const role = db.roles.find((r) => r.id === roleId);
    if (!role) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }
    const { name, description, permissions, assignedModuleKeys } = req.body as {
      name?: string;
      description?: string;
      permissions?: PermissionKey[];
      assignedModuleKeys?: string[];
    };
    if (name?.trim()) role.name = name.trim();
    if (description !== undefined) role.description = description.trim();
    if (Array.isArray(assignedModuleKeys)) role.assignedModuleKeys = assignedModuleKeys;
    if (Array.isArray(permissions)) {
      if (role.id === 'SUPER_ADMIN' && (!permissions.includes('rbac.manage') || !permissions.includes('admin.control'))) {
        res.status(400).json({ error: 'Hospital Admin (SUPER_ADMIN) must retain rbac.manage and admin.control.' });
        return;
      }
      role.permissions =
        role.id === 'LAB_TECH'
          ? [...LAB_TECH_STRICT_PERMISSIONS]
          : role.id === 'SUPER_ADMIN' || role.id === 'SAAS_ADMIN'
          ? Array.from(new Set(permissions))
          : Array.from(new Set(permissions)).filter((p) => p !== 'settings.manage');
    }
    if (db.dashboardLayoutConfigs?.[role.id]) {
      db.dashboardLayoutConfigs[role.id].title = `${role.name} — Workspace`;
      db.dashboardLayoutConfigs[role.id].subtitle = role.description;
    }
    appendAudit(
      db,
      actor,
      'RBAC',
      'ROLE_UPDATED',
      role.id,
      `Updated role "${role.name}" (${role.permissions.length} permissions).`,
      'WARNING'
    );
    saveDb(db);
    res.json({ role, db: scopeDbForActor(db, actor) });
  });

  // Delete Custom Role (only if no active staff assigned)
  app.delete('/api/rbac/roles/:roleId', withAuth('rbac.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const roleId = req.params.roleId;
    const idx = db.roles.findIndex((r) => r.id === roleId);
    if (idx < 0) {
      res.status(404).json({ error: 'Role not found.' });
      return;
    }
    const role = db.roles[idx];
    if (roleId === 'SUPER_ADMIN' || roleId === 'SAAS_ADMIN') {
      res.status(400).json({ error: 'Core Hospital Admin role cannot be deleted.' });
      return;
    }
    const assignedCount = db.staff.filter((s) => s.roleId === roleId).length;
    if (assignedCount > 0) {
      res.status(400).json({
        error: `Cannot delete role "${role.name}" because ${assignedCount} staff account(s) are currently assigned to it. Reassign those staff first.`,
      });
      return;
    }
    db.roles.splice(idx, 1);
    if (db.saas?.allowedRoleIds) {
      db.saas.allowedRoleIds = db.saas.allowedRoleIds.filter((id) => id !== roleId);
    }
    if (db.dashboardLayoutConfigs?.[roleId]) {
      delete db.dashboardLayoutConfigs[roleId];
    }
    appendAudit(db, actor, 'RBAC', 'CUSTOM_ROLE_DELETED', roleId, `Deleted custom role "${role.name}" (${roleId}).`, 'WARNING');
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  // Lab / Hospital, Fiscal Year, WhatsApp, Letterhead, Print Options & Signature Box Settings (Admin Only)
  app.put('/api/settings', withAuth('settings.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN' && actor.roleId !== 'SAAS_ADMIN') {
      res.status(403).json({ error: 'Access denied: Only Hospital Admin may change System Settings.' });
      return;
    }
    const incomingModuleSettings = req.body.moduleSettings as Partial<ModuleSettingsConfig> | undefined;
    const prevMs = (db.settings.moduleSettings || {}) as Partial<ModuleSettingsConfig>;
    db.settings = {
      ...db.settings,
      ...req.body,
      moduleSettings: {
        ...prevMs,
        ...(incomingModuleSettings || {}),
        printOptions: {
          ...(prevMs.printOptions || {}),
          ...(incomingModuleSettings?.printOptions || {}),
          autoPrintByTemplate: {
            ...(prevMs.printOptions?.autoPrintByTemplate || {}),
            ...(incomingModuleSettings?.printOptions?.autoPrintByTemplate || {}),
          },
        },
        signatureBoxes: Array.isArray(incomingModuleSettings?.signatureBoxes)
          ? incomingModuleSettings.signatureBoxes
          : Array.isArray(prevMs.signatureBoxes)
          ? prevMs.signatureBoxes
          : [],
      } as ModuleSettingsConfig,
    };
    for (const adm of db.ipdAdmissions || []) {
      if (adm.disposition === 'Admitted') {
        recalcIpdFinancials(adm, db.settings.moduleSettings);
      }
    }
    appendAudit(
      db,
      actor,
      'SETTINGS',
      'SYSTEM_SETTINGS_UPDATED',
      'HOSPITAL-CONFIG',
      `Updated Hospital settings & print defaults (Hospital: ${db.settings.labName}, FY: ${db.settings.activeFiscalYear}, Default Paper: ${db.settings.moduleSettings?.printOptions?.defaultPaperSize || 'A5'}).`
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });

  // One-Computer Auto-Sync JSON Backup Snapshot
  app.get('/api/system/backup-snapshot', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (!hasPermission(db, actor.roleId, 'settings.manage') && !hasPermission(db, actor.roleId, 'finance.view')) {
      res.status(403).json({ error: 'Access denied for system backup snapshot.' });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="saptari-hospital-backup-${stamp}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), hospital: db.settings.labName, database: db }, null, 2));
  });

  // Rotating Local Server Disk Backups (./data/backups/) + Snapshot Restore
  app.get('/api/system/local-backups', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!hasPermission(db, actor.roleId, 'settings.manage') && !hasPermission(db, actor.roleId, 'finance.view')) {
      res.status(403).json({ error: 'Access denied for server backup history.' });
      return;
    }
    res.json({ backups: listLocalBackups() });
  });

  app.post('/api/system/local-backups', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (!hasPermission(db, actor.roleId, 'settings.manage') && !hasPermission(db, actor.roleId, 'finance.view')) {
      res.status(403).json({ error: 'Access denied for creating server backups.' });
      return;
    }
    const body = (req.body || {}) as { label?: string };
    const created = createLocalBackup(body.label || 'manual');
    appendAudit(
      db,
      actor,
      'SETTINGS',
      'LOCAL_DISK_BACKUP_CREATED',
      created.filename,
      `Created rotating server disk backup (${created.filename}, ${Math.round(created.sizeBytes / 1024)} KB).`
    );
    saveDb(db);
    res.status(201).json({ backup: created, backups: listLocalBackups() });
  });

  app.get('/api/system/local-backups/:filename', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (!hasPermission(db, actor.roleId, 'settings.manage') && !hasPermission(db, actor.roleId, 'finance.view')) {
      res.status(403).json({ error: 'Access denied to download server backup.' });
      return;
    }
    try {
      const cleanName = path.basename(req.params.filename || '');
      const file = readLocalBackup(cleanName);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${cleanName}"`);
      res.send(file.rawText);
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Backup file not found.' });
    }
  });

  app.delete('/api/system/local-backups/:filename', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin (SUPER_ADMIN) can delete server disk backups.' });
      return;
    }
    try {
      const cleanName = path.basename(req.params.filename || '');
      deleteLocalBackup(cleanName);
      appendAudit(
        db,
        actor,
        'SETTINGS',
        'LOCAL_DISK_BACKUP_DELETED',
        cleanName,
        `Deleted server disk backup ${cleanName}.`,
        'WARNING'
      );
      saveDb(db);
      res.json({ ok: true, backups: listLocalBackups() });
    } catch (err: any) {
      res.status(404).json({ error: err?.message || 'Backup file not found.' });
    }
  });

  app.post('/api/system/restore-snapshot', withAuth(), (req: Request, res: Response) => {
    const { actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin (SUPER_ADMIN) can restore hospital backups.' });
      return;
    }
    const body = (req.body || {}) as {
      database?: any;
      backupFilename?: string;
      sourceLabel?: string;
    };

    try {
      let candidate: any = body.database;
      let resolvedSource = body.sourceLabel || 'Uploaded Backup Snapshot';

      if (body.backupFilename && !candidate) {
        const cleanName = path.basename(body.backupFilename);
        const file = readLocalBackup(cleanName);
        const parsed = JSON.parse(file.rawText);
        candidate = parsed?.database || parsed;
        resolvedSource = `Server Disk Backup (${cleanName})`;
      } else if (candidate && candidate.database && candidate.database.settings) {
        candidate = candidate.database;
      }

      const restored = restoreDbFromSnapshot(candidate);
      appendAudit(
        restored.db,
        actor,
        'SETTINGS',
        'DATABASE_SNAPSHOT_RESTORED',
        restored.safetyBackup.filename,
        `Restored full hospital database from ${resolvedSource}. Pre-restore safety snapshot saved as ${restored.safetyBackup.filename}.`,
        'CRITICAL'
      );
      saveDb(restored.db);
      res.json({
        ok: true,
        safetyBackup: restored.safetyBackup,
        backups: listLocalBackups(),
        db: scopeDbForActor(restored.db, actor),
      });
    } catch (err: any) {
      res.status(400).json({ error: err?.message || 'Invalid backup snapshot payload.' });
    }
  });

  // --- PATIENT MASTER CRUD (Admin-Only Edit & Delete) ---
  app.post('/api/patients', withAuth('orders.create'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<PatientRecord> & { chronicHistory?: string };
    if (!body.fullName?.trim()) {
      res.status(400).json({ error: 'Patient full name is required.' });
      return;
    }
    const created = upsertPatientMaster(db, {
      uhid: body.uhid,
      fullName: body.fullName,
      age: Number(body.age) || 30,
      ageType: body.ageType || 'Years',
      gender: body.gender || 'Male',
      phone: body.phone,
      address: body.address,
      email: body.email,
      actorName: actor.fullName,
    });
    if (body.bloodGroup) created.bloodGroup = body.bloodGroup;
    if (body.allergies) created.allergies = body.allergies;
    if (body.pastMedicalHistory || body.chronicHistory) {
      created.pastMedicalHistory = body.pastMedicalHistory || body.chronicHistory;
    }
    appendAudit(db, actor, 'OPD_IPD', 'PATIENT_REGISTERED', created.uhid, `Registered patient ${created.fullName} (${created.uhid}).`);
    saveDb(db);
    res.status(201).json({ patient: created, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/patients/:id', withAuth('patients.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin (SUPER_ADMIN) can edit Patient Master records.' });
      return;
    }
    const pat = (db.patients || []).find((p) => p.id === req.params.id);
    if (!pat) {
      res.status(404).json({ error: 'Patient record not found.' });
      return;
    }
    Object.assign(pat, req.body);
    appendAudit(db, actor, 'OPD_IPD', 'PATIENT_UPDATED', pat.uhid, `Admin updated Patient Master record ${pat.fullName} (${pat.uhid}).`, 'WARNING');
    saveDb(db);
    res.json({ patient: pat, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/patients/:id', withAuth('patients.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Only Hospital Admin (SUPER_ADMIN) can delete Patient Master records.' });
      return;
    }
    const idx = (db.patients || []).findIndex((p) => p.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: 'Patient record not found.' });
      return;
    }
    const [removed] = db.patients.splice(idx, 1);
    appendAudit(db, actor, 'OPD_IPD', 'PATIENT_DELETED', removed.uhid, `Admin deleted patient record ${removed.fullName} (${removed.uhid}).`, 'CRITICAL');
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  // --- GATEPASS, VISITOR PASS & CLEARANCE SLIPS ---
  app.post('/api/gatepasses', withAuth('gatepass.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<GatepassVisitorRecord>;
    if (!body.personName?.trim() || !body.purpose?.trim()) {
      res.status(400).json({ error: 'Person name and purpose are required.' });
      return;
    }
    if (!Array.isArray(db.gatepasses)) db.gatepasses = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const pfx = db.settings?.moduleSettings?.gatepassPrefix || 'GP';
    const gp: GatepassVisitorRecord = {
      id: `gp-${Date.now()}`,
      passNumber: `${pfx}-${bsNow.year}-${String(db.gatepasses.length + 1).padStart(3, '0')}`,
      fiscalYear: db.settings.activeFiscalYear,
      passType: body.passType || 'VISITOR',
      personName: body.personName.trim(),
      phone: body.phone?.trim() || '',
      purpose: body.purpose.trim(),
      departmentOrWard: body.departmentOrWard?.trim() || 'Main Hospital Ward',
      linkedPatientOrRef: body.linkedPatientOrRef?.trim() || '',
      vehicleOrBagInfo: body.vehicleOrBagInfo?.trim() || '',
      validUntil: body.validUntil?.trim() || 'Today 20:00',
      issuedAt: nowIso,
      issuedBy: actor.fullName,
      status: 'Active',
    };
    db.gatepasses.unshift(gp);
    appendAudit(db, actor, 'OPD_IPD', 'GATEPASS_ISSUED', gp.passNumber, `Issued ${gp.passType} ${gp.passNumber} for ${gp.personName}.`);
    saveDb(db);
    res.status(201).json({ gatepass: gp, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/gatepasses/:id/clear', withAuth('gatepass.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const gp = (db.gatepasses || []).find((g) => g.id === req.params.id);
    if (!gp) {
      res.status(404).json({ error: 'Gatepass not found.' });
      return;
    }
    gp.status = 'Cleared / Exited';
    gp.clearanceVerifiedBy = actor.fullName;
    appendAudit(db, actor, 'OPD_IPD', 'GATEPASS_CLEARED', gp.passNumber, `Cleared ${gp.passType} ${gp.passNumber} (${gp.personName}).`);
    saveDb(db);
    res.json({ gatepass: gp, db: scopeDbForActor(db, actor) });
  });

  // --- ATTENDANCE (HIKVISION BIOMETRIC, DYNAMIC QR SCAN & MOBILE GPS) ---
  app.post('/api/attendance/punch', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<AttendancePunchRecord> & { targetStaffId?: string };
    const targetStaff = (body.targetStaffId && db.staff.find((s) => s.id === body.targetStaffId)) || actor;
    if (!Array.isArray(db.attendanceLogs)) db.attendanceLogs = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const punch: AttendancePunchRecord = {
      id: `att-${Date.now()}`,
      staffId: targetStaff.id,
      staffName: targetStaff.fullName,
      employeeCode: targetStaff.employeeCode,
      department: targetStaff.department,
      timestamp: nowIso,
      bsDate: bsNow.formattedEn,
      mode: body.mode || 'QR_SCAN',
      deviceIdOrIp: body.deviceIdOrIp?.trim() || req.ip || 'HOSP-QR-GATE-01',
      punchType: body.punchType || 'CHECK_IN',
      shiftLabel: body.shiftLabel || targetStaff.shift || 'Morning',
      verificationCode: body.verificationCode || `VER-${Date.now().toString().slice(-4)}`,
    };
    db.attendanceLogs.unshift(punch);
    appendAudit(db, actor, 'PERSONNEL', 'ATTENDANCE_PUNCHED', targetStaff.employeeCode, `${targetStaff.fullName} ${punch.punchType} via ${punch.mode} (${punch.shiftLabel}).`);
    saveDb(db);
    res.status(201).json({ punch, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/attendance/override', withAuth('personnel.manage', 'hr_payroll'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { punchId, staffId, punchType, timestamp, shiftLabel, reason } = req.body as {
      punchId?: string;
      staffId?: string;
      punchType?: AttendancePunchRecord['punchType'];
      timestamp?: string;
      shiftLabel?: string;
      reason: string;
    };
    if (!reason?.trim()) {
      res.status(400).json({ error: 'HR manual override requires a clear audit reason.' });
      return;
    }
    if (!Array.isArray(db.attendanceLogs)) db.attendanceLogs = [];
    const nowIso = new Date().toISOString();
    const targetTimestamp = timestamp?.trim() ? new Date(timestamp).toISOString() : nowIso;
    const bsDate = adToBs(targetTimestamp).formattedEn;

    if (punchId) {
      const existing = db.attendanceLogs.find((p) => p.id === punchId);
      if (!existing) {
        res.status(404).json({ error: 'Attendance log entry not found.' });
        return;
      }
      if (!existing.originalTimestamp) existing.originalTimestamp = existing.timestamp;
      existing.timestamp = targetTimestamp;
      existing.bsDate = bsDate;
      if (punchType) existing.punchType = punchType;
      if (shiftLabel) existing.shiftLabel = shiftLabel;
      existing.isManualOverride = true;
      existing.overrideReason = reason.trim();
      existing.overriddenBy = actor.fullName;
      existing.overriddenAt = nowIso;

      appendAudit(
        db,
        actor,
        'PERSONNEL',
        'ATTENDANCE_HR_OVERRIDE',
        existing.employeeCode,
        `HR adjusted attendance punch for ${existing.staffName} (${existing.originalTimestamp} -> ${existing.timestamp}). Reason: ${reason.trim()}`,
        'WARNING'
      );
      saveDb(db);
      res.json({ punch: existing, db: scopeDbForActor(db, actor) });
      return;
    }

    const staff = db.staff.find((s) => s.id === staffId);
    if (!staff) {
      res.status(400).json({ error: 'Staff member is required for a new HR manual attendance record.' });
      return;
    }
    const created: AttendancePunchRecord = {
      id: `att-ovr-${Date.now()}`,
      staffId: staff.id,
      staffName: staff.fullName,
      employeeCode: staff.employeeCode,
      department: staff.department,
      timestamp: targetTimestamp,
      bsDate,
      mode: 'ADMIN_MANUAL',
      deviceIdOrIp: 'HR-OVERRIDE-DESK',
      punchType: punchType || 'CHECK_IN',
      shiftLabel: shiftLabel || staff.shift || 'Morning',
      verificationCode: `OVR-${Date.now().toString().slice(-4)}`,
      isManualOverride: true,
      overrideReason: reason.trim(),
      overriddenBy: actor.fullName,
      overriddenAt: nowIso,
    };
    db.attendanceLogs.unshift(created);
    appendAudit(
      db,
      actor,
      'PERSONNEL',
      'ATTENDANCE_HR_OVERRIDE',
      staff.employeeCode,
      `HR recorded manual ${created.punchType} override for ${staff.fullName} at ${created.timestamp}. Reason: ${reason.trim()}`,
      'WARNING'
    );
    saveDb(db);
    res.status(201).json({ punch: created, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/attendance/hikvision-sync', withAuth('personnel.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = (req.body || {}) as { staffId?: string; punchType?: 'CHECK_IN' | 'CHECK_OUT'; deviceIp?: string };
    const ms = db.settings?.moduleSettings;
    const deviceIp = body.deviceIp || `${ms?.hikvisionDeviceIp || '192.168.1.210'}:${ms?.hikvisionDevicePort || 80}`;
    if (!Array.isArray(db.attendanceLogs)) db.attendanceLogs = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const staffList = body.staffId ? db.staff.filter((s) => s.id === body.staffId) : db.staff.slice(0, 3);
    const added: AttendancePunchRecord[] = [];
    for (const st of staffList) {
      const rec: AttendancePunchRecord = {
        id: `hik-${Date.now()}-${st.id}`,
        staffId: st.id,
        staffName: st.fullName,
        employeeCode: st.employeeCode,
        department: st.department,
        timestamp: nowIso,
        bsDate: bsNow.formattedEn,
        mode: 'HIKVISION_BIOMETRIC',
        deviceIdOrIp: `ISAPI@${deviceIp}`,
        punchType: body.punchType || 'CHECK_IN',
        shiftLabel: st.shift || 'Morning',
        verificationCode: `HIK-${Math.floor(1000 + Math.random() * 8999)}`,
      };
      db.attendanceLogs.unshift(rec);
      added.push(rec);
    }
    appendAudit(db, actor, 'PERSONNEL', 'HIKVISION_ISAPI_SYNCED', deviceIp, `Synced ${added.length} Hikvision biometric log(s) from ${deviceIp}.`);
    saveDb(db);
    res.status(201).json({ syncedCount: added.length, added, db: scopeDbForActor(db, actor) });
  });

  // --- SHIFT HANDOVER (SENT -> ACCEPT OR REQUEST REVISION AUDIT TRAIL) ---
  app.post('/api/handovers', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<DutyHandoverRecord>;
    if (!body.summaryNotes?.trim()) {
      res.status(400).json({ error: 'Shift handover summary notes are required.' });
      return;
    }
    if (!Array.isArray(db.shiftHandovers)) db.shiftHandovers = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const ho: DutyHandoverRecord = {
      id: `ho-${Date.now()}`,
      handoverNumber: `HO-${bsNow.year}-${String(db.shiftHandovers.length + 1).padStart(3, '0')}`,
      createdAt: nowIso,
      bsDate: bsNow.formattedEn,
      fromShift: body.fromShift || actor.shift || 'Morning',
      toShift: body.toShift || 'Afternoon',
      department: body.department?.trim() || actor.department,
      outgoingStaffId: actor.id,
      outgoingStaffName: actor.fullName,
      incomingStaffId: body.incomingStaffId,
      incomingStaffName: body.incomingStaffName?.trim() || 'Next Shift Duty Staff',
      summaryNotes: body.summaryNotes.trim(),
      pendingTasks: body.pendingTasks?.trim() || 'None',
      cashOrKeysCount: body.cashOrKeysCount?.trim() || 'All keys & ward register handed over',
      status: 'SENT',
      auditTrail: [
        {
          id: `ho-aud-${Date.now()}`,
          timestamp: nowIso,
          action: 'SUBMITTED',
          actorName: actor.fullName,
          note: `Submitted handover for ${body.toShift || 'next'} shift (${body.pendingTasks?.trim() || 'No pending items'}).`,
        },
      ],
    };
    db.shiftHandovers.unshift(ho);
    appendAudit(db, actor, 'PERSONNEL', 'SHIFT_HANDOVER_SENT', ho.handoverNumber, `${actor.fullName} submitted shift handover ${ho.handoverNumber} (${ho.fromShift} -> ${ho.toShift}).`);
    saveDb(db);
    res.status(201).json({ handover: ho, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/handovers/:id/respond', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const ho = (db.shiftHandovers || []).find((h) => h.id === req.params.id);
    if (!ho) {
      res.status(404).json({ error: 'Shift handover record not found.' });
      return;
    }
    const { decision, comment } = req.body as {
      decision: 'ACCEPT' | 'REQUEST_REVISION';
      comment?: string;
    };
    if (decision === 'REQUEST_REVISION' && !comment?.trim()) {
      res.status(400).json({ error: 'Please specify what revision or clarification is needed.' });
      return;
    }
    const nowIso = new Date().toISOString();
    if (!Array.isArray(ho.auditTrail)) ho.auditTrail = [];

    if (decision === 'ACCEPT') {
      ho.status = 'RECEIVED_APPROVED';
      ho.receivedAt = nowIso;
      ho.approvedBy = actor.fullName;
      ho.incomingStaffId = actor.id;
      ho.incomingStaffName = actor.fullName;
      ho.revisionNote = undefined;
      ho.auditTrail.push({
        id: `ho-aud-${Date.now()}`,
        timestamp: nowIso,
        action: 'ACCEPTED',
        actorName: actor.fullName,
        note: comment?.trim() || 'Incoming shift staff verified pending tasks, keys, and ward register.',
      });
      appendAudit(db, actor, 'PERSONNEL', 'SHIFT_HANDOVER_ACCEPTED', ho.handoverNumber, `${actor.fullName} accepted shift handover ${ho.handoverNumber}.`);
    } else {
      ho.status = 'REVISION_REQUESTED';
      ho.revisionNote = comment!.trim();
      ho.incomingStaffId = actor.id;
      ho.incomingStaffName = actor.fullName;
      ho.auditTrail.push({
        id: `ho-aud-${Date.now()}`,
        timestamp: nowIso,
        action: 'REVISION_REQUESTED',
        actorName: actor.fullName,
        note: comment!.trim(),
      });
      appendAudit(
        db,
        actor,
        'PERSONNEL',
        'SHIFT_HANDOVER_REVISION_REQUESTED',
        ho.handoverNumber,
        `${actor.fullName} requested revision on handover ${ho.handoverNumber}: ${comment!.trim()}`,
        'WARNING'
      );
    }

    saveDb(db);
    res.json({ handover: ho, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/handovers/:id/receive-approve', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const ho = (db.shiftHandovers || []).find((h) => h.id === req.params.id);
    if (!ho) {
      res.status(404).json({ error: 'Shift handover record not found.' });
      return;
    }
    const nowIso = new Date().toISOString();
    ho.status = 'RECEIVED_APPROVED';
    ho.receivedAt = nowIso;
    ho.approvedBy = actor.fullName;
    ho.incomingStaffId = actor.id;
    ho.incomingStaffName = actor.fullName;
    if (!Array.isArray(ho.auditTrail)) ho.auditTrail = [];
    ho.auditTrail.push({
      id: `ho-aud-${Date.now()}`,
      timestamp: nowIso,
      action: 'ACCEPTED',
      actorName: actor.fullName,
      note: 'Incoming staff acknowledged and accepted shift handover.',
    });
    appendAudit(db, actor, 'PERSONNEL', 'SHIFT_HANDOVER_RECEIVED', ho.handoverNumber, `${actor.fullName} received & approved shift handover ${ho.handoverNumber}.`);
    saveDb(db);
    res.json({ handover: ho, db: scopeDbForActor(db, actor) });
  });

  // --- HOSPITAL STORE DEPARTMENT REQUISITION / ISSUE ---
  app.post('/api/store/requisitions', withAuth('inventory.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as {
      department: StoreRequisitionRecord['department'];
      requestedBy?: string;
      notes?: string;
      items: Array<{ reagentId: string; qty: number }>;
    };
    if (!body.department || !Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: 'Department and at least one item are required for store issue.' });
      return;
    }
    if (!Array.isArray(db.storeRequisitions)) db.storeRequisitions = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const issuedItems: StoreRequisitionRecord['items'] = [];

    for (const reqLine of body.items) {
      const r = db.reagents.find((x) => x.id === reqLine.reagentId);
      const q = Math.max(1, Number(reqLine.qty) || 1);
      if (!r) continue;
      if (r.currentStock < q) {
        res.status(400).json({ error: `Insufficient store stock for ${r.name} (available: ${r.currentStock} ${r.unit}).` });
        return;
      }
      r.currentStock = Number((r.currentStock - q).toFixed(2));
      issuedItems.push({ reagentId: r.id, reagentName: r.name, qty: q, unit: r.unit });
      db.inventoryMovements.unshift({
        id: `mov-str-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        reagentId: r.id,
        reagentName: r.name,
        lotNumber: r.lotNumber,
        type: 'ADJUSTMENT',
        quantityDelta: -q,
        balanceAfter: r.currentStock,
        referenceId: `STR-${bsNow.year}-${db.storeRequisitions.length + 1}`,
        performedBy: actor.fullName,
        notes: `Store Issued to ${body.department} (Req by ${body.requestedBy || actor.fullName})`,
      });
    }

    const reqRec: StoreRequisitionRecord = {
      id: `str-${Date.now()}`,
      reqNumber: `STR-${bsNow.year}-${String(db.storeRequisitions.length + 1).padStart(3, '0')}`,
      createdAt: nowIso,
      fiscalYear: db.settings.activeFiscalYear,
      department: body.department,
      requestedBy: body.requestedBy?.trim() || actor.fullName,
      issuedBy: actor.fullName,
      items: issuedItems,
      status: 'Issued',
      notes: body.notes?.trim() || '',
    };
    db.storeRequisitions.unshift(reqRec);
    appendAudit(db, actor, 'INVENTORY', 'STORE_REQUISITION_ISSUED', reqRec.reqNumber, `Issued ${issuedItems.length} store item(s) to ${reqRec.department}.`);
    saveDb(db);
    res.status(201).json({ requisition: reqRec, db: scopeDbForActor(db, actor) });
  });

  // --- FIELD MARKETING VISIT LOG (AREA, GPS, PHOTO UPLOAD) ---
  app.post('/api/marketing/visits', withAuth('marketing.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<MarketingVisitRecord>;
    if (!body.areaName?.trim() || !body.facilityOrDoctorName?.trim()) {
      res.status(400).json({ error: 'Area Name and Doctor/Clinic Name are required.' });
      return;
    }
    if (!Array.isArray(db.marketingVisits)) db.marketingVisits = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const visit: MarketingVisitRecord = {
      id: `mkt-${Date.now()}`,
      visitNumber: `MKT-${bsNow.year}-${String(db.marketingVisits.length + 1).padStart(3, '0')}`,
      visitedAt: nowIso,
      bsDate: bsNow.formattedEn,
      areaName: body.areaName.trim(),
      municipality: body.municipality?.trim() || 'Saptari District',
      facilityOrDoctorName: body.facilityOrDoctorName.trim(),
      contactPerson: body.contactPerson?.trim() || body.facilityOrDoctorName.trim(),
      phone: body.phone?.trim() || '',
      gpsLat: body.gpsLat !== undefined ? Number(body.gpsLat) : undefined,
      gpsLng: body.gpsLng !== undefined ? Number(body.gpsLng) : undefined,
      gpsAccuracyM: body.gpsAccuracyM !== undefined ? Number(body.gpsAccuracyM) : undefined,
      photoDataUrl: body.photoDataUrl,
      notes: body.notes?.trim() || '',
      staffId: actor.id,
      staffName: actor.fullName,
      status: body.status || 'Logged',
    };
    db.marketingVisits.unshift(visit);
    appendAudit(db, actor, 'REFERRALS', 'MARKETING_VISIT_LOGGED', visit.visitNumber, `Field marketing visit logged in ${visit.areaName} (${visit.facilityOrDoctorName}).`);
    saveDb(db);
    res.status(201).json({ visit, db: scopeDbForActor(db, actor) });
  });

  // --- HOSPITAL-ONLY PERIMETER GUARD CHECK ---
  app.post('/api/access/verify-perimeter', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (actor.roleId === 'SUPER_ADMIN') {
      res.json({ verified: true, bypass: 'SUPER_ADMIN' });
      return;
    }
    const { wifiCode } = (req.body || {}) as { wifiCode?: string };
    const expectedCode = (db.settings?.moduleSettings?.hospitalWifiCheckCode || 'SAPTARI-HOSP-2083').trim();
    if (wifiCode && wifiCode.trim() === expectedCode) {
      res.json({ verified: true });
      return;
    }
    res.status(403).json({ error: 'Invalid Hospital Premises Check-In Code. Ask Reception or Hospital Admin.' });
  });

  // Full Project Source Code ZIP (STRICTLY HOSPITAL ADMIN ONLY)
  app.get('/api/system/download-source', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Hospital Admin (SUPER_ADMIN) role required to download source code.' });
      return;
    }

    const rootDir = process.cwd();
    // Include pre-built dist/ and dist-server/ so Linux Node-only hosts can start immediately without building Vite on low-RAM hosting
    const excludedDirs = new Set(['node_modules', 'dev-dist', '.git', '.next', '.vite', 'coverage']);
    const entries: ZipEntryInput[] = [];

    const walk = (dir: string, relBase: string) => {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (excludedDirs.has(item.name)) continue;
        if (
          item.name === '.DS_Store' ||
          item.name.endsWith('.tmp') ||
          item.name.endsWith('.log') ||
          item.name.endsWith('.bak') ||
          item.name.endsWith('.zip')
        ) {
          continue;
        }
        const fullPath = path.join(dir, item.name);
        const zipRel = relBase ? `${relBase}/${item.name}` : item.name;
        if (zipRel === 'data/backups' || zipRel.startsWith('data/backups/')) {
          continue;
        }
        if (item.isDirectory()) {
          walk(fullPath, zipRel);
        } else if (item.isFile()) {
          try {
            entries.push({ name: `hospital-erp-cloud/${zipRel}`, content: fs.readFileSync(fullPath) });
          } catch {
            // skip unreadable files
          }
        }
      }
    };
    walk(rootDir, '');

    if (!fs.existsSync(path.join(rootDir, 'data'))) {
      entries.push({ name: 'hospital-erp-cloud/data/.gitkeep', content: '' });
    }
    entries.push({ name: 'hospital-erp-cloud/data/backups/.gitkeep', content: '' });

    // Fast 1-Command Cloud & Linux Node-Only Installers (Docker + Ubuntu/Debian VPS + cPanel/CloudLinux)
    entries.push({
      name: 'hospital-erp-cloud/Dockerfile',
      content: `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
VOLUME ["/app/data"]
CMD ["node", "app.cjs"]
`,
    });
    entries.push({
      name: 'hospital-erp-cloud/docker-compose.yml',
      content: `services:
  hospital-erp:
    build: .
    container_name: hospital-erp-cloud
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
`,
    });
    entries.push({
      name: 'hospital-erp-cloud/install-cloud.sh',
      content: `#!/usr/bin/env bash
set -e
echo "=== Fast Linux Node.js Installer (Saptari Hospital ERP) ==="
mkdir -p ./data
npm install --omit=dev
if [ ! -f "dist/index.html" ] || [ ! -f "dist-server/server.js" ]; then
  npm install
  npm run build
fi
echo "Installation complete! Starting server on port \${PORT:-3000}..."
NODE_ENV=production node app.cjs
`,
    });
    entries.push({
      name: 'hospital-erp-cloud/CLOUD_INSTALL.md',
      content: `# Linux Node.js & CloudLinux Quick Installation Guide

This archive comes **PRE-BUILT** (\`dist/\` + \`dist-server/server.js\` + \`app.cjs\`) so you can upload and run it on Linux servers that support **only Node.js** without needing heavy frontend compilation on the host.

## Option A: CloudLinux Node.js Selector (cPanel / DirectAdmin Shared Hosting)
1. Upload & extract this ZIP into your domain app folder (e.g. \`~/hospital-erp\`).
2. In **cPanel -> Setup Node.js App**:
   - **Node.js version**: Select **18.x / 20.x / 22.x LTS**
   - **Application mode**: **Production**
   - **Application root**: \`hospital-erp\`
   - **Application startup file**: \`app.cjs\`
3. Click **Run NPM Install** (or SSH: \`npm install --omit=dev\`).
4. Ensure \`data/\` folder exists & is writable, then click **Restart App**. No build step needed — Phusion Passenger injects \`PORT\` automatically!

## Option B: Linux Node.js-Only Hosting / SSH / VPS
\`\`\`bash
bash start-linux.sh
\`\`\`
Or manually:
\`\`\`bash
npm install --omit=dev
NODE_ENV=production PORT=3000 node app.cjs
\`\`\`
Or with PM2 process manager:
\`\`\`bash
npm install --omit=dev && pm2 start ecosystem.config.cjs && pm2 save
\`\`\`

## Option C: Rebuilding After Modifying TypeScript / React Source
\`\`\`bash
npm install && npm run build && NODE_ENV=production node app.cjs
\`\`\`

## Option D: Windows PC / LAN Server
Double-click \`Start-SHPL-Windows-Server.bat\` (installs dependencies once if needed, opens firewall/browser on port 3000 for local hospital Wi-Fi / LAN access).

## Data Persistence
All live records are stored atomically in \`./data/lims-db.json\`. Mount or keep \`./data\` backed up regularly.
`,
    });

    const zipBuffer = buildZipBuffer(entries);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="hospital-erp-linux-node-source.zip"');
    res.send(zipBuffer);
  });

  // Direct Chrome Extension (Manifest V3) ZIP Download (STRICTLY HOSPITAL ADMIN ONLY)
  app.get('/api/downloads/chrome-extension', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Restricted: Software downloads are available exclusively to Hospital Admin (SUPER_ADMIN).' });
      return;
    }
    const lanIp = db.settings?.moduleSettings?.lanServerHostIp || '';
    const customUrl = typeof req.query.serverUrl === 'string' && req.query.serverUrl.trim() ? req.query.serverUrl.trim() : '';
    const baseUrl = customUrl || (lanIp ? `http://${lanIp}:${PORT}` : `${req.protocol}://${req.get('host') || 'saptarihospital.com'}`);
    const entries: ZipEntryInput[] = [
      {
        name: 'saptari-hospital-chrome-ext/manifest.json',
        content: JSON.stringify(
          {
            manifest_version: 3,
            name: 'Saptari Hospital ERP — Fast Clinical & POS Launcher',
            version: '1.0.0',
            description: 'Zero-install Chrome extension launcher for Saptari Hospital Pvt Ltd (POS, Pharmacy FEFO, ER/MLC & Finance Approvals). Engineered & Developed by Dr. Santosh Majhi.',
            action: {
              default_popup: 'popup.html',
              default_title: 'Open Saptari Hospital ERP',
            },
            permissions: ['storage', 'tabs'],
            icons: {
              '192': 'icon192.png',
              '512': 'icon512.png',
            },
          },
          null,
          2
        ),
      },
      {
        name: 'saptari-hospital-chrome-ext/popup.html',
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Saptari Hospital ERP</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 300px; margin: 0; padding: 14px; background: #f8fafc; color: #0f172a; }
    h1 { font-size: 14px; margin: 0 0 4px; }
    p { font-size: 11px; color: #475569; margin: 0 0 12px; }
    label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; }
    input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 10px; }
    button { width: 100%; padding: 9px 12px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; margin-bottom: 6px; }
    button.secondary { background: #ffffff; color: #0f172a; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <h1>Saptari Hospital Pvt Ltd</h1>
  <p>Bode Barsain, Saptari · Hotline: 97-1515-6677</p>
  <label for="serverUrl">Hospital LAN / Cloud Server URL</label>
  <input id="serverUrl" type="url" value="${baseUrl}" />
  <button id="openErp">Open Hospital ERP Workspace</button>
  <button id="saveUrl" class="secondary">Save Custom Host URL</button>
  <script src="popup.js"></script>
</body>
</html>`,
      },
      {
        name: 'saptari-hospital-chrome-ext/popup.js',
        content: `document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('serverUrl');
  chrome.storage.local.get(['erpUrl'], (res) => {
    if (res && res.erpUrl) input.value = res.erpUrl;
  });
  document.getElementById('saveUrl').addEventListener('click', () => {
    chrome.storage.local.set({ erpUrl: input.value.trim() });
  });
  document.getElementById('openErp').addEventListener('click', () => {
    const url = input.value.trim() || '${baseUrl}';
    chrome.storage.local.set({ erpUrl: url });
    chrome.tabs.create({ url });
  });
});`,
      },
      {
        name: 'saptari-hospital-chrome-ext/README-INSTALL.txt',
        content: `SAPTARI HOSPITAL CHROME EXTENSION (UNPACKED INSTALL)
1. Unzip this folder to a permanent location (e.g. C:\\SaptariHospitalChromeExt).
2. Open Chrome -> chrome://extensions/
3. Enable "Developer mode" (top right toggle).
4. Click "Load unpacked" and select the extracted folder.
5. Pin "Saptari Hospital ERP" to your Chrome toolbar for 1-click access.
`,
      },
    ];
    const icon192 = path.resolve(process.cwd(), 'public', 'pwa-192x192.png');
    const icon512 = path.resolve(process.cwd(), 'public', 'pwa-512x512.png');
    if (fs.existsSync(icon192)) entries.push({ name: 'saptari-hospital-chrome-ext/icon192.png', content: fs.readFileSync(icon192) });
    if (fs.existsSync(icon512)) entries.push({ name: 'saptari-hospital-chrome-ext/icon512.png', content: fs.readFileSync(icon512) });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="saptari-hospital-chrome-extension.zip"');
    res.send(buildZipBuffer(entries));
  });

  // Windows 10/11 Desktop App Launcher + 1-PC LAN Server Multi-Client Shortcut + Backup Agent ZIP (STRICTLY ADMIN)
  app.get('/api/downloads/windows-installer', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Restricted: Windows Installer kit is available exclusively to Hospital Admin (SUPER_ADMIN).' });
      return;
    }
    const queryServerIp = typeof req.query.serverIp === 'string' ? req.query.serverIp.trim() : '';
    const queryServerUrl = typeof req.query.serverUrl === 'string' ? req.query.serverUrl.trim() : '';
    const detectedIp = getLocalLanIps()[0];
    const lanIp = queryServerIp || detectedIp || db.settings?.moduleSettings?.lanServerHostIp || '192.168.1.100';
    const lanUrl = queryServerUrl || `http://${lanIp}:${PORT}`;
    const baseUrl = queryServerUrl || `${req.protocol}://${req.get('host') || 'saptarihospital.com'}`;
    const entries: ZipEntryInput[] = [
      {
        name: 'saptari-hospital-windows/Install-SHPL-Windows-App.bat',
        content: `@echo off
TITLE SHPL - Saptari Hospital Pvt Ltd Windows Desktop App Setup
echo Creating Desktop Shortcut for SHPL (${lanUrl})...
set DESKTOP=%USERPROFILE%\\Desktop
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%DESKTOP%\\SHPL.lnk'); $Shortcut.TargetPath = 'msedge.exe'; $Shortcut.Arguments = '--app=${lanUrl}'; $Shortcut.Save()"
echo Desktop App Shortcut (SHPL) created! Pointed to ${lanUrl}
echo To connect other counter Windows PCs on hospital Wi-Fi/LAN, run Connect-Client-PC.bat on each client PC.
pause
`,
      },
      {
        name: 'saptari-hospital-windows/Connect-Client-PC.bat',
        content: `@echo off
TITLE Connect Same-Wi-Fi Client PC to Main SHPL Windows Server
set /p HOSTIP="Enter Main Windows Server Wi-Fi IP Address (Default ${lanIp}): "
if "%HOSTIP%"=="" set HOSTIP=${lanIp}
set TARGETURL=http://%HOSTIP%:${PORT}
set DESKTOP=%USERPROFILE%\\Desktop
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%DESKTOP%\\SHPL.lnk'); $Shortcut.TargetPath = 'msedge.exe'; $Shortcut.Arguments = '--app=%TARGETURL%'; $Shortcut.Save()"
echo SHPL client shortcut created on Desktop for %TARGETURL%!
start msedge.exe --app=%TARGETURL%
`,
      },
      {
        name: 'saptari-hospital-windows/AutoSync-Backup.ps1',
        content: `# SHPL 1-Computer Auto-Sync Backup Script
param(
  [string]$ServerUrl = "${lanUrl}",
  [string]$BackupDir = "$env:USERPROFILE\\Documents\\SHPL_Backups"
)
if (!(Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutFile = Join-Path $BackupDir "shpl-backup-$Stamp.json"
$LatestFile = Join-Path $BackupDir "shpl-latest.json"
try {
  Invoke-WebRequest -Uri "$ServerUrl/api/system/backup-snapshot" -Headers @{ "x-user-id" = "staff-1" } -OutFile $LatestFile -UseBasicParsing
  Copy-Item $LatestFile $OutFile -Force
  Write-Host "Synced backup successfully to $OutFile"
} catch {
  Write-Error "Backup sync failed: $_"
}
`,
      },
      {
        name: 'saptari-hospital-windows/Setup-AutoBackup-Task.bat',
        content: `@echo off
schtasks /Create /SC MINUTE /MO 10 /TN "SHPL_AutoSyncBackup" /TR "powershell.exe -ExecutionPolicy Bypass -File %~dp0AutoSync-Backup.ps1" /F
echo Scheduled 10-minute 1-Computer Auto-Sync Backup task registered!
pause
`,
      },
      {
        name: 'saptari-hospital-windows/README-WINDOWS.txt',
        content: `SHPL (SAPTARI HOSPITAL PVT LTD) — 1-PC WINDOWS SERVER & SAME-WIFI LAN KIT
Engineered & Developed by Dr. Santosh Majhi

1. ONE WINDOWS PC AS SERVER:
   - Extract the Full Source Code ZIP on your Main Windows Server PC.
   - Double-click "Start-SHPL-Windows-Server.bat" inside the source folder.
   - It automatically opens Windows Firewall TCP Port ${PORT}, builds SHPL, and displays your PC's Wi-Fi IPv4 address (e.g., ${lanUrl}).

2. REST OF DEVICES ON SAME WI-FI (Windows, Android, iOS):
   - Windows Counter PCs: Open Chrome/Edge to ${lanUrl} -> click "Install SHPL App" (or run Connect-Client-PC.bat).
   - Android Phones/Tablets: Open Chrome to ${lanUrl} -> Tap "Install SHPL App" (or 3-dot Menu -> Install App) -> Installs as "SHPL".
   - iPhone / iPad (iOS): Open Safari/Chrome to ${lanUrl} -> Tap Share -> "Add to Home Screen" -> Installs as "SHPL".

Current web origin: ${baseUrl}
`,
      },
    ];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="saptari-hospital-windows-installer.zip"');
    res.send(buildZipBuffer(entries));
  });

  // Android Mobile App Kit ZIP (STRICTLY HOSPITAL ADMIN ONLY)
  app.get('/api/downloads/android-app', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Restricted: Android App kit is available exclusively to Hospital Admin (SUPER_ADMIN).' });
      return;
    }
    const baseUrl = `${req.protocol}://${req.get('host') || 'saptarihospital.com'}`;
    const entries: ZipEntryInput[] = [
      {
        name: 'saptari-hospital-android/capacitor.config.json',
        content: JSON.stringify(
          {
            appId: 'com.saptarihospital.erp',
            appName: 'Saptari Hospital',
            webDir: 'dist',
            server: {
              url: baseUrl,
              cleartext: baseUrl.startsWith('http://'),
            },
          },
          null,
          2
        ),
      },
      {
        name: 'saptari-hospital-android/twa-manifest.json',
        content: JSON.stringify(
          {
            packageId: 'com.saptarihospital.erp',
            host: baseUrl.replace(/^https?:\/\//, ''),
            name: 'Saptari Hospital Pvt Ltd ERP',
            launcherName: 'Saptari Hosp',
            display: 'standalone',
            themeColor: '#0f172a',
            backgroundColor: '#f8fafc',
            startUrl: '/',
            iconUrl: `${baseUrl}/pwa-512x512.png`,
            maskableIconUrl: `${baseUrl}/pwa-maskable-512x512.png`,
          },
          null,
          2
        ),
      },
      {
        name: 'saptari-hospital-android/assetlinks.json',
        content: JSON.stringify(
          [
            {
              relation: ['delegate_permission/common.handle_all_urls'],
              target: {
                namespace: 'android_app',
                package_name: 'com.saptarihospital.erp',
                sha256_cert_fingerprints: ['REPLACE_WITH_YOUR_KEYSTORE_SHA256_FINGERPRINT'],
              },
            },
          ],
          null,
          2
        ),
      },
      {
        name: 'saptari-hospital-android/README-ANDROID.txt',
        content: `SAPTARI HOSPITAL ANDROID APP BUILD & DIRECT WEBAPK INSTALL
Option A (Zero-Build Direct Android Installation via Chrome WebAPK):
- Open ${baseUrl} in Chrome on your Android phone/tablet.
- Tap Chrome Menu (⋮) -> "Install App".
- Android automatically installs a native Home-Screen shortcut.
`,
      },
    ];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="saptari-hospital-android-kit.zip"');
    res.send(buildZipBuffer(entries));
  });

  // macOS 1-Click Web App Launcher + Auto-Sync Backup ZIP (STRICTLY HOSPITAL ADMIN ONLY)
  app.get('/api/downloads/mac-app', (req: Request, res: Response) => {
    const db = getDb();
    const actorId = req.header('x-user-id') || (typeof req.query.uid === 'string' ? req.query.uid : undefined);
    const actor = getActor(db, actorId);
    if (actor.roleId !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Restricted: macOS launcher kit is available exclusively to Hospital Admin (SUPER_ADMIN).' });
      return;
    }
    const baseUrl = `${req.protocol}://${req.get('host') || 'saptarihospital.com'}`;
    const entries: ZipEntryInput[] = [
      {
        name: 'saptari-hospital-mac/Launch-SaptariHospital.command',
        content: `#!/bin/bash
# 1-Click Saptari Hospital ERP macOS Web App Launcher
URL="${baseUrl}"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args --app="$URL"
else
  open "$URL"
fi
`,
      },
      {
        name: 'saptari-hospital-mac/AutoSync-Backup-Mac.sh',
        content: `#!/bin/bash
SERVER_URL="${baseUrl}"
BACKUP_DIR="$HOME/Documents/SaptariHospitalBackups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +"%Y%m%d-%H%M%S")
curl -sS -H "x-user-id: staff-1" "$SERVER_URL/api/system/backup-snapshot" -o "$BACKUP_DIR/saptari-hospital-latest.json"
cp "$BACKUP_DIR/saptari-hospital-latest.json" "$BACKUP_DIR/saptari-hospital-backup-$STAMP.json"
echo "Backup synced to $BACKUP_DIR"
`,
      },
      {
        name: 'saptari-hospital-mac/README-MAC.txt',
        content: `SAPTARI HOSPITAL ERP FOR MACOS (1-CLICK APP & AUTO-BACKUP)
1. Extract this folder anywhere on your Mac (Desktop or Applications).
2. Right-click Launch-SaptariHospital.command -> Open to launch Saptari Hospital ERP as a standalone native window.
`,
      },
    ];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="saptari-hospital-mac-app.zip"');
    res.send(buildZipBuffer(entries));
  });

  // ==========================================================
  // OT MANAGEMENT, PRE-OP SAFETY CHECKLIST & ANESTHESIOLOGY APIs
  // ==========================================================
  app.post('/api/ot/cases', withAuth('ot.manage', 'ot_management'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<OtSurgeryCase>;
    if (!body.patientName?.trim() || !body.procedureName?.trim() || !body.otRoomId) {
      res.status(400).json({ error: 'Patient Name, Procedure Name, and OT Room are required to schedule surgery.' });
      return;
    }
    if (!Array.isArray(db.otRooms)) db.otRooms = [];
    if (!Array.isArray(db.otCases)) db.otCases = [];
    const room = db.otRooms.find((r) => r.id === body.otRoomId) || db.otRooms[0];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const seq = db.otCases.length + 1;
    const otNumber = `OT-${bsNow.year}-${String(seq).padStart(3, '0')}`;

    const created: OtSurgeryCase = {
      id: `otcase-${Date.now()}`,
      otNumber,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      centerId: null,
      centerName: 'Saptari Hospital Main',
      otRoomId: room?.id || body.otRoomId,
      otRoomLabel: room?.name || body.otRoomLabel || 'OT-1',
      patientId: body.patientId || undefined,
      uhid: body.uhid || undefined,
      encounterType: body.encounterType || 'IPD',
      encounterId: body.encounterId || undefined,
      patientName: body.patientName.trim(),
      patientAge: Number(body.patientAge) || 30,
      patientAgeType: body.patientAgeType || 'Years',
      patientGender: body.patientGender || 'Female',
      patientPhone: body.patientPhone?.trim() || '',
      patientAddress: body.patientAddress?.trim() || 'Saptari, Nepal',
      scheduledDate: body.scheduledDate || nowIso.slice(0, 10),
      scheduledTime: body.scheduledTime || '10:00',
      procedureName: body.procedureName.trim(),
      surgicalSpecialty: body.surgicalSpecialty?.trim() || 'General Surgery',
      priority: body.priority || 'Elective',
      leadSurgeon: body.leadSurgeon?.trim() || actor.fullName,
      assistantSurgeon: body.assistantSurgeon?.trim() || undefined,
      anesthesiologist: body.anesthesiologist?.trim() || 'On-Call Anesthesiologist',
      scrubNurse: body.scrubNurse?.trim() || undefined,
      diagnosis: body.diagnosis?.trim() || 'Surgical evaluation',
      otFeeNpr: Math.max(0, Number(body.otFeeNpr) || 0),
      consumablesNotes: body.consumablesNotes?.trim() || undefined,
      status: 'Scheduled',
      recordedAt: nowIso,
      recordedBy: actor.fullName,
    };

    db.otCases.unshift(created);
    appendAudit(
      db,
      actor,
      'OT_MANAGEMENT',
      'OT_CASE_SCHEDULED',
      otNumber,
      `Scheduled OT ${otNumber}: ${created.procedureName} for ${created.patientName} in ${created.otRoomLabel}.`
    );
    saveDb(db);
    res.status(201).json({ otCase: created, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/ot/rooms/:id', withAuth('ot.manage', 'ot_management'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const room = (db.otRooms || []).find((r) => r.id === req.params.id);
    if (!room) {
      res.status(404).json({ error: 'OT Theatre Room not found.' });
      return;
    }
    const { status } = req.body as { status: 'Available' | 'Occupied' | 'Cleaning' | 'Maintenance' };
    room.status = status || room.status;
    if (room.status === 'Available' || room.status === 'Cleaning') {
      room.currentCaseId = null;
    }
    appendAudit(db, actor, 'OT_MANAGEMENT', 'OT_ROOM_UPDATED', room.roomCode, `Updated ${room.name} status to ${room.status}.`);
    saveDb(db);
    res.json({ room, db: scopeDbForActor(db, actor) });
  });

  // Mandatory Pre-Operative Safety Checklist (Creates Immutable Audit Log & Enables Surgery Start)
  app.post('/api/ot/cases/:id/preop-checklist', withAuth(undefined, 'ot_management'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (
      !hasPermission(db, actor.roleId, 'ot.view') &&
      !hasPermission(db, actor.roleId, 'ot.manage') &&
      !hasPermission(db, actor.roleId, 'ot.anesthesia')
    ) {
      res.status(403).json({ error: 'Forbidden: Insufficient permissions for OT Pre-Op Safety Checklist.' });
      return;
    }
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: 'OT surgical case not found.' });
      return;
    }
    const body = req.body as Partial<PreOpSafetyChecklist>;
    if (!body.vitalBp?.trim() || !body.vitalPulseBpm || !body.vitalSpo2Pct) {
      res.status(400).json({ error: 'Patient Pre-Op Vitals (BP, Pulse, SpO2) are mandatory.' });
      return;
    }
    if (!body.anesthesiaCleared) {
      res.status(400).json({ error: 'Anesthesia clearance sign-off is mandatory before clearing for OT.' });
      return;
    }
    if (!body.surgicalSiteVerified || !body.patientIdentityVerified || !body.consentSignedVerified) {
      res.status(400).json({
        error: 'Patient identity, written surgical consent, and surgical site verification must all be confirmed.',
      });
      return;
    }
    const nowIso = new Date().toISOString();
    const checklist: PreOpSafetyChecklist = {
      completedAt: nowIso,
      completedBy: actor.fullName,
      vitalBp: body.vitalBp.trim(),
      vitalPulseBpm: Number(body.vitalPulseBpm),
      vitalTempF: Number(body.vitalTempF) || 98.4,
      vitalSpo2Pct: Number(body.vitalSpo2Pct),
      asaGrade: body.asaGrade || 'ASA II',
      anesthesiaCleared: Boolean(body.anesthesiaCleared),
      anesthesiaClearedBy: body.anesthesiaClearedBy?.trim() || otCase.anesthesiologist || actor.fullName,
      surgicalSiteVerified: Boolean(body.surgicalSiteVerified),
      siteMarked: Boolean(body.siteMarked),
      laterality: body.laterality || 'Midline / N/A',
      procedureNameVerified: body.procedureNameVerified?.trim() || otCase.procedureName,
      patientIdentityVerified: Boolean(body.patientIdentityVerified),
      consentSignedVerified: Boolean(body.consentSignedVerified),
      npoConfirmed: Boolean(body.npoConfirmed),
      bloodCrossmatchChecked: Boolean(body.bloodCrossmatchChecked),
      equipmentSterilityChecked: Boolean(body.equipmentSterilityChecked),
      checklistNotes: body.checklistNotes?.trim() || undefined,
      clearedToStart: true,
    };

    otCase.preOpChecklist = checklist;
    if (otCase.status === 'Scheduled') {
      otCase.status = 'Pre-Op Ready';
    }

    appendAudit(
      db,
      actor,
      'OT_MANAGEMENT',
      'PREOP_CHECKLIST_SIGNED',
      otCase.otNumber,
      `Signed Mandatory Pre-Op Safety Checklist for ${otCase.otNumber} (${otCase.patientName} — ${checklist.procedureNameVerified}). Vitals BP ${checklist.vitalBp}, HR ${checklist.vitalPulseBpm}, SpO2 ${checklist.vitalSpo2Pct}%, ${checklist.asaGrade}, Site Verified (${checklist.laterality}), Anesthesia Cleared by ${checklist.anesthesiaClearedBy}.`,
      'INFO'
    );
    saveDb(db);
    res.json({ otCase, checklist, db: scopeDbForActor(db, actor) });
  });

  // Start Surgery — ENFORCES Mandatory Pre-Operative Safety Checklist Lock
  app.post('/api/ot/cases/:id/start', withAuth('ot.manage', 'ot_management'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: 'OT surgical case not found.' });
      return;
    }
    if (!otCase.preOpChecklist || !otCase.preOpChecklist.clearedToStart) {
      res.status(400).json({
        error: 'Safety Gate Blocked: Mandatory Pre-Operative Safety Checklist must be completed & signed before starting surgery.',
      });
      return;
    }
    const nowIso = new Date().toISOString();
    otCase.status = 'In Progress';
    otCase.startedAt = otCase.startedAt || nowIso;
    const room = (db.otRooms || []).find((r) => r.id === otCase.otRoomId);
    if (room) {
      room.status = 'Occupied';
      room.currentCaseId = otCase.id;
    }
    appendAudit(
      db,
      actor,
      'OT_MANAGEMENT',
      'OT_SURGERY_STARTED',
      otCase.otNumber,
      `Started surgery ${otCase.otNumber} (${otCase.procedureName}) in ${otCase.otRoomLabel} after verified Pre-Op Safety Checklist.`
    );
    saveDb(db);
    res.json({ otCase, db: scopeDbForActor(db, actor) });
  });

  // Anesthesiology Sub-Module Update (Agents, Dosing, Airway Log, Intra-Op Vitals & Response)
  app.post('/api/ot/cases/:id/anesthesia', withAuth(undefined, 'ot_management'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    if (
      !hasPermission(db, actor.roleId, 'ot.anesthesia') &&
      !hasPermission(db, actor.roleId, 'ot.manage') &&
      !hasPermission(db, actor.roleId, 'hospital.clinical')
    ) {
      res.status(403).json({ error: 'Forbidden: Missing permission ot.anesthesia or ot.manage.' });
      return;
    }
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: 'OT surgical case not found.' });
      return;
    }
    const body = req.body as Partial<OtAnesthesiaRecord>;
    const nowIso = new Date().toISOString();
    const record: OtAnesthesiaRecord = {
      anesthesiologistName: body.anesthesiologistName?.trim() || otCase.anesthesiologist || actor.fullName,
      anesthesiaType: body.anesthesiaType || 'General Anesthesia (GA)',
      startedAt: body.startedAt || otCase.anesthesiaRecord?.startedAt || nowIso,
      endedAt: body.endedAt || otCase.anesthesiaRecord?.endedAt,
      airwayLog: body.airwayLog || {
        mallampatiGrade: 'Class I',
        airwayDevice: 'ETT (Endotracheal Tube)',
      },
      agentsUsed: Array.isArray(body.agentsUsed) ? body.agentsUsed : [],
      vitalsLog: Array.isArray(body.vitalsLog) ? body.vitalsLog : [],
      ivFluidsGivenMl: body.ivFluidsGivenMl !== undefined ? Number(body.ivFluidsGivenMl) : undefined,
      estimatedBloodLossMl: body.estimatedBloodLossMl !== undefined ? Number(body.estimatedBloodLossMl) : undefined,
      complicationNotes: body.complicationNotes?.trim() || undefined,
      updatedAt: nowIso,
      updatedBy: actor.fullName,
    };
    otCase.anesthesiaRecord = record;

    appendAudit(
      db,
      actor,
      'OT_MANAGEMENT',
      'OT_ANESTHESIA_UPDATED',
      otCase.otNumber,
      `Updated Anesthesiology record for ${otCase.otNumber} (${record.anesthesiaType}): ${record.agentsUsed.length} drug dose(s), airway ${record.airwayLog.airwayDevice} (${record.airwayLog.mallampatiGrade}), ${record.vitalsLog.length} intra-op vital point(s).`
    );
    saveDb(db);
    res.json({ otCase, anesthesiaRecord: record, db: scopeDbForActor(db, actor) });
  });

  // Complete Surgery & Record PACU Recovery + Post OT Charge to IPD Ledger
  app.post('/api/ot/cases/:id/complete', withAuth('ot.manage', 'ot_management'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: 'OT surgical case not found.' });
      return;
    }
    const {
      operativeNote,
      consumablesNotes,
      postOpPacu,
      targetStatus,
      postChargeToIpd,
    } = req.body as {
      operativeNote?: string;
      consumablesNotes?: string;
      postOpPacu?: Partial<OtPostOpPacu>;
      targetStatus?: 'PACU Recovery' | 'Completed';
      postChargeToIpd?: boolean;
    };
    const nowIso = new Date().toISOString();
    if (operativeNote !== undefined) otCase.operativeNote = operativeNote.trim();
    if (consumablesNotes !== undefined) otCase.consumablesNotes = consumablesNotes.trim();
    if (postOpPacu) {
      otCase.postOpPacu = {
        recordedAt: nowIso,
        aldreteScore: Math.max(0, Math.min(10, Number(postOpPacu.aldreteScore) || 9)),
        bp: postOpPacu.bp?.trim() || undefined,
        spo2Pct: postOpPacu.spo2Pct ? Number(postOpPacu.spo2Pct) : undefined,
        painScore: postOpPacu.painScore !== undefined ? Number(postOpPacu.painScore) : undefined,
        pacuNotes: postOpPacu.pacuNotes?.trim() || undefined,
        transferredTo: postOpPacu.transferredTo?.trim() || 'Post-Op Surgical Ward',
        dischargedBy: actor.fullName,
      };
    }
    otCase.status = targetStatus || 'Completed';
    if (otCase.status === 'Completed') {
      otCase.completedAt = nowIso;
    }
    const room = (db.otRooms || []).find((r) => r.id === otCase.otRoomId);
    if (room) {
      room.status = 'Cleaning';
      room.currentCaseId = null;
    }

    if (postChargeToIpd && otCase.otFeeNpr > 0) {
      const adm = (db.ipdAdmissions || []).find(
        (a) =>
          a.disposition === 'Admitted' &&
          ((otCase.encounterId && a.id === otCase.encounterId) ||
            (otCase.uhid && a.uhid === otCase.uhid) ||
            (otCase.patientId && a.patientId === otCase.patientId))
      );
      if (adm) {
        if (!Array.isArray(adm.directServiceCharges)) adm.directServiceCharges = [];
        const alreadyPosted = adm.directServiceCharges.some((c) => c.id === `otchg-${otCase.id}`);
        if (!alreadyPosted) {
          adm.directServiceCharges.push({
            id: `otchg-${otCase.id}`,
            billedAt: nowIso,
            billedBy: actor.fullName,
            serviceName: `OT Procedure (${otCase.otNumber}): ${otCase.procedureName}`,
            category: 'PROCEDURE',
            amountNpr: otCase.otFeeNpr,
            paymentMode: 'Credit',
            notes: `Surgeon: ${otCase.leadSurgeon}`,
          });
          recalcIpdFinancials(adm, db.settings?.moduleSettings);
        }
      }
    }

    appendAudit(
      db,
      actor,
      'OT_MANAGEMENT',
      'OT_SURGERY_COMPLETED',
      otCase.otNumber,
      `Marked OT ${otCase.otNumber} (${otCase.procedureName}) as ${otCase.status}. Room ${otCase.otRoomLabel} set to Cleaning.`
    );
    saveDb(db);
    res.json({ otCase, db: scopeDbForActor(db, actor) });
  });

  // --- APPOINTMENTS BOOKING & OPD CHECK-IN ---
  app.post('/api/appointments', withAuth('patients.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<AppointmentRecord>;
    if (!body.patientName?.trim() || !body.doctorName?.trim() || !body.appointmentDateAd) {
      res.status(400).json({ error: 'Patient Name, Doctor Name, and Appointment Date are required.' });
      return;
    }
    if (!Array.isArray(db.appointments)) db.appointments = [];
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 30,
      ageType: body.patientAgeType || 'Years',
      gender: body.patientGender || 'Male',
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName,
    });
    const bsAppt = adToBs(body.appointmentDateAd);
    const apptNo = `APT-${bsAppt.year}-${String(db.appointments.length + 101).padStart(3, '0')}`;
    const appt: AppointmentRecord = {
      id: `apt-${Date.now()}`,
      appointmentNumber: apptNo,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: normalizeNepalPhone(body.patientPhone) || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      department: body.department?.trim() || 'General Medicine OPD',
      doctorName: body.doctorName.trim(),
      appointmentDateAd: body.appointmentDateAd,
      appointmentDateBs: body.appointmentDateBs?.trim() || bsAppt.formattedEn,
      timeSlot: body.timeSlot?.trim() || '10:00 AM',
      reason: body.reason?.trim() || 'OPD Consultation',
      status: 'Scheduled',
      createdAt: new Date().toISOString(),
      createdBy: actor.fullName,
    };
    db.appointments.unshift(appt);
    appendAudit(db, actor, 'OPD_IPD', 'APPOINTMENT_BOOKED', apptNo, `Booked appointment ${apptNo} for ${appt.patientName} with ${appt.doctorName} on ${appt.appointmentDateBs} ${appt.timeSlot}.`);
    saveDb(db);
    res.status(201).json({ appointment: appt, patient: patientRec, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/appointments/:id', withAuth('patients.manage'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const appt = (db.appointments || []).find((a) => a.id === req.params.id);
    if (!appt) {
      res.status(404).json({ error: 'Appointment not found.' });
      return;
    }
    const body = req.body as Partial<AppointmentRecord>;
    if (body.status) appt.status = body.status;
    if (body.timeSlot) appt.timeSlot = body.timeSlot;
    if (body.appointmentDateAd) {
      appt.appointmentDateAd = body.appointmentDateAd;
      appt.appointmentDateBs = body.appointmentDateBs || adToBs(body.appointmentDateAd).formattedEn;
    }
    if (body.doctorName) appt.doctorName = body.doctorName;
    if (body.department) appt.department = body.department;
    if (body.reason !== undefined) appt.reason = body.reason;
    saveDb(db);
    res.json({ appointment: appt, db: scopeDbForActor(db, actor) });
  });

  // --- PHARMACY EXCEL / CSV BULK IMPORT ---
  app.post('/api/pharmacy/bulk-import', withAuth('pharmacy.manage', 'pharmacy_erp'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { rows, defaultSupplierName } = req.body as {
      rows: Array<{
        code?: string;
        brandName: string;
        genericName?: string;
        dosageForm?: PharmacyMedicine['dosageForm'];
        strength?: string;
        manufacturer?: string;
        category?: string;
        rackLocation?: string;
        unitLabel?: string;
        mrpNpr?: number;
        purchaseRateNpr?: number;
        batchNumber?: string;
        expiryDate?: string;
        quantity?: number;
        supplierName?: string;
        vatApplicable?: boolean;
      }>;
      defaultSupplierName?: string;
    };
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: 'No valid spreadsheet rows provided.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const defaultExp = new Date(Date.now() + 540 * 86400000).toISOString().slice(0, 10);
    let addedMeds = 0;
    let updatedMeds = 0;
    let addedBatches = 0;

    rows.forEach((row, idx) => {
      const brand = (row.brandName || '').trim();
      if (!brand) return;
      const code = (row.code || '').trim().toUpperCase() || `MED-XL-${Date.now().toString().slice(-4)}-${idx + 1}`;
      const mrp = Math.max(0, Number(row.mrpNpr) || 0);
      const buyRate = Math.max(0, Number(row.purchaseRateNpr) || (mrp > 0 ? Number((mrp / 1.16).toFixed(2)) : 0));
      const qty = Math.max(0, Math.floor(Number(row.quantity) || 0));

      let med = db.pharmacyMedicines.find(
        (m) => m.code.toUpperCase() === code || m.brandName.toLowerCase() === brand.toLowerCase()
      );
      if (!med) {
        med = {
          id: `med-xl-${Date.now()}-${idx}`,
          code,
          brandName: brand,
          genericName: (row.genericName || brand).trim(),
          dosageForm: row.dosageForm || 'Tablet',
          strength: (row.strength || 'Std').trim(),
          manufacturer: (row.manufacturer || 'Nepal Pharma Formulary').trim(),
          category: (row.category || 'General').trim(),
          scheduleType: 'OTC',
          rackLocation: (row.rackLocation || 'A-01').trim(),
          unitLabel: (row.unitLabel || 'Units').trim(),
          vatApplicable: Boolean(row.vatApplicable),
          reorderLevel: 30,
          defaultMrpNpr: mrp || 10,
          defaultPurchaseRateNpr: buyRate || 8,
          active: true,
        };
        db.pharmacyMedicines.unshift(med);
        addedMeds += 1;
      } else {
        if (mrp > 0) med.defaultMrpNpr = mrp;
        if (buyRate > 0) med.defaultPurchaseRateNpr = buyRate;
        if (row.manufacturer) med.manufacturer = row.manufacturer.trim();
        if (row.rackLocation) med.rackLocation = row.rackLocation.trim();
        updatedMeds += 1;
      }

      if (qty > 0) {
        const batchNo = (row.batchNumber || '').trim() || `XL-${new Date().getFullYear()}-${idx + 1}`;
        const expDate = (row.expiryDate || '').trim() || defaultExp;
        const supName = (row.supplierName || defaultSupplierName || med.manufacturer).trim();
        const batch: PharmacyBatch = {
          id: `pbat-xl-${Date.now()}-${idx}`,
          medicineId: med.id,
          centerId: null,
          centerName: 'Saptari Hospital Central Pharmacy',
          batchNumber: batchNo,
          mfgDate: nowIso.slice(0, 10),
          expiryDate: expDate,
          quantityReceived: qty,
          quantityOnHand: qty,
          purchaseRateNpr: buyRate || Number((med.defaultMrpNpr / 1.16).toFixed(2)),
          mrpNpr: mrp || med.defaultMrpNpr,
          supplierName: supName,
          grnNumber: `GRN-XL-${String(Date.now()).slice(-5)}`,
          receivedAt: nowIso,
        };
        db.pharmacyBatches.unshift(batch);
        db.pharmacyMovements.unshift({
          id: `pmov-xl-${Date.now()}-${idx}`,
          timestamp: nowIso,
          medicineId: med.id,
          medicineName: med.brandName,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          centerId: batch.centerId ?? null,
          type: 'GRN_IN',
          quantityDelta: qty,
          balanceAfter: qty,
          referenceId: batch.grnNumber,
          performedBy: actor.fullName,
          notes: `Excel Bulk Import (${supName})`,
        });
        addedBatches += 1;
      }
    });

    appendAudit(
      db,
      actor,
      'PHARMACY',
      'PHARMACY_EXCEL_BULK_IMPORT',
      `XL-${rows.length}`,
      `Imported Excel catalog: ${addedMeds} new medicines, ${updatedMeds} updated, ${addedBatches} opening batches.`
    );
    saveDb(db);
    res.json({ addedMeds, updatedMeds, addedBatches, db: scopeDbForActor(db, actor) });
  });

  // --- HR CERTIFICATES & OFFICIAL LETTERS (Experience, Appointment, Relieving, Promotion, Salary) ---
  app.post('/api/personnel/certificates', withAuth('personnel.manage', 'hr_payroll'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<HrCertificateRecord> & { logToChalani?: boolean };
    if (!body.staffId || !body.certificateType || !body.documentBody?.trim()) {
      res.status(400).json({ error: 'Staff Member, Certificate Type, and Document Body are required.' });
      return;
    }
    const staff = db.staff.find((s) => s.id === body.staffId);
    if (!staff) {
      res.status(404).json({ error: 'Staff member not found.' });
      return;
    }
    if (!Array.isArray(db.hrCertificates)) db.hrCertificates = [];
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const certNumber = `HRC-${bsNow.year}-${String(db.hrCertificates.length + 1).padStart(3, '0')}`;

    let linkedChalaniNumber: string | undefined;
    if (body.logToChalani) {
      const chalaniSerial =
        (db.dartaChalani || []).filter((e) => e.entryType === 'CHALANI').length + 1;
      linkedChalaniNumber = `CHALANI-${bsNow.year}-${String(chalaniSerial).padStart(3, '0')}`;
      const chalaniEntry: DartaChalaniEntry = {
        id: `dc-hr-${Date.now()}`,
        entryType: 'CHALANI',
        serialNo: chalaniSerial,
        entryNumber: linkedChalaniNumber,
        refNumber: certNumber,
        fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
        entryDateAd: nowIso.slice(0, 10),
        entryDateBs: bsNow.formattedEn,
        partyName: staff.fullName,
        partyAddress: staff.department,
        subject: body.subject?.trim() || `${body.certificateType} — ${staff.fullName} (${staff.employeeCode})`,
        category: 'HR / Internal Circular',
        department: 'Human Resources',
        handledBy: actor.fullName,
        documentBody: body.documentBody.trim(),
        attachments: [],
        status: 'Verified / Dispatched',
        remarks: `Auto-logged from HR ${body.certificateType}`,
        recordedBy: actor.fullName,
      };
      db.dartaChalani.unshift(chalaniEntry);
    }

    const record: HrCertificateRecord = {
      id: `hrc-${Date.now()}`,
      certificateNumber: certNumber,
      certificateType: body.certificateType,
      staffId: staff.id,
      employeeCode: staff.employeeCode,
      staffName: staff.fullName,
      designation: body.designation?.trim() || staff.designation,
      department: body.department?.trim() || staff.department,
      joinedAt: body.joinedAt || staff.joinedAt,
      relievedAt: body.relievedAt || undefined,
      basicSalaryNpr: body.basicSalaryNpr !== undefined ? Number(body.basicSalaryNpr) : staff.basicSalaryNpr,
      subject: body.subject?.trim() || `${body.certificateType} — ${staff.fullName}`,
      documentBody: body.documentBody.trim(),
      issuedAt: nowIso,
      issuedDateBs: bsNow.formattedEn,
      issuedBy: actor.fullName,
      linkedChalaniNumber,
    };
    db.hrCertificates.unshift(record);
    appendAudit(db, actor, 'PERSONNEL', 'HR_CERTIFICATE_ISSUED', certNumber, `Issued ${record.certificateType} (${certNumber}) for ${staff.fullName}.`);
    saveDb(db);
    res.status(201).json({ certificate: record, db: scopeDbForActor(db, actor) });
  });

  // --- REFERRED HOSPITALS & AMBULANCES DIRECTORY + MANAGER CALL ACK ---
  app.post('/api/referrals/hospitals', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<ReferredHospitalMaster>;
    if (!body.name?.trim() || !body.managerName?.trim() || !body.managerPhone?.trim()) {
      res.status(400).json({ error: 'Hospital Name, Manager Name, and Manager Phone are required.' });
      return;
    }
    if (!Array.isArray(db.referredHospitalsMaster)) db.referredHospitalsMaster = [];
    const created: ReferredHospitalMaster = {
      id: `rhosp-${Date.now()}`,
      name: body.name.trim(),
      address: body.address?.trim() || 'Nepal',
      phone: body.phone?.trim() || '',
      managerName: body.managerName.trim(),
      managerPhone: normalizeNepalPhone(body.managerPhone) || body.managerPhone.trim(),
      specialties: body.specialties?.trim() || '',
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.referredHospitalsMaster.unshift(created);
    appendAudit(db, actor, 'REFERRALS', 'REFERRED_HOSPITAL_ADDED', created.id, `Added Referred Hospital ${created.name} (Mgr: ${created.managerName} ${created.managerPhone}).`);
    saveDb(db);
    res.status(201).json({ hospital: created, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/referrals/hospitals/:id', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const item = (db.referredHospitalsMaster || []).find((h) => h.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Referred hospital not found.' });
      return;
    }
    const body = req.body as Partial<ReferredHospitalMaster>;
    if (body.name !== undefined) item.name = body.name.trim();
    if (body.address !== undefined) item.address = body.address.trim();
    if (body.phone !== undefined) item.phone = body.phone.trim();
    if (body.managerName !== undefined) item.managerName = body.managerName.trim();
    if (body.managerPhone !== undefined) item.managerPhone = normalizeNepalPhone(body.managerPhone) || body.managerPhone.trim();
    if (body.specialties !== undefined) item.specialties = body.specialties.trim();
    if (body.active !== undefined) item.active = Boolean(body.active);
    saveDb(db);
    res.json({ hospital: item, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/referrals/hospitals/:id', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    db.referredHospitalsMaster = (db.referredHospitalsMaster || []).filter((h) => h.id !== req.params.id);
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/referrals/ambulances', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<AmbulanceMaster>;
    if (!body.name?.trim() || !body.vehicleNumber?.trim()) {
      res.status(400).json({ error: 'Ambulance Name and Vehicle Number are required.' });
      return;
    }
    if (!Array.isArray(db.ambulancesMaster)) db.ambulancesMaster = [];
    const created: AmbulanceMaster = {
      id: `amb-${Date.now()}`,
      name: body.name.trim(),
      vehicleNumber: body.vehicleNumber.trim().toUpperCase(),
      vehicleType: body.vehicleType || 'ALS Ambulance',
      driverName: body.driverName?.trim() || '',
      driverPhone: normalizeNepalPhone(body.driverPhone) || body.driverPhone?.trim() || '',
      defaultCommissionMode: body.defaultCommissionMode || 'FLAT',
      defaultCommissionValue: Math.max(0, Number(body.defaultCommissionValue) || 0),
      caseOverrides: Array.isArray(body.caseOverrides) ? body.caseOverrides : [],
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.ambulancesMaster.unshift(created);
    appendAudit(db, actor, 'REFERRALS', 'AMBULANCE_ADDED', created.vehicleNumber, `Added Ambulance ${created.name} (${created.vehicleNumber}).`);
    saveDb(db);
    res.status(201).json({ ambulance: created, db: scopeDbForActor(db, actor) });
  });

  app.patch('/api/referrals/ambulances/:id', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const item = (db.ambulancesMaster || []).find((a) => a.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: 'Ambulance not found.' });
      return;
    }
    const body = req.body as Partial<AmbulanceMaster>;
    if (body.name !== undefined) item.name = body.name.trim();
    if (body.vehicleNumber !== undefined) item.vehicleNumber = body.vehicleNumber.trim().toUpperCase();
    if (body.vehicleType !== undefined) item.vehicleType = body.vehicleType;
    if (body.driverName !== undefined) item.driverName = body.driverName.trim();
    if (body.driverPhone !== undefined) item.driverPhone = normalizeNepalPhone(body.driverPhone) || body.driverPhone.trim();
    if (body.defaultCommissionMode !== undefined) item.defaultCommissionMode = body.defaultCommissionMode;
    if (body.defaultCommissionValue !== undefined) item.defaultCommissionValue = Math.max(0, Number(body.defaultCommissionValue) || 0);
    if (Array.isArray(body.caseOverrides)) item.caseOverrides = body.caseOverrides;
    if (body.active !== undefined) item.active = Boolean(body.active);
    saveDb(db);
    res.json({ ambulance: item, db: scopeDbForActor(db, actor) });
  });

  app.delete('/api/referrals/ambulances/:id', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    db.ambulancesMaster = (db.ambulancesMaster || []).filter((a) => a.id !== req.params.id);
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  app.post('/api/referrals/call-ack', withAuth(), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const { sourceType, sourceId, markWhatsapp } = req.body as {
      sourceType: 'OPD' | 'ER' | 'IPD';
      sourceId: string;
      markWhatsapp?: boolean;
    };
    const nowIso = new Date().toISOString();
    let ref: ExternalReferralDetail | undefined;
    let label = sourceId;
    if (sourceType === 'OPD') {
      const v = (db.opdVisits || []).find((x) => x.id === sourceId);
      ref = v?.externalReferral;
      label = v?.tokenNumber || sourceId;
    } else if (sourceType === 'ER') {
      const e = (db.emergencyCases || []).find((x) => x.id === sourceId);
      ref = e?.externalReferral;
      label = e?.erNumber || sourceId;
    } else if (sourceType === 'IPD') {
      const a = (db.ipdAdmissions || []).find((x) => x.id === sourceId);
      ref = a?.externalReferral;
      label = a?.admissionNumber || sourceId;
    }
    if (!ref) {
      res.status(404).json({ error: 'Referred encounter not found.' });
      return;
    }
    if (markWhatsapp) {
      ref.whatsappSentAt = nowIso;
    } else {
      ref.managerNotifiedCalled = true;
      ref.managerCalledAt = nowIso;
      ref.managerCalledBy = actor.fullName;
    }
    appendAudit(
      db,
      actor,
      'REFERRALS',
      markWhatsapp ? 'REFERRAL_MANAGER_WHATSAPP' : 'REFERRAL_MANAGER_CALLED',
      label,
      `${actor.fullName} ${markWhatsapp ? 'dispatched WhatsApp summary to' : 'confirmed phone call with'} manager (${ref.referredHospitalManagerName || ref.referredToHospital}) for ${label}.`
    );
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });

  app.get('/api/referrals/patient-billing-tier', withAuth('referrals.view', 'referrals_engine'), (req: Request, res: Response) => {
    const { db } = req as AuthedRequest;
    const uhid = String(req.query.uhid || '').trim();
    const caseType = String(req.query.caseType || '').trim();
    const ambulanceId = String(req.query.ambulanceId || '').trim();
    if (!uhid) {
      res.status(400).json({ error: 'UHID is required.' });
      return;
    }
    const ms = db.settings?.moduleSettings;
    const firstEr = (db.emergencyCases || []).find((e) => e.uhid === uhid);
    const firstAdm = (db.ipdAdmissions || []).find((a) => a.uhid === uhid);
    const orders = (db.orders || []).filter((o) => o.uhid === uhid);
    const erTotal = firstEr ? (Number(firstEr.erTicketFeeNpr) || 0) + (Number(firstEr.erChargesNpr) || 0) : 0;
    const admTotal = firstAdm ? Number(firstAdm.admissionFeeNpr) || 0 : 0;
    const posTotal = orders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
    const combinedFirstBillNpr = Number((erTotal + admTotal + posTotal).toFixed(2));

    const amb = ambulanceId ? (db.ambulancesMaster || []).find((a) => a.id === ambulanceId) : undefined;
    const ambRule = amb?.caseOverrides?.find((r) => r.active && r.caseType.toLowerCase() === caseType.toLowerCase());
    const globalRule = (ms?.referralCaseRules || []).find((r) => r.active && r.caseType.toLowerCase() === caseType.toLowerCase());
    const caseRule = ambRule || globalRule;
    const caseCommissionNpr = caseRule
      ? caseRule.mode === 'PERCENT'
        ? Number(((combinedFirstBillNpr * caseRule.value) / 100).toFixed(2))
        : Number(caseRule.value || 0)
      : amb
      ? amb.defaultCommissionMode === 'PERCENT'
        ? Number(((combinedFirstBillNpr * amb.defaultCommissionValue) / 100).toFixed(2))
        : Number(amb.defaultCommissionValue || 0)
      : 0;

    const matchingTier = [...(ms?.referralBillTierRules || [])]
      .filter((t) => t.active && combinedFirstBillNpr >= t.minTotalBillNpr)
      .sort((a, b) => b.minTotalBillNpr - a.minTotalBillNpr)[0];
    const tierCommissionNpr = matchingTier ? Number(matchingTier.commissionAmountNpr || 0) : 0;

    res.json({
      uhid,
      erTotal,
      admTotal,
      posTotal,
      combinedFirstBillNpr,
      caseRule: caseRule || null,
      caseCommissionNpr,
      matchingTier: matchingTier || null,
      tierCommissionNpr,
      totalDynamicCommissionNpr: Number((caseCommissionNpr + tierCommissionNpr).toFixed(2)),
    });
  });

  app.post('/api/referrals/direct-external', withAuth('referrals.manage', 'referrals_engine'), (req: Request, res: Response) => {
    const { db, actor } = req as AuthedRequest;
    const body = req.body as Partial<ExternalReferralDetail> & {
      uhid?: string;
      patientName?: string;
      patientPhone?: string;
      partnerId?: string;
    };
    if (!body.referredToHospital?.trim() || !body.patientName?.trim()) {
      res.status(400).json({ error: 'Referred Hospital and Patient Name are required.' });
      return;
    }
    const nowIso = new Date().toISOString();
    const bsNow = adToBs(nowIso);
    const matchingEr = body.uhid ? (db.emergencyCases || []).find((e) => e.uhid === body.uhid) : undefined;
    const matchingAdm = body.uhid ? (db.ipdAdmissions || []).find((a) => a.uhid === body.uhid) : undefined;
    const matchingOpd = body.uhid ? (db.opdVisits || []).find((v) => v.uhid === body.uhid) : undefined;

    const baseExt: ExternalReferralDetail = {
      referredHospitalId: body.referredHospitalId || undefined,
      referredToHospital: body.referredToHospital.trim(),
      referredToPlace: body.referredToPlace?.trim() || 'Nepal',
      referredHospitalManagerName: body.referredHospitalManagerName?.trim() || undefined,
      referredHospitalManagerPhone: body.referredHospitalManagerPhone?.trim() || undefined,
      referredDepartment: body.referredDepartment?.trim() || 'Emergency / Tertiary Care',
      referralReason: body.referralReason?.trim() || 'Referred via Referrals Desk',
      conditionAtReferral: body.conditionAtReferral?.trim() || 'Stable / Under Transport',
      transportMode: body.transportMode || 'ALS Ambulance',
      ambulanceId: body.ambulanceId || undefined,
      ambulanceName: body.ambulanceName?.trim() || undefined,
      ambulanceNumber: body.ambulanceNumber?.trim() || undefined,
      ambulanceDriverName: body.ambulanceDriverName?.trim() || undefined,
      ambulanceDriverPhone: body.ambulanceDriverPhone?.trim() || undefined,
      referralCaseType: body.referralCaseType?.trim() || undefined,
      commissionMode: body.commissionMode,
      commissionRateValue: body.commissionRateValue,
      commissionCalculatedNpr: body.commissionCalculatedNpr,
      commissionPartnerId: body.partnerId || undefined,
      departureTime: body.departureTime?.trim() || `${bsNow.formattedEn} ${bsNow.timeEn}`,
      caseDetails: body.caseDetails?.trim() || undefined,
      referredAt: nowIso,
      referredBy: actor.fullName,
    };

    const enriched = attachEncounterBillingAndClinicalHistory(db, {
      baseReferral: baseExt,
      patientId: matchingAdm?.patientId || matchingEr?.patientId || matchingOpd?.patientId,
      uhid: body.uhid,
      patientName: body.patientName.trim(),
      patientPhone: body.patientPhone || '',
      encounterType: matchingAdm ? 'IPD' : matchingEr ? 'EMERGENCY' : 'OPD',
      encounterId: matchingAdm?.id || matchingEr?.id || matchingOpd?.id,
      admission: matchingAdm,
      erCase: matchingEr,
      opdVisit: matchingOpd,
    });

    if (matchingAdm) {
      matchingAdm.disposition = 'Referred to External Hospital';
      matchingAdm.externalReferral = enriched;
    } else if (matchingEr) {
      matchingEr.disposition = 'Referred to External Hospital';
      matchingEr.externalReferral = enriched;
    } else if (matchingOpd) {
      matchingOpd.disposition = 'Referred to External Hospital';
      matchingOpd.externalReferral = enriched;
    } else {
      const pRec = upsertPatientMaster(db, {
        uhid: body.uhid,
        fullName: body.patientName.trim(),
        age: 35,
        ageType: 'Years',
        gender: 'Male',
        phone: body.patientPhone,
        actorName: actor.fullName,
      });
      const opdVisit: OpdVisit = {
        id: `opd-ref-${Date.now()}`,
        tokenNumber: `OPD-REF-${String((db.opdVisits || []).length + 1).padStart(3, '0')}`,
        visitDate: nowIso,
        fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
        centerId: null,
        centerName: db.settings.labName,
        patientId: pRec.id,
        uhid: pRec.uhid,
        encounterLabel: 'External Referral Log',
        patientName: pRec.fullName,
        patientAge: pRec.age,
        patientAgeType: pRec.ageType,
        patientGender: pRec.gender,
        patientPhone: pRec.phone,
        patientAddress: pRec.address,
        department: enriched.referredDepartment,
        consultingDoctor: actor.fullName,
        chiefComplaint: enriched.referralReason,
        vitals: {},
        provisionalDiagnosis: enriched.caseDetails || enriched.referralReason,
        clinicalNotes: enriched.clinicalHistorySummary || '',
        consultationFeeNpr: 0,
        paymentMode: 'Cash',
        prescribedMedicines: [],
        investigations: [],
        disposition: 'Referred to External Hospital',
        externalReferral: enriched,
        followUpAdvice: '',
        recordedBy: actor.fullName,
      };
      db.opdVisits.unshift(opdVisit);
    }

    if (body.partnerId && (enriched.commissionCalculatedNpr || 0) > 0) {
      const partner = db.referrals.find((r) => r.id === body.partnerId);
      if (partner) {
        partner.totalCommissionEarned = Number(
          ((partner.totalCommissionEarned || 0) + (enriched.commissionCalculatedNpr || 0)).toFixed(2)
        );
      }
    }

    appendAudit(
      db,
      actor,
      'REFERRALS',
      'EXTERNAL_REFERRAL_RECORDED',
      body.uhid || body.patientName.trim(),
      `Recorded external referral for ${body.patientName.trim()} to ${enriched.referredToHospital} via ${enriched.ambulanceName || enriched.transportMode} (${enriched.ambulanceNumber || '—'}). Dynamic commission: रू ${enriched.commissionCalculatedNpr || 0}.`
    );
    saveDb(db);
    res.status(201).json({ externalReferral: enriched, db: scopeDbForActor(db, actor) });
  });

  const isBundledProd = import.meta.url.includes('dist-server');
  const isProduction = process.env.NODE_ENV === 'production' || isBundledProd;

  if (!isProduction) {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    const distIndex = path.join(distPath, 'index.html');
    if (fs.existsSync(distIndex)) {
      app.use(
        express.static(distPath, {
          maxAge: '7d',
          etag: true,
        })
      );
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) {
          res.status(404).json({ error: `API endpoint not found: ${req.path}` });
          return;
        }
        res.sendFile(distIndex);
      });
    } else {
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api/')) {
          res.status(404).json({ error: `API endpoint not found: ${req.path}` });
          return;
        }
        res
          .status(503)
          .send(
            '<h1>SHPL Production Frontend Bundle Not Built</h1><p>Run <code>npm run build</code> or upload pre-built <code>dist/</code> folder.</p>'
          );
      });
    }
  }

  const onListenSuccess = () => {
    if (typeof LISTEN_TARGET === 'string') {
      console.log(`SHPL — Saptari Hospital ERP Server (${process.platform}) listening on socket ${LISTEN_TARGET}`);
      return;
    }
    const lanUrls = getLocalLanIps().map((ip) => `http://${ip}:${PORT}`);
    console.log(`SHPL — Saptari Hospital ERP Server (${process.platform}) listening on http://0.0.0.0:${PORT}`);
    if (lanUrls.length > 0) {
      console.log(`Same-Wi-Fi / LAN Client Access URL(s): ${lanUrls.join(' | ')}`);
    }
  };

  if (typeof LISTEN_TARGET === 'string') {
    httpServer.listen(LISTEN_TARGET, onListenSuccess);
  } else {
    httpServer.listen(LISTEN_TARGET, '0.0.0.0', onListenSuccess);
  }
}

startServer();
