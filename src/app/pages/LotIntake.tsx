import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Loader2, ExternalLink } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity } from '../../lib/hooks';
import { canEdit, isAdmin } from '../../lib/permissions';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DetailRow, EmptyState, ErrorState, Modal, FormField, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { ManifestImportModal } from '../components/ManifestImportModal';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

const LOT_STATUSES = ['PURCHASED', 'IN_TRANSIT', 'ARRIVED', 'PROCESSING', 'ACTIVE', 'PARTIAL', 'CLOSED'];
const ALL_LOT_STATUSES = [...LOT_STATUSES, 'ARCHIVED'];

// Restored from the initial working implementation (commit 6ec0e20); these
// definitions were dropped by 39cc4c9 ("Updated After A Long Break") while their
// call sites remained, causing a ReferenceError on the Lot Intake page.
function fmt(val: any, prefix = '') {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (!isNaN(n)) return `${prefix}${n.toLocaleString()}`;
  return String(val);
}

function fmtMoney(val: any) {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  if (isNaN(n)) return null;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const LOT_SELECT = 'id, lot_id, status, total_msrp, recovery_amount, purchase_date, arrival_date, vendor_id, funding_partner_id, purchase_price, freight_cost, handling_cost, manual_landed_cost_override, truckload_number, pallet_count, liquidation_source, notes, created_at, vendors(name), funding_partners:partners!lots_funding_partner_id_fkey(company_name)';

function NewLotModal({ open, onClose, orgId, userId, vendors, partners, onCreated }: any) {
  const [form, setForm] = useState({
    status: 'PURCHASED',
    total_msrp: '',
    purchase_date: '',
    arrival_date: '',
    notes: '',
    vendor_id: '',
    funding_partner_id: '',
    purchase_price: '',
    freight_cost: '',
    handling_cost: '',
    truckload_number: '',
    pallet_count: '',
    liquidation_source: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleClose = () => {
    setForm({
      status: 'PURCHASED',
      total_msrp: '',
      purchase_date: '',
      arrival_date: '',
      notes: '',
      vendor_id: '',
      funding_partner_id: '',
      purchase_price: '',
      freight_cost: '',
      handling_cost: '',
      truckload_number: '',
      pallet_count: '',
      liquidation_source: '',
    });
    setError(null);
    onClose();
  };

  const save = async () => {
    if (!form.status) { setError('Status is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('lots', {
      organization_id: orgId,
      location_id: null,
      status: form.status,
      vendor_id: form.vendor_id || null,
      funding_partner_id: form.funding_partner_id || null,
      purchase_date: form.purchase_date || null,
      arrival_date: form.arrival_date || null,
      purchase_price: parseFloat(form.purchase_price) || null,
      freight_cost: parseFloat(form.freight_cost) || null,
      handling_cost: parseFloat(form.handling_cost) || null,
      total_msrp: parseFloat(form.total_msrp) || null,
      truckload_number: form.truckload_number || null,
      pallet_count: parseInt(form.pallet_count) || null,
      liquidation_source: form.liquidation_source || null,
      notes: form.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, 'LOT created', 'lots');
    setSaving(false);
    onCreated();
    handleClose();
  };

}

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
export function LotIntake() {
  const view = useSecondaryView();
  const { orgId, user, currentRole } = useAuth();
  const navigate = useNavigate();
  const [showNew, setShowNew] = useState(false);
  const [showManifest, setShowManifest] = useState(false);
  const _sortInit = (() => { try { return JSON.parse(localStorage.getItem('deryv.sort.lotintake') ?? 'null') ?? {}; } catch { return {}; } })();
  const [sortCol, setSortCol] = useState<string | null>(_sortInit.col ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_sortInit.dir ?? 'asc');
  const handleSort = (col: string) => {
    const next = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    const nextCol = sortCol === col ? col : col;
    setSortCol(nextCol);
    setSortDir(next as 'asc' | 'desc');
    localStorage.setItem('deryv.sort.lotintake', JSON.stringify({ col: nextCol, dir: next }));
  };
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'new-lot') {
      setShowNew(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    } else if (action === 'upload-manifest') {
      setShowManifest(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Drawer state
  const [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: string } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);

  const [filterValues, setFilterValues] = useState<FilterValues>({});

  const isVendorView = view === 'vendors';
  const isFundingView = view === 'funding';

  const statusValue = LOT_STATUSES.includes(view.toUpperCase().replace('-', '_'))
    ? view.toUpperCase().replace('-', '_')
    : null;

  const { data: lots, loading, error, reload } = useOrgQuery<any>('lots', orgId, {
    select: LOT_SELECT,
    filter: statusValue ? (q: any) => q.eq('status', statusValue) : undefined,
    filterKey: statusValue ?? 'all',
    enabled: !isVendorView && !isFundingView,
  });

  const { data: vendors, loading: vendLoading } = useOrgQuery<any>('vendors', orgId, {
    select: 'id, name, type, status',
    enabled: true,
  });

  const { data: presets } = useOrgQuery<any>('product_presets', orgId, {
    select: '*, preset_supplies(supply_id, quantity, supplies(id, name, unit_cost))',
  });
  const { data: partners, loading: partLoading } = useOrgQuery<any>('partners', orgId, {
    select: 'id, company_name, status, profit_split_percent',
    enabled: true,
  });

  const lotFilterDefs: FilterDef[] = [
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.name })) },
    { type: 'select', key: 'funding_partner_id', label: 'Funding Partner', options: partners.map((p: any) => ({ value: p.id, label: p.company_name ?? p.name ?? '' })) },
    { type: 'daterange', keyFrom: 'purchase_date_from', keyTo: 'purchase_date_to', label: 'Purchase Date' },
    { type: 'daterange', keyFrom: 'arrival_date_from', keyTo: 'arrival_date_to', label: 'Arrival Date' },
    { type: 'text', key: 'truckload_number', label: 'Truckload #', placeholder: 'TL-001...' },
    { type: 'text', key: 'liquidation_source', label: 'Liquidation Source', placeholder: 'B-Stock...' },
    { type: 'numrange', keyMin: 'total_msrp_min', keyMax: 'total_msrp_max', label: 'MSRP Range', prefix: '$' },
    { type: 'numrange', keyMin: 'purchase_price_min', keyMax: 'purchase_price_max', label: 'Purchase Cost', prefix: '$' },
    { type: 'numrange', keyMin: 'freight_cost_min', keyMax: 'freight_cost_max', label: 'Freight Cost', prefix: '$' },
    { type: 'boolean', key: 'open_only', label: 'Open Lots Only' },
  ];

  const filteredLots = lots.filter((lot: any) => {
    const v = filterValues;
    if (v.vendor_id && lot.vendor_id !== v.vendor_id) return false;
    if (v.funding_partner_id && lot.funding_partner_id !== v.funding_partner_id) return false;
    if (v.purchase_date_from && lot.purchase_date && lot.purchase_date < v.purchase_date_from) return false;
    if (v.purchase_date_to && lot.purchase_date && lot.purchase_date > v.purchase_date_to) return false;
    if (v.arrival_date_from && lot.arrival_date && lot.arrival_date < v.arrival_date_from) return false;
    if (v.arrival_date_to && lot.arrival_date && lot.arrival_date > v.arrival_date_to) return false;
    if (v.truckload_number && !String(lot.truckload_number ?? '').toLowerCase().includes(v.truckload_number.toLowerCase())) return false;
    if (v.liquidation_source && !String(lot.liquidation_source ?? '').toLowerCase().includes(v.liquidation_source.toLowerCase())) return false;
    if (v.total_msrp_min && Number(lot.total_msrp ?? 0) < Number(v.total_msrp_min)) return false;
    if (v.total_msrp_max && Number(lot.total_msrp ?? 0) > Number(v.total_msrp_max)) return false;
    if (v.purchase_price_min && Number(lot.purchase_price ?? 0) < Number(v.purchase_price_min)) return false;
    if (v.purchase_price_max && Number(lot.purchase_price ?? 0) > Number(v.purchase_price_max)) return false;
    if (v.freight_cost_min && Number(lot.freight_cost ?? 0) < Number(v.freight_cost_min)) return false;
    if (v.freight_cost_max && Number(lot.freight_cost ?? 0) > Number(v.freight_cost_max)) return false;
    if (v.open_only === 'true' && (lot.status === 'CLOSED' || lot.status === 'ARCHIVED')) return false;
    return true;
  });

  const openDrawer = useCallback((lot: any) => {
    setSelected(lot);
    setEditing(false);
    setDrawerError(null);
    setNotFoundMsg(null);
    setConfirm(null);
  }, []);

  // Track a pending deep-link ID separately so param removal doesn't re-trigger the effect
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  useEffect(() => {
    // Capture the ?selected param once on mount / when it changes externally
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  // Once lots finish loading, resolve the pending deep-link
  useEffect(() => {
    if (!pendingSelId.current || loading) return;
    const id = pendingSelId.current;
    pendingSelId.current = null; // consume it
    const lot = lots.find((l: any) => l.id === id);
    if (lot) {
      openDrawer(lot);
    } else {
      setNotFoundMsg('LOT not found or no longer available.');
      // Auto-clear after 5 s
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    // Remove param only after we've resolved the outcome
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [lots, loading, openDrawer, setSearchParams]);

  const closeDrawer = () => {
    setSelected(null);
    setEditing(false);
    setDrawerError(null);
    setNotFoundMsg(null);
    setConfirm(null);
  };

  const enterEdit = () => {
    if (!selected) return;
    setEditForm({
      status: (selected.status ?? 'PURCHASED').replace(/-/g, '_'),
      vendor_id: selected.vendor_id ?? '',
      funding_partner_id: selected.funding_partner_id ?? '',
      purchase_date: selected.purchase_date ? String(selected.purchase_date).slice(0, 10) : '',
      arrival_date: selected.arrival_date ? String(selected.arrival_date).slice(0, 10) : '',
      total_msrp: selected.total_msrp ?? '',
      recovery_amount: selected.recovery_amount ?? '',
      purchase_price: selected.purchase_price ?? '',
      freight_cost: selected.freight_cost ?? '',
      handling_cost: selected.handling_cost ?? '',
      manual_landed_cost_override: selected.manual_landed_cost_override ?? '',
      truckload_number: selected.truckload_number ?? '',
      pallet_count: selected.pallet_count ?? '',
      liquidation_source: selected.liquidation_source ?? '',
      notes: selected.notes ?? '',
    });
    setEditing(true);
    setDrawerError(null);
  };

  const setEF = (k: string, v: string) => setEditForm((f: any) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    setDrawerError(null);
    const { error: err } = await updateRow('lots', selected.id, {
      status: editForm.status,
      vendor_id: editForm.vendor_id || null,
      funding_partner_id: editForm.funding_partner_id || null,
      purchase_date: editForm.purchase_date || null,
      arrival_date: editForm.arrival_date || null,
      total_msrp: parseFloat(editForm.total_msrp) || null,
      recovery_amount: parseFloat(editForm.recovery_amount) || null,
      purchase_price: parseFloat(editForm.purchase_price) || null,
      freight_cost: parseFloat(editForm.freight_cost) || null,
      handling_cost: parseFloat(editForm.handling_cost) || null,
      manual_landed_cost_override: parseFloat(editForm.manual_landed_cost_override) || null,
      truckload_number: editForm.truckload_number || null,
      pallet_count: parseInt(editForm.pallet_count) || null,
      liquidation_source: editForm.liquidation_source || null,
      notes: editForm.notes || null,
    });
    if (err) { setDrawerError(err); setSaving(false); return; }
    await logActivity(orgId!, user?.id ?? '', `LOT updated`, 'lots', selected.id);
    // Reload list and fetch fresh joined data for the open drawer
    reload();
    const { data: fresh } = await supabase
      .from('lots')
      .select(LOT_SELECT)
      .eq('id', selected.id)
      .single();
    setSaving(false);
    setEditing(false);
    if (fresh) setSelected(fresh);
  };

  const handleCloseLot = async () => {
    if (!selected) return;
    setSaving(true);
    setDrawerError(null);
    const { error: err } = await updateRow('lots', selected.id, { status: 'CLOSED' });
    if (err) { setDrawerError(err); setSaving(false); return; }
    await logActivity(orgId!, user?.id ?? '', `LOT closed`, 'lots', selected.id);
    setSaving(false);
    reload();
    closeDrawer();
  };

  const handleArchiveConfirm = async () => {
    if (!selected) return;
    setConfirmLoading(true);
    const { error: err } = await updateRow('lots', selected.id, { status: 'ARCHIVED' });
    if (err) { setDrawerError(err); setConfirmLoading(false); setConfirm(null); return; }
    await logActivity(orgId!, user?.id ?? '', `LOT archived`, 'lots', selected.id);
    setConfirmLoading(false);
    setConfirm(null);
    reload();
    closeDrawer();
  };

  const handleDeleteConfirm = async () => {
    if (!selected) return;
    setConfirmLoading(true);
    const { error: err } = await deleteRow('lots', selected.id);
    if (err) { setDrawerError(err); setConfirmLoading(false); setConfirm(null); return; }
    await logActivity(orgId!, user?.id ?? '', `LOT deleted`, 'lots', selected.id);
    setConfirmLoading(false);
    setConfirm(null);
    reload();
    closeDrawer();
  };

  const handleDeleteClick = async () => {
    if (!selected) return;
    setDrawerError(null);
    const linked = await countLinked('inventory_items', 'lot_id', selected.id);
    if (linked > 0) {
      setDrawerError(`Cannot delete: this LOT has ${linked} linked inventory item${linked !== 1 ? 's' : ''}. Remove them first.`);
      return;
    }
    setConfirm({ type: 'delete' });
  };

  const lotTitle = selected
    ? `#${selected.lot_id ? selected.lot_id.toUpperCase() : selected.id.slice(0, 8).toUpperCase()}`
    : '';
  const lotSubtitle = selected ? (selected.vendors?.name ?? 'No vendor') : '';

  const drawerFooter = selected && !editing ? (
    <div className="flex flex-wrap gap-2">
      {canEdit(currentRole) && (
        <button
          onClick={enterEdit}
          className="px-3.5 py-2 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
        >
          Edit
        </button>
      )}
      {canEdit(currentRole) && selected.status !== 'CLOSED' && (
        <button
          onClick={handleCloseLot}
          disabled={saving}
          className="flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-60"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Close LOT
        </button>
      )}
      {canEdit(currentRole) && selected.status !== 'ARCHIVED' && (
        <button
          onClick={() => setConfirm({ type: 'archive' })}
          className="px-3.5 py-2 text-[13px] font-medium border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 text-gray-700 transition-colors"
        >
          Archive
        </button>
      )}
      {isAdmin(currentRole) && (
        <button
          onClick={handleDeleteClick}
          className="px-3.5 py-2 text-[13px] font-medium border border-red-200 rounded-lg hover:bg-red-50 text-red-600 transition-colors ml-auto"
        >
          Delete
        </button>
      )}
    </div>
  ) : selected && editing ? (
    <div className="flex gap-2">
      <button
        onClick={() => { setEditing(false); setDrawerError(null); }}
        className="px-3.5 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60 transition-colors"
      >
        {saving && <Loader2 size={12} className="animate-spin" />}
        Save
      </button>
    </div>
  ) : null;



  const sorted = sortItems(filteredLots, sortCol, sortDir, (item: any, col: string) => {
    if (col === 'lot_id') return item.lot_id;
    if (col === 'vendor') return item.vendors?.name;
    if (col === 'status') return item.status;
    if (col === 'msrp') return Number(item.total_msrp ?? 0);
    if (col === 'recovery') return Number(item.recovery_amount ?? 0);
    if (col === 'purchase_date') return item.purchase_date;
    if (col === 'arrival_date') return item.arrival_date;
    return null;
  });

  return (
    <div className="p-6 max-w-[1300px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">LOT Intake</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Manage incoming liquidation lots</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium"
        >
          <Plus size={13} />New LOT
        </button>
      </div>

      {notFoundMsg && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-lg text-[12px] text-amber-700">
          <span className="flex-1">{notFoundMsg}</span>
          <button onClick={() => setNotFoundMsg(null)} className="text-amber-400 hover:text-amber-600 transition-colors">✕</button>
        </div>
      )}

      {isVendorView && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">Vendors</h3>
            <button
              onClick={() => navigate('/partners/vendors')}
              className="flex items-center gap-1 text-[12px] text-[#3ECF8E] hover:underline font-medium"
            >
              Manage vendors <ExternalLink size={10} />
            </button>
          </div>
          <div className="px-5 py-2.5 bg-gray-50 border-b border-[rgba(0,0,0,0.04)]">
            <p className="text-[12px] text-gray-400">Vendors are managed from the Partners page. This is a read-only view.</p>
          </div>
          {vendLoading
            ? <div className="p-8 flex justify-center"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
            : vendors.length === 0
            ? <EmptyState title="No vendors" description="Add vendors in the Partners section." action={{ label: 'Go to Partners', onClick: () => navigate('/partners/vendors') }} />
            : <div>{vendors.map((v: any, i: number) => (
              <div key={v.id} className={`flex items-center justify-between px-5 py-3.5 ${i < vendors.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{v.name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{v.type ?? '—'}</p>
                </div>
                <StatusBadge status={v.status?.toUpperCase() ?? 'ACTIVE'} size="sm" />
              </div>
            ))}</div>
          }
        </div>
      )}

      {isFundingView && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">Funding Partners</h3>
            <button
              onClick={() => navigate('/partners/funding')}
              className="flex items-center gap-1 text-[12px] text-[#3ECF8E] hover:underline font-medium"
            >
              Manage partners <ExternalLink size={10} />
            </button>
          </div>
          <div className="px-5 py-2.5 bg-gray-50 border-b border-[rgba(0,0,0,0.04)]">
            <p className="text-[12px] text-gray-400">Funding partners are managed from the Partners page. This is a read-only view.</p>
          </div>
          {partLoading
            ? <div className="p-8 flex justify-center"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
            : partners.length === 0
            ? <EmptyState title="No funding partners" description="Add funding partners in the Partners section." action={{ label: 'Go to Partners', onClick: () => navigate('/partners/funding') }} />
            : <div>{partners.map((p: any, i: number) => (
              <div key={p.id} className={`flex items-center justify-between px-5 py-3.5 ${i < partners.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{p.company_name}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{p.profit_split_percent ? `${p.profit_split_percent}% split` : ''}</p>
                </div>
                <StatusBadge status={p.status?.toUpperCase() ?? 'ACTIVE'} size="sm" />
              </div>
            ))}</div>
          }
        </div>
      )}

      {!isVendorView && !isFundingView && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">LOTs</h3>
            <span className="text-[12px] text-gray-400">{filteredLots.length} lot{filteredLots.length !== 1 ? 's' : ''}</span>
          </div>
          <FilterBar defs={lotFilterDefs} values={filterValues} onChange={setFilterValues} />
          {loading ? (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-14 px-5 py-3 flex items-center gap-4">
                  <div className="h-4 w-32 bg-gray-100 animate-pulse rounded" />
                </div>
              ))}
            </div>
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : filteredLots.length === 0 ? (
            <EmptyState
              title="No LOTs found"
              description="Create your first LOT to get started."
              action={{ label: 'New LOT', onClick: () => setShowNew(true) }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(0,0,0,0.06)]">
                  {([
                    { label: 'LOT ID', col: 'lot_id' },
                    { label: 'Vendor', col: 'vendor' },
                    { label: 'Status', col: 'status' },
                    { label: 'Total MSRP', col: 'msrp' },
                    { label: 'Recovery', col: 'recovery' },
                    { label: 'Purchase Date', col: 'purchase_date' },
                    { label: 'Arrival Date', col: 'arrival_date' },
                  ] as const).map(({ label, col }) => (
                    <th key={col} onClick={() => handleSort(col)}
                      className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-600 transition-colors">
                      <span className="inline-flex items-center gap-1">
                        {label}
                        {sortCol === col
                          ? <span className="text-[#3ECF8E]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                          : <span className="opacity-0">↕</span>}
                      </span>
                    </th>
                  ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((lot: any, i: number) => {
                    const recovery = lot.total_msrp > 0
                      ? Math.round((Number(lot.recovery_amount || 0) / Number(lot.total_msrp)) * 100)
                      : null;
                    return (
                      <tr
                        key={lot.id}
                        onClick={() => openDrawer(lot)}
                        className={`hover:bg-gray-50/70 cursor-pointer ${i < sorted.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                      >
                        <td className="px-5 py-3 text-[12px] font-mono font-medium text-gray-900">
                          #{lot.lot_id ? lot.lot_id.toUpperCase() : lot.id.slice(0, 8).toUpperCase()}
                        </td>
                        <td className="px-5 py-3 text-[13px] text-gray-600">{lot.vendors?.name ?? '—'}</td>
                        <td className="px-5 py-3"><StatusBadge status={lot.status} size="sm" /></td>
                        <td className="px-5 py-3 text-[13px] font-medium text-gray-900 tabular-nums">
                          ${Number(lot.total_msrp || 0).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-[12px] text-[#16a34a] tabular-nums">
                          {recovery !== null ? `${recovery}%` : '—'}
                        </td>
                        <td className="px-5 py-3 text-[12px] text-gray-400">{lot.purchase_date ?? '—'}</td>
                        <td className="px-5 py-3 text-[12px] text-gray-400">{lot.arrival_date ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}


      <NewLotModal
        open={showNew}
        onClose={() => setShowNew(false)}
        orgId={orgId}
        userId={user?.id}
        vendors={vendors}
        partners={partners}
        onCreated={reload}
      />

      <ManifestImportModal
        open={showManifest}
        onClose={() => setShowManifest(false)}
        orgId={orgId}
        userId={user?.id}
        vendors={vendors}
        partners={partners}
        presets={presets ?? []}
        onCreated={reload}
      />

      {/* Lot Drawer */}
      <Drawer
        open={!!selected}
        onClose={closeDrawer}
        title={lotTitle}
        subtitle={lotSubtitle}
        footer={drawerFooter ?? undefined}
      >
        {selected && !editing && (
          <div className="space-y-0">
            <div className="mb-4">
              <StatusBadge status={selected.status} />
            </div>
            {drawerError && (
              <div className="mb-4 text-[12px] text-red-600 bg-red-50 px-3 py-2.5 rounded-lg">
                {drawerError}
              </div>
            )}
            <DetailRow label="Vendor" value={selected.vendors?.name ?? null} />
            <DetailRow label="Funding Partner" value={selected.funding_partners?.company_name ?? null} />
            <DetailRow label="Status" value={<StatusBadge status={selected.status} size="sm" />} />
            <DetailRow label="Purchase Date" value={selected.purchase_date} />
            <DetailRow label="Arrival Date" value={selected.arrival_date} />
            <DetailRow label="Total MSRP" value={fmtMoney(selected.total_msrp)} />
            <DetailRow label="Recovery Amount" value={fmtMoney(selected.recovery_amount)} />
            <DetailRow label="Purchase Price" value={fmtMoney(selected.purchase_price)} />
            <DetailRow label="Freight Cost" value={fmtMoney(selected.freight_cost)} />
            <DetailRow label="Handling Cost" value={fmtMoney(selected.handling_cost)} />
            <DetailRow label="Manual Cost Override" value={fmtMoney(selected.manual_landed_cost_override)} />
            <DetailRow label="Truckload #" value={selected.truckload_number} />
            <DetailRow label="Pallet Count" value={fmt(selected.pallet_count)} />
            <DetailRow label="Liquidation Source" value={selected.liquidation_source} />
            <DetailRow label="Notes" value={selected.notes} />
            <DetailRow
              label="Created"
              value={selected.created_at ? new Date(selected.created_at).toLocaleDateString() : null}
            />
          </div>
        )}

        {selected && editing && (
          <div className="space-y-4">
            {drawerError && (
              <div className="text-[12px] text-red-600 bg-red-50 px-3 py-2.5 rounded-lg">
                {drawerError}
              </div>
            )}
            <FormField label="Status">
              <select className={selectCls} value={editForm.status} onChange={e => setEF('status', e.target.value)}>
                {ALL_LOT_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Vendor">
              <select className={selectCls} value={editForm.vendor_id} onChange={e => setEF('vendor_id', e.target.value)}>
                <option value="">— No vendor —</option>
                {vendors.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </FormField>
            <FormField label="Funding Partner">
              <select className={selectCls} value={editForm.funding_partner_id} onChange={e => setEF('funding_partner_id', e.target.value)}>
                <option value="">— No partner —</option>
                {partners.map((p: any) => <option key={p.id} value={p.id}>{p.company_name ?? p.name}</option>)}
              </select>
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Purchase Date">
                <input type="date" className={inputCls} value={editForm.purchase_date} onChange={e => setEF('purchase_date', e.target.value)} />
              </FormField>
              <FormField label="Arrival Date">
                <input type="date" className={inputCls} value={editForm.arrival_date} onChange={e => setEF('arrival_date', e.target.value)} />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Total MSRP ($)">
                <input type="number" className={inputCls} value={editForm.total_msrp} onChange={e => setEF('total_msrp', e.target.value)} placeholder="0.00" min="0" step="0.01" />
              </FormField>
              <FormField label="Recovery Amount ($)">
                <input type="number" className={inputCls} value={editForm.recovery_amount} onChange={e => setEF('recovery_amount', e.target.value)} placeholder="0.00" min="0" step="0.01" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Purchase Price ($)">
                <input type="number" className={inputCls} value={editForm.purchase_price} onChange={e => setEF('purchase_price', e.target.value)} placeholder="0.00" min="0" step="0.01" />
              </FormField>
              <FormField label="Freight Cost ($)">
                <input type="number" className={inputCls} value={editForm.freight_cost} onChange={e => setEF('freight_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Handling Cost ($)">
                <input type="number" className={inputCls} value={editForm.handling_cost} onChange={e => setEF('handling_cost', e.target.value)} placeholder="0.00" min="0" step="0.01" />
              </FormField>
              <FormField label="Manual Cost Override ($)">
                <input type="number" className={inputCls} value={editForm.manual_landed_cost_override} onChange={e => setEF('manual_landed_cost_override', e.target.value)} placeholder="0.00" min="0" step="0.01" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Truckload #">
                <input type="text" className={inputCls} value={editForm.truckload_number} onChange={e => setEF('truckload_number', e.target.value)} placeholder="TL-001" />
              </FormField>
              <FormField label="Pallet Count">
                <input type="number" className={inputCls} value={editForm.pallet_count} onChange={e => setEF('pallet_count', e.target.value)} placeholder="0" min="0" />
              </FormField>
            </div>
            <FormField label="Liquidation Source">
              <input type="text" className={inputCls} value={editForm.liquidation_source} onChange={e => setEF('liquidation_source', e.target.value)} placeholder="e.g. B-Stock" />
            </FormField>
            <FormField label="Notes">
              <textarea className={textareaCls} rows={3} value={editForm.notes} onChange={e => setEF('notes', e.target.value)} placeholder="Optional notes..." />
            </FormField>
          </div>
        )}
      </Drawer>

      {/* Archive confirm */}
      <ConfirmDialog
        open={confirm?.type === 'archive'}
        title="Archive LOT"
        description="This LOT will be marked as archived. You can change this status later if needed."
        confirmLabel="Archive"
        onConfirm={handleArchiveConfirm}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={confirm?.type === 'delete'}
        title="Delete LOT"
        description="This action is permanent. The LOT record will be removed. This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
    </div>
  );
}
