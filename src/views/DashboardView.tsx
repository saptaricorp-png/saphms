import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  Ambulance,
  ArrowRight,
  ArrowRightLeft,
  BarChart3,
  BedDouble,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  FlaskConical,
  History,
  Landmark,
  MessageCircle,
  PackageX,
  PhoneCall,
  Pill,
  Printer,
  QrCode,
  Receipt,
  RotateCcw,
  Scan,
  Scissors,
  Send,
  Settings,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  UserPlus,
  XCircle,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  DashboardLayoutConfig,
  DashboardWidgetId,
  DiscountCreditApprovalRequest,
  LabOrder,
  LimsDatabase,
  PermissionKey,
  RoleId,
} from '../types/lims';
import { computeOrderTat } from '../utils/clinical';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { TatStatusLabel } from '../components/StatusText';
import { DashboardWidget } from '../components/DashboardWidget';
import { QrCodeSvg } from '../components/DocumentCodes';
import { apiRequest } from '../api/client';

interface DashboardViewProps {
  db: LimsDatabase;
  activeFiscalYear: string;
  activeUserId: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onNavigate: (tab: string) => void;
  onOpenNewOrder?: () => void;
  onOpenResults: (order: LabOrder) => void;
  onOpenReport: (order: LabOrder, autoPrint?: boolean) => void;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
}

export function DashboardView({
  db,
  activeFiscalYear,
  activeUserId,
  hasPerm,
  onNavigate,
  onOpenResults,
  onOpenReport,
  onUpdated,
}: DashboardViewProps) {
  const [sendingWa, setSendingWa] = useState(false);
  const [lastWaUrl, setLastWaUrl] = useState<string | null>(null);

  const activeUser = useMemo(
    () => db.staff.find((s) => s.id === activeUserId) || db.staff[0],
    [db.staff, activeUserId]
  );

  const fallbackLayoutConfig = useMemo<DashboardLayoutConfig>(() => {
    const roleId = activeUser?.roleId || 'LAB_TECH';
    const fromDb = db.dashboardLayoutConfigs?.[roleId];
    if (fromDb) return fromDb;
    if (roleId === 'LAB_TECH') {
      return {
        roleId: 'LAB_TECH',
        title: 'Laboratory Technologist — Pending TAT Alerts',
        subtitle: 'Focused analytical bench queue for result entry, validation & report printing',
        widgets: ['TAT_ALERTS_ONLY'],
      };
    }
    return {
      roleId,
      title: 'Hospital Operations & Analytics Dashboard',
      subtitle: 'Global analytics, clinical alerts, stock reorder warnings & TAT monitoring',
      widgets: [
        'EXECUTIVE_SUMMARY',
        'LOW_STOCK_ALERTS',
        'PRIORITY_ALERTS',
        'KPI_GRID',
        'CLINICAL_OPS',
        'SHIFT_HANDOVER',
        'QR_ATTENDANCE',
        'WHATSAPP_DIGEST',
        'ANALYTICS_CHARTS',
        'TAT_WORKBENCH',
        'REFERRALS_AND_REAGENTS',
      ],
    };
  }, [activeUser?.roleId, db.dashboardLayoutConfigs]);

  const [fetchedLayoutConfig, setFetchedLayoutConfig] = useState<DashboardLayoutConfig | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest<{ roleId: RoleId; layoutConfig: DashboardLayoutConfig }>(
      '/api/dashboard/layout-config',
      activeUserId
    )
      .then((res) => {
        if (active && res?.layoutConfig) {
          setFetchedLayoutConfig(res.layoutConfig);
        }
      })
      .catch(() => {
        if (active) setFetchedLayoutConfig(null);
      });
    return () => {
      active = false;
    };
  }, [activeUserId, activeUser?.roleId]);

  const layoutConfig = fetchedLayoutConfig || fallbackLayoutConfig;
  const hasWidget = (w: DashboardWidgetId) => layoutConfig.widgets.includes(w);
  const isLabTechTatOnly =
    activeUser?.roleId === 'LAB_TECH' ||
    (layoutConfig.widgets.length === 1 && layoutConfig.widgets[0] === 'TAT_ALERTS_ONLY');

  // Shift Handover Console State
  const [showHandoverForm, setShowHandoverForm] = useState(false);
  const [hoFromShift, setHoFromShift] = useState<string>(activeUser?.shift || 'Morning (07:00-15:00)');
  const [hoToShift, setHoToShift] = useState<string>('Afternoon (14:00-22:00)');
  const [hoDept, setHoDept] = useState<string>(activeUser?.department || 'General Ward');
  const [hoIncomingStaffId, setHoIncomingStaffId] = useState<string>('');
  const [hoSummaryNotes, setHoSummaryNotes] = useState<string>('');
  const [hoPendingTasks, setHoPendingTasks] = useState<string>('');
  const [hoCashKeys, setHoCashKeys] = useState<string>('All keys, registers & drawer verified');
  const [submittingHo, setSubmittingHo] = useState(false);
  const [respondingHoId, setRespondingHoId] = useState<string | null>(null);
  const [revisionTargetId, setRevisionTargetId] = useState<string | null>(null);
  const [revisionComment, setRevisionComment] = useState<string>('');
  const [expandedAuditHoId, setExpandedAuditHoId] = useState<string | null>(null);

  // Quick Staff QR Clock-In / Clock-Out State
  const [qrScanInput, setQrScanInput] = useState('');
  const [qrPunchType, setQrPunchType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [qrPunchBusy, setQrPunchBusy] = useState(false);

  // Live Discount & Credit Limit Approvals Desk State (Admin & Manager)
  const [dcApprovalRemarks, setDcApprovalRemarks] = useState<Record<string, string>>({});
  const [dcBusyId, setDcBusyId] = useState<string | null>(null);
  const [dcHistoryOpenId, setDcHistoryOpenId] = useState<string | null>(null);
  const [approvalTab, setApprovalTab] = useState<'PENDING' | 'HISTORY'>('PENDING');
  const [callAckBusyId, setCallAckBusyId] = useState<string | null>(null);

  const referredPatientsSummary = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * 86400 * 1000;
    const monthAgo = now - 30 * 86400 * 1000;
    const rows: Array<{
      sourceType: 'OPD' | 'ER' | 'IPD';
      sourceId: string;
      encounterNumber: string;
      patientName: string;
      uhid?: string;
      referredAt: string;
      ext: NonNullable<LimsDatabase['emergencyCases'][number]['externalReferral']>;
    }> = [];

    for (const v of db.opdVisits || []) {
      if (v.externalReferral) {
        rows.push({
          sourceType: 'OPD',
          sourceId: v.id,
          encounterNumber: v.tokenNumber,
          patientName: v.patientName,
          uhid: v.uhid,
          referredAt: v.externalReferral.referredAt || v.visitDate,
          ext: v.externalReferral,
        });
      }
    }
    for (const e of db.emergencyCases || []) {
      if (e.externalReferral) {
        rows.push({
          sourceType: 'ER',
          sourceId: e.id,
          encounterNumber: e.erNumber,
          patientName: e.patientName,
          uhid: e.uhid,
          referredAt: e.externalReferral.referredAt || e.registeredAt,
          ext: e.externalReferral,
        });
      }
    }
    for (const a of db.ipdAdmissions || []) {
      if (a.externalReferral) {
        rows.push({
          sourceType: 'IPD',
          sourceId: a.id,
          encounterNumber: a.admissionNumber,
          patientName: a.patientName,
          uhid: a.uhid,
          referredAt: a.externalReferral.referredAt || a.admittedAt,
          ext: a.externalReferral,
        });
      }
    }

    rows.sort((a, b) => new Date(b.referredAt).getTime() - new Date(a.referredAt).getTime());
    const weeklyCount = rows.filter((r) => new Date(r.referredAt).getTime() >= weekAgo).length;
    const monthlyCount = rows.filter((r) => new Date(r.referredAt).getTime() >= monthAgo).length;
    const pendingCallCount = rows.filter((r) => !r.ext.managerNotifiedCalled).length;
    return { rows, weeklyCount, monthlyCount, pendingCallCount };
  }, [db.opdVisits, db.emergencyCases, db.ipdAdmissions]);

  const isAdmin =
    activeUser?.roleId === 'SUPER_ADMIN' ||
    activeUser?.roleId === 'SAAS_ADMIN' ||
    hasPerm('finance.approve_admin');
  const isManager =
    isAdmin ||
    hasPerm('finance.approve_manager') ||
    activeUser?.roleId === 'CENTER_MANAGER' ||
    activeUser?.roleId === 'INVENTORY_HR';

  const approvalStats = useMemo(() => {
    const all = db.discountCreditApprovals || [];
    const pending = all.filter(
      (r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN'
    );
    const history = all.filter(
      (r) => r.status === 'APPROVED' || r.status === 'DECLINED'
    );
    const pendingDiscountCount = pending.filter(
      (r) => r.requestType === 'DISCOUNT_OVERRIDE'
    ).length;
    const pendingCreditCount = pending.filter(
      (r) => r.requestType === 'CREDIT_LIMIT_OVERRIDE'
    ).length;
    const pendingFinanceVouchers = (db.financeApprovalRequests || []).filter(
      (f) => f.status === 'PENDING_MANAGER' || f.status === 'PENDING_ADMIN'
    );
    const approvedCount = all.filter((r) => r.status === 'APPROVED').length;
    return {
      all,
      pending,
      history,
      pendingDiscountCount,
      pendingCreditCount,
      pendingFinanceVouchers,
      approvedCount,
    };
  }, [db.discountCreditApprovals, db.financeApprovalRequests]);

  const personalStaffQrToken = useMemo(
    () => `SAPTARI-STAFF-${activeUser?.employeeCode || 'EMP'}-${activeUser?.id || activeUserId}`,
    [activeUser, activeUserId]
  );

  const stats = useMemo(() => {
    const now = Date.now();
    const fyOrders = db.orders.filter((o) => !o.fiscalYear || o.fiscalYear === activeFiscalYear);
    const totalOrders = fyOrders.length;
    const validatedOrders = fyOrders.filter((o) => o.status === 'Validated' || o.status === 'Dispatched');
    const pendingValidation = fyOrders.filter((o) => o.status === 'Resulted').length;

    let slaCompliantCount = 0;
    let breachedCount = 0;
    let atRiskCount = 0;
    let criticalFindings = 0;

    for (const o of fyOrders) {
      const t = computeOrderTat(o, now);
      if (t.status === 'Completed On Time' || t.status === 'On Track') slaCompliantCount++;
      if (t.status === 'Breached' || t.status === 'Completed Late') breachedCount++;
      if (t.status === 'At Risk') atRiskCount++;
      for (const test of o.tests) {
        if (
          test.parameterResults.some(
            (p) =>
              p.flag === 'CRITICAL_HIGH' ||
              p.flag === 'CRITICAL_LOW' ||
              p.flag === 'CRITICAL'
          )
        ) {
          criticalFindings++;
        }
      }
    }

    const slaPercent = totalOrders > 0 ? Math.round((slaCompliantCount / totalOrders) * 100) : 100;
    const totalRevenue = fyOrders.reduce((sum, o) => sum + o.totalAmount, 0);
    const totalCashBank = db.accounts.reduce((sum, a) => sum + a.currentBalance, 0);
    const totalPatientsCount = (db.patients || []).length;
    const totalOpdCount = (db.opdVisits || []).length;

    const lowStockReagents = db.reagents.filter((r) => r.currentStock <= r.reorderLevel);
    const expiringSoonReagents = db.reagents.filter((r) => {
      const days = Math.ceil((new Date(r.expiryDate).getTime() - now) / (86400 * 1000));
      return days <= 30;
    });

    const bsTodayStr = adToBs(new Date()).formattedEn;
    const todaysOrders = fyOrders.filter((o) => adToBs(o.orderedAt).formattedEn === bsTodayStr);
    const dailyBase = todaysOrders.length > 0 ? todaysOrders : fyOrders.slice(0, 5);
    const dailySalesNpr = dailyBase.reduce((s, o) => s + o.totalAmount, 0);
    const dailyCashNpr = dailyBase.reduce((s, o) => s + (o.cashPaid || 0), 0);
    const dailyBankNpr = dailyBase.reduce((s, o) => s + (o.bankPaid || 0), 0);

    const pharmacyInvoices = (db.pharmacyInvoices || []).filter(
      (i) => !i.fiscalYear || i.fiscalYear === activeFiscalYear
    );
    const pharmacySalesNpr = pharmacyInvoices.reduce((s, i) => s + i.totalNpr, 0);
    const totalBeds = (db.hospitalBeds || []).length;
    const occupiedBeds = (db.hospitalBeds || []).filter((b) => b.status === 'Occupied').length;
    const availableBeds = (db.hospitalBeds || []).filter((b) => b.status === 'Available').length;
    const emergencyCases = db.emergencyCases || [];
    const activeErCount = emergencyCases.filter(
      (c) => c.disposition === 'Under Observation (ER)'
    ).length;
    const mlcPendingPolice = emergencyCases.filter((c) => c.isMlc && !c.policeInformed).length;
    const pendingPayoutReqs = (db.referralPayoutRequests || []).filter(
      (r) => r.status === 'Pending Admin Approval'
    ).length;
    const dartaChalaniCount = (db.dartaChalani || []).length;

    const activeAdmissions = (db.ipdAdmissions || []).filter((a) => a.disposition === 'Admitted');
    const criticalNursingCharts = activeAdmissions
      .map((adm) => {
        const charts = adm.nursingCharts || [];
        const latest = charts[0];
        const missingChart = charts.length === 0;
        const abnormalSpo2 = latest?.spo2Pct !== undefined && latest.spo2Pct < 94;
        const highTemp = latest?.tempF !== undefined && (latest.tempF >= 100.4 || latest.tempF < 95);
        const abnormalPulse =
          latest?.pulseBpm !== undefined && (latest.pulseBpm > 120 || latest.pulseBpm < 50);
        if (!missingChart && !abnormalSpo2 && !highTemp && !abnormalPulse) return null;
        const reasons: string[] = [];
        if (missingChart) reasons.push('Nursing chart missing');
        if (abnormalSpo2) reasons.push(`Low SpO2 ${latest?.spo2Pct}%`);
        if (highTemp) reasons.push(`Temp ${latest?.tempF}°F`);
        if (abnormalPulse) reasons.push(`PR ${latest?.pulseBpm} bpm`);
        return {
          id: adm.id,
          admissionNumber: adm.admissionNumber,
          patientName: adm.patientName,
          bedLabel: adm.currentBedLabel,
          wardName: adm.currentWardName,
          reason: reasons.join(' · '),
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const urgentMlcPendingPolice = emergencyCases.filter((c) => c.isMlc && !c.policeInformed);

    const criticalReagentLots = db.reagents
      .map((r) => {
        const daysLeft = Math.ceil((new Date(r.expiryDate).getTime() - now) / (86400 * 1000));
        const isLow = r.currentStock <= r.reorderLevel;
        if (daysLeft > 30 && !isLow) return null;
        return {
          id: r.id,
          name: r.name,
          lotNumber: r.lotNumber,
          expiryDate: r.expiryDate,
          daysLeft,
          isLow,
          currentStock: r.currentStock,
          unit: r.unit,
          reorderLevel: r.reorderLevel,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    const frequentReferrals = db.referrals
      .map((r) => {
        const refOrders = fyOrders.filter((o) => o.referralPartnerId === r.id);
        return {
          id: r.id,
          name: r.name,
          type: r.type,
          orderCount: refOrders.length,
          totalReferredSales: r.totalReferredSales,
        };
      })
      .sort((a, b) => b.orderCount - a.orderCount || b.totalReferredSales - a.totalReferredSales);

    const todayIso = new Date().toISOString().slice(0, 10);
    const lowStockPharmacyItems = (db.pharmacyMedicines || [])
      .map((med) => {
        const usableStock = (db.pharmacyBatches || [])
          .filter(
            (b) =>
              b.medicineId === med.id &&
              !b.quarantined &&
              (!b.expiryDate || b.expiryDate >= todayIso)
          )
          .reduce((s, b) => s + (b.quantityOnHand || 0), 0);
        if (usableStock > med.reorderLevel) return null;
        return {
          id: med.id,
          source: 'PHARMACY' as const,
          code: med.code,
          name: med.brandName,
          sublabel: `${med.genericName} · ${med.strength}`,
          currentStock: usableStock,
          reorderLevel: med.reorderLevel,
          unit: med.unitLabel || 'units',
          isOutOfStock: usableStock <= 0,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    const lowStockAlerts = [
      ...lowStockReagents.map((r) => ({
        id: r.id,
        source: 'REAGENT' as const,
        code: r.lotNumber,
        name: r.name,
        sublabel: `${r.category} · Exp ${r.expiryDate}`,
        currentStock: r.currentStock,
        reorderLevel: r.reorderLevel,
        unit: r.unit,
        isOutOfStock: r.currentStock <= 0,
      })),
      ...lowStockPharmacyItems,
    ].sort((a, b) => a.currentStock - b.currentStock);

    return {
      totalOrders,
      validatedCount: validatedOrders.length,
      pendingValidation,
      slaPercent,
      breachedCount,
      atRiskCount,
      criticalFindings,
      totalRevenue,
      totalCashBank,
      totalPatientsCount,
      totalOpdCount,
      frequentReferrals,
      lowStockReagents,
      lowStockPharmacyItems,
      lowStockAlerts,
      expiringSoonReagents,
      dailySalesNpr,
      dailyCashNpr,
      dailyBankNpr,
      dailyOrderCount: dailyBase.length,
      pharmacySalesNpr,
      pharmacyBillCount: pharmacyInvoices.length,
      totalBeds,
      occupiedBeds,
      availableBeds,
      activeErCount,
      mlcPendingPolice,
      pendingPayoutReqs,
      dartaChalaniCount,
      criticalNursingCharts,
      urgentMlcPendingPolice,
      criticalReagentLots,
      scheduledOtCount: (db.otCases || []).filter(
        (c) => c.status === 'Scheduled' || c.status === 'Pre-Op Ready'
      ).length,
      inProgressOtCount: (db.otCases || []).filter((c) => c.status === 'In Progress').length,
      completedOtCount: (db.otCases || []).filter((c) => c.status === 'Completed').length,
    };
  }, [db, activeFiscalYear]);

  const pendingTatAlerts = useMemo(() => {
    const now = Date.now();
    return db.orders
      .filter((o) => (!o.fiscalYear || o.fiscalYear === activeFiscalYear) && o.status !== 'Validated' && o.status !== 'Dispatched')
      .map((order) => ({
        order,
        tat: computeOrderTat(order, now),
        hasCritical: order.tests.some((t) =>
          t.parameterResults.some(
            (p) =>
              p.flag === 'CRITICAL_HIGH' ||
              p.flag === 'CRITICAL_LOW' ||
              p.flag === 'CRITICAL' ||
              p.flag === 'HIGH_RISK'
          )
        ),
      }))
      .sort((a, b) => {
        const rank = (s: string) => (s === 'Breached' ? 0 : s === 'At Risk' ? 1 : 2);
        const rDiff = rank(a.tat.status) - rank(b.tat.status);
        if (rDiff !== 0) return rDiff;
        if (a.order.priority === 'STAT' && b.order.priority !== 'STAT') return -1;
        if (a.order.priority !== 'STAT' && b.order.priority === 'STAT') return 1;
        return new Date(a.order.dueAt).getTime() - new Date(b.order.dueAt).getTime();
      });
  }, [db.orders, activeFiscalYear]);

  // Daily trend data for Recharts (chronological order across BS/AD days)
  const chartSeries = useMemo(() => {
    const fyOrders = db.orders.filter((o) => !o.fiscalYear || o.fiscalYear === activeFiscalYear);
    const dayMap = new Map<
      string,
      {
        dayKey: string;
        label: string;
        bsDate: string;
        revenueNpr: number;
        cashNpr: number;
        bankCreditNpr: number;
        completedOrders: number;
        pendingOrders: number;
      }
    >();

    const sorted = [...fyOrders].sort(
      (a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime()
    );

    for (const o of sorted) {
      const d = new Date(o.orderedAt);
      const dayKey = d.toISOString().slice(0, 10);
      const bs = adToBs(d);
      const shortBs = `${bs.monthNameEn.slice(0, 3)} ${bs.day}`;
      const existing = dayMap.get(dayKey) || {
        dayKey,
        label: shortBs,
        bsDate: bs.formattedEn,
        revenueNpr: 0,
        cashNpr: 0,
        bankCreditNpr: 0,
        completedOrders: 0,
        pendingOrders: 0,
      };
      existing.revenueNpr += o.totalAmount;
      existing.cashNpr += o.cashPaid || 0;
      existing.bankCreditNpr += Math.max(0, o.totalAmount - (o.cashPaid || 0));
      if (o.status === 'Validated' || o.status === 'Dispatched') {
        existing.completedOrders += 1;
      } else {
        existing.pendingOrders += 1;
      }
      dayMap.set(dayKey, existing);
    }

    return Array.from(dayMap.values()).slice(-10);
  }, [db.orders, activeFiscalYear]);

  const activeWatchlist = useMemo(() => {
    return db.orders
      .filter((o) => !o.fiscalYear || o.fiscalYear === activeFiscalYear)
      .slice()
      .sort((a, b) => {
        const aDone = a.status === 'Validated' || a.status === 'Dispatched';
        const bDone = b.status === 'Validated' || b.status === 'Dispatched';
        if (aDone && !bDone) return 1;
        if (!aDone && bDone) return -1;
        return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      })
      .slice(0, 6);
  }, [db.orders, activeFiscalYear]);

  const bsToday = adToBs(new Date());

  const handleSendDailyWhatsApp = async () => {
    setSendingWa(true);
    try {
      const resp = await apiRequest<{
        db: LimsDatabase;
        whatsappUrl: string;
        log: any;
      }>('/api/whatsapp/send-daily-sales', activeUserId, {
        method: 'POST',
        body: JSON.stringify({ recipientPhone: db.settings.adminWhatsAppNumber }),
      });
      setLastWaUrl(resp.whatsappUrl);
      onUpdated(
        resp.db,
        `Daily Sales (${formatNpr(resp.log.totalSalesNpr)}) dispatched for Admin WhatsApp ${resp.log.recipientPhone}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'WhatsApp daily sales dispatch failed.');
    } finally {
      setSendingWa(false);
    }
  };

  const handleDcDecision = async (
    item: DiscountCreditApprovalRequest,
    decision: 'APPROVE' | 'DECLINE'
  ) => {
    setDcBusyId(item.id);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/approvals/discount-credit/${item.id}/decision`,
        activeUserId,
        {
          method: 'POST',
          body: JSON.stringify({
            decision,
            remarks: dcApprovalRemarks[item.id]?.trim() || undefined,
          }),
        }
      );
      setDcApprovalRemarks((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      onUpdated(
        resp.db,
        decision === 'DECLINE'
          ? `Declined ${item.requestNumber} (${item.patientName}).`
          : `Updated approval ${item.requestNumber} (${item.patientName}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to record approval decision.');
    } finally {
      setDcBusyId(null);
    }
  };

  const handleSubmitHandover = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hoSummaryNotes.trim()) return;
    setSubmittingHo(true);
    try {
      const incoming = db.staff.find((s) => s.id === hoIncomingStaffId);
      const resp = await apiRequest<{ db: LimsDatabase; handover: { handoverNumber: string } }>(
        '/api/handovers',
        activeUserId,
        {
          method: 'POST',
          body: JSON.stringify({
            fromShift: hoFromShift,
            toShift: hoToShift,
            department: hoDept.trim() || 'Hospital Counter',
            incomingStaffId: incoming?.id,
            incomingStaffName: incoming?.fullName || 'Incoming Duty Staff',
            summaryNotes: hoSummaryNotes.trim(),
            pendingTasks: hoPendingTasks.trim() || 'None',
            cashOrKeysCount: hoCashKeys.trim() || 'Keys & registers verified',
          }),
        }
      );
      onUpdated(resp.db, `Submitted Shift Handover ${resp.handover.handoverNumber}.`);
      setHoSummaryNotes('');
      setHoPendingTasks('');
      setShowHandoverForm(false);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to submit shift handover.');
    } finally {
      setSubmittingHo(false);
    }
  };

  const handleRespondHandover = async (
    handoverId: string,
    decision: 'ACCEPT' | 'REQUEST_REVISION',
    comment?: string
  ) => {
    if (decision === 'REQUEST_REVISION' && !comment?.trim()) return;
    setRespondingHoId(handoverId);
    try {
      const resp = await apiRequest<{ db: LimsDatabase; handover: { handoverNumber: string } }>(
        `/api/handovers/${handoverId}/respond`,
        activeUserId,
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
          : `Requested revision on handover ${resp.handover.handoverNumber}.`
      );
      setRevisionTargetId(null);
      setRevisionComment('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to respond to shift handover.');
    } finally {
      setRespondingHoId(null);
    }
  };

  const handleQuickQrPunch = async (rawToken?: string, overrideType?: 'CHECK_IN' | 'CHECK_OUT') => {
    const token = (rawToken ?? qrScanInput).trim();
    const typeToUse = overrideType || qrPunchType;
    const lower = token.toLowerCase();
    const matchedStaff = token
      ? db.staff.find(
          (s) =>
            `saptari-staff-${s.employeeCode}-${s.id}`.toLowerCase() === lower ||
            s.employeeCode.toLowerCase() === lower ||
            s.id.toLowerCase() === lower ||
            s.username.toLowerCase() === lower
        )
      : activeUser;

    if (!matchedStaff) {
      onUpdated(db, `No staff profile matched QR token "${token}". Expected SAPTARI-STAFF-{CODE}-{ID}.`);
      return;
    }

    setQrPunchBusy(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/attendance/punch', activeUserId, {
        method: 'POST',
        body: JSON.stringify({
          targetStaffId: matchedStaff.id,
          mode: 'QR_SCAN',
          punchType: typeToUse,
          shiftLabel: matchedStaff.shift || 'Morning (07:00-15:00)',
          deviceIdOrIp: `DASH-QR (${matchedStaff.employeeCode})`,
          verificationCode: token || `SAPTARI-STAFF-${matchedStaff.employeeCode}-${matchedStaff.id}`,
        }),
      });
      onUpdated(
        resp.db,
        `${matchedStaff.fullName} (${matchedStaff.employeeCode}) ${
          typeToUse === 'CHECK_IN' ? 'Clocked In' : 'Clocked Out'
        } via Staff QR.`
      );
      if (!rawToken) setQrScanInput('');
    } catch (err: any) {
      onUpdated(db, err.message || 'QR attendance clock-in/out failed.');
    } finally {
      setQrPunchBusy(false);
    }
  };

  if (isLabTechTatOnly) {
    const breachedOrRisk = pendingTatAlerts.filter(
      (x) => x.tat.status === 'Breached' || x.tat.status === 'At Risk'
    );
    const awaitingValidation = pendingTatAlerts.filter((x) => x.order.status === 'Resulted');
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
              {layoutConfig.title}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {layoutConfig.subtitle} · {bsToday.formattedNp} ({bsToday.formattedEn})
            </p>
          </div>
          {hasPerm('orders.view') && (
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              Open Full Lab Queue
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-rose-200 rounded-xl p-4">
            <div className="text-xs font-medium text-rose-700">Breached / At-Risk TAT Alerts</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-rose-800 mt-1">
              {breachedOrRisk.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Immediate bench attention required</div>
          </div>
          <div className="bg-white border border-amber-200 rounded-xl p-4">
            <div className="text-xs font-medium text-amber-800">Awaiting Validation Sign-Off</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-900 mt-1">
              {awaitingValidation.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Results entered and ready to validate</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="text-xs font-medium text-slate-600">Total Pending Analytical Orders</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {pendingTatAlerts.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">Scope restricted via role layout_config</div>
          </div>
        </div>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <h2 className="text-sm font-semibold text-slate-900">
                Pending TAT SLA Alerts ({pendingTatAlerts.length})
              </h2>
            </div>
            <span className="text-[11px] font-mono text-slate-500">
              Layout Mode: {layoutConfig.roleId} · TAT_ALERTS_ONLY
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-4">Accession &amp; Time</th>
                  <th className="py-2.5 px-4">Patient</th>
                  <th className="py-2.5 px-4">Requested Lab Panels</th>
                  <th className="py-2.5 px-4">Stage</th>
                  <th className="py-2.5 px-4">TAT Alert</th>
                  <th className="py-2.5 px-4 text-right">Entry / Validate / Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendingTatAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-sm text-emerald-700">
                      All active orders validated within TAT target. No pending TAT alerts.
                    </td>
                  </tr>
                ) : (
                  pendingTatAlerts.map(({ order, tat, hasCritical }) => {
                    const bs = adToBs(order.orderedAt);
                    return (
                      <tr
                        key={order.id}
                        className={
                          tat.status === 'Breached'
                            ? 'bg-rose-50/50 hover:bg-rose-50'
                            : tat.status === 'At Risk'
                            ? 'bg-amber-50/40 hover:bg-amber-50/70'
                            : 'hover:bg-slate-50/70'
                        }
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs font-semibold text-slate-900">
                            {order.accessionNumber}
                            {order.priority === 'STAT' && (
                              <span className="ml-1.5 text-[10px] font-bold text-rose-700">STAT</span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {bs.formattedEn} · {bs.timeEn}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-slate-900">
                            {order.patientName}{' '}
                            <span className="text-xs font-normal text-slate-500">
                              ({order.patientAge} {order.patientAgeType} / {order.patientGender})
                            </span>
                          </div>
                          {hasCritical && (
                            <div className="text-[11px] font-semibold text-rose-700">
                              ▲ CRITICAL / HIGH RISK VALUE
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          <div className="flex flex-wrap gap-1.5">
                            {order.tests.map((t) => (
                              <span key={t.serviceId} className="font-mono font-semibold text-blue-700">
                                {t.serviceCode}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold text-slate-800">
                          {order.status}
                        </td>
                        <td className="py-3 px-4">
                          <TatStatusLabel status={tat.status} label={tat.label} />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {(hasPerm('results.enter') || hasPerm('results.validate')) && (
                              <button
                                type="button"
                                onClick={() => onOpenResults(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                              >
                                <FlaskConical className="w-3 h-3" />
                                {order.status === 'Resulted' ? 'Validate' : 'Enter Results'}
                              </button>
                            )}
                            {hasPerm('reports.print') && (
                              <button
                                type="button"
                                onClick={() => onOpenReport(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap"
                              >
                                <Printer className="w-3 h-3" />
                                Print
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {layoutConfig.title}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {layoutConfig.subtitle} · {bsToday.formattedNp} ({bsToday.formattedEn}) · {activeFiscalYear}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPerm('emergency.view') && (
            <button
              type="button"
              onClick={() => onNavigate('emergency')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 whitespace-nowrap"
            >
              <Siren className="w-3.5 h-3.5" />
              ER &amp; MLC
            </button>
          )}
          {hasPerm('darta.view') && (
            <button
              type="button"
              onClick={() => onNavigate('darta')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <FileText className="w-3.5 h-3.5" />
              Darta/Chalani
            </button>
          )}
          {hasPerm('patients.manage') && (
            <button
              type="button"
              onClick={() => onNavigate('patients')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Patient Intake
            </button>
          )}
          {hasPerm('pos.billing') && (
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Receipt className="w-3.5 h-3.5" />
              Hospital POS
            </button>
          )}
        </div>
      </div>

      {/* Organized 1-Click Hospital Module Quick Directory */}
      {(() => {
        const modEnabled = (modKey?: string) => {
          if (!modKey || !db.saas?.modules) return true;
          const found = db.saas.modules.find((m) => m.key === modKey);
          return found ? found.enabled : true;
        };
        const isAdminUser =
          activeUser?.roleId === 'SUPER_ADMIN' || activeUser?.roleId === 'SAAS_ADMIN';
        const quickModules = [
          {
            id: 'patients',
            title: 'Patient Intake & Stickers',
            sub: 'Register, OPD/ER/Walk-In & Thermal Sticker',
            icon: UserPlus,
            perm: 'patients.manage' as PermissionKey,
            color: 'text-blue-700',
          },
          {
            id: 'pos',
            title: 'Hospital POS',
            sub: 'OPD/ER/Lab/Service Bills',
            icon: Receipt,
            perm: 'pos.billing' as PermissionKey,
            mod: 'pos_billing',
            color: 'text-slate-900',
          },
          {
            id: 'pharmacy',
            title: 'Pharmacy POS',
            sub: 'Dispense, Batches & MRP',
            icon: Pill,
            perm: 'pharmacy.view' as PermissionKey,
            mod: 'pharmacy_erp',
            color: 'text-emerald-700',
          },
          {
            id: 'orders',
            title: 'Lab & Thermal Stickers',
            sub: 'Worklist, Results & Accession Barcode',
            icon: Activity,
            perm: 'orders.view' as PermissionKey,
            color: 'text-indigo-700',
          },
          {
            id: 'radiology',
            title: 'Radiology & Stickers',
            sub: 'X-Ray/CT/USG & Film Labels',
            icon: Scan,
            perm: 'radiology.view' as PermissionKey,
            mod: 'radiology_imaging',
            color: 'text-violet-700',
          },
          {
            id: 'finance',
            title: 'Accounting & Ledger',
            sub: 'Daybook, P&L, Counter Close & Dues',
            icon: Landmark,
            perm: 'finance.view' as PermissionKey,
            mod: 'finance_counter',
            color: 'text-amber-700',
          },
          {
            id: 'mis_reports',
            title: 'MIS Reports',
            sub: 'Printable Hospital Summaries',
            icon: BarChart3,
            perm: 'mis.view' as PermissionKey,
            color: 'text-slate-800',
          },
          {
            id: 'settings',
            title: 'Settings & Sync',
            sub: 'Tariff, Roles, Backup & Printers',
            icon: Settings,
            perm: 'settings.manage' as PermissionKey,
            adminOnly: true,
            color: 'text-slate-700',
          },
        ].filter((m) => (!m.adminOnly || isAdminUser) && hasPerm(m.perm) && modEnabled(m.mod));

        if (quickModules.length === 0) return null;
        return (
          <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Quick Module Directory
              </h2>
              <span className="text-[11px] font-mono text-slate-400">
                {quickModules.length} Core Modules Ready
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {quickModules.map((mod) => {
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => onNavigate(mod.id)}
                    className="text-left p-3 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-blue-50/50 hover:border-blue-300 transition-colors flex flex-col justify-between gap-2"
                  >
                    <Icon className={`w-4 h-4 ${mod.color} shrink-0`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 leading-tight truncate">
                        {mod.title}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                        {mod.sub}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })()}

      {/* Executive Summary Widget */}
      {hasWidget('EXECUTIVE_SUMMARY') && (
        <DashboardWidget db={db} activeFiscalYear={activeFiscalYear} onNavigate={onNavigate} />
      )}

      {/* Live Discount, Credit Limit & Finance Approvals Desk (Admin & Manager) */}
      {isManager && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Live Discount Override, Credit Limit &amp; Finance Approvals
                </h2>
                <p className="text-xs text-slate-500">
                  Policy:{' '}
                  <span className="font-medium text-slate-700">
                    Discount ({db.settings.moduleSettings?.discountApprovalPolicy === 'ADMIN_ONLY' ? 'Admin Only' : 'Manager → Admin'})
                  </span>{' '}
                  ·{' '}
                  <span className="font-medium text-slate-700">
                    Credit ({db.settings.moduleSettings?.creditApprovalPolicy === 'ADMIN_ONLY' ? 'Admin Only' : 'Manager → Admin'})
                  </span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setApprovalTab('PENDING')}
                className={`px-3 py-1.5 rounded-lg font-semibold border ${
                  approvalTab === 'PENDING'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                Pending ({approvalStats.pending.length})
              </button>
              <button
                type="button"
                onClick={() => setApprovalTab('HISTORY')}
                className={`px-3 py-1.5 rounded-lg font-semibold border ${
                  approvalTab === 'HISTORY'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                History ({approvalStats.history.length})
              </button>
              {hasPerm('finance.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('finance')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
                >
                  Open Finance Desk
                  <ArrowRight className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Summary Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-slate-200 border-b border-slate-200 text-xs">
            <div className="bg-white px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Pending Discounts</div>
              <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-0.5">
                {approvalStats.pendingDiscountCount}
              </div>
            </div>
            <div className="bg-white px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Pending Credit Limits</div>
              <div className="text-lg font-bold font-mono tabular-nums text-rose-700 mt-0.5">
                {approvalStats.pendingCreditCount}
              </div>
            </div>
            <div className="bg-white px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">2-Tier Cash Vouchers</div>
              <div className="text-lg font-bold font-mono tabular-nums text-blue-700 mt-0.5">
                {approvalStats.pendingFinanceVouchers.length}
              </div>
            </div>
            <div className="bg-white px-4 py-3">
              <div className="text-[11px] font-medium text-slate-500 uppercase">Total Approved</div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                {approvalStats.approvedCount}
              </div>
            </div>
          </div>

          {/* Pending / History List */}
          <div className="divide-y divide-slate-200 text-xs">
            {(approvalTab === 'PENDING' ? approvalStats.pending : approvalStats.history).length === 0 ? (
              <div className="px-5 py-6 text-center text-slate-500">
                {approvalTab === 'PENDING'
                  ? 'No pending discount override or credit limit approvals right now.'
                  : 'No completed approval history recorded yet.'}
              </div>
            ) : (
              (approvalTab === 'PENDING' ? approvalStats.pending : approvalStats.history)
                .slice(0, 12)
                .map((item) => {
                  const canAct =
                    (item.status === 'PENDING_MANAGER' && isManager) ||
                    (item.status === 'PENDING_ADMIN' && isAdmin);
                  const isBusy = dcBusyId === item.id;
                  const historyOpen = dcHistoryOpenId === item.id;

                  return (
                    <div key={item.id} className="px-5 py-3.5 space-y-2.5 hover:bg-slate-50/70">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1 min-w-[240px] flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{item.requestNumber}</span>
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-bold border ${
                                item.requestType === 'DISCOUNT_OVERRIDE'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-rose-50 text-rose-800 border-rose-200'
                              }`}
                            >
                              {item.requestType === 'DISCOUNT_OVERRIDE' ? 'DISCOUNT' : 'CREDIT LIMIT'}
                            </span>
                            <span className="px-2 py-0.5 rounded font-mono text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                              {item.sourceModule.replace('_', ' ')}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded font-mono text-[10px] font-semibold border ${
                                item.status === 'APPROVED'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : item.status === 'DECLINED'
                                  ? 'bg-rose-50 text-rose-700 border-rose-200'
                                  : item.status === 'PENDING_ADMIN'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                            >
                              {item.status.replace('_', ' ')}
                            </span>
                            <span className="text-[11px] font-mono text-slate-400">
                              {item.approvalPolicy === 'ADMIN_ONLY' ? 'Admin Only' : 'Manager → Admin'}
                            </span>
                          </div>

                          <div className="text-slate-900 font-semibold">
                            {item.patientName}
                            {item.uhid && (
                              <span className="ml-2 font-mono text-[11px] font-semibold text-blue-700">
                                UHID: {item.uhid}
                              </span>
                            )}
                            {item.encounterLabel && (
                              <span className="ml-1.5 font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                                {item.encounterLabel}
                              </span>
                            )}
                          </div>

                          <div className="text-slate-600">
                            Requested by <strong>{item.requesterName}</strong> ({adToBs(item.createdAt).formattedEn} BS) ·{' '}
                            <span className="italic">{item.reason}</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 space-y-1">
                          <div className="text-base font-bold font-mono tabular-nums text-slate-900">
                            {formatNpr(item.requestedValueNpr)}
                            {item.requestedPercent !== undefined && (
                              <span className="ml-1 text-xs font-semibold text-amber-700">
                                ({item.requestedPercent}%)
                              </span>
                            )}
                          </div>
                          {item.billSubtotalNpr !== undefined && (
                            <div className="text-[11px] font-mono text-slate-500">
                              Bill Subtotal: {formatNpr(item.billSubtotalNpr)}
                            </div>
                          )}
                          {item.currentLimitNpr !== undefined && (
                            <div className="text-[11px] font-mono text-slate-500">
                              Current Limit: {formatNpr(item.currentLimitNpr)}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setDcHistoryOpenId(historyOpen ? null : item.id)}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                        >
                          <History className="w-3 h-3" />
                          {historyOpen ? 'Hide Audit History' : `View Audit History (${item.history.length})`}
                        </button>

                        {canAct ? (
                          <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
                            <input
                              value={dcApprovalRemarks[item.id] || ''}
                              onChange={(e) =>
                                setDcApprovalRemarks((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              placeholder="Approval / decline remarks..."
                              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 w-56 text-xs"
                            />
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDcDecision(item, 'APPROVE')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                              {item.status === 'PENDING_MANAGER' && !isAdmin
                                ? 'Verify & Forward to Admin'
                                : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleDcDecision(item, 'DECLINE')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-rose-700 bg-white border border-rose-300 rounded-lg hover:bg-rose-50 disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Decline
                            </button>
                          </div>
                        ) : (
                          <div className="text-[11px] text-slate-500">
                            {item.adminReviewedBy
                              ? `Admin: ${item.adminReviewedBy}${item.adminRemarks ? ` — "${item.adminRemarks}"` : ''}`
                              : item.managerReviewedBy
                              ? `Manager: ${item.managerReviewedBy}${item.managerRemarks ? ` — "${item.managerRemarks}"` : ''}`
                              : 'Awaiting authorized reviewer'}
                          </div>
                        )}
                      </div>

                      {historyOpen && (
                        <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                          {item.history.map((h) => (
                            <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                              <div>
                                <span className="font-mono font-bold text-slate-800">{h.action}</span>{' '}
                                <span className="text-slate-600">by {h.actorName} ({h.actorRole})</span>
                                {h.remarks && <span className="text-slate-700"> — &ldquo;{h.remarks}&rdquo;</span>}
                              </div>
                              <span className="font-mono text-slate-500">
                                {adToBs(h.timestamp).formattedEn} {adToBs(h.timestamp).timeEn}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
            )}
          </div>

          {approvalStats.pendingFinanceVouchers.length > 0 && (
            <div className="px-5 py-2.5 bg-blue-50/70 border-t border-blue-200 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-blue-900 font-medium">
                {approvalStats.pendingFinanceVouchers.length} 2-tier Cash / Expense Voucher approval(s) pending in Finance Desk.
              </span>
              {hasPerm('finance.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('finance')}
                  className="font-semibold text-blue-700 hover:underline"
                >
                  Review Cash Vouchers →
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* Critical Stock Reorder Alert Widget (Lab Reagents + Pharmacy Stock <= Reorder Point) */}
      {hasWidget('LOW_STOCK_ALERTS') && (
        <section
          className={`border rounded-xl overflow-hidden ${
            stats.lowStockAlerts.length > 0
              ? 'bg-rose-50/70 border-rose-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div
            className={`px-5 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
              stats.lowStockAlerts.length > 0
                ? 'bg-rose-100/80 border-rose-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <div className="flex items-center gap-2">
              {stats.lowStockAlerts.length > 0 ? (
                <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0 animate-pulse" />
              ) : (
                <PackageX className="w-4 h-4 text-emerald-700 shrink-0" />
              )}
              <h2
                className={`text-sm font-semibold ${
                  stats.lowStockAlerts.length > 0 ? 'text-rose-950' : 'text-slate-900'
                }`}
              >
                {stats.lowStockAlerts.length > 0
                  ? `CRITICAL STOCK REORDER ALERT (${stats.lowStockAlerts.length} Items Below / At Reorder Point)`
                  : 'Reagent & Pharmacy Stock Reorder Monitor'}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {hasPerm('inventory.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('inventory')}
                  className="px-2.5 py-1 font-medium text-rose-900 bg-white border border-rose-300 rounded-md hover:bg-rose-50"
                >
                  Open Reagents Inventory ({stats.lowStockReagents.length})
                </button>
              )}
              {hasPerm('pharmacy.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('pharmacy')}
                  className="px-2.5 py-1 font-medium text-rose-900 bg-white border border-rose-300 rounded-md hover:bg-rose-50"
                >
                  Open Pharmacy Stock ({stats.lowStockPharmacyItems.length})
                </button>
              )}
            </div>
          </div>

          {stats.lowStockAlerts.length === 0 ? (
            <div className="px-5 py-3 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              All lab reagents and pharmacy medicines are currently above their configured reorder points.
            </div>
          ) : (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
              {stats.lowStockAlerts.slice(0, 9).map((item) => (
                <div
                  key={`${item.source}-${item.id}`}
                  className="p-3 bg-white border border-rose-300 rounded-lg flex items-start justify-between gap-2 shadow-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 text-[9.5px] font-mono font-bold rounded ${
                          item.isOutOfStock
                            ? 'bg-rose-700 text-white'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        {item.isOutOfStock ? 'OUT OF STOCK' : 'CRITICAL LOW'}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">
                        {item.source === 'REAGENT' ? 'LAB REAGENT' : 'PHARMACY'}
                      </span>
                    </div>
                    <div className="font-semibold text-slate-900 truncate mt-1">{item.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{item.sublabel}</div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="text-sm font-bold text-rose-700 tabular-nums">
                      {item.currentStock} {item.unit}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Reorder ≤ {item.reorderLevel}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Priority Clinical, MLC & Expiring Reagent Alerts */}
      {hasWidget('PRIORITY_ALERTS') && (
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <h2 className="text-sm font-semibold text-slate-900">
              Priority Clinical &amp; Compliance Alerts
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {stats.criticalNursingCharts.length} Nursing · {stats.urgentMlcPendingPolice.length} MLC Police · {stats.criticalReagentLots.length} Reagent Lots
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 text-xs">
          {/* 1. Critical Pending Nursing Charts */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <BedDouble className="w-3.5 h-3.5 text-amber-600" />
                Critical / Pending Nursing Charts ({stats.criticalNursingCharts.length})
              </span>
              {hasPerm('hospital.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('ipd')}
                  className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap"
                >
                  Open IPD →
                </button>
              )}
            </div>
            {stats.criticalNursingCharts.length === 0 ? (
              <div className="text-slate-500 py-1">All active inpatients have up-to-date normal nursing charts.</div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {stats.criticalNursingCharts.slice(0, 4).map((item) => (
                  <div key={item.id} className="p-2 rounded-lg bg-amber-50/70 border border-amber-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 truncate">{item.patientName}</span>
                      <span className="font-mono text-[11px] text-slate-700 shrink-0">{item.bedLabel}</span>
                    </div>
                    <div className="text-[11px] text-amber-800 font-medium mt-0.5">{item.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2. Urgent MLC Entries Needing Police Submission */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Siren className="w-3.5 h-3.5 text-rose-600" />
                MLC Needing Police Submission ({stats.urgentMlcPendingPolice.length})
              </span>
              {hasPerm('emergency.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('emergency')}
                  className="text-[11px] font-medium text-rose-700 hover:underline whitespace-nowrap"
                >
                  Inform Police →
                </button>
              )}
            </div>
            {stats.urgentMlcPendingPolice.length === 0 ? (
              <div className="text-slate-500 py-1">All MLC medico-legal entries submitted to local police stations.</div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {stats.urgentMlcPendingPolice.slice(0, 4).map((er) => (
                  <div key={er.id} className="p-2 rounded-lg bg-rose-50/70 border border-rose-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 truncate">{er.patientName}</span>
                      <span className="font-mono text-[11px] font-semibold text-rose-700 shrink-0">
                        {er.mlcNumber || er.erNumber}
                      </span>
                    </div>
                    <div className="text-[11px] text-rose-800 truncate mt-0.5">
                      {er.mlcCaseType || er.chiefComplaint} · {er.policeStationName || 'Police Station Due'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 3. Expiring / Low Reagent Lots */}
          <div className="p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                <FlaskConical className="w-3.5 h-3.5 text-amber-600" />
                Expiring &amp; Low Reagent Lots ({stats.criticalReagentLots.length})
              </span>
              {hasPerm('inventory.view') && (
                <button
                  type="button"
                  onClick={() => onNavigate('inventory')}
                  className="text-[11px] font-medium text-blue-700 hover:underline whitespace-nowrap"
                >
                  Manage Lots →
                </button>
              )}
            </div>
            {stats.criticalReagentLots.length === 0 ? (
              <div className="text-slate-500 py-1">No reagent or film lots expiring within 30 days.</div>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {stats.criticalReagentLots.slice(0, 4).map((lot) => (
                  <div key={lot.id} className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 truncate">{lot.name}</span>
                      <span className="font-mono text-[11px] font-semibold text-amber-700 shrink-0">
                        {lot.daysLeft <= 0 ? 'EXPIRED' : `${lot.daysLeft}d left`}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 mt-0.5">
                      Lot {lot.lotNumber} · {lot.currentStock} {lot.unit}
                      {lot.isLow ? ` (Min ${lot.reorderLevel})` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>
      )}

      {/* Primary KPI Grid */}
      {hasWidget('KPI_GRID') && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Orders &amp; Billing ({activeFiscalYear})</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {stats.totalOrders}
            </span>
            <span className="text-xs font-mono text-slate-500">
              {stats.validatedCount} validated
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-600 font-mono">
            Sales: {formatNpr(stats.totalRevenue)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Cash &amp; Bank Treasury</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-xl font-semibold font-mono tabular-nums text-slate-900">
              {formatNpr(stats.totalCashBank)}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Across {db.accounts.length} Cash &amp; Bank A/Cs
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">TAT SLA Compliance</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {stats.slaPercent}%
            </span>
            <span
              className={`text-xs font-mono font-medium ${
                stats.breachedCount > 0 ? 'text-rose-700' : 'text-emerald-700'
              }`}
            >
              {stats.breachedCount} breached · {stats.atRiskCount} risk
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {stats.pendingValidation} pending sign-off ({stats.criticalFindings} critical)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Registered UHID Patients</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {stats.totalPatientsCount}
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500 font-mono">
            OPD Consults: {stats.totalOpdCount}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Reagent &amp; Film Alerts</div>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xl font-semibold font-mono tabular-nums text-slate-900">
              {stats.lowStockReagents.length + stats.expiringSoonReagents.length}
            </span>
            <span className="text-xs font-mono text-amber-700">
              {stats.lowStockReagents.length} low · {stats.expiringSoonReagents.length} exp ≤30d
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">Clinical inventory separated from Pharmacy</div>
        </div>
      </div>
      )}

      {/* Hospital Clinical Operations & Separate POS Strip */}
      {hasWidget('CLINICAL_OPS') && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('pharmacy')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-400 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Pharmacy POS (Separate)</span>
            <Pill className="w-3.5 h-3.5 text-emerald-600" />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-emerald-700 mt-1.5">
            {formatNpr(stats.pharmacySalesNpr)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.pharmacyBillCount} Pharmacy POS bills (separate inventory)
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('ipd')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-400 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>IPD Bed Summary</span>
            <BedDouble className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {stats.occupiedBeds} / {stats.totalBeds} Occupied
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.availableBeds} vacant beds · Nursing Charts &amp; Certificates
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('ot')}
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-400 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>OT &amp; Anesthesia</span>
            <Scissors className="w-3.5 h-3.5 text-indigo-600" />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {stats.inProgressOtCount} Live · {stats.scheduledOtCount} Queued
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.completedOtCount} completed · Checklist, Airway &amp; PACU
          </div>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('emergency')}
          className={`text-left border rounded-xl p-4 transition-colors ${
            stats.mlcPendingPolice > 0
              ? 'bg-rose-50/70 border-rose-200 hover:border-rose-400'
              : 'bg-white border-slate-200 hover:border-blue-400'
          }`}
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-600">
            <span>ER &amp; MLC Police Desk</span>
            <Siren className="w-3.5 h-3.5 text-rose-600" />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {stats.activeErCount} Active ER
          </div>
          <div
            className={`text-xs mt-1 font-medium ${
              stats.mlcPendingPolice > 0 ? 'text-rose-700' : 'text-slate-500'
            }`}
          >
            {stats.mlcPendingPolice > 0
              ? `${stats.mlcPendingPolice} MLC pending police intimation`
              : 'All MLC police intimations logged'}
          </div>
        </button>

        <button
          type="button"
          onClick={() =>
            onNavigate(hasPerm('admin.control') ? 'admin_control' : 'referrals')
          }
          className="text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-blue-400 transition-colors"
        >
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Admin Approvals &amp; Darta</span>
            <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-slate-900 mt-1.5">
            {stats.pendingPayoutReqs} Payouts Pending
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {stats.dartaChalaniCount} Darta-Chalani records · HMIS Bode Barsain
          </div>
        </button>
      </div>
      )}

      {/* Live Referred Hospital Manager Call & WhatsApp Alert Panel */}
      {(referredPatientsSummary.rows.length > 0 || hasPerm('referrals.view')) && (
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-rose-50/70 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Ambulance className="w-4 h-4 text-rose-600 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Referred Patients — Receiving Hospital Manager Call &amp; WhatsApp Desk
                </h2>
                <p className="text-xs text-slate-600">
                  Call receiving hospital manager immediately and dispatch clinical/treatment &amp; ambulance alert via WhatsApp (no prices/quantities shown).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
              <span className="px-2.5 py-1 rounded-md bg-white border border-rose-200 text-rose-800 font-semibold">
                Pending Call: {referredPatientsSummary.pendingCallCount}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-800">
                Weekly (7d): {referredPatientsSummary.weeklyCount}
              </span>
              <span className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-800">
                Monthly (30d): {referredPatientsSummary.monthlyCount}
              </span>
              <button
                type="button"
                onClick={() => onNavigate('referrals')}
                className="px-2.5 py-1 rounded-md bg-blue-600 text-white font-sans font-semibold hover:bg-blue-700"
              >
                Referrals Master →
              </button>
            </div>
          </div>

          {referredPatientsSummary.rows.length === 0 ? (
            <div className="px-5 py-4 text-xs text-slate-500">
              No patients referred to external hospitals yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 text-xs">
              {referredPatientsSummary.rows.slice(0, 6).map((item) => {
                const ext = item.ext;
                const clinicalNames =
                  ext.clinicalTreatmentItems && ext.clinicalTreatmentItems.length > 0
                    ? ext.clinicalTreatmentItems.map((c) => `${c.description} (${c.category})`)
                    : (ext.attachedBilledItems || []).map((b) => `${b.description} (${b.category})`);
                const mgrDigits = (ext.referredHospitalManagerPhone || '').replace(/[^\d]/g, '');
                const formattedWaPhone = mgrDigits.startsWith('977')
                  ? mgrDigits
                  : mgrDigits.length === 10
                  ? `977${mgrDigits}`
                  : mgrDigits;
                const bsRef = adToBs(item.referredAt);
                const waText = [
                  `*URGENT PATIENT REFERRAL — ${db.settings.labName || 'Saptari Hospital'}*`,
                  `Receiving Hospital: ${ext.referredToHospital}${ext.referredToPlace ? ` (${ext.referredToPlace})` : ''}`,
                  ext.referredHospitalManagerName ? `Attention Manager: ${ext.referredHospitalManagerName}` : '',
                  `Patient: ${item.patientName}${item.uhid ? ` | UHID: ${item.uhid}` : ''} (${item.sourceType} ${item.encounterNumber})`,
                  `Date/Time: ${bsRef.formattedEn} BS (${bsRef.timeEn})`,
                  `Condition/Reason: ${ext.conditionAtReferral || 'Referred'} — ${ext.referralReason || ''}`,
                  `Ambulance: ${ext.ambulanceName || ext.transportMode}${ext.ambulanceNumber ? ` [${ext.ambulanceNumber}]` : ''}${ext.ambulanceDriverName ? ` · Driver: ${ext.ambulanceDriverName} ${ext.ambulanceDriverPhone || ''}` : ''}`,
                  clinicalNames.length > 0
                    ? `Treatments / Tests / Medicines Given: ${clinicalNames.slice(0, 10).join(', ')}`
                    : '',
                ]
                  .filter(Boolean)
                  .join('\n');
                const waUrl = formattedWaPhone
                  ? `https://wa.me/${formattedWaPhone}?text=${encodeURIComponent(waText)}`
                  : `https://wa.me/?text=${encodeURIComponent(waText)}`;

                return (
                  <div key={`${item.sourceType}-${item.sourceId}`} className="px-5 py-3.5 flex flex-wrap items-start justify-between gap-4 hover:bg-slate-50/70">
                    <div className="space-y-1 flex-1 min-w-[260px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">
                          {item.patientName}
                        </span>
                        {item.uhid && (
                          <span className="font-mono text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                            {item.uhid}
                          </span>
                        )}
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {item.sourceType} · {item.encounterNumber}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {bsRef.formattedEn} {bsRef.timeEn}
                        </span>
                      </div>
                      <div className="text-slate-800">
                        Referred To: <strong>{ext.referredToHospital}</strong> ({ext.referredToPlace}) ·{' '}
                        Manager: <strong>{ext.referredHospitalManagerName || 'Hospital Desk'}</strong>{' '}
                        <span className="font-mono text-emerald-700">
                          {ext.referredHospitalManagerPhone || 'No phone saved'}
                        </span>
                      </div>
                      <div className="text-slate-600">
                        Ambulance: <strong>{ext.ambulanceName || ext.transportMode}</strong>{' '}
                        {ext.ambulanceNumber && (
                          <span className="font-mono font-semibold text-rose-700">
                            [{ext.ambulanceNumber}]
                          </span>
                        )}
                        {ext.ambulanceDriverName && ` · Driver: ${ext.ambulanceDriverName} (${ext.ambulanceDriverPhone || ''})`}
                      </div>
                      {clinicalNames.length > 0 && (
                        <div className="text-[11px] text-slate-700 bg-slate-50 border border-slate-200 rounded px-2 py-1 mt-1">
                          <strong>Given Summary (No Price/Qty):</strong>{' '}
                          {clinicalNames.slice(0, 8).join(' · ')}
                          {clinicalNames.length > 8 ? ` (+${clinicalNames.length - 8} more)` : ''}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {ext.managerNotifiedCalled ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Called ({ext.managerCalledBy || 'Staff'})
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={callAckBusyId === `${item.sourceType}-${item.sourceId}`}
                          onClick={async () => {
                            const key = `${item.sourceType}-${item.sourceId}`;
                            setCallAckBusyId(key);
                            try {
                              const resp = await apiRequest<{ db: LimsDatabase }>(
                                '/api/referrals/call-ack',
                                activeUserId,
                                {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    sourceType: item.sourceType,
                                    sourceId: item.sourceId,
                                  }),
                                }
                              );
                              onUpdated(resp.db, `Confirmed phone call to ${ext.referredHospitalManagerName || ext.referredToHospital}.`);
                            } catch (err: any) {
                              onUpdated(db, err?.message || 'Call confirmation failed.');
                            } finally {
                              setCallAckBusyId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          Mark Manager Called
                        </button>
                      )}
                      <a
                        href={waUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          void apiRequest<{ db: LimsDatabase }>('/api/referrals/call-ack', activeUserId, {
                            method: 'POST',
                            body: JSON.stringify({
                              sourceType: item.sourceType,
                              sourceId: item.sourceId,
                              markWhatsapp: true,
                            }),
                          })
                            .then((r) => onUpdated(r.db, `WhatsApp alert opened for ${ext.referredHospitalManagerName || ext.referredToHospital}.`))
                            .catch(() => {});
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        Send WhatsApp to Manager
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Shift Handover & Quick Staff QR Clock-In / Clock-Out */}
      {(hasWidget('SHIFT_HANDOVER') || hasWidget('QR_ATTENDANCE')) && (
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Shift Handover Console (Outgoing Submit + Incoming Accept/Revision + Audit Trail) */}
        <section className="xl:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-blue-600 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Shift Handover &amp; Pending Task Audit Trail
                </h2>
                <p className="text-[11px] text-slate-500">
                  Outgoing staff submit pending tasks; incoming staff Accept or Request Revision with audit log.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowHandoverForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <Send className="w-3.5 h-3.5" />
                {showHandoverForm ? 'Close Form' : 'Submit Handover'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('personnel')}
                className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
              >
                HR Register →
              </button>
            </div>
          </div>

          {showHandoverForm && (
            <form
              onSubmit={handleSubmitHandover}
              className="p-4 border-b border-slate-200 bg-blue-50/40 space-y-3 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">From Shift</label>
                  <select
                    value={hoFromShift}
                    onChange={(e) => setHoFromShift(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                    <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                    <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">To Shift</label>
                  <select
                    value={hoToShift}
                    onChange={(e) => setHoToShift(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
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
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Incoming Staff</label>
                  <select
                    value={hoIncomingStaffId}
                    onChange={(e) => setHoIncomingStaffId(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">Any Incoming Duty Staff</option>
                    {db.staff.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.fullName} ({st.department})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">
                    Summary &amp; Clinical Notes *
                  </label>
                  <input
                    required
                    value={hoSummaryNotes}
                    onChange={(e) => setHoSummaryNotes(e.target.value)}
                    placeholder="Critical ward beds, STAT lab follow-ups, ER triage status..."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pending Tasks</label>
                  <input
                    value={hoPendingTasks}
                    onChange={(e) => setHoPendingTasks(e.target.value)}
                    placeholder="IV doses due, MLC form, POS cash tally..."
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  value={hoCashKeys}
                  onChange={(e) => setHoCashKeys(e.target.value)}
                  placeholder="Cash drawer / ward keys status"
                  className="flex-1 min-w-[200px] px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                />
                <button
                  type="submit"
                  disabled={submittingHo}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  {submittingHo ? 'Submitting...' : 'Submit Handover'}
                </button>
              </div>
            </form>
          )}

          <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto text-xs">
            {(db.shiftHandovers || []).length === 0 ? (
              <div className="p-6 text-center text-slate-500">
                No shift handovers recorded yet. Click &ldquo;Submit Handover&rdquo; to log outgoing shift tasks.
              </div>
            ) : (
              (db.shiftHandovers || []).slice(0, 6).map((ho) => {
                const trail = ho.auditTrail || [];
                const isAuditOpen = expandedAuditHoId === ho.id;
                const isRevOpen = revisionTargetId === ho.id;
                return (
                  <div key={ho.id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 flex-1 min-w-[220px]">
                        <div className="flex flex-wrap items-center gap-2 font-mono">
                          <span className="font-bold text-slate-900">{ho.handoverNumber}</span>
                          <span className="text-slate-500">{ho.bsDate} BS</span>
                          <span className="text-blue-700 font-semibold">
                            {ho.department}: {ho.fromShift} → {ho.toShift}
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
                              ? 'ACCEPTED'
                              : ho.status === 'REVISION_REQUESTED'
                              ? 'REVISION REQUESTED'
                              : 'PENDING ACCEPTANCE'}
                          </span>
                        </div>
                        <div className="text-slate-800 font-medium">{ho.summaryNotes}</div>
                        <div className="text-[11px] text-slate-600">
                          Outgoing: <strong>{ho.outgoingStaffName}</strong> · Target:{' '}
                          <strong>{ho.incomingStaffName}</strong> · Pending Tasks:{' '}
                          <span className="font-medium text-slate-800">{ho.pendingTasks}</span>
                        </div>
                        {ho.revisionNote && (
                          <div className="p-2 rounded bg-rose-50 border border-rose-200 text-[11px] text-rose-800">
                            <strong>Revision Requested:</strong> {ho.revisionNote}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        {ho.status !== 'RECEIVED_APPROVED' && (
                          <>
                            <button
                              type="button"
                              disabled={respondingHoId === ho.id}
                              onClick={() => void handleRespondHandover(ho.id, 'ACCEPT')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Accept
                            </button>
                            <button
                              type="button"
                              disabled={respondingHoId === ho.id}
                              onClick={() => {
                                setRevisionTargetId(isRevOpen ? null : ho.id);
                                setRevisionComment(ho.revisionNote || '');
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Request Revision
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setExpandedAuditHoId(isAuditOpen ? null : ho.id)}
                          className="inline-flex items-center gap-1 px-2 py-1.5 font-mono text-[11px] text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200"
                        >
                          <History className="w-3 h-3" />
                          Audit ({trail.length})
                        </button>
                      </div>
                    </div>

                    {isRevOpen && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          value={revisionComment}
                          onChange={(e) => setRevisionComment(e.target.value)}
                          placeholder="Specify missing task detail, cash count discrepancy, or ward clarification..."
                          className="flex-1 min-w-[220px] px-2.5 py-1.5 border border-rose-300 rounded-lg bg-white"
                        />
                        <button
                          type="button"
                          disabled={respondingHoId === ho.id || !revisionComment.trim()}
                          onClick={() =>
                            void handleRespondHandover(ho.id, 'REQUEST_REVISION', revisionComment)
                          }
                          className="px-3 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                        >
                          Send Revision Request
                        </button>
                      </div>
                    )}

                    {isAuditOpen && (
                      <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                        <div className="font-mono text-[10px] font-bold text-slate-500 uppercase">
                          Handover Audit Trail
                        </div>
                        {trail.length === 0 ? (
                          <div className="text-[11px] text-slate-500">
                            Submitted on {new Date(ho.createdAt).toLocaleString()} by {ho.outgoingStaffName}.
                          </div>
                        ) : (
                          trail.map((ev) => (
                            <div
                              key={ev.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-[11px] border-t border-slate-200/70 pt-1 first:border-t-0 first:pt-0"
                            >
                              <div>
                                <span className="font-mono font-bold text-slate-800">{ev.action}</span>{' '}
                                by <strong>{ev.actorName}</strong>
                                {ev.note ? ` — ${ev.note}` : ''}
                              </div>
                              <span className="font-mono text-slate-500">
                                {new Date(ev.timestamp).toLocaleString()}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Quick Staff QR Attendance Clock-In / Clock-Out */}
        <section className="xl:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <QrCode className="w-4 h-4 text-indigo-600 shrink-0" />
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Quick Staff QR Clock-In / Clock-Out
                </h2>
                <p className="text-[11px] text-slate-500">
                  Unique staff QR attendance synced directly with HR Attendance History
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('personnel')}
              className="text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Calendar History →
            </button>
          </div>

          <div className="p-4 space-y-3.5 text-xs flex-1">
            {activeUser && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div className="p-1.5 bg-white border border-slate-200 rounded-lg shrink-0">
                  <QrCodeSvg value={personalStaffQrToken} size={68} />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <div className="font-semibold text-slate-900 truncate">{activeUser.fullName}</div>
                    <div className="font-mono text-[10px] text-slate-500 truncate">
                      {personalStaffQrToken}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={qrPunchBusy}
                      onClick={() => void handleQuickQrPunch(personalStaffQrToken, 'CHECK_IN')}
                      className="px-2.5 py-1 font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Scan My QR: In
                    </button>
                    <button
                      type="button"
                      disabled={qrPunchBusy}
                      onClick={() => void handleQuickQrPunch(personalStaffQrToken, 'CHECK_OUT')}
                      className="px-2.5 py-1 font-semibold text-amber-800 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 disabled:opacity-50"
                    >
                      Clock Out
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="block font-medium text-slate-700">
                Scan Any Staff QR Badge / Employee Code
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  value={qrScanInput}
                  onChange={(e) => setQrScanInput(e.target.value)}
                  data-enter-submit="true"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleQuickQrPunch();
                    }
                  }}
                  placeholder="Scan SAPTARI-STAFF-... or SAP-001"
                  className="flex-1 min-w-[160px] px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
                <select
                  value={qrPunchType}
                  onChange={(e) => setQrPunchType(e.target.value as 'CHECK_IN' | 'CHECK_OUT')}
                  className="px-2 py-1.5 border border-slate-300 rounded-lg bg-white font-mono"
                >
                  <option value="CHECK_IN">CHECK_IN</option>
                  <option value="CHECK_OUT">CHECK_OUT</option>
                </select>
                <button
                  type="button"
                  disabled={qrPunchBusy}
                  onClick={() => void handleQuickQrPunch()}
                  className="px-3 py-1.5 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  Punch QR
                </button>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-2.5 space-y-1.5">
              <div className="font-semibold text-slate-700">Latest Attendance Punches</div>
              {(db.attendanceLogs || []).slice(0, 4).map((att) => (
                <div
                  key={att.id}
                  className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-slate-100 last:border-b-0"
                >
                  <div className="min-w-0 truncate">
                    <strong className="text-slate-900">{att.staffName}</strong>{' '}
                    <span className="font-mono text-slate-500">({att.mode})</span>
                    {att.isManualOverride && (
                      <span className="ml-1 px-1 py-0.5 rounded bg-amber-100 text-amber-800 font-mono text-[9px] font-bold">
                        OVR
                      </span>
                    )}
                  </div>
                  <div className="font-mono shrink-0 flex items-center gap-2">
                    <span className={att.punchType === 'CHECK_IN' ? 'text-emerald-700 font-semibold' : 'text-amber-700 font-semibold'}>
                      {att.punchType === 'CHECK_IN' ? 'IN' : 'OUT'}
                    </span>
                    <span className="text-slate-500">
                      {new Date(att.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {(db.attendanceLogs || []).length === 0 && (
                <div className="text-[11px] text-slate-500">No attendance punches recorded yet.</div>
              )}
            </div>
          </div>
        </section>
      </div>
      )}

      {/* Admin WhatsApp Daily Sales Digest Strip */}
      {hasWidget('WHATSAPP_DIGEST') && (
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4 h-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">
              Daily Sales Digest → Admin WhatsApp ({db.settings.adminWhatsAppNumber})
            </div>
            <div className="text-xs text-slate-500 font-mono">
              Active Cycle ({stats.dailyOrderCount} orders): Total {formatNpr(stats.dailySalesNpr)} ·
              Cash {formatNpr(stats.dailyCashNpr)} · Bank/QR {formatNpr(stats.dailyBankNpr)}
              {db.settings.autoSendDailySalesWhatsApp
                ? ` · Auto-schedule ${db.settings.dailySalesWhatsAppTime}`
                : ''}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lastWaUrl && (
            <a
              href={lastWaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open WhatsApp Chat
            </a>
          )}
          <button
            type="button"
            disabled={sendingWa}
            onClick={handleSendDailyWhatsApp}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {sendingWa ? 'Sending Summary...' : 'Send Daily Sales to WhatsApp'}
          </button>
        </div>
      </div>
      )}

      {/* Recharts Analytics Row */}
      {hasWidget('ANALYTICS_CHARTS') && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Daily Revenue Trend ({activeFiscalYear})
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nepalese Rupees (रू) billed per day across Hospital POS Counters
              </p>
            </div>
            <span className="text-xs font-mono text-blue-700 font-semibold">
              {formatNpr(stats.totalRevenue)}
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `रू${Math.round(v / 1000)}k`}
                  width={54}
                />
                <Tooltip
                  formatter={(value: any) => [formatNpr(Number(value) || 0), 'Daily Revenue']}
                  labelFormatter={(label, payload) =>
                    payload?.[0]?.payload?.bsDate
                      ? `${label} (${payload[0].payload.bsDate})`
                      : String(label)
                  }
                  contentStyle={{
                    fontSize: '12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenueNpr"
                  name="Daily Revenue (रू)"
                  stroke="#2563eb"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#revFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Pending vs. Completed Order Volume
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Daily diagnostic turnaround throughput (Pending Bench vs. Validated Reports)
              </p>
            </div>
            <span className="text-xs font-mono text-slate-600">
              {stats.validatedCount} Done · {stats.totalOrders - stats.validatedCount} Pending
            </span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartSeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={{ stroke: '#cbd5e1' }}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  labelFormatter={(label, payload) =>
                    payload?.[0]?.payload?.bsDate
                      ? `${label} (${payload[0].payload.bsDate})`
                      : String(label)
                  }
                  contentStyle={{
                    fontSize: '12px',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Bar
                  dataKey="completedOrders"
                  name="Completed (Validated)"
                  fill="#059669"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="pendingOrders"
                  name="Pending (In Lab / Ordered)"
                  fill="#f59e0b"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      )}

      {/* Main Split */}
      {(hasWidget('TAT_WORKBENCH') || hasWidget('REFERRALS_AND_REAGENTS')) && (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {hasWidget('TAT_WORKBENCH') && (
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Live TAT &amp; Diagnostic Workbench
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Orders sorted by nearest Turnaround Time deadline
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('orders')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
            >
              Open Full Queue
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50/70">
                  <th className="py-2.5 px-4">Accession &amp; BS Date</th>
                  <th className="py-2.5 px-4">Patient &amp; Encounter</th>
                  <th className="py-2.5 px-4">Stage</th>
                  <th className="py-2.5 px-4">TAT Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {activeWatchlist.map((order) => {
                  const tat = computeOrderTat(order);
                  const bs = adToBs(order.orderedAt);
                  return (
                    <tr key={order.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs font-semibold text-slate-900">
                          {order.accessionNumber}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {bs.formattedEn} · {formatNpr(order.totalAmount)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">
                          {order.patientName}{' '}
                          <span className="text-xs font-normal text-slate-500">
                            ({order.patientAge} {order.patientAgeType})
                          </span>
                        </div>
                        <div className="text-xs font-mono text-slate-500 truncate max-w-[220px]">
                          {order.uhid ? `${order.uhid} · ` : ''}
                          {order.encounterLabel || order.encounterType || 'Hospital Counter'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs font-medium text-slate-700">
                        {order.status}
                      </td>
                      <td className="py-3 px-4">
                        <TatStatusLabel status={tat.status} label={tat.label} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {(hasPerm('results.enter') || hasPerm('results.validate')) && (
                            <button
                              type="button"
                              onClick={() => onOpenResults(order)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                            >
                              <FlaskConical className="w-3 h-3" />
                              {order.status === 'Validated' || order.status === 'Dispatched' ? 'Inspect' : 'Results'}
                            </button>
                          )}
                          {hasPerm('reports.print') && (
                            <button
                              type="button"
                              onClick={() => onOpenReport(order, true)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap"
                            >
                              <Printer className="w-3 h-3" />
                              1-Click Print
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* Right Column */}
        {hasWidget('REFERRALS_AND_REAGENTS') && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Share2 className="w-3.5 h-3.5 text-blue-600" />
                Most Frequent Patient Referrals
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('referrals')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Referrals →
              </button>
            </div>
            <div className="space-y-3">
              {stats.frequentReferrals.slice(0, 5).map((ref, idx) => (
                <div key={ref.id} className="flex items-center justify-between gap-2 text-xs pb-2 border-b border-slate-100 last:border-b-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 truncate">
                      {idx + 1}. {ref.name}
                    </div>
                    <div className="text-[11px] text-slate-500">{ref.type}</div>
                  </div>
                  <div className="text-right font-mono shrink-0">
                    <div className="font-bold text-slate-900">{ref.orderCount} Referrals</div>
                    <div className="text-[11px] text-emerald-700">{formatNpr(ref.totalReferredSales)}</div>
                  </div>
                </div>
              ))}
              {stats.frequentReferrals.length === 0 && (
                <div className="text-xs text-slate-500">No referral partners configured yet.</div>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Reagent &amp; Expiry Watch</h2>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-medium text-blue-700 hover:underline"
              >
                Inventory ERP
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {db.reagents
                .filter((r) => {
                  const days = Math.ceil(
                    (new Date(r.expiryDate).getTime() - Date.now()) / (86400 * 1000)
                  );
                  return r.currentStock <= r.reorderLevel || days <= 30;
                })
                .map((r) => {
                  const daysLeft = Math.ceil(
                    (new Date(r.expiryDate).getTime() - Date.now()) / (86400 * 1000)
                  );
                  const isLow = r.currentStock <= r.reorderLevel;
                  return (
                    <div key={r.id} className="py-2.5 first:pt-0 last:pb-0 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-slate-900">{r.name}</span>
                        <span className="font-mono text-amber-700 shrink-0 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          {isLow ? 'Low Stock' : `Exp ${daysLeft}d`}
                        </span>
                      </div>
                      <div className="text-slate-500 font-mono mt-0.5 flex items-center justify-between">
                        <span>
                          Stock: {r.currentStock} {r.unit} (Min {r.reorderLevel})
                        </span>
                        <span>Lot: {r.lotNumber}</span>
                      </div>
                    </div>
                  );
                })}
              {stats.lowStockReagents.length === 0 && stats.expiringSoonReagents.length === 0 && (
                <div className="py-3 text-xs text-slate-500 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-emerald-600" />
                  All reagent lots healthy.
                </div>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
      )}
    </div>
  );
}
