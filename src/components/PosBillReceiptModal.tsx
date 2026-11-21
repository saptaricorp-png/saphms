import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Printer, X } from 'lucide-react';
import type {
  CollectionCenter,
  DocumentDesignTemplate,
  LabOrder,
  LabSettings,
} from '../types/lims';
import { adToBs, formatNpr, toNepaliDigits } from '../utils/nepaliDate';
import { downloadPosBillPdf } from '../utils/pdfGenerator';
import { BarcodeSvg, QrCodeSvg } from './DocumentCodes';
import { getPrintHeaderTitle, sanitizePrintText } from '../utils/printSanitizer';
import { executeSmartPrint } from '../utils/printHelper';

interface PosBillReceiptModalProps {
  order: LabOrder;
  settings: LabSettings;
  documentDesigns?: DocumentDesignTemplate[];
  centers?: CollectionCenter[];
  autoPrint?: boolean;
  onClose: () => void;
}

export function PosBillReceiptModal({
  order,
  settings,
  documentDesigns = [],
  autoPrint,
  onClose,
}: PosBillReceiptModalProps) {
  const printOpts = settings.moduleSettings?.printOptions;
  const defaultDesign = useMemo(() => {
    const preferredId = printOpts?.selectedBillDesignId;
    return (
      (preferredId && documentDesigns.find((d) => d.id === preferredId)) ||
      documentDesigns.find((d) => d.targetScope === 'BILL' && d.paperFormat === 'A5') ||
      documentDesigns.find((d) => d.id === 'dsn-main') ||
      documentDesigns[0]
    );
  }, [documentDesigns, printOpts?.selectedBillDesignId]);

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
    autoPrint ?? (printOpts?.autoPrintByTemplate?.posBill === 'AUTO_PRINT');

  const isA5 = paperSize === 'A5';
  const isThermal = paperSize === 'THERMAL_80MM';
  const pageClass = isThermal ? 'thermal-80-page' : isA5 ? 'a5-page' : 'a4-page';
  const pageCssSize = isThermal ? '80mm auto' : isA5 ? 'A5 portrait' : 'A4 portrait';
  const paperWidthStyle = isThermal ? '78mm' : isA5 ? '148mm' : '210mm';

  const triggerSmartPrint = () => {
    executeSmartPrint({
      element: printableRef.current,
      pageCssSize,
      documentTitle: `${order.invoiceNumber} - ${order.patientName}`,
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

  const bs = adToBs(order.orderedAt);
  const adStr = new Date(order.orderedAt).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  const safeHeaderTitle = getPrintHeaderTitle(settings.labName, activeDesign?.headerTitle, 'HOSPITAL & DIAGNOSTIC TAX INVOICE');
  const safeHeaderTitleNp = sanitizePrintText(settings.labNameNp || activeDesign?.headerTitleNp);
  const safeSubTitle = sanitizePrintText(activeDesign?.subTitle || settings.accreditationLine);
  const safeAddress = sanitizePrintText(settings.addressLine || activeDesign?.addressText);
  const safeContact = sanitizePrintText(settings.contactLine || activeDesign?.phoneText);

  const qrValue = useMemo(() => {
    const pan = activeDesign?.panNumber || settings.panNumber;
    const mode = activeDesign?.qrPayloadMode || 'PATIENT_BILL';
    if (mode === 'ACCESSION_PAN') {
      return `ACC:${order.accessionNumber}|PAN:${pan}|STATUS:${order.status}`;
    }
    if (mode === 'VERIFY_URL') {
      return `${window.location.origin}/?verify=${encodeURIComponent(order.accessionNumber)}&inv=${encodeURIComponent(order.invoiceNumber)}&pan=${encodeURIComponent(pan)}`;
    }
    return `INV:${order.invoiceNumber}|ACC:${order.accessionNumber}|PT:${order.patientName}|NPR:${order.totalAmount}|BS:${bs.formattedEn}|PAN:${pan}`;
  }, [activeDesign, settings.panNumber, order, bs.formattedEn]);

  const barcodeValue =
    activeDesign?.barcodeSource === 'ACCESSION' ? order.accessionNumber : order.invoiceNumber;
  const accentColor = activeDesign?.accentColor || '#1d4ed8';
  const showQr = activeDesign ? activeDesign.showQrCode : true;
  const showBarcode = activeDesign ? activeDesign.showBarcode : true;

  const cashierSig = (settings.moduleSettings?.signatureBoxes || []).find(
    (s) => s.roleKey === 'HOSPITAL_CASHIER'
  );

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      await downloadPosBillPdf(
        order,
        settings,
        activeDesign ? { ...activeDesign, paperFormat: paperSize } : undefined,
        letterheadMode,
        topOffsetMm,
        bottomOffsetMm
      );
    } finally {
      setDownloadingPdf(false);
    }
  };

  const printableBillNode = (
    <div
      ref={printableRef}
      className={`${pageClass} bg-white text-slate-900 shadow-2xl ${isThermal ? 'p-3 text-[10px]' : isA5 ? 'p-4 text-[10.5px]' : 'p-7 text-xs'} box-border relative overflow-hidden flex flex-col justify-between`}
      style={{
        width: paperWidthStyle,
        minHeight: isThermal ? '120mm' : isA5 ? '210mm' : '297mm',
        ...(letterheadMode === 'without'
          ? {
              paddingTop: `${topOffsetMm}mm`,
              paddingBottom: `${bottomOffsetMm}mm`,
            }
          : {}),
      }}
    >
      {activeDesign?.showWatermark && activeDesign.watermarkText && (
        <div
          aria-hidden="true"
          className="pointer-events-none select-none absolute inset-0 flex items-center justify-center opacity-[0.06] font-extrabold text-4xl tracking-widest uppercase -rotate-24 text-slate-900"
        >
          {activeDesign.watermarkText}
        </div>
      )}

      <div className="relative z-10">
        {letterheadMode === 'with' ? (
          <>
            {/* Bilingual Header */}
            <div
              className="border-b-2 pb-2 mb-3 flex items-start justify-between gap-3"
              style={{ borderColor: accentColor }}
            >
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {settings.moduleSettings?.hospitalLogoDataUrl && !isThermal && (
                  <img
                    src={settings.moduleSettings.hospitalLogoDataUrl}
                    alt={safeHeaderTitle}
                    className="w-10 h-10 object-contain shrink-0 rounded border border-slate-200 p-0.5 bg-white"
                  />
                )}
                <div className="min-w-0 flex-1">
                  {safeHeaderTitleNp && (
                    <div className="text-[11px] font-bold text-slate-800">
                      {safeHeaderTitleNp}
                    </div>
                  )}
                  <h1 className={`${isA5 || isThermal ? 'text-sm' : 'text-lg'} font-bold leading-tight`} style={{ color: accentColor }}>
                    {safeHeaderTitle}
                  </h1>
                  {safeSubTitle && !isThermal && (
                    <div className="text-[10px] font-medium text-slate-700">{safeSubTitle}</div>
                  )}
                  <div className="text-[10px] text-slate-600 mt-0.5">
                    {safeAddress}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {safeContact}
                  </div>
                  {activeDesign?.showPan !== false && (
                    <div className="text-[10px] font-mono text-slate-700 mt-0.5">
                      PAN: {activeDesign?.panNumber || settings.panNumber}
                      {activeDesign?.licenseNumber ? ` · Reg: ${activeDesign.licenseNumber}` : ''}
                    </div>
                  )}
                </div>
              </div>

              {!isThermal && (
                <div className="flex items-start gap-2 shrink-0">
                  <div className="text-right">
                    <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-900">
                      {activeDesign?.billHeading || 'अस्पताल बिल / TAX INVOICE'}
                    </div>
                    <div className="text-xs font-mono font-bold mt-0.5" style={{ color: accentColor }}>
                      {order.invoiceNumber}
                    </div>
                    <div className="text-[10px] font-mono text-slate-700">
                      Acc: {order.accessionNumber}
                    </div>
                    <div className="text-[9.5px] font-mono text-slate-600 mb-1">
                      आ.व. / {order.fiscalYear}
                    </div>
                    {showBarcode && <BarcodeSvg value={barcodeValue} width={isA5 ? 90 : 118} height={isA5 ? 18 : 24} />}
                  </div>
                  {showQr && <QrCodeSvg value={qrValue} size={isA5 ? 44 : 60} />}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="border-b border-slate-300 pb-1.5 mb-2.5 flex items-center justify-between gap-2 text-[10px] font-mono">
            <div>
              <span className="font-bold text-slate-900">{activeDesign?.billHeading || 'TAX INVOICE'}</span>
              <span className="ml-2 font-bold" style={{ color: accentColor }}>{order.invoiceNumber}</span>
              <span className="ml-2 text-slate-600">Acc: {order.accessionNumber}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-600">FY {order.fiscalYear}</span>
              {!isThermal && showQr && <QrCodeSvg value={qrValue} size={32} />}
            </div>
          </div>
        )}

        {/* Patient & BS Timestamp */}
        <div className="grid grid-cols-2 gap-3 border border-slate-300 rounded-md p-2.5 mb-3 bg-slate-50/50">
          <div className="space-y-0.5">
            <div>
              <span className="text-slate-500">बिरामी / Patient: </span>
              <strong className="text-slate-900">{order.patientName}</strong>
            </div>
            <div>
              <span className="text-slate-500">Age/Sex: </span>
              <strong className="font-mono text-slate-900">
                {order.patientAge} {order.patientAgeType} / {order.patientGender}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Addr: </span>
              <span className="text-slate-900">{order.patientAddress || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">Phone: </span>
              <span className="font-mono text-slate-900">{order.patientPhone || '—'}</span>
            </div>
          </div>

          <div className="space-y-0.5 text-right">
            {activeDesign?.showNepaliDate !== false && (
              <>
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
              </>
            )}
            <div>
              <span className="text-slate-500">AD: </span>
              <span className="font-mono text-slate-800">{adStr}</span>
            </div>
            {order.uhid && (
              <div>
                <span className="text-slate-500">UHID: </span>
                <strong className="font-mono text-slate-900">
                  {order.uhid} {order.encounterLabel ? `· ${order.encounterLabel}` : ''}
                </strong>
              </div>
            )}
          </div>
        </div>

        <div className="text-[10px] text-slate-600 mb-2 flex items-center justify-between">
          {activeDesign?.showDoctorRef !== false ? (
            <span>
              <strong>सिफारिस / Ref By:</strong> {order.referringDoctor}
            </span>
          ) : (
            <span />
          )}
          <span className="font-mono">
            Priority: <strong>{order.priority}</strong> · Mode: <strong>{order.paymentMode}</strong>
          </span>
        </div>

        {/* Itemized Bill Table */}
        <table className="w-full text-left border-collapse mb-3">
          <thead>
            <tr className="border-y border-slate-800 bg-slate-100 text-slate-900">
              <th className="py-1.5 px-1.5">#</th>
              <th className="py-1.5 px-1.5">Code</th>
              <th className="py-1.5 px-1.5">सेवा विवरण / Particular</th>
              {!isThermal && <th className="py-1.5 px-1.5">TAT</th>}
              <th className="py-1.5 px-1.5 text-right">Amount (रू)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {order.tests.map((t, idx) => (
              <tr key={`${t.serviceId}-${idx}`}>
                <td className="py-1.5 px-1.5 font-mono">
                  {toNepaliDigits(idx + 1)}/{idx + 1}
                </td>
                <td className="py-1.5 px-1.5 font-mono font-semibold">{t.serviceCode}</td>
                <td className="py-1.5 px-1.5">
                  {t.serviceName}
                  {t.quantity && t.quantity > 1 && (
                    <span className="ml-1 text-[9.5px] font-mono font-semibold text-blue-700">
                      × {t.quantity} (@ {formatNpr(t.unitPrice ?? Number((t.price / t.quantity).toFixed(2)), true)})
                    </span>
                  )}
                  {t.modality && (
                    <span className="ml-1 text-[9px] font-mono text-slate-500">[{t.modality}]</span>
                  )}
                </td>
                {!isThermal && (
                  <td className="py-1.5 px-1.5 font-mono text-slate-600">{t.tatMinutes}m</td>
                )}
                <td className="py-1.5 px-1.5 text-right font-mono tabular-nums font-medium">
                  {formatNpr(t.price, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals Summary */}
        <div className="flex justify-between items-end pt-2 border-t border-slate-300 gap-4">
          <div className="text-[10px] text-slate-600 space-y-1 max-w-xs">
            <div>
              <strong>नोट:</strong> कृपया रिपोर्ट सङ्कलन गर्दा यो रसिद लिएर आउनुहोला।
            </div>
            <div>
              {activeDesign?.footerDisclaimerText ||
                `Present Bill ${order.invoiceNumber} or Acc ${order.accessionNumber} for report collection.`}
            </div>
          </div>

          <div className="w-52 space-y-0.5 font-mono tabular-nums">
            <div className="flex justify-between text-slate-600">
              <span>जम्मा / Subtotal:</span>
              <span>{formatNpr(order.subtotalAmount, true)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>छुट / Discount:</span>
              <span>-{formatNpr(order.discountAmount, true)}</span>
            </div>
            <div className="flex justify-between text-xs font-bold text-slate-900 border-t border-slate-800 pt-1">
              <span>कुल / Net Total:</span>
              <span>{formatNpr(order.totalAmount, true)}</span>
            </div>
            <div className="flex justify-between text-emerald-700">
              <span>Paid ({order.paymentMode}):</span>
              <span>{formatNpr(order.paidAmount, true)}</span>
            </div>
            <div className="flex justify-between text-rose-700 font-semibold">
              <span>Due:</span>
              <span>{formatNpr(order.dueAmount, true)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Cashier Signature Footer */}
      <div className="relative z-10 pt-3 mt-4 border-t border-slate-200 flex items-end justify-between text-[9.5px] text-slate-500">
        <div>
          {safeAddress}
        </div>
        <div className="text-right">
          {cashierSig?.signatureDataUrl && (
            <img
              src={cashierSig.signatureDataUrl}
              alt={cashierSig.label}
              className="h-8 max-w-[110px] object-contain ml-auto mb-0.5"
            />
          )}
          <div className="font-semibold text-slate-800">
            {cashierSig?.signerName || 'Billing Cashier Signature'}
          </div>
          <div className="text-[9px] text-slate-500">
            {cashierSig?.designation || 'Hospital Billing Counter'}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="no-print fixed inset-0 z-50 bg-slate-950/70 flex flex-col overflow-hidden">
        <div className="bg-slate-900 text-white px-6 py-3 flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-sm font-semibold">POS Diagnostic Invoice / रसिद ({paperSize})</div>
              <div className="text-xs text-slate-400 font-mono">
                {order.invoiceNumber} · {bs.formattedEn} · {order.fiscalYear}
              </div>
            </div>
            {documentDesigns.length > 0 && (
              <select
                value={activeDesign?.id || ''}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedDesignId(id);
                  const found = documentDesigns.find((d) => d.id === id);
                  if (found?.paperFormat) setPaperSize(found.paperFormat);
                }}
                className="px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white"
              >
                {documentDesigns.map((d) => (
                  <option key={d.id} value={d.id}>
                    Design: {d.name} ({d.paperFormat})
                  </option>
                ))}
              </select>
            )}
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value as 'A5' | 'A4' | 'THERMAL_80MM')}
              className="px-2.5 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-lg text-white font-mono"
            >
              <option value="A5">A5 Portrait Full</option>
              <option value="A4">A4 Portrait</option>
              <option value="THERMAL_80MM">80mm Thermal</option>
            </select>
            <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setLetterheadMode('with')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                  letterheadMode === 'with' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                With Letterhead
              </button>
              <button
                type="button"
                onClick={() => setLetterheadMode('without')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap ${
                  letterheadMode === 'without' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
                }`}
              >
                Without Letterhead
              </button>
            </div>
            {letterheadMode === 'without' && (
              <div className="flex items-center gap-1.5 text-xs text-slate-300">
                <label className="flex items-center gap-1">
                  Top:
                  <input
                    type="number"
                    min={8}
                    max={70}
                    value={topOffsetMm}
                    onChange={(e) => setTopOffsetMm(Number(e.target.value) || 38)}
                    className="w-12 px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-white font-mono text-xs"
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
                    className="w-12 px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-white font-mono text-xs"
                  />
                </label>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={downloadingPdf}
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5" />
              {downloadingPdf ? 'Generating...' : 'Download Bill PDF'}
            </button>
            <button
              type="button"
              onClick={triggerSmartPrint}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg whitespace-nowrap"
            >
              <Printer className="w-3.5 h-3.5" />
              Print {paperSize} Bill
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex justify-center bg-slate-800/80">
          {printableBillNode}
        </div>
      </div>
    </>
  );
}
