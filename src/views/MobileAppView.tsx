import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BedDouble,
  Copy,
  Download,
  ExternalLink,
  FlaskConical,
  Link2,
  Lock,
  LogOut,
  MessageCircle,
  Monitor,
  Pill,
  Printer,
  Receipt,
  Scan,
  Search,
  Smartphone,
} from 'lucide-react';
import type { LabOrder, LimsDatabase, PermissionKey, StaffMember } from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { PWAInstallButton } from '../components/PWAInstallButton';
import { QrCodeSvg } from '../components/DocumentCodes';
import { apiRequest } from '../api/client';

interface MobileAppViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  activeFiscalYear: string;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  onOpenReport: (order: LabOrder, autoPrint?: boolean) => void;
  onOpenResults: (order: LabOrder) => void;
  onOpenBill?: (order: LabOrder) => void;
  onLogout?: () => void;
  onLockNow?: () => void;
}

export function MobileAppView({
  db,
  activeUser,
  activeFiscalYear,
  hasPerm,
  onUpdated,
  onOpenReport,
  onOpenResults,
  onOpenBill,
  onLogout,
  onLockNow,
}: MobileAppViewProps) {
  const defaultMode =
    activeUser.roleId === 'RADIOLOGIST'
      ? 'radiology'
      : activeUser.roleId === 'PHARMACY_CASHIER'
      ? 'pharmacy'
      : activeUser.roleId === 'LAB_TECH'
      ? 'lab'
      : 'admin';

  const [appMode, setAppMode] = useState<
    'admin' | 'pos' | 'pharmacy' | 'clinical' | 'radiology' | 'lab' | 'lookup'
  >(defaultMode);
  const [sendingWa, setSendingWa] = useState(false);
  const [lastWaUrl, setLastWaUrl] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [liveLanUrls, setLiveLanUrls] = useState<string[]>([]);

  useEffect(() => {
    fetch('/api/system/network-info')
      .then((r) => (r.ok ? r.json() : null))
      .then((info) => {
        if (info && Array.isArray(info.lanUrls)) {
          setLiveLanUrls(info.lanUrls);
        }
      })
      .catch(() => {});
  }, []);

  const fyOrders = useMemo(
    () => db.orders.filter((o) => !o.fiscalYear || o.fiscalYear === activeFiscalYear),
    [db.orders, activeFiscalYear]
  );

  const pendingValidation = useMemo(
    () => fyOrders.filter((o) => o.status !== 'Validated' && o.status !== 'Dispatched').slice(0, 6),
    [fyOrders]
  );

  const radiologyQueue = useMemo(
    () =>
      fyOrders
        .filter((o) =>
          o.tests.some((t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology')
        )
        .slice(0, 8),
    [fyOrders]
  );

  const isSuperAdmin = activeUser.roleId === 'SUPER_ADMIN';
  const lanIp =
    (db.settings?.moduleSettings?.lanServerHostIp &&
    db.settings.moduleSettings.lanServerHostIp !== '192.168.1.100'
      ? db.settings.moduleSettings.lanServerHostIp
      : '') ||
    liveLanUrls[0]?.replace(/^https?:\/\//, '').replace(/:\d+$/, '') ||
    db.settings?.moduleSettings?.lanServerHostIp ||
    (typeof window !== 'undefined' ? window.location.hostname : '192.168.1.50');
  const lanServerUrl = `http://${lanIp}:3000`;

  const appDownloadLinks = [
    {
      label: 'Android Mobile Kit (.zip)',
      href: '/api/downloads/android-app',
      filename: 'saptari-hospital-android-kit.zip',
      note: 'Capacitor/TWA build kit + Chrome instant WebAPK install',
    },
    {
      label: 'Windows App & Sync (.zip)',
      href: '/api/downloads/windows-installer',
      filename: 'saptari-hospital-windows-installer.zip',
      note: 'Desktop shortcut + 10-min 1-PC auto-sync backup',
    },
    {
      label: 'macOS 1-Click App (.zip)',
      href: '/api/downloads/mac-app',
      filename: 'saptari-hospital-mac-app.zip',
      note: 'Native Chrome/Edge Mac launcher + auto-backup shell script',
    },
    {
      label: 'Chrome Extension (.zip)',
      href: '/api/downloads/chrome-extension',
      filename: 'saptari-hospital-chrome-extension.zip',
      note: 'Manifest V3 1-click toolbar launcher',
    },
    {
      label: 'Admin Only: Full Source Code (.zip)',
      href: `/api/system/download-source?uid=${encodeURIComponent(activeUser.id)}`,
      filename: 'saptari-hospital-erp-full-source.zip',
      note: 'Shared hosting (cPanel / IISNode / VPS) complete codebase',
    },
  ];

  const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'https://saptarihospital.com';
  const shortLinks = [
    { key: 'patients', label: 'Patient Intake & Encounters', path: '/?go=patients' },
    { key: 'pos', label: 'Hospital Billing POS', path: '/?go=pos' },
    { key: 'pharmacy', label: 'Central Pharmacy POS', path: '/?go=pharmacy' },
    { key: 'doctor_portal', label: 'Doctor Clinical Console', path: '/?go=doctor_portal' },
    { key: 'nursing_portal', label: 'Nursing Care Station', path: '/?go=nursing_portal' },
    { key: 'gatepass', label: 'Gatepass & Clearance', path: '/?go=gatepass' },
  ];

  const handleCopyShortLink = async (key: string, fullUrl: string) => {
    try {
      await navigator.clipboard?.writeText(fullUrl);
      setCopiedKey(key);
      onUpdated(db, `Copied short link: ${fullUrl}`);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 2500);
    } catch {
      onUpdated(db, `Short link ready: ${fullUrl}`);
    }
  };

  const matchedOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return fyOrders.slice(0, 5);
    return fyOrders
      .filter(
        (o) =>
          o.patientName.toLowerCase().includes(q) ||
          o.accessionNumber.toLowerCase().includes(q) ||
          o.patientPhone.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [fyOrders, searchQuery]);

  const totalSalesNpr = useMemo(
    () => fyOrders.reduce((sum, o) => sum + o.totalAmount, 0),
    [fyOrders]
  );
  const totalPharmacyNpr = useMemo(
    () => (db.pharmacyInvoices || []).reduce((sum, inv) => sum + inv.totalNpr, 0),
    [db.pharmacyInvoices]
  );
  const totalCashBank = useMemo(
    () => db.accounts.reduce((sum, a) => sum + a.currentBalance, 0),
    [db.accounts]
  );

  const handleSendDailySalesWhatsApp = async () => {
    setSendingWa(true);
    try {
      const resp = await apiRequest<{
        db: LimsDatabase;
        whatsappUrl: string;
        log: any;
      }>('/api/whatsapp/send-daily-sales', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ recipientPhone: db.settings.adminWhatsAppNumber }),
      });
      setLastWaUrl(resp.whatsappUrl);
      onUpdated(
        resp.db,
        `Sent daily sales (${formatNpr(resp.log.totalSalesNpr)}) to Admin WhatsApp.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'WhatsApp dispatch failed.');
    } finally {
      setSendingWa(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            {isSuperAdmin
              ? '1-PC LAN Desktop Server, Mobile POS & Downloads'
              : '1-PC LAN Desktop Access, Mobile POS & Short Links'}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Engineered &amp; Developed by <strong>{db.settings.developedBy || 'Dr. Santosh Majhi'}</strong> · Connect client Windows PCs via LAN IP (<span className="font-mono">{lanServerUrl}</span>), Hospital POS, Pharmacy POS &amp; Clinical workspaces.
          </p>
        </div>

        {isSuperAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <PWAInstallButton />
            <a
              href="/api/downloads/android-app"
              download="saptari-hospital-android-kit.zip"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              Android Build Kit (.zip)
            </a>
          </div>
        )}
      </div>

      {/* All-Role App Switcher */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white border border-slate-200 p-1.5 rounded-xl w-fit">
        {[
          { id: 'admin', label: 'Admin Pulse', icon: Activity },
          { id: 'pos', label: 'Hospital POS', icon: Receipt },
          { id: 'pharmacy', label: 'Pharmacy POS', icon: Pill },
          { id: 'clinical', label: 'Doctor / Nurse', icon: BedDouble },
          { id: 'radiology', label: 'Radiology', icon: Scan },
          { id: 'lab', label: 'Pathology Bench', icon: FlaskConical },
          { id: 'lookup', label: 'Patient & PDF', icon: Search },
        ].map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setAppMode(tab.id as any)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                appMode === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Dual Shell Layout: Mobile Device Frame Preview + Live Action Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Interactive Handheld Companion Preview */}
        <div className="lg:col-span-5 flex justify-center">
          <div className="w-full max-w-sm bg-slate-900 rounded-[28px] p-3 border-4 border-slate-800 shadow-2xl">
            <div className="bg-slate-50 rounded-[20px] overflow-hidden flex flex-col min-h-[560px]">
              {/* App Header */}
              <div className="bg-blue-700 text-white px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Smartphone className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">Saptari Hospital App</div>
                    <div className="text-[10px] text-blue-100 truncate">
                      @{activeUser.username} · {adToBs(new Date()).formattedEn}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {onLockNow && (
                    <button
                      type="button"
                      onClick={onLockNow}
                      title="PIN Lock"
                      className="p-1.5 rounded bg-blue-800 hover:bg-blue-900 text-white"
                    >
                      <Lock className="w-3 h-3" />
                    </button>
                  )}
                  {onLogout && (
                    <button
                      type="button"
                      onClick={onLogout}
                      title="Logout"
                      className="p-1.5 rounded bg-rose-600 hover:bg-rose-700 text-white"
                    >
                      <LogOut className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Mobile Body */}
              <div className="flex-1 p-4 space-y-3 overflow-y-auto text-xs">
                {appMode === 'admin' && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="bg-white border border-slate-200 rounded-xl p-3">
                        <div className="text-[10px] text-slate-500">FY Revenue</div>
                        <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">
                          {formatNpr(totalSalesNpr)}
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3">
                        <div className="text-[10px] text-slate-500">Cash + Bank</div>
                        <div className="text-sm font-bold font-mono text-emerald-700 mt-0.5">
                          {formatNpr(totalCashBank)}
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3">
                        <div className="text-[10px] text-slate-500">Pending Lab</div>
                        <div className="text-sm font-bold font-mono text-amber-700 mt-0.5">
                          {pendingValidation.length} orders
                        </div>
                      </div>
                      <div className="bg-white border border-slate-200 rounded-xl p-3">
                        <div className="text-[10px] text-slate-500">Pharmacy Sales</div>
                        <div className="text-sm font-bold font-mono text-blue-700 mt-0.5">
                          {formatNpr(totalPharmacyNpr)}
                        </div>
                      </div>
                    </div>

                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 space-y-2">
                      <div className="font-semibold text-emerald-950 flex items-center gap-1.5">
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-700" />
                        Admin WhatsApp Daily Sales
                      </div>
                      <div className="text-[11px] text-emerald-800 font-mono">
                        Target: {db.settings.adminWhatsAppNumber}
                      </div>
                      <button
                        type="button"
                        disabled={sendingWa}
                        onClick={handleSendDailySalesWhatsApp}
                        className="w-full py-2 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {sendingWa ? 'Dispatching...' : 'Send Today Sales to WhatsApp'}
                      </button>
                      {lastWaUrl && (
                        <a
                          href={lastWaUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full inline-flex items-center justify-center gap-1 py-1.5 bg-white text-emerald-700 border border-emerald-300 rounded-lg font-medium"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open WhatsApp Message
                        </a>
                      )}
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                      <div className="font-semibold text-slate-900">Admitted IPD &amp; ER Snapshot</div>
                      {(db.ipdAdmissions || []).filter((a) => a.disposition === 'Admitted').slice(0, 3).map((adm) => (
                        <div
                          key={adm.id}
                          className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 last:border-0"
                        >
                          <span className="truncate pr-2 text-slate-700">
                            {adm.patientName} ({adm.currentBedLabel})
                          </span>
                          <span className="font-mono font-semibold text-slate-900">
                            {formatNpr(adm.creditLimitNpr || 25000)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {appMode === 'pharmacy' && (
                  <div className="space-y-2.5">
                    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500">
                          {db.settings?.moduleSettings?.pharmacyEntityName || 'Saptari Hospital Pharmacy'}
                        </div>
                        <div className="font-mono font-bold text-slate-900">
                          {formatNpr(totalPharmacyNpr)}
                        </div>
                      </div>
                      <Pill className="w-5 h-5 text-emerald-600" />
                    </div>
                    {(db.pharmacyInvoices || []).slice(0, 5).map((inv) => (
                      <div
                        key={inv.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 space-y-1"
                      >
                        <div className="flex justify-between font-mono text-[11px]">
                          <strong className="text-slate-900">{inv.invoiceNumber}</strong>
                          <span className="text-emerald-700">{formatNpr(inv.totalNpr)}</span>
                        </div>
                        <div className="font-medium text-slate-800">{inv.patientName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">
                          {inv.encounterLabel || inv.encounterType || 'Walk-In'} · {inv.paymentMode}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {appMode === 'clinical' && (
                  <div className="space-y-2.5">
                    <div className="font-semibold text-slate-900">
                      Active Clinical Encounters ({(db.opdVisits || []).length} OPD · {(db.ipdAdmissions || []).filter((a) => a.disposition === 'Admitted').length} IPD)
                    </div>
                    {(db.opdVisits || []).slice(0, 4).map((v) => (
                      <div key={v.id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-1">
                        <div className="flex justify-between font-mono text-[11px]">
                          <strong className="text-blue-700">{v.tokenNumber}</strong>
                          <span className="text-slate-500">{v.disposition}</span>
                        </div>
                        <div className="font-medium text-slate-900">{v.patientName}</div>
                        <div className="text-[11px] text-slate-500">
                          {v.department} · {v.consultingDoctor}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {appMode === 'radiology' && (
                  <div className="space-y-2.5">
                    <div className="font-semibold text-slate-900">
                      Radiology Studies Queue ({radiologyQueue.length})
                    </div>
                    {radiologyQueue.map((o) => (
                      <div
                        key={o.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5"
                      >
                        <div className="flex justify-between font-mono text-[11px]">
                          <strong className="text-indigo-700">{o.accessionNumber}</strong>
                          <span className="text-slate-500">
                            {o.tests.map((t) => t.modality || 'RAD').join(', ')}
                          </span>
                        </div>
                        <div className="font-medium text-slate-900">{o.patientName}</div>
                        <div className="flex gap-2 pt-1">
                          {(hasPerm('radiology.report') || hasPerm('results.validate')) && (
                            <button
                              type="button"
                              onClick={() => onOpenResults(o)}
                              className="flex-1 py-2 bg-indigo-600 text-white rounded-lg font-medium"
                            >
                              Report / Verify Study
                            </button>
                          )}
                          {hasPerm('reports.print') && (
                            <button
                              type="button"
                              onClick={() => onOpenReport(o, true)}
                              className="px-3 py-2 border border-slate-300 rounded-lg text-slate-700"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {appMode === 'pos' && (
                  <div className="space-y-2.5">
                    <div className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-500">Recent POS Receipts</div>
                        <div className="font-mono font-bold text-slate-900">
                          {formatNpr(totalSalesNpr)}
                        </div>
                      </div>
                      <Receipt className="w-5 h-5 text-blue-600" />
                    </div>
                    {fyOrders.slice(0, 5).map((o) => (
                      <div
                        key={o.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5"
                      >
                        <div className="flex justify-between font-mono text-[11px]">
                          <strong className="text-slate-900">{o.invoiceNumber}</strong>
                          <span className="text-emerald-700">{formatNpr(o.totalAmount)}</span>
                        </div>
                        <div className="font-medium text-slate-800">{o.patientName}</div>
                        <div className="flex gap-2 pt-1">
                          {onOpenBill && (
                            <button
                              type="button"
                              onClick={() => onOpenBill(o)}
                              className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg font-medium"
                            >
                              Print POS Bill
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenReport(o, true)}
                            className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700"
                          >
                            Report PDF
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {appMode === 'lab' && (
                  <div className="space-y-2.5">
                    <div className="font-semibold text-slate-900">
                      Pending Validation Queue ({pendingValidation.length})
                    </div>
                    {pendingValidation.map((o) => (
                      <div
                        key={o.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 space-y-1.5"
                      >
                        <div className="flex justify-between font-mono text-[11px]">
                          <strong className="text-blue-700">{o.accessionNumber}</strong>
                          <span className="text-amber-700">{o.status}</span>
                        </div>
                        <div className="font-medium text-slate-900">{o.patientName}</div>
                        <div className="flex gap-2 pt-1">
                          {(hasPerm('results.enter') || hasPerm('results.validate')) && (
                            <button
                              type="button"
                              onClick={() => onOpenResults(o)}
                              className="flex-1 py-1.5 bg-blue-600 text-white rounded-lg font-medium"
                            >
                              Open Bench / Validate
                            </button>
                          )}
                          {hasPerm('reports.print') && (
                            <button
                              type="button"
                              onClick={() => onOpenReport(o, true)}
                              className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-700"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {appMode === 'lookup' && (
                  <div className="space-y-2.5">
                    <input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search patient, accession, phone..."
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs"
                    />
                    {matchedOrders.map((o) => (
                      <div
                        key={o.id}
                        className="bg-white border border-slate-200 rounded-xl p-3 space-y-1"
                      >
                        <div className="flex justify-between font-mono text-[11px]">
                          <strong className="text-slate-900">{o.accessionNumber}</strong>
                          <span className="text-emerald-700">{formatNpr(o.totalAmount)}</span>
                        </div>
                        <div className="font-medium text-slate-900">
                          {o.patientName} ({o.patientAge} {o.patientAgeType})
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {adToBs(o.orderedAt).formattedEn} · {o.status}
                        </div>
                        {hasPerm('reports.print') && (
                          <button
                            type="button"
                            onClick={() => onOpenReport(o, true)}
                            className="mt-1 w-full inline-flex items-center justify-center gap-1 py-1.5 bg-slate-900 text-white rounded-lg text-[11px] font-medium"
                          >
                            <Printer className="w-3 h-3" />
                            1-Click Print Report
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Mobile Footer Attribution */}
              <div className="bg-white border-t border-slate-200 px-4 py-2 text-center text-[10px] text-slate-500">
                Engineered &amp; Developed by <strong className="text-slate-800">{db.settings.developedBy || 'Dr. Santosh Majhi'}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Right Companion Controls, 1-PC LAN Windows Access & Admin-Only Downloads */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1-PC Desktop Server & Windows Client Access by IP */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-blue-600 shrink-0" />
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    1-Computer Desktop Server &amp; Windows Client LAN Access
                  </h2>
                  <p className="text-xs text-slate-500">
                    Run ERP on 1 host PC and connect all counters, wards, pharmacy &amp; lab Windows PCs over LAN IP.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyShortLink('lan-server', lanServerUrl)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedKey === 'lan-server' ? 'Copied LAN URL' : 'Copy Server IP URL'}
              </button>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="space-y-1 flex-1 min-w-[220px]">
                <div className="font-mono font-bold text-blue-700 text-sm">{lanServerUrl}</div>
                {liveLanUrls.length > 0 && (
                  <div className="font-mono text-[11px] text-emerald-700">
                    Active Wi-Fi IP(s): {liveLanUrls.join(' · ')}
                  </div>
                )}
                <div className="text-slate-600">
                  Run <code className="px-1 py-0.5 bg-white border rounded font-mono">Start-SHPL-Windows-Server.bat</code> on 1 Windows PC server. On any Windows, Android, or iOS device on the same Wi-Fi: open Chrome &rarr; enter <strong>{lanServerUrl}</strong> &rarr; tap <em>Install SHPL</em> / <em>Add to Home Screen</em>.
                </div>
              </div>
              <div className="p-1.5 bg-white border border-slate-200 rounded shrink-0">
                <QrCodeSvg value={lanServerUrl} size={56} />
              </div>
            </div>
          </div>

          {isSuperAdmin && (
            <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Super Admin Only: Multi-Platform Downloads &amp; Full Source Code
                  </h2>
                  <p className="text-xs text-slate-500">
                    Visible exclusively to Super Admin accounts. Instant WebAPK install above or download Windows/Mac/Chrome/Source kits below.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                {appDownloadLinks.map((dl) => (
                  <a
                    key={dl.href}
                    href={dl.href}
                    download={dl.filename}
                    className="p-3 border border-slate-200 rounded-lg bg-slate-50/70 hover:bg-blue-50 hover:border-blue-300 flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{dl.label}</div>
                      <div className="text-[11px] text-slate-500 truncate">{dl.note}</div>
                    </div>
                    <Download className="w-4 h-4 text-blue-600 shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Copyable Short Links + QR Codes */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-blue-600" />
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  1-Tap Module Short Links &amp; QR Codes
                </h2>
                <p className="text-xs text-slate-500">
                  Scan from any hospital ward tablet or share direct bookmark links (auto-opens the target module).
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              {shortLinks.map((lnk) => {
                const fullUrl = `${baseOrigin}${lnk.path}`;
                return (
                  <div
                    key={lnk.key}
                    className="p-3 border border-slate-200 rounded-lg flex items-center justify-between gap-3 bg-slate-50/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1 bg-white border border-slate-200 rounded shrink-0">
                        <QrCodeSvg value={fullUrl} size={46} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{lnk.label}</div>
                        <div className="font-mono text-[11px] text-blue-700 truncate">{lnk.path}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleCopyShortLink(lnk.key, fullUrl)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 shrink-0"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedKey === lnk.key ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">
              Admin WhatsApp Dispatch History ({db.whatsappLogs.length})
            </h3>
            <div className="space-y-2 max-h-56 overflow-y-auto text-xs">
              {db.whatsappLogs.map((w) => (
                <div
                  key={w.id}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1"
                >
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-semibold text-emerald-700">
                      {w.recipientPhone} · {formatNpr(w.totalSalesNpr)}
                    </span>
                    <span className="text-slate-500">{w.bsDate}</span>
                  </div>
                  <div className="text-slate-700">{w.messagePreview}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
