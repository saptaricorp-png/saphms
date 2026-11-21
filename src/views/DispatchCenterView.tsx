import React, { useEffect, useState } from 'react';
import { Mail, Save, Search, Send, Settings, X } from 'lucide-react';
import type { LimsDatabase, PermissionKey, StaffMember } from '../types/lims';
import { apiRequest } from '../api/client';

interface DispatchCenterViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function DispatchCenterView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: DispatchCenterViewProps) {
  const canEmail = hasPerm('reports.email');
  const canApi = hasPerm('reports.api_send');
  const canSettings = hasPerm('settings.manage');

  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [selectedOrderId, setSelectedOrderId] = useState(db.orders[0]?.id || '');
  const [targetWebhook, setTargetWebhook] = useState(db.settings.defaultWebhookUrl);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [selectedPayload, setSelectedPayload] = useState<string>(
    db.apiDispatches[0]?.requestPayload || ''
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [labName, setLabName] = useState(db.settings.labName);
  const [accred, setAccred] = useState(db.settings.accreditationLine);
  const [autoEmail, setAutoEmail] = useState(db.settings.autoEmailOnValidate);

  const handleDispatchApi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) return;
    setBusy(true);
    try {
      const resp = await apiRequest<{ db: any; dispatch: any }>(
        `/api/reports/${selectedOrderId}/send-api`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ targetUrl: targetWebhook }),
        }
      );
      setSelectedPayload(resp.dispatch.requestPayload);
      onUpdated(
        resp.db,
        `API Report dispatched to ${targetWebhook} (HTTP ${resp.dispatch.httpStatus} · ${resp.dispatch.latencyMs}ms).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'API dispatch failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleDispatchEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderId) return;
    setBusy(true);
    try {
      const resp = await apiRequest<{ db: any; email: any }>(
        `/api/reports/${selectedOrderId}/send-email`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ recipientEmail }),
        }
      );
      onUpdated(resp.db, `Email report sent to ${resp.email.recipientEmail}.`);
      setRecipientEmail('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Email send failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: any }>('/api/settings', activeUser.id, {
        method: 'PUT',
        body: JSON.stringify({
          labName,
          accreditationLine: accred,
          autoEmailOnValidate: autoEmail,
          defaultWebhookUrl: targetWebhook,
        }),
      });
      onUpdated(resp.db, 'Updated laboratory automation & letterhead settings.');
    } catch (err: any) {
      onUpdated(db, err.message || 'Settings update failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Automated Email Notifications &amp; API Report Dispatch
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Transmit structured HL7/FHIR-compatible JSON reports to collection center EMR endpoints and monitor automated patient email delivery.
          </p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search order, email, webhook..."
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
      </div>

      {/* Live Dispatch Runners + Automation Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* API Report Send Runner */}
        <form
          onSubmit={handleDispatchApi}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Send className="w-4 h-4 text-blue-600" />
            Live API Report Send (REST POST)
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Select Lab Order
            </label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono"
            >
              {db.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.accessionNumber} — {o.patientName} ({o.status})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Target Webhook / EMR Endpoint
            </label>
            <input
              value={targetWebhook}
              onChange={(e) => setTargetWebhook(e.target.value)}
              placeholder="/api/emr-webhook-receiver or https://..."
              className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Built-in EMR receiver at <code className="font-mono">/api/emr-webhook-receiver</code> accepts live HTTP POSTs.
            </p>
          </div>
          <button
            type="submit"
            disabled={!canApi || busy}
            className="w-full py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? 'Dispatching...' : 'Send JSON Report via API'}
          </button>
        </form>

        {/* Manual / Automated Email Runner */}
        <form
          onSubmit={handleDispatchEmail}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Mail className="w-4 h-4 text-blue-600" />
            Result Email Notification Dispatch
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Select Lab Order
            </label>
            <select
              value={selectedOrderId}
              onChange={(e) => setSelectedOrderId(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white font-mono"
            >
              {db.orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.accessionNumber} — {o.patientName} ({o.patientEmail || 'No email'})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Override Recipient Email (Optional)
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="Leave blank to use patient/center email"
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={!canEmail || busy}
            className="w-full py-2 text-xs font-medium text-slate-800 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 disabled:opacity-50"
          >
            Send Clinical Result Email
          </button>
        </form>

        {/* Global Automation & Letterhead Settings */}
        <form
          onSubmit={handleSaveSettings}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Settings className="w-4 h-4 text-blue-600" />
            Automation &amp; Letterhead Config
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Lab Header Name</label>
            <input
              disabled={!canSettings}
              value={labName}
              onChange={(e) => setLabName(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Accreditation Subtitle
            </label>
            <input
              disabled={!canSettings}
              value={accred}
              onChange={(e) => setAccred(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg disabled:bg-slate-100"
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              disabled={!canSettings}
              checked={autoEmail}
              onChange={(e) => setAutoEmail(e.target.checked)}
              className="rounded border-slate-300 text-blue-600"
            />
            Auto-send result email immediately on validation
          </label>
          {canSettings && (
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              <Save className="w-3.5 h-3.5" />
              Save Lab Config
            </button>
          )}
        </form>
      </div>

      {/* Email Notification History & API Dispatch Log */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-900">
              Email Notification Outbox ({db.emailNotifications.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
            {db.emailNotifications
              .filter((eml) => {
                const q = searchTerm.trim().toLowerCase();
                if (!q) return true;
                return `${eml.accessionNumber} ${eml.recipientEmail} ${eml.subject} ${eml.triggeredBy}`
                  .toLowerCase()
                  .includes(q);
              })
              .map((eml) => (
              <div key={eml.id} className="p-4 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-blue-700">
                    {eml.accessionNumber}
                  </span>
                  <span className="font-mono text-emerald-700 font-semibold">
                    ● {eml.status} ({eml.triggerType})
                  </span>
                </div>
                <div className="font-medium text-slate-900">{eml.subject}</div>
                <div className="text-slate-600">
                  To: <span className="font-mono">{eml.recipientEmail}</span>
                  {eml.ccEmail ? ` · CC: ${eml.ccEmail}` : ''}
                </div>
                <p className="text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 leading-relaxed">
                  {eml.bodyPreview}
                </p>
                <div className="text-[11px] font-mono text-slate-400">
                  {new Date(eml.timestamp).toLocaleString()} · By {eml.triggeredBy}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
            <h2 className="text-sm font-semibold text-slate-900">
              API Webhook Dispatch Log ({db.apiDispatches.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-100 max-h-[240px] overflow-y-auto">
            {db.apiDispatches
              .filter((d) => {
                const q = searchTerm.trim().toLowerCase();
                if (!q) return true;
                return `${d.accessionNumber} ${d.targetUrl} ${d.status} ${d.triggeredBy}`
                  .toLowerCase()
                  .includes(q);
              })
              .map((d) => (
              <div
                key={d.id}
                onClick={() => setSelectedPayload(d.requestPayload)}
                className="p-3.5 text-xs hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-slate-900">
                      {d.accessionNumber}
                    </span>
                    <span className="font-mono text-slate-500 truncate">{d.targetUrl}</span>
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                    {new Date(d.timestamp).toLocaleString()} · {d.latencyMs}ms · Resp: {d.responseBody.slice(0, 60)}
                  </div>
                </div>
                <span
                  className={`font-mono font-semibold shrink-0 ${
                    d.status === 'Delivered' ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  HTTP {d.httpStatus}
                </span>
              </div>
            ))}
          </div>
          {selectedPayload && (
            <div className="border-t border-slate-200 bg-slate-950 text-slate-100 p-4">
              <div className="text-[11px] font-mono text-slate-400 mb-1.5">
                Last Transmitted DiagnosticReport JSON Payload
              </div>
              <pre className="text-[11px] font-mono overflow-x-auto max-h-44 leading-relaxed">
                {selectedPayload}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
