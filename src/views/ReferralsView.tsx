import React, { useEffect, useState } from 'react';
import {
  Ambulance,
  Building2,
  Calculator,
  CheckCircle2,
  DollarSign,
  Edit3,
  Plus,
  Search,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type {
  AmbulanceMaster,
  LimsDatabase,
  PermissionKey,
  ReferralCaseRule,
  ReferralPartner,
  ReferralTestOverride,
  ReferredHospitalMaster,
  StaffMember,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { normalizeNepalPhone, sanitizePersonName } from '../utils/textFormat';

interface ReferralsViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function ReferralsView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: ReferralsViewProps) {
  const canManage = hasPerm('referrals.manage');
  const canApprovePayout = hasPerm('referrals.approve_payout');
  const [subTab, setSubTab] = useState<'partners' | 'hospitals_ambulances' | 'direct_calc'>(
    'partners'
  );
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [editing, setEditing] = useState<ReferralPartner | null>(null);
  const [payoutPartner, setPayoutPartner] = useState<ReferralPartner | null>(null);
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutAccId, setPayoutAccId] = useState(db.accounts[0]?.id || '');
  const [payoutBankName, setPayoutBankName] = useState('');
  const [payoutAccountNumber, setPayoutAccountNumber] = useState('');
  const [payoutHolderName, setPayoutHolderName] = useState('');
  const [payoutRefOrReceipt, setPayoutRefOrReceipt] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [processingReqId, setProcessingReqId] = useState<string | null>(null);

  // Referred Hospitals Master CRUD
  const [editingHospitalId, setEditingHospitalId] = useState<string | null>(null);
  const [hospName, setHospName] = useState('');
  const [hospAddress, setHospAddress] = useState('');
  const [hospPhone, setHospPhone] = useState('');
  const [hospManagerName, setHospManagerName] = useState('');
  const [hospManagerPhone, setHospManagerPhone] = useState('');
  const [hospSpecialties, setHospSpecialties] = useState('');
  const [savingHosp, setSavingHosp] = useState(false);

  // Ambulances Master CRUD
  const [editingAmbulanceId, setEditingAmbulanceId] = useState<string | null>(null);
  const [ambName, setAmbName] = useState('');
  const [ambVehicleNo, setAmbVehicleNo] = useState('');
  const [ambType, setAmbType] = useState<AmbulanceMaster['vehicleType']>('ALS Ambulance');
  const [ambDriverName, setAmbDriverName] = useState('');
  const [ambDriverPhone, setAmbDriverPhone] = useState('');
  const [ambCommMode, setAmbCommMode] = useState<'FLAT' | 'PERCENT'>('FLAT');
  const [ambCommValue, setAmbCommValue] = useState('500');
  const [ambCaseOverrides, setAmbCaseOverrides] = useState<ReferralCaseRule[]>([]);
  const [savingAmb, setSavingAmb] = useState(false);

  // Direct External Referral + Dynamic Billing Tier Calculator
  const [dirUhid, setDirUhid] = useState('');
  const [dirPatientName, setDirPatientName] = useState('');
  const [dirPatientPhone, setDirPatientPhone] = useState('');
  const [dirHospitalId, setDirHospitalId] = useState('');
  const [dirHospitalName, setDirHospitalName] = useState('');
  const [dirHospitalPlace, setDirHospitalPlace] = useState('');
  const [dirManagerName, setDirManagerName] = useState('');
  const [dirManagerPhone, setDirManagerPhone] = useState('');
  const [dirAmbulanceId, setDirAmbulanceId] = useState('');
  const [dirAmbulanceName, setDirAmbulanceName] = useState('');
  const [dirAmbulanceNo, setDirAmbulanceNo] = useState('');
  const [dirDriverName, setDirDriverName] = useState('');
  const [dirDriverPhone, setDirDriverPhone] = useState('');
  const [dirCaseType, setDirCaseType] = useState('RTA Case');
  const [dirTransportMode, setDirTransportMode] = useState<
    'ALS Ambulance' | 'BLS Ambulance' | 'Hospital Vehicle' | 'Private Vehicle'
  >('ALS Ambulance');
  const [dirReason, setDirReason] = useState('');
  const [dirCondition, setDirCondition] = useState('Critical / Stabilized for Transfer');
  const [tierCalc, setTierCalc] = useState<{
    uhid: string;
    erTotal: number;
    admTotal: number;
    posTotal: number;
    combinedFirstBillNpr: number;
    caseRule: ReferralCaseRule | null;
    caseCommissionNpr: number;
    matchingTier: { label: string; minTotalBillNpr: number; commissionAmountNpr: number } | null;
    tierCommissionNpr: number;
    totalDynamicCommissionNpr: number;
  } | null>(null);
  const [calcLoading, setCalcLoading] = useState(false);
  const [savingDirect, setSavingDirect] = useState(false);

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const openNew = () => {
    setEditing({
      id: '',
      code: '',
      name: '',
      type: 'Physician',
      phone: '',
      address: 'Bode Barsain, Saptari',
      bankName: '',
      bankBranch: 'Bode Barsain',
      accountHolderName: '',
      accountNumber: '',
      walletId: '',
      panNumber: '',
      defaultMode: 'PERCENT',
      defaultValue: 15,
      testOverrides: [],
      totalReferredSales: 0,
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      active: true,
    });
  };

  const handleSavePartner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    try {
      const payload = { ...editing, phone: normalizeNepalPhone(editing.phone || '') };
      const resp = editing.id
        ? await apiRequest<{ db: any }>(`/api/referrals/${editing.id}`, activeUser.id, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiRequest<{ db: any }>('/api/referrals', activeUser.id, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      onUpdated(resp.db, `Saved referral partner ${editing.name}.`);
      setEditing(null);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save referral partner.');
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutPartner) return;
    try {
      const resp = await apiRequest<{ db: any; request: { requestNumber: string } }>(
        `/api/referrals/${payoutPartner.id}/payout-request`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            amount: Number(payoutAmount),
            accountId: payoutAccId,
            bankName: payoutBankName.trim() || undefined,
            accountNumber: payoutAccountNumber.trim() || undefined,
            accountHolderName: payoutHolderName.trim() || undefined,
            paymentRefOrReceipt: payoutRefOrReceipt.trim() || undefined,
            notes: payoutNotes.trim() || undefined,
          }),
        }
      );
      onUpdated(
        resp.db,
        `Submitted payout request ${resp.request.requestNumber} (${formatNpr(Number(payoutAmount))}) for Admin approval.`
      );
      setPayoutPartner(null);
      setPayoutRefOrReceipt('');
      setPayoutNotes('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Commission payout request failed.');
    }
  };

  const handleApproveReq = async (reqId: string) => {
    setProcessingReqId(reqId);
    try {
      const resp = await apiRequest<{ db: any }>(
        `/api/referrals/payout-requests/${reqId}/approve`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            accountId: payoutAccId || db.accounts[0]?.id,
            approvalRemarks: 'Verified partner account details & approved by Hospital Admin.',
          }),
        }
      );
      onUpdated(resp.db, 'Approved & settled referral payout request from Treasury.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Approval failed.');
    } finally {
      setProcessingReqId(null);
    }
  };

  const handleRejectReq = async (reqId: string) => {
    setProcessingReqId(reqId);
    try {
      const resp = await apiRequest<{ db: any }>(
        `/api/referrals/payout-requests/${reqId}/reject`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            approvalRemarks: 'Rejected by Hospital Admin — recheck bank/wallet reference.',
          }),
        }
      );
      onUpdated(resp.db, 'Rejected referral payout request.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Rejection failed.');
    } finally {
      setProcessingReqId(null);
    }
  };

  const addOverrideRow = () => {
    if (!editing || db.services.length === 0) return;
    const srv = db.services[0];
    const next: ReferralTestOverride = {
      serviceId: srv.id,
      serviceCode: srv.code,
      mode: 'FLAT',
      value: 200,
    };
    setEditing({ ...editing, testOverrides: [...editing.testOverrides, next] });
  };

  const payoutRequests = db.referralPayoutRequests || [];

  const hospitalsMaster = db.referredHospitalsMaster || [];
  const ambulancesMaster = db.ambulancesMaster || [];

  const handleSaveHospital = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !hospName.trim() || !hospManagerName.trim() || !hospManagerPhone.trim()) return;
    setSavingHosp(true);
    try {
      const payload = {
        name: hospName.trim(),
        address: hospAddress.trim(),
        phone: hospPhone.trim(),
        managerName: hospManagerName.trim(),
        managerPhone: hospManagerPhone.trim(),
        specialties: hospSpecialties.trim(),
      };
      const resp = editingHospitalId
        ? await apiRequest<{ db: any }>(`/api/referrals/hospitals/${editingHospitalId}`, activeUser.id, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiRequest<{ db: any }>('/api/referrals/hospitals', activeUser.id, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setEditingHospitalId(null);
      setHospName('');
      setHospAddress('');
      setHospPhone('');
      setHospManagerName('');
      setHospManagerPhone('');
      setHospSpecialties('');
      onUpdated(resp.db, `Saved referred hospital ${payload.name}.`);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Failed to save referred hospital.');
    } finally {
      setSavingHosp(false);
    }
  };

  const handleDeleteHospital = async (id: string, name: string) => {
    if (!canManage) return;
    try {
      const resp = await apiRequest<{ db: any }>(`/api/referrals/hospitals/${id}`, activeUser.id, {
        method: 'DELETE',
      });
      onUpdated(resp.db, `Deleted referred hospital ${name}.`);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Delete failed.');
    }
  };

  const handleSaveAmbulance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !ambName.trim() || !ambVehicleNo.trim()) return;
    setSavingAmb(true);
    try {
      const payload = {
        name: ambName.trim(),
        vehicleNumber: ambVehicleNo.trim().toUpperCase(),
        vehicleType: ambType,
        driverName: ambDriverName.trim(),
        driverPhone: ambDriverPhone.trim(),
        defaultCommissionMode: ambCommMode,
        defaultCommissionValue: Math.max(0, Number(ambCommValue) || 0),
        caseOverrides: ambCaseOverrides,
      };
      const resp = editingAmbulanceId
        ? await apiRequest<{ db: any }>(`/api/referrals/ambulances/${editingAmbulanceId}`, activeUser.id, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await apiRequest<{ db: any }>('/api/referrals/ambulances', activeUser.id, {
            method: 'POST',
            body: JSON.stringify(payload),
          });
      setEditingAmbulanceId(null);
      setAmbName('');
      setAmbVehicleNo('');
      setAmbDriverName('');
      setAmbDriverPhone('');
      setAmbCommValue('500');
      setAmbCaseOverrides([]);
      onUpdated(resp.db, `Saved ambulance ${payload.name} (${payload.vehicleNumber}).`);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Failed to save ambulance.');
    } finally {
      setSavingAmb(false);
    }
  };

  const handleDeleteAmbulance = async (id: string, label: string) => {
    if (!canManage) return;
    try {
      const resp = await apiRequest<{ db: any }>(`/api/referrals/ambulances/${id}`, activeUser.id, {
        method: 'DELETE',
      });
      onUpdated(resp.db, `Deleted ambulance ${label}.`);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Delete failed.');
    }
  };

  const calculateDynamicBillingTier = async (
    uhidVal = dirUhid,
    caseVal = dirCaseType,
    ambVal = dirAmbulanceId
  ) => {
    if (!uhidVal.trim()) return;
    setCalcLoading(true);
    try {
      const params = new URLSearchParams({
        uhid: uhidVal.trim(),
        caseType: caseVal.trim(),
        ambulanceId: ambVal.trim(),
      });
      const resp = await apiRequest<NonNullable<typeof tierCalc>>(
        `/api/referrals/patient-billing-tier?${params.toString()}`,
        activeUser.id
      );
      setTierCalc(resp);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Failed to calculate billing tier commission.');
    } finally {
      setCalcLoading(false);
    }
  };

  const handleCreateDirectReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !dirHospitalName.trim() || !dirPatientName.trim()) return;
    setSavingDirect(true);
    try {
      const resp = await apiRequest<{ db: any }>('/api/referrals/direct-external', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          uhid: dirUhid.trim() || undefined,
          patientName: dirPatientName.trim(),
          patientPhone: dirPatientPhone.trim(),
          referredHospitalId: dirHospitalId || undefined,
          referredToHospital: dirHospitalName.trim(),
          referredToPlace: dirHospitalPlace.trim(),
          referredHospitalManagerName: dirManagerName.trim() || undefined,
          referredHospitalManagerPhone: dirManagerPhone.trim() || undefined,
          ambulanceId: dirAmbulanceId || undefined,
          ambulanceName: dirAmbulanceName.trim() || undefined,
          ambulanceNumber: dirAmbulanceNo.trim() || undefined,
          ambulanceDriverName: dirDriverName.trim() || undefined,
          ambulanceDriverPhone: dirDriverPhone.trim() || undefined,
          referralCaseType: dirCaseType.trim() || undefined,
          transportMode: dirTransportMode,
          referralReason: dirReason.trim() || 'Referred via Referrals Desk',
          conditionAtReferral: dirCondition.trim(),
          commissionCalculatedNpr: tierCalc?.totalDynamicCommissionNpr,
        }),
      });
      setDirUhid('');
      setDirPatientName('');
      setDirPatientPhone('');
      setDirReason('');
      setTierCalc(null);
      onUpdated(resp.db, `Logged external referral to ${dirHospitalName.trim()} with manager alert.`);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Failed to record direct external referral.');
    } finally {
      setSavingDirect(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Referral Management, Hospitals, Ambulances &amp; Dynamic Payouts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Doctor &amp; clinic commissions, Saved Referred Hospitals (with Manager Phone/WhatsApp), Ambulance commission overrides (RTA/Poison/LSCS), and First-Bill Tier Calculator.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => setSubTab('partners')}
              className={`px-3 py-1.5 font-medium rounded-md ${
                subTab === 'partners' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Partners &amp; Payouts ({db.referrals.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('hospitals_ambulances')}
              className={`px-3 py-1.5 font-medium rounded-md inline-flex items-center gap-1 ${
                subTab === 'hospitals_ambulances' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Ambulance className="w-3.5 h-3.5 text-rose-600" />
              Hospitals ({hospitalsMaster.length}) &amp; Ambulances ({ambulancesMaster.length})
            </button>
            <button
              type="button"
              onClick={() => setSubTab('direct_calc')}
              className={`px-3 py-1.5 font-medium rounded-md inline-flex items-center gap-1 ${
                subTab === 'direct_calc' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              <Calculator className="w-3.5 h-3.5 text-blue-600" />
              Add External Referral &amp; Tier Calc
            </button>
          </div>
          {subTab === 'partners' && (
            <>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search doctor, partner, bank A/C, phone..."
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
              {canManage && (
                <button
                  type="button"
                  onClick={openNew}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Referral Partner
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {subTab === 'partners' && (
      <>

      {/* Most Frequent Patient Referrals Leaderboard */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Most Frequent Patient Referrals (Leaderboard by Patient Volume)
          </h2>
          <span className="text-xs font-mono text-slate-500">
            {db.orders.filter((o) => o.referralPartnerId).length} Total Referred Patient Orders
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {db.referrals
            .map((r) => ({
              ...r,
              refCount: db.orders.filter((o) => o.referralPartnerId === r.id).length,
            }))
            .sort((a, b) => b.refCount - a.refCount || b.totalReferredSales - a.totalReferredSales)
            .slice(0, 4)
            .map((r, idx) => (
              <div key={r.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 text-xs">
                <div className="flex items-center justify-between font-mono text-[11px] text-slate-500">
                  <span>#{idx + 1} · {r.type}</span>
                  <span className="font-bold text-blue-700">{r.refCount} Patients</span>
                </div>
                <div className="font-semibold text-slate-900 mt-1 truncate">{r.name}</div>
                <div className="font-mono text-slate-600 mt-0.5">
                  Sales: {formatNpr(r.totalReferredSales)}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Partners Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
                <th className="py-3 px-4">Referral Partner</th>
                <th className="py-3 px-4">Bank / Wallet Account Details</th>
                <th className="py-3 px-4">Default &amp; Test Overrides</th>
                <th className="py-3 px-4 text-right">Referred Sales</th>
                <th className="py-3 px-4 text-right">Earned / Paid</th>
                <th className="py-3 px-4 text-right">Pending Payable</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {db.referrals
                .filter((ref) => {
                  const q = searchTerm.trim().toLowerCase();
                  if (!q) return true;
                  return `${ref.name} ${ref.code} ${ref.type} ${ref.phone} ${ref.address} ${ref.bankName || ''} ${ref.accountNumber || ''} ${ref.walletId || ''}`
                    .toLowerCase()
                    .includes(q);
                })
                .map((ref) => {
                  const pending = Math.max(0, ref.totalCommissionEarned - ref.totalCommissionPaid);
                  return (
                    <tr key={ref.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{ref.name}</div>
                        <div className="text-xs font-mono text-slate-500">
                          {ref.code} · {ref.type} · {ref.phone}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {ref.accountNumber ? (
                          <div>
                            <div className="font-semibold text-slate-800">
                              {ref.bankName} ({ref.bankBranch || 'Main'})
                            </div>
                            <div className="font-mono text-slate-600">
                              A/C: {ref.accountNumber} · {ref.accountHolderName || ref.name}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Bank A/C not set</span>
                        )}
                        {(ref.walletId || ref.panNumber) && (
                          <div className="font-mono text-[11px] text-blue-700 mt-0.5">
                            {ref.walletId ? `Wallet: ${ref.walletId}` : ''}
                            {ref.panNumber ? ` · PAN: ${ref.panNumber}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-mono font-semibold text-blue-700">
                          {ref.defaultMode === 'PERCENT'
                            ? `${ref.defaultValue}%`
                            : `${formatNpr(ref.defaultValue)} Flat`}
                        </div>
                        {ref.testOverrides.length > 0 && (
                          <div className="font-mono text-[11px] text-slate-600">
                            {ref.testOverrides.map((ov, i) => (
                              <span key={i} className="mr-2">
                                {ov.serviceCode}:{ov.mode === 'PERCENT' ? `${ov.value}%` : formatNpr(ov.value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-800 tabular-nums">
                        {formatNpr(ref.totalReferredSales)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums">
                        <div className="text-slate-900">{formatNpr(ref.totalCommissionEarned)}</div>
                        <div className="text-emerald-700">Paid: {formatNpr(ref.totalCommissionPaid)}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-amber-700 tabular-nums">
                        {formatNpr(pending)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {canManage && (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setEditing(JSON.parse(JSON.stringify(ref)))}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                            >
                              <Edit3 className="w-3 h-3" />
                              Rules &amp; A/C
                            </button>
                            {pending > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setPayoutPartner(ref);
                                  setPayoutAmount(String(pending));
                                  setPayoutBankName(ref.bankName || '');
                                  setPayoutAccountNumber(ref.accountNumber || '');
                                  setPayoutHolderName(ref.accountHolderName || ref.name);
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
                              >
                                <DollarSign className="w-3 h-3" />
                                Request Payout
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payout Requests & Admin Approval Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden text-xs">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Referral Payout Requests &amp; Hospital Admin Approval Ledger ({payoutRequests.length})
            </h2>
            <p className="text-[11px] text-slate-500">
              Payouts are queued with destination account &amp; payment reference and require Hospital Admin approval before debiting Treasury.
            </p>
          </div>
          {canApprovePayout && (
            <select
              value={payoutAccId}
              onChange={(e) => setPayoutAccId(e.target.value)}
              className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
            >
              {db.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  Approve From: {a.name} ({formatNpr(a.currentBalance)})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="py-2.5 px-4">Request # &amp; BS Date</th>
                <th className="py-2.5 px-4">Partner</th>
                <th className="py-2.5 px-4">Account Destination &amp; Payment Ref</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4 text-right">Admin Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payoutRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-500">
                    No payout requests submitted yet.
                  </td>
                </tr>
              ) : (
                payoutRequests.map((req) => (
                  <tr key={req.id}>
                    <td className="py-2.5 px-4 font-mono">
                      <div className="font-bold text-slate-900">{req.requestNumber}</div>
                      <div className="text-[11px] text-slate-500">{adToBs(req.requestedAt).formattedEn} BS</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{req.partnerName}</div>
                      <div className="text-[11px] text-slate-500">Req by {req.requestedBy}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-slate-900">{req.destinationSummary}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {req.paymentRefOrReceipt ? `Ref: ${req.paymentRefOrReceipt}` : req.notes}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900 tabular-nums">
                      {formatNpr(req.amountNpr)}
                    </td>
                    <td className="py-2.5 px-4 font-semibold">
                      <span
                        className={
                          req.status === 'Approved & Paid'
                            ? 'text-emerald-700'
                            : req.status === 'Rejected'
                            ? 'text-rose-700'
                            : 'text-amber-700'
                        }
                      >
                        {req.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {req.status === 'Pending Admin Approval' && canApprovePayout ? (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            disabled={processingReqId === req.id}
                            onClick={() => handleApproveReq(req.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-white bg-emerald-600 rounded hover:bg-emerald-700"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Approve &amp; Pay
                          </button>
                          <button
                            type="button"
                            disabled={processingReqId === req.id}
                            onClick={() => handleRejectReq(req.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-rose-700 bg-white border border-rose-300 rounded hover:bg-rose-50"
                          >
                            <XCircle className="w-3 h-3" />
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-slate-500">{req.reviewedBy || 'Awaiting Admin'}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* SUB-TAB 2: REFERRED HOSPITALS & AMBULANCES MASTER CRUD */}
      {subTab === 'hospitals_ambulances' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 text-xs">
          {/* Referred Hospitals Directory */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-blue-600" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Referred Hospitals Directory (Manager Phone &amp; WhatsApp Alert)
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Saved hospitals auto-populate ER, OPD &amp; IPD external referral forms and trigger Live Dashboard call/WhatsApp alerts.
                  </p>
                </div>
              </div>
            </div>

            {canManage && (
              <form onSubmit={handleSaveHospital} className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="font-semibold text-slate-800">
                  {editingHospitalId ? 'Edit Referred Hospital' : 'Add Referred Hospital'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <input
                    required
                    value={hospName}
                    onChange={(e) => setHospName(e.target.value)}
                    placeholder="Hospital Name (e.g. Nobel Medical College) *"
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    value={hospAddress}
                    onChange={(e) => setHospAddress(e.target.value)}
                    placeholder="City / Address (e.g. Biratnagar-04)"
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    required
                    value={hospManagerName}
                    onChange={(e) => setHospManagerName(sanitizePersonName(e.target.value))}
                    placeholder="Hospital Manager Name *"
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    required
                    value={hospManagerPhone}
                    onChange={(e) => setHospManagerPhone(e.target.value)}
                    placeholder="Manager Phone / WhatsApp *"
                    className="px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    value={hospPhone}
                    onChange={(e) => setHospPhone(e.target.value)}
                    placeholder="Hospital Reception Phone"
                    className="px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    value={hospSpecialties}
                    onChange={(e) => setHospSpecialties(e.target.value)}
                    placeholder="Specialties (Neuro, Trauma, NICU...)"
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  {editingHospitalId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingHospitalId(null);
                        setHospName('');
                        setHospAddress('');
                        setHospPhone('');
                        setHospManagerName('');
                        setHospManagerPhone('');
                        setHospSpecialties('');
                      }}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingHosp}
                    className="px-3.5 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {savingHosp ? 'Saving...' : editingHospitalId ? 'Update Hospital' : 'Save Referred Hospital'}
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {hospitalsMaster.length === 0 ? (
                <div className="p-5 text-center text-slate-500">No referred hospitals saved yet.</div>
              ) : (
                hospitalsMaster.map((h) => (
                  <div key={h.id} className="p-3 flex items-start justify-between gap-3 bg-white hover:bg-slate-50">
                    <div>
                      <div className="font-semibold text-slate-900">{h.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {h.address} {h.specialties ? `· ${h.specialties}` : ''}
                      </div>
                      <div className="text-[11px] font-mono text-emerald-700 mt-0.5">
                        Manager: {h.managerName} · {h.managerPhone}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingHospitalId(h.id);
                            setHospName(h.name);
                            setHospAddress(h.address);
                            setHospPhone(h.phone || '');
                            setHospManagerName(h.managerName);
                            setHospManagerPhone(h.managerPhone);
                            setHospSpecialties(h.specialties || '');
                          }}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteHospital(h.id, h.name)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded border border-rose-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Ambulances Directory & Case Commission Overrides */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Ambulance className="w-4 h-4 text-rose-600" />
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Ambulance Fleet &amp; Case-Wise Commission Rules (RTA / Poison / LSCS)
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Configure vehicle number, driver details, and per-case FLAT रू or % cuts.
                  </p>
                </div>
              </div>
            </div>

            {canManage && (
              <form onSubmit={handleSaveAmbulance} className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                <div className="font-semibold text-slate-800">
                  {editingAmbulanceId ? 'Edit Ambulance & Case Overrides' : 'Add Ambulance'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <input
                    required
                    value={ambName}
                    onChange={(e) => setAmbName(e.target.value)}
                    placeholder="Ambulance Name / Org *"
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    required
                    value={ambVehicleNo}
                    onChange={(e) => setAmbVehicleNo(e.target.value.toUpperCase())}
                    placeholder="Vehicle No (e.g. BA 2 JHA 4512) *"
                    className="px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                  <select
                    value={ambType}
                    onChange={(e) => setAmbType(e.target.value as AmbulanceMaster['vehicleType'])}
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="ALS Ambulance">ALS Ambulance</option>
                    <option value="BLS Ambulance">BLS Ambulance</option>
                    <option value="Hospital Vehicle">Hospital Vehicle</option>
                  </select>
                  <input
                    value={ambDriverName}
                    onChange={(e) => setAmbDriverName(sanitizePersonName(e.target.value))}
                    placeholder="Driver Name"
                    className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  />
                  <input
                    value={ambDriverPhone}
                    onChange={(e) => setAmbDriverPhone(e.target.value)}
                    placeholder="Driver Mobile"
                    className="px-2.5 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                  />
                  <div className="flex gap-1.5">
                    <select
                      value={ambCommMode}
                      onChange={(e) => setAmbCommMode(e.target.value as 'FLAT' | 'PERCENT')}
                      className="px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="FLAT">FLAT रू</option>
                      <option value="PERCENT">%</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={ambCommValue}
                      onChange={(e) => setAmbCommValue(e.target.value)}
                      placeholder="Default Cut"
                      className="w-full px-2 py-1.5 font-mono bg-white border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700 text-[11px]">
                      Case-Type Commission Overrides (RTA Case, Poison Case, LSCS...)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setAmbCaseOverrides((prev) => [
                          ...prev,
                          {
                            id: `cov-${Date.now()}`,
                            caseType: 'RTA Case',
                            mode: 'PERCENT',
                            value: 10,
                            active: true,
                          },
                        ])
                      }
                      className="text-blue-700 font-semibold hover:underline text-[11px]"
                    >
                      + Add Case Rule
                    </button>
                  </div>
                  {ambCaseOverrides.map((ov, idx) => (
                    <div key={ov.id} className="grid grid-cols-12 gap-1.5 items-center">
                      <input
                        value={ov.caseType}
                        onChange={(e) =>
                          setAmbCaseOverrides((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, caseType: e.target.value } : x))
                          )
                        }
                        placeholder="e.g. RTA Case / Poison Case / LSCS"
                        className="col-span-5 px-2 py-1 bg-white border border-slate-300 rounded"
                      />
                      <select
                        value={ov.mode}
                        onChange={(e) =>
                          setAmbCaseOverrides((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, mode: e.target.value as 'FLAT' | 'PERCENT' } : x
                            )
                          )
                        }
                        className="col-span-3 px-2 py-1 bg-white border border-slate-300 rounded"
                      >
                        <option value="FLAT">FLAT रू</option>
                        <option value="PERCENT">% Cut</option>
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={ov.value}
                        onChange={(e) =>
                          setAmbCaseOverrides((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, value: Number(e.target.value) || 0 } : x))
                          )
                        }
                        className="col-span-3 px-2 py-1 font-mono bg-white border border-slate-300 rounded"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setAmbCaseOverrides((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="col-span-1 text-rose-600 p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2">
                  {editingAmbulanceId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAmbulanceId(null);
                        setAmbName('');
                        setAmbVehicleNo('');
                        setAmbDriverName('');
                        setAmbDriverPhone('');
                        setAmbCaseOverrides([]);
                      }}
                      className="px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={savingAmb}
                    className="px-3.5 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                  >
                    {savingAmb ? 'Saving...' : editingAmbulanceId ? 'Update Ambulance' : 'Save Ambulance'}
                  </button>
                </div>
              </form>
            )}

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
              {ambulancesMaster.length === 0 ? (
                <div className="p-5 text-center text-slate-500">No ambulances registered yet.</div>
              ) : (
                ambulancesMaster.map((a) => (
                  <div key={a.id} className="p-3 flex items-start justify-between gap-3 bg-white hover:bg-slate-50">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {a.name} · <span className="font-mono text-rose-700">{a.vehicleNumber}</span>
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {a.vehicleType} · Driver: {a.driverName || '—'} ({a.driverPhone || '—'})
                      </div>
                      <div className="text-[11px] font-mono text-blue-700 mt-0.5">
                        Default: {a.defaultCommissionMode === 'PERCENT' ? `${a.defaultCommissionValue}%` : formatNpr(a.defaultCommissionValue)}
                        {(a.caseOverrides || []).length > 0 &&
                          ` · Overrides: ${(a.caseOverrides || [])
                            .map((c) => `${c.caseType}=${c.mode === 'PERCENT' ? `${c.value}%` : formatNpr(c.value)}`)
                            .join(', ')}`}
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAmbulanceId(a.id);
                            setAmbName(a.name);
                            setAmbVehicleNo(a.vehicleNumber);
                            setAmbType(a.vehicleType);
                            setAmbDriverName(a.driverName);
                            setAmbDriverPhone(a.driverPhone);
                            setAmbCommMode(a.defaultCommissionMode);
                            setAmbCommValue(String(a.defaultCommissionValue));
                            setAmbCaseOverrides(a.caseOverrides || []);
                          }}
                          className="p-1.5 text-slate-600 hover:bg-slate-100 rounded border border-slate-200"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteAmbulance(a.id, a.vehicleNumber)}
                          className="p-1.5 text-rose-600 hover:bg-rose-50 rounded border border-rose-200"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: ADD DIRECT EXTERNAL REFERRAL + FIRST ER/ADMISSION/POS DYNAMIC COMMISSION CALCULATOR */}
      {subTab === 'direct_calc' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Add Direct External Referral &amp; Dynamic Billing Tier Commission Calculator
              </h2>
              <p className="text-[11px] text-slate-500">
                Select patient UHID &amp; case type (RTA, Poison, LSCS) to inspect First ER + Admission + POS Total Bill and auto-calculate flat/tier commission from Settings.
              </p>
            </div>
          </div>

          <form onSubmit={handleCreateDirectReferral} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Registered Patient (UHID)</label>
                <select
                  value={dirUhid}
                  onChange={(e) => {
                    const u = e.target.value;
                    setDirUhid(u);
                    const p = db.patients.find((x) => x.uhid === u);
                    if (p) {
                      setDirPatientName(p.fullName);
                      setDirPatientPhone(p.phone);
                      void calculateDynamicBillingTier(u, dirCaseType, dirAmbulanceId);
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-mono"
                >
                  <option value="">-- Select UHID or type name --</option>
                  {db.patients.map((p) => (
                    <option key={p.id} value={p.uhid}>
                      {p.uhid} — {p.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Patient Full Name *</label>
                <input
                  required
                  value={dirPatientName}
                  onChange={(e) => setDirPatientName(sanitizePersonName(e.target.value))}
                  placeholder="Patient Full Name"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Case Category (Commission Rule)</label>
                <select
                  value={dirCaseType}
                  onChange={(e) => {
                    const ct = e.target.value;
                    setDirCaseType(ct);
                    if (dirUhid) void calculateDynamicBillingTier(dirUhid, ct, dirAmbulanceId);
                  }}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
                >
                  <option value="RTA Case">RTA Case</option>
                  <option value="Poison Case">Poison Case</option>
                  <option value="LSCS">LSCS</option>
                  {(db.settings.moduleSettings?.referralCaseRules || [])
                    .filter((r) => !['RTA Case', 'Poison Case', 'LSCS'].includes(r.caseType))
                    .map((r) => (
                      <option key={r.id} value={r.caseType}>
                        {r.caseType}
                      </option>
                    ))}
                  <option value="General Emergency">General Emergency</option>
                </select>
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={!dirUhid || calcLoading}
                  onClick={() => calculateDynamicBillingTier()}
                  className="w-full px-3 py-1.5 font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                >
                  {calcLoading ? 'Calculating...' : 'Calculate Dynamic Commission'}
                </button>
              </div>
            </div>

            {tierCalc && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200 font-mono">
                <div>
                  <div className="text-[10px] text-slate-500">First ER + Admission Bill</div>
                  <div className="text-sm font-bold text-slate-900">
                    {formatNpr(tierCalc.erTotal + tierCalc.admTotal)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">POS Orders Total</div>
                  <div className="text-sm font-bold text-slate-900">{formatNpr(tierCalc.posTotal)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Combined Total Bill</div>
                  <div className="text-sm font-bold text-blue-700">{formatNpr(tierCalc.combinedFirstBillNpr)}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Case + Billing Tier Cut</div>
                  <div className="text-xs font-semibold text-slate-800">
                    Case: {formatNpr(tierCalc.caseCommissionNpr)} · Tier: {formatNpr(tierCalc.tierCommissionNpr)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-emerald-700 font-bold">Total Dynamic Commission</div>
                  <div className="text-base font-bold text-emerald-800">
                    {formatNpr(tierCalc.totalDynamicCommissionNpr)}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Saved Referred Hospital *</label>
                <select
                  value={dirHospitalId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setDirHospitalId(id);
                    const h = hospitalsMaster.find((x) => x.id === id);
                    if (h) {
                      setDirHospitalName(h.name);
                      setDirHospitalPlace(h.address);
                      setDirManagerName(h.managerName);
                      setDirManagerPhone(h.managerPhone);
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- Select Saved Hospital (or enter custom) --</option>
                  {hospitalsMaster.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({h.address})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Referred Hospital Name *</label>
                <input
                  required
                  value={dirHospitalName}
                  onChange={(e) => setDirHospitalName(e.target.value)}
                  placeholder="Hospital Name"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Hospital City / Address</label>
                <input
                  value={dirHospitalPlace}
                  onChange={(e) => setDirHospitalPlace(e.target.value)}
                  placeholder="City / Address"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Hospital Manager Name</label>
                <input
                  value={dirManagerName}
                  onChange={(e) => setDirManagerName(sanitizePersonName(e.target.value))}
                  placeholder="Receiving Manager Name"
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Manager WhatsApp / Phone</label>
                <input
                  value={dirManagerPhone}
                  onChange={(e) => setDirManagerPhone(e.target.value)}
                  placeholder="98XXXXXXXX"
                  className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Select Saved Ambulance</label>
                <select
                  value={dirAmbulanceId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setDirAmbulanceId(id);
                    const a = ambulancesMaster.find((x) => x.id === id);
                    if (a) {
                      setDirAmbulanceName(a.name);
                      setDirAmbulanceNo(a.vehicleNumber);
                      setDirDriverName(a.driverName);
                      setDirDriverPhone(a.driverPhone);
                      setDirTransportMode(a.vehicleType);
                    }
                    if (dirUhid) void calculateDynamicBillingTier(dirUhid, dirCaseType, id);
                  }}
                  className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                >
                  <option value="">-- Select Saved Ambulance --</option>
                  {ambulancesMaster.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.vehicleNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Ambulance Vehicle #</label>
                <input
                  value={dirAmbulanceNo}
                  onChange={(e) => setDirAmbulanceNo(e.target.value.toUpperCase())}
                  placeholder="BA 2 JHA 4512"
                  className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Clinical Reason for Referral</label>
                <input
                  value={dirReason}
                  onChange={(e) => setDirReason(e.target.value)}
                  placeholder="Requires Neurosurgery / Ventilator / Tertiary ICU..."
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Condition at Departure</label>
                <input
                  value={dirCondition}
                  onChange={(e) => setDirCondition(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {canManage && (
              <div className="flex justify-end pt-2 border-t border-slate-200">
                <button
                  type="submit"
                  disabled={savingDirect}
                  className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingDirect ? 'Logging Referral...' : 'Save External Referral & Trigger Manager Alert'}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* Add/Edit Referral Partner + Account Details Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl shadow-xl overflow-hidden my-6">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                {editing.id ? `Edit Rules & Account Details — ${editing.name}` : 'New Referral Partner'}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSavePartner} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Code *</label>
                  <input
                    required
                    value={editing.code}
                    onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })}
                    placeholder="REF-DR-401"
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Partner / Doctor Name *</label>
                  <input
                    required
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={editing.type}
                    onChange={(e) =>
                      setEditing({ ...editing, type: e.target.value as ReferralPartner['type'] })
                    }
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Physician">Physician</option>
                    <option value="Polyclinic">Polyclinic</option>
                    <option value="Hospital">Hospital</option>
                    <option value="Field Agent">Field Agent</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Default Rule Mode</label>
                  <select
                    value={editing.defaultMode}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        defaultMode: e.target.value as 'PERCENT' | 'FLAT',
                      })
                    }
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="PERCENT">Percentage (%)</option>
                    <option value="FLAT">Flat Amount (रू)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Default Value ({editing.defaultMode === 'PERCENT' ? '%' : 'रू'})
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={editing.defaultValue}
                    onChange={(e) =>
                      setEditing({ ...editing, defaultValue: Number(e.target.value) })
                    }
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Referral Settlement Bank / Wallet / PAN Account Details */}
              <div className="border-t border-slate-200 pt-3 space-y-2">
                <div className="font-semibold text-slate-800">
                  Referral Payment Account Details (Bank / Wallet / PAN)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Bank Name</label>
                    <input
                      value={editing.bankName || ''}
                      onChange={(e) => setEditing({ ...editing, bankName: e.target.value })}
                      placeholder="e.g. Global IME Bank"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Bank Branch</label>
                    <input
                      value={editing.bankBranch || ''}
                      onChange={(e) => setEditing({ ...editing, bankBranch: e.target.value })}
                      placeholder="Bode Barsain"
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Account Holder Name</label>
                    <input
                      value={editing.accountHolderName || ''}
                      onChange={(e) => setEditing({ ...editing, accountHolderName: e.target.value })}
                      className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Bank Account Number</label>
                    <input
                      value={editing.accountNumber || ''}
                      onChange={(e) => setEditing({ ...editing, accountNumber: e.target.value })}
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Wallet ID (eSewa / Khalti)</label>
                    <input
                      value={editing.walletId || ''}
                      onChange={(e) => setEditing({ ...editing, walletId: e.target.value })}
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">PAN Number</label>
                    <input
                      value={editing.panNumber || ''}
                      onChange={(e) => setEditing({ ...editing, panNumber: e.target.value })}
                      className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-slate-800">
                    Test-Specific Commission Overrides ({editing.testOverrides.length})
                  </span>
                  <button
                    type="button"
                    onClick={addOverrideRow}
                    className="text-blue-700 font-medium hover:underline"
                  >
                    + Add Test Override
                  </button>
                </div>
                <div className="space-y-2">
                  {editing.testOverrides.map((ov, idx) => (
                    <div key={idx} className="grid grid-cols-4 gap-2 items-center bg-slate-50 p-2 rounded border border-slate-200">
                      <select
                        value={ov.serviceId}
                        onChange={(e) => {
                          const srv = db.services.find((s) => s.id === e.target.value);
                          const next = [...editing.testOverrides];
                          next[idx] = {
                            ...ov,
                            serviceId: e.target.value,
                            serviceCode: srv?.code || '',
                          };
                          setEditing({ ...editing, testOverrides: next });
                        }}
                        className="px-2 py-1 bg-white border border-slate-300 rounded font-mono"
                      >
                        {db.services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} ({formatNpr(s.price)})
                          </option>
                        ))}
                      </select>
                      <select
                        value={ov.mode}
                        onChange={(e) => {
                          const next = [...editing.testOverrides];
                          next[idx] = { ...ov, mode: e.target.value as 'PERCENT' | 'FLAT' };
                          setEditing({ ...editing, testOverrides: next });
                        }}
                        className="px-2 py-1 bg-white border border-slate-300 rounded"
                      >
                        <option value="PERCENT">% Percent</option>
                        <option value="FLAT">रू Flat</option>
                      </select>
                      <input
                        type="number"
                        min={0}
                        value={ov.value}
                        onChange={(e) => {
                          const next = [...editing.testOverrides];
                          next[idx] = { ...ov, value: Number(e.target.value) };
                          setEditing({ ...editing, testOverrides: next });
                        }}
                        className="px-2 py-1 font-mono bg-white border border-slate-300 rounded"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setEditing({
                            ...editing,
                            testOverrides: editing.testOverrides.filter((_, i) => i !== idx),
                          })
                        }
                        className="text-rose-600 hover:underline"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg"
                >
                  Save Referral Partner
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request Commission Payout (For Admin Approval) Modal */}
      {payoutPartner && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                Request Referral Payout (Admin Approval) — {payoutPartner.name}
              </h3>
              <button
                type="button"
                onClick={() => setPayoutPartner(null)}
                className="p-1 text-slate-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRequestPayout} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payout Amount (रू) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Proposed Treasury A/C</label>
                  <select
                    value={payoutAccId}
                    onChange={(e) => setPayoutAccId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {db.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} ({formatNpr(a.currentBalance)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Partner Bank / Wallet</label>
                  <input
                    value={payoutBankName}
                    onChange={(e) => setPayoutBankName(e.target.value)}
                    placeholder="e.g. Global IME / eSewa"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Account / Wallet Number</label>
                  <input
                    value={payoutAccountNumber}
                    onChange={(e) => setPayoutAccountNumber(e.target.value)}
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Account Holder</label>
                  <input
                    value={payoutHolderName}
                    onChange={(e) => setPayoutHolderName(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Payment Done Ref / Voucher #</label>
                  <input
                    value={payoutRefOrReceipt}
                    onChange={(e) => setPayoutRefOrReceipt(e.target.value)}
                    placeholder="ConnectIPS / Txn Ref / Voucher"
                    className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Notes for Hospital Admin</label>
                <input
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder="Optional verification comment..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPayoutPartner(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Submit for Admin Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

