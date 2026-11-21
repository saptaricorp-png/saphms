import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  Palette,
  Plus,
  QrCode,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import type {
  DocumentDesignTemplate,
  DocumentTemplateScope,
  DocumentTemplateStyle,
  FacilityEntityType,
  LimsDatabase,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { BarcodeSvg, QrCodeSvg } from '../components/DocumentCodes';
import { downloadOrderReportPdf, downloadPosBillPdf } from '../utils/pdfGenerator';
import { apiRequest } from '../api/client';

interface DocumentDesignsViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  initialSearchQuery?: string;
}

const ENTITY_TYPES: FacilityEntityType[] = [
  'Hospital',
  'Main Lab',
  'Clinic',
  'Polyclinic',
  'Medical Hall',
  'Custom',
];

const SCOPE_OPTIONS: Array<{ value: DocumentTemplateScope; label: string }> = [
  { value: 'BOTH', label: 'All Documents (Report & Bill)' },
  { value: 'REPORT', label: 'Lab & Radiology Reports' },
  { value: 'BILL', label: 'Hospital POS Bills & Receipts' },
  { value: 'PHARMACY', label: 'Pharmacy Counter Invoices' },
  { value: 'ADMISSION_SLIP', label: 'IPD Admission / Fee Slips' },
  { value: 'OTHERS', label: 'Certificates / OPD / Others' },
];

const STYLE_OPTIONS: Array<{ value: DocumentTemplateStyle; label: string }> = [
  { value: 'CLASSIC_CLINICAL', label: '1. Classic Clinical (Blue Banner)' },
  { value: 'COMPACT_A5', label: '2. Compact A5 Full Fit' },
  { value: 'HOSPITAL_PRO', label: '3. Hospital Pro (Emerald Strip)' },
  { value: 'MODERN_MINIMAL', label: '4. Modern Minimal Monochrome' },
  { value: 'EXECUTIVE_BORDERED', label: '5. Executive Bordered Card' },
  { value: 'NEPAL_GOVT_STYLE', label: '6. Nepal Institutional Crimson' },
  { value: 'CLEAN_DUOTONE', label: '7. Clean Duotone Cyan' },
  { value: 'PHARMACY_SLIP', label: '8. Pharmacy Counter Slip' },
  { value: 'EMERGENCY_FAST', label: '9. Emergency / Urgent Thermal' },
  { value: 'CERTIFICATE_GOLD', label: '10. Gold Certificate / Formal' },
];

export function DocumentDesignsView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: DocumentDesignsViewProps) {
  const canManage = hasPerm('designs.manage');
  const [selectedId, setSelectedId] = useState<string>(db.documentDesigns[0]?.id || 'dsn-main');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [scopeFilter, setScopeFilter] = useState<string>('ALL');
  const [previewMode, setPreviewMode] = useState<'REPORT' | 'BILL'>('REPORT');
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState('Hospital Admin dynamic bill & report branding update');

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const initialTemplate = useMemo(
    () => db.documentDesigns.find((d) => d.id === selectedId) || db.documentDesigns[0],
    [db.documentDesigns, selectedId]
  );

  const [draft, setDraft] = useState<DocumentDesignTemplate>(() => ({ ...initialTemplate }));

  const selectTemplate = (tpl: DocumentDesignTemplate) => {
    setSelectedId(tpl.id);
    setDraft({ ...tpl });
    if (tpl.targetScope === 'BILL' || tpl.targetScope === 'PHARMACY' || tpl.targetScope === 'ADMISSION_SLIP') {
      setPreviewMode('BILL');
    } else if (tpl.targetScope === 'REPORT') {
      setPreviewMode('REPORT');
    }
  };

  const handleNewBlank = () => {
    setSelectedId('');
    setDraft({
      id: '',
      name: 'New A5 Hospital Design',
      entityType: 'Hospital',
      centerId: null,
      targetScope: 'BOTH',
      templateStyle: 'COMPACT_A5',
      headerTitle: db.settings.labName,
      headerTitleNp: db.settings.labNameNp,
      subTitle: db.settings.accreditationLine,
      addressText: db.settings.addressLine,
      phoneText: db.settings.contactLine,
      panNumber: db.settings.panNumber,
      licenseNumber: 'NPHL-SAP-083',
      billHeading: 'OFFICIAL TAX INVOICE / HOSPITAL BILL',
      reportHeading: 'CLINICAL DIAGNOSTIC LABORATORY REPORT',
      radiologyHeading: 'DEPARTMENT OF RADIOLOGY & DIAGNOSTIC IMAGING REPORT',
      topBannerText: 'Verified Electronic Document',
      footerDisclaimerText:
        'Electronically signed & verified report. Results relate to sample examined.',
      footerSignatureTitle: 'Consultant Pathologist / Medical Officer',
      watermarkText: 'VERIFIED',
      showWatermark: true,
      accentColor: '#0f766e',
      paperFormat: 'A5',
      showLetterheadBanner: true,
      showQrCode: true,
      qrPayloadMode: 'VERIFY_URL',
      showBarcode: true,
      barcodeSource: 'ACCESSION',
      showNepaliDate: true,
      showPan: true,
      showCollectionCenter: false,
      showDoctorRef: true,
      showTatBadge: true,
      updatedAt: new Date().toISOString(),
      updatedBy: activeUser.fullName,
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    if (!reason.trim()) {
      onUpdated(db, 'Please enter an audit Reason for this template change.');
      return;
    }
    setSaving(true);
    try {
      const resp = await apiRequest<{ design: DocumentDesignTemplate; db: LimsDatabase }>(
        '/api/designs',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ ...draft, centerId: null, reason: reason.trim() }),
        }
      );
      setSelectedId(resp.design.id);
      setDraft({ ...resp.design });
      onUpdated(resp.db, `Saved dynamic template '${resp.design.name}' (${resp.design.paperFormat}).`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save design template.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canManage || id === 'dsn-main') return;
    if (!reason.trim()) {
      onUpdated(db, 'Please enter a Reason before deleting a design template.');
      return;
    }
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(`/api/designs/${id}`, activeUser.id, {
        method: 'DELETE',
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const fallback = resp.db.documentDesigns[0];
      if (fallback) {
        setSelectedId(fallback.id);
        setDraft({ ...fallback });
      }
      onUpdated(resp.db, 'Deleted document design template.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Delete failed.');
    }
  };

  if (!canManage) {
    return (
      <div className="bg-white border border-rose-200 rounded-xl p-8 max-w-2xl mx-auto text-center space-y-3">
        <ShieldAlert className="w-8 h-8 text-rose-600 mx-auto" />
        <h2 className="text-lg font-semibold text-slate-900">
          Hospital Admin Design Studio
        </h2>
        <p className="text-sm text-slate-600">
          Bill, Report, Pharmacy &amp; Admission Slip templates (A5 / A4 / 80mm Thermal) are controlled exclusively by Hospital Admin (<strong>designs.manage</strong>).
        </p>
      </div>
    );
  }

  const sampleOrder = db.orders[0];
  const qrDemoPayload =
    draft.qrPayloadMode === 'PATIENT_BILL'
      ? `INV:${sampleOrder?.invoiceNumber || 'INV-2083-1045'}|ACC:${sampleOrder?.accessionNumber || 'LAB-2083-1045'}|PAN:${draft.panNumber}`
      : draft.qrPayloadMode === 'ACCESSION_PAN'
      ? `ACC:${sampleOrder?.accessionNumber || 'LAB-2083-1045'}|PAN:${draft.panNumber}|HOSP:${draft.headerTitle}`
      : `https://saptarihospital.com/?verify=${sampleOrder?.accessionNumber || 'LAB-2083-1045'}&pan=${draft.panNumber}`;

  const barDemoValue =
    draft.barcodeSource === 'INVOICE'
      ? sampleOrder?.invoiceNumber || 'INV-2083-1045'
      : sampleOrder?.accessionNumber || 'LAB-2083-1045';

  const hospitalLogo = db.settings.moduleSettings?.hospitalLogoDataUrl;
  const sigBoxes = db.settings.moduleSettings?.signatureBoxes || [];
  const activeSig =
    previewMode === 'BILL'
      ? sigBoxes.find((s) => s.roleKey === 'HOSPITAL_CASHIER')
      : sigBoxes.find((s) => s.roleKey === 'PATHOLOGIST') || sigBoxes.find((s) => s.roleKey === 'DOCTOR');

  const isExecutive = draft.templateStyle === 'EXECUTIVE_BORDERED' || draft.templateStyle === 'CERTIFICATE_GOLD';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Print Design Studio — 10 Templates &amp; Side-by-Side Preview
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Select &amp; customize report, POS bill, pharmacy invoice, and IPD admission slip templates in <strong>A5 Portrait Full</strong>, <strong>A4 Portrait</strong>, or <strong>80mm Thermal</strong> with live preview beside the controls.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg"
          >
            <option value="ALL">All Scopes ({db.documentDesigns.length})</option>
            {SCOPE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search template, style, A5..."
              className="pl-8 pr-7 py-2 text-xs bg-white border border-slate-300 rounded-lg w-52 focus:outline-none focus:border-blue-600"
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
            onClick={handleNewBlank}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New Template
          </button>
        </div>
      </div>

      {/* Template Selector Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {db.documentDesigns
          .filter((tpl) => {
            if (scopeFilter !== 'ALL' && tpl.targetScope !== scopeFilter) return false;
            const q = searchTerm.trim().toLowerCase();
            if (!q) return true;
            return `${tpl.name} ${tpl.targetScope} ${tpl.paperFormat} ${tpl.templateStyle || ''} ${tpl.headerTitle}`
              .toLowerCase()
              .includes(q);
          })
          .map((tpl) => {
            const active = tpl.id === draft.id;
            return (
              <button
                key={tpl.id}
                type="button"
                onClick={() => selectTemplate(tpl)}
                className={`text-left p-3 rounded-xl border transition-colors ${
                  active ? 'border-blue-600 bg-blue-50/70' : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center justify-between gap-1 text-[10px] font-mono">
                  <span style={{ color: tpl.accentColor }} className="font-semibold truncate">
                    {tpl.targetScope}
                  </span>
                  <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-700 shrink-0">
                    {tpl.paperFormat}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-900 truncate mt-1">{tpl.name}</div>
                <div className="text-[10px] text-slate-500 truncate mt-0.5">
                  {tpl.templateStyle || 'CLASSIC_CLINICAL'}
                </div>
              </button>
            );
          })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Editor Controls */}
        <form
          onSubmit={handleSave}
          className="xl:col-span-6 bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs"
        >
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-2 font-semibold text-sm text-slate-900">
              <Palette className="w-4 h-4 text-blue-600" />
              {draft.id ? `Editing: ${draft.name}` : 'Create New Dynamic Template'}
            </div>
            {draft.id && draft.id !== 'dsn-main' && (
              <button
                type="button"
                onClick={() => handleDelete(draft.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Template Name *</label>
              <input
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Hospital Facility Type</label>
              <select
                value={draft.entityType}
                onChange={(e) =>
                  setDraft({ ...draft, entityType: e.target.value as FacilityEntityType })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Document Category Scope</label>
              <select
                value={draft.targetScope}
                onChange={(e) =>
                  setDraft({ ...draft, targetScope: e.target.value as DocumentTemplateScope })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                {SCOPE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700 mb-1">Visual Design Layout Style (1–10)</label>
              <select
                value={draft.templateStyle || 'CLASSIC_CLINICAL'}
                onChange={(e) =>
                  setDraft({ ...draft, templateStyle: e.target.value as DocumentTemplateStyle })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                {STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Hospital Header Title (English) *</label>
              <input
                required
                value={draft.headerTitle}
                onChange={(e) => setDraft({ ...draft, headerTitle: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">शीर्षक (Nepali Hospital Title)</label>
              <input
                value={draft.headerTitleNp}
                onChange={(e) => setDraft({ ...draft, headerTitleNp: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Accreditation / Subtitle</label>
              <input
                value={draft.subTitle}
                onChange={(e) => setDraft({ ...draft, subTitle: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Address Text</label>
              <input
                value={draft.addressText}
                onChange={(e) => setDraft({ ...draft, addressText: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Phone / Email Text</label>
              <input
                value={draft.phoneText}
                onChange={(e) => setDraft({ ...draft, phoneText: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">PAN Number</label>
              <input
                value={draft.panNumber}
                onChange={(e) => setDraft({ ...draft, panNumber: e.target.value })}
                className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">License / NPHL Reg</label>
              <input
                value={draft.licenseNumber}
                onChange={(e) => setDraft({ ...draft, licenseNumber: e.target.value })}
                className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Top Banner Strip Text</label>
              <input
                value={draft.topBannerText}
                onChange={(e) => setDraft({ ...draft, topBannerText: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Bill Heading Text</label>
              <input
                value={draft.billHeading}
                onChange={(e) => setDraft({ ...draft, billHeading: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Lab Report Heading</label>
              <input
                value={draft.reportHeading}
                onChange={(e) => setDraft({ ...draft, reportHeading: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Radiology Report Heading</label>
              <input
                value={draft.radiologyHeading}
                onChange={(e) => setDraft({ ...draft, radiologyHeading: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Paper Format &amp; Size</label>
              <select
                value={draft.paperFormat}
                onChange={(e) =>
                  setDraft({ ...draft, paperFormat: e.target.value as DocumentDesignTemplate['paperFormat'] })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white font-mono"
              >
                <option value="A5">A5 Portrait Full (148 × 210 mm)</option>
                <option value="A4">A4 Portrait (210 × 297 mm)</option>
                <option value="THERMAL_80MM">POS Thermal Roll (80 mm)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Brand Accent Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.accentColor}
                  onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
                  className="h-8 w-12 rounded border border-slate-300"
                />
                <input
                  value={draft.accentColor}
                  onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
                  className="flex-1 px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">QR Payload Mode</label>
              <select
                value={draft.qrPayloadMode}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    qrPayloadMode: e.target.value as DocumentDesignTemplate['qrPayloadMode'],
                  })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="VERIFY_URL">Verification URL + Accession</option>
                <option value="PATIENT_BILL">Patient + Bill NPR + BS Date</option>
                <option value="ACCESSION_PAN">Accession + PAN + Hospital</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Barcode Source</label>
              <select
                value={draft.barcodeSource}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    barcodeSource: e.target.value as DocumentDesignTemplate['barcodeSource'],
                  })
                }
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
              >
                <option value="ACCESSION">Lab Accession ID (LAB-...)</option>
                <option value="INVOICE">POS Invoice ID (INV-...)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Watermark Text</label>
              <input
                value={draft.watermarkText}
                onChange={(e) => setDraft({ ...draft, watermarkText: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Signature Title</label>
              <input
                value={draft.footerSignatureTitle}
                onChange={(e) => setDraft({ ...draft, footerSignatureTitle: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-medium text-slate-700 mb-1">Footer Disclaimer Text</label>
              <input
                value={draft.footerDisclaimerText}
                onChange={(e) => setDraft({ ...draft, footerDisclaimerText: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Toggle Matrix */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200">
            {(
              [
                ['showQrCode', 'QR Code'],
                ['showBarcode', 'Code-39 Barcode'],
                ['showLetterheadBanner', 'Letterhead'],
                ['showWatermark', 'Watermark'],
                ['showNepaliDate', 'Nepali BS Date'],
                ['showPan', 'PAN Number'],
                ['showTatBadge', 'TAT Badge'],
                ['showDoctorRef', 'Referring Dr.'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="inline-flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(draft[field])}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="pt-2 border-t border-slate-200">
            <label className="block font-medium text-slate-700 mb-1">
              Hospital Admin Audit Reason *
            </label>
            <input
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Updated Saptari Hospital A5 bill & report template"
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {saving ? 'Saving Template...' : 'Save & Apply Design'}
            </button>
          </div>
        </form>

        {/* Right Side-by-Side Live Preview Panel */}
        <div className="xl:col-span-6 space-y-4 xl:sticky xl:top-20">
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
              <QrCode className="w-4 h-4 text-blue-600" />
              Side-by-Side Preview ({draft.paperFormat} · {draft.templateStyle || 'CLASSIC_CLINICAL'})
            </div>
            <div className="flex items-center gap-2">
              <div className="flex p-0.5 bg-slate-100 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setPreviewMode('REPORT')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                    previewMode === 'REPORT' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Report View
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('BILL')}
                  className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap ${
                    previewMode === 'BILL' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Bill / Slip View
                </button>
              </div>
              {sampleOrder && (
                <button
                  type="button"
                  onClick={() =>
                    previewMode === 'REPORT'
                      ? void downloadOrderReportPdf(sampleOrder, db.settings, draft, 'with')
                      : void downloadPosBillPdf(sampleOrder, db.settings, draft)
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  Test PDF ({draft.paperFormat})
                </button>
              )}
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex justify-center overflow-x-auto">
            <div
              className={`bg-white shadow-sm relative overflow-hidden transition-all ${
                draft.paperFormat === 'THERMAL_80MM'
                  ? 'w-[300px] p-3.5'
                  : draft.paperFormat === 'A5'
                  ? 'w-[440px] min-h-[600px] p-5'
                  : 'w-full min-h-[620px] p-6'
              } ${isExecutive ? 'border-2' : 'border border-slate-300'} rounded-lg`}
              style={isExecutive ? { borderColor: draft.accentColor } : undefined}
            >
              {draft.showWatermark && draft.watermarkText && (
                <div className="pointer-events-none select-none absolute inset-0 flex items-center justify-center opacity-[0.06] font-extrabold text-3xl uppercase -rotate-24">
                  {draft.watermarkText}
                </div>
              )}

              <div className="relative z-10 space-y-3 text-xs h-full flex flex-col justify-between">
                <div className="space-y-3">
                  {draft.topBannerText && (
                    <div
                      className="text-white text-[9.5px] font-semibold text-center py-1 px-2 rounded"
                      style={{ backgroundColor: draft.accentColor }}
                    >
                      {draft.topBannerText}
                    </div>
                  )}

                  {draft.showLetterheadBanner && (
                    <div
                      className="pb-2.5 border-b-2 flex items-start justify-between gap-2.5"
                      style={{ borderColor: draft.accentColor }}
                    >
                      <div className="flex items-start gap-2 min-w-0 flex-1">
                        {hospitalLogo && draft.paperFormat !== 'THERMAL_80MM' && (
                          <img
                            src={hospitalLogo}
                            alt="Hospital Logo"
                            className="w-9 h-9 object-contain shrink-0 rounded border border-slate-200 p-0.5"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          {draft.headerTitleNp && (
                            <div className="text-[10px] font-semibold text-slate-700">
                              {draft.headerTitleNp}
                            </div>
                          )}
                          <div
                            className="text-sm font-bold leading-tight"
                            style={{ color: draft.accentColor }}
                          >
                            {draft.headerTitle}
                          </div>
                          <div className="text-[10px] text-slate-700">{draft.subTitle}</div>
                          <div className="text-[9.5px] text-slate-600 mt-0.5">
                            {draft.addressText}
                            {draft.showPan && ` · PAN: ${draft.panNumber}`}
                          </div>
                          <div className="text-[9.5px] text-slate-500">{draft.phoneText}</div>
                        </div>
                      </div>
                      {draft.paperFormat !== 'THERMAL_80MM' && (
                        <div className="flex items-start gap-1.5 shrink-0">
                          {draft.showBarcode && <BarcodeSvg value={barDemoValue} width={88} height={20} />}
                          {draft.showQrCode && <QrCodeSvg value={qrDemoPayload} size={46} />}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="text-center font-bold uppercase tracking-wide text-slate-900 text-[11px]">
                    {previewMode === 'BILL' ? draft.billHeading : draft.reportHeading}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 p-2 bg-slate-50 border border-slate-200 rounded text-[10.5px]">
                    <div>
                      Patient: <strong>{sampleOrder?.patientName || 'Ram Prasad Sharma'}</strong>
                    </div>
                    <div className="text-right font-mono">
                      {previewMode === 'BILL'
                        ? sampleOrder?.invoiceNumber || 'INV-2083-1045'
                        : sampleOrder?.accessionNumber || 'LAB-2083-1045'}
                    </div>
                    {draft.showDoctorRef && (
                      <div>Ref: {sampleOrder?.referringDoctor || 'Dr. Anil Koirala'}</div>
                    )}
                    {draft.showNepaliDate && (
                      <div className="text-right font-mono">BS 2083-08-05 · 10:15</div>
                    )}
                  </div>

                  <div className="border border-slate-200 rounded p-2.5 text-[10.5px] text-slate-600 space-y-1">
                    <div className="font-semibold text-slate-800">
                      {previewMode === 'BILL'
                        ? 'Sample Bill Lines (A5 Portrait Full Scale)'
                        : 'Sample Investigation Table & Auto-Calculated Parameters'}
                    </div>
                    {previewMode === 'BILL' ? (
                      <div className="flex justify-between font-mono text-[10px]">
                        <span>Complete Blood Count (CBC)</span>
                        <strong>रू 550.00</strong>
                      </div>
                    ) : (
                      <div className="flex justify-between font-mono text-[10px]">
                        <span>Hemoglobin (Hb)</span>
                        <strong>14.2 g/dL (Normal)</strong>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-200 flex items-end justify-between text-[9.5px] text-slate-600">
                  <div className="max-w-[200px]">
                    <div>{draft.footerDisclaimerText}</div>
                  </div>
                  <div className="text-right">
                    {activeSig?.signatureDataUrl && (
                      <img
                        src={activeSig.signatureDataUrl}
                        alt={activeSig.label}
                        className="h-7 max-w-[100px] object-contain ml-auto mb-0.5"
                      />
                    )}
                    <div className="font-semibold text-slate-900">
                      /s/ {activeSig?.signerName || draft.footerSignatureTitle}
                    </div>
                    <div className="text-[8.5px] text-slate-500">
                      {activeSig?.designation || draft.entityType}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

