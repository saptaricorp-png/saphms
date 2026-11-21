export function autoCapitalizeTitleCase(value: string): string {
  if (!value) return value;
  return value.replace(/(^|\s+)([a-z\u00e0-\u00ff])/g, (_, leadingSpace: string, ch: string) => {
    return `${leadingSpace}${ch.toUpperCase()}`;
  });
}

/**
 * Strict Person / Patient Name formatter:
 * 1. Immediately deletes all symbols (!, @, #, $, %, &, *, ., -, digits, punctuation).
 * 2. Capitalizes the first character and the first character after every space.
 */
export function sanitizePersonName(value: string): string {
  if (!value) return '';
  // Keep only Unicode letters (Latin + Devanagari/Nepali) and spaces
  const lettersAndSpaces = value
    .replace(/[^\p{L}\s]/gu, '')
    .replace(/^\s+/, '')
    .replace(/\s{2,}/g, ' ');
  return autoCapitalizeTitleCase(lettersAndSpaces);
}

export function isStrictNameField(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.dataset.strictName === 'true') return true;
  if (el.dataset.strictName === 'false' || el.tagName === 'TEXTAREA') return false;
  const input = el as HTMLInputElement;
  const hint = `${input.name || ''} ${input.id || ''} ${input.placeholder || ''}`.toLowerCase();
  if (
    hint.includes('email') ||
    hint.includes('username') ||
    hint.includes('password') ||
    hint.includes('address') ||
    hint.includes('hospital') ||
    hint.includes('company') ||
    hint.includes('supplier') ||
    hint.includes('medicine') ||
    hint.includes('test') ||
    hint.includes('search') ||
    hint.includes('complaint') ||
    hint.includes('diagnosis') ||
    hint.includes('remark') ||
    hint.includes('note') ||
    hint.includes('subject')
  ) {
    return false;
  }
  return (
    hint.includes('patient name') ||
    hint.includes('full name') ||
    hint.includes('mother name') ||
    hint.includes('father') ||
    hint.includes('guardian') ||
    hint.includes('brought by') ||
    hint.includes('driver name') ||
    hint.includes('manager name') ||
    hint.includes('contact person') ||
    hint.includes('attending doctor')
  );
}

export function stripCountryPrefixForEdit(phone?: string | null): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed || trimmed === '+977-98' || trimmed === '+97798' || trimmed === '+977-' || trimmed === '+977') {
    return '';
  }
  return trimmed.replace(/^\+?977[-\s]?/, '').trim();
}

export function normalizeNepalPhone(raw?: string | null): string {
  if (!raw) return '';
  const cleaned = raw.trim();
  if (!cleaned || cleaned === '+977-98' || trimmedEmpty(cleaned)) {
    return '';
  }
  const digitsOnly = cleaned.replace(/[^\d]/g, '');
  if (!digitsOnly) return '';
  if (digitsOnly.startsWith('977') && digitsOnly.length >= 12) {
    return `+977-${digitsOnly.slice(3)}`;
  }
  if (digitsOnly.length === 10 && (digitsOnly.startsWith('9') || digitsOnly.startsWith('0'))) {
    return `+977-${digitsOnly}`;
  }
  if (digitsOnly.length >= 7 && digitsOnly.length <= 10 && !cleaned.startsWith('+')) {
    return `+977-${digitsOnly}`;
  }
  return cleaned.startsWith('+') ? cleaned : `+977-${digitsOnly}`;
}

function trimmedEmpty(cleaned: string): boolean {
  return cleaned === '+977-98' || cleaned === '+97798' || cleaned === '+977-' || cleaned === '+977';
}

export function isEligibleAutoCapInput(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.dataset.noAutocap === 'true') return false;
  if (el.readOnly || el.disabled) return false;
  if (el.tagName === 'TEXTAREA') return true;
  const input = el as HTMLInputElement;
  const allowedTypes = new Set(['text', 'search', '']);
  if (!allowedTypes.has((input.type || 'text').toLowerCase())) return false;
  const nameHint = `${input.name || ''} ${input.id || ''} ${input.placeholder || ''}`.toLowerCase();
  if (
    nameHint.includes('email') ||
    nameHint.includes('password') ||
    nameHint.includes('username') ||
    nameHint.includes('webhook') ||
    nameHint.includes('url') ||
    nameHint.includes('uhid') ||
    nameHint.includes('code') ||
    nameHint.includes('pin') ||
    nameHint.includes('prefix')
  ) {
    return false;
  }
  return true;
}
