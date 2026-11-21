import QRCode from 'qrcode';

// Code-39 deterministic encoding table (supported for uppercase alphanumeric, -, ., space, $, /, +, %)
const CODE39_MAP: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export interface BarcodeBar {
  x: number;
  w: number;
}

export function encodeCode39Bars(rawValue: string): { bars: BarcodeBar[]; totalWidth: number; cleanText: string } {
  const clean = (rawValue || 'AEGIS')
    .toUpperCase()
    .replace(/[^0-9A-Z\-. $/+%]/g, '-');
  const full = `*${clean}*`;
  const bars: BarcodeBar[] = [];
  let cursor = 0;
  const narrow = 1.6;
  const wide = 3.8;

  for (let cIdx = 0; cIdx < full.length; cIdx++) {
    const pattern = CODE39_MAP[full[cIdx]] || CODE39_MAP['-'];
    for (let p = 0; p < pattern.length; p++) {
      const width = pattern[p] === 'w' ? wide : narrow;
      // Even indices in Code-39 pattern are black bars; odd indices are spaces
      if (p % 2 === 0) {
        bars.push({ x: cursor, w: width });
      }
      cursor += width;
    }
    cursor += narrow; // inter-character gap
  }

  return { bars, totalWidth: Math.max(cursor, 40), cleanText: clean };
}

export async function generateQrDataUrl(text: string, size = 180): Promise<string> {
  return QRCode.toDataURL(text || 'SaptariHospital', {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

export async function generateQrSvgString(text: string, size = 96): Promise<string> {
  return QRCode.toString(text || 'SaptariHospital', {
    type: 'svg',
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}
