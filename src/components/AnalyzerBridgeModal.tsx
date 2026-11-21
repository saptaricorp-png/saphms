import React, { useMemo, useState } from 'react';
import { CheckCircle2, Cpu, RefreshCw, Send, Server, X } from 'lucide-react';
import type {
  LabAnalyzerMachine,
  LabOrder,
  LimsDatabase,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';

interface AnalyzerBridgeModalProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  onClose: () => void;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
}

export function AnalyzerBridgeModal({
  db,
  activeUser,
  onClose,
  onUpdated,
}: AnalyzerBridgeModalProps) {
  const analyzers = db.analyzers || [];
  const queue = db.analyzerQueue || [];

  const [selectedOrderId, setSelectedOrderId] = useState<string>('');
  const [selectedAnalyzerId, setSelectedAnalyzerId] = useState<string>(analyzers[0]?.id || '');
  const [rawPacket, setRawPacket] = useState<string>('');
  const [applyNow, setApplyNow] = useState<boolean>(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editingEndpoints, setEditingEndpoints] = useState<Record<string, string>>({});

  const openPathologyOrders = useMemo(
    () =>
      (db.orders || []).filter(
        (o) =>
          o.status !== 'Validated' &&
          o.status !== 'Dispatched' &&
          o.tests.some((t) => t.serviceCategory !== 'RADIOLOGY' && t.department !== 'Radiology')
      ),
    [db.orders]
  );

  const handleBatchSyncAll = async () => {
    setBusyAction('sync-all');
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{
        syncedOrdersCount: number;
        totalAnalytesApplied: number;
        db: LimsDatabase;
      }>('/api/lab/analyzers/sync-all', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ queryOpenOrders: true }),
      });
      onUpdated(
        resp.db,
        resp.syncedOrdersCount > 0
          ? `Analyzer Bridge synced ${resp.syncedOrdersCount} order(s) (${resp.totalAnalytesApplied} analyte readings populated).`
          : 'All open pathology orders are already populated with analyzer results.'
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Batch analyzer sync failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleToggleAutoApply = async (machine: LabAnalyzerMachine) => {
    setBusyAction(`cfg-${machine.id}`);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/lab/analyzers/config', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          analyzerId: machine.id,
          autoApplyOnReceive: !machine.autoApplyOnReceive,
        }),
      });
      onUpdated(
        resp.db,
        `${machine.name}: Auto-Apply set to ${!machine.autoApplyOnReceive ? 'ON' : 'OFF'}.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to update analyzer setting.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveEndpoint = async (machine: LabAnalyzerMachine) => {
    const nextAddr = (editingEndpoints[machine.id] ?? machine.endpointAddress).trim();
    if (!nextAddr) return;
    setBusyAction(`addr-${machine.id}`);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>('/api/lab/analyzers/config', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          analyzerId: machine.id,
          endpointAddress: nextAddr,
        }),
      });
      onUpdated(resp.db, `Saved host endpoint ${nextAddr} for ${machine.code}.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save analyzer endpoint.');
    } finally {
      setBusyAction(null);
    }
  };

  const loadSampleFrame = (order: LabOrder, format: 'HL7' | 'ASTM') => {
    const pathTests = order.tests.filter(
      (t) => t.serviceCategory !== 'RADIOLOGY' && t.department !== 'Radiology'
    );
    const samplePairs: Array<{ code: string; value: number | string; unit: string }> = [];
    for (const ot of pathTests) {
      const srv = db.services.find((s) => s.id === ot.serviceId);
      for (const p of srv?.parameters || []) {
        if (p.formula) continue;
        const code = p.analyzerCode || p.id.replace(/^p-/, '').toUpperCase();
        if (p.resultType === 'QUALITATIVE') {
          samplePairs.push({
            code,
            value: p.normalQualitativeValues?.[0] || p.qualitativeOptions?.[0] || 'Negative',
            unit: '-',
          });
        } else {
          const min = order.patientGender === 'Female' ? p.refMinFemale : p.refMinMale;
          const max = order.patientGender === 'Female' ? p.refMaxFemale : p.refMaxMale;
          const mid = Number(((min + max) / 2).toFixed(p.decimalPlaces ?? 1));
          samplePairs.push({ code, value: mid, unit: p.unit });
        }
      }
    }
    const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    if (format === 'HL7') {
      const lines = [
        `MSH|^~\\&|ANALYZER|LAB|SHPL_LIMS|HOSPITAL|${stamp}||ORU^R01|MSG${stamp}|P|2.5`,
        `PID|1||${order.uhid || order.accessionNumber}||${order.patientName.replace(/\s+/g, '^')}`,
        `OBR|1|${order.accessionNumber}|${order.accessionNumber}|LAB_PANEL`,
        ...samplePairs.map(
          (p, i) =>
            `OBX|${i + 1}|${typeof p.value === 'number' ? 'NM' : 'ST'}|${p.code}^${p.code}||${p.value}|${p.unit}|||N|||F`
        ),
      ];
      setRawPacket(lines.join('\n'));
    } else {
      const lines = [
        `H|\\^&|||ANALYZER^HOST|||||LAB||P|1|${stamp}`,
        `P|1||${order.uhid || order.accessionNumber}||${order.patientName.replace(/\s+/g, '^')}`,
        `O|1|${order.accessionNumber}||^^^PANEL|R`,
        ...samplePairs.map((p, i) => `R|${i + 1}|^^^${p.code}|${p.value}|${p.unit}||N||F`),
        `L|1|N`,
      ];
      setRawPacket(lines.join('\n'));
    }
  };

  const handleIngestPacket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawPacket.trim()) return;
    setBusyAction('ingest');
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{
        message: { accessionNumber: string; status: string; appliedCount?: number };
        db: LimsDatabase;
      }>('/api/lab/analyzers/ingest', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          analyzerId: selectedAnalyzerId || undefined,
          rawPayload: rawPacket,
          applyImmediately: applyNow,
        }),
      });
      setRawPacket('');
      onUpdated(
        resp.db,
        `Ingested analyzer packet for ${resp.message.accessionNumber} -> ${resp.message.status}${
          resp.message.appliedCount ? ` (${resp.message.appliedCount} analytes applied)` : ''
        }.`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Packet ingest failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleApplyQueuedOrder = async (orderId: string, accessionNumber: string) => {
    setBusyAction(`apply-${orderId}`);
    setErrorMsg(null);
    try {
      const resp = await apiRequest<{ appliedCount: number; matchedAnalyzer: string; db: LimsDatabase }>(
        `/api/orders/${orderId}/auto-fetch-analyzer`,
        activeUser.id,
        { method: 'POST', body: JSON.stringify({}) }
      );
      onUpdated(
        resp.db,
        `Auto-fetched ${resp.appliedCount} analyte(s) into ${accessionNumber} (${resp.matchedAnalyzer}).`
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to apply analyzer readings.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-slate-900 text-white">
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Lab Analyzer Auto-Fetch Bridge (HL7 / ASTM / Bi-Directional)
              </h2>
              <p className="text-xs text-slate-500">
                Receive HL7 ORU^R01 &amp; ASTM E1394 instrument packets or auto-fetch pending analyzer results in 1 click.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyAction === 'sync-all'}
              onClick={handleBatchSyncAll}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction === 'sync-all' ? 'animate-spin' : ''}`} />
              {busyAction === 'sync-all' ? 'Syncing Analyzers...' : 'Auto-Fetch All Pending Orders'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/70"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center justify-between gap-2">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="p-1 text-rose-700 hover:bg-rose-100 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Connected Lab Analyzers Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5 text-blue-600" />
                Configured Hospital Lab Analyzers ({analyzers.length})
              </h3>
              <span className="text-[11px] text-slate-500">
                REST Ingest Endpoint: <code className="font-mono text-slate-800">/api/lab/analyzers/ingest</code>
              </span>
            </div>
            <div className="border border-slate-200 rounded-xl overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                    <th className="py-2.5 px-3">Analyzer &amp; Code</th>
                    <th className="py-2.5 px-3">Department</th>
                    <th className="py-2.5 px-3">Protocol</th>
                    <th className="py-2.5 px-3">Host IP : Port / COM</th>
                    <th className="py-2.5 px-3 text-right">Packets</th>
                    <th className="py-2.5 px-3 text-right">Auto-Apply</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analyzers.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-900">{m.name}</div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {m.code} · {m.connectionMode} · {m.status}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">{m.department}</td>
                      <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">{m.protocol}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <input
                            data-no-autocap="true"
                            value={editingEndpoints[m.id] ?? m.endpointAddress}
                            onChange={(e) =>
                              setEditingEndpoints((prev) => ({ ...prev, [m.id]: e.target.value }))
                            }
                            className="w-36 px-2 py-1 text-[11px] font-mono border border-slate-300 rounded bg-white"
                          />
                          {editingEndpoints[m.id] !== undefined &&
                            editingEndpoints[m.id] !== m.endpointAddress && (
                              <button
                                type="button"
                                disabled={busyAction === `addr-${m.id}`}
                                onClick={() => handleSaveEndpoint(m)}
                                className="px-2 py-1 text-[10px] font-semibold bg-slate-900 text-white rounded hover:bg-slate-800"
                              >
                                Save
                              </button>
                            )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                        {m.packetsProcessedCount || 0}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          disabled={busyAction === `cfg-${m.id}`}
                          onClick={() => handleToggleAutoApply(m)}
                          className={`px-2.5 py-1 text-[11px] font-semibold rounded border whitespace-nowrap ${
                            m.autoApplyOnReceive
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                              : 'bg-slate-100 text-slate-600 border-slate-300 hover:bg-slate-200'
                          }`}
                        >
                          {m.autoApplyOnReceive ? 'Auto-Apply ON' : 'Queue Only'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Live HL7 / ASTM Packet Ingester */}
          <form onSubmit={handleIngestPacket} className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-slate-900">
                  Receive / Test HL7 ORU^R01 or ASTM E1394 Frame
                </h3>
                <p className="text-[11px] text-slate-500">
                  Paste an instrument frame or select an open order to generate and test a live HL7/ASTM transmission.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white max-w-xs"
                >
                  <option value="">-- Pick Open Order for Sample Frame --</option>
                  {openPathologyOrders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.accessionNumber} · {o.patientName} ({o.tests.map((t) => t.serviceCode).join(', ')})
                    </option>
                  ))}
                </select>
                {selectedOrderId && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const ord = openPathologyOrders.find((o) => o.id === selectedOrderId);
                        if (ord) loadSampleFrame(ord, 'HL7');
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                    >
                      Load HL7 Sample
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const ord = openPathologyOrders.find((o) => o.id === selectedOrderId);
                        if (ord) loadSampleFrame(ord, 'ASTM');
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
                    >
                      Load ASTM Sample
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-700 mb-1">
                  Source Instrument
                </label>
                <select
                  value={selectedAnalyzerId}
                  onChange={(e) => setSelectedAnalyzerId(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                >
                  {analyzers.map((a) => (
                    <option key={a.id} value={a.id}>
                      [{a.code}] {a.name}
                    </option>
                  ))}
                </select>
                <label className="inline-flex items-center gap-2 text-xs text-slate-700 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyNow}
                    onChange={(e) => setApplyNow(e.target.checked)}
                    className="rounded border-slate-300 text-emerald-600"
                  />
                  <span>Auto-populate order immediately on ingest</span>
                </label>
              </div>
              <div className="md:col-span-2">
                <textarea
                  rows={4}
                  data-no-autocap="true"
                  value={rawPacket}
                  onChange={(e) => setRawPacket(e.target.value)}
                  placeholder="MSH|^~\&|BC5300|LAB|SHPL|HOSP|...&#10;OBR|1|SH-26-0001|...&#10;OBX|1|NM|WBC||7.8|10^3/uL|||N|||F"
                  className="w-full px-3 py-2 text-[11px] font-mono bg-slate-950 text-emerald-300 border border-slate-800 rounded-lg focus:outline-none focus:border-blue-500"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="submit"
                    disabled={!rawPacket.trim() || busyAction === 'ingest'}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    {busyAction === 'ingest' ? 'Ingesting Packet...' : 'Ingest Packet & Auto-Match'}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Recent Analyzer Transmission Queue */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Recent Analyzer Transmissions &amp; Match Queue ({queue.length})
            </h3>
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
              {queue.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No analyzer transmissions recorded yet. Click "Auto-Fetch All Pending Orders" or "Auto-Fetch from Analyzer" inside any lab order workbench.
                </div>
              ) : (
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Accession</th>
                      <th className="py-2 px-3">Instrument</th>
                      <th className="py-2 px-3">Readings Summary</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {queue.slice(0, 30).map((q) => (
                      <tr key={q.id} className="hover:bg-slate-50/70">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {new Date(q.receivedAt).toLocaleTimeString()}
                        </td>
                        <td className="py-2 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                          {q.accessionNumber}
                        </td>
                        <td className="py-2 px-3 text-slate-700">
                          <div className="truncate max-w-[180px]">{q.analyzerName}</div>
                          <div className="font-mono text-[10px] text-slate-400">{q.protocol}</div>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-700">
                          {q.readings
                            .slice(0, 5)
                            .map((r) => `${r.code}:${r.value}`)
                            .join(' · ')}
                          {q.readings.length > 5 ? ` (+${q.readings.length - 5})` : ''}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                              q.status === 'APPLIED'
                                ? 'text-emerald-700'
                                : q.status === 'PENDING'
                                ? 'text-amber-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {q.status === 'APPLIED' && <CheckCircle2 className="w-3 h-3" />}
                            {q.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          {q.status !== 'APPLIED' && q.matchedOrderId && (
                            <button
                              type="button"
                              disabled={busyAction === `apply-${q.matchedOrderId}`}
                              onClick={() => handleApplyQueuedOrder(q.matchedOrderId!, q.accessionNumber)}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Apply Now
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
