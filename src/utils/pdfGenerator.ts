import { jsPDF } from 'jspdf';
import type { DocumentDesignTemplate, LabOrder, LabSettings } from '../types/lims';
import { adToBs, formatNpr } from './nepaliDate';
import { encodeCode39Bars, generateQrDataUrl } from './codes';
import { getPrintHeaderTitle, sanitizePrintText } from './printSanitizer';

function buildQrContent(order: LabOrder, settings: LabSettings, design?: DocumentDesignTemplate): string {
  const bs = adToBs(order.orderedAt);
  const mode = design?.qrPayloadMode || 'VERIFY_URL';
  if (mode === 'PATIENT_BILL') {
    return `INV:${order.invoiceNumber}|ACC:${order.accessionNumber}|PT:${order.patientName}|NPR:${order.totalAmount}|BS:${bs.formattedEn}|PAN:${design?.panNumber || settings.panNumber}`;
  }
  if (mode === 'ACCESSION_PAN') {
    return `ACC:${order.accessionNumber}|PAN:${design?.panNumber || settings.panNumber}|STATUS:${order.status}`;
  }
  return `${window.location.origin}/?verify=${encodeURIComponent(order.accessionNumber)}&inv=${encodeURIComponent(order.invoiceNumber)}&pan=${encodeURIComponent(design?.panNumber || settings.panNumber)}`;
}

function drawBarcodeOnPdf(doc: jsPDF, value: string, x: number, y: number, targetWidthMm: number, heightMm: number) {
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

function hexToRgb(hex?: string): [number, number, number] {
  const clean = (hex || '#1d4ed8').replace('#', '');
  if (clean.length !== 6) return [29, 78, 216];
  const n = parseInt(clean, 16);
  if (Number.isNaN(n)) return [29, 78, 216];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function tryAddDataImage(doc: jsPDF, dataUrl: string | undefined, x: number, y: number, w: number, h: number): boolean {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return false;
  try {
    const fmt = dataUrl.includes('image/png') ? 'PNG' : 'JPEG';
    doc.addImage(dataUrl, fmt, x, y, w, h);
    return true;
  } catch {
    return false;
  }
}

export async function downloadOrderReportPdf(
  order: LabOrder,
  settings: LabSettings,
  design?: DocumentDesignTemplate,
  letterheadMode: 'with' | 'without' = 'with',
  topOffsetMm = 38,
  bottomOffsetMm = 22
): Promise<void> {
  const paperFormat = design?.paperFormat || settings.moduleSettings?.printOptions?.defaultPaperSize || 'A5';
  const isA5 = paperFormat === 'A5' || paperFormat === 'THERMAL_80MM';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: isA5 ? 'a5' : 'a4' });
  const pageWidth = isA5 ? 148 : 210;
  const pageHeight = isA5 ? 210 : 297;
  const marginX = isA5 ? 8 : 14;
  const contentWidth = pageWidth - marginX * 2;
  const scale = isA5 ? 0.72 : 1;
  const [ar, ag, ab] = hexToRgb(design?.accentColor);
  const bs = adToBs(order.orderedAt);
  const reportedBs = order.validatedAt ? adToBs(order.validatedAt) : null;

  let y = letterheadMode === 'with' ? (isA5 ? 8 : 12) : Math.max(14, topOffsetMm);

  const showQr = design ? design.showQrCode : true;
  const showBar = design ? design.showBarcode : true;
  const qrData = showQr ? await generateQrDataUrl(buildQrContent(order, settings, design), 140) : null;

  const isRadiologyOrder = order.tests.every(
    (t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology'
  );

  const sigBoxes = settings.moduleSettings?.signatureBoxes || [];
  const sigRole = isRadiologyOrder ? 'RADIOLOGIST' : 'PATHOLOGIST';
  const matchedSig = sigBoxes.find((s) => s.roleKey === sigRole) || sigBoxes.find((s) => s.roleKey === 'DOCTOR');

  // Watermark
  if (design?.showWatermark && design.watermarkText) {
    doc.setTextColor(232, 236, 242);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isA5 ? 24 : 34);
    doc.text(design.watermarkText.slice(0, 28), pageWidth / 2, pageHeight * 0.52, { align: 'center', angle: 32 });
  }

  // Dynamic Header
  if (letterheadMode === 'with' && (design ? design.showLetterheadBanner : true)) {
    const title = getPrintHeaderTitle(settings.labName, design?.headerTitle, 'DIAGNOSTIC LABORATORY REPORT');
    const subTitle = sanitizePrintText(settings.accreditationLine || design?.subTitle);
    const addr = sanitizePrintText(settings.addressLine || design?.addressText);
    const phone = sanitizePrintText(settings.contactLine || design?.phoneText);
    const pan = design?.panNumber || settings.panNumber;

    const logoAdded = tryAddDataImage(
      doc,
      settings.moduleSettings?.hospitalLogoDataUrl,
      marginX,
      y,
      isA5 ? 11 : 14,
      isA5 ? 11 : 14
    );
    const textX = logoAdded ? marginX + (isA5 ? 13 : 16) : marginX;

    doc.setTextColor(ar, ag, ab);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isA5 ? 11 : 13.5);
    doc.text(title.slice(0, 52), textX, y + 3.5);

    doc.setTextColor(51, 65, 85);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isA5 ? 6.8 : 8);
    doc.text(subTitle.slice(0, 68), textX, y + 7.2);
    doc.text(`${addr}${design?.showPan !== false ? ` · PAN: ${pan}` : ''}`.slice(0, 74), textX, y + 10.6);
    doc.text(phone.slice(0, 74), textX, y + 14);

    const qrSize = isA5 ? 13 : 18;
    if (qrData) {
      doc.addImage(qrData, 'PNG', pageWidth - marginX - qrSize, y - 0.5, qrSize, qrSize);
    }
    if (showBar) {
      const barVal = design?.barcodeSource === 'INVOICE' ? order.invoiceNumber : order.accessionNumber;
      const barW = isA5 ? 25 : 36;
      drawBarcodeOnPdf(doc, barVal, pageWidth - marginX - qrSize - barW - 2, y + 0.5, barW, isA5 ? 6.5 : 9);
    }

    y += isA5 ? 16 : 20;
    doc.setDrawColor(ar, ag, ab);
    doc.setLineWidth(0.6);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 3.5;
  } else {
    doc.setFont('courier', 'bold');
    doc.setFontSize(isA5 ? 7.5 : 9);
    doc.setTextColor(30, 41, 59);
    doc.text(`Accession: ${order.accessionNumber} · ${order.fiscalYear}`, marginX, y);
    if (qrData) {
      doc.addImage(qrData, 'PNG', pageWidth - marginX - 13, y - 5, 12, 12);
    }
    y += 5;
  }

  // Report Heading
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isA5 ? 9 : 10.5);
  doc.setTextColor(15, 23, 42);
  const heading = isRadiologyOrder
    ? design?.radiologyHeading || 'DEPARTMENT OF RADIOLOGY & DIAGNOSTIC IMAGING REPORT'
    : design?.reportHeading || 'CLINICAL DIAGNOSTIC LABORATORY REPORT';
  doc.text(heading, pageWidth / 2, y + 2, { align: 'center' });
  y += 5;

  // Patient Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, contentWidth, isA5 ? 20 : 24, 'FD');

  doc.setFontSize(isA5 ? 7.2 : 8.5);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.text(`Patient: ${order.patientName}`, marginX + 2.5, y + 4.5);
  doc.setFont('helvetica', 'normal');
  doc.text(`Age/Sex: ${order.patientAge} ${order.patientAgeType} / ${order.patientGender}`, marginX + 55 * scale, y + 4.5);
  doc.text(`Acc: ${order.accessionNumber}`, marginX + 128 * scale, y + 4.5);

  doc.text(`Phone: ${order.patientPhone || '—'}`, marginX + 2.5, y + 9);
  doc.text(`Addr: ${(order.patientAddress || '—').slice(0, 26)}`, marginX + 55 * scale, y + 9);
  doc.text(`Inv: ${order.invoiceNumber}`, marginX + 128 * scale, y + 9);

  if (design?.showDoctorRef !== false) {
    doc.text(`Ref By: ${(order.referringDoctor || 'Self').slice(0, 26)}`, marginX + 2.5, y + 13.5);
  }
  doc.text(`Facility: ${sanitizePrintText(settings.labName, 'Diagnostic Lab').slice(0, 26)}`, marginX + 55 * scale, y + 13.5);
  doc.text(`Status: ${order.status === 'Validated' || order.status === 'Dispatched' ? 'VERIFIED' : 'PROVISIONAL'}`, marginX + 128 * scale, y + 13.5);

  if (design?.showNepaliDate !== false) {
    doc.text(`Reg (BS): ${bs.formattedEn} ${bs.timeEn}`, marginX + 2.5, y + 18);
    doc.text(`Rpt (BS): ${reportedBs ? `${reportedBs.formattedEn} ${reportedBs.timeEn}` : 'Pending'}`, marginX + 55 * scale, y + 18);
  }
  doc.text(`FY: ${order.fiscalYear}`, marginX + 128 * scale, y + 18);

  y += isA5 ? 23 : 28;

  const ensureSpace = (neededMm: number) => {
    const limit = pageHeight - (letterheadMode === 'without' ? bottomOffsetMm : isA5 ? 24 : 28);
    if (y + neededMm > limit) {
      doc.addPage();
      y = 12;
    }
  };

  for (const test of order.tests) {
    ensureSpace(22);
    doc.setFillColor(ar, ag, ab);
    doc.rect(marginX, y, contentWidth, isA5 ? 5.5 : 6.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isA5 ? 7.8 : 9);
    doc.text(`${test.serviceName} (${test.serviceCode})`, marginX + 2, y + (isA5 ? 3.8 : 4.4));
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isA5 ? 6.5 : 7.5);
    doc.text(test.modality ? `Modality: ${test.modality}` : test.department, pageWidth - marginX - 2, y + (isA5 ? 3.8 : 4.4), { align: 'right' });
    y += isA5 ? 7.5 : 9;

    if (test.radiologyReport) {
      const rad = test.radiologyReport;
      doc.setTextColor(15, 23, 42);
      if (rad.clinicalHistory) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 7.5 : 8.5);
        doc.text('Indication: ', marginX, y);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(rad.clinicalHistory, contentWidth - 22);
        doc.text(lines, marginX + 20, y);
        y += lines.length * 3.6 + 1.5;
      }
      if (rad.technique) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 7.5 : 8.5);
        doc.text('Technique: ', marginX, y);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(rad.technique, contentWidth - 20);
        doc.text(lines, marginX + 19, y);
        y += lines.length * 3.6 + 2;
      }

      if (rad.measurements && rad.measurements.length > 0) {
        ensureSpace(15);
        doc.setFillColor(241, 245, 249);
        doc.rect(marginX, y, contentWidth, 5, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 7 : 8);
        doc.text('Measurement', marginX + 2, y + 3.5);
        doc.text('Observed', marginX + contentWidth * 0.52, y + 3.5);
        doc.text('Reference', marginX + contentWidth * 0.78, y + 3.5);
        y += 5.5;

        doc.setFont('helvetica', 'normal');
        for (const m of rad.measurements) {
          ensureSpace(5);
          doc.text(m.label.slice(0, 32), marginX + 2, y + 2.8);
          doc.setFont('courier', 'bold');
          doc.text(`${m.value || '—'} ${m.unit}`.trim(), marginX + contentWidth * 0.52, y + 2.8);
          doc.setFont('courier', 'normal');
          doc.text((m.normalRange || '—').slice(0, 18), marginX + contentWidth * 0.78, y + 2.8);
          doc.setDrawColor(226, 232, 240);
          doc.line(marginX, y + 4, pageWidth - marginX, y + 4);
          y += 4.8;
        }
        y += 1.5;
      }

      for (const sec of rad.sections) {
        ensureSpace(12);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 7.5 : 8.5);
        doc.setTextColor(ar, ag, ab);
        doc.text(sec.title.toUpperCase(), marginX, y + 2);
        y += 4.5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(isA5 ? 7.5 : 8.5);
        doc.setTextColor(15, 23, 42);
        const lines = doc.splitTextToSize(sec.content || 'Normal study.', contentWidth - 2);
        ensureSpace(lines.length * 3.6 + 2);
        doc.text(lines, marginX + 2, y);
        y += lines.length * 3.6 + 2.5;
      }

      if (rad.impression) {
        ensureSpace(14);
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(ar, ag, ab);
        const impLines = doc.splitTextToSize(rad.impression, contentWidth - 6);
        const boxH = Math.max(9, impLines.length * 3.8 + 6);
        doc.rect(marginX, y, contentWidth, boxH, 'FD');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 7.8 : 9);
        doc.setTextColor(rad.criticalFinding ? 190 : ar, rad.criticalFinding ? 18 : ag, rad.criticalFinding ? 60 : ab);
        doc.text(rad.criticalFinding ? 'IMPRESSION (CRITICAL ALERT):' : 'IMPRESSION:', marginX + 2.5, y + 4);
        doc.setTextColor(15, 23, 42);
        doc.setFontSize(isA5 ? 7.5 : 8.5);
        doc.text(impLines, marginX + 2.5, y + 8);
        y += boxH + 2.5;
      }
    } else {
      doc.setFillColor(241, 245, 249);
      doc.rect(marginX, y, contentWidth, 5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(isA5 ? 7 : 8);
      doc.setTextColor(51, 65, 85);
      doc.text('Parameter', marginX + 2, y + 3.5);
      doc.text('Result', marginX + contentWidth * 0.44, y + 3.5);
      doc.text('Flag', marginX + contentWidth * 0.60, y + 3.5);
      doc.text('Unit', marginX + contentWidth * 0.74, y + 3.5);
      doc.text('Ref. Interval', marginX + contentWidth * 0.85, y + 3.5);
      y += 5.8;

      for (const p of test.parameterResults) {
        ensureSpace(6);
        const isAbn = p.value !== null && p.flag !== 'NORMAL';
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(isA5 ? 7.2 : 8.2);
        doc.setTextColor(15, 23, 42);
        doc.text(p.parameterName.slice(0, isA5 ? 30 : 44), marginX + 2, y + 3);

        doc.setFont('courier', isAbn ? 'bold' : 'normal');
        if (isAbn) doc.setTextColor(190, 18, 60);
        doc.text(p.value !== null ? String(p.value) : '—', marginX + contentWidth * 0.44, y + 3);
        doc.text(
          p.value === null ? 'PEND' : p.flag === 'NORMAL' ? 'Normal' : p.flag.replace('_', ' '),
          marginX + contentWidth * 0.60,
          y + 3
        );

        doc.setTextColor(71, 85, 105);
        doc.setFont('courier', 'normal');
        doc.text((p.unit || '-').slice(0, 8), marginX + contentWidth * 0.74, y + 3);
        doc.text(p.refRangeDisplay.slice(0, isA5 ? 14 : 18), marginX + contentWidth * 0.85, y + 3);

        doc.setDrawColor(226, 232, 240);
        doc.line(marginX, y + 4.3, pageWidth - marginX, y + 4.3);
        y += isA5 ? 5 : 5.8;
      }

      if (test.interpretation) {
        ensureSpace(10);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 7 : 8);
        doc.setTextColor(51, 65, 85);
        const lines = doc.splitTextToSize(`Interpretation: ${test.interpretation}`, contentWidth - 4);
        doc.text(lines, marginX + 2, y + 2.5);
        y += lines.length * 3.4 + 3;
      }
    }
  }

  // Signature Footer
  const footerY = Math.max(y + 6, pageHeight - (isA5 ? 25 : 34));
  doc.setDrawColor(203, 213, 225);
  doc.line(marginX, footerY, pageWidth - marginX, footerY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isA5 ? 6.5 : 7.5);
  doc.setTextColor(71, 85, 105);
  const disclaimer =
    design?.footerDisclaimerText ||
    'Results relate exclusively to specimen/study examined. Correlate findings clinically.';
  doc.text(doc.splitTextToSize(disclaimer, contentWidth * 0.56), marginX, footerY + 4.5);

  if (matchedSig?.signatureDataUrl) {
    tryAddDataImage(doc, matchedSig.signatureDataUrl, pageWidth - marginX - 32, footerY + 1, 30, 8);
  }

  const sigNameY = matchedSig?.signatureDataUrl ? footerY + 11 : footerY + 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isA5 ? 7.5 : 8.5);
  doc.setTextColor(15, 23, 42);
  if (order.status === 'Validated' || order.status === 'Dispatched') {
    doc.text(
      `/s/ ${order.validatedByName || matchedSig?.signerName || 'Authorized Signatory'}`,
      pageWidth - marginX,
      sigNameY,
      { align: 'right' }
    );
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isA5 ? 6.5 : 7.5);
    doc.text(
      `${order.validatedByDesignation || matchedSig?.designation || design?.footerSignatureTitle || 'Consultant'} · ${order.validatedByRegNo || matchedSig?.regNo || ''}`,
      pageWidth - marginX,
      sigNameY + 4,
      { align: 'right' }
    );
  } else {
    doc.setTextColor(180, 83, 9);
    doc.text('PROVISIONAL REPORT — PENDING FINAL SIGN-OFF', pageWidth - marginX, sigNameY, { align: 'right' });
  }

  doc.save(`${order.accessionNumber}-Report.pdf`);
}

export async function downloadPosBillPdf(
  order: LabOrder,
  settings: LabSettings,
  design?: DocumentDesignTemplate,
  letterheadMode: 'with' | 'without' = 'with',
  topOffsetMm = 38,
  bottomOffsetMm = 22
): Promise<void> {
  const paperFormat = design?.paperFormat || settings.moduleSettings?.printOptions?.defaultPaperSize || 'A5';
  const isA5 = paperFormat === 'A5' || paperFormat === 'THERMAL_80MM';
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: isA5 ? 'a5' : 'a4' });
  const pageWidth = isA5 ? 148 : 210;
  const pageHeight = isA5 ? 210 : 297;
  const marginX = isA5 ? 8 : 14;
  const contentWidth = pageWidth - marginX * 2;
  const [ar, ag, ab] = hexToRgb(design?.accentColor);
  const bs = adToBs(order.orderedAt);

  const showQr = design ? design.showQrCode : true;
  const showBar = design ? design.showBarcode : true;
  const qrData = showQr ? await generateQrDataUrl(buildQrContent(order, settings, design), 130) : null;
  const cashierSig = (settings.moduleSettings?.signatureBoxes || []).find((s) => s.roleKey === 'HOSPITAL_CASHIER');

  let y = letterheadMode === 'with' ? (isA5 ? 9 : 14) : Math.max(14, topOffsetMm);
  if (letterheadMode === 'with') {
    const logoAdded = tryAddDataImage(doc, settings.moduleSettings?.hospitalLogoDataUrl, marginX, y, isA5 ? 11 : 14, isA5 ? 11 : 14);
    const textX = logoAdded ? marginX + (isA5 ? 13 : 16) : marginX;

    doc.setTextColor(ar, ag, ab);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(isA5 ? 11.5 : 14);
    doc.text(getPrintHeaderTitle(settings.labName, design?.headerTitle, 'HOSPITAL & DIAGNOSTIC TAX INVOICE').slice(0, 52), textX, y + 3.5);

    doc.setTextColor(51, 65, 85);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(isA5 ? 7 : 8.5);
    doc.text(sanitizePrintText(settings.addressLine || design?.addressText), textX, y + 8);
    doc.text(`${sanitizePrintText(settings.contactLine || design?.phoneText)} · PAN: ${design?.panNumber || settings.panNumber}`.slice(0, 74), textX, y + 12);

    const qrSize = isA5 ? 13 : 18;
    if (qrData) {
      doc.addImage(qrData, 'PNG', pageWidth - marginX - qrSize, y - 0.5, qrSize, qrSize);
    }
    if (showBar) {
      const barW = isA5 ? 26 : 38;
      drawBarcodeOnPdf(
        doc,
        design?.barcodeSource === 'ACCESSION' ? order.accessionNumber : order.invoiceNumber,
        pageWidth - marginX - qrSize - barW - 2,
        y + 0.5,
        barW,
        isA5 ? 6.5 : 9
      );
    }

    y += isA5 ? 16 : 20;
    doc.setDrawColor(15, 23, 42);
    doc.setLineWidth(0.5);
    doc.line(marginX, y, pageWidth - marginX, y);
    y += 5;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isA5 ? 9.5 : 11);
  doc.setTextColor(15, 23, 42);
  doc.text(design?.billHeading || 'TAX INVOICE / HOSPITAL BILL', marginX, y);
  doc.setFont('courier', 'bold');
  doc.text(`No: ${order.invoiceNumber}`, pageWidth - marginX, y, { align: 'right' });
  y += 4;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.rect(marginX, y, contentWidth, isA5 ? 18 : 21, 'FD');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isA5 ? 7.2 : 8.5);
  doc.text(`Patient: ${order.patientName} (${order.patientAge} ${order.patientAgeType} / ${order.patientGender})`, marginX + 2.5, y + 4.5);
  doc.text(`Phone: ${order.patientPhone || '—'} · Address: ${order.patientAddress || '—'}`, marginX + 2.5, y + 9);
  doc.text(`Facility: ${sanitizePrintText(settings.labName, 'Diagnostic Lab')} · Ref: ${order.referringDoctor}`, marginX + 2.5, y + 13.5);
  doc.text(`BS Date: ${bs.formattedEn} ${bs.timeEn} · Fiscal Year: ${order.fiscalYear}`, marginX + 2.5, y + 17.5);

  y += isA5 ? 21 : 25;

  doc.setFillColor(241, 245, 249);
  doc.rect(marginX, y, contentWidth, 5.5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(isA5 ? 7.2 : 8.5);
  doc.text('#', marginX + 2, y + 3.8);
  doc.text('Code', marginX + 8, y + 3.8);
  doc.text('Service / Investigation', marginX + contentWidth * 0.18, y + 3.8);
  doc.text('Qty/TAT', marginX + contentWidth * 0.72, y + 3.8);
  doc.text('Amount (NPR)', pageWidth - marginX - 2, y + 3.8, { align: 'right' });
  y += 6.5;

  doc.setFont('helvetica', 'normal');
  const maxContentY = pageHeight - (letterheadMode === 'without' ? bottomOffsetMm : isA5 ? 24 : 28);
  order.tests.forEach((t, idx) => {
    if (y > maxContentY) {
      doc.addPage();
      y = 14;
    }
    const qty = t.quantity && t.quantity > 1 ? t.quantity : 1;
    const label = qty > 1
      ? `${t.serviceName} (×${qty} @ ${t.unitPrice ?? Number((t.price / qty).toFixed(2))})`
      : t.serviceName;
    doc.text(String(idx + 1), marginX + 2, y + 3);
    doc.setFont('courier', 'bold');
    doc.text(t.serviceCode, marginX + 8, y + 3);
    doc.setFont('helvetica', 'normal');
    doc.text(label.slice(0, isA5 ? 36 : 56), marginX + contentWidth * 0.18, y + 3);
    doc.text(`${qty}× · ${t.tatMinutes}m`, marginX + contentWidth * 0.72, y + 3);
    doc.setFont('courier', 'normal');
    doc.text(formatNpr(t.price), pageWidth - marginX - 2, y + 3, { align: 'right' });
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, y + 4.5, pageWidth - marginX, y + 4.5);
    y += 5.5;
  });

  y += 4;
  doc.setFont('courier', 'normal');
  doc.setFontSize(isA5 ? 7.8 : 9);
  doc.text(`Subtotal: ${formatNpr(order.subtotalAmount)}`, pageWidth - marginX, y, { align: 'right' });
  y += 4.5;
  doc.text(`Discount: -${formatNpr(order.discountAmount)}`, pageWidth - marginX, y, { align: 'right' });
  y += 5;
  doc.setFont('courier', 'bold');
  doc.setFontSize(isA5 ? 9 : 10.5);
  doc.text(`Net Total: ${formatNpr(order.totalAmount)}`, pageWidth - marginX, y, { align: 'right' });
  y += 5;
  doc.setFontSize(isA5 ? 7.8 : 9);
  doc.setTextColor(21, 128, 61);
  doc.text(`Paid (${order.paymentMode}): ${formatNpr(order.paidAmount)}`, pageWidth - marginX, y, { align: 'right' });
  y += 4.5;
  doc.setTextColor(190, 18, 60);
  doc.text(`Balance Due: ${formatNpr(order.dueAmount)}`, pageWidth - marginX, y, { align: 'right' });

  y += 8;
  if (cashierSig?.signatureDataUrl) {
    tryAddDataImage(doc, cashierSig.signatureDataUrl, pageWidth - marginX - 28, y, 26, 7);
    y += 8;
  }
  doc.setTextColor(71, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(isA5 ? 6.8 : 8);
  doc.text(
    design?.footerDisclaimerText || `Please present Bill ${order.invoiceNumber} or Accession ${order.accessionNumber} for report collection.`,
    marginX,
    y
  );

  doc.save(`${order.invoiceNumber}-Bill.pdf`);
}

export function downloadFinancialBreakdownPdf(
  title: string,
  subtitle: string,
  sections: Array<{ heading: string; columns: string[]; rows: string[][] }>,
  settings: LabSettings
): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const marginX = 14;
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(29, 78, 216);
  doc.text(getPrintHeaderTitle(settings.labName, null, 'FINANCIAL STATEMENT'), marginX, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text(`${sanitizePrintText(settings.addressLine)} · PAN: ${settings.panNumber}`, marginX, y);
  y += 8;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(title, marginX, y);
  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text(subtitle, marginX, y);
  y += 7;

  for (const sec of sections) {
    if (y > 260) {
      doc.addPage();
      y = 16;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    doc.text(sec.heading, marginX, y);
    y += 4;

    const colWidth = (pageWidth - marginX * 2) / sec.columns.length;
    doc.setFillColor(241, 245, 249);
    doc.rect(marginX, y, pageWidth - marginX * 2, 6, 'F');
    doc.setFontSize(8);
    sec.columns.forEach((c, idx) => {
      doc.text(c, marginX + 2 + idx * colWidth, y + 4.2);
    });
    y += 7;

    doc.setFont('courier', 'normal');
    for (const row of sec.rows) {
      if (y > 276) {
        doc.addPage();
        y = 16;
      }
      row.forEach((cell, idx) => {
        doc.text(String(cell).slice(0, 26), marginX + 2 + idx * colWidth, y + 3.5);
      });
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, y + 5, pageWidth - marginX, y + 5);
      y += 6;
    }
    y += 6;
  }

  doc.save(`Hospital-Financial-Statement-${new Date().toISOString().slice(0, 10)}.pdf`);
}
