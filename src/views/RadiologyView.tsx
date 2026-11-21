import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkCheck,
  CheckCircle2,
  Download,
  Film,
  Landmark,
  Plus,
  Printer,
  Scan,
  Search,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import type {
  LabOrder,
  LimsDatabase,
  PermissionKey,
  RadiologyModality,
  RadiologyTemplate,
  StaffMember,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { downloadFinancialBreakdownPdf, downloadOrderReportPdf } from '../utils/pdfGenerator';
import { ThermalStickerPrintModal } from '../components/HospitalPrintModals';
import { apiRequest } from '../api/client';

interface RadiologyViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  onOpenResults: (order: LabOrder) => void;
  onOpenReport: (order: LabOrder, autoPrint?: boolean) => void;
  initialSearchQuery?: string;
}

const MODALITIES: RadiologyModality[] = ['X-RAY', 'CT', 'USG', 'ECHO'];

export function RadiologyView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onUpdated,
  onOpenResults,
  onOpenReport,
  initialSearchQuery,
}: RadiologyViewProps) {
  const canManageTemplates = hasPerm('radiology.manage');
  const canReport = hasPerm('radiology.report') || hasPerm('results.enter');

  const [tab, setTab] = useState<'worklist' | 'templates' | 'inventory' | 'finance'>('worklist');
  const [modalityFilter, setModalityFilter] = useState<'ALL' | RadiologyModality>('ALL');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [editingTpl, setEditingTpl] = useState<RadiologyTemplate | null>(null);
  const [savingTpl, setSavingTpl] = useState(false);
  const [stickerOrder, setStickerOrder] = useState<LabOrder | null>(null);

  const radiologyOrders = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return db.orders.filter((o) => {
      if (o.fiscalYear && o.fiscalYear !== activeFiscalYear) return false;
      const radTests = o.tests.filter(
        (t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology'
      );
      if (radTests.length === 0) return false;
      if (modalityFilter !== 'ALL' && !radTests.some((t) => t.modality === modalityFilter)) {
        return false;
      }
      if (!q) return true;
      return `${o.accessionNumber} ${o.uhid || ''} ${o.encounterLabel || ''} ${o.patientName} ${o.patientPhone} ${radTests.map((t) => `${t.serviceCode} ${t.serviceName} ${t.modality}`).join(' ')}`
        .toLowerCase()
        .includes(q);
    });
  }, [db.orders, activeFiscalYear, modalityFilter, searchTerm]);

  const radiologyStock = useMemo(() => {
    return db.reagents.filter(
      (r) =>
        r.category === 'X-Ray Film' ||
        r.category === 'CT Contrast' ||
        r.category === 'USG / Echo Consumable'
    );
  }, [db.reagents]);

  const retakeMovements = useMemo(() => {
    return db.inventoryMovements.filter(
      (m) =>
        m.type === 'FILM_RETAKE' ||
        radiologyStock.some((s) => s.id === m.reagentId)
    );
  }, [db.inventoryMovements, radiologyStock]);

  const modalityFinance = useMemo(() => {
    const map: Record<string, { modality: string; studies: number; validated: number; revenue: number; films: number; retakes: number }> = {
      'X-RAY': { modality: 'X-RAY', studies: 0, validated: 0, revenue: 0, films: 0, retakes: 0 },
      CT: { modality: 'CT', studies: 0, validated: 0, revenue: 0, films: 0, retakes: 0 },
      USG: { modality: 'USG', studies: 0, validated: 0, revenue: 0, films: 0, retakes: 0 },
      ECHO: { modality: 'ECHO', studies: 0, validated: 0, revenue: 0, films: 0, retakes: 0 },
    };

    for (const o of db.orders) {
      if (o.fiscalYear && o.fiscalYear !== activeFiscalYear) continue;
      for (const t of o.tests) {
        if (t.serviceCategory !== 'RADIOLOGY' && t.department !== 'Radiology') continue;
        const mod = t.modality || 'X-RAY';
        if (!map[mod]) {
          map[mod] = { modality: mod, studies: 0, validated: 0, revenue: 0, films: 0, retakes: 0 };
        }
        map[mod].studies += 1;
        if (o.status === 'Validated' || o.status === 'Dispatched') map[mod].validated += 1;
        map[mod].revenue += t.price;
        map[mod].films += t.radiologyReport?.filmsUsedCount || 0;
        map[mod].retakes += t.radiologyReport?.filmRetakeCount || 0;
      }
    }
    return Object.values(map);
  }, [db.orders, activeFiscalYear]);

  const totalRadRevenue = useMemo(
    () => modalityFinance.reduce((s, r) => s + r.revenue, 0),
    [modalityFinance]
  );

  const openNewTemplate = () => {
    setEditingTpl({
      id: '',
      code: `TPL-RAD-${db.radiologyTemplates.length + 1}`,
      name: '',
      modality: 'X-RAY',
      technique: 'Standard diagnostic imaging protocol.',
      indicationPrompt: 'Clinical evaluation',
      sections: [
        { id: 'sec-1', title: 'Findings', defaultText: 'Normal study. No focal lesion or acute abnormality.' },
      ],
      measurements: [],
      normalImpression: 'Normal study.',
      advice: 'Correlate clinically.',
      quickMacros: [],
      updatedAt: new Date().toISOString(),
      updatedBy: activeUser.fullName,
    });
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTpl) return;
    setSavingTpl(true);
    try {
      const resp = await apiRequest<{ db: LimsDatabase; template: RadiologyTemplate }>(
        '/api/radiology/templates',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify(editingTpl),
        }
      );
      onUpdated(resp.db, `Saved radiology template '${resp.template.name}'.`);
      setEditingTpl(null);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save radiology template.');
    } finally {
      setSavingTpl(false);
    }
  };

  const handleDeleteTemplate = async (tpl: RadiologyTemplate) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/radiology/templates/${tpl.id}`,
        activeUser.id,
        { method: 'DELETE' }
      );
      onUpdated(resp.db, `Deleted template '${tpl.name}'.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Delete failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Radiology &amp; Diagnostic Imaging Suite (X-Ray, CT, USG, Echo)
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Fast template-driven radiology reporting, saved macro library, X-Ray film &amp; contrast inventory, and modality revenue breakdown ({activeFiscalYear}).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search patient, accession, modality..."
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
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-xl">
            {[
              { id: 'worklist', label: 'Imaging Worklist', icon: Scan },
              { id: 'templates', label: 'Saved Templates', icon: BookmarkCheck },
              { id: 'inventory', label: 'X-Ray Film & Contrast', icon: Film },
              { id: 'finance', label: 'Modality Finance', icon: Landmark },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id as any)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg ${
                    tab === item.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Imaging Studies ({activeFiscalYear})</div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {radiologyOrders.length} Orders
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {radiologyOrders.filter((o) => o.status !== 'Validated' && o.status !== 'Dispatched').length} awaiting radiologist sign-off
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Saved Fast Templates</div>
          <div className="text-2xl font-bold font-mono text-indigo-700 mt-1">
            {db.radiologyTemplates.length} Templates
          </div>
          <div className="text-xs text-slate-500 mt-0.5">X-Ray, CT, USG Abdomen &amp; 2D Echo</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">X-Ray Films &amp; Contrast On Hand</div>
          <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
            {radiologyStock.reduce((s, r) => s + r.currentStock, 0)} Units
          </div>
          <div className="text-xs text-amber-700 mt-0.5">
            {radiologyStock.filter((r) => r.currentStock <= r.reorderLevel).length} items near reorder
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500">Radiology Dept. Revenue</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 mt-1">
            {formatNpr(totalRadRevenue)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">Across X-RAY, CT, USG &amp; ECHO</div>
        </div>
      </div>

      {/* TAB 1: WORKLIST */}
      {tab === 'worklist' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold text-slate-900">
              Radiology Reporting Queue
            </div>
            <div className="flex items-center gap-1 p-1 bg-white border border-slate-200 rounded-lg">
              {(['ALL', ...MODALITIES] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setModalityFilter(m)}
                  className={`px-2.5 py-1 text-xs font-mono rounded-md ${
                    modalityFilter === m ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-4">Accession / BS Date</th>
                  <th className="py-2.5 px-4">Patient</th>
                  <th className="py-2.5 px-4">Imaging Study &amp; Modality</th>
                  <th className="py-2.5 px-4">Status / Films</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {radiologyOrders.map((o) => {
                  const bs = adToBs(o.orderedAt);
                  const radTests = o.tests.filter(
                    (t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology'
                  );
                  return (
                    <tr key={o.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4">
                        <div className="font-mono font-semibold text-slate-900">{o.accessionNumber}</div>
                        <div className="font-mono text-slate-500">{bs.formattedEn} · {bs.timeEn}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-slate-900">{o.patientName}</div>
                        <div className="text-slate-500 font-mono">
                          {o.patientAge} {o.patientAgeType} / {o.patientGender} · {o.uhid || o.encounterLabel || o.patientAddress}
                        </div>
                      </td>
                      <td className="py-3 px-4 space-y-1">
                        {radTests.map((t) => (
                          <div key={t.serviceId}>
                            <span className="font-mono font-semibold text-indigo-700">
                              [{t.modality || 'RAD'}] {t.serviceCode}
                            </span>{' '}
                            <span className="text-slate-800">{t.serviceName}</span>
                          </div>
                        ))}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{o.status}</div>
                        <div className="font-mono text-slate-500">
                          Films: {radTests.reduce((s, t) => s + (t.radiologyReport?.filmsUsedCount || 0), 0)} · Retakes:{' '}
                          {radTests.reduce((s, t) => s + (t.radiologyReport?.filmRetakeCount || 0), 0)}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {canReport && (
                            <button
                              type="button"
                              onClick={() => onOpenResults(o)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-md font-medium hover:bg-indigo-700"
                            >
                              <Scan className="w-3.5 h-3.5" />
                              {o.status === 'Validated' || o.status === 'Dispatched' ? 'View Report' : 'Report Study'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setStickerOrder(o)}
                            title="Print standalone thermal sticker"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 bg-slate-100 text-slate-800 rounded-md hover:bg-slate-200 whitespace-nowrap"
                          >
                            <Tag className="w-3.5 h-3.5" />
                            Sticker
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenReport(o, true)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-slate-300 bg-white text-slate-700 rounded-md hover:bg-slate-50"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            Print
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const center = o.collectionCenterId
                                ? db.centers.find((c) => c.id === o.collectionCenterId)
                                : undefined;
                              const dsn =
                                db.documentDesigns?.find((d) => d.id === center?.designTemplateId) ||
                                db.documentDesigns?.[0];
                              void downloadOrderReportPdf(o, db.settings, dsn, 'with');
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-md hover:bg-emerald-100"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {radiologyOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-slate-500">
                      No Radiology imaging orders found for {activeFiscalYear}. Register X-Ray/CT/USG/Echo from POS Billing!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SAVED TEMPLATES */}
      {tab === 'templates' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">
              Saved Radiology Structured Templates ({db.radiologyTemplates.length})
            </div>
            {canManageTemplates && (
              <button
                type="button"
                onClick={openNewTemplate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
              >
                <Plus className="w-3.5 h-3.5" />
                Create Radiology Template
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {db.radiologyTemplates.map((tpl) => (
              <div key={tpl.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-2.5 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono font-semibold text-indigo-700">
                      [{tpl.modality}] {tpl.code}
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5">{tpl.name}</div>
                  </div>
                  {canManageTemplates && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingTpl(JSON.parse(JSON.stringify(tpl)))}
                        className="px-2.5 py-1 border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteTemplate(tpl)}
                        className="p-1.5 text-rose-600 border border-slate-300 rounded-md hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-slate-600">{tpl.technique}</div>
                <div className="text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                  <strong>Normal Impression: </strong>
                  {tpl.normalImpression}
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                  <span>{tpl.sections.length} sections · {tpl.measurements.length} measurements</span>
                  <span>{tpl.quickMacros.length} quick macros</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: X-RAY FILM & CONTRAST INVENTORY */}
      {tab === 'inventory' && (
        <div className="space-y-5">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              X-Ray Film, CT Contrast &amp; USG/Echo Consumable Stock
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-4">SKU &amp; Item</th>
                    <th className="py-2.5 px-4">Category</th>
                    <th className="py-2.5 px-4">Lot / Expiry</th>
                    <th className="py-2.5 px-4 text-right">Current Stock</th>
                    <th className="py-2.5 px-4 text-right">Reorder Level</th>
                    <th className="py-2.5 px-4 text-right">Unit Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {radiologyStock.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-slate-900">{r.name}</div>
                        <div className="font-mono text-slate-500">{r.sku} · {r.manufacturer}</div>
                      </td>
                      <td className="py-2.5 px-4 font-mono text-indigo-700">{r.category}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-600">{r.lotNumber} · {r.expiryDate}</td>
                      <td className={`py-2.5 px-4 text-right font-mono font-bold ${r.currentStock <= r.reorderLevel ? 'text-rose-700' : 'text-slate-900'}`}>
                        {r.currentStock} {r.unit}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-500">
                        {r.reorderLevel} {r.unit}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-slate-700">
                        {formatNpr(r.unitCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Recent Film Usage &amp; Retake Wastage Ledger
            </div>
            <div className="divide-y divide-slate-100 text-xs">
              {retakeMovements.slice(0, 12).map((m) => (
                <div key={m.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                  <div>
                    <span className="font-medium text-slate-900">{m.reagentName}</span>{' '}
                    <span className="font-mono text-slate-500">({m.referenceId})</span>
                    <div className="text-[11px] text-slate-500">{m.notes}</div>
                  </div>
                  <div className="text-right font-mono">
                    <div className={m.type === 'FILM_RETAKE' ? 'text-rose-700 font-bold' : 'text-blue-700 font-semibold'}>
                      {m.type} ({m.quantityDelta})
                    </div>
                    <div className="text-[11px] text-slate-500">Bal: {m.balanceAfter}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: MODALITY FINANCIAL REPORT */}
      {tab === 'finance' && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">
              Radiology Financial Breakdown by Modality ({activeFiscalYear})
            </div>
            <button
              type="button"
              onClick={() =>
                downloadFinancialBreakdownPdf(
                  'Radiology Modality Financial Statement',
                  `Fiscal Year: ${activeFiscalYear} · Total Radiology Revenue: ${formatNpr(totalRadRevenue)}`,
                  [
                    {
                      heading: 'Modality Wise Revenue & Film Consumption',
                      columns: ['Modality', 'Studies', 'Validated', 'Films', 'Retakes', 'Revenue (NPR)'],
                      rows: modalityFinance.map((r) => [
                        r.modality,
                        String(r.studies),
                        String(r.validated),
                        String(r.films),
                        String(r.retakes),
                        formatNpr(r.revenue),
                      ]),
                    },
                  ],
                  db.settings
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100"
            >
              <Download className="w-3.5 h-3.5" />
              Export Radiology Financial PDF
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 px-4">Imaging Modality</th>
                  <th className="py-2.5 px-4 text-right">Studies Billed</th>
                  <th className="py-2.5 px-4 text-right">Validated Reports</th>
                  <th className="py-2.5 px-4 text-right">Films Used</th>
                  <th className="py-2.5 px-4 text-right">Retake Wastage</th>
                  <th className="py-2.5 px-4 text-right">Total Revenue (NPR)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {modalityFinance.map((row) => (
                  <tr key={row.modality}>
                    <td className="py-2.5 px-4 font-mono font-semibold text-indigo-700">{row.modality}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{row.studies}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{row.validated}</td>
                    <td className="py-2.5 px-4 text-right font-mono">{row.films}</td>
                    <td className="py-2.5 px-4 text-right font-mono text-rose-700">{row.retakes}</td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                      {formatNpr(row.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create / Edit Template Modal */}
      {editingTpl && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl shadow-xl overflow-hidden my-6">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              {editingTpl.id ? `Edit Radiology Template: ${editingTpl.name}` : 'New Radiology Template'}
            </div>
            <form onSubmit={handleSaveTemplate} className="p-6 space-y-3 text-xs max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Template Name *</label>
                  <input
                    required
                    value={editingTpl.name}
                    onChange={(e) => setEditingTpl({ ...editingTpl, name: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Modality</label>
                  <select
                    value={editingTpl.modality}
                    onChange={(e) =>
                      setEditingTpl({ ...editingTpl, modality: e.target.value as RadiologyModality })
                    }
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                  >
                    {MODALITIES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Technique</label>
                  <input
                    value={editingTpl.technique}
                    onChange={(e) => setEditingTpl({ ...editingTpl, technique: e.target.value })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-800">Report Sections</span>
                  <button
                    type="button"
                    onClick={() =>
                      setEditingTpl({
                        ...editingTpl,
                        sections: [
                          ...editingTpl.sections,
                          { id: `sec-${Date.now()}`, title: 'Additional Organ / View', defaultText: 'Normal.' },
                        ],
                      })
                    }
                    className="text-indigo-700 font-medium hover:underline"
                  >
                    + Add Section
                  </button>
                </div>
                {editingTpl.sections.map((s, idx) => (
                  <div key={s.id} className="grid grid-cols-12 gap-2 items-start">
                    <input
                      value={s.title}
                      onChange={(e) => {
                        const next = [...editingTpl.sections];
                        next[idx] = { ...s, title: e.target.value };
                        setEditingTpl({ ...editingTpl, sections: next });
                      }}
                      className="col-span-4 px-2 py-1.5 border border-slate-300 rounded font-medium"
                    />
                    <input
                      value={s.defaultText}
                      onChange={(e) => {
                        const next = [...editingTpl.sections];
                        next[idx] = { ...s, defaultText: e.target.value };
                        setEditingTpl({ ...editingTpl, sections: next });
                      }}
                      className="col-span-7 px-2 py-1.5 border border-slate-300 rounded"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setEditingTpl({
                          ...editingTpl,
                          sections: editingTpl.sections.filter((_, i) => i !== idx),
                        })
                      }
                      className="col-span-1 text-rose-600 py-1.5 text-right"
                    >
                      Del
                    </button>
                  </div>
                ))}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Normal Impression *</label>
                <textarea
                  required
                  rows={2}
                  value={editingTpl.normalImpression}
                  onChange={(e) => setEditingTpl({ ...editingTpl, normalImpression: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Default Advice</label>
                <input
                  value={editingTpl.advice}
                  onChange={(e) => setEditingTpl({ ...editingTpl, advice: e.target.value })}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingTpl(null)}
                  className="px-4 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingTpl}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {savingTpl ? 'Saving...' : 'Save Radiology Template'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {stickerOrder && (
        <ThermalStickerPrintModal
          uhid={stickerOrder.uhid || stickerOrder.accessionNumber}
          barcodeValue={stickerOrder.accessionNumber}
          patientName={stickerOrder.patientName}
          ageGender={`${stickerOrder.patientAge}${stickerOrder.patientAgeType.charAt(0)}/${stickerOrder.patientGender.charAt(0)}`}
          encounterLabel={`RAD · ${stickerOrder.accessionNumber}`}
          doctorOrUnit={stickerOrder.tests
            .filter((t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology')
            .map((t) => t.serviceCode)
            .join(', ')}
          dateIso={stickerOrder.orderedAt}
          settings={db.settings}
          onClose={() => setStickerOrder(null)}
        />
      )}
    </div>
  );
}
