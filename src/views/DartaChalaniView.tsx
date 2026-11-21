import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Edit3,
  FileText,
  Paperclip,
  Plus,
  Printer,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  DartaChalaniAttachment,
  DartaChalaniEntry,
  LimsDatabase,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { adToBs } from '../utils/nepaliDate';
import { DartaChalaniPrintModal } from '../components/HospitalPrintModals';
import { exportLetterToDocx, extractTextFromWordFile } from '../utils/wordExport';

interface DartaChalaniViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function DartaChalaniView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: DartaChalaniViewProps) {
  const canManage = hasPerm('darta.manage');
  const entries = db.dartaChalani || [];

  const [tab, setTab] = useState<'register' | 'mis'>('register');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DARTA' | 'CHALANI'>('ALL');
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');

  // Create / Edit Entry Modal
  const [showModal, setShowModal] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<'DARTA' | 'CHALANI'>('CHALANI');
  const [entryNumber, setEntryNumber] = useState('');
  const [refNumber, setRefNumber] = useState('');
  const [entryDateBs, setEntryDateBs] = useState(() => adToBs(new Date()).formattedEn);
  const [partyName, setPartyName] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<DartaChalaniEntry['category']>('Municipality / Health Section');
  const [department, setDepartment] = useState('Hospital Administration');
  const [status, setStatus] = useState<DartaChalaniEntry['status']>('Verified / Dispatched');
  const [documentBody, setDocumentBody] = useState('');
  const [remarks, setRemarks] = useState('');
  const [attachments, setAttachments] = useState<DartaChalaniAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiLanguage, setAiLanguage] = useState<'English' | 'Nepali' | 'Bilingual (English + Nepali)'>('English');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [wordImporting, setWordImporting] = useState(false);

  // Print Modal
  const [printMode, setPrintMode] = useState<{
    mode: 'LETTER' | 'MIS';
    entry?: DartaChalaniEntry;
  } | null>(null);

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const metrics = useMemo(() => {
    const darta = entries.filter((e) => e.entryType === 'DARTA').length;
    const chalani = entries.filter((e) => e.entryType === 'CHALANI').length;
    const totalAtt = entries.reduce((s, e) => s + (e.attachments?.length || 0), 0);
    const verified = entries.filter((e) => e.status === 'Verified / Dispatched').length;
    return { darta, chalani, total: entries.length, totalAtt, verified };
  }, [entries]);

  const categories = useMemo(
    () => Array.from(new Set(entries.map((e) => e.category))),
    [entries]
  );

  const filteredEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return entries.filter((e) => {
      if (typeFilter !== 'ALL' && e.entryType !== typeFilter) return false;
      if (catFilter !== 'ALL' && e.category !== catFilter) return false;
      if (!q) return true;
      return `${e.entryNumber} ${e.refNumber} ${e.partyName} ${e.partyAddress} ${e.subject} ${e.category} ${e.department} ${e.documentBody}`
        .toLowerCase()
        .includes(q);
    });
  }, [entries, typeFilter, catFilter, searchTerm]);

  const misSummaryByCategory = useMemo(() => {
    const map = new Map<string, { darta: number; chalani: number; attachments: number }>();
    for (const e of filteredEntries) {
      const cur = map.get(e.category) || { darta: 0, chalani: 0, attachments: 0 };
      if (e.entryType === 'DARTA') cur.darta += 1;
      else cur.chalani += 1;
      cur.attachments += e.attachments?.length || 0;
      map.set(e.category, cur);
    }
    return Array.from(map.entries());
  }, [filteredEntries]);

  const handleAttachFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (f.size > 2 * 1024 * 1024) continue; // cap 2MB per attachment
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = typeof reader.result === 'string' ? reader.result : '';
        setAttachments((prev) => [
          ...prev,
          {
            id: `att-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            fileName: f.name,
            fileType: f.type || 'application/octet-stream',
            note: `${Math.max(1, Math.round(f.size / 1024))} KB · Uploaded by ${activeUser.fullName}`,
            dataUrl,
            attachedAt: new Date().toISOString(),
          },
        ]);
      };
      reader.readAsDataURL(f);
    }
    e.target.value = '';
  };

  const openCreateModal = () => {
    setEditingEntryId(null);
    setEntryType('CHALANI');
    setEntryNumber('');
    setRefNumber('');
    setEntryDateBs(adToBs(new Date()).formattedEn);
    setPartyName('');
    setPartyAddress('');
    setSubject('');
    setCategory('Municipality / Health Section');
    setDepartment('Hospital Administration');
    setStatus('Verified / Dispatched');
    setDocumentBody('');
    setRemarks('');
    setAttachments([]);
    setShowModal(true);
  };

  const openEditModal = (entry: DartaChalaniEntry) => {
    setEditingEntryId(entry.id);
    setEntryType(entry.entryType);
    setEntryNumber(entry.entryNumber);
    setRefNumber(entry.refNumber);
    setEntryDateBs(entry.entryDateBs);
    setPartyName(entry.partyName);
    setPartyAddress(entry.partyAddress || '');
    setSubject(entry.subject);
    setCategory(entry.category);
    setDepartment(entry.department || 'Hospital Administration');
    setStatus(entry.status);
    setDocumentBody(entry.documentBody || '');
    setRemarks(entry.remarks || '');
    setAttachments(entry.attachments || []);
    setShowModal(true);
  };

  const handleImportWordBody = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setWordImporting(true);
    try {
      const text = await extractTextFromWordFile(file);
      if (!text) {
        onUpdated(db, 'Selected Word/Text file contained no readable text.');
        return;
      }
      setDocumentBody((prev) => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      onUpdated(db, `Imported document body from ${file.name}.`);
    } catch (err: any) {
      onUpdated(db, err?.message || 'Could not extract text from Word file.');
    } finally {
      setWordImporting(false);
    }
  };

  const handleAiComposeLetter = async () => {
    if (!partyName.trim() && !subject.trim() && !documentBody.trim()) {
      onUpdated(db, 'Enter Party Name, Subject, or brief notes first for AI letter composition.');
      return;
    }
    setAiGenerating(true);
    try {
      const resp = await apiRequest<{ subject: string; documentBody: string }>(
        '/api/ai/compose-letter',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            documentKind: entryType === 'DARTA' ? 'DARTA_INWARD_REPLY' : 'CHALANI_OFFICIAL_LETTER',
            language: aiLanguage,
            partyName: partyName.trim(),
            partyAddress: partyAddress.trim(),
            subject: subject.trim(),
            department: department.trim(),
            keyPoints: documentBody.trim() || remarks.trim() || subject.trim(),
          }),
        }
      );
      if (!subject.trim() && resp.subject) {
        setSubject(resp.subject);
      }
      if (resp.documentBody) {
        setDocumentBody(resp.documentBody);
      }
      onUpdated(db, 'AI composed formal hospital correspondence body.');
    } catch (err: any) {
      onUpdated(db, err?.message || 'AI composition failed.');
    } finally {
      setAiGenerating(false);
    }
  };

  const handleCreateOrUpdateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !partyName.trim() || !subject.trim()) return;
    setSaving(true);
    try {
      const payload = {
        entryType,
        entryNumber: entryNumber.trim() || undefined,
        refNumber: refNumber.trim() || undefined,
        entryDateBs: entryDateBs.trim(),
        partyName: partyName.trim(),
        partyAddress: partyAddress.trim(),
        subject: subject.trim(),
        category,
        department: department.trim(),
        status,
        documentBody,
        attachments,
        remarks: remarks.trim(),
      };
      const resp = editingEntryId
        ? await apiRequest<{ entry: DartaChalaniEntry; db: LimsDatabase }>(
            `/api/darta-chalani/${editingEntryId}`,
            activeUser.id,
            {
              method: 'PATCH',
              body: JSON.stringify(payload),
            }
          )
        : await apiRequest<{ entry: DartaChalaniEntry; db: LimsDatabase }>(
            '/api/darta-chalani',
            activeUser.id,
            {
              method: 'POST',
              body: JSON.stringify(payload),
            }
          );
      setShowModal(false);
      setEditingEntryId(null);
      setEntryNumber('');
      setRefNumber('');
      setPartyName('');
      setPartyAddress('');
      setSubject('');
      setDocumentBody('');
      setRemarks('');
      setAttachments([]);
      onUpdated(
        resp.db,
        editingEntryId
          ? `Updated ${resp.entry.entryType} ${resp.entry.entryNumber}.`
          : `Logged ${resp.entry.entryType} ${resp.entry.entryNumber} (Ref: ${resp.entry.refNumber}).`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to save Darta/Chalani entry.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (entry: DartaChalaniEntry) => {
    const nextStatus =
      entry.status === 'Verified / Dispatched' ? 'Filed / Archived' : 'Verified / Dispatched';
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/darta-chalani/${entry.id}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: nextStatus }),
        }
      );
      onUpdated(resp.db, `${entry.entryNumber} marked as ${nextStatus}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Status update failed.');
    }
  };

  const handleDeleteEntry = async (entry: DartaChalaniEntry) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/darta-chalani/${entry.id}`,
        activeUser.id,
        { method: 'DELETE' }
      );
      onUpdated(resp.db, `Deleted ${entry.entryNumber}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Delete failed.');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Darta (Inward) &amp; Chalani (Outward) Register, Document Dispatch &amp; MIS
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Official hospital correspondence with Ref No. (पत्र संख्या), full letter composition, document attachments, 1-click printable letters &amp; Darta-Chalani MIS Summary Report
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPrintMode({ mode: 'MIS' })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
          >
            <Printer className="w-3.5 h-3.5 text-blue-600" />
            Print Darta-Chalani MIS Report
          </button>
          {canManage && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              New Darta / Chalani Entry
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Inward Register (दर्ता / Darta)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-blue-700 mt-1">{metrics.darta}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Outward Dispatch (चलानी / Chalani)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
            {metrics.chalani}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Attached Documents</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {metrics.totalAtt}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="text-xs text-slate-500 font-medium">Verified &amp; Dispatched</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {metrics.verified} / {metrics.total}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTab('register')}
            className={`px-3.5 py-1.5 rounded-lg font-medium border ${
              tab === 'register'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            Darta &amp; Chalani Register ({entries.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('mis')}
            className={`px-3.5 py-1.5 rounded-lg font-medium border ${
              tab === 'mis'
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200'
            }`}
          >
            MIS Category Summary
          </button>
          {(['ALL', 'DARTA', 'CHALANI'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1.5 rounded-lg font-medium border ${
                typeFilter === t
                  ? 'bg-blue-50 text-blue-800 border-blue-300'
                  : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            className="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs"
          >
            <option value="ALL">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
          <div className="relative min-w-[220px] max-w-xs flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search Ref No, party, subject..."
              className="w-full pl-9 pr-3 py-1.5 border border-slate-300 rounded-lg text-slate-900"
            />
          </div>
        </div>
      </div>

      {/* Register Table */}
      {tab === 'register' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-medium">
                  <th className="py-3 px-4">Type &amp; Darta/Chalani #</th>
                  <th className="py-3 px-4">Ref No. (पत्र संख्या) &amp; BS Date</th>
                  <th className="py-3 px-4">Sender / Recipient &amp; Subject</th>
                  <th className="py-3 px-4">Category &amp; Dept</th>
                  <th className="py-3 px-4">Attachments &amp; Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-500">
                      No Darta/Chalani records match the filter.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-4">
                        <div
                          className={`font-semibold ${
                            entry.entryType === 'DARTA' ? 'text-blue-700' : 'text-emerald-700'
                          }`}
                        >
                          {entry.entryType === 'DARTA' ? 'DARTA (Inward)' : 'CHALANI (Outward)'}
                        </div>
                        <div className="font-mono font-bold text-slate-900">{entry.entryNumber}</div>
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <div className="font-semibold text-slate-900">{entry.refNumber}</div>
                        <div className="text-[11px] text-slate-500">{entry.entryDateBs} BS</div>
                      </td>
                      <td className="py-3 px-4 max-w-sm">
                        <div className="font-semibold text-slate-900">{entry.partyName}</div>
                        <div className="text-[11px] text-slate-700 font-medium">{entry.subject}</div>
                        {entry.documentBody && (
                          <div className="text-[11px] text-slate-500 truncate mt-0.5">
                            {entry.documentBody}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-slate-900 font-medium">{entry.category}</div>
                        <div className="text-[11px] text-slate-500">{entry.department}</div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1 font-mono text-slate-700">
                          <Paperclip className="w-3 h-3" />
                          {entry.attachments?.length || 0} file(s)
                        </div>
                        <div className="text-[11px] font-medium text-slate-600 mt-0.5">{entry.status}</div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPrintMode({ mode: 'LETTER', entry })}
                            className="inline-flex items-center gap-1 px-2.5 py-1 font-medium text-blue-700 bg-white border border-blue-300 rounded-md hover:bg-blue-50 whitespace-nowrap"
                          >
                            <Printer className="w-3 h-3" />
                            Print Letter
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              void exportLetterToDocx({
                                hospitalName: db.settings.labName,
                                hospitalNameNp: db.settings.labNameNp,
                                addressLine: db.settings.addressLine,
                                contactLine: db.settings.contactLine,
                                panNumber: db.settings.panNumber,
                                documentHeading: `${entry.entryType} OFFICIAL CORRESPONDENCE`,
                                entryNumber: entry.entryNumber,
                                refNumber: entry.refNumber,
                                dateBs: entry.entryDateBs,
                                dateAd: entry.entryDateAd,
                                department: entry.department,
                                recipientLine: entry.partyName,
                                recipientAddress: entry.partyAddress,
                                subject: entry.subject,
                                body: entry.documentBody || '',
                                signatoryName: entry.handledBy,
                                signatoryDesignation: entry.department,
                                fileName: `${entry.entryNumber}.docx`,
                              });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md hover:bg-indigo-100 whitespace-nowrap"
                          >
                            <Download className="w-3 h-3" />
                            .docx
                          </button>
                          {canManage && (
                            <>
                              <button
                                type="button"
                                onClick={() => openEditModal(entry)}
                                className="inline-flex items-center gap-1 px-2 py-1 text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                              >
                                <Edit3 className="w-3 h-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(entry)}
                                className="px-2 py-1 text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                              >
                                Toggle Status
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteEntry(entry)}
                                className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                                aria-label={`Delete ${entry.entryNumber}`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* MIS Report Tab */
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Darta &amp; Chalani Correspondence MIS Breakdown ({db.settings.activeFiscalYear})
              </h2>
              <p className="text-slate-500">
                Audit-ready aggregation across Police MLC, Municipality Health Section, Lab, HR &amp; Vendors
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPrintMode({ mode: 'MIS' })}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Official MIS Register
            </button>
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Correspondence Category</th>
                  <th className="py-2.5 px-4 text-right">Darta (Inward)</th>
                  <th className="py-2.5 px-4 text-right">Chalani (Outward)</th>
                  <th className="py-2.5 px-4 text-right">Attachments</th>
                  <th className="py-2.5 px-4 text-right">Total Records</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {misSummaryByCategory.map(([cat, stats]) => (
                  <tr key={cat}>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">{cat}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{stats.darta}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{stats.chalani}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums">{stats.attachments}</td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold">
                      {stats.darta + stats.chalani}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* NEW DARTA / CHALANI MODAL */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/55 flex items-center justify-center p-4"
          onClick={() => setShowModal(false)}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-900">
                  {editingEntryId
                    ? `Edit Correspondence — ${entryNumber || refNumber}`
                    : 'Compose Darta / Chalani Correspondence & Attach Document'}
                </h2>
              </div>
              <button type="button" onClick={() => setShowModal(false)} className="text-slate-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateOrUpdateEntry} className="p-5 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Register Type</label>
                  <select
                    value={entryType}
                    onChange={(e) => setEntryType(e.target.value as 'DARTA' | 'CHALANI')}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold"
                  >
                    <option value="CHALANI">CHALANI (Outward Letter)</option>
                    <option value="DARTA">DARTA (Inward Document)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Entry No. (Auto if blank)</label>
                  <input
                    value={entryNumber}
                    onChange={(e) => setEntryNumber(e.target.value)}
                    placeholder="Auto sequential"
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ref No. / पत्र संख्या</label>
                  <input
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder="SHP/CH/2082/83/..."
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">BS Date *</label>
                  <input
                    required
                    value={entryDateBs}
                    onChange={(e) => setEntryDateBs(e.target.value)}
                    className="w-full px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">
                    {entryType === 'DARTA' ? 'Received From (Sender Party) *' : 'Addressed To (Recipient Party) *'}
                  </label>
                  <input
                    required
                    value={partyName}
                    onChange={(e) => setPartyName(e.target.value)}
                    placeholder="e.g., Health Section, Bode Barsain Municipality / Area Police Office"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Party Address</label>
                  <input
                    value={partyAddress}
                    onChange={(e) => setPartyAddress(e.target.value)}
                    placeholder="Enter party address"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DartaChalaniEntry['category'])}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Municipality / Health Section">Municipality / Health Section</option>
                    <option value="Police / MLC Correspondence">Police / MLC Correspondence</option>
                    <option value="DHIS2 / HMIS Submission">DHIS2 / HMIS Submission</option>
                    <option value="Patient Referral / Clinical">Patient Referral / Clinical</option>
                    <option value="Vendor / Procurement">Vendor / Procurement</option>
                    <option value="HR / Internal Circular">HR / Internal Circular</option>
                    <option value="General Correspondence">General Correspondence</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Department</label>
                  <input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Subject / विषय *</label>
                  <input
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief official subject line"
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Dispatch Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as any)}
                    className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="Verified / Dispatched">Verified / Dispatched</option>
                    <option value="Pending Action">Pending Action</option>
                    <option value="Filed / Archived">Filed / Archived</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="font-medium text-slate-700">
                    Full Written Letter / Document Body (Printable &amp; Word .docx Export)
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white border border-slate-300 rounded-md cursor-pointer hover:bg-slate-50 text-[11px] font-medium text-slate-700">
                      <Upload className="w-3 h-3 text-indigo-600" />
                      <span>{wordImporting ? 'Reading Word...' : 'Import Word (.docx / .txt)'}</span>
                      <input
                        type="file"
                        accept=".docx,.txt,.md"
                        onChange={handleImportWordBody}
                        className="hidden"
                      />
                    </label>
                    <select
                      value={aiLanguage}
                      onChange={(e) =>
                        setAiLanguage(e.target.value as 'English' | 'Nepali' | 'Bilingual (English + Nepali)')
                      }
                      className="px-2 py-1 bg-white border border-slate-300 rounded-md text-[11px]"
                    >
                      <option value="English">English</option>
                      <option value="Nepali">Nepali</option>
                      <option value="Bilingual (English + Nepali)">Bilingual</option>
                    </select>
                    <button
                      type="button"
                      disabled={aiGenerating}
                      onClick={handleAiComposeLetter}
                      className="inline-flex items-center gap-1 px-2.5 py-1 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 text-[11px] font-semibold"
                    >
                      <Sparkles className="w-3 h-3" />
                      {aiGenerating ? 'Composing...' : 'AI Compose Letter'}
                    </button>
                  </div>
                </div>
                <textarea
                  rows={6}
                  value={documentBody}
                  onChange={(e) => setDocumentBody(e.target.value)}
                  placeholder="Write official letter body, import from .docx Word file, or write brief bullet points and click AI Compose Letter..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>

              {/* Document Attachment Uploader */}
              <div className="border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">
                    Attach Scanned Documents / Images / PDF ({attachments.length})
                  </span>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-100">
                    <Paperclip className="w-3.5 h-3.5 text-blue-600" />
                    <span>Choose File(s)</span>
                    <input
                      type="file"
                      multiple
                      accept="image/*,.pdf"
                      onChange={handleAttachFile}
                      className="hidden"
                    />
                  </label>
                </div>
                {attachments.length > 0 && (
                  <div className="space-y-1">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="flex items-center justify-between bg-white px-2.5 py-1.5 rounded border border-slate-200"
                      >
                        <span className="font-mono text-[11px] text-slate-800">
                          {att.fileName} ({att.fileType}{att.note ? ` · ${att.note}` : ''})
                        </span>
                        <button
                          type="button"
                          onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== att.id))}
                          className="text-rose-600 hover:underline text-[11px]"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Internal Remarks</label>
                <input
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-3.5 py-2 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Entry & Assign Ref No.'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PRINT LETTER OR MIS MODAL */}
      {printMode && (
        <DartaChalaniPrintModal
          mode={printMode.mode}
          entry={printMode.entry}
          entries={filteredEntries}
          settings={db.settings}
          onClose={() => setPrintMode(null)}
        />
      )}
    </div>
  );
}
