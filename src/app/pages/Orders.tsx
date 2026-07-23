import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Search, Plus, Loader2, Pencil, Trash2, MapPin } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity } from '../../lib/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEdit, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';
import { supabase } from '../../lib/supabase';

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
    channel: 'DIRECT',
    status: 'OPEN',
    buyer_name: '',
    buyer_email: '',
    ship_to_name: '',
    ship_to_street1: '',
    ship_to_street2: '',
    ship_to_city: '',
    ship_to_state: '',
    ship_to_zip: '',
    ship_to_country: 'US',
    total_amount: '',
    notes: '',
  });
  const [selectedItems, setSelectedItems] = useState<{ inventory_item_id: string; quantity: number; unit_price: number }[]>([]);
  const [itemSearch, setItemSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Auto-fill ship_to_name from buyer_name if not set
  useEffect(() => {
    if (form.buyer_name && !form.ship_to_name) {
      setForm(f => ({ ...f, ship_to_name: f.buyer_name }));
    }
  }, [form.buyer_name]);

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

  const removeItem = (itemId: string) => setSelectedItems(prev => prev.filter(si => si.inventory_item_id !== itemId));
  const updateItemQuantity = (itemId: string, quantity: number) => setSelectedItems(prev => prev.map(si => si.inventory_item_id === itemId ? { ...si, quantity: Math.max(1, quantity) } : si));
  const updateItemPrice = (itemId: string, price: number) => setSelectedItems(prev => prev.map(si => si.inventory_item_id === itemId ? { ...si, unit_price: price } : si));

  const calculatedTotal = selectedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
  const displayTotal = form.total_amount || calculatedTotal.toFixed(2);

  // Show address fields for direct/manual channels
  const needsAddress = ['DIRECT', 'WHATNOT', 'AMAZON'].includes(form.channel);

  const save = async () => {
    if (!form.channel) { setError('Channel is required.'); return; }
    if (selectedItems.length === 0 && !form.total_amount) {
      setError('Add line items or specify a total amount.'); return;
    }
    setSaving(true); setError(null);

    let customerId: string | null = null;
    if (form.buyer_name) {
      const { data: cust } = await supabase
        .from('customers')
        .insert({
          organization_id: orgId,
          name: form.buyer_name,
          email: form.buyer_email || null,
          street1: form.ship_to_street1 || null,
          city: form.ship_to_city || null,
          state: form.ship_to_state || null,
          zip: form.ship_to_zip || null,
          country: form.ship_to_country || 'US',
        })
        .select('id')
        .single();
      customerId = cust?.id ?? null;
    }

    const { data: orderData, error: orderErr } = await insertRow('orders', {
      organization_id: orgId,
      channel: form.channel,
      status: form.status,
      customer_id: customerId,
      buyer_name: form.buyer_name || null,
      buyer_email: form.buyer_email || null,
      ship_to_name: form.ship_to_name || form.buyer_name || null,
      ship_to_street1: form.ship_to_street1 || null,
      ship_to_street2: form.ship_to_street2 || null,
      ship_to_city: form.ship_to_city || null,
      ship_to_state: form.ship_to_state || null,
      ship_to_zip: form.ship_to_zip || null,
      ship_to_country: form.ship_to_country || 'US',
      total_amount: parseFloat(displayTotal) || 0,
      notes: form.notes || null,
    });
    if (orderErr) { setError(orderErr); setSaving(false); return; }
    const orderId = orderData?.id;
    if (!orderId) { setError('Failed to create order.'); setSaving(false); return; }

    for (const item of selectedItems) {
      const { error: itemErr } = await insertRow('order_items', {
        organization_id: orgId,
        order_id: orderId,
        inventory_item_id: item.inventory_item_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
      });
      if (itemErr) { setError(`Order created but failed to add line item: ${itemErr}`); setSaving(false); onCreated(); return; }
    }

    await logActivity(orgId, userId, `Order created via ${CHANNEL_LABEL[form.channel] ?? form.channel} with ${selectedItems.length} item(s)`, 'orders', orderId);
    setSaving(false); onCreated(); onClose();
    setForm({ channel: 'DIRECT', status: 'OPEN', buyer_name: '', buyer_email: '', ship_to_name: '', ship_to_street1: '', ship_to_street2: '', ship_to_city: '', ship_to_state: '', ship_to_zip: '', ship_to_country: 'US', total_amount: '', notes: '' });
    setSelectedItems([]);
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Order" width="max-w-2xl"
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

        {/* Buyer info */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Buyer Name"><input className={inputCls} value={form.buyer_name} onChange={e => set('buyer_name', e.target.value)} placeholder="Jane Smith" /></FormField>
          <FormField label="Buyer Email"><input type="email" className={inputCls} value={form.buyer_email} onChange={e => set('buyer_email', e.target.value)} placeholder="jane@email.com" /></FormField>
        </div>

        {/* Shipping address — always shown for direct/manual channels */}
        {needsAddress && (
          <div className="space-y-3 bg-gray-50 rounded-xl p-4 border border-[rgba(0,0,0,0.06)]">
            <div className="flex items-center gap-1.5 mb-1">
              <MapPin size={12} className="text-gray-400" />
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Ship-To Address</label>
            </div>
            <FormField label="Ship-To Name">
              <input className={inputCls} value={form.ship_to_name} onChange={e => set('ship_to_name', e.target.value)} placeholder="Recipient name" />
            </FormField>
            <FormField label="Street Address">
              <input className={inputCls} value={form.ship_to_street1} onChange={e => set('ship_to_street1', e.target.value)} placeholder="123 Main St" />
            </FormField>
            <FormField label="Apt / Suite / Unit">
              <input className={inputCls} value={form.ship_to_street2} onChange={e => set('ship_to_street2', e.target.value)} placeholder="Apt 4B (optional)" />
            </FormField>
            <div className="grid grid-cols-3 gap-3">
              <FormField label="City"><input className={inputCls} value={form.ship_to_city} onChange={e => set('ship_to_city', e.target.value)} placeholder="New York" /></FormField>
              <FormField label="State"><input className={inputCls} value={form.ship_to_state} onChange={e => set('ship_to_state', e.target.value)} placeholder="NY" maxLength={2} /></FormField>
              <FormField label="ZIP"><input className={inputCls} value={form.ship_to_zip} onChange={e => set('ship_to_zip', e.target.value)} placeholder="10001" /></FormField>
            </div>
            <FormField label="Country">
              <select className={selectCls} value={form.ship_to_country} onChange={e => set('ship_to_country', e.target.value)}>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="GB">United Kingdom</option>
                <option value="AU">Australia</option>
                <option value="MX">Mexico</option>
              </select>
            </FormField>
          </div>
        )}

        {/* Order items */}
        <FormField label="Order Items">
          <div className="space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input className="pl-7 pr-3 py-1.5 text-[13px] bg-gray-50 border border-[rgba(0,0,0,0.08)] rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E]"
                placeholder="Search inventory items..." value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
              {itemSearch && (
                <div className="absolute z-10 mt-1 w-full max-h-48 overflow-y-auto bg-white border border-[rgba(0,0,0,0.1)] rounded-lg shadow-lg">
                  {filteredItems.slice(0, 10).map((item: any) => (
                    <div key={item.id} onClick={() => addItem(item.id)} className="px-3 py-2 hover:bg-gray-50 cursor-pointer text-[13px] border-b border-[rgba(0,0,0,0.04)] last:border-0">
                      <div className="font-medium text-gray-900">{item.inventory_id}</div>
                      <div className="text-gray-600 text-[12px] truncate">{item.product_title}</div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-gray-400 text-[11px]">${(item.current_asking_price || 0).toFixed(2)}</span>
                        {item.weight_oz && <span className="text-gray-400 text-[11px]">{item.weight_oz} oz</span>}
                        {item.length_in && <span className="text-gray-400 text-[11px]">{item.length_in}×{item.width_in}×{item.height_in} in</span>}
                      </div>
                    </div>
                  ))}
                  {filteredItems.length === 0 && <div className="px-3 py-2 text-[13px] text-gray-400">No items found</div>}
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
                    {(invItem?.weight_oz || invItem?.length_in) && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {invItem.weight_oz && `${invItem.weight_oz} oz`}
                        {invItem.length_in && ` · ${invItem.length_in}×${invItem.width_in}×${invItem.height_in} in`}
                      </div>
                    )}
                  </div>
                  <input type="number" className={`${inputCls} w-16 text-[12px]`} min="1" value={item.quantity}
                    onChange={e => updateItemQuantity(item.inventory_item_id, parseInt(e.target.value) || 1)} />
                  <input type="number" className={`${inputCls} w-20 text-[12px]`} min="0" step="0.01" value={item.unit_price}
                    onChange={e => updateItemPrice(item.inventory_item_id, parseFloat(e.target.value) || 0)} />
                  <button onClick={() => removeItem(item.inventory_item_id)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>
        </FormField>

        <FormField label="Total Amount ($)">
          <input type="number" className={inputCls} value={form.total_amount} onChange={e => set('total_amount', e.target.value)} placeholder={calculatedTotal.toFixed(2)} min="0" step="0.01" />
        </FormField>
        <FormField label="Status">
          <select className={selectCls} value={form.status} onChange={e => set('status', e.target.value)}>{ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
        </FormField>
        <FormField label="Notes">
          <textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional notes..." />
        </FormField>
      </div>
    </Modal>
  );
}

function OrderDrawer({ order, onClose, orgId, userId, role, onUpdated }: any) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    channel: order.channel,
    status: order.status,
    total_amount: String(order.total_amount ?? ''),
    buyer_name: order.buyer_name ?? '',
    buyer_email: order.buyer_email ?? '',
    ship_to_name: order.ship_to_name ?? '',
    ship_to_street1: order.ship_to_street1 ?? '',
    ship_to_street2: order.ship_to_street2 ?? '',
    ship_to_city: order.ship_to_city ?? '',
    ship_to_state: order.ship_to_state ?? '',
    ship_to_zip: order.ship_to_zip ?? '',
    ship_to_country: order.ship_to_country ?? 'US',
    notes: order.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'cancel' | 'delete'>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  const orderNum = order.order_id ? `#${order.order_id}` : `#${order.id.slice(0, 8).toUpperCase()}`;
  const orderItems = order.order_items ?? [];

  const shipToName = order.ship_to_name || order.buyer_name || order.customers?.name;
  const shipToStreet1 = order.ship_to_street1 || order.customers?.street1;
  const shipToCity = order.ship_to_city || order.customers?.city;
  const shipToState = order.ship_to_state || order.customers?.state;
  const shipToZip = order.ship_to_zip || order.customers?.zip;
  const hasAddress = !!(shipToStreet1 && shipToCity && shipToState && shipToZip);

  const saveEdit = async () => {
    setSaving(true); setError(null);
    const { error: err } = await updateRow('orders', order.id, {
      channel: editForm.channel,
      status: editForm.status,
      buyer_name: editForm.buyer_name || null,
      buyer_email: editForm.buyer_email || null,
      ship_to_name: editForm.ship_to_name || null,
      ship_to_street1: editForm.ship_to_street1 || null,
      ship_to_street2: editForm.ship_to_street2 || null,
      ship_to_city: editForm.ship_to_city || null,
      ship_to_state: editForm.ship_to_state || null,
      ship_to_zip: editForm.ship_to_zip || null,
      ship_to_country: editForm.ship_to_country || 'US',
      total_amount: parseFloat(editForm.total_amount) || 0,
      notes: editForm.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Order ${orderNum} updated`, 'orders', order.id);
    setSaving(false); setEditing(false);
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
    const [linkedItems, linkedShipments, linkedReturns] = await Promise.all([
      countLinked('order_items', 'order_id', order.id),
      countLinked('shipments', 'order_id', order.id),
      countLinked('returns', 'order_id', order.id),
    ]);
    if (linkedItems > 0 || linkedShipments > 0 || linkedReturns > 0) {
      const reasons = [];
      if (linkedItems > 0) reasons.push(`${linkedItems} line item(s)`);
      if (linkedShipments > 0) reasons.push(`${linkedShipments} shipment(s)`);
      if (linkedReturns > 0) reasons.push(`${linkedReturns} return(s)`);
      setError(`Cannot delete: linked to ${reasons.join(', ')}. Cancel the order instead.`);
      setConfirmLoading(false); setConfirm(null); return;
    }
    const { error: delErr } = await deleteRow('orders', order.id);
    if (delErr) { setError(`Failed to delete: ${delErr}`); setConfirmLoading(false); setConfirm(null); return; }
    await logActivity(orgId, userId, `Order ${orderNum} deleted`, 'orders', order.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const canEditOrder = canEdit(role);

  return (
    <>
      <Drawer open onClose={onClose} title={editing ? `Edit ${orderNum}` : orderNum}
        subtitle={order.customers?.name ? `Buyer: ${order.customers.name}` : (order.buyer_name ? `Buyer: ${order.buyer_name}` : undefined)}
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
              <button onClick={() => setConfirm('cancel')} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel Order</button>
            )}
            {isAdmin(role) && (
              <button onClick={() => setConfirm('delete')} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50"><Trash2 size={13} />Delete</button>
            )}
            {canEditOrder && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg">
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
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Buyer Name"><input className={inputCls} value={editForm.buyer_name} onChange={e => set('buyer_name', e.target.value)} /></FormField>
              <FormField label="Buyer Email"><input type="email" className={inputCls} value={editForm.buyer_email} onChange={e => set('buyer_email', e.target.value)} /></FormField>
            </div>
            <div className="space-y-3 bg-gray-50 rounded-xl p-4 border border-[rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-1.5 mb-1">
                <MapPin size={12} className="text-gray-400" />
                <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Ship-To Address</label>
              </div>
              <FormField label="Ship-To Name"><input className={inputCls} value={editForm.ship_to_name} onChange={e => set('ship_to_name', e.target.value)} placeholder="Recipient name" /></FormField>
              <FormField label="Street"><input className={inputCls} value={editForm.ship_to_street1} onChange={e => set('ship_to_street1', e.target.value)} placeholder="123 Main St" /></FormField>
              <FormField label="Apt/Suite"><input className={inputCls} value={editForm.ship_to_street2} onChange={e => set('ship_to_street2', e.target.value)} placeholder="Optional" /></FormField>
              <div className="grid grid-cols-3 gap-3">
                <FormField label="City"><input className={inputCls} value={editForm.ship_to_city} onChange={e => set('ship_to_city', e.target.value)} /></FormField>
                <FormField label="State"><input className={inputCls} value={editForm.ship_to_state} onChange={e => set('ship_to_state', e.target.value)} maxLength={2} /></FormField>
                <FormField label="ZIP"><input className={inputCls} value={editForm.ship_to_zip} onChange={e => set('ship_to_zip', e.target.value)} /></FormField>
              </div>
              <FormField label="Country">
                <select className={selectCls} value={editForm.ship_to_country} onChange={e => set('ship_to_country', e.target.value)}>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="GB">United Kingdom</option>
                  <option value="AU">Australia</option>
                  <option value="MX">Mexico</option>
                </select>
              </FormField>
            </div>
            <FormField label="Status">
              <select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>{ORDER_STATUSES.map(s => <option key={s}>{s}</option>)}</select>
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
            <DetailRow label="Channel" value={CHANNEL_LABEL[order.channel] ?? order.channel} />
            <DetailRow label="Status" value={<StatusBadge status={order.status} size="sm" />} />
            <DetailRow label="Buyer" value={order.buyer_name || order.customers?.name || null} />
            <DetailRow label="Buyer Email" value={order.buyer_email || order.customers?.email || null} />
            <DetailRow label="Total" value={`$${Number(order.total_amount || 0).toFixed(2)}`} />
            <DetailRow label="Created" value={new Date(order.created_at).toLocaleDateString()} />
            {order.notes && <DetailRow label="Notes" value={order.notes} />}

            {/* Ship-to address */}
            {shipToName && (
              <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)]">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Ship To</p>
                <div className="bg-gray-50 rounded-xl px-4 py-3">
                  <p className="text-[13px] font-medium text-gray-900">{shipToName}</p>
                  {shipToStreet1 && <p className="text-[12px] text-gray-600 mt-0.5">{shipToStreet1}</p>}
                  {order.ship_to_street2 && <p className="text-[12px] text-gray-600">{order.ship_to_street2}</p>}
                  {(shipToCity || shipToState || shipToZip) && (
                    <p className="text-[12px] text-gray-600">{[shipToCity, shipToState, shipToZip].filter(Boolean).join(', ')}</p>
                  )}
                  {!hasAddress && (
                    <p className="text-[11px] text-amber-600 mt-1.5">⚠ Incomplete address — needed for shipping rates</p>
                  )}
                </div>
              </div>
            )}

            {/* Order items */}
            {orderItems.length > 0 && (
              <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)]">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Items ({orderItems.length})</p>
                <div className="space-y-2">
                  {orderItems.map((item: any) => (
                    <div key={item.id} onClick={() => navigate(`/inventory/all?selected=${item.inventory_item_id}`)}
                      className="p-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-gray-900">{item.inventory_items?.inventory_id ?? '—'}</p>
                          <p className="text-[11px] text-gray-600 truncate">{item.inventory_items?.product_title ?? '—'}</p>
                          {item.inventory_items?.weight_oz && (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {item.inventory_items.weight_oz} oz
                              {item.inventory_items.length_in && ` · ${item.inventory_items.length_in}×${item.inventory_items.width_in}×${item.inventory_items.height_in} in`}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-[11px]">
                          <p className="text-gray-900 font-medium">Qty: {item.quantity}</p>
                          <p className="text-gray-500">${Number(item.unit_price || 0).toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={confirm === 'cancel'} title="Cancel Order" description={`Cancel order ${orderNum}?`} confirmLabel="Cancel Order" danger onConfirm={handleCancelOrder} onCancel={() => setConfirm(null)} loading={confirmLoading} />
      <ConfirmDialog open={confirm === 'delete'} title="Delete Order" description="Permanently delete this order?" confirmLabel="Delete" danger onConfirm={handleDelete} onCancel={() => setConfirm(null)} loading={confirmLoading} />
    </>
  );
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
export function Orders() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const _sortInit = (() => { try { return JSON.parse(localStorage.getItem('deryv.sort.orders') ?? 'null') ?? {}; } catch { return {}; } })();
  const [sortCol, setSortCol] = useState<string | null>(_sortInit.col ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_sortInit.dir ?? 'asc');
  const handleSort = (col: string) => {
    const next = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    const nextCol = sortCol === col ? col : col;
    setSortCol(nextCol);
    setSortDir(next as 'asc' | 'desc');
    localStorage.setItem('deryv.sort.orders', JSON.stringify({ col: nextCol, dir: next }));
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'create-order') { setShowCreate(true); setSearchParams(p => { p.delete('action'); return p; }, { replace: true }); }
  }, [searchParams, setSearchParams]);

  useEffect(() => { const id = searchParams.get('selected'); if (id) pendingSelId.current = id; }, [searchParams]);

  const statusFilter = VIEW_STATUS[view] ?? null;

  const { data: orders, loading, error, reload } = useOrgQuery<any>('orders', orgId, {
    select: 'id, order_id, channel, status, total_amount, notes, created_at, customer_id, buyer_name, buyer_email, ship_to_name, ship_to_street1, ship_to_street2, ship_to_city, ship_to_state, ship_to_zip, ship_to_country, customers(id, name, email, street1, city, state, zip), shipments(id, tracking_number), order_items(id, inventory_item_id, quantity, unit_price, inventory_items(id, inventory_id, product_title, lot_id, weight_oz, length_in, width_in, height_in, lots(lot_id)))',
    filter: statusFilter ? (q: any) => q.eq('status', statusFilter) : undefined,
    filterKey: statusFilter ?? 'all',
  });

  useEffect(() => {
    if (!pendingSelId.current || orders.length === 0) return;
    const id = pendingSelId.current; pendingSelId.current = null;
    const order = orders.find((o: any) => o.id === id);
    if (order) setSelectedId(id);
    else { setNotFoundMsg('Order not found.'); setTimeout(() => setNotFoundMsg(null), 5000); }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [orders, setSearchParams]);

  const { data: customers } = useOrgQuery<any>('customers', orgId, { select: 'id, name' });
  const { data: inventoryItems } = useOrgQuery<any>('inventory_items', orgId, {
    select: 'id, inventory_id, product_title, current_asking_price, weight_oz, length_in, width_in, height_in',
    filter: (q: any) => q.in('status', ['LISTING', 'ACTIVE']),
  });
  const { data: lots } = useOrgQuery<any>('lots', orgId, { select: 'id, lot_id, vendor_id, funding_partner_id' });
  const { data: vendors } = useOrgQuery<any>('vendors', orgId, { select: 'id, name' });
  const { data: partners } = useOrgQuery<any>('partners', orgId, { select: 'id, company_name' });

  const orderFilterDefs: FilterDef[] = [
    { type: 'select', key: 'channel', label: 'Channel', options: CHANNEL_OPTIONS },
    { type: 'select', key: 'customer_id', label: 'Customer', options: customers.map((c: any) => ({ value: c.id, label: c.name })) },
    { type: 'daterange', keyFrom: 'created_from', keyTo: 'created_to', label: 'Date Range' },
    { type: 'numrange', keyMin: 'total_min', keyMax: 'total_max', label: 'Total', prefix: '$' },
    { type: 'boolean', key: 'has_shipment', label: 'Has Shipment' },
    { type: 'boolean', key: 'missing_shipment', label: 'Missing Shipment' },
    { type: 'boolean', key: 'has_tracking', label: 'Has Tracking' },
    { type: 'boolean', key: 'missing_tracking', label: 'Missing Tracking' },
  ];

  const lotById = new Map(lots.map((l: any) => [l.id, l]));

  const filtered = orders.filter((o: any) => {
    if (search && !o.customers?.name?.toLowerCase().includes(search.toLowerCase()) && !o.buyer_name?.toLowerCase().includes(search.toLowerCase()) && !o.channel?.toLowerCase().includes(search.toLowerCase())) return false;
    const v = filterValues;
    if (v.channel && o.channel !== v.channel) return false;
    if (v.customer_id && o.customer_id !== v.customer_id) return false;
    if (v.created_from && o.created_at && o.created_at.slice(0,10) < v.created_from) return false;
    if (v.created_to && o.created_at && o.created_at.slice(0,10) > v.created_to) return false;
    if (v.total_min && Number(o.total_amount ?? 0) < Number(v.total_min)) return false;
    if (v.total_max && Number(o.total_amount ?? 0) > Number(v.total_max)) return false;
    const shipments = o.shipments ?? [];
    if (v.has_shipment === 'true' && shipments.length === 0) return false;
    if (v.missing_shipment === 'true' && shipments.length > 0) return false;
    if (v.has_tracking === 'true' && !shipments.some((s: any) => s.tracking_number)) return false;
    if (v.missing_tracking === 'true' && (shipments.length === 0 || shipments.some((s: any) => s.tracking_number))) return false;
    return true;
  });

  const selectedOrder = orders.find((o: any) => o.id === selectedId) ?? null;



  const sorted = sortItems(filtered, sortCol, sortDir, (item: any, col: string) => {
    if (col === 'order_id') return item.order_id ?? item.id;
    if (col === 'buyer') return item.buyer_name ?? item.customers?.name;
    if (col === 'channel') return item.channel;
    if (col === 'status') return item.status;
    if (col === 'total') return Number(item.total_amount ?? 0);
    if (col === 'date') return item.created_at;
    return null;
  });

  return (
    <div className="p-3 sm:p-6 max-w-[1300px] space-y-4">
      {notFoundMsg && <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">{notFoundMsg}</div>}
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
          <div className="divide-y divide-[rgba(0,0,0,0.04)]">{[1,2,3,4].map(i => <div key={i} className="h-14 px-5 py-3 flex items-center"><div className="h-4 w-40 bg-gray-100 animate-pulse rounded" /></div>)}</div>
        ) : error ? <ErrorState message={error} onRetry={reload} />
        : filtered.length === 0 ? (
          <EmptyState title="No orders found" description={search ? 'Try a different search.' : 'Create your first order.'} action={!search ? { label: 'Create Order', onClick: () => setShowCreate(true) } : undefined} />
        ) : (
          <>
            {/* Mobile card list */}
            <div className="sm:hidden divide-y divide-[rgba(0,0,0,0.05)]">
              {filtered.map((order: any) => (
                <div key={order.id} onClick={() => setSelectedId(order.id)}
                  className={`px-3 py-3 hover:bg-gray-50 active:bg-gray-100 cursor-pointer ${selectedId === order.id ? 'bg-[#F0FDF4]' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-mono font-medium text-gray-900">{order.order_id ? `#${order.order_id}` : `#${order.id.slice(0, 8).toUpperCase()}`}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">{order.buyer_name || order.customers?.name || '—'} · {CHANNEL_LABEL[order.channel] ?? order.channel}</p>
                    </div>
                    <p className="text-[14px] font-semibold text-gray-900 flex-shrink-0">${Number(order.total_amount || 0).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <StatusBadge status={order.status} size="sm" />
                    <span className="text-[11px] text-gray-400">{new Date(order.created_at).toLocaleDateString()}</span>
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
                        { label: 'Order #', col: 'order_id' },
                        { label: 'Buyer', col: 'buyer' },
                        { label: 'Channel', col: 'channel' },
                        { label: 'Status', col: 'status' },
                        { label: 'Total', col: 'total' },
                        { label: 'Date', col: 'date' },
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
                  {sorted.map((order: any, i: number) => (
                    <tr key={order.id} onClick={() => setSelectedId(order.id)}
                      className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedId === order.id ? 'bg-[#F0FDF4]' : ''} ${i < sorted.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                      <td className="px-5 py-3 text-[13px] font-mono font-medium text-gray-900">{order.order_id ? `#${order.order_id}` : `#${order.id.slice(0, 8).toUpperCase()}`}</td>
                      <td className="px-5 py-3 text-[13px] text-gray-700">{order.buyer_name || order.customers?.name || '—'}</td>
                      <td className="px-5 py-3"><span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{CHANNEL_LABEL[order.channel] ?? order.channel}</span></td>
                      <td className="px-5 py-3"><StatusBadge status={order.status} size="sm" /></td>
                      <td className="px-5 py-3 text-[13px] font-semibold text-gray-900 tabular-nums">${Number(order.total_amount || 0).toFixed(2)}</td>
                      <td className="px-5 py-3 text-[12px] text-gray-400">{new Date(order.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>


      <CreateOrderModal open={showCreate} onClose={() => setShowCreate(false)} orgId={orgId} userId={user?.id} inventoryItems={inventoryItems} onCreated={reload} />
      {selectedOrder && (
        <OrderDrawer order={selectedOrder} onClose={() => setSelectedId(null)} orgId={orgId} userId={user?.id} role={role} onUpdated={async () => { await reload(); }} />
      )}
    </div>
  );
}
