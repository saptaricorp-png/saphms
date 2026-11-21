import fs from 'fs';
import path from 'path';
import type {
  AuditLogEntry,
  LimsDatabase,
  PermissionKey,
  RoleId,
  SecurityAlert,
  StaffMember,
} from '../src/types/lims';
import {
  BILLING_REPORT_STRICT_PERMISSIONS,
  createSeedDatabase,
  DEFAULT_DASHBOARD_LAYOUT_CONFIGS,
  LAB_TECH_STRICT_PERMISSIONS,
} from './seed';
import { DEFAULT_LAB_ANALYZERS, ensureAnalyzerCodesOnService, NEPAL_LAB_TESTS_CATALOG } from './labCatalog';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'lims-db.json');

let dbCache: LimsDatabase | null = null;

function hydrateDbSchema(db: LimsDatabase): LimsDatabase {
  const seed = createSeedDatabase();

  // Strip removed Collection Centers & Riders modules completely
  db.centers = [];
  db.centerAwards = [];
  db.riders = [];
  db.riderTasks = [];

  if (db.saas && Array.isArray(db.saas.modules)) {
    db.saas.modules = db.saas.modules.filter(
      (m) => m.key !== 'collection_centers' && m.key !== 'collection_riders'
    );
    const seedModules = seed.saas?.modules || [];
    for (const sm of seedModules) {
      if (!db.saas.modules.some((m) => m.key === sm.key)) {
        db.saas.modules.push(sm);
      }
    }
  }
  if (Array.isArray(db.tenants)) {
    db.tenants = db.tenants.map((t) =>
      t.id === 'tnt-1' && !t.enabledModules.includes('ot_management')
        ? { ...t, enabledModules: [...t.enabledModules, 'ot_management'] }
        : t
    );
  }

  // Clear stale collection center staff isolation & add any missing defaults
  const removedCenterStaffIds = new Set(['staff-ctr-1', 'staff-ctr-2', 'staff-ctr-3']);
  db.staff = (db.staff || [])
    .filter((s) => !removedCenterStaffIds.has(s.id))
    .map((s) => ({
      ...s,
      assignedCenterId: null,
      assignedCenterName: s.assignedCenterName?.includes('Hub') ? 'Saptari Hospital Main' : s.assignedCenterName,
    }));

  // Clean role permissions: strip Settings from non-admin roles, enforce strict LAB_TECH scope, and hydrate OT permissions
  db.roles = (db.roles || []).map((r) => {
    const isAdminRole = r.id === 'SUPER_ADMIN' || r.id === 'SAAS_ADMIN';
    if (r.id === 'LAB_TECH') {
      return {
        ...r,
        description:
          'Strict laboratory bench role: sample collection, analyzer result entry, clinical result validation, and diagnostic report printing.',
        permissions: [...LAB_TECH_STRICT_PERMISSIONS],
      };
    }
    const basePerms = r.permissions.filter(
      (p) =>
        p !== 'centers.view' &&
        p !== 'centers.manage' &&
        p !== 'centers.credit_override' &&
        p !== 'awards.manage' &&
        p !== 'riders.view' &&
        p !== 'riders.manage' &&
        (isAdminRole || p !== 'settings.manage')
    );
    const extraOtPerms: PermissionKey[] =
      isAdminRole || r.id === 'LAB_DIRECTOR' || r.id === 'DOCTOR'
        ? ['ot.view', 'ot.manage', 'ot.anesthesia']
        : r.id === 'NURSE'
        ? ['ot.view', 'ot.manage']
        : r.id === 'CENTER_MANAGER'
        ? ['ot.view']
        : [];
    const mergedPerms = Array.from(new Set([...basePerms, ...extraOtPerms]));
    return {
      ...r,
      name: r.id === 'CENTER_MANAGER' ? 'Hospital Front Desk, Billing & Darta Manager' : r.name,
      permissions: mergedPerms,
    };
  });

  if (!db.roles.some((r) => r.id === 'BILLING_REPORT')) {
    db.roles.push({
      id: 'BILLING_REPORT',
      name: 'Billing & Report Operator (POS + Reports Only)',
      description: 'Dedicated billing & report desk role: Hospital POS billing, order lookup, detailed diagnostic report print & dispatch only.',
      permissions: [...BILLING_REPORT_STRICT_PERMISSIONS],
    });
  } else {
    db.roles = db.roles.map((r) =>
      r.id === 'BILLING_REPORT'
        ? { ...r, permissions: [...BILLING_REPORT_STRICT_PERMISSIONS] }
        : r
    );
  }

  if (db.saas) {
    const roleCount = Math.max(12, db.roles.length + 10);
    if ((db.saas.maxRolesCapacity || 0) < roleCount) {
      db.saas.maxRolesCapacity = roleCount;
    }
    if (Array.isArray(db.saas.allowedRoleIds)) {
      for (const r of db.roles) {
        if (!db.saas.allowedRoleIds.includes(r.id)) {
          db.saas.allowedRoleIds.push(r.id);
        }
      }
    }
  }

  // Hydrate role-based dashboard layout_config
  if (!db.dashboardLayoutConfigs || typeof db.dashboardLayoutConfigs !== 'object') {
    db.dashboardLayoutConfigs = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS };
  } else {
    for (const [roleKey, cfg] of Object.entries(DEFAULT_DASHBOARD_LAYOUT_CONFIGS)) {
      if (!db.dashboardLayoutConfigs[roleKey]) {
        db.dashboardLayoutConfigs[roleKey] = cfg;
      }
    }
    // Ensure any custom roles have a safe layout config entry
    for (const r of db.roles) {
      if (!db.dashboardLayoutConfigs[r.id]) {
        db.dashboardLayoutConfigs[r.id] = {
          roleId: r.id,
          title: `${r.name} — Workspace`,
          subtitle: r.description || 'Custom Hospital Role Dashboard',
          widgets: ['EXECUTIVE_SUMMARY', 'PRIORITY_ALERTS', 'KPI_GRID', 'CLINICAL_OPS', 'SHIFT_HANDOVER'],
        };
      }
    }
    // Guarantee Lab Technologist only sees Pending TAT Alerts on dashboard
    db.dashboardLayoutConfigs.LAB_TECH = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS.LAB_TECH };
  }

  if (!Array.isArray(db.pharmacyDeposits)) {
    db.pharmacyDeposits = [];
  }

  // Upgrade moduleSettings fields if loaded from older JSON
  const msSeed = seed.settings.moduleSettings!;
  if (!db.settings.moduleSettings) {
    db.settings.moduleSettings = { ...msSeed };
  } else {
    const ms = db.settings.moduleSettings;
    if (ms.opdFreeFollowUpDays === undefined) {
      ms.opdFreeFollowUpDays = msSeed.opdFreeFollowUpDays;
    }
    if (ms.opdFollowUpSameDoctorOnly === undefined) {
      ms.opdFollowUpSameDoctorOnly = true;
    }
    if (ms.opdFollowUpWithinWindowFeeNpr === undefined) {
      ms.opdFollowUpWithinWindowFeeNpr = 0;
    }
    if (ms.opdFollowUpFeeAfterExpiryNpr === undefined) {
      ms.opdFollowUpFeeAfterExpiryNpr = msSeed.opdFollowUpFeeAfterExpiryNpr;
    }
    if (!ms.shiftPricing) {
      ms.shiftPricing = msSeed.shiftPricing;
    } else {
      ms.shiftPricing = {
        bed: ms.shiftPricing.bed || msSeed.shiftPricing!.bed,
        observation: ms.shiftPricing.observation || msSeed.shiftPricing!.observation,
        nursing: ms.shiftPricing.nursing || msSeed.shiftPricing!.nursing,
        doctorRound: ms.shiftPricing.doctorRound || msSeed.shiftPricing!.doctorRound,
      };
    }
    if (!Array.isArray(ms.nursingObservationTypes) || ms.nursingObservationTypes.length === 0) {
      ms.nursingObservationTypes = msSeed.nursingObservationTypes;
    }
    if (!Array.isArray(ms.customServiceCategories) || ms.customServiceCategories.length === 0) {
      ms.customServiceCategories = msSeed.customServiceCategories;
    }
    if (!ms.lanServerHostIp) {
      ms.lanServerHostIp = msSeed.lanServerHostIp;
    }
    if (!Array.isArray(ms.signatureBoxes) || ms.signatureBoxes.length === 0) {
      ms.signatureBoxes = msSeed.signatureBoxes;
    }
    if (!ms.printOptions) {
      ms.printOptions = msSeed.printOptions;
    }
    if (ms.ipdDailyObservationFeeNpr === undefined) {
      ms.ipdDailyObservationFeeNpr = msSeed.ipdDailyObservationFeeNpr;
    }
    if (ms.emergencyDefaultCreditLimitNpr === undefined) {
      ms.emergencyDefaultCreditLimitNpr = msSeed.emergencyDefaultCreditLimitNpr;
    }
    if (!ms.discountApprovalPolicy) {
      ms.discountApprovalPolicy = 'MANAGER_THEN_ADMIN';
    }
    if (!ms.creditApprovalPolicy) {
      ms.creditApprovalPolicy = 'MANAGER_THEN_ADMIN';
    }
    if (ms.cashierMaxDiscountNpr === undefined) {
      ms.cashierMaxDiscountNpr = 1000;
    }
    if (ms.showDemoCredentialsOnLogin === undefined) {
      ms.showDemoCredentialsOnLogin = true;
    }
    if (ms.showErFeeFieldsInForm === undefined) {
      ms.showErFeeFieldsInForm = false;
    }
    if (!Array.isArray(ms.referralCaseRules) || ms.referralCaseRules.length === 0) {
      ms.referralCaseRules = msSeed.referralCaseRules;
    }
    if (!Array.isArray(ms.referralBillTierRules) || ms.referralBillTierRules.length === 0) {
      ms.referralBillTierRules = msSeed.referralBillTierRules;
    }
  }
  db.settings.developedBy = 'Dr. Santosh Majhi';
  db.settings.labName = db.settings.labName || 'Saptari Hospital Pvt Ltd';

  // Ensure at least 10 print designs exist
  const existingDesignIds = new Set((db.documentDesigns || []).map((d) => d.id));
  db.documentDesigns = (db.documentDesigns || []).filter((d) => !d.centerId);
  for (const tpl of seed.documentDesigns) {
    if (!existingDesignIds.has(tpl.id)) {
      db.documentDesigns.push(tpl);
    }
  }

  // Merge formulas on existing lab services & ensure hospital consultation/procedure services exist
  for (const seedSrv of seed.services) {
    const match = (db.services || []).find((s) => s.id === seedSrv.id);
    if (!match) {
      db.services.push(seedSrv);
    } else {
      if (!match.customCategory && seedSrv.customCategory) {
        match.customCategory = seedSrv.customCategory;
      }
      if (!match.serviceCategory && seedSrv.serviceCategory) {
        match.serviceCategory = seedSrv.serviceCategory;
      }
      for (const sp of seedSrv.parameters) {
        const ep = match.parameters.find((p) => p.id === sp.id);
        if (!ep && sp.isCalculated) {
          match.parameters.push(sp);
        } else if (ep && sp.formula && !ep.formula) {
          ep.formula = sp.formula;
          ep.isCalculated = sp.isCalculated;
        }
      }
    }
  }

  // Hydrate complete Hospital Laboratory Catalog once if expanded panels not yet loaded
  if (!db.services.some((s) => s.id === 'srv-lab-elec')) {
    const existingCodes = new Set(db.services.map((s) => s.code.toUpperCase()));
    for (const labSrv of NEPAL_LAB_TESTS_CATALOG) {
      if (!existingCodes.has(labSrv.code.toUpperCase())) {
        db.services.push(JSON.parse(JSON.stringify(labSrv)));
        existingCodes.add(labSrv.code.toUpperCase());
      }
    }
  }
  db.services = (db.services || []).map(ensureAnalyzerCodesOnService);

  if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
    db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
  }
  if (!Array.isArray(db.analyzerQueue)) {
    db.analyzerQueue = [];
  }

  // Merge expanded Nepal pharmacy medicines & batches if missing
  const existingMedIds = new Set((db.pharmacyMedicines || []).map((m) => m.id));
  for (const sm of seed.pharmacyMedicines) {
    if (!existingMedIds.has(sm.id)) db.pharmacyMedicines.push(sm);
  }
  const existingBatchIds = new Set((db.pharmacyBatches || []).map((b) => b.id));
  for (const sb of seed.pharmacyBatches) {
    if (!existingBatchIds.has(sb.id)) db.pharmacyBatches.push(sb);
  }

  if (!Array.isArray(db.pharmacySuppliers) || db.pharmacySuppliers.length === 0) {
    db.pharmacySuppliers = seed.pharmacySuppliers ? [...seed.pharmacySuppliers] : [];
  }
  if (!Array.isArray(db.pharmacyManufacturers) || db.pharmacyManufacturers.length === 0) {
    db.pharmacyManufacturers = seed.pharmacyManufacturers ? [...seed.pharmacyManufacturers] : [];
  }
  if (!Array.isArray(db.hospitalAssets)) {
    db.hospitalAssets = seed.hospitalAssets ? [...seed.hospitalAssets] : [];
  }
  if (!Array.isArray(db.discountCreditApprovals)) {
    db.discountCreditApprovals = [];
  }
  if (!Array.isArray(db.appointments)) {
    db.appointments = [];
  }
  if (!Array.isArray(db.hrCertificates)) {
    db.hrCertificates = [];
  }
  if (!Array.isArray(db.referredHospitalsMaster) || db.referredHospitalsMaster.length === 0) {
    db.referredHospitalsMaster = seed.referredHospitalsMaster ? [...seed.referredHospitalsMaster] : [];
  }
  if (!Array.isArray(db.ambulancesMaster) || db.ambulancesMaster.length === 0) {
    db.ambulancesMaster = seed.ambulancesMaster ? [...seed.ambulancesMaster] : [];
  }

  // Hydrate OT Management rooms and cases
  if (!Array.isArray(db.otRooms) || db.otRooms.length === 0) {
    db.otRooms = seed.otRooms ? [...seed.otRooms] : [];
  }
  if (!Array.isArray(db.otCases)) {
    db.otCases = seed.otCases ? [...seed.otCases] : [];
  }

  // Clean orphaned ctr-* beds cleanly to Main Hospital
  if (Array.isArray(db.hospitalBeds)) {
    db.hospitalBeds = db.hospitalBeds.map((b) =>
      b.centerId
        ? { ...b, centerId: null, centerName: 'Saptari Hospital Main' }
        : b
    );
  }

  return db;
}

export function getDb(): LimsDatabase {
  if (dbCache) return dbCache;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as LimsDatabase;
      if (
        parsed &&
        Array.isArray(parsed.referrals) &&
        Array.isArray(parsed.referralPayoutRequests) &&
        Array.isArray(parsed.accounts) &&
        Array.isArray(parsed.payrollRuns) &&
        Array.isArray(parsed.documentDesigns) &&
        Array.isArray(parsed.radiologyTemplates) &&
        Array.isArray(parsed.securityAlerts) &&
        Array.isArray(parsed.pharmacyMedicines) &&
        Array.isArray(parsed.pharmacyBatches) &&
        Array.isArray(parsed.pharmacyInvoices) &&
        Array.isArray(parsed.hospitalBeds) &&
        Array.isArray(parsed.opdVisits) &&
        Array.isArray(parsed.ipdAdmissions) &&
        Array.isArray(parsed.emergencyCases) &&
        Array.isArray(parsed.dartaChalani) &&
        Array.isArray(parsed.birthCertificates) &&
        Array.isArray(parsed.deathCertificates) &&
        Array.isArray(parsed.dhis2Reports) &&
        Boolean(parsed.settings?.labName?.includes('Saptari Hospital')) &&
        Boolean(parsed.staff?.[0]?.username && parsed.staff?.[0]?.pin) &&
        Boolean(parsed.settings?.moduleSettings) &&
        parsed.saas &&
        Array.isArray(parsed.saas.modules) &&
        Array.isArray(parsed.roles) &&
        Array.isArray(parsed.patients) &&
        Array.isArray(parsed.gatepasses) &&
        Array.isArray(parsed.attendanceLogs) &&
        Array.isArray(parsed.shiftHandovers)
      ) {
        dbCache = hydrateDbSchema(parsed);
        return dbCache;
      }
      console.log('Detected previous schema — upgrading to Saptari Hospital Pvt Ltd ERP seed.');
    }
  } catch (err) {
    console.error('Failed to read persisted DB, re-seeding:', err);
  }
  dbCache = hydrateDbSchema(createSeedDatabase());
  saveDb(dbCache);
  return dbCache;
}

export function getDbFileSizeBytes(): number {
  try {
    if (fs.existsSync(DB_FILE)) {
      return fs.statSync(DB_FILE).size;
    }
  } catch {
    // ignore stat error
  }
  return dbCache ? Buffer.byteLength(JSON.stringify(dbCache), 'utf-8') : 0;
}

export function saveDb(db: LimsDatabase): void {
  dbCache = db;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const payload = JSON.stringify(db, null, 2);
  const tmpFile = `${DB_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, payload, 'utf-8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch {
    fs.writeFileSync(DB_FILE, payload, 'utf-8');
  }
}

const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

export interface LocalBackupFileInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

export function listLocalBackups(): LocalBackupFileInfo[] {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.json') && !d.name.endsWith('.tmp'));
  return files
    .map((f) => {
      const fullPath = path.join(BACKUPS_DIR, f.name);
      const st = fs.statSync(fullPath);
      return {
        filename: f.name,
        sizeBytes: st.size,
        createdAt: st.mtime.toISOString(),
      };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function createLocalBackup(prefix = 'manual'): LocalBackupFileInfo {
  const db = getDb();
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 32) || 'backup';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `shpl-${safePrefix}-${stamp}.json`;
  const target = path.join(BACKUPS_DIR, filename);
  const payload = JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      hospital: db.settings?.labName || 'Saptari Hospital Pvt Ltd',
      database: db,
    },
    null,
    2
  );
  fs.writeFileSync(target, payload, 'utf-8');
  const st = fs.statSync(target);

  // Rotate disk backups: keep newest 35 snapshots
  const all = listLocalBackups();
  if (all.length > 35) {
    for (const old of all.slice(35)) {
      try {
        fs.unlinkSync(path.join(BACKUPS_DIR, old.filename));
      } catch {
        // ignore cleanup error
      }
    }
  }

  return {
    filename,
    sizeBytes: st.size,
    createdAt: st.mtime.toISOString(),
  };
}

export function readLocalBackup(filename: string): { path: string; rawText: string } {
  const clean = path.basename(filename);
  if (!clean.endsWith('.json') || clean.includes('..')) {
    throw new Error('Invalid backup filename.');
  }
  const fullPath = path.join(BACKUPS_DIR, clean);
  if (!fs.existsSync(fullPath)) {
    throw new Error('Backup file not found on server disk.');
  }
  return {
    path: fullPath,
    rawText: fs.readFileSync(fullPath, 'utf-8'),
  };
}

export function deleteLocalBackup(filename: string): void {
  const clean = path.basename(filename);
  if (!clean.endsWith('.json') || clean.includes('..')) {
    throw new Error('Invalid backup filename.');
  }
  const fullPath = path.join(BACKUPS_DIR, clean);
  if (!fs.existsSync(fullPath)) {
    throw new Error('Backup file not found.');
  }
  fs.unlinkSync(fullPath);
}

export function restoreDbFromSnapshot(candidate: LimsDatabase): {
  db: LimsDatabase;
  safetyBackup: LocalBackupFileInfo;
} {
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    !Array.isArray(candidate.staff) ||
    !Array.isArray(candidate.services) ||
    !candidate.settings
  ) {
    throw new Error('Invalid hospital database backup format.');
  }
  const safetyBackup = createLocalBackup('pre-restore');
  const hydrated = hydrateDbSchema(candidate);
  saveDb(hydrated);
  return { db: hydrated, safetyBackup };
}

export function resetDb(): LimsDatabase {
  dbCache = hydrateDbSchema(createSeedDatabase());
  saveDb(dbCache);
  return dbCache;
}

export function getActor(db: LimsDatabase, actorId?: string): StaffMember {
  if (actorId) {
    const found = db.staff.find((s) => s.id === actorId);
    if (found) return found;
  }
  return db.staff.find((s) => s.roleId === 'SUPER_ADMIN') || db.staff[0];
}

export function scopeDbForActor(db: LimsDatabase, _actor: StaffMember): LimsDatabase {
  return {
    ...db,
    centers: [],
    centerAwards: [],
    riders: [],
    riderTasks: [],
  };
}

export function hasPermission(db: LimsDatabase, roleId: RoleId, permission: PermissionKey): boolean {
  const role = db.roles.find((r) => r.id === roleId);
  if (!role) return false;
  return role.permissions.includes(permission);
}

export function appendAudit(
  db: LimsDatabase,
  actor: StaffMember,
  module: AuditLogEntry['module'],
  action: string,
  entityId: string,
  summary: string,
  severity: AuditLogEntry['severity'] = 'INFO'
): void {
  const entry: AuditLogEntry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.roleId,
    module,
    action,
    entityId,
    summary,
    severity,
  };
  db.auditLogs.unshift(entry);
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
}

export function appendSecurityAlert(
  db: LimsDatabase,
  alert: Omit<SecurityAlert, 'id' | 'timestamp'>
): SecurityAlert {
  const created: SecurityAlert = {
    ...alert,
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: new Date().toISOString(),
  };
  if (!Array.isArray(db.securityAlerts)) {
    db.securityAlerts = [];
  }
  db.securityAlerts.unshift(created);
  if (db.securityAlerts.length > 200) {
    db.securityAlerts = db.securityAlerts.slice(0, 200);
  }
  return created;
}
