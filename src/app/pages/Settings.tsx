import { useState, useRef } from 'react';
import { Plus, Trash2, Eye, EyeOff, Loader2, Save, Upload, Info } from 'lucide-react';
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
      <div className="space-y-4">
        {error && <p className="text-[12px] text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
        <FormField label="Full Name" required><input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Jane Smith" /></FormField>
        <FormField label="Email Address" required><input type="email" className={inputCls} value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@company.com" /></FormField>
        <FormField label="Temporary Password" required><input type="password" className={inputCls} value={form.password} onChange={e => set('password', e.target.value)} placeholder="Min 8 characters" /></FormField>
        <FormField label="Role"><select className={selectCls} value={form.role} onChange={e => set('role', e.target.value)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select></FormField>
      </div>
    </Modal>
  );
}

export function Settings() {
  const view = useSecondaryView();
  const { orgId, user, currentOrg, currentRole, refreshMemberships, signOut } = useAuth();
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [showInvite, setShowInvite] = useState(false);
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

  const { data: members, loading: membersLoading, error: membersError, reload: reloadMembers } = useOrgQuery<any>(
    'organization_members', orgId, {
      select: 'id, user_id, role, created_at',
    }
  );

  const { data: apiKeys, loading: keysLoading, reload: reloadKeys } = useOrgQuery<any>(
    'integration_connections', orgId, {
      select: 'id, provider, status, created_at, last_sync_at',
      filter: (q: any) => q.eq('status', 'CONNECTED'),
    }
  );

  const saveOrgSettings = async () => {
    if (!orgId || !orgForm.name) return;
    setSavingOrg(true);
    setOrgSaved(false);

    const { error } = await supabase
      .from('organizations')
      .update({
        name: orgForm.name,
        slug: orgForm.slug,
        website: orgForm.website || null,
        logo_url: orgForm.logo_url || null,
        industry: orgForm.industry || null,
      })
      .eq('id', orgId);

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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !orgId) return;
    setUploadingLogo(true);
    setLogoUploadError(null);
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

  const handleSignOut = async () => {
    await signOut();
  };

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
                  {['Member', 'Role', ''].map(h => (
                    <th key={h} className="text-left py-2.5 text-[11px] font-medium text-gray-400 uppercase tracking-wide pr-4">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr><td colSpan={3} className="py-8 text-center text-[13px] text-gray-400">No team members yet.</td></tr>
                ) : members.map((m: any, i: number) => {
                  const isCurrentUser = m.user_id === user?.id;
                  const initials = m.user_id?.slice(0, 2).toUpperCase() ?? 'U?';
                  return (
                    <tr key={m.id} className={`hover:bg-gray-50/60 ${i < members.length-1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}>
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
            {/* Platform branding notice */}
            <div className="flex items-start gap-2 text-[12px] text-gray-500 bg-gray-50 border border-[rgba(0,0,0,0.07)] px-3 py-2.5 rounded-lg">
              <Info size={13} className="flex-shrink-0 mt-px text-gray-400" />
              <span>Company branding appears on reports, invoices, packing slips, and shipping documents. Platform navigation always displays the deryv logo.</span>
            </div>

            {/* Company Logo */}
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
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={handleLogoUpload}
                    disabled={currentRole !== 'admin'}
                  />
                  <button
                    onClick={() => logoFileRef.current?.click()}
                    disabled={uploadingLogo || currentRole !== 'admin'}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-gray-700 border border-[rgba(0,0,0,0.1)] rounded-lg hover:bg-gray-50 disabled:opacity-60 disabled:cursor-default transition-colors"
                  >
                    {uploadingLogo ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploadingLogo ? 'Uploading...' : 'Upload Logo'}
                  </button>
                  {logoUploadError && (
                    <p className="text-[11px] text-red-500">{logoUploadError}</p>
                  )}
                  <p className="text-[11px] text-gray-400">PNG, JPG, WebP, or SVG. Uploaded to secure storage.</p>
                </div>
              </div>
            </div>

            {/* Company Name */}
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Company Name</label>
              <input
                value={brandingForm.name}
                onChange={e => setBrandingForm(f => ({ ...f, name: e.target.value }))}
                disabled={currentRole !== 'admin'}
                className="w-full max-w-sm px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default"
                placeholder="Acme Corp"
              />
            </div>

            {/* Primary Color */}
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Primary Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={brandingForm.primary_color || '#3ECF8E'}
                  onChange={e => setBrandingForm(f => ({ ...f, primary_color: e.target.value }))}
                  disabled={currentRole !== 'admin'}
                  className="w-9 h-9 rounded-lg border border-[rgba(0,0,0,0.1)] cursor-pointer disabled:cursor-default p-0.5 bg-white"
                />
                <input
                  value={brandingForm.primary_color}
                  onChange={e => setBrandingForm(f => ({ ...f, primary_color: e.target.value }))}
                  disabled={currentRole !== 'admin'}
                  placeholder="#3ECF8E"
                  className="w-32 px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] font-mono bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default"
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-1.5">Used on printed documents and generated reports.</p>
            </div>

            {/* Support Email */}
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Support Email</label>
              <input
                type="email"
                value={brandingForm.support_email}
                onChange={e => setBrandingForm(f => ({ ...f, support_email: e.target.value }))}
                disabled={currentRole !== 'admin'}
                className="w-full max-w-sm px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default"
                placeholder="support@company.com"
              />
            </div>

            {/* Website */}
            <div>
              <label className="text-[11px] font-medium text-gray-500 mb-1.5 block uppercase tracking-wide">Website</label>
              <input
                type="url"
                value={brandingForm.website}
                onChange={e => setBrandingForm(f => ({ ...f, website: e.target.value }))}
                disabled={currentRole !== 'admin'}
                className="w-full max-w-sm px-3 py-2 text-[13px] border border-[rgba(0,0,0,0.1)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3ECF8E]/20 focus:border-[#3ECF8E] bg-white disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-default"
                placeholder="https://www.company.com"
              />
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-[rgba(0,0,0,0.06)]">
              <div className="flex items-center gap-3">
                {currentRole !== 'admin' && (
                  <p className="text-[12px] text-gray-400">Admin access required to change branding.</p>
                )}
                {brandingSaved && <span className="text-[12px] text-[#3ECF8E]">Saved</span>}
              </div>
              <button
                onClick={saveBranding}
                disabled={savingBranding || currentRole !== 'admin'}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[13px] font-medium rounded-lg disabled:opacity-60"
              >
                {savingBranding ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}Save Changes
              </button>
            </div>
          </div>
        </Section>
      )}

      {/* Account */}
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
            <button onClick={handleSignOut}
              className="w-full mt-2 py-2 border border-red-100 text-[13px] text-red-500 rounded-lg hover:bg-red-50 transition-colors font-medium">
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
