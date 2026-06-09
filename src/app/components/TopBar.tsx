import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Bell, Plus, ChevronDown, X, CheckCheck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
const DERYV_LOGO = 'https://byzjsafupehesiwbqkxt.supabase.co/storage/v1/object/public/brand-assets/deryv-logo.png';

const pageLabels: Record<string, string> = {
  '/command-center': 'Command Center',
  '/lot-intake': 'LOT Intake',
  '/inventory': 'Inventory',
  '/warehouse': 'Warehouse',
  '/supplies': 'Supplies',
  '/components': 'Components',
  '/marketplace': 'Marketplace',
  '/orders': 'Orders',
  '/shipping': 'Shipping',
  '/returns': 'Returns',
  '/partners': 'Partners',
  '/reports': 'Reports',
  '/integrations': 'Integrations',
  '/ai-ops': 'AI Ops',
  '/settings': 'Settings',
};

const subviewLabels: Record<string, string> = {
  // LOT Intake
  'all': 'All LOTs',
  'processing': 'Processing',
  'intake': 'Intake',
  'verified': 'Verified',
  'closed': 'Closed',
  // Inventory
  // Warehouse
  'locations': 'Locations',
  'activity': 'Activity',
  // Supplies
  'supply-inventory': 'Supply Inventory',
  'invoice-imports': 'Invoice Imports',
  // Components
  'component-inventory': 'Component Inventory',
  // Marketplace
  'active': 'Active Listings',
  'draft': 'Drafts',
  'error': 'Errors',
  // Orders
  'open': 'Open Orders',
  'picking': 'Picking',
  'packed': 'Packed',
  'completed': 'Completed',
  // Shipping
  'label-created': 'Label Created',
  'in-transit': 'In Transit',
  'delivered': 'Delivered',
  // Returns
  'pending': 'Pending',
  'approved': 'Approved',
  'restocked': 'Restocked',
  // Partners
  'vendors': 'Vendors',
  'funding': 'Funding Partners',
  'recovery': 'Recovery Tracker',
  // Settings
  'account': 'Account',
  'org': 'Organization',
  'team': 'Team',
  'branding': 'Branding',
  'notifications': 'Notifications',
  // AI Ops
  'dashboard': 'Dashboard',
  'listing-gen': 'Listing Generator',
  'manifest': 'Manifest Review',
  'pricing': 'Pricing Assistant',
  'chat': 'Operations Chat',
  'runs': 'AI Runs History',
};

const quickActions: { label: string; path: string; action: string }[] = [
  { label: 'New LOT',              path: '/lot-intake/all',              action: 'new-lot'               },
  { label: 'Upload Manifest',      path: '/lot-intake/all',              action: 'upload-manifest'        },
  { label: 'Add Inventory',        path: '/inventory/all',               action: 'add-item'              },
  { label: 'Create Order',         path: '/orders/all',                  action: 'create-order'          },
  { label: 'Create Shipment',      path: '/shipping/all',                action: 'create-shipment'       },
  { label: 'Upload Supply Invoice', path: '/supplies/invoice-imports',   action: 'upload-supply-invoice' },
];

const NOTIF_ENTITY_NAV: Record<string, (id: string) => string> = {
  lots:                   id => `/lot-intake/all?selected=${id}`,
  inventory_items:        id => `/inventory/all?selected=${id}`,
  orders:                 id => `/orders/all?selected=${id}`,
  shipments:              id => `/shipping/all?selected=${id}`,
  returns:                id => `/returns/all?selected=${id}`,
  marketplace_listings:   id => `/marketplace/all?selected=${id}`,
  warehouse_locations:    id => `/warehouse/locations?selected=${id}`,
  supplies:               id => `/supplies/supply-inventory?selected=${id}`,
  components:             id => `/components/component-inventory?selected=${id}`,
  reports:                id => `/reports`,
  manifest_imports:       id => `/lot-intake/all`,
  supply_invoice_imports: id => `/supplies/invoice-imports`,
  packing_scans:          id => `/shipping/all`,
};

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

export function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, currentRole, orgId, currentOrg, signOut } = useAuth();

  const [showActions, setShowActions] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notifsLoading, setNotifsLoading] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  const loadNotifications = useCallback(async () => {
    if (!orgId) return;
    setNotifsLoading(true);
    const { data, error } = await supabase
      .from('notifications')
      .select('id, title, message, priority, is_read, route, entity_type, entity_id, created_at')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) console.error('Failed to load notifications:', error.message);
    setNotifications(data ?? []);
    setNotifsLoading(false);
  }, [orgId]);

  useEffect(() => {
    if (orgId) loadNotifications();
  }, [orgId, loadNotifications]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setShowNotifs(false);
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) setShowActions(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setShowProfile(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const markRead = async (id: string) => {
    if (!orgId) return;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id)
      .eq('organization_id', orgId);
    if (error) console.error('Failed to mark notification as read:', error.message);
    setNotifications(ns => ns.map(n => n.id === id ? { ...n, is_read: true } : n));
  };

  const markAllRead = async () => {
    if (!orgId) return;
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);
    if (!unreadIds.length) return;
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('organization_id', orgId)
      .in('id', unreadIds);
    if (error) console.error('Failed to mark all notifications as read:', error.message);
    setNotifications(ns => ns.map(n => ({ ...n, is_read: true })));
  };

  const handleNotifClick = async (notif: any) => {
    const route = notif.route
      ?? (notif.entity_type && notif.entity_id
          ? NOTIF_ENTITY_NAV[notif.entity_type]?.(notif.entity_id)
          : null);
    if (!notif.is_read) await markRead(notif.id);
    setShowNotifs(false);
    if (route) navigate(route);
  };

  const handleQuickAction = (path: string, action: string) => {
    setShowActions(false);
    navigate(`${path}?action=${action}`);
  };

  const handleSearch = async () => {
    const input = searchInput.trim();
    if (!input || searching || !orgId) return;

    setSearching(true);
    setSearchError(null);

    try {
      // 1. Check if input contains selected=<uuid>
      const selectedMatch = input.match(/selected=([a-f0-9-]{36})/i);
      if (selectedMatch) {
        const uuid = selectedMatch[1];
        setSearchInput('');
        navigate(`/inventory/all?selected=${uuid}`);
        searchRef.current?.blur();
        return;
      }

      // 2-4. Check inventory_items by id, inventory_id, or barcode_value
      const { data: invItems } = await supabase
        .from('inventory_items')
        .select('id')
        .eq('organization_id', orgId)
        .or(`id.eq.${input},inventory_id.eq.${input},barcode_value.eq.${input}`)
        .limit(1);

      if (invItems && invItems.length > 0) {
        setSearchInput('');
        navigate(`/inventory/all?selected=${invItems[0].id}`);
        searchRef.current?.blur();
        return;
      }

      // 5. Check lots by lot_id
      const { data: lots } = await supabase
        .from('lots')
        .select('id')
        .eq('organization_id', orgId)
        .eq('lot_id', input)
        .limit(1);

      if (lots && lots.length > 0) {
        setSearchInput('');
        navigate(`/lot-intake/all?selected=${lots[0].id}`);
        searchRef.current?.blur();
        return;
      }

      // 6. Check orders by order_id
      const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('organization_id', orgId)
        .eq('order_id', input)
        .limit(1);

      if (orders && orders.length > 0) {
        setSearchInput('');
        navigate(`/orders/all?selected=${orders[0].id}`);
        searchRef.current?.blur();
        return;
      }

      // 7-8. Check shipments by shipment_id or tracking_number
      const { data: shipments } = await supabase
        .from('shipments')
        .select('id')
        .eq('organization_id', orgId)
        .or(`shipment_id.eq.${input},tracking_number.eq.${input}`)
        .limit(1);

      if (shipments && shipments.length > 0) {
        setSearchInput('');
        navigate(`/shipping/all?selected=${shipments[0].id}`);
        searchRef.current?.blur();
        return;
      }

      // Nothing found
      setSearchError('No result found');
      setTimeout(() => setSearchError(null), 3000);
    } catch (error: any) {
      setSearchError(`Search error: ${error.message}`);
      setTimeout(() => setSearchError(null), 3000);
    } finally {
      setSearching(false);
    }
  };

  const pathSegments = location.pathname.split('/').filter(Boolean);
  const basePath = '/' + (pathSegments[0] ?? '');
  const pageLabel = pageLabels[basePath] ?? '';
  const subviewSlug = pathSegments[1] ?? '';
  const subviewLabel = subviewSlug ? subviewLabels[subviewSlug] : null;

  const userInitials = user?.user_metadata?.name
    ? user.user_metadata.name.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
    : user?.email?.slice(0, 2).toUpperCase() ?? 'JD';
  const userName = user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'User';

  return (
    <header className="h-[54px] border-b border-[rgba(0,0,0,0.08)] bg-white flex items-center flex-shrink-0 z-30 w-full">
      {/* Logo — overflow-hidden crops the whitespace padding baked into the image file */}
      <div className="flex items-center px-4 flex-shrink-0 w-[200px]">
        <img src={DERYV_LOGO} alt="deryv" className="h-[35px] w-auto object-contain" />
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-[rgba(0,0,0,0.09)] flex-shrink-0" />

      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 px-4 min-w-0">
        <span className="text-[13px] text-gray-400 select-none hidden sm:block">deryv</span>
        {pageLabel && (
          <>
            <span className="text-[13px] text-gray-300 hidden sm:block">/</span>
            <button
              onClick={() => navigate(basePath + '/all')}
              className="text-[13px] font-medium text-gray-700 hover:text-gray-900 transition-colors truncate"
            >
              {pageLabel}
            </button>
          </>
        )}
        {subviewLabel && (
          <>
            <span className="text-[13px] text-gray-300">/</span>
            <span className="text-[13px] text-gray-500 truncate">{subviewLabel}</span>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* Right actions */}
      <div className="flex items-center gap-1.5 px-4">
        {/* Search */}
        <div className="relative hidden md:block mr-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Search or scan..."
            disabled={searching}
            className="pl-7 pr-9 py-[5px] text-[13px] bg-[#F5F5F5] border border-transparent rounded-lg w-52 focus:outline-none focus:ring-1 focus:ring-[#3ECF8E]/40 focus:border-[#3ECF8E]/50 focus:bg-white placeholder:text-gray-400 transition-all focus:w-64 disabled:opacity-60"
          />
          {searchError ? (
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-red-500 font-medium pointer-events-none">{searchError}</span>
          ) : (
            <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 font-mono pointer-events-none bg-white border border-[rgba(0,0,0,0.1)] rounded px-1 py-px">⏎</kbd>
          )}
        </div>

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setShowNotifs(v => !v); if (!showNotifs && orgId) loadNotifications(); }}
            className="relative w-8 h-8 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Bell size={15} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-[14px] bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-[3px] leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute right-0 top-full mt-1.5 w-80 bg-white border border-[rgba(0,0,0,0.09)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] z-50 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(0,0,0,0.06)]">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-gray-900">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-[11px] font-medium bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{unreadCount} unread</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-700 px-2 py-1 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <CheckCheck size={11} />
                      <span>All read</span>
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotifs(false)}
                    className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="max-h-[360px] overflow-y-auto divide-y divide-[rgba(0,0,0,0.04)]">
                {notifsLoading ? (
                  <div className="p-4 space-y-3">
                    {[1,2,3].map(i => (
                      <div key={i} className="space-y-1.5">
                        <div className="h-3 w-3/4 bg-gray-100 animate-pulse rounded" />
                        <div className="h-2.5 w-full bg-gray-100 animate-pulse rounded" />
                      </div>
                    ))}
                  </div>
                ) : notifications.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <Bell size={20} className="text-gray-200 mx-auto mb-2" />
                    <p className="text-[13px] text-gray-400">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map(notif => {
                    const hasLink = !!(notif.route || (notif.entity_type && notif.entity_id && NOTIF_ENTITY_NAV[notif.entity_type]));
                    const dot = PRIORITY_DOT[notif.priority] ?? PRIORITY_DOT.low;
                    return (
                      <div
                        key={notif.id}
                        onClick={() => handleNotifClick(notif)}
                        className={`flex gap-3 px-4 py-3 transition-colors ${!notif.is_read ? 'bg-[#f0fdf8]' : 'bg-white'} ${hasLink ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      >
                        <div className="flex-shrink-0 mt-1.5">
                          <div className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-[12px] leading-snug ${notif.is_read ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>
                            {notif.title ?? notif.message}
                          </p>
                          {notif.title && notif.message && (
                            <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed line-clamp-2">{notif.message}</p>
                          )}
                          <p className="text-[10px] text-gray-400 mt-1">{timeAgo(notif.created_at)}</p>
                        </div>
                        {!notif.is_read && (
                          <button
                            onClick={e => { e.stopPropagation(); markRead(notif.id); }}
                            className="flex-shrink-0 self-center w-5 h-5 flex items-center justify-center rounded-md hover:bg-gray-100 text-gray-300 hover:text-gray-500 transition-colors"
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* New button */}
        <div className="relative" ref={actionsRef}>
          <button
            onClick={() => setShowActions(!showActions)}
            className="flex items-center gap-1.5 bg-[#3ECF8E] hover:bg-[#38c484] active:bg-[#32ba7d] text-white px-3 py-[5px] rounded-lg text-[13px] font-medium transition-colors"
          >
            <Plus size={13} strokeWidth={2.5} />
            New
            <ChevronDown size={11} className="opacity-70 ml-0.5" />
          </button>
          {showActions && (
            <div className="absolute right-0 top-full mt-1.5 bg-white border border-[rgba(0,0,0,0.09)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] z-50 w-48 py-1 overflow-hidden">
              {quickActions.map(({ label, path, action }) => (
                <button
                  key={action}
                  className="w-full px-3 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
                  onClick={() => handleQuickAction(path, action)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="h-5 w-px bg-[rgba(0,0,0,0.09)] mx-1 flex-shrink-0" />

        {/* User */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setShowProfile(!showProfile)}
            className="flex items-center gap-2 hover:bg-gray-50 pl-1 pr-2 py-1 rounded-lg transition-colors"
          >
            <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-semibold tracking-wide">{userInitials}</span>
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-[12px] font-medium text-gray-800 leading-none">{userName}</p>
              <p className="text-[10px] text-gray-400 mt-0.5 leading-none capitalize">{currentRole ?? 'viewer'}</p>
            </div>
          </button>

          {showProfile && (
            <div className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-[rgba(0,0,0,0.09)] rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.08)] z-50 overflow-hidden">
              {/* User Info */}
              <div className="px-4 py-3 border-b border-[rgba(0,0,0,0.06)]">
                <p className="text-[13px] font-semibold text-gray-900 truncate">{user?.user_metadata?.name ?? user?.email?.split('@')[0] ?? 'User'}</p>
                <p className="text-[11px] text-gray-500 truncate mt-0.5">{user?.email ?? ''}</p>
                <div className="flex items-center gap-2 mt-2 pt-2 border-t border-[rgba(0,0,0,0.04)]">
                  <div className="flex-1">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Role</p>
                    <p className="text-[12px] text-gray-700 capitalize mt-0.5">{currentRole ?? 'viewer'}</p>
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] text-gray-400 uppercase tracking-wide">Organization</p>
                    <p className="text-[12px] text-gray-700 truncate mt-0.5">{currentOrg?.name ?? '—'}</p>
                  </div>
                </div>
              </div>

              {/* Menu Items */}
              <div className="py-1">
                <button
                  onClick={() => { setShowProfile(false); navigate('/settings/account'); }}
                  className="w-full px-4 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Account Settings
                </button>
                <button
                  onClick={() => { setShowProfile(false); navigate('/settings/org'); }}
                  className="w-full px-4 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Organization Settings
                </button>
                <button
                  onClick={() => { setShowProfile(false); navigate('/settings/branding'); }}
                  className="w-full px-4 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Branding
                </button>
              </div>

              {/* Sign Out */}
              <div className="border-t border-[rgba(0,0,0,0.06)] py-1">
                <button
                  onClick={() => { setShowProfile(false); signOut(); }}
                  className="w-full px-4 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 transition-colors font-medium"
                >
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
