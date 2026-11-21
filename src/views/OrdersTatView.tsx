import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  Cpu,
  Download,
  FileText,
  FlaskConical,
  Mail,
  Printer,
  Receipt,
  Search,
  Send,
  Smartphone,
  Table2,
  Tag,
  TestTube2,
  X,
} from 'lucide-react';
import type { LabOrder, LimsDatabase, OrderWorkflowStatus, PermissionKey, StaffMember } from '../types/lims';
import { computeOrderTat } from '../utils/clinical';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { downloadOrderReportPdf } from '../utils/pdfGenerator';
import { TatStatusLabel } from '../components/StatusText';
import { ThermalStickerPrintModal } from '../components/HospitalPrintModals';
import { AnalyzerBridgeModal } from '../components/AnalyzerBridgeModal';
import { apiRequest } from '../api/client';

interface OrdersTatViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onOpenNewOrder?: () => void;
  onOpenResults: (order: LabOrder) => void;
  onOpenReport: (order: LabOrder, autoPrint?: boolean) => void;
  onOpenBill: (order: LabOrder) => void;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function OrdersTatView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onOpenResults,
  onOpenReport,
  onOpenBill,
  onUpdated,
  initialSearchQuery,
}: OrdersTatViewProps) {
  const [search, setSearch] = useState(initialSearchQuery || '');
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderWorkflowStatus>('ALL');
  const [tatFilter, setTatFilter] = useState<'ALL' | 'BREACHED' | 'AT_RISK'>('ALL');
  const [nowMs, setNowMs] = useState(Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailPromptOrder, setEmailPromptOrder] = useState<LabOrder | null>(null);
  const [dispatchEmailAddr, setDispatchEmailAddr] = useState('');
  const [stickerOrder, setStickerOrder] = useState<LabOrder | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerPickerSearch, setStickerPickerSearch] = useState('');
  const [analyzerBridgeOpen, setAnalyzerBridgeOpen] = useState(false);
  const [mobileBenchMode, setMobileBenchMode] = useState<boolean>(
    () =>
      activeUser.roleId === 'LAB_TECH' ||
      (typeof window !== 'undefined' && window.innerWidth < 768)
  );

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearch(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return db.orders.filter((o) => {
      if (o.fiscalYear && o.fiscalYear !== activeFiscalYear) return false;
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      const tat = computeOrderTat(o, nowMs);
      if (tatFilter === 'BREACHED' && tat.status !== 'Breached' && tat.status !== 'Completed Late')
        return false;
      if (tatFilter === 'AT_RISK' && tat.status !== 'At Risk') return false;
      if (!q) return true;
      return (
        o.accessionNumber.toLowerCase().includes(q) ||
        o.invoiceNumber.toLowerCase().includes(q) ||
        o.patientName.toLowerCase().includes(q) ||
        (o.uhid || '').toLowerCase().includes(q) ||
        (o.encounterLabel || '').toLowerCase().includes(q) ||
        o.patientPhone.toLowerCase().includes(q) ||
        o.tests.some((t) => t.serviceCode.toLowerCase().includes(q))
      );
    });
  }, [db.orders, activeFiscalYear, search, statusFilter, tatFilter, nowMs]);

  const handleAdvance = async (order: LabOrder) => {
    setBusyId(order.id);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ db: any; order: LabOrder }>(
        `/api/orders/${order.id}/advance`,
        activeUser.id,
        { method: 'POST' }
      );
      onUpdated(resp.db, `${order.accessionNumber} moved to '${resp.order.status}'.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to advance specimen stage.');
    } finally {
      setBusyId(null);
    }
  };

  const handleQuickApiSend = async (order: LabOrder) => {
    setBusyId(order.id);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ db: any; dispatch: any }>(
        `/api/reports/${order.id}/send-api`,
        activeUser.id,
        { method: 'POST', body: JSON.stringify({}) }
      );
      onUpdated(
        resp.db,
        `API report transmitted for ${order.accessionNumber} (HTTP ${resp.dispatch.httpStatus}).`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'API dispatch failed.');
    } finally {
      setBusyId(null);
    }
  };

  const openEmailDispatchModal = (order: LabOrder) => {
    setEmailPromptOrder(order);
    setDispatchEmailAddr(order.patientEmail || '');
  };

  const handleConfirmEmailDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailPromptOrder || !dispatchEmailAddr.trim()) return;
    setBusyId(emailPromptOrder.id);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ db: any; email: any }>(
        `/api/reports/${emailPromptOrder.id}/send-email`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ recipientEmail: dispatchEmailAddr.trim() }),
        }
      );
      setEmailPromptOrder(null);
      setDispatchEmailAddr('');
      onUpdated(resp.db, `Email report sent to ${resp.email.recipientEmail}.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Email dispatch failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDispatchOrder = async (order: LabOrder) => {
    setBusyId(order.id);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ db: any; order: LabOrder }>(
        `/api/orders/${order.id}/dispatch`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ dispatchMode: 'Hand Counter Delivery' }),
        }
      );
      onUpdated(resp.db, `Report ${order.accessionNumber} marked Dispatched to patient.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Dispatch failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleAutoFetchOrder = async (order: LabOrder) => {
    setBusyId(order.id);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{
        db: any;
        order: LabOrder;
        matchedAnalyzer: string;
        appliedCount: number;
        updatedTests: string[];
      }>(`/api/orders/${order.id}/auto-fetch-analyzer`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onUpdated(
        resp.db,
        `Auto-fetched ${resp.appliedCount} analyte(s) for ${order.accessionNumber} from ${resp.matchedAnalyzer}.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Auto-fetch from analyzer failed.');
    } finally {
      setBusyId(null);
    }
  };

  const canCollectOrAdvance = hasPerm('orders.advance') || hasPerm('orders.collect');

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {activeUser.roleId === 'LAB_TECH'
              ? `Lab Tech Quick Sample & Result Bench (${activeFiscalYear})`
              : `Orders, Specimen Flow & TAT SLA (${activeFiscalYear})`}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {activeUser.roleId === 'LAB_TECH'
              ? '1-tap Collect Sample → Enter Results → Validate & Approve → Direct A4 Report Print.'
              : 'Track BS/AD timestamps, specimen stages, live TAT countdowns, and one-click A4 report printing (orders are billed via POS or Patient Intake).'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(hasPerm('results.enter') || hasPerm('orders.view')) && (
            <button
              type="button"
              onClick={() => setAnalyzerBridgeOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 whitespace-nowrap shrink-0"
            >
              <Cpu className="w-3.5 h-3.5" />
              Analyzer Auto-Fetch
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setStickerPickerSearch('');
              setStickerPickerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Tag className="w-3.5 h-3.5" />
            Print Lab Sticker
          </button>
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            <button
              type="button"
              onClick={() => setMobileBenchMode(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                mobileBenchMode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              Easy Mobile Lab Bench
            </button>
            <button
              type="button"
              onClick={() => setMobileBenchMode(false)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                !mobileBenchMode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Table2 className="w-3.5 h-3.5" />
              Desktop Table
            </button>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-2">
          <span>{errorMsg}</span>
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

      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accession, invoice, patient, phone, test..."
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded-lg"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg flex-wrap">
            {(['ALL', 'Ordered', 'Collected', 'In Lab', 'Resulted', 'Validated', 'Dispatched'] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {st === 'ALL' ? 'All Stages' : st}
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['ALL', 'AT_RISK', 'BREACHED'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTatFilter(tf)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  tatFilter === tf
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tf === 'ALL' ? 'All TAT' : tf === 'AT_RISK' ? 'At Risk' : 'Breached'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mobileBenchMode ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {filteredOrders.map((order) => {
            const tat = computeOrderTat(order, nowMs);
            const bs = adToBs(order.orderedAt);
            const isCollecting = order.status === 'Ordered';
            const isReceiving = order.status === 'Collected';
            return (
              <div
                key={order.id}
                className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-slate-900">
                        {order.accessionNumber}
                      </span>
                      {order.priority === 'STAT' && (
                        <span className="text-[11px] font-mono font-bold text-rose-700">STAT</span>
                      )}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">
                      {order.patientName}
                    </div>
                    <div className="text-xs text-slate-500">
                      {order.uhid || 'Walk-In'} · {order.patientAge} {order.patientAgeType} / {order.patientGender} · {bs.formattedEn} {bs.timeEn}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <div className="text-xs font-semibold text-slate-900">{order.status}</div>
                    <TatStatusLabel status={tat.status} label={tat.label} />
                  </div>
                </div>

                <div className="space-y-1">
                  {order.tests.map((t) => (
                    <div key={t.serviceId} className="text-xs flex items-center justify-between gap-2 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200/80">
                      <div>
                        <span className="font-mono font-semibold text-blue-700">{t.serviceCode}</span>{' '}
                        <span className="text-slate-800">{t.serviceName}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">{t.tatMinutes}m</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {(isCollecting || isReceiving) && canCollectOrAdvance && (
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => handleAdvance(order)}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <TestTube2 className="w-4 h-4" />
                      {busyId === order.id
                        ? 'Updating...'
                        : isCollecting
                        ? '1. Tap: Collect Sample'
                        : '2. Tap: Receive in Lab'}
                    </button>
                  )}

                  {order.status !== 'Validated' &&
                    order.status !== 'Dispatched' &&
                    hasPerm('results.enter') &&
                    order.tests.some((t) => t.serviceCategory !== 'RADIOLOGY' && t.department !== 'Radiology') && (
                      <button
                        type="button"
                        disabled={busyId === order.id}
                        onClick={() => handleAutoFetchOrder(order)}
                        className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
                      >
                        <Cpu className="w-4 h-4" />
                        {busyId === order.id ? 'Fetching...' : 'Auto-Fetch Analyzer'}
                      </button>
                    )}

                  {(hasPerm('results.enter') || hasPerm('results.validate') || hasPerm('radiology.report')) && (
                    <button
                      type="button"
                      onClick={() => onOpenResults(order)}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                    >
                      {order.status === 'Resulted' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <FlaskConical className="w-4 h-4" />
                      )}
                      {order.status === 'Dispatched'
                        ? 'View / Amend'
                        : order.status === 'Validated'
                        ? hasPerm('results.validate')
                          ? 'View / Amend'
                          : 'View Validated Report'
                        : order.status === 'Resulted'
                        ? 'Validate & Approve'
                        : 'Enter / Validate Results'}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setStickerOrder(order)}
                    className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                  >
                    <Tag className="w-4 h-4 text-slate-700" />
                    Thermal Sticker
                  </button>

                  {hasPerm('reports.print') && (
                    <button
                      type="button"
                      onClick={() => onOpenReport(order, true)}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200"
                    >
                      <Printer className="w-4 h-4 text-blue-600" />
                      {order.printCount ? `Re-Print (${order.printCount}×)` : 'Direct Print'}
                    </button>
                  )}

                  {order.status === 'Validated' && hasPerm('reports.print') && (
                    <button
                      type="button"
                      disabled={busyId === order.id}
                      onClick={() => handleDispatchOrder(order)}
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      {busyId === order.id ? 'Dispatching...' : 'Mark Dispatched'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {filteredOrders.length === 0 && (
            <div className="col-span-full bg-white border border-slate-200 rounded-xl py-10 text-center text-sm text-slate-500">
              No laboratory orders found for {activeFiscalYear}.
            </div>
          )}
        </div>
      ) : (
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
                <th className="py-3 px-4">Accession / BS Date</th>
                <th className="py-3 px-4">Patient</th>
                <th className="py-3 px-4">Encounter &amp; UHID</th>
                <th className="py-3 px-4">Ordered Panels</th>
                <th className="py-3 px-4">Stage</th>
                <th className="py-3 px-4">TAT SLA</th>
                <th className="py-3 px-4 text-right">Actions &amp; 1-Click Print</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredOrders.map((order) => {
                const tat = computeOrderTat(order, nowMs);
                const bs = adToBs(order.orderedAt);
                const allFlags = order.tests.flatMap((t) => t.parameterResults.map((p) => p.flag));
                const hasCritical = allFlags.some(
                  (f) => f === 'CRITICAL_HIGH' || f === 'CRITICAL_LOW' || f === 'CRITICAL' || f === 'HIGH_RISK'
                );
                const hasAbnormal = allFlags.some((f) => f === 'ABNORMAL' || f === 'HIGH' || f === 'LOW');
                return (
                  <tr key={order.id} className="hover:bg-slate-50/70">
                    <td className="py-3 px-4 align-top">
                      <div className="font-mono text-xs font-semibold text-slate-900">
                        {order.accessionNumber}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        {bs.formattedEn} · {bs.timeEn}
                      </div>
                      <div className="text-xs font-mono mt-0.5 text-slate-600">
                        {order.priority === 'STAT' ? (
                          <span className="text-rose-700 font-semibold">STAT</span>
                        ) : (
                          'Routine'
                        )}
                        {' · '}
                        {formatNpr(order.totalAmount)}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top">
                      <div className="font-medium text-slate-900">{order.patientName}</div>
                      <div className="text-xs text-slate-500">
                        {order.patientAge} {order.patientAgeType} / {order.patientGender} · {order.patientPhone}
                      </div>
                      <div className="text-[11px] text-slate-400">{order.patientAddress}</div>
                      {hasCritical && (
                        <div className="text-[11px] font-semibold text-rose-700 mt-0.5">
                          ▲ HIGH RISK / CRITICAL PANIC
                        </div>
                      )}
                      {!hasCritical && hasAbnormal && (
                        <div className="text-[11px] font-semibold text-amber-700 mt-0.5">
                          ● ABNORMAL VALUE
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top text-xs text-slate-700">
                      <div className="font-mono font-medium">
                        {order.uhid || 'Walk-In'}
                      </div>
                      <div className="text-slate-600">
                        {order.encounterLabel || order.encounterType || 'Hospital Counter'}
                      </div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {order.paymentMode}{order.nonInventoryBillOnly ? ' · Bill-Only' : ''}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top">
                      <div className="space-y-1">
                        {order.tests.map((t) => (
                          <div key={t.serviceId} className="text-xs">
                            <span className="font-mono font-semibold text-blue-700">
                              {t.serviceCode}
                            </span>{' '}
                            {(t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology') && (
                              <span className="font-mono text-[10px] font-semibold text-indigo-700">
                                [{t.modality || 'RAD'}]
                              </span>
                            )}{' '}
                            <span className="text-slate-600">({t.tatMinutes}m)</span>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top text-xs font-semibold text-slate-900">
                      <div className={order.status === 'Dispatched' ? 'text-indigo-700' : ''}>{order.status}</div>
                      {(order.printCount || 0) > 0 && (
                        <div className="text-[10px] font-mono text-slate-500 font-normal">
                          Printed {order.printCount}×
                        </div>
                      )}
                      {order.dispatchedAt && (
                        <div className="text-[10px] font-mono text-indigo-700 font-normal">
                          Dispatched · {order.dispatchedBy}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 align-top">
                      <TatStatusLabel status={tat.status} label={tat.label} />
                    </td>
                    <td className="py-3 px-4 align-top text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {(order.status === 'Ordered' || order.status === 'Collected') &&
                          canCollectOrAdvance && (
                            <button
                              type="button"
                              disabled={busyId === order.id}
                              onClick={() => handleAdvance(order)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                            >
                              {order.status === 'Ordered' ? 'Collect Sample' : 'In Lab'}
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}

                        {order.status !== 'Validated' &&
                          order.status !== 'Dispatched' &&
                          hasPerm('results.enter') &&
                          order.tests.some((t) => t.serviceCategory !== 'RADIOLOGY' && t.department !== 'Radiology') && (
                            <button
                              type="button"
                              disabled={busyId === order.id}
                              onClick={() => handleAutoFetchOrder(order)}
                              title="Auto-fetch results from connected lab analyzer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-md hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
                            >
                              <Cpu className="w-3 h-3" />
                              {busyId === order.id ? 'Fetching...' : 'Auto-Fetch'}
                            </button>
                          )}

                        {(hasPerm('results.enter') || hasPerm('results.validate') || hasPerm('radiology.report')) && (
                          <button
                            type="button"
                            onClick={() => onOpenResults(order)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                          >
                            <FlaskConical className="w-3 h-3" />
                            {order.status === 'Validated' || order.status === 'Dispatched'
                              ? hasPerm('results.validate')
                                ? 'View / Amend'
                                : 'View'
                              : order.status === 'Resulted'
                              ? 'Validate'
                              : order.tests.some((t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology')
                              ? 'Report / Bench'
                              : 'Results'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setStickerOrder(order)}
                          title="Print standalone thermal sample sticker (separate from A4 reports)"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 whitespace-nowrap"
                        >
                          <Tag className="w-3 h-3" />
                          Sticker
                        </button>

                        {hasPerm('pos.billing') && (
                          <button
                            type="button"
                            onClick={() => onOpenBill(order)}
                            title="Print POS Bill"
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                          >
                            <Receipt className="w-3 h-3" />
                            Bill
                          </button>
                        )}

                        {hasPerm('reports.print') && (
                          <>
                            <button
                              type="button"
                              onClick={() => onOpenReport(order, false)}
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                            >
                              <FileText className="w-3 h-3" />
                              Preview
                            </button>
                            <button
                              type="button"
                              onClick={() => onOpenReport(order, true)}
                              title="One-Click Print A4 Report"
                              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 whitespace-nowrap"
                            >
                              <Printer className="w-3 h-3" />
                              1-Click Print
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const center = order.collectionCenterId
                                  ? db.centers.find((c) => c.id === order.collectionCenterId)
                                  : undefined;
                                const dsn =
                                  db.documentDesigns?.find((d) => d.id === center?.designTemplateId) ||
                                  db.documentDesigns?.find((d) => d.centerId === order.collectionCenterId) ||
                                  db.documentDesigns?.[0];
                                void downloadOrderReportPdf(order, db.settings, dsn, 'with');
                              }}
                              title="Download Binary A4 PDF"
                              className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 whitespace-nowrap"
                            >
                              <Download className="w-3 h-3" />
                              PDF
                            </button>
                            {order.status === 'Validated' && (
                              <button
                                type="button"
                                disabled={busyId === order.id}
                                onClick={() => handleDispatchOrder(order)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 whitespace-nowrap"
                              >
                                <CheckCircle2 className="w-3 h-3" />
                                Dispatch
                              </button>
                            )}
                          </>
                        )}

                        {(order.status === 'Validated' || order.status === 'Dispatched') && hasPerm('reports.email') && (
                          <button
                            type="button"
                            disabled={busyId === order.id}
                            onClick={() => openEmailDispatchModal(order)}
                            title="Input email & send report"
                            className="p-1.5 text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {(order.status === 'Validated' || order.status === 'Dispatched') && hasPerm('reports.api_send') && (
                          <button
                            type="button"
                            disabled={busyId === order.id}
                            onClick={() => handleQuickApiSend(order)}
                            title="Send report via API webhook"
                            className="p-1.5 text-slate-600 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    No laboratory orders found for {activeFiscalYear}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Email Report at Dispatch Modal */}
      {emailPromptOrder && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setEmailPromptOrder(null)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md overflow-hidden shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Dispatch Report via Email ({emailPromptOrder.accessionNumber})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEmailPromptOrder(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmEmailDispatch} className="p-5 space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                <div className="font-semibold text-slate-900">{emailPromptOrder.patientName}</div>
                <div className="text-slate-500 font-mono">
                  {emailPromptOrder.uhid || 'Walk-In'} · {emailPromptOrder.patientPhone}
                </div>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Recipient Email Address *
                </label>
                <input
                  type="email"
                  required
                  autoFocus
                  data-no-autocap="true"
                  value={dispatchEmailAddr}
                  onChange={(e) => setDispatchEmailAddr(e.target.value)}
                  placeholder="patient-or-clinic@email.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEmailPromptOrder(null)}
                  className="px-3.5 py-1.5 border border-slate-300 rounded-lg text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busyId === emailPromptOrder.id}
                  className="px-4 py-1.5 font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50"
                >
                  {busyId === emailPromptOrder.id ? 'Sending...' : 'Send Report Email'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quick Lab Sticker Picker Modal */}
      {stickerPickerOpen && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setStickerPickerOpen(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Print Lab Specimen Thermal Sticker
                </h3>
                <p className="text-[11px] text-slate-500">
                  Dedicated sample barcode label (never bundled into A4 lab reports)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStickerPickerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={stickerPickerSearch}
                  onChange={(e) => setStickerPickerSearch(e.target.value)}
                  placeholder="Search Accession #, UHID, Patient Name, or Test..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {filteredOrders
                  .filter((o) => {
                    const q = stickerPickerSearch.trim().toLowerCase();
                    if (!q) return true;
                    return `${o.accessionNumber} ${o.uhid || ''} ${o.patientName} ${o.tests.map((t) => t.serviceCode).join(' ')}`
                      .toLowerCase()
                      .includes(q);
                  })
                  .slice(0, 25)
                  .map((o) => (
                    <div
                      key={o.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">
                          <span className="font-mono text-blue-700">{o.accessionNumber}</span> · {o.patientName}
                        </div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          {o.uhid || 'Walk-In'} · {o.tests.map((t) => t.serviceCode).join(', ')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setStickerPickerOpen(false);
                          setStickerOrder(o);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <Tag className="w-3 h-3" />
                        Print Sticker
                      </button>
                    </div>
                  ))}
                {filteredOrders.length === 0 && (
                  <div className="p-6 text-center text-xs text-slate-500">
                    No lab orders available in the current filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Standalone Lab Thermal Sticker Printer */}
      {stickerOrder && (
        <ThermalStickerPrintModal
          uhid={stickerOrder.uhid || stickerOrder.accessionNumber}
          barcodeValue={stickerOrder.accessionNumber}
          patientName={stickerOrder.patientName}
          ageGender={`${stickerOrder.patientAge}${stickerOrder.patientAgeType.charAt(0)}/${stickerOrder.patientGender.charAt(0)}`}
          encounterLabel={`LAB · ${stickerOrder.accessionNumber}`}
          doctorOrUnit={stickerOrder.tests.map((t) => t.serviceCode).join(', ')}
          dateIso={stickerOrder.orderedAt}
          settings={db.settings}
          onClose={() => setStickerOrder(null)}
        />
      )}

      {/* Lab Analyzer Auto-Fetch Bridge Modal */}
      {analyzerBridgeOpen && (
        <AnalyzerBridgeModal
          db={db}
          activeUser={activeUser}
          onClose={() => setAnalyzerBridgeOpen(false)}
          onUpdated={onUpdated}
        />
      )}
    </div>
  );
}
