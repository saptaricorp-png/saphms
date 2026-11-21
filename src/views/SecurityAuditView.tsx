import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  EyeOff,
  KeyRound,
  Layers,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  AuditLogEntry,
  LimsDatabase,
  PermissionKey,
  RoleDefinition,
  RoleId,
  SecurityAlert,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { sanitizePersonName } from '../utils/textFormat';

interface ModuleGroupDef {
  moduleKey: string;
  title: string;
  description: string;
  permissions: Array<{ key: PermissionKey; label: string }>;
}

const MODULE_PERMISSION_GROUPS: ModuleGroupDef[] = [
  {
    moduleKey: 'dashboard',
    title: 'Executive Dashboard & Analytics',
    description: 'Home dashboard, priority alerts, shift handover & QR attendance widgets',
    permissions: [{ key: 'dashboard.view', label: 'View Dashboard & Overview' }],
  },
  {
    moduleKey: 'pos_billing',
    title: 'Hospital POS, Patient Intake & Orders',
    description: 'Walk-in billing, patient registration, lab/hospital accession & sample tracking',
    permissions: [
      { key: 'pos.billing', label: 'POS Billing & Cash Counter' },
      { key: 'orders.view', label: 'View Lab Orders & TAT' },
      { key: 'orders.create', label: 'Register New Orders' },
      { key: 'orders.collect', label: 'Sample Collection / Phlebotomy' },
      { key: 'orders.advance', label: 'Advance Specimen Stage' },
    ],
  },
  {
    moduleKey: 'reports_dispatch',
    title: 'Reports Print, Email & API Dispatch',
    description: 'Print A4 reports, email report dispatch & automated API/WhatsApp dispatch',
    permissions: [
      { key: 'reports.print', label: 'Print A4 Reports & Receipts' },
      { key: 'reports.email', label: 'Send Report Email Notifications' },
      { key: 'reports.api_send', label: 'Send API Webhooks' },
    ],
  },
  {
    moduleKey: 'laboratory',
    title: 'Pathology Bench & Result Validation',
    description: 'Analyzer result entry, delta checks & pathologist sign-off',
    permissions: [
      { key: 'results.enter', label: 'Enter Bench Results' },
      { key: 'results.validate', label: 'Validate & Sign Off Reports' },
    ],
  },
  {
    moduleKey: 'radiology',
    title: 'Radiology & Imaging (X-Ray / USG / CT)',
    description: 'Imaging worklist, structured templates, reporting & film stock',
    permissions: [
      { key: 'radiology.view', label: 'View Radiology Studies' },
      { key: 'radiology.report', label: 'Draft & Save Radiology Reports' },
      { key: 'radiology.manage', label: 'Manage Templates & Film Stock' },
    ],
  },
  {
    moduleKey: 'opd_ipd',
    title: 'Outpatient (OPD) & Inpatient (IPD) Wards',
    description: 'OPD visits, IPD bed management, admissions, transfers & ward charges',
    permissions: [
      { key: 'hospital.view', label: 'View OPD, IPD & Bed Board' },
      { key: 'hospital.clinical', label: 'OPD Consult, Admit, Meds & IPD Billing' },
      { key: 'hospital.manage', label: 'Configure Wards, Beds & Rates' },
    ],
  },
  {
    moduleKey: 'nursing_doctor',
    title: 'Nursing Station & Doctor Round Console',
    description: 'Nursing vitals/MAR, shift observations & attending physician portal',
    permissions: [
      { key: 'nursing.view', label: 'Access Nursing Station & MAR' },
      { key: 'doctor.view', label: 'Access Doctor Round Console' },
    ],
  },
  {
    moduleKey: 'emergency_ot',
    title: 'Emergency (ER / MLC) & Operation Theatre',
    description: 'Casualty triage, MLC police intimation, OT theatre booking & anesthesia log',
    permissions: [
      { key: 'emergency.view', label: 'View Emergency & MLC Register' },
      { key: 'emergency.manage', label: 'Manage ER Triage & Bed Admit' },
      { key: 'ot.view', label: 'View OT Surgery Schedule' },
      { key: 'ot.manage', label: 'Schedule & Complete OT Surgeries' },
      { key: 'ot.anesthesia', label: 'Record OT Anesthesia & PACU Log' },
    ],
  },
  {
    moduleKey: 'pharmacy',
    title: 'Pharmacy POS, Inventory & Ledger',
    description: 'Medicine dispensing, FEFO batches, supplier GRN & pharma P&L ledger',
    permissions: [
      { key: 'pharmacy.view', label: 'View Pharmacy Stock & Ledger' },
      { key: 'pharmacy.dispense', label: 'Pharmacy POS Billing & Checkout' },
      { key: 'pharmacy.manage', label: 'Manage Medicines, GRN & Quarantine' },
    ],
  },
  {
    moduleKey: 'finance',
    title: 'Finance, Ledger, Approvals & Counter Close',
    description: 'Cash/Bank accounts, P&L ledger, discount/credit approvals & shift counter close',
    permissions: [
      { key: 'finance.view', label: 'View Bank, Cash & P&L Accounts' },
      { key: 'finance.manage', label: 'Post Expenses & Bank Deposits' },
      { key: 'finance.approve_manager', label: 'Manager Tier Approval (Discounts/Credit)' },
      { key: 'finance.approve_admin', label: 'Admin Final Approval (Discounts/Credit)' },
      { key: 'counter.close', label: 'Perform Daily Counter Close' },
      { key: 'referrals.view', label: 'View Referral Commissions' },
      { key: 'referrals.manage', label: 'Manage Referral Rules' },
      { key: 'referrals.approve_payout', label: 'Approve Referral Payouts' },
    ],
  },
  {
    moduleKey: 'admin_darta_dhis2',
    title: 'Darta/Chalani, DHIS2 HMIS & Gatepass',
    description: 'Official letters, Word/AI correspondence, DHIS2 reporting & visitor passes',
    permissions: [
      { key: 'darta.view', label: 'View Darta & Chalani Register' },
      { key: 'darta.manage', label: 'Compose, Edit, Print & AI Draft Letters' },
      { key: 'dhis2.view', label: 'View DHIS2 / HMIS Reports' },
      { key: 'dhis2.manage', label: 'Generate & Submit DHIS2 Reports' },
      { key: 'gatepass.manage', label: 'Visitor Gatepass & Ward Pass' },
      { key: 'marketing.manage', label: 'Field Marketing & Outreach' },
      { key: 'mis.view', label: 'Executive MIS Analytics' },
    ],
  },
  {
    moduleKey: 'hr_inventory',
    title: 'HR, Payroll, Certificates & Lab Stock',
    description: 'Staff roster, duty shifts, salary payroll, HR letters & general inventory',
    permissions: [
      { key: 'personnel.view', label: 'View Employee Roster & Shifts' },
      { key: 'personnel.manage', label: 'Create Staff, Shifts & HR Certificates' },
      { key: 'payroll.view', label: 'View Payroll Batches' },
      { key: 'payroll.manage', label: 'Run & Disburse Payroll' },
      { key: 'inventory.view', label: 'View Reagents & Hospital Assets' },
      { key: 'inventory.manage', label: 'Restock Reagents & Manage Assets' },
      { key: 'services.view', label: 'View Test & Service Catalog' },
      { key: 'services.manage', label: 'Edit / Delete Service Master' },
    ],
  },
  {
    moduleKey: 'security_admin',
    title: 'Security, RBAC, Settings & Print Designer',
    description: 'Role management, audit trail, hospital settings & document templates',
    permissions: [
      { key: 'audit.view', label: 'View Immutable Audit Trail' },
      { key: 'rbac.manage', label: 'Create Roles, Assign Modules & RBAC' },
      { key: 'settings.manage', label: 'Manage Hospital Settings & Tariffs' },
      { key: 'admin.control', label: 'Admin Control & Module Toggles' },
      { key: 'designs.manage', label: 'Bill & Report Print Designer' },
      { key: 'mobile.app', label: 'Mobile Companion Access' },
    ],
  },
];

const ALL_PERMISSION_ITEMS = MODULE_PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => ({ ...p, group: g.title, moduleKey: g.moduleKey }))
);

interface SecurityAuditViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function SecurityAuditView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: SecurityAuditViewProps) {
  const canManageRbac = hasPerm('rbac.manage');
  const canViewAudit = hasPerm('audit.view');
  const canManageStaff =
    hasPerm('personnel.manage') || hasPerm('rbac.manage') || hasPerm('admin.control');

  const [activeTab, setActiveTab] = useState<'ROLES' | 'ACCOUNTS' | 'MATRIX' | 'AUDIT'>('ROLES');
  const [matrixGroupFilter, setMatrixGroupFilter] = useState<string>('ALL');

  const [auditSearch, setAuditSearch] = useState(initialSearchQuery || '');
  const [moduleFilter, setModuleFilter] = useState<'ALL' | AuditLogEntry['module']>('ALL');
  const [severityFilter, setSeverityFilter] = useState<'ALL' | AuditLogEntry['severity']>('ALL');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setAuditSearch(initialSearchQuery);
      if (initialSearchQuery.trim()) setActiveTab('AUDIT');
    }
  }, [initialSearchQuery]);

  // Role Designer Modal (Create or Edit Role + Module Assignment)
  const [roleModalMode, setRoleModalMode] = useState<'create' | 'edit' | null>(null);
  const [editingRoleId, setEditingRoleId] = useState<string>('');
  const [roleName, setRoleName] = useState('');
  const [roleCode, setRoleCode] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [rolePermissions, setRolePermissions] = useState<PermissionKey[]>(['dashboard.view']);
  const [savingRole, setSavingRole] = useState(false);
  const [roleModalError, setRoleModalError] = useState('');

  // Quick Create Staff Account Modal
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [confirmDeleteRole, setConfirmDeleteRole] = useState<RoleDefinition | null>(null);
  const [showCreatePass, setShowCreatePass] = useState(false);
  const [showResetPass, setShowResetPass] = useState(false);
  const [uEmployeeCode, setUEmployeeCode] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uUsername, setUUsername] = useState('');
  const [uPassword, setUPassword] = useState('Hosp@2083');
  const [uPin, setUPin] = useState('1234');
  const [uDesignation, setUDesignation] = useState('Hospital Officer');
  const [uDepartment, setUDepartment] = useState('Administration & Billing');
  const [uPhone, setUPhone] = useState('');
  const [uRoleId, setURoleId] = useState<RoleId>(db.roles[1]?.id || db.roles[0]?.id || 'BILLING_REPORT');
  const [uShift, setUShift] = useState<StaffMember['shift']>('Morning (07:00-15:00)');
  const [uSalary, setUSalary] = useState('32000');
  const [creatingUser, setCreatingUser] = useState(false);
  const [createUserError, setCreateUserError] = useState('');
  const [accountSearch, setAccountSearch] = useState('');

  // Unlock / Credential Reset Modal
  const [unlockModal, setUnlockModal] = useState<{
    staff: StaffMember;
    alert?: SecurityAlert;
  } | null>(null);
  const [newPass, setNewPass] = useState('Reset@2083');
  const [newPin, setNewPin] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [resetting, setResetting] = useState(false);

  const openCreateRoleModal = () => {
    setRoleModalMode('create');
    setEditingRoleId('');
    setRoleName('');
    setRoleCode('');
    setRoleDescription('');
    setRolePermissions(['dashboard.view']);
    setRoleModalError('');
  };

  const openEditRoleModal = (role: RoleDefinition) => {
    setRoleModalMode('edit');
    setEditingRoleId(role.id);
    setRoleName(role.name);
    setRoleCode(role.id);
    setRoleDescription(role.description || '');
    setRolePermissions([...role.permissions]);
    setRoleModalError('');
  };

  const toggleModuleCardInModal = (grp: ModuleGroupDef) => {
    const grpKeys = grp.permissions.map((p) => p.key);
    const allSelected = grpKeys.every((k) => rolePermissions.includes(k));
    if (allSelected) {
      setRolePermissions((prev) =>
        prev.filter((p) => {
          if (editingRoleId === 'SUPER_ADMIN' && (p === 'rbac.manage' || p === 'admin.control')) return true;
          return !grpKeys.includes(p);
        })
      );
    } else {
      setRolePermissions((prev) => Array.from(new Set([...prev, ...grpKeys])));
    }
  };

  const toggleSinglePermInModal = (perm: PermissionKey) => {
    if (editingRoleId === 'SUPER_ADMIN' && (perm === 'rbac.manage' || perm === 'admin.control')) return;
    setRolePermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSaveRoleModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roleName.trim()) {
      setRoleModalError('Role Name is required.');
      return;
    }
    const assignedModuleKeys = MODULE_PERMISSION_GROUPS.filter((g) =>
      g.permissions.some((p) => rolePermissions.includes(p.key))
    ).map((g) => g.moduleKey);

    setSavingRole(true);
    setRoleModalError('');
    try {
      if (roleModalMode === 'create') {
        const resp = await apiRequest<{ db: LimsDatabase }>('/api/rbac/roles', activeUser.id, {
          method: 'POST',
          body: JSON.stringify({
            id: roleCode.trim() || undefined,
            name: roleName.trim(),
            description: roleDescription.trim() || undefined,
            permissions: rolePermissions,
            assignedModuleKeys,
          }),
        });
        setRoleModalMode(null);
        onUpdated(resp.db, `Created custom role "${roleName.trim()}" with ${assignedModuleKeys.length} module(s).`);
      } else if (roleModalMode === 'edit' && editingRoleId) {
        const resp = await apiRequest<{ db: LimsDatabase }>(
          `/api/rbac/roles/${encodeURIComponent(editingRoleId)}`,
          activeUser.id,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name: roleName.trim(),
              description: roleDescription.trim(),
              permissions: rolePermissions,
              assignedModuleKeys,
            }),
          }
        );
        setRoleModalMode(null);
        onUpdated(resp.db, `Updated role "${roleName.trim()}" & module assignments.`);
      }
    } catch (err: any) {
      setRoleModalError(err.message || 'Failed to save role.');
    } finally {
      setSavingRole(false);
    }
  };

  const handleDeleteRole = async (role: RoleDefinition) => {
    if (role.id === 'SUPER_ADMIN' || role.id === 'SAAS_ADMIN') return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/rbac/roles/${encodeURIComponent(role.id)}`,
        activeUser.id,
        { method: 'DELETE' }
      );
      setConfirmDeleteRole(null);
      onUpdated(resp.db, `Deleted role "${role.name}".`);
    } catch (err: any) {
      setConfirmDeleteRole(null);
      onUpdated(db, err.message || 'Could not delete role.');
    }
  };

  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uFullName.trim() || !uEmployeeCode.trim()) {
      setCreateUserError('Employee Code and Full Name are required.');
      return;
    }
    setCreatingUser(true);
    setCreateUserError('');
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/personnel', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          employeeCode: uEmployeeCode.trim(),
          fullName: uFullName.trim(),
          username: uUsername.trim() || undefined,
          password: uPassword.trim() || 'Hosp@2083',
          pin: uPin.trim() || '1234',
          designation: uDesignation.trim() || 'Hospital Staff',
          department: uDepartment.trim() || 'Administration',
          phone: uPhone.trim(),
          roleId: uRoleId,
          shift: uShift,
          status: 'Active',
          basicSalaryNpr: Number(uSalary) || 32000,
        }),
      });
      setShowCreateUserModal(false);
      setUEmployeeCode('');
      setUFullName('');
      setUUsername('');
      setUPhone('');
      onUpdated(resp.db, `Created account for ${uFullName.trim()} (${uRoleId}).`);
    } catch (err: any) {
      setCreateUserError(err.message || 'Failed to create staff account.');
    } finally {
      setCreatingUser(false);
    }
  };

  const handleInlineAssignRole = async (member: StaffMember, nextRoleId: RoleId) => {
    if (!canManageRbac || member.roleId === nextRoleId) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/personnel/${encodeURIComponent(member.id)}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify({ roleId: nextRoleId }),
        }
      );
      const targetRoleName = db.roles.find((r) => r.id === nextRoleId)?.name || nextRoleId;
      onUpdated(resp.db, `Assigned ${member.fullName} (@${member.username}) → ${targetRoleName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to reassign role.');
    }
  };

  const handleInlineStatusChange = async (member: StaffMember, status: StaffMember['status']) => {
    if (!canManageStaff || member.status === status) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/personnel/${encodeURIComponent(member.id)}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify({ status }),
        }
      );
      onUpdated(resp.db, `Updated @${member.username} account status to ${status}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to update status.');
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockModal || !resetReason.trim()) return;
    setResetting(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/auth/admin-reset', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: unlockModal.staff.id,
          newPassword: newPass.trim() || undefined,
          newPin: newPin.trim() || undefined,
          reason: resetReason.trim(),
        }),
      });
      onUpdated(
        resp.db,
        `Reset credentials & unlocked @${unlockModal.staff.username} (${unlockModal.staff.fullName}).`
      );
      setUnlockModal(null);
      setResetReason('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Reset failed.');
    } finally {
      setResetting(false);
    }
  };

  const filteredStaff = useMemo(() => {
    const q = accountSearch.trim().toLowerCase();
    return (db.staff || []).filter((s) => {
      if (!q) return true;
      return `${s.fullName} ${s.username} ${s.employeeCode} ${s.roleId} ${s.department} ${s.designation}`
        .toLowerCase()
        .includes(q);
    });
  }, [db.staff, accountSearch]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return db.auditLogs.filter((entry) => {
      if (moduleFilter !== 'ALL' && entry.module !== moduleFilter) return false;
      if (severityFilter !== 'ALL' && entry.severity !== severityFilter) return false;
      if (!q) return true;
      return (
        entry.actorName.toLowerCase().includes(q) ||
        entry.action.toLowerCase().includes(q) ||
        entry.entityId.toLowerCase().includes(q) ||
        entry.summary.toLowerCase().includes(q)
      );
    });
  }, [db.auditLogs, auditSearch, moduleFilter, severityFilter]);

  const filteredMatrixPerms = useMemo(() => {
    if (matrixGroupFilter === 'ALL') return ALL_PERMISSION_ITEMS;
    return ALL_PERMISSION_ITEMS.filter((p) => p.moduleKey === matrixGroupFilter);
  }, [matrixGroupFilter]);

  const togglePermission = async (roleId: RoleId, perm: PermissionKey) => {
    if (!canManageRbac) return;
    const role = db.roles.find((r) => r.id === roleId);
    if (!role) return;
    const has = role.permissions.includes(perm);
    const nextPerms = has
      ? role.permissions.filter((p) => p !== perm)
      : [...role.permissions, perm];

    try {
      const resp = await apiRequest<{ db: any }>('/api/rbac', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({ roleId, permissions: nextPerms }),
      });
      onUpdated(resp.db, `Updated '${perm}' for ${role.name}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'RBAC update failed.');
    }
  };

  const handleExportAuditCsv = () => {
    const rows = [
      ['Timestamp', 'Actor', 'Role', 'Module', 'Action', 'Entity', 'Severity', 'Summary'],
      ...filteredAudit.map((a) => [
        a.timestamp,
        a.actorName,
        a.actorRole,
        a.module,
        a.action,
        a.entityId,
        a.severity,
        a.summary.replace(/"/g, '""'),
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saptari-hospital-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openAlertsCount = (db.securityAlerts || []).filter((a) => !a.resolved).length;

  return (
    <div className="space-y-6">
      {/* Header & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Roles, Accounts, Module Assignment &amp; Security Audit
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Create custom roles, assign hospital modules cleanly, manage staff login accounts, and monitor security audit logs.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManageRbac && (
            <button
              type="button"
              onClick={openCreateRoleModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Custom Role
            </button>
          )}
          {canManageStaff && (
            <button
              type="button"
              onClick={() => {
                setUEmployeeCode(`SHP-${101 + (db.staff || []).length}`);
                setURoleId(db.roles.find((r) => r.isCustom)?.id || 'BILLING_REPORT');
                setCreateUserError('');
                setShowCreateUserModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Create Staff Account
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('ROLES')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'ROLES'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          Roles &amp; Module Cards ({db.roles.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('ACCOUNTS')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'ACCOUNTS'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          Staff Accounts &amp; Role Assignment ({db.staff.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('MATRIX')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'MATRIX'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Permission Matrix
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('AUDIT')}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'AUDIT'
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          Alerts &amp; Audit Trail
          {openAlertsCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold bg-rose-600 text-white rounded-full">
              {openAlertsCount}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: ROLES & MODULE ASSIGNMENT CARDS */}
      {activeTab === 'ROLES' && (
        <div className="space-y-4">
          {confirmDeleteRole && (
            <div className="p-3.5 rounded-xl border border-rose-300 bg-rose-50 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <div className="font-bold text-rose-950">
                  Delete Role &ldquo;{confirmDeleteRole.name}&rdquo; ({confirmDeleteRole.id})?
                </div>
                <div className="text-rose-800 mt-0.5">
                  Staff members currently assigned to this role must be reassigned first, or they will fall back if unlinked.
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteRole(null)}
                  className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteRole(confirmDeleteRole)}
                  className="px-3.5 py-1.5 bg-rose-600 text-white rounded-lg font-semibold hover:bg-rose-700"
                >
                  Confirm Delete Role
                </button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {db.roles.map((role) => {
            const staffOnRole = (db.staff || []).filter((s) => s.roleId === role.id);
            const activeModules = MODULE_PERMISSION_GROUPS.filter((g) =>
              g.permissions.some((p) => role.permissions.includes(p.key))
            );
            return (
              <div
                key={role.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between gap-3 shadow-xs hover:border-blue-300 transition-colors"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-bold text-slate-900">{role.name}</h3>
                        {role.isCustom ? (
                          <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded">
                            Custom Role
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 text-slate-600 rounded">
                            System
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5">{role.id}</div>
                    </div>
                    <span className="px-2 py-0.5 text-[11px] font-mono font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded shrink-0">
                      {staffOnRole.length} user{staffOnRole.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 leading-relaxed">{role.description}</p>

                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                      Assigned Modules ({activeModules.length} / {MODULE_PERMISSION_GROUPS.length}) ·{' '}
                      {role.permissions.length} permissions
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {activeModules.map((m) => (
                        <span
                          key={m.moduleKey}
                          className="px-2 py-0.5 text-[10px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 rounded"
                        >
                          {m.title.split('&')[0].trim()}
                        </span>
                      ))}
                      {activeModules.length === 0 && (
                        <span className="text-[11px] text-slate-400 italic">No modules enabled</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs">
                  <div className="text-[11px] text-slate-500 truncate">
                    {staffOnRole.length > 0
                      ? staffOnRole.slice(0, 2).map((s) => s.fullName).join(', ') +
                        (staffOnRole.length > 2 ? ` +${staffOnRole.length - 2}` : '')
                      : 'No staff assigned yet'}
                  </div>
                  {canManageRbac && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditRoleModal(role)}
                        disabled={role.id === 'LAB_TECH'}
                        title={
                          role.id === 'LAB_TECH'
                            ? 'LAB_TECH strict bench scope is system-protected'
                            : 'Edit role name & assigned modules'
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-40"
                      >
                        <Edit3 className="w-3 h-3" />
                        Configure Modules
                      </button>
                      {role.id !== 'SUPER_ADMIN' && role.id !== 'SAAS_ADMIN' && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteRole(role)}
                          className="p-1.5 text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
                          title={`Delete role ${role.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* TAB 2: STAFF ACCOUNTS & INLINE ROLE ASSIGNMENT */}
      {activeTab === 'ACCOUNTS' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Staff User Accounts &amp; Direct Role Assignment
              </h2>
              <p className="text-xs text-slate-500">
                Reassign any staff member&apos;s role, toggle Active/Suspended status, create new login accounts, or reset password/PIN.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  value={accountSearch}
                  onChange={(e) => setAccountSearch(e.target.value)}
                  placeholder="Search user, code, role..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                />
              </div>
              {canManageStaff && (
                <button
                  type="button"
                  onClick={() => {
                    setUEmployeeCode(`SHP-${101 + (db.staff || []).length}`);
                    setURoleId(db.roles.find((r) => r.isCustom)?.id || 'BILLING_REPORT');
                    setCreateUserError('');
                    setShowCreateUserModal(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  New Account
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-white text-slate-600">
                  <th className="py-2.5 px-4">Employee &amp; Login ID</th>
                  <th className="py-2.5 px-4">Designation / Dept</th>
                  <th className="py-2.5 px-4">Assigned Role (Live)</th>
                  <th className="py-2.5 px-4">Shift</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Credentials</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredStaff.map((member) => {
                  const lockedRow = member.id === activeUser.id && member.roleId === 'SUPER_ADMIN';
                  return (
                    <tr key={member.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">{member.fullName}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          @{member.username} · {member.employeeCode}
                          {member.isLocked && (
                            <span className="ml-2 inline-flex items-center gap-0.5 text-rose-700 font-bold">
                              <Lock className="w-3 h-3" /> LOCKED
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-slate-800">{member.designation}</div>
                        <div className="text-[11px] text-slate-500">{member.department}</div>
                      </td>
                      <td className="py-2.5 px-4">
                        <select
                          disabled={!canManageRbac || lockedRow}
                          value={member.roleId}
                          onChange={(e) => handleInlineAssignRole(member, e.target.value as RoleId)}
                          className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg disabled:bg-slate-100 max-w-[240px]"
                        >
                          {db.roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} {r.isCustom ? '(Custom)' : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{member.shift}</td>
                      <td className="py-2.5 px-4">
                        <select
                          disabled={!canManageStaff || lockedRow}
                          value={member.status}
                          onChange={(e) =>
                            handleInlineStatusChange(member, e.target.value as StaffMember['status'])
                          }
                          className={`px-2 py-1 text-[11px] font-semibold rounded border ${
                            member.status === 'Active'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : member.status === 'On Leave'
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-rose-50 text-rose-800 border-rose-200'
                          }`}
                        >
                          <option value="Active">Active</option>
                          <option value="On Leave">On Leave</option>
                          <option value="Suspended">Suspended</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {canManageStaff && (
                          <button
                            type="button"
                            onClick={() => {
                              setUnlockModal({ staff: member });
                              setNewPass('Reset@2083');
                              setNewPin(member.pin || '1234');
                              setResetReason('Admin credential update from Accounts & RBAC panel');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                          >
                            <KeyRound className="w-3 h-3" />
                            Reset Pass/PIN
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: GROUPED RBAC PERMISSION MATRIX */}
      {activeTab === 'MATRIX' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Granular RBAC Permission Matrix (Enforced on Express API &amp; UI)
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={matrixGroupFilter}
                onChange={(e) => setMatrixGroupFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="ALL">All Hospital Modules ({ALL_PERMISSION_ITEMS.length} perms)</option>
                {MODULE_PERMISSION_GROUPS.map((g) => (
                  <option key={g.moduleKey} value={g.moduleKey}>
                    {g.title} ({g.permissions.length})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-white shadow-xs">
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2.5 px-4 min-w-[260px] bg-white">Permission Capability</th>
                  {db.roles.map((r) => (
                    <th key={r.id} className="py-2.5 px-3 text-center min-w-[125px] bg-white">
                      <div className="font-semibold text-slate-900 leading-tight">{r.name}</div>
                      <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                        {r.permissions.length} perms
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMatrixPerms.map((perm) => (
                  <tr key={perm.key} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-900">{perm.label}</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {perm.group} · {perm.key}
                      </div>
                    </td>
                    {db.roles.map((role) => {
                      const checked = role.permissions.includes(perm.key);
                      const lockedAdmin =
                        (role.id === 'SUPER_ADMIN' &&
                          (perm.key === 'rbac.manage' || perm.key === 'admin.control')) ||
                        role.id === 'LAB_TECH';
                      return (
                        <td key={role.id} className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canManageRbac || lockedAdmin}
                            onChange={() => togglePermission(role.id, perm.key)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 disabled:opacity-50 cursor-pointer"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SECURITY ALERTS & IMMUTABLE AUDIT TRAIL */}
      {activeTab === 'AUDIT' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  Security Lockout Alerts, Failed Password Logs &amp; Call Reset Requests ({openAlertsCount} Open)
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                3 consecutive wrong passwords/PINs lock account &amp; require Admin reset with reason
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
              {(db.securityAlerts || []).length === 0 && (
                <div className="p-4 text-xs text-slate-500">No security alerts logged.</div>
              )}
              {(db.securityAlerts || []).map((al) => {
                const targetStaff = db.staff.find(
                  (s) => s.id === al.targetUserId || s.username === al.targetUsername
                );
                const allowedToUnlock =
                  canManageStaff &&
                  targetStaff &&
                  (targetStaff.roleId !== 'SUPER_ADMIN' || activeUser.roleId === 'SUPER_ADMIN');

                return (
                  <div
                    key={al.id}
                    className={`px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs ${
                      !al.resolved && al.severity === 'CRITICAL'
                        ? 'bg-rose-50/70'
                        : !al.resolved
                        ? 'bg-amber-50/40'
                        : ''
                    }`}
                  >
                    <div className="space-y-0.5 flex-1 min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`font-mono font-bold text-[10px] px-1.5 py-0.5 rounded ${
                            al.severity === 'CRITICAL'
                              ? 'bg-rose-100 text-rose-800'
                              : al.severity === 'WARNING'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-slate-100 text-slate-700'
                          }`}
                        >
                          {al.type}
                        </span>
                        <span className="font-mono font-semibold text-slate-900">@{al.targetUsername}</span>
                        {al.targetRole && (
                          <span className="font-mono text-[11px] text-slate-500">({al.targetRole})</span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">
                          {new Date(al.timestamp).toLocaleString()}
                        </span>
                        {al.resolved ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Resolved by {al.resolvedBy}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                            <AlertTriangle className="w-3 h-3" /> Action Required
                          </span>
                        )}
                      </div>
                      <div className="text-slate-700">{al.message}</div>
                      {al.resolvedReason && (
                        <div className="text-[11px] text-emerald-700">
                          Resolution Reason: {al.resolvedReason}
                        </div>
                      )}
                    </div>

                    {!al.resolved && allowedToUnlock && targetStaff && (
                      <button
                        type="button"
                        onClick={() => {
                          setUnlockModal({ staff: targetStaff, alert: al });
                          setNewPass('Reset@2083');
                          setNewPin(targetStaff.pin || '1234');
                          setResetReason('Verified caller identity over phone for credential reset');
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 shrink-0"
                      >
                        <KeyRound className="w-3.5 h-3.5" />
                        Unlock &amp; Reset
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {canViewAudit && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  Immutable Security &amp; Clinical Audit Trail ({filteredAudit.length} events)
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      placeholder="Search user, entity, action..."
                      className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                  </div>
                  <select
                    value={moduleFilter}
                    onChange={(e) => setModuleFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Modules</option>
                    <option value="POS_BILLING">POS_BILLING</option>
                    <option value="ORDERS">ORDERS</option>
                    <option value="RESULTS">RESULTS</option>
                    <option value="RADIOLOGY">RADIOLOGY</option>
                    <option value="REPORTS">REPORTS</option>
                    <option value="PHARMACY">PHARMACY</option>
                    <option value="FINANCE">FINANCE</option>
                    <option value="DARTA_CHALANI">DARTA_CHALANI</option>
                    <option value="OPD_IPD">OPD_IPD</option>
                    <option value="PERSONNEL">PERSONNEL</option>
                    <option value="RBAC">RBAC</option>
                    <option value="AUTH">AUTH</option>
                    <option value="SETTINGS">SETTINGS</option>
                  </select>
                  <select
                    value={severityFilter}
                    onChange={(e) => setSeverityFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="ALL">All Severities</option>
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleExportAuditCsv}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export CSV
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-white sticky top-0">
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Operator &amp; Role</th>
                      <th className="py-2.5 px-4">Module / Action</th>
                      <th className="py-2.5 px-4">Entity</th>
                      <th className="py-2.5 px-4">Severity</th>
                      <th className="py-2.5 px-4">Audit Summary</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAudit.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {new Date(a.timestamp).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-900">{a.actorName}</div>
                          <div className="font-mono text-[10px] text-slate-500">{a.actorRole}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono">
                          <div className="text-slate-900 font-semibold">{a.action}</div>
                          <div className="text-[10px] text-slate-500">{a.module}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-blue-700">{a.entityId}</td>
                        <td className="py-2.5 px-4 font-mono font-semibold">
                          {a.severity === 'CRITICAL' ? (
                            <span className="text-rose-700">CRITICAL</span>
                          ) : a.severity === 'WARNING' ? (
                            <span className="text-amber-700">WARNING</span>
                          ) : (
                            <span className="text-slate-600">INFO</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">{a.summary}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* CREATE / EDIT ROLE & MODULE ASSIGNMENT MODAL */}
      {roleModalMode && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setRoleModalMode(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50 shrink-0">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  {roleModalMode === 'create'
                    ? 'Create Custom Role & Assign Modules'
                    : `Configure Role & Modules — ${editingRoleId}`}
                </h3>
                <p className="text-[11px] text-slate-500">
                  Toggle entire module cards or select fine-grained permissions inside each hospital module.
                </p>
              </div>
              <button type="button" onClick={() => setRoleModalMode(null)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRoleModal} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {roleModalError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-medium">
                  {roleModalError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Role Display Name *</label>
                  <input
                    required
                    value={roleName}
                    onChange={(e) => setRoleName(e.target.value)}
                    placeholder="e.g., Senior OPD Desk & Darta Executive"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Role Code (Optional)</label>
                  <input
                    disabled={roleModalMode === 'edit'}
                    value={roleCode}
                    onChange={(e) =>
                      setRoleCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))
                    }
                    placeholder="Auto from name"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-semibold text-slate-700 mb-1">Role Responsibility Description</label>
                  <input
                    value={roleDescription}
                    onChange={(e) => setRoleDescription(e.target.value)}
                    placeholder="Short description of duties & access boundaries..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <div className="font-bold text-slate-900">
                  Assign Hospital Modules ({rolePermissions.length} permissions selected)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setRolePermissions(ALL_PERMISSION_ITEMS.map((p) => p.key))
                    }
                    className="px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                  >
                    Select All Modules
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRolePermissions(
                        editingRoleId === 'SUPER_ADMIN'
                          ? ['dashboard.view', 'rbac.manage', 'admin.control']
                          : ['dashboard.view']
                      )
                    }
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200"
                  >
                    Minimal Only
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {MODULE_PERMISSION_GROUPS.map((grp) => {
                  const grpKeys = grp.permissions.map((p) => p.key);
                  const activeCount = grpKeys.filter((k) => rolePermissions.includes(k)).length;
                  const allOn = activeCount === grpKeys.length;
                  const partialOn = activeCount > 0 && activeCount < grpKeys.length;

                  return (
                    <div
                      key={grp.moduleKey}
                      className={`border rounded-xl p-3 space-y-2 transition-colors ${
                        allOn
                          ? 'bg-emerald-50/40 border-emerald-300'
                          : partialOn
                          ? 'bg-blue-50/30 border-blue-300'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-slate-900">{grp.title}</div>
                          <div className="text-[11px] text-slate-500">{grp.description}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleModuleCardInModal(grp)}
                          className={`px-2.5 py-1 text-[10px] font-bold rounded-lg border shrink-0 ${
                            allOn
                              ? 'bg-emerald-600 text-white border-emerald-700'
                              : partialOn
                              ? 'bg-blue-600 text-white border-blue-700'
                              : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          {allOn ? 'Enabled' : partialOn ? `${activeCount}/${grpKeys.length}` : 'Enable All'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-1 pt-1.5 border-t border-slate-200/70">
                        {grp.permissions.map((perm) => {
                          const checked = rolePermissions.includes(perm.key);
                          const lockedAdmin =
                            editingRoleId === 'SUPER_ADMIN' &&
                            (perm.key === 'rbac.manage' || perm.key === 'admin.control');
                          return (
                            <label
                              key={perm.key}
                              className="inline-flex items-center gap-2 text-[11px] text-slate-800 cursor-pointer py-0.5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={lockedAdmin}
                                onChange={() => toggleSinglePermInModal(perm.key)}
                                className="rounded border-slate-300 text-blue-600"
                              />
                              <span>{perm.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 sticky bottom-0 bg-white">
                <button
                  type="button"
                  onClick={() => setRoleModalMode(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRole}
                  className="px-5 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingRole
                    ? 'Saving Role...'
                    : roleModalMode === 'create'
                    ? 'Create Role & Modules'
                    : 'Save Role Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE STAFF ACCOUNT & ASSIGN ROLE MODAL */}
      {showCreateUserModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowCreateUserModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Create Staff Account &amp; Assign Role
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateUserModal(false)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUserSubmit} className="p-5 space-y-3 text-xs max-h-[85vh] overflow-y-auto">
              {createUserError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg font-medium">
                  {createUserError}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Employee Code *</label>
                  <input
                    required
                    value={uEmployeeCode}
                    onChange={(e) => setUEmployeeCode(e.target.value)}
                    placeholder="SHP-115"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Login Username</label>
                  <input
                    value={uUsername}
                    onChange={(e) =>
                      setUUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))
                    }
                    placeholder="Auto from code if blank"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    required
                    value={uFullName}
                    onChange={(e) => setUFullName(sanitizePersonName(e.target.value))}
                    placeholder="e.g., Sunita Kumari Yadav"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-semibold text-blue-900 mb-1">
                    Assign Hospital Role *
                  </label>
                  <select
                    value={uRoleId}
                    onChange={(e) => setURoleId(e.target.value as RoleId)}
                    className="w-full px-3 py-2 bg-blue-50/50 border border-blue-300 rounded-lg font-semibold text-slate-900"
                  >
                    {db.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} {r.isCustom ? '(Custom)' : ''} — {r.permissions.length} perms
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Designation</label>
                  <input
                    value={uDesignation}
                    onChange={(e) => setUDesignation(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Department</label>
                  <input
                    value={uDepartment}
                    onChange={(e) => setUDepartment(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Shift</label>
                  <select
                    value={uShift}
                    onChange={(e) => setUShift(e.target.value as StaffMember['shift'])}
                    className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                    <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                    <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input
                    value={uPhone}
                    onChange={(e) => setUPhone(e.target.value)}
                    placeholder="98XXXXXXXX"
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Initial Password *</label>
                  <div className="relative">
                    <input
                      required
                      type={showCreatePass ? 'text' : 'password'}
                      value={uPassword}
                      onChange={(e) => setUPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-2 font-mono border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCreatePass((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      title={showCreatePass ? 'Hide password' : 'Show password'}
                    >
                      {showCreatePass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Idle PIN (4-6 digits) *</label>
                  <input
                    required
                    pattern="\d{4,6}"
                    maxLength={6}
                    value={uPin}
                    onChange={(e) => setUPin(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Basic Salary (NPR)</label>
                  <input
                    type="number"
                    min={0}
                    value={uSalary}
                    onChange={(e) => setUSalary(e.target.value)}
                    className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateUserModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="px-4 py-2 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {creatingUser ? 'Creating...' : 'Create Account & Assign Role'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* UNLOCK & CREDENTIAL RESET MODAL */}
      {unlockModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                Unlock &amp; Reset — @{unlockModal.staff.username}
              </h3>
              <button
                type="button"
                onClick={() => setUnlockModal(null)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUnlockSubmit} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  Target: <strong>{unlockModal.staff.fullName}</strong> ({unlockModal.staff.roleId})
                </div>
                {unlockModal.alert && (
                  <div className="text-slate-600 mt-1">{unlockModal.alert.message}</div>
                )}
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">New Password *</label>
                <div className="relative">
                  <input
                    required
                    type={showResetPass ? 'text' : 'password'}
                    value={newPass}
                    onChange={(e) => setNewPass(e.target.value)}
                    className="w-full pl-3 pr-9 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPass((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    title={showResetPass ? 'Hide password' : 'Show password'}
                  >
                    {showResetPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Admin-Assigned Idle PIN (4–6 digits)
                </label>
                <input
                  pattern="\d{4,6}"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/[^\d]/g, ''))}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Mandatory Security Audit Reason *
                </label>
                <input
                  required
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="Verified caller phone number & employee ID..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setUnlockModal(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-4 py-1.5 font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                >
                  {resetting ? 'Applying...' : 'Unlock & Reset Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
