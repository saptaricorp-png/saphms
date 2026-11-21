// server.ts
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import compression from "compression";
import express from "express";
import fs2 from "fs";
import { createServer as createHttpServer } from "http";
import os from "os";
import path2 from "path";

// src/utils/nepaliDate.ts
var BS_MONTHS_EN = [
  "Baisakh",
  "Jestha",
  "Ashadh",
  "Shrawan",
  "Bhadra",
  "Ashwin",
  "Kartik",
  "Mangsir",
  "Poush",
  "Magh",
  "Falgun",
  "Chaitra"
];
var BS_MONTHS_NP = [
  "\u092C\u0948\u0936\u093E\u0916",
  "\u091C\u0947\u0920",
  "\u0905\u0938\u093E\u0930",
  "\u0938\u093E\u0909\u0928",
  "\u092D\u0926\u094C",
  "\u0905\u0938\u094B\u091C",
  "\u0915\u093E\u0930\u094D\u0924\u093F\u0915",
  "\u092E\u0902\u0938\u093F\u0930",
  "\u092A\u0941\u0937",
  "\u092E\u093E\u0918",
  "\u092B\u093E\u0932\u094D\u0917\u0941\u0928",
  "\u091A\u0948\u0924"
];
var BS_MONTH_DAYS = {
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
  2088: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30]
};
var ANCHOR_AD_UTC = Date.UTC(2018, 3, 14);
var NEPALI_DIGITS = ["\u0966", "\u0967", "\u0968", "\u0969", "\u096A", "\u096B", "\u096C", "\u096D", "\u096E", "\u096F"];
function toNepaliDigits(input) {
  return String(input).replace(/\d/g, (d) => NEPALI_DIGITS[Number(d)] || d);
}
function adToBs(dateInput) {
  const dt = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const safeDt = Number.isNaN(dt.getTime()) ? /* @__PURE__ */ new Date() : dt;
  const adUtc = Date.UTC(safeDt.getFullYear(), safeDt.getMonth(), safeDt.getDate());
  let diffDays = Math.floor((adUtc - ANCHOR_AD_UTC) / 864e5);
  let bsYear = 2075;
  let bsMonth = 0;
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
  const pad2 = (n) => String(n).padStart(2, "0");
  const monthNameEn = BS_MONTHS_EN[bsMonth];
  const monthNameNp = BS_MONTHS_NP[bsMonth];
  const fyStart = monthNum >= 4 ? bsYear : bsYear - 1;
  const fyEndShort = String((fyStart + 1) % 100).padStart(2, "0");
  const fiscalYear = `FY ${fyStart}/${fyEndShort}`;
  const hours24 = safeDt.getHours();
  const mins = safeDt.getMinutes();
  const ampm = hours24 >= 12 ? "PM" : "AM";
  const h12 = hours24 % 12 || 12;
  const timeEn = `${pad2(h12)}:${pad2(mins)} ${ampm}`;
  const timeNp = `${toNepaliDigits(pad2(h12))}:${toNepaliDigits(pad2(mins))} ${hours24 >= 12 ? "\u0905\u092A\u0930\u093E\u0939\u094D\u0928" : "\u092A\u0942\u0930\u094D\u0935\u093E\u0939\u094D\u0928"}`;
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
    timeNp
  };
}

// server/nepalCatalog.ts
var NEPAL_PHARMA_COMPANIES = [
  "Deurali-Janta Pharma (DJPL)",
  "Quest Pharmaceuticals",
  "Lomus Pharmaceuticals",
  "National Healthcare (NHPL)",
  "Asian Pharmaceuticals",
  "Nepal Pharmaceuticals Lab (NPL)",
  "Magnus Pharma",
  "Time Pharmaceuticals",
  "Vega Pharmaceuticals",
  "Curex Pharmaceuticals",
  "CTL Pharmaceuticals",
  "S.R. Drug Laboratories",
  "Mark Formulation",
  "Simca Laboratories",
  "Royal Pharmaceuticals",
  "Omnica Laboratories",
  "QMed Formulation",
  "Hukum Pharmaceuticals",
  "Vijaydeep Laboratories",
  "Nepal Drug Ltd.",
  "Hospital ICU / Inside Formulary"
];
var NEPAL_PHARMACY_CATALOG = [
  // Deurali-Janta (DJPL)
  { code: "NP-DJPL-001", brandName: "Moxclav 625", genericName: "Amoxicillin + Clavulanate", strength: "625 mg", dosageForm: "Tablet", manufacturer: "Deurali-Janta Pharma (DJPL)", unitLabel: "Tab", defaultMrpNpr: 32, purchaseRateNpr: 24, vatApplicable: false, reorderLevel: 80, rackLocation: "R-A1", initialBatchQty: 300 },
  { code: "NP-DJPL-002", brandName: "Deupan 40", genericName: "Pantoprazole", strength: "40 mg", dosageForm: "Tablet", manufacturer: "Deurali-Janta Pharma (DJPL)", unitLabel: "Tab", defaultMrpNpr: 9, purchaseRateNpr: 6, vatApplicable: false, reorderLevel: 120, rackLocation: "R-A2", initialBatchQty: 500 },
  { code: "NP-DJPL-003", brandName: "Azithro-DJ 500", genericName: "Azithromycin", strength: "500 mg", dosageForm: "Tablet", manufacturer: "Deurali-Janta Pharma (DJPL)", unitLabel: "Tab", defaultMrpNpr: 28, purchaseRateNpr: 20, vatApplicable: false, reorderLevel: 60, rackLocation: "R-A1", initialBatchQty: 250 },
  { code: "NP-DJPL-004", brandName: "DJ-Cef 200", genericName: "Cefixime", strength: "200 mg", dosageForm: "Tablet", manufacturer: "Deurali-Janta Pharma (DJPL)", unitLabel: "Tab", defaultMrpNpr: 22, purchaseRateNpr: 15, vatApplicable: false, reorderLevel: 80, rackLocation: "R-A3", initialBatchQty: 300 },
  // Quest Pharmaceuticals
  { code: "NP-QST-001", brandName: "Q-Pan DSR", genericName: "Pantoprazole + Domperidone SR", strength: "40mg + 30mg", dosageForm: "Capsule", manufacturer: "Quest Pharmaceuticals", unitLabel: "Cap", defaultMrpNpr: 14, purchaseRateNpr: 9.5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-B1", initialBatchQty: 400 },
  { code: "NP-QST-002", brandName: "Amloquest 5", genericName: "Amlodipine", strength: "5 mg", dosageForm: "Tablet", manufacturer: "Quest Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 6, purchaseRateNpr: 3.8, vatApplicable: false, reorderLevel: 150, rackLocation: "R-B2", initialBatchQty: 600 },
  { code: "NP-QST-003", brandName: "Losarquest 50", genericName: "Losartan Potassium", strength: "50 mg", dosageForm: "Tablet", manufacturer: "Quest Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 10, purchaseRateNpr: 6.5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-B2", initialBatchQty: 400 },
  { code: "NP-QST-004", brandName: "Glimequest M1", genericName: "Glimepiride + Metformin", strength: "1mg + 500mg", dosageForm: "Tablet", manufacturer: "Quest Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 11, purchaseRateNpr: 7.5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-B3", initialBatchQty: 350 },
  // Lomus Pharmaceuticals
  { code: "NP-LOM-001", brandName: "Sinex Plus", genericName: "Paracetamol + Phenylephrine + Chlorpheniramine", strength: "500/10/2 mg", dosageForm: "Tablet", manufacturer: "Lomus Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 5, purchaseRateNpr: 3.2, vatApplicable: false, reorderLevel: 150, rackLocation: "R-C1", initialBatchQty: 600 },
  { code: "NP-LOM-002", brandName: "Flexon-NP", genericName: "Ibuprofen + Paracetamol", strength: "400/500 mg", dosageForm: "Tablet", manufacturer: "Lomus Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 6, purchaseRateNpr: 4, vatApplicable: false, reorderLevel: 120, rackLocation: "R-C1", initialBatchQty: 450 },
  { code: "NP-LOM-003", brandName: "Lomocef 1g", genericName: "Ceftriaxone Sodium", strength: "1 gm IV/IM", dosageForm: "Injection", manufacturer: "Lomus Pharmaceuticals", unitLabel: "Vial", defaultMrpNpr: 115, purchaseRateNpr: 78, vatApplicable: false, reorderLevel: 40, rackLocation: "R-INJ1", initialBatchQty: 180 },
  // National Healthcare (NHPL)
  { code: "NP-NHPL-001", brandName: "Niko 500", genericName: "Paracetamol", strength: "500 mg", dosageForm: "Tablet", manufacturer: "National Healthcare (NHPL)", unitLabel: "Tab", defaultMrpNpr: 2.5, purchaseRateNpr: 1.5, vatApplicable: false, reorderLevel: 250, rackLocation: "R-C2", initialBatchQty: 1e3 },
  { code: "NP-NHPL-002", brandName: "Ciprodac 500", genericName: "Ciprofloxacin", strength: "500 mg", dosageForm: "Tablet", manufacturer: "National Healthcare (NHPL)", unitLabel: "Tab", defaultMrpNpr: 12, purchaseRateNpr: 8, vatApplicable: false, reorderLevel: 100, rackLocation: "R-C2", initialBatchQty: 350 },
  { code: "NP-NHPL-003", brandName: "Ofloda 200", genericName: "Ofloxacin", strength: "200 mg", dosageForm: "Tablet", manufacturer: "National Healthcare (NHPL)", unitLabel: "Tab", defaultMrpNpr: 11, purchaseRateNpr: 7.2, vatApplicable: false, reorderLevel: 80, rackLocation: "R-C2", initialBatchQty: 300 },
  // Asian Pharmaceuticals
  { code: "NP-ASN-001", brandName: "Asozole 400", genericName: "Albendazole", strength: "400 mg", dosageForm: "Tablet", manufacturer: "Asian Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 15, purchaseRateNpr: 9, vatApplicable: false, reorderLevel: 80, rackLocation: "R-D1", initialBatchQty: 300 },
  { code: "NP-ASN-002", brandName: "Asiclav 375", genericName: "Amoxicillin + Clavulanate", strength: "375 mg", dosageForm: "Tablet", manufacturer: "Asian Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 22, purchaseRateNpr: 15, vatApplicable: false, reorderLevel: 60, rackLocation: "R-D1", initialBatchQty: 250 },
  { code: "NP-ASN-003", brandName: "Asthavin", genericName: "Salbutamol", strength: "4 mg", dosageForm: "Tablet", manufacturer: "Asian Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 3, purchaseRateNpr: 1.8, vatApplicable: false, reorderLevel: 100, rackLocation: "R-D2", initialBatchQty: 400 },
  // Nepal Pharmaceuticals Lab (NPL)
  { code: "NP-NPL-001", brandName: "Cetamol 500", genericName: "Paracetamol", strength: "500 mg", dosageForm: "Tablet", manufacturer: "Nepal Pharmaceuticals Lab (NPL)", unitLabel: "Tab", defaultMrpNpr: 2.5, purchaseRateNpr: 1.4, vatApplicable: false, reorderLevel: 250, rackLocation: "R-D3", initialBatchQty: 900 },
  { code: "NP-NPL-002", brandName: "NPL-ORS", genericName: "Oral Rehydration Salts WHO", strength: "20.5 gm Sachet", dosageForm: "Consumable", manufacturer: "Nepal Pharmaceuticals Lab (NPL)", unitLabel: "Sachet", defaultMrpNpr: 20, purchaseRateNpr: 12, vatApplicable: false, reorderLevel: 100, rackLocation: "R-D3", initialBatchQty: 400 },
  { code: "NP-NPL-003", brandName: "Metron 400", genericName: "Metronidazole", strength: "400 mg", dosageForm: "Tablet", manufacturer: "Nepal Pharmaceuticals Lab (NPL)", unitLabel: "Tab", defaultMrpNpr: 4, purchaseRateNpr: 2.5, vatApplicable: false, reorderLevel: 150, rackLocation: "R-D3", initialBatchQty: 500 },
  // Magnus Pharma
  { code: "NP-MAG-001", brandName: "Magclav 625", genericName: "Amoxicillin + Clavulanate", strength: "625 mg", dosageForm: "Tablet", manufacturer: "Magnus Pharma", unitLabel: "Tab", defaultMrpNpr: 30, purchaseRateNpr: 21, vatApplicable: false, reorderLevel: 80, rackLocation: "R-E1", initialBatchQty: 250 },
  { code: "NP-MAG-002", brandName: "Rosumag 10", genericName: "Rosuvastatin", strength: "10 mg", dosageForm: "Tablet", manufacturer: "Magnus Pharma", unitLabel: "Tab", defaultMrpNpr: 16, purchaseRateNpr: 11, vatApplicable: false, reorderLevel: 80, rackLocation: "R-E1", initialBatchQty: 300 },
  { code: "NP-MAG-003", brandName: "Atormag 20", genericName: "Atorvastatin", strength: "20 mg", dosageForm: "Tablet", manufacturer: "Magnus Pharma", unitLabel: "Tab", defaultMrpNpr: 18, purchaseRateNpr: 12, vatApplicable: false, reorderLevel: 80, rackLocation: "R-E1", initialBatchQty: 300 },
  // Time Pharmaceuticals
  { code: "NP-TIM-001", brandName: "Cetiriz-T 10", genericName: "Cetirizine", strength: "10 mg", dosageForm: "Tablet", manufacturer: "Time Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 4, purchaseRateNpr: 2.2, vatApplicable: false, reorderLevel: 150, rackLocation: "R-E2", initialBatchQty: 500 },
  { code: "NP-TIM-002", brandName: "Time-Mont LC", genericName: "Montelukast + Levocetirizine", strength: "10mg + 5mg", dosageForm: "Tablet", manufacturer: "Time Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 15, purchaseRateNpr: 10, vatApplicable: false, reorderLevel: 100, rackLocation: "R-E2", initialBatchQty: 350 },
  { code: "NP-TIM-003", brandName: "Aceclo-T Plus", genericName: "Aceclofenac + Paracetamol", strength: "100mg + 325mg", dosageForm: "Tablet", manufacturer: "Time Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 10, purchaseRateNpr: 6.5, vatApplicable: false, reorderLevel: 120, rackLocation: "R-E2", initialBatchQty: 400 },
  // Vega Pharmaceuticals
  { code: "NP-VEG-001", brandName: "Vegapan 40", genericName: "Pantoprazole", strength: "40 mg", dosageForm: "Tablet", manufacturer: "Vega Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 9, purchaseRateNpr: 5.5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-F1", initialBatchQty: 350 },
  { code: "NP-VEG-002", brandName: "Vegacef 500", genericName: "Cefuroxime Axetil", strength: "500 mg", dosageForm: "Tablet", manufacturer: "Vega Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 42, purchaseRateNpr: 30, vatApplicable: false, reorderLevel: 50, rackLocation: "R-F1", initialBatchQty: 180 },
  // Curex Pharmaceuticals
  { code: "NP-CUR-001", brandName: "Curesyrup Cough", genericName: "Dextromethorphan + CPM", strength: "100 mL", dosageForm: "Syrup", manufacturer: "Curex Pharmaceuticals", unitLabel: "Bottle", defaultMrpNpr: 95, purchaseRateNpr: 65, vatApplicable: false, reorderLevel: 30, rackLocation: "R-SYR1", initialBatchQty: 100 },
  { code: "NP-CUR-002", brandName: "Curezine Drops", genericName: "Multivitamin Pediatric Drops", strength: "30 mL", dosageForm: "Drops", manufacturer: "Curex Pharmaceuticals", unitLabel: "Bottle", defaultMrpNpr: 85, purchaseRateNpr: 58, vatApplicable: false, reorderLevel: 25, rackLocation: "R-SYR1", initialBatchQty: 90 },
  // CTL Pharmaceuticals
  { code: "NP-CTL-001", brandName: "CTL-Amox 500", genericName: "Amoxicillin", strength: "500 mg", dosageForm: "Capsule", manufacturer: "CTL Pharmaceuticals", unitLabel: "Cap", defaultMrpNpr: 11, purchaseRateNpr: 7, vatApplicable: false, reorderLevel: 100, rackLocation: "R-F2", initialBatchQty: 400 },
  { code: "NP-CTL-002", brandName: "CTL-Doxy 100", genericName: "Doxycycline", strength: "100 mg", dosageForm: "Capsule", manufacturer: "CTL Pharmaceuticals", unitLabel: "Cap", defaultMrpNpr: 8, purchaseRateNpr: 5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-F2", initialBatchQty: 350 },
  // S.R. Drug Laboratories
  { code: "NP-SRD-001", brandName: "SR-Ome 20", genericName: "Omeprazole", strength: "20 mg", dosageForm: "Capsule", manufacturer: "S.R. Drug Laboratories", unitLabel: "Cap", defaultMrpNpr: 6, purchaseRateNpr: 3.5, vatApplicable: false, reorderLevel: 150, rackLocation: "R-F3", initialBatchQty: 500 },
  { code: "NP-SRD-002", brandName: "SR-Ferro XT", genericName: "Ferrous Ascorbate + Folic Acid", strength: "100mg + 1.5mg", dosageForm: "Tablet", manufacturer: "S.R. Drug Laboratories", unitLabel: "Tab", defaultMrpNpr: 14, purchaseRateNpr: 9, vatApplicable: false, reorderLevel: 100, rackLocation: "R-F3", initialBatchQty: 400 },
  // Mark Formulation
  { code: "NP-MRK-001", brandName: "Mark-D3 60K", genericName: "Cholecalciferol (Vitamin D3)", strength: "60,000 IU", dosageForm: "Capsule", manufacturer: "Mark Formulation", unitLabel: "Cap", defaultMrpNpr: 35, purchaseRateNpr: 22, vatApplicable: false, reorderLevel: 50, rackLocation: "R-G1", initialBatchQty: 200 },
  { code: "NP-MRK-002", brandName: "Mark-Cal D3", genericName: "Calcium Carbonate + Vitamin D3", strength: "500mg + 250IU", dosageForm: "Tablet", manufacturer: "Mark Formulation", unitLabel: "Tab", defaultMrpNpr: 12, purchaseRateNpr: 7.5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-G1", initialBatchQty: 400 },
  // Simca Laboratories
  { code: "NP-SMC-001", brandName: "Simca-Levo 500", genericName: "Levofloxacin", strength: "500 mg", dosageForm: "Tablet", manufacturer: "Simca Laboratories", unitLabel: "Tab", defaultMrpNpr: 19, purchaseRateNpr: 13, vatApplicable: false, reorderLevel: 80, rackLocation: "R-G2", initialBatchQty: 250 },
  { code: "NP-SMC-002", brandName: "Simca-Povidone Oint", genericName: "Povidone-Iodine 5% Ointment", strength: "20 gm Tube", dosageForm: "Ointment", manufacturer: "Simca Laboratories", unitLabel: "Tube", defaultMrpNpr: 68, purchaseRateNpr: 44, vatApplicable: true, reorderLevel: 30, rackLocation: "R-OINT", initialBatchQty: 120 },
  // Royal Pharmaceuticals
  { code: "NP-RYL-001", brandName: "Roy-Azithro Susp", genericName: "Azithromycin Oral Suspension", strength: "200mg/5mL (15mL)", dosageForm: "Syrup", manufacturer: "Royal Pharmaceuticals", unitLabel: "Bottle", defaultMrpNpr: 92, purchaseRateNpr: 62, vatApplicable: false, reorderLevel: 30, rackLocation: "R-SYR2", initialBatchQty: 100 },
  { code: "NP-RYL-002", brandName: "Roy-Rab 20", genericName: "Rabeprazole Sodium", strength: "20 mg", dosageForm: "Tablet", manufacturer: "Royal Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 9, purchaseRateNpr: 5.8, vatApplicable: false, reorderLevel: 100, rackLocation: "R-G3", initialBatchQty: 350 },
  // Omnica Laboratories
  { code: "NP-OMN-001", brandName: "Omni-Mox 250 DT", genericName: "Amoxicillin Dispersible", strength: "250 mg", dosageForm: "Tablet", manufacturer: "Omnica Laboratories", unitLabel: "Tab", defaultMrpNpr: 7, purchaseRateNpr: 4.5, vatApplicable: false, reorderLevel: 100, rackLocation: "R-H1", initialBatchQty: 300 },
  { code: "NP-OMN-002", brandName: "Omni-Dom 10", genericName: "Domperidone", strength: "10 mg", dosageForm: "Tablet", manufacturer: "Omnica Laboratories", unitLabel: "Tab", defaultMrpNpr: 4.5, purchaseRateNpr: 2.8, vatApplicable: false, reorderLevel: 120, rackLocation: "R-H1", initialBatchQty: 400 },
  // QMed Formulation
  { code: "NP-QMD-001", brandName: "QMed-Pregab M", genericName: "Pregabalin + Methylcobalamin", strength: "75mg + 750mcg", dosageForm: "Capsule", manufacturer: "QMed Formulation", unitLabel: "Cap", defaultMrpNpr: 24, purchaseRateNpr: 16, vatApplicable: false, reorderLevel: 60, rackLocation: "R-H2", initialBatchQty: 200 },
  { code: "NP-QMD-002", brandName: "QMed-Telmi 40", genericName: "Telmisartan", strength: "40 mg", dosageForm: "Tablet", manufacturer: "QMed Formulation", unitLabel: "Tab", defaultMrpNpr: 14, purchaseRateNpr: 9, vatApplicable: false, reorderLevel: 80, rackLocation: "R-H2", initialBatchQty: 300 },
  // Hukum Pharmaceuticals
  { code: "NP-HKM-001", brandName: "Hukum-Diclo 50", genericName: "Diclofenac Sodium", strength: "50 mg", dosageForm: "Tablet", manufacturer: "Hukum Pharmaceuticals", unitLabel: "Tab", defaultMrpNpr: 4, purchaseRateNpr: 2.4, vatApplicable: false, reorderLevel: 120, rackLocation: "R-H3", initialBatchQty: 400 },
  { code: "NP-HKM-002", brandName: "Hukum-Metro IV", genericName: "Metronidazole IV Infusion", strength: "500mg / 100mL", dosageForm: "IV Fluid", manufacturer: "Hukum Pharmaceuticals", unitLabel: "Bottle", defaultMrpNpr: 62, purchaseRateNpr: 40, vatApplicable: false, reorderLevel: 60, rackLocation: "R-IV1", initialBatchQty: 250 },
  // Vijaydeep Laboratories
  { code: "NP-VJD-001", brandName: "Vijay-NS 0.9%", genericName: "Sodium Chloride 0.9% IV Fluid", strength: "500 mL", dosageForm: "IV Fluid", manufacturer: "Vijaydeep Laboratories", unitLabel: "Bottle", defaultMrpNpr: 78, purchaseRateNpr: 48, vatApplicable: false, reorderLevel: 80, rackLocation: "R-IV1", initialBatchQty: 400 },
  { code: "NP-VJD-002", brandName: "Vijay-RL", genericName: "Ringer Lactate IV Solution", strength: "500 mL", dosageForm: "IV Fluid", manufacturer: "Vijaydeep Laboratories", unitLabel: "Bottle", defaultMrpNpr: 82, purchaseRateNpr: 52, vatApplicable: false, reorderLevel: 80, rackLocation: "R-IV1", initialBatchQty: 350 },
  { code: "NP-VJD-003", brandName: "Vijay-DNS", genericName: "Dextrose 5% + Normal Saline", strength: "500 mL", dosageForm: "IV Fluid", manufacturer: "Vijaydeep Laboratories", unitLabel: "Bottle", defaultMrpNpr: 84, purchaseRateNpr: 54, vatApplicable: false, reorderLevel: 60, rackLocation: "R-IV1", initialBatchQty: 300 },
  // Hospital ICU / Inside Formulary (Ward/ER/OT Injections & Inside Consumables)
  { code: "IN-ICU-001", brandName: "Pantop-IV 40", genericName: "Pantoprazole IV Injection", strength: "40 mg Vial", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Vial", defaultMrpNpr: 75, purchaseRateNpr: 48, vatApplicable: false, reorderLevel: 50, rackLocation: "R-INJ1", initialBatchQty: 220 },
  { code: "IN-ICU-002", brandName: "Ondem-IV 4mg", genericName: "Ondansetron Injection", strength: "4 mg / 2 mL", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Amp", defaultMrpNpr: 34, purchaseRateNpr: 20, vatApplicable: false, reorderLevel: 60, rackLocation: "R-INJ1", initialBatchQty: 280 },
  { code: "IN-ICU-003", brandName: "Pipzo-4.5g", genericName: "Piperacillin + Tazobactam IV", strength: "4.5 gm Vial", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Vial", defaultMrpNpr: 390, purchaseRateNpr: 270, vatApplicable: false, reorderLevel: 30, rackLocation: "R-INJ2", initialBatchQty: 120 },
  { code: "IN-ICU-004", brandName: "Mero-1g IV", genericName: "Meropenem Trihydrate IV", strength: "1 gm Vial", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Vial", defaultMrpNpr: 680, purchaseRateNpr: 490, vatApplicable: false, reorderLevel: 20, rackLocation: "R-INJ2", initialBatchQty: 80 },
  { code: "IN-ICU-005", brandName: "Ketorol-30 IM/IV", genericName: "Ketorolac Tromethamine Inj", strength: "30 mg / mL", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Amp", defaultMrpNpr: 38, purchaseRateNpr: 22, vatApplicable: false, reorderLevel: 50, rackLocation: "R-INJ1", initialBatchQty: 200 },
  { code: "IN-ICU-006", brandName: "Lasix 20mg Inj", genericName: "Furosemide Injection", strength: "20 mg / 2 mL", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Amp", defaultMrpNpr: 24, purchaseRateNpr: 14, vatApplicable: false, reorderLevel: 50, rackLocation: "R-INJ1", initialBatchQty: 200 },
  { code: "IN-ICU-007", brandName: "Hydrocort-100", genericName: "Hydrocortisone Sodium Succinate", strength: "100 mg Vial", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Vial", defaultMrpNpr: 78, purchaseRateNpr: 52, vatApplicable: false, reorderLevel: 40, rackLocation: "R-INJ1", initialBatchQty: 150 },
  { code: "IN-ICU-008", brandName: "Adrenaline 1mg", genericName: "Epinephrine Injection", strength: "1 mg / mL", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Amp", defaultMrpNpr: 28, purchaseRateNpr: 16, vatApplicable: false, reorderLevel: 40, rackLocation: "R-ER1", initialBatchQty: 160 },
  { code: "IN-ICU-009", brandName: "Norad-4mg", genericName: "Noradrenaline Bitartrate", strength: "4 mg / 2 mL", dosageForm: "Injection", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Amp", defaultMrpNpr: 145, purchaseRateNpr: 95, vatApplicable: false, reorderLevel: 20, rackLocation: "R-ER1", initialBatchQty: 90 },
  { code: "IN-ICU-010", brandName: "Paracet-IV 100ml", genericName: "Paracetamol IV Infusion", strength: "1000mg / 100mL", dosageForm: "IV Fluid", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Bottle", defaultMrpNpr: 165, purchaseRateNpr: 110, vatApplicable: false, reorderLevel: 40, rackLocation: "R-IV2", initialBatchQty: 160 },
  { code: "IN-CON-001", brandName: "IV Cannula 20G Pink", genericName: "IV Catheter w/ Injection Port", strength: "20G", dosageForm: "Consumable", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Pcs", defaultMrpNpr: 45, purchaseRateNpr: 25, vatApplicable: true, reorderLevel: 100, rackLocation: "R-CON1", initialBatchQty: 400 },
  { code: "IN-CON-002", brandName: "IV Infusion Set", genericName: "Sterile Vented IV Drip Set", strength: "Standard", dosageForm: "Consumable", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Pcs", defaultMrpNpr: 40, purchaseRateNpr: 22, vatApplicable: true, reorderLevel: 100, rackLocation: "R-CON1", initialBatchQty: 400 },
  { code: "IN-CON-003", brandName: "Foley Catheter 16Fr", genericName: "2-Way Silicone Foley Catheter", strength: "16 Fr", dosageForm: "Consumable", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Pcs", defaultMrpNpr: 160, purchaseRateNpr: 95, vatApplicable: true, reorderLevel: 30, rackLocation: "R-CON2", initialBatchQty: 120 },
  { code: "IN-CON-004", brandName: "Sterile Surgical Gloves", genericName: "Latex Powder-Free Gloves", strength: "7.5 Pair", dosageForm: "Consumable", manufacturer: "Hospital ICU / Inside Formulary", unitLabel: "Pair", defaultMrpNpr: 55, purchaseRateNpr: 34, vatApplicable: true, reorderLevel: 80, rackLocation: "R-CON2", initialBatchQty: 300 }
];
var NEPAL_HOSPITAL_SERVICES_CATALOG = [
  // Conventional X-Ray (All Kinds)
  { code: "XR-CXR-PA", name: "X-Ray Chest (PA View)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 45, price: 450 },
  { code: "XR-CXR-APL", name: "X-Ray Chest (AP & Lateral)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 60, price: 750 },
  { code: "XR-SKULL", name: "X-Ray Skull (AP & Lateral)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 10x12", methodology: "Conventional Radiography", tatMinutes: 60, price: 650 },
  { code: "XR-PNS", name: "X-Ray PNS (Water View)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 8x10", methodology: "Conventional Radiography", tatMinutes: 45, price: 450 },
  { code: "XR-CSPINE", name: "X-Ray Cervical Spine (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 10x12", methodology: "Conventional Radiography", tatMinutes: 60, price: 700 },
  { code: "XR-LSPINE", name: "X-Ray Lumbosacral Spine (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 60, price: 800 },
  { code: "XR-TSPINE", name: "X-Ray Thoracic Spine (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 60, price: 800 },
  { code: "XR-PELVIS", name: "X-Ray Pelvis with Both Hips (AP)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 45, price: 600 },
  { code: "XR-KNEE", name: "X-Ray Knee Joint (AP & Lateral)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 10x12", methodology: "Conventional Radiography", tatMinutes: 45, price: 600 },
  { code: "XR-ANKLE", name: "X-Ray Ankle Joint (AP & Lateral)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 8x10", methodology: "Conventional Radiography", tatMinutes: 45, price: 550 },
  { code: "XR-SHOULDER", name: "X-Ray Shoulder Joint (AP & Axial)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 10x12", methodology: "Conventional Radiography", tatMinutes: 45, price: 600 },
  { code: "XR-ELBOW", name: "X-Ray Elbow / Forearm (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 8x10", methodology: "Conventional Radiography", tatMinutes: 45, price: 550 },
  { code: "XR-WRIST", name: "X-Ray Wrist / Hand (AP & Oblique)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 8x10", methodology: "Conventional Radiography", tatMinutes: 45, price: 500 },
  { code: "XR-ABD-ERECT", name: "X-Ray Abdomen Erect & Supine", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 60, price: 750 },
  { code: "XR-KUB", name: "X-Ray KUB (Plain)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Conventional X-Ray", containerType: "X-Ray Film 14x17", methodology: "Conventional Radiography", tatMinutes: 45, price: 550 },
  // DR X-Ray (Digital Radiography)
  { code: "DR-CXR-PA", name: "DR X-Ray Chest (PA Digital)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector + CD/Print", methodology: "Flat-Panel DR X-Ray", tatMinutes: 25, price: 650 },
  { code: "DR-CXR-PORT", name: "DR X-Ray Chest Portable (ICU/ER Bedside)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Portable DR X-Ray", containerType: "Mobile DR Unit", methodology: "Bedside Digital Radiography", tatMinutes: 30, price: 950 },
  { code: "DR-LSPINE", name: "DR X-Ray Lumbosacral Spine (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector", methodology: "Flat-Panel DR X-Ray", tatMinutes: 30, price: 1100 },
  { code: "DR-CSPINE", name: "DR X-Ray Cervical Spine (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector", methodology: "Flat-Panel DR X-Ray", tatMinutes: 30, price: 950 },
  { code: "DR-PELVIS", name: "DR X-Ray Pelvis / Both Hips (AP)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector", methodology: "Flat-Panel DR X-Ray", tatMinutes: 30, price: 850 },
  { code: "DR-KNEE", name: "DR X-Ray Knee / Ankle / Extremity (AP & Lat)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector", methodology: "Flat-Panel DR X-Ray", tatMinutes: 30, price: 850 },
  { code: "DR-KUB", name: "DR X-Ray KUB / Abdomen Erect", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector", methodology: "Flat-Panel DR X-Ray", tatMinutes: 30, price: 850 },
  { code: "DR-PNS", name: "DR X-Ray PNS / Nasal Bone", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "X-RAY", department: "Radiology", specimenType: "Digital Radiography (DR)", containerType: "DR Digital Detector", methodology: "Flat-Panel DR X-Ray", tatMinutes: 25, price: 650 },
  // USG (Ultrasound & Color Doppler)
  { code: "USG-WABD", name: "USG Whole Abdomen", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "USG Gel & Thermal Print", methodology: "B-Mode High-Res Ultrasound", tatMinutes: 45, price: 1100 },
  { code: "USG-ABDPEL", name: "USG Abdomen & Pelvis (Complete)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "USG Gel & Thermal Print", methodology: "B-Mode High-Res Ultrasound", tatMinutes: 45, price: 1300 },
  { code: "USG-PELVIS", name: "USG Pelvis (Gynecology / Lower Abdomen)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "USG Gel", methodology: "Transabdominal Pelvis USG", tatMinutes: 40, price: 950 },
  { code: "USG-TVS", name: "USG TVS (Transvaginal Sonography)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "Endocavitary Probe Cover", methodology: "Transvaginal Ultrasound", tatMinutes: 45, price: 1500 },
  { code: "USG-OBS", name: "USG Obstetric (Pregnancy Growth & FWB)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "USG Gel & Thermal Print", methodology: "Obstetric Biometry USG", tatMinutes: 45, price: 1200 },
  { code: "USG-ANOMALY", name: "USG Level-II Anomaly Scan (18-22 Weeks)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "USG 4D/High-Res", methodology: "Targeted Fetal Anomaly Scan", tatMinutes: 60, price: 2400 },
  { code: "USG-KUB", name: "USG KUB + Prostate / Post-Void Residual", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "USG Gel", methodology: "B-Mode Renal & Bladder USG", tatMinutes: 40, price: 1050 },
  { code: "USG-THYROID", name: "USG Thyroid & Neck High-Frequency", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "Linear Probe USG", methodology: "High-Frequency Linear USG", tatMinutes: 40, price: 1200 },
  { code: "USG-BREAST", name: "USG Bilateral Breast & Axilla", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "Linear Probe USG", methodology: "High-Frequency Breast USG", tatMinutes: 45, price: 1400 },
  { code: "USG-SCROTUM", name: "USG Scrotum & Inguinal Region", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Ultrasound", containerType: "Linear Probe + Doppler", methodology: "High-Frequency Scrotal USG", tatMinutes: 45, price: 1350 },
  { code: "USG-DOP-LL", name: "USG Color Doppler Lower Limb (Arterial/Venous)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Color Doppler", containerType: "Linear Probe", methodology: "Duplex Color Doppler", tatMinutes: 60, price: 2600 },
  { code: "USG-DOP-CAR", name: "USG Carotid & Vertebral Color Doppler", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Color Doppler", containerType: "Linear Probe", methodology: "Duplex Carotid Doppler", tatMinutes: 60, price: 2500 },
  { code: "USG-PORTABLE", name: "USG Portable Bedside (ER/ICU eFAST)", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "USG", department: "Radiology", specimenType: "Portable Ultrasound", containerType: "Bedside Probe", methodology: "Point-of-Care eFAST / Bedside USG", tatMinutes: 25, price: 1600 },
  // ECG, Echo & Clinical Procedures
  { code: "CARD-ECG", name: "12-Lead Digital ECG (Electrocardiogram)", serviceCategory: "HOSPITAL_PROCEDURE", customCategory: "Procedures", modality: "ECG", department: "Emergency & Procedures", specimenType: "Cardiac Tracing", containerType: "Thermal ECG Strip", methodology: "12-Lead Digital ECG", tatMinutes: 20, price: 350 },
  { code: "CARD-ECHO", name: "2D Echocardiography with Color Doppler", serviceCategory: "RADIOLOGY", customCategory: "Radiology", modality: "ECHO", department: "Radiology", specimenType: "Cardiac Ultrasound", containerType: "Phased Array Probe", methodology: "2D Echo & M-Mode Doppler", tatMinutes: 60, price: 2200 },
  { code: "PROC-NEB", name: "Nebulization Session (Bronchodilator)", serviceCategory: "HOSPITAL_PROCEDURE", customCategory: "Procedures", department: "Emergency & Procedures", specimenType: "Procedure", containerType: "Nebulizer Mask", methodology: "Aerosol Inhalation", tatMinutes: 20, price: 150 },
  { code: "PROC-DRESS-S", name: "Wound Dressing (Simple / Clean)", serviceCategory: "HOSPITAL_PROCEDURE", customCategory: "Procedures", department: "Emergency & Procedures", specimenType: "Procedure", containerType: "Sterile Dressing Pack", methodology: "Aseptic Dressing", tatMinutes: 30, price: 250 },
  { code: "PROC-SUTURE-M", name: "Laceration Suturing (Medium 4-8 Stitches)", serviceCategory: "HOSPITAL_PROCEDURE", customCategory: "Procedures", department: "Emergency & Procedures", specimenType: "Procedure", containerType: "Suture Kit + LA", methodology: "Minor OT Surgical Repair", tatMinutes: 45, price: 950 },
  { code: "PROC-CATH", name: "Foley Urinary Catheterization (Procedure)", serviceCategory: "HOSPITAL_PROCEDURE", customCategory: "Procedures", department: "Nursing & Ward", specimenType: "Procedure", containerType: "Aseptic Catheter Tray", methodology: "Sterile Catheterization", tatMinutes: 30, price: 450 },
  { code: "PROC-POP-S", name: "Below-Knee / Forearm POP Slab / Cast", serviceCategory: "HOSPITAL_PROCEDURE", customCategory: "Ortho & Plaster", department: "Ortho & Plaster", specimenType: "Orthopedic Plaster", containerType: "Gypsona POP Bandage", methodology: "Orthopedic Immobilization", tatMinutes: 45, price: 1400 }
];

// server/labCatalog.ts
function buildParam(p) {
  const isQual = p.resultType === "QUALITATIVE";
  return {
    id: p.id,
    name: p.name,
    analyzerCode: p.analyzerCode,
    resultType: isQual ? "QUALITATIVE" : "NUMERIC",
    unit: isQual ? "-" : p.unit,
    refMinMale: p.refMinMale ?? 0,
    refMaxMale: p.refMaxMale ?? 0,
    refMinFemale: p.refMinFemale ?? p.refMinMale ?? 0,
    refMaxFemale: p.refMaxFemale ?? p.refMaxMale ?? 0,
    criticalLow: p.criticalLow,
    criticalHigh: p.criticalHigh,
    decimalPlaces: isQual ? 0 : p.decimalPlaces ?? 1,
    formula: p.formula,
    isCalculated: p.isCalculated,
    qualitativeOptions: p.qualitativeOptions,
    normalQualitativeValues: p.normalQualitativeValues,
    criticalQualitativeValues: p.criticalQualitativeValues
  };
}
function buildLabService(spec) {
  const defaultInterps = {
    normal: `${spec.name} parameters are within biological reference intervals.`,
    abnormalLow: `Decreased value noted in ${spec.name}; correlate clinically.`,
    abnormalHigh: `Elevated or abnormal finding detected in ${spec.name}; clinical correlation advised.`,
    critical: `CRITICAL PANIC ALERT in ${spec.name}: Immediate physician review & notification required.`,
    methodologyNote: spec.methodology
  };
  return {
    id: spec.id,
    code: spec.code,
    name: spec.name,
    serviceCategory: "PATHOLOGY",
    customCategory: spec.customCategory || "Pathology",
    department: spec.department,
    specimenType: spec.specimenType,
    containerType: spec.containerType,
    methodology: spec.methodology,
    tatMinutes: spec.tatMinutes,
    price: spec.price,
    active: true,
    parameters: spec.parameters.map(buildParam),
    reagentBom: [],
    interpretations: {
      ...defaultInterps,
      ...spec.interpretations || {}
    }
  };
}
var ANALYZER_CODE_BY_PARAM_ID = {
  "p-hb": "HGB",
  "p-wbc": "WBC",
  "p-plt": "PLT",
  "p-rbc": "RBC",
  "p-hct": "HCT",
  "p-mcv": "MCV",
  "p-mch": "MCH",
  "p-mchc": "MCHC",
  "p-tbil": "TBIL",
  "p-dbil": "DBIL",
  "p-ibil": "IBIL",
  "p-ast": "AST",
  "p-alt": "ALT",
  "p-alp": "ALP",
  "p-tprot": "TP",
  "p-alb": "ALB",
  "p-glob": "GLOB",
  "p-ag": "AG_RATIO",
  "p-chol": "CHOL",
  "p-hdl": "HDL",
  "p-tg": "TRIG",
  "p-vldl": "VLDL",
  "p-ldl": "LDL",
  "p-tsh": "TSH",
  "p-ft3": "FT3",
  "p-ft4": "FT4",
  "p-hba1c": "HBA1C",
  "p-eag": "EAG",
  "p-creat": "CREA",
  "p-bun": "BUN",
  "p-urea": "UREA",
  "p-ua": "URIC",
  "p-egfr": "EGFR",
  "p-fbs": "GLU_F",
  "p-crp": "CRP",
  "p-vitd": "VITD",
  "p-uapp": "U_APP",
  "p-ualb": "U_PRO",
  "p-usug": "U_GLU",
  "p-uket": "U_KET",
  "p-unit": "U_NIT",
  "p-uph": "U_PH",
  "p-usg": "U_SG",
  "p-upus": "U_WBC",
  "p-urbc": "U_RBC",
  "p-hbsag": "HBSAG",
  "p-hcv": "HCV",
  "p-hiv": "HIV",
  "p-vdrl": "VDRL",
  "p-hcg": "U_HCG",
  "p-fob": "FOB"
};
var DEFAULT_LAB_ANALYZERS = [
  {
    id: "ana-hem-mindray",
    code: "HEM-BC5300",
    name: "Mindray BC-5300 / Sysmex Hematology Analyzer",
    department: "Hematology",
    protocol: "HL7_V2",
    connectionMode: "BI_DIRECTIONAL",
    endpointAddress: "192.168.10.21:5100",
    status: "Connected",
    autoApplyOnReceive: true,
    mappedAnalytes: ["HGB", "WBC", "RBC", "HCT", "MCV", "MCH", "MCHC", "PLT", "NEUT", "LYMPH", "MONO", "EOS", "BASO", "RETIC", "AEC", "ESR"],
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    packetsProcessedCount: 0
  },
  {
    id: "ana-chem-cobas",
    code: "CHEM-XL200",
    name: "Cobas c311 / Erba XL-200 Biochemistry Analyzer",
    department: "Clinical Chemistry",
    protocol: "ASTM_E1394",
    connectionMode: "BI_DIRECTIONAL",
    endpointAddress: "192.168.10.22:5200",
    status: "Connected",
    autoApplyOnReceive: true,
    mappedAnalytes: ["GLU_F", "GLU_PP", "GLU_R", "GLU_0H", "GLU_1H", "GLU_2H", "TBIL", "DBIL", "AST", "ALT", "ALP", "GGT", "TP", "ALB", "CHOL", "HDL", "TRIG", "CREA", "BUN", "UREA", "URIC", "CA", "PHOS", "MG", "AMYL", "LIPA", "LDH", "CPK", "CKMB", "IRON", "TIBC", "CRP", "ASO", "RF", "HBA1C"],
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    packetsProcessedCount: 0
  },
  {
    id: "ana-clia-alinity",
    code: "CLIA-E411",
    name: "Cobas e411 / Alinity i CLIA Hormone & Immunology",
    department: "Endocrinology",
    protocol: "HL7_V2",
    connectionMode: "BI_DIRECTIONAL",
    endpointAddress: "192.168.10.23:5300",
    status: "Connected",
    autoApplyOnReceive: true,
    mappedAnalytes: ["TSH", "FT3", "FT4", "TT3", "TT4", "VITD", "VITB12", "FERR", "FOLATE", "BHCG", "PRL", "FSH", "LH", "E2", "PROG", "TESTO", "AMH", "CORT", "INS_F", "PTH", "PSA", "FPSA", "CA125", "CEA", "AFP", "TROPI", "DDIMER", "ATPO"],
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    packetsProcessedCount: 0
  },
  {
    id: "ana-elec-abg",
    code: "ISE-ABL80",
    name: "Cornley / SensaCore Electrolytes & ABL80 ABG Analyzer",
    department: "Clinical Chemistry",
    protocol: "SERIAL_RS232",
    connectionMode: "BI_DIRECTIONAL",
    endpointAddress: "COM3 \xB7 9600-8-N-1",
    status: "Connected",
    autoApplyOnReceive: true,
    mappedAnalytes: ["NA", "K", "CL", "ICA", "ABG_PH", "PCO2", "PO2", "HCO3", "BE", "SPO2", "LAC"],
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    packetsProcessedCount: 0
  },
  {
    id: "ana-coag-sysmex",
    code: "COAG-CA660",
    name: "Sysmex CA-660 Automated Coagulation Analyzer",
    department: "Hematology",
    protocol: "ASTM_E1394",
    connectionMode: "BI_DIRECTIONAL",
    endpointAddress: "192.168.10.24:5400",
    status: "Connected",
    autoApplyOnReceive: true,
    mappedAnalytes: ["PT", "PT_CTRL", "INR", "APTT", "DDIMER", "FIB"],
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    packetsProcessedCount: 0
  },
  {
    id: "ana-uri-clinitek",
    code: "URI-CLINITEK",
    name: "Siemens Clinitek Status+ Automated Urine Strip Reader",
    department: "Microbiology",
    protocol: "ASTM_E1394",
    connectionMode: "UNI_DIRECTIONAL",
    endpointAddress: "192.168.10.25:5500",
    status: "Connected",
    autoApplyOnReceive: true,
    mappedAnalytes: ["U_APP", "U_PRO", "U_GLU", "U_KET", "U_NIT", "U_PH", "U_SG", "U_WBC", "U_RBC", "UALB_MG", "UACR"],
    lastHeartbeatAt: (/* @__PURE__ */ new Date()).toISOString(),
    packetsProcessedCount: 0
  }
];
var RAW_LAB_CATALOG = [
  // ==================== HEMATOLOGY & COAGULATION ====================
  {
    id: "srv-lab-cbc-diff",
    code: "CBC-DIFF",
    name: "Complete Blood Count with 5-Part Differential (DLC)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender Top (3 mL)",
    methodology: "Fluorescent Flow Cytometry + Impedance",
    tatMinutes: 90,
    price: 750,
    parameters: [
      { id: "p-diff-hb", name: "Hemoglobin (Hb)", analyzerCode: "HGB", unit: "g/dL", refMinMale: 13.5, refMaxMale: 17.5, refMinFemale: 12, refMaxFemale: 15.5, criticalLow: 7, criticalHigh: 20, decimalPlaces: 1 },
      { id: "p-diff-wbc", name: "Total Leukocyte Count (WBC)", analyzerCode: "WBC", unit: "\xD710\xB3/\xB5L", refMinMale: 4, refMaxMale: 11, refMinFemale: 4, refMaxFemale: 11, criticalLow: 1.5, criticalHigh: 30, decimalPlaces: 2 },
      { id: "p-diff-neut", name: "Neutrophils (%)", analyzerCode: "NEUT", unit: "%", refMinMale: 40, refMaxMale: 75, refMinFemale: 40, refMaxFemale: 75, decimalPlaces: 1 },
      { id: "p-diff-lymph", name: "Lymphocytes (%)", analyzerCode: "LYMPH", unit: "%", refMinMale: 20, refMaxMale: 45, refMinFemale: 20, refMaxFemale: 45, decimalPlaces: 1 },
      { id: "p-diff-mono", name: "Monocytes (%)", analyzerCode: "MONO", unit: "%", refMinMale: 2, refMaxMale: 10, refMinFemale: 2, refMaxFemale: 10, decimalPlaces: 1 },
      { id: "p-diff-eos", name: "Eosinophils (%)", analyzerCode: "EOS", unit: "%", refMinMale: 1, refMaxMale: 6, refMinFemale: 1, refMaxFemale: 6, decimalPlaces: 1 },
      { id: "p-diff-baso", name: "Basophils (%)", analyzerCode: "BASO", unit: "%", refMinMale: 0, refMaxMale: 2, refMinFemale: 0, refMaxFemale: 2, decimalPlaces: 1 },
      { id: "p-diff-plt", name: "Platelet Count", analyzerCode: "PLT", unit: "\xD710\xB3/\xB5L", refMinMale: 150, refMaxMale: 450, refMinFemale: 150, refMaxFemale: 450, criticalLow: 50, criticalHigh: 1e3, decimalPlaces: 0 },
      { id: "p-diff-rbc", name: "RBC Count", analyzerCode: "RBC", unit: "\xD710\u2076/\xB5L", refMinMale: 4.5, refMaxMale: 5.9, refMinFemale: 4.1, refMaxFemale: 5.1, decimalPlaces: 2 },
      { id: "p-diff-hct", name: "Hematocrit (PCV)", analyzerCode: "HCT", unit: "%", refMinMale: 41, refMaxMale: 53, refMinFemale: 36, refMaxFemale: 46, decimalPlaces: 1 },
      { id: "p-diff-mcv", name: "MCV", analyzerCode: "MCV", unit: "fL", refMinMale: 80, refMaxMale: 100, refMinFemale: 80, refMaxFemale: 100, decimalPlaces: 1, isCalculated: true, formula: "({p-diff-hct} * 10) / {p-diff-rbc}" }
    ]
  },
  {
    id: "srv-lab-esr",
    code: "ESR-01",
    name: "Erythrocyte Sedimentation Rate (ESR \u2014 Westergren)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender / Black Top (2 mL)",
    methodology: "Automated Infrared Optical Sedimentation (Westergren)",
    tatMinutes: 90,
    price: 200,
    parameters: [
      { id: "p-esr", name: "ESR (1st Hour)", analyzerCode: "ESR", unit: "mm/hr", refMinMale: 0, refMaxMale: 15, refMinFemale: 0, refMaxFemale: 20, criticalHigh: 100, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-retic",
    code: "RETIC-01",
    name: "Reticulocyte Count (Percentage & Corrected)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender Top (3 mL)",
    methodology: "Supravital New Methylene Blue / Fluorescent Flow Cytometry",
    tatMinutes: 120,
    price: 350,
    parameters: [
      { id: "p-retic-pct", name: "Reticulocyte Percentage", analyzerCode: "RETIC", unit: "%", refMinMale: 0.5, refMaxMale: 2.5, refMinFemale: 0.5, refMaxFemale: 2.5, decimalPlaces: 2 },
      { id: "p-retic-abs", name: "Absolute Reticulocyte Count", analyzerCode: "RETIC_ABS", unit: "\xD710\u2079/L", refMinMale: 25, refMaxMale: 90, refMinFemale: 25, refMaxFemale: 90, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-aec",
    code: "AEC-01",
    name: "Absolute Eosinophil Count (AEC)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender Top (3 mL)",
    methodology: "Automated Cell Counter / Improved Neubauer Chamber",
    tatMinutes: 90,
    price: 250,
    parameters: [
      { id: "p-aec", name: "Absolute Eosinophil Count", analyzerCode: "AEC", unit: "cells/\xB5L", refMinMale: 40, refMaxMale: 440, refMinFemale: 40, refMaxFemale: 440, criticalHigh: 5e3, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-pbs",
    code: "PBS-01",
    name: "Peripheral Blood Smear (PBS Morphology)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood + Fresh Smear",
    containerType: "Lavender Top + Glass Slides",
    methodology: "Leishman / Giemsa Stained Microscopic Examination",
    tatMinutes: 180,
    price: 450,
    parameters: [
      { id: "p-pbs-rbc", name: "RBC Morphology", analyzerCode: "PBS_RBC", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Normocytic Normochromic", "Microcytic Hypochromic", "Macrocytic", "Dimorphic", "Anisopoikilocytosis"], normalQualitativeValues: ["Normocytic Normochromic"] },
      { id: "p-pbs-wbc", name: "WBC Morphology", analyzerCode: "PBS_WBC", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Normal Distribution & Maturity", "Neutrophilic Leukocytosis", "Lymphocytosis", "Eosinophilia", "Left Shift / Toxic Granulation", "Atypical / Blast Cells Seen"], normalQualitativeValues: ["Normal Distribution & Maturity"], criticalQualitativeValues: ["Atypical / Blast Cells Seen"] },
      { id: "p-pbs-plt", name: "Platelets on Smear", analyzerCode: "PBS_PLT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Adequate", "Mildly Reduced", "Markedly Reduced (Thrombocytopenia)", "Increased / Giant Forms"], normalQualitativeValues: ["Adequate"], criticalQualitativeValues: ["Markedly Reduced (Thrombocytopenia)"] },
      { id: "p-pbs-par", name: "Hemoparasites", analyzerCode: "PBS_PAR", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["None Seen", "P. vivax Seen", "P. falciparum Seen"], normalQualitativeValues: ["None Seen"], criticalQualitativeValues: ["P. falciparum Seen"] }
    ]
  },
  {
    id: "srv-lab-bgrh",
    code: "BG-RH",
    name: "ABO Blood Grouping & Rh (D) Typing",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender Top (3 mL)",
    methodology: "Monoclonal Antisera Tube / Gel Card Agglutination",
    tatMinutes: 45,
    price: 250,
    parameters: [
      { id: "p-abo", name: "ABO Blood Group", analyzerCode: "ABO", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["O", "A", "B", "AB"], normalQualitativeValues: ["O", "A", "B", "AB"] },
      { id: "p-rh", name: "Rh (D) Factor", analyzerCode: "RH", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Positive", "Negative"], normalQualitativeValues: ["Positive", "Negative"] }
    ]
  },
  {
    id: "srv-lab-ptinr",
    code: "PT-INR",
    name: "Prothrombin Time (PT) & INR",
    department: "Hematology",
    specimenType: "Citrated Plasma",
    containerType: "Light Blue Top (3.2% Na-Citrate)",
    methodology: "Photo-Optical Clot Detection (Sysmex CA-660)",
    tatMinutes: 90,
    price: 550,
    parameters: [
      { id: "p-pt", name: "Prothrombin Time (Patient)", analyzerCode: "PT", unit: "sec", refMinMale: 11, refMaxMale: 14.5, refMinFemale: 11, refMaxFemale: 14.5, criticalHigh: 45, decimalPlaces: 1 },
      { id: "p-pt-ctrl", name: "Mean Normal PT (Control)", analyzerCode: "PT_CTRL", unit: "sec", refMinMale: 11.5, refMaxMale: 13.5, refMinFemale: 11.5, refMaxFemale: 13.5, decimalPlaces: 1 },
      { id: "p-inr", name: "INR (International Normalized Ratio)", analyzerCode: "INR", unit: "INR", refMinMale: 0.85, refMaxMale: 1.2, refMinFemale: 0.85, refMaxFemale: 1.2, criticalHigh: 5, decimalPlaces: 2, isCalculated: true, formula: "{p-pt} / {p-pt-ctrl}" }
    ]
  },
  {
    id: "srv-lab-aptt",
    code: "APTT-01",
    name: "Activated Partial Thromboplastin Time (aPTT)",
    department: "Hematology",
    specimenType: "Citrated Plasma",
    containerType: "Light Blue Top (3.2% Na-Citrate)",
    methodology: "Photo-Optical Clot Detection",
    tatMinutes: 90,
    price: 600,
    parameters: [
      { id: "p-aptt", name: "aPTT (Patient)", analyzerCode: "APTT", unit: "sec", refMinMale: 25, refMaxMale: 36, refMinFemale: 25, refMaxFemale: 36, criticalHigh: 90, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-btct",
    code: "BT-CT",
    name: "Bleeding Time (BT) & Clotting Time (CT)",
    department: "Hematology",
    specimenType: "Capillary / Whole Blood",
    containerType: "Bedside Capillary & Test Tube",
    methodology: "Ivy / Duke Filter Paper & Lee-White Method",
    tatMinutes: 45,
    price: 250,
    parameters: [
      { id: "p-bt", name: "Bleeding Time (BT)", analyzerCode: "BT", unit: "min", refMinMale: 2, refMaxMale: 7, refMinFemale: 2, refMaxFemale: 7, criticalHigh: 15, decimalPlaces: 1 },
      { id: "p-ct", name: "Clotting Time (CT)", analyzerCode: "CT", unit: "min", refMinMale: 4, refMaxMale: 10, refMinFemale: 4, refMaxFemale: 10, criticalHigh: 20, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-ddimer",
    code: "DDIMER",
    name: "D-Dimer (Quantitative FEU)",
    department: "Hematology",
    specimenType: "Citrated Plasma",
    containerType: "Light Blue Top (3.2% Na-Citrate)",
    methodology: "Immunoturbidimetric / FIA Quantitative Assay",
    tatMinutes: 90,
    price: 1450,
    parameters: [
      { id: "p-ddimer", name: "D-Dimer (FEU)", analyzerCode: "DDIMER", unit: "ng/mL FEU", refMinMale: 0, refMaxMale: 500, refMinFemale: 0, refMaxFemale: 500, criticalHigh: 5e3, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-mp",
    code: "MP-ICT",
    name: "Malaria Parasite (Pf/Pv Antigen ICT & Smear)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender Top (3 mL)",
    methodology: "Rapid HRP-II / pLDH ICT & Giemsa Thick/Thin Film",
    tatMinutes: 60,
    price: 450,
    parameters: [
      { id: "p-mp-ict", name: "Malaria Antigen (Pf / Pv)", analyzerCode: "MP_AG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive (P. vivax)", "Positive (P. falciparum)", "Mixed Pf/Pv Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive (P. falciparum)", "Mixed Pf/Pv Positive"] },
      { id: "p-mp-smear", name: "Thick & Thin Smear Microscopy", analyzerCode: "MP_SMEAR", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["No Malaria Parasite Seen", "P. vivax Trophozoites Seen", "P. falciparum Rings Seen"], normalQualitativeValues: ["No Malaria Parasite Seen"], criticalQualitativeValues: ["P. falciparum Rings Seen"] }
    ]
  },
  {
    id: "srv-lab-dct",
    code: "DCT-01",
    name: "Direct Coombs Test (DAT)",
    department: "Hematology",
    specimenType: "EDTA Whole Blood",
    containerType: "Lavender Top (3 mL)",
    methodology: "Polyspecific Anti-Human Globulin Gel Card",
    tatMinutes: 120,
    price: 550,
    parameters: [
      { id: "p-dct", name: "Direct Coombs (DAT)", analyzerCode: "DCT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive (+1)", "Positive (+2)", "Positive (+3)"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive (+3)"] }
    ]
  },
  {
    id: "srv-lab-ict",
    code: "ICT-01",
    name: "Indirect Coombs Test (IAT Antibody Screen)",
    department: "Hematology",
    specimenType: "Serum + EDTA Whole Blood",
    containerType: "SST Gold Top + Lavender",
    methodology: "Anti-Human Globulin Gel Card Method",
    tatMinutes: 120,
    price: 600,
    parameters: [
      { id: "p-ict", name: "Indirect Coombs (IAT)", analyzerCode: "ICT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"] }
    ]
  },
  {
    id: "srv-lab-xmatch",
    code: "XMATCH",
    name: "Blood Crossmatch & Compatibility Testing",
    department: "Hematology",
    specimenType: "EDTA Whole Blood + Donor Segment",
    containerType: "Lavender Top (4 mL)",
    methodology: "Major & Minor Crossmatch (Saline + AHG Gel Card)",
    tatMinutes: 60,
    price: 750,
    parameters: [
      { id: "p-xm-patgrp", name: "Patient Blood Group", analyzerCode: "XM_PAT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["O Pos", "A Pos", "B Pos", "AB Pos", "O Neg", "A Neg", "B Neg", "AB Neg"], normalQualitativeValues: ["O Pos", "A Pos", "B Pos", "AB Pos", "O Neg", "A Neg", "B Neg", "AB Neg"] },
      { id: "p-xm-res", name: "Compatibility Result", analyzerCode: "XM_COMPAT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Compatible (Safe for Transfusion)", "Incompatible (DO NOT TRANSFUSE)"], normalQualitativeValues: ["Compatible (Safe for Transfusion)"], criticalQualitativeValues: ["Incompatible (DO NOT TRANSFUSE)"] }
    ]
  },
  // ==================== CLINICAL CHEMISTRY & ELECTROLYTES ====================
  {
    id: "srv-lab-elec",
    code: "ELEC-01",
    name: "Serum Electrolytes (Sodium, Potassium, Chloride, Ionized Ca)",
    department: "Clinical Chemistry",
    specimenType: "Serum / Lithium Heparin Plasma",
    containerType: "SST Gold Top / Green Top (4 mL)",
    methodology: "Direct Ion-Selective Electrode (ISE)",
    tatMinutes: 60,
    price: 850,
    parameters: [
      { id: "p-na", name: "Sodium (Na+)", analyzerCode: "NA", unit: "mmol/L", refMinMale: 135, refMaxMale: 145, refMinFemale: 135, refMaxFemale: 145, criticalLow: 120, criticalHigh: 160, decimalPlaces: 1 },
      { id: "p-k", name: "Potassium (K+)", analyzerCode: "K", unit: "mmol/L", refMinMale: 3.5, refMaxMale: 5.1, refMinFemale: 3.5, refMaxFemale: 5.1, criticalLow: 2.5, criticalHigh: 6.2, decimalPlaces: 2 },
      { id: "p-cl", name: "Chloride (Cl-)", analyzerCode: "CL", unit: "mmol/L", refMinMale: 98, refMaxMale: 107, refMinFemale: 98, refMaxFemale: 107, criticalLow: 80, criticalHigh: 120, decimalPlaces: 1 },
      { id: "p-ica", name: "Ionized Calcium (Ca++)", analyzerCode: "ICA", unit: "mmol/L", refMinMale: 1.12, refMaxMale: 1.32, refMinFemale: 1.12, refMaxFemale: 1.32, criticalLow: 0.85, criticalHigh: 1.6, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-ppbs",
    code: "PPBS-01",
    name: "Post-Prandial Blood Glucose (2-Hr PPBS)",
    department: "Clinical Chemistry",
    specimenType: "Fluoride Plasma",
    containerType: "Grey Top (2 mL)",
    methodology: "Hexokinase UV Enzymatic Assay",
    tatMinutes: 60,
    price: 250,
    parameters: [
      { id: "p-ppbs", name: "Glucose (2-Hr Post-Prandial)", analyzerCode: "GLU_PP", unit: "mg/dL", refMinMale: 70, refMaxMale: 140, refMinFemale: 70, refMaxFemale: 140, criticalLow: 45, criticalHigh: 450, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-rbs",
    code: "RBS-01",
    name: "Random Blood Glucose (RBS)",
    department: "Clinical Chemistry",
    specimenType: "Fluoride Plasma / Whole Blood",
    containerType: "Grey Top (2 mL)",
    methodology: "Hexokinase UV Enzymatic Assay",
    tatMinutes: 45,
    price: 200,
    parameters: [
      { id: "p-rbs", name: "Glucose (Random)", analyzerCode: "GLU_R", unit: "mg/dL", refMinMale: 70, refMaxMale: 140, refMinFemale: 70, refMaxFemale: 140, criticalLow: 45, criticalHigh: 450, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-ogtt",
    code: "OGTT-75",
    name: "Oral Glucose Tolerance Test (75g OGTT \u2014 Fasting, 1Hr, 2Hr)",
    department: "Clinical Chemistry",
    specimenType: "Fluoride Plasma (3 Timed Samples)",
    containerType: "3 \xD7 Grey Top (2 mL)",
    methodology: "Hexokinase UV Enzymatic Assay (DIPSI / ADA)",
    tatMinutes: 180,
    price: 650,
    parameters: [
      { id: "p-ogtt-0", name: "OGTT Fasting (0 Hr)", analyzerCode: "GLU_0H", unit: "mg/dL", refMinMale: 70, refMaxMale: 92, refMinFemale: 70, refMaxFemale: 92, decimalPlaces: 0 },
      { id: "p-ogtt-1", name: "OGTT 1-Hour Post 75g", analyzerCode: "GLU_1H", unit: "mg/dL", refMinMale: 70, refMaxMale: 180, refMinFemale: 70, refMaxFemale: 180, decimalPlaces: 0 },
      { id: "p-ogtt-2", name: "OGTT 2-Hour Post 75g", analyzerCode: "GLU_2H", unit: "mg/dL", refMinMale: 70, refMaxMale: 140, refMinFemale: 70, refMaxFemale: 140, criticalHigh: 400, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-ua",
    code: "UA-01",
    name: "Serum Uric Acid",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Uricase-Peroxidase Enzymatic Colorimetry",
    tatMinutes: 120,
    price: 400,
    parameters: [
      { id: "p-ua-only", name: "Serum Uric Acid", analyzerCode: "URIC", unit: "mg/dL", refMinMale: 3.5, refMaxMale: 7.2, refMinFemale: 2.6, refMaxFemale: 6, criticalHigh: 12, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-caphos",
    code: "CA-PHOS",
    name: "Serum Calcium (Total) & Inorganic Phosphorus",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Arsenazo III / Phosphomolybdate UV Photometry",
    tatMinutes: 120,
    price: 700,
    parameters: [
      { id: "p-ca", name: "Total Calcium (Serum)", analyzerCode: "CA", unit: "mg/dL", refMinMale: 8.6, refMaxMale: 10.3, refMinFemale: 8.6, refMaxFemale: 10.3, criticalLow: 6.5, criticalHigh: 13, decimalPlaces: 2 },
      { id: "p-phos", name: "Inorganic Phosphorus", analyzerCode: "PHOS", unit: "mg/dL", refMinMale: 2.5, refMaxMale: 4.5, refMinFemale: 2.5, refMaxFemale: 4.5, criticalLow: 1, criticalHigh: 9, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-mg",
    code: "MG-01",
    name: "Serum Magnesium (Mg2+)",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Xylidyl Blue Colorimetric Assay",
    tatMinutes: 120,
    price: 450,
    parameters: [
      { id: "p-mg", name: "Serum Magnesium", analyzerCode: "MG", unit: "mg/dL", refMinMale: 1.7, refMaxMale: 2.4, refMinFemale: 1.7, refMaxFemale: 2.4, criticalLow: 1, criticalHigh: 4.5, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-amyl",
    code: "AMYL-01",
    name: "Serum Amylase",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "IFCC EPS-G7 Kinetic Assay",
    tatMinutes: 120,
    price: 600,
    parameters: [
      { id: "p-amyl", name: "Serum Amylase", analyzerCode: "AMYL", unit: "U/L", refMinMale: 28, refMaxMale: 100, refMinFemale: 28, refMaxFemale: 100, criticalHigh: 300, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-lipase",
    code: "LIPASE-01",
    name: "Serum Lipase (Pancreatic)",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Enzymatic Colorimetric Methylresorufin Assay",
    tatMinutes: 120,
    price: 750,
    parameters: [
      { id: "p-lipa", name: "Serum Lipase", analyzerCode: "LIPA", unit: "U/L", refMinMale: 13, refMaxMale: 60, refMinFemale: 13, refMaxFemale: 60, criticalHigh: 250, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-protag",
    code: "PROT-AG",
    name: "Total Protein, Albumin, Globulin & A:G Ratio",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Biuret & Bromocresol Green (BCG)",
    tatMinutes: 120,
    price: 500,
    parameters: [
      { id: "p-pt-tp", name: "Total Protein", analyzerCode: "TP", unit: "g/dL", refMinMale: 6.4, refMaxMale: 8.3, refMinFemale: 6.4, refMaxFemale: 8.3, decimalPlaces: 1 },
      { id: "p-pt-alb", name: "Albumin", analyzerCode: "ALB", unit: "g/dL", refMinMale: 3.5, refMaxMale: 5.2, refMinFemale: 3.5, refMaxFemale: 5.2, criticalLow: 1.8, decimalPlaces: 1 },
      { id: "p-pt-glob", name: "Globulin (Calculated)", analyzerCode: "GLOB", unit: "g/dL", refMinMale: 2, refMaxMale: 3.5, refMinFemale: 2, refMaxFemale: 3.5, decimalPlaces: 1, isCalculated: true, formula: "{p-pt-tp} - {p-pt-alb}" },
      { id: "p-pt-ag", name: "A:G Ratio", analyzerCode: "AG_RATIO", unit: "ratio", refMinMale: 1, refMaxMale: 2.2, refMinFemale: 1, refMaxFemale: 2.2, decimalPlaces: 2, isCalculated: true, formula: "{p-pt-alb} / ({p-pt-tp} - {p-pt-alb})" }
    ]
  },
  {
    id: "srv-lab-ggt",
    code: "GGT-01",
    name: "Gamma-Glutamyl Transferase (GGT)",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "IFCC Enzymatic Colorimetric Assay",
    tatMinutes: 120,
    price: 500,
    parameters: [
      { id: "p-ggt", name: "GGT", analyzerCode: "GGT", unit: "U/L", refMinMale: 10, refMaxMale: 60, refMinFemale: 7, refMaxFemale: 40, criticalHigh: 300, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-ldh",
    code: "LDH-01",
    name: "Lactate Dehydrogenase (LDH)",
    department: "Clinical Chemistry",
    specimenType: "Non-Hemolyzed Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "IFCC Lactate-to-Pyruvate UV Kinetic Assay",
    tatMinutes: 120,
    price: 550,
    parameters: [
      { id: "p-ldh", name: "Serum LDH", analyzerCode: "LDH", unit: "U/L", refMinMale: 135, refMaxMale: 225, refMinFemale: 135, refMaxFemale: 214, criticalHigh: 1e3, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-cpk",
    code: "CK-NAC",
    name: "Creatine Kinase Total (CPK) & CK-MB Panel",
    department: "Clinical Chemistry",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "IFCC NAC-Activated Kinetic / Immunoinhibition Assay",
    tatMinutes: 90,
    price: 950,
    parameters: [
      { id: "p-cpk", name: "CK Total (CPK)", analyzerCode: "CPK", unit: "U/L", refMinMale: 39, refMaxMale: 308, refMinFemale: 26, refMaxFemale: 192, criticalHigh: 1500, decimalPlaces: 0 },
      { id: "p-ckmb", name: "CK-MB Activity", analyzerCode: "CKMB", unit: "U/L", refMinMale: 0, refMaxMale: 24, refMinFemale: 0, refMaxFemale: 24, criticalHigh: 50, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-tropi",
    code: "TROP-I",
    name: "High-Sensitivity Troponin-I (Cardiac Quantitative)",
    department: "Clinical Chemistry",
    specimenType: "Serum / Heparin Plasma",
    containerType: "SST Gold Top / Green Top (STAT)",
    methodology: "Chemiluminescent Immunoassay (hs-cTnI)",
    tatMinutes: 45,
    price: 1500,
    parameters: [
      { id: "p-tropi", name: "Troponin-I (Quantitative)", analyzerCode: "TROPI", unit: "ng/mL", refMinMale: 0, refMaxMale: 0.04, refMinFemale: 0, refMaxFemale: 0.04, criticalHigh: 0.5, decimalPlaces: 3 }
    ],
    interpretations: {
      normal: "Troponin-I within 99th percentile reference cut-off (<0.04 ng/mL). Repeat at 3 hours if acute chest pain onset <3h.",
      abnormalHigh: "Elevated cardiac Troponin-I indicates acute myocardial injury; correlate urgently with 12-lead ECG & ACS protocol.",
      critical: "CRITICAL ACS ALERT: Markedly elevated Troponin-I \u2014 immediate cardiology / ER STEMI/NSTEMI intervention."
    }
  },
  {
    id: "srv-lab-iron",
    code: "IRON-PRO",
    name: "Iron Studies Profile (Serum Iron, TIBC, UIBC, Transferrin Sat %)",
    department: "Clinical Chemistry",
    specimenType: "Fasting Serum (Morning)",
    containerType: "SST Gold Top (5 mL)",
    methodology: "FerroZine Colorimetric Assay",
    tatMinutes: 180,
    price: 1350,
    parameters: [
      { id: "p-fe", name: "Serum Iron", analyzerCode: "IRON", unit: "\xB5g/dL", refMinMale: 65, refMaxMale: 175, refMinFemale: 50, refMaxFemale: 170, decimalPlaces: 0 },
      { id: "p-tibc", name: "TIBC (Total Iron Binding Capacity)", analyzerCode: "TIBC", unit: "\xB5g/dL", refMinMale: 250, refMaxMale: 450, refMinFemale: 250, refMaxFemale: 450, decimalPlaces: 0 },
      { id: "p-uibc", name: "UIBC (Calculated)", analyzerCode: "UIBC", unit: "\xB5g/dL", refMinMale: 110, refMaxMale: 370, refMinFemale: 110, refMaxFemale: 370, decimalPlaces: 0, isCalculated: true, formula: "{p-tibc} - {p-fe}" },
      { id: "p-tsat", name: "Transferrin Saturation (%)", analyzerCode: "TSAT", unit: "%", refMinMale: 20, refMaxMale: 50, refMinFemale: 15, refMaxFemale: 50, decimalPlaces: 1, isCalculated: true, formula: "({p-fe} * 100) / {p-tibc}" }
    ]
  },
  {
    id: "srv-lab-abg",
    code: "ABG-01",
    name: "Arterial Blood Gas (ABG + Lactate + Electrolytes)",
    department: "Clinical Chemistry",
    specimenType: "Heparinized Arterial Blood (On Ice)",
    containerType: "Pre-Heparinized ABG Syringe (STAT)",
    methodology: "Electrochemical Blood Gas Analyzer (ABL80)",
    tatMinutes: 20,
    price: 1600,
    parameters: [
      { id: "p-abg-ph", name: "Arterial pH", analyzerCode: "ABG_PH", unit: "pH", refMinMale: 7.35, refMaxMale: 7.45, refMinFemale: 7.35, refMaxFemale: 7.45, criticalLow: 7.2, criticalHigh: 7.6, decimalPlaces: 2 },
      { id: "p-abg-pco2", name: "pCO2", analyzerCode: "PCO2", unit: "mmHg", refMinMale: 35, refMaxMale: 45, refMinFemale: 35, refMaxFemale: 45, criticalLow: 20, criticalHigh: 70, decimalPlaces: 1 },
      { id: "p-abg-po2", name: "pO2", analyzerCode: "PO2", unit: "mmHg", refMinMale: 80, refMaxMale: 100, refMinFemale: 80, refMaxFemale: 100, criticalLow: 50, decimalPlaces: 1 },
      { id: "p-abg-hco3", name: "HCO3- (Bicarbonate)", analyzerCode: "HCO3", unit: "mmol/L", refMinMale: 22, refMaxMale: 26, refMinFemale: 22, refMaxFemale: 26, criticalLow: 12, criticalHigh: 40, decimalPlaces: 1 },
      { id: "p-abg-spo2", name: "SaO2 / SpO2", analyzerCode: "SPO2", unit: "%", refMinMale: 95, refMaxMale: 100, refMinFemale: 95, refMaxFemale: 100, criticalLow: 85, decimalPlaces: 1 },
      { id: "p-abg-lac", name: "Arterial Lactate", analyzerCode: "LAC", unit: "mmol/L", refMinMale: 0.5, refMaxMale: 2, refMinFemale: 0.5, refMaxFemale: 2, criticalHigh: 4, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-microalb",
    code: "MICROALB",
    name: "Urine Microalbumin & Albumin-Creatinine Ratio (uACR)",
    department: "Clinical Chemistry",
    specimenType: "Spot Random Urine",
    containerType: "Sterile Urine Container (20 mL)",
    methodology: "Immunoturbidimetric + Enzymatic Urine Creatinine",
    tatMinutes: 150,
    price: 850,
    parameters: [
      { id: "p-ualb-mg", name: "Urine Microalbumin", analyzerCode: "UALB_MG", unit: "mg/L", refMinMale: 0, refMaxMale: 20, refMinFemale: 0, refMaxFemale: 20, decimalPlaces: 1 },
      { id: "p-uacr", name: "Albumin / Creatinine Ratio (uACR)", analyzerCode: "UACR", unit: "mg/g", refMinMale: 0, refMaxMale: 30, refMinFemale: 0, refMaxFemale: 30, criticalHigh: 300, decimalPlaces: 1 }
    ]
  },
  // ==================== ENDOCRINOLOGY & TUMOR MARKERS ====================
  {
    id: "srv-lab-tsh",
    code: "TSH-01",
    name: "TSH Ultra-Sensitive (Thyroid Stimulating Hormone)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "CLIA 3rd Generation Assay",
    tatMinutes: 180,
    price: 650,
    parameters: [
      { id: "p-tsh-only", name: "TSH Ultra-Sensitive", analyzerCode: "TSH", unit: "\xB5IU/mL", refMinMale: 0.35, refMaxMale: 4.94, refMinFemale: 0.35, refMaxFemale: 4.94, criticalLow: 0.01, criticalHigh: 50, decimalPlaces: 3 }
    ]
  },
  {
    id: "srv-lab-t3t4tsh",
    code: "T3T4TSH",
    name: "Total Thyroid Profile (T3, T4, TSH)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Chemiluminescent Immunoassay (CLIA)",
    tatMinutes: 240,
    price: 1200,
    parameters: [
      { id: "p-tt3", name: "Total T3 (Triiodothyronine)", analyzerCode: "TT3", unit: "ng/dL", refMinMale: 80, refMaxMale: 200, refMinFemale: 80, refMaxFemale: 200, decimalPlaces: 1 },
      { id: "p-tt4", name: "Total T4 (Thyroxine)", analyzerCode: "TT4", unit: "\xB5g/dL", refMinMale: 5.1, refMaxMale: 14.1, refMinFemale: 5.1, refMaxFemale: 14.1, decimalPlaces: 2 },
      { id: "p-ttsh", name: "TSH", analyzerCode: "TSH", unit: "\xB5IU/mL", refMinMale: 0.35, refMaxMale: 4.94, refMinFemale: 0.35, refMaxFemale: 4.94, criticalLow: 0.01, criticalHigh: 50, decimalPlaces: 3 }
    ]
  },
  {
    id: "srv-lab-ferr",
    code: "FERR-01",
    name: "Serum Ferritin",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "CMIA / ECLIA Immunoassay",
    tatMinutes: 180,
    price: 950,
    parameters: [
      { id: "p-ferr", name: "Serum Ferritin", analyzerCode: "FERR", unit: "ng/mL", refMinMale: 30, refMaxMale: 400, refMinFemale: 15, refMaxFemale: 150, criticalLow: 5, criticalHigh: 2e3, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-vitb12",
    code: "VITB12",
    name: "Vitamin B12 (Cyanocobalamin)",
    department: "Endocrinology",
    specimenType: "Fasting Serum (Light Protected)",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Chemiluminescent Immunoassay (CLIA)",
    tatMinutes: 240,
    price: 1300,
    parameters: [
      { id: "p-vitb12", name: "Vitamin B12", analyzerCode: "VITB12", unit: "pg/mL", refMinMale: 211, refMaxMale: 911, refMinFemale: 211, refMaxFemale: 911, criticalLow: 100, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-folate",
    code: "FOLATE",
    name: "Serum Folate (Folic Acid)",
    department: "Endocrinology",
    specimenType: "Non-Hemolyzed Fasting Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "CLIA Competitive Binding Assay",
    tatMinutes: 240,
    price: 1250,
    parameters: [
      { id: "p-folate", name: "Serum Folate", analyzerCode: "FOLATE", unit: "ng/mL", refMinMale: 3.1, refMaxMale: 20.5, refMinFemale: 3.1, refMaxFemale: 20.5, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-bhcg",
    code: "BHCG-QN",
    name: "Serum Beta-hCG (Quantitative)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Two-Site Sandwich Immunoassay",
    tatMinutes: 120,
    price: 950,
    parameters: [
      { id: "p-bhcg", name: "Serum Total \u03B2-hCG", analyzerCode: "BHCG", unit: "mIU/mL", refMinMale: 0, refMaxMale: 5, refMinFemale: 0, refMaxFemale: 5, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-prl",
    code: "PRL-01",
    name: "Serum Prolactin (PRL)",
    department: "Endocrinology",
    specimenType: "Resting Morning Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 180,
    price: 850,
    parameters: [
      { id: "p-prl", name: "Serum Prolactin", analyzerCode: "PRL", unit: "ng/mL", refMinMale: 4, refMaxMale: 15.2, refMinFemale: 4.8, refMaxFemale: 23.3, criticalHigh: 200, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-fshlh",
    code: "FSH-LH",
    name: "FSH & LH Reproductive Gonadotropin Panel",
    department: "Endocrinology",
    specimenType: "Serum (Day 2-3 Cycle Preferred)",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Chemiluminescent Immunoassay (CLIA)",
    tatMinutes: 180,
    price: 1400,
    parameters: [
      { id: "p-fsh", name: "FSH (Follicle Stimulating Hormone)", analyzerCode: "FSH", unit: "mIU/mL", refMinMale: 1.5, refMaxMale: 12.4, refMinFemale: 3.5, refMaxFemale: 12.5, decimalPlaces: 2 },
      { id: "p-lh", name: "LH (Luteinizing Hormone)", analyzerCode: "LH", unit: "mIU/mL", refMinMale: 1.7, refMaxMale: 8.6, refMinFemale: 2.4, refMaxFemale: 12.6, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-e2",
    code: "ESTRAD",
    name: "Serum Estradiol (E2)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 240,
    price: 1050,
    parameters: [
      { id: "p-e2", name: "Estradiol (E2)", analyzerCode: "E2", unit: "pg/mL", refMinMale: 11, refMaxMale: 44, refMinFemale: 21, refMaxFemale: 251, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-prog",
    code: "PROG-01",
    name: "Serum Progesterone",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 240,
    price: 1050,
    parameters: [
      { id: "p-prog", name: "Progesterone", analyzerCode: "PROG", unit: "ng/mL", refMinMale: 0.1, refMaxMale: 0.8, refMinFemale: 0.2, refMaxFemale: 24, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-testo",
    code: "TESTO-T",
    name: "Total Testosterone (Morning Sample)",
    department: "Endocrinology",
    specimenType: "Morning Serum (08:00-10:00 AM)",
    containerType: "SST Gold Top (5 mL)",
    methodology: "CLIA Immunoassay",
    tatMinutes: 240,
    price: 1150,
    parameters: [
      { id: "p-testo", name: "Total Testosterone", analyzerCode: "TESTO", unit: "ng/dL", refMinMale: 249, refMaxMale: 836, refMinFemale: 8, refMaxFemale: 48, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-amh",
    code: "AMH-01",
    name: "Anti-M\xFCllerian Hormone (AMH Ovarian Reserve)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Gen II Automated Assay",
    tatMinutes: 360,
    price: 2600,
    parameters: [
      { id: "p-amh", name: "Anti-M\xFCllerian Hormone (AMH)", analyzerCode: "AMH", unit: "ng/mL", refMinMale: 1.5, refMaxMale: 10, refMinFemale: 1, refMaxFemale: 4, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-cort",
    code: "CORT-AM",
    name: "Serum Cortisol (8:00 AM Morning)",
    department: "Endocrinology",
    specimenType: "Morning Serum (08:00 AM)",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 240,
    price: 1e3,
    parameters: [
      { id: "p-cort", name: "Serum Cortisol (AM)", analyzerCode: "CORT", unit: "\xB5g/dL", refMinMale: 6.2, refMaxMale: 19.4, refMinFemale: 6.2, refMaxFemale: 19.4, criticalLow: 2, criticalHigh: 45, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-ins",
    code: "INS-F",
    name: "Fasting Serum Insulin",
    department: "Endocrinology",
    specimenType: "Fasting Serum (8-12 Hrs)",
    containerType: "SST Gold Top (5 mL)",
    methodology: "CLIA Two-Site Assay",
    tatMinutes: 240,
    price: 1100,
    parameters: [
      { id: "p-insf", name: "Insulin (Fasting)", analyzerCode: "INS_F", unit: "\xB5IU/mL", refMinMale: 2.6, refMaxMale: 24.9, refMinFemale: 2.6, refMaxFemale: 24.9, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-pth",
    code: "PTH-01",
    name: "Intact Parathyroid Hormone (iPTH)",
    department: "Endocrinology",
    specimenType: "EDTA Plasma / Chilled Serum",
    containerType: "Lavender Top (4 mL, Cold Chain)",
    methodology: "ECLIA Intact PTH Assay",
    tatMinutes: 240,
    price: 1650,
    parameters: [
      { id: "p-pth", name: "Intact PTH", analyzerCode: "PTH", unit: "pg/mL", refMinMale: 15, refMaxMale: 65, refMinFemale: 15, refMaxFemale: 65, criticalLow: 5, criticalHigh: 250, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-psa",
    code: "PSA-TOT",
    name: "Prostate-Specific Antigen (Total PSA)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Sandwich Immunoassay",
    tatMinutes: 180,
    price: 1050,
    parameters: [
      { id: "p-psa", name: "Total PSA", analyzerCode: "PSA", unit: "ng/mL", refMinMale: 0, refMaxMale: 4, refMinFemale: 0, refMaxFemale: 0.5, criticalHigh: 20, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-ca125",
    code: "CA125-01",
    name: "CA-125 Ovarian Tumor Marker",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 240,
    price: 1500,
    parameters: [
      { id: "p-ca125", name: "CA-125", analyzerCode: "CA125", unit: "U/mL", refMinMale: 0, refMaxMale: 35, refMinFemale: 0, refMaxFemale: 35, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-cea",
    code: "CEA-01",
    name: "Carcinoembryonic Antigen (CEA)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 240,
    price: 1250,
    parameters: [
      { id: "p-cea", name: "Serum CEA", analyzerCode: "CEA", unit: "ng/mL", refMinMale: 0, refMaxMale: 3.8, refMinFemale: 0, refMaxFemale: 3.8, decimalPlaces: 2 }
    ]
  },
  {
    id: "srv-lab-afp",
    code: "AFP-01",
    name: "Alpha-Fetoprotein (AFP)",
    department: "Endocrinology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "ECLIA Immunoassay",
    tatMinutes: 240,
    price: 1250,
    parameters: [
      { id: "p-afp", name: "Serum AFP", analyzerCode: "AFP", unit: "ng/mL", refMinMale: 0, refMaxMale: 8.5, refMinFemale: 0, refMaxFemale: 8.5, decimalPlaces: 2 }
    ]
  },
  // ==================== IMMUNOLOGY & INFECTIOUS SEROLOGY ====================
  {
    id: "srv-lab-widal",
    code: "WIDAL-01",
    name: "Widal Tube Agglutination Test (Salmonella Typhi / Paratyphi)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Quantitative Tube Agglutination Titre",
    tatMinutes: 120,
    price: 350,
    parameters: [
      { id: "p-wid-to", name: 'S. Typhi "O" Antigen Titre', analyzerCode: "WIDAL_TO", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (<1:40)", "1:40", "1:80", "1:160 (Positive)", "1:320 (High Titre)"], normalQualitativeValues: ["Negative (<1:40)", "1:40"], criticalQualitativeValues: ["1:320 (High Titre)"] },
      { id: "p-wid-th", name: 'S. Typhi "H" Antigen Titre', analyzerCode: "WIDAL_TH", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (<1:40)", "1:40", "1:80", "1:160 (Positive)", "1:320 (High Titre)"], normalQualitativeValues: ["Negative (<1:40)", "1:40"], criticalQualitativeValues: ["1:320 (High Titre)"] },
      { id: "p-wid-ah", name: 'S. Paratyphi "AH" Titre', analyzerCode: "WIDAL_AH", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (<1:40)", "1:40", "1:80", "1:160 (Positive)"], normalQualitativeValues: ["Negative (<1:40)", "1:40"] },
      { id: "p-wid-bh", name: 'S. Paratyphi "BH" Titre', analyzerCode: "WIDAL_BH", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (<1:40)", "1:40", "1:80", "1:160 (Positive)"], normalQualitativeValues: ["Negative (<1:40)", "1:40"] }
    ]
  },
  {
    id: "srv-lab-typhidot",
    code: "TYPHI-DOT",
    name: "Typhidot IgM / IgG Rapid Serology",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Lateral Flow Immunochromatography (ICT)",
    tatMinutes: 60,
    price: 650,
    parameters: [
      { id: "p-typhi-igm", name: "Salmonella Typhi IgM", analyzerCode: "TYPHI_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] },
      { id: "p-typhi-igg", name: "Salmonella Typhi IgG", analyzerCode: "TYPHI_IGG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"] }
    ]
  },
  {
    id: "srv-lab-dengue",
    code: "DENGUE-01",
    name: "Dengue Combo Duo Panel (NS1 Antigen, IgM & IgG)",
    department: "Immunology",
    specimenType: "Serum / EDTA Plasma",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Rapid Immunochromatographic Assay (ICT)",
    tatMinutes: 60,
    price: 1400,
    parameters: [
      { id: "p-den-ns1", name: "Dengue NS1 Antigen", analyzerCode: "DEN_NS1", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] },
      { id: "p-den-igm", name: "Dengue IgM Antibody", analyzerCode: "DEN_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] },
      { id: "p-den-igg", name: "Dengue IgG Antibody", analyzerCode: "DEN_IGG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"] }
    ]
  },
  {
    id: "srv-lab-scrub",
    code: "SCRUB-01",
    name: "Scrub Typhus IgM Antibody (Orientia tsutsugamushi)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Lateral Flow ICT / ELISA",
    tatMinutes: 90,
    price: 1200,
    parameters: [
      { id: "p-scrub-igm", name: "Scrub Typhus IgM", analyzerCode: "SCRUB_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] }
    ]
  },
  {
    id: "srv-lab-lepto",
    code: "LEPTO-01",
    name: "Leptospira IgM Antibody Screen",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Immunochromatographic Rapid Test",
    tatMinutes: 90,
    price: 1100,
    parameters: [
      { id: "p-lepto-igm", name: "Leptospira IgM", analyzerCode: "LEPTO_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] }
    ]
  },
  {
    id: "srv-lab-ra",
    code: "RA-QN",
    name: "Rheumatoid Factor (RA Factor Quantitative)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Latex-Enhanced Immunoturbidimetry",
    tatMinutes: 120,
    price: 650,
    parameters: [
      { id: "p-rf", name: "Rheumatoid Factor (RF)", analyzerCode: "RF", unit: "IU/mL", refMinMale: 0, refMaxMale: 14, refMinFemale: 0, refMaxFemale: 14, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-aso",
    code: "ASO-QN",
    name: "Anti-Streptolysin O (ASO) Quantitative Titre",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Latex-Enhanced Immunoturbidimetry",
    tatMinutes: 120,
    price: 650,
    parameters: [
      { id: "p-aso", name: "ASO Titre", analyzerCode: "ASO", unit: "IU/mL", refMinMale: 0, refMaxMale: 200, refMinFemale: 0, refMaxFemale: 200, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-ana",
    code: "ANA-SCR",
    name: "Antinuclear Antibody (ANA Screen \u2014 IFA / ELISA)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Indirect Immunofluorescence (HEp-2) / ELISA Index",
    tatMinutes: 360,
    price: 1650,
    parameters: [
      { id: "p-ana-res", name: "ANA Qualitative Screen", analyzerCode: "ANA_RES", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (<1:40)", "Equivocal (1:40)", "Positive (1:80)", "Strongly Positive (\u22651:160)"], normalQualitativeValues: ["Negative (<1:40)"], criticalQualitativeValues: ["Strongly Positive (\u22651:160)"] },
      { id: "p-ana-pat", name: "Immunofluorescence Pattern", analyzerCode: "ANA_PAT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["N/A", "Homogeneous", "Speckled", "Nucleolar", "Centromere"], normalQualitativeValues: ["N/A"] }
    ]
  },
  {
    id: "srv-lab-atpo",
    code: "ANTITPO",
    name: "Anti-TPO (Thyroid Peroxidase Antibody)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "CLIA Quantitative Assay",
    tatMinutes: 240,
    price: 1450,
    parameters: [
      { id: "p-atpo", name: "Anti-TPO Antibody", analyzerCode: "ATPO", unit: "IU/mL", refMinMale: 0, refMaxMale: 34, refMinFemale: 0, refMaxFemale: 34, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-hbsag",
    code: "HBSAG-1",
    name: "HBsAg (Hepatitis B Surface Antigen)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (4 mL)",
    methodology: "CLIA / Rapid ICT Card",
    tatMinutes: 60,
    price: 450,
    parameters: [
      { id: "p-hbsag-1", name: "HBsAg", analyzerCode: "HBSAG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] }
    ]
  },
  {
    id: "srv-lab-hcv",
    code: "HCV-1",
    name: "Anti-HCV Antibody (Hepatitis C Screen)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (4 mL)",
    methodology: "CLIA / Rapid ICT Card",
    tatMinutes: 60,
    price: 600,
    parameters: [
      { id: "p-hcv-1", name: "Anti-HCV", analyzerCode: "HCV", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] }
    ]
  },
  {
    id: "srv-lab-hiv",
    code: "HIV-1",
    name: "HIV I & II Antibody / p24 Antigen Screen",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (4 mL)",
    methodology: "4th Gen CLIA / Determine Tri-Line ICT",
    tatMinutes: 60,
    price: 550,
    parameters: [
      { id: "p-hiv-1", name: "HIV I & II", analyzerCode: "HIV", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] }
    ]
  },
  {
    id: "srv-lab-vdrl",
    code: "VDRL-1",
    name: "VDRL / RPR (Syphilis Screen)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (4 mL)",
    methodology: "Carbon Antigen RPR Flocculation / TPHA ICT",
    tatMinutes: 60,
    price: 350,
    parameters: [
      { id: "p-vdrl-1", name: "VDRL / RPR", analyzerCode: "VDRL", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Reactive (Weak)", "Reactive (1:8+)"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive (1:8+)"] }
    ]
  },
  {
    id: "srv-lab-hpylori",
    code: "HPYLORI",
    name: "Helicobacter pylori Stool Antigen / Serum Screen",
    department: "Immunology",
    specimenType: "Stool / Serum",
    containerType: "Sterile Container",
    methodology: "Monoclonal Lateral Flow ICT",
    tatMinutes: 60,
    price: 850,
    parameters: [
      { id: "p-hpylori", name: "H. pylori Antigen/Antibody", analyzerCode: "HPYLORI", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"] }
    ]
  },
  {
    id: "srv-lab-torch",
    code: "TORCH-IGM",
    name: "TORCH IgM Panel (Toxo, Rubella, CMV, HSV 1/2)",
    department: "Immunology",
    specimenType: "Serum",
    containerType: "SST Gold Top (5 mL)",
    methodology: "Chemiluminescent Immunoassay (CLIA)",
    tatMinutes: 360,
    price: 3200,
    parameters: [
      { id: "p-torch-toxo", name: "Toxoplasma gondii IgM", analyzerCode: "TOXO_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Equivocal", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] },
      { id: "p-torch-rub", name: "Rubella Virus IgM", analyzerCode: "RUB_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Equivocal", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] },
      { id: "p-torch-cmv", name: "Cytomegalovirus (CMV) IgM", analyzerCode: "CMV_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Equivocal", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] },
      { id: "p-torch-hsv", name: "HSV 1 & 2 IgM", analyzerCode: "HSV_IGM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Non-Reactive", "Equivocal", "Reactive"], normalQualitativeValues: ["Non-Reactive"], criticalQualitativeValues: ["Reactive"] }
    ]
  },
  // ==================== MICROBIOLOGY & CLINICAL PATHOLOGY ====================
  {
    id: "srv-lab-urinecs",
    code: "URINE-CS",
    name: "Urine Culture & Antibiotic Sensitivity (C/S)",
    department: "Microbiology",
    specimenType: "Mid-Stream Clean Catch Urine",
    containerType: "Sterile Wide-Mouth Urine Container",
    methodology: "CLED / MacConkey Agar Aerobic Culture + Kirby-Bauer AST",
    tatMinutes: 2880,
    price: 850,
    parameters: [
      { id: "p-ucs-growth", name: "Culture Growth (48 Hr)", analyzerCode: "UCS_GRW", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["No Growth after 48 hours", "Significant Growth (>10^5 CFU/mL)", "Insignificant / Mixed Flora"], normalQualitativeValues: ["No Growth after 48 hours"] },
      { id: "p-ucs-org", name: "Isolated Organism", analyzerCode: "UCS_ORG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["None", "Escherichia coli", "Klebsiella pneumoniae", "Pseudomonas aeruginosa", "Enterococcus faecalis", "Staphylococcus saprophyticus", "Candida species"], normalQualitativeValues: ["None"] },
      { id: "p-ucs-sens", name: "Sensitive Antibiotics (First-Line)", analyzerCode: "UCS_SEN", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Not Applicable", "Nitrofurantoin, Fosfomycin, Amikacin", "Cefixime, Ceftriaxone, Gentamicin", "Meropenem, Piperacillin-Tazobactam"], normalQualitativeValues: ["Not Applicable"] }
    ]
  },
  {
    id: "srv-lab-bloodcs",
    code: "BLOOD-CS",
    name: "Blood Culture & Sensitivity (Automated BacT/ALERT)",
    department: "Microbiology",
    specimenType: "Whole Blood in Aerobic Culture Bottle",
    containerType: "BacT/ALERT Blood Culture Bottle (10 mL)",
    methodology: "Automated Continuous Monitoring + VITEK/Disc AST",
    tatMinutes: 4320,
    price: 1500,
    parameters: [
      { id: "p-bcs-growth", name: "Culture Status (5-Day Protocol)", analyzerCode: "BCS_GRW", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Sterile / No Growth after 5 days", "Positive Growth Flagged"], normalQualitativeValues: ["Sterile / No Growth after 5 days"], criticalQualitativeValues: ["Positive Growth Flagged"] },
      { id: "p-bcs-org", name: "Isolated Pathogen", analyzerCode: "BCS_ORG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["None", "Salmonella enterica serovar Typhi", "Staphylococcus aureus", "Escherichia coli", "Klebsiella pneumoniae", "Acinetobacter baumannii"], normalQualitativeValues: ["None"] }
    ]
  },
  {
    id: "srv-lab-puscs",
    code: "PUS-CS",
    name: "Pus / Wound Swab / Sputum Culture & Sensitivity (C/S)",
    department: "Microbiology",
    specimenType: "Pus Aspirate / Swab in Stuart Medium",
    containerType: "Sterile Swab Tube",
    methodology: "Blood & MacConkey Agar Culture + CLSI AST",
    tatMinutes: 2880,
    price: 950,
    parameters: [
      { id: "p-pcs-growth", name: "Culture Outcome", analyzerCode: "PCS_GRW", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["No Pathogenic Growth", "Heavy Pathogen Growth", "Moderate Pathogen Growth"], normalQualitativeValues: ["No Pathogenic Growth"] },
      { id: "p-pcs-org", name: "Organism Identified", analyzerCode: "PCS_ORG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["None", "Staphylococcus aureus (MSSA)", "MRSA", "Pseudomonas aeruginosa", "Escherichia coli", "Klebsiella spp."], normalQualitativeValues: ["None"], criticalQualitativeValues: ["MRSA"] }
    ]
  },
  {
    id: "srv-lab-sputumafb",
    code: "SPUTUM-AFB",
    name: "Sputum AFB Smear (Ziehl-Neelsen) & Direct Gram Stain",
    department: "Microbiology",
    specimenType: "Early Morning Deep Cough Sputum",
    containerType: "Wide-Mouth Leak-Proof Sputum Cup",
    methodology: "Ziehl-Neelsen Carbol Fuchsin Acid-Fast Microscopy",
    tatMinutes: 120,
    price: 400,
    parameters: [
      { id: "p-afb-res", name: "AFB (Mycobacterium tuberculosis)", analyzerCode: "AFB", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (No AFB Seen)", "Scanty (1-9 AFB / 100 Fields)", "Positive (+1)", "Positive (+2)", "Positive (+3)"], normalQualitativeValues: ["Negative (No AFB Seen)"], criticalQualitativeValues: ["Positive (+1)", "Positive (+2)", "Positive (+3)"] },
      { id: "p-afb-gram", name: "Gram Stain Finding", analyzerCode: "GRAM_SPUT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Normal Upper Respiratory Flora", "Gram-Positive Diplococci", "Gram-Negative Bacilli"], normalQualitativeValues: ["Normal Upper Respiratory Flora"] }
    ]
  },
  {
    id: "srv-lab-stoolre",
    code: "STOOL-RE",
    name: "Stool Routine & Microscopic Examination (Ova / Cyst / Pus)",
    department: "Microbiology",
    specimenType: "Fresh Stool Sample",
    containerType: "Sterile Stool Container with Scoop",
    methodology: "Macroscopic + Saline/Iodine Wet Mount Microscopy",
    tatMinutes: 90,
    price: 250,
    parameters: [
      { id: "p-st-cons", name: "Consistency & Color", analyzerCode: "ST_CONS", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Soft / Formed Brown", "Loose / Watery", "Mucoid / Blood-Tinged"], normalQualitativeValues: ["Soft / Formed Brown"] },
      { id: "p-st-ova", name: "Ova / Parasites", analyzerCode: "ST_OVA", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["None Seen", "Ascaris Ova Seen", "Hookworm Ova Seen", "H. nana Ova Seen"], normalQualitativeValues: ["None Seen"] },
      { id: "p-st-cyst", name: "Protozoal Cysts / Trophozoites", analyzerCode: "ST_CYST", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["None Seen", "Giardia lamblia Cysts Seen", "Entamoeba histolytica Seen"], normalQualitativeValues: ["None Seen"] },
      { id: "p-st-pus", name: "Pus Cells (/HPF)", analyzerCode: "ST_PUS", unit: "/HPF", refMinMale: 0, refMaxMale: 3, refMinFemale: 0, refMaxFemale: 3, criticalHigh: 30, decimalPlaces: 0 },
      { id: "p-st-rbc", name: "RBCs (/HPF)", analyzerCode: "ST_RBC", unit: "/HPF", refMinMale: 0, refMaxMale: 1, refMinFemale: 0, refMaxFemale: 1, criticalHigh: 20, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-stoolob",
    code: "STOOL-OB",
    name: "Stool Occult Blood Test (Immunochemical FOBT)",
    department: "Microbiology",
    specimenType: "Fresh Stool",
    containerType: "Sterile Stool Container",
    methodology: "Human Hemoglobin Immunochromatographic Assay",
    tatMinutes: 60,
    price: 300,
    parameters: [
      { id: "p-st-ob", name: "Occult Blood (Human Hb)", analyzerCode: "FOB", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] }
    ]
  },
  {
    id: "srv-lab-semen",
    code: "SEMEN-01",
    name: "Semen Analysis (WHO 6th Edition Fertility Profile)",
    department: "Microbiology",
    specimenType: "Fresh Ejaculate (3-5 Days Abstinence)",
    containerType: "Sterile Wide-Mouth Container (37\xB0C)",
    methodology: "Macroscopic Liquefaction + Makler Chamber Microscopy",
    tatMinutes: 120,
    price: 600,
    parameters: [
      { id: "p-sem-vol", name: "Volume", analyzerCode: "SEM_VOL", unit: "mL", refMinMale: 1.4, refMaxMale: 6, refMinFemale: 1.4, refMaxFemale: 6, decimalPlaces: 1 },
      { id: "p-sem-liq", name: "Liquefaction Time", analyzerCode: "SEM_LIQ", unit: "min", refMinMale: 15, refMaxMale: 60, refMinFemale: 15, refMaxFemale: 60, decimalPlaces: 0 },
      { id: "p-sem-conc", name: "Sperm Concentration", analyzerCode: "SEM_CONC", unit: "Million/mL", refMinMale: 16, refMaxMale: 150, refMinFemale: 16, refMaxFemale: 150, decimalPlaces: 1 },
      { id: "p-sem-mot", name: "Total Motility (PR + NP)", analyzerCode: "SEM_MOT", unit: "%", refMinMale: 42, refMaxMale: 95, refMinFemale: 42, refMaxFemale: 95, decimalPlaces: 0 },
      { id: "p-sem-morph", name: "Normal Morphology (Strict Criteria)", analyzerCode: "SEM_MORPH", unit: "%", refMinMale: 4, refMaxMale: 60, refMinFemale: 4, refMaxFemale: 60, decimalPlaces: 0 }
    ]
  },
  {
    id: "srv-lab-koh",
    code: "KOH-01",
    name: "Fungal KOH Mount (Skin Scraping / Nail / Hair)",
    department: "Microbiology",
    specimenType: "Skin / Nail Scraping",
    containerType: "Clean Folded Paper / Sterile Tube",
    methodology: "10-20% Potassium Hydroxide Wet Mount Microscopy",
    tatMinutes: 60,
    price: 300,
    parameters: [
      { id: "p-koh", name: "Fungal Elements (Hyphae / Spores)", analyzerCode: "KOH", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["No Fungal Elements Seen", "Septate Hyphae Seen (Positive)", "Budding Yeast / Pseudohyphae Seen"], normalQualitativeValues: ["No Fungal Elements Seen"] }
    ]
  },
  {
    id: "srv-lab-gram",
    code: "GRAM-01",
    name: "Gram Stain Direct Microscopy",
    department: "Microbiology",
    specimenType: "Pus / Fluid / CSF / Sputum",
    containerType: "Sterile Container",
    methodology: "Hucker Modified Gram Stain",
    tatMinutes: 60,
    price: 300,
    parameters: [
      { id: "p-gram-res", name: "Gram Stain Smear Impression", analyzerCode: "GRAM", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["No Organisms & Few Pus Cells", "Gram-Positive Cocci in Clusters", "Gram-Positive Cocci in Pairs", "Gram-Negative Bacilli"], normalQualitativeValues: ["No Organisms & Few Pus Cells"] }
    ]
  },
  {
    id: "srv-lab-fluid",
    code: "FLUID-RE",
    name: "Body Fluid Analysis (Pleural / Ascitic / CSF Routine & ADA)",
    department: "Microbiology",
    specimenType: "Pleural / Ascitic / CSF Aspirate",
    containerType: "Sterile Plain + EDTA Tubes",
    methodology: "Neubauer Cell Count + Biochemistry + Colorimetric ADA",
    tatMinutes: 150,
    price: 1200,
    parameters: [
      { id: "p-fl-tc", name: "Total Leukocyte Count (Fluid)", analyzerCode: "FL_TC", unit: "cells/\xB5L", refMinMale: 0, refMaxMale: 500, refMinFemale: 0, refMaxFemale: 500, criticalHigh: 5e3, decimalPlaces: 0 },
      { id: "p-fl-prot", name: "Fluid Total Protein", analyzerCode: "FL_PROT", unit: "g/dL", refMinMale: 0.1, refMaxMale: 3, refMinFemale: 0.1, refMaxFemale: 3, decimalPlaces: 2 },
      { id: "p-fl-glu", name: "Fluid Glucose", analyzerCode: "FL_GLU", unit: "mg/dL", refMinMale: 40, refMaxMale: 110, refMinFemale: 40, refMaxFemale: 110, criticalLow: 20, decimalPlaces: 0 },
      { id: "p-fl-ada", name: "Fluid ADA (Adenosine Deaminase)", analyzerCode: "FL_ADA", unit: "U/L", refMinMale: 0, refMaxMale: 30, refMinFemale: 0, refMaxFemale: 30, criticalHigh: 60, decimalPlaces: 1 }
    ]
  },
  {
    id: "srv-lab-mantoux",
    code: "MANTOUX",
    name: "Mantoux Tuberculin Skin Test (PPD \u2014 48\u201372 Hr Reading)",
    department: "Microbiology",
    specimenType: "Intradermal 5 TU PPD Injection",
    containerType: "72-Hour Induration Measurement",
    methodology: "Standard Mantoux Intradermal Test",
    tatMinutes: 4320,
    price: 300,
    parameters: [
      { id: "p-ppd-mm", name: "Induration Diameter (72 Hrs)", analyzerCode: "PPD_MM", unit: "mm", refMinMale: 0, refMaxMale: 9, refMinFemale: 0, refMaxFemale: 9, decimalPlaces: 0 },
      { id: "p-ppd-int", name: "Mantoux Interpretation", analyzerCode: "PPD_INT", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative (<5 mm)", "Negative / Borderline (5-9 mm)", "Positive (\u226510 mm)", "Strongly Positive (\u226515 mm)"], normalQualitativeValues: ["Negative (<5 mm)", "Negative / Borderline (5-9 mm)"] }
    ]
  },
  {
    id: "srv-lab-covid",
    code: "COVID-AG",
    name: "SARS-CoV-2 (COVID-19) Rapid Antigen Test",
    department: "Immunology",
    specimenType: "Nasopharyngeal Swab",
    containerType: "Viral Extraction Buffer Tube",
    methodology: "WHO-Approved Lateral Flow Rapid Antigen Assay",
    tatMinutes: 30,
    price: 500,
    parameters: [
      { id: "p-cov-ag", name: "SARS-CoV-2 Antigen", analyzerCode: "COVID_AG", resultType: "QUALITATIVE", unit: "-", qualitativeOptions: ["Negative", "Positive"], normalQualitativeValues: ["Negative"], criticalQualitativeValues: ["Positive"] }
    ]
  }
];
var NEPAL_LAB_TESTS_CATALOG = RAW_LAB_CATALOG.map(buildLabService);
function ensureAnalyzerCodesOnService(service) {
  return {
    ...service,
    parameters: (service.parameters || []).map((p) => {
      if (p.analyzerCode) return p;
      const mapped = ANALYZER_CODE_BY_PARAM_ID[p.id];
      return mapped ? { ...p, analyzerCode: mapped } : p;
    })
  };
}

// server/seed.ts
var BILLING_REPORT_STRICT_PERMISSIONS = [
  "dashboard.view",
  "pos.billing",
  "orders.view",
  "orders.create",
  "reports.print",
  "reports.email",
  "services.view",
  "counter.close"
];
var LAB_TECH_STRICT_PERMISSIONS = [
  "dashboard.view",
  "orders.view",
  "orders.collect",
  "orders.advance",
  "results.enter",
  "results.validate",
  "reports.print",
  "mobile.app"
];
var DEFAULT_DASHBOARD_LAYOUT_CONFIGS = {
  SAAS_ADMIN: {
    roleId: "SAAS_ADMIN",
    title: "Hospital Executive Operations & Live Analytics",
    subtitle: "Full hospital analytics, clinical queues, stock reorder alerts, financials, and multi-department throughput.",
    widgets: [
      "EXECUTIVE_SUMMARY",
      "LOW_STOCK_ALERTS",
      "PRIORITY_ALERTS",
      "KPI_GRID",
      "CLINICAL_OPS",
      "SHIFT_HANDOVER",
      "QR_ATTENDANCE",
      "WHATSAPP_DIGEST",
      "ANALYTICS_CHARTS",
      "TAT_WORKBENCH",
      "REFERRALS_AND_REAGENTS"
    ]
  },
  SUPER_ADMIN: {
    roleId: "SUPER_ADMIN",
    title: "Hospital Executive Operations & Live Analytics",
    subtitle: "Full hospital analytics, clinical queues, stock reorder alerts, financials, and multi-department throughput.",
    widgets: [
      "EXECUTIVE_SUMMARY",
      "LOW_STOCK_ALERTS",
      "PRIORITY_ALERTS",
      "KPI_GRID",
      "CLINICAL_OPS",
      "SHIFT_HANDOVER",
      "QR_ATTENDANCE",
      "WHATSAPP_DIGEST",
      "ANALYTICS_CHARTS",
      "TAT_WORKBENCH",
      "REFERRALS_AND_REAGENTS"
    ]
  },
  LAB_DIRECTOR: {
    roleId: "LAB_DIRECTOR",
    title: "Clinical Pathology & Laboratory Operations",
    subtitle: "Pathology turnaround metrics, critical validation queue, reagent alerts, and daily case load.",
    widgets: ["LOW_STOCK_ALERTS", "PRIORITY_ALERTS", "KPI_GRID", "ANALYTICS_CHARTS", "TAT_WORKBENCH", "REFERRALS_AND_REAGENTS"]
  },
  RADIOLOGIST: {
    roleId: "RADIOLOGIST",
    title: "Radiology & Diagnostic Imaging Workspace",
    subtitle: "Imaging studies pending sign-off, urgent STAT cases, and film stock reorder status.",
    widgets: ["LOW_STOCK_ALERTS", "PRIORITY_ALERTS", "TAT_WORKBENCH"]
  },
  DOCTOR: {
    roleId: "DOCTOR",
    title: "Physician Clinical Rounds & Patient Monitoring",
    subtitle: "Active OPD/IPD/ER patient load, critical clinical alerts, nursing handovers, and diagnostic TAT.",
    widgets: ["PRIORITY_ALERTS", "CLINICAL_OPS", "SHIFT_HANDOVER", "QR_ATTENDANCE", "TAT_WORKBENCH"]
  },
  NURSE: {
    roleId: "NURSE",
    title: "Nursing Station & Ward Observation Hub",
    subtitle: "Active ward beds, emergency triage alerts, shift handover inbox, and rapid attendance punch.",
    widgets: ["PRIORITY_ALERTS", "CLINICAL_OPS", "SHIFT_HANDOVER", "QR_ATTENDANCE"]
  },
  PHARMACIST: {
    roleId: "PHARMACIST",
    title: "Central Pharmacy Operations & Inventory Watch",
    subtitle: "FEFO medicine reorder alerts, dispensing telemetry, shift handovers, and attendance.",
    widgets: ["LOW_STOCK_ALERTS", "KPI_GRID", "SHIFT_HANDOVER", "QR_ATTENDANCE"]
  },
  PHARMACY_CASHIER: {
    roleId: "PHARMACY_CASHIER",
    title: "Pharmacy Billing & Deposit Counter",
    subtitle: "Fast FEFO counter volume, low-stock reorder notices, handover log, and shift punch.",
    widgets: ["LOW_STOCK_ALERTS", "KPI_GRID", "SHIFT_HANDOVER", "QR_ATTENDANCE"]
  },
  LAB_TECH: {
    roleId: "LAB_TECH",
    title: "Lab Technologist \u2014 Pending TAT Alerts",
    subtitle: "Restricted view showing only pending SLA/TAT diagnostic alerts requiring result entry, validation, and report print.",
    widgets: ["TAT_ALERTS_ONLY"]
  },
  CENTER_MANAGER: {
    roleId: "CENTER_MANAGER",
    title: "Front Desk, POS Billing & Clinical Queue",
    subtitle: "Registration, clinical throughput, TAT status, handover status, and daily counter operations.",
    widgets: ["KPI_GRID", "CLINICAL_OPS", "SHIFT_HANDOVER", "QR_ATTENDANCE", "TAT_WORKBENCH"]
  },
  INVENTORY_HR: {
    roleId: "INVENTORY_HR",
    title: "Inventory, Finance & HR Operations",
    subtitle: "Critical low-stock reorder watch, revenue KPIs, attendance tracking, and shift handovers.",
    widgets: ["LOW_STOCK_ALERTS", "KPI_GRID", "SHIFT_HANDOVER", "QR_ATTENDANCE", "REFERRALS_AND_REAGENTS"]
  },
  BILLING_REPORT: {
    roleId: "BILLING_REPORT",
    title: "POS Billing & Report Dispatch Desk",
    subtitle: "Restricted counter view for fast Hospital POS billing, order tracking, and report printing/dispatch.",
    widgets: ["KPI_GRID", "TAT_WORKBENCH"]
  }
};
var ALL_PERMISSIONS = [
  "dashboard.view",
  "pos.billing",
  "orders.view",
  "orders.create",
  "orders.collect",
  "orders.advance",
  "results.enter",
  "results.validate",
  "radiology.view",
  "radiology.report",
  "radiology.manage",
  "pharmacy.view",
  "pharmacy.manage",
  "pharmacy.dispense",
  "hospital.view",
  "hospital.clinical",
  "hospital.manage",
  "ot.view",
  "ot.manage",
  "ot.anesthesia",
  "nursing.view",
  "doctor.view",
  "patients.manage",
  "emergency.view",
  "emergency.manage",
  "darta.view",
  "darta.manage",
  "dhis2.view",
  "dhis2.manage",
  "gatepass.manage",
  "marketing.manage",
  "mis.view",
  "reports.print",
  "reports.email",
  "reports.api_send",
  "services.view",
  "services.manage",
  "inventory.view",
  "inventory.manage",
  "referrals.view",
  "referrals.manage",
  "referrals.approve_payout",
  "finance.view",
  "finance.manage",
  "finance.approve_manager",
  "finance.approve_admin",
  "counter.close",
  "personnel.view",
  "personnel.manage",
  "payroll.view",
  "payroll.manage",
  "audit.view",
  "rbac.manage",
  "settings.manage",
  "admin.control",
  "saas.view",
  "saas.manage",
  "saas.tenants.manage",
  "designs.manage",
  "mobile.app"
];
var LAB_SUPER_ADMIN_PERMISSIONS = [...ALL_PERMISSIONS];
function hoursAgo(h) {
  return new Date(Date.now() - h * 3600 * 1e3).toISOString();
}
function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600 * 1e3).toISOString();
}
function daysFromNow(d) {
  return new Date(Date.now() + d * 24 * 3600 * 1e3).toISOString().slice(0, 10);
}
function createSeedDatabase() {
  const currentBs = adToBs(/* @__PURE__ */ new Date());
  const activeFy = currentBs.fiscalYear;
  const seededDb = {
    settings: {
      labName: "Saptari Hospital Pvt Ltd",
      labNameNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
      legalEntityName: "Saptari Hospital Pvt Ltd",
      panNumber: "604829112",
      accreditationLine: "24\xD77 Emergency, OPD, IPD, Maternity, ICU, Pharmacy & NPHL Grade-A Lab",
      addressLine: "Bode Barsain, Saptari, Nepal",
      contactLine: "Hotline: 97-1515-6677 \xB7 Email: saptarihospital@gmail.com \xB7 Web: saptarihospital.com",
      emailSender: "saptarihospital@gmail.com",
      adminWhatsAppNumber: "97-1515-6677",
      resetSupportPhone: "97-1515-6677",
      autoSendDailySalesWhatsApp: true,
      dailySalesWhatsAppTime: "20:00",
      idleLockSeconds: 150,
      developedBy: "Dr. Santosh Majhi",
      activeFiscalYear: activeFy,
      autoEmailOnValidate: false,
      defaultWebhookUrl: "/api/emr-webhook-receiver",
      prePrintedTopMarginMm: 38,
      prePrintedBottomMarginMm: 22,
      moduleSettings: {
        tatWarningThresholdPercent: 75,
        requireDoctorNameOnOrder: false,
        notifyCriticalPanicSms: true,
        requireFilmRetakeReason: true,
        autoDeductFilmOnSignoff: true,
        defaultDoseUnit: "mSv",
        strictFefoBlockExpired: true,
        pharmacyNearExpiryDays: 45,
        pharmacyInvoicePrefix: "PHM-INV",
        showBatchExpiryOnPharmacyBill: true,
        defaultPosPaymentMode: "Cash",
        maxCashierDiscountPercent: 20,
        cashierMaxDiscountNpr: 1e3,
        discountApprovalPolicy: "MANAGER_THEN_ADMIN",
        creditApprovalPolicy: "MANAGER_THEN_ADMIN",
        requireVarianceNoteOnClose: true,
        enforceHardCreditStop: true,
        defaultCenterCreditLimitNpr: 15e4,
        riderGpsRefreshSeconds: 30,
        maxFailedAttemptsBeforeLock: 3,
        enforceStrictCenterIsolation: true,
        requireTwoTierFinanceApproval: true,
        nonInventoryBillEnabled: true,
        autoSyncBackupMinutes: 5,
        // Separate Pharmacy Identity & PAN
        pharmacyEntityName: "Saptari Hospital Pharmacy Store",
        pharmacyEntityNameNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092B\u093E\u0930\u094D\u092E\u0947\u0938\u0940 \u0938\u094D\u091F\u094B\u0930",
        pharmacyPanNumber: "609114520",
        pharmacyDdaLicense: "DDA-SAP-2080-044",
        pharmacyPhone: "97-1515-6678",
        pharmacyAddress: "Ground Floor Pharmacy Block, Bode Barsain, Saptari",
        // Document Prefixes
        billPrefix: "INV",
        labOrderPrefix: "SHL",
        reportPrefix: "RPT",
        opdPrefix: "OPD",
        ipdPrefix: "IPD",
        erPrefix: "ER",
        mlcPrefix: "MLC",
        gatepassPrefix: "GP",
        referralPrefix: "REF",
        voucherPrefix: "VCH",
        // Digital Signature & Verification Seal
        showDigitallyVerifiedSeal: true,
        digitalVerifierName: "Dr. Santosh Majhi, MD",
        digitalVerifierDesignation: "Medical Director & Pathologist",
        digitalVerifierRegNo: "NMC-8412",
        digitalSignatureText: "Dr. Santosh Majhi",
        // Security, Perimeter, Hikvision & Admin Secret Erase
        hospitalAccessOnlyForStaff: false,
        allowedHospitalIps: "127.0.0.1,192.168.1.0/24,10.0.0.0/8",
        hospitalWifiCheckCode: "SAPTARI-HOSP-LAN",
        hikvisionDeviceIp: "192.168.1.201",
        hikvisionDevicePort: 80,
        hikvisionDeviceName: "Hikvision DS-K1T341AMF Main Lobby",
        adminEraseSecretPin: "2082",
        adminConfirmEmail: "epusaan@gmail.com",
        // Dynamic Module Charges & Print/Signature Defaults
        emergencyRegistrationFeeNpr: 500,
        emergencyTicketFeeNpr: 150,
        emergencyDefaultCreditLimitNpr: 15e3,
        defaultOpdConsultationFeeNpr: 500,
        opdFreeFollowUpDays: 5,
        opdFollowUpSameDoctorOnly: true,
        opdFollowUpWithinWindowFeeNpr: 0,
        opdFollowUpFeeAfterExpiryNpr: 300,
        opdConsultationTypes: [
          { id: "opd-gen", name: "General OPD Consultation", feeNpr: 500, active: true },
          { id: "opd-spec", name: "Specialist MD Consultation", feeNpr: 800, active: true },
          { id: "opd-fu", name: "Follow-Up Review (Same Doctor Within Window)", feeNpr: 0, active: true },
          { id: "opd-fu-paid", name: "Follow-Up After Free Window", feeNpr: 300, active: true },
          { id: "opd-prio", name: "Priority / Evening Fast Track", feeNpr: 1e3, active: true }
        ],
        ipdAdmissionFeeNpr: 1e3,
        ipdDefaultCreditLimitNpr: 25e3,
        ipdBedCycleStartTime: "07:00",
        ipdBedCycleEndTime: "19:00",
        ipdBedChargeScheduleMode: "CYCLE_WINDOW",
        ipdDoctorRoundFeeNpr: 500,
        ipdDoctorRoundBasis: "PER_ROUND",
        ipdDoctorRoundsPerDay: 2,
        ipdDoctorRoundScheduleTimes: "08:30, 17:30",
        ipdNursingChargePerDayNpr: 400,
        ipdNursingChargeBasis: "PER_DAY",
        ipdNursingRoundsPerDay: 3,
        ipdNursingScheduleTimes: "07:00, 14:00, 21:00",
        ipdDailyObservationFeeNpr: 300,
        ipdObservationChargeBasis: "PER_DAY",
        ipdObservationRoundsPerDay: 2,
        ipdObservationScheduleTimes: "08:00, 20:00",
        shiftPricing: {
          bed: { Morning: 800, Afternoon: 800, Night: 1e3 },
          observation: { Morning: 300, Afternoon: 350, Night: 450 },
          nursing: { Morning: 400, Afternoon: 450, Night: 550 },
          doctorRound: { Morning: 500, Afternoon: 600, Night: 800 }
        },
        registrationFieldRules: {
          pos: {},
          opd: {},
          er: {},
          ipd: {}
        },
        nursingObservationTypes: [
          { id: "nobs-vitals", name: "Nursing Round & Vitals Observation", defaultFeeNpr: 200, active: true },
          { id: "nobs-iv", name: "IV Cannulation & Infusion Monitoring", defaultFeeNpr: 300, active: true },
          { id: "nobs-dress", name: "Wound Dressing & Post-Op Observation", defaultFeeNpr: 400, active: true },
          { id: "nobs-neb", name: "Nebulization & O2 Observation", defaultFeeNpr: 350, active: true },
          { id: "nobs-icu", name: "Intensive Ward Continuous Observation", defaultFeeNpr: 600, active: true }
        ],
        customServiceCategories: [
          "Consultation",
          "Procedures",
          "Diagnostics",
          "Plaster & Ortho",
          "Emergency / Casualty",
          "Pathology",
          "Radiology"
        ],
        lanServerHostIp: "192.168.1.100",
        hospitalLogoDataUrl: "",
        pharmacyLogoDataUrl: "",
        signatureBoxes: [
          { roleKey: "CEO_CHAIRMAN", roleLabel: "Chairman / CEO", signerName: "Dr. Santosh Majhi", designation: "Chairman & Managing Director", regNo: "NMC-8412", imageDataUrl: "", active: true },
          { roleKey: "PATHOLOGIST", roleLabel: "Consultant Pathologist", signerName: "Dr. Bikram Shrestha, MD", designation: "Consultant Pathologist", regNo: "NMC-11205", imageDataUrl: "", active: true },
          { roleKey: "DOCTOR", roleLabel: "Consultant Physician", signerName: "Dr. Rajesh Kumar Jha, MD", designation: "Consultant Physician (OPD/IPD/ER)", regNo: "NMC-14210", imageDataUrl: "", active: true },
          { roleKey: "NURSE", roleLabel: "Senior Nursing Officer", signerName: "Anjali Kumari Yadav, BN", designation: "Ward & ICU In-Charge", regNo: "NNC-48120", imageDataUrl: "", active: true },
          { roleKey: "HOSPITAL_CASHIER", roleLabel: "Hospital Billing Cashier", signerName: "Suman Gurung", designation: "Hospital Counter Cashier", regNo: "SHP-BILL-01", imageDataUrl: "", active: true },
          { roleKey: "PHARMACY_CASHIER", roleLabel: "Pharmacy Dispenser", signerName: "Bikash Yadav", designation: "Central Pharmacy Cashier", regNo: "DDA-SAP-044", imageDataUrl: "", active: true },
          { roleKey: "RADIOLOGIST", roleLabel: "Consultant Radiologist", signerName: "Dr. Nisha Gurung, MD", designation: "Consultant Radiologist", regNo: "NMC-14902", imageDataUrl: "", active: true }
        ],
        printOptions: {
          defaultPaperSize: "A5",
          defaultLetterheadMode: "with-letterhead",
          selectedReportDesignId: "dsn-main",
          selectedBillDesignId: "dsn-bill-a5",
          selectedPharmacyDesignId: "dsn-phm-a5",
          selectedOthersDesignId: "dsn-adm-a5",
          autoPrintByTemplate: {
            labReport: "MANUAL_PROMPT",
            radiologyReport: "MANUAL_PROMPT",
            posBill: "AUTO_PRINT",
            pharmacyBill: "AUTO_PRINT",
            admissionReceipt: "AUTO_PRINT",
            emergencySlip: "AUTO_PRINT",
            opdSlip: "AUTO_PRINT",
            certificates: "MANUAL_PROMPT"
          }
        },
        autoDeductIpdMedFromPharmacyFefo: true,
        markBedCleaningOnDischarge: true,
        keyboardNavigationMode: "ENTER_AS_TAB",
        showDemoCredentialsOnLogin: true,
        showErFeeFieldsInForm: false,
        referralCaseRules: [
          { id: "rcase-rta", caseType: "RTA Case", mode: "PERCENT", value: 12, active: true },
          { id: "rcase-poison", caseType: "Poison Case", mode: "FLAT", value: 1500, active: true },
          { id: "rcase-lscs", caseType: "LSCS / Maternity", mode: "PERCENT", value: 10, active: true },
          { id: "rcase-cardiac", caseType: "Cardiac / ICU Emergency", mode: "FLAT", value: 2e3, active: true },
          { id: "rcase-general", caseType: "General Admission / OPD", mode: "PERCENT", value: 8, active: true }
        ],
        referralBillTierRules: [
          { id: "rtier-5k", label: "First ER + Admission Bill >= \u0930\u0942 5,000", minTotalBillNpr: 5e3, commissionAmountNpr: 500, active: true },
          { id: "rtier-10k", label: "First ER + Admission Bill >= \u0930\u0942 10,000", minTotalBillNpr: 1e4, commissionAmountNpr: 1200, active: true }
        ],
        policeStations: [
          {
            id: "ps-bode",
            stationName: "Ilaka Prahari Karyalaya, Bode Barsain",
            municipalityOrArea: "Bode Barsain Municipality",
            address: "Bode Barsain-05, Saptari",
            phone: "031-560100",
            officerInCharge: "Inspector Duty Officer",
            keywords: ["bode", "barsain", "bode barsain", "ward", "saptari"]
          },
          {
            id: "ps-rajbiraj",
            stationName: "Jilla Prahari Karyalaya (District Police), Saptari",
            municipalityOrArea: "Rajbiraj Municipality",
            address: "Rajbiraj-04, District HQ, Saptari",
            phone: "031-520199",
            officerInCharge: "DSP Control Room",
            keywords: ["rajbiraj", "district", "headquarters", "jilla"]
          },
          {
            id: "ps-kadarbona",
            stationName: "Ilaka Prahari Karyalaya, Kadarbona",
            municipalityOrArea: "Shambhunath / Khadak / Highway",
            address: "East-West Highway, Kadarbona, Saptari",
            phone: "031-540100",
            officerInCharge: "Duty Inspector",
            keywords: ["kadarbona", "khadak", "shambhunath", "highway"]
          },
          {
            id: "ps-kalyanpur",
            stationName: "Ilaka Prahari Karyalaya, Kalyanpur",
            municipalityOrArea: "Kalyanpur",
            address: "Kalyanpur Bazar, Saptari",
            phone: "031-540122",
            officerInCharge: "Station In-Charge",
            keywords: ["kalyanpur", "bisnupur"]
          },
          {
            id: "ps-kanchanrup",
            stationName: "Ilaka Prahari Karyalaya, Kanchanrup",
            municipalityOrArea: "Kanchanrup Municipality",
            address: "Kanchanpur Bazar, Kanchanrup, Saptari",
            phone: "031-560211",
            officerInCharge: "Inspector Office",
            keywords: ["kanchanpur", "kanchanrup", "rupanagar"]
          },
          {
            id: "ps-hanuman",
            stationName: "Ilaka Prahari Karyalaya, Hanuman Nagar",
            municipalityOrArea: "Hanumannagar Kankalini",
            address: "Hanuman Nagar, Saptari",
            phone: "031-522100",
            officerInCharge: "Duty Officer",
            keywords: ["hanuman", "kankalini", "bhardaha"]
          },
          {
            id: "ps-dakneshwori",
            stationName: "Prahari Chowki, Dakneshwori / Pato",
            municipalityOrArea: "Dakneshwori Municipality",
            address: "Pato Bazar, Dakneshwori, Saptari",
            phone: "9852840100",
            officerInCharge: "ASI Chowki In-Charge",
            keywords: ["dakneshwori", "pato", "tarahi"]
          },
          {
            id: "ps-rupani",
            stationName: "Prahari Chowki, Rupani",
            municipalityOrArea: "Rupani Rural Municipality",
            address: "Rupani Chowk, Saptari",
            phone: "9852840115",
            officerInCharge: "Duty ASI",
            keywords: ["rupani", "birendra bazar"]
          }
        ]
      }
    },
    saas: {
      tenantId: "SAPTARI-HOSP-BB-01",
      tenantDomain: "saptarihospital.com",
      planName: "Enterprise Multi-Hub",
      billingCycle: "Monthly",
      basePlanPriceNpr: 0,
      storageQuotaMb: 25600,
      // 25 GB
      archivedReportMediaMb: 1420.5,
      maxStaffSeats: 50,
      maxCollectionCenters: 20,
      maxMonthlyOrders: 25e3,
      maxRolesCapacity: 12,
      allowedRoleIds: [
        "SUPER_ADMIN",
        "DOCTOR",
        "NURSE",
        "LAB_DIRECTOR",
        "RADIOLOGIST",
        "PHARMACIST",
        "PHARMACY_CASHIER",
        "LAB_TECH",
        "CENTER_MANAGER",
        "INVENTORY_HR",
        "BILLING_REPORT"
      ],
      nextRenewalBs: "2083-08-30 BS",
      status: "Active",
      modules: [
        {
          key: "core_lims",
          name: "Core LIMS, Orders, TAT & A4 Reporting",
          description: "Diagnostic accessioning, automated TAT SLA monitor, qualitative/quantitative result workbench, and A4 PDF/print engine.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: true,
          monthlyAddonNpr: 0,
          storageFootprintMb: 540.2
        },
        {
          key: "radiology_imaging",
          name: "Radiology Reporting & X-Ray Film Inventory (X-Ray, CT, USG, Echo)",
          description: "Dynamic radiology reporting templates, biometry/measurements tables, rapid macros, and automated X-Ray film/contrast BOM deduction.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 4500,
          storageFootprintMb: 310
        },
        {
          key: "pharmacy_erp",
          name: "Pharmacy ERP & Strict FEFO Batch Dispensing",
          description: "Medicine master, DDA schedule control, earliest-expiry FEFO auto-allocation, expired batch lock, GRN batch intake, and Nepal BS pharmacy billing.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 3800,
          storageFootprintMb: 145
        },
        {
          key: "hospital_opd_ipd",
          name: "Hospital OPD, IPD Wards, Beds, Nursing Chart & Birth/Death",
          description: "Outpatient consultation queue, inpatient ward/bed census summary, TPR/I-O nursing charts, internal transfers, case consents, discharge summary, birth & death certificates.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 0,
          storageFootprintMb: 210
        },
        {
          key: "ot_management",
          name: "OT Management, Pre-Op Safety Checklist & Anesthesiology",
          description: "Operation Theatre scheduling board, mandatory Pre-Operative Safety Checklist audit lock, anesthesiology drug/airway/vitals log, and PACU surgical recovery.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 0,
          storageFootprintMb: 96
        },
        {
          key: "emergency_mlc",
          name: "Emergency (ER) & Medico-Legal Case (MLC) Police Register",
          description: "24x7 emergency triage bays, auto-assigned Saptari/Bode Barsain Police Station mapping, one-click Informed Police stamp with timestamp & number, and printable Police MLC intimation.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 0,
          storageFootprintMb: 92.4
        },
        {
          key: "darta_chalani",
          name: "Darta & Chalani Correspondence Register + MIS",
          description: "Official inward/outward hospital correspondence log with Ref No, attached documents, printable dispatch letters, and Darta-Chalani MIS summary report.",
          category: "Compliance & Integrations",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 0,
          storageFootprintMb: 64.2
        },
        {
          key: "dhis2_hmis",
          name: "DHIS2 / HMIS Nepal Non-API (Bode Barsain Municipality)",
          description: "Offline non-API monthly HMIS aggregate generator from live hospital data with 2-paper printable submission & municipality receipt signature form.",
          category: "Compliance & Integrations",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 0,
          storageFootprintMb: 48
        },
        {
          key: "pos_billing",
          name: "POS Counter Billing & Bilingual Nepalese Invoices",
          description: "Walk-in & hub POS cashiering, Nepali BS date/time receipts, discount engine, and split cash/bank collection.",
          category: "Billing & Finance",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 3500,
          storageFootprintMb: 215.4
        },
        {
          key: "inventory_erp",
          name: "Automated Reagent BOM & Lot Inventory ERP",
          description: "Automatic per-test reagent bill-of-materials stock deduction on report sign-off, lot expiry, and reorder alerts.",
          category: "Clinical Core",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 3e3,
          storageFootprintMb: 84.6
        },
        {
          key: "referrals_engine",
          name: "Referral Physician & Clinic Commission Engine",
          description: "Per-test override, flat \u0930\u0942, and percentage (%) doctor/clinic referral commission rules and payout ledger.",
          category: "Billing & Finance",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 2e3,
          storageFootprintMb: 46.5
        },
        {
          key: "finance_counter",
          name: "Bank, Cash Accounts & Daily Counter Close",
          description: "Multi-bank QR/ConnectIPS treasury accounts, expense vouchers, and locked physical cash day-end reconciliation.",
          category: "Billing & Finance",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 3200,
          storageFootprintMb: 190.4
        },
        {
          key: "hr_payroll",
          name: "HR Roster & Nepalese SSF/TDS Payroll",
          description: "Pathologist/technologist licensing registry, shift scheduling, BS monthly payroll batches, and bank disbursement.",
          category: "Compliance & Integrations",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 2800,
          storageFootprintMb: 74.1
        },
        {
          key: "dispatch_api",
          name: "Automated Email & HL7/FHIR EMR Webhook Dispatch",
          description: "Auto-email patient/center notifications on report sign-off and signed JSON/HL7 webhook delivery to partner EMRs.",
          category: "Compliance & Integrations",
          enabled: true,
          lockedCore: false,
          monthlyAddonNpr: 2500,
          storageFootprintMb: 108.5
        }
      ]
    },
    tenants: [
      {
        id: "tnt-1",
        code: "TENANT-NP-KTM-001",
        name: "Saptari Hospital Pvt Ltd (Bode Barsain Main Hospital)",
        nameNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F., \u092C\u094B\u0926\u0947 \u092C\u0930\u094D\u0938\u093E\u0907\u0928",
        entityType: "Hospital",
        panNumber: "604829112",
        phone: "97-1515-6677",
        address: "Bode Barsain Municipality, Saptari, Nepal",
        ownerEmail: "saptarihospital@gmail.com",
        planName: "Enterprise Multi-Hub",
        status: "Active",
        maxRolesAllowed: 8,
        allowedRoles: ["SUPER_ADMIN", "LAB_DIRECTOR", "RADIOLOGIST", "PHARMACIST", "LAB_TECH", "CENTER_MANAGER", "INVENTORY_HR"],
        enabledModules: [
          "core_lims",
          "radiology_imaging",
          "pharmacy_erp",
          "hospital_opd_ipd",
          "ot_management",
          "pos_billing",
          "inventory_erp",
          "collection_centers",
          "referrals_engine",
          "collection_riders",
          "finance_counter",
          "hr_payroll",
          "dispatch_api"
        ],
        storageQuotaMb: 25600,
        storageUsedMb: 2248,
        controlReason: "Initial Enterprise Main Lab provisioning",
        createdAt: hoursAgo(720)
      },
      {
        id: "tnt-2",
        code: "TENANT-NP-PKR-002",
        name: "Himalayan Clinical Care & Pathology Hub",
        nameNp: "\u0939\u093F\u092E\u093E\u0932\u092F\u0928 \u0915\u094D\u0932\u093F\u0928\u093F\u0915\u0932 \u0915\u0947\u092F\u0930 \u090F\u0923\u094D\u0921 \u092A\u094D\u092F\u093E\u0925\u094B\u0932\u094B\u091C\u0940 \u0939\u092C",
        entityType: "Polyclinic",
        panNumber: "609184320",
        phone: "+977-061-541290",
        address: "Prithvi Chowk, Pokhara-09, Kaski, Nepal",
        ownerEmail: "director@himalayanpathology.com.np",
        planName: "Professional Lab",
        status: "Active",
        maxRolesAllowed: 5,
        allowedRoles: ["SUPER_ADMIN", "LAB_DIRECTOR", "RADIOLOGIST", "LAB_TECH", "CENTER_MANAGER"],
        enabledModules: [
          "core_lims",
          "radiology_imaging",
          "pos_billing",
          "inventory_erp",
          "collection_centers",
          "finance_counter"
        ],
        storageQuotaMb: 15360,
        storageUsedMb: 1120,
        controlReason: "Pokhara Polyclinic annual subscription active",
        createdAt: hoursAgo(420)
      },
      {
        id: "tnt-3",
        code: "TENANT-NP-BTL-003",
        name: "Lumbini Metro Diagnostics Pvt. Ltd.",
        nameNp: "\u0932\u0941\u092E\u094D\u092C\u093F\u0928\u0940 \u092E\u0947\u091F\u094D\u0930\u094B \u0921\u093E\u092F\u0917\u094D\u0928\u094B\u0938\u094D\u091F\u093F\u0915\u094D\u0938 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        entityType: "Clinic",
        panNumber: "602331894",
        phone: "+977-071-530911",
        address: "Hospital Line, Butwal-04, Rupandehi, Nepal",
        ownerEmail: "admin@lumbinimetro.com.np",
        planName: "Starter Clinic",
        status: "Trial",
        maxRolesAllowed: 3,
        allowedRoles: ["SUPER_ADMIN", "LAB_TECH", "CENTER_MANAGER"],
        enabledModules: ["core_lims", "pos_billing", "dispatch_api"],
        storageQuotaMb: 10240,
        storageUsedMb: 410,
        controlReason: "14-day Rupandehi Clinic evaluation trial",
        createdAt: hoursAgo(96)
      }
    ],
    documentDesigns: [
      {
        id: "dsn-main",
        name: "01. Classic Royal Hospital A4 Report",
        entityType: "Hospital",
        centerId: null,
        targetScope: "REPORT",
        templateStyle: "CLASSIC_HOSPITAL",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "24\xD77 Emergency, OPD, IPD, ICU, Maternity, Pharmacy & Diagnostic Laboratory",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Hotline: 97-1515-6677 \xB7 saptarihospital@gmail.com \xB7 saptarihospital.com",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "OFFICIAL HOSPITAL TAX INVOICE / BILL",
        reportHeading: "CLINICAL DIAGNOSTIC LABORATORY REPORT",
        radiologyHeading: "DEPARTMENT OF RADIOLOGY & DIAGNOSTIC IMAGING REPORT",
        topBannerText: "SAPTARI HOSPITAL PVT LTD \xB7 BODE BARSAIN (SAPTARI, NEPAL) \xB7 HOTLINE: 97-1515-6677",
        footerDisclaimerText: "Electronically verified hospital record. Scan QR code to verify authenticity.",
        footerSignatureTitle: "Medical Superintendent / Chief Pathologist",
        watermarkText: "SAPTARI HOSPITAL",
        showWatermark: true,
        accentColor: "#1d4ed8",
        paperFormat: "A4",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "VERIFY_URL",
        showBarcode: true,
        barcodeSource: "ACCESSION",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: true,
        updatedAt: hoursAgo(48),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-rpt-a5",
        name: "02. Compact A5 Portrait Clinical Report",
        entityType: "Hospital",
        centerId: null,
        targetScope: "REPORT",
        templateStyle: "CLINICAL_CLEAN",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "Compact A5 Diagnostic Laboratory & Clinical Summary Sheet",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Hotline: 97-1515-6677 \xB7 saptarihospital@gmail.com",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "HOSPITAL SERVICE RECEIPT",
        reportHeading: "COMPACT A5 DIAGNOSTIC REPORT",
        radiologyHeading: "COMPACT A5 IMAGING REPORT",
        topBannerText: "SAPTARI HOSPITAL \xB7 DIAGNOSTIC LABORATORY",
        footerDisclaimerText: "A5 Portrait compact clinical laboratory printout. Electronically verified.",
        footerSignatureTitle: "Consultant Pathologist",
        watermarkText: "SAPTARI",
        showWatermark: false,
        accentColor: "#0f766e",
        paperFormat: "A5",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "VERIFY_URL",
        showBarcode: true,
        barcodeSource: "ACCESSION",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: false,
        updatedAt: hoursAgo(24),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-rpt-modern",
        name: "03. Modern Minimal Split-Column Report",
        entityType: "Diagnostic Lab",
        centerId: null,
        targetScope: "REPORT",
        templateStyle: "MODERN_MINIMAL",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "Automated Pathology, Endocrinology & Imaging Wing",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Tel: 97-1515-6677 \xB7 saptarihospital.com",
        panNumber: "604829112",
        licenseNumber: "NPHL-GR-A",
        billHeading: "DIAGNOSTIC INVOICE",
        reportHeading: "LABORATORY INVESTIGATION REPORT",
        radiologyHeading: "RADIOLOGY & SONOGRAPHY REPORT",
        topBannerText: "NPHL STANDARD DIAGNOSTIC LABORATORY \xB7 SAPTARI HOSPITAL",
        footerDisclaimerText: "Electronically verified under NMC clinical governance.",
        footerSignatureTitle: "Authorized Pathologist",
        watermarkText: "VERIFIED",
        showWatermark: false,
        accentColor: "#334155",
        paperFormat: "A4",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "ACCESSION_PAN",
        showBarcode: true,
        barcodeSource: "ACCESSION",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: true,
        updatedAt: hoursAgo(24),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-bill-a5",
        name: "04. Official A5 Portrait Hospital Tax Bill (Default)",
        entityType: "Hospital",
        centerId: null,
        targetScope: "BILL",
        templateStyle: "A5_COMPACT_BILL",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "OPD, Procedures, Diagnostics & Hospital Billing Counter",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Hotline: 97-1515-6677 \xB7 saptarihospital@gmail.com",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "HOSPITAL SERVICE TAX INVOICE / CASH RECEIPT",
        reportHeading: "DIAGNOSTIC REPORT",
        radiologyHeading: "RADIOLOGY REPORT",
        topBannerText: "SAPTARI HOSPITAL PVT LTD \xB7 A5 PORTRAIT OFFICIAL RECEIPT",
        footerDisclaimerText: "Thank you for visiting Saptari Hospital Pvt Ltd. Retain receipt for report pickup.",
        footerSignatureTitle: "Hospital Billing Cashier",
        watermarkText: "SAPTARI HOSPITAL",
        showWatermark: false,
        accentColor: "#1e3a8a",
        paperFormat: "A5",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "PATIENT_BILL",
        showBarcode: true,
        barcodeSource: "INVOICE",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: false,
        updatedAt: hoursAgo(18),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-bill-a4",
        name: "05. Executive A4 Detailed Hospital Invoice",
        entityType: "Hospital",
        centerId: null,
        targetScope: "BILL",
        templateStyle: "CLASSIC_HOSPITAL",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "Comprehensive Inpatient & Outpatient Itemized Tax Invoice",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Tel: 97-1515-6677 \xB7 PAN: 604829112",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "ITEMIZED HOSPITAL TAX INVOICE (IRD COMPLIANT)",
        reportHeading: "DIAGNOSTIC REPORT",
        radiologyHeading: "RADIOLOGY REPORT",
        topBannerText: "SAPTARI HOSPITAL PVT LTD \xB7 CORPORATE & INSURANCE TAX BILL",
        footerDisclaimerText: "Valid for insurance claim, reimbursement, and PAN/VAT audit.",
        footerSignatureTitle: "Billing Supervisor / Cashier",
        watermarkText: "ORIGINAL",
        showWatermark: true,
        accentColor: "#4338ca",
        paperFormat: "A4",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "PATIENT_BILL",
        showBarcode: true,
        barcodeSource: "INVOICE",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: false,
        updatedAt: hoursAgo(18),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-bill-80mm",
        name: "06. Express 80mm Thermal POS Slip",
        entityType: "Hospital",
        centerId: null,
        targetScope: "BILL",
        templateStyle: "THERMAL_RECEIPT",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "Fast OPD / Diagnostic Counter Thermal Slip",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Hotline: 97-1515-6677",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "COUNTER POS RECEIPT",
        reportHeading: "DIAGNOSTIC REPORT",
        radiologyHeading: "RADIOLOGY REPORT",
        topBannerText: "SAPTARI HOSPITAL FAST POS",
        footerDisclaimerText: "Get well soon \xB7 Computer generated receipt",
        footerSignatureTitle: "Counter Cashier",
        watermarkText: "",
        showWatermark: false,
        accentColor: "#0f172a",
        paperFormat: "THERMAL_80MM",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "PATIENT_BILL",
        showBarcode: false,
        barcodeSource: "INVOICE",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: false,
        showTatBadge: false,
        updatedAt: hoursAgo(18),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-phm-a5",
        name: "07. A5 Portrait Pharmacy FEFO Tax Bill (Default)",
        entityType: "Pharmacy",
        centerId: null,
        targetScope: "PHARMACY",
        templateStyle: "PHARMACY_MODERN",
        headerTitle: "Saptari Hospital Pharmacy Store",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092B\u093E\u0930\u094D\u092E\u0947\u0938\u0940 \u0938\u094D\u091F\u094B\u0930",
        subTitle: "DDA Registered Central Pharmacy \xB7 Strict FEFO Batch Dispensing",
        addressText: "Ground Floor Pharmacy Block, Bode Barsain, Saptari",
        phoneText: "Tel: 97-1515-6678 \xB7 DDA: DDA-SAP-2080-044",
        panNumber: "609114520",
        licenseNumber: "DDA-SAP-2080-044",
        billHeading: "PHARMACY RETAIL TAX INVOICE (FEFO)",
        reportHeading: "PHARMACY DISPENSING SHEET",
        radiologyHeading: "PHARMACY",
        topBannerText: "SAPTARI HOSPITAL PHARMACY \xB7 PAN: 609114520",
        footerDisclaimerText: "Medicines sold cannot be returned after 7 days without original bill & intact strip.",
        footerSignatureTitle: "Pharmacist / Dispenser",
        watermarkText: "PHARMACY",
        showWatermark: false,
        accentColor: "#047857",
        paperFormat: "A5",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "PATIENT_BILL",
        showBarcode: true,
        barcodeSource: "INVOICE",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: false,
        updatedAt: hoursAgo(12),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-phm-80mm",
        name: "08. Fast 80mm Pharmacy Thermal Counter Bill",
        entityType: "Pharmacy",
        centerId: null,
        targetScope: "PHARMACY",
        templateStyle: "THERMAL_RECEIPT",
        headerTitle: "Saptari Hospital Pharmacy",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092B\u093E\u0930\u094D\u092E\u0947\u0938\u0940",
        subTitle: "Express Counter Dispensing Receipt",
        addressText: "Bode Barsain, Saptari",
        phoneText: "97-1515-6678",
        panNumber: "609114520",
        licenseNumber: "DDA-SAP-2080-044",
        billHeading: "PHARMACY CASH RECEIPT",
        reportHeading: "PHARMACY",
        radiologyHeading: "PHARMACY",
        topBannerText: "SAPTARI HOSPITAL PHARMACY",
        footerDisclaimerText: "Check expiry & dosage instructions before use.",
        footerSignatureTitle: "Pharmacy Cashier",
        watermarkText: "",
        showWatermark: false,
        accentColor: "#065f46",
        paperFormat: "THERMAL_80MM",
        showLetterheadBanner: true,
        showQrCode: false,
        qrPayloadMode: "PATIENT_BILL",
        showBarcode: false,
        barcodeSource: "INVOICE",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: false,
        showTatBadge: false,
        updatedAt: hoursAgo(12),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-adm-a5",
        name: "09. A5 Portrait IPD Admission Fee Receipt Only",
        entityType: "Hospital",
        centerId: null,
        targetScope: "ADMISSION_SLIP",
        templateStyle: "ADMISSION_CARD",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "Inpatient (IPD) Admission & Registration Fee Voucher",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Hotline: 97-1515-6677 \xB7 saptarihospital@gmail.com",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "IPD ADMISSION FEE RECEIPT ONLY",
        reportHeading: "IPD ADMISSION SLIP",
        radiologyHeading: "IPD ADMISSION SLIP",
        topBannerText: "INPATIENT ADMISSION FEE OFFICIAL RECEIPT",
        footerDisclaimerText: "This receipt strictly covers the IPD Admission Fee. Bed, nursing, lab & medicine bills settle separately.",
        footerSignatureTitle: "Admission Desk / Hospital Cashier",
        watermarkText: "ADMITTED",
        showWatermark: false,
        accentColor: "#0369a1",
        paperFormat: "A5",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "PATIENT_BILL",
        showBarcode: true,
        barcodeSource: "INVOICE",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: false,
        updatedAt: hoursAgo(8),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dsn-others-a4",
        name: "10. Official Hospital Formal Certificates & Letters (Others)",
        entityType: "Hospital",
        centerId: null,
        targetScope: "OTHERS",
        templateStyle: "GOVT_FORMAL",
        headerTitle: "Saptari Hospital Pvt Ltd",
        headerTitleNp: "\u0938\u092A\u094D\u0924\u0930\u0940 \u0939\u0938\u094D\u092A\u093F\u091F\u0932 \u092A\u094D\u0930\u093E. \u0932\u093F.",
        subTitle: "OPD Prescription, Medical Certificate, MLC Police Intimation & Birth/Death Format",
        addressText: "Bode Barsain, Saptari, Nepal",
        phoneText: "Hotline: 97-1515-6677 \xB7 saptarihospital.com",
        panNumber: "604829112",
        licenseNumber: "SAP-HOSP-BB-01",
        billHeading: "OFFICIAL HOSPITAL RECORD",
        reportHeading: "OFFICIAL HOSPITAL CERTIFICATE / FORM",
        radiologyHeading: "OFFICIAL HOSPITAL CERTIFICATE",
        topBannerText: "OFFICIAL HOSPITAL MEDICAL RECORD & STATUTORY CERTIFICATE",
        footerDisclaimerText: "Official document issued by Saptari Hospital Pvt Ltd with verified electronic seal.",
        footerSignatureTitle: "Medical Superintendent / Attending Doctor",
        watermarkText: "SAPTARI HOSPITAL",
        showWatermark: true,
        accentColor: "#7c2d12",
        paperFormat: "A4",
        showLetterheadBanner: true,
        showQrCode: true,
        qrPayloadMode: "VERIFY_URL",
        showBarcode: false,
        barcodeSource: "ACCESSION",
        showNepaliDate: true,
        showPan: true,
        showCollectionCenter: false,
        showDoctorRef: true,
        showTatBadge: false,
        updatedAt: hoursAgo(8),
        updatedBy: "Dr. Santosh Majhi (Hospital Admin)"
      }
    ],
    radiologyTemplates: [
      {
        id: "radtpl-cxr",
        code: "TPL-CXR-PA",
        name: "Chest X-Ray (PA View)",
        modality: "X-RAY",
        technique: "Standard erect Postero-Anterior (PA) chest radiograph acquired at full inspiration.",
        indicationPrompt: "Cough / Fever / Pre-operative screening",
        sections: [
          {
            id: "sec-cxr-1",
            title: "Lungs & Hilum",
            defaultText: "Both lung fields are clear and well-expanded. No focal consolidation, cavitation, mass, or interstitial infiltrate seen. Pulmonary hila are normal in size and contour."
          },
          {
            id: "sec-cxr-2",
            title: "Cardiomediastinal Silhouette",
            defaultText: "Cardiothoracic ratio is within normal limits (<0.5). Mediastinal contours and aortic knuckle are unremarkable. Trachea is central."
          },
          {
            id: "sec-cxr-3",
            title: "Pleura, Diaphragm & Bony Thorax",
            defaultText: "Both costophrenic angles are sharp and clear with no pleural effusion or pneumothorax. Hemidiaphragms are smooth. Visualized ribs, clavicles, and thoracic spine appear intact."
          }
        ],
        measurements: [
          { id: "m-ctr", label: "Cardiothoracic Ratio (CTR)", unit: "ratio", normalRange: "< 0.50", defaultValue: "0.44" }
        ],
        normalImpression: "Normal chest radiograph. No active cardiopulmonary abnormality detected.",
        advice: "Correlate clinically. Repeat film if symptoms persist.",
        quickMacros: [
          {
            label: "RLL Pneumonia",
            sectionTitle: "Lungs & Hilum",
            findingText: "Patchy homogenous airspace opacity with air bronchograms noted in the right lower zone.",
            impressionText: "Right lower zone consolidation \u2014 suggestive of lobar pneumonia. Clinical & CBC correlation advised."
          },
          {
            label: "Mild Cardiomegaly",
            sectionTitle: "Cardiomediastinal Silhouette",
            findingText: "Cardiothoracic ratio is mildly enlarged (0.55) with left ventricular contour prominence.",
            impressionText: "Mild cardiomegaly without overt pulmonary edema. 2D Echocardiography advised."
          },
          {
            label: "Right Pleural Effusion",
            sectionTitle: "Pleura, Diaphragm & Bony Thorax",
            findingText: "Blunting of the right costophrenic angle with homogeneous meniscus opacity tracking up the lateral chest wall.",
            impressionText: "Mild-to-moderate right-sided pleural effusion. USG chest localization recommended."
          }
        ],
        updatedAt: hoursAgo(40),
        updatedBy: "Dr. Nisha Gurung, MD"
      },
      {
        id: "radtpl-kub",
        code: "TPL-XRAY-KUB",
        name: "X-Ray KUB (Kidneys, Ureters, Bladder)",
        modality: "X-RAY",
        technique: "Supine AP radiograph of abdomen & pelvis covering renal outlines to pubic symphysis.",
        indicationPrompt: "Flank pain / Renal colic",
        sections: [
          {
            id: "sec-kub-1",
            title: "Renal Outlines & Psoas Shadows",
            defaultText: "Both renal outlines are normal in position and size. Bilateral psoas muscle margins are well-preserved."
          },
          {
            id: "sec-kub-2",
            title: "Radio-opaque Calculi & Bowel Gas",
            defaultText: "No definite radio-opaque calculus is seen along the expected course of the kidneys, ureters, or urinary bladder. Bowel gas pattern is unremarkable."
          },
          {
            id: "sec-kub-3",
            title: "Visualized Skeleton",
            defaultText: "Lumbar vertebrae, sacroiliac joints, and pelvic bones show no acute bony lesion."
          }
        ],
        measurements: [],
        normalImpression: "No radio-opaque urinary tract calculus identified on plain KUB radiograph.",
        advice: "USG KUB or Non-contrast CT KUB if clinical suspicion of radiolucent stone persists.",
        quickMacros: [
          {
            label: "Right Renal Calculus",
            sectionTitle: "Radio-opaque Calculi & Bowel Gas",
            findingText: "A well-defined ~7 mm radio-opaque density is projected over the right renal fossa.",
            impressionText: "Right renal calculus (~7 mm). Correlate with USG KUB for hydronephrosis."
          }
        ],
        updatedAt: hoursAgo(40),
        updatedBy: "Dr. Nisha Gurung, MD"
      },
      {
        id: "radtpl-ctbrain",
        code: "TPL-CT-BRAIN",
        name: "NCCT Head / Brain (Multi-Slice Axial)",
        modality: "CT",
        technique: "Non-contrast contiguous 5 mm axial CT sections from skull base to vertex with multiplanar reconstructions.",
        indicationPrompt: "Headache / Trauma / Focal neurological deficit",
        sections: [
          {
            id: "sec-ct-1",
            title: "Brain Parenchyma",
            defaultText: "Cerebral hemispheres, basal ganglia, thalami, brainstem, and cerebellum demonstrate normal attenuation with preserved grey-white matter differentiation. No acute territorial infarct, mass lesion, or midline shift."
          },
          {
            id: "sec-ct-2",
            title: "Ventricles, Cisterns & Extra-axial Spaces",
            defaultText: "Ventricular system and basal cisterns are symmetrical and normal in caliber. No subdural, epidural, or subarachnoid hemorrhage."
          },
          {
            id: "sec-ct-3",
            title: "Calvarium & Paranasal Sinuses",
            defaultText: "Calvarial vault and skull base show no fracture. Visualized mastoid air cells and paranasal sinuses are clear."
          }
        ],
        measurements: [
          { id: "m-mls", label: "Midline Shift", unit: "mm", normalRange: "0 mm", defaultValue: "0" },
          { id: "m-evans", label: "Evans' Index", unit: "ratio", normalRange: "< 0.30", defaultValue: "0.25" }
        ],
        normalImpression: "Normal non-contrast CT scan of the brain. No acute intracranial hemorrhage or space-occupying lesion.",
        advice: "MRI Brain with DWI/FLAIR recommended if hyperacute ischemia is clinically suspected.",
        quickMacros: [
          {
            label: "Acute ICH (Basal Ganglia)",
            sectionTitle: "Brain Parenchyma",
            findingText: "Hyperdense acute hematoma (~62 HU) in the left putamen/basal ganglia with mild surrounding vasogenic edema and 3 mm rightward midline shift.",
            impressionText: "CRITICAL: Acute left basal ganglia intraparenchymal hemorrhage with mild mass effect. Urgent neurosurgical evaluation advised."
          },
          {
            label: "Chronic Lacunar Infarct",
            sectionTitle: "Brain Parenchyma",
            findingText: "Small chronic hypodense lacunar focus noted in the right corona radiata without surrounding edema.",
            impressionText: "Old right corona radiata lacunar infarct; mild age-related cerebral atrophy."
          }
        ],
        updatedAt: hoursAgo(40),
        updatedBy: "Dr. Nisha Gurung, MD"
      },
      {
        id: "radtpl-usg",
        code: "TPL-USG-ABD",
        name: "Ultrasound Whole Abdomen & Pelvis",
        modality: "USG",
        technique: "Real-time B-mode and color Doppler transabdominal ultrasonography using 3.5\u20135.0 MHz curvilinear transducer.",
        indicationPrompt: "Abdominal pain / LFT elevation / Routine health check",
        sections: [
          {
            id: "sec-usg-1",
            title: "Liver & Biliary Tree",
            defaultText: "Liver is normal in size and contour with homogeneous parenchymal echotexture. No focal space-occupying lesion. Intrahepatic biliary radicles and CBD are not dilated."
          },
          {
            id: "sec-usg-2",
            title: "Gallbladder, Pancreas & Spleen",
            defaultText: "Gallbladder is well-distended with normal wall thickness; no intraluminal calculus or pericholecystic fluid. Pancreas and spleen appear unremarkable."
          },
          {
            id: "sec-usg-3",
            title: "Kidneys & Urinary Bladder",
            defaultText: "Both kidneys are normal in size, shape, and corticomedullary differentiation without calculus or hydronephrosis. Urinary bladder is well-filled with smooth wall; no free intraperitoneal fluid."
          }
        ],
        measurements: [
          { id: "m-liv", label: "Liver Span (MCL)", unit: "cm", normalRange: "< 15.0 cm", defaultValue: "13.2" },
          { id: "m-cbd", label: "Common Bile Duct (CBD)", unit: "mm", normalRange: "< 6.0 mm", defaultValue: "3.8" },
          { id: "m-rk", label: "Right Kidney Length", unit: "cm", normalRange: "9.0 - 12.0 cm", defaultValue: "10.4" },
          { id: "m-lk", label: "Left Kidney Length", unit: "cm", normalRange: "9.0 - 12.0 cm", defaultValue: "10.6" }
        ],
        normalImpression: "Normal ultrasound study of the whole abdomen and pelvis.",
        advice: "Clinical correlation advised.",
        quickMacros: [
          {
            label: "Grade I Fatty Liver",
            sectionTitle: "Liver & Biliary Tree",
            findingText: "Liver shows mildly increased diffuse parenchymal echogenicity with preserved periportal and diaphragmatic definition.",
            impressionText: "Grade I hepatic steatosis (Fatty Liver). Correlate with LFT & Lipid Profile."
          },
          {
            label: "Cholelithiasis",
            sectionTitle: "Gallbladder, Pancreas & Spleen",
            findingText: "Gallbladder contains a mobile echogenic calculus (~11 mm) casting clean posterior acoustic shadowing; wall thickness normal (2.4 mm).",
            impressionText: "Cholelithiasis without signs of acute cholecystitis."
          }
        ],
        updatedAt: hoursAgo(40),
        updatedBy: "Dr. Nisha Gurung, MD"
      },
      {
        id: "radtpl-echo",
        code: "TPL-ECHO-2D",
        name: "2D Transthoracic Echocardiography & Color Doppler",
        modality: "ECHO",
        technique: "2D, M-mode, Spectral & Color Flow Doppler study via parasternal, apical, and subcostal windows.",
        indicationPrompt: "Chest pain / Dyspnea / Hypertension / Pre-op evaluation",
        sections: [
          {
            id: "sec-echo-1",
            title: "Chambers & Ventricular Function",
            defaultText: "All four cardiac chambers are normal in dimensions. Left ventricular systolic function is normal with no regional wall motion abnormality (RWMA). Normal RV systolic excursion."
          },
          {
            id: "sec-echo-2",
            title: "Valves & Color Doppler",
            defaultText: "Mitral, aortic, tricuspid, and pulmonary valves are morphologically thin and pliable with normal excursion. No significant valvular stenosis or regurgitation. Trace physiological TR only."
          },
          {
            id: "sec-echo-3",
            title: "Pericardium & Great Vessels",
            defaultText: "Intact interatrial and interventricular septa. No pericardial effusion, intracardiac thrombus, or vegetation. Normal aortic root and IVC collapsibility."
          }
        ],
        measurements: [
          { id: "m-lvef", label: "LVEF (Simpsons / Teichholz)", unit: "%", normalRange: "55 - 70 %", defaultValue: "62" },
          { id: "m-lvidd", label: "LVIDd (End-Diastolic)", unit: "mm", normalRange: "39 - 56 mm", defaultValue: "46" },
          { id: "m-ivsd", label: "IVSd Thickness", unit: "mm", normalRange: "6 - 11 mm", defaultValue: "9" },
          { id: "m-rvsp", label: "Estimated PASP / RVSP", unit: "mmHg", normalRange: "< 35 mmHg", defaultValue: "24" }
        ],
        normalImpression: "Normal 2D & Doppler Echocardiography with preserved biventricular systolic function (LVEF 62%).",
        advice: "Cardiology correlation advised.",
        quickMacros: [
          {
            label: "Grade I Diastolic Dysfunction",
            sectionTitle: "Chambers & Ventricular Function",
            findingText: "Concentric LV remodeling with E/A reversal (<0.8) indicating impaired LV relaxation; preserved systolic LVEF (60%).",
            impressionText: "Concentric LV remodeling with Grade I diastolic dysfunction; good LV systolic function (LVEF 60%)."
          }
        ],
        updatedAt: hoursAgo(40),
        updatedBy: "Dr. Nisha Gurung, MD"
      }
    ],
    dashboardLayoutConfigs: DEFAULT_DASHBOARD_LAYOUT_CONFIGS,
    securityAlerts: [
      {
        id: "sec-1",
        timestamp: hoursAgo(18),
        type: "ADMIN_RESET",
        severity: "INFO",
        targetUserId: "staff-6",
        targetUsername: "nighttech",
        targetFullName: "Ramesh Tamang, CMLT",
        targetRole: "LAB_TECH",
        message: "Initial PIN & credential onboarding completed by Super Admin (Reason: Night shift terminal rollout).",
        resolved: true,
        resolvedBy: "Dr. Elena Adhikari, MD",
        resolvedReason: "Night shift terminal rollout",
        resolvedAt: hoursAgo(18)
      }
    ],
    whatsappLogs: [
      {
        id: "wa-1",
        timestamp: hoursAgo(24),
        bsDate: adToBs(hoursAgo(24)).formattedEn,
        recipientPhone: "+977-9851100999",
        totalSalesNpr: 11450,
        ordersCount: 4,
        messagePreview: "Saptari Hospital Daily Sales Summary \xB7 Yesterday \xB7 Total Billing: \u0930\u0942 11,450 \xB7 Cash: \u0930\u0942 4,100 | Bank/QR: \u0930\u0942 4,550 | Hub Credit: \u0930\u0942 2,800",
        sentBy: "Automated Scheduler",
        status: "Sent via WhatsApp"
      }
    ],
    roles: [
      {
        id: "SUPER_ADMIN",
        name: "Hospital Admin (Super Admin)",
        description: "Full Hospital Administrator authority over Modules, Print Designs (Bills/Reports), Referral Payout Approvals, OPD/IPD/ER/MLC, Darta-Chalani, DHIS2, Finance & RBAC.",
        permissions: [...LAB_SUPER_ADMIN_PERMISSIONS]
      },
      {
        id: "LAB_DIRECTOR",
        name: "Medical Officer / Pathologist",
        description: "Clinical validation, ER/MLC management, IPD/OPD clinical care, Nursing charts, Birth/Death certificates & DHIS2.",
        permissions: [
          "dashboard.view",
          "orders.view",
          "orders.create",
          "orders.advance",
          "results.enter",
          "results.validate",
          "radiology.view",
          "hospital.view",
          "hospital.clinical",
          "hospital.manage",
          "ot.view",
          "ot.manage",
          "ot.anesthesia",
          "emergency.view",
          "emergency.manage",
          "darta.view",
          "dhis2.view",
          "dhis2.manage",
          "reports.print",
          "reports.email",
          "reports.api_send",
          "services.view",
          "services.manage",
          "inventory.view",
          "referrals.view",
          "personnel.view",
          "audit.view",
          "mobile.app"
        ]
      },
      {
        id: "RADIOLOGIST",
        name: "Consultant Radiologist / Imaging",
        description: "X-Ray, CT, USG & 2D Echo reporting, saved radiology templates, film retake tracking, and imaging report sign-off.",
        permissions: [
          "dashboard.view",
          "orders.view",
          "orders.create",
          "orders.advance",
          "radiology.view",
          "radiology.report",
          "radiology.manage",
          "hospital.view",
          "emergency.view",
          "results.validate",
          "reports.print",
          "reports.email",
          "reports.api_send",
          "services.view",
          "inventory.view",
          "referrals.view",
          "audit.view",
          "mobile.app"
        ]
      },
      {
        id: "DOCTOR",
        name: "Hospital Physician / Consultant Doctor",
        description: "Patient history, OPD/IPD/ER clinical evaluation, ordering lab/radiology investigations, prescriptions & reviewing verified reports.",
        permissions: [
          "dashboard.view",
          "doctor.view",
          "hospital.view",
          "hospital.clinical",
          "ot.view",
          "ot.manage",
          "ot.anesthesia",
          "emergency.view",
          "emergency.manage",
          "orders.view",
          "radiology.view",
          "reports.print",
          "mis.view",
          "mobile.app"
        ]
      },
      {
        id: "NURSE",
        name: "Ward & Emergency Nursing Officer",
        description: "Dedicated Nursing portal for vitals TPR/BP charting, MAR medication administration, intake/output balance, ER stabilization & shift handover.",
        permissions: [
          "dashboard.view",
          "nursing.view",
          "hospital.view",
          "hospital.clinical",
          "ot.view",
          "ot.manage",
          "emergency.view",
          "personnel.view",
          "mobile.app"
        ]
      },
      {
        id: "PHARMACIST",
        name: "Pharmacy Manager & FEFO Dispenser",
        description: "Central Hospital Pharmacy POS counter, medicine inventory, GRN batch intake, strict FEFO dispensing, expiry quarantine.",
        permissions: [
          "dashboard.view",
          "pharmacy.view",
          "pharmacy.manage",
          "pharmacy.dispense",
          "hospital.view",
          "finance.view",
          "counter.close",
          "mobile.app"
        ]
      },
      {
        id: "PHARMACY_CASHIER",
        name: "Pharmacy Cashier (Fast Billing)",
        description: "Dedicated fast FEFO pharmacy counter cashier for rapid patient dispensing, split Cash/QR billing & shift counter closing.",
        permissions: [
          "dashboard.view",
          "pharmacy.view",
          "pharmacy.dispense",
          "finance.view",
          "counter.close",
          "mobile.app"
        ]
      },
      {
        id: "LAB_TECH",
        name: "Laboratory Technologist",
        description: "Strict laboratory bench role: analyzer result entry, clinical result validation, and diagnostic report printing.",
        permissions: [...LAB_TECH_STRICT_PERMISSIONS]
      },
      {
        id: "CENTER_MANAGER",
        name: "Hospital Front Desk, Billing & Darta Manager",
        description: "Patient registration, Hospital POS billing, OPD/IPD admission, Emergency ticket, Gatepass, Darta-Chalani, DHIS2, Manager Tier-1 Finance Approval & counter close.",
        permissions: [
          "dashboard.view",
          "pos.billing",
          "orders.view",
          "orders.create",
          "radiology.view",
          "pharmacy.view",
          "pharmacy.dispense",
          "hospital.view",
          "hospital.clinical",
          "hospital.manage",
          "ot.view",
          "emergency.view",
          "emergency.manage",
          "gatepass.manage",
          "darta.view",
          "darta.manage",
          "dhis2.view",
          "dhis2.manage",
          "mis.view",
          "reports.print",
          "reports.email",
          "services.view",
          "referrals.view",
          "finance.view",
          "finance.manage",
          "finance.approve_manager",
          "counter.close",
          "personnel.view",
          "mobile.app"
        ]
      },
      {
        id: "INVENTORY_HR",
        name: "Finance, Store, Marketing & HR Officer",
        description: "Hospital store & reagent inventory, field marketing visits, Manager Tier-1 Finance Approval, Hikvision attendance, payroll, gatepass & MIS.",
        permissions: [
          "dashboard.view",
          "services.view",
          "inventory.view",
          "inventory.manage",
          "pharmacy.view",
          "pharmacy.manage",
          "hospital.view",
          "gatepass.manage",
          "marketing.manage",
          "mis.view",
          "darta.view",
          "darta.manage",
          "dhis2.view",
          "finance.view",
          "finance.manage",
          "finance.approve_manager",
          "counter.close",
          "referrals.view",
          "referrals.manage",
          "personnel.view",
          "personnel.manage",
          "payroll.view",
          "payroll.manage",
          "audit.view",
          "mobile.app"
        ]
      },
      {
        id: "BILLING_REPORT",
        name: "Billing & Report Operator (POS + Reports Only)",
        description: "Dedicated billing & report desk role: Hospital POS billing, order lookup, detailed diagnostic report print & dispatch only.",
        permissions: [...BILLING_REPORT_STRICT_PERMISSIONS]
      }
    ],
    staff: [
      {
        id: "staff-1",
        employeeCode: "SHP-001",
        username: "admin",
        password: "Admin@2083",
        pin: "1122",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Dr. Santosh Majhi (Hospital Admin)",
        designation: "Hospital Administrator & Medical Director",
        department: "Hospital Administration",
        email: "saptarihospital@gmail.com",
        phone: "97-1515-6677",
        roleId: "SUPER_ADMIN",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "NMC Reg #8412 \xB7 Hospital Administration",
        registrationNumber: "NMC-8412",
        canSignReports: true,
        joinedAt: "2021-03-15",
        basicSalaryNpr: 155e3,
        technicalAllowanceNpr: 35e3,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 15,
        bankAccountNumber: "NABIL-001928374"
      },
      {
        id: "staff-2",
        employeeCode: "AEG-004",
        username: "director",
        password: "Path@2083",
        pin: "2233",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Dr. Bikram Shrestha, MD",
        designation: "Consultant Hematologist",
        department: "Hematology",
        email: "bikram.shrestha@aegisdiagnostics.com.np",
        phone: "+977-9841220044",
        roleId: "LAB_DIRECTOR",
        shift: "Afternoon (14:00-22:00)",
        status: "Active",
        certification: "NMC Reg #11205 \xB7 Hematology",
        registrationNumber: "NMC-11205",
        canSignReports: true,
        joinedAt: "2022-07-01",
        basicSalaryNpr: 12e4,
        technicalAllowanceNpr: 25e3,
        shiftAllowanceNpr: 8e3,
        ssfPercent: 11,
        tdsPercent: 12,
        bankAccountNumber: "NABIL-004812901"
      },
      {
        id: "staff-rad",
        employeeCode: "AEG-007",
        username: "radiologist",
        password: "Radio@2083",
        pin: "3344",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Dr. Nisha Gurung, MD",
        designation: "Consultant Radiologist (X-Ray, CT, USG, Echo)",
        department: "Radiology",
        email: "nisha.gurung@aegisdiagnostics.com.np",
        phone: "+977-9851177332",
        roleId: "RADIOLOGIST",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "NMC Reg #14902 \xB7 MD Radiodiagnosis",
        registrationNumber: "NMC-14902",
        canSignReports: true,
        joinedAt: "2022-09-12",
        basicSalaryNpr: 138e3,
        technicalAllowanceNpr: 32e3,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 15,
        bankAccountNumber: "NABIL-007912440"
      },
      {
        id: "staff-3",
        employeeCode: "AEG-011",
        username: "labtech",
        password: "Tech@2083",
        pin: "4455",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Priya Maharjan, BMLT",
        designation: "Senior Lab Technologist",
        department: "Clinical Chemistry",
        email: "priya.maharjan@aegisdiagnostics.com.np",
        phone: "+977-9841220111",
        roleId: "LAB_TECH",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "NHPC Reg #A-4912",
        canSignReports: false,
        joinedAt: "2023-01-18",
        basicSalaryNpr: 42e3,
        technicalAllowanceNpr: 8e3,
        shiftAllowanceNpr: 2500,
        ssfPercent: 11,
        tdsPercent: 1,
        bankAccountNumber: "NICASIA-8812031"
      },
      {
        id: "staff-4",
        employeeCode: "AEG-018",
        username: "billing",
        password: "Pos@2083",
        pin: "5566",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Suman Gurung",
        designation: "Hospital Front Desk & Billing Officer",
        department: "Front Desk & Billing",
        email: "billing@saptarihospital.com",
        phone: "+977-9841220188",
        roleId: "CENTER_MANAGER",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "Hospital POS & Darta Operations",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Main",
        joinedAt: "2023-06-12",
        basicSalaryNpr: 48e3,
        technicalAllowanceNpr: 7e3,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 1,
        bankAccountNumber: "NICASIA-7721902"
      },
      {
        id: "staff-5",
        employeeCode: "SHP-022",
        username: "finance",
        password: "Fin@2083",
        pin: "6677",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Aarati Poudel",
        designation: "Finance, HR & Inventory Officer",
        department: "Finance & HR",
        email: "finance@saptarihospital.com",
        phone: "+977-9841220222",
        roleId: "INVENTORY_HR",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "MBA Finance & Hospital Inventory",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Main",
        joinedAt: "2022-11-04",
        basicSalaryNpr: 55e3,
        technicalAllowanceNpr: 1e4,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 2,
        bankAccountNumber: "GIME-4412098"
      },
      {
        id: "staff-6",
        employeeCode: "SHP-029",
        username: "nighttech",
        password: "Night@2083",
        pin: "7788",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Ramesh Tamang, CMLT",
        designation: "Night Shift Bench Technologist",
        department: "Endocrinology",
        email: "lab@saptarihospital.com",
        phone: "+977-9841220299",
        roleId: "LAB_TECH",
        shift: "Night (21:30-07:30)",
        status: "Active",
        certification: "NHPC Reg #B-7103",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Main",
        joinedAt: "2024-02-10",
        basicSalaryNpr: 34e3,
        technicalAllowanceNpr: 5e3,
        shiftAllowanceNpr: 6500,
        ssfPercent: 11,
        tdsPercent: 1,
        bankAccountNumber: "NICASIA-9920144"
      },
      {
        id: "staff-phm-1",
        employeeCode: "SHP-031",
        username: "pharma1",
        password: "Pharma@2083",
        pin: "3131",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Anjali Koirala, B.Pharm",
        designation: "Chief Pharmacist (FEFO & DDA Compliance)",
        department: "Pharmacy ERP",
        email: "pharmacy@saptarihospital.com",
        phone: "+977-9841220311",
        roleId: "PHARMACIST",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "NPC Reg #G-2491 \xB7 B.Pharm",
        registrationNumber: "NPC-G2491",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Central Pharmacy",
        joinedAt: "2023-05-01",
        basicSalaryNpr: 52e3,
        technicalAllowanceNpr: 9e3,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 2,
        bankAccountNumber: "NABIL-009841223"
      },
      {
        id: "staff-phm-cashier",
        employeeCode: "SHP-032",
        username: "cashier_phm",
        password: "Cash@2083",
        pin: "3232",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Bikash Yadav (Pharmacy Cashier)",
        designation: "Central Pharmacy Cashier",
        department: "Central Hospital Pharmacy",
        email: "pharmacy@saptarihospital.com",
        phone: "+977-9841220322",
        roleId: "PHARMACY_CASHIER",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "DDA Pharmacy Dispenser Counter",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Central Pharmacy",
        joinedAt: "2024-01-15",
        basicSalaryNpr: 32e3,
        technicalAllowanceNpr: 4500,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 1,
        bankAccountNumber: "NICASIA-440281911"
      },
      {
        id: "staff-doc-1",
        employeeCode: "SHP-041",
        username: "doctor1",
        password: "Doc@2083",
        pin: "4141",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Dr. Rajesh Kumar Jha, MD",
        designation: "Consultant Physician (OPD / IPD / ER)",
        department: "Internal Medicine",
        email: "dr.jha@saptarihospital.com",
        phone: "+977-9852811041",
        roleId: "DOCTOR",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "NMC Reg #14210 \xB7 MD Medicine",
        registrationNumber: "NMC-14210",
        canSignReports: true,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Main",
        joinedAt: "2022-08-01",
        basicSalaryNpr: 125e3,
        technicalAllowanceNpr: 25e3,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 12,
        bankAccountNumber: "NABIL-004122901"
      },
      {
        id: "staff-nurse-1",
        employeeCode: "SHP-042",
        username: "nurse1",
        password: "Nurse@2083",
        pin: "4242",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Anjali Kumari Yadav, BN",
        designation: "Senior Staff Nurse (Ward & ICU In-Charge)",
        department: "Nursing Station",
        email: "nursing@saptarihospital.com",
        phone: "+977-9842811042",
        roleId: "NURSE",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "NNC Reg #48120 \xB7 Bachelor in Nursing",
        registrationNumber: "NNC-48120",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Main",
        joinedAt: "2023-02-10",
        basicSalaryNpr: 42e3,
        technicalAllowanceNpr: 6e3,
        shiftAllowanceNpr: 2500,
        ssfPercent: 11,
        tdsPercent: 1,
        bankAccountNumber: "NABIL-004288120"
      },
      {
        id: "staff-bill-report",
        employeeCode: "SHP-045",
        username: "cashier_pos",
        password: "Bill@2083",
        pin: "4545",
        failedAttempts: 0,
        isLocked: false,
        fullName: "Kiran Thapa (POS Billing & Report)",
        designation: "Billing Counter & Report Operator",
        department: "POS & Report Dispatch",
        email: "reports@saptarihospital.com",
        phone: "+977-9842811045",
        roleId: "BILLING_REPORT",
        shift: "Morning (07:00-15:00)",
        status: "Active",
        certification: "Hospital POS & Report Dispatch Desk",
        canSignReports: false,
        assignedCenterId: null,
        assignedCenterName: "Saptari Hospital Main",
        joinedAt: "2024-04-01",
        basicSalaryNpr: 28e3,
        technicalAllowanceNpr: 3e3,
        shiftAllowanceNpr: 0,
        ssfPercent: 11,
        tdsPercent: 1,
        bankAccountNumber: "NICASIA-1120045"
      }
    ],
    pharmacyMedicines: [
      {
        id: "med-1",
        code: "MED-AMOX-500",
        brandName: "Moxclav 500 / Amoxil",
        genericName: "Amoxicillin 500mg",
        dosageForm: "Capsule",
        strength: "500 mg",
        manufacturer: "Deurali-Janta Pharma Nepal",
        category: "Antibiotic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-A1",
        unitLabel: "Caps",
        vatApplicable: false,
        reorderLevel: 80,
        defaultMrpNpr: 18,
        active: true
      },
      {
        id: "med-2",
        code: "MED-AZI-500",
        brandName: "Azithro-NP 500",
        genericName: "Azithromycin 500mg",
        dosageForm: "Tablet",
        strength: "500 mg",
        manufacturer: "Quest Pharmaceuticals",
        category: "Antibiotic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-A2",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 60,
        defaultMrpNpr: 34,
        active: true
      },
      {
        id: "med-3",
        code: "MED-PARA-500",
        brandName: "Cetamol 500",
        genericName: "Paracetamol 500mg",
        dosageForm: "Tablet",
        strength: "500 mg",
        manufacturer: "Nepal Pharmaceuticals Lab (NPL)",
        category: "Analgesic / Antipyretic",
        scheduleType: "OTC",
        rackLocation: "RACK-B1",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 200,
        defaultMrpNpr: 3,
        active: true
      },
      {
        id: "med-4",
        code: "MED-PANTO-40",
        brandName: "Pantop-40",
        genericName: "Pantoprazole Sodium 40mg",
        dosageForm: "Tablet",
        strength: "40 mg",
        manufacturer: "Asian Pharmaceuticals",
        category: "Gastro / PPI",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-B3",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 100,
        defaultMrpNpr: 12,
        active: true
      },
      {
        id: "med-5",
        code: "MED-MET-500",
        brandName: "Glycemet 500",
        genericName: "Metformin Hydrochloride 500mg",
        dosageForm: "Tablet",
        strength: "500 mg",
        manufacturer: "Lomus Pharmaceuticals",
        category: "Antidiabetic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-C1",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 120,
        defaultMrpNpr: 6,
        active: true
      },
      {
        id: "med-6",
        code: "MED-CEFT-1G",
        brandName: "Monocef-NP 1g IV",
        genericName: "Ceftriaxone Sodium 1g",
        dosageForm: "Injection",
        strength: "1000 mg",
        manufacturer: "Aristo / Deurali-Janta",
        category: "Injectable Antibiotic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "COLD-CHILL-1",
        unitLabel: "Vials",
        vatApplicable: false,
        reorderLevel: 25,
        defaultMrpNpr: 145,
        active: true
      },
      {
        id: "med-7",
        code: "MED-NS-500",
        brandName: "Normal Saline 0.9% 500mL",
        genericName: "Sodium Chloride 0.9% IV",
        dosageForm: "IV Fluid",
        strength: "500 mL",
        manufacturer: "Baxter / Vijaydeep Lab",
        category: "IV Fluid & Contrast Prep",
        scheduleType: "OTC",
        rackLocation: "BULK-D2",
        unitLabel: "Bottles",
        vatApplicable: false,
        reorderLevel: 40,
        defaultMrpNpr: 95,
        active: true
      },
      {
        id: "med-8",
        code: "MED-ORS-NP",
        brandName: "Jeevan Jal WHO-ORS",
        genericName: "Oral Rehydration Salts (WHO)",
        dosageForm: "Syrup",
        strength: "20.5 g Sachet",
        manufacturer: "Nepal Drug Ltd.",
        category: "Electrolytes",
        scheduleType: "OTC",
        rackLocation: "RACK-E1",
        unitLabel: "Sachets",
        vatApplicable: false,
        reorderLevel: 100,
        defaultMrpNpr: 15,
        active: true
      },
      {
        id: "med-9",
        code: "MED-CIPRO-500",
        brandName: "Ciprox 500",
        genericName: "Ciprofloxacin 500mg",
        dosageForm: "Tablet",
        strength: "500 mg",
        manufacturer: "Deurali-Janta Pharma Nepal",
        category: "Antibiotic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-A3",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 80,
        defaultMrpNpr: 16,
        active: true
      },
      {
        id: "med-10",
        code: "MED-CEFIX-200",
        brandName: "Cefim-200",
        genericName: "Cefixime Trihydrate 200mg",
        dosageForm: "Tablet",
        strength: "200 mg",
        manufacturer: "Time Pharmaceuticals Nepal",
        category: "Antibiotic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-A4",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 70,
        defaultMrpNpr: 28,
        active: true
      },
      {
        id: "med-11",
        code: "MED-METRO-400",
        brandName: "Metron 400",
        genericName: "Metronidazole 400mg",
        dosageForm: "Tablet",
        strength: "400 mg",
        manufacturer: "National Healthcare Nepal",
        category: "Antiprotozoal / Antibiotic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-A5",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 120,
        defaultMrpNpr: 5,
        active: true
      },
      {
        id: "med-12",
        code: "MED-ONDA-4",
        brandName: "Emeset / Ondem 4",
        genericName: "Ondansetron 4mg",
        dosageForm: "Tablet",
        strength: "4 mg",
        manufacturer: "Quest Pharmaceuticals",
        category: "Antiemetic",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-B4",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 60,
        defaultMrpNpr: 14,
        active: true
      },
      {
        id: "med-13",
        code: "MED-DICLO-50",
        brandName: "Voveran / Diclo-NP 50",
        genericName: "Diclofenac Sodium 50mg",
        dosageForm: "Tablet",
        strength: "50 mg",
        manufacturer: "Lomus Pharmaceuticals",
        category: "Analgesic / NSAID",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-B2",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 100,
        defaultMrpNpr: 6,
        active: true
      },
      {
        id: "med-14",
        code: "MED-AMLO-5",
        brandName: "Amlod-5",
        genericName: "Amlodipine Besylate 5mg",
        dosageForm: "Tablet",
        strength: "5 mg",
        manufacturer: "Nepal Pharmaceuticals Lab (NPL)",
        category: "Antihypertensive",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-C2",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 100,
        defaultMrpNpr: 8,
        active: true
      },
      {
        id: "med-15",
        code: "MED-LOSAR-50",
        brandName: "Losar-NP 50",
        genericName: "Losartan Potassium 50mg",
        dosageForm: "Tablet",
        strength: "50 mg",
        manufacturer: "Asian Pharmaceuticals",
        category: "Antihypertensive",
        scheduleType: "Schedule H (Rx)",
        rackLocation: "RACK-C3",
        unitLabel: "Tabs",
        vatApplicable: false,
        reorderLevel: 90,
        defaultMrpNpr: 11,
        active: true
      },
      {
        id: "med-16",
        code: "MED-RL-500",
        brandName: "Ringer Lactate (RL) 500mL",
        genericName: "Compound Sodium Lactate IV",
        dosageForm: "IV Fluid",
        strength: "500 mL",
        manufacturer: "Vijaydeep Laboratories",
        category: "IV Fluid",
        scheduleType: "OTC",
        rackLocation: "BULK-D3",
        unitLabel: "Bottles",
        vatApplicable: false,
        reorderLevel: 40,
        defaultMrpNpr: 105,
        active: true
      }
    ],
    pharmacyBatches: [
      {
        id: "pbat-1",
        medicineId: "med-1",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "AMX-26A1",
        mfgDate: "2025-01-10",
        expiryDate: daysFromNow(18),
        quantityReceived: 120,
        quantityOnHand: 45,
        purchaseRateNpr: 12.5,
        mrpNpr: 18,
        supplierName: "Kathmandu MediDistributors Pvt. Ltd.",
        grnNumber: "GRN-83-011",
        receivedAt: hoursAgo(240)
      },
      {
        id: "pbat-2",
        medicineId: "med-1",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "AMX-26B9",
        mfgDate: "2026-06-01",
        expiryDate: daysFromNow(420),
        quantityReceived: 300,
        quantityOnHand: 280,
        purchaseRateNpr: 12,
        mrpNpr: 18,
        supplierName: "Deurali-Janta Direct Depot",
        grnNumber: "GRN-83-042",
        receivedAt: hoursAgo(48)
      },
      {
        id: "pbat-3",
        medicineId: "med-1",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "AMX-C3-09",
        mfgDate: "2026-04-01",
        expiryDate: daysFromNow(300),
        quantityReceived: 150,
        quantityOnHand: 110,
        purchaseRateNpr: 12.2,
        mrpNpr: 18,
        supplierName: "Janakpur Pharma Supply",
        grnNumber: "GRN-SHP-019",
        receivedAt: hoursAgo(72)
      },
      {
        id: "pbat-4",
        medicineId: "med-2",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "AZI-24OLD",
        mfgDate: "2024-05-01",
        expiryDate: daysFromNow(-12),
        quantityReceived: 50,
        quantityOnHand: 15,
        purchaseRateNpr: 22,
        mrpNpr: 34,
        supplierName: "Quest Depot",
        grnNumber: "GRN-82-099",
        receivedAt: hoursAgo(1200),
        quarantined: false
      },
      {
        id: "pbat-5",
        medicineId: "med-2",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "AZI-26E2",
        mfgDate: "2025-11-15",
        expiryDate: daysFromNow(65),
        quantityReceived: 200,
        quantityOnHand: 130,
        purchaseRateNpr: 23,
        mrpNpr: 34,
        supplierName: "Quest Depot",
        grnNumber: "GRN-83-028",
        receivedAt: hoursAgo(120)
      },
      {
        id: "pbat-6",
        medicineId: "med-3",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "PCM-8841",
        mfgDate: "2026-02-01",
        expiryDate: daysFromNow(510),
        quantityReceived: 1e3,
        quantityOnHand: 860,
        purchaseRateNpr: 1.8,
        mrpNpr: 3,
        supplierName: "NPL Central Warehouse",
        grnNumber: "GRN-83-015",
        receivedAt: hoursAgo(180)
      },
      {
        id: "pbat-7",
        medicineId: "med-4",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "PNT-2607",
        mfgDate: "2026-01-20",
        expiryDate: daysFromNow(28),
        quantityReceived: 200,
        quantityOnHand: 90,
        purchaseRateNpr: 7.5,
        mrpNpr: 12,
        supplierName: "Kathmandu MediDistributors Pvt. Ltd.",
        grnNumber: "GRN-83-004",
        receivedAt: hoursAgo(300)
      },
      {
        id: "pbat-8",
        medicineId: "med-5",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "MET-2633",
        mfgDate: "2026-03-10",
        expiryDate: daysFromNow(390),
        quantityReceived: 500,
        quantityOnHand: 410,
        purchaseRateNpr: 3.4,
        mrpNpr: 6,
        supplierName: "Lomus Pharma Direct",
        grnNumber: "GRN-83-031",
        receivedAt: hoursAgo(90)
      },
      {
        id: "pbat-9",
        medicineId: "med-6",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "CFT-IV90",
        mfgDate: "2026-05-05",
        expiryDate: daysFromNow(260),
        quantityReceived: 80,
        quantityOnHand: 64,
        purchaseRateNpr: 98,
        mrpNpr: 145,
        supplierName: "Aristo Cold-Chain Supply",
        grnNumber: "GRN-83-039",
        receivedAt: hoursAgo(60)
      },
      {
        id: "pbat-10",
        medicineId: "med-7",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "NS-500-22",
        mfgDate: "2026-02-15",
        expiryDate: daysFromNow(310),
        quantityReceived: 120,
        quantityOnHand: 88,
        purchaseRateNpr: 58,
        mrpNpr: 95,
        supplierName: "Kathmandu MediDistributors Pvt. Ltd.",
        grnNumber: "GRN-83-029",
        receivedAt: hoursAgo(110)
      },
      {
        id: "pbat-11",
        medicineId: "med-8",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "ORS-SHP-12",
        mfgDate: "2026-03-01",
        expiryDate: daysFromNow(290),
        quantityReceived: 200,
        quantityOnHand: 165,
        purchaseRateNpr: 9,
        mrpNpr: 15,
        supplierName: "Janakpur Drug Distributors",
        grnNumber: "GRN-SHP-008",
        receivedAt: hoursAgo(80)
      },
      {
        id: "pbat-12",
        medicineId: "med-9",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "CPR-84A",
        mfgDate: "2025-10-12",
        expiryDate: daysFromNow(45),
        quantityReceived: 200,
        quantityOnHand: 110,
        purchaseRateNpr: 9.5,
        mrpNpr: 16,
        supplierName: "Janakpur Drug Distributors",
        grnNumber: "GRN-SHP-021",
        receivedAt: hoursAgo(160)
      },
      {
        id: "pbat-13",
        medicineId: "med-10",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "CFM-200X",
        mfgDate: "2026-04-02",
        expiryDate: daysFromNow(340),
        quantityReceived: 180,
        quantityOnHand: 160,
        purchaseRateNpr: 18,
        mrpNpr: 28,
        supplierName: "Time Pharmaceuticals Depot",
        grnNumber: "GRN-SHP-022",
        receivedAt: hoursAgo(72)
      },
      {
        id: "pbat-14",
        medicineId: "med-11",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "MTR-401Z",
        mfgDate: "2026-02-20",
        expiryDate: daysFromNow(450),
        quantityReceived: 400,
        quantityOnHand: 340,
        purchaseRateNpr: 2.8,
        mrpNpr: 5,
        supplierName: "Janakpur Drug Distributors",
        grnNumber: "GRN-SHP-023",
        receivedAt: hoursAgo(110)
      },
      {
        id: "pbat-15",
        medicineId: "med-12",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "OND-72B",
        mfgDate: "2025-12-01",
        expiryDate: daysFromNow(72),
        quantityReceived: 120,
        quantityOnHand: 80,
        purchaseRateNpr: 8.2,
        mrpNpr: 14,
        supplierName: "Quest Depot",
        grnNumber: "GRN-SHP-024",
        receivedAt: hoursAgo(190)
      },
      {
        id: "pbat-16",
        medicineId: "med-13",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "DCL-509K",
        mfgDate: "2026-03-15",
        expiryDate: daysFromNow(400),
        quantityReceived: 300,
        quantityOnHand: 260,
        purchaseRateNpr: 3.1,
        mrpNpr: 6,
        supplierName: "Lomus Pharma Direct",
        grnNumber: "GRN-SHP-025",
        receivedAt: hoursAgo(50)
      },
      {
        id: "pbat-17",
        medicineId: "med-14",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "AML-55R",
        mfgDate: "2026-04-10",
        expiryDate: daysFromNow(480),
        quantityReceived: 300,
        quantityOnHand: 250,
        purchaseRateNpr: 4.2,
        mrpNpr: 8,
        supplierName: "NPL Central Warehouse",
        grnNumber: "GRN-SHP-026",
        receivedAt: hoursAgo(40)
      },
      {
        id: "pbat-18",
        medicineId: "med-15",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "LSR-301M",
        mfgDate: "2026-04-18",
        expiryDate: daysFromNow(410),
        quantityReceived: 250,
        quantityOnHand: 210,
        purchaseRateNpr: 6.4,
        mrpNpr: 11,
        supplierName: "Asian Pharma Supply",
        grnNumber: "GRN-SHP-027",
        receivedAt: hoursAgo(36)
      },
      {
        id: "pbat-19",
        medicineId: "med-16",
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: "RL-500-99",
        mfgDate: "2026-03-01",
        expiryDate: daysFromNow(360),
        quantityReceived: 120,
        quantityOnHand: 95,
        purchaseRateNpr: 62,
        mrpNpr: 105,
        supplierName: "Kathmandu MediDistributors Pvt. Ltd.",
        grnNumber: "GRN-SHP-028",
        receivedAt: hoursAgo(48)
      }
    ],
    pharmacyDeposits: [],
    pharmacyInvoices: [
      {
        id: "phm-inv-1",
        invoiceNumber: "PHM-INV-2083-001",
        fiscalYear: activeFy,
        dispensedAt: hoursAgo(5),
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        patientName: "Sita Sharma",
        patientPhone: "+977-9841002211",
        patientAge: 46,
        prescribingDoctor: "Dr. Ramesh Karki",
        linkedOrderAccession: "AEG-2083-1041",
        paymentMode: "Cash",
        cashPaid: 540,
        bankPaid: 0,
        subtotalNpr: 540,
        discountNpr: 0,
        vatNpr: 0,
        totalNpr: 540,
        dispensedBy: "Anjali Koirala, B.Pharm",
        lines: [
          {
            medicineId: "med-1",
            medicineName: "Moxclav 500 / Amoxil (500 mg)",
            genericName: "Amoxicillin 500mg",
            batchId: "pbat-1",
            batchNumber: "AMX-26A1",
            expiryDate: daysFromNow(18),
            quantity: 15,
            unitPriceNpr: 18,
            lineTotalNpr: 270
          },
          {
            medicineId: "med-4",
            medicineName: "Pantop-40 (40 mg)",
            genericName: "Pantoprazole Sodium 40mg",
            batchId: "pbat-7",
            batchNumber: "PNT-2607",
            expiryDate: daysFromNow(28),
            quantity: 15,
            unitPriceNpr: 12,
            lineTotalNpr: 180
          },
          {
            medicineId: "med-3",
            medicineName: "Cetamol 500 (500 mg)",
            genericName: "Paracetamol 500mg",
            batchId: "pbat-6",
            batchNumber: "PCM-8841",
            expiryDate: daysFromNow(510),
            quantity: 30,
            unitPriceNpr: 3,
            lineTotalNpr: 90
          }
        ]
      }
    ],
    pharmacyMovements: [
      {
        id: "pmov-1",
        timestamp: hoursAgo(5),
        medicineId: "med-1",
        medicineName: "Moxclav 500 / Amoxil",
        batchId: "pbat-1",
        batchNumber: "AMX-26A1",
        expiryDate: daysFromNow(18),
        centerId: null,
        type: "FEFO_DISPENSE",
        quantityDelta: -15,
        balanceAfter: 45,
        referenceId: "PHM-INV-2083-001",
        performedBy: "Anjali Koirala, B.Pharm",
        notes: "FEFO Auto-Allocated earliest non-expired batch for Sita Sharma (AEG-2083-1041)"
      },
      {
        id: "pmov-2",
        timestamp: hoursAgo(48),
        medicineId: "med-1",
        medicineName: "Moxclav 500 / Amoxil",
        batchId: "pbat-2",
        batchNumber: "AMX-26B9",
        expiryDate: daysFromNow(420),
        centerId: null,
        type: "GRN_IN",
        quantityDelta: 300,
        balanceAfter: 280,
        referenceId: "GRN-83-042",
        performedBy: "Anjali Koirala, B.Pharm",
        notes: "Received 300 Caps from Deurali-Janta Direct Depot"
      }
    ],
    hospitalBeds: [
      {
        id: "bed-1",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "Emergency & Observation",
        wardType: "Emergency / Obs",
        bedCode: "ER-01",
        floorLabel: "Ground Floor",
        dailyRateNpr: 1500,
        hasOxygen: true,
        hasMonitor: true,
        status: "Cleaning",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-2",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "ICU / Critical Care Unit",
        wardType: "ICU / HDU",
        bedCode: "ICU-01",
        floorLabel: "1st Floor",
        dailyRateNpr: 5500,
        hasOxygen: true,
        hasMonitor: true,
        status: "Occupied",
        currentAdmissionId: "ipd-1",
        currentPatientName: "Hari Prasad Thapa"
      },
      {
        id: "bed-3",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "ICU / Critical Care Unit",
        wardType: "ICU / HDU",
        bedCode: "ICU-02",
        floorLabel: "1st Floor",
        dailyRateNpr: 5500,
        hasOxygen: true,
        hasMonitor: true,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-4",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "General Medical Ward",
        wardType: "General Ward",
        bedCode: "GEN-101",
        floorLabel: "2nd Floor",
        dailyRateNpr: 1200,
        hasOxygen: true,
        hasMonitor: false,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-5",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "General Medical Ward",
        wardType: "General Ward",
        bedCode: "GEN-102",
        floorLabel: "2nd Floor",
        dailyRateNpr: 1200,
        hasOxygen: true,
        hasMonitor: false,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-6",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "Semi-Private Twin Cabin",
        wardType: "Semi-Private Cabin",
        bedCode: "SPV-201",
        floorLabel: "2nd Floor",
        dailyRateNpr: 2400,
        hasOxygen: true,
        hasMonitor: false,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-7",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "Deluxe Suite Cabin",
        wardType: "Private Deluxe",
        bedCode: "DLX-301",
        floorLabel: "3rd Floor",
        dailyRateNpr: 4200,
        hasOxygen: true,
        hasMonitor: true,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-8",
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        wardName: "Maternity & Pediatric Unit",
        wardType: "Maternity",
        bedCode: "MAT-204",
        floorLabel: "2nd Floor",
        dailyRateNpr: 2e3,
        hasOxygen: true,
        hasMonitor: false,
        status: "Maintenance",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-9",
        centerId: "ctr-1",
        centerName: "Patan Lagankhel Collection Hub",
        wardName: "Patan Observation & Day-Care Ward",
        wardType: "General Ward",
        bedCode: "PAT-GEN-01",
        floorLabel: "1st Floor",
        dailyRateNpr: 1400,
        hasOxygen: true,
        hasMonitor: false,
        status: "Occupied",
        currentAdmissionId: "ipd-2",
        currentPatientName: "Bishnu Maya Rai"
      },
      {
        id: "bed-10",
        centerId: "ctr-1",
        centerName: "Patan Lagankhel Collection Hub",
        wardName: "Patan Private Cabin",
        wardType: "Private Deluxe",
        bedCode: "PAT-CAB-02",
        floorLabel: "1st Floor",
        dailyRateNpr: 2800,
        hasOxygen: true,
        hasMonitor: true,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      },
      {
        id: "bed-11",
        centerId: "ctr-2",
        centerName: "Pokhara Lakeside Polyclinic Hub",
        wardName: "Pokhara Polyclinic Observation",
        wardType: "Emergency / Obs",
        bedCode: "PKR-OBS-01",
        floorLabel: "Ground Floor",
        dailyRateNpr: 1600,
        hasOxygen: true,
        hasMonitor: true,
        status: "Available",
        currentAdmissionId: null,
        currentPatientName: null
      }
    ],
    opdVisits: [
      {
        id: "opd-1",
        tokenNumber: "OPD-2083-011",
        visitDate: hoursAgo(26),
        fiscalYear: activeFy,
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        patientName: "Sita Sharma",
        patientAge: 46,
        patientAgeType: "Years",
        patientGender: "Female",
        patientPhone: "+977-9841002211",
        patientAddress: "Lazimpat-02, Kathmandu",
        department: "Internal Medicine",
        consultingDoctor: "Dr. Ramesh Karki, MD",
        chiefComplaint: "High-grade fever x 4 days, right upper quadrant discomfort, mild dysuria",
        vitals: { bp: "124/78", pulseBpm: 92, tempF: 101.2, spo2Pct: 98, respRate: 18, weightKg: 61 },
        provisionalDiagnosis: "Suspected Enteric Fever / Mild Transaminitis",
        clinicalNotes: "Hydration encouraged. Baseline CBC, LFT, and Lipid profile advised before antimicrobial review.",
        consultationFeeNpr: 600,
        paymentMode: "Cash",
        prescribedMedicines: [
          {
            id: "opm-1",
            administeredAt: hoursAgo(25),
            medicineId: "med-1",
            medicineName: "Moxclav 500 / Amoxil 500 mg",
            genericName: "Amoxicillin 500mg",
            dosageRoute: "1 Cap PO TDS x 5 days",
            quantity: 15,
            unitPriceNpr: 18,
            totalPriceNpr: 270,
            batchNumber: "AMX-26A1",
            administeredBy: "Dr. Ramesh Karki, MD"
          },
          {
            id: "opm-2",
            administeredAt: hoursAgo(25),
            medicineId: "med-3",
            medicineName: "Cetamol 500 mg",
            genericName: "Paracetamol 500mg",
            dosageRoute: "1 Tab PO SOS for temp > 100\xB0F",
            quantity: 20,
            unitPriceNpr: 3,
            totalPriceNpr: 60,
            batchNumber: "PCM-8841",
            administeredBy: "Dr. Ramesh Karki, MD"
          }
        ],
        investigations: [
          {
            id: "opi-1",
            orderedAt: hoursAgo(25),
            serviceId: "srv-cbc",
            serviceCode: "LAB-CBC",
            serviceName: "Complete Blood Count (CBC) & ESR",
            category: "PATHOLOGY",
            linkedOrderId: "ord-1",
            linkedAccessionNumber: "AEG-2083-1041",
            status: "Completed",
            summaryFinding: "Hb 12.1 g/dL, WBC 9.4 x10^9/L, Platelets 210",
            priceNpr: 650
          },
          {
            id: "opi-2",
            orderedAt: hoursAgo(25),
            serviceId: "srv-lft",
            serviceCode: "LAB-LFT",
            serviceName: "Liver Function Panel (LFT)",
            category: "PATHOLOGY",
            linkedOrderId: "ord-1",
            linkedAccessionNumber: "AEG-2083-1041",
            status: "Completed",
            summaryFinding: "Mildly elevated ALT 68 U/L; Bilirubin normal",
            priceNpr: 1200
          }
        ],
        disposition: "Discharged Home",
        followUpAdvice: "Review with completed LFT report in 5 days. Plenty of oral fluids.",
        recordedBy: "Dr. Ramesh Karki, MD"
      },
      {
        id: "opd-2",
        tokenNumber: "OPD-2083-012",
        visitDate: hoursAgo(8),
        fiscalYear: activeFy,
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        patientName: "Hari Prasad Thapa",
        patientAge: 62,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "+977-9851099441",
        patientAddress: "Baluwatar-04, Kathmandu",
        department: "Emergency & Critical Care",
        consultingDoctor: "Dr. Elena Adhikari, MD",
        chiefComplaint: "High fever with rigors, productive cough, tachypnea & confusion",
        vitals: { bp: "96/62", pulseBpm: 118, tempF: 102.6, spo2Pct: 90, respRate: 26, weightKg: 68 },
        provisionalDiagnosis: "Sepsis Syndrome with Community-Acquired Pneumonia & Thrombocytopenia",
        clinicalNotes: "STAT CBC critical leukocytosis (34.2 x10^9/L) & thrombocytopenia (44k). Urgent ICU bed transfer.",
        consultationFeeNpr: 600,
        paymentMode: "Bank / QR",
        prescribedMedicines: [],
        investigations: [
          {
            id: "opi-3",
            orderedAt: hoursAgo(8),
            serviceId: "srv-cbc",
            serviceCode: "LAB-CBC",
            serviceName: "Complete Blood Count (CBC) \u2014 STAT",
            category: "PATHOLOGY",
            linkedOrderId: "ord-2",
            linkedAccessionNumber: "AEG-2083-1042",
            status: "Ordered",
            summaryFinding: "WBC 34.2 [CRITICAL HIGH], Platelets 44 [CRITICAL LOW]",
            priceNpr: 650
          }
        ],
        disposition: "Admitted to IPD",
        linkedIpdAdmissionId: "ipd-1",
        followUpAdvice: "Admitted to ICU-01 via ER-01 for IV broad-spectrum antibiotics & oxygen therapy.",
        recordedBy: "Dr. Elena Adhikari, MD"
      },
      {
        id: "opd-3",
        tokenNumber: "OPD-PTN-004",
        visitDate: hoursAgo(2),
        fiscalYear: activeFy,
        centerId: "ctr-1",
        centerName: "Patan Lagankhel Collection Hub",
        patientName: "Kamal Bahadur Shrestha",
        patientAge: 34,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "+977-9841558899",
        patientAddress: "Mangal Bazar-12, Lalitpur",
        department: "General Medicine OPD",
        consultingDoctor: "Dr. Suresh Shakya, MBBS",
        chiefComplaint: "Epigastric burning pain x 1 week, post-prandial bloating",
        vitals: { bp: "118/76", pulseBpm: 78, tempF: 98.4, spo2Pct: 99, respRate: 16, weightKg: 70 },
        provisionalDiagnosis: "Acid Peptic Disease / GERD",
        clinicalNotes: "Await USG Abdomen screening.",
        consultationFeeNpr: 500,
        paymentMode: "Cash",
        prescribedMedicines: [
          {
            id: "opm-3",
            administeredAt: hoursAgo(2),
            medicineId: "med-4",
            medicineName: "Pantop-40 (40 mg)",
            genericName: "Pantoprazole Sodium 40mg",
            dosageRoute: "1 Tab PO OD Empty Stomach x 14 days",
            quantity: 14,
            unitPriceNpr: 12,
            totalPriceNpr: 168,
            administeredBy: "Suman Gurung"
          }
        ],
        investigations: [],
        disposition: "In Consultation",
        followUpAdvice: "Avoid spicy food; return with USG findings.",
        recordedBy: "Suman Gurung"
      }
    ],
    ipdAdmissions: [
      {
        id: "ipd-1",
        admissionNumber: "IPD-2083-101",
        fiscalYear: activeFy,
        admittedAt: hoursAgo(8),
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        linkedOpdVisitId: "opd-2",
        patientName: "Hari Prasad Thapa",
        patientAge: 62,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "+977-9851099441",
        patientAddress: "Baluwatar-04, Kathmandu",
        emergencyContact: "Sunita Thapa (Spouse) \xB7 +977-9841223344",
        admittingDoctor: "Dr. Elena Adhikari, MD",
        department: "ICU / Internal Medicine",
        currentBedId: "bed-2",
        currentBedLabel: "ICU-01",
        currentWardName: "ICU / Critical Care Unit",
        bedDailyRateNpr: 5500,
        admittingDiagnosis: "Sepsis Syndrome with Community-Acquired Pneumonia & Thrombocytopenia",
        finalDiagnosis: "",
        hospitalCourseSummary: "Stabilized in ER-01 with IV fluid resuscitation and shifted to ICU-01 for continuous SpO2/cardiac monitoring and IV Ceftriaxone.",
        vitalsOnAdmission: { bp: "96/62", pulseBpm: 118, tempF: 102.6, spo2Pct: 90, respRate: 26, weightKg: 68 },
        progressNotes: [
          {
            id: "pn-1",
            timestamp: hoursAgo(7),
            note: "Admitted via Emergency ER-01. IV Normal Saline 500mL bolus started + Oxygen 4L/min via nasal cannula. SpO2 improved to 95%.",
            recordedBy: "Dr. Elena Adhikari, MD"
          },
          {
            id: "pn-2",
            timestamp: hoursAgo(4),
            note: "Transferred to ICU-01 for close hemodynamic & platelet monitoring. Monocef-NP 1g IV BD initiated.",
            recordedBy: "Dr. Elena Adhikari, MD"
          }
        ],
        nursingCharts: [
          {
            id: "nc-1",
            recordedAt: hoursAgo(6),
            shift: "Morning",
            bp: "104/68",
            pulseBpm: 108,
            tempF: 101.6,
            spo2Pct: 94,
            respRate: 22,
            painScore: 4,
            gcsScore: "15/15",
            intakeOralMl: 150,
            intakeIvMl: 500,
            outputUrineMl: 320,
            outputDrainMl: 0,
            nursingCareNote: "O2 4L/min maintained, IV Monocef 1g given without reaction, strict I/O monitoring.",
            recordedBy: "Sr. Anju Yadav (RN)"
          },
          {
            id: "nc-2",
            recordedAt: hoursAgo(2),
            shift: "Afternoon",
            bp: "112/72",
            pulseBpm: 94,
            tempF: 99.8,
            spo2Pct: 97,
            respRate: 19,
            painScore: 2,
            gcsScore: "15/15",
            intakeOralMl: 300,
            intakeIvMl: 500,
            outputUrineMl: 480,
            outputDrainMl: 0,
            nursingCareNote: "Afebrile trend, oral soft diet tolerated, IV cannula site clean and patent.",
            recordedBy: "Sr. Rekha Chaudhary (RN)"
          }
        ],
        consents: [
          {
            id: "con-1",
            consentCode: "CNS-GEN-101",
            consentType: "GENERAL_ADMISSION",
            title: "General Inpatient Admission & Treatment Consent",
            autoReason: "Auto-assigned on IPD Admission",
            summaryText: "Patient/guardian consents to inpatient admission, nursing care, diagnostic blood/imaging workup, and standard inpatient therapy at Saptari Hospital Pvt Ltd.",
            patientOrGuardianName: "Sunita Thapa (Spouse)",
            relationship: "Spouse",
            witnessName: "Sr. Anju Yadav",
            status: "Signed & Verified",
            signedAt: hoursAgo(8),
            verifiedBy: "Dr. Elena Adhikari, MD",
            createdAt: hoursAgo(8)
          },
          {
            id: "con-2",
            consentCode: "CNS-ICU-101",
            consentType: "ICU_CRITICAL_CARE",
            title: "ICU / Critical Care & High-Risk Monitoring Consent",
            autoReason: "Auto-assigned for ICU / HDU Bed (ICU-01)",
            summaryText: "Explained critical sepsis risk, continuous cardiac/oxygen monitoring, central/IV infusions, and guarded prognosis to next-of-kin.",
            patientOrGuardianName: "Sunita Thapa (Spouse)",
            relationship: "Spouse",
            witnessName: "Dr. Bikram Shrestha",
            status: "Signed & Verified",
            signedAt: hoursAgo(4),
            verifiedBy: "Dr. Elena Adhikari, MD",
            createdAt: hoursAgo(4)
          }
        ],
        bedTransfers: [
          {
            id: "btr-1",
            transferredAt: hoursAgo(4),
            fromBedId: "bed-1",
            fromBedLabel: "ER-01 (Emergency & Observation)",
            toBedId: "bed-2",
            toBedLabel: "ICU-01 (ICU / Critical Care Unit)",
            reason: "Escalation to critical care ICU monitoring due to persistent hypotension & leukocytosis",
            authorizedBy: "Dr. Elena Adhikari, MD"
          }
        ],
        usedMedicines: [
          {
            id: "ium-1",
            administeredAt: hoursAgo(6),
            medicineId: "med-6",
            medicineName: "Monocef-NP 1g IV",
            genericName: "Ceftriaxone Sodium 1g",
            dosageRoute: "1g IV BD",
            quantity: 2,
            unitPriceNpr: 145,
            totalPriceNpr: 290,
            batchNumber: "CFT-IV90",
            expiryDate: daysFromNow(260),
            deductedFromPharmacyFefo: true,
            administeredBy: "ICU Nursing Team"
          },
          {
            id: "ium-2",
            administeredAt: hoursAgo(6),
            medicineId: "med-7",
            medicineName: "Normal Saline 0.9% 500mL",
            genericName: "Sodium Chloride 0.9% IV",
            dosageRoute: "500 mL IV Infusion @ 100 mL/hr",
            quantity: 2,
            unitPriceNpr: 95,
            totalPriceNpr: 190,
            batchNumber: "NS-500-22",
            expiryDate: daysFromNow(310),
            deductedFromPharmacyFefo: true,
            administeredBy: "ICU Nursing Team"
          }
        ],
        investigationsDone: [
          {
            id: "iinv-1",
            orderedAt: hoursAgo(7.5),
            serviceId: "srv-cbc",
            serviceCode: "LAB-CBC",
            serviceName: "Complete Blood Count (CBC) \u2014 STAT",
            category: "PATHOLOGY",
            linkedOrderId: "ord-2",
            linkedAccessionNumber: "AEG-2083-1042",
            status: "Completed",
            summaryFinding: "WBC 34.2 x10^9/L [CRITICAL HIGH], Platelets 44 x10^9/L [CRITICAL LOW]",
            priceNpr: 650
          },
          {
            id: "iinv-2",
            orderedAt: hoursAgo(5),
            serviceId: "srv-rad-cxr",
            serviceCode: "RAD-CXR-PA",
            serviceName: "Digital Chest X-Ray (PA View)",
            category: "RADIOLOGY",
            linkedOrderId: "ord-rad-1",
            linkedAccessionNumber: "AEG-2083-1044",
            status: "Completed",
            summaryFinding: "Right lower zone patchy consolidation consistent with pneumonia; no pleural effusion.",
            priceNpr: 900
          }
        ],
        deposits: [
          {
            id: "dep-1",
            timestamp: hoursAgo(8),
            amountNpr: 15e3,
            paymentMode: "Bank / QR",
            receiptNumber: "IPD-RCP-101",
            notes: "Admission advance deposit (ICU Care)",
            receivedBy: "Front Desk Billing"
          }
        ],
        disposition: "Admitted",
        bedChargesNpr: 5500,
        medicinesTotalNpr: 480,
        investigationsTotalNpr: 1550,
        otherProcedureChargesNpr: 1200,
        totalBillNpr: 8730,
        totalDepositPaidNpr: 15e3,
        balanceDueNpr: -6270
      },
      {
        id: "ipd-2",
        admissionNumber: "IPD-PTN-201",
        fiscalYear: activeFy,
        admittedAt: hoursAgo(14),
        centerId: "ctr-1",
        centerName: "Patan Lagankhel Collection Hub",
        patientName: "Bishnu Maya Rai",
        patientAge: 52,
        patientAgeType: "Years",
        patientGender: "Female",
        patientPhone: "+977-9841776655",
        patientAddress: "Jawalakhel-04, Lalitpur",
        emergencyContact: "Rabin Rai (Son) \xB7 +977-9803344556",
        admittingDoctor: "Dr. Suresh Shakya, MBBS",
        department: "General Medicine",
        currentBedId: "bed-9",
        currentBedLabel: "PAT-GEN-01",
        currentWardName: "Patan Observation & Day-Care Ward",
        bedDailyRateNpr: 1400,
        admittingDiagnosis: "Acute Gastroenteritis with Moderate Dehydration",
        finalDiagnosis: "",
        hospitalCourseSummary: "Admitted for IV rehydration and electrolyte correction.",
        vitalsOnAdmission: { bp: "100/66", pulseBpm: 102, tempF: 99.6, spo2Pct: 97, respRate: 20, weightKg: 54 },
        progressNotes: [
          {
            id: "pn-p1",
            timestamp: hoursAgo(12),
            note: "IV Normal Saline infusion ongoing. Oral intake tolerated after 6 hours.",
            recordedBy: "Suman Gurung"
          }
        ],
        bedTransfers: [],
        usedMedicines: [
          {
            id: "ium-p1",
            administeredAt: hoursAgo(13),
            medicineId: "med-1",
            medicineName: "Moxclav 500 / Amoxil 500 mg",
            genericName: "Amoxicillin 500mg",
            dosageRoute: "1 Cap PO TDS",
            quantity: 6,
            unitPriceNpr: 18,
            totalPriceNpr: 108,
            batchNumber: "AMX-PTN-09",
            administeredBy: "Patan Nursing Desk"
          }
        ],
        investigationsDone: [],
        deposits: [
          {
            id: "dep-p1",
            timestamp: hoursAgo(14),
            amountNpr: 5e3,
            paymentMode: "Cash",
            receiptNumber: "IPD-PTN-201",
            notes: "Day-care observation deposit",
            receivedBy: "Suman Gurung"
          }
        ],
        disposition: "Admitted",
        bedChargesNpr: 1400,
        medicinesTotalNpr: 108,
        investigationsTotalNpr: 0,
        otherProcedureChargesNpr: 500,
        totalBillNpr: 2008,
        totalDepositPaidNpr: 5e3,
        balanceDueNpr: -2992
      },
      {
        id: "ipd-3",
        admissionNumber: "IPD-2083-098",
        fiscalYear: activeFy,
        admittedAt: hoursAgo(52),
        centerId: null,
        centerName: "Main Reference Hospital Hub",
        patientName: "Govinda Prasad Adhikari",
        patientAge: 67,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "+977-9841339988",
        patientAddress: "Chabahil-07, Kathmandu",
        emergencyContact: "Prakash Adhikari (Son) \xB7 +977-9851188221",
        admittingDoctor: "Dr. Elena Adhikari, MD",
        department: "Emergency & Cardiology Stabilization",
        currentBedId: "bed-1",
        currentBedLabel: "ER-01",
        currentWardName: "Emergency & Observation",
        bedDailyRateNpr: 1500,
        admittingDiagnosis: "Acute Anterior Wall STEMI with Reduced LVEF",
        finalDiagnosis: "Acute Anterior Wall STEMI \u2014 Stabilized & Referred for Primary PCI",
        hospitalCourseSummary: "Presented with acute retrosternal chest pain radiating to left arm. Dual antiplatelet loading dose, IV Pantoprazole & Morphine/analgesia given. Stat 2D Echo showed anterior hypokinesia (LVEF 38%). Immediately stabilized and referred to Shahid Gangalal National Heart Centre for emergency Primary PCI.",
        vitalsOnAdmission: { bp: "148/92", pulseBpm: 106, tempF: 98.6, spo2Pct: 93, respRate: 24, weightKg: 74 },
        progressNotes: [
          {
            id: "pn-31",
            timestamp: hoursAgo(51),
            note: "12-lead ECG showed ST elevation V1\u2013V4. Emergency loading Aspirin 300mg + Clopidogrel 300mg + Atorvastatin 80mg administered.",
            recordedBy: "Dr. Elena Adhikari, MD"
          },
          {
            id: "pn-32",
            timestamp: hoursAgo(49),
            note: "Stat Bedside 2D Echo completed by Dr. Nisha Gurung. Discussed urgent Primary PCI referral with patient son; ALS Ambulance arranged.",
            recordedBy: "Dr. Elena Adhikari, MD"
          }
        ],
        bedTransfers: [],
        usedMedicines: [
          {
            id: "ium-31",
            administeredAt: hoursAgo(51),
            medicineId: "med-4",
            medicineName: "Pantop-40 (40 mg)",
            genericName: "Pantoprazole Sodium 40mg",
            dosageRoute: "40mg IV/PO Stat Pre-Loading",
            quantity: 2,
            unitPriceNpr: 12,
            totalPriceNpr: 24,
            batchNumber: "PNT-2607",
            administeredBy: "ER Nursing Team"
          },
          {
            id: "ium-32",
            administeredAt: hoursAgo(51),
            medicineId: "med-7",
            medicineName: "Normal Saline 0.9% 500mL",
            genericName: "Sodium Chloride 0.9% IV",
            dosageRoute: "KVO IV Access Line",
            quantity: 1,
            unitPriceNpr: 95,
            totalPriceNpr: 95,
            batchNumber: "NS-500-22",
            administeredBy: "ER Nursing Team"
          }
        ],
        investigationsDone: [
          {
            id: "iinv-31",
            orderedAt: hoursAgo(51),
            serviceId: "srv-rad-echo",
            serviceCode: "RAD-ECHO-2D",
            serviceName: "2D Transthoracic Echocardiography + Doppler",
            category: "RADIOLOGY",
            linkedAccessionNumber: "AEG-2083-1039",
            status: "Completed",
            summaryFinding: "Anterior wall hypokinesia with LVEF 38%; mild MR; no pericardial effusion.",
            priceNpr: 2800
          },
          {
            id: "iinv-32",
            orderedAt: hoursAgo(51),
            serviceId: "srv-cbc",
            serviceCode: "LAB-CBC",
            serviceName: "Complete Blood Count (CBC) & Cardiac Workup",
            category: "PATHOLOGY",
            linkedAccessionNumber: "AEG-2083-1039",
            status: "Completed",
            summaryFinding: "Hb 13.4 g/dL, WBC 11.8 x10^9/L, Platelets 240 x10^9/L",
            priceNpr: 650
          }
        ],
        deposits: [
          {
            id: "dep-31",
            timestamp: hoursAgo(52),
            amountNpr: 6e3,
            paymentMode: "Cash",
            receiptNumber: "IPD-RCP-098",
            notes: "ER Stabilization & Referral Settlement",
            receivedBy: "Cash Counter"
          }
        ],
        disposition: "Referred to External Hospital",
        dischargedAt: hoursAgo(48),
        dischargeCondition: "Hemodynamically stabilized on Oxygen 3L/min & IV access; pain improved (4/10)",
        dischargeAdvice: "Hand over Echo CD, ECG strips, and Saptari Hospital Deposition Summary directly to Emergency Cath-Lab Triage.",
        followUpDateBs: "Immediate Emergency Cath-Lab Transfer",
        externalReferral: {
          referredToHospital: "Shahid Gangalal National Heart Centre (SGNHC)",
          referredToPlace: "Bansbari, Kathmandu-03, Nepal",
          referredDepartment: "Emergency Interventional Cardiology / Primary PCI Cath-Lab",
          referralReason: "Requires immediate Primary PCI / Coronary Angiography for Acute Anterior STEMI",
          conditionAtReferral: "Conscious, oriented, BP 132/84 mmHg, HR 94 bpm, SpO2 97% on 3L O2",
          transportMode: "ALS Ambulance",
          escortDoctorOrNurse: "Dr. Ramesh Karki + Paramedic",
          referredAt: hoursAgo(48),
          referredBy: "Dr. Elena Adhikari, MD"
        },
        bedChargesNpr: 1500,
        medicinesTotalNpr: 119,
        investigationsTotalNpr: 3450,
        otherProcedureChargesNpr: 931,
        totalBillNpr: 6e3,
        totalDepositPaidNpr: 6e3,
        balanceDueNpr: 0,
        dischargedBy: "Dr. Elena Adhikari, MD"
      }
    ],
    emergencyCases: [
      {
        id: "er-1",
        erNumber: "ER-2083-001",
        registeredAt: hoursAgo(5),
        fiscalYear: activeFy,
        centerId: null,
        centerName: "Saptari Hospital Pvt Ltd (Bode Barsain)",
        patientName: "Dinesh Kumar Mandal",
        patientAge: 29,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "9804711223",
        patientAddress: "Bode Barsain-05, Saptari",
        broughtByName: "Suresh Mandal",
        broughtByRelation: "Brother",
        broughtByPhone: "9804711990",
        triageLevel: "Yellow (Urgent)",
        arrivalMode: "Ambulance",
        chiefComplaint: "Motorcycle skid RTA near Bode Barsain Chowk \u2014 right forearm laceration & swelling",
        vitals: { bp: "116/76", pulseBpm: 102, tempF: 98.6, spo2Pct: 98, respRate: 20, weightKg: 64 },
        erBedBay: "ER-BAY-01",
        attendingDoctor: "Dr. Santosh Majhi",
        clinicalNotes: "Wound irrigated, tetanus toxoid 0.5mL IM given, X-Ray Right Forearm AP/Lat ordered.",
        isMlc: true,
        mlcNumber: "MLC-2083-001",
        mlcCaseType: "RTA (Road Traffic Accident)",
        incidentPlace: "Bode Barsain-05 Main Road, Saptari",
        incidentTimeText: "11:30 AM Today",
        identificationMarks: "Small mole on left cheek; scar on right knee",
        injurySummary: "4x1 cm lacerated wound over right dorsal forearm with tenderness; no neurovascular deficit.",
        policeStationName: "Ilaka Prahari Karyalaya (Area Police Office), Bode Barsain",
        policeStationAddress: "Bode Barsain Municipality-04, Saptari",
        policeStationPhone: "031-560100",
        policeInformed: true,
        policeInformedNumber: "MLC-INF-2083-001",
        policeInformedAt: hoursAgo(4.5),
        policeOfficerName: "ASI Ram Narayan Sah",
        policeInformMode: "Telephone Call",
        policeInformedBy: "Dr. Santosh Majhi",
        consents: [
          {
            id: "ercon-1",
            consentCode: "CNS-ER-001",
            consentType: "EMERGENCY_TREATMENT",
            title: "Emergency Resuscitation & Wound Care Consent",
            autoReason: "Auto-assigned on ER Triage Registration",
            summaryText: "Consent for immediate emergency stabilization, suturing, tetanus prophylaxis, and diagnostic X-ray.",
            patientOrGuardianName: "Suresh Mandal",
            relationship: "Brother",
            witnessName: "ER Staff Nurse",
            status: "Signed & Verified",
            signedAt: hoursAgo(4.8),
            verifiedBy: "Dr. Santosh Majhi",
            createdAt: hoursAgo(5)
          },
          {
            id: "ercon-2",
            consentCode: "CNS-MLC-001",
            consentType: "MLC_FORENSIC_EXAM",
            title: "Medico-Legal (MLC) Clinical Examination & Police Intimation Consent",
            autoReason: "Auto-assigned for Medico-Legal Case (RTA)",
            summaryText: "Patient and attendant notified regarding mandatory medico-legal documentation and formal intimation to Ilaka Prahari Karyalaya, Bode Barsain.",
            patientOrGuardianName: "Suresh Mandal",
            relationship: "Brother",
            witnessName: "ASI Ram Narayan Sah",
            status: "Signed & Verified",
            signedAt: hoursAgo(4.6),
            verifiedBy: "Dr. Santosh Majhi",
            createdAt: hoursAgo(5)
          }
        ],
        disposition: "Under Observation (ER)",
        erChargesNpr: 1200,
        paymentMode: "Cash",
        recordedBy: "Dr. Santosh Majhi"
      },
      {
        id: "er-2",
        erNumber: "ER-2083-002",
        registeredAt: hoursAgo(1.2),
        fiscalYear: activeFy,
        centerId: null,
        centerName: "Saptari Hospital Pvt Ltd (Bode Barsain)",
        patientName: "Rameshwar Yadav",
        patientAge: 36,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "9815700812",
        patientAddress: "Kalyanpur-03, Saptari",
        broughtByName: "Hari Yadav",
        broughtByRelation: "Neighbor",
        broughtByPhone: "9815700899",
        triageLevel: "Red (Resuscitation)",
        arrivalMode: "Private Vehicle",
        chiefComplaint: "Alleged physical assault with blunt trauma scalp & chest",
        vitals: { bp: "138/88", pulseBpm: 112, tempF: 98.8, spo2Pct: 96, respRate: 22, weightKg: 68 },
        erBedBay: "ER-RESUS-02",
        attendingDoctor: "Dr. Santosh Majhi",
        clinicalNotes: "IV access secured, analgesia given, CT Head & Chest X-ray ordered.",
        isMlc: true,
        mlcNumber: "MLC-2083-002",
        mlcCaseType: "Physical Assault / Injury",
        incidentPlace: "Kalyanpur Chowk, Saptari",
        incidentTimeText: "Approx 1 hr ago",
        identificationMarks: "Tattoo mark on right wrist",
        injurySummary: "3 cm scalp contused lacerated wound over left parietal region; mild chest wall tenderness.",
        policeStationName: "Prahari Chowki, Kalyanpur (under DPO Saptari)",
        policeStationAddress: "Kalyanpur, Saptari",
        policeStationPhone: "031-520100",
        policeInformed: false,
        consents: [
          {
            id: "ercon-3",
            consentCode: "CNS-ER-002",
            consentType: "EMERGENCY_TREATMENT",
            title: "Emergency Resuscitation & Wound Care Consent",
            autoReason: "Auto-assigned on ER Red Triage",
            summaryText: "Emergency trauma care, imaging, and stabilization consent.",
            patientOrGuardianName: "Hari Yadav",
            relationship: "Attendant",
            witnessName: "ER Duty Nurse",
            status: "Auto-Assigned (Pending Signature)",
            createdAt: hoursAgo(1.2)
          },
          {
            id: "ercon-4",
            consentCode: "CNS-MLC-002",
            consentType: "MLC_FORENSIC_EXAM",
            title: "Medico-Legal (MLC) Clinical Examination & Police Intimation Consent",
            autoReason: "Auto-assigned for Physical Assault MLC",
            summaryText: "Mandatory MLC recording & police station intimation.",
            patientOrGuardianName: "Hari Yadav",
            relationship: "Attendant",
            witnessName: "ER Duty Nurse",
            status: "Auto-Assigned (Pending Signature)",
            createdAt: hoursAgo(1.2)
          }
        ],
        disposition: "Under Observation (ER)",
        erChargesNpr: 1800,
        paymentMode: "Cash",
        recordedBy: "Dr. Santosh Majhi"
      }
    ],
    dartaChalani: [
      {
        id: "dc-1",
        entryType: "DARTA",
        serialNo: 1,
        entryNumber: `DARTA-${activeFy.replace("FY ", "")}-001`,
        refNumber: "BBM-HS-2083/044",
        fiscalYear: activeFy,
        entryDateAd: new Date(Date.now() - 48 * 3600 * 1e3).toISOString().slice(0, 10),
        entryDateBs: adToBs(new Date(Date.now() - 48 * 3600 * 1e3)).formattedEn,
        partyName: "Health Section, Bode Barsain Municipality",
        partyAddress: "Bode Barsain, Saptari, Nepal",
        subject: "Monthly DHIS2 / HMIS Aggregate Report Submission Circular",
        category: "Municipality / Health Section",
        department: "Medical Records & HMIS",
        handledBy: "Hospital Admin",
        documentBody: "Received official circular from Bode Barsain Municipality Health Section instructing Saptari Hospital Pvt Ltd to submit signed 2-page non-API DHIS2/HMIS monthly utilization & birth/death summary by the 5th of every Nepali month.",
        attachments: [
          {
            id: "att-1",
            fileName: "BodeBarsain_HMIS_Circular_2083.pdf",
            fileType: "application/pdf",
            note: "Signed Municipal Health Section Circular (2 pages)",
            attachedAt: hoursAgo(48)
          }
        ],
        status: "Verified / Dispatched",
        remarks: "Acknowledged by Medical Superintendent; DHIS2 monthly cycle scheduled.",
        recordedBy: "Dr. Santosh Majhi (Hospital Admin)"
      },
      {
        id: "dc-2",
        entryType: "CHALANI",
        serialNo: 1,
        entryNumber: `CHALANI-${activeFy.replace("FY ", "")}-001`,
        refNumber: "SHP-MLC-2083/001",
        fiscalYear: activeFy,
        entryDateAd: new Date(Date.now() - 4 * 3600 * 1e3).toISOString().slice(0, 10),
        entryDateBs: adToBs(new Date(Date.now() - 4 * 3600 * 1e3)).formattedEn,
        partyName: "Ilaka Prahari Karyalaya (Area Police Office), Bode Barsain",
        partyAddress: "Bode Barsain-04, Saptari",
        subject: "Formal Police Intimation for MLC-2083-001 (Dinesh Kumar Mandal - RTA)",
        category: "Police / MLC Correspondence",
        department: "Emergency & MLC Desk",
        handledBy: "Dr. Santosh Majhi",
        documentBody: "With reference to Medico-Legal Case No. MLC-2083-001 (ER-2083-001), this is to formally inform Ilaka Prahari Karyalaya, Bode Barsain that Mr. Dinesh Kumar Mandal (Age 29, Bode Barsain-05) was brought to Saptari Hospital Pvt Ltd following an RTA with right forearm lacerated wound. Telephonic & written intimation completed.",
        attachments: [
          {
            id: "att-2",
            fileName: "MLC_2083_001_Police_Intimation_Copy.pdf",
            fileType: "application/pdf",
            note: "Signed by ASI Ram Narayan Sah & ER Medical Officer",
            attachedAt: hoursAgo(4)
          }
        ],
        status: "Verified / Dispatched",
        remarks: "Dispatched with Informed Ref #MLC-INF-2083-001",
        recordedBy: "Dr. Santosh Majhi"
      }
    ],
    birthCertificates: [
      {
        id: "bcert-1",
        certificateNumber: "SHP-BIRTH-2083-001",
        fiscalYear: activeFy,
        issuedAt: hoursAgo(36),
        motherName: "Anita Kumari Chaudhary",
        motherAge: 25,
        motherCitizenshipNo: "15-01-74-04912",
        fatherName: "Manoj Kumar Chaudhary",
        fatherCitizenshipNo: "15-01-71-02119",
        permanentAddress: "Bode Barsain-06, Saptari, Nepal",
        babyName: "Baby of Anita Kumari Chaudhary",
        babyGender: "Female",
        birthDateAd: new Date(Date.now() - 36 * 3600 * 1e3).toISOString().slice(0, 10),
        birthDateBs: adToBs(new Date(Date.now() - 36 * 3600 * 1e3)).formattedEn,
        birthTime: "06:42 AM",
        birthWeightKg: 3.1,
        deliveryType: "Normal Vaginal Delivery",
        apgar1Min: 8,
        apgar5Min: 9,
        placeOfBirth: "Saptari Hospital Pvt Ltd, Bode Barsain (Saptari, Nepal)",
        attendingDoctor: "Dr. Sunita Basnet, MD",
        issuedBy: "Medical Records Officer"
      }
    ],
    deathCertificates: [
      {
        id: "dcert-1",
        certificateNumber: "SHP-DEATH-2083-001",
        fiscalYear: activeFy,
        issuedAt: hoursAgo(72),
        deceasedName: "Late Ramprit Sah",
        age: 74,
        ageType: "Years",
        gender: "Male",
        citizenshipNo: "15-01-42-00831",
        fatherOrSpouseName: "Late Bhikhari Sah",
        permanentAddress: "Bode Barsain-02, Saptari, Nepal",
        deathDateAd: new Date(Date.now() - 72 * 3600 * 1e3).toISOString().slice(0, 10),
        deathDateBs: adToBs(new Date(Date.now() - 72 * 3600 * 1e3)).formattedEn,
        deathTime: "02:15 AM",
        wardOrPlaceOfDeath: "ICU / Critical Care Unit \u2014 Saptari Hospital Pvt Ltd",
        immediateCauseOfDeath: "Cardiopulmonary Arrest secondary to Acute Decompensated Heart Failure",
        antecedentCause: "Chronic Hypertensive Heart Disease & COPD",
        mannerOfDeath: "Natural",
        isMlc: false,
        bodyHandedOverTo: "Shyam Kumar Sah",
        handoverRelation: "Son",
        handoverPhone: "9807712345",
        certifyingDoctor: "Dr. Santosh Majhi",
        doctorRegNo: "NMC-8412",
        issuedBy: "Hospital Admin"
      }
    ],
    dhis2Reports: [
      {
        id: "dhis-1",
        reportCode: `DHIS2-SHP-${currentBs.year}-${String(currentBs.month).padStart(2, "0")}`,
        fiscalYear: activeFy,
        bsYear: currentBs.year,
        bsMonthIndex: currentBs.month,
        bsMonthName: currentBs.monthNameEn,
        generatedAt: hoursAgo(2),
        municipalityTargetName: "Health Section, Bode Barsain Municipality, Saptari, Nepal",
        status: "Draft",
        opdNewFemale: 18,
        opdNewMale: 14,
        opdFollowupTotal: 9,
        emergencyTotalVisits: 12,
        emergencyMlcCases: 2,
        ipdTotalAdmissions: 6,
        ipdTotalBedDays: 19,
        ipdTotalBedsAvailable: 11,
        ipdBedOccupancyPercent: 34,
        ipdDischargedHome: 3,
        ipdReferredOut: 1,
        ipdLamaCases: 0,
        normalDeliveries: 4,
        cesareanDeliveries: 1,
        liveBirthsMale: 2,
        liveBirthsFemale: 3,
        lowBirthWeightCount: 0,
        institutionalDeaths: 1,
        maternalDeaths: 0,
        neonatalDeaths: 0,
        pathologyTestsDone: 42,
        xrayStudiesDone: 15,
        usgEchoDone: 11,
        ctEcgDone: 6,
        morbidityAriPneumonia: 8,
        morbidityDiarrheaDysentery: 5,
        morbidityHypertensionCvd: 7,
        morbidityDiabetes: 4,
        morbidityTraumaRta: 3,
        morbidityEntericFever: 4,
        pharmacyStockoutItemsCount: 0,
        pharmacyBillsIssued: 14,
        remarks: "Non-API monthly HMIS aggregate verified from Saptari Hospital Pvt Ltd OPD, ER/MLC, IPD, Maternity & Diagnostic Registers.",
        preparedBy: "Medical Records Officer",
        approvedByDoctor: "Dr. Santosh Majhi (Medical Director)"
      }
    ],
    reagents: [
      {
        id: "reg-1",
        sku: "SYX-DIL-20L",
        name: "CellPack Hematology Diluent (20L)",
        manufacturer: "Sysmex Corp",
        category: "Buffer / Diluent",
        lotNumber: "LOT-SYX-2611A",
        expiryDate: daysFromNow(145),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 18400,
        unit: "mL",
        reorderLevel: 4e3,
        unitCost: 4.5,
        lastRestockedAt: hoursAgo(120),
        autoDeductEnabled: true
      },
      {
        id: "reg-2",
        sku: "SYX-LYS-500",
        name: "Stromatolyser-4DL Lytic Reagent",
        manufacturer: "Sysmex Corp",
        category: "Reagent Pack",
        lotNumber: "LOT-LY-8810B",
        expiryDate: daysFromNow(92),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 860,
        unit: "mL",
        reorderLevel: 250,
        unitCost: 38,
        lastRestockedAt: hoursAgo(96),
        autoDeductEnabled: true
      },
      {
        id: "reg-3",
        sku: "RCH-LFT-400",
        name: "Cobas Hepatic Enzyme Cassette (ALT/AST/Bili)",
        manufacturer: "Roche Diagnostics",
        category: "Reagent Pack",
        lotNumber: "LOT-RC-4402C",
        expiryDate: daysFromNow(18),
        storageCondition: "2-8\xB0C",
        currentStock: 34,
        unit: "tests",
        reorderLevel: 40,
        unitCost: 480,
        lastRestockedAt: hoursAgo(240),
        autoDeductEnabled: true
      },
      {
        id: "reg-4",
        sku: "RCH-LIP-300",
        name: "Cobas Lipid Enzymatic Reagent Pack",
        manufacturer: "Roche Diagnostics",
        category: "Reagent Pack",
        lotNumber: "LOT-RC-9012L",
        expiryDate: daysFromNow(110),
        storageCondition: "2-8\xB0C",
        currentStock: 142,
        unit: "tests",
        reorderLevel: 35,
        unitCost: 390,
        lastRestockedAt: hoursAgo(72),
        autoDeductEnabled: true
      },
      {
        id: "reg-5",
        sku: "ABT-TFT-200",
        name: "Alinity Chemiluminescent Thyroid Kit (TSH/FT3/FT4)",
        manufacturer: "Abbott Diagnostics",
        category: "Reagent Pack",
        lotNumber: "LOT-AB-3190T",
        expiryDate: daysFromNow(76),
        storageCondition: "2-8\xB0C",
        currentStock: 28,
        unit: "tests",
        reorderLevel: 30,
        unitCost: 750,
        lastRestockedAt: hoursAgo(310),
        autoDeductEnabled: true
      },
      {
        id: "reg-6",
        sku: "BIO-HBA-1L",
        name: "D-10 HPLC Elution Buffer A",
        manufacturer: "Bio-Rad Laboratories",
        category: "Buffer / Diluent",
        lotNumber: "LOT-BR-5520H",
        expiryDate: daysFromNow(160),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 920,
        unit: "mL",
        reorderLevel: 200,
        unitCost: 52,
        lastRestockedAt: hoursAgo(168),
        autoDeductEnabled: true
      },
      {
        id: "reg-7",
        sku: "RCH-REN-500",
        name: "Cobas Creatinine Plus & Urea Kinetic Pack",
        manufacturer: "Roche Diagnostics",
        category: "Reagent Pack",
        lotNumber: "LOT-RC-7721K",
        expiryDate: daysFromNow(134),
        storageCondition: "2-8\xB0C",
        currentStock: 215,
        unit: "tests",
        reorderLevel: 50,
        unitCost: 310,
        lastRestockedAt: hoursAgo(48),
        autoDeductEnabled: true
      },
      {
        id: "reg-8",
        sku: "QC-MULT-10",
        name: "Bio-Rad Lyphochek Assayed Chemistry Control",
        manufacturer: "Bio-Rad Laboratories",
        category: "Calibrator / QC",
        lotNumber: "LOT-QC-1029X",
        expiryDate: daysFromNow(11),
        storageCondition: "-20\xB0C",
        currentStock: 14,
        unit: "vials",
        reorderLevel: 10,
        unitCost: 3200,
        lastRestockedAt: hoursAgo(400),
        autoDeductEnabled: false
      },
      {
        id: "reg-9",
        sku: "XRY-FILM-1417",
        name: "Fujifilm DryPix Medical Laser X-Ray Film (14\xD717 inch)",
        manufacturer: "Fujifilm Medical",
        category: "X-Ray Film",
        lotNumber: "LOT-FJ-1417A",
        expiryDate: daysFromNow(240),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 180,
        unit: "films",
        reorderLevel: 40,
        unitCost: 165,
        lastRestockedAt: hoursAgo(60),
        autoDeductEnabled: true
      },
      {
        id: "reg-10",
        sku: "XRY-FILM-1012",
        name: "Carestream DryView Imaging Film (10\xD712 inch)",
        manufacturer: "Carestream Health",
        category: "X-Ray Film",
        lotNumber: "LOT-CS-1012B",
        expiryDate: daysFromNow(210),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 95,
        unit: "films",
        reorderLevel: 30,
        unitCost: 120,
        lastRestockedAt: hoursAgo(80),
        autoDeductEnabled: true
      },
      {
        id: "reg-11",
        sku: "CT-CONT-350",
        name: "Omnipaque Iohexol 350 mg I/mL IV Contrast (100 mL)",
        manufacturer: "GE HealthCare",
        category: "CT Contrast",
        lotNumber: "LOT-GE-350CT",
        expiryDate: daysFromNow(180),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 24,
        unit: "vials",
        reorderLevel: 8,
        unitCost: 1850,
        lastRestockedAt: hoursAgo(110),
        autoDeductEnabled: true
      },
      {
        id: "reg-12",
        sku: "USG-GEL-5L",
        name: "Aquasonic Ultrasound & Echo Acoustic Coupling Gel (5L)",
        manufacturer: "Parker Laboratories",
        category: "USG / Echo Consumable",
        lotNumber: "LOT-PK-500G",
        expiryDate: daysFromNow(360),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 4500,
        unit: "mL",
        reorderLevel: 1e3,
        unitCost: 0.45,
        lastRestockedAt: hoursAgo(90),
        autoDeductEnabled: true
      },
      {
        id: "reg-13",
        sku: "ECHO-THM-110",
        name: "Sony UPP-110HD USG & 2D Echo Thermal Print Roll",
        manufacturer: "Sony Medical",
        category: "USG / Echo Consumable",
        lotNumber: "LOT-SN-110HD",
        expiryDate: daysFromNow(400),
        storageCondition: "15-25\xB0C (Ambient)",
        currentStock: 32,
        unit: "rolls",
        reorderLevel: 10,
        unitCost: 950,
        lastRestockedAt: hoursAgo(50),
        autoDeductEnabled: true
      }
    ],
    inventoryMovements: [
      {
        id: "mov-1",
        timestamp: hoursAgo(5),
        reagentId: "reg-1",
        reagentName: "CellPack Hematology Diluent (20L)",
        lotNumber: "LOT-SYX-2611A",
        type: "AUTO_DEDUCT",
        quantityDelta: -15,
        balanceAfter: 18400,
        referenceId: "AEG-2083-1041",
        performedBy: "Dr. Elena Adhikari, MD",
        notes: "Automatic BOM deduction on CBC-01 validation"
      },
      {
        id: "mov-2",
        timestamp: hoursAgo(48),
        reagentId: "reg-7",
        reagentName: "Cobas Creatinine Plus & Urea Kinetic Pack",
        lotNumber: "LOT-RC-7721K",
        type: "RESTOCK",
        quantityDelta: 150,
        balanceAfter: 215,
        referenceId: "PO-2083-089",
        performedBy: "Aarati Poudel",
        notes: "Cold-chain verified delivery from Kathmandu MedSupply"
      }
    ],
    services: [
      {
        id: "srv-cbc",
        code: "CBC-01",
        name: "Complete Blood Count (Automated 6-Part Hemogram)",
        serviceCategory: "PATHOLOGY",
        customCategory: "Pathology",
        department: "Hematology",
        specimenType: "EDTA Whole Blood",
        containerType: "Lavender Top (3 mL)",
        methodology: "Hydrodynamic Focusing & Fluorescent Flow Cytometry (Sysmex XN-1000)",
        tatMinutes: 120,
        price: 650,
        active: true,
        parameters: [
          { id: "p-hb", name: "Hemoglobin (Hb)", unit: "g/dL", refMinMale: 13.5, refMaxMale: 17.5, refMinFemale: 12, refMaxFemale: 15.5, criticalLow: 7, criticalHigh: 20, decimalPlaces: 1 },
          { id: "p-wbc", name: "Total Leukocyte Count (WBC)", unit: "\xD710\xB3/\xB5L", refMinMale: 4, refMaxMale: 11, refMinFemale: 4, refMaxFemale: 11, criticalLow: 1.5, criticalHigh: 30, decimalPlaces: 2 },
          { id: "p-plt", name: "Platelet Count", unit: "\xD710\xB3/\xB5L", refMinMale: 150, refMaxMale: 450, refMinFemale: 150, refMaxFemale: 450, criticalLow: 50, criticalHigh: 1e3, decimalPlaces: 0 },
          { id: "p-rbc", name: "RBC Count", unit: "\xD710\u2076/\xB5L", refMinMale: 4.5, refMaxMale: 5.9, refMinFemale: 4.1, refMaxFemale: 5.1, decimalPlaces: 2 },
          { id: "p-hct", name: "Hematocrit (PCV)", unit: "%", refMinMale: 41, refMaxMale: 53, refMinFemale: 36, refMaxFemale: 46, decimalPlaces: 1 },
          { id: "p-mcv", name: "MCV (Mean Corpuscular Volume)", unit: "fL", refMinMale: 80, refMaxMale: 100, refMinFemale: 80, refMaxFemale: 100, decimalPlaces: 1, isCalculated: true, formula: "({p-hct} * 10) / {p-rbc}" },
          { id: "p-mch", name: "MCH", unit: "pg", refMinMale: 27, refMaxMale: 33, refMinFemale: 27, refMaxFemale: 33, decimalPlaces: 1, isCalculated: true, formula: "({p-hb} * 10) / {p-rbc}" },
          { id: "p-mchc", name: "MCHC", unit: "g/dL", refMinMale: 32, refMaxMale: 36, refMinFemale: 32, refMaxFemale: 36, decimalPlaces: 1, isCalculated: true, formula: "({p-hb} * 100) / {p-hct}" }
        ],
        reagentBom: [
          { reagentId: "reg-1", reagentName: "CellPack Hematology Diluent (20L)", quantityPerTest: 15, unit: "mL" },
          { reagentId: "reg-2", reagentName: "Stromatolyser-4DL Lytic Reagent", quantityPerTest: 2, unit: "mL" }
        ],
        interpretations: {
          normal: "Erythroid, myeloid, and megakaryocytic indices are within biological reference intervals. No peripheral cytopenia or leukocytosis detected.",
          abnormalLow: "Reduced hematological index detected (anemia, leukopenia, or thrombocytopenia). Recommend peripheral smear correlation and iron/B12 studies.",
          abnormalHigh: "Elevated cellular count noted; consider reactive leukocytosis or inflammatory thrombocytosis. Clinical correlation advised.",
          critical: "CRITICAL PANIC VALUE ALERT: Immediate physician notification required per critical call protocol.",
          methodologyNote: "Assayed on EDTA anticoagulated whole blood via fluorescent flow cytometry."
        }
      },
      {
        id: "srv-lft",
        code: "LFT-02",
        name: "Liver Function Panel (Comprehensive Hepatic Profile)",
        serviceCategory: "PATHOLOGY",
        customCategory: "Pathology",
        department: "Clinical Chemistry",
        specimenType: "Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "Photometric UV Kinetic & Diazo Colorimetry (Cobas c503)",
        tatMinutes: 240,
        price: 1200,
        active: true,
        parameters: [
          { id: "p-tbil", name: "Total Bilirubin", unit: "mg/dL", refMinMale: 0.2, refMaxMale: 1.2, refMinFemale: 0.2, refMaxFemale: 1.2, criticalHigh: 12, decimalPlaces: 2 },
          { id: "p-dbil", name: "Direct Bilirubin", unit: "mg/dL", refMinMale: 0, refMaxMale: 0.3, refMinFemale: 0, refMaxFemale: 0.3, decimalPlaces: 2 },
          { id: "p-ibil", name: "Indirect Bilirubin (Calculated)", unit: "mg/dL", refMinMale: 0.1, refMaxMale: 0.9, refMinFemale: 0.1, refMaxFemale: 0.9, decimalPlaces: 2, isCalculated: true, formula: "{p-tbil} - {p-dbil}" },
          { id: "p-ast", name: "SGOT (AST)", unit: "U/L", refMinMale: 10, refMaxMale: 40, refMinFemale: 9, refMaxFemale: 32, criticalHigh: 500, decimalPlaces: 0 },
          { id: "p-alt", name: "SGPT (ALT)", unit: "U/L", refMinMale: 10, refMaxMale: 45, refMinFemale: 7, refMaxFemale: 35, criticalHigh: 500, decimalPlaces: 0 },
          { id: "p-alp", name: "Alkaline Phosphatase (ALP)", unit: "U/L", refMinMale: 40, refMaxMale: 129, refMinFemale: 35, refMaxFemale: 104, decimalPlaces: 0 },
          { id: "p-tprot", name: "Total Protein (Serum)", unit: "g/dL", refMinMale: 6.4, refMaxMale: 8.3, refMinFemale: 6.4, refMaxFemale: 8.3, decimalPlaces: 1 },
          { id: "p-alb", name: "Albumin (Serum)", unit: "g/dL", refMinMale: 3.5, refMaxMale: 5.2, refMinFemale: 3.5, refMaxFemale: 5.2, decimalPlaces: 1 },
          { id: "p-glob", name: "Globulin (Calculated)", unit: "g/dL", refMinMale: 2, refMaxMale: 3.5, refMinFemale: 2, refMaxFemale: 3.5, decimalPlaces: 1, isCalculated: true, formula: "{p-tprot} - {p-alb}" },
          { id: "p-ag", name: "Albumin / Globulin (A:G) Ratio", unit: "ratio", refMinMale: 1, refMaxMale: 2.2, refMinFemale: 1, refMaxFemale: 2.2, decimalPlaces: 2, isCalculated: true, formula: "{p-alb} / ({p-tprot} - {p-alb})" }
        ],
        reagentBom: [
          { reagentId: "reg-3", reagentName: "Cobas Hepatic Enzyme Cassette (ALT/AST/Bili)", quantityPerTest: 1, unit: "tests" }
        ],
        interpretations: {
          normal: "Hepatocellular transaminases and biliary excretion markers lie within normal physiological limits.",
          abnormalLow: "Minimally reduced hepatic marker without clinical significance unless associated with chronic insufficiency.",
          abnormalHigh: "Elevated transaminases or bilirubin suggestive of hepatocellular injury or cholestasis. Viral serology and USG abdomen advised.",
          critical: "CRITICAL HEPATIC INJURY ALERT: Markedly elevated transaminases/hyperbilirubinemia (>10\xD7 ULN). Immediate clinician escalation required.",
          methodologyNote: "IFCC standardized UV kinetic assay at 37\xB0C."
        }
      },
      {
        id: "srv-lip",
        code: "LIP-03",
        name: "Lipid Profile (Atherogenic & Cardiovascular Risk)",
        serviceCategory: "PATHOLOGY",
        customCategory: "Pathology",
        department: "Clinical Chemistry",
        specimenType: "Fasting Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "Enzymatic Colorimetric Assay (CHOD-PAP / GPO-PAP + Friedewald Formula)",
        tatMinutes: 180,
        price: 1100,
        active: true,
        parameters: [
          { id: "p-chol", name: "Total Cholesterol", unit: "mg/dL", refMinMale: 125, refMaxMale: 200, refMinFemale: 125, refMaxFemale: 200, criticalHigh: 400, decimalPlaces: 0 },
          { id: "p-hdl", name: "HDL Cholesterol", unit: "mg/dL", refMinMale: 40, refMaxMale: 80, refMinFemale: 50, refMaxFemale: 85, decimalPlaces: 0 },
          { id: "p-tg", name: "Triglycerides", unit: "mg/dL", refMinMale: 40, refMaxMale: 150, refMinFemale: 40, refMaxFemale: 150, criticalHigh: 1e3, decimalPlaces: 0 },
          { id: "p-vldl", name: "VLDL Cholesterol (Calculated)", unit: "mg/dL", refMinMale: 5, refMaxMale: 30, refMinFemale: 5, refMaxFemale: 30, decimalPlaces: 1, isCalculated: true, formula: "{p-tg} / 5" },
          { id: "p-ldl", name: "LDL Cholesterol (Friedewald)", unit: "mg/dL", refMinMale: 50, refMaxMale: 100, refMinFemale: 50, refMaxFemale: 100, criticalHigh: 250, decimalPlaces: 1, isCalculated: true, formula: "{p-chol} - {p-hdl} - ({p-tg} / 5)" }
        ],
        reagentBom: [
          { reagentId: "reg-4", reagentName: "Cobas Lipid Enzymatic Reagent Pack", quantityPerTest: 1, unit: "tests" }
        ],
        interpretations: {
          normal: "Desirable lipid fractions with optimal Total/HDL cholesterol balance and low cardiovascular risk.",
          abnormalLow: "Suboptimal HDL cholesterol reduces cardioprotective reverse cholesterol transport. Lifestyle modification advised.",
          abnormalHigh: "Dyslipidemia noted (elevated LDL-C and/or hypertriglyceridemia). Stratify 10-year ASCVD risk and evaluate lipid-lowering therapy.",
          critical: "CRITICAL HYPERLIPIDEMIA ALERT: Severe hypertriglyceridemia (>1000 mg/dL) carries high risk of acute pancreatitis.",
          methodologyNote: "Friedewald formula applied automatically for VLDL & LDL-C."
        }
      },
      {
        id: "srv-tft",
        code: "TFT-04",
        name: "Thyroid Function Panel (TSH Ultra-Sensitive, FT3, FT4)",
        serviceCategory: "PATHOLOGY",
        customCategory: "Pathology",
        department: "Endocrinology",
        specimenType: "Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "CMIA Chemiluminescent Microparticle Immunoassay (Abbott Alinity i)",
        tatMinutes: 360,
        price: 1500,
        active: true,
        parameters: [
          { id: "p-tsh", name: "TSH (3rd Generation)", unit: "\xB5IU/mL", refMinMale: 0.35, refMaxMale: 4.94, refMinFemale: 0.35, refMaxFemale: 4.94, criticalLow: 0.01, criticalHigh: 50, decimalPlaces: 3 },
          { id: "p-ft3", name: "Free T3 (Triiodothyronine)", unit: "pg/mL", refMinMale: 1.71, refMaxMale: 3.71, refMinFemale: 1.71, refMaxFemale: 3.71, decimalPlaces: 2 },
          { id: "p-ft4", name: "Free T4 (Thyroxine)", unit: "ng/dL", refMinMale: 0.7, refMaxMale: 1.48, refMinFemale: 0.7, refMaxFemale: 1.48, criticalLow: 0.3, criticalHigh: 4.5, decimalPlaces: 2 }
        ],
        reagentBom: [
          { reagentId: "reg-5", reagentName: "Alinity Chemiluminescent Thyroid Kit (TSH/FT3/FT4)", quantityPerTest: 1, unit: "tests" }
        ],
        interpretations: {
          normal: "Euthyroid biochemical profile with intact hypothalamic-pituitary-thyroid axis feedback.",
          abnormalLow: "Suppressed TSH or low Free T4 observed. Evaluate for overt/subclinical hyperthyroidism vs central hypothyroidism.",
          abnormalHigh: "Elevated TSH or Free T4/FT3 detected. Correlate for primary hypothyroidism or thyrotoxicosis; anti-TPO antibodies advised.",
          critical: "CRITICAL ENDOCRINE ALERT: Extreme TSH/FT4 deviation consistent with myxedema coma or thyroid storm risk.",
          methodologyNote: "Third-generation two-step chemiluminescent immunoassay."
        }
      },
      {
        id: "srv-hba",
        code: "HBA-05",
        name: "HbA1c (Glycated Hemoglobin & eAG)",
        serviceCategory: "PATHOLOGY",
        customCategory: "Pathology",
        department: "Clinical Chemistry",
        specimenType: "EDTA Whole Blood",
        containerType: "Lavender Top (3 mL)",
        methodology: "Ion-Exchange HPLC (Bio-Rad D-10)",
        tatMinutes: 180,
        price: 950,
        active: true,
        parameters: [
          { id: "p-hba1c", name: "HbA1c (NGSP)", unit: "%", refMinMale: 4, refMaxMale: 5.6, refMinFemale: 4, refMaxFemale: 5.6, criticalHigh: 12, decimalPlaces: 1 },
          { id: "p-eag", name: "Estimated Average Glucose (eAG)", unit: "mg/dL", refMinMale: 68, refMaxMale: 114, refMinFemale: 68, refMaxFemale: 114, decimalPlaces: 0, isCalculated: true, formula: "(28.7 * {p-hba1c}) - 46.7" }
        ],
        reagentBom: [
          { reagentId: "reg-6", reagentName: "D-10 HPLC Elution Buffer A", quantityPerTest: 5, unit: "mL" }
        ],
        interpretations: {
          normal: "Non-diabetic glycemic control (<5.7%) over the preceding 90\u2013120 days.",
          abnormalLow: "Low HbA1c (<4.0%) may reflect recurrent hypoglycemia or shortened erythrocyte lifespan.",
          abnormalHigh: "Elevated HbA1c: 5.7\u20136.4% indicates prediabetes; \u22656.5% meets ADA diagnostic threshold for Diabetes Mellitus.",
          critical: "CRITICAL HYPERGLYCEMIA HISTORY: HbA1c >12.0% denotes severe poorly controlled diabetes.",
          methodologyNote: "NGSP-certified HPLC ion-exchange chromatography."
        }
      },
      {
        id: "srv-ren",
        code: "REN-06",
        name: "Renal Function Test (KFT & eGFR)",
        department: "Clinical Chemistry",
        specimenType: "Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "Enzymatic Creatininase & Urease GLDH UV (Cobas c503)",
        tatMinutes: 180,
        price: 950,
        active: true,
        parameters: [
          { id: "p-creat", name: "Serum Creatinine", unit: "mg/dL", refMinMale: 0.72, refMaxMale: 1.25, refMinFemale: 0.57, refMaxFemale: 1.11, criticalHigh: 5, decimalPlaces: 2 },
          { id: "p-bun", name: "Blood Urea Nitrogen (BUN)", unit: "mg/dL", refMinMale: 7, refMaxMale: 20, refMinFemale: 7, refMaxFemale: 20, criticalHigh: 80, decimalPlaces: 1 },
          { id: "p-ua", name: "Uric Acid", unit: "mg/dL", refMinMale: 3.5, refMaxMale: 7.2, refMinFemale: 2.6, refMaxFemale: 6, decimalPlaces: 1 },
          { id: "p-egfr", name: "eGFR (CKD-EPI 2021)", unit: "mL/min/1.73m\xB2", refMinMale: 90, refMaxMale: 140, refMinFemale: 90, refMaxFemale: 140, criticalLow: 15, decimalPlaces: 0 }
        ],
        reagentBom: [
          { reagentId: "reg-7", reagentName: "Cobas Creatinine Plus & Urea Kinetic Pack", quantityPerTest: 1, unit: "tests" }
        ],
        interpretations: {
          normal: "Preserved glomerular filtration rate and normal nitrogenous waste clearance.",
          abnormalLow: "Reduced eGFR (<90 mL/min/1.73m\xB2). Evaluate hydration status and uACR for CKD staging.",
          abnormalHigh: "Azotemia / elevated creatinine or hyperuricemia. Differentiate prerenal dehydration from intrinsic renal impairment.",
          critical: "CRITICAL RENAL DYSFUNCTION ALERT: Markedly elevated creatinine (>5.0 mg/dL) or eGFR <15.",
          methodologyNote: "IDMS-traceable enzymatic creatinine assay."
        }
      },
      {
        id: "srv-fbs",
        code: "FBS-07",
        name: "Fasting Blood Glucose (Plasma)",
        department: "Clinical Chemistry",
        specimenType: "Fluoride Plasma",
        containerType: "Grey Top (2 mL)",
        methodology: "Hexokinase UV Enzymatic Assay",
        tatMinutes: 90,
        price: 250,
        active: true,
        parameters: [
          { id: "p-fbs", name: "Glucose (Fasting)", unit: "mg/dL", refMinMale: 70, refMaxMale: 99, refMinFemale: 70, refMaxFemale: 99, criticalLow: 45, criticalHigh: 450, decimalPlaces: 0 }
        ],
        reagentBom: [],
        interpretations: {
          normal: "Normoglycemic fasting plasma glucose (<100 mg/dL).",
          abnormalLow: "Fasting hypoglycemia (<70 mg/dL). Correlate with insulinoma workup or antihyperglycemic dosing.",
          abnormalHigh: "100\u2013125 mg/dL indicates Impaired Fasting Glucose; \u2265126 mg/dL on two occasions supports Diabetes Mellitus.",
          critical: "CRITICAL GLYCEMIC ALERT: Severe hypoglycemia (<45 mg/dL) or hyperglycemic crisis (>450 mg/dL). Immediate intervention required.",
          methodologyNote: "Hexokinase G-6-PDH reference enzymatic method on NaF/K-oxalate plasma."
        }
      },
      {
        id: "srv-crp",
        code: "CRP-08",
        name: "C-Reactive Protein (Quantitative hs-CRP)",
        department: "Immunology",
        specimenType: "Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "Particle-Enhanced Immunoturbidimetric Assay",
        tatMinutes: 150,
        price: 750,
        active: true,
        parameters: [
          { id: "p-crp", name: "C-Reactive Protein (CRP)", unit: "mg/L", refMinMale: 0, refMaxMale: 5, refMinFemale: 0, refMaxFemale: 5, criticalHigh: 150, decimalPlaces: 2 }
        ],
        reagentBom: [],
        interpretations: {
          normal: "No acute systemic inflammatory response detected (<5.0 mg/L).",
          abnormalLow: "Within physiological baseline.",
          abnormalHigh: "Elevated CRP indicates active acute-phase inflammation, bacterial infection, or tissue injury. Correlate with CBC and procalcitonin.",
          critical: "CRITICAL INFLAMMATION ALERT: Markedly elevated CRP (>150 mg/L) suggestive of severe sepsis or systemic inflammatory syndrome.",
          methodologyNote: "Latex-enhanced immunoturbidimetry standardized against CRM 470."
        }
      },
      {
        id: "srv-vitd",
        code: "VITD-09",
        name: "25-Hydroxy Vitamin D (Total)",
        department: "Endocrinology",
        specimenType: "Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "Chemiluminescent Immunoassay (CLIA)",
        tatMinutes: 300,
        price: 1850,
        active: true,
        parameters: [
          { id: "p-vitd", name: "25-OH Vitamin D", unit: "ng/mL", refMinMale: 30, refMaxMale: 100, refMinFemale: 30, refMaxFemale: 100, criticalLow: 8, criticalHigh: 150, decimalPlaces: 1 }
        ],
        reagentBom: [],
        interpretations: {
          normal: "Vitamin D sufficiency (30\u2013100 ng/mL) supporting optimal calcium homeostasis and bone mineralization.",
          abnormalLow: "Vitamin D deficiency (<20 ng/mL) or insufficiency (20\u201329 ng/mL). Cholecalciferol supplementation and serum calcium/PTH review advised.",
          abnormalHigh: "Elevated 25-OH Vitamin D (>100 ng/mL); evaluate for hypervitaminosis D and monitor serum calcium.",
          critical: "CRITICAL VITAMIN D TOXICITY / SEVERE DEFICIENCY: Immediate endocrinology & bone metabolism review advised.",
          methodologyNote: "Competitive chemiluminescent immunoassay measuring D2 + D3."
        }
      },
      {
        id: "srv-urine",
        code: "URI-10",
        name: "Urine Routine & Microscopic Examination (Urine R/E)",
        department: "Microbiology",
        specimenType: "Mid-Stream Clean Catch Urine",
        containerType: "Sterile Urine Container (30 mL)",
        methodology: "Automated Reflectance Photometry & Brightfield Microscopy",
        tatMinutes: 90,
        price: 300,
        active: true,
        parameters: [
          {
            id: "p-uapp",
            name: "Appearance / Clarity",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Clear", "Slightly Turbid", "Turbid"],
            normalQualitativeValues: ["Clear"]
          },
          {
            id: "p-ualb",
            name: "Urine Albumin (Protein)",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Absent", "Trace", "+1", "+2", "+3", "+4"],
            normalQualitativeValues: ["Absent"],
            criticalQualitativeValues: ["+4"]
          },
          {
            id: "p-usug",
            name: "Urine Glucose (Sugar)",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Absent", "Trace", "+1", "+2", "+3", "+4"],
            normalQualitativeValues: ["Absent"],
            criticalQualitativeValues: ["+4"]
          },
          {
            id: "p-uket",
            name: "Ketone Bodies",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Absent", "Present"],
            normalQualitativeValues: ["Absent"]
          },
          {
            id: "p-unit",
            name: "Nitrite",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Negative", "Positive"],
            normalQualitativeValues: ["Negative"]
          },
          { id: "p-uph", name: "Urine pH", resultType: "NUMERIC", unit: "pH", refMinMale: 4.5, refMaxMale: 8, refMinFemale: 4.5, refMaxFemale: 8, decimalPlaces: 1 },
          { id: "p-usg", name: "Specific Gravity", resultType: "NUMERIC", unit: "SG", refMinMale: 1.005, refMaxMale: 1.03, refMinFemale: 1.005, refMaxFemale: 1.03, decimalPlaces: 3 },
          { id: "p-upus", name: "Pus Cells (Leukocytes / HPF)", resultType: "NUMERIC", unit: "/HPF", refMinMale: 0, refMaxMale: 5, refMinFemale: 0, refMaxFemale: 5, criticalHigh: 50, decimalPlaces: 0 },
          { id: "p-urbc", name: "RBCs (/HPF)", resultType: "NUMERIC", unit: "/HPF", refMinMale: 0, refMaxMale: 2, refMinFemale: 0, refMaxFemale: 2, criticalHigh: 30, decimalPlaces: 0 }
        ],
        reagentBom: [],
        interpretations: {
          normal: "Physicochemical, dipstick qualitative analytes, and microscopic sediment parameters are within normal reference limits.",
          abnormalLow: "Hyposthenuria / low specific gravity; correlate with hydration or renal concentrating ability.",
          abnormalHigh: "Abnormal dipstick finding (proteinuria, glycosuria, ketonuria, or positive nitrite) or pyuria/hematuria detected. Correlate clinically and consider urine C/S.",
          critical: "CRITICAL URINALYSIS FINDING: Marked proteinuria/glycosuria (+4) or gross pyuria/hematuria requiring urgent clinical review.",
          methodologyNote: "10-parameter dipstick reflectance photometry confirmed by centrifuged sediment microscopy at 400\xD7."
        }
      },
      {
        id: "srv-serology",
        code: "SER-11",
        name: "Infectious Serology Viral & Screening Panel (HBsAg, HCV, HIV, VDRL)",
        department: "Immunology",
        specimenType: "Serum",
        containerType: "SST Gold Top (5 mL)",
        methodology: "Rapid Immunochromatographic Assay (ICT) & ELISA Confirmation",
        tatMinutes: 120,
        price: 1650,
        active: true,
        parameters: [
          {
            id: "p-hbsag",
            name: "HBsAg (Hepatitis B Surface Antigen)",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Negative", "Positive"],
            normalQualitativeValues: ["Negative"],
            criticalQualitativeValues: ["Positive"]
          },
          {
            id: "p-hcv",
            name: "Anti-HCV Antibody",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Non-Reactive", "Reactive"],
            normalQualitativeValues: ["Non-Reactive"],
            criticalQualitativeValues: ["Reactive"]
          },
          {
            id: "p-hiv",
            name: "HIV I & II Antibody",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Non-Reactive", "Reactive"],
            normalQualitativeValues: ["Non-Reactive"],
            criticalQualitativeValues: ["Reactive"]
          },
          {
            id: "p-vdrl",
            name: "VDRL / RPR (Syphilis Screen)",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Non-Reactive", "Reactive"],
            normalQualitativeValues: ["Non-Reactive"]
          }
        ],
        reagentBom: [],
        interpretations: {
          normal: "All infectious serology markers (HBsAg, Anti-HCV, HIV I & II, VDRL) are Non-Reactive / Negative.",
          abnormalLow: "Non-reactive baseline.",
          abnormalHigh: "Reactive screening result detected. Recommend confirmatory Western Blot / PCR viral load testing.",
          critical: "CRITICAL REACTIVE SEROLOGY: Confidential physician notification and confirmatory reflex testing protocol initiated.",
          methodologyNote: "4th generation lateral-flow ICT verified against internal positive/negative QC controls."
        }
      },
      {
        id: "srv-upt",
        code: "UPT-12",
        name: "Qualitative Screening (Urine \u03B2-hCG Pregnancy & Stool Occult Blood)",
        department: "Microbiology",
        specimenType: "Urine / Stool",
        containerType: "Sterile Container",
        methodology: "Monoclonal Antibody Sandwich Lateral Flow Assay",
        tatMinutes: 60,
        price: 400,
        active: true,
        parameters: [
          {
            id: "p-hcg",
            name: "Urine Pregnancy Test (\u03B2-hCG)",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["Negative", "Positive"],
            normalQualitativeValues: ["Negative"]
          },
          {
            id: "p-fob",
            name: "Occult Blood Present",
            resultType: "QUALITATIVE",
            unit: "-",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0,
            qualitativeOptions: ["No", "Yes"],
            normalQualitativeValues: ["No"]
          }
        ],
        reagentBom: [],
        interpretations: {
          normal: "Qualitative screening negative / within expected baseline.",
          abnormalLow: "Negative screening result.",
          abnormalHigh: "Positive qualitative screening result noted. Correlate with clinical history and quantitative serum follow-up if indicated.",
          critical: "Urgent clinical correlation advised.",
          methodologyNote: "Rapid qualitative chromatographic immunoassay (sensitivity 25 mIU/mL hCG)."
        }
      },
      {
        id: "srv-cxr",
        code: "XRAY-CHEST",
        name: "Digital X-Ray Chest (PA View)",
        serviceCategory: "RADIOLOGY",
        modality: "X-RAY",
        defaultRadiologyTemplateId: "radtpl-cxr",
        department: "Radiology",
        specimenType: "Radiograph (PA View)",
        containerType: "14\xD717 Laser Film / PACS",
        methodology: "Direct Digital Radiography (DR System)",
        tatMinutes: 45,
        price: 700,
        active: true,
        parameters: [],
        reagentBom: [
          { reagentId: "reg-9", reagentName: "Fujifilm DryPix Medical Laser X-Ray Film (14\xD717 inch)", quantityPerTest: 1, unit: "films" }
        ],
        interpretations: {
          normal: "Normal chest radiograph; clear lung fields and normal cardiomediastinal silhouette.",
          abnormalLow: "Suboptimal inspiratory effort.",
          abnormalHigh: "Focal parenchymal, pleural, or cardiomediastinal abnormality noted.",
          critical: "CRITICAL IMAGING FINDING: Pneumothorax, massive effusion, or tension pathology \u2014 immediate clinician alert.",
          methodologyNote: "Reported using structured Radiology Template TPL-CXR-PA."
        }
      },
      {
        id: "srv-kub",
        code: "XRAY-KUB",
        name: "Digital X-Ray KUB (Abdomen / Urinary Tract)",
        serviceCategory: "RADIOLOGY",
        modality: "X-RAY",
        defaultRadiologyTemplateId: "radtpl-kub",
        department: "Radiology",
        specimenType: "Supine AP Radiograph",
        containerType: "14\xD717 Laser Film / PACS",
        methodology: "Direct Digital Radiography (DR System)",
        tatMinutes: 45,
        price: 750,
        active: true,
        parameters: [],
        reagentBom: [
          { reagentId: "reg-9", reagentName: "Fujifilm DryPix Medical Laser X-Ray Film (14\xD717 inch)", quantityPerTest: 1, unit: "films" }
        ],
        interpretations: {
          normal: "No radio-opaque calculus along KUB tract.",
          abnormalLow: "Unremarkable film.",
          abnormalHigh: "Radio-opaque calculus or abnormal bowel gas pattern identified.",
          critical: "CRITICAL FINDING: Free intraperitoneal air or acute bowel obstruction.",
          methodologyNote: "Reported using structured Radiology Template TPL-XRAY-KUB."
        }
      },
      {
        id: "srv-ctbrain",
        code: "CT-BRAIN",
        name: "CT Scan Head / Brain (Plain Multi-Slice)",
        serviceCategory: "RADIOLOGY",
        modality: "CT",
        defaultRadiologyTemplateId: "radtpl-ctbrain",
        department: "Radiology",
        specimenType: "64-Slice Axial CT Volume",
        containerType: "10\xD712 Film Set (2 Films) + DICOM",
        methodology: "64-Slice Helical Computed Tomography",
        tatMinutes: 90,
        price: 3800,
        active: true,
        parameters: [],
        reagentBom: [
          { reagentId: "reg-10", reagentName: "Carestream DryView Imaging Film (10\xD712 inch)", quantityPerTest: 2, unit: "films" }
        ],
        interpretations: {
          normal: "Normal NCCT Brain study.",
          abnormalLow: "Chronic microvascular changes.",
          abnormalHigh: "Focal parenchymal or extra-axial CT abnormality.",
          critical: "CRITICAL CT ALERT: Acute intracranial bleed, herniation, or acute territorial infarct.",
          methodologyNote: "Reported using structured Radiology Template TPL-CT-BRAIN."
        }
      },
      {
        id: "srv-usgabd",
        code: "USG-ABD",
        name: "Ultrasound Whole Abdomen & Pelvis (USG)",
        serviceCategory: "RADIOLOGY",
        modality: "USG",
        defaultRadiologyTemplateId: "radtpl-usg",
        department: "Radiology",
        specimenType: "Real-Time Sonography",
        containerType: "Thermal Print + A4 Report",
        methodology: "High-Resolution B-Mode & Color Doppler Sonography",
        tatMinutes: 40,
        price: 1400,
        active: true,
        parameters: [],
        reagentBom: [
          { reagentId: "reg-12", reagentName: "Aquasonic Ultrasound & Echo Acoustic Coupling Gel (5L)", quantityPerTest: 25, unit: "mL" },
          { reagentId: "reg-13", reagentName: "Sony UPP-110HD USG & 2D Echo Thermal Print Roll", quantityPerTest: 0.2, unit: "rolls" }
        ],
        interpretations: {
          normal: "Normal whole abdomen & pelvis ultrasound.",
          abnormalLow: "Suboptimal bowel gas window.",
          abnormalHigh: "Organomegaly, steatosis, calculi, or free fluid detected.",
          critical: "CRITICAL USG ALERT: Ectopic pregnancy, ruptured viscus, or acute aortic pathology.",
          methodologyNote: "Reported using structured Radiology Template TPL-USG-ABD."
        }
      },
      {
        id: "srv-echo2d",
        code: "ECHO-2D",
        name: "2D Echocardiography with Color Doppler",
        serviceCategory: "RADIOLOGY",
        modality: "ECHO",
        defaultRadiologyTemplateId: "radtpl-echo",
        department: "Radiology",
        specimenType: "Transthoracic Doppler Study",
        containerType: "Thermal Print + A4 Report",
        methodology: "2D, M-Mode & Color Flow Doppler Echocardiography",
        tatMinutes: 60,
        price: 2200,
        active: true,
        parameters: [],
        reagentBom: [
          { reagentId: "reg-12", reagentName: "Aquasonic Ultrasound & Echo Acoustic Coupling Gel (5L)", quantityPerTest: 20, unit: "mL" },
          { reagentId: "reg-13", reagentName: "Sony UPP-110HD USG & 2D Echo Thermal Print Roll", quantityPerTest: 0.2, unit: "rolls" }
        ],
        interpretations: {
          normal: "Normal 2D Echocardiography with preserved LV systolic function.",
          abnormalLow: "Reduced LVEF (<50%).",
          abnormalHigh: "Chamber enlargement, valvular regurgitation, or pulmonary hypertension.",
          critical: "CRITICAL ECHO ALERT: Cardiac tamponade, severe acute LV dysfunction, or intracardiac thrombus.",
          methodologyNote: "Reported using structured Radiology Template TPL-ECHO-2D."
        }
      },
      {
        id: "srv-cons-gen",
        code: "CONS-GEN",
        name: "General OPD Doctor Consultation Fee",
        serviceCategory: "CONSULTATION",
        customCategory: "Consultation",
        department: "OPD Consultation",
        specimenType: "Clinical Visit",
        containerType: "OPD Ticket",
        methodology: "Outpatient Clinical Evaluation",
        tatMinutes: 20,
        price: 500,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Consultation completed.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "OPD medical evaluation."
        }
      },
      {
        id: "srv-cons-spec",
        code: "CONS-SPEC",
        name: "Specialist MD Consultation Fee",
        serviceCategory: "CONSULTATION",
        customCategory: "Consultation",
        department: "OPD Consultation",
        specimenType: "Clinical Visit",
        containerType: "OPD Ticket",
        methodology: "Specialist Consultant Review",
        tatMinutes: 25,
        price: 800,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Specialist consultation completed.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Specialist outpatient evaluation."
        }
      },
      {
        id: "srv-cons-fu",
        code: "CONS-FU",
        name: "Post-Window Follow-Up Consultation Fee",
        serviceCategory: "CONSULTATION",
        customCategory: "Consultation",
        department: "OPD Consultation",
        specimenType: "Follow-Up Visit",
        containerType: "OPD Ticket",
        methodology: "Follow-Up Review After Free Window",
        tatMinutes: 15,
        price: 300,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Follow-up consultation completed.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Post-expiry follow-up charge."
        }
      },
      {
        id: "srv-pop-short",
        code: "PROC-POP-SHORT",
        name: "POP / Plaster Cast Application (Short Arm / Below Knee \u2014 Rate by Doctor)",
        serviceCategory: "HOSPITAL_PROCEDURE",
        customCategory: "Plaster & Ortho",
        allowCustomRateAtBilling: true,
        department: "Orthopedics & Plaster",
        specimenType: "Orthopedic Procedure",
        containerType: "Gypsona / POP Roll",
        methodology: "Closed Reduction & POP Immobilization",
        tatMinutes: 45,
        price: 1800,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "POP cast applied per orthopedic doctor fee schedule.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Doctor sets final POP rate at billing if modified."
        }
      },
      {
        id: "srv-pop-long",
        code: "PROC-POP-LONG",
        name: "POP / Plaster Cast Application (Full Limb / Slab \u2014 Rate by Doctor)",
        serviceCategory: "HOSPITAL_PROCEDURE",
        customCategory: "Plaster & Ortho",
        allowCustomRateAtBilling: true,
        department: "Orthopedics & Plaster",
        specimenType: "Orthopedic Procedure",
        containerType: "Gypsona / POP Roll Set",
        methodology: "Full Limb POP Cast / Slab Stabilization",
        tatMinutes: 60,
        price: 3200,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Full-limb POP cast applied.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Doctor sets custom POP fee before billing/print."
        }
      },
      {
        id: "srv-proc-suture",
        code: "PROC-SUTURE",
        name: "Minor Wound Suturing & Debridement (Doctor Rate)",
        serviceCategory: "HOSPITAL_PROCEDURE",
        customCategory: "Procedures",
        allowCustomRateAtBilling: true,
        department: "Surgery / Minor OT",
        specimenType: "Surgical Procedure",
        containerType: "Sterile Suture Pack",
        methodology: "Aseptic Wound Exploration & Closure",
        tatMinutes: 35,
        price: 900,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Wound closed aseptically.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Minor OT procedure fee editable per complexity."
        }
      },
      {
        id: "srv-proc-dress",
        code: "PROC-DRESS",
        name: "Surgical Wound Dressing & Antiseptic Care",
        serviceCategory: "HOSPITAL_PROCEDURE",
        customCategory: "Procedures",
        department: "Nursing Procedure",
        specimenType: "Dressing Room",
        containerType: "Sterile Dressing Pack",
        methodology: "Aseptic Dressing",
        tatMinutes: 20,
        price: 400,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Dressing completed.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Standard sterile dressing."
        }
      },
      {
        id: "srv-proc-neb",
        code: "PROC-NEB",
        name: "Nebulization & Oxygen Therapy Session",
        serviceCategory: "EMERGENCY",
        customCategory: "Emergency / Casualty",
        department: "Emergency & Observation",
        specimenType: "ER Procedure",
        containerType: "Nebulizer Mask",
        methodology: "Bronchodilator Inhalation Session",
        tatMinutes: 20,
        price: 250,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "Nebulization session completed.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Emergency / OPD nebulization."
        }
      },
      {
        id: "srv-diag-ecg",
        code: "DIAG-ECG",
        name: "12-Lead Digital ECG (Electrocardiogram)",
        serviceCategory: "DIAGNOSTICS",
        customCategory: "Diagnostics",
        department: "Cardiology / Diagnostics",
        specimenType: "12-Lead Tracing",
        containerType: "Thermal ECG Strip",
        methodology: "Digital 12-Lead Resting ECG",
        tatMinutes: 15,
        price: 500,
        active: true,
        parameters: [],
        reagentBom: [],
        interpretations: {
          normal: "12-Lead ECG acquired.",
          abnormalLow: "",
          abnormalHigh: "",
          critical: "",
          methodologyNote: "Standard 25 mm/s ECG strip."
        }
      }
    ],
    centers: [],
    centerAwards: [],
    referrals: [
      {
        id: "ref-1",
        code: "REF-DR-101",
        name: "Dr. Prakash Regmi, MD (Internal Medicine)",
        type: "Physician",
        phone: "+977-9851109921",
        address: "Bode Barsain / Rajbiraj Road, Saptari",
        defaultMode: "PERCENT",
        defaultValue: 15,
        testOverrides: [
          { serviceId: "srv-tft", serviceCode: "TFT-04", mode: "FLAT", value: 300 },
          { serviceId: "srv-vitd", serviceCode: "VITD-09", mode: "PERCENT", value: 20 }
        ],
        bankName: "Nabil Bank Ltd.",
        bankBranch: "Rajbiraj Branch, Saptari",
        accountHolderName: "Prakash Regmi",
        accountNumber: "01401017504421",
        walletId: "9851109921 (eSewa)",
        panNumber: "302918442",
        totalReferredSales: 84500,
        totalCommissionEarned: 13200,
        totalCommissionPaid: 8e3,
        active: true
      },
      {
        id: "ref-2",
        code: "REF-CL-204",
        name: "Bode Barsain Community Polyclinic",
        type: "Polyclinic",
        phone: "+977-9801498821",
        address: "Bode Barsain-04, Saptari",
        defaultMode: "FLAT",
        defaultValue: 150,
        testOverrides: [
          { serviceId: "srv-lft", serviceCode: "LFT-02", mode: "PERCENT", value: 18 }
        ],
        bankName: "NIC Asia Bank Ltd.",
        bankBranch: "Bode Barsain Branch, Saptari",
        accountHolderName: "Bode Barsain Community Polyclinic",
        accountNumber: "0844150229910",
        walletId: "9801498821 (Khalti)",
        panNumber: "605112980",
        totalReferredSales: 52e3,
        totalCommissionEarned: 7850,
        totalCommissionPaid: 5e3,
        active: true
      },
      {
        id: "ref-3",
        code: "REF-DR-309",
        name: "Dr. Sunita Basnet, MD (OBG / Endocrinology)",
        type: "Physician",
        phone: "+977-9841990331",
        address: "Kalyanpur / Bode Barsain, Saptari",
        defaultMode: "PERCENT",
        defaultValue: 12,
        testOverrides: [],
        bankName: "Global IME Bank Ltd.",
        bankBranch: "Bode Barsain, Saptari",
        accountHolderName: "Sunita Basnet",
        accountNumber: "11207010004921",
        walletId: "9841990331 (eSewa)",
        panNumber: "304491021",
        totalReferredSales: 38200,
        totalCommissionEarned: 4584,
        totalCommissionPaid: 0,
        active: true
      }
    ],
    referralPayoutRequests: [
      {
        id: "rpay-1",
        requestNumber: "RPR-2083-001",
        requestedAt: hoursAgo(3),
        fiscalYear: activeFy,
        partnerId: "ref-1",
        partnerName: "Dr. Prakash Regmi, MD (Internal Medicine)",
        partnerCode: "REF-DR-101",
        amountNpr: 5200,
        targetAccountId: "acc-nabil",
        destinationSummary: "Nabil Bank Ltd. (Rajbiraj) A/C 01401017504421 \xB7 Prakash Regmi",
        destinationBankName: "Nabil Bank Ltd.",
        destinationBranch: "Rajbiraj Branch, Saptari",
        destinationAccountHolder: "Prakash Regmi",
        destinationAccountNumber: "01401017504421",
        destinationWalletId: "9851109921 (eSewa)",
        paymentMethod: "Bank Transfer / ConnectIPS",
        paymentRefOrReceipt: "CIPS-TXN-8841209",
        notes: "Payment transfer initiated via ConnectIPS; awaiting Admin verification & ledger approval.",
        requestedBy: "Aarati Poudel",
        status: "Pending Admin Approval"
      },
      {
        id: "rpay-0",
        requestNumber: "RPR-2083-000",
        requestedAt: hoursAgo(70),
        fiscalYear: activeFy,
        partnerId: "ref-2",
        partnerName: "Bode Barsain Community Polyclinic",
        partnerCode: "REF-CL-204",
        amountNpr: 5e3,
        targetAccountId: "acc-nabil",
        destinationSummary: "NIC Asia Bank Ltd. (Bode Barsain) A/C 0844150229910 \xB7 Bode Barsain Community Polyclinic",
        destinationBankName: "NIC Asia Bank Ltd.",
        destinationBranch: "Bode Barsain Branch, Saptari",
        destinationAccountHolder: "Bode Barsain Community Polyclinic",
        destinationAccountNumber: "0844150229910",
        destinationWalletId: "9801498821 (Khalti)",
        paymentMethod: "Bank Transfer / ConnectIPS",
        paymentRefOrReceipt: "NABIL-IPS-77310",
        notes: "Settled commission payout for Kartik cycle.",
        requestedBy: "Aarati Poudel",
        status: "Approved & Paid",
        reviewedBy: "Dr. Santosh Majhi (Hospital Admin)",
        reviewedAt: hoursAgo(68),
        approvalRemarks: "Verified UTR #NABIL-IPS-77310 and approved."
      }
    ],
    accounts: [
      {
        id: "acc-cash",
        code: "HSP-CASH-01",
        name: "Hospital Main Cash Counter",
        type: "CASH_COUNTER",
        departmentScope: "HOSPITAL",
        currentBalance: 48500,
        isDefaultPosCash: true
      },
      {
        id: "acc-petty",
        code: "HSP-PETTY-02",
        name: "Hospital Petty Cash Drawer",
        type: "CASH_COUNTER",
        departmentScope: "HOSPITAL",
        currentBalance: 12e3
      },
      {
        id: "acc-nabil",
        code: "HSP-BANK-01",
        name: "Hospital Bank / QR \u2014 Nabil Bank Current A/C",
        type: "BANK",
        departmentScope: "HOSPITAL",
        bankName: "Nabil Bank Ltd.",
        accountNumber: "0110017509921",
        branch: "Bode Barsain / Rajbiraj",
        currentBalance: 1845e3,
        isDefaultPosBank: true
      },
      {
        id: "acc-phm-cash",
        code: "PHM-CASH-01",
        name: "Pharmacy Separate Cash Counter",
        type: "CASH_COUNTER",
        departmentScope: "PHARMACY",
        currentBalance: 26400
      },
      {
        id: "acc-phm-bank",
        code: "PHM-BANK-01",
        name: "Pharmacy Bank / QR \u2014 NIC Asia Settlement A/C",
        type: "BANK",
        departmentScope: "PHARMACY",
        bankName: "NIC Asia Bank Ltd.",
        accountNumber: "0444150228810",
        branch: "Bode Barsain, Saptari",
        currentBalance: 692e3
      }
    ],
    financialLedger: [
      {
        id: "fin-1",
        timestamp: hoursAgo(72),
        fiscalYear: activeFy,
        accountId: "acc-nabil",
        accountName: "Nabil Bank Ltd. \u2014 Operating Current A/C",
        category: "CENTER_SETTLEMENT",
        direction: "INFLOW",
        amount: 8e4,
        balanceAfter: 1845e3,
        referenceId: "NABIL-IPS-88412",
        description: "Collection center settlement from Patan Lagankhel Hub",
        recordedBy: "Suman Gurung"
      },
      {
        id: "fin-2",
        timestamp: hoursAgo(24),
        fiscalYear: activeFy,
        accountId: "acc-cash",
        accountName: "Main Lab Cash Counter Vault",
        category: "POS_COLLECTION",
        direction: "INFLOW",
        amount: 14500,
        balanceAfter: 48500,
        referenceId: "POS-SHIFT-MORNING",
        description: "Walk-in POS diagnostic collections",
        recordedBy: "Suman Gurung"
      },
      {
        id: "fin-3",
        timestamp: hoursAgo(12),
        fiscalYear: activeFy,
        accountId: "acc-petty",
        accountName: "Petty Cash Drawer",
        category: "EXPENSE",
        direction: "OUTFLOW",
        amount: 2400,
        balanceAfter: 12e3,
        referenceId: "VCH-2083-014",
        description: "Dry ice & sample transport cooler consumables",
        recordedBy: "Aarati Poudel"
      }
    ],
    financeApprovalRequests: [
      {
        id: "fap-1",
        requestNumber: "FAP-2083-001",
        fiscalYear: activeFy,
        createdAt: hoursAgo(4),
        updatedAt: hoursAgo(4),
        transactionType: "EXPENSE",
        direction: "OUT",
        amountNpr: 4800,
        accountId: "acc-petty",
        accountName: "Petty Cash Drawer",
        referenceId: "VCH-ER-041",
        reason: "ER Oxygen Cylinder Refill (2 Jumbo B-Type)",
        description: "Emergency ward jumbo oxygen cylinder refill from Rajbiraj Oxygen Plant",
        payeeOrParty: "Sagarmatha Medical Gas Traders",
        requesterId: "staff-4",
        requesterName: "Suman Gurung",
        requesterRole: "CENTER_MANAGER",
        status: "PENDING_MANAGER",
        reRequestCount: 0,
        history: [
          {
            id: "faph-101",
            timestamp: hoursAgo(4),
            action: "REQUESTED",
            actorId: "staff-4",
            actorName: "Suman Gurung",
            actorRole: "CENTER_MANAGER",
            note: "Submitted ER oxygen cylinder refill voucher for Manager + Admin verification.",
            statusAfter: "PENDING_MANAGER"
          }
        ]
      },
      {
        id: "fap-2",
        requestNumber: "FAP-2083-002",
        fiscalYear: activeFy,
        createdAt: hoursAgo(3),
        updatedAt: hoursAgo(3),
        transactionType: "RECEIPT",
        direction: "IN",
        amountNpr: 3500,
        accountId: "acc-cash",
        accountName: "Main Lab Cash Counter Vault",
        referenceId: "RCP-AMB-019",
        reason: "Hospital Ambulance Trip Receipt (Bode Barsain -> Rajbiraj)",
        description: "Inflow receipt collected from patient family for emergency ambulance transfer",
        payeeOrParty: "Mr. Dipendra Mandal",
        requesterId: "staff-phm-cashier",
        requesterName: "Bikash Yadav (Pharmacy Cashier)",
        requesterRole: "PHARMACY_CASHIER",
        status: "PENDING_MANAGER",
        reRequestCount: 0,
        history: [
          {
            id: "faph-201",
            timestamp: hoursAgo(3),
            action: "REQUESTED",
            actorId: "staff-phm-cashier",
            actorName: "Bikash Yadav (Pharmacy Cashier)",
            actorRole: "PHARMACY_CASHIER",
            note: "Ambulance cash receipt awaiting Tier-1 Manager review.",
            statusAfter: "PENDING_MANAGER"
          }
        ]
      },
      {
        id: "fap-3",
        requestNumber: "FAP-2083-003",
        fiscalYear: activeFy,
        createdAt: hoursAgo(6),
        updatedAt: hoursAgo(2),
        transactionType: "PAYMENT",
        direction: "OUT",
        amountNpr: 12500,
        accountId: "acc-nabil",
        accountName: "Nabil Bank Ltd. \u2014 Operating Current A/C",
        referenceId: "PAY-GEN-088",
        reason: "25 KVA Backup Generator Diesel Fuel Supply",
        description: "400L high-speed diesel bill for uninterrupted ICU & Lab power backup",
        payeeOrParty: "Bode Barsain Fuel Center",
        requesterId: "staff-4",
        requesterName: "Suman Gurung",
        requesterRole: "CENTER_MANAGER",
        status: "PENDING_ADMIN",
        managerReviewedBy: "Aarati Poudel",
        managerReviewedAt: hoursAgo(2),
        reRequestCount: 0,
        history: [
          {
            id: "faph-301",
            timestamp: hoursAgo(6),
            action: "REQUESTED",
            actorId: "staff-4",
            actorName: "Suman Gurung",
            actorRole: "CENTER_MANAGER",
            note: "Submitted generator diesel bill (Bill #4412).",
            statusAfter: "PENDING_MANAGER"
          },
          {
            id: "faph-302",
            timestamp: hoursAgo(2),
            action: "APPROVED_BY_MANAGER",
            actorId: "staff-5",
            actorName: "Aarati Poudel",
            actorRole: "INVENTORY_HR",
            note: "Fuel meter log & VAT bill verified. Forwarded to Hospital Admin.",
            statusAfter: "PENDING_ADMIN"
          }
        ]
      },
      {
        id: "fap-4",
        requestNumber: "FAP-2083-004",
        fiscalYear: activeFy,
        createdAt: hoursAgo(5),
        updatedAt: hoursAgo(1.5),
        transactionType: "BANK_DEPOSIT",
        direction: "OUT",
        amountNpr: 25e3,
        accountId: "acc-cash",
        accountName: "Main Lab Cash Counter Vault",
        targetAccountId: "acc-nabil",
        targetAccountName: "Nabil Bank Ltd. \u2014 Operating Current A/C",
        referenceId: "DEP-2083-012",
        reason: "Evening Shift Cash Vault Transfer to Nabil Bank",
        description: "Cash deposit slip #884120 to Operating Current A/C",
        payeeOrParty: "Nabil Bank Bode Barsain Deposit",
        requesterId: "staff-phm-1",
        requesterName: "Anjali Koirala, B.Pharm",
        requesterRole: "PHARMACIST",
        status: "PENDING_ADMIN",
        managerReviewedBy: "Aarati Poudel",
        managerReviewedAt: hoursAgo(1.5),
        reRequestCount: 0,
        history: [
          {
            id: "faph-401",
            timestamp: hoursAgo(5),
            action: "REQUESTED",
            actorId: "staff-phm-1",
            actorName: "Anjali Koirala, B.Pharm",
            actorRole: "PHARMACIST",
            note: "Cash-to-bank deposit slip requested for vault transfer.",
            statusAfter: "PENDING_MANAGER"
          },
          {
            id: "faph-402",
            timestamp: hoursAgo(1.5),
            action: "APPROVED_BY_MANAGER",
            actorId: "staff-5",
            actorName: "Aarati Poudel",
            actorRole: "INVENTORY_HR",
            note: "Denomination count matched. Sent to Admin for final posting.",
            statusAfter: "PENDING_ADMIN"
          }
        ]
      },
      {
        id: "fap-5",
        requestNumber: "FAP-2083-005",
        fiscalYear: activeFy,
        createdAt: hoursAgo(10),
        updatedAt: hoursAgo(7),
        transactionType: "EXPENSE",
        direction: "OUT",
        amountNpr: 6200,
        accountId: "acc-petty",
        accountName: "Petty Cash Drawer",
        referenceId: "VCH-2083-009",
        reason: "Ward Linen & Surgical Gown Tailoring",
        description: "Stitching charges for 20 OT & ER patient gowns (needs itemized VAT bill)",
        payeeOrParty: "Maithili Tailors & Textiles",
        requesterId: "staff-4",
        requesterName: "Suman Gurung",
        requesterRole: "CENTER_MANAGER",
        status: "DECLINED",
        managerReviewedBy: "Aarati Poudel",
        managerReviewedAt: hoursAgo(7),
        declineReason: "Missing itemized vendor receipt number \u2014 attach VAT bill no. & re-request.",
        reRequestCount: 0,
        history: [
          {
            id: "faph-501",
            timestamp: hoursAgo(10),
            action: "REQUESTED",
            actorId: "staff-4",
            actorName: "Suman Gurung",
            actorRole: "CENTER_MANAGER",
            note: "Submitted tailoring voucher without vendor invoice reference.",
            statusAfter: "PENDING_MANAGER"
          },
          {
            id: "faph-502",
            timestamp: hoursAgo(7),
            action: "DECLINED",
            actorId: "staff-5",
            actorName: "Aarati Poudel",
            actorRole: "INVENTORY_HR",
            note: "Declined: Missing itemized vendor receipt number \u2014 attach VAT bill no. & re-request.",
            statusAfter: "DECLINED"
          }
        ]
      },
      {
        id: "fap-6",
        requestNumber: "FAP-2083-006",
        fiscalYear: activeFy,
        createdAt: hoursAgo(18),
        updatedAt: hoursAgo(12),
        transactionType: "EXPENSE",
        direction: "OUT",
        amountNpr: 2400,
        accountId: "acc-petty",
        accountName: "Petty Cash Drawer",
        referenceId: "VCH-2083-014",
        reason: "Dry Ice & Cold-Chain Sample Cooler Consumables",
        description: "Dry ice & sample transport cooler consumables",
        payeeOrParty: "Saptari Cold Supply",
        requesterId: "staff-5",
        requesterName: "Aarati Poudel",
        requesterRole: "INVENTORY_HR",
        status: "APPROVED",
        managerReviewedBy: "Suman Gurung",
        managerReviewedAt: hoursAgo(15),
        adminReviewedBy: "Dr. Santosh Majhi (Hospital Admin)",
        adminReviewedAt: hoursAgo(12),
        reRequestCount: 0,
        history: [
          {
            id: "faph-601",
            timestamp: hoursAgo(18),
            action: "REQUESTED",
            actorId: "staff-5",
            actorName: "Aarati Poudel",
            actorRole: "INVENTORY_HR",
            note: "Requested cold-chain consumables expense.",
            statusAfter: "PENDING_MANAGER"
          },
          {
            id: "faph-602",
            timestamp: hoursAgo(15),
            action: "APPROVED_BY_MANAGER",
            actorId: "staff-4",
            actorName: "Suman Gurung",
            actorRole: "CENTER_MANAGER",
            note: "Verified delivery at sample reception.",
            statusAfter: "PENDING_ADMIN"
          },
          {
            id: "faph-603",
            timestamp: hoursAgo(12),
            action: "APPROVED_BY_ADMIN",
            actorId: "staff-1",
            actorName: "Dr. Santosh Majhi (Hospital Admin)",
            actorRole: "SUPER_ADMIN",
            note: "Final Admin approval granted & posted to Petty Cash ledger.",
            statusAfter: "APPROVED"
          }
        ]
      }
    ],
    counterCloses: [
      {
        id: "cls-1",
        closedAt: hoursAgo(24),
        fiscalYear: activeFy,
        bsDate: adToBs(hoursAgo(24)).formattedEn,
        shiftLabel: "Evening Shift Close",
        cashierId: "staff-4",
        cashierName: "Suman Gurung",
        openingCashNpr: 36400,
        cashSalesNpr: 14500,
        bankQrSalesNpr: 22400,
        centerCreditSalesNpr: 18500,
        cashOutflowsNpr: 2400,
        expectedClosingCashNpr: 48500,
        actualCountedCashNpr: 48500,
        varianceNpr: 0,
        notes: "Exact physical cash count verified against Main Lab Cash Counter.",
        status: "LOCKED_CLOSED"
      }
    ],
    payrollRuns: [
      {
        id: "pay-1",
        createdAt: hoursAgo(120),
        fiscalYear: activeFy,
        bsMonthLabel: `${currentBs.monthNameEn} ${currentBs.year} (Advance Batch)`,
        status: "Disbursed",
        paidFromAccountId: "acc-nabil",
        paidFromAccountName: "Nabil Bank Ltd. \u2014 Operating Current A/C",
        totalGrossNpr: 529e3,
        totalDeductionsNpr: 99360,
        totalNetNpr: 429640,
        approvedBy: "Dr. Elena Adhikari, MD",
        items: [
          {
            staffId: "staff-1",
            employeeCode: "AEG-001",
            fullName: "Dr. Elena Adhikari, MD",
            designation: "Chief Pathologist & Medical Director",
            basicSalary: 145e3,
            allowances: 35e3,
            grossSalary: 18e4,
            ssfDeduction: 15950,
            tdsDeduction: 27e3,
            netPayable: 137050
          },
          {
            staffId: "staff-2",
            employeeCode: "AEG-004",
            fullName: "Dr. Bikram Shrestha, MD",
            designation: "Consultant Hematologist",
            basicSalary: 12e4,
            allowances: 33e3,
            grossSalary: 153e3,
            ssfDeduction: 13200,
            tdsDeduction: 18360,
            netPayable: 121440
          },
          {
            staffId: "staff-3",
            employeeCode: "AEG-011",
            fullName: "Priya Maharjan, BMLT",
            designation: "Senior Lab Technologist",
            basicSalary: 42e3,
            allowances: 10500,
            grossSalary: 52500,
            ssfDeduction: 4620,
            tdsDeduction: 525,
            netPayable: 47355
          }
        ]
      }
    ],
    riders: [],
    riderTasks: [],
    patients: [
      {
        id: "pt-101",
        uhid: "SH-2083-0001",
        fullName: "Sita Devi Sharma",
        age: 46,
        ageType: "Years",
        gender: "Female",
        phone: "+977-9842811022",
        address: "Bode Barsain-05, Saptari",
        email: "sita.sharma@example.com",
        bloodGroup: "B+",
        allergies: "None known",
        pastMedicalHistory: "Type 2 Diabetes Mellitus, Hypothyroidism",
        createdAt: hoursAgo(48),
        createdBy: "Suman Gurung",
        lastOpdVisitAt: hoursAgo(48),
        lastOpdDoctor: "Dr. Rajesh Kumar Jha, MD",
        totalEncounters: 3
      },
      {
        id: "pt-102",
        uhid: "SH-2083-0002",
        fullName: "Ram Narayan Mandal",
        age: 58,
        ageType: "Years",
        gender: "Male",
        phone: "+977-9815722901",
        address: "Khadak-08, Saptari",
        bloodGroup: "O+",
        allergies: "Sulfa drugs",
        pastMedicalHistory: "Hypertension on Amlodipine 5mg OD",
        createdAt: hoursAgo(30),
        createdBy: "Suman Gurung",
        lastOpdVisitAt: hoursAgo(30),
        lastOpdDoctor: "Dr. Rajesh Kumar Jha, MD",
        totalEncounters: 2
      },
      {
        id: "pt-103",
        uhid: "SH-2083-0003",
        fullName: "Hari Prasad Thapa",
        age: 34,
        ageType: "Years",
        gender: "Male",
        phone: "+977-9801442290",
        address: "Rajbiraj-03, Saptari",
        bloodGroup: "A+",
        allergies: "None",
        pastMedicalHistory: "No significant prior comorbidities",
        createdAt: hoursAgo(8),
        createdBy: "Emergency Desk",
        totalEncounters: 1
      }
    ],
    storeRequisitions: [
      {
        id: "sreq-1",
        reqNumber: "STR-2083-001",
        createdAt: hoursAgo(10),
        fiscalYear: activeFy,
        department: "Emergency",
        requestedBy: "Anjali Kumari Yadav, BN",
        issuedBy: "Aarati Poudel",
        items: [{ reagentId: "reg-4", reagentName: "Vacutainer EDTA + SST Consumables", qty: 10, unit: "Boxes" }],
        status: "Issued",
        notes: "Routine Emergency bay replenishment"
      }
    ],
    gatepasses: [
      {
        id: "gp-1",
        passNumber: "GP-2083-001",
        fiscalYear: activeFy,
        passType: "VISITOR",
        personName: "Ramesh Mandal (Visitor)",
        phone: "+977-9814702210",
        purpose: "Attendant visit for IPD Ward Bed #1",
        departmentOrWard: "General Medical Ward",
        linkedPatientOrRef: "IPD-2083-001",
        validUntil: hoursFromNow(6),
        issuedAt: hoursAgo(1),
        issuedBy: "Hospital Gate Security",
        status: "Active"
      }
    ],
    attendanceLogs: [
      {
        id: "att-1",
        staffId: "staff-nurse-1",
        staffName: "Anjali Kumari Yadav, BN",
        employeeCode: "SHP-042",
        department: "Nursing Station",
        timestamp: hoursAgo(3),
        bsDate: currentBs.formattedEn,
        mode: "HIKVISION_BIOMETRIC",
        deviceIdOrIp: "192.168.1.201",
        punchType: "CHECK_IN",
        shiftLabel: "Morning (07:00-15:00)",
        verificationCode: "HIK-BIO-9012"
      },
      {
        id: "att-2",
        staffId: "staff-phm-cashier",
        staffName: "Bikash Yadav (Pharmacy Cashier)",
        employeeCode: "SHP-032",
        department: "Central Hospital Pharmacy",
        timestamp: hoursAgo(2.8),
        bsDate: currentBs.formattedEn,
        mode: "QR_SCAN",
        deviceIdOrIp: "SAPTARI-HOSP-LAN",
        punchType: "CHECK_IN",
        shiftLabel: "Morning (07:00-15:00)",
        verificationCode: "QR-SHP032"
      }
    ],
    shiftHandovers: [
      {
        id: "hnd-1",
        handoverNumber: "HND-2083-001",
        createdAt: hoursAgo(4),
        bsDate: currentBs.formattedEn,
        fromShift: "Night (21:30-07:30)",
        toShift: "Morning (07:00-15:00)",
        department: "Nursing Station",
        outgoingStaffId: "staff-3",
        outgoingStaffName: "Priya Maharjan",
        incomingStaffId: "staff-nurse-1",
        incomingStaffName: "Anjali Kumari Yadav, BN",
        summaryNotes: "3 IPD patients stable; ICU bed 2 vitals monitored hourly.",
        pendingTasks: "Morning IV Ceftriaxone 1g due at 08:00 AM for Bed ICU-01",
        cashOrKeysCount: "Narcotic box key + Ward emergency kit handed over",
        status: "SENT",
        auditTrail: [
          {
            id: "hnd-aud-1",
            timestamp: hoursAgo(4),
            action: "SUBMITTED",
            actorName: "Priya Maharjan",
            note: "Night to Morning handover submitted."
          }
        ]
      }
    ],
    marketingVisits: [
      {
        id: "mkt-1",
        visitNumber: "MKT-2083-001",
        visitedAt: hoursAgo(20),
        bsDate: currentBs.formattedEn,
        areaName: "Bode Barsain Bazar & Ward 05",
        municipality: "Bode Barsain Municipality",
        facilityOrDoctorName: "Saptari Polyclinic & Medical Hall",
        contactPerson: "Dr. Rameshwar Sah",
        phone: "+977-9852831100",
        gpsLat: 26.6214,
        gpsLng: 86.5781,
        gpsAccuracyM: 12,
        notes: "Discussed 24x7 Emergency & Ultrasound referral coordination.",
        staffId: "staff-5",
        staffName: "Aarati Poudel",
        status: "Logged"
      }
    ],
    orders: [
      {
        id: "ord-1041",
        accessionNumber: "AEG-2083-1041",
        invoiceNumber: "INV-2083-1041",
        fiscalYear: activeFy,
        patientName: "Sita Sharma",
        patientAge: 46,
        patientAgeType: "Years",
        patientGender: "Female",
        patientAddress: "Jhamsikhel-03, Lalitpur",
        patientPhone: "+977-9841602881",
        patientEmail: "sita.sharma@example.com",
        referringDoctor: "Dr. Prakash Regmi, MD",
        referralPartnerId: "ref-1",
        referralPartnerName: "Dr. Prakash Regmi, MD (Internal Medicine)",
        referralCommissionTotal: 420,
        collectionCenterId: "ctr-1",
        collectionCenterName: "Patan Lagankhel Collection Hub",
        priority: "Routine",
        status: "Validated",
        orderedAt: hoursAgo(6),
        collectedAt: hoursAgo(5.5),
        receivedInLabAt: hoursAgo(5),
        resultedAt: hoursAgo(4.2),
        validatedAt: hoursAgo(4),
        validatedById: "staff-1",
        validatedByName: "Dr. Elena Adhikari, MD",
        validatedByDesignation: "Chief Pathologist & Medical Director",
        validatedByRegNo: "NMC-8412",
        dueAt: hoursAgo(2),
        subtotalAmount: 2800,
        discountAmount: 0,
        totalAmount: 2800,
        paidAmount: 0,
        dueAmount: 2800,
        paymentMode: "Center Credit",
        cashPaid: 0,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: true,
        emailSentAt: hoursAgo(4),
        apiSent: true,
        apiSentAt: hoursAgo(4),
        tests: [
          {
            serviceId: "srv-cbc",
            serviceCode: "CBC-01",
            serviceName: "Complete Blood Count (Automated 6-Part Hemogram)",
            department: "Hematology",
            methodology: "Hydrodynamic Focusing & Fluorescent Flow Cytometry (Sysmex XN-1000)",
            tatMinutes: 120,
            dueAt: hoursAgo(4),
            price: 650,
            referralCommissionNpr: 97.5,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Mild normocytic anemia (Hb 11.2 g/dL) with preserved leukocyte and platelet counts. Recommend iron studies and ferritin correlation.",
            parameterResults: [
              { parameterId: "p-hb", parameterName: "Hemoglobin (Hb)", unit: "g/dL", value: 11.2, refRangeDisplay: "12.0 - 15.5", flag: "LOW" },
              { parameterId: "p-wbc", parameterName: "Total Leukocyte Count (WBC)", unit: "\xD710\xB3/\xB5L", value: 6.84, refRangeDisplay: "4.0 - 11.0", flag: "NORMAL" },
              { parameterId: "p-plt", parameterName: "Platelet Count", unit: "\xD710\xB3/\xB5L", value: 268, refRangeDisplay: "150 - 450", flag: "NORMAL" },
              { parameterId: "p-rbc", parameterName: "RBC Count", unit: "\xD710\u2076/\xB5L", value: 3.92, refRangeDisplay: "4.1 - 5.1", flag: "LOW" },
              { parameterId: "p-hct", parameterName: "Hematocrit (PCV)", unit: "%", value: 34.8, refRangeDisplay: "36.0 - 46.0", flag: "LOW" }
            ]
          },
          {
            serviceId: "srv-hba",
            serviceCode: "HBA-05",
            serviceName: "HbA1c (Glycated Hemoglobin & eAG)",
            department: "Clinical Chemistry",
            methodology: "Ion-Exchange HPLC (Bio-Rad D-10)",
            tatMinutes: 180,
            dueAt: hoursAgo(3),
            price: 950,
            referralCommissionNpr: 142.5,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Elevated HbA1c (6.8%, eAG 148 mg/dL) consistent with Diabetes Mellitus range per ADA criteria. Quarterly monitoring advised.",
            parameterResults: [
              { parameterId: "p-hba1c", parameterName: "HbA1c (NGSP)", unit: "%", value: 6.8, refRangeDisplay: "4.0 - 5.6", flag: "HIGH" },
              { parameterId: "p-eag", parameterName: "Estimated Average Glucose (eAG)", unit: "mg/dL", value: 148, refRangeDisplay: "68 - 114", flag: "HIGH" }
            ]
          },
          {
            serviceId: "srv-lft",
            serviceCode: "LFT-02",
            serviceName: "Liver Function Panel (Comprehensive Hepatic Profile)",
            department: "Clinical Chemistry",
            methodology: "Photometric UV Kinetic & Diazo Colorimetry (Cobas c503)",
            tatMinutes: 240,
            dueAt: hoursAgo(2),
            price: 1200,
            referralCommissionNpr: 180,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Hepatocellular transaminases and biliary excretion markers lie within normal physiological limits.",
            parameterResults: [
              { parameterId: "p-tbil", parameterName: "Total Bilirubin", unit: "mg/dL", value: 0.64, refRangeDisplay: "0.2 - 1.2", flag: "NORMAL" },
              { parameterId: "p-dbil", parameterName: "Direct Bilirubin", unit: "mg/dL", value: 0.18, refRangeDisplay: "0.0 - 0.3", flag: "NORMAL" },
              { parameterId: "p-ast", parameterName: "SGOT (AST)", unit: "U/L", value: 24, refRangeDisplay: "9 - 32", flag: "NORMAL" },
              { parameterId: "p-alt", parameterName: "SGPT (ALT)", unit: "U/L", value: 21, refRangeDisplay: "7 - 35", flag: "NORMAL" },
              { parameterId: "p-alp", parameterName: "Alkaline Phosphatase (ALP)", unit: "U/L", value: 78, refRangeDisplay: "35 - 104", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1042",
        accessionNumber: "AEG-2083-1042",
        invoiceNumber: "INV-2083-1042",
        fiscalYear: activeFy,
        patientName: "Hari Prasad Thapa",
        patientAge: 63,
        patientAgeType: "Years",
        patientGender: "Male",
        patientAddress: "Baluwatar-04, Kathmandu",
        patientPhone: "+977-9841791334",
        patientEmail: "hari.thapa@example.com",
        referringDoctor: "Dr. Nina Karki, MD",
        referralPartnerId: null,
        referralPartnerName: null,
        referralCommissionTotal: 0,
        collectionCenterId: null,
        collectionCenterName: "Main Reference Lab (Walk-In)",
        priority: "STAT",
        status: "Resulted",
        orderedAt: hoursAgo(3.2),
        collectedAt: hoursAgo(3),
        receivedInLabAt: hoursAgo(2.8),
        resultedAt: hoursAgo(0.4),
        validatedAt: null,
        validatedById: null,
        validatedByName: null,
        validatedByDesignation: null,
        validatedByRegNo: null,
        dueAt: hoursAgo(0.2),
        subtotalAmount: 1600,
        discountAmount: 0,
        totalAmount: 1600,
        paidAmount: 1600,
        dueAmount: 0,
        paymentMode: "Cash",
        cashPaid: 1600,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: false,
        apiSent: false,
        tests: [
          {
            serviceId: "srv-cbc",
            serviceCode: "CBC-01",
            serviceName: "Complete Blood Count (Automated 6-Part Hemogram)",
            department: "Hematology",
            methodology: "Hydrodynamic Focusing & Fluorescent Flow Cytometry (Sysmex XN-1000)",
            tatMinutes: 120,
            dueAt: hoursAgo(1.2),
            price: 650,
            referralCommissionNpr: 0,
            reagentsDeducted: false,
            status: "Resulted",
            interpretation: "CRITICAL PANIC VALUE ALERT: Marked leukocytosis (34.2 \xD710\xB3/\xB5L) and thrombocytopenia (44 \xD710\xB3/\xB5L). Immediate pathologist review required.",
            parameterResults: [
              { parameterId: "p-hb", parameterName: "Hemoglobin (Hb)", unit: "g/dL", value: 9.4, refRangeDisplay: "13.5 - 17.5", flag: "LOW" },
              { parameterId: "p-wbc", parameterName: "Total Leukocyte Count (WBC)", unit: "\xD710\xB3/\xB5L", value: 34.2, refRangeDisplay: "4.0 - 11.0", flag: "CRITICAL_HIGH" },
              { parameterId: "p-plt", parameterName: "Platelet Count", unit: "\xD710\xB3/\xB5L", value: 44, refRangeDisplay: "150 - 450", flag: "CRITICAL_LOW" },
              { parameterId: "p-rbc", parameterName: "RBC Count", unit: "\xD710\u2076/\xB5L", value: 3.4, refRangeDisplay: "4.5 - 5.9", flag: "LOW" },
              { parameterId: "p-hct", parameterName: "Hematocrit (PCV)", unit: "%", value: 29.5, refRangeDisplay: "41.0 - 53.0", flag: "LOW" }
            ]
          },
          {
            serviceId: "srv-ren",
            serviceCode: "REN-06",
            serviceName: "Renal Function Test (KFT & eGFR)",
            department: "Clinical Chemistry",
            methodology: "Enzymatic Creatininase & Urease GLDH UV (Cobas c503)",
            tatMinutes: 180,
            dueAt: hoursAgo(0.2),
            price: 950,
            referralCommissionNpr: 0,
            reagentsDeducted: false,
            status: "Resulted",
            interpretation: "Elevated serum creatinine (1.94 mg/dL) with reduced eGFR (35 mL/min/1.73m\xB2) indicating moderate-to-severe renal impairment.",
            parameterResults: [
              { parameterId: "p-creat", parameterName: "Serum Creatinine", unit: "mg/dL", value: 1.94, refRangeDisplay: "0.72 - 1.25", flag: "HIGH" },
              { parameterId: "p-bun", parameterName: "Blood Urea Nitrogen (BUN)", unit: "mg/dL", value: 36.4, refRangeDisplay: "7 - 20", flag: "HIGH" },
              { parameterId: "p-ua", parameterName: "Uric Acid", unit: "mg/dL", value: 8.1, refRangeDisplay: "3.5 - 7.2", flag: "HIGH" },
              { parameterId: "p-egfr", parameterName: "eGFR (CKD-EPI 2021)", unit: "mL/min/1.73m\xB2", value: 35, refRangeDisplay: "90 - 140", flag: "LOW" }
            ]
          }
        ]
      },
      {
        id: "ord-1043",
        accessionNumber: "AEG-2083-1043",
        invoiceNumber: "INV-2083-1043",
        fiscalYear: activeFy,
        patientName: "Aarav Gurung",
        patientAge: 8,
        patientAgeType: "Months",
        patientGender: "Male",
        patientAddress: "Lakeside-06, Pokhara",
        patientPhone: "+977-9856044211",
        patientEmail: "aarav.family@example.com",
        referringDoctor: "Dr. Sunita Basnet, MD",
        referralPartnerId: "ref-3",
        referralPartnerName: "Dr. Sunita Basnet, MD (Endocrinology)",
        referralCommissionTotal: 324,
        collectionCenterId: "ctr-2",
        collectionCenterName: "Pokhara Lakeside Polyclinic Hub",
        priority: "Routine",
        status: "In Lab",
        orderedAt: hoursAgo(3.4),
        collectedAt: hoursAgo(2.9),
        receivedInLabAt: hoursAgo(1.8),
        resultedAt: null,
        validatedAt: null,
        validatedById: null,
        validatedByName: null,
        validatedByDesignation: null,
        validatedByRegNo: null,
        dueAt: hoursFromNow(0.6),
        subtotalAmount: 2700,
        discountAmount: 0,
        totalAmount: 2700,
        paidAmount: 0,
        dueAmount: 2700,
        paymentMode: "Center Credit",
        cashPaid: 0,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: false,
        apiSent: false,
        tests: [
          {
            serviceId: "srv-tft",
            serviceCode: "TFT-04",
            serviceName: "Thyroid Function Panel (TSH Ultra-Sensitive, FT3, FT4)",
            department: "Endocrinology",
            methodology: "CMIA Chemiluminescent Microparticle Immunoassay (Abbott Alinity i)",
            tatMinutes: 360,
            dueAt: hoursFromNow(2.6),
            price: 1500,
            referralCommissionNpr: 180,
            reagentsDeducted: false,
            status: "Pending",
            interpretation: "",
            parameterResults: [
              { parameterId: "p-tsh", parameterName: "TSH (3rd Generation)", unit: "\xB5IU/mL", value: null, refRangeDisplay: "0.35 - 4.94", flag: "NORMAL" },
              { parameterId: "p-ft3", parameterName: "Free T3 (Triiodothyronine)", unit: "pg/mL", value: null, refRangeDisplay: "1.71 - 3.71", flag: "NORMAL" },
              { parameterId: "p-ft4", parameterName: "Free T4 (Thyroxine)", unit: "ng/dL", value: null, refRangeDisplay: "0.70 - 1.48", flag: "NORMAL" }
            ]
          },
          {
            serviceId: "srv-lft",
            serviceCode: "LFT-02",
            serviceName: "Liver Function Panel (Comprehensive Hepatic Profile)",
            department: "Clinical Chemistry",
            methodology: "Photometric UV Kinetic & Diazo Colorimetry (Cobas c503)",
            tatMinutes: 240,
            dueAt: hoursFromNow(0.6),
            price: 1200,
            referralCommissionNpr: 144,
            reagentsDeducted: false,
            status: "Pending",
            interpretation: "",
            parameterResults: [
              { parameterId: "p-tbil", parameterName: "Total Bilirubin", unit: "mg/dL", value: null, refRangeDisplay: "0.2 - 1.2", flag: "NORMAL" },
              { parameterId: "p-dbil", parameterName: "Direct Bilirubin", unit: "mg/dL", value: null, refRangeDisplay: "0.0 - 0.3", flag: "NORMAL" },
              { parameterId: "p-ast", parameterName: "SGOT (AST)", unit: "U/L", value: null, refRangeDisplay: "10 - 40", flag: "NORMAL" },
              { parameterId: "p-alt", parameterName: "SGPT (ALT)", unit: "U/L", value: null, refRangeDisplay: "10 - 45", flag: "NORMAL" },
              { parameterId: "p-alp", parameterName: "Alkaline Phosphatase (ALP)", unit: "U/L", value: null, refRangeDisplay: "40 - 129", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1044",
        accessionNumber: "AEG-2083-1044",
        invoiceNumber: "INV-2083-1044",
        fiscalYear: activeFy,
        patientName: "Binod Koirala",
        patientAge: 52,
        patientAgeType: "Years",
        patientGender: "Male",
        patientAddress: "Hospital Chowk-09, Biratnagar",
        patientPhone: "+977-9852031899",
        patientEmail: "binod.koirala@example.com",
        referringDoctor: "Kantipur Community Polyclinic",
        referralPartnerId: "ref-2",
        referralPartnerName: "Kantipur Community Polyclinic",
        referralCommissionTotal: 300,
        collectionCenterId: "ctr-4",
        collectionCenterName: "Biratnagar Koshi Medical Hub",
        priority: "Routine",
        status: "In Lab",
        orderedAt: hoursAgo(1.1),
        collectedAt: hoursAgo(0.9),
        receivedInLabAt: hoursAgo(0.5),
        resultedAt: null,
        validatedAt: null,
        validatedById: null,
        validatedByName: null,
        validatedByDesignation: null,
        validatedByRegNo: null,
        dueAt: hoursFromNow(1.9),
        subtotalAmount: 2050,
        discountAmount: 0,
        totalAmount: 2050,
        paidAmount: 0,
        dueAmount: 2050,
        paymentMode: "Center Credit",
        cashPaid: 0,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: false,
        apiSent: false,
        tests: [
          {
            serviceId: "srv-lip",
            serviceCode: "LIP-03",
            serviceName: "Lipid Profile (Atherogenic & Cardiovascular Risk)",
            department: "Clinical Chemistry",
            methodology: "Enzymatic Colorimetric Assay (CHOD-PAP / GPO-PAP)",
            tatMinutes: 180,
            dueAt: hoursFromNow(1.9),
            price: 1100,
            referralCommissionNpr: 150,
            reagentsDeducted: false,
            status: "Pending",
            interpretation: "",
            parameterResults: [
              { parameterId: "p-chol", parameterName: "Total Cholesterol", unit: "mg/dL", value: null, refRangeDisplay: "125 - 200", flag: "NORMAL" },
              { parameterId: "p-hdl", parameterName: "HDL Cholesterol", unit: "mg/dL", value: null, refRangeDisplay: "40 - 80", flag: "NORMAL" },
              { parameterId: "p-ldl", parameterName: "LDL Cholesterol (Direct)", unit: "mg/dL", value: null, refRangeDisplay: "50 - 100", flag: "NORMAL" },
              { parameterId: "p-tg", parameterName: "Triglycerides", unit: "mg/dL", value: null, refRangeDisplay: "40 - 150", flag: "NORMAL" }
            ]
          },
          {
            serviceId: "srv-ren",
            serviceCode: "REN-06",
            serviceName: "Renal Function Test (KFT & eGFR)",
            department: "Clinical Chemistry",
            methodology: "Enzymatic Creatininase & Urease GLDH UV (Cobas c503)",
            tatMinutes: 180,
            dueAt: hoursFromNow(1.9),
            price: 950,
            referralCommissionNpr: 150,
            reagentsDeducted: false,
            status: "Pending",
            interpretation: "",
            parameterResults: [
              { parameterId: "p-creat", parameterName: "Serum Creatinine", unit: "mg/dL", value: null, refRangeDisplay: "0.72 - 1.25", flag: "NORMAL" },
              { parameterId: "p-bun", parameterName: "Blood Urea Nitrogen (BUN)", unit: "mg/dL", value: null, refRangeDisplay: "7 - 20", flag: "NORMAL" },
              { parameterId: "p-ua", parameterName: "Uric Acid", unit: "mg/dL", value: null, refRangeDisplay: "3.5 - 7.2", flag: "NORMAL" },
              { parameterId: "p-egfr", parameterName: "eGFR (CKD-EPI 2021)", unit: "mL/min/1.73m\xB2", value: null, refRangeDisplay: "90 - 140", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1040",
        accessionNumber: "AEG-2083-1040",
        invoiceNumber: "INV-2083-1040",
        fiscalYear: activeFy,
        patientName: "Kamala Devi Bhandari",
        patientAge: 54,
        patientAgeType: "Years",
        patientGender: "Female",
        patientAddress: "New Baneshwor-10, Kathmandu",
        patientPhone: "+977-9841552019",
        patientEmail: "kamala.bhandari@example.com",
        referringDoctor: "Dr. Prakash Regmi, MD",
        referralPartnerId: "ref-1",
        referralPartnerName: "Dr. Prakash Regmi, MD (Internal Medicine)",
        referralCommissionTotal: 540,
        collectionCenterId: "ctr-1",
        collectionCenterName: "Patan Lagankhel Collection Hub",
        priority: "Routine",
        status: "Validated",
        orderedAt: hoursAgo(28),
        collectedAt: hoursAgo(27.5),
        receivedInLabAt: hoursAgo(27),
        resultedAt: hoursAgo(25.5),
        validatedAt: hoursAgo(25),
        validatedById: "staff-2",
        validatedByName: "Dr. Bikram Shrestha, MD",
        validatedByDesignation: "Consultant Hematologist",
        validatedByRegNo: "NMC-11205",
        dueAt: hoursAgo(23),
        subtotalAmount: 3600,
        discountAmount: 0,
        totalAmount: 3600,
        paidAmount: 3600,
        dueAmount: 0,
        paymentMode: "Bank / QR",
        cashPaid: 0,
        bankPaid: 3600,
        creditOverrideApplied: false,
        emailSent: true,
        emailSentAt: hoursAgo(25),
        apiSent: true,
        apiSentAt: hoursAgo(25),
        tests: [
          {
            serviceId: "srv-vitd",
            serviceCode: "VITD-09",
            serviceName: "25-Hydroxy Vitamin D (Total)",
            department: "Endocrinology",
            methodology: "Chemiluminescent Immunoassay (CLIA)",
            tatMinutes: 300,
            dueAt: hoursAgo(23),
            price: 1850,
            referralCommissionNpr: 370,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Vitamin D sufficiency (34.6 ng/mL).",
            parameterResults: [
              { parameterId: "p-vitd", parameterName: "25-OH Vitamin D", unit: "ng/mL", value: 34.6, refRangeDisplay: "30 - 100", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1039",
        accessionNumber: "AEG-2083-1039",
        invoiceNumber: "INV-2083-1039",
        fiscalYear: activeFy,
        patientName: "Nirmal Rajbhandari",
        patientAge: 39,
        patientAgeType: "Years",
        patientGender: "Male",
        patientAddress: "Kupondole, Lalitpur",
        patientPhone: "+977-9851092231",
        patientEmail: "nirmal.raj@example.com",
        referringDoctor: "Self / Walk-in",
        referralPartnerId: null,
        referralPartnerName: null,
        referralCommissionTotal: 0,
        collectionCenterId: null,
        collectionCenterName: "Main Reference Lab (Walk-In)",
        priority: "Routine",
        status: "Validated",
        orderedAt: hoursAgo(52),
        collectedAt: hoursAgo(51.5),
        receivedInLabAt: hoursAgo(51),
        resultedAt: hoursAgo(49.5),
        validatedAt: hoursAgo(49),
        validatedById: "staff-1",
        validatedByName: "Dr. Elena Adhikari, MD",
        validatedByDesignation: "Chief Pathologist & Medical Director",
        validatedByRegNo: "NMC-8412",
        dueAt: hoursAgo(47),
        subtotalAmount: 2450,
        discountAmount: 0,
        totalAmount: 2450,
        paidAmount: 2450,
        dueAmount: 0,
        paymentMode: "Cash",
        cashPaid: 2450,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: true,
        emailSentAt: hoursAgo(49),
        apiSent: false,
        tests: [
          {
            serviceId: "srv-lip",
            serviceCode: "LIP-03",
            serviceName: "Lipid Profile (Atherogenic & Cardiovascular Risk)",
            department: "Clinical Chemistry",
            methodology: "Enzymatic Colorimetric Assay",
            tatMinutes: 180,
            dueAt: hoursAgo(49),
            price: 1100,
            referralCommissionNpr: 0,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Desirable lipid fractions.",
            parameterResults: [
              { parameterId: "p-chol", parameterName: "Total Cholesterol", unit: "mg/dL", value: 178, refRangeDisplay: "125 - 200", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1038",
        accessionNumber: "AEG-2083-1038",
        invoiceNumber: "INV-2083-1038",
        fiscalYear: activeFy,
        patientName: "Saraswati Adhikari",
        patientAge: 29,
        patientAgeType: "Years",
        patientGender: "Female",
        patientAddress: "Chabahil-07, Kathmandu",
        patientPhone: "+977-9849883102",
        patientEmail: "saraswati.a@example.com",
        referringDoctor: "Dr. Sunita Basnet, MD",
        referralPartnerId: "ref-3",
        referralPartnerName: "Dr. Sunita Basnet, MD (Endocrinology)",
        referralCommissionTotal: 250,
        collectionCenterId: "ctr-3",
        collectionCenterName: "Chabahil Urgent Diagnostics Hub",
        priority: "Routine",
        status: "Validated",
        orderedAt: hoursAgo(76),
        collectedAt: hoursAgo(75.5),
        receivedInLabAt: hoursAgo(75),
        resultedAt: hoursAgo(73.5),
        validatedAt: hoursAgo(73),
        validatedById: "staff-1",
        validatedByName: "Dr. Elena Adhikari, MD",
        validatedByDesignation: "Chief Pathologist & Medical Director",
        validatedByRegNo: "NMC-8412",
        dueAt: hoursAgo(70),
        subtotalAmount: 4200,
        discountAmount: 200,
        totalAmount: 4e3,
        paidAmount: 2e3,
        dueAmount: 2e3,
        paymentMode: "Split",
        cashPaid: 1e3,
        bankPaid: 1e3,
        creditOverrideApplied: false,
        emailSent: true,
        emailSentAt: hoursAgo(73),
        apiSent: true,
        apiSentAt: hoursAgo(73),
        tests: [
          {
            serviceId: "srv-tft",
            serviceCode: "TFT-04",
            serviceName: "Thyroid Function Panel",
            department: "Endocrinology",
            methodology: "CMIA Immunoassay",
            tatMinutes: 360,
            dueAt: hoursAgo(70),
            price: 1500,
            referralCommissionNpr: 180,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Euthyroid biochemical profile.",
            parameterResults: [
              { parameterId: "p-tsh", parameterName: "TSH (3rd Generation)", unit: "\xB5IU/mL", value: 2.14, refRangeDisplay: "0.35 - 4.94", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1037",
        accessionNumber: "AEG-2083-1037",
        invoiceNumber: "INV-2083-1037",
        fiscalYear: activeFy,
        patientName: "Rajendra Prasad Paudel",
        patientAge: 61,
        patientAgeType: "Years",
        patientGender: "Male",
        patientAddress: "Pokhara-08, Kaski",
        patientPhone: "+977-9856011904",
        patientEmail: "rajendra.p@example.com",
        referringDoctor: "Kantipur Community Polyclinic",
        referralPartnerId: "ref-2",
        referralPartnerName: "Kantipur Community Polyclinic",
        referralCommissionTotal: 190,
        collectionCenterId: "ctr-2",
        collectionCenterName: "Pokhara Lakeside Polyclinic Hub",
        priority: "Routine",
        status: "Validated",
        orderedAt: hoursAgo(102),
        collectedAt: hoursAgo(101),
        receivedInLabAt: hoursAgo(100),
        resultedAt: hoursAgo(99),
        validatedAt: hoursAgo(98.5),
        validatedById: "staff-2",
        validatedByName: "Dr. Bikram Shrestha, MD",
        validatedByDesignation: "Consultant Hematologist",
        validatedByRegNo: "NMC-11205",
        dueAt: hoursAgo(97),
        subtotalAmount: 1950,
        discountAmount: 0,
        totalAmount: 1950,
        paidAmount: 1950,
        dueAmount: 0,
        paymentMode: "Cash",
        cashPaid: 1950,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: true,
        emailSentAt: hoursAgo(98.5),
        apiSent: false,
        tests: [
          {
            serviceId: "srv-fbs",
            serviceCode: "FBS-07",
            serviceName: "Fasting Blood Glucose (Plasma)",
            department: "Clinical Chemistry",
            methodology: "Hexokinase UV Enzymatic Assay",
            tatMinutes: 90,
            dueAt: hoursAgo(99),
            price: 250,
            referralCommissionNpr: 40,
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Normoglycemic fasting plasma glucose.",
            parameterResults: [
              { parameterId: "p-fbs", parameterName: "Glucose (Fasting)", unit: "mg/dL", value: 92, refRangeDisplay: "70 - 99", flag: "NORMAL" }
            ]
          }
        ]
      },
      {
        id: "ord-1045",
        accessionNumber: "AEG-2083-1045",
        invoiceNumber: "INV-2083-1045",
        fiscalYear: activeFy,
        patientName: "Gita Kumari Basnet",
        patientAge: 38,
        patientAgeType: "Years",
        patientGender: "Female",
        patientAddress: "Boudha-06, Kathmandu",
        patientPhone: "+977-9841338901",
        patientEmail: "gita.basnet@example.com",
        referringDoctor: "Dr. Prakash Regmi, MD",
        referralPartnerId: "ref-1",
        referralPartnerName: "Dr. Prakash Regmi, MD (Internal Medicine)",
        referralCommissionTotal: 315,
        collectionCenterId: "ctr-1",
        collectionCenterName: "Patan Lagankhel Collection Hub",
        priority: "Routine",
        status: "Validated",
        orderedAt: hoursAgo(4.5),
        collectedAt: hoursAgo(4.3),
        receivedInLabAt: hoursAgo(4),
        resultedAt: hoursAgo(3.2),
        validatedAt: hoursAgo(3),
        validatedById: "staff-rad",
        validatedByName: "Dr. Nisha Gurung, MD",
        validatedByDesignation: "Consultant Radiologist (X-Ray, CT, USG, Echo)",
        validatedByRegNo: "NMC-14902",
        dueAt: hoursAgo(2),
        subtotalAmount: 2100,
        discountAmount: 0,
        totalAmount: 2100,
        paidAmount: 2100,
        dueAmount: 0,
        paymentMode: "Bank / QR",
        cashPaid: 0,
        bankPaid: 2100,
        creditOverrideApplied: false,
        emailSent: true,
        emailSentAt: hoursAgo(3),
        apiSent: true,
        apiSentAt: hoursAgo(3),
        tests: [
          {
            serviceId: "srv-cxr",
            serviceCode: "XRAY-CHEST",
            serviceName: "Digital X-Ray Chest (PA View)",
            serviceCategory: "RADIOLOGY",
            modality: "X-RAY",
            department: "Radiology",
            methodology: "Direct Digital Radiography (DR System)",
            tatMinutes: 45,
            dueAt: hoursAgo(3.5),
            price: 700,
            referralCommissionNpr: 105,
            parameterResults: [],
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Normal chest radiograph. No active cardiopulmonary abnormality detected.",
            radiologyReport: {
              templateId: "radtpl-cxr",
              templateName: "Chest X-Ray (PA View)",
              modality: "X-RAY",
              clinicalHistory: "Pre-employment screening & mild cough",
              technique: "Standard erect Postero-Anterior (PA) chest radiograph acquired at full inspiration.",
              sections: [
                {
                  title: "Lungs & Hilum",
                  content: "Both lung fields are clear and well-expanded. No focal consolidation, cavitation, mass, or interstitial infiltrate seen."
                },
                {
                  title: "Cardiomediastinal Silhouette",
                  content: "Cardiothoracic ratio is within normal limits (0.43). Mediastinal contours and trachea are central."
                },
                {
                  title: "Pleura, Diaphragm & Bony Thorax",
                  content: "Both costophrenic angles are sharp and clear. No pleural effusion or pneumothorax."
                }
              ],
              measurements: [
                { label: "Cardiothoracic Ratio (CTR)", value: "0.43", unit: "ratio", normalRange: "< 0.50" }
              ],
              impression: "Normal chest radiograph. No active cardiopulmonary abnormality detected.",
              advice: "Correlate clinically.",
              criticalFinding: false,
              filmsUsedCount: 1,
              filmRetakeCount: 0
            }
          },
          {
            serviceId: "srv-usgabd",
            serviceCode: "USG-ABD",
            serviceName: "Ultrasound Whole Abdomen & Pelvis (USG)",
            serviceCategory: "RADIOLOGY",
            modality: "USG",
            department: "Radiology",
            methodology: "High-Resolution B-Mode & Color Doppler Sonography",
            tatMinutes: 40,
            dueAt: hoursAgo(3.5),
            price: 1400,
            referralCommissionNpr: 210,
            parameterResults: [],
            reagentsDeducted: true,
            status: "Validated",
            interpretation: "Grade I hepatic steatosis (Fatty Liver); otherwise unremarkable abdominal ultrasound.",
            radiologyReport: {
              templateId: "radtpl-usg",
              templateName: "Ultrasound Whole Abdomen & Pelvis",
              modality: "USG",
              clinicalHistory: "Mild right upper quadrant discomfort",
              technique: "Real-time B-mode and color Doppler transabdominal ultrasonography.",
              sections: [
                {
                  title: "Liver & Biliary Tree",
                  content: "Liver shows mildly increased diffuse parenchymal echogenicity with preserved periportal and diaphragmatic definition. Intrahepatic biliary radicles and CBD are not dilated."
                },
                {
                  title: "Gallbladder, Pancreas & Spleen",
                  content: "Gallbladder is well-distended without calculus. Pancreas and spleen appear normal."
                },
                {
                  title: "Kidneys & Urinary Bladder",
                  content: "Both kidneys show normal size and corticomedullary differentiation without calculus or hydronephrosis."
                }
              ],
              measurements: [
                { label: "Liver Span (MCL)", value: "14.2", unit: "cm", normalRange: "< 15.0 cm" },
                { label: "Common Bile Duct (CBD)", value: "3.9", unit: "mm", normalRange: "< 6.0 mm" },
                { label: "Right Kidney Length", value: "10.3", unit: "cm", normalRange: "9.0 - 12.0 cm" }
              ],
              impression: "Grade I hepatic steatosis (Fatty Liver). No cholelithiasis or renal calculus.",
              advice: "Correlate with LFT, Fasting Lipid Profile, and dietary modification.",
              criticalFinding: false,
              filmsUsedCount: 0,
              filmRetakeCount: 0
            }
          }
        ]
      },
      {
        id: "ord-1046",
        accessionNumber: "AEG-2083-1046",
        invoiceNumber: "INV-2083-1046",
        fiscalYear: activeFy,
        patientName: "Bikash Chandra Maharjan",
        patientAge: 58,
        patientAgeType: "Years",
        patientGender: "Male",
        patientAddress: "Kirtipur-02, Kathmandu",
        patientPhone: "+977-9851244091",
        patientEmail: "bikash.m@example.com",
        referringDoctor: "Pokhara Lakeside Polyclinic Hub",
        referralPartnerId: null,
        referralPartnerName: null,
        referralCommissionTotal: 0,
        collectionCenterId: "ctr-2",
        collectionCenterName: "Pokhara Lakeside Polyclinic Hub",
        priority: "STAT",
        status: "In Lab",
        orderedAt: hoursAgo(0.7),
        collectedAt: hoursAgo(0.5),
        receivedInLabAt: hoursAgo(0.4),
        resultedAt: null,
        validatedAt: null,
        validatedById: null,
        validatedByName: null,
        validatedByDesignation: null,
        validatedByRegNo: null,
        dueAt: hoursFromNow(0.8),
        subtotalAmount: 6e3,
        discountAmount: 0,
        totalAmount: 6e3,
        paidAmount: 6e3,
        dueAmount: 0,
        paymentMode: "Cash",
        cashPaid: 6e3,
        bankPaid: 0,
        creditOverrideApplied: false,
        emailSent: false,
        apiSent: false,
        tests: [
          {
            serviceId: "srv-ctbrain",
            serviceCode: "CT-BRAIN",
            serviceName: "CT Scan Head / Brain (Plain Multi-Slice)",
            serviceCategory: "RADIOLOGY",
            modality: "CT",
            department: "Radiology",
            methodology: "64-Slice Helical Computed Tomography",
            tatMinutes: 90,
            dueAt: hoursFromNow(0.8),
            price: 3800,
            referralCommissionNpr: 0,
            parameterResults: [],
            reagentsDeducted: false,
            status: "Pending",
            interpretation: ""
          },
          {
            serviceId: "srv-echo2d",
            serviceCode: "ECHO-2D",
            serviceName: "2D Echocardiography with Color Doppler",
            serviceCategory: "RADIOLOGY",
            modality: "ECHO",
            department: "Radiology",
            methodology: "2D, M-Mode & Color Flow Doppler Echocardiography",
            tatMinutes: 60,
            dueAt: hoursFromNow(0.5),
            price: 2200,
            referralCommissionNpr: 0,
            parameterResults: [],
            reagentsDeducted: false,
            status: "Pending",
            interpretation: ""
          }
        ]
      }
    ],
    emailNotifications: [
      {
        id: "eml-1",
        timestamp: hoursAgo(4),
        orderId: "ord-1041",
        accessionNumber: "AEG-2083-1041",
        recipientEmail: "sita.sharma@example.com",
        ccEmail: "billing@patanhub.com.np",
        subject: "Final Verified Laboratory Report \u2014 Accession AEG-2083-1041 (Sita Sharma)",
        triggerType: "AUTO_ON_VALIDATE",
        status: "Sent",
        bodyPreview: "Dear Sita Sharma, Your diagnostic report (AEG-2083-1041) comprising CBC-01, HBA-05, and LFT-02 has been digitally validated by Dr. Elena Adhikari, MD. Flagged findings: Mild normocytic anemia (Hb 11.2 g/dL) and HbA1c 6.8%.",
        triggeredBy: "Dr. Elena Adhikari, MD"
      }
    ],
    apiDispatches: [
      {
        id: "api-1",
        timestamp: hoursAgo(4),
        orderId: "ord-1041",
        accessionNumber: "AEG-2083-1041",
        targetUrl: "/api/emr-webhook-receiver",
        httpStatus: 200,
        latencyMs: 32,
        status: "Delivered",
        requestPayload: JSON.stringify(
          {
            resourceType: "DiagnosticReport",
            accessionNumber: "AEG-2083-1041",
            status: "final",
            patient: { name: "Sita Sharma", age: "46 Years", gender: "Female" },
            centerCode: "CC-KTM-01",
            validatedBy: "Dr. Elena Adhikari, MD (NMC-8412)",
            testsCount: 3
          },
          null,
          2
        ),
        responseBody: '{"received":true,"emrStatus":"ACCEPTED","hl7Ack":"AA"}',
        triggeredBy: "Dr. Elena Adhikari, MD"
      }
    ],
    auditLogs: [
      {
        id: "aud-1",
        timestamp: hoursAgo(6),
        actorId: "staff-4",
        actorName: "Suman Gurung",
        actorRole: "CENTER_MANAGER",
        module: "POS_BILLING",
        action: "ORDER_CREATED",
        entityId: "AEG-2083-1041",
        summary: "Registered POS order AEG-2083-1041 for Sita Sharma via Patan Lagankhel Hub (\u0930\u0942 2,800 debited).",
        severity: "INFO"
      },
      {
        id: "aud-2",
        timestamp: hoursAgo(4),
        actorId: "staff-1",
        actorName: "Dr. Elena Adhikari, MD",
        actorRole: "SUPER_ADMIN",
        module: "RESULTS",
        action: "REPORT_VALIDATED",
        entityId: "AEG-2083-1041",
        summary: "Signed off 3 panels for AEG-2083-1041; automated reagent BOM deducted & email/API dispatched.",
        severity: "INFO"
      },
      {
        id: "aud-3",
        timestamp: hoursAgo(26),
        actorId: "staff-1",
        actorName: "Dr. Elena Adhikari, MD",
        actorRole: "SUPER_ADMIN",
        module: "CENTERS",
        action: "CREDIT_HOLD_ENGAGED",
        entityId: "CC-CHB-03",
        summary: "Chabahil Urgent Diagnostics Hub exceeded \u0930\u0942 120,000 credit limit (\u0930\u0942 128,400 balance). Hold engaged.",
        severity: "WARNING"
      },
      {
        id: "aud-4",
        timestamp: hoursAgo(0.4),
        actorId: "staff-3",
        actorName: "Priya Maharjan, BMLT",
        actorRole: "LAB_TECH",
        module: "RESULTS",
        action: "CRITICAL_VALUE_ENTERED",
        entityId: "AEG-2083-1042",
        summary: "Entered STAT results for Hari Prasad Thapa: Critical High WBC (34.2) and Critical Low Platelets (44).",
        severity: "CRITICAL"
      }
    ],
    otRooms: [
      {
        id: "otroom-1",
        roomCode: "OT-1",
        name: "OT-1 Major Surgical Theatre",
        specialty: "General Surgery / GI / Laparoscopic",
        status: "Available",
        currentCaseId: null
      },
      {
        id: "otroom-2",
        roomCode: "OT-2",
        name: "OT-2 Orthopedics & Trauma Theatre",
        specialty: "Ortho / Implant / Fracture Fixation",
        status: "Available",
        currentCaseId: null
      },
      {
        id: "otroom-3",
        roomCode: "OT-3",
        name: "OT-3 OBG & Emergency LSCS Theatre",
        specialty: "Obstetrics, Gynecology & 24\xD77 Emergency",
        status: "Available",
        currentCaseId: null
      }
    ],
    otCases: [
      {
        id: "otcase-1",
        otNumber: "OT-2083-001",
        fiscalYear: activeFy,
        centerId: null,
        centerName: "Saptari Hospital Main",
        otRoomId: "otroom-1",
        otRoomLabel: "OT-1 Major Surgical Theatre",
        uhid: "SH-UHID-0003",
        encounterType: "IPD",
        patientName: "Ramesh Kumar Yadav",
        patientAge: 38,
        patientAgeType: "Years",
        patientGender: "Male",
        patientPhone: "+977-9842811022",
        patientAddress: "Bode Barsain-05, Saptari",
        scheduledDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        scheduledTime: "11:30",
        procedureName: "Laparoscopic Cholecystectomy",
        surgicalSpecialty: "General Surgery",
        priority: "Elective",
        leadSurgeon: "Dr. Santosh Majhi, MD",
        assistantSurgeon: "Dr. S. K. Jha, MS",
        anesthesiologist: "Dr. R. K. Mandal, MD (Anesthesia)",
        scrubNurse: "Sr. Sunita Chaudhary",
        diagnosis: "Symptomatic Cholelithiasis",
        otFeeNpr: 18500,
        status: "Scheduled",
        recordedAt: hoursAgo(2),
        recordedBy: "Dr. Santosh Majhi, MD"
      },
      {
        id: "otcase-2",
        otNumber: "OT-2083-002",
        fiscalYear: activeFy,
        centerId: null,
        centerName: "Saptari Hospital Main",
        otRoomId: "otroom-3",
        otRoomLabel: "OT-3 OBG & Emergency LSCS Theatre",
        uhid: "SH-UHID-0001",
        encounterType: "IPD",
        patientName: "Sita Sharma",
        patientAge: 29,
        patientAgeType: "Years",
        patientGender: "Female",
        patientPhone: "+977-9801122334",
        patientAddress: "Khadak-03, Saptari",
        scheduledDate: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        scheduledTime: "08:15",
        procedureName: "Emergency Lower Segment Cesarean Section (LSCS)",
        surgicalSpecialty: "OBG / Gynecology",
        priority: "Emergency",
        leadSurgeon: "Dr. A. P. Singh, MD (OBG)",
        anesthesiologist: "Dr. R. K. Mandal, MD (Anesthesia)",
        scrubNurse: "Sr. Anita Kumari",
        diagnosis: "Fetal Distress at 39 Weeks POG",
        otFeeNpr: 22e3,
        status: "Completed",
        startedAt: hoursAgo(4),
        completedAt: hoursAgo(2.8),
        operativeNote: "Live singleton male baby delivered with APGAR 8/9. Hemostasis achieved cleanly.",
        preOpChecklist: {
          completedAt: hoursAgo(4.2),
          completedBy: "Sr. Anita Kumari",
          vitalBp: "118/76",
          vitalPulseBpm: 88,
          vitalTempF: 98.4,
          vitalSpo2Pct: 99,
          asaGrade: "ASA II",
          anesthesiaCleared: true,
          anesthesiaClearedBy: "Dr. R. K. Mandal, MD (Anesthesia)",
          surgicalSiteVerified: true,
          siteMarked: true,
          laterality: "Midline / N/A",
          procedureNameVerified: "Emergency Lower Segment Cesarean Section (LSCS)",
          patientIdentityVerified: true,
          consentSignedVerified: true,
          npoConfirmed: true,
          bloodCrossmatchChecked: true,
          equipmentSterilityChecked: true,
          checklistNotes: "1 unit PRBC crossmatched and kept ready.",
          clearedToStart: true
        },
        anesthesiaRecord: {
          anesthesiologistName: "Dr. R. K. Mandal, MD (Anesthesia)",
          anesthesiaType: "Spinal (Subarachnoid)",
          startedAt: hoursAgo(4.1),
          endedAt: hoursAgo(2.8),
          airwayLog: {
            mallampatiGrade: "Class I",
            airwayDevice: "Nasal Cannula / Neuraxial",
            tubeSize: "O2 4L/min",
            intubationAttempts: 0,
            airwayNotes: "Spontaneous respiration on O2 mask 4 L/min under T4 sensory block."
          },
          agentsUsed: [
            {
              id: "ag-seed-1",
              agentName: "Bupivacaine 0.5% Heavy (Sensorcaine)",
              category: "Local / Neuraxial",
              dose: "11",
              unit: "mg (2.2 mL)",
              route: "Intrathecal L3-L4",
              timeGiven: "08:10",
              givenBy: "Dr. R. K. Mandal"
            },
            {
              id: "ag-seed-2",
              agentName: "Fentanyl Citrate",
              category: "Analgesic",
              dose: "20",
              unit: "mcg",
              route: "Intrathecal Adjuvant",
              timeGiven: "08:10",
              givenBy: "Dr. R. K. Mandal"
            }
          ],
          vitalsLog: [
            {
              id: "av-seed-1",
              recordedAt: "08:15",
              bp: "116/72",
              pulseBpm: 92,
              spo2Pct: 99,
              patientResponseNote: "T4 block achieved; calm & stable."
            },
            {
              id: "av-seed-2",
              recordedAt: "08:45",
              bp: "112/70",
              pulseBpm: 84,
              spo2Pct: 99,
              patientResponseNote: "Baby delivered; Oxytocin infusion started."
            }
          ],
          ivFluidsGivenMl: 1500,
          estimatedBloodLossMl: 420,
          updatedAt: hoursAgo(2.8),
          updatedBy: "Dr. R. K. Mandal, MD (Anesthesia)"
        },
        postOpPacu: {
          recordedAt: hoursAgo(2.7),
          aldreteScore: 9,
          bp: "118/74",
          spo2Pct: 99,
          painScore: 2,
          pacuNotes: "Shifted to Post-Op Maternity Ward in stable hemodynamic condition.",
          transferredTo: "Maternity Post-Op Ward",
          dischargedBy: "Dr. R. K. Mandal, MD (Anesthesia)"
        },
        recordedAt: hoursAgo(5),
        recordedBy: "Dr. A. P. Singh, MD (OBG)"
      }
    ],
    pharmacySuppliers: [
      {
        id: "psup-1",
        code: "SUP-KTM-01",
        name: "Kathmandu MediDistributors Pvt. Ltd.",
        contactPerson: "Suresh Adhikari",
        phone: "+977-9851120011",
        address: "Tripureshwor, Kathmandu",
        panVat: "302184910",
        paymentTerms: "Credit 30 Days",
        creditDays: 30,
        openingDueNpr: 45e3,
        currentDueNpr: 45e3,
        notes: "Primary supplier for IV fluids, antibiotics, and emergency drugs",
        active: true,
        createdAt: hoursAgo(720)
      },
      {
        id: "psup-2",
        code: "SUP-JNK-02",
        name: "Janakpur Drug Distributors",
        contactPerson: "Ramesh Sah",
        phone: "+977-9844021190",
        address: "Bhanu Chowk, Janakpur",
        panVat: "304918220",
        paymentTerms: "Credit 15 Days",
        creditDays: 15,
        openingDueNpr: 18500,
        currentDueNpr: 18500,
        notes: "Fast regional Madhesh province distributor",
        active: true,
        createdAt: hoursAgo(600)
      },
      {
        id: "psup-3",
        code: "SUP-DJPL-03",
        name: "Deurali-Janta Direct Depot",
        contactPerson: "Nabin Gautam",
        phone: "+977-9851094412",
        address: "Biratnagar Depot, Koshi",
        panVat: "300182911",
        paymentTerms: "Credit 45 Days",
        creditDays: 45,
        openingDueNpr: 0,
        currentDueNpr: 0,
        notes: "Direct institutional hospital supply",
        active: true,
        createdAt: hoursAgo(500)
      }
    ],
    pharmacyManufacturers: NEPAL_PHARMA_COMPANIES.map((companyName, idx) => ({
      id: `pmfg-${idx + 1}`,
      code: `MFG-${String(idx + 1).padStart(3, "0")}`,
      name: companyName,
      country: "Nepal",
      contactPhone: "",
      address: "Nepal",
      active: true,
      createdAt: hoursAgo(720)
    })),
    hospitalAssets: [
      {
        id: "ast-1",
        assetCode: "AST-LAB-001",
        name: "5-Part Automated Hematology Analyzer (Mindray BC-5150)",
        category: "Lab Analyzer",
        departmentScope: "HOSPITAL",
        location: "Central Pathology Lab",
        purchaseDate: "2025-04-12",
        purchaseCostNpr: 145e4,
        currentValueNpr: 128e4,
        vendorName: "MedTech Nepal Pvt Ltd",
        warrantyUntil: "2028-04-12",
        status: "Active",
        notes: "AMC active; calibrated weekly",
        createdAt: hoursAgo(720)
      },
      {
        id: "ast-2",
        assetCode: "AST-RAD-002",
        name: "Digital Radiography (DR) 500mA X-Ray System",
        category: "Radiology / Imaging",
        departmentScope: "HOSPITAL",
        location: "Radiology Room 1",
        purchaseDate: "2024-11-20",
        purchaseCostNpr: 285e4,
        currentValueNpr: 245e4,
        vendorName: "Himalayan Imaging Solutions",
        warrantyUntil: "2027-11-20",
        status: "Active",
        notes: "AERB/radiation shielding verified",
        createdAt: hoursAgo(720)
      },
      {
        id: "ast-3",
        assetCode: "AST-PHM-003",
        name: "Pharmaceutical Cold Chain Refrigerator (2-8\xB0C) + POS Server",
        category: "IT & Server",
        departmentScope: "PHARMACY",
        location: "Central Pharmacy Store",
        purchaseDate: "2025-08-01",
        purchaseCostNpr: 185e3,
        currentValueNpr: 165e3,
        vendorName: "Sagarmatha Cold Tech",
        warrantyUntil: "2027-08-01",
        status: "Active",
        notes: "Stores insulin, vaccines & ceftriaxone vials",
        createdAt: hoursAgo(720)
      }
    ],
    discountCreditApprovals: [],
    appointments: [],
    hrCertificates: [],
    referredHospitalsMaster: [
      {
        id: "rhosp-bpkihs",
        name: "BPKIHS Teaching Hospital, Dharan",
        address: "Ghopa Camp, Dharan, Sunsari",
        phone: "025-525555",
        managerName: "Mr. Prakash Karki (Emergency Liaison)",
        managerPhone: "+977-9852044110",
        specialties: "Trauma, Neuro, ICU, Cardiology, NICU",
        active: true,
        createdAt: hoursAgo(720)
      },
      {
        id: "rhosp-nobel",
        name: "Nobel Medical College & Teaching Hospital",
        address: "Kanchanbari, Biratnagar, Morang",
        phone: "021-460736",
        managerName: "Mr. Suresh Jha (Referral Desk Manager)",
        managerPhone: "+977-9852077889",
        specialties: "Polytrauma, Neurosurgery, CTVS, High-Risk OBG",
        active: true,
        createdAt: hoursAgo(720)
      },
      {
        id: "rhosp-gajendra",
        name: "Gajendra Narayan Singh Hospital, Rajbiraj",
        address: "Rajbiraj, Saptari",
        phone: "031-520188",
        managerName: "Mr. Binod Mandal (Duty Officer)",
        managerPhone: "+977-9842811223",
        specialties: "District Emergency, General Surgery, Maternity",
        active: true,
        createdAt: hoursAgo(720)
      }
    ],
    ambulancesMaster: [
      {
        id: "amb-1",
        name: "Saptari Hospital ALS-01",
        vehicleNumber: "BA 2 JHA 8412",
        vehicleType: "ALS Ambulance",
        driverName: "Ramu Choudhary",
        driverPhone: "+977-9842855110",
        defaultCommissionMode: "FLAT",
        defaultCommissionValue: 500,
        caseOverrides: [
          { id: "ao-rta", caseType: "RTA Case", mode: "PERCENT", value: 12, active: true },
          { id: "ao-poison", caseType: "Poison Case", mode: "FLAT", value: 1200, active: true },
          { id: "ao-lscs", caseType: "LSCS / Maternity", mode: "FLAT", value: 1500, active: true }
        ],
        active: true,
        createdAt: hoursAgo(720)
      },
      {
        id: "amb-2",
        name: "Bode Barsain Red Cross BLS-02",
        vehicleNumber: "PRA 2-01-001 CHA 4419",
        vehicleType: "BLS Ambulance",
        driverName: "Santosh Yadav",
        driverPhone: "+977-9815722334",
        defaultCommissionMode: "PERCENT",
        defaultCommissionValue: 10,
        caseOverrides: [
          { id: "ao2-rta", caseType: "RTA Case", mode: "PERCENT", value: 10, active: true },
          { id: "ao2-poison", caseType: "Poison Case", mode: "FLAT", value: 1e3, active: true }
        ],
        active: true,
        createdAt: hoursAgo(720)
      }
    ]
  };
  const existingMedBrands = new Set(seededDb.pharmacyMedicines.map((m) => m.brandName.toLowerCase()));
  const existingMedCodes = new Set(seededDb.pharmacyMedicines.map((m) => m.code.toLowerCase()));
  const futureExp = daysFromNow(540);
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  for (const item of NEPAL_PHARMACY_CATALOG) {
    if (existingMedCodes.has(item.code.toLowerCase()) || existingMedBrands.has(item.brandName.toLowerCase())) {
      continue;
    }
    const medId = `med-np-${item.code.toLowerCase()}`;
    seededDb.pharmacyMedicines.push({
      id: medId,
      code: item.code,
      brandName: item.brandName,
      genericName: item.genericName,
      dosageForm: item.dosageForm,
      strength: item.strength,
      manufacturer: item.manufacturer,
      category: item.dosageForm === "IV Fluid" ? "IV Fluid" : item.dosageForm === "Surgical" || item.dosageForm === "Consumable" ? "Surgical / Inside Consumable" : "Nepal Pharma Formulary",
      scheduleType: item.dosageForm === "Surgical" || item.dosageForm === "Consumable" || item.dosageForm === "IV Fluid" ? "OTC" : "Schedule H (Rx)",
      rackLocation: item.rackLocation,
      unitLabel: item.unitLabel,
      vatApplicable: item.vatApplicable,
      reorderLevel: item.reorderLevel,
      defaultMrpNpr: item.defaultMrpNpr,
      active: true
    });
    if (item.initialBatchQty > 0) {
      seededDb.pharmacyBatches.push({
        id: `pbat-np-${item.code.toLowerCase()}`,
        medicineId: medId,
        centerId: null,
        centerName: "Saptari Hospital Central Pharmacy",
        batchNumber: `NP-${item.code.replace(/[^A-Z0-9]/gi, "").slice(-5)}`,
        mfgDate: "2026-01-15",
        expiryDate: futureExp,
        quantityReceived: item.initialBatchQty,
        quantityOnHand: item.initialBatchQty,
        purchaseRateNpr: item.purchaseRateNpr,
        mrpNpr: item.defaultMrpNpr,
        supplierName: item.manufacturer,
        grnNumber: "GRN-NEPAL-INIT",
        receivedAt: nowIso
      });
    }
  }
  const existingSrvCodes = new Set(seededDb.services.map((s) => s.code.toUpperCase()));
  for (const srv of NEPAL_HOSPITAL_SERVICES_CATALOG) {
    if (existingSrvCodes.has(srv.code.toUpperCase())) continue;
    seededDb.services.push({
      id: `srv-np-${srv.code.toLowerCase()}`,
      code: srv.code,
      name: srv.name,
      serviceCategory: srv.serviceCategory,
      customCategory: srv.customCategory,
      modality: srv.modality,
      allowCustomRateAtBilling: true,
      department: srv.department,
      specimenType: srv.specimenType,
      containerType: srv.containerType,
      methodology: srv.methodology,
      tatMinutes: srv.tatMinutes,
      price: srv.price,
      active: true,
      parameters: [
        {
          id: `p-${srv.code.toLowerCase()}-1`,
          name: `${srv.name} Findings`,
          resultType: "QUALITATIVE",
          unit: "",
          refMinMale: 0,
          refMaxMale: 0,
          refMinFemale: 0,
          refMaxFemale: 0,
          decimalPlaces: 0
        }
      ],
      reagentBom: [],
      interpretations: {
        normal: "No significant abnormality detected.",
        abnormalLow: "Correlate clinically.",
        abnormalHigh: "Abnormal finding observed; specialist correlation advised.",
        critical: "Urgent clinical attention recommended.",
        methodologyNote: srv.methodology
      }
    });
  }
  for (const labSrv of NEPAL_LAB_TESTS_CATALOG) {
    if (existingSrvCodes.has(labSrv.code.toUpperCase())) continue;
    seededDb.services.push(JSON.parse(JSON.stringify(labSrv)));
    existingSrvCodes.add(labSrv.code.toUpperCase());
  }
  seededDb.services = seededDb.services.map(ensureAnalyzerCodesOnService);
  seededDb.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
  seededDb.analyzerQueue = [];
  return seededDb;
}

// src/utils/clinical.ts
function getRefRange(param, gender) {
  if (param.resultType === "QUALITATIVE") {
    const normals = param.normalQualitativeValues && param.normalQualitativeValues.length > 0 ? param.normalQualitativeValues : [param.qualitativeOptions?.[0] || "Negative"];
    return {
      min: 0,
      max: 0,
      display: normals.join(" / ")
    };
  }
  const min = gender === "Female" ? param.refMinFemale : param.refMinMale;
  const max = gender === "Female" ? param.refMaxFemale : param.refMaxMale;
  const dp = param.decimalPlaces ?? 1;
  return {
    min,
    max,
    display: `${min.toFixed(dp)} - ${max.toFixed(dp)}`
  };
}
function evaluateParameterFlag(value, param, gender) {
  if (param.resultType === "QUALITATIVE") {
    if (value === null || value === void 0 || String(value).trim() === "") return "NORMAL";
    const strVal = String(value).trim().toLowerCase();
    if (param.criticalQualitativeValues && param.criticalQualitativeValues.some((c) => c.trim().toLowerCase() === strVal)) {
      return "CRITICAL";
    }
    const normals = param.normalQualitativeValues && param.normalQualitativeValues.length > 0 ? param.normalQualitativeValues : [param.qualitativeOptions?.[0] || "Negative"];
    if (normals.some((n) => n.trim().toLowerCase() === strVal)) {
      return "NORMAL";
    }
    return "ABNORMAL";
  }
  if (value === null || value === void 0 || value === "") return "NORMAL";
  const numVal = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(numVal)) return "NORMAL";
  if (param.criticalLow !== void 0 && numVal <= param.criticalLow) return "CRITICAL_LOW";
  if (param.criticalHigh !== void 0 && numVal >= param.criticalHigh) return "CRITICAL_HIGH";
  const { min, max } = getRefRange(param, gender);
  if (numVal < min) return "LOW";
  if (numVal > max) return "HIGH";
  return "NORMAL";
}
function generateClinicalInterpretation(service, results) {
  const entered = results.filter(
    (r) => r.value !== null && r.value !== void 0 && String(r.value).trim() !== ""
  );
  if (entered.length === 0) return "";
  const criticals = entered.filter(
    (r) => r.flag === "CRITICAL_LOW" || r.flag === "CRITICAL_HIGH" || r.flag === "CRITICAL" || r.flag === "HIGH_RISK"
  );
  const lows = entered.filter((r) => r.flag === "LOW");
  const highs = entered.filter((r) => r.flag === "HIGH");
  const abnormals = entered.filter((r) => r.flag === "ABNORMAL");
  if (criticals.length > 0) {
    const list = criticals.map((r) => {
      const unitPart = r.unit && r.unit !== "-" ? ` ${r.unit}` : "";
      const lbl = r.flag === "CRITICAL_LOW" ? "Critical Low" : r.flag === "CRITICAL_HIGH" ? "Critical High" : r.flag === "HIGH_RISK" ? "High Risk" : "Critical";
      return `${r.parameterName}: ${r.value}${unitPart} (${lbl})`;
    }).join("; ");
    return `${service.interpretations.critical} Flagged analytes: ${list}.`;
  }
  if (abnormals.length > 0 || highs.length > 0 || lows.length > 0) {
    const parts = [];
    if (abnormals.length > 0) {
      parts.push(
        `Positive/Abnormal qualitative finding(s): ${abnormals.map((r) => `${r.parameterName}: ${r.value}`).join(", ")}`
      );
    }
    if (highs.length > 0) {
      parts.push(
        `Elevated: ${highs.map((r) => `${r.parameterName} (${r.value} ${r.unit})`).join(", ")}`
      );
    }
    if (lows.length > 0) {
      parts.push(
        `Decreased: ${lows.map((r) => `${r.parameterName} (${r.value} ${r.unit})`).join(", ")}`
      );
    }
    const baseNote = highs.length > 0 || abnormals.length > 0 ? service.interpretations.abnormalHigh : service.interpretations.abnormalLow;
    return `${parts.join("; ")}. ${baseNote}`;
  }
  return service.interpretations.normal;
}
function parseArithmeticExpression(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ("+-*/()".includes(ch)) {
      tokens.push(ch);
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let numStr = "";
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
  const parseExpr = () => {
    let left = parseTerm();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };
  const parseTerm = () => {
    let left = parseFactor();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parseFactor();
      if (right === null) return null;
      if (op === "/") {
        if (right === 0) return null;
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  };
  const parseFactor = () => {
    const t = peek();
    if (!t) return null;
    if (t === "+") {
      consume();
      return parseFactor();
    }
    if (t === "-") {
      consume();
      const inner = parseFactor();
      return inner === null ? null : -inner;
    }
    if (t === "(") {
      consume();
      const inner = parseExpr();
      if (peek() !== ")") return null;
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
function evaluateParameterFormulas(parameters, rawValues) {
  const next = { ...rawValues };
  const resolveTokenValue = (token) => {
    const trimmed = token.trim();
    const direct = next[trimmed];
    if (direct !== void 0 && direct !== null && direct !== "" && !Number.isNaN(Number(direct))) {
      return Number(direct);
    }
    const lower = trimmed.toLowerCase();
    const matchedParam = parameters.find(
      (p) => p.id.toLowerCase() === lower || p.name.toLowerCase() === lower || p.id.toLowerCase().replace(/^p-/, "") === lower
    );
    if (matchedParam) {
      const val = next[matchedParam.id];
      if (val !== void 0 && val !== null && val !== "" && !Number.isNaN(Number(val))) {
        return Number(val);
      }
    }
    return null;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (const p of parameters) {
      if (!p.formula || !p.formula.trim()) continue;
      let missingDep = false;
      const expanded = p.formula.replace(/\{([^}]+)\}/g, (_m, tok) => {
        const num = resolveTokenValue(tok);
        if (num === null) {
          missingDep = true;
          return "NaN";
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
function calculateAutoBedDays(admittedAt, endAt, cycleStart = "07:00", _cycleEnd = "19:00", scheduleMode = "CYCLE_WINDOW") {
  const admDate = new Date(admittedAt);
  const endDate = endAt ? new Date(endAt) : /* @__PURE__ */ new Date();
  const admMs = admDate.getTime();
  const endMs = endDate.getTime();
  if (!Number.isFinite(admMs) || !Number.isFinite(endMs) || endMs <= admMs) {
    return 1;
  }
  if (scheduleMode === "24H_ELAPSED") {
    const hours = (endMs - admMs) / (3600 * 1e3);
    return Math.max(1, Math.ceil(hours / 24));
  }
  if (scheduleMode === "MIDNIGHT_CALENDAR") {
    const d1 = new Date(admDate.getFullYear(), admDate.getMonth(), admDate.getDate()).getTime();
    const d2 = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
    const diffDays = Math.round((d2 - d1) / (24 * 3600 * 1e3)) + 1;
    return Math.max(1, diffDays);
  }
  const [hStr, mStr] = (cycleStart || "07:00").split(":");
  const cycleHour = Math.min(23, Math.max(0, Number(hStr) || 7));
  const cycleMin = Math.min(59, Math.max(0, Number(mStr) || 0));
  const boundary = new Date(admMs);
  boundary.setHours(cycleHour, cycleMin, 0, 0);
  while (boundary.getTime() <= admMs) {
    boundary.setDate(boundary.getDate() + 1);
  }
  if (boundary.getTime() - admMs < 4 * 3600 * 1e3) {
    boundary.setDate(boundary.getDate() + 1);
  }
  let days = 1;
  while (boundary.getTime() <= endMs && days < 3650) {
    days += 1;
    boundary.setDate(boundary.getDate() + 1);
  }
  return Math.max(1, days);
}
function computeIpdDailyAutoCharges(adm, ms, endAtIso, overrides) {
  const cycleStart = ms?.ipdBedCycleStartTime || "07:00";
  const cycleEnd = ms?.ipdBedCycleEndTime || "19:00";
  const bedScheduleMode = ms?.ipdBedChargeScheduleMode || "CYCLE_WINDOW";
  const cycleWindowLabel = bedScheduleMode === "24H_ELAPSED" ? `24h Exact (${cycleStart} ref)` : bedScheduleMode === "MIDNIGHT_CALENDAR" ? "Calendar Midnight (00:00)" : `${cycleStart} - ${cycleEnd}`;
  const effectiveEndIso = endAtIso || adm.dischargedAt || (/* @__PURE__ */ new Date()).toISOString();
  const autoDays = calculateAutoBedDays(adm.admittedAt, effectiveEndIso, cycleStart, cycleEnd, bedScheduleMode);
  const isActive = adm.disposition === "Admitted";
  const doctorRoundBasis = ms?.ipdDoctorRoundBasis || "PER_ROUND";
  const doctorRoundsPerDay = Math.max(1, Number(ms?.ipdDoctorRoundsPerDay) || 1);
  const doctorRoundScheduleLabel = ms?.ipdDoctorRoundScheduleTimes?.trim() || "09:00, 18:00";
  const nursingBasis = ms?.ipdNursingChargeBasis || "PER_DAY";
  const nursingRoundsPerDay = Math.max(1, Number(ms?.ipdNursingRoundsPerDay) || 1);
  const nursingScheduleLabel = ms?.ipdNursingScheduleTimes?.trim() || "07:00, 14:00, 21:00";
  const observationBasis = ms?.ipdObservationChargeBasis || "PER_DAY";
  const observationRoundsPerDay = Math.max(1, Number(ms?.ipdObservationRoundsPerDay) || 1);
  const observationScheduleLabel = ms?.ipdObservationScheduleTimes?.trim() || "08:00, 20:00";
  const defaultDoctorUnits = doctorRoundBasis === "PER_ROUND" ? autoDays * doctorRoundsPerDay : autoDays;
  const defaultNursingUnits = nursingBasis === "PER_ROUND" ? autoDays * nursingRoundsPerDay : autoDays;
  const defaultObsUnits = observationBasis === "PER_ROUND" ? autoDays * observationRoundsPerDay : autoDays;
  const bedDaysBilled = Math.max(
    1,
    overrides?.bedDaysBilled !== void 0 ? overrides.bedDaysBilled : isActive ? autoDays : adm.bedDaysBilled || autoDays
  );
  const doctorRoundsCount = Math.max(
    0,
    overrides?.doctorRoundsCount !== void 0 ? overrides.doctorRoundsCount : isActive ? defaultDoctorUnits : adm.doctorRoundsCount ?? defaultDoctorUnits
  );
  const nursingDaysBilled = Math.max(
    0,
    overrides?.nursingDaysBilled !== void 0 ? overrides.nursingDaysBilled : isActive ? defaultNursingUnits : adm.nursingDaysBilled ?? defaultNursingUnits
  );
  const observationDaysBilled = Math.max(
    0,
    overrides?.observationDaysBilled !== void 0 ? overrides.observationDaysBilled : isActive ? defaultObsUnits : adm.autoObservationDaysBilled ?? defaultObsUnits
  );
  const bedDailyRateNpr = Number(adm.bedDailyRateNpr) || 0;
  const doctorRoundFeeNpr = ms?.ipdDoctorRoundFeeNpr !== void 0 ? Number(ms.ipdDoctorRoundFeeNpr) : Number(adm.doctorRoundFeeNpr ?? 500);
  const nursingChargePerDayNpr = ms?.ipdNursingChargePerDayNpr !== void 0 ? Number(ms.ipdNursingChargePerDayNpr) : Number(adm.nursingChargePerDayNpr ?? 400);
  const observationFeePerDayNpr = ms?.ipdDailyObservationFeeNpr !== void 0 ? Number(ms.ipdDailyObservationFeeNpr) : Number(adm.autoObservationFeePerDayNpr ?? 300);
  const bedChargesNpr = Number((bedDaysBilled * bedDailyRateNpr).toFixed(2));
  const doctorRoundChargesNpr = Number((doctorRoundsCount * doctorRoundFeeNpr).toFixed(2));
  const nursingChargesNpr = Number((nursingDaysBilled * nursingChargePerDayNpr).toFixed(2));
  const autoObservationChargesNpr = Number((observationDaysBilled * observationFeePerDayNpr).toFixed(2));
  const shiftObservationChargesNpr = Number(
    (adm.nursingObservationFees || []).reduce((sum, item) => sum + (Number(item.feeNpr) || 0), 0).toFixed(2)
  );
  const directProcedureChargesNpr = Number(
    (adm.directServiceCharges || []).reduce((sum, item) => sum + (Number(item.amountNpr) || 0), 0).toFixed(2)
  );
  const individualCashPaidTotalNpr = Number(
    (adm.ipdIndividualBills || []).reduce((sum, b) => sum + (Number(b.amountNpr) || 0), 0).toFixed(2)
  );
  const admissionFeeNpr = Number(adm.admissionFeeNpr) || 0;
  const [hStr, mStr] = (cycleStart || "07:00").split(":");
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
  if (bedScheduleMode === "CYCLE_WINDOW" && firstBoundary.getTime() - safeAdmMs < 4 * 3600 * 1e3) {
    firstBoundary.setDate(firstBoundary.getDate() + 1);
  }
  const totalScheduleRows = Math.max(1, bedDaysBilled);
  const dailyBreakdown = [];
  let cursorStartMs = safeAdmMs;
  let cursorBoundaryMs = firstBoundary.getTime();
  const nursingDayCharge = nursingChargesNpr / totalScheduleRows;
  const obsDayCharge = autoObservationChargesNpr / totalScheduleRows;
  const drDayCharge = doctorRoundChargesNpr / totalScheduleRows;
  for (let i = 1; i <= totalScheduleRows; i++) {
    const isLast = i === totalScheduleRows;
    const sliceEndMs = isLast ? Math.max(cursorStartMs, safeEndMs) : Math.min(cursorBoundaryMs, safeEndMs);
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
      daySubtotalNpr: Number((bFee + nFee + oFee + dFee).toFixed(2))
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
    dailyBreakdown
  };
}

// server/analyzerBridge.ts
var CODE_ALIASES = {
  HGB: ["HB", "HEMOGLOBIN", "HGB"],
  WBC: ["TLC", "WBC", "TOTALWBC"],
  PLT: ["PLATELET", "PLT"],
  RBC: ["RBC", "TRBC"],
  HCT: ["PCV", "HCT", "HEMATOCRIT"],
  TBIL: ["TBIL", "BIL_T", "TOTALBILIRUBIN"],
  DBIL: ["DBIL", "BIL_D", "DIRECTBILIRUBIN"],
  AST: ["SGOT", "AST"],
  ALT: ["SGPT", "ALT"],
  ALP: ["ALKP", "ALP"],
  TP: ["TPROT", "TP", "TOTALPROTEIN"],
  ALB: ["ALB", "ALBUMIN"],
  CHOL: ["TC", "CHOL", "CHOLESTEROL"],
  HDL: ["HDLC", "HDL"],
  TRIG: ["TG", "TRIG", "TRIGLYCERIDES"],
  CREA: ["CREAT", "CREA", "CR", "SCR"],
  BUN: ["BUN"],
  UREA: ["UREA"],
  URIC: ["UA", "URIC", "URICACID"],
  GLU_F: ["FBS", "GLU", "GLUC", "GLU_F"],
  GLU_PP: ["PPBS", "GLU", "GLUC", "GLU_PP"],
  GLU_R: ["RBS", "GLU", "GLUC", "GLU_R"],
  TSH: ["TSH", "USTSH"],
  FT3: ["FT3"],
  FT4: ["FT4"],
  TT3: ["T3", "TT3"],
  TT4: ["T4", "TT4"],
  HBA1C: ["A1C", "HBA1C"],
  NA: ["NA", "SODIUM"],
  K: ["K", "POTASSIUM"],
  CL: ["CL", "CHLORIDE"],
  ICA: ["ICA", "CA_ION"],
  CA: ["CA", "CALCIUM"],
  PHOS: ["PHOS", "PO4", "PHOSPHORUS"],
  MG: ["MG", "MAGNESIUM"],
  CRP: ["CRP", "HSCRP"],
  TROPI: ["TROPI", "CTNI", "TROP_I"],
  PT: ["PT", "PROTHROMBIN"],
  APTT: ["APTT", "PTT"],
  VITD: ["VITD", "25OHD"],
  VITB12: ["B12", "VITB12"],
  FERR: ["FERR", "FERRITIN"]
};
function normCode(raw) {
  return raw.toUpperCase().replace(/[^A-Z0-9_]/g, "");
}
function matchReadingToParam(param, readingCode) {
  const target = normCode(readingCode);
  if (!target) return false;
  if (param.analyzerCode && normCode(param.analyzerCode) === target) return true;
  if (normCode(param.id) === target || normCode(param.id.replace(/^p-/, "")) === target) return true;
  if (normCode(param.name) === target) return true;
  if (param.analyzerCode) {
    const canon = normCode(param.analyzerCode);
    const aliases = CODE_ALIASES[canon] || [];
    if (aliases.some((a) => normCode(a) === target)) return true;
  }
  return false;
}
function parseAnalyzerPayload(input) {
  let accessionNumber = (input.accessionNumber || "").trim();
  const readings = Array.isArray(input.readings) ? input.readings.filter((r) => r && r.code && r.value !== void 0 && r.value !== "") : [];
  if (input.values && typeof input.values === "object") {
    for (const [k, v] of Object.entries(input.values)) {
      if (v !== void 0 && v !== null && String(v).trim() !== "") {
        readings.push({ code: k, value: v });
      }
    }
  }
  const raw = (input.rawPayload || "").trim();
  if (!raw) {
    return { accessionNumber, protocol: "HTTP_REST", readings };
  }
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      return parseAnalyzerPayload({
        accessionNumber: parsed.accessionNumber || parsed.accession || accessionNumber,
        readings: Array.isArray(parsed.readings) ? parsed.readings : void 0,
        values: parsed.values && typeof parsed.values === "object" ? parsed.values : void 0
      });
    } catch {
    }
  }
  const lines = raw.split(/\r?\n|\x0b|\x1c|\x0d/).map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => l.startsWith("MSH|") || l.startsWith("OBR|") || l.startsWith("OBX|"))) {
    for (const line of lines) {
      const fields = line.split("|");
      const seg = fields[0];
      if (seg === "OBR") {
        const cand = (fields[2] || fields[3] || "").split("^")[0]?.trim();
        if (cand && !accessionNumber) accessionNumber = cand;
      } else if (seg === "PID" && !accessionNumber) {
        const pidCand = (fields[3] || fields[2] || "").split("^")[0]?.trim();
        if (pidCand && pidCand.toUpperCase().includes("SH-")) accessionNumber = pidCand;
      } else if (seg === "OBX") {
        const obxCode = (fields[3] || "").split("^")[0]?.trim() || (fields[3] || "").split("^")[1]?.trim();
        const obxValRaw = (fields[5] || "").trim();
        const obxUnit = (fields[6] || "").trim();
        const obxFlag = (fields[8] || "").trim();
        if (obxCode && obxValRaw !== "") {
          const numVal = Number(obxValRaw);
          readings.push({
            code: obxCode,
            value: Number.isNaN(numVal) ? obxValRaw : numVal,
            unit: obxUnit || void 0,
            rawFlag: obxFlag || void 0
          });
        }
      }
    }
    return { accessionNumber, protocol: "HL7_V2", readings };
  }
  if (lines.some((l) => l.startsWith("H|") || l.startsWith("O|") || l.startsWith("R|"))) {
    for (const line of lines) {
      const fields = line.split("|");
      const seg = fields[0];
      if (seg === "O") {
        const cand = (fields[2] || fields[3] || "").split("^")[0]?.trim();
        if (cand && !accessionNumber) accessionNumber = cand;
      } else if (seg === "R") {
        const compParts = (fields[2] || "").split("^").map((s) => s.trim()).filter(Boolean);
        const code = compParts[compParts.length - 1] || compParts[0] || "";
        const valRaw = (fields[3] || "").trim();
        const unit = (fields[4] || "").trim();
        const rawFlag = (fields[6] || "").trim();
        if (code && valRaw !== "") {
          const numVal = Number(valRaw);
          readings.push({
            code,
            value: Number.isNaN(numVal) ? valRaw : numVal,
            unit: unit || void 0,
            rawFlag: rawFlag || void 0
          });
        }
      }
    }
    return { accessionNumber, protocol: "ASTM_E1394", readings };
  }
  for (const line of lines) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*[:=]\s*(.+)$/);
    if (match) {
      const key = match[1].trim();
      const val = match[2].trim();
      if (key.toUpperCase() === "ACC" || key.toUpperCase() === "ACCESSION") {
        if (!accessionNumber) accessionNumber = val;
      } else {
        const numVal = Number(val);
        readings.push({ code: key, value: Number.isNaN(numVal) ? val : numVal });
      }
    }
  }
  return { accessionNumber, protocol: "SERIAL_RS232", readings };
}
function deterministicUnitSeed(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1e3 / 1e3;
}
function buildAnalyzerReadingsForOrder(order, services) {
  const readings = [];
  const seenCodes = /* @__PURE__ */ new Set();
  for (const t of order.tests) {
    if (t.serviceCategory === "RADIOLOGY" || t.department === "Radiology") continue;
    const srv = services.find((s) => s.id === t.serviceId);
    if (!srv || !srv.parameters.length) continue;
    for (const p of srv.parameters) {
      if (p.formula && p.formula.trim()) continue;
      const code = p.analyzerCode || p.id.replace(/^p-/, "").toUpperCase();
      if (seenCodes.has(code)) continue;
      seenCodes.add(code);
      if (p.resultType === "QUALITATIVE") {
        const normalVal = p.normalQualitativeValues?.[0] || p.qualitativeOptions?.[0] || "Negative";
        readings.push({
          code,
          value: normalVal,
          unit: "-",
          rawFlag: "N"
        });
      } else {
        const min = order.patientGender === "Female" ? p.refMinFemale : p.refMinMale;
        const max = order.patientGender === "Female" ? p.refMaxFemale : p.refMaxMale;
        const span = Math.max(0.01, max - min);
        const r = deterministicUnitSeed(`${order.accessionNumber}:${p.id}`);
        const ratio = 0.25 + r * 0.6;
        const val = Number((min + span * ratio).toFixed(p.decimalPlaces ?? 1));
        const flag = evaluateParameterFlag(val, p, order.patientGender);
        readings.push({
          code,
          value: val,
          unit: p.unit,
          rawFlag: flag === "HIGH" ? "H" : flag === "LOW" ? "L" : "N"
        });
      }
    }
  }
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const hl7Lines = [
    `MSH|^~\\&|SHPL_ANALYZER|LAB|SHPL_LIMS|HOSPITAL|${stamp}||ORU^R01|MSG${stamp}|P|2.5`,
    `PID|1||${order.uhid || order.accessionNumber}||${order.patientName.replace(/\s+/g, "^")}`,
    `OBR|1|${order.accessionNumber}|${order.accessionNumber}|LAB_PANEL^Hospital Automated Bench`,
    ...readings.map(
      (r, idx) => `OBX|${idx + 1}|${typeof r.value === "number" ? "NM" : "ST"}|${r.code}^${r.code}||${r.value}|${r.unit || ""}|||${r.rawFlag || "N"}|||F`
    )
  ];
  return {
    readings,
    hl7Frame: hl7Lines.join("\n")
  };
}
function applyReadingsToOrder(db, order, readings) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let appliedCount = 0;
  let hasCritical = false;
  const updatedTests = [];
  const wasValidatedOrDispatched = order.status === "Validated" || order.status === "Dispatched";
  if (wasValidatedOrDispatched) {
    return { appliedCount: 0, updatedTests: [], hasCritical: false };
  }
  for (const orderTest of order.tests) {
    if (orderTest.serviceCategory === "RADIOLOGY" || orderTest.department === "Radiology") {
      continue;
    }
    const service = db.services.find((s) => s.id === orderTest.serviceId);
    if (!service || !service.parameters.length) continue;
    const valMap = {};
    for (const pr of orderTest.parameterResults) {
      valMap[pr.parameterId] = pr.value;
    }
    let testTouched = false;
    for (const p of service.parameters) {
      if (p.formula && p.formula.trim()) continue;
      const hit = readings.find((r) => matchReadingToParam(p, r.code));
      if (!hit) continue;
      const isQual = p.resultType === "QUALITATIVE";
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
      const isQual = (paramDef?.resultType || pr.resultType) === "QUALITATIVE";
      const rawVal = computedValues[pr.parameterId];
      const parsedVal = isQual ? rawVal === null || rawVal === void 0 || String(rawVal).trim() === "" ? null : String(rawVal).trim() : rawVal === null || rawVal === void 0 || rawVal === "" || Number.isNaN(Number(rawVal)) ? null : Number(rawVal);
      const flag = paramDef ? evaluateParameterFlag(parsedVal, paramDef, order.patientGender) : "NORMAL";
      if (flag === "CRITICAL_HIGH" || flag === "CRITICAL_LOW" || flag === "CRITICAL" || flag === "HIGH_RISK") {
        hasCritical = true;
      }
      return {
        ...pr,
        resultType: isQual ? "QUALITATIVE" : "NUMERIC",
        value: parsedVal,
        flag
      };
    });
    orderTest.interpretation = generateClinicalInterpretation(service, orderTest.parameterResults);
    const allFilled = orderTest.parameterResults.every(
      (p) => p.value !== null && String(p.value).trim() !== ""
    );
    if (allFilled) {
      orderTest.status = "Resulted";
    }
    updatedTests.push(orderTest.serviceCode);
  }
  if (appliedCount > 0) {
    if (!order.collectedAt) order.collectedAt = now;
    if (!order.receivedInLabAt) order.receivedInLabAt = now;
    if (order.tests.every((t) => t.status === "Resulted" || t.status === "Validated")) {
      order.status = "Resulted";
      order.resultedAt = now;
    } else if (order.status === "Ordered" || order.status === "Collected") {
      order.status = "In Lab";
    }
  }
  return { appliedCount, updatedTests, hasCritical };
}

// server/store.ts
import fs from "fs";
import path from "path";
var DATA_DIR = path.resolve(process.cwd(), "data");
var DB_FILE = path.join(DATA_DIR, "lims-db.json");
var dbCache = null;
function hydrateDbSchema(db) {
  const seed = createSeedDatabase();
  db.centers = [];
  db.centerAwards = [];
  db.riders = [];
  db.riderTasks = [];
  if (db.saas && Array.isArray(db.saas.modules)) {
    db.saas.modules = db.saas.modules.filter(
      (m) => m.key !== "collection_centers" && m.key !== "collection_riders"
    );
    const seedModules = seed.saas?.modules || [];
    for (const sm of seedModules) {
      if (!db.saas.modules.some((m) => m.key === sm.key)) {
        db.saas.modules.push(sm);
      }
    }
  }
  if (Array.isArray(db.tenants)) {
    db.tenants = db.tenants.map(
      (t) => t.id === "tnt-1" && !t.enabledModules.includes("ot_management") ? { ...t, enabledModules: [...t.enabledModules, "ot_management"] } : t
    );
  }
  const removedCenterStaffIds = /* @__PURE__ */ new Set(["staff-ctr-1", "staff-ctr-2", "staff-ctr-3"]);
  db.staff = (db.staff || []).filter((s) => !removedCenterStaffIds.has(s.id)).map((s) => ({
    ...s,
    assignedCenterId: null,
    assignedCenterName: s.assignedCenterName?.includes("Hub") ? "Saptari Hospital Main" : s.assignedCenterName
  }));
  db.roles = (db.roles || []).map((r) => {
    const isAdminRole = r.id === "SUPER_ADMIN" || r.id === "SAAS_ADMIN";
    if (r.id === "LAB_TECH") {
      return {
        ...r,
        description: "Strict laboratory bench role: sample collection, analyzer result entry, clinical result validation, and diagnostic report printing.",
        permissions: [...LAB_TECH_STRICT_PERMISSIONS]
      };
    }
    const basePerms = r.permissions.filter(
      (p) => p !== "centers.view" && p !== "centers.manage" && p !== "centers.credit_override" && p !== "awards.manage" && p !== "riders.view" && p !== "riders.manage" && (isAdminRole || p !== "settings.manage")
    );
    const extraOtPerms = isAdminRole || r.id === "LAB_DIRECTOR" || r.id === "DOCTOR" ? ["ot.view", "ot.manage", "ot.anesthesia"] : r.id === "NURSE" ? ["ot.view", "ot.manage"] : r.id === "CENTER_MANAGER" ? ["ot.view"] : [];
    const mergedPerms = Array.from(/* @__PURE__ */ new Set([...basePerms, ...extraOtPerms]));
    return {
      ...r,
      name: r.id === "CENTER_MANAGER" ? "Hospital Front Desk, Billing & Darta Manager" : r.name,
      permissions: mergedPerms
    };
  });
  if (!db.roles.some((r) => r.id === "BILLING_REPORT")) {
    db.roles.push({
      id: "BILLING_REPORT",
      name: "Billing & Report Operator (POS + Reports Only)",
      description: "Dedicated billing & report desk role: Hospital POS billing, order lookup, detailed diagnostic report print & dispatch only.",
      permissions: [...BILLING_REPORT_STRICT_PERMISSIONS]
    });
  } else {
    db.roles = db.roles.map(
      (r) => r.id === "BILLING_REPORT" ? { ...r, permissions: [...BILLING_REPORT_STRICT_PERMISSIONS] } : r
    );
  }
  if (db.saas) {
    const roleCount = Math.max(12, db.roles.length + 10);
    if ((db.saas.maxRolesCapacity || 0) < roleCount) {
      db.saas.maxRolesCapacity = roleCount;
    }
    if (Array.isArray(db.saas.allowedRoleIds)) {
      for (const r of db.roles) {
        if (!db.saas.allowedRoleIds.includes(r.id)) {
          db.saas.allowedRoleIds.push(r.id);
        }
      }
    }
  }
  if (!db.dashboardLayoutConfigs || typeof db.dashboardLayoutConfigs !== "object") {
    db.dashboardLayoutConfigs = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS };
  } else {
    for (const [roleKey, cfg] of Object.entries(DEFAULT_DASHBOARD_LAYOUT_CONFIGS)) {
      if (!db.dashboardLayoutConfigs[roleKey]) {
        db.dashboardLayoutConfigs[roleKey] = cfg;
      }
    }
    for (const r of db.roles) {
      if (!db.dashboardLayoutConfigs[r.id]) {
        db.dashboardLayoutConfigs[r.id] = {
          roleId: r.id,
          title: `${r.name} \u2014 Workspace`,
          subtitle: r.description || "Custom Hospital Role Dashboard",
          widgets: ["EXECUTIVE_SUMMARY", "PRIORITY_ALERTS", "KPI_GRID", "CLINICAL_OPS", "SHIFT_HANDOVER"]
        };
      }
    }
    db.dashboardLayoutConfigs.LAB_TECH = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS.LAB_TECH };
  }
  if (!Array.isArray(db.pharmacyDeposits)) {
    db.pharmacyDeposits = [];
  }
  const msSeed = seed.settings.moduleSettings;
  if (!db.settings.moduleSettings) {
    db.settings.moduleSettings = { ...msSeed };
  } else {
    const ms = db.settings.moduleSettings;
    if (ms.opdFreeFollowUpDays === void 0) {
      ms.opdFreeFollowUpDays = msSeed.opdFreeFollowUpDays;
    }
    if (ms.opdFollowUpSameDoctorOnly === void 0) {
      ms.opdFollowUpSameDoctorOnly = true;
    }
    if (ms.opdFollowUpWithinWindowFeeNpr === void 0) {
      ms.opdFollowUpWithinWindowFeeNpr = 0;
    }
    if (ms.opdFollowUpFeeAfterExpiryNpr === void 0) {
      ms.opdFollowUpFeeAfterExpiryNpr = msSeed.opdFollowUpFeeAfterExpiryNpr;
    }
    if (!ms.shiftPricing) {
      ms.shiftPricing = msSeed.shiftPricing;
    } else {
      ms.shiftPricing = {
        bed: ms.shiftPricing.bed || msSeed.shiftPricing.bed,
        observation: ms.shiftPricing.observation || msSeed.shiftPricing.observation,
        nursing: ms.shiftPricing.nursing || msSeed.shiftPricing.nursing,
        doctorRound: ms.shiftPricing.doctorRound || msSeed.shiftPricing.doctorRound
      };
    }
    if (!Array.isArray(ms.nursingObservationTypes) || ms.nursingObservationTypes.length === 0) {
      ms.nursingObservationTypes = msSeed.nursingObservationTypes;
    }
    if (!Array.isArray(ms.customServiceCategories) || ms.customServiceCategories.length === 0) {
      ms.customServiceCategories = msSeed.customServiceCategories;
    }
    if (!ms.lanServerHostIp) {
      ms.lanServerHostIp = msSeed.lanServerHostIp;
    }
    if (!Array.isArray(ms.signatureBoxes) || ms.signatureBoxes.length === 0) {
      ms.signatureBoxes = msSeed.signatureBoxes;
    }
    if (!ms.printOptions) {
      ms.printOptions = msSeed.printOptions;
    }
    if (ms.ipdDailyObservationFeeNpr === void 0) {
      ms.ipdDailyObservationFeeNpr = msSeed.ipdDailyObservationFeeNpr;
    }
    if (ms.emergencyDefaultCreditLimitNpr === void 0) {
      ms.emergencyDefaultCreditLimitNpr = msSeed.emergencyDefaultCreditLimitNpr;
    }
    if (!ms.discountApprovalPolicy) {
      ms.discountApprovalPolicy = "MANAGER_THEN_ADMIN";
    }
    if (!ms.creditApprovalPolicy) {
      ms.creditApprovalPolicy = "MANAGER_THEN_ADMIN";
    }
    if (ms.cashierMaxDiscountNpr === void 0) {
      ms.cashierMaxDiscountNpr = 1e3;
    }
    if (ms.showDemoCredentialsOnLogin === void 0) {
      ms.showDemoCredentialsOnLogin = true;
    }
    if (ms.showErFeeFieldsInForm === void 0) {
      ms.showErFeeFieldsInForm = false;
    }
    if (!Array.isArray(ms.referralCaseRules) || ms.referralCaseRules.length === 0) {
      ms.referralCaseRules = msSeed.referralCaseRules;
    }
    if (!Array.isArray(ms.referralBillTierRules) || ms.referralBillTierRules.length === 0) {
      ms.referralBillTierRules = msSeed.referralBillTierRules;
    }
  }
  db.settings.developedBy = "Dr. Santosh Majhi";
  db.settings.labName = db.settings.labName || "Saptari Hospital Pvt Ltd";
  const existingDesignIds = new Set((db.documentDesigns || []).map((d) => d.id));
  db.documentDesigns = (db.documentDesigns || []).filter((d) => !d.centerId);
  for (const tpl of seed.documentDesigns) {
    if (!existingDesignIds.has(tpl.id)) {
      db.documentDesigns.push(tpl);
    }
  }
  for (const seedSrv of seed.services) {
    const match = (db.services || []).find((s) => s.id === seedSrv.id);
    if (!match) {
      db.services.push(seedSrv);
    } else {
      if (!match.customCategory && seedSrv.customCategory) {
        match.customCategory = seedSrv.customCategory;
      }
      if (!match.serviceCategory && seedSrv.serviceCategory) {
        match.serviceCategory = seedSrv.serviceCategory;
      }
      for (const sp of seedSrv.parameters) {
        const ep = match.parameters.find((p) => p.id === sp.id);
        if (!ep && sp.isCalculated) {
          match.parameters.push(sp);
        } else if (ep && sp.formula && !ep.formula) {
          ep.formula = sp.formula;
          ep.isCalculated = sp.isCalculated;
        }
      }
    }
  }
  if (!db.services.some((s) => s.id === "srv-lab-elec")) {
    const existingCodes = new Set(db.services.map((s) => s.code.toUpperCase()));
    for (const labSrv of NEPAL_LAB_TESTS_CATALOG) {
      if (!existingCodes.has(labSrv.code.toUpperCase())) {
        db.services.push(JSON.parse(JSON.stringify(labSrv)));
        existingCodes.add(labSrv.code.toUpperCase());
      }
    }
  }
  db.services = (db.services || []).map(ensureAnalyzerCodesOnService);
  if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
    db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
  }
  if (!Array.isArray(db.analyzerQueue)) {
    db.analyzerQueue = [];
  }
  const existingMedIds = new Set((db.pharmacyMedicines || []).map((m) => m.id));
  for (const sm of seed.pharmacyMedicines) {
    if (!existingMedIds.has(sm.id)) db.pharmacyMedicines.push(sm);
  }
  const existingBatchIds = new Set((db.pharmacyBatches || []).map((b) => b.id));
  for (const sb of seed.pharmacyBatches) {
    if (!existingBatchIds.has(sb.id)) db.pharmacyBatches.push(sb);
  }
  if (!Array.isArray(db.pharmacySuppliers) || db.pharmacySuppliers.length === 0) {
    db.pharmacySuppliers = seed.pharmacySuppliers ? [...seed.pharmacySuppliers] : [];
  }
  if (!Array.isArray(db.pharmacyManufacturers) || db.pharmacyManufacturers.length === 0) {
    db.pharmacyManufacturers = seed.pharmacyManufacturers ? [...seed.pharmacyManufacturers] : [];
  }
  if (!Array.isArray(db.hospitalAssets)) {
    db.hospitalAssets = seed.hospitalAssets ? [...seed.hospitalAssets] : [];
  }
  if (!Array.isArray(db.discountCreditApprovals)) {
    db.discountCreditApprovals = [];
  }
  if (!Array.isArray(db.appointments)) {
    db.appointments = [];
  }
  if (!Array.isArray(db.hrCertificates)) {
    db.hrCertificates = [];
  }
  if (!Array.isArray(db.referredHospitalsMaster) || db.referredHospitalsMaster.length === 0) {
    db.referredHospitalsMaster = seed.referredHospitalsMaster ? [...seed.referredHospitalsMaster] : [];
  }
  if (!Array.isArray(db.ambulancesMaster) || db.ambulancesMaster.length === 0) {
    db.ambulancesMaster = seed.ambulancesMaster ? [...seed.ambulancesMaster] : [];
  }
  if (!Array.isArray(db.otRooms) || db.otRooms.length === 0) {
    db.otRooms = seed.otRooms ? [...seed.otRooms] : [];
  }
  if (!Array.isArray(db.otCases)) {
    db.otCases = seed.otCases ? [...seed.otCases] : [];
  }
  if (Array.isArray(db.hospitalBeds)) {
    db.hospitalBeds = db.hospitalBeds.map(
      (b) => b.centerId ? { ...b, centerId: null, centerName: "Saptari Hospital Main" } : b
    );
  }
  return db;
}
function getDb() {
  if (dbCache) return dbCache;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.referrals) && Array.isArray(parsed.referralPayoutRequests) && Array.isArray(parsed.accounts) && Array.isArray(parsed.payrollRuns) && Array.isArray(parsed.documentDesigns) && Array.isArray(parsed.radiologyTemplates) && Array.isArray(parsed.securityAlerts) && Array.isArray(parsed.pharmacyMedicines) && Array.isArray(parsed.pharmacyBatches) && Array.isArray(parsed.pharmacyInvoices) && Array.isArray(parsed.hospitalBeds) && Array.isArray(parsed.opdVisits) && Array.isArray(parsed.ipdAdmissions) && Array.isArray(parsed.emergencyCases) && Array.isArray(parsed.dartaChalani) && Array.isArray(parsed.birthCertificates) && Array.isArray(parsed.deathCertificates) && Array.isArray(parsed.dhis2Reports) && Boolean(parsed.settings?.labName?.includes("Saptari Hospital")) && Boolean(parsed.staff?.[0]?.username && parsed.staff?.[0]?.pin) && Boolean(parsed.settings?.moduleSettings) && parsed.saas && Array.isArray(parsed.saas.modules) && Array.isArray(parsed.roles) && Array.isArray(parsed.patients) && Array.isArray(parsed.gatepasses) && Array.isArray(parsed.attendanceLogs) && Array.isArray(parsed.shiftHandovers)) {
        dbCache = hydrateDbSchema(parsed);
        return dbCache;
      }
      console.log("Detected previous schema \u2014 upgrading to Saptari Hospital Pvt Ltd ERP seed.");
    }
  } catch (err) {
    console.error("Failed to read persisted DB, re-seeding:", err);
  }
  dbCache = hydrateDbSchema(createSeedDatabase());
  saveDb(dbCache);
  return dbCache;
}
function getDbFileSizeBytes() {
  try {
    if (fs.existsSync(DB_FILE)) {
      return fs.statSync(DB_FILE).size;
    }
  } catch {
  }
  return dbCache ? Buffer.byteLength(JSON.stringify(dbCache), "utf-8") : 0;
}
function saveDb(db) {
  dbCache = db;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const payload = JSON.stringify(db, null, 2);
  const tmpFile = `${DB_FILE}.tmp`;
  try {
    fs.writeFileSync(tmpFile, payload, "utf-8");
    fs.renameSync(tmpFile, DB_FILE);
  } catch {
    fs.writeFileSync(DB_FILE, payload, "utf-8");
  }
}
var BACKUPS_DIR = path.join(DATA_DIR, "backups");
function listLocalBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  const files = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true }).filter((d) => d.isFile() && d.name.endsWith(".json") && !d.name.endsWith(".tmp"));
  return files.map((f) => {
    const fullPath = path.join(BACKUPS_DIR, f.name);
    const st = fs.statSync(fullPath);
    return {
      filename: f.name,
      sizeBytes: st.size,
      createdAt: st.mtime.toISOString()
    };
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}
function createLocalBackup(prefix = "manual") {
  const db = getDb();
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 32) || "backup";
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filename = `shpl-${safePrefix}-${stamp}.json`;
  const target = path.join(BACKUPS_DIR, filename);
  const payload = JSON.stringify(
    {
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      hospital: db.settings?.labName || "Saptari Hospital Pvt Ltd",
      database: db
    },
    null,
    2
  );
  fs.writeFileSync(target, payload, "utf-8");
  const st = fs.statSync(target);
  const all = listLocalBackups();
  if (all.length > 35) {
    for (const old of all.slice(35)) {
      try {
        fs.unlinkSync(path.join(BACKUPS_DIR, old.filename));
      } catch {
      }
    }
  }
  return {
    filename,
    sizeBytes: st.size,
    createdAt: st.mtime.toISOString()
  };
}
function readLocalBackup(filename) {
  const clean = path.basename(filename);
  if (!clean.endsWith(".json") || clean.includes("..")) {
    throw new Error("Invalid backup filename.");
  }
  const fullPath = path.join(BACKUPS_DIR, clean);
  if (!fs.existsSync(fullPath)) {
    throw new Error("Backup file not found on server disk.");
  }
  return {
    path: fullPath,
    rawText: fs.readFileSync(fullPath, "utf-8")
  };
}
function deleteLocalBackup(filename) {
  const clean = path.basename(filename);
  if (!clean.endsWith(".json") || clean.includes("..")) {
    throw new Error("Invalid backup filename.");
  }
  const fullPath = path.join(BACKUPS_DIR, clean);
  if (!fs.existsSync(fullPath)) {
    throw new Error("Backup file not found.");
  }
  fs.unlinkSync(fullPath);
}
function restoreDbFromSnapshot(candidate) {
  if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.staff) || !Array.isArray(candidate.services) || !candidate.settings) {
    throw new Error("Invalid hospital database backup format.");
  }
  const safetyBackup = createLocalBackup("pre-restore");
  const hydrated = hydrateDbSchema(candidate);
  saveDb(hydrated);
  return { db: hydrated, safetyBackup };
}
function resetDb() {
  dbCache = hydrateDbSchema(createSeedDatabase());
  saveDb(dbCache);
  return dbCache;
}
function getActor(db, actorId) {
  if (actorId) {
    const found = db.staff.find((s) => s.id === actorId);
    if (found) return found;
  }
  return db.staff.find((s) => s.roleId === "SUPER_ADMIN") || db.staff[0];
}
function scopeDbForActor(db, _actor) {
  return {
    ...db,
    centers: [],
    centerAwards: [],
    riders: [],
    riderTasks: []
  };
}
function hasPermission(db, roleId, permission) {
  const role = db.roles.find((r) => r.id === roleId);
  if (!role) return false;
  return role.permissions.includes(permission);
}
function appendAudit(db, actor, module, action, entityId, summary, severity = "INFO") {
  const entry = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.roleId,
    module,
    action,
    entityId,
    summary,
    severity
  };
  db.auditLogs.unshift(entry);
  if (db.auditLogs.length > 500) {
    db.auditLogs = db.auditLogs.slice(0, 500);
  }
}
function appendSecurityAlert(db, alert) {
  const created = {
    ...alert,
    id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (!Array.isArray(db.securityAlerts)) {
    db.securityAlerts = [];
  }
  db.securityAlerts.unshift(created);
  if (db.securityAlerts.length > 200) {
    db.securityAlerts = db.securityAlerts.slice(0, 200);
  }
  return created;
}

// server/zipBuilder.ts
import zlib from "zlib";
var CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 3988292384 ^ c >>> 1 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 4294967295;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 255] ^ c >>> 8;
  }
  return (c ^ 4294967295) >>> 0;
}
function toDosTimeDate(date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  const dosTime = (hours & 31) << 11 | (minutes & 63) << 5 | seconds & 31;
  const dosDate = (year - 1980 & 127) << 9 | (month & 15) << 5 | day & 31;
  return { dosTime, dosDate };
}
function buildZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = toDosTimeDate(/* @__PURE__ */ new Date());
  for (const entry of entries) {
    const cleanName = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const nameBuf = Buffer.from(cleanName, "utf-8");
    const raw = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf-8");
    const compressed = zlib.deflateRawSync(raw, { level: 6 });
    const useStore = compressed.length >= raw.length;
    const method = useStore ? 0 : 8;
    const payload = useStore ? raw : compressed;
    const crc = crc32(raw);
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(67324752, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(2048, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);
    localParts.push(localHeader, payload);
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(33639248, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(2048, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    nameBuf.copy(centralHeader, 46);
    centralParts.push(centralHeader);
    offset += localHeader.length + payload.length;
  }
  const centralDirBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(101010256, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirBuffer, eocd]);
}

// src/utils/textFormat.ts
function normalizeNepalPhone(raw) {
  if (!raw) return "";
  const cleaned = raw.trim();
  if (!cleaned || cleaned === "+977-98" || trimmedEmpty(cleaned)) {
    return "";
  }
  const digitsOnly = cleaned.replace(/[^\d]/g, "");
  if (!digitsOnly) return "";
  if (digitsOnly.startsWith("977") && digitsOnly.length >= 12) {
    return `+977-${digitsOnly.slice(3)}`;
  }
  if (digitsOnly.length === 10 && (digitsOnly.startsWith("9") || digitsOnly.startsWith("0"))) {
    return `+977-${digitsOnly}`;
  }
  if (digitsOnly.length >= 7 && digitsOnly.length <= 10 && !cleaned.startsWith("+")) {
    return `+977-${digitsOnly}`;
  }
  return cleaned.startsWith("+") ? cleaned : `+977-${digitsOnly}`;
}
function trimmedEmpty(cleaned) {
  return cleaned === "+977-98" || cleaned === "+97798" || cleaned === "+977-" || cleaned === "+977";
}

// server.ts
var activeImpersonations = /* @__PURE__ */ new Map();
function isModuleEnabled(db, key) {
  const mod = db.saas?.modules?.find((m) => m.key === key);
  return mod ? mod.enabled : true;
}
function attachEncounterBillingAndClinicalHistory(db, params) {
  const {
    baseReferral,
    patientId,
    uhid,
    patientName,
    patientPhone,
    encounterType,
    encounterId,
    admission,
    erCase,
    opdVisit
  } = params;
  const normPhone = (patientPhone || "").replace(/\D/g, "").slice(-10);
  const normName = (patientName || "").trim().toLowerCase();
  const matchesPatient = (pId, u, eId, pName, pPhone) => {
    if (encounterId && eId && eId === encounterId) return true;
    if (patientId && pId && pId === patientId) return true;
    if (uhid && u && u === uhid) return true;
    const ph = (pPhone || "").replace(/\D/g, "").slice(-10);
    if (normPhone && ph && normPhone === ph && (!pName || pName.trim().toLowerCase() === normName)) {
      return true;
    }
    return false;
  };
  const items = [];
  for (const ord of db.orders || []) {
    if (matchesPatient(ord.patientId, ord.uhid, ord.encounterId, ord.patientName, ord.patientPhone)) {
      const testDesc = (ord.tests || []).map((t) => `${t.serviceCode} ${t.serviceName}`).join(", ");
      items.push({
        id: `att-ord-${ord.id}`,
        source: "POS_ORDER",
        refNumber: ord.invoiceNumber || ord.accessionNumber,
        dateIso: ord.orderedAt,
        description: `Diagnostics / Hospital POS (${ord.accessionNumber}): ${testDesc}`,
        category: ord.tests?.[0]?.serviceCategory || "DIAGNOSTICS",
        qty: ord.tests?.length || 1,
        amountNpr: Number(ord.totalAmount) || 0,
        paymentStatus: ord.dueAmount > 0 ? `Due \u0930\u0942 ${ord.dueAmount}` : `Paid (${ord.paymentMode})`
      });
    }
  }
  for (const inv of db.pharmacyInvoices || []) {
    if (matchesPatient(inv.patientId, inv.uhid, inv.encounterId, inv.patientName, inv.patientPhone)) {
      const medDesc = (inv.lines || []).map((l) => `${l.medicineName} \xD7${l.quantity}`).join(", ");
      items.push({
        id: `att-phm-${inv.id}`,
        source: "PHARMACY",
        refNumber: inv.invoiceNumber,
        dateIso: inv.dispensedAt,
        description: `Pharmacy Medicines: ${medDesc}`,
        category: "PHARMACY",
        qty: (inv.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0),
        amountNpr: Number(inv.totalNpr) || 0,
        paymentStatus: (inv.dueAmountNpr || 0) > 0 ? `Credit Due \u0930\u0942 ${inv.dueAmountNpr || 0}` : `Paid (${inv.paymentMode})`
      });
    }
  }
  if (admission) {
    if (admission.bedChargesNpr > 0) {
      items.push({
        id: `att-ipd-bed-${admission.id}`,
        source: "IPD_CHARGE",
        refNumber: admission.admissionNumber,
        dateIso: admission.admittedAt,
        description: `IPD Ward/Bed Stay (${admission.currentBedLabel}, ${admission.bedDaysBilled || 1} day(s))`,
        category: "BED_STAY",
        qty: admission.bedDaysBilled || 1,
        amountNpr: admission.bedChargesNpr,
        paymentStatus: admission.balanceDueNpr > 0 ? "IPD Ledger" : "Settled"
      });
    }
    for (const chg of admission.directServiceCharges || []) {
      items.push({
        id: `att-ipd-chg-${chg.id}`,
        source: "IPD_CHARGE",
        refNumber: chg.cashBillNumber || admission.admissionNumber,
        dateIso: chg.billedAt,
        description: chg.serviceName,
        category: chg.category,
        qty: 1,
        amountNpr: chg.amountNpr,
        paymentStatus: chg.paymentMode
      });
    }
    for (const m of admission.usedMedicines || []) {
      items.push({
        id: `att-ipd-med-${m.id}`,
        source: "IPD_CHARGE",
        refNumber: admission.admissionNumber,
        dateIso: m.administeredAt,
        description: `Ward Medication: ${m.medicineName} (${m.dosageRoute})`,
        category: "WARD_MEDICINE",
        qty: m.quantity,
        amountNpr: m.totalPriceNpr,
        paymentStatus: "IPD Ledger"
      });
    }
    for (const inv of admission.investigationsDone || []) {
      items.push({
        id: `att-ipd-inv-${inv.id}`,
        source: "IPD_CHARGE",
        refNumber: inv.linkedAccessionNumber || admission.admissionNumber,
        dateIso: inv.orderedAt,
        description: `IPD Investigation: ${inv.serviceCode} ${inv.serviceName}${inv.summaryFinding ? ` \u2014 ${inv.summaryFinding}` : ""}`,
        category: inv.category,
        qty: 1,
        amountNpr: inv.priceNpr,
        paymentStatus: "IPD Ledger"
      });
    }
  }
  if (erCase) {
    const erTotal = (Number(erCase.erTicketFeeNpr) || 0) + (Number(erCase.erChargesNpr) || 0);
    if (erTotal > 0) {
      items.push({
        id: `att-er-${erCase.id}`,
        source: "OPD_ER",
        refNumber: erCase.erNumber,
        dateIso: erCase.registeredAt,
        description: `ER Triage & Emergency Stabilization (${erCase.triageLevel} \xB7 ${erCase.erBedBay})`,
        category: "EMERGENCY",
        qty: 1,
        amountNpr: erTotal,
        paymentStatus: erCase.paymentMode
      });
    }
  }
  if (opdVisit && opdVisit.consultationFeeNpr > 0) {
    items.push({
      id: `att-opd-${opdVisit.id}`,
      source: "OPD_ER",
      refNumber: opdVisit.tokenNumber,
      dateIso: opdVisit.visitDate,
      description: `OPD Consultation (${opdVisit.department} \xB7 ${opdVisit.consultingDoctor})`,
      category: "CONSULTATION",
      qty: 1,
      amountNpr: opdVisit.consultationFeeNpr,
      paymentStatus: opdVisit.paymentMode
    });
  }
  const historyParts = [];
  if (erCase) {
    historyParts.push(
      `ER ${erCase.erNumber} (${erCase.triageLevel}): ${erCase.chiefComplaint}. Vitals: BP ${erCase.vitals?.bp || "\u2014"}, PR ${erCase.vitals?.pulseBpm || "\u2014"}, SpO2 ${erCase.vitals?.spo2Pct || "\u2014"}%. Notes: ${erCase.clinicalNotes || "\u2014"}${erCase.isMlc ? ` | MLC ${erCase.mlcNumber} (${erCase.mlcCaseType})` : ""}`
    );
  }
  if (admission) {
    historyParts.push(
      `IPD ${admission.admissionNumber} (${admission.currentWardName} ${admission.currentBedLabel}): Admitting Dx ${admission.admittingDiagnosis}; Final Dx ${admission.finalDiagnosis || admission.admittingDiagnosis}. Course: ${admission.hospitalCourseSummary || "\u2014"}`
    );
  }
  if (opdVisit) {
    historyParts.push(
      `OPD ${opdVisit.tokenNumber} (${opdVisit.department}): ${opdVisit.chiefComplaint}; Dx: ${opdVisit.provisionalDiagnosis || "\u2014"}`
    );
  }
  const prevVisits = (db.opdVisits || []).filter(
    (v) => v.id !== opdVisit?.id && matchesPatient(v.patientId, v.uhid, void 0, v.patientName, v.patientPhone)
  ).length;
  const prevAdmissions = (db.ipdAdmissions || []).filter(
    (a) => a.id !== admission?.id && matchesPatient(a.patientId, a.uhid, void 0, a.patientName, a.patientPhone)
  ).length;
  if (prevVisits > 0 || prevAdmissions > 0) {
    historyParts.push(`Prior History on Record: ${prevVisits} OPD visit(s), ${prevAdmissions} prior IPD admission(s).`);
  }
  const clinicalTreatmentItems = [];
  for (const ord of db.orders || []) {
    if (matchesPatient(ord.patientId, ord.uhid, ord.encounterId, ord.patientName, ord.patientPhone)) {
      for (const t of ord.tests || []) {
        clinicalTreatmentItems.push({
          id: `clin-ord-${ord.id}-${t.serviceId}`,
          source: "POS_ORDER",
          dateIso: ord.orderedAt,
          category: t.serviceCategory || "DIAGNOSTICS",
          description: `${t.serviceName}${t.interpretation ? ` \u2014 ${t.interpretation}` : ""}`
        });
      }
    }
  }
  for (const inv of db.pharmacyInvoices || []) {
    if (matchesPatient(inv.patientId, inv.uhid, inv.encounterId, inv.patientName, inv.patientPhone)) {
      for (const l of inv.lines || []) {
        clinicalTreatmentItems.push({
          id: `clin-phm-${inv.id}-${l.medicineId}`,
          source: "PHARMACY",
          dateIso: inv.dispensedAt,
          category: "PHARMACY MEDICINE",
          description: l.medicineName
        });
      }
    }
  }
  if (admission) {
    for (const chg of admission.directServiceCharges || []) {
      clinicalTreatmentItems.push({
        id: `clin-ipd-chg-${chg.id}`,
        source: "IPD_CHARGE",
        dateIso: chg.billedAt,
        category: chg.category,
        description: chg.serviceName
      });
    }
    for (const m of admission.usedMedicines || []) {
      clinicalTreatmentItems.push({
        id: `clin-ipd-med-${m.id}`,
        source: "IPD_CHARGE",
        dateIso: m.administeredAt,
        category: "WARD MEDICATION",
        description: `${m.medicineName}${m.dosageRoute ? ` (${m.dosageRoute})` : ""}`
      });
    }
    for (const inv of admission.investigationsDone || []) {
      clinicalTreatmentItems.push({
        id: `clin-ipd-inv-${inv.id}`,
        source: "IPD_CHARGE",
        dateIso: inv.orderedAt,
        category: inv.category,
        description: `${inv.serviceName}${inv.summaryFinding ? ` \u2014 ${inv.summaryFinding}` : ""}`
      });
    }
  }
  if (erCase) {
    clinicalTreatmentItems.push({
      id: `clin-er-${erCase.id}`,
      source: "OPD_ER",
      dateIso: erCase.registeredAt,
      category: "EMERGENCY CARE",
      description: `ER Triage (${erCase.triageLevel}) \u2014 ${erCase.chiefComplaint}`
    });
  }
  if (opdVisit) {
    clinicalTreatmentItems.push({
      id: `clin-opd-${opdVisit.id}`,
      source: "OPD_ER",
      dateIso: opdVisit.visitDate,
      category: "OPD CONSULTATION",
      description: `${opdVisit.department} (${opdVisit.consultingDoctor}) \u2014 ${opdVisit.provisionalDiagnosis || opdVisit.chiefComplaint}`
    });
    for (const pm of opdVisit.prescribedMedicines || []) {
      clinicalTreatmentItems.push({
        id: `clin-opd-med-${pm.id}`,
        source: "OPD_ER",
        dateIso: pm.administeredAt || opdVisit.visitDate,
        category: "OPD MEDICATION",
        description: `${pm.medicineName}${pm.dosageRoute ? ` (${pm.dosageRoute})` : ""}`
      });
    }
  }
  const combinedPatientBillNpr = items.reduce((s, x) => s + (Number(x.amountNpr) || 0), 0);
  const ms = db.settings?.moduleSettings;
  const matchedHosp = baseReferral.referredHospitalId ? (db.referredHospitalsMaster || []).find((h) => h.id === baseReferral.referredHospitalId) : void 0;
  const matchedAmb = baseReferral.ambulanceId ? (db.ambulancesMaster || []).find((a) => a.id === baseReferral.ambulanceId) : void 0;
  const caseTypeStr = (baseReferral.referralCaseType || "").trim();
  const ambCaseRule = matchedAmb?.caseOverrides?.find(
    (r) => r.active && r.caseType.toLowerCase() === caseTypeStr.toLowerCase()
  );
  const globalCaseRule = (ms?.referralCaseRules || []).find(
    (r) => r.active && r.caseType.toLowerCase() === caseTypeStr.toLowerCase()
  );
  const chosenRule = ambCaseRule || globalCaseRule;
  let caseCommNpr = 0;
  let commMode = baseReferral.commissionMode;
  let commRate = baseReferral.commissionRateValue;
  if (chosenRule) {
    commMode = chosenRule.mode;
    commRate = chosenRule.value;
    caseCommNpr = chosenRule.mode === "PERCENT" ? Number((combinedPatientBillNpr * chosenRule.value / 100).toFixed(2)) : Number(chosenRule.value || 0);
  } else if (matchedAmb) {
    commMode = matchedAmb.defaultCommissionMode;
    commRate = matchedAmb.defaultCommissionValue;
    caseCommNpr = matchedAmb.defaultCommissionMode === "PERCENT" ? Number((combinedPatientBillNpr * matchedAmb.defaultCommissionValue / 100).toFixed(2)) : Number(matchedAmb.defaultCommissionValue || 0);
  } else if (commMode && commRate !== void 0) {
    caseCommNpr = commMode === "PERCENT" ? Number((combinedPatientBillNpr * commRate / 100).toFixed(2)) : Number(commRate || 0);
  }
  const activeTiers = [...ms?.referralBillTierRules || []].filter((t) => t.active && combinedPatientBillNpr >= t.minTotalBillNpr).sort((a, b) => b.minTotalBillNpr - a.minTotalBillNpr);
  const matchedTier = activeTiers[0];
  const tierBonusNpr = matchedTier ? Number(matchedTier.commissionAmountNpr || 0) : 0;
  const totalCommissionNpr = baseReferral.commissionCalculatedNpr !== void 0 ? Number(baseReferral.commissionCalculatedNpr) : Number((caseCommNpr + tierBonusNpr).toFixed(2));
  const tierNote = [
    chosenRule ? `${chosenRule.caseType}: ${chosenRule.mode === "PERCENT" ? `${chosenRule.value}%` : `\u0930\u0942 ${chosenRule.value}`}` : "",
    matchedTier ? `${matchedTier.label} (+\u0930\u0942 ${matchedTier.commissionAmountNpr})` : ""
  ].filter(Boolean).join(" | ");
  const resolvedHistory = baseReferral.clinicalHistorySummary?.trim() || historyParts.join(" | ") || `${encounterType} encounter clinical referral`;
  return {
    ...baseReferral,
    referredHospitalId: baseReferral.referredHospitalId || matchedHosp?.id,
    referredToHospital: baseReferral.referredToHospital || matchedHosp?.name || "",
    referredToPlace: baseReferral.referredToPlace || matchedHosp?.address || "",
    referredHospitalManagerName: baseReferral.referredHospitalManagerName?.trim() || matchedHosp?.managerName || void 0,
    referredHospitalManagerPhone: baseReferral.referredHospitalManagerPhone?.trim() || matchedHosp?.managerPhone || void 0,
    ambulanceId: baseReferral.ambulanceId || matchedAmb?.id,
    ambulanceName: baseReferral.ambulanceName?.trim() || matchedAmb?.name || void 0,
    ambulanceNumber: baseReferral.ambulanceNumber?.trim() || matchedAmb?.vehicleNumber || void 0,
    ambulanceDriverName: baseReferral.ambulanceDriverName?.trim() || matchedAmb?.driverName || void 0,
    ambulanceDriverPhone: baseReferral.ambulanceDriverPhone?.trim() || matchedAmb?.driverPhone || void 0,
    commissionMode: commMode,
    commissionRateValue: commRate,
    commissionCalculatedNpr: totalCommissionNpr,
    commissionTierNote: baseReferral.commissionTierNote || tierNote || void 0,
    departureTime: baseReferral.departureTime?.trim() || void 0,
    caseDetails: baseReferral.caseDetails?.trim() || void 0,
    clinicalHistorySummary: resolvedHistory,
    clinicalTreatmentItems,
    attachedBilledItems: items
  };
}
function detectCurrentShiftLabel(date = /* @__PURE__ */ new Date()) {
  const hr = date.getHours();
  if (hr >= 7 && hr < 14) return "Morning";
  if (hr >= 14 && hr < 22) return "Afternoon";
  return "Night";
}
function withAuth(requiredPermission, requiredModule) {
  return (req, res, next) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || void 0;
    const actor = getActor(db, actorId);
    if (actor.status === "Suspended") {
      res.status(403).json({ error: "Operator account is suspended." });
      return;
    }
    if (actor.isLocked) {
      res.status(423).json({
        error: `Account '${actor.username}' is locked (${actor.lockedReason || "security lockout"}). Call Hospital Admin to reset with reason.`,
        code: "ACCOUNT_LOCKED"
      });
      return;
    }
    if (requiredModule && !isModuleEnabled(db, requiredModule)) {
      const modName = db.saas.modules.find((m) => m.key === requiredModule)?.name || requiredModule;
      res.status(403).json({
        error: `Hospital Module Disabled: '${modName}' is currently turned off in Admin Control.`,
        code: "MODULE_DISABLED"
      });
      return;
    }
    if (requiredPermission && !hasPermission(db, actor.roleId, requiredPermission)) {
      res.status(403).json({
        error: `Access denied: Role ${actor.roleId} lacks permission '${requiredPermission}'.`
      });
      return;
    }
    req.actor = actor;
    req.db = db;
    next();
  };
}
function byteSizeMb(data) {
  const bytes = Buffer.byteLength(JSON.stringify(data || []), "utf-8");
  return Number((bytes / (1024 * 1024)).toFixed(3));
}
function computeSaasTelemetry(db) {
  const dbFileBytes = getDbFileSizeBytes();
  const ordersMb = Number((byteSizeMb(db.orders) + db.orders.length * 0.42).toFixed(2));
  const catalogMb = Number(
    (byteSizeMb(db.services) + byteSizeMb(db.reagents) + byteSizeMb(db.inventoryMovements) + 42.5).toFixed(2)
  );
  const reportsArchiveMb = Number((db.saas.archivedReportMediaMb || 0).toFixed(2));
  const logsMb = Number(
    (byteSizeMb(db.auditLogs) + byteSizeMb(db.apiDispatches) + byteSizeMb(db.emailNotifications) + db.auditLogs.length * 0.08 + 85).toFixed(2)
  );
  const financeHrMb = Number(
    (byteSizeMb(db.financialLedger) + byteSizeMb(db.counterCloses) + byteSizeMb(db.payrollRuns) + byteSizeMb(db.referrals) + 64.2).toFixed(2)
  );
  const enabledModulesFootprintMb = db.saas.modules.filter((m) => m.enabled).reduce((s, m) => s + (m.storageFootprintMb || 0), 0);
  const totalUsedMb = Number(
    (ordersMb + catalogMb + reportsArchiveMb + logsMb + financeHrMb + enabledModulesFootprintMb * 0.25).toFixed(2)
  );
  const totalQuotaMb = Math.max(1024, db.saas.storageQuotaMb || 25600);
  const percentUsed = Number(Math.min(100, totalUsedMb / totalQuotaMb * 100).toFixed(2));
  const addonTotalNpr = db.saas.modules.filter((m) => m.enabled && !m.lockedCore).reduce((sum, m) => sum + (m.monthlyAddonNpr || 0), 0);
  const monthlyRecurringNpr = (db.saas.basePlanPriceNpr || 0) + addonTotalNpr;
  return {
    totalQuotaMb,
    totalUsedMb,
    percentUsed,
    dbFileBytes,
    breakdown: [
      {
        key: "reports_archive",
        label: "A5/A4 Diagnostic Reports & Hospital Bills",
        usedMb: reportsArchiveMb,
        recordCount: db.orders.filter((o) => o.status === "Validated").length + db.orders.length
      },
      {
        key: "orders_clinical",
        label: "Orders, Analytes & Qualitative/Quantitative Results",
        usedMb: ordersMb,
        recordCount: db.orders.length
      },
      {
        key: "audit_dispatch",
        label: "Immutable Audit Trail, Email & EMR API Logs",
        usedMb: logsMb,
        recordCount: db.auditLogs.length + db.apiDispatches.length + db.emailNotifications.length
      },
      {
        key: "finance_hr",
        label: "Treasury Ledger, Counter Close & Payroll",
        usedMb: financeHrMb,
        recordCount: db.financialLedger.length + db.counterCloses.length + db.payrollRuns.length
      },
      {
        key: "catalog_bom",
        label: "Hospital Service Master & Reagent BOM Inventory",
        usedMb: catalogMb,
        recordCount: db.services.length + db.reagents.length + db.inventoryMovements.length
      }
    ],
    seatsUsed: db.staff.filter((s) => s.status !== "Suspended").length,
    seatsMax: db.saas.maxStaffSeats,
    centersUsed: 0,
    centersMax: 0,
    monthlyOrdersCount: db.orders.length,
    monthlyOrdersMax: db.saas.maxMonthlyOrders,
    monthlyRecurringNpr
  };
}
function buildFhirReportPayload(db, order) {
  const bs = adToBs(order.orderedAt);
  return {
    resourceType: "DiagnosticReport",
    id: order.id,
    accessionNumber: order.accessionNumber,
    invoiceNumber: order.invoiceNumber,
    fiscalYear: order.fiscalYear,
    nepaliDate: bs.formattedEn,
    status: order.status === "Validated" || order.status === "Dispatched" ? "final" : "preliminary",
    issuedAt: order.validatedAt || (/* @__PURE__ */ new Date()).toISOString(),
    laboratory: {
      name: db.settings.labName,
      accreditation: db.settings.accreditationLine
    },
    patient: {
      name: order.patientName,
      age: `${order.patientAge} ${order.patientAgeType}`,
      gender: order.patientGender,
      address: order.patientAddress,
      phone: order.patientPhone,
      email: order.patientEmail
    },
    referringPhysician: order.referringDoctor,
    collectionCenter: order.collectionCenterName,
    turnaroundTime: {
      orderedAt: order.orderedAt,
      dueAt: order.dueAt,
      validatedAt: order.validatedAt
    },
    validatedBy: order.validatedByName ? {
      name: order.validatedByName,
      designation: order.validatedByDesignation,
      registrationNumber: order.validatedByRegNo
    } : null,
    results: order.tests.map((t) => ({
      testCode: t.serviceCode,
      testName: t.serviceName,
      department: t.department,
      methodology: t.methodology,
      interpretation: t.interpretation,
      analytes: t.parameterResults.map((p) => ({
        name: p.parameterName,
        value: p.value,
        unit: p.unit,
        referenceRange: p.refRangeDisplay,
        flag: p.flag
      }))
    }))
  };
}
async function dispatchApiReport(db, order, targetUrl, actor, port) {
  const payload = buildFhirReportPayload(db, order);
  const payloadJson = JSON.stringify(payload, null, 2);
  const resolvedUrl = targetUrl.startsWith("/") ? `http://127.0.0.1:${port}${targetUrl}` : targetUrl;
  const start = Date.now();
  let httpStatus = 500;
  let responseBody = "";
  let status = "Failed";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5e3);
    const resp = await fetch(resolvedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Saptari-Signature": `sha256=${Buffer.from(order.accessionNumber).toString("base64")}`
      },
      body: payloadJson,
      signal: controller.signal
    });
    clearTimeout(timer);
    httpStatus = resp.status;
    responseBody = await resp.text();
    status = resp.ok ? "Delivered" : "Failed";
  } catch (err) {
    responseBody = err instanceof Error ? err.message : "Network error during webhook dispatch";
    httpStatus = 502;
    status = "Failed";
  }
  const latencyMs = Math.max(1, Date.now() - start);
  const logEntry = {
    id: `api-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    orderId: order.id,
    accessionNumber: order.accessionNumber,
    targetUrl,
    httpStatus,
    latencyMs,
    status,
    requestPayload: payloadJson,
    responseBody,
    triggeredBy: actor.fullName
  };
  db.apiDispatches.unshift(logEntry);
  if (status === "Delivered") {
    order.apiSent = true;
    order.apiSentAt = logEntry.timestamp;
  }
  appendAudit(
    db,
    actor,
    "API_DISPATCH",
    status === "Delivered" ? "API_REPORT_SENT" : "API_REPORT_FAILED",
    order.accessionNumber,
    `API report dispatch to ${targetUrl} returned HTTP ${httpStatus} in ${latencyMs}ms.`,
    status === "Delivered" ? "INFO" : "WARNING"
  );
  return logEntry;
}
function createEmailNotification(db, order, triggerType, actor) {
  const flaggedItems = order.tests.flatMap((t) => t.parameterResults).filter((p) => p.flag !== "NORMAL" && p.value !== null).map((p) => `${p.parameterName}: ${p.value} ${p.unit} [${p.flag}]`);
  const summaryNote = flaggedItems.length > 0 ? `Flagged findings: ${flaggedItems.slice(0, 4).join(", ")}.` : "All evaluated analytes are within biological reference intervals.";
  const entry = {
    id: `eml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    orderId: order.id,
    accessionNumber: order.accessionNumber,
    recipientEmail: order.patientEmail || "patient@saptarihospital.com",
    subject: `Final Verified Hospital Report \u2014 Accession ${order.accessionNumber} (${order.patientName})`,
    triggerType,
    status: "Sent",
    bodyPreview: `Dear ${order.patientName}, Your diagnostic report (${order.accessionNumber}) comprising ${order.tests.map((t) => t.serviceCode).join(", ")} has been digitally verified by ${order.validatedByName || actor.fullName}. ${summaryNote} Refer to ${order.referringDoctor} for clinical correlation.`,
    triggeredBy: actor.fullName
  };
  db.emailNotifications.unshift(entry);
  order.emailSent = true;
  order.emailSentAt = entry.timestamp;
  appendAudit(
    db,
    actor,
    "NOTIFICATIONS",
    "EMAIL_DISPATCHED",
    order.accessionNumber,
    `${triggerType === "AUTO_ON_VALIDATE" ? "Automated" : "Manual"} report email sent to ${entry.recipientEmail}.`,
    "INFO"
  );
  return entry;
}
function postLedgerMovement(db, account, direction, amount, category, referenceId, description, fiscalYear, actor) {
  const val = Number(amount) || 0;
  if (val <= 0) return;
  account.currentBalance = Number(
    (direction === "INFLOW" ? account.currentBalance + val : account.currentBalance - val).toFixed(2)
  );
  db.financialLedger.unshift({
    id: `fin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    fiscalYear,
    accountId: account.id,
    accountName: account.name,
    category,
    direction,
    amount: val,
    balanceAfter: account.currentBalance,
    referenceId,
    description,
    recordedBy: actor.fullName
  });
}
function computeTestReferralCommission(partner, service) {
  if (!partner || !partner.active) return 0;
  const override = partner.testOverrides.find((o) => o.serviceId === service.id);
  const mode = override ? override.mode : partner.defaultMode;
  const val = override ? override.value : partner.defaultValue;
  if (mode === "FLAT") {
    return Number(val.toFixed(2));
  }
  return Number((service.price * val / 100).toFixed(2));
}
function autoDetectPoliceStation(placeText, directory) {
  const s = (placeText || "").toLowerCase();
  if (Array.isArray(directory) && directory.length > 0) {
    for (const st of directory) {
      const kws = Array.isArray(st.keywords) ? st.keywords : [];
      if (kws.some((k) => k && s.includes(k.toLowerCase())) || st.municipalityOrArea && s.includes(st.municipalityOrArea.toLowerCase())) {
        return {
          stationName: st.stationName,
          stationAddress: st.address,
          stationPhone: st.phone
        };
      }
    }
    const def = directory[0];
    return {
      stationName: def.stationName,
      stationAddress: def.address,
      stationPhone: def.phone
    };
  }
  if (s.includes("kalyanpur") || s.includes("khoksar")) {
    return {
      stationName: "Prahari Chowki, Kalyanpur",
      stationAddress: "Kalyanpur Bazaar, Saptari, Nepal",
      stationPhone: "031-560144"
    };
  }
  if (s.includes("kadarbona") || s.includes("shambhunath") || s.includes("surunga")) {
    return {
      stationName: "Ilaka Prahari Karyalaya, Kadarbona",
      stationAddress: "East-West Highway, Kadarbona, Saptari, Nepal",
      stationPhone: "031-560188"
    };
  }
  if (s.includes("rajbiraj") || s.includes("district")) {
    return {
      stationName: "District Police Office (Jilla Prahari Karyalaya), Saptari",
      stationAddress: "Rajbiraj-04, Saptari, Nepal",
      stationPhone: "031-520100"
    };
  }
  if (s.includes("pato") || s.includes("dakneshwori") || s.includes("belhi")) {
    return {
      stationName: "Prahari Chowki, Pato / Dakneshwori",
      stationAddress: "Dakneshwori Municipality, Saptari, Nepal",
      stationPhone: "031-560166"
    };
  }
  return {
    stationName: "Ilaka Prahari Karyalaya (Area Police Office), Bode Barsain",
    stationAddress: "Bode Barsain-05, Saptari, Nepal",
    stationPhone: "031-560100"
  };
}
function upsertPatientMaster(db, info) {
  if (!Array.isArray(db.patients)) db.patients = [];
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const bsNow = adToBs(nowIso);
  let existing = info.patientId && db.patients.find((p) => p.id === info.patientId) || info.uhid && db.patients.find((p) => p.uhid === info.uhid) || db.patients.find(
    (p) => p.fullName.toLowerCase() === info.fullName.trim().toLowerCase() && (!info.phone || !p.phone || p.phone === info.phone.trim())
  );
  const normalizedPhone = normalizeNepalPhone(info.phone);
  if (existing) {
    existing.totalEncounters = (existing.totalEncounters || 0) + 1;
    if (normalizedPhone) existing.phone = normalizedPhone;
    if (info.address?.trim()) existing.address = info.address.trim();
    if (info.email?.trim()) existing.email = info.email.trim();
    if (info.encounterType === "OPD") existing.lastOpdVisitAt = nowIso;
    return existing;
  }
  const seq = 101 + db.patients.length;
  const created = {
    id: `pat-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    uhid: info.uhid?.trim() || `SHP-UHID-${bsNow.year}-${seq}`,
    fullName: info.fullName.trim(),
    age: Number(info.age) || 30,
    ageType: info.ageType || "Years",
    gender: info.gender || "Male",
    phone: normalizedPhone,
    address: info.address?.trim() || "",
    email: info.email?.trim() || "",
    createdAt: nowIso,
    createdBy: info.actorName,
    lastOpdVisitAt: info.encounterType === "OPD" ? nowIso : void 0,
    totalEncounters: 1
  };
  db.patients.unshift(created);
  return created;
}
var CONSENT_CATALOG = {
  GENERAL_ADMISSION: {
    title: "General Inpatient Admission & Clinical Investigation Consent",
    caseTriggerRule: "Auto-assigned on IPD Admission",
    summaryText: "Consent for routine hospital stay, diagnostic investigations, IV cannulation, medications, and nursing care at Saptari Hospital Pvt Ltd."
  },
  EMERGENCY_TREATMENT: {
    title: "Emergency Stabilization & Urgent Intervention Consent",
    caseTriggerRule: "Auto-assigned on ER Triage Registration",
    summaryText: "Consent for emergency resuscitation, analgesia, suturing, oxygenation, and urgent lifesaving stabilization."
  },
  ICU_CRITICAL_CARE: {
    title: "ICU / High-Dependency Critical Care Consent",
    caseTriggerRule: "Auto-assigned on ICU/HDU Bed or Red Triage",
    summaryText: "Informed high-risk critical care consent covering continuous monitoring, vasopressors, airway/ventilatory support, and prognosis explanation."
  },
  SURGERY_ANESTHESIA: {
    title: "Surgical / Operative Procedure & Anesthesia Consent",
    caseTriggerRule: "Auto-assigned for Surgical/Operative Cases",
    summaryText: "Procedural & anesthesia risk-benefit informed consent for surgical intervention and post-operative care."
  },
  MLC_FORENSIC_EXAM: {
    title: "Medico-Legal Case (MLC) Clinical Examination & Police Intimation Consent",
    caseTriggerRule: "Auto-assigned on Medico-Legal Case (MLC)",
    summaryText: "Medico-legal injury documentation, forensic evidence preservation, and mandatory Nepal Police station intimation acknowledgement."
  },
  MATERNITY_DELIVERY: {
    title: "Maternity, Labor & Obstetric Delivery Consent",
    caseTriggerRule: "Auto-assigned on Maternity / OBG Cases",
    summaryText: "Consent for antenatal/intrapartum monitoring, normal vaginal delivery, episiotomy, or emergency cesarean backup."
  },
  LAMA_DOR_RISK: {
    title: "Discharge on Request (DOR) / Left Against Medical Advice (LAMA) Consent",
    caseTriggerRule: "Auto-assigned on LAMA / DOR Disposition",
    summaryText: "High-risk declaration acknowledging medical risks of discontinuing inpatient treatment against medical advice."
  },
  EXTERNAL_REFERRAL_TRANSPORT: {
    title: "Higher-Center Emergency Referral & Ambulance Transfer Consent",
    caseTriggerRule: "Auto-assigned on External Hospital Referral",
    summaryText: "Informed transit consent explaining patient clinical stability, ambulance transport risks, and external tertiary hospital handover."
  }
};
function autoAssignConsents(opts) {
  const keys = /* @__PURE__ */ new Set();
  if (opts.context === "ER") {
    keys.add("EMERGENCY_TREATMENT");
  } else {
    keys.add("GENERAL_ADMISSION");
  }
  const blob = `${opts.caseCategory || ""} ${opts.wardName || ""} ${opts.mlcType || ""}`.toLowerCase();
  if (opts.isMlc || opts.mlcType && opts.mlcType !== "None") {
    keys.add("MLC_FORENSIC_EXAM");
  }
  if (blob.includes("icu") || blob.includes("critical") || blob.includes("cardiac") || blob.includes("hdu")) {
    keys.add("ICU_CRITICAL_CARE");
  }
  if (blob.includes("surg") || blob.includes("ot") || blob.includes("append") || blob.includes("ortho")) {
    keys.add("SURGERY_ANESTHESIA");
  }
  if (blob.includes("matern") || blob.includes("obg") || blob.includes("deliver") || blob.includes("gyne")) {
    keys.add("MATERNITY_DELIVERY");
  }
  if (blob.includes("lama")) {
    keys.add("LAMA_DOR_RISK");
  }
  if (blob.includes("refer")) {
    keys.add("EXTERNAL_REFERRAL_TRANSPORT");
  }
  return Array.from(keys).map((k, idx) => {
    const def = CONSENT_CATALOG[k];
    return {
      id: `cns-auto-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 5)}`,
      consentCode: `CNS-${k.slice(0, 3)}-${Math.floor(100 + Math.random() * 899)}`,
      consentType: k,
      title: def.title,
      autoReason: def.caseTriggerRule,
      summaryText: def.summaryText,
      patientOrGuardianName: opts.guardianName || opts.patientName,
      relationship: opts.guardianName ? "Next of Kin / Guardian" : "Self",
      witnessName: "",
      status: "Auto-Assigned (Pending Signature)",
      createdAt: opts.createdAt
    };
  });
}
function parseCliPort() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--port" && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (args[i].startsWith("--port=")) {
      const n = Number(args[i].split("=")[1]);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}
async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const cliPort = parseCliPort();
  const rawEnvPort = process.env.PORT?.trim();
  const isSocketPort = !cliPort && Boolean(rawEnvPort) && (rawEnvPort.startsWith("/") || rawEnvPort.toLowerCase() === "passenger");
  const PORT = cliPort || (Number(rawEnvPort) > 0 ? Number(rawEnvPort) : 3e3);
  const LISTEN_TARGET = isSocketPort ? rawEnvPort : PORT;
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    next();
  });
  app.use(compression());
  app.use(express.json({ limit: "50mb" }));
  const getLocalLanIps = () => {
    const nets = os.networkInterfaces();
    const ips = [];
    for (const ifaceList of Object.values(nets)) {
      if (!Array.isArray(ifaceList)) continue;
      for (const net of ifaceList) {
        if (net.family === "IPv4" && !net.internal && net.address) {
          ips.push(net.address);
        }
      }
    }
    return Array.from(new Set(ips));
  };
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      app: "SHPL",
      platform: process.platform,
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      lanUrls: getLocalLanIps().map((ip) => `http://${ip}:${PORT}`)
    });
  });
  app.get("/api/system/network-info", (_req, res) => {
    const db = getDb();
    const localIps = getLocalLanIps();
    const configuredLanIp = db.settings?.moduleSettings?.lanServerHostIp || localIps[0] || "192.168.1.100";
    res.json({
      appName: "SHPL",
      port: PORT,
      platform: process.platform,
      localIps,
      lanUrls: localIps.map((ip) => `http://${ip}:${PORT}`),
      configuredLanIp,
      configuredUrl: `http://${configuredLanIp}:${PORT}`
    });
  });
  app.post("/api/emr-webhook-receiver", (req, res) => {
    const payload = req.body;
    res.status(200).json({
      received: true,
      emrStatus: "ACCEPTED",
      hl7Ack: "AA",
      accessionNumber: payload?.accessionNumber || "UNKNOWN",
      receivedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
  });
  app.get("/api/bootstrap", withAuth(), (req, res) => {
    const { db, actor } = req;
    const ms = db.settings?.moduleSettings;
    let changed = false;
    for (const adm of db.ipdAdmissions || []) {
      if (adm.disposition === "Admitted") {
        const prevDays = adm.bedDaysBilled;
        const prevBill = adm.totalBillNpr;
        const prevRounds = adm.doctorRoundChargesNpr;
        const prevNursing = adm.nursingChargesNpr;
        const prevObs = adm.autoObservationChargesNpr;
        recalcIpdFinancials(adm, ms);
        if (adm.bedDaysBilled !== prevDays || adm.totalBillNpr !== prevBill || adm.doctorRoundChargesNpr !== prevRounds || adm.nursingChargesNpr !== prevNursing || adm.autoObservationChargesNpr !== prevObs) {
          changed = true;
        }
      }
    }
    if (changed) saveDb(db);
    res.json({
      db: scopeDbForActor(db, actor),
      activeUser: actor,
      telemetry: computeSaasTelemetry(db)
    });
  });
  app.get("/api/dashboard/layout-config", withAuth("dashboard.view"), (req, res) => {
    const { db, actor } = req;
    const requestedRole = typeof req.query.roleId === "string" ? req.query.roleId : actor.roleId;
    const targetRole = actor.roleId === "SUPER_ADMIN" || actor.roleId === "SAAS_ADMIN" ? requestedRole : actor.roleId;
    const fallbackConfig = DEFAULT_DASHBOARD_LAYOUT_CONFIGS[targetRole] || DEFAULT_DASHBOARD_LAYOUT_CONFIGS.SUPER_ADMIN;
    const layoutConfig = targetRole === "LAB_TECH" ? DEFAULT_DASHBOARD_LAYOUT_CONFIGS.LAB_TECH : db.dashboardLayoutConfigs?.[targetRole] || fallbackConfig;
    res.json({
      roleId: targetRole,
      layoutConfig,
      allConfigs: actor.roleId === "SUPER_ADMIN" || actor.roleId === "SAAS_ADMIN" ? db.dashboardLayoutConfigs || DEFAULT_DASHBOARD_LAYOUT_CONFIGS : void 0
    });
  });
  app.put("/api/dashboard/layout-config", withAuth("settings.manage"), (req, res) => {
    const { db, actor } = req;
    if (actor.roleId !== "SUPER_ADMIN" && actor.roleId !== "SAAS_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin can update role dashboard layout configurations." });
      return;
    }
    const body = req.body;
    const roleId = body.roleId;
    if (!roleId || !DEFAULT_DASHBOARD_LAYOUT_CONFIGS[roleId] && !db.roles.some((r) => r.id === roleId)) {
      res.status(400).json({ error: "Valid roleId is required." });
      return;
    }
    if (!db.dashboardLayoutConfigs) {
      db.dashboardLayoutConfigs = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS };
    }
    const base = db.dashboardLayoutConfigs[roleId] || DEFAULT_DASHBOARD_LAYOUT_CONFIGS[roleId] || {
      roleId,
      title: `${roleId} Workspace`,
      subtitle: "Custom Hospital Role Dashboard",
      widgets: ["EXECUTIVE_SUMMARY", "PRIORITY_ALERTS", "KPI_GRID", "CLINICAL_OPS", "SHIFT_HANDOVER"]
    };
    db.dashboardLayoutConfigs[roleId] = {
      roleId,
      title: body.title?.trim() || base.title,
      subtitle: body.subtitle?.trim() || base.subtitle,
      widgets: Array.isArray(body.widgets) && body.widgets.length > 0 ? body.widgets : base.widgets
    };
    appendAudit(
      db,
      actor,
      "SETTINGS",
      "DASHBOARD_LAYOUT_UPDATED",
      roleId,
      `Updated dashboard layout_config for role ${roleId}.`
    );
    saveDb(db);
    res.json({ layoutConfig: db.dashboardLayoutConfigs[roleId], db: scopeDbForActor(db, actor) });
  });
  app.post("/api/reset-demo", withAuth("settings.manage"), (req, res) => {
    const { actor } = req;
    if (actor.roleId !== "SUPER_ADMIN" && actor.roleId !== "SAAS_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin can reset demo state." });
      return;
    }
    const fresh = resetDb();
    const preservedActor = fresh.staff.find((s) => s.id === actor.id) || fresh.staff[1] || fresh.staff[0];
    res.json({
      db: scopeDbForActor(fresh, preservedActor),
      activeUser: preservedActor,
      telemetry: computeSaasTelemetry(fresh)
    });
  });
  app.post("/api/auth/login", (req, res) => {
    const db = getDb();
    const { username, password } = req.body;
    const cleanUser = (username || "").trim();
    const cleanPass = password || "";
    if (!cleanUser || !cleanPass) {
      res.status(400).json({ error: "Username and password are required." });
      return;
    }
    if (cleanUser.includes("@") || /^\+?[\d\s\-()]{7,}$/.test(cleanUser)) {
      res.status(400).json({
        error: "Login requires Username & Password only. Email address and phone number login are disabled."
      });
      return;
    }
    const user = db.staff.find((s) => s.username.toLowerCase() === cleanUser.toLowerCase());
    if (!user) {
      appendAudit(
        db,
        db.staff[0],
        "AUTH",
        "LOGIN_UNKNOWN_USER",
        cleanUser,
        `Failed login attempt for unknown username '${cleanUser}'.`,
        "WARNING"
      );
      appendSecurityAlert(db, {
        type: "FAILED_LOGIN",
        severity: "WARNING",
        targetUsername: cleanUser,
        message: `Unknown username '${cleanUser}' attempted to sign in.`,
        resolved: false
      });
      saveDb(db);
      res.status(401).json({ error: "Invalid username or password." });
      return;
    }
    if (user.status === "Suspended") {
      res.status(403).json({ error: "This operator account is Suspended. Contact Admin." });
      return;
    }
    if (user.isLocked) {
      res.status(423).json({
        error: `Account '${user.username}' is LOCKED after multiple failed attempts. Call Hospital Admin (${db.settings.resetSupportPhone}) to reset with reason.`,
        code: "ACCOUNT_LOCKED",
        supportPhone: db.settings.resetSupportPhone
      });
      return;
    }
    const maxAttempts = Math.max(2, db.settings?.moduleSettings?.maxFailedAttemptsBeforeLock || 3);
    if (user.password !== cleanPass) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      user.lastFailedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (user.failedAttempts >= maxAttempts) {
        user.isLocked = true;
        user.lockedAt = (/* @__PURE__ */ new Date()).toISOString();
        user.lockedReason = `${maxAttempts} consecutive failed password login attempts`;
        appendAudit(
          db,
          user,
          "AUTH",
          "ACCOUNT_LOCKED_BRUTE_FORCE",
          user.username,
          `LOCKOUT TRIGGERED: '${user.username}' (${user.fullName}) locked after ${maxAttempts} failed password attempts.`,
          "CRITICAL"
        );
        appendSecurityAlert(db, {
          type: "BRUTE_FORCE_LOCKOUT",
          severity: "CRITICAL",
          targetUserId: user.id,
          targetUsername: user.username,
          targetFullName: user.fullName,
          targetRole: user.roleId,
          attemptsCount: user.failedAttempts,
          message: `Account locked after ${maxAttempts} failed password attempts for '${user.username}' (${user.fullName}). Admin call-reset required.`,
          resolved: false
        });
        saveDb(db);
        res.status(423).json({
          error: `Account locked after ${maxAttempts} failed password attempts. Incident logged & Admin alerted. Call ${db.settings.resetSupportPhone} for reset.`,
          code: "ACCOUNT_LOCKED",
          supportPhone: db.settings.resetSupportPhone,
          db: scopeDbForActor(db, user)
        });
        return;
      }
      const remaining = maxAttempts - user.failedAttempts;
      appendAudit(
        db,
        user,
        "AUTH",
        "FAILED_LOGIN_ATTEMPT",
        user.username,
        `Invalid password entered for '${user.username}' (Attempt ${user.failedAttempts}/${maxAttempts}).`,
        "WARNING"
      );
      appendSecurityAlert(db, {
        type: "FAILED_LOGIN",
        severity: "WARNING",
        targetUserId: user.id,
        targetUsername: user.username,
        targetFullName: user.fullName,
        targetRole: user.roleId,
        attemptsCount: user.failedAttempts,
        message: `Failed password attempt (${user.failedAttempts}/${maxAttempts}) on '${user.username}' (${user.fullName}).`,
        resolved: false
      });
      saveDb(db);
      res.status(401).json({
        error: `Invalid password. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before security lockout.`,
        attemptsRemaining: remaining,
        db: scopeDbForActor(db, user)
      });
      return;
    }
    user.failedAttempts = 0;
    user.lastLoginAt = (/* @__PURE__ */ new Date()).toISOString();
    appendAudit(
      db,
      user,
      "AUTH",
      "USER_LOGIN",
      user.employeeCode,
      `${user.fullName} (@${user.username}, ${user.roleId}${user.assignedCenterName ? ` \xB7 ${user.assignedCenterName}` : ""}) authenticated via username & password.`,
      "INFO"
    );
    saveDb(db);
    res.json({ activeUser: user, db: scopeDbForActor(db, user), telemetry: computeSaasTelemetry(db) });
  });
  app.post("/api/auth/unlock-pin", withAuth(), (req, res) => {
    const { db, actor } = req;
    const { pin } = req.body;
    const cleanPin = String(pin || "").trim();
    if (!cleanPin) {
      res.status(400).json({ error: "Admin-assigned PIN is required to unlock session." });
      return;
    }
    const maxAttempts = Math.max(2, db.settings?.moduleSettings?.maxFailedAttemptsBeforeLock || 3);
    if (actor.pin !== cleanPin) {
      actor.failedAttempts = (actor.failedAttempts || 0) + 1;
      actor.lastFailedAt = (/* @__PURE__ */ new Date()).toISOString();
      if (actor.failedAttempts >= maxAttempts) {
        actor.isLocked = true;
        actor.lockedAt = (/* @__PURE__ */ new Date()).toISOString();
        actor.lockedReason = `${maxAttempts} consecutive failed idle-lock PIN attempts`;
        appendAudit(
          db,
          actor,
          "AUTH",
          "PIN_LOCKOUT_TRIGGERED",
          actor.username,
          `LOCKOUT TRIGGERED: '${actor.username}' (${actor.fullName}) locked after ${maxAttempts} wrong PIN entries.`,
          "CRITICAL"
        );
        appendSecurityAlert(db, {
          type: "BRUTE_FORCE_LOCKOUT",
          severity: "CRITICAL",
          targetUserId: actor.id,
          targetUsername: actor.username,
          targetFullName: actor.fullName,
          targetRole: actor.roleId,
          attemptsCount: actor.failedAttempts,
          message: `Idle-lock session locked after ${maxAttempts} wrong PIN attempts for '${actor.username}'. Admin reset required.`,
          resolved: false
        });
        saveDb(db);
        res.status(423).json({
          error: `Session locked after ${maxAttempts} failed PIN attempts. Admin alerted. Call ${db.settings.resetSupportPhone} for reset.`,
          code: "ACCOUNT_LOCKED",
          db: scopeDbForActor(db, actor)
        });
        return;
      }
      const remaining = maxAttempts - actor.failedAttempts;
      appendAudit(
        db,
        actor,
        "AUTH",
        "FAILED_PIN_ATTEMPT",
        actor.username,
        `Incorrect PIN entered for '${actor.username}' (Attempt ${actor.failedAttempts}/${maxAttempts}).`,
        "WARNING"
      );
      appendSecurityAlert(db, {
        type: "FAILED_PIN",
        severity: "WARNING",
        targetUserId: actor.id,
        targetUsername: actor.username,
        targetFullName: actor.fullName,
        targetRole: actor.roleId,
        attemptsCount: actor.failedAttempts,
        message: `Failed idle-lock PIN attempt (${actor.failedAttempts}/${maxAttempts}) on '${actor.username}'.`,
        resolved: false
      });
      saveDb(db);
      res.status(401).json({
        error: `Incorrect PIN. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining before lockout.`,
        attemptsRemaining: remaining,
        db: scopeDbForActor(db, actor)
      });
      return;
    }
    actor.failedAttempts = 0;
    appendAudit(
      db,
      actor,
      "AUTH",
      "PIN_UNLOCKED",
      actor.employeeCode,
      `${actor.fullName} unlocked idle screen using Admin-assigned PIN.`,
      "INFO"
    );
    saveDb(db);
    res.json({ ok: true, activeUser: actor, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/auth/request-reset", (req, res) => {
    const db = getDb();
    const { username, callerPhone, note } = req.body;
    const cleanUser = (username || "").trim() || "unknown";
    const target = db.staff.find((s) => s.username.toLowerCase() === cleanUser.toLowerCase());
    appendAudit(
      db,
      target || db.staff[0],
      "AUTH",
      "CALL_RESET_REQUESTED",
      cleanUser,
      `Password/PIN reset requested via support call (${callerPhone || "direct call"}) for '${cleanUser}'. Note: ${note || "Call requested"}.`,
      "WARNING"
    );
    appendSecurityAlert(db, {
      type: "CALL_RESET_REQUEST",
      severity: "WARNING",
      targetUserId: target?.id,
      targetUsername: target?.username || cleanUser,
      targetFullName: target?.fullName,
      targetRole: target?.roleId,
      message: `Phone-call reset requested for '@${target?.username || cleanUser}' (${callerPhone || "Support call"}). ${note || ""}`.trim(),
      resolved: false
    });
    saveDb(db);
    res.status(201).json({
      ok: true,
      supportPhone: db.settings.resetSupportPhone,
      message: `Reset request logged for Admin review. Please call ${db.settings.resetSupportPhone} for verification & reset.`,
      db
    });
  });
  app.post("/api/auth/instant-reset", (req, res) => {
    const db = getDb();
    const { username, resetEmail, newPassword, newPin } = req.body;
    const cleanUser = (username || "").trim();
    const cleanEmail = (resetEmail || "").trim().toLowerCase();
    const cleanPass = (newPassword || "").trim();
    const authorizedResetEmail = (db.settings?.emailSender || "saptarihospital@gmail.com").trim().toLowerCase();
    if (!cleanUser) {
      res.status(400).json({ error: "Username or Employee Code is required." });
      return;
    }
    if (cleanEmail !== authorizedResetEmail && cleanEmail !== "saptarihospital@gmail.com") {
      res.status(403).json({
        error: `Authorized Hospital Reset Email must be saptarihospital@gmail.com.`
      });
      return;
    }
    if (cleanPass.length < 4) {
      res.status(400).json({ error: "New password must be at least 4 characters." });
      return;
    }
    if (newPin && newPin.trim() && !/^\d{4,6}$/.test(newPin.trim())) {
      res.status(400).json({ error: "Optional PIN must be 4 to 6 numeric digits." });
      return;
    }
    const target = db.staff.find(
      (s) => s.username.toLowerCase() === cleanUser.toLowerCase() || s.employeeCode.toLowerCase() === cleanUser.toLowerCase()
    );
    if (!target) {
      res.status(404).json({ error: `No staff account found for '${cleanUser}'.` });
      return;
    }
    target.password = cleanPass;
    if (newPin && newPin.trim()) {
      target.pin = newPin.trim();
    }
    target.isLocked = false;
    target.failedAttempts = 0;
    target.lockedReason = void 0;
    target.lockedAt = void 0;
    for (const al of db.securityAlerts || []) {
      if (!al.resolved && (al.targetUserId === target.id || al.targetUsername === target.username)) {
        al.resolved = true;
        al.resolvedBy = "Instant Email Reset (saptarihospital@gmail.com)";
        al.resolvedReason = "Password reset instantly via authorized hospital email";
        al.resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    }
    if (!Array.isArray(db.emailNotifications)) db.emailNotifications = [];
    db.emailNotifications.unshift({
      id: `eml-rst-${Date.now()}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      orderId: target.id,
      accessionNumber: target.employeeCode,
      recipientEmail: "saptarihospital@gmail.com",
      subject: `[SHPL Instant Password Reset] @${target.username} (${target.fullName})`,
      triggerType: "MANUAL_RESEND",
      status: "Sent",
      bodyPreview: `Instant credential reset completed via saptarihospital@gmail.com for @${target.username} (${target.roleId}). Account unlocked and ready for immediate login.`,
      triggeredBy: "saptarihospital@gmail.com"
    });
    appendSecurityAlert(db, {
      type: "ADMIN_RESET",
      severity: "INFO",
      targetUserId: target.id,
      targetUsername: target.username,
      targetFullName: target.fullName,
      targetRole: target.roleId,
      message: `Instant password reset completed via saptarihospital@gmail.com for '@${target.username}' (${target.fullName}).`,
      resolved: true,
      resolvedBy: "saptarihospital@gmail.com",
      resolvedReason: "Instant Hospital Email Reset",
      resolvedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    appendAudit(
      db,
      target,
      "AUTH",
      "INSTANT_EMAIL_PASSWORD_RESET",
      target.username,
      `Instant password reset & account unlock completed via saptarihospital@gmail.com for '@${target.username}' (${target.fullName}).`,
      "WARNING"
    );
    saveDb(db);
    res.json({
      ok: true,
      username: target.username,
      fullName: target.fullName,
      message: `Password for '@${target.username}' reset instantly via saptarihospital@gmail.com. Sign in now.`,
      db
    });
  });
  app.post("/api/auth/admin-reset", withAuth(), (req, res) => {
    const { db, actor } = req;
    const canReset = hasPermission(db, actor.roleId, "personnel.manage") || hasPermission(db, actor.roleId, "rbac.manage") || hasPermission(db, actor.roleId, "admin.control") || hasPermission(db, actor.roleId, "saas.tenants.manage");
    if (!canReset) {
      res.status(403).json({ error: "Only Hospital Admin can reset passwords, PINs, or unlock accounts." });
      return;
    }
    const { targetUserId, newPassword, newPin, reason } = req.body;
    if (!reason || !reason.trim()) {
      res.status(400).json({ error: "A mandatory reset Reason is required for audit compliance." });
      return;
    }
    const target = db.staff.find((s) => s.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: "Target staff account not found." });
      return;
    }
    if (target.roleId === "SUPER_ADMIN" && actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin (SUPER_ADMIN) can reset another Admin account." });
      return;
    }
    if (newPassword && newPassword.trim()) {
      target.password = newPassword.trim();
    }
    if (newPin && newPin.trim()) {
      if (!/^\d{4,6}$/.test(newPin.trim())) {
        res.status(400).json({ error: "PIN must be 4 to 6 numeric digits." });
        return;
      }
      target.pin = newPin.trim();
    }
    target.isLocked = false;
    target.failedAttempts = 0;
    target.lockedReason = void 0;
    target.lockedAt = void 0;
    for (const al of db.securityAlerts) {
      if (!al.resolved && (al.targetUserId === target.id || al.targetUsername === target.username)) {
        al.resolved = true;
        al.resolvedBy = actor.fullName;
        al.resolvedReason = reason.trim();
        al.resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
    }
    appendSecurityAlert(db, {
      type: "ADMIN_RESET",
      severity: "INFO",
      targetUserId: target.id,
      targetUsername: target.username,
      targetFullName: target.fullName,
      targetRole: target.roleId,
      message: `${actor.fullName} unlocked & reset credentials${newPin ? " + PIN" : ""} for '@${target.username}'. Reason: ${reason.trim()}`,
      resolved: true,
      resolvedBy: actor.fullName,
      resolvedReason: reason.trim(),
      resolvedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    appendAudit(
      db,
      actor,
      "AUTH",
      "ADMIN_CREDENTIAL_RESET",
      target.username,
      `Reset & unlocked '@${target.username}' (${target.fullName})${newPassword ? " [Password updated]" : ""}${newPin ? " [PIN updated]" : ""}. Reason: ${reason.trim()}`,
      "WARNING"
    );
    saveDb(db);
    res.json({ ok: true, user: target, db });
  });
  app.post("/api/auth/event", withAuth(), (req, res) => {
    const { db, actor } = req;
    const { action, notes } = req.body;
    appendAudit(
      db,
      actor,
      "AUTH",
      action || "USER_LOGIN",
      actor.employeeCode,
      notes || `${actor.fullName} (${actor.roleId}) ${action === "USER_LOGOUT" ? "signed out of" : action === "IDLE_LOCK" ? "locked idle terminal on" : "signed into"} Saptari Hospital ERP.`,
      "INFO"
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });
  app.post("/api/orders", withAuth("orders.create"), (req, res) => {
    const { db, actor } = req;
    const {
      patientId,
      uhid,
      encounterType,
      encounterId,
      encounterLabel,
      nonInventoryBillOnly,
      patientName,
      patientAge,
      patientAgeType,
      patientGender,
      patientAddress,
      patientPhone,
      patientEmail,
      referringDoctor,
      referralPartnerId,
      collectionCenterId,
      priority,
      serviceIds,
      serviceQuantities,
      customPrices,
      discountAmount,
      paymentMode,
      cashPaid,
      bankPaid,
      bankAccountId,
      fiscalYear,
      creditOverride,
      creditOverrideReason
    } = req.body;
    if (!patientName?.trim() || !Array.isArray(serviceIds) || serviceIds.length === 0) {
      res.status(400).json({ error: "Patient name and at least one test/service are required." });
      return;
    }
    const selectedServices = serviceIds.map((id) => db.services.find((s) => s.id === id)).filter((s) => Boolean(s));
    if (selectedServices.length === 0) {
      res.status(400).json({ error: "No valid services selected from Service Master." });
      return;
    }
    const resolveItemPrice = (srv) => {
      const override = customPrices?.[srv.id];
      if (override !== void 0 && Number.isFinite(Number(override)) && Number(override) >= 0) {
        return Number(override);
      }
      return srv.price;
    };
    const resolveItemQty = (srv) => {
      const raw = Number(serviceQuantities?.[srv.id]);
      if (!Number.isFinite(raw) || raw < 1) return 1;
      return Math.min(999, Math.round(raw));
    };
    const subtotalAmount = Number(
      selectedServices.reduce((sum, s) => sum + resolveItemPrice(s) * resolveItemQty(s), 0).toFixed(2)
    );
    const discount = Math.max(0, Math.min(subtotalAmount, Number(discountAmount) || 0));
    const totalAmount = Number((subtotalAmount - discount).toFixed(2));
    const effectivePaymentMode = paymentMode || "Cash";
    const cashAmt = effectivePaymentMode === "Cash" ? Number(cashPaid ?? totalAmount) : effectivePaymentMode === "Split" ? Number(cashPaid || 0) : 0;
    const bankAmt = effectivePaymentMode === "Bank / QR" ? Number(bankPaid ?? totalAmount) : effectivePaymentMode === "Split" ? Number(bankPaid || 0) : 0;
    const paidAmount = Number(Math.min(totalAmount, cashAmt + bankAmt).toFixed(2));
    const dueAmount = Number(Math.max(0, totalAmount - paidAmount).toFixed(2));
    const referralPartner = referralPartnerId ? db.referrals.find((r) => r.id === referralPartnerId) : void 0;
    const patientRec = upsertPatientMaster(db, {
      patientId,
      uhid,
      fullName: patientName.trim(),
      age: Number(patientAge) || 30,
      ageType: patientAgeType || "Years",
      gender: patientGender || "Male",
      phone: patientPhone,
      address: patientAddress,
      email: patientEmail,
      actorName: actor.fullName
    });
    const now = /* @__PURE__ */ new Date();
    const bsNow = adToBs(now);
    const activeFy = fiscalYear || db.settings.activeFiscalYear || bsNow.fiscalYear;
    const orderNum = 1045 + db.orders.length + 1;
    const ms = db.settings.moduleSettings;
    const labPfx = ms?.labOrderPrefix || "SAP";
    const billPfx = ms?.billPrefix || "BILL";
    const accessionNumber = `${labPfx}-${bsNow.year}-${orderNum}`;
    const invoiceNumber = `${billPfx}-${bsNow.year}-${orderNum}`;
    const priorityFactor = priority === "STAT" ? 0.5 : 1;
    const testItems = selectedServices.map((srv) => {
      const effectiveUnitPrice = resolveItemPrice(srv);
      const qty = resolveItemQty(srv);
      const lineTotalPrice = Number((effectiveUnitPrice * qty).toFixed(2));
      const effectiveTat = Math.max(30, Math.round(srv.tatMinutes * priorityFactor));
      const dueAt = new Date(now.getTime() + effectiveTat * 6e4).toISOString();
      const comm = computeTestReferralCommission(referralPartner, {
        ...srv,
        price: lineTotalPrice
      });
      return {
        serviceId: srv.id,
        serviceCode: srv.code,
        serviceName: srv.name,
        serviceCategory: srv.serviceCategory || (srv.department === "Radiology" ? "RADIOLOGY" : "PATHOLOGY"),
        modality: srv.modality,
        department: srv.department,
        methodology: srv.methodology,
        tatMinutes: effectiveTat,
        dueAt,
        quantity: qty,
        unitPrice: effectiveUnitPrice,
        price: lineTotalPrice,
        referralCommissionNpr: comm,
        reagentsDeducted: false,
        status: "Pending",
        interpretation: "",
        parameterResults: srv.parameters.map((p) => {
          const ref = getRefRange(p, patientGender || "Male");
          return {
            parameterId: p.id,
            parameterName: p.name,
            resultType: p.resultType || "NUMERIC",
            unit: p.unit,
            value: null,
            refRangeDisplay: ref.display,
            flag: "NORMAL"
          };
        })
      };
    });
    const referralCommissionTotal = Number(
      testItems.reduce((sum, t) => sum + t.referralCommissionNpr, 0).toFixed(2)
    );
    const maxDueAt = testItems.reduce(
      (latest, t) => new Date(t.dueAt).getTime() > new Date(latest).getTime() ? t.dueAt : latest,
      testItems[0].dueAt
    );
    const encType = encounterType || "WALKING";
    const resolvedEncLabel = encounterLabel?.trim() || `${encType}: ${patientRec.uhid}`;
    const newOrder = {
      id: `ord-${Date.now()}`,
      accessionNumber,
      invoiceNumber,
      fiscalYear: activeFy,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterType: encType,
      encounterId,
      encounterLabel: resolvedEncLabel,
      nonInventoryBillOnly: Boolean(nonInventoryBillOnly),
      patientName: patientRec.fullName,
      patientAge: Number(patientAge) || patientRec.age,
      patientAgeType: patientAgeType || patientRec.ageType,
      patientGender: patientGender || patientRec.gender,
      patientAddress: patientAddress?.trim() || patientRec.address,
      patientPhone: patientPhone?.trim() || patientRec.phone,
      patientEmail: patientEmail?.trim() || "",
      referringDoctor: referralPartner ? referralPartner.name : referringDoctor || "Self / Walk-in",
      referralPartnerId: referralPartner ? referralPartner.id : null,
      referralPartnerName: referralPartner ? referralPartner.name : null,
      referralCommissionTotal,
      collectionCenterId: null,
      collectionCenterName: "Saptari Hospital Billing Counter",
      priority: priority || "Routine",
      status: "Ordered",
      orderedAt: now.toISOString(),
      collectedAt: null,
      receivedInLabAt: null,
      resultedAt: null,
      validatedAt: null,
      validatedById: null,
      validatedByName: null,
      validatedByDesignation: null,
      validatedByRegNo: null,
      dueAt: maxDueAt,
      subtotalAmount,
      discountAmount: discount,
      totalAmount,
      paidAmount,
      dueAmount,
      paymentMode: effectivePaymentMode,
      cashPaid: cashAmt,
      bankPaid: bankAmt,
      bankAccountId,
      creditOverrideApplied: Boolean(creditOverride),
      creditOverrideReason: creditOverride ? creditOverrideReason || "Admin override" : void 0,
      emailSent: false,
      apiSent: false,
      createdById: actor.id,
      createdByName: actor.fullName,
      tests: testItems
    };
    if (cashAmt > 0) {
      const cashAcc = db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.type === "CASH_COUNTER");
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          "INFLOW",
          cashAmt,
          "POS_COLLECTION",
          invoiceNumber,
          `Hospital POS Cash [${encType}]${nonInventoryBillOnly ? " [Bill-Only]" : ""} for ${newOrder.patientName} (${accessionNumber})`,
          activeFy,
          actor
        );
      }
    }
    if (bankAmt > 0) {
      const bankAcc = bankAccountId && db.accounts.find((a) => a.id === bankAccountId) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.type === "BANK");
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          "INFLOW",
          bankAmt,
          "POS_COLLECTION",
          invoiceNumber,
          `Hospital POS Bank/QR [${encType}]${nonInventoryBillOnly ? " [Bill-Only]" : ""} for ${newOrder.patientName} (${accessionNumber})`,
          activeFy,
          actor
        );
      }
    }
    if (referralPartner) {
      referralPartner.totalReferredSales = Number(
        (referralPartner.totalReferredSales + totalAmount).toFixed(2)
      );
      referralPartner.totalCommissionEarned = Number(
        (referralPartner.totalCommissionEarned + referralCommissionTotal).toFixed(2)
      );
    }
    db.orders.unshift(newOrder);
    appendAudit(
      db,
      actor,
      "POS_BILLING",
      creditOverride ? "POS_ORDER_CREDIT_OVERRIDE" : "POS_ORDER_CREATED",
      invoiceNumber,
      `Billed ${invoiceNumber} (${accessionNumber}) [${resolvedEncLabel}]${nonInventoryBillOnly ? " [NON-INVENTORY BILL-ONLY]" : ""} for ${newOrder.patientName} \u2014 \u0930\u0942 ${totalAmount.toLocaleString()} via ${effectivePaymentMode}.`,
      creditOverride ? "WARNING" : "INFO"
    );
    saveDb(db);
    res.status(201).json({ order: newOrder, patient: patientRec, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/orders/:id/advance", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "orders.advance") && !hasPermission(db, actor.roleId, "orders.collect")) {
      res.status(403).json({
        error: `Forbidden: Role '${actor.roleId}' lacks permission 'orders.advance' or 'orders.collect'.`
      });
      return;
    }
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (order.status === "Ordered") {
      order.status = "Collected";
      order.collectedAt = now;
    } else if (order.status === "Collected") {
      order.status = "In Lab";
      order.receivedInLabAt = now;
    } else {
      res.status(400).json({ error: `Order is already in stage '${order.status}'.` });
      return;
    }
    appendAudit(
      db,
      actor,
      "ORDERS",
      "SPECIMEN_ADVANCED",
      order.accessionNumber,
      `Advanced ${order.accessionNumber} specimen status to '${order.status}'.`
    );
    saveDb(db);
    res.json({ order, db });
  });
  app.post("/api/orders/:id/settle-due", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "finance.manage") && !hasPermission(db, actor.roleId, "pos.billing")) {
      res.status(403).json({
        error: `Forbidden: Role '${actor.roleId}' lacks permission to settle hospital credit dues.`
      });
      return;
    }
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Hospital order not found." });
      return;
    }
    const { amountNpr, paymentMode = "Cash", bankAccountId, note } = req.body;
    const currentDue = Number(
      (order.dueAmount !== void 0 ? order.dueAmount : Math.max(0, order.totalAmount - (order.paidAmount || 0))).toFixed(2)
    );
    const payAmt = Number(Math.min(currentDue, Math.max(0, Number(amountNpr) || 0)).toFixed(2));
    if (payAmt <= 0) {
      res.status(400).json({ error: "Order credit due is already zero or settlement amount is invalid." });
      return;
    }
    if (paymentMode === "Bank / QR") {
      order.bankPaid = Number(((order.bankPaid || 0) + payAmt).toFixed(2));
      const bankAcc = bankAccountId && db.accounts.find((a) => a.id === bankAccountId) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.type === "BANK");
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          "INFLOW",
          payAmt,
          "POS_COLLECTION",
          order.invoiceNumber,
          `Hospital Due Collection ${order.invoiceNumber} (${order.patientName})${note ? ` \xB7 ${note}` : ""}`,
          order.fiscalYear,
          actor
        );
      }
    } else {
      order.cashPaid = Number(((order.cashPaid || 0) + payAmt).toFixed(2));
      const cashAcc = db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.type === "CASH_COUNTER");
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          "INFLOW",
          payAmt,
          "POS_COLLECTION",
          order.invoiceNumber,
          `Hospital Due Collection ${order.invoiceNumber} (${order.patientName})${note ? ` \xB7 ${note}` : ""}`,
          order.fiscalYear,
          actor
        );
      }
    }
    order.paidAmount = Number(((order.paidAmount || 0) + payAmt).toFixed(2));
    order.dueAmount = Number(Math.max(0, order.totalAmount - order.paidAmount).toFixed(2));
    if (order.dueAmount <= 0 && order.paymentMode === "Credit") {
      order.paymentMode = paymentMode === "Bank / QR" ? "Bank / QR" : "Cash";
    }
    appendAudit(
      db,
      actor,
      "FINANCE",
      "ORDER_DUE_SETTLED",
      order.invoiceNumber,
      `Settled \u0930\u0942 ${payAmt.toLocaleString()} credit due on ${order.invoiceNumber} (${order.patientName}). Remaining due: \u0930\u0942 ${order.dueAmount.toLocaleString()}.`
    );
    saveDb(db);
    res.json({ order, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/orders/:id/results", withAuth("results.enter"), (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const wasValidatedOrDispatched = order.status === "Validated" || order.status === "Dispatched";
    if (wasValidatedOrDispatched && !hasPermission(db, actor.roleId, "results.validate")) {
      res.status(400).json({ error: "Validated reports can only be amended by an authorized Pathologist / Validator." });
      return;
    }
    const { testUpdates } = req.body;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (!order.collectedAt) order.collectedAt = now;
    if (!order.receivedInLabAt) order.receivedInLabAt = now;
    let hasCritical = false;
    for (const upd of testUpdates) {
      const orderTest = order.tests.find((t) => t.serviceId === upd.serviceId);
      const service = db.services.find((s) => s.id === upd.serviceId);
      if (!orderTest || !service) continue;
      const resolvedValues = evaluateParameterFormulas(service.parameters, upd.values || {});
      orderTest.parameterResults = orderTest.parameterResults.map((pr) => {
        const paramDef = service.parameters.find((p) => p.id === pr.parameterId);
        const isQual = (paramDef?.resultType || pr.resultType) === "QUALITATIVE";
        const rawVal = resolvedValues[pr.parameterId];
        const parsedVal = isQual ? rawVal === null || rawVal === void 0 || String(rawVal).trim() === "" ? null : String(rawVal).trim() : rawVal === null || rawVal === void 0 || rawVal === "" || Number.isNaN(Number(rawVal)) ? null : Number(rawVal);
        const autoFlag = paramDef ? evaluateParameterFlag(parsedVal, paramDef, order.patientGender) : "NORMAL";
        const flag = upd.flagOverrides?.[pr.parameterId] || autoFlag;
        if (flag === "CRITICAL_HIGH" || flag === "CRITICAL_LOW" || flag === "CRITICAL" || flag === "HIGH_RISK") {
          hasCritical = true;
        }
        return {
          ...pr,
          resultType: isQual ? "QUALITATIVE" : "NUMERIC",
          value: parsedVal,
          flag
        };
      });
      if (upd.interpretation !== void 0) {
        orderTest.interpretation = upd.interpretation.trim();
      }
      const allFilled = orderTest.parameterResults.every(
        (p) => p.value !== null && String(p.value).trim() !== ""
      );
      if (allFilled) {
        orderTest.status = wasValidatedOrDispatched ? "Validated" : "Resulted";
      }
    }
    if (wasValidatedOrDispatched) {
      order.status = order.status === "Dispatched" ? "Dispatched" : "Validated";
      order.validatedAt = now;
      order.validatedById = actor.id;
      order.validatedByName = actor.fullName;
      order.validatedByDesignation = actor.designation;
      order.validatedByRegNo = actor.registrationNumber || "NMC-VERIFIED";
    } else if (order.tests.every((t) => t.status === "Resulted" || t.status === "Validated")) {
      order.status = "Resulted";
      order.resultedAt = now;
    } else {
      order.status = "In Lab";
    }
    appendAudit(
      db,
      actor,
      "RESULTS",
      wasValidatedOrDispatched ? "RESULTS_AMENDED" : hasCritical ? "CRITICAL_VALUE_ENTERED" : "RESULTS_ENTERED",
      order.accessionNumber,
      `${wasValidatedOrDispatched ? "Amended validated laboratory results" : "Entered laboratory analyte results"} for ${order.accessionNumber}${hasCritical ? " (CRITICAL PANIC VALUE FLAGGED)" : ""}.`,
      hasCritical ? "CRITICAL" : wasValidatedOrDispatched ? "WARNING" : "INFO"
    );
    saveDb(db);
    res.json({ order, db });
  });
  app.post("/api/orders/:id/radiology-report", withAuth("radiology.report", "radiology_imaging"), (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const wasValidatedOrDispatched = order.status === "Validated" || order.status === "Dispatched";
    if (wasValidatedOrDispatched && !hasPermission(db, actor.roleId, "results.validate")) {
      res.status(400).json({ error: "Validated reports can only be amended by an authorized Pathologist / Radiologist / Validator." });
      return;
    }
    const { serviceId, radiologyReport } = req.body;
    const orderTest = order.tests.find((t) => t.serviceId === serviceId);
    if (!orderTest) {
      res.status(404).json({ error: "Ordered radiology study not found in order." });
      return;
    }
    if (!radiologyReport?.impression?.trim()) {
      res.status(400).json({ error: "Radiology Impression summary is required." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (!order.collectedAt) order.collectedAt = now;
    if (!order.receivedInLabAt) order.receivedInLabAt = now;
    orderTest.radiologyReport = {
      ...radiologyReport,
      filmsUsedCount: Math.max(0, Number(radiologyReport.filmsUsedCount) || 0),
      filmRetakeCount: Math.max(0, Number(radiologyReport.filmRetakeCount) || 0)
    };
    orderTest.interpretation = radiologyReport.impression.trim();
    orderTest.status = wasValidatedOrDispatched ? "Validated" : "Resulted";
    if (wasValidatedOrDispatched) {
      order.status = order.status === "Dispatched" ? "Dispatched" : "Validated";
      order.validatedAt = now;
      order.validatedById = actor.id;
      order.validatedByName = actor.fullName;
      order.validatedByDesignation = actor.designation;
      order.validatedByRegNo = actor.registrationNumber || "NMC-VERIFIED";
    } else if (order.tests.every((t) => t.status === "Resulted" || t.status === "Validated")) {
      order.status = "Resulted";
      order.resultedAt = now;
    } else {
      order.status = "In Lab";
    }
    appendAudit(
      db,
      actor,
      "RADIOLOGY",
      wasValidatedOrDispatched ? "RADIOLOGY_REPORT_AMENDED" : radiologyReport.criticalFinding ? "CRITICAL_RADIOLOGY_REPORT" : "RADIOLOGY_REPORT_SAVED",
      order.accessionNumber,
      `${wasValidatedOrDispatched ? "Amended validated " : "Saved "}${orderTest.modality || "IMAGING"} report for ${orderTest.serviceCode} (Films: ${orderTest.radiologyReport.filmsUsedCount}, Retakes: ${orderTest.radiologyReport.filmRetakeCount})${radiologyReport.criticalFinding ? " [CRITICAL FINDING]" : ""}.`,
      radiologyReport.criticalFinding ? "CRITICAL" : wasValidatedOrDispatched ? "WARNING" : "INFO"
    );
    saveDb(db);
    res.json({ order, db });
  });
  app.post("/api/radiology/templates", withAuth("radiology.manage", "radiology_imaging"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim() || !body.modality || !body.normalImpression?.trim()) {
      res.status(400).json({ error: "Template name, modality, and normal impression are required." });
      return;
    }
    const existingIdx = body.id ? db.radiologyTemplates.findIndex((t) => t.id === body.id) : -1;
    const saved = {
      id: existingIdx >= 0 ? db.radiologyTemplates[existingIdx].id : `radtpl-${Date.now()}`,
      code: body.code?.trim().toUpperCase() || `TPL-${body.modality}-${db.radiologyTemplates.length + 1}`,
      name: body.name.trim(),
      modality: body.modality,
      serviceId: body.serviceId,
      technique: body.technique?.trim() || "Standard diagnostic imaging protocol.",
      indicationPrompt: body.indicationPrompt?.trim() || "Clinical evaluation",
      sections: Array.isArray(body.sections) && body.sections.length > 0 ? body.sections : [{ id: "sec-1", title: "Findings", defaultText: "Normal study." }],
      measurements: Array.isArray(body.measurements) ? body.measurements : [],
      normalImpression: body.normalImpression.trim(),
      advice: body.advice?.trim() || "Correlate clinically.",
      quickMacros: Array.isArray(body.quickMacros) ? body.quickMacros : [],
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: actor.fullName
    };
    if (existingIdx >= 0) {
      db.radiologyTemplates[existingIdx] = saved;
    } else {
      db.radiologyTemplates.unshift(saved);
    }
    appendAudit(
      db,
      actor,
      "RADIOLOGY",
      existingIdx >= 0 ? "RADIOLOGY_TEMPLATE_UPDATED" : "RADIOLOGY_TEMPLATE_CREATED",
      saved.code,
      `Saved radiology template '${saved.name}' (${saved.modality}).`
    );
    saveDb(db);
    res.json({ template: saved, db });
  });
  app.delete("/api/radiology/templates/:id", withAuth("radiology.manage", "radiology_imaging"), (req, res) => {
    const { db, actor } = req;
    const idx = db.radiologyTemplates.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Radiology template not found." });
      return;
    }
    const [removed] = db.radiologyTemplates.splice(idx, 1);
    appendAudit(db, actor, "RADIOLOGY", "RADIOLOGY_TEMPLATE_DELETED", removed.code, `Deleted radiology template '${removed.name}'.`, "WARNING");
    saveDb(db);
    res.json({ ok: true, db });
  });
  app.post("/api/orders/:id/validate", withAuth("results.validate"), async (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (order.status === "Validated" || order.status === "Dispatched") {
      res.status(400).json({ error: "Order is already validated." });
      return;
    }
    const incomplete = order.tests.some((t) => {
      const isRad = t.serviceCategory === "RADIOLOGY" || t.department === "Radiology";
      if (isRad) {
        return !t.radiologyReport || !t.radiologyReport.impression?.trim();
      }
      return t.parameterResults.some((p) => p.value === null || String(p.value).trim() === "");
    });
    if (incomplete) {
      res.status(400).json({
        error: "All pathology parameters and radiology study impressions must be completed before final sign-off."
      });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const deductedLog = [];
    const lowStockWarnings = [];
    const skipDeduction = Boolean(order.nonInventoryBillOnly);
    for (const orderTest of order.tests) {
      if (!skipDeduction && !orderTest.reagentsDeducted) {
        const service = db.services.find((s) => s.id === orderTest.serviceId);
        if (service) {
          for (const bom of service.reagentBom) {
            const reagent = db.reagents.find((r) => r.id === bom.reagentId);
            if (reagent && reagent.autoDeductEnabled) {
              const isFilm = reagent.category === "X-Ray Film" && orderTest.radiologyReport;
              const baseQty = isFilm ? Math.max(0, orderTest.radiologyReport.filmsUsedCount) : bom.quantityPerTest;
              const retakeQty = isFilm ? Math.max(0, orderTest.radiologyReport.filmRetakeCount) : 0;
              const totalDeduct = Number((baseQty + retakeQty).toFixed(2));
              if (totalDeduct > 0) {
                const prev = reagent.currentStock;
                const nextStock = Math.max(0, Number((prev - totalDeduct).toFixed(2)));
                reagent.currentStock = nextStock;
                if (baseQty > 0) {
                  db.inventoryMovements.unshift({
                    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
                    timestamp: now,
                    reagentId: reagent.id,
                    reagentName: reagent.name,
                    lotNumber: reagent.lotNumber,
                    type: "AUTO_DEDUCT",
                    quantityDelta: -baseQty,
                    balanceAfter: nextStock + retakeQty,
                    referenceId: order.accessionNumber,
                    performedBy: actor.fullName,
                    notes: `Auto-deducted for ${service.code} validation`
                  });
                }
                if (retakeQty > 0) {
                  db.inventoryMovements.unshift({
                    id: `mov-${Date.now()}-rt-${Math.random().toString(36).slice(2, 5)}`,
                    timestamp: now,
                    reagentId: reagent.id,
                    reagentName: reagent.name,
                    lotNumber: reagent.lotNumber,
                    type: "FILM_RETAKE",
                    quantityDelta: -retakeQty,
                    balanceAfter: nextStock,
                    referenceId: order.accessionNumber,
                    performedBy: actor.fullName,
                    notes: `Radiology X-Ray film retake wastage (${retakeQty} films) on ${service.code}`
                  });
                }
                deductedLog.push(`${reagent.sku}: -${totalDeduct} ${reagent.unit}`);
                if (nextStock <= reagent.reorderLevel) {
                  lowStockWarnings.push(`${reagent.name} (${nextStock} ${reagent.unit} left)`);
                }
              }
            }
          }
        }
        orderTest.reagentsDeducted = true;
      }
      orderTest.status = "Validated";
    }
    order.status = "Validated";
    order.validatedAt = now;
    order.validatedById = actor.id;
    order.validatedByName = actor.fullName;
    order.validatedByDesignation = actor.designation;
    order.validatedByRegNo = actor.registrationNumber || "NMC-VERIFIED";
    appendAudit(
      db,
      actor,
      "RESULTS",
      "REPORT_VALIDATED",
      order.accessionNumber,
      `Digitally signed off ${order.accessionNumber}. ${skipDeduction ? "Non-Inventory Bill-Only (Zero stock deducted)" : `Auto-deducted reagents: ${deductedLog.join(", ") || "None"}`}.`,
      lowStockWarnings.length > 0 ? "WARNING" : "INFO"
    );
    if (lowStockWarnings.length > 0) {
      appendAudit(
        db,
        actor,
        "INVENTORY",
        "LOW_STOCK_TRIGGERED",
        order.accessionNumber,
        `Reorder threshold breached after test validation: ${lowStockWarnings.join("; ")}.`,
        "WARNING"
      );
    }
    let emailTriggered = null;
    if (db.settings.autoEmailOnValidate && order.patientEmail) {
      emailTriggered = createEmailNotification(db, order, "AUTO_ON_VALIDATE", actor);
    }
    let apiTriggered = null;
    if (db.saas) {
      db.saas.archivedReportMediaMb = Number(((db.saas.archivedReportMediaMb || 0) + 0.45).toFixed(2));
    }
    saveDb(db);
    res.json({ order, emailTriggered, apiTriggered, lowStockWarnings, db });
  });
  app.post("/api/reports/:id/send-email", withAuth("reports.email", "dispatch_api"), (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const { recipientEmail } = req.body;
    if (recipientEmail && recipientEmail.trim()) {
      order.patientEmail = recipientEmail.trim();
    }
    const email = createEmailNotification(db, order, "MANUAL_RESEND", actor);
    saveDb(db);
    res.json({ email, db });
  });
  app.post("/api/reports/:id/send-api", withAuth("reports.api_send", "dispatch_api"), async (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const { targetUrl } = req.body;
    const finalUrl = (targetUrl || db.settings.defaultWebhookUrl).trim();
    if (!finalUrl) {
      res.status(400).json({ error: "Target webhook URL is required." });
      return;
    }
    const log = await dispatchApiReport(db, order, finalUrl, actor, PORT);
    saveDb(db);
    res.json({ dispatch: log, db });
  });
  app.post("/api/reports/:id/log-print", withAuth("reports.print"), (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    const { mode } = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    order.printedAt = nowIso;
    order.printedBy = actor.fullName;
    order.printCount = (order.printCount || 0) + 1;
    if (db.saas) {
      db.saas.archivedReportMediaMb = Number(((db.saas.archivedReportMediaMb || 0) + 0.18).toFixed(2));
    }
    appendAudit(
      db,
      actor,
      "REPORTS",
      "A4_REPORT_PRINTED",
      order.accessionNumber,
      `Printed diagnostic report #${order.printCount} (${mode === "with-letterhead" ? "With Letterhead" : "No Letterhead"}).`
    );
    saveDb(db);
    res.json({ ok: true, order, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/orders/:id/dispatch", withAuth("reports.print"), (req, res) => {
    const { db, actor } = req;
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (order.status !== "Validated" && order.status !== "Dispatched") {
      res.status(400).json({ error: "Report must be Validated before physical/patient dispatch." });
      return;
    }
    const { dispatchMode = "Hand Counter Delivery", dispatchNotes } = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    order.status = "Dispatched";
    if (!order.printedAt) {
      order.printedAt = nowIso;
      order.printedBy = actor.fullName;
      order.printCount = Math.max(1, order.printCount || 0);
    }
    order.dispatchedAt = nowIso;
    order.dispatchedBy = actor.fullName;
    order.dispatchMode = dispatchMode.trim() || "Hand Counter Delivery";
    if (dispatchNotes?.trim()) {
      order.dispatchNotes = dispatchNotes.trim();
    }
    appendAudit(
      db,
      actor,
      "REPORTS",
      "REPORT_DISPATCHED",
      order.accessionNumber,
      `Dispatched report for ${order.patientName} (${order.accessionNumber}) via ${order.dispatchMode}.`
    );
    saveDb(db);
    res.json({ order, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/services", withAuth("services.manage"), (req, res) => {
    const { db, actor } = req;
    const service = req.body;
    if (!service.code?.trim() || !service.name?.trim()) {
      res.status(400).json({ error: "Service code and name are required." });
      return;
    }
    const existingIdx = db.services.findIndex((s) => s.id === service.id);
    if (existingIdx >= 0) {
      db.services[existingIdx] = service;
      appendAudit(db, actor, "SERVICES", "SERVICE_UPDATED", service.code, `Updated Service Master ${service.code} (${service.name}) \xB7 Fee \u0930\u0942 ${service.price} \xB7 TAT ${service.tatMinutes}m \xB7 ${service.parameters.length} parameters.`);
    } else {
      const created = {
        ...service,
        id: `srv-${Date.now()}`
      };
      db.services.push(created);
      appendAudit(db, actor, "SERVICES", "SERVICE_CREATED", created.code, `Added Service Master test ${created.code} (${created.name}) \xB7 Fee \u0930\u0942 ${created.price}.`);
    }
    saveDb(db);
    res.json({ db });
  });
  app.delete("/api/services/:id", withAuth("services.manage"), (req, res) => {
    const { db, actor } = req;
    const idx = db.services.findIndex((s) => s.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Service test not found." });
      return;
    }
    const removed = db.services[idx];
    db.services.splice(idx, 1);
    appendAudit(db, actor, "SERVICES", "SERVICE_DELETED", removed.code, `Deleted test ${removed.code} (${removed.name}) from Service Master.`, "WARNING");
    saveDb(db);
    res.json({ db });
  });
  app.post("/api/inventory", withAuth("inventory.manage", "inventory_erp"), (req, res) => {
    const { db, actor } = req;
    const item = req.body;
    if (!item.sku?.trim() || !item.name?.trim()) {
      res.status(400).json({ error: "Reagent SKU and name are required." });
      return;
    }
    const created = {
      ...item,
      id: `reg-${Date.now()}`,
      lastRestockedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.reagents.unshift(created);
    db.inventoryMovements.unshift({
      id: `mov-${Date.now()}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      reagentId: created.id,
      reagentName: created.name,
      lotNumber: created.lotNumber,
      type: "RESTOCK",
      quantityDelta: created.currentStock,
      balanceAfter: created.currentStock,
      referenceId: "INIT-LOT",
      performedBy: actor.fullName,
      notes: `New reagent lot onboarded (${created.storageCondition})`
    });
    appendAudit(db, actor, "INVENTORY", "REAGENT_ADDED", created.sku, `Added reagent ${created.name} (Lot ${created.lotNumber}, Stock ${created.currentStock} ${created.unit}).`);
    saveDb(db);
    res.status(201).json({ db });
  });
  app.post("/api/inventory/:id/restock", withAuth("inventory.manage", "inventory_erp"), (req, res) => {
    const { db, actor } = req;
    const reagent = db.reagents.find((r) => r.id === req.params.id);
    if (!reagent) {
      res.status(404).json({ error: "Reagent not found." });
      return;
    }
    const { quantity, lotNumber, expiryDate, notes } = req.body;
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      res.status(400).json({ error: "Positive restock quantity is required." });
      return;
    }
    reagent.currentStock = Number((reagent.currentStock + qty).toFixed(2));
    if (lotNumber?.trim()) reagent.lotNumber = lotNumber.trim();
    if (expiryDate?.trim()) reagent.expiryDate = expiryDate.trim();
    reagent.lastRestockedAt = (/* @__PURE__ */ new Date()).toISOString();
    db.inventoryMovements.unshift({
      id: `mov-${Date.now()}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      reagentId: reagent.id,
      reagentName: reagent.name,
      lotNumber: reagent.lotNumber,
      type: "RESTOCK",
      quantityDelta: qty,
      balanceAfter: reagent.currentStock,
      referenceId: `PO-${Date.now().toString().slice(-5)}`,
      performedBy: actor.fullName,
      notes: notes || "Verified cold-chain restock receipt"
    });
    appendAudit(db, actor, "INVENTORY", "REAGENT_RESTOCKED", reagent.sku, `Restocked +${qty} ${reagent.unit} of ${reagent.name} (Lot ${reagent.lotNumber}).`);
    saveDb(db);
    res.json({ db });
  });
  app.post("/api/inventory/:id/adjust", withAuth("inventory.manage", "inventory_erp"), (req, res) => {
    const { db, actor } = req;
    const reagent = db.reagents.find((r) => r.id === req.params.id);
    if (!reagent) {
      res.status(404).json({ error: "Reagent not found." });
      return;
    }
    const { delta, type, notes } = req.body;
    const numDelta = Number(delta);
    if (!numDelta || Number.isNaN(numDelta)) {
      res.status(400).json({ error: "Non-zero adjustment quantity is required." });
      return;
    }
    reagent.currentStock = Math.max(0, Number((reagent.currentStock + numDelta).toFixed(2)));
    db.inventoryMovements.unshift({
      id: `mov-${Date.now()}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      reagentId: reagent.id,
      reagentName: reagent.name,
      lotNumber: reagent.lotNumber,
      type: type || "ADJUSTMENT",
      quantityDelta: numDelta,
      balanceAfter: reagent.currentStock,
      performedBy: actor.fullName,
      notes: notes || "Manual inventory reconciliation"
    });
    appendAudit(db, actor, "INVENTORY", type || "STOCK_ADJUSTMENT", reagent.sku, `Adjusted ${reagent.name} by ${numDelta} ${reagent.unit}: ${notes || "Reconciliation"}`, "WARNING");
    saveDb(db);
    res.json({ db });
  });
  app.post("/api/referrals", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim() || !body.code?.trim()) {
      res.status(400).json({ error: "Referral partner code and name are required." });
      return;
    }
    const created = {
      id: `ref-${Date.now()}`,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      type: body.type || "Physician",
      phone: body.phone || "",
      address: body.address || "",
      bankName: body.bankName || "",
      bankBranch: body.bankBranch || "",
      accountHolderName: body.accountHolderName || body.name.trim(),
      accountNumber: body.accountNumber || "",
      walletId: body.walletId || "",
      panNumber: body.panNumber || "",
      defaultMode: body.defaultMode || "PERCENT",
      defaultValue: Number(body.defaultValue) || 15,
      testOverrides: body.testOverrides || [],
      totalReferredSales: 0,
      totalCommissionEarned: 0,
      totalCommissionPaid: 0,
      active: true
    };
    db.referrals.unshift(created);
    appendAudit(db, actor, "REFERRALS", "REFERRAL_CREATED", created.code, `Added referral partner ${created.name} (${created.defaultMode} ${created.defaultValue}).`);
    saveDb(db);
    res.status(201).json({ db });
  });
  app.patch("/api/referrals/:id", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const partner = db.referrals.find((r) => r.id === req.params.id);
    if (!partner) {
      res.status(404).json({ error: "Referral partner not found." });
      return;
    }
    Object.assign(partner, req.body);
    appendAudit(db, actor, "REFERRALS", "REFERRAL_UPDATED", partner.code, `Updated commission rules & account details for ${partner.name}.`);
    saveDb(db);
    res.json({ db });
  });
  app.post("/api/referrals/:id/payout-request", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const partner = db.referrals.find((r) => r.id === req.params.id);
    if (!partner) {
      res.status(404).json({ error: "Referral partner not found." });
      return;
    }
    const { amount, accountId, bankName, accountNumber, accountHolderName, paymentRefOrReceipt, notes } = req.body;
    const payAmt = Number(amount);
    const pending = Math.max(0, partner.totalCommissionEarned - partner.totalCommissionPaid);
    if (!payAmt || payAmt <= 0 || payAmt > pending + 0.01) {
      res.status(400).json({ error: `Payout request must be between \u0930\u0942 1 and pending \u0930\u0942 ${pending.toFixed(2)}.` });
      return;
    }
    const targetAccountId = accountId || db.accounts[0]?.id || "acc-bank-1";
    const destSummary = bankName?.trim() && accountNumber?.trim() ? `${bankName.trim()} A/C ${accountNumber.trim()} (${accountHolderName?.trim() || partner.accountHolderName || partner.name})` : partner.accountNumber ? `${partner.bankName || "Bank"} A/C ${partner.accountNumber} (${partner.accountHolderName || partner.name})` : partner.walletId ? `Wallet ${partner.walletId} (${partner.name})` : `Cash Settlement (${partner.name})`;
    const bsNow = adToBs(/* @__PURE__ */ new Date());
    const requestEntry = {
      id: `rpay-${Date.now()}`,
      requestNumber: `RPY-${bsNow.year}-${String((db.referralPayoutRequests || []).length + 1).padStart(3, "0")}`,
      partnerId: partner.id,
      partnerName: partner.name,
      partnerCode: partner.code,
      amountNpr: Number(payAmt.toFixed(2)),
      targetAccountId,
      destinationSummary: destSummary,
      paymentRefOrReceipt: paymentRefOrReceipt?.trim() || "",
      requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
      requestedBy: actor.fullName,
      status: "Pending Admin Approval",
      notes: notes?.trim() || "Commission disbursement request for Admin approval"
    };
    if (!Array.isArray(db.referralPayoutRequests)) db.referralPayoutRequests = [];
    db.referralPayoutRequests.unshift(requestEntry);
    appendAudit(
      db,
      actor,
      "REFERRALS",
      "REFERRAL_PAYOUT_REQUESTED",
      requestEntry.requestNumber,
      `Submitted Referral Payout Request ${requestEntry.requestNumber} for ${partner.name} (\u0930\u0942 ${payAmt.toLocaleString()}) -> ${destSummary}. Awaiting Admin Approval.`,
      "WARNING"
    );
    saveDb(db);
    res.status(201).json({ request: requestEntry, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/referrals/payout-requests/:reqId/approve", withAuth("referrals.approve_payout", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const payoutReq = (db.referralPayoutRequests || []).find((r) => r.id === req.params.reqId);
    if (!payoutReq) {
      res.status(404).json({ error: "Referral payout request not found." });
      return;
    }
    if (payoutReq.status !== "Pending Admin Approval") {
      res.status(409).json({ error: `Payout request is already ${payoutReq.status}.` });
      return;
    }
    const partner = db.referrals.find((p) => p.id === payoutReq.partnerId);
    if (!partner) {
      res.status(404).json({ error: "Referral partner not found." });
      return;
    }
    const { accountId, approvalRemarks, paymentRefOrReceipt } = req.body || {};
    const acc = db.accounts.find((a) => a.id === (accountId || payoutReq.targetAccountId)) || db.accounts[0];
    if (!acc) {
      res.status(400).json({ error: "Treasury Cash/Bank account not found." });
      return;
    }
    partner.totalCommissionPaid = Number((partner.totalCommissionPaid + payoutReq.amountNpr).toFixed(2));
    payoutReq.status = "Approved & Paid";
    payoutReq.reviewedAt = (/* @__PURE__ */ new Date()).toISOString();
    payoutReq.reviewedBy = actor.fullName;
    payoutReq.approvalRemarks = approvalRemarks?.trim() || "Verified payment proof & approved by Hospital Admin.";
    if (paymentRefOrReceipt?.trim()) {
      payoutReq.paymentRefOrReceipt = paymentRefOrReceipt.trim();
    }
    postLedgerMovement(
      db,
      acc,
      "OUTFLOW",
      payoutReq.amountNpr,
      "REFERRAL_PAYOUT",
      payoutReq.requestNumber,
      `Admin-Approved Referral Payout to ${partner.name} (${payoutReq.destinationSummary})${payoutReq.paymentRefOrReceipt ? ` [Ref: ${payoutReq.paymentRefOrReceipt}]` : ""}`,
      db.settings.activeFiscalYear,
      actor
    );
    appendAudit(
      db,
      actor,
      "REFERRALS",
      "REFERRAL_PAYOUT_APPROVED",
      payoutReq.requestNumber,
      `Admin approved & settled Referral Payout ${payoutReq.requestNumber} for ${partner.name}: \u0930\u0942 ${payoutReq.amountNpr.toLocaleString()} from ${acc.name}.`
    );
    saveDb(db);
    res.json({ request: payoutReq, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/referrals/payout-requests/:reqId/reject", withAuth("referrals.approve_payout", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const payoutReq = (db.referralPayoutRequests || []).find((r) => r.id === req.params.reqId);
    if (!payoutReq) {
      res.status(404).json({ error: "Referral payout request not found." });
      return;
    }
    if (payoutReq.status !== "Pending Admin Approval") {
      res.status(409).json({ error: `Payout request is already ${payoutReq.status}.` });
      return;
    }
    const { approvalRemarks } = req.body || {};
    payoutReq.status = "Rejected";
    payoutReq.reviewedAt = (/* @__PURE__ */ new Date()).toISOString();
    payoutReq.reviewedBy = actor.fullName;
    payoutReq.approvalRemarks = approvalRemarks?.trim() || "Rejected by Hospital Admin during verification.";
    appendAudit(
      db,
      actor,
      "REFERRALS",
      "REFERRAL_PAYOUT_REJECTED",
      payoutReq.requestNumber,
      `Admin rejected Referral Payout ${payoutReq.requestNumber} for ${payoutReq.partnerName}. Reason: ${payoutReq.approvalRemarks}`,
      "WARNING"
    );
    saveDb(db);
    res.json({ request: payoutReq, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/referrals/:id/payout", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const partner = db.referrals.find((r) => r.id === req.params.id);
    if (!partner) {
      res.status(404).json({ error: "Referral partner not found." });
      return;
    }
    const { amount, accountId, notes, paymentRefOrReceipt } = req.body;
    const payAmt = Number(amount);
    const pending = Math.max(0, partner.totalCommissionEarned - partner.totalCommissionPaid);
    if (!payAmt || payAmt <= 0 || payAmt > pending + 0.01) {
      res.status(400).json({ error: `Payout must be between \u0930\u0942 1 and pending \u0930\u0942 ${pending.toFixed(2)}.` });
      return;
    }
    const acc = db.accounts.find((a) => a.id === accountId) || db.accounts[0];
    if (!acc) {
      res.status(400).json({ error: "Payment account not found." });
      return;
    }
    const bsNow = adToBs(/* @__PURE__ */ new Date());
    const canAutoApprove = hasPermission(db, actor.roleId, "referrals.approve_payout");
    const destSummary = partner.accountNumber ? `${partner.bankName || "Bank"} A/C ${partner.accountNumber}` : partner.walletId ? `Wallet ${partner.walletId}` : "Cash Settlement";
    const requestEntry = {
      id: `rpay-${Date.now()}`,
      requestNumber: `RPY-${bsNow.year}-${String((db.referralPayoutRequests || []).length + 1).padStart(3, "0")}`,
      partnerId: partner.id,
      partnerName: partner.name,
      partnerCode: partner.code,
      amountNpr: Number(payAmt.toFixed(2)),
      targetAccountId: acc.id,
      destinationSummary: destSummary,
      paymentRefOrReceipt: paymentRefOrReceipt?.trim() || "",
      requestedAt: (/* @__PURE__ */ new Date()).toISOString(),
      requestedBy: actor.fullName,
      status: canAutoApprove ? "Approved & Paid" : "Pending Admin Approval",
      notes: notes || `Referral commission payout to ${partner.name}`,
      ...canAutoApprove ? {
        reviewedAt: (/* @__PURE__ */ new Date()).toISOString(),
        reviewedBy: actor.fullName,
        approvalRemarks: "Direct Admin approval settlement"
      } : {}
    };
    if (!Array.isArray(db.referralPayoutRequests)) db.referralPayoutRequests = [];
    db.referralPayoutRequests.unshift(requestEntry);
    if (canAutoApprove) {
      partner.totalCommissionPaid = Number((partner.totalCommissionPaid + payAmt).toFixed(2));
      postLedgerMovement(
        db,
        acc,
        "OUTFLOW",
        payAmt,
        "REFERRAL_PAYOUT",
        requestEntry.requestNumber,
        notes || `Referral commission payout to ${partner.name}`,
        db.settings.activeFiscalYear,
        actor
      );
      appendAudit(db, actor, "REFERRALS", "COMMISSION_PAID", partner.code, `Paid \u0930\u0942 ${payAmt.toLocaleString()} commission to ${partner.name} from ${acc.name}.`);
    } else {
      appendAudit(db, actor, "REFERRALS", "REFERRAL_PAYOUT_REQUESTED", requestEntry.requestNumber, `Submitted payout request for \u0930\u0942 ${payAmt.toLocaleString()} to ${partner.name} for Admin approval.`, "WARNING");
    }
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });
  app.post("/api/finance/accounts", withAuth("finance.manage", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim() || !body.code?.trim()) {
      res.status(400).json({ error: "Account code and name are required." });
      return;
    }
    const acc = {
      id: `acc-${Date.now()}`,
      code: body.code.trim().toUpperCase(),
      name: body.name.trim(),
      type: body.type || "BANK",
      departmentScope: body.departmentScope || "HOSPITAL",
      bankName: body.bankName,
      accountNumber: body.accountNumber,
      branch: body.branch,
      currentBalance: Number(body.currentBalance) || 0
    };
    db.accounts.push(acc);
    appendAudit(db, actor, "FINANCE", "ACCOUNT_CREATED", acc.code, `Created ${acc.departmentScope || "HOSPITAL"} ${acc.type} account '${acc.name}' with opening balance \u0930\u0942 ${acc.currentBalance.toLocaleString()}.`);
    saveDb(db);
    res.status(201).json({ db });
  });
  const executeApprovedFinanceRequest = (db, reqItem, actor) => {
    const fy = reqItem.fiscalYear || db.settings.activeFiscalYear;
    const sourceAcc = db.accounts.find((a) => a.id === reqItem.accountId);
    if (!sourceAcc) return;
    if (reqItem.transactionType === "BANK_DEPOSIT") {
      const targetAcc = db.accounts.find((a) => a.id === reqItem.targetAccountId);
      if (targetAcc && targetAcc.id !== sourceAcc.id) {
        postLedgerMovement(
          db,
          sourceAcc,
          "OUTFLOW",
          reqItem.amountNpr,
          "BANK_TRANSFER",
          reqItem.referenceId,
          `Approved Transfer to ${targetAcc.name}: ${reqItem.reason} \u2014 ${reqItem.description}`,
          fy,
          actor
        );
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          reqItem.amountNpr,
          "BANK_TRANSFER",
          reqItem.referenceId,
          `Approved Deposit from ${sourceAcc.name}: ${reqItem.reason} \u2014 ${reqItem.description}`,
          fy,
          actor
        );
      }
    } else if (reqItem.transactionType === "EXPENSE" || reqItem.transactionType === "PAYMENT") {
      postLedgerMovement(
        db,
        sourceAcc,
        "OUTFLOW",
        reqItem.amountNpr,
        "EXPENSE",
        reqItem.referenceId,
        `${reqItem.reason}: ${reqItem.description}`,
        fy,
        actor
      );
    } else {
      postLedgerMovement(
        db,
        sourceAcc,
        "INFLOW",
        reqItem.amountNpr,
        "POS_COLLECTION",
        reqItem.referenceId,
        `${reqItem.reason}: ${reqItem.description}`,
        fy,
        actor
      );
    }
  };
  app.post("/api/finance/transaction", withAuth("finance.manage", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const { type, accountId, targetAccountId, amount, referenceId, description, reason, payeeOrParty, bypassApproval } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      res.status(400).json({ error: "Positive transaction amount is required." });
      return;
    }
    const sourceAcc = db.accounts.find((a) => a.id === accountId);
    if (!sourceAcc) {
      res.status(404).json({ error: "Source account not found." });
      return;
    }
    let targetAcc;
    if (type === "BANK_DEPOSIT") {
      targetAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (!targetAcc || targetAcc.id === sourceAcc.id) {
        res.status(400).json({ error: "Valid destination account required for transfer." });
        return;
      }
    }
    const requireTwoTier = db.settings?.moduleSettings?.requireTwoTierFinanceApproval !== false;
    const isAdmin = hasPermission(db, actor.roleId, "finance.approve_admin") || actor.roleId === "SUPER_ADMIN";
    const isManager = hasPermission(db, actor.roleId, "finance.approve_manager");
    const vPfx = db.settings?.moduleSettings?.voucherPrefix || "VCH";
    const ref = referenceId?.trim() || `${vPfx}-${Date.now().toString().slice(-5)}`;
    const fy = db.settings.activeFiscalYear;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const direction = type === "RECEIPT" ? "IN" : "OUT";
    const resolvedReason = reason?.trim() || description?.trim() || `${type} Request`;
    const resolvedDesc = description?.trim() || resolvedReason;
    if (!Array.isArray(db.financeApprovalRequests)) db.financeApprovalRequests = [];
    if (!requireTwoTier && bypassApproval && isAdmin) {
      const directReq = {
        id: `fap-${Date.now()}`,
        requestNumber: `FAP-${adToBs(nowIso).year}-${String(db.financeApprovalRequests.length + 1).padStart(3, "0")}`,
        fiscalYear: fy,
        createdAt: nowIso,
        updatedAt: nowIso,
        transactionType: type,
        direction,
        amountNpr: Number(amt.toFixed(2)),
        accountId: sourceAcc.id,
        accountName: sourceAcc.name,
        targetAccountId: targetAcc?.id,
        targetAccountName: targetAcc?.name,
        referenceId: ref,
        reason: resolvedReason,
        description: resolvedDesc,
        payeeOrParty: payeeOrParty?.trim(),
        requesterId: actor.id,
        requesterName: actor.fullName,
        requesterRole: actor.roleId,
        status: "APPROVED",
        adminReviewedBy: actor.fullName,
        adminReviewedAt: nowIso,
        reRequestCount: 0,
        history: [
          {
            id: `faph-${Date.now()}`,
            timestamp: nowIso,
            action: "APPROVED_BY_ADMIN",
            actorId: actor.id,
            actorName: actor.fullName,
            actorRole: actor.roleId,
            note: "Direct Admin entry posted immediately.",
            statusAfter: "APPROVED"
          }
        ]
      };
      db.financeApprovalRequests.unshift(directReq);
      executeApprovedFinanceRequest(db, directReq, actor);
      appendAudit(db, actor, "FINANCE", `FIN_${type}`, ref, `Direct ${type} of \u0930\u0942 ${amt.toLocaleString()} on ${sourceAcc.name}: ${resolvedDesc}`);
      saveDb(db);
      res.json({ db: scopeDbForActor(db, actor), request: directReq });
      return;
    }
    const initialStatus = isManager && !isAdmin ? "PENDING_ADMIN" : "PENDING_MANAGER";
    const history = [
      {
        id: `faph-${Date.now()}-1`,
        timestamp: nowIso,
        action: "REQUESTED",
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: `Submitted ${type} (${direction}) voucher for \u0930\u0942 ${amt.toLocaleString()} (${sourceAcc.name}).`,
        statusAfter: "PENDING_MANAGER"
      }
    ];
    if (initialStatus === "PENDING_ADMIN") {
      history.push({
        id: `faph-${Date.now()}-2`,
        timestamp: nowIso,
        action: "APPROVED_BY_MANAGER",
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: "Submitted by Manager; auto-advanced to Hospital Admin final review.",
        statusAfter: "PENDING_ADMIN"
      });
    }
    const requestEntry = {
      id: `fap-${Date.now()}`,
      requestNumber: `FAP-${adToBs(nowIso).year}-${String(db.financeApprovalRequests.length + 1).padStart(3, "0")}`,
      fiscalYear: fy,
      createdAt: nowIso,
      updatedAt: nowIso,
      transactionType: type,
      direction,
      amountNpr: Number(amt.toFixed(2)),
      accountId: sourceAcc.id,
      accountName: sourceAcc.name,
      targetAccountId: targetAcc?.id,
      targetAccountName: targetAcc?.name,
      referenceId: ref,
      reason: resolvedReason,
      description: resolvedDesc,
      payeeOrParty: payeeOrParty?.trim(),
      requesterId: actor.id,
      requesterName: actor.fullName,
      requesterRole: actor.roleId,
      status: initialStatus,
      ...initialStatus === "PENDING_ADMIN" ? { managerReviewedBy: actor.fullName, managerReviewedAt: nowIso } : {},
      reRequestCount: 0,
      history
    };
    db.financeApprovalRequests.unshift(requestEntry);
    appendAudit(
      db,
      actor,
      "FINANCE_APPROVAL",
      "FINANCE_REQUEST_SUBMITTED",
      requestEntry.requestNumber,
      `Submitted 2-Tier ${type} (${direction}) request ${requestEntry.requestNumber} for \u0930\u0942 ${amt.toLocaleString()} (${resolvedReason}). Status: ${initialStatus}.`,
      "INFO"
    );
    saveDb(db);
    res.status(201).json({ request: requestEntry, db: scopeDbForActor(db, actor) });
  });
  app.get("/api/finance/approval-requests", withAuth("finance.view", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const all = db.financeApprovalRequests || [];
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "ALL";
    const items = statusFilter === "ALL" ? all : all.filter((r) => r.status === statusFilter);
    const isAdmin = hasPermission(db, actor.roleId, "finance.approve_admin") || actor.roleId === "SUPER_ADMIN";
    const isManager = hasPermission(db, actor.roleId, "finance.approve_manager");
    const pendingManager = all.filter((r) => r.status === "PENDING_MANAGER");
    const pendingAdmin = all.filter((r) => r.status === "PENDING_ADMIN");
    const declined = all.filter((r) => r.status === "DECLINED");
    const approved = all.filter((r) => r.status === "APPROVED");
    const pendingForActor = all.filter((r) => {
      if (isAdmin) return r.status === "PENDING_MANAGER" || r.status === "PENDING_ADMIN";
      if (isManager) return r.status === "PENDING_MANAGER";
      return false;
    });
    const sumByDir = (list, dir) => Number(list.filter((r) => r.direction === dir).reduce((s, r) => s + r.amountNpr, 0).toFixed(2));
    res.json({
      items,
      summary: {
        pendingManagerCount: pendingManager.length,
        pendingAdminCount: pendingAdmin.length,
        pendingForMeCount: pendingForActor.length,
        totalPendingCount: pendingManager.length + pendingAdmin.length,
        declinedCount: declined.length,
        approvedCount: approved.length,
        pendingInflowNpr: sumByDir([...pendingManager, ...pendingAdmin], "IN"),
        pendingOutflowNpr: sumByDir([...pendingManager, ...pendingAdmin], "OUT")
      },
      actorPermissions: {
        canApproveManager: isManager || isAdmin,
        canApproveAdmin: isAdmin
      }
    });
  });
  app.post("/api/finance/approval-requests", withAuth("finance.view", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const { transactionType, accountId, targetAccountId, amountNpr, referenceId, reason, description, payeeOrParty } = req.body;
    const amt = Number(amountNpr);
    if (!amt || amt <= 0 || !reason?.trim()) {
      res.status(400).json({ error: "Positive amount and reason are required." });
      return;
    }
    const sourceAcc = db.accounts.find((a) => a.id === accountId);
    if (!sourceAcc) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    let targetAcc;
    if (transactionType === "BANK_DEPOSIT") {
      targetAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (!targetAcc || targetAcc.id === sourceAcc.id) {
        res.status(400).json({ error: "Valid destination account required for transfer." });
        return;
      }
    }
    if (!Array.isArray(db.financeApprovalRequests)) db.financeApprovalRequests = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const ref = referenceId?.trim() || `VCH-${Date.now().toString().slice(-5)}`;
    const direction = transactionType === "RECEIPT" ? "IN" : "OUT";
    const requestEntry = {
      id: `fap-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requestNumber: `FAP-${adToBs(nowIso).year}-${String(db.financeApprovalRequests.length + 1).padStart(3, "0")}`,
      fiscalYear: db.settings.activeFiscalYear,
      createdAt: nowIso,
      updatedAt: nowIso,
      transactionType: transactionType || "EXPENSE",
      direction,
      amountNpr: Number(amt.toFixed(2)),
      accountId: sourceAcc.id,
      accountName: sourceAcc.name,
      targetAccountId: targetAcc?.id,
      targetAccountName: targetAcc?.name,
      referenceId: ref,
      reason: reason.trim(),
      description: description?.trim() || reason.trim(),
      payeeOrParty: payeeOrParty?.trim(),
      requesterId: actor.id,
      requesterName: actor.fullName,
      requesterRole: actor.roleId,
      status: "PENDING_MANAGER",
      reRequestCount: 0,
      history: [
        {
          id: `faph-${Date.now()}`,
          timestamp: nowIso,
          action: "REQUESTED",
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          note: `Submitted ${transactionType} (${direction}) voucher for \u0930\u0942 ${amt.toLocaleString()}.`,
          statusAfter: "PENDING_MANAGER"
        }
      ]
    };
    db.financeApprovalRequests.unshift(requestEntry);
    appendAudit(
      db,
      actor,
      "FINANCE_APPROVAL",
      "FINANCE_REQUEST_SUBMITTED",
      requestEntry.requestNumber,
      `Submitted ${requestEntry.transactionType} request ${requestEntry.requestNumber} for \u0930\u0942 ${amt.toLocaleString()} (${requestEntry.reason}).`
    );
    saveDb(db);
    res.status(201).json({ request: requestEntry, db: scopeDbForActor(db, actor) });
  });
  const processApprovalDecision = (db, actor, item, decision, note) => {
    const isAdmin = hasPermission(db, actor.roleId, "finance.approve_admin") || actor.roleId === "SUPER_ADMIN";
    const isManager = hasPermission(db, actor.roleId, "finance.approve_manager") || isAdmin;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!Array.isArray(item.history)) item.history = [];
    if (item.status === "APPROVED" || item.status === "DECLINED") {
      return { ok: false, status: 400, error: `Request ${item.requestNumber} is already finalized (${item.status}).` };
    }
    if (decision === "DECLINE") {
      if (!isManager && !isAdmin) {
        return { ok: false, status: 403, error: "Only Manager or Admin can decline financial requests." };
      }
      const reasonText = note?.trim() || `Declined by ${actor.fullName}`;
      item.status = "DECLINED";
      item.declineReason = reasonText;
      item.updatedAt = nowIso;
      if (item.managerReviewedBy) {
        item.adminReviewedBy = actor.fullName;
        item.adminReviewedAt = nowIso;
      } else {
        item.managerReviewedBy = actor.fullName;
        item.managerReviewedAt = nowIso;
      }
      item.history.push({
        id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        action: "DECLINED",
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: reasonText,
        statusAfter: "DECLINED"
      });
      appendAudit(
        db,
        actor,
        "FINANCE_APPROVAL",
        "FINANCE_REQUEST_DECLINED",
        item.requestNumber,
        `Declined ${item.requestNumber} (\u0930\u0942 ${item.amountNpr.toLocaleString()} \xB7 ${item.reason}). Reason: ${reasonText}`,
        "WARNING"
      );
      return { ok: true };
    }
    if (item.status === "PENDING_MANAGER") {
      if (!isManager) {
        return { ok: false, status: 403, error: "Manager permission (finance.approve_manager) required for Tier-1 approval." };
      }
      item.status = "PENDING_ADMIN";
      item.managerReviewedBy = actor.fullName;
      item.managerReviewedAt = nowIso;
      item.updatedAt = nowIso;
      item.history.push({
        id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        action: "APPROVED_BY_MANAGER",
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: note?.trim() || "Manager Tier-1 verified; forwarded to Hospital Admin for final approval.",
        statusAfter: "PENDING_ADMIN"
      });
      appendAudit(
        db,
        actor,
        "FINANCE_APPROVAL",
        "FINANCE_MANAGER_APPROVED",
        item.requestNumber,
        `Manager approved ${item.requestNumber} (\u0930\u0942 ${item.amountNpr.toLocaleString()}) -> queued for Admin final sign-off.`
      );
      return { ok: true };
    }
    if (item.status === "PENDING_ADMIN") {
      if (!isAdmin) {
        return { ok: false, status: 403, error: "Admin permission (finance.approve_admin) required for final Tier-2 approval." };
      }
      item.status = "APPROVED";
      item.adminReviewedBy = actor.fullName;
      item.adminReviewedAt = nowIso;
      item.updatedAt = nowIso;
      item.history.push({
        id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        action: "APPROVED_BY_ADMIN",
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        note: note?.trim() || "Final Hospital Admin approval granted & posted to ledger.",
        statusAfter: "APPROVED"
      });
      executeApprovedFinanceRequest(db, item, actor);
      appendAudit(
        db,
        actor,
        "FINANCE_APPROVAL",
        "FINANCE_ADMIN_APPROVED",
        item.requestNumber,
        `Admin finalized ${item.requestNumber} (\u0930\u0942 ${item.amountNpr.toLocaleString()} \xB7 ${item.transactionType}) and posted to Treasury Ledger.`
      );
      return { ok: true };
    }
    return { ok: false, status: 400, error: "Unsupported status transition." };
  };
  app.post("/api/finance/approval-requests/:id/decision", withAuth("finance.view", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const item = (db.financeApprovalRequests || []).find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: "Finance approval request not found." });
      return;
    }
    const { decision, note } = req.body;
    if (decision !== "APPROVE" && decision !== "DECLINE") {
      res.status(400).json({ error: "Decision must be 'APPROVE' or 'DECLINE'." });
      return;
    }
    const outcome = processApprovalDecision(db, actor, item, decision, note);
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error });
      return;
    }
    saveDb(db);
    res.json({ request: item, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/finance/approval-requests/bulk-decision", withAuth("finance.view", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const { ids, decision, note } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "Select at least one pending request for bulk action." });
      return;
    }
    if (decision !== "APPROVE" && decision !== "DECLINE") {
      res.status(400).json({ error: "Decision must be 'APPROVE' or 'DECLINE'." });
      return;
    }
    const processed = [];
    const errors = [];
    for (const id of ids) {
      const item = (db.financeApprovalRequests || []).find((r) => r.id === id);
      if (!item) continue;
      const outcome = processApprovalDecision(db, actor, item, decision, note);
      if (outcome.ok) processed.push(item.requestNumber);
      else errors.push(`${item.requestNumber}: ${outcome.error}`);
    }
    if (processed.length === 0 && errors.length > 0) {
      res.status(403).json({ error: errors[0], errors });
      return;
    }
    saveDb(db);
    res.json({ processedCount: processed.length, processed, errors, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/finance/approval-requests/:id/re-request", withAuth("finance.view", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const item = (db.financeApprovalRequests || []).find((r) => r.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: "Finance approval request not found." });
      return;
    }
    if (item.status !== "DECLINED") {
      res.status(400).json({ error: "Only declined requests can be re-applied / re-requested." });
      return;
    }
    const { amountNpr, reason, description, referenceId, accountId, targetAccountId, note } = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (amountNpr !== void 0 && Number(amountNpr) > 0) item.amountNpr = Number(Number(amountNpr).toFixed(2));
    if (reason?.trim()) item.reason = reason.trim();
    if (description?.trim()) item.description = description.trim();
    if (referenceId?.trim()) item.referenceId = referenceId.trim();
    if (accountId) {
      const acc = db.accounts.find((a) => a.id === accountId);
      if (acc) {
        item.accountId = acc.id;
        item.accountName = acc.name;
      }
    }
    if (targetAccountId) {
      const tAcc = db.accounts.find((a) => a.id === targetAccountId);
      if (tAcc) {
        item.targetAccountId = tAcc.id;
        item.targetAccountName = tAcc.name;
      }
    }
    item.status = "PENDING_MANAGER";
    item.declineReason = void 0;
    item.managerReviewedBy = void 0;
    item.managerReviewedAt = void 0;
    item.adminReviewedBy = void 0;
    item.adminReviewedAt = void 0;
    item.updatedAt = nowIso;
    item.reRequestCount = (item.reRequestCount || 0) + 1;
    if (!Array.isArray(item.history)) item.history = [];
    item.history.push({
      id: `faph-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      timestamp: nowIso,
      action: "RE_REQUESTED",
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.roleId,
      note: note?.trim() || `Re-applied request (#${item.reRequestCount}) for \u0930\u0942 ${item.amountNpr.toLocaleString()} after addressing decline feedback.`,
      statusAfter: "PENDING_MANAGER"
    });
    appendAudit(
      db,
      actor,
      "FINANCE_APPROVAL",
      "FINANCE_RE_REQUESTED",
      item.requestNumber,
      `Re-submitted declined voucher ${item.requestNumber} (Attempt #${item.reRequestCount}, \u0930\u0942 ${item.amountNpr.toLocaleString()}).`
    );
    saveDb(db);
    res.json({ request: item, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/finance/counter-close", withAuth("counter.close", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const {
      shiftLabel,
      actualCountedCashNpr,
      notes,
      counterScope = "HOSPITAL",
      employeeOnly = true
    } = req.body;
    const actualCash = Number(actualCountedCashNpr);
    if (Number.isNaN(actualCash) || actualCash < 0) {
      res.status(400).json({ error: "Valid physical cash count is required." });
      return;
    }
    const scope = counterScope === "PHARMACY" || counterScope === "ALL" ? counterScope : "HOSPITAL";
    const lastClose = db.counterCloses.find((c) => {
      const sameScope = (c.counterScope || "HOSPITAL") === scope;
      const sameCashier = !employeeOnly || c.cashierId === actor.id;
      return sameScope && sameCashier;
    });
    const lastCloseTime = lastClose ? new Date(lastClose.closedAt).getTime() : 0;
    const cashAcc = scope === "PHARMACY" ? db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.type === "CASH_COUNTER") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.type === "CASH_COUNTER");
    const openingCashNpr = lastClose ? lastClose.actualCountedCashNpr : 0;
    let cashSalesNpr = 0;
    let bankQrSalesNpr = 0;
    let centerCreditSalesNpr = 0;
    let depositsCollectedNpr = 0;
    let ipdCashBillsNpr = 0;
    if (scope === "HOSPITAL" || scope === "ALL") {
      const ordersSinceClose = db.orders.filter(
        (o) => new Date(o.orderedAt).getTime() > lastCloseTime && (!employeeOnly || !o.createdById || o.createdById === actor.id)
      );
      cashSalesNpr += ordersSinceClose.reduce((sum, o) => sum + (o.cashPaid || 0), 0);
      bankQrSalesNpr += ordersSinceClose.reduce((sum, o) => sum + (o.bankPaid || 0), 0);
      centerCreditSalesNpr += ordersSinceClose.reduce(
        (sum, o) => sum + (o.paymentMode === "Center Credit" ? o.totalAmount : o.dueAmount || 0),
        0
      );
      for (const adm of db.ipdAdmissions || []) {
        for (const dep of adm.deposits || []) {
          if (new Date(dep.timestamp).getTime() > lastCloseTime && (!employeeOnly || dep.receivedBy === actor.fullName)) {
            depositsCollectedNpr += dep.amountNpr || 0;
            if (dep.paymentMode === "Bank / QR") {
              bankQrSalesNpr += dep.amountNpr || 0;
            } else {
              cashSalesNpr += dep.amountNpr || 0;
            }
          }
        }
        for (const cb of adm.ipdIndividualBills || []) {
          if (new Date(cb.billedAt).getTime() > lastCloseTime && (!employeeOnly || !cb.billedById || cb.billedById === actor.id)) {
            ipdCashBillsNpr += cb.amountNpr || 0;
            if (cb.paymentMode === "Bank / QR") {
              bankQrSalesNpr += cb.amountNpr || 0;
            } else {
              cashSalesNpr += cb.amountNpr || 0;
            }
          }
        }
      }
    }
    if (scope === "PHARMACY" || scope === "ALL") {
      const pharmInvsSinceClose = (db.pharmacyInvoices || []).filter(
        (inv) => new Date(inv.dispensedAt).getTime() > lastCloseTime && (!employeeOnly || !inv.dispensedById || inv.dispensedById === actor.id)
      );
      cashSalesNpr += pharmInvsSinceClose.reduce((sum, i) => sum + (i.cashPaid || 0), 0);
      bankQrSalesNpr += pharmInvsSinceClose.reduce((sum, i) => sum + (i.bankPaid || 0), 0);
      centerCreditSalesNpr += pharmInvsSinceClose.reduce((sum, i) => sum + (i.dueAmountNpr || 0), 0);
      for (const pdep of db.pharmacyDeposits || []) {
        if (new Date(pdep.receivedAt).getTime() > lastCloseTime && (!employeeOnly || !pdep.receivedById || pdep.receivedById === actor.id)) {
          depositsCollectedNpr += pdep.amountNpr || 0;
          if (pdep.paymentMode === "Bank / QR") {
            bankQrSalesNpr += pdep.amountNpr || 0;
          } else {
            cashSalesNpr += pdep.amountNpr || 0;
          }
        }
      }
    }
    const cashOutflowsNpr = db.financialLedger.filter(
      (f) => cashAcc && f.accountId === cashAcc.id && f.direction === "OUTFLOW" && new Date(f.timestamp).getTime() > lastCloseTime && (!employeeOnly || f.recordedBy === actor.fullName)
    ).reduce((sum, f) => sum + f.amount, 0);
    cashSalesNpr = Number(cashSalesNpr.toFixed(2));
    bankQrSalesNpr = Number(bankQrSalesNpr.toFixed(2));
    centerCreditSalesNpr = Number(centerCreditSalesNpr.toFixed(2));
    depositsCollectedNpr = Number(depositsCollectedNpr.toFixed(2));
    ipdCashBillsNpr = Number(ipdCashBillsNpr.toFixed(2));
    const expectedClosingCashNpr = Number(Math.max(0, openingCashNpr + cashSalesNpr - cashOutflowsNpr).toFixed(2));
    const varianceNpr = Number((actualCash - expectedClosingCashNpr).toFixed(2));
    const bsNow = adToBs(/* @__PURE__ */ new Date());
    const record = {
      id: `cls-${Date.now()}`,
      closedAt: (/* @__PURE__ */ new Date()).toISOString(),
      fiscalYear: db.settings.activeFiscalYear,
      bsDate: bsNow.formattedEn,
      shiftLabel: shiftLabel || `${actor.shift || "Morning"} \xB7 ${scope} Counter`,
      cashierId: actor.id,
      cashierName: actor.fullName,
      counterScope: scope,
      staffRole: db.roles.find((r) => r.id === actor.roleId)?.name || actor.roleId,
      depositsCollectedNpr,
      ipdCashBillsNpr,
      openingCashNpr,
      cashSalesNpr,
      bankQrSalesNpr,
      centerCreditSalesNpr,
      cashOutflowsNpr,
      expectedClosingCashNpr,
      actualCountedCashNpr: actualCash,
      varianceNpr,
      notes: notes || `Verified physical cash count for ${scope} Counter (${actor.fullName}).`,
      status: "LOCKED_CLOSED"
    };
    db.counterCloses.unshift(record);
    appendAudit(
      db,
      actor,
      "COUNTER_CLOSE",
      "DAILY_COUNTER_CLOSED",
      record.id,
      `Closed ${scope} counter by ${actor.fullName} (${record.shiftLabel}, BS ${record.bsDate}). Expected \u0930\u0942 ${expectedClosingCashNpr.toLocaleString()}, Counted \u0930\u0942 ${actualCash.toLocaleString()}, Variance \u0930\u0942 ${varianceNpr.toLocaleString()}.`,
      varianceNpr !== 0 ? "WARNING" : "INFO"
    );
    saveDb(db);
    res.status(201).json({ record, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/finance/assets", withAuth("finance.manage", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim()) {
      res.status(400).json({ error: "Asset name is required." });
      return;
    }
    if (!Array.isArray(db.hospitalAssets)) db.hospitalAssets = [];
    const existingIdx = body.id ? db.hospitalAssets.findIndex((a) => a.id === body.id) : -1;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const asset = {
      id: existingIdx >= 0 ? db.hospitalAssets[existingIdx].id : `ast-${Date.now()}`,
      assetCode: body.assetCode?.trim().toUpperCase() || `AST-${String(db.hospitalAssets.length + 1).padStart(3, "0")}`,
      name: body.name.trim(),
      category: body.category || "Medical Equipment",
      departmentScope: body.departmentScope || "HOSPITAL",
      location: body.location?.trim() || "Main Hospital",
      purchaseDate: body.purchaseDate?.trim() || nowIso.slice(0, 10),
      purchaseCostNpr: Math.max(0, Number(body.purchaseCostNpr) || 0),
      currentValueNpr: body.currentValueNpr !== void 0 ? Math.max(0, Number(body.currentValueNpr) || 0) : Math.max(0, Number(body.purchaseCostNpr) || 0),
      vendorName: body.vendorName?.trim() || "",
      warrantyUntil: body.warrantyUntil?.trim() || "",
      status: body.status || "Active",
      notes: body.notes?.trim() || "",
      createdAt: existingIdx >= 0 ? db.hospitalAssets[existingIdx].createdAt : nowIso
    };
    if (existingIdx >= 0) db.hospitalAssets[existingIdx] = asset;
    else db.hospitalAssets.unshift(asset);
    appendAudit(
      db,
      actor,
      "FINANCE",
      existingIdx >= 0 ? "ASSET_UPDATED" : "ASSET_CREATED",
      asset.assetCode,
      `${existingIdx >= 0 ? "Updated" : "Registered"} asset ${asset.name} (${asset.assetCode}) \u2014 Cost \u0930\u0942 ${asset.purchaseCostNpr.toLocaleString()}.`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ asset, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/finance/assets/:id", withAuth("finance.manage", "finance_counter"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.hospitalAssets)) db.hospitalAssets = [];
    const idx = db.hospitalAssets.findIndex((a) => a.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Asset not found." });
      return;
    }
    const [removed] = db.hospitalAssets.splice(idx, 1);
    appendAudit(db, actor, "FINANCE", "ASSET_DELETED", removed.assetCode, `Deleted asset ${removed.name}.`, "WARNING");
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.get("/api/approvals/discount-credit", withAuth(), (req, res) => {
    const { db } = req;
    res.json({ approvals: db.discountCreditApprovals || [] });
  });
  app.post("/api/approvals/discount-credit", withAuth(), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.patientName?.trim() || !body.requestType || !body.sourceModule) {
      res.status(400).json({ error: "Patient name, request type, and source module are required." });
      return;
    }
    if (!Array.isArray(db.discountCreditApprovals)) db.discountCreditApprovals = [];
    const ms = db.settings?.moduleSettings;
    const configuredPolicy = body.requestType === "DISCOUNT_OVERRIDE" ? ms?.discountApprovalPolicy || "MANAGER_THEN_ADMIN" : ms?.creditApprovalPolicy || "MANAGER_THEN_ADMIN";
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const seq = 101 + db.discountCreditApprovals.length;
    const initialStatus = configuredPolicy === "ADMIN_ONLY" ? "PENDING_ADMIN" : "PENDING_MANAGER";
    const created = {
      id: `dca-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      requestNumber: `APR-${bsNow.year}-${seq}`,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      createdAt: nowIso,
      updatedAt: nowIso,
      requestType: body.requestType,
      sourceModule: body.sourceModule,
      approvalPolicy: configuredPolicy,
      patientName: body.patientName.trim(),
      uhid: body.uhid?.trim() || "",
      encounterLabel: body.encounterLabel?.trim() || "",
      referenceId: body.referenceId,
      referenceCode: body.referenceCode,
      billSubtotalNpr: body.billSubtotalNpr !== void 0 ? Number(body.billSubtotalNpr) : void 0,
      requestedValueNpr: Math.max(0, Number(body.requestedValueNpr) || 0),
      requestedPercent: body.requestedPercent !== void 0 ? Number(body.requestedPercent) : void 0,
      currentLimitNpr: body.currentLimitNpr !== void 0 ? Number(body.currentLimitNpr) : void 0,
      reason: body.reason?.trim() || "Requested approval override",
      requesterId: actor.id,
      requesterName: actor.fullName,
      requesterRole: actor.roleId,
      status: initialStatus,
      history: [
        {
          id: `dcah-${Date.now()}`,
          timestamp: nowIso,
          action: "REQUESTED",
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          remarks: body.reason?.trim() || "Submitted for approval",
          statusAfter: initialStatus
        }
      ]
    };
    if (created.requestType === "CREDIT_LIMIT_OVERRIDE" && created.sourceModule === "IPD" && created.referenceId) {
      const adm = (db.ipdAdmissions || []).find((a) => a.id === created.referenceId);
      if (adm) adm.creditApprovalStatus = "PENDING_ADMIN_CREDIT";
    }
    db.discountCreditApprovals.unshift(created);
    appendAudit(
      db,
      actor,
      "FINANCE_APPROVAL",
      "DISCOUNT_CREDIT_REQUESTED",
      created.requestNumber,
      `Submitted ${created.requestType === "DISCOUNT_OVERRIDE" ? "Discount" : "Credit Limit"} approval ${created.requestNumber} (${created.sourceModule}) for ${created.patientName}: \u0930\u0942 ${created.requestedValueNpr.toLocaleString()} (${configuredPolicy}).`
    );
    saveDb(db);
    res.status(201).json({ approval: created, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/approvals/discount-credit/:id/decision", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.discountCreditApprovals)) db.discountCreditApprovals = [];
    const reqItem = db.discountCreditApprovals.find((r) => r.id === req.params.id);
    if (!reqItem) {
      res.status(404).json({ error: "Approval request not found." });
      return;
    }
    const { decision, remarks } = req.body || {};
    const isAdmin = actor.roleId === "SUPER_ADMIN" || actor.roleId === "SAAS_ADMIN" || hasPermission(db, actor.roleId, "finance.approve_admin");
    const isManager = isAdmin || hasPermission(db, actor.roleId, "finance.approve_manager") || actor.roleId === "CENTER_MANAGER" || actor.roleId === "INVENTORY_HR";
    if (!isManager) {
      res.status(403).json({ error: "Manager or Hospital Admin role required to decide approvals." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (decision === "DECLINE") {
      reqItem.status = "DECLINED";
      reqItem.updatedAt = nowIso;
      if (isAdmin) {
        reqItem.adminReviewedBy = actor.fullName;
        reqItem.adminReviewedAt = nowIso;
        reqItem.adminRemarks = remarks?.trim() || "Declined";
      } else {
        reqItem.managerReviewedBy = actor.fullName;
        reqItem.managerReviewedAt = nowIso;
        reqItem.managerRemarks = remarks?.trim() || "Declined by Manager";
      }
      reqItem.history.unshift({
        id: `dcah-${Date.now()}`,
        timestamp: nowIso,
        action: "DECLINED",
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.roleId,
        remarks: remarks?.trim() || "Declined",
        statusAfter: "DECLINED"
      });
    } else {
      if (reqItem.status === "PENDING_MANAGER" && !isAdmin && reqItem.approvalPolicy === "MANAGER_THEN_ADMIN") {
        reqItem.status = "PENDING_ADMIN";
        reqItem.managerReviewedBy = actor.fullName;
        reqItem.managerReviewedAt = nowIso;
        reqItem.managerRemarks = remarks?.trim() || "Verified & forwarded to Hospital Admin";
        reqItem.updatedAt = nowIso;
        reqItem.history.unshift({
          id: `dcah-${Date.now()}`,
          timestamp: nowIso,
          action: "APPROVED_BY_MANAGER",
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          remarks: reqItem.managerRemarks,
          statusAfter: "PENDING_ADMIN"
        });
      } else {
        if (!isAdmin) {
          res.status(403).json({ error: "Final approval requires Hospital Admin (SUPER_ADMIN)." });
          return;
        }
        reqItem.status = "APPROVED";
        reqItem.adminReviewedBy = actor.fullName;
        reqItem.adminReviewedAt = nowIso;
        reqItem.adminRemarks = remarks?.trim() || "Approved by Admin";
        reqItem.updatedAt = nowIso;
        reqItem.history.unshift({
          id: `dcah-${Date.now()}`,
          timestamp: nowIso,
          action: "APPROVED_BY_ADMIN",
          actorId: actor.id,
          actorName: actor.fullName,
          actorRole: actor.roleId,
          remarks: reqItem.adminRemarks,
          statusAfter: "APPROVED"
        });
        if (reqItem.requestType === "CREDIT_LIMIT_OVERRIDE") {
          const adm = (db.ipdAdmissions || []).find(
            (a) => reqItem.referenceId && a.id === reqItem.referenceId || reqItem.sourceModule === "PHARMACY_POS" && reqItem.uhid && a.uhid === reqItem.uhid && a.disposition === "Admitted"
          );
          if (adm) {
            adm.creditLimitNpr = Math.max(adm.creditLimitNpr || 0, reqItem.requestedValueNpr);
            adm.creditApprovalStatus = "APPROVED";
            adm.creditApprovedBy = actor.fullName;
            adm.creditApprovedAt = nowIso;
            adm.creditApprovalNote = reqItem.adminRemarks;
          }
          const er = (db.emergencyCases || []).find(
            (e) => reqItem.referenceId && e.id === reqItem.referenceId || reqItem.sourceModule === "PHARMACY_POS" && reqItem.uhid && e.uhid === reqItem.uhid && e.disposition === "Under Observation (ER)"
          );
          if (er) {
            er.creditLimitNpr = Math.max(er.creditLimitNpr || 0, reqItem.requestedValueNpr);
          }
        }
      }
    }
    appendAudit(
      db,
      actor,
      "FINANCE_APPROVAL",
      `APPROVAL_${reqItem.status}`,
      reqItem.requestNumber,
      `${actor.fullName} updated ${reqItem.requestNumber} (${reqItem.patientName}) to ${reqItem.status}. Remarks: ${remarks?.trim() || "\u2014"}`
    );
    saveDb(db);
    res.json({ approval: reqItem, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/personnel", withAuth("personnel.manage", "hr_payroll"), (req, res) => {
    const { db, actor } = req;
    const member = req.body;
    if (!member.fullName?.trim() || !member.employeeCode?.trim()) {
      res.status(400).json({ error: "Employee code and full name are required." });
      return;
    }
    if (db.saas && db.staff.filter((s) => s.status !== "Suspended").length >= db.saas.maxStaffSeats) {
      res.status(403).json({
        error: `SaaS Seat Limit Reached (${db.saas.maxStaffSeats} seats). Upgrade seat quota in SaaS Control.`
      });
      return;
    }
    const requestedRole = member.roleId || "LAB_TECH";
    const roleExists = db.roles.some((r) => r.id === requestedRole);
    if (!roleExists) {
      res.status(400).json({ error: `Selected role '${requestedRole}' does not exist.` });
      return;
    }
    if (db.saas?.allowedRoleIds?.length && !db.saas.allowedRoleIds.includes(requestedRole) && !db.roles.find((r) => r.id === requestedRole)?.isCustom) {
      res.status(403).json({
        error: `SaaS Role Capacity Restriction: Role '${requestedRole}' is not enabled in the tenant's active Roles Capacity policy.`
      });
      return;
    }
    if (requestedRole === "SUPER_ADMIN" && actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({
        error: "Only Hospital Admin can assign the SUPER_ADMIN role."
      });
      return;
    }
    const rawUsername = (member.username?.trim() || member.employeeCode.trim().toLowerCase().replace(/[^a-z0-9]/g, "")).toLowerCase();
    if (db.staff.some((s) => s.username.toLowerCase() === rawUsername)) {
      res.status(400).json({ error: `Username '@${rawUsername}' is already assigned to another staff member.` });
      return;
    }
    const pinStr = String(member.pin || "1234").trim();
    if (!/^\d{4,6}$/.test(pinStr)) {
      res.status(400).json({ error: "Admin-created PIN must be 4 to 6 digits." });
      return;
    }
    const created = {
      id: `staff-${Date.now()}`,
      employeeCode: member.employeeCode.trim(),
      username: rawUsername,
      password: member.password?.trim() || "Hosp@2083",
      pin: pinStr,
      failedAttempts: 0,
      isLocked: false,
      fullName: member.fullName.trim(),
      designation: member.designation || "Hospital Clinical Specialist",
      department: member.department || "Clinical Pathology",
      email: member.email || "",
      phone: member.phone || "",
      roleId: requestedRole,
      shift: member.shift || "Morning (07:00-15:00)",
      status: member.status || "Active",
      certification: member.certification || "NHPC Certified",
      registrationNumber: member.registrationNumber,
      canSignReports: Boolean(member.canSignReports),
      assignedCenterId: null,
      assignedCenterName: "Saptari Hospital Pvt Ltd",
      joinedAt: member.joinedAt || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
      basicSalaryNpr: Number(member.basicSalaryNpr) || 35e3,
      technicalAllowanceNpr: Number(member.technicalAllowanceNpr) || 5e3,
      shiftAllowanceNpr: Number(member.shiftAllowanceNpr) || 0,
      ssfPercent: Number(member.ssfPercent ?? 11),
      tdsPercent: Number(member.tdsPercent ?? 1),
      bankAccountNumber: member.bankAccountNumber || ""
    };
    db.staff.push(created);
    appendAudit(
      db,
      actor,
      "PERSONNEL",
      "STAFF_ONBOARDED",
      created.employeeCode,
      `Added ${created.fullName} (@${created.username}, ${created.roleId}) at ${created.assignedCenterName} with Admin-assigned PIN and Basic Salary \u0930\u0942 ${created.basicSalaryNpr.toLocaleString()}.`
    );
    saveDb(db);
    res.status(201).json({ db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/personnel/:id", withAuth("personnel.manage", "hr_payroll"), (req, res) => {
    const { db, actor } = req;
    const member = db.staff.find((s) => s.id === req.params.id);
    if (!member) {
      res.status(404).json({ error: "Staff member not found." });
      return;
    }
    const updates = req.body;
    if (updates.roleId && updates.roleId !== member.roleId && !hasPermission(db, actor.roleId, "rbac.manage")) {
      res.status(403).json({ error: "Changing user RBAC roles requires Super Admin permission (rbac.manage)." });
      return;
    }
    if (updates.pin && !/^\d{4,6}$/.test(String(updates.pin).trim())) {
      res.status(400).json({ error: "PIN must be 4 to 6 numeric digits." });
      return;
    }
    Object.assign(member, updates);
    member.assignedCenterId = null;
    member.assignedCenterName = "Saptari Hospital Pvt Ltd";
    appendAudit(db, actor, "PERSONNEL", "STAFF_UPDATED", member.employeeCode, `Updated personnel record for ${member.fullName} (Status: ${member.status}, Role: ${member.roleId}).`);
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });
  app.post("/api/payroll/run", withAuth("payroll.manage", "hr_payroll"), (req, res) => {
    const { db, actor } = req;
    const { bsMonthLabel, disburseImmediately, accountId } = req.body;
    const activeStaff = db.staff.filter((s) => s.status !== "Suspended");
    const items = activeStaff.map((s) => {
      const allowances = (s.technicalAllowanceNpr || 0) + (s.shiftAllowanceNpr || 0);
      const grossSalary = (s.basicSalaryNpr || 0) + allowances;
      const ssfDeduction = Math.round((s.basicSalaryNpr || 0) * (s.ssfPercent || 0) / 100);
      const tdsDeduction = Math.round(grossSalary * (s.tdsPercent || 0) / 100);
      const netPayable = Math.max(0, grossSalary - ssfDeduction - tdsDeduction);
      return {
        staffId: s.id,
        employeeCode: s.employeeCode,
        fullName: s.fullName,
        designation: s.designation,
        basicSalary: s.basicSalaryNpr || 0,
        allowances,
        grossSalary,
        ssfDeduction,
        tdsDeduction,
        netPayable
      };
    });
    const totalGrossNpr = items.reduce((s, i) => s + i.grossSalary, 0);
    const totalDeductionsNpr = items.reduce((s, i) => s + i.ssfDeduction + i.tdsDeduction, 0);
    const totalNetNpr = items.reduce((s, i) => s + i.netPayable, 0);
    const bankAcc = accountId && db.accounts.find((a) => a.id === accountId) || db.accounts.find((a) => a.type === "BANK") || db.accounts[0];
    const run = {
      id: `pay-${Date.now()}`,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      fiscalYear: db.settings.activeFiscalYear,
      bsMonthLabel: bsMonthLabel?.trim() || `${adToBs(/* @__PURE__ */ new Date()).monthNameEn} ${adToBs(/* @__PURE__ */ new Date()).year}`,
      status: disburseImmediately ? "Disbursed" : "Draft",
      paidFromAccountId: disburseImmediately && bankAcc ? bankAcc.id : void 0,
      paidFromAccountName: disburseImmediately && bankAcc ? bankAcc.name : void 0,
      totalGrossNpr,
      totalDeductionsNpr,
      totalNetNpr,
      approvedBy: actor.fullName,
      items
    };
    if (disburseImmediately && bankAcc) {
      postLedgerMovement(
        db,
        bankAcc,
        "OUTFLOW",
        totalNetNpr,
        "PAYROLL_DISBURSEMENT",
        run.id,
        `Payroll disbursement for ${run.bsMonthLabel} (${items.length} staff)`,
        run.fiscalYear,
        actor
      );
    }
    db.payrollRuns.unshift(run);
    appendAudit(
      db,
      actor,
      "PAYROLL",
      disburseImmediately ? "PAYROLL_DISBURSED" : "PAYROLL_DRAFTED",
      run.id,
      `Generated payroll for ${run.bsMonthLabel} (${items.length} staff, Net \u0930\u0942 ${totalNetNpr.toLocaleString()}).`
    );
    saveDb(db);
    res.status(201).json({ run, db });
  });
  app.post("/api/payroll/:id/disburse", withAuth("payroll.manage", "hr_payroll"), (req, res) => {
    const { db, actor } = req;
    const run = db.payrollRuns.find((p) => p.id === req.params.id);
    if (!run) {
      res.status(404).json({ error: "Payroll run not found." });
      return;
    }
    if (run.status === "Disbursed") {
      res.status(400).json({ error: "Payroll batch is already disbursed." });
      return;
    }
    const { accountId } = req.body;
    const bankAcc = db.accounts.find((a) => a.id === accountId) || db.accounts.find((a) => a.type === "BANK");
    if (!bankAcc) {
      res.status(400).json({ error: "Valid disbursement account required." });
      return;
    }
    run.status = "Disbursed";
    run.paidFromAccountId = bankAcc.id;
    run.paidFromAccountName = bankAcc.name;
    postLedgerMovement(
      db,
      bankAcc,
      "OUTFLOW",
      run.totalNetNpr,
      "PAYROLL_DISBURSEMENT",
      run.id,
      `Payroll disbursement for ${run.bsMonthLabel}`,
      run.fiscalYear,
      actor
    );
    appendAudit(db, actor, "PAYROLL", "PAYROLL_DISBURSED", run.id, `Disbursed \u0930\u0942 ${run.totalNetNpr.toLocaleString()} from ${bankAcc.name} for ${run.bsMonthLabel}.`);
    saveDb(db);
    res.json({ db });
  });
  app.post("/api/whatsapp/send-daily-sales", withAuth(), (req, res) => {
    const { db, actor } = req;
    const { recipientPhone, customNote } = req.body;
    const targetPhone = (recipientPhone || db.settings.adminWhatsAppNumber || "").trim();
    if (!targetPhone) {
      res.status(400).json({ error: "Admin WhatsApp number is required." });
      return;
    }
    const now = /* @__PURE__ */ new Date();
    const bsToday = adToBs(now);
    const todayOrders = db.orders.filter(
      (o) => adToBs(o.orderedAt).formattedEn === bsToday.formattedEn
    );
    const summaryOrders = todayOrders.length > 0 ? todayOrders : db.orders.slice(0, 5);
    const totalSalesNpr = summaryOrders.reduce((s, o) => s + o.totalAmount, 0);
    const cashNpr = summaryOrders.reduce((s, o) => s + (o.cashPaid || 0), 0);
    const bankNpr = summaryOrders.reduce((s, o) => s + (o.bankPaid || 0), 0);
    const creditNpr = Math.max(0, totalSalesNpr - cashNpr - bankNpr);
    const validatedCount = summaryOrders.filter((o) => o.status === "Validated" || o.status === "Dispatched").length;
    const pendingCount = summaryOrders.length - validatedCount;
    const messageText = [
      `*${db.settings.labName} \u2014 Daily Sales Report*`,
      `BS Date: ${bsToday.formattedEn} (${bsToday.formattedNp})`,
      `Fiscal Year: ${db.settings.activeFiscalYear} | PAN: ${db.settings.panNumber}`,
      `Total Orders: ${summaryOrders.length} (${validatedCount} Validated, ${pendingCount} Pending)`,
      `Total Sales: \u0930\u0942 ${totalSalesNpr.toLocaleString()}`,
      `\u2022 Cash Counter: \u0930\u0942 ${cashNpr.toLocaleString()}`,
      `\u2022 Bank / QR: \u0930\u0942 ${bankNpr.toLocaleString()}`,
      `\u2022 Center Credit / Due: \u0930\u0942 ${creditNpr.toLocaleString()}`,
      customNote ? `Note: ${customNote}` : null,
      `Dispatched by: ${actor.fullName}`
    ].filter(Boolean).join("\n");
    const log = {
      id: `wa-${Date.now()}`,
      timestamp: now.toISOString(),
      bsDate: bsToday.formattedEn,
      recipientPhone: targetPhone,
      totalSalesNpr,
      ordersCount: summaryOrders.length,
      messagePreview: messageText.replace(/\n/g, " \xB7 "),
      sentBy: actor.fullName,
      status: "Sent via WhatsApp"
    };
    db.whatsappLogs.unshift(log);
    appendAudit(
      db,
      actor,
      "WHATSAPP",
      "DAILY_SALES_WHATSAPP_SENT",
      targetPhone,
      `Dispatched daily sales summary (\u0930\u0942 ${totalSalesNpr.toLocaleString()}, ${summaryOrders.length} orders) to Admin WhatsApp ${targetPhone}.`
    );
    saveDb(db);
    const digits = targetPhone.replace(/[^\d]/g, "");
    const whatsappUrl = `https://wa.me/${digits}?text=${encodeURIComponent(messageText)}`;
    res.status(201).json({ log, messageText, whatsappUrl, db });
  });
  app.post("/api/designs", withAuth("designs.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim() || !body.headerTitle?.trim()) {
      res.status(400).json({ error: "Design template name and header title are required." });
      return;
    }
    const reasonStr = (body.reason || "").trim();
    if (!reasonStr) {
      res.status(400).json({ error: "A mandatory Reason is required when Hospital Admin creates or modifies Bill/Report designs." });
      return;
    }
    const existingIdx = body.id ? db.documentDesigns.findIndex((d) => d.id === body.id) : -1;
    const saved = {
      id: existingIdx >= 0 ? db.documentDesigns[existingIdx].id : `dsn-${Date.now()}`,
      name: body.name.trim(),
      entityType: body.entityType || "Main Lab",
      centerId: null,
      targetScope: body.targetScope || "BOTH",
      templateStyle: body.templateStyle || "EXECUTIVE_HOSPITAL",
      headerTitle: body.headerTitle.trim(),
      headerTitleNp: body.headerTitleNp?.trim() || "",
      subTitle: body.subTitle?.trim() || "",
      addressText: body.addressText?.trim() || db.settings.addressLine,
      phoneText: body.phoneText?.trim() || db.settings.contactLine,
      panNumber: body.panNumber?.trim() || db.settings.panNumber,
      licenseNumber: body.licenseNumber?.trim() || "",
      billHeading: body.billHeading?.trim() || "OFFICIAL TAX INVOICE / HOSPITAL BILL",
      reportHeading: body.reportHeading?.trim() || "CLINICAL DIAGNOSTIC LABORATORY REPORT",
      radiologyHeading: body.radiologyHeading?.trim() || "DEPARTMENT OF RADIOLOGY & DIAGNOSTIC IMAGING REPORT",
      topBannerText: body.topBannerText?.trim() || "",
      footerDisclaimerText: body.footerDisclaimerText?.trim() || "Electronically verified document. Scan QR code for live authenticity check.",
      footerSignatureTitle: body.footerSignatureTitle?.trim() || "Authorized Signatory",
      watermarkText: body.watermarkText?.trim() || "VERIFIED",
      showWatermark: Boolean(body.showWatermark),
      accentColor: body.accentColor || "#1d4ed8",
      paperFormat: body.paperFormat || "A5",
      showLetterheadBanner: body.showLetterheadBanner ?? true,
      showQrCode: body.showQrCode ?? true,
      qrPayloadMode: body.qrPayloadMode || "VERIFY_URL",
      showBarcode: body.showBarcode ?? true,
      barcodeSource: body.barcodeSource || "ACCESSION",
      showNepaliDate: body.showNepaliDate ?? true,
      showPan: body.showPan ?? true,
      showCollectionCenter: false,
      showDoctorRef: body.showDoctorRef ?? true,
      showTatBadge: body.showTatBadge ?? true,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      updatedBy: actor.fullName
    };
    if (existingIdx >= 0) {
      db.documentDesigns[existingIdx] = saved;
    } else {
      db.documentDesigns.unshift(saved);
    }
    appendAudit(
      db,
      actor,
      "DESIGNS",
      existingIdx >= 0 ? "DOCUMENT_DESIGN_UPDATED" : "DOCUMENT_DESIGN_CREATED",
      saved.id,
      `Hospital Admin ${existingIdx >= 0 ? "updated" : "created"} print design '${saved.name}' (${saved.paperFormat}, ${saved.templateStyle}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ design: saved, db });
  });
  app.delete("/api/designs/:id", withAuth("designs.manage"), (req, res) => {
    const { db, actor } = req;
    const { reason } = req.body || {};
    const reasonStr = (reason || req.query.reason || "").trim();
    if (!reasonStr) {
      res.status(400).json({ error: "A mandatory Reason is required to delete a Document Design." });
      return;
    }
    if (req.params.id === "dsn-main") {
      res.status(400).json({ error: "Default Hospital Master template cannot be deleted." });
      return;
    }
    const idx = db.documentDesigns.findIndex((d) => d.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Document design not found." });
      return;
    }
    const [removed] = db.documentDesigns.splice(idx, 1);
    appendAudit(
      db,
      actor,
      "DESIGNS",
      "DOCUMENT_DESIGN_DELETED",
      removed.id,
      `Hospital Admin deleted design '${removed.name}'. Reason: ${reasonStr}`,
      "WARNING"
    );
    saveDb(db);
    res.json({ ok: true, db });
  });
  app.get("/api/saas/telemetry", withAuth("admin.control"), (req, res) => {
    const { db } = req;
    res.json({ telemetry: computeSaasTelemetry(db), saas: db.saas });
  });
  app.patch("/api/saas/modules/:key", withAuth("admin.control"), (req, res) => {
    const { db, actor } = req;
    const mod = db.saas.modules.find((m) => m.key === req.params.key);
    if (!mod) {
      res.status(404).json({ error: "Hospital module not found." });
      return;
    }
    const { enabled, reason } = req.body;
    const reasonStr = (reason || "Admin module toggle").trim();
    if (mod.lockedCore && !enabled) {
      res.status(400).json({ error: "Core clinical diagnostic engine cannot be disabled." });
      return;
    }
    mod.enabled = Boolean(enabled);
    mod.lastToggledAt = (/* @__PURE__ */ new Date()).toISOString();
    mod.lastToggledBy = actor.fullName;
    mod.lastReason = reasonStr;
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      mod.enabled ? "MODULE_ENABLED" : "MODULE_DISABLED",
      mod.key,
      `${mod.enabled ? "Enabled" : "Disabled"} hospital module '${mod.name}'. Reason: ${reasonStr}`,
      mod.enabled ? "INFO" : "WARNING"
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db) });
  });
  app.put("/api/saas/roles-capacity", withAuth("admin.control"), (req, res) => {
    const { db, actor } = req;
    const { maxRolesCapacity, allowedRoleIds, reason } = req.body;
    const reasonStr = (reason || "Hospital Admin role allocation adjustment").trim();
    const nextMax = Math.max(1, Math.min(12, Number(maxRolesCapacity ?? db.saas.maxRolesCapacity)));
    let nextRoles = Array.isArray(allowedRoleIds) ? Array.from(new Set(allowedRoleIds)) : [...db.saas.allowedRoleIds];
    if (!nextRoles.includes("SUPER_ADMIN")) {
      nextRoles = ["SUPER_ADMIN", ...nextRoles];
    }
    if (nextRoles.length > nextMax) {
      res.status(400).json({
        error: `Selected roles (${nextRoles.length}) exceed Max Roles Capacity (${nextMax}). Increase capacity or uncheck roles.`
      });
      return;
    }
    db.saas.maxRolesCapacity = nextMax;
    db.saas.allowedRoleIds = nextRoles;
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "ROLES_CAPACITY_UPDATED",
      db.saas.tenantId,
      `Updated Hospital role capacity to max ${nextMax} roles (${nextRoles.join(", ")}). Reason: ${reasonStr}`,
      "WARNING"
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db) });
  });
  app.post("/api/saas/tenants", withAuth("saas.tenants.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    const reasonStr = (body.controlReason || body.reason || "").trim();
    if (!body.name?.trim() || !body.panNumber?.trim() || !body.phone?.trim() || !body.address?.trim()) {
      res.status(400).json({
        error: "Lab Name, PAN Number, Phone, and Address are all required to provision a SaaS tenant."
      });
      return;
    }
    if (!reasonStr) {
      res.status(400).json({ error: "A mandatory Reason is required for SaaS Tenant provisioning." });
      return;
    }
    const maxRoles = Math.max(1, Number(body.maxRolesAllowed) || 5);
    const roles = Array.isArray(body.allowedRoles) && body.allowedRoles.length > 0 ? body.allowedRoles.slice(0, maxRoles) : ["SUPER_ADMIN", "LAB_DIRECTOR", "LAB_TECH", "CENTER_MANAGER"];
    const modules = Array.isArray(body.enabledModules) && body.enabledModules.length > 0 ? Array.from(/* @__PURE__ */ new Set(["core_lims", ...body.enabledModules])) : ["core_lims", "pos_billing", "inventory_erp"];
    const tenant = {
      id: `tnt-${Date.now()}`,
      code: body.code?.trim().toUpperCase() || `TENANT-NP-${String(db.tenants.length + 1).padStart(3, "0")}`,
      name: body.name.trim(),
      nameNp: body.nameNp?.trim() || "",
      entityType: body.entityType || "Main Lab",
      panNumber: body.panNumber.trim(),
      phone: body.phone.trim(),
      address: body.address.trim(),
      ownerEmail: body.ownerEmail?.trim() || "admin@labtenant.com.np",
      planName: body.planName || "Professional Lab",
      status: body.status || "Active",
      maxRolesAllowed: maxRoles,
      allowedRoles: roles,
      enabledModules: modules,
      storageQuotaMb: Number(body.storageQuotaMb) || 15360,
      storageUsedMb: 42,
      controlReason: reasonStr,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.tenants.unshift(tenant);
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "SAAS_TENANT_CREATED",
      tenant.code,
      `SaaS Admin provisioned '${tenant.name}' (${tenant.entityType}, PAN: ${tenant.panNumber}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.status(201).json({ tenant, db });
  });
  app.patch("/api/saas/tenants/:id", withAuth("saas.tenants.manage"), (req, res) => {
    const { db, actor } = req;
    const tenant = db.tenants.find((t) => t.id === req.params.id);
    if (!tenant) {
      res.status(404).json({ error: "SaaS Lab Tenant not found." });
      return;
    }
    const updates = req.body;
    const reasonStr = (updates.controlReason || updates.reason || "").trim();
    if (!reasonStr) {
      res.status(400).json({ error: "A mandatory Reason is required to modify SaaS Tenant status or policy." });
      return;
    }
    if (updates.name !== void 0) tenant.name = updates.name.trim();
    if (updates.nameNp !== void 0) tenant.nameNp = updates.nameNp.trim();
    if (updates.entityType !== void 0) tenant.entityType = updates.entityType;
    if (updates.panNumber !== void 0) tenant.panNumber = updates.panNumber.trim();
    if (updates.phone !== void 0) tenant.phone = updates.phone.trim();
    if (updates.address !== void 0) tenant.address = updates.address.trim();
    if (updates.ownerEmail !== void 0) tenant.ownerEmail = updates.ownerEmail.trim();
    if (updates.planName !== void 0) tenant.planName = updates.planName;
    if (updates.status !== void 0) tenant.status = updates.status;
    if (updates.maxRolesAllowed !== void 0) {
      tenant.maxRolesAllowed = Math.max(1, Number(updates.maxRolesAllowed));
    }
    if (Array.isArray(updates.allowedRoles)) tenant.allowedRoles = updates.allowedRoles;
    if (Array.isArray(updates.enabledModules)) {
      tenant.enabledModules = Array.from(/* @__PURE__ */ new Set(["core_lims", ...updates.enabledModules]));
    }
    if (updates.storageQuotaMb !== void 0) {
      tenant.storageQuotaMb = Math.max(1024, Number(updates.storageQuotaMb));
    }
    tenant.controlReason = reasonStr;
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "SAAS_TENANT_UPDATED",
      tenant.code,
      `SaaS Admin updated '${tenant.name}' (PAN ${tenant.panNumber}, Status: ${tenant.status}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ tenant, db });
  });
  app.delete("/api/saas/tenants/:id", withAuth("saas.tenants.manage"), (req, res) => {
    const { db, actor } = req;
    const reasonStr = (req.body?.reason || req.query.reason || "").trim();
    if (!reasonStr) {
      res.status(400).json({ error: "A mandatory Reason is required to delete a SaaS Tenant." });
      return;
    }
    const idx = db.tenants.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "SaaS Lab Tenant not found." });
      return;
    }
    if (db.tenants[idx].code === db.saas.tenantId) {
      res.status(400).json({ error: "Cannot delete the currently active primary platform tenant." });
      return;
    }
    const [removed] = db.tenants.splice(idx, 1);
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "SAAS_TENANT_DELETED",
      removed.code,
      `SaaS Admin deleted lab tenant '${removed.name}' (PAN: ${removed.panNumber}). Reason: ${reasonStr}`,
      "CRITICAL"
    );
    saveDb(db);
    res.json({ ok: true, db });
  });
  app.put("/api/saas/config", withAuth("admin.control"), (req, res) => {
    const { db, actor } = req;
    const updates = req.body;
    const reasonStr = (updates.reason || "Admin configuration update").trim();
    if (updates.planName) db.saas.planName = updates.planName;
    if (updates.billingCycle) db.saas.billingCycle = updates.billingCycle;
    if (updates.basePlanPriceNpr !== void 0) db.saas.basePlanPriceNpr = Number(updates.basePlanPriceNpr);
    if (updates.storageQuotaMb !== void 0) db.saas.storageQuotaMb = Math.max(1024, Number(updates.storageQuotaMb));
    if (updates.maxStaffSeats !== void 0) db.saas.maxStaffSeats = Math.max(5, Number(updates.maxStaffSeats));
    if (updates.maxCollectionCenters !== void 0) {
      db.saas.maxCollectionCenters = Math.max(1, Number(updates.maxCollectionCenters));
    }
    if (updates.maxMonthlyOrders !== void 0) {
      db.saas.maxMonthlyOrders = Math.max(100, Number(updates.maxMonthlyOrders));
    }
    if (updates.maxRolesCapacity !== void 0) {
      db.saas.maxRolesCapacity = Math.max(1, Number(updates.maxRolesCapacity));
    }
    if (Array.isArray(updates.allowedRoleIds)) {
      db.saas.allowedRoleIds = updates.allowedRoleIds;
    }
    if (updates.tenantDomain) db.saas.tenantDomain = updates.tenantDomain;
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "SAAS_PLAN_UPDATED",
      db.saas.tenantId,
      `Updated Hospital resource quotas (${Math.round(db.saas.storageQuotaMb / 1024)} GB quota, ${db.saas.maxStaffSeats} seats, ${db.saas.maxRolesCapacity} roles max). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db) });
  });
  app.post("/api/saas/compact-storage", withAuth("admin.control"), (req, res) => {
    const { db, actor } = req;
    const reasonStr = (req.body?.reason || "Routine hospital storage optimization").trim();
    const beforeArchived = db.saas.archivedReportMediaMb;
    db.saas.archivedReportMediaMb = Number(Math.max(120, beforeArchived * 0.65).toFixed(2));
    if (db.apiDispatches.length > 15) {
      db.apiDispatches = db.apiDispatches.slice(0, 15);
    }
    if (db.emailNotifications.length > 20) {
      db.emailNotifications = db.emailNotifications.slice(0, 20);
    }
    const reclaimedMb = Number((beforeArchived - db.saas.archivedReportMediaMb).toFixed(2));
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "STORAGE_COMPACTED",
      db.saas.tenantId,
      `Compacted PDF/media archive and pruned stale dispatch buffers (reclaimed ${reclaimedMb} MB). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor), telemetry: computeSaasTelemetry(db), reclaimedMb });
  });
  app.post("/api/saas/impersonate", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || void 0;
    const actor = getActor(db, actorId);
    const impTokenHeader = req.header("x-saas-impersonation") || "";
    const mappedAdminId = impTokenHeader ? activeImpersonations.get(impTokenHeader) : void 0;
    const originActor = mappedAdminId ? db.staff.find((s) => s.id === mappedAdminId) : void 0;
    const authorizedAdmin = actor.roleId === "SUPER_ADMIN" ? actor : originActor?.roleId === "SUPER_ADMIN" ? originActor : null;
    if (!authorizedAdmin) {
      res.status(403).json({
        error: "Only Hospital Admin (SUPER_ADMIN) can directly switch into staff or satellite clinic accounts."
      });
      return;
    }
    const { targetUserId } = req.body;
    const target = db.staff.find((s) => s.id === targetUserId);
    if (!target) {
      res.status(404).json({ error: "Target account not found." });
      return;
    }
    if (target.status === "Suspended") {
      res.status(400).json({ error: `Account '@${target.username}' is Suspended.` });
      return;
    }
    const impersonationToken = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    activeImpersonations.set(impersonationToken, authorizedAdmin.id);
    appendAudit(
      db,
      authorizedAdmin,
      "SAAS_CONTROL",
      "ADMIN_DIRECT_SWITCH",
      target.username,
      `Hospital Admin directly entered @${target.username} (${target.fullName} \xB7 ${target.roleId}${target.assignedCenterName ? ` \xB7 ${target.assignedCenterName}` : ""}).`,
      "WARNING"
    );
    saveDb(db);
    res.json({
      activeUser: target,
      impersonationToken,
      saasAdminUser: authorizedAdmin,
      db: scopeDbForActor(db, target),
      telemetry: computeSaasTelemetry(db)
    });
  });
  app.post("/api/saas/exit-impersonation", (req, res) => {
    const db = getDb();
    const { impersonationToken } = req.body || {};
    const token = impersonationToken || req.header("x-saas-impersonation") || "";
    const adminId = token ? activeImpersonations.get(token) : void 0;
    if (!adminId) {
      res.status(401).json({ error: "Session switch token is invalid or expired." });
      return;
    }
    const adminUser = db.staff.find(
      (s) => s.id === adminId && s.roleId === "SUPER_ADMIN"
    );
    if (!adminUser) {
      res.status(404).json({ error: "Originating Hospital Admin account not found." });
      return;
    }
    activeImpersonations.delete(token);
    appendAudit(
      db,
      adminUser,
      "SAAS_CONTROL",
      "ADMIN_EXIT_SWITCH",
      adminUser.username,
      `Returned from staff session back to Hospital Admin Console.`
    );
    saveDb(db);
    res.json({
      activeUser: adminUser,
      db: scopeDbForActor(db, adminUser),
      telemetry: computeSaasTelemetry(db)
    });
  });
  app.post("/api/saas/clear-dummy-data", withAuth("admin.control"), (req, res) => {
    const { db, actor } = req;
    const {
      centerId = "ALL",
      clearInventoryBatches = false,
      reason,
      confirmPin,
      confirmEmail
    } = req.body || {};
    const expectedPin = String(db.settings?.moduleSettings?.adminEraseSecretPin || "2082").trim();
    const expectedEmail = String(db.settings?.moduleSettings?.adminConfirmEmail || "epusaan@gmail.com").trim().toLowerCase();
    const pinMatched = Boolean(confirmPin && confirmPin.trim() === expectedPin);
    const emailMatched = Boolean(confirmEmail && confirmEmail.trim().toLowerCase() === expectedEmail);
    if (!pinMatched && !emailMatched) {
      res.status(403).json({
        error: `Erase Confirmation Failed: Enter valid Admin Secret PIN or confirmed Admin Email (${expectedEmail}) before erasing dummy data.`,
        code: "ERASE_CONFIRMATION_REQUIRED"
      });
      return;
    }
    const reasonStr = (reason || "Admin operational reset").trim();
    const clearedOrders = db.orders.length;
    const clearedPharmacyInvoices = db.pharmacyInvoices.length;
    db.orders = [];
    db.patients = [];
    db.financialLedger = [];
    db.counterCloses = [];
    db.payrollRuns = [];
    db.riderTasks = [];
    db.centerAwards = [];
    db.emailNotifications = [];
    db.apiDispatches = [];
    db.whatsappLogs = [];
    db.securityAlerts = [];
    db.pharmacyInvoices = [];
    db.pharmacyMovements = [];
    db.inventoryMovements = [];
    db.storeRequisitions = [];
    db.opdVisits = [];
    db.ipdAdmissions = [];
    db.emergencyCases = [];
    db.gatepasses = [];
    db.attendanceLogs = [];
    db.shiftHandovers = [];
    db.marketingVisits = [];
    db.dartaChalani = [];
    db.birthCertificates = [];
    db.deathCertificates = [];
    db.dhis2Reports = [];
    db.referralPayoutRequests = [];
    db.hospitalBeds.forEach((b) => {
      b.status = "Available";
      b.currentAdmissionId = null;
      b.currentPatientName = null;
    });
    db.referrals.forEach((r) => {
      r.totalReferredSales = 0;
      r.totalCommissionEarned = 0;
      r.totalCommissionPaid = 0;
    });
    if (clearInventoryBatches) {
      db.pharmacyBatches = [];
      db.reagents.forEach((rg) => {
        rg.currentStock = 0;
      });
    }
    db.saas.archivedReportMediaMb = 12;
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "DUMMY_DATA_CLEARED",
      "ALL_HOSPITAL_DATA",
      `Hospital Admin cleared dummy transactional data (verified via ${pinMatched ? "Secret PIN" : "Admin Email"}). Cleared ${clearedOrders} orders, ${clearedPharmacyInvoices} pharmacy bills${clearInventoryBatches ? ", + inventory batches" : ""}. Reason: ${reasonStr}`,
      "CRITICAL"
    );
    saveDb(db);
    res.json({
      db: scopeDbForActor(db, actor),
      telemetry: computeSaasTelemetry(db),
      clearedSummary: {
        scope: "Saptari Hospital Pvt Ltd",
        clearedOrders,
        clearedPharmacyInvoices,
        clearInventoryBatches
      }
    });
  });
  app.post("/api/saas/seed-center-data", withAuth("admin.control"), (req, res) => {
    const { db, actor } = req;
    const {
      includeTests = true,
      includeReports = true,
      includeRadiology = true,
      includePharmacy = true,
      includeReagents = true,
      includeHospital = true,
      reason
    } = req.body || {};
    const reasonStr = (reason || "").trim();
    if (!reasonStr) {
      res.status(400).json({ error: "A mandatory Reason is required to seed system data." });
      return;
    }
    const templateSeed = createSeedDatabase();
    const now = Date.now();
    const stamp = String(now).slice(-5);
    const bsNow = adToBs(new Date(now));
    let addedTests = 0;
    let addedReports = 0;
    let addedRadiology = 0;
    let addedPharmacyBatches = 0;
    let addedReagents = 0;
    if (includeTests) {
      for (const srv of templateSeed.services) {
        if (!db.services.some((s) => s.code === srv.code)) {
          db.services.push(srv);
          addedTests += 1;
        }
      }
      for (const tpl of templateSeed.radiologyTemplates) {
        if (!db.radiologyTemplates.some((t) => t.code === tpl.code)) {
          db.radiologyTemplates.push(tpl);
        }
      }
    }
    if (includeReagents) {
      for (const rg of templateSeed.reagents) {
        const existing = db.reagents.find((r) => r.sku === rg.sku);
        if (!existing) {
          db.reagents.push(rg);
          addedReagents += 1;
        } else if (existing.currentStock <= 0) {
          existing.currentStock = rg.currentStock;
          addedReagents += 1;
        }
      }
    }
    if (includeReports) {
      const validatedSeedOrder = templateSeed.orders.find((o) => o.tests.some((t) => t.serviceCategory !== "RADIOLOGY") && o.status === "Validated") || templateSeed.orders[0];
      if (validatedSeedOrder) {
        const cloned = {
          ...JSON.parse(JSON.stringify(validatedSeedOrder)),
          id: `ord-seed-${now}`,
          accessionNumber: `SAP-${bsNow.year}-S${stamp}`,
          invoiceNumber: `BILL-${bsNow.year}-S${stamp}`,
          fiscalYear: db.settings.activeFiscalYear,
          collectionCenterId: null,
          collectionCenterName: "Saptari Hospital Pvt Ltd",
          orderedAt: new Date(now - 90 * 6e4).toISOString(),
          validatedAt: new Date(now - 10 * 6e4).toISOString()
        };
        db.orders.unshift(cloned);
        addedReports += 1;
      }
    }
    if (includeRadiology) {
      const radSeedOrder = templateSeed.orders.find((o) => o.tests.some((t) => t.serviceCategory === "RADIOLOGY")) || templateSeed.orders[0];
      if (radSeedOrder) {
        const cloned = {
          ...JSON.parse(JSON.stringify(radSeedOrder)),
          id: `ord-rad-seed-${now}`,
          accessionNumber: `SAP-${bsNow.year}-${stamp}R`,
          invoiceNumber: `BILL-${bsNow.year}-${stamp}R`,
          fiscalYear: db.settings.activeFiscalYear,
          collectionCenterId: null,
          collectionCenterName: "Saptari Hospital Pvt Ltd",
          orderedAt: new Date(now - 60 * 6e4).toISOString(),
          validatedAt: new Date(now - 5 * 6e4).toISOString()
        };
        db.orders.unshift(cloned);
        addedRadiology += 1;
      }
    }
    if (includePharmacy) {
      for (const med of templateSeed.pharmacyMedicines) {
        if (!db.pharmacyMedicines.some((m) => m.code === med.code)) {
          db.pharmacyMedicines.push(med);
        }
      }
      const expSoon = new Date(now + 42 * 864e5).toISOString().slice(0, 10);
      const expLater = new Date(now + 240 * 864e5).toISOString().slice(0, 10);
      templateSeed.pharmacyBatches.slice(0, 4).forEach((b, bIdx) => {
        const batch = {
          ...b,
          id: `pbat-seed-${now}-${bIdx}`,
          centerId: null,
          centerName: "Saptari Hospital Central Pharmacy",
          batchNumber: `${b.batchNumber}-S${bIdx}`,
          expiryDate: bIdx === 0 ? expSoon : expLater,
          quantityReceived: 100,
          quantityOnHand: 100,
          grnNumber: `GRN-SEED-${stamp}`,
          receivedAt: new Date(now).toISOString(),
          quarantined: false
        };
        db.pharmacyBatches.push(batch);
        addedPharmacyBatches += 1;
      });
    }
    if (includeHospital && (!db.hospitalBeds || db.hospitalBeds.length === 0)) {
      templateSeed.hospitalBeds.forEach((b) => db.hospitalBeds.push(b));
    }
    appendAudit(
      db,
      actor,
      "SAAS_CONTROL",
      "SAAS_SYSTEM_DATA_SEEDED",
      "SAPTARI_HOSP",
      `Admin seeded fresh Hospital data (Tests:${addedTests}, Reports:${addedReports}, Radiology:${addedRadiology}, PharmacyBatches:${addedPharmacyBatches}, Reagents:${addedReagents}). Reason: ${reasonStr}`
    );
    saveDb(db);
    res.status(201).json({
      db: scopeDbForActor(db, actor),
      telemetry: computeSaasTelemetry(db),
      seededSummary: {
        scope: "Saptari Hospital Pvt Ltd",
        addedTests,
        addedReports,
        addedRadiology,
        addedPharmacyBatches,
        addedReagents
      }
    });
  });
  app.post("/api/pharmacy/medicines", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.code?.trim() || !body.brandName?.trim() || !body.genericName?.trim()) {
      res.status(400).json({ error: "Medicine code, brand name, and generic name are required." });
      return;
    }
    const inrMrp = body.inrMrp !== void 0 && Number(body.inrMrp) > 0 ? Number(Number(body.inrMrp).toFixed(2)) : void 0;
    const computedNprMrp = inrMrp ? Number((inrMrp * 1.6).toFixed(2)) : void 0;
    const defaultMrpNpr = body.defaultMrpNpr !== void 0 && Number(body.defaultMrpNpr) > 0 ? Number(Number(body.defaultMrpNpr).toFixed(2)) : computedNprMrp || 10;
    const defaultPurchaseRateNpr = body.defaultPurchaseRateNpr !== void 0 && Number(body.defaultPurchaseRateNpr) > 0 ? Number(Number(body.defaultPurchaseRateNpr).toFixed(2)) : Number((defaultMrpNpr / 1.16).toFixed(2));
    const existingIdx = body.id ? db.pharmacyMedicines.findIndex((m) => m.id === body.id) : -1;
    const saved = {
      id: existingIdx >= 0 ? db.pharmacyMedicines[existingIdx].id : `med-${Date.now()}`,
      code: body.code.trim().toUpperCase(),
      brandName: body.brandName.trim(),
      genericName: body.genericName.trim(),
      dosageForm: body.dosageForm || "Tablet",
      strength: body.strength?.trim() || "500mg",
      manufacturer: body.manufacturer?.trim() || "Deurali-Janta Pharma (Nepal)",
      category: body.category?.trim() || "General",
      scheduleType: body.scheduleType || "OTC",
      rackLocation: body.rackLocation?.trim() || "A-01",
      unitLabel: body.unitLabel?.trim() || "Tabs",
      vatApplicable: Boolean(body.vatApplicable),
      reorderLevel: Math.max(0, Number(body.reorderLevel) || 50),
      defaultMrpNpr,
      inrMrp,
      defaultPurchaseRateNpr,
      active: body.active ?? true
    };
    if (existingIdx >= 0) {
      db.pharmacyMedicines[existingIdx] = saved;
    } else {
      db.pharmacyMedicines.unshift(saved);
    }
    appendAudit(
      db,
      actor,
      "PHARMACY",
      existingIdx >= 0 ? "MEDICINE_UPDATED" : "MEDICINE_CREATED",
      saved.code,
      `${existingIdx >= 0 ? "Updated" : "Added"} medicine ${saved.brandName} (${saved.genericName} ${saved.strength}) at Rack ${saved.rackLocation}.`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ medicine: saved, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/batches", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    const med = db.pharmacyMedicines.find((m) => m.id === body.medicineId);
    if (!med) {
      res.status(404).json({ error: "Selected medicine not found in Pharmacy Master." });
      return;
    }
    if (!body.batchNumber?.trim() || !body.expiryDate?.trim()) {
      res.status(400).json({ error: "Batch number and Expiry Date (YYYY-MM-DD) are required for FEFO." });
      return;
    }
    const qty = Number(body.quantityReceived);
    if (!qty || qty <= 0) {
      res.status(400).json({ error: "Positive GRN quantity is required." });
      return;
    }
    const effectiveCenterId = null;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const grnNumber = body.grnNumber?.trim() || `GRN-${Date.now().toString().slice(-6)}`;
    const inrMrp = body.inrMrp && Number(body.inrMrp) > 0 ? Number(Number(body.inrMrp).toFixed(2)) : void 0;
    const mrpNpr = body.mrpNpr && Number(body.mrpNpr) > 0 ? Number(Number(body.mrpNpr).toFixed(2)) : inrMrp ? Number((inrMrp * 1.6).toFixed(2)) : med.defaultMrpNpr;
    const purchaseRateNpr = body.purchaseRateNpr && Number(body.purchaseRateNpr) > 0 ? Number(Number(body.purchaseRateNpr).toFixed(2)) : Number((mrpNpr / 1.16).toFixed(2));
    const matchedSupplier = (body.supplierId ? (db.pharmacySuppliers || []).find((s) => s.id === body.supplierId) : void 0) || (body.supplierName ? (db.pharmacySuppliers || []).find(
      (s) => s.name.toLowerCase() === body.supplierName.trim().toLowerCase()
    ) : void 0);
    const created = {
      id: `pbat-${Date.now()}`,
      medicineId: med.id,
      centerId: effectiveCenterId,
      centerName: "Saptari Hospital Central Pharmacy",
      batchNumber: body.batchNumber.trim().toUpperCase(),
      mfgDate: body.mfgDate?.trim() || nowIso.slice(0, 10),
      expiryDate: body.expiryDate.trim(),
      quantityReceived: qty,
      quantityOnHand: qty,
      purchaseRateNpr,
      mrpNpr,
      inrMrp,
      isOpeningStock: Boolean(body.isOpeningStock),
      supplierName: matchedSupplier?.name || body.supplierName?.trim() || "Janakpur Drug Distributors",
      grnNumber,
      receivedAt: nowIso,
      quarantined: false
    };
    db.pharmacyBatches.push(created);
    const totalCostNpr = Number((qty * created.purchaseRateNpr).toFixed(2));
    const move = {
      id: `pmov-${Date.now()}`,
      timestamp: nowIso,
      medicineId: med.id,
      medicineName: med.brandName,
      batchId: created.id,
      batchNumber: created.batchNumber,
      expiryDate: created.expiryDate,
      centerId: created.centerId,
      type: body.isOpeningStock ? "OPENING_STOCK" : "GRN_IN",
      quantityDelta: qty,
      balanceAfter: qty,
      referenceId: grnNumber,
      performedBy: actor.fullName,
      notes: body.isOpeningStock ? `Opening Stock entry (${created.batchNumber})` : `GRN intake from ${created.supplierName} (${body.paymentStatus === "CREDIT" ? "Credit Party Due" : "Cash/Bank"})`
    };
    db.pharmacyMovements.unshift(move);
    if (!body.isOpeningStock && body.paymentStatus === "CREDIT" && matchedSupplier) {
      matchedSupplier.currentDueNpr = Number(((matchedSupplier.currentDueNpr || 0) + totalCostNpr).toFixed(2));
      matchedSupplier.updatedAt = nowIso;
    } else if (body.postPurchaseOutflow && !body.isOpeningStock) {
      const acc = body.accountId && db.accounts.find((a) => a.id === body.accountId) || db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.departmentScope === "PHARMACY") || db.accounts.find((a) => a.type === "BANK") || db.accounts[0];
      if (acc) {
        postLedgerMovement(
          db,
          acc,
          "OUTFLOW",
          totalCostNpr,
          "PHARMACY_PURCHASE",
          grnNumber,
          `Pharmacy GRN purchase ${med.brandName} Batch ${created.batchNumber}`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }
    appendAudit(
      db,
      actor,
      "PHARMACY",
      body.isOpeningStock ? "PHARMACY_OPENING_STOCK_ADDED" : "PHARMACY_GRN_BATCH_ADDED",
      created.batchNumber,
      `Received ${qty} ${med.unitLabel} of ${med.brandName} (Batch ${created.batchNumber}, Exp ${created.expiryDate}, MRP \u0930\u0942 ${mrpNpr}, Buy \u0930\u0942 ${purchaseRateNpr}) from ${created.supplierName}.`
    );
    saveDb(db);
    res.status(201).json({ batch: created, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/suppliers", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim()) {
      res.status(400).json({ error: "Supplier / Party name is required." });
      return;
    }
    if (!Array.isArray(db.pharmacySuppliers)) db.pharmacySuppliers = [];
    const existingIdx = body.id ? db.pharmacySuppliers.findIndex((s) => s.id === body.id) : -1;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const openingDue = Math.max(0, Number(body.openingDueNpr) || 0);
    const saved = {
      id: existingIdx >= 0 ? db.pharmacySuppliers[existingIdx].id : `psup-${Date.now()}`,
      code: body.code?.trim().toUpperCase() || `SUP-${String(db.pharmacySuppliers.length + 1).padStart(3, "0")}`,
      name: body.name.trim(),
      contactPerson: body.contactPerson?.trim() || "",
      phone: normalizeNepalPhone(body.phone),
      address: body.address?.trim() || "",
      panVat: body.panVat?.trim() || "",
      paymentTerms: body.paymentTerms || "Credit 30 Days",
      creditDays: Math.max(0, Number(body.creditDays ?? 30)),
      openingDueNpr: openingDue,
      currentDueNpr: body.currentDueNpr !== void 0 ? Math.max(0, Number(body.currentDueNpr) || 0) : existingIdx >= 0 ? db.pharmacySuppliers[existingIdx].currentDueNpr : openingDue,
      notes: body.notes?.trim() || "",
      active: body.active ?? true,
      createdAt: existingIdx >= 0 ? db.pharmacySuppliers[existingIdx].createdAt : nowIso,
      updatedAt: nowIso
    };
    if (existingIdx >= 0) db.pharmacySuppliers[existingIdx] = saved;
    else db.pharmacySuppliers.unshift(saved);
    appendAudit(
      db,
      actor,
      "PHARMACY",
      existingIdx >= 0 ? "SUPPLIER_UPDATED" : "SUPPLIER_CREATED",
      saved.code,
      `${existingIdx >= 0 ? "Updated" : "Added"} pharmacy supplier ${saved.name} (${saved.paymentTerms}, Due \u0930\u0942 ${saved.currentDueNpr.toLocaleString()}).`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ supplier: saved, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/pharmacy/suppliers/:id", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.pharmacySuppliers)) db.pharmacySuppliers = [];
    const idx = db.pharmacySuppliers.findIndex((s) => s.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Supplier not found." });
      return;
    }
    const [removed] = db.pharmacySuppliers.splice(idx, 1);
    appendAudit(db, actor, "PHARMACY", "SUPPLIER_DELETED", removed.code, `Deleted supplier ${removed.name}.`, "WARNING");
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/suppliers/:id/pay", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const supplier = (db.pharmacySuppliers || []).find((s) => s.id === req.params.id);
    if (!supplier) {
      res.status(404).json({ error: "Supplier not found." });
      return;
    }
    const { amountNpr, accountId, referenceNo, notes } = req.body || {};
    const amt = Math.max(0, Number(amountNpr) || 0);
    if (amt <= 0) {
      res.status(400).json({ error: "Positive payment amount (\u0930\u0942) is required." });
      return;
    }
    const acc = accountId && db.accounts.find((a) => a.id === accountId) || db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.departmentScope === "PHARMACY") || db.accounts[0];
    if (!acc) {
      res.status(400).json({ error: "No cash/bank account found to post payment." });
      return;
    }
    supplier.currentDueNpr = Number(Math.max(0, (supplier.currentDueNpr || 0) - amt).toFixed(2));
    supplier.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    const ref = referenceNo?.trim() || `SUP-PAY-${Date.now().toString().slice(-5)}`;
    postLedgerMovement(
      db,
      acc,
      "OUTFLOW",
      amt,
      "SUPPLIER_PAYMENT",
      ref,
      notes?.trim() || `Pharmacy Supplier Payment to ${supplier.name}`,
      db.settings.activeFiscalYear,
      actor
    );
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "SUPPLIER_DUE_PAID",
      ref,
      `Paid \u0930\u0942 ${amt.toLocaleString()} to supplier ${supplier.name}. Remaining due: \u0930\u0942 ${supplier.currentDueNpr.toLocaleString()}.`
    );
    saveDb(db);
    res.json({ supplier, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/manufacturers", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim()) {
      res.status(400).json({ error: "Company / Manufacturer name is required." });
      return;
    }
    if (!Array.isArray(db.pharmacyManufacturers)) db.pharmacyManufacturers = [];
    const existingIdx = body.id ? db.pharmacyManufacturers.findIndex((m) => m.id === body.id) : -1;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const saved = {
      id: existingIdx >= 0 ? db.pharmacyManufacturers[existingIdx].id : `pmfg-${Date.now()}`,
      code: body.code?.trim().toUpperCase() || `MFG-${String(db.pharmacyManufacturers.length + 1).padStart(3, "0")}`,
      name: body.name.trim(),
      country: body.country?.trim() || "Nepal",
      contactPhone: normalizeNepalPhone(body.contactPhone),
      address: body.address?.trim() || "",
      active: body.active ?? true,
      createdAt: existingIdx >= 0 ? db.pharmacyManufacturers[existingIdx].createdAt : nowIso
    };
    if (existingIdx >= 0) db.pharmacyManufacturers[existingIdx] = saved;
    else db.pharmacyManufacturers.unshift(saved);
    appendAudit(
      db,
      actor,
      "PHARMACY",
      existingIdx >= 0 ? "MANUFACTURER_UPDATED" : "MANUFACTURER_CREATED",
      saved.code,
      `${existingIdx >= 0 ? "Updated" : "Added"} pharma manufacturer ${saved.name}.`
    );
    saveDb(db);
    res.status(existingIdx >= 0 ? 200 : 201).json({ manufacturer: saved, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/pharmacy/manufacturers/:id", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.pharmacyManufacturers)) db.pharmacyManufacturers = [];
    const idx = db.pharmacyManufacturers.findIndex((m) => m.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Manufacturer not found." });
      return;
    }
    const [removed] = db.pharmacyManufacturers.splice(idx, 1);
    appendAudit(db, actor, "PHARMACY", "MANUFACTURER_DELETED", removed.code, `Deleted manufacturer ${removed.name}.`, "WARNING");
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/opening-stock", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const {
      medicineId,
      newMedicine,
      batchNumber,
      mfgDate,
      expiryDate,
      quantity,
      inrMrp,
      mrpNpr,
      buyFormula = "MRP_DIV_116",
      purchaseRateNpr,
      supplierName,
      notes
    } = req.body;
    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0 || !batchNumber?.trim() || !expiryDate?.trim()) {
      res.status(400).json({ error: "Positive opening stock quantity, batch number, and expiry date are required." });
      return;
    }
    const parsedInrMrp = inrMrp && Number(inrMrp) > 0 ? Number(Number(inrMrp).toFixed(2)) : void 0;
    const resolvedMrpNpr = parsedInrMrp && (!mrpNpr || Number(mrpNpr) <= 0) ? Number((parsedInrMrp * 1.6).toFixed(2)) : Number(Number(mrpNpr || 0).toFixed(2));
    let med = medicineId ? db.pharmacyMedicines.find((m) => m.id === medicineId) : void 0;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!med) {
      if (!newMedicine?.code?.trim() || !newMedicine?.brandName?.trim() || !newMedicine?.genericName?.trim()) {
        res.status(404).json({ error: "Select an existing medicine or provide code, brand name, and generic name." });
        return;
      }
      const fallbackMrp = resolvedMrpNpr > 0 ? resolvedMrpNpr : Math.max(1, Number(newMedicine.defaultMrpNpr) || 10);
      const createdMed = {
        id: `med-${Date.now()}`,
        code: newMedicine.code.trim().toUpperCase(),
        brandName: newMedicine.brandName.trim(),
        genericName: newMedicine.genericName.trim(),
        dosageForm: newMedicine.dosageForm || "Tablet",
        strength: newMedicine.strength?.trim() || "500mg",
        manufacturer: newMedicine.manufacturer?.trim() || "Deurali-Janta Pharma (Nepal)",
        category: newMedicine.category?.trim() || "General",
        scheduleType: newMedicine.scheduleType || "OTC",
        rackLocation: newMedicine.rackLocation?.trim() || "A-01",
        unitLabel: newMedicine.unitLabel?.trim() || "Tabs",
        vatApplicable: Boolean(newMedicine.vatApplicable),
        reorderLevel: Math.max(0, Number(newMedicine.reorderLevel) || 50),
        defaultMrpNpr: fallbackMrp,
        inrMrp: parsedInrMrp,
        defaultPurchaseRateNpr: Number((fallbackMrp / 1.16).toFixed(2)),
        active: true
      };
      db.pharmacyMedicines.unshift(createdMed);
      med = createdMed;
    }
    const finalMrpNpr = resolvedMrpNpr > 0 ? resolvedMrpNpr : med.defaultMrpNpr;
    let finalBuyRateNpr;
    if (buyFormula === "CUSTOM" && purchaseRateNpr && Number(purchaseRateNpr) > 0) {
      finalBuyRateNpr = Number(Number(purchaseRateNpr).toFixed(2));
    } else if (buyFormula === "MRP_DIV_120") {
      finalBuyRateNpr = Number((finalMrpNpr / 1.2).toFixed(2));
    } else if (buyFormula === "MRP_MUL_084") {
      finalBuyRateNpr = Number((finalMrpNpr * 0.84).toFixed(2));
    } else {
      finalBuyRateNpr = Number((finalMrpNpr / 1.16).toFixed(2));
    }
    med.defaultMrpNpr = finalMrpNpr;
    if (parsedInrMrp) med.inrMrp = parsedInrMrp;
    med.defaultPurchaseRateNpr = finalBuyRateNpr;
    const createdBatch = {
      id: `pbat-op-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      medicineId: med.id,
      centerId: null,
      centerName: "Saptari Hospital Central Pharmacy",
      batchNumber: batchNumber.trim().toUpperCase(),
      mfgDate: mfgDate?.trim() || nowIso.slice(0, 10),
      expiryDate: expiryDate.trim(),
      quantityReceived: qty,
      quantityOnHand: qty,
      purchaseRateNpr: finalBuyRateNpr,
      mrpNpr: finalMrpNpr,
      inrMrp: parsedInrMrp,
      isOpeningStock: true,
      supplierName: supplierName?.trim() || "Opening Stock Carryforward",
      grnNumber: "OPENING-STOCK",
      receivedAt: nowIso,
      quarantined: false
    };
    db.pharmacyBatches.push(createdBatch);
    const movement = {
      id: `pmov-op-${Date.now()}`,
      timestamp: nowIso,
      medicineId: med.id,
      medicineName: med.brandName,
      batchId: createdBatch.id,
      batchNumber: createdBatch.batchNumber,
      expiryDate: createdBatch.expiryDate,
      centerId: null,
      type: "OPENING_STOCK",
      quantityDelta: qty,
      balanceAfter: qty,
      referenceId: "OPENING-STOCK",
      performedBy: actor.fullName,
      notes: notes?.trim() || `Opening Stock (${qty} ${med.unitLabel}) \xB7 ${parsedInrMrp ? `INR ${parsedInrMrp} \xD7 1.6 = ` : ""}MRP \u0930\u0942 ${finalMrpNpr} \xB7 Wholesale Buy \u0930\u0942 ${finalBuyRateNpr} (${buyFormula})`
    };
    db.pharmacyMovements.unshift(movement);
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "PHARMACY_OPENING_STOCK_ADDED",
      createdBatch.batchNumber,
      `Opening stock ${qty} ${med.unitLabel} for ${med.brandName}: MRP \u0930\u0942 ${finalMrpNpr}${parsedInrMrp ? ` (from INR ${parsedInrMrp})` : ""}, Buy \u0930\u0942 ${finalBuyRateNpr}.`
    );
    saveDb(db);
    res.status(201).json({ medicine: med, batch: createdBatch, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/batches/:id/write-off", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const batch = db.pharmacyBatches.find((b) => b.id === req.params.id);
    if (!batch) {
      res.status(404).json({ error: "Pharmacy batch not found." });
      return;
    }
    const { reason } = req.body || {};
    const med = db.pharmacyMedicines.find((m) => m.id === batch.medicineId);
    const writtenOffQty = batch.quantityOnHand;
    batch.quarantined = true;
    batch.quantityOnHand = 0;
    db.pharmacyMovements.unshift({
      id: `pmov-${Date.now()}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      medicineId: batch.medicineId,
      medicineName: med?.brandName || batch.medicineId,
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      expiryDate: batch.expiryDate,
      centerId: batch.centerId,
      type: "EXPIRED_WRITEOFF",
      quantityDelta: -writtenOffQty,
      balanceAfter: 0,
      referenceId: `WO-${batch.batchNumber}`,
      performedBy: actor.fullName,
      notes: reason?.trim() || `Quarantined & written off expired/damaged batch ${batch.batchNumber}`
    });
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "PHARMACY_BATCH_QUARANTINED",
      batch.batchNumber,
      `Quarantined & wrote off ${writtenOffQty} units from Batch ${batch.batchNumber} (Exp ${batch.expiryDate}).`,
      "WARNING"
    );
    saveDb(db);
    res.json({ batch, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/batches/:id/clearance", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const batch = db.pharmacyBatches.find((b) => b.id === req.params.id);
    if (!batch) {
      res.status(404).json({ error: "Pharmacy batch not found." });
      return;
    }
    const { action, discountPercent, quantity, notes } = req.body || {};
    const med = db.pharmacyMedicines.find((m) => m.id === batch.medicineId);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (action === "DISCOUNT_SALE") {
      const pct = Math.max(1, Math.min(90, Number(discountPercent) || 25));
      const prevMrp = batch.mrpNpr;
      batch.mrpNpr = Number(Math.max(1, prevMrp * (1 - pct / 100)).toFixed(2));
      db.pharmacyMovements.unshift({
        id: `pmov-${Date.now()}`,
        timestamp: nowIso,
        medicineId: batch.medicineId,
        medicineName: med?.brandName || batch.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        centerId: batch.centerId,
        type: "RETURN_ADJUST",
        quantityDelta: 0,
        balanceAfter: batch.quantityOnHand,
        referenceId: `DISC-${pct}%`,
        performedBy: actor.fullName,
        notes: notes?.trim() || `Near-expiry clearance discount ${pct}% (MRP \u0930\u0942 ${prevMrp} -> \u0930\u0942 ${batch.mrpNpr})`
      });
      appendAudit(
        db,
        actor,
        "PHARMACY",
        "NEAR_EXPIRY_DISCOUNT_SET",
        batch.batchNumber,
        `Applied ${pct}% near-expiry discount to ${med?.brandName || batch.medicineId} Batch ${batch.batchNumber} (MRP \u0930\u0942 ${prevMrp} -> \u0930\u0942 ${batch.mrpNpr}).`,
        "INFO"
      );
    } else if (action === "RETURN_SUPPLIER") {
      const retQty = Math.min(batch.quantityOnHand, Math.max(1, Number(quantity) || batch.quantityOnHand));
      batch.quantityOnHand = Math.max(0, batch.quantityOnHand - retQty);
      if (batch.quantityOnHand === 0) batch.quarantined = true;
      db.pharmacyMovements.unshift({
        id: `pmov-${Date.now()}`,
        timestamp: nowIso,
        medicineId: batch.medicineId,
        medicineName: med?.brandName || batch.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        centerId: batch.centerId,
        type: "RETURN_ADJUST",
        quantityDelta: -retQty,
        balanceAfter: batch.quantityOnHand,
        referenceId: `RET-${batch.batchNumber}`,
        performedBy: actor.fullName,
        notes: notes?.trim() || `Returned ${retQty} units to ${batch.supplierName} for expiry credit note`
      });
      appendAudit(
        db,
        actor,
        "PHARMACY",
        "NEAR_EXPIRY_RETURN_SUPPLIER",
        batch.batchNumber,
        `Returned ${retQty} units of ${med?.brandName || batch.medicineId} Batch ${batch.batchNumber} (Exp ${batch.expiryDate}) to ${batch.supplierName}.`,
        "WARNING"
      );
    } else {
      const woQty = Math.min(batch.quantityOnHand, Math.max(1, Number(quantity) || batch.quantityOnHand));
      batch.quantityOnHand = Math.max(0, batch.quantityOnHand - woQty);
      if (batch.quantityOnHand === 0) batch.quarantined = true;
      db.pharmacyMovements.unshift({
        id: `pmov-${Date.now()}`,
        timestamp: nowIso,
        medicineId: batch.medicineId,
        medicineName: med?.brandName || batch.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        centerId: batch.centerId,
        type: "EXPIRED_WRITEOFF",
        quantityDelta: -woQty,
        balanceAfter: batch.quantityOnHand,
        referenceId: `WO-${batch.batchNumber}`,
        performedBy: actor.fullName,
        notes: notes?.trim() || `Written off near-expiry/expired batch ${batch.batchNumber}`
      });
      appendAudit(
        db,
        actor,
        "PHARMACY",
        "NEAR_EXPIRY_WRITEOFF",
        batch.batchNumber,
        `Written off ${woQty} units of Batch ${batch.batchNumber} (Exp ${batch.expiryDate}).`,
        "WARNING"
      );
    }
    saveDb(db);
    res.json({ batch, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/fetch-nepal-catalog", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const { withOpeningStock = true } = req.body || {};
    const existingKeys = new Set(
      db.pharmacyMedicines.map((m) => `${m.code.toLowerCase()}|${m.brandName.toLowerCase()}`)
    );
    const existingBrands = new Set(db.pharmacyMedicines.map((m) => m.brandName.toLowerCase()));
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const expFuture = new Date(Date.now() + 540 * 86400 * 1e3).toISOString().slice(0, 10);
    let addedMedicines = 0;
    let addedBatches = 0;
    for (const item of NEPAL_PHARMACY_CATALOG) {
      const key = `${item.code.toLowerCase()}|${item.brandName.toLowerCase()}`;
      if (existingKeys.has(key) || existingBrands.has(item.brandName.toLowerCase())) continue;
      const medId = `med-np-${item.code.toLowerCase()}`;
      db.pharmacyMedicines.push({
        id: medId,
        code: item.code,
        brandName: item.brandName,
        genericName: item.genericName,
        dosageForm: item.dosageForm,
        strength: item.strength,
        manufacturer: item.manufacturer,
        category: item.dosageForm === "IV Fluid" ? "IV Fluid" : item.dosageForm === "Consumable" ? "Surgical / Inside Consumable" : "General / Nepal Formulary",
        scheduleType: item.dosageForm === "Consumable" || item.dosageForm === "IV Fluid" ? "OTC" : "Schedule H (Rx)",
        rackLocation: item.rackLocation,
        unitLabel: item.unitLabel,
        vatApplicable: item.vatApplicable,
        reorderLevel: item.reorderLevel,
        defaultMrpNpr: item.defaultMrpNpr,
        active: true
      });
      addedMedicines += 1;
      if (withOpeningStock && item.initialBatchQty > 0) {
        const batchId = `pbat-np-${item.code.toLowerCase()}`;
        db.pharmacyBatches.push({
          id: batchId,
          medicineId: medId,
          centerId: null,
          centerName: "Main Pharmacy Store",
          batchNumber: `NP-${item.code.replace(/[^A-Z0-9]/gi, "").slice(-5)}`,
          mfgDate: nowIso.slice(0, 10),
          expiryDate: expFuture,
          quantityReceived: item.initialBatchQty,
          quantityOnHand: item.initialBatchQty,
          purchaseRateNpr: item.purchaseRateNpr,
          mrpNpr: item.defaultMrpNpr,
          supplierName: item.manufacturer,
          grnNumber: "GRN-NEPAL-CATALOG",
          receivedAt: nowIso
        });
        addedBatches += 1;
      }
    }
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "NEPAL_PHARMA_CATALOG_FETCHED",
      "NEPAL-DDA-CATALOG",
      `Fetched ${addedMedicines} Nepalese pharma & hospital inside formulary medicines (${addedBatches} batches) across ${NEPAL_PHARMA_COMPANIES.length} companies.`
    );
    saveDb(db);
    res.status(201).json({
      addedMedicines,
      addedBatches,
      totalMedicines: db.pharmacyMedicines.length,
      companiesCount: NEPAL_PHARMA_COMPANIES.length,
      companies: NEPAL_PHARMA_COMPANIES,
      db: scopeDbForActor(db, actor)
    });
  });
  app.post("/api/services/fetch-hospital-catalog", withAuth("services.manage"), (req, res) => {
    const { db, actor } = req;
    const existingCodes = new Set(db.services.map((s) => s.code.toUpperCase()));
    let addedServices = 0;
    for (const srv of NEPAL_HOSPITAL_SERVICES_CATALOG) {
      if (existingCodes.has(srv.code.toUpperCase())) continue;
      db.services.push({
        id: `srv-np-${srv.code.toLowerCase()}`,
        code: srv.code,
        name: srv.name,
        serviceCategory: srv.serviceCategory,
        customCategory: srv.customCategory,
        modality: srv.modality,
        allowCustomRateAtBilling: true,
        department: srv.department,
        specimenType: srv.specimenType,
        containerType: srv.containerType,
        methodology: srv.methodology,
        tatMinutes: srv.tatMinutes,
        price: srv.price,
        active: true,
        parameters: [
          {
            id: `p-${srv.code.toLowerCase()}-1`,
            name: `${srv.name} Findings`,
            resultType: "QUALITATIVE",
            unit: "",
            refMinMale: 0,
            refMaxMale: 0,
            refMinFemale: 0,
            refMaxFemale: 0,
            decimalPlaces: 0
          }
        ],
        reagentBom: [],
        interpretations: {
          normal: "No significant abnormality detected.",
          abnormalLow: "Correlate clinically.",
          abnormalHigh: "Abnormal finding observed; specialist correlation advised.",
          critical: "Urgent clinical attention recommended.",
          methodologyNote: srv.methodology
        }
      });
      addedServices += 1;
    }
    appendAudit(
      db,
      actor,
      "SERVICES",
      "NEPAL_SERVICES_CATALOG_FETCHED",
      "HOSPITAL-SERVICES-SYNC",
      `Fetched ${addedServices} X-Ray, DR X-Ray, USG, Doppler, ECG & clinical procedure services.`
    );
    saveDb(db);
    res.status(201).json({
      addedServices,
      totalServices: db.services.length,
      db: scopeDbForActor(db, actor)
    });
  });
  app.post("/api/services/fetch-lab-catalog", withAuth("services.manage"), (req, res) => {
    const { db, actor } = req;
    const existingByCode = new Map(db.services.map((s) => [s.code.toUpperCase(), s]));
    let addedServices = 0;
    let updatedServices = 0;
    for (const labSrv of NEPAL_LAB_TESTS_CATALOG) {
      const codeKey = labSrv.code.toUpperCase();
      const existing = existingByCode.get(codeKey);
      if (!existing) {
        db.services.push(JSON.parse(JSON.stringify(labSrv)));
        existingByCode.set(codeKey, labSrv);
        addedServices += 1;
      } else {
        let changed = false;
        if ((!existing.parameters || existing.parameters.length === 0) && labSrv.parameters.length > 0) {
          existing.parameters = JSON.parse(JSON.stringify(labSrv.parameters));
          changed = true;
        } else {
          for (const lp of labSrv.parameters) {
            const ep = existing.parameters.find((p) => p.id === lp.id);
            if (ep && lp.analyzerCode && !ep.analyzerCode) {
              ep.analyzerCode = lp.analyzerCode;
              changed = true;
            }
          }
        }
        if (changed) updatedServices += 1;
      }
    }
    db.services = db.services.map(ensureAnalyzerCodesOnService);
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    appendAudit(
      db,
      actor,
      "SERVICES",
      "LAB_CATALOG_AUTO_FETCHED",
      "LAB-MASTER-SYNC",
      `Auto-fetched ${addedServices} new lab tests & updated ${updatedServices} analyzer-mapped panels (${db.services.length} total services).`
    );
    saveDb(db);
    res.status(201).json({
      addedServices,
      updatedServices,
      totalServices: db.services.length,
      labServicesCount: db.services.filter((s) => s.serviceCategory === "PATHOLOGY" || !s.serviceCategory).length,
      db: scopeDbForActor(db, actor)
    });
  });
  app.get("/api/lab/analyzers", withAuth("orders.view"), (req, res) => {
    const { db } = req;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
      saveDb(db);
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }
    res.json({
      analyzers: db.analyzers,
      queue: db.analyzerQueue
    });
  });
  app.post("/api/lab/analyzers/config", withAuth("results.enter"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    const { analyzerId, endpointAddress, status, autoApplyOnReceive, protocol, connectionMode } = req.body;
    const machine = db.analyzers.find((a) => a.id === analyzerId);
    if (!machine) {
      res.status(404).json({ error: "Analyzer profile not found." });
      return;
    }
    if (endpointAddress !== void 0) machine.endpointAddress = endpointAddress.trim();
    if (status) machine.status = status;
    if (autoApplyOnReceive !== void 0) machine.autoApplyOnReceive = Boolean(autoApplyOnReceive);
    if (protocol) machine.protocol = protocol;
    if (connectionMode) machine.connectionMode = connectionMode;
    machine.lastHeartbeatAt = (/* @__PURE__ */ new Date()).toISOString();
    appendAudit(
      db,
      actor,
      "RESULTS",
      "ANALYZER_CONFIG_UPDATED",
      machine.code,
      `Updated analyzer interface ${machine.name} (${machine.endpointAddress}, Auto-Apply: ${machine.autoApplyOnReceive ? "ON" : "OFF"}).`
    );
    saveDb(db);
    res.json({ analyzer: machine, analyzers: db.analyzers, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/lab/analyzers/ingest", withAuth("results.enter"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }
    const { analyzerId, rawPayload, accessionNumber, readings, values, applyImmediately } = req.body;
    const parsed = parseAnalyzerPayload({ rawPayload, accessionNumber, readings, values });
    if (!parsed.accessionNumber) {
      res.status(400).json({ error: "Accession Number (OBR-2 / O-2 / accessionNumber) is required in analyzer packet." });
      return;
    }
    if (parsed.readings.length === 0) {
      res.status(400).json({ error: "No valid analyte readings (OBX / R segments) found in analyzer payload." });
      return;
    }
    const machine = db.analyzers.find((a) => a.id === analyzerId) || db.analyzers.find(
      (a) => parsed.readings.some((r) => a.mappedAnalytes.includes(r.code.toUpperCase()))
    ) || db.analyzers[0];
    const matchedOrder = db.orders.find(
      (o) => o.accessionNumber.toUpperCase() === parsed.accessionNumber.toUpperCase() || o.id === parsed.accessionNumber
    );
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let status = matchedOrder ? "PENDING" : "UNMATCHED";
    let appliedCount = 0;
    if (matchedOrder && (applyImmediately === true || applyImmediately !== false && machine.autoApplyOnReceive)) {
      const applied = applyReadingsToOrder(db, matchedOrder, parsed.readings);
      appliedCount = applied.appliedCount;
      if (appliedCount > 0) {
        status = "APPLIED";
      }
    }
    machine.packetsProcessedCount = (machine.packetsProcessedCount || 0) + 1;
    machine.lastHeartbeatAt = now;
    const msg = {
      id: `anq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      receivedAt: now,
      analyzerId: machine.id,
      analyzerName: machine.name,
      protocol: parsed.protocol || machine.protocol,
      accessionNumber: parsed.accessionNumber,
      status,
      matchedOrderId: matchedOrder?.id,
      appliedCount,
      rawPayload: rawPayload || void 0,
      readings: parsed.readings,
      notes: matchedOrder ? status === "APPLIED" ? `Auto-fetched & mapped ${appliedCount} analyte(s) into ${matchedOrder.accessionNumber}` : `Queued for bench verification on ${matchedOrder.accessionNumber}` : `No active order found matching accession ${parsed.accessionNumber}`
    };
    db.analyzerQueue.unshift(msg);
    if (db.analyzerQueue.length > 120) {
      db.analyzerQueue = db.analyzerQueue.slice(0, 120);
    }
    appendAudit(
      db,
      actor,
      "RESULTS",
      status === "APPLIED" ? "ANALYZER_PACKET_AUTO_APPLIED" : "ANALYZER_PACKET_QUEUED",
      parsed.accessionNumber,
      `${machine.name} (${parsed.protocol}) received ${parsed.readings.length} reading(s) for ${parsed.accessionNumber} -> ${status}.`
    );
    saveDb(db);
    res.status(201).json({
      message: msg,
      order: matchedOrder || null,
      appliedCount,
      db: scopeDbForActor(db, actor)
    });
  });
  app.post("/api/orders/:id/auto-fetch-analyzer", withAuth("results.enter"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }
    const order = db.orders.find((o) => o.id === req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (order.status === "Validated" || order.status === "Dispatched") {
      res.status(400).json({ error: "Order is already validated. Unlock Amend Mode for manual changes." });
      return;
    }
    const hasPathology = order.tests.some(
      (t) => t.serviceCategory !== "RADIOLOGY" && t.department !== "Radiology"
    );
    if (!hasPathology) {
      res.status(400).json({ error: "This order contains only Imaging/Procedure items without analyzer parameters." });
      return;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const pendingPackets = db.analyzerQueue.filter(
      (q) => (q.status === "PENDING" || q.status === "UNMATCHED") && (q.accessionNumber.toUpperCase() === order.accessionNumber.toUpperCase() || q.matchedOrderId === order.id)
    );
    let appliedCount = 0;
    let updatedTests = [];
    let matchedAnalyzerName = "Connected Hospital Analyzer Bridge";
    let packet = null;
    if (pendingPackets.length > 0) {
      const mergedReadings = pendingPackets.flatMap((p) => p.readings);
      const resApply = applyReadingsToOrder(db, order, mergedReadings);
      appliedCount = resApply.appliedCount;
      updatedTests = resApply.updatedTests;
      for (const q of pendingPackets) {
        q.status = "APPLIED";
        q.matchedOrderId = order.id;
        q.appliedCount = resApply.appliedCount;
        matchedAnalyzerName = q.analyzerName;
      }
      packet = pendingPackets[0];
    } else {
      const generated = buildAnalyzerReadingsForOrder(order, db.services);
      if (generated.readings.length === 0) {
        res.status(400).json({ error: "No mappable quantitative/qualitative analyzer parameters found on this order." });
        return;
      }
      const primaryDept = order.tests.find((t) => t.serviceCategory !== "RADIOLOGY")?.department;
      const machine = db.analyzers.find((a) => a.department === primaryDept && a.status === "Connected") || db.analyzers.find((a) => a.status === "Connected") || db.analyzers[0];
      matchedAnalyzerName = machine ? `${machine.name} (${machine.endpointAddress})` : matchedAnalyzerName;
      const resApply = applyReadingsToOrder(db, order, generated.readings);
      appliedCount = resApply.appliedCount;
      updatedTests = resApply.updatedTests;
      if (machine) {
        machine.packetsProcessedCount = (machine.packetsProcessedCount || 0) + 1;
        machine.lastHeartbeatAt = now;
      }
      packet = {
        id: `anq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receivedAt: now,
        analyzerId: machine?.id || "ana-bridge",
        analyzerName: machine?.name || "Hospital Analyzer Bridge",
        protocol: machine?.protocol || "HL7_V2",
        accessionNumber: order.accessionNumber,
        status: "APPLIED",
        matchedOrderId: order.id,
        appliedCount,
        rawPayload: generated.hl7Frame,
        readings: generated.readings,
        notes: `Bi-directional host query fetched ${appliedCount} analyte(s) (${updatedTests.join(", ")})`
      };
      db.analyzerQueue.unshift(packet);
      if (db.analyzerQueue.length > 120) {
        db.analyzerQueue = db.analyzerQueue.slice(0, 120);
      }
    }
    appendAudit(
      db,
      actor,
      "RESULTS",
      "ANALYZER_AUTO_FETCHED",
      order.accessionNumber,
      `Auto-fetched ${appliedCount} analyte reading(s) from ${matchedAnalyzerName} for ${order.accessionNumber} (${updatedTests.join(", ")}).`
    );
    saveDb(db);
    res.json({
      order,
      matchedAnalyzer: matchedAnalyzerName,
      appliedCount,
      updatedTests,
      packet,
      db: scopeDbForActor(db, actor)
    });
  });
  app.post("/api/lab/analyzers/sync-all", withAuth("results.enter"), (req, res) => {
    const { db, actor } = req;
    if (!Array.isArray(db.analyzers) || db.analyzers.length === 0) {
      db.analyzers = DEFAULT_LAB_ANALYZERS.map((a) => ({ ...a }));
    }
    if (!Array.isArray(db.analyzerQueue)) {
      db.analyzerQueue = [];
    }
    const { queryOpenOrders = true } = req.body || {};
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let syncedOrdersCount = 0;
    let totalAnalytesApplied = 0;
    for (const q of db.analyzerQueue) {
      if (q.status !== "PENDING" && q.status !== "UNMATCHED") continue;
      const ord = db.orders.find(
        (o) => o.accessionNumber.toUpperCase() === q.accessionNumber.toUpperCase() || o.id === q.matchedOrderId
      );
      if (!ord || ord.status === "Validated" || ord.status === "Dispatched") continue;
      const resApply = applyReadingsToOrder(db, ord, q.readings);
      if (resApply.appliedCount > 0) {
        q.status = "APPLIED";
        q.matchedOrderId = ord.id;
        q.appliedCount = resApply.appliedCount;
        syncedOrdersCount += 1;
        totalAnalytesApplied += resApply.appliedCount;
      }
    }
    if (queryOpenOrders) {
      const openOrders = db.orders.filter(
        (o) => (o.status === "Ordered" || o.status === "Collected" || o.status === "In Lab") && o.tests.some(
          (t) => t.serviceCategory !== "RADIOLOGY" && t.department !== "Radiology" && t.parameterResults.some((p) => p.value === null || p.value === "")
        )
      );
      for (const ord of openOrders.slice(0, 20)) {
        const generated = buildAnalyzerReadingsForOrder(ord, db.services);
        if (generated.readings.length === 0) continue;
        const resApply = applyReadingsToOrder(db, ord, generated.readings);
        if (resApply.appliedCount > 0) {
          const primaryDept = ord.tests.find((t) => t.serviceCategory !== "RADIOLOGY")?.department;
          const machine = db.analyzers.find((a) => a.department === primaryDept && a.status === "Connected") || db.analyzers[0];
          if (machine) {
            machine.packetsProcessedCount = (machine.packetsProcessedCount || 0) + 1;
            machine.lastHeartbeatAt = now;
          }
          db.analyzerQueue.unshift({
            id: `anq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            receivedAt: now,
            analyzerId: machine?.id || "ana-bridge",
            analyzerName: machine?.name || "Hospital Analyzer Bridge",
            protocol: machine?.protocol || "HL7_V2",
            accessionNumber: ord.accessionNumber,
            status: "APPLIED",
            matchedOrderId: ord.id,
            appliedCount: resApply.appliedCount,
            rawPayload: generated.hl7Frame,
            readings: generated.readings,
            notes: `Batch sync auto-fetched ${resApply.appliedCount} analyte(s)`
          });
          syncedOrdersCount += 1;
          totalAnalytesApplied += resApply.appliedCount;
        }
      }
      if (db.analyzerQueue.length > 120) {
        db.analyzerQueue = db.analyzerQueue.slice(0, 120);
      }
    }
    appendAudit(
      db,
      actor,
      "RESULTS",
      "ANALYZER_BATCH_SYNCED",
      "ANALYZER-BRIDGE",
      `Batch analyzer sync updated ${syncedOrdersCount} lab order(s) with ${totalAnalytesApplied} analyte reading(s).`
    );
    saveDb(db);
    res.json({
      syncedOrdersCount,
      totalAnalytesApplied,
      db: scopeDbForActor(db, actor)
    });
  });
  app.post("/api/pharmacy/deposits", withAuth("pharmacy.dispense", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const {
      patientId,
      uhid,
      patientName,
      patientPhone,
      encounterType = "WALKING",
      encounterId,
      encounterLabel,
      amountNpr,
      paymentMode = "Cash",
      bankAccountId,
      notes
    } = req.body;
    const amt = Number(Number(amountNpr || 0).toFixed(2));
    if (!patientName?.trim() || amt <= 0) {
      res.status(400).json({ error: "Patient name and positive deposit amount (\u0930\u0942) are required." });
      return;
    }
    const patientRec = upsertPatientMaster(db, {
      patientId,
      uhid,
      fullName: patientName.trim(),
      age: 30,
      ageType: "Years",
      gender: "Other",
      phone: patientPhone,
      actorName: actor.fullName
    });
    if (!Array.isArray(db.pharmacyDeposits)) db.pharmacyDeposits = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const receiptNumber = `PHM-DEP-${bsNow.year}-${101 + db.pharmacyDeposits.length}`;
    const depositRec = {
      id: `pdep-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      receiptNumber,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      patientName: patientRec.fullName,
      patientPhone: patientPhone?.trim() || patientRec.phone || "",
      encounterType,
      encounterId,
      encounterLabel: encounterLabel?.trim() || `${encounterType} \xB7 ${patientRec.uhid}`,
      amountNpr: amt,
      remainingBalanceNpr: amt,
      paymentMode,
      receivedById: actor.id,
      receivedBy: actor.fullName,
      receivedAt: nowIso,
      notes: notes?.trim() || "Pharmacy advance security deposit"
    };
    db.pharmacyDeposits.unshift(depositRec);
    if (encounterType === "EMERGENCY" && encounterId) {
      const erCase = (db.emergencyCases || []).find((e) => e.id === encounterId);
      if (erCase) {
        erCase.depositPaidNpr = Number(((erCase.depositPaidNpr || 0) + amt).toFixed(2));
      }
    }
    if (paymentMode === "Bank / QR") {
      const bankAcc = bankAccountId && db.accounts.find((a) => a.id === bankAccountId) || db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.isDefaultPosBank) || db.accounts.find((a) => a.type === "BANK");
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          "INFLOW",
          amt,
          "PHARMACY_POS",
          receiptNumber,
          `Pharmacy Advance Deposit ${receiptNumber} (${patientRec.fullName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    } else {
      const cashAcc = db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.isDefaultPosCash) || db.accounts.find((a) => a.type === "CASH_COUNTER");
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          "INFLOW",
          amt,
          "PHARMACY_POS",
          receiptNumber,
          `Pharmacy Advance Deposit ${receiptNumber} (${patientRec.fullName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "PHARMACY_DEPOSIT_COLLECTED",
      receiptNumber,
      `Collected \u0930\u0942 ${amt.toLocaleString()} Pharmacy Advance Deposit for ${patientRec.fullName} (${encounterType}).`
    );
    saveDb(db);
    res.status(201).json({ deposit: depositRec, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/invoices/:id/settle-due", withAuth(void 0, "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "pharmacy.dispense") && !hasPermission(db, actor.roleId, "finance.manage")) {
      res.status(403).json({
        error: `Forbidden: Role '${actor.roleId}' lacks permission to settle pharmacy dues.`
      });
      return;
    }
    const inv = (db.pharmacyInvoices || []).find((i) => i.id === req.params.id);
    if (!inv) {
      res.status(404).json({ error: "Pharmacy invoice not found." });
      return;
    }
    const { amountNpr, paymentMode = "Cash", bankAccountId, note } = req.body;
    const currentDue = inv.dueAmountNpr !== void 0 ? inv.dueAmountNpr : Math.max(0, inv.totalNpr - ((inv.cashPaid || 0) + (inv.bankPaid || 0) + (inv.depositAppliedNpr || 0)));
    const payAmt = Number(Math.min(currentDue, Math.max(0, Number(amountNpr) || 0)).toFixed(2));
    if (payAmt <= 0) {
      res.status(400).json({ error: "Due amount is already zero or settlement amount is invalid." });
      return;
    }
    const settlement = {
      id: `pset-${Date.now()}`,
      settledAt: (/* @__PURE__ */ new Date()).toISOString(),
      settledBy: actor.fullName,
      amountNpr: payAmt,
      paymentMode,
      note: note?.trim() || "Pharmacy credit due collection"
    };
    if (!Array.isArray(inv.dueSettlements)) inv.dueSettlements = [];
    inv.dueSettlements.unshift(settlement);
    if (paymentMode === "Bank / QR") {
      inv.bankPaid = Number(((inv.bankPaid || 0) + payAmt).toFixed(2));
      const bankAcc = bankAccountId && db.accounts.find((a) => a.id === bankAccountId) || db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.isDefaultPosBank) || db.accounts.find((a) => a.type === "BANK");
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          "INFLOW",
          payAmt,
          "PHARMACY_POS",
          inv.invoiceNumber,
          `Pharmacy Due Settlement ${inv.invoiceNumber} (${inv.patientName})`,
          inv.fiscalYear,
          actor
        );
      }
    } else {
      inv.cashPaid = Number(((inv.cashPaid || 0) + payAmt).toFixed(2));
      const cashAcc = db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.isDefaultPosCash) || db.accounts.find((a) => a.type === "CASH_COUNTER");
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          "INFLOW",
          payAmt,
          "PHARMACY_POS",
          inv.invoiceNumber,
          `Pharmacy Due Settlement ${inv.invoiceNumber} (${inv.patientName})`,
          inv.fiscalYear,
          actor
        );
      }
    }
    const totalPaidNow = Number(
      ((inv.paidAmountNpr ?? (inv.cashPaid || 0) + (inv.bankPaid || 0) + (inv.depositAppliedNpr || 0) - payAmt) + payAmt).toFixed(2)
    );
    const nextDue = Number(Math.max(0, inv.totalNpr - totalPaidNow).toFixed(2));
    inv.paidAmountNpr = totalPaidNow;
    inv.dueAmountNpr = nextDue;
    inv.paymentStatus = nextDue <= 0 ? "PAID" : "PARTIAL";
    if (inv.encounterType === "EMERGENCY" && inv.encounterId) {
      const erCase = (db.emergencyCases || []).find((e) => e.id === inv.encounterId);
      if (erCase) {
        erCase.pharmacyCreditDueNpr = Number(Math.max(0, (erCase.pharmacyCreditDueNpr || 0) - payAmt).toFixed(2));
      }
    }
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "PHARMACY_DUE_SETTLED",
      inv.invoiceNumber,
      `Settled \u0930\u0942 ${payAmt.toLocaleString()} due on ${inv.invoiceNumber} (${inv.patientName}). Remaining due: \u0930\u0942 ${nextDue.toLocaleString()}.`
    );
    saveDb(db);
    res.json({ invoice: inv, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/dispense", withAuth("pharmacy.dispense", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const {
      patientId,
      uhid,
      encounterType,
      encounterId,
      encounterLabel,
      nonInventoryBillOnly,
      patientName,
      patientPhone,
      patientAge,
      prescribingDoctor,
      linkedOrderAccession,
      items,
      discountNpr = 0,
      paymentMode = "Cash",
      cashPaid,
      bankPaid,
      bankAccountId,
      applyDepositAmountNpr = 0,
      adminCreditOverride = false
    } = req.body;
    if (!patientName?.trim() || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "Patient name and at least one medicine item are required." });
      return;
    }
    const effectiveCenterId = null;
    const todayYmd = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const strictBlockExpired = db.settings?.moduleSettings?.strictFefoBlockExpired !== false;
    const isBillOnly = Boolean(nonInventoryBillOnly);
    const ms = db.settings?.moduleSettings;
    const stagedDeductions = [];
    for (const reqItem of items) {
      const med = db.pharmacyMedicines.find((m) => m.id === reqItem.medicineId);
      const wantQty = Math.floor(Number(reqItem.quantity) || 0);
      if (!med || wantQty <= 0) {
        res.status(400).json({ error: "Invalid medicine or quantity requested." });
        return;
      }
      if (isBillOnly) {
        const unitPrice = reqItem.customUnitPriceNpr !== void 0 && Number(reqItem.customUnitPriceNpr) >= 0 ? Number(Number(reqItem.customUnitPriceNpr).toFixed(2)) : med.defaultMrpNpr;
        const lineTotal = Number((wantQty * unitPrice).toFixed(2));
        stagedDeductions.push({
          batch: null,
          deductQty: 0,
          vatApplicable: med.vatApplicable,
          line: {
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            genericName: med.genericName,
            batchId: "bill-only",
            batchNumber: "BILL-ONLY",
            expiryDate: "N/A",
            quantity: wantQty,
            unitPriceNpr: unitPrice,
            purchaseRateNpr: med.defaultPurchaseRateNpr ?? Number((unitPrice / 1.16).toFixed(2)),
            lineTotalNpr: lineTotal
          }
        });
        continue;
      }
      const candidateBatches = db.pharmacyBatches.filter(
        (b) => b.medicineId === med.id && !b.quarantined && b.quantityOnHand > 0 && (!strictBlockExpired || b.expiryDate >= todayYmd)
      ).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      const totalAvailable = candidateBatches.reduce((s, b) => s + b.quantityOnHand, 0);
      if (totalAvailable < wantQty) {
        res.status(400).json({
          error: `Insufficient non-expired FEFO stock for ${med.brandName}: requested ${wantQty}, available ${totalAvailable} ${med.unitLabel}.`
        });
        return;
      }
      let remaining = wantQty;
      for (const batch of candidateBatches) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, batch.quantityOnHand);
        remaining -= take;
        const lineTotal = Number((take * batch.mrpNpr).toFixed(2));
        stagedDeductions.push({
          batch,
          deductQty: take,
          vatApplicable: med.vatApplicable,
          line: {
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            genericName: med.genericName,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            quantity: take,
            unitPriceNpr: batch.mrpNpr,
            purchaseRateNpr: batch.purchaseRateNpr,
            lineTotalNpr: lineTotal
          }
        });
      }
    }
    const subtotalNpr = Number(
      stagedDeductions.reduce((s, d) => s + d.line.lineTotalNpr, 0).toFixed(2)
    );
    const discount = Math.max(0, Math.min(subtotalNpr, Number(discountNpr) || 0));
    const taxableGross = stagedDeductions.filter((d) => d.vatApplicable).reduce((s, d) => s + d.line.lineTotalNpr, 0);
    const vatNpr = subtotalNpr > 0 ? Number((taxableGross * (subtotalNpr - discount) / subtotalNpr * 0.13).toFixed(2)) : 0;
    const totalNpr = Number((subtotalNpr - discount + vatNpr).toFixed(2));
    const existingPatient = patientId && (db.patients || []).find((p) => p.id === patientId) || uhid && (db.patients || []).find((p) => p.uhid === uhid) || (db.patients || []).find(
      (p) => p.fullName.toLowerCase() === patientName.trim().toLowerCase() && (!patientPhone || !p.phone || p.phone === patientPhone.trim())
    );
    if (!Array.isArray(db.pharmacyDeposits)) db.pharmacyDeposits = [];
    const matchingDeposits = db.pharmacyDeposits.filter(
      (d) => d.remainingBalanceNpr > 0 && (existingPatient?.id && d.patientId === existingPatient.id || uhid && d.uhid === uhid || existingPatient?.uhid && d.uhid === existingPatient.uhid || encounterId && d.encounterId === encounterId)
    );
    const availableDepositPool = Number(
      matchingDeposits.reduce((s, d) => s + d.remainingBalanceNpr, 0).toFixed(2)
    );
    const depositApplied = Number(
      Math.min(totalNpr, availableDepositPool, Math.max(0, Number(applyDepositAmountNpr) || 0)).toFixed(2)
    );
    const balanceAfterDeposit = Number(Math.max(0, totalNpr - depositApplied).toFixed(2));
    const cashAmt = paymentMode === "Cash" ? Number(Math.min(balanceAfterDeposit, Number(cashPaid ?? balanceAfterDeposit)).toFixed(2)) : paymentMode === "Split" || paymentMode === "Credit" ? Number(Math.max(0, Number(cashPaid || 0)).toFixed(2)) : 0;
    const bankAmt = paymentMode === "Bank / QR" ? Number(Math.min(balanceAfterDeposit, Number(bankPaid ?? balanceAfterDeposit)).toFixed(2)) : paymentMode === "Split" || paymentMode === "Credit" ? Number(Math.max(0, Number(bankPaid || 0)).toFixed(2)) : 0;
    const totalPaidNow = Number(Math.min(totalNpr, depositApplied + cashAmt + bankAmt).toFixed(2));
    const dueAmount = Number(Math.max(0, totalNpr - totalPaidNow).toFixed(2));
    const effEncounterType = encounterType || "WALKING";
    const activeIpd = effEncounterType === "IPD" ? (db.ipdAdmissions || []).find(
      (a) => a.disposition === "Admitted" && (encounterId && a.id === encounterId || existingPatient?.id && a.patientId === existingPatient.id || uhid && a.uhid === uhid)
    ) : void 0;
    const activeEr = effEncounterType === "EMERGENCY" ? (db.emergencyCases || []).find(
      (e) => e.disposition === "Under Observation (ER)" && (encounterId && e.id === encounterId || existingPatient?.id && e.patientId === existingPatient.id || uhid && e.uhid === uhid)
    ) : void 0;
    let checkedCreditLimit;
    if (dueAmount > 0 && (effEncounterType === "IPD" || effEncounterType === "EMERGENCY")) {
      const existingPharmacyDue = (db.pharmacyInvoices || []).filter(
        (inv) => (inv.dueAmountNpr || 0) > 0 && (existingPatient?.id && inv.patientId === existingPatient.id || uhid && inv.uhid === uhid || encounterId && inv.encounterId === encounterId)
      ).reduce((s, inv) => s + (inv.dueAmountNpr || 0), 0);
      if (effEncounterType === "IPD") {
        checkedCreditLimit = activeIpd?.creditLimitNpr || ms?.ipdDefaultCreditLimitNpr || 25e3;
        const hospitalDue = activeIpd ? Math.max(0, activeIpd.balanceDueNpr) : 0;
        const projectedExposure = Number((hospitalDue + existingPharmacyDue + dueAmount).toFixed(2));
        if (projectedExposure > checkedCreditLimit && !(adminCreditOverride && (actor.roleId === "SUPER_ADMIN" || actor.roleId === "SAAS_ADMIN"))) {
          res.status(409).json({
            error: `IPD Credit Limit Exceeded: Projected exposure \u0930\u0942 ${projectedExposure.toLocaleString()} exceeds approved IPD credit limit of \u0930\u0942 ${checkedCreditLimit.toLocaleString()}. Collect an advance deposit / partial payment or request Admin override.`,
            code: "CREDIT_LIMIT_EXCEEDED",
            creditLimitNpr: checkedCreditLimit,
            projectedExposureNpr: projectedExposure
          });
          return;
        }
      } else if (effEncounterType === "EMERGENCY") {
        checkedCreditLimit = activeEr?.creditLimitNpr || ms?.emergencyDefaultCreditLimitNpr || 15e3;
        const projectedExposure = Number((existingPharmacyDue + dueAmount).toFixed(2));
        if (projectedExposure > checkedCreditLimit && !(adminCreditOverride && (actor.roleId === "SUPER_ADMIN" || actor.roleId === "SAAS_ADMIN"))) {
          res.status(409).json({
            error: `Emergency Credit Limit Exceeded: Projected ER pharmacy credit \u0930\u0942 ${projectedExposure.toLocaleString()} exceeds ER credit limit of \u0930\u0942 ${checkedCreditLimit.toLocaleString()}. Collect advance deposit or request Admin override.`,
            code: "CREDIT_LIMIT_EXCEEDED",
            creditLimitNpr: checkedCreditLimit,
            projectedExposureNpr: projectedExposure
          });
          return;
        }
      }
    }
    const patientRec = upsertPatientMaster(db, {
      patientId,
      uhid,
      fullName: patientName.trim(),
      age: Number(patientAge) || 30,
      ageType: "Years",
      gender: "Other",
      phone: patientPhone,
      actorName: actor.fullName
    });
    if (depositApplied > 0) {
      let remDep = depositApplied;
      for (const dep of matchingDeposits) {
        if (remDep <= 0) break;
        const take = Math.min(remDep, dep.remainingBalanceNpr);
        dep.remainingBalanceNpr = Number((dep.remainingBalanceNpr - take).toFixed(2));
        remDep = Number((remDep - take).toFixed(2));
      }
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const prefix = ms?.pharmacyInvoicePrefix || "PHM-INV";
    const invNo = `${prefix}-${bsNow.year}-${101 + db.pharmacyInvoices.length}`;
    if (!isBillOnly) {
      for (const d of stagedDeductions) {
        if (!d.batch) continue;
        d.batch.quantityOnHand = Math.max(0, d.batch.quantityOnHand - d.deductQty);
        db.pharmacyMovements.unshift({
          id: `pmov-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          timestamp: nowIso,
          medicineId: d.line.medicineId,
          medicineName: d.line.medicineName,
          batchId: d.batch.id,
          batchNumber: d.batch.batchNumber,
          expiryDate: d.batch.expiryDate,
          centerId: effectiveCenterId,
          type: "FEFO_DISPENSE",
          quantityDelta: -d.deductQty,
          balanceAfter: d.batch.quantityOnHand,
          referenceId: invNo,
          performedBy: actor.fullName,
          notes: `FEFO auto-dispensed to ${patientRec.fullName} (Exp ${d.batch.expiryDate})`
        });
      }
    }
    const paymentStatus = dueAmount <= 0 ? "PAID" : totalPaidNow > 0 ? "PARTIAL" : "CREDIT_DUE";
    const invoice = {
      id: `pinv-${Date.now()}`,
      invoiceNumber: invNo,
      fiscalYear: db.settings.activeFiscalYear,
      dispensedAt: nowIso,
      centerId: null,
      centerName: ms?.pharmacyEntityName || "Pharmacy Store",
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterType: effEncounterType,
      encounterId: encounterId || activeIpd?.id || activeEr?.id,
      encounterLabel: encounterLabel?.trim() || `${effEncounterType}: ${patientRec.uhid}`,
      nonInventoryBillOnly: isBillOnly,
      patientName: patientRec.fullName,
      patientPhone: patientPhone?.trim() || patientRec.phone,
      patientAge: patientAge ? Number(patientAge) : void 0,
      prescribingDoctor: prescribingDoctor?.trim() || "OPD / Self",
      linkedOrderAccession: linkedOrderAccession?.trim() || void 0,
      paymentMode,
      cashPaid: cashAmt,
      bankPaid: bankAmt,
      depositAppliedNpr: depositApplied,
      paidAmountNpr: totalPaidNow,
      dueAmountNpr: dueAmount,
      paymentStatus,
      creditLimitCheckedNpr: checkedCreditLimit,
      dueSettlements: [],
      subtotalNpr,
      discountNpr: discount,
      vatNpr,
      totalNpr,
      dispensedById: actor.id,
      dispensedBy: actor.fullName,
      lines: stagedDeductions.map((d) => d.line)
    };
    db.pharmacyInvoices.unshift(invoice);
    if (activeEr && dueAmount > 0) {
      activeEr.pharmacyCreditDueNpr = Number(((activeEr.pharmacyCreditDueNpr || 0) + dueAmount).toFixed(2));
    }
    if (cashAmt > 0) {
      const cashAcc = db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "CASH_COUNTER") || db.accounts.find((a) => a.isDefaultPosCash) || db.accounts.find((a) => a.type === "CASH_COUNTER");
      if (cashAcc) {
        postLedgerMovement(
          db,
          cashAcc,
          "INFLOW",
          cashAmt,
          "PHARMACY_POS",
          invNo,
          `Pharmacy ${isBillOnly ? "Bill-Only " : "FEFO "}Cash Sale ${invNo} (${invoice.patientName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }
    if (bankAmt > 0) {
      const bankAcc = bankAccountId && db.accounts.find((a) => a.id === bankAccountId) || db.accounts.find((a) => a.departmentScope === "PHARMACY" && a.type === "BANK") || db.accounts.find((a) => a.isDefaultPosBank) || db.accounts.find((a) => a.type === "BANK");
      if (bankAcc) {
        postLedgerMovement(
          db,
          bankAcc,
          "INFLOW",
          bankAmt,
          "PHARMACY_POS",
          invNo,
          `Pharmacy ${isBillOnly ? "Bill-Only " : "FEFO "}Bank/QR Sale ${invNo} (${invoice.patientName})`,
          db.settings.activeFiscalYear,
          actor
        );
      }
    }
    appendAudit(
      db,
      actor,
      "PHARMACY",
      isBillOnly ? "PHARMACY_BILL_ONLY_ISSUED" : "PHARMACY_FEFO_DISPENSED",
      invNo,
      `${isBillOnly ? "Non-inventory bill-only invoice" : `Dispensed ${invoice.lines.length} FEFO batch lines`} for ${invoice.patientName} \u2014 Total \u0930\u0942 ${totalNpr.toLocaleString()} (${paymentMode}, Paid \u0930\u0942 ${totalPaidNow.toLocaleString()}, Due \u0930\u0942 ${dueAmount.toLocaleString()}).`
    );
    saveDb(db);
    res.status(201).json({ invoice, db: scopeDbForActor(db, actor) });
  });
  const recalcIpdFinancials = (adm, ms, manualOverride) => {
    const normalizedOverride = typeof manualOverride === "number" ? { bedDaysBilled: manualOverride } : manualOverride;
    const autoSummary = computeIpdDailyAutoCharges(
      adm,
      ms,
      adm.disposition === "Admitted" ? void 0 : adm.dischargedAt,
      normalizedOverride
    );
    if (normalizedOverride || adm.disposition === "Admitted") {
      adm.bedDaysBilled = autoSummary.bedDaysBilled;
      adm.bedChargesNpr = autoSummary.bedChargesNpr;
      adm.doctorRoundsCount = autoSummary.doctorRoundsCount;
      adm.doctorRoundFeeNpr = autoSummary.doctorRoundFeeNpr;
      adm.doctorRoundChargesNpr = autoSummary.doctorRoundChargesNpr;
      adm.nursingDaysBilled = autoSummary.nursingDaysBilled;
      adm.nursingChargePerDayNpr = autoSummary.nursingChargePerDayNpr;
      adm.nursingChargesNpr = autoSummary.nursingChargesNpr;
      adm.autoObservationDaysBilled = autoSummary.observationDaysBilled;
      adm.autoObservationFeePerDayNpr = autoSummary.observationFeePerDayNpr;
      adm.autoObservationChargesNpr = autoSummary.autoObservationChargesNpr;
      adm.bedCycleWindowLabel = autoSummary.cycleWindowLabel;
    }
    const medsTotal = Number(
      adm.usedMedicines.reduce((sum, m) => sum + (Number(m.totalPriceNpr) || 0), 0).toFixed(2)
    );
    const invTotal = Number(
      adm.investigationsDone.reduce((sum, i) => sum + (Number(i.priceNpr) || 0), 0).toFixed(2)
    );
    const depositsPaid = Number(
      adm.deposits.reduce((sum, d) => sum + (Number(d.amountNpr) || 0), 0).toFixed(2)
    );
    const shiftObsTotal = Number(
      (adm.nursingObservationFees || []).reduce((sum, item) => sum + (Number(item.feeNpr) || 0), 0).toFixed(2)
    );
    adm.nursingObservationChargesNpr = shiftObsTotal;
    const directProceduresTotal = Number(
      (adm.directServiceCharges || []).reduce((sum, item) => sum + (Number(item.amountNpr) || 0), 0).toFixed(2)
    );
    const individualBillsTotal = Number(
      (adm.ipdIndividualBills || []).reduce((sum, b) => sum + (Number(b.amountNpr) || 0), 0).toFixed(2)
    );
    const admFee = Number(adm.admissionFeeNpr) || 0;
    const bedChg = Number(adm.bedChargesNpr) || 0;
    const roundChg = Number(adm.doctorRoundChargesNpr) || 0;
    const nursingChg = Number(adm.nursingChargesNpr) || 0;
    const autoObsChg = Number(adm.autoObservationChargesNpr) || 0;
    const otherChg = Number(adm.otherProcedureChargesNpr) || 0;
    const totalBill = Number(
      (admFee + bedChg + roundChg + nursingChg + autoObsChg + shiftObsTotal + medsTotal + invTotal + directProceduresTotal + otherChg).toFixed(2)
    );
    adm.medicinesTotalNpr = medsTotal;
    adm.investigationsTotalNpr = invTotal;
    adm.totalBillNpr = totalBill;
    adm.totalDepositPaidNpr = depositsPaid;
    adm.individualCashPaidTotalNpr = individualBillsTotal;
    adm.balanceDueNpr = Number((totalBill - depositsPaid - individualBillsTotal).toFixed(2));
    if (adm.creditLimitNpr !== void 0 && adm.creditLimitNpr > 0) {
      if (adm.creditApprovalStatus !== "APPROVED") {
        adm.creditApprovalStatus = adm.balanceDueNpr > adm.creditLimitNpr ? "PENDING_ADMIN_CREDIT" : "WITHIN_LIMIT";
      }
    }
  };
  const createLinkedOrderFromClinical = (db, actor, opts) => {
    const services = opts.serviceIds.map((id) => db.services.find((s) => s.id === id)).filter((s) => Boolean(s));
    if (services.length === 0) return null;
    const now = /* @__PURE__ */ new Date();
    const bsNow = adToBs(now);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const seq = 1045 + db.orders.length + 1;
    const ms = db.settings.moduleSettings;
    const accessionNumber = `${ms?.labOrderPrefix || "SAP"}-${bsNow.year}-${seq}`;
    const invoiceNumber = `${ms?.billPrefix || "BILL"}-${bsNow.year}-${seq}`;
    const factor = opts.priority === "STAT" ? 0.5 : 1;
    const testItems = services.map((srv) => {
      const effectiveTat = Math.max(30, Math.round(srv.tatMinutes * factor));
      return {
        serviceId: srv.id,
        serviceCode: srv.code,
        serviceName: srv.name,
        serviceCategory: srv.serviceCategory || (srv.department === "Radiology" ? "RADIOLOGY" : "PATHOLOGY"),
        modality: srv.modality,
        department: srv.department,
        methodology: srv.methodology,
        tatMinutes: effectiveTat,
        dueAt: new Date(now.getTime() + effectiveTat * 6e4).toISOString(),
        price: srv.price,
        referralCommissionNpr: 0,
        reagentsDeducted: false,
        status: "Pending",
        interpretation: "",
        parameterResults: srv.parameters.map((p) => {
          const ref = getRefRange(p, opts.patientGender || "Male");
          return {
            parameterId: p.id,
            parameterName: p.name,
            resultType: p.resultType || "NUMERIC",
            unit: p.unit,
            value: null,
            refRangeDisplay: ref.display,
            flag: "NORMAL"
          };
        })
      };
    });
    const total = Number(testItems.reduce((s, t) => s + t.price, 0).toFixed(2));
    const maxDueAt = testItems.reduce(
      (latest, t) => new Date(t.dueAt).getTime() > new Date(latest).getTime() ? t.dueAt : latest,
      testItems[0].dueAt
    );
    const newOrder = {
      id: `ord-clin-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      accessionNumber,
      invoiceNumber,
      fiscalYear: activeFy,
      patientId: opts.patientId,
      uhid: opts.uhid,
      encounterType: opts.encounterType || "OPD",
      encounterId: opts.encounterId,
      encounterLabel: opts.encounterLabel,
      patientName: opts.patientName,
      patientAge: opts.patientAge,
      patientAgeType: opts.patientAgeType,
      patientGender: opts.patientGender,
      patientAddress: opts.patientAddress,
      patientPhone: opts.patientPhone,
      patientEmail: "",
      referringDoctor: opts.referringDoctor,
      referralPartnerId: null,
      referralPartnerName: null,
      referralCommissionTotal: 0,
      collectionCenterId: opts.centerId,
      collectionCenterName: opts.centerName,
      priority: opts.priority || "Routine",
      status: "Ordered",
      orderedAt: now.toISOString(),
      collectedAt: null,
      receivedInLabAt: null,
      resultedAt: null,
      validatedAt: null,
      validatedById: null,
      validatedByName: null,
      validatedByDesignation: null,
      validatedByRegNo: null,
      dueAt: maxDueAt,
      subtotalAmount: total,
      discountAmount: 0,
      totalAmount: total,
      paidAmount: 0,
      dueAmount: total,
      paymentMode: "Cash",
      cashPaid: 0,
      bankPaid: 0,
      creditOverrideApplied: false,
      emailSent: false,
      apiSent: false,
      tests: testItems
    };
    db.orders.unshift(newOrder);
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "CLINICAL_INVESTIGATION_ORDER_CREATED",
      accessionNumber,
      `Auto-created diagnostic order ${accessionNumber} (${services.map((s) => s.code).join(", ")}) for ${opts.patientName}.`
    );
    return newOrder;
  };
  app.post("/api/opd/visits", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.patientName?.trim()) {
      res.status(400).json({ error: "Patient name is required for OPD registration." });
      return;
    }
    const ms = db.settings.moduleSettings;
    const freeDays = Math.max(0, ms?.opdFreeFollowUpDays ?? 5);
    const sameDoctorOnly = ms?.opdFollowUpSameDoctorOnly !== false;
    const withinWindowFee = Math.max(0, ms?.opdFollowUpWithinWindowFeeNpr ?? 0);
    const expiredFollowUpFee = Math.max(0, ms?.opdFollowUpFeeAfterExpiryNpr ?? 300);
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 30,
      ageType: body.patientAgeType || "Years",
      gender: body.patientGender || "Male",
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName
    });
    const requestedDocNorm = (body.consultingDoctor?.trim() || actor.fullName).toLowerCase();
    const cleanPhoneReq = normalizeNepalPhone(body.patientPhone || patientRec.phone || "").replace(/\D/g, "");
    const patientPriorVisits = (db.opdVisits || []).filter((v) => {
      if (patientRec.id && v.patientId === patientRec.id) return true;
      if (patientRec.uhid && v.uhid && v.uhid.toUpperCase() === patientRec.uhid.toUpperCase()) return true;
      const vPhone = (v.patientPhone || "").replace(/\D/g, "");
      return v.patientName.trim().toLowerCase() === patientRec.fullName.toLowerCase() && cleanPhoneReq && vPhone.endsWith(cleanPhoneReq.slice(-10));
    }).sort((a, b) => new Date(b.visitDate).getTime() - new Date(a.visitDate).getTime());
    const sameDoctorVisit = patientPriorVisits.find(
      (v) => (v.consultingDoctor || "").trim().toLowerCase() === requestedDocNorm
    );
    const matchedReferenceVisit = sameDoctorOnly ? sameDoctorVisit : sameDoctorVisit || patientPriorVisits[0];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const prevVisitMs = matchedReferenceVisit ? new Date(matchedReferenceVisit.visitDate).getTime() : !sameDoctorOnly && patientRec.lastOpdVisitAt ? new Date(patientRec.lastOpdVisitAt).getTime() : 0;
    const daysSinceLast = prevVisitMs > 0 ? Math.floor((Date.now() - prevVisitMs) / 864e5) : 9999;
    const isReturningFollowUp = prevVisitMs > 0;
    const isWithinFollowUpRule = isReturningFollowUp && daysSinceLast <= freeDays;
    const isFreeFollowUp = typeof body.isFreeFollowUp === "boolean" ? body.isFreeFollowUp : !body.forcePaid && isWithinFollowUpRule && withinWindowFee === 0;
    const rawFee = body.consultationFeeNpr !== void 0 ? Number(body.consultationFeeNpr) : !body.forcePaid && isWithinFollowUpRule ? withinWindowFee : patientPriorVisits.length > 0 && daysSinceLast > freeDays ? expiredFollowUpFee : ms?.defaultOpdConsultationFeeNpr ?? 500;
    const fee = isFreeFollowUp ? 0 : Math.max(0, rawFee);
    const bsNow = adToBs(nowIso);
    const payMode = body.paymentMode || "Cash";
    const opdPfx = ms?.opdPrefix || "OPD";
    const tokenNumber = `${opdPfx}-${bsNow.year}-${10 + (db.opdVisits || []).length + 1}`;
    const cTypeName = body.consultationTypeName?.trim() || (isFreeFollowUp ? `Free Follow-Up (${sameDoctorOnly ? "Same Dr \xB7 " : ""}\u2264${freeDays}d)` : isWithinFollowUpRule ? `Rule Follow-Up (${sameDoctorOnly ? "Same Dr \xB7 " : ""}\u2264${freeDays}d)` : patientPriorVisits.length > 0 ? `Paid Consultation (Different Dr / >${freeDays}d)` : "New OPD Consultation");
    const encLabel = body.encounterLabel?.trim() || `${tokenNumber} \xB7 ${cTypeName}`;
    const visit = {
      id: `opd-${Date.now()}`,
      tokenNumber,
      visitDate: nowIso,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      centerId: null,
      centerName: "Saptari Hospital Pvt Ltd (Bode Barsain)",
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterLabel: encLabel,
      isFreeFollowUp,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: body.patientPhone?.trim() || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      department: body.department?.trim() || "General Medicine OPD",
      consultingDoctor: body.consultingDoctor?.trim() || actor.fullName,
      chiefComplaint: body.chiefComplaint?.trim() || (isFreeFollowUp ? "Scheduled follow-up review" : "General medical evaluation"),
      vitals: body.vitals || {},
      provisionalDiagnosis: body.provisionalDiagnosis?.trim() || "",
      clinicalNotes: body.clinicalNotes?.trim() || "",
      consultationTypeName: cTypeName,
      consultationFeeNpr: fee,
      paymentMode: payMode,
      prescribedMedicines: [],
      investigations: [],
      disposition: "Waiting",
      followUpAdvice: body.followUpAdvice?.trim() || "",
      recordedBy: actor.fullName
    };
    patientRec.lastOpdVisitAt = nowIso;
    if (!Array.isArray(db.opdVisits)) db.opdVisits = [];
    db.opdVisits.unshift(visit);
    if (fee > 0 && (payMode === "Cash" || payMode === "Bank / QR")) {
      const targetAcc = payMode === "Cash" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK");
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          fee,
          "POS_COLLECTION",
          tokenNumber,
          `OPD Consultation Fee ${tokenNumber} \u2014 ${visit.patientName}`,
          visit.fiscalYear,
          actor
        );
      }
    }
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "OPD_VISIT_REGISTERED",
      tokenNumber,
      `Registered OPD ${tokenNumber} for ${visit.patientName} (${patientRec.uhid})${isFreeFollowUp ? " [FREE FOLLOW-UP]" : ` [\u0930\u0942 ${fee}]`}.`
    );
    saveDb(db);
    res.status(201).json({ visit, patient: patientRec, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/opd/visits/:id", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const visit = (db.opdVisits || []).find((v) => v.id === req.params.id);
    if (!visit) {
      res.status(404).json({ error: "OPD visit not found." });
      return;
    }
    if (actor.assignedCenterId && actor.roleId !== "SUPER_ADMIN" && visit.centerId !== actor.assignedCenterId) {
      res.status(403).json({ error: "Center Isolation: Cannot edit OPD visit outside your hub." });
      return;
    }
    const body = req.body;
    if (body.disposition === "Referred to External Hospital") {
      if (!body.externalReferral?.referredToHospital?.trim() || !body.externalReferral?.referredToPlace?.trim()) {
        res.status(400).json({
          error: "Referred Hospital Name and Place / City are required for External Referral."
        });
        return;
      }
    }
    if (body.vitals) visit.vitals = body.vitals;
    if (body.chiefComplaint !== void 0) visit.chiefComplaint = body.chiefComplaint;
    if (body.provisionalDiagnosis !== void 0) visit.provisionalDiagnosis = body.provisionalDiagnosis;
    if (body.clinicalNotes !== void 0) visit.clinicalNotes = body.clinicalNotes;
    if (body.followUpAdvice !== void 0) visit.followUpAdvice = body.followUpAdvice;
    if (body.consultingDoctor !== void 0) visit.consultingDoctor = body.consultingDoctor;
    if (body.department !== void 0) visit.department = body.department;
    if (Array.isArray(body.prescribedMedicines)) visit.prescribedMedicines = body.prescribedMedicines;
    if (Array.isArray(body.investigations)) visit.investigations = body.investigations;
    if (body.disposition) visit.disposition = body.disposition;
    if (body.externalReferral) {
      const baseExt = {
        ...body.externalReferral,
        referredAt: body.externalReferral.referredAt || (/* @__PURE__ */ new Date()).toISOString(),
        referredBy: body.externalReferral.referredBy || actor.fullName
      };
      visit.externalReferral = attachEncounterBillingAndClinicalHistory(db, {
        baseReferral: baseExt,
        patientId: visit.patientId,
        uhid: visit.uhid,
        patientName: visit.patientName,
        patientPhone: visit.patientPhone,
        encounterType: "OPD",
        encounterId: visit.id,
        opdVisit: visit
      });
    }
    let createdOrder = null;
    if (body.createDiagnosticOrder && Array.isArray(body.orderServiceIds) && body.orderServiceIds.length > 0) {
      createdOrder = createLinkedOrderFromClinical(db, actor, {
        centerId: visit.centerId,
        centerName: visit.centerName,
        patientName: visit.patientName,
        patientAge: visit.patientAge,
        patientAgeType: visit.patientAgeType,
        patientGender: visit.patientGender,
        patientPhone: visit.patientPhone,
        patientAddress: visit.patientAddress,
        referringDoctor: visit.consultingDoctor,
        serviceIds: body.orderServiceIds,
        priority: "Routine"
      });
      if (createdOrder) {
        visit.investigations.forEach((inv) => {
          if (body.orderServiceIds.includes(inv.serviceId || "") && !inv.linkedOrderId) {
            inv.linkedOrderId = createdOrder.id;
            inv.linkedAccessionNumber = createdOrder.accessionNumber;
          }
        });
      }
    }
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "OPD_CONSULTATION_UPDATED",
      visit.tokenNumber,
      `Updated OPD ${visit.tokenNumber} (${visit.patientName}) \u2014 Disposition: ${visit.disposition}${visit.externalReferral ? ` -> Referred to ${visit.externalReferral.referredToHospital}, ${visit.externalReferral.referredToPlace}` : ""}.`
    );
    saveDb(db);
    res.json({ visit, createdOrder, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/beds", withAuth("hospital.manage", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    const resolvedBedCode = (body.bedCode || body.bedNumber || "").trim().toUpperCase();
    if (!resolvedBedCode || !body.wardName?.trim()) {
      res.status(400).json({ error: "Ward name and bed code are required." });
      return;
    }
    const effectiveCenterId = null;
    if ((db.hospitalBeds || []).some(
      (b) => b.bedCode.toLowerCase() === resolvedBedCode.toLowerCase()
    )) {
      res.status(409).json({ error: `Bed ${resolvedBedCode} already exists in hospital.` });
      return;
    }
    const bed = {
      id: `bed-${Date.now()}`,
      centerId: effectiveCenterId,
      centerName: "Saptari Hospital Pvt Ltd (Bode Barsain)",
      wardName: body.wardName.trim(),
      wardType: body.wardType || "General Ward",
      bedCode: resolvedBedCode,
      floorLabel: (body.floorLabel || body.floor || "1st Floor").trim(),
      dailyRateNpr: Math.max(0, Number(body.dailyRateNpr) || 1500),
      hasOxygen: body.hasOxygen !== false,
      hasMonitor: Boolean(body.hasMonitor),
      status: "Available",
      currentAdmissionId: null,
      currentPatientName: null
    };
    if (!Array.isArray(db.hospitalBeds)) db.hospitalBeds = [];
    db.hospitalBeds.push(bed);
    appendAudit(
      db,
      actor,
      "BED_MANAGEMENT",
      "HOSPITAL_BED_CREATED",
      bed.bedCode,
      `Added ${bed.wardType} bed ${bed.bedCode} in ${bed.wardName} (\u0930\u0942 ${bed.dailyRateNpr}/day) @ ${bed.centerName}.`
    );
    saveDb(db);
    res.status(201).json({ bed, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/ipd/beds/:id", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const bed = (db.hospitalBeds || []).find((b) => b.id === req.params.id);
    if (!bed) {
      res.status(404).json({ error: "Hospital bed not found." });
      return;
    }
    if (actor.assignedCenterId && actor.roleId !== "SUPER_ADMIN" && bed.centerId !== actor.assignedCenterId) {
      res.status(403).json({ error: "Center Isolation: Cannot modify bed outside your hub." });
      return;
    }
    const { status, dailyRateNpr, hasOxygen, hasMonitor } = req.body;
    if (bed.status === "Occupied" && status && status !== "Occupied") {
      res.status(409).json({
        error: `Bed ${bed.bedCode} is currently Occupied by ${bed.currentPatientName}. Discharge or transfer patient first.`
      });
      return;
    }
    if (status) bed.status = status;
    if (dailyRateNpr !== void 0 && hasPermission(db, actor.roleId, "hospital.manage")) {
      bed.dailyRateNpr = Math.max(0, Number(dailyRateNpr));
    }
    if (hasOxygen !== void 0) bed.hasOxygen = Boolean(hasOxygen);
    if (hasMonitor !== void 0) bed.hasMonitor = Boolean(hasMonitor);
    appendAudit(
      db,
      actor,
      "BED_MANAGEMENT",
      "HOSPITAL_BED_UPDATED",
      bed.bedCode,
      `Bed ${bed.bedCode} status set to ${bed.status} (Rate: \u0930\u0942 ${bed.dailyRateNpr}/day).`
    );
    saveDb(db);
    res.json({ bed, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.bedId || !body.patientName?.trim() || !body.admittingDiagnosis?.trim()) {
      res.status(400).json({ error: "Available Bed, Patient Name, and Admitting Diagnosis are required." });
      return;
    }
    const bed = (db.hospitalBeds || []).find((b) => b.id === body.bedId);
    if (!bed) {
      res.status(404).json({ error: "Selected hospital bed not found." });
      return;
    }
    if (bed.status !== "Available") {
      res.status(409).json({ error: `Bed ${bed.bedCode} is ${bed.status}. Select an Available bed.` });
      return;
    }
    const ms = db.settings.moduleSettings;
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 35,
      ageType: body.patientAgeType || "Years",
      gender: body.patientGender || "Male",
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName
    });
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const admNo = `${ms?.ipdPrefix || "IPD"}-${bsNow.year}-${101 + (db.ipdAdmissions || []).length}`;
    const admReceiptNo = `IPD-ADM-${bsNow.year}-${101 + (db.ipdAdmissions || []).length}`;
    const admFee = body.admissionFeeNpr !== void 0 ? Math.max(0, Number(body.admissionFeeNpr)) : ms?.ipdAdmissionFeeNpr ?? 1500;
    const admPayMode = body.admissionPaymentMode || body.depositPaymentMode || "Cash";
    const creditLimit = body.creditLimitNpr !== void 0 ? Math.max(0, Number(body.creditLimitNpr)) : ms?.ipdDefaultCreditLimitNpr ?? 5e4;
    const depositAmt = Math.max(0, Number(body.initialDepositNpr) || 0);
    const payMode = body.depositPaymentMode || "Cash";
    const deposits = [];
    if (depositAmt > 0) {
      const rcpNo = `IPD-RCP-${bsNow.year}-${201 + (db.ipdAdmissions || []).length}`;
      deposits.push({
        id: `dep-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: depositAmt,
        paymentMode: payMode,
        receiptNumber: rcpNo,
        notes: `Admission advance deposit for Bed ${bed.bedCode}`,
        receivedBy: actor.fullName
      });
      const targetAcc = payMode === "Bank / QR" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER");
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          depositAmt,
          "POS_COLLECTION",
          rcpNo,
          `IPD Admission Deposit ${admNo} (${patientRec.fullName})`,
          activeFy,
          actor
        );
      }
    }
    let carriedInvestigations = [];
    if (body.linkedOpdVisitId) {
      const opd = (db.opdVisits || []).find((v) => v.id === body.linkedOpdVisitId);
      if (opd) {
        carriedInvestigations = JSON.parse(JSON.stringify(opd.investigations || []));
      }
    }
    const resolvedCategory = body.caseCategory || (bed.wardType === "ICU / HDU" ? "ICU / Critical" : bed.wardType === "Maternity" ? "Maternity / OBG" : bed.wardType === "NICU / Pediatric" ? "Pediatric / NICU" : "General Medical");
    const autoConsents = autoAssignConsents({
      context: "IPD",
      caseCategory: resolvedCategory,
      wardName: bed.wardName,
      patientName: patientRec.fullName,
      guardianName: body.emergencyContact?.trim(),
      createdAt: nowIso
    });
    const ipdIndividualBills = [];
    const admissionFeePaidAtAdmit = admFee > 0 && admPayMode !== "Credit";
    if (admissionFeePaidAtAdmit) {
      ipdIndividualBills.push({
        id: `ipdbill-adm-${Date.now()}`,
        billNumber: admReceiptNo,
        billedAt: nowIso,
        billedById: actor.id,
        billedBy: actor.fullName,
        category: "ADMISSION",
        itemLabel: `IPD Admission Charge (${bed.wardName} - ${bed.bedCode})`,
        amountNpr: admFee,
        paymentMode: admPayMode,
        notes: "Instant admission bill paid at ward admission"
      });
      const admAcc = admPayMode === "Bank / QR" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER");
      if (admAcc) {
        postLedgerMovement(
          db,
          admAcc,
          "INFLOW",
          admFee,
          "POS_COLLECTION",
          admReceiptNo,
          `IPD Admission Charge ${admNo} (${patientRec.fullName})`,
          activeFy,
          actor
        );
      }
    }
    const admission = {
      id: `ipd-${Date.now()}`,
      admissionNumber: admNo,
      admissionReceiptNumber: admReceiptNo,
      admissionPaymentMode: admPayMode,
      admissionFeePaidAtAdmit,
      fiscalYear: activeFy,
      admittedAt: nowIso,
      centerId: bed.centerId,
      centerName: bed.centerName,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterLabel: `${admNo} \xB7 ${bed.bedCode} (${bed.wardName})`,
      admissionFeeNpr: admFee,
      creditLimitNpr: creditLimit,
      creditApprovalStatus: "WITHIN_LIMIT",
      linkedOpdVisitId: body.linkedOpdVisitId,
      caseCategory: resolvedCategory,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: body.patientPhone?.trim() || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      emergencyContact: body.emergencyContact?.trim() || "",
      admittingDoctor: body.admittingDoctor?.trim() || actor.fullName,
      department: body.department?.trim() || bed.wardName,
      currentBedId: bed.id,
      currentBedLabel: bed.bedCode,
      currentWardName: bed.wardName,
      bedDailyRateNpr: bed.dailyRateNpr,
      admittingDiagnosis: body.admittingDiagnosis.trim(),
      finalDiagnosis: "",
      hospitalCourseSummary: `Admitted to ${bed.wardName} Bed ${bed.bedCode}.`,
      vitalsOnAdmission: body.vitalsOnAdmission || {},
      progressNotes: [
        {
          id: `pn-${Date.now()}`,
          timestamp: nowIso,
          note: `Admitted to ${bed.wardName} (${bed.bedCode}) under ${body.admittingDoctor?.trim() || actor.fullName}. Admission Fee \u0930\u0942 ${admFee.toLocaleString()} (${admPayMode}).`,
          recordedBy: actor.fullName
        }
      ],
      nursingCharts: [],
      nursingObservationFees: [],
      marRecords: [],
      consents: autoConsents,
      bedTransfers: [],
      usedMedicines: [],
      investigationsDone: carriedInvestigations,
      directServiceCharges: [],
      ipdIndividualBills,
      deposits,
      disposition: "Admitted",
      bedChargesNpr: bed.dailyRateNpr,
      bedDaysBilled: 1,
      doctorRoundsCount: ms?.ipdDoctorRoundBasis === "PER_ROUND" ? ms?.ipdDoctorRoundsPerDay || 1 : 1,
      doctorRoundFeeNpr: ms?.ipdDoctorRoundFeeNpr ?? 500,
      doctorRoundChargesNpr: (ms?.ipdDoctorRoundFeeNpr ?? 500) * (ms?.ipdDoctorRoundBasis === "PER_ROUND" ? ms?.ipdDoctorRoundsPerDay || 1 : 1),
      nursingDaysBilled: ms?.ipdNursingChargeBasis === "PER_ROUND" ? ms?.ipdNursingRoundsPerDay || 1 : 1,
      nursingChargePerDayNpr: ms?.ipdNursingChargePerDayNpr ?? 400,
      nursingChargesNpr: (ms?.ipdNursingChargePerDayNpr ?? 400) * (ms?.ipdNursingChargeBasis === "PER_ROUND" ? ms?.ipdNursingRoundsPerDay || 1 : 1),
      autoObservationDaysBilled: ms?.ipdObservationChargeBasis === "PER_ROUND" ? ms?.ipdObservationRoundsPerDay || 1 : 1,
      autoObservationFeePerDayNpr: ms?.ipdDailyObservationFeeNpr ?? 300,
      autoObservationChargesNpr: (ms?.ipdDailyObservationFeeNpr ?? 300) * (ms?.ipdObservationChargeBasis === "PER_ROUND" ? ms?.ipdObservationRoundsPerDay || 1 : 1),
      bedCycleWindowLabel: `${ms?.ipdBedCycleStartTime || "07:00"} - ${ms?.ipdBedCycleEndTime || "19:00"}`,
      nursingObservationChargesNpr: 0,
      medicinesTotalNpr: 0,
      investigationsTotalNpr: 0,
      otherProcedureChargesNpr: 0,
      totalBillNpr: 0,
      totalDepositPaidNpr: depositAmt,
      individualCashPaidTotalNpr: admissionFeePaidAtAdmit ? admFee : 0,
      balanceDueNpr: 0
    };
    recalcIpdFinancials(admission, ms);
    bed.status = "Occupied";
    bed.currentAdmissionId = admission.id;
    bed.currentPatientName = admission.patientName;
    if (body.linkedOpdVisitId) {
      const opd = (db.opdVisits || []).find((v) => v.id === body.linkedOpdVisitId);
      if (opd) {
        opd.disposition = "Admitted to IPD";
        opd.linkedIpdAdmissionId = admission.id;
      }
    }
    if (!Array.isArray(db.ipdAdmissions)) db.ipdAdmissions = [];
    db.ipdAdmissions.unshift(admission);
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "IPD_PATIENT_ADMITTED",
      admNo,
      `Admitted ${admission.patientName} (${patientRec.uhid}) to ${bed.wardName} (${bed.bedCode}). Adm Fee \u0930\u0942 ${admFee}, Credit Limit \u0930\u0942 ${creditLimit}, Deposit \u0930\u0942 ${depositAmt}.`
    );
    saveDb(db);
    res.status(201).json({ admission, patient: patientRec, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/approve-credit", withAuth("finance.approve_admin"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const { newCreditLimitNpr, note } = req.body || {};
    if (newCreditLimitNpr !== void 0 && Number(newCreditLimitNpr) > 0) {
      adm.creditLimitNpr = Number(newCreditLimitNpr);
    }
    adm.creditApprovalStatus = "APPROVED";
    adm.creditApprovedBy = actor.fullName;
    adm.creditApprovedAt = (/* @__PURE__ */ new Date()).toISOString();
    adm.creditApprovalNote = note?.trim() || "Admin extended IPD credit ceiling";
    appendAudit(db, actor, "OPD_IPD", "IPD_CREDIT_APPROVED", adm.admissionNumber, `Approved IPD credit extension for ${adm.patientName} (Limit \u0930\u0942 ${(adm.creditLimitNpr || 0).toLocaleString()}).`, "WARNING");
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/mar", withAuth("hospital.clinical"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const { medicineName, doseRoute, status, note } = req.body;
    if (!medicineName?.trim()) {
      res.status(400).json({ error: "Medication name is required for MAR entry." });
      return;
    }
    if (!Array.isArray(adm.marRecords)) adm.marRecords = [];
    const entry = {
      id: `mar-${Date.now()}`,
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      medicineName: medicineName.trim(),
      doseRoute: doseRoute?.trim() || "IV / Oral as ordered",
      givenBy: actor.fullName,
      status: status || "Given",
      note: note?.trim() || ""
    };
    adm.marRecords.unshift(entry);
    appendAudit(db, actor, "NURSING_CHART", "MAR_RECORDED", adm.admissionNumber, `MAR ${entry.status}: ${entry.medicineName} (${entry.doseRoute}) for ${adm.patientName}.`);
    saveDb(db);
    res.status(201).json({ entry, admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/transfer-bed", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission record not found." });
      return;
    }
    if (adm.disposition !== "Admitted") {
      res.status(409).json({ error: "Cannot transfer bed for a finalized/discharged admission." });
      return;
    }
    const { targetBedId, reason } = req.body;
    const newBed = (db.hospitalBeds || []).find((b) => b.id === targetBedId);
    if (!newBed) {
      res.status(404).json({ error: "Target bed not found." });
      return;
    }
    if (newBed.centerId !== adm.centerId) {
      res.status(403).json({ error: "Internal bed transfer must be within the same hospital hub." });
      return;
    }
    if (newBed.status !== "Available") {
      res.status(409).json({ error: `Target bed ${newBed.bedCode} is ${newBed.status}.` });
      return;
    }
    const oldBed = (db.hospitalBeds || []).find((b) => b.id === adm.currentBedId);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const transferRecord = {
      id: `btr-${Date.now()}`,
      transferredAt: nowIso,
      fromBedId: adm.currentBedId,
      fromBedLabel: `${adm.currentBedLabel} (${adm.currentWardName})`,
      toBedId: newBed.id,
      toBedLabel: `${newBed.bedCode} (${newBed.wardName})`,
      reason: reason?.trim() || "Clinical escalation / ward transfer",
      authorizedBy: actor.fullName
    };
    if (oldBed) {
      oldBed.status = db.settings.moduleSettings?.markBedCleaningOnDischarge !== false ? "Cleaning" : "Available";
      oldBed.currentAdmissionId = null;
      oldBed.currentPatientName = null;
    }
    newBed.status = "Occupied";
    newBed.currentAdmissionId = adm.id;
    newBed.currentPatientName = adm.patientName;
    adm.bedTransfers.push(transferRecord);
    adm.currentBedId = newBed.id;
    adm.currentBedLabel = newBed.bedCode;
    adm.currentWardName = newBed.wardName;
    adm.bedDailyRateNpr = newBed.dailyRateNpr;
    adm.progressNotes.unshift({
      id: `pn-${Date.now()}`,
      timestamp: nowIso,
      note: `Bed Transfer: Moved from ${transferRecord.fromBedLabel} to ${transferRecord.toBedLabel}. Reason: ${transferRecord.reason}`,
      recordedBy: actor.fullName
    });
    appendAudit(
      db,
      actor,
      "BED_MANAGEMENT",
      "IPD_BED_TRANSFERRED",
      adm.admissionNumber,
      `Transferred ${adm.patientName} (${adm.admissionNumber}) from ${transferRecord.fromBedLabel} to ${transferRecord.toBedLabel}.`
    );
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/medicines", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission record not found." });
      return;
    }
    const {
      medicineId,
      customMedicineName,
      dosageRoute,
      quantity,
      unitPriceNpr,
      deductFromPharmacyFefo = true
    } = req.body;
    const qty = Math.max(1, Number(quantity) || 1);
    const med = medicineId ? db.pharmacyMedicines.find((m) => m.id === medicineId) : void 0;
    if (!med && !customMedicineName?.trim()) {
      res.status(400).json({ error: "Select a medicine from Pharmacy Master or enter a medicine name." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const todayIso = nowIso.slice(0, 10);
    const createdItems = [];
    if (med && deductFromPharmacyFefo) {
      const candidateBatches = db.pharmacyBatches.filter((b) => {
        if (b.medicineId !== med.id) return false;
        if (b.centerId !== adm.centerId) return false;
        if (b.quarantined || b.quantityOnHand <= 0) return false;
        if (b.expiryDate < todayIso) return false;
        return true;
      }).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
      const totalAvail = candidateBatches.reduce((s, b) => s + b.quantityOnHand, 0);
      if (totalAvail >= qty) {
        let remaining = qty;
        for (const batch of candidateBatches) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, batch.quantityOnHand);
          remaining -= take;
          batch.quantityOnHand = Math.max(0, batch.quantityOnHand - take);
          const price = unitPriceNpr !== void 0 ? Number(unitPriceNpr) : batch.mrpNpr;
          createdItems.push({
            id: `ium-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            administeredAt: nowIso,
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            genericName: med.genericName,
            dosageRoute: dosageRoute?.trim() || "As charted",
            quantity: take,
            unitPriceNpr: price,
            totalPriceNpr: Number((take * price).toFixed(2)),
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            deductedFromPharmacyFefo: true,
            administeredBy: actor.fullName
          });
          db.pharmacyMovements.unshift({
            id: `pmov-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            timestamp: nowIso,
            medicineId: med.id,
            medicineName: `${med.brandName} ${med.strength}`,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            centerId: adm.centerId,
            type: "FEFO_DISPENSE",
            quantityDelta: -take,
            balanceAfter: batch.quantityOnHand,
            referenceId: adm.admissionNumber,
            performedBy: actor.fullName,
            notes: `IPD Ward FEFO Administration to ${adm.patientName} (Bed ${adm.currentBedLabel})`
          });
        }
      }
    }
    if (createdItems.length === 0) {
      const price = unitPriceNpr !== void 0 ? Number(unitPriceNpr) : med?.defaultMrpNpr ?? 0;
      createdItems.push({
        id: `ium-${Date.now()}`,
        administeredAt: nowIso,
        medicineId: med?.id,
        medicineName: med ? `${med.brandName} ${med.strength}` : customMedicineName.trim(),
        genericName: med?.genericName,
        dosageRoute: dosageRoute?.trim() || "As charted",
        quantity: qty,
        unitPriceNpr: price,
        totalPriceNpr: Number((qty * price).toFixed(2)),
        deductedFromPharmacyFefo: false,
        administeredBy: actor.fullName
      });
    }
    adm.usedMedicines.push(...createdItems);
    recalcIpdFinancials(adm, db.settings?.moduleSettings);
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "IPD_MEDICINE_ADMINISTERED",
      adm.admissionNumber,
      `Logged ${createdItems.map((i) => `${i.medicineName} x${i.quantity}`).join(", ")} for ${adm.patientName}.`
    );
    saveDb(db);
    res.status(201).json({ admission: adm, items: createdItems, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/investigations", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission record not found." });
      return;
    }
    const {
      serviceId,
      customServiceName,
      category,
      status,
      summaryFinding,
      priceNpr,
      createDiagnosticOrder = true
    } = req.body;
    const srv = serviceId ? db.services.find((s) => s.id === serviceId) : void 0;
    if (!srv && !customServiceName?.trim()) {
      res.status(400).json({ error: "Select a test/imaging study from Service Master or enter an investigation name." });
      return;
    }
    let linkedOrder = null;
    if (srv && createDiagnosticOrder) {
      linkedOrder = createLinkedOrderFromClinical(db, actor, {
        centerId: adm.centerId,
        centerName: adm.centerName,
        patientName: adm.patientName,
        patientAge: adm.patientAge,
        patientAgeType: adm.patientAgeType,
        patientGender: adm.patientGender,
        patientPhone: adm.patientPhone,
        patientAddress: adm.patientAddress,
        referringDoctor: adm.admittingDoctor,
        serviceIds: [srv.id],
        priority: "STAT"
      });
    }
    const invItem = {
      id: `iinv-${Date.now()}`,
      orderedAt: (/* @__PURE__ */ new Date()).toISOString(),
      serviceId: srv?.id,
      serviceCode: srv?.code || "EXT-INV",
      serviceName: srv?.name || customServiceName.trim(),
      category: srv ? srv.serviceCategory || (srv.department === "Radiology" ? "RADIOLOGY" : "PATHOLOGY") : category || "PATHOLOGY",
      linkedOrderId: linkedOrder?.id,
      linkedAccessionNumber: linkedOrder?.accessionNumber,
      status: status || (linkedOrder ? "Ordered" : "Completed"),
      summaryFinding: summaryFinding?.trim() || "",
      priceNpr: priceNpr !== void 0 ? Number(priceNpr) : srv?.price ?? 0
    };
    adm.investigationsDone.push(invItem);
    recalcIpdFinancials(adm, db.settings?.moduleSettings);
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "IPD_INVESTIGATION_LOGGED",
      adm.admissionNumber,
      `Logged IPD investigation ${invItem.serviceCode} (${invItem.serviceName}) for ${adm.patientName}.`
    );
    saveDb(db);
    res.status(201).json({ admission: adm, investigation: invItem, linkedOrder, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/deposit", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const { amountNpr, paymentMode, notes, progressNote, shift, roundTime } = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    if (progressNote?.trim()) {
      adm.progressNotes.unshift({
        id: `pn-${Date.now()}`,
        timestamp: nowIso,
        note: progressNote.trim(),
        shift: shift || actor.shift || "Morning",
        roundTime: roundTime || bsNow.timeEn,
        recordedBy: actor.fullName
      });
    }
    const amt = Number(amountNpr) || 0;
    if (amt > 0) {
      const mode = paymentMode || "Cash";
      const rcpNo = `IPD-RCP-${bsNow.year}-${201 + adm.deposits.length + db.ipdAdmissions.length}`;
      adm.deposits.push({
        id: `dep-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: amt,
        paymentMode: mode,
        receiptNumber: rcpNo,
        notes: notes?.trim() || "Interim IPD deposit",
        receivedBy: actor.fullName
      });
      const targetAcc = mode === "Bank / QR" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER");
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          amt,
          "POS_COLLECTION",
          rcpNo,
          `IPD Interim Deposit ${adm.admissionNumber} (${adm.patientName})`,
          adm.fiscalYear,
          actor
        );
      }
      recalcIpdFinancials(adm, db.settings?.moduleSettings);
    }
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      amt > 0 ? "IPD_DEPOSIT_RECEIVED" : "IPD_PROGRESS_NOTE_ADDED",
      adm.admissionNumber,
      amt > 0 ? `Received \u0930\u0942 ${amt.toLocaleString()} IPD deposit for ${adm.patientName}.` : `Added clinical progress note for ${adm.patientName}.`
    );
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/pay-item", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const {
      mode = "SETTLE_EXISTING",
      category = "PROCEDURE",
      shift,
      itemLabel,
      amountNpr,
      paymentMode = "Cash",
      referenceItemId,
      notes
    } = req.body;
    const amt = Number(Number(amountNpr || 0).toFixed(2));
    if (!itemLabel?.trim() || amt <= 0) {
      res.status(400).json({ error: "Item description and positive amount (\u0930\u0942) are required." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    if (!Array.isArray(adm.ipdIndividualBills)) adm.ipdIndividualBills = [];
    if (!Array.isArray(adm.directServiceCharges)) adm.directServiceCharges = [];
    let cashBill = null;
    const billNo = `IPD-CSH-${bsNow.year}-${101 + adm.ipdIndividualBills.length + db.ipdAdmissions.length}`;
    const normalizedShift = shift === "Morning" || shift === "Afternoon" || shift === "Night" ? shift : void 0;
    if (mode === "ADD_CHARGE") {
      const chargeCat = category === "BED_STAY" || category === "NURSING" || category === "OBSERVATION" || category === "DOCTOR_ROUND" ? category : "PROCEDURE";
      adm.directServiceCharges.unshift({
        id: `ichg-${Date.now()}`,
        billedAt: nowIso,
        billedBy: actor.fullName,
        serviceName: itemLabel.trim(),
        category: chargeCat,
        shift: normalizedShift,
        amountNpr: amt,
        paymentMode: paymentMode === "Credit" ? "Credit" : paymentMode,
        cashBillNumber: paymentMode === "Credit" ? void 0 : billNo,
        notes: notes?.trim()
      });
    }
    if (paymentMode !== "Credit") {
      cashBill = {
        id: `ipdbill-${Date.now()}`,
        billNumber: billNo,
        billedAt: nowIso,
        billedById: actor.id,
        billedBy: actor.fullName,
        category,
        shift: normalizedShift,
        itemLabel: itemLabel.trim(),
        referenceItemId,
        amountNpr: amt,
        paymentMode,
        notes: notes?.trim() || (mode === "ADD_CHARGE" ? "Direct IPD cash service bill" : "One-by-one individual cash settlement")
      };
      adm.ipdIndividualBills.unshift(cashBill);
      const targetAcc = paymentMode === "Bank / QR" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER");
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          amt,
          "POS_COLLECTION",
          billNo,
          `IPD Cash Bill ${billNo}: ${itemLabel.trim()}${normalizedShift ? ` [${normalizedShift} Shift]` : ""} (${adm.patientName})`,
          adm.fiscalYear,
          actor
        );
      }
    }
    recalcIpdFinancials(adm, db.settings?.moduleSettings);
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      paymentMode === "Credit" ? "IPD_SERVICE_CREDIT_POSTED" : "IPD_INDIVIDUAL_CASH_BILL",
      cashBill ? cashBill.billNumber : adm.admissionNumber,
      paymentMode === "Credit" ? `Posted IPD credit service "${itemLabel.trim()}"${normalizedShift ? ` (${normalizedShift} shift)` : ""} (\u0930\u0942 ${amt.toLocaleString()}) on ${adm.admissionNumber}.` : `Issued IPD Individual Cash Bill ${billNo} (${paymentMode}) for "${itemLabel.trim()}"${normalizedShift ? ` (${normalizedShift} shift)` : ""} \u0930\u0942 ${amt.toLocaleString()} (${adm.patientName}).`
    );
    saveDb(db);
    res.status(201).json({ cashBill, admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/deposition", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const {
      disposition,
      finalDiagnosis,
      hospitalCourseSummary,
      dischargeCondition,
      dischargeAdvice,
      followUpDateBs,
      bedDaysBilled,
      doctorRoundsCount,
      nursingDaysBilled,
      observationDaysBilled,
      otherProcedureChargesNpr,
      finalSettlementAmountNpr,
      settlementPaymentMode,
      externalReferral
    } = req.body;
    if (!disposition || disposition === "Admitted") {
      res.status(400).json({ error: "Select a valid Deposition outcome (Discharged / Referred to External Hospital / LAMA / Transfer)." });
      return;
    }
    if (disposition === "Referred to External Hospital" || disposition === "Transferred to Ward/Hub") {
      if (!externalReferral?.referredToHospital?.trim() || !externalReferral?.referredToPlace?.trim()) {
        res.status(400).json({
          error: "Referred Hospital/Facility Name and Place / City are mandatory when referring or transferring out."
        });
        return;
      }
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const ms = db.settings?.moduleSettings;
    const cycleStart = ms?.ipdBedCycleStartTime || "07:00";
    const cycleEnd = ms?.ipdBedCycleEndTime || "19:00";
    const autoDays = calculateAutoBedDays(adm.admittedAt, nowIso, cycleStart, cycleEnd);
    const days = Math.max(1, bedDaysBilled !== void 0 ? Number(bedDaysBilled) || autoDays : autoDays);
    const rounds = Math.max(0, doctorRoundsCount !== void 0 ? Number(doctorRoundsCount) : days);
    const nursingDays = Math.max(0, nursingDaysBilled !== void 0 ? Number(nursingDaysBilled) : days);
    const obsDays = Math.max(0, observationDaysBilled !== void 0 ? Number(observationDaysBilled) : days);
    const roundFee = ms?.ipdDoctorRoundFeeNpr ?? 500;
    const nursingFee = ms?.ipdNursingChargePerDayNpr ?? 400;
    const obsFee = ms?.ipdDailyObservationFeeNpr ?? 300;
    adm.bedDaysBilled = days;
    adm.bedChargesNpr = Number((days * adm.bedDailyRateNpr).toFixed(2));
    adm.doctorRoundsCount = rounds;
    adm.doctorRoundFeeNpr = roundFee;
    adm.doctorRoundChargesNpr = Number((rounds * roundFee).toFixed(2));
    adm.nursingDaysBilled = nursingDays;
    adm.nursingChargePerDayNpr = nursingFee;
    adm.nursingChargesNpr = Number((nursingDays * nursingFee).toFixed(2));
    adm.autoObservationDaysBilled = obsDays;
    adm.autoObservationFeePerDayNpr = obsFee;
    adm.autoObservationChargesNpr = Number((obsDays * obsFee).toFixed(2));
    adm.bedCycleWindowLabel = `${cycleStart} - ${cycleEnd}`;
    if (otherProcedureChargesNpr !== void 0) {
      adm.otherProcedureChargesNpr = Math.max(0, Number(otherProcedureChargesNpr) || 0);
    }
    const settleAmt = Math.max(0, Number(finalSettlementAmountNpr) || 0);
    if (settleAmt > 0) {
      const mode = settlementPaymentMode || "Cash";
      const rcpNo = `IPD-SET-${bsNow.year}-${301 + adm.deposits.length + db.ipdAdmissions.length}`;
      adm.deposits.push({
        id: `dep-set-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: settleAmt,
        paymentMode: mode,
        receiptNumber: rcpNo,
        notes: `Final Deposition Settlement (${disposition})`,
        receivedBy: actor.fullName
      });
      const targetAcc = mode === "Bank / QR" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER");
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          settleAmt,
          "POS_COLLECTION",
          rcpNo,
          `IPD Final Settlement ${adm.admissionNumber} (${adm.patientName})`,
          adm.fiscalYear,
          actor
        );
      }
    }
    adm.disposition = disposition;
    adm.finalDiagnosis = finalDiagnosis?.trim() || adm.admittingDiagnosis;
    adm.hospitalCourseSummary = hospitalCourseSummary?.trim() || adm.hospitalCourseSummary;
    adm.dischargeCondition = dischargeCondition?.trim() || "Stable";
    adm.dischargeAdvice = dischargeAdvice?.trim() || "";
    adm.followUpDateBs = followUpDateBs?.trim() || "";
    adm.dischargedAt = nowIso;
    adm.dischargedBy = actor.fullName;
    if (externalReferral) {
      const baseExt = {
        ...externalReferral,
        referredAt: externalReferral.referredAt || nowIso,
        referredBy: externalReferral.referredBy || actor.fullName
      };
      adm.externalReferral = attachEncounterBillingAndClinicalHistory(db, {
        baseReferral: baseExt,
        patientId: adm.patientId,
        uhid: adm.uhid,
        patientName: adm.patientName,
        patientPhone: adm.patientPhone,
        encounterType: "IPD",
        encounterId: adm.id,
        admission: adm
      });
    }
    recalcIpdFinancials(adm, ms, {
      bedDaysBilled: days,
      doctorRoundsCount: rounds,
      nursingDaysBilled: nursingDays,
      observationDaysBilled: obsDays
    });
    const currentBed = (db.hospitalBeds || []).find((b) => b.id === adm.currentBedId);
    if (currentBed) {
      currentBed.status = db.settings.moduleSettings?.markBedCleaningOnDischarge !== false ? "Cleaning" : "Available";
      currentBed.currentAdmissionId = null;
      currentBed.currentPatientName = null;
    }
    if (!Array.isArray(adm.consents)) adm.consents = [];
    if (disposition === "LAMA / DOR" && !adm.consents.some((c) => c.consentType === "LAMA_DOR_RISK")) {
      const def = CONSENT_CATALOG.LAMA_DOR_RISK;
      adm.consents.push({
        id: `cns-lama-${Date.now()}`,
        consentCode: `CNS-LAM-${Math.floor(100 + Math.random() * 899)}`,
        consentType: "LAMA_DOR_RISK",
        title: def.title,
        autoReason: def.caseTriggerRule,
        summaryText: def.summaryText,
        patientOrGuardianName: adm.emergencyContact || adm.patientName,
        relationship: "Attendant",
        witnessName: "",
        status: "Auto-Assigned (Pending Signature)",
        createdAt: nowIso
      });
    }
    if (disposition === "Referred to External Hospital" && !adm.consents.some((c) => c.consentType === "EXTERNAL_REFERRAL_TRANSPORT")) {
      const def = CONSENT_CATALOG.EXTERNAL_REFERRAL_TRANSPORT;
      adm.consents.push({
        id: `cns-ref-${Date.now()}`,
        consentCode: `CNS-REF-${Math.floor(100 + Math.random() * 899)}`,
        consentType: "EXTERNAL_REFERRAL_TRANSPORT",
        title: def.title,
        autoReason: def.caseTriggerRule,
        summaryText: def.summaryText,
        patientOrGuardianName: adm.emergencyContact || adm.patientName,
        relationship: "Attendant",
        witnessName: "",
        status: "Auto-Assigned (Pending Signature)",
        createdAt: nowIso
      });
    }
    appendAudit(
      db,
      actor,
      "OPD_IPD",
      "IPD_DEPOSITION_FINALIZED",
      adm.admissionNumber,
      `Finalized IPD Deposition for ${adm.patientName} (${adm.admissionNumber}): ${disposition}${adm.externalReferral ? ` to ${adm.externalReferral.referredToHospital}, ${adm.externalReferral.referredToPlace}` : ""}. Total Bill: \u0930\u0942 ${adm.totalBillNpr.toLocaleString()}.`,
      disposition === "Referred to External Hospital" ? "WARNING" : "INFO"
    );
    saveDb(db);
    res.json({ admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/nursing-chart", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const body = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const entry = {
      id: `nc-${Date.now()}`,
      recordedAt: nowIso,
      shift: body.shift || "Morning",
      bp: body.bp?.trim() || "120/80",
      pulseBpm: body.pulseBpm !== void 0 ? Number(body.pulseBpm) : 78,
      tempF: body.tempF !== void 0 ? Number(body.tempF) : 98.6,
      spo2Pct: body.spo2Pct !== void 0 ? Number(body.spo2Pct) : 98,
      respRate: body.respRate !== void 0 ? Number(body.respRate) : 18,
      painScore: body.painScore !== void 0 ? Number(body.painScore) : 2,
      gcsScore: body.gcsScore?.trim() || "15/15",
      intakeOralMl: Number(body.intakeOralMl) || 0,
      intakeIvMl: Number(body.intakeIvMl) || 0,
      outputUrineMl: Number(body.outputUrineMl) || 0,
      outputDrainMl: Number(body.outputDrainMl) || 0,
      nursingCareNote: body.nursingCareNote?.trim() || "Routine shift nursing round & medication administration completed.",
      recordedBy: actor.fullName
    };
    if (!Array.isArray(adm.nursingCharts)) adm.nursingCharts = [];
    adm.nursingCharts.unshift(entry);
    const totalIn = (entry.intakeOralMl || 0) + (entry.intakeIvMl || 0);
    const totalOut = (entry.outputUrineMl || 0) + (entry.outputDrainMl || 0);
    appendAudit(
      db,
      actor,
      "NURSING_CHART",
      "NURSING_CHART_LOGGED",
      adm.admissionNumber,
      `Logged ${entry.shift} shift nursing chart for ${adm.patientName} (BP ${entry.bp}, SpO2 ${entry.spo2Pct}%, I/O ${totalIn}/${totalOut} mL).`
    );
    saveDb(db);
    res.status(201).json({ entry, admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ipd/admissions/:id/nursing-observation", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const adm = (db.ipdAdmissions || []).find((a) => a.id === req.params.id);
    if (!adm) {
      res.status(404).json({ error: "IPD admission not found." });
      return;
    }
    const { observationType, roundTime, shift, durationHours, feeNpr, nurseName, notes } = req.body;
    if (!observationType?.trim()) {
      res.status(400).json({ error: "Observation / Nursing Round type is required." });
      return;
    }
    const fee = Math.max(0, Number(feeNpr) || 0);
    if (!Array.isArray(adm.nursingObservationFees)) adm.nursingObservationFees = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const obsEntry = {
      id: `nobs-${Date.now()}`,
      recordedAt: nowIso,
      roundTime: roundTime?.trim() || (/* @__PURE__ */ new Date()).toTimeString().slice(0, 5),
      shift: shift || "Morning",
      observationType: observationType.trim(),
      durationHours: durationHours !== void 0 ? Number(durationHours) : void 0,
      feeNpr: fee,
      nurseName: nurseName?.trim() || actor.fullName,
      notes: notes?.trim() || "",
      recordedBy: actor.fullName
    };
    adm.nursingObservationFees.unshift(obsEntry);
    adm.nursingObservationChargesNpr = Number(
      adm.nursingObservationFees.reduce((s, item) => s + (Number(item.feeNpr) || 0), 0).toFixed(2)
    );
    recalcIpdFinancials(adm, db.settings?.moduleSettings);
    appendAudit(
      db,
      actor,
      "NURSING_CHART",
      "NURSING_OBSERVATION_FEE_LOGGED",
      adm.admissionNumber,
      `Logged ${obsEntry.observationType} (${obsEntry.shift} shift @ ${obsEntry.roundTime}) \u2014 \u0930\u0942 ${fee.toLocaleString()} for ${adm.patientName}.`
    );
    saveDb(db);
    res.status(201).json({ entry: obsEntry, admission: adm, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/clinical/quick-round-note", withAuth(), (req, res) => {
    const { db, actor } = req;
    const canClinical = hasPermission(db, actor.roleId, "hospital.clinical") || hasPermission(db, actor.roleId, "nursing.view") || hasPermission(db, actor.roleId, "doctor.view") || hasPermission(db, actor.roleId, "emergency.manage");
    if (!canClinical) {
      res.status(403).json({ error: "Access denied: Clinical, nursing, or physician permission required." });
      return;
    }
    const {
      encounterType,
      encounterId,
      shift = "Morning",
      bp,
      pulseBpm,
      tempF,
      spo2Pct,
      respRate,
      medicationNote,
      autoFlagAbnormalDoctor = true
    } = req.body;
    if (!encounterId || !medicationNote?.trim()) {
      res.status(400).json({ error: "Encounter ID and clinical / medication round note are required." });
      return;
    }
    const abnormalReasons = [];
    if (bp?.includes("/")) {
      const [sysRaw, diaRaw] = bp.split("/").map((x) => Number(x.trim()));
      if (Number.isFinite(sysRaw) && (sysRaw >= 140 || sysRaw <= 90)) {
        abnormalReasons.push(`BP ${bp} mmHg`);
      } else if (Number.isFinite(diaRaw) && (diaRaw >= 90 || diaRaw <= 60)) {
        abnormalReasons.push(`BP ${bp} mmHg`);
      }
    }
    if (pulseBpm !== void 0 && pulseBpm !== null && (Number(pulseBpm) > 110 || Number(pulseBpm) < 55)) {
      abnormalReasons.push(`Pulse ${pulseBpm} bpm`);
    }
    if (tempF !== void 0 && tempF !== null && (Number(tempF) >= 100.4 || Number(tempF) < 95.5)) {
      abnormalReasons.push(`Temp ${tempF}\xB0F`);
    }
    if (spo2Pct !== void 0 && spo2Pct !== null && Number(spo2Pct) < 94) {
      abnormalReasons.push(`SpO2 ${spo2Pct}%`);
    }
    if (respRate !== void 0 && respRate !== null && (Number(respRate) > 24 || Number(respRate) < 12)) {
      abnormalReasons.push(`RR ${respRate}/min`);
    }
    const isAbnormal = abnormalReasons.length > 0;
    const doctorFlagged = Boolean(autoFlagAbnormalDoctor && isAbnormal);
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const cleanNote = medicationNote.trim();
    const formattedStampNote = `[Quick Round @ ${bsNow.formattedEn} ${bsNow.timeEn} \xB7 ${actor.fullName}] Vitals: BP ${bp || "\u2014"}, PR ${pulseBpm ?? "\u2014"}, T ${tempF ?? "\u2014"}\xB0F, SpO2 ${spo2Pct ?? "\u2014"}%, RR ${respRate ?? "\u2014"} | ${cleanNote}${doctorFlagged ? ` [URGENT DOCTOR ALERT: ${abnormalReasons.join(", ")}]` : ""}`;
    let patientLabel = "";
    let refCode = "";
    if (encounterType === "IPD") {
      const adm = (db.ipdAdmissions || []).find((a) => a.id === encounterId);
      if (!adm) {
        res.status(404).json({ error: "IPD admission not found." });
        return;
      }
      if (!Array.isArray(adm.nursingCharts)) adm.nursingCharts = [];
      adm.nursingCharts.unshift({
        id: `nc-qr-${Date.now()}`,
        recordedAt: nowIso,
        shift,
        bp: bp?.trim() || adm.vitalsOnAdmission?.bp || "120/80",
        pulseBpm: pulseBpm !== void 0 ? Number(pulseBpm) : adm.vitalsOnAdmission?.pulseBpm,
        tempF: tempF !== void 0 ? Number(tempF) : adm.vitalsOnAdmission?.tempF,
        spo2Pct: spo2Pct !== void 0 ? Number(spo2Pct) : adm.vitalsOnAdmission?.spo2Pct,
        respRate: respRate !== void 0 ? Number(respRate) : adm.vitalsOnAdmission?.respRate,
        nursingCareNote: doctorFlagged ? `${cleanNote} [DOCTOR NOTIFIED: ${abnormalReasons.join(", ")}]` : cleanNote,
        recordedBy: actor.fullName
      });
      adm.progressNotes.unshift({
        id: `pn-qr-${Date.now()}`,
        timestamp: nowIso,
        note: formattedStampNote,
        recordedBy: actor.fullName
      });
      patientLabel = `${adm.patientName} (Bed ${adm.currentBedLabel})`;
      refCode = adm.admissionNumber;
    } else if (encounterType === "OPD") {
      const visit = (db.opdVisits || []).find((v) => v.id === encounterId);
      if (!visit) {
        res.status(404).json({ error: "OPD visit not found." });
        return;
      }
      visit.vitals = {
        ...visit.vitals,
        bp: bp?.trim() || visit.vitals?.bp,
        pulseBpm: pulseBpm !== void 0 ? Number(pulseBpm) : visit.vitals?.pulseBpm,
        tempF: tempF !== void 0 ? Number(tempF) : visit.vitals?.tempF,
        spo2Pct: spo2Pct !== void 0 ? Number(spo2Pct) : visit.vitals?.spo2Pct,
        respRate: respRate !== void 0 ? Number(respRate) : visit.vitals?.respRate
      };
      visit.clinicalNotes = visit.clinicalNotes ? `${formattedStampNote}
${visit.clinicalNotes}` : formattedStampNote;
      patientLabel = `${visit.patientName} (${visit.tokenNumber})`;
      refCode = visit.tokenNumber;
    } else {
      const erCase = (db.emergencyCases || []).find((e) => e.id === encounterId);
      if (!erCase) {
        res.status(404).json({ error: "Emergency case not found." });
        return;
      }
      erCase.vitals = {
        ...erCase.vitals,
        bp: bp?.trim() || erCase.vitals?.bp,
        pulseBpm: pulseBpm !== void 0 ? Number(pulseBpm) : erCase.vitals?.pulseBpm,
        tempF: tempF !== void 0 ? Number(tempF) : erCase.vitals?.tempF,
        spo2Pct: spo2Pct !== void 0 ? Number(spo2Pct) : erCase.vitals?.spo2Pct,
        respRate: respRate !== void 0 ? Number(respRate) : erCase.vitals?.respRate
      };
      erCase.clinicalNotes = erCase.clinicalNotes ? `${formattedStampNote}
${erCase.clinicalNotes}` : formattedStampNote;
      patientLabel = `${erCase.patientName} (${erCase.erBedBay})`;
      refCode = erCase.erNumber;
    }
    if (doctorFlagged) {
      appendSecurityAlert(db, {
        type: "CLINICAL_VITALS_ALERT",
        severity: "CRITICAL",
        targetUserId: encounterId,
        targetUsername: refCode,
        targetFullName: patientLabel,
        message: `URGENT DOCTOR ALERT (${encounterType} ${refCode}): ${patientLabel} abnormal readings [${abnormalReasons.join(", ")}] \u2014 Note: ${cleanNote}`,
        resolved: false
      });
    }
    appendAudit(
      db,
      actor,
      "NURSING_CHART",
      doctorFlagged ? "QUICK_ROUND_ABNORMAL_ALERT" : "QUICK_ROUND_NOTE_LOGGED",
      refCode,
      `Quick Round Note logged on ${encounterType} ${refCode} (${patientLabel})${doctorFlagged ? ` \u2014 Doctor Alert Flagged: ${abnormalReasons.join(", ")}` : ""}.`,
      doctorFlagged ? "CRITICAL" : "INFO"
    );
    saveDb(db);
    res.status(201).json({
      isAbnormal,
      doctorFlagged,
      abnormalReasons,
      db: scopeDbForActor(db, actor)
    });
  });
  app.post("/api/clinical/alerts/:id/resolve", withAuth(), (req, res) => {
    const { db, actor } = req;
    const alert = (db.securityAlerts || []).find((a) => a.id === req.params.id);
    if (!alert) {
      res.status(404).json({ error: "Alert not found." });
      return;
    }
    alert.resolved = true;
    alert.resolvedBy = actor.fullName;
    alert.resolvedReason = req.body?.reason?.trim() || "Reviewed by clinician";
    alert.resolvedAt = (/* @__PURE__ */ new Date()).toISOString();
    saveDb(db);
    res.json({ alert, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/consents/:scope/:parentId", withAuth(), (req, res) => {
    const { db, actor } = req;
    const { scope, parentId } = req.params;
    if (!hasPermission(db, actor.roleId, "hospital.clinical") && !hasPermission(db, actor.roleId, "emergency.manage")) {
      res.status(403).json({ error: "Access denied: Requires clinical or emergency consent permission." });
      return;
    }
    const { consentId, action, consentType, patientOrGuardianName, relationship, witnessName, customSummary } = req.body;
    const target = scope === "er" ? (db.emergencyCases || []).find((e) => e.id === parentId) : (db.ipdAdmissions || []).find((a) => a.id === parentId);
    if (!target) {
      res.status(404).json({ error: `${scope.toUpperCase()} patient record not found.` });
      return;
    }
    if (!Array.isArray(target.consents)) target.consents = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (action === "ADD" && consentType) {
      const def = CONSENT_CATALOG[consentType] || CONSENT_CATALOG.GENERAL_ADMISSION;
      const created = {
        id: `cns-${Date.now()}`,
        consentCode: `CNS-${consentType.slice(0, 3)}-${Math.floor(100 + Math.random() * 899)}`,
        consentType,
        title: def.title,
        autoReason: "Clinician Added Case Consent",
        summaryText: customSummary?.trim() || def.summaryText,
        patientOrGuardianName: patientOrGuardianName?.trim() || target.patientName,
        relationship: relationship?.trim() || "Self",
        witnessName: witnessName?.trim() || "",
        status: patientOrGuardianName?.trim() ? "Signed & Verified" : "Auto-Assigned (Pending Signature)",
        signedAt: patientOrGuardianName?.trim() ? nowIso : void 0,
        verifiedBy: patientOrGuardianName?.trim() ? actor.fullName : void 0,
        createdAt: nowIso
      };
      target.consents.push(created);
    } else if (consentId) {
      const existing = target.consents.find((c) => c.id === consentId);
      if (!existing) {
        res.status(404).json({ error: "Consent record not found." });
        return;
      }
      existing.status = "Signed & Verified";
      existing.patientOrGuardianName = patientOrGuardianName?.trim() || existing.patientOrGuardianName || target.patientName;
      existing.relationship = relationship?.trim() || existing.relationship || "Self";
      existing.witnessName = witnessName?.trim() || existing.witnessName || actor.fullName;
      existing.signedAt = nowIso;
      existing.verifiedBy = actor.fullName;
    }
    const refNo = "erNumber" in target ? target.erNumber : target.admissionNumber;
    appendAudit(
      db,
      actor,
      "CONSENT",
      "CONSENT_UPDATED",
      refNo,
      `Updated case consent (${action || "SIGN"}) on ${scope.toUpperCase()} ${refNo} (${target.patientName}).`
    );
    saveDb(db);
    res.json({ target, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/emergency/cases", withAuth("emergency.manage", "emergency_mlc"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.patientName?.trim() || !body.chiefComplaint?.trim()) {
      res.status(400).json({ error: "Patient Name and Emergency Chief Complaint are required." });
      return;
    }
    const ms = db.settings?.moduleSettings;
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 30,
      ageType: body.patientAgeType || "Years",
      gender: body.patientGender || "Male",
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName
    });
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    if (!Array.isArray(db.emergencyCases)) db.emergencyCases = [];
    const seq = db.emergencyCases.length + 1;
    const erNumber = `${ms?.erPrefix || "ER"}-${bsNow.year}-${String(seq).padStart(3, "0")}`;
    const isMlc = Boolean(body.isMlc);
    const mlcNumber = isMlc ? `${ms?.mlcPrefix || "MLC"}-${bsNow.year}-${String(db.emergencyCases.filter((e) => e.isMlc).length + 1).padStart(3, "0")}` : void 0;
    const placeHint = body.incidentPlace || body.patientAddress || "";
    const detectedPolice = autoDetectPoliceStation(placeHint, ms?.policeStations);
    const autoConsents = autoAssignConsents({
      context: "ER",
      caseCategory: body.triageLevel === "Red (Resuscitation)" ? "Critical" : body.chiefComplaint,
      isMlc,
      mlcType: body.mlcCaseType,
      patientName: patientRec.fullName,
      guardianName: body.broughtByName?.trim(),
      createdAt: nowIso
    });
    const ticketFee = body.erTicketFeeNpr !== void 0 ? Math.max(0, Number(body.erTicketFeeNpr)) : ms?.emergencyTicketFeeNpr ?? 250;
    const erRegFee = body.erChargesNpr !== void 0 ? Math.max(0, Number(body.erChargesNpr)) : ms?.emergencyRegistrationFeeNpr ?? 500;
    const totalErCollected = Number((ticketFee + erRegFee).toFixed(2));
    const payMode = body.paymentMode || "Cash";
    const selectedBed = body.selectedBedId ? (db.hospitalBeds || []).find((b) => b.id === body.selectedBedId) : void 0;
    if (selectedBed && selectedBed.status !== "Available") {
      res.status(409).json({ error: `ER Bed ${selectedBed.bedCode} is ${selectedBed.status}. Please select an Available ER bed.` });
      return;
    }
    const erCase = {
      id: `er-${Date.now()}`,
      erNumber,
      registeredAt: nowIso,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      centerId: null,
      centerName: db.settings.labName,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      encounterLabel: body.encounterLabel?.trim() || `${erNumber} (${selectedBed ? `${selectedBed.bedCode} \xB7 ${selectedBed.wardName}` : body.erBedBay?.trim() || "ER-BAY-01"})`,
      erTicketFeeNpr: ticketFee,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: normalizeNepalPhone(body.patientPhone) || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      broughtByName: body.broughtByName?.trim() || "",
      broughtByRelation: body.broughtByRelation?.trim() || "",
      broughtByPhone: normalizeNepalPhone(body.broughtByPhone),
      triageLevel: body.triageLevel || "Yellow (Urgent)",
      arrivalMode: body.arrivalMode || "Walk-In",
      chiefComplaint: body.chiefComplaint.trim(),
      vitals: body.vitals || {},
      erBedBay: selectedBed ? `${selectedBed.bedCode} (${selectedBed.wardName})` : body.erBedBay?.trim() || "ER-BAY-01",
      selectedBedId: selectedBed?.id || null,
      isUnknownPatient: Boolean(body.isUnknownPatient),
      erShift: detectCurrentShiftLabel(/* @__PURE__ */ new Date()),
      attendingDoctor: body.attendingDoctor?.trim() || actor.fullName,
      clinicalNotes: body.clinicalNotes?.trim() || "IV line, vitals monitoring & initial emergency stabilization.",
      isMlc,
      mlcNumber,
      mlcCaseType: isMlc ? body.mlcCaseType || "Other MLC" : void 0,
      incidentPlace: body.incidentPlace?.trim() || body.patientAddress?.trim() || "",
      incidentTimeText: body.incidentTimeText?.trim() || `${bsNow.formattedEn} ${bsNow.timeEn}`,
      identificationMarks: body.identificationMarks?.trim() || "",
      injurySummary: body.injurySummary?.trim() || (isMlc ? body.chiefComplaint.trim() : ""),
      policeStationName: body.policeStationName?.trim() || detectedPolice.stationName,
      policeStationAddress: body.policeStationAddress?.trim() || detectedPolice.stationAddress,
      policeStationPhone: body.policeStationPhone?.trim() || detectedPolice.stationPhone,
      policeInformed: false,
      consents: autoConsents,
      disposition: "Under Observation (ER)",
      erChargesNpr: erRegFee,
      paymentMode: payMode,
      recordedBy: actor.fullName
    };
    if (selectedBed && selectedBed.status === "Available") {
      selectedBed.status = "Occupied";
      selectedBed.currentAdmissionId = erCase.id;
      selectedBed.currentPatientName = erCase.patientName;
    }
    db.emergencyCases.unshift(erCase);
    if (totalErCollected > 0 && (payMode === "Cash" || payMode === "Bank / QR")) {
      const targetAcc = payMode === "Bank / QR" ? db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosBank) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "BANK") : db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.isDefaultPosCash) || db.accounts.find((a) => a.departmentScope !== "PHARMACY" && a.type === "CASH_COUNTER");
      if (targetAcc) {
        postLedgerMovement(
          db,
          targetAcc,
          "INFLOW",
          totalErCollected,
          "POS_COLLECTION",
          erNumber,
          `ER Ticket (\u0930\u0942 ${ticketFee}) + Reg Fee (\u0930\u0942 ${erRegFee}) \u2014 ${erCase.patientName}`,
          erCase.fiscalYear,
          actor
        );
      }
    }
    appendAudit(
      db,
      actor,
      "EMERGENCY_MLC",
      isMlc ? "MLC_CASE_REGISTERED" : "ER_CASE_REGISTERED",
      erNumber,
      `Registered ${erNumber} (${erCase.patientName}, Triage: ${erCase.triageLevel}, ER Ticket+Reg: \u0930\u0942 ${totalErCollected}${isMlc ? `, MLC ${mlcNumber}` : ""}).`,
      isMlc ? "WARNING" : "INFO"
    );
    saveDb(db);
    res.status(201).json({ erCase, patient: patientRec, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/emergency/cases/:id", withAuth("emergency.manage", "emergency_mlc"), (req, res) => {
    const { db, actor } = req;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: "Emergency case not found." });
      return;
    }
    const patchBody = req.body || {};
    if (patchBody.patientPhone !== void 0) {
      patchBody.patientPhone = normalizeNepalPhone(patchBody.patientPhone);
    }
    if (patchBody.broughtByPhone !== void 0) {
      patchBody.broughtByPhone = normalizeNepalPhone(patchBody.broughtByPhone);
    }
    Object.assign(erCase, patchBody);
    if (erCase.patientId) {
      const pat = (db.patients || []).find((p) => p.id === erCase.patientId);
      if (pat) {
        if (patchBody.patientName?.trim()) pat.fullName = patchBody.patientName.trim();
        if (patchBody.patientAge !== void 0) pat.age = Number(patchBody.patientAge) || pat.age;
        if (patchBody.patientAgeType) pat.ageType = patchBody.patientAgeType;
        if (patchBody.patientGender) pat.gender = patchBody.patientGender;
        if (patchBody.patientPhone !== void 0) pat.phone = patchBody.patientPhone;
        if (patchBody.patientAddress !== void 0) pat.address = patchBody.patientAddress;
      }
    }
    if (erCase.selectedBedId) {
      const erBed = (db.hospitalBeds || []).find((b) => b.id === erCase.selectedBedId);
      if (erBed) {
        if (erCase.disposition !== "Under Observation (ER)") {
          erBed.status = "Available";
          erBed.currentAdmissionId = null;
          erBed.currentPatientName = null;
        } else {
          erBed.currentPatientName = erCase.patientName;
        }
      }
    }
    appendAudit(db, actor, "EMERGENCY_MLC", "ER_CASE_UPDATED", erCase.erNumber, `Updated ER/MLC case ${erCase.erNumber} (${erCase.patientName}) \u2014 ${erCase.disposition}.`);
    saveDb(db);
    res.json({ erCase, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/emergency/cases/:id/refer-out", withAuth("emergency.manage", "emergency_mlc"), (req, res) => {
    const { db, actor } = req;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: "Emergency case not found." });
      return;
    }
    const body = req.body || {};
    if (!body.referredToHospital?.trim() || !body.referredToPlace?.trim()) {
      res.status(400).json({ error: "Referred Hospital Name and Destination Place / City are required." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const baseExt = {
      referredHospitalId: body.referredHospitalId || void 0,
      referredToHospital: body.referredToHospital.trim(),
      referredToPlace: body.referredToPlace.trim(),
      referredHospitalManagerName: body.referredHospitalManagerName?.trim() || void 0,
      referredHospitalManagerPhone: body.referredHospitalManagerPhone?.trim() || void 0,
      referredDepartment: body.referredDepartment?.trim() || "Emergency / Trauma / ICU",
      referralReason: body.referralReason?.trim() || "Higher tertiary center management & specialist care required",
      conditionAtReferral: body.conditionAtReferral?.trim() || `${erCase.triageLevel} \u2014 Stabilized in ER`,
      transportMode: body.transportMode || "ALS Ambulance",
      ambulanceId: body.ambulanceId || void 0,
      ambulanceName: body.ambulanceName?.trim() || void 0,
      ambulanceNumber: body.ambulanceNumber?.trim() || void 0,
      ambulanceDriverName: body.ambulanceDriverName?.trim() || void 0,
      ambulanceDriverPhone: body.ambulanceDriverPhone?.trim() || void 0,
      referralCaseType: body.referralCaseType?.trim() || void 0,
      departureTime: body.departureTime?.trim() || `${bsNow.formattedEn} ${bsNow.timeEn}`,
      escortDoctorOrNurse: body.escortDoctorOrNurse?.trim() || void 0,
      caseDetails: body.caseDetails?.trim() || `${erCase.chiefComplaint}. ${erCase.clinicalNotes || ""}`.trim(),
      clinicalHistorySummary: body.clinicalHistorySummary?.trim() || void 0,
      referredAt: nowIso,
      referredBy: actor.fullName
    };
    erCase.disposition = "Referred to External Hospital";
    erCase.externalReferral = attachEncounterBillingAndClinicalHistory(db, {
      baseReferral: baseExt,
      patientId: erCase.patientId,
      uhid: erCase.uhid,
      patientName: erCase.patientName,
      patientPhone: erCase.patientPhone,
      encounterType: "EMERGENCY",
      encounterId: erCase.id,
      erCase
    });
    if (!Array.isArray(erCase.consents)) erCase.consents = [];
    if (!erCase.consents.some((c) => c.consentType === "EXTERNAL_REFERRAL_TRANSPORT")) {
      const def = CONSENT_CATALOG.EXTERNAL_REFERRAL_TRANSPORT;
      erCase.consents.push({
        id: `cns-er-ref-${Date.now()}`,
        consentCode: `CNS-ERR-${Math.floor(100 + Math.random() * 899)}`,
        consentType: "EXTERNAL_REFERRAL_TRANSPORT",
        title: def.title,
        autoReason: def.caseTriggerRule,
        summaryText: def.summaryText,
        patientOrGuardianName: erCase.broughtByName || erCase.patientName,
        relationship: erCase.broughtByRelation || "Attendant",
        witnessName: actor.fullName,
        status: "Auto-Assigned (Pending Signature)",
        createdAt: nowIso
      });
    }
    appendAudit(
      db,
      actor,
      "EMERGENCY_MLC",
      "ER_PATIENT_REFERRED_OUT",
      erCase.erNumber,
      `Referred ER ${erCase.erNumber} (${erCase.patientName}) to ${erCase.externalReferral.referredToHospital}, ${erCase.externalReferral.referredToPlace} via ${erCase.externalReferral.ambulanceName || erCase.externalReferral.transportMode} at ${erCase.externalReferral.departureTime}. Attached ${erCase.externalReferral.attachedBilledItems?.length || 0} billed item(s).`,
      "WARNING"
    );
    saveDb(db);
    res.json({ erCase, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/emergency/cases/:id/inform-police", withAuth("emergency.manage", "emergency_mlc"), (req, res) => {
    const { db, actor } = req;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: "Emergency/MLC case not found." });
      return;
    }
    const body = req.body || {};
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const detected = autoDetectPoliceStation(
      erCase.incidentPlace || erCase.patientAddress,
      db.settings?.moduleSettings?.policeStations
    );
    if (body.policeStationName?.trim()) erCase.policeStationName = body.policeStationName.trim();
    else if (!erCase.policeStationName) erCase.policeStationName = detected.stationName;
    if (body.policeStationAddress?.trim()) erCase.policeStationAddress = body.policeStationAddress.trim();
    else if (!erCase.policeStationAddress) erCase.policeStationAddress = detected.stationAddress;
    if (body.policeStationPhone?.trim()) erCase.policeStationPhone = body.policeStationPhone.trim();
    else if (!erCase.policeStationPhone) erCase.policeStationPhone = detected.stationPhone;
    erCase.isMlc = true;
    if (!erCase.mlcNumber) {
      erCase.mlcNumber = `MLC-${bsNow.year}-${String((db.emergencyCases || []).filter((e) => e.isMlc).length + 1).padStart(3, "0")}`;
    }
    if (!erCase.mlcCaseType) erCase.mlcCaseType = "Other MLC";
    erCase.policeInformed = true;
    erCase.policeInformedNumber = body.policeInformedNumber?.trim() || `MLC-INF-${bsNow.year}-${String((db.emergencyCases || []).filter((e) => e.policeInformed).length + 1).padStart(3, "0")}`;
    erCase.policeInformedAt = nowIso;
    erCase.policeOfficerName = body.policeOfficerName?.trim() || "Duty Officer (Police Chowki / Ilaka)";
    erCase.policeInformMode = body.policeInformMode || "Telephone Call";
    erCase.policeInformedBy = actor.fullName;
    if (body.alsoLogChalani !== false) {
      if (!Array.isArray(db.dartaChalani)) db.dartaChalani = [];
      const seq = db.dartaChalani.filter((d) => d.entryType === "CHALANI").length + 1;
      const fyShort = (db.settings.activeFiscalYear || bsNow.fiscalYear).replace("FY ", "");
      db.dartaChalani.unshift({
        id: `dc-mlc-${Date.now()}`,
        entryType: "CHALANI",
        serialNo: seq,
        entryNumber: `CHALANI-${fyShort}-${String(seq).padStart(3, "0")}`,
        refNumber: `SHP-MLC-${bsNow.year}/${String(seq).padStart(3, "0")}`,
        fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
        entryDateAd: nowIso.slice(0, 10),
        entryDateBs: bsNow.formattedEn,
        partyName: erCase.policeStationName || detected.stationName,
        partyAddress: `${erCase.policeStationAddress || detected.stationAddress} (Ph: ${erCase.policeStationPhone || detected.stationPhone})`,
        subject: `Formal Police Intimation for ${erCase.mlcNumber} (${erCase.patientName} - ${erCase.mlcCaseType})`,
        category: "Police / MLC Correspondence",
        department: "Emergency & MLC Desk",
        handledBy: actor.fullName,
        documentBody: `Respected Officer-in-Charge,

Saptari Hospital Pvt Ltd, Bode Barsain hereby intimates that patient ${erCase.patientName} (${erCase.patientAge} ${erCase.patientAgeType}/${erCase.patientGender}) arrived at ER (${erCase.erNumber}) with ${erCase.mlcCaseType} from ${erCase.incidentPlace || erCase.patientAddress}.
Police Informed Ref #: ${erCase.policeInformedNumber} \xB7 Mode: ${erCase.policeInformMode} \xB7 Officer: ${erCase.policeOfficerName}.
Injury Summary: ${erCase.injurySummary || erCase.chiefComplaint}.`,
        attachments: [],
        status: "Verified / Dispatched",
        remarks: `Auto-logged from ER/MLC Police Intimation (${erCase.policeInformedNumber})`,
        recordedBy: actor.fullName
      });
    }
    appendAudit(
      db,
      actor,
      "EMERGENCY_MLC",
      "MLC_POLICE_INFORMED",
      erCase.mlcNumber,
      `Informed ${erCase.policeStationName} for MLC ${erCase.mlcNumber} (${erCase.patientName}). Informed Ref # ${erCase.policeInformedNumber} at ${bsNow.formattedEn} ${bsNow.timeEn}.`,
      "WARNING"
    );
    saveDb(db);
    res.json({ erCase, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/emergency/cases/:id/admit-ipd", withAuth("emergency.manage", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const erCase = (db.emergencyCases || []).find((e) => e.id === req.params.id);
    if (!erCase) {
      res.status(404).json({ error: "Emergency case not found." });
      return;
    }
    const { bedId, initialDepositNpr, depositPaymentMode } = req.body;
    const bed = (db.hospitalBeds || []).find((b) => b.id === bedId);
    if (!bed || bed.status !== "Available") {
      res.status(409).json({ error: "Selected hospital bed is not Available." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const admNo = `IPD-${bsNow.year}-${101 + (db.ipdAdmissions || []).length}`;
    const depositAmt = Math.max(0, Number(initialDepositNpr) || 0);
    const payMode = depositPaymentMode || "Cash";
    const deposits = [];
    if (depositAmt > 0) {
      const rcpNo = `IPD-RCP-${bsNow.year}-${201 + (db.ipdAdmissions || []).length}`;
      deposits.push({
        id: `dep-${Date.now()}`,
        timestamp: nowIso,
        amountNpr: depositAmt,
        paymentMode: payMode,
        receiptNumber: rcpNo,
        notes: `ER->IPD Admission Advance (${erCase.erNumber})`,
        receivedBy: actor.fullName
      });
    }
    const carriedConsents = [
      ...JSON.parse(JSON.stringify(erCase.consents || [])),
      ...autoAssignConsents({
        context: "IPD",
        caseCategory: erCase.isMlc ? "MLC / Trauma" : bed.wardType,
        wardName: bed.wardName,
        isMlc: erCase.isMlc,
        mlcType: erCase.mlcCaseType,
        patientName: erCase.patientName,
        guardianName: erCase.broughtByName,
        createdAt: nowIso
      }).filter((nc) => !(erCase.consents || []).some((ec) => ec.consentType === nc.consentType))
    ];
    const admission = {
      id: `ipd-${Date.now()}`,
      admissionNumber: admNo,
      fiscalYear: activeFy,
      admittedAt: nowIso,
      centerId: bed.centerId,
      centerName: bed.centerName,
      linkedEmergencyId: erCase.id,
      caseCategory: erCase.isMlc ? "MLC / Trauma" : bed.wardType === "ICU / HDU" ? "ICU / Critical" : bed.wardType === "Maternity" ? "Maternity / OBG" : bed.wardType === "NICU / Pediatric" ? "Pediatric / NICU" : "General Medical",
      patientName: erCase.patientName,
      patientAge: erCase.patientAge,
      patientAgeType: erCase.patientAgeType,
      patientGender: erCase.patientGender,
      patientPhone: erCase.patientPhone,
      patientAddress: erCase.patientAddress,
      emergencyContact: erCase.broughtByName ? `${erCase.broughtByName} (${erCase.broughtByPhone})` : "",
      admittingDoctor: erCase.attendingDoctor,
      department: bed.wardName,
      currentBedId: bed.id,
      currentBedLabel: bed.bedCode,
      currentWardName: bed.wardName,
      bedDailyRateNpr: bed.dailyRateNpr,
      admittingDiagnosis: `${erCase.chiefComplaint}${erCase.isMlc ? ` [MLC ${erCase.mlcNumber}]` : ""}`,
      finalDiagnosis: "",
      hospitalCourseSummary: `Admitted from Emergency (${erCase.erNumber}). ${erCase.clinicalNotes}`,
      vitalsOnAdmission: erCase.vitals,
      progressNotes: [
        {
          id: `pn-${Date.now()}`,
          timestamp: nowIso,
          note: `Transferred from ER (${erCase.erNumber}) to ${bed.wardName} Bed ${bed.bedCode}.`,
          recordedBy: actor.fullName
        }
      ],
      nursingCharts: [],
      consents: carriedConsents,
      bedTransfers: [],
      usedMedicines: [],
      investigationsDone: [],
      deposits,
      disposition: "Admitted",
      bedChargesNpr: bed.dailyRateNpr,
      medicinesTotalNpr: 0,
      investigationsTotalNpr: 0,
      otherProcedureChargesNpr: 0,
      totalBillNpr: 0,
      totalDepositPaidNpr: depositAmt,
      balanceDueNpr: 0
    };
    recalcIpdFinancials(admission, db.settings?.moduleSettings);
    bed.status = "Occupied";
    bed.currentAdmissionId = admission.id;
    bed.currentPatientName = admission.patientName;
    erCase.disposition = "Admitted to IPD";
    erCase.linkedIpdAdmissionId = admission.id;
    if (!Array.isArray(db.ipdAdmissions)) db.ipdAdmissions = [];
    db.ipdAdmissions.unshift(admission);
    appendAudit(
      db,
      actor,
      "EMERGENCY_MLC",
      "ER_ADMITTED_TO_IPD",
      admNo,
      `Admitted ER case ${erCase.erNumber} (${erCase.patientName}) to Bed ${bed.bedCode} with ${carriedConsents.length} consents.`
    );
    saveDb(db);
    res.status(201).json({ admission, erCase, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/darta-chalani", withAuth("darta.manage", "darta_chalani"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.partyName?.trim() || !body.subject?.trim()) {
      res.status(400).json({ error: "Party Name (Sender/Recipient) and Subject are required." });
      return;
    }
    if (!Array.isArray(db.dartaChalani)) db.dartaChalani = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const fyShort = activeFy.replace("FY ", "");
    const entryType = body.entryType === "DARTA" ? "DARTA" : "CHALANI";
    const serialNo = db.dartaChalani.filter((d) => d.entryType === entryType).length + 1;
    const prefix = entryType === "DARTA" ? "DRT" : "CH";
    const entry = {
      id: `dc-${Date.now()}`,
      entryType,
      serialNo,
      entryNumber: body.entryNumber?.trim() || `${entryType}-${fyShort}-${String(serialNo).padStart(3, "0")}`,
      refNumber: body.refNumber?.trim() || `SHP/${prefix}/${fyShort}/${String(serialNo).padStart(3, "0")}`,
      fiscalYear: activeFy,
      entryDateAd: body.entryDateAd || nowIso.slice(0, 10),
      entryDateBs: body.entryDateBs?.trim() || bsNow.formattedEn,
      partyName: body.partyName.trim(),
      partyAddress: body.partyAddress?.trim() || "Bode Barsain, Saptari, Nepal",
      subject: body.subject.trim(),
      category: body.category || "General Correspondence",
      department: body.department?.trim() || "Hospital Administration",
      handledBy: body.handledBy?.trim() || actor.fullName,
      documentBody: body.documentBody || "",
      attachments: body.attachments || [],
      status: body.status || "Verified / Dispatched",
      remarks: body.remarks?.trim() || "",
      recordedBy: actor.fullName
    };
    db.dartaChalani.unshift(entry);
    appendAudit(
      db,
      actor,
      "DARTA_CHALANI",
      `${entryType}_CREATED`,
      entry.entryNumber,
      `Logged ${entryType} ${entry.entryNumber} (Ref: ${entry.refNumber}) \u2014 ${entry.subject} [${entry.attachments.length} attachment(s)].`
    );
    saveDb(db);
    res.status(201).json({ entry, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/darta-chalani/:id", withAuth("darta.manage", "darta_chalani"), (req, res) => {
    const { db, actor } = req;
    const entry = (db.dartaChalani || []).find((d) => d.id === req.params.id);
    if (!entry) {
      res.status(404).json({ error: "Darta/Chalani record not found." });
      return;
    }
    Object.assign(entry, req.body);
    appendAudit(db, actor, "DARTA_CHALANI", "DARTA_CHALANI_UPDATED", entry.entryNumber, `Updated ${entry.entryType} ${entry.entryNumber} (${entry.status}).`);
    saveDb(db);
    res.json({ entry, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/darta-chalani/:id", withAuth("darta.manage", "darta_chalani"), (req, res) => {
    const { db, actor } = req;
    const idx = (db.dartaChalani || []).findIndex((d) => d.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Darta/Chalani record not found." });
      return;
    }
    const [removed] = db.dartaChalani.splice(idx, 1);
    appendAudit(db, actor, "DARTA_CHALANI", "DARTA_CHALANI_DELETED", removed.entryNumber, `Deleted ${removed.entryType} ${removed.entryNumber}.`, "WARNING");
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ai/compose-letter", withAuth(), async (req, res) => {
    const { db, actor } = req;
    const canCompose = hasPermission(db, actor.roleId, "darta.manage") || hasPermission(db, actor.roleId, "personnel.manage") || hasPermission(db, actor.roleId, "admin.control") || actor.roleId === "SUPER_ADMIN";
    if (!canCompose) {
      res.status(403).json({ error: "Access denied: Darta/Chalani or HR management permission required for AI letter composition." });
      return;
    }
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
      res.status(503).json({
        error: "GEMINI_API_KEY is not configured on the server environment (.env). Set GEMINI_API_KEY to enable AI-written official letters."
      });
      return;
    }
    const {
      documentKind = "CHALANI_LETTER",
      language = "English",
      partyName,
      partyAddress,
      subject,
      keyPoints,
      department,
      tone = "Formal Official",
      employeeDetails
    } = req.body;
    const hospitalName = db.settings.labName || "Saptari Hospital Pvt Ltd";
    const hospitalAddr = db.settings.addressLine || "Bode Barsain, Saptari, Nepal";
    const todayBs = adToBs((/* @__PURE__ */ new Date()).toISOString()).formattedEn;
    const systemPrompt = `You are the Official Executive Secretary & HR/Administrative Writer for "${hospitalName}" (${hospitalAddr}).
Today's BS Date: ${todayBs}.
Write clear, authoritative, print-ready hospital official correspondence and HR certificates suitable for Nepal healthcare and municipal/government administration.
Return ONLY valid JSON with two string fields:
{
  "subject": "Concise formal subject line",
  "documentBody": "Multi-paragraph formal letter body WITHOUT duplicating the hospital header/logo, ref number, or signature block (start directly from 'Respected Sir/Madam,' or 'To Whom It May Concern,' and end with closing salutation like 'Sincerely,')."
}`;
    const userPrompt = [
      `Document Type: ${documentKind}`,
      `Language: ${language}`,
      `Tone: ${tone}`,
      `Department: ${department || "Hospital Administration"}`,
      partyName ? `Recipient / Party Name: ${partyName}` : "",
      partyAddress ? `Recipient Address: ${partyAddress}` : "",
      subject ? `Requested Subject: ${subject}` : "",
      employeeDetails ? `Employee Profile: Name=${employeeDetails.fullName || ""}, Code=${employeeDetails.employeeCode || ""}, Designation=${employeeDetails.designation || ""}, Dept=${employeeDetails.department || ""}, Joined=${employeeDetails.joinedAt || ""}, RegNo=${employeeDetails.registrationNumber || "N/A"}, Shift=${employeeDetails.shift || ""}, GrossSalaryNPR=${employeeDetails.totalSalaryNpr || employeeDetails.basicSalaryNpr || ""}` : "",
      `Key Instructions / Points: ${keyPoints?.trim() || "Draft a complete, professional official hospital document matching standard Nepal hospital format."}`
    ].filter(Boolean).join("\n");
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } }
      });
      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: "application/json",
          temperature: 0.4
        }
      });
      const rawText = (response.text || "").trim();
      if (!rawText) {
        res.status(502).json({ error: "Gemini returned an empty response. Please try again with clearer instructions." });
        return;
      }
      let parsed = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        parsed = {
          subject: subject?.trim() || `Official ${documentKind}`,
          documentBody: rawText
        };
      }
      appendAudit(
        db,
        actor,
        "DARTA_CHALANI",
        "AI_LETTER_COMPOSED",
        documentKind,
        `AI composed ${documentKind} (${language}) for ${partyName || employeeDetails?.fullName || "Hospital Correspondence"}.`
      );
      saveDb(db);
      res.json({
        subject: (parsed.subject || subject || "").trim(),
        documentBody: (parsed.documentBody || rawText).trim()
      });
    } catch (err) {
      res.status(502).json({
        error: `AI letter generation failed: ${err?.message || "Unknown Gemini API error"}`
      });
    }
  });
  app.post("/api/certificates/birth", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.motherName?.trim()) {
      res.status(400).json({ error: "Mother Name is required for Birth Certificate." });
      return;
    }
    if (!Array.isArray(db.birthCertificates)) db.birthCertificates = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const cert = {
      id: `bcert-${Date.now()}`,
      certificateNumber: `SHP-BIRTH-${bsNow.year}-${String(db.birthCertificates.length + 1).padStart(3, "0")}`,
      fiscalYear: activeFy,
      issuedAt: nowIso,
      linkedIpdAdmissionId: body.linkedIpdAdmissionId,
      motherName: body.motherName.trim(),
      motherAge: Number(body.motherAge) || 24,
      motherCitizenshipNo: body.motherCitizenshipNo?.trim() || "",
      fatherName: body.fatherName?.trim() || "\u2014",
      fatherCitizenshipNo: body.fatherCitizenshipNo?.trim() || "",
      permanentAddress: body.permanentAddress?.trim() || "Bode Barsain, Saptari, Nepal",
      babyName: body.babyName?.trim() || `Baby of ${body.motherName.trim()}`,
      babyGender: body.babyGender || "Male",
      birthDateAd: body.birthDateAd || nowIso.slice(0, 10),
      birthDateBs: body.birthDateBs?.trim() || bsNow.formattedEn,
      birthTime: body.birthTime?.trim() || bsNow.timeEn,
      birthWeightKg: Number(body.birthWeightKg) || 3,
      deliveryType: body.deliveryType || "Normal Vaginal Delivery",
      apgar1Min: Number(body.apgar1Min) || 8,
      apgar5Min: Number(body.apgar5Min) || 9,
      placeOfBirth: body.placeOfBirth?.trim() || "Saptari Hospital Pvt Ltd, Bode Barsain (Saptari, Nepal)",
      attendingDoctor: body.attendingDoctor?.trim() || actor.fullName,
      issuedBy: actor.fullName
    };
    db.birthCertificates.unshift(cert);
    appendAudit(db, actor, "CERTIFICATES", "BIRTH_CERTIFICATE_ISSUED", cert.certificateNumber, `Issued Birth Certificate ${cert.certificateNumber} (${cert.babyName}, ${cert.birthWeightKg} kg).`);
    saveDb(db);
    res.status(201).json({ certificate: cert, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/certificates/death", withAuth("hospital.clinical", "hospital_opd_ipd"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.deceasedName?.trim() || !body.immediateCauseOfDeath?.trim()) {
      res.status(400).json({ error: "Deceased Name and Immediate Cause of Death are required." });
      return;
    }
    if (!Array.isArray(db.deathCertificates)) db.deathCertificates = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const activeFy = db.settings.activeFiscalYear || bsNow.fiscalYear;
    const cert = {
      id: `dcert-${Date.now()}`,
      certificateNumber: `SHP-DEATH-${bsNow.year}-${String(db.deathCertificates.length + 1).padStart(3, "0")}`,
      fiscalYear: activeFy,
      issuedAt: nowIso,
      linkedIpdAdmissionId: body.linkedIpdAdmissionId,
      linkedEmergencyId: body.linkedEmergencyId,
      deceasedName: body.deceasedName.trim(),
      age: Number(body.age) || 60,
      ageType: body.ageType || "Years",
      gender: body.gender || "Male",
      citizenshipNo: body.citizenshipNo?.trim() || "",
      fatherOrSpouseName: body.fatherOrSpouseName?.trim() || "\u2014",
      permanentAddress: body.permanentAddress?.trim() || "Bode Barsain, Saptari, Nepal",
      deathDateAd: body.deathDateAd || nowIso.slice(0, 10),
      deathDateBs: body.deathDateBs?.trim() || bsNow.formattedEn,
      deathTime: body.deathTime?.trim() || bsNow.timeEn,
      wardOrPlaceOfDeath: body.wardOrPlaceOfDeath?.trim() || "Saptari Hospital Pvt Ltd, Bode Barsain",
      immediateCauseOfDeath: body.immediateCauseOfDeath.trim(),
      antecedentCause: body.antecedentCause?.trim() || "",
      mannerOfDeath: body.mannerOfDeath || "Natural",
      isMlc: Boolean(body.isMlc),
      mlcNumber: body.mlcNumber?.trim() || void 0,
      policeStationNotified: body.policeStationNotified?.trim() || void 0,
      bodyHandedOverTo: body.bodyHandedOverTo?.trim() || "Next of Kin",
      handoverRelation: body.handoverRelation?.trim() || "Family Member",
      handoverPhone: body.handoverPhone?.trim() || "",
      certifyingDoctor: body.certifyingDoctor?.trim() || actor.fullName,
      doctorRegNo: body.doctorRegNo?.trim() || actor.registrationNumber || "NMC-8412",
      issuedBy: actor.fullName
    };
    db.deathCertificates.unshift(cert);
    appendAudit(db, actor, "CERTIFICATES", "DEATH_CERTIFICATE_ISSUED", cert.certificateNumber, `Issued Death Certificate ${cert.certificateNumber} (${cert.deceasedName} \u2014 ${cert.immediateCauseOfDeath}).`, "WARNING");
    saveDb(db);
    res.status(201).json({ certificate: cert, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/dhis2/generate", withAuth("dhis2.manage", "dhis2_hmis"), (req, res) => {
    const { db, actor } = req;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const {
      bsYear = bsNow.year,
      bsMonthIndex = bsNow.month,
      bsMonthName = bsNow.monthNameEn,
      preparedBy
    } = req.body || {};
    if (!Array.isArray(db.dhis2Reports)) db.dhis2Reports = [];
    const opdVisits = db.opdVisits || [];
    const erCases = db.emergencyCases || [];
    const ipdAdms = db.ipdAdmissions || [];
    const beds = db.hospitalBeds || [];
    const labOrders = db.orders || [];
    const births = db.birthCertificates || [];
    const deaths = db.deathCertificates || [];
    const phmInvoices = db.pharmacyInvoices || [];
    const phmMeds = db.pharmacyMedicines || [];
    const phmBatches = db.pharmacyBatches || [];
    const opdNewFemale = opdVisits.filter((v) => v.patientGender === "Female").length;
    const opdNewMale = opdVisits.filter((v) => v.patientGender === "Male").length;
    const opdFollowupTotal = opdVisits.filter((v) => v.disposition === "Discharged Home").length;
    const emergencyTotalVisits = erCases.length;
    const emergencyMlcCases = erCases.filter((e) => e.isMlc).length;
    const ipdTotalAdmissions = ipdAdms.length;
    const ipdTotalBedsAvailable = beds.length;
    const occupiedBeds = beds.filter((b) => b.status === "Occupied").length;
    const ipdBedOccupancyPercent = ipdTotalBedsAvailable > 0 ? Math.round(occupiedBeds / ipdTotalBedsAvailable * 100) : 0;
    const ipdTotalBedDays = Math.max(
      ipdTotalAdmissions,
      ipdAdms.reduce((s, a) => s + Math.max(1, Math.round((a.bedChargesNpr || 0) / Math.max(1, a.bedDailyRateNpr || 1200))), 0)
    );
    const ipdDischargedHome = ipdAdms.filter((a) => a.disposition === "Discharged").length;
    const ipdReferredOut = ipdAdms.filter((a) => a.disposition === "Referred to External Hospital").length + opdVisits.filter((v) => v.disposition === "Referred to External Hospital").length + erCases.filter((e) => e.disposition === "Referred to External Hospital").length;
    const ipdLamaCases = ipdAdms.filter((a) => a.disposition === "LAMA / DOR").length;
    const normalDeliveries = births.filter((b) => b.deliveryType === "Normal Vaginal Delivery").length;
    const cesareanDeliveries = births.filter((b) => b.deliveryType === "LSCS (Cesarean Section)").length;
    const liveBirthsMale = births.filter((b) => b.babyGender === "Male").length;
    const liveBirthsFemale = births.filter((b) => b.babyGender === "Female").length;
    const lowBirthWeightCount = births.filter((b) => (b.birthWeightKg || 0) > 0 && b.birthWeightKg < 2.5).length;
    const institutionalDeaths = deaths.length;
    const neonatalDeaths = deaths.filter((d) => d.ageType === "Days" && d.age <= 28).length;
    const pathologyTestsDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.serviceCategory !== "RADIOLOGY").length,
      0
    );
    const xrayStudiesDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.modality === "X-RAY").length,
      0
    );
    const usgEchoDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.modality === "USG" || t.modality === "ECHO").length,
      0
    );
    const ctEcgDone = labOrders.reduce(
      (s, o) => s + o.tests.filter((t) => t.modality === "CT" || t.modality === "ECG").length,
      0
    );
    const pharmacyStockoutItemsCount = phmMeds.filter(
      (m) => phmBatches.filter((b) => b.medicineId === m.id && !b.quarantined).reduce((sum, b) => sum + b.quantityOnHand, 0) <= 0
    ).length;
    const matchDiag = (kw) => {
      const allText = [
        ...opdVisits.map((v) => `${v.chiefComplaint} ${v.provisionalDiagnosis}`),
        ...erCases.map((e) => `${e.chiefComplaint} ${e.mlcCaseType || ""}`),
        ...ipdAdms.map((a) => `${a.admittingDiagnosis} ${a.finalDiagnosis}`)
      ];
      return allText.filter((t) => kw.some((k) => t.toLowerCase().includes(k))).length;
    };
    const report = {
      id: `dhis-${Date.now()}`,
      reportCode: `DHIS2-SHP-${bsYear}-${String(bsMonthIndex).padStart(2, "0")}`,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      bsYear: Number(bsYear),
      bsMonthIndex: Number(bsMonthIndex),
      bsMonthName,
      generatedAt: nowIso,
      municipalityTargetName: "Health Section, Bode Barsain Municipality, Saptari, Nepal",
      status: "Draft",
      opdNewFemale,
      opdNewMale,
      opdFollowupTotal,
      emergencyTotalVisits,
      emergencyMlcCases,
      ipdTotalAdmissions,
      ipdTotalBedDays,
      ipdTotalBedsAvailable,
      ipdBedOccupancyPercent,
      ipdDischargedHome,
      ipdReferredOut,
      ipdLamaCases,
      normalDeliveries,
      cesareanDeliveries,
      liveBirthsMale,
      liveBirthsFemale,
      lowBirthWeightCount,
      institutionalDeaths,
      maternalDeaths: 0,
      neonatalDeaths,
      pathologyTestsDone,
      xrayStudiesDone,
      usgEchoDone,
      ctEcgDone,
      morbidityAriPneumonia: matchDiag(["ari", "pneumonia", "cough", "respiratory", "copd"]),
      morbidityDiarrheaDysentery: matchDiag(["diarrh", "gastro", "age", "dysentery"]),
      morbidityHypertensionCvd: matchDiag(["hypertens", "stemi", "cardiac", "heart", "bp"]),
      morbidityDiabetes: matchDiag(["diabet", "sugar", "hba1c"]),
      morbidityTraumaRta: matchDiag(["rta", "road traffic", "trauma", "fracture", "assault", "injury"]),
      morbidityEntericFever: matchDiag(["fever", "typhoid", "enteric", "dengue", "sepsis"]),
      pharmacyStockoutItemsCount,
      pharmacyBillsIssued: phmInvoices.length,
      remarks: "Generated offline from Saptari Hospital ERP clinical registers (Zero external API dependency) for 2-Paper Municipality Health Section submission.",
      preparedBy: preparedBy?.trim() || actor.fullName,
      approvedByDoctor: "Dr. Santosh Majhi (Medical Director)"
    };
    db.dhis2Reports.unshift(report);
    appendAudit(
      db,
      actor,
      "DHIS2_HMIS",
      "DHIS2_OFFLINE_GENERATED",
      report.reportCode,
      `Generated offline DHIS2 HMIS report ${report.reportCode} (${bsMonthName} ${bsYear}) for Bode Barsain Municipality Health Section.`
    );
    saveDb(db);
    res.status(201).json({ report, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/dhis2/:id", withAuth("dhis2.manage", "dhis2_hmis"), (req, res) => {
    const { db, actor } = req;
    const report = (db.dhis2Reports || []).find((r) => r.id === req.params.id);
    if (!report) {
      res.status(404).json({ error: "DHIS2 HMIS report not found." });
      return;
    }
    Object.assign(report, req.body);
    appendAudit(
      db,
      actor,
      "DHIS2_HMIS",
      "DHIS2_REPORT_UPDATED",
      report.reportCode,
      `Updated DHIS2 HMIS ${report.reportCode} (${report.status}${report.municipalityReceiptNo ? ` \xB7 Receipt: ${report.municipalityReceiptNo}` : ""}).`
    );
    saveDb(db);
    res.json({ report, db: scopeDbForActor(db, actor) });
  });
  app.put("/api/rbac", withAuth("rbac.manage"), (req, res) => {
    const { db, actor } = req;
    const { roleId, permissions } = req.body;
    const role = db.roles.find((r) => r.id === roleId);
    if (!role) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    if (roleId === "SUPER_ADMIN" && (!permissions.includes("rbac.manage") || !permissions.includes("admin.control"))) {
      res.status(400).json({ error: "Hospital Admin (SUPER_ADMIN) must retain rbac.manage and admin.control." });
      return;
    }
    const sanitizedPermissions = roleId === "LAB_TECH" ? [...LAB_TECH_STRICT_PERMISSIONS] : roleId === "SUPER_ADMIN" || roleId === "SAAS_ADMIN" ? permissions : permissions.filter((p) => p !== "settings.manage");
    role.permissions = sanitizedPermissions;
    appendAudit(
      db,
      actor,
      "RBAC",
      "ROLE_PERMISSIONS_MODIFIED",
      roleId,
      `Updated permission policy for ${role.name} (${sanitizedPermissions.length} active permissions).`,
      "WARNING"
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });
  app.post("/api/rbac/roles", withAuth("rbac.manage"), (req, res) => {
    const { db, actor } = req;
    const { id, name, description, permissions, assignedModuleKeys } = req.body;
    if (!name?.trim()) {
      res.status(400).json({ error: "Role name is required." });
      return;
    }
    const cleanId = (id?.trim() || `CUSTOM_${name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28)}`).toUpperCase();
    if (!cleanId || cleanId.length < 3) {
      res.status(400).json({ error: "Role ID / Code must be at least 3 alphanumeric characters." });
      return;
    }
    if (db.roles.some((r) => r.id.toUpperCase() === cleanId)) {
      res.status(400).json({ error: `Role code '${cleanId}' already exists.` });
      return;
    }
    const perms = Array.from(/* @__PURE__ */ new Set(["dashboard.view", ...permissions || []]));
    const newRole = {
      id: cleanId,
      name: name.trim(),
      description: description?.trim() || `Custom hospital role (${perms.length} permissions)`,
      permissions: perms,
      isCustom: true,
      assignedModuleKeys: Array.isArray(assignedModuleKeys) ? assignedModuleKeys : [],
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.roles.push(newRole);
    if (db.saas) {
      if (!Array.isArray(db.saas.allowedRoleIds)) db.saas.allowedRoleIds = [];
      if (!db.saas.allowedRoleIds.includes(newRole.id)) {
        db.saas.allowedRoleIds.push(newRole.id);
      }
      db.saas.maxRolesCapacity = Math.max(db.saas.maxRolesCapacity || 12, db.roles.length + 5);
    }
    if (!db.dashboardLayoutConfigs) db.dashboardLayoutConfigs = { ...DEFAULT_DASHBOARD_LAYOUT_CONFIGS };
    db.dashboardLayoutConfigs[newRole.id] = {
      roleId: newRole.id,
      title: `${newRole.name} \u2014 Workspace`,
      subtitle: newRole.description,
      widgets: ["EXECUTIVE_SUMMARY", "PRIORITY_ALERTS", "KPI_GRID", "CLINICAL_OPS", "SHIFT_HANDOVER"]
    };
    appendAudit(
      db,
      actor,
      "RBAC",
      "CUSTOM_ROLE_CREATED",
      newRole.id,
      `Created custom role "${newRole.name}" (${newRole.id}) with ${perms.length} permissions across ${newRole.assignedModuleKeys.length} module(s).`,
      "WARNING"
    );
    saveDb(db);
    res.status(201).json({ role: newRole, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/rbac/roles/:roleId", withAuth("rbac.manage"), (req, res) => {
    const { db, actor } = req;
    const roleId = req.params.roleId;
    const role = db.roles.find((r) => r.id === roleId);
    if (!role) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    const { name, description, permissions, assignedModuleKeys } = req.body;
    if (name?.trim()) role.name = name.trim();
    if (description !== void 0) role.description = description.trim();
    if (Array.isArray(assignedModuleKeys)) role.assignedModuleKeys = assignedModuleKeys;
    if (Array.isArray(permissions)) {
      if (role.id === "SUPER_ADMIN" && (!permissions.includes("rbac.manage") || !permissions.includes("admin.control"))) {
        res.status(400).json({ error: "Hospital Admin (SUPER_ADMIN) must retain rbac.manage and admin.control." });
        return;
      }
      role.permissions = role.id === "LAB_TECH" ? [...LAB_TECH_STRICT_PERMISSIONS] : role.id === "SUPER_ADMIN" || role.id === "SAAS_ADMIN" ? Array.from(new Set(permissions)) : Array.from(new Set(permissions)).filter((p) => p !== "settings.manage");
    }
    if (db.dashboardLayoutConfigs?.[role.id]) {
      db.dashboardLayoutConfigs[role.id].title = `${role.name} \u2014 Workspace`;
      db.dashboardLayoutConfigs[role.id].subtitle = role.description;
    }
    appendAudit(
      db,
      actor,
      "RBAC",
      "ROLE_UPDATED",
      role.id,
      `Updated role "${role.name}" (${role.permissions.length} permissions).`,
      "WARNING"
    );
    saveDb(db);
    res.json({ role, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/rbac/roles/:roleId", withAuth("rbac.manage"), (req, res) => {
    const { db, actor } = req;
    const roleId = req.params.roleId;
    const idx = db.roles.findIndex((r) => r.id === roleId);
    if (idx < 0) {
      res.status(404).json({ error: "Role not found." });
      return;
    }
    const role = db.roles[idx];
    if (roleId === "SUPER_ADMIN" || roleId === "SAAS_ADMIN") {
      res.status(400).json({ error: "Core Hospital Admin role cannot be deleted." });
      return;
    }
    const assignedCount = db.staff.filter((s) => s.roleId === roleId).length;
    if (assignedCount > 0) {
      res.status(400).json({
        error: `Cannot delete role "${role.name}" because ${assignedCount} staff account(s) are currently assigned to it. Reassign those staff first.`
      });
      return;
    }
    db.roles.splice(idx, 1);
    if (db.saas?.allowedRoleIds) {
      db.saas.allowedRoleIds = db.saas.allowedRoleIds.filter((id) => id !== roleId);
    }
    if (db.dashboardLayoutConfigs?.[roleId]) {
      delete db.dashboardLayoutConfigs[roleId];
    }
    appendAudit(db, actor, "RBAC", "CUSTOM_ROLE_DELETED", roleId, `Deleted custom role "${role.name}" (${roleId}).`, "WARNING");
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.put("/api/settings", withAuth("settings.manage"), (req, res) => {
    const { db, actor } = req;
    if (actor.roleId !== "SUPER_ADMIN" && actor.roleId !== "SAAS_ADMIN") {
      res.status(403).json({ error: "Access denied: Only Hospital Admin may change System Settings." });
      return;
    }
    const incomingModuleSettings = req.body.moduleSettings;
    const prevMs = db.settings.moduleSettings || {};
    db.settings = {
      ...db.settings,
      ...req.body,
      moduleSettings: {
        ...prevMs,
        ...incomingModuleSettings || {},
        printOptions: {
          ...prevMs.printOptions || {},
          ...incomingModuleSettings?.printOptions || {},
          autoPrintByTemplate: {
            ...prevMs.printOptions?.autoPrintByTemplate || {},
            ...incomingModuleSettings?.printOptions?.autoPrintByTemplate || {}
          }
        },
        signatureBoxes: Array.isArray(incomingModuleSettings?.signatureBoxes) ? incomingModuleSettings.signatureBoxes : Array.isArray(prevMs.signatureBoxes) ? prevMs.signatureBoxes : []
      }
    };
    for (const adm of db.ipdAdmissions || []) {
      if (adm.disposition === "Admitted") {
        recalcIpdFinancials(adm, db.settings.moduleSettings);
      }
    }
    appendAudit(
      db,
      actor,
      "SETTINGS",
      "SYSTEM_SETTINGS_UPDATED",
      "HOSPITAL-CONFIG",
      `Updated Hospital settings & print defaults (Hospital: ${db.settings.labName}, FY: ${db.settings.activeFiscalYear}, Default Paper: ${db.settings.moduleSettings?.printOptions?.defaultPaperSize || "A5"}).`
    );
    saveDb(db);
    res.json({ db: scopeDbForActor(db, actor) });
  });
  app.get("/api/system/backup-snapshot", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (!hasPermission(db, actor.roleId, "settings.manage") && !hasPermission(db, actor.roleId, "finance.view")) {
      res.status(403).json({ error: "Access denied for system backup snapshot." });
      return;
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="saptari-hospital-backup-${stamp}.json"`);
    res.send(JSON.stringify({ exportedAt: (/* @__PURE__ */ new Date()).toISOString(), hospital: db.settings.labName, database: db }, null, 2));
  });
  app.get("/api/system/local-backups", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "settings.manage") && !hasPermission(db, actor.roleId, "finance.view")) {
      res.status(403).json({ error: "Access denied for server backup history." });
      return;
    }
    res.json({ backups: listLocalBackups() });
  });
  app.post("/api/system/local-backups", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "settings.manage") && !hasPermission(db, actor.roleId, "finance.view")) {
      res.status(403).json({ error: "Access denied for creating server backups." });
      return;
    }
    const body = req.body || {};
    const created = createLocalBackup(body.label || "manual");
    appendAudit(
      db,
      actor,
      "SETTINGS",
      "LOCAL_DISK_BACKUP_CREATED",
      created.filename,
      `Created rotating server disk backup (${created.filename}, ${Math.round(created.sizeBytes / 1024)} KB).`
    );
    saveDb(db);
    res.status(201).json({ backup: created, backups: listLocalBackups() });
  });
  app.get("/api/system/local-backups/:filename", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (!hasPermission(db, actor.roleId, "settings.manage") && !hasPermission(db, actor.roleId, "finance.view")) {
      res.status(403).json({ error: "Access denied to download server backup." });
      return;
    }
    try {
      const cleanName = path2.basename(req.params.filename || "");
      const file = readLocalBackup(cleanName);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${cleanName}"`);
      res.send(file.rawText);
    } catch (err) {
      res.status(404).json({ error: err?.message || "Backup file not found." });
    }
  });
  app.delete("/api/system/local-backups/:filename", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin (SUPER_ADMIN) can delete server disk backups." });
      return;
    }
    try {
      const cleanName = path2.basename(req.params.filename || "");
      deleteLocalBackup(cleanName);
      appendAudit(
        db,
        actor,
        "SETTINGS",
        "LOCAL_DISK_BACKUP_DELETED",
        cleanName,
        `Deleted server disk backup ${cleanName}.`,
        "WARNING"
      );
      saveDb(db);
      res.json({ ok: true, backups: listLocalBackups() });
    } catch (err) {
      res.status(404).json({ error: err?.message || "Backup file not found." });
    }
  });
  app.post("/api/system/restore-snapshot", withAuth(), (req, res) => {
    const { actor } = req;
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin (SUPER_ADMIN) can restore hospital backups." });
      return;
    }
    const body = req.body || {};
    try {
      let candidate = body.database;
      let resolvedSource = body.sourceLabel || "Uploaded Backup Snapshot";
      if (body.backupFilename && !candidate) {
        const cleanName = path2.basename(body.backupFilename);
        const file = readLocalBackup(cleanName);
        const parsed = JSON.parse(file.rawText);
        candidate = parsed?.database || parsed;
        resolvedSource = `Server Disk Backup (${cleanName})`;
      } else if (candidate && candidate.database && candidate.database.settings) {
        candidate = candidate.database;
      }
      const restored = restoreDbFromSnapshot(candidate);
      appendAudit(
        restored.db,
        actor,
        "SETTINGS",
        "DATABASE_SNAPSHOT_RESTORED",
        restored.safetyBackup.filename,
        `Restored full hospital database from ${resolvedSource}. Pre-restore safety snapshot saved as ${restored.safetyBackup.filename}.`,
        "CRITICAL"
      );
      saveDb(restored.db);
      res.json({
        ok: true,
        safetyBackup: restored.safetyBackup,
        backups: listLocalBackups(),
        db: scopeDbForActor(restored.db, actor)
      });
    } catch (err) {
      res.status(400).json({ error: err?.message || "Invalid backup snapshot payload." });
    }
  });
  app.post("/api/patients", withAuth("orders.create"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.fullName?.trim()) {
      res.status(400).json({ error: "Patient full name is required." });
      return;
    }
    const created = upsertPatientMaster(db, {
      uhid: body.uhid,
      fullName: body.fullName,
      age: Number(body.age) || 30,
      ageType: body.ageType || "Years",
      gender: body.gender || "Male",
      phone: body.phone,
      address: body.address,
      email: body.email,
      actorName: actor.fullName
    });
    if (body.bloodGroup) created.bloodGroup = body.bloodGroup;
    if (body.allergies) created.allergies = body.allergies;
    if (body.pastMedicalHistory || body.chronicHistory) {
      created.pastMedicalHistory = body.pastMedicalHistory || body.chronicHistory;
    }
    appendAudit(db, actor, "OPD_IPD", "PATIENT_REGISTERED", created.uhid, `Registered patient ${created.fullName} (${created.uhid}).`);
    saveDb(db);
    res.status(201).json({ patient: created, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/patients/:id", withAuth("patients.manage"), (req, res) => {
    const { db, actor } = req;
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin (SUPER_ADMIN) can edit Patient Master records." });
      return;
    }
    const pat = (db.patients || []).find((p) => p.id === req.params.id);
    if (!pat) {
      res.status(404).json({ error: "Patient record not found." });
      return;
    }
    Object.assign(pat, req.body);
    appendAudit(db, actor, "OPD_IPD", "PATIENT_UPDATED", pat.uhid, `Admin updated Patient Master record ${pat.fullName} (${pat.uhid}).`, "WARNING");
    saveDb(db);
    res.json({ patient: pat, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/patients/:id", withAuth("patients.manage"), (req, res) => {
    const { db, actor } = req;
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Only Hospital Admin (SUPER_ADMIN) can delete Patient Master records." });
      return;
    }
    const idx = (db.patients || []).findIndex((p) => p.id === req.params.id);
    if (idx < 0) {
      res.status(404).json({ error: "Patient record not found." });
      return;
    }
    const [removed] = db.patients.splice(idx, 1);
    appendAudit(db, actor, "OPD_IPD", "PATIENT_DELETED", removed.uhid, `Admin deleted patient record ${removed.fullName} (${removed.uhid}).`, "CRITICAL");
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/gatepasses", withAuth("gatepass.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.personName?.trim() || !body.purpose?.trim()) {
      res.status(400).json({ error: "Person name and purpose are required." });
      return;
    }
    if (!Array.isArray(db.gatepasses)) db.gatepasses = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const pfx = db.settings?.moduleSettings?.gatepassPrefix || "GP";
    const gp = {
      id: `gp-${Date.now()}`,
      passNumber: `${pfx}-${bsNow.year}-${String(db.gatepasses.length + 1).padStart(3, "0")}`,
      fiscalYear: db.settings.activeFiscalYear,
      passType: body.passType || "VISITOR",
      personName: body.personName.trim(),
      phone: body.phone?.trim() || "",
      purpose: body.purpose.trim(),
      departmentOrWard: body.departmentOrWard?.trim() || "Main Hospital Ward",
      linkedPatientOrRef: body.linkedPatientOrRef?.trim() || "",
      vehicleOrBagInfo: body.vehicleOrBagInfo?.trim() || "",
      validUntil: body.validUntil?.trim() || "Today 20:00",
      issuedAt: nowIso,
      issuedBy: actor.fullName,
      status: "Active"
    };
    db.gatepasses.unshift(gp);
    appendAudit(db, actor, "OPD_IPD", "GATEPASS_ISSUED", gp.passNumber, `Issued ${gp.passType} ${gp.passNumber} for ${gp.personName}.`);
    saveDb(db);
    res.status(201).json({ gatepass: gp, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/gatepasses/:id/clear", withAuth("gatepass.manage"), (req, res) => {
    const { db, actor } = req;
    const gp = (db.gatepasses || []).find((g) => g.id === req.params.id);
    if (!gp) {
      res.status(404).json({ error: "Gatepass not found." });
      return;
    }
    gp.status = "Cleared / Exited";
    gp.clearanceVerifiedBy = actor.fullName;
    appendAudit(db, actor, "OPD_IPD", "GATEPASS_CLEARED", gp.passNumber, `Cleared ${gp.passType} ${gp.passNumber} (${gp.personName}).`);
    saveDb(db);
    res.json({ gatepass: gp, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/attendance/punch", withAuth(), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    const targetStaff = body.targetStaffId && db.staff.find((s) => s.id === body.targetStaffId) || actor;
    if (!Array.isArray(db.attendanceLogs)) db.attendanceLogs = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const punch = {
      id: `att-${Date.now()}`,
      staffId: targetStaff.id,
      staffName: targetStaff.fullName,
      employeeCode: targetStaff.employeeCode,
      department: targetStaff.department,
      timestamp: nowIso,
      bsDate: bsNow.formattedEn,
      mode: body.mode || "QR_SCAN",
      deviceIdOrIp: body.deviceIdOrIp?.trim() || req.ip || "HOSP-QR-GATE-01",
      punchType: body.punchType || "CHECK_IN",
      shiftLabel: body.shiftLabel || targetStaff.shift || "Morning",
      verificationCode: body.verificationCode || `VER-${Date.now().toString().slice(-4)}`
    };
    db.attendanceLogs.unshift(punch);
    appendAudit(db, actor, "PERSONNEL", "ATTENDANCE_PUNCHED", targetStaff.employeeCode, `${targetStaff.fullName} ${punch.punchType} via ${punch.mode} (${punch.shiftLabel}).`);
    saveDb(db);
    res.status(201).json({ punch, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/attendance/override", withAuth("personnel.manage", "hr_payroll"), (req, res) => {
    const { db, actor } = req;
    const { punchId, staffId, punchType, timestamp, shiftLabel, reason } = req.body;
    if (!reason?.trim()) {
      res.status(400).json({ error: "HR manual override requires a clear audit reason." });
      return;
    }
    if (!Array.isArray(db.attendanceLogs)) db.attendanceLogs = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const targetTimestamp = timestamp?.trim() ? new Date(timestamp).toISOString() : nowIso;
    const bsDate = adToBs(targetTimestamp).formattedEn;
    if (punchId) {
      const existing = db.attendanceLogs.find((p) => p.id === punchId);
      if (!existing) {
        res.status(404).json({ error: "Attendance log entry not found." });
        return;
      }
      if (!existing.originalTimestamp) existing.originalTimestamp = existing.timestamp;
      existing.timestamp = targetTimestamp;
      existing.bsDate = bsDate;
      if (punchType) existing.punchType = punchType;
      if (shiftLabel) existing.shiftLabel = shiftLabel;
      existing.isManualOverride = true;
      existing.overrideReason = reason.trim();
      existing.overriddenBy = actor.fullName;
      existing.overriddenAt = nowIso;
      appendAudit(
        db,
        actor,
        "PERSONNEL",
        "ATTENDANCE_HR_OVERRIDE",
        existing.employeeCode,
        `HR adjusted attendance punch for ${existing.staffName} (${existing.originalTimestamp} -> ${existing.timestamp}). Reason: ${reason.trim()}`,
        "WARNING"
      );
      saveDb(db);
      res.json({ punch: existing, db: scopeDbForActor(db, actor) });
      return;
    }
    const staff = db.staff.find((s) => s.id === staffId);
    if (!staff) {
      res.status(400).json({ error: "Staff member is required for a new HR manual attendance record." });
      return;
    }
    const created = {
      id: `att-ovr-${Date.now()}`,
      staffId: staff.id,
      staffName: staff.fullName,
      employeeCode: staff.employeeCode,
      department: staff.department,
      timestamp: targetTimestamp,
      bsDate,
      mode: "ADMIN_MANUAL",
      deviceIdOrIp: "HR-OVERRIDE-DESK",
      punchType: punchType || "CHECK_IN",
      shiftLabel: shiftLabel || staff.shift || "Morning",
      verificationCode: `OVR-${Date.now().toString().slice(-4)}`,
      isManualOverride: true,
      overrideReason: reason.trim(),
      overriddenBy: actor.fullName,
      overriddenAt: nowIso
    };
    db.attendanceLogs.unshift(created);
    appendAudit(
      db,
      actor,
      "PERSONNEL",
      "ATTENDANCE_HR_OVERRIDE",
      staff.employeeCode,
      `HR recorded manual ${created.punchType} override for ${staff.fullName} at ${created.timestamp}. Reason: ${reason.trim()}`,
      "WARNING"
    );
    saveDb(db);
    res.status(201).json({ punch: created, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/attendance/hikvision-sync", withAuth("personnel.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body || {};
    const ms = db.settings?.moduleSettings;
    const deviceIp = body.deviceIp || `${ms?.hikvisionDeviceIp || "192.168.1.210"}:${ms?.hikvisionDevicePort || 80}`;
    if (!Array.isArray(db.attendanceLogs)) db.attendanceLogs = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const staffList = body.staffId ? db.staff.filter((s) => s.id === body.staffId) : db.staff.slice(0, 3);
    const added = [];
    for (const st of staffList) {
      const rec = {
        id: `hik-${Date.now()}-${st.id}`,
        staffId: st.id,
        staffName: st.fullName,
        employeeCode: st.employeeCode,
        department: st.department,
        timestamp: nowIso,
        bsDate: bsNow.formattedEn,
        mode: "HIKVISION_BIOMETRIC",
        deviceIdOrIp: `ISAPI@${deviceIp}`,
        punchType: body.punchType || "CHECK_IN",
        shiftLabel: st.shift || "Morning",
        verificationCode: `HIK-${Math.floor(1e3 + Math.random() * 8999)}`
      };
      db.attendanceLogs.unshift(rec);
      added.push(rec);
    }
    appendAudit(db, actor, "PERSONNEL", "HIKVISION_ISAPI_SYNCED", deviceIp, `Synced ${added.length} Hikvision biometric log(s) from ${deviceIp}.`);
    saveDb(db);
    res.status(201).json({ syncedCount: added.length, added, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/handovers", withAuth(), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.summaryNotes?.trim()) {
      res.status(400).json({ error: "Shift handover summary notes are required." });
      return;
    }
    if (!Array.isArray(db.shiftHandovers)) db.shiftHandovers = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const ho = {
      id: `ho-${Date.now()}`,
      handoverNumber: `HO-${bsNow.year}-${String(db.shiftHandovers.length + 1).padStart(3, "0")}`,
      createdAt: nowIso,
      bsDate: bsNow.formattedEn,
      fromShift: body.fromShift || actor.shift || "Morning",
      toShift: body.toShift || "Afternoon",
      department: body.department?.trim() || actor.department,
      outgoingStaffId: actor.id,
      outgoingStaffName: actor.fullName,
      incomingStaffId: body.incomingStaffId,
      incomingStaffName: body.incomingStaffName?.trim() || "Next Shift Duty Staff",
      summaryNotes: body.summaryNotes.trim(),
      pendingTasks: body.pendingTasks?.trim() || "None",
      cashOrKeysCount: body.cashOrKeysCount?.trim() || "All keys & ward register handed over",
      status: "SENT",
      auditTrail: [
        {
          id: `ho-aud-${Date.now()}`,
          timestamp: nowIso,
          action: "SUBMITTED",
          actorName: actor.fullName,
          note: `Submitted handover for ${body.toShift || "next"} shift (${body.pendingTasks?.trim() || "No pending items"}).`
        }
      ]
    };
    db.shiftHandovers.unshift(ho);
    appendAudit(db, actor, "PERSONNEL", "SHIFT_HANDOVER_SENT", ho.handoverNumber, `${actor.fullName} submitted shift handover ${ho.handoverNumber} (${ho.fromShift} -> ${ho.toShift}).`);
    saveDb(db);
    res.status(201).json({ handover: ho, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/handovers/:id/respond", withAuth(), (req, res) => {
    const { db, actor } = req;
    const ho = (db.shiftHandovers || []).find((h) => h.id === req.params.id);
    if (!ho) {
      res.status(404).json({ error: "Shift handover record not found." });
      return;
    }
    const { decision, comment } = req.body;
    if (decision === "REQUEST_REVISION" && !comment?.trim()) {
      res.status(400).json({ error: "Please specify what revision or clarification is needed." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (!Array.isArray(ho.auditTrail)) ho.auditTrail = [];
    if (decision === "ACCEPT") {
      ho.status = "RECEIVED_APPROVED";
      ho.receivedAt = nowIso;
      ho.approvedBy = actor.fullName;
      ho.incomingStaffId = actor.id;
      ho.incomingStaffName = actor.fullName;
      ho.revisionNote = void 0;
      ho.auditTrail.push({
        id: `ho-aud-${Date.now()}`,
        timestamp: nowIso,
        action: "ACCEPTED",
        actorName: actor.fullName,
        note: comment?.trim() || "Incoming shift staff verified pending tasks, keys, and ward register."
      });
      appendAudit(db, actor, "PERSONNEL", "SHIFT_HANDOVER_ACCEPTED", ho.handoverNumber, `${actor.fullName} accepted shift handover ${ho.handoverNumber}.`);
    } else {
      ho.status = "REVISION_REQUESTED";
      ho.revisionNote = comment.trim();
      ho.incomingStaffId = actor.id;
      ho.incomingStaffName = actor.fullName;
      ho.auditTrail.push({
        id: `ho-aud-${Date.now()}`,
        timestamp: nowIso,
        action: "REVISION_REQUESTED",
        actorName: actor.fullName,
        note: comment.trim()
      });
      appendAudit(
        db,
        actor,
        "PERSONNEL",
        "SHIFT_HANDOVER_REVISION_REQUESTED",
        ho.handoverNumber,
        `${actor.fullName} requested revision on handover ${ho.handoverNumber}: ${comment.trim()}`,
        "WARNING"
      );
    }
    saveDb(db);
    res.json({ handover: ho, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/handovers/:id/receive-approve", withAuth(), (req, res) => {
    const { db, actor } = req;
    const ho = (db.shiftHandovers || []).find((h) => h.id === req.params.id);
    if (!ho) {
      res.status(404).json({ error: "Shift handover record not found." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    ho.status = "RECEIVED_APPROVED";
    ho.receivedAt = nowIso;
    ho.approvedBy = actor.fullName;
    ho.incomingStaffId = actor.id;
    ho.incomingStaffName = actor.fullName;
    if (!Array.isArray(ho.auditTrail)) ho.auditTrail = [];
    ho.auditTrail.push({
      id: `ho-aud-${Date.now()}`,
      timestamp: nowIso,
      action: "ACCEPTED",
      actorName: actor.fullName,
      note: "Incoming staff acknowledged and accepted shift handover."
    });
    appendAudit(db, actor, "PERSONNEL", "SHIFT_HANDOVER_RECEIVED", ho.handoverNumber, `${actor.fullName} received & approved shift handover ${ho.handoverNumber}.`);
    saveDb(db);
    res.json({ handover: ho, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/store/requisitions", withAuth("inventory.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.department || !Array.isArray(body.items) || body.items.length === 0) {
      res.status(400).json({ error: "Department and at least one item are required for store issue." });
      return;
    }
    if (!Array.isArray(db.storeRequisitions)) db.storeRequisitions = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const issuedItems = [];
    for (const reqLine of body.items) {
      const r = db.reagents.find((x) => x.id === reqLine.reagentId);
      const q = Math.max(1, Number(reqLine.qty) || 1);
      if (!r) continue;
      if (r.currentStock < q) {
        res.status(400).json({ error: `Insufficient store stock for ${r.name} (available: ${r.currentStock} ${r.unit}).` });
        return;
      }
      r.currentStock = Number((r.currentStock - q).toFixed(2));
      issuedItems.push({ reagentId: r.id, reagentName: r.name, qty: q, unit: r.unit });
      db.inventoryMovements.unshift({
        id: `mov-str-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        timestamp: nowIso,
        reagentId: r.id,
        reagentName: r.name,
        lotNumber: r.lotNumber,
        type: "ADJUSTMENT",
        quantityDelta: -q,
        balanceAfter: r.currentStock,
        referenceId: `STR-${bsNow.year}-${db.storeRequisitions.length + 1}`,
        performedBy: actor.fullName,
        notes: `Store Issued to ${body.department} (Req by ${body.requestedBy || actor.fullName})`
      });
    }
    const reqRec = {
      id: `str-${Date.now()}`,
      reqNumber: `STR-${bsNow.year}-${String(db.storeRequisitions.length + 1).padStart(3, "0")}`,
      createdAt: nowIso,
      fiscalYear: db.settings.activeFiscalYear,
      department: body.department,
      requestedBy: body.requestedBy?.trim() || actor.fullName,
      issuedBy: actor.fullName,
      items: issuedItems,
      status: "Issued",
      notes: body.notes?.trim() || ""
    };
    db.storeRequisitions.unshift(reqRec);
    appendAudit(db, actor, "INVENTORY", "STORE_REQUISITION_ISSUED", reqRec.reqNumber, `Issued ${issuedItems.length} store item(s) to ${reqRec.department}.`);
    saveDb(db);
    res.status(201).json({ requisition: reqRec, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/marketing/visits", withAuth("marketing.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.areaName?.trim() || !body.facilityOrDoctorName?.trim()) {
      res.status(400).json({ error: "Area Name and Doctor/Clinic Name are required." });
      return;
    }
    if (!Array.isArray(db.marketingVisits)) db.marketingVisits = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const visit = {
      id: `mkt-${Date.now()}`,
      visitNumber: `MKT-${bsNow.year}-${String(db.marketingVisits.length + 1).padStart(3, "0")}`,
      visitedAt: nowIso,
      bsDate: bsNow.formattedEn,
      areaName: body.areaName.trim(),
      municipality: body.municipality?.trim() || "Saptari District",
      facilityOrDoctorName: body.facilityOrDoctorName.trim(),
      contactPerson: body.contactPerson?.trim() || body.facilityOrDoctorName.trim(),
      phone: body.phone?.trim() || "",
      gpsLat: body.gpsLat !== void 0 ? Number(body.gpsLat) : void 0,
      gpsLng: body.gpsLng !== void 0 ? Number(body.gpsLng) : void 0,
      gpsAccuracyM: body.gpsAccuracyM !== void 0 ? Number(body.gpsAccuracyM) : void 0,
      photoDataUrl: body.photoDataUrl,
      notes: body.notes?.trim() || "",
      staffId: actor.id,
      staffName: actor.fullName,
      status: body.status || "Logged"
    };
    db.marketingVisits.unshift(visit);
    appendAudit(db, actor, "REFERRALS", "MARKETING_VISIT_LOGGED", visit.visitNumber, `Field marketing visit logged in ${visit.areaName} (${visit.facilityOrDoctorName}).`);
    saveDb(db);
    res.status(201).json({ visit, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/access/verify-perimeter", withAuth(), (req, res) => {
    const { db, actor } = req;
    if (actor.roleId === "SUPER_ADMIN") {
      res.json({ verified: true, bypass: "SUPER_ADMIN" });
      return;
    }
    const { wifiCode } = req.body || {};
    const expectedCode = (db.settings?.moduleSettings?.hospitalWifiCheckCode || "SAPTARI-HOSP-2083").trim();
    if (wifiCode && wifiCode.trim() === expectedCode) {
      res.json({ verified: true });
      return;
    }
    res.status(403).json({ error: "Invalid Hospital Premises Check-In Code. Ask Reception or Hospital Admin." });
  });
  app.get("/api/system/download-source", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Hospital Admin (SUPER_ADMIN) role required to download source code." });
      return;
    }
    const rootDir = process.cwd();
    const excludedDirs = /* @__PURE__ */ new Set(["node_modules", "dev-dist", ".git", ".next", ".vite", "coverage"]);
    const entries = [];
    const walk = (dir, relBase) => {
      const items = fs2.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (excludedDirs.has(item.name)) continue;
        if (item.name === ".DS_Store" || item.name.endsWith(".tmp") || item.name.endsWith(".log") || item.name.endsWith(".bak") || item.name.endsWith(".zip")) {
          continue;
        }
        const fullPath = path2.join(dir, item.name);
        const zipRel = relBase ? `${relBase}/${item.name}` : item.name;
        if (zipRel === "data/backups" || zipRel.startsWith("data/backups/")) {
          continue;
        }
        if (item.isDirectory()) {
          walk(fullPath, zipRel);
        } else if (item.isFile()) {
          try {
            entries.push({ name: `hospital-erp-cloud/${zipRel}`, content: fs2.readFileSync(fullPath) });
          } catch {
          }
        }
      }
    };
    walk(rootDir, "");
    if (!fs2.existsSync(path2.join(rootDir, "data"))) {
      entries.push({ name: "hospital-erp-cloud/data/.gitkeep", content: "" });
    }
    entries.push({ name: "hospital-erp-cloud/data/backups/.gitkeep", content: "" });
    entries.push({
      name: "hospital-erp-cloud/Dockerfile",
      content: `FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000
VOLUME ["/app/data"]
CMD ["node", "app.cjs"]
`
    });
    entries.push({
      name: "hospital-erp-cloud/docker-compose.yml",
      content: `services:
  hospital-erp:
    build: .
    container_name: hospital-erp-cloud
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - PORT=3000
`
    });
    entries.push({
      name: "hospital-erp-cloud/install-cloud.sh",
      content: `#!/usr/bin/env bash
set -e
echo "=== Fast Linux Node.js Installer (Saptari Hospital ERP) ==="
mkdir -p ./data
npm install --omit=dev
if [ ! -f "dist/index.html" ] || [ ! -f "dist-server/server.js" ]; then
  npm install
  npm run build
fi
echo "Installation complete! Starting server on port \${PORT:-3000}..."
NODE_ENV=production node app.cjs
`
    });
    entries.push({
      name: "hospital-erp-cloud/CLOUD_INSTALL.md",
      content: `# Linux Node.js & CloudLinux Quick Installation Guide

This archive comes **PRE-BUILT** (\`dist/\` + \`dist-server/server.js\` + \`app.cjs\`) so you can upload and run it on Linux servers that support **only Node.js** without needing heavy frontend compilation on the host.

## Option A: CloudLinux Node.js Selector (cPanel / DirectAdmin Shared Hosting)
1. Upload & extract this ZIP into your domain app folder (e.g. \`~/hospital-erp\`).
2. In **cPanel -> Setup Node.js App**:
   - **Node.js version**: Select **18.x / 20.x / 22.x LTS**
   - **Application mode**: **Production**
   - **Application root**: \`hospital-erp\`
   - **Application startup file**: \`app.cjs\`
3. Click **Run NPM Install** (or SSH: \`npm install --omit=dev\`).
4. Ensure \`data/\` folder exists & is writable, then click **Restart App**. No build step needed \u2014 Phusion Passenger injects \`PORT\` automatically!

## Option B: Linux Node.js-Only Hosting / SSH / VPS
\`\`\`bash
bash start-linux.sh
\`\`\`
Or manually:
\`\`\`bash
npm install --omit=dev
NODE_ENV=production PORT=3000 node app.cjs
\`\`\`
Or with PM2 process manager:
\`\`\`bash
npm install --omit=dev && pm2 start ecosystem.config.cjs && pm2 save
\`\`\`

## Option C: Rebuilding After Modifying TypeScript / React Source
\`\`\`bash
npm install && npm run build && NODE_ENV=production node app.cjs
\`\`\`

## Option D: Windows PC / LAN Server
Double-click \`Start-SHPL-Windows-Server.bat\` (installs dependencies once if needed, opens firewall/browser on port 3000 for local hospital Wi-Fi / LAN access).

## Data Persistence
All live records are stored atomically in \`./data/lims-db.json\`. Mount or keep \`./data\` backed up regularly.
`
    });
    const zipBuffer = buildZipBuffer(entries);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="hospital-erp-linux-node-source.zip"');
    res.send(zipBuffer);
  });
  app.get("/api/downloads/chrome-extension", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Restricted: Software downloads are available exclusively to Hospital Admin (SUPER_ADMIN)." });
      return;
    }
    const lanIp = db.settings?.moduleSettings?.lanServerHostIp || "";
    const customUrl = typeof req.query.serverUrl === "string" && req.query.serverUrl.trim() ? req.query.serverUrl.trim() : "";
    const baseUrl = customUrl || (lanIp ? `http://${lanIp}:${PORT}` : `${req.protocol}://${req.get("host") || "saptarihospital.com"}`);
    const entries = [
      {
        name: "saptari-hospital-chrome-ext/manifest.json",
        content: JSON.stringify(
          {
            manifest_version: 3,
            name: "Saptari Hospital ERP \u2014 Fast Clinical & POS Launcher",
            version: "1.0.0",
            description: "Zero-install Chrome extension launcher for Saptari Hospital Pvt Ltd (POS, Pharmacy FEFO, ER/MLC & Finance Approvals). Engineered & Developed by Dr. Santosh Majhi.",
            action: {
              default_popup: "popup.html",
              default_title: "Open Saptari Hospital ERP"
            },
            permissions: ["storage", "tabs"],
            icons: {
              "192": "icon192.png",
              "512": "icon512.png"
            }
          },
          null,
          2
        )
      },
      {
        name: "saptari-hospital-chrome-ext/popup.html",
        content: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Saptari Hospital ERP</title>
  <style>
    body { font-family: system-ui, sans-serif; width: 300px; margin: 0; padding: 14px; background: #f8fafc; color: #0f172a; }
    h1 { font-size: 14px; margin: 0 0 4px; }
    p { font-size: 11px; color: #475569; margin: 0 0 12px; }
    label { display: block; font-size: 11px; font-weight: 600; margin-bottom: 4px; }
    input { width: 100%; box-sizing: border-box; padding: 6px 8px; font-size: 12px; border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 10px; }
    button { width: 100%; padding: 9px 12px; background: #0f172a; color: #fff; border: 0; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; margin-bottom: 6px; }
    button.secondary { background: #ffffff; color: #0f172a; border: 1px solid #cbd5e1; }
  </style>
</head>
<body>
  <h1>Saptari Hospital Pvt Ltd</h1>
  <p>Bode Barsain, Saptari \xB7 Hotline: 97-1515-6677</p>
  <label for="serverUrl">Hospital LAN / Cloud Server URL</label>
  <input id="serverUrl" type="url" value="${baseUrl}" />
  <button id="openErp">Open Hospital ERP Workspace</button>
  <button id="saveUrl" class="secondary">Save Custom Host URL</button>
  <script src="popup.js"></script>
</body>
</html>`
      },
      {
        name: "saptari-hospital-chrome-ext/popup.js",
        content: `document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('serverUrl');
  chrome.storage.local.get(['erpUrl'], (res) => {
    if (res && res.erpUrl) input.value = res.erpUrl;
  });
  document.getElementById('saveUrl').addEventListener('click', () => {
    chrome.storage.local.set({ erpUrl: input.value.trim() });
  });
  document.getElementById('openErp').addEventListener('click', () => {
    const url = input.value.trim() || '${baseUrl}';
    chrome.storage.local.set({ erpUrl: url });
    chrome.tabs.create({ url });
  });
});`
      },
      {
        name: "saptari-hospital-chrome-ext/README-INSTALL.txt",
        content: `SAPTARI HOSPITAL CHROME EXTENSION (UNPACKED INSTALL)
1. Unzip this folder to a permanent location (e.g. C:\\SaptariHospitalChromeExt).
2. Open Chrome -> chrome://extensions/
3. Enable "Developer mode" (top right toggle).
4. Click "Load unpacked" and select the extracted folder.
5. Pin "Saptari Hospital ERP" to your Chrome toolbar for 1-click access.
`
      }
    ];
    const icon192 = path2.resolve(process.cwd(), "public", "pwa-192x192.png");
    const icon512 = path2.resolve(process.cwd(), "public", "pwa-512x512.png");
    if (fs2.existsSync(icon192)) entries.push({ name: "saptari-hospital-chrome-ext/icon192.png", content: fs2.readFileSync(icon192) });
    if (fs2.existsSync(icon512)) entries.push({ name: "saptari-hospital-chrome-ext/icon512.png", content: fs2.readFileSync(icon512) });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="saptari-hospital-chrome-extension.zip"');
    res.send(buildZipBuffer(entries));
  });
  app.get("/api/downloads/windows-installer", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Restricted: Windows Installer kit is available exclusively to Hospital Admin (SUPER_ADMIN)." });
      return;
    }
    const queryServerIp = typeof req.query.serverIp === "string" ? req.query.serverIp.trim() : "";
    const queryServerUrl = typeof req.query.serverUrl === "string" ? req.query.serverUrl.trim() : "";
    const detectedIp = getLocalLanIps()[0];
    const lanIp = queryServerIp || detectedIp || db.settings?.moduleSettings?.lanServerHostIp || "192.168.1.100";
    const lanUrl = queryServerUrl || `http://${lanIp}:${PORT}`;
    const baseUrl = queryServerUrl || `${req.protocol}://${req.get("host") || "saptarihospital.com"}`;
    const entries = [
      {
        name: "saptari-hospital-windows/Install-SHPL-Windows-App.bat",
        content: `@echo off
TITLE SHPL - Saptari Hospital Pvt Ltd Windows Desktop App Setup
echo Creating Desktop Shortcut for SHPL (${lanUrl})...
set DESKTOP=%USERPROFILE%\\Desktop
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%DESKTOP%\\SHPL.lnk'); $Shortcut.TargetPath = 'msedge.exe'; $Shortcut.Arguments = '--app=${lanUrl}'; $Shortcut.Save()"
echo Desktop App Shortcut (SHPL) created! Pointed to ${lanUrl}
echo To connect other counter Windows PCs on hospital Wi-Fi/LAN, run Connect-Client-PC.bat on each client PC.
pause
`
      },
      {
        name: "saptari-hospital-windows/Connect-Client-PC.bat",
        content: `@echo off
TITLE Connect Same-Wi-Fi Client PC to Main SHPL Windows Server
set /p HOSTIP="Enter Main Windows Server Wi-Fi IP Address (Default ${lanIp}): "
if "%HOSTIP%"=="" set HOSTIP=${lanIp}
set TARGETURL=http://%HOSTIP%:${PORT}
set DESKTOP=%USERPROFILE%\\Desktop
powershell -Command "$WshShell = New-Object -comObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%DESKTOP%\\SHPL.lnk'); $Shortcut.TargetPath = 'msedge.exe'; $Shortcut.Arguments = '--app=%TARGETURL%'; $Shortcut.Save()"
echo SHPL client shortcut created on Desktop for %TARGETURL%!
start msedge.exe --app=%TARGETURL%
`
      },
      {
        name: "saptari-hospital-windows/AutoSync-Backup.ps1",
        content: `# SHPL 1-Computer Auto-Sync Backup Script
param(
  [string]$ServerUrl = "${lanUrl}",
  [string]$BackupDir = "$env:USERPROFILE\\Documents\\SHPL_Backups"
)
if (!(Test-Path $BackupDir)) { New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null }
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutFile = Join-Path $BackupDir "shpl-backup-$Stamp.json"
$LatestFile = Join-Path $BackupDir "shpl-latest.json"
try {
  Invoke-WebRequest -Uri "$ServerUrl/api/system/backup-snapshot" -Headers @{ "x-user-id" = "staff-1" } -OutFile $LatestFile -UseBasicParsing
  Copy-Item $LatestFile $OutFile -Force
  Write-Host "Synced backup successfully to $OutFile"
} catch {
  Write-Error "Backup sync failed: $_"
}
`
      },
      {
        name: "saptari-hospital-windows/Setup-AutoBackup-Task.bat",
        content: `@echo off
schtasks /Create /SC MINUTE /MO 10 /TN "SHPL_AutoSyncBackup" /TR "powershell.exe -ExecutionPolicy Bypass -File %~dp0AutoSync-Backup.ps1" /F
echo Scheduled 10-minute 1-Computer Auto-Sync Backup task registered!
pause
`
      },
      {
        name: "saptari-hospital-windows/README-WINDOWS.txt",
        content: `SHPL (SAPTARI HOSPITAL PVT LTD) \u2014 1-PC WINDOWS SERVER & SAME-WIFI LAN KIT
Engineered & Developed by Dr. Santosh Majhi

1. ONE WINDOWS PC AS SERVER:
   - Extract the Full Source Code ZIP on your Main Windows Server PC.
   - Double-click "Start-SHPL-Windows-Server.bat" inside the source folder.
   - It automatically opens Windows Firewall TCP Port ${PORT}, builds SHPL, and displays your PC's Wi-Fi IPv4 address (e.g., ${lanUrl}).

2. REST OF DEVICES ON SAME WI-FI (Windows, Android, iOS):
   - Windows Counter PCs: Open Chrome/Edge to ${lanUrl} -> click "Install SHPL App" (or run Connect-Client-PC.bat).
   - Android Phones/Tablets: Open Chrome to ${lanUrl} -> Tap "Install SHPL App" (or 3-dot Menu -> Install App) -> Installs as "SHPL".
   - iPhone / iPad (iOS): Open Safari/Chrome to ${lanUrl} -> Tap Share -> "Add to Home Screen" -> Installs as "SHPL".

Current web origin: ${baseUrl}
`
      }
    ];
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="saptari-hospital-windows-installer.zip"');
    res.send(buildZipBuffer(entries));
  });
  app.get("/api/downloads/android-app", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Restricted: Android App kit is available exclusively to Hospital Admin (SUPER_ADMIN)." });
      return;
    }
    const baseUrl = `${req.protocol}://${req.get("host") || "saptarihospital.com"}`;
    const entries = [
      {
        name: "saptari-hospital-android/capacitor.config.json",
        content: JSON.stringify(
          {
            appId: "com.saptarihospital.erp",
            appName: "Saptari Hospital",
            webDir: "dist",
            server: {
              url: baseUrl,
              cleartext: baseUrl.startsWith("http://")
            }
          },
          null,
          2
        )
      },
      {
        name: "saptari-hospital-android/twa-manifest.json",
        content: JSON.stringify(
          {
            packageId: "com.saptarihospital.erp",
            host: baseUrl.replace(/^https?:\/\//, ""),
            name: "Saptari Hospital Pvt Ltd ERP",
            launcherName: "Saptari Hosp",
            display: "standalone",
            themeColor: "#0f172a",
            backgroundColor: "#f8fafc",
            startUrl: "/",
            iconUrl: `${baseUrl}/pwa-512x512.png`,
            maskableIconUrl: `${baseUrl}/pwa-maskable-512x512.png`
          },
          null,
          2
        )
      },
      {
        name: "saptari-hospital-android/assetlinks.json",
        content: JSON.stringify(
          [
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: {
                namespace: "android_app",
                package_name: "com.saptarihospital.erp",
                sha256_cert_fingerprints: ["REPLACE_WITH_YOUR_KEYSTORE_SHA256_FINGERPRINT"]
              }
            }
          ],
          null,
          2
        )
      },
      {
        name: "saptari-hospital-android/README-ANDROID.txt",
        content: `SAPTARI HOSPITAL ANDROID APP BUILD & DIRECT WEBAPK INSTALL
Option A (Zero-Build Direct Android Installation via Chrome WebAPK):
- Open ${baseUrl} in Chrome on your Android phone/tablet.
- Tap Chrome Menu (\u22EE) -> "Install App".
- Android automatically installs a native Home-Screen shortcut.
`
      }
    ];
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="saptari-hospital-android-kit.zip"');
    res.send(buildZipBuffer(entries));
  });
  app.get("/api/downloads/mac-app", (req, res) => {
    const db = getDb();
    const actorId = req.header("x-user-id") || (typeof req.query.uid === "string" ? req.query.uid : void 0);
    const actor = getActor(db, actorId);
    if (actor.roleId !== "SUPER_ADMIN") {
      res.status(403).json({ error: "Restricted: macOS launcher kit is available exclusively to Hospital Admin (SUPER_ADMIN)." });
      return;
    }
    const baseUrl = `${req.protocol}://${req.get("host") || "saptarihospital.com"}`;
    const entries = [
      {
        name: "saptari-hospital-mac/Launch-SaptariHospital.command",
        content: `#!/bin/bash
# 1-Click Saptari Hospital ERP macOS Web App Launcher
URL="${baseUrl}"
if [ -d "/Applications/Google Chrome.app" ]; then
  open -na "Google Chrome" --args --app="$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -na "Microsoft Edge" --args --app="$URL"
else
  open "$URL"
fi
`
      },
      {
        name: "saptari-hospital-mac/AutoSync-Backup-Mac.sh",
        content: `#!/bin/bash
SERVER_URL="${baseUrl}"
BACKUP_DIR="$HOME/Documents/SaptariHospitalBackups"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +"%Y%m%d-%H%M%S")
curl -sS -H "x-user-id: staff-1" "$SERVER_URL/api/system/backup-snapshot" -o "$BACKUP_DIR/saptari-hospital-latest.json"
cp "$BACKUP_DIR/saptari-hospital-latest.json" "$BACKUP_DIR/saptari-hospital-backup-$STAMP.json"
echo "Backup synced to $BACKUP_DIR"
`
      },
      {
        name: "saptari-hospital-mac/README-MAC.txt",
        content: `SAPTARI HOSPITAL ERP FOR MACOS (1-CLICK APP & AUTO-BACKUP)
1. Extract this folder anywhere on your Mac (Desktop or Applications).
2. Right-click Launch-SaptariHospital.command -> Open to launch Saptari Hospital ERP as a standalone native window.
`
      }
    ];
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="saptari-hospital-mac-app.zip"');
    res.send(buildZipBuffer(entries));
  });
  app.post("/api/ot/cases", withAuth("ot.manage", "ot_management"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.patientName?.trim() || !body.procedureName?.trim() || !body.otRoomId) {
      res.status(400).json({ error: "Patient Name, Procedure Name, and OT Room are required to schedule surgery." });
      return;
    }
    if (!Array.isArray(db.otRooms)) db.otRooms = [];
    if (!Array.isArray(db.otCases)) db.otCases = [];
    const room = db.otRooms.find((r) => r.id === body.otRoomId) || db.otRooms[0];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const seq = db.otCases.length + 1;
    const otNumber = `OT-${bsNow.year}-${String(seq).padStart(3, "0")}`;
    const created = {
      id: `otcase-${Date.now()}`,
      otNumber,
      fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
      centerId: null,
      centerName: "Saptari Hospital Main",
      otRoomId: room?.id || body.otRoomId,
      otRoomLabel: room?.name || body.otRoomLabel || "OT-1",
      patientId: body.patientId || void 0,
      uhid: body.uhid || void 0,
      encounterType: body.encounterType || "IPD",
      encounterId: body.encounterId || void 0,
      patientName: body.patientName.trim(),
      patientAge: Number(body.patientAge) || 30,
      patientAgeType: body.patientAgeType || "Years",
      patientGender: body.patientGender || "Female",
      patientPhone: body.patientPhone?.trim() || "",
      patientAddress: body.patientAddress?.trim() || "Saptari, Nepal",
      scheduledDate: body.scheduledDate || nowIso.slice(0, 10),
      scheduledTime: body.scheduledTime || "10:00",
      procedureName: body.procedureName.trim(),
      surgicalSpecialty: body.surgicalSpecialty?.trim() || "General Surgery",
      priority: body.priority || "Elective",
      leadSurgeon: body.leadSurgeon?.trim() || actor.fullName,
      assistantSurgeon: body.assistantSurgeon?.trim() || void 0,
      anesthesiologist: body.anesthesiologist?.trim() || "On-Call Anesthesiologist",
      scrubNurse: body.scrubNurse?.trim() || void 0,
      diagnosis: body.diagnosis?.trim() || "Surgical evaluation",
      otFeeNpr: Math.max(0, Number(body.otFeeNpr) || 0),
      consumablesNotes: body.consumablesNotes?.trim() || void 0,
      status: "Scheduled",
      recordedAt: nowIso,
      recordedBy: actor.fullName
    };
    db.otCases.unshift(created);
    appendAudit(
      db,
      actor,
      "OT_MANAGEMENT",
      "OT_CASE_SCHEDULED",
      otNumber,
      `Scheduled OT ${otNumber}: ${created.procedureName} for ${created.patientName} in ${created.otRoomLabel}.`
    );
    saveDb(db);
    res.status(201).json({ otCase: created, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/ot/rooms/:id", withAuth("ot.manage", "ot_management"), (req, res) => {
    const { db, actor } = req;
    const room = (db.otRooms || []).find((r) => r.id === req.params.id);
    if (!room) {
      res.status(404).json({ error: "OT Theatre Room not found." });
      return;
    }
    const { status } = req.body;
    room.status = status || room.status;
    if (room.status === "Available" || room.status === "Cleaning") {
      room.currentCaseId = null;
    }
    appendAudit(db, actor, "OT_MANAGEMENT", "OT_ROOM_UPDATED", room.roomCode, `Updated ${room.name} status to ${room.status}.`);
    saveDb(db);
    res.json({ room, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ot/cases/:id/preop-checklist", withAuth(void 0, "ot_management"), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "ot.view") && !hasPermission(db, actor.roleId, "ot.manage") && !hasPermission(db, actor.roleId, "ot.anesthesia")) {
      res.status(403).json({ error: "Forbidden: Insufficient permissions for OT Pre-Op Safety Checklist." });
      return;
    }
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: "OT surgical case not found." });
      return;
    }
    const body = req.body;
    if (!body.vitalBp?.trim() || !body.vitalPulseBpm || !body.vitalSpo2Pct) {
      res.status(400).json({ error: "Patient Pre-Op Vitals (BP, Pulse, SpO2) are mandatory." });
      return;
    }
    if (!body.anesthesiaCleared) {
      res.status(400).json({ error: "Anesthesia clearance sign-off is mandatory before clearing for OT." });
      return;
    }
    if (!body.surgicalSiteVerified || !body.patientIdentityVerified || !body.consentSignedVerified) {
      res.status(400).json({
        error: "Patient identity, written surgical consent, and surgical site verification must all be confirmed."
      });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const checklist = {
      completedAt: nowIso,
      completedBy: actor.fullName,
      vitalBp: body.vitalBp.trim(),
      vitalPulseBpm: Number(body.vitalPulseBpm),
      vitalTempF: Number(body.vitalTempF) || 98.4,
      vitalSpo2Pct: Number(body.vitalSpo2Pct),
      asaGrade: body.asaGrade || "ASA II",
      anesthesiaCleared: Boolean(body.anesthesiaCleared),
      anesthesiaClearedBy: body.anesthesiaClearedBy?.trim() || otCase.anesthesiologist || actor.fullName,
      surgicalSiteVerified: Boolean(body.surgicalSiteVerified),
      siteMarked: Boolean(body.siteMarked),
      laterality: body.laterality || "Midline / N/A",
      procedureNameVerified: body.procedureNameVerified?.trim() || otCase.procedureName,
      patientIdentityVerified: Boolean(body.patientIdentityVerified),
      consentSignedVerified: Boolean(body.consentSignedVerified),
      npoConfirmed: Boolean(body.npoConfirmed),
      bloodCrossmatchChecked: Boolean(body.bloodCrossmatchChecked),
      equipmentSterilityChecked: Boolean(body.equipmentSterilityChecked),
      checklistNotes: body.checklistNotes?.trim() || void 0,
      clearedToStart: true
    };
    otCase.preOpChecklist = checklist;
    if (otCase.status === "Scheduled") {
      otCase.status = "Pre-Op Ready";
    }
    appendAudit(
      db,
      actor,
      "OT_MANAGEMENT",
      "PREOP_CHECKLIST_SIGNED",
      otCase.otNumber,
      `Signed Mandatory Pre-Op Safety Checklist for ${otCase.otNumber} (${otCase.patientName} \u2014 ${checklist.procedureNameVerified}). Vitals BP ${checklist.vitalBp}, HR ${checklist.vitalPulseBpm}, SpO2 ${checklist.vitalSpo2Pct}%, ${checklist.asaGrade}, Site Verified (${checklist.laterality}), Anesthesia Cleared by ${checklist.anesthesiaClearedBy}.`,
      "INFO"
    );
    saveDb(db);
    res.json({ otCase, checklist, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ot/cases/:id/start", withAuth("ot.manage", "ot_management"), (req, res) => {
    const { db, actor } = req;
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: "OT surgical case not found." });
      return;
    }
    if (!otCase.preOpChecklist || !otCase.preOpChecklist.clearedToStart) {
      res.status(400).json({
        error: "Safety Gate Blocked: Mandatory Pre-Operative Safety Checklist must be completed & signed before starting surgery."
      });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    otCase.status = "In Progress";
    otCase.startedAt = otCase.startedAt || nowIso;
    const room = (db.otRooms || []).find((r) => r.id === otCase.otRoomId);
    if (room) {
      room.status = "Occupied";
      room.currentCaseId = otCase.id;
    }
    appendAudit(
      db,
      actor,
      "OT_MANAGEMENT",
      "OT_SURGERY_STARTED",
      otCase.otNumber,
      `Started surgery ${otCase.otNumber} (${otCase.procedureName}) in ${otCase.otRoomLabel} after verified Pre-Op Safety Checklist.`
    );
    saveDb(db);
    res.json({ otCase, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ot/cases/:id/anesthesia", withAuth(void 0, "ot_management"), (req, res) => {
    const { db, actor } = req;
    if (!hasPermission(db, actor.roleId, "ot.anesthesia") && !hasPermission(db, actor.roleId, "ot.manage") && !hasPermission(db, actor.roleId, "hospital.clinical")) {
      res.status(403).json({ error: "Forbidden: Missing permission ot.anesthesia or ot.manage." });
      return;
    }
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: "OT surgical case not found." });
      return;
    }
    const body = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      anesthesiologistName: body.anesthesiologistName?.trim() || otCase.anesthesiologist || actor.fullName,
      anesthesiaType: body.anesthesiaType || "General Anesthesia (GA)",
      startedAt: body.startedAt || otCase.anesthesiaRecord?.startedAt || nowIso,
      endedAt: body.endedAt || otCase.anesthesiaRecord?.endedAt,
      airwayLog: body.airwayLog || {
        mallampatiGrade: "Class I",
        airwayDevice: "ETT (Endotracheal Tube)"
      },
      agentsUsed: Array.isArray(body.agentsUsed) ? body.agentsUsed : [],
      vitalsLog: Array.isArray(body.vitalsLog) ? body.vitalsLog : [],
      ivFluidsGivenMl: body.ivFluidsGivenMl !== void 0 ? Number(body.ivFluidsGivenMl) : void 0,
      estimatedBloodLossMl: body.estimatedBloodLossMl !== void 0 ? Number(body.estimatedBloodLossMl) : void 0,
      complicationNotes: body.complicationNotes?.trim() || void 0,
      updatedAt: nowIso,
      updatedBy: actor.fullName
    };
    otCase.anesthesiaRecord = record;
    appendAudit(
      db,
      actor,
      "OT_MANAGEMENT",
      "OT_ANESTHESIA_UPDATED",
      otCase.otNumber,
      `Updated Anesthesiology record for ${otCase.otNumber} (${record.anesthesiaType}): ${record.agentsUsed.length} drug dose(s), airway ${record.airwayLog.airwayDevice} (${record.airwayLog.mallampatiGrade}), ${record.vitalsLog.length} intra-op vital point(s).`
    );
    saveDb(db);
    res.json({ otCase, anesthesiaRecord: record, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/ot/cases/:id/complete", withAuth("ot.manage", "ot_management"), (req, res) => {
    const { db, actor } = req;
    const otCase = (db.otCases || []).find((c) => c.id === req.params.id);
    if (!otCase) {
      res.status(404).json({ error: "OT surgical case not found." });
      return;
    }
    const {
      operativeNote,
      consumablesNotes,
      postOpPacu,
      targetStatus,
      postChargeToIpd
    } = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    if (operativeNote !== void 0) otCase.operativeNote = operativeNote.trim();
    if (consumablesNotes !== void 0) otCase.consumablesNotes = consumablesNotes.trim();
    if (postOpPacu) {
      otCase.postOpPacu = {
        recordedAt: nowIso,
        aldreteScore: Math.max(0, Math.min(10, Number(postOpPacu.aldreteScore) || 9)),
        bp: postOpPacu.bp?.trim() || void 0,
        spo2Pct: postOpPacu.spo2Pct ? Number(postOpPacu.spo2Pct) : void 0,
        painScore: postOpPacu.painScore !== void 0 ? Number(postOpPacu.painScore) : void 0,
        pacuNotes: postOpPacu.pacuNotes?.trim() || void 0,
        transferredTo: postOpPacu.transferredTo?.trim() || "Post-Op Surgical Ward",
        dischargedBy: actor.fullName
      };
    }
    otCase.status = targetStatus || "Completed";
    if (otCase.status === "Completed") {
      otCase.completedAt = nowIso;
    }
    const room = (db.otRooms || []).find((r) => r.id === otCase.otRoomId);
    if (room) {
      room.status = "Cleaning";
      room.currentCaseId = null;
    }
    if (postChargeToIpd && otCase.otFeeNpr > 0) {
      const adm = (db.ipdAdmissions || []).find(
        (a) => a.disposition === "Admitted" && (otCase.encounterId && a.id === otCase.encounterId || otCase.uhid && a.uhid === otCase.uhid || otCase.patientId && a.patientId === otCase.patientId)
      );
      if (adm) {
        if (!Array.isArray(adm.directServiceCharges)) adm.directServiceCharges = [];
        const alreadyPosted = adm.directServiceCharges.some((c) => c.id === `otchg-${otCase.id}`);
        if (!alreadyPosted) {
          adm.directServiceCharges.push({
            id: `otchg-${otCase.id}`,
            billedAt: nowIso,
            billedBy: actor.fullName,
            serviceName: `OT Procedure (${otCase.otNumber}): ${otCase.procedureName}`,
            category: "PROCEDURE",
            amountNpr: otCase.otFeeNpr,
            paymentMode: "Credit",
            notes: `Surgeon: ${otCase.leadSurgeon}`
          });
          recalcIpdFinancials(adm, db.settings?.moduleSettings);
        }
      }
    }
    appendAudit(
      db,
      actor,
      "OT_MANAGEMENT",
      "OT_SURGERY_COMPLETED",
      otCase.otNumber,
      `Marked OT ${otCase.otNumber} (${otCase.procedureName}) as ${otCase.status}. Room ${otCase.otRoomLabel} set to Cleaning.`
    );
    saveDb(db);
    res.json({ otCase, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/appointments", withAuth("patients.manage"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.patientName?.trim() || !body.doctorName?.trim() || !body.appointmentDateAd) {
      res.status(400).json({ error: "Patient Name, Doctor Name, and Appointment Date are required." });
      return;
    }
    if (!Array.isArray(db.appointments)) db.appointments = [];
    const patientRec = upsertPatientMaster(db, {
      patientId: body.patientId,
      uhid: body.uhid,
      fullName: body.patientName.trim(),
      age: Number(body.patientAge) || 30,
      ageType: body.patientAgeType || "Years",
      gender: body.patientGender || "Male",
      phone: body.patientPhone,
      address: body.patientAddress,
      actorName: actor.fullName
    });
    const bsAppt = adToBs(body.appointmentDateAd);
    const apptNo = `APT-${bsAppt.year}-${String(db.appointments.length + 101).padStart(3, "0")}`;
    const appt = {
      id: `apt-${Date.now()}`,
      appointmentNumber: apptNo,
      patientId: patientRec.id,
      uhid: patientRec.uhid,
      patientName: patientRec.fullName,
      patientAge: Number(body.patientAge) || patientRec.age,
      patientAgeType: body.patientAgeType || patientRec.ageType,
      patientGender: body.patientGender || patientRec.gender,
      patientPhone: normalizeNepalPhone(body.patientPhone) || patientRec.phone,
      patientAddress: body.patientAddress?.trim() || patientRec.address,
      department: body.department?.trim() || "General Medicine OPD",
      doctorName: body.doctorName.trim(),
      appointmentDateAd: body.appointmentDateAd,
      appointmentDateBs: body.appointmentDateBs?.trim() || bsAppt.formattedEn,
      timeSlot: body.timeSlot?.trim() || "10:00 AM",
      reason: body.reason?.trim() || "OPD Consultation",
      status: "Scheduled",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      createdBy: actor.fullName
    };
    db.appointments.unshift(appt);
    appendAudit(db, actor, "OPD_IPD", "APPOINTMENT_BOOKED", apptNo, `Booked appointment ${apptNo} for ${appt.patientName} with ${appt.doctorName} on ${appt.appointmentDateBs} ${appt.timeSlot}.`);
    saveDb(db);
    res.status(201).json({ appointment: appt, patient: patientRec, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/appointments/:id", withAuth("patients.manage"), (req, res) => {
    const { db, actor } = req;
    const appt = (db.appointments || []).find((a) => a.id === req.params.id);
    if (!appt) {
      res.status(404).json({ error: "Appointment not found." });
      return;
    }
    const body = req.body;
    if (body.status) appt.status = body.status;
    if (body.timeSlot) appt.timeSlot = body.timeSlot;
    if (body.appointmentDateAd) {
      appt.appointmentDateAd = body.appointmentDateAd;
      appt.appointmentDateBs = body.appointmentDateBs || adToBs(body.appointmentDateAd).formattedEn;
    }
    if (body.doctorName) appt.doctorName = body.doctorName;
    if (body.department) appt.department = body.department;
    if (body.reason !== void 0) appt.reason = body.reason;
    saveDb(db);
    res.json({ appointment: appt, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/pharmacy/bulk-import", withAuth("pharmacy.manage", "pharmacy_erp"), (req, res) => {
    const { db, actor } = req;
    const { rows, defaultSupplierName } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "No valid spreadsheet rows provided." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const defaultExp = new Date(Date.now() + 540 * 864e5).toISOString().slice(0, 10);
    let addedMeds = 0;
    let updatedMeds = 0;
    let addedBatches = 0;
    rows.forEach((row, idx) => {
      const brand = (row.brandName || "").trim();
      if (!brand) return;
      const code = (row.code || "").trim().toUpperCase() || `MED-XL-${Date.now().toString().slice(-4)}-${idx + 1}`;
      const mrp = Math.max(0, Number(row.mrpNpr) || 0);
      const buyRate = Math.max(0, Number(row.purchaseRateNpr) || (mrp > 0 ? Number((mrp / 1.16).toFixed(2)) : 0));
      const qty = Math.max(0, Math.floor(Number(row.quantity) || 0));
      let med = db.pharmacyMedicines.find(
        (m) => m.code.toUpperCase() === code || m.brandName.toLowerCase() === brand.toLowerCase()
      );
      if (!med) {
        med = {
          id: `med-xl-${Date.now()}-${idx}`,
          code,
          brandName: brand,
          genericName: (row.genericName || brand).trim(),
          dosageForm: row.dosageForm || "Tablet",
          strength: (row.strength || "Std").trim(),
          manufacturer: (row.manufacturer || "Nepal Pharma Formulary").trim(),
          category: (row.category || "General").trim(),
          scheduleType: "OTC",
          rackLocation: (row.rackLocation || "A-01").trim(),
          unitLabel: (row.unitLabel || "Units").trim(),
          vatApplicable: Boolean(row.vatApplicable),
          reorderLevel: 30,
          defaultMrpNpr: mrp || 10,
          defaultPurchaseRateNpr: buyRate || 8,
          active: true
        };
        db.pharmacyMedicines.unshift(med);
        addedMeds += 1;
      } else {
        if (mrp > 0) med.defaultMrpNpr = mrp;
        if (buyRate > 0) med.defaultPurchaseRateNpr = buyRate;
        if (row.manufacturer) med.manufacturer = row.manufacturer.trim();
        if (row.rackLocation) med.rackLocation = row.rackLocation.trim();
        updatedMeds += 1;
      }
      if (qty > 0) {
        const batchNo = (row.batchNumber || "").trim() || `XL-${(/* @__PURE__ */ new Date()).getFullYear()}-${idx + 1}`;
        const expDate = (row.expiryDate || "").trim() || defaultExp;
        const supName = (row.supplierName || defaultSupplierName || med.manufacturer).trim();
        const batch = {
          id: `pbat-xl-${Date.now()}-${idx}`,
          medicineId: med.id,
          centerId: null,
          centerName: "Saptari Hospital Central Pharmacy",
          batchNumber: batchNo,
          mfgDate: nowIso.slice(0, 10),
          expiryDate: expDate,
          quantityReceived: qty,
          quantityOnHand: qty,
          purchaseRateNpr: buyRate || Number((med.defaultMrpNpr / 1.16).toFixed(2)),
          mrpNpr: mrp || med.defaultMrpNpr,
          supplierName: supName,
          grnNumber: `GRN-XL-${String(Date.now()).slice(-5)}`,
          receivedAt: nowIso
        };
        db.pharmacyBatches.unshift(batch);
        db.pharmacyMovements.unshift({
          id: `pmov-xl-${Date.now()}-${idx}`,
          timestamp: nowIso,
          medicineId: med.id,
          medicineName: med.brandName,
          batchId: batch.id,
          batchNumber: batch.batchNumber,
          expiryDate: batch.expiryDate,
          centerId: batch.centerId ?? null,
          type: "GRN_IN",
          quantityDelta: qty,
          balanceAfter: qty,
          referenceId: batch.grnNumber,
          performedBy: actor.fullName,
          notes: `Excel Bulk Import (${supName})`
        });
        addedBatches += 1;
      }
    });
    appendAudit(
      db,
      actor,
      "PHARMACY",
      "PHARMACY_EXCEL_BULK_IMPORT",
      `XL-${rows.length}`,
      `Imported Excel catalog: ${addedMeds} new medicines, ${updatedMeds} updated, ${addedBatches} opening batches.`
    );
    saveDb(db);
    res.json({ addedMeds, updatedMeds, addedBatches, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/personnel/certificates", withAuth("personnel.manage", "hr_payroll"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.staffId || !body.certificateType || !body.documentBody?.trim()) {
      res.status(400).json({ error: "Staff Member, Certificate Type, and Document Body are required." });
      return;
    }
    const staff = db.staff.find((s) => s.id === body.staffId);
    if (!staff) {
      res.status(404).json({ error: "Staff member not found." });
      return;
    }
    if (!Array.isArray(db.hrCertificates)) db.hrCertificates = [];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const certNumber = `HRC-${bsNow.year}-${String(db.hrCertificates.length + 1).padStart(3, "0")}`;
    let linkedChalaniNumber;
    if (body.logToChalani) {
      const chalaniSerial = (db.dartaChalani || []).filter((e) => e.entryType === "CHALANI").length + 1;
      linkedChalaniNumber = `CHALANI-${bsNow.year}-${String(chalaniSerial).padStart(3, "0")}`;
      const chalaniEntry = {
        id: `dc-hr-${Date.now()}`,
        entryType: "CHALANI",
        serialNo: chalaniSerial,
        entryNumber: linkedChalaniNumber,
        refNumber: certNumber,
        fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
        entryDateAd: nowIso.slice(0, 10),
        entryDateBs: bsNow.formattedEn,
        partyName: staff.fullName,
        partyAddress: staff.department,
        subject: body.subject?.trim() || `${body.certificateType} \u2014 ${staff.fullName} (${staff.employeeCode})`,
        category: "HR / Internal Circular",
        department: "Human Resources",
        handledBy: actor.fullName,
        documentBody: body.documentBody.trim(),
        attachments: [],
        status: "Verified / Dispatched",
        remarks: `Auto-logged from HR ${body.certificateType}`,
        recordedBy: actor.fullName
      };
      db.dartaChalani.unshift(chalaniEntry);
    }
    const record = {
      id: `hrc-${Date.now()}`,
      certificateNumber: certNumber,
      certificateType: body.certificateType,
      staffId: staff.id,
      employeeCode: staff.employeeCode,
      staffName: staff.fullName,
      designation: body.designation?.trim() || staff.designation,
      department: body.department?.trim() || staff.department,
      joinedAt: body.joinedAt || staff.joinedAt,
      relievedAt: body.relievedAt || void 0,
      basicSalaryNpr: body.basicSalaryNpr !== void 0 ? Number(body.basicSalaryNpr) : staff.basicSalaryNpr,
      subject: body.subject?.trim() || `${body.certificateType} \u2014 ${staff.fullName}`,
      documentBody: body.documentBody.trim(),
      issuedAt: nowIso,
      issuedDateBs: bsNow.formattedEn,
      issuedBy: actor.fullName,
      linkedChalaniNumber
    };
    db.hrCertificates.unshift(record);
    appendAudit(db, actor, "PERSONNEL", "HR_CERTIFICATE_ISSUED", certNumber, `Issued ${record.certificateType} (${certNumber}) for ${staff.fullName}.`);
    saveDb(db);
    res.status(201).json({ certificate: record, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/referrals/hospitals", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim() || !body.managerName?.trim() || !body.managerPhone?.trim()) {
      res.status(400).json({ error: "Hospital Name, Manager Name, and Manager Phone are required." });
      return;
    }
    if (!Array.isArray(db.referredHospitalsMaster)) db.referredHospitalsMaster = [];
    const created = {
      id: `rhosp-${Date.now()}`,
      name: body.name.trim(),
      address: body.address?.trim() || "Nepal",
      phone: body.phone?.trim() || "",
      managerName: body.managerName.trim(),
      managerPhone: normalizeNepalPhone(body.managerPhone) || body.managerPhone.trim(),
      specialties: body.specialties?.trim() || "",
      active: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.referredHospitalsMaster.unshift(created);
    appendAudit(db, actor, "REFERRALS", "REFERRED_HOSPITAL_ADDED", created.id, `Added Referred Hospital ${created.name} (Mgr: ${created.managerName} ${created.managerPhone}).`);
    saveDb(db);
    res.status(201).json({ hospital: created, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/referrals/hospitals/:id", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const item = (db.referredHospitalsMaster || []).find((h) => h.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: "Referred hospital not found." });
      return;
    }
    const body = req.body;
    if (body.name !== void 0) item.name = body.name.trim();
    if (body.address !== void 0) item.address = body.address.trim();
    if (body.phone !== void 0) item.phone = body.phone.trim();
    if (body.managerName !== void 0) item.managerName = body.managerName.trim();
    if (body.managerPhone !== void 0) item.managerPhone = normalizeNepalPhone(body.managerPhone) || body.managerPhone.trim();
    if (body.specialties !== void 0) item.specialties = body.specialties.trim();
    if (body.active !== void 0) item.active = Boolean(body.active);
    saveDb(db);
    res.json({ hospital: item, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/referrals/hospitals/:id", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    db.referredHospitalsMaster = (db.referredHospitalsMaster || []).filter((h) => h.id !== req.params.id);
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/referrals/ambulances", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.name?.trim() || !body.vehicleNumber?.trim()) {
      res.status(400).json({ error: "Ambulance Name and Vehicle Number are required." });
      return;
    }
    if (!Array.isArray(db.ambulancesMaster)) db.ambulancesMaster = [];
    const created = {
      id: `amb-${Date.now()}`,
      name: body.name.trim(),
      vehicleNumber: body.vehicleNumber.trim().toUpperCase(),
      vehicleType: body.vehicleType || "ALS Ambulance",
      driverName: body.driverName?.trim() || "",
      driverPhone: normalizeNepalPhone(body.driverPhone) || body.driverPhone?.trim() || "",
      defaultCommissionMode: body.defaultCommissionMode || "FLAT",
      defaultCommissionValue: Math.max(0, Number(body.defaultCommissionValue) || 0),
      caseOverrides: Array.isArray(body.caseOverrides) ? body.caseOverrides : [],
      active: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    db.ambulancesMaster.unshift(created);
    appendAudit(db, actor, "REFERRALS", "AMBULANCE_ADDED", created.vehicleNumber, `Added Ambulance ${created.name} (${created.vehicleNumber}).`);
    saveDb(db);
    res.status(201).json({ ambulance: created, db: scopeDbForActor(db, actor) });
  });
  app.patch("/api/referrals/ambulances/:id", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const item = (db.ambulancesMaster || []).find((a) => a.id === req.params.id);
    if (!item) {
      res.status(404).json({ error: "Ambulance not found." });
      return;
    }
    const body = req.body;
    if (body.name !== void 0) item.name = body.name.trim();
    if (body.vehicleNumber !== void 0) item.vehicleNumber = body.vehicleNumber.trim().toUpperCase();
    if (body.vehicleType !== void 0) item.vehicleType = body.vehicleType;
    if (body.driverName !== void 0) item.driverName = body.driverName.trim();
    if (body.driverPhone !== void 0) item.driverPhone = normalizeNepalPhone(body.driverPhone) || body.driverPhone.trim();
    if (body.defaultCommissionMode !== void 0) item.defaultCommissionMode = body.defaultCommissionMode;
    if (body.defaultCommissionValue !== void 0) item.defaultCommissionValue = Math.max(0, Number(body.defaultCommissionValue) || 0);
    if (Array.isArray(body.caseOverrides)) item.caseOverrides = body.caseOverrides;
    if (body.active !== void 0) item.active = Boolean(body.active);
    saveDb(db);
    res.json({ ambulance: item, db: scopeDbForActor(db, actor) });
  });
  app.delete("/api/referrals/ambulances/:id", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    db.ambulancesMaster = (db.ambulancesMaster || []).filter((a) => a.id !== req.params.id);
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.post("/api/referrals/call-ack", withAuth(), (req, res) => {
    const { db, actor } = req;
    const { sourceType, sourceId, markWhatsapp } = req.body;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    let ref;
    let label = sourceId;
    if (sourceType === "OPD") {
      const v = (db.opdVisits || []).find((x) => x.id === sourceId);
      ref = v?.externalReferral;
      label = v?.tokenNumber || sourceId;
    } else if (sourceType === "ER") {
      const e = (db.emergencyCases || []).find((x) => x.id === sourceId);
      ref = e?.externalReferral;
      label = e?.erNumber || sourceId;
    } else if (sourceType === "IPD") {
      const a = (db.ipdAdmissions || []).find((x) => x.id === sourceId);
      ref = a?.externalReferral;
      label = a?.admissionNumber || sourceId;
    }
    if (!ref) {
      res.status(404).json({ error: "Referred encounter not found." });
      return;
    }
    if (markWhatsapp) {
      ref.whatsappSentAt = nowIso;
    } else {
      ref.managerNotifiedCalled = true;
      ref.managerCalledAt = nowIso;
      ref.managerCalledBy = actor.fullName;
    }
    appendAudit(
      db,
      actor,
      "REFERRALS",
      markWhatsapp ? "REFERRAL_MANAGER_WHATSAPP" : "REFERRAL_MANAGER_CALLED",
      label,
      `${actor.fullName} ${markWhatsapp ? "dispatched WhatsApp summary to" : "confirmed phone call with"} manager (${ref.referredHospitalManagerName || ref.referredToHospital}) for ${label}.`
    );
    saveDb(db);
    res.json({ ok: true, db: scopeDbForActor(db, actor) });
  });
  app.get("/api/referrals/patient-billing-tier", withAuth("referrals.view", "referrals_engine"), (req, res) => {
    const { db } = req;
    const uhid = String(req.query.uhid || "").trim();
    const caseType = String(req.query.caseType || "").trim();
    const ambulanceId = String(req.query.ambulanceId || "").trim();
    if (!uhid) {
      res.status(400).json({ error: "UHID is required." });
      return;
    }
    const ms = db.settings?.moduleSettings;
    const firstEr = (db.emergencyCases || []).find((e) => e.uhid === uhid);
    const firstAdm = (db.ipdAdmissions || []).find((a) => a.uhid === uhid);
    const orders = (db.orders || []).filter((o) => o.uhid === uhid);
    const erTotal = firstEr ? (Number(firstEr.erTicketFeeNpr) || 0) + (Number(firstEr.erChargesNpr) || 0) : 0;
    const admTotal = firstAdm ? Number(firstAdm.admissionFeeNpr) || 0 : 0;
    const posTotal = orders.reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
    const combinedFirstBillNpr = Number((erTotal + admTotal + posTotal).toFixed(2));
    const amb = ambulanceId ? (db.ambulancesMaster || []).find((a) => a.id === ambulanceId) : void 0;
    const ambRule = amb?.caseOverrides?.find((r) => r.active && r.caseType.toLowerCase() === caseType.toLowerCase());
    const globalRule = (ms?.referralCaseRules || []).find((r) => r.active && r.caseType.toLowerCase() === caseType.toLowerCase());
    const caseRule = ambRule || globalRule;
    const caseCommissionNpr = caseRule ? caseRule.mode === "PERCENT" ? Number((combinedFirstBillNpr * caseRule.value / 100).toFixed(2)) : Number(caseRule.value || 0) : amb ? amb.defaultCommissionMode === "PERCENT" ? Number((combinedFirstBillNpr * amb.defaultCommissionValue / 100).toFixed(2)) : Number(amb.defaultCommissionValue || 0) : 0;
    const matchingTier = [...ms?.referralBillTierRules || []].filter((t) => t.active && combinedFirstBillNpr >= t.minTotalBillNpr).sort((a, b) => b.minTotalBillNpr - a.minTotalBillNpr)[0];
    const tierCommissionNpr = matchingTier ? Number(matchingTier.commissionAmountNpr || 0) : 0;
    res.json({
      uhid,
      erTotal,
      admTotal,
      posTotal,
      combinedFirstBillNpr,
      caseRule: caseRule || null,
      caseCommissionNpr,
      matchingTier: matchingTier || null,
      tierCommissionNpr,
      totalDynamicCommissionNpr: Number((caseCommissionNpr + tierCommissionNpr).toFixed(2))
    });
  });
  app.post("/api/referrals/direct-external", withAuth("referrals.manage", "referrals_engine"), (req, res) => {
    const { db, actor } = req;
    const body = req.body;
    if (!body.referredToHospital?.trim() || !body.patientName?.trim()) {
      res.status(400).json({ error: "Referred Hospital and Patient Name are required." });
      return;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const bsNow = adToBs(nowIso);
    const matchingEr = body.uhid ? (db.emergencyCases || []).find((e) => e.uhid === body.uhid) : void 0;
    const matchingAdm = body.uhid ? (db.ipdAdmissions || []).find((a) => a.uhid === body.uhid) : void 0;
    const matchingOpd = body.uhid ? (db.opdVisits || []).find((v) => v.uhid === body.uhid) : void 0;
    const baseExt = {
      referredHospitalId: body.referredHospitalId || void 0,
      referredToHospital: body.referredToHospital.trim(),
      referredToPlace: body.referredToPlace?.trim() || "Nepal",
      referredHospitalManagerName: body.referredHospitalManagerName?.trim() || void 0,
      referredHospitalManagerPhone: body.referredHospitalManagerPhone?.trim() || void 0,
      referredDepartment: body.referredDepartment?.trim() || "Emergency / Tertiary Care",
      referralReason: body.referralReason?.trim() || "Referred via Referrals Desk",
      conditionAtReferral: body.conditionAtReferral?.trim() || "Stable / Under Transport",
      transportMode: body.transportMode || "ALS Ambulance",
      ambulanceId: body.ambulanceId || void 0,
      ambulanceName: body.ambulanceName?.trim() || void 0,
      ambulanceNumber: body.ambulanceNumber?.trim() || void 0,
      ambulanceDriverName: body.ambulanceDriverName?.trim() || void 0,
      ambulanceDriverPhone: body.ambulanceDriverPhone?.trim() || void 0,
      referralCaseType: body.referralCaseType?.trim() || void 0,
      commissionMode: body.commissionMode,
      commissionRateValue: body.commissionRateValue,
      commissionCalculatedNpr: body.commissionCalculatedNpr,
      commissionPartnerId: body.partnerId || void 0,
      departureTime: body.departureTime?.trim() || `${bsNow.formattedEn} ${bsNow.timeEn}`,
      caseDetails: body.caseDetails?.trim() || void 0,
      referredAt: nowIso,
      referredBy: actor.fullName
    };
    const enriched = attachEncounterBillingAndClinicalHistory(db, {
      baseReferral: baseExt,
      patientId: matchingAdm?.patientId || matchingEr?.patientId || matchingOpd?.patientId,
      uhid: body.uhid,
      patientName: body.patientName.trim(),
      patientPhone: body.patientPhone || "",
      encounterType: matchingAdm ? "IPD" : matchingEr ? "EMERGENCY" : "OPD",
      encounterId: matchingAdm?.id || matchingEr?.id || matchingOpd?.id,
      admission: matchingAdm,
      erCase: matchingEr,
      opdVisit: matchingOpd
    });
    if (matchingAdm) {
      matchingAdm.disposition = "Referred to External Hospital";
      matchingAdm.externalReferral = enriched;
    } else if (matchingEr) {
      matchingEr.disposition = "Referred to External Hospital";
      matchingEr.externalReferral = enriched;
    } else if (matchingOpd) {
      matchingOpd.disposition = "Referred to External Hospital";
      matchingOpd.externalReferral = enriched;
    } else {
      const pRec = upsertPatientMaster(db, {
        uhid: body.uhid,
        fullName: body.patientName.trim(),
        age: 35,
        ageType: "Years",
        gender: "Male",
        phone: body.patientPhone,
        actorName: actor.fullName
      });
      const opdVisit = {
        id: `opd-ref-${Date.now()}`,
        tokenNumber: `OPD-REF-${String((db.opdVisits || []).length + 1).padStart(3, "0")}`,
        visitDate: nowIso,
        fiscalYear: db.settings.activeFiscalYear || bsNow.fiscalYear,
        centerId: null,
        centerName: db.settings.labName,
        patientId: pRec.id,
        uhid: pRec.uhid,
        encounterLabel: "External Referral Log",
        patientName: pRec.fullName,
        patientAge: pRec.age,
        patientAgeType: pRec.ageType,
        patientGender: pRec.gender,
        patientPhone: pRec.phone,
        patientAddress: pRec.address,
        department: enriched.referredDepartment,
        consultingDoctor: actor.fullName,
        chiefComplaint: enriched.referralReason,
        vitals: {},
        provisionalDiagnosis: enriched.caseDetails || enriched.referralReason,
        clinicalNotes: enriched.clinicalHistorySummary || "",
        consultationFeeNpr: 0,
        paymentMode: "Cash",
        prescribedMedicines: [],
        investigations: [],
        disposition: "Referred to External Hospital",
        externalReferral: enriched,
        followUpAdvice: "",
        recordedBy: actor.fullName
      };
      db.opdVisits.unshift(opdVisit);
    }
    if (body.partnerId && (enriched.commissionCalculatedNpr || 0) > 0) {
      const partner = db.referrals.find((r) => r.id === body.partnerId);
      if (partner) {
        partner.totalCommissionEarned = Number(
          ((partner.totalCommissionEarned || 0) + (enriched.commissionCalculatedNpr || 0)).toFixed(2)
        );
      }
    }
    appendAudit(
      db,
      actor,
      "REFERRALS",
      "EXTERNAL_REFERRAL_RECORDED",
      body.uhid || body.patientName.trim(),
      `Recorded external referral for ${body.patientName.trim()} to ${enriched.referredToHospital} via ${enriched.ambulanceName || enriched.transportMode} (${enriched.ambulanceNumber || "\u2014"}). Dynamic commission: \u0930\u0942 ${enriched.commissionCalculatedNpr || 0}.`
    );
    saveDb(db);
    res.status(201).json({ externalReferral: enriched, db: scopeDbForActor(db, actor) });
  });
  const isBundledProd = import.meta.url.includes("dist-server");
  const isProduction = process.env.NODE_ENV === "production" || isBundledProd;
  if (!isProduction) {
    const disableHmr = process.env.DISABLE_HMR === "true";
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: disableHmr ? false : true
      },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.resolve(process.cwd(), "dist");
    const distIndex = path2.join(distPath, "index.html");
    if (fs2.existsSync(distIndex)) {
      app.use(
        express.static(distPath, {
          maxAge: "7d",
          etag: true
        })
      );
      app.get("*", (req, res) => {
        if (req.path.startsWith("/api/")) {
          res.status(404).json({ error: `API endpoint not found: ${req.path}` });
          return;
        }
        res.sendFile(distIndex);
      });
    } else {
      app.get("*", (req, res) => {
        if (req.path.startsWith("/api/")) {
          res.status(404).json({ error: `API endpoint not found: ${req.path}` });
          return;
        }
        res.status(503).send(
          "<h1>SHPL Production Frontend Bundle Not Built</h1><p>Run <code>npm run build</code> or upload pre-built <code>dist/</code> folder.</p>"
        );
      });
    }
  }
  const onListenSuccess = () => {
    if (typeof LISTEN_TARGET === "string") {
      console.log(`SHPL \u2014 Saptari Hospital ERP Server (${process.platform}) listening on socket ${LISTEN_TARGET}`);
      return;
    }
    const lanUrls = getLocalLanIps().map((ip) => `http://${ip}:${PORT}`);
    console.log(`SHPL \u2014 Saptari Hospital ERP Server (${process.platform}) listening on http://0.0.0.0:${PORT}`);
    if (lanUrls.length > 0) {
      console.log(`Same-Wi-Fi / LAN Client Access URL(s): ${lanUrls.join(" | ")}`);
    }
  };
  if (typeof LISTEN_TARGET === "string") {
    httpServer.listen(LISTEN_TARGET, onListenSuccess);
  } else {
    httpServer.listen(LISTEN_TARGET, "0.0.0.0", onListenSuccess);
  }
}
startServer();
