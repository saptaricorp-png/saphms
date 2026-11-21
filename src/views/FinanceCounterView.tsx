import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  BedDouble,
  Building2,
  Calendar,
  Check,
  CheckCheck,
  Clock,
  CreditCard,
  Edit3,
  FileDown,
  History,
  Landmark,
  Lock,
  Package,
  Percent,
  Plus,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import type {
  BankCashAccount,
  DiscountCreditApprovalRequest,
  FinanceApprovalRequest,
  FinanceApprovalTransactionType,
  HospitalAsset,
  LimsDatabase,
  PermissionKey,
  PharmacySupplier,
  StaffMember,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { computeIpdDailyAutoCharges } from '../utils/clinical';
import { downloadFinancialBreakdownPdf } from '../utils/pdfGenerator';
import { apiRequest } from '../api/client';

interface FinanceCounterViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

interface ApprovalQueueSummary {
  pendingManagerCount: number;
  pendingAdminCount: number;
  pendingForMeCount: number;
  totalPendingCount: number;
  declinedCount: number;
  approvedCount: number;
  pendingInflowNpr: number;
  pendingOutflowNpr: number;
}

interface ApprovalPollResponse {
  items: FinanceApprovalRequest[];
  summary: ApprovalQueueSummary;
  actorPermissions: {
    canApproveManager: boolean;
    canApproveAdmin: boolean;
  };
}

type QueueTab = 'PENDING' | 'DECLINED' | 'APPROVED';
type PendingStageFilter = 'ALL_PENDING' | 'PENDING_MANAGER' | 'PENDING_ADMIN';

function formatShortTimestamp(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function actionLabel(action: string): string {
  switch (action) {
    case 'REQUESTED':
      return 'Requested';
    case 'APPROVED_BY_MANAGER':
      return 'Approved by Manager';
    case 'APPROVED_BY_ADMIN':
      return 'Approved by Admin';
    case 'DECLINED':
      return 'Declined';
    case 'RE_REQUESTED':
      return 'Re-Requested / Re-Applied';
    default:
      return action;
  }
}

export function FinanceCounterView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: FinanceCounterViewProps) {
  const canManageFinance = hasPerm('finance.manage');
  const canCloseCounter = hasPerm('counter.close');
  const isBillingReportOnly = activeUser.roleId === 'BILLING_REPORT' && !canManageFinance;
  const isAdmin = hasPerm('finance.approve_admin') || activeUser.roleId === 'SUPER_ADMIN';
  const isManager = hasPerm('finance.approve_manager') || isAdmin;

  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [financeViewTab, setFinanceViewTab] = useState<
    | 'LEDGER'
    | 'VOUCHERS'
    | 'COUNTER_CLOSE'
    | 'PNL'
    | 'PARTIES_DUES'
    | 'ASSETS'
    | 'DISCOUNT_CREDIT'
    | 'DAILY_AUTO_CHARGES'
  >('LEDGER');
  const [ledgerDirectionFilter, setLedgerDirectionFilter] = useState<'ALL' | 'INFLOW' | 'OUTFLOW'>('ALL');
  const [ledgerCategoryFilter, setLedgerCategoryFilter] = useState<string>('ALL');
  const [ledgerStartDate, setLedgerStartDate] = useState<string>('');
  const [ledgerEndDate, setLedgerEndDate] = useState<string>('');
  const [dueScopeFilter, setDueScopeFilter] = useState<'ALL' | 'HOSPITAL' | 'PHARMACY'>('ALL');
  const [dueSearch, setDueSearch] = useState('');
  const [supplierSearch, setSupplierSearch] = useState('');
  const [supplierOnlyDue, setSupplierOnlyDue] = useState(false);
  const [collectDueTarget, setCollectDueTarget] = useState<{
    kind: 'HOSPITAL' | 'PHARMACY';
    id: string;
    ref: string;
    patientName: string;
    uhid: string;
    dueNpr: number;
  } | null>(null);
  const [collectDueAmount, setCollectDueAmount] = useState('');
  const [collectDueMode, setCollectDueMode] = useState<'Cash' | 'Bank / QR'>('Cash');
  const [collectDueAccountId, setCollectDueAccountId] = useState(
    () => db.accounts.find((a) => a.type === 'BANK')?.id || db.accounts[0]?.id || ''
  );
  const [collectDueNote, setCollectDueNote] = useState('');
  const [collectingDue, setCollectingDue] = useState(false);
  const [autoChargeStartDate, setAutoChargeStartDate] = useState(() =>
    new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)
  );
  const [autoChargeEndDate, setAutoChargeEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [autoChargeSearch, setAutoChargeSearch] = useState('');

  // Hospital Assets CRUD state
  const [assetModalOpen, setAssetModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<HospitalAsset | null>(null);
  const [astCode, setAstCode] = useState('');
  const [astName, setAstName] = useState('');
  const [astCategory, setAstCategory] = useState<HospitalAsset['category']>('Medical Equipment');
  const [astScope, setAstScope] = useState<HospitalAsset['departmentScope']>('HOSPITAL');
  const [astLocation, setAstLocation] = useState('');
  const [astPurchaseDate, setAstPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [astPurchaseCost, setAstPurchaseCost] = useState('');
  const [astCurrentValue, setAstCurrentValue] = useState('');
  const [astVendor, setAstVendor] = useState('');
  const [astWarranty, setAstWarranty] = useState('');
  const [astStatus, setAstStatus] = useState<HospitalAsset['status']>('Active');
  const [astNotes, setAstNotes] = useState('');
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);

  // Party / Supplier Ledger & Pay Due state
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<PharmacySupplier | null>(null);
  const [supCode, setSupCode] = useState('');
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supPanVat, setSupPanVat] = useState('');
  const [supTerms, setSupTerms] = useState<PharmacySupplier['paymentTerms']>('Credit 30 Days');
  const [supCreditDays, setSupCreditDays] = useState('30');
  const [supOpeningDue, setSupOpeningDue] = useState('0');
  const [payDueTarget, setPayDueTarget] = useState<PharmacySupplier | null>(null);
  const [payDueAmount, setPayDueAmount] = useState('');
  const [payDueAccountId, setPayDueAccountId] = useState(db.accounts[0]?.id || '');
  const [payDueRef, setPayDueRef] = useState('');
  const [payDueNotes, setPayDueNotes] = useState('');

  // Discount & Credit Limit Approval Queue state
  const [dcFilter, setDcFilter] = useState<'PENDING' | 'APPROVED' | 'DECLINED' | 'ALL'>('PENDING');
  const [dcRemarksMap, setDcRemarksMap] = useState<Record<string, string>>({});
  const [dcBusyId, setDcBusyId] = useState<string | null>(null);
  const [dcHistoryId, setDcHistoryId] = useState<string | null>(null);

  const [showAddAcc, setShowAddAcc] = useState(false);
  const [accCode, setAccCode] = useState('');
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<BankCashAccount['type']>('BANK');
  const [accScope, setAccScope] = useState<'HOSPITAL' | 'PHARMACY' | 'SHARED'>('HOSPITAL');
  const [accNumber, setAccNumber] = useState('');
  const [accBalance, setAccBalance] = useState('0');
  const [accountScopeFilter, setAccountScopeFilter] = useState<'ALL' | 'HOSPITAL' | 'PHARMACY'>('ALL');

  const [vchType, setVchType] = useState<FinanceApprovalTransactionType>('EXPENSE');
  const [vchAccountId, setVchAccountId] = useState(db.accounts[0]?.id || '');
  const [vchTargetId, setVchTargetId] = useState(
    db.accounts.find((a) => a.type === 'BANK')?.id || ''
  );
  const [vchAmount, setVchAmount] = useState('');
  const [vchReason, setVchReason] = useState('');
  const [vchPayee, setVchPayee] = useState('');
  const [vchDesc, setVchDesc] = useState('');

  // Approval Queue Polling & UI State
  const [polledItems, setPolledItems] = useState<FinanceApprovalRequest[]>(
    () => db.financeApprovalRequests || []
  );
  const [polledSummary, setPolledSummary] = useState<ApprovalQueueSummary | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string>('');
  const [isPolling, setIsPolling] = useState(false);

  const [queueTab, setQueueTab] = useState<QueueTab>('PENDING');
  const [stageFilter, setStageFilter] = useState<PendingStageFilter>(() =>
    isAdmin ? 'PENDING_ADMIN' : 'PENDING_MANAGER'
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logsSearch, setLogsSearch] = useState('');
  const [logsFilter, setLogsFilter] = useState<string>('ALL');

  // Decline modal state (replaces window.prompt)
  const [declineTarget, setDeclineTarget] = useState<{
    mode: 'SINGLE' | 'BULK';
    ids: string[];
    title: string;
  } | null>(null);
  const [declineNote, setDeclineNote] = useState('');

  // Re-Request inline edit state
  const [reRequestEditId, setReRequestEditId] = useState<string | null>(null);
  const [reReqAmount, setReReqAmount] = useState('');
  const [reReqReason, setReReqReason] = useState('');
  const [reReqDesc, setReReqDesc] = useState('');
  const [reReqNote, setReReqNote] = useState('');

  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Sync polledItems whenever parent db updates
  useEffect(() => {
    if (Array.isArray(db.financeApprovalRequests)) {
      setPolledItems(db.financeApprovalRequests);
    }
  }, [db.financeApprovalRequests]);

  // Adjust default stageFilter when switching logged-in role
  useEffect(() => {
    if (!isAdmin && isManager) {
      setStageFilter('PENDING_MANAGER');
    } else if (isAdmin) {
      const hasAdminItems = (db.financeApprovalRequests || []).some(
        (r) => r.status === 'PENDING_ADMIN'
      );
      setStageFilter(hasAdminItems ? 'PENDING_ADMIN' : 'PENDING_MANAGER');
    } else {
      setStageFilter('ALL_PENDING');
    }
  }, [activeUser.id, isAdmin, isManager]);

  const fetchApprovalQueue = useCallback(
    async (silent = true) => {
      try {
        if (!silent) setIsPolling(true);
        const resp = await apiRequest<ApprovalPollResponse>(
          '/api/finance/approval-requests',
          activeUser.id
        );
        if (Array.isArray(resp.items)) {
          setPolledItems(resp.items);
          setPolledSummary(resp.summary);
          setLastPolledAt(new Date().toLocaleTimeString('en-GB', { hour12: false }));
          // Prune stale selections
          const stillPendingSet = new Set(
            resp.items
              .filter((r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN')
              .map((r) => r.id)
          );
          setSelectedIds((prev) => prev.filter((id) => stillPendingSet.has(id)));
        }
      } catch {
        // Silent polling resilience
      } finally {
        if (!silent) setIsPolling(false);
      }
    },
    [activeUser.id]
  );

  // Persistent polling every 12 seconds
  useEffect(() => {
    void fetchApprovalQueue(true);
    const timer = window.setInterval(() => {
      void fetchApprovalQueue(true);
    }, 12000);
    return () => window.clearInterval(timer);
  }, [fetchApprovalQueue]);

  // Close history popover on outside click
  useEffect(() => {
    if (!openHistoryId) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpenHistoryId(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [openHistoryId]);

  const queueSummary = useMemo<ApprovalQueueSummary>(() => {
    if (polledSummary && polledItems.length === (db.financeApprovalRequests || []).length) {
      // Keep live computed figures always aligned with polledItems
    }
    const pendingManager = polledItems.filter((r) => r.status === 'PENDING_MANAGER');
    const pendingAdmin = polledItems.filter((r) => r.status === 'PENDING_ADMIN');
    const declined = polledItems.filter((r) => r.status === 'DECLINED');
    const approved = polledItems.filter((r) => r.status === 'APPROVED');
    const allPending = [...pendingManager, ...pendingAdmin];
    const pendingForMe = allPending.filter((r) => {
      if (isAdmin) return r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN';
      if (isManager) return r.status === 'PENDING_MANAGER';
      return false;
    });
    const sumDir = (dir: 'IN' | 'OUT') =>
      allPending
        .filter((r) => r.direction === dir)
        .reduce((s, r) => s + Number(r.amountNpr || 0), 0);

    return {
      pendingManagerCount: pendingManager.length,
      pendingAdminCount: pendingAdmin.length,
      pendingForMeCount: pendingForMe.length,
      totalPendingCount: allPending.length,
      declinedCount: declined.length,
      approvedCount: approved.length,
      pendingInflowNpr: sumDir('IN'),
      pendingOutflowNpr: sumDir('OUT'),
    };
  }, [polledItems, polledSummary, db.financeApprovalRequests, isAdmin, isManager]);

  const visibleQueueItems = useMemo(() => {
    if (queueTab === 'DECLINED') {
      return polledItems.filter((r) => r.status === 'DECLINED');
    }
    if (queueTab === 'APPROVED') {
      return polledItems.filter((r) => r.status === 'APPROVED');
    }
    // PENDING tab
    if (!isAdmin && isManager) {
      return polledItems.filter((r) => r.status === 'PENDING_MANAGER');
    }
    if (stageFilter === 'PENDING_MANAGER') {
      return polledItems.filter((r) => r.status === 'PENDING_MANAGER');
    }
    if (stageFilter === 'PENDING_ADMIN') {
      return polledItems.filter((r) => r.status === 'PENDING_ADMIN');
    }
    return polledItems.filter(
      (r) => r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN'
    );
  }, [polledItems, queueTab, stageFilter, isAdmin, isManager]);

  const canActOnItem = (item: FinanceApprovalRequest): boolean => {
    if (item.status === 'PENDING_MANAGER') return isManager;
    if (item.status === 'PENDING_ADMIN') return isAdmin;
    return false;
  };

  const actionableVisibleIds = useMemo(
    () => visibleQueueItems.filter((item) => canActOnItem(item)).map((i) => i.id),
    [visibleQueueItems, isAdmin, isManager]
  );

  const allVisibleSelected =
    actionableVisibleIds.length > 0 &&
    actionableVisibleIds.every((id) => selectedIds.includes(id));

  const toggleSelectAllVisible = () => {
    if (allVisibleSelected) {
      setSelectedIds((prev) => prev.filter((id) => !actionableVisibleIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...actionableVisibleIds])));
    }
  };

  const toggleSelectItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const flattenedAuditLogs = useMemo(() => {
    const entries: Array<{
      id: string;
      requestId: string;
      requestNumber: string;
      transactionType: string;
      direction: string;
      amountNpr: number;
      reason: string;
      requesterName: string;
      timestamp: string;
      action: string;
      actorName: string;
      actorRole: string;
      note: string;
      statusAfter: string;
    }> = [];

    for (const req of polledItems) {
      for (const h of req.history || []) {
        entries.push({
          id: `${req.id}-${h.id}`,
          requestId: req.id,
          requestNumber: req.requestNumber,
          transactionType: req.transactionType,
          direction: req.direction,
          amountNpr: req.amountNpr,
          reason: req.reason,
          requesterName: req.requesterName,
          timestamp: h.timestamp,
          action: h.action,
          actorName: h.actorName,
          actorRole: h.actorRole,
          note: h.note,
          statusAfter: h.statusAfter,
        });
      }
    }

    const q = logsSearch.trim().toLowerCase();
    return entries
      .filter((e) => (logsFilter === 'ALL' ? true : e.action === logsFilter))
      .filter((e) =>
        !q
          ? true
          : `${e.requestNumber} ${e.transactionType} ${e.reason} ${e.actorName} ${e.requesterName} ${e.note}`
              .toLowerCase()
              .includes(q)
      )
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [polledItems, logsSearch, logsFilter]);

  const handleSingleDecision = async (
    item: FinanceApprovalRequest,
    decision: 'APPROVE' | 'DECLINE',
    note?: string
  ) => {
    setBusyActionId(item.id);
    try {
      const resp = await apiRequest<{ request: FinanceApprovalRequest; db: any }>(
        `/api/finance/approval-requests/${item.id}/decision`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ decision, note }),
        }
      );
      // Immediately update local polled items so processed item removes cleanly from active view
      setPolledItems(resp.db?.financeApprovalRequests || ((prev) => prev.filter((r) => r.id !== item.id)));
      setSelectedIds((prev) => prev.filter((x) => x !== item.id));
      if (openHistoryId === item.id) setOpenHistoryId(null);

      const statusText =
        decision === 'DECLINE'
          ? `Declined ${item.requestNumber} — moved to Declined / Re-Apply queue.`
          : resp.request?.status === 'APPROVED'
          ? `Admin approved ${item.requestNumber} (${formatNpr(item.amountNpr)}) & posted to ledger.`
          : `Manager verified ${item.requestNumber} — forwarded to Admin queue.`;

      onUpdated(resp.db, statusText);
      void fetchApprovalQueue(true);
    } catch (err: any) {
      onUpdated(db, err.message || 'Approval decision failed.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleBulkDecision = async (decision: 'APPROVE' | 'DECLINE', note?: string) => {
    const targetIds = selectedIds.filter((id) => actionableVisibleIds.includes(id));
    if (targetIds.length === 0) return;
    setBusyActionId('BULK');
    try {
      const resp = await apiRequest<{
        processedCount: number;
        errors: Array<{ id: string; error: string }>;
        db: any;
      }>('/api/finance/approval-requests/bulk-decision', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ ids: targetIds, decision, note }),
      });
      if (Array.isArray(resp.db?.financeApprovalRequests)) {
        setPolledItems(resp.db.financeApprovalRequests);
      }
      setSelectedIds([]);
      const errSuffix =
        resp.errors && resp.errors.length > 0 ? ` (${resp.errors.length} skipped)` : '';
      onUpdated(
        resp.db,
        `Bulk ${decision === 'APPROVE' ? 'approved' : 'declined'} ${resp.processedCount} request(s)${errSuffix}.`
      );
      void fetchApprovalQueue(true);
    } catch (err: any) {
      onUpdated(db, err.message || 'Bulk approval action failed.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleConfirmDecline = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declineTarget) return;
    const reasonText = declineNote.trim() || `Declined by ${activeUser.fullName}`;
    const target = declineTarget;
    setDeclineTarget(null);
    setDeclineNote('');

    if (target.mode === 'SINGLE' && target.ids[0]) {
      const item = polledItems.find((r) => r.id === target.ids[0]);
      if (item) {
        await handleSingleDecision(item, 'DECLINE', reasonText);
      }
    } else if (target.mode === 'BULK') {
      await handleBulkDecision('DECLINE', reasonText);
    }
  };

  const startReRequestEdit = (item: FinanceApprovalRequest) => {
    setReRequestEditId(item.id);
    setReReqAmount(String(item.amountNpr));
    setReReqReason(item.reason);
    setReReqDesc(item.description);
    setReReqNote('');
  };

  const handleReRequestSubmit = async (e: React.FormEvent, item: FinanceApprovalRequest) => {
    e.preventDefault();
    setBusyActionId(item.id);
    try {
      const resp = await apiRequest<{ request: FinanceApprovalRequest; db: any }>(
        `/api/finance/approval-requests/${item.id}/re-request`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            amountNpr: Number(reReqAmount),
            reason: reReqReason,
            description: reReqDesc,
            note: reReqNote.trim() || 'Revised and re-applied for Manager approval.',
          }),
        }
      );
      if (Array.isArray(resp.db?.financeApprovalRequests)) {
        setPolledItems(resp.db.financeApprovalRequests);
      }
      setReRequestEditId(null);
      onUpdated(
        resp.db,
        `Re-applied ${item.requestNumber} (${formatNpr(Number(reReqAmount))}) -> returned to Tier-1 Manager Queue.`
      );
      void fetchApprovalQueue(true);
    } catch (err: any) {
      onUpdated(db, err.message || 'Re-request failed.');
    } finally {
      setBusyActionId(null);
    }
  };

  // Counter Close State (Separated Hospital vs Pharmacy + Per-Employee Shift Tracking)
  const [closeScope, setCloseScope] = useState<'HOSPITAL' | 'PHARMACY' | 'ALL'>('HOSPITAL');
  const [closeEmployeeOnly, setCloseEmployeeOnly] = useState<boolean>(true);

  const cashAccount = useMemo(() => {
    if (closeScope === 'PHARMACY') {
      return (
        db.accounts.find((a) => a.departmentScope === 'PHARMACY' && a.type === 'CASH_COUNTER') ||
        db.accounts.find((a) => a.type === 'CASH_COUNTER') ||
        db.accounts[0]
      );
    }
    return (
      db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.isDefaultPosCash) ||
      db.accounts.find((a) => a.departmentScope !== 'PHARMACY' && a.type === 'CASH_COUNTER') ||
      db.accounts.find((a) => a.type === 'CASH_COUNTER') ||
      db.accounts[0]
    );
  }, [db.accounts, closeScope]);

  const counterMetrics = useMemo(() => {
    const lastClose = db.counterCloses.find((c) => {
      const sameScope = (c.counterScope || 'HOSPITAL') === closeScope;
      const sameCashier = !closeEmployeeOnly || c.cashierId === activeUser.id;
      return sameScope && sameCashier;
    });
    const lastCloseTime = lastClose ? new Date(lastClose.closedAt).getTime() : 0;
    const openingCash = lastClose ? lastClose.actualCountedCashNpr : 0;

    let cashSales = 0;
    let bankSales = 0;
    let creditSales = 0;
    let depositsCollected = 0;
    let ipdCashBills = 0;

    if (closeScope === 'HOSPITAL' || closeScope === 'ALL') {
      const recentOrders = db.orders.filter(
        (o) =>
          new Date(o.orderedAt).getTime() > lastCloseTime &&
          (!closeEmployeeOnly || !o.createdById || o.createdById === activeUser.id)
      );
      cashSales += recentOrders.reduce((s, o) => s + (o.cashPaid || 0), 0);
      bankSales += recentOrders.reduce((s, o) => s + (o.bankPaid || 0), 0);
      creditSales += recentOrders.reduce(
        (s, o) => s + (o.paymentMode === 'Center Credit' ? o.totalAmount : o.dueAmount || 0),
        0
      );

      for (const adm of db.ipdAdmissions || []) {
        for (const dep of adm.deposits || []) {
          if (
            new Date(dep.timestamp).getTime() > lastCloseTime &&
            (!closeEmployeeOnly || dep.receivedBy === activeUser.fullName)
          ) {
            depositsCollected += dep.amountNpr || 0;
            if (dep.paymentMode === 'Bank / QR') bankSales += dep.amountNpr || 0;
            else cashSales += dep.amountNpr || 0;
          }
        }
        for (const cb of adm.ipdIndividualBills || []) {
          if (
            new Date(cb.billedAt).getTime() > lastCloseTime &&
            (!closeEmployeeOnly || !cb.billedById || cb.billedById === activeUser.id)
          ) {
            ipdCashBills += cb.amountNpr || 0;
            if (cb.paymentMode === 'Bank / QR') bankSales += cb.amountNpr || 0;
            else cashSales += cb.amountNpr || 0;
          }
        }
      }
    }

    if (closeScope === 'PHARMACY' || closeScope === 'ALL') {
      const pharmInvs = (db.pharmacyInvoices || []).filter(
        (inv) =>
          new Date(inv.dispensedAt).getTime() > lastCloseTime &&
          (!closeEmployeeOnly || !inv.dispensedById || inv.dispensedById === activeUser.id)
      );
      cashSales += pharmInvs.reduce((s, i) => s + (i.cashPaid || 0), 0);
      bankSales += pharmInvs.reduce((s, i) => s + (i.bankPaid || 0), 0);
      creditSales += pharmInvs.reduce((s, i) => s + (i.dueAmountNpr || 0), 0);

      for (const pdep of db.pharmacyDeposits || []) {
        if (
          new Date(pdep.receivedAt).getTime() > lastCloseTime &&
          (!closeEmployeeOnly || !pdep.receivedById || pdep.receivedById === activeUser.id)
        ) {
          depositsCollected += pdep.amountNpr || 0;
          if (pdep.paymentMode === 'Bank / QR') bankSales += pdep.amountNpr || 0;
          else cashSales += pdep.amountNpr || 0;
        }
      }
    }

    const expectedCash = closeEmployeeOnly
      ? Number((openingCash + cashSales).toFixed(2))
      : cashAccount
      ? cashAccount.currentBalance
      : Number((openingCash + cashSales).toFixed(2));
    return {
      openingCash,
      cashSales,
      bankSales,
      creditSales,
      depositsCollected,
      ipdCashBills,
      expectedCash,
    };
  }, [
    db.counterCloses,
    db.orders,
    db.ipdAdmissions,
    db.pharmacyInvoices,
    db.pharmacyDeposits,
    cashAccount,
    closeScope,
    closeEmployeeOnly,
    activeUser.id,
    activeUser.fullName,
  ]);

  const activeDutyShift = activeUser.shift || 'Morning (07:00-15:00)';
  const [counterShiftFilter, setCounterShiftFilter] = useState<string>(activeDutyShift);
  const [shiftLabel, setShiftLabel] = useState(
    `${activeDutyShift} — ${activeUser.fullName}`
  );
  const [countedCash, setCountedCash] = useState(String(counterMetrics.expectedCash));
  const [closeNotes, setCloseNotes] = useState('');

  useEffect(() => {
    const nextShift = activeUser.shift || 'Morning (07:00-15:00)';
    setCounterShiftFilter(nextShift);
    setShiftLabel(`${nextShift} — ${activeUser.fullName}`);
  }, [activeUser.id, activeUser.fullName, activeUser.shift]);

  useEffect(() => {
    setCountedCash(String(counterMetrics.expectedCash));
  }, [counterMetrics.expectedCash]);

  const shiftDutyRoster = useMemo(() => {
    return (db.staff || []).filter(
      (st) => st.status === 'Active' && (st.shift || 'Morning (07:00-15:00)') === counterShiftFilter
    );
  }, [db.staff, counterShiftFilter]);

  const variance = Number(countedCash || 0) - counterMetrics.expectedCash;

  const scopedAccounts = useMemo(() => {
    if (accountScopeFilter === 'PHARMACY') {
      return db.accounts.filter((a) => a.departmentScope === 'PHARMACY');
    }
    if (accountScopeFilter === 'HOSPITAL') {
      return db.accounts.filter((a) => a.departmentScope !== 'PHARMACY');
    }
    return db.accounts;
  }, [db.accounts, accountScopeFilter]);

  const scopedAccountIds = useMemo(
    () => new Set(scopedAccounts.map((a) => a.id)),
    [scopedAccounts]
  );

  const ledgerCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const l of db.financialLedger || []) {
      if (l.fiscalYear === activeFiscalYear && l.category) {
        cats.add(l.category);
      }
    }
    return ['ALL', ...Array.from(cats).sort()];
  }, [db.financialLedger, activeFiscalYear]);

  const filteredLedger = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return db.financialLedger.filter((l) => {
      if (l.fiscalYear !== activeFiscalYear) return false;
      if (accountScopeFilter !== 'ALL' && !scopedAccountIds.has(l.accountId)) return false;
      if (ledgerDirectionFilter !== 'ALL' && l.direction !== ledgerDirectionFilter) return false;
      if (ledgerCategoryFilter !== 'ALL' && l.category !== ledgerCategoryFilter) return false;
      const entryYmd = (l.timestamp || '').slice(0, 10);
      if (ledgerStartDate && entryYmd < ledgerStartDate) return false;
      if (ledgerEndDate && entryYmd > ledgerEndDate) return false;
      if (!q) return true;
      return `${l.accountName} ${l.referenceId} ${l.category} ${l.description} ${l.recordedBy}`
        .toLowerCase()
        .includes(q);
    });
  }, [
    db.financialLedger,
    activeFiscalYear,
    searchTerm,
    accountScopeFilter,
    scopedAccountIds,
    ledgerDirectionFilter,
    ledgerCategoryFilter,
    ledgerStartDate,
    ledgerEndDate,
  ]);

  const ledgerSummary = useMemo(() => {
    let inflow = 0;
    let outflow = 0;
    for (const f of filteredLedger) {
      if (f.direction === 'INFLOW') inflow += Number(f.amount || 0);
      else outflow += Number(f.amount || 0);
    }
    const cashTotal = scopedAccounts
      .filter((a) => a.type === 'CASH_COUNTER')
      .reduce((s, a) => s + (a.currentBalance || 0), 0);
    const bankTotal = scopedAccounts
      .filter((a) => a.type === 'BANK')
      .reduce((s, a) => s + (a.currentBalance || 0), 0);
    return {
      inflow: Number(inflow.toFixed(2)),
      outflow: Number(outflow.toFixed(2)),
      net: Number((inflow - outflow).toFixed(2)),
      cashTotal: Number(cashTotal.toFixed(2)),
      bankTotal: Number(bankTotal.toFixed(2)),
      combinedBalance: Number((cashTotal + bankTotal).toFixed(2)),
    };
  }, [filteredLedger, scopedAccounts]);

  const financialBreakdowns = useMemo(() => {
    const fyOrders = db.orders.filter((o) => !o.fiscalYear || o.fiscalYear === activeFiscalYear);
    const deptMap = new Map<string, { name: string; testsCount: number; revenue: number }>();

    for (const o of fyOrders) {
      for (const t of o.tests) {
        const key = t.modality ? `Radiology (${t.modality})` : t.department;
        const entry = deptMap.get(key) || { name: key, testsCount: 0, revenue: 0 };
        entry.testsCount += 1;
        entry.revenue += t.price;
        deptMap.set(key, entry);
      }
    }

    // Hospital P&L calculations
    const hospitalOrderSales = fyOrders.reduce((s, o) => s + (o.totalAmount || 0), 0);
    const hospitalOrderPaid = fyOrders.reduce((s, o) => s + (o.paidAmount || 0), 0);
    const hospitalOrderDue = fyOrders.reduce((s, o) => s + (o.dueAmount || 0), 0);
    const payrollCost = (db.payrollRuns || [])
      .filter((r) => (!r.fiscalYear || r.fiscalYear === activeFiscalYear) && r.status === 'Disbursed')
      .reduce((s, r) => s + (r.totalNetNpr || 0), 0);
    const approvedExpensesOut = (db.financialLedger || [])
      .filter(
        (l) =>
          (!l.fiscalYear || l.fiscalYear === activeFiscalYear) &&
          l.direction === 'OUTFLOW' &&
          (l.category === 'EXPENSE' || l.category === 'SUPPLIER_PAYMENT' || l.category === 'REFERRAL_PAYOUT')
      )
      .reduce((s, l) => s + (l.amount || 0), 0);
    const hospitalNetPnl = hospitalOrderSales - payrollCost - approvedExpensesOut;

    // Pharmacy P&L calculations
    const pharmInvs = (db.pharmacyInvoices || []).filter(
      (i) => !i.fiscalYear || i.fiscalYear === activeFiscalYear
    );
    const batchBuyMap = new Map<string, number>();
    for (const b of db.pharmacyBatches || []) {
      batchBuyMap.set(b.id, b.purchaseRateNpr || 0);
    }
    let pharmSalesRevenue = 0;
    let pharmPaid = 0;
    let pharmDue = 0;
    let pharmCogs = 0;
    for (const inv of pharmInvs) {
      pharmSalesRevenue += inv.totalNpr || 0;
      pharmPaid += inv.paidAmountNpr ?? ((inv.cashPaid || 0) + (inv.bankPaid || 0));
      pharmDue += inv.dueAmountNpr || 0;
      for (const it of inv.lines || []) {
        const unitBuy =
          it.purchaseRateNpr !== undefined && it.purchaseRateNpr > 0
            ? it.purchaseRateNpr
            : batchBuyMap.get(it.batchId) || 0;
        pharmCogs += unitBuy * (it.quantity || 0);
      }
    }
    const pharmGrossProfit = pharmSalesRevenue - pharmCogs;
    const stockBuyValuation = (db.pharmacyBatches || []).reduce(
      (s, b) => s + (b.quantityOnHand || 0) * (b.purchaseRateNpr || 0),
      0
    );
    const stockMrpValuation = (db.pharmacyBatches || []).reduce(
      (s, b) => s + (b.quantityOnHand || 0) * (b.mrpNpr || 0),
      0
    );

    const supplierPayables = (db.pharmacySuppliers || []).reduce(
      (s, sup) => s + (sup.currentDueNpr || 0),
      0
    );
    const totalReceivablesDue = hospitalOrderDue + pharmDue;

    return {
      departments: Array.from(deptMap.values()).sort((a, b) => b.revenue - a.revenue),
      hospitalOrderSales,
      hospitalOrderPaid,
      hospitalOrderDue,
      payrollCost,
      approvedExpensesOut,
      hospitalNetPnl,
      pharmSalesRevenue,
      pharmPaid,
      pharmDue,
      pharmCogs,
      pharmGrossProfit,
      stockBuyValuation,
      stockMrpValuation,
      supplierPayables,
      totalReceivablesDue,
      consolidatedProfit: hospitalNetPnl + pharmGrossProfit,
    };
  }, [db.orders, db.payrollRuns, db.financialLedger, db.pharmacyInvoices, db.pharmacyBatches, db.pharmacySuppliers, activeFiscalYear]);

  const dcApprovals = db.discountCreditApprovals || [];
  const pendingDcCount = useMemo(
    () => dcApprovals.filter((a) => a.status === 'PENDING_MANAGER' || a.status === 'PENDING_ADMIN').length,
    [dcApprovals]
  );

  const dailyAutoChargeReport = useMemo(() => {
    const startYmd = autoChargeStartDate <= autoChargeEndDate ? autoChargeStartDate : autoChargeEndDate;
    const endYmd = autoChargeEndDate >= autoChargeStartDate ? autoChargeEndDate : autoChargeStartDate;
    const q = autoChargeSearch.trim().toLowerCase();

    const rows: Array<{
      id: string;
      admissionId: string;
      admissionNumber: string;
      uhid: string;
      patientName: string;
      wardBed: string;
      disposition: string;
      cycleDay: number;
      cycleDateAd: string;
      cycleDateBs: string;
      timingWindowBs: string;
      bedFeeNpr: number;
      nursingFeeNpr: number;
      observationFeeNpr: number;
      doctorRoundFeeNpr: number;
      shiftObsFeeNpr: number;
      rowTotalNpr: number;
    }> = [];

    const patientIds = new Set<string>();
    let bedTotal = 0;
    let nursingTotal = 0;
    let observationTotal = 0;
    let doctorRoundTotal = 0;
    let shiftObsTotal = 0;

    for (const adm of db.ipdAdmissions || []) {
      const auto = computeIpdDailyAutoCharges(
        adm,
        db.settings?.moduleSettings,
        adm.dischargedAt
      );
      const matchText = `${adm.admissionNumber} ${adm.patientName} ${adm.uhid || ''} ${adm.currentBedLabel} ${adm.currentWardName} ${adm.admittingDoctor}`.toLowerCase();
      if (q && !matchText.includes(q)) continue;

      const shiftFeesByDate = new Map<string, number>();
      for (const fee of adm.nursingObservationFees || []) {
        const dKey = (fee.recordedAt || '').slice(0, 10);
        if (dKey >= startYmd && dKey <= endYmd) {
          shiftFeesByDate.set(dKey, (shiftFeesByDate.get(dKey) || 0) + (Number(fee.feeNpr) || 0));
        }
      }

      const matchedDates = new Set<string>();
      for (const d of auto.dailyBreakdown) {
        const dateAd = d.startIso.slice(0, 10);
        if (dateAd < startYmd || dateAd > endYmd) continue;
        matchedDates.add(dateAd);
        const shiftObsFee = Number((shiftFeesByDate.get(dateAd) || 0).toFixed(2));
        const rowTotal = Number((d.daySubtotalNpr + shiftObsFee).toFixed(2));
        patientIds.add(adm.id);
        bedTotal += d.bedFeeNpr;
        nursingTotal += d.nursingFeeNpr;
        observationTotal += d.observationFeeNpr;
        doctorRoundTotal += d.doctorRoundFeeNpr;
        shiftObsTotal += shiftObsFee;

        rows.push({
          id: `${adm.id}-d${d.dayNumber}`,
          admissionId: adm.id,
          admissionNumber: adm.admissionNumber,
          uhid: adm.uhid || '—',
          patientName: adm.patientName,
          wardBed: `${adm.currentBedLabel} (${adm.currentWardName})`,
          disposition: adm.disposition,
          cycleDay: d.dayNumber,
          cycleDateAd: dateAd,
          cycleDateBs: adToBs(d.startIso).formattedEn,
          timingWindowBs: `${d.startBsLabel} → ${d.endBsLabel}`,
          bedFeeNpr: d.bedFeeNpr,
          nursingFeeNpr: d.nursingFeeNpr,
          observationFeeNpr: d.observationFeeNpr,
          doctorRoundFeeNpr: d.doctorRoundFeeNpr,
          shiftObsFeeNpr: shiftObsFee,
          rowTotalNpr: rowTotal,
        });
      }

      // Include any shift nursing observation fees on dates outside a cycle start boundary
      for (const [dateAd, feeAmt] of shiftFeesByDate.entries()) {
        if (matchedDates.has(dateAd) || feeAmt <= 0) continue;
        patientIds.add(adm.id);
        shiftObsTotal += feeAmt;
        rows.push({
          id: `${adm.id}-obs-${dateAd}`,
          admissionId: adm.id,
          admissionNumber: adm.admissionNumber,
          uhid: adm.uhid || '—',
          patientName: adm.patientName,
          wardBed: `${adm.currentBedLabel} (${adm.currentWardName})`,
          disposition: adm.disposition,
          cycleDay: 0,
          cycleDateAd: dateAd,
          cycleDateBs: adToBs(`${dateAd}T12:00:00`).formattedEn,
          timingWindowBs: 'Shift Nursing Observation',
          bedFeeNpr: 0,
          nursingFeeNpr: 0,
          observationFeeNpr: 0,
          doctorRoundFeeNpr: 0,
          shiftObsFeeNpr: feeAmt,
          rowTotalNpr: feeAmt,
        });
      }
    }

    rows.sort((a, b) => b.cycleDateAd.localeCompare(a.cycleDateAd) || a.admissionNumber.localeCompare(b.admissionNumber));

    const grandTotal = Number(
      (bedTotal + nursingTotal + observationTotal + doctorRoundTotal + shiftObsTotal).toFixed(2)
    );

    return {
      startYmd,
      endYmd,
      rows,
      patientCount: patientIds.size,
      cycleCount: rows.length,
      bedTotal: Number(bedTotal.toFixed(2)),
      nursingTotal: Number(nursingTotal.toFixed(2)),
      observationTotal: Number(observationTotal.toFixed(2)),
      doctorRoundTotal: Number(doctorRoundTotal.toFixed(2)),
      shiftObsTotal: Number(shiftObsTotal.toFixed(2)),
      grandTotal,
    };
  }, [db.ipdAdmissions, db.settings?.moduleSettings, autoChargeStartDate, autoChargeEndDate, autoChargeSearch]);

  const handleExportAutoChargesCsv = () => {
    const header = [
      'Date AD',
      'Date BS',
      'IPD Number',
      'UHID',
      'Patient Name',
      'Ward / Bed',
      'Cycle Day',
      'Timing Window (BS)',
      'Bed Stay (NPR)',
      'Nursing Care (NPR)',
      'Daily Obs (NPR)',
      'Doctor Round (NPR)',
      'Shift Obs (NPR)',
      'Row Total (NPR)',
    ];
    const escapeCsv = (val: string | number) => `"${String(val).replace(/"/g, '""')}"`;
    const csvRows = [
      header.map(escapeCsv).join(','),
      ...dailyAutoChargeReport.rows.map((r) =>
        [
          r.cycleDateAd,
          r.cycleDateBs,
          r.admissionNumber,
          r.uhid,
          r.patientName,
          r.wardBed,
          r.cycleDay > 0 ? `Day ${r.cycleDay}` : 'Shift Obs',
          r.timingWindowBs,
          r.bedFeeNpr,
          r.nursingFeeNpr,
          r.observationFeeNpr,
          r.doctorRoundFeeNpr,
          r.shiftObsFeeNpr,
          r.rowTotalNpr,
        ]
          .map(escapeCsv)
          .join(',')
      ),
    ].join('\n');
    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Daily-Auto-Charge-Report-${dailyAutoChargeReport.startYmd}-to-${dailyAutoChargeReport.endYmd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportAutoChargesPdf = () => {
    downloadFinancialBreakdownPdf(
      `Daily Auto-Charge Report (${dailyAutoChargeReport.startYmd} to ${dailyAutoChargeReport.endYmd})`,
      `BS Range: ${adToBs(`${dailyAutoChargeReport.startYmd}T12:00:00`).formattedEn} to ${adToBs(`${dailyAutoChargeReport.endYmd}T12:00:00`).formattedEn} · Prepared by ${activeUser.fullName}`,
      [
        {
          heading: '1. Daily Auto-Charge Summary',
          columns: ['Service Category', 'Total Cycles / Rows', 'Amount (NPR)'],
          rows: [
            ['Bed Stay Auto-Charges', String(dailyAutoChargeReport.cycleCount), formatNpr(dailyAutoChargeReport.bedTotal)],
            ['Daily Nursing Care', String(dailyAutoChargeReport.cycleCount), formatNpr(dailyAutoChargeReport.nursingTotal)],
            ['Daily Observation Fee', String(dailyAutoChargeReport.cycleCount), formatNpr(dailyAutoChargeReport.observationTotal)],
            ['Doctor Round Auto-Charges', String(dailyAutoChargeReport.cycleCount), formatNpr(dailyAutoChargeReport.doctorRoundTotal)],
            ['Shift Nursing Observation Fees', '-', formatNpr(dailyAutoChargeReport.shiftObsTotal)],
            ['Consolidated Grand Total', `${dailyAutoChargeReport.patientCount} Patients`, formatNpr(dailyAutoChargeReport.grandTotal)],
          ],
        },
        {
          heading: '2. Itemized IPD Daily Service Cycles',
          columns: ['Date (BS / AD)', 'IPD # / Patient', 'Bed / Ward', 'Timing Window', 'Bed', 'Nur', 'Obs', 'Round', 'Total'],
          rows: dailyAutoChargeReport.rows.map((r) => [
            `${r.cycleDateBs} (${r.cycleDateAd})`,
            `${r.admissionNumber} · ${r.patientName}`,
            r.wardBed,
            r.timingWindowBs,
            formatNpr(r.bedFeeNpr),
            formatNpr(r.nursingFeeNpr),
            formatNpr(r.observationFeeNpr + r.shiftObsFeeNpr),
            formatNpr(r.doctorRoundFeeNpr),
            formatNpr(r.rowTotalNpr),
          ]),
        },
      ],
      db.settings
    );
  };

  const handleExportFinancialPdf = () => {
    downloadFinancialBreakdownPdf(
      `Hospital & Pharmacy Financial P&L Statement — FY ${activeFiscalYear}`,
      `BS Date: ${adToBs(new Date()).formattedEn} · Prepared by ${activeUser.fullName}`,
      [
        {
          heading: '1. Department & Radiology Modality Revenue',
          columns: ['Department / Modality', 'Tests / Studies', 'Gross Revenue (NPR)'],
          rows: financialBreakdowns.departments.map((d) => [
            d.name,
            String(d.testsCount),
            formatNpr(d.revenue),
          ]),
        },
        {
          heading: '2. Hospital & Pharmacy Profit & Loss Summary',
          columns: ['Account / Category', 'Amount (NPR)', 'Remarks'],
          rows: [
            ['Hospital Billed Revenue', formatNpr(financialBreakdowns.hospitalOrderSales), `Collected: ${formatNpr(financialBreakdowns.hospitalOrderPaid)}`],
            ['Hospital Payroll & Approved Expenses', formatNpr(financialBreakdowns.payrollCost + financialBreakdowns.approvedExpensesOut), 'Disbursed Payroll + Outflows'],
            ['Hospital Operating Net P&L', formatNpr(financialBreakdowns.hospitalNetPnl), financialBreakdowns.hospitalNetPnl >= 0 ? 'Profit' : 'Loss'],
            ['Pharmacy Sales Revenue', formatNpr(financialBreakdowns.pharmSalesRevenue), `Collected: ${formatNpr(financialBreakdowns.pharmPaid)}`],
            ['Pharmacy Buying COGS (Purchase Cost)', formatNpr(financialBreakdowns.pharmCogs), `Stock Value (Buy): ${formatNpr(financialBreakdowns.stockBuyValuation)}`],
            ['Pharmacy Gross Trading P&L', formatNpr(financialBreakdowns.pharmGrossProfit), financialBreakdowns.pharmGrossProfit >= 0 ? 'Profit' : 'Loss'],
            ['Total Supplier Payables Due', formatNpr(financialBreakdowns.supplierPayables), 'Creditors / Suppliers'],
          ],
        },
        {
          heading: '3. Treasury & Bank Cash Balances',
          columns: ['Code', 'Account', 'Type', 'Current Balance'],
          rows: db.accounts.map((a) => [
            a.code,
            a.name,
            `${a.type} (${a.departmentScope || 'HOSPITAL'})`,
            formatNpr(a.currentBalance),
          ]),
        },
      ],
      db.settings
    );
  };

  const openAssetModal = (asset?: HospitalAsset) => {
    if (asset) {
      setEditingAsset(asset);
      setAstCode(asset.assetCode);
      setAstName(asset.name);
      setAstCategory(asset.category);
      setAstScope(asset.departmentScope);
      setAstLocation(asset.location);
      setAstPurchaseDate(asset.purchaseDate);
      setAstPurchaseCost(String(asset.purchaseCostNpr));
      setAstCurrentValue(String(asset.currentValueNpr));
      setAstVendor(asset.vendorName || '');
      setAstWarranty(asset.warrantyUntil || '');
      setAstStatus(asset.status);
      setAstNotes(asset.notes || '');
    } else {
      setEditingAsset(null);
      setAstCode(`AST-${String((db.hospitalAssets || []).length + 1).padStart(3, '0')}`);
      setAstName('');
      setAstCategory('Medical Equipment');
      setAstScope('HOSPITAL');
      setAstLocation('Main Hospital');
      setAstPurchaseDate(new Date().toISOString().slice(0, 10));
      setAstPurchaseCost('');
      setAstCurrentValue('');
      setAstVendor('');
      setAstWarranty('');
      setAstStatus('Active');
      setAstNotes('');
    }
    setAssetModalOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/finance/assets', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          id: editingAsset?.id,
          assetCode: astCode.trim(),
          name: astName.trim(),
          category: astCategory,
          departmentScope: astScope,
          location: astLocation.trim(),
          purchaseDate: astPurchaseDate,
          purchaseCostNpr: Number(astPurchaseCost) || 0,
          currentValueNpr: astCurrentValue !== '' ? Number(astCurrentValue) || 0 : Number(astPurchaseCost) || 0,
          vendorName: astVendor.trim(),
          warrantyUntil: astWarranty.trim(),
          status: astStatus,
          notes: astNotes.trim(),
        }),
      });
      onUpdated(resp.db, `${editingAsset ? 'Updated' : 'Registered'} hospital asset ${astName}.`);
      setAssetModalOpen(false);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save asset.');
    }
  };

  const handleDeleteAsset = async (assetId: string) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/finance/assets/${assetId}`, activeUser.id, {
        method: 'DELETE',
      });
      setDeletingAssetId(null);
      onUpdated(resp.db, 'Hospital asset removed from register.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to delete asset.');
    }
  };

  const openSupplierModal = (sup?: PharmacySupplier) => {
    if (sup) {
      setEditingSupplier(sup);
      setSupCode(sup.code);
      setSupName(sup.name);
      setSupContact(sup.contactPerson);
      setSupPhone(sup.phone);
      setSupAddress(sup.address);
      setSupPanVat(sup.panVat || '');
      setSupTerms(sup.paymentTerms);
      setSupCreditDays(String(sup.creditDays));
      setSupOpeningDue(String(sup.currentDueNpr));
    } else {
      setEditingSupplier(null);
      setSupCode(`SUP-${String((db.pharmacySuppliers || []).length + 1).padStart(3, '0')}`);
      setSupName('');
      setSupContact('');
      setSupPhone('');
      setSupAddress('');
      setSupPanVat('');
      setSupTerms('Credit 30 Days');
      setSupCreditDays('30');
      setSupOpeningDue('0');
    }
    setSupplierModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/suppliers', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          id: editingSupplier?.id,
          code: supCode.trim(),
          name: supName.trim(),
          contactPerson: supContact.trim(),
          phone: supPhone.trim(),
          address: supAddress.trim(),
          panVat: supPanVat.trim(),
          paymentTerms: supTerms,
          creditDays: Number(supCreditDays) || 0,
          openingDueNpr: Number(supOpeningDue) || 0,
          currentDueNpr: editingSupplier ? Number(supOpeningDue) || 0 : undefined,
        }),
      });
      onUpdated(resp.db, `${editingSupplier ? 'Updated' : 'Added'} supplier ${supName}.`);
      setSupplierModalOpen(false);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save supplier.');
    }
  };

  const handlePaySupplierDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payDueTarget) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/pharmacy/suppliers/${payDueTarget.id}/pay`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            amountNpr: Number(payDueAmount) || 0,
            accountId: payDueAccountId,
            referenceNo: payDueRef.trim(),
            notes: payDueNotes.trim(),
          }),
        }
      );
      onUpdated(resp.db, `Settled ${formatNpr(Number(payDueAmount) || 0)} due to ${payDueTarget.name}.`);
      setPayDueTarget(null);
      setPayDueAmount('');
      setPayDueRef('');
      setPayDueNotes('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Supplier due settlement failed.');
    }
  };

  const handleCollectPatientDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!collectDueTarget) return;
    setCollectingDue(true);
    try {
      const endpoint =
        collectDueTarget.kind === 'PHARMACY'
          ? `/api/pharmacy/invoices/${collectDueTarget.id}/settle-due`
          : `/api/orders/${collectDueTarget.id}/settle-due`;
      const resp = await apiRequest<{ db: LimsDatabase }>(endpoint, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          amountNpr: Number(collectDueAmount) || 0,
          paymentMode: collectDueMode,
          bankAccountId: collectDueMode === 'Bank / QR' ? collectDueAccountId : undefined,
          note: collectDueNote.trim() || `Collected via Accounting Desk by ${activeUser.fullName}`,
        }),
      });
      onUpdated(
        resp.db,
        `Collected ${formatNpr(Number(collectDueAmount) || 0)} due from ${collectDueTarget.patientName} (${collectDueTarget.ref}).`
      );
      setCollectDueTarget(null);
      setCollectDueAmount('');
      setCollectDueNote('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Patient due collection failed.');
    } finally {
      setCollectingDue(false);
    }
  };

  const handleDiscountCreditDecision = async (
    item: DiscountCreditApprovalRequest,
    decision: 'APPROVE' | 'DECLINE'
  ) => {
    setDcBusyId(item.id);
    try {
      const remarks = dcRemarksMap[item.id]?.trim();
      const resp = await apiRequest<{ approval: DiscountCreditApprovalRequest; db: LimsDatabase }>(
        `/api/approvals/discount-credit/${item.id}/decision`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ decision, remarks }),
        }
      );
      setDcRemarksMap((prev) => ({ ...prev, [item.id]: '' }));
      onUpdated(
        resp.db,
        `${decision === 'APPROVE' ? 'Approved' : 'Declined'} ${item.requestNumber} (${item.patientName}) → ${resp.approval.status}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Approval decision failed.');
    } finally {
      setDcBusyId(null);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: any }>('/api/finance/accounts', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          code: accCode,
          name: accName,
          type: accType,
          departmentScope: accScope,
          accountNumber: accNumber,
          currentBalance: Number(accBalance),
        }),
      });
      onUpdated(resp.db, `Created ${accScope} account ${accName} (${accCode}).`);
      setShowAddAcc(false);
      setAccCode('');
      setAccName('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Account creation failed.');
    }
  };

  const handleVoucherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: any; request?: FinanceApprovalRequest }>(
        '/api/finance/transaction',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            type: vchType,
            accountId: vchAccountId,
            targetAccountId: vchType === 'BANK_DEPOSIT' ? vchTargetId : undefined,
            amount: Number(vchAmount),
            reason: vchReason.trim() || vchDesc.trim(),
            payeeOrParty: vchPayee.trim() || undefined,
            description: vchDesc.trim() || vchReason.trim(),
          }),
        }
      );
      if (Array.isArray(resp.db?.financeApprovalRequests)) {
        setPolledItems(resp.db.financeApprovalRequests);
      }
      const reqInfo = resp.request;
      const msg =
        reqInfo?.status === 'APPROVED'
          ? `Posted ${vchType} voucher of ${formatNpr(Number(vchAmount))}.`
          : `Queued ${reqInfo?.requestNumber || vchType} (${formatNpr(
              Number(vchAmount)
            )}) for ${reqInfo?.status === 'PENDING_ADMIN' ? 'Admin' : 'Manager -> Admin'} approval.`;
      onUpdated(resp.db, msg);
      setVchAmount('');
      setVchReason('');
      setVchPayee('');
      setVchDesc('');
      void fetchApprovalQueue(true);
    } catch (err: any) {
      onUpdated(db, err.message || 'Voucher submission failed.');
    }
  };

  const handleCounterClose = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: any }>('/api/finance/counter-close', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          shiftLabel,
          actualCountedCashNpr: Number(countedCash),
          notes: closeNotes,
          counterScope: closeScope,
          employeeOnly: closeEmployeeOnly,
        }),
      });
      onUpdated(
        resp.db,
        `${closeScope} Counter Close locked by ${activeUser.fullName} (${shiftLabel}).`
      );
      setCloseNotes('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Counter close failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Accounting, Ledger &amp; Financial Control
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Daybook &amp; treasury accounts, 2-tier IN/OUT voucher approvals, shift counter close, P&amp;L statements, party/patient dues, and fixed assets ({activeFiscalYear}).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search ledger voucher, ref, account..."
              className="pl-8 pr-7 py-2 text-xs bg-white border border-slate-300 rounded-lg w-56 focus:outline-none focus:border-blue-600"
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
          <button
            type="button"
            onClick={handleExportFinancialPdf}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileDown className="w-3.5 h-3.5" />
            Export P&amp;L PDF
          </button>
          {canManageFinance && (
            <button
              type="button"
              onClick={() => setShowAddAcc(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Bank / Cash Account
            </button>
          )}
        </div>
      </div>

      {/* Organized Accounting Sub-Module Bar */}
      {!isBillingReportOnly && (
        <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1">
            {[
              { id: 'LEDGER' as const, label: 'Daybook & Accounts', icon: Landmark, badge: 0 },
              { id: 'VOUCHERS' as const, label: 'Vouchers & Approvals', icon: ArrowRightLeft, badge: queueSummary.totalPendingCount },
              { id: 'COUNTER_CLOSE' as const, label: 'Shift Counter Close', icon: Lock, badge: 0 },
              { id: 'PNL' as const, label: 'Profit & Loss (P&L)', icon: TrendingUp, badge: 0 },
              { id: 'PARTIES_DUES' as const, label: 'Suppliers & Credit Dues', icon: Users, badge: 0 },
              { id: 'ASSETS' as const, label: `Fixed Assets (${(db.hospitalAssets || []).length})`, icon: Package, badge: 0 },
              { id: 'DISCOUNT_CREDIT' as const, label: 'Discount & Credit', icon: Percent, badge: pendingDcCount },
              { id: 'DAILY_AUTO_CHARGES' as const, label: `IPD Auto-Charges`, icon: BedDouble, badge: 0 },
            ].map((item) => {
              const Icon = item.icon;
              const active = financeViewTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFinanceViewTab(item.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                  {item.badge > 0 && (
                    <span
                      className={`ml-0.5 px-1.5 py-0.5 text-[10px] font-mono tabular-nums font-bold rounded ${
                        active ? 'bg-amber-400 text-slate-950' : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] font-mono text-slate-500 px-2 whitespace-nowrap">
            Shift: {counterShiftFilter}
          </div>
        </div>
      )}

      {isBillingReportOnly ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <form
            onSubmit={handleCounterClose}
            className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-600" />
                  Shift Counter Close ({closeScope})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cashier: <strong>{activeUser.fullName}</strong> ({activeUser.employeeCode}) · Shift: <strong>{counterShiftFilter}</strong>
                </p>
              </div>
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md text-[11px]">
                {(['HOSPITAL', 'PHARMACY', 'ALL'] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setCloseScope(sc)}
                    className={`px-2 py-1 rounded font-semibold ${
                      closeScope === sc ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {sc}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div><div className="text-slate-500">Opening Cash</div><div className="font-mono font-semibold">{formatNpr(counterMetrics.openingCash)}</div></div>
              <div><div className="text-slate-500">Shift Cash Collected</div><div className="font-mono font-semibold text-emerald-700">+{formatNpr(counterMetrics.cashSales)}</div></div>
              <div><div className="text-slate-500">Bank / QR Sales</div><div className="font-mono font-semibold text-blue-700">{formatNpr(counterMetrics.bankSales)}</div></div>
              <div><div className="text-slate-500">Credit / Due</div><div className="font-mono font-semibold text-slate-700">{formatNpr(counterMetrics.creditSales)}</div></div>
              <div className="col-span-2 pt-2 border-t border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-800">Expected Counter Cash:</span>
                <span className="font-mono text-sm font-bold text-slate-900">{formatNpr(counterMetrics.expectedCash)}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Active Shift</label>
                <select
                  value={counterShiftFilter}
                  onChange={(e) => {
                    setCounterShiftFilter(e.target.value);
                    setShiftLabel(`${e.target.value} — ${activeUser.fullName}`);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                  <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                  <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Physical Counted Cash (रू) *</label>
                <input
                  type="number"
                  required
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Closing Remarks</label>
                <input
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Denomination summary or variance note..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            {canCloseCounter && (
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
              >
                Lock &amp; Sign Off Shift Counter Close
              </button>
            )}
          </form>

          <div className="space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Users className="w-4 h-4 text-blue-600" />
                Staff Duty Roster — {counterShiftFilter} ({shiftDutyRoster.length} On Shift)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {shiftDutyRoster.map((st) => (
                  <div key={st.id} className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="font-semibold text-slate-900">{st.fullName}</div>
                    <div className="text-[11px] font-mono text-slate-500">
                      {st.employeeCode} · {st.department} · {st.roleId}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
                Recent Counter Close History
              </div>
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto text-xs">
                {db.counterCloses.slice(0, 12).map((c) => (
                  <div key={c.id} className="p-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900">{c.shiftLabel}</div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {c.bsDate} · {c.cashierName}
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="font-bold text-slate-900">{formatNpr(c.actualCountedCashNpr)}</div>
                      <div className="text-[11px] text-slate-500">Var: {formatNpr(c.varianceNpr)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : financeViewTab === 'PNL' ? (
        <div className="space-y-6">
          {/* P&L Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-slate-500 font-medium">Hospital Operating Revenue</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                {formatNpr(financialBreakdowns.hospitalOrderSales)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Paid: {formatNpr(financialBreakdowns.hospitalOrderPaid)} · Due: {formatNpr(financialBreakdowns.hospitalOrderDue)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-slate-500 font-medium">Hospital Net Profit / Loss</div>
              <div
                className={`text-lg font-bold font-mono tabular-nums ${
                  financialBreakdowns.hospitalNetPnl >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {financialBreakdowns.hospitalNetPnl >= 0 ? '+' : ''}
                {formatNpr(financialBreakdowns.hospitalNetPnl)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Expenses &amp; Payroll: {formatNpr(financialBreakdowns.payrollCost + financialBreakdowns.approvedExpensesOut)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-slate-500 font-medium">Pharmacy Gross Profit (Buy vs Sell)</div>
              <div
                className={`text-lg font-bold font-mono tabular-nums ${
                  financialBreakdowns.pharmGrossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {financialBreakdowns.pharmGrossProfit >= 0 ? '+' : ''}
                {formatNpr(financialBreakdowns.pharmGrossProfit)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Sales {formatNpr(financialBreakdowns.pharmSalesRevenue)} − COGS {formatNpr(financialBreakdowns.pharmCogs)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
              <div className="text-slate-500 font-medium">Consolidated Hospital + Pharmacy P&amp;L</div>
              <div
                className={`text-lg font-bold font-mono tabular-nums ${
                  financialBreakdowns.consolidatedProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {financialBreakdowns.consolidatedProfit >= 0 ? '+' : ''}
                {formatNpr(financialBreakdowns.consolidatedProfit)}
              </div>
              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                Stock Buy Val: {formatNpr(financialBreakdowns.stockBuyValuation)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <h2 className="text-sm font-semibold text-slate-900">
                  Income &amp; Expenditure Statement ({activeFiscalYear})
                </h2>
                <span
                  className={`px-2 py-0.5 font-mono tabular-nums font-bold rounded ${
                    financialBreakdowns.consolidatedProfit >= 0
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}
                >
                  Net: {formatNpr(financialBreakdowns.consolidatedProfit)}
                </span>
              </div>
              <div className="space-y-2 font-mono tabular-nums">
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-sans text-slate-600">Hospital Diagnostics, OPD, ER &amp; IPD Billed</span>
                  <span className="font-semibold text-slate-900">{formatNpr(financialBreakdowns.hospitalOrderSales)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-sans text-slate-600">Less: Disbursed Staff Payroll</span>
                  <span className="text-rose-700">-{formatNpr(financialBreakdowns.payrollCost)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-sans text-slate-600">Less: Approved Operating Expenses &amp; Payouts</span>
                  <span className="text-rose-700">-{formatNpr(financialBreakdowns.approvedExpensesOut)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold">
                  <span className="font-sans text-slate-900">Hospital Net Operating P&amp;L</span>
                  <span className={financialBreakdowns.hospitalNetPnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                    {formatNpr(financialBreakdowns.hospitalNetPnl)}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100 pt-2">
                  <span className="font-sans text-slate-600">Central Pharmacy Sales Revenue</span>
                  <span className="font-semibold text-slate-900">{formatNpr(financialBreakdowns.pharmSalesRevenue)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-100">
                  <span className="font-sans text-slate-600">Less: Pharmacy Buying Cost (COGS)</span>
                  <span className="text-rose-700">-{formatNpr(financialBreakdowns.pharmCogs)}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-slate-200 font-bold">
                  <span className="font-sans text-slate-900">Pharmacy Gross Trading Profit</span>
                  <span className={financialBreakdowns.pharmGrossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                    {formatNpr(financialBreakdowns.pharmGrossProfit)}
                  </span>
                </div>
                <div className="flex justify-between py-1 font-bold">
                  <span className="font-sans text-slate-900">Pharmacy Stock On-Hand (Buy Cost / MRP)</span>
                  <span className="text-blue-700">
                    {formatNpr(financialBreakdowns.stockBuyValuation)} / {formatNpr(financialBreakdowns.stockMrpValuation)}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">
                  Revenue by Department &amp; Modality ({activeFiscalYear})
                </h2>
                <span className="text-xs font-mono tabular-nums text-slate-500">
                  {financialBreakdowns.departments.length} Departments
                </span>
              </div>
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/70">
                      <th className="py-2.5 px-4">Department / Modality</th>
                      <th className="py-2.5 px-4 text-right">Volume</th>
                      <th className="py-2.5 px-4 text-right">Gross Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {financialBreakdowns.departments.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="py-8 text-center text-slate-500">
                          No billed departmental revenue recorded yet for {activeFiscalYear}.
                        </td>
                      </tr>
                    ) : (
                      financialBreakdowns.departments.map((d) => (
                        <tr key={d.name} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{d.name}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                            {d.testsCount} tests/studies
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-blue-700">
                            {formatNpr(d.revenue)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : financeViewTab === 'PARTIES_DUES' ? (
        (() => {
          const allReceivableDues = [
            ...(db.orders || [])
              .filter((o) => (o.dueAmount || 0) > 0)
              .map((o) => ({
                kind: 'HOSPITAL' as const,
                id: o.id,
                ref: o.invoiceNumber || o.accessionNumber,
                scope: 'HOSPITAL' as const,
                patientName: o.patientName,
                uhid: o.uhid || 'Walk-In',
                date: adToBs(o.orderedAt).formattedEn,
                dueNpr: o.dueAmount,
              })),
            ...(db.pharmacyInvoices || [])
              .filter((i) => (i.dueAmountNpr || 0) > 0)
              .map((i) => ({
                kind: 'PHARMACY' as const,
                id: i.id,
                ref: i.invoiceNumber,
                scope: 'PHARMACY' as const,
                patientName: i.patientName,
                uhid: i.uhid || 'Walk-In',
                date: adToBs(i.dispensedAt).formattedEn,
                dueNpr: i.dueAmountNpr || 0,
              })),
          ].filter((d) => {
            if (dueScopeFilter !== 'ALL' && d.scope !== dueScopeFilter) return false;
            const q = dueSearch.trim().toLowerCase();
            if (!q) return true;
            return `${d.ref} ${d.patientName} ${d.uhid} ${d.scope}`.toLowerCase().includes(q);
          });

          const filteredSuppliers = (db.pharmacySuppliers || []).filter((sup) => {
            if (supplierOnlyDue && (sup.currentDueNpr || 0) <= 0) return false;
            const q = supplierSearch.trim().toLowerCase();
            if (!q) return true;
            return `${sup.name} ${sup.code} ${sup.contactPerson} ${sup.phone} ${sup.panVat || ''}`
              .toLowerCase()
              .includes(q);
          });

          return (
            <div className="space-y-6 text-xs">
              {/* Payables vs Receivables Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-slate-500 font-medium">Total Supplier Payables Due</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-rose-700 mt-1">
                    {formatNpr(financialBreakdowns.supplierPayables)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {(db.pharmacySuppliers || []).filter((s) => s.currentDueNpr > 0).length} vendor account(s) with open due
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-slate-500 font-medium">Hospital Patient Dues Receivable</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
                    {formatNpr(financialBreakdowns.hospitalOrderDue)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Unpaid diagnostic / POS credit bills</div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="text-slate-500 font-medium">Pharmacy Credit Dues Receivable</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-indigo-700 mt-1">
                    {formatNpr(financialBreakdowns.pharmDue)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">Unpaid medicine credit invoices</div>
                </div>
              </div>

              {/* Patient Credit Dues Receivable with Direct Collect Due */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Patient &amp; Party Credit Dues Receivable ({allReceivableDues.length})
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Collect cash or Bank/QR settlements directly against open Hospital POS or Pharmacy credit bills.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        value={dueSearch}
                        onChange={(e) => setDueSearch(e.target.value)}
                        placeholder="Search patient, UHID, bill #..."
                        className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg w-52"
                      />
                    </div>
                    <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                      {(['ALL', 'HOSPITAL', 'PHARMACY'] as const).map((sc) => (
                        <button
                          key={sc}
                          type="button"
                          onClick={() => setDueScopeFilter(sc)}
                          className={`px-2.5 py-1 rounded-md font-semibold ${
                            dueScopeFilter === sc ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                          }`}
                        >
                          {sc}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                      <tr>
                        <th className="py-2.5 px-4">Invoice / Bill Ref</th>
                        <th className="py-2.5 px-4">Patient &amp; UHID</th>
                        <th className="py-2.5 px-4">Scope &amp; Date (BS)</th>
                        <th className="py-2.5 px-4 text-right">Outstanding Due</th>
                        <th className="py-2.5 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allReceivableDues.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            No unpaid patient credit dues match your filter.
                          </td>
                        </tr>
                      ) : (
                        allReceivableDues.map((d) => (
                          <tr key={`${d.kind}-${d.id}`} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 font-mono font-semibold text-blue-700">{d.ref}</td>
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-slate-900">{d.patientName}</div>
                              <div className="font-mono text-[11px] text-slate-500">{d.uhid}</div>
                            </td>
                            <td className="py-2.5 px-4 font-mono text-slate-600">
                              {d.scope} · {d.date}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-rose-700">
                              {formatNpr(d.dueNpr)}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              {(canManageFinance || hasPerm('pos.billing') || hasPerm('pharmacy.dispense')) && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCollectDueTarget(d);
                                    setCollectDueAmount(String(d.dueNpr));
                                    setCollectDueMode('Cash');
                                    setCollectDueNote('');
                                  }}
                                  className="px-3 py-1 font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 whitespace-nowrap"
                                >
                                  Collect Due
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Party & Supplier Ledger */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Supplier &amp; Party Ledger (Payables, Credit Terms &amp; Settlements)
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Track vendor credit terms (7–60 days), buying dues, and post treasury settlements.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        value={supplierSearch}
                        onChange={(e) => setSupplierSearch(e.target.value)}
                        placeholder="Search supplier, code, PAN..."
                        className="pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg w-48"
                      />
                    </div>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={supplierOnlyDue}
                        onChange={(e) => setSupplierOnlyDue(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600"
                      />
                      <span>With Due Only</span>
                    </label>
                    {canManageFinance && (
                      <button
                        type="button"
                        onClick={() => openSupplierModal()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Supplier / Party
                      </button>
                    )}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="py-2.5 px-4">Code &amp; Supplier Name</th>
                        <th className="py-2.5 px-4">Contact &amp; PAN</th>
                        <th className="py-2.5 px-4">Payment Terms</th>
                        <th className="py-2.5 px-4 text-right">Current Due (रू)</th>
                        <th className="py-2.5 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSuppliers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500">
                            No suppliers match your filter.
                          </td>
                        </tr>
                      ) : (
                        filteredSuppliers.map((sup) => (
                          <tr key={sup.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4">
                              <div className="font-semibold text-slate-900">{sup.name}</div>
                              <div className="font-mono text-[11px] text-blue-700">{sup.code} · {sup.address}</div>
                            </td>
                            <td className="py-2.5 px-4">
                              <div>{sup.contactPerson} · {sup.phone}</div>
                              <div className="font-mono text-[11px] text-slate-500">PAN: {sup.panVat || '—'}</div>
                            </td>
                            <td className="py-2.5 px-4">
                              <span className="font-medium text-slate-800">{sup.paymentTerms}</span>
                              <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                                {sup.creditDays} day(s) window
                              </div>
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-rose-700">
                              {formatNpr(sup.currentDueNpr)}
                            </td>
                            <td className="py-2.5 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                {sup.currentDueNpr > 0 && canManageFinance && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPayDueTarget(sup);
                                      setPayDueAmount(String(sup.currentDueNpr));
                                    }}
                                    className="px-2.5 py-1 font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 whitespace-nowrap"
                                  >
                                    Pay Due
                                  </button>
                                )}
                                {canManageFinance && (
                                  <button
                                    type="button"
                                    onClick={() => openSupplierModal(sup)}
                                    className="p-1.5 text-slate-600 border border-slate-300 rounded hover:bg-slate-50"
                                    title="Edit Supplier"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" />
                                  </button>
                                )}
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
          );
        })()
      ) : financeViewTab === 'ASSETS' ? (
        <div className="space-y-5 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-slate-500 font-medium">Registered Assets</div>
              <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                {(db.hospitalAssets || []).length}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-slate-500 font-medium">Original Purchase Cost</div>
              <div className="text-xl font-bold font-mono text-blue-700 mt-1">
                {formatNpr((db.hospitalAssets || []).reduce((s, a) => s + (a.purchaseCostNpr || 0), 0))}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-slate-500 font-medium">Current Book Valuation</div>
              <div className="text-xl font-bold font-mono text-emerald-700 mt-1">
                {formatNpr((db.hospitalAssets || []).reduce((s, a) => s + (a.currentValueNpr || 0), 0))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
                <Building2 className="w-4 h-4 text-blue-600" />
                Hospital &amp; Pharmacy Fixed Assets Register
              </div>
              {canManageFinance && (
                <button
                  type="button"
                  onClick={() => openAssetModal()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Asset
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Asset Code &amp; Name</th>
                    <th className="py-2.5 px-4">Category &amp; Scope</th>
                    <th className="py-2.5 px-4">Location &amp; Vendor</th>
                    <th className="py-2.5 px-4 text-right">Purchase Cost</th>
                    <th className="py-2.5 px-4 text-right">Current Value</th>
                    <th className="py-2.5 px-4">Status</th>
                    {canManageFinance && <th className="py-2.5 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(db.hospitalAssets || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No hospital or pharmacy assets registered yet.
                      </td>
                    </tr>
                  ) : (
                    (db.hospitalAssets || []).map((ast) => (
                      <tr key={ast.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{ast.name}</div>
                          <div className="font-mono text-[11px] text-blue-700">
                            {ast.assetCode} · Purchased {ast.purchaseDate}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-800">{ast.category}</div>
                          <div className="font-mono text-[10px] text-slate-500">{ast.departmentScope}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div>{ast.location}</div>
                          <div className="text-[11px] text-slate-500">{ast.vendorName || '—'}</div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono">{formatNpr(ast.purchaseCostNpr)}</td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                          {formatNpr(ast.currentValueNpr)}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded font-semibold ${
                              ast.status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700'
                                : ast.status === 'Under Maintenance'
                                ? 'bg-amber-50 text-amber-800'
                                : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            {ast.status}
                          </span>
                        </td>
                        {canManageFinance && (
                          <td className="py-2.5 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openAssetModal(ast)}
                                className="p-1.5 text-slate-600 border border-slate-300 rounded hover:bg-slate-50"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {deletingAssetId === ast.id ? (
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteAsset(ast.id)}
                                  className="px-2 py-1 text-[11px] font-semibold text-white bg-rose-600 rounded"
                                >
                                  Confirm Delete
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setDeletingAssetId(ast.id)}
                                  className="p-1.5 text-rose-600 border border-rose-200 rounded hover:bg-rose-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
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
      ) : financeViewTab === 'DISCOUNT_CREDIT' ? (
        <div className="space-y-4 text-xs">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                Live Discount &amp; Credit Limit Approvals Queue
              </h2>
              <p className="text-[11px] text-slate-500">
                Policy: Discount ({db.settings?.moduleSettings?.discountApprovalPolicy || 'MANAGER_THEN_ADMIN'}) · Credit Limit ({db.settings?.moduleSettings?.creditApprovalPolicy || 'MANAGER_THEN_ADMIN'})
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(['PENDING', 'APPROVED', 'DECLINED', 'ALL'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setDcFilter(f)}
                  className={`px-3 py-1 rounded-md font-semibold ${
                    dcFilter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-200">
            {dcApprovals
              .filter((r) => {
                if (dcFilter === 'PENDING') return r.status === 'PENDING_MANAGER' || r.status === 'PENDING_ADMIN';
                if (dcFilter === 'APPROVED') return r.status === 'APPROVED';
                if (dcFilter === 'DECLINED') return r.status === 'DECLINED';
                return true;
              })
              .map((reqItem) => {
                const canAct =
                  (reqItem.status === 'PENDING_MANAGER' && (isManager || isAdmin)) ||
                  (reqItem.status === 'PENDING_ADMIN' && isAdmin);
                return (
                  <div key={reqItem.id} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">{reqItem.requestNumber}</span>
                          <span className="px-2 py-0.5 font-mono text-[10px] font-bold rounded bg-blue-50 text-blue-800 border border-blue-200">
                            {reqItem.requestType === 'DISCOUNT_OVERRIDE' ? 'DISCOUNT' : 'CREDIT LIMIT'}
                          </span>
                          <span className="px-2 py-0.5 font-mono text-[10px] font-semibold rounded bg-slate-100 text-slate-700">
                            {reqItem.sourceModule}
                          </span>
                          <span
                            className={`px-2 py-0.5 font-mono text-[10px] font-bold rounded ${
                              reqItem.status === 'APPROVED'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : reqItem.status === 'DECLINED'
                                ? 'bg-rose-50 text-rose-700 border border-rose-200'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {reqItem.status}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900">
                          {reqItem.patientName}{' '}
                          {reqItem.uhid && <span className="font-mono text-slate-500">({reqItem.uhid})</span>}
                        </div>
                        <div className="text-slate-600">
                          Requested: <strong className="font-mono text-slate-900">{formatNpr(reqItem.requestedValueNpr)}</strong>
                          {reqItem.requestedPercent !== undefined ? ` (${reqItem.requestedPercent.toFixed(1)}%)` : ''}
                          {reqItem.billSubtotalNpr ? ` on Bill ${formatNpr(reqItem.billSubtotalNpr)}` : ''}
                          {reqItem.currentLimitNpr !== undefined ? ` · Current Limit ${formatNpr(reqItem.currentLimitNpr)}` : ''}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          Reason: <span className="text-slate-800">{reqItem.reason}</span> · By {reqItem.requesterName}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDcHistoryId(dcHistoryId === reqItem.id ? null : reqItem.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
                        >
                          <History className="w-3.5 h-3.5" />
                          History ({reqItem.history?.length || 0})
                        </button>
                      </div>
                    </div>

                    {dcHistoryId === reqItem.id && (
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 text-[11px]">
                        {(reqItem.history || []).map((h) => (
                          <div key={h.id} className="flex items-center justify-between gap-2 border-b border-slate-200/70 pb-1 last:border-b-0">
                            <div>
                              <strong className="font-mono">{h.action}</strong> by {h.actorName} ({h.actorRole})
                              {h.remarks ? ` — ${h.remarks}` : ''}
                            </div>
                            <span className="font-mono text-slate-500">{formatShortTimestamp(h.timestamp)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {canAct && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <input
                          value={dcRemarksMap[reqItem.id] || ''}
                          onChange={(e) => setDcRemarksMap((prev) => ({ ...prev, [reqItem.id]: e.target.value }))}
                          placeholder="Approval / Decline remarks..."
                          className="flex-1 min-w-[200px] px-3 py-1.5 border border-slate-300 rounded-lg"
                        />
                        <button
                          type="button"
                          disabled={dcBusyId === reqItem.id}
                          onClick={() => void handleDiscountCreditDecision(reqItem, 'APPROVE')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {reqItem.status === 'PENDING_MANAGER' && !isAdmin ? 'Verify & Forward to Admin' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          disabled={dcBusyId === reqItem.id}
                          onClick={() => void handleDiscountCreditDecision(reqItem, 'DECLINE')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            {dcApprovals.length === 0 && (
              <div className="p-8 text-center text-slate-500">No discount or credit approval requests recorded yet.</div>
            )}
          </div>
        </div>
      ) : financeViewTab === 'DAILY_AUTO_CHARGES' ? (
        <div className="space-y-5">
          {/* Date Range Filter & Export Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Start Date (AD) <span className="text-[10px] font-mono text-slate-500">· BS {adToBs(`${autoChargeStartDate}T12:00:00`).formattedEn}</span>
                </label>
                <div className="relative">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    value={autoChargeStartDate}
                    onChange={(e) => setAutoChargeStartDate(e.target.value)}
                    className="pl-8 pr-3 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  End Date (AD) <span className="text-[10px] font-mono text-slate-500">· BS {adToBs(`${autoChargeEndDate}T12:00:00`).formattedEn}</span>
                </label>
                <div className="relative">
                  <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="date"
                    value={autoChargeEndDate}
                    onChange={(e) => setAutoChargeEndDate(e.target.value)}
                    className="pl-8 pr-3 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Search Patient / IPD # / Ward</label>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    value={autoChargeSearch}
                    onChange={(e) => setAutoChargeSearch(e.target.value)}
                    placeholder="Filter IPD #, name, bed..."
                    className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg w-56 bg-white"
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportAutoChargesCsv}
                disabled={dailyAutoChargeReport.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                <FileDown className="w-3.5 h-3.5" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportAutoChargesPdf}
                disabled={dailyAutoChargeReport.rows.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                <FileDown className="w-3.5 h-3.5" />
                Export PDF Report
              </button>
            </div>
          </div>

          {/* 6 Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-500">Consolidated Total</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-1">
                {formatNpr(dailyAutoChargeReport.grandTotal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {dailyAutoChargeReport.patientCount} Patients · {dailyAutoChargeReport.cycleCount} Cycles
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-500">Bed Stay Charges</div>
              <div className="text-base font-bold font-mono tabular-nums text-blue-700 mt-1">
                {formatNpr(dailyAutoChargeReport.bedTotal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Auto bed-day cycles</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-500">Daily Nursing Care</div>
              <div className="text-base font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {formatNpr(dailyAutoChargeReport.nursingTotal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Auto daily nursing fee</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-500">Daily Observation</div>
              <div className="text-base font-bold font-mono tabular-nums text-indigo-700 mt-1">
                {formatNpr(dailyAutoChargeReport.observationTotal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Routine ward monitoring</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-500">Doctor Rounds</div>
              <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-1">
                {formatNpr(dailyAutoChargeReport.doctorRoundTotal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Daily physician round fee</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3.5">
              <div className="text-[11px] font-medium text-slate-500">Shift Obs Procedures</div>
              <div className="text-base font-bold font-mono tabular-nums text-amber-700 mt-1">
                {formatNpr(dailyAutoChargeReport.shiftObsTotal)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">Logged nursing shift obs</div>
            </div>
          </div>

          {/* Itemized Auto-Charge Breakdown Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Itemized Auto-Generated IPD Daily Service Charges
                </h2>
                <p className="text-[11px] text-slate-500">
                  Date range {dailyAutoChargeReport.startYmd} to {dailyAutoChargeReport.endYmd} AD · Computed using live Hospital Bed Cycle timing ({db.settings?.moduleSettings?.ipdBedCycleStartTime || '07:00'}–{db.settings?.moduleSettings?.ipdBedCycleEndTime || '19:00'}).
                </p>
              </div>
              <span className="text-xs font-mono font-semibold text-slate-700">
                {dailyAutoChargeReport.rows.length} cycle entries
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-3">Date (BS / AD)</th>
                    <th className="py-2.5 px-3">Patient &amp; IPD #</th>
                    <th className="py-2.5 px-3">Bed / Ward</th>
                    <th className="py-2.5 px-3">Cycle Window (BS)</th>
                    <th className="py-2.5 px-3 text-right">Bed (रू)</th>
                    <th className="py-2.5 px-3 text-right">Nursing (रू)</th>
                    <th className="py-2.5 px-3 text-right">Obs (रू)</th>
                    <th className="py-2.5 px-3 text-right">Dr Round (रू)</th>
                    <th className="py-2.5 px-3 text-right">Shift Obs (रू)</th>
                    <th className="py-2.5 px-3 text-right">Row Total (रू)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dailyAutoChargeReport.rows.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-slate-500">
                        No IPD daily auto-charge cycles fall within {dailyAutoChargeReport.startYmd} – {dailyAutoChargeReport.endYmd}. Expand the date range above.
                      </td>
                    </tr>
                  ) : (
                    dailyAutoChargeReport.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
                          <div className="font-semibold text-slate-900">{r.cycleDateBs}</div>
                          <div className="text-[10px] text-slate-500">{r.cycleDateAd}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{r.patientName}</div>
                          <div className="text-[11px] font-mono text-blue-700">
                            {r.admissionNumber} · {r.uhid}
                          </div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-800">{r.wardBed}</div>
                          <div className="text-[10px] text-slate-500">{r.disposition}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600">
                          <span className="font-semibold text-slate-800">
                            {r.cycleDay > 0 ? `Day ${r.cycleDay}` : 'Shift'}:
                          </span>{' '}
                          {r.timingWindowBs}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatNpr(r.bedFeeNpr)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatNpr(r.nursingFeeNpr)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatNpr(r.observationFeeNpr)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatNpr(r.doctorRoundFeeNpr)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{formatNpr(r.shiftObsFeeNpr)}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                          {formatNpr(r.rowTotalNpr)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : financeViewTab === 'LEDGER' ? (
        <div className="space-y-6 text-xs">
          {/* Treasury Scope Switcher + Pending Vouchers Quick Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-slate-700">
                Treasury &amp; Counter Scope:
              </span>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(
                  [
                    { id: 'ALL', label: `All Counters (${db.accounts.length})` },
                    {
                      id: 'HOSPITAL',
                      label: `Hospital (${db.accounts.filter((a) => a.departmentScope !== 'PHARMACY').length})`,
                    },
                    {
                      id: 'PHARMACY',
                      label: `Central Pharmacy (${db.accounts.filter((a) => a.departmentScope === 'PHARMACY').length})`,
                    },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setAccountScopeFilter(tab.id)}
                    className={`px-3 py-1 rounded-md font-medium whitespace-nowrap ${
                      accountScopeFilter === tab.id
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {queueSummary.totalPendingCount > 0 && (
              <button
                type="button"
                onClick={() => setFinanceViewTab('VOUCHERS')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-amber-900 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                {queueSummary.totalPendingCount} Pending Voucher(s) in Approvals →
              </button>
            )}
          </div>

          {/* Cash / Bank / Combined Treasury Summary KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-slate-500 font-medium">Total Cash Drawers ({accountScopeFilter})</div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {formatNpr(ledgerSummary.cashTotal)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {scopedAccounts.filter((a) => a.type === 'CASH_COUNTER').length} cash counter(s)
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-slate-500 font-medium">Total Bank Balances ({accountScopeFilter})</div>
              <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
                {formatNpr(ledgerSummary.bankTotal)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {scopedAccounts.filter((a) => a.type === 'BANK').length} bank account(s)
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-slate-500 font-medium">Combined Liquid Treasury</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {formatNpr(ledgerSummary.combinedBalance)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Live balance across {scopedAccounts.length} active account(s)
              </div>
            </div>
          </div>

          {/* Bank & Cash Account Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {scopedAccounts.map((acc) => (
              <div key={acc.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono font-semibold text-blue-700">
                    {acc.code} · {acc.departmentScope === 'PHARMACY' ? 'PHARMACY' : acc.departmentScope === 'SHARED' ? 'SHARED' : 'HOSPITAL'}
                  </span>
                  <span className="text-slate-500 inline-flex items-center gap-1">
                    {acc.type === 'BANK' ? (
                      <Landmark className="w-3.5 h-3.5" />
                    ) : (
                      <Wallet className="w-3.5 h-3.5" />
                    )}
                    {acc.type === 'BANK' ? 'Bank A/C' : 'Cash Drawer'}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-900">{acc.name}</div>
                {acc.accountNumber && (
                  <div className="text-[11px] font-mono text-slate-500">
                    A/C: {acc.accountNumber} · {acc.branch}
                  </div>
                )}
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 pt-1">
                  {formatNpr(acc.currentBalance)}
                </div>
              </div>
            ))}
          </div>

          {/* General Daybook & Cash/Bank Ledger */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  General Daybook &amp; Treasury Ledger ({activeFiscalYear})
                </h2>
                <p className="text-[11px] text-slate-500">
                  Filter chronological inflow/outflow entries by type, category, account scope, or AD date range.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadFinancialBreakdownPdf(
                      `General Daybook Ledger — FY ${activeFiscalYear}`,
                      `Scope: ${accountScopeFilter} · Direction: ${ledgerDirectionFilter} · Category: ${ledgerCategoryFilter} · ${filteredLedger.length} Entries`,
                      [
                        {
                          heading: '1. Filtered Daybook Summary',
                          columns: ['Metric', 'Amount (NPR)'],
                          rows: [
                            ['Total Inflow', formatNpr(ledgerSummary.inflow)],
                            ['Total Outflow', formatNpr(ledgerSummary.outflow)],
                            ['Net Cashflow Movement', formatNpr(ledgerSummary.net)],
                          ],
                        },
                        {
                          heading: '2. Daybook Entries',
                          columns: ['Date (BS)', 'Account', 'Category', 'Ref & Narration', 'In / Out', 'Amount', 'Balance'],
                          rows: filteredLedger.slice(0, 200).map((f) => [
                            adToBs(f.timestamp).formattedEn,
                            f.accountName,
                            f.category,
                            `${f.referenceId} · ${f.description}`,
                            f.direction,
                            formatNpr(f.amount),
                            formatNpr(f.balanceAfter),
                          ]),
                        },
                      ],
                      db.settings
                    )
                  }
                  disabled={filteredLedger.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-40 whitespace-nowrap"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  Export Daybook PDF
                </button>
              </div>
            </div>

            {/* Filter Toolbar */}
            <div className="px-5 py-3 border-b border-slate-200 bg-white flex flex-wrap items-end justify-between gap-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Direction</label>
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200">
                    {(['ALL', 'INFLOW', 'OUTFLOW'] as const).map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => setLedgerDirectionFilter(dir)}
                        className={`px-2.5 py-1 rounded-md font-semibold whitespace-nowrap ${
                          ledgerDirectionFilter === dir ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                        }`}
                      >
                        {dir === 'ALL' ? 'All' : dir === 'INFLOW' ? 'Inflow (+)' : 'Outflow (-)'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">Category</label>
                  <select
                    value={ledgerCategoryFilter}
                    onChange={(e) => setLedgerCategoryFilter(e.target.value)}
                    className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {ledgerCategories.map((c) => (
                      <option key={c} value={c}>
                        {c === 'ALL' ? 'All Categories' : c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">From Date (AD)</label>
                  <input
                    type="date"
                    value={ledgerStartDate}
                    onChange={(e) => setLedgerStartDate(e.target.value)}
                    className="px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">To Date (AD)</label>
                  <input
                    type="date"
                    value={ledgerEndDate}
                    onChange={(e) => setLedgerEndDate(e.target.value)}
                    className="px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
                {(ledgerDirectionFilter !== 'ALL' || ledgerCategoryFilter !== 'ALL' || ledgerStartDate || ledgerEndDate || searchTerm) && (
                  <button
                    type="button"
                    onClick={() => {
                      setLedgerDirectionFilter('ALL');
                      setLedgerCategoryFilter('ALL');
                      setLedgerStartDate('');
                      setLedgerEndDate('');
                      setSearchTerm('');
                    }}
                    className="px-2.5 py-1.5 font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 whitespace-nowrap"
                  >
                    Reset Filters
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-4 font-mono tabular-nums text-xs">
                <span>
                  Inflow: <strong className="text-emerald-700">+{formatNpr(ledgerSummary.inflow)}</strong>
                </span>
                <span>
                  Outflow: <strong className="text-rose-700">-{formatNpr(ledgerSummary.outflow)}</strong>
                </span>
                <span>
                  Net: <strong className={ledgerSummary.net >= 0 ? 'text-blue-700' : 'text-rose-700'}>{formatNpr(ledgerSummary.net)}</strong>
                </span>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Date (BS)</th>
                    <th className="py-2.5 px-4">Account &amp; Narration</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Recorded By</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4 text-right">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredLedger.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No ledger transactions match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLedger.map((f) => {
                      const bs = adToBs(f.timestamp);
                      return (
                        <tr key={f.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-mono tabular-nums whitespace-nowrap">
                            <div className="font-semibold text-slate-900">{bs.formattedEn}</div>
                            <div className="text-[10px] text-slate-500">{bs.timeEn}</div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900">{f.accountName}</div>
                            <div className="text-[11px] text-slate-600">
                              <span className="font-mono text-blue-700">{f.referenceId}</span> · {f.description}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{f.category}</td>
                          <td className="py-2.5 px-4 text-slate-600 whitespace-nowrap">{f.recordedBy}</td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                              f.direction === 'INFLOW' ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {f.direction === 'INFLOW' ? '+' : '-'}
                            {formatNpr(f.amount)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                            {formatNpr(f.balanceAfter)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : financeViewTab === 'COUNTER_CLOSE' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Employee Shift Counter Close Form */}
          <form
            onSubmit={handleCounterClose}
            className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-blue-600" />
                  Employee Shift Counter Close ({closeScope})
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Logged in: <strong>{activeUser.fullName}</strong> · BS {adToBs(new Date()).formattedEn}
                </p>
              </div>
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md text-[11px]">
                {(['HOSPITAL', 'PHARMACY', 'ALL'] as const).map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setCloseScope(sc)}
                    className={`px-2 py-1 rounded font-semibold ${
                      closeScope === sc ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {sc}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between text-xs bg-blue-50/70 border border-blue-200 rounded-lg px-3 py-2 cursor-pointer">
              <span className="font-medium text-blue-900">
                Count Only My Employee Shift Transactions ({activeUser.fullName})
              </span>
              <input
                type="checkbox"
                checked={closeEmployeeOnly}
                onChange={(e) => setCloseEmployeeOnly(e.target.checked)}
                className="rounded border-blue-300 text-blue-600"
              />
            </label>

            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div>
                <div className="text-slate-500">Opening Cash</div>
                <div className="font-mono tabular-nums font-semibold text-slate-900">
                  {formatNpr(counterMetrics.openingCash)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Shift Cash Collected</div>
                <div className="font-mono tabular-nums font-semibold text-emerald-700">
                  +{formatNpr(counterMetrics.cashSales)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Bank / QR Sales</div>
                <div className="font-mono tabular-nums font-semibold text-blue-700">
                  {formatNpr(counterMetrics.bankSales)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Credit / Due</div>
                <div className="font-mono tabular-nums font-semibold text-slate-700">
                  {formatNpr(counterMetrics.creditSales)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Deposits Collected</div>
                <div className="font-mono tabular-nums font-semibold text-indigo-700">
                  {formatNpr(counterMetrics.depositsCollected)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">IPD Cash Bills</div>
                <div className="font-mono tabular-nums font-semibold text-amber-700">
                  {formatNpr(counterMetrics.ipdCashBills)}
                </div>
              </div>
              <div className="col-span-2 pt-2 border-t border-slate-200 flex items-center justify-between">
                <span className="font-semibold text-slate-800">Expected Counter Cash Balance:</span>
                <span className="font-mono tabular-nums text-sm font-bold text-slate-900">
                  {formatNpr(counterMetrics.expectedCash)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Active Shift Roster</label>
                <select
                  value={counterShiftFilter}
                  onChange={(e) => {
                    const nextShift = e.target.value;
                    setCounterShiftFilter(nextShift);
                    setShiftLabel(`${nextShift} — ${activeUser.fullName}`);
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Morning (07:00-15:00)">Morning (07:00-15:00)</option>
                  <option value="Afternoon (14:00-22:00)">Afternoon (14:00-22:00)</option>
                  <option value="Night (21:30-07:30)">Night (21:30-07:30)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Shift / Counter Label</label>
                <input
                  required
                  value={shiftLabel}
                  onChange={(e) => setShiftLabel(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">
                  Physical Counted Cash (रू) *
                </label>
                <input
                  type="number"
                  required
                  value={countedCash}
                  onChange={(e) => setCountedCash(e.target.value)}
                  className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>
              <div className="sm:col-span-2 flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-slate-50 border border-slate-200">
                <span>Cash Variance (Counted − Expected):</span>
                <strong
                  className={`font-mono tabular-nums ${
                    variance === 0
                      ? 'text-emerald-700'
                      : variance > 0
                      ? 'text-blue-700'
                      : 'text-rose-700'
                  }`}
                >
                  {variance === 0
                    ? 'Balanced (रू 0)'
                    : `${variance > 0 ? '+' : ''}${formatNpr(variance)}`}
                </strong>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Closing Remarks</label>
                <input
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Denomination summary or variance note..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5 text-[11px]">
              <div className="font-semibold text-slate-800 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-blue-600" />
                  Duty Roster ({counterShiftFilter})
                </span>
                <span className="font-mono text-slate-500">{shiftDutyRoster.length} Active Staff</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {shiftDutyRoster.map((st) => (
                  <span
                    key={st.id}
                    className={`px-2 py-0.5 rounded border font-medium ${
                      st.id === activeUser.id
                        ? 'bg-blue-50 border-blue-300 text-blue-900'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    {st.fullName} ({st.department})
                  </span>
                ))}
              </div>
            </div>

            {canCloseCounter && (
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
              >
                Lock &amp; Sign Off Daily Counter Close
              </button>
            )}
          </form>

          {/* Right: Counter Close Audit Log */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Counter Close Audit Log</h2>
                <p className="text-[11px] text-slate-500">
                  Chronological shift handovers signed off by reception, pharmacy, and accounts staff.
                </p>
              </div>
              <span className="text-xs font-mono text-slate-500">
                {db.counterCloses.length} Closings
              </span>
            </div>
            <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-4">BS Date &amp; Shift</th>
                    <th className="py-2.5 px-4 text-right">Expected</th>
                    <th className="py-2.5 px-4 text-right">Counted</th>
                    <th className="py-2.5 px-4 text-right">Variance</th>
                    <th className="py-2.5 px-4">Cashier</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {db.counterCloses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        No shift counter closings logged yet.
                      </td>
                    </tr>
                  ) : (
                    db.counterCloses.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {c.counterScope || 'HOSPITAL'}
                            </span>
                            <span className="font-semibold text-slate-900">{c.shiftLabel}</span>
                          </div>
                          <div className="font-mono tabular-nums text-slate-500">
                            {c.bsDate} · {c.fiscalYear}
                            {c.depositsCollectedNpr ? ` · Dep: ${formatNpr(c.depositsCollectedNpr)}` : ''}
                            {c.ipdCashBillsNpr ? ` · IPD Cash: ${formatNpr(c.ipdCashBillsNpr)}` : ''}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatNpr(c.expectedClosingCashNpr)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {formatNpr(c.actualCountedCashNpr)}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono tabular-nums font-semibold ${
                            c.varianceNpr === 0 ? 'text-emerald-700' : 'text-amber-700'
                          }`}
                        >
                          {formatNpr(c.varianceNpr)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">
                          <div>{c.cashierName}</div>
                          {c.staffRole && (
                            <div className="text-[10px] font-mono text-slate-400">{c.staffRole}</div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        /* VOUCHERS: Voucher Entry + Live 2-Tier Manager -> Admin Approval Queue */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left 5 Cols: Submit IN/OUT Money Voucher Request */}
          <form
            onSubmit={handleVoucherSubmit}
            className="xl:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <ArrowRightLeft className="w-4 h-4 text-blue-600" />
                  Submit IN/OUT Money Voucher Request
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Routes to Manager → Admin 2-tier approval queue before posting to cash/bank ledger.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'EXPENSE', label: 'Expense' },
                  { id: 'PAYMENT', label: 'Payment' },
                  { id: 'RECEIPT', label: 'Receipt (IN)' },
                  { id: 'BANK_DEPOSIT', label: 'Bank Xfer' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setVchType(t.id)}
                  className={`py-1.5 px-1 text-[11px] font-medium rounded-md whitespace-nowrap ${
                    vchType === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    {vchType === 'BANK_DEPOSIT'
                      ? 'Source Account'
                      : vchType === 'RECEIPT'
                      ? 'Deposit Into Account'
                      : 'Pay From Account'}
                  </label>
                  <select
                    value={vchAccountId}
                    onChange={(e) => setVchAccountId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatNpr(a.currentBalance)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Amount (रू) *</label>
                  <input
                    type="number"
                    min={1}
                    step="0.01"
                    required
                    value={vchAmount}
                    onChange={(e) => setVchAmount(e.target.value)}
                    placeholder="2500"
                    className="w-full px-3 py-2 font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {vchType === 'BANK_DEPOSIT' && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    To Destination Bank Account
                  </label>
                  <select
                    value={vchTargetId}
                    onChange={(e) => setVchTargetId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatNpr(a.currentBalance)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Approval Reason *
                  </label>
                  <input
                    required
                    value={vchReason}
                    onChange={(e) => setVchReason(e.target.value)}
                    placeholder="e.g., Vendor settlement, cash deposit"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Payee / Party Name
                  </label>
                  <input
                    value={vchPayee}
                    onChange={(e) => setVchPayee(e.target.value)}
                    placeholder="Supplier, staff, or payer"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Detailed Narration / Bill Ref
                </label>
                <input
                  value={vchDesc}
                  onChange={(e) => setVchDesc(e.target.value)}
                  placeholder="Optional voucher bill reference or breakdown notes..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {canManageFinance && (
              <button
                type="submit"
                className="w-full py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
              >
                Submit Voucher for 2-Tier Approval
              </button>
            )}
          </form>

          {/* Right 7 Cols: 2-Tier Approval Queue */}
          <div className="xl:col-span-7 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-900">
                    2-Tier Voucher Approval Queue
                  </h2>
                  <span className="px-1.5 py-0.5 text-[10px] font-mono tabular-nums font-semibold bg-amber-100 text-amber-800 border border-amber-200 rounded">
                    {queueSummary.totalPendingCount} Open
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 font-mono tabular-nums">
                  Auto-polls 12s {lastPolledAt ? `· Synced ${lastPolledAt}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowLogsModal(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
                >
                  <ScrollText className="w-3.5 h-3.5 text-blue-600" />
                  View Logs
                </button>
                <button
                  type="button"
                  onClick={() => void fetchApprovalQueue(false)}
                  title="Refresh Queue Now"
                  className="p-1.5 text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPolling ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-4 divide-x divide-slate-200 border-b border-slate-200 bg-white text-center">
              <div className="py-2 px-1.5">
                <div className="text-[10px] text-slate-500 uppercase font-medium">Tier 1 Mgr</div>
                <div className="text-sm font-bold font-mono tabular-nums text-amber-700">
                  {queueSummary.pendingManagerCount}
                </div>
              </div>
              <div className="py-2 px-1.5">
                <div className="text-[10px] text-slate-500 uppercase font-medium">Tier 2 Adm</div>
                <div className="text-sm font-bold font-mono tabular-nums text-blue-700">
                  {queueSummary.pendingAdminCount}
                </div>
              </div>
              <div className="py-2 px-1.5">
                <div className="text-[10px] text-slate-500 uppercase font-medium">Pending IN</div>
                <div className="text-xs font-bold font-mono tabular-nums text-emerald-700 mt-0.5">
                  +{formatNpr(queueSummary.pendingInflowNpr)}
                </div>
              </div>
              <div className="py-2 px-1.5">
                <div className="text-[10px] text-slate-500 uppercase font-medium">Pending OUT</div>
                <div className="text-xs font-bold font-mono tabular-nums text-rose-700 mt-0.5">
                  -{formatNpr(queueSummary.pendingOutflowNpr)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 p-1.5 bg-slate-100 border-b border-slate-200">
              <button
                type="button"
                onClick={() => {
                  setQueueTab('PENDING');
                  setSelectedIds([]);
                }}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-md whitespace-nowrap ${
                  queueTab === 'PENDING'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Pending ({queueSummary.totalPendingCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setQueueTab('DECLINED');
                  setSelectedIds([]);
                }}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-md whitespace-nowrap ${
                  queueTab === 'DECLINED'
                    ? 'bg-white text-rose-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Declined ({queueSummary.declinedCount})
              </button>
              <button
                type="button"
                onClick={() => {
                  setQueueTab('APPROVED');
                  setSelectedIds([]);
                }}
                className={`py-1.5 px-2 text-[11px] font-semibold rounded-md whitespace-nowrap ${
                  queueTab === 'APPROVED'
                    ? 'bg-white text-emerald-700 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Approved ({queueSummary.approvedCount})
              </button>
            </div>

            {queueTab === 'PENDING' && (
              <div className="px-3.5 py-2.5 border-b border-slate-200 bg-slate-50/80 space-y-2">
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    {(
                      [
                        {
                          key: 'PENDING_ADMIN' as const,
                          label: `Admin Final (${queueSummary.pendingAdminCount})`,
                        },
                        {
                          key: 'PENDING_MANAGER' as const,
                          label: `Manager Tier 1 (${queueSummary.pendingManagerCount})`,
                        },
                        {
                          key: 'ALL_PENDING' as const,
                          label: `All (${queueSummary.totalPendingCount})`,
                        },
                      ]
                    ).map((st) => (
                      <button
                        key={st.key}
                        type="button"
                        onClick={() => {
                          setStageFilter(st.key);
                          setSelectedIds([]);
                        }}
                        className={`flex-1 py-1 px-1.5 text-[10px] font-semibold rounded border whitespace-nowrap ${
                          stageFilter === st.key
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-200 hover:text-slate-900'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                )}

                {visibleQueueItems.length > 0 && (isManager || isAdmin) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        disabled={actionableVisibleIds.length === 0}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      Select All ({selectedIds.length})
                    </label>

                    {selectedIds.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyActionId === 'BULK'}
                          onClick={() => void handleBulkDecision('APPROVE')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                        >
                          <CheckCheck className="w-3.5 h-3.5" />
                          Approve Selected ({selectedIds.length})
                        </button>
                        <button
                          type="button"
                          disabled={busyActionId === 'BULK'}
                          onClick={() => {
                            setDeclineNote('');
                            setDeclineTarget({
                              mode: 'BULK',
                              ids: [...selectedIds],
                              title: `Decline ${selectedIds.length} Selected Request(s)`,
                            });
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100 disabled:opacity-50 whitespace-nowrap"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Decline Selected
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="max-h-[600px] overflow-y-auto divide-y divide-slate-200">
              {visibleQueueItems.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 space-y-1">
                  <Clock className="w-6 h-6 text-slate-300 mx-auto" />
                  <div className="font-medium text-slate-700">
                    {queueTab === 'PENDING'
                      ? 'No pending requests in this approval stage'
                      : queueTab === 'DECLINED'
                      ? 'No declined voucher requests'
                      : 'No approved transactions recorded yet'}
                  </div>
                  <p className="text-[11px] text-slate-400">
                    New vouchers automatically surface here on submission or next 12s poll.
                  </p>
                </div>
              ) : (
                visibleQueueItems.map((item, idx) => {
                  const actionable = canActOnItem(item);
                  const isSelected = selectedIds.includes(item.id);
                  const isHistoryOpen = openHistoryId === item.id;
                  const isEditingReReq = reRequestEditId === item.id;
                  const isBusy = busyActionId === item.id || busyActionId === 'BULK';

                  return (
                    <div
                      key={item.id}
                      className={`p-3.5 space-y-2.5 relative transition-colors ${
                        isSelected ? 'bg-blue-50/50' : 'bg-white hover:bg-slate-50/60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          {queueTab === 'PENDING' && actionable && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectItem(item.id)}
                              aria-label={`Select ${item.requestNumber}`}
                              className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-[10px] font-mono tabular-nums text-slate-400">
                                #{idx + 1}
                              </span>
                              <span className="text-xs font-mono font-semibold text-slate-900">
                                {item.requestNumber}
                              </span>
                              <span
                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border ${
                                  item.direction === 'IN'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}
                              >
                                {item.direction === 'IN' ? (
                                  <ArrowDownLeft className="w-2.5 h-2.5" />
                                ) : (
                                  <ArrowUpRight className="w-2.5 h-2.5" />
                                )}
                                {item.direction} · {item.transactionType}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Requester: <strong className="text-slate-700">{item.requesterName}</strong> ({item.requesterRole})
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border whitespace-nowrap ${
                              item.status === 'PENDING_MANAGER'
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : item.status === 'PENDING_ADMIN'
                                ? 'bg-blue-50 text-blue-800 border-blue-200'
                                : item.status === 'APPROVED'
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                          >
                            {item.status === 'PENDING_MANAGER'
                              ? 'Tier 1: Manager'
                              : item.status === 'PENDING_ADMIN'
                              ? 'Tier 2: Admin'
                              : item.status}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setOpenHistoryId(isHistoryOpen ? null : item.id)
                            }
                            title="View History"
                            aria-label={`View History for ${item.requestNumber}`}
                            className={`p-1 rounded border transition-colors ${
                              isHistoryOpen
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-500 border-slate-200 hover:text-slate-900 hover:border-slate-300'
                            }`}
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                        <div className="min-w-0">
                          <div className="text-[10px] text-slate-500 uppercase">Requested Amount</div>
                          <div className="text-sm font-bold font-mono tabular-nums text-slate-900">
                            {formatNpr(item.amountNpr)}
                          </div>
                        </div>
                        <div className="text-right min-w-0">
                          <div className="text-[10px] text-slate-500 truncate">{item.accountName}</div>
                          {item.targetAccountName && (
                            <div className="text-[10px] font-medium text-blue-700 truncate">
                              → {item.targetAccountName}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-xs space-y-1">
                        <div>
                          <span className="text-slate-500 font-medium">Reason: </span>
                          <span className="text-slate-900 font-semibold">{item.reason}</span>
                        </div>
                        {item.description && item.description !== item.reason && (
                          <div className="text-[11px] text-slate-600">{item.description}</div>
                        )}
                        {item.payeeOrParty && (
                          <div className="text-[11px] text-slate-500">
                            Party: {item.payeeOrParty}
                          </div>
                        )}
                        {item.managerReviewedBy && item.status === 'PENDING_ADMIN' && (
                          <div className="text-[11px] text-blue-700 font-medium">
                            Tier-1 Verified by {item.managerReviewedBy}
                          </div>
                        )}
                        {item.status === 'DECLINED' && item.declineReason && (
                          <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                            Decline Reason: {item.declineReason}
                          </div>
                        )}
                      </div>

                      {isHistoryOpen && (
                        <div
                          ref={popoverRef}
                          className="z-20 bg-white border border-slate-300 rounded-lg shadow-lg p-3 space-y-2 text-[11px]"
                        >
                          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                            <span className="font-semibold text-slate-900">
                              Audit Timeline · {item.requestNumber}
                            </span>
                            <button
                              type="button"
                              onClick={() => setOpenHistoryId(null)}
                              className="text-slate-400 hover:text-slate-700"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {(item.history || []).map((h) => (
                              <div
                                key={h.id}
                                className="border border-slate-200 rounded-md p-2 bg-slate-50 space-y-0.5"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold text-slate-900">
                                    {actionLabel(h.action)}
                                  </span>
                                  <span className="font-mono tabular-nums text-[10px] text-slate-500">
                                    {formatShortTimestamp(h.timestamp)}
                                  </span>
                                </div>
                                <div className="text-slate-600">
                                  {h.actorName} ({h.actorRole}) →{' '}
                                  <span className="font-mono font-medium">{h.statusAfter}</span>
                                </div>
                                <div className="text-slate-700">{h.note}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {queueTab === 'PENDING' && actionable && (
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleSingleDecision(item, 'APPROVE')}
                            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            <Check className="w-3.5 h-3.5" />
                            {item.status === 'PENDING_ADMIN' ? 'Approve & Post' : 'Approve'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setDeclineNote('');
                              setDeclineTarget({
                                mode: 'SINGLE',
                                ids: [item.id],
                                title: `Decline ${item.requestNumber} (${formatNpr(item.amountNpr)})`,
                              });
                            }}
                            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-2.5 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 disabled:opacity-50 whitespace-nowrap"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Decline
                          </button>
                        </div>
                      )}

                      {queueTab === 'DECLINED' && !isEditingReReq && (
                        <div className="pt-1">
                          <button
                            type="button"
                            onClick={() => startReRequestEdit(item)}
                            className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Re-Request / Re-Apply
                          </button>
                        </div>
                      )}

                      {queueTab === 'DECLINED' && isEditingReReq && (
                        <form
                          onSubmit={(e) => void handleReRequestSubmit(e, item)}
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2 text-xs"
                        >
                          <div className="font-semibold text-slate-800">
                            Revise &amp; Re-Apply {item.requestNumber}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                                Amount (रू)
                              </label>
                              <input
                                type="number"
                                min={1}
                                step="0.01"
                                required
                                value={reReqAmount}
                                onChange={(e) => setReReqAmount(e.target.value)}
                                className="w-full px-2 py-1 font-mono tabular-nums border border-slate-300 rounded bg-white"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-slate-600 mb-0.5">
                                Updated Reason
                              </label>
                              <input
                                required
                                value={reReqReason}
                                onChange={(e) => setReReqReason(e.target.value)}
                                className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                              />
                            </div>
                          </div>
                          <input
                            value={reReqDesc}
                            onChange={(e) => setReReqDesc(e.target.value)}
                            placeholder="Updated narration"
                            className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                          />
                          <input
                            value={reReqNote}
                            onChange={(e) => setReReqNote(e.target.value)}
                            placeholder="Justification note for Manager & Admin..."
                            className="w-full px-2 py-1 border border-slate-300 rounded bg-white"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={isBusy}
                              className="flex-1 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded hover:bg-blue-700 whitespace-nowrap"
                            >
                              Submit Re-Request
                            </button>
                            <button
                              type="button"
                              onClick={() => setReRequestEditId(null)}
                              className="px-3 py-1.5 text-xs border border-slate-300 rounded bg-white"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddAcc && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">New Bank / Cash Account</h3>
              <button
                type="button"
                onClick={() => setShowAddAcc(false)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Account Code *</label>
                  <input
                    required
                    value={accCode}
                    onChange={(e) => setAccCode(e.target.value.toUpperCase())}
                    placeholder="ACC-2003"
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={accType}
                    onChange={(e) => setAccType(e.target.value as BankCashAccount['type'])}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="BANK">Bank Account</option>
                    <option value="CASH_COUNTER">Cash Counter</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Entity / Department Scope</label>
                  <select
                    value={accScope}
                    onChange={(e) => setAccScope(e.target.value as 'HOSPITAL' | 'PHARMACY' | 'SHARED')}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-medium"
                  >
                    <option value="HOSPITAL">Hospital Clinical &amp; Diagnostic Banking</option>
                    <option value="PHARMACY">Central Pharmacy Counter &amp; Banking</option>
                    <option value="SHARED">Shared Corporate Account</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Account Name *</label>
                  <input
                    required
                    value={accName}
                    onChange={(e) => setAccName(e.target.value)}
                    placeholder="Global IME Bank — Payroll Account"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Account Number</label>
                  <input
                    value={accNumber}
                    onChange={(e) => setAccNumber(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Opening Balance (रू)</label>
                  <input
                    type="number"
                    value={accBalance}
                    onChange={(e) => setAccBalance(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono tabular-nums border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddAcc(false)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Decline Confirmation Modal (No window.prompt) */}
      {declineTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-rose-50">
              <h3 className="text-sm font-semibold text-rose-900">{declineTarget.title}</h3>
              <button
                type="button"
                onClick={() => setDeclineTarget(null)}
                className="p-1 text-rose-700 hover:text-rose-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleConfirmDecline(e)} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Decline Reason / Instructions for Re-Request *
                </label>
                <textarea
                  rows={3}
                  required
                  value={declineNote}
                  onChange={(e) => setDeclineNote(e.target.value)}
                  placeholder="Specify missing bill copy, budget adjustment, or correction required..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-rose-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setDeclineTarget(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 whitespace-nowrap"
                >
                  Confirm Decline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detailed Audit Trail Modal ('View Logs') */}
      {showLogsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-blue-600" />
                  2-Tier Approval Detailed Transaction Audit Logs
                </h3>
                <p className="text-[11px] text-slate-500">
                  Complete chronological audit trail of every status change across IN/OUT requests.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowLogsModal(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={logsSearch}
                  onChange={(e) => setLogsSearch(e.target.value)}
                  placeholder="Filter logs by Request #, Actor, Reason, or Note..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <select
                value={logsFilter}
                onChange={(e) => setLogsFilter(e.target.value)}
                className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="ALL">All Status Changes</option>
                <option value="REQUESTED">Requested</option>
                <option value="APPROVED_BY_MANAGER">Approved by Manager</option>
                <option value="APPROVED_BY_ADMIN">Approved by Admin</option>
                <option value="DECLINED">Declined</option>
                <option value="RE_REQUESTED">Re-Requested</option>
              </select>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Request &amp; Type</th>
                    <th className="py-2.5 px-4 text-right">Amount</th>
                    <th className="py-2.5 px-4">Status Change</th>
                    <th className="py-2.5 px-4">Actor &amp; Note</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flattenedAuditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No audit trail entries match your filter.
                      </td>
                    </tr>
                  ) : (
                    flattenedAuditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 font-mono tabular-nums text-[11px] text-slate-500 whitespace-nowrap">
                          {formatShortTimestamp(log.timestamp)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-mono font-semibold text-slate-900">
                            {log.requestNumber}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {log.direction} · {log.transactionType} · {log.reason}
                          </div>
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                          {formatNpr(log.amountNpr)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">
                            {actionLabel(log.action)}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500">
                            → {log.statusAfter}
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-medium text-slate-800">
                            {log.actorName}{' '}
                            <span className="text-[10px] font-mono text-slate-500">
                              ({log.actorRole})
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600">{log.note}</div>
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

      {/* Hospital Asset Add/Edit Modal */}
      {assetModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingAsset ? `Edit Asset · ${editingAsset.assetCode}` : 'Register Hospital / Pharmacy Asset'}
              </h3>
              <button type="button" onClick={() => setAssetModalOpen(false)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveAsset(e)} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Asset Code *</label>
                  <input required value={astCode} onChange={(e) => setAstCode(e.target.value.toUpperCase())} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Department Scope</label>
                  <select value={astScope} onChange={(e) => setAstScope(e.target.value as HospitalAsset['departmentScope'])} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                    <option value="HOSPITAL">HOSPITAL</option>
                    <option value="PHARMACY">PHARMACY</option>
                    <option value="SHARED">SHARED</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Asset Name *</label>
                  <input required value={astName} onChange={(e) => setAstName(e.target.value)} placeholder="Digital X-Ray 500mA / Biochemistry Analyzer..." className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <select value={astCategory} onChange={(e) => setAstCategory(e.target.value as HospitalAsset['category'])} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                    <option value="Medical Equipment">Medical Equipment</option>
                    <option value="Lab Analyzer">Lab Analyzer</option>
                    <option value="Radiology / Imaging">Radiology / Imaging</option>
                    <option value="IT & Server">IT &amp; Server</option>
                    <option value="Furniture & Building">Furniture &amp; Building</option>
                    <option value="Ambulance / Vehicle">Ambulance / Vehicle</option>
                    <option value="Other Asset">Other Asset</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Status</label>
                  <select value={astStatus} onChange={(e) => setAstStatus(e.target.value as HospitalAsset['status'])} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                    <option value="Active">Active</option>
                    <option value="Under Maintenance">Under Maintenance</option>
                    <option value="Disposed">Disposed</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Location / Room</label>
                  <input value={astLocation} onChange={(e) => setAstLocation(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Purchase Date</label>
                  <input type="date" value={astPurchaseDate} onChange={(e) => setAstPurchaseDate(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Purchase Cost (रू) *</label>
                  <input type="number" required min={0} value={astPurchaseCost} onChange={(e) => setAstPurchaseCost(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Current Book Value (रू)</label>
                  <input type="number" min={0} value={astCurrentValue} onChange={(e) => setAstCurrentValue(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Vendor / Supplier</label>
                  <input value={astVendor} onChange={(e) => setAstVendor(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Warranty Until</label>
                  <input value={astWarranty} onChange={(e) => setAstWarranty(e.target.value)} placeholder="2028-12-31" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Notes</label>
                  <input value={astNotes} onChange={(e) => setAstNotes(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setAssetModalOpen(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                  Save Asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Add/Edit Modal */}
      {supplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingSupplier ? `Edit Supplier · ${editingSupplier.code}` : 'Add Supplier / Party Ledger'}
              </h3>
              <button type="button" onClick={() => setSupplierModalOpen(false)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleSaveSupplier(e)} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Party Code *</label>
                  <input required value={supCode} onChange={(e) => setSupCode(e.target.value.toUpperCase())} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">PAN / VAT #</label>
                  <input value={supPanVat} onChange={(e) => setSupPanVat(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Supplier / Party Name *</label>
                  <input required value={supName} onChange={(e) => setSupName(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contact Person</label>
                  <input value={supContact} onChange={(e) => setSupContact(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Phone</label>
                  <input value={supPhone} onChange={(e) => setSupPhone(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Address</label>
                  <input value={supAddress} onChange={(e) => setSupAddress(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Terms</label>
                  <select value={supTerms} onChange={(e) => setSupTerms(e.target.value as PharmacySupplier['paymentTerms'])} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                    <option value="Cash on Delivery">Cash on Delivery</option>
                    <option value="Credit 7 Days">Credit 7 Days</option>
                    <option value="Credit 15 Days">Credit 15 Days</option>
                    <option value="Credit 30 Days">Credit 30 Days</option>
                    <option value="Credit 45 Days">Credit 45 Days</option>
                    <option value="Credit 60 Days">Credit 60 Days</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Credit Days</label>
                  <input type="number" min={0} value={supCreditDays} onChange={(e) => setSupCreditDays(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Current Due Balance (रू)</label>
                  <input type="number" min={0} value={supOpeningDue} onChange={(e) => setSupOpeningDue(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setSupplierModalOpen(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                  Save Supplier
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Supplier Due Modal */}
      {payDueTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-emerald-50">
              <h3 className="text-sm font-semibold text-emerald-950 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4" />
                Settle Due — {payDueTarget.name}
              </h3>
              <button type="button" onClick={() => setPayDueTarget(null)} className="p-1 text-emerald-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handlePaySupplierDue(e)} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex justify-between">
                <span>Outstanding Due:</span>
                <strong className="font-mono text-rose-700">{formatNpr(payDueTarget.currentDueNpr)}</strong>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Pay From Account *</label>
                <select value={payDueAccountId} onChange={(e) => setPayDueAccountId(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                  {db.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({formatNpr(a.currentBalance)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Payment Amount (रू) *</label>
                <input type="number" required min={1} max={payDueTarget.currentDueNpr} step="0.01" value={payDueAmount} onChange={(e) => setPayDueAmount(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Voucher / Cheque / Reference #</label>
                <input value={payDueRef} onChange={(e) => setPayDueRef(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes</label>
                <input value={payDueNotes} onChange={(e) => setPayDueNotes(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setPayDueTarget(null)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700">
                  Post Settlement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Collect Patient Credit Due Modal */}
      {collectDueTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-emerald-50">
              <h3 className="text-sm font-semibold text-emerald-950 flex items-center gap-1.5">
                <CreditCard className="w-4 h-4" />
                Collect Due — {collectDueTarget.patientName}
              </h3>
              <button
                type="button"
                onClick={() => setCollectDueTarget(null)}
                className="p-1 text-emerald-700 hover:text-emerald-950"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={(e) => void handleCollectPatientDue(e)} className="p-5 space-y-3 text-xs">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Invoice / Bill Ref:</span>
                  <span className="font-mono font-semibold text-blue-700">
                    {collectDueTarget.kind} · {collectDueTarget.ref}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">UHID:</span>
                  <span className="font-mono text-slate-800">{collectDueTarget.uhid}</span>
                </div>
                <div className="flex justify-between pt-1 border-t border-slate-200">
                  <span className="font-semibold text-slate-700">Remaining Due:</span>
                  <strong className="font-mono tabular-nums text-rose-700">
                    {formatNpr(collectDueTarget.dueNpr)}
                  </strong>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Payment Mode *</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['Cash', 'Bank / QR'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setCollectDueMode(mode)}
                      className={`py-2 px-3 rounded-lg font-semibold border transition-colors ${
                        collectDueMode === mode
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {collectDueMode === 'Bank / QR' && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Destination Bank Account *</label>
                  <select
                    value={collectDueAccountId}
                    onChange={(e) => setCollectDueAccountId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.accounts
                      .filter((a) => a.type === 'BANK')
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({formatNpr(a.currentBalance)})
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Amount Collected (रू) *</label>
                <input
                  type="number"
                  required
                  min={1}
                  max={collectDueTarget.dueNpr}
                  step="0.01"
                  value={collectDueAmount}
                  onChange={(e) => setCollectDueAmount(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono tabular-nums border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Receipt / Remarks</label>
                <input
                  value={collectDueNote}
                  onChange={(e) => setCollectDueNote(e.target.value)}
                  placeholder="Optional receipt number or settlement remark..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCollectDueTarget(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={collectingDue}
                  className="px-4 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {collectingDue ? 'Posting...' : 'Post Due Collection'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
