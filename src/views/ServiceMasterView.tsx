import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Edit3, Plus, Search, Trash2, X } from 'lucide-react';
import type { LabServiceTest, LimsDatabase, PermissionKey, StaffMember } from '../types/lims';
import { formatNpr } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';

interface ServiceMasterViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

type ServiceModuleTab = 'ALL' | 'HOSPITAL_SERVICES' | 'RADIOLOGY' | 'LABORATORY';

export function ServiceMasterView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: ServiceMasterViewProps) {
  const [moduleTab, setModuleTab] = useState<ServiceModuleTab>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(db.services[0]?.id || null);
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [customCatFilter, setCustomCatFilter] = useState<string>('ALL');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [savingCategories, setSavingCategories] = useState(false);
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [editingService, setEditingService] = useState<LabServiceTest | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [fetchingCatalog, setFetchingCatalog] = useState(false);
  const [fetchingLabCatalog, setFetchingLabCatalog] = useState(false);

  const handleFetchHospitalCatalog = async () => {
    setFetchingCatalog(true);
    try {
      const resp = await apiRequest<{ addedServices: number; totalServices: number; db: any }>(
        '/api/services/fetch-hospital-catalog',
        activeUser.id,
        { method: 'POST', body: JSON.stringify({}) }
      );
      onUpdated(
        resp.db,
        `Synced ${resp.addedServices} hospital services (X-Ray, DR X-Ray, USG, Doppler, ECG & Procedures). Total: ${resp.totalServices}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to fetch hospital service catalog.');
    } finally {
      setFetchingCatalog(false);
    }
  };

  const handleFetchLabCatalog = async () => {
    setFetchingLabCatalog(true);
    try {
      const resp = await apiRequest<{
        addedServices: number;
        updatedServices: number;
        totalServices: number;
        labServicesCount: number;
        db: any;
      }>('/api/services/fetch-lab-catalog', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      onUpdated(
        resp.db,
        `Auto-fetched ${resp.addedServices} lab test panels (${resp.labServicesCount} lab panels ready with analyzer codes). Total catalog: ${resp.totalServices}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to auto-fetch laboratory catalog.');
    } finally {
      setFetchingLabCatalog(false);
    }
  };

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const canManage = hasPerm('services.manage');
  const customCategories =
    db.settings.moduleSettings?.customServiceCategories &&
    db.settings.moduleSettings.customServiceCategories.length > 0
      ? db.settings.moduleSettings.customServiceCategories
      : ['Consultation', 'Procedures', 'Diagnostics', 'Ortho & Plaster', 'Emergency', 'Radiology'];

  const departments = [
    'ALL',
    'Hematology',
    'Clinical Chemistry',
    'Endocrinology',
    'Immunology',
    'Microbiology',
    'Radiology',
    'Consultation & OPD',
    'Ortho & Plaster',
    'Emergency & Procedures',
    'Nursing & Ward',
    'Hospital Services',
  ];

  const getServiceGroupLabel = (s: LabServiceTest) =>
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

  const getServiceModule = (s: LabServiceTest): Exclude<ServiceModuleTab, 'ALL'> => {
    if (s.serviceCategory === 'RADIOLOGY' || s.department === 'Radiology') {
      return 'RADIOLOGY';
    }
    if (
      s.serviceCategory === 'CONSULTATION' ||
      s.serviceCategory === 'HOSPITAL_PROCEDURE' ||
      s.serviceCategory === 'EMERGENCY' ||
      [
        'Consultation & OPD',
        'Ortho & Plaster',
        'Emergency & Procedures',
        'Nursing & Ward',
        'Hospital Services',
      ].includes(s.department)
    ) {
      return 'HOSPITAL_SERVICES';
    }
    return 'LABORATORY';
  };

  const moduleCounts = {
    ALL: db.services.length,
    HOSPITAL_SERVICES: db.services.filter((s) => getServiceModule(s) === 'HOSPITAL_SERVICES').length,
    RADIOLOGY: db.services.filter((s) => getServiceModule(s) === 'RADIOLOGY').length,
    LABORATORY: db.services.filter((s) => getServiceModule(s) === 'LABORATORY').length,
  };

  const departmentsByModule: Record<ServiceModuleTab, string[]> = {
    ALL: departments,
    HOSPITAL_SERVICES: [
      'ALL',
      'Consultation & OPD',
      'Ortho & Plaster',
      'Emergency & Procedures',
      'Nursing & Ward',
      'Hospital Services',
    ],
    RADIOLOGY: ['ALL', 'Radiology'],
    LABORATORY: [
      'ALL',
      'Hematology',
      'Clinical Chemistry',
      'Endocrinology',
      'Immunology',
      'Microbiology',
    ],
  };

  const filtered = db.services.filter((s) => {
    if (moduleTab !== 'ALL' && getServiceModule(s) !== moduleTab) return false;
    if (deptFilter !== 'ALL' && s.department !== deptFilter) return false;
    if (customCatFilter !== 'ALL' && getServiceGroupLabel(s) !== customCatFilter) return false;
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return `${s.code} ${s.name} ${s.department} ${getServiceGroupLabel(s)} ${s.specimenType} ${s.methodology} ${s.parameters.map((p) => p.name).join(' ')}`
      .toLowerCase()
      .includes(q);
  });

  const handleAddCustomCategory = async () => {
    const clean = newCategoryName.trim();
    if (!clean || customCategories.includes(clean)) return;
    setSavingCategories(true);
    try {
      const nextCats = [...customCategories, clean];
      const resp = await apiRequest<{ db: any }>('/api/settings', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({
          moduleSettings: {
            ...(db.settings.moduleSettings || {}),
            customServiceCategories: nextCats,
          },
        }),
      });
      setNewCategoryName('');
      onUpdated(resp.db, `Added custom service category "${clean}".`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to add category.');
    } finally {
      setSavingCategories(false);
    }
  };

  const openNewModal = (targetModule: ServiceModuleTab = moduleTab) => {
    const isRad = targetModule === 'RADIOLOGY';
    const isHosp = targetModule === 'HOSPITAL_SERVICES';
    setEditingService({
      id: '',
      code: '',
      name: '',
      serviceCategory: isRad ? 'RADIOLOGY' : isHosp ? 'HOSPITAL_PROCEDURE' : 'DIAGNOSTICS',
      modality: isRad ? 'X-RAY' : undefined,
      customCategory: isRad
        ? 'Radiology'
        : isHosp
        ? 'Procedures'
        : customCategories[2] || customCategories[0] || 'Diagnostics',
      allowCustomRateAtBilling: isHosp,
      department: isRad ? 'Radiology' : isHosp ? 'Emergency & Procedures' : 'Clinical Chemistry',
      specimenType: isRad ? 'Imaging Study' : isHosp ? 'Clinical Service' : 'Serum',
      containerType: isRad ? 'Digital Film / PACS' : isHosp ? 'Ward / OPD Procedure' : 'SST Gold Top (5 mL)',
      methodology: isRad ? 'Digital Radiography / Ultrasound' : isHosp ? 'Direct Clinical Service' : 'Automated Photometric Assay',
      tatMinutes: isRad ? 45 : isHosp ? 30 : 180,
      price: isRad ? 800 : isHosp ? 500 : 550,
      active: true,
      parameters:
        isRad || isHosp
          ? []
          : [
              {
                id: `p-${Date.now()}`,
                name: 'Primary Analyte',
                unit: 'mg/dL',
                refMinMale: 10,
                refMaxMale: 100,
                refMinFemale: 10,
                refMaxFemale: 100,
                decimalPlaces: 1,
              },
            ],
      reagentBom: [],
      interpretations: {
        normal: isRad
          ? 'Normal study. No acute abnormality detected.'
          : isHosp
          ? 'Procedure completed smoothly without complication.'
          : 'Analyte within normal biological reference interval.',
        abnormalLow: 'Reduced level noted; correlate clinically.',
        abnormalHigh: 'Elevated level noted; correlate with clinical history.',
        critical: 'CRITICAL PANIC VALUE ALERT: Immediate physician notification required.',
        methodologyNote: isRad
          ? 'Performed under standard radiation protection & imaging calibration.'
          : 'Assayed under calibrated ISO 15189 internal quality control.',
      },
    });
  };

  const handleSaveService = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService) return;
    setSaving(true);
    try {
      const resp = await apiRequest<{ db: any }>('/api/services', activeUser.id, {
        method: 'POST',
        body: JSON.stringify(editingService),
      });
      onUpdated(resp.db, `Saved Service Master definition for ${editingService.code}.`);
      setEditingService(null);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save service.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteService = async (srv: LabServiceTest) => {
    try {
      const resp = await apiRequest<{ db: any }>(`/api/services/${srv.id}`, activeUser.id, {
        method: 'DELETE',
      });
      onUpdated(resp.db, `Deleted test ${srv.code} (${srv.name}) from Service Master.`);
      setConfirmDeleteId(null);
    } catch (err: any) {
      onUpdated(db, err.message || 'Delete failed.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Separate Service Masters — Hospital, X-Ray &amp; Lab ({db.services.length})
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Dedicated Service Masters for Hospital Services, X-Ray / DR / USG Radiology, and Laboratory panels with full Edit, Price Override &amp; Delete controls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search code, service, param..."
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
            <>
              <button
                type="button"
                disabled={fetchingLabCatalog}
                onClick={handleFetchLabCatalog}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
              >
                {fetchingLabCatalog ? 'Fetching Lab Tests...' : 'Auto-Fetch All Lab Tests'}
              </button>
              <button
                type="button"
                disabled={fetchingCatalog}
                onClick={handleFetchHospitalCatalog}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 disabled:opacity-50 whitespace-nowrap"
              >
                {fetchingCatalog ? 'Fetching Catalog...' : 'Fetch All X-Ray / DR / USG / Procedures'}
              </button>
              <button
                type="button"
                onClick={() => openNewModal(moduleTab)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                {moduleTab === 'RADIOLOGY'
                  ? 'Add X-Ray / USG Study'
                  : moduleTab === 'HOSPITAL_SERVICES'
                  ? 'Add Hospital Service'
                  : moduleTab === 'LABORATORY'
                  ? 'Add Lab Panel'
                  : 'Add Service'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Separate Master Module Switcher */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {(
          [
            { id: 'ALL', title: 'All Service Masters', desc: 'Unified catalog view', count: moduleCounts.ALL },
            { id: 'HOSPITAL_SERVICES', title: 'Hospital Service Master', desc: 'OPD, Procedures, Ortho, Ward', count: moduleCounts.HOSPITAL_SERVICES },
            { id: 'RADIOLOGY', title: 'X-Ray & Radiology Master', desc: 'X-Ray, DR X-Ray, USG, Doppler', count: moduleCounts.RADIOLOGY },
            { id: 'LABORATORY', title: 'Laboratory Test Master', desc: 'Pathology, Biochem, Micro', count: moduleCounts.LABORATORY },
          ] as const
        ).map((tab) => {
          const active = moduleTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setModuleTab(tab.id);
                setDeptFilter('ALL');
                setCustomCatFilter('ALL');
              }}
              className={`text-left p-3 rounded-xl border transition-colors ${
                active
                  ? 'bg-slate-900 border-slate-900 text-white'
                  : 'bg-white border-slate-200 hover:border-blue-400 text-slate-900'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold truncate">{tab.title}</span>
                <span
                  className={`font-mono text-xs font-bold tabular-nums ${
                    active ? 'text-amber-300' : 'text-blue-700'
                  }`}
                >
                  {tab.count}
                </span>
              </div>
              <div className={`text-[11px] mt-0.5 truncate ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                {tab.desc}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom Service Categories Bar + Add New Category */}
      <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-800">
            Custom POS Billing Groups (Consultation, Procedures, Diagnostics, Ortho &amp; Plaster, etc.)
          </div>
          {canManage && (
            <div className="flex items-center gap-1.5">
              <input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name..."
                className="px-2.5 py-1 text-xs border border-slate-300 rounded-lg w-44"
              />
              <button
                type="button"
                disabled={savingCategories || !newCategoryName.trim()}
                onClick={handleAddCustomCategory}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <Plus className="w-3 h-3" />
                Add Group
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCustomCatFilter('ALL')}
            className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap ${
              customCatFilter === 'ALL'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
            }`}
          >
            All Groups ({db.services.length})
          </button>
          {customCategories.map((cat) => {
            const count = db.services.filter((s) => getServiceGroupLabel(s) === cat).length;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setCustomCatFilter(cat)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md border whitespace-nowrap ${
                  customCatFilter === cat
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {cat} ({count})
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {departmentsByModule[moduleTab].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDeptFilter(d)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              deptFilter === d
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {d === 'ALL' ? 'All Sub-Departments' : d}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((srv) => {
          const isOpen = expandedId === srv.id;
          return (
            <div key={srv.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 flex flex-wrap items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => setExpandedId(isOpen ? null : srv.id)}
                  className="flex items-start gap-3 text-left flex-1 min-w-[260px]"
                >
                  <span className="mt-0.5 text-slate-400">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-blue-700">
                        {srv.code}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                        {getServiceGroupLabel(srv)}
                      </span>
                      {srv.allowCustomRateAtBilling && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                          Custom / Doctor Rate at POS
                        </span>
                      )}
                      {(srv.serviceCategory === 'RADIOLOGY' || srv.department === 'Radiology') && (
                        <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {srv.modality || 'RADIOLOGY'}
                        </span>
                      )}
                      <span className="text-sm font-semibold text-slate-900">{srv.name}</span>
                      <span className="text-xs text-slate-400 font-mono">
                        {srv.serviceCategory === 'RADIOLOGY' || srv.department === 'Radiology'
                          ? '(Structured Imaging Template)'
                          : `(${srv.parameters.length} params)`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {srv.department} · {srv.specimenType} ({srv.containerType}) · {srv.methodology}
                    </div>
                  </div>
                </button>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Target TAT</div>
                    <div className="text-sm font-mono font-semibold text-slate-900">
                      {srv.tatMinutes} min
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-slate-500">Fee (NPR)</div>
                    <div className="text-sm font-mono font-semibold text-slate-900">
                      {formatNpr(srv.price)}
                    </div>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingService(JSON.parse(JSON.stringify(srv)))}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit Amount &amp; Params
                      </button>
                      {confirmDeleteId === srv.id ? (
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteService(srv)}
                            className="px-2.5 py-1.5 text-xs font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-lg"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(srv.id)}
                          title="Delete test"
                          className="p-1.5 text-rose-600 bg-white border border-slate-300 rounded-lg hover:bg-rose-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-slate-200 bg-slate-50/50 p-5 space-y-5">
                  <div>
                    <h3 className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                      Analyte Parameters &amp; Biological Reference Intervals
                    </h3>
                    <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 bg-slate-50">
                            <th className="py-2 px-3">Parameter</th>
                            <th className="py-2 px-3">Unit</th>
                            <th className="py-2 px-3">Male Ref. Range</th>
                            <th className="py-2 px-3">Female Ref. Range</th>
                            <th className="py-2 px-3">Critical Panic Thresholds</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {srv.parameters.map((p) => {
                            const isQual = p.resultType === 'QUALITATIVE';
                            return (
                              <tr key={p.id}>
                                <td className="py-2 px-3 font-medium text-slate-900">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span>{p.name}</span>
                                    {p.analyzerCode && (
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                        HL7:{p.analyzerCode}
                                      </span>
                                    )}
                                  </div>
                                  {p.formula && (
                                    <div className="text-[10px] font-mono text-indigo-700 mt-0.5">
                                      Auto Formula: {p.formula}
                                    </div>
                                  )}
                                  {isQual && (
                                    <div className="text-[10px] font-mono text-blue-700 mt-0.5">
                                      Options: {(p.qualitativeOptions || ['Negative', 'Positive']).join(' · ')}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-600">
                                  {isQual ? 'Qualitative' : p.unit}
                                </td>
                                <td className="py-2 px-3 font-mono tabular-nums text-slate-700">
                                  {isQual
                                    ? `Normal: ${(p.normalQualitativeValues || [p.qualitativeOptions?.[0] || 'Negative']).join(' / ')}`
                                    : `${p.refMinMale} – ${p.refMaxMale}`}
                                </td>
                                <td className="py-2 px-3 font-mono tabular-nums text-slate-700">
                                  {isQual
                                    ? `Normal: ${(p.normalQualitativeValues || [p.qualitativeOptions?.[0] || 'Negative']).join(' / ')}`
                                    : `${p.refMinFemale} – ${p.refMaxFemale}`}
                                </td>
                                <td className="py-2 px-3 font-mono text-rose-700">
                                  {isQual
                                    ? p.criticalQualitativeValues?.length
                                      ? p.criticalQualitativeValues.join(', ')
                                      : '—'
                                    : `${p.criticalLow !== undefined ? `≤${p.criticalLow}` : '—'} / ${
                                        p.criticalHigh !== undefined ? `≥${p.criticalHigh}` : '—'
                                      }`}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-2">
                      <h4 className="text-xs font-semibold text-slate-800">
                        Automated Reagent Deduction BOM (Per Test Validation)
                      </h4>
                      {srv.reagentBom.length > 0 ? (
                        <ul className="space-y-1 text-xs text-slate-700">
                          {srv.reagentBom.map((b, idx) => (
                            <li key={idx} className="flex items-center justify-between font-mono">
                              <span>{b.reagentName}</span>
                              <span className="font-semibold text-slate-900">
                                -{b.quantityPerTest} {b.unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500">No reagent BOM mapped.</p>
                      )}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-1.5 text-xs">
                      <h4 className="text-xs font-semibold text-slate-800">
                        Rule-Based Clinical Interpretation Templates
                      </h4>
                      <p className="text-slate-600">
                        <strong className="text-emerald-700">Normal:</strong> {srv.interpretations.normal}
                      </p>
                      <p className="text-slate-600">
                        <strong className="text-amber-700">Low:</strong> {srv.interpretations.abnormalLow}
                      </p>
                      <p className="text-slate-600">
                        <strong className="text-amber-700">High:</strong>{' '}
                        {srv.interpretations.abnormalHigh}
                      </p>
                      <p className="text-slate-600">
                        <strong className="text-rose-700">Critical:</strong>{' '}
                        {srv.interpretations.critical}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add / Edit Service Modal (Amount, TAT, Parameters, Interpretations) */}
      {editingService && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl shadow-xl overflow-hidden my-6">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h2 className="text-base font-semibold text-slate-900">
                {editingService.id ? `Edit ${editingService.code} — Amount, TAT & Parameters` : 'New Lab Service Master Entry'}
              </h2>
              <button
                type="button"
                onClick={() => setEditingService(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveService} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Test Code *</label>
                  <input
                    required
                    value={editingService.code}
                    onChange={(e) =>
                      setEditingService({ ...editingService, code: e.target.value.toUpperCase() })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Test Name *</label>
                  <input
                    required
                    value={editingService.name}
                    onChange={(e) => setEditingService({ ...editingService, name: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <select
                    value={editingService.department}
                    onChange={(e) => {
                      const dept = e.target.value as LabServiceTest['department'];
                      const isRad = dept === 'Radiology';
                      setEditingService({
                        ...editingService,
                        department: dept,
                        serviceCategory: isRad ? 'RADIOLOGY' : 'PATHOLOGY',
                        modality: isRad ? editingService.modality || 'X-RAY' : undefined,
                        specimenType: isRad ? 'Radiology Study' : editingService.specimenType,
                        containerType: isRad ? 'Imaging Modality' : editingService.containerType,
                      });
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Hematology">Hematology</option>
                    <option value="Clinical Chemistry">Clinical Chemistry</option>
                    <option value="Endocrinology">Endocrinology</option>
                    <option value="Immunology">Immunology</option>
                    <option value="Microbiology">Microbiology</option>
                    <option value="Radiology">Radiology (X-Ray / CT / USG / Echo)</option>
                    <option value="Consultation & OPD">Consultation &amp; OPD</option>
                    <option value="Ortho & Plaster">Ortho &amp; Plaster</option>
                    <option value="Emergency & Procedures">Emergency &amp; Procedures</option>
                    <option value="Nursing & Ward">Nursing &amp; Ward</option>
                    <option value="Hospital Services">Hospital Services</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Custom POS Category Group
                  </label>
                  <select
                    value={editingService.customCategory || ''}
                    onChange={(e) =>
                      setEditingService({
                        ...editingService,
                        customCategory: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="">-- Select Custom Group --</option>
                    {customCategories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end pb-1.5">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(editingService.allowCustomRateAtBilling)}
                      onChange={(e) =>
                        setEditingService({
                          ...editingService,
                          allowCustomRateAtBilling: e.target.checked,
                        })
                      }
                      className="rounded border-slate-300 text-amber-600"
                    />
                    <span>Custom / Doctor Rate at POS (e.g. POP/Plaster)</span>
                  </label>
                </div>
                {(editingService.department === 'Radiology' ||
                  editingService.serviceCategory === 'RADIOLOGY') && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Radiology Modality
                      </label>
                      <select
                        value={editingService.modality || 'X-RAY'}
                        onChange={(e) =>
                          setEditingService({
                            ...editingService,
                            serviceCategory: 'RADIOLOGY',
                            modality: e.target.value as LabServiceTest['modality'],
                          })
                        }
                        className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="X-RAY">X-RAY</option>
                        <option value="CT">CT SCAN</option>
                        <option value="USG">USG (Ultrasound)</option>
                        <option value="ECHO">2D ECHO</option>
                        <option value="ECG">ECG</option>
                        <option value="MRI">MRI</option>
                      </select>
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Default Saved Radiology Template
                      </label>
                      <select
                        value={editingService.defaultRadiologyTemplateId || ''}
                        onChange={(e) =>
                          setEditingService({
                            ...editingService,
                            defaultRadiologyTemplateId: e.target.value || undefined,
                          })
                        }
                        className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="">Auto-match by modality</option>
                        {(db.radiologyTemplates || []).map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            [{tpl.modality}] {tpl.name} ({tpl.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    TAT Target (minutes) *
                  </label>
                  <input
                    type="number"
                    min={15}
                    required
                    value={editingService.tatMinutes}
                    onChange={(e) =>
                      setEditingService({ ...editingService, tatMinutes: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Amount / Fee (रू NPR) *</label>
                  <input
                    type="number"
                    min={1}
                    step="1"
                    required
                    value={editingService.price}
                    onChange={(e) =>
                      setEditingService({ ...editingService, price: Number(e.target.value) })
                    }
                    className="w-full px-3 py-2 text-xs font-mono font-semibold border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Methodology</label>
                  <input
                    value={editingService.methodology}
                    onChange={(e) =>
                      setEditingService({ ...editingService, methodology: e.target.value })
                    }
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-800">
                    Parameters ({editingService.parameters.length}) — Numeric &amp; Qualitative
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        setEditingService({
                          ...editingService,
                          parameters: [
                            ...editingService.parameters,
                            {
                              id: `p-${Date.now()}`,
                              name: 'New Numeric Parameter',
                              resultType: 'NUMERIC',
                              unit: 'mg/dL',
                              refMinMale: 0,
                              refMaxMale: 10,
                              refMinFemale: 0,
                              refMaxFemale: 10,
                              decimalPlaces: 1,
                            },
                          ],
                        })
                      }
                      className="text-xs font-medium text-blue-700 hover:underline"
                    >
                      + Add Numeric
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setEditingService({
                          ...editingService,
                          parameters: [
                            ...editingService.parameters,
                            {
                              id: `p-${Date.now()}`,
                              name: 'New Qualitative Parameter',
                              resultType: 'QUALITATIVE',
                              unit: '-',
                              refMinMale: 0,
                              refMaxMale: 0,
                              refMinFemale: 0,
                              refMaxFemale: 0,
                              decimalPlaces: 0,
                              qualitativeOptions: ['Negative', 'Positive'],
                              normalQualitativeValues: ['Negative'],
                              criticalQualitativeValues: [],
                            },
                          ],
                        })
                      }
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      + Add Qualitative
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {editingService.parameters.map((p, idx) => {
                    const isQual = p.resultType === 'QUALITATIVE';
                    const applyPreset = (presetKey: string) => {
                      const presets: Record<string, { opts: string[]; norm: string[]; crit: string[] }> = {
                        NEG_POS: { opts: ['Negative', 'Positive'], norm: ['Negative'], crit: [] },
                        NO_YES: { opts: ['No', 'Yes'], norm: ['No'], crit: [] },
                        ABS_PRES: { opts: ['Absent', 'Present'], norm: ['Absent'], crit: [] },
                        TRACE_4: {
                          opts: ['Absent', 'Trace', '+1', '+2', '+3', '+4'],
                          norm: ['Absent'],
                          crit: ['+4'],
                        },
                        REACTIVE: {
                          opts: ['Non-Reactive', 'Reactive'],
                          norm: ['Non-Reactive'],
                          crit: ['Reactive'],
                        },
                        CLARITY: {
                          opts: ['Clear', 'Slightly Turbid', 'Turbid'],
                          norm: ['Clear'],
                          crit: [],
                        },
                      };
                      const chosen = presets[presetKey];
                      if (!chosen) return;
                      const next = [...editingService.parameters];
                      next[idx] = {
                        ...p,
                        resultType: 'QUALITATIVE',
                        qualitativeOptions: chosen.opts,
                        normalQualitativeValues: chosen.norm,
                        criticalQualitativeValues: chosen.crit,
                      };
                      setEditingService({ ...editingService, parameters: next });
                    };

                    return (
                      <div
                        key={p.id}
                        className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-2"
                      >
                        <div className="grid grid-cols-12 gap-2 items-center">
                          <input
                            value={p.name}
                            onChange={(e) => {
                              const next = [...editingService.parameters];
                              next[idx] = { ...p, name: e.target.value };
                              setEditingService({ ...editingService, parameters: next });
                            }}
                            placeholder="Parameter Name"
                            className="col-span-4 px-2 py-1 bg-white border border-slate-300 rounded font-medium"
                          />
                          <select
                            value={isQual ? 'QUALITATIVE' : 'NUMERIC'}
                            onChange={(e) => {
                              const mode = e.target.value as 'NUMERIC' | 'QUALITATIVE';
                              const next = [...editingService.parameters];
                              next[idx] = {
                                ...p,
                                resultType: mode,
                                unit: mode === 'QUALITATIVE' ? '-' : p.unit === '-' ? 'mg/dL' : p.unit,
                                qualitativeOptions:
                                  mode === 'QUALITATIVE'
                                    ? p.qualitativeOptions || ['Negative', 'Positive']
                                    : p.qualitativeOptions,
                                normalQualitativeValues:
                                  mode === 'QUALITATIVE'
                                    ? p.normalQualitativeValues || ['Negative']
                                    : p.normalQualitativeValues,
                              };
                              setEditingService({ ...editingService, parameters: next });
                            }}
                            className="col-span-2 px-1.5 py-1 bg-white border border-slate-300 rounded font-mono text-[11px]"
                          >
                            <option value="NUMERIC">Numeric</option>
                            <option value="QUALITATIVE">Qualitative</option>
                          </select>

                          {!isQual ? (
                            <>
                              <input
                                value={p.unit}
                                onChange={(e) => {
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, unit: e.target.value };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                placeholder="Unit"
                                className="col-span-1 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded"
                              />
                              <input
                                type="number"
                                step="any"
                                value={p.refMinMale}
                                onChange={(e) => {
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, refMinMale: Number(e.target.value) };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                title="Male Min"
                                className="col-span-1 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded"
                              />
                              <input
                                type="number"
                                step="any"
                                value={p.refMaxMale}
                                onChange={(e) => {
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, refMaxMale: Number(e.target.value) };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                title="Male Max"
                                className="col-span-1 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded"
                              />
                              <input
                                type="number"
                                step="any"
                                value={p.refMinFemale}
                                onChange={(e) => {
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, refMinFemale: Number(e.target.value) };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                title="Female Min"
                                className="col-span-1 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded"
                              />
                              <input
                                type="number"
                                step="any"
                                value={p.refMaxFemale}
                                onChange={(e) => {
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, refMaxFemale: Number(e.target.value) };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                title="Female Max"
                                className="col-span-1 px-1.5 py-1 font-mono bg-white border border-slate-300 rounded"
                              />
                            </>
                          ) : (
                            <select
                              value=""
                              onChange={(e) => applyPreset(e.target.value)}
                              className="col-span-5 px-2 py-1 bg-white border border-slate-300 rounded text-[11px]"
                            >
                              <option value="">Load Qualitative Preset (Yes/No, Trace, Pos/Neg)...</option>
                              <option value="NEG_POS">Negative / Positive</option>
                              <option value="NO_YES">No / Yes</option>
                              <option value="ABS_PRES">Absent / Present</option>
                              <option value="TRACE_4">Absent / Trace / +1 / +2 / +3 / +4</option>
                              <option value="REACTIVE">Non-Reactive / Reactive</option>
                              <option value="CLARITY">Clear / Slightly Turbid / Turbid</option>
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              const next = editingService.parameters.filter((_, i) => i !== idx);
                              setEditingService({ ...editingService, parameters: next });
                            }}
                            className="col-span-1 text-rose-600 hover:underline font-medium text-right"
                          >
                            Delete
                          </button>
                        </div>

                        {isQual && (
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-0.5">
                                Options (comma separated)
                              </label>
                              <input
                                value={(p.qualitativeOptions || []).join(', ')}
                                onChange={(e) => {
                                  const opts = e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, qualitativeOptions: opts };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                placeholder="Absent, Trace, +1, +2, +3, +4"
                                className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded text-[11px]"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-0.5">
                                Normal Expected Value(s)
                              </label>
                              <input
                                value={(p.normalQualitativeValues || []).join(', ')}
                                onChange={(e) => {
                                  const norms = e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, normalQualitativeValues: norms };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                placeholder="Negative"
                                className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded text-[11px]"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] text-slate-500 mb-0.5">
                                Critical Alert Value(s) (Optional)
                              </label>
                              <input
                                value={(p.criticalQualitativeValues || []).join(', ')}
                                onChange={(e) => {
                                  const crits = e.target.value
                                    .split(',')
                                    .map((s) => s.trim())
                                    .filter(Boolean);
                                  const next = [...editingService.parameters];
                                  next[idx] = { ...p, criticalQualitativeValues: crits };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                placeholder="Reactive, +4"
                                className="w-full px-2 py-1 font-mono bg-white border border-slate-300 rounded text-[11px]"
                              />
                            </div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center pt-1 border-t border-slate-200/70">
                          <div className="sm:col-span-3 flex items-center gap-1.5">
                            <span className="text-[10px] font-medium text-slate-600 whitespace-nowrap">
                              Analyzer Code:
                            </span>
                            <input
                              data-no-autocap="true"
                              value={p.analyzerCode || ''}
                              onChange={(e) => {
                                const next = [...editingService.parameters];
                                next[idx] = { ...p, analyzerCode: e.target.value.toUpperCase() };
                                setEditingService({ ...editingService, parameters: next });
                              }}
                              placeholder="e.g. WBC, TSH"
                              className="w-24 px-2 py-0.5 font-mono bg-white border border-slate-300 rounded text-[11px]"
                            />
                          </div>
                          {!isQual && (
                            <div className="sm:col-span-9 flex flex-wrap items-center gap-1.5">
                              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-indigo-900 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={Boolean(p.isCalculated || p.formula)}
                                  onChange={(e) => {
                                    const next = [...editingService.parameters];
                                    next[idx] = {
                                      ...p,
                                      isCalculated: e.target.checked,
                                      formula: e.target.checked ? p.formula || '' : '',
                                    };
                                    setEditingService({ ...editingService, parameters: next });
                                  }}
                                  className="rounded border-slate-300 text-indigo-600"
                                />
                                Formula:
                              </label>
                              <input
                                value={p.formula || ''}
                                onChange={(e) => {
                                  const next = [...editingService.parameters];
                                  next[idx] = {
                                    ...p,
                                    isCalculated: Boolean(e.target.value.trim()),
                                    formula: e.target.value,
                                  };
                                  setEditingService({ ...editingService, parameters: next });
                                }}
                                placeholder="e.g. {p-tbil} - {p-dbil} or ({p-chol} - {p-hdl} - ({p-tg}/5))"
                                className="flex-1 min-w-[200px] px-2 py-1 font-mono bg-white border border-slate-300 rounded text-[11px]"
                              />
                              {editingService.parameters
                                .filter((other) => other.id !== p.id && other.resultType !== 'QUALITATIVE')
                                .slice(0, 4)
                                .map((other) => (
                                  <button
                                    key={other.id}
                                    type="button"
                                    onClick={() => {
                                      const next = [...editingService.parameters];
                                      const curr = p.formula || '';
                                      next[idx] = {
                                        ...p,
                                        isCalculated: true,
                                        formula: `${curr}${curr ? ' ' : ''}{${other.id}}`,
                                      };
                                      setEditingService({ ...editingService, parameters: next });
                                    }}
                                    title={`Insert {${other.id}} (${other.name})`}
                                    className="px-1.5 py-0.5 text-[10px] font-mono bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100"
                                  >
                                    +{other.name.slice(0, 12)}
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-slate-200 pt-3 space-y-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Clinical Interpretation Rules
                </span>
                <div className="grid grid-cols-1 gap-2">
                  <input
                    value={editingService.interpretations.normal}
                    onChange={(e) =>
                      setEditingService({
                        ...editingService,
                        interpretations: {
                          ...editingService.interpretations,
                          normal: e.target.value,
                        },
                      })
                    }
                    placeholder="Normal interpretation"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    value={editingService.interpretations.abnormalLow}
                    onChange={(e) =>
                      setEditingService({
                        ...editingService,
                        interpretations: {
                          ...editingService.interpretations,
                          abnormalLow: e.target.value,
                        },
                      })
                    }
                    placeholder="Low interpretation"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    value={editingService.interpretations.abnormalHigh}
                    onChange={(e) =>
                      setEditingService({
                        ...editingService,
                        interpretations: {
                          ...editingService.interpretations,
                          abnormalHigh: e.target.value,
                        },
                      })
                    }
                    placeholder="High interpretation"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                  <input
                    value={editingService.interpretations.critical}
                    onChange={(e) =>
                      setEditingService({
                        ...editingService,
                        interpretations: {
                          ...editingService.interpretations,
                          critical: e.target.value,
                        },
                      })
                    }
                    placeholder="Critical panic interpretation"
                    className="px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setEditingService(null)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  {saving ? 'Saving...' : 'Save Service Definition'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
