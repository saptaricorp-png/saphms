import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, PackagePlus, Percent, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type {
  LimsDatabase,
  PermissionKey,
  PharmacyBatch,
  ReagentItem,
  StaffMember,
  StoreRequisitionRecord,
} from '../types/lims';
import { apiRequest } from '../api/client';
import { adToBs, formatNpr } from '../utils/nepaliDate';

interface InventoryViewProps {
  db: LimsDatabase;
  activeUser: StaffMember;
  hasPerm: (perm: PermissionKey) => boolean;
  onUpdated: (db: any, toastMsg: string) => void;
  initialSearchQuery?: string;
}

export function InventoryView({
  db,
  activeUser,
  hasPerm,
  onUpdated,
  initialSearchQuery,
}: InventoryViewProps) {
  const canManage = hasPerm('inventory.manage');
  const canManagePharmacy = hasPerm('pharmacy.manage') || canManage;
  const [categoryFilter, setCategoryFilter] = useState<
    'ALL' | 'REAGENTS' | 'RADIOLOGY' | 'LOW' | 'EXPIRING_STOCK' | 'STORE'
  >('ALL');
  const [discountPctByBatch, setDiscountPctByBatch] = useState<Record<string, string>>({});
  const [clearingBatchId, setClearingBatchId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState(initialSearchQuery || '');
  const [restockTarget, setRestockTarget] = useState<ReagentItem | null>(null);
  const [restockQty, setRestockQty] = useState('50');
  const [restockLot, setRestockLot] = useState('');
  const [restockNotes, setRestockNotes] = useState('Cold-chain verified restock');

  // General Store / Dept Requisition State
  const [reqDept, setReqDept] = useState<StoreRequisitionRecord['department']>('OT');
  const [reqBy, setReqBy] = useState(activeUser.fullName);
  const [reqNotes, setReqNotes] = useState('');
  const [reqReagentId, setReqReagentId] = useState(db.reagents[0]?.id || '');
  const [reqQty, setReqQty] = useState('5');
  const [issuingReq, setIssuingReq] = useState(false);

  useEffect(() => {
    if (initialSearchQuery !== undefined) {
      setSearchTerm(initialSearchQuery);
    }
  }, [initialSearchQuery]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState<ReagentItem['category']>('Reagent Pack');
  const [newManufacturer, setNewManufacturer] = useState('Roche Diagnostics');
  const [newLot, setNewLot] = useState('');
  const [newExpiry, setNewExpiry] = useState('2027-06-30');
  const [newStorage, setNewStorage] = useState<ReagentItem['storageCondition']>('2-8°C');
  const [newStock, setNewStock] = useState('100');
  const [newUnit, setNewUnit] = useState('tests');
  const [newReorder, setNewReorder] = useState('25');

  const isRadiologyItem = (item: ReagentItem) =>
    item.category === 'X-Ray Film' ||
    item.category === 'CT Contrast' ||
    item.category === 'USG / Echo Consumable';

  const daysRemaining = (ymd: string) =>
    Math.ceil((new Date(`${ymd}T00:00:00`).getTime() - Date.now()) / (86400 * 1000));

  const expiringPharmacyBatches = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (db.pharmacyBatches || [])
      .filter((b) => !b.quarantined && b.quantityOnHand > 0 && daysRemaining(b.expiryDate) <= 90)
      .filter((b) => {
        if (!q) return true;
        const med = (db.pharmacyMedicines || []).find((m) => m.id === b.medicineId);
        return `${b.batchNumber} ${b.supplierName} ${b.expiryDate} ${med?.brandName || ''} ${med?.genericName || ''}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }, [db.pharmacyBatches, db.pharmacyMedicines, searchTerm]);

  const expiringReagents = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (db.reagents || [])
      .filter((r) => r.currentStock > 0 && daysRemaining(r.expiryDate) <= 90)
      .filter((r) =>
        !q ? true : `${r.name} ${r.sku} ${r.lotNumber} ${r.manufacturer}`.toLowerCase().includes(q)
      )
      .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  }, [db.reagents, searchTerm]);

  const handleBatchClearance = async (
    batch: PharmacyBatch,
    action: 'RETURN_SUPPLIER' | 'DISCOUNT_SALE' | 'WRITE_OFF'
  ) => {
    setClearingBatchId(batch.id);
    try {
      const pct = Math.max(1, Math.min(90, Number(discountPctByBatch[batch.id] || 25)));
      const resp = await apiRequest<{ db: LimsDatabase }>(
        `/api/pharmacy/batches/${batch.id}/clearance`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            discountPercent: action === 'DISCOUNT_SALE' ? pct : undefined,
            quantity: batch.quantityOnHand,
            notes:
              action === 'DISCOUNT_SALE'
                ? `Clearance ${pct}% discount applied`
                : action === 'RETURN_SUPPLIER'
                ? `Returned ${batch.quantityOnHand} units to ${batch.supplierName}`
                : `Expired / damaged stock write-off`,
          }),
        }
      );
      onUpdated(
        resp.db,
        action === 'DISCOUNT_SALE'
          ? `Applied ${pct}% discount sale price to Batch ${batch.batchNumber}.`
          : action === 'RETURN_SUPPLIER'
          ? `Generated supplier return for Batch ${batch.batchNumber} (${batch.supplierName}).`
          : `Wrote off Batch ${batch.batchNumber}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Near-expiry clearance action failed.');
    } finally {
      setClearingBatchId(null);
    }
  };

  const handleExportExpiringCsv = () => {
    const header = ['Type', 'Item Name', 'Batch / Lot', 'Expiry Date', 'Days Left', 'On Hand', 'MRP / Rate (NPR)', 'Supplier'];
    const rows = [
      ...expiringPharmacyBatches.map((b) => {
        const med = db.pharmacyMedicines.find((m) => m.id === b.medicineId);
        return [
          'Pharmacy Medicine',
          `${med?.brandName || b.medicineId} ${med?.strength || ''}`.trim(),
          b.batchNumber,
          b.expiryDate,
          String(daysRemaining(b.expiryDate)),
          `${b.quantityOnHand} ${med?.unitLabel || 'Units'}`,
          String(b.mrpNpr),
          b.supplierName,
        ];
      }),
      ...expiringReagents.map((r) => [
        `Clinical (${r.category})`,
        r.name,
        r.lotNumber,
        r.expiryDate,
        String(daysRemaining(r.expiryDate)),
        `${r.currentStock} ${r.unit}`,
        String(r.unitCost),
        r.manufacturer,
      ]),
    ];
    const csv = [header, ...rows]
      .map((line) => line.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saptari-hospital-expiring-stock-90d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredReagents = db.reagents.filter((item) => {
    if (categoryFilter === 'RADIOLOGY' && !isRadiologyItem(item)) return false;
    if (categoryFilter === 'REAGENTS' && isRadiologyItem(item)) return false;
    if (categoryFilter === 'LOW' && item.currentStock > item.reorderLevel) return false;
    const q = searchTerm.trim().toLowerCase();
    if (!q) return true;
    return `${item.name} ${item.sku} ${item.lotNumber} ${item.category} ${item.manufacturer}`
      .toLowerCase()
      .includes(q);
  });

  const handleRestock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!restockTarget) return;
    try {
      const resp = await apiRequest<{ db: any }>(
        `/api/inventory/${restockTarget.id}/restock`,
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            quantity: Number(restockQty),
            lotNumber: restockLot || undefined,
            notes: restockNotes,
          }),
        }
      );
      onUpdated(resp.db, `Restocked +${restockQty} ${restockTarget.unit} of ${restockTarget.name}.`);
      setRestockTarget(null);
    } catch (err: any) {
      onUpdated(db, err.message || 'Restock failed.');
    }
  };

  const handleWriteOff = async (item: ReagentItem) => {
    try {
      const resp = await apiRequest<{ db: any }>(`/api/inventory/${item.id}/adjust`, activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          delta: -Math.min(5, item.currentStock),
          type: 'ADJUSTMENT',
          notes: 'QC calibration / bench adjustment (-5 units)',
        }),
      });
      onUpdated(resp.db, `Adjusted stock for ${item.name}.`);
    } catch (err: any) {
      onUpdated(db, err.message || 'Adjustment failed.');
    }
  };

  const handleAddReagent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const resp = await apiRequest<{ db: any }>('/api/inventory', activeUser.id, {
        method: 'POST',
        body: JSON.stringify({
          sku: newSku,
          name: newName,
          manufacturer: newManufacturer,
          category: newCategory,
          lotNumber: newLot,
          expiryDate: newExpiry,
          storageCondition: newStorage,
          currentStock: Number(newStock),
          unit: newUnit,
          reorderLevel: Number(newReorder),
          unitCost: 4.5,
          autoDeductEnabled: true,
        }),
      });
      onUpdated(resp.db, `Added inventory lot ${newName} (${newSku}).`);
      setShowAddModal(false);
      setNewSku('');
      setNewName('');
      setNewLot('');
    } catch (err: any) {
      onUpdated(db, err.message || 'Failed to add reagent.');
    }
  };

  const handleIssueStoreRequisition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !reqReagentId) return;
    setIssuingReq(true);
    try {
      const resp = await apiRequest<{ requisition: StoreRequisitionRecord; db: LimsDatabase }>(
        '/api/store/requisitions',
        activeUser.id,
        {
          method: 'POST',
          body: JSON.stringify({
            department: reqDept,
            requestedBy: reqBy.trim() || activeUser.fullName,
            notes: reqNotes.trim(),
            items: [{ reagentId: reqReagentId, qty: Math.max(1, Number(reqQty) || 1) }],
          }),
        }
      );
      setReqNotes('');
      onUpdated(
        resp.db,
        `Issued store requisition ${resp.requisition.reqNumber} to ${resp.requisition.department}.`
      );
    } catch (err: any) {
      onUpdated(db, err.message || 'Store requisition issue failed.');
    } finally {
      setIssuingReq(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            Hospital Clinical Inventory — Reagents, X-Ray Films &amp; Consumables
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Strictly separate from Pharmacy FEFO medicine stock. Lot-level cold-chain reagents, X-Ray films, CT contrast &amp; automated BOM deduction.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search SKU, reagent, lot, film..."
              className="pl-8 pr-7 py-2 text-xs bg-white border border-slate-300 rounded-lg w-56 focus:outline-none focus:border-blue-600"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              Onboard Reagent Lot
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit">
        {[
          { id: 'ALL', label: `All Stock (${db.reagents.length})` },
          { id: 'REAGENTS', label: 'Lab Reagents & QC' },
          { id: 'RADIOLOGY', label: 'X-Ray Films & Contrast' },
          {
            id: 'LOW',
            label: `Low Stock (${db.reagents.filter((r) => r.currentStock <= r.reorderLevel).length})`,
          },
          {
            id: 'EXPIRING_STOCK',
            label: `Manage Expiring Stock (≤90d: ${expiringPharmacyBatches.length + expiringReagents.length})`,
          },
          {
            id: 'STORE',
            label: `Dept Store Requisitions (${(db.storeRequisitions || []).length})`,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategoryFilter(tab.id as any)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              categoryFilter === tab.id
                ? 'bg-white text-slate-900 shadow-sm'
                : tab.id === 'EXPIRING_STOCK' && expiringPharmacyBatches.length + expiringReagents.length > 0
                ? 'text-rose-700 hover:bg-rose-50'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Manage Expiring Stock (<=90 Days) Tab */}
      {categoryFilter === 'EXPIRING_STOCK' ? (
        <div className="space-y-5 text-xs">
          <div className="bg-rose-50/70 border border-rose-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-rose-950 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                Manage Expiring Stock — Within 90 Days &amp; Overdue (Pharmacy &amp; Clinical Lots)
              </h2>
              <p className="text-rose-800 mt-0.5">
                All pharmacy medicines &amp; clinical reagents expiring within 90 days are highlighted in red for Supplier Return, Discount Clearance Sale, or Write-Off.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right font-mono tabular-nums">
                <div className="text-[11px] text-rose-700">At-Risk Pharmacy Retail Value</div>
                <div className="text-sm font-bold text-rose-950">
                  {formatNpr(
                    expiringPharmacyBatches.reduce((s, b) => s + b.quantityOnHand * b.mrpNpr, 0)
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={handleExportExpiringCsv}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-rose-900 bg-white border border-rose-300 rounded-lg hover:bg-rose-100 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export Return / Discount List (CSV)
              </button>
            </div>
          </div>

          {/* Near-Expiry Pharmacy Batches Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
              Pharmacy Batches Expiring Within 90 Days ({expiringPharmacyBatches.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="py-2.5 px-4">Medicine &amp; Batch</th>
                    <th className="py-2.5 px-4">Expiry &amp; Days Left</th>
                    <th className="py-2.5 px-4">Supplier</th>
                    <th className="py-2.5 px-4 text-right">Stock / MRP</th>
                    <th className="py-2.5 px-4 text-right">Return / Discount Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rose-100">
                  {expiringPharmacyBatches.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No pharmacy batches expiring within 90 days.
                      </td>
                    </tr>
                  ) : (
                    expiringPharmacyBatches.map((b) => {
                      const med = db.pharmacyMedicines.find((m) => m.id === b.medicineId);
                      const dLeft = daysRemaining(b.expiryDate);
                      const discVal = discountPctByBatch[b.id] ?? '25';
                      return (
                        <tr key={b.id} className="bg-rose-50/70 text-rose-950">
                          <td className="py-2.5 px-4">
                            <div className="font-semibold text-slate-900">
                              {med ? `${med.brandName} ${med.strength}` : b.medicineId}
                            </div>
                            <div className="font-mono text-[11px] text-slate-600">
                              Batch {b.batchNumber} · {med?.genericName || ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 font-mono tabular-nums font-bold text-rose-700">
                            <div>{b.expiryDate}</div>
                            <div className="text-[11px]">
                              {dLeft <= 0 ? `EXPIRED (${Math.abs(dLeft)}d ago)` : `${dLeft} days left`}
                            </div>
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">{b.supplierName}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                            <div className="font-bold text-slate-900">
                              {b.quantityOnHand} {med?.unitLabel || 'Units'}
                            </div>
                            <div className="text-[11px] text-slate-600">MRP {formatNpr(b.mrpNpr)}</div>
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {canManagePharmacy ? (
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                {dLeft > 0 && (
                                  <div className="inline-flex items-center gap-1 bg-white border border-slate-300 rounded px-1.5 py-0.5">
                                    <input
                                      type="number"
                                      min={1}
                                      max={90}
                                      value={discVal}
                                      onChange={(e) =>
                                        setDiscountPctByBatch((p) => ({ ...p, [b.id]: e.target.value }))
                                      }
                                      className="w-10 text-center font-mono text-[11px] focus:outline-none"
                                    />
                                    <span className="text-[10px] text-slate-500">%</span>
                                    <button
                                      type="button"
                                      disabled={clearingBatchId === b.id}
                                      onClick={() => void handleBatchClearance(b, 'DISCOUNT_SALE')}
                                      className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100"
                                    >
                                      <Percent className="w-3 h-3" />
                                      Discount Sale
                                    </button>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  disabled={clearingBatchId === b.id}
                                  onClick={() => void handleBatchClearance(b, 'RETURN_SUPPLIER')}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-blue-800 bg-white border border-blue-300 rounded hover:bg-blue-50"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  Return Supplier
                                </button>
                                <button
                                  type="button"
                                  disabled={clearingBatchId === b.id}
                                  onClick={() => void handleBatchClearance(b, 'WRITE_OFF')}
                                  className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-rose-800 bg-white border border-rose-300 rounded hover:bg-rose-100"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Write Off
                                </button>
                              </div>
                            ) : (
                              <span className="text-slate-400">Read-Only</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Clinical Reagents & Film Lots <= 90d */}
          {expiringReagents.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 font-semibold text-sm text-slate-900">
                Clinical Reagents &amp; X-Ray Film Lots Expiring Within 90 Days ({expiringReagents.length})
              </div>
              <div className="divide-y divide-rose-100">
                {expiringReagents.map((item) => {
                  const dLeft = daysRemaining(item.expiryDate);
                  return (
                    <div key={item.id} className="px-5 py-3 bg-rose-50/70 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">
                          {item.name} <span className="font-mono text-[11px] text-slate-600">({item.sku})</span>
                        </div>
                        <div className="font-mono text-[11px] text-rose-700 font-semibold">
                          Lot {item.lotNumber} · Exp: {item.expiryDate} ({dLeft <= 0 ? 'EXPIRED' : `${dLeft}d left`}) · Stock: {item.currentStock} {item.unit}
                        </div>
                      </div>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => void handleWriteOff(item)}
                          className="px-3 py-1.5 text-[11px] font-semibold text-rose-800 bg-white border border-rose-300 rounded-lg hover:bg-rose-100"
                        >
                          QC / Expiry Adjust (-5)
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : categoryFilter === 'STORE' ? (
        <div className="space-y-5">
          {canManage && (
            <form
              onSubmit={handleIssueStoreRequisition}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 text-xs"
            >
              <h2 className="text-sm font-semibold text-slate-900">
                Issue Hospital Store Consumables / Reagents to Department
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-3">
                  <label className="block font-medium text-slate-700 mb-1">Target Department *</label>
                  <select
                    value={reqDept}
                    onChange={(e) => setReqDept(e.target.value as StoreRequisitionRecord['department'])}
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    <option value="OT">OT (Operation Theatre)</option>
                    <option value="ICU">ICU / HDU</option>
                    <option value="Emergency">Emergency / Casualty</option>
                    <option value="OPD">OPD Clinic</option>
                    <option value="IPD Ward">IPD Ward</option>
                    <option value="Lab">Pathology Lab</option>
                    <option value="Radiology">Radiology &amp; Imaging</option>
                    <option value="General Store">General Store</option>
                  </select>
                </div>
                <div className="sm:col-span-4">
                  <label className="block font-medium text-slate-700 mb-1">Store Item / Reagent *</label>
                  <select
                    value={reqReagentId}
                    onChange={(e) => setReqReagentId(e.target.value)}
                    className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg"
                  >
                    {db.reagents.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} (Stock: {r.currentStock} {r.unit})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Issue Qty *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={reqQty}
                    onChange={(e) => setReqQty(e.target.value)}
                    className="w-full px-2.5 py-2 font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block font-medium text-slate-700 mb-1">Requested By</label>
                  <input
                    value={reqBy}
                    onChange={(e) => setReqBy(e.target.value)}
                    className="w-full px-2.5 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-9">
                  <input
                    value={reqNotes}
                    onChange={(e) => setReqNotes(e.target.value)}
                    placeholder="Department indent / handover remarks..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={issuingReq}
                    className="w-full py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {issuingReq ? 'Issuing...' : 'Approve & Issue Stock'}
                  </button>
                </div>
              </div>
            </form>
          )}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h2 className="text-sm font-semibold text-slate-900">
                Department Store Requisition &amp; Issue Register ({(db.storeRequisitions || []).length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2.5 px-4">Req # / BS Date</th>
                    <th className="py-2.5 px-4">Department</th>
                    <th className="py-2.5 px-4">Items Issued</th>
                    <th className="py-2.5 px-4">Requested / Issued By</th>
                    <th className="py-2.5 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(db.storeRequisitions || []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No department store requisitions issued yet.
                      </td>
                    </tr>
                  ) : (
                    (db.storeRequisitions || []).map((req) => (
                      <tr key={req.id}>
                        <td className="py-2.5 px-4 font-mono">
                          <div className="font-semibold text-blue-700">{req.reqNumber}</div>
                          <div className="text-slate-500">{adToBs(req.createdAt).formattedEn}</div>
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-slate-900">{req.department}</td>
                        <td className="py-2.5 px-4">
                          {req.items.map((it, idx) => (
                            <div key={idx}>
                              {it.reagentName} —{' '}
                              <span className="font-mono font-semibold">
                                {it.qty} {it.unit}
                              </span>
                            </div>
                          ))}
                          {req.notes && <div className="text-slate-500">{req.notes}</div>}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">
                          <div>Req: {req.requestedBy}</div>
                          <div className="text-slate-500">By: {req.issuedBy}</div>
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-emerald-700">{req.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <>
      {/* Reagent Stock Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-medium text-slate-500 bg-slate-50">
                <th className="py-3 px-4">SKU &amp; Item / Category</th>
                <th className="py-3 px-4">Lot / Expiry</th>
                <th className="py-3 px-4">Storage</th>
                <th className="py-3 px-4 text-right">On-Hand Stock</th>
                <th className="py-3 px-4 text-right">Reorder Min</th>
                <th className="py-3 px-4">Automation</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredReagents.map((item) => {
                const daysLeft = daysRemaining(item.expiryDate);
                const isLow = item.currentStock <= item.reorderLevel;
                const isExpiring90 = daysLeft <= 90;
                return (
                  <tr
                    key={item.id}
                    className={isExpiring90 ? 'bg-rose-50/75 hover:bg-rose-100/60' : 'hover:bg-slate-50/70'}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900">{item.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                          {item.category}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-500">
                        {item.sku} · {item.manufacturer}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono">
                      <div className="text-slate-800">{item.lotNumber}</div>
                      <div
                        className={
                          isExpiring90
                            ? 'inline-block px-1.5 py-0.5 rounded bg-rose-100 border border-rose-300 text-rose-800 font-bold mt-0.5'
                            : 'text-slate-500'
                        }
                      >
                        Exp: {item.expiryDate} ({daysLeft <= 0 ? 'EXPIRED' : `${daysLeft}d`})
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-700 font-mono">
                      {item.storageCondition}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <span className={`font-semibold ${isLow ? 'text-rose-700' : 'text-slate-900'}`}>
                        {item.currentStock} {item.unit}
                      </span>
                      {isLow && (
                        <div className="text-[11px] text-rose-700 inline-flex items-center gap-1 ml-2">
                          <AlertTriangle className="w-3 h-3" /> Low
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-slate-600">
                      {item.reorderLevel} {item.unit}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {item.autoDeductEnabled ? (
                        <span className="text-emerald-700 font-medium">● Auto-BOM Active</span>
                      ) : (
                        <span className="text-slate-500">Manual QC</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      {canManage ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setRestockTarget(item);
                              setRestockLot(item.lotNumber);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 whitespace-nowrap"
                          >
                            <PackagePlus className="w-3.5 h-3.5" />
                            Restock
                          </button>
                          <button
                            type="button"
                            onClick={() => handleWriteOff(item)}
                            className="px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                          >
                            QC Use (-5)
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Read-Only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Automated Inventory Movement Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50">
          <h2 className="text-sm font-semibold text-slate-900">
            Automated Reagent Consumption &amp; Restock Ledger
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Reagent &amp; Lot</th>
                <th className="py-2.5 px-4">Movement Type</th>
                <th className="py-2.5 px-4 text-right">Delta</th>
                <th className="py-2.5 px-4 text-right">Balance</th>
                <th className="py-2.5 px-4">Ref / Operator</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {db.inventoryMovements.slice(0, 20).map((m) => (
                <tr key={m.id}>
                  <td className="py-2.5 px-4 font-mono text-slate-500">
                    {new Date(m.timestamp).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="font-medium text-slate-900">{m.reagentName}</div>
                    <div className="font-mono text-slate-500">{m.lotNumber}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono">
                    <span
                      className={
                        m.type === 'AUTO_DEDUCT'
                          ? 'text-blue-700 font-semibold'
                          : m.type === 'RESTOCK'
                          ? 'text-emerald-700 font-semibold'
                          : m.type === 'FILM_RETAKE'
                          ? 'text-rose-700 font-semibold'
                          : 'text-amber-700 font-semibold'
                      }
                    >
                      {m.type}
                    </span>
                  </td>
                  <td
                    className={`py-2.5 px-4 text-right font-mono font-semibold ${
                      m.quantityDelta < 0 ? 'text-rose-700' : 'text-emerald-700'
                    }`}
                  >
                    {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-800">
                    {m.balanceAfter}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">
                    <span className="font-mono text-slate-800">{m.referenceId || '—'}</span> ·{' '}
                    {m.performedBy}
                    <div className="text-[11px] text-slate-500">{m.notes}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {/* Restock Modal */}
      {restockTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">
                Restock {restockTarget.name}
              </h3>
              <button
                type="button"
                onClick={() => setRestockTarget(null)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRestock} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Quantity ({restockTarget.unit}) *
                </label>
                <input
                  type="number"
                  min={1}
                  required
                  value={restockQty}
                  onChange={(e) => setRestockQty(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Lot Number</label>
                <input
                  value={restockLot}
                  onChange={(e) => setRestockLot(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                <input
                  value={restockNotes}
                  onChange={(e) => setRestockNotes(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRestockTarget(null)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Confirm Stock Receipt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Reagent Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <h3 className="text-sm font-semibold text-slate-900">Onboard New Reagent Lot</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleAddReagent} className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">SKU *</label>
                  <input
                    required
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value.toUpperCase())}
                    placeholder="RCH-CRP-200"
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Lot Number *</label>
                  <input
                    required
                    value={newLot}
                    onChange={(e) => setNewLot(e.target.value.toUpperCase())}
                    placeholder="LOT-26-99A"
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Item / Reagent Name *</label>
                  <input
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Fujifilm DryPix 14x17 Film Pack or Cobas CRP Pack"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Inventory Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as ReagentItem['category'])}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="Reagent Pack">Reagent Pack</option>
                    <option value="Buffer / Diluent">Buffer / Diluent</option>
                    <option value="Calibrator / QC">Calibrator / QC</option>
                    <option value="Consumable">Consumable</option>
                    <option value="X-Ray Film">X-Ray Film</option>
                    <option value="CT Contrast">CT Contrast</option>
                    <option value="USG / Echo Consumable">USG / Echo Consumable</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Manufacturer</label>
                  <input
                    value={newManufacturer}
                    onChange={(e) => setNewManufacturer(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Storage Temp</label>
                  <select
                    value={newStorage}
                    onChange={(e) =>
                      setNewStorage(e.target.value as ReagentItem['storageCondition'])
                    }
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="2-8°C">2-8°C</option>
                    <option value="-20°C">-20°C</option>
                    <option value="15-25°C (Ambient)">15-25°C (Ambient)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Initial Stock *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={newStock}
                    onChange={(e) => setNewStock(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Unit *</label>
                  <input
                    required
                    value={newUnit}
                    onChange={(e) => setNewUnit(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reorder Level</label>
                  <input
                    type="number"
                    min={1}
                    value={newReorder}
                    onChange={(e) => setNewReorder(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Expiry Date *</label>
                  <input
                    type="date"
                    required
                    value={newExpiry}
                    onChange={(e) => setNewExpiry(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Save Reagent Lot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
