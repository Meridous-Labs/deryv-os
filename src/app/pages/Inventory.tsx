import { useState, useRef, useCallback, useEffect } from 'react';
import { Search, Grid3X3, List, Plus, Loader2, MapPin, Tag, Printer, Copy, Check, X, ScanLine } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity } from '../../lib/hooks';
import { supabase } from '../../lib/supabase';
import { canEdit, canEditOps, isAdmin } from '../../lib/permissions';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DetailRow, EmptyState, ErrorState, Modal, FormField, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { InventoryLabel } from '../components/InventoryLabel';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

const INV_STATUSES = ['UNPROCESSED', 'TESTING', 'PHOTOGRAPHY', 'LISTING', 'ACTIVE', 'PICKED', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'SCRAPPED', 'DAMAGED'];
const GRADES = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'F'];

const INV_SELECT = 'id, inventory_id, sku, upc, serial_number, product_title, brand, category, model, condition, grade, status, msrp, current_asking_price, weighted_acquisition_cost, component_cost, supply_cost, shipping_cost, marketplace_fees, warehouse_location_id, lot_id, notes, created_at, barcode_value, label_generated_at, weight_oz, length_in, width_in, height_in, warehouse_locations(location_code, zone, rack, shelf, bin), lots(lot_id)';

const STATUS_TO_VIEW: Record<string, string> = {
  unprocessed: 'UNPROCESSED', testing: 'TESTING', photography: 'PHOTOGRAPHY',
  listing: 'LISTING', active: 'ACTIVE', picked: 'PICKED', packed: 'PACKED',
  shipped: 'SHIPPED', delivered: 'DELIVERED', returned: 'RETURNED', scrapped: 'SCRAPPED',
};

function locationLabel(loc: any): string {
  if (!loc) return '—';
  return loc.location_code ?? ([loc.zone, loc.rack, loc.shelf, loc.bin].filter(Boolean).join('-') || '—');
}

function lotLabel(item: any): string {
  const humanId = item.lots?.lot_id;
  if (humanId) return `#${humanId.toUpperCase()}`;
  if (item.lot_id) return `#${item.lot_id.slice(0, 8).toUpperCase()}`;
  return '—';
}

function qrUrlFor(item: any): string {
  return `${window.location.origin}/inventory/all?selected=${item.id}`;
}

function AddInventoryModal({ open, onClose, orgId, userId, lots, locations, onCreated }: any) {
  const [form, setForm] = useState({
    product_title: '', sku: '', upc: '', serial_number: '', brand: '', model: '', category: '',
    condition: '', grade: 'B', current_asking_price: '', weighted_acquisition_cost: '',
    status: 'UNPROCESSED', lot_id: '', warehouse_location_id: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const reset = () => setForm({
    product_title: '', sku: '', upc: '', serial_number: '', brand: '', model: '', category: '',
    condition: '', grade: 'B', current_asking_price: '', weighted_acquisition_cost: '',
    status: 'UNPROCESSED', lot_id: '', warehouse_location_id: '', notes: '',
  });

  const save = async () => {
    if (!form.product_title) { setError('Title is required.'); return; }
    if (!form.lot_id) { setError('A LOT is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('inventory_items', {
      organization_id: orgId,
      product_title: form.product_title,
      sku: form.sku || null,
      upc: form.upc || null,
      serial_number: form.serial_number || null,
      brand: form.brand || null,
      model: form.model || null,
      category: form.category || null,
      condition: form.condition || null,
      grade: form.grade || null,
      current_asking_price: parseFloat(form.current_asking_price) || 0,
      weighted_acquisition_cost: parseFloat(form.weighted_acquisition_cost) || 0,
      status: form.status,
      lot_id: form.lot_id || null,
      warehouse_location_id: form.warehouse_location_id || null,
      notes: form.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Inventory item "${form.product_title}" added`, 'inventory_items');
    setSaving(false); onCreated(); onClose(); reset();
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Inventory Item" width="max-w-2xl"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Add Item
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Product Title" required>
          <input className={inputCls} value={form.product_title} onChange={e => set('product_title', e.target.value)} placeholder="Apple iPhone 15 Pro 128GB" />
        </FormField>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="SKU"><input className={inputCls} value={form.sku} onChange={e => set('sku', e.target.value)} placeholder="SKU-001" /></FormField>
          <FormField label="UPC"><input className={inputCls} value={form.upc} onChange={e => set('upc', e.target.value)} placeholder="012345678901" /></FormField>
          <FormField label="Serial Number"><input className={inputCls} value={form.serial_number} onChange={e => set('serial_number', e.target.value)} placeholder="SN123456" /></FormField>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Brand"><input className={inputCls} value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="Apple" /></FormField>
          <FormField label="Model"><input className={inputCls} value={form.model} onChange={e => set('model', e.target.value)} placeholder="iPhone 15 Pro" /></FormField>
          <FormField label="Category"><input className={inputCls} value={form.category} onChange={e => set('category', e.target.value)} placeholder="Smartphones" /></FormField>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <FormField label="Grade">
            <select className={selectCls} value={form.grade} onChange={e => set('grade', e.target.value)}>
              {GRADES.map(g => <option key={g}>{g}</option>)}
            </select>
          </FormField>
          <FormField label="Status">
            <select className={selectCls} value={form.status} onChange={e => set('status', e.target.value)}>
              {INV_STATUSES.map(s => <option key={s}>{s}</option>)}
            </select>
          </FormField>
          <FormField label="Asking Price ($)">
            <input type="number" className={inputCls} value={form.current_asking_price} onChange={e => set('current_asking_price', e.target.value)} placeholder="0.00" min="0" step="0.01" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Acquisition Cost ($)">
            <input type="number" className={inputCls} value={form.weighted_acquisition_cost} onChange={e => set('weighted_acquisition_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="LOT" required>
            <select className={selectCls} value={form.lot_id} onChange={e => set('lot_id', e.target.value)}>
              <option value="">— Select LOT —</option>
              {(lots ?? []).map((l: any) => <option key={l.id} value={l.id}>#{l.lot_id ? l.lot_id.toUpperCase() : l.id.slice(0, 8).toUpperCase()}</option>)}
            </select>
          </FormField>
          <FormField label="Location">
            <select className={selectCls} value={form.warehouse_location_id} onChange={e => set('warehouse_location_id', e.target.value)}>
              <option value="">— No location —</option>
              {(locations ?? []).map((l: any) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
            </select>
          </FormField>
        </div>
        <FormField label="Condition Description">
          <textarea className={textareaCls} rows={2} value={form.condition} onChange={e => set('condition', e.target.value)} placeholder="Describe the physical condition..." />
        </FormField>
        <FormField label="Notes">
          <textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes..." />
        </FormField>
      </div>
    </Modal>
  );
}

const conditionColor = (grade: string) => {
  if (!grade) return 'bg-gray-100 text-gray-500';
  if (grade.startsWith('A')) return 'bg-[#ECFDF5] text-[#15803d]';
  if (grade.startsWith('B')) return 'bg-gray-100 text-gray-600';
  return 'bg-amber-50 text-amber-700';
};

export function Inventory() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role, currentOrg } = useAuth();
  const [search, setSearch] = useState('');
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [gridMode, setGridMode] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('action') === 'add-item') {
      setShowAdd(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [moveLocationId, setMoveLocationId] = useState('');
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: string } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);

  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);

  const [showAddComponent, setShowAddComponent] = useState(false);
  const [addCompForm, setAddCompForm] = useState({ component_id: '', quantity: '1' });
  const [addCompSaving, setAddCompSaving] = useState(false);
  const [addCompError, setAddCompError] = useState<string | null>(null);

  const [labelItem, setLabelItem] = useState<any>(null);
  const [labelSize, setLabelSize] = useState<'2x1' | '4x6'>('2x1');
  const [labelCopied, setLabelCopied] = useState(false);
  const [labelSaving, setLabelSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchPrintItems, setBatchPrintItems] = useState<any[]>([]);
  const labelRef = useRef<HTMLDivElement>(null);
  const batchRefs = useRef<(HTMLDivElement | null)[]>([]);

  const statusFilter = STATUS_TO_VIEW[view] ?? null;

  const { data: items, loading, error, reload } = useOrgQuery<any>('inventory_items', orgId, {
    select: INV_SELECT,
    filter: statusFilter ? (q: any) => q.eq('status', statusFilter) : undefined,
    filterKey: statusFilter ?? 'all',
  });

  const { data: lots } = useOrgQuery<any>('lots', orgId, { select: 'id, lot_id, status, vendor_id, funding_partner_id' });
  const { data: locations } = useOrgQuery<any>('warehouse_locations', orgId, { select: 'id, location_code, zone, rack, shelf, bin' });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name' });
  const { data: partners } = useOrgQuery<any>('partners', orgId, { select: 'id, company_name' });
  const { data: allComponents } = useOrgQuery<any>('components', orgId, { select: 'id, name, sku, unit_cost, quantity_available' });
  const { data: rawItemComponents, reload: reloadComponents } = useOrgQuery<any>('inventory_item_components', orgId, {
    select: 'id, inventory_item_id, component_id, quantity, unit_cost, total_cost, attached_by, components(id, name, sku, unit_cost)',
  });

  const distinctBrands = Array.from(new Set(items.map((i: any) => i.brand).filter(Boolean))).sort() as string[];
  const distinctCategories = Array.from(new Set(items.map((i: any) => i.category).filter(Boolean))).sort() as string[];

  const invFilterDefs: FilterDef[] = [
    { type: 'select', key: 'lot_id', label: 'LOT', options: lots.map((l: any) => ({ value: l.id, label: `#${l.lot_id ? l.lot_id.toUpperCase() : l.id.slice(0, 8).toUpperCase()}` })) },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.name })) },
    { type: 'select', key: 'funding_partner_id', label: 'Funding Partner', options: partners.map((p: any) => ({ value: p.id, label: p.company_name })) },
    { type: 'select', key: 'brand', label: 'Brand', options: distinctBrands.map(b => ({ value: b, label: b })) },
    { type: 'select', key: 'category', label: 'Category', options: distinctCategories.map(c => ({ value: c, label: c })) },
    { type: 'select', key: 'warehouse_location_id', label: 'Location', options: locations.map((l: any) => ({ value: l.id, label: l.location_code ?? [l.zone, l.rack, l.shelf, l.bin].filter(Boolean).join('-') })) },
    { type: 'select', key: 'grade', label: 'Grade', options: GRADES.map(g => ({ value: g, label: g })) },
    { type: 'numrange', keyMin: 'msrp_min', keyMax: 'msrp_max', label: 'MSRP', prefix: '$' },
    { type: 'numrange', keyMin: 'asking_price_min', keyMax: 'asking_price_max', label: 'Asking Price', prefix: '$' },
    { type: 'numrange', keyMin: 'acq_cost_min', keyMax: 'acq_cost_max', label: 'Acq. Cost', prefix: '$' },
    { type: 'boolean', key: 'has_label', label: 'Has QR Label' },
    { type: 'boolean', key: 'missing_label', label: 'Missing QR Label' },
    { type: 'boolean', key: 'has_location', label: 'Has Location' },
    { type: 'boolean', key: 'missing_location', label: 'Missing Location' },
    { type: 'boolean', key: 'has_serial', label: 'Has Serial' },
    { type: 'boolean', key: 'missing_serial', label: 'Missing Serial' },
    { type: 'boolean', key: 'has_upc', label: 'Has UPC' },
    { type: 'boolean', key: 'missing_upc', label: 'Missing UPC' },
    { type: 'daterange', keyFrom: 'created_from', keyTo: 'created_to', label: 'Created Date' },
  ];

  const lotById = new Map(lots.map((l: any) => [l.id, l]));

  const filtered = items.filter((i: any) => {
    if (search && !i.product_title?.toLowerCase().includes(search.toLowerCase()) && !i.sku?.toLowerCase().includes(search.toLowerCase())) return false;
    const v = filterValues;
    const lot = lotById.get(i.lot_id);
    if (v.lot_id && i.lot_id !== v.lot_id) return false;
    if (v.vendor_id && lot?.vendor_id !== v.vendor_id) return false;
    if (v.funding_partner_id && lot?.funding_partner_id !== v.funding_partner_id) return false;
    if (v.brand && i.brand !== v.brand) return false;
    if (v.category && i.category !== v.category) return false;
    if (v.warehouse_location_id && i.warehouse_location_id !== v.warehouse_location_id) return false;
    if (v.grade && i.grade !== v.grade) return false;
    if (v.msrp_min && Number(i.msrp ?? 0) < Number(v.msrp_min)) return false;
    if (v.msrp_max && Number(i.msrp ?? 0) > Number(v.msrp_max)) return false;
    if (v.asking_price_min && Number(i.current_asking_price ?? 0) < Number(v.asking_price_min)) return false;
    if (v.asking_price_max && Number(i.current_asking_price ?? 0) > Number(v.asking_price_max)) return false;
    if (v.acq_cost_min && Number(i.weighted_acquisition_cost ?? 0) < Number(v.acq_cost_min)) return false;
    if (v.acq_cost_max && Number(i.weighted_acquisition_cost ?? 0) > Number(v.acq_cost_max)) return false;
    if (v.has_label === 'true' && !i.label_generated_at) return false;
    if (v.missing_label === 'true' && !!i.label_generated_at) return false;
    if (v.has_location === 'true' && !i.warehouse_location_id) return false;
    if (v.missing_location === 'true' && !!i.warehouse_location_id) return false;
    if (v.has_serial === 'true' && !i.serial_number) return false;
    if (v.missing_serial === 'true' && !!i.serial_number) return false;
    if (v.has_upc === 'true' && !i.upc) return false;
    if (v.missing_upc === 'true' && !!i.upc) return false;
    if (v.created_from && i.created_at && i.created_at.slice(0,10) < v.created_from) return false;
    if (v.created_to && i.created_at && i.created_at.slice(0,10) > v.created_to) return false;
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allSelected = filtered.length > 0 && filtered.every((i: any) => selectedIds.has(i.id));
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((i: any) => i.id)));
    }
  };

  const openItem = useCallback((item: any) => {
    setSelected(item);
    setEditing(false);
    setMoving(false);
    setMoveLocationId('');
    setDrawerError(null);
    setNotFoundMsg(null);
    setConfirm(null);
  }, []);

  const closeDrawer = () => {
    setSelected(null);
    setEditing(false);
    setMoving(false);
    setMoveLocationId('');
    setDrawerError(null);
    setNotFoundMsg(null);
    setConfirm(null);
  };

  const pendingSelId = useRef<string | null>(searchParams.get('selected'));
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);
  useEffect(() => {
    if (!pendingSelId.current || loading) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const item = items.find((i: any) => i.id === id);
    if (item) {
      openItem(item);
    } else {
      setNotFoundMsg('Inventory item not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [items, loading, openItem, setSearchParams]);

  const startEdit = (item: any) => {
    setEditForm({
      product_title: item.product_title ?? '',
      sku: item.sku ?? '',
      upc: item.upc ?? '',
      serial_number: item.serial_number ?? '',
      brand: item.brand ?? '',
      category: item.category ?? '',
      model: item.model ?? '',
      condition: item.condition ?? '',
      grade: item.grade ?? 'B',
      status: item.status ?? 'UNPROCESSED',
      msrp: item.msrp != null ? String(item.msrp) : '',
      current_asking_price: item.current_asking_price != null ? String(item.current_asking_price) : '',
      weighted_acquisition_cost: item.weighted_acquisition_cost != null ? String(item.weighted_acquisition_cost) : '',
      warehouse_location_id: item.warehouse_location_id ?? '',
      lot_id: item.lot_id ?? '',
      notes: item.notes ?? '',
      weight_oz: item.weight_oz != null ? String(item.weight_oz) : '',
      length_in: item.length_in != null ? String(item.length_in) : '',
      width_in: item.width_in != null ? String(item.width_in) : '',
      height_in: item.height_in != null ? String(item.height_in) : '',
    });
    setEditing(true);
    setMoving(false);
    setDrawerError(null);
  };

  const setEF = (k: string, v: string) => setEditForm((f: any) => ({ ...f, [k]: v }));

  const saveEdit = async () => {
    if (!editForm.product_title) { setDrawerError('Title is required.'); return; }
    setSaving(true); setDrawerError(null);
    const { error: err } = await updateRow('inventory_items', selected.id, {
      product_title: editForm.product_title,
      sku: editForm.sku || null,
      upc: editForm.upc || null,
      serial_number: editForm.serial_number || null,
      brand: editForm.brand || null,
      category: editForm.category || null,
      model: editForm.model || null,
      condition: editForm.condition || null,
      grade: editForm.grade || null,
      status: editForm.status || null,
      msrp: parseFloat(editForm.msrp) || null,
      current_asking_price: parseFloat(editForm.current_asking_price) || null,
      weighted_acquisition_cost: parseFloat(editForm.weighted_acquisition_cost) || null,
      warehouse_location_id: editForm.warehouse_location_id || null,
      lot_id: editForm.lot_id || null,
      notes: editForm.notes || null,
      weight_oz: parseFloat(editForm.weight_oz) || null,
      length_in: parseFloat(editForm.length_in) || null,
      width_in: parseFloat(editForm.width_in) || null,
      height_in: parseFloat(editForm.height_in) || null,
    });
    if (err) { setSaving(false); setDrawerError(err); return; }
    await logActivity(orgId!, user?.id!, `Inventory item "${editForm.product_title}" updated`, 'inventory_items', selected.id);
    reload();
    const { data: fresh } = await supabase.from('inventory_items').select(INV_SELECT).eq('id', selected.id).single();
    setSaving(false);
    setEditing(false);
    if (fresh) setSelected(fresh);
  };

  const saveMove = async () => {
    if (!moveLocationId) { setDrawerError('Select a destination location.'); return; }
    setSaving(true); setDrawerError(null);
    const { error: err } = await updateRow('inventory_items', selected.id, {
      warehouse_location_id: moveLocationId || null,
    });
    setSaving(false);
    if (err) { setDrawerError(err); return; }
    const destLoc = locations.find((l: any) => l.id === moveLocationId);
    await logActivity(orgId!, user?.id!, `Inventory item "${selected.product_title}" moved to ${locationLabel(destLoc)}`, 'inventory_items', selected.id);
    await reload();
    closeDrawer();
  };

  const markScrapped = async () => {
    setConfirmLoading(true);
    const { error: err } = await updateRow('inventory_items', selected.id, { status: 'SCRAPPED' });
    setConfirmLoading(false);
    if (err) { setDrawerError(err); setConfirm(null); return; }
    await logActivity(orgId!, user?.id!, `Inventory item "${selected.product_title}" marked SCRAPPED`, 'inventory_items', selected.id);
    await reload();
    closeDrawer();
  };

  const markDamaged = async () => {
    setConfirmLoading(true);
    const { error: err } = await updateRow('inventory_items', selected.id, { status: 'DAMAGED' });
    setConfirmLoading(false);
    if (err) { setDrawerError(err); setConfirm(null); return; }
    await logActivity(orgId!, user?.id!, `Inventory item "${selected.product_title}" marked DAMAGED`, 'inventory_items', selected.id);
    await reload();
    closeDrawer();
  };

  const handleDeleteCheck = async () => {
    setDrawerError(null);
    const [ordCount, retCount, compCount, supCount] = await Promise.all([
      countLinked('order_items', 'inventory_item_id', selected.id),
      countLinked('returns', 'inventory_item_id', selected.id),
      countLinked('inventory_item_components', 'inventory_item_id', selected.id),
      countLinked('supply_usage_logs', 'inventory_item_id', selected.id),
    ]);
    const reasons: string[] = [];
    if (ordCount > 0) reasons.push(`${ordCount} order line${ordCount !== 1 ? 's' : ''}`);
    if (retCount > 0) reasons.push(`${retCount} return${retCount !== 1 ? 's' : ''}`);
    if (compCount > 0) reasons.push(`${compCount} attached component${compCount !== 1 ? 's' : ''}`);
    if (supCount > 0) reasons.push(`${supCount} supply usage log${supCount !== 1 ? 's' : ''}`);
    if (reasons.length > 0) {
      setDrawerError(`Cannot delete: this item is linked to ${reasons.join(', ')}. Consider marking it SCRAPPED or DAMAGED instead.`);
      return;
    }
    setConfirm({ type: 'delete' });
  };

  const doDelete = async () => {
    setConfirmLoading(true);
    const { error: err } = await deleteRow('inventory_items', selected.id);
    setConfirmLoading(false);
    if (err) { setDrawerError(err); setConfirm(null); return; }
    await logActivity(orgId!, user?.id!, `Inventory item "${selected.product_title}" deleted`, 'inventory_items', selected.id);
    await reload();
    closeDrawer();
  };

  const handleScan = async () => {
    if (!scanInput.trim() || scanning) return;
    setScanning(true);
    const input = scanInput.trim();
    let itemId = null;
    try {
      const selectedMatch = input.match(/selected=([a-f0-9-]{36})/i);
      if (selectedMatch) {
        itemId = selectedMatch[1];
      } else {
        const { data: foundItems, error } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('organization_id', orgId)
          .or(`inventory_id.eq.${input},barcode_value.eq.${input}`);
        if (error) throw error;
        if (foundItems && foundItems.length > 0) itemId = foundItems[0].id;
      }
      if (itemId) {
        setSearchParams(p => { p.set('selected', itemId); return p; });
        setScanInput('');
      } else {
        setNotFoundMsg(`No inventory item found for: ${input}`);
        setTimeout(() => setNotFoundMsg(null), 5000);
      }
    } catch (error: any) {
      setNotFoundMsg(`Scan error: ${error.message}`);
      setTimeout(() => setNotFoundMsg(null), 5000);
    } finally {
      setScanning(false);
    }
  };

  const generateAndSave = useCallback(async (item: any) => {
    const barcodeVal = (item.inventory_id ?? item.id).slice(0, 12).toUpperCase();
    await updateRow('inventory_items', item.id, {
      barcode_value: barcodeVal,
      label_generated_at: new Date().toISOString(),
    });
  }, []);

  const copyQrUrl = async (item: any) => {
    const url = qrUrlFor(item);
    try {
      await navigator.clipboard.writeText(url);
      setLabelCopied(true);
      setTimeout(() => setLabelCopied(false), 2000);
    } catch {}
  };

  const printLabel = async () => {
    if (!labelRef.current || !labelItem) return;
    setLabelSaving(true);
    await generateAndSave(labelItem);
    setLabelSaving(false);
    const pageSize = labelSize === '2x1' ? '2in 1in' : '4in 6in';
    const html = labelRef.current.outerHTML;
    const win = window.open('', '_blank', 'width=800,height=600');
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: ${pageSize}; margin: 0; }
      body { margin: 0; padding: 0; display: flex; justify-content: center; align-items: flex-start; }
    </style></head><body>${html}</body></html>`);
    win.document.close();
    setTimeout(() => { win.print(); win.close(); }, 300);
  };

  const printBatch = () => {
    const itemsToPrint = filtered.filter((i: any) => selectedIds.has(i.id));
    if (!itemsToPrint.length) return;
    batchRefs.current = [];
    setBatchPrintItems(itemsToPrint);
    setTimeout(async () => {
      const refs = batchRefs.current.filter(Boolean);
      if (!refs.length) return;
      await Promise.all(itemsToPrint.map(item => generateAndSave(item)));
      const pageSize = labelSize === '2x1' ? '2in 1in' : '4in 6in';
      const labels = refs.map(el => el!.outerHTML).join('');
      const win = window.open('', '_blank', 'width=800,height=800');
      if (!win) { setBatchPrintItems([]); return; }
      win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        @page { size: ${pageSize}; margin: 0; }
        body { margin: 0; padding: 0; }
        [data-label-size] { page-break-after: always; display: block; }
        [data-label-size]:last-child { page-break-after: auto; }
      </style></head><body>${labels}</body></html>`);
      win.document.close();
      setTimeout(() => { win.print(); win.close(); setBatchPrintItems([]); }, 300);
    }, 150);
  };

  const drawerSubtitle = selected
    ? ([selected.sku, selected.brand].filter(Boolean).join(' ') || '—')
    : '';

  const drawerFooter = selected && (
    <div className="flex flex-wrap gap-2">
      {!editing && !moving && (
        <>
          {canEditOps(role) && (
            <button onClick={() => startEdit(selected)} className="px-3 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg">Edit</button>
          )}
          {canEditOps(role) && (
            <button onClick={() => { setMoving(true); setEditing(false); setDrawerError(null); }} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] text-gray-700 rounded-lg hover:bg-gray-50">
              <MapPin size={12} />Move Item
            </button>
          )}
          <button onClick={() => { setLabelItem(selected); setLabelCopied(false); }} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] text-gray-700 rounded-lg hover:bg-gray-50">
            <Tag size={12} />Generate Label
          </button>
          {canEditOps(role) && (
            <button onClick={() => setConfirm({ type: 'scrapped' })} className="px-3 py-1.5 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] text-amber-700 rounded-lg hover:bg-amber-50">Mark Scrapped</button>
          )}
          {canEditOps(role) && (
            <button onClick={() => setConfirm({ type: 'damaged' })} className="px-3 py-1.5 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] text-orange-700 rounded-lg hover:bg-orange-50">Mark Damaged</button>
          )}
          {isAdmin(role) && (
            <button onClick={handleDeleteCheck} className="px-3 py-1.5 text-[13px] font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 ml-auto">Delete</button>
          )}
        </>
      )}
      {editing && (
        <>
          <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
            {saving && <Loader2 size={12} className="animate-spin" />}Save
          </button>
          <button onClick={() => { setEditing(false); setDrawerError(null); }} className="px-3 py-1.5 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        </>
      )}
      {moving && (
        <>
          <button onClick={saveMove} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
            {saving && <Loader2 size={12} className="animate-spin" />}Save Move
          </button>
          <button onClick={() => { setMoving(false); setMoveLocationId(''); setDrawerError(null); }} className="px-3 py-1.5 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        </>
      )}
    </div>
  );

  const itemComponents = rawItemComponents.filter((ic: any) => ic.inventory_item_id === selected?.id);

  const refreshSelected = async (id: string) => {
    const { data: fresh } = await supabase.from('inventory_items').select(INV_SELECT).eq('id', id).single();
    if (fresh) setSelected(fresh);
  };

  const addComponent = async () => {
    if (!addCompForm.component_id) { setAddCompError('Select a component.'); return; }
    const qty = parseInt(addCompForm.quantity) || 0;
    if (qty < 1) { setAddCompError('Quantity must be at least 1.'); return; }
    const comp = allComponents.find((c: any) => c.id === addCompForm.component_id);
    if (!comp) return;
    if ((comp.quantity_available ?? 0) < qty) { setAddCompError(`Insufficient stock: only ${comp.quantity_available ?? 0} available.`); return; }
    setAddCompSaving(true); setAddCompError(null);
    const { error: e1 } = await insertRow('inventory_item_components', {
      organization_id: orgId, inventory_item_id: selected.id, component_id: comp.id,
      quantity: qty, unit_cost: comp.unit_cost ?? 0, total_cost: (comp.unit_cost ?? 0) * qty, attached_by: user?.id ?? null,
    });
    if (e1) { setAddCompError(e1); setAddCompSaving(false); return; }
    const newAvailable = Math.max(0, (comp.quantity_available ?? 0) - qty);
    const { error: e2 } = await updateRow('components', comp.id, { quantity_available: newAvailable });
    if (e2) { setAddCompError(`Attached but failed to update component stock: ${e2}`); setAddCompSaving(false); return; }
    const newCompCost = Number(selected.component_cost ?? 0) + (Number(comp.unit_cost ?? 0) * qty);
    const newTotalCostBasis = Number(selected.weighted_acquisition_cost ?? 0) + newCompCost + Number(selected.supply_cost ?? 0) + Number(selected.shipping_cost ?? 0) + Number(selected.marketplace_fees ?? 0);
    const { error: e3 } = await updateRow('inventory_items', selected.id, { component_cost: newCompCost, total_cost_basis: newTotalCostBasis });
    if (e3) { setAddCompError(`Attached but failed to update item cost: ${e3}`); setAddCompSaving(false); return; }
    await logActivity(orgId!, user?.id!, `Component "${comp.name}" ×${qty} attached to "${selected.product_title}"`, 'inventory_item_components');
    setShowAddComponent(false);
    setAddCompForm({ component_id: '', quantity: '1' });
    setAddCompSaving(false);
    await reloadComponents();
    reload();
    await refreshSelected(selected.id);
  };

  const removeComponent = async (ic: any) => {
    const qty = Number(ic.quantity ?? 1);
    const unitCost = Number(ic.components?.unit_cost ?? ic.unit_cost ?? 0);
    const { error: e1 } = await deleteRow('inventory_item_components', ic.id);
    if (e1) { setDrawerError(`Failed to remove component: ${e1}`); return; }
    const comp = allComponents.find((c: any) => c.id === ic.component_id);
    if (comp) {
      const { error: e2 } = await updateRow('components', comp.id, { quantity_available: (comp.quantity_available ?? 0) + qty });
      if (e2) console.error('Failed to restore component quantity:', e2);
    }
    const newCompCost = Math.max(0, Number(selected.component_cost ?? 0) - unitCost * qty);
    const newTotalCostBasis = Number(selected.weighted_acquisition_cost ?? 0) + newCompCost + Number(selected.supply_cost ?? 0) + Number(selected.shipping_cost ?? 0) + Number(selected.marketplace_fees ?? 0);
    const { error: e3 } = await updateRow('inventory_items', selected.id, { component_cost: newCompCost, total_cost_basis: newTotalCostBasis });
    if (e3) { setDrawerError(`Component removed but failed to update item cost: ${e3}`); }
    await logActivity(orgId!, user?.id!, `Component "${ic.components?.name}" removed from "${selected.product_title}"`, 'inventory_item_components');
    await reloadComponents();
    reload();
    await refreshSelected(selected.id);
  };

  // Label preview scale — reserves correct layout space so label doesn't overflow
  const labelNativeW = labelSize === '2x1' ? 192 : 384;
  const labelNativeH = labelSize === '2x1' ? 96 : 576;
  const containerW = 460;
  const containerH = labelSize === '2x1' ? 300 : 500;
  const scaleW = containerW / labelNativeW;
  const scaleH = containerH / labelNativeH;
  const previewScale = Math.min(scaleW, scaleH, 2.5);
  const scaledW = Math.round(labelNativeW * previewScale);
  const scaledH = Math.round(labelNativeH * previewScale);

  return (
    <div className="p-3 sm:p-6 max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Inventory</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Track every item across the workflow</p>
        </div>
        {(canEdit(role) || canEditOps(role)) && (
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Add Item
          </button>
        )}
      </div>

      {notFoundMsg && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-lg text-[12px] text-amber-700">
          <span className="flex-1">{notFoundMsg}</span>
          <button onClick={() => setNotFoundMsg(null)} className="text-amber-400 hover:text-amber-600 transition-colors">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        <div className="px-3 sm:px-4 py-3 border-b border-[rgba(0,0,0,0.06)] flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by title or SKU..."
              className="pl-7 pr-3 py-1.5 text-[13px] bg-gray-50 border border-[rgba(0,0,0,0.08)] rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400" />
          </div>
          <div className="relative flex-1 max-w-sm">
            <ScanLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3ECF8E]" />
            <input value={scanInput} onChange={e => setScanInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleScan()}
              placeholder="Scan QR code or inventory ID..." disabled={scanning}
              className="pl-7 pr-16 py-1.5 text-[13px] bg-[#F0FDF4] border border-[#3ECF8E]/20 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/30 focus:border-[#3ECF8E] placeholder:text-gray-500 disabled:opacity-60" />
            {scanInput && (
              <button onClick={handleScan} disabled={scanning}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-medium bg-[#3ECF8E] text-white rounded hover:bg-[#38c484] disabled:opacity-60 transition-colors">
                {scanning ? <Loader2 size={10} className="animate-spin" /> : 'Scan'}
              </button>
            )}
          </div>
          {selectedIds.size > 0 && (
            <button onClick={printBatch} className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors">
              <Printer size={12} />Print Labels ({selectedIds.size})
            </button>
          )}
          <span className="text-[12px] text-gray-400 ml-auto">{filtered.length} items</span>
          <div className="flex border border-[rgba(0,0,0,0.1)] rounded-lg overflow-hidden">
            <button onClick={() => setGridMode(false)} className={`p-1.5 ${!gridMode ? 'bg-gray-100' : 'hover:bg-gray-50'}`}><List size={13} className="text-gray-500" /></button>
            <button onClick={() => setGridMode(true)} className={`p-1.5 ${gridMode ? 'bg-gray-100' : 'hover:bg-gray-50'}`}><Grid3X3 size={13} className="text-gray-500" /></button>
          </div>
        </div>
        <FilterBar defs={invFilterDefs} values={filterValues} onChange={setFilterValues} />

        {loading ? (
          <div className="divide-y divide-[rgba(0,0,0,0.04)]">
            {[1,2,3,4,5].map(i => <div key={i} className="h-12 px-5 py-3 flex items-center"><div className="h-4 w-48 bg-gray-100 animate-pulse rounded" /></div>)}
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={reload} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No inventory items" description={search ? 'Try a different search.' : 'Add your first inventory item.'} action={!search && canEditOps(role) ? { label: 'Add Item', onClick: () => setShowAdd(true) } : undefined} />
        ) : gridMode ? (
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {filtered.map((item: any) => (
              <div key={item.id ?? item.inventory_id} onClick={() => openItem(item)} className="border border-[rgba(0,0,0,0.07)] rounded-xl p-3 hover:border-[rgba(0,0,0,0.15)] transition-colors cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${conditionColor(item.grade)}`}>Grade {item.grade ?? '?'}</span>
                  <StatusBadge status={item.status} size="sm" />
                </div>
                <p className="text-[13px] font-medium text-gray-900 leading-snug">{item.product_title}</p>
                <p className="text-[11px] text-gray-400 mt-1">{item.brand ?? ''}</p>
                <p className="text-[13px] font-semibold text-gray-900 mt-2">${Number(item.current_asking_price || 0).toFixed(0)}</p>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-[rgba(0,0,0,0.05)]">
              {filtered.map((item: any) => (
                <div key={item.id ?? item.inventory_id} onClick={() => openItem(item)}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer">
                  <input type="checkbox" checked={selectedIds.has(item.id)}
                    onChange={e => { e.stopPropagation(); toggleSelect(item.id); }}
                    onClick={e => e.stopPropagation()}
                    className="w-3.5 h-3.5 accent-gray-800 cursor-pointer flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-900 truncate">{item.product_title}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{[item.brand, item.sku].filter(Boolean).join(' · ') || '—'}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <StatusBadge status={item.status} size="sm" />
                      {item.grade && <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${conditionColor(item.grade)}`}>Grade {item.grade}</span>}
                      <span className="text-[11px] font-mono text-gray-400">{locationLabel(item.warehouse_locations)}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className="text-[14px] font-semibold text-gray-900">${Number(item.current_asking_price || 0).toFixed(0)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{lotLabel(item)}</p>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(0,0,0,0.06)]">
                    <th className="pl-4 pr-2 py-2.5 w-8">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="w-3.5 h-3.5 accent-gray-800 cursor-pointer" />
                    </th>
                    {['SKU', 'Title', 'Brand', 'Grade', 'Status', 'Asking Price', 'Location', 'LOT'].map(h => (
                      <th key={h} className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item: any, i: number) => (
                    <tr key={item.id ?? item.inventory_id} className={`hover:bg-gray-50/70 ${i < filtered.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                      <td className="pl-4 pr-2 py-3 w-8" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => toggleSelect(item.id)} className="w-3.5 h-3.5 accent-gray-800 cursor-pointer" />
                      </td>
                      <td className="px-5 py-3 text-[11px] font-mono text-gray-400 cursor-pointer" onClick={() => openItem(item)}>{item.sku ?? '—'}</td>
                      <td className="px-5 py-3 text-[13px] font-medium text-gray-900 max-w-[240px] truncate cursor-pointer" onClick={() => openItem(item)}>{item.product_title}</td>
                      <td className="px-5 py-3 text-[13px] text-gray-600 cursor-pointer" onClick={() => openItem(item)}>{item.brand ?? '—'}</td>
                      <td className="px-5 py-3 cursor-pointer" onClick={() => openItem(item)}>
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${conditionColor(item.grade)}`}>{item.grade ? `Grade ${item.grade}` : '—'}</span>
                      </td>
                      <td className="px-5 py-3 cursor-pointer" onClick={() => openItem(item)}><StatusBadge status={item.status} size="sm" /></td>
                      <td className="px-5 py-3 text-[13px] text-gray-700 tabular-nums cursor-pointer" onClick={() => openItem(item)}>${Number(item.current_asking_price || 0).toFixed(0)}</td>
                      <td className="px-5 py-3 text-[11px] font-mono text-gray-400 whitespace-nowrap cursor-pointer" onClick={() => openItem(item)}>{locationLabel(item.warehouse_locations)}</td>
                      <td className="px-5 py-3 text-[11px] font-mono text-gray-400 cursor-pointer" onClick={() => openItem(item)}>{lotLabel(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <AddInventoryModal open={showAdd} onClose={() => setShowAdd(false)} orgId={orgId} userId={user?.id} lots={lots} locations={locations} onCreated={reload} />

      <Drawer open={!!selected} onClose={closeDrawer} title={selected?.product_title ?? ''} subtitle={drawerSubtitle} footer={drawerFooter}>
        {selected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={selected.status} />
              {selected.grade && <span className={`text-[11px] font-medium px-2 py-0.5 rounded ${conditionColor(selected.grade)}`}>Grade {selected.grade}</span>}
              {selected.label_generated_at && (
                <span className="text-[11px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded flex items-center gap-1">
                  <Tag size={9} />Label generated {new Date(selected.label_generated_at).toLocaleDateString()}
                </span>
              )}
            </div>
            {drawerError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{drawerError}</p>}
            {moving && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 space-y-3">
                <p className="text-[13px] font-medium text-blue-900">Select destination location</p>
                <select className={selectCls} value={moveLocationId} onChange={e => setMoveLocationId(e.target.value)}>
                  <option value="">— Select location —</option>
                  {locations.map((l: any) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
                </select>
              </div>
            )}
            {editing ? (
              <div className="space-y-3">
                <FormField label="Product Title" required><input className={inputCls} value={editForm.product_title} onChange={e => setEF('product_title', e.target.value)} /></FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="SKU"><input className={inputCls} value={editForm.sku} onChange={e => setEF('sku', e.target.value)} /></FormField>
                  <FormField label="UPC"><input className={inputCls} value={editForm.upc} onChange={e => setEF('upc', e.target.value)} /></FormField>
                </div>
                <FormField label="Serial Number"><input className={inputCls} value={editForm.serial_number} onChange={e => setEF('serial_number', e.target.value)} /></FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Brand"><input className={inputCls} value={editForm.brand} onChange={e => setEF('brand', e.target.value)} /></FormField>
                  <FormField label="Category"><input className={inputCls} value={editForm.category} onChange={e => setEF('category', e.target.value)} /></FormField>
                </div>
                <FormField label="Model"><input className={inputCls} value={editForm.model} onChange={e => setEF('model', e.target.value)} /></FormField>
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Grade">
                    <select className={selectCls} value={editForm.grade} onChange={e => setEF('grade', e.target.value)}>{GRADES.map(g => <option key={g}>{g}</option>)}</select>
                  </FormField>
                  <FormField label="Status">
                    <select className={selectCls} value={editForm.status} onChange={e => setEF('status', e.target.value)}>{INV_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
                  </FormField>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <FormField label="MSRP ($)"><input type="number" className={inputCls} value={editForm.msrp} onChange={e => setEF('msrp', e.target.value)} min="0" step="0.01" /></FormField>
                  <FormField label="Asking Price ($)"><input type="number" className={inputCls} value={editForm.current_asking_price} onChange={e => setEF('current_asking_price', e.target.value)} min="0" step="0.01" /></FormField>
                  <FormField label="Acq. Cost ($)"><input type="number" className={inputCls} value={editForm.weighted_acquisition_cost} onChange={e => setEF('weighted_acquisition_cost', e.target.value)} min="0" step="0.01" /></FormField>
                </div>
                <FormField label="Location">
                  <select className={selectCls} value={editForm.warehouse_location_id} onChange={e => setEF('warehouse_location_id', e.target.value)}>
                    <option value="">— No location —</option>
                    {locations.map((l: any) => <option key={l.id} value={l.id}>{locationLabel(l)}</option>)}
                  </select>
                </FormField>
                <FormField label="LOT">
                  <select className={selectCls} value={editForm.lot_id} onChange={e => setEF('lot_id', e.target.value)}>
                    <option value="">— No LOT —</option>
                    {lots.map((l: any) => <option key={l.id} value={l.id}>#{l.lot_id ? l.lot_id.toUpperCase() : l.id.slice(0, 8).toUpperCase()}</option>)}
                  </select>
                </FormField>
                <FormField label="Condition"><textarea className={textareaCls} rows={2} value={editForm.condition} onChange={e => setEF('condition', e.target.value)} /></FormField>
                <FormField label="Notes"><textarea className={textareaCls} rows={2} value={editForm.notes} onChange={e => setEF('notes', e.target.value)} /></FormField>
                <div>
                  <label className="text-[11px] font-medium text-gray-500 mb-2 block uppercase tracking-wide">Weight & Dimensions (for shipping)</label>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Weight (oz)">
                      <input type="number" className={inputCls} value={editForm.weight_oz} onChange={e => setEF('weight_oz', e.target.value)} placeholder="16" min="0" step="0.1" />
                    </FormField>
                    <FormField label="Length (in)">
                      <input type="number" className={inputCls} value={editForm.length_in} onChange={e => setEF('length_in', e.target.value)} placeholder="12" min="0" step="0.1" />
                    </FormField>
                    <FormField label="Width (in)">
                      <input type="number" className={inputCls} value={editForm.width_in} onChange={e => setEF('width_in', e.target.value)} placeholder="8" min="0" step="0.1" />
                    </FormField>
                    <FormField label="Height (in)">
                      <input type="number" className={inputCls} value={editForm.height_in} onChange={e => setEF('height_in', e.target.value)} placeholder="4" min="0" step="0.1" />
                    </FormField>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <DetailRow label="SKU" value={selected.sku} />
                <DetailRow label="UPC" value={selected.upc} />
                <DetailRow label="Serial Number" value={selected.serial_number} />
                <DetailRow label="Brand" value={selected.brand} />
                <DetailRow label="Category" value={selected.category} />
                <DetailRow label="Model" value={selected.model} />
                <DetailRow label="Condition" value={selected.condition} />
                <DetailRow label="Grade" value={selected.grade} />
                <DetailRow label="Status" value={<StatusBadge status={selected.status} size="sm" />} />
                <DetailRow label="MSRP" value={selected.msrp != null ? `$${Number(selected.msrp).toFixed(2)}` : null} />
                <DetailRow label="Acquisition Cost" value={selected.weighted_acquisition_cost != null ? `$${Number(selected.weighted_acquisition_cost).toFixed(2)}` : null} />
                <DetailRow label="Asking Price" value={selected.current_asking_price != null ? `$${Number(selected.current_asking_price).toFixed(2)}` : null} />
                <DetailRow label="Location" value={locationLabel(selected.warehouse_locations)} />
                <DetailRow label="LOT" value={lotLabel(selected) !== '—' ? lotLabel(selected) : null} />
                <DetailRow label="Notes" value={selected.notes} />
                <DetailRow label="Weight" value={selected.weight_oz != null ? `${selected.weight_oz} oz` : null} />
                {(selected.length_in || selected.width_in || selected.height_in) && (
                  <DetailRow label="Dimensions" value={`${selected.length_in ?? '?'} × ${selected.width_in ?? '?'} × ${selected.height_in ?? '?'} in`} />
                )}
                <DetailRow label="Label Generated" value={selected.label_generated_at ? new Date(selected.label_generated_at).toLocaleDateString() : 'Never'} />
                <DetailRow label="Created" value={selected.created_at ? new Date(selected.created_at).toLocaleDateString() : null} />

                <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Components</p>
                    {canEditOps(role) && (
                      <button onClick={() => { setShowAddComponent(true); setAddCompError(null); setAddCompForm({ component_id: '', quantity: '1' }); }} className="flex items-center gap-1 text-[12px] text-[#3ECF8E] hover:text-[#38c484] font-medium">
                        <Plus size={11} />Add
                      </button>
                    )}
                  </div>
                  {showAddComponent && (
                    <div className="mb-3 bg-gray-50 border border-[rgba(0,0,0,0.08)] rounded-xl p-3 space-y-2">
                      {addCompError && <p className="text-[12px] text-red-500">{addCompError}</p>}
                      <select className={selectCls} value={addCompForm.component_id} onChange={e => setAddCompForm(f => ({ ...f, component_id: e.target.value }))}>
                        <option value="">— Select component —</option>
                        {allComponents.filter((c: any) => (c.quantity_available ?? 0) > 0).map((c: any) => (
                          <option key={c.id} value={c.id}>{c.name}{c.sku ? ` (${c.sku})` : ''} — {c.quantity_available} avail.</option>
                        ))}
                      </select>
                      <div className="flex items-center gap-2">
                        <input type="number" min="1" className={`${inputCls} w-24`} value={addCompForm.quantity} onChange={e => setAddCompForm(f => ({ ...f, quantity: e.target.value }))} placeholder="Qty" />
                        <button onClick={addComponent} disabled={addCompSaving} className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
                          {addCompSaving && <Loader2 size={11} className="animate-spin" />}Attach
                        </button>
                        <button onClick={() => setShowAddComponent(false)} className="px-3 py-1.5 text-[12px] text-gray-500 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-100">Cancel</button>
                      </div>
                    </div>
                  )}
                  {itemComponents.length === 0 ? (
                    <p className="text-[12px] text-gray-400 py-1">No components attached.</p>
                  ) : (
                    <div className="space-y-px">
                      {itemComponents.map((ic: any) => {
                        const lineTotal = Number(ic.components?.unit_cost ?? ic.unit_cost ?? 0) * Number(ic.quantity ?? 1);
                        return (
                          <div key={ic.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
                            <div className="min-w-0">
                              <p className="text-[13px] text-gray-800 truncate">{ic.components?.name ?? ic.component_id}</p>
                              <p className="text-[11px] text-gray-400">×{ic.quantity} @ ${Number(ic.components?.unit_cost ?? ic.unit_cost ?? 0).toFixed(2)}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className="text-[12px] font-medium text-gray-700 tabular-nums">${lineTotal.toFixed(2)}</span>
                              {canEditOps(role) && (
                                <button onClick={() => removeComponent(ic)} className="opacity-0 group-hover:opacity-100 p-1 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-all"><X size={11} /></button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <div className="flex items-center justify-between pt-2 mt-1 border-t border-[rgba(0,0,0,0.06)] px-2">
                        <span className="text-[12px] font-medium text-gray-500">Component Cost Total</span>
                        <span className="text-[13px] font-semibold text-gray-900 tabular-nums">
                          ${itemComponents.reduce((sum: number, ic: any) => sum + Number(ic.components?.unit_cost ?? ic.unit_cost ?? 0) * Number(ic.quantity ?? 1), 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {(() => {
                  const acq = Number(selected.weighted_acquisition_cost ?? 0);
                  const comp = Number(selected.component_cost ?? 0);
                  const supply = Number(selected.supply_cost ?? 0);
                  const ship = Number(selected.shipping_cost ?? 0);
                  const fees = Number(selected.marketplace_fees ?? 0);
                  const total = acq + comp + supply + ship + fees;
                  return (
                    <div className="mt-3 bg-gray-50 rounded-xl px-4 py-3">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Cost Rollup</p>
                      {([['Acquisition Cost', acq], ['Component Cost', comp], ['Supply Cost', supply], ['Shipping Cost', ship], ['Marketplace Fees', fees]] as [string, number][]).map(([label, val]) => (
                        <div key={label} className="flex justify-between py-0.5">
                          <span className="text-[12px] text-gray-500">{label}</span>
                          <span className="text-[12px] text-gray-700 tabular-nums">${val.toFixed(2)}</span>
                        </div>
                      ))}
                      <div className="flex justify-between pt-2 mt-1 border-t border-[rgba(0,0,0,0.1)]">
                        <span className="text-[12px] font-semibold text-gray-700">True Cost</span>
                        <span className="text-[13px] font-bold text-gray-900 tabular-nums">${total.toFixed(2)}</span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={confirm?.type === 'scrapped'} title="Mark as Scrapped?" description={`"${selected?.product_title}" will be marked SCRAPPED.`} confirmLabel="Mark Scrapped" onConfirm={markScrapped} onCancel={() => setConfirm(null)} loading={confirmLoading} />
      <ConfirmDialog open={confirm?.type === 'damaged'} title="Mark as Damaged?" description={`"${selected?.product_title}" will be marked DAMAGED.`} confirmLabel="Mark Damaged" onConfirm={markDamaged} onCancel={() => setConfirm(null)} loading={confirmLoading} />
      <ConfirmDialog open={confirm?.type === 'delete'} title="Delete Item?" description={`This will permanently delete "${selected?.product_title}". This action cannot be undone.`} confirmLabel="Delete" danger onConfirm={doDelete} onCancel={() => setConfirm(null)} loading={confirmLoading} />

      {/* Label Preview Modal */}
      {labelItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setLabelItem(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 flex flex-col overflow-hidden" style={{ maxHeight: '90vh' }}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(0,0,0,0.07)] flex-shrink-0">
              <div>
                <h3 className="text-[14px] font-semibold text-gray-900">Inventory Label</h3>
                <p className="text-[12px] text-gray-400 mt-0.5 truncate max-w-[340px]">{labelItem.product_title}</p>
              </div>
              <button onClick={() => setLabelItem(null)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
            </div>
            <div className="px-5 pt-4 flex-shrink-0">
              <div className="flex gap-1.5 bg-gray-100 p-1 rounded-lg w-fit">
                {(['2x1', '4x6'] as const).map(sz => (
                  <button key={sz} onClick={() => setLabelSize(sz)}
                    className={`px-3 py-1 text-[12px] font-medium rounded-md transition-all ${labelSize === sz ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
                    {sz === '2x1' ? '2″ × 1″' : '4″ × 6″'}
                  </button>
                ))}
              </div>
            </div>
            {/* Label preview — wrapper reserves exact scaled dimensions so label never clips */}
            <div className="flex-1 overflow-auto px-5 py-4">
              <div className="flex justify-center items-center bg-gray-50 border border-dashed border-gray-200 rounded-xl p-6">
                <div style={{ width: `${scaledW}px`, height: `${scaledH}px`, position: 'relative', flexShrink: 0 }}>
                  <div style={{ transform: `scale(${previewScale})`, transformOrigin: 'top left', position: 'absolute', top: 0, left: 0 }}>
                    <InventoryLabel
                      ref={labelRef}
                      item={labelItem}
                      size={labelSize}
                      orgLogo={currentOrg?.logo_url}
                      qrUrl={qrUrlFor(labelItem)}
                    />
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-400 text-center mt-2">QR → {qrUrlFor(labelItem)}</p>
            </div>
            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[rgba(0,0,0,0.07)] flex-shrink-0">
              <button onClick={() => setLabelItem(null)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Close</button>
              <div className="flex gap-2">
                <button onClick={() => copyQrUrl(labelItem)} className="flex items-center gap-1.5 px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">
                  {labelCopied ? <><Check size={12} className="text-[#3ECF8E]" />Copied!</> : <><Copy size={12} />Copy QR URL</>}
                </button>
                <button onClick={printLabel} disabled={labelSaving} className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-60 transition-colors">
                  {labelSaving ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}Print Label
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', pointerEvents: 'none' }}>
        {batchPrintItems.map((item, i) => (
          <InventoryLabel key={item.id} ref={(el: HTMLDivElement | null) => { batchRefs.current[i] = el; }} item={item} size={labelSize} orgLogo={currentOrg?.logo_url} qrUrl={qrUrlFor(item)} />
        ))}
      </div>
    </div>
  );
}
