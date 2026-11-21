import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BedDouble,
  ClipboardList,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Landmark,
  MapPin,
  Package,
  Pill,
  Scan,
  ScrollText,
  Search,
  Share2,
  ShieldCheck,
  Siren,
  Stethoscope,
  UserCheck,
  X,
} from 'lucide-react';
import type { LimsDatabase } from '../types/lims';
import { formatNpr } from '../utils/nepaliDate';

export interface SearchJumpTarget {
  tab: string;
  query: string;
}

export type ErpSearchCategory = 'Patients' | 'Orders' | 'Inventory' | 'Finance';

interface GlobalErpSearchModalProps {
  isOpen: boolean;
  db: LimsDatabase;
  allowedTabs: Set<string>;
  onClose: () => void;
  onSelectTarget: (target: SearchJumpTarget) => void;
}

interface SearchHit {
  id: string;
  category: ErpSearchCategory;
  tab: string;
  moduleLabel: string;
  title: string;
  subtitle: string;
  jumpQuery: string;
  icon: React.ComponentType<{ className?: string }>;
}

const CATEGORIES: ErpSearchCategory[] = ['Patients', 'Orders', 'Inventory', 'Finance'];

export function GlobalErpSearchModal({
  isOpen,
  db,
  allowedTabs,
  onClose,
  onSelectTarget,
}: GlobalErpSearchModalProps) {
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | ErpSearchCategory>('ALL');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery('');
      setCategoryFilter('ALL');
    }
  }, [isOpen]);

  const indexedHits: SearchHit[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits: SearchHit[] = [];

    const pushIf = (hit: SearchHit, haystack: string) => {
      if (!allowedTabs.has(hit.tab)) return;
      if (!q || haystack.toLowerCase().includes(q)) {
        hits.push(hit);
      }
    };

    // 1. PATIENTS (Registered UHID, OPD, IPD, ER/MLC, Birth & Death Certificates)
    for (const pt of db.patients || []) {
      pushIf(
        {
          id: `pt-${pt.id}`,
          category: 'Patients',
          tab: 'patients',
          moduleLabel: 'Patient Master',
          title: `${pt.uhid} — ${pt.fullName}`,
          subtitle: `${pt.age} ${pt.ageType} / ${pt.gender} · ${pt.phone} · ${pt.address}`,
          jumpQuery: pt.uhid,
          icon: UserCheck,
        },
        `${pt.uhid} ${pt.fullName} ${pt.phone} ${pt.address} ${pt.pastMedicalHistory || ''}`
      );
    }

    for (const ov of db.opdVisits || []) {
      pushIf(
        {
          id: `opd-${ov.id}`,
          category: 'Patients',
          tab: 'opd',
          moduleLabel: 'OPD Clinic',
          title: `${ov.tokenNumber} — ${ov.patientName}`,
          subtitle: `${ov.department} · ${ov.consultingDoctor} · ${ov.disposition}`,
          jumpQuery: ov.tokenNumber,
          icon: Stethoscope,
        },
        `${ov.tokenNumber} ${ov.patientName} ${ov.patientPhone} ${ov.consultingDoctor} ${ov.provisionalDiagnosis} ${ov.externalReferral?.referredToHospital || ''}`
      );
    }

    for (const ipd of db.ipdAdmissions || []) {
      pushIf(
        {
          id: `ipd-${ipd.id}`,
          category: 'Patients',
          tab: 'ipd',
          moduleLabel: 'IPD Ward',
          title: `${ipd.admissionNumber} — ${ipd.patientName}`,
          subtitle: `Bed ${ipd.currentBedLabel} · ${ipd.disposition}${
            ipd.externalReferral
              ? ` → ${ipd.externalReferral.referredToHospital}`
              : ''
          }`,
          jumpQuery: ipd.admissionNumber,
          icon: BedDouble,
        },
        `${ipd.admissionNumber} ${ipd.patientName} ${ipd.patientPhone} ${ipd.currentBedLabel} ${ipd.currentWardName} ${ipd.admittingDiagnosis} ${ipd.finalDiagnosis}`
      );
    }

    for (const er of db.emergencyCases || []) {
      pushIf(
        {
          id: `er-${er.id}`,
          category: 'Patients',
          tab: 'emergency',
          moduleLabel: er.isMlc ? 'ER & MLC Case' : 'Emergency ER',
          title: `${er.erNumber} — ${er.patientName}`,
          subtitle: `${er.triageLevel} · ${
            er.isMlc
              ? `MLC ${er.mlcNumber || ''} (${er.policeInformed ? 'Police Informed' : 'Police Pending'})`
              : er.chiefComplaint
          }`,
          jumpQuery: er.erNumber,
          icon: Siren,
        },
        `${er.erNumber} ${er.mlcNumber || ''} ${er.patientName} ${er.patientPhone} ${er.chiefComplaint} ${er.policeStationName || ''} ${er.incidentPlace || ''}`
      );
    }

    for (const bc of db.birthCertificates || []) {
      const childLabel = bc.babyName || `Baby of ${bc.motherName}`;
      pushIf(
        {
          id: `bc-${bc.id}`,
          category: 'Patients',
          tab: 'ipd',
          moduleLabel: 'Birth Certificate',
          title: `${bc.certificateNumber} — ${childLabel}`,
          subtitle: `Mother: ${bc.motherName} · BS ${bc.birthDateBs} · ${bc.deliveryType}`,
          jumpQuery: bc.certificateNumber,
          icon: FileText,
        },
        `${bc.certificateNumber} ${childLabel} ${bc.motherName} ${bc.fatherName} ${bc.permanentAddress}`
      );
    }

    for (const dth of db.deathCertificates || []) {
      pushIf(
        {
          id: `dth-${dth.id}`,
          category: 'Patients',
          tab: 'ipd',
          moduleLabel: 'Death Certificate',
          title: `${dth.certificateNumber} — ${dth.deceasedName}`,
          subtitle: `Cause: ${dth.immediateCauseOfDeath} · BS ${dth.deathDateBs}`,
          jumpQuery: dth.certificateNumber,
          icon: FileText,
        },
        `${dth.certificateNumber} ${dth.deceasedName} ${dth.immediateCauseOfDeath} ${dth.permanentAddress}`
      );
    }

    // 2. ORDERS (Lab, Radiology, Service Catalog, Darta/Chalani, DHIS2)
    for (const o of db.orders) {
      const isRad = o.tests.some(
        (t) => t.serviceCategory === 'RADIOLOGY' || t.department === 'Radiology'
      );
      pushIf(
        {
          id: `ord-${o.id}`,
          category: 'Orders',
          tab: isRad && allowedTabs.has('radiology') ? 'radiology' : 'orders',
          moduleLabel: isRad ? 'Radiology Order' : 'Lab Order & TAT',
          title: `${o.accessionNumber} — ${o.patientName}`,
          subtitle: `Bill ${o.invoiceNumber} · ${o.status} · ${o.encounterLabel || o.uhid || 'Hospital POS'} · ${formatNpr(o.totalAmount)}`,
          jumpQuery: o.accessionNumber,
          icon: isRad ? Scan : Activity,
        },
        `${o.patientName} ${o.uhid || ''} ${o.encounterLabel || ''} ${o.accessionNumber} ${o.invoiceNumber} ${o.patientPhone} ${o.referringDoctor} ${o.tests
          .map((t) => `${t.serviceCode} ${t.serviceName}`)
          .join(' ')}`
      );
    }

    for (const s of db.services) {
      pushIf(
        {
          id: `srv-${s.id}`,
          category: 'Orders',
          tab: 'services',
          moduleLabel: 'Diagnostic Test',
          title: `${s.code} — ${s.name}`,
          subtitle: `${s.department} · TAT ${s.tatMinutes}m · ${formatNpr(s.price)}`,
          jumpQuery: s.code,
          icon: ClipboardList,
        },
        `${s.code} ${s.name} ${s.department} ${s.methodology} ${s.specimenType}`
      );
    }

    for (const dc of db.dartaChalani || []) {
      pushIf(
        {
          id: `dc-${dc.id}`,
          category: 'Orders',
          tab: 'darta',
          moduleLabel: dc.entryType === 'DARTA' ? 'Darta Register' : 'Chalani Dispatch',
          title: `${dc.entryNumber} — ${dc.subject}`,
          subtitle: `Ref ${dc.refNumber} · ${dc.entryDateBs} · ${dc.partyName}`,
          jumpQuery: dc.entryNumber,
          icon: ScrollText,
        },
        `${dc.entryNumber} ${dc.refNumber} ${dc.subject} ${dc.partyName} ${dc.department} ${dc.category}`
      );
    }

    for (const dh of db.dhis2Reports || []) {
      const monthLabel = `${dh.bsMonthName} ${dh.bsYear}`;
      const opdTotal = dh.opdNewMale + dh.opdNewFemale + dh.opdFollowupTotal;
      pushIf(
        {
          id: `dh-${dh.id}`,
          category: 'Orders',
          tab: 'dhis2',
          moduleLabel: 'DHIS2 HMIS Report',
          title: `${dh.reportCode} — ${monthLabel}`,
          subtitle: `OPD ${opdTotal} · ER ${dh.emergencyTotalVisits} · ${dh.status}`,
          jumpQuery: monthLabel,
          icon: FileSpreadsheet,
        },
        `${dh.reportCode} ${monthLabel} ${dh.status} ${dh.municipalityReceiptNo || ''}`
      );
    }

    for (const gp of db.gatepasses || []) {
      pushIf(
        {
          id: `gp-${gp.id}`,
          category: 'Orders',
          tab: 'gatepass',
          moduleLabel: 'Gatepass / Visitor',
          title: `${gp.passNumber} — ${gp.personName}`,
          subtitle: `${gp.passType} · ${gp.departmentOrWard} · ${gp.status}`,
          jumpQuery: gp.passNumber,
          icon: ShieldCheck,
        },
        `${gp.passNumber} ${gp.personName} ${gp.phone} ${gp.purpose} ${gp.departmentOrWard}`
      );
    }

    for (const mv of db.marketingVisits || []) {
      pushIf(
        {
          id: `mkt-${mv.id}`,
          category: 'Orders',
          tab: 'marketing',
          moduleLabel: 'Field Marketing',
          title: `${mv.visitNumber} — ${mv.facilityOrDoctorName}`,
          subtitle: `${mv.areaName}, ${mv.municipality} · ${mv.staffName}`,
          jumpQuery: mv.visitNumber,
          icon: MapPin,
        },
        `${mv.visitNumber} ${mv.facilityOrDoctorName} ${mv.areaName} ${mv.municipality} ${mv.contactPerson} ${mv.staffName}`
      );
    }

    // 3. INVENTORY (Pharmacy Medicines, FEFO Batches, Reagents & X-Ray Films, Beds)
    for (const m of db.pharmacyMedicines || []) {
      const stock = (db.pharmacyBatches || [])
        .filter((b) => b.medicineId === m.id && !b.quarantined)
        .reduce((s, b) => s + b.quantityOnHand, 0);
      pushIf(
        {
          id: `med-${m.id}`,
          category: 'Inventory',
          tab: 'pharmacy',
          moduleLabel: 'Central Pharmacy',
          title: `${m.brandName} ${m.strength} (${m.code})`,
          subtitle: `${m.genericName} · Rack ${m.rackLocation} · On Hand ${stock} ${m.unitLabel} · MRP ${formatNpr(m.defaultMrpNpr)}`,
          jumpQuery: m.code,
          icon: Pill,
        },
        `${m.code} ${m.brandName} ${m.genericName} ${m.category} ${m.rackLocation} ${m.manufacturer}`
      );
    }

    for (const b of db.pharmacyBatches || []) {
      const med = (db.pharmacyMedicines || []).find((m) => m.id === b.medicineId);
      pushIf(
        {
          id: `pbat-${b.id}`,
          category: 'Inventory',
          tab: 'pharmacy',
          moduleLabel: 'Pharmacy FEFO Lot',
          title: `Batch ${b.batchNumber} — ${med?.brandName || b.medicineId}`,
          subtitle: `Exp ${b.expiryDate} · Central Pharmacy · Qty ${b.quantityOnHand} · GRN ${b.grnNumber}`,
          jumpQuery: b.batchNumber,
          icon: Pill,
        },
        `${b.batchNumber} ${b.grnNumber} ${b.supplierName} ${b.expiryDate} ${med?.brandName || ''} ${med?.genericName || ''}`
      );
    }

    for (const r of db.reagents) {
      pushIf(
        {
          id: `reg-${r.id}`,
          category: 'Inventory',
          tab: 'inventory',
          moduleLabel: 'Reagents & Films',
          title: `${r.name} (${r.sku})`,
          subtitle: `Lot ${r.lotNumber} · Stock ${r.currentStock} ${r.unit} · Exp ${r.expiryDate}`,
          jumpQuery: r.sku,
          icon: Package,
        },
        `${r.sku} ${r.name} ${r.lotNumber} ${r.category} ${r.manufacturer}`
      );
    }

    for (const bed of db.hospitalBeds || []) {
      pushIf(
        {
          id: `bed-${bed.id}`,
          category: 'Inventory',
          tab: 'ipd',
          moduleLabel: 'Hospital Bed',
          title: `Bed ${bed.bedCode} — ${bed.wardName}`,
          subtitle: `${bed.wardType} · ${bed.status}${
            bed.currentPatientName ? ` (${bed.currentPatientName})` : ''
          } · ${formatNpr(bed.dailyRateNpr)}/day`,
          jumpQuery: bed.bedCode,
          icon: BedDouble,
        },
        `${bed.bedCode} ${bed.wardName} ${bed.wardType} ${bed.status} ${bed.currentPatientName || ''}`
      );
    }

    // 4. FINANCE (Approval Requests, Accounts, Financial Ledger, Pharmacy Bills, Centers, Referrals)
    for (const fap of db.financeApprovalRequests || []) {
      pushIf(
        {
          id: `fap-${fap.id}`,
          category: 'Finance',
          tab: 'finance',
          moduleLabel: 'Approval Queue',
          title: `${fap.requestNumber} — ${fap.reason}`,
          subtitle: `${fap.direction} · ${fap.transactionType} · ${formatNpr(fap.amountNpr)} · ${fap.status}`,
          jumpQuery: fap.referenceId || fap.requestNumber,
          icon: FileCheck2,
        },
        `${fap.requestNumber} ${fap.referenceId} ${fap.reason} ${fap.description} ${fap.requesterName} ${fap.status} ${fap.accountName}`
      );
    }

    for (const acc of db.accounts) {
      pushIf(
        {
          id: `acc-${acc.id}`,
          category: 'Finance',
          tab: 'finance',
          moduleLabel: 'Bank & Cash',
          title: `${acc.name} (${acc.code})`,
          subtitle: `${acc.type} · Balance ${formatNpr(acc.currentBalance)}`,
          jumpQuery: acc.code,
          icon: Landmark,
        },
        `${acc.code} ${acc.name} ${acc.bankName || ''} ${acc.accountNumber || ''}`
      );
    }

    for (const led of (db.financialLedger || []).slice(0, 60)) {
      pushIf(
        {
          id: `led-${led.id}`,
          category: 'Finance',
          tab: 'finance',
          moduleLabel: 'Ledger Voucher',
          title: `${led.referenceId} — ${led.description}`,
          subtitle: `${led.accountName} · ${led.direction} ${formatNpr(led.amount)} · ${led.category}`,
          jumpQuery: led.referenceId,
          icon: Landmark,
        },
        `${led.referenceId} ${led.accountName} ${led.category} ${led.description} ${led.recordedBy}`
      );
    }

    for (const inv of db.pharmacyInvoices || []) {
      pushIf(
        {
          id: `pinv-${inv.id}`,
          category: 'Finance',
          tab: 'pharmacy',
          moduleLabel: 'Pharmacy Bill',
          title: `${inv.invoiceNumber} — ${inv.patientName}`,
          subtitle: `Central Pharmacy · ${inv.lines.length} FEFO lines · ${formatNpr(inv.totalNpr)}`,
          jumpQuery: inv.invoiceNumber,
          icon: FileText,
        },
        `${inv.invoiceNumber} ${inv.patientName} ${inv.patientPhone} ${inv.linkedOrderAccession || ''}`
      );
    }

    for (const ref of db.referrals) {
      pushIf(
        {
          id: `ref-${ref.id}`,
          category: 'Finance',
          tab: 'referrals',
          moduleLabel: 'Referral Account',
          title: `${ref.name} (${ref.code})`,
          subtitle: `${ref.type} · ${ref.defaultMode} ${ref.defaultValue} · Sales ${formatNpr(
            ref.totalReferredSales
          )}`,
          jumpQuery: ref.code,
          icon: Share2,
        },
        `${ref.code} ${ref.name} ${ref.type} ${ref.phone} ${ref.address}`
      );
    }

    return hits;
  }, [db, query, allowedTabs]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ErpSearchCategory, number> = {
      Patients: 0,
      Orders: 0,
      Inventory: 0,
      Finance: 0,
    };
    for (const h of indexedHits) {
      counts[h.category] += 1;
    }
    return counts;
  }, [indexedHits]);

  const visibleHits = useMemo(() => {
    const filtered =
      categoryFilter === 'ALL'
        ? indexedHits
        : indexedHits.filter((h) => h.category === categoryFilter);
    return filtered.slice(0, 60);
  }, [indexedHits, categoryFilter]);

  const groupedHits = useMemo(() => {
    const activeCats =
      categoryFilter === 'ALL' ? CATEGORIES : ([categoryFilter] as ErpSearchCategory[]);
    return activeCats
      .map((cat) => ({
        category: cat,
        items: visibleHits.filter((h) => h.category === cat),
      }))
      .filter((g) => g.items.length > 0);
  }, [visibleHits, categoryFilter]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 flex items-start justify-center p-4 pt-12"
      onClick={onClose}
    >
      <div
        className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && visibleHits[0]) {
                onSelectTarget({
                  tab: visibleHits[0].tab,
                  query: visibleHits[0].jumpQuery,
                });
                onClose();
              }
            }}
            placeholder="Search ERP across Patients, Orders, Inventory, and Finance..."
            className="flex-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Categorized Navigation Filter Strip */}
        <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCategoryFilter('ALL')}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap font-mono tabular-nums ${
              categoryFilter === 'ALL'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:text-slate-900'
            }`}
          >
            All ERP ({indexedHits.length})
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors whitespace-nowrap font-mono tabular-nums ${
                categoryFilter === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-700 border border-slate-200 hover:text-slate-900'
              }`}
            >
              {cat} ({categoryCounts[cat]})
            </button>
          ))}
        </div>

        {/* Categorized Results */}
        <div className="max-h-[420px] overflow-y-auto">
          {groupedHits.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No matching records found in{' '}
              {categoryFilter === 'ALL' ? 'any category' : categoryFilter} for &ldquo;{query}&rdquo;.
            </div>
          ) : (
            groupedHits.map((group) => (
              <div key={group.category} className="border-b border-slate-100 last:border-b-0">
                <div className="sticky top-0 z-10 px-4 py-1.5 bg-slate-100/95 border-b border-slate-200 flex items-center justify-between text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                  <span>{group.category}</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    {group.items.length} shown
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {group.items.map((hit) => {
                    const Icon = hit.icon;
                    return (
                      <button
                        key={hit.id}
                        type="button"
                        onClick={() => {
                          onSelectTarget({ tab: hit.tab, query: hit.jumpQuery });
                          onClose();
                        }}
                        className="w-full px-4 py-2.5 text-left hover:bg-blue-50/70 flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <Icon className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {hit.title}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {hit.subtitle}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono text-slate-500 shrink-0 whitespace-nowrap">
                          {hit.moduleLabel} →
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500 flex items-center justify-between">
          <span>
            Showing {visibleHits.length} of {indexedHits.length} matches across Patients, Orders, Inventory &amp; Finance
          </span>
          <span className="font-mono">Enter to jump · Esc to close</span>
        </div>
      </div>
    </div>
  );
}
