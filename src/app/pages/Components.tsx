import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Plus, Cpu, AlertTriangle, Layers, Tag, Trash2, Edit2, Package, X, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity, createNotification } from '../../lib/hooks';
import { canEdit, canEditFinance, isAdmin } from '../../lib/permissions';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  DetailRow, EmptyState, ErrorState, Modal, FormField,
  inputCls, selectCls, textareaCls,
} from '../components/DataStates';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';
import { supabase } from '../../lib/supabase';

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPONENT_STATUSES = ['ACTIVE', 'LOW_STOCK', 'REORDER', 'OUT_OF_STOCK', 'DISCONTINUED', 'ARCHIVED'];
const TX_TYPES = ['PURCHASE', 'ADJUSTMENT', 'RETURN', 'TRANSFER'];
const CATEGORY_COLORS = ['#6B7280','#3ECF8E','#3B82F6','#F59E0B','#EF4444','#8B5CF6','#EC4899','#14B8A6'];

function fmt(n: number | null | undefined): string {
  if (n == null) return '—';
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function notifyComponentLowStock(
  orgId: string, componentId: string, name: string,
  newQty: number, reorderPoint: number | null
) {
  if (reorderPoint == null || newQty > reorderPoint) return;
  const { data: existing } = await supabase
    .from('notifications')
    .select('id')
    .eq('organization_id', orgId)
    .eq('entity_type', 'components')
    .eq('entity_id', componentId)
    .eq('is_read', false)
    .ilike('title', '%stock%')
    .limit(1);
  if (existing?.length) return;
  const isOut = newQty <= 0;
  void createNotification(
    orgId,
    isOut ? 'Component out of stock' : 'Component low stock',
    `${name}: ${newQty} available (reorder point: ${reorderPoint})`,
    { entityType: 'components', entityId: componentId, route: `/components/component-inventory?selected=${componentId}`, priority: isOut ? 'high' : 'medium' }
  );
}

// ─── Table primitives ────────────────────────────────────────────────────────

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

function OverviewView({ components, categories, role }: any) {
  const total = components.length;
  const lowStock = components.filter((c: any) => c.status === 'LOW_STOCK' || c.status === 'REORDER').length;
  const outOfStock = components.filter((c: any) => c.status === 'OUT_OF_STOCK').length;
  const totalValue = components.reduce((s: number, c: any) => s + (c.quantity_available ?? 0) * (c.unit_cost ?? 0), 0);

  const cards = [
    { label: 'Component Types', value: total, icon: Cpu, color: 'text-gray-600' },
    { label: 'Low / Reorder', value: lowStock, icon: AlertTriangle, color: 'text-amber-500' },
    { label: 'Out of Stock', value: outOfStock, icon: X, color: 'text-red-500' },
    ...(canEditFinance(role) ? [{ label: 'Inventory Value', value: fmt(totalValue), icon: Tag, color: 'text-[#3ECF8E]' }] : []),
  ];

  return (
    <div className="p-6 max-w-[1400px] space-y-6">
      <div>
        <h2 className="text-gray-900">Components Overview</h2>
        <p className="text-[13px] text-gray-400 mt-0.5">Value-add components that attach to inventory items and increase cost basis</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[12px] text-gray-500">{c.label}</span>
              <c.icon size={14} className={c.color} />
            </div>
            <p className="text-[22px] font-semibold text-gray-900">{c.value}</p>
          </div>
        ))}
      </div>
      {categories.length > 0 && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <p className="text-[13px] font-semibold text-gray-900 mb-4">By Category</p>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat: any) => {
              const count = components.filter((c: any) => c.category_id === cat.id).length;
              return (
                <div key={cat.id} className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[rgba(0,0,0,0.07)] bg-gray-50 text-[12px]">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cat.color ?? '#6B7280' }} />
                  <span className="text-gray-700">{cat.name}</span>
                  <span className="text-gray-400">({count})</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component Inventory ──────────────────────────────────────────────────────

function ComponentInventoryView({ components, categories, vendors, role, orgId, userId, onReload, filterProp }: any) {
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | string>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState<any>({
    name: '', category_id: '', vendor_id: '', sku: '', upc: '',
    unit_cost: '', quantity_available: '', reorder_point: '', status: 'ACTIVE', notes: '',
  });
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const [attachmentCount, setAttachmentCount] = useState<number>(0);

  const filterDefs: FilterDef[] = [
    { type: 'select', key: 'category_id', label: 'Category', options: categories.map((c: any) => ({ value: c.id, label: c.name })) },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.company_name ?? v.name ?? '' })) },
    { type: 'select', key: 'status', label: 'Status', options: COMPONENT_STATUSES.map(s => ({ value: s, label: s })) },
    { type: 'numrange', keyMin: 'cost_min', keyMax: 'cost_max', label: 'Unit Cost', prefix: '$' },
    { type: 'numrange', keyMin: 'qty_min', keyMax: 'qty_max', label: 'Qty Available' },
    { type: 'boolean', key: 'low_stock_only', label: 'Low Stock' },
    { type: 'boolean', key: 'reorder_only', label: 'Reorder Needed' },
    { type: 'boolean', key: 'out_of_stock_only', label: 'Out of Stock' },
  ];

  // Apply prop-based filter (e.g. 'low-stock' view) then user filter
  let displayed = components;
  if (filterProp === 'low-stock') {
    displayed = displayed.filter((c: any) =>
      c.status === 'LOW_STOCK' ||
      c.status === 'REORDER' ||
      (c.reorder_point != null && (c.quantity_available ?? 0) <= c.reorder_point)
    );
  }

  const filtered = displayed.filter((c: any) => {
    const v = filterValues;
    if (v.category_id && c.category_id !== v.category_id) return false;
    if (v.vendor_id && c.vendor_id !== v.vendor_id) return false;
    if (v.status && c.status !== v.status) return false;
    if (v.cost_min && Number(c.unit_cost ?? 0) < Number(v.cost_min)) return false;
    if (v.cost_max && Number(c.unit_cost ?? 0) > Number(v.cost_max)) return false;
    if (v.qty_min && Number(c.quantity_available ?? 0) < Number(v.qty_min)) return false;
    if (v.qty_max && Number(c.quantity_available ?? 0) > Number(v.qty_max)) return false;
    if (v.low_stock_only === 'true' && !['LOW_STOCK','REORDER'].includes(c.status)) return false;
    if (v.reorder_only === 'true' && Number(c.quantity_available ?? 0) > Number(c.reorder_point ?? Infinity)) return false;
    if (v.out_of_stock_only === 'true' && c.status !== 'OUT_OF_STOCK') return false;
    return true;
  });

  const [searchParams, setSearchParams] = useSearchParams();
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  const openDrawer = async (c: any) => {
    setSelected(c);
    setEditing(false);
    setDrawerError(null);
    setConfirm(null);
    // Load attachment count
    const count = await countLinked('inventory_item_components', 'component_id', c.id);
    setAttachmentCount(count);
  };
  const closeDrawer = () => {
    setSelected(null);
    setEditing(false);
    setDrawerError(null);
    setConfirm(null);
    setAttachmentCount(0);
  };

  // Watch for new selected param
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  // Handle deep-link after components load
  useEffect(() => {
    if (!pendingSelId.current || components.length === 0) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const comp = components.find((c: any) => c.id === id);
    if (comp) {
      openDrawer(comp);
    } else {
      setNotFoundMsg('Component not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [components, setSearchParams]);

  const startEdit = () => {
    setEditForm({
      name: selected.name ?? '',
      category_id: selected.category_id ?? '',
      vendor_id: selected.vendor_id ?? '',
      sku: selected.sku ?? '',
      upc: selected.upc ?? '',
      unit_cost: selected.unit_cost != null ? String(selected.unit_cost) : '',
      quantity_available: selected.quantity_available != null ? String(selected.quantity_available) : '',
      reorder_point: selected.reorder_point != null ? String(selected.reorder_point) : '',
      status: selected.status ?? 'ACTIVE',
      notes: selected.notes ?? '',
    });
    setEditing(true); setDrawerError(null);
  };

  const saveEdit = async () => {
    if (!editForm.name) { setDrawerError('Name is required.'); return; }
    setSaving(true); setDrawerError(null);
    const { error } = await updateRow('components', selected.id, {
      name: editForm.name,
      category_id: editForm.category_id || null,
      vendor_id: editForm.vendor_id || null,
      sku: editForm.sku || null,
      upc: editForm.upc || null,
      unit_cost: parseFloat(editForm.unit_cost) || null,
      quantity_available: parseInt(editForm.quantity_available) || 0,
      reorder_point: parseInt(editForm.reorder_point) || null,
      status: editForm.status,
      notes: editForm.notes || null,
    });
    setSaving(false);
    if (error) { setDrawerError(error); return; }
    await logActivity(orgId, userId, `Component "${editForm.name}" updated`, 'components', selected.id, 'update');
    void notifyComponentLowStock(orgId, selected.id, editForm.name, parseInt(editForm.quantity_available) || 0, parseInt(editForm.reorder_point) || null);

    // Reload components and keep drawer open with fresh data
    await onReload();
    const fresh = components.find((c: any) => c.id === selected.id);
    if (fresh) {
      setSelected(fresh);
      setEditing(false);
    } else {
      closeDrawer();
    }
  };

  const doDelete = async () => {
    setConfirmLoading(true);
    const linked = await countLinked('inventory_item_components', 'component_id', selected.id);
    if (linked > 0) { setDrawerError(`Cannot delete: attached to ${linked} inventory item(s).`); setConfirm(null); setConfirmLoading(false); return; }
    await deleteRow('components', selected.id);
    await logActivity(orgId, userId, `Component "${selected.name}" deleted`, 'components', selected.id, 'delete');
    setConfirmLoading(false); setConfirm(null); onReload(); closeDrawer();
  };

  const addComponent = async () => {
    if (!addForm.name) { setAddError('Name is required.'); return; }
    setAddSaving(true); setAddError(null);
    const openingQty = parseInt(addForm.quantity_available) || 0;
    const unitCost = parseFloat(addForm.unit_cost) || null;

    // Create component with quantity_available = 0
    const { data: newComp, error: compErr } = await insertRow('components', {
      organization_id: orgId,
      name: addForm.name,
      category_id: addForm.category_id || null,
      vendor_id: addForm.vendor_id || null,
      sku: addForm.sku || null,
      upc: addForm.upc || null,
      unit_cost: unitCost,
      quantity_available: 0,
      reorder_point: parseInt(addForm.reorder_point) || null,
      status: addForm.status,
      notes: addForm.notes || null,
    });
    if (compErr) { setAddSaving(false); setAddError(compErr); return; }

    // If opening quantity > 0, create PURCHASE transaction
    if (openingQty > 0 && newComp?.[0]?.id) {
      const { error: txErr } = await insertRow('component_transactions', {
        organization_id: orgId,
        component_id: newComp[0].id,
        transaction_type: 'PURCHASE',
        quantity: openingQty,
        unit_cost: unitCost,
        reference_number: null,
        notes: 'Opening quantity',
        created_by: userId ?? null,
      });
      if (txErr) { setAddSaving(false); setAddError(`Component created, but failed to record opening quantity: ${txErr}`); onReload(); return; }

      // Update quantity_available after transaction succeeds
      const { error: qtyErr } = await updateRow('components', newComp[0].id, { quantity_available: openingQty });
      if (qtyErr) { setAddSaving(false); setAddError(`Component and transaction created, but failed to update quantity: ${qtyErr}`); onReload(); return; }
    }

    await logActivity(orgId, userId, `Component "${addForm.name}" created${openingQty > 0 ? ` with opening quantity ${openingQty}` : ''}`, 'components', newComp?.[0]?.id, 'create');
    setAddSaving(false);
    setShowAdd(false);
    setAddForm({ name: '', category_id: '', vendor_id: '', sku: '', upc: '', unit_cost: '', quantity_available: '', reorder_point: '', status: 'ACTIVE', notes: '' });
    onReload();
  };

  const catById = (id: string) => categories.find((c: any) => c.id === id);
  const vendorById = (id: string) => vendors.find((v: any) => v.id === id);

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] space-y-4">
      {notFoundMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">
          {notFoundMsg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Component Inventory</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">{filtered.length} components</p>
        </div>
        {canEdit(role) && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Add Component
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)] flex items-center gap-3">
          <span className="text-[13px] font-medium text-gray-700">{filtered.length} components</span>
        </div>
        <FilterBar defs={filterDefs} values={filterValues} onChange={setFilterValues} />
        {filtered.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-gray-400">No components match the current filters.</div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-[rgba(0,0,0,0.05)]">
              {filtered.map((c: any) => (
                <div key={c.id} onClick={() => openDrawer(c)}
                  className="px-3 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{c.name}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{catById(c.category_id)?.name ?? '—'} · {c.sku ?? 'No SKU'}</p>
                    </div>
                    <StatusBadge status={c.status ?? 'ACTIVE'} />
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className={`text-[12px] font-medium ${c.quantity_available <= 0 ? 'text-red-500' : c.quantity_available <= (c.reorder_point ?? 0) ? 'text-amber-600' : 'text-gray-700'}`}>
                      {c.quantity_available ?? 0} in stock
                    </span>
                    {canEditFinance(role) && <span className="text-[11px] text-gray-400">{fmt(c.unit_cost)} / unit</span>}
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[rgba(0,0,0,0.06)] bg-gray-50">
                    <Th>Name</Th><Th>Category</Th><Th>Vendor</Th><Th>SKU</Th>
                    <Th right>Unit Cost</Th><Th right>Qty Available</Th><Th right>Reorder Pt</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c: any, i: number) => (
                    <tr
                      key={c.id}
                      onClick={() => openDrawer(c)}
                      className={`cursor-pointer hover:bg-gray-50 transition-colors ${i < filtered.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                    >
                      <Td><span className="font-medium text-gray-900">{c.name}</span></Td>
                      <Td muted>{catById(c.category_id)?.name ?? '—'}</Td>
                      <Td muted>{vendorById(c.vendor_id)?.company_name ?? vendorById(c.vendor_id)?.name ?? '—'}</Td>
                      <Td muted>{c.sku ?? '—'}</Td>
                      <Td right>{canEditFinance(role) ? fmt(c.unit_cost) : '—'}</Td>
                      <Td right>
                        <span className={c.quantity_available <= 0 ? 'text-red-500 font-medium' : c.quantity_available <= (c.reorder_point ?? 0) ? 'text-amber-600 font-medium' : 'text-gray-700'}>
                          {c.quantity_available ?? 0}
                        </span>
                      </Td>
                      <Td right muted>{c.reorder_point ?? '—'}</Td>
                      <Td><StatusBadge status={c.status ?? 'ACTIVE'} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Detail Drawer */}
      {selected && (
        <>
          <Drawer
            open
            onClose={closeDrawer}
            title={selected.name}
            subtitle={catById(selected.category_id)?.name}
            footer={
              !editing ? (
                <div className="flex flex-wrap gap-2">
                  {canEdit(role) && <button onClick={startEdit} className="px-3 py-1.5 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg">Edit</button>}
                  {isAdmin(role) && <button onClick={() => setConfirm('delete')} className="ml-auto px-3 py-1.5 text-[13px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete</button>}
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => { setEditing(false); setDrawerError(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60 ml-auto">
                    {saving && <Loader2 size={12} className="animate-spin" />}Save
                  </button>
                </div>
              )
            }
          >
            {!editing ? (
              <div className="space-y-0">
                <DetailRow label="Name" value={selected.name} />
                <DetailRow label="Category" value={catById(selected.category_id)?.name} />
                <DetailRow label="Vendor" value={vendorById(selected.vendor_id)?.company_name ?? vendorById(selected.vendor_id)?.name} />
                <DetailRow label="SKU" value={selected.sku} />
                <DetailRow label="UPC" value={selected.upc} />
                {canEditFinance(role) && <DetailRow label="Unit Cost" value={fmt(selected.unit_cost)} />}
                <DetailRow label="Qty Available" value={selected.quantity_available} />
                <DetailRow label="Reorder Point" value={selected.reorder_point} />
                <DetailRow label="Status" value={<StatusBadge status={selected.status ?? 'ACTIVE'} />} />
                <DetailRow label="Notes" value={selected.notes} />
                <DetailRow label="Attached to Inventory" value={attachmentCount > 0 ? `${attachmentCount} item${attachmentCount === 1 ? '' : 's'}` : 'Not attached'} />
                {drawerError && <p className="text-[12px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">{drawerError}</p>}
              </div>
            ) : (
              <div className="space-y-4">
                {drawerError && <p className="text-[12px] text-red-500 bg-red-50 rounded-lg px-3 py-2">{drawerError}</p>}
                <FormField label="Name" required>
                  <input className={inputCls} value={editForm.name} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} />
                </FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Category">
                    <select className={selectCls} value={editForm.category_id} onChange={e => setEditForm((f: any) => ({ ...f, category_id: e.target.value }))}>
                      <option value="">— none —</option>
                      {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Vendor">
                    <select className={selectCls} value={editForm.vendor_id} onChange={e => setEditForm((f: any) => ({ ...f, vendor_id: e.target.value }))}>
                      <option value="">— none —</option>
                      {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.company_name ?? v.name}</option>)}
                    </select>
                  </FormField>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="SKU"><input className={inputCls} value={editForm.sku} onChange={e => setEditForm((f: any) => ({ ...f, sku: e.target.value }))} /></FormField>
                  <FormField label="UPC"><input className={inputCls} value={editForm.upc} onChange={e => setEditForm((f: any) => ({ ...f, upc: e.target.value }))} /></FormField>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="Unit Cost ($)">{canEditFinance(role) && <input type="number" className={inputCls} value={editForm.unit_cost} onChange={e => setEditForm((f: any) => ({ ...f, unit_cost: e.target.value }))} min="0" step="0.01" />}</FormField>
                  <FormField label="Manual Quantity Count" help="Use Component Transactions for purchases, returns, transfers, and adjustments."><input type="number" className={inputCls} value={editForm.quantity_available} onChange={e => setEditForm((f: any) => ({ ...f, quantity_available: e.target.value }))} min="0" /></FormField>
                  <FormField label="Reorder Point"><input type="number" className={inputCls} value={editForm.reorder_point} onChange={e => setEditForm((f: any) => ({ ...f, reorder_point: e.target.value }))} min="0" /></FormField>
                </div>
                <FormField label="Status">
                  <select className={selectCls} value={editForm.status} onChange={e => setEditForm((f: any) => ({ ...f, status: e.target.value }))}>
                    {COMPONENT_STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </FormField>
                <FormField label="Notes">
                  <textarea className={textareaCls} rows={2} value={editForm.notes} onChange={e => setEditForm((f: any) => ({ ...f, notes: e.target.value }))} />
                </FormField>
              </div>
            )}
          </Drawer>
          <ConfirmDialog
            open={confirm === 'delete'}
            title="Delete Component"
            description={`Permanently delete "${selected.name}"? This cannot be undone.`}
            confirmLabel="Delete"
            danger
            onConfirm={doDelete}
            onCancel={() => setConfirm(null)}
            loading={confirmLoading}
          />
        </>
      )}

      {/* Add Modal */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setAddError(null); }} title="Add Component"
        footer={<>
          <button onClick={() => { setShowAdd(false); setAddError(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={addComponent} disabled={addSaving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
            {addSaving && <Loader2 size={12} className="animate-spin" />}Add Component
          </button>
        </>}
      >
        <div className="space-y-4">
          {addError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{addError}</p>}
          <FormField label="Name" required>
            <input className={inputCls} value={addForm.name} onChange={e => setAddForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="Windows 11 Pro License" />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Category">
              <select className={selectCls} value={addForm.category_id} onChange={e => setAddForm((f: any) => ({ ...f, category_id: e.target.value }))}>
                <option value="">— none —</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Vendor">
              <select className={selectCls} value={addForm.vendor_id} onChange={e => setAddForm((f: any) => ({ ...f, vendor_id: e.target.value }))}>
                <option value="">— none —</option>
                {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.company_name ?? v.name}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="SKU"><input className={inputCls} value={addForm.sku} onChange={e => setAddForm((f: any) => ({ ...f, sku: e.target.value }))} placeholder="OEM-WIN11P" /></FormField>
            <FormField label="UPC"><input className={inputCls} value={addForm.upc} onChange={e => setAddForm((f: any) => ({ ...f, upc: e.target.value }))} placeholder="0123456789" /></FormField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <FormField label="Unit Cost ($)"><input type="number" className={inputCls} value={addForm.unit_cost} onChange={e => setAddForm((f: any) => ({ ...f, unit_cost: e.target.value }))} placeholder="0.00" min="0" step="0.01" /></FormField>
            <FormField label="Opening / Manual Qty" help="Use Component Transactions for purchases, adjustments, returns, and transfers."><input type="number" className={inputCls} value={addForm.quantity_available} onChange={e => setAddForm((f: any) => ({ ...f, quantity_available: e.target.value }))} placeholder="0" min="0" /></FormField>
            <FormField label="Reorder Point"><input type="number" className={inputCls} value={addForm.reorder_point} onChange={e => setAddForm((f: any) => ({ ...f, reorder_point: e.target.value }))} placeholder="5" min="0" /></FormField>
          </div>
          <FormField label="Status">
            <select className={selectCls} value={addForm.status} onChange={e => setAddForm((f: any) => ({ ...f, status: e.target.value }))}>
              {COMPONENT_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Notes">
            <textarea className={textareaCls} rows={2} value={addForm.notes} onChange={e => setAddForm((f: any) => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

// ─── Transactions ─────────────────────────────────────────────────────────────

function TransactionsView({ orgId, userId, components, role }: any) {
  const { data: txns, loading, error, reload } = useOrgQuery<any>('component_transactions', orgId, {
    select: 'id, component_id, transaction_type, quantity, unit_cost, reference_number, notes, created_at, components(name)',
    filter: (q: any) => q.order('created_at', { ascending: false }).limit(200),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ component_id: '', transaction_type: 'PURCHASE', quantity: '', unit_cost: '', reference_number: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const addTx = async () => {
    if (!form.component_id || !form.quantity) { setAddError('Component and quantity are required.'); return; }
    setSaving(true); setAddError(null);
    const comp = components.find((c: any) => c.id === form.component_id);
    const currentQty = comp?.quantity_available ?? 0;
    const unitCost = parseFloat(form.unit_cost) || null;

    let delta: number;
    let qty: number;

    if (form.transaction_type === 'ADJUSTMENT') {
      // ADJUSTMENT allows positive or negative values
      delta = parseInt(form.quantity) || 0;
      qty = Math.abs(delta);
    } else {
      // Other transaction types: quantity is always positive, direction is inferred from type
      qty = Math.abs(parseInt(form.quantity) || 0);
      const isIncoming = form.transaction_type === 'PURCHASE' || form.transaction_type === 'RETURN';
      delta = isIncoming ? qty : -qty;

      // Guard outgoing transactions against negative inventory
      if (!isIncoming && qty > currentQty) {
        setAddError(`Insufficient quantity: ${currentQty} available, ${qty} requested.`);
        setSaving(false); return;
      }
    }

    const newQty = Math.max(0, currentQty + delta);

    // Insert transaction record first — if it fails, quantity is never touched
    const { error: txErr } = await insertRow('component_transactions', {
      organization_id: orgId,
      component_id: form.component_id,
      transaction_type: form.transaction_type,
      quantity: qty,
      unit_cost: unitCost,
      reference_number: form.reference_number || null,
      notes: form.notes || null,
      created_by: userId ?? null,
    });
    if (txErr) { setAddError(txErr); setSaving(false); return; }

    // Only update quantity after transaction insert succeeds
    const compUpdate: Record<string, any> = { quantity_available: newQty };
    if (form.transaction_type === 'PURCHASE' && unitCost) compUpdate.unit_cost = unitCost;
    const { error: compErr } = await updateRow('components', form.component_id, compUpdate);
    if (compErr) { setAddError(compErr); setSaving(false); return; }

    void notifyComponentLowStock(orgId, form.component_id, comp?.name ?? '', newQty, comp?.reorder_point ?? null);
    await logActivity(orgId, userId, `Component transaction: ${form.transaction_type} ${qty}x ${comp?.name ?? ''}`, 'component_transactions', undefined, 'create');
    setSaving(false); setShowAdd(false); reload();
    setForm({ component_id: '', transaction_type: 'PURCHASE', quantity: '', unit_cost: '', reference_number: '', notes: '' });
  };

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Component Transactions</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Purchases, adjustments, and transfers</p>
        </div>
        {canEdit(role) && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Add Transaction
          </button>
        )}
      </div>

      {loading ? <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-8 text-center text-[13px] text-gray-400">Loading…</div>
        : error ? <ErrorState message={error} onRetry={reload} />
        : txns.length === 0 ? <EmptyState title="No transactions" description="Record component purchases and adjustments." />
        : (
        <Table>
          <thead>
            <tr className="border-b border-[rgba(0,0,0,0.06)] bg-gray-50">
              <Th>Component</Th><Th>Type</Th><Th right>Qty</Th>
              {canEditFinance(role) && <Th right>Unit Cost</Th>}
              <Th>Reference</Th><Th>Notes</Th><Th>Date</Th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t: any, i: number) => (
              <tr key={t.id} className={`${i < txns.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                <Td><span className="font-medium">{t.components?.name ?? '—'}</span></Td>
                <Td><StatusBadge status={t.transaction_type} /></Td>
                <Td right>{t.quantity}</Td>
                {canEditFinance(role) && <Td right muted>{fmt(t.unit_cost)}</Td>}
                <Td muted>{t.reference_number ?? '—'}</Td>
                <Td muted>{t.notes ?? '—'}</Td>
                <Td muted>{t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setAddError(null); }} title="Add Transaction"
        footer={<>
          <button onClick={() => { setShowAdd(false); setAddError(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={addTx} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
            {saving && <Loader2 size={12} className="animate-spin" />}Save
          </button>
        </>}
      >
        <div className="space-y-4">
          {addError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{addError}</p>}
          <FormField label="Component" required>
            <select className={selectCls} value={form.component_id} onChange={e => set('component_id', e.target.value)}>
              <option value="">— select component —</option>
              {components.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Type">
              <select className={selectCls} value={form.transaction_type} onChange={e => set('transaction_type', e.target.value)}>
                {TX_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormField>
            <FormField label="Quantity" required help={form.transaction_type === 'ADJUSTMENT' ? 'Positive increases, negative decreases' : undefined}>
              <input type="number" className={inputCls} value={form.quantity} onChange={e => set('quantity', e.target.value)} min={form.transaction_type === 'ADJUSTMENT' ? undefined : "1"} placeholder="0" />
            </FormField>
          </div>
          {canEditFinance(role) && (
            <FormField label="Unit Cost ($)">
              <input type="number" className={inputCls} value={form.unit_cost} onChange={e => set('unit_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" />
            </FormField>
          )}
          <FormField label="Reference #">
            <input className={inputCls} value={form.reference_number} onChange={e => set('reference_number', e.target.value)} placeholder="INV-001" />
          </FormField>
          <FormField label="Notes">
            <textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

// ─── Bundles ─────────────────────────────────────────────────────────────────

function BundlesView({ orgId, userId, components, categories, role }: any) {
  const { data: bundles, loading, error, reload } = useOrgQuery<any>('bundle_templates', orgId, {
    select: 'id, name, description, created_at',
  });
  // bundle_template_components has no organization_id — scope through bundle_templates
  const [bundleItems, setBundleItems] = useState<any[]>([]);
  const reloadItems = useCallback(async () => {
    if (!bundles.length) { setBundleItems([]); return; }
    const { data } = await supabase
      .from('bundle_template_components')
      .select('id, bundle_template_id, component_id, quantity, components(name, unit_cost)')
      .in('bundle_template_id', bundles.map((b: any) => b.id));
    setBundleItems(data ?? []);
  }, [bundles]);
  useEffect(() => { reloadItems(); }, [reloadItems]);

  const [selected, setSelected] = useState<any>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [editingItems, setEditingItems] = useState<{ component_id: string; quantity: string }[]>([]);
  const [editingBundle, setEditingBundle] = useState(false);
  const [bundleForm, setBundleForm] = useState({ name: '', description: '' });
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | string>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const itemsFor = (bundleId: string) => bundleItems.filter((b: any) => b.bundle_template_id === bundleId);

  const openBundle = (b: any) => {
    setSelected(b);
    setEditingItems(itemsFor(b.id).map((bi: any) => ({ component_id: bi.component_id, quantity: String(bi.quantity) })));
    setBundleForm({ name: b.name, description: b.description ?? '' });
    setEditingBundle(false);
    setBundleError(null);
  };

  const addBundle = async () => {
    if (!form.name) { setAddError('Name is required.'); return; }
    setSaving(true); setAddError(null);
    await insertRow('bundle_templates', { organization_id: orgId, name: form.name, description: form.description || null });
    setSaving(false); setShowAdd(false);
    setForm({ name: '', description: '' });
    reload();
  };

  const saveBundleInfo = async () => {
    if (!selected || !bundleForm.name) {
      setBundleError('Bundle name is required.');
      return;
    }
    setSaving(true);
    setBundleError(null);
    const { error } = await updateRow('bundle_templates', selected.id, {
      name: bundleForm.name,
      description: bundleForm.description || null,
    });
    if (error) {
      setBundleError(error);
      setSaving(false);
      return;
    }
    await logActivity(orgId, userId, `Bundle "${bundleForm.name}" info updated`, 'bundle_templates', selected.id, 'update');
    setSaving(false);
    setEditingBundle(false);
    reload();
    // Refresh selected with new data
    const fresh = bundles.find((b: any) => b.id === selected.id);
    if (fresh) setSelected(fresh);
  };

  const saveItems = async () => {
    if (!selected) return;
    setSaving(true);
    setBundleError(null);

    // Delete existing items
    const existing = itemsFor(selected.id);
    for (const ex of existing) {
      const { error: delErr } = await deleteRow('bundle_template_components', ex.id);
      if (delErr) {
        setBundleError(`Failed to delete existing bundle items: ${delErr}`);
        setSaving(false);
        return;
      }
    }

    // Insert new items
    for (const item of editingItems) {
      if (!item.component_id || !item.quantity) continue;
      const { error: insertErr } = await insertRow('bundle_template_components', {
        bundle_template_id: selected.id,
        component_id: item.component_id,
        quantity: parseInt(item.quantity) || 1,
      });
      if (insertErr) {
        setBundleError(`Failed to save bundle items: ${insertErr}`);
        setSaving(false);
        return;
      }
    }

    await logActivity(orgId, userId, `Bundle "${selected.name}" items updated`, 'bundle_templates', selected.id, 'update');
    setSaving(false);
    reloadItems();
  };

  const doDeleteBundle = async () => {
    setConfirmLoading(true);
    setBundleError(null);

    // Delete child rows first
    const items = itemsFor(selected.id);
    for (const item of items) {
      const { error: delErr } = await deleteRow('bundle_template_components', item.id);
      if (delErr) {
        setBundleError(`Failed to delete bundle items: ${delErr}`);
        setConfirmLoading(false);
        setConfirm(null);
        return;
      }
    }

    // Delete bundle template after child rows are removed
    const { error: bundleErr } = await deleteRow('bundle_templates', selected.id);
    if (bundleErr) {
      setBundleError(`Failed to delete bundle: ${bundleErr}`);
      setConfirmLoading(false);
      setConfirm(null);
      return;
    }

    await logActivity(orgId, userId, `Bundle "${selected.name}" deleted`, 'bundle_templates', selected.id, 'delete');
    setConfirmLoading(false);
    setConfirm(null);
    setSelected(null);
    reload();
    reloadItems();
  };

  const bundleTotalCost = (bundleId: string) =>
    itemsFor(bundleId).reduce((s: number, bi: any) => s + (bi.quantity ?? 1) * (bi.components?.unit_cost ?? 0), 0);

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Bundle Templates</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Predefined component sets applied together to inventory items</p>
        </div>
        {canEdit(role) && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />New Bundle
          </button>
        )}
      </div>

      {loading ? <div className="py-12 text-center text-[13px] text-gray-400">Loading…</div>
        : error ? <ErrorState message={error} onRetry={reload} />
        : bundles.length === 0 ? <EmptyState title="No bundles" description="Create bundle templates to quickly attach component sets to inventory items." action={{ label: 'New Bundle', onClick: () => setShowAdd(true) }} />
        : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {bundles.map((b: any) => {
            const items = itemsFor(b.id);
            const total = bundleTotalCost(b.id);
            return (
              <div key={b.id} onClick={() => openBundle(b)}
                className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5 cursor-pointer hover:shadow-sm hover:border-[rgba(0,0,0,0.12)] transition-all">
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[14px] font-semibold text-gray-900">{b.name}</p>
                  <Layers size={13} className="text-gray-400 flex-shrink-0 mt-0.5" />
                </div>
                {b.description && <p className="text-[12px] text-gray-500 mb-3">{b.description}</p>}
                <div className="space-y-1 mb-3">
                  {items.slice(0, 4).map((bi: any) => (
                    <div key={bi.id} className="flex items-center justify-between text-[12px]">
                      <span className="text-gray-600">{bi.components?.name ?? '—'}</span>
                      <span className="text-gray-400">×{bi.quantity}</span>
                    </div>
                  ))}
                  {items.length > 4 && <p className="text-[11px] text-gray-400">+{items.length - 4} more</p>}
                  {items.length === 0 && <p className="text-[12px] text-gray-400 italic">No components yet</p>}
                </div>
                {canEditFinance(role) && total > 0 && (
                  <div className="border-t border-[rgba(0,0,0,0.06)] pt-2 text-[12px] text-gray-500 flex justify-between">
                    <span>Total cost</span><span className="font-medium text-gray-700">{fmt(total)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Bundle Detail Drawer */}
      {selected && (
        <>
          <Drawer
            open
            onClose={() => { setSelected(null); setEditingItems([]); setEditingBundle(false); setBundleError(null); }}
            title={selected.name}
            subtitle={selected.description ?? 'Bundle Template'}
            footer={
              <div className="flex items-center gap-2">
                {editingBundle ? (
                  <>
                    <button onClick={() => { setEditingBundle(false); setBundleError(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
                    <button onClick={saveBundleInfo} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
                      {saving && <Loader2 size={12} className="animate-spin" />}Save Info
                    </button>
                  </>
                ) : (
                  <>
                    {canEdit(role) && (
                      <button onClick={() => setEditingBundle(true)} className="px-3 py-1.5 text-[13px] text-gray-700 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Edit Info</button>
                    )}
                    <button onClick={saveItems} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
                      {saving && <Loader2 size={12} className="animate-spin" />}Save Items
                    </button>
                    {isAdmin(role) && (
                      <button onClick={() => setConfirm('delete')} className="ml-auto px-3 py-1.5 text-[13px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete Bundle</button>
                    )}
                  </>
                )}
              </div>
            }
          >
            <div className="space-y-4">
              {bundleError && <p className="text-[12px] text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{bundleError}</p>}
              {editingBundle ? (
                <>
                  <FormField label="Bundle Name" required>
                    <input className={inputCls} value={bundleForm.name} onChange={e => setBundleForm(f => ({ ...f, name: e.target.value }))} />
                  </FormField>
                  <FormField label="Description">
                    <textarea className={textareaCls} rows={2} value={bundleForm.description} onChange={e => setBundleForm(f => ({ ...f, description: e.target.value }))} />
                  </FormField>
                </>
              ) : null}
              <p className="text-[12px] font-medium text-gray-500 uppercase tracking-wide">Components</p>
              {editingItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    className={`${selectCls} flex-1`}
                    value={item.component_id}
                    onChange={e => {
                      const next = [...editingItems];
                      next[idx] = { ...next[idx], component_id: e.target.value };
                      setEditingItems(next);
                    }}
                  >
                    <option value="">— select component —</option>
                    {components.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input
                    type="number"
                    className={`${inputCls} w-16`}
                    placeholder="Qty"
                    value={item.quantity}
                    min="1"
                    onChange={e => {
                      const next = [...editingItems];
                      next[idx] = { ...next[idx], quantity: e.target.value };
                      setEditingItems(next);
                    }}
                  />
                  <button onClick={() => setEditingItems(prev => prev.filter((_, i) => i !== idx))} className="p-1 text-gray-400 hover:text-red-500">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button
                onClick={() => setEditingItems(prev => [...prev, { component_id: '', quantity: '1' }])}
                className="flex items-center gap-1.5 text-[12px] text-[#3ECF8E] hover:text-[#38c484] font-medium"
              >
                <Plus size={12} />Add Component
              </button>
              {canEditFinance(role) && editingItems.length > 0 && (
                <div className="border-t border-[rgba(0,0,0,0.06)] pt-3">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-gray-500">Estimated Bundle Cost</span>
                    <span className="font-medium text-gray-800">
                      {fmt(editingItems.reduce((s, item) => {
                        const comp = components.find((c: any) => c.id === item.component_id);
                        return s + (parseInt(item.quantity) || 1) * (comp?.unit_cost ?? 0);
                      }, 0))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </Drawer>
          <ConfirmDialog
            open={confirm === 'delete'}
            title="Delete Bundle"
            description={`Permanently delete "${selected.name}"?`}
            confirmLabel="Delete"
            danger
            onConfirm={doDeleteBundle}
            onCancel={() => setConfirm(null)}
            loading={confirmLoading}
          />
        </>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setAddError(null); }} title="New Bundle Template"
        footer={<>
          <button onClick={() => { setShowAdd(false); setAddError(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={addBundle} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
            {saving && <Loader2 size={12} className="animate-spin" />}Create
          </button>
        </>}
      >
        <div className="space-y-4">
          {addError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{addError}</p>}
          <FormField label="Bundle Name" required>
            <input className={inputCls} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Business Ready Laptop" />
          </FormField>
          <FormField label="Description">
            <textarea className={textareaCls} rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Windows license + keyboard/mouse combo..." />
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

// ─── Categories ───────────────────────────────────────────────────────────────

function CategoriesView({ orgId, userId, categories, role, onReload }: any) {
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', description: '', color: '#6B7280' });
  const [addSaving, setAddSaving] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);

  const addCategory = async () => {
    if (!addForm.name) { setAddErr('Name is required.'); return; }
    // Check for duplicate name
    const duplicate = categories.find((c: any) => c.name.toLowerCase() === addForm.name.toLowerCase());
    if (duplicate) {
      setAddErr('A category with this name already exists.');
      return;
    }
    setAddSaving(true); setAddErr(null);
    const { error: insertErr } = await insertRow('component_categories', { organization_id: orgId, name: addForm.name, description: addForm.description || null, color: addForm.color });
    if (insertErr) {
      setAddErr(insertErr);
      setAddSaving(false);
      return;
    }
    setAddSaving(false); setShowAdd(false);
    setAddForm({ name: '', description: '', color: '#6B7280' });
    onReload();
  };

  const saveEdit = async () => {
    if (!editForm.name) { setErr('Name is required.'); return; }
    // Check for duplicate name (excluding current category)
    const duplicate = categories.find((c: any) => c.id !== selected.id && c.name.toLowerCase() === editForm.name.toLowerCase());
    if (duplicate) {
      setErr('A category with this name already exists.');
      return;
    }
    setSaving(true); setErr(null);
    const { error: updateErr } = await updateRow('component_categories', selected.id, { name: editForm.name, description: editForm.description || null, color: editForm.color });
    if (updateErr) {
      setErr(updateErr);
      setSaving(false);
      return;
    }
    await onReload();
    // Keep drawer open with refreshed category
    const fresh = categories.find((c: any) => c.id === selected.id);
    if (fresh) {
      setSelected(fresh);
      setEditing(false);
    } else {
      setSelected(null);
      setEditing(false);
    }
    setSaving(false);
  };

  const doDelete = async () => {
    setConfirmLoading(true);
    const linked = await countLinked('components', 'category_id', selected.id);
    if (linked > 0) { setErr(`Cannot delete: ${linked} component(s) use this category.`); setConfirm(false); setConfirmLoading(false); return; }
    await deleteRow('component_categories', selected.id);
    setConfirmLoading(false); setConfirm(false); setSelected(null); onReload();
  };

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Component Categories</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Organize components by type</p>
        </div>
        {canEdit(role) && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Add Category
          </button>
        )}
      </div>

      {categories.length === 0 ? (
        <EmptyState title="No categories" description="Create categories to organize your components." action={{ label: 'Add Category', onClick: () => setShowAdd(true) }} />
      ) : (
        <Table>
          <thead>
            <tr className="border-b border-[rgba(0,0,0,0.06)] bg-gray-50">
              <Th>Name</Th><Th>Description</Th><Th>Color</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat: any, i: number) => (
              <tr key={cat.id} className={`${i < categories.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                <Td>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cat.color ?? '#6B7280' }} />
                    <span className="font-medium text-gray-900">{cat.name}</span>
                  </div>
                </Td>
                <Td muted>{cat.description ?? '—'}</Td>
                <Td muted>{cat.color ?? '—'}</Td>
                <Td>
                  {canEdit(role) && (
                    <button onClick={() => { setSelected(cat); setEditForm({ name: cat.name, description: cat.description ?? '', color: cat.color ?? '#6B7280' }); setEditing(true); setErr(null); }}
                      className="p-1 text-gray-400 hover:text-gray-600"><Edit2 size={13} /></button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {selected && editing && (
        <>
          <Drawer open onClose={() => { setSelected(null); setEditing(false); setErr(null); }}
            title="Edit Category"
            footer={
              <div className="flex gap-2">
                <button onClick={() => { setSelected(null); setEditing(false); setErr(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
                <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60 ml-auto">
                  {saving && <Loader2 size={12} className="animate-spin" />}Save
                </button>
                {isAdmin(role) && <button onClick={() => setConfirm(true)} className="px-3 py-1.5 text-[13px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete</button>}
              </div>
            }
          >
            <div className="space-y-4">
              {err && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{err}</p>}
              <FormField label="Name" required>
                <input className={inputCls} value={editForm.name} onChange={e => setEditForm((f: any) => ({ ...f, name: e.target.value }))} />
              </FormField>
              <FormField label="Description">
                <textarea className={textareaCls} rows={2} value={editForm.description} onChange={e => setEditForm((f: any) => ({ ...f, description: e.target.value }))} />
              </FormField>
              <FormField label="Color">
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_COLORS.map(color => (
                    <button key={color} onClick={() => setEditForm((f: any) => ({ ...f, color }))}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${editForm.color === color ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                      style={{ background: color }} />
                  ))}
                </div>
              </FormField>
            </div>
          </Drawer>
          <ConfirmDialog open={confirm} title="Delete Category" description={`Delete "${selected?.name}"?`}
            confirmLabel="Delete" danger onConfirm={doDelete} onCancel={() => setConfirm(false)} loading={confirmLoading} />
        </>
      )}

      <Modal open={showAdd} onClose={() => { setShowAdd(false); setAddErr(null); }} title="Add Category"
        footer={<>
          <button onClick={() => { setShowAdd(false); setAddErr(null); }} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={addCategory} disabled={addSaving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
            {addSaving && <Loader2 size={12} className="animate-spin" />}Add
          </button>
        </>}
      >
        <div className="space-y-4">
          {addErr && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{addErr}</p>}
          <FormField label="Name" required>
            <input className={inputCls} value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="Software Licenses" />
          </FormField>
          <FormField label="Description">
            <textarea className={textareaCls} rows={2} value={addForm.description} onChange={e => setAddForm(f => ({ ...f, description: e.target.value }))} />
          </FormField>
          <FormField label="Color">
            <div className="flex flex-wrap gap-2 mt-1">
              {CATEGORY_COLORS.map(color => (
                <button key={color} onClick={() => setAddForm(f => ({ ...f, color }))}
                  className={`w-6 h-6 rounded-full border-2 transition-all ${addForm.color === color ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ background: color }} />
              ))}
            </div>
          </FormField>
        </div>
      </Modal>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Components() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();

  const { data: components, loading, error, reload } = useOrgQuery<any>('components', orgId, {
    select: 'id, name, category_id, vendor_id, sku, upc, unit_cost, quantity_available, reorder_point, status, notes, created_at',
  });

  const { data: categories, reload: reloadCats } = useOrgQuery<any>('component_categories', orgId, {
    select: 'id, name, description, color',
  });

  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name, company_name' });

  const reloadAll = () => { reload(); reloadCats(); };

  if (view === 'overview') {
    return <OverviewView components={components} categories={categories} role={role} />;
  }
  if (view === 'component-inventory') {
    return <ComponentInventoryView components={components} categories={categories} vendors={vendors} role={role} orgId={orgId} userId={user?.id} onReload={reload} filterProp={null} />;
  }
  if (view === 'low-stock') {
    return <ComponentInventoryView components={components} categories={categories} vendors={vendors} role={role} orgId={orgId} userId={user?.id} onReload={reload} filterProp="low-stock" />;
  }
  if (view === 'transactions') {
    return <TransactionsView orgId={orgId} userId={user?.id} components={components} role={role} />;
  }
  if (view === 'bundles') {
    return <BundlesView orgId={orgId} userId={user?.id} components={components} categories={categories} role={role} />;
  }
  if (view === 'categories') {
    return <CategoriesView orgId={orgId} userId={user?.id} categories={categories} role={role} onReload={reloadCats} />;
  }
  return <OverviewView components={components} categories={categories} role={role} />;
}
