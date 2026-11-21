import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Keyboard,
  Lock,
  Printer,
  Receipt,
  Search,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  AgeType,
  CounterCloseRecord,
  EncounterType,
  LabOrder,
  LabServiceTest,
  LimsDatabase,
  PatientGender,
  PatientRecord,
  PaymentMode,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { getRegistrationFieldRule } from '../utils/registrationFields';
import { detectPatientEncounter } from '../utils/patientEncounter';
import { normalizeNepalPhone, stripCountryPrefixForEdit } from '../utils/textFormat';

export interface BillingEncounterHandoff {
  patient: PatientRecord;
  encounterType: EncounterType;
  encounterId?: string;
  encounterLabel: string;
}

interface PosBillingViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  onPrintBill: (order: LabOrder) => void;
  onPrintReport: (order: LabOrder) => void;
  preselectedEncounter?: BillingEncounterHandoff | null;
  onClearPreselectedEncounter?: () => void;
}

const ENCOUNTER_BADGE_STYLES: Record<EncounterType, string> = {
  EMERGENCY: 'bg-rose-600 text-white border-rose-700',
  IPD: 'bg-indigo-600 text-white border-indigo-700',
  OPD: 'bg-blue-600 text-white border-blue-700',
  WALKING: 'bg-emerald-600 text-white border-emerald-700',
};

export function PosBillingView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onUpdated,
  onPrintBill,
  onPrintReport,
  preselectedEncounter,
  onClearPreselectedEncounter,
}: PosBillingViewProps) {
  const modSettings = db.settings?.moduleSettings;
  const isAdminUser = activeUser.roleId === 'SUPER_ADMIN' || activeUser.roleId === 'SAAS_ADMIN';
  const hospitalBanks = useMemo(
    () => db.accounts.filter((a) => a.type === 'BANK' && a.departmentScope !== 'PHARMACY'),
    [db.accounts]
  );

  // Patient Registration & Encounter Context
  const [patientId, setPatientId] = useState<string>('');
  const [uhid, setUhid] = useState<string>('');
  const [encounterType, setEncounterType] = useState<EncounterType>('WALKING');
  const [encounterId, setEncounterId] = useState<string>('');
  const [encounterLabel, setEncounterLabel] = useState<string>('Walk-In Direct');
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [patientAgeType, setPatientAgeType] = useState<AgeType>('Years');
  const [patientGender, setPatientGender] = useState<PatientGender>('Female');
  const [patientAddress, setPatientAddress] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [referralPartnerId, setReferralPartnerId] = useState<string>('');
  const [referringDoctor, setReferringDoctor] = useState('');
  const [priority, setPriority] = useState<'Routine' | 'STAT'>('Routine');
  const [nonInventoryBillOnly, setNonInventoryBillOnly] = useState(false);
  const [hidePatientDetails, setHidePatientDetails] = useState(false);

  // Test Cart & Pricing (Start empty — let user pick service first)
  const [testSearch, setTestSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [customPrices, setCustomPrices] = useState<Record<string, number>>({});
  const [discountType, setDiscountType] = useState<'NPR' | 'PERCENT'>('NPR');
  const [discountVal, setDiscountVal] = useState('0');
  const [appliedApprovalId, setAppliedApprovalId] = useState<string>('');
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [approvalStatusNote, setApprovalStatusNote] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [cashPaid, setCashPaid] = useState('');
  const [bankPaid, setBankPaid] = useState('');
  const [bankAccountId, setBankAccountId] = useState(
    hospitalBanks[0]?.id || db.accounts.find((a) => a.type === 'BANK')?.id || ''
  );

  const [submitting, setSubmitting] = useState(false);
  const [fetchingServices, setFetchingServices] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeServiceIdx, setActiveServiceIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);

  // Per-Employee Hospital Counter Close Modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeShiftLabel, setCloseShiftLabel] = useState(
    `${activeUser.shift || 'Hospital Shift'} — ${activeUser.fullName}`
  );
  const [closeEmployeeOnly, setCloseEmployeeOnly] = useState(true);
  const [closeCountedCash, setCloseCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closingCounter, setClosingCounter] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const checkoutDiscountRef = useRef<HTMLInputElement>(null);
  const checkoutTenderedRef = useRef<HTMLInputElement>(null);
  const submitBillBtnRef = useRef<HTMLButtonElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Dynamic registration field rules for Hospital POS
  const fieldRule = (key: string) => getRegistrationFieldRule(modSettings, 'pos', key);

  const customCategories = useMemo(() => {
    const configured = db.settings.moduleSettings?.customServiceCategories || [];
    const fromServices = db.services.map(
      (s) =>
        s.customCategory?.trim() ||
        (s.serviceCategory === 'CONSULTATION'
          ? 'Consultation'
          : s.serviceCategory === 'HOSPITAL_PROCEDURE'
          ? 'Procedures'
          : s.serviceCategory === 'RADIOLOGY'
          ? 'Radiology'
          : s.serviceCategory === 'EMERGENCY'
          ? 'Emergency'
          : 'Diagnostics')
    );
    return Array.from(new Set([...configured, ...fromServices]));
  }, [db.services, db.settings.moduleSettings?.customServiceCategories]);

  const getServiceCategoryLabel = (s: LabServiceTest) =>
    s.customCategory?.trim() ||
    (s.serviceCategory === 'CONSULTATION'
      ? 'Consultation'
      : s.serviceCategory === 'HOSPITAL_PROCEDURE'
      ? 'Procedures'
      : s.serviceCategory === 'RADIOLOGY'
      ? 'Radiology'
      : s.serviceCategory === 'EMERGENCY'
      ? 'Emergency'
      : 'Diagnostics');

  const applyPatientRecord = (
    pt: PatientRecord,
    encTypeOverride?: EncounterType,
    encId = '',
    encLabel = ''
  ) => {
    const det = !encTypeOverride ? detectPatientEncounter(db, pt) : null;
    const resolvedType = encTypeOverride || det?.encounterType || 'WALKING';
    const resolvedId = encId || det?.encounterId || '';
    const resolvedLabel = encLabel || det?.encounterLabel || `${resolvedType} · ${pt.uhid}`;
    setPatientId(pt.id);
    setUhid(pt.uhid);
    setEncounterType(resolvedType);
    setEncounterId(resolvedId);
    setEncounterLabel(resolvedLabel);
    setPatientName(pt.fullName);
    setPatientAge(String(pt.age));
    setPatientAgeType(pt.ageType);
    setPatientGender(pt.gender);
    setPatientAddress(pt.address);
    setPatientPhone(stripCountryPrefixForEdit(pt.phone));
    if (det?.attendingDoctor && !referringDoctor) {
      setReferringDoctor(det.attendingDoctor);
    }
    setHidePatientDetails(true);
    setAppliedApprovalId('');
    setApprovalStatusNote(null);
  };

  useEffect(() => {
    if (preselectedEncounter) {
      applyPatientRecord(
        preselectedEncounter.patient,
        preselectedEncounter.encounterType,
        preselectedEncounter.encounterId || '',
        preselectedEncounter.encounterLabel
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedEncounter]);

  const nowBs = adToBs(new Date());

  const selectedServices = useMemo(
    () => db.services.filter((s) => selectedIds.includes(s.id)),
    [db.services, selectedIds]
  );

  const getEffectivePrice = (s: LabServiceTest) =>
    customPrices[s.id] !== undefined ? customPrices[s.id] : s.price;

  const subtotal = useMemo(
    () => selectedServices.reduce((sum, s) => sum + getEffectivePrice(s), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedServices, customPrices]
  );

  const discountNpr = useMemo(() => {
    const raw = Number(discountVal) || 0;
    if (discountType === 'PERCENT') {
      return Math.min(subtotal, Math.round((subtotal * raw) / 100));
    }
    return Math.min(subtotal, Math.max(0, raw));
  }, [discountType, discountVal, subtotal]);

  const maxCashierDiscPct = modSettings?.maxCashierDiscountPercent ?? 15;
  const maxCashierDiscNpr = modSettings?.cashierMaxDiscountNpr ?? 1000;
  const discountPctOfBill = subtotal > 0 ? Number(((discountNpr / subtotal) * 100).toFixed(1)) : 0;

  const approvedPosDiscounts = useMemo(() => {
    return (db.discountCreditApprovals || []).filter(
      (a) =>
        a.status === 'APPROVED' &&
        !a.consumedAt &&
        a.requestType === 'DISCOUNT_OVERRIDE' &&
        a.sourceModule === 'HOSPITAL_POS' &&
        (!uhid || !a.uhid || a.uhid === uhid)
    );
  }, [db.discountCreditApprovals, uhid]);

  const activeApprovedDiscount = useMemo(
    () => approvedPosDiscounts.find((a) => a.id === appliedApprovalId),
    [approvedPosDiscounts, appliedApprovalId]
  );

  const discountExceedsCashierCap =
    !isAdminUser &&
    discountNpr > 0 &&
    (discountNpr > maxCashierDiscNpr || discountPctOfBill > maxCashierDiscPct);

  const discountBlockedWaitingApproval =
    discountExceedsCashierCap &&
    (!activeApprovedDiscount || discountNpr > activeApprovedDiscount.requestedValueNpr);

  const netTotal = Math.max(0, subtotal - discountNpr);

  const effectiveCash =
    paymentMode === 'Cash'
      ? cashPaid === ''
        ? netTotal
        : Number(cashPaid) || 0
      : paymentMode === 'Split'
      ? Number(cashPaid) || 0
      : 0;

  const effectiveBank =
    paymentMode === 'Bank / QR'
      ? bankPaid === ''
        ? netTotal
        : Number(bankPaid) || 0
      : paymentMode === 'Split'
      ? Number(bankPaid) || 0
      : 0;

  const filteredServices = useMemo(() => {
    const q = testSearch.trim().toLowerCase();
    return db.services.filter((s) => {
      if (!s.active) return false;
      // Search scans ALL Hospital/X-Ray/USG/Lab categories when query is entered
      if (!q && selectedCategory !== 'ALL' && getServiceCategoryLabel(s) !== selectedCategory) return false;
      return (
        !q ||
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q) ||
        getServiceCategoryLabel(s).toLowerCase().includes(q)
      );
    });
  }, [db.services, testSearch, selectedCategory]);

  useEffect(() => {
    setActiveServiceIdx(0);
  }, [testSearch, selectedCategory]);

  const toggleService = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // DOS-Speed Keyboard Entry Shortcuts (Windows ERP design)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (showCloseModal) return;
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setPaymentMode((prev) =>
          prev === 'Cash' ? 'Bank / QR' : prev === 'Bank / QR' ? 'Split' : 'Cash'
        );
      } else if (e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showCloseModal]);

  const shiftLivePreview = useMemo(() => {
    const lastClose = (db.counterCloses || []).find((c) => {
      const sameScope = (c.counterScope || 'HOSPITAL') === 'HOSPITAL';
      const sameCashier = !closeEmployeeOnly || c.cashierId === activeUser.id;
      return sameScope && sameCashier;
    });
    const lastTime = lastClose ? new Date(lastClose.closedAt).getTime() : 0;
    const openingCash = lastClose ? lastClose.actualCountedCashNpr : 0;
    const scopeOrders = db.orders.filter(
      (o) =>
        new Date(o.orderedAt).getTime() > lastTime &&
        (!closeEmployeeOnly || !o.createdById || o.createdById === activeUser.id)
    );
    const scopeIpdBills = (db.ipdAdmissions || []).flatMap((a) =>
      (a.ipdIndividualBills || []).filter(
        (b) =>
          new Date(b.billedAt).getTime() > lastTime &&
          (!closeEmployeeOnly || !b.billedById || b.billedById === activeUser.id)
      )
    );
    const orderCash = scopeOrders.reduce((s, o) => s + (o.cashPaid || 0), 0);
    const orderBank = scopeOrders.reduce((s, o) => s + (o.bankPaid || 0), 0);
    const ipdCash = scopeIpdBills
      .filter((b) => b.paymentMode !== 'Bank / QR')
      .reduce((s, b) => s + (b.amountNpr || 0), 0);
    const ipdBank = scopeIpdBills
      .filter((b) => b.paymentMode === 'Bank / QR')
      .reduce((s, b) => s + (b.amountNpr || 0), 0);
    return {
      orderCount: scopeOrders.length,
      ipdBillCount: scopeIpdBills.length,
      expectedCash: Math.round(openingCash + orderCash + ipdCash),
      expectedBank: Math.round(orderBank + ipdBank),
    };
  }, [db.counterCloses, db.orders, db.ipdAdmissions, closeEmployeeOnly, activeUser.id]);

  const handleFetchHospitalServices = async () => {
    setFetchingServices(true);
    try {
      const resp = await apiRequest<{ addedServices?: number; addedCount?: number; db: LimsDatabase }>(
        '/api/services/fetch-hospital-catalog',
        activeUser.id,
        { method: 'POST', body: JSON.stringify({}) }
      );
      const added = resp.addedServices ?? resp.addedCount ?? 0;
      onUpdated(
        resp.db,
        added > 0
          ? `Fetched ${added} Hospital X-Ray, DR X-Ray, USG, ECG & Procedure items.`
          : 'All X-Ray, DR X-Ray, USG & Clinical Procedure items are already active.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to fetch hospital service catalog.');
    } finally {
      setFetchingServices(false);
    }
  };

  const handleFetchLabTests = async () => {
    setFetchingServices(true);
    try {
      const resp = await apiRequest<{
        addedServices?: number;
        labServicesCount?: number;
        db: LimsDatabase;
      }>('/api/services/fetch-lab-catalog', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const added = resp.addedServices ?? 0;
      onUpdated(
        resp.db,
        added > 0
          ? `Auto-fetched ${added} laboratory test panels (${resp.labServicesCount || 0} lab panels active).`
          : `All ${resp.labServicesCount || 0} hospital laboratory tests are already active.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to auto-fetch laboratory tests.');
    } finally {
      setFetchingServices(false);
    }
  };

  const handleCloseHospitalCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    setClosingCounter(true);
    try {
      const resp = await apiRequest<{ record: CounterCloseRecord; db: LimsDatabase }>(
        '/api/finance/counter-close',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            shiftLabel: closeShiftLabel.trim() || `Hospital Shift — ${activeUser.fullName}`,
            actualCountedCashNpr: Number(closeCountedCash || shiftLivePreview.expectedCash) || 0,
            notes: closeNotes.trim(),
            counterScope: 'HOSPITAL',
            employeeOnly: closeEmployeeOnly,
          }),
        }
      );
      setShowCloseModal(false);
      setCloseCountedCash('');
      setCloseNotes('');
      onUpdated(
        resp.db,
        `Closed Hospital Counter (${resp.record.shiftLabel}) · Cash ${formatNpr(resp.record.expectedClosingCashNpr)} · Variance ${formatNpr(resp.record.varianceNpr)}.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Counter close failed.');
    } finally {
      setClosingCounter(false);
    }
  };

  const handleRequestDiscountApproval = async () => {
    if (discountNpr <= 0) return;
    setRequestingApproval(true);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ approval: { requestNumber: string; approvalPolicy: string }; db: LimsDatabase }>(
        '/api/approvals/discount-credit',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            requestType: 'DISCOUNT_OVERRIDE',
            sourceModule: 'HOSPITAL_POS',
            patientName: patientName.trim() || 'Walk-In Patient',
            uhid: uhid || undefined,
            encounterLabel,
            billSubtotalNpr: subtotal,
            requestedValueNpr: discountNpr,
            requestedPercent: discountPctOfBill,
            reason: `Cashier discount रू ${discountNpr} (${discountPctOfBill}%) exceeds limit (${maxCashierDiscPct}% / रू ${maxCashierDiscNpr}).`,
          }),
        }
      );
      setApprovalStatusNote(
        `Sent ${resp.approval.requestNumber} for ${
          resp.approval.approvalPolicy === 'ADMIN_ONLY' ? 'Admin' : 'Manager → Admin'
        } approval.`
      );
      onUpdated(resp.db, `Submitted discount approval request ${resp.approval.requestNumber}.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit discount approval request.');
    } finally {
      setRequestingApproval(false);
    }
  };

  const handleSubmitBill = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (selectedIds.length === 0) {
      setErrorMsg('Please select at least one Hospital / Diagnostic service first.');
      return;
    }
    if (discountBlockedWaitingApproval) {
      setErrorMsg(
        `Discount ${formatNpr(discountNpr)} (${discountPctOfBill}%) exceeds cashier limit (${maxCashierDiscPct}% / ${formatNpr(
          maxCashierDiscNpr
        )}). Submit for Admin approval or lower the discount.`
      );
      return;
    }
    setSubmitting(true);
    try {
      const normalizedPhone = normalizeNepalPhone(patientPhone);
      const resp = await apiRequest<{ order: LabOrder; db: any }>('/api/orders', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          patientId: patientId || undefined,
          uhid: uhid || undefined,
          encounterType,
          encounterId: encounterId || undefined,
          encounterLabel: encounterLabel || `${encounterType}`,
          nonInventoryBillOnly,
          patientName: patientName.trim() || 'Walk-In Patient',
          patientAge: Number(patientAge) || 30,
          patientAgeType,
          patientGender,
          patientAddress: patientAddress.trim() || 'Hospital Counter',
          patientPhone: normalizedPhone || 'N/A',
          collectionCenterId: null,
          referralPartnerId: referralPartnerId || null,
          referringDoctor,
          priority,
          serviceIds: selectedIds,
          customPrices,
          discountAmount: discountNpr,
          paymentMode,
          cashPaid: effectiveCash,
          bankPaid: effectiveBank,
          bankAccountId,
          fiscalYear: activeFiscalYear,
        }),
      });
      onUpdated(
        resp.db,
        `POS Bill ${resp.order.invoiceNumber} generated (${formatNpr(resp.order.totalAmount)})${
          nonInventoryBillOnly ? ' [Bill-Only · Zero Stock Deducted]' : ''
        }.`
      );
      setPatientId('');
      setUhid('');
      setEncounterId('');
      setEncounterType('WALKING');
      setEncounterLabel('Walk-In Direct');
      setPatientName('');
      setPatientAge('');
      setPatientAddress('');
      setPatientPhone('');
      setHidePatientDetails(false);
      setSelectedIds([]);
      setDiscountVal('0');
      setAppliedApprovalId('');
      setApprovalStatusNote(null);
      setCustomPrices({});
      setCashPaid('');
      setBankPaid('');
      onClearPreselectedEncounter?.();
      onPrintBill(resp.order);
    } catch (err: any) {
      setErrorMsg(err.message || 'POS billing failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Hospital Main POS Billing Counter
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Hospital Services Only (Lab, Conventional X-Ray, DR X-Ray, USG, ECG &amp; Procedures — Pharmacy runs on separate Pharmacy Counter).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasPerm('services.manage') && (
            <>
              <button
                type="button"
                onClick={handleFetchLabTests}
                disabled={fetchingServices}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {fetchingServices ? 'Fetching...' : 'Fetch All Lab Tests'}
              </button>
              <button
                type="button"
                onClick={handleFetchHospitalServices}
                disabled={fetchingServices}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {fetchingServices ? 'Fetching...' : 'Fetch X-Ray / DR / USG Services'}
              </button>
            </>
          )}
          {hasPerm('counter.close') && (
            <button
              type="button"
              onClick={() => {
                setCloseCountedCash(String(shiftLivePreview.expectedCash));
                setShowCloseModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              My Shift Counter Close
            </button>
          )}
          <div className="text-right text-xs font-mono text-slate-700 bg-white border border-slate-200 rounded-lg px-3.5 py-1.5">
            <div>
              नेपाली मिति: <strong>{nowBs.formattedNp}</strong> · {nowBs.timeNp}
            </div>
            <div className="text-slate-500">
              {nowBs.formattedEn} · {activeFiscalYear}
            </div>
          </div>
        </div>
      </div>

      {/* Mode Switcher: Hospital Standard POS vs Non-Inventory Billing Module */}
      <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setNonInventoryBillOnly(false)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              !nonInventoryBillOnly ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'
            }`}
          >
            Hospital POS (Standard)
          </button>
          <button
            type="button"
            onClick={() => setNonInventoryBillOnly(true)}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
              nonInventoryBillOnly ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'
            }`}
          >
            Non-Inventory Billing (Bill-Only)
          </button>
        </div>
        <div className="text-[11px] font-mono text-slate-600 px-2">
          {nonInventoryBillOnly
            ? 'NON-INVENTORY MODE: Bills live Hospital Services without deducting reagents or X-ray films.'
            : 'STANDARD POS: Auto-queues Lab/Radiology specimens & deducts BOM on validation.'}
        </div>
      </div>

      {/* Windows-Styled Fast DOS Entry Command Strip */}
      <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-2 flex flex-wrap items-center justify-between gap-3 text-[11px] font-mono">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
            <Keyboard className="w-3.5 h-3.5" />
            DOS FAST POS:
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300">F2</kbd> Type Service
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300">↑/↓ + Enter</kbd> Add Service
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300">Enter (Blank)</kbd> Checkout
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300">F4</kbd> Mode ({paymentMode})
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-amber-300">F9 / Ctrl+Enter</kbd> Save &amp; Print
          </span>
        </div>
        <div className="text-slate-300">
          Operator: <strong className="text-white">{activeUser.fullName}</strong> · Shift: <strong>{activeUser.shift}</strong>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmitBill} className="grid grid-cols-1 xl:grid-cols-3 gap-5">
        {/* Left 2 Columns: Patient Selection + Test Selection */}
        <div className="xl:col-span-2 space-y-4">
          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="p-1 text-rose-700 hover:bg-rose-100 rounded shrink-0"
                title="Close Alert"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Patient & Encounter Selection Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-900">
                1. Patient &amp; Encounter Selection (UHID / OPD / ER / IPD / Walk-In)
              </h2>
              <div className="flex items-center gap-2">
                {(uhid || patientName) && (
                  <button
                    type="button"
                    onClick={() => {
                      setPatientId('');
                      setUhid('');
                      setEncounterId('');
                      setEncounterType('WALKING');
                      setEncounterLabel('Walk-In Direct');
                      setPatientName('');
                      setPatientPhone('');
                      setPatientAge('');
                      setPatientAddress('');
                      setHidePatientDetails(false);
                      onClearPreselectedEncounter?.();
                    }}
                    className="px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md"
                  >
                    Reset Patient
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Pick Patient (UHID / ER / OPD / IPD)
                </label>
                <select
                  value={patientId}
                  onChange={(e) => {
                    const pt = (db.patients || []).find((p) => p.id === e.target.value);
                    if (pt) applyPatientRecord(pt);
                    else setHidePatientDetails(false);
                  }}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">-- New Walk-In or Pick Registered UHID --</option>
                  {(db.patients || []).map((pt) => {
                    const det = detectPatientEncounter(db, pt);
                    return (
                      <option key={pt.id} value={pt.id}>
                        {pt.uhid} — {pt.fullName} [{det.encounterType}] ({pt.age}Y/{pt.gender[0]})
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Encounter Source</label>
                  <select
                    value={encounterType}
                    onChange={(e) => {
                      const next = e.target.value as EncounterType;
                      setEncounterType(next);
                      setEncounterLabel(uhid ? `${next} · ${uhid}` : `${next} Billing`);
                    }}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold"
                  >
                    <option value="WALKING">WALKING</option>
                    <option value="OPD">OPD</option>
                    <option value="EMERGENCY">EMERGENCY</option>
                    <option value="IPD">IPD</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Encounter Ref</label>
                  <input
                    value={encounterLabel}
                    onChange={(e) => setEncounterLabel(e.target.value)}
                    placeholder="OPD / ER / IPD Ref"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              </div>
            </div>

            {hidePatientDetails && (uhid || patientName) ? (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-900 text-white border border-slate-800">
                <div className="flex flex-wrap items-center gap-2.5 text-xs">
                  <span
                    className={`px-2.5 py-0.5 text-[11px] font-mono font-bold rounded border uppercase ${ENCOUNTER_BADGE_STYLES[encounterType]}`}
                  >
                    {encounterType}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-amber-300 font-bold">
                    {uhid || 'WALK-IN'}
                  </span>
                  <span className="text-sm font-semibold text-white">{patientName || 'Walk-In Patient'}</span>
                  {encounterLabel && (
                    <span className="text-[11px] font-mono text-slate-300">({encounterLabel})</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setHidePatientDetails(false)}
                  className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-md whitespace-nowrap"
                >
                  Edit Details
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {fieldRule('patientName') !== 'HIDDEN' && (
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-slate-700">
                        Patient Full Name (बिरामीको नाम) {fieldRule('patientName') === 'REQUIRED' ? '*' : ''}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setPatientName('Walk-In Patient');
                          setEncounterType('WALKING');
                          setEncounterLabel('Walk-In Direct');
                          setHidePatientDetails(true);
                          requestAnimationFrame(() => searchInputRef.current?.focus());
                        }}
                        className="px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap"
                      >
                        Quick Walk-In
                      </button>
                    </div>
                    <input
                      required={fieldRule('patientName') === 'REQUIRED'}
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="e.g., Sita Devi Adhikari"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                    />
                  </div>
                )}

                {fieldRule('patientPhone') !== 'HIDDEN' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Mobile Number (फोन) {fieldRule('patientPhone') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:border-blue-600">
                      <span className="px-2.5 py-2 bg-slate-100 text-slate-700 font-mono text-xs border-r border-slate-300 flex items-center select-none">
                        +977
                      </span>
                      <input
                        required={fieldRule('patientPhone') === 'REQUIRED'}
                        data-no-autocap="true"
                        value={patientPhone}
                        onChange={(e) => setPatientPhone(e.target.value)}
                        placeholder="98XXXXXXXX"
                        className="w-full px-2.5 py-2 text-sm font-mono focus:outline-none"
                      />
                    </div>
                  </div>
                )}

                {fieldRule('patientAge') !== 'HIDDEN' && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Age (उमेर) {fieldRule('patientAge') === 'REQUIRED' ? '*' : ''}
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={125}
                        required={fieldRule('patientAge') === 'REQUIRED'}
                        value={patientAge}
                        onChange={(e) => setPatientAge(e.target.value)}
                        placeholder="30"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">Age Type</label>
                      <select
                        value={patientAgeType}
                        onChange={(e) => setPatientAgeType(e.target.value as AgeType)}
                        className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="Years">Years</option>
                        <option value="Months">Months</option>
                        <option value="Days">Days</option>
                      </select>
                    </div>
                  </div>
                )}

                {fieldRule('patientGender') !== 'HIDDEN' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Sex (लिङ्ग) {fieldRule('patientGender') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <select
                      value={patientGender}
                      onChange={(e) => setPatientGender(e.target.value as PatientGender)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Female">Female</option>
                      <option value="Male">Male</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                )}

                {fieldRule('patientAddress') !== 'HIDDEN' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Address (ठेगाना) {fieldRule('patientAddress') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <input
                      required={fieldRule('patientAddress') === 'REQUIRED'}
                      value={patientAddress}
                      onChange={(e) => setPatientAddress(e.target.value)}
                      placeholder="Ward, Municipality / District"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                )}

                {fieldRule('referralPartnerId') !== 'HIDDEN' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Referral Partner {fieldRule('referralPartnerId') === 'REQUIRED' ? '*' : ''}
                    </label>
                    <select
                      required={fieldRule('referralPartnerId') === 'REQUIRED'}
                      value={referralPartnerId}
                      onChange={(e) => setReferralPartnerId(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="">Direct / No Referral Partner</option>
                      {db.referrals
                        .filter((r) => r.active)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.defaultMode === 'PERCENT' ? `${r.defaultValue}%` : formatNpr(r.defaultValue)})
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                {fieldRule('referringDoctor') !== 'HIDDEN' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Referring Doctor {fieldRule('referringDoctor') === 'REQUIRED' ? '*' : '(Optional)'}
                    </label>
                    <input
                      required={fieldRule('referringDoctor') === 'REQUIRED'}
                      value={referringDoctor}
                      onChange={(e) => setReferringDoctor(e.target.value)}
                      placeholder="Dr. ..."
                      className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* DOS Fast Type-to-Search + Tabular Entry Ledger (No Qty Clutter) */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-900">
                2. DOS Fast Service Entry ({selectedServices.length} item{selectedServices.length === 1 ? '' : 's'} billed)
              </h2>
              <div className="flex items-center gap-2">
                {selectedIds.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedIds([]);
                      setCustomPrices({});
                    }}
                    className="text-xs font-medium text-rose-700 hover:underline"
                  >
                    Clear Bill Lines
                  </button>
                )}
              </div>
            </div>

            {/* Category Quick Filter */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedCategory('ALL')}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-md border ${
                  selectedCategory === 'ALL'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                All Services
              </button>
              {customCategories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md border ${
                    selectedCategory === cat
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Type-to-Search DOS Input + Conditional Dropdown */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                ref={searchInputRef}
                data-enter-submit="true"
                value={testSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
                onChange={(e) => setTestSearch(e.target.value)}
                onKeyDown={(e) => {
                  const matches = filteredServices.slice(0, 12);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActiveServiceIdx((prev) =>
                      Math.min(Math.max(0, matches.length - 1), prev + 1)
                    );
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActiveServiceIdx((prev) => Math.max(0, prev - 1));
                  } else if (e.key === 'Escape') {
                    setTestSearch('');
                    setSearchFocused(false);
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (testSearch.trim() === '') {
                      if (selectedIds.length > 0) {
                        checkoutDiscountRef.current?.focus();
                        checkoutDiscountRef.current?.select();
                      }
                      return;
                    }
                    const hit = matches[activeServiceIdx] || matches[0];
                    if (hit) {
                      if (!selectedIds.includes(hit.id)) {
                        setSelectedIds((prev) => [...prev, hit.id]);
                      }
                      setTestSearch('');
                      searchInputRef.current?.focus();
                    }
                  }
                }}
                placeholder="[F2] Type Code or Name (CBC, X-Ray, DR, USG, ECG, OPD...) → Enter to Add · Enter when empty → Checkout"
                className="w-full pl-9 pr-4 py-2.5 text-xs font-mono bg-slate-950 text-emerald-300 placeholder:text-slate-400 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Dropdown appears ONLY while typing */}
              {testSearch.trim().length > 0 && (
                <div className="mt-1 border border-slate-800 rounded-lg bg-slate-950 text-slate-100 shadow-2xl overflow-hidden max-h-64 overflow-y-auto z-20">
                  {filteredServices.length === 0 ? (
                    <div className="px-4 py-3 text-xs font-mono text-amber-300">
                      No matching hospital service for "{testSearch}". Use "Fetch X-Ray / DR / USG Services" above if catalog is missing.
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse text-xs font-mono">
                      <thead>
                        <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 bg-slate-900">
                          <th className="py-1.5 px-3">Code</th>
                          <th className="py-1.5 px-3">Service / Investigation</th>
                          <th className="py-1.5 px-3">Dept / Cat</th>
                          <th className="py-1.5 px-3 text-right">Rate (रू)</th>
                          <th className="py-1.5 px-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredServices.slice(0, 12).map((srv, idx) => {
                          const focused = idx === activeServiceIdx;
                          const isAdded = selectedIds.includes(srv.id);
                          return (
                            <tr
                              key={srv.id}
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                                if (!isAdded) {
                                  setSelectedIds((prev) => [...prev, srv.id]);
                                }
                                setTestSearch('');
                                searchInputRef.current?.focus();
                              }}
                              className={`cursor-pointer border-b border-slate-800/70 ${
                                focused ? 'bg-blue-700 text-white' : 'hover:bg-slate-800'
                              }`}
                            >
                              <td className="py-1.5 px-3 font-bold text-amber-300">{srv.code}</td>
                              <td className="py-1.5 px-3">{srv.name}</td>
                              <td className="py-1.5 px-3 text-slate-300">
                                {srv.department} ({getServiceCategoryLabel(srv)})
                              </td>
                              <td className="py-1.5 px-3 text-right font-bold tabular-nums">
                                {formatNpr(getEffectivePrice(srv))}
                              </td>
                              <td className="py-1.5 px-3 text-right text-[11px]">
                                {isAdded ? '✓ Selected' : '+ Add [↵]'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              {!searchFocused && testSearch.trim().length === 0 && (
                <div className="mt-1.5 text-[11px] font-mono text-slate-500 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Catalog ready: <strong>{db.services.filter((s) => s.active).length}</strong> active services ({selectedCategory === 'ALL' ? 'All Categories' : selectedCategory}). Type above to select · Press Enter on blank search to Checkout.
                  </span>
                </div>
              )}
            </div>

            {/* DOS Tabular Billing Entry Ledger (No Qty Column — Direct Rate & Amount) */}
            <div className="border border-slate-300 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="bg-slate-900 text-slate-200 border-b border-slate-800 text-[11px]">
                      <th className="py-2 px-2.5 w-8">#</th>
                      <th className="py-2 px-2.5">Code</th>
                      <th className="py-2 px-2.5">Service Description</th>
                      <th className="py-2 px-2.5 text-right w-28">Rate (रू)</th>
                      <th className="py-2 px-2.5 text-right w-28">Amount (रू)</th>
                      <th className="py-2 px-2.5 text-center w-10">Del</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {selectedServices.map((s, idx) => {
                      const currentRate = getEffectivePrice(s);
                      return (
                        <tr key={s.id} className="hover:bg-blue-50/40">
                          <td className="py-1.5 px-2.5 text-slate-500">{idx + 1}</td>
                          <td className="py-1.5 px-2.5 font-bold text-blue-700">{s.code}</td>
                          <td className="py-1.5 px-2.5 font-sans font-medium text-slate-900">
                            {s.name}
                            <span className="ml-1.5 text-[10px] font-mono text-slate-500">
                              ({s.department})
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5 text-right">
                            <input
                              type="number"
                              min={0}
                              data-enter-submit="true"
                              value={currentRate}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  searchInputRef.current?.focus();
                                  searchInputRef.current?.select();
                                }
                              }}
                              onChange={(e) =>
                                setCustomPrices((prev) => ({
                                  ...prev,
                                  [s.id]: Math.max(0, Number(e.target.value) || 0),
                                }))
                              }
                              className="w-24 px-1.5 py-1 text-right font-semibold bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-600"
                            />
                          </td>
                          <td className="py-1.5 px-2.5 text-right font-bold text-slate-900 tabular-nums">
                            {formatNpr(currentRate)}
                          </td>
                          <td className="py-1.5 px-2.5 text-center">
                            <button
                              type="button"
                              onClick={() => toggleService(s.id)}
                              className="p-1 text-slate-400 hover:text-rose-700"
                              title="Remove row"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {selectedServices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-slate-400">
                          No services selected yet. Press [F2], type code/name &amp; press Enter to add.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: POS Checkout & Settlement Summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-4 h-fit">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-blue-600" />
                  {nonInventoryBillOnly ? 'Non-Inventory Settlement' : 'POS Checkout Summary'}
                </h2>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono">
                  <span
                    className={`px-1.5 py-0.5 rounded font-bold uppercase ${ENCOUNTER_BADGE_STYLES[encounterType]}`}
                  >
                    {encounterType}
                  </span>
                  <span className="text-slate-600 truncate max-w-[170px]">
                    {uhid ? `${uhid} · ${patientName || 'Patient'}` : patientName || 'Walk-In Direct'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
                {(['Routine', 'STAT'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`px-2 py-1 text-[11px] font-medium rounded ${
                      priority === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-900 text-slate-100 font-mono text-xs space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Billed Items:</span>
                <span>{selectedServices.length} item(s)</span>
              </div>
              <div className="flex justify-between">
                <span>Gross Amount:</span>
                <span>{formatNpr(subtotal)}</span>
              </div>
              <div className="flex justify-between text-amber-300">
                <span>Discount ({discountPctOfBill}%):</span>
                <span>-{formatNpr(discountNpr)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-emerald-300 pt-1 border-t border-slate-700">
                <span>NET PAYABLE:</span>
                <span>{formatNpr(netTotal)}</span>
              </div>
            </div>

            {/* Discount Controls & Approval Gate */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-600 font-medium">Discount</span>
                <div className="flex items-center gap-1">
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'NPR' | 'PERCENT')}
                    className="px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                  >
                    <option value="NPR">रू</option>
                    <option value="PERCENT">%</option>
                  </select>
                  <input
                    ref={checkoutDiscountRef}
                    data-enter-submit="true"
                    type="number"
                    min={0}
                    value={discountVal}
                    onChange={(e) => setDiscountVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (checkoutTenderedRef.current) {
                          checkoutTenderedRef.current.focus();
                          checkoutTenderedRef.current.select();
                        } else {
                          formRef.current?.requestSubmit();
                        }
                      }
                    }}
                    className="w-24 px-2 py-1 text-xs font-mono text-right border border-slate-300 rounded"
                  />
                </div>
              </div>

              {approvedPosDiscounts.length > 0 && (
                <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1 text-[11px]">
                  <div className="font-semibold text-emerald-900">Approved Discounts Available:</div>
                  {approvedPosDiscounts.map((apr) => (
                    <button
                      key={apr.id}
                      type="button"
                      onClick={() => {
                        setAppliedApprovalId(apr.id);
                        setDiscountType('NPR');
                        setDiscountVal(String(apr.requestedValueNpr));
                      }}
                      className={`w-full text-left px-2 py-1 rounded border flex items-center justify-between ${
                        appliedApprovalId === apr.id
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-white text-emerald-900 border-emerald-300 hover:bg-emerald-100'
                      }`}
                    >
                      <span className="font-mono">{apr.requestNumber} · {apr.patientName}</span>
                      <span className="font-bold">Apply {formatNpr(apr.requestedValueNpr)}</span>
                    </button>
                  ))}
                </div>
              )}

              {discountBlockedWaitingApproval && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 space-y-1.5 text-[11px]">
                  <div className="font-semibold">
                    Discount exceeds cashier cap ({maxCashierDiscPct}% / {formatNpr(maxCashierDiscNpr)}).
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={requestingApproval}
                      onClick={handleRequestDiscountApproval}
                      className="px-2.5 py-1 font-semibold text-white bg-rose-700 hover:bg-rose-800 rounded disabled:opacity-50"
                    >
                      {requestingApproval ? 'Requesting...' : 'Request Admin Discount Approval'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountVal('0')}
                      className="px-2 py-1 text-rose-800 bg-white border border-rose-300 rounded"
                    >
                      Reset
                    </button>
                  </div>
                  {approvalStatusNote && (
                    <div className="font-mono text-emerald-800 font-semibold">{approvalStatusNote}</div>
                  )}
                </div>
              )}
            </div>

            {nonInventoryBillOnly && (
              <div className="p-2.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-[11px]">
                <strong>Non-Inventory Bill-Only Module Active:</strong> Generates instant Hospital Invoice without deducting inventory/films.
              </div>
            )}

            {/* Payment Mode */}
            <div className="space-y-2.5 pt-2 border-t border-slate-200 text-xs">
              <label className="block font-medium text-slate-700">Payment Mode [F4]</label>
              <div className="grid grid-cols-3 gap-1.5">
                {(['Cash', 'Bank / QR', 'Split'] as PaymentMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMode(mode)}
                    className={`py-1.5 px-2 text-xs font-medium rounded-lg border transition-colors ${
                      paymentMode === mode
                        ? 'border-blue-600 bg-blue-50 text-blue-800'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {(paymentMode === 'Cash' || paymentMode === 'Split') && (
                <div>
                  <label className="block text-slate-600 mb-1">Cash Tendered (रू)</label>
                  <input
                    ref={paymentMode === 'Cash' || paymentMode === 'Split' ? checkoutTenderedRef : undefined}
                    data-enter-submit="true"
                    type="number"
                    min={0}
                    value={cashPaid}
                    onChange={(e) => setCashPaid(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        formRef.current?.requestSubmit();
                      }
                    }}
                    placeholder={String(paymentMode === 'Cash' ? netTotal : 0)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              )}

              {(paymentMode === 'Bank / QR' || paymentMode === 'Split') && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-slate-600 mb-1">Bank / Fonepay QR Amount (रू)</label>
                    <input
                      ref={paymentMode === 'Bank / QR' ? checkoutTenderedRef : undefined}
                      data-enter-submit="true"
                      type="number"
                      min={0}
                      value={bankPaid}
                      onChange={(e) => setBankPaid(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          formRef.current?.requestSubmit();
                        }
                      }}
                      placeholder={String(paymentMode === 'Bank / QR' ? netTotal : 0)}
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Deposit To Hospital Bank Account</label>
                    <select
                      value={bankAccountId}
                      onChange={(e) => setBankAccountId(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                    >
                      {(hospitalBanks.length > 0 ? hospitalBanks : db.accounts.filter((a) => a.type === 'BANK')).map(
                        (a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            ref={submitBillBtnRef}
            type="submit"
            disabled={submitting || selectedIds.length === 0 || discountBlockedWaitingApproval}
            className="w-full py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting
              ? 'Generating POS Invoice...'
              : `[F9 / Enter] Generate Hospital Bill & Print (${formatNpr(netTotal)})`}
          </button>
        </div>
      </form>

      {/* Recent POS Invoices */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            Recent Hospital POS Bills &amp; Invoices ({activeFiscalYear})
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-4">Invoice / Accession</th>
                <th className="py-2.5 px-4">Nepali Date &amp; Time</th>
                <th className="py-2.5 px-4">Patient Details</th>
                <th className="py-2.5 px-4">Encounter / Mode</th>
                <th className="py-2.5 px-4 text-right">Net Total</th>
                <th className="py-2.5 px-4 text-right">Paid / Due</th>
                <th className="py-2.5 px-4 text-right">Direct Print</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {db.orders.slice(0, 10).map((ord) => {
                const bs = adToBs(ord.orderedAt);
                return (
                  <tr key={ord.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono">
                      <div className="font-semibold text-slate-900">{ord.invoiceNumber}</div>
                      <div className="text-slate-500">{ord.accessionNumber}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{bs.formattedNp}</div>
                      <div className="font-mono text-slate-500">
                        {bs.formattedEn} · {bs.timeEn}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-900">{ord.patientName}</div>
                      <div className="text-slate-500">
                        {ord.patientAge} {ord.patientAgeType} / {ord.patientGender} · {ord.patientPhone}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {ord.uhid ? `${ord.uhid} · ` : ''}{ord.patientAddress}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-slate-800 font-medium">
                        {ord.encounterLabel || ord.encounterType || 'Hospital Counter'}
                      </div>
                      <div className="font-mono text-slate-500">
                        {ord.paymentMode}
                        {ord.createdByName ? ` · ${ord.createdByName}` : ''}
                        {ord.nonInventoryBillOnly ? ' · Bill-Only' : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
                      {formatNpr(ord.totalAmount)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono">
                      <div className="text-emerald-700">Paid: {formatNpr(ord.paidAmount)}</div>
                      {ord.dueAmount > 0 && (
                        <div className="text-rose-700">Due: {formatNpr(ord.dueAmount)}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => onPrintBill(ord)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Receipt className="w-3 h-3" />
                          Print Bill
                        </button>
                        <button
                          type="button"
                          onClick={() => onPrintReport(ord)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap"
                        >
                          <Printer className="w-3 h-3" />
                          Print Report
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-Employee Hospital Counter Close Modal */}
      {showCloseModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowCloseModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-slate-900" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Hospital Counter Shift Close — {activeUser.fullName}
                </h3>
              </div>
              <button type="button" onClick={() => setShowCloseModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCloseHospitalCounter} className="p-5 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 font-mono">
                <div>Open Hospital Orders: <strong>{shiftLivePreview.orderCount}</strong> (+ {shiftLivePreview.ipdBillCount} IPD cash bills)</div>
                <div>Expected Cash Drawer: <strong className="text-emerald-700">{formatNpr(shiftLivePreview.expectedCash)}</strong></div>
                <div>Expected Bank / QR: <strong className="text-blue-700">{formatNpr(shiftLivePreview.expectedBank)}</strong></div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={closeEmployeeOnly}
                  onChange={(e) => setCloseEmployeeOnly(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Count Only My Logged-In Employee Transactions (@{activeUser.username})</span>
              </label>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Shift Label *</label>
                <input
                  required
                  value={closeShiftLabel}
                  onChange={(e) => setCloseShiftLabel(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Actual Physical Cash Counted (रू) *</label>
                <input
                  required
                  type="number"
                  min={0}
                  value={closeCountedCash}
                  onChange={(e) => setCloseCountedCash(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Handover / Audit Notes</label>
                <input
                  value={closeNotes}
                  onChange={(e) => setCloseNotes(e.target.value)}
                  placeholder="Optional cash handover remark..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowCloseModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closingCounter}
                  className="px-4 py-1.5 font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50"
                >
                  {closingCounter ? 'Closing...' : 'Close My Hospital Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

