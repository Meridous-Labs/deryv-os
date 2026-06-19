import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Search, RefreshCw, Plus, Loader2, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, logActivity } from '../../lib/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEdit, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

const MARKETPLACE_OPTIONS = [
  { value: 'EBAY', label: 'eBay' },
  { value: 'SHOPIFY', label: 'Shopify' },
  { value: 'AMAZON', label: 'Amazon' },
  { value: 'DIRECT', label: 'Direct' },
  { value: 'WHATNOT', label: 'Whatnot' },
];
const MARKETPLACE_LABEL: Record<string, string> = Object.fromEntries(
  MARKETPLACE_OPTIONS.map(o => [o.value, o.label])
);

const LIST_STATUSES = ['PENDING','ACTIVE','SOLD','ENDED','ERROR'];

function NewListingModal({ open, onClose, orgId, userId, items, onCreated }: any) {
  const [form, setForm] = useState({
    inventory_item_id: '',
    channel: 'EBAY',
    title: '',
    price: '',
    status: 'PENDING',
    listing_url: '',
    marketplace_listing_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.inventory_item_id) { setError('An inventory item is required.'); return; }
    if (!form.title || !form.price || !form.channel) { setError('Title, price and channel are required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('marketplace_listings', {
      organization_id: orgId,
      inventory_item_id: form.inventory_item_id,
      channel: form.channel,
      title: form.title,
      price: parseFloat(form.price) || 0,
      status: form.status,
      sync_status: 'PENDING',
      listing_url: form.listing_url || null,
      marketplace_listing_id: form.marketplace_listing_id || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Listing created on ${MARKETPLACE_LABEL[form.channel] ?? form.channel}`, 'marketplace_listings');
    setSaving(false); onCreated(); onClose();
    setForm({ inventory_item_id: '', channel: 'EBAY', title: '', price: '', status: 'PENDING', listing_url: '', marketplace_listing_id: '' });
  };

  return (
    <Modal open={open} onClose={onClose} title="New Listing"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Create Listing
        </button>
      </>}>
      <div className="space-y-3">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Inventory Item" required>
          <select className={selectCls} value={form.inventory_item_id}
            onChange={e => set('inventory_item_id', e.target.value)}>
            <option value="">— Select item —</option>
            {items.map((i: any) => <option key={i.id} value={i.id}>{i.product_title}</option>)}
          </select>
        </FormField>
        <FormField label="Listing Title" required><input className={inputCls} value={form.title} onChange={e => set('title', e.target.value)} placeholder="Apple iPhone 15 Pro 128GB..." /></FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Channel" required>
            <select className={selectCls} value={form.channel} onChange={e => set('channel', e.target.value)}>
              {MARKETPLACE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </FormField>
          <FormField label="Price ($)" required><input type="number" className={inputCls} value={form.price} onChange={e => set('price', e.target.value)} placeholder="0.00" min="0" step="0.01" /></FormField>
        </div>
        <FormField label="Listing URL"><input className={inputCls} value={form.listing_url} onChange={e => set('listing_url', e.target.value)} placeholder="https://..." /></FormField>
        <FormField label="Marketplace Listing ID"><input className={inputCls} value={form.marketplace_listing_id} onChange={e => set('marketplace_listing_id', e.target.value)} placeholder="External ID from marketplace" /></FormField>
        <FormField label="Status"><select className={selectCls} value={form.status} onChange={e => set('status', e.target.value)}>{LIST_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
      </div>
    </Modal>
  );
}

function ListingDrawer({ listing, onClose, orgId, userId, role, items, listings, onUpdated }: any) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    title: listing.title,
    channel: listing.channel,
    price: String(listing.price ?? ''),
    status: listing.status,
    listing_url: listing.listing_url ?? '',
    marketplace_listing_id: listing.marketplace_listing_id ?? '',
    sync_status: listing.sync_status ?? 'PENDING',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'end' | 'delete'>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  const saveEdit = async () => {
    if (!editForm.title || !editForm.price) { setError('Title and price are required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await updateRow('marketplace_listings', listing.id, {
      title: editForm.title,
      channel: editForm.channel,
      price: parseFloat(editForm.price) || 0,
      status: editForm.status,
      listing_url: editForm.listing_url || null,
      marketplace_listing_id: editForm.marketplace_listing_id || null,
      sync_status: editForm.sync_status,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Listing "${listing.title}" updated`, 'marketplace_listings', listing.id);
    setSaving(false);
    setEditing(false);
    // Reload and keep drawer open with fresh data
    await onUpdated();
  };

  const handleEnd = async () => {
    setConfirmLoading(true);
    await updateRow('marketplace_listings', listing.id, { status: 'ENDED' });
    await logActivity(orgId, userId, `Listing "${listing.title}" ended`, 'marketplace_listings', listing.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const handleDelete = async () => {
    // Block delete if listing has SOLD status
    if (listing.status === 'SOLD') {
      setError('Cannot delete a SOLD listing.');
      setConfirm(null);
      setConfirmLoading(false);
      return;
    }
    // Only allow delete for PENDING, ERROR, or ENDED
    if (!['PENDING', 'ERROR', 'ENDED'].includes(listing.status)) {
      setError('Can only delete PENDING, ERROR, or ENDED listings. End active listings first.');
      setConfirm(null);
      setConfirmLoading(false);
      return;
    }
    setConfirmLoading(true);
    const { error: delErr } = await deleteRow('marketplace_listings', listing.id);
    if (delErr) {
      setError(`Failed to delete listing: ${delErr}`);
      setConfirmLoading(false);
      setConfirm(null);
      return;
    }
    await logActivity(orgId, userId, `Listing "${listing.title}" deleted`, 'marketplace_listings', listing.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const canEditListing = canEdit(role);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={editing ? 'Edit Listing' : 'Listing Details'}
        subtitle={listing.inventory_items?.sku ? `SKU: ${listing.inventory_items.sku}` : undefined}
        footer={editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(false); setError(null); }} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
              {saving && <Loader2 size={12} className="animate-spin" />}Save Changes
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {canEditListing && listing.status === 'ACTIVE' && (
              <button onClick={() => setConfirm('end')} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                End Listing
              </button>
            )}
            {isAdmin(role) && ['PENDING', 'ERROR', 'ENDED'].includes(listing.status) && (
              <button onClick={() => setConfirm('delete')} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                <Trash2 size={13} />Delete
              </button>
            )}
            {canEditListing && (
              <button
                onClick={() => {
                  setEditing(true);
                  setEditForm({
                    title: listing.title,
                    channel: listing.channel,
                    price: String(listing.price ?? ''),
                    status: listing.status,
                    listing_url: listing.listing_url ?? '',
                    marketplace_listing_id: listing.marketplace_listing_id ?? '',
                    sync_status: listing.sync_status ?? 'PENDING',
                  });
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg"
              >
                <Pencil size={13} />Edit
              </button>
            )}
          </div>
        )}
      >
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}
        {editing ? (
          <div className="space-y-4">
            <FormField label="Listing Title" required>
              <input className={inputCls} value={editForm.title} onChange={e => set('title', e.target.value)} />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Channel" required>
                <select className={selectCls} value={editForm.channel} onChange={e => set('channel', e.target.value)}>
                  {MARKETPLACE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </FormField>
              <FormField label="Price ($)" required>
                <input type="number" className={inputCls} value={editForm.price} onChange={e => set('price', e.target.value)} min="0" step="0.01" />
              </FormField>
            </div>
            <FormField label="Listing URL">
              <input className={inputCls} value={editForm.listing_url} onChange={e => set('listing_url', e.target.value)} placeholder="https://..." />
            </FormField>
            <FormField label="Marketplace Listing ID">
              <input className={inputCls} value={editForm.marketplace_listing_id} onChange={e => set('marketplace_listing_id', e.target.value)} placeholder="External ID" />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Status">
                <select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>
                  {LIST_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="Sync Status">
                <select className={selectCls} value={editForm.sync_status} onChange={e => set('sync_status', e.target.value)}>
                  {['PENDING', 'SYNCED', 'ERROR'].map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
            </div>
          </div>
        ) : (
          <div>
            <DetailRow label="Title" value={listing.title} />
            <DetailRow label="Channel" value={
              <div className="flex items-center gap-1.5">
                <span>{MARKETPLACE_LABEL[listing.channel] ?? listing.channel}</span>
                {listing.listing_url && (
                  <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-[#3ECF8E] hover:opacity-80">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            } />
            <DetailRow label="Listing URL" value={listing.listing_url ? <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-[#3ECF8E] hover:underline text-[12px]">{listing.listing_url}</a> : null} />
            <DetailRow label="Marketplace Listing ID" value={listing.marketplace_listing_id} />
            <DetailRow label="Price" value={`$${Number(listing.price || 0).toFixed(2)}`} />
            <DetailRow label="Status" value={<StatusBadge status={listing.status} size="sm" />} />
            <DetailRow label="Sync Status" value={<StatusBadge status={listing.sync_status ?? 'PENDING'} size="sm" />} />
            <DetailRow label="Views" value={listing.views ?? 0} />
            <DetailRow label="Published" value={listing.published_at ? new Date(listing.published_at).toLocaleDateString() : null} />
            <DetailRow label="Created" value={new Date(listing.created_at).toLocaleDateString()} />
            {listing.inventory_items && (
              <>
                <div className="border-t border-[rgba(0,0,0,0.06)] my-3 pt-3">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Inventory Item</p>
                </div>
                <DetailRow label="Inventory ID" value={listing.inventory_items.inventory_id} />
                <DetailRow label="Product Title" value={listing.inventory_items.product_title} />
                <DetailRow label="SKU" value={listing.inventory_items.sku} />
                <DetailRow label="Brand" value={listing.inventory_items.brand} />
                <DetailRow label="Category" value={listing.inventory_items.category} />
                {listing.inventory_items.lots?.lot_id && (
                  <DetailRow label="LOT ID" value={listing.inventory_items.lots.lot_id} />
                )}
              </>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirm === 'end'}
        title="End Listing"
        description="Mark this listing as ended? It will no longer be shown as active."
        confirmLabel="End Listing"
        onConfirm={handleEnd}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete Listing"
        description="Permanently delete this listing? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
    </>
  );
}

const VIEW_FILTER: Record<string, (q: any) => any> = {
  active: (q: any) => q.eq('status', 'ACTIVE'),
  pending: (q: any) => q.or('sync_status.eq.PENDING,status.eq.PENDING'),
  sold: (q: any) => q.eq('status', 'SOLD'),
  error: (q: any) => q.eq('sync_status', 'ERROR'),
  ebay: (q: any) => q.eq('channel', 'EBAY'),
  shopify: (q: any) => q.eq('channel', 'SHOPIFY'),
};


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
export function Marketplace() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const _sortInit = (() => { try { return JSON.parse(localStorage.getItem('deryv.sort.marketplace') ?? 'null') ?? {}; } catch { return {}; } })();
  const [sortCol, setSortCol] = useState<string | null>(_sortInit.col ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_sortInit.dir ?? 'asc');
  const handleSort = (col: string) => {
    const next = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    const nextCol = sortCol === col ? col : col;
    setSortCol(nextCol);
    setSortDir(next as 'asc' | 'desc');
    localStorage.setItem('deryv.sort.marketplace', JSON.stringify({ col: nextCol, dir: next }));
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  // Watch for new selected param
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  const { data: listings, loading, error, reload } = useOrgQuery<any>('marketplace_listings', orgId, {
    select: 'id, title, channel, price, status, sync_status, views, published_at, created_at, listing_url, marketplace_listing_id, inventory_items(id, inventory_id, product_title, sku, brand, category, lot_id, lots(lot_id))',
    filter: VIEW_FILTER[view],
  });

  // Handle deep-link after listings load
  useEffect(() => {
    if (!pendingSelId.current || listings.length === 0) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const listing = listings.find((l: any) => l.id === id);
    if (listing) {
      setSelectedId(id);
    } else {
      setNotFoundMsg('Listing not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [listings, setSearchParams]);

  const { data: items } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, product_title, current_asking_price',
    filter: (q: any) => q.in('status', ['LISTING', 'ACTIVE']),
  });

  const { data: lots } = useOrgQuery<any>('lots', orgId, { select: 'id, lot_id, vendor_id, funding_partner_id' });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name' });
  const { data: partners } = useOrgQuery<any>('partners', orgId, { select: 'id, company_name' });

  const distinctBrands = Array.from(new Set(listings.map((i: any) => i.inventory_items?.brand).filter(Boolean))).sort() as string[];
  const distinctCats = Array.from(new Set(listings.map((i: any) => i.inventory_items?.category).filter(Boolean))).sort() as string[];

  const mktFilterDefs: FilterDef[] = [
    { type: 'select', key: 'channel', label: 'Channel', options: MARKETPLACE_OPTIONS },
    { type: 'select', key: 'brand', label: 'Brand', options: distinctBrands.map(b => ({ value: b, label: b })) },
    { type: 'select', key: 'category', label: 'Category', options: distinctCats.map(c => ({ value: c, label: c })) },
    { type: 'select', key: 'lot_id', label: 'LOT', options: lots.map((l: any) => ({ value: l.id, label: l.lot_id || l.id })) },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.name })) },
    { type: 'select', key: 'funding_partner_id', label: 'Funding Partner', options: partners.map((p: any) => ({ value: p.id, label: p.company_name })) },
    { type: 'numrange', keyMin: 'price_min', keyMax: 'price_max', label: 'Price', prefix: '$' },
    { type: 'boolean', key: 'missing_url', label: 'Missing Listing URL' },
    { type: 'boolean', key: 'missing_marketplace_id', label: 'Missing Marketplace ID' },
    { type: 'boolean', key: 'sync_errors_only', label: 'Sync Errors Only' },
  ];

  const lotById = new Map(lots.map((l: any) => [l.id, l]));

  const searchFiltered = listings.filter((l: any) =>
    !search || l.title?.toLowerCase().includes(search.toLowerCase())
  );

  const filtered = searchFiltered.filter((listing: any) => {
    const v = filterValues;
    if (v.channel && listing.channel !== v.channel) return false;
    const itemBrand = listing.inventory_items?.brand;
    const itemCat = listing.inventory_items?.category;
    if (v.brand && itemBrand !== v.brand) return false;
    if (v.category && itemCat !== v.category) return false;
    const lotId = listing.inventory_items?.lot_id;
    const lot = lotById.get(lotId);
    if (v.lot_id && lotId !== v.lot_id) return false;
    if (v.vendor_id && lot?.vendor_id !== v.vendor_id) return false;
    if (v.funding_partner_id && lot?.funding_partner_id !== v.funding_partner_id) return false;
    if (v.price_min && Number(listing.price ?? 0) < Number(v.price_min)) return false;
    if (v.price_max && Number(listing.price ?? 0) > Number(v.price_max)) return false;
    if (v.missing_url === 'true' && listing.listing_url) return false;
    if (v.missing_marketplace_id === 'true' && listing.marketplace_listing_id) return false;
    if (v.sync_errors_only === 'true' && listing.sync_status !== 'ERROR') return false;
    return true;
  });

  const selectedListing = listings.find(l => l.id === selectedId) ?? null;



  const sorted = sortItems(filtered, sortCol, sortDir, (item: any, col: string) => {
    if (col === 'title') return item.title;
    if (col === 'channel') return item.channel;
    if (col === 'price') return Number(item.price ?? 0);
    if (col === 'status') return item.status;
    if (col === 'sync') return item.sync_status;
    if (col === 'views') return Number(item.views ?? 0);
    if (col === 'published') return item.published_at;
    return null;
  });

  return (
    <div className="p-3 sm:p-6 max-w-[1300px] space-y-5">
      {notFoundMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">
          {notFoundMsg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Marketplace</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Listings across all channels</p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={reload} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 hover:bg-gray-50">
            <RefreshCw size={13} />Refresh
          </button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />New Listing
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)] flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search listings..."
              className="pl-7 pr-3 py-1.5 text-[13px] bg-gray-50 border border-[rgba(0,0,0,0.08)] rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400" />
          </div>
          <span className="text-[12px] text-gray-400 ml-auto">{filtered.length} listings</span>
        </div>

        <FilterBar defs={mktFilterDefs} values={filterValues} onChange={setFilterValues} />

        {loading ? (
          <div className="divide-y divide-[rgba(0,0,0,0.04)]">{[1,2,3,4].map(i => <div key={i} className="h-12 px-5 py-3 flex items-center"><div className="h-4 w-48 bg-gray-100 animate-pulse rounded" /></div>)}</div>
        ) : error ? <ErrorState message={error} onRetry={reload} />
        : filtered.length === 0 ? (
          <EmptyState title="No listings found" description={search ? 'Try a different search.' : 'Create your first listing.'} action={!search ? { label: 'New Listing', onClick: () => setShowNew(true) } : undefined} />
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-[rgba(0,0,0,0.05)]">
              {filtered.map((listing: any) => (
                <div key={listing.id} onClick={() => setSelectedId(listing.id)}
                  className={`px-3 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer ${selectedId === listing.id ? 'bg-[#F0FDF4]' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{listing.title}</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">{listing.inventory_items?.sku ?? ''} · {MARKETPLACE_LABEL[listing.channel] ?? listing.channel}</p>
                    </div>
                    <p className="text-[14px] font-semibold text-gray-900 flex-shrink-0">${Number(listing.price).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <StatusBadge status={listing.status} size="sm" />
                    <StatusBadge status={listing.sync_status ?? 'PENDING'} size="sm" />
                    <span className="text-[11px] text-gray-400">{listing.views ?? 0} views</span>
                  </div>
                </div>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(0,0,0,0.06)]">
                    {([
                        { label: 'Title', col: 'title' },
                        { label: 'Channel', col: 'channel' },
                        { label: 'Price', col: 'price' },
                        { label: 'Status', col: 'status' },
                        { label: 'Sync', col: 'sync' },
                        { label: 'Views', col: 'views' },
                        { label: 'Published', col: 'published' },
                    ] as const).map(({ label, col }) => (
                      <th key={col} onClick={() => handleSort(col)}
                        className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-gray-600 transition-colors">
                        <span className="inline-flex items-center gap-1">
                          {label}
                          {sortCol === col ? <span className="text-[#3ECF8E]">{sortDir === 'asc' ? '↑' : '↓'}</span> : <span className="opacity-0">↕</span>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((listing: any, i: number) => (
                    <tr
                      key={listing.id}
                      onClick={() => setSelectedId(listing.id)}
                      className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedId === listing.id ? 'bg-[#F0FDF4]' : ''} ${i < sorted.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                    >
                      <td className="px-5 py-3 max-w-[220px]">
                        <p className="text-[13px] font-medium text-gray-900 truncate">{listing.title}</p>
                        <p className="text-[11px] text-gray-400">{listing.inventory_items?.sku ?? ''}</p>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-[11px] font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded-full">
                          {MARKETPLACE_LABEL[listing.channel] ?? listing.channel}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[13px] font-semibold text-gray-900 tabular-nums">${Number(listing.price).toFixed(2)}</td>
                      <td className="px-5 py-3"><StatusBadge status={listing.status} size="sm" /></td>
                      <td className="px-5 py-3"><StatusBadge status={listing.sync_status ?? 'PENDING'} size="sm" /></td>
                      <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">{listing.views ?? 0}</td>
                      <td className="px-5 py-3 text-[12px] text-gray-400">{listing.published_at ? new Date(listing.published_at).toLocaleDateString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>


      <NewListingModal open={showNew} onClose={() => setShowNew(false)} orgId={orgId} userId={user?.id} items={items} onCreated={reload} />
      {selectedListing && (
        <ListingDrawer
          listing={selectedListing}
          onClose={() => setSelectedId(null)}
          orgId={orgId}
          userId={user?.id}
          role={role}
          items={items}
          listings={listings}
          onUpdated={async () => {
            await reload();
            // Keep drawer open with refreshed data - selectedListing will update via selectedId
          }}
        />
      )}
    </div>
  );
}
