import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Download,
  Edit3,
  Factory,
  FileSpreadsheet,
  Keyboard,
  Lock,
  Minus,
  PackagePlus,
  Pill,
  Plus,
  Printer,
  Search,
  ShieldAlert,
  Trash2,
  TrendingUp,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import type {
  CounterCloseRecord,
  EncounterType,
  LimsDatabase,
  PatientRecord,
  PaymentMode,
  PermissionKey,
  PharmacyBatch,
  PharmacyDispenseInvoice,
  PharmacyDosageForm,
  PharmacyManufacturer,
  PharmacyMedicine,
  PharmacySupplier,
  StaffMember,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { PharmacyInvoiceModal } from '../components/PharmacyInvoiceModal';
import type { BillingEncounterHandoff } from './PosBillingView';
import { detectPatientEncounter } from '../utils/patientEncounter';
import { normalizeNepalPhone, stripCountryPrefixForEdit } from '../utils/textFormat';

interface PharmacyViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  initialSearchQuery?: string;
  preselectedEncounter?: BillingEncounterHandoff | null;
  onClearPreselectedEncounter?: () => void;
}

const DOSAGE_FORMS: PharmacyDosageForm[] = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Injection',
  'IV Fluid',
  'Ointment',
  'Drops',
  'Inhaler',
  'Surgical',
  'Consumable',
];

const NEPAL_PHARMA_COMPANIES: string[] = [
  'Deurali-Janta Pharma (DJPL)',
  'Quest Pharmaceuticals',
  'Lomus Pharmaceuticals',
  'National Healthcare (NHPL)',
  'Asian Pharmaceuticals',
  'Nepal Pharmaceuticals Lab (NPL)',
  'Magnus Pharma',
  'Time Pharmaceuticals',
  'Vega Pharmaceuticals',
  'Curex Pharmaceuticals',
  'CTL Pharmaceuticals',
  'S.R. Drug Laboratories',
  'Mark Formulation',
  'Simca Laboratories',
  'Royal Pharmaceuticals',
  'Omnica Laboratories',
  'QMed Formulation',
  'Hukum Pharmaceuticals',
  'Vijaydeep Laboratories',
  'Nepal Drug Ltd.',
  'Hospital ICU / Inside Formulary',
];

function daysUntil(ymd: string): number {
  const target = new Date(`${ymd}T00:00:00`).getTime();
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`).getTime();
  return Math.round((target - today) / 86400000);
}

const ENCOUNTER_BADGE_STYLES: Record<EncounterType, string> = {
  EMERGENCY: 'bg-rose-600 text-white border-rose-700',
  IPD: 'bg-indigo-600 text-white border-indigo-700',
  OPD: 'bg-blue-600 text-white border-blue-700',
  WALKING: 'bg-emerald-600 text-white border-emerald-700',
};

export function PharmacyView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onUpdated,
  initialSearchQuery,
  preselectedEncounter,
  onClearPreselectedEncounter,
}: PharmacyViewProps) {
  const canManage = hasPerm('pharmacy.manage');
  const canDispense = hasPerm('pharmacy.dispense');
  const modSettings = db.settings?.moduleSettings;

  const pharmacyBanks = useMemo(
    () => db.accounts.filter((a) => a.type === 'BANK' && a.departmentScope === 'PHARMACY'),
    [db.accounts]
  );

  // Unified Single Central Hospital Pharmacy (shared across all roles incl. PHARMACY_CASHIER)
  const effectiveCenterId: string | null = null;

  const [subTab, setSubTab] = useState<
    'pos' | 'fefo_radar' | 'master_grn' | 'suppliers_ledger' | 'companies' | 'finance_pnl' | 'invoices' | 'deposits_dues'
  >('pos');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');

  useEffect(() => {
    if (initialSearchQuery !== undefined && initialSearchQuery !== '') {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const nearExpiryDays = db.settings?.moduleSettings?.pharmacyNearExpiryDays || 45;
  const strictBlockExpired = db.settings?.moduleSettings?.strictFefoBlockExpired !== false;
  const todayYmd = new Date().toISOString().slice(0, 10);

  // POS Cart & Billing State
  const [cart, setCart] = useState<Array<{ medicineId: string; quantity: number; customUnitPriceNpr?: number }>>([]);
  const [nonInventoryBillOnly, setNonInventoryBillOnly] = useState(false);
  const [patientId, setPatientId] = useState('');
  const [uhid, setUhid] = useState('');
  const [encounterType, setEncounterType] = useState<EncounterType>('WALKING');
  const [encounterId, setEncounterId] = useState('');
  const [encounterLabel, setEncounterLabel] = useState('Pharmacy Counter');
  const [patientName, setPatientName] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientAge, setPatientAge] = useState('');
  const [prescribingDoctor, setPrescribingDoctor] = useState('');
  const [linkedOrderAccession, setLinkedOrderAccession] = useState('');
  const [hideCustomerDetails, setHideCustomerDetails] = useState(false);
  const [discountNpr, setDiscountNpr] = useState('0');
  const [appliedDiscountApprovalId, setAppliedDiscountApprovalId] = useState('');
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [approvalStatusNote, setApprovalStatusNote] = useState<string | null>(null);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [cashPaid, setCashPaid] = useState('');
  const [bankPaid, setBankPaid] = useState('');
  const [applyDepositNpr, setApplyDepositNpr] = useState('0');
  const [creditPartialAmt, setCreditPartialAmt] = useState('0');
  const [creditPartialMode, setCreditPartialMode] = useState<'Cash' | 'Bank / QR'>('Cash');
  const [adminCreditOverride, setAdminCreditOverride] = useState(false);
  const [bankAccountId, setBankAccountId] = useState(
    pharmacyBanks[0]?.id || db.accounts.find((a) => a.type === 'BANK')?.id || ''
  );
  const [dispensing, setDispensing] = useState(false);
  const [fetchingCatalog, setFetchingCatalog] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>('ALL');
  const [activeMedIdx, setActiveMedIdx] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState<PharmacyDispenseInvoice | null>(null);
  const [invoiceAutoPrint, setInvoiceAutoPrint] = useState(false);

  // Per-Employee Pharmacy Counter Close Modal
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [closeShiftLabel, setCloseShiftLabel] = useState(
    `${activeUser.shift || 'Pharmacy Shift'} — ${activeUser.fullName}`
  );
  const [closeEmployeeOnly, setCloseEmployeeOnly] = useState(true);
  const [closeCountedCash, setCloseCountedCash] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closingCounter, setClosingCounter] = useState(false);

  const [posErrorMsg, setPosErrorMsg] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const checkoutDiscountRef = useRef<HTMLInputElement>(null);
  const checkoutTenderedRef = useRef<HTMLInputElement>(null);
  const posFormRef = useRef<HTMLFormElement>(null);

  // Advance Deposit & Due Settlement State
  const [depPatientId, setDepPatientId] = useState('');
  const [depUhid, setDepUhid] = useState('');
  const [depEncounterType, setDepEncounterType] = useState<EncounterType>('IPD');
  const [depEncounterId, setDepEncounterId] = useState('');
  const [depPatientName, setDepPatientName] = useState('');
  const [depPatientPhone, setDepPatientPhone] = useState('');
  const [depAmountNpr, setDepAmountNpr] = useState('');
  const [depPayMode, setDepPayMode] = useState<'Cash' | 'Bank / QR'>('Cash');
  const [depNotes, setDepNotes] = useState('');
  const [savingDeposit, setSavingDeposit] = useState(false);

  const [dueFilterMode, setDueFilterMode] = useState<'PENDING_ONLY' | 'ALL_CREDIT'>('PENDING_ONLY');
  const [settleTargetInv, setSettleTargetInv] = useState<PharmacyDispenseInvoice | null>(null);
  const [settleAmountNpr, setSettleAmountNpr] = useState('');
  const [settlePayMode, setSettlePayMode] = useState<'Cash' | 'Bank / QR'>('Cash');
  const [settleNote, setSettleNote] = useState('');
  const [settlingDue, setSettlingDue] = useState(false);

  // Supplier & Party Ledger CRUD + Payment Modal State
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupId, setEditingSupId] = useState<string | null>(null);
  const [supCode, setSupCode] = useState('');
  const [supName, setSupName] = useState('');
  const [supContact, setSupContact] = useState('');
  const [supPhone, setSupPhone] = useState('');
  const [supAddress, setSupAddress] = useState('');
  const [supPanVat, setSupPanVat] = useState('');
  const [supPaymentTerms, setSupPaymentTerms] = useState<PharmacySupplier['paymentTerms']>('Credit 30 Days');
  const [supCreditDays, setSupCreditDays] = useState('30');
  const [supOpeningDue, setSupOpeningDue] = useState('0');
  const [supNotes, setSupNotes] = useState('');
  const [savingSup, setSavingSup] = useState(false);

  const [paySupTarget, setPaySupTarget] = useState<PharmacySupplier | null>(null);
  const [paySupAmount, setPaySupAmount] = useState('');
  const [paySupAccountId, setPaySupAccountId] = useState(
    pharmacyBanks[0]?.id || db.accounts.find((a) => a.departmentScope === 'PHARMACY')?.id || db.accounts[0]?.id || ''
  );
  const [paySupRef, setPaySupRef] = useState('');
  const [paySupNotes, setPaySupNotes] = useState('');
  const [payingSup, setPayingSup] = useState(false);

  // Manufacturers / Companies CRUD State
  const [showMfgModal, setShowMfgModal] = useState(false);
  const [editingMfgId, setEditingMfgId] = useState<string | null>(null);
  const [mfgCode, setMfgCode] = useState('');
  const [mfgName, setMfgName] = useState('');
  const [mfgCountry, setMfgCountry] = useState('Nepal');
  const [mfgPhone, setMfgPhone] = useState('');
  const [mfgAddress, setMfgAddress] = useState('');
  const [savingMfg, setSavingMfg] = useState(false);

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
    setPatientPhone(stripCountryPrefixForEdit(pt.phone));
    setPatientAge(String(pt.age));
    if (det?.attendingDoctor && !prescribingDoctor) {
      setPrescribingDoctor(det.attendingDoctor);
    }
    setHideCustomerDetails(true);
    setAppliedDiscountApprovalId('');
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

  // Medicine Master Modal (Create & Edit)
  const [showMedModal, setShowMedModal] = useState(false);
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [medCode, setMedCode] = useState('');
  const [medBrand, setMedBrand] = useState('');
  const [medGeneric, setMedGeneric] = useState('');
  const [medForm, setMedForm] = useState<PharmacyDosageForm>('Tablet');
  const [medStrength, setMedStrength] = useState('500mg');
  const [medManufacturer, setMedManufacturer] = useState('Deurali-Janta Pharma (DJPL)');
  const [medCategory, setMedCategory] = useState('General');
  const [medSchedule, setMedSchedule] = useState<PharmacyMedicine['scheduleType']>('OTC');
  const [medRack, setMedRack] = useState('A-01');
  const [medUnit, setMedUnit] = useState('Tabs');
  const [medVat, setMedVat] = useState(false);
  const [medReorder, setMedReorder] = useState('100');
  const [medInrMrp, setMedInrMrp] = useState('');
  const [medMrp, setMedMrp] = useState('12');
  const [medBuyRate, setMedBuyRate] = useState('10.34');
  const [importingExcel, setImportingExcel] = useState(false);

  // Opening Stock Modal (with INR -> NPR x 1.6 & Wholesale Buy Formula)
  const [showOpeningModal, setShowOpeningModal] = useState(false);
  const [opMedId, setOpMedId] = useState<string>(db.pharmacyMedicines[0]?.id || 'NEW');
  const [opNewCode, setOpNewCode] = useState('');
  const [opNewBrand, setOpNewBrand] = useState('');
  const [opNewGeneric, setOpNewGeneric] = useState('');
  const [opNewStrength, setOpNewStrength] = useState('500mg');
  const [opNewForm, setOpNewForm] = useState<PharmacyDosageForm>('Tablet');
  const [opNewUnit, setOpNewUnit] = useState('Tabs');
  const [opBatchNo, setOpBatchNo] = useState('');
  const [opExpiryDate, setOpExpiryDate] = useState(
    new Date(Date.now() + 540 * 86400000).toISOString().slice(0, 10)
  );
  const [opQty, setOpQty] = useState('100');
  const [opInrMrp, setOpInrMrp] = useState('');
  const [opMrpNpr, setOpMrpNpr] = useState('16');
  const [opBuyFormula, setOpBuyFormula] = useState<'MRP_DIV_116' | 'MRP_DIV_120' | 'MRP_MUL_084' | 'CUSTOM'>('MRP_DIV_116');
  const [opCustomBuyRate, setOpCustomBuyRate] = useState('13.79');
  const [opNotes, setOpNotes] = useState('');
  const [savingOpening, setSavingOpening] = useState(false);

  // GRN Batch Intake Modal
  const [showGrnModal, setShowGrnModal] = useState(false);
  const [grnMedId, setGrnMedId] = useState(db.pharmacyMedicines[0]?.id || '');
  const [grnBatchNo, setGrnBatchNo] = useState('');
  const [grnMfgDate, setGrnMfgDate] = useState(todayYmd);
  const [grnExpiryDate, setGrnExpiryDate] = useState(
    new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)
  );
  const [grnQty, setGrnQty] = useState('100');
  const [grnInrMrp, setGrnInrMrp] = useState('');
  const [grnPurchaseRate, setGrnPurchaseRate] = useState('10.34');
  const [grnMrp, setGrnMrp] = useState('12');
  const [grnSupplierId, setGrnSupplierId] = useState(db.pharmacySuppliers?.[0]?.id || '');
  const [grnSupplier, setGrnSupplier] = useState(
    db.pharmacySuppliers?.[0]?.name || 'Kathmandu Pharma Distributors'
  );
  const [grnPaymentStatus, setGrnPaymentStatus] = useState<'PAID' | 'CREDIT'>('PAID');
  const [grnPostLedger, setGrnPostLedger] = useState(true);

  const hubBatches = useMemo(() => {
    return (db.pharmacyBatches || [])
      .filter((b) => (b.centerId ?? null) === (effectiveCenterId ?? null))
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }, [db.pharmacyBatches, effectiveCenterId]);

  const getFefoBatchesForMed = (medicineId: string): PharmacyBatch[] => {
    return hubBatches.filter(
      (b) =>
        b.medicineId === medicineId &&
        !b.quarantined &&
        b.quantityOnHand > 0 &&
        (!strictBlockExpired || b.expiryDate >= todayYmd)
    );
  };

  const getUsableQty = (medicineId: string): number =>
    getFefoBatchesForMed(medicineId).reduce((s, b) => s + b.quantityOnHand, 0);

  // Client-side exact preview of FEFO auto-allocation or Bill-Only mode
  const fefoCartPreview = useMemo(() => {
    const lines: Array<{
      medicine: PharmacyMedicine;
      batch: PharmacyBatch;
      takeQty: number;
      lineTotal: number;
    }> = [];
    const errors: string[] = [];

    for (const item of cart) {
      const med = db.pharmacyMedicines.find((m) => m.id === item.medicineId);
      if (!med) continue;
      if (nonInventoryBillOnly) {
        const billRate =
          item.customUnitPriceNpr !== undefined ? item.customUnitPriceNpr : med.defaultMrpNpr;
        lines.push({
          medicine: med,
          batch: {
            id: `billonly-${med.id}`,
            medicineId: med.id,
            centerId: null,
            centerName: 'Pharmacy Bill-Only',
            batchNumber: 'BILL-ONLY',
            mfgDate: todayYmd,
            expiryDate: 'N/A',
            quantityReceived: item.quantity,
            quantityOnHand: item.quantity,
            purchaseRateNpr: 0,
            mrpNpr: billRate,
            supplierName: 'Non-Inventory',
            grnNumber: 'BILL-ONLY',
            receivedAt: new Date().toISOString(),
          },
          takeQty: item.quantity,
          lineTotal: Number((item.quantity * billRate).toFixed(2)),
        });
        continue;
      }

      const eligible = getFefoBatchesForMed(med.id);
      const totalAvail = eligible.reduce((s, b) => s + b.quantityOnHand, 0);
      if (totalAvail < item.quantity) {
        errors.push(`${med.brandName}: Requested ${item.quantity}, FEFO usable ${totalAvail}.`);
      }
      let rem = item.quantity;
      for (const b of eligible) {
        if (rem <= 0) break;
        const take = Math.min(rem, b.quantityOnHand);
        rem -= take;
        lines.push({
          medicine: med,
          batch: b,
          takeQty: take,
          lineTotal: Number((take * b.mrpNpr).toFixed(2)),
        });
      }
    }

    const subtotal = Number(lines.reduce((s, l) => s + l.lineTotal, 0).toFixed(2));
    const disc = Math.max(0, Math.min(subtotal, Number(discountNpr) || 0));
    const taxable = lines.filter((l) => l.medicine.vatApplicable).reduce((s, l) => s + l.lineTotal, 0);
    const vat = subtotal > 0 ? Number((((taxable * (subtotal - disc)) / subtotal) * 0.13).toFixed(2)) : 0;
    const netTotal = Number((subtotal - disc + vat).toFixed(2));

    return { lines, errors, subtotal, discount: disc, vat, netTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, hubBatches, db.pharmacyMedicines, discountNpr, strictBlockExpired, todayYmd, nonInventoryBillOnly]);

  const q = searchTerm.trim().toLowerCase();

  const companyOptions = useMemo(() => {
    const fromMeds = (db.pharmacyMedicines || []).map((m) => m.manufacturer).filter(Boolean);
    const fromMaster = (db.pharmacyManufacturers || []).filter((m) => m.active !== false).map((m) => m.name);
    return Array.from(new Set([...NEPAL_PHARMA_COMPANIES, ...fromMaster, ...fromMeds]));
  }, [db.pharmacyMedicines, db.pharmacyManufacturers]);

  const filteredMedicines = useMemo(() => {
    return (db.pharmacyMedicines || []).filter((m) => {
      // Typing in search box scans ALL pharma companies across Nepal + Hospital Formulary
      if (!q && selectedCompany !== 'ALL' && m.manufacturer !== selectedCompany) return false;
      if (!q) return true;
      return `${m.code} ${m.brandName} ${m.genericName} ${m.category} ${m.rackLocation} ${m.manufacturer}`
        .toLowerCase()
        .includes(q);
    });
  }, [db.pharmacyMedicines, selectedCompany, q]);

  useEffect(() => {
    setActiveMedIdx(0);
  }, [q, selectedCompany]);

  const filteredBatches = useMemo(() => {
    return hubBatches.filter((b) => {
      if (!q) return true;
      const med = db.pharmacyMedicines.find((m) => m.id === b.medicineId);
      return `${b.batchNumber} ${b.grnNumber} ${b.supplierName} ${b.expiryDate} ${med?.brandName || ''} ${med?.genericName || ''} ${med?.code || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [hubBatches, db.pharmacyMedicines, q]);

  const activeIpdList = useMemo(
    () => (db.ipdAdmissions || []).filter((a) => a.disposition === 'Admitted'),
    [db.ipdAdmissions]
  );

  const activeErList = useMemo(
    () => (db.emergencyCases || []).filter((e) => e.disposition === 'Under Observation (ER)'),
    [db.emergencyCases]
  );

  const isSuperOrSaasAdmin = activeUser.roleId === 'SUPER_ADMIN' || activeUser.roleId === 'SAAS_ADMIN';

  const patientFinanceStatus = useMemo(() => {
    const matchedPatient =
      (patientId && (db.patients || []).find((p) => p.id === patientId)) ||
      (uhid && (db.patients || []).find((p) => p.uhid === uhid)) ||
      (patientName.trim()
        ? (db.patients || []).find(
            (p) =>
              p.fullName.toLowerCase() === patientName.trim().toLowerCase() &&
              (!patientPhone.trim() || !p.phone || p.phone === patientPhone.trim())
          )
        : undefined);

    const effPatientId = patientId || matchedPatient?.id || '';
    const effUhid = uhid || matchedPatient?.uhid || '';

    const availableDepositPool = Number(
      (db.pharmacyDeposits || [])
        .filter(
          (d) =>
            d.remainingBalanceNpr > 0 &&
            ((effPatientId && d.patientId === effPatientId) ||
              (effUhid && d.uhid === effUhid) ||
              (encounterId && d.encounterId === encounterId))
        )
        .reduce((s, d) => s + d.remainingBalanceNpr, 0)
        .toFixed(2)
    );

    const existingPharmacyDue = Number(
      (db.pharmacyInvoices || [])
        .filter(
          (inv) =>
            (inv.dueAmountNpr || 0) > 0 &&
            ((effPatientId && inv.patientId === effPatientId) ||
              (effUhid && inv.uhid === effUhid) ||
              (encounterId && inv.encounterId === encounterId))
        )
        .reduce((s, inv) => s + (inv.dueAmountNpr || 0), 0)
        .toFixed(2)
    );

    const activeIpd =
      encounterType === 'IPD'
        ? activeIpdList.find(
            (a) =>
              (encounterId && a.id === encounterId) ||
              (effPatientId && a.patientId === effPatientId) ||
              (effUhid && a.uhid === effUhid)
          )
        : undefined;

    const activeEr =
      encounterType === 'EMERGENCY'
        ? activeErList.find(
            (e) =>
              (encounterId && e.id === encounterId) ||
              (effPatientId && e.patientId === effPatientId) ||
              (effUhid && e.uhid === effUhid)
          )
        : undefined;

    const ms = db.settings?.moduleSettings;
    let creditLimitNpr: number | null = null;
    let hospitalDueNpr = 0;

    if (encounterType === 'IPD') {
      creditLimitNpr = activeIpd?.creditLimitNpr || ms?.ipdDefaultCreditLimitNpr || 25000;
      hospitalDueNpr = activeIpd ? Math.max(0, activeIpd.balanceDueNpr) : 0;
    } else if (encounterType === 'EMERGENCY') {
      creditLimitNpr = activeEr?.creditLimitNpr || ms?.emergencyDefaultCreditLimitNpr || 15000;
    }

    const currentExposureNpr = Number((hospitalDueNpr + existingPharmacyDue).toFixed(2));
    const depositToApply = Number(
      Math.min(fefoCartPreview.netTotal, availableDepositPool, Math.max(0, Number(applyDepositNpr) || 0)).toFixed(2)
    );
    const afterDeposit = Number(Math.max(0, fefoCartPreview.netTotal - depositToApply).toFixed(2));
    const partialPaidNow =
      paymentMode === 'Credit'
        ? Number(Math.min(afterDeposit, Math.max(0, Number(creditPartialAmt) || 0)).toFixed(2))
        : paymentMode === 'Split'
        ? Number(Math.min(afterDeposit, (Number(cashPaid) || 0) + (Number(bankPaid) || 0)).toFixed(2))
        : afterDeposit;
    const proposedDueNpr =
      paymentMode === 'Credit' ? Number(Math.max(0, afterDeposit - partialPaidNow).toFixed(2)) : 0;
    const projectedExposureNpr = Number((currentExposureNpr + proposedDueNpr).toFixed(2));
    const limitExceeded =
      creditLimitNpr !== null && proposedDueNpr > 0 && projectedExposureNpr > creditLimitNpr;
    const availableCreditHeadroom =
      creditLimitNpr !== null ? Number(Math.max(0, creditLimitNpr - currentExposureNpr).toFixed(2)) : null;

    return {
      availableDepositPool,
      existingPharmacyDue,
      hospitalDueNpr,
      currentExposureNpr,
      creditLimitNpr,
      availableCreditHeadroom,
      depositToApply,
      afterDeposit,
      partialPaidNow,
      proposedDueNpr,
      projectedExposureNpr,
      limitExceeded,
      activeIpd,
      activeEr,
    };
  }, [
    db.patients,
    db.pharmacyDeposits,
    db.pharmacyInvoices,
    db.settings?.moduleSettings,
    activeIpdList,
    activeErList,
    patientId,
    uhid,
    patientName,
    patientPhone,
    encounterType,
    encounterId,
    fefoCartPreview.netTotal,
    applyDepositNpr,
    paymentMode,
    creditPartialAmt,
    cashPaid,
    bankPaid,
  ]);

  const filteredInvoices = useMemo(() => {
    return (db.pharmacyInvoices || []).filter((inv) => {
      const hubMatch = (inv.centerId ?? null) === (effectiveCenterId ?? null);
      if (!hubMatch) return false;
      if (!q) return true;
      return `${inv.invoiceNumber} ${inv.patientName} ${inv.patientPhone} ${inv.linkedOrderAccession || ''} ${inv.lines.map((l) => `${l.medicineName} ${l.batchNumber}`).join(' ')}`
        .toLowerCase()
        .includes(q);
    });
  }, [db.pharmacyInvoices, effectiveCenterId, q]);

  const creditAndDueSummary = useMemo(() => {
    const allInvs = db.pharmacyInvoices || [];
    const dueInvoices = allInvs.filter((i) => (i.dueAmountNpr || 0) > 0);
    const creditHistoryInvoices = allInvs.filter(
      (i) => i.paymentMode === 'Credit' || i.paymentStatus === 'CREDIT_DUE' || i.paymentStatus === 'PARTIAL' || (i.dueAmountNpr || 0) > 0
    );
    const totalPendingDueNpr = Number(
      dueInvoices.reduce((s, i) => s + (i.dueAmountNpr || 0), 0).toFixed(2)
    );
    const totalAvailableDepositsNpr = Number(
      (db.pharmacyDeposits || []).reduce((s, d) => s + (d.remainingBalanceNpr || 0), 0).toFixed(2)
    );
    return {
      dueInvoices,
      creditHistoryInvoices,
      totalPendingDueNpr,
      totalAvailableDepositsNpr,
    };
  }, [db.pharmacyInvoices, db.pharmacyDeposits]);

  // Pharmacy Discount Cap & Approvals Check + Live Buy/Sell P&L
  const maxCashierDiscPct = modSettings?.maxCashierDiscountPercent ?? 15;
  const maxCashierDiscNpr = modSettings?.cashierMaxDiscountNpr ?? 1000;
  const enteredDiscountVal = Math.max(0, Number(discountNpr) || 0);
  const discountPctOfBill =
    fefoCartPreview.subtotal > 0
      ? Number(((enteredDiscountVal / fefoCartPreview.subtotal) * 100).toFixed(1))
      : 0;

  const approvedPharmDiscounts = useMemo(() => {
    return (db.discountCreditApprovals || []).filter(
      (a) =>
        a.status === 'APPROVED' &&
        !a.consumedAt &&
        a.requestType === 'DISCOUNT_OVERRIDE' &&
        a.sourceModule === 'PHARMACY_POS' &&
        (!uhid || !a.uhid || a.uhid === uhid)
    );
  }, [db.discountCreditApprovals, uhid]);

  const activeApprovedDiscount = useMemo(
    () => approvedPharmDiscounts.find((a) => a.id === appliedDiscountApprovalId),
    [approvedPharmDiscounts, appliedDiscountApprovalId]
  );

  const discountExceedsCashierCap =
    !isSuperOrSaasAdmin &&
    enteredDiscountVal > 0 &&
    (enteredDiscountVal > maxCashierDiscNpr || discountPctOfBill > maxCashierDiscPct);

  const discountBlockedWaitingApproval =
    discountExceedsCashierCap &&
    (!activeApprovedDiscount || enteredDiscountVal > activeApprovedDiscount.requestedValueNpr);

  const pharmFinanceSummary = useMemo(() => {
    const invoices = db.pharmacyInvoices || [];
    const fyInvoices = invoices.filter((i) => !i.fiscalYear || i.fiscalYear === activeFiscalYear);
    let totalGrossSales = 0;
    let totalDiscounts = 0;
    let totalVat = 0;
    let totalNetSales = 0;
    let totalCogsCost = 0;
    for (const inv of fyInvoices) {
      totalGrossSales += inv.subtotalNpr || 0;
      totalDiscounts += inv.discountNpr || 0;
      totalVat += inv.vatNpr || 0;
      totalNetSales += inv.totalNpr || 0;
      for (const ln of inv.lines || []) {
        const med = db.pharmacyMedicines.find((m) => m.id === ln.medicineId);
        const batch = db.pharmacyBatches.find((b) => b.id === ln.batchId);
        const unitBuy =
          ln.purchaseRateNpr ??
          batch?.purchaseRateNpr ??
          med?.defaultPurchaseRateNpr ??
          Number(((ln.unitPriceNpr || 0) / 1.16).toFixed(2));
        totalCogsCost += unitBuy * (ln.quantity || 0);
      }
    }
    const grossMarginProfit = Number((totalGrossSales - totalDiscounts - totalCogsCost).toFixed(2));
    const netProfitAfterVat = Number((totalNetSales - totalVat - totalCogsCost).toFixed(2));
    const stockBuyValuation = Number(
      hubBatches
        .filter((b) => !b.quarantined && b.quantityOnHand > 0)
        .reduce((s, b) => s + b.quantityOnHand * (b.purchaseRateNpr || 0), 0)
        .toFixed(2)
    );
    const stockMrpValuation = Number(
      hubBatches
        .filter((b) => !b.quarantined && b.quantityOnHand > 0)
        .reduce((s, b) => s + b.quantityOnHand * (b.mrpNpr || 0), 0)
        .toFixed(2)
    );
    const totalSupplierDue = Number(
      (db.pharmacySuppliers || []).reduce((s, sup) => s + (sup.currentDueNpr || 0), 0).toFixed(2)
    );
    const supplierPaymentsTotal = Number(
      (db.financialLedger || [])
        .filter((l) => l.category === 'SUPPLIER_PAYMENT' && (!l.fiscalYear || l.fiscalYear === activeFiscalYear))
        .reduce((s, l) => s + (l.amount || 0), 0)
        .toFixed(2)
    );
    return {
      billCount: fyInvoices.length,
      totalGrossSales,
      totalDiscounts,
      totalVat,
      totalNetSales,
      totalCogsCost,
      grossMarginProfit,
      netProfitAfterVat,
      stockBuyValuation,
      stockMrpValuation,
      potentialInventoryProfit: Number((stockMrpValuation - stockBuyValuation).toFixed(2)),
      totalSupplierDue,
      supplierPaymentsTotal,
    };
  }, [db.pharmacyInvoices, db.pharmacyMedicines, db.pharmacyBatches, db.pharmacySuppliers, db.financialLedger, hubBatches, activeFiscalYear]);

  // KPI computations
  const kpis = useMemo(() => {
    const usableUnits = hubBatches
      .filter((b) => !b.quarantined && b.expiryDate >= todayYmd)
      .reduce((s, b) => s + b.quantityOnHand, 0);
    const expiredCount = hubBatches.filter(
      (b) => !b.quarantined && b.quantityOnHand > 0 && b.expiryDate < todayYmd
    ).length;
    const nearExpiryCount = hubBatches.filter((b) => {
      const d = daysUntil(b.expiryDate);
      return !b.quarantined && b.quantityOnHand > 0 && d >= 0 && d <= nearExpiryDays;
    }).length;
    const fySales = (db.pharmacyInvoices || [])
      .filter(
        (i) =>
          (i.centerId ?? null) === (effectiveCenterId ?? null) &&
          i.fiscalYear === activeFiscalYear
      )
      .reduce((s, i) => s + i.totalNpr, 0);
    return { usableUnits, expiredCount, nearExpiryCount, fySales };
  }, [hubBatches, todayYmd, nearExpiryDays, db.pharmacyInvoices, effectiveCenterId, activeFiscalYear]);

  const addToCart = (med: PharmacyMedicine, focusQty = false) => {
    const avail = getUsableQty(med.id);
    if (!nonInventoryBillOnly && avail <= 0) {
      setPosErrorMsg(
        `No active stock available for ${med.brandName}. Switch to Non-Inventory Bill-Only mode to bill at 0 stock.`
      );
      return;
    }
    setPosErrorMsg(null);
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.medicineId === med.id);
      if (idx >= 0) {
        const nextQty = nonInventoryBillOnly ? prev[idx].quantity + 1 : Math.min(avail, prev[idx].quantity + 1);
        return prev.map((c, i) => (i === idx ? { ...c, quantity: nextQty } : c));
      }
      return [...prev, { medicineId: med.id, quantity: 1 }];
    });
    if (focusQty) {
      requestAnimationFrame(() => {
        const inp = qtyInputRefs.current[med.id];
        inp?.focus();
        inp?.select();
      });
    }
  };

  const handleRequestDiscountApproval = async () => {
    if (enteredDiscountVal <= 0) return;
    setRequestingApproval(true);
    setPosErrorMsg(null);
    try {
      const resp = await apiRequest<{ approval: { requestNumber: string; approvalPolicy: string }; db: LimsDatabase }>(
        '/api/approvals/discount-credit',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            requestType: 'DISCOUNT_OVERRIDE',
            sourceModule: 'PHARMACY_POS',
            patientName: patientName.trim() || 'Walk-In Customer',
            uhid: uhid || undefined,
            encounterLabel,
            billSubtotalNpr: fefoCartPreview.subtotal,
            requestedValueNpr: enteredDiscountVal,
            requestedPercent: discountPctOfBill,
            reason: `Pharmacy POS discount रू ${enteredDiscountVal} (${discountPctOfBill}%) exceeds cashier cap (${maxCashierDiscPct}% / रू ${maxCashierDiscNpr}).`,
          }),
        }
      );
      setApprovalStatusNote(
        `Sent ${resp.approval.requestNumber} for ${
          resp.approval.approvalPolicy === 'ADMIN_ONLY' ? 'Admin' : 'Manager → Admin'
        } approval.`
      );
      onUpdated(resp.db, `Submitted discount approval ${resp.approval.requestNumber}.`);
    } catch (err: any) {
      setPosErrorMsg(err.message || 'Discount approval request failed.');
    } finally {
      setRequestingApproval(false);
    }
  };

  const handleRequestCreditApproval = async () => {
    setRequestingApproval(true);
    setPosErrorMsg(null);
    try {
      const requestedLimit = Math.ceil((patientFinanceStatus.projectedExposureNpr + 1000) / 1000) * 1000;
      const resp = await apiRequest<{ approval: { requestNumber: string; approvalPolicy: string }; db: LimsDatabase }>(
        '/api/approvals/discount-credit',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            requestType: 'CREDIT_LIMIT_OVERRIDE',
            sourceModule: 'PHARMACY_POS',
            patientName: patientName.trim() || 'Patient',
            uhid: uhid || undefined,
            encounterLabel,
            referenceId: encounterId || patientFinanceStatus.activeIpd?.id || patientFinanceStatus.activeEr?.id,
            currentLimitNpr: patientFinanceStatus.creditLimitNpr || 0,
            requestedValueNpr: requestedLimit,
            reason: `Pharmacy credit exposure ${formatNpr(patientFinanceStatus.projectedExposureNpr)} exceeds limit ${formatNpr(
              patientFinanceStatus.creditLimitNpr || 0
            )}.`,
          }),
        }
      );
      setApprovalStatusNote(
        `Credit Limit Request ${resp.approval.requestNumber} (${formatNpr(requestedLimit)}) sent for ${
          resp.approval.approvalPolicy === 'ADMIN_ONLY' ? 'Admin' : 'Manager → Admin'
        } approval.`
      );
      onUpdated(resp.db, `Submitted Credit Limit extension ${resp.approval.requestNumber}.`);
    } catch (err: any) {
      setPosErrorMsg(err.message || 'Credit limit request failed.');
    } finally {
      setRequestingApproval(false);
    }
  };

  const handleDispense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canDispense || cart.length === 0) return;
    if (!nonInventoryBillOnly && fefoCartPreview.errors.length > 0) {
      setPosErrorMsg(fefoCartPreview.errors[0]);
      return;
    }
    if (discountBlockedWaitingApproval) {
      setPosErrorMsg(
        `Discount ${formatNpr(enteredDiscountVal)} (${discountPctOfBill}%) exceeds cashier cap (${maxCashierDiscPct}% / ${formatNpr(
          maxCashierDiscNpr
        )}). Submit for Admin approval or lower discount.`
      );
      return;
    }
    const resolvedPatientName = patientName.trim() || 'Walk-In Customer';
    if (patientFinanceStatus.limitExceeded && !(adminCreditOverride && isSuperOrSaasAdmin)) {
      setPosErrorMsg(
        `Credit Limit Exceeded (Exposure ${formatNpr(patientFinanceStatus.projectedExposureNpr)} > Limit ${formatNpr(
          patientFinanceStatus.creditLimitNpr || 0
        )}). Apply deposit / request Credit Limit Approval / switch to Cash.`
      );
      return;
    }
    setPosErrorMsg(null);
    setDispensing(true);
    try {
      const normalizedPhone = normalizeNepalPhone(patientPhone);
      const depositUsed = patientFinanceStatus.depositToApply;
      const remAfterDeposit = patientFinanceStatus.afterDeposit;
      const resolvedCashPaid =
        paymentMode === 'Cash'
          ? remAfterDeposit
          : paymentMode === 'Split'
          ? Number(cashPaid) || 0
          : paymentMode === 'Credit' && creditPartialMode === 'Cash'
          ? Math.min(remAfterDeposit, Math.max(0, Number(creditPartialAmt) || 0))
          : 0;
      const resolvedBankPaid =
        paymentMode === 'Bank / QR'
          ? remAfterDeposit
          : paymentMode === 'Split'
          ? Number(bankPaid) || 0
          : paymentMode === 'Credit' && creditPartialMode === 'Bank / QR'
          ? Math.min(remAfterDeposit, Math.max(0, Number(creditPartialAmt) || 0))
          : 0;

      const resp = await apiRequest<{ invoice: PharmacyDispenseInvoice; db: LimsDatabase }>(
        '/api/pharmacy/dispense',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            patientId: patientId || undefined,
            uhid: uhid || undefined,
            encounterType,
            encounterId: encounterId || undefined,
            encounterLabel: encounterLabel || undefined,
            nonInventoryBillOnly,
            patientName: resolvedPatientName,
            patientPhone: normalizedPhone || 'N/A',
            patientAge: patientAge ? Number(patientAge) : undefined,
            prescribingDoctor: prescribingDoctor.trim() || 'OPD / Self',
            linkedOrderAccession: linkedOrderAccession.trim() || undefined,
            centerId: effectiveCenterId,
            items: cart,
            discountNpr: Number(discountNpr) || 0,
            paymentMode,
            cashPaid: resolvedCashPaid,
            bankPaid: resolvedBankPaid,
            applyDepositAmountNpr: depositUsed,
            adminCreditOverride: adminCreditOverride && isSuperOrSaasAdmin,
            bankAccountId,
          }),
        }
      );
      setCart([]);
      setPatientId('');
      setUhid('');
      setEncounterId('');
      setEncounterType('WALKING');
      setEncounterLabel('Pharmacy Counter');
      setPatientName('');
      setPatientPhone('');
      setPatientAge('');
      setPrescribingDoctor('');
      setLinkedOrderAccession('');
      setHideCustomerDetails(false);
      setDiscountNpr('0');
      setAppliedDiscountApprovalId('');
      setApprovalStatusNote(null);
      setApplyDepositNpr('0');
      setCreditPartialAmt('0');
      setCashPaid('');
      setBankPaid('');
      setAdminCreditOverride(false);
      onClearPreselectedEncounter?.();
      setInvoiceAutoPrint(
        db.settings?.moduleSettings?.printOptions?.autoPrintByTemplate?.pharmacyBill !== 'MANUAL_PROMPT'
      );
      setActiveInvoice(resp.invoice);
      onUpdated(
        resp.db,
        `${nonInventoryBillOnly ? 'Bill-Only Pharmacy Invoice' : 'Pharmacy POS Bill'} ${resp.invoice.invoiceNumber} done (${formatNpr(resp.invoice.totalNpr)}${
          (resp.invoice.dueAmountNpr || 0) > 0 ? ` · Due ${formatNpr(resp.invoice.dueAmountNpr || 0)}` : ''
        }).`
      );
    } catch (err: any) {
      setPosErrorMsg(err.message || 'Pharmacy billing failed.');
    } finally {
      setDispensing(false);
    }
  };

  const handleCollectDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(depAmountNpr);
    if (!depPatientName.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setSavingDeposit(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/deposits', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          patientId: depPatientId || undefined,
          uhid: depUhid || undefined,
          patientName: depPatientName.trim(),
          patientPhone: normalizeNepalPhone(depPatientPhone),
          encounterType: depEncounterType,
          encounterId: depEncounterId || undefined,
          amountNpr: amt,
          paymentMode: depPayMode,
          bankAccountId,
          notes: depNotes.trim() || undefined,
        }),
      });
      setDepAmountNpr('');
      setDepNotes('');
      onUpdated(resp.db, `Collected ${formatNpr(amt)} pharmacy advance deposit from ${depPatientName.trim()}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to collect pharmacy deposit.');
    } finally {
      setSavingDeposit(false);
    }
  };

  const handleSettleInvoiceDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settleTargetInv) return;
    const amt = Number(settleAmountNpr);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSettlingDue(true);
    try {
      const resp = await apiRequest<{ invoice: PharmacyDispenseInvoice; db: LimsDatabase }>(
        `/api/pharmacy/invoices/${settleTargetInv.id}/settle-due`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            amountNpr: amt,
            paymentMode: settlePayMode,
            bankAccountId,
            note: settleNote.trim() || undefined,
          }),
        }
      );
      setSettleTargetInv(null);
      setSettleAmountNpr('');
      setSettleNote('');
      onUpdated(
        resp.db,
        `Collected ${formatNpr(amt)} on ${resp.invoice.invoiceNumber} (Remaining due: ${formatNpr(
          resp.invoice.dueAmountNpr || 0
        )}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Due settlement failed.');
    } finally {
      setSettlingDue(false);
    }
  };

  const handleWriteOff = async (batch: PharmacyBatch) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/pharmacy/batches/${batch.id}/write-off`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ reason: `Expired/damaged batch ${batch.batchNumber} quarantined` }),
        }
      );
      onUpdated(resp.db, `Quarantined & wrote off batch ${batch.batchNumber}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Write-off failed.');
    }
  };

  const openNewMedicineModal = () => {
    setEditingMedId(null);
    setMedCode('');
    setMedBrand('');
    setMedGeneric('');
    setMedForm('Tablet');
    setMedStrength('500mg');
    setMedManufacturer('Deurali-Janta Pharma (Nepal)');
    setMedCategory('General');
    setMedSchedule('OTC');
    setMedRack('A-01');
    setMedUnit('Tabs');
    setMedVat(false);
    setMedReorder('100');
    setMedInrMrp('');
    setMedMrp('12');
    setMedBuyRate('10.34');
    setShowMedModal(true);
  };

  const openEditMedicineModal = (m: PharmacyMedicine) => {
    setEditingMedId(m.id);
    setMedCode(m.code);
    setMedBrand(m.brandName);
    setMedGeneric(m.genericName);
    setMedForm(m.dosageForm);
    setMedStrength(m.strength);
    setMedManufacturer(m.manufacturer);
    setMedCategory(m.category);
    setMedSchedule(m.scheduleType);
    setMedRack(m.rackLocation);
    setMedUnit(m.unitLabel);
    setMedVat(m.vatApplicable);
    setMedReorder(String(m.reorderLevel));
    setMedInrMrp(m.inrMrp ? String(m.inrMrp) : '');
    setMedMrp(String(m.defaultMrpNpr));
    setMedBuyRate(String(m.defaultPurchaseRateNpr ?? (m.defaultMrpNpr / 1.16).toFixed(2)));
    setShowMedModal(true);
  };

  const handleSaveMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/medicines', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          id: editingMedId || undefined,
          code: medCode,
          brandName: medBrand,
          genericName: medGeneric,
          dosageForm: medForm,
          strength: medStrength,
          manufacturer: medManufacturer,
          category: medCategory,
          scheduleType: medSchedule,
          rackLocation: medRack,
          unitLabel: medUnit,
          vatApplicable: medVat,
          reorderLevel: Number(medReorder),
          inrMrp: medInrMrp ? Number(medInrMrp) : undefined,
          defaultMrpNpr: Number(medMrp),
          defaultPurchaseRateNpr: medBuyRate ? Number(medBuyRate) : undefined,
        }),
      });
      onUpdated(
        resp.db,
        editingMedId
          ? `Updated medicine ${medBrand} (${medCode}) in Pharmacy Master.`
          : `Added medicine ${medBrand} to Pharmacy Master.`
      );
      setShowMedModal(false);
      setEditingMedId(null);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save medicine.');
    }
  };

  const handleDownloadExcelTemplate = () => {
    const sampleRows = [
      {
        code: 'MED-PAR500',
        brandName: 'Niko',
        genericName: 'Paracetamol',
        dosageForm: 'Tablet',
        strength: '500mg',
        manufacturer: 'Deurali-Janta Pharma (DJPL)',
        category: 'Analgesic & Antipyretic',
        scheduleType: 'OTC',
        rackLocation: 'A-01',
        unitLabel: 'Tabs',
        vatApplicable: 'NO',
        reorderLevel: 100,
        mrpNpr: 2.0,
        purchaseRateNpr: 1.5,
        openingQty: 500,
        batchNumber: 'BATCH-2083',
        expiryDate: '2028-12-31',
      },
      {
        code: 'MED-AMOX500',
        brandName: 'Amoxycap',
        genericName: 'Amoxicillin',
        dosageForm: 'Capsule',
        strength: '500mg',
        manufacturer: 'Quest Pharmaceuticals',
        category: 'Antibiotic',
        scheduleType: 'H',
        rackLocation: 'B-04',
        unitLabel: 'Caps',
        vatApplicable: 'NO',
        reorderLevel: 60,
        mrpNpr: 14.0,
        purchaseRateNpr: 11.2,
        openingQty: 200,
        batchNumber: 'AMX-901',
        expiryDate: '2028-06-30',
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PharmacyItems');
    XLSX.writeFile(wb, 'Pharmacy_Medicine_Import_Template.xlsx');
  };

  const handleUploadMedicineExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImportingExcel(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.SheetNames[0];
      if (!firstSheet) throw new Error('Excel file has no worksheets.');
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[firstSheet], { defval: '' });
      if (rows.length === 0) throw new Error('Worksheet is empty. Add rows first.');
      const resp = await apiRequest<{
        addedMedicines: number;
        updatedMedicines: number;
        addedBatches: number;
        db: LimsDatabase;
      }>('/api/pharmacy/bulk-import', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ rows, centerId: effectiveCenterId }),
      });
      onUpdated(
        resp.db,
        `Excel Import complete: ${resp.addedMedicines} added, ${resp.updatedMedicines} updated, ${resp.addedBatches} batch(es) stocked.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Excel import failed.');
    } finally {
      setImportingExcel(false);
    }
  };

  const computedOpeningBuyRate = useMemo(() => {
    const mrp = Number(opMrpNpr) || 0;
    if (opBuyFormula === 'CUSTOM') return Number(opCustomBuyRate) || 0;
    if (opBuyFormula === 'MRP_DIV_120') return Number((mrp / 1.2).toFixed(2));
    if (opBuyFormula === 'MRP_MUL_084') return Number((mrp * 0.84).toFixed(2));
    return Number((mrp / 1.16).toFixed(2));
  }, [opMrpNpr, opBuyFormula, opCustomBuyRate]);

  const handleSaveOpeningStock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingOpening(true);
    try {
      const isNew = opMedId === 'NEW';
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/opening-stock', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          medicineId: isNew ? undefined : opMedId,
          newMedicine: isNew
            ? {
                code: opNewCode,
                brandName: opNewBrand,
                genericName: opNewGeneric,
                strength: opNewStrength,
                dosageForm: opNewForm,
                unitLabel: opNewUnit,
                defaultMrpNpr: Number(opMrpNpr) || 10,
              }
            : undefined,
          batchNumber: opBatchNo,
          expiryDate: opExpiryDate,
          quantity: Number(opQty),
          inrMrp: opInrMrp ? Number(opInrMrp) : undefined,
          mrpNpr: Number(opMrpNpr),
          buyFormula: opBuyFormula,
          purchaseRateNpr: computedOpeningBuyRate,
          notes: opNotes.trim() || undefined,
        }),
      });
      onUpdated(
        resp.db,
        `Opening Stock saved (${opQty} units · MRP रू ${opMrpNpr} · Wholesale Buy रू ${computedOpeningBuyRate}).`
      );
      setShowOpeningModal(false);
      setOpBatchNo('');
      setOpInrMrp('');
      setOpNotes('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Opening stock entry failed.');
    } finally {
      setSavingOpening(false);
    }
  };

  const handleSaveGrnBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const matchedSup = (db.pharmacySuppliers || []).find((s) => s.id === grnSupplierId);
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/batches', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          medicineId: grnMedId,
          centerId: effectiveCenterId,
          batchNumber: grnBatchNo,
          mfgDate: grnMfgDate,
          expiryDate: grnExpiryDate,
          quantityReceived: Number(grnQty),
          inrMrp: grnInrMrp ? Number(grnInrMrp) : undefined,
          purchaseRateNpr: Number(grnPurchaseRate),
          mrpNpr: Number(grnMrp),
          supplierId: grnSupplierId || undefined,
          supplierName: matchedSup?.name || grnSupplier,
          paymentStatus: grnPaymentStatus,
          postPurchaseOutflow: grnPaymentStatus === 'PAID' && grnPostLedger,
          accountId: bankAccountId,
        }),
      });
      onUpdated(resp.db, `Received GRN Batch ${grnBatchNo.toUpperCase()} (${grnPaymentStatus === 'CREDIT' ? 'Supplier Credit Due' : 'Paid'}).`);
      setShowGrnModal(false);
      setGrnBatchNo('');
      setGrnInrMrp('');
    } catch (err: any) {
      onUpdated(db, err.message || 'GRN intake failed.');
    }
  };

  // Suppliers CRUD & Due Payment
  const openSupplierModal = (sup?: PharmacySupplier) => {
    if (sup) {
      setEditingSupId(sup.id);
      setSupCode(sup.code);
      setSupName(sup.name);
      setSupContact(sup.contactPerson);
      setSupPhone(stripCountryPrefixForEdit(sup.phone));
      setSupAddress(sup.address);
      setSupPanVat(sup.panVat || '');
      setSupPaymentTerms(sup.paymentTerms);
      setSupCreditDays(String(sup.creditDays || 30));
      setSupOpeningDue(String(sup.openingDueNpr || 0));
      setSupNotes(sup.notes || '');
    } else {
      setEditingSupId(null);
      setSupCode('');
      setSupName('');
      setSupContact('');
      setSupPhone('');
      setSupAddress('');
      setSupPanVat('');
      setSupPaymentTerms('Credit 30 Days');
      setSupCreditDays('30');
      setSupOpeningDue('0');
      setSupNotes('');
    }
    setShowSupplierModal(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supName.trim()) return;
    setSavingSup(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/suppliers', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          id: editingSupId || undefined,
          code: supCode.trim() || undefined,
          name: supName.trim(),
          contactPerson: supContact.trim(),
          phone: normalizeNepalPhone(supPhone),
          address: supAddress.trim(),
          panVat: supPanVat.trim(),
          paymentTerms: supPaymentTerms,
          creditDays: Number(supCreditDays) || 0,
          openingDueNpr: Number(supOpeningDue) || 0,
          notes: supNotes.trim(),
        }),
      });
      setShowSupplierModal(false);
      onUpdated(resp.db, editingSupId ? `Updated supplier ${supName}.` : `Added supplier ${supName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save supplier.');
    } finally {
      setSavingSup(false);
    }
  };

  const handleDeleteSupplier = async (sup: PharmacySupplier) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/pharmacy/suppliers/${sup.id}`, activeUser.id, {
        method: 'DELETE',
      });
      onUpdated(resp.db, `Deleted supplier ${sup.name}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Delete supplier failed.');
    }
  };

  const handlePaySupplierDue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!paySupTarget) return;
    setPayingSup(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/pharmacy/suppliers/${paySupTarget.id}/pay`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          amountNpr: Number(paySupAmount) || 0,
          accountId: paySupAccountId,
          referenceNo: paySupRef.trim() || undefined,
          notes: paySupNotes.trim() || undefined,
        }),
      });
      setPaySupTarget(null);
      setPaySupAmount('');
      setPaySupRef('');
      setPaySupNotes('');
      onUpdated(resp.db, `Paid ${formatNpr(Number(paySupAmount) || 0)} to ${paySupTarget.name}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Supplier payment failed.');
    } finally {
      setPayingSup(false);
    }
  };

  // Manufacturers / Companies CRUD
  const openMfgModal = (mfg?: PharmacyManufacturer) => {
    if (mfg) {
      setEditingMfgId(mfg.id);
      setMfgCode(mfg.code);
      setMfgName(mfg.name);
      setMfgCountry(mfg.country || 'Nepal');
      setMfgPhone(stripCountryPrefixForEdit(mfg.contactPhone));
      setMfgAddress(mfg.address || '');
    } else {
      setEditingMfgId(null);
      setMfgCode('');
      setMfgName('');
      setMfgCountry('Nepal');
      setMfgPhone('');
      setMfgAddress('');
    }
    setShowMfgModal(true);
  };

  const handleSaveManufacturer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfgName.trim()) return;
    setSavingMfg(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/pharmacy/manufacturers', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          id: editingMfgId || undefined,
          code: mfgCode.trim() || undefined,
          name: mfgName.trim(),
          country: mfgCountry.trim() || 'Nepal',
          contactPhone: normalizeNepalPhone(mfgPhone),
          address: mfgAddress.trim(),
        }),
      });
      setShowMfgModal(false);
      onUpdated(resp.db, editingMfgId ? `Updated company ${mfgName}.` : `Added company ${mfgName}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save manufacturer.');
    } finally {
      setSavingMfg(false);
    }
  };

  const handleDeleteManufacturer = async (mfg: PharmacyManufacturer) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/pharmacy/manufacturers/${mfg.id}`, activeUser.id, {
        method: 'DELETE',
      });
      onUpdated(resp.db, `Deleted company ${mfg.name}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Delete manufacturer failed.');
    }
  };

  // DOS-Speed Keyboard Entry Shortcuts for Pharmacy POS
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (subTab !== 'pos' || showCloseModal || showMedModal || showGrnModal || showOpeningModal || activeInvoice) return;
      if (e.key === 'F2') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'F4') {
        e.preventDefault();
        setPaymentMode((prev) =>
          prev === 'Cash'
            ? 'Bank / QR'
            : prev === 'Bank / QR'
            ? 'Split'
            : prev === 'Split'
            ? 'Credit'
            : 'Cash'
        );
      } else if (e.key === 'F9' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
        e.preventDefault();
        posFormRef.current?.requestSubmit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [subTab, showCloseModal, showMedModal, showGrnModal, showOpeningModal, activeInvoice]);

  const pharmShiftLivePreview = useMemo(() => {
    const lastClose = (db.counterCloses || []).find((c) => {
      const sameScope = (c.counterScope || 'HOSPITAL') === 'PHARMACY';
      const sameCashier = !closeEmployeeOnly || c.cashierId === activeUser.id;
      return sameScope && sameCashier;
    });
    const lastTime = lastClose ? new Date(lastClose.closedAt).getTime() : 0;
    const invs = (db.pharmacyInvoices || []).filter(
      (i) =>
        new Date(i.dispensedAt).getTime() > lastTime &&
        (!closeEmployeeOnly || !i.dispensedById || i.dispensedById === activeUser.id)
    );
    const deps = (db.pharmacyDeposits || []).filter(
      (d) =>
        new Date(d.receivedAt).getTime() > lastTime &&
        (!closeEmployeeOnly || !d.receivedById || d.receivedById === activeUser.id)
    );
    const openingCash = lastClose ? lastClose.actualCountedCashNpr : 0;
    const cashSales =
      invs.reduce((s, i) => s + (i.cashPaid || 0), 0) +
      deps.filter((d) => d.paymentMode !== 'Bank / QR').reduce((s, d) => s + (d.amountNpr || 0), 0);
    const bankSales =
      invs.reduce((s, i) => s + (i.bankPaid || 0), 0) +
      deps.filter((d) => d.paymentMode === 'Bank / QR').reduce((s, d) => s + (d.amountNpr || 0), 0);
    return {
      invoiceCount: invs.length,
      depositCount: deps.length,
      openingCash,
      cashSales,
      bankSales,
      expectedCash: Number((openingCash + cashSales).toFixed(2)),
    };
  }, [db.counterCloses, db.pharmacyInvoices, db.pharmacyDeposits, closeEmployeeOnly, activeUser.id]);

  const handleFetchNepalCatalog = async () => {
    setFetchingCatalog(true);
    try {
      const resp = await apiRequest<{
        addedMedicines: number;
        addedBatches: number;
        companiesCount: number;
        db: LimsDatabase;
      }>('/api/pharmacy/fetch-nepal-catalog', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ withOpeningStock: true }),
      });
      onUpdated(
        resp.db,
        `Loaded ${resp.addedMedicines} Nepalese Pharma & Hospital Inside medicines (${resp.addedBatches} FEFO batches across ${resp.companiesCount} companies).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to fetch Nepal pharma catalog.');
    } finally {
      setFetchingCatalog(false);
    }
  };

  const handleClosePharmacyCounter = async (e: React.FormEvent) => {
    e.preventDefault();
    setClosingCounter(true);
    try {
      const resp = await apiRequest<{ record: CounterCloseRecord; db: LimsDatabase }>(
        '/api/finance/counter-close',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            shiftLabel: closeShiftLabel.trim() || `Pharmacy Shift — ${activeUser.fullName}`,
            actualCountedCashNpr:
              Number(closeCountedCash || pharmShiftLivePreview.expectedCash) || 0,
            notes: closeNotes.trim(),
            counterScope: 'PHARMACY',
            employeeOnly: closeEmployeeOnly,
          }),
        }
      );
      setShowCloseModal(false);
      setCloseCountedCash('');
      setCloseNotes('');
      onUpdated(
        resp.db,
        `Closed Pharmacy Counter (${resp.record.shiftLabel}) · Cash ${formatNpr(resp.record.expectedClosingCashNpr)} · Variance ${formatNpr(resp.record.varianceNpr)}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Pharmacy counter close failed.');
    } finally {
      setClosingCounter(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Separate Pharmacy Identity */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {db.settings?.moduleSettings?.pharmacyEntityName || 'Saptari Hospital Central Pharmacy'} ({activeFiscalYear})
          </h1>
          <p className="text-xs font-mono text-slate-600 mt-0.5">
            PAN: {db.settings?.moduleSettings?.pharmacyPanNumber || '608914210'} · DDA:{' '}
            {db.settings?.moduleSettings?.pharmacyDdaLicense || 'DDA-SAP-2081/042'} ·{' '}
            {db.settings?.moduleSettings?.pharmacyAddress || 'Hospital Pharmacy Wing, Bode Barsain'} · Separate Bank &amp; FEFO Stock Ledger
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="px-3 py-2 text-xs font-medium bg-emerald-50 text-emerald-900 border border-emerald-200 rounded-lg whitespace-nowrap">
            <span className="font-mono">
              {activeUser.roleId === 'PHARMACY_CASHIER' ? 'Pharmacy Cashier POS' : activeUser.roleId}
            </span>
          </div>

          {hasPerm('counter.close') && (
            <button
              type="button"
              onClick={() => {
                setCloseCountedCash(String(pharmShiftLivePreview.expectedCash));
                setShowCloseModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap"
            >
              <Lock className="w-3.5 h-3.5" />
              My Pharmacy Shift Close
            </button>
          )}

          {canManage && (
            <>
              <button
                type="button"
                disabled={fetchingCatalog}
                onClick={handleFetchNepalCatalog}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                {fetchingCatalog ? 'Loading...' : 'Fetch Nepal Pharma (21 Cos + Inside)'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const first = db.pharmacyMedicines[0];
                  setOpMedId(first?.id || 'NEW');
                  if (first) {
                    setOpMrpNpr(String(first.defaultMrpNpr));
                    setOpInrMrp(first.inrMrp ? String(first.inrMrp) : '');
                  }
                  setShowOpeningModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 whitespace-nowrap"
              >
                <PackagePlus className="w-3.5 h-3.5 text-amber-700" />
                Opening Stock (INR→NPR)
              </button>
              <button
                type="button"
                onClick={() => {
                  const first = db.pharmacyMedicines[0];
                  setGrnMedId(first?.id || '');
                  if (first) {
                    setGrnMrp(String(first.defaultMrpNpr));
                    setGrnPurchaseRate(String(first.defaultPurchaseRateNpr ?? (first.defaultMrpNpr / 1.16).toFixed(2)));
                  }
                  setShowGrnModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                <PackagePlus className="w-3.5 h-3.5 text-blue-600" />
                GRN Stock Intake
              </button>
              <button
                type="button"
                onClick={openNewMedicineModal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Medicine
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Medicine Catalog &amp; Active Batches</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {db.pharmacyMedicines.length} SKUs · {hubBatches.filter((b) => b.quantityOnHand > 0).length} Batches
          </div>
          <div className="text-xs text-slate-500 mt-1">Auto stock batch tracking</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Non-Expired Usable Stock</div>
          <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {kpis.usableUnits.toLocaleString()} Units
          </div>
          <div className="text-xs text-slate-500 mt-1">Ready for fast POS billing</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Expiry Radar ({nearExpiryDays}d Window)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-amber-700 mt-1">
            {kpis.nearExpiryCount} Near · <span className="text-rose-700">{kpis.expiredCount} Expired</span>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {strictBlockExpired ? 'Expired batches auto-blocked' : 'Warning only mode'}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs font-medium text-slate-500">Pharmacy Sales ({activeFiscalYear})</div>
          <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
            {formatNpr(kpis.fySales)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {(db.pharmacyInvoices || []).filter((i) => (i.centerId ?? null) === (effectiveCenterId ?? null)).length} pharmacy bills
          </div>
        </div>
      </div>

      {/* Navigation Tabs + Table Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => setSubTab('pos')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap ${
              subTab === 'pos' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
            }`}
          >
            Pharmacy POS
          </button>
          <button
            type="button"
            onClick={() => setSubTab('fefo_radar')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'fefo_radar' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Stock Batches &amp; Expiry
          </button>
          <button
            type="button"
            onClick={() => setSubTab('master_grn')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'master_grn' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Medicine Master
          </button>
          <button
            type="button"
            onClick={() => setSubTab('suppliers_ledger')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'suppliers_ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-blue-600" />
            Suppliers &amp; Party Ledger
          </button>
          <button
            type="button"
            onClick={() => setSubTab('companies')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'companies' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Factory className="w-3.5 h-3.5 text-indigo-600" />
            Companies
          </button>
          <button
            type="button"
            onClick={() => setSubTab('finance_pnl')}
            className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'finance_pnl' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
            Buy/Sell P&amp;L
          </button>
          <button
            type="button"
            onClick={() => setSubTab('invoices')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'invoices' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            Bills &amp; Audit
          </button>
          <button
            type="button"
            onClick={() => setSubTab('deposits_dues')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              subTab === 'deposits_dues' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
            }`}
          >
            <Wallet className="w-3.5 h-3.5 text-emerald-600" />
            Deposits &amp; Dues
            {creditAndDueSummary.dueInvoices.length > 0 && (
              <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-rose-600 text-white">
                {creditAndDueSummary.dueInvoices.length}
              </span>
            )}
          </button>
        </div>

        {subTab !== 'pos' && (
          <div className="flex flex-wrap items-center gap-2 flex-1 justify-end min-w-[300px]">
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="px-2.5 py-2 text-xs border border-slate-300 rounded-lg bg-white max-w-[220px]"
              title="Filter by Nepalese Pharmaceutical Company or Inside Formulary"
            >
              <option value="ALL">All Companies ({companyOptions.length})</option>
              {companyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter batch, medicine, bill # or movement..."
                className="w-full pl-9 pr-3 py-2 text-xs font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
              />
            </div>
          </div>
        )}
      </div>

      {/* Mode Switcher + DOS-Speed Keyboard Entry Bar (Full POS Workspace) */}
      {subTab === 'pos' && (
        <div className="space-y-2.5">
          <div className="bg-white border border-slate-200 rounded-xl p-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              <button
                type="button"
                onClick={() => setNonInventoryBillOnly(false)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  !nonInventoryBillOnly ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'
                }`}
              >
                Pharmacy POS (Stock Auto-Deduct)
              </button>
              <button
                type="button"
                onClick={() => setNonInventoryBillOnly(true)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                  nonInventoryBillOnly ? 'bg-amber-600 text-white shadow-sm' : 'text-slate-700 hover:bg-white'
                }`}
              >
                Non-Inventory Pharmacy Billing (Bill-Only)
              </button>
            </div>
            <div className="text-[11px] font-mono text-slate-600 px-2">
              {nonInventoryBillOnly
                ? 'NON-INVENTORY BILL-ONLY: Editable unit rate per item, zero stock deduction.'
                : 'STOCK POS MODE: Auto-selects earliest-expiry stock & builds tax bill.'}
            </div>
          </div>

          <div className="bg-slate-900 text-slate-100 rounded-xl px-4 py-2 text-[11px] font-mono flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                <Keyboard className="w-3.5 h-3.5" />
                DOS FAST PHARMACY POS:
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-amber-300">F2</kbd> Type Drug
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-amber-300">↑/↓ + Enter</kbd> Add → Qty
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-amber-300">Enter (Qty)</kbd> Next Item
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-amber-300">F4</kbd> Mode ({paymentMode})
              </span>
              <span>
                <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-amber-300">F9 / Ctrl+Enter</kbd> Bill &amp; Print Done
              </span>
            </div>
            <span className="text-slate-300">
              Operator: <strong className="text-white">{activeUser.fullName}</strong> · Counter:{' '}
              <strong>{nonInventoryBillOnly ? 'BILL-ONLY' : 'PHARMACY POS'}</strong>
            </span>
          </div>
        </div>
      )}

      {/* TAB 1: FULL DOS-STYLE PHARMACY POS */}
      {subTab === 'pos' && (
        <form ref={posFormRef} onSubmit={handleDispense} className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
          {/* Left 2 Columns: Patient/Encounter + Fast DOS Item Search & Tabular Ledger */}
          <div className="xl:col-span-2 space-y-5">
            {posErrorMsg && (
              <div className="p-3.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 flex items-start justify-between gap-2 text-xs">
                <div className="space-y-1.5">
                  <div className="flex items-start gap-2 font-medium">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <span>{posErrorMsg}</span>
                  </div>
                  {!nonInventoryBillOnly && (
                    <button
                      type="button"
                      onClick={() => {
                        setNonInventoryBillOnly(true);
                        setPosErrorMsg(null);
                      }}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 rounded hover:bg-amber-700"
                    >
                      Switch to Non-Inventory Bill-Only Mode
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPosErrorMsg(null)}
                  className="p-1 text-rose-700 hover:bg-rose-100 rounded shrink-0"
                  title="Close Alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* 1. Patient & Encounter Selection */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  1. Customer / Patient &amp; Encounter Selection
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
                        setEncounterLabel('Pharmacy Counter');
                        setPatientName('');
                        setPatientPhone('');
                        setPatientAge('');
                        setPrescribingDoctor('');
                        setHideCustomerDetails(false);
                        onClearPreselectedEncounter?.();
                      }}
                      className="px-2.5 py-1 text-[11px] font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-md"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setPatientId('');
                      setUhid('');
                      setEncounterId('');
                      setEncounterType('WALKING');
                      setEncounterLabel('Walk-In Counter');
                      setPatientName('Walk-In Customer');
                      setHideCustomerDetails(true);
                      requestAnimationFrame(() => searchInputRef.current?.focus());
                    }}
                    className="px-2.5 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
                  >
                    1-Click Walk-In
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Registered UHID / Patient</label>
                  <select
                    value={patientId}
                    onChange={(e) => {
                      const pt = (db.patients || []).find((p) => p.id === e.target.value);
                      if (pt) applyPatientRecord(pt);
                      else setHideCustomerDetails(false);
                    }}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Walk-In / Select UHID --</option>
                    {(db.patients || []).map((pt) => {
                      const det = detectPatientEncounter(db, pt);
                      return (
                        <option key={pt.id} value={pt.id}>
                          {pt.uhid} — {pt.fullName} [{det.encounterType}]
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Active IPD Bed / ER Bay</label>
                  <select
                    value={encounterId ? `${encounterType}:${encounterId}` : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setEncounterId('');
                        setHideCustomerDetails(false);
                        return;
                      }
                      const [typeStr, idStr] = val.split(':');
                      if (typeStr === 'IPD') {
                        const adm = activeIpdList.find((a) => a.id === idStr);
                        if (adm) {
                          setPatientId(adm.patientId || '');
                          setUhid(adm.uhid || '');
                          setEncounterType('IPD');
                          setEncounterId(adm.id);
                          setEncounterLabel(`IPD ${adm.admissionNumber} (${adm.currentBedLabel})`);
                          setPatientName(adm.patientName);
                          setPatientPhone(stripCountryPrefixForEdit(adm.patientPhone));
                          setPatientAge(String(adm.patientAge || ''));
                          setPrescribingDoctor(adm.admittingDoctor || '');
                          setHideCustomerDetails(true);
                        }
                      } else if (typeStr === 'EMERGENCY') {
                        const er = activeErList.find((c) => c.id === idStr);
                        if (er) {
                          setPatientId(er.patientId || '');
                          setUhid(er.uhid || '');
                          setEncounterType('EMERGENCY');
                          setEncounterId(er.id);
                          setEncounterLabel(`ER ${er.erNumber} (${er.erBedBay})`);
                          setPatientName(er.patientName);
                          setPatientPhone(stripCountryPrefixForEdit(er.patientPhone));
                          setPatientAge(String(er.patientAge || ''));
                          setPrescribingDoctor(er.attendingDoctor || '');
                          setHideCustomerDetails(true);
                        }
                      }
                    }}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Optional IPD / ER Link --</option>
                    {activeIpdList.length > 0 && (
                      <optgroup label="Admitted IPD Patients">
                        {activeIpdList.map((a) => (
                          <option key={a.id} value={`IPD:${a.id}`}>
                            {a.admissionNumber} · {a.patientName} ({a.currentBedLabel})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {activeErList.length > 0 && (
                      <optgroup label="Active Emergency Observation">
                        {activeErList.map((er) => (
                          <option key={er.id} value={`EMERGENCY:${er.id}`}>
                            {er.erNumber} · {er.patientName} ({er.erBedBay})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Encounter Mode</label>
                  <select
                    value={encounterType}
                    onChange={(e) => {
                      const next = e.target.value as EncounterType;
                      setEncounterType(next);
                      setEncounterLabel(uhid ? `${next} · ${uhid}` : `${next} Pharmacy`);
                    }}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold"
                  >
                    <option value="WALKING">WALKING (Counter)</option>
                    <option value="OPD">OPD Consultation</option>
                    <option value="EMERGENCY">EMERGENCY (Credit Tracked)</option>
                    <option value="IPD">IPD Admitted (Credit Tracked)</option>
                  </select>
                </div>
              </div>

              {hideCustomerDetails && (uhid || patientName) ? (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-slate-900 text-white border border-slate-800">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span
                      className={`px-2.5 py-0.5 text-[11px] font-mono font-bold rounded border uppercase ${ENCOUNTER_BADGE_STYLES[encounterType]}`}
                    >
                      {encounterType}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 font-mono text-amber-300 font-bold">
                      {uhid || 'WALK-IN'}
                    </span>
                    <span className="text-sm font-semibold text-white">
                      {patientName || 'Walk-In Customer'}
                    </span>
                    {encounterLabel && (
                      <span className="text-[11px] font-mono text-slate-300">({encounterLabel})</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setHideCustomerDetails(false)}
                    className="px-2.5 py-1 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-600 rounded-md whitespace-nowrap"
                  >
                    Edit Details
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">
                      Patient Name (Defaults to Walk-In)
                    </label>
                    <input
                      value={patientName}
                      onChange={(e) => setPatientName(e.target.value)}
                      placeholder="Walk-In Customer (or type name)"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mobile Number</label>
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:border-blue-600">
                      <span className="px-2 py-1.5 bg-slate-100 text-slate-700 font-mono text-[11px] border-r border-slate-300 flex items-center select-none">
                        +977
                      </span>
                      <input
                        data-no-autocap="true"
                        value={patientPhone}
                        onChange={(e) => setPatientPhone(e.target.value)}
                        placeholder="98XXXXXXXX"
                        className="w-full px-2 py-1.5 font-mono focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Age (Yrs)</label>
                    <input
                      type="number"
                      min={0}
                      value={patientAge}
                      onChange={(e) => setPatientAge(e.target.value)}
                      placeholder="32"
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Prescribing Doctor</label>
                    <input
                      value={prescribingDoctor}
                      onChange={(e) => setPrescribingDoctor(e.target.value)}
                      placeholder="Dr. / OPD"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {/* Live Patient Deposit Pool & IPD/ER Credit Limit Monitor */}
              {(patientFinanceStatus.availableDepositPool > 0 ||
                patientFinanceStatus.existingPharmacyDue > 0 ||
                patientFinanceStatus.creditLimitNpr !== null) && (
                <div
                  className={`p-3 rounded-lg border text-[11px] space-y-1.5 ${
                    patientFinanceStatus.limitExceeded
                      ? 'bg-rose-50 border-rose-300 text-rose-950'
                      : 'bg-slate-50 border-slate-200 text-slate-800'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                    <span className="inline-flex items-center gap-1">
                      <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                      {encounterType} Credit &amp; Advance Deposit Status
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDepPatientId(patientId);
                        setDepUhid(uhid);
                        setDepEncounterType(encounterType);
                        setDepEncounterId(encounterId);
                        setDepPatientName(patientName);
                        setDepPatientPhone(stripCountryPrefixForEdit(patientPhone));
                        setSubTab('deposits_dues');
                      }}
                      className="text-blue-700 hover:underline font-medium"
                    >
                      + Collect Deposit / Settle Due
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 font-mono">
                    <div>
                      Deposit Pool:{' '}
                      <strong className="text-emerald-700">
                        {formatNpr(patientFinanceStatus.availableDepositPool)}
                      </strong>
                    </div>
                    <div>
                      Open Due:{' '}
                      <strong className="text-rose-700">
                        {formatNpr(patientFinanceStatus.existingPharmacyDue)}
                      </strong>
                    </div>
                    {patientFinanceStatus.creditLimitNpr !== null && (
                      <>
                        <div>
                          Limit: <strong>{formatNpr(patientFinanceStatus.creditLimitNpr)}</strong>
                        </div>
                        <div>
                          Exposure:{' '}
                          <strong
                            className={
                              patientFinanceStatus.currentExposureNpr > patientFinanceStatus.creditLimitNpr
                                ? 'text-rose-700'
                                : 'text-slate-900'
                            }
                          >
                            {formatNpr(patientFinanceStatus.currentExposureNpr)}
                          </strong>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 2. DOS Fast Medicine Type-to-Search + Tabular Bill Ledger */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  2. DOS Fast Item Selection &amp; Bill Entry ({cart.length} item{cart.length === 1 ? '' : 's'})
                </h2>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedCompany}
                    onChange={(e) => setSelectedCompany(e.target.value)}
                    className="px-2.5 py-1 text-[11px] border border-slate-300 rounded-md bg-white max-w-[200px]"
                    title="Optional company filter"
                  >
                    <option value="ALL">All Companies ({companyOptions.length})</option>
                    {companyOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  {cart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="text-xs font-medium text-rose-700 hover:underline whitespace-nowrap"
                    >
                      Clear Bill Lines
                    </button>
                  )}
                </div>
              </div>

              {/* Type-to-Search DOS Input + Conditional Dropdown */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  ref={searchInputRef}
                  data-enter-submit="true"
                  value={searchTerm}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => setTimeout(() => setSearchFocused(false), 160)}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => {
                    const matches = filteredMedicines.slice(0, 14);
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setActiveMedIdx((prev) => Math.min(Math.max(0, matches.length - 1), prev + 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setActiveMedIdx((prev) => Math.max(0, prev - 1));
                    } else if (e.key === 'Escape') {
                      setSearchTerm('');
                      setSearchFocused(false);
                    } else if (e.key === 'Enter' && canDispense) {
                      e.preventDefault();
                      if (searchTerm.trim() === '') {
                        if (cart.length > 0) {
                          checkoutDiscountRef.current?.focus();
                          checkoutDiscountRef.current?.select();
                        }
                        return;
                      }
                      const hit =
                        matches[activeMedIdx] ||
                        matches.find((m) => nonInventoryBillOnly || getUsableQty(m.id) > 0) ||
                        matches[0];
                      if (hit) {
                        addToCart(hit, true);
                        setSearchTerm('');
                      }
                    }
                  }}
                  placeholder="[F2] Type Drug Brand/Generic/Code → Enter → Qty → Enter · Enter on blank search → Checkout"
                  className="w-full pl-9 pr-4 py-2.5 text-xs font-mono bg-slate-950 text-emerald-300 placeholder:text-slate-400 border border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />

                {/* Dropdown appears ONLY while typing */}
                {searchTerm.trim().length > 0 && (
                  <div className="mt-1 border border-slate-800 rounded-lg bg-slate-950 text-slate-100 shadow-2xl overflow-hidden max-h-72 overflow-y-auto z-20">
                    {filteredMedicines.length === 0 ? (
                      <div className="px-4 py-3 text-xs font-mono text-amber-300">
                        No matching medicine for "{searchTerm}". Use "Fetch Nepal Pharma" above or Add Medicine.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead>
                          <tr className="border-b border-slate-800 text-[10px] uppercase text-slate-400 bg-slate-900">
                            <th className="py-1.5 px-3">Code</th>
                            <th className="py-1.5 px-3">Medicine &amp; Generic</th>
                            <th className="py-1.5 px-3">Stock / Batch</th>
                            <th className="py-1.5 px-3 text-right">MRP (रू)</th>
                            <th className="py-1.5 px-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredMedicines.slice(0, 14).map((med, idx) => {
                            const focused = idx === activeMedIdx;
                            const fefoBatches = getFefoBatchesForMed(med.id);
                            const availQty = fefoBatches.reduce((s, b) => s + b.quantityOnHand, 0);
                            const nextBatch = fefoBatches[0];
                            const inCart = cart.some((c) => c.medicineId === med.id);
                            return (
                              <tr
                                key={med.id}
                                onMouseDown={(ev) => {
                                  ev.preventDefault();
                                  if (!canDispense) return;
                                  addToCart(med, true);
                                  setSearchTerm('');
                                }}
                                className={`cursor-pointer border-b border-slate-800/70 ${
                                  focused ? 'bg-blue-700 text-white' : 'hover:bg-slate-800'
                                }`}
                              >
                                <td className="py-1.5 px-3 font-bold text-amber-300">{med.code}</td>
                                <td className="py-1.5 px-3">
                                  <div className="font-semibold">
                                    {med.brandName} {med.strength}
                                  </div>
                                  <div className="text-[10px] text-slate-300">
                                    {med.genericName} · {med.manufacturer}
                                  </div>
                                </td>
                                <td className="py-1.5 px-3 text-[11px]">
                                  {nextBatch ? (
                                    <span className={focused ? 'text-white' : 'text-emerald-300'}>
                                      {availQty} {med.unitLabel} · {nextBatch.batchNumber} ({nextBatch.expiryDate})
                                    </span>
                                  ) : (
                                    <span className={focused ? 'text-amber-200' : 'text-rose-400'}>
                                      0 Stock {nonInventoryBillOnly ? '(Bill-Only OK)' : ''}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 px-3 text-right font-bold tabular-nums">
                                  {formatNpr(nextBatch?.mrpNpr ?? med.defaultMrpNpr)}
                                </td>
                                <td className="py-1.5 px-3 text-right text-[11px]">
                                  {inCart ? '✓ +1' : '+ Add [↵]'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {!searchFocused && searchTerm.trim().length === 0 && (
                  <div className="mt-1.5 text-[11px] font-mono text-slate-500 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      Formulary ready: <strong>{(db.pharmacyMedicines || []).length}</strong> items across{' '}
                      <strong>{companyOptions.length}</strong> Nepal Pharma companies &amp; Hospital formulary. Type above to select.
                    </span>
                  </div>
                )}
              </div>

              {/* DOS Tabular Billing Entry Ledger */}
              <div className="border border-slate-300 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead>
                      <tr className="bg-slate-900 text-slate-200 border-b border-slate-800 text-[11px]">
                        <th className="py-2 px-2.5 w-8">#</th>
                        <th className="py-2 px-2.5">Code</th>
                        <th className="py-2 px-2.5">Medicine Description / Batch</th>
                        <th className="py-2 px-2.5 text-center w-32">Qty</th>
                        <th className="py-2 px-2.5 text-right w-28">Rate (रू)</th>
                        <th className="py-2 px-2.5 text-right w-28">Amount (रू)</th>
                        <th className="py-2 px-2.5 text-center w-10">Del</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 bg-white">
                      {cart.map((item, idx) => {
                        const med = db.pharmacyMedicines.find((m) => m.id === item.medicineId);
                        if (!med) return null;
                        const maxAvail = nonInventoryBillOnly ? 9999 : getUsableQty(med.id);
                        const itemLines = fefoCartPreview.lines.filter((l) => l.medicine.id === med.id);
                        const rowTotal = itemLines.reduce((s, l) => s + l.lineTotal, 0);
                        const nextBatch = getFefoBatchesForMed(med.id)[0];
                        const displayRate =
                          item.customUnitPriceNpr ?? nextBatch?.mrpNpr ?? med.defaultMrpNpr;

                        return (
                          <tr key={item.medicineId} className="hover:bg-blue-50/40">
                            <td className="py-1.5 px-2.5 text-slate-500">{idx + 1}</td>
                            <td className="py-1.5 px-2.5 font-bold text-blue-700">{med.code}</td>
                            <td className="py-1.5 px-2.5 font-sans">
                              <div className="font-semibold text-slate-900">
                                {med.brandName} {med.strength}
                                <span className="ml-1.5 text-[10px] font-mono text-slate-500">
                                  ({med.genericName})
                                </span>
                              </div>
                              <div className="text-[10.5px] font-mono text-slate-500">
                                {nonInventoryBillOnly ? (
                                  <span className="text-amber-700 font-semibold">
                                    Bill-Only Mode (Zero Stock Deducted)
                                  </span>
                                ) : itemLines.length > 0 ? (
                                  itemLines
                                    .map(
                                      (l) =>
                                        `Batch ${l.batch.batchNumber} (Exp ${l.batch.expiryDate}) × ${l.takeQty}`
                                    )
                                    .join(' · ')
                                ) : (
                                  <span className="text-rose-700 font-semibold">Insufficient stock ({maxAvail} usable)</span>
                                )}
                              </div>
                            </td>
                            <td className="py-1.5 px-2.5 text-center">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (item.quantity <= 1) {
                                      setCart((prev) => prev.filter((c) => c.medicineId !== item.medicineId));
                                    } else {
                                      setCart((prev) =>
                                        prev.map((c) =>
                                          c.medicineId === item.medicineId
                                            ? { ...c, quantity: c.quantity - 1 }
                                            : c
                                        )
                                      );
                                    }
                                  }}
                                  className="p-1 border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100"
                                  title="Decrease qty"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <input
                                  ref={(el) => {
                                    qtyInputRefs.current[item.medicineId] = el;
                                  }}
                                  type="number"
                                  min={1}
                                  max={maxAvail}
                                  data-enter-submit="true"
                                  value={item.quantity}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      searchInputRef.current?.focus();
                                      searchInputRef.current?.select();
                                    }
                                  }}
                                  onChange={(e) => {
                                    const val = Math.max(1, Math.min(maxAvail, Number(e.target.value) || 1));
                                    setCart((prev) =>
                                      prev.map((c) =>
                                        c.medicineId === item.medicineId ? { ...c, quantity: val } : c
                                      )
                                    );
                                  }}
                                  className="w-14 px-1 py-1 text-center font-bold bg-blue-50/50 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                <button
                                  type="button"
                                  disabled={item.quantity >= maxAvail}
                                  onClick={() => {
                                    const val = Math.min(maxAvail, item.quantity + 1);
                                    setCart((prev) =>
                                      prev.map((c) =>
                                        c.medicineId === item.medicineId ? { ...c, quantity: val } : c
                                      )
                                    );
                                  }}
                                  className="p-1 border border-slate-300 rounded bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                                  title="Increase qty"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            </td>
                            <td className="py-1.5 px-2.5 text-right">
                              {nonInventoryBillOnly ? (
                                <input
                                  type="number"
                                  min={0}
                                  step="0.5"
                                  data-enter-submit="true"
                                  value={displayRate}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      searchInputRef.current?.focus();
                                      searchInputRef.current?.select();
                                    }
                                  }}
                                  onChange={(e) => {
                                    const rate = Math.max(0, Number(e.target.value) || 0);
                                    setCart((prev) =>
                                      prev.map((c) =>
                                        c.medicineId === item.medicineId
                                          ? { ...c, customUnitPriceNpr: rate }
                                          : c
                                      )
                                    );
                                  }}
                                  className="w-20 px-1.5 py-1 text-right font-semibold bg-white border border-amber-300 rounded focus:outline-none focus:border-amber-600"
                                />
                              ) : (
                                <span className="font-semibold text-slate-800 tabular-nums">
                                  {formatNpr(displayRate)}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 px-2.5 text-right font-bold text-slate-900 tabular-nums">
                              {formatNpr(rowTotal)}
                            </td>
                            <td className="py-1.5 px-2.5 text-center">
                              <button
                                type="button"
                                onClick={() =>
                                  setCart((prev) => prev.filter((c) => c.medicineId !== item.medicineId))
                                }
                                className="p-1 text-slate-400 hover:text-rose-700"
                                title="Remove item"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {cart.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">
                            No medicines added yet. Press [F2], type medicine code/name &amp; press Enter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {!nonInventoryBillOnly && fefoCartPreview.errors.length > 0 && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="font-semibold">{fefoCartPreview.errors.join(' ')}</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setNonInventoryBillOnly(true)}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 rounded hover:bg-amber-700"
                    >
                      Switch to Bill-Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setCart([])}
                      className="px-2.5 py-1 text-[11px] font-medium text-rose-900 bg-white border border-rose-300 rounded hover:bg-rose-100"
                    >
                      Clear Cart
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Instant Checkout & Bill Summary */}
          <div className="xl:col-span-1 bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs xl:sticky xl:top-20">
            <div className="border-b border-slate-200 pb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  3. Pharmacy Bill &amp; Checkout
                </h2>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono">
                  <span className={`px-1.5 py-0.5 rounded font-bold uppercase ${ENCOUNTER_BADGE_STYLES[encounterType]}`}>
                    {encounterType}
                  </span>
                  <span className="text-slate-600 truncate max-w-[170px]">
                    {uhid ? `${uhid} · ${patientName || 'Patient'}` : patientName || 'Walk-In Customer'}
                  </span>
                </div>
              </div>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                {cart.length} item{cart.length === 1 ? '' : 's'}
              </span>
            </div>

            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-slate-700">Discount (रू) — {discountPctOfBill}%</label>
                  <div className="flex items-center gap-1">
                    {[5, 10, 20].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() =>
                          setDiscountNpr(String(Math.round((fefoCartPreview.subtotal * pct) / 100)))
                        }
                        className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-200"
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  ref={checkoutDiscountRef}
                  data-enter-submit="true"
                  type="number"
                  min={0}
                  value={discountNpr}
                  onChange={(e) => setDiscountNpr(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (checkoutTenderedRef.current) {
                        checkoutTenderedRef.current.focus();
                        checkoutTenderedRef.current.select();
                      } else {
                        posFormRef.current?.requestSubmit();
                      }
                    }
                  }}
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
                {approvedPharmDiscounts.length > 0 && (
                  <div className="mt-1.5 p-2 rounded-lg bg-emerald-50 border border-emerald-200 space-y-1 text-[11px]">
                    <div className="font-semibold text-emerald-900">Approved Discounts:</div>
                    {approvedPharmDiscounts.map((apr) => (
                      <button
                        key={apr.id}
                        type="button"
                        onClick={() => {
                          setAppliedDiscountApprovalId(apr.id);
                          setDiscountNpr(String(apr.requestedValueNpr));
                        }}
                        className={`w-full text-left px-2 py-1 rounded border flex items-center justify-between ${
                          appliedDiscountApprovalId === apr.id
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
                  <div className="mt-1.5 p-2.5 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 space-y-1.5 text-[11px]">
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
                        {requestingApproval ? 'Requesting...' : 'Request Discount Approval'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountNpr('0')}
                        className="px-2 py-1 text-rose-800 bg-white border border-rose-300 rounded"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Payment Mode ([F4] to cycle)
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['Cash', 'Bank / QR', 'Split', 'Credit'] as PaymentMode[]).map((pm) => (
                    <button
                      key={pm}
                      type="button"
                      onClick={() => setPaymentMode(pm)}
                      className={`py-1.5 px-2 rounded-lg font-medium border text-center ${
                        paymentMode === pm
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {pm}
                    </button>
                  ))}
                </div>
              </div>

              {patientFinanceStatus.availableDepositPool > 0 && (
                <div className="bg-emerald-50/70 border border-emerald-200 rounded-lg p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-emerald-900">
                      Advance Deposit ({formatNpr(patientFinanceStatus.availableDepositPool)})
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setApplyDepositNpr(
                          String(
                            Math.min(
                              patientFinanceStatus.availableDepositPool,
                              fefoCartPreview.netTotal
                            )
                          )
                        )
                      }
                      className="px-2 py-0.5 text-[10.5px] font-semibold text-emerald-800 bg-white border border-emerald-300 rounded hover:bg-emerald-100"
                    >
                      Apply Max
                    </button>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={Math.min(patientFinanceStatus.availableDepositPool, fefoCartPreview.netTotal)}
                    value={applyDepositNpr}
                    onChange={(e) => setApplyDepositNpr(e.target.value)}
                    className="w-full px-2.5 py-1 font-mono border border-emerald-300 rounded bg-white"
                  />
                </div>
              )}

              {paymentMode === 'Credit' && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-lg p-2.5 space-y-2">
                  <div className="font-semibold text-amber-900">
                    Credit Mode — Optional Partial Payment Now
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10.5px] font-medium text-slate-700 mb-0.5">
                        Partial Paid (रू)
                      </label>
                      <input
                        ref={checkoutTenderedRef}
                        data-enter-submit="true"
                        type="number"
                        min={0}
                        max={patientFinanceStatus.afterDeposit}
                        value={creditPartialAmt}
                        onChange={(e) => setCreditPartialAmt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            posFormRef.current?.requestSubmit();
                          }
                        }}
                        className="w-full px-2.5 py-1 font-mono border border-amber-300 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[10.5px] font-medium text-slate-700 mb-0.5">
                        Partial Mode
                      </label>
                      <select
                        value={creditPartialMode}
                        onChange={(e) => setCreditPartialMode(e.target.value as 'Cash' | 'Bank / QR')}
                        className="w-full px-2 py-1 border border-amber-300 rounded bg-white"
                      >
                        <option value="Cash">Cash</option>
                        <option value="Bank / QR">Bank / QR</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-amber-950 pt-1 border-t border-amber-200">
                    <span>Remaining Posted to Credit Due:</span>
                    <strong>{formatNpr(patientFinanceStatus.proposedDueNpr)}</strong>
                  </div>
                </div>
              )}

              {paymentMode === 'Split' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Cash Part (रू)</label>
                    <input
                      ref={checkoutTenderedRef}
                      data-enter-submit="true"
                      type="number"
                      min={0}
                      value={cashPaid}
                      onChange={(e) => setCashPaid(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          posFormRef.current?.requestSubmit();
                        }
                      }}
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Bank/QR Part (रू)</label>
                    <input
                      type="number"
                      min={0}
                      value={bankPaid}
                      onChange={(e) => setBankPaid(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          posFormRef.current?.requestSubmit();
                        }
                      }}
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}

              {(paymentMode === 'Bank / QR' ||
                paymentMode === 'Split' ||
                (paymentMode === 'Credit' && Number(creditPartialAmt) > 0 && creditPartialMode === 'Bank / QR')) && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Pharmacy Bank Account</label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {(pharmacyBanks.length > 0 ? pharmacyBanks : db.accounts.filter((a) => a.type === 'BANK')).map(
                      (a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      )
                    )}
                  </select>
                </div>
              )}

              <div>
                <label className="block font-medium text-slate-700 mb-1">Linked Lab Accession (Optional)</label>
                <input
                  value={linkedOrderAccession}
                  onChange={(e) => setLinkedOrderAccession(e.target.value)}
                  placeholder="Optional SAP-2083-..."
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {patientFinanceStatus.limitExceeded && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 space-y-2 text-[11px]">
                <div className="flex items-start justify-between gap-2 font-semibold">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      {encounterType} Credit Limit Exceeded! Exposure{' '}
                      <span className="font-mono">{formatNpr(patientFinanceStatus.projectedExposureNpr)}</span>{' '}
                      &gt; Limit <span className="font-mono">{formatNpr(patientFinanceStatus.creditLimitNpr || 0)}</span>.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPaymentMode('Cash')}
                    className="p-1 text-rose-700 hover:bg-rose-100 rounded shrink-0"
                    title="Switch to Cash"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isSuperOrSaasAdmin ? (
                  <label className="flex items-center gap-2 cursor-pointer font-semibold text-rose-950">
                    <input
                      type="checkbox"
                      checked={adminCreditOverride}
                      onChange={(e) => setAdminCreditOverride(e.target.checked)}
                      className="rounded border-rose-400 text-rose-600"
                    />
                    Super Admin Credit Limit Override
                  </label>
                ) : (
                  <div className="space-y-1.5">
                    <div>
                      Collect advance deposit / partial payment or request Credit Limit extension approval.
                    </div>
                    <button
                      type="button"
                      disabled={requestingApproval}
                      onClick={handleRequestCreditApproval}
                      className="px-2.5 py-1 text-[11px] font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded disabled:opacity-50"
                    >
                      {requestingApproval ? 'Submitting...' : 'Request Credit Limit Approval'}
                    </button>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('Cash')}
                    className="px-2.5 py-1 text-[11px] font-medium text-white bg-rose-700 rounded hover:bg-rose-800"
                  >
                    Switch to Cash
                  </button>
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="px-2.5 py-1 text-[11px] font-medium text-rose-900 bg-white border border-rose-300 rounded hover:bg-rose-100"
                  >
                    Cancel Cart
                  </button>
                </div>
              </div>
            )}

            {approvalStatusNote && (
              <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 font-mono text-[11px] font-semibold">
                {approvalStatusNote}
              </div>
            )}

            <div className="border-t border-slate-200 pt-3 space-y-1.5 font-mono tabular-nums">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span>{formatNpr(fefoCartPreview.subtotal)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Discount / VAT (13%):</span>
                <span>
                  -{formatNpr(fefoCartPreview.discount)} / +{formatNpr(fefoCartPreview.vat)}
                </span>
              </div>
              <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                <span>Net Payable:</span>
                <span>{formatNpr(fefoCartPreview.netTotal)}</span>
              </div>
              {patientFinanceStatus.depositToApply > 0 && (
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Advance Deposit Applied:</span>
                  <span>-{formatNpr(patientFinanceStatus.depositToApply)}</span>
                </div>
              )}
              {patientFinanceStatus.proposedDueNpr > 0 && (
                <div className="flex justify-between text-rose-700 font-bold">
                  <span>Balance Posted to Credit Due:</span>
                  <span>{formatNpr(patientFinanceStatus.proposedDueNpr)}</span>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={
                !canDispense ||
                dispensing ||
                cart.length === 0 ||
                discountBlockedWaitingApproval ||
                (!nonInventoryBillOnly && fefoCartPreview.errors.length > 0) ||
                (patientFinanceStatus.limitExceeded && !(adminCreditOverride && isSuperOrSaasAdmin))
              }
              className="w-full py-3 inline-flex items-center justify-center gap-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 shadow-sm"
            >
              <Printer className="w-4 h-4" />
              {dispensing
                ? 'Issuing Pharmacy Bill...'
                : nonInventoryBillOnly
                ? `Issue Bill-Only Invoice (${formatNpr(fefoCartPreview.netTotal)})`
                : paymentMode === 'Credit'
                ? `Credit Bill & Print (${formatNpr(fefoCartPreview.netTotal)} · Due ${formatNpr(patientFinanceStatus.proposedDueNpr)})`
                : `Bill & Print Done [F9 / Enter] (${formatNpr(fefoCartPreview.netTotal)})`}
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: FEFO BATCH & EXPIRY RADAR */}
      {subTab === 'fefo_radar' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Strict FEFO Batch Queue (Sorted by Earliest Expiry First)
              </h2>
              <p className="text-xs text-slate-500">
                Expired batches are automatically bypassed during dispensing and flagged for DDA quarantine write-off.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="py-2.5 px-4">Medicine</th>
                  <th className="py-2.5 px-4">Batch # / GRN</th>
                  <th className="py-2.5 px-4">Expiry Date</th>
                  <th className="py-2.5 px-4">FEFO Status</th>
                  <th className="py-2.5 px-4 text-right">On Hand</th>
                  <th className="py-2.5 px-4 text-right">Cost / MRP (रू)</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatches.map((b) => {
                  const med = db.pharmacyMedicines.find((m) => m.id === b.medicineId);
                  const dLeft = daysUntil(b.expiryDate);
                  const isExpired = b.expiryDate < todayYmd;
                  const isNear90 = !isExpired && dLeft <= 90;
                  return (
                    <tr
                      key={b.id}
                      className={isExpired || isNear90 ? 'bg-rose-50/70 hover:bg-rose-100/60' : 'hover:bg-slate-50/70'}
                    >
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">
                          {med ? `${med.brandName} ${med.strength}` : b.medicineId}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {med?.genericName} · Rack {med?.rackLocation}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        <div className="font-semibold text-slate-900">{b.batchNumber}</div>
                        <div className="text-[11px] text-slate-500">
                          {b.grnNumber} · {b.supplierName}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-mono tabular-nums">
                        <div className={isExpired || isNear90 ? 'font-bold text-rose-700' : 'font-semibold text-slate-900'}>
                          {b.expiryDate}
                        </div>
                        <div className={isExpired || isNear90 ? 'text-[11px] font-semibold text-rose-700' : 'text-[11px] text-slate-500'}>
                          {dLeft < 0 ? `${Math.abs(dLeft)}d overdue` : `${dLeft}d remaining`}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 font-semibold">
                        {b.quarantined ? (
                          <span className="text-slate-500">● Quarantined / Written Off</span>
                        ) : isExpired ? (
                          <span className="inline-flex items-center gap-1 text-rose-700">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            Expired (FEFO Blocked)
                          </span>
                        ) : isNear90 ? (
                          <span className="inline-flex items-center gap-1 text-rose-700">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            ≤90 Days — Priority / Return / Discount
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Active FEFO Pool
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                        {b.quantityOnHand} / {b.quantityReceived} {med?.unitLabel || ''}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        {formatNpr(b.purchaseRateNpr)} / <strong>{formatNpr(b.mrpNpr)}</strong>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {canManage && !b.quarantined && b.quantityOnHand > 0 ? (
                          <button
                            type="button"
                            onClick={() => handleWriteOff(b)}
                            className="px-2.5 py-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100 whitespace-nowrap"
                          >
                            Quarantine / Write Off
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
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

      {/* TAB 3: MEDICINE MASTER */}
      {subTab === 'master_grn' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {canManage && (
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-600">
                <strong className="text-slate-900">Medicine &amp; Item Master ({filteredMedicines.length})</strong>{' '}
                — Import items &amp; opening stock batches in bulk via Excel (.xlsx / .xls / .csv).
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadExcelTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                  Download Excel Template
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  {importingExcel ? 'Importing Excel...' : 'Upload Excel (.xlsx / .csv)'}
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={importingExcel}
                    onChange={handleUploadMedicineExcel}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="py-2.5 px-4">Code &amp; Brand</th>
                  <th className="py-2.5 px-4">Generic Composition</th>
                  <th className="py-2.5 px-4">Form &amp; Rack</th>
                  <th className="py-2.5 px-4">DDA Schedule &amp; VAT</th>
                  <th className="py-2.5 px-4 text-right">Hub Stock</th>
                  <th className="py-2.5 px-4 text-right">MRP / Buy (रू)</th>
                  {canManage && <th className="py-2.5 px-4 text-right">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMedicines.map((m) => {
                  const usable = getUsableQty(m.id);
                  const low = usable <= m.reorderLevel;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900">
                          {m.brandName} {m.strength}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {m.code} · {m.manufacturer}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-700">
                        <div>{m.genericName}</div>
                        <div className="text-[11px] text-slate-500">{m.category}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono">
                        {m.dosageForm} · Rack <strong>{m.rackLocation}</strong>
                      </td>
                      <td className="py-2.5 px-4">
                        <span>{m.scheduleType}</span> ·{' '}
                        <span className="font-mono">{m.vatApplicable ? '13% VAT' : 'VAT Exempt'}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        <span className={low ? 'text-rose-700 font-bold' : 'text-slate-900 font-semibold'}>
                          {usable} {m.unitLabel}
                        </span>
                        <div className="text-[10px] text-slate-500">Min: {m.reorderLevel}</div>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                        <div className="font-semibold text-slate-900">{formatNpr(m.defaultMrpNpr)}</div>
                        <div className="text-[10px] text-slate-500">
                          Buy: {formatNpr(m.defaultPurchaseRateNpr ?? Number((m.defaultMrpNpr / 1.16).toFixed(2)))}
                          {m.inrMrp ? ` · ₹${m.inrMrp}` : ''}
                        </div>
                      </td>
                      {canManage && (
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => openEditMedicineModal(m)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap"
                          >
                            <Edit3 className="w-3 h-3" />
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3B: SUPPLIERS & PARTY LEDGER (ADD / EDIT / DELETE / PAY DUE) */}
      {subTab === 'suppliers_ledger' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Pharmacy Suppliers &amp; Party Credit Ledger ({(db.pharmacySuppliers || []).length} parties)
              </h2>
              <p className="text-xs text-slate-500">
                Track wholesale distributors, credit payment terms, unpaid party dues, and pay suppliers directly from Pharmacy Bank/Cash.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-mono">
                Total Party Payable: <strong className="text-rose-700">{formatNpr(pharmFinanceSummary.totalSupplierDue)}</strong>
              </div>
              {canManage && (
                <button
                  type="button"
                  onClick={() => openSupplierModal()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Supplier Party
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="py-2.5 px-4">Code &amp; Party Name</th>
                    <th className="py-2.5 px-4">Contact &amp; Phone</th>
                    <th className="py-2.5 px-4">PAN / Address</th>
                    <th className="py-2.5 px-4">Payment Terms</th>
                    <th className="py-2.5 px-4 text-right">Opening Due</th>
                    <th className="py-2.5 px-4 text-right">Current Due (रू)</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(db.pharmacySuppliers || [])
                    .filter((s) => !q || `${s.code} ${s.name} ${s.phone} ${s.address}`.toLowerCase().includes(q))
                    .map((sup) => (
                      <tr key={sup.id} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="font-semibold text-slate-900">{sup.name}</div>
                          <div className="font-mono text-[11px] text-slate-500">{sup.code}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="text-slate-800">{sup.contactPerson || '—'}</div>
                          <div className="font-mono text-[11px] text-slate-500">{sup.phone || '—'}</div>
                        </td>
                        <td className="py-2.5 px-4">
                          <div className="font-mono text-[11px] text-slate-700">PAN: {sup.panVat || '—'}</div>
                          <div className="text-[11px] text-slate-500">{sup.address || '—'}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-700">
                          {sup.paymentTerms} ({sup.creditDays}d)
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600">
                          {formatNpr(sup.openingDueNpr || 0)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold">
                          <span className={(sup.currentDueNpr || 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                            {formatNpr(sup.currentDueNpr || 0)}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            {canManage && (sup.currentDueNpr || 0) > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPaySupTarget(sup);
                                  setPaySupAmount(String(sup.currentDueNpr));
                                  setPaySupRef('');
                                  setPaySupNotes('');
                                }}
                                className="px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded"
                              >
                                Pay Due
                              </button>
                            )}
                            {canManage && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openSupplierModal(sup)}
                                  className="p-1.5 text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                                  title="Edit Supplier"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSupplier(sup)}
                                  className="p-1.5 text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100"
                                  title="Delete Supplier"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  {(db.pharmacySuppliers || []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No pharmacy suppliers registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3C: PHARMA COMPANIES / MANUFACTURERS (ADD / EDIT / DELETE) */}
      {subTab === 'companies' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Pharmaceutical Manufacturers &amp; Companies ({(db.pharmacyManufacturers || []).length} saved)
              </h2>
              <p className="text-xs text-slate-500">
                Add, edit, or delete pharmaceutical companies available inside Medicine Master &amp; POS filters.
              </p>
            </div>
            {canManage && (
              <button
                type="button"
                onClick={() => openMfgModal()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Manufacturer / Company
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-4">Company / Manufacturer Name</th>
                    <th className="py-2.5 px-4">Country</th>
                    <th className="py-2.5 px-4">Phone / Address</th>
                    <th className="py-2.5 px-4 text-right">SKUs Linked</th>
                    {canManage && <th className="py-2.5 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(db.pharmacyManufacturers || [])
                    .filter((m) => !q || `${m.code} ${m.name} ${m.country || ''}`.toLowerCase().includes(q))
                    .map((mfg) => {
                      const skuCount = (db.pharmacyMedicines || []).filter(
                        (med) => med.manufacturer.toLowerCase() === mfg.name.toLowerCase()
                      ).length;
                      return (
                        <tr key={mfg.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-mono font-semibold text-indigo-700">{mfg.code}</td>
                          <td className="py-2.5 px-4 font-semibold text-slate-900">{mfg.name}</td>
                          <td className="py-2.5 px-4 text-slate-700">{mfg.country || 'Nepal'}</td>
                          <td className="py-2.5 px-4 text-slate-600 font-mono text-[11px]">
                            {mfg.contactPhone || '—'} · {mfg.address || '—'}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-semibold">{skuCount}</td>
                          {canManage && (
                            <td className="py-2.5 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => openMfgModal(mfg)}
                                  className="p-1.5 text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                                  title="Edit Company"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteManufacturer(mfg)}
                                  className="p-1.5 text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100"
                                  title="Delete Company"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3D: PHARMACY PROFIT & LOSS (BUY VS SELL RATE LEDGER) */}
      {subTab === 'finance_pnl' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Total Pharmacy Sales ({activeFiscalYear})</div>
              <div className="text-xl font-bold font-mono tabular-nums text-blue-700 mt-1">
                {formatNpr(pharmFinanceSummary.totalNetSales)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Gross {formatNpr(pharmFinanceSummary.totalGrossSales)} · Disc -{formatNpr(pharmFinanceSummary.totalDiscounts)}
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Cost of Goods Sold (Wholesale Buy Rate)</div>
              <div className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
                {formatNpr(pharmFinanceSummary.totalCogsCost)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Across {pharmFinanceSummary.billCount} billed invoices
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Net Operating Profit / Loss</div>
              <div
                className={`text-xl font-bold font-mono tabular-nums mt-1 ${
                  pharmFinanceSummary.netProfitAfterVat >= 0 ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {pharmFinanceSummary.netProfitAfterVat >= 0 ? '+' : ''}
                {formatNpr(pharmFinanceSummary.netProfitAfterVat)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                Sell Revenue ex-VAT minus Buy COGS
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Live Closing Stock Valuation</div>
              <div className="text-xl font-bold font-mono tabular-nums text-indigo-700 mt-1">
                {formatNpr(pharmFinanceSummary.stockBuyValuation)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                MRP Value: {formatNpr(pharmFinanceSummary.stockMrpValuation)} (+{formatNpr(pharmFinanceSummary.potentialInventoryProfit)} margin)
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                Bill-by-Bill Buy Rate vs Sell Rate Profit Ledger
              </h3>
              <span className="text-xs font-mono text-slate-600">
                Supplier Due Balance: <strong className="text-rose-700">{formatNpr(pharmFinanceSummary.totalSupplierDue)}</strong>
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="py-2.5 px-4">Invoice / Date</th>
                    <th className="py-2.5 px-4">Patient</th>
                    <th className="py-2.5 px-4 text-right">Net Sale (ex-VAT)</th>
                    <th className="py-2.5 px-4 text-right">Buy Cost (COGS)</th>
                    <th className="py-2.5 px-4 text-right">Profit / Loss</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredInvoices.map((inv) => {
                    const saleExVat = Number(((inv.totalNpr || 0) - (inv.vatNpr || 0)).toFixed(2));
                    const invCost = Number(
                      (inv.lines || [])
                        .reduce((s, ln) => {
                          const med = db.pharmacyMedicines.find((m) => m.id === ln.medicineId);
                          const batch = db.pharmacyBatches.find((b) => b.id === ln.batchId);
                          const buy =
                            ln.purchaseRateNpr ??
                            batch?.purchaseRateNpr ??
                            med?.defaultPurchaseRateNpr ??
                            Number(((ln.unitPriceNpr || 0) / 1.16).toFixed(2));
                          return s + buy * (ln.quantity || 0);
                        }, 0)
                        .toFixed(2)
                    );
                    const pnl = Number((saleExVat - invCost).toFixed(2));
                    return (
                      <tr key={inv.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-4 font-mono">
                          <div className="font-semibold text-slate-900">{inv.invoiceNumber}</div>
                          <div className="text-[11px] text-slate-500">{adToBs(inv.dispensedAt).formattedEn}</div>
                        </td>
                        <td className="py-2 px-4">{inv.patientName}</td>
                        <td className="py-2 px-4 text-right font-mono">{formatNpr(saleExVat)}</td>
                        <td className="py-2 px-4 text-right font-mono text-slate-600">{formatNpr(invCost)}</td>
                        <td className={`py-2 px-4 text-right font-mono font-bold ${pnl >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                          {pnl >= 0 ? '+' : ''}{formatNpr(pnl)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: PHARMACY INVOICES & STOCK MOVEMENTS */}
      {subTab === 'invoices' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900 flex items-center gap-2">
              <Pill className="w-4 h-4 text-blue-600" />
              Pharmacy POS Invoices ({filteredInvoices.length})
            </div>
            <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
              {filteredInvoices.map((inv) => {
                const bs = adToBs(inv.dispensedAt);
                return (
                  <div key={inv.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-slate-900">
                        {inv.invoiceNumber} · {inv.patientName}
                      </div>
                      <div className="text-slate-600 mt-0.5">
                        {bs.formattedEn} · {inv.paymentMode} · {inv.lines.length} batch lines
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                        {inv.lines.map((l) => `${l.batchNumber}(Exp ${l.expiryDate})`).join(', ')}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="font-mono tabular-nums font-bold text-slate-900">
                          {formatNpr(inv.totalNpr)}
                        </div>
                        {(inv.dueAmountNpr || 0) > 0 && (
                          <div className="text-[10px] font-mono font-bold text-rose-700">
                            Due: {formatNpr(inv.dueAmountNpr || 0)}
                          </div>
                        )}
                      </div>
                      {(inv.dueAmountNpr || 0) > 0 && canDispense && (
                        <button
                          type="button"
                          onClick={() => {
                            setSettleTargetInv(inv);
                            setSettleAmountNpr(String(inv.dueAmountNpr || 0));
                            setSettleNote('');
                          }}
                          className="px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
                        >
                          Settle Due
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setInvoiceAutoPrint(false);
                          setActiveInvoice(inv);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Bill / PDF
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900 flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              Pharmacy Stock &amp; FEFO Audit Movements
            </div>
            <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
              {(db.pharmacyMovements || [])
                .filter((m) => (m.centerId ?? null) === (effectiveCenterId ?? null))
                .filter(
                  (m) =>
                    !q ||
                    `${m.medicineName} ${m.batchNumber} ${m.referenceId} ${m.notes}`
                      .toLowerCase()
                      .includes(q)
                )
                .map((m) => (
                  <div key={m.id} className="px-4 py-2.5 text-xs flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">
                        {m.type} · {m.medicineName} (Batch {m.batchNumber})
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {m.notes} · Ref {m.referenceId} · {m.performedBy}
                      </div>
                    </div>
                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className={m.quantityDelta >= 0 ? 'text-emerald-700 font-bold' : 'text-rose-700 font-bold'}>
                        {m.quantityDelta >= 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                      </div>
                      <div className="text-[10px] text-slate-500">Bal: {m.balanceAfter}</div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: ADVANCE DEPOSITS & CREDIT DUE MANAGEMENT (IPD / ER / OPD / WALKING) */}
      {subTab === 'deposits_dues' && (
        <div className="space-y-6">
          {/* Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Available Patient Advance Deposits</div>
              <div className="text-xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
                {formatNpr(creditAndDueSummary.totalAvailableDepositsNpr)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {(db.pharmacyDeposits || []).filter((d) => d.remainingBalanceNpr > 0).length} active deposit balances
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Outstanding Pharmacy Credit Dues</div>
              <div className="text-xl font-bold font-mono tabular-nums text-rose-700 mt-1">
                {formatNpr(creditAndDueSummary.totalPendingDueNpr)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {creditAndDueSummary.dueInvoices.length} unpaid credit/partial invoices
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-500">Default Credit Ceilings</div>
              <div className="text-sm font-bold font-mono tabular-nums text-slate-900 mt-1">
                IPD: {formatNpr(db.settings?.moduleSettings?.ipdDefaultCreditLimitNpr || 25000)} · ER:{' '}
                {formatNpr(db.settings?.moduleSettings?.emergencyDefaultCreditLimitNpr || 15000)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">Enforced live on Credit billing</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Collect Deposit + Ledger */}
            <div className="lg:col-span-5 space-y-4">
              <form
                onSubmit={handleCollectDeposit}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
              >
                <div className="border-b border-slate-200 pb-2.5">
                  <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-emerald-600" />
                    Collect Pharmacy Advance Security Deposit
                  </h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Deposits auto-apply FIFO during POS billing and update Emergency / IPD exposure headroom.
                  </p>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Select Active IPD / ER / Patient</label>
                  <select
                    value={depEncounterId ? `${depEncounterType}:${depEncounterId}` : ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setDepEncounterId('');
                        return;
                      }
                      const [typeStr, idStr] = val.split(':');
                      if (typeStr === 'IPD') {
                        const a = activeIpdList.find((x) => x.id === idStr);
                        if (a) {
                          setDepPatientId(a.patientId || '');
                          setDepUhid(a.uhid || '');
                          setDepEncounterType('IPD');
                          setDepEncounterId(a.id);
                          setDepPatientName(a.patientName);
                          setDepPatientPhone(a.patientPhone || '');
                        }
                      } else if (typeStr === 'EMERGENCY') {
                        const er = activeErList.find((x) => x.id === idStr);
                        if (er) {
                          setDepPatientId(er.patientId || '');
                          setDepUhid(er.uhid || '');
                          setDepEncounterType('EMERGENCY');
                          setDepEncounterId(er.id);
                          setDepPatientName(er.patientName);
                          setDepPatientPhone(er.patientPhone || '');
                        }
                      }
                    }}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Custom / Direct Patient --</option>
                    {activeIpdList.length > 0 && (
                      <optgroup label="Admitted IPD Patients">
                        {activeIpdList.map((a) => (
                          <option key={a.id} value={`IPD:${a.id}`}>
                            {a.admissionNumber} · {a.patientName} ({a.currentBedLabel})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {activeErList.length > 0 && (
                      <optgroup label="Active Emergency Cases">
                        {activeErList.map((er) => (
                          <option key={er.id} value={`EMERGENCY:${er.id}`}>
                            {er.erNumber} · {er.patientName} ({er.erBedBay})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Patient Full Name *</label>
                    <input
                      required
                      value={depPatientName}
                      onChange={(e) => setDepPatientName(e.target.value)}
                      placeholder="Patient full name"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Mobile Number</label>
                    <div className="flex rounded-lg border border-slate-300 overflow-hidden focus-within:border-blue-600">
                      <span className="px-2 py-1.5 bg-slate-100 text-slate-700 font-mono text-[11px] border-r border-slate-300 flex items-center select-none">
                        +977
                      </span>
                      <input
                        data-no-autocap="true"
                        value={depPatientPhone}
                        onChange={(e) => setDepPatientPhone(e.target.value)}
                        placeholder="98XXXXXXXX"
                        className="w-full px-2 py-1.5 font-mono focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Encounter</label>
                    <select
                      value={depEncounterType}
                      onChange={(e) => setDepEncounterType(e.target.value as EncounterType)}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="IPD">IPD</option>
                      <option value="EMERGENCY">EMERGENCY</option>
                      <option value="OPD">OPD</option>
                      <option value="WALKING">WALKING</option>
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Deposit Amount (रू) *</label>
                    <input
                      type="number"
                      min={1}
                      step="0.01"
                      required
                      value={depAmountNpr}
                      onChange={(e) => setDepAmountNpr(e.target.value)}
                      placeholder="5000"
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Payment Mode</label>
                    <select
                      value={depPayMode}
                      onChange={(e) => setDepPayMode(e.target.value as 'Cash' | 'Bank / QR')}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Bank / QR">Bank / QR</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                    <input
                      value={depNotes}
                      onChange={(e) => setDepNotes(e.target.value)}
                      placeholder="Security deposit for IPD/ER medicines..."
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canDispense || savingDeposit}
                  className="w-full py-2 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {savingDeposit ? 'Recording Deposit...' : 'Collect & Post Advance Deposit'}
                </button>
              </form>

              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-900">
                  Advance Deposit Register ({(db.pharmacyDeposits || []).length})
                </div>
                <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto text-xs">
                  {(db.pharmacyDeposits || []).length === 0 ? (
                    <div className="p-6 text-center text-slate-500">No pharmacy advance deposits collected yet.</div>
                  ) : (
                    (db.pharmacyDeposits || []).map((dep) => (
                      <div key={dep.id} className="p-3 flex items-center justify-between gap-2">
                        <div>
                          <div className="font-mono font-semibold text-slate-900">
                            {dep.receiptNumber} · {dep.patientName}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {dep.encounterLabel || dep.encounterType} · {dep.paymentMode} · {adToBs(dep.receivedAt).formattedEn}
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <div className="font-bold text-emerald-700">
                            Bal {formatNpr(dep.remainingBalanceNpr)}
                          </div>
                          <div className="text-[10px] text-slate-500">Orig {formatNpr(dep.amountNpr)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Credit Invoices & Due Settlement */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Pharmacy Credit Invoices &amp; Due Settlement
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Track unpaid IPD, Emergency &amp; patient credit bills and post due collections to Cash / Bank.
                  </p>
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDueFilterMode('PENDING_ONLY')}
                    className={`px-2.5 py-1 rounded font-medium ${
                      dueFilterMode === 'PENDING_ONLY' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Pending Dues ({creditAndDueSummary.dueInvoices.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueFilterMode('ALL_CREDIT')}
                    className={`px-2.5 py-1 rounded font-medium ${
                      dueFilterMode === 'ALL_CREDIT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    All Credit Bills ({creditAndDueSummary.creditHistoryInvoices.length})
                  </button>
                </div>
              </div>

              <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto text-xs">
                {(dueFilterMode === 'PENDING_ONLY'
                  ? creditAndDueSummary.dueInvoices
                  : creditAndDueSummary.creditHistoryInvoices
                ).length === 0 ? (
                  <div className="p-8 text-center text-slate-500">
                    No credit or pending due pharmacy invoices in this view.
                  </div>
                ) : (
                  (dueFilterMode === 'PENDING_ONLY'
                    ? creditAndDueSummary.dueInvoices
                    : creditAndDueSummary.creditHistoryInvoices
                  ).map((inv) => {
                    const dueAmt = inv.dueAmountNpr || 0;
                    const paidAmt = inv.paidAmountNpr ?? Math.max(0, inv.totalNpr - dueAmt);
                    return (
                      <div key={inv.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{inv.invoiceNumber}</span>
                            <span className="font-semibold text-slate-900">{inv.patientName}</span>
                            <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-slate-100 text-slate-700 border border-slate-200">
                              {inv.encounterType || 'WALKING'}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded ${
                                dueAmt <= 0
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border border-rose-200'
                              }`}
                            >
                              {dueAmt <= 0 ? 'PAID' : `DUE ${formatNpr(dueAmt)}`}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {adToBs(inv.dispensedAt).formattedEn} · Total {formatNpr(inv.totalNpr)} · Deposit Applied{' '}
                            {formatNpr(inv.depositAppliedNpr || 0)} · Collected {formatNpr(paidAmt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {dueAmt > 0 && canDispense && (
                            <button
                              type="button"
                              onClick={() => {
                                setSettleTargetInv(inv);
                                setSettleAmountNpr(String(dueAmt));
                                setSettleNote('');
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700"
                            >
                              <Check className="w-3.5 h-3.5" />
                              Settle Due
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setInvoiceAutoPrint(false);
                              setActiveInvoice(inv);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Bill
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Medicine Modal (with INR -> NPR x 1.6 & MRP / 1.16 Wholesale Rate Calculator) */}
      {showMedModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setShowMedModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingMedId ? 'Edit Pharmacy Master Formulation' : 'Add Formulation to Pharmacy Master'}
              </h3>
              <button type="button" onClick={() => setShowMedModal(false)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveMedicine} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Medicine Code *</label>
                  <input required value={medCode} onChange={(e) => setMedCode(e.target.value.toUpperCase())} placeholder="MED-MET500" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Brand Name *</label>
                  <input required value={medBrand} onChange={(e) => setMedBrand(e.target.value)} placeholder="Glycomet" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Generic Composition *</label>
                  <input required value={medGeneric} onChange={(e) => setMedGeneric(e.target.value)} placeholder="Metformin Hydrochloride" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Dosage Form</label>
                  <select value={medForm} onChange={(e) => setMedForm(e.target.value as PharmacyDosageForm)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                    {DOSAGE_FORMS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Strength</label>
                  <input value={medStrength} onChange={(e) => setMedStrength(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Manufacturer / Company</label>
                  <select
                    value={medManufacturer}
                    onChange={(e) => setMedManufacturer(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {companyOptions.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <input value={medCategory} onChange={(e) => setMedCategory(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Schedule</label>
                  <select value={medSchedule} onChange={(e) => setMedSchedule(e.target.value as PharmacyMedicine['scheduleType'])} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                    <option value="OTC">OTC</option>
                    <option value="Schedule H (Rx)">Schedule H (Rx)</option>
                    <option value="Narcotic / DDA">Narcotic / DDA</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Rack / Shelf</label>
                  <input value={medRack} onChange={(e) => setMedRack(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Unit Label</label>
                  <input value={medUnit} onChange={(e) => setMedUnit(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Reorder Level</label>
                  <input type="number" value={medReorder} onChange={(e) => setMedReorder(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>

                {/* INR -> NPR & Wholesale Buy Rate Auto Calculator */}
                <div className="col-span-2 p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-medium text-amber-900 mb-1">Indian MRP (₹ INR)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={medInrMrp}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMedInrMrp(val);
                        const inr = Number(val);
                        if (inr > 0) {
                          const npr = Number((inr * 1.6).toFixed(2));
                          setMedMrp(String(npr));
                          setMedBuyRate(String(Number((npr / 1.16).toFixed(2))));
                        }
                      }}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1.5 font-mono border border-amber-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-800 mb-1">Nepal MRP (रू × 1.6)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={medMrp}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMedMrp(val);
                        const npr = Number(val);
                        if (npr > 0) {
                          setMedBuyRate(String(Number((npr / 1.16).toFixed(2))));
                        }
                      }}
                      className="w-full px-2.5 py-1.5 font-mono font-bold border border-slate-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-800 mb-1">Buy Rate (MRP÷1.16)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={medBuyRate}
                      onChange={(e) => setMedBuyRate(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded bg-white"
                    />
                  </div>
                </div>

                <div className="col-span-2 flex items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={medVat} onChange={(e) => setMedVat(e.target.checked)} className="rounded border-slate-300" />
                    <span>13% Nepal VAT Applicable</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowMedModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg">
                  {editingMedId ? 'Save Medicine Changes' : 'Save Medicine'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Opening Stock Entry Modal (INR -> NPR x 1.6 & Wholesale Buy Formula Calculator) */}
      {showOpeningModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setShowOpeningModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-xl shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-amber-50">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Pharmacy Opening Stock Entry (INR → NPR &amp; Wholesale Margin Calculator)
                </h3>
                <p className="text-[11px] text-slate-600">
                  Zero Treasury Bank deduction · Auto-converts INR × 1.6 → NPR Selling MRP &amp; computes Wholesale Buy Rate.
                </p>
              </div>
              <button type="button" onClick={() => setShowOpeningModal(false)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveOpeningStock} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Medicine Formulation *</label>
                <select
                  value={opMedId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setOpMedId(id);
                    const found = db.pharmacyMedicines.find((m) => m.id === id);
                    if (found) {
                      setOpMrpNpr(String(found.defaultMrpNpr));
                      setOpInrMrp(found.inrMrp ? String(found.inrMrp) : '');
                    }
                  }}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="NEW">+ Create New Medicine Inline...</option>
                  {db.pharmacyMedicines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brandName} {m.strength} ({m.code}) · Cur MRP {formatNpr(m.defaultMrpNpr)}
                    </option>
                  ))}
                </select>
              </div>

              {opMedId === 'NEW' && (
                <div className="grid grid-cols-3 gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Code *</label>
                    <input required value={opNewCode} onChange={(e) => setOpNewCode(e.target.value.toUpperCase())} placeholder="MED-NEW01" className="w-full px-2.5 py-1 font-mono border border-slate-300 rounded bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Brand Name *</label>
                    <input required value={opNewBrand} onChange={(e) => setOpNewBrand(e.target.value)} placeholder="Pan-D" className="w-full px-2.5 py-1 border border-slate-300 rounded bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Generic *</label>
                    <input required value={opNewGeneric} onChange={(e) => setOpNewGeneric(e.target.value)} placeholder="Pantoprazole + Domperidone" className="w-full px-2.5 py-1 border border-slate-300 rounded bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Strength</label>
                    <input value={opNewStrength} onChange={(e) => setOpNewStrength(e.target.value)} className="w-full px-2.5 py-1 border border-slate-300 rounded bg-white" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Form</label>
                    <select value={opNewForm} onChange={(e) => setOpNewForm(e.target.value as PharmacyDosageForm)} className="w-full px-2 py-1 border border-slate-300 rounded bg-white">
                      {DOSAGE_FORMS.map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium mb-1">Unit</label>
                    <input value={opNewUnit} onChange={(e) => setOpNewUnit(e.target.value)} className="w-full px-2.5 py-1 border border-slate-300 rounded bg-white" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Batch Number *</label>
                  <input required value={opBatchNo} onChange={(e) => setOpBatchNo(e.target.value.toUpperCase())} placeholder="OP-2083" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Expiry Date *</label>
                  <input required type="date" value={opExpiryDate} onChange={(e) => setOpExpiryDate(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Opening Qty *</label>
                  <input required type="number" min={1} value={opQty} onChange={(e) => setOpQty(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
              </div>

              <div className="p-3 rounded-lg bg-amber-50/70 border border-amber-200 space-y-2.5">
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-amber-900 mb-1">Indian MRP (₹ INR)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={opInrMrp}
                      onChange={(e) => {
                        const val = e.target.value;
                        setOpInrMrp(val);
                        const inr = Number(val);
                        if (inr > 0) {
                          setOpMrpNpr(String(Number((inr * 1.6).toFixed(2))));
                        }
                      }}
                      placeholder="e.g., 100"
                      className="w-full px-2.5 py-1.5 font-mono bg-white border border-amber-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-800 mb-1">Nepal MRP (रू = INR×1.6) *</label>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min={0.01}
                      value={opMrpNpr}
                      onChange={(e) => setOpMrpNpr(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono font-bold bg-white border border-slate-300 rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-800 mb-1">Wholesale Buy Formula</label>
                    <select
                      value={opBuyFormula}
                      onChange={(e) => setOpBuyFormula(e.target.value as any)}
                      className="w-full px-2 py-1.5 bg-white border border-slate-300 rounded"
                    >
                      <option value="MRP_DIV_116">MRP ÷ 1.16 (Nepal 16%)</option>
                      <option value="MRP_DIV_120">MRP ÷ 1.20 (20%)</option>
                      <option value="MRP_MUL_084">MRP × 0.84 (-16%)</option>
                      <option value="CUSTOM">Custom Rate</option>
                    </select>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-amber-200 font-mono">
                  <span className="text-amber-950">
                    Computed Wholesale Buy Rate: <strong>{formatNpr(computedOpeningBuyRate)}</strong>
                  </span>
                  {opBuyFormula === 'CUSTOM' && (
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={opCustomBuyRate}
                      onChange={(e) => setOpCustomBuyRate(e.target.value)}
                      className="w-28 px-2 py-1 text-right bg-white border border-amber-300 rounded"
                    />
                  )}
                  <span className="text-emerald-800 font-semibold">
                    Stock Val: {formatNpr(computedOpeningBuyRate * (Number(opQty) || 0))}
                  </span>
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Opening Audit Remark</label>
                <input value={opNotes} onChange={(e) => setOpNotes(e.target.value)} placeholder="Opening balance carryforward..." className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowOpeningModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingOpening} className="px-4 py-1.5 font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50">
                  {savingOpening ? 'Posting...' : 'Save Opening Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GRN Batch Intake Modal (with INR -> NPR & Buy Rate Auto-Calculator) */}
      {showGrnModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setShowGrnModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">GRN Pharmacy Batch Intake (FEFO Queue)</h3>
              <button type="button" onClick={() => setShowGrnModal(false)} className="p-1 text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveGrnBatch} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Medicine Formulation *</label>
                  <select
                    value={grnMedId}
                    onChange={(e) => {
                      const id = e.target.value;
                      setGrnMedId(id);
                      const m = db.pharmacyMedicines.find((x) => x.id === id);
                      if (m) {
                        setGrnMrp(String(m.defaultMrpNpr));
                        setGrnPurchaseRate(String(m.defaultPurchaseRateNpr ?? Number((m.defaultMrpNpr / 1.16).toFixed(2))));
                        setGrnInrMrp(m.inrMrp ? String(m.inrMrp) : '');
                      }
                    }}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.pharmacyMedicines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brandName} {m.strength} ({m.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Batch Number *</label>
                  <input required value={grnBatchNo} onChange={(e) => setGrnBatchNo(e.target.value.toUpperCase())} placeholder="BT-2609" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Quantity Received *</label>
                  <input required type="number" min={1} value={grnQty} onChange={(e) => setGrnQty(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">MFG Date</label>
                  <input type="date" value={grnMfgDate} onChange={(e) => setGrnMfgDate(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Expiry Date (FEFO Key) *</label>
                  <input required type="date" value={grnExpiryDate} onChange={(e) => setGrnExpiryDate(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2 grid grid-cols-3 gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Indian MRP (₹ INR)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={grnInrMrp}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGrnInrMrp(val);
                        const inr = Number(val);
                        if (inr > 0) {
                          const npr = Number((inr * 1.6).toFixed(2));
                          setGrnMrp(String(npr));
                          setGrnPurchaseRate(String(Number((npr / 1.16).toFixed(2))));
                        }
                      }}
                      placeholder="Optional"
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Selling MRP (रू ×1.6)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={grnMrp}
                      onChange={(e) => {
                        const val = e.target.value;
                        setGrnMrp(val);
                        const npr = Number(val);
                        if (npr > 0) {
                          setGrnPurchaseRate(String(Number((npr / 1.16).toFixed(2))));
                        }
                      }}
                      className="w-full px-2.5 py-1.5 font-mono font-semibold border border-slate-300 rounded bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-700 mb-1">Purchase Rate (÷1.16)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={grnPurchaseRate}
                      onChange={(e) => setGrnPurchaseRate(e.target.value)}
                      className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded bg-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Supplier / Party Ledger</label>
                  <select
                    value={grnSupplierId}
                    onChange={(e) => {
                      const sid = e.target.value;
                      setGrnSupplierId(sid);
                      const sup = (db.pharmacySuppliers || []).find((x) => x.id === sid);
                      if (sup) setGrnSupplier(sup.name);
                    }}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Direct / Custom Supplier --</option>
                    {(db.pharmacySuppliers || []).map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.name} ({sup.paymentTerms})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Purchase Payment Mode</label>
                  <select
                    value={grnPaymentStatus}
                    onChange={(e) => setGrnPaymentStatus(e.target.value as 'PAID' | 'CREDIT')}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-semibold"
                  >
                    <option value="PAID">Paid Now (Cash / Bank Outflow)</option>
                    <option value="CREDIT">Credit Purchase (Add to Supplier Due)</option>
                  </select>
                </div>
                {!grnSupplierId && (
                  <div className="col-span-2">
                    <label className="block font-medium text-slate-700 mb-1">Custom Supplier Name</label>
                    <input value={grnSupplier} onChange={(e) => setGrnSupplier(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                  </div>
                )}
                {grnPaymentStatus === 'PAID' && (
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={grnPostLedger} onChange={(e) => setGrnPostLedger(e.target.checked)} className="rounded border-slate-300" />
                      <span>Post purchase outflow to Treasury Bank/Cash Ledger</span>
                    </label>
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowGrnModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg">Receive Stock Batch</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settle Due Modal */}
      {settleTargetInv && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setSettleTargetInv(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-emerald-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Settle Pharmacy Credit Due — {settleTargetInv.invoiceNumber}
                </h3>
                <p className="text-[11px] text-slate-600">
                  {settleTargetInv.patientName} · Remaining Due: {formatNpr(settleTargetInv.dueAmountNpr || 0)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettleTargetInv(null)}
                className="text-slate-500 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSettleInvoiceDue} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Collection Amount (रू) *</label>
                  <input
                    type="number"
                    min={1}
                    max={settleTargetInv.dueAmountNpr || 0}
                    step="0.01"
                    required
                    value={settleAmountNpr}
                    onChange={(e) => setSettleAmountNpr(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mode</label>
                  <select
                    value={settlePayMode}
                    onChange={(e) => setSettlePayMode(e.target.value as 'Cash' | 'Bank / QR')}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Cash">Cash</option>
                    <option value="Bank / QR">Bank / QR</option>
                  </select>
                </div>
              </div>
              {settlePayMode === 'Bank / QR' && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Deposit Bank Account</label>
                  <select
                    value={bankAccountId}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {(pharmacyBanks.length > 0 ? pharmacyBanks : db.accounts.filter((a) => a.type === 'BANK')).map(
                      (a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      )
                    )}
                  </select>
                </div>
              )}
              <div>
                <label className="block font-medium text-slate-700 mb-1">Receipt / Collection Remark</label>
                <input
                  value={settleNote}
                  onChange={(e) => setSettleNote(e.target.value)}
                  placeholder="Optional reference or cashier remark..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setSettleTargetInv(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={settlingDue}
                  className="px-4 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  {settlingDue ? 'Posting...' : 'Collect & Post Due Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {activeInvoice && (
        <PharmacyInvoiceModal
          invoice={activeInvoice}
          settings={db.settings}
          documentDesigns={db.documentDesigns}
          centers={db.centers}
          autoPrint={invoiceAutoPrint}
          onClose={() => {
            setActiveInvoice(null);
            setInvoiceAutoPrint(false);
          }}
        />
      )}

      {/* Per-Employee Pharmacy Counter Close Modal */}
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
                  Pharmacy Counter Shift Close — {activeUser.fullName}
                </h3>
              </div>
              <button type="button" onClick={() => setShowCloseModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleClosePharmacyCounter} className="p-5 space-y-3 text-xs">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1 font-mono">
                <div>Open Pharmacy Invoices: <strong>{pharmShiftLivePreview.invoiceCount}</strong> (+ {pharmShiftLivePreview.depositCount} deposits)</div>
                <div>Expected Cash Drawer: <strong className="text-emerald-700">{formatNpr(pharmShiftLivePreview.expectedCash)}</strong></div>
                <div>Expected Bank / QR: <strong className="text-blue-700">{formatNpr(pharmShiftLivePreview.bankSales)}</strong></div>
              </div>
              <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={closeEmployeeOnly}
                  onChange={(e) => setCloseEmployeeOnly(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>Count Only My Logged-In Employee Pharmacy Bills (@{activeUser.username})</span>
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
                  {closingCounter ? 'Closing...' : 'Close My Pharmacy Shift'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Supplier Add / Edit Modal */}
      {showSupplierModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowSupplierModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingSupId ? 'Edit Pharmacy Supplier Party' : 'Add Pharmacy Supplier Party'}
              </h3>
              <button type="button" onClick={() => setShowSupplierModal(false)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveSupplier} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Party Code</label>
                  <input value={supCode} onChange={(e) => setSupCode(e.target.value.toUpperCase())} placeholder="Auto (SUP-001)" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Supplier Name *</label>
                  <input required value={supName} onChange={(e) => setSupName(e.target.value)} placeholder="Janakpur Medicos" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Contact Person</label>
                  <input value={supContact} onChange={(e) => setSupContact(e.target.value)} placeholder="Representative Name" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Mobile Number</label>
                  <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                    <span className="px-2 py-1.5 bg-slate-100 text-slate-700 font-mono text-[11px] border-r border-slate-300">+977</span>
                    <input data-no-autocap="true" value={supPhone} onChange={(e) => setSupPhone(e.target.value)} placeholder="98XXXXXXXX" className="w-full px-2 py-1.5 font-mono focus:outline-none" />
                  </div>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">PAN / VAT No.</label>
                  <input data-no-autocap="true" value={supPanVat} onChange={(e) => setSupPanVat(e.target.value)} placeholder="60..." className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Terms</label>
                  <select value={supPaymentTerms} onChange={(e) => setSupPaymentTerms(e.target.value as PharmacySupplier['paymentTerms'])} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
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
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Opening Due (रू)</label>
                  <input type="number" min={0} step="0.01" value={supOpeningDue} onChange={(e) => setSupOpeningDue(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Address</label>
                  <input value={supAddress} onChange={(e) => setSupAddress(e.target.value)} placeholder="City, District" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Notes</label>
                  <input value={supNotes} onChange={(e) => setSupNotes(e.target.value)} placeholder="Bank account or credit terms note" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowSupplierModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingSup} className="px-4 py-1.5 font-semibold text-white bg-blue-600 rounded-lg disabled:opacity-50">
                  {savingSup ? 'Saving...' : editingSupId ? 'Update Supplier' : 'Save Supplier'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Supplier Due Modal */}
      {paySupTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setPaySupTarget(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-emerald-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Pay Supplier Due — {paySupTarget.name}</h3>
                <p className="text-[11px] font-mono text-slate-600">Current Payable: {formatNpr(paySupTarget.currentDueNpr)}</p>
              </div>
              <button type="button" onClick={() => setPaySupTarget(null)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handlePaySupplierDue} className="p-5 space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Payment Amount (रू) *</label>
                <input required type="number" min={1} step="0.01" value={paySupAmount} onChange={(e) => setPaySupAmount(e.target.value)} className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Pay From Cash / Bank Account</label>
                <select value={paySupAccountId} onChange={(e) => setPaySupAccountId(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white">
                  {db.accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name} (Bal: {formatNpr(a.currentBalance)})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Cheque / Voucher Ref</label>
                <input data-no-autocap="true" value={paySupRef} onChange={(e) => setPaySupRef(e.target.value)} placeholder="Optional ref #" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Remarks</label>
                <input value={paySupNotes} onChange={(e) => setPaySupNotes(e.target.value)} placeholder="Invoice settlement note" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setPaySupTarget(null)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={payingSup} className="px-4 py-1.5 font-semibold text-white bg-emerald-600 rounded-lg disabled:opacity-50">
                  {payingSup ? 'Paying...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manufacturer / Company Add / Edit Modal */}
      {showMfgModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowMfgModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-indigo-50 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {editingMfgId ? 'Edit Manufacturer / Company' : 'Add Manufacturer / Company'}
              </h3>
              <button type="button" onClick={() => setShowMfgModal(false)} className="text-slate-500">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveManufacturer} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Company Code</label>
                  <input value={mfgCode} onChange={(e) => setMfgCode(e.target.value.toUpperCase())} placeholder="Auto (MFG-001)" className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg" />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Country</label>
                  <input value={mfgCountry} onChange={(e) => setMfgCountry(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Company / Manufacturer Name *</label>
                <input required value={mfgName} onChange={(e) => setMfgName(e.target.value)} placeholder="e.g., Quest Pharmaceuticals" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Contact Phone</label>
                <div className="flex rounded-lg border border-slate-300 overflow-hidden">
                  <span className="px-2 py-1.5 bg-slate-100 text-slate-700 font-mono text-[11px] border-r border-slate-300">+977</span>
                  <input data-no-autocap="true" value={mfgPhone} onChange={(e) => setMfgPhone(e.target.value)} placeholder="01-..." className="w-full px-2 py-1.5 font-mono focus:outline-none" />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Headquarters / Address</label>
                <input value={mfgAddress} onChange={(e) => setMfgAddress(e.target.value)} placeholder="Kathmandu / Birgunj / India" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button type="button" onClick={() => setShowMfgModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">Cancel</button>
                <button type="submit" disabled={savingMfg} className="px-4 py-1.5 font-semibold text-white bg-indigo-600 rounded-lg disabled:opacity-50">
                  {savingMfg ? 'Saving...' : editingMfgId ? 'Update Company' : 'Save Company'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
