import React, { useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Edit3,
  History,
  Receipt,
  Search,
  Tag,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import type {
  AgeType,
  AppointmentRecord,
  EncounterType,
  LabOrder,
  LimsDatabase,
  PatientGender,
  PatientRecord,
  PermissionKey,
  StaffMember,
} from '../types/lims';
import { adToBs } from '../utils/nepaliDate';
import { apiRequest } from '../api/client';
import { detectPatientEncounter } from '../utils/patientEncounter';
import { normalizeNepalPhone, sanitizePersonName, stripCountryPrefixForEdit } from '../utils/textFormat';
import { PatientLongitudinalDashboard } from '../components/PatientLongitudinalDashboard';
import { ThermalStickerPrintModal } from '../components/HospitalPrintModals';

interface PatientFlowViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: LimsDatabase, toastMsg: string) => void;
  onRouteToBilling: (
    target: 'pos' | 'pharmacy',
    payload: {
      patient: PatientRecord;
      encounterType: EncounterType;
      encounterId?: string;
      encounterLabel: string;
    }
  ) => void;
  onRouteToModule?: (
    target: 'opd' | 'emergency' | 'ipd' | 'pos' | 'pharmacy',
    payload: {
      patient: PatientRecord;
      encounterType: EncounterType;
      encounterId?: string;
      encounterLabel: string;
    }
  ) => void;
  onOpenReport?: (order: LabOrder, autoPrint?: boolean) => void;
  onOpenBill?: (order: LabOrder) => void;
  initialSearchQuery?: string;
}

export function PatientFlowView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  onRouteToBilling,
  onRouteToModule,
  onOpenReport,
  onOpenBill,
  initialSearchQuery,
}: PatientFlowViewProps) {
  const isSuperAdmin = activeUser.roleId === 'SUPER_ADMIN';
  const canCreate = hasPerm('patients.manage') || hasPerm('orders.create') || hasPerm('hospital.clinical');

  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');

  // Patient Registration Form State (Registration ONLY — Clinical OPD/ER/IPD handled inside dedicated modules)
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('32');
  const [ageType, setAgeType] = useState<AgeType>('Years');
  const [gender, setGender] = useState<PatientGender>('Female');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [bloodGroup, setBloodGroup] = useState('');
  const [allergies, setAllergies] = useState('');
  const [emergencyContact, setEmergencyContact] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [newlyRegistered, setNewlyRegistered] = useState<PatientRecord | null>(null);

  // Admin Edit / Delete / 360° Dashboard / Appointment / Thermal Sticker State
  const [editingPatient, setEditingPatient] = useState<PatientRecord | null>(null);
  const [deletingPatient, setDeletingPatient] = useState<PatientRecord | null>(null);
  const [longitudinalPatient, setLongitudinalPatient] = useState<PatientRecord | null>(null);
  const [stickerPatient, setStickerPatient] = useState<PatientRecord | null>(null);
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [stickerPickerSearch, setStickerPickerSearch] = useState('');

  // Appointment Booking Modal State
  const [apptTarget, setApptTarget] = useState<PatientRecord | null>(null);
  const [apptDept, setApptDept] = useState('General Medicine OPD');
  const [apptDoctor, setApptDoctor] = useState('Dr. Santosh Majhi, MD');
  const [apptDateAd, setApptDateAd] = useState(() => new Date().toISOString().slice(0, 10));
  const [apptSlot, setApptSlot] = useState('10:00 AM');
  const [apptReason, setApptReason] = useState('');
  const [savingAppt, setSavingAppt] = useState(false);

  const doctorOptions = useMemo(() => {
    const staffDocs = (db.staff || [])
      .filter((s) => s.status === 'Active' && (s.roleId === 'DOCTOR' || /^dr\.?\s/i.test(s.fullName)))
      .map((s) => s.fullName);
    return Array.from(new Set(['Dr. Santosh Majhi, MD', 'Dr. Elena Adhikari, MD', ...staffDocs]));
  }, [db.staff]);

  const filteredPatients = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (db.patients || []).filter(
      (p) =>
        !q ||
        `${p.uhid} ${p.fullName} ${p.phone} ${p.address}`.toLowerCase().includes(q)
    );
  }, [db.patients, searchTerm]);

  const handleRegisterPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setRegError('Patient Full Name is required.');
      return;
    }
    setRegError(null);
    setSubmitting(true);
    try {
      const patResp = await apiRequest<{ patient: PatientRecord; db: LimsDatabase }>(
        '/api/patients',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            fullName: fullName.trim(),
            age: Number(age) || 30,
            ageType,
            gender,
            phone: normalizeNepalPhone(phone),
            address: address.trim() || 'Saptari',
            bloodGroup: bloodGroup.trim() || undefined,
            allergies: allergies.trim() || undefined,
            emergencyContact: emergencyContact.trim() || undefined,
          }),
        }
      );
      setNewlyRegistered(patResp.patient);
      setFullName('');
      setAddress('');
      setBloodGroup('');
      setAllergies('');
      setEmergencyContact('');
      setPhone('');
      onUpdated(
        patResp.db,
        `Registered Patient ${patResp.patient.fullName} (${patResp.patient.uhid}).`
      );
    } catch (err: any) {
      setRegError(err.message || 'Patient registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveEditPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPatient || !isSuperAdmin) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/patients/${editingPatient.id}`,
        activeUser.id,
        {
          method: 'PATCH',
          body: JSON.stringify({
            fullName: editingPatient.fullName,
            age: Number(editingPatient.age),
            ageType: editingPatient.ageType,
            gender: editingPatient.gender,
            phone: normalizeNepalPhone(editingPatient.phone),
            address: editingPatient.address,
            bloodGroup: editingPatient.bloodGroup,
            allergies: editingPatient.allergies,
          }),
        }
      );
      onUpdated(resp.db, `Updated Patient Master record ${editingPatient.uhid}.`);
      setEditingPatient(null);
    } catch (err: any) {
      setRegError(err.message || 'Failed to update patient.');
    }
  };

  const handleConfirmDeletePatient = async () => {
    if (!deletingPatient || !isSuperAdmin) return;
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/patients/${deletingPatient.id}`,
        activeUser.id,
        { method: 'DELETE' }
      );
      onUpdated(resp.db, `Deleted Patient ${deletingPatient.uhid} from Master Directory.`);
      setDeletingPatient(null);
    } catch (err: any) {
      setRegError(err.message || 'Delete failed.');
    }
  };

  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apptTarget) return;
    setSavingAppt(true);
    try {
      const resp = await apiRequest<{ appointment: AppointmentRecord; db: LimsDatabase }>(
        '/api/appointments',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            patientId: apptTarget.id,
            uhid: apptTarget.uhid,
            patientName: apptTarget.fullName,
            patientPhone: apptTarget.phone,
            department: apptDept,
            doctorName: apptDoctor,
            appointmentDateAd: apptDateAd,
            appointmentDateBs: adToBs(apptDateAd).formattedEn,
            timeSlot: apptSlot,
            reason: apptReason.trim() || 'Scheduled OPD Consultation',
          }),
        }
      );
      setApptTarget(null);
      setApptReason('');
      onUpdated(
        resp.db,
        `Booked Appointment ${resp.appointment.appointmentNumber} for ${apptTarget.fullName} (${apptSlot}).`
      );
    } catch (err: any) {
      setRegError(err.message || 'Failed to schedule appointment.');
    } finally {
      setSavingAppt(false);
    }
  };

  const handleAppointmentStatus = async (appt: AppointmentRecord, status: AppointmentRecord['status']) => {
    try {
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/appointments/${appt.id}`,
        activeUser.id,
        { method: 'PATCH', body: JSON.stringify({ status }) }
      );
      onUpdated(resp.db, `Appointment ${appt.appointmentNumber} marked ${status}.`);
      if (status === 'Checked-In') {
        const pt = (resp.db.patients || []).find((p) => p.id === appt.patientId || p.uhid === appt.uhid);
        if (pt) routePatientToTarget(pt, 'opd', 'OPD');
      }
    } catch (err: any) {
      setRegError(err.message || 'Failed to update appointment.');
    }
  };

  const routePatientToTarget = (
    pat: PatientRecord,
    target: 'opd' | 'emergency' | 'ipd' | 'pos' | 'pharmacy',
    forcedEncounter?: EncounterType
  ) => {
    const det = detectPatientEncounter(db, pat);
    const encType: EncounterType = forcedEncounter || det.encounterType;
    const payload = {
      patient: pat,
      encounterType: encType,
      encounterId: forcedEncounter === 'WALKING' ? undefined : det.encounterId,
      encounterLabel:
        forcedEncounter === 'OPD'
          ? `OPD Visit · ${pat.uhid}`
          : forcedEncounter === 'EMERGENCY'
          ? `ER Case · ${pat.uhid}`
          : forcedEncounter === 'WALKING'
          ? `WALKING · ${pat.uhid}`
          : det.encounterLabel,
    };
    if (onRouteToModule) {
      onRouteToModule(target, payload);
    } else if (target === 'pos' || target === 'pharmacy') {
      onRouteToBilling(target, payload);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Patient Registration &amp; Master UHID Directory
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Clean front-desk Patient Registration (UHID creation) &amp; Patient 360° History. Use OPD Consultation, Emergency / ER, or IPD Bed modules for clinical encounters.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-xs font-mono bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-slate-700 whitespace-nowrap shrink-0">
            Master UHIDs: <strong className="tabular-nums">{(db.patients || []).length}</strong>
          </div>
          <button
            type="button"
            onClick={() => {
              setStickerPickerSearch('');
              setStickerPickerOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Tag className="w-3.5 h-3.5" />
            Print Thermal Sticker
          </button>
        </div>
      </div>

      {regError && (
        <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center justify-between gap-2">
          <span>{regError}</span>
          <button
            type="button"
            onClick={() => setRegError(null)}
            className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold bg-white border border-rose-300 rounded text-rose-800 hover:bg-rose-100 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
        </div>
      )}

      {newlyRegistered && (
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-950 text-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <div className="font-semibold text-sm">
                UHID Assigned: <span className="font-mono text-emerald-800">{newlyRegistered.uhid}</span> — {newlyRegistered.fullName}
              </div>
              <div className="text-[11px] text-emerald-800 mt-0.5">
                {newlyRegistered.age} {newlyRegistered.ageType} / {newlyRegistered.gender} · {newlyRegistered.phone} · {newlyRegistered.address}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => routePatientToTarget(newlyRegistered, 'opd', 'OPD')}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-indigo-800 bg-white border border-indigo-300 rounded-lg hover:bg-indigo-50"
            >
              Send to OPD
            </button>
            <button
              type="button"
              onClick={() => routePatientToTarget(newlyRegistered, 'emergency', 'EMERGENCY')}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700"
            >
              Send to Emergency (ER)
            </button>
            <button
              type="button"
              onClick={() => routePatientToTarget(newlyRegistered, 'pos', 'WALKING')}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              <Receipt className="w-3.5 h-3.5" />
              Walk-In → Hospital POS
            </button>
            <button
              type="button"
              onClick={() => routePatientToTarget(newlyRegistered, 'pharmacy')}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100"
            >
              Pharmacy POS
            </button>
            <button
              type="button"
              onClick={() => setApptTarget(newlyRegistered)}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-amber-800 bg-white border border-amber-300 rounded-lg hover:bg-amber-50"
            >
              <CalendarClock className="w-3.5 h-3.5" />
              Book Appointment
            </button>
            <button
              type="button"
              onClick={() => setStickerPatient(newlyRegistered)}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100"
            >
              <Tag className="w-3.5 h-3.5" />
              Thermal Sticker
            </button>
            <button
              type="button"
              onClick={() => setLongitudinalPatient(newlyRegistered)}
              className="inline-flex items-center gap-1 px-3 py-1.5 font-medium text-indigo-800 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50"
            >
              <History className="w-3.5 h-3.5" />
              360° Dashboard
            </button>
            <button
              type="button"
              onClick={() => setNewlyRegistered(null)}
              className="p-1 text-emerald-700 hover:bg-emerald-100 rounded"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* New Patient Registration Card (Registration Only) */}
      <form
        onSubmit={handleRegisterPatient}
        className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-blue-600" />
            New Patient Registration (Assign UHID)
          </h2>
          <span className="text-[11px] font-mono text-slate-500">
            UHID is shared across OPD, ER, IPD, OT, Lab/Radiology POS &amp; Pharmacy
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 text-xs">
          <div className="lg:col-span-2">
            <label className="block font-medium text-slate-700 mb-1">Patient Full Name (बिरामीको नाम) *</label>
            <input
              required
              value={fullName}
              onChange={(e) => setFullName(sanitizePersonName(e.target.value))}
              placeholder="e.g., Bimala Kumari Yadav"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Phone Number (फोन) *</label>
            <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:border-blue-600">
              <span className="px-2.5 py-2 bg-slate-100 text-slate-600 font-mono border-r border-slate-300 select-none">
                +977
              </span>
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98XXXXXXXX"
                className="w-full px-3 py-2 font-mono focus:outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block font-medium text-slate-700 mb-1">Age *</label>
              <input
                type="number"
                min={0}
                max={125}
                required
                value={age}
                onChange={(e) => setAge(e.target.value)}
                className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Unit</label>
              <select
                value={ageType}
                onChange={(e) => setAgeType(e.target.value as AgeType)}
                className="w-full px-2 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="Years">Yrs</option>
                <option value="Months">Mos</option>
                <option value="Days">Days</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-700 mb-1">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as PatientGender)}
                className="w-full px-2 py-2 border border-slate-300 rounded-lg bg-white"
              >
                <option value="Female">F</option>
                <option value="Male">M</option>
                <option value="Other">O</option>
              </select>
            </div>
          </div>

          <div className="lg:col-span-2">
            <label className="block font-medium text-slate-700 mb-1">Address (Municipality / Ward / District) *</label>
            <input
              required
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="e.g., Bode Barsain-05, Saptari"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Blood Group</label>
            <input
              value={bloodGroup}
              onChange={(e) => setBloodGroup(e.target.value)}
              placeholder="O+ / B+ / A+"
              className="w-full px-3 py-2 font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700 mb-1">Known Allergies</label>
            <input
              value={allergies}
              onChange={(e) => setAllergies(e.target.value)}
              placeholder="None / Penicillin"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="text-[11px] text-slate-500">
            Registration creates permanent Patient Master UHID only — open <strong>OPD</strong>, <strong>ER</strong>, or <strong>IPD</strong> module to start clinical consultation.
          </div>
          <button
            type="submit"
            disabled={!canCreate || submitting}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-40 whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" />
            {submitting ? 'Registering UHID...' : 'Register Patient & Assign UHID'}
          </button>
        </div>
      </form>

      {/* Master Patient Directory */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">
              Patient Master Directory ({filteredPatients.length})
            </h2>
            {!isSuperAdmin && (
              <span className="text-[11px] text-slate-500">
                (Edit &amp; Delete restricted to Hospital Admin)
              </span>
            )}
          </div>
          <div className="relative w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search UHID, name, phone, address..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-4">UHID</th>
                <th className="py-2.5 px-4">Patient Name &amp; Demographics</th>
                <th className="py-2.5 px-4">Phone &amp; Address</th>
                <th className="py-2.5 px-4">Active Encounter / Last OPD</th>
                <th className="py-2.5 px-4 text-right">Route to POS (Auto-Encounter)</th>
                <th className="py-2.5 px-4 text-right">360° &amp; Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredPatients.map((pat) => {
                const det = detectPatientEncounter(db, pat);
                return (
                  <tr key={pat.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-mono font-bold text-blue-700">{pat.uhid}</td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900">{pat.fullName}</div>
                      <div className="text-slate-500">
                        {pat.age} {pat.ageType} / {pat.gender}
                        {pat.bloodGroup ? ` · ${pat.bloodGroup}` : ''}
                      </div>
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-mono text-slate-800">{pat.phone || '—'}</div>
                      <div className="text-slate-500">{pat.address}</div>
                    </td>
                    <td className="py-2.5 px-4 font-mono">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold ${
                          det.encounterType === 'EMERGENCY'
                            ? 'bg-rose-100 text-rose-800 border border-rose-300'
                            : det.encounterType === 'IPD'
                            ? 'bg-purple-100 text-purple-800 border border-purple-300'
                            : det.encounterType === 'OPD'
                            ? 'bg-blue-100 text-blue-800 border border-blue-300'
                            : 'bg-slate-100 text-slate-700 border border-slate-300'
                        }`}
                      >
                        {det.encounterType}
                      </span>
                      <div className="text-indigo-700 font-semibold mt-0.5">{det.encounterLabel}</div>
                      {pat.lastOpdVisitAt && (
                        <div className="text-[11px] text-slate-500">
                          Last OPD: {adToBs(pat.lastOpdVisitAt).formattedEn}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex flex-wrap justify-end items-center gap-1">
                        <button
                          type="button"
                          onClick={() => routePatientToTarget(pat, 'opd', 'OPD')}
                          className="px-2 py-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 whitespace-nowrap"
                        >
                          OPD
                        </button>
                        <button
                          type="button"
                          onClick={() => routePatientToTarget(pat, 'emergency', 'EMERGENCY')}
                          className="px-2 py-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100 whitespace-nowrap"
                        >
                          ER
                        </button>
                        <button
                          type="button"
                          onClick={() => routePatientToTarget(pat, 'pos')}
                          className="px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 whitespace-nowrap"
                        >
                          Walk-In / POS
                        </button>
                        <button
                          type="button"
                          onClick={() => routePatientToTarget(pat, 'pharmacy')}
                          className="px-2 py-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded hover:bg-emerald-100 whitespace-nowrap"
                        >
                          Pharmacy
                        </button>
                        <button
                          type="button"
                          onClick={() => setApptTarget(pat)}
                          className="px-2 py-1 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 whitespace-nowrap"
                        >
                          Appt
                        </button>
                        <button
                          type="button"
                          onClick={() => setStickerPatient(pat)}
                          className="px-2 py-1 text-[11px] font-medium text-slate-700 bg-slate-100 border border-slate-300 rounded hover:bg-slate-200 whitespace-nowrap"
                          title="Print Thermal Sticker"
                        >
                          Sticker
                        </button>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setLongitudinalPatient(pat)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded hover:bg-indigo-100 whitespace-nowrap"
                          title="Open Patient Longitudinal 360 Dashboard"
                        >
                          <History className="w-3 h-3" />
                          360° History
                        </button>
                        {isSuperAdmin && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setEditingPatient({
                                  ...pat,
                                  phone: stripCountryPrefixForEdit(pat.phone),
                                })
                              }
                              className="p-1.5 text-slate-600 hover:text-blue-700 border border-slate-200 rounded"
                              title="Admin Edit Patient"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingPatient(pat)}
                              className="p-1.5 text-slate-600 hover:text-rose-700 border border-slate-200 rounded"
                              title="Admin Delete Patient"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredPatients.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-500">
                    No registered patients match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Admin Edit Modal */}
      {editingPatient && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setEditingPatient(null)}
        >
          <form
            onSubmit={handleSaveEditPatient}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 space-y-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <h3 className="text-sm font-semibold">Admin Edit Patient ({editingPatient.uhid})</h3>
              <button type="button" onClick={() => setEditingPatient(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div>
              <label className="block font-medium mb-1">Full Name *</label>
              <input
                required
                value={editingPatient.fullName}
                onChange={(e) => setEditingPatient({ ...editingPatient, fullName: sanitizePersonName(e.target.value) })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium mb-1">Age</label>
                <input
                  type="number"
                  value={editingPatient.age}
                  onChange={(e) => setEditingPatient({ ...editingPatient, age: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium mb-1">Unit</label>
                <select
                  value={editingPatient.ageType}
                  onChange={(e) => setEditingPatient({ ...editingPatient, ageType: e.target.value as AgeType })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Years">Years</option>
                  <option value="Months">Months</option>
                  <option value="Days">Days</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Gender</label>
                <select
                  value={editingPatient.gender}
                  onChange={(e) => setEditingPatient({ ...editingPatient, gender: e.target.value as PatientGender })}
                  className="w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">Phone</label>
              <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden">
                <span className="px-2.5 py-1.5 bg-slate-100 text-slate-600 font-mono border-r border-slate-300 select-none">
                  +977
                </span>
                <input
                  value={editingPatient.phone}
                  onChange={(e) => setEditingPatient({ ...editingPatient, phone: e.target.value })}
                  placeholder="98XXXXXXXX"
                  className="w-full px-3 py-1.5 font-mono focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">Address</label>
              <input
                value={editingPatient.address}
                onChange={(e) => setEditingPatient({ ...editingPatient, address: e.target.value })}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button type="button" onClick={() => setEditingPatient(null)} className="px-3 py-1.5 border border-slate-300 rounded-lg">
                Cancel
              </button>
              <button type="submit" className="px-4 py-1.5 bg-blue-600 text-white rounded-lg font-medium">
                Save Patient Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Admin Delete Confirmation */}
      {deletingPatient && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setDeletingPatient(null)}
        >
          <div
            className="bg-white border border-rose-200 rounded-xl w-full max-w-sm p-5 space-y-3 text-xs shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-rose-900">Delete Patient Master Record?</h3>
              <button
                type="button"
                onClick={() => setDeletingPatient(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-slate-600">
              Permanently remove <strong>{deletingPatient.fullName}</strong> (<span className="font-mono">{deletingPatient.uhid}</span>) from Patient Master? This Admin-only action is audit logged.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setDeletingPatient(null)} className="px-3 py-1.5 border border-slate-300 rounded-lg">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePatient}
                className="px-4 py-1.5 bg-rose-600 text-white rounded-lg font-medium"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scheduled Appointments Queue */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-amber-50/60 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-amber-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              Patient Appointments Queue ({(db.appointments || []).length})
            </h2>
          </div>
          <span className="text-[11px] text-slate-600">
            Book appointments from Patient Intake directory &amp; 1-click Check-In directly to OPD
          </span>
        </div>
        {(db.appointments || []).length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            No appointments scheduled yet. Click <strong>Appt</strong> on any patient row above to schedule.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2 px-4">Appt #</th>
                  <th className="py-2 px-4">Patient &amp; UHID</th>
                  <th className="py-2 px-4">Doctor &amp; Dept</th>
                  <th className="py-2 px-4">Date &amp; Time Slot</th>
                  <th className="py-2 px-4">Status</th>
                  <th className="py-2 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(db.appointments || []).map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 font-mono font-bold text-amber-800">{a.appointmentNumber}</td>
                    <td className="py-2 px-4">
                      <div className="font-semibold text-slate-900">{a.patientName}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        {a.uhid || '—'} · {a.patientPhone}
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <div className="font-medium text-slate-900">{a.doctorName}</div>
                      <div className="text-[11px] text-slate-500">{a.department}</div>
                    </td>
                    <td className="py-2 px-4 font-mono">
                      <div>{a.appointmentDateBs} BS ({a.appointmentDateAd})</div>
                      <div className="text-[11px] text-blue-700 font-semibold">{a.timeSlot}</div>
                    </td>
                    <td className="py-2 px-4">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          a.status === 'Checked-In' || a.status === 'Completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : a.status === 'Cancelled'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {a.status === 'Scheduled' && (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleAppointmentStatus(a, 'Checked-In')}
                              className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600 text-white rounded hover:bg-indigo-700"
                            >
                              Check-In → OPD
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleAppointmentStatus(a, 'Cancelled')}
                              className="px-2 py-1 text-[11px] font-medium text-rose-700 bg-rose-50 border border-rose-200 rounded hover:bg-rose-100"
                            >
                              Cancel
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Book Appointment Modal */}
      {apptTarget && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          onClick={() => setApptTarget(null)}
        >
          <form
            onSubmit={handleBookAppointment}
            onClick={(e) => e.stopPropagation()}
            className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-5 space-y-3 text-xs shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-amber-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Book Appointment — {apptTarget.uhid} ({apptTarget.fullName})
                </h3>
              </div>
              <button type="button" onClick={() => setApptTarget(null)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Department *</label>
                <select
                  value={apptDept}
                  onChange={(e) => setApptDept(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  <option>General Medicine OPD</option>
                  <option>Cardiology OPD</option>
                  <option>Pediatrics OPD</option>
                  <option>Obstetrics &amp; Gynecology</option>
                  <option>Orthopedics OPD</option>
                  <option>Emergency &amp; Follow-up</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Consulting Doctor *</label>
                <select
                  value={apptDoctor}
                  onChange={(e) => setApptDoctor(e.target.value)}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                >
                  {doctorOptions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Appointment Date (AD) *</label>
                <input
                  type="date"
                  required
                  value={apptDateAd}
                  onChange={(e) => setApptDateAd(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Time Slot *</label>
                <select
                  value={apptSlot}
                  onChange={(e) => setApptSlot(e.target.value)}
                  className="w-full px-2.5 py-2 font-mono bg-white border border-slate-300 rounded-lg"
                >
                  <option>09:00 AM</option>
                  <option>10:00 AM</option>
                  <option>11:00 AM</option>
                  <option>12:00 PM</option>
                  <option>02:00 PM</option>
                  <option>03:30 PM</option>
                  <option>05:00 PM</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Visit Reason / Notes</label>
                <input
                  value={apptReason}
                  onChange={(e) => setApptReason(e.target.value)}
                  placeholder="e.g., Follow-up blood pressure check / Lab review"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setApptTarget(null)}
                className="px-3.5 py-1.5 border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingAppt}
                className="px-4 py-1.5 font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {savingAppt ? 'Scheduling...' : 'Confirm Appointment'}
              </button>
            </div>
          </form>
        </div>
      )}

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
                  Select Patient for Thermal Sticker Printer
                </h3>
                <p className="text-[11px] text-slate-500">
                  Standalone 50×30mm / 58×40mm barcode label (separate from A4 summaries)
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
                  placeholder="Search patient by UHID, Name, or Phone..."
                  className="w-full pl-8 pr-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {(db.patients || [])
                  .filter((p) => {
                    const q = stickerPickerSearch.trim().toLowerCase();
                    if (!q) return true;
                    return `${p.uhid} ${p.fullName} ${p.phone}`.toLowerCase().includes(q);
                  })
                  .slice(0, 25)
                  .map((p) => (
                    <div
                      key={p.id}
                      className="px-3.5 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 truncate">{p.fullName}</div>
                        <div className="text-[11px] font-mono text-slate-500 truncate">
                          {p.uhid} · {p.age}{p.ageType.charAt(0)}/{p.gender.charAt(0)} · {p.phone || 'No phone'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setStickerPickerOpen(false);
                          setStickerPatient(p);
                        }}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <Tag className="w-3 h-3" />
                        Print Sticker
                      </button>
                    </div>
                  ))}
                {(db.patients || []).length === 0 && (
                  <div className="p-6 text-center text-xs text-slate-500">
                    Register a patient first to print thermal stickers.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {stickerPatient && (
        <ThermalStickerPrintModal
          uhid={stickerPatient.uhid}
          patientName={stickerPatient.fullName}
          ageGender={`${stickerPatient.age}${stickerPatient.ageType.charAt(0)}/${stickerPatient.gender.charAt(0)}`}
          encounterLabel="PATIENT INTAKE"
          doctorOrUnit={stickerPatient.phone}
          dateIso={stickerPatient.createdAt}
          settings={db.settings}
          onClose={() => setStickerPatient(null)}
        />
      )}

      {longitudinalPatient && (
        <PatientLongitudinalDashboard
          patient={longitudinalPatient}
          db={db}
          onClose={() => setLongitudinalPatient(null)}
          onRouteToBilling={(target, payload) => {
            setLongitudinalPatient(null);
            onRouteToBilling(target, payload);
          }}
          onOpenReport={onOpenReport}
          onOpenBill={onOpenBill}
        />
      )}
    </div>
  );
}
