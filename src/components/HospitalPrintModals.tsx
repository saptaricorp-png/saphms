import React, { useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import type {
  BirthCertificateRecord,
  DartaChalaniEntry,
  DeathCertificateRecord,
  Dhis2MonthlyReport,
  EmergencyCase,
  GatepassVisitorRecord,
  HospitalBed,
  HospitalConsentRecord,
  HrCertificateRecord,
  IpdAdmission,
  LabSettings,
  LimsDatabase,
  OpdVisit,
} from '../types/lims';
import { adToBs, formatNpr } from '../utils/nepaliDate';
import { BarcodeSvg, QrCodeSvg } from './DocumentCodes';
import { getPrintHeaderTitle, sanitizePrintText } from '../utils/printSanitizer';
import { executeSmartPrint } from '../utils/printHelper';
import { exportLetterToDocx } from '../utils/wordExport';

function HospitalLetterheadHeader({
  settings,
  refCode,
  qrText,
  rightTitle,
}: {
  settings: LabSettings;
  refCode: string;
  qrText: string;
  rightTitle?: string;
}) {
  const safeTitle = getPrintHeaderTitle(settings.labName, null, 'CLINICAL & DIAGNOSTIC CENTER');
  const safeTitleNp = sanitizePrintText(settings.labNameNp);
  const safeAddress = sanitizePrintText(settings.addressLine);
  const safeContact = sanitizePrintText(settings.contactLine);
  const safeAccred = sanitizePrintText(settings.accreditationLine);
  return (
    <div className="border-b-2 border-blue-800 pb-3 flex items-start justify-between gap-4">
      <div className="flex items-start gap-2.5 min-w-0">
        {settings.moduleSettings?.hospitalLogoDataUrl && (
          <img
            src={settings.moduleSettings.hospitalLogoDataUrl}
            alt={safeTitle}
            className="w-11 h-11 object-contain shrink-0 rounded border border-slate-200 p-0.5 bg-white"
          />
        )}
        <div className="space-y-0.5 min-w-0">
          {safeTitleNp && (
            <div className="text-[11px] font-bold text-blue-800 tracking-wide">{safeTitleNp}</div>
          )}
          <div className="text-base font-bold text-slate-900 leading-tight">{safeTitle}</div>
          {safeAddress && <div className="text-[10px] text-slate-700">{safeAddress}</div>}
          {safeContact && <div className="text-[10px] text-slate-600">{safeContact}</div>}
          <div className="text-[10px] text-slate-600">
            PAN: <span className="font-mono font-semibold">{settings.panNumber}</span>
            {safeAccred ? ` · ${safeAccred}` : ''}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right space-y-1">
          {rightTitle && <div className="text-[10px] font-bold uppercase text-blue-800">{rightTitle}</div>}
          <BarcodeSvg value={refCode} width={120} height={24} />
        </div>
        <QrCodeSvg value={qrText} size={50} />
      </div>
    </div>
  );
}

function PrintModalShell({
  title,
  subtitle,
  allowLetterheadToggle = true,
  defaultPaperSize = 'A4',
  autoPrint = false,
  settings,
  onClose,
  renderSheets,
  extraToolbarButtons,
}: {
  title: string;
  subtitle: string;
  allowLetterheadToggle?: boolean;
  defaultPaperSize?: 'A5' | 'A4';
  autoPrint?: boolean;
  settings: LabSettings;
  onClose: () => void;
  renderSheets: (letterhead: 'with' | 'without', paperSize: 'A5' | 'A4') => React.ReactNode;
  extraToolbarButtons?: React.ReactNode;
}) {
  const [letterheadMode, setLetterheadMode] = useState<'with' | 'without'>(
    settings.moduleSettings?.printOptions?.defaultLetterheadMode === 'without-letterhead' ? 'without' : 'with'
  );
  const [paperSize, setPaperSize] = useState<'A5' | 'A4'>(defaultPaperSize);
  const autoPrintedRef = React.useRef(false);
  const printableRef = React.useRef<HTMLDivElement | null>(null);
  const pageCssSize = paperSize === 'A5' ? 'A5 portrait' : 'A4 portrait';

  const triggerSmartPrint = () => {
    executeSmartPrint({
      element: printableRef.current,
      pageCssSize,
      documentTitle: title,
    });
  };

  React.useEffect(() => {
    if (!autoPrint || autoPrintedRef.current) return;
    const t = window.setTimeout(() => {
      if (!autoPrintedRef.current) {
        autoPrintedRef.current = true;
        triggerSmartPrint();
      }
    }, 240);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);
  const content = renderSheets(letterheadMode, paperSize);

  return (
    <>
      <div className="no-print fixed inset-0 z-50 bg-slate-950/70 flex flex-col">
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as 'A5' | 'A4')}
              className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white text-slate-800"
            >
              <option value="A5">A5 Portrait Full</option>
              <option value="A4">A4 Portrait</option>
            </select>
            {allowLetterheadToggle && (
              <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs">
                <button
                  type="button"
                  onClick={() => setLetterheadMode('with')}
                  className={`px-3 py-1.5 font-medium ${
                    letterheadMode === 'with' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
                  }`}
                >
                  With Letterhead
                </button>
                <button
                  type="button"
                  onClick={() => setLetterheadMode('without')}
                  className={`px-3 py-1.5 font-medium ${
                    letterheadMode === 'without' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
                  }`}
                >
                  Without Letterhead ({settings.prePrintedTopMarginMm || 35}mm)
                </button>
              </div>
            )}
            {extraToolbarButtons}
            <button
              type="button"
              onClick={triggerSmartPrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print {paperSize} Document
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              aria-label="Close print preview"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto bg-slate-200 p-6 space-y-6">
          <div ref={printableRef} className="space-y-6">
            {content}
          </div>
        </div>
      </div>
    </>
  );
}

// 1. Official Police MLC Intimation Print Modal
export function MlcPolicePrintModal({
  erCase,
  settings,
  onClose,
}: {
  erCase: EmergencyCase;
  settings: LabSettings;
  onClose: () => void;
}) {
  const arrivalBs = adToBs(erCase.registeredAt);
  const informedBs = erCase.policeInformedAt ? adToBs(erCase.policeInformedAt) : null;
  const refNo = erCase.mlcNumber || erCase.erNumber;

  return (
    <PrintModalShell
      title={`Police MLC Intimation Form — ${refNo}`}
      subtitle={`${erCase.policeStationName || 'Nepal Police'} · ${erCase.patientName}`}
      settings={settings}
      onClose={onClose}
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '10mm',
          }}
        >
          <div className="space-y-4">
            {lh === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={refNo}
                qrText={`MLC|${refNo}|${erCase.patientName}|STATION:${erCase.policeStationName || ''}|REF:${erCase.policeInformedNumber || 'PENDING'}`}
                rightTitle="MEDICO-LEGAL CASE"
              />
            )}

            <div className="text-center border-y border-slate-400 py-1.5 bg-slate-50">
              <div className="text-xs font-bold tracking-wider uppercase">
                MEDICO-LEGAL CASE (MLC) — OFFICIAL POLICE INTIMATION SLIP
              </div>
              <div className="text-[10px] text-slate-600">
                (चिकित्सा-कानुनी घटना विवरण तथा प्रहरी जानकारी पत्र)
              </div>
            </div>

            <div className="border-2 border-slate-800 rounded-lg p-3 bg-slate-50 space-y-1.5 text-[11px]">
              <div className="font-bold uppercase text-slate-900 text-[10px] tracking-wide">
                TO: THE OFFICER-IN-CHARGE — AUTO-ROUTED POLICE JURISDICTION
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="text-slate-600">Police Station:</span>{' '}
                  <strong className="text-slate-900">{erCase.policeStationName || 'Ilaka Prahari Karyalaya, Bode Barsain'}</strong>
                </div>
                <div>
                  <span className="text-slate-600">Station Phone:</span>{' '}
                  <strong className="font-mono">{erCase.policeStationPhone || '031-560100'}</strong>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-600">Jurisdiction Address:</span>{' '}
                  <span>{sanitizePrintText(erCase.policeStationAddress, 'Local Police Station Jurisdiction')}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-x-4 gap-y-2 border border-slate-300 rounded-lg p-3 text-[11px]">
              <div>
                <span className="text-slate-500">MLC Register #:</span>{' '}
                <strong className="font-mono">{erCase.mlcNumber || 'PENDING MLC #'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Emergency #:</span>{' '}
                <strong className="font-mono">{erCase.erNumber}</strong>
              </div>
              <div>
                <span className="text-slate-500">Triage Level:</span>{' '}
                <strong>{erCase.triageLevel}</strong>
              </div>
              <div>
                <span className="text-slate-500">Police Informed Status:</span>{' '}
                <strong className={erCase.policeInformed ? 'text-emerald-700' : 'text-rose-700'}>
                  {erCase.policeInformed ? 'INFORMED & LOGGED' : 'NOT YET INFORMED'}
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Police Informed Ref #:</span>{' '}
                <strong className="font-mono">{erCase.policeInformedNumber || '________________'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Informed Date/Time (BS):</span>{' '}
                <strong className="font-mono">
                  {informedBs ? `${informedBs.formattedEn} · ${informedBs.timeEn}` : '________________'}
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Receiving Police Officer:</span>{' '}
                <strong>{erCase.policeOfficerName || '________________'}</strong>
              </div>
              <div>
                <span className="text-slate-500">Mode of Intimation:</span>{' '}
                <span>{erCase.policeInformMode || 'Telephone Call / Written Slip'}</span>
              </div>
              <div>
                <span className="text-slate-500">Informed Date (AD):</span>{' '}
                <span className="font-mono">
                  {erCase.policeInformedAt ? new Date(erCase.policeInformedAt).toLocaleString() : '________________'}
                </span>
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-3 space-y-2 text-[11px]">
              <div className="text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200 pb-1">
                Patient, Incident &amp; Forensic Identification Particulars
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="text-slate-500">Patient Name:</span> <strong>{erCase.patientName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Age / Sex:</span>{' '}
                  <strong className="font-mono">
                    {erCase.patientAge} {erCase.patientAgeType} / {erCase.patientGender}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Phone:</span>{' '}
                  <span className="font-mono">{erCase.patientPhone || '—'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Permanent Address:</span> {erCase.patientAddress}
                </div>
                <div>
                  <span className="text-slate-500">Arrival (BS):</span>{' '}
                  <span className="font-mono">
                    {arrivalBs.formattedEn} · {arrivalBs.timeEn}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">MLC Nature / Type:</span>{' '}
                  <strong>{erCase.mlcCaseType || 'Medico-Legal'}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Place of Incident:</span>{' '}
                  <strong>{erCase.incidentPlace || erCase.patientAddress}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Incident Time:</span>{' '}
                  <span>{erCase.incidentTimeText || arrivalBs.timeEn}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-500">Brought By / Escort:</span>{' '}
                  <span>
                    {erCase.broughtByName || '—'} ({erCase.broughtByRelation || 'Escort'}) ·{' '}
                    {erCase.broughtByPhone || '—'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Identification Mark:</span>{' '}
                  <span>{erCase.identificationMarks || 'Recorded in ER Chart'}</span>
                </div>
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-3 space-y-2 text-[11px]">
              <div className="text-[10px] font-bold uppercase text-slate-700 border-b border-slate-200 pb-1">
                Clinical Examination, Vitals &amp; Injury Summary
              </div>
              <div className="font-mono text-[10px] bg-slate-50 p-2 rounded border border-slate-200">
                Vitals at Arrival: BP {erCase.vitals.bp || '—'} mmHg · Pulse {erCase.vitals.pulseBpm || '—'} bpm · Temp{' '}
                {erCase.vitals.tempF || '—'}°F · SpO₂ {erCase.vitals.spo2Pct || '—'}% · RR{' '}
                {erCase.vitals.respRate || '—'}/min
              </div>
              <div>
                <strong>Chief Complaint:</strong> {erCase.chiefComplaint}
              </div>
              <div>
                <strong>Medico-Legal Injury Description:</strong>{' '}
                {erCase.injurySummary || erCase.clinicalNotes}
              </div>
              <div>
                <strong>Emergency Care &amp; Disposition:</strong> {erCase.clinicalNotes} · Status:{' '}
                <strong>{erCase.disposition}</strong>
              </div>
            </div>
          </div>

          <div className="space-y-4 pt-6 border-t border-slate-300 text-[10px]">
            <div className="grid grid-cols-3 gap-6 pt-4">
              <div>
                <div className="border-t border-slate-500 pt-1 font-semibold">
                  Examining Medical Officer (ER)
                </div>
                <div className="text-slate-600">{erCase.attendingDoctor}</div>
                <div className="text-slate-500">{sanitizePrintText(settings.labName, 'Emergency Department')}</div>
              </div>
              <div>
                <div className="border-t border-slate-500 pt-1 font-semibold">
                  Police Receiving Officer Acknowledgement
                </div>
                <div className="text-slate-600">
                  Name / Rank: {erCase.policeOfficerName || '____________________'}
                </div>
                <div className="text-slate-500">Station Seal, Date &amp; Time</div>
              </div>
              <div className="text-right">
                <div className="border-t border-slate-500 pt-1 font-semibold">
                  Patient / Escort Witness
                </div>
                <div className="text-slate-600">{erCase.broughtByName || erCase.patientName}</div>
                <div className="text-slate-500">Thumbprint / Signature</div>
              </div>
            </div>
            <div className="text-center text-[9px] text-slate-500">
              {sanitizePrintText(settings.addressLine)} · {sanitizePrintText(settings.contactLine)}
            </div>
          </div>
        </div>
      )}
    />
  );
}

// 2. IPD Nursing Chart Flowsheet Print Modal
export function NursingChartPrintModal({
  admission,
  settings,
  onClose,
}: {
  admission: IpdAdmission;
  settings: LabSettings;
  onClose: () => void;
}) {
  const charts = admission.nursingCharts || [];
  const totIn = charts.reduce((s, n) => s + (n.intakeOralMl || 0) + (n.intakeIvMl || 0), 0);
  const totOut = charts.reduce((s, n) => s + (n.outputUrineMl || 0) + (n.outputDrainMl || 0), 0);

  return (
    <PrintModalShell
      title={`IPD Nursing Chart & I/O Flowsheet — ${admission.admissionNumber}`}
      subtitle={`${admission.patientName} · Bed ${admission.currentBedLabel} (${admission.currentWardName})`}
      settings={settings}
      onClose={onClose}
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '10mm',
          }}
        >
          <div className="space-y-4">
            {lh === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={admission.admissionNumber}
                qrText={`NURSING|${admission.admissionNumber}|${admission.patientName}|BED:${admission.currentBedLabel}`}
                rightTitle="IPD NURSING FLOWSHEET"
              />
            )}

            <div className="text-center border-y border-slate-300 py-1.5 bg-slate-50 text-xs font-bold uppercase tracking-wider">
              INPATIENT NURSING OBSERVATION, VITAL SIGNS (TPR/BP) &amp; INTAKE-OUTPUT CHART
            </div>

            <div className="grid grid-cols-3 gap-2 text-[10px] border border-slate-300 rounded-lg p-2.5 bg-slate-50">
              <div>
                Patient: <strong>{admission.patientName}</strong>
              </div>
              <div>
                Age/Sex:{' '}
                <strong className="font-mono">
                  {admission.patientAge} {admission.patientAgeType} / {admission.patientGender}
                </strong>
              </div>
              <div>
                IPD #: <strong className="font-mono">{admission.admissionNumber}</strong>
              </div>
              <div>
                Ward / Bed: <strong>{admission.currentWardName} · {admission.currentBedLabel}</strong>
              </div>
              <div>
                Admitting Doctor: <strong>{admission.admittingDoctor}</strong>
              </div>
              <div className="font-mono">
                Cumulative Balance: <strong>+{totIn} / −{totOut} mL ({totIn - totOut >= 0 ? '+' : ''}{totIn - totOut} mL)</strong>
              </div>
            </div>

            <table className="w-full border border-slate-300 text-[9.5px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-1.5 text-left border-b border-slate-300">Date (BS) &amp; Shift</th>
                  <th className="p-1.5 text-left border-b border-slate-300">Temp / Pulse / RR</th>
                  <th className="p-1.5 text-left border-b border-slate-300">BP / SpO₂ / GCS</th>
                  <th className="p-1.5 text-right border-b border-slate-300">Intake (Oral/IV)</th>
                  <th className="p-1.5 text-right border-b border-slate-300">Output (Urine/Drain)</th>
                  <th className="p-1.5 text-left border-b border-slate-300">Nursing Care &amp; Remarks</th>
                  <th className="p-1.5 text-left border-b border-slate-300">Nurse</th>
                </tr>
              </thead>
              <tbody>
                {charts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-slate-500">
                      No nursing chart records logged for this admission yet.
                    </td>
                  </tr>
                ) : (
                  charts.map((nc) => {
                    const bs = adToBs(nc.recordedAt);
                    return (
                      <tr key={nc.id} className="border-b border-slate-200 align-top">
                        <td className="p-1.5 font-mono">
                          <div>{bs.formattedEn}</div>
                          <div className="font-semibold text-slate-700">{nc.shift} ({bs.timeEn})</div>
                        </td>
                        <td className="p-1.5 font-mono">
                          {nc.tempF || '—'}°F · {nc.pulseBpm || '—'} bpm · RR {nc.respRate || '—'}
                        </td>
                        <td className="p-1.5 font-mono">
                          {nc.bp || '—'} · {nc.spo2Pct || '—'}% · GCS {nc.gcsScore || '15/15'}
                        </td>
                        <td className="p-1.5 text-right font-mono tabular-nums">
                          {(nc.intakeOralMl || 0) + (nc.intakeIvMl || 0)} mL
                          <div className="text-[8.5px] text-slate-500">
                            ({nc.intakeOralMl || 0}/{nc.intakeIvMl || 0})
                          </div>
                        </td>
                        <td className="p-1.5 text-right font-mono tabular-nums">
                          {(nc.outputUrineMl || 0) + (nc.outputDrainMl || 0)} mL
                          <div className="text-[8.5px] text-slate-500">
                            ({nc.outputUrineMl || 0}/{nc.outputDrainMl || 0})
                          </div>
                        </td>
                        <td className="p-1.5">{nc.nursingCareNote}</td>
                        <td className="p-1.5">{nc.recordedBy}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pt-4 border-t border-slate-300 flex justify-between items-end text-[10px]">
            <div>
              <div className="font-semibold">Ward Nursing In-Charge</div>
              <div className="text-slate-500 mt-3">Signature &amp; NNC Reg #</div>
            </div>
            <div className="text-slate-500">
              {sanitizePrintText(settings.addressLine, 'Inpatient Nursing Flowsheet')}
            </div>
            <div className="text-right">
              <div className="font-semibold">Treating Physician Review</div>
              <div className="text-slate-500 mt-3">{admission.admittingDoctor}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// 3. Ward & Bed Census Summary Print Modal
export function BedSummaryPrintModal({
  beds,
  admissions,
  settings,
  onClose,
}: {
  beds: HospitalBed[];
  admissions: IpdAdmission[];
  settings: LabSettings;
  onClose: () => void;
}) {
  const bsNow = adToBs(new Date());
  const wardGroups = Array.from(new Set(beds.map((b) => b.wardName))).map((ward) => {
    const wb = beds.filter((b) => b.wardName === ward);
    const occ = wb.filter((b) => b.status === 'Occupied').length;
    const avail = wb.filter((b) => b.status === 'Available').length;
    const clean = wb.filter((b) => b.status === 'Cleaning').length;
    const maint = wb.filter((b) => b.status === 'Maintenance').length;
    return {
      ward,
      wardType: wb[0]?.wardType || 'General Ward',
      total: wb.length,
      occ,
      avail,
      clean,
      maint,
      pct: wb.length > 0 ? Math.round((occ / wb.length) * 100) : 0,
    };
  });

  const occTotal = beds.filter((b) => b.status === 'Occupied').length;
  const pctTotal = beds.length > 0 ? Math.round((occTotal / beds.length) * 100) : 0;

  return (
    <PrintModalShell
      title="Hospital Ward & Bed Census Summary Report"
      subtitle={`${beds.length} Total Beds · ${occTotal} Occupied (${pctTotal}% Occupancy) · ${bsNow.formattedEn}`}
      settings={settings}
      onClose={onClose}
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '10mm',
          }}
        >
          <div className="space-y-4">
            {lh === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={`BED-CENSUS-${bsNow.year}`}
                qrText={`BEDS|TOTAL:${beds.length}|OCC:${occTotal}|DATE:${bsNow.formattedEn}`}
                rightTitle="WARD & BED CENSUS"
              />
            )}

            <div className="text-center border-y border-slate-300 py-1.5 bg-slate-50 text-xs font-bold uppercase tracking-wider">
              HOSPITAL WARD &amp; BED OCCUPANCY CENSUS SUMMARY — {bsNow.formattedEn} ({bsNow.timeEn})
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase text-slate-700 mb-1">
                Ward-Wise Bed Availability &amp; Occupancy Breakdown
              </div>
              <table className="w-full border border-slate-300 text-[10px]">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-1.5 text-left border-b border-slate-300">Ward Name</th>
                    <th className="p-1.5 text-left border-b border-slate-300">Ward Type</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Total Beds</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Occupied</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Available</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Cleaning</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Maint.</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Occupancy %</th>
                  </tr>
                </thead>
                <tbody>
                  {wardGroups.map((w) => (
                    <tr key={w.ward} className="border-b border-slate-200">
                      <td className="p-1.5 font-semibold">{w.ward}</td>
                      <td className="p-1.5">{w.wardType}</td>
                      <td className="p-1.5 text-right font-mono tabular-nums">{w.total}</td>
                      <td className="p-1.5 text-right font-mono tabular-nums text-blue-700 font-bold">{w.occ}</td>
                      <td className="p-1.5 text-right font-mono tabular-nums text-emerald-700 font-bold">{w.avail}</td>
                      <td className="p-1.5 text-right font-mono tabular-nums">{w.clean}</td>
                      <td className="p-1.5 text-right font-mono tabular-nums">{w.maint}</td>
                      <td className="p-1.5 text-right font-mono tabular-nums font-bold">{w.pct}%</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 font-bold">
                    <td colSpan={2} className="p-1.5">HOSPITAL TOTAL</td>
                    <td className="p-1.5 text-right font-mono">{beds.length}</td>
                    <td className="p-1.5 text-right font-mono">{occTotal}</td>
                    <td className="p-1.5 text-right font-mono">{beds.filter((b) => b.status === 'Available').length}</td>
                    <td className="p-1.5 text-right font-mono">{beds.filter((b) => b.status === 'Cleaning').length}</td>
                    <td className="p-1.5 text-right font-mono">{beds.filter((b) => b.status === 'Maintenance').length}</td>
                    <td className="p-1.5 text-right font-mono">{pctTotal}%</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <div className="text-[10px] font-bold uppercase text-slate-700 mb-1">
                Bed-by-Bed Census Roster ({beds.length} Beds)
              </div>
              <table className="w-full border border-slate-300 text-[9.5px]">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-1.5 text-left border-b border-slate-300">Bed Code</th>
                    <th className="p-1.5 text-left border-b border-slate-300">Ward &amp; Floor</th>
                    <th className="p-1.5 text-left border-b border-slate-300">Facilities</th>
                    <th className="p-1.5 text-right border-b border-slate-300">Tariff/Day</th>
                    <th className="p-1.5 text-left border-b border-slate-300">Status</th>
                    <th className="p-1.5 text-left border-b border-slate-300">Admitted Patient / Doctor</th>
                  </tr>
                </thead>
                <tbody>
                  {beds.map((b) => {
                    const adm = b.currentAdmissionId
                      ? admissions.find((a) => a.id === b.currentAdmissionId)
                      : undefined;
                    return (
                      <tr key={b.id} className="border-b border-slate-200">
                        <td className="p-1.5 font-mono font-bold">{b.bedCode}</td>
                        <td className="p-1.5">{b.wardName} ({b.floorLabel})</td>
                        <td className="p-1.5">
                          {b.hasOxygen ? 'O2 ' : ''}
                          {b.hasMonitor ? '· Monitor' : ''}
                          {!b.hasOxygen && !b.hasMonitor ? 'Standard' : ''}
                        </td>
                        <td className="p-1.5 text-right font-mono">रू {b.dailyRateNpr.toLocaleString()}</td>
                        <td className="p-1.5 font-semibold">{b.status}</td>
                        <td className="p-1.5">
                          {adm ? `${adm.patientName} (${adm.admissionNumber}) · ${adm.admittingDoctor}` : b.currentPatientName || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-300 flex justify-between items-end text-[10px]">
            <div>
              <div className="font-semibold">Nursing Supervisor / Bed Desk</div>
              <div className="text-slate-500 mt-3">Verified On: {bsNow.formattedEn}</div>
            </div>
            <div className="text-slate-500">
              {sanitizePrintText(settings.addressLine, 'Ward & Bed Census Report')}
            </div>
            <div className="text-right">
              <div className="font-semibold">Medical Superintendent</div>
              <div className="text-slate-500 mt-3">Authorized Signatory</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// 4. Auto-Set Case Consent Print Modal
export function ConsentPrintModal({
  consent,
  patientName,
  patientMeta,
  recordRef,
  settings,
  onClose,
}: {
  consent: HospitalConsentRecord;
  patientName: string;
  patientMeta: string;
  recordRef: string;
  settings: LabSettings;
  onClose: () => void;
}) {
  return (
    <PrintModalShell
      title={`Hospital Informed Consent Form — ${consent.consentCode}`}
      subtitle={`${consent.title} · ${patientName}`}
      settings={settings}
      onClose={onClose}
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[16mm] py-[12mm] text-slate-900 flex flex-col justify-between"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '12mm',
          }}
        >
          <div className="space-y-5">
            {lh === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={consent.consentCode}
                qrText={`CONSENT|${consent.consentCode}|${recordRef}|${patientName}|${consent.status}`}
                rightTitle="INFORMED CONSENT"
              />
            )}

            <div className="text-center border-y border-slate-400 py-2 bg-slate-50">
              <div className="text-sm font-bold uppercase tracking-wide">{consent.title}</div>
              <div className="text-[10px] text-slate-600 mt-0.5">
                Consent Code: <span className="font-mono font-semibold">{consent.consentCode}</span> · Auto-Trigger Rule: {consent.autoReason}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-lg p-3 text-xs bg-slate-50/70">
              <div>
                <span className="text-slate-500">Patient Name:</span> <strong>{patientName}</strong>
              </div>
              <div>
                <span className="text-slate-500">Case Reference #:</span> <strong className="font-mono">{recordRef}</strong>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500">Demographics / Ward:</span> <span>{patientMeta}</span>
              </div>
              <div>
                <span className="text-slate-500">Status:</span>{' '}
                <strong className={consent.status === 'Signed & Verified' ? 'text-emerald-700' : 'text-amber-700'}>
                  {consent.status}
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Assigned Date (BS):</span>{' '}
                <span className="font-mono">{adToBs(consent.createdAt).formattedEn}</span>
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-4 space-y-3 text-xs leading-relaxed">
              <div className="font-bold uppercase text-slate-800 text-[11px]">
                Clinical Explanation &amp; Informed Declaration
              </div>
              <p className="text-slate-800">{consent.summaryText}</p>
              <p className="text-slate-700">
                I/We confirm that the treating clinical team at <strong>{sanitizePrintText(settings.labName, 'this hospital')}</strong> has explained the
                diagnosis, proposed procedures, alternative options, anticipated benefits, and material risks in a
                language clearly understood by me/us. All questions have been answered satisfactorily.
              </p>
            </div>

            <div className="border border-slate-300 rounded-lg p-4 grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-slate-500">Signer (Patient / Guardian):</div>
                <div className="font-bold text-slate-900 mt-0.5">{consent.patientOrGuardianName || '____________________'}</div>
                <div className="text-[11px] text-slate-600">Relation: {consent.relationship || 'Self / Next of Kin'}</div>
              </div>
              <div>
                <div className="text-slate-500">Verification &amp; Witness:</div>
                <div className="font-semibold text-slate-900 mt-0.5">Witness: {consent.witnessName || '____________________'}</div>
                <div className="text-[11px] text-slate-600">
                  Verified By: {consent.verifiedBy || '____________________'}
                  {consent.signedAt ? ` (${adToBs(consent.signedAt).formattedEn})` : ''}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6 pt-8 border-t border-slate-300 text-[10px]">
            <div>
              <div className="border-t border-slate-600 pt-1 font-semibold">Patient / Guardian Signature</div>
              <div className="text-slate-500">Left / Right Thumbprint &amp; Date</div>
            </div>
            <div>
              <div className="border-t border-slate-600 pt-1 font-semibold">Hospital Witness Signature</div>
              <div className="text-slate-500">{consent.witnessName || 'Duty Nurse / Coordinator'}</div>
            </div>
            <div className="text-right">
              <div className="border-t border-slate-600 pt-1 font-semibold">Explaining Doctor Verification</div>
              <div className="text-slate-500">{consent.verifiedBy || 'Medical Officer'}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// 5. Darta & Chalani Printable Modal (Individual Letter w/ Ref No & Attachments OR Full MIS Report)
export function DartaChalaniPrintModal({
  mode,
  entry,
  entries,
  settings,
  onClose,
}: {
  mode: 'LETTER' | 'MIS';
  entry?: DartaChalaniEntry | null;
  entries?: DartaChalaniEntry[];
  settings: LabSettings;
  onClose: () => void;
}) {
  const list = entries || [];
  const dartaCount = list.filter((e) => e.entryType === 'DARTA').length;
  const chalaniCount = list.filter((e) => e.entryType === 'CHALANI').length;
  const bsNow = adToBs(new Date());

  return (
    <PrintModalShell
      title={
        mode === 'LETTER' && entry
          ? `${entry.entryType} Official Correspondence — ${entry.entryNumber}`
          : 'Darta & Chalani MIS Summary Report'
      }
      subtitle={
        mode === 'LETTER' && entry
          ? `Ref No: ${entry.refNumber} · ${entry.partyName}`
          : `${dartaCount} Darta (Inward) · ${chalaniCount} Chalani (Outward)`
      }
      settings={settings}
      onClose={onClose}
      extraToolbarButtons={
        mode === 'LETTER' && entry ? (
          <button
            type="button"
            onClick={() => {
              void exportLetterToDocx({
                hospitalName: settings.labName,
                hospitalNameNp: settings.labNameNp,
                addressLine: settings.addressLine,
                contactLine: settings.contactLine,
                panNumber: settings.panNumber,
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
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download Word (.docx)
          </button>
        ) : undefined
      }
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[15mm] py-[11mm] text-slate-900 flex flex-col justify-between"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '11mm',
          }}
        >
          {mode === 'LETTER' && entry ? (
            <>
              <div className="space-y-4">
                {lh === 'with' && (
                  <HospitalLetterheadHeader
                    settings={settings}
                    refCode={entry.entryNumber}
                    qrText={`DC-${entry.entryType}|${entry.entryNumber}|REF:${entry.refNumber}|DATE:${entry.entryDateBs}`}
                    rightTitle={`${entry.entryType} DISPATCH`}
                  />
                )}

                <div className="flex justify-between items-start text-xs border-b border-slate-300 pb-2.5">
                  <div className="space-y-0.5">
                    <div>
                      <span className="text-slate-600">{entry.entryType === 'DARTA' ? 'दर्ता नं. (Darta No):' : 'चलानी नं. (Chalani No):'}</span>{' '}
                      <strong className="font-mono text-slate-900">{entry.entryNumber}</strong>
                    </div>
                    <div>
                      <span className="text-slate-600">पत्र संख्या (Ref No):</span>{' '}
                      <strong className="font-mono text-blue-800">{entry.refNumber}</strong>
                    </div>
                  </div>
                  <div className="text-right space-y-0.5">
                    <div>
                      <span className="text-slate-600">मिति (BS):</span>{' '}
                      <strong className="font-mono">{entry.entryDateBs}</strong>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono">
                      AD: {entry.entryDateAd} · Category: {entry.category}
                    </div>
                  </div>
                </div>

                <div className="border border-slate-300 rounded-lg p-3 bg-slate-50 text-xs space-y-1">
                  <div>
                    <span className="text-slate-600 font-semibold">
                      {entry.entryType === 'DARTA' ? 'पठाउने / प्राप्त संस्था (Sender):' : 'प्राप्त गर्ने कार्यालय / व्यक्ति (Recipient):'}
                    </span>{' '}
                    <strong className="text-slate-900">{entry.partyName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-600">ठेगाना (Address):</span> <span>{entry.partyAddress}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">विषय (Subject):</span>{' '}
                    <strong className="text-slate-900 underline">{entry.subject}</strong>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg p-4 min-h-[95mm] text-xs leading-relaxed whitespace-pre-wrap text-slate-900">
                  {entry.documentBody || 'No detailed written body provided.'}
                </div>

                <div className="border border-slate-300 rounded-lg p-3 space-y-2 text-[11px]">
                  <div className="font-bold uppercase text-slate-700 text-[10px]">
                    Attached Enclosures &amp; Documents ({entry.attachments.length})
                  </div>
                  {entry.attachments.length === 0 ? (
                    <div className="text-slate-500">No enclosure documents attached.</div>
                  ) : (
                    <div className="space-y-2">
                      {entry.attachments.map((att, idx) => (
                        <div key={att.id} className="border border-slate-200 rounded p-2 bg-slate-50">
                          <div className="flex justify-between font-medium">
                            <span>
                              {idx + 1}. {att.fileName} ({att.fileType})
                            </span>
                            <span className="font-mono text-[10px] text-slate-500">{adToBs(att.attachedAt).formattedEn}</span>
                          </div>
                          {att.note && <div className="text-slate-600 text-[10px] mt-0.5">{att.note}</div>}
                          {att.dataUrl && att.dataUrl.startsWith('data:image/') && (
                            <img
                              src={att.dataUrl}
                              alt={att.fileName}
                              className="mt-2 max-h-40 rounded border border-slate-300 object-contain"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {entry.remarks && (
                  <div className="text-[11px] text-slate-700">
                    <strong>Office Remarks:</strong> {entry.remarks}
                  </div>
                )}
              </div>

              <div className="pt-5 border-t border-slate-300 flex justify-between items-end text-[10px]">
                <div>
                  <div className="font-semibold">Prepared / Handled By</div>
                  <div className="text-slate-600 mt-3">{entry.handledBy} ({entry.department})</div>
                </div>
                <div className="text-slate-500">
                  {sanitizePrintText(settings.addressLine, 'Official Correspondence')}
                </div>
                <div className="text-right">
                  <div className="font-semibold">Hospital Authorized Signatory</div>
                  <div className="text-slate-500 mt-3">Seal &amp; Signature</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-4">
                {lh === 'with' && (
                  <HospitalLetterheadHeader
                    settings={settings}
                    refCode={`DC-MIS-${bsNow.year}`}
                    qrText={`DC-MIS|DARTA:${dartaCount}|CHALANI:${chalaniCount}|DATE:${bsNow.formattedEn}`}
                    rightTitle="DARTA-CHALANI MIS"
                  />
                )}
                <div className="text-center border-y border-slate-300 py-1.5 bg-slate-50 text-xs font-bold uppercase">
                  DARTA (INWARD) &amp; CHALANI (OUTWARD) CORRESPONDENCE MIS SUMMARY REPORT
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="border border-slate-300 rounded p-2">
                    <div className="text-[10px] text-slate-500">Total Correspondence</div>
                    <div className="font-mono font-bold text-sm">{list.length}</div>
                  </div>
                  <div className="border border-slate-300 rounded p-2">
                    <div className="text-[10px] text-slate-500">Darta (Inward)</div>
                    <div className="font-mono font-bold text-sm text-blue-700">{dartaCount}</div>
                  </div>
                  <div className="border border-slate-300 rounded p-2">
                    <div className="text-[10px] text-slate-500">Chalani (Outward)</div>
                    <div className="font-mono font-bold text-sm text-emerald-700">{chalaniCount}</div>
                  </div>
                  <div className="border border-slate-300 rounded p-2">
                    <div className="text-[10px] text-slate-500">Attached Files</div>
                    <div className="font-mono font-bold text-sm">
                      {list.reduce((s, e) => s + (e.attachments?.length || 0), 0)}
                    </div>
                  </div>
                </div>

                <table className="w-full border border-slate-300 text-[9.5px]">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="p-1.5 text-left border-b border-slate-300">Type &amp; No</th>
                      <th className="p-1.5 text-left border-b border-slate-300">Ref No</th>
                      <th className="p-1.5 text-left border-b border-slate-300">Date (BS)</th>
                      <th className="p-1.5 text-left border-b border-slate-300">Party / Office</th>
                      <th className="p-1.5 text-left border-b border-slate-300">Subject &amp; Body Summary</th>
                      <th className="p-1.5 text-center border-b border-slate-300">Docs</th>
                      <th className="p-1.5 text-left border-b border-slate-300">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((d) => (
                      <tr key={d.id} className="border-b border-slate-200 align-top">
                        <td className="p-1.5 font-mono font-bold">
                          <div>{d.entryType}</div>
                          <div className="text-slate-700">{d.entryNumber}</div>
                        </td>
                        <td className="p-1.5 font-mono">{d.refNumber}</td>
                        <td className="p-1.5 font-mono">{d.entryDateBs}</td>
                        <td className="p-1.5">
                          <div className="font-semibold">{d.partyName}</div>
                          <div className="text-slate-500">{d.category}</div>
                        </td>
                        <td className="p-1.5">
                          <div className="font-semibold">{d.subject}</div>
                          {d.documentBody && (
                            <div className="text-slate-600 line-clamp-2">{d.documentBody.slice(0, 120)}</div>
                          )}
                        </td>
                        <td className="p-1.5 text-center font-mono">{d.attachments.length}</td>
                        <td className="p-1.5">{d.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="pt-4 border-t border-slate-300 flex justify-between items-end text-[10px]">
                <div>Generated By Administration · {bsNow.formattedEn}</div>
                <div className="text-slate-500">{sanitizePrintText(settings.addressLine)}</div>
                <div>Authorized Signatory</div>
              </div>
            </>
          )}
        </div>
      )}
    />
  );
}

// 6. Birth & Death Certificate Print Modal
export function CertificatePrintModal({
  type,
  birthCert,
  deathCert,
  settings,
  onClose,
}: {
  type: 'BIRTH' | 'DEATH';
  birthCert?: BirthCertificateRecord | null;
  deathCert?: DeathCertificateRecord | null;
  settings: LabSettings;
  onClose: () => void;
}) {
  if (type === 'BIRTH' && !birthCert) return null;
  if (type === 'DEATH' && !deathCert) return null;
  const certNo = type === 'BIRTH' ? birthCert!.certificateNumber : deathCert!.certificateNumber;

  return (
    <PrintModalShell
      title={type === 'BIRTH' ? `Birth Certificate — ${certNo}` : `Medical Certificate of Death — ${certNo}`}
      subtitle={`${sanitizePrintText(settings.addressLine, 'Vital Records')} · ${certNo}`}
      settings={settings}
      onClose={onClose}
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border-4 border-double border-slate-700 px-[16mm] py-[12mm] text-slate-900 flex flex-col justify-between"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '12mm',
          }}
        >
          <div className="space-y-5">
            {lh === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={certNo}
                qrText={`${type}-CERT|${certNo}|${type === 'BIRTH' ? birthCert!.motherName : deathCert!.deceasedName}`}
                rightTitle={type === 'BIRTH' ? 'BIRTH RECORD' : 'MCCD DEATH RECORD'}
              />
            )}

            {type === 'BIRTH' && birthCert ? (
              <>
                <div className="text-center border-y-2 border-slate-800 py-2 bg-slate-50">
                  <div className="text-sm font-bold uppercase tracking-wider">HOSPITAL BIRTH NOTIFICATION &amp; CERTIFICATE</div>
                  <div className="text-[11px] text-slate-600">(अस्पताल जन्म प्रमाणपत्र)</div>
                </div>
                <p className="text-xs leading-relaxed">
                  This is to certify that a live baby was delivered at <strong>{sanitizePrintText(birthCert.placeOfBirth, 'Obstetric Unit')}</strong> as per
                  the hospital obstetric &amp; maternity register maintained at this facility.
                </p>
                <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-lg p-4 text-xs bg-slate-50/50">
                  <div>Certificate No: <strong className="font-mono">{birthCert.certificateNumber}</strong></div>
                  <div>Fiscal Year: <strong className="font-mono">{birthCert.fiscalYear}</strong></div>
                  <div>Child Name: <strong>{birthCert.babyName || `Baby of ${birthCert.motherName}`}</strong></div>
                  <div>Sex of Newborn: <strong>{birthCert.babyGender}</strong></div>
                  <div>Date of Birth (BS): <strong className="font-mono">{birthCert.birthDateBs}</strong></div>
                  <div>Date &amp; Time (AD): <strong className="font-mono">{birthCert.birthDateAd} · {birthCert.birthTime}</strong></div>
                  <div>Mother&apos;s Name: <strong>{birthCert.motherName}</strong> (Age {birthCert.motherAge} yrs)</div>
                  <div>Mother Citizenship #: <span className="font-mono">{birthCert.motherCitizenshipNo || '—'}</span></div>
                  <div>Father&apos;s Name: <strong>{birthCert.fatherName}</strong></div>
                  <div>Father Citizenship #: <span className="font-mono">{birthCert.fatherCitizenshipNo || '—'}</span></div>
                  <div className="col-span-2">Permanent Address: <strong>{birthCert.permanentAddress}</strong></div>
                  <div>Delivery Mode: <strong>{birthCert.deliveryType}</strong></div>
                  <div>Birth Weight: <strong className="font-mono">{birthCert.birthWeightKg.toFixed(2)} kg</strong> · APGAR {birthCert.apgar1Min}/{birthCert.apgar5Min}</div>
                </div>
              </>
            ) : deathCert ? (
              <>
                <div className="text-center border-y-2 border-slate-800 py-2 bg-slate-50">
                  <div className="text-sm font-bold uppercase tracking-wider">MEDICAL CERTIFICATE OF CAUSE OF DEATH (MCCD)</div>
                  <div className="text-[11px] text-slate-600">(अस्पताल मृत्यु प्रमाणपत्र)</div>
                </div>
                <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-lg p-4 text-xs bg-slate-50/50">
                  <div>Certificate No: <strong className="font-mono">{deathCert.certificateNumber}</strong></div>
                  <div>Fiscal Year: <strong className="font-mono">{deathCert.fiscalYear}</strong></div>
                  <div>Deceased Full Name: <strong>{deathCert.deceasedName}</strong></div>
                  <div>Age / Sex: <strong className="font-mono">{deathCert.age} {deathCert.ageType} / {deathCert.gender}</strong></div>
                  <div>Father / Spouse Name: <strong>{deathCert.fatherOrSpouseName}</strong></div>
                  <div>Citizenship #: <span className="font-mono">{deathCert.citizenshipNo || '—'}</span></div>
                  <div className="col-span-2">Permanent Address: <strong>{deathCert.permanentAddress}</strong></div>
                  <div>Date of Death (BS): <strong className="font-mono">{deathCert.deathDateBs}</strong></div>
                  <div>Date &amp; Time (AD): <strong className="font-mono">{deathCert.deathDateAd} · {deathCert.deathTime}</strong></div>
                  <div className="col-span-2">Ward / Place of Death: <strong>{deathCert.wardOrPlaceOfDeath}</strong></div>
                  <div className="col-span-2 border-t border-slate-300 pt-2">
                    <strong>Immediate Cause of Death:</strong> {deathCert.immediateCauseOfDeath}
                  </div>
                  {deathCert.antecedentCause && (
                    <div className="col-span-2">
                      <strong>Antecedent / Underlying Cause:</strong> {deathCert.antecedentCause}
                    </div>
                  )}
                  <div>Manner of Death: <strong>{deathCert.mannerOfDeath}</strong></div>
                  <div>MLC Case: <strong>{deathCert.isMlc ? `Yes (${deathCert.mlcNumber || 'MLC'}) · ${deathCert.policeStationNotified || ''}` : 'No'}</strong></div>
                  <div className="col-span-2 border-t border-slate-300 pt-2">
                    Body Handed Over To: <strong>{deathCert.bodyHandedOverTo}</strong> ({deathCert.handoverRelation}) · Ph:{' '}
                    <span className="font-mono">{deathCert.handoverPhone || '—'}</span>
                  </div>
                </div>
              </>
            ) : null}
          </div>

          <div className="grid grid-cols-3 gap-6 pt-8 border-t border-slate-300 text-[10px]">
            <div>
              <div className="border-t border-slate-600 pt-1 font-semibold">Issued By (Hospital Records)</div>
              <div className="text-slate-600">{type === 'BIRTH' ? birthCert!.issuedBy : deathCert!.issuedBy}</div>
            </div>
            <div className="text-center text-slate-500">
              Official Hospital Seal
            </div>
            <div className="text-right">
              <div className="border-t border-slate-600 pt-1 font-semibold">
                {type === 'BIRTH' ? 'Attending Physician / OBG' : `Certifying Physician (${deathCert!.doctorRegNo})`}
              </div>
              <div className="text-slate-600">{type === 'BIRTH' ? birthCert!.attendingDoctor : deathCert!.certifyingDoctor}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// 7. DHIS2 Offline HMIS Report — Strictly 2-Paper (2-Page A4) Printable Form for Bode Barsain Municipality Health Section
export function Dhis2MunicipalityPrintModal({
  report,
  settings,
  onClose,
}: {
  report: Dhis2MonthlyReport;
  settings: LabSettings;
  onClose: () => void;
}) {
  return (
    <PrintModalShell
      title={`DHIS2 / HMIS 2-Paper Municipality Form — ${report.reportCode}`}
      subtitle={`Paper 1 of 2 & Paper 2 of 2 · Addressed to Health Section, Bode Barsain Municipality`}
      allowLetterheadToggle={false}
      settings={settings}
      onClose={onClose}
      renderSheets={() => (
        <>
          {/* PAPER 1 OF 2 */}
          <div className="a4-sheet page-break-after bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between">
            <div className="space-y-3.5">
              <HospitalLetterheadHeader
                settings={settings}
                refCode={report.reportCode}
                qrText={`DHIS2-HMIS-BODEBARSAIN|${report.reportCode}|${report.bsMonthName}-${report.bsYear}|OPD:${report.opdNewMale + report.opdNewFemale}|IPD:${report.ipdTotalAdmissions}`}
                rightTitle="PAPER 1 OF 2"
              />

              <div className="text-center border-y-2 border-slate-900 py-1.5 bg-slate-50">
                <div className="text-xs font-bold uppercase tracking-wider">
                  GOVERNMENT OF NEPAL / HMIS-DHIS2 MONTHLY HEALTH FACILITY REPORTING FORM (NON-API OFFLINE)
                </div>
                <div className="text-[10px] font-semibold text-blue-900">
                  SUBMITTED TO: {report.municipalityTargetName} (स्वास्थ्य शाखा, बोदे बर्साइन नगरपालिका)
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 border border-slate-300 rounded-lg p-2.5 bg-slate-50 text-[10px]">
                <div>Report Code: <strong className="font-mono">{report.reportCode}</strong></div>
                <div>BS Period: <strong className="font-mono">{report.bsMonthName} {report.bsYear}</strong></div>
                <div>Fiscal Year: <strong className="font-mono">{report.fiscalYear}</strong></div>
                <div>Status: <strong>{report.status}</strong></div>
              </div>

              {/* Section A */}
              <div>
                <div className="text-[10px] font-bold uppercase bg-slate-100 border border-slate-300 px-2 py-1">
                  Section A: Outpatient (OPD) &amp; Emergency / Medico-Legal (MLC) Utilization
                </div>
                <table className="w-full border border-slate-300 border-t-0 text-[10px]">
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5 w-1/3">New OPD Visits — Female</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.opdNewFemale}</td>
                      <td className="p-1.5 w-1/3 border-l border-slate-200">New OPD Visits — Male</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.opdNewMale}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5">OPD Follow-up / Completed</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.opdFollowupTotal}</td>
                      <td className="p-1.5 border-l border-slate-200">Total OPD Cases Served</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.opdNewFemale + report.opdNewMale}</td>
                    </tr>
                    <tr>
                      <td className="p-1.5">Total Emergency (ER) Visits</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.emergencyTotalVisits}</td>
                      <td className="p-1.5 border-l border-slate-200">Medico-Legal Cases (MLC) Police Intimated</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.emergencyMlcCases}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Section B */}
              <div>
                <div className="text-[10px] font-bold uppercase bg-slate-100 border border-slate-300 px-2 py-1">
                  Section B: Inpatient (IPD), Bed Occupancy &amp; Referral Summary
                </div>
                <table className="w-full border border-slate-300 border-t-0 text-[10px]">
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5 w-1/3">Total IPD Admissions</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.ipdTotalAdmissions}</td>
                      <td className="p-1.5 w-1/3 border-l border-slate-200">Sanctioned Active Beds / Bed Days</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.ipdTotalBedsAvailable} / {report.ipdTotalBedDays}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5">Bed Occupancy Rate (%)</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.ipdBedOccupancyPercent}%</td>
                      <td className="p-1.5 border-l border-slate-200">Discharged Home</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.ipdDischargedHome}</td>
                    </tr>
                    <tr>
                      <td className="p-1.5">Referred to External / Higher Hospital</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.ipdReferredOut}</td>
                      <td className="p-1.5 border-l border-slate-200">LAMA / DOR Cases</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.ipdLamaCases}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Section C */}
              <div>
                <div className="text-[10px] font-bold uppercase bg-slate-100 border border-slate-300 px-2 py-1">
                  Section C: Safe Motherhood, Deliveries, Births &amp; Vital Events
                </div>
                <table className="w-full border border-slate-300 border-t-0 text-[10px]">
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5 w-1/3">Normal Vaginal Deliveries</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.normalDeliveries}</td>
                      <td className="p-1.5 w-1/3 border-l border-slate-200">Cesarean Section (LSCS)</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.cesareanDeliveries}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5">Live Births (Male / Female)</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.liveBirthsMale} M / {report.liveBirthsFemale} F</td>
                      <td className="p-1.5 border-l border-slate-200">Low Birth Weight (&lt; 2.5 kg)</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.lowBirthWeightCount}</td>
                    </tr>
                    <tr>
                      <td className="p-1.5">Institutional Deaths (Total)</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.institutionalDeaths}</td>
                      <td className="p-1.5 border-l border-slate-200">Maternal / Neonatal Deaths</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.maternalDeaths} / {report.neonatalDeaths}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Section D */}
              <div>
                <div className="text-[10px] font-bold uppercase bg-slate-100 border border-slate-300 px-2 py-1">
                  Section D: Laboratory, Radiology &amp; Separate Pharmacy Logistics
                </div>
                <table className="w-full border border-slate-300 border-t-0 text-[10px]">
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5 w-1/3">Pathology Lab Tests Completed</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.pathologyTestsDone}</td>
                      <td className="p-1.5 w-1/3 border-l border-slate-200">Digital X-Ray Studies</td>
                      <td className="p-1.5 font-mono font-bold text-right w-1/6">{report.xrayStudiesDone}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <td className="p-1.5">USG &amp; 2D Echo Studies</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.usgEchoDone}</td>
                      <td className="p-1.5 border-l border-slate-200">CT / ECG Investigations</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.ctEcgDone}</td>
                    </tr>
                    <tr>
                      <td className="p-1.5">Separate Pharmacy POS Bills</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.pharmacyBillsIssued}</td>
                      <td className="p-1.5 border-l border-slate-200">Pharmacy Essential Drug Stockouts</td>
                      <td className="p-1.5 font-mono font-bold text-right">{report.pharmacyStockoutItemsCount}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-300 flex justify-between items-center text-[9.5px] text-slate-600">
              <span>{sanitizePrintText(settings.addressLine, 'Health Facility')}</span>
              <span className="font-semibold">Paper 1 of 2 — Continued on Paper 2 for Morbidity &amp; Municipality Receipt Sign</span>
              <span className="font-mono">{report.reportCode}</span>
            </div>
          </div>

          {/* PAPER 2 OF 2 */}
          <div className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="border-b-2 border-blue-800 pb-2 flex justify-between items-center text-xs">
                <div>
                  <strong className="text-slate-900">DHIS2/HMIS Submission</strong> ({report.bsMonthName} {report.bsYear})
                </div>
                <div className="font-mono font-bold text-blue-800">PAPER 2 OF 2 · {report.reportCode}</div>
              </div>

              {/* Section E: Morbidity */}
              <div>
                <div className="text-[10px] font-bold uppercase bg-slate-100 border border-slate-300 px-2 py-1">
                  Section E: Communicable, Non-Communicable &amp; Trauma Morbidity Surveillance
                </div>
                <table className="w-full border border-slate-300 border-t-0 text-[10.5px]">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="p-2 text-left border-b border-slate-300">HMIS Morbidity Indicator Group</th>
                      <th className="p-2 text-right border-b border-slate-300">Case Count</th>
                      <th className="p-2 text-left border-b border-slate-300 border-l">HMIS Morbidity Indicator Group</th>
                      <th className="p-2 text-right border-b border-slate-300">Case Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-slate-200">
                      <td className="p-2">ARI / Pneumonia / Respiratory Infections</td>
                      <td className="p-2 text-right font-mono font-bold">{report.morbidityAriPneumonia}</td>
                      <td className="p-2 border-l border-slate-200">Diarrheal Disease / Acute Gastroenteritis</td>
                      <td className="p-2 text-right font-mono font-bold">{report.morbidityDiarrheaDysentery}</td>
                    </tr>
                    <tr className="border-b border-slate-200">
                      <td className="p-2">Hypertension &amp; Cardiovascular Disorders</td>
                      <td className="p-2 text-right font-mono font-bold">{report.morbidityHypertensionCvd}</td>
                      <td className="p-2 border-l border-slate-200">Diabetes Mellitus (New &amp; Follow-Up)</td>
                      <td className="p-2 text-right font-mono font-bold">{report.morbidityDiabetes}</td>
                    </tr>
                    <tr>
                      <td className="p-2">Road Traffic Accident (RTA) &amp; Physical Trauma</td>
                      <td className="p-2 text-right font-mono font-bold">{report.morbidityTraumaRta}</td>
                      <td className="p-2 border-l border-slate-200">Enteric Fever / Febrile Illness</td>
                      <td className="p-2 text-right font-mono font-bold">{report.morbidityEntericFever}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="border border-slate-300 rounded-lg p-3 text-[11px] bg-slate-50">
                <div className="font-bold uppercase text-[10px] text-slate-700 mb-1">
                  Hospital Submission Declaration &amp; Notes
                </div>
                <p>{report.remarks}</p>
                <div className="grid grid-cols-2 gap-6 mt-5 pt-3 border-t border-slate-300">
                  <div>
                    <div className="font-semibold text-slate-800">Prepared &amp; Compiled By:</div>
                    <div className="mt-4 font-medium">{report.preparedBy}</div>
                    <div className="text-[10px] text-slate-500">Medical Records / HMIS Officer</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-800">Verified &amp; Approved By:</div>
                    <div className="mt-4 font-medium">{report.approvedByDoctor}</div>
                    <div className="text-[10px] text-slate-500">Signature &amp; Hospital Official Stamp</div>
                  </div>
                </div>
              </div>

              {/* OFFICIAL MUNICIPALITY RECEIPT & SIGN BLOCK */}
              <div className="border-2 border-slate-900 rounded-lg p-4 space-y-4 bg-white">
                <div className="text-center border-b border-slate-400 pb-2">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-900">
                    ACKNOWLEDGEMENT OF RECEIPT AT HEALTH SECTION — BODE BARSAIN MUNICIPALITY
                  </div>
                  <div className="text-[11px] font-semibold text-slate-700">
                    (बोदे बर्साइन नगरपालिका, स्वास्थ्य शाखामा मासिक प्रतिवेदन बुझिलिएको प्रमाण / दर्ता)
                  </div>
                </div>

                <p className="text-[11px] text-slate-800 leading-relaxed">
                  This is to certify that the 2-Page Monthly DHIS2 / HMIS Reporting Form (Code:{' '}
                  <strong className="font-mono">{report.reportCode}</strong>) for the Nepali month of{' '}
                  <strong>{report.bsMonthName} {report.bsYear}</strong> submitted by{' '}
                  <strong>{sanitizePrintText(settings.addressLine, 'this health facility')}</strong> has been verified and officially{' '}
                  <strong>RECEIVED at Health Section, Bode Barsain Municipality</strong>.
                </p>

                <div className="grid grid-cols-2 gap-4 text-[11px] border border-slate-300 rounded p-3 bg-slate-50">
                  <div>
                    Municipality Receipt / Darta #: <strong className="font-mono">{report.municipalityReceiptNo || '__________________________'}</strong>
                  </div>
                  <div>
                    Received Date (BS): <strong className="font-mono">{report.receivedAtBodeBarsain || '__________________________'}</strong>
                  </div>
                  <div>
                    Receiving Officer Name: <strong>{report.receivedByOfficer || '__________________________'}</strong>
                  </div>
                  <div>
                    Designation: <strong>Health Coordinator / HMIS Focal Person</strong>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-8 pt-8 text-[11px]">
                  <div>
                    <div className="border-t border-slate-700 pt-1.5 font-semibold">
                      Handed Over By (Hospital Representative)
                    </div>
                    <div className="text-[10px] text-slate-500">Name, Signature &amp; Date</div>
                  </div>
                  <div className="text-right">
                    <div className="border-t border-slate-700 pt-1.5 font-semibold">
                      Received By — Health Section, Bode Barsain Municipality
                    </div>
                    <div className="text-[10px] text-slate-500">Signature, Date &amp; Official Municipality Stamp</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-300 flex justify-between items-center text-[9.5px] text-slate-600">
              <span>{sanitizePrintText(settings.addressLine)} · {sanitizePrintText(settings.contactLine)}</span>
              <span className="font-bold">Paper 2 of 2 (Municipality Receipt Copy)</span>
            </div>
          </div>
        </>
      )}
    />
  );
}

// ==========================================
// 8. OPD PRESCRIPTION + TEAR-OFF PATIENT STICKER
// ==========================================
export function OpdPrescriptionStickerModal({
  visit,
  settings,
  autoPrint = false,
  onClose,
}: {
  visit: OpdVisit;
  settings: LabSettings;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const bs = adToBs(visit.visitDate);
  const freeDays = settings.moduleSettings?.opdFreeFollowUpDays ?? 7;

  return (
    <PrintModalShell
      title={`OPD Clinical Prescription · ${visit.tokenNumber}`}
      subtitle={`${visit.patientName} · ${visit.uhid || 'OPD'} · ${visit.consultingDoctor}`}
      autoPrint={autoPrint}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={
            letterhead === 'without'
              ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
              : undefined
          }
        >
          <div className="space-y-4">
            {letterhead === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={visit.tokenNumber}
                qrText={`OPD:${visit.tokenNumber}|UHID:${visit.uhid || ''}|PT:${visit.patientName}|BS:${bs.formattedEn}`}
                rightTitle="OPD PRESCRIPTION / पुर्जा"
              />
            )}

            {/* Patient Clinical Header (Thermal Sticker printed separately) */}
            <div className="border border-slate-300 rounded-lg p-3 bg-slate-50/70 text-[11px] space-y-1">
              <div className="flex flex-wrap justify-between gap-2">
                <span>Token: <strong className="font-mono text-blue-800">{visit.tokenNumber}</strong> · UHID: <strong className="font-mono">{visit.uhid || '—'}</strong></span>
                <span>Date (BS): <strong className="font-mono">{bs.formattedEn} · {bs.timeEn}</strong></span>
              </div>
              <div className="text-sm font-bold text-slate-900">
                {visit.patientName}{' '}
                <span className="text-xs font-mono font-normal text-slate-700">
                  ({visit.patientAge} {visit.patientAgeType} / {visit.patientGender})
                </span>
              </div>
              <div className="text-slate-700">
                Address: {visit.patientAddress} · Phone: <span className="font-mono">{visit.patientPhone || '—'}</span>
              </div>
              <div className="text-slate-700">
                Dept: <strong>{visit.department}</strong> · Doctor: <strong>{visit.consultingDoctor}</strong>
              </div>
            </div>

            {/* Vitals Strip */}
            <div className="border border-slate-300 rounded px-3 py-2 text-[10.5px] font-mono flex flex-wrap gap-5 bg-white">
              <span>BP: <strong>{visit.vitals?.bp || '____/____'}</strong> mmHg</span>
              <span>Pulse: <strong>{visit.vitals?.pulseBpm || '____'}</strong> bpm</span>
              <span>Temp: <strong>{visit.vitals?.tempF || '____'}</strong> °F</span>
              <span>SpO2: <strong>{visit.vitals?.spo2Pct || '____'}</strong> %</span>
              <span>Wt: <strong>{visit.vitals?.weightKg || '____'}</strong> kg</span>
            </div>

            {/* Rx Workspace */}
            <div className="grid grid-cols-12 gap-4 min-h-[140mm]">
              <div className="col-span-4 border-r border-slate-300 pr-3 space-y-4 text-[11px]">
                <div>
                  <div className="font-bold uppercase text-[10px] text-slate-600 mb-1">Chief Complaint &amp; History</div>
                  <div className="min-h-[28mm] border-b border-dotted border-slate-300 pb-2">
                    {visit.chiefComplaint || '—'}
                    {visit.clinicalNotes ? `\n${visit.clinicalNotes}` : ''}
                  </div>
                </div>
                <div>
                  <div className="font-bold uppercase text-[10px] text-slate-600 mb-1">Provisional Diagnosis</div>
                  <div className="min-h-[18mm] border-b border-dotted border-slate-300 pb-2 font-semibold">
                    {visit.provisionalDiagnosis || '—'}
                  </div>
                </div>
                <div>
                  <div className="font-bold uppercase text-[10px] text-slate-600 mb-1">Advised Investigations</div>
                  {visit.investigations?.length > 0 ? (
                    <ul className="list-disc pl-4 space-y-0.5 font-mono text-[10px]">
                      {visit.investigations.map((i) => (
                        <li key={i.id}>{i.serviceName}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-slate-400 italic">Order via POS after consultation</div>
                  )}
                </div>
              </div>

              <div className="col-span-8 pl-1 flex flex-col justify-between text-[11px]">
                <div>
                  <div className="text-lg font-serif font-bold text-slate-800 mb-2">Rx</div>
                  {visit.prescribedMedicines?.length > 0 ? (
                    <table className="w-full text-left border-collapse text-[10.5px]">
                      <thead>
                        <tr className="border-b border-slate-400 text-slate-600">
                          <th className="py-1">#</th>
                          <th className="py-1">Medicine Name</th>
                          <th className="py-1">Dosage / Route / Duration</th>
                          <th className="py-1 text-right">Qty</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {visit.prescribedMedicines.map((m, idx) => (
                          <tr key={m.id}>
                            <td className="py-1.5 font-mono">{idx + 1}.</td>
                            <td className="py-1.5 font-semibold">{m.medicineName}</td>
                            <td className="py-1.5">{m.dosageRoute}</td>
                            <td className="py-1.5 text-right font-mono">{m.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="min-h-[90mm] border border-dashed border-slate-200 rounded p-3 text-slate-400">
                      Doctor Prescription Space
                    </div>
                  )}
                </div>

                {visit.followUpAdvice && (
                  <div className="mt-4 p-2.5 bg-slate-50 border border-slate-300 rounded text-[10.5px]">
                    <strong>Follow-Up Advice:</strong> {visit.followUpAdvice}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-300 flex items-end justify-between text-[10px] text-slate-600">
            <div>
              Free follow-up valid for <strong>{freeDays} days</strong> from {bs.formattedEn}. Bring this slip on revisit.
            </div>
            <div className="text-right">
              <div className="font-bold text-slate-900">{visit.consultingDoctor}</div>
              <div>Consulting Physician Signature &amp; NMC Seal</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// ==========================================
// 9. EMERGENCY CHARGES BILL + PATIENT STICKER
// ==========================================
export function ErChargeStickerModal({
  erCase,
  settings,
  autoPrint = false,
  onClose,
}: {
  erCase: EmergencyCase;
  settings: LabSettings;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const bs = adToBs(erCase.registeredAt);
  const ticketFee = erCase.erTicketFeeNpr ?? settings.moduleSettings?.emergencyTicketFeeNpr ?? 250;
  const regFee = erCase.erChargesNpr ?? settings.moduleSettings?.emergencyRegistrationFeeNpr ?? 500;
  const total = ticketFee + regFee;

  return (
    <PrintModalShell
      title={`Emergency Ticket & Charges Bill · ${erCase.erNumber}`}
      subtitle={`${erCase.patientName} · Triage: ${erCase.triageLevel} · ${erCase.erBedBay}`}
      autoPrint={autoPrint}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={
            letterhead === 'without'
              ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
              : undefined
          }
        >
          <div className="space-y-4">
            {letterhead === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={erCase.erNumber}
                qrText={`ER:${erCase.erNumber}|UHID:${erCase.uhid || ''}|PT:${erCase.patientName}|TOTAL:${total}`}
                rightTitle="EMERGENCY BILL"
              />
            )}

            <div className="border border-slate-300 rounded-lg p-3 bg-slate-50 text-[11px] space-y-1">
              <div className="flex flex-wrap gap-3 font-mono">
                <span>ER No: <strong>{erCase.erNumber}</strong></span>
                <span>UHID: <strong>{erCase.uhid || '—'}</strong></span>
                <span>Bay: <strong>{erCase.erBedBay}</strong></span>
                {erCase.isMlc && <span className="text-rose-700 font-bold">MLC: {erCase.mlcNumber}</span>}
              </div>
              <div className="text-sm font-bold">
                {erCase.patientName} ({erCase.patientAge} {erCase.patientAgeType} / {erCase.patientGender})
              </div>
              <div>
                Address: {erCase.patientAddress} · Phone: <span className="font-mono">{erCase.patientPhone || '—'}</span>
              </div>
              <div>
                Triage: <strong>{erCase.triageLevel}</strong> · Arrival: {erCase.arrivalMode} · BS: <span className="font-mono">{bs.formattedEn} {bs.timeEn}</span>
              </div>
              <div>
                Attending Doctor: <strong>{erCase.attendingDoctor}</strong>
              </div>
            </div>

            <div className="border border-slate-300 rounded p-3 text-[11px]">
              <div className="font-bold text-slate-800 uppercase text-[10px] mb-1">Chief Complaint &amp; Initial Stabilization</div>
              <div>{erCase.chiefComplaint}</div>
              {erCase.clinicalNotes && <div className="text-slate-600 mt-1">{erCase.clinicalNotes}</div>}
            </div>

            {erCase.isMlc && (
              <div className="border border-rose-300 bg-rose-50/60 rounded p-3 text-[10.5px] space-y-1">
                <div className="font-bold text-rose-900">Medico-Legal Case &amp; Police Notification</div>
                <div>
                  Police Station: <strong>{erCase.policeStationName || '—'}</strong> · Phone:{' '}
                  <span className="font-mono">{erCase.policeStationPhone || '—'}</span>
                </div>
                <div>Address: {erCase.policeStationAddress || '—'}</div>
              </div>
            )}

            <div>
              <div className="text-xs font-bold uppercase text-slate-800 mb-1.5">Emergency Registration &amp; Ticket Charges Receipt</div>
              <table className="w-full text-left border-collapse border border-slate-300 text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 border-b border-slate-300">#</th>
                    <th className="p-2 border-b border-slate-300">Emergency Fee Particulars</th>
                    <th className="p-2 border-b border-slate-300 text-right">Amount (रू)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="p-2 font-mono">1</td>
                    <td className="p-2">Emergency Ticket Fee (ER Triage &amp; Bay Allocation)</td>
                    <td className="p-2 text-right font-mono font-semibold">{formatNpr(ticketFee)}</td>
                  </tr>
                  <tr className="border-b border-slate-200">
                    <td className="p-2 font-mono">2</td>
                    <td className="p-2">Emergency Registration &amp; Casualty Physician Assessment Fee</td>
                    <td className="p-2 text-right font-mono font-semibold">{formatNpr(regFee)}</td>
                  </tr>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={2} className="p-2 text-right">Total Emergency Charges Paid ({erCase.paymentMode}):</td>
                    <td className="p-2 text-right font-mono">{formatNpr(total)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-300 flex justify-between items-end text-[10px] text-slate-600">
            <div>Recorded By: {erCase.recordedBy}</div>
            <div className="text-right">
              <div className="font-bold text-slate-900">{erCase.attendingDoctor}</div>
              <div>Casualty Medical Officer Signature</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// ==========================================
// 10. IPD ADMISSION SLIP & CONSENT SUMMARY
// ==========================================
export function IpdAdmissionPrintModal({
  admission,
  settings,
  autoPrint = false,
  onClose,
}: {
  admission: IpdAdmission;
  settings: LabSettings;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const bs = adToBs(admission.admittedAt);
  return (
    <PrintModalShell
      title={`IPD Admission Slip & Financial Credit Summary · ${admission.admissionNumber}`}
      subtitle={`${admission.patientName} · Bed ${admission.currentBedLabel} (${admission.currentWardName})`}
      autoPrint={autoPrint}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={
            letterhead === 'without'
              ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
              : undefined
          }
        >
          <div className="space-y-4">
            {letterhead === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={admission.admissionNumber}
                qrText={`IPD:${admission.admissionNumber}|UHID:${admission.uhid || ''}|BED:${admission.currentBedLabel}`}
                rightTitle="IPD ADMISSION CARD"
              />
            )}

            <div className="border border-slate-300 rounded-lg p-3.5 bg-slate-50 grid grid-cols-2 gap-3 text-[11px]">
              <div className="space-y-1">
                <div>Admission No: <strong className="font-mono">{admission.admissionNumber}</strong></div>
                <div>UHID: <strong className="font-mono">{admission.uhid || '—'}</strong></div>
                <div>Patient: <strong className="text-sm">{admission.patientName}</strong> ({admission.patientAge} {admission.patientAgeType} / {admission.patientGender})</div>
                <div>Phone / Guardian: <span className="font-mono">{admission.patientPhone || '—'}</span> · {admission.emergencyContact || '—'}</div>
              </div>
              <div className="space-y-1 text-right">
                <div>Admitted (BS): <strong className="font-mono">{bs.formattedEn} · {bs.timeEn}</strong></div>
                <div>Bed &amp; Ward: <strong className="font-mono">{admission.currentBedLabel} · {admission.currentWardName}</strong></div>
                <div>Bed Timing Window: <span className="font-mono">{admission.bedCycleWindowLabel || `${settings.moduleSettings?.ipdBedCycleStartTime || '07:00'}–${settings.moduleSettings?.ipdBedCycleEndTime || '19:00'}`}</span></div>
                <div>Admitting Consultant: <strong>{admission.admittingDoctor}</strong></div>
              </div>
            </div>

            <div className="border border-slate-300 rounded-lg p-3 text-[11px]">
              <strong>Admitting Diagnosis:</strong> {admission.admittingDiagnosis}
            </div>

            <table className="w-full text-left border-collapse border border-slate-300 text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 border-b border-slate-300">IPD Tariff / Credit Control Parameter</th>
                  <th className="p-2 border-b border-slate-300 text-right">Configured Rate / Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                <tr>
                  <td className="p-2 font-sans">IPD Admission Registration Fee</td>
                  <td className="p-2 text-right font-semibold">{formatNpr(admission.admissionFeeNpr || 0)}</td>
                </tr>
                <tr>
                  <td className="p-2 font-sans">Bed Daily Rate ({admission.currentBedLabel})</td>
                  <td className="p-2 text-right font-semibold">{formatNpr(admission.bedDailyRateNpr)} / cycle</td>
                </tr>
                <tr>
                  <td className="p-2 font-sans">Hospital IPD Credit Limit Ceiling</td>
                  <td className="p-2 text-right font-semibold">
                    {formatNpr(admission.creditLimitNpr || settings.moduleSettings?.ipdDefaultCreditLimitNpr || 50000)} ({admission.creditApprovalStatus || 'WITHIN_LIMIT'})
                  </td>
                </tr>
                <tr>
                  <td className="p-2 font-sans">Advance Deposit Collected</td>
                  <td className="p-2 text-right font-bold text-emerald-700">{formatNpr(admission.totalDepositPaidNpr)}</td>
                </tr>
              </tbody>
            </table>

            {(admission.consents || []).length > 0 && (
              <div className="border border-slate-300 rounded-lg p-3 space-y-1.5 text-[10.5px]">
                <div className="font-bold uppercase text-slate-700">Assigned Hospital Informed Consents</div>
                {(admission.consents || []).map((c) => (
                  <div key={c.id} className="flex justify-between border-b border-slate-100 pb-1">
                    <span><strong>{c.title}</strong> ({c.consentCode}) — {c.autoReason}</span>
                    <span className="font-mono">{c.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-slate-300 grid grid-cols-3 gap-6 text-[10px] text-slate-600">
            <div>
              <div className="border-t border-slate-400 pt-1 font-semibold">Patient / Guardian Signature</div>
            </div>
            <div className="text-center">
              <div className="border-t border-slate-400 pt-1 font-semibold">Admission Desk / Reception</div>
            </div>
            <div className="text-right">
              <div className="border-t border-slate-400 pt-1 font-semibold">{admission.admittingDoctor}</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// ==========================================
// 11. GATEPASS, VISITOR & CLEARANCE PASS PRINT
// ==========================================
export function GatepassPrintModal({
  gatepass,
  settings,
  onClose,
}: {
  gatepass: GatepassVisitorRecord;
  settings: LabSettings;
  onClose: () => void;
}) {
  const bs = adToBs(gatepass.issuedAt);
  return (
    <PrintModalShell
      title={`Hospital Gatepass / Clearance Slip · ${gatepass.passNumber}`}
      subtitle={`${gatepass.passType} · ${gatepass.personName}`}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead) => (
        <div className="a4-sheet bg-white mx-auto w-[148mm] min-h-[180mm] shadow-lg border border-slate-300 p-6 text-slate-900 flex flex-col justify-between">
          <div className="space-y-4">
            {letterhead === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={gatepass.passNumber}
                qrText={`GP:${gatepass.passNumber}|TYPE:${gatepass.passType}|NAME:${gatepass.personName}`}
                rightTitle={gatepass.passType.replace('_', ' ')}
              />
            )}

            <div className="border border-slate-300 rounded-lg p-3.5 space-y-2 text-xs">
              <div className="flex justify-between font-mono border-b border-slate-200 pb-1.5">
                <span>Pass No: <strong>{gatepass.passNumber}</strong></span>
                <span>BS: <strong>{bs.formattedEn} {bs.timeEn}</strong></span>
              </div>
              <div><strong>Holder Name:</strong> {gatepass.personName}</div>
              <div><strong>Phone:</strong> <span className="font-mono">{gatepass.phone || '—'}</span></div>
              <div><strong>Department / Ward:</strong> {gatepass.departmentOrWard}</div>
              <div><strong>Purpose / Clearance:</strong> {gatepass.purpose}</div>
              {gatepass.linkedPatientOrRef && (
                <div><strong>Linked Patient / Ref:</strong> <span className="font-mono">{gatepass.linkedPatientOrRef}</span></div>
              )}
              {gatepass.vehicleOrBagInfo && (
                <div><strong>Vehicle / Bag Info:</strong> {gatepass.vehicleOrBagInfo}</div>
              )}
              <div className="flex justify-between pt-1 border-t border-slate-200 font-mono">
                <span>Valid Until: <strong>{gatepass.validUntil}</strong></span>
                <span>Status: <strong>{gatepass.status}</strong></span>
              </div>
            </div>
          </div>

          <div className="pt-8 grid grid-cols-2 gap-6 text-[10px] text-slate-600">
            <div>
              <div className="border-t border-slate-500 pt-1 font-semibold">Issued By: {gatepass.issuedBy}</div>
            </div>
            <div className="text-right">
              <div className="border-t border-slate-500 pt-1 font-semibold">
                Security Gate Verification {gatepass.clearanceVerifiedBy ? `(${gatepass.clearanceVerifiedBy})` : ''}
              </div>
            </div>
          </div>
        </div>
      )}
    />
  );
}

// ==========================================
// 12. CONSOLIDATED HOSPITAL MIS REPORT PRINT
// ==========================================
export function MisPrintModal({
  db,
  activeFiscalYear,
  onClose,
}: {
  db: LimsDatabase;
  activeFiscalYear: string;
  onClose: () => void;
}) {
  const settings = db.settings;
  const nowBs = adToBs(new Date());
  const hospOrdersRev = db.orders.reduce((s, o) => s + o.totalAmount, 0);
  const phmRev = (db.pharmacyInvoices || []).reduce((s, i) => s + i.totalNpr, 0);
  const totalAccounts = db.accounts.reduce((s, a) => s + a.currentBalance, 0);

  return (
    <PrintModalShell
      title={`Consolidated Hospital MIS Report · ${activeFiscalYear}`}
      subtitle={`Generated ${nowBs.formattedEn}`}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
          style={
            letterhead === 'without'
              ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
              : undefined
          }
        >
          <div className="space-y-4">
            {letterhead === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={`MIS-${nowBs.year}`}
                qrText={`MIS|FY:${activeFiscalYear}|HOSP:${hospOrdersRev}|PHM:${phmRev}`}
                rightTitle="HOSPITAL MIS REPORT"
              />
            )}

            <div className="text-center border-b border-slate-300 pb-2">
              <div className="text-sm font-bold uppercase tracking-wide">
                EXECUTIVE MANAGEMENT INFORMATION SYSTEM (MIS) SUMMARY — {activeFiscalYear}
              </div>
              <div className="text-[11px] font-mono text-slate-600">
                Printed BS Date: {nowBs.formattedEn} ({nowBs.formattedNp}) · Hotline: 97-1515-6677
              </div>
            </div>

            <table className="w-full border-collapse border border-slate-300 text-xs">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-2 border-b border-slate-300 text-left">Department / Revenue Stream</th>
                  <th className="p-2 border-b border-slate-300 text-right">Volume</th>
                  <th className="p-2 border-b border-slate-300 text-right">Amount (रू)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono">
                <tr>
                  <td className="p-2 font-sans">Hospital Lab &amp; Radiology POS Billing</td>
                  <td className="p-2 text-right">{db.orders.length} Orders</td>
                  <td className="p-2 text-right font-bold">{formatNpr(hospOrdersRev)}</td>
                </tr>
                <tr>
                  <td className="p-2 font-sans">Central Pharmacy Separate Counter</td>
                  <td className="p-2 text-right">{(db.pharmacyInvoices || []).length} Bills</td>
                  <td className="p-2 text-right font-bold">{formatNpr(phmRev)}</td>
                </tr>
                <tr>
                  <td className="p-2 font-sans">OPD Visits · ER / MLC · IPD Admissions</td>
                  <td className="p-2 text-right">
                    {(db.opdVisits || []).length} OPD / {(db.emergencyCases || []).length} ER / {(db.ipdAdmissions || []).length} IPD
                  </td>
                  <td className="p-2 text-right font-bold">
                    {formatNpr(
                      (db.opdVisits || []).reduce((s, v) => s + v.consultationFeeNpr, 0) +
                        (db.emergencyCases || []).reduce((s, e) => s + e.erChargesNpr + (e.erTicketFeeNpr || 0), 0)
                    )}
                  </td>
                </tr>
                <tr className="bg-slate-50 font-bold">
                  <td colSpan={2} className="p-2 font-sans text-right">Total Cash &amp; Bank Balances Across Counters:</td>
                  <td className="p-2 text-right">{formatNpr(totalAccounts)}</td>
                </tr>
              </tbody>
            </table>

            <div className="grid grid-cols-2 gap-4 text-[11px]">
              <div className="border border-slate-300 rounded p-3 space-y-1">
                <div className="font-bold uppercase text-slate-700">Master Directory &amp; Compliance</div>
                <div>Registered Patients (UHID): <strong className="font-mono">{(db.patients || []).length}</strong></div>
                <div>Active Beds / Occupied: <strong className="font-mono">{(db.hospitalBeds || []).filter((b) => b.status === 'Occupied').length} / {(db.hospitalBeds || []).length}</strong></div>
                <div>Active Gatepasses: <strong className="font-mono">{(db.gatepasses || []).filter((g) => g.status === 'Active').length}</strong></div>
                <div>Field Marketing Visits: <strong className="font-mono">{(db.marketingVisits || []).length}</strong></div>
              </div>
              <div className="border border-slate-300 rounded p-3 space-y-1">
                <div className="font-bold uppercase text-slate-700">Top Patient Referrals</div>
                {db.referrals.slice(0, 4).map((r) => (
                  <div key={r.id} className="flex justify-between">
                    <span className="truncate">{r.name}</span>
                    <span className="font-mono font-semibold">{formatNpr(r.totalReferredSales)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-300 flex justify-between text-[10px] text-slate-600">
            <span>{sanitizePrintText(settings.addressLine)} · {sanitizePrintText(settings.contactLine)}</span>
            <span>Director / Medical Superintendent Signature</span>
          </div>
        </div>
      )}
    />
  );
}

// ==========================================
// 13. IPD ADMISSION FEE RECEIPT ONLY (A5 PORTRAIT)
// ==========================================
export function IpdAdmissionFeeReceiptModal({
  admission,
  settings,
  autoPrint = false,
  onClose,
}: {
  admission: IpdAdmission;
  settings: LabSettings;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const bs = adToBs(admission.admittedAt);
  const receiptNo =
    admission.admissionReceiptNumber || `ADM-RCPT-${admission.admissionNumber.split('-').pop()}`;
  const feeAmount =
    admission.admissionFeeNpr ?? settings.moduleSettings?.ipdAdmissionFeeNpr ?? 1500;
  const cashierSig = (settings.moduleSettings?.signatureBoxes || []).find(
    (s) => s.roleKey === 'HOSPITAL_CASHIER'
  );

  return (
    <PrintModalShell
      title={`Admission Fee Receipt Only · ${receiptNo}`}
      subtitle={`${admission.patientName} (${admission.admissionNumber}) · Fee: ${formatNpr(feeAmount)}`}
      defaultPaperSize="A5"
      autoPrint={autoPrint}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead, paperSize) => {
        const isA5 = paperSize === 'A5';
        return (
          <div
            className={`${isA5 ? 'a5-page w-[148mm] min-h-[210mm] p-[9mm] text-[10.5px]' : 'a4-page w-[210mm] min-h-[297mm] px-[14mm] py-[10mm] text-xs'} bg-white mx-auto shadow-lg border border-slate-300 text-slate-900 flex flex-col justify-between box-border`}
            style={
              letterhead === 'without'
                ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
                : undefined
            }
          >
            <div className="space-y-4">
              {letterhead === 'with' && (
                <HospitalLetterheadHeader
                  settings={settings}
                  refCode={receiptNo}
                  qrText={`ADM-FEE:${receiptNo}|IPD:${admission.admissionNumber}|PT:${admission.patientName}|FEE:${feeAmount}|BS:${bs.formattedEn}`}
                  rightTitle="ADMISSION FEE RECEIPT"
                />
              )}

              <div className="text-center border-y border-slate-800 py-1.5 bg-slate-50">
                <div className="text-xs font-bold uppercase tracking-wider">
                  IPD ADMISSION FEE RECEIPT ONLY / भर्ना शुल्क रसिद
                </div>
                <div className="text-[10px] font-mono text-slate-600">
                  Receipt No: <strong>{receiptNo}</strong> · Admission No: <strong>{admission.admissionNumber}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-lg p-3 bg-slate-50/60 text-[10.5px]">
                <div className="space-y-1">
                  <div>Patient: <strong className="text-slate-950">{admission.patientName}</strong></div>
                  <div>Age / Sex: <strong className="font-mono">{admission.patientAge} {admission.patientAgeType} / {admission.patientGender}</strong></div>
                  <div>UHID: <strong className="font-mono">{admission.uhid || '—'}</strong></div>
                  <div>Phone: <span className="font-mono">{admission.patientPhone || '—'}</span></div>
                </div>
                <div className="space-y-1 text-right">
                  <div>Date (BS): <strong className="font-mono">{bs.formattedEn} · {bs.timeEn}</strong></div>
                  <div>Ward / Bed: <strong className="font-mono">{admission.currentWardName} ({admission.currentBedLabel})</strong></div>
                  <div>Admitting Dr: <strong>{admission.admittingDoctor}</strong></div>
                  <div>Fiscal Year: <span className="font-mono">{admission.fiscalYear}</span></div>
                </div>
              </div>

              <table className="w-full text-left border-collapse border border-slate-300 text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 border-b border-slate-300">#</th>
                    <th className="p-2 border-b border-slate-300">Particular (Admission Registration Only)</th>
                    <th className="p-2 border-b border-slate-300 text-right">Amount (रू)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="p-2 font-mono">1</td>
                    <td className="p-2">
                      IPD Patient Admission Registration &amp; Bed Allocation Fee
                      <div className="text-[10px] text-slate-500">
                        {admission.currentWardName} — Bed {admission.currentBedLabel}
                      </div>
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums font-bold">
                      {formatNpr(feeAmount, true)}
                    </td>
                  </tr>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={2} className="p-2 text-right">
                      Total Admission Fee Paid:
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums text-emerald-800">
                      {formatNpr(feeAmount, true)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="text-[10px] text-slate-600 border border-slate-200 rounded p-2.5 bg-slate-50/40">
                <strong>Note:</strong> This receipt covers ONLY the IPD Admission Registration Fee. Subsequent ward bed cycles, nursing observation rounds, laboratory tests, and pharmacy bills are settled separately.
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-300 flex justify-between items-end text-[9.5px] text-slate-600">
              <div>
                <div>{sanitizePrintText(settings.addressLine)}</div>
              </div>
              <div className="text-right">
                {cashierSig?.signatureDataUrl && (
                  <img
                    src={cashierSig.signatureDataUrl}
                    alt={cashierSig.label}
                    className="h-8 max-w-[110px] object-contain ml-auto mb-0.5"
                  />
                )}
                <div className="font-bold text-slate-900">
                  {cashierSig?.signerName || 'Admission / Cash Counter'}
                </div>
                <div>{cashierSig?.designation || 'Hospital Billing Cashier'}</div>
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}

// ==========================================
// 14. IPD INDIVIDUAL ITEM CASH BILL RECEIPT (A5 PORTRAIT)
// ==========================================
export function IpdIndividualCashBillModal({
  admission,
  cashBill,
  settings,
  autoPrint = false,
  onClose,
}: {
  admission: IpdAdmission;
  cashBill: NonNullable<IpdAdmission['ipdIndividualBills']>[number];
  settings: LabSettings;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const bs = adToBs(cashBill.billedAt);
  const cashierSig = (settings.moduleSettings?.signatureBoxes || []).find(
    (s) => s.roleKey === 'HOSPITAL_CASHIER'
  );

  return (
    <PrintModalShell
      title={`IPD Itemized Cash Bill · ${cashBill.billNumber}`}
      subtitle={`${admission.patientName} (${admission.admissionNumber}) · Paid: ${formatNpr(cashBill.amountNpr)} (${cashBill.paymentMode})`}
      defaultPaperSize="A5"
      autoPrint={autoPrint}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead, paperSize) => {
        const isA5 = paperSize === 'A5';
        return (
          <div
            className={`${isA5 ? 'a5-page w-[148mm] min-h-[210mm] p-[9mm] text-[10.5px]' : 'a4-page w-[210mm] min-h-[297mm] px-[14mm] py-[10mm] text-xs'} bg-white mx-auto shadow-lg border border-slate-300 text-slate-900 flex flex-col justify-between box-border`}
            style={
              letterhead === 'without'
                ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
                : undefined
            }
          >
            <div className="space-y-4">
              {letterhead === 'with' && (
                <HospitalLetterheadHeader
                  settings={settings}
                  refCode={cashBill.billNumber}
                  qrText={`IPD-BILL:${cashBill.billNumber}|IPD:${admission.admissionNumber}|PT:${admission.patientName}|AMT:${cashBill.amountNpr}|MODE:${cashBill.paymentMode}`}
                  rightTitle="IPD CASH BILL"
                />
              )}

              <div className="text-center border-y border-slate-800 py-1.5 bg-slate-50">
                <div className="text-xs font-bold uppercase tracking-wider">
                  IPD ITEMIZED CASH BILL RECEIPT / नगद सेवा रसिद
                </div>
                <div className="text-[10px] font-mono text-slate-600">
                  Bill No: <strong>{cashBill.billNumber}</strong> · IPD No: <strong>{admission.admissionNumber}</strong>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-lg p-3 bg-slate-50/60 text-[10.5px]">
                <div className="space-y-1">
                  <div>Patient: <strong className="text-slate-950">{admission.patientName}</strong></div>
                  <div>Age / Sex: <strong className="font-mono">{admission.patientAge} {admission.patientAgeType} / {admission.patientGender}</strong></div>
                  <div>UHID: <strong className="font-mono">{admission.uhid || '—'}</strong></div>
                  <div>Phone: <span className="font-mono">{admission.patientPhone || '—'}</span></div>
                </div>
                <div className="space-y-1 text-right">
                  <div>Billed (BS): <strong className="font-mono">{bs.formattedEn} · {bs.timeEn}</strong></div>
                  <div>Ward / Bed: <strong className="font-mono">{admission.currentWardName} ({admission.currentBedLabel})</strong></div>
                  <div>Payment Mode: <strong className="font-mono text-emerald-700">{cashBill.paymentMode}</strong></div>
                  <div>Cashier: <strong>{cashBill.billedBy}</strong></div>
                </div>
              </div>

              <table className="w-full text-left border-collapse border border-slate-300 text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="p-2 border-b border-slate-300">#</th>
                    <th className="p-2 border-b border-slate-300">Category &amp; Service Description</th>
                    <th className="p-2 border-b border-slate-300 text-right">Paid Amount (रू)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-200">
                    <td className="p-2 font-mono">1</td>
                    <td className="p-2">
                      <div className="font-semibold text-slate-900">{cashBill.itemLabel}</div>
                      <div className="text-[10px] font-mono text-slate-500">
                        Category: {cashBill.category}{cashBill.notes ? ` · ${cashBill.notes}` : ''}
                      </div>
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums font-bold">
                      {formatNpr(cashBill.amountNpr, true)}
                    </td>
                  </tr>
                  <tr className="bg-slate-50 font-bold">
                    <td colSpan={2} className="p-2 text-right">
                      Individual Bill Paid ({cashBill.paymentMode}):
                    </td>
                    <td className="p-2 text-right font-mono tabular-nums text-emerald-800">
                      {formatNpr(cashBill.amountNpr, true)}
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="text-[10px] text-slate-600 border border-slate-200 rounded p-2.5 bg-slate-50/40">
                <strong>Credit Deduction Notice:</strong> This paid cash bill ({cashBill.billNumber}) is credited on the patient&apos;s IPD running ledger and deducted automatically from the final settlement balance.
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-300 flex justify-between items-end text-[9.5px] text-slate-600">
              <div>{sanitizePrintText(settings.addressLine)}</div>
              <div className="text-right">
                {cashierSig?.signatureDataUrl && (
                  <img
                    src={cashierSig.signatureDataUrl}
                    alt={cashierSig.label}
                    className="h-8 max-w-[110px] object-contain ml-auto mb-0.5"
                  />
                )}
                <div className="font-bold text-slate-900">
                  {cashBill.billedBy || cashierSig?.signerName || 'Hospital Billing Cashier'}
                </div>
                <div>{cashierSig?.designation || 'Hospital Billing Counter'}</div>
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}

// ==========================================
// 15. EMERGENCY EXTERNAL HOSPITAL REFERRAL SUMMARY (A4 PORTRAIT)
// ==========================================
export function ErReferralPrintModal({
  erCase,
  settings,
  autoPrint = false,
  onClose,
}: {
  erCase: EmergencyCase;
  settings: LabSettings;
  autoPrint?: boolean;
  onClose: () => void;
}) {
  const ext = erCase.externalReferral;
  const arrivalBs = adToBs(erCase.registeredAt);
  const referredBs = ext?.referredAt ? adToBs(ext.referredAt) : adToBs(new Date().toISOString());
  const clinItems =
    ext?.clinicalTreatmentItems && ext.clinicalTreatmentItems.length > 0
      ? ext.clinicalTreatmentItems
      : (ext?.attachedBilledItems || []).map((b) => ({
          id: b.id,
          source: b.source,
          dateIso: b.dateIso,
          category: b.category,
          description: b.description.replace(/\s*\(x\d+\)/gi, ''),
        }));
  const moSig = (settings.moduleSettings?.signatureBoxes || []).find(
    (s) => s.roleKey === 'DOCTOR'
  );

  return (
    <PrintModalShell
      title={`Emergency Referral Clinical Summary · ${erCase.erNumber}`}
      subtitle={`${erCase.patientName} -> ${ext?.referredToHospital || 'External Hospital'} (${ext?.referredToPlace || ''})`}
      defaultPaperSize="A4"
      autoPrint={autoPrint}
      settings={settings}
      onClose={onClose}
      renderSheets={(letterhead, paperSize) => {
        const isA5 = paperSize === 'A5';
        return (
          <div
            className={`${isA5 ? 'a5-page w-[148mm] min-h-[210mm] p-[9mm] text-[10px]' : 'a4-page w-[210mm] min-h-[297mm] px-[14mm] py-[10mm] text-xs'} bg-white mx-auto shadow-lg border border-slate-300 text-slate-900 flex flex-col justify-between box-border`}
            style={
              letterhead === 'without'
                ? { paddingTop: `${settings.prePrintedTopMarginMm || 35}mm` }
                : undefined
            }
          >
            <div className="space-y-3.5">
              {letterhead === 'with' && (
                <HospitalLetterheadHeader
                  settings={settings}
                  refCode={erCase.erNumber}
                  qrText={`ER-REF:${erCase.erNumber}|UHID:${erCase.uhid || 'WALK-IN'}|PT:${erCase.patientName}|TO:${ext?.referredToHospital || ''}|AMB:${ext?.ambulanceNumber || ext?.ambulanceName || ''}`}
                  rightTitle="ER REFERRAL"
                />
              )}

              <div className="text-center border-y-2 border-rose-700 py-1.5 bg-rose-50/70">
                <div className="text-xs font-bold uppercase tracking-wider text-rose-900">
                  EMERGENCY EXTERNAL HOSPITAL REFERRAL &amp; CLINICAL CASE SUMMARY
                </div>
                <div className="text-[10px] font-mono text-slate-700">
                  ER Reg No: <strong>{erCase.erNumber}</strong>
                  {erCase.uhid ? ` · UHID: ${erCase.uhid}` : ''}
                  {erCase.mlcNumber ? ` · MLC No: ${erCase.mlcNumber}` : ''}
                </div>
              </div>

              {/* Patient & Triage Info */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 border border-slate-300 rounded-lg p-2.5 text-[11px]">
                <div>
                  <span className="text-slate-500">Patient Name:</span>{' '}
                  <strong className="text-slate-900">{erCase.patientName}</strong>
                </div>
                <div>
                  <span className="text-slate-500">Age / Sex:</span>{' '}
                  <strong>
                    {erCase.patientAge} {erCase.patientAgeType} / {erCase.patientGender}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Address / Phone:</span>{' '}
                  <span>
                    {erCase.patientAddress} ({erCase.patientPhone || '—'})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">ER Arrival (BS):</span>{' '}
                  <strong className="font-mono">
                    {arrivalBs.formattedEn} {arrivalBs.timeEn}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">Attending MO / Triage:</span>{' '}
                  <span>
                    {erCase.attendingDoctor} ({erCase.triageLevel})
                  </span>
                </div>
                <div>
                  <span className="text-slate-500">Vitals on Triage:</span>{' '}
                  <span className="font-mono">
                    BP {erCase.vitals?.bp || '—'} · P {erCase.vitals?.pulseBpm || '—'} · SpO₂ {erCase.vitals?.spo2Pct || '—'}% · T {erCase.vitals?.tempF || '—'}°F
                  </span>
                </div>
              </div>

              {/* Destination Hospital, Manager, Ambulance & Departure Time */}
              {ext && (
                <div className="border-2 border-rose-500 bg-rose-50/50 rounded-lg p-3 space-y-1.5 text-[11px]">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-rose-900">
                    Referred Hospital, Receiving Manager, Ambulance &amp; Departure Schedule
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div>
                      <span className="text-slate-600">Referred Hospital:</span>{' '}
                      <strong className="text-slate-900">{ext.referredToHospital}</strong>
                    </div>
                    <div>
                      <span className="text-slate-600">Place / City:</span>{' '}
                      <strong className="text-slate-900">{ext.referredToPlace}</strong>
                    </div>
                    {(ext.referredHospitalManagerName || ext.referredHospitalManagerPhone) && (
                      <div className="col-span-2">
                        <span className="text-slate-600">Hospital Manager / Desk:</span>{' '}
                        <strong className="text-slate-900">{ext.referredHospitalManagerName || '—'}</strong>
                        {ext.referredHospitalManagerPhone ? ` (${ext.referredHospitalManagerPhone})` : ''}
                      </div>
                    )}
                    <div>
                      <span className="text-slate-600">Referred Department:</span>{' '}
                      <span>{ext.referredDepartment}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">Referral Date (BS):</span>{' '}
                      <span className="font-mono">
                        {referredBs.formattedEn} {referredBs.timeEn}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-600">Ambulance Taken:</span>{' '}
                      <strong className="text-slate-900">
                        {ext.ambulanceName || ext.transportMode}
                        {ext.ambulanceNumber ? ` (${ext.ambulanceNumber})` : ''}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-600">Departure Time:</span>{' '}
                      <strong className="font-mono text-rose-900">{ext.departureTime || referredBs.timeEn}</strong>
                    </div>
                    {ext.escortDoctorOrNurse && (
                      <div className="col-span-2">
                        <span className="text-slate-600">Escort Personnel:</span>{' '}
                        <span>{ext.escortDoctorOrNurse}</span>
                      </div>
                    )}
                    <div className="col-span-2">
                      <span className="text-slate-600">Reason for Referral:</span>{' '}
                      <strong className="text-slate-900">{ext.referralReason}</strong>
                    </div>
                    <div className="col-span-2">
                      <span className="text-slate-600">Condition at Departure:</span>{' '}
                      <span>{ext.conditionAtReferral}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Clinical Case Details & Longitudinal History */}
              <div className="border border-slate-300 rounded-lg p-2.5 space-y-1.5 text-[11px]">
                <div className="text-[10px] font-bold uppercase text-slate-700">
                  Case Details, Chief Complaint &amp; Attached Clinical History
                </div>
                <div>
                  <span className="text-slate-500 font-semibold">Chief Complaint &amp; Injury/Notes:</span>{' '}
                  <span>{ext?.caseDetails || erCase.chiefComplaint}</span>
                </div>
                {erCase.clinicalNotes && (
                  <div>
                    <span className="text-slate-500 font-semibold">ER Examination &amp; Stabilization Notes:</span>{' '}
                    <span>{erCase.clinicalNotes}</span>
                  </div>
                )}
                {ext?.clinicalHistorySummary && (
                  <div>
                    <span className="text-slate-500 font-semibold">Prior Clinical History Summary:</span>{' '}
                    <span>{ext.clinicalHistorySummary}</span>
                  </div>
                )}
              </div>

              {/* Hospital POS Tests/Services & Pharmacy Medicines Given (NO Price, NO Qty) */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-bold uppercase text-slate-700">
                  Treatments, Hospital POS Services (Lab/X-Ray/Nebulization/O₂) &amp; Pharmacy Medicines Given ({clinItems.length})
                </div>
                <table className="w-full text-[10.5px] border-collapse border border-slate-300">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr>
                      <th className="p-1.5 text-left border border-slate-300">Date (BS)</th>
                      <th className="p-1.5 text-left border border-slate-300">Category</th>
                      <th className="p-1.5 text-left border border-slate-300">Service / Investigation / Medicine Administered</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {clinItems.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="p-2 text-center text-slate-500">
                          Initial ER triage &amp; clinical stabilization recorded above.
                        </td>
                      </tr>
                    ) : (
                      clinItems.map((item, idx) => (
                        <tr key={`${item.id}-${idx}`}>
                          <td className="p-1.5 font-mono border border-slate-200 whitespace-nowrap">
                            {adToBs(item.dateIso).formattedEn}
                          </td>
                          <td className="p-1.5 border border-slate-200 whitespace-nowrap">
                            {item.category}
                          </td>
                          <td className="p-1.5 border border-slate-200 font-medium text-slate-900">
                            {item.description}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-300 flex justify-between items-end text-[9.5px] text-slate-600">
              <div>
                <div className="font-bold text-slate-900">Patient / Attendant Signature</div>
                <div className="mt-3">Handed over clinical referral summary &amp; diagnostic copies</div>
              </div>
              <div className="text-right">
                {moSig?.signatureDataUrl && (
                  <img
                    src={moSig.signatureDataUrl}
                    alt={moSig.label}
                    className="h-8 max-w-[110px] object-contain ml-auto mb-0.5"
                  />
                )}
                <div className="font-bold text-slate-900">
                  {ext?.referredBy || moSig?.signerName || erCase.attendingDoctor}
                </div>
                <div>{moSig?.designation || 'Emergency Medical Officer'}</div>
              </div>
            </div>
          </div>
        );
      }}
    />
  );
}

// ==========================================
// 16. STANDALONE THERMAL BARCODE STICKER PRINT MODAL (50x30mm / 58x40mm)
// ==========================================
export function ThermalStickerPrintModal({
  uhid,
  barcodeValue,
  patientName,
  ageGender,
  encounterLabel,
  doctorOrUnit,
  dateIso,
  initialCopies = 1,
  settings,
  onClose,
}: {
  uhid: string;
  barcodeValue?: string;
  patientName: string;
  ageGender?: string;
  encounterLabel?: string;
  doctorOrUnit?: string;
  dateIso?: string;
  initialCopies?: number;
  settings: LabSettings;
  onClose: () => void;
}) {
  const [stickerSize, setStickerSize] = useState<'50x30' | '58x40'>('50x30');
  const [copies, setCopies] = useState<number>(Math.max(1, Math.min(10, initialCopies || 1)));
  const stickerRef = React.useRef<HTMLDivElement | null>(null);
  const bs = adToBs(dateIso || new Date().toISOString());
  const scanCode = (barcodeValue || uhid || patientName).trim();

  const triggerStickerPrint = () => {
    const cssSize = stickerSize === '50x30' ? '50mm 30mm' : '58mm 40mm';
    executeSmartPrint({
      element: stickerRef.current,
      pageCssSize: cssSize,
      documentTitle: `STICKER-${scanCode}`,
    });
  };

  return (
    <div className="no-print fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Thermal Sticker Printer</h3>
            <p className="text-[11px] text-slate-500">Dedicated barcode label print (kept separate from bills/summaries)</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-200">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-medium text-slate-600 mb-1">Sticker Label Size</label>
              <select
                value={stickerSize}
                onChange={(e) => setStickerSize(e.target.value as '50x30' | '58x40')}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono"
              >
                <option value="50x30">50mm × 30mm (Thermal)</option>
                <option value="58x40">58mm × 40mm (Large)</option>
              </select>
            </div>
            <div>
              <label className="block font-medium text-slate-600 mb-1">Copies</label>
              <input
                type="number"
                min={1}
                max={10}
                value={copies}
                onChange={(e) => setCopies(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg font-mono"
              />
            </div>
          </div>

          <div className="p-4 bg-slate-100 rounded-xl flex flex-col items-center max-h-72 overflow-y-auto">
            <div ref={stickerRef} className="space-y-2">
              {Array.from({ length: copies }).map((_, idx) => (
                <div
                  key={idx}
                  className={`thermal-sticker-page bg-white border border-dashed border-slate-400 text-slate-950 flex flex-col justify-between p-1.5 box-border ${
                    idx < copies - 1 ? 'page-break-after' : ''
                  }`}
                  style={{
                    width: stickerSize === '50x30' ? '50mm' : '58mm',
                    minHeight: stickerSize === '50x30' ? '29mm' : '38mm',
                  }}
                >
                  <div className="flex items-center justify-between border-b border-slate-300 pb-0.5 text-[7.5px] font-bold uppercase tracking-tight">
                    <span className="truncate">{sanitizePrintText(settings.labName, 'SAPTARI HOSPITAL')}</span>
                    <span className="font-mono shrink-0">{bs.formattedEn}</span>
                  </div>
                  <div className="text-center leading-tight py-0.5">
                    <div className="text-[10.5px] font-bold truncate">{patientName}</div>
                    <div className="text-[8.5px] font-mono text-slate-700 truncate">
                      {uhid}
                      {ageGender ? ` · ${ageGender}` : ''}
                    </div>
                    {encounterLabel && (
                      <div className="text-[8px] font-mono font-semibold text-blue-900 truncate">
                        {encounterLabel}
                        {doctorOrUnit ? ` · ${doctorOrUnit}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-center">
                    <BarcodeSvg value={scanCode} width={stickerSize === '50x30' ? 128 : 155} height={20} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 text-xs font-medium border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={triggerStickerPrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg hover:bg-slate-800"
            >
              <Printer className="w-3.5 h-3.5" />
              Print Thermal Sticker
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 17. HR CERTIFICATE & LETTER PRINT + WORD (.DOCX) MODAL
// ==========================================
export function HrCertificatePrintModal({
  certificate,
  settings,
  onClose,
}: {
  certificate: HrCertificateRecord;
  settings: LabSettings;
  onClose: () => void;
}) {
  return (
    <PrintModalShell
      title={`${certificate.certificateType} — ${certificate.staffName}`}
      subtitle={`${certificate.certificateNumber} · ${certificate.employeeCode} · ${certificate.issuedDateBs}`}
      defaultPaperSize="A4"
      settings={settings}
      onClose={onClose}
      extraToolbarButtons={
        <button
          type="button"
          onClick={() => {
            void exportLetterToDocx({
              hospitalName: settings.labName,
              hospitalNameNp: settings.labNameNp,
              addressLine: settings.addressLine,
              contactLine: settings.contactLine,
              panNumber: settings.panNumber,
              documentHeading: certificate.certificateType.toUpperCase(),
              refNumber: certificate.certificateNumber,
              dateBs: certificate.issuedDateBs,
              dateAd: certificate.issuedAt.slice(0, 10),
              department: certificate.department,
              recipientLine: `${certificate.staffName} (${certificate.employeeCode})`,
              recipientAddress: `${certificate.designation} · ${certificate.department}`,
              subject: certificate.subject,
              body: certificate.documentBody,
              signatoryName: settings.moduleSettings?.digitalVerifierName || 'Dr. Santosh Majhi',
              signatoryDesignation: 'Hospital Administrator / HR Director',
              fileName: `${certificate.certificateNumber}-${certificate.staffName.replace(/[^a-z0-9]/gi, '_')}.docx`,
            });
          }}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" />
          Download Word (.docx)
        </button>
      }
      renderSheets={(lh) => (
        <div
          className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[16mm] py-[13mm] text-slate-900 flex flex-col justify-between text-xs"
          style={{
            paddingTop: lh === 'without' ? `${settings.prePrintedTopMarginMm || 35}mm` : '13mm',
          }}
        >
          <div className="space-y-6">
            {lh === 'with' && (
              <HospitalLetterheadHeader
                settings={settings}
                refCode={certificate.certificateNumber}
                qrText={`HRC:${certificate.certificateNumber}|EMP:${certificate.employeeCode}|TYPE:${certificate.certificateType}`}
                rightTitle="HR CERTIFICATE"
              />
            )}

            <div className="flex justify-between items-center border-b border-slate-300 pb-2 font-mono text-[11px]">
              <div>
                Ref No: <strong>{certificate.certificateNumber}</strong>
                {certificate.linkedChalaniNumber ? ` · Chalani: ${certificate.linkedChalaniNumber}` : ''}
              </div>
              <div>Date (BS): <strong>{certificate.issuedDateBs}</strong></div>
            </div>

            <div className="text-center py-2">
              <div className="text-base font-bold uppercase tracking-wider underline text-slate-900">
                {certificate.certificateType}
              </div>
              <div className="text-[11px] font-semibold text-slate-600 mt-1">
                {certificate.subject}
              </div>
            </div>

            <div className="border border-slate-200 bg-slate-50/70 rounded-lg p-3 grid grid-cols-2 gap-2 text-[11px]">
              <div>Employee Name: <strong>{certificate.staffName}</strong></div>
              <div>Employee ID: <strong className="font-mono">{certificate.employeeCode}</strong></div>
              <div>Designation: <strong>{certificate.designation}</strong></div>
              <div>Department: <strong>{certificate.department}</strong></div>
              <div>Date Joined: <strong className="font-mono">{certificate.joinedAt}</strong></div>
              {certificate.relievedAt && <div>Date Relieved: <strong className="font-mono">{certificate.relievedAt}</strong></div>}
            </div>

            <div className="min-h-[115mm] text-[12.5px] leading-relaxed whitespace-pre-wrap text-slate-900 px-1">
              {certificate.documentBody}
            </div>
          </div>

          <div className="pt-6 border-t border-slate-300 flex justify-between items-end text-[11px]">
            <div>
              <div className="font-semibold text-slate-800">Human Resources Department</div>
              <div className="text-slate-500 mt-3">{sanitizePrintText(settings.labName)}</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-slate-900">{settings.moduleSettings?.digitalVerifierName || 'Dr. Santosh Majhi'}</div>
              <div className="text-slate-600">Hospital Administrator / Authorized Signatory</div>
            </div>
          </div>
        </div>
      )}
    />
  );
}



