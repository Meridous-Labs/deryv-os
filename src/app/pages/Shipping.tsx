import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Printer, Plus, Loader2, ScanLine, Pencil, Trash2, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, logActivity, createNotification } from '../../lib/hooks';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEditOps, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';
import { supabase } from '../../lib/supabase';

const SHIP_STATUSES = ['LABEL_CREATED','PACKED','IN_TRANSIT','DELIVERED','EXCEPTION','LOST','RETURNED'];
const EXCEPTION_STATUSES: Record<string, { title: string; priority: 'high' }> = {
  EXCEPTION: { title: 'Shipment exception',  priority: 'high' },
  LOST:      { title: 'Shipment lost',       priority: 'high' },
  RETURNED:  { title: 'Shipment returned',   priority: 'high' },
};
const CARRIERS = ['UPS','FedEx','USPS','DHL','Other'];
const VIEW_STATUS: Record<string, string[]> = {
  'label-created': ['LABEL_CREATED'],
  'packed': ['PACKED'],
  'in-transit': ['IN_TRANSIT'],
  'delivered': ['DELIVERED'],
};

function CreateShipmentModal({ open, onClose, orgId, userId, orders, onCreated }: any) {
  const [form, setForm] = useState({
    order_id: '',
    carrier: 'UPS',
    service: '',
    tracking_number: '',
    status: 'LABEL_CREATED',
    estimated_delivery: '',
    shipment_notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.order_id) { setError('An order is required.'); return; }
    if (!form.carrier) { setError('Carrier is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('shipments', {
      organization_id: orgId,
      order_id: form.order_id,
      carrier: form.carrier,
      service: form.service || null,
      tracking_number: form.tracking_number || null,
      status: form.status,
      estimated_delivery: form.estimated_delivery || null,
      shipment_notes: form.shipment_notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Shipment created via ${form.carrier}`, 'shipments');
    setSaving(false); onCreated(); onClose();
    setForm({ order_id: '', carrier: 'UPS', service: '', tracking_number: '', status: 'LABEL_CREATED', estimated_delivery: '', shipment_notes: '' });
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
                {o.order_id ? `#${o.order_id}` : `#${o.id.slice(0, 8).toUpperCase()}`} {o.customers?.name ? `(${o.customers.name})` : ''}
              </option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Carrier" required><select className={selectCls} value={form.carrier} onChange={e => set('carrier', e.target.value)}>{CARRIERS.map(c => <option key={c}>{c}</option>)}</select></FormField>
          <FormField label="Service"><input className={inputCls} value={form.service} onChange={e => set('service', e.target.value)} placeholder="Ground, Priority..." /></FormField>
        </div>
        <FormField label="Tracking Number"><input className={inputCls} value={form.tracking_number} onChange={e => set('tracking_number', e.target.value)} placeholder="1Z999AA10123456784" /></FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Status"><select className={selectCls} value={form.status} onChange={e => set('status', e.target.value)}>{SHIP_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
          <FormField label="Est. Delivery"><input type="date" className={inputCls} value={form.estimated_delivery} onChange={e => set('estimated_delivery', e.target.value)} /></FormField>
        </div>
        <FormField label="Shipment Notes">
          <textarea className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E]" rows={2} value={form.shipment_notes} onChange={e => set('shipment_notes', e.target.value)} placeholder="Optional notes..." />
        </FormField>
      </div>
    </Modal>
  );
}

function ShipmentDrawer({ shipment, onClose, orgId, userId, role, onUpdated }: any) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    carrier: shipment.carrier,
    service: shipment.service ?? '',
    tracking_number: shipment.tracking_number ?? '',
    status: shipment.status,
    estimated_delivery: shipment.estimated_delivery ?? '',
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

  // Show full order_id if available
  const orderNum = shipment.orders
    ? (shipment.orders.order_id ? `#${shipment.orders.order_id}` : `#${shipment.orders.id.slice(0, 8).toUpperCase()}`)
    : '—';

  const orderItems = shipment.orders?.order_items ?? [];

  const saveEdit = async () => {
    if (!editForm.carrier) { setError('Carrier is required.'); return; }
    setSaving(true); setError(null);
    const statusChanged = editForm.status !== shipment.status;

    // Update shipment
    const { error: err } = await updateRow('shipments', shipment.id, {
      carrier: editForm.carrier,
      service: editForm.service || null,
      tracking_number: editForm.tracking_number || null,
      status: editForm.status,
      estimated_delivery: editForm.estimated_delivery || null,
      shipment_notes: editForm.shipment_notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }

    // Status effects: update order status if appropriate
    if (statusChanged && shipment.order_id) {
      if (editForm.status === 'IN_TRANSIT' && shipment.orders?.status !== 'SHIPPED') {
        await updateRow('orders', shipment.order_id, { status: 'SHIPPED' });
      } else if (editForm.status === 'DELIVERED' && shipment.orders?.status !== 'DELIVERED') {
        await updateRow('orders', shipment.order_id, { status: 'DELIVERED' });
      }
    }

    // Create notifications for status changes
    if (statusChanged) {
      const label = editForm.tracking_number || shipment.id.slice(0, 8).toUpperCase();

      if (editForm.status === 'DELIVERED') {
        void createNotification(orgId, 'Shipment delivered', `${editForm.carrier} ${label}`, {
          userId, entityType: 'shipments', entityId: shipment.id,
          route: `/shipping/all?selected=${shipment.id}`, priority: 'medium',
        });
      } else if (editForm.status === 'EXCEPTION') {
        void createNotification(orgId, 'Shipment exception', `${editForm.carrier} ${label}`, {
          userId, entityType: 'shipments', entityId: shipment.id,
          route: `/shipping/all?selected=${shipment.id}`, priority: 'high',
        });
      } else if (editForm.status === 'LOST') {
        void createNotification(orgId, 'Shipment lost', `${editForm.carrier} ${label}`, {
          userId, entityType: 'shipments', entityId: shipment.id,
          route: `/shipping/all?selected=${shipment.id}`, priority: 'high',
        });
      } else if (editForm.status === 'RETURNED') {
        void createNotification(orgId, 'Shipment returned', `${editForm.carrier} ${label} - Return workflow needed`, {
          userId, entityType: 'shipments', entityId: shipment.id,
          route: `/shipping/all?selected=${shipment.id}`, priority: 'high',
        });
      }
    }

    await logActivity(orgId, userId, `Shipment updated (${editForm.carrier} ${editForm.tracking_number || ''})`, 'shipments', shipment.id);
    setSaving(false); setEditing(false);
    // Reload and keep drawer open
    await onUpdated();
  };

  const handleDeliver = async () => {
    setConfirmLoading(true);
    await updateRow('shipments', shipment.id, { status: 'DELIVERED' });

    // Update order status to DELIVERED if appropriate
    if (shipment.order_id && shipment.orders?.status !== 'DELIVERED') {
      await updateRow('orders', shipment.order_id, { status: 'DELIVERED' });
    }

    // Create notification
    const label = shipment.tracking_number || shipment.id.slice(0, 8).toUpperCase();
    void createNotification(orgId, 'Shipment delivered', `${shipment.carrier} ${label}`, {
      userId, entityType: 'shipments', entityId: shipment.id,
      route: `/shipping/all?selected=${shipment.id}`, priority: 'medium',
    });

    await logActivity(orgId, userId, `Shipment marked as delivered`, 'shipments', shipment.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const handleDelete = async () => {
    setConfirmLoading(true);
    await deleteRow('shipments', shipment.id);
    await logActivity(orgId, userId, `Shipment deleted`, 'shipments', shipment.id);
    setConfirmLoading(false); setConfirm(null); onUpdated(); onClose();
  };

  const getRates = async () => {
    setLoadingRates(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('shipping-label', {
        body: {
          action: 'get_rates',
          provider: 'shipstation',
          organization_id: orgId,
          shipment_id: shipment.id,
        },
      });

      if (error) throw error;

      setRates(data.rates ?? []);
      setShowRates(true);
    } catch (err: any) {
      console.error('Get rates error:', err);
      setError(`Failed to fetch rates: ${err.message}`);
    } finally {
      setLoadingRates(false);
    }
  };

  const createLabel = async (carrierCode?: string, serviceCode?: string) => {
    setCreatingLabel(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke('shipping-label', {
        body: {
          action: 'create_label',
          provider: 'shipstation',
          organization_id: orgId,
          shipment_id: shipment.id,
          carrier_code: carrierCode,
          service_code: serviceCode,
        },
      });

      if (error) throw error;

      if (data.success) {
        setShowRates(false);
        await onUpdated();
      }
    } catch (err: any) {
      console.error('Create label error:', err);
      setError(`Failed to create label: ${err.message}`);
    } finally {
      setCreatingLabel(false);
    }
  };

  const printLabel = () => {
    if (shipment.label_url) {
      // If label_url is base64, convert to blob and download
      if (shipment.label_url.startsWith('data:')) {
        window.open(shipment.label_url, '_blank');
      } else {
        // Otherwise open URL directly
        window.open(shipment.label_url, '_blank');
      }
    }
  };

  const canEdit = canEditOps(role);
  const hasAddress = shipment.orders?.customers?.address && shipment.orders?.customers?.city &&
                     shipment.orders?.customers?.state && shipment.orders?.customers?.postal_code;
  const canGetRates = shipment.weight && hasAddress;
  const hasLabel = !!shipment.label_url;
  const canCreateLabel = !hasLabel && canGetRates;

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
            {/* ShipStation Label Actions */}
            {canEdit && canGetRates && !hasLabel && (
              <button
                onClick={getRates}
                disabled={loadingRates}
                className="flex items-center gap-1.5 px-3 py-2 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60"
              >
                {loadingRates ? <Loader2 size={13} className="animate-spin" /> : null}
                Get Rates
              </button>
            )}
            {canEdit && canCreateLabel && (
              <button
                onClick={() => createLabel()}
                disabled={creatingLabel}
                className="flex items-center gap-1.5 px-3 py-2 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60"
              >
                {creatingLabel ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                Create Label
              </button>
            )}
            {hasLabel && (
              <button
                onClick={printLabel}
                className="flex items-center gap-1.5 px-3 py-2 text-[13px] bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg"
              >
                <Printer size={13} />Print Label
              </button>
            )}

            {/* Standard Actions */}
            {canEdit && shipment.status !== 'DELIVERED' && (
              <button onClick={() => setConfirm('deliver')} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
                Mark Delivered
              </button>
            )}
            {isAdmin(role) && (
              <button onClick={() => setConfirm('delete')} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                <Trash2 size={13} />Delete
              </button>
            )}
            {canEdit && (
              <button
                onClick={() => {
                  setEditing(true);
                  setEditForm({
                    carrier: shipment.carrier,
                    service: shipment.service ?? '',
                    tracking_number: shipment.tracking_number ?? '',
                    status: shipment.status,
                    estimated_delivery: shipment.estimated_delivery ?? '',
                    shipment_notes: shipment.shipment_notes ?? '',
                  });
                }}
                className="flex items-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-[13px] font-medium rounded-lg"
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
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Carrier" required>
                <select className={selectCls} value={editForm.carrier} onChange={e => set('carrier', e.target.value)}>
                  {CARRIERS.map(c => <option key={c}>{c}</option>)}
                </select>
              </FormField>
              <FormField label="Service">
                <input className={inputCls} value={editForm.service} onChange={e => set('service', e.target.value)} placeholder="Ground, Priority..." />
              </FormField>
            </div>
            <FormField label="Tracking Number">
              <input className={inputCls} value={editForm.tracking_number} onChange={e => set('tracking_number', e.target.value)} placeholder="1Z999AA10123456784" />
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
            <FormField label="Shipment Notes">
              <textarea className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E]" rows={2} value={editForm.shipment_notes} onChange={e => set('shipment_notes', e.target.value)} />
            </FormField>
          </div>
        ) : (
          <div>
            <DetailRow label="Shipment ID" value={shipment.shipment_id ?? null} />
            <DetailRow label="Order" value={<span className="font-mono">{orderNum}</span>} />
            {shipment.orders?.customers?.name && <DetailRow label="Buyer" value={shipment.orders.customers.name} />}
            <DetailRow label="Carrier" value={shipment.carrier} />
            <DetailRow label="Service" value={shipment.service ?? null} />
            <DetailRow label="Tracking Number" value={shipment.tracking_number ? <span className="font-mono text-[12px]">{shipment.tracking_number}</span> : null} />
            <DetailRow label="Status" value={<StatusBadge status={shipment.status} size="sm" />} />
            <DetailRow label="Est. Delivery" value={shipment.estimated_delivery ?? null} />
            {shipment.label_cost && <DetailRow label="Label Cost" value={`$${Number(shipment.label_cost).toFixed(2)}`} />}
            {shipment.weight && <DetailRow label="Weight" value={`${shipment.weight} lbs`} />}
            {shipment.shipment_notes && <DetailRow label="Shipment Notes" value={shipment.shipment_notes} />}
            <DetailRow label="Created" value={new Date(shipment.created_at).toLocaleDateString()} />

            {orderItems.length > 0 && (
              <>
                <div className="border-t border-[rgba(0,0,0,0.06)] my-3 pt-3">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Inventory Items ({orderItems.length})</p>
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
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ShipStation Rates */}
            {showRates && rates.length > 0 && (
              <>
                <div className="border-t border-[rgba(0,0,0,0.06)] my-3 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Available Rates ({rates.length})</p>
                    <button onClick={() => setShowRates(false)} className="text-[11px] text-gray-400 hover:text-gray-600">
                      Hide
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {rates.map((rate: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3 bg-white border border-[rgba(0,0,0,0.08)] rounded-lg hover:border-[#3ECF8E] transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="text-[13px] font-medium text-gray-900">
                            {rate.carrierCode?.toUpperCase()} - {rate.serviceName}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {rate.serviceCode} {rate.shipDate && `• Delivery: ${rate.shipDate}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-[15px] font-semibold text-gray-900">
                              ${rate.shipmentCost?.toFixed(2)}
                            </div>
                            {rate.otherCost > 0 && (
                              <div className="text-[10px] text-gray-400">+${rate.otherCost.toFixed(2)} other</div>
                            )}
                          </div>
                          <button
                            onClick={() => createLabel(rate.carrierCode, rate.serviceCode)}
                            disabled={creatingLabel}
                            className="px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[12px] rounded-lg disabled:opacity-60"
                          >
                            {creatingLabel ? <Loader2 size={11} className="animate-spin" /> : 'Select'}
                          </button>
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
        open={confirm === 'deliver'}
        title="Mark as Delivered"
        description="Mark this shipment as delivered? This will update the status to DELIVERED."
        confirmLabel="Mark Delivered"
        onConfirm={handleDeliver}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title="Delete Shipment"
        description="Permanently delete this shipment record? This action cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirm(null)}
        loading={confirmLoading}
      />
    </>
  );
}

export function Shipping() {
  const view = useSecondaryView();
  const { orgId, user, currentRole: role } = useAuth();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [packStep, setPackStep] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);
  const pendingSelId = useRef<string | null>(searchParams.get('selected'));

  // Scan to Pack state
  const [packingShipmentId, setPackingShipmentId] = useState<string | null>(null);
  const [scanInput, setScanInput] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Watch for action param
  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'create-shipment') {
      setShowCreate(true);
      setSearchParams(p => { p.delete('action'); return p; }, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Watch for new selected param
  useEffect(() => {
    const id = searchParams.get('selected');
    if (id) pendingSelId.current = id;
  }, [searchParams]);

  const statusValues = VIEW_STATUS[view] ?? null;

  const { data: shipments, loading, error, reload } = useOrgQuery<any>('shipments', orgId, {
    select: 'id, shipment_id, carrier, service, tracking_number, status, estimated_delivery, shipment_notes, created_at, packed_at, packed_by, orders(id, order_id, customers(name), order_items(id, inventory_item_id, quantity, packed_quantity, packed_at, packed_by, inventory_items(id, inventory_id, product_title, lot_id, lots(lot_id))))',
    filter: statusValues ? (q: any) => q.in('status', statusValues) : undefined,
    filterKey: statusValues ? statusValues.join(',') : 'all',
  });

  // Handle deep-link after shipments load
  useEffect(() => {
    if (!pendingSelId.current || shipments.length === 0) return;
    const id = pendingSelId.current;
    pendingSelId.current = null;
    const shipment = shipments.find((s: any) => s.id === id);
    if (shipment) {
      setSelectedId(id);
    } else {
      setNotFoundMsg('Shipment not found or no longer available.');
      setTimeout(() => setNotFoundMsg(null), 5000);
    }
    setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
  }, [shipments, setSearchParams]);

  const { data: orders } = useOrgQuery<any>('orders', orgId, {
    select: 'id, order_id, customers(name)',
    filter: (q: any) => q.in('status', ['OPEN', 'PICKING', 'PACKED']),
  });

  const shipFilterDefs: FilterDef[] = [
    { type: 'select', key: 'carrier', label: 'Carrier', options: CARRIERS.map(c => ({ value: c, label: c })) },
    { type: 'text', key: 'service', label: 'Service Level', placeholder: 'Ground, Priority...' },
    { type: 'daterange', keyFrom: 'shipped_from', keyTo: 'shipped_to', label: 'Date Shipped' },
    { type: 'daterange', keyFrom: 'delivered_from', keyTo: 'delivered_to', label: 'Expected Delivery Date' },
    { type: 'boolean', key: 'missing_tracking', label: 'Missing Tracking' },
  ];

  const filteredShipments = shipments.filter((s: any) => {
    const v = filterValues;
    if (v.carrier && s.carrier !== v.carrier) return false;
    if (v.service && !String(s.service ?? '').toLowerCase().includes(v.service.toLowerCase())) return false;
    const shippedDate = s.created_at ?? '';
    if (v.shipped_from && shippedDate.slice(0,10) < v.shipped_from) return false;
    if (v.shipped_to && shippedDate.slice(0,10) > v.shipped_to) return false;
    const deliveredDate = s.estimated_delivery ?? '';
    if (v.delivered_from && deliveredDate && deliveredDate.slice(0,10) < v.delivered_from) return false;
    if (v.delivered_to && deliveredDate && deliveredDate.slice(0,10) > v.delivered_to) return false;
    if (v.missing_tracking === 'true' && s.tracking_number) return false;
    return true;
  });

  const selectedShipment = shipments.find((s: any) => s.id === selectedId) ?? null;
  const packingShipment = shipments.find((s: any) => s.id === packingShipmentId) ?? null;

  // Scan to Pack handler
  const handlePackScan = async () => {
    const input = scanInput.trim();
    if (!input || scanning || !packingShipmentId || !orgId) return;

    setScanning(true);
    setScanError(null);
    setScanSuccess(null);

    try {
      const shipment = packingShipment;
      if (!shipment?.orders?.order_items) {
        setScanError('No order items found for this shipment');
        setScanning(false);
        return;
      }

      // Resolve inventory item
      let itemId = null;
      const selectedMatch = input.match(/selected=([a-f0-9-]{36})/i);
      if (selectedMatch) {
        itemId = selectedMatch[1];
      } else {
        const { data: items } = await supabase
          .from('inventory_items')
          .select('id')
          .eq('organization_id', orgId)
          .or(`id.eq.${input},inventory_id.eq.${input},barcode_value.eq.${input}`)
          .limit(1);
        if (items && items.length > 0) {
          itemId = items[0].id;
        }
      }

      if (!itemId) {
        setScanError(`No inventory item found for: ${input}`);
        await insertRow('packing_scans', {
          organization_id: orgId,
          shipment_id: packingShipmentId,
          scanned_value: input,
          result: 'NOT_FOUND',
          scanned_by: user?.id,
        });
        setScanning(false);
        setTimeout(() => setScanError(null), 5000);
        return;
      }

      // Check if item belongs to this shipment's order
      const orderItem = shipment.orders.order_items.find((oi: any) => oi.inventory_item_id === itemId);
      if (!orderItem) {
        setScanError('⚠️ WRONG ITEM! This item does not belong to the selected shipment.');
        await insertRow('packing_scans', {
          organization_id: orgId,
          shipment_id: packingShipmentId,
          inventory_item_id: itemId,
          scanned_value: input,
          result: 'WRONG_ITEM',
          scanned_by: user?.id,
        });
        setScanning(false);
        setTimeout(() => setScanError(null), 5000);
        return;
      }

      // Check if already fully packed
      const packedQty = orderItem.packed_quantity ?? 0;
      const requiredQty = orderItem.quantity ?? 1;
      if (packedQty >= requiredQty) {
        setScanError('⚠️ DUPLICATE! This item is already fully packed.');
        await insertRow('packing_scans', {
          organization_id: orgId,
          shipment_id: packingShipmentId,
          order_item_id: orderItem.id,
          inventory_item_id: itemId,
          scanned_value: input,
          result: 'DUPLICATE',
          scanned_by: user?.id,
        });
        setScanning(false);
        setTimeout(() => setScanError(null), 5000);
        return;
      }

      // Pack the item
      const newPackedQty = packedQty + 1;
      const updateData: any = { packed_quantity: newPackedQty };
      if (newPackedQty >= requiredQty) {
        updateData.packed_at = new Date().toISOString();
        updateData.packed_by = user?.id;
      }

      await updateRow('order_items', orderItem.id, updateData);
      await updateRow('inventory_items', itemId, { status: 'PACKED' });
      await insertRow('packing_scans', {
        organization_id: orgId,
        shipment_id: packingShipmentId,
        order_item_id: orderItem.id,
        inventory_item_id: itemId,
        scanned_value: input,
        result: 'PACKED',
        scanned_by: user?.id,
      });

      const itemDesc = orderItem.inventory_items?.product_title || orderItem.inventory_items?.inventory_id || 'Item';
      setScanSuccess(`✓ ${itemDesc} packed (${newPackedQty}/${requiredQty})`);
      await logActivity(orgId, user?.id, `Item packed for shipment`, 'shipments', packingShipmentId);

      setScanInput('');
      await reload();
      setTimeout(() => setScanSuccess(null), 3000);

      // Check if all items are packed
      const allOrderItems = shipment.orders.order_items;
      const allPacked = allOrderItems.every((oi: any) => {
        const packed = oi.id === orderItem.id ? newPackedQty : (oi.packed_quantity ?? 0);
        return packed >= (oi.quantity ?? 1);
      });

      if (allPacked) {
        // Update order and shipment statuses
        await updateRow('orders', shipment.orders.id, { status: 'PACKED' });
        await updateRow('shipments', packingShipmentId, {
          status: 'PACKED',
          packed_at: new Date().toISOString(),
          packed_by: user?.id,
        });
        await createNotification({
          organization_id: orgId,
          title: 'Shipment packed and ready',
          message: `All items packed for shipment #${shipment.shipment_id || shipment.id.slice(0, 8)}`,
          priority: 'medium',
          route: `/shipping/all?selected=${packingShipmentId}`,
        });
        setScanSuccess('🎉 Shipment fully packed and ready for label!');
        await reload();
      }

      // Refocus scanner
      setTimeout(() => scanInputRef.current?.focus(), 100);
    } catch (error: any) {
      setScanError(`Scan error: ${error.message}`);
      setTimeout(() => setScanError(null), 5000);
    } finally {
      setScanning(false);
    }
  };

  const startPacking = (shipmentId: string) => {
    setPackingShipmentId(shipmentId);
    setTimeout(() => scanInputRef.current?.focus(), 100);
  };

  return (
    <div className="p-6 max-w-[1300px] space-y-5">
      {notFoundMsg && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg text-[13px]">
          {notFoundMsg}
        </div>
      )}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Shipping</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Fulfillment queue and shipment management</p>
        </div>
        <div className="flex gap-1.5">
          <button
            disabled
            title="Bulk label printing requires ShipStation integration"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-400 bg-gray-50 cursor-not-allowed opacity-60"
          >
            <Printer size={13} />Print Labels
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Create Shipment
          </button>
        </div>
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
                    {['Order', 'Carrier', 'Service', 'Tracking', 'Status', 'Est. Delivery'].map(h => (
                      <th key={h} className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredShipments.map((shp: any, i: number) => (
                    <tr
                      key={shp.id}
                      onClick={() => setSelectedId(shp.id)}
                      className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedId === shp.id ? 'bg-[#F0FDF4]' : ''} ${i < filteredShipments.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                    >
                      <td className="px-5 py-3 text-[12px] font-mono text-gray-700">
                        {shp.orders ? (shp.orders.order_id ? `#${shp.orders.order_id}` : `#${shp.orders.id.slice(0, 8).toUpperCase()}`) : '—'}
                      </td>
                      <td className="px-5 py-3 text-[13px] text-gray-700">{shp.carrier}</td>
                      <td className="px-5 py-3 text-[12px] text-gray-500">{shp.service ?? '—'}</td>
                      <td className="px-5 py-3">{shp.tracking_number ? <span className="text-[11px] font-mono text-gray-500">{shp.tracking_number.slice(0, 16)}…</span> : <span className="text-gray-300 text-[12px]">—</span>}</td>
                      <td className="px-5 py-3"><StatusBadge status={shp.status} size="sm" /></td>
                      <td className="px-5 py-3 text-[12px] text-gray-400">{shp.estimated_delivery ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-1">Scan to Pack</h3>
          <p className="text-[12px] text-gray-400 mb-4">Scan inventory labels to pack shipments.</p>

          {!packingShipment ? (
            <div className="text-center py-6">
              <ScanLine size={32} className="text-gray-300 mx-auto mb-3" />
              <p className="text-[13px] text-gray-500 mb-4">Select a shipment to begin scan-to-pack.</p>
              {selectedShipment && ['LABEL_CREATED', 'PACKED', 'OPEN'].includes(selectedShipment.status) && (
                <button
                  onClick={() => startPacking(selectedShipment.id)}
                  className="px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg flex items-center gap-1.5 mx-auto"
                >
                  <ScanLine size={13} />
                  Start Packing Selected Shipment
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-1">Packing Shipment</p>
                <p className="text-[13px] font-semibold text-gray-900">
                  {packingShipment.orders?.order_id ? `Order #${packingShipment.orders.order_id}` : `#${packingShipment.id.slice(0, 8)}`}
                </p>
                {packingShipment.orders?.customers?.name && (
                  <p className="text-[12px] text-gray-600 mt-0.5">{packingShipment.orders.customers.name}</p>
                )}
              </div>

              {(scanError || scanSuccess) && (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${scanError ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
                  {scanError ? <XCircle size={14} /> : <CheckCircle size={14} />}
                  <span className="text-[12px] font-medium">{scanError || scanSuccess}</span>
                </div>
              )}

              <div>
                <label className="text-[11px] text-gray-500 uppercase tracking-wide mb-1.5 block">Scan Inventory Label</label>
                <div className="relative">
                  <ScanLine size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#3ECF8E]" />
                  <input
                    ref={scanInputRef}
                    value={scanInput}
                    onChange={e => setScanInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handlePackScan()}
                    placeholder="Scan QR code or inventory ID..."
                    disabled={scanning}
                    className="pl-7 pr-16 py-2 text-[13px] bg-[#F0FDF4] border border-[#3ECF8E]/20 rounded-lg w-full focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/30 focus:border-[#3ECF8E] placeholder:text-gray-500 disabled:opacity-60"
                  />
                  {scanInput && (
                    <button
                      onClick={handlePackScan}
                      disabled={scanning}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-[11px] font-medium bg-[#3ECF8E] text-white rounded hover:bg-[#38c484] disabled:opacity-60 transition-colors"
                    >
                      {scanning ? <Loader2 size={10} className="animate-spin" /> : 'Pack'}
                    </button>
                  )}
                </div>
              </div>

              {packingShipment.orders?.order_items && packingShipment.orders.order_items.length > 0 && (
                <div>
                  <p className="text-[11px] text-gray-500 uppercase tracking-wide mb-2">Order Items ({packingShipment.orders.order_items.length})</p>
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

              <button
                onClick={() => { setPackingShipmentId(null); setScanInput(''); setScanError(null); setScanSuccess(null); }}
                className="w-full px-3 py-2 border border-gray-200 text-gray-600 text-[13px] rounded-lg hover:bg-gray-50 transition-colors"
              >
                Stop Packing
              </button>
            </div>
          )}
        </div>
      </div>

      <CreateShipmentModal open={showCreate} onClose={() => setShowCreate(false)} orgId={orgId} userId={user?.id} orders={orders} onCreated={reload} />
      {selectedShipment && (
        <ShipmentDrawer
          shipment={selectedShipment}
          onClose={() => setSelectedId(null)}
          orgId={orgId}
          userId={user?.id}
          role={role}
          onUpdated={async () => {
            await reload();
            // Keep drawer open with refreshed data - selectedShipment will update via selectedId
          }}
        />
      )}
    </div>
  );
}
