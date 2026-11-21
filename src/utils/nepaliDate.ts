// Accurate Gregorian (AD) to Bikram Sambat (BS) Nepali Calendar Converter (2075 BS - 2088 BS)
// Reference Anchor: 2075-01-01 BS = 2018-04-14 AD

export const BS_MONTHS_EN = [
  'Baisakh',
  'Jestha',
  'Ashadh',
  'Shrawan',
  'Bhadra',
  'Ashwin',
  'Kartik',
  'Mangsir',
  'Poush',
  'Magh',
  'Falgun',
  'Chaitra',
] as const;

export const BS_MONTHS_NP = [
  'बैशाख',
  'जेठ',
  'असार',
  'साउन',
  'भदौ',
  'असोज',
  'कार्तिक',
  'मंसिर',
  'पुष',
  'माघ',
  'फाल्गुन',
  'चैत',
] as const;

// Days in each BS month from 2075 to 2088 BS
const BS_MONTH_DAYS: Record<number, number[]> = {
  2075: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2082: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2083: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2084: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2085: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2086: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2088: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
};

const ANCHOR_AD_UTC = Date.UTC(2018, 3, 14); // 2018-04-14 == 2075-01-01 BS

const NEPALI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

export function toNepaliDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => NEPALI_DIGITS[Number(d)] || d);
}

export interface BsDateResult {
  year: number;
  month: number; // 1-12
  day: number; // 1-32
  monthNameEn: string;
  monthNameNp: string;
  formattedEn: string; // e.g., 2083-07-29 BS
  formattedNp: string; // e.g., २०८३ कार्तिक २९
  fiscalYear: string; // e.g., FY 2083/84
  timeEn: string;
  timeNp: string;
}

export function adToBs(dateInput: Date | string | number): BsDateResult {
  const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const safeDt = Number.isNaN(dt.getTime()) ? new Date() : dt;

  // Convert local/Nepal-friendly calendar date
  const adUtc = Date.UTC(safeDt.getFullYear(), safeDt.getMonth(), safeDt.getDate());
  let diffDays = Math.floor((adUtc - ANCHOR_AD_UTC) / 86400000);

  let bsYear = 2075;
  let bsMonth = 0; // 0-indexed
  let bsDay = 1;

  if (diffDays >= 0) {
    while (bsYear <= 2088) {
      const months = BS_MONTH_DAYS[bsYear] || BS_MONTH_DAYS[2083];
      const daysInMonth = months[bsMonth];
      if (diffDays < daysInMonth) {
        bsDay = 1 + diffDays;
        break;
      }
      diffDays -= daysInMonth;
      bsMonth++;
      if (bsMonth >= 12) {
        bsMonth = 0;
        bsYear++;
      }
    }
  }

  const monthNum = bsMonth + 1;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const monthNameEn = BS_MONTHS_EN[bsMonth];
  const monthNameNp = BS_MONTHS_NP[bsMonth];

  // Nepali Fiscal Year starts on Shrawan 1 (month 4)
  const fyStart = monthNum >= 4 ? bsYear : bsYear - 1;
  const fyEndShort = String((fyStart + 1) % 100).padStart(2, '0');
  const fiscalYear = `FY ${fyStart}/${fyEndShort}`;

  const hours24 = safeDt.getHours();
  const mins = safeDt.getMinutes();
  const ampm = hours24 >= 12 ? 'PM' : 'AM';
  const h12 = hours24 % 12 || 12;
  const timeEn = `${pad2(h12)}:${pad2(mins)} ${ampm}`;
  const timeNp = `${toNepaliDigits(pad2(h12))}:${toNepaliDigits(pad2(mins))} ${
    hours24 >= 12 ? 'अपराह्न' : 'पूर्वाह्न'
  }`;

  return {
    year: bsYear,
    month: monthNum,
    day: bsDay,
    monthNameEn,
    monthNameNp,
    formattedEn: `${bsYear}-${pad2(monthNum)}-${pad2(bsDay)} BS`,
    formattedNp: `${toNepaliDigits(bsYear)} ${monthNameNp} ${toNepaliDigits(pad2(bsDay))}`,
    fiscalYear,
    timeEn,
    timeNp,
  };
}

export function formatNpr(amount: number, showDecimals: boolean = false): string {
  const num = Number(amount) || 0;
  return `रू ${num.toLocaleString('en-IN', {
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  })}`;
}

export function formatNprFull(amount: number): string {
  const num = Number(amount) || 0;
  return `NPR ${num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export const FISCAL_YEARS = ['FY 2081/82', 'FY 2082/83', 'FY 2083/84', 'FY 2084/85'] as const;
