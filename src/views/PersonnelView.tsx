import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Award,
  Banknote,
  Calendar,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Fingerprint,
  History,
  KeyRound,
  Lock,
  MapPin,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  AttendancePunchRecord,
  HrCertificateRecord,
  LimsDatabase,
  PermissionKey,
  RoleId,
  StaffMember,
} from '../types/lims';
import { adToBs, BS_MONTHS_EN, formatNpr } from '../utils/nepaliDate';
import { QrCodeSvg } from '../components/DocumentCodes';
import { apiRequest } from '../api/client';
import { HrCertificatePrintModal } from '../components/HospitalPrintModals';
import { exportLetterToDocx } from '../utils/wordExport';
import { sanitizePersonName } from '../utils/textFormat';

interface PersonnelViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function PersonnelView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: PersonnelViewProps) {
  const canManage = hasPerm('personnel.manage');
  const canPayroll = hasPerm('payroll.manage');
  const canViewPayroll = hasPerm('payroll.view') || canPayroll;
  const canChangeRole = hasPerm('rbac.manage');
  const canResetCredentials = canManage || canChangeRole || hasPerm('admin.control');

  const [subTab, setSubTab] = useState<
    'roster' | 'attendance' | 'history' | 'handover' | 'payroll' | 'certificates'
  >('roster');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [showAdd, setShowAdd] = useState(false);
  const [showAddPassword, setShowAddPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  // HR Certificates & Official Letters State
  const [certStaffId, setCertStaffId] = useState<string>(db.staff[0]?.id || activeUser.id);
  const [certType, setCertType] =
    useState<HrCertificateRecord['certificateType']>('Experience Certificate');
  const [certJoinedAt, setCertJoinedAt] = useState<string>(db.staff[0]?.joinedAt || '');
  const [certRelievedAt, setCertRelievedAt] = useState<string>('');
  const [certSalaryNpr, setCertSalaryNpr] = useState<string>(
    String(db.staff[0]?.basicSalaryNpr || 0)
  );
  const [certSubject, setCertSubject] = useState<string>('');
  const [certBody, setCertBody] = useState<string>('');
  const [certLang, setCertLang] = useState<'English' | 'Nepali' | 'Bilingual (English + Nepali)'>(
    'English'
  );
  const [certLogChalani, setCertLogChalani] = useState<boolean>(true);
  const [certAiBusy, setCertAiBusy] = useState<boolean>(false);
  const [certSaving, setCertSaving] = useState<boolean>(false);
  const [certToPrint, setCertToPrint] = useState<HrCertificateRecord | null>(null);

  // Unique Staff QR & Attendance State
  const [qrTick, setQrTick] = useState(() => Math.floor(Date.now() / 30000));
  useEffect(() => {
    const id = window.setInterval(() => setQrTick(Math.floor(Date.now() / 30000)), 15000);
    return () => window.clearInterval(id);
  }, []);
  const rotatingQrToken = useMemo(() => `SAPTARI-ATT-${qrTick}-${activeUser.employeeCode}`, [qrTick, activeUser.employeeCode]);
  const [punchType, setPunchType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [punchMode, setPunchMode] = useState<'QR_SCAN' | 'MOBILE_GPS' | 'HIKVISION_BIOMETRIC' | 'MANUAL'>('QR_SCAN');
  const [punchStaffId, setPunchStaffId] = useState<string>(activeUser.id);
  const [punchShift, setPunchShift] = useState<string>(activeUser.shift || 'Morning (07:00-15:00)');
  const [punchBusy, setPunchBusy] = useState(false);
  const [syncingHikvision, setSyncingHikvision] = useState(false);
  const [qrScanTokenInput, setQrScanTokenInput] = useState('');

  const selectedPunchStaff = useMemo(
    () => db.staff.find((s) => s.id === punchStaffId) || activeUser,
    [db.staff, punchStaffId, activeUser]
  );
  const uniqueStaffQrToken = useMemo(
    () => `SAPTARI-STAFF-${selectedPunchStaff.employeeCode}-${selectedPunchStaff.id}`,
    [selectedPunchStaff]
  );

  // Attendance History Calendar & HR Manual Override State
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [historyStaffFilter, setHistoryStaffFilter] = useState<string>('ALL');
  const [historyOverridesOnly, setHistoryOverridesOnly] = useState(false);
  const [overrideModal, setOverrideModal] = useState<{
    punch?: AttendancePunchRecord;
    staffId: string;
    punchType: 'CHECK_IN' | 'CHECK_OUT';
    timestamp: string;
    shiftLabel: string;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [savingOverride, setSavingOverride] = useState(false);

  // Shift Handover State
  const [hoFromShift, setHoFromShift] = useState<string>(activeUser.shift || 'Morning (07:00-15:00)');
  const [hoToShift, setHoToShift] = useState<string>('Afternoon (14:00-22:00)');
  const [hoDept, setHoDept] = useState<string>(activeUser.department || 'General Ward');
  const [hoIncomingStaffId, setHoIncomingStaffId] = useState<string>('');
  const [hoSummaryNotes, setHoSummaryNotes] = useState<string>('');
  const [hoPendingTasks, setHoPendingTasks] = useState<string>('');
  const [hoCashKeys, setHoCashKeys] = useState<string>('All ward keys, emergency cart seal & cash drawer balanced');
  const [sendingHandover, setSendingHandover] = useState(false);
  const [approvingHoId, setApprovingHoId] = useState<string | null>(null);
  const [revisionHoId, setRevisionHoId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState('');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [empCode, setEmpCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('Lab@2083');
  const [pin, setPin] = useState('1234');
  const [designation, setDesignation] = useState('Medical Technologist');
  const [department, setDepartment] = useState('Clinical Chemistry');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState<RoleId>('LAB_TECH');
  const [shift, setShift] = useState<StaffMember['shift']>('Morning (07:00-15:00)');
  const [certification, setCertification] = useState('NHPC Certified CLS');
  const [canSign, setCanSign] = useState(false);
  const [regNo, setRegNo] = useState('');
  const [basicSalary, setBasicSalary] = useState('38000');
  const [techAllowance, setTechAllowance] = useState('6000');

  const [resetTarget, setResetTarget] = useState<StaffMember | null>(null);
  const [resetPassword, setResetPassword] = useState('Reset@2083');
  const [resetPin, setResetPin] = useState('');
  const [resetReason, setResetReason] = useState('');
  const [resetting, setResetting] = useState(false);

  const bsNow = adToBs(new Date());
  const [payMonth, setPayMonth] = useState(`${bsNow.monthNameEn} ${bsNow.year}`);
  const [payAccountId, setPayAccountId] = useState(
    db.accounts.find((a) => a.type === 'BANK')?.id || db.accounts[0]?.id || ''
  );

  const handleAddStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: any }>('/api/personnel', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          employeeCode: empCode,
          username,
          password,
          pin,
          fullName,
          designation,
          department,
          email,
          roleId,
          assignedCenterId: null,
          shift,
          certification,
          canSignReports: canSign,
          registrationNumber: regNo || undefined,
          basicSalaryNpr: Number(basicSalary),
          technicalAllowanceNpr: Number(techAllowance),
        }),
      });
      onUpdated(resp.db, `Onboarded ${fullName} (@${username || empCode}).`);
      setShowAdd(false);
      setEmpCode('');
      setFullName('');
      setUsername('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to add staff.');
    }
  };

  const handleAdminReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !resetReason.trim()) return;
    setResetting(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/auth/admin-reset', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId: resetTarget.id,
          newPassword: resetPassword.trim() || undefined,
          newPin: resetPin.trim() || undefined,
          reason: resetReason.trim(),
        }),
      });
      onUpdated(
        resp.db,
        `Unlocked & reset credentials for @${resetTarget.username} (${resetTarget.fullName}).`
      );
      setResetTarget(null);
      setResetReason('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Credential reset failed.');
    } finally {
      setResetting(false);
    }
  };

  const handleUpdateStatus = async (member: StaffMember, status: StaffMember['status']) => {
    try {
      const resp = await apiRequest<{ db: any }>(`/api/personnel/${member.id}`, activeUser.id, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onUpdated(resp.db, `Updated ${member.fullName} status to ${status}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Status update failed.');
    }
  };

  const handleRoleChange = async (member: StaffMember, nextRole: RoleId) => {
    try {
      const resp = await apiRequest<{ db: any }>(`/api/personnel/${member.id}`, activeUser.id, {
        method: 'PATCH',
        body: JSON.stringify({ roleId: nextRole }),
      });
      onUpdated(resp.db, `Reassigned ${member.fullName} to role ${nextRole}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Role reassignment failed.');
    }
  };

  const handleRunPayroll = async (disburseImmediately: boolean) => {
    try {
      const resp = await apiRequest<{ db: any; run: any }>('/api/payroll/run', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          bsMonthLabel: payMonth,
          disburseImmediately,
          accountId: payAccountId,
        }),
      });
      onUpdated(
        resp.db,
        `${disburseImmediately ? 'Disbursed' : 'Drafted'} payroll for ${payMonth} (Net ${formatNpr(resp.run.totalNetNpr)}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Payroll run failed.');
    }
  };

  const handleDisburseBatch = async (runId: string) => {
    try {
      const resp = await apiRequest<{ db: any }>(`/api/payroll/${runId}/disburse`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ accountId: payAccountId }),
      });
      onUpdated(resp.db, 'Payroll batch disbursed from selected bank account.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Disbursement failed.');
    }
  };

  const handleAttendancePunch = async (overrideMode?: 'QR_SCAN' | 'MOBILE_GPS' | 'HIKVISION_BIOMETRIC' | 'MANUAL') => {
    const modeToUse = overrideMode || punchMode;
    setPunchBusy(true);
    const submitPunch = async (deviceLabel: string) => {
      try {
        const resp = await apiRequest<{ db: LimsDatabase }>('/api/attendance/punch', activeUser.id, {
          method: 'POST',
          body: JSON.stringify({
            targetStaffId: punchStaffId,
            mode: modeToUse,
            punchType,
            shiftLabel: punchShift,
            deviceIdOrIp: deviceLabel,
            verificationCode: modeToUse === 'QR_SCAN' ? rotatingQrToken : undefined,
          }),
        });
        onUpdated(resp.db, `Attendance ${punchType === 'CHECK_IN' ? 'Check-In' : 'Check-Out'} logged via ${modeToUse}.`);
      } catch (err: any) {
        onUpdated(db, err.message || 'Attendance punch failed.');
      } finally {
        setPunchBusy(false);
      }
    };

    if (modeToUse === 'MOBILE_GPS' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void submitPunch(`GPS ${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}`);
        },
        () => {
          void submitPunch('Saptari Hospital Premises GPS Fallback');
        },
        { enableHighAccuracy: true, timeout: 4000 }
      );
    } else {
      const ms = db.settings?.moduleSettings;
      const label =
        modeToUse === 'HIKVISION_BIOMETRIC'
          ? `ISAPI@${ms?.hikvisionDeviceIp || '192.168.1.210'}:${ms?.hikvisionDevicePort || 80}`
          : modeToUse === 'QR_SCAN'
          ? `HOSP-QR-GATE (${uniqueStaffQrToken.slice(-8)})`
          : 'HR-DESK-MANUAL';
      await submitPunch(label);
    }
  };

  const handleQrScanSubmit = async (rawToken?: string, forcedPunchType?: 'CHECK_IN' | 'CHECK_OUT') => {
    const token = (rawToken ?? qrScanTokenInput).trim();
    const typeToUse = forcedPunchType || punchType;
    const lower = token.toLowerCase();
    const matched = token
      ? db.staff.find(
          (s) =>
            `saptari-staff-${s.employeeCode}-${s.id}`.toLowerCase() === lower ||
            s.employeeCode.toLowerCase() === lower ||
            s.id.toLowerCase() === lower ||
            s.username.toLowerCase() === lower
        )
      : selectedPunchStaff;

    if (!matched) {
      onUpdated(db, `No staff profile matched QR token "${token}". Scan SAPTARI-STAFF-{CODE}-{ID}.`);
      return;
    }

    setPunchBusy(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/attendance/punch', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          targetStaffId: matched.id,
          mode: 'QR_SCAN',
          punchType: typeToUse,
          shiftLabel: matched.shift || punchShift,
          deviceIdOrIp: `QR-SCANNER (${matched.employeeCode})`,
          verificationCode: token || `SAPTARI-STAFF-${matched.employeeCode}-${matched.id}`,
        }),
      });
      onUpdated(
        resp.db,
        `${matched.fullName} (${matched.employeeCode}) ${
          typeToUse === 'CHECK_IN' ? 'Checked In' : 'Checked Out'
        } via Staff QR Badge.`
      );
      if (!rawToken) setQrScanTokenInput('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Staff QR clock-in/out failed.');
    } finally {
      setPunchBusy(false);
    }
  };

  const openNewOverrideModal = (staffId?: string, dateStr?: string) => {
    const st = db.staff.find((s) => s.id === (staffId || punchStaffId)) || activeUser;
    const baseDate = dateStr || `${historyMonth}-01`;
    setOverrideModal({
      staffId: st.id,
      punchType: 'CHECK_IN',
      timestamp: `${baseDate}T08:00`,
      shiftLabel: st.shift || 'Morning (07:00-15:00)',
    });
    setOverrideReason('');
  };

  const openEditOverrideModal = (punch: AttendancePunchRecord) => {
    const localDt = new Date(new Date(punch.timestamp).getTime() - new Date().getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    setOverrideModal({
      punch,
      staffId: punch.staffId,
      punchType: punch.punchType,
      timestamp: localDt,
      shiftLabel: punch.shiftLabel,
    });
    setOverrideReason(punch.overrideReason || '');
  };

  const handleSaveOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideModal || !overrideReason.trim()) return;
    setSavingOverride(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/attendance/override', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          punchId: overrideModal.punch?.id,
          staffId: overrideModal.staffId,
          punchType: overrideModal.punchType,
          timestamp: new Date(overrideModal.timestamp).toISOString(),
          shiftLabel: overrideModal.shiftLabel,
          reason: overrideReason.trim(),
        }),
      });
      onUpdated(resp.db, 'HR manual attendance override recorded with full audit log.');
      setOverrideModal(null);
      setOverrideReason('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to apply HR manual attendance override.');
    } finally {
      setSavingOverride(false);
    }
  };

  const handleHikvisionSync = async () => {
    if (!canManage) return;
    setSyncingHikvision(true);
    try {
      const ms = db.settings?.moduleSettings;
      const resp = await apiRequest<{ db: LimsDatabase; syncedCount: number }>(
        '/api/attendance/hikvision-sync',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            punchType,
            deviceIp: `${ms?.hikvisionDeviceIp || '192.168.1.210'}:${ms?.hikvisionDevicePort || 80}`,
          }),
        }
      );
      onUpdated(resp.db, `Synced ${resp.syncedCount} Hikvision biometric attendance punch(es).`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Hikvision ISAPI sync failed.');
    } finally {
      setSyncingHikvision(false);
    }
  };

  const handleSendHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoSummaryNotes.trim()) return;
    setSendingHandover(true);
    try {
      const incoming = db.staff.find((s) => s.id === hoIncomingStaffId);
      const resp = await apiRequest<{ db: LimsDatabase; handover: { handoverNumber: string } }>(
        '/api/handovers',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            fromShift: hoFromShift,
            toShift: hoToShift,
            department: hoDept,
            incomingStaffId: incoming?.id,
            incomingStaffName: incoming?.fullName || 'Next Shift Duty Staff',
            summaryNotes: hoSummaryNotes.trim(),
            pendingTasks: hoPendingTasks.trim() || 'None',
            cashOrKeysCount: hoCashKeys.trim() || 'Keys & registers handed over',
          }),
        }
      );
      onUpdated(resp.db, `Shift Handover ${resp.handover.handoverNumber} sent to next duty roster.`);
      setHoSummaryNotes('');
      setHoPendingTasks('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to send shift handover.');
    } finally {
      setSendingHandover(false);
    }
  };

  const handleRespondHandover = async (
    handoverId: string,
    decision: 'ACCEPT' | 'REQUEST_REVISION',
    comment?: string
  ) => {
    if (decision === 'REQUEST_REVISION' && !comment?.trim()) return;
    setApprovingHoId(handoverId);
    try {
      const resp = await apiRequest<{ db: LimsDatabase; handover: { handoverNumber: string } }>(
        `/api/handovers/${handoverId}/respond`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            comment: comment?.trim() || undefined,
          }),
        }
      );
      onUpdated(
        resp.db,
        decision === 'ACCEPT'
          ? `Accepted shift handover ${resp.handover.handoverNumber}.`
          : `Requested revision on shift handover ${resp.handover.handoverNumber}.`
      );
      setRevisionHoId(null);
      setRevisionComment('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to respond to shift handover.');
    } finally {
      setApprovingHoId(null);
    }
  };

  const calendarMeta = useMemo(() => {
    const [yrStr, moStr] = historyMonth.split('-');
    const year = Number(yrStr) || new Date().getFullYear();
    const month = Number(moStr) || new Date().getMonth() + 1;
    const daysInMonth = new Date(year, month, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const logs = (db.attendanceLogs || []).filter((att) => {
      const adDate = att.timestamp.slice(0, 7);
      if (adDate !== historyMonth) return false;
      if (historyStaffFilter !== 'ALL' && att.staffId !== historyStaffFilter) return false;
      if (historyOverridesOnly && !att.isManualOverride) return false;
      return true;
    });
    const staffRows = db.staff.filter((s) =>
      historyStaffFilter === 'ALL' ? true : s.id === historyStaffFilter
    );
    return { year, month, days, logs, staffRows };
  }, [db.attendanceLogs, db.staff, historyMonth, historyStaffFilter, historyOverridesOnly]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Personnel, HR Roster &amp; Payroll ({activeFiscalYear})
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage clinical staff, duty shifts, salary structures (NPR), SSF/TDS deductions, and bank payroll disbursements.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search staff, @username, center, role..."
              className="pl-8 pr-7 py-1.5 text-xs bg-white border border-slate-300 rounded-lg w-56 focus:outline-none focus:border-blue-600"
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
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSubTab('roster')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                subTab === 'roster' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Staff &amp; HR Roster
            </button>
            <button
              type="button"
              onClick={() => setSubTab('attendance')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                subTab === 'attendance' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              QR Clock-In &amp; Biometric ({(db.attendanceLogs || []).length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('history')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                subTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Attendance History
            </button>
            <button
              type="button"
              onClick={() => setSubTab('handover')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                subTab === 'handover' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Shift Handover ({(db.shiftHandovers || []).filter((h) => h.status !== 'RECEIVED_APPROVED').length})
            </button>
            {canViewPayroll && (
              <button
                type="button"
                onClick={() => setSubTab('payroll')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  subTab === 'payroll' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Monthly Payroll
              </button>
            )}
            <button
              type="button"
              onClick={() => setSubTab('certificates')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md inline-flex items-center gap-1 ${
                subTab === 'certificates' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Award className="w-3.5 h-3.5 text-indigo-600" />
              HR Certificates &amp; Letters ({(db.hrCertificates || []).length})
            </button>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Personnel
            </button>
          )}
        </div>
      </div>

      {subTab === 'roster' && (
        <div className="space-y-4">
          {/* Shift-Wise Duty Roster Board */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2.5">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Shift-Wise Duty Roster &amp; Active Staff Names
                </h2>
                <p className="text-xs text-slate-500">
                  Live hospital staff assignment across Morning, Afternoon &amp; Night shifts for counter, clinical &amp; nursing operations.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-600">
                Active Duty Staff: <strong>{db.staff.filter((s) => s.status === 'Active').length}</strong> / {db.staff.length}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {['Morning (07:00-15:00)', 'Afternoon (14:00-22:00)', 'Night (21:30-07:30)'].map((shiftName) => {
                const q = searchTerm.trim().toLowerCase();
                const shiftStaff = db.staff.filter((m) => {
                  const matchesShift =
                    (m.shift || 'Morning (07:00-15:00)') === shiftName ||
                    (shiftName.startsWith('Morning') && !['Afternoon (14:00-22:00)', 'Night (21:30-07:30)'].includes(m.shift));
                  if (!matchesShift || m.status !== 'Active') return false;
                  if (!q) return true;
                  return `${m.fullName} ${m.username} ${m.employeeCode} ${m.designation} ${m.department} ${m.roleId}`
                    .toLowerCase()
                    .includes(q);
                });
                return (
                  <div
                    key={shiftName}
                    className="border border-slate-200 rounded-lg bg-slate-50/70 p-3 flex flex-col gap-2"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-2">
                      <span className="font-semibold text-slate-900">{shiftName}</span>
                      <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-200">
                        {shiftStaff.length} On Duty
                      </span>
                    </div>
                    {shiftStaff.length === 0 ? (
                      <div className="text-slate-400 italic py-2">No active staff assigned to this shift.</div>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {shiftStaff.map((st) => (
                          <div
                            key={st.id}
                            className="p-2 bg-white border border-slate-200 rounded-md flex items-center justify-between gap-2"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-900 truncate">{st.fullName}</div>
                              <div className="text-[11px] text-slate-500 truncate">
                                {st.designation} · {st.department}
                              </div>
                            </div>
                            <div className="text-right shrink-0 font-mono">
                              <div className="text-[10px] font-semibold text-blue-700">{st.roleId}</div>
                              <div className="text-[10px] text-slate-400">{st.employeeCode}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Department &amp; Duty Shift</th>
                  <th className="py-3 px-4">Compensation (NPR)</th>
                  <th className="py-3 px-4">Credentials &amp; Sign-Off</th>
                  <th className="py-3 px-4">RBAC Role</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">HR Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {db.staff
                  .filter((m) => {
                    const q = searchTerm.trim().toLowerCase();
                    if (!q) return true;
                    return `${m.fullName} ${m.username} ${m.employeeCode} ${m.designation} ${m.department} ${m.roleId} ${m.assignedCenterName || 'Saptari Hospital Main'}`
                      .toLowerCase()
                      .includes(q);
                  })
                  .map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium text-slate-900">{m.fullName}</span>
                        {m.isLocked && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded">
                            <Lock className="w-2.5 h-2.5" />
                            LOCKED
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono">
                        @{m.username} · {m.employeeCode} · PIN {m.pin ? '••••' : 'Unset'}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="font-medium text-slate-800">{m.designation}</div>
                      <div className="text-slate-500">
                        {m.department} · {m.shift}
                      </div>
                      <div className="text-[11px] font-mono text-blue-700 mt-0.5">
                        Saptari Hospital Main
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono">
                      <div className="font-semibold text-slate-900">
                        Basic: {formatNpr(m.basicSalaryNpr)}
                      </div>
                      <div className="text-slate-500">
                        Allow: {formatNpr((m.technicalAllowanceNpr || 0) + (m.shiftAllowanceNpr || 0))} · SSF {m.ssfPercent}%
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <div className="text-slate-700">{m.certification}</div>
                      <div className="font-mono text-slate-500 mt-0.5">
                        {m.canSignReports ? (
                          <span className="text-blue-700 font-medium inline-flex items-center gap-1">
                            <UserCheck className="w-3 h-3" />
                            Signatory ({m.registrationNumber})
                          </span>
                        ) : (
                          'Bench / Operations'
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {canChangeRole ? (
                        <select
                          value={m.roleId}
                          onChange={(e) => handleRoleChange(m, e.target.value as RoleId)}
                          className="px-2 py-1 text-xs font-mono border border-slate-300 rounded bg-white"
                        >
                          {db.roles.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="font-mono text-slate-800">{m.roleId}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold">
                      {m.status === 'Active' ? (
                        <span className="text-emerald-700">● Active</span>
                      ) : m.status === 'On Leave' ? (
                        <span className="text-amber-700">▲ On Leave</span>
                      ) : (
                        <span className="text-rose-700">✖ Suspended</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {canResetCredentials &&
                          (m.roleId !== 'SUPER_ADMIN' || activeUser.roleId === 'SUPER_ADMIN') && (
                            <button
                              type="button"
                              onClick={() => {
                                setResetTarget(m);
                                setResetPassword('');
                                setResetPin(m.pin || '');
                                setResetReason(
                                  m.isLocked
                                    ? 'Verified staff identity via phone call after security lockout'
                                    : ''
                                );
                              }}
                              className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border whitespace-nowrap ${
                                m.isLocked
                                  ? 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700'
                                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <KeyRound className="w-3 h-3" />
                              {m.isLocked ? 'Unlock & Reset' : 'PIN / Pass'}
                            </button>
                          )}
                        {canManage ? (
                          <select
                            value={m.status}
                            onChange={(e) =>
                              handleUpdateStatus(m, e.target.value as StaffMember['status'])
                            }
                            className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                          >
                            <option value="Active">Active</option>
                            <option value="On Leave">On Leave</option>
                            <option value="Suspended">Suspended</option>
                          </select>
                        ) : (
                          !canResetCredentials && (
                            <span className="text-xs text-slate-400">Read-Only</span>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

      {subTab === 'attendance' && (
        <div className="space-y-6 text-xs">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Unique Staff QR Badge & Scanner Station */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col items-center text-center space-y-3">
              <div className="flex items-center gap-2 font-semibold text-slate-900 text-sm">
                <QrCode className="w-4 h-4 text-blue-600" />
                Unique Staff QR Badge
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-xl">
                <QrCodeSvg value={uniqueStaffQrToken} size={136} />
              </div>
              <div>
                <div className="font-semibold text-slate-900">{selectedPunchStaff.fullName}</div>
                <div className="font-mono text-[11px] text-slate-600 break-all">{uniqueStaffQrToken}</div>
              </div>
              <div className="flex flex-wrap justify-center items-center gap-2">
                <button
                  type="button"
                  disabled={punchBusy}
                  onClick={() => void handleQrScanSubmit(uniqueStaffQrToken, 'CHECK_IN')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  Scan QR: Check In
                </button>
                <button
                  type="button"
                  disabled={punchBusy}
                  onClick={() => void handleQrScanSubmit(uniqueStaffQrToken, 'CHECK_OUT')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg hover:bg-amber-200 disabled:opacity-50"
                >
                  Check Out
                </button>
                <button
                  type="button"
                  onClick={() => setQrTick(Math.floor(Date.now() / 30000) + 1)}
                  title="Refresh rotating gate token"
                  className="inline-flex items-center gap-1 px-2 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
              <div className="w-full pt-2 border-t border-slate-200 text-left space-y-1.5">
                <label className="block font-medium text-slate-700">
                  Scan Staff QR Barcode / Employee Code
                </label>
                <div className="flex gap-1.5">
                  <input
                    value={qrScanTokenInput}
                    onChange={(e) => setQrScanTokenInput(e.target.value)}
                    data-enter-submit="true"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleQrScanSubmit();
                      }
                    }}
                    placeholder="Scan SAPTARI-STAFF-... & Enter"
                    className="flex-1 min-w-0 px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    disabled={punchBusy}
                    onClick={() => void handleQrScanSubmit()}
                    className="px-2.5 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    Scan
                  </button>
                </div>
              </div>
            </div>

            {/* Hikvision Biometric ISAPI & GPS Attendance Controls */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Fingerprint className="w-4 h-4 text-indigo-600" />
                    Hikvision Biometric Terminal, GPS &amp; Manual Roster Punch
                  </h2>
                  <p className="text-slate-500 mt-0.5">
                    Terminal:{' '}
                    <span className="font-mono font-semibold text-slate-800">
                      {db.settings?.moduleSettings?.hikvisionDeviceName || 'Main Gate Biometric'} (
                      {db.settings?.moduleSettings?.hikvisionDeviceIp || '192.168.1.210'}:
                      {db.settings?.moduleSettings?.hikvisionDevicePort || 80})
                    </span>
                  </p>
                </div>
                {canManage && (
                  <button
                    type="button"
                    disabled={syncingHikvision}
                    onClick={handleHikvisionSync}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    {syncingHikvision ? 'Syncing ISAPI...' : 'Sync Hikvision Biometric Logs'}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Staff Member</label>
                  <select
                    value={punchStaffId}
                    onChange={(e) => setPunchStaffId(e.target.value)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.staff.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.fullName} ({st.employeeCode})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Punch Type</label>
                  <select
                    value={punchType}
                    onChange={(e) => setPunchType(e.target.value as 'CHECK_IN' | 'CHECK_OUT')}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="CHECK_IN">CHECK_IN (Duty Start)</option>
                    <option value="CHECK_OUT">CHECK_OUT (Duty End)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Capture Mode</label>
                  <select
                    value={punchMode}
                    onChange={(e) => setPunchMode(e.target.value as any)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="QR_SCAN">Hospital QR Scan</option>
                    <option value="MOBILE_GPS">Mobile Premises GPS</option>
                    <option value="HIKVISION_BIOMETRIC">Hikvision Biometric</option>
                    <option value="MANUAL">HR Desk Manual</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Duty Shift</label>
                  <select
                    value={punchShift}
                    onChange={(e) => setPunchShift(e.target.value)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                    <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                    <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  disabled={punchBusy}
                  onClick={() => void handleAttendancePunch()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                >
                  Record Attendance Punch
                </button>
                <button
                  type="button"
                  disabled={punchBusy}
                  onClick={() => void handleAttendancePunch('MOBILE_GPS')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  1-Click Mobile GPS Check
                </button>
              </div>
            </div>
          </div>

          {/* Attendance Log Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Recent Biometric, QR &amp; GPS Attendance Register ({(db.attendanceLogs || []).length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                    <th className="py-2.5 px-4">Date (BS) &amp; Time</th>
                    <th className="py-2.5 px-4">Staff Member</th>
                    <th className="py-2.5 px-4">Shift</th>
                    <th className="py-2.5 px-4">Mode &amp; Terminal/GPS</th>
                    <th className="py-2.5 px-4">Type</th>
                    <th className="py-2.5 px-4">Verification / HR Override</th>
                    {canManage && <th className="py-2.5 px-4 text-right">HR Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(db.attendanceLogs || []).length === 0 ? (
                    <tr>
                      <td colSpan={canManage ? 7 : 6} className="p-6 text-center text-slate-500">
                        No attendance punches recorded yet.
                      </td>
                    </tr>
                  ) : (
                    (db.attendanceLogs || []).map((att) => (
                      <tr key={att.id} className={att.isManualOverride ? 'bg-amber-50/50' : ''}>
                        <td className="py-2.5 px-4 font-mono">
                          <div>{att.bsDate} BS</div>
                          <div className="text-[11px] text-slate-500">
                            {new Date(att.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{att.staffName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {att.employeeCode} · {att.department}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">{att.shiftLabel}</td>
                        <td className="py-2.5 px-4 font-mono text-slate-700">
                          <div>{att.mode}</div>
                          <div className="text-[11px] text-slate-500">{att.deviceIdOrIp}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono font-semibold">
                          <span className={att.punchType === 'CHECK_IN' ? 'text-emerald-700' : 'text-amber-700'}>
                            {att.punchType}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">
                          <div>{att.verificationCode || '—'}</div>
                          {att.isManualOverride && (
                            <div className="text-[10px] text-amber-800 font-semibold mt-0.5">
                              HR Override: {att.overrideReason}
                            </div>
                          )}
                        </td>
                        {canManage && (
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => openEditOverrideModal(att)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-300 rounded hover:bg-amber-100"
                            >
                              <Edit3 className="w-3 h-3" />
                              Override
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'history' && (
        <div className="space-y-6 text-xs">
          {/* Calendar Filter & HR Manual Override Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Calendar Month</label>
                <input
                  type="month"
                  value={historyMonth}
                  onChange={(e) => setHistoryMonth(e.target.value)}
                  className="px-3 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Staff Member</label>
                <select
                  value={historyStaffFilter}
                  onChange={(e) => setHistoryStaffFilter(e.target.value)}
                  className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="ALL">All Staff ({db.staff.length})</option>
                  {db.staff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.fullName} ({st.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <label className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={historyOverridesOnly}
                  onChange={(e) => setHistoryOverridesOnly(e.target.checked)}
                  className="rounded border-slate-300 text-amber-600"
                />
                <span className="font-medium text-slate-700">HR Manual Overrides Only</span>
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="font-mono text-slate-600">
                <strong>{calendarMeta.logs.length}</strong> punches ·{' '}
                <strong className="text-amber-700">
                  {calendarMeta.logs.filter((l) => l.isManualOverride).length} HR overrides
                </strong>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => openNewOverrideModal()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  + HR Manual Override
                </button>
              )}
            </div>
          </div>

          {/* Monthly Calendar Matrix View */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
                <Calendar className="w-4 h-4 text-blue-600" />
                Monthly Attendance Calendar Grid — {historyMonth}
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="text-emerald-700">● IN: Check-In</span>
                <span className="text-blue-700">● OUT: Check-Out</span>
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-bold">
                  OVR: HR Override
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                    <th className="py-2 px-3 sticky left-0 bg-slate-50 z-10 min-w-[170px] border-r border-slate-200">
                      Staff Member
                    </th>
                    {calendarMeta.days.map((d) => (
                      <th key={d} className="py-2 px-1.5 text-center font-mono min-w-[44px] border-r border-slate-100">
                        {String(d).padStart(2, '0')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {calendarMeta.staffRows.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50/70">
                      <td className="py-2 px-3 sticky left-0 bg-white z-10 border-r border-slate-200">
                        <div className="font-semibold text-slate-900 truncate max-w-[160px]">{st.fullName}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {st.employeeCode} · {st.department}
                        </div>
                      </td>
                      {calendarMeta.days.map((d) => {
                        const dateKey = `${historyMonth}-${String(d).padStart(2, '0')}`;
                        const dayPunches = calendarMeta.logs.filter(
                          (l) => l.staffId === st.id && l.timestamp.slice(0, 10) === dateKey
                        );
                        const firstIn = dayPunches.find((p) => p.punchType === 'CHECK_IN');
                        const lastOut = dayPunches.find((p) => p.punchType === 'CHECK_OUT');
                        const hasOverride = dayPunches.some((p) => p.isManualOverride);
                        const overrideTitle = dayPunches
                          .filter((p) => p.isManualOverride)
                          .map((p) => `${p.overrideReason} (${p.overriddenBy})`)
                          .join('; ');
                        return (
                          <td
                            key={d}
                            title={
                              overrideTitle
                                ? `HR Override: ${overrideTitle}`
                                : `${st.fullName} on ${dateKey}`
                            }
                            onClick={() => {
                              if (canManage && dayPunches.length === 0) {
                                openNewOverrideModal(st.id, dateKey);
                              } else if (canManage && dayPunches[0]) {
                                openEditOverrideModal(dayPunches[0]);
                              }
                            }}
                            className={`py-1.5 px-1 text-center font-mono border-r border-slate-100 align-top ${
                              canManage ? 'cursor-pointer hover:bg-blue-50/60' : ''
                            } ${hasOverride ? 'bg-amber-50' : ''}`}
                          >
                            {dayPunches.length === 0 ? (
                              <span className="text-slate-300">·</span>
                            ) : (
                              <div className="space-y-0.5 leading-tight">
                                {firstIn && (
                                  <div className="text-[10px] font-semibold text-emerald-700">
                                    {new Date(firstIn.timestamp).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false,
                                    })}
                                  </div>
                                )}
                                {lastOut && (
                                  <div className="text-[10px] font-semibold text-blue-700">
                                    {new Date(lastOut.timestamp).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false,
                                    })}
                                  </div>
                                )}
                                {hasOverride && (
                                  <div className="text-[9px] font-bold text-amber-800 bg-amber-200/70 rounded px-0.5">
                                    OVR
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Detailed Attendance History & HR Overrides Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Detailed Check-In / Check-Out Timestamps &amp; HR Manual Override Audit ({calendarMeta.logs.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                    <th className="py-2.5 px-4">Date (AD / BS) &amp; Timestamp</th>
                    <th className="py-2.5 px-4">Staff Member</th>
                    <th className="py-2.5 px-4">Punch Type &amp; Shift</th>
                    <th className="py-2.5 px-4">Capture Mode</th>
                    <th className="py-2.5 px-4">HR Manual Override Audit</th>
                    {canManage && <th className="py-2.5 px-4 text-right">Edit / Override</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {calendarMeta.logs.length === 0 ? (
                    <tr>
                      <td colSpan={canManage ? 6 : 5} className="p-6 text-center text-slate-500">
                        No attendance timestamps found for {historyMonth} matching current filters.
                      </td>
                    </tr>
                  ) : (
                    calendarMeta.logs.map((att) => (
                      <tr key={att.id} className={att.isManualOverride ? 'bg-amber-50/50' : 'hover:bg-slate-50/70'}>
                        <td className="py-2.5 px-4 font-mono">
                          <div className="font-semibold text-slate-900">
                            {att.timestamp.slice(0, 10)} ·{' '}
                            {new Date(att.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </div>
                          <div className="text-[11px] text-slate-500">{att.bsDate} BS</div>
                          {att.originalTimestamp && (
                            <div className="text-[10px] text-rose-600 line-through">
                              Orig: {new Date(att.originalTimestamp).toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{att.staffName}</div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {att.employeeCode} · {att.department}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`font-mono font-bold ${
                              att.punchType === 'CHECK_IN' ? 'text-emerald-700' : 'text-blue-700'
                            }`}
                          >
                            {att.punchType}
                          </span>
                          <div className="text-[11px] text-slate-500">{att.shiftLabel}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-700">
                          <div>{att.mode}</div>
                          <div className="text-[11px] text-slate-500">{att.deviceIdOrIp}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          {att.isManualOverride ? (
                            <div className="space-y-0.5 text-[11px]">
                              <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono font-bold">
                                HR OVERRIDE by {att.overriddenBy}
                              </span>
                              <div className="text-slate-700">{att.overrideReason}</div>
                            </div>
                          ) : (
                            <span className="text-slate-400">Standard capture</span>
                          )}
                        </td>
                        {canManage && (
                          <td className="py-2.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={() => openEditOverrideModal(att)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-amber-800 bg-white border border-amber-300 rounded-md hover:bg-amber-50"
                            >
                              <Edit3 className="w-3 h-3" />
                              Override
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'handover' && (
        <div className="space-y-6 text-xs">
          <form onSubmit={handleSendHandover} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
              <ArrowRightLeft className="w-4 h-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-slate-900">
                Send Outgoing Shift Handover (To Next Roster Staff)
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">From Shift</label>
                <select
                  value={hoFromShift}
                  onChange={(e) => setHoFromShift(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                  <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                  <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">To Next Shift</label>
                <select
                  value={hoToShift}
                  onChange={(e) => setHoToShift(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                  <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                  <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Department / Ward</label>
                <input
                  value={hoDept}
                  onChange={(e) => setHoDept(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Receiving Staff Member</label>
                <select
                  value={hoIncomingStaffId}
                  onChange={(e) => setHoIncomingStaffId(e.target.value)}
                  className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">Any Incoming Duty Staff</option>
                  {db.staff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.fullName} ({st.department})
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Clinical &amp; Operational Handover Summary *</label>
                <textarea
                  required
                  rows={2}
                  value={hoSummaryNotes}
                  onChange={(e) => setHoSummaryNotes(e.target.value)}
                  placeholder="Bed status, critical patients, pending lab/radiology follow-ups, ER cases..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Pending Tasks</label>
                <textarea
                  rows={2}
                  value={hoPendingTasks}
                  onChange={(e) => setHoPendingTasks(e.target.value)}
                  placeholder="IV doses due, vitals checks, MLC report..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Cash Drawer / Keys / Cart Seal</label>
                <textarea
                  rows={2}
                  value={hoCashKeys}
                  onChange={(e) => setHoCashKeys(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={sendingHandover}
                className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {sendingHandover ? 'Sending Handover...' : 'Send Shift Handover'}
              </button>
            </div>
          </form>

          {/* Shift Handover Register */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Shift Handover Queue &amp; Incoming Approval Register ({(db.shiftHandovers || []).length})
            </div>
            <div className="divide-y divide-slate-100">
              {(db.shiftHandovers || []).length === 0 ? (
                <div className="p-6 text-center text-slate-500">No shift handovers submitted yet.</div>
              ) : (
                (db.shiftHandovers || []).map((ho) => (
                  <div key={ho.id} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1 flex-1 min-w-[260px]">
                        <div className="flex flex-wrap items-center gap-2 font-mono">
                          <strong className="text-slate-900">{ho.handoverNumber}</strong>
                          <span className="text-slate-500">{ho.bsDate} BS</span>
                          <span className="text-blue-700 font-semibold">
                            {ho.department}: {ho.fromShift} &rarr; {ho.toShift}
                          </span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              ho.status === 'RECEIVED_APPROVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : ho.status === 'REVISION_REQUESTED'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {ho.status === 'RECEIVED_APPROVED'
                              ? '● ACCEPTED & VERIFIED'
                              : ho.status === 'REVISION_REQUESTED'
                              ? '▲ REVISION REQUESTED'
                              : '▲ SENT — AWAITING ACCEPTANCE'}
                          </span>
                        </div>
                        <div className="text-slate-800">{ho.summaryNotes}</div>
                        <div className="text-[11px] text-slate-500">
                          From: <strong>{ho.outgoingStaffName}</strong> · Target: <strong>{ho.incomingStaffName}</strong> · Pending: {ho.pendingTasks} · Keys/Cash: {ho.cashOrKeysCount}
                        </div>
                        {ho.revisionNote && (
                          <div className="p-2 rounded bg-rose-50 border border-rose-200 text-rose-800 text-[11px]">
                            <strong>Revision Requested:</strong> {ho.revisionNote}
                          </div>
                        )}
                        {ho.approvedBy && (
                          <div className="text-[11px] font-mono text-emerald-700">
                            Accepted by {ho.approvedBy} ({ho.receivedAt ? new Date(ho.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''})
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        {ho.status !== 'RECEIVED_APPROVED' ? (
                          <>
                            <button
                              type="button"
                              disabled={approvingHoId === ho.id}
                              onClick={() => void handleRespondHandover(ho.id, 'ACCEPT')}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {approvingHoId === ho.id ? 'Processing...' : 'Accept Shift'}
                            </button>
                            <button
                              type="button"
                              disabled={approvingHoId === ho.id}
                              onClick={() => {
                                setRevisionHoId(revisionHoId === ho.id ? null : ho.id);
                                setRevisionComment(ho.revisionNote || '');
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Request Revision
                            </button>
                          </>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Verified
                          </span>
                        )}
                      </div>
                    </div>

                    {revisionHoId === ho.id && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          value={revisionComment}
                          onChange={(e) => setRevisionComment(e.target.value)}
                          placeholder="Enter required clarification or missing handover tasks..."
                          className="flex-1 min-w-[220px] px-3 py-1.5 border border-rose-300 rounded-lg"
                        />
                        <button
                          type="button"
                          disabled={approvingHoId === ho.id || !revisionComment.trim()}
                          onClick={() => void handleRespondHandover(ho.id, 'REQUEST_REVISION', revisionComment)}
                          className="px-3.5 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                        >
                          Submit Revision Request
                        </button>
                      </div>
                    )}

                    {(ho.auditTrail || []).length > 0 && (
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                        <div className="flex items-center gap-1 font-mono text-[10px] font-bold text-slate-500 uppercase">
                          <History className="w-3 h-3" />
                          Shift Change Audit Trail
                        </div>
                        {(ho.auditTrail || []).map((ev) => (
                          <div key={ev.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-700">
                            <div>
                              <span className="font-mono font-bold text-slate-900">{ev.action}</span> ·{' '}
                              <strong>{ev.actorName}</strong>
                              {ev.note ? ` — ${ev.note}` : ''}
                            </div>
                            <span className="font-mono text-slate-500">
                              {new Date(ev.timestamp).toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {subTab === 'payroll' && canViewPayroll && (
        <div className="space-y-6">
          {canPayroll && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Nepali BS Payroll Month
                  </label>
                  <select
                    value={payMonth}
                    onChange={(e) => setPayMonth(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white font-mono"
                  >
                    {BS_MONTHS_EN.map((m) => (
                      <option key={m} value={`${m} ${bsNow.year}`}>
                        {m} {bsNow.year}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Disbursement Bank Account
                  </label>
                  <select
                    value={payAccountId}
                    onChange={(e) => setPayAccountId(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatNpr(a.currentBalance)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleRunPayroll(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Generate Draft Sheet
                </button>
                <button
                  type="button"
                  onClick={() => handleRunPayroll(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                >
                  <Banknote className="w-3.5 h-3.5" />
                  Run &amp; Disburse Payroll
                </button>
              </div>
            </div>
          )}

          {db.payrollRuns.map((run) => (
            <div key={run.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Payroll Batch — {run.bsMonthLabel} ({run.fiscalYear})
                  </div>
                  <div className="text-xs text-slate-500 font-mono">
                    Approved by {run.approvedBy} ·{' '}
                    {run.paidFromAccountName
                      ? `Paid from ${run.paidFromAccountName}`
                      : 'Pending Bank Disbursement'}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs font-mono">
                    <div className="text-slate-500">
                      Gross: {formatNpr(run.totalGrossNpr)} · Ded: {formatNpr(run.totalDeductionsNpr)}
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      Net Payable: {formatNpr(run.totalNetNpr)}
                    </div>
                  </div>
                  {run.status === 'Draft' && canPayroll ? (
                    <button
                      type="button"
                      onClick={() => handleDisburseBatch(run.id)}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                    >
                      Disburse Now
                    </button>
                  ) : (
                    <span className="text-xs font-mono font-semibold text-emerald-700">
                      ● {run.status}
                    </span>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 px-4">Employee</th>
                      <th className="py-2 px-4 text-right">Basic (रू)</th>
                      <th className="py-2 px-4 text-right">Allowances</th>
                      <th className="py-2 px-4 text-right">Gross</th>
                      <th className="py-2 px-4 text-right">SSF (11%)</th>
                      <th className="py-2 px-4 text-right">TDS Tax</th>
                      <th className="py-2 px-4 text-right">Net Payable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {run.items.map((item) => (
                      <tr key={item.staffId}>
                        <td className="py-2 px-4">
                          <span className="font-mono text-slate-500 mr-2">{item.employeeCode}</span>
                          <span className="font-medium text-slate-900">{item.fullName}</span>
                        </td>
                        <td className="py-2 px-4 text-right font-mono">{formatNpr(item.basicSalary)}</td>
                        <td className="py-2 px-4 text-right font-mono">{formatNpr(item.allowances)}</td>
                        <td className="py-2 px-4 text-right font-mono">{formatNpr(item.grossSalary)}</td>
                        <td className="py-2 px-4 text-right font-mono text-rose-700">
                          -{formatNpr(item.ssfDeduction)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono text-rose-700">
                          -{formatNpr(item.tdsDeduction)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-semibold text-slate-900">
                          {formatNpr(item.netPayable)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">Onboard Personnel</h3>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddStaff} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Employee Code *</label>
                  <input
                    required
                    value={empCode}
                    onChange={(e) => setEmpCode(e.target.value.toUpperCase())}
                    placeholder="SAP-034"
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Full Name *</label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(sanitizePersonName(e.target.value))}
                    placeholder="Dr Samuel Lama"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Login Username *</label>
                  <input
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    placeholder="drsamuel"
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Initial Password *</label>
                  <div className="relative">
                    <input
                      required
                      type={showAddPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-3 pr-9 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAddPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                      aria-label={showAddPassword ? 'Hide password' : 'Show password'}
                    >
                      {showAddPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Admin-Assigned Idle PIN (4–6 digits) *
                  </label>
                  <input
                    required
                    pattern="\d{4,6}"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/[^\d]/g, ''))}
                    placeholder="4455"
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Designation</label>
                  <input
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Department</label>
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Basic Salary (रू)</label>
                  <input
                    type="number"
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Tech Allowance (रू)</label>
                  <input
                    type="number"
                    value={techAllowance}
                    onChange={(e) => setTechAllowance(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">RBAC Role</label>
                  <select
                    value={roleId}
                    onChange={(e) => setRoleId(e.target.value as RoleId)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Hospital Unit</label>
                  <input
                    disabled
                    value="Saptari Hospital Main (Bode Barsain)"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-slate-100 text-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Duty Shift</label>
                  <select
                    value={shift}
                    onChange={(e) => setShift(e.target.value as StaffMember['shift'])}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                    <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                    <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Certification</label>
                  <input
                    value={certification}
                    onChange={(e) => setCertification(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-2 flex items-center gap-3 pt-1">
                  <label className="flex items-center gap-2 text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={canSign}
                      onChange={(e) => setCanSign(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    Authorized Report Signatory
                  </label>
                  {canSign && (
                    <input
                      value={regNo}
                      onChange={(e) => setRegNo(e.target.value)}
                      placeholder="NMC Reg #"
                      className="flex-1 px-2.5 py-1 font-mono border border-slate-300 rounded"
                    />
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAdd(false)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg"
                >
                  Save Staff Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                Admin Reset Password / PIN — @{resetTarget.username}
              </h3>
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAdminReset} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
                Operator: <strong>{resetTarget.fullName}</strong> ({resetTarget.roleId})
                {resetTarget.isLocked && (
                  <div className="text-rose-700 font-semibold mt-1">
                    Locked Reason: {resetTarget.lockedReason || 'Failed attempts lockout'}
                  </div>
                )}
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  New Password (leave blank to keep unchanged)
                </label>
                <div className="relative">
                  <input
                    type={showResetPassword ? 'text' : 'password'}
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="e.g. Reset@2083"
                    className="w-full pl-3 pr-9 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => setShowResetPassword((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                    aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                  >
                    {showResetPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Admin-Assigned Idle Lock PIN (4–6 digits)
                </label>
                <input
                  pattern="\d{4,6}"
                  maxLength={6}
                  value={resetPin}
                  onChange={(e) => setResetPin(e.target.value.replace(/[^\d]/g, ''))}
                  placeholder="4–6 numeric digits"
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Mandatory Verification / Reset Reason *
                </label>
                <input
                  required
                  value={resetReason}
                  onChange={(e) => setResetReason(e.target.value)}
                  placeholder="e.g. Staff verified on support call for password & PIN reset"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setResetTarget(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetting}
                  className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {resetting ? 'Resetting...' : 'Unlock & Apply Credentials'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {overrideModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                {overrideModal.punch ? 'HR Override Existing Attendance Punch' : 'HR Record Manual Attendance Override'}
              </h3>
              <button
                type="button"
                onClick={() => setOverrideModal(null)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveOverride} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Staff Member</label>
                <select
                  disabled={Boolean(overrideModal.punch)}
                  value={overrideModal.staffId}
                  onChange={(e) =>
                    setOverrideModal((prev) => (prev ? { ...prev, staffId: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100"
                >
                  {db.staff.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.fullName} ({st.employeeCode})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Punch Type</label>
                  <select
                    value={overrideModal.punchType}
                    onChange={(e) =>
                      setOverrideModal((prev) =>
                        prev ? { ...prev, punchType: e.target.value as 'CHECK_IN' | 'CHECK_OUT' } : prev
                      )
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="CHECK_IN">CHECK_IN</option>
                    <option value="CHECK_OUT">CHECK_OUT</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Shift</label>
                  <select
                    value={overrideModal.shiftLabel}
                    onChange={(e) =>
                      setOverrideModal((prev) => (prev ? { ...prev, shiftLabel: e.target.value } : prev))
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                    <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                    <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Adjusted Date &amp; Time *</label>
                <input
                  type="datetime-local"
                  required
                  value={overrideModal.timestamp}
                  onChange={(e) =>
                    setOverrideModal((prev) => (prev ? { ...prev, timestamp: e.target.value } : prev))
                  }
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">HR Audit Justification *</label>
                <input
                  required
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Biometric missed scan, emergency OT shift, approved late check-in..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setOverrideModal(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOverride || !overrideReason.trim()}
                  className="px-4 py-1.5 font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
                >
                  {savingOverride ? 'Saving...' : 'Apply HR Override'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {subTab === 'certificates' && (
        <div className="space-y-5">
          {canManage && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const emp = db.staff.find((s) => s.id === certStaffId);
                if (!emp || !certBody.trim()) return;
                setCertSaving(true);
                try {
                  const resp = await apiRequest<{
                    certificate: HrCertificateRecord;
                    db: LimsDatabase;
                  }>('/api/personnel/certificates', activeUser.id, {
                    method: 'POST',
                    body: JSON.stringify({
                      staffId: emp.id,
                      certificateType: certType,
                      designation: emp.designation,
                      department: emp.department,
                      joinedAt: certJoinedAt || emp.joinedAt,
                      relievedAt: certRelievedAt || undefined,
                      basicSalaryNpr: Number(certSalaryNpr) || emp.basicSalaryNpr,
                      subject: certSubject.trim() || `${certType} — ${emp.fullName}`,
                      documentBody: certBody.trim(),
                      logToChalani: certLogChalani,
                    }),
                  });
                  onUpdated(
                    resp.db,
                    `Issued ${resp.certificate.certificateType} (${resp.certificate.certificateNumber}) for ${emp.fullName}.`
                  );
                  setCertToPrint(resp.certificate);
                } catch (err: any) {
                  onUpdated(db, err?.message || 'Failed to issue HR certificate.');
                } finally {
                  setCertSaving(false);
                }
              }}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Issue Employee Experience Certificate, Appointment, Relieving &amp; Salary Letters
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Generate printable A4 letters, Word (.docx) files, or AI-composed official HR certificates with optional Outward Chalani logging.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Select Employee *</label>
                  <select
                    value={certStaffId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setCertStaffId(id);
                      const emp = db.staff.find((s) => s.id === id);
                      if (emp) {
                        setCertJoinedAt(emp.joinedAt || '');
                        setCertSalaryNpr(String(emp.basicSalaryNpr || 0));
                      }
                    }}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    {db.staff.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.fullName} ({st.employeeCode} · {st.designation})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Letter / Certificate Type *</label>
                  <select
                    value={certType}
                    onChange={(e) =>
                      setCertType(e.target.value as HrCertificateRecord['certificateType'])
                    }
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="Experience Certificate">Experience Certificate</option>
                    <option value="Appointment Letter">Appointment Letter</option>
                    <option value="Relieving Letter">Relieving Letter</option>
                    <option value="Promotion Letter">Promotion Letter</option>
                    <option value="Salary Verification">Salary Verification</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Basic Salary (रू / Month)</label>
                  <input
                    type="number"
                    min={0}
                    value={certSalaryNpr}
                    onChange={(e) => setCertSalaryNpr(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Joining Date</label>
                  <input
                    value={certJoinedAt}
                    onChange={(e) => setCertJoinedAt(e.target.value)}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Relieving / Effective Date</label>
                  <input
                    value={certRelievedAt}
                    onChange={(e) => setCertRelievedAt(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Subject / Title</label>
                  <input
                    value={certSubject}
                    onChange={(e) => setCertSubject(e.target.value)}
                    placeholder="To Whom It May Concern / Appointment of..."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="font-medium text-slate-700">Official Certificate / Letter Body *</label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={certLang}
                      onChange={(e) =>
                        setCertLang(e.target.value as 'English' | 'Nepali' | 'Bilingual (English + Nepali)')
                      }
                      className="px-2 py-1 bg-white border border-slate-300 rounded-md text-[11px]"
                    >
                      <option value="English">English</option>
                      <option value="Nepali">Nepali</option>
                      <option value="Bilingual (English + Nepali)">Bilingual</option>
                    </select>
                    <button
                      type="button"
                      disabled={certAiBusy}
                      onClick={async () => {
                        const emp = db.staff.find((s) => s.id === certStaffId);
                        if (!emp) return;
                        setCertAiBusy(true);
                        try {
                          const resp = await apiRequest<{ subject: string; documentBody: string }>(
                            '/api/ai/compose-letter',
                            activeUser.id,
                            {
                              method: 'POST',
                              body: JSON.stringify({
                                documentKind: certType,
                                language: certLang,
                                partyName: emp.fullName,
                                department: emp.department,
                                subject: certSubject.trim() || `${certType} — ${emp.fullName}`,
                                keyPoints: certBody.trim() || `Issue formal ${certType} for ${emp.fullName} working as ${emp.designation} in ${emp.department} since ${certJoinedAt || emp.joinedAt}.`,
                                employeeDetails: {
                                  fullName: emp.fullName,
                                  employeeCode: emp.employeeCode,
                                  designation: emp.designation,
                                  department: emp.department,
                                  joinedAt: certJoinedAt || emp.joinedAt,
                                  relievingDate: certRelievedAt || undefined,
                                  registrationNumber: emp.registrationNumber,
                                  basicSalaryNpr: Number(certSalaryNpr) || emp.basicSalaryNpr,
                                  totalSalaryNpr: (Number(certSalaryNpr) || emp.basicSalaryNpr) + (emp.technicalAllowanceNpr || 0) + (emp.shiftAllowanceNpr || 0),
                                  shift: emp.shift,
                                },
                              }),
                            }
                          );
                          if (!certSubject.trim() && resp.subject) setCertSubject(resp.subject);
                          if (resp.documentBody) setCertBody(resp.documentBody);
                          onUpdated(db, `AI drafted ${certType} for ${emp.fullName}.`);
                        } catch (err: any) {
                          onUpdated(db, err?.message || 'AI draft failed.');
                        } finally {
                          setCertAiBusy(false);
                        }
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-[11px] font-semibold"
                    >
                      <Sparkles className="w-3 h-3" />
                      {certAiBusy ? 'Drafting...' : 'AI Draft Body'}
                    </button>
                  </div>
                </div>
                <textarea
                  required
                  rows={6}
                  value={certBody}
                  onChange={(e) => setCertBody(e.target.value)}
                  placeholder="Write formal HR certificate / appointment letter body, or click 'AI Draft Body'..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                <label className="inline-flex items-center gap-2 cursor-pointer text-slate-700 font-medium">
                  <input
                    type="checkbox"
                    checked={certLogChalani}
                    onChange={(e) => setCertLogChalani(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span>Also log automatically in Outward Chalani Register</span>
                </label>
                <button
                  type="submit"
                  disabled={certSaving || !certBody.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Award className="w-3.5 h-3.5" />
                  {certSaving ? 'Issuing...' : 'Issue & Open Print / .docx Modal'}
                </button>
              </div>
            </form>
          )}

          {/* Issued HR Certificates Register */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden text-xs">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 font-semibold text-slate-900">
              Issued HR Certificates &amp; Official Letters ({(db.hrCertificates || []).length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Certificate # &amp; BS Date</th>
                    <th className="py-2.5 px-4">Employee</th>
                    <th className="py-2.5 px-4">Type &amp; Subject</th>
                    <th className="py-2.5 px-4">Chalani Ref</th>
                    <th className="py-2.5 px-4 text-right">Print / Word</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(db.hrCertificates || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-slate-500">
                        No HR certificates or appointment letters issued yet.
                      </td>
                    </tr>
                  ) : (
                    (db.hrCertificates || []).map((cert) => (
                      <tr key={cert.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4 font-mono">
                          <div className="font-bold text-slate-900">{cert.certificateNumber}</div>
                          <div className="text-[11px] text-slate-500">{cert.issuedDateBs} BS</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{cert.staffName}</div>
                          <div className="text-[11px] text-slate-500">
                            {cert.employeeCode} · {cert.designation} ({cert.department})
                          </div>
                        </td>
                        <td className="py-2.5 px-4 max-w-xs">
                          <div className="font-semibold text-indigo-700">{cert.certificateType}</div>
                          <div className="text-[11px] text-slate-600 truncate">{cert.subject}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600">
                          {cert.linkedChalaniNumber || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setCertToPrint(cert)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-white border border-blue-300 rounded-md hover:bg-blue-50"
                            >
                              <Printer className="w-3 h-3" />
                              Print A4
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                void exportLetterToDocx({
                                  hospitalName: db.settings.labName,
                                  hospitalNameNp: db.settings.labNameNp,
                                  addressLine: db.settings.addressLine,
                                  contactLine: db.settings.contactLine,
                                  panNumber: db.settings.panNumber,
                                  documentHeading: cert.certificateType.toUpperCase(),
                                  refNumber: cert.certificateNumber,
                                  dateBs: cert.issuedDateBs,
                                  dateAd: cert.issuedAt.slice(0, 10),
                                  department: cert.department,
                                  recipientLine: `${cert.staffName} (${cert.employeeCode})`,
                                  recipientAddress: `${cert.designation} · ${cert.department}`,
                                  subject: cert.subject,
                                  body: cert.documentBody,
                                  signatoryName: db.settings.moduleSettings?.digitalVerifierName || 'Dr. Santosh Majhi',
                                  signatoryDesignation: 'Hospital Administrator / HR Director',
                                  fileName: `${cert.certificateNumber}-${cert.staffName.replace(/[^a-z0-9]/gi, '_')}.docx`,
                                });
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100"
                            >
                              <Download className="w-3 h-3" />
                              .docx
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {certToPrint && (
        <HrCertificatePrintModal
          certificate={certToPrint}
          settings={db.settings}
          onClose={() => setCertToPrint(null)}
        />
      )}
    </div>
  );
}
