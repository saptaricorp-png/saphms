import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import type {
  CollectionCenter,
  DocumentDesignTemplate,
  LabSettings,
  PharmacyDispenseInvoice,
} from '../types/lims';
import { adToBs, formatNpr, toNepaliDigits } from '../utils/nepaliDate';
import { generateQrDataUrl } from '../utils/codes';
import { BarcodeSvg, QrCodeSvg } from './DocumentCodes';
import { getPrintHeaderTitle, sanitizePrintText } from '../utils/printSanitizer';
import { executeSmartPrint } from '../utils/printHelper';

interface PharmacyInvoiceModalProps {
  invoice: PharmacyDispenseInvoice;
  settings: LabSettings;
  documentDesigns?: DocumentDesignTemplate[];
  centers?: CollectionCenter[];
  autoPrint?: boolean;
  onClose: () => void;
}

export function PharmacyInvoiceModal({
  invoice,
  settings,
  documentDesigns = [],
  autoPrint,
  onClose,
}: PharmacyInvoiceModalProps) {
  const printOpts = settings.moduleSettings?.printOptions;
  const defaultDesign = useMemo(() => {
    const preferredId = printOpts?.selectedPharmacyDesignId;
    return (
      (preferredId && documentDesigns.find((d) => d.id === preferredId)) ||
      documentDesigns.find((d) => d.targetScope === 'PHARMACY') ||
      documentDesigns.find((d) => d.id === 'dsn-main') ||
      documentDesigns[0]
    );
  }, [documentDesigns, printOpts?.selectedPharmacyDesignId]);

  const [selectedDesignId, setSelectedDesignId] = useState<string>(defaultDesign?.id || '');
  const activeDesign = useMemo(
    () => documentDesigns.find((d) => d.id === selectedDesignId) || defaultDesign,
    [documentDesigns, selectedDesignId, defaultDesign]
  );

  const [paperSize, setPaperSize] = useState<'A5' | 'A4' | 'THERMAL_80MM'>(
    activeDesign?.paperFormat || printOpts?.defaultPaperSize || 'A5'
  );
  const [letterheadMode, setLetterheadMode] = useState<'with' | 'without'>(
    printOpts?.defaultLetterheadMode === 'without-letterhead' ? 'without' : 'with'
  );
  const [topOffsetMm, setTopOffsetMm] = useState<number>(settings.prePrintedTopMarginMm || 38);
  const [bottomOffsetMm, setBottomOffsetMm] = useState<number>(
    settings.prePrintedBottomMarginMm || 22
  );
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const autoPrintedRef = useRef(false);
  const printableRef = useRef<HTMLDivElement | null>(null);

  const shouldAutoPrint =
    autoPrint ?? (printOpts?.autoPrintByTemplate?.pharmacyBill === 'AUTO_PRINT');

  const isA5 = paperSize === 'A5';
  const isThermal = paperSize === 'THERMAL_80MM';
  const pageClass = isThermal ? 'thermal-80-page' : isA5 ? 'a5-page' : 'a4-page';
  const pageCssSize = isThermal ? '80mm auto' : isA5 ? 'A5 portrait' : 'A4 portrait';

  const triggerSmartPrint = () => {
    executeSmartPrint({
      element: printableRef.current,
      pageCssSize,
      documentTitle: `${invoice.invoiceNumber} - ${invoice.patientName}`,
    });
  };

  useEffect(() => {
    if (!shouldAutoPrint || autoPrintedRef.current) return;
    const t = window.setTimeout(() => {
      if (!autoPrintedRef.current) {
        autoPrintedRef.current = true;
        triggerSmartPrint();
      }
    }, 220);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoPrint]);

  const bs = adToBs(invoice.dispensedAt);
  const adStr = new Date(invoice.dispensedAt).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const qrValue = `PHARM:${invoice.invoiceNumber}|PT:${invoice.patientName}|NPR:${invoice.totalNpr}|BS:${bs.formattedEn}|PAN:${settings.moduleSettings?.pharmacyPanNumber || settings.panNumber}|FEFO:${invoice.lines.map((l) => `${l.batchNumber}(${l.expiryDate})`).join(',')}`;
  const accentColor = activeDesign?.accentColor || '#0f766e';
  const showBatchExpiry = settings.moduleSettings?.showBatchExpiryOnPharmacyBill !== false;
  const pharmacyLogo =
    settings.moduleSettings?.pharmacyLogoDataUrl || settings.moduleSettings?.hospitalLogoDataUrl;
  const phmSig = (settings.moduleSettings?.signatureBoxes || []).find(
    (s) => s.roleKey === 'PHARMACY_CASHIER'
  );

  const safePhmName = getPrintHeaderTitle(
    settings.moduleSettings?.pharmacyEntityName,
    settings.labName,
    'PHARMACY STORE'
  );
  const safePhmNameNp = sanitizePrintText(
    settings.moduleSettings?.pharmacyEntityNameNp ||
      (settings.labNameNp ? `${settings.labNameNp} · फार्मेसी एकाइ` : ''),
    ''
  );
  const safePhmAddr = sanitizePrintText(settings.moduleSettings?.pharmacyAddress || settings.addressLine);
  const safePhmContact = sanitizePrintText(settings.moduleSettings?.pharmacyPhone || settings.contactLine);

  const depositApplied = Number(invoice.depositAppliedNpr || 0);
  const paidAmount = Number(
    invoice.paidAmountNpr !== undefined
      ? invoice.paidAmountNpr
      : (invoice.cashPaid || 0) + (invoice.bankPaid || 0)
  );
  const dueAmount = Number(invoice.dueAmountNpr || 0);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: isA5 ? 'a5' : 'a4' });
      const pageWidth = isA5 ? 148 : 210;
      const marginX = isA5 ? 8 : 14;
      const qrData = await generateQrDataUrl(qrValue, 120);
      const phmName = safePhmName;
      const phmPan = settings.moduleSettings?.pharmacyPanNumber || settings.panNumber;
      const phmDda = settings.moduleSettings?.pharmacyDdaLicense || 'DDA-SAP-082/83';
      const phmAddr = safePhmAddr;
      let y = letterheadMode === 'with' ? 14 : Math.max(14, topOffsetMm);
      if (letterheadMode === 'with') {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isA5 ? 11 : 13);
        doc.text(phmName, marginX, y);
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(isA5 ? 7 : 8.5);
        doc.text(`${phmAddr} · PAN: ${phmPan} · DDA: ${phmDda}`, marginX, y);
        y += 5;
        if (qrData) doc.addImage(qrData, 'PNG', pageWidth - marginX - 16, 10, 16, 16);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(isA5 ? 7 : 8.5);
        if (qrData) doc.addImage(qrData, 'PNG', pageWidth - marginX - 14, Math.max(8, y - 4), 13, 13);
      }
      doc.text(`Pharmacy Invoice: ${invoice.invoiceNumber}${invoice.nonInventoryBillOnly ? ' [BILL-ONLY]' : ''}`, marginX, y);
      y += 4.5;
      doc.text(`BS Date: ${bs.formattedEn} (${bs.timeEn}) · FY: ${invoice.fiscalYear}`, marginX, y);
      y += 4.5;
      doc.text(`Patient: ${invoice.patientName} (${invoice.patientPhone || 'N/A'}) · Prescriber: ${invoice.prescribingDoctor}`, marginX, y);
      y += 8;
      doc.setFont('helvetica', 'bold');
      doc.text('#  Medicine', marginX, y);
      doc.text('Batch', isA5 ? 64 : 92, y);
      doc.text('Exp', isA5 ? 86 : 124, y);
      doc.text('Qty', isA5 ? 106 : 152, y, { align: 'right' });
      doc.text('MRP', isA5 ? 122 : 170, y, { align: 'right' });
      doc.text('Total', pageWidth - marginX, y, { align: 'right' });
      doc.line(marginX, y + 2, pageWidth - marginX, y + 2);
      y += 6;

      doc.setFont('helvetica', 'normal');
      invoice.lines.forEach((line, idx) => {
        doc.text(`${idx + 1}. ${line.medicineName}`.slice(0, isA5 ? 26 : 40), marginX, y);
        doc.text(line.batchNumber, isA5 ? 64 : 92, y);
        doc.text(line.expiryDate, isA5 ? 86 : 124, y);
        doc.text(String(line.quantity), isA5 ? 106 : 152, y, { align: 'right' });
        doc.text(line.unitPriceNpr.toFixed(2), isA5 ? 122 : 170, y, { align: 'right' });
        doc.text(line.lineTotalNpr.toFixed(2), pageWidth - marginX, y, { align: 'right' });
        y += 5.2;
      });

      doc.line(marginX, y, pageWidth - marginX, y);
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.text(`Subtotal: NPR ${invoice.subtotalNpr.toFixed(2)} | Disc: ${invoice.discountNpr.toFixed(2)} | VAT: ${invoice.vatNpr.toFixed(2)}`, marginX, y);
      y += 5.5;
      doc.setFontSize(isA5 ? 9.5 : 11);
      doc.text(`Net Payable: NPR ${invoice.totalNpr.toFixed(2)} (${invoice.paymentMode})`, marginX, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(isA5 ? 7.5 : 8.5);
      doc.text(
        `Paid: NPR ${paidAmount.toFixed(2)} | Deposit Applied: NPR ${depositApplied.toFixed(2)} | Balance Due: NPR ${dueAmount.toFixed(2)}`,
        marginX,
        y
      );
      doc.setFontSize(7.5);
      doc.text(`Billed By: ${invoice.dispensedBy} · Pharmacy POS Billing`, marginX, y + 6);
      doc.save(`${invoice.invoiceNumber}.pdf`);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const printableInvoice = (
    <div
      ref={printableRef}
      className={`${pageClass} bg-white text-slate-900 shadow-2xl ${isThermal ? 'p-3 text-[10px]' : isA5 ? 'p-4 text-[10px]' : 'p-7 text-xs'} box-border relative overflow-hidden flex flex-col justify-between`}
      style={{
        width: isThermal ? '78mm' : isA5 ? '148mm' : '210mm',
        minHeight: isThermal ? '120mm' : isA5 ? '210mm' : '297mm',
        ...(letterheadMode === 'without'
          ? {
              paddingTop: `${topOffsetMm}mm`,
              paddingBottom: `${bottomOffsetMm}mm`,
            }
          : {}),
      }}
    >
      <div>
        {letterheadMode === 'with' ? (
          <div className="border-b-2 pb-2.5 mb-3 flex items-start justify-between gap-3" style={{ borderColor: accentColor }}>
            <div className="flex items-start gap-2 min-w-0 flex-1">
              {pharmacyLogo && !isThermal && (
                <img
                  src={pharmacyLogo}
                  alt="Pharmacy Logo"
                  className="w-10 h-10 object-contain shrink-0 rounded border border-slate-200 p-0.5 bg-white"
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-slate-600">
                  {safePhmNameNp}
                </div>
                <h1 className={`${isA5 || isThermal ? 'text-sm' : 'text-lg'} font-bold leading-tight`} style={{ color: accentColor }}>
                  {safePhmName}
                </h1>
                <div className="text-[10px] text-slate-600 mt-0.5">
                  {safePhmAddr} · {safePhmContact}
                </div>
                <div className="text-[10px] font-mono text-slate-700 mt-0.5">
                  PAN: {settings.moduleSettings?.pharmacyPanNumber || settings.panNumber} · DDA: {settings.moduleSettings?.pharmacyDdaLicense || 'DDA-SAP-082/83'}
                </div>
              </div>
            </div>
            {!isThermal && (
              <div className="flex items-start gap-2 shrink-0">
                <div className="text-right">
                  <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-900">
                    फार्मेसी बीजक / PHARMACY BILL
                  </div>
                  <div className="text-xs font-mono font-bold mt-0.5" style={{ color: accentColor }}>
                    {invoice.invoiceNumber}
                  </div>
                  <div className="text-[9.5px] font-mono text-slate-600 mb-1">
                    आ.व. / {invoice.fiscalYear}
                  </div>
                  <BarcodeSvg value={invoice.invoiceNumber} width={isA5 ? 88 : 118} height={isA5 ? 18 : 24} />
                </div>
                <QrCodeSvg value={qrValue} size={isA5 ? 44 : 60} />
              </div>
            )}
          </div>
        ) : (
          <div className="border-b border-slate-300 pb-1.5 mb-2.5 flex items-center justify-between gap-2 text-[10px] font-mono">
            <div>
              <span className="font-bold text-slate-900">PHARMACY BILL</span>
              <span className="ml-2 font-bold" style={{ color: accentColor }}>{invoice.invoiceNumber}</span>
              <span className="ml-2 text-slate-600">FY {invoice.fiscalYear}</span>
            </div>
            {!isThermal && <QrCodeSvg value={qrValue} size={32} />}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-md p-2.5 mb-3 bg-slate-50/50">
          <div className="space-y-0.5">
            <div>
              <span className="text-slate-500">Patient: </span>
              <strong className="text-slate-900">{invoice.patientName}</strong>
              {invoice.patientAge ? ` (${invoice.patientAge}Y)` : ''}
            </div>
            {(invoice.uhid || invoice.encounterLabel) && (
              <div>
                <span className="text-slate-500">UHID: </span>
                <span className="font-mono font-semibold text-slate-900">
                  {invoice.uhid || ''} {invoice.encounterLabel ? `· ${invoice.encounterLabel}` : ''}
                </span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Phone: </span>
              <span className="font-mono text-slate-900">{invoice.patientPhone || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">Prescriber: </span>
              <span className="text-slate-900">{invoice.prescribingDoctor}</span>
            </div>
          </div>

          <div className="space-y-0.5 text-right">
            <div>
              <span className="text-slate-500">नेपाली मिति: </span>
              <strong className="text-slate-900">
                {bs.formattedNp} · {bs.timeNp}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">BS Date: </span>
              <strong className="font-mono text-slate-900">
                {bs.formattedEn} · {bs.timeEn}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">AD: </span>
              <span className="font-mono text-slate-800">{adStr}</span>
            </div>
            <div>
              <span className="text-slate-500">Mode: </span>
              <strong className="font-mono text-slate-900">{invoice.paymentMode}</strong>
            </div>
          </div>
        </div>

        <table className="w-full text-left border-collapse mb-3">
          <thead>
            <tr className="border-y border-slate-800 bg-slate-100 text-slate-900">
              <th className="py-1.5 px-1.5">#</th>
              <th className="py-1.5 px-1.5">Medicine (Generic)</th>
              {showBatchExpiry && !isThermal && <th className="py-1.5 px-1.5">Batch</th>}
              {showBatchExpiry && !isThermal && <th className="py-1.5 px-1.5">Expiry</th>}
              <th className="py-1.5 px-1.5 text-right">Qty</th>
              <th className="py-1.5 px-1.5 text-right">MRP</th>
              <th className="py-1.5 px-1.5 text-right">Total (रू)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {invoice.lines.map((line, idx) => (
              <tr key={`${line.batchId}-${idx}`}>
                <td className="py-1.5 px-1.5 font-mono">{toNepaliDigits(idx + 1)}/{idx + 1}</td>
                <td className="py-1.5 px-1.5">
                  <div className="font-medium text-slate-900">{line.medicineName}</div>
                  <div className="text-[9px] text-slate-500">{line.genericName}</div>
                </td>
                {showBatchExpiry && !isThermal && <td className="py-1.5 px-1.5 font-mono font-semibold">{line.batchNumber}</td>}
                {showBatchExpiry && !isThermal && <td className="py-1.5 px-1.5 font-mono">{line.expiryDate}</td>}
                <td className="py-1.5 px-1.5 text-right font-mono">{line.quantity}</td>
                <td className="py-1.5 px-1.5 text-right font-mono">{formatNpr(line.unitPriceNpr)}</td>
                <td className="py-1.5 px-1.5 text-right font-mono font-semibold">{formatNpr(line.lineTotalNpr)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-between items-start gap-4 border-t border-slate-300 pt-2.5">
          <div className="text-slate-600 space-y-1 text-[10px]">
            <div>
              Cash: <strong className="font-mono">{formatNpr(invoice.cashPaid)}</strong> · Bank/QR:{' '}
              <strong className="font-mono">{formatNpr(invoice.bankPaid)}</strong>
            </div>
            <div className="text-slate-500">
              {invoice.nonInventoryBillOnly
                ? 'Bill-Only Invoice (no batch deduction).'
                : 'Pharmacy POS verified. Check batch expiry before use.'}
            </div>
            <div className="font-medium text-slate-700 pt-0.5">
              Billed By: {invoice.dispensedBy}
            </div>
          </div>
          <div className="w-52 space-y-0.5 font-mono tabular-nums text-right">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal:</span>
              <span>{formatNpr(invoice.subtotalNpr)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Discount:</span>
              <span>-{formatNpr(invoice.discountNpr)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">VAT (13%):</span>
              <span>{formatNpr(invoice.vatNpr)}</span>
            </div>
            <div className="flex justify-between text-xs font-bold border-t border-slate-800 pt-1">
              <span>Net Total:</span>
              <span>{formatNpr(invoice.totalNpr)}</span>
            </div>
            {depositApplied > 0 && (
              <div className="flex justify-between text-blue-700">
                <span>Advance Deposit:</span>
                <span>-{formatNpr(depositApplied)}</span>
              </div>
            )}
            <div className="flex justify-between text-emerald-700">
              <span>Paid ({invoice.paymentMode}):</span>
              <span>{formatNpr(paidAmount)}</span>
            </div>
            {dueAmount > 0 && (
              <div className="flex justify-between text-rose-700 font-bold border-t border-rose-200 pt-0.5">
                <span>Credit Due Balance:</span>
                <span>{formatNpr(dueAmount)}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pharmacy Signature Footer */}
      <div className="pt-3 mt-4 border-t border-slate-200 flex items-end justify-between text-[9.5px] text-slate-500">
        <div>
          {safePhmName}
        </div>
        <div className="text-right">
          {phmSig?.signatureDataUrl && (
            <img
              src={phmSig.signatureDataUrl}
              alt={phmSig.label}
              className="h-8 max-w-[110px] object-contain ml-auto mb-0.5"
            />
          )}
          <div className="font-semibold text-slate-800">
            {phmSig?.signerName || invoice.dispensedBy}
          </div>
          <div className="text-[9px] text-slate-500">
            {phmSig?.designation || 'Pharmacist / Pharmacy Cashier'}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="no-print fixed inset-0 z-50 bg-slate-950/60 flex flex-col items-center overflow-y-auto py-6 px-4">
        <div className="w-full max-w-[210mm] bg-white border border-slate-200 rounded-xl px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-700">
              Pharmacy Bill <span className="font-mono font-bold text-slate-900">{invoice.invoiceNumber}</span>
            </span>
            {documentDesigns.length > 0 && (
              <select
                value={activeDesign?.id || ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedDesignId(id);
                  const found = documentDesigns.find((d) => d.id === id);
                  if (found?.paperFormat) setPaperSize(found.paperFormat);
                }}
                className="px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-800"
              >
                {documentDesigns.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.paperFormat})
                  </option>
                ))}
              </select>
            )}
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as 'A5' | 'A4' | 'THERMAL_80MM')}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white font-mono text-slate-800"
            >
              <option value="A5">A5 Portrait Full</option>
              <option value="A4">A4 Portrait</option>
              <option value="THERMAL_80MM">80mm Thermal</option>
            </select>
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setLetterheadMode('with')}
                className={`px-2.5 py-1 font-medium whitespace-nowrap ${
                  letterheadMode === 'with' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
                }`}
              >
                With Letterhead
              </button>
              <button
                type="button"
                onClick={() => setLetterheadMode('without')}
                className={`px-2.5 py-1 font-medium whitespace-nowrap ${
                  letterheadMode === 'without' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
                }`}
              >
                Without Letterhead
              </button>
            </div>
            {letterheadMode === 'without' && (
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <label className="flex items-center gap-1">
                  Top:
                  <input
                    type="number"
                    min={8}
                    max={70}
                    value={topOffsetMm}
                    onChange={(e) => setTopOffsetMm(Number(e.target.value) || 38)}
                    className="w-12 px-1.5 py-0.5 border border-slate-300 rounded font-mono text-xs text-slate-900"
                  />
                </label>
                <label className="flex items-center gap-1">
                  Bot:
                  <input
                    type="number"
                    min={8}
                    max={50}
                    value={bottomOffsetMm}
                    onChange={(e) => setBottomOffsetMm(Number(e.target.value) || 22)}
                    className="w-12 px-1.5 py-0.5 border border-slate-300 rounded font-mono text-xs text-slate-900"
                  />
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Generating PDF...' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={triggerSmartPrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print {paperSize} Bill
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg border border-slate-200"
              aria-label="Close invoice"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        {printableInvoice}
      </div>
    </>
  );
}
