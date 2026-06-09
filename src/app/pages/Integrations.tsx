import { useState } from 'react';
import { RefreshCw, Settings, ExternalLink, AlertCircle, Loader2, X, CheckCircle, Clock, AlertTriangle, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery, logActivity } from '../../lib/hooks';
import { useSecondaryView } from '../components/SecondarySidebar';
import { ErrorState } from '../components/DataStates';
import { supabase } from '../../lib/supabase';

const KNOWN_INTEGRATIONS = [
  { id: 'shopify', name: 'Shopify', category: 'Marketplace', description: 'Sync inventory and orders with your Shopify storefront.', initials: 'SH', type: 'oauth' as const },
  { id: 'ebay', name: 'eBay', category: 'Marketplace', description: 'List, manage and sync eBay listings automatically.', initials: 'eB', type: 'oauth' as const },
  { id: 'shipstation', name: 'ShipStation', category: 'Shipping', description: 'Multi-carrier shipping and label management.', initials: 'SS', type: 'credentials' as const },
  { id: 'quickbooks', name: 'QuickBooks', category: 'Accounting', description: 'Sync revenue, COGS, and expenses to QuickBooks Online.', initials: 'QB', type: 'oauth' as const },
];

const categoryMap: Record<string, string> = {
  marketplace: 'Marketplace',
  shipping: 'Shipping',
  accounting: 'Accounting',
};

export function Integrations() {
  const view = useSecondaryView();
  const { orgId, user } = useAuth();
  const [working, setWorking] = useState<string | null>(null);
  const [setupDrawer, setSetupDrawer] = useState<{ provider: string; name: string; type: string } | null>(null);
  const [eventsDrawer, setEventsDrawer] = useState<string | null>(null);
  const [mappingDrawer, setMappingDrawer] = useState<boolean>(false);
  const [events, setEvents] = useState<any[]>([]);

  const { data: connections, loading, error, reload } = useOrgQuery(
    'integration_connections', orgId, {
      select: 'id, provider, status, health, last_sync_at, config, created_at',
    });

  const getConnection = (id: string) => connections.find((c: any) => c.provider === id);

  const startOAuth = async (integration: typeof KNOWN_INTEGRATIONS[0], shopDomain?: string) => {
    setWorking(integration.id);

    if (!orgId) {
      alert('Organization is still loading. Try again.');
      setWorking(null);
      return;
    }

    if (!user?.id) console.warn('Starting OAuth without user_id');

    let payload: any = { return_path: '/integrations' };

    if (integration.id === 'shopify') {
      if (!shopDomain) {
        setSetupDrawer({ provider: integration.id, name: integration.name, type: 'oauth_input' });
        setWorking(null);
        return;
      }
      payload.shop = shopDomain;
    }

    try {
      const { data, error } = await supabase.functions.invoke('integration-start', {
        body: { organization_id: orgId, user_id: user?.id, provider: integration.id, payload },
      });

      if (error) { alert(`Failed to start OAuth: ${error.message || 'Unknown error'}`); setWorking(null); return; }
      if (data?.error) { alert(`Failed to start OAuth: ${data.error}`); setWorking(null); return; }
      if (data?.oauth_url) {
        await logActivity(orgId!, user?.id!, `Started ${integration.name} OAuth`, 'integration_connections');
        window.location.href = data.oauth_url;
        return;
      }

      alert('OAuth URL was not returned by integration-start.');
      setWorking(null);
    } catch (err: any) {
      alert(`Failed to start OAuth: ${err.message || 'Unknown error'}`);
      setWorking(null);
    }
  };

  const testConnection = async (integration: typeof KNOWN_INTEGRATIONS[0]) => {
    setWorking(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke('integration-test', {
        body: { organization_id: orgId, provider: integration.id, user_id: user?.id },
      });
      if (error) throw error;
      await logActivity(orgId!, user?.id!, `Tested ${integration.name} connection`, 'integration_connections');
      reload();
    } catch (err: any) {
      alert(`Connection test failed: ${err.message}`);
    } finally {
      setWorking(null);
    }
  };

  const syncNow = async (integration: typeof KNOWN_INTEGRATIONS[0]) => {
    setWorking(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke('integration-sync', {
        body: { organization_id: orgId, provider: integration.id, user_id: user?.id },
      });
      if (error) throw error;
      await logActivity(orgId!, user?.id!, `Synced ${integration.name}`, 'integration_connections');
      reload();
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setWorking(null);
    }
  };

  const disconnect = async (integration: typeof KNOWN_INTEGRATIONS[0]) => {
    if (!confirm(`Disconnect ${integration.name}? You'll need to re-authenticate to reconnect.`)) return;
    setWorking(integration.id);
    try {
      const { data, error } = await supabase.functions.invoke('integration-disconnect', {
        body: { organization_id: orgId, provider: integration.id, user_id: user?.id },
      });
      if (error) throw error;
      await logActivity(orgId!, user?.id!, `Disconnected ${integration.name}`, 'integration_connections');
      reload();
    } catch (err: any) {
      alert(`Disconnect failed: ${err.message}`);
    } finally {
      setWorking(null);
    }
  };

  const loadEvents = async (provider: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('integration-events', {
        body: { organization_id: orgId, provider, user_id: user?.id, limit: 50 },
      });
      if (error) throw error;
      setEvents(data.events ?? []);
      setEventsDrawer(provider);
    } catch (err: any) {
      alert(`Failed to load events: ${err.message}`);
    }
  };

  const visible = view === 'all' || view === 'overview'
    ? KNOWN_INTEGRATIONS
    : KNOWN_INTEGRATIONS.filter(i => i.category.toLowerCase() === categoryMap[view]?.toLowerCase());

  const connectedCount = KNOWN_INTEGRATIONS.filter(i => getConnection(i.id)?.status === 'CONNECTED').length;

  const grouped: Record<string, typeof KNOWN_INTEGRATIONS> = {};
  for (const item of visible) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  return (
    <div className="p-6 max-w-[1200px] space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-gray-900">Integrations</h2>
          {loading
            ? <p className="text-[13px] text-gray-400 mt-0.5">Loading...</p>
            : <p className="text-[13px] text-gray-400 mt-0.5">{connectedCount} of {KNOWN_INTEGRATIONS.length} connected</p>
          }
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={reload} />}

      {Object.entries(grouped).map(([category, items]) => (
        <div key={category}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">{category}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {items.map(integration => {
              const conn = getConnection(integration.id);
              let status = conn?.status ?? 'NOT_CONFIGURED';
              let statusLabel = 'Not Configured';
              let statusColor = 'bg-gray-100 text-gray-500';

              switch (status) {
                case 'CONNECTED':
                  if (conn?.health === 'DEGRADED') { statusLabel = 'Error'; statusColor = 'bg-amber-100 text-amber-700'; }
                  else { statusLabel = 'Connected'; statusColor = 'bg-[#ECFDF5] text-[#15803d]'; }
                  break;
                case 'OAUTH_REQUIRED': statusLabel = 'OAuth Required'; statusColor = 'bg-amber-50 text-amber-600'; break;
                case 'CREDENTIALS_NEEDED': statusLabel = 'Credentials Needed'; statusColor = 'bg-amber-50 text-amber-600'; break;
                case 'DISCONNECTED': statusLabel = 'Disconnected'; statusColor = 'bg-gray-100 text-gray-500'; break;
                case 'RECONNECT_REQUIRED': statusLabel = 'Reconnect Required'; statusColor = 'bg-red-50 text-red-600'; break;
                case 'ERROR': statusLabel = 'Error'; statusColor = 'bg-red-100 text-red-700'; break;
              }

              const isConnected = status === 'CONNECTED';
              const isDegraded = conn?.health === 'DEGRADED';
              const isWorking = working === integration.id;
              const isQB = integration.id === 'quickbooks';

              return (
                <div key={integration.id}
                  className={`bg-white rounded-xl border p-5 hover:shadow-sm transition-all ${isConnected ? 'border-[rgba(0,0,0,0.08)]' : 'border-[rgba(0,0,0,0.06)]'}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gray-900 flex items-center justify-center text-white font-semibold text-[12px] flex-shrink-0">
                        {integration.initials}
                      </div>
                      <div>
                        <p className="text-[13px] font-semibold text-gray-900">{integration.name}</p>
                        <p className="text-[11px] text-gray-400">{integration.category}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isDegraded && <AlertCircle size={11} className="text-amber-500" />}
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${statusColor}`}>{statusLabel}</span>
                    </div>
                  </div>

                  <p className="text-[12px] text-gray-500 mb-2 leading-relaxed">{integration.description}</p>

                  {isConnected && conn?.last_sync_at && (
                    <p className="text-[11px] text-gray-400 mb-3 flex items-center gap-1">
                      <RefreshCw size={10} />
                      {new Date(conn.last_sync_at).toLocaleString()}
                      {isDegraded && <span className="text-amber-600 ml-1">· Degraded</span>}
                    </p>
                  )}

                  <div className="flex gap-2">
                    {isConnected ? (
                      <>
                        {isQB && (
                          <button
                            onClick={() => setMappingDrawer(true)}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-[rgba(0,0,0,0.1)] rounded-lg text-[12px] text-gray-700 hover:bg-gray-50"
                          >
                            <Settings size={11} />Map Data
                          </button>
                        )}
                        {!isQB && (
                          <button
                            onClick={() => loadEvents(integration.id)}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-[rgba(0,0,0,0.1)] rounded-lg text-[12px] text-gray-700 hover:bg-gray-50"
                          >
                            <Clock size={11} />Events
                          </button>
                        )}
                        {isQB && (
                          <button
                            onClick={() => loadEvents(integration.id)}
                            className="px-2.5 py-1.5 border border-[rgba(0,0,0,0.1)] rounded-lg text-[12px] text-gray-700 hover:bg-gray-50"
                          >
                            <Clock size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => syncNow(integration)}
                          disabled={isWorking}
                          className="px-2.5 py-1.5 border border-[rgba(0,0,0,0.1)] rounded-lg text-gray-400 hover:bg-gray-50 disabled:opacity-60"
                        >
                          {isWorking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                        </button>
                        <button
                          onClick={() => disconnect(integration)}
                          disabled={isWorking}
                          className="px-2.5 py-1.5 border border-red-100 rounded-lg text-[11px] text-red-400 hover:bg-red-50 disabled:opacity-60"
                        >
                          Disconnect
                        </button>
                      </>
                    ) : (
                      <>
                        {integration.type === 'oauth' && (
                          <button
                            onClick={() => startOAuth(integration)}
                            disabled={isWorking}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] rounded-lg text-[12px] text-white font-medium disabled:opacity-60"
                          >
                            {isWorking ? <Loader2 size={11} className="animate-spin" /> : <ExternalLink size={11} />}
                            {isWorking ? 'Connecting...' : 'Connect'}
                          </button>
                        )}
                        {integration.type === 'credentials' && (
                          <button
                            onClick={() => setSetupDrawer({ provider: integration.id, name: integration.name, type: 'credentials' })}
                            className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] rounded-lg text-[12px] text-white font-medium"
                          >
                            <Settings size={11} />Configure
                          </button>
                        )}
                        {conn && (
                          <button
                            onClick={() => testConnection(integration)}
                            disabled={isWorking}
                            className="px-2.5 py-1.5 border border-[rgba(0,0,0,0.1)] rounded-lg text-gray-400 hover:bg-gray-50 disabled:opacity-60"
                          >
                            {isWorking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {setupDrawer && (
        <SetupDrawer
          provider={setupDrawer.provider}
          name={setupDrawer.name}
          type={setupDrawer.type}
          orgId={orgId!}
          userId={user?.id!}
          onClose={() => setSetupDrawer(null)}
          onSuccess={() => { setSetupDrawer(null); reload(); }}
          onOAuthContinue={(shopDomain: string) => {
            setSetupDrawer(null);
            const integration = KNOWN_INTEGRATIONS.find(i => i.id === setupDrawer.provider);
            if (integration) startOAuth(integration, shopDomain);
          }}
        />
      )}

      {eventsDrawer && (
        <EventsDrawer
          provider={eventsDrawer}
          name={KNOWN_INTEGRATIONS.find(i => i.id === eventsDrawer)?.name ?? ''}
          events={events}
          onClose={() => setEventsDrawer(null)}
        />
      )}

      {mappingDrawer && (
        <QBMappingDrawer
          orgId={orgId!}
          userId={user?.id!}
          onClose={() => setMappingDrawer(false)}
          onSuccess={() => { setMappingDrawer(false); reload(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// QB Mapping Drawer
// ---------------------------------------------------------------------------

const QB_MAPPING_FIELDS = [
  { key: 'sales_income_account', label: 'Sales income', description: 'Revenue from LOT sales and orders', section: 'Income & revenue' },
  { key: 'shipping_income_account', label: 'Shipping income', description: 'Shipping fees charged to customers', section: 'Income & revenue' },
  { key: 'cogs_account', label: 'Cost of goods sold (COGS)', description: 'Inventory cost at time of sale', section: 'Cost of goods' },
  { key: 'inventory_asset_account', label: 'Inventory asset', description: 'Balance sheet account for inventory on hand', section: 'Cost of goods' },
  { key: 'shipping_expense_account', label: 'Shipping expense', description: 'Outbound shipping costs paid by deryv', section: 'Cost of goods' },
];

const QB_SYNC_FIELDS = [
  {
    key: 'sync_frequency',
    label: 'Sync frequency',
    description: 'How often deryv pushes data to QuickBooks',
    options: [
      { value: 'daily', label: 'Daily' },
      { value: 'weekly', label: 'Weekly' },
      { value: 'on_sale', label: 'On sale' },
    ],
  },
  {
    key: 'transaction_type',
    label: 'Transaction type',
    description: 'How sales are recorded in QuickBooks',
    options: [
      { value: 'sales_receipt', label: 'Sales receipt' },
      { value: 'invoice', label: 'Invoice' },
      { value: 'journal_entry', label: 'Journal entry' },
    ],
  },
];

// Account types we want to surface per mapping field
const RELEVANT_ACCOUNT_TYPES: Record<string, string[]> = {
  sales_income_account: ['Income'],
  shipping_income_account: ['Income'],
  cogs_account: ['Cost of Goods Sold', 'Expense'],
  inventory_asset_account: ['Other Current Asset', 'Other Asset'],
  shipping_expense_account: ['Expense', 'Cost of Goods Sold'],
};

function QBMappingDrawer({ orgId, userId, onClose, onSuccess }: {
  orgId: string;
  userId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [accounts, setAccounts] = useState<Record<string, { id: string; name: string; subtype: string }[]>>({});
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  // Load existing mapping + QB accounts on mount
  useState(() => {
    (async () => {
      try {
        // Load existing saved mapping
        const { data: existing } = await supabase
          .from('integration_qb_mappings')
          .select('*')
          .eq('organization_id', orgId)
          .maybeSingle();

        if (existing) {
          const saved: Record<string, string> = {};
          for (const field of [...QB_MAPPING_FIELDS, ...QB_SYNC_FIELDS]) {
            if (existing[field.key]) saved[field.key] = existing[field.key];
          }
          setMapping(saved);
          setLastSaved(existing.updated_at ? new Date(existing.updated_at).toLocaleString() : null);
        }

        // Fetch live QB chart of accounts
        const { data, error } = await supabase.functions.invoke('integration-qb-accounts', {
          body: { organization_id: orgId },
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        setAccounts(data.accounts ?? {});
      } catch (err: any) {
        setAccountsError(err.message ?? 'Failed to load QuickBooks accounts.');
      } finally {
        setLoadingAccounts(false);
      }
    })();
  });

  const getOptionsForField = (fieldKey: string) => {
    const relevantTypes = RELEVANT_ACCOUNT_TYPES[fieldKey] ?? [];
    const options: { value: string; label: string }[] = [];
    for (const type of relevantTypes) {
      const accts = accounts[type] ?? [];
      for (const acct of accts) {
        options.push({ value: acct.id, label: acct.name });
      }
    }
    return options;
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('integration_qb_mappings')
        .upsert(
          { organization_id: orgId, ...mapping, updated_at: new Date().toISOString() },
          { onConflict: 'organization_id' }
        );
      if (error) throw error;
      await logActivity(orgId, userId, 'Updated QuickBooks data mapping', 'integration_qb_mappings');
      onSuccess();
    } catch (err: any) {
      alert(`Failed to save mapping: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // Group mapping fields by section
  const sections = QB_MAPPING_FIELDS.reduce<Record<string, typeof QB_MAPPING_FIELDS>>((acc, f) => {
    if (!acc[f.section]) acc[f.section] = [];
    acc[f.section].push(f);
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(0,0,0,0.06)]">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">QuickBooks — Map Data</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">Match deryv data to your chart of accounts</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

          {loadingAccounts && (
            <div className="flex items-center gap-2 text-[13px] text-gray-400 py-4">
              <Loader2 size={14} className="animate-spin" />
              Loading your QuickBooks accounts...
            </div>
          )}

          {accountsError && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-[12px] text-red-600">
              {accountsError} — <button className="underline" onClick={onClose}>Close and reconnect</button> if your token has expired.
            </div>
          )}

          {/* Account mapping sections */}
          {!loadingAccounts && !accountsError && Object.entries(sections).map(([section, fields]) => (
            <div key={section}>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">{section}</p>
              <div className="space-y-3">
                {fields.map(field => {
                  const options = getOptionsForField(field.key);
                  return (
                    <div key={field.key}>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <p className="text-[13px] font-medium text-gray-900">{field.label}</p>
                          <p className="text-[11px] text-gray-400">{field.description}</p>
                        </div>
                      </div>
                      <select
                        value={mapping[field.key] ?? ''}
                        onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                        className="w-full px-3 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] bg-white"
                      >
                        <option value="">— Select account —</option>
                        {options.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                        {options.length === 0 && (
                          <option disabled>No matching accounts found</option>
                        )}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Sync settings */}
          {!loadingAccounts && !accountsError && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Sync settings</p>
              <div className="space-y-3">
                {QB_SYNC_FIELDS.map(field => (
                  <div key={field.key}>
                    <p className="text-[13px] font-medium text-gray-900 mb-0.5">{field.label}</p>
                    <p className="text-[11px] text-gray-400 mb-1">{field.description}</p>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={e => setMapping(prev => ({ ...prev, [field.key]: e.target.value }))}
                      className="w-full px-3 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] bg-white"
                    >
                      <option value="">— Select —</option>
                      {field.options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="p-3 bg-gray-50 rounded-lg text-[11px] text-gray-500 leading-relaxed">
            Account names are pulled live from your QuickBooks chart of accounts. Changes here affect future syncs only — existing QuickBooks entries are not modified.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[rgba(0,0,0,0.06)]">
          <p className="text-[11px] text-gray-400">
            {lastSaved ? `Last saved: ${lastSaved}` : 'Not yet saved'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loadingAccounts}
              className="px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] rounded-lg text-[13px] text-white font-medium disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save mapping'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup Drawer (credentials / OAuth input)
// ---------------------------------------------------------------------------

function SetupDrawer({ provider, name, type, orgId, userId, onClose, onSuccess, onOAuthContinue }: any) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke('integration-configure', {
        body: { organization_id: orgId, provider, user_id: userId, credentials },
      });
      if (error) throw error;
      await logActivity(orgId, userId, `Configured ${name}`, 'integration_connections');
      onSuccess();
    } catch (err: any) {
      alert(`Configuration failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleOAuthContinue = () => {
    if (type === 'oauth_input' && provider === 'shopify') {
      const shopDomain = credentials.shop_domain;
      if (!shopDomain) { alert('Please enter your Shopify store domain'); return; }
      onOAuthContinue?.(shopDomain);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(0,0,0,0.06)]">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">Configure {name}</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">Enter your credentials to connect</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {type === 'oauth_input' && provider === 'shopify' && (
            <div>
              <label className="text-[12px] font-medium text-gray-700 mb-1.5 block">Shopify Store Domain</label>
              <input
                type="text"
                value={credentials.shop_domain ?? ''}
                onChange={e => setCredentials({ ...credentials, shop_domain: e.target.value })}
                className="w-full px-3 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px]"
                placeholder="your-store.myshopify.com"
              />
              <p className="text-[11px] text-gray-500 mt-1">Enter your Shopify store domain</p>
            </div>
          )}
          {type === 'credentials' && provider === 'shipstation' && (
            <>
              <div>
                <label className="text-[12px] font-medium text-gray-700 mb-1.5 block">API Key</label>
                <input type="password" value={credentials.api_key ?? ''} onChange={e => setCredentials({ ...credentials, api_key: e.target.value })} className="w-full px-3 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px]" placeholder="Your ShipStation API key" />
              </div>
              <div>
                <label className="text-[12px] font-medium text-gray-700 mb-1.5 block">API Secret</label>
                <input type="password" value={credentials.api_secret ?? ''} onChange={e => setCredentials({ ...credentials, api_secret: e.target.value })} className="w-full px-3 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px]" placeholder="Your ShipStation API secret" />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-6 py-4 border-t border-[rgba(0,0,0,0.06)]">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] text-gray-700 hover:bg-gray-50">Cancel</button>
          <button
            onClick={type === 'oauth_input' ? handleOAuthContinue : handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-[#3ECF8E] hover:bg-[#38c484] rounded-lg text-[13px] text-white font-medium disabled:opacity-60"
          >
            {saving ? 'Saving...' : (type === 'oauth_input' ? 'Continue' : 'Save & Connect')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events Drawer
// ---------------------------------------------------------------------------

function EventsDrawer({ provider, name, events, onClose }: any) {
  const getEventIcon = (type: string, status: string) => {
    if (status === 'success' || status === 'COMPLETED') return <CheckCircle size={14} className="text-green-600" />;
    if (status === 'error' || status === 'FAILED') return <AlertTriangle size={14} className="text-red-600" />;
    return <Clock size={14} className="text-gray-400" />;
  };

  return (
    <div className="fixed inset-0 bg-black/20 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(0,0,0,0.06)]">
          <div>
            <h3 className="text-[15px] font-semibold text-gray-900">{name} Events</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">{events.length} recent events</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {events.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Clock size={20} className="text-gray-200 mx-auto mb-2" />
              <p className="text-[13px] text-gray-400">No events yet</p>
            </div>
          ) : (
            <div className="divide-y divide-[rgba(0,0,0,0.04)]">
              {events.map((event: any, idx: number) => (
                <div key={event.id ?? idx} className="px-6 py-3 hover:bg-gray-50">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">{getEventIcon(event.event_type, event.status)}</div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-gray-900">{event.event_type.replace(/_/g, ' ')}</p>
                      {event.error_message && <p className="text-[12px] text-red-600 mt-0.5">{event.error_message}</p>}
                      <p className="text-[11px] text-gray-400 mt-1">{new Date(event.created_at).toLocaleString()}</p>
                    </div>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                      event.status === 'success' || event.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {event.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[rgba(0,0,0,0.06)]">
          <button onClick={onClose} className="w-full px-4 py-2 border border-[rgba(0,0,0,0.1)] rounded-lg text-[13px] text-gray-700 hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  );
}