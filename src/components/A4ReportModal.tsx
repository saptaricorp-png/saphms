import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Mail, Printer, Send, X } from 'lucide-react';
import type {
  CollectionCenter,
  DocumentDesignTemplate,
  LabOrder,
  LabSettings,
  StaffMember,
} from '../types/lims';
import { computeOrderTat } from '../utils/clinical';
import { adToBs } from '../utils/nepaliDate';
import { downloadOrderReportPdf } from '../utils/pdfGenerator';
import { BarcodeSvg, QrCodeSvg } from './DocumentCodes';
import { apiRequest } from '../api/client';
import { getPrintHeaderTitle, sanitizePrintText } from '../utils/printSanitizer';
import { executeSmartPrint } from '../utils/printHelper';

interface A4ReportModalProps {
  order: LabOrder;
  settings: LabSettings;
  documentDesigns?: DocumentDesignTemplate[];
  centers?: CollectionCenter[];
  activeUser: StaffMember;
  canPrint: boolean;
  canEmail: boolean;
  canApiSend: boolean;
  autoPrint?: boolean;
  onClose: () => void;
  onUpdated: (db: any, toastMsg: string) => void;
}

export function A4ReportModal({
  order,
  settings,
  documentDesigns = [],
  centers = [],
  activeUser,
  canPrint,
  canEmail,
  canApiSend,
  autoPrint,
  onClose,
  onUpdated,
}: A4ReportModalProps) {
  const printOpts = settings.moduleSettings?.printOptions;
  const defaultDesign = useMemo(() => {
    const preferredId = printOpts?.selectedReportDesignId;
    return (
      (preferredId && documentDesigns.find((d) => d.id === preferredId)) ||
      documentDesigns.find((d) => d.id === 'dsn-main') ||
      documentDesigns[0]
    );
  }, [documentDesigns, printOpts?.selectedReportDesignId]);

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
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [dispatchEmailInput, setDispatchEmailInput] = useState(order.patientEmail || '');
  const [sendingApi, setSendingApi] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [oneTestPerPage, setOneTestPerPage] = useState<boolean>(false);
  const completedTestIds = useMemo(
    () =>
      order.tests
        .filter(
          (t) =>
            t.status === 'Resulted' ||
            t.status === 'Validated' ||
            Boolean(t.radiologyReport) ||
            t.parameterResults.some((p) => p.value !== null && p.value !== '')
        )
        .map((t) => t.serviceId),
    [order.tests]
  );
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(() =>
    completedTestIds.length > 0 ? completedTestIds : order.tests.map((t) => t.serviceId)
  );
  const visibleTests = useMemo(
    () => order.tests.filter((t) => selectedTestIds.includes(t.serviceId)),
    [order.tests, selectedTestIds]
  );
  const autoPrintedRef = useRef(false);
  const printableRef = useRef<HTMLDivElement | null>(null);

  const tat = computeOrderTat(order);
  const orderedBs = adToBs(order.orderedAt);
  const reportedBs = order.validatedAt ? adToBs(order.validatedAt) : null;
  const isRadiologyOrder = order.tests.every(
    (t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology'
  );
  const resolvedAutoPrint =
    autoPrint ??
    (printOpts?.autoPrintByTemplate?.[isRadiologyOrder ? 'radiologyReport' : 'labReport'] === 'AUTO_PRINT');

  const safeHeaderTitle = getPrintHeaderTitle(settings.labName, activeDesign?.headerTitle, 'DIAGNOSTIC LABORATORY REPORT');
  const safeHeaderTitleNp = sanitizePrintText(settings.labNameNp || activeDesign?.headerTitleNp);
  const safeSubTitle = sanitizePrintText(settings.accreditationLine || activeDesign?.subTitle);
  const safeAddress = sanitizePrintText(settings.addressLine || activeDesign?.addressText);
  const safeContact = sanitizePrintText(settings.contactLine || activeDesign?.phoneText);
  const safeFacility = sanitizePrintText(settings.labName, 'Diagnostic Laboratory');

  const qrValue = useMemo(() => {
    const pan = activeDesign?.panNumber || settings.panNumber;
    const mode = activeDesign?.qrPayloadMode || 'VERIFY_URL';
    if (mode === 'PATIENT_BILL') {
      return `INV:${order.invoiceNumber}|ACC:${order.accessionNumber}|PT:${order.patientName}|NPR:${order.totalAmount}|BS:${orderedBs.formattedEn}|PAN:${pan}`;
    }
    if (mode === 'ACCESSION_PAN') {
      return `ACC:${order.accessionNumber}|PAN:${pan}|STATUS:${order.status}`;
    }
    return `${window.location.origin}/?verify=${encodeURIComponent(order.accessionNumber)}&inv=${encodeURIComponent(order.invoiceNumber)}&pan=${encodeURIComponent(pan)}`;
  }, [activeDesign, settings.panNumber, order, orderedBs.formattedEn]);

  const barcodeValue =
    activeDesign?.barcodeSource === 'INVOICE' ? order.invoiceNumber : order.accessionNumber;

  const triggerPrint = () => {
    const isA5Now = paperSize === 'A5';
    const isThermalNow = paperSize === 'THERMAL_80MM';
    const cssSize = isThermalNow ? '80mm auto' : isA5Now ? 'A5 portrait' : 'A4 portrait';
    executeSmartPrint({
      element: printableRef.current,
      pageCssSize: cssSize,
      documentTitle: `${order.accessionNumber} - ${order.patientName}`,
    });
    void apiRequest<{ db: any }>(`/api/reports/${order.id}/log-print`, activeUser.id, {
      method: 'POST',
      body: JSON.stringify({
        mode: letterheadMode === 'with' ? 'with-letterhead' : 'without-letterhead',
      }),
    })
      .then((resp) => {
        onUpdated(
          resp.db,
          `Printed ${paperSize} report (${letterheadMode === 'with' ? 'With Letterhead' : 'Without Letterhead'}).`
        );
      })
      .catch(() => {
        // Print dialog opened synchronously
      });
  };

  useEffect(() => {
    if (!resolvedAutoPrint || autoPrintedRef.current || !canPrint) return;
    const t = window.setTimeout(() => {
      if (!autoPrintedRef.current) {
        autoPrintedRef.current = true;
        triggerPrint();
      }
    }, 180);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedAutoPrint, canPrint]);

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      const filteredOrder: LabOrder = {
        ...order,
        tests: visibleTests.length > 0 ? visibleTests : order.tests,
      };
      await downloadOrderReportPdf(
        filteredOrder,
        settings,
        activeDesign,
        letterheadMode,
        topOffsetMm,
        bottomOffsetMm
      );
      setFeedback(`Downloaded ${order.accessionNumber}-Report.pdf.`);
    } catch (err: any) {
      setFeedback(err.message || 'PDF generation failed.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleSendEmail = async () => {
    const targetEmail = dispatchEmailInput.trim();
    if (!targetEmail || !targetEmail.includes('@')) {
      setFeedback('Enter a valid recipient email address to dispatch this report.');
      return;
    }
    setSendingEmail(true);
    setFeedback(null);
    try {
      const resp = await apiRequest<{ db: any; email: any }>(
        `/api/reports/${order.id}/send-email`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({ recipientEmail: targetEmail }),
        }
      );
      setShowEmailPrompt(false);
      setFeedback(`Report email dispatched to ${resp.email.recipientEmail}.`);
      onUpdated(resp.db, `Report email sent to ${resp.email.recipientEmail}.`);
    } catch (err: any) {
      setFeedback(err.message || 'Email dispatch failed.');
    } finally {
      setSendingEmail(false);
    }
  };

  const handleSendApi = async () => {
    setSendingApi(true);
    setFeedback(null);
    try {
      const resp = await apiRequest<{ db: any; dispatch: any }>(
        `/api/reports/${order.id}/send-api`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );
      setFeedback(
        `API webhook delivered (HTTP ${resp.dispatch.httpStatus} · ${resp.dispatch.latencyMs}ms).`
      );
      onUpdated(resp.db, `API Report transmitted for ${order.accessionNumber}.`);
    } catch (err: any) {
      setFeedback(err.message || 'API dispatch failed.');
    } finally {
      setSendingApi(false);
    }
  };

  const accentColor = activeDesign?.accentColor || '#1d4ed8';
  const showBanner = letterheadMode === 'with' && (activeDesign ? activeDesign.showLetterheadBanner : true);
  const showQr = activeDesign ? activeDesign.showQrCode : true;
  const showBarcode = activeDesign ? activeDesign.showBarcode : true;
  const isA5 = paperSize === 'A5';
  const isThermal = paperSize === 'THERMAL_80MM';
  const pageClass = isThermal ? 'thermal-80-page' : isA5 ? 'a5-page' : 'a4-page';
  const pageCssSize = isThermal ? '80mm auto' : isA5 ? 'A5 portrait' : 'A4 portrait';
  const sigRole = isRadiologyOrder ? 'RADIOLOGIST' : 'PATHOLOGIST';
  const matchedSig =
    (settings.moduleSettings?.signatureBoxes || []).find((s) => s.roleKey === sigRole) ||
    (settings.moduleSettings?.signatureBoxes || []).find((s) => s.roleKey === 'DOCTOR');

  const printableReportNode = (
    <div
      ref={printableRef}
      className={`${pageClass} bg-white text-slate-900 shadow-2xl flex flex-col justify-between box-border relative overflow-hidden ${isA5 ? 'text-[10.5px]' : ''}`}
      style={{
        width: isThermal ? '78mm' : isA5 ? '148mm' : '210mm',
        minHeight: isThermal ? '120mm' : isA5 ? '210mm' : '297mm',
        paddingLeft: isThermal ? '4mm' : isA5 ? '8mm' : '14mm',
        paddingRight: isThermal ? '4mm' : isA5 ? '8mm' : '14mm',
        paddingTop: letterheadMode === 'with' ? (isA5 ? '7mm' : '12mm') : `${topOffsetMm}mm`,
        paddingBottom: letterheadMode === 'with' ? (isA5 ? '7mm' : '12mm') : `${bottomOffsetMm}mm`,
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
        {showBanner ? (
          <header className={isA5 ? 'mb-2.5' : 'mb-4'}>
            <div
              className="pb-2 border-b-2 flex items-start justify-between gap-3"
              style={{ borderColor: accentColor }}
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                {settings.moduleSettings?.hospitalLogoDataUrl && (
                  <img
                    src={settings.moduleSettings.hospitalLogoDataUrl}
                    alt={safeHeaderTitle}
                    className={`${isA5 ? 'w-10 h-10' : 'w-12 h-12'} object-contain shrink-0 rounded border border-slate-200 p-0.5 bg-white`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  {safeHeaderTitleNp && (
                    <div className={`${isA5 ? 'text-[10px]' : 'text-xs'} font-semibold text-slate-700`}>
                      {safeHeaderTitleNp}
                    </div>
                  )}
                  <h1
                    className={`${isA5 ? 'text-sm' : 'text-lg'} font-bold tracking-tight leading-tight`}
                    style={{ color: accentColor }}
                  >
                    {safeHeaderTitle}
                  </h1>
                  {safeSubTitle && (
                    <p className={`${isA5 ? 'text-[9px]' : 'text-[11px]'} font-medium text-slate-700 mt-0.5`}>
                      {safeSubTitle}
                    </p>
                  )}
                  <p className="text-[9.5px] text-slate-600 mt-0.5">
                    {safeAddress}
                    {activeDesign?.showPan !== false &&
                      ` · PAN: ${activeDesign?.panNumber || settings.panNumber}`}
                    {activeDesign?.licenseNumber ? ` · Reg: ${activeDesign.licenseNumber}` : ''}
                  </p>
                  <p className="text-[9.5px] text-slate-600">
                    {safeContact}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 shrink-0">
                {showBarcode && (
                  <div className="text-right pt-0.5">
                    <BarcodeSvg value={barcodeValue} width={isA5 ? 92 : 126} height={isA5 ? 20 : 28} />
                    <div className="text-[8.5px] font-mono text-slate-600 mt-0.5">
                      {order.status === 'Validated' || order.status === 'Dispatched' ? 'FINAL VERIFIED' : 'PROVISIONAL'} · {order.fiscalYear}
                    </div>
                  </div>
                )}
                {showQr && <QrCodeSvg value={qrValue} size={isA5 ? 46 : 62} />}
              </div>
            </div>
          </header>
        ) : (
          <div className="mb-3 pb-2 border-b border-slate-300 flex items-center justify-between text-[10px] text-slate-600">
            <span>Pre-printed Stationery Layout · {order.fiscalYear}</span>
            <div className="flex items-center gap-3">
              {showBarcode && <BarcodeSvg value={barcodeValue} width={110} height={22} />}
              {showQr && <QrCodeSvg value={qrValue} size={46} />}
            </div>
          </div>
        )}

        <div className="text-center text-xs font-bold uppercase tracking-wider text-slate-900 mb-3">
          {isRadiologyOrder
            ? activeDesign?.radiologyHeading || 'DEPARTMENT OF RADIOLOGY & DIAGNOSTIC IMAGING REPORT'
            : activeDesign?.reportHeading || 'CLINICAL DIAGNOSTIC LABORATORY REPORT'}
        </div>

        {/* Patient & Bilingual BS / AD Metadata */}
        <section className="border border-slate-300 rounded-md p-3 mb-4 bg-slate-50/50 text-[11px]">
          <div className="grid grid-cols-3 gap-x-4 gap-y-1.5">
            <div>
              <span className="text-slate-500">Patient Name: </span>
              <strong className="text-slate-900">{order.patientName}</strong>
            </div>
            <div>
              <span className="text-slate-500">Age / Sex: </span>
              <strong className="text-slate-900 font-mono">
                {order.patientAge} {order.patientAgeType} / {order.patientGender}
              </strong>
            </div>
            <div>
              <span className="text-slate-500">Accession / Inv: </span>
              <strong className="font-mono text-slate-900">{order.accessionNumber}</strong>
            </div>
            <div>
              <span className="text-slate-500">Phone: </span>
              <span className="font-mono text-slate-900">{order.patientPhone || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">Address: </span>
              <span className="text-slate-900">{order.patientAddress || '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">Invoice No: </span>
              <span className="font-mono text-slate-800">{order.invoiceNumber}</span>
            </div>
            {order.uhid && (
              <div>
                <span className="text-slate-500">UHID / Encounter: </span>
                <strong className="font-mono text-slate-900">
                  {order.uhid} {order.encounterLabel ? `· ${order.encounterLabel}` : ''}
                </strong>
              </div>
            )}
            {activeDesign?.showDoctorRef !== false && (
              <div>
                <span className="text-slate-500">Referred By: </span>
                <span className="text-slate-900 font-medium">{order.referringDoctor}</span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Facility: </span>
              <span className="text-slate-900">{safeFacility}</span>
            </div>
            {activeDesign?.showTatBadge !== false && (
              <div>
                <span className="text-slate-500">TAT Status: </span>
                <span className="font-mono text-slate-800">{tat.status}</span>
              </div>
            )}
            {activeDesign?.showNepaliDate !== false && (
              <>
                <div>
                  <span className="text-slate-500">Reg. (BS): </span>
                  <strong className="font-mono text-slate-900">
                    {orderedBs.formattedEn} {orderedBs.timeEn}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">नेपाली मिति: </span>
                  <strong className="text-slate-900">
                    {orderedBs.formattedNp} · {orderedBs.timeNp}
                  </strong>
                </div>
              </>
            )}
            <div>
              <span className="text-slate-500">Reported (BS): </span>
              <span className="font-mono text-slate-800">
                {reportedBs ? `${reportedBs.formattedEn} ${reportedBs.timeEn}` : 'Pending'}
              </span>
            </div>
          </div>
        </section>

        {/* Test Panels / Radiology Studies */}
        <div className="space-y-4">
          {visibleTests.length === 0 ? (
            <div className="p-4 border border-dashed border-slate-300 rounded text-center text-xs text-slate-500">
              Select at least one test above to preview &amp; print.
            </div>
          ) : visibleTests.map((test, testIdx) => {
            const rad = test.radiologyReport;
            const shouldBreakAfter = oneTestPerPage && testIdx < visibleTests.length - 1;
            return (
              <section key={test.serviceId} className={`break-inside-avoid ${shouldBreakAfter ? 'page-break-after' : ''}`}>
                <div
                  className="flex items-baseline justify-between border-b-2 pb-1 mb-2"
                  style={{ borderColor: accentColor }}
                >
                  <div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      {test.serviceName}
                    </span>
                    <span className="ml-2 text-[10px] font-mono text-slate-600">
                      [{test.serviceCode} · {test.modality || test.department}]
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-600 italic">{test.methodology}</span>
                </div>

                {rad ? (
                  <div className="space-y-2.5 text-[11px] leading-relaxed">
                    {rad.clinicalHistory && (
                      <div>
                        <strong className="text-slate-900">Clinical History / Indication: </strong>
                        <span className="text-slate-800">{rad.clinicalHistory}</span>
                      </div>
                    )}
                    {rad.technique && (
                      <div>
                        <strong className="text-slate-900">Imaging Technique: </strong>
                        <span className="text-slate-800">{rad.technique}</span>
                      </div>
                    )}

                    {rad.measurements && rad.measurements.length > 0 && (
                      <table className="w-full text-left border-collapse border border-slate-200 text-[10.5px]">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-300 text-slate-700">
                            <th className="py-1 px-2">Biometry / Structure</th>
                            <th className="py-1 px-2 text-right">Measured Value</th>
                            <th className="py-1 px-2 text-right">Reference Interval</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {rad.measurements.map((m, idx) => (
                            <tr key={idx}>
                              <td className="py-1 px-2 font-medium text-slate-900">{m.label}</td>
                              <td className="py-1 px-2 text-right font-mono font-semibold text-slate-900">
                                {m.value || '—'} {m.unit}
                              </td>
                              <td className="py-1 px-2 text-right font-mono text-slate-600">
                                {m.normalRange || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    <div className="space-y-1.5">
                      {rad.sections.map((sec, idx) => (
                        <div key={idx}>
                          <div
                            className="text-[10.5px] font-bold uppercase tracking-wide"
                            style={{ color: accentColor }}
                          >
                            {sec.title}
                          </div>
                          <div className="text-slate-800 whitespace-pre-line">{sec.content}</div>
                        </div>
                      ))}
                    </div>

                    <div
                      className={`p-2.5 rounded border ${
                        rad.criticalFinding
                          ? 'bg-rose-50 border-rose-300 text-rose-950'
                          : 'bg-slate-50 border-slate-300 text-slate-900'
                      }`}
                    >
                      <div className="font-bold text-[11px] uppercase">
                        {rad.criticalFinding ? 'IMPRESSION (CRITICAL ALERT):' : 'IMPRESSION:'}
                      </div>
                      <div className="font-semibold mt-0.5 whitespace-pre-line">{rad.impression}</div>
                    </div>

                    {rad.advice && (
                      <div className="text-[10.5px] text-slate-700 italic">
                        <strong>Advice / Correlation: </strong>
                        {rad.advice}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <table className="w-full text-left border-collapse text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-300 text-slate-600 font-semibold">
                          <th className="py-1 pr-2">Test Parameter</th>
                          <th className="py-1 px-2 text-right">Result</th>
                          <th className="py-1 px-2">Flag</th>
                          <th className="py-1 px-2">Unit</th>
                          <th className="py-1 pl-2 text-right">Biological Ref. Interval</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {test.parameterResults.map((p) => {
                          const abnormal = p.flag !== 'NORMAL' && p.value !== null;
                          return (
                            <tr key={p.parameterId}>
                              <td className="py-1.5 pr-2 font-medium text-slate-900">
                                {p.parameterName}
                              </td>
                              <td
                                className={`py-1.5 px-2 text-right font-mono tabular-nums ${
                                  abnormal ? 'font-bold text-slate-950' : 'text-slate-800'
                                }`}
                              >
                                {p.value !== null ? p.value : '—'}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-[10px]">
                                {p.value === null ? (
                                  'PENDING'
                                ) : p.flag === 'NORMAL' ? (
                                  <span className="text-slate-500">Normal</span>
                                ) : p.flag === 'HIGH_RISK' ? (
                                  <span className="font-bold text-rose-800 uppercase">HIGH RISK</span>
                                ) : p.flag === 'ABNORMAL' ? (
                                  <span className="font-bold text-amber-700 uppercase">ABNORMAL</span>
                                ) : (
                                  <span className="font-bold text-rose-700">
                                    {p.flag.replace('_', ' ')}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 px-2 font-mono text-slate-600">{p.unit}</td>
                              <td className="py-1.5 pl-2 text-right font-mono tabular-nums text-slate-700">
                                {p.refRangeDisplay}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {test.interpretation && (
                      <div className="mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded text-[10.5px] leading-relaxed text-slate-800">
                        <strong className="text-slate-900">Clinical Interpretation: </strong>
                        {test.interpretation}
                      </div>
                    )}
                  </>
                )}
              </section>
            );
          })}
        </div>
      </div>

      <footer className="relative z-10 pt-4 mt-6 border-t border-slate-300">
        <div className="flex items-end justify-between gap-6 pb-3">
          <div className="text-[10px] text-slate-600 max-w-md leading-relaxed">
            <div className="font-semibold text-slate-800 mb-0.5">Clinical Advisory &amp; Authenticity</div>
            {activeDesign?.footerDisclaimerText ||
              'Results relate exclusively to the specimen/study examined under calibrated conditions. Correlate clinically.'}
          </div>
          <div className="flex items-end gap-4 shrink-0">
            {settings.moduleSettings?.showDigitallyVerifiedSeal !== false && (
              <div className="flex items-center gap-2 border border-emerald-700/40 bg-emerald-50/70 rounded-lg px-2.5 py-1.5">
                <svg viewBox="0 0 40 40" className="w-8 h-8 shrink-0 text-emerald-700" aria-hidden="true">
                  <circle cx="20" cy="20" r="18" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
                  <circle cx="20" cy="20" r="13" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M14 20.5l4 4 8.5-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="text-left leading-tight">
                  <div className="text-[9px] font-bold tracking-wider uppercase text-emerald-900">
                    DIGITALLY VERIFIED
                  </div>
                  <div className="text-[8.5px] font-mono text-emerald-800">
                    {order.validatedByRegNo || settings.moduleSettings?.digitalVerifierRegNo || 'NMC-VERIFIED'}
                  </div>
                  <div className="text-[8px] text-slate-600">{safeFacility}</div>
                </div>
              </div>
            )}

            <div className="text-right">
              {matchedSig?.signatureDataUrl && (
                <img
                  src={matchedSig.signatureDataUrl}
                  alt={matchedSig.label}
                  className="h-9 max-w-[130px] object-contain ml-auto mb-0.5"
                />
              )}
              {order.status === 'Validated' || order.status === 'Dispatched' ? (
                <div>
                  <div className="text-xs font-serif italic text-blue-900 mb-0.5">
                    {settings.moduleSettings?.digitalSignatureText || `/s/ ${order.validatedByName || matchedSig?.signerName}`}
                  </div>
                  <div className="text-[11px] font-bold text-slate-900">
                    {order.validatedByName || matchedSig?.signerName || settings.moduleSettings?.digitalVerifierName}
                  </div>
                  <div className="text-[10px] text-slate-600">
                    {order.validatedByDesignation ||
                      matchedSig?.designation ||
                      settings.moduleSettings?.digitalVerifierDesignation ||
                      activeDesign?.footerSignatureTitle}{' '}
                    · Reg: {order.validatedByRegNo || matchedSig?.regNo || settings.moduleSettings?.digitalVerifierRegNo}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="text-xs font-serif italic text-slate-500 mb-0.5">
                    {settings.moduleSettings?.digitalSignatureText || `/s/ ${matchedSig?.signerName || settings.moduleSettings?.digitalVerifierName || 'Authorized Signatory'}`}
                  </div>
                  <div className="text-[11px] font-semibold text-amber-700">
                    PROVISIONAL REPORT — PENDING FINAL SIGN-OFF
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );

  return (
    <>
      <div className="no-print fixed inset-0 z-50 bg-slate-950/70 flex flex-col overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 shrink-0">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="text-sm font-semibold">{paperSize} Diagnostic Report Studio</div>
              <div className="text-xs text-slate-400 font-mono">
                {order.accessionNumber} · {order.patientName} ({orderedBs.formattedEn})
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                  letterheadMode === 'with'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                With Letterhead
              </button>
              <button
                type="button"
                onClick={() => setLetterheadMode('without')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                  letterheadMode === 'without'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Without Letterhead
              </button>
            </div>

            {letterheadMode === 'without' && (
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <label className="flex items-center gap-1">
                  Top:
                  <input
                    type="number"
                    min={10}
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
                    min={10}
                    max={50}
                    value={bottomOffsetMm}
                    onChange={(e) => setBottomOffsetMm(Number(e.target.value) || 22)}
                    className="w-12 px-1.5 py-1 bg-slate-800 border border-slate-700 rounded text-white font-mono text-xs"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canEmail && (
              <button
                type="button"
                disabled={sendingEmail}
                onClick={() => setShowEmailPrompt((prev) => !prev)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg border border-slate-700 whitespace-nowrap"
              >
                <Mail className="w-3.5 h-3.5" />
                {sendingEmail ? 'Sending...' : 'Email'}
              </button>
            )}
            {canApiSend && (
              <button
                type="button"
                disabled={sendingApi}
                onClick={handleSendApi}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg border border-slate-700 whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5" />
                {sendingApi ? 'Sending...' : 'API'}
              </button>
            )}
            {canPrint && (
              <>
                <button
                  type="button"
                  disabled={downloadingPdf}
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" />
                  {downloadingPdf ? 'Generating...' : 'Download PDF'}
                </button>
                <button
                  type="button"
                  onClick={triggerPrint}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print {paperSize}
                </button>
                {order.status !== 'Dispatched' && (
                  <button
                    type="button"
                    onClick={() => {
                      void apiRequest<{ db: any; order: LabOrder }>(
                        `/api/orders/${order.id}/dispatch`,
                        activeUser.id,
                        {
                          method: 'POST',
                          body: JSON.stringify({ dispatchMode: 'Counter Pickup' }),
                        }
                      )
                        .then((resp) => {
                          setFeedback(`Report ${order.accessionNumber} marked as Dispatched.`);
                          onUpdated(resp.db, `Report ${order.accessionNumber} dispatched to patient.`);
                        })
                        .catch((err: any) => setFeedback(err.message || 'Dispatch failed.'));
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg whitespace-nowrap"
                  >
                    Mark Dispatched
                  </button>
                )}
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showEmailPrompt && (
          <div className="bg-slate-800 text-white px-6 py-2.5 border-b border-slate-700 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-300">Recipient Email for Report Dispatch:</span>
            <input
              type="email"
              data-no-autocap="true"
              value={dispatchEmailInput}
              onChange={(e) => setDispatchEmailInput(e.target.value)}
              placeholder="patient@example.com"
              className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-600 rounded-lg text-white w-64"
            />
            <button
              type="button"
              disabled={sendingEmail}
              onClick={handleSendEmail}
              className="px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
            >
              {sendingEmail ? 'Sending...' : 'Send Report Email'}
            </button>
            <button
              type="button"
              onClick={() => setShowEmailPrompt(false)}
              className="px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
            >
              Cancel
            </button>
          </div>
        )}

        {feedback && (
          <div className="bg-blue-950 text-blue-100 text-xs px-6 py-2 border-b border-blue-900">
            {feedback}
          </div>
        )}

        {/* Per-Test Print Selector & 1-Test-Per-Page Toggle */}
        <div className="bg-slate-800/95 text-white px-5 py-2 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2 text-xs shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-300">Print Tests ({visibleTests.length}/{order.tests.length}):</span>
            {order.tests.map((t) => {
              const isDone = completedTestIds.includes(t.serviceId);
              const checked = selectedTestIds.includes(t.serviceId);
              return (
                <label
                  key={t.serviceId}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border cursor-pointer ${
                    checked
                      ? 'bg-blue-600/25 border-blue-500 text-white'
                      : 'bg-slate-900 border-slate-700 text-slate-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...selectedTestIds, t.serviceId]
                        : selectedTestIds.filter((id) => id !== t.serviceId);
                      setSelectedTestIds(next);
                    }}
                    className="rounded border-slate-500"
                  />
                  <span>{t.serviceName}</span>
                  <span className={`text-[10px] font-mono ${isDone ? 'text-emerald-300' : 'text-amber-300'}`}>
                    ({isDone ? 'Done' : 'Pending'})
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            {completedTestIds.length > 0 && completedTestIds.length < order.tests.length && (
              <button
                type="button"
                onClick={() => setSelectedTestIds(completedTestIds)}
                className="px-2.5 py-1 rounded bg-emerald-700/70 hover:bg-emerald-600 text-[11px] font-medium"
              >
                Done Tests Only
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedTestIds(order.tests.map((t) => t.serviceId))}
              className="px-2.5 py-1 rounded bg-slate-700 hover:bg-slate-600 text-[11px] font-medium"
            >
              Select All
            </button>
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={oneTestPerPage}
                onChange={(e) => setOneTestPerPage(e.target.checked)}
              />
              <span className="text-[11px] font-medium text-blue-300">1 Test Per Page</span>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-10 flex justify-center bg-slate-800/80">
          {printableReportNode}
        </div>
      </div>
    </>
  );
}
