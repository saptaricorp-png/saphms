import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BarChart3,
  BedDouble,
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Compass,
  FileSpreadsheet,
  FlaskConical,
  HeartPulse,
  Landmark,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Package,
  Pill,
  Receipt,
  Scan,
  Scissors,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Smartphone,
  Stethoscope,
  UserCheck,
  UserPlus,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type {
  LabOrder,
  LimsDatabase,
  OpdVisit,
  PermissionKey,
  SaasModuleKey,
  SaasStorageTelemetry,
  StaffMember,
} from './types/lims';
import { apiRequest } from './api/client';
import { adToBs, FISCAL_YEARS } from './utils/nepaliDate';
import { autoCapitalizeTitleCase, isEligibleAutoCapInput, isStrictNameField, sanitizePersonName } from './utils/textFormat';
import { DashboardView } from './views/DashboardView';
import { PatientFlowView } from './views/PatientFlowView';
import { PosBillingView, type BillingEncounterHandoff } from './views/PosBillingView';
import { OrdersTatView } from './views/OrdersTatView';
import { RadiologyView } from './views/RadiologyView';
import { ServiceMasterView } from './views/ServiceMasterView';
import { InventoryView } from './views/InventoryView';
import { ReferralsView } from './views/ReferralsView';
import { FinanceCounterView } from './views/FinanceCounterView';
import { PersonnelView } from './views/PersonnelView';
import { PharmacyView } from './views/PharmacyView';
import { OpdView } from './views/OpdView';
import { IpdBedView } from './views/IpdBedView';
import { OtManagementView } from './views/OtManagementView';
import { EmergencyMlcView } from './views/EmergencyMlcView';
import { NursingDoctorPortalView } from './views/NursingDoctorPortalView';
import { GatepassVisitorView } from './views/GatepassVisitorView';
import { MarketingView } from './views/MarketingView';
import { MisReportsView } from './views/MisReportsView';
import { DartaChalaniView } from './views/DartaChalaniView';
import { Dhis2View } from './views/Dhis2View';
import { AdminControlView } from './views/AdminControlView';
import { MobileAppView } from './views/MobileAppView';
import { SettingsView } from './views/SettingsView';
import { SecurityAuditView } from './views/SecurityAuditView';
import { LoginScreen } from './components/LoginScreen';
import { PinLockScreen } from './components/PinLockScreen';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { ResultWorkbenchModal } from './components/ResultWorkbenchModal';
import { A4ReportModal } from './components/A4ReportModal';
import { PosBillReceiptModal } from './components/PosBillReceiptModal';
import { GlobalErpSearchModal, type SearchJumpTarget } from './components/GlobalErpSearchModal';
import { CriticalAlertBanner } from './components/CriticalAlertBanner';
import { onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { firebaseAuth } from './lib/firebase';
import { createCloudBackupSnapshot, loadCloudSyncConfig } from './services/cloudBackupService';

type NavTab =
  | 'dashboard'
  | 'patients'
  | 'emergency'
  | 'opd'
  | 'ipd'
  | 'ot'
  | 'doctor_portal'
  | 'nursing_portal'
  | 'pos'
  | 'pharmacy'
  | 'orders'
  | 'radiology'
  | 'services'
  | 'inventory'
  | 'finance'
  | 'personnel'
  | 'referrals'
  | 'marketing'
  | 'gatepass'
  | 'mis_reports'
  | 'darta'
  | 'dhis2'
  | 'mobile'
  | 'admin_control'
  | 'security'
  | 'settings';

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  requiredPermission: PermissionKey;
  saasModuleKey?: SaasModuleKey;
}

interface NavGroupDef {
  id: string;
  label: string;
  items: NavTab[];
}

const NAV_GROUPS: NavGroupDef[] = [
  { id: 'overview', label: 'Hospital Dashboard', items: ['dashboard'] },
  {
    id: 'patient_clinical',
    label: '1. Intake & Clinical Care',
    items: ['patients', 'emergency', 'opd', 'ipd', 'ot', 'doctor_portal', 'nursing_portal'],
  },
  { id: 'counters_pos', label: '2. Billing & Pharmacy POS', items: ['pos', 'pharmacy'] },
  { id: 'diagnostics', label: '3. Lab, Radiology & Store', items: ['orders', 'radiology', 'services', 'inventory'] },
  {
    id: 'finance_hr',
    label: '4. Accounting, HR & Referrals',
    items: ['finance', 'personnel', 'referrals', 'marketing', 'gatepass'],
  },
  { id: 'mis_gov', label: '5. MIS Reports, Darta & DHIS2', items: ['mis_reports', 'darta', 'dhis2'] },
  { id: 'system', label: '6. Admin Control & Settings', items: ['mobile', 'admin_control', 'security', 'settings'] },
];

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Hospital Overview', icon: LayoutDashboard, requiredPermission: 'dashboard.view' },
  { id: 'patients', label: 'Patient Intake & Stickers', icon: UserPlus, requiredPermission: 'patients.manage' },
  { id: 'emergency', label: 'Emergency & MLC', icon: Siren, requiredPermission: 'emergency.view', saasModuleKey: 'emergency_mlc' },
  { id: 'opd', label: 'OPD Clinic & Rx', icon: Stethoscope, requiredPermission: 'hospital.view', saasModuleKey: 'hospital_opd_ipd' },
  { id: 'ipd', label: 'IPD, Beds & Certs', icon: BedDouble, requiredPermission: 'hospital.view', saasModuleKey: 'hospital_opd_ipd' },
  { id: 'ot', label: 'OT & Anesthesia', icon: Scissors, requiredPermission: 'ot.view', saasModuleKey: 'ot_management' },
  { id: 'doctor_portal', label: 'Doctor Clinical Console', icon: ClipboardCheck, requiredPermission: 'doctor.view', saasModuleKey: 'hospital_opd_ipd' },
  { id: 'nursing_portal', label: 'Nursing Care Station', icon: HeartPulse, requiredPermission: 'nursing.view', saasModuleKey: 'hospital_opd_ipd' },
  { id: 'pos', label: 'Hospital POS Billing', icon: Receipt, requiredPermission: 'pos.billing', saasModuleKey: 'pos_billing' },
  { id: 'pharmacy', label: 'Central Pharmacy POS', icon: Pill, requiredPermission: 'pharmacy.view', saasModuleKey: 'pharmacy_erp' },
  { id: 'orders', label: 'Lab Worklist & Stickers', icon: Activity, requiredPermission: 'orders.view' },
  { id: 'radiology', label: 'Radiology & Stickers', icon: Scan, requiredPermission: 'radiology.view', saasModuleKey: 'radiology_imaging' },
  { id: 'services', label: 'Service & Price Master', icon: ClipboardList, requiredPermission: 'services.view' },
  { id: 'inventory', label: 'Reagents, Films & Store', icon: Package, requiredPermission: 'inventory.view', saasModuleKey: 'inventory_erp' },
  { id: 'finance', label: 'Accounting & Ledger', icon: Landmark, requiredPermission: 'finance.view', saasModuleKey: 'finance_counter' },
  { id: 'personnel', label: 'HR, Attendance & Shifts', icon: Users, requiredPermission: 'personnel.view', saasModuleKey: 'hr_payroll' },
  { id: 'referrals', label: 'Referrals & Ambulance', icon: Share2, requiredPermission: 'referrals.view', saasModuleKey: 'referrals_engine' },
  { id: 'marketing', label: 'Field Marketing & GPS', icon: Compass, requiredPermission: 'marketing.manage' },
  { id: 'gatepass', label: 'Gatepass & Visitor Exit', icon: BadgeCheck, requiredPermission: 'gatepass.manage' },
  { id: 'mis_reports', label: 'Printable MIS Reports', icon: BarChart3, requiredPermission: 'mis.view' },
  { id: 'darta', label: 'Darta & Chalani', icon: ScrollText, requiredPermission: 'darta.view', saasModuleKey: 'darta_chalani' },
  { id: 'dhis2', label: 'DHIS2 Bode Barsain', icon: FileSpreadsheet, requiredPermission: 'dhis2.view', saasModuleKey: 'dhis2_hmis' },
  { id: 'mobile', label: 'Apps & LAN Server (Admin)', icon: Smartphone, requiredPermission: 'mobile.app' },
  { id: 'admin_control', label: 'Admin Control & Designer', icon: ShieldAlert, requiredPermission: 'admin.control' },
  { id: 'security', label: 'RBAC, Alerts & Audit', icon: ShieldCheck, requiredPermission: 'audit.view' },
  { id: 'settings', label: 'Settings, Tariff & Sync', icon: SettingsIcon, requiredPermission: 'settings.manage' },
];

const VALID_TABS = new Set<NavTab>(NAV_ITEMS.map((n) => n.id));

export default function App() {
  const [db, setDb] = useState<LimsDatabase | null>(null);
  const [telemetry, setTelemetry] = useState<SaasStorageTelemetry | null>(null);
  const [activeUserId, setActiveUserId] = useState<string>(
    () => sessionStorage.getItem('aegis_user_id') || 'staff-1'
  );
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(
    () => sessionStorage.getItem('aegis_authed') === 'true'
  );
  const [isPinLocked, setIsPinLocked] = useState<boolean>(
    () => sessionStorage.getItem('aegis_pin_locked') === 'true'
  );
  const [activeTab, setActiveTab] = useState<NavTab>(() => {
    if (typeof window !== 'undefined') {
      const goParam = new URLSearchParams(window.location.search).get('go') as NavTab | null;
      if (goParam && VALID_TABS.has(goParam)) {
        return goParam;
      }
    }
    return 'dashboard';
  });
  const [activeFiscalYear, setActiveFiscalYear] = useState<string>('FY 2083/84');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [impersonationToken, setImpersonationToken] = useState<string | null>(
    () => sessionStorage.getItem('aegis_imp_token') || null
  );
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [moduleSearchSeed, setModuleSearchSeed] = useState<Record<string, string>>({});
  const [preselectedEncounter, setPreselectedEncounter] = useState<BillingEncounterHandoff | null>(null);
  const [resultOrderId, setResultOrderId] = useState<string | null>(null);
  const [reportOrderId, setReportOrderId] = useState<string | null>(null);
  const [reportAutoPrint, setReportAutoPrint] = useState<boolean>(false);
  const [billOrderId, setBillOrderId] = useState<string | null>(null);
  const [opdToIpdVisit, setOpdToIpdVisit] = useState<OpdVisit | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Hospital-Only Premises Perimeter Verification State
  const [perimeterOk, setPerimeterOk] = useState<boolean>(
    () => sessionStorage.getItem('saptari_perimeter_ok') === 'true'
  );
  const [perimeterCode, setPerimeterCode] = useState('');
  const [perimeterError, setPerimeterError] = useState('');
  const [verifyingPerimeter, setVerifyingPerimeter] = useState(false);

  // 1-Computer Auto-Sync Backup Folder State (Chrome / Edge FS Access API + JSON fallback)
  const [syncDirHandle, setSyncDirHandle] = useState<any>(null);
  const [autoSyncFolderName, setAutoSyncFolderName] = useState<string | null>(null);
  const [autoSyncLastAt, setAutoSyncLastAt] = useState<string | null>(null);
  const [autoSyncStatus, setAutoSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearch((prev) => !prev);
        return;
      }

      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const navMode = db?.settings?.moduleSettings?.keyboardNavigationMode || 'ENTER_AS_TAB';
      if (navMode === 'STANDARD') return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      const tag = target.tagName;
      const inputType =
        tag === 'INPUT' ? ((target as HTMLInputElement).type || 'text').toLowerCase() : '';
      const isTextArea = tag === 'TEXTAREA';
      const isContentEditable = target.isContentEditable;
      if (isTextArea || isContentEditable) return;

      // Dynamic Swap Mode: Tab acts like Enter/Submit when pressed on form fields or buttons
      if (navMode === 'SWAP_ENTER_TAB' && e.key === 'Tab' && !e.shiftKey) {
        if (tag === 'BUTTON' || (tag === 'INPUT' && inputType === 'submit')) {
          e.preventDefault();
          (target as HTMLElement).click();
          return;
        }
        const form = target.closest('form') as HTMLFormElement | null;
        if (form && (tag === 'INPUT' || tag === 'SELECT')) {
          e.preventDefault();
          if (typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          return;
        }
      }

      // Enter moves to next field (unless on button, link, submit input, or explicitly flagged Enter-submit input)
      if (e.key === 'Enter') {
        if (target.closest('[data-enter-submit="true"]')) return;
        const isNavigableInput =
          (tag === 'INPUT' && !['submit', 'button', 'reset', 'image', 'file'].includes(inputType)) ||
          tag === 'SELECT';
        if (!isNavigableInput) return;

        e.preventDefault();
        const scope =
          (target.closest('form') as HTMLElement | null) ||
          (target.closest('[role="dialog"]') as HTMLElement | null) ||
          document.body;
        const candidates = Array.from(
          scope.querySelectorAll<HTMLElement>(
            'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"]):not([disabled])'
          )
        ).filter(
          (el) =>
            el.tabIndex !== -1 &&
            (el.offsetParent !== null || el.getClientRects().length > 0)
        );
        const idx = candidates.indexOf(target);
        if (idx >= 0) {
          const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
          const nextEl = candidates[nextIdx];
          if (nextEl) {
            nextEl.focus();
            if (
              nextEl.tagName === 'INPUT' &&
              !['checkbox', 'radio', 'date', 'time', 'number'].includes(
                ((nextEl as HTMLInputElement).type || '').toLowerCase()
              )
            ) {
              (nextEl as HTMLInputElement).select?.();
            }
          }
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [db?.settings?.moduleSettings?.keyboardNavigationMode]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  }, []);

  const fetchBootstrap = useCallback(async (uid: string) => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await apiRequest<{ db: LimsDatabase; telemetry?: SaasStorageTelemetry }>(
        '/api/bootstrap',
        uid
      );
      setDb(resp.db);
      if (resp.telemetry) setTelemetry(resp.telemetry);
      if (resp.db?.settings?.activeFiscalYear) {
        setActiveFiscalYear(resp.db.settings.activeFiscalYear);
      }
    } catch (err: any) {
      setLoadError(err.message || 'Failed to load LIMS workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBootstrap(activeUserId);
  }, [activeUserId, fetchBootstrap]);

  const activeUser: StaffMember | null = useMemo(() => {
    if (!db) return null;
    return db.staff.find((s) => s.id === activeUserId) || db.staff[1] || db.staff[0] || null;
  }, [db, activeUserId]);

  const activeRole = useMemo(() => {
    if (!db || !activeUser) return null;
    return db.roles.find((r) => r.id === activeUser.roleId) || null;
  }, [db, activeUser]);

  const hasPerm = useCallback(
    (perm: PermissionKey): boolean => {
      if (!activeRole) return false;
      return activeRole.permissions.includes(perm);
    },
    [activeRole]
  );

  const isModuleEnabled = useCallback(
    (moduleKey?: SaasModuleKey): boolean => {
      if (!moduleKey || !db?.saas?.modules) return true;
      const found = db.saas.modules.find((m) => m.key === moduleKey);
      return found ? found.enabled : true;
    },
    [db]
  );

  const visibleNavItems = useMemo(() => {
    const isAdminUser =
      activeUser?.roleId === 'SUPER_ADMIN' || activeUser?.roleId === 'SAAS_ADMIN';
    const isBillingReportOnly = activeUser?.roleId === 'BILLING_REPORT';
    return NAV_ITEMS.filter((item) => {
      if (isBillingReportOnly) {
        if (!['pos', 'orders', 'services', 'finance'].includes(item.id)) {
          return false;
        }
      }
      if (item.id === 'settings') {
        return isAdminUser; // Settings strictly accessible ONLY to Admin roles
      }
      if (item.id === 'mobile') {
        return isAdminUser;
      }
      if (item.saasModuleKey && !isModuleEnabled(item.saasModuleKey)) {
        return false;
      }
      if (item.id === 'admin_control') {
        return (
          hasPerm('admin.control') ||
          hasPerm('designs.manage') ||
          hasPerm('referrals.approve_payout')
        );
      }
      if (item.id === 'security') {
        return hasPerm('audit.view') || hasPerm('rbac.manage');
      }
      if (isBillingReportOnly && item.id === 'finance') {
        return hasPerm('counter.close');
      }
      return hasPerm(item.requiredPermission);
    });
  }, [hasPerm, isModuleEnabled, activeUser?.roleId]);

  const handleGlobalInputCapture = useCallback((e: React.FormEvent<HTMLDivElement>) => {
    const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
    if (!target || !isEligibleAutoCapInput(target)) return;
    const raw = target.value;
    if (!raw) return;
    const formatted = isStrictNameField(target)
      ? sanitizePersonName(raw)
      : autoCapitalizeTitleCase(raw);
    if (formatted !== raw) {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const delta = raw.length - formatted.length;
      target.value = formatted;
      if (start !== null && end !== null) {
        try {
          const nextPos = Math.max(0, start - delta);
          target.setSelectionRange(nextPos, nextPos);
        } catch {
          // ignore selection range errors on unsupported input types
        }
      }
    }
  }, []);

  useEffect(() => {
    const isAdminUser =
      activeUser?.roleId === 'SUPER_ADMIN' || activeUser?.roleId === 'SAAS_ADMIN';
    if ((activeTab === 'settings' || activeTab === 'mobile') && !isAdminUser) {
      setActiveTab('dashboard');
      return;
    }
    if (visibleNavItems.length > 0 && !visibleNavItems.some((n) => n.id === activeTab)) {
      setActiveTab(visibleNavItems[0].id);
    }
  }, [visibleNavItems, activeTab, activeUser?.roleId]);

  // Auto-expand sidebar group whenever activeTab changes
  useEffect(() => {
    const ownerGroup = NAV_GROUPS.find((g) => g.items.includes(activeTab));
    if (ownerGroup && collapsedGroups[ownerGroup.id]) {
      setCollapsedGroups((prev) => ({ ...prev, [ownerGroup.id]: false }));
    }
  }, [activeTab, collapsedGroups]);

  const runAutoSyncBackup = useCallback(
    async (handleOverride?: any, silent = false) => {
      const targetHandle = handleOverride || syncDirHandle;
      try {
        const res = await fetch(
          `/api/system/backup-snapshot?uid=${encodeURIComponent(activeUserId)}`
        );
        if (!res.ok) throw new Error('Snapshot export failed.');
        const jsonText = await res.text();
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);

        if (targetHandle && typeof targetHandle.getFileHandle === 'function') {
          const latestFile = await targetHandle.getFileHandle('saptari-hospital-latest.json', {
            create: true,
          });
          const w1 = await latestFile.createWritable();
          await w1.write(jsonText);
          await w1.close();

          const archiveFile = await targetHandle.getFileHandle(
            `saptari-hospital-backup-${stamp}.json`,
            { create: true }
          );
          const w2 = await archiveFile.createWritable();
          await w2.write(jsonText);
          await w2.close();

          const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setAutoSyncLastAt(nowStr);
          setAutoSyncStatus(`Synced to ${targetHandle.name || 'PC folder'} at ${nowStr}`);
          if (!silent) showToast(`1-PC backup synced to folder "${targetHandle.name}".`);
        } else {
          const blob = new Blob([jsonText], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `saptari-hospital-backup-${stamp}.json`;
          a.click();
          URL.revokeObjectURL(url);
          const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setAutoSyncLastAt(nowStr);
          setAutoSyncStatus(`Downloaded JSON snapshot at ${nowStr}`);
          if (!silent) showToast('Downloaded JSON backup snapshot.');
        }
      } catch (err: any) {
        setAutoSyncStatus(err.message || 'Auto-sync backup failed.');
        if (!silent) showToast(err.message || 'Backup sync failed.');
      }
    },
    [activeUserId, syncDirHandle, showToast]
  );

  const handleChooseAutoSyncFolder = useCallback(async () => {
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker !== 'function') {
      setAutoSyncStatus(
        'Direct folder writing requires Chrome/Edge desktop. Triggering direct JSON snapshot instead.'
      );
      await runAutoSyncBackup(null, false);
      return;
    }
    try {
      const handle = await picker({ mode: 'readwrite' });
      setSyncDirHandle(handle);
      setAutoSyncFolderName(handle.name || 'Selected PC Folder');
      await runAutoSyncBackup(handle, false);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setAutoSyncStatus(err?.message || 'Could not access PC folder.');
        showToast(err?.message || 'Could not access PC folder.');
      }
    }
  }, [runAutoSyncBackup, showToast]);

  const handleDisableAutoSyncFolder = useCallback(() => {
    setSyncDirHandle(null);
    setAutoSyncFolderName(null);
    setAutoSyncStatus('Folder auto-sync disconnected');
  }, []);

  const autoSyncMinutes = db?.settings?.moduleSettings?.autoSyncBackupMinutes ?? 10;

  useEffect(() => {
    if (!isAuthenticated || !syncDirHandle || autoSyncMinutes <= 0) return;
    const ms = Math.max(1, autoSyncMinutes) * 60 * 1000;
    const timer = window.setInterval(() => {
      void runAutoSyncBackup(syncDirHandle, true);
    }, ms);
    return () => window.clearInterval(timer);
  }, [isAuthenticated, syncDirHandle, autoSyncMinutes, runAutoSyncBackup]);

  // Background Automated Cloud Vault Backup when Google Backup account has auto-sync enabled
  const [cloudAuthUser, setCloudAuthUser] = useState<FirebaseUser | null>(
    () => firebaseAuth.currentUser
  );
  const latestDbRef = useRef<LimsDatabase | null>(db);
  useEffect(() => {
    latestDbRef.current = db;
  }, [db]);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, (u) => setCloudAuthUser(u));
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !cloudAuthUser) return;
    let cancelled = false;
    let timerId: number | undefined;

    void loadCloudSyncConfig(cloudAuthUser)
      .then((cfg) => {
        if (cancelled || !cfg?.autoCloudBackupEnabled) return;
        const intervalMs = Math.max(5, cfg.backupIntervalMinutes || 15) * 60 * 1000;
        timerId = window.setInterval(() => {
          const snapshot = latestDbRef.current;
          if (!snapshot) return;
          void createCloudBackupSnapshot(
            snapshot,
            `Auto Cloud Sync (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
            'AUTO_SYNC'
          ).catch(() => {
            // silent retry on next interval
          });
        }, intervalMs);
      })
      .catch(() => {
        // ignore if sync preference not yet initialized
      });

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearInterval(timerId);
    };
  }, [isAuthenticated, cloudAuthUser]);

  const handleDbUpdated = useCallback(
    (nextDb: LimsDatabase, msg: string, nextTelemetry?: SaasStorageTelemetry) => {
      setDb(nextDb);
      if (nextTelemetry) setTelemetry(nextTelemetry);
      if (msg) showToast(msg);
    },
    [showToast]
  );

  const handleFiscalYearChange = async (nextFy: string) => {
    setActiveFiscalYear(nextFy);
    if (hasPerm('settings.manage')) {
      try {
        const resp = await apiRequest<{ db: LimsDatabase }>('/api/settings', activeUserId, {
          method: 'PUT',
          body: JSON.stringify({ activeFiscalYear: nextFy }),
        });
        setDb(resp.db);
        showToast(`Active Fiscal Year set to ${nextFy}.`);
      } catch (err: any) {
        showToast(err.message || `Switched view filter to ${nextFy}.`);
      }
    } else {
      showToast(`Viewing records for ${nextFy}.`);
    }
  };

  const handleResetDemo = async () => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase; telemetry?: SaasStorageTelemetry }>(
        '/api/reset-demo',
        activeUserId,
        {
          method: 'POST',
        }
      );
      setDb(resp.db);
      if (resp.telemetry) setTelemetry(resp.telemetry);
      if (resp.db?.settings?.activeFiscalYear) {
        setActiveFiscalYear(resp.db.settings.activeFiscalYear);
      }
      showToast('Restored initial Saptari Hospital Pvt Ltd ERP dataset.');
    } catch (err: any) {
      showToast(err.message || 'Reset failed.');
    }
  };

  const handleLockSession = useCallback(async () => {
    sessionStorage.setItem('aegis_pin_locked', 'true');
    setIsPinLocked(true);
    setMobileMenuOpen(false);
    try {
      await apiRequest<{ db: LimsDatabase }>('/api/auth/event', activeUserId, {
        method: 'POST',
        body: JSON.stringify({ action: 'IDLE_LOCK' }),
      });
    } catch {
      // ignore offline lock event
    }
  }, [activeUserId]);

  // Auto-Lock Screen after 2-3 minutes of inactivity (controlled by settings.idleLockSeconds)
  useEffect(() => {
    if (!isAuthenticated || isPinLocked || !db) return;
    const timeoutMs = Math.max(120, Math.min(300, db.settings?.idleLockSeconds || 150)) * 1000;
    let timer = window.setTimeout(() => {
      void handleLockSession();
    }, timeoutMs);

    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void handleLockSession();
      }, timeoutMs);
    };

    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart'] as const;
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [isAuthenticated, isPinLocked, db?.settings?.idleLockSeconds, handleLockSession, db]);

  const handleLogout = async () => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/auth/event', activeUserId, {
        method: 'POST',
        body: JSON.stringify({ action: 'USER_LOGOUT' }),
      });
      setDb(resp.db);
    } catch {
      // ignore offline log failure
    }
    sessionStorage.setItem('aegis_authed', 'false');
    sessionStorage.setItem('aegis_pin_locked', 'false');
    sessionStorage.removeItem('aegis_imp_token');
    setImpersonationToken(null);
    setIsPinLocked(false);
    setIsAuthenticated(false);
    setMobileMenuOpen(false);
  };

  const handleLogin = (staff: StaffMember, nextDb: LimsDatabase) => {
    sessionStorage.setItem('aegis_user_id', staff.id);
    sessionStorage.setItem('aegis_authed', 'true');
    sessionStorage.setItem('aegis_pin_locked', 'false');
    sessionStorage.removeItem('aegis_imp_token');
    setImpersonationToken(null);
    setDb(nextDb);
    setActiveUserId(staff.id);
    setIsAuthenticated(true);
    setIsPinLocked(false);
    showToast(`Signed in as ${staff.fullName} (@${staff.username} · ${staff.roleId}).`);
  };

  const handleImpersonateSuccess = useCallback(
    (resp: {
      activeUser: StaffMember;
      impersonationToken: string;
      db: LimsDatabase;
      telemetry?: SaasStorageTelemetry;
    }) => {
      sessionStorage.setItem('aegis_imp_token', resp.impersonationToken);
      sessionStorage.setItem('aegis_user_id', resp.activeUser.id);
      sessionStorage.setItem('aegis_authed', 'true');
      sessionStorage.setItem('aegis_pin_locked', 'false');
      setImpersonationToken(resp.impersonationToken);
      setActiveUserId(resp.activeUser.id);
      setDb(resp.db);
      if (resp.telemetry) setTelemetry(resp.telemetry);
      setActiveTab('dashboard');
      showToast(
        `Admin Direct Session active: Signed into @${resp.activeUser.username} (${resp.activeUser.assignedCenterName || 'Saptari Hospital Main'}).`
      );
    },
    [showToast]
  );

  const handleExitImpersonation = useCallback(async () => {
    if (!impersonationToken) return;
    try {
      const resp = await apiRequest<{
        activeUser: StaffMember;
        db: LimsDatabase;
        telemetry?: SaasStorageTelemetry;
      }>('/api/saas/exit-impersonation', activeUserId, {
        method: 'POST',
        body: JSON.stringify({ impersonationToken }),
      });
      sessionStorage.removeItem('aegis_imp_token');
      sessionStorage.setItem('aegis_user_id', resp.activeUser.id);
      setImpersonationToken(null);
      setActiveUserId(resp.activeUser.id);
      setDb(resp.db);
      if (resp.telemetry) setTelemetry(resp.telemetry);
      setActiveTab('admin_control');
      showToast(`Returned to Hospital Super Admin (@${resp.activeUser.username}).`);
    } catch (err: any) {
      sessionStorage.removeItem('aegis_imp_token');
      setImpersonationToken(null);
      showToast(err.message || 'Impersonation session cleared.');
    }
  }, [impersonationToken, activeUserId, showToast]);

  const handleGlobalSearchJump = useCallback((target: SearchJumpTarget) => {
    setModuleSearchSeed((prev) => ({ ...prev, [target.tab]: target.query }));
    setActiveTab(target.tab as NavTab);
  }, []);

  // Opens A4ReportModal with Portal #print-portal & honors Instant Print vs Print Preview setting
  const openReportModal = useCallback(
    (order: LabOrder, autoPrint?: boolean) => {
      setBillOrderId(null);
      const isRad = order.tests.some(
        (t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology'
      );
      const settingAuto =
        db?.settings?.moduleSettings?.printOptions?.autoPrintByTemplate?.[
          isRad ? 'radiologyReport' : 'labReport'
        ] === 'AUTO_PRINT';
      setReportAutoPrint(autoPrint !== undefined ? autoPrint : settingAuto);
      setReportOrderId(order.id);
    },
    [db]
  );

  const handleResolveClinicalAlert = useCallback(
    async (alertId: string) => {
      try {
        const resp = await apiRequest<{ db: LimsDatabase }>(
          `/api/clinical/alerts/${alertId}/resolve`,
          activeUserId,
          { method: 'POST', body: JSON.stringify({}) }
        );
        handleDbUpdated(resp.db, 'Abnormal vital alert acknowledged by physician.');
      } catch (err: any) {
        showToast(err.message || 'Failed to acknowledge alert.');
      }
    },
    [activeUserId, handleDbUpdated, showToast]
  );

  const openBillModal = useCallback((order: LabOrder) => {
    setReportOrderId(null);
    setBillOrderId(order.id);
  }, []);

  const resultOrder: LabOrder | null = useMemo(() => {
    if (!db || !resultOrderId) return null;
    return db.orders.find((o) => o.id === resultOrderId) || null;
  }, [db, resultOrderId]);

  const reportOrder: LabOrder | null = useMemo(() => {
    if (!db || !reportOrderId) return null;
    return db.orders.find((o) => o.id === reportOrderId) || null;
  }, [db, reportOrderId]);

  const billOrder: LabOrder | null = useMemo(() => {
    if (!db || !billOrderId) return null;
    return db.orders.find((o) => o.id === billOrderId) || null;
  }, [db, billOrderId]);

  const todayBs = adToBs(new Date());

  if (loading && !db) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 w-full max-w-md space-y-3">
          <div className="h-4 w-40 bg-slate-200 rounded animate-pulse" />
          <div className="h-3 w-full bg-slate-100 rounded animate-pulse" />
          <div className="h-3 w-4/5 bg-slate-100 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  if (loadError || !db || !activeUser) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-rose-200 rounded-xl p-6 max-w-md space-y-3 text-sm">
          <div className="font-semibold text-rose-800">Unable to initialize Saptari Hospital ERP</div>
          <p className="text-slate-600">{loadError || 'Database unavailable.'}</p>
          <button
            type="button"
            onClick={() => fetchBootstrap(activeUserId)}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginScreen db={db} onLogin={handleLogin} onDbSync={setDb} />;
  }

  if (isPinLocked) {
    return (
      <PinLockScreen
        user={activeUser}
        role={activeRole}
        settings={db.settings}
        onUnlocked={(updatedDb, updatedUser) => {
          setDb(updatedDb);
          setActiveUserId(updatedUser.id);
          sessionStorage.setItem('aegis_pin_locked', 'false');
          setIsPinLocked(false);
          showToast(`Session unlocked via Admin PIN for @${updatedUser.username}.`);
        }}
        onLockedOut={(updatedDb) => {
          setDb(updatedDb);
        }}
        onLogout={handleLogout}
      />
    );
  }

  const requiresHospitalPerimeter =
    Boolean(db.settings?.moduleSettings?.hospitalAccessOnlyForStaff) &&
    activeUser.roleId !== 'SUPER_ADMIN' &&
    !perimeterOk;

  if (requiresHospitalPerimeter) {
    const handleVerifyPerimeter = async (e: React.FormEvent) => {
      e.preventDefault();
      setPerimeterError('');
      setVerifyingPerimeter(true);
      try {
        const resp = await apiRequest<{ verified: boolean }>('/api/access/verify-perimeter', activeUser.id, {
          method: 'POST',
          body: JSON.stringify({ wifiCode: perimeterCode.trim() }),
        });
        if (resp.verified) {
          sessionStorage.setItem('saptari_perimeter_ok', 'true');
          setPerimeterOk(true);
          showToast('Hospital premises verified. Access unlocked.');
        }
      } catch (err: any) {
        setPerimeterError(err.message || 'Verification failed. Enter Hospital WiFi / Gate Check Code.');
      } finally {
        setVerifyingPerimeter(false);
      }
    };

    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <form
          onSubmit={handleVerifyPerimeter}
          className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full space-y-4 text-xs shadow-2xl"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
              <Wifi className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-900">
                Hospital Premises Verification Required
              </h1>
              <p className="text-slate-500">
                Access for <strong>@{activeUser.username}</strong> is restricted to inside Saptari Hospital premises.
              </p>
            </div>
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">
              Hospital WiFi / Premises Security Code *
            </label>
            <input
              required
              value={perimeterCode}
              onChange={(e) => setPerimeterCode(e.target.value)}
              placeholder="Ask Hospital Reception or Admin"
              className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
            />
          </div>
          {perimeterError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg flex items-center justify-between gap-2">
              <span>{perimeterError}</span>
              <button
                type="button"
                onClick={() => setPerimeterError('')}
                className="p-0.5 text-rose-600 hover:text-rose-900 rounded"
                title="Close"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleLogout}
              className="px-3.5 py-2 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Switch User / Logout
            </button>
            <button
              type="submit"
              disabled={verifyingPerimeter}
              className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {verifyingPerimeter ? 'Verifying...' : 'Verify Hospital Premises'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  const openAlertsCount = (db.securityAlerts || []).filter((a) => !a.resolved).length;
  const pendingFinanceCount = (db.financeApprovalRequests || []).filter(
    (r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN'
  ).length;
  const currentNavLabel = NAV_ITEMS.find((n) => n.id === activeTab)?.label || 'Overview';

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900 flex"
      onInputCapture={handleGlobalInputCapture}
    >
      {/* Desktop Sidebar */}
      <aside className="no-print hidden lg:flex lg:w-60 xl:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-white border-r border-slate-200">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-bold text-xs tracking-tight text-slate-900 leading-tight truncate">
              Hospital Management System
            </div>
            <div className="text-[10px] font-mono text-slate-500 truncate">
              {db.settings.labName} · {todayBs.formattedEn}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
          <div className="flex items-center justify-between px-2 pb-1 text-[10px] font-medium text-slate-400">
            <span className="uppercase tracking-wider">Modules</span>
            <button
              type="button"
              onClick={() => {
                const collapsibleIds = NAV_GROUPS.filter((g) => g.items.length > 1).map((g) => g.id);
                const anyExpanded = collapsibleIds.some((id) => !collapsedGroups[id]);
                if (anyExpanded) {
                  const next: Record<string, boolean> = {};
                  for (const id of collapsibleIds) next[id] = true;
                  setCollapsedGroups(next);
                } else {
                  setCollapsedGroups({});
                }
              }}
              className="text-blue-600 hover:text-blue-800 whitespace-nowrap"
            >
              {NAV_GROUPS.filter((g) => g.items.length > 1).some((g) => !collapsedGroups[g.id])
                ? 'Collapse All'
                : 'Expand All'}
            </button>
          </div>
          {NAV_GROUPS.map((group) => {
            const groupItems = group.items
              .map((id) => visibleNavItems.find((n) => n.id === id))
              .filter((x): x is NavItem => Boolean(x));
            if (groupItems.length === 0) return null;
            const isCollapsed = Boolean(collapsedGroups[group.id]);
            const showGroupHeader = group.items.length > 1;
            return (
              <div key={group.id} className="space-y-0.5">
                {showGroupHeader && (
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({ ...prev, [group.id]: !prev[group.id] }))
                    }
                    className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-700"
                  >
                    <span className="truncate">{group.label}</span>
                    {isCollapsed ? (
                      <ChevronRight className="w-3 h-3 shrink-0" />
                    ) : (
                      <ChevronDown className="w-3 h-3 shrink-0" />
                    )}
                  </button>
                )}
                {!isCollapsed &&
                  groupItems.map((item) => {
                    const Icon = item.icon;
                    const active = activeTab === item.id;
                    const showAlertBadge = item.id === 'security' && openAlertsCount > 0;
                    const showFinanceBadge = item.id === 'finance' && pendingFinanceCount > 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                          active
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <Icon className="w-4 h-4 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </span>
                        {showAlertBadge && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-rose-600 text-white rounded">
                            {openAlertsCount}
                          </span>
                        )}
                        {showFinanceBadge && (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-600 text-white rounded">
                            {pendingFinanceCount}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-2">
          {telemetry && (
            <div className="pb-2 mb-2 border-b border-slate-100">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                <span>Space Used</span>
                <span>
                  {telemetry.totalUsedMb >= 1024
                    ? `${(telemetry.totalUsedMb / 1024).toFixed(1)}G`
                    : `${Math.round(telemetry.totalUsedMb)}M`}{' '}
                  / {Math.round(telemetry.totalQuotaMb / 1024)}G
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-600"
                  style={{ width: `${Math.max(3, Math.min(100, telemetry.percentUsed))}%` }}
                />
              </div>
            </div>
          )}
          <div className="text-[11px] font-medium text-slate-500">Active Operator Session</div>
          <div className="text-xs font-semibold text-slate-900 truncate">{activeUser.fullName}</div>
          <div className="text-[11px] font-mono text-blue-700 truncate">
            @{activeUser.username} · {activeRole?.name}
          </div>

          <div className="grid grid-cols-2 gap-1.5 mt-1.5">
            <button
              type="button"
              onClick={handleLockSession}
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200"
            >
              <Lock className="w-3 h-3" />
              PIN Lock
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
            >
              <LogOut className="w-3 h-3" />
              Logout
            </button>
          </div>

          <div className="pt-2 border-t border-slate-100 text-[10px] text-slate-500 text-center leading-tight">
            Designed and developed by <strong className="text-slate-800 block">Dr. Santosh Majhi</strong>
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="no-print fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 max-w-full bg-white border-r border-slate-200 flex flex-col z-10">
            <div className="h-16 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="font-display font-bold text-sm text-slate-900 truncate">Hospital Management System</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-2 overflow-y-auto">
              {NAV_GROUPS.map((group) => {
                const groupItems = group.items
                  .map((id) => visibleNavItems.find((n) => n.id === id))
                  .filter((x): x is NavItem => Boolean(x));
                if (groupItems.length === 0) return null;
                return (
                  <div key={group.id} className="space-y-0.5">
                    {group.items.length > 1 && (
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {group.label}
                      </div>
                    )}
                    {groupItems.map((item) => {
                      const Icon = item.icon;
                      const active = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setActiveTab(item.id);
                            setMobileMenuOpen(false);
                          }}
                          className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-medium rounded-lg ${
                            active
                              ? 'bg-blue-50 text-blue-700'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`}
                        >
                          <span className="flex items-center gap-2.5 min-w-0">
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.id === 'finance' && pendingFinanceCount > 0 && (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-amber-600 text-white rounded">
                              {pendingFinanceCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <div className="p-3 border-t border-slate-200 space-y-2">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg"
              >
                <LogOut className="w-3.5 h-3.5" />
                Logout
              </button>
              <div className="text-[10px] text-center text-slate-500 leading-tight">
                Designed and developed by <strong className="text-slate-800 block">Dr. Santosh Majhi</strong>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 lg:pl-60 xl:pl-64 flex flex-col min-w-0">
        {/* Top Context Bar */}
        <header className="no-print h-14 lg:h-16 bg-white border-b border-slate-200 px-3 sm:px-5 flex items-center justify-between gap-2 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200"
              aria-label="Open navigation"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-xs sm:text-sm text-slate-500 truncate">
              <span className="font-medium text-slate-900">Hospital Management System</span>
              <span className="hidden sm:inline text-slate-400"> · {db.settings.labName}</span>
              <span className="mx-2 text-slate-300">/</span>
              <span>{currentNavLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Full-ERP Search Trigger */}
            <button
              type="button"
              onClick={() => setShowGlobalSearch(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
              title="Search full ERP across all modules (Ctrl+K)"
            >
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <span className="hidden md:inline">Search ERP</span>
              <span className="hidden xl:inline text-[10px] font-mono text-slate-400 border border-slate-300 rounded px-1">
                ⌘K
              </span>
            </button>

            <PWAInstallButton compact />

            {/* Fiscal Year Selector */}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400 hidden md:block" />
              <select
                aria-label="Fiscal Year"
                value={activeFiscalYear}
                onChange={(e) => handleFiscalYearChange(e.target.value)}
                className="px-2 py-1.5 text-xs font-mono font-medium text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              >
                {FISCAL_YEARS.map((fy) => (
                  <option key={fy} value={fy}>
                    {fy}
                  </option>
                ))}
              </select>
            </div>

            {hasPerm('patients.manage') && (
              <button
                type="button"
                onClick={() => setActiveTab('patients')}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Patient Intake
              </button>
            )}

            {hasPerm('pos.billing') && isModuleEnabled('pos_billing') && (
              <button
                type="button"
                onClick={() => setActiveTab('pos')}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Receipt className="w-3.5 h-3.5" />
                POS Counter
              </button>
            )}

            <button
              type="button"
              onClick={handleLockSession}
              title="Lock Screen (Admin PIN)"
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0"
            >
              <Lock className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Lock PIN</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              title="Logout"
              className="inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Logout</span>
            </button>
          </div>
        </header>

        {/* Admin Direct Staff Switch Banner */}
        {impersonationToken && (
          <div className="no-print mx-4 sm:mx-6 mt-4 px-4 py-2.5 rounded-lg bg-indigo-950 text-white text-xs flex flex-wrap items-center justify-between gap-3 border border-indigo-700">
            <div className="flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-indigo-300 shrink-0" />
              <span>
                <strong>Hospital Admin Direct Session:</strong> Operating inside{' '}
                <strong className="font-mono">@{activeUser.username}</strong> ({activeUser.fullName} ·{' '}
                {activeUser.assignedCenterName || 'Saptari Hospital Main'})
              </span>
            </div>
            <button
              type="button"
              onClick={handleExitImpersonation}
              className="px-3 py-1 text-xs font-medium text-indigo-950 bg-white rounded-md hover:bg-indigo-100 whitespace-nowrap"
            >
              Return to Hospital Admin
            </button>
          </div>
        )}

        {/* Toast Feedback Banner */}
        {toast && (
          <div className="no-print mx-4 sm:mx-6 mt-4 px-4 py-2.5 rounded-lg bg-slate-900 text-white text-xs flex items-center justify-between gap-4">
            <span>{toast}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-300 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Pinned Viewport Critical Alert Banner */}
        <CriticalAlertBanner
          db={db}
          onResolveMlc={(erCase) => {
            setModuleSearchSeed((prev) => ({ ...prev, emergency: erCase.erNumber }));
            setActiveTab('emergency');
          }}
          onResolveCriticalOrder={(order) => setResultOrderId(order.id)}
          onAcknowledgeVitalsAlert={handleResolveClinicalAlert}
          onNavigateToPortal={() => setActiveTab(hasPerm('doctor.view') ? 'doctor_portal' : 'nursing_portal')}
        />

        {/* Active Module Viewport */}
        <main className="no-print flex-1 p-3 sm:p-4 lg:p-5 max-w-[1440px] w-full mx-auto min-w-0">
          {activeTab === 'dashboard' && (
            <DashboardView
              db={db}
              activeFiscalYear={activeFiscalYear}
              activeUserId={activeUser.id}
              hasPerm={hasPerm}
              onNavigate={(tab) => setActiveTab(tab as NavTab)}
              onOpenNewOrder={() => setActiveTab('pos')}
              onOpenResults={(o) => setResultOrderId(o.id)}
              onOpenReport={openReportModal}
              onUpdated={handleDbUpdated}
            />
          )}

          {activeTab === 'patients' && (
            <PatientFlowView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              onRouteToBilling={(target, payload) => {
                setPreselectedEncounter(payload);
                setActiveTab(target);
              }}
              onRouteToModule={(target, payload) => {
                setPreselectedEncounter(payload);
                setActiveTab(target as NavTab);
              }}
              onOpenReport={openReportModal}
              onOpenBill={openBillModal}
            />
          )}

          {activeTab === 'doctor_portal' && (
            <NursingDoctorPortalView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              initialMode="DOCTOR"
              onUpdated={() => fetchBootstrap(activeUser.id)}
              onOpenReport={(o) => openReportModal(o)}
            />
          )}

          {activeTab === 'nursing_portal' && (
            <NursingDoctorPortalView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              initialMode="NURSE"
              onUpdated={() => fetchBootstrap(activeUser.id)}
              onOpenReport={(o) => openReportModal(o)}
            />
          )}

          {activeTab === 'pos' && (
            <PosBillingView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              onPrintBill={openBillModal}
              onPrintReport={(o) => openReportModal(o)}
              preselectedEncounter={preselectedEncounter}
              onClearPreselectedEncounter={() => setPreselectedEncounter(null)}
            />
          )}

          {activeTab === 'orders' && (
            <OrdersTatView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onOpenNewOrder={() => setActiveTab('pos')}
              onOpenResults={(o) => setResultOrderId(o.id)}
              onOpenReport={openReportModal}
              onOpenBill={openBillModal}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.orders}
            />
          )}

          {activeTab === 'radiology' && (
            <RadiologyView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              onOpenResults={(o) => setResultOrderId(o.id)}
              onOpenReport={openReportModal}
              initialSearchQuery={moduleSearchSeed.radiology}
            />
          )}

          {activeTab === 'pharmacy' && (
            <PharmacyView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.pharmacy}
              preselectedEncounter={preselectedEncounter}
              onClearPreselectedEncounter={() => setPreselectedEncounter(null)}
            />
          )}

          {activeTab === 'opd' && (
            <OpdView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              onAdmitFromOpd={(visit) => {
                setOpdToIpdVisit(visit);
                setActiveTab('ipd');
              }}
              initialSearchQuery={moduleSearchSeed.opd}
              preselectedPatient={preselectedEncounter?.patient || null}
              onClearPreselectedPatient={() => setPreselectedEncounter(null)}
            />
          )}

          {activeTab === 'ipd' && (
            <IpdBedView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              admitFromOpdVisit={opdToIpdVisit}
              onClearOpdHandoff={() => setOpdToIpdVisit(null)}
              initialSearchQuery={moduleSearchSeed.ipd}
              preselectedPatient={preselectedEncounter?.patient || null}
              onClearPreselectedPatient={() => setPreselectedEncounter(null)}
            />
          )}

          {activeTab === 'ot' && (
            <OtManagementView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
            />
          )}

          {activeTab === 'emergency' && (
            <EmergencyMlcView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.emergency}
              preselectedPatient={preselectedEncounter?.patient || null}
              onClearPreselectedPatient={() => setPreselectedEncounter(null)}
            />
          )}

          {activeTab === 'services' && (
            <ServiceMasterView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.services}
            />
          )}

          {activeTab === 'inventory' && (
            <InventoryView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.inventory}
            />
          )}

          {activeTab === 'referrals' && (
            <ReferralsView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.referrals}
            />
          )}

          {activeTab === 'marketing' && (
            <MarketingView
              db={db}
              activeUser={activeUser}
              onUpdated={handleDbUpdated}
            />
          )}

          {activeTab === 'gatepass' && (
            <GatepassVisitorView
              db={db}
              activeUser={activeUser}
              onUpdated={handleDbUpdated}
            />
          )}

          {activeTab === 'mis_reports' && (
            <MisReportsView
              db={db}
              activeFiscalYear={activeFiscalYear}
            />
          )}

          {activeTab === 'finance' && (
            <FinanceCounterView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.finance}
            />
          )}

          {activeTab === 'personnel' && (
            <PersonnelView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.personnel}
            />
          )}

          {activeTab === 'mobile' && (
            <MobileAppView
              db={db}
              activeUser={activeUser}
              activeFiscalYear={activeFiscalYear}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              onOpenReport={openReportModal}
              onOpenResults={(o) => setResultOrderId(o.id)}
              onOpenBill={openBillModal}
              onLogout={handleLogout}
              onLockNow={handleLockSession}
            />
          )}

          {activeTab === 'darta' && (
            <DartaChalaniView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.darta}
            />
          )}

          {activeTab === 'dhis2' && (
            <Dhis2View
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.dhis2}
            />
          )}

          {activeTab === 'admin_control' && (
            <AdminControlView
              db={db}
              telemetry={telemetry}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              onImpersonateSuccess={handleImpersonateSuccess}
              initialSearchQuery={moduleSearchSeed.admin_control}
            />
          )}

          {activeTab === 'security' && (
            <SecurityAuditView
              db={db}
              activeUser={activeUser}
              hasPerm={hasPerm}
              onUpdated={handleDbUpdated}
              initialSearchQuery={moduleSearchSeed.security}
            />
          )}

          {activeTab === 'settings' &&
            (activeUser.roleId === 'SUPER_ADMIN' || activeUser.roleId === 'SAAS_ADMIN') && (
              <SettingsView
                db={db}
                activeUser={activeUser}
                hasPerm={hasPerm}
                onUpdated={handleDbUpdated}
                onCloseAfterSave={() => setActiveTab('dashboard')}
                onResetDemo={handleResetDemo}
                onLogout={handleLogout}
                onLockNow={handleLockSession}
                initialSearchQuery={moduleSearchSeed.settings}
                autoSyncFolderName={autoSyncFolderName}
                autoSyncLastAt={autoSyncLastAt}
                autoSyncStatus={autoSyncStatus}
                onChooseAutoSyncFolder={handleChooseAutoSyncFolder}
                onSyncBackupNow={() => {
                  void runAutoSyncBackup(syncDirHandle, false);
                }}
                onDisableAutoSyncFolder={handleDisableAutoSyncFolder}
              />
            )}
        </main>
      </div>

      {/* Modals */}

      {resultOrder && (
        <ResultWorkbenchModal
          order={resultOrder}
          services={db.services}
          radiologyTemplates={db.radiologyTemplates}
          activeUser={activeUser}
          canEnterResults={hasPerm('results.enter')}
          canValidateResults={hasPerm('results.validate')}
          canReportRadiology={hasPerm('radiology.report')}
          onClose={() => setResultOrderId(null)}
          onUpdated={handleDbUpdated}
        />
      )}

      {reportOrder && (
        <A4ReportModal
          order={reportOrder}
          settings={db.settings}
          documentDesigns={db.documentDesigns}
          centers={db.centers}
          activeUser={activeUser}
          canPrint={hasPerm('reports.print')}
          canEmail={hasPerm('reports.email')}
          canApiSend={hasPerm('reports.api_send')}
          autoPrint={reportAutoPrint}
          onClose={() => {
            setReportOrderId(null);
            setReportAutoPrint(false);
          }}
          onUpdated={handleDbUpdated}
        />
      )}

      {billOrder && (
        <PosBillReceiptModal
          order={billOrder}
          settings={db.settings}
          documentDesigns={db.documentDesigns}
          centers={db.centers}
          autoPrint={
            db.settings.moduleSettings?.printOptions?.autoPrintByTemplate?.posBill === 'AUTO_PRINT'
          }
          onClose={() => setBillOrderId(null)}
        />
      )}

      <GlobalErpSearchModal
        isOpen={showGlobalSearch}
        db={db}
        allowedTabs={new Set(visibleNavItems.map((n) => n.id))}
        onClose={() => setShowGlobalSearch(false)}
        onSelectTarget={handleGlobalSearchJump}
      />

      <OfflineIndicator />
    </div>
  );
}
