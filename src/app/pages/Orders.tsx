import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Search, Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity } from '../../lib/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEdit, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';


const ORDER_STATUSES = ['OPEN','PICKING','PACKED','SHIPPED','DELIVERED','RETURNED','CANCELLED'];

const CHANNEL_OPTIONS = [
  { value: 'EBAY', label: 'eBay' },
  { value: 'SHOPIFY', label: 'Shopify' },
  { value: 'AMAZON', label: 'Amazon' },
  { value: 'DIRECT', label: 'Direct' },
  { value: 'WHATNOT', label: 'Whatnot' },
];
const CHANNEL_LABEL: Record<string, string> = Object.fromEntries(
  CHANNEL_OPTIONS.map(o => [o.value, o.label])
);

const VIEW_STATUS: Record<string, string> = {
  open: 'OPEN', picking: 'PICKING', packed: 'PACKED', shipped: 'SHIPPED',
  delivered: 'DELIVERED', returned: 'RETURNED', cancelled: 'CANCELLED',
};

function CreateOrderModal({ open, onClose, orgId, userId, inventoryItems, onCreated }: any) {
  const [form, setForm] = useState({
    channel: 'EBAY',
    status: 'OPEN',
    buyer_name: '',
    buyer_email: '',
    total_amount: '',
    notes: '',
  });
  const [selectedItems, setSelectedItems] = useState<{ inventory_item_id: string; quantity: number; unit_price: number }[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const filteredItems = inventoryItems.filter((item: any) =>
    !itemSearch ||
    item.inventory_id?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    item.product_title?.toLowerCase().includes(itemSearch.toLowerCase())
  );

  const addItem = (itemId: string) => {
    const item = inventoryItems.find((i: any) => i.id === itemId);
    if (!item || selectedItems.some(si => si.inventory_item_id === itemId)) return;
    setSelectedItems(prev => [...prev, {
      inventory_item_id: itemId,
      quantity: 1,
      unit_price: item.current_asking_price || 0,
    }]);
    setItemSearch('');
  };

  const removeItem = (itemId: string) => {
    setSelectedItems(prev => prev.filter(si => si.inventory_item_id !== itemId));
  };

  const updateItemQuantity = (itemId: string, quantity: number) => {
    setSelectedItems(prev => prev.map(si =>
      si.inventory_item_id === itemId ? { ...si, quantity: Math.max(1, quantity) } : si
    ));
  };

  const updateItemPrice = (itemId: string, price: number) => {
    setSelectedItems(prev => prev.map(si =>
      si.inventory_item_id === itemId ? { ...si, unit_price: price } : si
    ));
  };

  const calculatedTotal = selectedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const displayTotal = form.total_amount || calculatedTotal.toFixed(2);

  const save = async () => {
    if (!form.channel) { setError('Channel is required.'); return; }
    if (selectedItems.length === 0 && !form.total_amount) {
      setError('Add line items or specify a total amount for manual order.');
      return;
    }
    setSaving(true); setError(null);

    let customerId: string | null = null;
    if (form.buyer_name) {
      const { data: cust } = await (await import('../../lib/supabase')).supabase
        .from('customers')
        .insert({ organization_id: orgId, name: form.buyer_name, email: form.buyer_email || null })
        .select('id')
        .single();
      customerId = cust?.id ?? null;
    }

    // Create order
    const { data: orderData, error: orderErr } = await insertRow('orders', {
      organization_id: orgId,
      channel: form.channel,
      status: form.status,
      customer_id: customerId,
      total_amount: parseFloat(displayTotal) || 0,
      notes: form.notes || null,
    });
    if (orderErr) { setError(orderErr); setSaving(false); return; }
    const orderId = orderData?.id;
    if (!orderId) { setError('Failed to create order.'); setSaving(false); return; }

    // Create order_items
    for (const item of selectedItems) {
      const { error: itemErr } = await insertRow('order_items', {
        organization_id: orgId,
        order_id: orderId,
        inventory_item_id: item.inventory_item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      });
      if (itemErr) {
        setError(`Order created, but failed to add line item: ${itemErr}`);
        setSaving(false);
        onCreated();
        return;
      }
    }

    await logActivity(orgId, userId, `Order created via ${CHANNEL_LABEL[form.channel] ?? form.channel} with ${selectedItems.length} item(s)`, 'orders', orderId);
    setSaving(false); onCreated(); onClose();
    setForm({ channel: 'EBAY', status: 'OPEN', buyer_name: '', buyer_email: '', total_amount: '', notes: '' });
    setSelectedItems([]);
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Order"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Create Order
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Channel">
          <select className={selectCls} value={form.channel} onChange={e => set('channel', e.target.value)}>
            {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Buyer Name"><input className={inputCls} value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} placeholder="Jane Smith" /></FormField>
          <FormField label="Buyer Email"><input type="email" className={inputCls} value={form.buyer_email} onChange={e => set('buyer_email', e.target.value)} placeholder="jane@email.com" /></FormField>
        </div>

        <FormField label="Order Items">
          <div className="space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="pl-7 pr-3 py-1.5 text-[13px] bg-gray-50 border border-[rgba(0,0,0,0.08)] rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E]"
                placeholder="Search inventory items..."
                value={itemSearch}
                onChange={e => setItemSearch(e.target.value)}
              />
              {itemSearch && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-[rgba(0,0,0,0.1)] rounded-lg shadow-lg">
                  {filteredItems.slice(0, 10).map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() => addItem(item.id)}
                      className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-[13px] border-b border-[rgba(0,0,0,0.04)] last:border-0"
                    >
                      <div className="font-medium text-gray-900">{item.inventory_id}</div>
                      <div className="text-gray-600 text-[12px] truncate">{item.product_title}</div>
                      <div className="text-gray-400 text-[11px]">${(item.current_asking_price || 0).toFixed(2)}</div>
                    </div>
                  ))}
                  {filteredItems.length === 0 && (
                    <div className="px-3 py-2 text-[13px] text-gray-400">No items found</div>
                  )}
                </div>
              )}
            </div>
            {selectedItems.map(item => {
              const invItem = inventoryItems.find((i: any) => i.id === item.inventory_item_id);
              return (
                <div key={item.inventory_item_id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-gray-900 truncate">{invItem?.inventory_id}</div>
                    <div className="text-[11px] text-gray-600 truncate">{invItem?.product_title}</div>
                  </div>
                  <input
                    type="number"
                    className={`${inputCls} w-16 text-[12px]`}
                    min="1"
                    value={item.quantity}
                    onChange={e => updateItemQuantity(item.inventory_item_id, parseInt(e.target.value) || 1)}
                  />
                  <input
                    type="number"
                    className={`${inputCls} w-20 text-[12px]`}
                    min="0"
                    step="0.01"
                    value={item.unit_price}
                    onChange={e => updateItemPrice(item.inventory_item_id, parseFloat(e.target.value) || 0)}
                  />
                  <button
                    onClick={() => removeItem(item.inventory_item_id)}
                    className="p-1 text-gray-400 hover:text-red-500"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </FormField>

        <FormField label="Total Amount ($)" help="Calculated from line items unless manually overridden">
          <input type="number" className={inputCls} value={form.total_amount} onChange={e => set('total_amount', e.target.value)} placeholder={calculatedTotal.toFixed(2)} min="0" step="0.01" />
        </FormField>
        <FormField label="Status"><select className={selectCls} value={form.status} onChange={e => set('status', e.target.value)}>{ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
        <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes..." /></FormField>
      </div>
    </Modal>
  );
}

function OrderDrawer({ order, onClose, orgId, userId, role, onUpdated }: any) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ channel: order.channel, status: order.status, total_amount: String(order.total_amount ?? ''), notes: order.notes ?? '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'delete'>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  // Show full order_id if available, only shorten UUID fallback
  const orderNum = order.order_id ? `#${order.order_id}` : `#${order.id.slice(0, 8).toUpperCase()}`;
  const orderItems = order.order_items ?? [];

  const saveEdit = async () => {
    setSaving(true); setError(null);
    const { error: err } = await updateRow('orders', order.id, {
      channel: editForm.channel,
      status: editForm.status,
      total_amount: parseFloat(editForm.total_amount) || 0,
      notes: editForm.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Order ${orderNum} updated`, 'orders', order.id);
    setSaving(false); setEditing(false);
    // Reload and keep drawer open - onUpdated will trigger reload
    await onUpdated();
  };

  const handleCancelOrder = async () => {
    setConfirmLoading(true);
    await updateRow('orders', order.id, { status: 'CANCELLED' });
    await logActivity(orgId, userId, `Order ${orderNum} cancelled`, 'orders', order.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const handleDelete = async () => {
    setConfirmLoading(true);
    // Check for linked order_items
    const linkedItems = await countLinked('order_items', 'order_id', order.id);
    if (linkedItems > 0) {
      setError(`Cannot delete: ${linkedItems} order item(s) are linked. Recommend cancelling the order instead.`);
      setConfirmLoading(false); setConfirm(null); return;
    }
    // Check for linked shipments
    const linkedShipments = await countLinked('shipments', 'order_id', order.id);
    if (linkedShipments > 0) {
      setError(`Cannot delete: ${linkedShipments} shipment(s) are linked. Recommend cancelling the order instead.`);
      setConfirmLoading(false); setConfirm(null); return;
    }
    // Check for linked returns
    const linkedReturns = await countLinked('returns', 'order_id', order.id);
    if (linkedReturns > 0) {
      setError(`Cannot delete: ${linkedReturns} return(s) are linked. Recommend cancelling the order instead.`);
      setConfirmLoading(false); setConfirm(null); return;
    }
    const { error: delErr } = await deleteRow('orders', order.id);
    if (delErr) {
      setError(`Failed to delete order: ${delErr}`);
      setConfirmLoading(false); setConfirm(null); return;
    }
    await logActivity(orgId, userId, `Order ${orderNum} deleted`, 'orders', order.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const canEditOrder = canEdit(role);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={editing ? `Edit ${orderNum}` : orderNum}
        subtitle={order.customers?.name ? `Buyer: ${order.customers.name}` : undefined}
        footer={editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(false); setError(null); }} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
              {saving && <Loader2 size={12} className="animate-spin" />}Save Changes
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {canEditOrder && order.status !== 'CANCELLED' && (
              <button onClick={() => setConfirm('cancel')} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                Cancel Order
              </button>
            )}
            {isAdmin(role) && (
              <button onClick={() => setConfirm('delete')} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                <Trash2 size={13} />Delete
              </button>
            )}
            {canEditOrder && (
              <button
                onClick={() => { setEditing(true); setEditForm({ channel: order.channel, status: order.status, total_amount: String(order.total_amount ?? ''), notes: order.notes ?? '' }); }}
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
            <FormField label="Channel">
              <select className={selectCls} value={editForm.channel} onChange={e => set('channel', e.target.value)}>
                {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </FormField>
            <FormField label="Status">
              <select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>
                {ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </FormField>
            <FormField label="Total Amount ($)">
              <input type="number" className={inputCls} value={editForm.total_amount} onChange={e => set('total_amount', e.target.value)} min="0" step="0.01" />
            </FormField>
            <FormField label="Notes">
              <textarea className={textareaCls} rows={3} value={editForm.notes} onChange={e => set('notes', e.target.value)} />
            </FormField>
          </div>
        ) : (
          <div>
            <DetailRow label="Order #" value={<span className="font-mono">{orderNum}</span>} />
            <DetailRow label="Buyer" value={order.customers?.name ?? null} />
            <DetailRow label="Buyer Email" value={order.customers?.email ?? null} />
            <DetailRow label="Channel" value={CHANNEL_LABEL[order.channel] ?? order.channel} />
            <DetailRow label="Status" value={<StatusBadge status={order.status} size="sm" />} />
            <DetailRow label="Total" value={`$${Number(order.total_amount || 0).toFixed(2)}`} />
            <DetailRow label="Created" value={new Date(order.created_at).toLocaleDateString()} />
            {order.notes && <DetailRow label="Notes" value={order.notes} />}

            {orderItems.length > 0 && (
              <>
                <div className="border-t border-[rgba(0,0,0,0.06)] my-3 pt-3">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Order Items ({orderItems.length})</p>
                </div>
                <div className="space-y-2">
                  {orderItems.map((item: any) => (
                    <div
                      key={item.id}
                      onClick={() => navigate(`/inventory/all?selected=${item.inventory_item_id}`)}
                      className="p-2 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-medium text-gray-900">{item.inventory_items?.inventory_id ?? '—'}</div>
                          <div className="text-[11px] text-gray-600 truncate">{item.inventory_items?.product_title ?? '—'}</div>
                          {item.inventory_items?.lots?.lot_id && (
                            <div className="text-[10px] text-gray-400 mt-0.5">LOT: {item.inventory_items.lots.lot_id}</div>
                          )}
                        </div>
                        <div className="text-right text-[11px]">
                          <div className="text-gray-900 font-medium">Qty: {item.quantity}</div>
                          <div className="text-gray-500">${Number(item.unit_price || 0).toFixed(2)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirm === 'cancel'}
        title="Cancel Order"
        description={`Cancel order ${orderNum}? This will mark it as cancelled and cannot be undone.`}
        confirmLabel="Cancel Order"
        danger
        onConfirm={handleCancelOrder}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete Order"
        description="Permanently delete this order? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
    </>
  );
}

export function Orders() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  // Watch for action param
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'create-order') {
      setShowCreate(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Watch for new selected param
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  const statusFilter = VIEW_STATUS[view] ?? null;

  const { data: orders, loading, error, reload } = useOrgQuery<any>('orders', orgId, {
    select: 'id, order_id, channel, status, total_amount, notes, created_at, customer_id, customers(id, name, email), shipments(id, tracking_number), order_items(id, inventory_item_id, quantity, unit_price, inventory_items(id, inventory_id, product_title, lot_id, lots(lot_id)))',
    filter: statusFilter ? (q: any) => q.eq('status', statusFilter) : undefined,
    filterKey: statusFilter ?? 'all',
  });

  // Handle deep-link after orders load
  useEffect(() => {
    if (!pendingSelId.current || orders.length === 0) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const order = orders.find((o: any) => o.id === id);
    if (order) {
      setSelectedId(id);
    } else {
      setNotFoundMsg('Order not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [orders, setSearchParams]);

  const { data: customers } = useOrgQuery<any>('customers', orgId, { select: 'id, name' });
  const { data: inventoryItems } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, product_title, current_asking_price',
    filter: (q: any) => q.in('status', ['LISTING', 'ACTIVE']),
  });
  const { data: lots } = useOrgQuery<any>('lots', orgId, { select: 'id, lot_id, vendor_id, funding_partner_id' });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name' });
  const { data: partners } = useOrgQuery<any>('partners', orgId, { select: 'id, company_name' });

  const orderFilterDefs: FilterDef[] = [
    { type: 'select', key: 'channel', label: 'Channel', options: CHANNEL_OPTIONS },
    { type: 'select', key: 'customer_id', label: 'Customer', options: customers.map((c: any) => ({ value: c.id, label: c.name })) },
    { type: 'select', key: 'lot_id', label: 'LOT', options: lots.map((l: any) => ({ value: l.id, label: l.lot_id || l.id })) },
    { type: 'select', key: 'vendor_id', label: 'Vendor', options: vendors.map((v: any) => ({ value: v.id, label: v.name })) },
    { type: 'select', key: 'funding_partner_id', label: 'Funding Partner', options: partners.map((p: any) => ({ value: p.id, label: p.company_name })) },
    { type: 'daterange', keyFrom: 'created_from', keyTo: 'created_to', label: 'Date Range' },
    { type: 'numrange', keyMin: 'total_min', keyMax: 'total_max', label: 'Total', prefix: '$' },
    { type: 'boolean', key: 'has_shipment', label: 'Has Shipment' },
    { type: 'boolean', key: 'missing_shipment', label: 'Missing Shipment' },
    { type: 'boolean', key: 'has_tracking', label: 'Has Tracking' },
    { type: 'boolean', key: 'missing_tracking', label: 'Missing Tracking' },
  ];

  const searchFiltered = orders.filter((o: any) =>
    !search || o.customers?.name?.toLowerCase().includes(search.toLowerCase()) || o.channel?.toLowerCase().includes(search.toLowerCase())
  );

  const lotById = new Map(lots.map((l: any) => [l.id, l]));

  const filtered = searchFiltered.filter((order: any) => {
    const v = filterValues;
    if (v.channel && order.channel !== v.channel) return false;
    if (v.customer_id && order.customer_id !== v.customer_id) return false;

    // LOT/Vendor/Partner filters through order_items → inventory_items → lots
    const orderItems = order.order_items ?? [];
    if (v.lot_id || v.vendor_id || v.funding_partner_id) {
      const hasMatch = orderItems.some((oi: any) => {
        const lotId = oi.inventory_items?.lot_id;
        const lot = lotById.get(lotId);
        if (v.lot_id && lotId !== v.lot_id) return false;
        if (v.vendor_id && lot?.vendor_id !== v.vendor_id) return false;
        if (v.funding_partner_id && lot?.funding_partner_id !== v.funding_partner_id) return false;
        return true;
      });
      if (!hasMatch) return false;
    }

    if (v.created_from && order.created_at && order.created_at.slice(0,10) < v.created_from) return false;
    if (v.created_to && order.created_at && order.created_at.slice(0,10) > v.created_to) return false;
    if (v.total_min && Number(order.total_amount ?? 0) < Number(v.total_min)) return false;
    if (v.total_max && Number(order.total_amount ?? 0) > Number(v.total_max)) return false;

    const shipments = order.shipments ?? [];
    if (v.has_shipment === 'true' && shipments.length === 0) return false;
    if (v.missing_shipment === 'true' && shipments.length > 0) return false;
    // Has tracking: at least one shipment has tracking_number
    if (v.has_tracking === 'true' && !shipments.some((s: any) => s.tracking_number)) return false;
    // Missing tracking: has shipment but no shipment has tracking_number
    if (v.missing_tracking === 'true' && (shipments.length === 0 || shipments.some((s: any) => s.tracking_number))) return false;

    return true;
  });

  const selectedOrder = orders.find((o: any) => o.id === selectedId) ?? null;

  return (
    <div className="p-6 max-w-[1300px] space-y-4">
      {notFoundMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">
          {notFoundMsg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Orders</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Fulfillment queue and order management</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
          <Plus size={13} />Create Order
        </button>
      </div>

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)] flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders..."
              className="pl-7 pr-3 py-1.5 text-[13px] bg-gray-50 border border-[rgba(0,0,0,0.08)] rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] placeholder:text-gray-400" />
          </div>
          <span className="text-[12px] text-gray-400 ml-auto">{filtered.length} orders</span>
        </div>

        <FilterBar defs={orderFilterDefs} values={filterValues} onChange={setFilterValues} />

        {loading ? (
          <div className="divide-y divide-[rgba(0,0,0,0.04)]">
            {[1,2,3,4].map(i => <div key={i} className="h-14 px-5 py-3 flex items-center"><div className="h-4 w-40 bg-gray-100 animate-pulse rounded" /></div>)}
          </div>
        ) : error ? <ErrorState message={error} onRetry={reload} />
        : filtered.length === 0 ? (
          <EmptyState title="No orders found" description={search ? 'Try a different search.' : 'Create your first order.'} action={!search ? { label: 'Create Order', onClick: () => setShowCreate(true) } : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(0,0,0,0.06)]">
                  {['Order #', 'Buyer', 'Channel', 'Status', 'Total', 'Date'].map(h => (
                    <th key={h} className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((order: any, i: number) => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedId(order.id)}
                    className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedId === order.id ? 'bg-[#F0FDF4]' : ''} ${i < filtered.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                  >
                    <td className="px-5 py-3 text-[13px] font-mono font-medium text-gray-900">{order.order_id ? `#${order.order_id}` : `#${order.id.slice(0, 8).toUpperCase()}`}</td>
                    <td className="px-5 py-3 text-[13px] text-gray-700">{order.customers?.name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {CHANNEL_LABEL[order.channel] ?? order.channel}
                      </span>
                    </td>
                    <td className="px-5 py-3"><StatusBadge status={order.status} size="sm" /></td>
                    <td className="px-5 py-3 text-[13px] font-semibold text-gray-900 tabular-nums">${Number(order.total_amount || 0).toFixed(2)}</td>
                    <td className="px-5 py-3 text-[12px] text-gray-400">{new Date(order.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} orgId={orgId} userId={user?.id} inventoryItems={inventoryItems} onCreated={reload} />
      {selectedOrder && (
        <OrderDrawer
          order={selectedOrder}
          onClose={() => setSelectedId(null)}
          orgId={orgId}
          userId={user?.id}
          role={role}
          onUpdated={async () => {
            await reload();
            // Keep drawer open with refreshed data - selectedOrder will update via selectedId
          }}
        />
      )}
    </div>
  );
}
