import type { LabServiceTest, PharmacyMedicine } from '../src/types/lims';

export interface NepalPharmaSeedItem {
  code: string;
  brandName: string;
  genericName: string;
  strength: string;
  dosageForm: PharmacyMedicine['dosageForm'];
  manufacturer: string;
  unitLabel: string;
  defaultMrpNpr: number;
  purchaseRateNpr: number;
  vatApplicable: boolean;
  reorderLevel: number;
  rackLocation: string;
  initialBatchQty: number;
}

export const NEPAL_PHARMA_COMPANIES: string[] = [
  'Deurali-Janta Pharma (DJPL)',
  'Quest Pharmaceuticals',
  'Lomus Pharmaceuticals',
  'National Healthcare (NHPL)',
  'Asian Pharmaceuticals',
  'Nepal Pharmaceuticals Lab (NPL)',
  'Magnus Pharma',
  'Time Pharmaceuticals',
  'Vega Pharmaceuticals',
  'Curex Pharmaceuticals',
  'CTL Pharmaceuticals',
  'S.R. Drug Laboratories',
  'Mark Formulation',
  'Simca Laboratories',
  'Royal Pharmaceuticals',
  'Omnica Laboratories',
  'QMed Formulation',
  'Hukum Pharmaceuticals',
  'Vijaydeep Laboratories',
  'Nepal Drug Ltd.',
  'Hospital ICU / Inside Formulary',
];

export const NEPAL_PHARMACY_CATALOG: NepalPharmaSeedItem[] = [
  // Deurali-Janta (DJPL)
  { code: 'NP-DJPL-001', brandName: 'Moxclav 625', genericName: 'Amoxicillin + Clavulanate', strength: '625 mg', dosageForm: 'Tablet', manufacturer: 'Deurali-Janta Pharma (DJPL)', unitLabel: 'Tab', defaultMrpNpr: 32, purchaseRateNpr: 24, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-A1', initialBatchQty: 300 },
  { code: 'NP-DJPL-002', brandName: 'Deupan 40', genericName: 'Pantoprazole', strength: '40 mg', dosageForm: 'Tablet', manufacturer: 'Deurali-Janta Pharma (DJPL)', unitLabel: 'Tab', defaultMrpNpr: 9, purchaseRateNpr: 6, vatApplicable: false, reorderLevel: 120, rackLocation: 'R-A2', initialBatchQty: 500 },
  { code: 'NP-DJPL-003', brandName: 'Azithro-DJ 500', genericName: 'Azithromycin', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'Deurali-Janta Pharma (DJPL)', unitLabel: 'Tab', defaultMrpNpr: 28, purchaseRateNpr: 20, vatApplicable: false, reorderLevel: 60, rackLocation: 'R-A1', initialBatchQty: 250 },
  { code: 'NP-DJPL-004', brandName: 'DJ-Cef 200', genericName: 'Cefixime', strength: '200 mg', dosageForm: 'Tablet', manufacturer: 'Deurali-Janta Pharma (DJPL)', unitLabel: 'Tab', defaultMrpNpr: 22, purchaseRateNpr: 15, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-A3', initialBatchQty: 300 },
  // Quest Pharmaceuticals
  { code: 'NP-QST-001', brandName: 'Q-Pan DSR', genericName: 'Pantoprazole + Domperidone SR', strength: '40mg + 30mg', dosageForm: 'Capsule', manufacturer: 'Quest Pharmaceuticals', unitLabel: 'Cap', defaultMrpNpr: 14, purchaseRateNpr: 9.5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-B1', initialBatchQty: 400 },
  { code: 'NP-QST-002', brandName: 'Amloquest 5', genericName: 'Amlodipine', strength: '5 mg', dosageForm: 'Tablet', manufacturer: 'Quest Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 6, purchaseRateNpr: 3.8, vatApplicable: false, reorderLevel: 150, rackLocation: 'R-B2', initialBatchQty: 600 },
  { code: 'NP-QST-003', brandName: 'Losarquest 50', genericName: 'Losartan Potassium', strength: '50 mg', dosageForm: 'Tablet', manufacturer: 'Quest Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 10, purchaseRateNpr: 6.5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-B2', initialBatchQty: 400 },
  { code: 'NP-QST-004', brandName: 'Glimequest M1', genericName: 'Glimepiride + Metformin', strength: '1mg + 500mg', dosageForm: 'Tablet', manufacturer: 'Quest Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 11, purchaseRateNpr: 7.5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-B3', initialBatchQty: 350 },
  // Lomus Pharmaceuticals
  { code: 'NP-LOM-001', brandName: 'Sinex Plus', genericName: 'Paracetamol + Phenylephrine + Chlorpheniramine', strength: '500/10/2 mg', dosageForm: 'Tablet', manufacturer: 'Lomus Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 5, purchaseRateNpr: 3.2, vatApplicable: false, reorderLevel: 150, rackLocation: 'R-C1', initialBatchQty: 600 },
  { code: 'NP-LOM-002', brandName: 'Flexon-NP', genericName: 'Ibuprofen + Paracetamol', strength: '400/500 mg', dosageForm: 'Tablet', manufacturer: 'Lomus Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 6, purchaseRateNpr: 4, vatApplicable: false, reorderLevel: 120, rackLocation: 'R-C1', initialBatchQty: 450 },
  { code: 'NP-LOM-003', brandName: 'Lomocef 1g', genericName: 'Ceftriaxone Sodium', strength: '1 gm IV/IM', dosageForm: 'Injection', manufacturer: 'Lomus Pharmaceuticals', unitLabel: 'Vial', defaultMrpNpr: 115, purchaseRateNpr: 78, vatApplicable: false, reorderLevel: 40, rackLocation: 'R-INJ1', initialBatchQty: 180 },
  // National Healthcare (NHPL)
  { code: 'NP-NHPL-001', brandName: 'Niko 500', genericName: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'National Healthcare (NHPL)', unitLabel: 'Tab', defaultMrpNpr: 2.5, purchaseRateNpr: 1.5, vatApplicable: false, reorderLevel: 250, rackLocation: 'R-C2', initialBatchQty: 1000 },
  { code: 'NP-NHPL-002', brandName: 'Ciprodac 500', genericName: 'Ciprofloxacin', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'National Healthcare (NHPL)', unitLabel: 'Tab', defaultMrpNpr: 12, purchaseRateNpr: 8, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-C2', initialBatchQty: 350 },
  { code: 'NP-NHPL-003', brandName: 'Ofloda 200', genericName: 'Ofloxacin', strength: '200 mg', dosageForm: 'Tablet', manufacturer: 'National Healthcare (NHPL)', unitLabel: 'Tab', defaultMrpNpr: 11, purchaseRateNpr: 7.2, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-C2', initialBatchQty: 300 },
  // Asian Pharmaceuticals
  { code: 'NP-ASN-001', brandName: 'Asozole 400', genericName: 'Albendazole', strength: '400 mg', dosageForm: 'Tablet', manufacturer: 'Asian Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 15, purchaseRateNpr: 9, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-D1', initialBatchQty: 300 },
  { code: 'NP-ASN-002', brandName: 'Asiclav 375', genericName: 'Amoxicillin + Clavulanate', strength: '375 mg', dosageForm: 'Tablet', manufacturer: 'Asian Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 22, purchaseRateNpr: 15, vatApplicable: false, reorderLevel: 60, rackLocation: 'R-D1', initialBatchQty: 250 },
  { code: 'NP-ASN-003', brandName: 'Asthavin', genericName: 'Salbutamol', strength: '4 mg', dosageForm: 'Tablet', manufacturer: 'Asian Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 3, purchaseRateNpr: 1.8, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-D2', initialBatchQty: 400 },
  // Nepal Pharmaceuticals Lab (NPL)
  { code: 'NP-NPL-001', brandName: 'Cetamol 500', genericName: 'Paracetamol', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'Nepal Pharmaceuticals Lab (NPL)', unitLabel: 'Tab', defaultMrpNpr: 2.5, purchaseRateNpr: 1.4, vatApplicable: false, reorderLevel: 250, rackLocation: 'R-D3', initialBatchQty: 900 },
  { code: 'NP-NPL-002', brandName: 'NPL-ORS', genericName: 'Oral Rehydration Salts WHO', strength: '20.5 gm Sachet', dosageForm: 'Consumable', manufacturer: 'Nepal Pharmaceuticals Lab (NPL)', unitLabel: 'Sachet', defaultMrpNpr: 20, purchaseRateNpr: 12, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-D3', initialBatchQty: 400 },
  { code: 'NP-NPL-003', brandName: 'Metron 400', genericName: 'Metronidazole', strength: '400 mg', dosageForm: 'Tablet', manufacturer: 'Nepal Pharmaceuticals Lab (NPL)', unitLabel: 'Tab', defaultMrpNpr: 4, purchaseRateNpr: 2.5, vatApplicable: false, reorderLevel: 150, rackLocation: 'R-D3', initialBatchQty: 500 },
  // Magnus Pharma
  { code: 'NP-MAG-001', brandName: 'Magclav 625', genericName: 'Amoxicillin + Clavulanate', strength: '625 mg', dosageForm: 'Tablet', manufacturer: 'Magnus Pharma', unitLabel: 'Tab', defaultMrpNpr: 30, purchaseRateNpr: 21, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-E1', initialBatchQty: 250 },
  { code: 'NP-MAG-002', brandName: 'Rosumag 10', genericName: 'Rosuvastatin', strength: '10 mg', dosageForm: 'Tablet', manufacturer: 'Magnus Pharma', unitLabel: 'Tab', defaultMrpNpr: 16, purchaseRateNpr: 11, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-E1', initialBatchQty: 300 },
  { code: 'NP-MAG-003', brandName: 'Atormag 20', genericName: 'Atorvastatin', strength: '20 mg', dosageForm: 'Tablet', manufacturer: 'Magnus Pharma', unitLabel: 'Tab', defaultMrpNpr: 18, purchaseRateNpr: 12, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-E1', initialBatchQty: 300 },
  // Time Pharmaceuticals
  { code: 'NP-TIM-001', brandName: 'Cetiriz-T 10', genericName: 'Cetirizine', strength: '10 mg', dosageForm: 'Tablet', manufacturer: 'Time Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 4, purchaseRateNpr: 2.2, vatApplicable: false, reorderLevel: 150, rackLocation: 'R-E2', initialBatchQty: 500 },
  { code: 'NP-TIM-002', brandName: 'Time-Mont LC', genericName: 'Montelukast + Levocetirizine', strength: '10mg + 5mg', dosageForm: 'Tablet', manufacturer: 'Time Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 15, purchaseRateNpr: 10, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-E2', initialBatchQty: 350 },
  { code: 'NP-TIM-003', brandName: 'Aceclo-T Plus', genericName: 'Aceclofenac + Paracetamol', strength: '100mg + 325mg', dosageForm: 'Tablet', manufacturer: 'Time Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 10, purchaseRateNpr: 6.5, vatApplicable: false, reorderLevel: 120, rackLocation: 'R-E2', initialBatchQty: 400 },
  // Vega Pharmaceuticals
  { code: 'NP-VEG-001', brandName: 'Vegapan 40', genericName: 'Pantoprazole', strength: '40 mg', dosageForm: 'Tablet', manufacturer: 'Vega Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 9, purchaseRateNpr: 5.5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-F1', initialBatchQty: 350 },
  { code: 'NP-VEG-002', brandName: 'Vegacef 500', genericName: 'Cefuroxime Axetil', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'Vega Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 42, purchaseRateNpr: 30, vatApplicable: false, reorderLevel: 50, rackLocation: 'R-F1', initialBatchQty: 180 },
  // Curex Pharmaceuticals
  { code: 'NP-CUR-001', brandName: 'Curesyrup Cough', genericName: 'Dextromethorphan + CPM', strength: '100 mL', dosageForm: 'Syrup', manufacturer: 'Curex Pharmaceuticals', unitLabel: 'Bottle', defaultMrpNpr: 95, purchaseRateNpr: 65, vatApplicable: false, reorderLevel: 30, rackLocation: 'R-SYR1', initialBatchQty: 100 },
  { code: 'NP-CUR-002', brandName: 'Curezine Drops', genericName: 'Multivitamin Pediatric Drops', strength: '30 mL', dosageForm: 'Drops', manufacturer: 'Curex Pharmaceuticals', unitLabel: 'Bottle', defaultMrpNpr: 85, purchaseRateNpr: 58, vatApplicable: false, reorderLevel: 25, rackLocation: 'R-SYR1', initialBatchQty: 90 },
  // CTL Pharmaceuticals
  { code: 'NP-CTL-001', brandName: 'CTL-Amox 500', genericName: 'Amoxicillin', strength: '500 mg', dosageForm: 'Capsule', manufacturer: 'CTL Pharmaceuticals', unitLabel: 'Cap', defaultMrpNpr: 11, purchaseRateNpr: 7, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-F2', initialBatchQty: 400 },
  { code: 'NP-CTL-002', brandName: 'CTL-Doxy 100', genericName: 'Doxycycline', strength: '100 mg', dosageForm: 'Capsule', manufacturer: 'CTL Pharmaceuticals', unitLabel: 'Cap', defaultMrpNpr: 8, purchaseRateNpr: 5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-F2', initialBatchQty: 350 },
  // S.R. Drug Laboratories
  { code: 'NP-SRD-001', brandName: 'SR-Ome 20', genericName: 'Omeprazole', strength: '20 mg', dosageForm: 'Capsule', manufacturer: 'S.R. Drug Laboratories', unitLabel: 'Cap', defaultMrpNpr: 6, purchaseRateNpr: 3.5, vatApplicable: false, reorderLevel: 150, rackLocation: 'R-F3', initialBatchQty: 500 },
  { code: 'NP-SRD-002', brandName: 'SR-Ferro XT', genericName: 'Ferrous Ascorbate + Folic Acid', strength: '100mg + 1.5mg', dosageForm: 'Tablet', manufacturer: 'S.R. Drug Laboratories', unitLabel: 'Tab', defaultMrpNpr: 14, purchaseRateNpr: 9, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-F3', initialBatchQty: 400 },
  // Mark Formulation
  { code: 'NP-MRK-001', brandName: 'Mark-D3 60K', genericName: 'Cholecalciferol (Vitamin D3)', strength: '60,000 IU', dosageForm: 'Capsule', manufacturer: 'Mark Formulation', unitLabel: 'Cap', defaultMrpNpr: 35, purchaseRateNpr: 22, vatApplicable: false, reorderLevel: 50, rackLocation: 'R-G1', initialBatchQty: 200 },
  { code: 'NP-MRK-002', brandName: 'Mark-Cal D3', genericName: 'Calcium Carbonate + Vitamin D3', strength: '500mg + 250IU', dosageForm: 'Tablet', manufacturer: 'Mark Formulation', unitLabel: 'Tab', defaultMrpNpr: 12, purchaseRateNpr: 7.5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-G1', initialBatchQty: 400 },
  // Simca Laboratories
  { code: 'NP-SMC-001', brandName: 'Simca-Levo 500', genericName: 'Levofloxacin', strength: '500 mg', dosageForm: 'Tablet', manufacturer: 'Simca Laboratories', unitLabel: 'Tab', defaultMrpNpr: 19, purchaseRateNpr: 13, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-G2', initialBatchQty: 250 },
  { code: 'NP-SMC-002', brandName: 'Simca-Povidone Oint', genericName: 'Povidone-Iodine 5% Ointment', strength: '20 gm Tube', dosageForm: 'Ointment', manufacturer: 'Simca Laboratories', unitLabel: 'Tube', defaultMrpNpr: 68, purchaseRateNpr: 44, vatApplicable: true, reorderLevel: 30, rackLocation: 'R-OINT', initialBatchQty: 120 },
  // Royal Pharmaceuticals
  { code: 'NP-RYL-001', brandName: 'Roy-Azithro Susp', genericName: 'Azithromycin Oral Suspension', strength: '200mg/5mL (15mL)', dosageForm: 'Syrup', manufacturer: 'Royal Pharmaceuticals', unitLabel: 'Bottle', defaultMrpNpr: 92, purchaseRateNpr: 62, vatApplicable: false, reorderLevel: 30, rackLocation: 'R-SYR2', initialBatchQty: 100 },
  { code: 'NP-RYL-002', brandName: 'Roy-Rab 20', genericName: 'Rabeprazole Sodium', strength: '20 mg', dosageForm: 'Tablet', manufacturer: 'Royal Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 9, purchaseRateNpr: 5.8, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-G3', initialBatchQty: 350 },
  // Omnica Laboratories
  { code: 'NP-OMN-001', brandName: 'Omni-Mox 250 DT', genericName: 'Amoxicillin Dispersible', strength: '250 mg', dosageForm: 'Tablet', manufacturer: 'Omnica Laboratories', unitLabel: 'Tab', defaultMrpNpr: 7, purchaseRateNpr: 4.5, vatApplicable: false, reorderLevel: 100, rackLocation: 'R-H1', initialBatchQty: 300 },
  { code: 'NP-OMN-002', brandName: 'Omni-Dom 10', genericName: 'Domperidone', strength: '10 mg', dosageForm: 'Tablet', manufacturer: 'Omnica Laboratories', unitLabel: 'Tab', defaultMrpNpr: 4.5, purchaseRateNpr: 2.8, vatApplicable: false, reorderLevel: 120, rackLocation: 'R-H1', initialBatchQty: 400 },
  // QMed Formulation
  { code: 'NP-QMD-001', brandName: 'QMed-Pregab M', genericName: 'Pregabalin + Methylcobalamin', strength: '75mg + 750mcg', dosageForm: 'Capsule', manufacturer: 'QMed Formulation', unitLabel: 'Cap', defaultMrpNpr: 24, purchaseRateNpr: 16, vatApplicable: false, reorderLevel: 60, rackLocation: 'R-H2', initialBatchQty: 200 },
  { code: 'NP-QMD-002', brandName: 'QMed-Telmi 40', genericName: 'Telmisartan', strength: '40 mg', dosageForm: 'Tablet', manufacturer: 'QMed Formulation', unitLabel: 'Tab', defaultMrpNpr: 14, purchaseRateNpr: 9, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-H2', initialBatchQty: 300 },
  // Hukum Pharmaceuticals
  { code: 'NP-HKM-001', brandName: 'Hukum-Diclo 50', genericName: 'Diclofenac Sodium', strength: '50 mg', dosageForm: 'Tablet', manufacturer: 'Hukum Pharmaceuticals', unitLabel: 'Tab', defaultMrpNpr: 4, purchaseRateNpr: 2.4, vatApplicable: false, reorderLevel: 120, rackLocation: 'R-H3', initialBatchQty: 400 },
  { code: 'NP-HKM-002', brandName: 'Hukum-Metro IV', genericName: 'Metronidazole IV Infusion', strength: '500mg / 100mL', dosageForm: 'IV Fluid', manufacturer: 'Hukum Pharmaceuticals', unitLabel: 'Bottle', defaultMrpNpr: 62, purchaseRateNpr: 40, vatApplicable: false, reorderLevel: 60, rackLocation: 'R-IV1', initialBatchQty: 250 },
  // Vijaydeep Laboratories
  { code: 'NP-VJD-001', brandName: 'Vijay-NS 0.9%', genericName: 'Sodium Chloride 0.9% IV Fluid', strength: '500 mL', dosageForm: 'IV Fluid', manufacturer: 'Vijaydeep Laboratories', unitLabel: 'Bottle', defaultMrpNpr: 78, purchaseRateNpr: 48, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-IV1', initialBatchQty: 400 },
  { code: 'NP-VJD-002', brandName: 'Vijay-RL', genericName: 'Ringer Lactate IV Solution', strength: '500 mL', dosageForm: 'IV Fluid', manufacturer: 'Vijaydeep Laboratories', unitLabel: 'Bottle', defaultMrpNpr: 82, purchaseRateNpr: 52, vatApplicable: false, reorderLevel: 80, rackLocation: 'R-IV1', initialBatchQty: 350 },
  { code: 'NP-VJD-003', brandName: 'Vijay-DNS', genericName: 'Dextrose 5% + Normal Saline', strength: '500 mL', dosageForm: 'IV Fluid', manufacturer: 'Vijaydeep Laboratories', unitLabel: 'Bottle', defaultMrpNpr: 84, purchaseRateNpr: 54, vatApplicable: false, reorderLevel: 60, rackLocation: 'R-IV1', initialBatchQty: 300 },
  // Hospital ICU / Inside Formulary (Ward/ER/OT Injections & Inside Consumables)
  { code: 'IN-ICU-001', brandName: 'Pantop-IV 40', genericName: 'Pantoprazole IV Injection', strength: '40 mg Vial', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Vial', defaultMrpNpr: 75, purchaseRateNpr: 48, vatApplicable: false, reorderLevel: 50, rackLocation: 'R-INJ1', initialBatchQty: 220 },
  { code: 'IN-ICU-002', brandName: 'Ondem-IV 4mg', genericName: 'Ondansetron Injection', strength: '4 mg / 2 mL', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Amp', defaultMrpNpr: 34, purchaseRateNpr: 20, vatApplicable: false, reorderLevel: 60, rackLocation: 'R-INJ1', initialBatchQty: 280 },
  { code: 'IN-ICU-003', brandName: 'Pipzo-4.5g', genericName: 'Piperacillin + Tazobactam IV', strength: '4.5 gm Vial', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Vial', defaultMrpNpr: 390, purchaseRateNpr: 270, vatApplicable: false, reorderLevel: 30, rackLocation: 'R-INJ2', initialBatchQty: 120 },
  { code: 'IN-ICU-004', brandName: 'Mero-1g IV', genericName: 'Meropenem Trihydrate IV', strength: '1 gm Vial', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Vial', defaultMrpNpr: 680, purchaseRateNpr: 490, vatApplicable: false, reorderLevel: 20, rackLocation: 'R-INJ2', initialBatchQty: 80 },
  { code: 'IN-ICU-005', brandName: 'Ketorol-30 IM/IV', genericName: 'Ketorolac Tromethamine Inj', strength: '30 mg / mL', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Amp', defaultMrpNpr: 38, purchaseRateNpr: 22, vatApplicable: false, reorderLevel: 50, rackLocation: 'R-INJ1', initialBatchQty: 200 },
  { code: 'IN-ICU-006', brandName: 'Lasix 20mg Inj', genericName: 'Furosemide Injection', strength: '20 mg / 2 mL', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Amp', defaultMrpNpr: 24, purchaseRateNpr: 14, vatApplicable: false, reorderLevel: 50, rackLocation: 'R-INJ1', initialBatchQty: 200 },
  { code: 'IN-ICU-007', brandName: 'Hydrocort-100', genericName: 'Hydrocortisone Sodium Succinate', strength: '100 mg Vial', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Vial', defaultMrpNpr: 78, purchaseRateNpr: 52, vatApplicable: false, reorderLevel: 40, rackLocation: 'R-INJ1', initialBatchQty: 150 },
  { code: 'IN-ICU-008', brandName: 'Adrenaline 1mg', genericName: 'Epinephrine Injection', strength: '1 mg / mL', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Amp', defaultMrpNpr: 28, purchaseRateNpr: 16, vatApplicable: false, reorderLevel: 40, rackLocation: 'R-ER1', initialBatchQty: 160 },
  { code: 'IN-ICU-009', brandName: 'Norad-4mg', genericName: 'Noradrenaline Bitartrate', strength: '4 mg / 2 mL', dosageForm: 'Injection', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Amp', defaultMrpNpr: 145, purchaseRateNpr: 95, vatApplicable: false, reorderLevel: 20, rackLocation: 'R-ER1', initialBatchQty: 90 },
  { code: 'IN-ICU-010', brandName: 'Paracet-IV 100ml', genericName: 'Paracetamol IV Infusion', strength: '1000mg / 100mL', dosageForm: 'IV Fluid', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Bottle', defaultMrpNpr: 165, purchaseRateNpr: 110, vatApplicable: false, reorderLevel: 40, rackLocation: 'R-IV2', initialBatchQty: 160 },
  { code: 'IN-CON-001', brandName: 'IV Cannula 20G Pink', genericName: 'IV Catheter w/ Injection Port', strength: '20G', dosageForm: 'Consumable', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Pcs', defaultMrpNpr: 45, purchaseRateNpr: 25, vatApplicable: true, reorderLevel: 100, rackLocation: 'R-CON1', initialBatchQty: 400 },
  { code: 'IN-CON-002', brandName: 'IV Infusion Set', genericName: 'Sterile Vented IV Drip Set', strength: 'Standard', dosageForm: 'Consumable', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Pcs', defaultMrpNpr: 40, purchaseRateNpr: 22, vatApplicable: true, reorderLevel: 100, rackLocation: 'R-CON1', initialBatchQty: 400 },
  { code: 'IN-CON-003', brandName: 'Foley Catheter 16Fr', genericName: '2-Way Silicone Foley Catheter', strength: '16 Fr', dosageForm: 'Consumable', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Pcs', defaultMrpNpr: 160, purchaseRateNpr: 95, vatApplicable: true, reorderLevel: 30, rackLocation: 'R-CON2', initialBatchQty: 120 },
  { code: 'IN-CON-004', brandName: 'Sterile Surgical Gloves', genericName: 'Latex Powder-Free Gloves', strength: '7.5 Pair', dosageForm: 'Consumable', manufacturer: 'Hospital ICU / Inside Formulary', unitLabel: 'Pair', defaultMrpNpr: 55, purchaseRateNpr: 34, vatApplicable: true, reorderLevel: 80, rackLocation: 'R-CON2', initialBatchQty: 300 },
];

export interface NepalServiceSeedItem {
  code: string;
  name: string;
  serviceCategory: LabServiceTest['serviceCategory'];
  customCategory: string;
  modality?: LabServiceTest['modality'];
  department: LabServiceTest['department'];
  specimenType: string;
  containerType: string;
  methodology: string;
  tatMinutes: number;
  price: number;
}

export const NEPAL_HOSPITAL_SERVICES_CATALOG: NepalServiceSeedItem[] = [
  // Conventional X-Ray (All Kinds)
  { code: 'XR-CXR-PA', name: 'X-Ray Chest (PA View)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 45, price: 450 },
  { code: 'XR-CXR-APL', name: 'X-Ray Chest (AP & Lateral)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 60, price: 750 },
  { code: 'XR-SKULL', name: 'X-Ray Skull (AP & Lateral)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 10x12', methodology: 'Conventional Radiography', tatMinutes: 60, price: 650 },
  { code: 'XR-PNS', name: 'X-Ray PNS (Water View)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 8x10', methodology: 'Conventional Radiography', tatMinutes: 45, price: 450 },
  { code: 'XR-CSPINE', name: 'X-Ray Cervical Spine (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 10x12', methodology: 'Conventional Radiography', tatMinutes: 60, price: 700 },
  { code: 'XR-LSPINE', name: 'X-Ray Lumbosacral Spine (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 60, price: 800 },
  { code: 'XR-TSPINE', name: 'X-Ray Thoracic Spine (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 60, price: 800 },
  { code: 'XR-PELVIS', name: 'X-Ray Pelvis with Both Hips (AP)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 45, price: 600 },
  { code: 'XR-KNEE', name: 'X-Ray Knee Joint (AP & Lateral)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 10x12', methodology: 'Conventional Radiography', tatMinutes: 45, price: 600 },
  { code: 'XR-ANKLE', name: 'X-Ray Ankle Joint (AP & Lateral)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 8x10', methodology: 'Conventional Radiography', tatMinutes: 45, price: 550 },
  { code: 'XR-SHOULDER', name: 'X-Ray Shoulder Joint (AP & Axial)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 10x12', methodology: 'Conventional Radiography', tatMinutes: 45, price: 600 },
  { code: 'XR-ELBOW', name: 'X-Ray Elbow / Forearm (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 8x10', methodology: 'Conventional Radiography', tatMinutes: 45, price: 550 },
  { code: 'XR-WRIST', name: 'X-Ray Wrist / Hand (AP & Oblique)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 8x10', methodology: 'Conventional Radiography', tatMinutes: 45, price: 500 },
  { code: 'XR-ABD-ERECT', name: 'X-Ray Abdomen Erect & Supine', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 60, price: 750 },
  { code: 'XR-KUB', name: 'X-Ray KUB (Plain)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Conventional X-Ray', containerType: 'X-Ray Film 14x17', methodology: 'Conventional Radiography', tatMinutes: 45, price: 550 },

  // DR X-Ray (Digital Radiography)
  { code: 'DR-CXR-PA', name: 'DR X-Ray Chest (PA Digital)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector + CD/Print', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 25, price: 650 },
  { code: 'DR-CXR-PORT', name: 'DR X-Ray Chest Portable (ICU/ER Bedside)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Portable DR X-Ray', containerType: 'Mobile DR Unit', methodology: 'Bedside Digital Radiography', tatMinutes: 30, price: 950 },
  { code: 'DR-LSPINE', name: 'DR X-Ray Lumbosacral Spine (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 30, price: 1100 },
  { code: 'DR-CSPINE', name: 'DR X-Ray Cervical Spine (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 30, price: 950 },
  { code: 'DR-PELVIS', name: 'DR X-Ray Pelvis / Both Hips (AP)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 30, price: 850 },
  { code: 'DR-KNEE', name: 'DR X-Ray Knee / Ankle / Extremity (AP & Lat)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 30, price: 850 },
  { code: 'DR-KUB', name: 'DR X-Ray KUB / Abdomen Erect', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 30, price: 850 },
  { code: 'DR-PNS', name: 'DR X-Ray PNS / Nasal Bone', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'X-RAY', department: 'Radiology', specimenType: 'Digital Radiography (DR)', containerType: 'DR Digital Detector', methodology: 'Flat-Panel DR X-Ray', tatMinutes: 25, price: 650 },

  // USG (Ultrasound & Color Doppler)
  { code: 'USG-WABD', name: 'USG Whole Abdomen', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'USG Gel & Thermal Print', methodology: 'B-Mode High-Res Ultrasound', tatMinutes: 45, price: 1100 },
  { code: 'USG-ABDPEL', name: 'USG Abdomen & Pelvis (Complete)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'USG Gel & Thermal Print', methodology: 'B-Mode High-Res Ultrasound', tatMinutes: 45, price: 1300 },
  { code: 'USG-PELVIS', name: 'USG Pelvis (Gynecology / Lower Abdomen)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'USG Gel', methodology: 'Transabdominal Pelvis USG', tatMinutes: 40, price: 950 },
  { code: 'USG-TVS', name: 'USG TVS (Transvaginal Sonography)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'Endocavitary Probe Cover', methodology: 'Transvaginal Ultrasound', tatMinutes: 45, price: 1500 },
  { code: 'USG-OBS', name: 'USG Obstetric (Pregnancy Growth & FWB)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'USG Gel & Thermal Print', methodology: 'Obstetric Biometry USG', tatMinutes: 45, price: 1200 },
  { code: 'USG-ANOMALY', name: 'USG Level-II Anomaly Scan (18-22 Weeks)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'USG 4D/High-Res', methodology: 'Targeted Fetal Anomaly Scan', tatMinutes: 60, price: 2400 },
  { code: 'USG-KUB', name: 'USG KUB + Prostate / Post-Void Residual', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'USG Gel', methodology: 'B-Mode Renal & Bladder USG', tatMinutes: 40, price: 1050 },
  { code: 'USG-THYROID', name: 'USG Thyroid & Neck High-Frequency', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'Linear Probe USG', methodology: 'High-Frequency Linear USG', tatMinutes: 40, price: 1200 },
  { code: 'USG-BREAST', name: 'USG Bilateral Breast & Axilla', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'Linear Probe USG', methodology: 'High-Frequency Breast USG', tatMinutes: 45, price: 1400 },
  { code: 'USG-SCROTUM', name: 'USG Scrotum & Inguinal Region', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Ultrasound', containerType: 'Linear Probe + Doppler', methodology: 'High-Frequency Scrotal USG', tatMinutes: 45, price: 1350 },
  { code: 'USG-DOP-LL', name: 'USG Color Doppler Lower Limb (Arterial/Venous)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Color Doppler', containerType: 'Linear Probe', methodology: 'Duplex Color Doppler', tatMinutes: 60, price: 2600 },
  { code: 'USG-DOP-CAR', name: 'USG Carotid & Vertebral Color Doppler', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Color Doppler', containerType: 'Linear Probe', methodology: 'Duplex Carotid Doppler', tatMinutes: 60, price: 2500 },
  { code: 'USG-PORTABLE', name: 'USG Portable Bedside (ER/ICU eFAST)', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'USG', department: 'Radiology', specimenType: 'Portable Ultrasound', containerType: 'Bedside Probe', methodology: 'Point-of-Care eFAST / Bedside USG', tatMinutes: 25, price: 1600 },

  // ECG, Echo & Clinical Procedures
  { code: 'CARD-ECG', name: '12-Lead Digital ECG (Electrocardiogram)', serviceCategory: 'HOSPITAL_PROCEDURE', customCategory: 'Procedures', modality: 'ECG', department: 'Emergency & Procedures', specimenType: 'Cardiac Tracing', containerType: 'Thermal ECG Strip', methodology: '12-Lead Digital ECG', tatMinutes: 20, price: 350 },
  { code: 'CARD-ECHO', name: '2D Echocardiography with Color Doppler', serviceCategory: 'RADIOLOGY', customCategory: 'Radiology', modality: 'ECHO', department: 'Radiology', specimenType: 'Cardiac Ultrasound', containerType: 'Phased Array Probe', methodology: '2D Echo & M-Mode Doppler', tatMinutes: 60, price: 2200 },
  { code: 'PROC-NEB', name: 'Nebulization Session (Bronchodilator)', serviceCategory: 'HOSPITAL_PROCEDURE', customCategory: 'Procedures', department: 'Emergency & Procedures', specimenType: 'Procedure', containerType: 'Nebulizer Mask', methodology: 'Aerosol Inhalation', tatMinutes: 20, price: 150 },
  { code: 'PROC-DRESS-S', name: 'Wound Dressing (Simple / Clean)', serviceCategory: 'HOSPITAL_PROCEDURE', customCategory: 'Procedures', department: 'Emergency & Procedures', specimenType: 'Procedure', containerType: 'Sterile Dressing Pack', methodology: 'Aseptic Dressing', tatMinutes: 30, price: 250 },
  { code: 'PROC-SUTURE-M', name: 'Laceration Suturing (Medium 4-8 Stitches)', serviceCategory: 'HOSPITAL_PROCEDURE', customCategory: 'Procedures', department: 'Emergency & Procedures', specimenType: 'Procedure', containerType: 'Suture Kit + LA', methodology: 'Minor OT Surgical Repair', tatMinutes: 45, price: 950 },
  { code: 'PROC-CATH', name: 'Foley Urinary Catheterization (Procedure)', serviceCategory: 'HOSPITAL_PROCEDURE', customCategory: 'Procedures', department: 'Nursing & Ward', specimenType: 'Procedure', containerType: 'Aseptic Catheter Tray', methodology: 'Sterile Catheterization', tatMinutes: 30, price: 450 },
  { code: 'PROC-POP-S', name: 'Below-Knee / Forearm POP Slab / Cast', serviceCategory: 'HOSPITAL_PROCEDURE', customCategory: 'Ortho & Plaster', department: 'Ortho & Plaster', specimenType: 'Orthopedic Plaster', containerType: 'Gypsona POP Bandage', methodology: 'Orthopedic Immobilization', tatMinutes: 45, price: 1400 },
];
