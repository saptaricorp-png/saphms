import {
  evaluateParameterFlag,
  evaluateParameterFormulas,
  generateClinicalInterpretation,
} from '../src/utils/clinical';
import type {
  AnalyzerReadingItem,
  LabAnalyzerMachine,
  LabOrder,
  LabServiceTest,
  LimsDatabase,
  TestParameter,
} from '../src/types/lims';

const CODE_ALIASES: Record<string, string[]> = {
  HGB: ['HB', 'HEMOGLOBIN', 'HGB'],
  WBC: ['TLC', 'WBC', 'TOTALWBC'],
  PLT: ['PLATELET', 'PLT'],
  RBC: ['RBC', 'TRBC'],
  HCT: ['PCV', 'HCT', 'HEMATOCRIT'],
  TBIL: ['TBIL', 'BIL_T', 'TOTALBILIRUBIN'],
  DBIL: ['DBIL', 'BIL_D', 'DIRECTBILIRUBIN'],
  AST: ['SGOT', 'AST'],
  ALT: ['SGPT', 'ALT'],
  ALP: ['ALKP', 'ALP'],
  TP: ['TPROT', 'TP', 'TOTALPROTEIN'],
  ALB: ['ALB', 'ALBUMIN'],
  CHOL: ['TC', 'CHOL', 'CHOLESTEROL'],
  HDL: ['HDLC', 'HDL'],
  TRIG: ['TG', 'TRIG', 'TRIGLYCERIDES'],
  CREA: ['CREAT', 'CREA', 'CR', 'SCR'],
  BUN: ['BUN'],
  UREA: ['UREA'],
  URIC: ['UA', 'URIC', 'URICACID'],
  GLU_F: ['FBS', 'GLU', 'GLUC', 'GLU_F'],
  GLU_PP: ['PPBS', 'GLU', 'GLUC', 'GLU_PP'],
  GLU_R: ['RBS', 'GLU', 'GLUC', 'GLU_R'],
  TSH: ['TSH', 'USTSH'],
  FT3: ['FT3'],
  FT4: ['FT4'],
  TT3: ['T3', 'TT3'],
  TT4: ['T4', 'TT4'],
  HBA1C: ['A1C', 'HBA1C'],
  NA: ['NA', 'SODIUM'],
  K: ['K', 'POTASSIUM'],
  CL: ['CL', 'CHLORIDE'],
  ICA: ['ICA', 'CA_ION'],
  CA: ['CA', 'CALCIUM'],
  PHOS: ['PHOS', 'PO4', 'PHOSPHORUS'],
  MG: ['MG', 'MAGNESIUM'],
  CRP: ['CRP', 'HSCRP'],
  TROPI: ['TROPI', 'CTNI', 'TROP_I'],
  PT: ['PT', 'PROTHROMBIN'],
  APTT: ['APTT', 'PTT'],
  VITD: ['VITD', '25OHD'],
  VITB12: ['B12', 'VITB12'],
  FERR: ['FERR', 'FERRITIN'],
};

function normCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, '');
}

function matchReadingToParam(param: TestParameter, readingCode: string): boolean {
  const target = normCode(readingCode);
  if (!target) return false;
  if (param.analyzerCode && normCode(param.analyzerCode) === target) return true;
  if (normCode(param.id) === target || normCode(param.id.replace(/^p-/, '')) === target) return true;
  if (normCode(param.name) === target) return true;
  if (param.analyzerCode) {
    const canon = normCode(param.analyzerCode);
    const aliases = CODE_ALIASES[canon] || [];
    if (aliases.some((a) => normCode(a) === target)) return true;
  }
  return false;
}

export function parseAnalyzerPayload(input: {
  rawPayload?: string;
  accessionNumber?: string;
  readings?: AnalyzerReadingItem[];
  values?: Record<string, number | string>;
}): {
  accessionNumber: string;
  protocol: LabAnalyzerMachine['protocol'];
  readings: AnalyzerReadingItem[];
} {
  let accessionNumber = (input.accessionNumber || '').trim();
  const readings: AnalyzerReadingItem[] = Array.isArray(input.readings)
    ? input.readings.filter((r) => r && r.code && r.value !== undefined && r.value !== '')
    : [];

  if (input.values && typeof input.values === 'object') {
    for (const [k, v] of Object.entries(input.values)) {
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        readings.push({ code: k, value: v });
      }
    }
  }

  const raw = (input.rawPayload || '').trim();
  if (!raw) {
    return { accessionNumber, protocol: 'HTTP_REST', readings };
  }

  // Try JSON string
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw);
      return parseAnalyzerPayload({
        accessionNumber: parsed.accessionNumber || parsed.accession || accessionNumber,
        readings: Array.isArray(parsed.readings) ? parsed.readings : undefined,
        values: parsed.values && typeof parsed.values === 'object' ? parsed.values : undefined,
      });
    } catch {
      // fall through to HL7/ASTM text parsing
    }
  }

  const lines = raw
    .split(/\r?\n|\x0b|\x1c|\x0d/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Detect HL7 v2.x ORU^R01
  if (lines.some((l) => l.startsWith('MSH|') || l.startsWith('OBR|') || l.startsWith('OBX|'))) {
    for (const line of lines) {
      const fields = line.split('|');
      const seg = fields[0];
      if (seg === 'OBR') {
        const cand = (fields[2] || fields[3] || '').split('^')[0]?.trim();
        if (cand && !accessionNumber) accessionNumber = cand;
      } else if (seg === 'PID' && !accessionNumber) {
        const pidCand = (fields[3] || fields[2] || '').split('^')[0]?.trim();
        if (pidCand && pidCand.toUpperCase().includes('SH-')) accessionNumber = pidCand;
      } else if (seg === 'OBX') {
        const obxCode = (fields[3] || '').split('^')[0]?.trim() || (fields[3] || '').split('^')[1]?.trim();
        const obxValRaw = (fields[5] || '').trim();
        const obxUnit = (fields[6] || '').trim();
        const obxFlag = (fields[8] || '').trim();
        if (obxCode && obxValRaw !== '') {
          const numVal = Number(obxValRaw);
          readings.push({
            code: obxCode,
            value: Number.isNaN(numVal) ? obxValRaw : numVal,
            unit: obxUnit || undefined,
            rawFlag: obxFlag || undefined,
          });
        }
      }
    }
    return { accessionNumber, protocol: 'HL7_V2', readings };
  }

  // Detect ASTM E1394
  if (lines.some((l) => l.startsWith('H|') || l.startsWith('O|') || l.startsWith('R|'))) {
    for (const line of lines) {
      const fields = line.split('|');
      const seg = fields[0];
      if (seg === 'O') {
        const cand = (fields[2] || fields[3] || '').split('^')[0]?.trim();
        if (cand && !accessionNumber) accessionNumber = cand;
      } else if (seg === 'R') {
        const compParts = (fields[2] || '').split('^').map((s) => s.trim()).filter(Boolean);
        const code = compParts[compParts.length - 1] || compParts[0] || '';
        const valRaw = (fields[3] || '').trim();
        const unit = (fields[4] || '').trim();
        const rawFlag = (fields[6] || '').trim();
        if (code && valRaw !== '') {
          const numVal = Number(valRaw);
          readings.push({
            code,
            value: Number.isNaN(numVal) ? valRaw : numVal,
            unit: unit || undefined,
            rawFlag: rawFlag || undefined,
          });
        }
      }
    }
    return { accessionNumber, protocol: 'ASTM_E1394', readings };
  }

  // Fallback KEY=VALUE / KEY:VALUE lines
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (key.toUpperCase() === 'ACC' || key.toUpperCase() === 'ACCESSION') {
        if (!accessionNumber) accessionNumber = val;
      } else {
        const numVal = Number(val);
        readings.push({ code: key, value: Number.isNaN(numVal) ? val : numVal });
      }
    }
  }

  return { accessionNumber, protocol: 'SERIAL_RS232', readings };
}

function deterministicUnitSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

export function buildAnalyzerReadingsForOrder(
  order: LabOrder,
  services: LabServiceTest[]
): {
  readings: AnalyzerReadingItem[];
  hl7Frame: string;
} {
  const readings: AnalyzerReadingItem[] = [];
  const seenCodes = new Set<string>();

  for (const t of order.tests) {
    if (t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology') continue;
    const srv = services.find((s) => s.id === t.serviceId);
    if (!srv || !srv.parameters.length) continue;

    for (const p of srv.parameters) {
      if (p.formula && p.formula.trim()) continue;
      const code = p.analyzerCode || p.id.replace(/^p-/, '').toUpperCase();
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);

      if (p.resultType === 'QUALITATIVE') {
        const normalVal =
          p.normalQualitativeValues?.[0] || p.qualitativeOptions?.[0] || 'Negative';
        readings.push({
          code,
          value: normalVal,
          unit: '-',
          rawFlag: 'N',
        });
      } else {
        const min = order.patientGender === 'Female' ? p.refMinFemale : p.refMinMale;
        const max = order.patientGender === 'Female' ? p.refMaxFemale : p.refMaxMale;
        const span = Math.max(0.01, max - min);
        const r = deterministicUnitSeed(`${order.accessionNumber}:${p.id}`);
        // Place most readings physiologically inside ref interval, with occasional slight elevation on secondary index
        const ratio = 0.25 + r * 0.6;
        const val = Number((min + span * ratio).toFixed(p.decimalPlaces ?? 1));
        const flag = evaluateParameterFlag(val, p, order.patientGender);
        readings.push({
          code,
          value: val,
          unit: p.unit,
          rawFlag: flag === 'HIGH' ? 'H' : flag === 'LOW' ? 'L' : 'N',
        });
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const hl7Lines = [
    `MSH|^~\\&|SHPL_ANALYZER|LAB|SHPL_LIMS|HOSPITAL|${stamp}||ORU^R01|MSG${stamp}|P|2.5`,
    `PID|1||${order.uhid || order.accessionNumber}||${order.patientName.replace(/\s+/g, '^')}`,
    `OBR|1|${order.accessionNumber}|${order.accessionNumber}|LAB_PANEL^Hospital Automated Bench`,
    ...readings.map(
      (r, idx) =>
        `OBX|${idx + 1}|${typeof r.value === 'number' ? 'NM' : 'ST'}|${r.code}^${r.code}||${r.value}|${r.unit || ''}|||${r.rawFlag || 'N'}|||F`
    ),
  ];

  return {
    readings,
    hl7Frame: hl7Lines.join('\n'),
  };
}

export function applyReadingsToOrder(
  db: LimsDatabase,
  order: LabOrder,
  readings: AnalyzerReadingItem[]
): {
  appliedCount: number;
  updatedTests: string[];
  hasCritical: boolean;
} {
  const now = new Date().toISOString();
  let appliedCount = 0;
  let hasCritical = false;
  const updatedTests: string[] = [];
  const wasValidatedOrDispatched = order.status === 'Validated' || order.status === 'Dispatched';
  if (wasValidatedOrDispatched) {
    return { appliedCount: 0, updatedTests: [], hasCritical: false };
  }

  for (const orderTest of order.tests) {
    if (orderTest.serviceCategory === 'RADIOLOGY' || orderTest.department === 'Radiology') {
      continue;
    }
    const service = db.services.find((s) => s.id === orderTest.serviceId);
    if (!service || !service.parameters.length) continue;

    // Seed value map with any pre-existing entries
    const valMap: Record<string, number | string | null> = {};
    for (const pr of orderTest.parameterResults) {
      valMap[pr.parameterId] = pr.value;
    }

    let testTouched = false;
    for (const p of service.parameters) {
      if (p.formula && p.formula.trim()) continue;
      const hit = readings.find((r) => matchReadingToParam(p, r.code));
      if (!hit) continue;
      const isQual = p.resultType === 'QUALITATIVE';
      if (isQual) {
        valMap[p.id] = String(hit.value).trim();
      } else {
        const num = Number(hit.value);
        if (!Number.isNaN(num)) {
          valMap[p.id] = Number(num.toFixed(p.decimalPlaces ?? 1));
        }
      }
      testTouched = true;
      appliedCount += 1;
    }

    if (!testTouched) continue;

    const computedValues = evaluateParameterFormulas(service.parameters, valMap);

    orderTest.parameterResults = orderTest.parameterResults.map((pr) => {
      const paramDef = service.parameters.find((p) => p.id === pr.parameterId);
      const isQual = (paramDef?.resultType || pr.resultType) === 'QUALITATIVE';
      const rawVal = computedValues[pr.parameterId];
      const parsedVal: number | string | null = isQual
        ? rawVal === null || rawVal === undefined || String(rawVal).trim() === ''
          ? null
          : String(rawVal).trim()
        : rawVal === null || rawVal === undefined || rawVal === '' || Number.isNaN(Number(rawVal))
        ? null
        : Number(rawVal);

      const flag = paramDef
        ? evaluateParameterFlag(parsedVal, paramDef, order.patientGender)
        : 'NORMAL';
      if (flag === 'CRITICAL_HIGH' || flag === 'CRITICAL_LOW' || flag === 'CRITICAL' || flag === 'HIGH_RISK') {
        hasCritical = true;
      }
      return {
        ...pr,
        resultType: isQual ? 'QUALITATIVE' : 'NUMERIC',
        value: parsedVal,
        flag,
      };
    });

    orderTest.interpretation = generateClinicalInterpretation(service, orderTest.parameterResults);
    const allFilled = orderTest.parameterResults.every(
      (p) => p.value !== null && String(p.value).trim() !== ''
    );
    if (allFilled) {
      orderTest.status = 'Resulted';
    }
    updatedTests.push(orderTest.serviceCode);
  }

  if (appliedCount > 0) {
    if (!order.collectedAt) order.collectedAt = now;
    if (!order.receivedInLabAt) order.receivedInLabAt = now;
    if (order.tests.every((t) => t.status === 'Resulted' || t.status === 'Validated')) {
      order.status = 'Resulted';
      order.resultedAt = now;
    } else if (order.status === 'Ordered' || order.status === 'Collected') {
      order.status = 'In Lab';
    }
  }

  return { appliedCount, updatedTests, hasCritical };
}
