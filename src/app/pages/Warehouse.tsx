import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { Building2, MapPin, ScanLine, Plus, Loader2, Edit2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity } from '../../lib/hooks';
import { useSecondaryView } from '../components/SecondarySidebar';
import { canEdit, isAdmin } from '../../lib/permissions';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState, ErrorState, Modal, FormField, inputCls, selectCls, textareaCls, DetailRow } from '../components/DataStates';
import { supabase } from '../../lib/supabase';
import { StatusBadge } from '../components/StatusBadge';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

// ─── Constants ────────────────────────────────────────────────────────────────

const AREA_TYPES = ['STORAGE', 'INTAKE', 'TESTING', 'PHOTOGRAPHY', 'OUTBOUND', 'RETURNS', 'HOLD', 'SCRAP'];

function buildLocCode(loc: { zone?: string | null; rack?: string | null; shelf?: string | null; bin?: string | null }): string {
  const parts = [loc.zone, loc.rack, loc.shelf, loc.bin].filter(Boolean);
  return parts.join('-') || '—';
}

// ─── Add Location Modal ────────────────────────────────────────────────────────

function AddLocationModal({ open, onClose, orgId, userId, onCreated }: any) {
  const [form, setForm] = useState({ zone: '', rack: '', shelf: '', bin: '', area_type: 'STORAGE', location_code: '', capacity: '', description: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const isStorage = form.area_type === 'STORAGE';

  const save = async () => {
    if (!form.zone) { setError('Zone is required.'); return; }
    setSaving(true); setError(null);
    const autoCode = buildLocCode({ zone: form.zone, rack: form.rack || null, shelf: form.shelf || null, bin: form.bin || null });
    const { error: err } = await insertRow('warehouse_locations', {
      organization_id: orgId,
      zone: form.zone,
      rack: form.rack || null,
      shelf: form.shelf || null,
      bin: form.bin || null,
      area_type: form.area_type || null,
      location_code: form.location_code || autoCode,
      capacity: parseInt(form.capacity) || null,
      description: form.description || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Location ${form.location_code || autoCode} added`, 'warehouse_locations');
    setSaving(false); onCreated(); onClose();
    setForm({ zone: '', rack: '', shelf: '', bin: '', area_type: 'STORAGE', location_code: '', capacity: '', description: '' });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Location"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Add Location
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Zone" required>
            <input className={inputCls} value={form.zone} onChange={e => set('zone', e.target.value)} placeholder="A, INTAKE, F..." />
          </FormField>
          <FormField label="Area Type">
            <select className={selectCls} value={form.area_type} onChange={e => set('area_type', e.target.value)}>
              {AREA_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </FormField>
        </div>
        <div className={`grid grid-cols-3 gap-3 transition-opacity ${isStorage ? 'opacity-100' : 'opacity-40'}`}>
          <FormField label={isStorage ? 'Rack' : 'Rack (optional)'}>
            <input className={inputCls} value={form.rack} onChange={e => set('rack', e.target.value)} placeholder="01" />
          </FormField>
          <FormField label={isStorage ? 'Shelf' : 'Shelf (optional)'}>
            <input className={inputCls} value={form.shelf} onChange={e => set('shelf', e.target.value)} placeholder="03" />
          </FormField>
          <FormField label={isStorage ? 'Bin' : 'Bin (optional)'}>
            <input className={inputCls} value={form.bin} onChange={e => set('bin', e.target.value)} placeholder="C" />
          </FormField>
        </div>
        {!isStorage && (
          <p className="text-[11px] text-gray-400 -mt-2">Rack, shelf, and bin are optional for non-storage areas.</p>
        )}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Location Code (optional)">
            <input className={inputCls} value={form.location_code} onChange={e => set('location_code', e.target.value)} placeholder="Auto-generated" />
          </FormField>
          <FormField label="Capacity">
            <input type="number" className={inputCls} value={form.capacity} onChange={e => set('capacity', e.target.value)} placeholder="Max items" min="1" />
          </FormField>
        </div>
        <FormField label="Description">
          <textarea className={textareaCls} rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Notes about this location..." />
        </FormField>
      </div>
    </Modal>
  );
}

// ─── Move Item Modal ───────────────────────────────────────────────────────────

function MoveItemModal({ open, onClose, orgId, userId, locations, items, onMoved }: any) {
  const [itemId, setItemId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);

  const handleScan = async () => {
    if (!scanInput.trim() || scanning || !locationId) {
      if (!locationId) setError('Select destination location first');
      return;
    }

    setScanning(true);
    setError(null);
    const input = scanInput.trim();
    let foundItemId = null;

    try {
      // Check if input contains selected=<uuid>
      const selectedMatch = input.match(/selected=([a-f0-9-]{36})/i);
      if (selectedMatch) {
        foundItemId = selectedMatch[1];
      } else {
        // Look up by inventory_id or barcode_value
        const { data: foundItems, error: lookupErr } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('organization_id', orgId)
          .or(`inventory_id.eq.${input},barcode_value.eq.${input}`);

        if (lookupErr) throw lookupErr;
        if (foundItems && foundItems.length > 0) {
          foundItemId = foundItems[0].id;
        }
      }

      if (foundItemId) {
        // Move the item
        const { error: moveErr } = await updateRow('inventory_items', foundItemId, { warehouse_location_id: locationId });
        if (moveErr) { setError(moveErr); setScanning(false); return; }

        const item = items.find((i: any) => i.id === foundItemId);
        const loc = locations.find((l: any) => l.id === locationId);
        const locCode = loc ? (loc.location_code ?? `${loc.zone}-${loc.rack}-${loc.shelf}-${loc.bin}`) : locationId;
        const itemDesc = item ? `"${item.product_title ?? item.sku ?? item.id.slice(0, 8)}"` : 'Item';
        await logActivity(orgId, userId, `${itemDesc} moved to ${locCode}`, 'warehouse_locations', locationId);

        setScanInput('');
        onMoved();
        // Keep modal open for scanning next item to same location
      } else {
        setError(`No inventory item found for: ${input}`);
      }
    } catch (err: any) {
      setError(`Scan error: ${err.message}`);
    } finally {
      setScanning(false);
    }
  };

  const move = async () => {
    if (!itemId || !locationId) { setError('Select both an item and a destination.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await updateRow('inventory_items', itemId, { warehouse_location_id: locationId });
    if (err) { setError(err); setSaving(false); return; }
    const item = items.find((i: any) => i.id === itemId);
    const loc = locations.find((l: any) => l.id === locationId);
    const locCode = loc ? (loc.location_code ?? `${loc.zone}-${loc.rack}-${loc.shelf}-${loc.bin}`) : locationId;
    const itemDesc = item ? `"${item.product_title ?? item.sku ?? item.id.slice(0, 8)}"` : 'Item';
    await logActivity(orgId, userId, `${itemDesc} moved to ${locCode}`, 'warehouse_locations', locationId);
    setSaving(false); onMoved(); onClose();
    setItemId(''); setLocationId('');
  };

  return (
    <Modal open={open} onClose={onClose} title="Move Item"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={move} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Move Item
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Destination Location" required>
          <select className={selectCls} value={locationId} onChange={e => { setLocationId(e.target.value); setError(null); }}>
            <option value="">— Select location —</option>
            {locations.map((l: any) => (
              <option key={l.id} value={l.id}>
                {l.location_code ?? buildLocCode(l)}
              </option>
            ))}
          </select>
        </FormField>
        {locationId && (
          <FormField label="Scan Inventory Label">
            <div className="relative">
              <ScanLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3ECF8E]" />
              <input
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleScan()}
                placeholder="Scan QR code or inventory ID..."
                disabled={scanning}
                className="pl-7 pr-16 py-2 text-[13px] bg-[#F0FDF4] border border-[#3ECF8E]/20 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/30 focus:border-[#3ECF8E] placeholder:text-gray-500 disabled:opacity-60"
              />
              {scanInput && (
                <button
                  onClick={handleScan}
                  disabled={scanning}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-medium bg-[#3ECF8E] text-white rounded hover:bg-[#38c484] disabled:opacity-60 transition-colors"
                >
                  {scanning ? <Loader2 size={10} className="animate-spin" /> : 'Move'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">Scan to instantly move items to selected location</p>
          </FormField>
        )}
        <div className="border-t border-gray-100 pt-4">
          <p className="text-[11px] text-gray-400 mb-3 uppercase tracking-wide">Or manually select</p>
          <FormField label="Inventory Item">
            <select className={selectCls} value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">— Select item —</option>
              {items.map((i: any) => (
                <option key={i.id} value={i.id}>
                  {i.sku ? `${i.sku} — ` : ''}{i.product_title}
                </option>
              ))}
            </select>
          </FormField>
        </div>
      </div>
    </Modal>
  );
}

// ─── Location Drawer ───────────────────────────────────────────────────────────

function LocationDrawer({
  loc,
  onClose,
  orgId,
  userId,
  currentRole,
  items,
  onRefresh,
}: {
  loc: any;
  onClose: () => void;
  orgId: string;
  userId: string;
  currentRole: any;
  items: any[];
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ type: string } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [deleteBlockMsg, setDeleteBlockMsg] = useState<string | null>(null);

  const locCode = loc.location_code ?? buildLocCode(loc);
  const itemCount = items.filter((i: any) => i.warehouse_location_id === loc.id).length;

  const startEdit = () => {
    setEditForm({
      zone: loc.zone ?? '',
      rack: loc.rack ?? '',
      shelf: loc.shelf ?? '',
      bin: loc.bin ?? '',
      location_code: loc.location_code ?? '',
      area_type: loc.area_type ?? '',
      capacity: loc.capacity != null ? String(loc.capacity) : '',
      status: loc.status ?? 'ACTIVE',
      description: loc.description ?? '',
      notes: loc.notes ?? '',
    });
    setLocError(null);
    setEditing(true);
  };

  const set = (k: string, v: string) => setEditForm((f: any) => ({ ...f, [k]: v }));

  const editIsStorage = editForm.area_type === 'STORAGE';

  const saveEdit = async () => {
    if (!editForm.zone) {
      setLocError('Zone is required.');
      return;
    }
    setSaving(true);
    setLocError(null);
    const payload: any = {
      zone: editForm.zone,
      rack: editForm.rack || null,
      shelf: editForm.shelf || null,
      bin: editForm.bin || null,
      location_code: editForm.location_code || null,
      area_type: editForm.area_type || null,
      capacity: editForm.capacity ? parseInt(editForm.capacity) : null,
      status: editForm.status || null,
      description: editForm.description || null,
      notes: editForm.notes || null,
    };
    const { error: err } = await updateRow('warehouse_locations', loc.id, payload);
    if (err) { setLocError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Location ${locCode} updated`, 'warehouse_locations', loc.id);
    setSaving(false);
    setEditing(false);
    onRefresh();
  };

  const handleDeactivate = async () => {
    setConfirmLoading(true);
    const { error: err } = await updateRow('warehouse_locations', loc.id, { status: 'INACTIVE' });
    if (!err) {
      await logActivity(orgId, userId, `Location ${locCode} deactivated`, 'warehouse_locations', loc.id);
      setConfirm(null);
      onRefresh();
      onClose();
    }
    setConfirmLoading(false);
  };

  const handleDelete = async () => {
    setConfirmLoading(true);
    const linked = await countLinked('inventory_items', 'warehouse_location_id', loc.id);
    if (linked > 0) {
      setDeleteBlockMsg(`Cannot delete: ${linked} item${linked !== 1 ? 's' : ''} assigned to this location.`);
      setConfirm(null);
      setConfirmLoading(false);
      return;
    }
    const { error: err } = await deleteRow('warehouse_locations', loc.id);
    if (!err) {
      await logActivity(orgId, userId, `Location ${locCode} deleted`, 'warehouse_locations', loc.id);
      setConfirm(null);
      onRefresh();
      onClose();
    }
    setConfirmLoading(false);
  };

  const drawerTitle = locCode;
  const drawerSubtitle = loc.area_type ?? '';

  return (
    <>
      <Drawer
        open={true}
        onClose={onClose}
        title={drawerTitle}
        subtitle={drawerSubtitle}
        footer={
          !editing ? (
            <div className="flex flex-wrap items-center gap-2">
              {deleteBlockMsg && (
                <p className="text-[12px] text-red-500 w-full mb-1">{deleteBlockMsg}</p>
              )}
              {canEdit(currentRole) && (
                <button
                  onClick={startEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  <Edit2 size={12} />Edit
                </button>
              )}
              {canEdit(currentRole) && loc.status !== 'INACTIVE' && (
                <button
                  onClick={() => setConfirm({ type: 'deactivate' })}
                  className="px-3 py-1.5 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  Deactivate
                </button>
              )}
              {isAdmin(currentRole) && (
                <button
                  onClick={() => { setDeleteBlockMsg(null); setConfirm({ type: 'delete' }); }}
                  className="ml-auto px-3 py-1.5 text-[13px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                >
                  Delete
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setEditing(false); setLocError(null); }}
                className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60 ml-auto"
              >
                {saving && <Loader2 size={12} className="animate-spin" />}Save
              </button>
            </div>
          )
        }
      >
        {!editing ? (
          <div className="space-y-0">
            {loc.status && (
              <div className="mb-4">
                <StatusBadge status={loc.status} />
              </div>
            )}
            <DetailRow label="Zone" value={loc.zone} />
            <DetailRow label="Rack" value={loc.rack} />
            <DetailRow label="Shelf" value={loc.shelf} />
            <DetailRow label="Bin" value={loc.bin} />
            <DetailRow label="Location Code" value={loc.location_code} />
            <DetailRow label="Area Type" value={loc.area_type} />
            <DetailRow label="Capacity" value={loc.capacity != null ? loc.capacity : null} />
            <DetailRow label="Status" value={loc.status} />
            <DetailRow label="Description" value={loc.description} />
            <DetailRow label="Notes" value={loc.notes} />
            <DetailRow
              label="Created"
              value={loc.created_at ? new Date(loc.created_at).toLocaleDateString() : null}
            />
            <DetailRow
              label="Items in Location"
              value={
                <span className={itemCount > 0 ? 'text-[#15803d] font-medium' : 'text-gray-400'}>
                  {itemCount} item{itemCount !== 1 ? 's' : ''}
                </span>
              }
            />
          </div>
        ) : (
          <div className="space-y-4">
            {locError && (
              <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{locError}</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Zone" required>
                <input className={inputCls} value={editForm.zone} onChange={e => set('zone', e.target.value)} placeholder="A, INTAKE, F..." />
              </FormField>
              <FormField label="Area Type">
                <select className={selectCls} value={editForm.area_type} onChange={e => set('area_type', e.target.value)}>
                  {AREA_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </FormField>
            </div>
            <div className={`grid grid-cols-3 gap-3 transition-opacity ${editIsStorage ? 'opacity-100' : 'opacity-40'}`}>
              <FormField label={editIsStorage ? 'Rack' : 'Rack (optional)'}>
                <input className={inputCls} value={editForm.rack} onChange={e => set('rack', e.target.value)} placeholder="01" />
              </FormField>
              <FormField label={editIsStorage ? 'Shelf' : 'Shelf (optional)'}>
                <input className={inputCls} value={editForm.shelf} onChange={e => set('shelf', e.target.value)} placeholder="03" />
              </FormField>
              <FormField label={editIsStorage ? 'Bin' : 'Bin (optional)'}>
                <input className={inputCls} value={editForm.bin} onChange={e => set('bin', e.target.value)} placeholder="C" />
              </FormField>
            </div>
            {!editIsStorage && (
              <p className="text-[11px] text-gray-400 -mt-2">Rack, shelf, and bin are optional for non-storage areas.</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Location Code">
                <input className={inputCls} value={editForm.location_code} onChange={e => set('location_code', e.target.value)} placeholder="Auto-generated" />
              </FormField>
              <FormField label="Capacity">
                <input type="number" className={inputCls} value={editForm.capacity} onChange={e => set('capacity', e.target.value)} placeholder="Max items" min="1" />
              </FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Status">
                <select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                  <option value="RESERVED">RESERVED</option>
                </select>
              </FormField>
            </div>
            <FormField label="Description">
              <textarea className={textareaCls} rows={2} value={editForm.description} onChange={e => set('description', e.target.value)} placeholder="Description..." />
            </FormField>
            <FormField label="Notes">
              <textarea className={textareaCls} rows={2} value={editForm.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes..." />
            </FormField>
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirm?.type === 'deactivate'}
        title="Deactivate Location"
        description={`Are you sure you want to deactivate ${locCode}? It will no longer accept new items.`}
        confirmLabel="Deactivate"
        onConfirm={handleDeactivate}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />

      <ConfirmDialog
        open={confirm?.type === 'delete'}
        title="Delete Location"
        description={`Permanently delete ${locCode}? This cannot be undone.`}
        confirmLabel="Delete"
        danger={true}
        onConfirm={handleDelete}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
    </>
  );
}

// ─── Main Warehouse Page ───────────────────────────────────────────────────────

export function Warehouse() {
  const view = useSecondaryView();
  const { orgId, user, currentRole } = useAuth();
  const [showAdd, setShowAdd] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedLoc, setSelectedLoc] = useState<any>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: locations, loading, error, reload } = useOrgQuery<any>('warehouse_locations', orgId, {
    select: 'id, zone, rack, shelf, bin, location_code, area_type, capacity, status, description, notes, created_at',
  });

  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  // Capture ?selected param
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  // Open location detail from ?selected=<location_uuid> after locations load
  useEffect(() => {
    if (!pendingSelId.current || loading) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const loc = locations.find((l: any) => l.id === id);
    if (loc) {
      setSelectedLoc(loc);
    } else {
      setNotFoundMsg('Location not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [locations, loading, setSearchParams]);

  const { data: items, reload: reloadItems } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, sku, product_title, status, warehouse_location_id, warehouse_locations(zone, rack, shelf, bin, location_code)',
  });

  const { data: activity } = useOrgQuery<any>('activity_log', orgId, {
    select: 'id, message, created_at, actor_id',
    filter: (q: any) => q.eq('entity_type', 'warehouse_locations').order('created_at', { ascending: false }).limit(20),
  });

  const zones = Array.from(new Set(locations.map((l: any) => l.zone))).sort();
  const activeZone = selectedZone ?? zones[0] ?? null;

  const zoneLocations = locations.filter((l: any) => l.zone === activeZone);

  const occupiedInZone = (zone: string) =>
    items.filter((i: any) => i.warehouse_locations?.zone === zone).length;

  const showZones = view === 'overview' || view === 'all';
  const showMap = view === 'overview' || view === 'all';
  const showMovements = view === 'overview' || view === 'movements' || view === 'all';

  const handleCreated = () => { reload(); };
  const handleMoved = () => { reload(); reloadItems(); };
  const handleLocRefresh = async () => {
    await reload();
    await reloadItems();
    // Keep drawer open with refreshed data
    if (selectedLoc) {
      const fresh = locations.find((l: any) => l.id === selectedLoc.id);
      if (fresh) setSelectedLoc(fresh);
    }
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Warehouse</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Zone → Rack → Shelf → Bin hierarchy</p>
          <p className="text-[11px] text-gray-300 mt-0.5">Click a location to view, edit, deactivate, or delete.</p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setShowMove(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 hover:bg-gray-50">
            <ScanLine size={13} />Move Item
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Add Location
          </button>
        </div>
      </div>

      {notFoundMsg && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-lg text-[12px] text-amber-700">
          <span className="flex-1">{notFoundMsg}</span>
          <button onClick={() => setNotFoundMsg(null)} className="text-amber-400 hover:text-amber-600 transition-colors">✕</button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[1,2,3,4,5].map(i => <div key={i} className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-4 h-28 animate-pulse bg-gray-50" />)}
        </div>
      ) : error ? <ErrorState message={error} onRetry={reload} />
      : locations.length === 0 ? (
        <EmptyState title="No locations" description="Add your first warehouse location." action={{ label: 'Add Location', onClick: () => setShowAdd(true) }} />
      ) : (
        <>
          {showZones && zones.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {zones.map((zone: any) => {
                const zoneItems = occupiedInZone(zone);
                const zoneLocs = locations.filter((l: any) => l.zone === zone);
                const capacity = zoneLocs.reduce((sum: number, l: any) => sum + (l.capacity ?? 0), 0);
                const pct = capacity > 0 ? Math.round((zoneItems / capacity) * 100) : null;
                const isSelected = activeZone === zone;
                return (
                  <button key={zone} onClick={() => setSelectedZone(zone)}
                    className={`bg-white rounded-xl border p-4 text-left hover:shadow-sm transition-all ${isSelected ? 'border-[#3ECF8E] ring-2 ring-[#3ECF8E]/20' : 'border-[rgba(0,0,0,0.07)]'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center">
                        <Building2 size={13} className="text-gray-500" />
                      </div>
                      <span className="text-[11px] font-mono text-gray-400">{zone}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-gray-900">{zone}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{zoneLocs.length} locations</p>
                    <div className="mt-3">
                      {capacity > 0 ? (
                        <>
                          <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1">
                            <span>{zoneItems} items</span>
                            <span>{pct}%</span>
                          </div>
                          <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${pct! > 85 ? 'bg-amber-400' : 'bg-[#3ECF8E]'}`} style={{ width: `${Math.min(pct!, 100)}%` }} />
                          </div>
                        </>
                      ) : (
                        <p className="text-[11px] text-gray-400">{zoneItems} items · No capacity set</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {showMap && activeZone && (
              <div className="lg:col-span-2 bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <MapPin size={13} className="text-[#3ECF8E]" />
                  <h3 className="text-[13px] font-semibold text-gray-900">Zone {activeZone}</h3>
                  <span className="ml-auto text-[11px] text-gray-400">{zoneLocations.length} locations · {occupiedInZone(activeZone)} occupied</span>
                </div>
                {zoneLocations.length === 0 ? (
                  <p className="text-[13px] text-gray-400 py-8 text-center">No locations in this zone.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 min-w-[300px]">
                      {zoneLocations.map((loc: any) => {
                        const occupied = items.some((i: any) => i.warehouse_location_id === loc.id);
                        return (
                          <button
                            key={loc.id}
                            onClick={() => setSelectedLoc(loc)}
                            title={loc.location_code ?? buildLocCode(loc)}
                            className={`group relative rounded-lg p-2.5 border text-center transition-colors hover:shadow-sm ${occupied ? 'bg-[#ECFDF5] border-[#BBF7D0]' : 'bg-gray-50 border-[rgba(0,0,0,0.07)]'}`}>
                            <p className="text-[11px] font-mono font-medium text-gray-700">{loc.location_code ?? buildLocCode({ rack: loc.rack, shelf: loc.shelf, bin: loc.bin })}</p>
                            {occupied && <p className="text-[10px] text-[#15803d] mt-0.5">occupied</p>}
                            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Edit2 size={10} className="text-gray-400" />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[rgba(0,0,0,0.06)]">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-[#ECFDF5] border border-[#BBF7D0]" /><span className="text-[11px] text-gray-500">Occupied</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gray-100 border border-[rgba(0,0,0,0.07)]" /><span className="text-[11px] text-gray-500">Empty</span></div>
                </div>
              </div>
            )}

            {showMovements && (
              <div className={`bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5 ${!showMap ? 'lg:col-span-3' : ''}`}>
                <h3 className="text-[13px] font-semibold text-gray-900 mb-4">Movement History</h3>
                {activity.length === 0 ? (
                  <p className="text-[13px] text-gray-400 text-center py-6">No movements recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {activity.slice(0, 8).map((act: any, i: number) => (
                      <div key={act.id} className={`py-3 ${i < Math.min(activity.length, 8) - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[12px] text-gray-700 truncate pr-2">{act.message}</span>
                          <span className="text-[11px] text-gray-400 whitespace-nowrap">{new Date(act.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {(view === 'locations' || view === 'all') && (
            <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)]">
                <h3 className="text-[13px] font-semibold text-gray-900">All Locations</h3>
              </div>
              {(() => {
                const warehouseFilterDefs: FilterDef[] = [
                  { type: 'select', key: 'area_type', label: 'Area Type', options: AREA_TYPES.map(t => ({ value: t, label: t })) },
                  { type: 'text', key: 'zone', label: 'Zone', placeholder: 'A, INTAKE...' },
                  { type: 'text', key: 'rack', label: 'Rack', placeholder: '01...' },
                  { type: 'text', key: 'shelf', label: 'Shelf', placeholder: '03...' },
                  { type: 'text', key: 'bin', label: 'Bin', placeholder: 'C...' },
                  { type: 'boolean', key: 'storage_only', label: 'Storage Only' },
                  { type: 'boolean', key: 'workflow_only', label: 'Workflow Only' },
                  { type: 'numrange', keyMin: 'count_min', keyMax: 'count_max', label: 'Item Count' },
                ];
                const filteredLocations = locations.filter((loc: any) => {
                  const v = filterValues;
                  if (v.area_type && loc.area_type !== v.area_type) return false;
                  if (v.zone && !String(loc.zone ?? '').toLowerCase().includes(v.zone.toLowerCase())) return false;
                  if (v.rack && !String(loc.rack ?? '').toLowerCase().includes(v.rack.toLowerCase())) return false;
                  if (v.shelf && !String(loc.shelf ?? '').toLowerCase().includes(v.shelf.toLowerCase())) return false;
                  if (v.bin && !String(loc.bin ?? '').toLowerCase().includes(v.bin.toLowerCase())) return false;
                  if (v.storage_only === 'true' && loc.area_type !== 'STORAGE') return false;
                  if (v.workflow_only === 'true' && loc.area_type === 'STORAGE') return false;
                  const occ = items.filter((item: any) => item.warehouse_location_id === loc.id).length;
                  if (v.count_min && occ < Number(v.count_min)) return false;
                  if (v.count_max && occ > Number(v.count_max)) return false;
                  return true;
                });
                return (
                  <>
                    <FilterBar defs={warehouseFilterDefs} values={filterValues} onChange={setFilterValues} />
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-[rgba(0,0,0,0.06)]">
                            {['Location', 'Code', 'Area Type', 'Capacity', 'Occupied', 'Status', 'Description', ''].map(h => (
                              <th key={h} className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLocations.map((loc: any, i: number) => {
                            const occ = items.filter((item: any) => item.warehouse_location_id === loc.id).length;
                            return (
                              <tr
                                key={loc.id}
                                onClick={() => setSelectedLoc(loc)}
                                className={`group/row hover:bg-gray-50/70 cursor-pointer ${i < filteredLocations.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                              >
                          <td className="px-5 py-3 text-[13px] text-gray-700">
                            {loc.area_type && loc.area_type !== 'STORAGE'
                              ? `${loc.area_type} · ${loc.zone}`
                              : buildLocCode(loc)}
                          </td>
                          <td className="px-5 py-3 text-[12px] font-mono text-gray-600">{loc.location_code ?? '—'}</td>
                          <td className="px-5 py-3 text-[13px] text-gray-600">{loc.area_type ?? '—'}</td>
                          <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">{loc.capacity ?? '—'}</td>
                          <td className="px-5 py-3 text-[13px] tabular-nums">
                            <span className={occ > 0 ? 'text-[#15803d] font-medium' : 'text-gray-400'}>{occ}</span>
                          </td>
                          <td className="px-5 py-3">
                            {loc.status ? <StatusBadge status={loc.status} /> : <span className="text-[13px] text-gray-400">—</span>}
                          </td>
                          <td className="px-5 py-3 text-[12px] text-gray-400 max-w-[200px] truncate">{loc.description ?? '—'}</td>
                          <td className="px-5 py-3">
                            <button
                              onClick={e => { e.stopPropagation(); setSelectedLoc(loc); }}
                              className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-500 border border-[rgba(0,0,0,0.1)] rounded-md hover:bg-gray-100 transition-colors opacity-0 group-hover/row:opacity-100"
                            >
                              <Edit2 size={11} />Edit
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      <AddLocationModal open={showAdd} onClose={() => setShowAdd(false)} orgId={orgId} userId={user?.id} onCreated={handleCreated} />
      <MoveItemModal open={showMove} onClose={() => setShowMove(false)} orgId={orgId} userId={user?.id} locations={locations} items={items} onMoved={handleMoved} />

      {selectedLoc && (
        <LocationDrawer
          loc={selectedLoc}
          onClose={() => setSelectedLoc(null)}
          orgId={orgId!}
          userId={user?.id!}
          currentRole={currentRole}
          items={items}
          onRefresh={handleLocRefresh}
        />
      )}
    </div>
  );
}
