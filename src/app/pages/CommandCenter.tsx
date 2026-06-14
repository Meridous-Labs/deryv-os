import { useState, useEffect, useCallback, useRef } from 'react';
import { Zap, ArrowRight, Sparkles, RefreshCw, AlertCircle, Plus, Bell, Upload } from 'lucide-react';
import { useNavigate } from 'react-router';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { useSecondaryView } from '../components/SecondarySidebar';

// ─── Entity navigation map ──────────────────────────────────────────────────
const ENTITY_NAV: Record<string, (id: string) => string> = {
  lots:                      id => `/lot-intake/all?selected=${id}`,
  inventory_items:           id => `/inventory/all?selected=${id}`,
  orders:                    id => `/orders/all?selected=${id}`,
  shipments:                 id => `/shipping/all?selected=${id}`,
  returns:                   id => `/returns/all?selected=${id}`,
  marketplace_listings:      id => `/marketplace/all?selected=${id}`,
  warehouse_locations:       id => `/warehouse/locations?selected=${id}`,
  supplies:                  id => `/supplies/supply-inventory?selected=${id}`,
  components:                id => `/components/component-inventory?selected=${id}`,
  manifest_imports:          _  => `/lot-intake/all`,
  supply_invoice_imports:    id => `/supplies/invoice-imports?selected=${id}`,
  bundle_templates:          id => `/components/bundles?selected=${id}`,
  packaging_templates:       id => `/supplies/templates?selected=${id}`,
  organization_members:      _  => `/settings/users`,
  supply_usage_logs:         _  => `/supplies/transactions`,
  supply_transactions:       _  => `/supplies/transactions`,
  inventory_item_components: _  => `/components/component-inventory`,
};

// ─── Active inventory statuses (items still in the pipeline) ────────────────
const ACTIVE_INV = ['UNPROCESSED', 'TESTING', 'PHOTOGRAPHY', 'LISTING', 'ACTIVE', 'PICKED', 'PACKED'];

// ─── Queue definitions ───────────────────────────────────────────────────────
interface QueueDef {
  label: string;
  description: string;
  path: string;
  group: string;
}
const QUEUE_DEFS: QueueDef[] = [
  { label: 'LOTs Purchased',          description: 'Awaiting transit arrangement',     path: '/lot-intake/purchased',     group: 'LOT Intake'  },
  { label: 'LOTs In Transit',         description: 'En route to warehouse',            path: '/lot-intake/in-transit',    group: 'LOT Intake'  },
  { label: 'LOTs Arrived',            description: 'Ready for processing',              path: '/lot-intake/arrived',       group: 'LOT Intake'  },
  { label: 'Inventory Unprocessed',   description: 'Not yet assessed',                  path: '/inventory/unprocessed',   group: 'Inventory'   },
  { label: 'Inventory Testing',       description: 'Under functional testing',          path: '/inventory/testing',       group: 'Inventory'   },
  { label: 'Inventory Photography',   description: 'Awaiting photos',                   path: '/inventory/photography',   group: 'Inventory'   },
  { label: 'Inventory Ready to List', description: 'Graded and ready for listing',      path: '/inventory/listing',       group: 'Inventory'   },
  { label: 'Orders Open',             description: 'Received, not yet picked',          path: '/orders/open',             group: 'Orders'      },
  { label: 'Orders Picking',          description: 'Currently being picked',            path: '/orders/picking',          group: 'Orders'      },
  { label: 'Shipments Label Created', description: 'Label printed, not yet packed',     path: '/shipping/label-created',  group: 'Shipping'    },
  { label: 'Shipments Packed',        description: 'Packed, awaiting carrier pickup',   path: '/shipping/packed',         group: 'Shipping'    },
  { label: 'Returns Inspection',      description: 'Received, awaiting assessment',     path: '/returns/inspection',      group: 'Returns'     },
  { label: 'Supply Low Stock',        description: 'At or below reorder threshold',     path: '/supplies/low-stock',      group: 'Supplies'    },
  { label: 'Component Low Stock',     description: 'At or below reorder threshold',     path: '/components/low-stock',    group: 'Components'  },
  { label: 'Marketplace Sync Errors', description: 'Listings with sync failures',       path: '/marketplace/error',       group: 'Marketplace' },
];

// ─── Shared sub-components ───────────────────────────────────────────────────
function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-5 py-4 text-[12px] text-red-500">
      <AlertCircle size={13} className="flex-shrink-0" />
      <span className="flex-1">{message}</span>
      <button onClick={onRetry} className="flex items-center gap-1 text-gray-500 hover:text-gray-700 underline underline-offset-2">
        <RefreshCw size={11} />Retry
      </button>
    </div>
  );
}

function KpiCell({ label, value, loading, onClick }: {
  label: string; value: string | number; loading: boolean; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white px-4 py-4 transition-colors ${onClick ? 'cursor-pointer hover:bg-gray-50/70' : 'cursor-default'}`}
    >
      {loading ? (
        <div className="space-y-2">
          <div className="h-6 w-16 bg-gray-100 animate-pulse rounded" />
          <div className="h-3 w-24 bg-gray-100 animate-pulse rounded" />
        </div>
      ) : (
        <>
          <p className="text-[22px] font-semibold text-gray-900 leading-none tracking-tight">{value}</p>
          <p className="text-[11px] text-gray-400 mt-2 leading-tight">{label}</p>
        </>
      )}
    </div>
  );
}

// ─── Action Queues view ──────────────────────────────────────────────────────
function QueuesView({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const results = await Promise.all([
        supabase.from('lots').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'PURCHASED'),
        supabase.from('lots').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'IN_TRANSIT'),
        supabase.from('lots').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'ARRIVED'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'UNPROCESSED'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'TESTING'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'PHOTOGRAPHY'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'LISTING'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'OPEN'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'PICKING'),
        supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'LABEL_CREATED'),
        supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'PACKED'),
        supabase.from('returns').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'INSPECTION'),
        supabase.from('supplies').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['LOW_STOCK', 'REORDER', 'OUT_OF_STOCK']),
        supabase.from('components').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['LOW_STOCK', 'REORDER']),
        supabase.from('marketplace_listings').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('sync_status', 'ERROR'),
      ]);
      const hasError = results.find(r => r.error);
      if (hasError) { console.error('Queue count error:', hasError.error); setError('Failed to load queue counts.'); setLoading(false); return; }
      setCounts(results.map(r => r.count ?? 0));
    } catch (e: any) {
      console.error('Queues load error:', e);
      setError(e.message ?? 'Failed to load queues.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const groups = Array.from(new Set(QUEUE_DEFS.map(q => q.group)));

  if (error) return (
    <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
      <InlineError message={error} onRetry={load} />
    </div>
  );

  return (
    <div className="space-y-3">
      {groups.map(group => (
        <div key={group} className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[rgba(0,0,0,0.05)]">
            <h3 className="text-[12px] font-semibold text-gray-400 uppercase tracking-wide">{group}</h3>
          </div>
          <div>
            {QUEUE_DEFS.filter(q => q.group === group).map((q, qIdx, arr) => {
              const idx = QUEUE_DEFS.indexOf(q);
              const count = counts[idx] ?? 0;
              const isLast = qIdx === arr.length - 1;
              return (
                <div
                  key={q.label}
                  onClick={() => navigate(q.path)}
                  className={`flex items-center justify-between px-5 py-3 hover:bg-gray-50/60 cursor-pointer transition-colors ${!isLast ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                >
                  <div>
                    <p className="text-[13px] font-medium text-gray-900">{q.label}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{q.description}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-4">
                    {loading ? (
                      <div className="h-5 w-8 bg-gray-100 animate-pulse rounded-full" />
                    ) : (
                      <span className={`text-[12px] font-semibold px-2.5 py-0.5 rounded-full tabular-nums ${count > 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>
                        {count}
                      </span>
                    )}
                    <ArrowRight size={12} className="text-gray-300 flex-shrink-0" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── AI Insights view ────────────────────────────────────────────────────────
interface Insight {
  title: string;
  count: number;
  action: string;
  path: string;
}

function InsightsView({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [
        manifestRes, missingMsrpRes, missingTitleRes, missingLocRes,
        syncErrRes, returnsRes, supplyLowRes, compLowRes,
      ] = await Promise.all([
        supabase.from('manifest_imports').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'NEEDS_AI_PARSE'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ACTIVE_INV).is('msrp', null),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ACTIVE_INV).or('product_title.is.null,product_title.eq.'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ACTIVE_INV).is('warehouse_location_id', null),
        supabase.from('marketplace_listings').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('sync_status', 'ERROR'),
        supabase.from('returns').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'INSPECTION'),
        supabase.from('supplies').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['LOW_STOCK', 'REORDER', 'OUT_OF_STOCK']),
        supabase.from('components').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['LOW_STOCK', 'REORDER']),
      ]);

      const errs = [manifestRes, missingMsrpRes, missingTitleRes, missingLocRes, syncErrRes, returnsRes, supplyLowRes, compLowRes].find(r => r.error);
      if (errs) { console.error('Insights load error:', errs.error); setError('Failed to load insights.'); setLoading(false); return; }

      const raw: Insight[] = [
        { title: 'Manifests pending AI parse', count: manifestRes.count ?? 0, action: 'Upload or review manifest imports', path: '/lot-intake/all' },
        { title: 'Inventory missing MSRP', count: missingMsrpRes.count ?? 0, action: 'Add MSRP to enable recovery tracking', path: '/inventory/all' },
        { title: 'Inventory missing product title', count: missingTitleRes.count ?? 0, action: 'Add titles before listing', path: '/inventory/all' },
        { title: 'Inventory missing warehouse location', count: missingLocRes.count ?? 0, action: 'Assign locations to enable fulfillment', path: '/inventory/all' },
        { title: 'Marketplace sync errors', count: syncErrRes.count ?? 0, action: 'Resolve sync failures to keep listings live', path: '/marketplace/error' },
        { title: 'Returns awaiting inspection', count: returnsRes.count ?? 0, action: 'Inspect and process returns', path: '/returns/inspection' },
        { title: 'Supplies below reorder point', count: supplyLowRes.count ?? 0, action: 'Reorder to avoid stockout', path: '/supplies/low-stock' },
        { title: 'Components below reorder point', count: compLowRes.count ?? 0, action: 'Reorder to prevent production delays', path: '/components/low-stock' },
      ].filter(i => i.count > 0);

      setInsights(raw);
    } catch (e: any) {
      console.error('Insights load error:', e);
      setError(e.message ?? 'Failed to load insights.');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={13} className="text-[#3ECF8E]" />
          <h3 className="text-[13px] font-semibold text-gray-900">AI Insights</h3>
        </div>
        <span className="flex items-center gap-1 text-[11px] text-gray-400">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3ECF8E] inline-block animate-pulse" />Live
        </span>
      </div>

      {error ? (
        <InlineError message={error} onRetry={load} />
      ) : loading ? (
        <div className="p-4 space-y-3">
          {[1,2,3,4].map(i => <div key={i} className="h-14 bg-gray-50 animate-pulse rounded-lg" />)}
        </div>
      ) : insights.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-[13px] font-medium text-gray-900">Nothing needs attention right now.</p>
          <p className="text-[12px] text-gray-400 mt-1">All systems are operating normally.</p>
        </div>
      ) : (
        <div>
          {insights.map((insight, i) => (
            <div
              key={insight.title}
              onClick={() => navigate(insight.path)}
              className={`flex items-start justify-between px-5 py-3.5 hover:bg-gray-50/60 cursor-pointer transition-colors ${i < insights.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
            >
              <div className="flex-1 min-w-0 pr-3">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-gray-900">{insight.title}</span>
                  <span className="text-[11px] font-semibold bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded-full tabular-nums flex-shrink-0">{insight.count}</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{insight.action}</p>
              </div>
              <ArrowRight size={11} className="text-gray-300 flex-shrink-0 mt-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Priority dot colours ────────────────────────────────────────────────────
const PRIORITY_DOT: Record<string, string> = {
  critical: 'bg-red-500',
  high:     'bg-orange-400',
  medium:   'bg-amber-400',
  low:      'bg-gray-300',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const NOTIF_ENTITY_NAV: Record<string, (id: string) => string> = {
  lots:                  id => `/lot-intake/all?selected=${id}`,
  inventory_items:       id => `/inventory/all?selected=${id}`,
  orders:                id => `/orders/all?selected=${id}`,
  shipments:             id => `/shipping/all?selected=${id}`,
  returns:               id => `/returns/all?selected=${id}`,
  marketplace_listings:  id => `/marketplace/all?selected=${id}`,
  warehouse_locations:   id => `/warehouse/locations?selected=${id}`,
  supplies:              id => `/supplies/supply-inventory?selected=${id}`,
  components:            id => `/components/component-inventory?selected=${id}`,
};

function NotificationsCard({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from('notifications')
      .select('id, title, message, priority, is_read, route, entity_type, entity_id, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (err) { console.error('Notifications load error:', err.message); setError('Failed to load notifications.'); }
    else setNotifs(data ?? []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  const handleClick = async (notif: any) => {
    if (!notif.is_read) {
      await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
      setNotifs(ns => ns.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
    }
    const route = notif.route
      ?? (notif.entity_type && notif.entity_id
          ? NOTIF_ENTITY_NAV[notif.entity_type]?.(notif.entity_id)
          : null);
    if (route) navigate(route);
  };

  const unread = notifs.filter(n => !n.is_read).length;

  return (
    <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={12} className="text-gray-400" />
          <h3 className="text-[13px] font-semibold text-gray-900">Notifications</h3>
          {unread > 0 && (
            <span className="text-[10px] font-semibold bg-red-500 text-white px-1.5 py-px rounded-full">{unread}</span>
          )}
        </div>
        <button onClick={load} className="text-gray-400 hover:text-gray-600 transition-colors">
          <RefreshCw size={12} />
        </button>
      </div>
      {error ? (
        <InlineError message={error} onRetry={load} />
      ) : loading ? (
        <div className="p-4 space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-8 bg-gray-50 animate-pulse rounded" />)}
        </div>
      ) : notifs.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <Bell size={16} className="text-gray-200 mx-auto mb-1.5" />
          <p className="text-[12px] text-gray-400">No notifications</p>
        </div>
      ) : (
        <div>
          {notifs.map((notif, i) => {
            const dot = PRIORITY_DOT[notif.priority] ?? PRIORITY_DOT.low;
            const hasLink = !!(notif.route || (notif.entity_type && notif.entity_id && NOTIF_ENTITY_NAV[notif.entity_type]));
            return (
              <div
                key={notif.id}
                onClick={() => handleClick(notif)}
                className={`flex gap-2.5 px-4 py-2.5 transition-colors ${!notif.is_read ? 'bg-[#f0fdf8]' : 'bg-white'} ${hasLink ? 'cursor-pointer hover:bg-gray-50' : ''} ${i < notifs.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
              >
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5 ${dot}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-[12px] leading-snug ${notif.is_read ? 'text-gray-500' : 'text-gray-900 font-medium'}`}>
                    {notif.title ?? notif.message}
                  </p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{timeAgo(notif.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
interface KpiData {
  activeLots: number;
  inProcessing: number;
  activeListings: number;
  openOrders: number;
  pendingShipments: number;
  returnsPending: number;
}

export function CommandCenter() {
  const view = useSecondaryView();
  const { orgId } = useAuth();
  const navigate = useNavigate();

  const [kpis, setKpis] = useState<KpiData | null>(null);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);

  const [lots, setLots] = useState<any[]>([]);
  const [lotsLoading, setLotsLoading] = useState(true);
  const [lotsError, setLotsError] = useState<string | null>(null);

  const [activity, setActivity] = useState<any[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const loadKpis = useCallback(async () => {
    if (!orgId) return;
    setKpiLoading(true); setKpiError(null);
    try {
      const [lotsRes, invRes, listRes, ordRes, shipRes, retRes] = await Promise.all([
        supabase.from('lots').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'ACTIVE'),
        supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['TESTING', 'PHOTOGRAPHY', 'LISTING']),
        supabase.from('marketplace_listings').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'ACTIVE'),
        supabase.from('orders').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'OPEN'),
        supabase.from('shipments').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['LABEL_CREATED', 'PACKED']),
        supabase.from('returns').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).eq('status', 'INSPECTION'),
      ]);
      const errored = [lotsRes, invRes, listRes, ordRes, shipRes, retRes].find(r => r.error);
      if (errored) { console.error('KPI error:', errored.error); setKpiError('Failed to load KPIs.'); return; }
      setKpis({
        activeLots: lotsRes.count ?? 0,
        inProcessing: invRes.count ?? 0,
        activeListings: listRes.count ?? 0,
        openOrders: ordRes.count ?? 0,
        pendingShipments: shipRes.count ?? 0,
        returnsPending: retRes.count ?? 0,
      });
    } catch (e: any) {
      console.error('KPI load error:', e);
      setKpiError(e.message ?? 'Failed to load KPIs.');
    } finally {
      setKpiLoading(false);
    }
  }, [orgId]);

  const loadLots = useCallback(async () => {
    if (!orgId) return;
    setLotsLoading(true); setLotsError(null);
    try {
      const { data, error } = await supabase
        .from('lots')
        .select('id, lot_id, status, total_msrp, recovery_amount, vendors(name)')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) { console.error('Lots load error:', error); setLotsError('Failed to load recent LOTs.'); return; }
      setLots(data ?? []);
    } catch (e: any) {
      console.error('Lots load error:', e);
      setLotsError(e.message ?? 'Failed to load recent LOTs.');
    } finally {
      setLotsLoading(false);
    }
  }, [orgId]);

  const loadActivity = useCallback(async () => {
    if (!orgId) return;
    setActivityLoading(true); setActivityError(null);
    try {
      const { data, error } = await supabase
        .from('activity_log')
        .select('id, message, created_at, entity_type, entity_id')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) { console.error('Activity load error:', error); setActivityError('Failed to load activity.'); return; }
      setActivity(data ?? []);
    } catch (e: any) {
      console.error('Activity load error:', e);
      setActivityError(e.message ?? 'Failed to load activity.');
    } finally {
      setActivityLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    loadKpis();
    loadLots();
    loadActivity();
  }, [orgId, loadKpis, loadLots, loadActivity]);

  // Auto-refresh all data when the tab regains focus
  const lastFocusRef = useRef<number>(0);
  useEffect(() => {
    if (!orgId) return;
    const handler = () => {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        // Debounce: only refresh if at least 30s have passed since last refresh
        if (now - lastFocusRef.current > 30_000) {
          lastFocusRef.current = now;
          loadKpis();
          loadLots();
          loadActivity();
        }
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, [orgId, loadKpis, loadLots, loadActivity]);


    // Realtime subscriptions for live data updates
    useEffect(() => {
          if (!orgId) return;
          const channel = supabase
            .channel(`dashboard-${orgId}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_items', filter: `organization_id=eq.${orgId}` }, () => { loadKpis(); loadLots(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `organization_id=eq.${orgId}` }, () => { loadKpis(); })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_log', filter: `organization_id=eq.${orgId}` }, () => { loadActivity(); })
            .subscribe();
          return () => { supabase.removeChannel(channel); };
    }, [orgId, loadKpis, loadLots, loadActivity]);
  const kpiRows: { label: string; value: number; path: string }[] = [
    { label: 'Active LOTs',     value: kpis?.activeLots ?? 0,       path: '/lot-intake/active'      },
    { label: 'In Processing',   value: kpis?.inProcessing ?? 0,     path: '/command-center/queues'  },
    { label: 'Active Listings', value: kpis?.activeListings ?? 0,   path: '/marketplace/active'     },
    { label: 'Open Orders',     value: kpis?.openOrders ?? 0,       path: '/orders/open'            },
    { label: 'Pending Ship',    value: kpis?.pendingShipments ?? 0, path: '/shipping/all'           },
    { label: 'Returns Pending', value: kpis?.returnsPending ?? 0,   path: '/returns/inspection'     },
  ];

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  if (!orgId) return null;

  return (
    <div className="p-3 sm:p-6 max-w-[1300px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-gray-400 uppercase tracking-wide">{dateStr}</p>
          <h2 className="text-gray-900 mt-1">Command Center</h2>
        </div>
      </div>

      {/* KPI Strip */}
      {kpiError ? (
        <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)]">
          <InlineError message={kpiError} onRetry={loadKpis} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px bg-[rgba(0,0,0,0.06)] rounded-xl overflow-hidden border border-[rgba(0,0,0,0.06)]">
          {kpiRows.map(kpi => (
            <KpiCell
              key={kpi.label}
              label={kpi.label}
              value={kpi.value}
              loading={kpiLoading}
              onClick={() => navigate(kpi.path)}
            />
          ))}
        </div>
      )}

      {/* Action Queues full view */}
      {view === 'queues' && <QueuesView orgId={orgId} />}

      {/* AI Insights full view */}
      {view === 'insights' && <InsightsView orgId={orgId} />}

      {/* Overview + Activity views */}
      {(view === 'overview' || view === 'activity') && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-4">
            {view === 'overview' && (
              <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
                <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-gray-900">Recent LOTs</h3>
                  <button
                    onClick={() => navigate('/lot-intake/all')}
                    className="text-[12px] text-[#3ECF8E] hover:underline font-medium"
                  >
                    View all
                  </button>
                </div>
                {lotsError ? (
                  <InlineError message={lotsError} onRetry={loadLots} />
                ) : lotsLoading ? (
                  <div className="p-4 space-y-2">
                    {[1,2,3].map(i => <div key={i} className="h-10 bg-gray-50 animate-pulse rounded" />)}
                  </div>
                ) : lots.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <p className="text-[13px] text-gray-400 mb-3">No LOTs yet.</p>
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => navigate('/lot-intake/all?action=new-lot')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3ECF8E] hover:bg-[#38c484] text-white text-[12px] font-medium rounded-lg transition-colors"
                      >
                        <Plus size={12} />Create LOT
                      </button>
                      <button
                        onClick={() => navigate('/lot-intake/all?action=upload-manifest')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-[rgba(0,0,0,0.1)] hover:bg-gray-50 text-gray-600 text-[12px] font-medium rounded-lg transition-colors"
                      >
                        <Upload size={12} />Upload Manifest
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {lots.map((lot, i) => {
                      const recovery = lot.total_msrp > 0
                        ? Math.round((Number(lot.recovery_amount || 0) / Number(lot.total_msrp)) * 100)
                        : null;
                      const displayId = lot.lot_id
                        ? lot.lot_id.toUpperCase()
                        : lot.id.slice(0, 8).toUpperCase();
                      return (
                        <div
                          key={lot.id}
                          onClick={() => navigate(`/lot-intake/all?selected=${lot.id}`)}
                          className={`flex items-center justify-between px-5 py-3 hover:bg-gray-50/60 transition-colors cursor-pointer ${i < lots.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''}`}
                        >
                          <div>
                            <span className="text-[13px] font-medium text-gray-900 font-mono">#{displayId}</span>
                            <p className="text-[11px] text-gray-400 mt-0.5">{lot.vendors?.name ?? 'No vendor'} · ${Number(lot.total_msrp || 0).toLocaleString()} MSRP</p>
                          </div>
                          <div className="flex items-center gap-3">
                            {recovery !== null && recovery > 0 && (
                              <span className="text-[12px] text-[#16a34a] font-medium tabular-nums">{recovery}%</span>
                            )}
                            <StatusBadge status={lot.status} size="sm" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Activity */}
            <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[rgba(0,0,0,0.05)] flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-gray-900">Activity</h3>
                <button onClick={loadActivity} className="text-gray-400 hover:text-gray-600 transition-colors">
                  <RefreshCw size={12} />
                </button>
              </div>
              {activityError ? (
                <InlineError message={activityError} onRetry={loadActivity} />
              ) : activityLoading ? (
                <div className="p-4 space-y-2">
                  {[1,2,3,4].map(i => <div key={i} className="h-8 bg-gray-50 animate-pulse rounded" />)}
                </div>
              ) : activity.length === 0 ? (
                <p className="px-5 py-8 text-center text-[13px] text-gray-400">No activity yet. Actions will appear here.</p>
              ) : (
                <div>
                  {activity.map((event, i) => {
                    const navPath = event.entity_type && event.entity_id
                      ? ENTITY_NAV[event.entity_type]?.(event.entity_id)
                      : event.entity_type
                        ? ENTITY_NAV[event.entity_type]?.('')
                        : null;
                    return (
                      <div
                        key={event.id}
                        onClick={navPath ? () => navigate(navPath) : undefined}
                        className={`flex items-start gap-3 px-5 py-3 transition-colors ${i < activity.length - 1 ? 'border-b border-[rgba(0,0,0,0.04)]' : ''} ${navPath ? 'hover:bg-gray-50/60 cursor-pointer' : ''}`}
                      >
                        <div className="w-1 h-1 rounded-full bg-gray-300 flex-shrink-0 mt-[7px]" />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-gray-700 leading-snug">{event.message}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{new Date(event.created_at).toLocaleString()}</p>
                        </div>
                        {navPath && <ArrowRight size={11} className="text-gray-300 flex-shrink-0 mt-1" />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            {/* Workspace status sidebar */}
            <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Zap size={12} className="text-[#3ECF8E]" />
                <h3 className="text-[13px] font-semibold text-gray-900">Workspace Status</h3>
                <span className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#3ECF8E] inline-block animate-pulse" />Live
                </span>
              </div>
              {kpiLoading ? (
                <div className="space-y-3">
                  {[1,2,3,4].map(i => <div key={i} className="h-8 bg-gray-50 animate-pulse rounded" />)}
                </div>
              ) : (
                <div className="space-y-3">
                  {[
                    { label: 'Active LOTs',       value: kpis?.activeLots ?? 0,     path: '/lot-intake/active' },
                    { label: 'Active Listings',    value: kpis?.activeListings ?? 0, path: '/marketplace/active' },
                    { label: 'Open Orders',        value: kpis?.openOrders ?? 0,     path: '/orders/open' },
                    { label: 'Returns to inspect', value: kpis?.returnsPending ?? 0, path: '/returns/inspection' },
                  ].map(item => (
                    <div
                      key={item.label}
                      onClick={() => navigate(item.path)}
                      className="flex items-center justify-between cursor-pointer hover:bg-gray-50 -mx-2 px-2 py-1 rounded-lg transition-colors"
                    >
                      <p className="text-[12px] text-gray-500">{item.label}</p>
                      <span className="text-[14px] font-semibold text-gray-900 tabular-nums">{item.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Notifications */}
            <NotificationsCard orgId={orgId} />

            {/* AI Insights sidebar teaser */}
            {view === 'overview' && (
              <InsightsView orgId={orgId} />
            )}

            <div className="bg-white rounded-xl border border-[rgba(0,0,0,0.07)] p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles size={12} className="text-gray-400" />
                <h3 className="text-[13px] font-semibold text-gray-900">AI Ops</h3>
              </div>
              <p className="text-[13px] text-gray-500 leading-relaxed">Generate listings, parse manifests, and get recovery insights.</p>
              <button
                onClick={() => navigate('/ai-ops/overview')}
                className="mt-3 flex items-center gap-1 text-[12px] text-[#3ECF8E] font-medium hover:underline"
              >
                Open AI Ops <ArrowRight size={10} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
