import type {
  IpdAdmission,
  LabOrder,
  LabServiceTest,
  ModuleSettingsConfig,
  ParameterResult,
  PatientGender,
  ResultFlag,
  TestParameter,
} from '../types/lims';
import { adToBs } from './nepaliDate';

export function getRefRange(
  param: TestParameter,
  gender: PatientGender
): { min: number; max: number; display: string } {
  if (param.resultType === 'QUALITATIVE') {
    const normals =
      param.normalQualitativeValues && param.normalQualitativeValues.length > 0
        ? param.normalQualitativeValues
        : [param.qualitativeOptions?.[0] || 'Negative'];
    return {
      min: 0,
      max: 0,
      display: normals.join(' / '),
    };
  }
  const min = gender === 'Female' ? param.refMinFemale : param.refMinMale;
  const max = gender === 'Female' ? param.refMaxFemale : param.refMaxMale;
  const dp = param.decimalPlaces ?? 1;
  return {
    min,
    max,
    display: `${min.toFixed(dp)} - ${max.toFixed(dp)}`,
  };
}

export function evaluateParameterFlag(
  value: number | string | null,
  param: TestParameter,
  gender: PatientGender
): ResultFlag {
  if (param.resultType === 'QUALITATIVE') {
    if (value === null || value === undefined || String(value).trim() === '') return 'NORMAL';
    const strVal = String(value).trim().toLowerCase();
    if (
      param.criticalQualitativeValues &&
      param.criticalQualitativeValues.some((c) => c.trim().toLowerCase() === strVal)
    ) {
      return 'CRITICAL';
    }
    const normals =
      param.normalQualitativeValues && param.normalQualitativeValues.length > 0
        ? param.normalQualitativeValues
        : [param.qualitativeOptions?.[0] || 'Negative'];
    if (normals.some((n) => n.trim().toLowerCase() === strVal)) {
      return 'NORMAL';
    }
    return 'ABNORMAL';
  }

  if (value === null || value === undefined || value === '') return 'NORMAL';
  const numVal = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(numVal)) return 'NORMAL';
  if (param.criticalLow !== undefined && numVal <= param.criticalLow) return 'CRITICAL_LOW';
  if (param.criticalHigh !== undefined && numVal >= param.criticalHigh) return 'CRITICAL_HIGH';
  const { min, max } = getRefRange(param, gender);
  if (numVal < min) return 'LOW';
  if (numVal > max) return 'HIGH';
  return 'NORMAL';
}

export function generateClinicalInterpretation(
  service: LabServiceTest,
  results: ParameterResult[]
): string {
  const entered = results.filter(
    (r) => r.value !== null && r.value !== undefined && String(r.value).trim() !== ''
  );
  if (entered.length === 0) return '';

  const criticals = entered.filter(
    (r) =>
      r.flag === 'CRITICAL_LOW' ||
      r.flag === 'CRITICAL_HIGH' ||
      r.flag === 'CRITICAL' ||
      r.flag === 'HIGH_RISK'
  );
  const lows = entered.filter((r) => r.flag === 'LOW');
  const highs = entered.filter((r) => r.flag === 'HIGH');
  const abnormals = entered.filter((r) => r.flag === 'ABNORMAL');

  if (criticals.length > 0) {
    const list = criticals
      .map((r) => {
        const unitPart = r.unit && r.unit !== '-' ? ` ${r.unit}` : '';
        const lbl =
          r.flag === 'CRITICAL_LOW'
            ? 'Critical Low'
            : r.flag === 'CRITICAL_HIGH'
            ? 'Critical High'
            : r.flag === 'HIGH_RISK'
            ? 'High Risk'
            : 'Critical';
        return `${r.parameterName}: ${r.value}${unitPart} (${lbl})`;
      })
      .join('; ');
    return `${service.interpretations.critical} Flagged analytes: ${list}.`;
  }

  if (abnormals.length > 0 || highs.length > 0 || lows.length > 0) {
    const parts: string[] = [];
    if (abnormals.length > 0) {
      parts.push(
        `Positive/Abnormal qualitative finding(s): ${abnormals
          .map((r) => `${r.parameterName}: ${r.value}`)
          .join(', ')}`
      );
    }
    if (highs.length > 0) {
      parts.push(
        `Elevated: ${highs.map((r) => `${r.parameterName} (${r.value} ${r.unit})`).join(', ')}`
      );
    }
    if (lows.length > 0) {
      parts.push(
        `Decreased: ${lows.map((r) => `${r.parameterName} (${r.value} ${r.unit})`).join(', ')}`
      );
    }
    const baseNote =
      highs.length > 0 || abnormals.length > 0
        ? service.interpretations.abnormalHigh
        : service.interpretations.abnormalLow;
    return `${parts.join('; ')}. ${baseNote}`;
  }

  return service.interpretations.normal;
}

export interface TatMetrics {
  status: 'Completed On Time' | 'Completed Late' | 'On Track' | 'At Risk' | 'Breached';
  label: string;
  minutesRemaining: number;
  elapsedMinutes: number;
  targetMinutes: number;
  percentUsed: number;
}

export function computeOrderTat(order: LabOrder, nowMs: number = Date.now()): TatMetrics {
  const orderedMs = new Date(order.orderedAt).getTime();
  const dueMs = new Date(order.dueAt).getTime();
  const targetMinutes = Math.max(1, Math.round((dueMs - orderedMs) / 60000));

  if ((order.status === 'Validated' || order.status === 'Dispatched') && order.validatedAt) {
    const doneMs = new Date(order.validatedAt).getTime();
    const elapsedMinutes = Math.max(1, Math.round((doneMs - orderedMs) / 60000));
    const diffMin = Math.round((dueMs - doneMs) / 60000);
    const percentUsed = Math.min(150, Math.round((elapsedMinutes / targetMinutes) * 100));
    if (diffMin >= 0) {
      return {
        status: 'Completed On Time',
        label: `Done ${formatDurationShort(elapsedMinutes)} (${formatDurationShort(diffMin)} under SLA)`,
        minutesRemaining: diffMin,
        elapsedMinutes,
        targetMinutes,
        percentUsed,
      };
    }
    return {
      status: 'Completed Late',
      label: `Done ${formatDurationShort(elapsedMinutes)} (+${formatDurationShort(Math.abs(diffMin))} over SLA)`,
      minutesRemaining: diffMin,
      elapsedMinutes,
      targetMinutes,
      percentUsed,
    };
  }

  const elapsedMinutes = Math.max(0, Math.round((nowMs - orderedMs) / 60000));
  const minutesRemaining = Math.round((dueMs - nowMs) / 60000);
  const percentUsed = Math.min(200, Math.round((elapsedMinutes / targetMinutes) * 100));

  if (minutesRemaining < 0) {
    return {
      status: 'Breached',
      label: `Overdue by ${formatDurationShort(Math.abs(minutesRemaining))}`,
      minutesRemaining,
      elapsedMinutes,
      targetMinutes,
      percentUsed,
    };
  }

  if (minutesRemaining <= targetMinutes * 0.25 || minutesRemaining <= 35) {
    return {
      status: 'At Risk',
      label: `${formatDurationShort(minutesRemaining)} left`,
      minutesRemaining,
      elapsedMinutes,
      targetMinutes,
      percentUsed,
    };
  }

  return {
    status: 'On Track',
    label: `${formatDurationShort(minutesRemaining)} left`,
    minutesRemaining,
    elapsedMinutes,
    targetMinutes,
    percentUsed,
  };
}

export function formatDurationShort(totalMinutes: number): string {
  const mins = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/**
 * Safe recursive-descent arithmetic evaluator for clinical formula strings
 * e.g. "{p-tbil} - {p-dbil}" or "{p-chol} - {p-hdl} - ({p-tg} / 5)"
 * Zero eval() or new Function() used.
 */
function parseArithmeticExpression(expr: string): number | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = '';
      while (i < expr.length && /[0-9.]/.test(expr[i])) {
        numStr += expr[i];
        i += 1;
      }
      tokens.push(numStr);
      continue;
    }
    return null;
  }

  let pos = 0;
  const peek = () => tokens[pos];
  const consume = () => tokens[pos++];

  const parseExpr = (): number | null => {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === '+' || peek() === '-') {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): number | null => {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === '*' || peek() === '/') {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;
      if (op === '/') {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  };

  const parseFactor = (): number | null => {
    const t = peek();
    if (!t) return null;
    if (t === '+') {
      consume();
      return parseFactor();
    }
    if (t === '-') {
      consume();
      const inner = parseFactor();
      return inner === null ? null : -inner;
    }
    if (t === '(') {
      consume();
      const inner = parseExpr();
      if (peek() !== ')') return null;
      consume();
      return inner;
    }
    consume();
    const val = Number(t);
    return Number.isFinite(val) ? val : null;
  };

  const result = parseExpr();
  if (result === null || pos !== tokens.length || !Number.isFinite(result)) {
    return null;
  }
  return result;
}

export function evaluateParameterFormulas(
  parameters: TestParameter[],
  rawValues: Record<string, number | string | null>
): Record<string, number | string | null> {
  const next: Record<string, number | string | null> = { ...rawValues };
  // Build lookup maps by parameter id and normalized short/name tokens
  const resolveTokenValue = (token: string): number | null => {
    const trimmed = token.trim();
    const direct = next[trimmed];
    if (direct !== undefined && direct !== null && direct !== '' && !Number.isNaN(Number(direct))) {
      return Number(direct);
    }
    const lower = trimmed.toLowerCase();
    const matchedParam = parameters.find(
      (p) =>
        p.id.toLowerCase() === lower ||
        p.name.toLowerCase() === lower ||
        p.id.toLowerCase().replace(/^p-/, '') === lower
    );
    if (matchedParam) {
      const val = next[matchedParam.id];
      if (val !== undefined && val !== null && val !== '' && !Number.isNaN(Number(val))) {
        return Number(val);
      }
    }
    return null;
  };

  // Run 2 passes to support chained formulas (e.g. VLDL then LDL)
  for (let pass = 0; pass < 2; pass++) {
    for (const p of parameters) {
      if (!p.formula || !p.formula.trim()) continue;
      let missingDep = false;
      const expanded = p.formula.replace(/\{([^}]+)\}/g, (_m, tok: string) => {
        const num = resolveTokenValue(tok);
        if (num === null) {
          missingDep = true;
          return 'NaN';
        }
        return String(num);
      });
      if (missingDep) continue;
      const computed = parseArithmeticExpression(expanded);
      if (computed !== null) {
        const dp = p.decimalPlaces ?? 1;
        next[p.id] = Number(computed.toFixed(dp));
      }
    }
  }
  return next;
}

/**
 * Automatically computes hospital bed days from admission timestamp up to endAt (or now),
 * anchored to the hospital's configured IPD bed cycle start time (e.g. "07:00").
 * Minimum stay is always 1 bed day; each new cycle boundary crossed increments bed days by 1.
 */
export function calculateAutoBedDays(
  admittedAt: string,
  endAt?: string,
  cycleStart: string = '07:00',
  _cycleEnd: string = '19:00',
  scheduleMode: 'CYCLE_WINDOW' | '24H_ELAPSED' | 'MIDNIGHT_CALENDAR' = 'CYCLE_WINDOW'
): number {
  const admDate = new Date(admittedAt);
  const endDate = endAt ? new Date(endAt) : new Date();
  const admMs = admDate.getTime();
  const endMs = endDate.getTime();
  if (!Number.isFinite(admMs) || !Number.isFinite(endMs) || endMs <= admMs) {
    return 1;
  }

  if (scheduleMode === '24H_ELAPSED') {
    const hours = (endMs - admMs) / (3600 * 1000);
    return Math.max(1, Math.ceil(hours / 24));
  }

  if (scheduleMode === 'MIDNIGHT_CALENDAR') {
    const d1 = new Date(admDate.getFullYear(), admDate.getMonth(), admDate.getDate()).getTime();
    const d2 = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
    const diffDays = Math.round((d2 - d1) / (24 * 3600 * 1000)) + 1;
    return Math.max(1, diffDays);
  }

  const [hStr, mStr] = (cycleStart || '07:00').split(':');
  const cycleHour = Math.min(23, Math.max(0, Number(hStr) || 7));
  const cycleMin = Math.min(59, Math.max(0, Number(mStr) || 0));

  const boundary = new Date(admMs);
  boundary.setHours(cycleHour, cycleMin, 0, 0);
  while (boundary.getTime() <= admMs) {
    boundary.setDate(boundary.getDate() + 1);
  }
  // Grace window: if admitted within 4 hours prior to morning cycle reset, do not double-charge day 1 immediately
  if (boundary.getTime() - admMs < 4 * 3600 * 1000) {
    boundary.setDate(boundary.getDate() + 1);
  }

  let days = 1;
  while (boundary.getTime() <= endMs && days < 3650) {
    days += 1;
    boundary.setDate(boundary.getDate() + 1);
  }
  return Math.max(1, days);
}

export interface IpdDailyCycleDetail {
  dayNumber: number;
  startIso: string;
  endIso: string;
  startBsLabel: string;
  endBsLabel: string;
  bedFeeNpr: number;
  nursingFeeNpr: number;
  observationFeeNpr: number;
  doctorRoundFeeNpr: number;
  daySubtotalNpr: number;
}

export interface IpdAutoChargesSummary {
  cycleStart: string;
  cycleEnd: string;
  cycleWindowLabel: string;
  bedScheduleMode: 'CYCLE_WINDOW' | '24H_ELAPSED' | 'MIDNIGHT_CALENDAR';
  admittedAtIso: string;
  billedTillIso: string;
  admittedBsLabel: string;
  billedTillBsLabel: string;
  autoDaysCount: number;
  bedDaysBilled: number;
  bedDailyRateNpr: number;
  bedChargesNpr: number;
  doctorRoundsCount: number;
  doctorRoundFeeNpr: number;
  doctorRoundBasis: 'PER_DAY' | 'PER_ROUND';
  doctorRoundsPerDay: number;
  doctorRoundScheduleLabel: string;
  doctorRoundChargesNpr: number;
  nursingDaysBilled: number;
  nursingChargePerDayNpr: number;
  nursingBasis: 'PER_DAY' | 'PER_ROUND';
  nursingRoundsPerDay: number;
  nursingScheduleLabel: string;
  nursingChargesNpr: number;
  observationDaysBilled: number;
  observationFeePerDayNpr: number;
  observationBasis: 'PER_DAY' | 'PER_ROUND';
  observationRoundsPerDay: number;
  observationScheduleLabel: string;
  autoObservationChargesNpr: number;
  shiftObservationChargesNpr: number;
  directProcedureChargesNpr: number;
  individualCashPaidTotalNpr: number;
  admissionFeeNpr: number;
  dailyAutoTotalNpr: number;
  dailyBreakdown: IpdDailyCycleDetail[];
}

export function computeIpdDailyAutoCharges(
  adm: IpdAdmission,
  ms?: Partial<ModuleSettingsConfig>,
  endAtIso?: string,
  overrides?: {
    bedDaysBilled?: number;
    doctorRoundsCount?: number;
    nursingDaysBilled?: number;
    observationDaysBilled?: number;
  }
): IpdAutoChargesSummary {
  const cycleStart = ms?.ipdBedCycleStartTime || '07:00';
  const cycleEnd = ms?.ipdBedCycleEndTime || '19:00';
  const bedScheduleMode = ms?.ipdBedChargeScheduleMode || 'CYCLE_WINDOW';
  const cycleWindowLabel =
    bedScheduleMode === '24H_ELAPSED'
      ? `24h Exact (${cycleStart} ref)`
      : bedScheduleMode === 'MIDNIGHT_CALENDAR'
      ? 'Calendar Midnight (00:00)'
      : `${cycleStart} - ${cycleEnd}`;

  const effectiveEndIso = endAtIso || adm.dischargedAt || new Date().toISOString();
  const autoDays = calculateAutoBedDays(adm.admittedAt, effectiveEndIso, cycleStart, cycleEnd, bedScheduleMode);
  const isActive = adm.disposition === 'Admitted';

  const doctorRoundBasis: 'PER_DAY' | 'PER_ROUND' = ms?.ipdDoctorRoundBasis || 'PER_ROUND';
  const doctorRoundsPerDay = Math.max(1, Number(ms?.ipdDoctorRoundsPerDay) || 1);
  const doctorRoundScheduleLabel = ms?.ipdDoctorRoundScheduleTimes?.trim() || '09:00, 18:00';

  const nursingBasis: 'PER_DAY' | 'PER_ROUND' = ms?.ipdNursingChargeBasis || 'PER_DAY';
  const nursingRoundsPerDay = Math.max(1, Number(ms?.ipdNursingRoundsPerDay) || 1);
  const nursingScheduleLabel = ms?.ipdNursingScheduleTimes?.trim() || '07:00, 14:00, 21:00';

  const observationBasis: 'PER_DAY' | 'PER_ROUND' = ms?.ipdObservationChargeBasis || 'PER_DAY';
  const observationRoundsPerDay = Math.max(1, Number(ms?.ipdObservationRoundsPerDay) || 1);
  const observationScheduleLabel = ms?.ipdObservationScheduleTimes?.trim() || '08:00, 20:00';

  const defaultDoctorUnits = doctorRoundBasis === 'PER_ROUND' ? autoDays * doctorRoundsPerDay : autoDays;
  const defaultNursingUnits = nursingBasis === 'PER_ROUND' ? autoDays * nursingRoundsPerDay : autoDays;
  const defaultObsUnits = observationBasis === 'PER_ROUND' ? autoDays * observationRoundsPerDay : autoDays;

  const bedDaysBilled = Math.max(
    1,
    overrides?.bedDaysBilled !== undefined
      ? overrides.bedDaysBilled
      : isActive
      ? autoDays
      : adm.bedDaysBilled || autoDays
  );
  const doctorRoundsCount = Math.max(
    0,
    overrides?.doctorRoundsCount !== undefined
      ? overrides.doctorRoundsCount
      : isActive
      ? defaultDoctorUnits
      : adm.doctorRoundsCount ?? defaultDoctorUnits
  );
  const nursingDaysBilled = Math.max(
    0,
    overrides?.nursingDaysBilled !== undefined
      ? overrides.nursingDaysBilled
      : isActive
      ? defaultNursingUnits
      : adm.nursingDaysBilled ?? defaultNursingUnits
  );
  const observationDaysBilled = Math.max(
    0,
    overrides?.observationDaysBilled !== undefined
      ? overrides.observationDaysBilled
      : isActive
      ? defaultObsUnits
      : adm.autoObservationDaysBilled ?? defaultObsUnits
  );

  const bedDailyRateNpr = Number(adm.bedDailyRateNpr) || 0;
  const doctorRoundFeeNpr =
    ms?.ipdDoctorRoundFeeNpr !== undefined
      ? Number(ms.ipdDoctorRoundFeeNpr)
      : Number(adm.doctorRoundFeeNpr ?? 500);
  const nursingChargePerDayNpr =
    ms?.ipdNursingChargePerDayNpr !== undefined
      ? Number(ms.ipdNursingChargePerDayNpr)
      : Number(adm.nursingChargePerDayNpr ?? 400);
  const observationFeePerDayNpr =
    ms?.ipdDailyObservationFeeNpr !== undefined
      ? Number(ms.ipdDailyObservationFeeNpr)
      : Number(adm.autoObservationFeePerDayNpr ?? 300);

  const bedChargesNpr = Number((bedDaysBilled * bedDailyRateNpr).toFixed(2));
  const doctorRoundChargesNpr = Number((doctorRoundsCount * doctorRoundFeeNpr).toFixed(2));
  const nursingChargesNpr = Number((nursingDaysBilled * nursingChargePerDayNpr).toFixed(2));
  const autoObservationChargesNpr = Number((observationDaysBilled * observationFeePerDayNpr).toFixed(2));
  const shiftObservationChargesNpr = Number(
    (adm.nursingObservationFees || [])
      .reduce((sum, item) => sum + (Number(item.feeNpr) || 0), 0)
      .toFixed(2)
  );
  const directProcedureChargesNpr = Number(
    (adm.directServiceCharges || [])
      .reduce((sum, item) => sum + (Number(item.amountNpr) || 0), 0)
      .toFixed(2)
  );
  const individualCashPaidTotalNpr = Number(
    (adm.ipdIndividualBills || [])
      .reduce((sum, b) => sum + (Number(b.amountNpr) || 0), 0)
      .toFixed(2)
  );
  const admissionFeeNpr = Number(adm.admissionFeeNpr) || 0;

  // Build cycle-by-cycle timing breakdown aligned to hospital bed cycle start time
  const [hStr, mStr] = (cycleStart || '07:00').split(':');
  const cycleHour = Math.min(23, Math.max(0, Number(hStr) || 7));
  const cycleMin = Math.min(59, Math.max(0, Number(mStr) || 0));

  const admMs = new Date(adm.admittedAt).getTime();
  const endMs = new Date(effectiveEndIso).getTime();
  const safeAdmMs = Number.isFinite(admMs) ? admMs : Date.now();
  const safeEndMs = Number.isFinite(endMs) && endMs >= safeAdmMs ? endMs : safeAdmMs;

  const firstBoundary = new Date(safeAdmMs);
  firstBoundary.setHours(cycleHour, cycleMin, 0, 0);
  while (firstBoundary.getTime() <= safeAdmMs) {
    firstBoundary.setDate(firstBoundary.getDate() + 1);
  }
  if (bedScheduleMode === 'CYCLE_WINDOW' && firstBoundary.getTime() - safeAdmMs < 4 * 3600 * 1000) {
    firstBoundary.setDate(firstBoundary.getDate() + 1);
  }

  const totalScheduleRows = Math.max(1, bedDaysBilled);

  const dailyBreakdown: IpdDailyCycleDetail[] = [];
  let cursorStartMs = safeAdmMs;
  let cursorBoundaryMs = firstBoundary.getTime();

  // Distribute per-day / per-round nursing, obs, and doctor rounds cleanly across stay days
  const nursingDayCharge = nursingChargesNpr / totalScheduleRows;
  const obsDayCharge = autoObservationChargesNpr / totalScheduleRows;
  const drDayCharge = doctorRoundChargesNpr / totalScheduleRows;

  for (let i = 1; i <= totalScheduleRows; i++) {
    const isLast = i === totalScheduleRows;
    const sliceEndMs = isLast
      ? Math.max(cursorStartMs, safeEndMs)
      : Math.min(cursorBoundaryMs, safeEndMs);

    const startIso = new Date(cursorStartMs).toISOString();
    const endSliceIso = new Date(sliceEndMs).toISOString();
    const sBs = adToBs(startIso);
    const eBs = adToBs(endSliceIso);

    const bFee = i <= bedDaysBilled ? bedDailyRateNpr : 0;
    const nFee = Number(nursingDayCharge.toFixed(2));
    const oFee = Number(obsDayCharge.toFixed(2));
    const dFee = Number(drDayCharge.toFixed(2));

    dailyBreakdown.push({
      dayNumber: i,
      startIso,
      endIso: endSliceIso,
      startBsLabel: `${sBs.formattedEn} ${sBs.timeEn}`,
      endBsLabel: `${eBs.formattedEn} ${eBs.timeEn}`,
      bedFeeNpr: bFee,
      nursingFeeNpr: nFee,
      observationFeeNpr: oFee,
      doctorRoundFeeNpr: dFee,
      daySubtotalNpr: Number((bFee + nFee + oFee + dFee).toFixed(2)),
    });

    cursorStartMs = sliceEndMs;
    const nextB = new Date(cursorBoundaryMs);
    nextB.setDate(nextB.getDate() + 1);
    cursorBoundaryMs = nextB.getTime();
  }

  const admBs = adToBs(new Date(safeAdmMs).toISOString());
  const tillBs = adToBs(new Date(safeEndMs).toISOString());

  return {
    cycleStart,
    cycleEnd,
    cycleWindowLabel,
    bedScheduleMode,
    admittedAtIso: new Date(safeAdmMs).toISOString(),
    billedTillIso: new Date(safeEndMs).toISOString(),
    admittedBsLabel: `${admBs.formattedEn} ${admBs.timeEn}`,
    billedTillBsLabel: `${tillBs.formattedEn} ${tillBs.timeEn}`,
    autoDaysCount: autoDays,
    bedDaysBilled,
    bedDailyRateNpr,
    bedChargesNpr,
    doctorRoundsCount,
    doctorRoundFeeNpr,
    doctorRoundBasis,
    doctorRoundsPerDay,
    doctorRoundScheduleLabel,
    doctorRoundChargesNpr,
    nursingDaysBilled,
    nursingChargePerDayNpr,
    nursingBasis,
    nursingRoundsPerDay,
    nursingScheduleLabel,
    nursingChargesNpr,
    observationDaysBilled,
    observationFeePerDayNpr,
    observationBasis,
    observationRoundsPerDay,
    observationScheduleLabel,
    autoObservationChargesNpr,
    shiftObservationChargesNpr,
    directProcedureChargesNpr,
    individualCashPaidTotalNpr,
    admissionFeeNpr,
    dailyAutoTotalNpr: Number(
      (bedChargesNpr + doctorRoundChargesNpr + nursingChargesNpr + autoObservationChargesNpr).toFixed(2)
    ),
    dailyBreakdown,
  };
}



