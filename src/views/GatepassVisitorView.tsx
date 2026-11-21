import React, { useMemo, useState } from 'react';
import { CheckCircle2, Plus, Printer, Search, ShieldCheck, X } from 'lucide-react';
import type {
  GatepassVisitorRecord,
  LimsDatabase,
  StaffMember,
} from '../types/lims';
import { adToBs } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { GatepassPrintModal } from '../components/HospitalPrintModals';

interface GatepassVisitorViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
}

export function GatepassVisitorView({
  db,
  activeUser,
  onUpdated,
}: GatepassVisitorViewProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [passType, setPassType] = useState<GatepassVisitorRecord['passType']>('VISITOR');
  const [personName, setPersonName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [departmentOrWard, setDepartmentOrWard] = useState('IPD General Ward');
  const [linkedPatientOrRef, setLinkedPatientOrRef] = useState('');
  const [vehicleOrBagInfo, setVehicleOrBagInfo] = useState('');
  const [validUntil, setValidUntil] = useState('Today 20:00');
  const [printingPass, setPrintingPass] = useState<GatepassVisitorRecord | null>(null);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (db.gatepasses || []).filter((g) => {
      if (typeFilter !== 'ALL' && g.passType !== typeFilter) return false;
      if (!q) return true;
      return `${g.passNumber} ${g.personName} ${g.phone} ${g.purpose} ${g.departmentOrWard} ${g.linkedPatientOrRef || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [db.gatepasses, searchTerm, typeFilter]);

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ gatepass: GatepassVisitorRecord; db: LimsDatabase }>(
        '/api/gatepasses',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            passType,
            personName,
            phone,
            purpose,
            departmentOrWard,
            linkedPatientOrRef,
            vehicleOrBagInfo,
            validUntil,
          }),
        }
      );
      onUpdated(resp.db, `Issued ${resp.gatepass.passType} (${resp.gatepass.passNumber}).`);
      setShowIssueModal(false);
      setPersonName('');
      setPhone('');
      setPurpose('');
      setLinkedPatientOrRef('');
      setVehicleOrBagInfo('');
      setPrintingPass(resp.gatepass);
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to issue gatepass.');
    }
  };

  const handleClear = async (gp: GatepassVisitorRecord) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/gatepasses/${gp.id}/clear`,
        activeUser.id,
        { method: 'PATCH' }
      );
      onUpdated(resp.db, `Marked ${gp.passNumber} as Cleared / Exited.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Clearance failed.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Gatepass, Visitor Pass &amp; Discharge Clearance
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Printable visitor entry badges, IPD patient discharge clearance slips, staff movement &amp; material gatepasses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowIssueModal(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-3.5 h-3.5" />
          Issue Printable Gatepass / Clearance
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs">
          {[
            { id: 'ALL', label: 'All Passes' },
            { id: 'VISITOR', label: 'Visitor' },
            { id: 'PATIENT_CLEARANCE', label: 'Discharge Clearance' },
            { id: 'STAFF_GATEPASS', label: 'Staff Gatepass' },
            { id: 'MATERIAL_GATEPASS', label: 'Material' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTypeFilter(t.id)}
              className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap ${
                typeFilter === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search pass #, holder, ward..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
          />
        </div>
      </div>

      {/* Register Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="py-2.5 px-4">Pass No &amp; BS Date</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Holder &amp; Contact</th>
                <th className="py-2.5 px-4">Ward / Purpose</th>
                <th className="py-2.5 px-4">Validity &amp; Status</th>
                <th className="py-2.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((gp) => {
                const bs = adToBs(gp.issuedAt);
                return (
                  <tr key={gp.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono">
                      <div className="font-bold text-slate-900">{gp.passNumber}</div>
                      <div className="text-[11px] text-slate-500">
                        {bs.formattedEn} {bs.timeEn}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-blue-700">
                      {gp.passType.replace('_', ' ')}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{gp.personName}</div>
                      <div className="font-mono text-slate-500">{gp.phone || '—'}</div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-medium text-slate-800">{gp.departmentOrWard}</div>
                      <div className="text-slate-500">{gp.purpose}</div>
                      {gp.linkedPatientOrRef && (
                        <div className="text-[11px] font-mono text-slate-500">Ref: {gp.linkedPatientOrRef}</div>
                      )}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-slate-600">Until: {gp.validUntil}</div>
                      <div
                        className={`font-semibold mt-0.5 ${
                          gp.status === 'Active' ? 'text-amber-700' : 'text-emerald-700'
                        }`}
                      >
                        {gp.status}
                        {gp.clearanceVerifiedBy ? ` (${gp.clearanceVerifiedBy})` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {gp.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => handleClear(gp)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 whitespace-nowrap"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            Verify Exit
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPrintingPass(gp)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Printer className="w-3 h-3" />
                          Print Slip
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showIssueModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleIssue}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-lg p-5 space-y-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                Issue Gatepass / Visitor / Clearance Pass
              </h3>
              <button type="button" onClick={() => setShowIssueModal(false)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">Pass Category</label>
                <select
                  value={passType}
                  onChange={(e) => setPassType(e.target.value as GatepassVisitorRecord['passType'])}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="VISITOR">Visitor Entry Pass</option>
                  <option value="PATIENT_CLEARANCE">Patient Discharge Clearance</option>
                  <option value="STAFF_GATEPASS">Staff Movement Gatepass</option>
                  <option value="MATERIAL_GATEPASS">Material / Equipment Pass</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Valid Until</label>
                <input
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Person / Visitor Name *</label>
                <input
                  required
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Phone Number</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Department / Ward</label>
                <input
                  value={departmentOrWard}
                  onChange={(e) => setDepartmentOrWard(e.target.value)}
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Linked Patient UHID / Bill</label>
                <input
                  value={linkedPatientOrRef}
                  onChange={(e) => setLinkedPatientOrRef(e.target.value)}
                  placeholder="Optional SH-2083-... / IPD-..."
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium mb-1">Purpose / Clearance Note *</label>
                <input
                  required
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g., Full IPD bill cleared for Bed GEN-02 discharge"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div className="col-span-2">
                <label className="block font-medium mb-1">Vehicle / Bag / Escort Note</label>
                <input
                  value={vehicleOrBagInfo}
                  onChange={(e) => setVehicleOrBagInfo(e.target.value)}
                  placeholder="Optional vehicle # or item count"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
              <button type="button" onClick={() => setShowIssueModal(false)} className="px-3.5 py-1.5 border border-slate-300 rounded-lg">
                Cancel
              </button>
              <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-medium">
                Issue &amp; Print Pass
              </button>
            </div>
          </form>
        </div>
      )}

      {printingPass && (
        <GatepassPrintModal
          gatepass={printingPass}
          settings={db.settings}
          onClose={() => setPrintingPass(null)}
        />
      )}
    </div>
  );
}
