import { useNavigate, useLocation, useParams } from 'react-router';
import { useAuth } from '../../contexts/AuthContext';
import { useOrgQuery } from '../../lib/hooks';

interface NavItem {
  id: string;
  label: string;
}

type NavSection = { heading?: string; items: NavItem[] };

const secondaryNavConfig: Record<string, NavSection[]> = {
  '/command-center': [
    { items: [
      { id: 'overview', label: 'Overview' },
      { id: 'queues', label: 'Action Queues' },
      { id: 'activity', label: 'Activity' },
      { id: 'insights', label: 'AI Insights' },
    ]},
  ],
  '/lot-intake': [
    { items: [
      { id: 'all', label: 'All LOTs' },
    ]},
    { heading: 'By Status', items: [
      { id: 'purchased', label: 'Purchased' },
      { id: 'in-transit', label: 'In Transit' },
      { id: 'arrived', label: 'Arrived' },
      { id: 'processing', label: 'Processing' },
      { id: 'active', label: 'Active' },
      { id: 'partial', label: 'Partial' },
      { id: 'closed', label: 'Closed' },
    ]},
    { heading: 'Partners', items: [
      { id: 'vendors', label: 'Vendors' },
      { id: 'funding', label: 'Funding Partners' },
    ]},
  ],
  '/inventory': [
    { items: [
      { id: 'all', label: 'All Items' },
    ]},
    { heading: 'Queues', items: [
      { id: 'unprocessed', label: 'Intake Queue' },
      { id: 'testing', label: 'Testing' },
      { id: 'photography', label: 'Photography' },
      { id: 'listing', label: 'Listing Queue' },
    ]},
    { heading: 'Fulfillment', items: [
      { id: 'active', label: 'Active' },
      { id: 'picked', label: 'Picked' },
      { id: 'packed', label: 'Packed' },
      { id: 'shipped', label: 'Shipped' },
      { id: 'delivered', label: 'Delivered' },
    ]},
    { heading: 'Exceptions', items: [
      { id: 'returned', label: 'Returned' },
      { id: 'scrapped', label: 'Scrapped' },
    ]},
  ],
  '/warehouse': [
    { items: [
      { id: 'overview', label: 'Overview' },
      { id: 'locations', label: 'All Locations' },
      { id: 'movements', label: 'Movement Log' },
    ]},
  ],
  '/marketplace': [
    { items: [
      { id: 'all', label: 'All Listings' },
    ]},
    { heading: 'Status', items: [
      { id: 'active', label: 'Active' },
      { id: 'pending', label: 'Pending Sync' },
      { id: 'sold', label: 'Sold' },
      { id: 'error', label: 'Errors' },
    ]},
    { heading: 'Channels', items: [
      { id: 'ebay', label: 'eBay' },
      { id: 'shopify', label: 'Shopify' },
    ]},
  ],
  '/orders': [
    { items: [
      { id: 'all', label: 'All Orders' },
    ]},
    { heading: 'Fulfillment', items: [
      { id: 'open', label: 'Open' },
      { id: 'picking', label: 'Picking' },
      { id: 'packed', label: 'Packed' },
      { id: 'shipped', label: 'Shipped' },
      { id: 'delivered', label: 'Delivered' },
    ]},
    { heading: 'Exceptions', items: [
      { id: 'returned', label: 'Returned' },
      { id: 'cancelled', label: 'Cancelled' },
    ]},
  ],
  '/shipping': [
    { items: [
      { id: 'all', label: 'All Shipments' },
    ]},
    { heading: 'Queue', items: [
      { id: 'label-created', label: 'Label Queue' },
      { id: 'packed', label: 'Packed' },
      { id: 'in-transit', label: 'In Transit' },
      { id: 'delivered', label: 'Delivered' },
      { id: 'exceptions', label: 'Exceptions' },
    ]},
  ],
  '/returns': [
    { items: [
      { id: 'all', label: 'All Returns' },
    ]},
    { heading: 'Queue', items: [
      { id: 'inspection', label: 'Inspection Queue' },
      { id: 'restocked', label: 'Restocked' },
      { id: 'relisted', label: 'Relisted' },
      { id: 'scrapped', label: 'Scrapped' },
    ]},
  ],
  '/partners': [
    { items: [
      { id: 'overview', label: 'Overview' },
    ]},
    { heading: 'Relationships', items: [
      { id: 'vendors', label: 'Vendors' },
      { id: 'funding', label: 'Funding Partners' },
      { id: 'recovery', label: 'Recovery Tracker' },
    ]},
  ],
  '/reports': [
    { items: [
      { id: 'overview', label: 'Overview' },
    ]},
    { heading: 'Analytics', items: [
      { id: 'recovery', label: 'Recovery Analytics' },
      { id: 'margins', label: 'Margin Analytics' },
      { id: 'aging', label: 'Inventory Aging' },
      { id: 'vendor', label: 'Vendor Performance' },
      { id: 'marketplace', label: 'Marketplace' },
    ]},
    { heading: 'Saved', items: [
      { id: 'saved', label: 'Saved Reports' },
    ]},
  ],
  '/integrations': [
    { items: [
      { id: 'all', label: 'All Integrations' },
    ]},
    { heading: 'Category', items: [
      { id: 'marketplace', label: 'Marketplace' },
      { id: 'shipping', label: 'Shipping' },
      { id: 'accounting', label: 'Accounting' },
    ]},
  ],
  '/ai-ops': [
    { items: [
      { id: 'overview', label: 'Overview' },
      { id: 'listing-gen', label: 'Listing Generator' },
      { id: 'manifest', label: 'Manifest Parser' },
      { id: 'insights', label: 'Recovery Insights' },
      { id: 'suggestions', label: 'Workflow Suggestions' },
    ]},
  ],
  '/components': [
    { items: [{ id: 'overview', label: 'Overview' }]},
    { heading: 'Inventory', items: [
      { id: 'component-inventory', label: 'Component Inventory' },
      { id: 'low-stock', label: 'Low Stock' },
    ]},
    { heading: 'Activity', items: [
      { id: 'transactions', label: 'Transactions' },
    ]},
    { heading: 'Setup', items: [
      { id: 'bundles', label: 'Bundles' },
      { id: 'categories', label: 'Categories' },
    ]},
  ],
  '/supplies': [
    { items: [
      { id: 'overview', label: 'Overview' },
    ]},
    { heading: 'Inventory', items: [
      { id: 'supply-inventory', label: 'Supply Inventory' },
      { id: 'low-stock', label: 'Low Stock' },
      { id: 'reorder', label: 'Reorder' },
    ]},
    { heading: 'Activity', items: [
      { id: 'transactions', label: 'Transactions' },
      { id: 'usage', label: 'Usage Log' },
    ]},
    { heading: 'Setup', items: [
      { id: 'templates', label: 'Pkg Templates' },
      { id: 'invoice-imports', label: 'Invoice Imports' },
      { id: 'categories', label: 'Categories' },
    ]},
  ],
  '/settings': [
    { items: [
      { id: 'org', label: 'Organization' },
      { id: 'account', label: 'Account' },
    ]},
    { heading: 'Access', items: [
      { id: 'users', label: 'Users & Roles' },
      { id: 'permissions', label: 'Permissions' },
      { id: 'api', label: 'API Keys' },
    ]},
    { heading: 'Preferences', items: [
      { id: 'notifications', label: 'Notifications' },
      { id: 'branding', label: 'Branding' },
      { id: 'inventory', label: 'Inventory IDs' },
    ]},
  ],
};

function useNavCounts(basePath: string, orgId: string | null): Record<string, number> {
  const inLots = basePath === '/lot-intake';
  const inInv = basePath === '/inventory';
  const inMkt = basePath === '/marketplace';
  const inOrd = basePath === '/orders';
  const inShip = basePath === '/shipping';
  const inRet = basePath === '/returns';
  const active = !!orgId;

  const { data: lots } = useOrgQuery<{ status: string }>('lots', orgId, {
    select: 'status', enabled: active && inLots,
  });
  const { data: inv } = useOrgQuery<{ status: string }>('inventory_items', orgId, {
    select: 'status', enabled: active && inInv,
  });
  const { data: listings } = useOrgQuery<{ status: string; sync_status: string }>('marketplace_listings', orgId, {
    select: 'status,sync_status', enabled: active && inMkt,
  });
  const { data: orders } = useOrgQuery<{ status: string }>('orders', orgId, {
    select: 'status', enabled: active && inOrd,
  });
  const { data: ships } = useOrgQuery<{ status: string }>('shipments', orgId, {
    select: 'status', enabled: active && inShip,
  });
  const { data: rets } = useOrgQuery<{ status: string }>('returns', orgId, {
    select: 'status', enabled: active && inRet,
  });

  const cnt = (arr: any[], val: string, field = 'status') =>
    arr.filter(r => r[field] === val).length;

  if (inLots) return {
    purchased: cnt(lots, 'PURCHASED'),
    'in-transit': cnt(lots, 'IN_TRANSIT'),
    arrived: cnt(lots, 'ARRIVED'),
    processing: cnt(lots, 'PROCESSING'),
    active: cnt(lots, 'ACTIVE'),
    partial: cnt(lots, 'PARTIAL'),
    closed: cnt(lots, 'CLOSED'),
  };

  if (inInv) return {
    unprocessed: cnt(inv, 'UNPROCESSED'),
    testing: cnt(inv, 'TESTING'),
    photography: cnt(inv, 'PHOTOGRAPHY'),
    listing: cnt(inv, 'LISTING'),
    active: cnt(inv, 'ACTIVE'),
    picked: cnt(inv, 'PICKED'),
    packed: cnt(inv, 'PACKED'),
    shipped: cnt(inv, 'SHIPPED'),
    delivered: cnt(inv, 'DELIVERED'),
    returned: cnt(inv, 'RETURNED'),
    scrapped: cnt(inv, 'SCRAPPED'),
  };

  if (inMkt) return {
    active: cnt(listings, 'ACTIVE'),
    pending: cnt(listings, 'PENDING', 'sync_status'),
    sold: cnt(listings, 'SOLD'),
    error: cnt(listings, 'ERROR'),
  };

  if (inOrd) return {
    open: cnt(orders, 'OPEN'),
    picking: cnt(orders, 'PICKING'),
    packed: cnt(orders, 'PACKED'),
    shipped: cnt(orders, 'SHIPPED'),
    delivered: cnt(orders, 'DELIVERED'),
    returned: cnt(orders, 'RETURNED'),
    cancelled: cnt(orders, 'CANCELLED'),
  };

  if (inShip) return {
    'label-created': cnt(ships, 'LABEL_CREATED'),
    packed: cnt(ships, 'PACKED'),
    'in-transit': cnt(ships, 'IN_TRANSIT'),
    delivered: cnt(ships, 'DELIVERED'),
    exceptions: cnt(ships, 'EXCEPTION'),
  };

  if (inRet) return {
    inspection: cnt(rets, 'INSPECTION'),
    restocked: cnt(rets, 'RESTOCKED'),
    relisted: cnt(rets, 'RELISTED'),
    scrapped: cnt(rets, 'SCRAPPED'),
  };

  return {};
}

export function SecondarySidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { view: viewParam } = useParams();
  const { orgId } = useAuth();

  // Extract base path (e.g. '/lot-intake' from '/lot-intake/all')
  const basePath = '/' + location.pathname.split('/').filter(Boolean)[0];
  const counts = useNavCounts(basePath, orgId);

  const sections = secondaryNavConfig[basePath];
  if (!sections) return null;

  const allItems = sections.flatMap(s => s.items);
  const activeId = viewParam ?? allItems[0]?.id;

  return (
    <aside className="w-[168px] flex-shrink-0 h-full bg-[#F8F9FA] border-r border-[rgba(0,0,0,0.07)] overflow-y-auto">
      <div className="py-3">
        {sections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-1' : ''}>
            {section.heading && (
              <p className="px-3.5 pt-3 pb-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-[0.06em]">
                {section.heading}
              </p>
            )}
            {section.items.map(item => {
              const isActive = activeId === item.id;
              const liveCount = counts[item.id];
              const showCount = liveCount !== undefined && liveCount >= 0;
              return (
                <div key={item.id} className="px-1.5">
                  <button
                    onClick={() => navigate(`${basePath}/${item.id}`)}
                    className={`w-full flex items-center justify-between px-2.5 py-[6px] rounded-md text-left transition-all ${
                      isActive
                        ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.07)] text-gray-900'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                    }`}
                  >
                    <span className={`text-[13px] ${isActive ? 'font-medium' : 'font-normal'}`}>{item.label}</span>
                    {showCount && liveCount > 0 && (
                      <span className={`text-[10px] font-medium tabular-nums ml-1.5 ${isActive ? 'text-gray-500' : 'text-gray-400'}`}>
                        {liveCount}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function useSecondaryView() {
  const { view } = useParams();
  return view ?? 'all';
}
