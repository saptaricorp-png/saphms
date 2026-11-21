import React, { useEffect, useState } from 'react';
import { Activity, AlertOctagon, ArrowRight, CheckCircle2, FlaskConical, ShieldAlert, X } from 'lucide-react';
import type { EmergencyCase, LabOrder, LimsDatabase } from '../types/lims';

interface CriticalAlertBannerProps {
  db: LimsDatabase;
  onResolveMlc: (erCase: EmergencyCase) => void;
  onResolveCriticalOrder: (order: LabOrder) => void;
  onAcknowledgeVitalsAlert?: (alertId: string) => void;
  onNavigateToPortal?: () => void;
}

const CRITICAL_FLAGS = new Set(['CRITICAL_HIGH', 'CRITICAL_LOW', 'CRITICAL', 'HIGH_RISK']);

export function CriticalAlertBanner({
  db,
  onResolveMlc,
  onResolveCriticalOrder,
  onAcknowledgeVitalsAlert,
  onNavigateToPortal,
}: CriticalAlertBannerProps) {
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [bannerClosedSignature, setBannerClosedSignature] = useState<string | null>(null);

  const pendingMlcCases = (db.emergencyCases || []).filter(
    (e) => e.isMlc && !e.policeInformed && !dismissedIds.includes(`mlc:${e.id}`)
  );

  const criticalOrders = (db.orders || []).filter(
    (o) =>
      o.status !== 'Validated' &&
      o.status !== 'Dispatched' &&
      !dismissedIds.includes(`ord:${o.id}`) &&
      o.tests.some((t) =>
        t.parameterResults.some((p) => CRITICAL_FLAGS.has(p.flag))
      )
  );

  const clinicalVitalsAlerts = (db.securityAlerts || []).filter(
    (a) => !a.resolved && a.type === 'CLINICAL_VITALS_ALERT' && !dismissedIds.includes(`vit:${a.id}`)
  );

  const activeSignature = [
    ...pendingMlcCases.map((c) => c.id),
    ...criticalOrders.map((o) => o.id),
    ...clinicalVitalsAlerts.map((a) => a.id),
  ].join('|');

  useEffect(() => {
    if (bannerClosedSignature && activeSignature && bannerClosedSignature !== activeSignature) {
      setBannerClosedSignature(null);
    }
  }, [activeSignature, bannerClosedSignature]);

  if (
    !activeSignature ||
    bannerClosedSignature === activeSignature ||
    (pendingMlcCases.length === 0 &&
      criticalOrders.length === 0 &&
      clinicalVitalsAlerts.length === 0)
  ) {
    return null;
  }

  return (
    <div className="no-print sticky top-16 z-20 bg-rose-50 border-b border-rose-200 px-4 sm:px-6 py-2.5">
      <div className="max-w-[1440px] mx-auto flex items-start justify-between gap-3">
        <div className="flex-1 flex flex-col gap-1.5 min-w-0">
          {clinicalVitalsAlerts.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-rose-950 min-w-0">
                <Activity className="w-4 h-4 text-rose-700 shrink-0" />
                <span className="font-semibold">
                  Urgent Doctor Vitals Notification ({clinicalVitalsAlerts.length})
                </span>
                <span className="text-rose-800 truncate">
                  · {clinicalVitalsAlerts[0].message}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {onNavigateToPortal && (
                  <button
                    type="button"
                    onClick={onNavigateToPortal}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-rose-900 bg-white border border-rose-300 rounded-md hover:bg-rose-100 whitespace-nowrap"
                  >
                    Open Portal
                    <ArrowRight className="w-3 h-3" />
                  </button>
                )}
                {onAcknowledgeVitalsAlert && (
                  <button
                    type="button"
                    onClick={() => onAcknowledgeVitalsAlert(clinicalVitalsAlerts[0].id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-700 rounded-md hover:bg-rose-800 whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    Acknowledge Alert
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDismissedIds((prev) => [...prev, `vit:${clinicalVitalsAlerts[0].id}`])}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-800 bg-white border border-rose-300 rounded-md hover:bg-rose-100 whitespace-nowrap"
                  title="Dismiss this vitals alert"
                >
                  <X className="w-3 h-3" />
                  Close
                </button>
              </div>
            </div>
          )}

          {pendingMlcCases.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-rose-950 min-w-0">
                <ShieldAlert className="w-4 h-4 text-rose-700 shrink-0" />
                <span className="font-semibold">
                  Pending MLC Submission ({pendingMlcCases.length})
                </span>
                <span className="text-rose-800 truncate">
                  · {pendingMlcCases[0].erNumber} — {pendingMlcCases[0].patientName} (
                  {pendingMlcCases[0].mlcCaseType || 'Medico-Legal Case'}): Police intimation not submitted
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onResolveMlc(pendingMlcCases[0])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-700 rounded-md hover:bg-rose-800 whitespace-nowrap"
                >
                  Resolve MLC Intimation
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedIds((prev) => [...prev, `mlc:${pendingMlcCases[0].id}`])}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-800 bg-white border border-rose-300 rounded-md hover:bg-rose-100 whitespace-nowrap"
                  title="Dismiss MLC reminder"
                >
                  <X className="w-3 h-3" />
                  Cancel
                </button>
              </div>
            </div>
          )}

          {criticalOrders.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-rose-950 min-w-0">
                <AlertOctagon className="w-4 h-4 text-rose-700 shrink-0" />
                <span className="font-semibold">
                  High Risk Abnormal Lab Results ({criticalOrders.length})
                </span>
                <span className="text-rose-800 truncate inline-flex items-center gap-1">
                  <FlaskConical className="w-3 h-3 shrink-0" />
                  {criticalOrders[0].accessionNumber} — {criticalOrders[0].patientName} (Awaiting urgent review &amp; validation)
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => onResolveCriticalOrder(criticalOrders[0])}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-rose-700 rounded-md hover:bg-rose-800 whitespace-nowrap"
                >
                  Review &amp; Validate Now
                  <ArrowRight className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setDismissedIds((prev) => [...prev, `ord:${criticalOrders[0].id}`])}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-800 bg-white border border-rose-300 rounded-md hover:bg-rose-100 whitespace-nowrap"
                  title="Dismiss critical alert"
                >
                  <X className="w-3 h-3" />
                  Close
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setBannerClosedSignature(activeSignature)}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-800 bg-white border border-rose-300 rounded-md hover:bg-rose-100 shrink-0"
          aria-label="Close critical alert banner"
          title="Close Alert Banner"
        >
          <X className="w-3.5 h-3.5" />
          Dismiss
        </button>
      </div>
    </div>
  );
}
