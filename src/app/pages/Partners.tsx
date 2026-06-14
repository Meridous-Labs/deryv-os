import { useState, useEffect, useRef } from 'react';
import { Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, insertRow, updateRow, deleteRow, countLinked, logActivity } from '../../lib/hooks';
import { useSecondaryView } from '../components/SecondarySidebar';
import { EmptyState, ErrorState, Modal, FormField, DetailRow, inputCls, selectCls, textareaCls } from '../components/DataStates';
import { Drawer } from '../components/Drawer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { canEdit, isAdmin } from '../../lib/permissions';
import { FilterBar, FilterValues, FilterDef } from '../components/FilterBar';

const PARTNER_STATUSES = ['ACTIVE','INACTIVE','PENDING'];

function AddVendorModal({ open, onClose, orgId, userId, onCreated }: any) {
  const [form, setForm] = useState({ name: '', type: '', contact_name: '', contact_email: '', phone: '', address: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name) { setError('Vendor name is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('vendors', {
      organization_id: orgId, name: form.name, type: form.type || null,
      contact_name: form.contact_name || null, contact_email: form.contact_email || null,
      phone: form.phone || null, address: form.address || null, notes: form.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Vendor "${form.name}" added`, 'vendors');
    setSaving(false); onCreated(); onClose();
    setForm({ name: '', type: '', contact_name: '', contact_email: '', phone: '', address: '', notes: '' });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Vendor"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Add Vendor
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Vendor Name" required><input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Amazon Returns" /></FormField>
          <FormField label="Type"><input className={inputCls} value={form.type} onChange={e => set('type', e.target.value)} placeholder="Electronics, Apparel..." /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Contact Name"><input className={inputCls} value={form.contact_name} onChange={e => set('contact_name', e.target.value)} placeholder="Jane Smith" /></FormField>
          <FormField label="Contact Email"><input type="email" className={inputCls} value={form.contact_email} onChange={e => set('contact_email', e.target.value)} placeholder="jane@vendor.com" /></FormField>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Phone"><input className={inputCls} value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+1 555-0100" /></FormField>
          <FormField label="Address"><input className={inputCls} value={form.address} onChange={e => set('address', e.target.value)} placeholder="123 Main St..." /></FormField>
        </div>
        <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes..." /></FormField>
      </div>
    </Modal>
  );
}

function AddPartnerModal({ open, onClose, orgId, userId, onCreated }: any) {
  const [form, setForm] = useState({ company_name: '', status: 'ACTIVE', profit_split_percent: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.company_name) { setError('Partner name is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await insertRow('partners', {
      organization_id: orgId,
      company_name: form.company_name,
      status: form.status,
      profit_split_percent: form.profit_split_percent ? parseFloat(form.profit_split_percent) : null,
      notes: form.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Partner "${form.company_name}" added`, 'partners');
    setSaving(false); onCreated(); onClose();
    setForm({ company_name: '', status: 'ACTIVE', profit_split_percent: '', notes: '' });
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Funding Partner"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Add Partner
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Company Name" required><input className={inputCls} value={form.company_name} onChange={e => set('company_name', e.target.value)} placeholder="Apex Capital" /></FormField>
          <FormField label="Profit Split %"><input type="number" className={inputCls} value={form.profit_split_percent} onChange={e => set('profit_split_percent', e.target.value)} placeholder="40" min="0" max="100" step="0.1" /></FormField>
        </div>
        <FormField label="Status"><select className={selectCls} value={form.status} onChange={e => set('status', e.target.value)}>{PARTNER_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
        <FormField label="Notes"><textarea className={textareaCls} rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Internal notes..." /></FormField>
      </div>
    </Modal>
  );
}

function VendorDrawer({ vendor, onClose, orgId, userId, role, lotCount, activeLotCount, onUpdated }: any) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    name: vendor.name, type: vendor.type ?? '', contact_name: vendor.contact_name ?? '',
    contact_email: vendor.contact_email ?? '', phone: vendor.phone ?? '',
    address: vendor.address ?? '', notes: vendor.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  const saveEdit = async () => {
    if (!editForm.name) { setError('Vendor name is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await updateRow('vendors', vendor.id, {
      name: editForm.name, type: editForm.type || null,
      contact_name: editForm.contact_name || null, contact_email: editForm.contact_email || null,
      phone: editForm.phone || null, address: editForm.address || null, notes: editForm.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Vendor "${editForm.name}" updated`, 'vendors', vendor.id);
    setSaving(false); setEditing(false); onUpdated();
  };

  const handleDelete = async () => {
    setDeleting(true);
    const linked = await countLinked('lots', 'vendor_id', vendor.id);
    if (linked > 0) {
      setError(`Cannot delete: ${linked} LOT(s) are linked to this vendor. Consider marking as inactive instead.`);
      setDeleting(false); setConfirmDelete(false); return;
    }
    await deleteRow('vendors', vendor.id);
    await logActivity(orgId, userId, `Vendor "${vendor.name}" deleted`, 'vendors', vendor.id);
    setDeleting(false); setConfirmDelete(false); onUpdated(); onClose();
  };

  const canEditVendor = canEdit(role);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={editing ? `Edit ${vendor.name}` : vendor.name}
        subtitle={vendor.type ?? 'Vendor'}
        footer={editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(false); setError(null); }} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
              {saving && <Loader2 size={12} className="animate-spin" />}Save Changes
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {isAdmin(role) && (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                <Trash2 size={13} />Delete
              </button>
            )}
            {canEditVendor && (
              <button
                onClick={() => { setEditing(true); setEditForm({ name: vendor.name, type: vendor.type ?? '', contact_name: vendor.contact_name ?? '', contact_email: vendor.contact_email ?? '', phone: vendor.phone ?? '', address: vendor.address ?? '', notes: vendor.notes ?? '' }); }}
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
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Vendor Name" required><input className={inputCls} value={editForm.name} onChange={e => set('name', e.target.value)} /></FormField>
              <FormField label="Type"><input className={inputCls} value={editForm.type} onChange={e => set('type', e.target.value)} /></FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Contact Name"><input className={inputCls} value={editForm.contact_name} onChange={e => set('contact_name', e.target.value)} /></FormField>
              <FormField label="Contact Email"><input type="email" className={inputCls} value={editForm.contact_email} onChange={e => set('contact_email', e.target.value)} /></FormField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Phone"><input className={inputCls} value={editForm.phone} onChange={e => set('phone', e.target.value)} /></FormField>
              <FormField label="Address"><input className={inputCls} value={editForm.address} onChange={e => set('address', e.target.value)} /></FormField>
            </div>
            <FormField label="Notes"><textarea className={textareaCls} rows={2} value={editForm.notes} onChange={e => set('notes', e.target.value)} /></FormField>
          </div>
        ) : (
          <div>
            <DetailRow label="Name" value={vendor.name} />
            <DetailRow label="Type" value={vendor.type ?? null} />
            <DetailRow label="Contact Name" value={vendor.contact_name ?? null} />
            <DetailRow label="Contact Email" value={vendor.contact_email ?? null} />
            <DetailRow label="Phone" value={vendor.phone ?? null} />
            <DetailRow label="Address" value={vendor.address ?? null} />
            <DetailRow label="Active LOTs" value={activeLotCount} />
            <DetailRow label="Total LOTs" value={lotCount} />
            <DetailRow label="Added" value={new Date(vendor.created_at).toLocaleDateString()} />
            {vendor.notes && <DetailRow label="Notes" value={vendor.notes} />}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Vendor"
        description={`Delete vendor "${vendor.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        loading={deleting}
      />
    </>
  );
}

function PartnerDrawer({ partner, onClose, orgId, userId, role, onUpdated }: any) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    company_name: partner.company_name,
    status: partner.status,
    profit_split_percent: partner.profit_split_percent != null ? String(partner.profit_split_percent) : '',
    notes: partner.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const set = (k: string, v: string) => setEditForm(f => ({ ...f, [k]: v }));

  const saveEdit = async () => {
    if (!editForm.company_name) { setError('Company name is required.'); return; }
    setSaving(true); setError(null);
    const { error: err } = await updateRow('partners', partner.id, {
      company_name: editForm.company_name,
      status: editForm.status,
      profit_split_percent: editForm.profit_split_percent ? parseFloat(editForm.profit_split_percent) : null,
      notes: editForm.notes || null,
    });
    if (err) { setError(err); setSaving(false); return; }
    await logActivity(orgId, userId, `Partner "${editForm.company_name}" updated`, 'partners', partner.id);
    setSaving(false); setEditing(false); onUpdated();
  };

  const handleDelete = async () => {
    setDeleting(true);
    const linked = await countLinked('lots', 'funding_partner_id', partner.id);
    if (linked > 0) {
      setError(`Cannot delete: ${linked} LOT(s) are linked to this partner. Consider marking as inactive instead.`);
      setDeleting(false); setConfirmDelete(false); return;
    }
    await deleteRow('partners', partner.id);
    await logActivity(orgId, userId, `Partner "${partner.company_name}" deleted`, 'partners', partner.id);
    setDeleting(false); setConfirmDelete(false); onUpdated(); onClose();
  };

  const canEditPartner = canEdit(role);

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={editing ? `Edit ${partner.company_name}` : partner.company_name}
        subtitle="Funding Partner"
        footer={editing ? (
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditing(false); setError(null); }} className="px-3 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={saveEdit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
              {saving && <Loader2 size={12} className="animate-spin" />}Save Changes
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {isAdmin(role) && (
              <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-2 text-[13px] text-red-500 border border-red-200 rounded-lg hover:bg-red-50">
                <Trash2 size={13} />Delete
              </button>
            )}
            {canEditPartner && (
              <button
                onClick={() => { setEditing(true); setEditForm({ company_name: partner.company_name, status: partner.status, profit_split_percent: partner.profit_split_percent != null ? String(partner.profit_split_percent) : '', notes: partner.notes ?? '' }); }}
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
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Company Name" required><input className={inputCls} value={editForm.company_name} onChange={e => set('company_name', e.target.value)} /></FormField>
              <FormField label="Profit Split %"><input type="number" className={inputCls} value={editForm.profit_split_percent} onChange={e => set('profit_split_percent', e.target.value)} min="0" max="100" step="0.1" /></FormField>
            </div>
            <FormField label="Status"><select className={selectCls} value={editForm.status} onChange={e => set('status', e.target.value)}>{PARTNER_STATUSES.map(s => <option key={s}>{s}</option>)}</select></FormField>
            <FormField label="Notes"><textarea className={textareaCls} rows={3} value={editForm.notes} onChange={e => set('notes', e.target.value)} /></FormField>
          </div>
        ) : (
          <div>
            <DetailRow label="Company Name" value={partner.company_name} />
            <DetailRow label="Status" value={
              <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${partner.status === 'ACTIVE' ? 'bg-[#ECFDF5] text-[#15803d]' : 'bg-gray-100 text-gray-500'}`}>
                {partner.status}
              </span>
            } />
            <DetailRow label="Profit Split" value={partner.profit_split_percent != null ? `${partner.profit_split_percent}%` : null} />
            <DetailRow label="Added" value={new Date(partner.created_at).toLocaleDateString()} />
            {partner.notes && <DetailRow label="Notes" value={partner.notes} />}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete Partner"
        description={`Delete partner "${partner.company_name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
        loading={deleting}
      />
    </>
  );
}

export function Partners() {
  const view = useSecondaryView();
  const [searchParams, setSearchParams] = useSearchParams();
  const { orgId, user, currentRole: role } = useAuth();
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [showAddPartner, setShowAddPartner] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [filterValues, setFilterValues] = useState<FilterValues>({});
  const [notFoundMsg, setNotFoundMsg] = useState<string | null>(null);

  const pendingVendorSelId = useRef<string | null>(null);
  const pendingPartnerSelId = useRef<string | null>(null);

  useEffect(() => { setFilterValues({}); }, [view]);

  const { data: vendors, loading: vendorsLoading, error: vendorsError, reload: reloadVendors } = useOrgQuery<any>('vendors', orgId, {
    select: 'id, name, type, contact_name, contact_email, phone, address, notes, created_at',
  });

  const { data: partners, loading: partnersLoading, error: partnersError, reload: reloadPartners } = useOrgQuery<any>('partners', orgId, {
    select: 'id, company_name, status, profit_split_percent, notes, created_at',
  });

  const { data: lots } = useOrgQuery<any>('lots', orgId, {
    select: 'id, vendor_id, partner_id, funding_partner_id, status, purchase_cost, total_msrp',
    filter: (q: any) => q.neq('status', 'ARCHIVED'),
  });

  // Deep-link handling for vendors
  useEffect(() => {
    if (view === 'vendors' && !vendorsLoading) {
      const sel = searchParams.get('selected');
      if (sel && !pendingVendorSelId.current) {
        pendingVendorSelId.current = sel;
      }
      if (pendingVendorSelId.current && vendors.length > 0) {
        const found = vendors.find((v: any) => v.id === pendingVendorSelId.current);
        if (found) {
          setSelectedVendorId(found.id);
        } else {
          setNotFoundMsg('Vendor not found or no longer available.');
          setTimeout(() => setNotFoundMsg(null), 5000);
          setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
        }
        pendingVendorSelId.current = null;
      }
    }
  }, [view, vendors, vendorsLoading, searchParams, setSearchParams]);

  // Deep-link handling for partners
  useEffect(() => {
    if (view === 'funding' && !partnersLoading) {
      const sel = searchParams.get('selected');
      if (sel && !pendingPartnerSelId.current) {
        pendingPartnerSelId.current = sel;
      }
      if (pendingPartnerSelId.current && partners.length > 0) {
        const found = partners.find((p: any) => p.id === pendingPartnerSelId.current);
        if (found) {
          setSelectedPartnerId(found.id);
        } else {
          setNotFoundMsg('Partner record not found or no longer available.');
          setTimeout(() => setNotFoundMsg(null), 5000);
          setSearchParams(p => { p.delete('selected'); return p; }, { replace: true });
        }
        pendingPartnerSelId.current = null;
      }
    }
  }, [view, partners, partnersLoading, searchParams, setSearchParams]);

  const showVendors = view === 'vendors' || view === 'overview';
  const showFunding = view === 'funding' || view === 'overview';

  const activeLotsByVendor = (vendorId: string) => lots.filter((l: any) => l.vendor_id === vendorId && !['CLOSED', 'ARCHIVED'].includes(l.status)).length;
  const totalVendorLots = (vendorId: string) => lots.filter((l: any) => l.vendor_id === vendorId).length;

  const loading = vendorsLoading || partnersLoading;
  const error = vendorsError || partnersError;

  const vendorFilterDefs: FilterDef[] = [
    { type: 'text', key: 'type', label: 'Type', placeholder: 'Electronics...' },
  ];

  const filteredVendors = vendors.filter((v: any) => {
    const f = filterValues;
    if (f.type && !String(v.type ?? '').toLowerCase().includes(f.type.toLowerCase())) return false;
    return true;
  });

  const partnerFilterDefs: FilterDef[] = [
    { type: 'select', key: 'status', label: 'Status', options: PARTNER_STATUSES.map(s => ({ value: s, label: s })) },
    { type: 'numrange', keyMin: 'profit_share_min', keyMax: 'profit_share_max', label: 'Profit Share %' },
    { type: 'boolean', key: 'active_lots_only', label: 'Active LOTs Only' },
    { type: 'boolean', key: 'closed_lots_only', label: 'Closed LOTs Only' },
  ];

  const filteredPartners = partners.filter((p: any) => {
    const f = filterValues;
    if (f.status && p.status !== f.status) return false;
    if (f.profit_share_min && Number(p.profit_split_percent ?? 0) < Number(f.profit_share_min)) return false;
    if (f.profit_share_max && Number(p.profit_split_percent ?? 0) > Number(f.profit_share_max)) return false;
    if (f.active_lots_only === 'true') {
      const hasActive = lots.some((l: any) => l.funding_partner_id === p.id && !['CLOSED', 'ARCHIVED'].includes(l.status));
      if (!hasActive) return false;
    }
    if (f.closed_lots_only === 'true') {
      const hasClosed = lots.some((l: any) => l.funding_partner_id === p.id && l.status === 'CLOSED');
      if (!hasClosed) return false;
    }
    return true;
  });

  const selectedVendor = vendors.find((v: any) => v.id === selectedVendorId) ?? null;
  const selectedPartner = partners.find((p: any) => p.id === selectedPartnerId) ?? null;

  const handleVendorUpdated = () => {
    reloadVendors();
    // Keep drawer open - selectedVendor will update reactively when vendors reload
  };

  const handlePartnerUpdated = () => {
    reloadPartners();
    // Keep drawer open - selectedPartner will update reactively when partners reload
  };

  // Close drawer if record no longer exists after reload
  useEffect(() => {
    if (selectedVendorId && !vendorsLoading && !vendors.find((v: any) => v.id === selectedVendorId)) {
      setSelectedVendorId(null);
    }
  }, [vendors, vendorsLoading, selectedVendorId]);

  useEffect(() => {
    if (selectedPartnerId && !partnersLoading && !partners.find((p: any) => p.id === selectedPartnerId)) {
      setSelectedPartnerId(null);
    }
  }, [partners, partnersLoading, selectedPartnerId]);

  return (
    <div className="p-3 sm:p-6 max-w-[1200px] space-y-5">
      {notFoundMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-[13px]">
          {notFoundMsg}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Partners</h2>
          <p className="text-[13px] text-gray-400 mt-0.5">Vendors, funding partners, and recovery tracking</p>
        </div>
        <div className="flex gap-1.5">
          <button onClick={() => setShowAddVendor(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[rgba(0,0,0,0.1)] text-[13px] text-gray-600 hover:bg-gray-50">
            <Plus size={13} />Add Vendor
          </button>
          <button onClick={() => setShowAddPartner(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium">
            <Plus size={13} />Add Partner
          </button>
        </div>
      </div>

      {view === 'overview' && !loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-[rgba(0,0,0,0.07)] rounded-xl overflow-hidden border border-[rgba(0,0,0,0.07)]">
          {[
            { label: 'Total Vendors', value: vendors.length },
            { label: 'Total LOTs', value: lots.length },
            { label: 'Funding Partners', value: partners.length },
            { label: 'Active Partners', value: partners.filter((p: any) => p.status === 'ACTIVE').length, green: true },
          ].map(stat => (
            <div key={stat.label} className="bg-white px-5 py-4">
              <p className={`text-xl font-semibold ${(stat as any).green ? 'text-[#16a34a]' : 'text-gray-900'}`}>{stat.value}</p>
              <p className="text-[11px] text-gray-400 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>
      )}

      {error && <ErrorState message={error} onRetry={() => { reloadVendors(); reloadPartners(); }} />}

      {showVendors && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.06)] flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">Vendors</h3>
            <span className="text-[12px] text-gray-400">{filteredVendors.length} vendors</span>
          </div>
          {vendorsLoading ? (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">{[1,2,3].map(i => <div key={i} className="h-12 px-5 py-3 flex items-center"><div className="h-4 w-48 bg-gray-100 animate-pulse rounded" /></div>)}</div>
          ) : vendors.length === 0 ? (
            <EmptyState title="No vendors" description="Add your first vendor to get started." action={{ label: 'Add Vendor', onClick: () => setShowAddVendor(true) }} />
          ) : (
            <>
              <FilterBar defs={vendorFilterDefs} values={filterValues} onChange={setFilterValues} />
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-[rgba(0,0,0,0.06)]">
                      {['Vendor', 'Type', 'Contact', 'Active LOTs', 'Total LOTs'].map(h => (
                        <th key={h} className="text-left px-5 py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredVendors.map((v: any, i: number) => (
                      <tr
                        key={v.id}
                        onClick={() => setSelectedVendorId(v.id)}
                        className={`hover:bg-gray-50/70 cursor-pointer transition-colors ${selectedVendorId === v.id ? 'bg-[#F0FDF4]' : ''} ${i < filteredVendors.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                      >
                        <td className="px-5 py-3">
                          <p className="text-[13px] font-medium text-gray-900">{v.name}</p>
                          <p className="text-[11px] text-gray-400">{v.contact_email ?? '—'}</p>
                        </td>
                        <td className="px-5 py-3 text-[13px] text-gray-600">{v.type ?? '—'}</td>
                        <td className="px-5 py-3 text-[13px] text-gray-600">{v.contact_name ?? '—'}</td>
                        <td className="px-5 py-3 text-[13px] font-semibold text-gray-900 tabular-nums">{activeLotsByVendor(v.id)}</td>
                        <td className="px-5 py-3 text-[13px] text-gray-600 tabular-nums">{totalVendorLots(v.id)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {showFunding && (
        <div>
          {showVendors && <h3 className="text-[13px] font-semibold text-gray-700 mb-3">Funding Partners</h3>}
          {partnersLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1,2].map(i => <div key={i} className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5 h-32 animate-pulse bg-gray-50" />)}
            </div>
          ) : partners.length === 0 ? (
            <EmptyState title="No funding partners" description="Add a funding partner to track capital deployment." action={{ label: 'Add Partner', onClick: () => setShowAddPartner(true) }} />
          ) : (
            <>
              <FilterBar defs={partnerFilterDefs} values={filterValues} onChange={setFilterValues} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredPartners.map((fp: any) => (
                <div
                  key={fp.id}
                  onClick={() => setSelectedPartnerId(fp.id)}
                  className={`bg-white rounded-xl border cursor-pointer transition-colors hover:border-[#3ECF8E]/50 ${selectedPartnerId === fp.id ? 'border-[#3ECF8E]/60 bg-[#F0FDF4]' : 'border-[rgba(0,0,0,0.07)]'} p-5`}
                >
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-[14px] font-semibold text-gray-900">{fp.company_name}</h3>
                      <p className="text-[12px] text-gray-400 mt-0.5">Funding Partner</p>
                    </div>
                    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${fp.status === 'ACTIVE' ? 'bg-[#ECFDF5] text-[#15803d]' : 'bg-gray-100 text-gray-500'}`}>{fp.status}</span>
                  </div>
                  {fp.profit_split_percent != null && (
                    <div className="flex justify-between pt-3 border-t border-[rgba(0,0,0,0.06)]">
                      <span className="text-[11px] text-gray-400">Profit split</span>
                      <span className="text-[13px] font-semibold text-gray-900">{fp.profit_split_percent}%</span>
                    </div>
                  )}
                  {fp.notes && (
                    <p className="text-[12px] text-gray-400 mt-3 leading-relaxed">{fp.notes}</p>
                  )}
                </div>
              ))}
              </div>
            </>
          )}
        </div>
      )}

      {view === 'recovery' && (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-4">Recovery Tracker</h3>
          {vendors.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-4 text-center">No vendor data available.</p>
          ) : lots.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-4">No LOT data to compute recovery metrics.</p>
          ) : (
            <div className="space-y-3">
              {vendors.map((v: any) => {
                const vLots = lots.filter((l: any) => l.vendor_id === v.id);
                const activeLots = vLots.filter((l: any) => !['CLOSED', 'ARCHIVED'].includes(l.status));
                const totalCost = vLots.reduce((sum: number, l: any) => sum + (l.purchase_cost ?? 0), 0);
                const totalMSRP = vLots.reduce((sum: number, l: any) => sum + (l.total_msrp ?? 0), 0);

                if (vLots.length === 0) return null;

                return (
                  <div key={v.id} className="border border-[rgba(0,0,0,0.06)] rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-[13px] font-medium text-gray-900">{v.name}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{v.type ?? 'Vendor'}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <p className="text-[11px] text-gray-400">Total LOTs</p>
                        <p className="text-[15px] font-semibold text-gray-900 tabular-nums">{vLots.length}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-400">Active LOTs</p>
                        <p className="text-[15px] font-semibold text-[#16a34a] tabular-nums">{activeLots.length}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-400">Total Cost</p>
                        <p className="text-[15px] font-semibold text-gray-900 tabular-nums">${totalCost.toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-400">Total MSRP</p>
                        <p className="text-[15px] font-semibold text-gray-900 tabular-nums">${totalMSRP.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          )}
        </div>
      )}

      <AddVendorModal open={showAddVendor} onClose={() => setShowAddVendor(false)} orgId={orgId} userId={user?.id} onCreated={reloadVendors} />
      <AddPartnerModal open={showAddPartner} onClose={() => setShowAddPartner(false)} orgId={orgId} userId={user?.id} onCreated={reloadPartners} />

      {selectedVendor && (
        <VendorDrawer
          vendor={selectedVendor}
          onClose={() => setSelectedVendorId(null)}
          orgId={orgId}
          userId={user?.id}
          role={role}
          lotCount={totalVendorLots(selectedVendor.id)}
          activeLotCount={activeLotsByVendor(selectedVendor.id)}
          onUpdated={handleVendorUpdated}
        />
      )}
      {selectedPartner && (
        <PartnerDrawer
          partner={selectedPartner}
          onClose={() => setSelectedPartnerId(null)}
          orgId={orgId}
          userId={user?.id}
          role={role}
          onUpdated={handlePartnerUpdated}
        />
      )}
    </div>
  );
}
