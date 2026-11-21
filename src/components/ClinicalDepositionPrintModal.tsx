import React, { useMemo, useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import type {
  CollectionCenter,
  DocumentDesignTemplate,
  IpdAdmission,
  LabSettings,
  OpdVisit,
} from '../types/lims';
import { adToBs } from '../utils/nepaliDate';
import { computeIpdDailyAutoCharges } from '../utils/clinical';
import { encodeCode39Bars, generateQrDataUrl } from '../utils/codes';
import { BarcodeSvg, QrCodeSvg } from './DocumentCodes';
import { getPrintHeaderTitle, sanitizePrintText } from '../utils/printSanitizer';
import { executeSmartPrint } from '../utils/printHelper';

interface ClinicalDepositionPrintModalProps {
  mode: 'IPD' | 'OPD';
  admission?: IpdAdmission | null;
  opdVisit?: OpdVisit | null;
  settings: LabSettings;
  documentDesigns?: DocumentDesignTemplate[];
  centers?: CollectionCenter[];
  autoPrint?: boolean;
  onClose: () => void;
}

function drawPdfBarcode(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  targetWidthMm: number,
  heightMm: number
) {
  const { bars, totalWidth, cleanText } = encodeCode39Bars(value);
  const scale = targetWidthMm / totalWidth;
  doc.setFillColor(15, 23, 42);
  for (const bar of bars) {
    doc.rect(x + bar.x * scale, y, Math.max(0.25, bar.w * scale), heightMm, 'F');
  }
  doc.setFont('courier', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(51, 65, 85);
  doc.text(cleanText, x + targetWidthMm / 2, y + heightMm + 3, { align: 'center' });
}

export function ClinicalDepositionPrintModal({
  mode,
  admission,
  opdVisit,
  settings,
  documentDesigns = [],
  centers = [],
  autoPrint = false,
  onClose,
}: ClinicalDepositionPrintModalProps) {
  const [letterheadMode, setLetterheadMode] = useState<'with' | 'without'>(
    settings.moduleSettings?.printOptions?.defaultLetterheadMode === 'without-letterhead' ? 'without' : 'with'
  );
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const autoPrintedRef = React.useRef(false);
  const printableRef = React.useRef<HTMLDivElement | null>(null);

  const handlePrint = () => {
    executeSmartPrint({
      element: printableRef.current,
      pageCssSize: 'A4 portrait',
      documentTitle: `${mode} Record - ${mode === 'IPD' ? admission?.admissionNumber || '' : opdVisit?.tokenNumber || ''}`,
    });
  };

  React.useEffect(() => {
    if (!autoPrint || autoPrintedRef.current) return;
    const t = window.setTimeout(() => {
      if (!autoPrintedRef.current) {
        autoPrintedRef.current = true;
        handlePrint();
      }
    }, 220);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);

  const centerId = mode === 'IPD' ? admission?.centerId ?? null : opdVisit?.centerId ?? null;
  const activeDesign = useMemo(() => {
    const center = centerId ? centers.find((c) => c.id === centerId) : undefined;
    return (
      documentDesigns.find((d) => d.id === center?.designTemplateId) ||
      documentDesigns.find((d) => d.centerId === centerId) ||
      documentDesigns.find((d) => d.id === 'dsn-main') ||
      documentDesigns[0]
    );
  }, [documentDesigns, centers, centerId]);

  const refNumber =
    mode === 'IPD' ? admission?.admissionNumber || 'IPD' : opdVisit?.tokenNumber || 'OPD';
  const patientName = mode === 'IPD' ? admission?.patientName || '' : opdVisit?.patientName || '';
  const patientAge = mode === 'IPD' ? admission?.patientAge || 0 : opdVisit?.patientAge || 0;
  const patientAgeType =
    mode === 'IPD' ? admission?.patientAgeType || 'Years' : opdVisit?.patientAgeType || 'Years';
  const patientGender =
    mode === 'IPD' ? admission?.patientGender || 'Male' : opdVisit?.patientGender || 'Male';
  const patientPhone = mode === 'IPD' ? admission?.patientPhone || '' : opdVisit?.patientPhone || '';
  const patientAddress =
    mode === 'IPD' ? admission?.patientAddress || '' : opdVisit?.patientAddress || '';
  const centerName = sanitizePrintText(
    mode === 'IPD'
      ? admission?.centerName || settings.labName
      : opdVisit?.centerName || settings.labName,
    'Clinical Care Department'
  );
  const safeHeaderTitle = getPrintHeaderTitle(settings.labName, activeDesign?.headerTitle, 'CLINICAL RECORD & DEPOSITION');
  const safeHeaderTitleNp = sanitizePrintText(settings.labNameNp || activeDesign?.headerTitleNp);
  const safeAddress = sanitizePrintText(settings.addressLine || activeDesign?.addressText);
  const safeContact = sanitizePrintText(settings.contactLine || activeDesign?.phoneText);

  const startIso =
    mode === 'IPD' ? admission?.admittedAt || new Date().toISOString() : opdVisit?.visitDate || new Date().toISOString();
  const endIso = mode === 'IPD' ? admission?.dischargedAt : undefined;
  const startBs = adToBs(startIso);
  const endBs = endIso ? adToBs(endIso) : null;

  const medicines =
    mode === 'IPD' ? admission?.usedMedicines || [] : opdVisit?.prescribedMedicines || [];
  const investigations =
    mode === 'IPD' ? admission?.investigationsDone || [] : opdVisit?.investigations || [];
  const externalRef = mode === 'IPD' ? admission?.externalReferral : opdVisit?.externalReferral;
  const dispositionLabel = mode === 'IPD' ? admission?.disposition || 'Admitted' : opdVisit?.disposition || 'Waiting';

  const qrValue = `TYPE:${mode}|REF:${refNumber}|PT:${patientName}|DISP:${dispositionLabel}${
    externalRef ? `|REF_HOSP:${externalRef.referredToHospital}|PLACE:${externalRef.referredToPlace}` : ''
  }|PAN:${activeDesign?.panNumber || settings.panNumber}`;

  const autoCharges = useMemo(() => {
    if (mode !== 'IPD' || !admission) return null;
    return computeIpdDailyAutoCharges(admission, settings.moduleSettings, admission.dischargedAt);
  }, [mode, admission, settings.moduleSettings]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = 210;
      const marginX = 14;
      const contentW = pageW - marginX * 2;
      let y = letterheadMode === 'with' ? 12 : Math.max(18, settings.prePrintedTopMarginMm || 35);

      const qrData = await generateQrDataUrl(qrValue, 140);

      if (letterheadMode === 'with') {
        doc.setTextColor(29, 78, 216);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text(safeHeaderTitle.slice(0, 62), marginX, y + 4);
        doc.setTextColor(71, 85, 105);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(`${centerName} · PAN: ${activeDesign?.panNumber || settings.panNumber}`.slice(0, 75), marginX, y + 9);
        doc.text(safeAddress.slice(0, 78), marginX, y + 13);
        doc.text(safeContact.slice(0, 78), marginX, y + 17);
        doc.addImage(qrData, 'PNG', pageW - marginX - 18, y - 1, 18, 18);
        drawPdfBarcode(doc, refNumber, pageW - marginX - 56, y + 1, 35, 9);
        y += 21;
        doc.setDrawColor(29, 78, 216);
        doc.setLineWidth(0.6);
        doc.line(marginX, y, pageW - marginX, y);
        y += 5;
      }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      const docTitle =
        mode === 'IPD'
          ? `CLINICAL DEPOSITION, ${dispositionLabel.toUpperCase()} & REFERRAL SUMMARY`
          : 'OUTPATIENT (OPD) CONSULTATION, PRESCRIPTION & REFERRAL SLIP';
      doc.text(docTitle, pageW / 2, y, { align: 'center' });
      y += 5;

      // Patient info box
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(203, 213, 225);
      doc.rect(marginX, y, contentW, 22, 'FD');
      doc.setFontSize(8.2);
      doc.setFont('helvetica', 'bold');
      doc.text(`Patient: ${patientName}`, marginX + 3, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.text(`Age/Sex: ${patientAge} ${patientAgeType} / ${patientGender}`, marginX + 75, y + 5);
      doc.text(`Ref #: ${refNumber}`, marginX + 132, y + 5);
      doc.text(`Phone: ${patientPhone || '—'}`, marginX + 3, y + 10);
      doc.text(`Address: ${patientAddress.slice(0, 32)}`, marginX + 75, y + 10);
      doc.text(`Date (BS): ${startBs.formattedEn}`, marginX + 132, y + 10);
      doc.text(
        mode === 'IPD'
          ? `Doctor: ${(admission?.admittingDoctor || '').slice(0, 32)} · Ward/Bed: ${admission?.currentBedLabel || ''}`
          : `Consultant: ${(opdVisit?.consultingDoctor || '').slice(0, 32)} · Dept: ${opdVisit?.department || ''}`,
        marginX + 3,
        y + 15.5
      );
      doc.text(
        endBs ? `Discharged/Referred: ${endBs.formattedEn} (${endBs.timeEn})` : `Disposition: ${dispositionLabel}`,
        marginX + 105,
        y + 15.5
      );
      y += 26;

      // External Referral Box
      if (externalRef) {
        const hasExtraLine = Boolean(
          externalRef.ambulanceName || externalRef.ambulanceNumber || externalRef.departureTime
        );
        const boxH = hasExtraLine ? 31 : 24;
        doc.setFillColor(254, 242, 242);
        doc.setDrawColor(225, 29, 72);
        doc.rect(marginX, y, contentW, boxH, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(159, 18, 57);
        doc.text('EXTERNAL HOSPITAL REFERRAL / TRANSFER DESTINATION', marginX + 3, y + 5);
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(8);
        doc.text(
          `Referred Hospital: ${externalRef.referredToHospital}  |  Place: ${externalRef.referredToPlace}`.slice(0, 95),
          marginX + 3,
          y + 10.5
        );
        doc.setFont('helvetica', 'normal');
        doc.text(
          `Dept: ${externalRef.referredDepartment}  |  Transport: ${externalRef.transportMode}${externalRef.escortDoctorOrNurse ? ` (${externalRef.escortDoctorOrNurse})` : ''}`.slice(0, 95),
          marginX + 3,
          y + 15.5
        );
        if (hasExtraLine) {
          doc.text(
            `Ambulance: ${externalRef.ambulanceName || externalRef.transportMode}${externalRef.ambulanceNumber ? ` (${externalRef.ambulanceNumber})` : ''}  |  Departure: ${externalRef.departureTime || 'Immediate'}`.slice(0, 95),
            marginX + 3,
            y + 20.5
          );
          doc.text(`Reason: ${externalRef.referralReason}`.slice(0, 95), marginX + 3, y + 25.5);
        } else {
          doc.text(`Reason: ${externalRef.referralReason}`.slice(0, 95), marginX + 3, y + 20.5);
        }
        y += boxH + 4;

        if (externalRef.caseDetails || externalRef.clinicalHistorySummary) {
          const histText = [
            externalRef.caseDetails ? `Case Details: ${externalRef.caseDetails}` : '',
            externalRef.clinicalHistorySummary ? `History: ${externalRef.clinicalHistorySummary}` : '',
          ]
            .filter(Boolean)
            .join(' | ');
          const histLines = doc.splitTextToSize(histText, contentW);
          doc.setFontSize(7.8);
          doc.text(histLines, marginX, y);
          y += histLines.length * 3.7 + 3;
        }

        const clinItems =
          externalRef.clinicalTreatmentItems && externalRef.clinicalTreatmentItems.length > 0
            ? externalRef.clinicalTreatmentItems
            : (externalRef.attachedBilledItems || []).map((b) => ({
                id: b.id,
                source: b.source,
                dateIso: b.dateIso,
                category: b.category,
                description: b.description.replace(/\s*\(x\d+\)/gi, ''),
              }));
        if (clinItems.length > 0) {
          if (y > 240) {
            doc.addPage();
            y = 14;
          }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.text(
            `TREATMENTS, TESTS & PHARMACY MEDICINES GIVEN (${clinItems.length})`,
            marginX,
            y
          );
          y += 4;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.6);
          clinItems.slice(0, 26).forEach((item) => {
            if (y > 272) {
              doc.addPage();
              y = 14;
            }
            doc.text(
              `• [${item.category}] ${item.description}`.slice(0, 102),
              marginX + 2,
              y
            );
            y += 3.8;
          });
          y += 3;
        }
      }

      // Diagnosis & Course
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      const diagText =
        mode === 'IPD'
          ? `Admitting Dx: ${admission?.admittingDiagnosis || '—'}  |  Final Dx: ${admission?.finalDiagnosis || admission?.admittingDiagnosis || '—'}`
          : `Provisional Dx: ${opdVisit?.provisionalDiagnosis || '—'}  |  Complaint: ${opdVisit?.chiefComplaint || '—'}`;
      const diagLines = doc.splitTextToSize(diagText, contentW);
      doc.text(diagLines, marginX, y);
      y += diagLines.length * 4 + 3;

      if (mode === 'IPD' && admission?.hospitalCourseSummary) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const courseLines = doc.splitTextToSize(`Hospital Course: ${admission.hospitalCourseSummary}`, contentW);
        doc.text(courseLines, marginX, y);
        y += courseLines.length * 3.8 + 4;
      }

      // Used Medicines
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(
        mode === 'IPD' ? `USED MEDICINES & IV FLUIDS (${medicines.length})` : `PRESCRIBED MEDICINES (${medicines.length})`,
        marginX,
        y
      );
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      if (medicines.length === 0) {
        doc.text('No medicines logged.', marginX + 2, y);
        y += 5;
      } else {
        for (const m of medicines.slice(0, 14)) {
          if (y > 265) {
            doc.addPage();
            y = 14;
          }
          doc.text(
            `• ${m.medicineName} | ${m.dosageRoute}${m.batchNumber ? ` | Batch ${m.batchNumber}` : ''}`.slice(0, 105),
            marginX + 2,
            y
          );
          y += 4;
        }
        y += 2;
      }

      // Investigations Done
      if (y > 250) {
        doc.addPage();
        y = 14;
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.text(`INVESTIGATIONS DONE (${investigations.length})`, marginX, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      if (investigations.length === 0) {
        doc.text('No investigations logged.', marginX + 2, y);
        y += 5;
      } else {
        for (const inv of investigations.slice(0, 14)) {
          if (y > 265) {
            doc.addPage();
            y = 14;
          }
          doc.text(
            `• [${inv.category}] ${inv.serviceCode} ${inv.serviceName} (${inv.status})${inv.summaryFinding ? ` — ${inv.summaryFinding}` : ''}`.slice(0, 105),
            marginX + 2,
            y
          );
          y += 4;
        }
        y += 2;
      }

      // Clinical Stay & Care Schedule (Strictly Non-Financial — Bills Remain Standalone)
      if (mode === 'IPD' && admission && autoCharges) {
        if (y > 245) {
          doc.addPage();
          y = 14;
        }
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(203, 213, 225);
        doc.rect(marginX, y, contentW, 18, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(
          `CLINICAL STAY DURATION & CONDITION (${autoCharges.admittedBsLabel} -> ${autoCharges.billedTillBsLabel})`,
          marginX + 3,
          y + 5.5
        );
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text(
          `Condition: ${admission.dischargeCondition || 'Stable'} | Advice: ${(admission.dischargeAdvice || 'Continue prescribed regimen').slice(0, 80)}`,
          marginX + 3,
          y + 11.5
        );
        y += 22;
      }

      // Nursing & Case Consents Summary in IPD PDF
      if (mode === 'IPD' && admission) {
        const nCharts = admission.nursingCharts || [];
        const cConsents = admission.consents || [];
        if (y > 240) {
          doc.addPage();
          y = 14;
        }
        if (nCharts.length > 0) {
          const latest = nCharts[0];
          const totIn = nCharts.reduce((s, n) => s + (n.intakeOralMl || 0) + (n.intakeIvMl || 0), 0);
          const totOut = nCharts.reduce((s, n) => s + (n.outputUrineMl || 0) + (n.outputDrainMl || 0), 0);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.2);
          doc.text(`NURSING OBSERVATIONS SUMMARY (${nCharts.length} Entries)`, marginX, y);
          y += 4;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.text(
            `Latest Shift (${latest.shift}): BP ${latest.bp || '—'} · Pulse ${latest.pulseBpm || '—'} bpm · Temp ${latest.tempF || '—'}°F · SpO2 ${latest.spo2Pct || '—'}% · GCS ${latest.gcsScore || '15/15'} | Cumulative I/O: ${totIn} mL In / ${totOut} mL Out`,
            marginX + 2,
            y
          );
          y += 5;
        }
        if (cConsents.length > 0) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.2);
          doc.text(`CASE CONSENTS ON RECORD (${cConsents.length})`, marginX, y);
          y += 4;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.text(
            cConsents.map((c) => `${c.title} [${c.status}]`).join(' · ').slice(0, 120),
            marginX + 2,
            y
          );
          y += 5;
        }
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `${safeAddress} · Printed ${adToBs(new Date()).formattedEn}`,
        pageW / 2,
        286,
        { align: 'center' }
      );

      doc.save(`${refNumber}-${patientName.replace(/[^a-z0-9]/gi, '_')}-Deposition.pdf`);
    } finally {
      setDownloadingPdf(false);
    }
  };

  if (mode === 'IPD' && !admission) return null;
  if (mode === 'OPD' && !opdVisit) return null;

  const sheetJsx = (
    <div
      ref={printableRef}
      className="a4-sheet bg-white mx-auto w-[210mm] min-h-[297mm] shadow-lg border border-slate-300 px-[14mm] py-[10mm] text-slate-900 flex flex-col justify-between"
      style={{
        paddingTop: letterheadMode === 'without' ? `${settings.prePrintedTopMarginMm || 36}mm` : '10mm',
        paddingBottom: letterheadMode === 'without' ? `${settings.prePrintedBottomMarginMm || 22}mm` : '10mm',
      }}
    >
      <div className="space-y-4">
        {/* Letterhead */}
        {letterheadMode === 'with' && (
          <div className="border-b-2 border-blue-700 pb-3 flex items-start justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              {safeHeaderTitleNp && (
                <div className="text-[11px] font-bold text-blue-700 tracking-wide">
                  {safeHeaderTitleNp}
                </div>
              )}
              <div className="text-base font-bold text-slate-900 leading-tight">
                {safeHeaderTitle}
              </div>
              <div className="text-[10px] font-medium text-slate-700">{centerName}</div>
              <div className="text-[10px] text-slate-600">
                {safeAddress} · PAN:{' '}
                <span className="font-mono font-semibold">{activeDesign?.panNumber || settings.panNumber}</span>
              </div>
              <div className="text-[10px] text-slate-600">
                {safeContact}
              </div>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="text-right">
                <BarcodeSvg value={refNumber} width={135} height={30} />
              </div>
              <QrCodeSvg value={qrValue} size={58} />
            </div>
          </div>
        )}

        {/* Title */}
        <div className="text-center border-y border-slate-300 py-1.5 bg-slate-50">
          <div className="text-xs font-bold tracking-wider uppercase text-slate-900">
            {mode === 'IPD'
              ? `IPD Clinical Deposition, ${dispositionLabel} & Referral Summary`
              : 'Outpatient (OPD) Consultation, Prescription & Referral Slip'}
          </div>
        </div>

        {/* Patient & Encounter Details */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-[11px] border border-slate-300 rounded-lg p-3 bg-slate-50/70">
          <div>
            <span className="text-slate-500">Patient Name:</span>{' '}
            <strong className="text-slate-900">{patientName}</strong>
          </div>
          <div>
            <span className="text-slate-500">Age / Sex:</span>{' '}
            <strong className="font-mono">
              {patientAge} {patientAgeType} / {patientGender}
            </strong>
          </div>
          <div>
            <span className="text-slate-500">Record #:</span>{' '}
            <strong className="font-mono text-blue-800">{refNumber}</strong>
          </div>
          <div>
            <span className="text-slate-500">Phone:</span>{' '}
            <span className="font-mono">{patientPhone || '—'}</span>
          </div>
          <div>
            <span className="text-slate-500">Address:</span> <span>{patientAddress}</span>
          </div>
          <div>
            <span className="text-slate-500">Date (BS):</span>{' '}
            <span className="font-mono">{startBs.formattedEn}</span>
          </div>
          {mode === 'IPD' && admission ? (
            <>
              <div>
                <span className="text-slate-500">Admitting Doctor:</span>{' '}
                <strong>{admission.admittingDoctor}</strong>
              </div>
              <div>
                <span className="text-slate-500">Ward / Current Bed:</span>{' '}
                <strong className="font-mono">
                  {admission.currentBedLabel} ({admission.currentWardName})
                </strong>
              </div>
              <div>
                <span className="text-slate-500">Deposition Status:</span>{' '}
                <strong className="text-rose-700">{admission.disposition}</strong>
                {endBs ? <span className="font-mono text-[10px]"> · {endBs.formattedEn}</span> : null}
              </div>
            </>
          ) : opdVisit ? (
            <>
              <div>
                <span className="text-slate-500">Consultant:</span>{' '}
                <strong>{opdVisit.consultingDoctor}</strong>
              </div>
              <div>
                <span className="text-slate-500">Department:</span>{' '}
                <span>{opdVisit.department}</span>
              </div>
              <div>
                <span className="text-slate-500">Outcome:</span>{' '}
                <strong>{opdVisit.disposition}</strong>
              </div>
            </>
          ) : null}
        </div>

        {/* External Referral Destination Block */}
        {externalRef && (
          <div className="border-2 border-rose-500 bg-rose-50/70 rounded-lg p-3 space-y-1.5 text-[11px]">
            <div className="font-bold text-rose-900 uppercase tracking-wide text-[10px]">
              Referred / Transferred to External Hospital &amp; Place
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>
                <span className="text-slate-600">Referred Hospital:</span>{' '}
                <strong className="text-slate-900">{externalRef.referredToHospital}</strong>
              </div>
              <div>
                <span className="text-slate-600">Place / Address:</span>{' '}
                <strong className="text-slate-900">{externalRef.referredToPlace}</strong>
              </div>
              <div>
                <span className="text-slate-600">Referred Dept:</span>{' '}
                <span>{externalRef.referredDepartment}</span>
              </div>
              <div>
                <span className="text-slate-600">Transport &amp; Escort:</span>{' '}
                <span>
                  {externalRef.transportMode}
                  {externalRef.escortDoctorOrNurse ? ` (${externalRef.escortDoctorOrNurse})` : ''}
                </span>
              </div>
              {(externalRef.ambulanceName || externalRef.ambulanceNumber) && (
                <div>
                  <span className="text-slate-600">Ambulance Taken:</span>{' '}
                  <strong className="text-slate-900">
                    {externalRef.ambulanceName || externalRef.transportMode}
                    {externalRef.ambulanceNumber ? ` (${externalRef.ambulanceNumber})` : ''}
                  </strong>
                </div>
              )}
              {externalRef.departureTime && (
                <div>
                  <span className="text-slate-600">Departure Time:</span>{' '}
                  <strong className="font-mono text-rose-900">{externalRef.departureTime}</strong>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-slate-600">Reason for Referral:</span>{' '}
                <strong className="text-slate-900">{externalRef.referralReason}</strong>
              </div>
              <div className="col-span-2">
                <span className="text-slate-600">Condition at Referral:</span>{' '}
                <span>{externalRef.conditionAtReferral}</span>
              </div>
              {externalRef.caseDetails && (
                <div className="col-span-2">
                  <span className="text-slate-600">Case Details:</span>{' '}
                  <span>{externalRef.caseDetails}</span>
                </div>
              )}
              {externalRef.clinicalHistorySummary && (
                <div className="col-span-2">
                  <span className="text-slate-600">Clinical History Summary:</span>{' '}
                  <span>{externalRef.clinicalHistorySummary}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clinical Summary & Bed Transfer History */}
        <div className="space-y-2 text-[11px]">
          {mode === 'IPD' && admission ? (
            <>
              <div className="grid grid-cols-2 gap-3 border border-slate-200 rounded-lg p-2.5">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Admitting Diagnosis</div>
                  <div className="font-medium text-slate-900">{admission.admittingDiagnosis}</div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Final / Referral Diagnosis</div>
                  <div className="font-medium text-slate-900">
                    {admission.finalDiagnosis || admission.admittingDiagnosis}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-[10px] font-semibold uppercase text-slate-500">Hospital Course &amp; Stabilization</div>
                  <div className="text-slate-800">{admission.hospitalCourseSummary}</div>
                </div>
              </div>

              {admission.bedTransfers.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase text-slate-700 mb-1">
                    Internal Ward / Bed Transfer Log ({admission.bedTransfers.length})
                  </div>
                  <table className="w-full border border-slate-300 text-[10px]">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="p-1.5 text-left border-b border-slate-300">Date (BS)</th>
                        <th className="p-1.5 text-left border-b border-slate-300">From Bed</th>
                        <th className="p-1.5 text-left border-b border-slate-300">To Bed</th>
                        <th className="p-1.5 text-left border-b border-slate-300">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {admission.bedTransfers.map((tr) => (
                        <tr key={tr.id} className="border-b border-slate-200">
                          <td className="p-1.5 font-mono">{adToBs(tr.transferredAt).formattedEn}</td>
                          <td className="p-1.5">{tr.fromBedLabel}</td>
                          <td className="p-1.5 font-semibold">{tr.toBedLabel}</td>
                          <td className="p-1.5">{tr.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : opdVisit ? (
            <div className="border border-slate-200 rounded-lg p-2.5 space-y-1">
              <div>
                <strong>Chief Complaint:</strong> {opdVisit.chiefComplaint}
              </div>
              <div>
                <strong>Vitals:</strong>{' '}
                <span className="font-mono">
                  BP {opdVisit.vitals.bp || '—'} · Pulse {opdVisit.vitals.pulseBpm || '—'} bpm · Temp{' '}
                  {opdVisit.vitals.tempF || '—'}°F · SpO2 {opdVisit.vitals.spo2Pct || '—'}%
                </span>
              </div>
              <div>
                <strong>Provisional Diagnosis:</strong> {opdVisit.provisionalDiagnosis || '—'}
              </div>
              {opdVisit.clinicalNotes && (
                <div>
                  <strong>Clinical Notes:</strong> {opdVisit.clinicalNotes}
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Used Medicines Table */}
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-700 mb-1">
            {mode === 'IPD'
              ? `Used Medicines, Injections & IV Fluids During Stay (${medicines.length})`
              : `Prescribed Medications (${medicines.length})`}
          </div>
          <table className="w-full border border-slate-300 text-[10px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-1.5 text-left border-b border-slate-300">Medicine Name</th>
                <th className="p-1.5 text-left border-b border-slate-300">Dosage &amp; Route</th>
                <th className="p-1.5 text-left border-b border-slate-300">Batch</th>
              </tr>
            </thead>
            <tbody>
              {medicines.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-2 text-center text-slate-500">
                    No medicines recorded.
                  </td>
                </tr>
              ) : (
                medicines.map((m) => (
                  <tr key={m.id} className="border-b border-slate-200">
                    <td className="p-1.5 font-medium">
                      {m.medicineName}
                      {m.genericName ? <span className="text-slate-500"> ({m.genericName})</span> : ''}
                    </td>
                    <td className="p-1.5">{m.dosageRoute}</td>
                    <td className="p-1.5 font-mono">
                      {m.batchNumber ? `${m.batchNumber}${m.expiryDate ? ` · Exp ${m.expiryDate}` : ''}` : 'Ward Stock'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Investigations Done Table */}
        <div>
          <div className="text-[10px] font-bold uppercase text-slate-700 mb-1">
            Investigations &amp; Procedures Done ({investigations.length})
          </div>
          <table className="w-full border border-slate-300 text-[10px]">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-1.5 text-left border-b border-slate-300">Investigation / Study</th>
                <th className="p-1.5 text-left border-b border-slate-300">Accession #</th>
                <th className="p-1.5 text-left border-b border-slate-300">Status</th>
                <th className="p-1.5 text-left border-b border-slate-300">Findings / Key Values</th>
              </tr>
            </thead>
            <tbody>
              {investigations.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-2 text-center text-slate-500">
                    No investigations recorded.
                  </td>
                </tr>
              ) : (
                investigations.map((inv) => (
                  <tr key={inv.id} className="border-b border-slate-200">
                    <td className="p-1.5 font-medium">
                      [{inv.category === 'RADIOLOGY' ? 'RAD' : 'LAB'}] {inv.serviceCode} — {inv.serviceName}
                    </td>
                    <td className="p-1.5 font-mono">{inv.linkedAccessionNumber || '—'}</td>
                    <td className="p-1.5">{inv.status}</td>
                    <td className="p-1.5">{inv.summaryFinding || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Nursing Chart Summary & Case Consents Verified (IPD) */}
        {mode === 'IPD' && admission && ((admission.nursingCharts || []).length > 0 || (admission.consents || []).length > 0) && (
          <div className="grid grid-cols-2 gap-3 text-[10px]">
            <div className="border border-slate-300 rounded-lg p-2.5 space-y-1">
              <div className="font-bold uppercase text-slate-700">
                Nursing Observations Summary ({(admission.nursingCharts || []).length})
              </div>
              {(admission.nursingCharts || []).length === 0 ? (
                <div className="text-slate-500">No shift nursing chart logs recorded.</div>
              ) : (
                <>
                  <div className="font-mono">
                    Latest ({admission.nursingCharts![0].shift}): BP {admission.nursingCharts![0].bp || '—'} · Pulse{' '}
                    {admission.nursingCharts![0].pulseBpm || '—'} · Temp {admission.nursingCharts![0].tempF || '—'}°F · SpO₂{' '}
                    {admission.nursingCharts![0].spo2Pct || '—'}%
                  </div>
                  <div className="font-mono text-slate-700">
                    Cumulative Fluid I/O:{' '}
                    {admission.nursingCharts!.reduce((s, n) => s + (n.intakeOralMl || 0) + (n.intakeIvMl || 0), 0)} mL In /{' '}
                    {admission.nursingCharts!.reduce((s, n) => s + (n.outputUrineMl || 0) + (n.outputDrainMl || 0), 0)} mL Out
                  </div>
                  <div className="text-slate-600">
                    Note: {admission.nursingCharts![0].nursingCareNote} ({admission.nursingCharts![0].recordedBy})
                  </div>
                </>
              )}
            </div>
            <div className="border border-slate-300 rounded-lg p-2.5 space-y-1">
              <div className="font-bold uppercase text-slate-700">
                Case Consents On File ({(admission.consents || []).length})
              </div>
              {(admission.consents || []).length === 0 ? (
                <div className="text-slate-500">No consents attached.</div>
              ) : (
                <ul className="space-y-0.5">
                  {admission.consents!.map((c) => (
                    <li key={c.id} className="flex justify-between gap-2">
                      <span className="truncate">{c.title}</span>
                      <span className={c.status === 'Signed & Verified' ? 'text-emerald-700 font-semibold shrink-0' : 'text-amber-700 shrink-0'}>
                        {c.status === 'Signed & Verified' ? `Signed (${c.patientOrGuardianName})` : 'Pending'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Condition & Follow-Up Instructions (Strictly Clinical — Hospital Bills Always Standalone) */}
        {mode === 'IPD' && admission && autoCharges && (
          <div className="border border-slate-300 rounded-lg p-3 space-y-1.5 text-[11px] bg-slate-50/70">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase text-slate-700">
              <span>Condition at Deposition &amp; Follow-Up Instructions</span>
              <span className="font-mono font-normal text-slate-600">
                Stay Period: {autoCharges.admittedBsLabel} &rarr; {autoCharges.billedTillBsLabel}
              </span>
            </div>
            <div>
              <span className="text-slate-600">Condition on Deposition:</span>{' '}
              <strong>{admission.dischargeCondition || 'Under Care'}</strong>
            </div>
            <div>
              <span className="text-slate-600">Clinical Discharge Advice:</span>{' '}
              <span>{admission.dischargeAdvice || 'Continue prescribed regimen and emergency red-flag watch.'}</span>
            </div>
            {admission.followUpDateBs && (
              <div>
                <span className="text-slate-600">Follow-Up Review Date:</span>{' '}
                <strong className="font-mono">{admission.followUpDateBs}</strong>
              </div>
            )}
          </div>
        )}

        {/* Auto-Attached Referral Clinical Treatments, Tests & Pharmacy Medicines (NO Price / NO Quantity) */}
        {(() => {
          const clinItems =
            externalRef?.clinicalTreatmentItems && externalRef.clinicalTreatmentItems.length > 0
              ? externalRef.clinicalTreatmentItems
              : (externalRef?.attachedBilledItems || []).map((b) => ({
                  id: b.id,
                  source: b.source,
                  dateIso: b.dateIso,
                  category: b.category,
                  description: b.description.replace(/\s*\(x\d+\)/gi, ''),
                }));
          if (clinItems.length === 0) return null;
          return (
            <div className="space-y-1">
              <div className="text-[10px] font-bold uppercase text-rose-900">
                Clinical Treatments, Hospital POS Services &amp; Pharmacy Medicines Given ({clinItems.length})
              </div>
              <table className="w-full text-[10px] border-collapse border border-slate-300">
                <thead className="bg-rose-50/70 text-slate-700">
                  <tr>
                    <th className="p-1.5 text-left border border-slate-300">Date (BS)</th>
                    <th className="p-1.5 text-left border border-slate-300">Category</th>
                    <th className="p-1.5 text-left border border-slate-300">Service / Test / Medicine Administered</th>
                  </tr>
                </thead>
                <tbody>
                  {clinItems.map((item, idx) => (
                    <tr key={`${item.id}-${idx}`}>
                      <td className="p-1.5 font-mono border border-slate-200 whitespace-nowrap">
                        {adToBs(item.dateIso).formattedEn}
                      </td>
                      <td className="p-1.5 border border-slate-200">{item.category}</td>
                      <td className="p-1.5 border border-slate-200 font-medium">{item.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
      </div>

      {/* Signatures & Footer */}
      <div className="pt-4 mt-4 border-t border-slate-300 flex items-end justify-between text-[10px]">
        <div>
          <div className="font-semibold text-slate-800">Attending Physician / Authorized Officer</div>
          <div className="text-slate-500 mt-3">
            {mode === 'IPD' ? admission?.dischargedBy || admission?.admittingDoctor : opdVisit?.consultingDoctor}
          </div>
        </div>
        <div className="text-center text-slate-500">
          Official Clinical Record · Nepal BS Date Verified
        </div>
        <div className="text-right">
          <div className="font-semibold text-slate-800">Patient / Attendant Acknowledgement</div>
          <div className="text-slate-500 mt-3">Signature &amp; Relation</div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="no-print fixed inset-0 z-50 bg-slate-950/65 flex flex-col">
        <div className="bg-white border-b border-slate-200 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {mode === 'IPD' ? `IPD Deposition & Referral Print — ${refNumber}` : `OPD Consultation & Referral Slip — ${refNumber}`}
            </h2>
            <p className="text-xs text-slate-500">
              A4 print-ready with Used Medicines, Investigations Done, Bed History &amp; Referred Place/Hospital
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                Without Letterhead
              </button>
            </div>

            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Building PDF...' : 'Download A4 PDF'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print A4 Summary
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

        <div className="flex-1 overflow-y-auto bg-slate-200 p-6">{sheetJsx}</div>
      </div>
    </>
  );
}
