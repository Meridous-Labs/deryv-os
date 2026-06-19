import { useState, useEffect, useCallback } from 'react';
import { Plus, AlertTriangle, ShoppingCart, Package, RotateCcw, Layers, Tag, RefreshCw,
  Trash2, Archive, Edit2, ChevronRight, FileText, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity, createNotification } from '../../lib/hooks';
import { canEdit, canEditFinance, canEditOps } from '../../lib/permissions';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  DetailRow, EmptyState, ErrorState, Modal, FormField,
  inputCls, selectCls, textareaCls, PageLoader,
} from '../components/DataStates';
import { supabase } from '../../lib/supabase';
import { SupplyInvoiceImportModal } from '../components/SupplyInvoiceImportModal';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

// ─── Constants ────────────────────────────────────────────────────────────────

const SUPPLY_STATUSES = ['ACTIVE', 'LOW_STOCK', 'REORDER', 'OUT_OF_STOCK', 'ARCHIVED', 'DISCONTINUED'];
const UNIT_OF_MEASURE = ['EACH', 'PAIR', 'BOX', 'CASE', 'ROLL', 'SHEET', 'BAG', 'PACK', 'REAM', 'SET', 'LB', 'OZ', 'FT', 'M', 'LITER', 'GALLON'];
const TX_TYPES = ['PURCHASE', 'ADJUSTMENT', 'RETURN', 'TRANSFER'];
const CATEGORY_COLORS = ['#6B7280','#3ECF8E','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6'];

const EMPTY_SUPPLY = {
  name: '', category_id: '', vendor_id: '', sku: '', barcode: '',
  unit_of_measure: 'EACH', unit_cost: '', quantity_on_hand: '',
  reorder_point: '', reorder_quantity: '', warehouse_location_id: '',
  status: 'ACTIVE', notes: '',
};

const EMPTY_TX = {
  supply_id: '', transaction_type: 'PURCHASE', quantity: '',
  unit_cost: '', reference_number: '', notes: '',
};

const EMPTY_USAGE = {
  supply_id: '', quantity_used: '', inventory_item_id: '',
  order_id: '', shipment_id: '', notes: '',
};

const EMPTY_CATEGORY = { name: '', description: '', color: '#6B7280' };

const EMPTY_TEMPLATE = { name: '', description: '' };

// ─── Low-stock notification helper ───────────────────────────────────────────

async function notifyLowStock(
  orgId: string, supplyId: string, supplyName: string,
  newQty: number, reorderPoint: number | null
) {
  if (reorderPoint == null || newQty > reorderPoint) return;
  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('organization_id', orgId)
    .eq('entity_type', 'supplies')
    .eq('entity_id', supplyId)
    .eq('is_read', false)
    .ilike('title', '%stock%')
    .limit(1);
  if (existing?.length) return;
  const isOut = newQty <= 0;
  void createNotification(
    orgId,
    isOut ? 'Supply out of stock' : 'Supply low stock',
    `${supplyName}: ${newQty} remaining (reorder point: ${reorderPoint})`,
    { entityType: 'supplies', entityId: supplyId, route: `/supplies/supply-inventory?selected=${supplyId}`, priority: isOut ? 'high' : 'medium' }
  );
}

// ─── Helper: format currency ──────────────────────────────────────────────────

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Shared table wrapper ─────────────────────────────────────────────────────

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">{children}</table>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-[rgba(0,0,0,0.06)] ${right ? 'text-right' : 'text-left'} whitespace-nowrap`}>
      {children}
    </th>
  );
}

function Td({ children, right, muted }: { children: React.ReactNode; right?: boolean; muted?: boolean }) {
  return (
    <td className={`px-4 py-3 ${right ? 'text-right' : ''} ${muted ? 'text-gray-400' : 'text-gray-700'}`}>
      {children}
    </td>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function OverviewView({ orgId, role }: { orgId: string | null; role: string | null | undefined }) {
  const { data: supplies, loading } = useOrgQuery<any>('supplies', orgId, { select: '*' });
  const { data: txns } = useOrgQuery<any>('supply_transactions', orgId, {
    select: 'id, total_cost, created_at',
    orderBy: 'created_at', ascending: false,
  });

  if (loading) return <PageLoader />;

  const total = supplies.length;
  const lowStock = supplies.filter((s: any) => ['LOW_STOCK', 'REORDER', 'OUT_OF_STOCK'].includes(s.status) ||
    (s.reorder_point != null && s.quantity_on_hand != null && s.quantity_on_hand <= s.reorder_point)).length;
  const inventoryValue = supplies.reduce((sum: number, s: any) =>
    sum + (parseFloat(s.unit_cost) || 0) * (parseFloat(s.quantity_on_hand) || 0), 0);
  const now = new Date();
  const monthTxns = txns.filter((t: any) => {
    const d = new Date(t.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const monthSpend = monthTxns.reduce((s: number, t: any) => s + (parseFloat(t.total_cost) || 0), 0);

  const cards = [
    { label: 'Total Supplies', value: String(total), icon: Layers, color: 'text-gray-600' },
    { label: 'Low Stock', value: String(lowStock), icon: AlertTriangle, color: lowStock > 0 ? 'text-amber-500' : 'text-gray-400' },
    ...(canEditFinance(role as any) ? [
      { label: 'Inventory Value', value: fmt(inventoryValue), icon: ShoppingCart, color: 'text-gray-600' },
      { label: 'Month Spend', value: fmt(monthSpend), icon: RefreshCw, color: 'text-gray-600' },
    ] : []),
  ];

  const lowStockSupplies = supplies
    .filter((s: any) => s.status !== 'ARCHIVED' && (
      ['LOW_STOCK', 'REORDER', 'OUT_OF_STOCK'].includes(s.status) ||
      (s.reorder_point != null && s.quantity_on_hand != null && s.quantity_on_hand <= s.reorder_point)
    ))
    .slice(0, 8);

  return (
    <div className="space-y-6">
      <div className={`grid gap-4 ${canEditFinance(role as any) ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2'}`}>
        {cards.map(c => (
          <div key={c.label} className="bg-white border border-[rgba(0,0,0,0.07)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">{c.label}</p>
              <c.icon size={14} className={c.color} />
            </div>
            <p className="text-[22px] font-semibold text-gray-900">{c.value}</p>
          </div>
        ))}
      </div>

      {lowStockSupplies.length > 0 && (
        <div>
          <h3 className="text-[12px] font-medium text-gray-500 uppercase tracking-wide mb-3">Low Stock Alerts</h3>
          <Table>
            <thead>
              <tr>
                <Th>Supply</Th>
                <Th>On Hand</Th>
                <Th>Reorder Point</Th>
                <Th>Reorder Qty</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {lowStockSupplies.map((s: any) => (
                <tr key={s.id} className="border-b border-[rgba(0,0,0,0.04)] last:border-0 hover:bg-gray-50/50">
                  <Td><span className="font-medium text-gray-900">{s.name}</span></Td>
                  <Td right><span className={s.quantity_on_hand === 0 ? 'text-red-600 font-medium' : 'text-amber-700 font-medium'}>{s.quantity_on_hand ?? 0}</span></Td>
                  <Td right muted>{s.reorder_point ?? '—'}</Td>
                  <Td right muted>{s.reorder_quantity ?? '—'}</Td>
                  <Td><StatusBadge status={s.status} size="sm" /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      {lowStockSupplies.length === 0 && (
        <div className="flex items-center gap-2 text-[13px] text-[#15803d] bg-[#ECFDF5] px-4 py-3 rounded-xl">
          <Package size={14} className="text-[#3ECF8E]" />
          All supply levels are healthy.
        </div>
      )}
    </div>
  );
}

// ─── Supply Inventory (also used for Low Stock + Reorder) ─────────────────────


// ── Sort helper ────────────────────────────────────────────────────────────────
function sortItems(items: any[], col: string | null, dir: 'asc' | 'desc', getVal: (item: any, col: string) => any): any[] {
  if (!col) return items;
  return [...items].sort((a, b) => {
    const av = getVal(a, col);
    const bv = getVal(b, col);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
    return dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });
}
function SupplyInventoryView({
  orgId, userId, role, filter,
}: {
  orgId: string | null; userId: string | undefined;
  role: string | null | undefined; filter?: 'low-stock' | 'reorder' | null;
}) {
  const canE = canEdit(role as any);
  const canF = canEditFinance(role as any);

  const [selected, setSelected] = useState<any>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({ ...EMPTY_SUPPLY });
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showConfirmArchive, setShowConfirmArchive] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({});

  const { data: supplies, loading, error, reload } = useOrgQuery<any>('supplies', orgId, {
    select: '*, category:supply_categories(id,name), vendor:vendors(id,name), location:warehouse_locations(id,name,code)',
    orderBy: 'name', ascending: true,
  });
  const { data: categories } = useOrgQuery<any>('supply_categories', orgId, { select: 'id,name', orderBy: 'name', ascending: true });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id,name', orderBy: 'name', ascending: true });
  const { data: locations } = useOrgQuery<any>('warehouse_locations', orgId, { select: 'id,name,code', orderBy: 'name', ascending: true });

  // Open drawer from ?selected=<supply_uuid>
  useEffect(() => {
    const selId = searchParams.get('selected');
    if (!selId || loading) return;
    const supply = supplies.find((s: any) => s.id === selId);
    if (supply) setSelected(supply);
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [supplies, loading, searchParams]);

  const displaySupplies = supplies.filter((s: any) => {
    if (filter === 'low-stock' || filter === 'reorder') {
      return s.status !== 'ARCHIVED' && (
        ['LOW_STOCK', 'REORDER', 'OUT_OF_STOCK'].includes(s.status) ||
        (s.reorder_point != null && s.quantity_on_hand != null && s.quantity_on_hand <= s.reorder_point)
      );
    }
    return true;
  });

  const supplyFilterDefs: FilterDef[] = [
    { type: 'select', key: 'category_id', label: 'Category', options: categories.map((c: any) => ({ value: c.id, label: c.name })) },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.company_name ?? v.name ?? '' })) },
    { type: 'select', key: 'warehouse_location_id', label: 'Location', options: locations.map((l: any) => ({ value: l.id, label: l.name ?? l.location_code ?? String(l.zone ?? '') })) },
    { type: 'select', key: 'unit_of_measure', label: 'Unit of Measure', options: UNIT_OF_MEASURE.map(u => ({ value: u, label: u })) },
    { type: 'numrange', keyMin: 'unit_cost_min', keyMax: 'unit_cost_max', label: 'Unit Cost', prefix: '$' },
    { type: 'numrange', keyMin: 'qty_min', keyMax: 'qty_max', label: 'Qty On Hand' },
    { type: 'boolean', key: 'low_stock_only', label: 'Low Stock Only' },
    { type: 'boolean', key: 'reorder_only', label: 'Reorder Needed' },
    { type: 'boolean', key: 'out_of_stock_only', label: 'Out Of Stock' },
  ];

  const filteredSupplies = displaySupplies.filter((s: any) => {
    const v = filterValues;
    if (v.category_id && s.category_id !== v.category_id) return false;
    if (v.vendor_id && s.vendor_id !== v.vendor_id) return false;
    if (v.warehouse_location_id && s.warehouse_location_id !== v.warehouse_location_id) return false;
    if (v.unit_of_measure && s.unit_of_measure !== v.unit_of_measure) return false;
    if (v.unit_cost_min && Number(s.unit_cost ?? 0) < Number(v.unit_cost_min)) return false;
    if (v.unit_cost_max && Number(s.unit_cost ?? 0) > Number(v.unit_cost_max)) return false;
    if (v.qty_min && Number(s.quantity_on_hand ?? 0) < Number(v.qty_min)) return false;
    if (v.qty_max && Number(s.quantity_on_hand ?? 0) > Number(v.qty_max)) return false;
    if (v.low_stock_only === 'true' && s.status !== 'LOW_STOCK') return false;
    if (v.reorder_only === 'true' && Number(s.quantity_on_hand ?? 0) > Number(s.reorder_point ?? Infinity)) return false;
    if (v.out_of_stock_only === 'true' && s.status !== 'OUT_OF_STOCK') return false;
    return true;
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const openAdd = () => { setForm({ ...EMPTY_SUPPLY }); setFormErr(null); setShowAdd(true); };

  const enterEdit = () => {
    if (!selected) return;
    setForm({
      name: selected.name ?? '',
      category_id: selected.category_id ?? '',
      vendor_id: selected.vendor_id ?? '',
      sku: selected.sku ?? '',
      barcode: selected.barcode ?? '',
      unit_of_measure: selected.unit_of_measure ?? 'EACH',
      unit_cost: selected.unit_cost != null ? String(selected.unit_cost) : '',
      quantity_on_hand: selected.quantity_on_hand != null ? String(selected.quantity_on_hand) : '',
      reorder_point: selected.reorder_point != null ? String(selected.reorder_point) : '',
      reorder_quantity: selected.reorder_quantity != null ? String(selected.reorder_quantity) : '',
      warehouse_location_id: selected.warehouse_location_id ?? '',
      status: selected.status ?? 'ACTIVE',
      notes: selected.notes ?? '',
    });
    setFormErr(null);
    setEditMode(true);
  };

  const handleSaveNew = async () => {
    if (!form.name.trim()) { setFormErr('Name is required.'); return; }
    setSaving(true); setFormErr(null);
    const { error: err } = await insertRow('supplies', {
      organization_id: orgId!,
      name: form.name.trim(),
      category_id: form.category_id || null,
      vendor_id: form.vendor_id || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      unit_of_measure: form.unit_of_measure || null,
      unit_cost: parseFloat(form.unit_cost) || null,
      quantity_on_hand: parseFloat(form.quantity_on_hand) || 0,
      reorder_point: parseFloat(form.reorder_point) || null,
      reorder_quantity: parseFloat(form.reorder_quantity) || null,
      warehouse_location_id: form.warehouse_location_id || null,
      status: form.status,
      notes: form.notes || null,
    });
    setSaving(false);
    if (err) { setFormErr(err); return; }
    await logActivity(orgId!, userId!, `Added supply: ${form.name.trim()}`, 'supplies');
    setShowAdd(false); reload();
  };

  const handleSaveEdit = async () => {
    if (!selected || !form.name.trim()) { setFormErr('Name is required.'); return; }
    setSaving(true); setFormErr(null);
    const { error: err } = await updateRow('supplies', selected.id, {
      name: form.name.trim(),
      category_id: form.category_id || null,
      vendor_id: form.vendor_id || null,
      sku: form.sku || null,
      barcode: form.barcode || null,
      unit_of_measure: form.unit_of_measure || null,
      unit_cost: parseFloat(form.unit_cost) || null,
      quantity_on_hand: parseFloat(form.quantity_on_hand) || 0,
      reorder_point: parseFloat(form.reorder_point) || null,
      reorder_quantity: parseFloat(form.reorder_quantity) || null,
      warehouse_location_id: form.warehouse_location_id || null,
      status: form.status,
      notes: form.notes || null,
    });
    setSaving(false);
    if (err) { setFormErr(err); return; }
    await logActivity(orgId!, userId!, `Updated supply: ${form.name.trim()}`, 'supplies', selected.id);
    void notifyLowStock(orgId!, selected.id, form.name.trim(), parseFloat(form.quantity_on_hand) || 0, parseFloat(form.reorder_point) || null);
    setEditMode(false); reload();
    setSelected((prev: any) => prev ? { ...prev, ...form, unit_cost: parseFloat(form.unit_cost) || null } : null);
  };

  const handleArchive = async () => {
    if (!selected) return;
    await updateRow('supplies', selected.id, { status: 'ARCHIVED' });
    setShowConfirmArchive(false); setSelected(null); reload();
  };

  const handleDelete = async () => {
    if (!selected) return;
    const txCount = await countLinked('supply_transactions', 'supply_id', selected.id);
    const useCount = await countLinked('supply_usage_logs', 'supply_id', selected.id);
    if (txCount > 0 || useCount > 0) {
      setShowConfirmDelete(false);
      setFormErr(`Cannot delete: supply has ${txCount + useCount} transaction/usage record(s). Archive instead.`);
      return;
    }
    await deleteRow('supplies', selected.id);
    setShowConfirmDelete(false); setSelected(null); reload();
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const supplyForm = (
    <div className="space-y-4">
      {formErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formErr}</p>}
      <FormField label="Name" required><input className={inputCls} value={form.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Bubble Wrap Roll" /></FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Category">
          <select className={selectCls} value={form.category_id} onChange={e => setF('category_id', e.target.value)}>
            <option value="">— None —</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </FormField>
        <FormField label="Vendor">
          <select className={selectCls} value={form.vendor_id} onChange={e => setF('vendor_id', e.target.value)}>
            <option value="">— None —</option>
            {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="SKU"><input className={inputCls} value={form.sku} onChange={e => setF('sku', e.target.value)} placeholder="SKU-001" /></FormField>
        <FormField label="Barcode"><input className={inputCls} value={form.barcode} onChange={e => setF('barcode', e.target.value)} /></FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Unit of Measure">
          <select className={selectCls} value={form.unit_of_measure} onChange={e => setF('unit_of_measure', e.target.value)}>
            {UNIT_OF_MEASURE.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </FormField>
        {canF && (
          <FormField label="Unit Cost ($)"><input type="number" className={inputCls} value={form.unit_cost} onChange={e => setF('unit_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" /></FormField>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <FormField label="Opening / Manual Count"><input type="number" className={inputCls} value={form.quantity_on_hand} onChange={e => setF('quantity_on_hand', e.target.value)} placeholder="0" min="0" /></FormField>
        <FormField label="Reorder Point"><input type="number" className={inputCls} value={form.reorder_point} onChange={e => setF('reorder_point', e.target.value)} placeholder="0" min="0" /></FormField>
        <FormField label="Reorder Qty"><input type="number" className={inputCls} value={form.reorder_quantity} onChange={e => setF('reorder_quantity', e.target.value)} placeholder="0" min="0" /></FormField>
      </div>
      <p className="text-[11px] text-gray-400 -mt-2">Use Supply Transactions for purchases, adjustments, returns, and transfers.</p>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Warehouse Location">
          <select className={selectCls} value={form.warehouse_location_id} onChange={e => setF('warehouse_location_id', e.target.value)}>
            <option value="">— None —</option>
            {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
          </select>
        </FormField>
        <FormField label="Status">
          <select className={selectCls} value={form.status} onChange={e => setF('status', e.target.value)}>
            {SUPPLY_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </FormField>
      </div>
      <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder="Optional notes..." /></FormField>
    </div>
  );

  const titleLabel = filter === 'low-stock' ? 'Low Stock' : filter === 'reorder' ? 'Reorder Queue' : 'Supply Inventory';
  const emptyDesc = filter ? 'No supplies currently require attention.' : 'Add your first supply item to get started.';

  const sorted = sortItems(filteredSupplies, sortCol, sortDir, (item: any, col: string) => {
    if (col === 'name') return item.name;
    if (col === 'category') return item.category?.name;
    if (col === 'sku') return item.sku;
    if (col === 'uom') return item.unit_of_measure;
    if (col === 'cost') return Number(item.unit_cost ?? 0);
    if (col === 'qty') return Number(item.quantity_on_hand ?? 0);
    if (col === 'status') return item.status;
    return null;
  });

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">{titleLabel}</h1>
          {filter === 'low-stock' && <p className="text-[12px] text-gray-400 mt-0.5">Supplies at or below reorder threshold</p>}
          {filter === 'reorder' && <p className="text-[12px] text-gray-400 mt-0.5">Items flagged for reorder — create purchase transactions to replenish</p>}
        </div>
        {canE && !filter && (
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={13} />Add Supply
          </button>
        )}
      </div>

      <FilterBar defs={supplyFilterDefs} values={filterValues} onChange={setFilterValues} />
      {filteredSupplies.length === 0 ? (
        <EmptyState icon={<Layers size={18} className="text-gray-400" />} title={`No ${titleLabel.toLowerCase()} items`} description={emptyDesc} action={canE && !filter ? { label: 'Add Supply', onClick: openAdd } : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              {([
                  { label: 'Name', col: 'name' },
                  { label: 'Category', col: 'category' },
                  { label: 'SKU', col: 'sku' },
                  { label: 'UOM', col: 'uom' },
                  { label: 'Unit Cost', col: 'cost' },
                  { label: 'On Hand', col: 'qty' },
                  { label: 'Status', col: 'status' },
              ] as const).map(({ label, col }) => (
                <th key={col} onClick={() => col && handleSort(col)}
                  className={`text-left px-4 py-2.5 text-[10px] font-medium text-gray-400 uppercase tracking-wide bg-gray-50 border-b border-[rgba(0,0,0,0.06)] whitespace-nowrap ${col ? 'cursor-pointer select-none hover:text-gray-600 transition-colors' : ''}`}>
                  <span className="inline-flex items-center gap-1">
                    {label}
                    {col && sortCol === col ? <span className="text-[#3ECF8E]">{sortDir === 'asc' ? '↑' : '↓'}</span> : col ? <span className="opacity-0">↕</span> : null}
                  </span>
                </th>
              ))}
              <Th right>On Hand</Th>
              <Th right>Reorder Pt</Th>
              <Th>Location</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s: any) => (
              <tr key={s.id} onClick={() => { setSelected(s); setEditMode(false); }}
                className="border-b border-[rgba(0,0,0,0.04)] last:border-0 hover:bg-gray-50/50 cursor-pointer">
                <Td><span className="font-medium text-gray-900">{s.name}</span>{s.vendor?.name && <span className="text-[11px] text-gray-400 block">{s.vendor.name}</span>}</Td>
                <Td muted>{s.category?.name ?? '—'}</Td>
                <Td muted>{s.sku ?? '—'}</Td>
                <Td muted>{s.unit_of_measure ?? '—'}</Td>
                {canF && <Td right muted>{fmt(s.unit_cost)}</Td>}
                <Td right>
                  <span className={
                    s.quantity_on_hand === 0 ? 'text-red-600 font-medium' :
                    s.reorder_point != null && s.quantity_on_hand <= s.reorder_point ? 'text-amber-600 font-medium' :
                    'text-gray-700'
                  }>{s.quantity_on_hand ?? 0}</span>
                </Td>
                <Td right muted>{s.reorder_point ?? '—'}</Td>
                <Td muted>{s.location?.name ?? '—'}</Td>
                <Td><StatusBadge status={s.status} size="sm" /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Detail / Edit Drawer */}
      <Drawer
        open={!!selected}
        onClose={() => { setSelected(null); setEditMode(false); setFormErr(null); }}
        title={editMode ? 'Edit Supply' : (selected?.name ?? 'Supply')}
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-2">
              {canE && !editMode && selected?.status !== 'ARCHIVED' && (
                <>
                  <button onClick={() => setShowConfirmArchive(true)} className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-gray-500 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                    <Archive size={12} />Archive
                  </button>
                  <button onClick={() => setShowConfirmDelete(true)} className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                    <Trash2 size={12} />Delete
                  </button>
                </>
              )}
            </div>
            <div className="flex gap-2">
              {editMode ? (
                <>
                  <button onClick={() => { setEditMode(false); setFormErr(null); }} className="px-3 py-1.5 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={handleSaveEdit} disabled={saving} className="px-4 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                </>
              ) : canE ? (
                <button onClick={enterEdit} className="flex items-center gap-1 px-3 py-1.5 text-[13px] text-gray-700 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                  <Edit2 size={12} />Edit
                </button>
              ) : null}
            </div>
          </div>
        }
      >
        {editMode ? supplyForm : selected && (
          <div className="divide-y divide-[rgba(0,0,0,0.04)]">
            {formErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-3">{formErr}</p>}
            <DetailRow label="Name" value={selected.name} />
            <DetailRow label="Category" value={selected.category?.name} />
            <DetailRow label="Vendor" value={selected.vendor?.name} />
            <DetailRow label="SKU" value={selected.sku} />
            <DetailRow label="Barcode" value={selected.barcode} />
            <DetailRow label="Unit of Measure" value={selected.unit_of_measure} />
            {canF && <DetailRow label="Unit Cost" value={fmt(selected.unit_cost)} />}
            <DetailRow label="Qty On Hand" value={selected.quantity_on_hand ?? 0} />
            <DetailRow label="Reorder Point" value={selected.reorder_point} />
            <DetailRow label="Reorder Qty" value={selected.reorder_quantity} />
            <DetailRow label="Warehouse Location" value={selected.location?.name} />
            <DetailRow label="Status" value={<StatusBadge status={selected.status} />} />
            <DetailRow label="Notes" value={selected.notes} />
          </div>
        )}
      </Drawer>

      {/* Add Modal */}
      <Modal
        open={showAdd}
        onClose={() => { setShowAdd(false); setFormErr(null); }}
        title="Add Supply"
        footer={
          <>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSaveNew} disabled={saving} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
              {saving ? 'Adding…' : 'Add Supply'}
            </button>
          </>
        }
      >
        {supplyForm}
      </Modal>

      <ConfirmDialog
        open={showConfirmDelete}
        title="Delete Supply"
        description="This will permanently delete this supply. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setShowConfirmDelete(false)}
      />
      <ConfirmDialog
        open={showConfirmArchive}
        title="Archive Supply"
        description="This supply will be marked as archived and hidden from active operations."
        confirmLabel="Archive"
        onConfirm={handleArchive}
        onCancel={() => setShowConfirmArchive(false)}
      />
    </>
  );
}

// ─── Transactions ─────────────────────────────────────────────────────────────

function TransactionsView({ orgId, userId, role }: { orgId: string | null; userId: string | undefined; role: string | null | undefined }) {
  const canE = canEditOps(role as any);
  const canF = canEditFinance(role as any);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_TX });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data: transactions, loading, error, reload } = useOrgQuery<any>('supply_transactions', orgId, {
    select: '*, supply:supplies(name, unit_of_measure)',
    orderBy: 'created_at', ascending: false,
  });
  const { data: supplies } = useOrgQuery<any>('supplies', orgId, {
    select: 'id, name, unit_of_measure, unit_cost',
    orderBy: 'name', ascending: true,
    enabled: showAdd,
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.supply_id) { setFormErr('Supply is required.'); return; }
    if (!form.quantity) { setFormErr('Quantity is required.'); return; }
    setSaving(true); setFormErr(null);
    const qty = parseFloat(form.quantity);
    const unitCost = parseFloat(form.unit_cost) || null;
    const totalCost = unitCost != null ? parseFloat((unitCost * Math.abs(qty)).toFixed(2)) : null;

    const { error: err } = await insertRow('supply_transactions', {
      organization_id: orgId!,
      supply_id: form.supply_id,
      transaction_type: form.transaction_type,
      quantity: qty,
      unit_cost: unitCost,
      total_cost: totalCost,
      reference_number: form.reference_number || null,
      notes: form.notes || null,
    });
    if (err) { setSaving(false); setFormErr(err); return; }

    // DB trigger handles quantity_on_hand — only update unit_cost on PURCHASE
    const supply = supplies.find((s: any) => s.id === form.supply_id);
    if (form.transaction_type === 'PURCHASE' && unitCost) {
      const { error: costErr } = await updateRow('supplies', form.supply_id, { unit_cost: unitCost });
      if (costErr) {
        setSaving(false);
        setFormErr(`Transaction saved, but failed to update unit cost: ${costErr}`);
        reload();
        return;
      }
    }

    await logActivity(orgId!, userId!, `Supply transaction: ${form.transaction_type} ${form.quantity} × ${supply?.name ?? form.supply_id}`, 'supply_transactions');
    setSaving(false); setShowAdd(false); setForm({ ...EMPTY_TX }); reload();
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[15px] font-semibold text-gray-900">Supply Transactions</h1>
        {canE && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={13} />Add Transaction
          </button>
        )}
      </div>

      {transactions.length === 0 ? (
        <EmptyState icon={<RefreshCw size={18} className="text-gray-400" />} title="No transactions" description="Log supply purchases and adjustments here." action={canE ? { label: 'Add Transaction', onClick: () => setShowAdd(true) } : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Supply</Th>
              <Th>Type</Th>
              <Th right>Qty</Th>
              {canF && <><Th right>Unit Cost</Th><Th right>Total</Th></>}
              <Th>Reference</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t: any) => (
              <tr key={t.id} className="border-b border-[rgba(0,0,0,0.04)] last:border-0 hover:bg-gray-50/50">
                <Td muted>{new Date(t.created_at).toLocaleDateString()}</Td>
                <Td><span className="font-medium text-gray-900">{t.supply?.name ?? '—'}</span></Td>
                <Td><StatusBadge status={t.transaction_type} size="sm" /></Td>
                <Td right>{t.quantity > 0 ? `+${t.quantity}` : t.quantity} <span className="text-[11px] text-gray-400">{t.supply?.unit_of_measure}</span></Td>
                {canF && <><Td right muted>{fmt(t.unit_cost)}</Td><Td right muted>{fmt(t.total_cost)}</Td></>}
                <Td muted>{t.reference_number ?? '—'}</Td>
                <Td muted>{t.notes ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setFormErr(null); }} title="Add Transaction"
        footer={
          <>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
              {saving ? 'Saving…' : 'Add Transaction'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formErr}</p>}
          <FormField label="Supply" required>
            <select className={selectCls} value={form.supply_id} onChange={e => {
              setF('supply_id', e.target.value);
              const sup = supplies.find((s: any) => s.id === e.target.value);
              if (sup?.unit_cost) setF('unit_cost', String(sup.unit_cost));
            }}>
              <option value="">— Select Supply —</option>
              {supplies.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select className={selectCls} value={form.transaction_type} onChange={e => setF('transaction_type', e.target.value)}>
                {TX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Quantity" required><input type="number" className={inputCls} value={form.quantity} onChange={e => setF('quantity', e.target.value)} placeholder="0" /></FormField>
          </div>
          {canF && (
            <FormField label="Unit Cost ($)"><input type="number" className={inputCls} value={form.unit_cost} onChange={e => setF('unit_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" /></FormField>
          )}
          <FormField label="Reference #"><input className={inputCls} value={form.reference_number} onChange={e => setF('reference_number', e.target.value)} placeholder="PO-001 or invoice number" /></FormField>
          <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => setF('notes', e.target.value)} /></FormField>
        </div>
      </Modal>
    </>
  );
}

// ─── Usage Log ────────────────────────────────────────────────────────────────

function UsageView({ orgId, userId, role }: { orgId: string | null; userId: string | undefined; role: string | null | undefined }) {
  const canE = canEditOps(role as any);
  const canF = canEditFinance(role as any);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_USAGE });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const { data: usageLogs, loading, error, reload } = useOrgQuery<any>('supply_usage_logs', orgId, {
    select: '*, supply:supplies(name, unit_of_measure, unit_cost), inventory_items(product_title), orders(order_id), shipments(tracking_number, shipment_id)',
    orderBy: 'created_at', ascending: false,
  });
  const { data: supplies } = useOrgQuery<any>('supplies', orgId, {
    select: 'id, name, unit_of_measure, unit_cost, quantity_on_hand, reorder_point',
    orderBy: 'name', ascending: true,
    enabled: showAdd,
  });
  const { data: linkItems } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, product_title, sku',
    orderBy: 'product_title', ascending: true,
    enabled: showAdd,
  });
  const { data: linkOrders } = useOrgQuery<any>('orders', orgId, {
    select: 'id, order_id',
    orderBy: 'created_at', ascending: false,
    enabled: showAdd,
  });
  const { data: linkShipments } = useOrgQuery<any>('shipments', orgId, {
    select: 'id, shipment_id, tracking_number',
    orderBy: 'created_at', ascending: false,
    enabled: showAdd,
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.supply_id) { setFormErr('Supply is required.'); return; }
    if (!form.quantity_used) { setFormErr('Quantity is required.'); return; }
    setSaving(true); setFormErr(null);

    const supply = supplies.find((s: any) => s.id === form.supply_id);
    const qty = parseFloat(form.quantity_used);
    const unitCost = supply?.unit_cost ?? null;
    const totalCost = unitCost != null ? parseFloat((unitCost * qty).toFixed(2)) : null;

    const { error: err } = await insertRow('supply_usage_logs', {
      organization_id: orgId!,
      supply_id: form.supply_id,
      quantity_used: qty,
      unit_cost_at_use: unitCost,
      total_cost: totalCost,
      inventory_item_id: form.inventory_item_id || null,
      order_id: form.order_id || null,
      shipment_id: form.shipment_id || null,
      notes: form.notes || null,
    });
    if (err) { setSaving(false); setFormErr(err); return; }

    // DB trigger handles quantity deduction — re-fetch actual quantity for low-stock check
    const { data: refreshed } = await supabase
      .from('supplies')
      .select('quantity_on_hand, reorder_point, name')
      .eq('id', form.supply_id)
      .single();
    if (refreshed) {
      void notifyLowStock(orgId!, form.supply_id, refreshed.name ?? supply?.name ?? '', refreshed.quantity_on_hand ?? 0, refreshed.reorder_point ?? null);
    }

    await logActivity(orgId!, userId!, `Logged supply usage: ${qty} × ${supply?.name ?? form.supply_id}`, 'supply_usage_logs');
    setSaving(false); setShowAdd(false); setForm({ ...EMPTY_USAGE }); reload();
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[15px] font-semibold text-gray-900">Supply Usage Log</h1>
        {canE && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={13} />Log Usage
          </button>
        )}
      </div>

      {usageLogs.length === 0 ? (
        <EmptyState icon={<Package size={18} className="text-gray-400" />} title="No usage logged" description="Track supply consumption against inventory items, orders, and shipments." action={canE ? { label: 'Log Usage', onClick: () => setShowAdd(true) } : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Supply</Th>
              <Th right>Qty Used</Th>
              {canF && <Th right>Total Cost</Th>}
              <Th>Linked To</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {usageLogs.map((u: any) => (
              <tr key={u.id} className="border-b border-[rgba(0,0,0,0.04)] last:border-0 hover:bg-gray-50/50">
                <Td muted>{new Date(u.created_at).toLocaleDateString()}</Td>
                <Td><span className="font-medium text-gray-900">{u.supply?.name ?? '—'}</span></Td>
                <Td right>{u.quantity_used} <span className="text-[11px] text-gray-400">{u.supply?.unit_of_measure}</span></Td>
                {canF && <Td right muted>{fmt(u.total_cost)}</Td>}
                <Td muted>
                  {u.inventory_item_id
                    ? <span className="text-[11px]">Item: <span className="font-mono">{u.inventory_items?.product_title ?? u.inventory_item_id.slice(0, 8)}</span></span>
                    : u.order_id
                    ? <span className="text-[11px]">Order: <span className="font-mono">#{(u.orders?.order_id ?? u.order_id).slice(0, 8).toUpperCase()}</span></span>
                    : u.shipment_id
                    ? <span className="text-[11px]">Ship: <span className="font-mono">{u.shipments?.tracking_number ?? (u.shipment_id).slice(0, 8)}</span></span>
                    : '—'}
                </Td>
                <Td muted>{u.notes ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setFormErr(null); }} title="Log Supply Usage"
        footer={
          <>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
              {saving ? 'Saving…' : 'Log Usage'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formErr}</p>}
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Supply" required>
              <select className={selectCls} value={form.supply_id} onChange={e => setF('supply_id', e.target.value)}>
                <option value="">— Select Supply —</option>
                {supplies.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </FormField>
            <FormField label="Quantity Used" required><input type="number" className={inputCls} value={form.quantity_used} onChange={e => setF('quantity_used', e.target.value)} placeholder="0" min="0.01" step="0.01" /></FormField>
          </div>
          <div className="h-px bg-[rgba(0,0,0,0.05)]" />
          <p className="text-[11px] text-gray-400 uppercase tracking-wide font-medium">Link to (optional)</p>
          <FormField label="Inventory Item">
            <select className={selectCls} value={form.inventory_item_id} onChange={e => setF('inventory_item_id', e.target.value)}>
              <option value="">— None —</option>
              {linkItems.map((i: any) => (
                <option key={i.id} value={i.id}>
                  {i.product_title}{i.sku ? ` · ${i.sku}` : ''}
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Order">
              <select className={selectCls} value={form.order_id} onChange={e => setF('order_id', e.target.value)}>
                <option value="">— None —</option>
                {linkOrders.map((o: any) => (
                  <option key={o.id} value={o.id}>#{(o.order_id ?? o.id).slice(0, 8).toUpperCase()}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Shipment">
              <select className={selectCls} value={form.shipment_id} onChange={e => setF('shipment_id', e.target.value)}>
                <option value="">— None —</option>
                {linkShipments.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.tracking_number ?? `#${(s.shipment_id ?? s.id).slice(0, 8).toUpperCase()}`}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => setF('notes', e.target.value)} /></FormField>
        </div>
      </Modal>
    </>
  );
}

// ─── Packaging Templates ──────────────────────────────────────────────────────

function TemplatesView({ orgId, userId, role }: { orgId: string | null; userId: string | undefined; role: string | null | undefined }) {
  const canE = canEdit(role as any);
  const [selected, setSelected] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_TEMPLATE });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [showApply, setShowApply] = useState(false);
  const [applyTarget, setApplyTarget] = useState({ type: 'inventory_item' as 'inventory_item' | 'shipment', id: '' });
  const [applying, setApplying] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  // Template item editor
  const [templateItems, setTemplateItems] = useState<Array<{ supply_id: string; quantity: string }>>([]);
  const [editingItems, setEditingItems] = useState(false);
  const [savingItems, setSavingItems] = useState(false);

  const { data: templates, loading, error, reload } = useOrgQuery<any>('packaging_templates', orgId, {
    select: 'id, name, description, created_at',
    orderBy: 'name', ascending: true,
  });
  const { data: templateItemsData, reload: reloadItems } = useOrgQuery<any>('packaging_template_items', orgId as any, {
    select: '*, supply:supplies(id, name, unit_of_measure, unit_cost)',
    filter: (q: any) => q.eq('template_id', selected?.id ?? '___none___'),
    filterKey: selected?.id ?? 'none',
    orderBy: 'created_at', ascending: true,
    enabled: !!selected?.id,
  });
  const { data: supplies } = useOrgQuery<any>('supplies', orgId, {
    select: 'id, name, unit_of_measure',
    orderBy: 'name', ascending: true,
    enabled: editingItems || showApply,
  });
  const { data: applyItems } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, product_title',
    orderBy: 'created_at', ascending: false,
    enabled: showApply && applyTarget.type === 'inventory_item',
  });
  const { data: applyShipments } = useOrgQuery<any>('shipments', orgId, {
    select: 'id, shipment_id, tracking_number',
    orderBy: 'created_at', ascending: false,
    enabled: showApply && applyTarget.type === 'shipment',
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSaveTemplate = async () => {
    if (!form.name.trim()) { setFormErr('Name is required.'); return; }
    setSaving(true); setFormErr(null);
    const { error: err } = await insertRow('packaging_templates', {
      organization_id: orgId!,
      name: form.name.trim(),
      description: form.description || null,
    });
    setSaving(false);
    if (err) { setFormErr(err); return; }
    setShowAdd(false); setForm({ ...EMPTY_TEMPLATE }); reload();
  };

  const handleDelete = async () => {
    if (!selected) return;
    await supabase.from('packaging_template_items').delete().eq('organization_id', orgId!).eq('template_id', selected.id);
    await deleteRow('packaging_templates', selected.id);
    setSelected(null); reload();
  };

  const startEditItems = () => {
    setTemplateItems(
      templateItemsData.map((ti: any) => ({ supply_id: ti.supply_id, quantity: String(ti.quantity) }))
    );
    setEditingItems(true);
  };

  const saveItems = async () => {
    if (!selected) return;
    setSavingItems(true);
    await supabase.from('packaging_template_items').delete().eq('organization_id', orgId!).eq('template_id', selected.id);
    const rows = templateItems.filter(ti => ti.supply_id && parseFloat(ti.quantity) > 0).map(ti => ({
      organization_id: orgId!,
      template_id: selected.id,
      supply_id: ti.supply_id,
      quantity: parseFloat(ti.quantity),
    }));
    if (rows.length > 0) await supabase.from('packaging_template_items').insert(rows);
    setSavingItems(false); setEditingItems(false); reloadItems();
  };

  const handleApply = async () => {
    if (!selected || !applyTarget.id.trim()) { setApplyErr('Target ID is required.'); return; }
    const items = templateItemsData;
    if (!items.length) { setApplyErr('Template has no items.'); return; }

    // Fetch current supply quantities and validate before applying
    setApplying(true); setApplyErr(null);
    const supplyIds = [...new Set<string>(items.map((ti: any) => ti.supply_id))];
    const { data: currentSupplies } = await supabase
      .from('supplies')
      .select('id, name, unit_cost, quantity_on_hand, reorder_point')
      .in('id', supplyIds);
    const supplyMap: Record<string, any> = Object.fromEntries((currentSupplies ?? []).map((s: any) => [s.id, s]));

    const shortages: string[] = [];
    for (const ti of items) {
      const sup = supplyMap[ti.supply_id];
      if (!sup) { shortages.push(`Supply not found: ${ti.supply_id.slice(0, 8)}`); continue; }
      if ((sup.quantity_on_hand ?? 0) < ti.quantity) {
        shortages.push(`${sup.name}: need ${ti.quantity}, have ${sup.quantity_on_hand ?? 0}`);
      }
    }
    if (shortages.length > 0) {
      setApplying(false);
      setApplyErr(`Insufficient stock — ${shortages.join('; ')}`);
      return;
    }

    // Insert usage logs (DB trigger handles quantity deduction and cost rollups)
    for (const ti of items) {
      const sup = supplyMap[ti.supply_id];
      const unitCost = sup?.unit_cost ?? null;
      const { error: usageErr } = await insertRow('supply_usage_logs', {
        organization_id: orgId!,
        supply_id: ti.supply_id,
        quantity_used: ti.quantity,
        unit_cost_at_use: unitCost,
        total_cost: unitCost != null ? parseFloat((unitCost * ti.quantity).toFixed(2)) : null,
        inventory_item_id: applyTarget.type === 'inventory_item' ? applyTarget.id : null,
        shipment_id: applyTarget.type === 'shipment' ? applyTarget.id : null,
        notes: `Template: ${selected.name}`,
      });
      if (usageErr) {
        setApplying(false);
        setApplyErr(`Failed to apply supply "${sup?.name ?? ti.supply_id}": ${usageErr}`);
        return;
      }
    }

    // Re-fetch actual post-trigger quantities for low-stock notifications
    const { data: updatedSupplies } = await supabase
      .from('supplies')
      .select('id, name, quantity_on_hand, reorder_point')
      .in('id', supplyIds);
    for (const sup of (updatedSupplies ?? [])) {
      void notifyLowStock(orgId!, sup.id, sup.name, sup.quantity_on_hand ?? 0, sup.reorder_point ?? null);
    }

    await logActivity(orgId!, userId!, `Applied template "${selected.name}" to ${applyTarget.type} ${applyTarget.id.slice(0, 8)}`, 'packaging_templates', selected.id);
    setApplying(false); setShowApply(false); setApplyTarget({ type: 'inventory_item', id: '' });
    reloadItems();
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Packaging Templates</h1>
          <p className="text-[12px] text-gray-400 mt-0.5">Reusable supply bundles for items and shipments</p>
        </div>
        {canE && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={13} />New Template
          </button>
        )}
      </div>

      {templates.length === 0 ? (
        <EmptyState icon={<Layers size={18} className="text-gray-400" />} title="No templates" description='Create templates like "Laptop 13-16" or "Printer Small" to apply standard supply bundles.' action={canE ? { label: 'New Template', onClick: () => setShowAdd(true) } : undefined} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {templates.map((t: any) => (
            <div key={t.id} onClick={() => setSelected(t)}
              className="border border-[rgba(0,0,0,0.07)] rounded-xl p-4 hover:border-[rgba(0,0,0,0.12)] cursor-pointer transition-colors bg-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{t.name}</p>
                  {t.description && <p className="text-[12px] text-gray-400 mt-0.5">{t.description}</p>}
                </div>
                <Layers size={14} className="text-gray-300 flex-shrink-0 mt-0.5" />
              </div>
              <p className="text-[11px] text-gray-400 mt-3">Created {new Date(t.created_at).toLocaleDateString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Template Detail Drawer */}
      <Drawer
        open={!!selected}
        onClose={() => { setSelected(null); setEditingItems(false); }}
        title={selected?.name ?? 'Template'}
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-2">
              {canE && !editingItems && (
                <button onClick={handleDelete} className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                  <Trash2 size={12} />Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              {editingItems ? (
                <>
                  <button onClick={() => setEditingItems(false)} className="px-3 py-1.5 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={saveItems} disabled={savingItems} className="px-4 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
                    {savingItems ? 'Saving…' : 'Save Items'}
                  </button>
                </>
              ) : (
                <>
                  {canE && <button onClick={startEditItems} className="flex items-center gap-1 px-3 py-1.5 text-[13px] text-gray-700 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50"><Edit2 size={12} />Edit Items</button>}
                  <button onClick={() => setShowApply(true)} className="flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg"><ChevronRight size={13} />Apply</button>
                </>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {selected && <DetailRow label="Description" value={selected.description} />}
          <div>
            <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wide mb-2">Supplies in Template</p>
            {editingItems ? (
              <div className="space-y-2">
                {templateItems.map((ti, i) => (
                  <div key={i} className="flex gap-2">
                    <select className={`${selectCls} flex-1`} value={ti.supply_id} onChange={e => setTemplateItems(prev => prev.map((x, j) => j === i ? { ...x, supply_id: e.target.value } : x))}>
                      <option value="">— Select Supply —</option>
                      {supplies.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <input type="number" className={`${inputCls} w-20`} value={ti.quantity} min="0.01" step="0.01" onChange={e => setTemplateItems(prev => prev.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} placeholder="Qty" />
                    <button onClick={() => setTemplateItems(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 px-1"><X size={13} /></button>
                  </div>
                ))}
                <button onClick={() => setTemplateItems(prev => [...prev, { supply_id: '', quantity: '1' }])}
                  className="flex items-center gap-1 text-[12px] text-[#3ECF8E] hover:text-[#38c484] font-medium mt-1">
                  <Plus size={12} />Add Supply
                </button>
              </div>
            ) : (
              <div className="space-y-1">
                {templateItemsData.length === 0 ? (
                  <p className="text-[13px] text-gray-400">No supplies added yet. Click "Edit Items" to add.</p>
                ) : templateItemsData.map((ti: any) => (
                  <div key={ti.id} className="flex items-center justify-between py-1.5 border-b border-[rgba(0,0,0,0.04)] last:border-0">
                    <span className="text-[13px] text-gray-700">{ti.supply?.name}</span>
                    <span className="text-[12px] text-gray-500">{ti.quantity} {ti.supply?.unit_of_measure}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Drawer>

      {/* Add Template Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Packaging Template"
        footer={
          <>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSaveTemplate} disabled={saving} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
              {saving ? 'Saving…' : 'Create Template'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formErr}</p>}
          <FormField label="Name" required><input className={inputCls} value={form.name} onChange={e => setF('name', e.target.value)} placeholder='e.g. "Laptop 13-16" or "Printer Small"' /></FormField>
          <FormField label="Description"><textarea className={textareaCls} rows={2} value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Optional description..." /></FormField>
        </div>
      </Modal>

      {/* Apply Modal */}
      <Modal open={showApply} onClose={() => { setShowApply(false); setApplyErr(null); }} title={`Apply: ${selected?.name}`}
        footer={
          <>
            <button onClick={() => setShowApply(false)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleApply} disabled={applying} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
              {applying ? 'Applying…' : 'Apply Template'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {applyErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{applyErr}</p>}
          <FormField label="Apply To">
            <select className={selectCls} value={applyTarget.type} onChange={e => setApplyTarget({ type: e.target.value as any, id: '' })}>
              <option value="inventory_item">Inventory Item</option>
              <option value="shipment">Shipment</option>
            </select>
          </FormField>
          {applyTarget.type === 'inventory_item' ? (
            <FormField label="Inventory Item" required>
              <select className={selectCls} value={applyTarget.id} onChange={e => setApplyTarget(t => ({ ...t, id: e.target.value }))}>
                <option value="">— select item —</option>
                {applyItems.map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {item.inventory_id ? `${item.inventory_id} — ` : ''}{item.product_title ?? 'Untitled'}
                  </option>
                ))}
              </select>
            </FormField>
          ) : (
            <FormField label="Shipment" required>
              <select className={selectCls} value={applyTarget.id} onChange={e => setApplyTarget(t => ({ ...t, id: e.target.value }))}>
                <option value="">— select shipment —</option>
                {applyShipments.map((ship: any) => (
                  <option key={ship.id} value={ship.id}>
                    {ship.shipment_id ?? ship.id.slice(0, 8)}{ship.tracking_number ? ` — ${ship.tracking_number}` : ''}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          <div className="text-[12px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            {templateItemsData.length} supply item{templateItemsData.length !== 1 ? 's' : ''} will be logged as usage and deducted from stock.
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Invoice Imports ──────────────────────────────────────────────────────────

function InvoiceImportsView({ orgId, userId, role }: { orgId: string | null; userId: string | undefined; role: string | null | undefined }) {
  const canE = canEdit(role as any);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showImport, setShowImport] = useState(false);

  const { data: imports, loading, error, reload } = useOrgQuery<any>('supply_invoice_imports', orgId, {
    select: '*',
    orderBy: 'created_at', ascending: false,
  });
  const { data: supplies } = useOrgQuery<any>('supplies', orgId, { select: 'id, name', orderBy: 'name', ascending: true, enabled: showImport });
  const { data: categories } = useOrgQuery<any>('supply_categories', orgId, { select: 'id, name', orderBy: 'name', ascending: true, enabled: showImport });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name', orderBy: 'name', ascending: true, enabled: showImport });
  const { data: locations } = useOrgQuery<any>('warehouse_locations', orgId, { select: 'id, name, code', orderBy: 'name', ascending: true, enabled: showImport });

  useEffect(() => {
    if (searchParams.get('action') === 'upload-supply-invoice') {
      setShowImport(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[15px] font-semibold text-gray-900">Supply Invoice Imports</h1>
          <p className="text-[12px] text-gray-400 mt-0.5">Import supplies from vendor invoices (CSV, XLSX, PDF)</p>
        </div>
        {canE && (
          <button onClick={() => setShowImport(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={13} />Upload Invoice
          </button>
        )}
      </div>

      {imports.length === 0 ? (
        <EmptyState icon={<FileText size={18} className="text-gray-400" />} title="No invoice imports" description="Upload vendor invoices to create or update supply records." action={canE ? { label: 'Upload Invoice', onClick: () => setShowImport(true) } : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>File Type</Th>
              <Th>Status</Th>
              <Th right>Items</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {imports.map((imp: any) => (
              <tr key={imp.id} className="border-b border-[rgba(0,0,0,0.04)] last:border-0 hover:bg-gray-50/50">
                <Td muted>{new Date(imp.created_at).toLocaleDateString()}</Td>
                <Td muted>{(imp.file_type ?? '').toUpperCase()}</Td>
                <Td><StatusBadge status={imp.status} size="sm" /></Td>
                <Td right muted>{imp.item_count ?? '—'}</Td>
                <Td muted>{imp.notes ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <SupplyInvoiceImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        orgId={orgId}
        userId={userId}
        existingSupplies={supplies}
        categories={categories}
        vendors={vendors}
        locations={locations}
        onCreated={reload}
      />
    </>
  );
}

// ─── Categories ───────────────────────────────────────────────────────────────

function CategoriesView({ orgId, userId, role }: { orgId: string | null; userId: string | undefined; role: string | null | undefined }) {
  const canE = canEdit(role as any);
  const [showAdd, setShowAdd] = useState(false);
  const _si = (() => { try { return JSON.parse(localStorage.getItem('deryv.sort.supplies') ?? 'null') ?? {}; } catch { return {}; } })();
  const [sortCol, setSortCol] = useState<string | null>(_si.col ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_si.dir ?? 'asc');
  const handleSort = (col: string) => {
    const next = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortCol(col); setSortDir(next as 'asc' | 'desc');
    localStorage.setItem('deryv.sort.supplies', JSON.stringify({ col, dir: next }));
  };
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_CATEGORY });
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const { data: categories, loading, error, reload } = useOrgQuery<any>('supply_categories', orgId, {
    select: '*', orderBy: 'name', ascending: true,
  });

  const setF = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const openAdd = () => { setForm({ ...EMPTY_CATEGORY }); setFormErr(null); setEditId(null); setShowAdd(true); };
  const openEdit = (cat: any) => { setForm({ name: cat.name, description: cat.description ?? '', color: cat.color ?? '#6B7280' }); setFormErr(null); setEditId(cat.id); setShowAdd(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { setFormErr('Name is required.'); return; }
    setSaving(true); setFormErr(null);
    if (editId) {
      const { error: err } = await updateRow('supply_categories', editId, { name: form.name.trim(), description: form.description || null, color: form.color });
      setSaving(false); if (err) { setFormErr(err); return; }
    } else {
      const { error: err } = await insertRow('supply_categories', { organization_id: orgId!, name: form.name.trim(), description: form.description || null, color: form.color });
      setSaving(false); if (err) { setFormErr(err); return; }
    }
    setShowAdd(false); reload();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const linked = await countLinked('supplies', 'category_id', deleteTarget.id);
    if (linked > 0) { setDeleteTarget(null); return; }
    await deleteRow('supply_categories', deleteTarget.id);
    setDeleteTarget(null); reload();
  };

  if (loading) return <PageLoader />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[15px] font-semibold text-gray-900">Supply Categories</h1>
        {canE && (
          <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={13} />Add Category
          </button>
        )}
      </div>

      {categories.length === 0 ? (
        <EmptyState icon={<Tag size={18} className="text-gray-400" />} title="No categories" description="Organize supplies with categories." action={canE ? { label: 'Add Category', onClick: openAdd } : undefined} />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Color</Th>
              <Th>Name</Th>
              <Th>Description</Th>
              {canE && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat: any) => (
              <tr key={cat.id} className="border-b border-[rgba(0,0,0,0.04)] last:border-0 hover:bg-gray-50/50">
                <Td><div className="w-4 h-4 rounded-full" style={{ backgroundColor: cat.color ?? '#6B7280' }} /></Td>
                <Td><span className="font-medium text-gray-900">{cat.name}</span></Td>
                <Td muted>{cat.description ?? '—'}</Td>
                {canE && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(cat)} className="text-[12px] text-gray-500 hover:text-gray-800 flex items-center gap-1"><Edit2 size={11} />Edit</button>
                      <button onClick={() => setDeleteTarget(cat)} className="text-[12px] text-red-400 hover:text-red-600 flex items-center gap-1"><Trash2 size={11} />Delete</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={editId ? 'Edit Category' : 'Add Category'}
        footer={
          <>
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
              {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Category'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {formErr && <p className="text-[12px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{formErr}</p>}
          <FormField label="Name" required><input className={inputCls} value={form.name} onChange={e => setF('name', e.target.value)} placeholder="e.g. Packaging, Labels, Tape" /></FormField>
          <FormField label="Description"><input className={inputCls} value={form.description} onChange={e => setF('description', e.target.value)} placeholder="Optional description" /></FormField>
          <FormField label="Color">
            <div className="flex items-center gap-2">
              {CATEGORY_COLORS.map(c => (
                <button key={c} onClick={() => setF('color', c)} className={`w-6 h-6 rounded-full transition-all ${form.color === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''}`} style={{ backgroundColor: c }} />
              ))}
            </div>
          </FormField>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Category"
        description={`Delete "${deleteTarget?.name}"? Any supplies in this category will become uncategorized.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}

// ─── Main Supplies Component ──────────────────────────────────────────────────

export function Supplies() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const userId = user?.id;

  const props = { orgId, userId, role };

  switch (view) {
    case 'overview':         return <OverviewView orgId={orgId} role={role} />;
    case 'supply-inventory': return <SupplyInventoryView {...props} />;
    case 'low-stock':        return <SupplyInventoryView {...props} filter="low-stock" />;
    case 'reorder':          return <SupplyInventoryView {...props} filter="reorder" />;
    case 'transactions':     return <TransactionsView {...props} />;
    case 'usage':            return <UsageView {...props} />;
    case 'templates':        return <TemplatesView {...props} />;
    case 'invoice-imports':  return <InvoiceImportsView {...props} />;
    case 'categories':       return <CategoriesView {...props} />;
    default:                 return <OverviewView orgId={orgId} role={role} />;
  }
}
