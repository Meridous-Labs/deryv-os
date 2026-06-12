import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Printer, Plus, Loader2, ScanLine, Pencil, Trash2, CheckCircle, XCircle, Package, MapPin } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, logActivity, createNotification } from '../../lib/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEditOps, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';
import { supabase } from '../../lib/supabase';

const SHIP_STATUSES = ['PENDING','LABEL_CREATED','PACKED','IN_TRANSIT','DELIVERED','EXCEPTION','LOST','RETURNED'];
const FULFILLMENT_TYPES = ['SHIP', 'LOCAL_PICKUP', 'BUYER_ARRANGED'];
const CARRIERS = ['UPS','FedEx','USPS','DHL','Other'];

const CARRIER_LABELS: Record<string, string> = {
  stamps_com: 'USPS',
  ups: 'UPS',
  ups_walleted: 'UPS',
  fedex: 'FedEx',
  fedex_walleted: 'FedEx',
  dhl_express: 'DHL',
  dhl_ecommerce: 'DHL',
  globalpost: 'GlobalPost',
};

// Rough transit-time estimates by service name, based on published carrier guidelines.
// These are typical ranges, not guarantees — actual transit varies by origin/destination.
const TRANSIT_ESTIMATES: { match: RegExp; label: string }[] = [
  { match: /priority mail express/i, label: '1 business day' },
  { match: /next day/i, label: '1 business day' },
  { match: /2nd day air|2 day/i, label: '2 business days' },
  { match: /3 day select/i, label: '3 business days' },
  { match: /priority mail/i, label: '1–3 business days' },
  { match: /first[- ]?class/i, label: '1–5 business days' },
  { match: /ground advantage/i, label: '2–5 business days' },
  { match: /parcel select ground/i, label: '2–9 business days' },
  { match: /ups ground/i, label: '1–5 business days' },
  { match: /fedex ground/i, label: '1–5 business days' },
  { match: /media mail/i, label: '2–8 business days' },
  { match: /globalpost/i, label: '4–9 business days' },
];

function estimateTransit(serviceName: string): string | null {
  for (const { match, label } of TRANSIT_ESTIMATES) {
    if (match.test(serviceName)) return label;
  }
  return null;
}

// Convert ShipStation service codes like "usps_first_class_mail" into "USPS First Class Mail"
function formatServiceCode(code: string): string {
  if (!code) return '';
  return code
    .split('_')
    .map(w => {
      const upper = w.toUpperCase();
      if (['USPS', 'UPS', 'DHL', 'FEDEX'].includes(upper)) return upper === 'FEDEX' ? 'FedEx' : upper;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

// Map technical/integration errors to plain-language messages for production users.
// Falls back to a generic message rather than exposing raw API/SQL error text.
function friendlyShippingError(raw: string): string {
  const msg = (raw || '').toLowerCase();

  if (msg.includes('insufficient') && msg.includes('balance')) {
    return 'Your shipping carrier account has insufficient balance. Please add funds in ShipStation and try again.';
  }
  if (msg.includes('shipstation not connected') || msg.includes('not configured')) {
    return 'Shipping isn\'t connected yet. Go to Integrations and connect ShipStation to enable rates and labels.';
  }
  if (msg.includes('warehouse') && (msg.includes('zip') || msg.includes('address'))) {
    return 'Your warehouse address is incomplete. Go to Settings → Warehouse and add a complete address with ZIP code.';
  }
  if (msg.includes('ship-to') || msg.includes('shipping address') || msg.includes('incomplete') && msg.includes('address')) {
    return 'This order is missing a complete shipping address. Edit the order to add the recipient\'s address.';
  }
  if (msg.includes('weight')) {
    return 'Package weight is required before rates can be fetched. Edit the shipment to add weight.';
  }
  if (msg.includes('carrier_code') || msg.includes('service_code') || msg.includes('carriercode') || msg.includes('servicecode')) {
    return 'Something went wrong selecting that shipping rate. Please try fetching rates again.';
  }
  if (msg.includes('no carriers configured')) {
    return 'No shipping carriers are set up in ShipStation. Connect a carrier in your ShipStation account first.';
  }
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('failed to send a request')) {
    return 'Couldn\'t reach the shipping service. Check your connection and try again, or contact support if this continues.';
  }
  if (msg.includes('unauthorized')) {
    return 'Your session has expired. Please refresh the page and try again.';
  }

  // Generic fallback — never show raw stack traces, SQL, or provider JSON to users
  return 'Something went wrong with this shipping request. Please try again, or contact support if the issue continues.';
}
const VIEW_STATUS: Record<string, string[]> = {
  'label-created': ['LABEL_CREATED'],
  'packed': ['PACKED'],
  'in-transit': ['IN_TRANSIT'],
  'delivered': ['DELIVERED'],
};

// ── Create Shipment Modal ─────────────────────────────────────────────────────
// Simplified: just order + package dimensions/weight + notes
// Carrier/service/tracking are all handled in the drawer after label creation

function CreateShipmentModal({ open, onClose, orgId, userId, orders, onCreated }: any) {
  const [form, setForm] = useState({
    order_id: '',
    fulfillment_type: 'SHIP',
    weight_oz: '',
    length_in: '',
    width_in: '',
    height_in: '',
    shipment_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  // Auto-fill dimensions from order's inventory items when order is selected
  useEffect(() => {
    if (!form.order_id) return;
    const order = orders.find((o: any) => o.id === form.order_id);
    if (!order?.order_items?.length) return;
    // Sum weight across all items, take max dimensions
    let totalWeight = 0;
    let maxLength = 0, maxWidth = 0, maxHeight = 0;
    for (const oi of order.order_items) {
      const inv = oi.inventory_items;
      if (!inv) continue;
      if (inv.weight_oz) totalWeight += Number(inv.weight_oz) * (oi.quantity || 1);
      if (inv.length_in) maxLength = Math.max(maxLength, Number(inv.length_in));
      if (inv.width_in) maxWidth = Math.max(maxWidth, Number(inv.width_in));
      if (inv.height_in) maxHeight = Math.max(maxHeight, Number(inv.height_in));
    }
    setForm(f => ({
      ...f,
      weight_oz: totalWeight > 0 ? String(totalWeight) : f.weight_oz,
      length_in: maxLength > 0 ? String(maxLength) : f.length_in,
      width_in: maxWidth > 0 ? String(maxWidth) : f.width_in,
      height_in: maxHeight > 0 ? String(maxHeight) : f.height_in,
    }));
  }, [form.order_id]);

  const reset = () => setForm({ order_id: '', fulfillment_type: 'SHIP', weight_oz: '', length_in: '', width_in: '', height_in: '', shipment_notes: '' });

  const save = async () => {
    if (!form.order_id) { setError('An order is required.'); return; }
    setSaving(true); setError(null);

    // Non-ship fulfillment types don't need weight/dimensions
    const isShip = form.fulfillment_type === 'SHIP';
    const initialStatus = form.fulfillment_type === 'LOCAL_PICKUP' ? 'LOCAL_PICKUP'
      : form.fulfillment_type === 'BUYER_ARRANGED' ? 'BUYER_ARRANGED'
      : 'PENDING';

    const { error: err } = await insertRow('shipments', {
      organization_id: orgId,
      order_id: form.order_id,
      status: initialStatus,
      fulfillment_type: form.fulfillment_type,
      weight_oz: isShip ? (parseFloat(form.weight_oz) || null) : null,
      length_in: isShip ? (parseFloat(form.length_in) || null) : null,
      width_in: isShip ? (parseFloat(form.width_in) || null) : null,
      height_in: isShip ? (parseFloat(form.height_in) || null) : null,
      shipment_notes: form.shipment_notes || null,
    });
    if (err) { setError('Failed to create shipment. Please try again or contact support.'); setSaving(false); return; }
    await logActivity(orgId, userId, `Shipment created (${form.fulfillment_type})`, 'shipments');
    setSaving(false); onCreated(); onClose(); reset();
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Shipment"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Create Shipment
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <FormField label="Order" required>
          <select className={selectCls} value={form.order_id} onChange={e => set('order_id', e.target.value)}>
            <option value="">— Select order —</option>
            {orders.map((o: any) => (
              <option key={o.id} value={o.id}>
                {o.order_id ? `#${o.order_id}` : `#${o.id.slice(0, 8).toUpperCase()}`}
                {o.buyer_name ? ` — ${o.buyer_name}` : ''}
              </option>
            ))}
          </select>
        </FormField>

        {/* Package dimensions */}
        <FormField label="Fulfillment Type" required>
          <select className={selectCls} value={form.fulfillment_type} onChange={e => set('fulfillment_type', e.target.value)}>
            <option value="SHIP">Ship — Carrier Label</option>
            <option value="LOCAL_PICKUP">Local Pickup</option>
            <option value="BUYER_ARRANGED">Buyer Arranged Shipping</option>
          </select>
        </FormField>

        {form.fulfillment_type === 'SHIP' && (
        <div>
          <label className="text-[11px] font-medium text-gray-500 mb-2 block uppercase tracking-wide">Package Dimensions (optional — required for rates)</label>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Weight (oz)">
              <input type="number" className={inputCls} value={form.weight_oz} onChange={e => set('weight_oz', e.target.value)} placeholder="16" min="0" step="0.1" />
            </FormField>
            <FormField label="Length (in)">
              <input type="number" className={inputCls} value={form.length_in} onChange={e => set('length_in', e.target.value)} placeholder="12" min="0" step="0.1" />
            </FormField>
            <FormField label="Width (in)">
              <input type="number" className={inputCls} value={form.width_in} onChange={e => set('width_in', e.target.value)} placeholder="8" min="0" step="0.1" />
            </FormField>
            <FormField label="Height (in)">
              <input type="number" className={inputCls} value={form.height_in} onChange={e => set('height_in', e.target.value)} placeholder="4" min="0" step="0.1" />
            </FormField>
          </div>
        </div>
        )}

        <FormField label="Notes">
          <textarea className={textareaCls} rows={2} value={form.shipment_notes} onChange={e => set('shipment_notes', e.target.value)} placeholder="Optional notes..." />
        </FormField>
      </div>
    </Modal>
  );
}

// ── Shipment Drawer ───────────────────────────────────────────────────────────

function ShipmentDrawer({ shipment, onClose, orgId, userId, role, onUpdated }: any) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    carrier: shipment.carrier ?? '',
    service: shipment.service ?? '',
    tracking_number: shipment.tracking_number ?? '',
    status: shipment.status,
    estimated_delivery: shipment.estimated_delivery ?? '',
    weight_oz: shipment.weight_oz != null ? String(shipment.weight_oz) : '',
    length_in: shipment.length_in != null ? String(shipment.length_in) : '',
    width_in: shipment.width_in != null ? String(shipment.width_in) : '',
    height_in: shipment.height_in != null ? String(shipment.height_in) : '',
    shipment_notes: shipment.shipment_notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'deliver' | 'delete'>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [rates, setRates] = useState<any[]>([]);
  const [loadingRates, setLoadingRates] = useState(false);
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [showRates, setShowRates] = useState(false);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  const orderNum = shipment.orders
    ? (shipment.orders.order_id ? `#${shipment.orders.order_id}` : `#${shipment.orders.id?.slice(0, 8).toUpperCase()}`)
    : '—';

  const orderItems = shipment.orders?.order_items ?? [];

  // Ship-to address from order
  const order = shipment.orders;
  const shipToName = order?.ship_to_name || order?.buyer_name || order?.customers?.name || null;
  const shipToStreet1 = order?.ship_to_street1 || order?.customers?.street1 || null;
  const shipToCity = order?.ship_to_city || order?.customers?.city || null;
  const shipToState = order?.ship_to_state || order?.customers?.state || null;
  const shipToZip = order?.ship_to_zip || order?.customers?.zip || null;
  const hasAddress = !!(shipToStreet1 && shipToCity && shipToState && shipToZip);
  const hasWeight = !!(shipment.weight_oz);
  const hasLabel = !!shipment.label_url;
  const canGetRates = hasAddress && hasWeight;

  const saveEdit = async () => {
    setSaving(true); setError(null);
    const statusChanged = editForm.status !== shipment.status;
    const { error: err } = await updateRow('shipments', shipment.id, {
      carrier: editForm.carrier || null,
      service: editForm.service || null,
      tracking_number: editForm.tracking_number || null,
      status: editForm.status,
      estimated_delivery: editForm.estimated_delivery || null,
      weight_oz: parseFloat(editForm.weight_oz) || null,
      length_in: parseFloat(editForm.length_in) || null,
      width_in: parseFloat(editForm.width_in) || null,
      height_in: parseFloat(editForm.height_in) || null,
      shipment_notes: editForm.shipment_notes || null,
    });
    if (err) { setError('Failed to save shipment changes. Please try again or contact support.'); setSaving(false); return; }

    if (statusChanged && shipment.order_id) {
      if (editForm.status === 'IN_TRANSIT') await updateRow('orders', shipment.order_id, { status: 'SHIPPED' });
      else if (editForm.status === 'DELIVERED') await updateRow('orders', shipment.order_id, { status: 'DELIVERED' });
    }

    await logActivity(orgId, userId, `Shipment updated`, 'shipments', shipment.id);
    setSaving(false); setEditing(false);
    await onUpdated();
  };

  const handleDeliver = async () => {
    setConfirmLoading(true);
    await updateRow('shipments', shipment.id, { status: 'DELIVERED', delivered_at: new Date().toISOString() });
    if (shipment.order_id) await updateRow('orders', shipment.order_id, { status: 'DELIVERED' });
    const label = shipment.tracking_number || shipment.id.slice(0, 8).toUpperCase();
    void createNotification(orgId, 'Shipment delivered', `${shipment.carrier} ${label}`, {
      userId, entityType: 'shipments', entityId: shipment.id,
      route: `/shipping/all?selected=${shipment.id}`, priority: 'medium',
    });
    await logActivity(orgId, userId, 'Shipment marked as delivered', 'shipments', shipment.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const handleDelete = async () => {
    setConfirmLoading(true);
    await deleteRow('shipments', shipment.id);
    await logActivity(orgId, userId, 'Shipment deleted', 'shipments', shipment.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const getRates = async () => {
    setLoadingRates(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('shipstation-rates', {
        body: {
          organization_id: orgId,
          shipment_id: shipment.id,
        },
      });
      if (error) {
        let detail = error.message;
        try {
          const body = await error.context?.json();
          if (body?.error) detail = body.error;
        } catch {}
        throw new Error(detail);
      }
      if (!data.success) throw new Error(data.error || 'Failed to fetch rates');
      setRates(data.rates ?? []);
      setShowRates(true);
      if ((data.rates ?? []).length === 0) setError('No rates were returned for this shipment. Double-check the shipping address, weight, and dimensions.');
    } catch (err: any) {
      setError(friendlyShippingError(err.message));
    } finally {
      setLoadingRates(false);
    }
  };

  const createLabel = async (carrierCode: string, serviceCode: string, estimatedDelivery?: string, cost?: number) => {
    setCreatingLabel(true); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('shipstation-label', {
        body: {
          organization_id: orgId,
          shipment_id: shipment.id,
          carrier_code: carrierCode,
          service_code: serviceCode,
        },
      });
      if (error) {
        let detail = error.message;
        try {
          const body = await error.context?.json();
          if (body?.error) detail = body.error;
        } catch {}
        throw new Error(detail);
      }
      if (data.success) {
        setShowRates(false);
        setRates([]);
        await onUpdated();
      } else {
        throw new Error(data.error || 'Failed to create label');
      }
    } catch (err: any) {
      setError(friendlyShippingError(err.message));
    } finally {
      setCreatingLabel(false);
    }
  };

  const printLabel = () => {
    if (shipment.label_url) window.open(shipment.label_url, '_blank');
  };

  const canEdit = canEditOps(role);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={editing ? 'Edit Shipment' : 'Shipment Details'}
        subtitle={`Order ${orderNum}`}
        footer={editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(false); setError(null); }} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
              {saving && <Loader2 size={12} className="animate-spin" />}Save Changes
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {canEdit && !hasLabel && (
              <button onClick={getRates} disabled={loadingRates || !canGetRates}
                title={!hasAddress ? 'Missing ship-to address on order' : !hasWeight ? 'Missing package weight' : ''}
                className="flex items-center gap-1.5 px-3 py-2 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-50">
                {loadingRates ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
                Get Rates
              </button>
            )}
            {hasLabel && (
              <button onClick={printLabel} className="flex items-center gap-1.5 px-3 py-2 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg">
                <Printer size={13} />Print Label
              </button>
            )}
            {canEdit && shipment.status !== 'DELIVERED' && (
              <button onClick={() => setConfirm('deliver')} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                Mark Delivered
              </button>
            )}
            {canEdit && (
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13px] font-medium rounded-lg">
                <Pencil size={13} />Edit
              </button>
            )}
            {isAdmin(role) && (
              <button onClick={() => setConfirm('delete')} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                <Trash2 size={13} />Delete
              </button>
            )}
          </div>
        )}
      >
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>}

        {/* Missing info warnings */}
        {!hasAddress && !editing && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 mb-4">
            <MapPin size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-700">No ship-to address on this order. Edit the order to add a shipping address before getting rates.</p>
          </div>
        )}
        {!hasWeight && !editing && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5 mb-4">
            <Package size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-[12px] text-amber-700">No package weight set. Click Edit to add weight and dimensions.</p>
          </div>
        )}

        {editing ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Carrier">
                <select className={selectCls} value={editForm.carrier} onChange={e => set('carrier', e.target.value)}>
                  <option value="">— Auto (from label) —</option>
                  {CARRIERS.map(c => <option key={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField label="Service">
                <input className={inputCls} value={editForm.service} onChange={e => set('service', e.target.value)} placeholder="Auto-filled after label" />
              </FormField>
            </div>
            <FormField label="Tracking Number">
              <input className={inputCls} value={editForm.tracking_number} onChange={e => set('tracking_number', e.target.value)} placeholder="Auto-filled after label creation" />
            </FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Status">
                <select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>
                  {SHIP_STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </FormField>
              <FormField label="Est. Delivery">
                <input type="date" className={inputCls} value={editForm.estimated_delivery} onChange={e => set('estimated_delivery', e.target.value)} />
              </FormField>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-2 block uppercase tracking-wide">Package Dimensions</label>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Weight (oz)">
                  <input type="number" className={inputCls} value={editForm.weight_oz} onChange={e => set('weight_oz', e.target.value)} placeholder="16" min="0" step="0.1" />
                </FormField>
                <FormField label="Length (in)">
                  <input type="number" className={inputCls} value={editForm.length_in} onChange={e => set('length_in', e.target.value)} placeholder="12" min="0" step="0.1" />
                </FormField>
                <FormField label="Width (in)">
                  <input type="number" className={inputCls} value={editForm.width_in} onChange={e => set('width_in', e.target.value)} placeholder="8" min="0" step="0.1" />
                </FormField>
                <FormField label="Height (in)">
                  <input type="number" className={inputCls} value={editForm.height_in} onChange={e => set('height_in', e.target.value)} placeholder="4" min="0" step="0.1" />
                </FormField>
              </div>
            </div>
            <FormField label="Shipment Notes">
              <textarea className={textareaCls} rows={2} value={editForm.shipment_notes} onChange={e => set('shipment_notes', e.target.value)} />
            </FormField>
          </div>
        ) : (
          <div>
            {/* Ship-to address */}
            {shipToName && (
              <div className="mb-4 bg-gray-50 rounded-xl px-4 py-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Ship To</p>
                <p className="text-[13px] font-medium text-gray-900">{shipToName}</p>
                {shipToStreet1 && <p className="text-[12px] text-gray-600">{shipToStreet1}</p>}
                {(shipToCity || shipToState || shipToZip) && (
                  <p className="text-[12px] text-gray-600">{[shipToCity, shipToState, shipToZip].filter(Boolean).join(', ')}</p>
                )}
              </div>
            )}

            <DetailRow label="Order" value={<span className="font-mono">{orderNum}</span>} />
            <DetailRow label="Status" value={<StatusBadge status={shipment.status} size="sm" />} />
            {shipment.carrier && <DetailRow label="Carrier" value={CARRIER_LABELS[shipment.carrier] || shipment.carrier?.toUpperCase()} />}
            {shipment.service && <DetailRow label="Service" value={formatServiceCode(shipment.service)} />}
            {shipment.tracking_number && (
              <DetailRow label="Tracking" value={
                <a href={`https://www.google.com/search?q=${shipment.tracking_number}`} target="_blank" rel="noreferrer"
                  className="font-mono text-[12px] text-[#3ECF8E] hover:underline">{shipment.tracking_number}</a>
              } />
            )}
            {shipment.estimated_delivery && <DetailRow label="Est. Delivery" value={new Date(shipment.estimated_delivery).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} />}
            {shipment.label_cost && <DetailRow label="Label Cost" value={`$${Number(shipment.label_cost).toFixed(2)}`} />}
            {shipment.weight_oz && <DetailRow label="Weight" value={`${shipment.weight_oz} oz`} />}
            {(shipment.length_in || shipment.width_in || shipment.height_in) && (
              <DetailRow label="Dimensions" value={`${shipment.length_in ?? '?'} × ${shipment.width_in ?? '?'} × ${shipment.height_in ?? '?'} in`} />
            )}
            {shipment.shipment_notes && <DetailRow label="Notes" value={shipment.shipment_notes} />}
            <DetailRow label="Created" value={new Date(shipment.created_at).toLocaleDateString()} />

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
                            <p className="text-[10px] text-gray-400 mt-0.5">{item.inventory_items.weight_oz} oz</p>
                          )}
                        </div>
                        <span className="text-[11px] text-gray-500">Qty: {item.quantity}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Rate selection */}
            {showRates && (
              <div className="mt-4 pt-4 border-t border-[rgba(0,0,0,0.06)]">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                    Available Rates {rates.length > 0 ? `(${rates.length})` : ''}
                  </p>
                  <button onClick={() => setShowRates(false)} className="text-[11px] text-gray-400 hover:text-gray-600">Hide</button>
                </div>
                {rates.length === 0 ? (
                  <p className="text-[13px] text-gray-400 py-2">No rates available.</p>
                ) : (
                  <div className="space-y-2">
                    {rates.map((rate: any, idx: number) => (
                      <div key={idx} className="p-3 bg-white border border-[rgba(0,0,0,0.08)] rounded-xl hover:border-[#3ECF8E]/40 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-gray-900">{CARRIER_LABELS[rate.carrierCode] || rate.carrierCode?.toUpperCase() || 'Carrier'} — {rate.serviceName}</p>
                            <div className="flex items-center gap-3 mt-0.5">
                              {rate.deliveryDays ? (
                                <p className="text-[11px] text-gray-500">
                                  {rate.deliveryDays} business day{rate.deliveryDays !== 1 ? 's' : ''}
                                  {rate.deliveryDate && ` · Arrives ${new Date(rate.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                </p>
                              ) : rate.deliveryDate ? (
                                <p className="text-[11px] text-gray-500">
                                  Arrives <span className="font-medium text-gray-700">{new Date(rate.deliveryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                                </p>
                              ) : (() => {
                                const est = estimateTransit(rate.serviceName || '');
                                return est ? (
                                  <p className="text-[11px] text-gray-500">~{est} <span className="text-gray-400">(typical)</span></p>
                                ) : (
                                  <p className="text-[11px] text-gray-400">Transit time unavailable</p>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <div className="text-right">
                              <p className="text-[16px] font-bold text-gray-900">${(rate.shipmentCost ?? 0).toFixed(2)}</p>
                              {rate.otherCost > 0 && <p className="text-[10px] text-gray-400">+${rate.otherCost.toFixed(2)} fees</p>}
                            </div>
                            <button
                              onClick={() => createLabel(rate.carrierCode, rate.serviceCode, rate.deliveryDate, rate.shipmentCost)}
                              disabled={creatingLabel}
                              className="px-3 py-1.5 bg-gray-900 hover:bg-gray-700 text-white text-[12px] font-medium rounded-lg disabled:opacity-60 whitespace-nowrap"
                            >
                              {creatingLabel ? <Loader2 size={11} className="animate-spin" /> : 'Select & Create Label'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog open={confirm === 'deliver'} title="Mark as Delivered"
        description="Mark this shipment as delivered?" confirmLabel="Mark Delivered"
        onConfirm={handleDeliver} onCancel={() => setConfirm(null)} loading={confirmLoading} />
      <ConfirmDialog open={confirm === 'delete'} title="Delete Shipment"
        description="Permanently delete this shipment record? This cannot be undone." confirmLabel="Delete" danger
        onConfirm={handleDelete} onCancel={() => setConfirm(null)} loading={confirmLoading} />
    </>
  );
}

// ── Main Shipping Page ────────────────────────────────────────────────────────

export function Shipping() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  const [packingShipmentId, setPackingShipmentId] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'create-shipment') {
      setShowCreate(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  const statusValues = VIEW_STATUS[view] ?? null;

  const { data: shipments, loading, error, reload } = useOrgQuery<any>('shipments', orgId, {
    select: 'id, shipment_id, carrier, service, tracking_number, status, estimated_delivery, shipment_notes, label_url, label_cost, weight_oz, length_in, width_in, height_in, created_at, packed_at, packed_by, carrier_code, service_code, orders(id, order_id, buyer_name, buyer_email, ship_to_name, ship_to_street1, ship_to_street2, ship_to_city, ship_to_state, ship_to_zip, ship_to_country, customers(name, street1, city, state, zip), order_items(id, inventory_item_id, quantity, packed_quantity, packed_at, packed_by, inventory_items(id, inventory_id, product_title, lot_id, weight_oz, lots(lot_id))))',
    filter: statusValues ? (q: any) => q.in('status', statusValues) : undefined,
    filterKey: statusValues ? statusValues.join(',') : 'all',
  });

  useEffect(() => {
    if (!pendingSelId.current || shipments.length === 0) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const found = shipments.find((s: any) => s.id === id);
    if (found) setSelectedId(id);
    else { setNotFoundMsg('Shipment not found.'); setTimeout(() => setNotFoundMsg(null), 5000); }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [shipments, setSearchParams]);

  const { data: orders } = useOrgQuery<any>('orders', orgId, {
    select: 'id, order_id, buyer_name, order_items(id, quantity, inventory_items(id, weight_oz, length_in, width_in, height_in))',
    filter: (q: any) => q.in('status', ['OPEN', 'PICKING', 'PACKED']),
  });

  const shipFilterDefs: FilterDef[] = [
    { type: 'select', key: 'carrier', label: 'Carrier', options: CARRIERS.map(c => ({ value: c, label: c })) },
    { type: 'boolean', key: 'missing_tracking', label: 'Missing Tracking' },
    { type: 'daterange', keyFrom: 'delivered_from', keyTo: 'delivered_to', label: 'Expected Delivery' },
  ];

  const filteredShipments = shipments.filter((s: any) => {
    const v = filterValues;
    if (v.carrier && s.carrier !== v.carrier) return false;
    if (v.missing_tracking === 'true' && s.tracking_number) return false;
    const deliveredDate = s.estimated_delivery ?? '';
    if (v.delivered_from && deliveredDate && deliveredDate.slice(0,10) < v.delivered_from) return false;
    if (v.delivered_to && deliveredDate && deliveredDate.slice(0,10) > v.delivered_to) return false;
    return true;
  });

  const selectedShipment = shipments.find((s: any) => s.id === selectedId) ?? null;
  const packingShipment = shipments.find((s: any) => s.id === packingShipmentId) ?? null;

  const handlePackScan = async () => {
    const input = scanInput.trim();
    if (!input || scanning || !packingShipmentId || !orgId) return;
    setScanning(true); setScanError(null); setScanSuccess(null);
    try {
      const shipment = packingShipment;
      if (!shipment?.orders?.order_items) { setScanError('No order items found.'); setScanning(false); return; }

      let itemId = null;
      const selectedMatch = input.match(/selected=([a-f0-9-]{36})/i);
      if (selectedMatch) {
        itemId = selectedMatch[1];
      } else {
        const { data: items } = await supabase.from('inventory_items').select('id')
          .eq('organization_id', orgId).or(`id.eq.${input},inventory_id.eq.${input},barcode_value.eq.${input}`).limit(1);
        if (items && items.length > 0) itemId = items[0].id;
      }

      if (!itemId) {
        setScanError(`No item found for: ${input}`);
        await insertRow('packing_scans', { organization_id: orgId, shipment_id: packingShipmentId, scanned_value: input, result: 'NOT_FOUND', scanned_by: user?.id });
        setScanning(false); setTimeout(() => setScanError(null), 5000); return;
      }

      const orderItem = shipment.orders.order_items.find((oi: any) => oi.inventory_item_id === itemId);
      if (!orderItem) {
        setScanError('⚠️ WRONG ITEM — not in this shipment');
        await insertRow('packing_scans', { organization_id: orgId, shipment_id: packingShipmentId, inventory_item_id: itemId, scanned_value: input, result: 'WRONG_ITEM', scanned_by: user?.id });
        setScanning(false); setTimeout(() => setScanError(null), 5000); return;
      }

      const packedQty = orderItem.packed_quantity ?? 0;
      const requiredQty = orderItem.quantity ?? 1;
      if (packedQty >= requiredQty) {
        setScanError('⚠️ DUPLICATE — already fully packed');
        setScanning(false); setTimeout(() => setScanError(null), 5000); return;
      }

      const newPackedQty = packedQty + 1;
      const updateData: any = { packed_quantity: newPackedQty };
      if (newPackedQty >= requiredQty) { updateData.packed_at = new Date().toISOString(); updateData.packed_by = user?.id; }

      await updateRow('order_items', orderItem.id, updateData);
      await updateRow('inventory_items', itemId, { status: 'PACKED' });
      await insertRow('packing_scans', { organization_id: orgId, shipment_id: packingShipmentId, order_item_id: orderItem.id, inventory_item_id: itemId, scanned_value: input, result: 'PACKED', scanned_by: user?.id });

      const desc = orderItem.inventory_items?.product_title || orderItem.inventory_items?.inventory_id || 'Item';
      setScanSuccess(`✓ ${desc} packed (${newPackedQty}/${requiredQty})`);
      await logActivity(orgId, user?.id, 'Item packed for shipment', 'shipments', packingShipmentId);
      setScanInput('');
      await reload();
      setTimeout(() => setScanSuccess(null), 3000);

      const allPacked = shipment.orders.order_items.every((oi: any) => {
        const p = oi.id === orderItem.id ? newPackedQty : (oi.packed_quantity ?? 0);
        return p >= (oi.quantity ?? 1);
      });
      if (allPacked) {
        await updateRow('orders', shipment.orders.id, { status: 'PACKED' });
        await updateRow('shipments', packingShipmentId, { status: 'PACKED', packed_at: new Date().toISOString(), packed_by: user?.id });
        setScanSuccess('🎉 All items packed — ready for label!');
        await reload();
      }
      setTimeout(() => scanInputRef.current?.focus(), 100);
    } catch (err: any) {
      setScanError(friendlyShippingError(err.message));
      setTimeout(() => setScanError(null), 5000);
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="p-6 max-w-[1300px] space-y-5">
      {notFoundMsg && <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">{notFoundMsg}</div>}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Shipping</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Fulfillment queue and shipment management</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
          <Plus size={13} />Create Shipment
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">Shipments</h3>
            <span className="text-[12px] text-gray-400">{filteredShipments.length} shipments</span>
          </div>
          <FilterBar defs={shipFilterDefs} values={filterValues} onChange={setFilterValues} />
          {loading ? (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">{[1,2,3].map(i => <div key={i} className="h-12 px-5 py-3 flex items-center"><div className="h-4 w-48 bg-gray-100 animate-pulse rounded" /></div>)}</div>
          ) : error ? <ErrorState message={error} onRetry={reload} />
          : filteredShipments.length === 0 ? <EmptyState title="No shipments" description="Create a shipment to get started." action={{ label: 'Create Shipment', onClick: () => setShowCreate(true) }} />
          : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[rgba(0,0,0,0.06)]">
                    {['Order', 'Ship To', 'Carrier', 'Tracking', 'Status', 'Est. Delivery'].map(h => (
                      <th key={h} className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredShipments.map((shp: any, i: number) => (
                    <tr key={shp.id} onClick={() => setSelectedId(shp.id)}
                      className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedId === shp.id ? 'bg-[#F0FDF4]' : ''} ${i < filteredShipments.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                      <td className="px-5 py-3 text-[12px] font-mono text-gray-700">
                        {shp.orders ? (shp.orders.order_id ? `#${shp.orders.order_id}` : `#${shp.orders.id?.slice(0, 8).toUpperCase()}`) : '—'}
                      </td>
                      <td className="px-5 py-3 text-[12px] text-gray-600">
                        {shp.orders?.ship_to_name || shp.orders?.buyer_name || shp.orders?.customers?.name || '—'}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-gray-700">{shp.carrier ? (CARRIER_LABELS[shp.carrier] || shp.carrier.toUpperCase()) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-5 py-3">
                        {shp.tracking_number
                          ? <span className="text-[11px] font-mono text-gray-500">{shp.tracking_number.slice(0, 16)}…</span>
                          : <span className="text-gray-300 text-[12px]">—</span>}
                      </td>
                      <td className="px-5 py-3"><StatusBadge status={shp.status} size="sm" /></td>
                      <td className="px-5 py-3 text-[12px] text-gray-400">
                        {shp.estimated_delivery ? new Date(shp.estimated_delivery).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Scan to Pack panel */}
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-1">Scan to Pack</h3>
          <p className="text-[12px] text-gray-400 mb-4">Scan inventory labels to pack shipments.</p>
          {!packingShipment ? (
            <div className="text-center py-6">
              <ScanLine size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-[13px] text-gray-500 mb-4">Select a shipment to begin scan-to-pack.</p>
              {selectedShipment && ['LABEL_CREATED', 'PACKED'].includes(selectedShipment.status) && (
                <button onClick={() => { setPackingShipmentId(selectedShipment.id); setTimeout(() => scanInputRef.current?.focus(), 100); }}
                  className="px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg flex items-center gap-1.5 mx-auto">
                  <ScanLine size={13} />Start Packing
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Packing</p>
                <p className="text-[13px] font-semibold text-gray-900">
                  {packingShipment.orders?.order_id ? `#${packingShipment.orders.order_id}` : `#${packingShipment.id.slice(0, 8)}`}
                </p>
                {(packingShipment.orders?.ship_to_name || packingShipment.orders?.buyer_name) && (
                  <p className="text-[12px] text-gray-600 mt-0.5">{packingShipment.orders.ship_to_name || packingShipment.orders.buyer_name}</p>
                )}
              </div>
              {(scanError || scanSuccess) && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${scanError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
                  {scanError ? <XCircle size={14} /> : <CheckCircle size={14} />}
                  <span className="text-[12px] font-medium">{scanError || scanSuccess}</span>
                </div>
              )}
              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5 block">Scan Label</label>
                <div className="relative">
                  <ScanLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3ECF8E]" />
                  <input ref={scanInputRef} value={scanInput} onChange={e => setScanInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePackScan()} placeholder="Scan QR or inventory ID..."
                    disabled={scanning}
                    className="pl-7 pr-16 py-2 text-[13px] bg-[#F0FDF4] border border-[#3ECF8E]/20 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/30 focus:border-[#3ECF8E] placeholder:text-gray-500 disabled:opacity-60" />
                  {scanInput && (
                    <button onClick={handlePackScan} disabled={scanning}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-medium bg-[#3ECF8E] text-white rounded hover:bg-[#38c484] disabled:opacity-60">
                      {scanning ? <Loader2 size={10} className="animate-spin" /> : 'Pack'}
                    </button>
                  )}
                </div>
              </div>
              {packingShipment.orders?.order_items?.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">Items</p>
                  <div className="space-y-1.5">
                    {packingShipment.orders.order_items.map((item: any) => {
                      const packed = item.packed_quantity ?? 0;
                      const required = item.quantity ?? 1;
                      const complete = packed >= required;
                      return (
                        <div key={item.id} className={`flex items-center gap-2 p-2 rounded-lg border ${complete ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${complete ? 'bg-green-500' : 'bg-gray-200'}`}>
                            {complete ? <CheckCircle size={12} className="text-white" /> : <span className="text-[9px] font-bold text-gray-500">{packed}/{required}</span>}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[12px] font-medium truncate ${complete ? 'text-green-900 line-through' : 'text-gray-900'}`}>
                              {item.inventory_items?.inventory_id || `Item ${item.id.slice(0, 8)}`}
                            </p>
                            {item.inventory_items?.product_title && (
                              <p className={`text-[11px] truncate ${complete ? 'text-green-700' : 'text-gray-600'}`}>{item.inventory_items.product_title}</p>
                            )}
                          </div>
                          <span className={`text-[11px] font-mono ${complete ? 'text-green-700' : 'text-gray-500'}`}>{packed}/{required}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              <button onClick={() => { setPackingShipmentId(null); setScanInput(''); setScanError(null); setScanSuccess(null); }}
                className="w-full px-3 py-2 border border-gray-200 text-gray-600 text-[13px] rounded-lg hover:bg-gray-50">
                Stop Packing
              </button>
            </div>
          )}
        </div>
      </div>

      <CreateShipmentModal open={showCreate} onClose={() => setShowCreate(false)} orgId={orgId} userId={user?.id} orders={orders} onCreated={reload} />
      {selectedShipment && (
        <ShipmentDrawer shipment={selectedShipment} onClose={() => setSelectedId(null)} orgId={orgId} userId={user?.id} role={role}
          onUpdated={async () => { await reload(); }} />
      )}
    </div>
  );
}
