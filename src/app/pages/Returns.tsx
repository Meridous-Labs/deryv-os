import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { CheckCircle, XCircle, RotateCcw, Camera, Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, logActivity, createNotification } from '../../lib/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEditOps, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

const RETURN_STATUSES = ['INSPECTION','RESTOCKED','RELISTED','SCRAPPED'];
const VIEW_STATUS: Record<string, string> = {
  inspection: 'INSPECTION', restocked: 'RESTOCKED', relisted: 'RELISTED', scrapped: 'SCRAPPED',
};

function CreateReturnModal({ open, onClose, orgId, userId, orders, items, onCreated }: any) {
  const [form, setForm] = useState({
    order_id: '',
    inventory_item_id: '',
    reason: '',
    condition: '',
    refund_amount: '',
    received_at: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Filter items to show only those from selected order
  const selectedOrder = orders.find((o: any) => o.id === form.order_id);
  const orderItemIds = selectedOrder?.order_items?.map((oi: any) => oi.inventory_item_id) ?? [];
  const availableItems = form.order_id
    ? items.filter((item: any) => orderItemIds.includes(item.id))
    : items;

  const save = async () => {
    if (!form.reason) { setError('Return reason is required.'); return; }
    if (!form.order_id && !form.inventory_item_id) { setError('An order or inventory item is required.'); return; }
    setSaving(true); setError(null);
    const { error: err, data: created } = await insertRow('returns', {
      organization_id: orgId,
      order_id: form.order_id || null,
      inventory_item_id: form.inventory_item_id || null,
      reason: form.reason,
      condition: form.condition || null,
      refund_amount: parseFloat(form.refund_amount) || 0,
      received_at: form.received_at || null,
      notes: form.notes || null,
      status: 'INSPECTION',
    });
    if (err) { setError(err); setSaving(false); return; }
    const returnId: string | undefined = created?.[0]?.id;
    await logActivity(orgId, userId, `Return created: ${form.reason}`, 'returns', returnId, 'return_created');
    void createNotification(orgId, 'Return received', `New return for inspection: ${form.reason}`, {
      userId, priority: 'medium', entityType: 'returns', entityId: returnId ?? null,
      route: returnId ? `/returns/all?selected=${returnId}` : '/returns/all',
    });
    setSaving(false); onCreated(); onClose();
    setForm({ order_id: '', inventory_item_id: '', reason: '', condition: '', refund_amount: '', received_at: '', notes: '' });
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Return"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Create Return
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Order">
          <select className={selectCls} value={form.order_id} onChange={e => { set('order_id', e.target.value); set('inventory_item_id', ''); }}>
            <option value="">— No order —</option>
            {orders.map((o: any) => (
              <option key={o.id} value={o.id}>
                {o.order_id ? `#${o.order_id}` : `#${o.id.slice(0, 8).toUpperCase()}`}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Inventory Item" help={form.order_id ? 'Showing items from selected order' : undefined}>
          <select className={selectCls} value={form.inventory_item_id} onChange={e => set('inventory_item_id', e.target.value)}>
            <option value="">— No item —</option>
            {availableItems.map((i: any) => (
              <option key={i.id} value={i.id}>{i.inventory_id} - {i.product_title}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Return Reason" required><input className={inputCls} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="Defective, not as described..." /></FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Refund Amount ($)"><input type="number" className={inputCls} value={form.refund_amount} onChange={e => set('refund_amount', e.target.value)} placeholder="0.00" min="0" step="0.01" /></FormField>
          <FormField label="Received Date"><input type="date" className={inputCls} value={form.received_at} onChange={e => set('received_at', e.target.value)} /></FormField>
        </div>
        <FormField label="Item Condition"><textarea className={textareaCls} rows={2} value={form.condition} onChange={e => set('condition', e.target.value)} placeholder="Describe physical condition..." /></FormField>
        <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes..." /></FormField>
      </div>
    </Modal>
  );
}

function EditReturnDrawer({ ret, orders, items, onClose, orgId, userId, role, onUpdated }: any) {
  const [editForm, setEditForm] = useState({
    order_id: ret.order_id ?? '',
    inventory_item_id: ret.inventory_item_id ?? '',
    reason: ret.reason ?? '',
    condition: ret.condition ?? '',
    refund_amount: String(ret.refund_amount ?? ''),
    received_at: ret.received_at ?? '',
    notes: ret.notes ?? '',
    status: ret.status ?? 'INSPECTION',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  const saveEdit = async () => {
    if (!editForm.reason) { setError('Return reason is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await updateRow('returns', ret.id, {
      order_id: editForm.order_id || null,
      inventory_item_id: editForm.inventory_item_id || null,
      reason: editForm.reason,
      condition: editForm.condition || null,
      refund_amount: parseFloat(editForm.refund_amount) || 0,
      received_at: editForm.received_at || null,
      notes: editForm.notes || null,
      status: editForm.status,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Return updated: ${editForm.reason}`, 'returns', ret.id);
    setSaving(false);
    await onUpdated();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Edit Return"
      subtitle={ret.inventory_items?.product_title}
      footer={
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
            {saving && <Loader2 size={12} className="animate-spin" />}Save Changes
          </button>
        </div>
      }
    >
      {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}
      <div className="space-y-4">
        <FormField label="Order">
          <select className={selectCls} value={editForm.order_id} onChange={e => set('order_id', e.target.value)}>
            <option value="">— No order —</option>
            {orders.map((o: any) => (
              <option key={o.id} value={o.id}>
                {o.order_id ? `#${o.order_id}` : `#${o.id.slice(0, 8).toUpperCase()}`}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Inventory Item">
          <select className={selectCls} value={editForm.inventory_item_id} onChange={e => set('inventory_item_id', e.target.value)}>
            <option value="">— No item —</option>
            {items.map((i: any) => (
              <option key={i.id} value={i.id}>{i.inventory_id} - {i.product_title}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Return Reason" required>
          <input className={inputCls} value={editForm.reason} onChange={e => set('reason', e.target.value)} />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Refund Amount ($)">
            <input type="number" className={inputCls} value={editForm.refund_amount} onChange={e => set('refund_amount', e.target.value)} min="0" step="0.01" />
          </FormField>
          <FormField label="Received Date">
            <input type="date" className={inputCls} value={editForm.received_at} onChange={e => set('received_at', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Status">
          <select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>
            {RETURN_STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </FormField>
        <FormField label="Item Condition">
          <textarea className={textareaCls} rows={2} value={editForm.condition} onChange={e => set('condition', e.target.value)} />
        </FormField>
        <FormField label="Notes">
          <textarea className={textareaCls} rows={2} value={editForm.notes} onChange={e => set('notes', e.target.value)} />
        </FormField>
      </div>
    </Drawer>
  );
}

export function Returns() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const [showCreate, setShowCreate] = useState(false);
  const [activeReturnId, setActiveReturnId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  // Watch for new selected param
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  const [decision, setDecision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filterValues, setFilterValues] = useState<FilterValues>({});

  const statusFilter = VIEW_STATUS[view] ?? null;

  const { data: returns, loading, error, reload } = useOrgQuery<any>('returns', orgId, {
    select: 'id, return_id, reason, condition, refund_amount, status, decision, received_at, notes, created_at, order_id, inventory_item_id, orders(id, order_id, order_items(id, inventory_item_id, inventory_items(id, inventory_id, product_title, lot_id, lots(lot_id, vendor_id, funding_partner_id)))), inventory_items(id, inventory_id, product_title, lot_id, lots(lot_id))',
    filter: statusFilter ? (q: any) => q.eq('status', statusFilter) : undefined,
    filterKey: statusFilter ?? 'all',
  });

  // Handle deep-link after returns load
  useEffect(() => {
    if (!pendingSelId.current || returns.length === 0) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const returnRec = returns.find((r: any) => r.id === id);
    if (returnRec) {
      setActiveReturnId(id);
    } else {
      setNotFoundMsg('Return not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [returns, setSearchParams]);

  const { data: orders } = useOrgQuery<any>('orders', orgId, { select: 'id, order_id, order_items(id, inventory_item_id, inventory_items(id, inventory_id, product_title))' });
  const { data: items } = useOrgQuery<any>('inventory_items', orgId, { select: 'id, inventory_id, product_title, lot_id, lots(lot_id, vendor_id, funding_partner_id)' });
  const { data: lots } = useOrgQuery<any>('lots', orgId, { select: 'id, lot_id, vendor_id, funding_partner_id' });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name' });
  const { data: partners } = useOrgQuery<any>('partners', orgId, { select: 'id, company_name' });

  const distinctReasons = Array.from(new Set(returns.map((r: any) => r.reason).filter(Boolean))).sort() as string[];
  const lotById = new Map(lots.map((l: any) => [l.id, l]));

  const returnFilterDefs: FilterDef[] = [
    { type: 'select', key: 'reason', label: 'Return Reason', options: distinctReasons.map(r => ({ value: r, label: r })) },
    { type: 'select', key: 'status', label: 'Resolution', options: RETURN_STATUSES.map(s => ({ value: s, label: s })) },
    { type: 'select', key: 'inventory_item_id', label: 'Inventory Item', options: items.map((i: any) => ({ value: i.id, label: `${i.inventory_id} - ${i.product_title}` })) },
    { type: 'select', key: 'lot_id', label: 'LOT', options: lots.map((l: any) => ({ value: l.id, label: l.lot_id || l.id })) },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.name })) },
    { type: 'select', key: 'funding_partner_id', label: 'Funding Partner', options: partners.map((p: any) => ({ value: p.id, label: p.company_name })) },
    { type: 'daterange', keyFrom: 'received_from', keyTo: 'received_to', label: 'Date Received' },
    { type: 'numrange', keyMin: 'refund_min', keyMax: 'refund_max', label: 'Refund', prefix: '$' },
  ];

  const filteredReturns = returns.filter((r: any) => {
    const v = filterValues;
    if (v.reason && r.reason !== v.reason) return false;
    if (v.status && r.status !== v.status) return false;
    if (v.inventory_item_id && r.inventory_item_id !== v.inventory_item_id) return false;

    // LOT/Vendor/Partner filters through inventory_items → lots
    const lotId = r.inventory_items?.lot_id;
    const lot = lotById.get(lotId);
    if (v.lot_id && lotId !== v.lot_id) return false;
    if (v.vendor_id && lot?.vendor_id !== v.vendor_id) return false;
    if (v.funding_partner_id && lot?.funding_partner_id !== v.funding_partner_id) return false;

    const receivedDate = r.received_at ?? r.created_at ?? '';
    if (v.received_from && receivedDate && receivedDate.slice(0,10) < v.received_from) return false;
    if (v.received_to && receivedDate && receivedDate.slice(0,10) > v.received_to) return false;
    if (v.refund_min && Number(r.refund_amount ?? 0) < Number(v.refund_min)) return false;
    if (v.refund_max && Number(r.refund_amount ?? 0) > Number(v.refund_max)) return false;
    return true;
  });

  // Fix active selection - if filtered list changes and active is not visible, select first or null
  const activeReturn = filteredReturns.find((r: any) => r.id === activeReturnId) ?? filteredReturns[0] ?? null;

  // Update activeReturnId if it changed due to filtering
  useEffect(() => {
    if (filteredReturns.length > 0 && !filteredReturns.find((r: any) => r.id === activeReturnId)) {
      setActiveReturnId(filteredReturns[0]?.id ?? null);
    }
  }, [filteredReturns, activeReturnId]);

  const confirmDecision = async () => {
    if (!activeReturn || !decision) return;
    setSaving(true);

    const statusMap: Record<string, string> = {
      RESTOCK: 'RESTOCKED',
      RELIST: 'RELISTED',
      SCRAP: 'SCRAPPED'
    };

    // Update return status
    await updateRow('returns', activeReturn.id, {
      status: statusMap[decision],
      decision
    });

    // Update linked inventory item status based on decision
    if (activeReturn.inventory_item_id) {
      const inventoryStatusMap: Record<string, string> = {
        RESTOCK: 'ACTIVE',
        RELIST: 'LISTING',
        SCRAP: 'SCRAPPED'
      };
      await updateRow('inventory_items', activeReturn.inventory_item_id, {
        status: inventoryStatusMap[decision]
      });
    }

    // Update linked order status to RETURNED if appropriate
    if (activeReturn.order_id && activeReturn.orders?.status !== 'RETURNED') {
      await updateRow('orders', activeReturn.order_id, { status: 'RETURNED' });
    }

    await logActivity(orgId!, user?.id!, `Return decision: ${decision}`, 'returns', activeReturn.id);

    setSaving(false);
    setDecision(null);
    await reload();
  };

  const handleDelete = async () => {
    if (!activeReturn) return;
    setDeleting(true);

    // Check for linked records
    if (activeReturn.order_id || activeReturn.inventory_item_id) {
      setDeleting(false);
      setConfirmDelete(false);
      alert('Cannot delete: Return has linked order or inventory history. Consider changing status instead.');
      return;
    }

    const { error: delErr } = await deleteRow('returns', activeReturn.id);
    if (delErr) {
      alert(`Failed to delete: ${delErr}`);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }

    await logActivity(orgId!, user?.id!, `Return deleted`, 'returns', activeReturn.id);
    setDeleting(false);
    setConfirmDelete(false);
    setActiveReturnId(null);
    await reload();
  };

  return (
    <div className="p-3 sm:p-6 max-w-[1200px] space-y-4">
      {notFoundMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">
          {notFoundMsg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Returns</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Inspection queue and recovery decisions</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
          <Plus size={13} />Log Return
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-4 py-3.5 border-b border-[rgba(0,0,0,0.06)]">
            <h3 className="text-[13px] font-semibold text-gray-900">Queue</h3>
          </div>
          <FilterBar defs={returnFilterDefs} values={filterValues} onChange={setFilterValues} />
          {loading ? <div className="p-8 flex justify-center"><Loader2 size={18} className="animate-spin text-gray-300" /></div>
          : error ? <ErrorState message={error} onRetry={reload} />
          : filteredReturns.length === 0 ? <EmptyState title="No returns" description="Log returns to begin inspection." />
          : (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">
              {filteredReturns.map((ret: any) => (
                <button key={ret.id} onClick={() => { setActiveReturnId(ret.id); setDecision(null); }}
                  className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${activeReturn?.id === ret.id ? 'bg-[#F0FDF4]' : ''}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-mono text-gray-500">
                      {ret.return_id ? `RET-${ret.return_id}` : (ret.orders ? (ret.orders.order_id ? `#${ret.orders.order_id}` : `#${ret.orders.id.slice(0, 8).toUpperCase()}`) : 'No order')}
                    </span>
                    <StatusBadge status={ret.status} size="sm" />
                  </div>
                  <p className="text-[13px] font-medium text-gray-900 truncate">{ret.inventory_items?.inventory_id ?? 'Unknown item'}</p>
                  <p className="text-[11px] text-gray-600 truncate">{ret.inventory_items?.product_title ?? '—'}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{ret.reason}</p>
                  <p className="text-[13px] font-semibold text-gray-900 mt-1.5">${Number(ret.refund_amount || 0).toFixed(2)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          {!activeReturn ? (
            <div className="h-full flex items-center justify-center py-16">
              <p className="text-[13px] text-gray-400">Select a return to inspect.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[13px] font-semibold text-gray-900">Inspection</h3>
                <div className="flex items-center gap-2">
                  <StatusBadge status={activeReturn.status} />
                  {canEditOps(role) && (
                    <button onClick={() => setShowEdit(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                      <Pencil size={12} />Edit
                    </button>
                  )}
                  {isAdmin(role) && (
                    <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1 px-2.5 py-1.5 text-[12px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                      <Trash2 size={12} />Delete
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
                {[
                  { l: 'Order', v: activeReturn.orders ? (activeReturn.orders.order_id ? `#${activeReturn.orders.order_id}` : `#${activeReturn.orders.id.slice(0, 8).toUpperCase()}`) : '—' },
                  { l: 'Inventory ID', v: activeReturn.inventory_items?.inventory_id ?? '—' },
                  { l: 'Item', v: activeReturn.inventory_items?.product_title ?? '—' },
                  { l: 'Reason', v: activeReturn.reason },
                  { l: 'Received', v: activeReturn.received_at ?? '—' },
                  { l: 'Refund Amount', v: `$${Number(activeReturn.refund_amount || 0).toFixed(2)}` },
                ].map(f => (
                  <div key={f.l} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-[11px] text-gray-400">{f.l}</p>
                    <p className="text-[13px] font-medium text-gray-900 mt-0.5 truncate">{f.v}</p>
                  </div>
                ))}
              </div>

              {activeReturn.condition && (
                <div className="mb-4">
                  <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2 block">Item Condition</label>
                  <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-lg px-3 py-2.5">
                    <p className="text-[13px] text-gray-900">{activeReturn.condition}</p>
                  </div>
                </div>
              )}

              {activeReturn.notes && (
                <div className="mb-4">
                  <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2 block">Notes</label>
                  <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-lg px-3 py-2.5">
                    <p className="text-[13px] text-gray-900">{activeReturn.notes}</p>
                  </div>
                </div>
              )}

              <div className="mb-4">
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2 block">Photos</label>
                <div className="flex gap-2">
                  <button
                    disabled
                    title="Photo upload requires Supabase Storage configuration"
                    className="w-16 h-16 rounded-xl flex items-center justify-center border border-dashed border-gray-200 text-[10px] text-gray-300 flex-col gap-1 cursor-not-allowed opacity-60"
                  >
                    <Camera size={12} />Add
                  </button>
                </div>
              </div>

              {activeReturn.status === 'INSPECTION' && canEditOps(role) ? (
                <div>
                  <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-2 block">Decision</label>
                  <div className="flex gap-2">
                    {[
                      { id: 'RESTOCK', label: 'Restock', icon: CheckCircle, active: 'border-[#3ECF8E] bg-[#ECFDF5] text-[#16a34a]' },
                      { id: 'RELIST', label: 'Relist as-is', icon: RotateCcw, active: 'border-gray-400 bg-gray-50 text-gray-700' },
                      { id: 'SCRAP', label: 'Scrap', icon: XCircle, active: 'border-red-400 bg-red-50 text-red-600' },
                    ].map(opt => {
                      const Icon = opt.icon;
                      return (
                        <button key={opt.id} onClick={() => setDecision(opt.id)}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 transition-all text-[13px] font-medium ${decision === opt.id ? opt.active : 'border-[rgba(0,0,0,0.1)] text-gray-500 hover:bg-gray-50'}`}>
                          <Icon size={14} />{opt.label}
                        </button>
                      );
                    })}
                  </div>
                  {decision && (
                    <button onClick={confirmDecision} disabled={saving}
                      className="w-full mt-3 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-xl flex items-center justify-center gap-2 disabled:opacity-60">
                      {saving && <Loader2 size={12} className="animate-spin" />}
                      Confirm: {decision}
                    </button>
                  )}
                </div>
              ) : activeReturn.status !== 'INSPECTION' ? (
                <div className="flex items-center gap-2 py-3 px-4 bg-gray-50 rounded-xl">
                  <CheckCircle size={14} className="text-[#3ECF8E]" />
                  <p className="text-[13px] text-gray-600">Decision recorded: <span className="font-medium text-gray-900">{activeReturn.decision}</span></p>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <CreateReturnModal open={showCreate} onClose={() => setShowCreate(false)} orgId={orgId} userId={user?.id} orders={orders} items={items} onCreated={reload} />

      {showEdit && activeReturn && (
        <EditReturnDrawer
          ret={activeReturn}
          orders={orders}
          items={items}
          onClose={() => setShowEdit(false)}
          orgId={orgId}
          userId={user?.id}
          role={role}
          onUpdated={async () => {
            await reload();
            setShowEdit(false);
          }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Return"
        description={activeReturn?.order_id || activeReturn?.inventory_item_id
          ? "This return has linked order/inventory history. Consider changing status to SCRAPPED instead. Continue delete?"
          : "Permanently delete this return record? This action cannot be undone."}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        loading={deleting}
      />
    </div>
  );
}
