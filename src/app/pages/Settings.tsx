import { useState, useRef, useEffect } from 'react';
import { Plus, Trash2, Eye, EyeOff, Loader2, Save, Upload, Info, Hash, Bookmark, Pencil, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, updateRow, deleteRow, logActivity } from '../../lib/hooks';
import { useSecondaryView } from '../components/SecondarySidebar';
import { ErrorState, Modal, FormField, inputCls, selectCls } from '../components/DataStates';
import { serverFetch, serverUpload, supabase } from '../../lib/supabase';

const ROLES = ['admin', 'manager', 'warehouse', 'accounting', 'viewer'];

const NOTIF_DEFAULTS = [
  { id: 'new_lot', label: 'New LOT arrived', email: true, push: true },
  { id: 'order_received', label: 'New order received', email: true, push: true },
  { id: 'sync_error', label: 'Marketplace sync error', email: true, push: false },
  { id: 'return_received', label: 'Return received', email: false, push: true },
  { id: 'low_capacity', label: 'Warehouse capacity warning', email: true, push: false },
  { id: 'ai_insight', label: 'AI insights summary', email: true, push: false },
];

const NOTIF_PREFS_KEY = 'deryv.notifPrefs';

function InviteMemberModal({ open, onClose, orgId, userId, onCreated }: any) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'viewer' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.email || !form.password || !form.name) { setError('Name, email, and password are required.'); return; }
    setSaving(true); setError(null);
    try {
      await serverFetch('/auth/create-user', {
        method: 'POST',
        body: JSON.stringify({ email: form.email, password: form.password, name: form.name, organizationId: orgId, role: form.role }),
      });
      await logActivity(orgId, userId, `Team member ${form.name} invited`, 'organization_members');
      setSaving(false); onCreated(); onClose();
      setForm({ email: '', name: '', password: '', role: 'viewer' });
    } catch (err: any) {
      setError(err.message ?? 'Failed to create user.');
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite Team Member"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Send Invite
        </button>
      </>}>
      <div className="space-y-3">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Name" required><input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" /></FormField>
        <FormField label="Email" required><input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@company.com" /></FormField>
        <FormField label="Temporary Password" required><input type="password" className={inputCls} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Set a temporary password" /></FormField>
        <FormField label="Role">
          <select className={selectCls} value={form.role} onChange={e => set('role', e.target.value)}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
        </FormField>
      </div>
    </Modal>
  );
}

// Mirrors applyPricingRule in Inventory.tsx — keep the two in sync.
function applyPricingRuleCalc(msrp: number, rule: { mode: string; value: number | string } | null): number | null {
  if (!rule || !rule.value || !msrp || msrp <= 0) return null;
  const v = Number(rule.value); // coerce string from DB to number
  if (!v || isNaN(v)) return null;
  if (rule.mode === 'pct') return parseFloat((msrp * v / 100).toFixed(2));
  if (rule.mode === 'add') return parseFloat((msrp + v).toFixed(2));
  if (rule.mode === 'sub') return parseFloat(Math.max(0, msrp - v).toFixed(2));
  return null;
}

function findBestPricingRule(pricingRules: any[], grade: string | null, condition: string | null): any | null {
  if (!pricingRules?.length) return null;
  // Grade+Condition → Grade only → Condition only → Default
  const match = (g: any, c: any) => pricingRules.find(p =>
    (g != null ? p.grade === g : p.grade == null) &&
    (c != null ? p.condition === c : p.condition == null) &&
    !(g == null && c == null && !p.is_default)
  );
  if (grade && condition) { const r = match(grade, condition); if (r) return r; }
  if (grade) { const r = match(grade, null); if (r) return r; }
  if (condition) { const r = match(null, condition); if (r) return r; }
  return pricingRules.find(p => p.is_default) ?? null;
}

// ApplyConfirmModal: shows a preview and runs the batch update
function ApplyConfirmModal({ orgId, title, description, onConfirm, onClose }: any) {
  const [preview, setPreview] = useState<{ count: number; sample: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onConfirm('preview').then((result: any) => {
      setPreview(result);
      setLoading(false);
    }).catch((e: any) => { setError(e.message); setLoading(false); });
  }, []);

  const run = async () => {
    setApplying(true);
    try {
      const count = await onConfirm('apply');
      setDone(count);
    } catch (e: any) { setError(e.message); }
    setApplying(false);
  };

  return (
    <Modal open onClose={onClose} title="Apply to Current Inventory"
      footer={done != null ? (
        <button onClick={onClose} className="px-4 py-2 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg">Done</button>
      ) : (
        <>
          <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">
            Skip — Future inventory only
          </button>
          <button onClick={run} disabled={loading || applying || !preview?.count}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
            {applying && <Loader2 size={12} className="animate-spin" />}
            Apply to {preview?.count ?? '…'} item{preview?.count !== 1 ? 's' : ''}
          </button>
        </>
      )}>
      <div className="space-y-3">
        <p className="text-[13px] text-gray-700">{description}</p>
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-gray-400">
            <Loader2 size={14} className="animate-spin" />Checking matching inventory…
          </div>
        ) : done != null ? (
          <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl px-4 py-3">
            <p className="text-[13px] font-semibold text-[#15803d]">Updated {done} item{done !== 1 ? 's' : ''} successfully.</p>
          </div>
        ) : preview?.count === 0 ? (
          <p className="text-[13px] text-gray-400 py-2">No matching inventory items found.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-[12px] text-gray-500">{preview?.count} matching item{preview?.count !== 1 ? 's' : ''} will be updated:</p>
            <div className="bg-gray-50 rounded-lg px-3 py-2 space-y-1">
              {preview?.sample.map((s, i) => <p key={i} className="text-[12px] text-gray-700 truncate">{s}</p>)}
              {(preview?.count ?? 0) > 5 && <p className="text-[11px] text-gray-400">…and {(preview?.count ?? 0) - 5} more</p>}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Pricing Presets ───────────────────────────────────────────────────────────
const PRICING_MODES = [
  { value: 'pct', label: '% of MSRP' },
  { value: 'sub', label: 'MSRP − $' },
  { value: 'add', label: 'MSRP + $' },
];

const GRADES_LIST = ['A+', 'A', 'B+', 'B', 'C+', 'C', 'F'];
const CONDITIONS_LIST = [
  { label: 'New', value: 'NEW' }, { label: 'Like New', value: 'LIKE_NEW' },
  { label: 'Open Box', value: 'OPEN_BOX' }, { label: 'Refurbished', value: 'REFURBISHED' },
  { label: 'Good', value: 'GOOD' }, { label: 'Fair', value: 'FAIR' },
  { label: 'Used', value: 'USED' }, { label: 'Poor', value: 'POOR' },
  { label: 'Damaged', value: 'DAMAGED' }, { label: 'Salvage', value: 'SALVAGE' },
  { label: 'Parts Only', value: 'PARTS' },
];

function PricingPresetsView({ orgId, role }: any) {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [newRow, setNewRow] = useState({ grade: '', condition: '', mode: 'pct', value: '', is_default: false });
  const [addError, setAddError] = useState<string | null>(null);
  const canEdit = ['admin', 'manager'].includes(role);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from('pricing_presets').select('*')
      .eq('organization_id', orgId).order('is_default', { ascending: false }).order('grade').order('condition');
    setRows(data ?? []);
    setLoading(false);
  };
  useEffect(() => { if (orgId) load(); }, [orgId]);

  const updateRow = async (id: string, field: string, val: any) => {
    const updatedRows = rows.map(r => r.id === id ? { ...r, [field]: val } : r);
    setRows(updatedRows);
    setSaving(id);
    await supabase.from('pricing_presets').update({ [field]: val }).eq('id', id);
    setSaving(null);
    // Offer apply after mode or value change
    if (field === 'mode' || field === 'value') {
      const updatedRule = updatedRows.find(r => r.id === id);
      if (updatedRule) setApplyRule(updatedRule);
    }
  };

  const deleteRow = async (id: string) => {
    await supabase.from('pricing_presets').delete().eq('id', id);
    setRows(prev => prev.filter(r => r.id !== id));
  };

  const [applyRule, setApplyRule] = useState<any>(null);

  const addRow = async () => {
    if (!newRow.value || parseFloat(newRow.value) <= 0) { setAddError('Value is required.'); return; }
    if (!newRow.grade && !newRow.condition && !newRow.is_default) { setAddError('Select a grade, condition, or mark as default.'); return; }
    setAddError(null);
    const { data, error } = await supabase.from('pricing_presets').insert({
      organization_id: orgId,
      grade: newRow.grade || null,
      condition: newRow.condition || null,
      mode: newRow.mode,
      value: parseFloat(newRow.value),
      is_default: newRow.is_default,
    }).select('*');
    if (error) { setAddError(error.message); return; }
    setRows(prev => [...prev, ...(data ?? [])]);
    setNewRow({ grade: '', condition: '', mode: 'pct', value: '', is_default: false });
    setApplyRule(data?.[0] ?? null);
  };

  const handlePricingApply = (rule: any) => async (mode: 'preview' | 'apply') => {
    // Build query filters based on grade/condition
    let query = supabase.from('inventory_items')
      .select('id, product_title, msrp, grade, condition', { count: 'exact' })
      .eq('organization_id', orgId)
      .not('msrp', 'is', null);
    if (rule.grade) query = query.eq('grade', rule.grade);
    if (rule.condition) query = query.eq('condition', rule.condition);
    const { data: items, count } = await query;
    const matched = (items ?? []).filter((i: any) => i.msrp && i.msrp > 0);
    if (mode === 'preview') {
      return { count: matched.length, sample: matched.slice(0, 5).map((i: any) => i.product_title || i.id) };
    }
    // Load all pricing rules for accurate priority resolution
    const { data: allRules } = await supabase.from('pricing_presets').select('*').eq('organization_id', orgId);
    let updated = 0;
    for (const item of matched) {
      const bestRule = findBestPricingRule(allRules ?? [], item.grade, item.condition);
      const newPrice = applyPricingRuleCalc(item.msrp, bestRule);
      if (newPrice != null) {
        await supabase.from('inventory_items').update({ current_asking_price: newPrice }).eq('id', item.id);
        updated++;
      }
    }
    return updated;
  };

  const condLabel = (v: string) => CONDITIONS_LIST.find(c => c.value === v)?.label ?? v;
  const ruleLabel = (r: any) => {
    if (r.mode === 'pct') return `${r.value}% of MSRP`;
    if (r.mode === 'sub') return `MSRP − $${r.value}`;
    return `MSRP + $${r.value}`;
  };

  return (
    <div className="space-y-5">
      {applyRule && (
        <ApplyConfirmModal
          orgId={orgId}
          title="Apply to Current Inventory"
          description={`Recalculate asking prices for all matching items with MSRP set${applyRule.grade ? `, Grade ${applyRule.grade}` : ''}${applyRule.condition ? `, ${applyRule.condition}` : ''}${applyRule.is_default ? ' (all items with MSRP)' : ''}.`}
          onConfirm={handlePricingApply(applyRule)}
          onClose={() => setApplyRule(null)}
        />
      )}
      <p className="text-[13px] text-gray-500 leading-relaxed">
        Set asking price rules by grade, condition, or both. When adding inventory, the most specific matching rule applies automatically.
        Priority: <span className="font-medium text-gray-700">Grade + Condition</span> → Grade only → Condition only → Default.
      </p>

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_1fr_1fr_120px_32px] gap-3 px-4 py-2 bg-gray-50 border-b border-[rgba(0,0,0,0.06)]">
          {['Grade', 'Condition', 'Rule', 'Value', ''].map(h => (
            <p key={h} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{h}</p>
          ))}
        </div>

        {loading ? (
          <div className="p-8 text-center"><Loader2 size={16} className="animate-spin text-gray-300 mx-auto" /></div>
        ) : rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-gray-400">No pricing rules yet. Add one below.</p>
        ) : (
          <div className="divide-y divide-[rgba(0,0,0,0.05)]">
            {rows.map(r => (
              <div key={r.id} className={`grid grid-cols-[1fr_1fr_1fr_120px_32px] gap-3 px-4 py-2.5 items-center ${r.is_default ? 'bg-[#F0FDF4]' : ''}`}>
                <p className="text-[13px] text-gray-700">{r.grade ?? <span className="text-gray-400 text-[12px]">All grades</span>}</p>
                <p className="text-[13px] text-gray-700">{r.condition ? condLabel(r.condition) : <span className="text-gray-400 text-[12px]">All conditions</span>}</p>
                {canEdit ? (
                  <select value={r.mode} onChange={e => updateRow(r.id, 'mode', e.target.value)}
                    className="text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg px-2 py-1 focus:outline-none bg-white">
                    {PRICING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                ) : <p className="text-[13px] text-gray-700">{PRICING_MODES.find(m => m.value === r.mode)?.label}</p>}
                {canEdit ? (
                  <div className="flex items-center gap-1">
                    <input type="number" value={r.value} min="0" step={r.mode === 'pct' ? '1' : '0.01'}
                      onChange={e => updateRow(r.id, 'value', parseFloat(e.target.value) || 0)}
                      className="w-full px-2 py-1 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none" />
                    {saving === r.id && <Loader2 size={10} className="animate-spin text-gray-300 flex-shrink-0" />}
                  </div>
                ) : <p className="text-[13px] text-gray-700 tabular-nums">{ruleLabel(r)}</p>}
                {canEdit && (
                  <button onClick={() => deleteRow(r.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                    <Trash2 size={12} />
                  </button>
                )}
                {r.is_default && <span className="col-span-5 -mt-1 text-[10px] font-medium text-[#15803d]">Default — applies when no grade/condition rule matches</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add new rule */}
      {canEdit && (
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-[12px] font-semibold text-gray-600">Add Rule</p>
          {addError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{addError}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1 block">Grade</label>
              <select className={selectCls} value={newRow.grade} onChange={e => setNewRow(r => ({ ...r, grade: e.target.value, is_default: false }))}>
                <option value="">— Any —</option>
                {GRADES_LIST.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1 block">Condition</label>
              <select className={selectCls} value={newRow.condition} onChange={e => setNewRow(r => ({ ...r, condition: e.target.value, is_default: false }))}>
                <option value="">— Any —</option>
                {CONDITIONS_LIST.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1 block">Method</label>
              <select className={selectCls} value={newRow.mode} onChange={e => setNewRow(r => ({ ...r, mode: e.target.value }))}>
                {PRICING_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1 block">Value</label>
              <input type="number" className={inputCls} placeholder={newRow.mode === 'pct' ? '80' : '10.00'}
                value={newRow.value} onChange={e => setNewRow(r => ({ ...r, value: e.target.value }))}
                min="0" step={newRow.mode === 'pct' ? '1' : '0.01'} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={newRow.is_default}
                onChange={e => setNewRow(r => ({ ...r, is_default: e.target.checked, grade: '', condition: '' }))}
                className="w-3.5 h-3.5 accent-gray-800" />
              <span className="text-[13px] text-gray-600">Set as default fallback rule</span>
            </label>
            <button onClick={addRow}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg">
              <Plus size={13} />Add Rule
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Product Presets ───────────────────────────────────────────────────────────
function PresetModal({ preset, onClose, onSaved, orgId }: any) {
  const [form, setForm] = useState({
    brand: preset?.brand ?? '',
    model: preset?.model ?? '',
    product_title: preset?.product_title ?? '',
    category: preset?.category ?? '',
    msrp: preset?.msrp != null ? String(preset.msrp) : '',
    weight_oz: preset?.weight_oz != null ? String(preset.weight_oz) : '',
    length_in: preset?.length_in != null ? String(preset.length_in) : '',
    width_in: preset?.width_in != null ? String(preset.width_in) : '',
    height_in: preset?.height_in != null ? String(preset.height_in) : '',
    notes: preset?.notes ?? '',
  });
  const [presetSupplies, setPresetSupplies] = useState<any[]>([]);
  const [allSupplies, setAllSupplies] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addSupplyId, setAddSupplyId] = useState('');
  const [addSupplyQty, setAddSupplyQty] = useState('1');
  const [showNewSupply, setShowNewSupply] = useState(false);
  const [newSupplySaving, setNewSupplySaving] = useState(false);
  const [newSupplyError, setNewSupplyError] = useState<string | null>(null);
  const EMPTY_NEW_SUPPLY = { name: '', unit_of_measure: '', unit_cost: '', quantity_on_hand: '0' };
  const [newSupplyForm, setNewSupplyForm] = useState(EMPTY_NEW_SUPPLY);
  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }));

  const reloadSupplies = async () => {
    const { data } = await supabase.from('supplies').select('id, name, unit_of_measure, unit_cost')
      .eq('organization_id', orgId).order('name');
    setAllSupplies(data ?? []);
  };

  const createAndAddSupply = async () => {
    if (!newSupplyForm.name.trim()) { setNewSupplyError('Name is required.'); return; }
    setNewSupplySaving(true); setNewSupplyError(null);
    const { data, error: err } = await supabase.from('supplies').insert({
      organization_id: orgId,
      name: newSupplyForm.name.trim(),
      unit_of_measure: newSupplyForm.unit_of_measure.trim() || null,
      unit_cost: parseFloat(newSupplyForm.unit_cost) || null,
      quantity_on_hand: parseFloat(newSupplyForm.quantity_on_hand) || 0,
      status: 'ACTIVE',
    }).select('id, name, unit_of_measure, unit_cost');
    if (err) { setNewSupplyError(err.message); setNewSupplySaving(false); return; }
    const newSupply = data?.[0];
    if (newSupply) {
      await reloadSupplies();
      // Immediately add to preset
      const qty = parseFloat(addSupplyQty) || 1;
      if (preset?.id) {
        const { data: ps } = await supabase.from('preset_supplies')
          .insert({ preset_id: preset.id, supply_id: newSupply.id, quantity: qty })
          .select('id, supply_id, quantity, supplies(id, name, unit_of_measure, unit_cost)');
        setPresetSupplies(prev => [...prev, ...(ps ?? [])]);
      } else {
        setPresetSupplies(prev => [...prev, { supply_id: newSupply.id, quantity: qty, supplies: newSupply }]);
      }
    }
    setShowNewSupply(false);
    setNewSupplyForm(EMPTY_NEW_SUPPLY);
    setNewSupplySaving(false);
    setAddSupplyQty('1');
  };

  useEffect(() => {
    reloadSupplies();
    if (preset?.id) {
      supabase.from('preset_supplies').select('id, supply_id, quantity, supplies(id, name, unit_of_measure, unit_cost)')
        .eq('preset_id', preset.id)
        .then(({ data }) => setPresetSupplies(data ?? []));
    }
  }, [preset?.id, orgId]);

  const addSupply = async (presetId: string) => {
    if (!addSupplyId || !addSupplyQty) return;
    const { data } = await supabase.from('preset_supplies')
      .insert({ preset_id: presetId, supply_id: addSupplyId, quantity: parseFloat(addSupplyQty) || 1 })
      .select('id, supply_id, quantity, supplies(id, name, unit_of_measure, unit_cost)');
    setPresetSupplies(prev => [...prev, ...(data ?? [])]);
    setAddSupplyId(''); setAddSupplyQty('1');
  };

  const removeSupply = async (psId: string) => {
    await supabase.from('preset_supplies').delete().eq('id', psId);
    setPresetSupplies(prev => prev.filter(p => p.id !== psId));
  };

  const [showApply, setShowApply] = useState(false);
  const [savedPayload, setSavedPayload] = useState<any>(null);

  const save = async () => {
    if (!form.brand.trim() || !form.model.trim()) { setError('Brand and model are required.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        organization_id: orgId,
        brand: form.brand.trim(),
        model: form.model.trim(),
        product_title: form.product_title.trim() || null,
        category: form.category.trim() || null,
        msrp: parseFloat(form.msrp) || null,
        weight_oz: parseFloat(form.weight_oz) || null,
        length_in: parseFloat(form.length_in) || null,
        width_in: parseFloat(form.width_in) || null,
        height_in: parseFloat(form.height_in) || null,
        notes: form.notes.trim() || null,
        updated_at: new Date().toISOString(),
      };
      let savedId = preset?.id;
      if (preset?.id) {
        const { error: err } = await supabase.from('product_presets').update(payload).eq('id', preset.id);
        if (err) throw new Error(err.message);
      } else {
        const { data, error: err } = await supabase.from('product_presets').insert(payload).select('id');
        if (err) throw new Error(err.message);
        savedId = data?.[0]?.id;
        if (savedId && presetSupplies.length > 0) {
          await supabase.from('preset_supplies').insert(
            presetSupplies.map(ps => ({ preset_id: savedId, supply_id: ps.supply_id, quantity: ps.quantity }))
          );
        }
      }
      onSaved();
      setSavedPayload(payload);
      setSaving(false);
      setShowApply(true); // offer apply to current inventory
    } catch (e: any) { setError(e.message); setSaving(false); }
  };

  const handleProductPresetApply = async (mode: 'preview' | 'apply') => {
    if (!savedPayload) return { count: 0, sample: [] };
    // Fetch matching items by brand + model
    const { data: items, count } = await supabase
      .from('inventory_items')
      .select('id, product_title, msrp, grade, condition', { count: 'exact' })
      .eq('organization_id', orgId)
      .eq('brand', savedPayload.brand)
      .eq('model', savedPayload.model);
    const matched = items ?? [];
    if (mode === 'preview') {
      return { count: count ?? 0, sample: matched.slice(0, 5).map((i: any) => i.product_title || i.id) };
    }
    // Load pricing presets for asking price recalc
    const { data: pricingRules } = await supabase.from('pricing_presets').select('*').eq('organization_id', orgId);
    let updated = 0;
    for (let i = 0; i < matched.length; i += 50) {
      const batch = matched.slice(i, i + 50);
      for (const item of batch) {
        const updates: any = {};
        if (savedPayload.product_title) updates.product_title = savedPayload.product_title;
        if (savedPayload.category) updates.category = savedPayload.category;
        if (savedPayload.weight_oz != null) updates.weight_oz = savedPayload.weight_oz;
        if (savedPayload.length_in != null) updates.length_in = savedPayload.length_in;
        if (savedPayload.width_in != null) updates.width_in = savedPayload.width_in;
        if (savedPayload.height_in != null) updates.height_in = savedPayload.height_in;
        // MSRP update + asking price recalc
        const newMsrp = savedPayload.msrp ?? item.msrp;
        if (savedPayload.msrp != null) updates.msrp = savedPayload.msrp;
        if (newMsrp) {
          const rule = findBestPricingRule(pricingRules ?? [], item.grade, item.condition);
          const newPrice = applyPricingRuleCalc(newMsrp, rule);
          if (newPrice != null) updates.current_asking_price = newPrice;
        }
        if (Object.keys(updates).length > 0) {
          await supabase.from('inventory_items').update(updates).eq('id', item.id);
          updated++;
        }
      }
    }
    return updated;
  };

  const availableSupplies = allSupplies.filter(s => !presetSupplies.some(ps => ps.supply_id === s.id));

  return (
    <>
    {showApply && (
      <ApplyConfirmModal
        orgId={orgId}
        title="Apply to Current Inventory"
        description={`Update all inventory items with brand "${savedPayload?.brand}" and model "${savedPayload?.model}" with the new preset values (title, category, MSRP, dimensions). Asking prices will be recalculated.`}
        onConfirm={handleProductPresetApply}
        onClose={() => { setShowApply(false); onClose(); }}
      />
    )}
    <Modal open={!showApply} onClose={onClose} title={preset?.id ? 'Edit Preset' : 'New Preset'} width="max-w-2xl"
      footer={<>
        <button onClick={onClose} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}Save Preset
        </button>
      </>}>
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        {/* Identity */}
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Brand" required>
            <input className={inputCls} value={form.brand} onChange={e => set('brand', e.target.value)} placeholder="Apple" />
          </FormField>
          <FormField label="Model" required>
            <input className={inputCls} value={form.model} onChange={e => set('model', e.target.value)} placeholder="iPhone 15 Pro" />
          </FormField>
        </div>
        <FormField label="Product Title">
          <input className={inputCls} value={form.product_title} onChange={e => set('product_title', e.target.value)} placeholder="Apple iPhone 15 Pro 128GB Space Black" />
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Category">
            <input className={inputCls} value={form.category} onChange={e => set('category', e.target.value)} placeholder="Electronics" />
          </FormField>
          <FormField label="Default MSRP ($)">
            <input type="number" className={inputCls} value={form.msrp} onChange={e => set('msrp', e.target.value)} placeholder="299.99" min="0" step="0.01" />
          </FormField>
        </div>

        {/* Physical specs */}
        <div className="bg-gray-50 rounded-xl p-4 space-y-3">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Physical Specs</p>
          <div className="grid grid-cols-4 gap-3">
            <FormField label="Weight (oz)">
              <input type="number" className={inputCls} value={form.weight_oz} onChange={e => set('weight_oz', e.target.value)} placeholder="16.0" min="0" step="0.1" />
            </FormField>
            <FormField label="Length (in)">
              <input type="number" className={inputCls} value={form.length_in} onChange={e => set('length_in', e.target.value)} placeholder="12.0" min="0" step="0.1" />
            </FormField>
            <FormField label="Width (in)">
              <input type="number" className={inputCls} value={form.width_in} onChange={e => set('width_in', e.target.value)} placeholder="8.0" min="0" step="0.1" />
            </FormField>
            <FormField label="Height (in)">
              <input type="number" className={inputCls} value={form.height_in} onChange={e => set('height_in', e.target.value)} placeholder="4.0" min="0" step="0.1" />
            </FormField>
          </div>
        </div>

        {/* Default supplies */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Default Supplies</p>
          <p className="text-[11px] text-gray-400">These supplies are automatically consumed when this preset is applied to an inventory item.</p>

          {/* Existing preset supply rows */}
          {presetSupplies.length > 0 && (
            <div className="border border-[rgba(0,0,0,0.07)] rounded-lg overflow-hidden divide-y divide-[rgba(0,0,0,0.05)]">
              {presetSupplies.map(ps => (
                <div key={ps.id ?? ps.supply_id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-gray-800">{ps.supplies?.name ?? ps.supply_id}</p>
                    {ps.supplies?.unit_of_measure && <p className="text-[11px] text-gray-400">{ps.supplies.unit_of_measure}{ps.supplies?.unit_cost != null ? ` · $${Number(ps.supplies.unit_cost).toFixed(2)}` : ''}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="number" value={ps.quantity} min="0.01" step="0.01"
                      onChange={async e => {
                        const q = parseFloat(e.target.value) || 1;
                        setPresetSupplies(prev => prev.map(p => p.id === ps.id ? { ...p, quantity: q } : p));
                        if (ps.id) await supabase.from('preset_supplies').update({ quantity: q }).eq('id', ps.id);
                      }}
                      className="w-16 px-2 py-1 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20" />
                    <button onClick={() => ps.id ? removeSupply(ps.id) : setPresetSupplies(prev => prev.filter(p => p.supply_id !== ps.supply_id))}
                      className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-400 transition-colors">
                      <X size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Add from existing supplies */}
          <div className="flex items-center gap-2">
            <select className={selectCls + ' flex-1'} value={addSupplyId}
              onChange={e => { if (e.target.value === '__new__') { setShowNewSupply(true); setAddSupplyId(''); } else setAddSupplyId(e.target.value); }}>
              <option value="">{availableSupplies.length === 0 ? '— No supplies yet —' : '— Select a supply —'}</option>
              {availableSupplies.map(s => <option key={s.id} value={s.id}>{s.name}{s.unit_of_measure ? ` (${s.unit_of_measure})` : ''}</option>)}
              <option value="__new__">+ Create new supply…</option>
            </select>
            <input type="number" value={addSupplyQty} onChange={e => setAddSupplyQty(e.target.value)}
              className="w-16 px-2 py-1.5 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20"
              min="0.01" step="0.01" placeholder="Qty" />
            <button
              onClick={() => {
                if (!addSupplyId) return;
                if (preset?.id) {
                  addSupply(preset.id);
                } else {
                  setPresetSupplies(prev => [...prev, {
                    supply_id: addSupplyId,
                    quantity: parseFloat(addSupplyQty) || 1,
                    supplies: allSupplies.find(s => s.id === addSupplyId),
                  }]);
                  setAddSupplyId(''); setAddSupplyQty('1');
                }
              }}
              disabled={!addSupplyId}
              className="px-3 py-1.5 text-[13px] font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 whitespace-nowrap">
              Add
            </button>
          </div>

          {/* Inline create new supply form */}
          {showNewSupply && (
            <div className="border border-[#BBF7D0] bg-[#F0FDF4] rounded-xl p-4 space-y-3">
              <p className="text-[12px] font-semibold text-[#15803d]">Create New Supply</p>
              <p className="text-[11px] text-[#16a34a]">This supply will be added to your Supplies page and immediately available here.</p>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Name" required>
                  <input className={inputCls} value={newSupplyForm.name} onChange={e => setNewSupplyForm(f => ({ ...f, name: e.target.value }))} placeholder="Poly Bag 6x9" />
                </FormField>
                <FormField label="Unit of Measure">
                  <input className={inputCls} value={newSupplyForm.unit_of_measure} onChange={e => setNewSupplyForm(f => ({ ...f, unit_of_measure: e.target.value }))} placeholder="ea, box, roll…" />
                </FormField>
                <FormField label="Unit Cost ($)">
                  <input type="number" className={inputCls} value={newSupplyForm.unit_cost} onChange={e => setNewSupplyForm(f => ({ ...f, unit_cost: e.target.value }))} placeholder="0.25" min="0" step="0.01" />
                </FormField>
                <FormField label="Starting Qty on Hand">
                  <input type="number" className={inputCls} value={newSupplyForm.quantity_on_hand} onChange={e => setNewSupplyForm(f => ({ ...f, quantity_on_hand: e.target.value }))} placeholder="0" min="0" step="1" />
                </FormField>
              </div>
              {newSupplyError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{newSupplyError}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowNewSupply(false); setNewSupplyForm(EMPTY_NEW_SUPPLY); setNewSupplyError(null); }}
                  className="px-3 py-1.5 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-white">
                  Cancel
                </button>
                <button onClick={createAndAddSupply} disabled={newSupplySaving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium bg-[#3ECF8E] hover:bg-[#38c484] text-white rounded-lg disabled:opacity-60">
                  {newSupplySaving && <Loader2 size={11} className="animate-spin" />}Create &amp; Add
                </button>
              </div>
            </div>
          )}
        </div>

        <FormField label="Notes">
          <textarea className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white resize-none" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any additional notes about this product..." />
        </FormField>
      </div>
    </Modal>
    </>
  );
}

function ProductPresetsView({ orgId, userId, role }: any) {
  const [presets, setPresets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from('product_presets')
      .select('*')
      .eq('organization_id', orgId)
      .order('brand').order('model');
    if (err) setError(err.message);
    else setPresets(data ?? []);
    setLoading(false);
  };

  useEffect(() => { if (orgId) load(); }, [orgId]);

  const filtered = presets.filter(p =>
    !search || `${p.brand} ${p.model}`.toLowerCase().includes(search.toLowerCase())
  );

  const deletePreset = async (id: string) => {
    await supabase.from('product_presets').delete().eq('id', id);
    setConfirmDelete(null);
    load();
  };

  const canEdit = ['admin', 'manager'].includes(role);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-gray-500">Save brand + model combinations with physical specs so they auto-fill when processing inventory items.</p>
        </div>
        {canEdit && (
          <button onClick={() => { setEditing(null); setShowModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg flex-shrink-0">
            <Plus size={13} />New Preset
          </button>
        )}
      </div>

      <div className="relative">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search presets..."
          className="w-full pl-3 pr-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white" />
      </div>

      <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
        {loading ? (
          <div className="space-y-0">{[1,2,3].map(i => <div key={i} className="h-14 border-b border-[rgba(0,0,0,0.04)] animate-pulse bg-gray-50" />)}</div>
        ) : error ? (
          <p className="px-5 py-8 text-center text-[13px] text-red-500">{error}</p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Bookmark size={24} className="text-gray-200 mx-auto mb-2" />
            <p className="text-[13px] text-gray-400">{search ? 'No presets match your search.' : 'No presets yet. Add one to speed up inventory processing.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-[rgba(0,0,0,0.05)]">
            {/* Header */}
            <div className="grid grid-cols-[1fr_60px_80px_80px_80px_80px_auto] gap-3 px-4 py-2 bg-gray-50 border-b border-[rgba(0,0,0,0.06)]">
              {['Brand / Model', 'Weight', 'L', 'W', 'H', 'Notes', ''].map(h => (
                <p key={h} className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{h}</p>
              ))}
            </div>
            {filtered.map(p => (
              <div key={p.id} className="grid grid-cols-[1fr_60px_80px_80px_80px_80px_auto] gap-3 px-4 py-3 items-center hover:bg-gray-50/60 transition-colors">
                <div>
                  <p className="text-[13px] font-medium text-gray-900">{p.brand}</p>
                  <p className="text-[11px] text-gray-400">{p.model}</p>
                </div>
                <p className="text-[12px] text-gray-600 tabular-nums">{p.weight_oz != null ? `${p.weight_oz} oz` : '—'}</p>
                <p className="text-[12px] text-gray-600 tabular-nums">{p.length_in != null ? `${p.length_in}"` : '—'}</p>
                <p className="text-[12px] text-gray-600 tabular-nums">{p.width_in != null ? `${p.width_in}"` : '—'}</p>
                <p className="text-[12px] text-gray-600 tabular-nums">{p.height_in != null ? `${p.height_in}"` : '—'}</p>
                <p className="text-[11px] text-gray-400 truncate">{p.notes || '—'}</p>
                {canEdit && (
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => { setEditing(p); setShowModal(true); }}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => setConfirmDelete(p)}
                      className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <PresetModal
          preset={editing}
          orgId={orgId}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={load}
        />
      )}

      {confirmDelete && (
        <Modal open onClose={() => setConfirmDelete(null)} title="Delete Preset"
          footer={<>
            <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 text-[13px] text-gray-600 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={() => deletePreset(confirmDelete.id)} className="px-4 py-2 text-[13px] font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete</button>
          </>}>
          <p className="text-[13px] text-gray-700">Delete the preset for <span className="font-medium">{confirmDelete.brand} {confirmDelete.model}</span>? This won't affect existing inventory items.</p>
        </Modal>
      )}
    </div>
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
export function Settings() {
  const view = useSecondaryView();
  const { orgId, user, currentOrg, currentRole, refreshMemberships, signOut } = useAuth();
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [showInvite, setShowInvite] = useState(false);
  const _sortInit = (() => { try { return JSON.parse(localStorage.getItem('deryv.sort.settings') ?? 'null') ?? {}; } catch { return {}; } })();
  const [sortCol, setSortCol] = useState<string | null>(_sortInit.col ?? null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_sortInit.dir ?? 'asc');
  const handleSort = (col: string) => {
    const next = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    const nextCol = sortCol === col ? col : col;
    setSortCol(nextCol);
    setSortDir(next as 'asc' | 'desc');
    localStorage.setItem('deryv.sort.settings', JSON.stringify({ col: nextCol, dir: next }));
  };
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);
  const [notifSaved, setNotifSaved] = useState(false);
  const [notifState, setNotifState] = useState<Record<string, { email: boolean; push: boolean }>>(() => {
    try {
      const saved = localStorage.getItem(NOTIF_PREFS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return Object.fromEntries(NOTIF_DEFAULTS.map(n => [n.id, { email: n.email, push: n.push }]));
  });

  const saveNotifPrefs = () => {
    localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(notifState));
    setNotifSaved(true);
    setTimeout(() => setNotifSaved(false), 2000);
  };

  // Org settings form
  const [orgForm, setOrgForm] = useState({
    name: currentOrg?.name ?? '',
    slug: currentOrg?.slug ?? '',
    website: (currentOrg as any)?.website ?? '',
    logo_url: (currentOrg as any)?.logo_url ?? '',
    industry: (currentOrg as any)?.industry ?? '',
  });

  // Company Branding form
  const [brandingForm, setBrandingForm] = useState({
    name: currentOrg?.name ?? '',
    logo_url: (currentOrg as any)?.logo_url ?? '',
    primary_color: (currentOrg as any)?.accent_color ?? '#3ECF8E',
    support_email: (currentOrg as any)?.support_email ?? '',
    website: (currentOrg as any)?.website ?? '',
  });
  const [savingBranding, setSavingBranding] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);
  const [brandingSaved, setBrandingSaved] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);

  // Inventory ID settings
  const [invForm, setInvForm] = useState({
    inventory_prefix: (currentOrg as any)?.inventory_prefix ?? 'INV',
    inventory_seq_start: String((currentOrg as any)?.inventory_seq_start ?? 1),
  });
  const [savingInv, setSavingInv] = useState(false);
  const [invSaved, setInvSaved] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);

  // Warehouse address settings
  const [warehouseForm, setWarehouseForm] = useState({
    warehouse_name: (currentOrg as any)?.warehouse_name ?? '',
    warehouse_street1: (currentOrg as any)?.warehouse_street1 ?? '',
    warehouse_city: (currentOrg as any)?.warehouse_city ?? '',
    warehouse_state: (currentOrg as any)?.warehouse_state ?? '',
    warehouse_zip: (currentOrg as any)?.warehouse_zip ?? '',
    warehouse_country: (currentOrg as any)?.warehouse_country ?? 'US',
    warehouse_phone: (currentOrg as any)?.warehouse_phone ?? '',
  });
  const [savingWarehouse, setSavingWarehouse] = useState(false);
  const [warehouseSaved, setWarehouseSaved] = useState(false);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);

  useEffect(() => {
    if (currentOrg) {
      setWarehouseForm({
        warehouse_name: (currentOrg as any)?.warehouse_name ?? '',
        warehouse_street1: (currentOrg as any)?.warehouse_street1 ?? '',
        warehouse_city: (currentOrg as any)?.warehouse_city ?? '',
        warehouse_state: (currentOrg as any)?.warehouse_state ?? '',
        warehouse_zip: (currentOrg as any)?.warehouse_zip ?? '',
        warehouse_country: (currentOrg as any)?.warehouse_country ?? 'US',
        warehouse_phone: (currentOrg as any)?.warehouse_phone ?? '',
      });
    }
  }, [currentOrg]);

  const { data: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useOrgQuery<any>(
    'organization_members', orgId, { select: 'id, user_id, role, created_at' }
  );

  const { data: apiKeys, loading: keysLoading } = useOrgQuery<any>(
    'integration_connections', orgId, {
      select: 'id, provider, status, created_at, last_sync_at',
      filter: (q: any) => q.eq('status', 'CONNECTED'),
    }
  );

  const saveOrgSettings = async () => {
    if (!orgId || !orgForm.name) return;
    setSavingOrg(true); setOrgSaved(false);
    const { error } = await supabase.from('organizations').update({
      name: orgForm.name,
      slug: orgForm.slug,
      website: orgForm.website || null,
      logo_url: orgForm.logo_url || null,
      industry: orgForm.industry || null,
    }).eq('id', orgId);
    if (!error) {
      await logActivity(orgId, user?.id!, 'Organization profile updated', 'organizations', orgId, 'update');
      setOrgSaved(true);
      setTimeout(() => setOrgSaved(false), 2500);
    }
    setSavingOrg(false);
  };

  const saveBranding = async () => {
    if (!orgId) return;
    setSavingBranding(true);
    await updateRow('organizations', orgId, {
      name: brandingForm.name || null,
      accent_color: brandingForm.primary_color || '#3ECF8E',
      support_email: brandingForm.support_email || null,
      website: brandingForm.website || null,
    });
    await logActivity(orgId, user?.id!, 'Company branding updated', 'organizations', orgId, 'update');
    setSavingBranding(false);
    setBrandingSaved(true);
    setTimeout(() => setBrandingSaved(false), 2500);
  };

  const saveInventorySettings = async () => {
    if (!orgId) return;
    setInvError(null);
    const prefix = invForm.inventory_prefix.trim().toUpperCase();
    const seqStart = parseInt(invForm.inventory_seq_start);
    if (!prefix || prefix.length < 1 || prefix.length > 10) { setInvError('Prefix must be 1–10 characters.'); return; }
    if (!/^[A-Z0-9]+$/.test(prefix)) { setInvError('Prefix can only contain letters and numbers.'); return; }
    if (isNaN(seqStart) || seqStart < 1) { setInvError('Starting number must be at least 1.'); return; }
    setSavingInv(true);
    const { error } = await supabase.from('organizations').update({
      inventory_prefix: prefix,
      inventory_seq_start: seqStart,
    }).eq('id', orgId);
    setSavingInv(false);
    if (error) { setInvError(error.message); return; }
    await logActivity(orgId, user?.id!, 'Inventory ID settings updated', 'organizations', orgId, 'update');
    setInvSaved(true);
    setTimeout(() => setInvSaved(false), 2500);
  };

  const saveWarehouseSettings = async () => {
    if (!orgId) return;
    setWarehouseError(null);
    if (!warehouseForm.warehouse_zip) { setWarehouseError('ZIP code is required for shipping rate calculations.'); return; }
    setSavingWarehouse(true);
    const { error } = await supabase.from('organizations').update({
      warehouse_name: warehouseForm.warehouse_name || null,
      warehouse_street1: warehouseForm.warehouse_street1 || null,
      warehouse_city: warehouseForm.warehouse_city || null,
      warehouse_state: warehouseForm.warehouse_state || null,
      warehouse_zip: warehouseForm.warehouse_zip || null,
      warehouse_country: warehouseForm.warehouse_country || 'US',
      warehouse_phone: warehouseForm.warehouse_phone || null,
    }).eq('id', orgId);
    setSavingWarehouse(false);
    if (error) { setWarehouseError(error.message); return; }
    await logActivity(orgId, user?.id!, 'Warehouse address updated', 'organizations', orgId, 'update');
    setWarehouseSaved(true);
    setTimeout(() => setWarehouseSaved(false), 2500);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploadingLogo(true); setLogoUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('orgId', orgId);
      const result = await serverUpload('/branding/upload-logo', fd);
      setBrandingForm(f => ({ ...f, logo_url: result.public_url }));
      await logActivity(orgId, user?.id!, 'Company logo updated', 'organizations', orgId, 'update');
    } catch (err: any) {
      setLogoUploadError(err.message ?? 'Logo upload failed');
    } finally {
      setUploadingLogo(false);
      if (logoFileRef.current) logoFileRef.current.value = '';
    }
  };

  const removeMember = async (memberId: string, memberUserId: string) => {
    if (memberUserId === user?.id) return;
    await deleteRow('organization_members', memberId);
    await logActivity(orgId!, user?.id!, 'Team member removed', 'organization_members');
    reloadMembers();
  };

  const updateMemberRole = async (memberId: string, newRole: string) => {
    await updateRow('organization_members', memberId, { role: newRole });
  };

  const handleSignOut = async () => { await signOut(); };

  // Live preview of what the next ID will look like
  const year = new Date().getFullYear().toString().slice(2);
  const previewPrefix = invForm.inventory_prefix.trim().toUpperCase() || 'INV';
  const previewSeq = parseInt(invForm.inventory_seq_start) || 1;
  const previewId = `${previewPrefix}-${year}-${String(previewSeq).padStart(6, '0')}`;



  const sorted = sortItems(members, sortCol, sortDir, (item: any, col: string) => {
    if (col === 'member') return item.user_id;
    if (col === 'role') return item.role;
    return null;
  });

  return (
    <div className="p-6 max-w-[860px] space-y-5">
      <div>
        <h2 className="text-gray-900">Settings</h2>
        <p className="text-[13px] text-gray-400 mt-0.5">Manage your organization, users, and preferences</p>
      </div>

      {/* Organization */}
      {(view === 'org' || view === 'overview') && (
        <Section title="Organization Profile">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Organization Name</label>
              <input value={orgForm.name} onChange={e => setOrgForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Slug</label>
              <input value={orgForm.slug} onChange={e => setOrgForm(f => ({ ...f, slug: e.target.value }))}
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Website</label>
              <input type="url" value={orgForm.website} onChange={e => setOrgForm(f => ({ ...f, website: e.target.value }))}
                placeholder="https://www.company.com"
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Industry / Type</label>
              <input value={orgForm.industry} onChange={e => setOrgForm(f => ({ ...f, industry: e.target.value }))}
                placeholder="e.g. E-commerce, Retail, Wholesale"
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white" />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Logo URL</label>
              <input type="url" value={orgForm.logo_url} onChange={e => setOrgForm(f => ({ ...f, logo_url: e.target.value }))}
                placeholder="https://example.com/logo.png"
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white" />
              <p className="text-[11px] text-gray-400 mt-1">Optional: Direct URL to your organization's logo image.</p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Plan</label>
              <input value={currentOrg?.plan ?? 'starter'} readOnly
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg bg-gray-50 text-gray-500 cursor-default" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Your Role</label>
              <input value={currentRole ?? '—'} readOnly
                className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg bg-gray-50 text-gray-500 cursor-default capitalize" />
            </div>
          </div>
          <div className="flex items-center justify-between mt-5 pt-4 border-t border-[rgba(0,0,0,0.06)]">
            {orgSaved && <span className="text-[12px] text-[#3ECF8E]">Saved successfully</span>}
            <button onClick={saveOrgSettings} disabled={savingOrg}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60 ml-auto">
              {savingOrg ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save Changes
            </button>
          </div>
        </Section>
      )}

      {/* Users */}
      {view === 'users' && (
        <Section title="Team Members" action={
          <button onClick={() => setShowInvite(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
            <Plus size={12} />Invite Member
          </button>
        }>

          {membersLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-10 bg-gray-50 rounded-lg animate-pulse" />)}</div>
          ) : membersError ? <ErrorState message={membersError} onRetry={reloadMembers} />
          : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(0,0,0,0.06)]">
                  {([
                    { label: 'Member', col: 'member' },
                    { label: 'Role', col: 'role' },
                    { label: '', col: '' },
                  ] as const).map(({ label, col }) => (
                    <th key={col} onClick={() => col && handleSort(col)}
                      className={`text-left py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide pr-4 ${col ? 'cursor-pointer select-none hover:text-gray-600 transition-colors' : ''}`}>
                      <span className="inline-flex items-center gap-1">
                        {label}
                        {col && sortCol === col
                          ? <span className="text-[#3ECF8E]">{sortDir === 'asc' ? '↑' : '↓'}</span>
                          : col ? <span className="opacity-0">↕</span> : null}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr><td colSpan={3} className="py-8 text-center text-[13px] text-gray-400">No team members yet.</td></tr>
                ) : sorted.map((m: any, i: number) => {
                  const isCurrentUser = m.user_id === user?.id;
                  const initials = m.user_id?.slice(0, 2).toUpperCase() ?? 'U?';
                  return (
                    <tr key={m.id} className={`hover:bg-gray-50/60 ${i < sorted.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
                            <span className="text-white text-[10px] font-semibold">{initials}</span>
                          </div>
                          <div>
                            <p className="text-[13px] font-medium text-gray-900">{isCurrentUser ? 'You' : `Member ${m.user_id?.slice(0, 6)}`}</p>
                            <p className="text-[11px] text-gray-400">Added {new Date(m.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <select defaultValue={m.role} onChange={e => updateMemberRole(m.id, e.target.value)}
                          className="text-[13px] text-gray-700 border border-[rgba(0,0,0,0.1)] rounded-lg px-2 py-1 focus:outline-none bg-white capitalize"
                          disabled={isCurrentUser}>
                          {ROLES.map(r => <option key={r} value={r} className="capitalize">{r}</option>)}
                        </select>
                      </td>
                      <td className="py-3">
                        {!isCurrentUser && (
                          <button onClick={() => removeMember(m.id, m.user_id)} className="text-gray-300 hover:text-red-400 p-1 rounded transition-colors">
                            <Trash2 size={12} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      )}

      {/* Permissions */}
      {view === 'permissions' && (
        <Section title="Role Permissions">
          <div className="space-y-3">
            {ROLES.map(role => (
              <div key={role} className="flex items-center justify-between py-2.5 border-b border-[rgba(0,0,0,0.04)] last:border-0">
                <div>
                  <p className="text-[13px] font-medium text-gray-900 capitalize">{role}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {role === 'admin' ? 'Full access — can manage team, settings, and all data.' :
                     role === 'manager' ? 'Can create and edit all records, manage operations.' :
                     role === 'warehouse' ? 'Inventory, shipping, and warehouse operations.' :
                     role === 'accounting' ? 'Orders, reports, and financial data. Read-only on inventory.' :
                     'Read-only access to all modules.'}
                  </p>
                </div>
                <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${role === 'admin' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {role}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* API Keys */}
      {view === 'api' && (
        <Section title="Connected Integrations" action={
          <span className="text-[12px] text-gray-400">{apiKeys.length} connected</span>
        }>
          {keysLoading ? (
            <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-16 bg-gray-50 rounded-xl animate-pulse" />)}</div>
          ) : apiKeys.length === 0 ? (
            <p className="text-[13px] text-gray-400 py-4 text-center">No integrations connected. Visit the Integrations page to connect services.</p>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((k: any) => (
                <div key={k.id} className="border border-[rgba(0,0,0,0.08)] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-semibold text-gray-900 capitalize">{k.provider}</p>
                    <button onClick={() => setShowKey(s => ({...s, [k.id]: !s[k.id]}))} className="text-gray-400 hover:text-gray-700 p-0.5">
                      {showKey[k.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-3 py-2 font-mono text-[12px] text-gray-600 mb-2 border border-[rgba(0,0,0,0.06)]">
                    {showKey[k.id] ? k.id : `${k.id.slice(0, 8)}••••••••••••••••`}
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400">
                    <span>Connected {new Date(k.created_at).toLocaleDateString()}</span>
                    <span>{k.last_sync_at ? `Synced ${new Date(k.last_sync_at).toLocaleDateString()}` : 'Never synced'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Notifications */}
      {view === 'notifications' && (
        <Section title="Notification Preferences">
          <div className="flex items-start gap-2 text-[12px] text-gray-500 bg-gray-50 border border-[rgba(0,0,0,0.07)] px-3 py-2.5 rounded-lg mb-4">
            <Info size={13} className="flex-shrink-0 mt-px text-gray-400" />
            <span>Preferences are saved in this browser only. Server-side delivery configuration is not yet available.</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-[rgba(0,0,0,0.06)]">
                <th className="text-left py-2 text-[11px] font-medium text-gray-400 uppercase tracking-wide">Event</th>
                <th className="text-center py-2 px-4 text-[11px] font-medium text-gray-400 uppercase tracking-wide">Email</th>
                <th className="text-center py-2 px-4 text-[11px] font-medium text-gray-400 uppercase tracking-wide">Push</th>
              </tr>
            </thead>
            <tbody>
              {NOTIF_DEFAULTS.map((n, i) => (
                <tr key={n.id} className={i < NOTIF_DEFAULTS.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}>
                  <td className="py-3 text-[13px] text-gray-700">{n.label}</td>
                  {(['email', 'push'] as const).map(type => (
                    <td key={type} className="py-3 px-4 text-center">
                      <button
                        onClick={() => setNotifState(s => ({...s, [n.id]: {...s[n.id], [type]: !s[n.id]?.[type]}}))}
                        className={`w-9 h-5 rounded-full transition-colors relative inline-flex flex-shrink-0 ${notifState[n.id]?.[type] ? 'bg-[#3ECF8E]' : 'bg-gray-200'}`}
                      >
                        <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all shadow-sm ${notifState[n.id]?.[type] ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-[rgba(0,0,0,0.06)]">
            {notifSaved && <span className="text-[12px] text-[#3ECF8E]">Saved to browser</span>}
            <button onClick={saveNotifPrefs} className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg transition-colors">
              <Save size={12} />Save Preferences
            </button>
          </div>
        </Section>
      )}

      {/* Company Branding */}
      {view === 'branding' && (
        <Section title="Company Branding">
          <div className="space-y-5">
            <div className="flex items-start gap-2 text-[12px] text-gray-500 bg-gray-50 border border-[rgba(0,0,0,0.07)] px-3 py-2.5 rounded-lg">
              <Info size={13} className="flex-shrink-0 mt-px text-gray-400" />
              <span>Company branding appears on reports, invoices, packing slips, and shipping documents. Platform navigation always displays the deryv logo.</span>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Company Logo</label>
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 rounded-xl bg-gray-50 flex items-center justify-center border border-[rgba(0,0,0,0.08)] flex-shrink-0 overflow-hidden">
                  {brandingForm.logo_url ? (
                    <img src={brandingForm.logo_url} alt="Company logo" className="w-full h-full object-contain p-2" />
                  ) : (
                    <span className="text-[11px] text-gray-400 text-center px-2">No logo</span>
                  )}
                </div>
                <div className="space-y-2">
                  <input ref={logoFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoUpload} disabled={currentRole !== 'admin'} />
                  <button onClick={() => logoFileRef.current?.click()} disabled={uploadingLogo || currentRole !== 'admin'}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-gray-700 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 disabled:opacity-60 disabled:cursor-default transition-colors">
                    {uploadingLogo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                  </button>
                  {logoUploadError && <p className="text-[11px] text-red-500">{logoUploadError}</p>}
                  <p className="text-[11px] text-gray-400">PNG, JPG, WebP, or SVG. Uploaded to secure storage.</p>
                </div>
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Company Name</label>
              <input value={brandingForm.name} onChange={e => setBrandingForm(f => ({ ...f, name: e.target.value }))} disabled={currentRole !== 'admin'}
                className="w-full max-w-sm px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default" placeholder="Acme Corp" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Primary Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={brandingForm.primary_color || '#3ECF8E'} onChange={e => setBrandingForm(f => ({ ...f, primary_color: e.target.value }))} disabled={currentRole !== 'admin'}
                  className="w-9 h-9 rounded-lg border border-[rgba(0,0,0,0.1)] cursor-pointer disabled:cursor-default p-0.5 bg-white" />
                <input value={brandingForm.primary_color} onChange={e => setBrandingForm(f => ({ ...f, primary_color: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="#3ECF8E"
                  className="w-32 px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] font-mono bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default" />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">Used on printed documents and generated reports.</p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Support Email</label>
              <input type="email" value={brandingForm.support_email} onChange={e => setBrandingForm(f => ({ ...f, support_email: e.target.value }))} disabled={currentRole !== 'admin'}
                className="w-full max-w-sm px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default" placeholder="support@company.com" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Website</label>
              <input type="url" value={brandingForm.website} onChange={e => setBrandingForm(f => ({ ...f, website: e.target.value }))} disabled={currentRole !== 'admin'}
                className="w-full max-w-sm px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default" placeholder="https://www.company.com" />
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-[rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-3">
                {currentRole !== 'admin' && <p className="text-[12px] text-gray-400">Admin access required to change branding.</p>}
                {brandingSaved && <span className="text-[12px] text-[#3ECF8E]">Saved</span>}
              </div>
              <button onClick={saveBranding} disabled={savingBranding || currentRole !== 'admin'}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
                {savingBranding ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save Changes
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* Inventory ID Settings */}
      {view === 'inventory' && (
        <Section title="Inventory ID Format">
          <div className="space-y-5">
            <div className="flex items-start gap-2 text-[12px] text-gray-500 bg-gray-50 border border-[rgba(0,0,0,0.07)] px-3 py-2.5 rounded-lg">
              <Info size={13} className="flex-shrink-0 mt-px text-gray-400" />
              <span>Inventory IDs are auto-generated when new items are added. The format is <span className="font-mono font-medium text-gray-700">PREFIX-YY-000001</span>. Changes only affect new items — existing IDs are not altered.</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">ID Prefix</label>
                <input
                  value={invForm.inventory_prefix}
                  onChange={e => setInvForm(f => ({ ...f, inventory_prefix: e.target.value.toUpperCase() }))}
                  disabled={currentRole !== 'admin'}
                  maxLength={10}
                  placeholder="INV"
                  className="w-full px-3 py-2 text-[13px] font-mono border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default uppercase"
                />
                <p className="text-[11px] text-gray-400 mt-1">Letters and numbers only, max 10 characters.</p>
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Starting Number</label>
                <input
                  type="number"
                  value={invForm.inventory_seq_start}
                  onChange={e => setInvForm(f => ({ ...f, inventory_seq_start: e.target.value }))}
                  disabled={currentRole !== 'admin'}
                  min={1}
                  placeholder="1"
                  className="w-full px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default"
                />
                <p className="text-[11px] text-gray-400 mt-1">Next item will start from this number.</p>
              </div>
            </div>

            {/* Live preview */}
            <div className="bg-gray-50 border border-[rgba(0,0,0,0.07)] rounded-xl px-4 py-3">
              <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">Preview</p>
              <div className="flex items-center gap-2">
                <Hash size={13} className="text-gray-400" />
                <span className="font-mono text-[14px] font-semibold text-gray-900">{previewId}</span>
                <span className="text-[11px] text-gray-400 ml-1">← next item will get this ID</span>
              </div>
            </div>

            {invError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{invError}</p>}

            <div className="flex items-center justify-between pt-4 border-t border-[rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-3">
                {currentRole !== 'admin' && <p className="text-[12px] text-gray-400">Admin access required.</p>}
                {invSaved && <span className="text-[12px] text-[#3ECF8E]">Saved</span>}
              </div>
              <button onClick={saveInventorySettings} disabled={savingInv || currentRole !== 'admin'}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
                {savingInv ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save Changes
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* Warehouse Address */}
      {view === 'warehouse' && (
        <Section title="Warehouse Address">
          <div className="space-y-5">
            <div className="flex items-start gap-2 text-[12px] text-gray-500 bg-gray-50 border border-[rgba(0,0,0,0.07)] px-3 py-2.5 rounded-lg">
              <Info size={13} className="flex-shrink-0 mt-px text-gray-400" />
              <span>This address is used as the ship-from address for all ShipStation rate quotes and label creation. The ZIP code is required for rate calculations.</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="Warehouse / Location Name">
                <input className={inputCls} value={warehouseForm.warehouse_name} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_name: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="Main Warehouse" />
              </FormField>
              <FormField label="Phone">
                <input className={inputCls} value={warehouseForm.warehouse_phone} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_phone: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="555-0100" />
              </FormField>
            </div>
            <FormField label="Street Address">
              <input className={inputCls} value={warehouseForm.warehouse_street1} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_street1: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="123 Warehouse Blvd" />
            </FormField>
            <div className="grid grid-cols-3 gap-4">
              <FormField label="City">
                <input className={inputCls} value={warehouseForm.warehouse_city} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_city: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="Atlanta" />
              </FormField>
              <FormField label="State">
                <input className={inputCls} value={warehouseForm.warehouse_state} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_state: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="GA" maxLength={2} />
              </FormField>
              <FormField label="ZIP *">
                <input className={inputCls} value={warehouseForm.warehouse_zip} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_zip: e.target.value }))} disabled={currentRole !== 'admin'} placeholder="30301" />
              </FormField>
            </div>
            <FormField label="Country">
              <select className={selectCls} value={warehouseForm.warehouse_country} onChange={e => setWarehouseForm(f => ({ ...f, warehouse_country: e.target.value }))} disabled={currentRole !== 'admin'}>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="GB">United Kingdom</option>
                <option value="AU">Australia</option>
                <option value="MX">Mexico</option>
              </select>
            </FormField>
            {warehouseError && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{warehouseError}</p>}
            <div className="flex items-center justify-between pt-4 border-t border-[rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-3">
                {currentRole !== 'admin' && <p className="text-[12px] text-gray-400">Admin access required.</p>}
                {warehouseSaved && <span className="text-[12px] text-[#3ECF8E]">Saved</span>}
              </div>
              <button onClick={saveWarehouseSettings} disabled={savingWarehouse || currentRole !== 'admin'}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60">
                {savingWarehouse ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save Changes
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* Account */}
      {view === 'product-presets' && (
        <Section title="Product Presets">
          <ProductPresetsView orgId={orgId} userId={user?.id} role={currentRole} />
        </Section>
      )}

      {view === 'pricing-presets' && (
        <Section title="Pricing Presets">
          <PricingPresetsView orgId={orgId} role={currentRole} />
        </Section>
      )}

      {(view === 'account' || view === 'overview') && (
        <Section title="Account">
          <div className="space-y-3">
            <div className="flex items-center justify-between py-2.5 border-b border-[rgba(0,0,0,0.04)]">
              <div>
                <p className="text-[13px] font-medium text-gray-900">{user?.email}</p>
                <p className="text-[11px] text-gray-400 mt-0.5 capitalize">Role: {currentRole}</p>
              </div>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#15803d]">Active</span>
            </div>
            <button onClick={handleSignOut} className="w-full mt-2 py-2 border border-red-100 text-[13px] text-red-500 rounded-lg hover:bg-red-50 transition-colors font-medium">
              Sign Out
            </button>
          </div>
        </Section>
      )}

      <InviteMemberModal open={showInvite} onClose={() => setShowInvite(false)} orgId={orgId} userId={user?.id} onCreated={() => { reloadMembers(); refreshMemberships(); }} />
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-6">
      <div className="flex items-center justify-between mb-5 pb-4 border-b border-[rgba(0,0,0,0.06)]">
        <h3 className="text-[14px] font-semibold text-gray-900">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}
