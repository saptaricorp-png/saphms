import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookmarkPlus,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Lock,
  Scan,
  Sparkles,
  Zap,
  X,
} from 'lucide-react';
import type {
  LabOrder,
  LabServiceTest,
  RadiologyReportData,
  RadiologyTemplate,
  ResultFlag,
  StaffMember,
} from '../types/lims';
import {
  computeOrderTat,
  evaluateParameterFlag,
  evaluateParameterFormulas,
  generateClinicalInterpretation,
} from '../utils/clinical';
import { ResultFlagLabel, TatStatusLabel } from './StatusText';
import { apiRequest } from '../api/client';

interface ResultWorkbenchModalProps {
  order: LabOrder;
  services: LabServiceTest[];
  radiologyTemplates?: RadiologyTemplate[];
  activeUser: StaffMember;
  canEnterResults: boolean;
  canValidateResults: boolean;
  canReportRadiology?: boolean;
  onClose: () => void;
  onUpdated: (db: any, toastMsg: string) => void;
}

function buildInitialRadDraft(
  test: LabOrder['tests'][number],
  service: LabServiceTest | undefined,
  templates: RadiologyTemplate[]
): RadiologyReportData {
  if (test.radiologyReport) {
    return JSON.parse(JSON.stringify(test.radiologyReport));
  }
  const tpl =
    templates.find((t) => t.id === service?.defaultRadiologyTemplateId) ||
    templates.find((t) => t.modality === (test.modality || service?.modality)) ||
    templates[0];

  if (tpl) {
    return {
      templateId: tpl.id,
      templateName: tpl.name,
      modality: tpl.modality,
      clinicalHistory: tpl.indicationPrompt || 'Routine diagnostic evaluation',
      technique: tpl.technique,
      sections: tpl.sections.map((s) => ({ title: s.title, content: s.defaultText })),
      measurements: tpl.measurements.map((m) => ({
        label: m.label,
        value: m.defaultValue,
        unit: m.unit,
        normalRange: m.normalRange,
      })),
      impression: tpl.normalImpression,
      advice: tpl.advice,
      criticalFinding: false,
      filmsUsedCount: tpl.modality === 'X-RAY' || tpl.modality === 'CT' ? 1 : 0,
      filmRetakeCount: 0,
    };
  }

  return {
    templateName: `${test.serviceName} Standard Report`,
    modality: test.modality || 'X-RAY',
    clinicalHistory: 'Clinical correlation',
    technique: test.methodology || 'Standard imaging protocol',
    sections: [{ title: 'Findings', content: 'Normal study.' }],
    measurements: [],
    impression: 'Normal study. No acute abnormality detected.',
    advice: 'Correlate clinically.',
    criticalFinding: false,
    filmsUsedCount: 1,
    filmRetakeCount: 0,
  };
}

export function ResultWorkbenchModal({
  order,
  services,
  radiologyTemplates = [],
  activeUser,
  canEnterResults,
  canValidateResults,
  canReportRadiology = false,
  onClose,
  onUpdated,
}: ResultWorkbenchModalProps) {
  const [valuesByService, setValuesByService] = useState<
    Record<string, Record<string, string>>
  >(() => {
    const init: Record<string, Record<string, string>> = {};
    for (const t of order.tests) {
      init[t.serviceId] = {};
      for (const p of t.parameterResults) {
        init[t.serviceId][p.parameterId] = p.value !== null ? String(p.value) : '';
      }
    }
    return init;
  });

  const [interpByService, setInterpByService] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of order.tests) {
      init[t.serviceId] = t.interpretation || '';
    }
    return init;
  });

  const [flagOverridesByService, setFlagOverridesByService] = useState<
    Record<string, Record<string, ResultFlag>>
  >(() => {
    const init: Record<string, Record<string, ResultFlag>> = {};
    for (const t of order.tests) {
      init[t.serviceId] = {};
      for (const p of t.parameterResults) {
        if (p.flag === 'HIGH_RISK' || p.flag === 'ABNORMAL') {
          init[t.serviceId][p.parameterId] = p.flag;
        }
      }
    }
    return init;
  });

  const [radDraftsByService, setRadDraftsByService] = useState<Record<string, RadiologyReportData>>(
    () => {
      const init: Record<string, RadiologyReportData> = {};
      for (const t of order.tests) {
        if (t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology') {
          const srv = services.find((s) => s.id === t.serviceId);
          init[t.serviceId] = buildInitialRadDraft(t, srv, radiologyTemplates);
        }
      }
      return init;
    }
  );

  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [autoFetching, setAutoFetching] = useState(false);
  const [fetchBanner, setFetchBanner] = useState<string | null>(null);
  const [savingTplId, setSavingTplId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [amendMode, setAmendMode] = useState(false);

  const tat = useMemo(() => computeOrderTat(order), [order]);
  const isValidatedStage = order.status === 'Validated' || order.status === 'Dispatched';
  const isLocked = isValidatedStage && !amendMode;
  const canEditRad = !isLocked && (canReportRadiology || canEnterResults || canValidateResults);

  const evaluatedTests = useMemo(() => {
    return order.tests.map((test) => {
      const service = services.find((s) => s.id === test.serviceId);
      const isRadiology = test.serviceCategory === 'RADIOLOGY' || test.department === 'Radiology';
      const valMap = valuesByService[test.serviceId] || {};
      const params = test.parameterResults.map((pr) => {
        const paramDef = service?.parameters.find((p) => p.id === pr.parameterId);
        const isQual = (paramDef?.resultType || pr.resultType) === 'QUALITATIVE';
        const raw = valMap[pr.parameterId];

        const parsedVal: number | string | null = isQual
          ? raw !== undefined && raw.trim() !== ''
            ? raw.trim()
            : null
          : raw !== undefined && raw !== '' && !Number.isNaN(Number(raw))
          ? Number(raw)
          : null;

        const autoFlag = paramDef
          ? evaluateParameterFlag(parsedVal, paramDef, order.patientGender)
          : pr.flag;
        const overrideFlag = flagOverridesByService[test.serviceId]?.[pr.parameterId];
        const flag = overrideFlag || autoFlag;
        return {
          ...pr,
          resultType: isQual ? ('QUALITATIVE' as const) : ('NUMERIC' as const),
          paramDef,
          value: parsedVal,
          flag,
        };
      });
      const autoInterp = service ? generateClinicalInterpretation(service, params) : '';
      return {
        ...test,
        isRadiology,
        service,
        evaluatedParams: params,
        autoInterp,
      };
    });
  }, [order, services, valuesByService, flagOverridesByService]);

  const applyRadiologyTemplate = (serviceId: string, tplId: string) => {
    const tpl = radiologyTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    setRadDraftsByService((prev) => ({
      ...prev,
      [serviceId]: {
        templateId: tpl.id,
        templateName: tpl.name,
        modality: tpl.modality,
        clinicalHistory: tpl.indicationPrompt,
        technique: tpl.technique,
        sections: tpl.sections.map((s) => ({ title: s.title, content: s.defaultText })),
        measurements: tpl.measurements.map((m) => ({
          label: m.label,
          value: m.defaultValue,
          unit: m.unit,
          normalRange: m.normalRange,
        })),
        impression: tpl.normalImpression,
        advice: tpl.advice,
        criticalFinding: false,
        filmsUsedCount: prev[serviceId]?.filmsUsedCount ?? (tpl.modality === 'X-RAY' || tpl.modality === 'CT' ? 1 : 0),
        filmRetakeCount: prev[serviceId]?.filmRetakeCount ?? 0,
      },
    }));
  };

  const applyQuickMacro = (
    serviceId: string,
    macro: { label: string; sectionTitle: string; findingText: string; impressionText: string }
  ) => {
    setRadDraftsByService((prev) => {
      const curr = prev[serviceId];
      if (!curr) return prev;
      const nextSections = curr.sections.map((s) =>
        s.title.toLowerCase().includes(macro.sectionTitle.toLowerCase()) ||
        macro.sectionTitle.toLowerCase().includes(s.title.toLowerCase())
          ? { ...s, content: macro.findingText }
          : s
      );
      return {
        ...prev,
        [serviceId]: {
          ...curr,
          sections: nextSections,
          impression: macro.impressionText,
        },
      };
    });
  };

  const handleSaveAsNewTemplate = async (serviceId: string) => {
    const draft = radDraftsByService[serviceId];
    if (!draft) return;
    setSavingTplId(serviceId);
    try {
      const resp = await apiRequest<{ db: any; template: RadiologyTemplate }>(
        '/api/radiology/templates',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            name: `${draft.templateName} (Saved)`,
            modality: draft.modality,
            serviceId,
            technique: draft.technique,
            indicationPrompt: draft.clinicalHistory,
            sections: draft.sections.map((s, idx) => ({
              id: `sec-${idx}`,
              title: s.title,
              defaultText: s.content,
            })),
            measurements: draft.measurements.map((m, idx) => ({
              id: `m-${idx}`,
              label: m.label,
              unit: m.unit,
              normalRange: m.normalRange,
              defaultValue: m.value,
            })),
            normalImpression: draft.impression,
            advice: draft.advice,
            quickMacros: [],
          }),
        }
      );
      onUpdated(resp.db, `Saved reusable Radiology Template '${resp.template.name}'.`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save radiology template.');
    } finally {
      setSavingTplId(null);
    }
  };

  const handleAutoFetchAnalyzer = async () => {
    setErrorMsg(null);
    setFetchBanner(null);
    setAutoFetching(true);
    try {
      const resp = await apiRequest<{
        order: LabOrder;
        matchedAnalyzer: string;
        appliedCount: number;
        updatedTests: string[];
        db: any;
      }>(`/api/orders/${order.id}/auto-fetch-analyzer`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      const nextVals: Record<string, Record<string, string>> = { ...valuesByService };
      const nextInterps: Record<string, string> = { ...interpByService };
      for (const t of resp.order.tests) {
        if (t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology') continue;
        nextVals[t.serviceId] = {};
        for (const p of t.parameterResults) {
          nextVals[t.serviceId][p.parameterId] =
            p.value !== null && p.value !== undefined ? String(p.value) : '';
        }
        if (t.interpretation) {
          nextInterps[t.serviceId] = t.interpretation;
        }
      }
      setValuesByService(nextVals);
      setInterpByService(nextInterps);
      const msg = `Auto-fetched ${resp.appliedCount} analyte(s) from ${resp.matchedAnalyzer} (${resp.updatedTests.join(', ')}).`;
      setFetchBanner(msg);
      onUpdated(resp.db, msg);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to auto-fetch results from connected analyzer.');
    } finally {
      setAutoFetching(false);
    }
  };

  const handleNumericParamChange = (
    serviceId: string,
    parameterId: string,
    nextRawVal: string,
    serviceDef?: LabServiceTest
  ) => {
    setValuesByService((prev) => {
      const currMap = { ...(prev[serviceId] || {}), [parameterId]: nextRawVal };
      if (!serviceDef) {
        return { ...prev, [serviceId]: currMap };
      }
      const hasFormulas = serviceDef.parameters.some((p) => p.formula && p.formula.trim());
      if (!hasFormulas) {
        return { ...prev, [serviceId]: currMap };
      }
      const numericInputs: Record<string, number | string | null> = {};
      for (const [k, v] of Object.entries(currMap)) {
        numericInputs[k] = v === '' ? null : !Number.isNaN(Number(v)) ? Number(v) : v;
      }
      const computed = evaluateParameterFormulas(serviceDef.parameters, numericInputs);
      const updatedMap: Record<string, string> = { ...currMap };
      for (const p of serviceDef.parameters) {
        if (p.formula && p.formula.trim()) {
          if (computed[p.id] !== undefined && computed[p.id] !== null && computed[p.id] !== '') {
            updatedMap[p.id] = String(computed[p.id]);
          } else if (p.id !== parameterId) {
            updatedMap[p.id] = '';
          }
        }
      }
      return { ...prev, [serviceId]: updatedMap };
    });
  };

  const saveAllDrafts = async (): Promise<any> => {
    let latestDb: any = null;

    const pathTests = evaluatedTests.filter((t) => !t.isRadiology);
    if (pathTests.length > 0 && canEnterResults) {
      const testUpdates = pathTests.map((t) => {
        const values: Record<string, number | string | null> = {};
        for (const p of t.evaluatedParams) {
          values[p.parameterId] = p.value;
        }
        const flagOverrides = flagOverridesByService[t.serviceId] || {};
        return {
          serviceId: t.serviceId,
          values,
          flagOverrides,
          interpretation: interpByService[t.serviceId] || t.autoInterp,
        };
      });
      const resp = await apiRequest<{ db: any }>(`/api/orders/${order.id}/results`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({ testUpdates }),
      });
      latestDb = resp.db;
    }

    const radTests = evaluatedTests.filter((t) => t.isRadiology);
    for (const rt of radTests) {
      const radDraft = radDraftsByService[rt.serviceId];
      if (radDraft && canEditRad) {
        const resp = await apiRequest<{ db: any }>(
          `/api/orders/${order.id}/radiology-report`,
          activeUser.id,
          {
            method: 'POST',
            body: JSON.stringify({
              serviceId: rt.serviceId,
              radiologyReport: radDraft,
            }),
          }
        );
        latestDb = resp.db;
      }
    }

    return latestDb;
  };

  const handleSaveResults = async () => {
    setErrorMsg(null);
    setSaving(true);
    try {
      const latestDb = await saveAllDrafts();
      if (latestDb) {
        onUpdated(latestDb, `Saved diagnostic results & reports for ${order.accessionNumber}.`);
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save reports.');
    } finally {
      setSaving(false);
    }
  };

  const handleValidateAndSignOff = async () => {
    setErrorMsg(null);
    setValidating(true);
    try {
      await saveAllDrafts();
      const resp = await apiRequest<{
        db: any;
        emailTriggered: any;
        apiTriggered: any;
        lowStockWarnings: string[];
      }>(`/api/orders/${order.id}/validate`, activeUser.id, {
        method: 'POST',
      });

      const notes: string[] = [`Validated ${order.accessionNumber} & deducted inventory BOM.`];
      if (resp.emailTriggered) notes.push('Auto-email sent.');
      if (resp.apiTriggered) notes.push('API webhook dispatched.');
      if (resp.lowStockWarnings?.length) {
        notes.push(`Low stock alert: ${resp.lowStockWarnings.join(', ')}`);
      }
      onUpdated(resp.db, notes.join(' '));
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Validation failed.');
    } finally {
      setValidating(false);
    }
  };

  const hasPathologyTests = evaluatedTests.some((t) => !t.isRadiology);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-5xl shadow-xl overflow-hidden my-6 flex flex-col max-h-[92vh]">
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-900 font-mono">
                {order.accessionNumber}
              </h2>
              <span className="text-xs text-slate-500">·</span>
              <span className="text-sm font-medium text-slate-800">{order.patientName}</span>
              <span className="text-xs text-slate-500">
                ({order.patientAge} {order.patientAgeType} / {order.patientGender})
              </span>
              <span className="text-xs text-slate-500">·</span>
              <TatStatusLabel status={tat.status} label={tat.label} />
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {order.uhid ? `UHID: ${order.uhid} · ` : ''}
              {order.encounterLabel ? `${order.encounterLabel} · ` : ''}
              Ref: {order.referringDoctor} · Priority: {order.priority}
              {order.nonInventoryBillOnly ? ' · [BILL-ONLY · NO STOCK DEDUCTION]' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isLocked && canEnterResults && hasPathologyTests && (
              <button
                type="button"
                disabled={autoFetching}
                onClick={handleAutoFetchAnalyzer}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-300 rounded-lg hover:bg-emerald-100 disabled:opacity-50 whitespace-nowrap"
              >
                <Cpu className="w-3.5 h-3.5" />
                {autoFetching ? 'Fetching Analyzer...' : 'Auto-Fetch from Analyzer'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-200/60"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {fetchBanner && (
            <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-700" />
                <span>{fetchBanner}</span>
              </div>
              <button
                type="button"
                onClick={() => setFetchBanner(null)}
                className="p-1 text-emerald-700 hover:bg-emerald-100 rounded shrink-0"
                aria-label="Close banner"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-xs flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-rose-800 bg-white border border-rose-300 rounded hover:bg-rose-100 shrink-0"
                aria-label="Close error message"
              >
                <X className="w-3.5 h-3.5" />
                Close
              </button>
            </div>
          )}

          {isValidatedStage && (
            <div className="p-3.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 shrink-0" />
                <span>
                  Report {order.status === 'Dispatched' ? 'dispatched & ' : 'digitally '}validated by{' '}
                  <strong>{order.validatedByName || 'Validator'}</strong>
                  {order.validatedByRegNo ? ` (${order.validatedByRegNo})` : ''} on{' '}
                  {order.validatedAt ? new Date(order.validatedAt).toLocaleString() : ''}.
                  {amendMode ? ' Unlocked for authorized Amendment.' : ''}
                </span>
              </div>
              {canValidateResults && (
                <button
                  type="button"
                  onClick={() => setAmendMode((prev) => !prev)}
                  className="px-3 py-1 text-xs font-semibold rounded-md border border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
                >
                  {amendMode ? 'Lock Edits' : 'Amend / Edit Report'}
                </button>
              )}
            </div>
          )}

          {evaluatedTests.map((test) => {
            if (test.isRadiology) {
              const draft = radDraftsByService[test.serviceId];
              const matchingTpls = radiologyTemplates.filter(
                (tpl) => tpl.modality === (test.modality || draft?.modality)
              );
              const selectedTpl = radiologyTemplates.find((tpl) => tpl.id === draft?.templateId);

              return (
                <div key={test.serviceId} className="border border-indigo-200 rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-indigo-50/70 border-b border-indigo-200 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Scan className="w-4 h-4 text-indigo-700" />
                        <span className="font-mono text-xs font-semibold text-indigo-800">
                          {test.serviceCode} · {test.modality || 'RADIOLOGY'}
                        </span>
                        <span className="text-sm font-semibold text-slate-900">{test.serviceName}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {test.methodology} · Target TAT: {test.tatMinutes}m
                        {test.reagentsDeducted && ' · X-Ray Film / Consumable Stock Deducted'}
                      </div>
                    </div>

                    {canEditRad && (
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={draft?.templateId || ''}
                          onChange={(e) => applyRadiologyTemplate(test.serviceId, e.target.value)}
                          className="px-2.5 py-1.5 text-xs bg-white border border-indigo-300 rounded-lg"
                        >
                          <option value="">Load Saved Template...</option>
                          {(matchingTpls.length > 0 ? matchingTpls : radiologyTemplates).map((tpl) => (
                            <option key={tpl.id} value={tpl.id}>
                              [{tpl.modality}] {tpl.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={savingTplId === test.serviceId}
                          onClick={() => handleSaveAsNewTemplate(test.serviceId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-800 bg-white border border-indigo-300 rounded-lg hover:bg-indigo-100"
                        >
                          <BookmarkPlus className="w-3.5 h-3.5" />
                          {savingTplId === test.serviceId ? 'Saving...' : 'Save as Template'}
                        </button>
                      </div>
                    )}
                  </div>

                  {draft && (
                    <div className="p-4 space-y-4 text-xs">
                      {/* 1-Click Abnormal Quick Macros */}
                      {canEditRad && selectedTpl && selectedTpl.quickMacros.length > 0 && (
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5">
                          <div className="font-semibold text-slate-700 flex items-center gap-1.5">
                            <Zap className="w-3.5 h-3.5 text-amber-600" />
                            1-Click Diagnostic Finding Macros ({selectedTpl.name})
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => applyRadiologyTemplate(test.serviceId, selectedTpl.id)}
                              className="px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-md font-medium hover:bg-emerald-100"
                            >
                              Reset Normal Study
                            </button>
                            {selectedTpl.quickMacros.map((mac, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => applyQuickMacro(test.serviceId, mac)}
                                className="px-2.5 py-1 bg-white text-slate-800 border border-slate-300 rounded-md font-medium hover:bg-indigo-50 hover:border-indigo-300"
                              >
                                + {mac.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">
                            Clinical History / Indication
                          </label>
                          <input
                            disabled={!canEditRad}
                            value={draft.clinicalHistory}
                            onChange={(e) =>
                              setRadDraftsByService((prev) => ({
                                ...prev,
                                [test.serviceId]: { ...draft, clinicalHistory: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">
                            Imaging Technique / Protocol
                          </label>
                          <input
                            disabled={!canEditRad}
                            value={draft.technique}
                            onChange={(e) =>
                              setRadDraftsByService((prev) => ({
                                ...prev,
                                [test.serviceId]: { ...draft, technique: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                          />
                        </div>
                      </div>

                      {/* Quantitative Measurements / Biometry (Echo EF%, USG CBD, Liver Span) */}
                      {draft.measurements.length > 0 && (
                        <div className="border border-slate-200 rounded-lg overflow-hidden">
                          <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 font-semibold text-slate-700">
                            Biometry / Quantitative Measurements
                          </div>
                          <div className="divide-y divide-slate-100">
                            {draft.measurements.map((m, idx) => (
                              <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                                <div className="col-span-5 font-medium text-slate-800">{m.label}</div>
                                <div className="col-span-3 flex items-center gap-1">
                                  <input
                                    disabled={!canEditRad}
                                    value={m.value}
                                    onChange={(e) => {
                                      const nextM = [...draft.measurements];
                                      nextM[idx] = { ...m, value: e.target.value };
                                      setRadDraftsByService((prev) => ({
                                        ...prev,
                                        [test.serviceId]: { ...draft, measurements: nextM },
                                      }));
                                    }}
                                    className="w-full px-2 py-1 font-mono border border-slate-300 rounded disabled:bg-slate-100"
                                  />
                                  <span className="font-mono text-slate-500">{m.unit}</span>
                                </div>
                                <div className="col-span-4 text-right font-mono text-slate-500">
                                  Ref: {m.normalRange}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Structured Anatomical Findings Sections */}
                      <div className="space-y-2.5">
                        {draft.sections.map((sec, idx) => (
                          <div key={idx}>
                            <label className="block font-semibold text-indigo-900 mb-1 uppercase text-[11px]">
                              {sec.title}
                            </label>
                            <textarea
                              rows={2}
                              disabled={!canEditRad}
                              value={sec.content}
                              onChange={(e) => {
                                const nextS = [...draft.sections];
                                nextS[idx] = { ...sec, content: e.target.value };
                                setRadDraftsByService((prev) => ({
                                  ...prev,
                                  [test.serviceId]: { ...draft, sections: nextS },
                                }));
                              }}
                              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                            />
                          </div>
                        ))}
                      </div>

                      <div>
                        <label className="block font-bold text-slate-900 mb-1">
                          IMPRESSION / RADIOLOGIST CONCLUSION *
                        </label>
                        <textarea
                          rows={2}
                          disabled={!canEditRad}
                          value={draft.impression}
                          onChange={(e) =>
                            setRadDraftsByService((prev) => ({
                              ...prev,
                              [test.serviceId]: { ...draft, impression: e.target.value },
                            }))
                          }
                          className="w-full px-3 py-2 font-medium border-2 border-indigo-300 rounded-lg bg-indigo-50/30 disabled:bg-slate-100"
                        />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
                        <div className="md:col-span-2">
                          <label className="block font-medium text-slate-700 mb-1">
                            Advice / Follow-up
                          </label>
                          <input
                            disabled={!canEditRad}
                            value={draft.advice}
                            onChange={(e) =>
                              setRadDraftsByService((prev) => ({
                                ...prev,
                                [test.serviceId]: { ...draft, advice: e.target.value },
                              }))
                            }
                            className="w-full px-3 py-1.5 border border-slate-300 rounded-lg disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block font-medium text-slate-700 mb-1">
                            Films / Sheets Used
                          </label>
                          <input
                            type="number"
                            min={0}
                            disabled={!canEditRad}
                            value={draft.filmsUsedCount}
                            onChange={(e) =>
                              setRadDraftsByService((prev) => ({
                                ...prev,
                                [test.serviceId]: {
                                  ...draft,
                                  filmsUsedCount: Math.max(0, Number(e.target.value) || 0),
                                },
                              }))
                            }
                            className="w-full px-3 py-1.5 font-mono border border-slate-300 rounded-lg disabled:bg-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block font-medium text-rose-700 mb-1">
                            Film Retake Wastage
                          </label>
                          <input
                            type="number"
                            min={0}
                            disabled={!canEditRad}
                            value={draft.filmRetakeCount}
                            onChange={(e) =>
                              setRadDraftsByService((prev) => ({
                                ...prev,
                                [test.serviceId]: {
                                  ...draft,
                                  filmRetakeCount: Math.max(0, Number(e.target.value) || 0),
                                },
                              }))
                            }
                            className="w-full px-3 py-1.5 font-mono border border-rose-300 rounded-lg disabled:bg-slate-100"
                          />
                        </div>
                      </div>

                      <label className="inline-flex items-center gap-2 font-semibold text-rose-800 cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={!canEditRad}
                          checked={draft.criticalFinding}
                          onChange={(e) =>
                            setRadDraftsByService((prev) => ({
                              ...prev,
                              [test.serviceId]: { ...draft, criticalFinding: e.target.checked },
                            }))
                          }
                          className="rounded border-rose-400 text-rose-600"
                        />
                        Flag Critical Urgent Radiology Finding (Immediate Physician Alert)
                      </label>
                    </div>
                  )}
                </div>
              );
            }

            const currentInterp = interpByService[test.serviceId] || test.autoInterp;
            return (
              <div key={test.serviceId} className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-blue-700">
                        {test.serviceCode}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{test.serviceName}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {test.department} · {test.methodology} · Target TAT: {test.tatMinutes}m
                      {test.reagentsDeducted && ' · Reagent BOM Deducted'}
                    </div>
                  </div>
                  <div className="text-xs font-mono text-slate-600">
                    Due: {new Date(test.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-white">
                        <th className="py-2.5 px-4">Analyte Parameter</th>
                        <th className="py-2.5 px-4 w-44">Observed Result</th>
                        <th className="py-2.5 px-4">Unit</th>
                        <th className="py-2.5 px-4">Reference Interval ({order.patientGender})</th>
                        <th className="py-2.5 px-4">Clinical Flag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {test.evaluatedParams.map((param) => {
                        const valStr = valuesByService[test.serviceId]?.[param.parameterId] ?? '';
                        const isQual = param.resultType === 'QUALITATIVE';
                        const qualOptions =
                          param.paramDef?.qualitativeOptions &&
                          param.paramDef.qualitativeOptions.length > 0
                            ? param.paramDef.qualitativeOptions
                            : ['Negative', 'Positive'];

                        return (
                          <tr key={param.parameterId} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 font-medium text-slate-900">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span>{param.parameterName}</span>
                                {param.paramDef?.formula && (
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    Auto Formula
                                  </span>
                                )}
                              </div>
                              {param.paramDef?.formula && (
                                <div className="text-[10px] font-mono text-indigo-600 mt-0.5">
                                  = {param.paramDef.formula}
                                </div>
                              )}
                              {isQual && (
                                <div className="text-[10px] font-mono text-slate-400">
                                  Qualitative ({qualOptions.join(' / ')})
                                </div>
                              )}
                            </td>
                            <td className="py-2.5 px-4">
                              {isQual ? (
                                <div className="space-y-1.5">
                                  <select
                                    disabled={isLocked || !canEnterResults}
                                    value={valStr}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      setValuesByService((prev) => ({
                                        ...prev,
                                        [test.serviceId]: {
                                          ...(prev[test.serviceId] || {}),
                                          [param.parameterId]: v,
                                        },
                                      }));
                                    }}
                                    className="w-44 px-2.5 py-1.5 text-xs font-medium border border-slate-300 rounded-md bg-white focus:outline-none focus:border-blue-600 disabled:bg-slate-100"
                                  >
                                    <option value="">-- Select Finding --</option>
                                    {qualOptions.map((opt) => (
                                      <option key={opt} value={opt}>
                                        {opt}
                                      </option>
                                    ))}
                                  </select>
                                  {!isLocked && canEnterResults && qualOptions.length <= 6 && (
                                    <div className="flex flex-wrap gap-1">
                                      {qualOptions.map((opt) => (
                                        <button
                                          key={opt}
                                          type="button"
                                          onClick={() =>
                                            setValuesByService((prev) => ({
                                              ...prev,
                                              [test.serviceId]: {
                                                ...(prev[test.serviceId] || {}),
                                                [param.parameterId]: opt,
                                              },
                                            }))
                                          }
                                          className={`px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                                            valStr === opt
                                              ? 'bg-blue-600 text-white border-blue-600'
                                              : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-100'
                                          }`}
                                        >
                                          {opt}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <input
                                  type="number"
                                  step="any"
                                  disabled={isLocked || !canEnterResults}
                                  value={valStr}
                                  onChange={(e) =>
                                    handleNumericParamChange(
                                      test.serviceId,
                                      param.parameterId,
                                      e.target.value,
                                      test.service
                                    )
                                  }
                                  placeholder={param.paramDef?.formula ? 'Auto-calculated' : 'Enter value'}
                                  className={`w-36 px-2.5 py-1.5 text-sm font-mono tabular-nums border rounded-md focus:outline-none focus:border-blue-600 disabled:bg-slate-100 ${
                                    param.paramDef?.formula
                                      ? 'border-indigo-300 bg-indigo-50/40'
                                      : 'border-slate-300'
                                  }`}
                                />
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-xs font-mono text-slate-600">
                              {param.unit || '—'}
                            </td>
                            <td className="py-2.5 px-4 text-xs font-mono tabular-nums text-slate-600">
                              {param.refRangeDisplay}
                            </td>
                            <td className="py-2.5 px-4">
                              <div className="flex flex-wrap items-center gap-2">
                                {param.value !== null && String(param.value).trim() !== '' ? (
                                  <ResultFlagLabel flag={param.flag} />
                                ) : (
                                  <span className="text-xs text-slate-400">Pending</span>
                                )}
                                {!isLocked && canEnterResults && (
                                  <select
                                    aria-label={`Override clinical status for ${param.parameterName}`}
                                    value={flagOverridesByService[test.serviceId]?.[param.parameterId] || ''}
                                    onChange={(e) => {
                                      const v = e.target.value as ResultFlag | '';
                                      setFlagOverridesByService((prev) => {
                                        const cur = { ...(prev[test.serviceId] || {}) };
                                        if (!v) delete cur[param.parameterId];
                                        else cur[param.parameterId] = v;
                                        return { ...prev, [test.serviceId]: cur };
                                      });
                                    }}
                                    className="px-1.5 py-0.5 text-[11px] border border-slate-300 rounded bg-white text-slate-700"
                                  >
                                    <option value="">Auto</option>
                                    <option value="NORMAL">Normal</option>
                                    <option value="ABNORMAL">Abnormal</option>
                                    <option value="HIGH_RISK">High Risk</option>
                                    <option value="CRITICAL_HIGH">Critical High</option>
                                    <option value="CRITICAL_LOW">Critical Low</option>
                                  </select>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="p-4 bg-slate-50/70 border-t border-slate-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <FlaskConical className="w-3.5 h-3.5 text-blue-600" />
                      Clinical Test Interpretation (Included on A4 Report)
                    </label>
                    {!isLocked && canEnterResults && test.autoInterp && (
                      <button
                        type="button"
                        onClick={() =>
                          setInterpByService((prev) => ({
                            ...prev,
                            [test.serviceId]: test.autoInterp,
                          }))
                        }
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      >
                        <Sparkles className="w-3 h-3" />
                        Refresh Auto-Interpretation
                      </button>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    disabled={isLocked || !canEnterResults}
                    value={currentInterp}
                    onChange={(e) =>
                      setInterpByService((prev) => ({
                        ...prev,
                        [test.serviceId]: e.target.value,
                      }))
                    }
                    placeholder="Enter or auto-generate clinical interpretation for this test panel..."
                    className="w-full px-3 py-2 text-xs text-slate-800 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600 disabled:bg-slate-100"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {canValidateResults
              ? 'Validation deducts linked Reagent / X-Ray Film BOM from Inventory and triggers Auto-Email / API Dispatch.'
              : 'Your role can save draft results/imaging impressions; Pathologist/Radiologist sign-off locks final report.'}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Close
            </button>
            {!isLocked && (canEnterResults || canEditRad) && (
              <button
                type="button"
                disabled={saving || validating}
                onClick={handleSaveResults}
                className="px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-50 whitespace-nowrap"
              >
                {saving
                  ? 'Saving...'
                  : isValidatedStage
                  ? 'Save Amended Report (Audit Logged)'
                  : 'Save Draft Report'}
              </button>
            )}
            {!isValidatedStage && !isLocked && canValidateResults && (
              <button
                type="button"
                disabled={saving || validating}
                onClick={handleValidateAndSignOff}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                {validating ? 'Validating...' : 'Validate & Sign Off Report'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
