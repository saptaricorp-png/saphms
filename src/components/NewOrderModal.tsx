import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react';
import type {
  AgeType,
  CollectionCenter,
  LabServiceTest,
  PatientGender,
  ReferralPartner,
} from '../types/lims';
import { formatNpr } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { normalizeNepalPhone } from '../utils/textFormat';

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  activeFiscalYear: string;
  canOverrideCredit: boolean;
  services: LabServiceTest[];
  centers: CollectionCenter[];
  referrals: ReferralPartner[];
  onCreated: (db: any) => void;
}

export function NewOrderModal({
  isOpen,
  onClose,
  userId,
  activeFiscalYear,
  canOverrideCredit,
  services,
  centers,
  referrals,
  onCreated,
}: NewOrderModalProps) {
  const [patientName, setPatientName] = useState('');
  const [patientAge, setPatientAge] = useState('35');
  const [patientAgeType, setPatientAgeType] = useState<AgeType>('Years');
  const [patientGender, setPatientGender] = useState<PatientGender>('Female');
  const [patientAddress, setPatientAddress] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [referralPartnerId, setReferralPartnerId] = useState<string>('');
  const [referringDoctor, setReferringDoctor] = useState('');
  const [collectionCenterId, setCollectionCenterId] = useState<string>(centers[0]?.id || '');
  const [priority, setPriority] = useState<'Routine' | 'STAT'>('Routine');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creditOverride, setCreditOverride] = useState(false);
  const [creditOverrideReason, setCreditOverrideReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [creditBlocked, setCreditBlocked] = useState(false);

  const selectedCenter = useMemo(
    () => centers.find((c) => c.id === collectionCenterId) || null,
    [centers, collectionCenterId]
  );

  const selectedServices = useMemo(
    () => services.filter((s) => selectedIds.includes(s.id)),
    [services, selectedIds]
  );

  const orderTotal = useMemo(
    () => selectedServices.reduce((sum, s) => sum + s.price, 0),
    [selectedServices]
  );

  const projectedBalance = selectedCenter
    ? selectedCenter.outstandingBalance + orderTotal
    : 0;
  const exceedsCredit = Boolean(
    selectedCenter &&
      (projectedBalance > selectedCenter.creditLimit || selectedCenter.status === 'Credit Hold')
  );

  if (!isOpen) return null;

  const toggleService = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setCreditBlocked(false);
    setSubmitting(true);

    try {
      const resp = await apiRequest<{ db: any }>('/api/orders', userId, {
        method: 'POST',
        body: JSON.stringify({
          patientName,
          patientAge: Number(patientAge),
          patientAgeType,
          patientGender,
          patientAddress,
          patientPhone: normalizeNepalPhone(patientPhone),
          referralPartnerId: referralPartnerId || null,
          referringDoctor,
          collectionCenterId: collectionCenterId || null,
          priority,
          serviceIds: selectedIds,
          fiscalYear: activeFiscalYear,
          paymentMode: collectionCenterId ? 'Center Credit' : 'Cash',
          creditOverride,
          creditOverrideReason,
        }),
      });
      onCreated(resp.db);
      setPatientName('');
      setPatientAddress('');
      setPatientPhone('');
      setSelectedIds([]);
      setCreditOverride(false);
      setCreditOverrideReason('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to register order.');
      if (err.code === 'CREDIT_LIMIT_EXCEEDED') {
        setCreditBlocked(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-3xl shadow-xl overflow-hidden my-8">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Quick Patient Registration &amp; Order</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Fiscal Year {activeFiscalYear} · Hospital diagnostic registration &amp; SLA TAT targets.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-semibold">{errorMsg}</div>
                  {creditBlocked && canOverrideCredit && (
                    <p className="text-rose-700">
                      Super Admin can authorize a Credit Override below or settle center dues.
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setCreditBlocked(false);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-rose-800 bg-white border border-rose-300 rounded hover:bg-rose-100 shrink-0"
                aria-label="Close error message"
              >
                <X className="w-3.5 h-3.5" />
                Close
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Patient Full Name *
              </label>
              <input
                type="text"
                required
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="e.g., Sita Devi Adhikari"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Age *</label>
                <input
                  type="number"
                  min={0}
                  max={125}
                  required
                  value={patientAge}
                  onChange={(e) => setPatientAge(e.target.value)}
                  className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
                <select
                  value={patientAgeType}
                  onChange={(e) => setPatientAgeType(e.target.value as AgeType)}
                  className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Years">Years</option>
                  <option value="Months">Months</option>
                  <option value="Days">Days</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Sex *</label>
                <select
                  value={patientGender}
                  onChange={(e) => setPatientGender(e.target.value as PatientGender)}
                  className="w-full px-2 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Address *</label>
              <input
                type="text"
                required
                value={patientAddress}
                onChange={(e) => setPatientAddress(e.target.value)}
                placeholder="Enter Municipality / Ward"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone *</label>
              <div className="flex">
                <span className="inline-flex items-center px-2.5 bg-slate-100 border border-r-0 border-slate-300 rounded-l-lg text-xs font-mono text-slate-600">
                  +977
                </span>
                <input
                  type="text"
                  required
                  value={patientPhone}
                  onChange={(e) => setPatientPhone(e.target.value)}
                  placeholder="98XXXXXXXX"
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-r-lg"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-slate-200">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Originating Unit / Counter
              </label>
              <select
                value={collectionCenterId}
                onChange={(e) => {
                  setCollectionCenterId(e.target.value);
                  setCreditOverride(false);
                }}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Main Hospital Counter (Walk-In)</option>
                {centers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name} ({formatNpr(c.outstandingBalance)} / {formatNpr(c.creditLimit)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Referral Partner
              </label>
              <select
                value={referralPartnerId}
                onChange={(e) => setReferralPartnerId(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Direct / Walk-In</option>
                {referrals.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Priority</label>
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                {(['Routine', 'STAT'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md ${
                      priority === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    {p === 'STAT' ? 'STAT (50% TAT)' : 'Routine SLA'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {!referralPartnerId && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Referring Doctor Name (Optional)
              </label>
              <input
                value={referringDoctor}
                onChange={(e) => setReferringDoctor(e.target.value)}
                placeholder="Dr. ..."
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
          )}

          {selectedCenter && (
            <div
              className={`p-3.5 rounded-lg border text-xs flex flex-col gap-2 ${
                exceedsCredit
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  Center Exposure: <strong className="font-mono">{formatNpr(selectedCenter.outstandingBalance)}</strong> +{' '}
                  <strong className="font-mono">{formatNpr(orderTotal)}</strong> ={' '}
                  <strong className="font-mono">{formatNpr(projectedBalance)}</strong> / Limit{' '}
                  <strong className="font-mono">{formatNpr(selectedCenter.creditLimit)}</strong>
                </span>
                <span className="font-mono">{selectedCenter.status}</span>
              </div>
              {exceedsCredit && (
                <div className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    Order exceeds available credit or center is on Credit Hold.
                    {canOverrideCredit ? (
                      <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2">
                        <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={creditOverride}
                            onChange={(e) => setCreditOverride(e.target.checked)}
                            className="rounded border-amber-400 text-blue-600"
                          />
                          Apply Super Admin Credit Override
                        </label>
                        {creditOverride && (
                          <input
                            type="text"
                            required
                            value={creditOverrideReason}
                            onChange={(e) => setCreditOverrideReason(e.target.value)}
                            placeholder="Audit justification"
                            className="flex-1 px-2.5 py-1 text-xs bg-white border border-amber-300 rounded text-slate-900"
                          />
                        )}
                      </div>
                    ) : (
                      <span className="block mt-0.5 font-medium">
                        Your current role lacks Super Admin credit override permission.
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-700">
                Select Tests ({selectedServices.length} selected)
              </label>
              <span className="text-xs font-mono font-semibold text-slate-900">
                Total: {formatNpr(orderTotal)}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {services
                .filter((s) => s.active)
                .map((srv) => {
                  const active = selectedIds.includes(srv.id);
                  const effTat =
                    priority === 'STAT' ? Math.max(30, Math.round(srv.tatMinutes * 0.5)) : srv.tatMinutes;
                  return (
                    <button
                      key={srv.id}
                      type="button"
                      onClick={() => toggleService(srv.id)}
                      className={`text-left p-3 rounded-lg border transition-colors flex items-start justify-between gap-2 ${
                        active
                          ? 'border-blue-600 bg-blue-50/60 text-slate-900'
                          : 'border-slate-200 bg-white hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-semibold text-blue-700">
                            {srv.code}
                          </span>
                          <span className="text-xs text-slate-500">· {srv.department}</span>
                          {(srv.serviceCategory === 'RADIOLOGY' || srv.department === 'Radiology') && (
                            <span className="text-[10px] font-mono font-semibold text-indigo-700">
                              [{srv.modality || 'RADIOLOGY'}]
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-medium text-slate-900 truncate mt-0.5">
                          {srv.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono mt-1">
                          TAT {effTat}m ·{' '}
                          {srv.serviceCategory === 'RADIOLOGY' || srv.department === 'Radiology'
                            ? 'Imaging Template'
                            : `${srv.parameters.length} analytes`}{' '}
                          · {formatNpr(srv.price)}
                        </div>
                      </div>
                      <span
                        className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
                          active
                            ? 'bg-blue-600 border-blue-600 text-white'
                            : 'border-slate-300 bg-white'
                        }`}
                      >
                        {active && <Check className="w-3.5 h-3.5" />}
                      </span>
                    </button>
                  );
                })}
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || selectedIds.length === 0}
              className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              {submitting ? 'Registering...' : `Register Order (${formatNpr(orderTotal)})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
