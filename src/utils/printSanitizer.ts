/**
 * Strips software developer credits ("Engineered & Developed by ...", "Designed and developed by ...", "Developed by ...")
 * from printable reports, bills, receipts, and exported PDFs while ALWAYS preserving the registered hospital/pharmacy business name.
 */
export function sanitizePrintText(input?: string | null, fallback = ''): string {
  if (!input) return fallback;
  let cleaned = String(input)
    .replace(/Designed\s*(?:&|and)\s*developed\s*by\s*[^·|\n)]*/gi, '')
    .replace(/Engineered\s*&\s*Developed\s*by\s*[^·|\n)]*/gi, '')
    .replace(/Developed\s*by\s*[^·|\n)]*/gi, '')
    .replace(/\(\s*\)/g, '')
    .replace(/—\s*(?=[·|]|$)/g, '');

  cleaned = cleaned
    .replace(/[·|]\s*[·|]+/g, ' · ')
    .replace(/^[\s·|—:\-,]+|[\s·|—:\-,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || fallback;
}

export function getPrintHeaderTitle(
  registeredBusinessName?: string | null,
  designOverrideTitle?: string | null,
  fallback = 'DIAGNOSTIC & CLINICAL REPORT'
): string {
  const registered = sanitizePrintText(registeredBusinessName);
  if (registered) return registered;
  const designTitle = sanitizePrintText(designOverrideTitle);
  if (designTitle) return designTitle;
  return fallback;
}
