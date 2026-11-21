import crypto from 'node:crypto';
import type { LimsDatabase, StaffMember } from '../types/lims';

const SERVER_FALLBACK_PEPPER = 'SHPL-2083-ATT-HMAC-PEPPER-ROTATE';

export function deriveStaffQrSecret(staff: StaffMember): string {
  if (staff.qrSecret && staff.qrSecret.length >= 16) {
    return staff.qrSecret;
  }
  return crypto
    .createHash('sha256')
    .update(`${staff.id}|${staff.employeeCode}|${SERVER_FALLBACK_PEPPER}`)
    .digest('hex')
    .slice(0, 24);
}

export function getAttendanceIntervalSeconds(db: LimsDatabase): 60 | 90 | 120 {
  const raw = db.settings?.moduleSettings?.attendanceQrIntervalSeconds;
  if (raw === 60 || raw === 90 || raw === 120) return raw;
  return 90; // Default 1.5 minutes (within 1-2 minute rotation window)
}

export function computeSlotMeta(intervalSeconds: number, nowMs = Date.now()): {
  slot: number;
  secondsRemaining: number;
  nextRotateAt: string;
} {
  const windowMs = intervalSeconds * 1000;
  const slot = Math.floor(nowMs / windowMs);
  const elapsedMs = nowMs - slot * windowMs;
  const secondsRemaining = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
  const nextRotateAt = new Date((slot + 1) * windowMs).toISOString();
  return { slot, secondsRemaining, nextRotateAt };
}

export function computeRotatingHmacSignature(
  staff: StaffMember,
  slot: number,
  intervalSeconds: number
): string {
  const secret = deriveStaffQrSecret(staff);
  return crypto
    .createHmac('sha256', secret)
    .update(`${staff.employeeCode}:${staff.id}:${slot}:${intervalSeconds}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

export function generateEmployeeRotatingQrToken(
  staff: StaffMember,
  intervalSeconds: number,
  nowMs = Date.now(),
  slotOffset = 0
): {
  token: string;
  slot: number;
  intervalSeconds: number;
  secondsRemaining: number;
  nextRotateAt: string;
  shortPin: string;
} {
  const meta = computeSlotMeta(intervalSeconds, nowMs);
  const slot = meta.slot + slotOffset;
  const sig = computeRotatingHmacSignature(staff, slot, intervalSeconds);
  const token = `SHPL-QR2:${staff.employeeCode}:${slot}:${sig}`;
  return {
    token,
    slot,
    intervalSeconds,
    secondsRemaining: meta.secondsRemaining,
    nextRotateAt: meta.nextRotateAt,
    shortPin: sig.slice(0, 6),
  };
}

export function verifyRotatingQrSubmission(
  db: LimsDatabase,
  rawToken: string,
  expectedStaff?: StaffMember,
  nowMs = Date.now()
): {
  ok: boolean;
  reason?: string;
  matchedStaff?: StaffMember;
  qrSlot?: number;
  isLegacy?: boolean;
  securityFlag?: 'EXPIRED_QR' | 'TAMPERED_QR' | 'FOREIGN_STAFF_QR' | 'UNKNOWN_TOKEN';
} {
  const cleaned = (rawToken || '').trim();
  const intervalSeconds = getAttendanceIntervalSeconds(db);
  const strictRotating = db.settings?.moduleSettings?.attendanceRequireRotatingQr !== false;
  const graceSec = db.settings?.moduleSettings?.attendanceAllowPreviousSlotGraceSec ?? 15;

  // Format: SHPL-QR2:<EMPLOYEE_CODE>:<SLOT>:<SIG8>
  if (cleaned.toUpperCase().startsWith('SHPL-QR2:')) {
    const parts = cleaned.split(':');
    if (parts.length !== 4) {
      return {
        ok: false,
        reason: 'Malformed rotating attendance QR format.',
        securityFlag: 'TAMPERED_QR',
      };
    }
    const [, empCodeRaw, slotStr, sigRaw] = parts;
    const slotNum = Number(slotStr);
    const sigUpper = (sigRaw || '').trim().toUpperCase();
    const staff = db.staff.find(
      (s) => s.employeeCode.toLowerCase() === empCodeRaw.trim().toLowerCase()
    );
    if (!staff) {
      return {
        ok: false,
        reason: `No employee found for code ${empCodeRaw}.`,
        securityFlag: 'UNKNOWN_TOKEN',
      };
    }
    if (expectedStaff && expectedStaff.id !== staff.id) {
      return {
        ok: false,
        reason: `Security mismatch: QR belongs to ${staff.fullName} (${staff.employeeCode}), not ${expectedStaff.fullName}.`,
        matchedStaff: staff,
        securityFlag: 'FOREIGN_STAFF_QR',
      };
    }
    if (!Number.isFinite(slotNum)) {
      return { ok: false, reason: 'Invalid QR slot timestamp.', securityFlag: 'TAMPERED_QR' };
    }

    const windowMs = intervalSeconds * 1000;
    const currentSlot = Math.floor(nowMs / windowMs);
    const elapsedInCurrentSec = (nowMs - currentSlot * windowMs) / 1000;

    const expectedCurrentSig = computeRotatingHmacSignature(staff, currentSlot, intervalSeconds);
    const expectedPrevSig = computeRotatingHmacSignature(staff, currentSlot - 1, intervalSeconds);

    if (slotNum === currentSlot && sigUpper === expectedCurrentSig) {
      return { ok: true, matchedStaff: staff, qrSlot: slotNum };
    }
    if (
      slotNum === currentSlot - 1 &&
      elapsedInCurrentSec <= graceSec &&
      sigUpper === expectedPrevSig
    ) {
      return { ok: true, matchedStaff: staff, qrSlot: slotNum };
    }

    // Check if it was a valid signature for an older expired slot (replay/screenshot attempt)
    const testOldSig = computeRotatingHmacSignature(staff, slotNum, intervalSeconds);
    if (sigUpper === testOldSig && slotNum < currentSlot) {
      return {
        ok: false,
        matchedStaff: staff,
        reason: `Expired QR code (slot #${slotNum}). Scan the live ${intervalSeconds}s rotating QR displayed on Hospital Manager Dashboard or TV.`,
        securityFlag: 'EXPIRED_QR',
      };
    }

    return {
      ok: false,
      matchedStaff: staff,
      reason: 'Invalid cryptographic signature on rotating attendance QR.',
      securityFlag: 'TAMPERED_QR',
    };
  }

  // Legacy static QR or employee code fallback (blocked when strict rotating QR is enabled)
  const lower = cleaned.toLowerCase();
  const matchedLegacy = db.staff.find(
    (s) =>
      `saptari-staff-${s.employeeCode}-${s.id}`.toLowerCase() === lower ||
      s.employeeCode.toLowerCase() === lower
  );

  if (matchedLegacy) {
    if (strictRotating) {
      return {
        ok: false,
        matchedStaff: matchedLegacy,
        reason:
          'Static badge QR is disabled by Attendance Security Policy. Scan the live 60–120s rotating QR code on the Manager Dashboard or Hospital TV.',
        securityFlag: 'EXPIRED_QR',
      };
    }
    if (expectedStaff && expectedStaff.id !== matchedLegacy.id) {
      return {
        ok: false,
        matchedStaff: matchedLegacy,
        reason: `Badge belongs to ${matchedLegacy.fullName}, not ${expectedStaff.fullName}.`,
        securityFlag: 'FOREIGN_STAFF_QR',
      };
    }
    return { ok: true, matchedStaff: matchedLegacy, isLegacy: true };
  }

  return {
    ok: false,
    reason: 'Unrecognized attendance QR code.',
    securityFlag: 'UNKNOWN_TOKEN',
  };
}

export function evaluateShiftCompliance(
  shiftLabel: string,
  punchType: 'CHECK_IN' | 'CHECK_OUT',
  now = new Date()
): { isLate: boolean; lateMinutes: number; shiftComplianceNote: string } {
  const minsOfDay = now.getHours() * 60 + now.getMinutes();
  const s = (shiftLabel || '').toLowerCase();
  let startMin = 7 * 60; // Morning 07:00
  let endMin = 15 * 60; // 15:00
  if (s.includes('afternoon') || s.includes('14:00')) {
    startMin = 14 * 60;
    endMin = 22 * 60;
  } else if (s.includes('night') || s.includes('21:30')) {
    startMin = 21 * 60 + 30;
    endMin = 7 * 60 + 30;
  }

  if (punchType === 'CHECK_IN') {
    const diff = minsOfDay - startMin;
    if (diff > 15 && diff < 360) {
      return {
        isLate: true,
        lateMinutes: diff,
        shiftComplianceNote: `Late check-in (+${diff} min vs ${shiftLabel})`,
      };
    }
    return {
      isLate: false,
      lateMinutes: 0,
      shiftComplianceNote: `On-Time Check-In (${shiftLabel})`,
    };
  }

  // CHECK_OUT
  const beforeEnd = endMin - minsOfDay;
  if (beforeEnd > 15 && beforeEnd < 300) {
    return {
      isLate: false,
      lateMinutes: 0,
      shiftComplianceNote: `Early check-out (-${beforeEnd} min before shift end)`,
    };
  }
  return {
    isLate: false,
    lateMinutes: 0,
    shiftComplianceNote: `Shift Completed (${shiftLabel})`,
  };
}
